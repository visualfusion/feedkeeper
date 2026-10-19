import assert from "node:assert/strict";
import { test } from "node:test";

test("article pages preserve access, filters, content and ordering", async (t) => {
  process.env.DATABASE_PATH = ":memory:";
  process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
  const { db, runMigrations } = await import("../src/db/index.js");
  const { listItemsForUser, findItemForUser, subscribe, setItemNote, addMutedKeyword } = await import("../src/feeds/repository.js");
  runMigrations();
  t.after(() => db.close());

  const day = (n: number) => `2026-10-${String(n).padStart(2, "0")}T00:00:00.000Z`;
  const addUser = db.prepare("INSERT INTO users (email, password_hash, display_name) VALUES (?, 'hash', 'Reader')");
  const owner = Number(addUser.run("owner@example.test").lastInsertRowid);
  const other = Number(addUser.run("other@example.test").lastInsertRowid);
  const outsider = Number(addUser.run("outsider@example.test").lastInsertRowid);
  const folder = Number(db.prepare("INSERT INTO folders (user_id, name) VALUES (?, 'News')").run(owner).lastInsertRowid);
  const foreignFolder = Number(db.prepare("INSERT INTO folders (user_id, name) VALUES (?, 'Private')").run(other).lastInsertRowid);
  const addFeed = db.prepare("INSERT INTO feeds (url, title, site_url, icon_url) VALUES (?, ?, 'https://example.test', 'https://example.test/icon.png')");
  const shared = Number(addFeed.run("https://example.test/shared", "Original source").lastInsertRowid);
  const own = Number(addFeed.run("https://example.test/own", "  ").lastInsertRowid);
  const foreign = Number(addFeed.run("https://example.test/foreign", "Foreign source").lastInsertRowid);
  const unsubscribed = Number(addFeed.run("https://example.test/saved", "Saved source").lastInsertRowid);
  subscribe(owner, shared, "My source", folder);
  subscribe(other, shared, "Other source", foreignFolder);
  subscribe(owner, own);
  subscribe(other, foreign);
  db.prepare("UPDATE subscriptions SET full_text_mode = 'never' WHERE user_id = ? AND feed_id = ?").run(owner, shared);

  const body = `<p>${"Article body. ".repeat(1_000)}</p>`;
  const addItem = db.prepare(`INSERT INTO items
    (id, feed_id, guid, title, content_snippet, content_html, full_content_html, published_at, created_at, image_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'https://example.test/photo.jpg')`);
  const fixtures: [number, number, string, string, string | null, number][] = [
    [1, shared, "Alpha", "Teaser", day(9), 4],
    [2, shared, "Noise", "Teaser", day(1), 4],
    [3, shared, "No publish date", "100% marker", null, 3],
    [4, shared, "Invalid publish date", "Teaser", "invalid", 2],
    [5, shared, "Earlier import", "Teaser", day(9), 1],
    [6, own, "Other feed", "Teaser", day(2), 5],
    [7, foreign, "Private article", "Teaser", day(10), 10],
    [8, unsubscribed, "Saved article", "Teaser", day(3), 6],
    [9, unsubscribed, "Someone else's saved article", "Teaser", day(10), 10],
    [10, shared, "Same dates", "Teaser", day(9), 4],
  ];
  for (const [id, feed, title, snippet, published, created] of fixtures) {
    addItem.run(id, feed, `item-${id}`, title, snippet, `${body}<p>bodytoken</p>`, `${body}<p>archivetoken</p>`, published, day(created));
  }
  const save = db.prepare("INSERT INTO item_bookmarks (user_id, item_id, created_at) VALUES (?, ?, ?)");
  save.run(owner, 1, day(8));
  save.run(owner, 2, day(7));
  save.run(owner, 8, day(8));
  save.run(other, 5, day(9));
  save.run(other, 9, day(10));
  db.prepare("INSERT INTO item_reads (user_id, item_id) VALUES (?, ?)").run(owner, 2);
  db.prepare("INSERT INTO item_reads (user_id, item_id) VALUES (?, ?)").run(other, 5);
  setItemNote(owner, 5, "My needle");
  setItemNote(other, 1, "Private needle");
  setItemNote(owner, 7, "Note without a subscription");
  addMutedKeyword(owner, "NOISE");
  const ids = (opts: Parameters<typeof listItemsForUser>[1] = {}, user = owner) => listItemsForUser(user, opts).map((row) => row.id);

  await t.test("only subscriptions and the caller's saved articles grant list access", () => {
    assert.deepEqual(ids(), [10, 1, 5, 8, 3, 6, 4]);
    assert.deepEqual(ids({}, outsider), []);
    assert.deepEqual(ids({ feedId: foreign }), []);
    assert.deepEqual(ids({ feedId: unsubscribed }), [8]);
    assert.deepEqual(ids({ folderId: foreignFolder }), []);
    assert.deepEqual(ids({ folderId: folder }), [10, 1, 5, 3, 4]);
    assert.deepEqual(ids({ folderId: folder, feedId: own }), []);
    assert.deepEqual(ids({ folderId: folder, bookmarkedOnly: true }), [1, 2]);
    assert.deepEqual(ids({ bookmarkedOnly: true }, other), [9, 5]);
  });

  await t.test("full rows and per-user metadata survive page loading", () => {
    for (const row of listItemsForUser(owner, { includeMuted: true })) {
      assert.deepEqual(row, findItemForUser(owner, row.id));
      assert.equal(row.content_html, `${body}<p>bodytoken</p>`);
      assert.equal(row.full_content_html, `${body}<p>archivetoken</p>`);
    }
    const sharedRow = listItemsForUser(owner, { feedId: shared })[1];
    assert.deepEqual([sharedRow.feed_title, sharedRow.feed_full_text_mode, sharedRow.feed_site_url, sharedRow.feed_icon_url],
      ["My source", "never", "https://example.test", "https://example.test/icon.png"]);
    assert.equal(listItemsForUser(other, { feedId: shared })[1].feed_title, "Other source");
    assert.equal(listItemsForUser(owner, { feedId: own })[0].feed_title, "https://example.test/own");
    const saved = listItemsForUser(owner, { feedId: unsubscribed })[0];
    assert.deepEqual([saved.feed_title, saved.feed_full_text_mode, saved.bookmarked, saved.bookmarked_at], ["Saved source", null, 1, day(8)]);
    const state = listItemsForUser(owner, { feedId: shared, includeMuted: true });
    assert.equal(state.find((row) => row.id === 2)?.read, 1);
    assert.deepEqual([state.find((row) => row.id === 5)?.read, state.find((row) => row.id === 5)?.bookmarked], [0, 0]);
  });

  await t.test("read, muted, literal search and archived search filters apply before paging", () => {
    assert.deepEqual(ids({ includeMuted: true }), [10, 1, 5, 8, 3, 6, 4, 2]);
    assert.deepEqual(ids({ unreadOnly: true, includeMuted: true }), ids());
    assert.deepEqual(ids({ bookmarkedOnly: true }), [8, 1, 2]);
    assert.deepEqual(ids({ bookmarkedOnly: true, unreadOnly: true }), [8, 1]);
    assert.deepEqual(ids({ search: "%" }), [3]);
    assert.deepEqual(ids({ search: "my NEEDLE" }), [5]);
    assert.deepEqual(ids({ search: "private needle" }), []);
    assert.deepEqual(ids({ search: "Noise" }), []);
    assert.deepEqual(ids({ search: "Noise", includeMuted: true }), [2]);
    assert.deepEqual(ids({ search: "archivetoken" }), []);
    assert.deepEqual(ids({ bookmarkedOnly: true, search: "archivetoken", limit: 1, offset: 1 }), [1]);
    assert.deepEqual(ids({ bookmarkedOnly: true, search: "bodytoken" }), [8, 1, 2]);
  });

  await t.test("date bounds use the existing publish-date fallback and inclusivity", () => {
    assert.deepEqual(ids({ since: day(4), sortByAdded: true }), [8, 6]);
    assert.deepEqual(ids({ publishedSince: day(2), publishedUntil: day(3) }), [8, 3, 6, 4]);
    assert.deepEqual(ids({ publishedSince: day(3), publishedUntil: day(3) }), [8, 3]);
  });

  await t.test("all three orders and offset pages retain their stable tie breakers", () => {
    const orders = [
      [{}, [10, 1, 5, 8, 3, 6, 4]],
      [{ sortByAdded: true }, [8, 6, 10, 1, 3, 4, 5]],
      [{ bookmarkedOnly: true }, [8, 1, 2]],
      [{ bookmarkedOnly: true, sortByAdded: true }, [8, 2, 1]],
    ] as const;
    for (const [opts, expected] of orders) {
      const paged: number[] = [];
      for (let offset = 0; offset < expected.length; offset += 2) paged.push(...ids({ ...opts, limit: 2, offset }));
      assert.deepEqual(paged, expected);
      assert.deepEqual(ids({ ...opts, offset: 100 }), []);
    }
    assert.deepEqual(ids({ offset: -1 }), ids());
  });

  await t.test("before and after cursors handle equal timestamps without gaps or duplicates", () => {
    const expected = [8, 6, 10, 2, 1, 3, 4, 5];
    const seen: number[] = [];
    let before: { createdAt: string; id: number } | undefined;
    while (true) {
      const page = listItemsForUser(owner, { sortByAdded: true, includeMuted: true, limit: 2, before });
      if (!page.length) break;
      seen.push(...page.map((row) => row.id));
      const last = page[page.length - 1];
      before = { createdAt: last.created_at, id: last.id };
    }
    assert.deepEqual(seen, expected);
    assert.deepEqual(ids({ sortByAdded: true, includeMuted: true, after: { createdAt: day(4), id: 2 } }), [8, 6, 10]);
    assert.deepEqual(ids({ sortByAdded: true, includeMuted: true, before: { createdAt: day(5), id: 6 }, after: { createdAt: day(4), id: 1 } }), [10, 2]);
  });

  await t.test("default and maximum page sizes still bound large article bodies", () => {
    subscribe(outsider, own);
    db.transaction(() => {
      for (let id = 11; id <= 225; id++) addItem.run(id, own, `item-${id}`, `Story ${id}`, null, body, body, day(9), day(9));
    })();
    assert.equal(listItemsForUser(outsider).length, 50);
    const first = listItemsForUser(outsider, { limit: 1_000 });
    const last = listItemsForUser(outsider, { limit: 1_000, offset: 200 });
    assert.equal(first.length, 200);
    assert.equal(last.length, 16);
    assert.equal(new Set([...first, ...last].map((row) => row.id)).size, 216);
  });
});
