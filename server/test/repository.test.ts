import assert from "node:assert/strict";
import { test } from "node:test";

test("item state changes require a feed subscription", async () => {
  process.env.DATABASE_PATH = ":memory:";
  process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";

  const { db, runMigrations } = await import("../src/db/index.js");
  const { markItemRead, bookmarkItem, subscribe, upsertItems, listItemsForUser, findItemForUser, updateSubscriptionLabel, addMutedKeyword } = await import("../src/feeds/repository.js");
  runMigrations();

  const addUser = db.prepare("INSERT INTO users (email, password_hash, display_name) VALUES (?, 'hash', ?)");
  const ownerId = Number(addUser.run("owner@example.test", "Owner").lastInsertRowid);
  const otherId = Number(addUser.run("other@example.test", "Other").lastInsertRowid);
  const feedId = Number(db.prepare("INSERT INTO feeds (url) VALUES (?)").run("https://example.com/feed").lastInsertRowid);
  const itemId = Number(db.prepare("INSERT INTO items (feed_id, guid) VALUES (?, 'item')").run(feedId).lastInsertRowid);
  subscribe(ownerId, feedId);

  markItemRead(otherId, itemId);
  bookmarkItem(otherId, itemId);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM item_reads WHERE user_id = ?").get(otherId)?.count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM item_bookmarks WHERE user_id = ?").get(otherId)?.count, 0);

  markItemRead(ownerId, itemId);
  bookmarkItem(ownerId, itemId);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM item_reads WHERE user_id = ?").get(ownerId)?.count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM item_bookmarks WHERE user_id = ?").get(ownerId)?.count, 1);

  db.prepare("UPDATE feeds SET title = ? WHERE id = ?").run("Original Source", feedId);
  subscribe(otherId, feedId, "Other name");
  updateSubscriptionLabel(ownerId, feedId, " My name ");
  assert.equal(listItemsForUser(ownerId)[0].feed_title, "My name");
  assert.equal(listItemsForUser(otherId)[0].feed_title, "Other name");
  assert.equal(findItemForUser(ownerId, itemId)?.feed_title, "My name");
  updateSubscriptionLabel(ownerId, feedId, "  ");
  assert.equal(listItemsForUser(ownerId)[0].feed_title, "Original Source");

  assert.equal(upsertItems(feedId, [{ guid: "another", title: "First title" }]), 1);
  assert.equal(upsertItems(feedId, [{ guid: "another", title: "Updated title" }]), 0);
  assert.equal(
    (db.prepare("SELECT title FROM items WHERE feed_id = ? AND guid = 'another'").get(feedId) as { title: string }).title,
    "Updated title",
  );

  upsertItems(feedId, [
    { guid: "percent", title: "100% uptime" },
    { guid: "plain", title: "ordinary update" },
  ]);
  assert.deepEqual(listItemsForUser(ownerId, { search: "%" }).map((item) => item.guid), ["percent"]);
  addMutedKeyword(ownerId, "%");
  assert.equal(listItemsForUser(ownerId).some((item) => item.guid === "percent"), false);
  assert.equal(listItemsForUser(ownerId).some((item) => item.guid === "plain"), true);

  upsertItems(feedId, Array.from({ length: 55 }, (_, index) => ({ guid: `page-${index}`, title: `Article ${index}` })));
  const firstPage = listItemsForUser(ownerId, { includeMuted: true, limit: 50 });
  const secondPage = listItemsForUser(ownerId, { includeMuted: true, limit: 50, offset: 50 });
  assert.equal(firstPage.length, 50);
  assert.equal(secondPage.length, 9);
  assert.equal(new Set([...firstPage, ...secondPage].map((item) => item.id)).size, 59);

  // Slug/guid rename after publish with identical title and publishedAt updates existing item instead of duplicating.
  assert.equal(upsertItems(feedId, [{
    guid: "https://example.test/old-slug,123.html",
    link: "https://example.test/old-slug,123.html",
    title: "Renamed slug article",
    publishedAt: "2026-11-24T13:41:00.000Z",
  }]), 1);
  assert.equal(upsertItems(feedId, [{
    guid: "https://example.test/new-slug,123.html",
    link: "https://example.test/new-slug,123.html",
    title: "Renamed slug article",
    publishedAt: "2026-11-24T13:41:00.000Z",
  }]), 0);
  assert.equal(
    (db.prepare("SELECT link FROM items WHERE feed_id = ? AND title = 'Renamed slug article'").get(feedId) as { link: string }).link,
    "https://example.test/new-slug,123.html",
  );
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS count FROM items WHERE feed_id = ? AND title = 'Renamed slug article'").get(feedId) as { count: number }).count,
    1,
  );
  assert.equal(upsertItems(feedId, [{
    guid: "https://example.test/later,124.html",
    link: "https://example.test/later,124.html",
    title: "Renamed slug article",
    publishedAt: "2026-11-24T14:41:00.000Z",
  }]), 1);

  db.close();
});
