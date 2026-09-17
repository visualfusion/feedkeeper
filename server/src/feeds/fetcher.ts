import { assertPublicHttpUrl } from "./ssrfGuard.js";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_REDIRECTS = 5;
const USER_AGENT = "Feedkeeper/1.0 (+https://github.com/visualfusion/feedkeeper)";

export interface FetchedFeed {
  body: string;
  etag?: string;
  lastModified?: string;
  notModified: boolean;
}

// Fetches a feed URL while re-validating every redirect hop against the SSRF
// guard, capping response size, and honoring conditional GET headers.
export async function fetchFeed(
  url: string,
  opts: { etag?: string; lastModified?: string } = {},
): Promise<FetchedFeed> {
  let currentUrl = url;

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const validated = await assertPublicHttpUrl(currentUrl);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const headers: Record<string, string> = {
      "User-Agent": USER_AGENT,
      Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5",
    };
    if (opts.etag) headers["If-None-Match"] = opts.etag;
    if (opts.lastModified) headers["If-Modified-Since"] = opts.lastModified;

    let response: Response;
    try {
      response = await fetch(validated, {
        headers,
        redirect: "manual",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`Redirect from ${currentUrl} without a Location header`);
      currentUrl = new URL(location, validated).toString();
      continue;
    }

    if (response.status === 304) {
      return { notModified: true, body: "" };
    }

    if (!response.ok) {
      throw new Error(`Feed responded with HTTP ${response.status}`);
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength && Number(contentLength) > MAX_RESPONSE_BYTES) {
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
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("Feed response exceeds the maximum allowed size");
      }
      chunks.push(value);
    }

    const body = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");

    return {
      body,
      notModified: false,
      etag: response.headers.get("etag") ?? undefined,
      lastModified: response.headers.get("last-modified") ?? undefined,
    };
  }

  throw new Error(`Too many redirects while fetching ${url}`);
}
