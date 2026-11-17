import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DATABASE_PATH = ":memory:";
process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";

test("an article a person may open can also be saved, also through sync", async () => {
  const { db, runMigrations } = await import("../src/db/index.js");
  const { bookmarkItem, setItemNote, subscribe, upsertItems } = await import("../src/feeds/repository.js");
  const { applyMutations } = await import("../src/sync/mutations.js");
  runMigrations();

  const addUser = db.prepare("INSERT INTO users (email, password_hash, display_name) VALUES (?, 'hash', ?)");
  const reader = Number(addUser.run("reader@example.test", "Reader").lastInsertRowid);
  const keeper = Number(addUser.run("keeper@example.test", "Keeper").lastInsertRowid);
  const outsider = Number(addUser.run("outsider@example.test", "Outsider").lastInsertRowid);
  const feedId = Number(db.prepare("INSERT INTO feeds (url) VALUES (?)").run("https://example.com/feed.xml").lastInsertRowid);
  subscribe(reader, feedId);
  subscribe(keeper, feedId);
  upsertItems(feedId, [{ guid: "story", title: "Story", publishedAt: new Date().toISOString() }]);
  const itemId = (db.prepare("SELECT id FROM items WHERE guid = 'story'").get() as { id: number }).id;
  const saved = (userId: number) => Boolean(db.prepare("SELECT 1 FROM item_bookmarks WHERE user_id = ? AND item_id = ?").get(userId, itemId));

  // The reader annotated the article and then left the feed; the article stays theirs to open and to save.
  setItemNote(reader, itemId, "Worth keeping");
  db.prepare("DELETE FROM subscriptions WHERE user_id = ? AND feed_id = ?").run(reader, feedId);
  const [result] = applyMutations(reader, [{ id: "save-after-leaving", type: "item.save", at: new Date().toISOString(), itemId, value: true }]);
  assert.equal(result.outcome, "applied");
  assert.equal(saved(reader), true, "applied means the article is saved");

  // Saving stays limited to people who may open the article.
  assert.equal(bookmarkItem(outsider, itemId), 0);
  assert.equal(saved(outsider), false);
  assert.equal(applyMutations(outsider, [{ id: "outsider-save", type: "item.save", at: new Date().toISOString(), itemId, value: true }])[0].outcome, "rejected");
});
