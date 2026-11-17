import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DATABASE_PATH = ":memory:";
process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";

test("articles removed by retention do not come back on the next poll", async () => {
  const { db, runMigrations } = await import("../src/db/index.js");
  const { runCleanup } = await import("../src/feeds/cleanup.js");
  const { bookmarkItem, markItemRead, subscribe, unsubscribe, upsertItems } = await import("../src/feeds/repository.js");
  runMigrations();

  const userId = Number(db.prepare("INSERT INTO users (email, password_hash, display_name) VALUES (?, 'hash', ?)").run("reader@example.test", "Reader").lastInsertRowid);
  const feedId = Number(db.prepare("INSERT INTO feeds (url) VALUES (?)").run("https://example.com/blog.xml").lastInsertRowid);
  subscribe(userId, feedId);

  const recent = new Date().toISOString();
  const listed = [
    { guid: "old-read", title: "Old and read", publishedAt: "2020-01-01T00:00:00.000Z" },
    { guid: "old-unread", title: "Old and unread", publishedAt: "2020-02-01T00:00:00.000Z" },
    { guid: "recent", title: "Recent", publishedAt: recent },
  ];
  assert.equal(upsertItems(feedId, listed), 3);
  const idOf = (guid: string) => db.prepare<[number, string], { id: number }>("SELECT id FROM items WHERE feed_id = ? AND guid = ?").get(feedId, guid)?.id;
  markItemRead(userId, idOf("old-read")!);

  // Read articles past the read limit go; unread ones stay.
  runCleanup({ retentionReadDays: 30, retentionMaxDays: 0, retentionMaxItemsPerFeed: 0 });
  assert.equal(idOf("old-read"), undefined);
  assert.ok(idOf("old-unread"));
  assert.equal(upsertItems(feedId, listed), 0, "the feed still lists the removed article");
  assert.equal(idOf("old-read"), undefined);

  // The age limit and the per-feed cap remember what they removed as well.
  runCleanup({ retentionReadDays: 0, retentionMaxDays: 90, retentionMaxItemsPerFeed: 0 });
  assert.equal(idOf("old-unread"), undefined);
  assert.equal(upsertItems(feedId, [...listed, { guid: "newer", title: "Newer", publishedAt: recent }]), 1);
  runCleanup({ retentionReadDays: 0, retentionMaxDays: 0, retentionMaxItemsPerFeed: 1 });
  assert.equal(db.prepare<[number], { count: number }>("SELECT COUNT(*) AS count FROM items WHERE feed_id = ?").get(feedId)?.count, 1);
  assert.equal(upsertItems(feedId, [...listed, { guid: "newer", title: "Newer", publishedAt: recent }]), 0);
  assert.equal(db.prepare<[number], { count: number }>("SELECT COUNT(*) AS count FROM item_reads WHERE user_id = ?").get(userId)?.count, 0,
    "no article returned, so nothing shows up as new and unread");

  // Genuinely new articles still arrive.
  assert.equal(upsertItems(feedId, [{ guid: "brand-new", title: "Brand new", publishedAt: recent }]), 1);

  // A tombstone the feed no longer refreshes expires; one it still lists is kept.
  db.prepare("UPDATE item_tombstones SET last_seen_at = '2020-01-01T00:00:00.000Z' WHERE feed_id = ? AND guid = 'old-read'").run(feedId);
  runCleanup({ retentionReadDays: 0, retentionMaxDays: 0, retentionMaxItemsPerFeed: 0 });
  const tombstones = () => db.prepare<[number], { guid: string }>("SELECT guid FROM item_tombstones WHERE feed_id = ? ORDER BY guid").all(feedId).map((row) => row.guid);
  assert.deepEqual(tombstones(), ["old-unread", "recent"]);

  // Once nobody subscribes, the feed forgets its tombstones: a later subscriber gets everything it lists.
  bookmarkItem(userId, idOf("brand-new")!);
  unsubscribe(userId, feedId);
  assert.ok(db.prepare("SELECT 1 FROM feeds WHERE id = ?").get(feedId), "the saved article keeps its feed");
  assert.deepEqual(tombstones(), []);
});
