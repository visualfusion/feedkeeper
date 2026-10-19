import assert from "node:assert/strict";
import { after, test } from "node:test";
import { isEmptyGallery } from "../src/feeds/galleryContent.js";

process.env.DATABASE_PATH = ":memory:";
process.env.SESSION_SECRET = "gallery-tests-only-at-least-32-characters";
const { db, runMigrations } = await import("../src/db/index.js");
const repo = await import("../src/feeds/repository.js");
const { backfillLeads } = await import("../src/feeds/lead.js");
const { currentSeq, listChanges } = await import("../src/sync/changeLog.js");
const { contentMetadata } = await import("../src/feeds/articleContent.js");
const { editionCandidates, publishCuratedEdition, getEdition } = await import("../src/native/editions.js");
const { newItemsPushPayload } = await import("../src/push.js");
runMigrations();
after(() => db.close());

let serial = 0;
function fixture() {
  const key = ++serial;
  const user = Number(db.prepare("INSERT INTO users(email,password_hash,display_name) VALUES (?,'hash','Reader')")
    .run(`gallery-${key}@example.test`).lastInsertRowid);
  const feed = repo.createFeed(`https://publisher-${key}.example.test/feed`, 15);
  repo.subscribe(user, feed.id);
  const add = (guid: string, extra: Partial<Parameters<typeof repo.upsertItems>[1][number]> = {}) => {
    repo.upsertItems(feed.id, [{ guid, title: `Story ${guid}`, link: "https://publisher.example.test/multimedia/bilder/day.html",
      contentSnippet: "[mehr]", contentHtml: '<img src="/photo.jpg"><p>[<a href="/original">mehr</a>]</p>',
      publishedAt: new Date().toISOString(), ...extra }]);
    return Number(db.prepare("SELECT id FROM items WHERE feed_id = ? AND guid = ?").get(feed.id, guid)!.id);
  };
  return { user, feed, add };
}

test("gallery classification requires both a path signal and no editorial text, independent of publisher/title", () => {
  const empty = { link: "https://publisher.example.test/multimedia/bilder/day.html", content_snippet: "[mehr]",
    content_html: '<img src="/unrelated.jpg"><p>[<a href="/original">mehr</a>]</p>' };
  assert.equal(isEmptyGallery(empty), true);
  for (const path of ["/gallery/day", "/photo-gallery-100.html", "/PHOTOS/day", "/%62ilder/day"]) {
    assert.equal(isEmptyGallery({ ...empty, link: `https://another.example.test${path}` }), true, path);
  }
  for (const prompt of ["", "Read more…", "&#91;mehr&#93;", "続きを読む", "View gallery"]) {
    assert.equal(isEmptyGallery({ ...empty, content_snippet: prompt, content_html: `<p>${prompt}</p>` }), true, prompt);
  }
  for (const link of [null, "not a URL", "https://gallery.example.test/news/story", "https://example.test/galleryish/story", "https://example.test/news?section=gallery"]) {
    assert.equal(isEmptyGallery({ ...empty, link }), false, String(link));
  }
  for (const text of ["Rain today.", "Foto: Ein Kind springt ins Meer.", "雨。", "Not read more but real news."]) {
    assert.equal(isEmptyGallery({ ...empty, content_snippet: text }), false, text);
    assert.equal(isEmptyGallery({ ...empty, content_html: `<figure><img src="/p.jpg"><figcaption>${text}</figcaption></figure>` }), false, text);
    assert.equal(isEmptyGallery({ ...empty, full_content_html: `<p>${text}</p>` }), false, text);
  }
});

test("lists and search filter before pagination while caller-owned saves and notes stay accessible", () => {
  const { user, feed, add } = fixture();
  const hidden = add("hidden");
  const saved = add("saved");
  const annotated = add("annotated");
  const short = add("short", { contentSnippet: "Rain today." });
  const other = Number(db.prepare("INSERT INTO users(email,password_hash,display_name) VALUES ('other-gallery@example.test','hash','Other')").run().lastInsertRowid);
  repo.subscribe(other, feed.id);
  db.prepare("INSERT INTO item_bookmarks(user_id,item_id) VALUES (?,?)").run(user, saved);
  repo.setItemNote(user, annotated, "Keep this gallery");
  repo.setItemNote(other, hidden, "Only the other reader's note");
  const visible = repo.listItemsForUser(user, { sortByAdded: true });
  assert.deepEqual(new Set(visible.map(item => item.id)), new Set([saved, annotated, short]));
  assert.equal(repo.listItemsForUser(user, { includeMuted: true }).some(item => item.id === hidden), false);
  const pages = [0, 1, 2].flatMap(offset => repo.listItemsForUser(user, { limit: 1, offset, sortByAdded: true }));
  assert.deepEqual(pages.map(item => item.id), visible.map(item => item.id));
  const search = repo.searchItemsForUser(user, { query: "Story", limit: 1 });
  assert.equal(search.total, 3);
  assert.equal(search.items.length, 1);
  assert.equal(repo.findItemForUser(user, hidden)!.id, hidden, "direct reads still return the publisher data");
  assert.equal(repo.findItemsForUser(user, [hidden])[0].id, hidden, "bundles still hydrate cached/synced items");
  assert.equal(repo.listItemsForUser(other).some(item => item.id === saved), false, "someone else's save does not bypass the filter");
  assert.equal(contentMetadata(repo.findItemById(hidden)!).isEmptyGallery, true);
});

test("metadata backfill is bounded and content/link changes update classification and sync without deletion", () => {
  const { user, feed, add } = fixture();
  const hidden = add("lifecycle");
  const original = repo.findItemById(hidden)!;
  const since = currentSeq(user);
  repo.updateItemFullContent(hidden, "<p>A short but real photo caption.</p>");
  const restored = repo.findItemById(hidden)!;
  assert.equal(restored.is_empty_gallery, 0);
  assert.ok(restored.content_revision > original.content_revision);
  const changes = listChanges(user, since).changes;
  const update = changes.find(change => change.entity === "item_content" && change.id === hidden)!;
  assert.equal(update.op, "upsert");
  assert.equal(update.data!.isEmptyGallery, false);
  assert.equal(changes.some(change => change.id === hidden && change.op === "delete"), false);

  const moved = add("moved");
  repo.upsertItems(feed.id, [{ guid: "moved", link: "https://publisher.example.test/news/story" }]);
  assert.equal(repo.findItemById(moved)!.is_empty_gallery, 0, "a changed canonical URL is reclassified");

  const legacy = Number(db.prepare(`INSERT INTO items(feed_id,guid,title,link,content_snippet,content_html)
    VALUES (?,'legacy','Legacy','https://example.test/gallery/day','[mehr]','<img src="/photo.jpg">')`).run(feed.id).lastInsertRowid);
  db.prepare("INSERT INTO item_bookmarks(user_id,item_id) VALUES (?,?)").run(user, legacy);
  const before = currentSeq(user);
  assert.equal(backfillLeads(1), 1);
  assert.equal(repo.findItemById(legacy)!.is_empty_gallery, 1);
  const classified = listChanges(user, before).changes.find(change => change.entity === "item_content" && change.id === legacy)!;
  assert.equal(classified.op, "upsert");
  assert.equal(classified.data!.isEmptyGallery, true);
  assert.ok(repo.listItemsForUser(user).some(item => item.id === legacy), "backfill keeps saved legacy articles accessible");
  assert.equal(backfillLeads(1), 0);
});

test("curation and notifications omit empty galleries even when saved, retaining existing editions", () => {
  const { user, feed, add } = fixture();
  const hidden = add("curation");
  const good = add("good", { contentSnippet: "A small news update." });
  db.prepare("INSERT INTO item_bookmarks(user_id,item_id) VALUES (?,?)").run(user, hidden);
  assert.equal(editionCandidates(user).some(item => item.id === hidden), false);
  assert.ok(editionCandidates(user).some(item => item.id === good));
  assert.throws(() => publishCuratedEdition(user, { itemIds: [hidden] }), /item_excluded/);
  const issue = publishCuratedEdition(user, { itemIds: [good] });
  // A later source correction must not rewrite an already published issue.
  repo.upsertItems(feed.id, [{ guid: "good", contentSnippet: "[mehr]" }]);
  assert.deepEqual(getEdition(user)!.itemIds, issue.itemIds);
  const emptyPayload = newItemsPushPayload(feed, user, null, [repo.findItemById(hidden)!]);
  assert.equal(emptyPayload, null);
  const mixed = newItemsPushPayload(feed, user, null, [repo.findItemById(hidden)!, { id: good, title: "Real news", content_snippet: "News" }]);
  assert.equal(mixed!.body, "Real news");
});
