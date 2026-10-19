import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { fetch as undiciFetch } from "undici";
import { assertPublicHttpUrl, createPublicDispatcher, SsrfBlockedError } from "./ssrfGuard.js";
import type { Agent } from "undici";
import { articleWorkPool, ArticleHostBusyError, ArticleAccessDeniedError } from "./articleWorkPool.js";
import { parseRetryAfter } from "./fetcher.js";
import { sourceHost } from "./requestGate.js";
import { APP_VERSION } from "../version.js";

type ArticleFetch = typeof globalThis.fetch;
const defaultFetch = undiciFetch as unknown as ArticleFetch;

export interface ExtractedArticle {
  title: string | null;
  byline: string | null;
  contentHtml: string;
  textContent: string;
  excerpt: string | null;
  siteName: string | null;
}

const CONSENT_SELECTORS = [
  "#onetrust-consent-sdk",
  "#cmpbox",
  "#usercentrics-root",
  "[id*='sp_message_container']",
  "[class*='cookie-banner']",
  "[class*='cookie-consent']",
  "[class*='consent-banner']",
  "[id*='cookie-notice']",
  "[id*='cookie-banner']",
  ".qc-cmp2-container",
  "#didomi-host",
  "dialog[open]",
  ".cookie-wall",
  ".consent-wall",
  "[data-nosnippet]",
];

function cleanConsentDom(doc: Document): void {
  for (const sel of CONSENT_SELECTORS) {
    try {
      doc.querySelectorAll(sel).forEach((el) => el.remove());
    } catch {
      // ignore invalid selector in edge environments
    }
  }
}

function resolveLazyImages(doc: Document): void {
  const images = doc.querySelectorAll("img");
  for (const img of images) {
    const lazySrc =
      img.getAttribute("data-lazy-src") ||
      img.getAttribute("data-src") ||
      img.getAttribute("data-original") ||
      img.getAttribute("data-actualsrc");
    const src = img.getAttribute("src");
    if (lazySrc && (!src || src.startsWith("data:") || src.length < 10)) {
      img.setAttribute("src", lazySrc);
    }
    const lazySrcset = img.getAttribute("data-lazy-srcset") || img.getAttribute("data-srcset");
    const srcset = img.getAttribute("srcset");
    if (lazySrcset && (!srcset || srcset.startsWith("data:"))) {
      img.setAttribute("srcset", lazySrcset);
    }
  }
  const sources = doc.querySelectorAll("source");
  for (const source of sources) {
    const lazySrcset = source.getAttribute("data-lazy-srcset") || source.getAttribute("data-srcset");
    if (lazySrcset) {
      source.setAttribute("srcset", lazySrcset);
    }
  }
}

/**
 * Checks if a given URL or extracted HTML/text is a cookie / consent wall rather than article content.
 */
export function isConsentContent(finalUrl: string, html: string, title?: string | null, text?: string | null): boolean {
  if (
    /\/zustimmung[/?]/i.test(finalUrl) ||
    /\/consent[/?]/i.test(finalUrl) ||
    /\/cookie-wall/i.test(finalUrl) ||
    /\/pur-abo[/?]/i.test(finalUrl) ||
    /\/cmp[/?]/i.test(finalUrl) ||
    /\/privacy-wall/i.test(finalUrl)
  ) {
    return true;
  }

  const combined = `${title || ""} ${text || ""} ${html}`.toLowerCase();
  const strongSignatures = [
    "cookies zustimmen",
    "nutzung aller cookies",
    "tracking zustimmen",
    "einwilligung verwalten",
    "werbung und tracking, indem sie",
    "zustimmen & weiter",
    "bevor sie fortfahren",
    "accept all cookies",
    "cookie-einstellungen",
    "alle cookies akzeptieren",
    "cookies akzeptieren",
    "we value your privacy",
  ];

  const headText = `${title || ""} ${text || ""}`.toLowerCase().slice(0, 600);

  const hits = strongSignatures.filter(sig => combined.includes(sig));
  if (hits.length === 0) return false;
  const heading = (title || "").toLowerCase();
  if (strongSignatures.some(sig => heading.includes(sig))) return true;
  return (text || "").length < 1200 && hits.length >= 2 && hits.some(sig => headText.includes(sig));
}

/**
 * Checks cached HTML to see if it was a saved consent banner instead of real article content.
 */
export function isCachedConsentSnippet(html: string): boolean {
  return isConsentContent("", html, "", html.replace(/<[^>]+>/g, " "));
}

// Browser-like so article pages render normally, but identifies FeedKeeper honestly.
const FETCH_USER_AGENT = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 FeedKeeper/${APP_VERSION}`;
const FETCH_TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 5;
class ArticleHttpError extends Error { constructor(readonly status: number, readonly retryAt: number | undefined, readonly host: string) { super("article_http_error"); } }

const MAX_HTML_BYTES = 2 * 1024 * 1024;

function stripHeavyTags(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, "")
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "")
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, "");
}

async function fetchArticleHtml(rawUrl: string, signal: AbortSignal, dispatcher: Agent, fetchImpl: ArticleFetch, ownerSignal: AbortSignal): Promise<{ html: string; url: string } | null> {
  let currentUrl = rawUrl;

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    articleWorkPool().move(ownerSignal, sourceHost(currentUrl));
    const safeUrl = await assertPublicHttpUrl(currentUrl);
    signal.throwIfAborted();
    const response = await fetchImpl(safeUrl, {
      signal,
      headers: {
        "User-Agent": FETCH_USER_AGENT,
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        // Article URLs already point to one language; don't prefer any locale.
        "Accept-Language": "*",
        "Cache-Control": "no-cache",
      },
      redirect: "manual",
      dispatcher,
    } as RequestInit & { dispatcher: Agent });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) return null;
      currentUrl = new URL(location, safeUrl).toString();
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new ArticleHttpError(response.status, parseRetryAfter(response.headers.get("retry-after")), sourceHost(safeUrl.toString())); }

    const contentLength = Number(response.headers.get("content-length"));
    if (contentLength > MAX_HTML_BYTES) { await response.body?.cancel(); return null; }

    const reader = response.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_HTML_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }

    const html = new TextDecoder().decode(Buffer.concat(chunks, total));
    return { html, url: safeUrl.toString() };
  }

  return null;
}

export type ExtractionResult =
  | { status: "ok"; article: ExtractedArticle }
  | { status: "consent_wall" }
  | { status: "partial"; article: ExtractedArticle }
  | { status: "throttled"; retryAt?: number; host: string; deferred?: boolean }
  | { status: "paywall" | "bot_blocked" | "timeout" | "failed" };

export async function extractArticleFromUrl(rawUrl: string, fetchImpl: ArticleFetch = defaultFetch): Promise<ExtractedArticle | null> {
  const result = await extractArticle(rawUrl, fetchImpl);
  return result.status === "ok" ? result.article : null;
}

/** Like extractArticleFromUrl, but reports whether the site answered with a consent wall. */
export async function extractArticle(rawUrl: string, fetchImpl: ArticleFetch = defaultFetch, priority = 5, authorized: () => boolean = () => true): Promise<ExtractionResult> {
  return articleWorkPool().run(sourceHost(rawUrl), signal => {
    if (!authorized()) throw new ArticleAccessDeniedError();
    return extractArticleContent(rawUrl, fetchImpl, signal);
  }, priority);
}

async function extractArticleContent(rawUrl: string, fetchImpl: ArticleFetch, signal: AbortSignal): Promise<ExtractionResult> {
  signal.throwIfAborted();
  const dispatcher = createPublicDispatcher();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const fetched = await fetchArticleHtml(rawUrl, AbortSignal.any([signal, controller.signal]), dispatcher, fetchImpl, signal);
    if (!fetched) return { status: "failed" };

    const cleanedHtml = stripHeavyTags(fetched.html);
    const dom = new JSDOM(cleanedHtml, { url: fetched.url });
    let parsed;
    try {
      const paywall = /"isAccessibleForFree"\s*:\s*(?:false|"false")/i.test(fetched.html);
      cleanConsentDom(dom.window.document);
      resolveLazyImages(dom.window.document);

      parsed = new Readability(dom.window.document, { charThreshold: 60 }).parse();
      if (isConsentContent(fetched.url, parsed?.content ?? fetched.html, parsed?.title, parsed?.textContent)) {
        return { status: "consent_wall" };
      }
      if (paywall || ((parsed?.textContent?.length ?? 0) < 2500 && /(?:subscribe to (?:continue|read)|sign in to (?:continue|read)|abonnieren und weiterlesen|nur für abonnenten|jetzt abonnieren.{0,40}weiterlesen)/i.test(parsed?.textContent ?? ""))) return { status: "paywall" };
      if (!parsed?.content) return { status: "failed" };
    } finally {
      dom.window.close();
    }

    return {
      status: (parsed.textContent?.trim().length ?? 0) < 200 ? "partial" : "ok",
      article: {
        title: parsed.title || null,
        byline: parsed.byline || null,
        contentHtml: parsed.content,
        textContent: parsed.textContent || "",
        excerpt: parsed.excerpt || null,
        siteName: parsed.siteName || null,
      },
    };
  } catch (error) {
    if (error instanceof ArticleHostBusyError) return { status: "throttled", host: error.host, retryAt: error.retryAt, deferred: true };
    if (error instanceof SsrfBlockedError) throw error;
    if (signal.aborted || controller.signal.aborted) return { status: "timeout" };
    if (error instanceof ArticleHttpError && [401, 402].includes(error.status)) return { status: "paywall" };
    if (error instanceof ArticleHttpError && [429, 503].includes(error.status)) return { status: "throttled", retryAt: error.retryAt, host: error.host };
    if (error instanceof ArticleHttpError && error.status === 403) return { status: "bot_blocked" };
    return { status: "failed" };
  } finally {
    clearTimeout(timeout);
    dispatcher.destroy();
  }
}
