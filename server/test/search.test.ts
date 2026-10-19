import assert from "node:assert/strict";
import { test } from "node:test";

test("a search with Japanese or Cyrillic words matches every word, not only the Latin ones", async (t) => {
  process.env.DATABASE_PATH = ":memory:";
  process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
  const { db, runMigrations } = await import("../src/db/index.js");
  const { searchItemsForUser, subscribe, formatFtsQuery, needsSubstringSearch } = await import("../src/feeds/repository.js");
  runMigrations();
  t.after(() => db.close());

  const user = Number(db.prepare("INSERT INTO users (email, password_hash, display_name) VALUES ('reader@example.test', 'hash', 'Reader')").run().lastInsertRowid);
  const feed = Number(db.prepare("INSERT INTO feeds (url, title) VALUES ('https://example.test/feed', 'Feed')").run().lastInsertRowid);
  subscribe(user, feed, null, null);
  const add = db.prepare("INSERT INTO items (feed_id, guid, title, content_snippet, published_at, created_at) VALUES (?, ?, ?, ?, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')");
  const item = (guid: string, title: string, snippet = "") => Number(add.run(feed, guid, title, snippet).lastInsertRowid);
  const both = item("both", "RSS で新聞のように読む");
  const latinOnly = item("latin", "RSS reader for the Mac");
  const japaneseOnly = item("japanese", "新聞 の紙面を作る");
  const cyrillic = item("cyrillic", "Новости и RSS каждый день");
  const found = (query: string) => searchItemsForUser(user, { query, sort: "date" }).items.map((row) => row.id).sort((a, b) => a - b);

  await t.test("mixed queries need all words", () => {
    assert.deepEqual(found("RSS 新聞"), [both]);
    assert.deepEqual(found("RSS Новости"), [cyrillic]);
  });
  await t.test("a query of only such words still finds them", () => {
    assert.deepEqual(found("新聞"), [both, japaneseOnly].sort((a, b) => a - b));
    assert.deepEqual(found("紙面"), [japaneseOnly]);
  });
  await t.test("plain Latin queries keep using the full-text index", () => {
    assert.deepEqual(found("reader"), [latinOnly]);
    assert.deepEqual(found("rss"), [both, latinOnly, cyrillic].sort((a, b) => a - b));
    assert.equal(needsSubstringSearch("Köln café reader"), false);
    assert.notEqual(formatFtsQuery("reader"), "");
  });
  await t.test("broad relevance searches preserve paging, private notes and account boundaries", async () => {
    const { setItemNote } = await import("../src/feeds/repository.js");
    db.transaction(() => {
      for (let i = 0; i < 1000; i++) item(`broad-${i}`, `Harbour story ${i}`, "Harbour research and context");
    })();
    setItemNote(user, latinOnly, "Harbour note without a matching article body");
    const hiddenFeed = Number(db.prepare("INSERT INTO feeds(url,title) VALUES ('https://private.example.test/feed','Private')").run().lastInsertRowid);
    db.prepare("INSERT INTO items(feed_id,guid,title) VALUES (?, 'hidden', 'Harbour private story')").run(hiddenFeed);
    const first = searchItemsForUser(user, {query: "harbour", sort: "relevance", limit: 100});
    assert.equal(first.total, 1001); assert.equal(first.items.length, 100);
    const next = searchItemsForUser(user, {query: "harbour", sort: "relevance", limit: 100, offset: 100});
    assert.equal(new Set([...first.items, ...next.items].map(row => row.id)).size, 200);
    const last = searchItemsForUser(user, {query: "harbour", sort: "relevance", limit: 100, offset: 1000});
    assert.deepEqual(last.items.map(row => row.id), [latinOnly], "indexed matches precede note-only results");
    assert.equal(searchItemsForUser(user, {query: "harbour", sort: "date", limit: 100}).total, 1001);
  });
  await t.test("which queries cannot use the index", () => {
    for (const query of ["新聞", "RSS 新聞", "Новости", "αβγ test", "日本語 \"phrase\""]) assert.equal(needsSubstringSearch(query), true, query);
    for (const query of ["reader", "Zürich", "naïve café", "\"日本語 phrase\"", "hello, world!", "2026"]) assert.equal(needsSubstringSearch(query), false, query);
  });
});
