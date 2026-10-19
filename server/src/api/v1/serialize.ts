import { contentMetadata, readerHtml } from "../../feeds/articleContent.js";
import { cleanSnippet } from "../../feeds/contentNoise.js";
import { leadOf } from "../../feeds/lead.js";
import { db } from "../../db/index.js";
import type { listItemsForUser, SubscribedFeed } from "../../feeds/repository.js";
import { serializeSubscription } from "../../sync/changeLog.js";

type ItemRow = ReturnType<typeof listItemsForUser>[number] & { bookmarked_at?: string | null; archived_at?: string | null };

/** A subscription as the list shows it: the synced fields plus counts and polling health. */
export function serializeSubscriptionDetail(subscription: SubscribedFeed) {
  return {
    ...serializeSubscription(subscription),
    folderName: subscription.folder_name,
    unreadCount: subscription.unread_count,
    lastPolledAt: subscription.last_polled_at,
    lastSuccessAt: subscription.last_success_at,
    lastError: subscription.last_error,
    consecutiveErrors: subscription.consecutive_errors,
  };
}

export function readingPositions(userId: number, itemIds: number[]): Map<number, number> {
  if (itemIds.length === 0) return new Map();
  const rows = db
    .prepare(`SELECT item_id, position FROM item_progress WHERE user_id = ? AND item_id IN (${itemIds.map(() => "?").join(",")})`)
    .all(userId, ...itemIds) as { item_id: number; position: number }[];
  return new Map(rows.map((row) => [row.item_id, row.position]));
}

export function serializeItem(row: ItemRow, progress: Map<number, number>, withContent: boolean, hasNote = false) {
  return {
    id: row.id,
    subscriptionId: row.feed_id,
    subscriptionTitle: row.feed_title,
    title: row.title,
    author: row.author ?? null,
    url: row.link,
    publishedAt: row.published_at,
    addedAt: row.created_at,
    snippet: cleanSnippet(row.content_snippet, row.title),
    lead: leadOf(row),
    imageUrl: row.image_url,
    hasFullText: Boolean(row.full_content_html),
    content: contentMetadata(row),
    ...(withContent ? { contentHtml: readerHtml(row.content_html, row.title, row.author), fullTextHtml: readerHtml(row.full_content_html, row.title, row.author) } : {}),
    state: {
      read: Boolean(row.read),
      saved: Boolean(row.bookmarked),
      savedAt: row.bookmarked_at ?? null,
      archivedAt: row.archived_at ?? null,
      progress: progress.get(row.id) ?? null,
      hasNote,
    },
  };
}
