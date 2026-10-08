import { db } from "../db/index.js";
import { articleText } from "./articleContent.js";
import { decodeEntities } from "./text.js";

export interface Feed {
  id: number;
  url: string;
  title: string | null;
  site_url: string | null;
  poll_interval_minutes: number;
  last_polled_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  consecutive_errors: number;
  etag: string | null;
  last_modified: string | null;
  full_text_blocks: number;
  full_text_blocked_at: string | null;
  icon_url: string | null;
  icon_checked_at: string | null;
  is_system_inbox: number;
  created_at: string;
}

export type FullTextMode = "auto" | "never";

export interface Item {
  id: number;
  feed_id: number;
  guid: string;
  title: string | null;
  link: string | null;
  content_snippet: string | null;
  content_html: string | null;
  full_content_html: string | null;
  content_revision: number;
  extraction_status: string;
  extraction_attempted_at: string | null;
  extraction_retry_at: string | null;
  image_url: string | null;
  published_at: string | null;
  created_at: string;
}

export interface Folder {
  id: number;
  user_id: number;
  name: string;
  icon_symbol: string | null;
  created_at: string;
}

export interface SubscribedFeed extends Feed {
  subscription_id: number;
  label: string | null;
  folder_id: number | null;
  folder_name: string | null;
  unread_count: number;
  position: number;
  full_text_mode: FullTextMode;
  notify: number;
  badge: number;
  icon_hash?: string | null;
}

export interface ItemNote {
  user_id: number;
  item_id: number;
  content: string;
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface NoteConflictState {
  itemId: number;
  content: string | null;
  revision: number;
  createdAt: string | null;
  updatedAt: string | null;
  deleted: boolean;
}

export type { ServerEdition as CuratedEdition } from "../native/editions.js";

export interface MutedKeyword {
  id: number;
  user_id: number;
  keyword: string;
  created_at: string;
}

export function findFeedByUrl(url: string): Feed | undefined {
  return db.prepare<[string], Feed>("SELECT * FROM feeds WHERE url = ?").get(url);
}

export function findFeedById(id: number): Feed | undefined {
  return db.prepare<[number], Feed>("SELECT * FROM feeds WHERE id = ?").get(id);
}

export function createFeed(url: string, pollIntervalMinutes: number): Feed {
  const result = db
    .prepare("INSERT INTO feeds (url, poll_interval_minutes) VALUES (?, ?)")
    .run(url, pollIntervalMinutes);
  return findFeedById(Number(result.lastInsertRowid))!;
}

export function subscribe(
  userId: number,
  feedId: number,
  label?: string | null,
  folderId?: number | null,
): number {
  const maxPosRow = db
    .prepare<[number], { max_pos: number | null }>(
      "SELECT MAX(position) AS max_pos FROM subscriptions WHERE user_id = ?",
    )
    .get(userId);
  const nextPosition = (maxPosRow?.max_pos ?? -1) + 1;

  const result = db
    .prepare(
      `INSERT INTO subscriptions (user_id, feed_id, label, folder_id, position) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id, feed_id) DO UPDATE SET
         label = COALESCE(excluded.label, subscriptions.label),
         folder_id = COALESCE(excluded.folder_id, subscriptions.folder_id)`,
    )
    .run(userId, feedId, label?.trim() || null, folderId ?? null, nextPosition);
  return Number(result.lastInsertRowid);
}

export function unsubscribe(userId: number, feedId: number): void {
  db.transaction(() => {
    db.prepare("DELETE FROM subscriptions WHERE user_id = ? AND feed_id = ?").run(userId, feedId);
    removeFeedIfUnused(feedId);
  })();
}

/**
 * Once nobody subscribes to a feed, drop it with its items — except saved articles:
 * their feed stays (unpolled) so the archive keeps its source and title.
 */
export function removeFeedIfUnused(feedId: number): void {
  if (countFeedSubscribers(feedId) > 0) return;
  db.prepare(
    `DELETE FROM items WHERE feed_id = ? AND id NOT IN (SELECT item_id FROM item_bookmarks) AND id NOT IN (SELECT item_id FROM item_notes)
      AND NOT EXISTS (SELECT 1 FROM editions e, json_each(e.item_ids) selected
        WHERE selected.value = items.id AND e.status = 'active' AND julianday(e.expires_at) > julianday('now'))`,
  ).run(feedId);
  db.prepare("DELETE FROM feeds WHERE id = ? AND is_system_inbox = 0 AND NOT EXISTS (SELECT 1 FROM items WHERE feed_id = ?)").run(feedId, feedId);
}

/** Feeds kept only for saved articles or annotated articles whose last bookmark and note are gone. */
export function removeUnusedFeeds(): number {
  return db.prepare(
    `DELETE FROM feeds
     WHERE is_system_inbox = 0
       AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.feed_id = feeds.id)
       AND NOT EXISTS (SELECT 1 FROM items i JOIN item_bookmarks b ON b.item_id = i.id WHERE i.feed_id = feeds.id)
       AND NOT EXISTS (SELECT 1 FROM items i JOIN item_notes n ON n.item_id = i.id WHERE i.feed_id = feeds.id)
       AND NOT EXISTS (SELECT 1 FROM items i, editions e, json_each(e.item_ids) selected
         WHERE i.feed_id = feeds.id AND selected.value = i.id AND e.status = 'active' AND julianday(e.expires_at) > julianday('now'))`,
  ).run().changes;
}

/** Subscribers can open every item of their feeds; anyone can open what they saved or added a note to. */
export function canAccessItem(userId: number, itemId: number): boolean {
  return Boolean(
    db.prepare(
      `SELECT 1 FROM items i
       WHERE i.id = ?
         AND (EXISTS (SELECT 1 FROM subscriptions s WHERE s.feed_id = i.feed_id AND s.user_id = ?)
           OR EXISTS (SELECT 1 FROM item_bookmarks b WHERE b.item_id = i.id AND b.user_id = ?)
           OR EXISTS (SELECT 1 FROM item_notes n WHERE n.item_id = i.id AND n.user_id = ?)
           OR EXISTS (SELECT 1 FROM editions e, json_each(e.item_ids) selected WHERE e.user_id = ?
             AND selected.value = i.id AND e.status = 'active' AND julianday(e.expires_at) > julianday('now')))`,
    ).get(itemId, userId, userId, userId, userId),
  );
}

export function listSubscriptionsForUser(userId: number): SubscribedFeed[] {
  return db
    .prepare<[number, number], SubscribedFeed>(
      `SELECT
         f.*,
         fi.hash AS icon_hash,
         s.id AS subscription_id,
         NULLIF(TRIM(s.label), '') AS label,
         s.folder_id AS folder_id,
         fo.name AS folder_name,
         s.position AS position,
         s.full_text_mode AS full_text_mode,
         s.notify AS notify,
         s.badge AS badge,
         (
           SELECT COUNT(*) FROM items i
           WHERE i.feed_id = f.id
             AND NOT EXISTS (
               SELECT 1 FROM item_reads r WHERE r.item_id = i.id AND r.user_id = ?
             )
         ) AS unread_count
       FROM subscriptions s
       JOIN feeds f ON f.id = s.feed_id
       LEFT JOIN feed_icons fi ON fi.feed_id = f.id
       LEFT JOIN folders fo ON fo.id = s.folder_id
       WHERE s.user_id = ?
       ORDER BY s.position ASC, s.created_at ASC`,
    )
    .all(userId, userId);
}

export function isUserSubscribed(userId: number, feedId: number): boolean {
  const row = db
    .prepare<[number, number], { count: number }>(
      "SELECT COUNT(*) AS count FROM subscriptions WHERE user_id = ? AND feed_id = ?",
    )
    .get(userId, feedId)!;
  return row.count > 0;
}

/** The accounts that subscribe to a feed. */
export function listSubscriberIds(feedId: number): number[] {
  return db.prepare<[number], { user_id: number }>("SELECT user_id FROM subscriptions WHERE feed_id = ?").all(feedId).map((row) => row.user_id);
}

export function listFeedsDueForPoll(): Feed[] {
  return db
    .prepare<[], Feed>(
      `SELECT * FROM feeds
       WHERE is_system_inbox = 0
         AND EXISTS (SELECT 1 FROM subscriptions s WHERE s.feed_id = feeds.id)
         AND (last_polled_at IS NULL
          OR last_polled_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-' || poll_interval_minutes || ' minutes'))`,
    )
    .all();
}

export function updateFeedAfterPoll(
  feedId: number,
  data: { title?: string; siteUrl?: string; etag?: string; lastModified?: string; error?: string | null },
): void {
  if (data.error) {
    db.prepare(
      `UPDATE feeds SET
         last_error = ?,
         consecutive_errors = consecutive_errors + 1,
         last_polled_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`,
    ).run(data.error, feedId);
  } else {
    db.prepare(
      `UPDATE feeds SET
         title = COALESCE(?, title),
         site_url = COALESCE(?, site_url),
         etag = COALESCE(?, etag),
         last_modified = COALESCE(?, last_modified),
         last_error = NULL,
         consecutive_errors = 0,
         last_success_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
         last_polled_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`,
    ).run(data.title ?? null, data.siteUrl ?? null, data.etag ?? null, data.lastModified ?? null, feedId);
  }
}

export function upsertItems(
  feedId: number,
  items: Array<{
    guid: string;
    title?: string;
    link?: string;
    contentSnippet?: string;
    contentHtml?: string | null;
    publishedAt?: string;
    imageUrl?: string | null;
  }>,
): number {
  const insert = db.prepare(
    `INSERT INTO items (feed_id, guid, title, link, content_snippet, content_html, published_at, image_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (feed_id, guid) DO NOTHING`,
  );
  const update = db.prepare(
    `UPDATE items SET
       title = COALESCE(?, title),
       link = COALESCE(?, link),
       content_snippet = COALESCE(?, content_snippet),
       content_html = COALESCE(?, content_html),
       published_at = COALESCE(?, published_at),
       image_url = COALESCE(?, image_url)
     WHERE feed_id = ? AND guid = ?`,
  );
  const insertMany = db.transaction((rows: typeof items) => {
    let inserted = 0;
    for (const row of rows) {
      const values = [
        feedId,
        row.guid,
        row.title ?? null,
        row.link ?? null,
        row.contentSnippet ?? null,
        row.contentHtml ?? null,
        row.publishedAt ?? null,
        row.imageUrl ?? null,
      ] as const;
      const result = insert.run(...values);
      if (result.changes > 0) {
        inserted++;
      } else {
        const previous = db.prepare<[number, string], { content_html: string | null }>("SELECT content_html FROM items WHERE feed_id = ? AND guid = ?").get(feedId, row.guid);
        const next = row.contentHtml;
        // Some publishers replace complete feed bodies with short teasers on a later poll.
        const retained = previous?.content_html && next && next.length < previous.content_html.length * 0.9 &&
          articleText(next).length < articleText(previous.content_html).length * 0.9 ? previous.content_html : next ?? null;
        update.run(row.title ?? null, row.link ?? null, row.contentSnippet ?? null, retained, row.publishedAt ?? null, row.imageUrl ?? null, feedId, row.guid);
      }
    }
    return inserted;
  });
  return insertMany(items);
}

export function listItemsForUser(
  userId: number,
  opts: {
    feedId?: number;
    folderId?: number;
    unreadOnly?: boolean;
    bookmarkedOnly?: boolean;
    includeMuted?: boolean;
    search?: string;
    limit?: number;
    offset?: number;
    since?: string;
    publishedSince?: string;
    publishedUntil?: string;
    before?: { createdAt: string; id: number };
    after?: { createdAt: string; id: number };
    sortByAdded?: boolean;
  } = {},
): (Item & {
  read: boolean;
  bookmarked: boolean;
  feed_title: string | null;
  feed_site_url: string | null;
  feed_url: string;
  feed_full_text_mode: FullTextMode;
  feed_icon_url: string | null;
  bookmarked_at: string | null;
})[] {
  // Saved articles stay visible without a subscription (e.g. after unsubscribing).
  const conditions: string[] = ["(s.id IS NOT NULL OR b.item_id IS NOT NULL)"];
  const params: unknown[] = [];

  if (opts.feedId) {
    conditions.push("i.feed_id = ?");
    params.push(opts.feedId);
  }
  if (opts.folderId) {
    conditions.push("s.folder_id = ?");
    params.push(opts.folderId);
  }
  if (opts.unreadOnly) {
    conditions.push("r.item_id IS NULL");
  }
  if (opts.bookmarkedOnly) {
    conditions.push("b.item_id IS NOT NULL");
  }
  // The word filter tidies the stream; it never hides what the user deliberately saved.
  if (!opts.includeMuted && !opts.bookmarkedOnly) {
    conditions.push(
      `NOT EXISTS (
        SELECT 1 FROM user_muted_keywords m
        WHERE m.user_id = ?
          AND (
            INSTR(LOWER(COALESCE(i.title, '')), LOWER(m.keyword)) > 0
            OR INSTR(LOWER(COALESCE(i.content_snippet, '')), LOWER(m.keyword)) > 0
          )
      )`,
    );
    params.push(userId);
  }
  if (opts.search) {
    // Saved articles are searched in their archived full text too.
    const fields = ["i.title", "i.content_snippet", ...(opts.bookmarkedOnly ? ["i.full_content_html", "i.content_html"] : [])];
    conditions.push(
      `(${fields.map((field) => `INSTR(LOWER(COALESCE(${field}, '')), LOWER(?)) > 0`).join(" OR ")} OR i.id IN (SELECT item_id FROM item_notes WHERE user_id = ? AND INSTR(LOWER(content), LOWER(?)) > 0))`,
    );
    params.push(...fields.map(() => opts.search), userId, opts.search);
  }
  if (opts.since) {
    conditions.push("i.created_at > ?");
    params.push(opts.since);
  }
  // Feeds without a parseable publish date fall back to when FeedKeeper stored the item.
  if (opts.publishedSince) {
    conditions.push("COALESCE(julianday(i.published_at), julianday(i.created_at)) >= julianday(?)");
    params.push(opts.publishedSince);
  }
  if (opts.publishedUntil) {
    conditions.push("COALESCE(julianday(i.published_at), julianday(i.created_at)) <= julianday(?)");
    params.push(opts.publishedUntil);
  }
  if (opts.before) {
    conditions.push("(i.created_at < ? OR (i.created_at = ? AND i.id < ?))");
    params.push(opts.before.createdAt, opts.before.createdAt, opts.before.id);
  }
  if (opts.after) {
    conditions.push("(i.created_at > ? OR (i.created_at = ? AND i.id > ?))");
    params.push(opts.after.createdAt, opts.after.createdAt, opts.after.id);
  }

  const limit = Math.min(opts.limit ?? 50, 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  params.push(limit, offset);

  return db
    .prepare(
      `SELECT DISTINCT i.*,
              COALESCE(NULLIF(TRIM(s.label), ''), NULLIF(TRIM(f.title), ''), f.url) AS feed_title,
              f.site_url AS feed_site_url,
              f.url AS feed_url,
              s.full_text_mode AS feed_full_text_mode,
              f.icon_url AS feed_icon_url,
              (r.item_id IS NOT NULL) AS read,
              (b.item_id IS NOT NULL) AS bookmarked,
              b.created_at AS bookmarked_at
       FROM items i
       JOIN feeds f ON f.id = i.feed_id
       LEFT JOIN subscriptions s ON s.feed_id = i.feed_id AND s.user_id = ?
       LEFT JOIN item_reads r ON r.item_id = i.id AND r.user_id = ?
       LEFT JOIN item_bookmarks b ON b.item_id = i.id AND b.user_id = ?
       WHERE ${conditions.join(" AND ")}
       ORDER BY ${opts.sortByAdded ? "i.created_at DESC, i.id DESC" : opts.bookmarkedOnly ? "b.created_at DESC, i.id DESC" : "i.published_at DESC, i.created_at DESC, i.id DESC"}
       LIMIT ? OFFSET ?`,
    )
    .all(userId, userId, userId, ...params) as (Item & {
      read: boolean;
      bookmarked: boolean;
      feed_title: string | null;
      feed_site_url: string | null;
      feed_url: string;
      feed_full_text_mode: FullTextMode;
      feed_icon_url: string | null;
      bookmarked_at: string | null;
    })[];
}

export function findItemForUser(userId: number, itemId: number): ReturnType<typeof listItemsForUser>[number] | undefined {
  return db.prepare<[number, number, number, number, number, number], ReturnType<typeof listItemsForUser>[number]>(
    `SELECT i.*, COALESCE(NULLIF(TRIM(s.label), ''), NULLIF(TRIM(f.title), ''), f.url) AS feed_title,
            f.site_url AS feed_site_url, f.url AS feed_url, s.full_text_mode AS feed_full_text_mode, f.icon_url AS feed_icon_url,
            (r.item_id IS NOT NULL) AS read, (b.item_id IS NOT NULL) AS bookmarked, b.created_at AS bookmarked_at
     FROM items i
     JOIN feeds f ON f.id = i.feed_id
     LEFT JOIN subscriptions s ON s.feed_id = i.feed_id AND s.user_id = ?
     LEFT JOIN item_reads r ON r.item_id = i.id AND r.user_id = ?
     LEFT JOIN item_bookmarks b ON b.item_id = i.id AND b.user_id = ?
     LEFT JOIN item_notes n ON n.item_id = i.id AND n.user_id = ?
     WHERE i.id = ? AND (s.id IS NOT NULL OR b.item_id IS NOT NULL OR n.item_id IS NOT NULL OR
       EXISTS (SELECT 1 FROM editions e, json_each(e.item_ids) selected WHERE e.user_id = ?
         AND selected.value = i.id AND e.status = 'active' AND julianday(e.expires_at) > julianday('now')))`,
  ).get(userId, userId, userId, userId, itemId, userId);
}

export function updateSubscriptionLabel(userId: number, feedId: number, label: string | null): void {
  db.prepare("UPDATE subscriptions SET label = ? WHERE user_id = ? AND feed_id = ?").run(label?.trim() || null, userId, feedId);
}

export function updateSubscriptionFolder(userId: number, feedId: number, folderId: number | null): void {
  db.prepare("UPDATE subscriptions SET folder_id = ? WHERE user_id = ? AND feed_id = ?").run(
    folderId,
    userId,
    feedId,
  );
}

export function listFoldersForUser(userId: number): (Folder & { feed_count: number; unread_count: number })[] {
  return db
    .prepare<[number, number, number], Folder & { feed_count: number; unread_count: number }>(
      `SELECT
         fo.*,
         COUNT(DISTINCT s.feed_id) AS feed_count,
         COALESCE(
           (
             SELECT COUNT(*)
             FROM items i
             JOIN subscriptions s2 ON s2.feed_id = i.feed_id AND s2.folder_id = fo.id AND s2.user_id = ?
             WHERE NOT EXISTS (
               SELECT 1 FROM item_reads r WHERE r.item_id = i.id AND r.user_id = ?
             )
           ), 0
         ) AS unread_count
       FROM folders fo
       LEFT JOIN subscriptions s ON s.folder_id = fo.id AND s.user_id = fo.user_id
       WHERE fo.user_id = ?
       GROUP BY fo.id
       ORDER BY fo.name COLLATE NOCASE ASC`,
    )
    .all(userId, userId, userId);
}

export function findFolderByName(userId: number, name: string): Folder | undefined {
  return db
    .prepare<[number, string], Folder>("SELECT * FROM folders WHERE user_id = ? AND name = ?")
    .get(userId, name.trim());
}

export function findFolderById(userId: number, id: number): Folder | undefined {
  return db
    .prepare<[number, number], Folder>("SELECT * FROM folders WHERE user_id = ? AND id = ?")
    .get(userId, id);
}

export function createFolder(userId: number, name: string, iconSymbol?: string | null): Folder {
  const trimmed = name.trim();
  db.prepare("INSERT INTO folders (user_id, name, icon_symbol) VALUES (?, ?, ?) ON CONFLICT (user_id, name) DO NOTHING").run(
    userId,
    trimmed,
    iconSymbol ?? null,
  );
  return findFolderByName(userId, trimmed)!;
}

export function updateFolder(userId: number, id: number, updates: { name?: string; iconSymbol?: string | null } | string): Folder {
  const data = typeof updates === "string" ? { name: updates } : updates;
  const current = findFolderById(userId, id);
  if (!current) throw new Error("Folder not found");
  const name = data.name !== undefined ? data.name.trim() : current.name;
  const iconSymbol = data.iconSymbol !== undefined ? data.iconSymbol : current.icon_symbol;
  db.prepare("UPDATE folders SET name = ?, icon_symbol = ? WHERE id = ? AND user_id = ?").run(name, iconSymbol, id, userId);
  return findFolderById(userId, id)!;
}

export function deleteFolder(userId: number, id: number): void {
  db.prepare("DELETE FROM folders WHERE id = ? AND user_id = ?").run(id, userId);
}

export function updateFeedPollInterval(feedId: number, minutes: number): void {
  db.prepare("UPDATE feeds SET poll_interval_minutes = ? WHERE id = ?").run(minutes, feedId);
}

export function markAllRead(userId: number, filter?: number | { feedId?: number; folderId?: number }): number {
  const feedId = typeof filter === "number" ? filter : filter?.feedId;
  const folderId = typeof filter === "object" ? filter?.folderId : undefined;
  const conditions = ["s.user_id = ?"];
  const params: unknown[] = [userId, userId];

  if (feedId) {
    conditions.push("i.feed_id = ?");
    params.push(feedId);
  }
  if (folderId) {
    conditions.push("s.folder_id = ?");
    params.push(folderId);
  }

  const result = db
    .prepare(
      `INSERT INTO item_reads (user_id, item_id)
       SELECT ?, i.id
       FROM items i
       JOIN subscriptions s ON s.feed_id = i.feed_id
       WHERE ${conditions.join(" AND ")}
         AND NOT EXISTS (SELECT 1 FROM item_reads r WHERE r.user_id = s.user_id AND r.item_id = i.id)`,
    )
    .run(...params);

  return result.changes;
}

export function markItemRead(userId: number, itemId: number): number {
  if (!canAccessItem(userId, itemId)) return 0;
  return db.prepare("INSERT INTO item_reads (user_id, item_id) VALUES (?, ?) ON CONFLICT (user_id, item_id) DO NOTHING").run(userId, itemId).changes;
}

export function markItemUnread(userId: number, itemId: number): number {
  return db.prepare("DELETE FROM item_reads WHERE user_id = ? AND item_id = ?").run(userId, itemId).changes;
}

export function bookmarkItem(userId: number, itemId: number): number {
  return db.prepare(
    `INSERT INTO item_bookmarks (user_id, item_id)
     SELECT ?, i.id FROM items i
     JOIN subscriptions s ON s.feed_id = i.feed_id AND s.user_id = ?
     WHERE i.id = ?
     ON CONFLICT (user_id, item_id) DO NOTHING`,
  ).run(userId, userId, itemId).changes;
}

export function unbookmarkItem(userId: number, itemId: number): number {
  return db.prepare("DELETE FROM item_bookmarks WHERE user_id = ? AND item_id = ?").run(userId, itemId).changes;
}

export function listMutedKeywords(userId: number): MutedKeyword[] {
  return db
    .prepare<[number], MutedKeyword>("SELECT * FROM user_muted_keywords WHERE user_id = ? ORDER BY keyword ASC")
    .all(userId);
}

export function addMutedKeyword(userId: number, keyword: string): MutedKeyword {
  const trimmed = keyword.trim().toLowerCase();
  const insert = db.prepare(
    "INSERT INTO user_muted_keywords (user_id, keyword) VALUES (?, ?) ON CONFLICT(user_id, keyword) DO NOTHING",
  );
  insert.run(userId, trimmed);
  return db
    .prepare<[number, string], MutedKeyword>(
      "SELECT * FROM user_muted_keywords WHERE user_id = ? AND keyword = ?",
    )
    .get(userId, trimmed)!;
}

export function removeMutedKeyword(userId: number, keywordId: number): void {
  db.prepare("DELETE FROM user_muted_keywords WHERE id = ? AND user_id = ?").run(keywordId, userId);
}

export function reorderSubscriptions(userId: number, feedIds: number[]): void {
  const update = db.prepare("UPDATE subscriptions SET position = ? WHERE user_id = ? AND feed_id = ?");
  const runTransaction = db.transaction(() => {
    feedIds.forEach((feedId, index) => {
      update.run(index, userId, feedId);
    });
  });
  runTransaction();
}

export function findItemById(id: number): Item | undefined {
  return db.prepare<[number], Item>("SELECT * FROM items WHERE id = ?").get(id);
}

export function updateItemFullContent(id: number, fullContentHtml: string): void {
  db.prepare("UPDATE items SET full_content_html = ? WHERE id = ?").run(fullContentHtml, id);
}

/** Apply a per-item change to many items atomically; returns how many rows changed. */
export function applyToItems(itemIds: readonly number[], change: (itemId: number) => number): number {
  return db.transaction(() => [...new Set(itemIds)].reduce((total, itemId) => total + change(itemId), 0))();
}

export function updateSubscriptionFullTextMode(userId: number, feedId: number, mode: FullTextMode): void {
  db.prepare("UPDATE subscriptions SET full_text_mode = ? WHERE user_id = ? AND feed_id = ?").run(mode, userId, feedId);
}

export function updateSubscriptionNotify(userId: number, feedId: number, notify: boolean): void {
  db.prepare("UPDATE subscriptions SET notify = ? WHERE user_id = ? AND feed_id = ?").run(notify ? 1 : 0, userId, feedId);
}

export function updateSubscriptionBadge(userId: number, feedId: number, badge: boolean): void {
  db.prepare("UPDATE subscriptions SET badge = ? WHERE user_id = ? AND feed_id = ?").run(badge ? 1 : 0, userId, feedId);
}

/** The user's full-text mode for a feed, or undefined when they are not subscribed. */
export function findSubscriptionFullTextMode(userId: number, feedId: number): FullTextMode | undefined {
  return db
    .prepare<[number, number], { full_text_mode: FullTextMode }>("SELECT full_text_mode FROM subscriptions WHERE user_id = ? AND feed_id = ?")
    .get(userId, feedId)?.full_text_mode;
}

/** Count a consent wall for a feed; after `threshold` in a row the feed is marked as blocked. */
export function recordFullTextBlock(feedId: number, threshold: number): void {
  db.prepare(
    `UPDATE feeds SET
       full_text_blocks = full_text_blocks + 1,
       full_text_blocked_at = CASE WHEN full_text_blocks + 1 >= ? THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE full_text_blocked_at END
     WHERE id = ?`,
  ).run(threshold, feedId);
}

export function clearFullTextBlock(feedId: number): void {
  db.prepare("UPDATE feeds SET full_text_blocks = 0, full_text_blocked_at = NULL WHERE id = ? AND full_text_blocks > 0").run(feedId);
}

export function countFeedSubscribers(feedId: number): number {
  return db.prepare<[number], { count: number }>("SELECT COUNT(*) AS count FROM subscriptions WHERE feed_id = ?").get(feedId)!.count;
}

/** Point a feed at a new URL in place, keeping its items; resets fetch state so the next poll starts fresh. */
export function replaceFeedUrl(feedId: number, url: string): void {
  db.prepare(
    `UPDATE feeds SET url = ?, etag = NULL, last_modified = NULL, last_error = NULL, consecutive_errors = 0,
       full_text_blocks = 0, full_text_blocked_at = NULL
     WHERE id = ?`,
  ).run(url, feedId);
}

/** Move a user's subscription to another feed, keeping label, folder, order and full-text mode. */
export function moveSubscription(userId: number, fromFeedId: number, toFeedId: number): void {
  db.transaction(() => {
    db.prepare("UPDATE subscriptions SET feed_id = ? WHERE user_id = ? AND feed_id = ?").run(toFeedId, userId, fromFeedId);
    removeFeedIfUnused(fromFeedId);
  })();
}

export function updateFeedIcon(feedId: number, iconUrl: string | null): void {
  db.prepare("UPDATE feeds SET icon_url = ?, icon_checked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(iconUrl, feedId);
}

/** Fix item titles, snippets, feed titles and labels stored before entity decoding existed; cheap once nothing matches. */
export function repairEncodedText(): number {
  const rows = db
    .prepare<[], { id: number; title: string | null; content_snippet: string | null }>(
      "SELECT id, title, content_snippet FROM items WHERE title LIKE '%&%;%' OR content_snippet LIKE '%&%;%'",
    )
    .all();
  const update = db.prepare("UPDATE items SET title = ?, content_snippet = ? WHERE id = ?");
  let fixed = 0;
  db.transaction(() => {
    for (const row of rows) {
      const title = decodeEntities(row.title);
      const snippet = decodeEntities(row.content_snippet);
      if (title !== row.title || snippet !== row.content_snippet) {
        update.run(title ?? null, snippet ?? null, row.id);
        fixed++;
      }
    }
    for (const feed of db.prepare<[], { id: number; title: string }>("SELECT id, title FROM feeds WHERE title LIKE '%&%;%'").all()) {
      const title = decodeEntities(feed.title);
      if (title !== feed.title) {
        db.prepare("UPDATE feeds SET title = ? WHERE id = ?").run(title, feed.id);
        fixed++;
      }
    }
    for (const sub of db.prepare<[], { id: number; label: string }>("SELECT id, label FROM subscriptions WHERE label LIKE '%&%;%'").all()) {
      const label = decodeEntities(sub.label);
      if (label !== sub.label) {
        db.prepare("UPDATE subscriptions SET label = ? WHERE id = ?").run(label, sub.id);
        fixed++;
      }
    }
  })();
  return fixed;
}

// ---------------------------------------------------------------------------
// Article notes
// ---------------------------------------------------------------------------

export function findItemNote(userId: number, itemId: number): ItemNote | undefined {
  return db
    .prepare<[number, number], ItemNote>("SELECT * FROM item_notes WHERE user_id = ? AND item_id = ?")
    .get(userId, itemId);
}

export function noteConflictState(userId: number, itemId: number): NoteConflictState {
  const note = findItemNote(userId, itemId);
  if (note) return {
    itemId, content: note.content, revision: note.revision,
    createdAt: note.created_at, updatedAt: note.updated_at, deleted: false,
  };
  const previous = db.prepare<[number, number], { revision: number; updated_at: string }>(
    "SELECT revision, updated_at FROM item_note_revisions WHERE user_id = ? AND item_id = ?",
  ).get(userId, itemId);
  return {
    itemId, content: null, revision: previous?.revision ?? 0,
    createdAt: null, updatedAt: previous?.updated_at ?? null, deleted: true,
  };
}

export function setItemNote(
  userId: number,
  itemId: number,
  content: string,
  expectedRevision?: number,
): { note: ItemNote } | { conflict: NoteConflictState } {
  return db.transaction(() => {
    const existing = findItemNote(userId, itemId);
    const current = noteConflictState(userId, itemId);
    if (expectedRevision !== undefined && current.revision !== expectedRevision) {
      return { conflict: current };
    }
    if (existing) {
      const nextRev = existing.revision + 1;
      const now = new Date().toISOString();
      db.prepare(
        "UPDATE item_notes SET content = ?, revision = ?, updated_at = ? WHERE user_id = ? AND item_id = ?",
      ).run(content, nextRev, now, userId, itemId);
      return { note: findItemNote(userId, itemId)! };
    } else {
      const now = new Date().toISOString();
      db.prepare(
        "INSERT INTO item_notes (user_id, item_id, content, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(userId, itemId, content, current.revision + 1, now, now);
      return { note: findItemNote(userId, itemId)! };
    }
  })();
}

export function deleteItemNote(
  userId: number, itemId: number, expectedRevision?: number,
): { deleted: boolean } | { conflict: NoteConflictState } {
  return db.transaction(() => {
    const current = noteConflictState(userId, itemId);
    if (expectedRevision !== undefined && expectedRevision !== current.revision) return { conflict: current };
    const deleted = db.prepare("DELETE FROM item_notes WHERE user_id = ? AND item_id = ?").run(userId, itemId).changes > 0;
    return { deleted };
  })();
}

export function listNotesForUser(
  userId: number,
): (ItemNote & { item_title: string | null; item_link: string | null; feed_title: string | null })[] {
  return db
    .prepare<[number], ItemNote & { item_title: string | null; item_link: string | null; feed_title: string | null }>(
      `SELECT n.*, i.title AS item_title, i.link AS item_link, f.title AS feed_title
       FROM item_notes n
       JOIN items i ON i.id = n.item_id
       LEFT JOIN feeds f ON f.id = i.feed_id
       WHERE n.user_id = ?
       ORDER BY n.updated_at DESC`,
    )
    .all(userId);
}

export function itemsWithNotes(userId: number, itemIds: number[]): Set<number> {
  if (itemIds.length === 0) return new Set();
  const placeholders = itemIds.map(() => "?").join(",");
  const rows = db
    .prepare<unknown[], { item_id: number }>(
      `SELECT item_id FROM item_notes WHERE user_id = ? AND item_id IN (${placeholders})`,
    )
    .all(userId, ...itemIds);
  return new Set(rows.map((row) => row.item_id));
}

// ---------------------------------------------------------------------------
// Server editions use the native service; keep existing imports compatible.
// ---------------------------------------------------------------------------
export { getEdition, publishEdition, deleteEdition } from "../native/editions.js";

export function formatFtsQuery(raw: string): string {
  const tokens = raw.match(/"[^"]*"|[^\s"]+/g) || [];
  const sanitized = tokens
    .map((token) => {
      if (token.startsWith('"') && token.endsWith('"') && token.length > 2) {
        const inner = token.slice(1, -1).replace(/"/g, '""').trim();
        return inner ? `"${inner}"` : null;
      }
      const clean = token.replace(/[^a-zA-Z0-9_\u00C0-\u024F\u1E00-\u1EFF]/g, "");
      if (!clean) return null;
      return `"${clean}"*`;
    })
    .filter(Boolean);

  if (sanitized.length === 0) return "";
  return sanitized.join(" ");
}

export interface SearchOptions {
  query: string;
  feedId?: number;
  folderId?: number;
  unreadOnly?: boolean;
  bookmarkedOnly?: boolean;
  sort?: "relevance" | "date";
  limit?: number;
  offset?: number;
}

export function searchItemsForUser(
  userId: number,
  opts: SearchOptions,
): {
  items: (Item & {
    read: boolean;
    bookmarked: boolean;
    feed_title: string | null;
    feed_site_url: string | null;
    feed_url: string;
    feed_full_text_mode: FullTextMode;
    feed_icon_url: string | null;
    bookmarked_at: string | null;
  })[];
  total: number;
} {
  const fts = formatFtsQuery(opts.query);
  const conditions: string[] = ["(s.id IS NOT NULL OR b.item_id IS NOT NULL OR n.user_id IS NOT NULL)"];
  const params: unknown[] = [];

  if (opts.feedId) {
    conditions.push("i.feed_id = ?");
    params.push(opts.feedId);
  }
  if (opts.folderId) {
    conditions.push("s.folder_id = ?");
    params.push(opts.folderId);
  }
  if (opts.unreadOnly) {
    conditions.push("r.item_id IS NULL");
  }
  if (opts.bookmarkedOnly) {
    conditions.push("b.item_id IS NOT NULL");
  }

  // Search filter (FTS on items + user notes)
  if (fts) {
    conditions.push(`(
      i.id IN (SELECT rowid FROM items_fts WHERE items_fts MATCH ?)
      OR i.id IN (SELECT item_id FROM item_notes WHERE user_id = ? AND INSTR(LOWER(content), LOWER(?)) > 0)
    )`);
    params.push(fts, userId, opts.query);
  } else {
    conditions.push(`(
      INSTR(LOWER(COALESCE(i.title, '')), LOWER(?)) > 0
      OR INSTR(LOWER(COALESCE(i.content_snippet, '')), LOWER(?)) > 0
      OR INSTR(LOWER(COALESCE(i.content_html, '')), LOWER(?)) > 0
      OR INSTR(LOWER(COALESCE(i.full_content_html, '')), LOWER(?)) > 0
      OR i.id IN (SELECT item_id FROM item_notes WHERE user_id = ? AND INSTR(LOWER(content), LOWER(?)) > 0)
    )`);
    params.push(opts.query, opts.query, opts.query, opts.query, userId, opts.query);
  }

  // Count total matches
  const totalRow = db.prepare<unknown[], { count: number }>(`
    SELECT COUNT(DISTINCT i.id) AS count
    FROM items i
    JOIN feeds f ON f.id = i.feed_id
    LEFT JOIN subscriptions s ON s.feed_id = i.feed_id AND s.user_id = ?
    LEFT JOIN item_reads r ON r.item_id = i.id AND r.user_id = ?
    LEFT JOIN item_bookmarks b ON b.item_id = i.id AND b.user_id = ?
    LEFT JOIN item_notes n ON n.item_id = i.id AND n.user_id = ?
    WHERE ${conditions.join(" AND ")}
  `).get(userId, userId, userId, userId, ...params);
  const total = totalRow?.count ?? 0;

  const limit = Math.min(opts.limit ?? 30, 100);
  const offset = Math.max(opts.offset ?? 0, 0);

  let orderBy = "i.published_at DESC, i.created_at DESC, i.id DESC";
  if (opts.sort !== "date" && fts) {
    orderBy = "COALESCE(fts.rank, 0) ASC, i.published_at DESC";
  }

  const querySql = `
    SELECT DISTINCT i.*,
           COALESCE(NULLIF(TRIM(s.label), ''), NULLIF(TRIM(f.title), ''), f.url) AS feed_title,
           f.site_url AS feed_site_url,
           f.url AS feed_url,
           s.full_text_mode AS feed_full_text_mode,
           f.icon_url AS feed_icon_url,
           (r.item_id IS NOT NULL) AS read,
           (b.item_id IS NOT NULL) AS bookmarked,
           b.created_at AS bookmarked_at
    FROM items i
    JOIN feeds f ON f.id = i.feed_id
    LEFT JOIN subscriptions s ON s.feed_id = i.feed_id AND s.user_id = ?
    LEFT JOIN item_reads r ON r.item_id = i.id AND r.user_id = ?
    LEFT JOIN item_bookmarks b ON b.item_id = i.id AND b.user_id = ?
    LEFT JOIN item_notes n ON n.item_id = i.id AND n.user_id = ?
    ${opts.sort !== "date" && fts ? "LEFT JOIN items_fts fts ON fts.rowid = i.id AND items_fts MATCH ?" : ""}
    WHERE ${conditions.join(" AND ")}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `;

  const queryParams = [
    userId,
    userId,
    userId,
    userId,
    ...(opts.sort !== "date" && fts ? [fts] : []),
    ...params,
    limit,
    offset,
  ];

  const items = db.prepare(querySql).all(...queryParams) as (Item & {
    read: boolean;
    bookmarked: boolean;
    feed_title: string | null;
    feed_site_url: string | null;
    feed_url: string;
    feed_full_text_mode: FullTextMode;
    feed_icon_url: string | null;
    bookmarked_at: string | null;
  })[];

  return { items, total };
}
