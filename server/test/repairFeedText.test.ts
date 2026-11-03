import assert from "node:assert/strict";
import { test } from "node:test";

test("stored Google Alerts items lose the title markup and point to the article", async () => {
  process.env.DATABASE_PATH = ":memory:";
  process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
  const { db, runMigrations } = await import("../src/db/index.js");
  const { repairEncodedText } = await import("../src/feeds/repository.js");
  runMigrations();
  const feedId = Number(db.prepare("INSERT INTO feeds (url) VALUES ('https://example.test/alerts')").run().lastInsertRowid);
  const insert = db.prepare("INSERT INTO items (feed_id, guid, title, link) VALUES (?, ?, ?, ?)");
  insert.run(feedId, "a", "<b>FeedKeeper</b> vs. Feedly", "https://www.google.com/url?rct=j&sa=t&url=https://feedkeeper.cloud/feedkeeper-vs-feedly&ct=ga");
  insert.run(feedId, "b", "A plain title", "https://example.com/plain");
  assert.equal(repairEncodedText(), 1);
  assert.equal(repairEncodedText(), 0);
  assert.deepEqual(db.prepare("SELECT title, link FROM items ORDER BY guid").all(), [
    { title: "FeedKeeper vs. Feedly", link: "https://feedkeeper.cloud/feedkeeper-vs-feedly" },
    { title: "A plain title", link: "https://example.com/plain" },
  ]);
  db.close();
});
