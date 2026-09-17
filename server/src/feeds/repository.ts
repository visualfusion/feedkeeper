import { db } from "../db/index.js";

export interface Feed {
  id: number;
  url: string;
  title: string | null;
  site_url: string | null;
  poll_interval_minutes: number;
  last_polled_at: string | null;
  last_error: string | null;
  etag: string | null;
  last_modified: string | null;
  created_at: string;
}

export interface Item {
  id: number;
  feed_id: number;
  guid: string;
  title: string | null;
  link: string | null;
  content_snippet: string | null;
  published_at: string | null;
  created_at: string;
}

export interface SubscribedFeed extends Feed {
  subscription_id: number;
  label: string | null;
  unread_count: number;
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

export function subscribe(userId: number, feedId: number, label: string | null): number {
  const result = db
    .prepare(
      `INSERT INTO subscriptions (user_id, feed_id, label) VALUES (?, ?, ?)
       ON CONFLICT (user_id, feed_id) DO UPDATE SET label = excluded.label`,
    )
    .run(userId, feedId, label);
  return Number(result.lastInsertRowid);
}

export function unsubscribe(userId: number, feedId: number): void {
  db.prepare("DELETE FROM subscriptions WHERE user_id = ? AND feed_id = ?").run(userId, feedId);
  const remaining = db
    .prepare<[number], { count: number }>("SELECT COUNT(*) AS count FROM subscriptions WHERE feed_id = ?")
    .get(feedId)!;
  if (remaining.count === 0) {
    // No one subscribes to this feed anymore; stop polling it and drop its items.
    db.prepare("DELETE FROM feeds WHERE id = ?").run(feedId);
  }
}

export function listSubscriptionsForUser(userId: number): SubscribedFeed[] {
  return db
    .prepare<[number, number], SubscribedFeed>(
      `SELECT
         f.*,
         s.id AS subscription_id,
         s.label AS label,
         (
           SELECT COUNT(*) FROM items i
           WHERE i.feed_id = f.id
             AND NOT EXISTS (
               SELECT 1 FROM item_reads r WHERE r.item_id = i.id AND r.user_id = ?
             )
         ) AS unread_count
       FROM subscriptions s
       JOIN feeds f ON f.id = s.feed_id
       WHERE s.user_id = ?
       ORDER BY s.created_at ASC`,
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

export function listFeedsDueForPoll(): Feed[] {
  return db
    .prepare<[], Feed>(
      `SELECT * FROM feeds
       WHERE last_polled_at IS NULL
          OR last_polled_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-' || poll_interval_minutes || ' minutes')`,
    )
    .all();
}

export function updateFeedAfterPoll(
  feedId: number,
  data: { title?: string; siteUrl?: string; etag?: string; lastModified?: string; error?: string | null },
): void {
  db.prepare(
    `UPDATE feeds SET
       title = COALESCE(?, title),
       site_url = COALESCE(?, site_url),
       etag = COALESCE(?, etag),
       last_modified = COALESCE(?, last_modified),
       last_error = ?,
       last_polled_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`,
  ).run(data.title ?? null, data.siteUrl ?? null, data.etag ?? null, data.lastModified ?? null, data.error ?? null, feedId);
}

export function upsertItems(
  feedId: number,
  items: Array<{ guid: string; title?: string; link?: string; contentSnippet?: string; publishedAt?: string }>,
): number {
  const insert = db.prepare(
    `INSERT INTO items (feed_id, guid, title, link, content_snippet, published_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (feed_id, guid) DO NOTHING`,
  );
  const insertMany = db.transaction((rows: typeof items) => {
    let inserted = 0;
    for (const row of rows) {
      const result = insert.run(
        feedId,
        row.guid,
        row.title ?? null,
        row.link ?? null,
        row.contentSnippet ?? null,
        row.publishedAt ?? null,
      );
      if (result.changes > 0) inserted++;
    }
    return inserted;
  });
  return insertMany(items);
}

export function listItemsForUser(
  userId: number,
  opts: { feedId?: number; unreadOnly?: boolean; search?: string; limit?: number; since?: string } = {},
): (Item & { read: boolean; feed_title: string | null })[] {
  const conditions: string[] = ["s.user_id = ?"];
  const params: unknown[] = [userId];

  if (opts.feedId) {
    conditions.push("i.feed_id = ?");
    params.push(opts.feedId);
  }
  if (opts.unreadOnly) {
    conditions.push("r.item_id IS NULL");
  }
  if (opts.search) {
    conditions.push("(i.title LIKE ? OR i.content_snippet LIKE ?)");
    params.push(`%${opts.search}%`, `%${opts.search}%`);
  }
  if (opts.since) {
    conditions.push("i.created_at > ?");
    params.push(opts.since);
  }

  const limit = Math.min(opts.limit ?? 50, 200);
  params.push(limit);

  return db
    .prepare(
      `SELECT DISTINCT i.*, f.title AS feed_title, (r.item_id IS NOT NULL) AS read
       FROM items i
       JOIN subscriptions s ON s.feed_id = i.feed_id
       JOIN feeds f ON f.id = i.feed_id
       LEFT JOIN item_reads r ON r.item_id = i.id AND r.user_id = s.user_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY i.published_at DESC, i.created_at DESC
       LIMIT ?`,
    )
    .all(...params) as (Item & { read: boolean; feed_title: string | null })[];
}

export function updateSubscriptionLabel(userId: number, feedId: number, label: string | null): void {
  db.prepare("UPDATE subscriptions SET label = ? WHERE user_id = ? AND feed_id = ?").run(label, userId, feedId);
}

export function updateFeedPollInterval(feedId: number, minutes: number): void {
  db.prepare("UPDATE feeds SET poll_interval_minutes = ? WHERE id = ?").run(minutes, feedId);
}

export function markAllRead(userId: number, feedId?: number): number {
  const conditions = ["s.user_id = ?"];
  const params: unknown[] = [userId, userId];

  if (feedId) {
    conditions.push("i.feed_id = ?");
    params.push(feedId);
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

export function markItemRead(userId: number, itemId: number): void {
  db.prepare(
    "INSERT INTO item_reads (user_id, item_id) VALUES (?, ?) ON CONFLICT (user_id, item_id) DO NOTHING",
  ).run(userId, itemId);
}

export function markItemUnread(userId: number, itemId: number): void {
  db.prepare("DELETE FROM item_reads WHERE user_id = ? AND item_id = ?").run(userId, itemId);
}
