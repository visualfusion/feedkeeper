import { fetch as undiciFetch } from "undici";
import { assertPublicHttpUrl, createPublicDispatcher, normalizeUrlCandidate } from "./ssrfGuard.js";
import { APP_VERSION } from "../version.js";
import { feedRequests, sourceHost } from "./requestGate.js";
import { readPollSettings } from "./pollSettings.js";

const MAX_RESPONSE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_REDIRECTS = 5;
const USER_AGENT = `FeedKeeper/${APP_VERSION} (+https://github.com/visualfusion/feedkeeper)`;

export interface FetchedFeed {
  body: string;
  etag?: string;
  lastModified?: string;
  notModified: boolean;
  contentType?: string;
  finalUrl: string;
}

interface Download {
  notModified: boolean;
  buffer: Buffer;
  contentType?: string;
  etag?: string;
  lastModified?: string;
  finalUrl: string;
}

export class FeedHttpError extends Error {
  constructor(public status: number, public retryAt: number | undefined, public host: string) {
    super(`Feed responded with HTTP ${status}`);
  }
}

/** RFC 9110: non-negative integer seconds or an HTTP date (including obsolete HTTP dates). */
export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (value === null) return undefined;
  const text = value.trim();
  if (/^\d+$/.test(text)) {
    const seconds = Number(text);
    if (!Number.isFinite(seconds)) return undefined;
    return Math.min(8.64e15, now + seconds * 1000);
  }
  const day = "(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)";
  const month = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)";
  const time = "\\d{2}:\\d{2}:\\d{2}";
  const imf = new RegExp(`^${day}, \\d{2} ${month} \\d{4} ${time} GMT$`);
  const obsolete = text.match(new RegExp(`^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), (\\d{2})-(${month})-(\\d{2}) (${time}) GMT$`));
  const asctime = text.match(new RegExp(`^(${day}) (${month}) ( [1-9]|\\d{2}) (${time}) (\\d{4})$`));
  let normalized = text;
  if (obsolete) {
    const yearLimit = new Date(now).getUTCFullYear() + 50;
    let year = Math.floor(yearLimit / 100) * 100 + Number(obsolete[4]);
    if (year > yearLimit) year -= 100;
    normalized = `${obsolete[1].slice(0,3)}, ${obsolete[2]} ${obsolete[3]} ${year} ${obsolete[5]} GMT`;
  } else if (asctime) {
    // asctime has no zone suffix; HTTP dates are always UTC, never the server's local time.
    normalized = `${asctime[1]}, ${asctime[3].trim().padStart(2,"0")} ${asctime[2]} ${asctime[5]} ${asctime[4]} GMT`;
  } else if (!imf.test(text)) return undefined;
  const date = Date.parse(normalized);
  if (!Number.isFinite(date) || new Date(date).toUTCString() !== normalized) return undefined;
  return Math.max(now, date);
}

/** DNS preflight cannot be cancelled, but must not hold the caller past its deadline. */
async function validateUrl(url: string, signal: AbortSignal): Promise<URL> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    assertPublicHttpUrl(url).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

// Re-validate every redirect hop and bound headers, body, DNS and permit waiting together.
async function downloadPublic(
  url: string,
  opts: { accept: string; maxBytes: number; etag?: string; lastModified?: string; signal?: AbortSignal },
): Promise<Download> {
  let currentUrl = url;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new DOMException("Download deadline exceeded", "TimeoutError")), readPollSettings().requestTimeoutMs);
  const signal = opts.signal ? AbortSignal.any([controller.signal, opts.signal]) : controller.signal;
  const dispatcher = createPublicDispatcher();
  try {
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      const candidate = new URL(normalizeUrlCandidate(currentUrl));
      const host = sourceHost(candidate.href);
      const release = await feedRequests.acquire(host, signal);
      try {
        const validated = await validateUrl(candidate.href, signal);
        signal.throwIfAborted();
        const headers: Record<string, string> = { "User-Agent": USER_AGENT, Accept: opts.accept };
        if (redirects === 0 && opts.etag) headers["If-None-Match"] = opts.etag;
        if (redirects === 0 && opts.lastModified) headers["If-Modified-Since"] = opts.lastModified;
        const response = await undiciFetch(validated, { headers, redirect: "manual", signal, dispatcher });
        if (response.status === 304) {
          await response.body?.cancel();
          return { notModified: true, buffer: Buffer.alloc(0), finalUrl: currentUrl, contentType: response.headers.get("content-type") ?? undefined };
        }
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          await response.body?.cancel();
          if (!location) throw new Error("Redirect without a Location header");
          currentUrl = new URL(location, validated).toString();
          continue;
        }
        if (!response.ok) {
          let retryAt = parseRetryAfter(response.headers.get("retry-after"));
          if (response.status === 429 || response.status === 503) {
            retryAt = Math.max(retryAt ?? 0, Date.now() + readPollSettings().retryBaseMs * (0.5 + Math.random() * 0.5));
            feedRequests.defer(host, retryAt);
          }
          await response.body?.cancel();
          throw new FeedHttpError(response.status, retryAt, host);
        }
        const contentLength = response.headers.get("content-length");
        if (contentLength && Number(contentLength) > opts.maxBytes) {
          await response.body?.cancel();
          throw new Error("Feed response exceeds the maximum allowed size");
        }
        const reader = response.body?.getReader();
        if (!reader) throw new Error("Feed response had no body");
        const chunks: Uint8Array[] = [];
        let total = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > opts.maxBytes) {
            await reader.cancel();
            throw new Error("Feed response exceeds the maximum allowed size");
          }
          chunks.push(value);
        }
        return {
          notModified: false, buffer: Buffer.concat(chunks, total),
          contentType: response.headers.get("content-type") ?? undefined,
          etag: response.headers.get("etag") ?? undefined,
          lastModified: response.headers.get("last-modified") ?? undefined, finalUrl: currentUrl,
        };
      } finally { release(); }
    }
    throw new Error("Too many redirects while fetching feed");
  } finally { clearTimeout(timeout); await dispatcher.destroy(); }
}

// Fetches a feed URL with conditional GET headers and decodes it to text.
export async function fetchFeed(
  url: string,
  opts: { etag?: string; lastModified?: string; signal?: AbortSignal } = {},
): Promise<FetchedFeed> {
  const download = await downloadPublic(url, {
    accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html, application/xhtml+xml;q=0.9, */*;q=0.5",
    maxBytes: MAX_RESPONSE_BYTES,
    etag: opts.etag,
    lastModified: opts.lastModified,
    signal: opts.signal,
  });
  if (download.notModified) {
    return { notModified: true, body: "", finalUrl: download.finalUrl, contentType: download.contentType };
  }
  return {
    body: decodeFeedBuffer(download.buffer, download.contentType),
    notModified: false,
    etag: download.etag,
    lastModified: download.lastModified,
    contentType: download.contentType,
    finalUrl: download.finalUrl,
  };
}

/** Downloads an image for the archive; the caller checks the file signature. */
export async function fetchImage(url: string, maxBytes: number, signal?: AbortSignal): Promise<{ buffer: Buffer; finalUrl: string }> {
  const download = await downloadPublic(url, { accept: "image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9,*/*;q=0.5", maxBytes, signal });
  return { buffer: download.buffer, finalUrl: download.finalUrl };
}

/**
 * Decodes raw response buffer into a string respecting character encoding from:
 * 1. HTTP Content-Type header (e.g. charset=ISO-8859-1)
 * 2. XML declaration header (e.g. <?xml version="1.0" encoding="ISO-8859-1"?>)
 * Defaults to UTF-8.
 */
function decodeFeedBuffer(buffer: Buffer, contentType?: string): string {
  let charset: string | null = null;

  if (contentType) {
    const match = contentType.match(/charset=([^;]+)/i);
    if (match) {
      charset = match[1].trim().replace(/^["']|["']$/g, "");
    }
  }

  if (!charset) {
    const snippet = buffer.subarray(0, 1024).toString("ascii");
    const xmlMatch = snippet.match(/<\?xml[^>]+encoding=["']([^"']+)["']/i);
    if (xmlMatch) {
      charset = xmlMatch[1].trim();
    }
  }

  if (charset) {
    try {
      return new TextDecoder(charset).decode(buffer);
    } catch {
      // If TextDecoder does not recognize the charset, fall back to utf-8
    }
  }

  return buffer.toString("utf8");
}
