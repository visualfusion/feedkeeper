import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeEntities, plainTitle } from "../src/feeds/text.js";

test("titles lose leftover and double-encoded HTML entities", () => {
  assert.equal(decodeEntities("Meta&#8217;s Muse AI"), "Meta’s Muse AI");
  assert.equal(decodeEntities("&#8216;Xbox is not for sale&#8217; says Microsoft&amp;#8217;s chief"), "‘Xbox is not for sale’ says Microsoft’s chief");
  assert.equal(decodeEntities("&quot;Knight&quot; &amp; Co &#x2014; &hellip;"), "\"Knight\" & Co — …");
  assert.equal(decodeEntities("AT&T and R&D &unknown; stay"), "AT&T and R&D &unknown; stay");
  assert.equal(decodeEntities("Plain title"), "Plain title");
  assert.equal(decodeEntities(null), null);
});

test("stored titles with leftover entities are repaired once", async () => {
  process.env.DATABASE_PATH = ":memory:";
  process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
  const { db, runMigrations } = await import("../src/db/index.js");
  const { repairEncodedText } = await import("../src/feeds/repository.js");
  runMigrations();
  const feedId = Number(db.prepare("INSERT INTO feeds (url) VALUES ('https://example.test/feed')").run().lastInsertRowid);
  const insert = db.prepare("INSERT INTO items (feed_id, guid, title, content_snippet) VALUES (?, ?, ?, ?)");
  insert.run(feedId, "a", "Meta&#8217;s AI", "&quot;Quoted&quot;");
  insert.run(feedId, "b", "AT&T earnings", null);
  assert.equal(repairEncodedText(), 1);
  assert.equal(repairEncodedText(), 0);
  assert.deepEqual(db.prepare("SELECT title, content_snippet FROM items ORDER BY guid").all(), [
    { title: "Meta\u2019s AI", content_snippet: "\"Quoted\"" },
    { title: "AT&T earnings", content_snippet: null },
  ]);
  db.close();
});

test("a title from a feed is one trimmed line", () => {
  assert.equal(plainTitle("\n   A List Apart: The Full Feed\t\n  "), "A List Apart: The Full Feed");
  assert.equal(plainTitle("Meta&#8217;s   Muse\nAI"), "Meta’s Muse AI");
  assert.equal(plainTitle("  \n "), undefined);
  assert.equal(plainTitle(null), undefined);
});
