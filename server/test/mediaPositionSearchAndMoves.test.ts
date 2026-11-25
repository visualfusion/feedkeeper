import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DATABASE_PATH = ":memory:";
process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";

test("media positions sync with last-write-wins and reset upon completion", async () => {
  const { db, runMigrations } = await import("../src/db/index.js");
  const { subscribe, upsertItems } = await import("../src/feeds/repository.js");
  const { mediaPositions, upsertMediaPosition } = await import("../src/feeds/mediaPosition.js");
  runMigrations();

  const userId = Number(
    db.prepare("INSERT INTO users (email, password_hash, display_name) VALUES (?, 'hash', ?)").run("pod@example.test", "Pod").lastInsertRowid,
  );
  const feedId = Number(db.prepare("INSERT INTO feeds (url) VALUES (?)").run("https://example.com/pod.xml").lastInsertRowid);
  subscribe(userId, feedId);
  upsertItems(feedId, [{
    guid: "ep-1",
    title: "Episode 1",
    enclosureUrl: "https://cdn.example.com/ep1.mp3",
    enclosureType: "audio/mpeg",
    enclosureDurationSeconds: 1800,
    publishedAt: new Date().toISOString(),
  }]);
  const itemId = (db.prepare("SELECT id FROM items WHERE guid = 'ep-1'").get() as { id: number }).id;

  const newer = upsertMediaPosition(userId, itemId, {
    positionSeconds: 420,
    durationSeconds: 1800,
    updatedAt: "2026-11-25T12:00:00.000Z",
  });
  assert.equal(newer.positionSeconds, 420);
  assert.equal(newer.completed, false);

  // An older offline update must not overwrite a newer server timestamp.
  const stale = upsertMediaPosition(userId, itemId, {
    positionSeconds: 120,
    durationSeconds: 1800,
    updatedAt: "2026-11-25T11:55:00.000Z",
  });
  assert.equal(stale.positionSeconds, 420);

  // Reaching the end resets position to 0 and marks completed.
  const finished = upsertMediaPosition(userId, itemId, {
    positionSeconds: 1798,
    durationSeconds: 1800,
    updatedAt: "2026-11-25T12:10:00.000Z",
  });
  assert.equal(finished.positionSeconds, 0);
  assert.equal(finished.completed, true);

  const loaded = mediaPositions(userId, [itemId]).get(itemId);
  assert.equal(loaded?.completed, true);
  assert.equal(loaded?.positionSeconds, 0);
});

test("search operators filter audio, video, notes, starred, unread and feed", async () => {
  const { db, runMigrations } = await import("../src/db/index.js");
  const { parseSearchQuery } = await import("../src/feeds/searchQuery.js");
  const { bookmarkItem, listItemsForUser, markItemRead, searchItemsForUser, setItemNote, subscribe, upsertItems } =
    await import("../src/feeds/repository.js");
  runMigrations();

  const parsed = parseSearchQuery('has:audio is:unread feed:"Tech Pod" swift');
  assert.equal(parsed.hasAudio, true);
  assert.equal(parsed.readState, "unread");
  assert.deepEqual(parsed.feedTerms, ["Tech Pod"]);
  assert.equal(parsed.textQuery, "swift");

  const userId = Number(
    db.prepare("INSERT INTO users (email, password_hash, display_name) VALUES (?, 'hash', ?)").run("search@example.test", "Search").lastInsertRowid,
  );
  const feedA = Number(db.prepare("INSERT INTO feeds (url, title) VALUES (?, ?)").run("https://a.example.test/rss", "Tech Pod").lastInsertRowid);
  const feedB = Number(db.prepare("INSERT INTO feeds (url, title) VALUES (?, ?)").run("https://b.example.test/rss", "News Daily").lastInsertRowid);
  subscribe(userId, feedA);
  subscribe(userId, feedB);

  upsertItems(feedA, [
    { guid: "a1", title: "Audio Episode", enclosureUrl: "https://a.example.test/1.mp3", enclosureType: "audio/mpeg", publishedAt: "2026-11-25T10:00:00Z" },
    { guid: "a2", title: "Video Clip", enclosureUrl: "https://a.example.test/2.mp4", enclosureType: "video/mp4", publishedAt: "2026-11-25T09:00:00Z" },
  ]);
  upsertItems(feedB, [
    { guid: "b1", title: "Plain Article", publishedAt: "2026-11-25T08:00:00Z" },
  ]);

  const idA1 = (db.prepare("SELECT id FROM items WHERE guid = 'a1'").get() as { id: number }).id;
  const idA2 = (db.prepare("SELECT id FROM items WHERE guid = 'a2'").get() as { id: number }).id;
  const idB1 = (db.prepare("SELECT id FROM items WHERE guid = 'b1'").get() as { id: number }).id;
  setItemNote(userId, idB1, "Important note");
  bookmarkItem(userId, idA2);
  markItemRead(userId, idA1);

  assert.deepEqual(searchItemsForUser(userId, { query: "has:audio" }).items.map((i) => i.id), [idA1]);
  assert.deepEqual(searchItemsForUser(userId, { query: "has:video" }).items.map((i) => i.id), [idA2]);
  assert.deepEqual(searchItemsForUser(userId, { query: "has:notes" }).items.map((i) => i.id), [idB1]);
  assert.deepEqual(searchItemsForUser(userId, { query: "is:starred" }).items.map((i) => i.id), [idA2]);
  assert.deepEqual(listItemsForUser(userId, { search: 'feed:"Tech Pod" is:unread' }).map((i) => i.id), [idA2]);
});

test("feed suggested_url and replaceFeedUrl track and clear feed moves", async () => {
  const { db, runMigrations } = await import("../src/db/index.js");
  const { findFeedById, replaceFeedUrl, setFeedSuggestedUrl } = await import("../src/feeds/repository.js");
  runMigrations();

  const feedId = Number(db.prepare("INSERT INTO feeds (url) VALUES (?)").run("https://old.example.test/feed.xml").lastInsertRowid);
  setFeedSuggestedUrl(feedId, "https://new.example.test/feed.xml");
  const withSuggestion = findFeedById(feedId)!;
  assert.equal(withSuggestion.suggested_url, "https://new.example.test/feed.xml");
  assert.ok(withSuggestion.suggested_url_checked_at);

  replaceFeedUrl(feedId, "https://new.example.test/feed.xml");
  const moved = findFeedById(feedId)!;
  assert.equal(moved.url, "https://new.example.test/feed.xml");
  assert.equal(moved.suggested_url, null);
});
