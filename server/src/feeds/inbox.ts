import { refreshLead } from "./lead.js";
import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import { hasUserCapability } from "../auth/capabilities.js";
import { configureFullTextPool, deferFullTextHost } from "./fullTextQueue.js";
import { extractArticle } from "./extractor.js";
import { assertPublicHttpUrl, normalizeUrlCandidate } from "./ssrfGuard.js";
import { articleImageUrls, pruneArchive, scheduleArchive } from "./archive.js";
import {
  findFeedById,
  findFeedByUrl,
  isUserSubscribed,
  findSubscriptionForUser,
  subscribe,
  bookmarkItem,
  findItemById,
  findItemForUser,
  setItemNote,
  type SubscribedFeed,
  type listItemsForUser,
} from "./repository.js";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export interface SaveToInboxInput {
  url?: string;
  title?: string;
  contentHtml?: string;
  textContent?: string;
  note?: string;
}

export function ensureUserInbox(userId: number): SubscribedFeed {
  const inboxUrl = `feedkeeper://inbox/${userId}`;
  let feed = findFeedByUrl(inboxUrl);
  if (!feed) {
    db.prepare(
      `INSERT INTO feeds (url, title, is_system_inbox, poll_interval_minutes)
       VALUES (?, 'Inbox', 1, 0)
       ON CONFLICT (url) DO UPDATE SET is_system_inbox = 1`,
    ).run(inboxUrl);
    feed = findFeedByUrl(inboxUrl)!;
  } else if (!feed.is_system_inbox) {
    db.prepare("UPDATE feeds SET is_system_inbox = 1 WHERE id = ?").run(feed.id);
    feed = findFeedById(feed.id)!;
  }

  if (!isUserSubscribed(userId, feed.id)) {
    subscribe(userId, feed.id, "Inbox");
  }

  const sub = findSubscriptionForUser(userId, feed!.id);
  if (!sub) {
    throw new Error("Failed to ensure user inbox subscription");
  }
  return sub;
}

export async function saveToInbox(
  userId: number,
  input: SaveToInboxInput,
): Promise<{ itemId: number; item: ReturnType<typeof listItemsForUser>[number]; hasNote: boolean }> {
  let targetUrl: string | null = null;
  let title: string | null = input.title?.trim() || null;
  let contentHtml: string | null = input.contentHtml?.trim() || null;
  let snippet: string | null = null;
  let extractionStatus = contentHtml ? "ready" : "pending";
  let extractedPartial = false;
  let imageUrl: string | null = null;

  if (input.url?.trim()) {
    const normalized = normalizeUrlCandidate(input.url.trim());
    await assertPublicHttpUrl(normalized);
    targetUrl = normalized;

    if (!contentHtml && hasUserCapability(userId, "fulltext")) {
      try {
        configureFullTextPool();
        const extracted = await extractArticle(targetUrl, undefined, 5, () => hasUserCapability(userId, "fulltext"));
        if (extracted.status === "throttled" && !extracted.deferred) deferFullTextHost(extracted.host, extracted.retryAt);
        if (extracted.status === "ok" || extracted.status === "partial") {
          extractionStatus = extracted.status === "ok" ? "ready" : "partial";
          extractedPartial = extracted.status === "partial";
          if (!title && extracted.article.title) {
            title = extracted.article.title;
          }
          contentHtml = extracted.article.contentHtml;
          snippet = extracted.article.excerpt ?? (extracted.article.textContent ? extracted.article.textContent.slice(0, 300) : null);
          const images = articleImageUrls(contentHtml, targetUrl);
          imageUrl = images[0] ?? null;
        }
      } catch (err) {
        console.warn(JSON.stringify({ event: "inbox_extraction_failed", error: err instanceof Error ? err.name : "unknown" }));
      }
    }
  }

  if (!contentHtml && input.textContent?.trim()) {
    const cleanText = input.textContent.trim();
    contentHtml = cleanText
      .split(/\n\s*\n/)
      .map((p) => `<p>${escapeHtml(p.trim())}</p>`)
      .join("\n");
    if (!snippet) {
      snippet = cleanText.slice(0, 300);
    }
  }

  if (!title) {
    title = targetUrl ?? (snippet ? snippet.slice(0, 80) : "Saved Clipping");
  }

  const inbox = ensureUserInbox(userId);
  const now = new Date().toISOString();
  const guid = targetUrl ? targetUrl : `urn:feedkeeper:inbox:${randomUUID()}`;

  const row = db
    .prepare(
      `INSERT INTO items (feed_id, guid, title, link, content_snippet, content_html, full_content_html, image_url, published_at, created_at, extraction_status, extraction_retry_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (feed_id, guid) DO UPDATE SET
         title = COALESCE(excluded.title, items.title),
         link = COALESCE(excluded.link, items.link),
         content_snippet = COALESCE(excluded.content_snippet, items.content_snippet),
         content_html = COALESCE(excluded.content_html, items.content_html),
         full_content_html = COALESCE(excluded.full_content_html, items.full_content_html),
         image_url = COALESCE(excluded.image_url, items.image_url),
         extraction_status = CASE WHEN COALESCE(excluded.full_content_html, items.full_content_html) IS NOT NULL THEN 'ready' ELSE excluded.extraction_status END,
         extraction_retry_at = excluded.extraction_retry_at
       RETURNING id`,
    )
    .get(inbox.id, guid, title, targetUrl, snippet, contentHtml, extractedPartial ? null : contentHtml, imageUrl, now, now,
      contentHtml && !extractedPartial ? "ready" : extractionStatus, extractedPartial ? new Date(Date.now() + 86400_000).toISOString() : null) as { id: number };

  const itemId = row.id;
  refreshLead(itemId);

  bookmarkItem(userId, itemId);

  let hasNote = false;
  if (input.note?.trim()) {
    setItemNote(userId, itemId, input.note.trim());
    hasNote = true;
  }

  scheduleArchive(itemId);

  const item = findItemForUser(userId, itemId);
  if (!item) {
    throw new Error("Item was saved but could not be retrieved");
  }

  return { itemId, item, hasNote };
}

export function deleteInboxItem(userId: number, itemId: number): boolean {
  const inbox = ensureUserInbox(userId);
  const item = findItemById(itemId);
  if (!item || item.feed_id !== inbox.id) {
    return false;
  }

  db.transaction(() => {
    db.prepare("DELETE FROM item_bookmarks WHERE item_id = ?").run(itemId);
    db.prepare("DELETE FROM item_reads WHERE item_id = ?").run(itemId);
    db.prepare("DELETE FROM item_progress WHERE item_id = ?").run(itemId);
    db.prepare("DELETE FROM item_notes WHERE item_id = ?").run(itemId);
    db.prepare("DELETE FROM items WHERE id = ?").run(itemId);
  })();

  pruneArchive();
  return true;
}
