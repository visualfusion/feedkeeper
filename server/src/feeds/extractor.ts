import { fetch as undiciFetch } from "undici";
import { createPublicDispatcher, SsrfBlockedError } from "./ssrfGuard.js";
import { assertPublicFeedUrl } from "./blockedHosts.js";
import type { Agent } from "undici";
import { articleWorkPool, ArticleHostBusyError, ArticleAccessDeniedError } from "./articleWorkPool.js";
import { parseRetryAfter } from "./fetcher.js";
import { sourceHost } from "./requestGate.js";
import { APP_VERSION } from "../version.js";
import { isConsentContent, isCachedConsentSnippet, type ExtractedArticle } from "./extractorParser.js";
import { parseArticleInWorker } from "./extractorPool.js";

export type { ExtractedArticle };
export { isConsentContent, isCachedConsentSnippet };

type ArticleFetch = typeof globalThis.fetch;
const defaultFetch = undiciFetch as unknown as ArticleFetch;

// Browser-like so article pages render normally, but identifies FeedKeeper honestly.
const FETCH_USER_AGENT = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 FeedKeeper/${APP_VERSION}`;
const FETCH_TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 5;
class ArticleHttpError extends Error { constructor(readonly status: number, readonly retryAt: number | undefined, readonly host: string) { super("article_http_error"); } }

const MAX_HTML_BYTES = 2 * 1024 * 1024;

async function fetchArticleHtml(rawUrl: string, signal: AbortSignal, dispatcher: Agent, fetchImpl: ArticleFetch, ownerSignal: AbortSignal): Promise<{ html: string; url: string } | null> {
  let currentUrl = rawUrl;

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    articleWorkPool().move(ownerSignal, sourceHost(currentUrl));
    const safeUrl = await assertPublicFeedUrl(currentUrl);
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
  | { status: "bot_blocked"; host: string }
  | { status: "paywall" | "timeout" | "failed" };

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
    const combinedSignal = AbortSignal.any([signal, controller.signal]);
    const fetched = await fetchArticleHtml(rawUrl, combinedSignal, dispatcher, fetchImpl, signal);
    if (!fetched) return { status: "failed" };

    return await parseArticleInWorker(fetched.html, fetched.url, combinedSignal);
  } catch (error) {
    if (error instanceof ArticleHostBusyError) return { status: "throttled", host: error.host, retryAt: error.retryAt, deferred: true };
    if (error instanceof SsrfBlockedError) throw error;
    if (signal.aborted || controller.signal.aborted || (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name))) return { status: "timeout" };
    if (error instanceof ArticleHttpError && [401, 402].includes(error.status)) return { status: "paywall" };
    if (error instanceof ArticleHttpError && [429, 503].includes(error.status)) return { status: "throttled", retryAt: error.retryAt, host: error.host };
    if (error instanceof ArticleHttpError && error.status === 403) return { status: "bot_blocked", host: error.host };
    return { status: "failed" };
  } finally {
    clearTimeout(timeout);
    dispatcher.destroy();
  }
}
