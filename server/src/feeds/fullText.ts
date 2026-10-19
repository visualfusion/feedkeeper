import { extractArticle, isCachedConsentSnippet } from "./extractor.js";
import { hasUserCapability } from "../auth/capabilities.js";
import { db } from "../db/index.js";
import { articleWorkPool, ArticleWorkBusyError, ArticleAccessDeniedError, ArticleHostBusyError } from "./articleWorkPool.js";
import { requestFullText, authorizedFullTextRequester } from "./fullTextQueue.js";
import { SsrfBlockedError } from "./ssrfGuard.js";
import { improvesContent } from "./articleContent.js";
import { refreshLead } from "./lead.js";
import { canAccessItem, findItemById, findSubscriptionFullTextMode, updateItemFullContent } from "./repository.js";

// Kept for integrations importing the old constant; retries now belong to individual articles.
export const FULL_TEXT_BLOCK_THRESHOLD = 2;
export type FullTextError = "capability_not_available" | "item_not_found" | "item_has_no_link" | "full_text_disabled" | "consent_wall" |
  "paywall" | "bot_blocked" | "timeout" | "partial" | "could_not_extract_content" | "extraction_failed" | "queue_full" | "source_busy";
export type FullTextResult =
  | { ok: true; id: number; fullContentHtml: string; title?: string | null; byline?: string | null; cached: boolean }
  | { ok: false; error: FullTextError; message?: string; retryAt?: number; retryable?: boolean; host?: string; deferred?: boolean };

function recordAttempt(id: number, status: string) {
  const blocked = ["paywall", "consent_wall"].includes(status);
  const retry = status === "ready" || status === "feed_only" ? null :
    new Date(Date.now() + (blocked ? 7 * 86400_000 : status === "partial" ? 86400_000 : 3600_000)).toISOString();
  db.prepare("UPDATE items SET extraction_status = ?, extraction_attempted_at = ?, extraction_retry_at = ? WHERE id = ?")
    .run(status, new Date().toISOString(), retry, id);
}

/** All callers share bounded host-aware extraction, cache quality and per-article retry policy. */
export function cachedFullText(userId: number, itemId: number, force = false): FullTextResult | undefined {
  const item = findItemById(itemId);
  const mode = item ? findSubscriptionFullTextMode(userId, item.feed_id) ?? (canAccessItem(userId, itemId) ? "auto" : undefined) : undefined;
  if (!item || !mode) return { ok: false, error: "item_not_found" };
  if (item.full_content_html && isCachedConsentSnippet(item.full_content_html)) {
    // Repair cached walls before any caller can mistake them for reader content again.
    db.prepare("UPDATE items SET full_content_html = NULL, extraction_status = 'pending', extraction_retry_at = NULL WHERE id = ?").run(itemId);
    refreshLead(itemId);
    item.full_content_html = null;
  }
  if (!force && item.full_content_html && !isCachedConsentSnippet(item.full_content_html)) {
    return { ok: true, id: item.id, fullContentHtml: item.full_content_html, cached: true };
  }
  if (!item.link) return { ok: false, error: "item_has_no_link" };
  if (mode === "never") return { ok: false, error: "full_text_disabled" };
  if (!force && item.extraction_status === "feed_only") return { ok: true, id: itemId, fullContentHtml: item.content_html ?? "", cached: true };
  if (!force && item.extraction_retry_at && Date.parse(item.extraction_retry_at) > Date.now() && !db.prepare("SELECT 1 FROM full_text_jobs WHERE item_id=?").get(itemId)) {
    const status = item.extraction_status;
    return { ok: false, error: ["consent_wall", "paywall", "bot_blocked", "timeout", "partial"].includes(status) ? status as FullTextError : "could_not_extract_content" };
  }
  if (!hasUserCapability(userId, "fulltext")) return { ok: false, error: "capability_not_available" };
  return undefined;
}

export async function loadFullText(userId: number, itemId: number, options: { force?: boolean } = {}): Promise<FullTextResult> {
  return cachedFullText(userId, itemId, options.force) ?? requestFullText(userId, itemId, options.force ?? false);
}

export async function executeFullText(userId: number, itemId: number, force: boolean, priority: number): Promise<FullTextResult> {
  const requester = authorizedFullTextRequester(itemId, userId);
  if (requester === undefined) return { ok: false, error: "capability_not_available" };
  const cached = cachedFullText(requester, itemId, force);
  if (cached) return cached;
  const item = findItemById(itemId)!;
  try {
    const result = await extractArticle(item.link!, undefined, priority, () => authorizedFullTextRequester(itemId, userId) !== undefined);
    if (articleWorkPool().isClosing) return { ok: false, error: "queue_full" };
    if (authorizedFullTextRequester(itemId, userId) === undefined) return { ok: false, error: "capability_not_available" };
    if (result.status === "throttled") return { ok: false, error: "source_busy", retryable: true, retryAt: result.retryAt, host: result.host, deferred: result.deferred };
    if (result.status !== "ok") {
      recordAttempt(itemId, result.status);
      return { ok: false, error: result.status === "failed" ? "could_not_extract_content" : result.status,
        ...(result.status === "failed" || result.status === "timeout" ? { retryable: true } : {}) };
    }
    const current = findItemById(itemId);
    if (!current || current.link !== item.link) return { ok: false, error: "item_not_found" };
    if (improvesContent(current, result.article.contentHtml)) {
      db.transaction(() => { updateItemFullContent(itemId, result.article.contentHtml); recordAttempt(itemId, "ready"); })();
    } else recordAttempt(itemId, current.full_content_html ? "ready" : "feed_only");
    return { ok: true, id: itemId, fullContentHtml: findItemById(itemId)!.full_content_html || current.content_html || "",
      title: result.article.title, byline: result.article.byline, cached: false };
  } catch (error) {
    if (error instanceof SsrfBlockedError) return { ok: false, error: "extraction_failed" };
    if (error instanceof ArticleHostBusyError) return { ok: false, error: "source_busy", retryable: true, deferred: true, host: error.host, retryAt: error.retryAt };
    if (error instanceof ArticleAccessDeniedError) return { ok: false, error: "capability_not_available" };
    if (articleWorkPool().isClosing || error instanceof ArticleWorkBusyError) return { ok: false, error: "queue_full", retryable: true };
    if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) {
      recordAttempt(itemId, "timeout");
      return { ok: false, error: "timeout", retryable: true };
    }
    recordAttempt(itemId, "failed");
    return { ok: false, error: "extraction_failed", retryable: true };
  }
}
