import assert from "node:assert/strict";
import { test } from "node:test";
import { authorLine } from "../src/feeds/author.js";
import { cleanReaderHtml } from "../src/feeds/contentNoise.js";

const feed = { title: "Engadget - Technology News", url: "https://www.engadget.com/rss.xml" };

test("an author is the name a feed gives, however the feed writes it", () => {
  assert.equal(authorLine("Michael Bartl", feed), "Michael Bartl");
  assert.equal(authorLine("staff@engadget.com (Mariella Moon)", feed), "Mariella Moon");
  assert.equal(authorLine("Stefan Eiselin <stefan@aerotelegraph.com>", feed), "Stefan Eiselin");
  assert.equal(authorLine("von Anna Muster", feed), "Anna Muster");
  assert.equal(authorLine("Ben", feed), "Ben");
  assert.equal(authorLine("Anna &amp; Ben Muster", feed), "Anna, Ben Muster");
});

test("every distinct author is kept, in order", () => {
  assert.equal(authorLine(["Anna Muster", "Ben Beispiel", "anna muster"], feed), "Anna Muster, Ben Beispiel");
  assert.equal(authorLine("Anna Muster; Ben Beispiel und Carl Probe", feed), "Anna Muster, Ben Beispiel, Carl Probe");
  assert.equal(authorLine("Anna Muster, Ben Beispiel", feed), "Anna Muster, Ben Beispiel");
});

test("addresses without a name, generic names and the publication itself are no authors", () => {
  assert.equal(authorLine("staff@engadget.com", feed), null);
  assert.equal(authorLine(["admin", "Redaktion", "unknown"], feed), null);
  assert.equal(authorLine("Engadget", feed), null);
  assert.equal(authorLine("engadget.com", feed), null);
  assert.equal(authorLine("https://example.test/autor", feed), null);
  assert.equal(authorLine(undefined, feed), null);
  assert.equal(authorLine(["", 5, null], feed), null);
});

test("a byline that only repeats the feed's author is left out of the reader", () => {
  const body = `<p>${"Ein langer Absatz mit viel Text. ".repeat(8)}</p>`;
  const html = '<p>von <a href="https://example.test/a">Michael Bartl</a> I 15.10.2026 - 11:41</p>' + body;
  assert.doesNotMatch(cleanReaderHtml(html, "Title", {}, "Michael Bartl"), /Bartl/);
  assert.match(cleanReaderHtml(html, "Title", {}, "Anna Muster"), /Michael Bartl/, "another name: the line stays (with its date taken off)");
  const two = "<p>von Anna Muster und Ben Beispiel | 3. Mai 2026</p>" + body;
  assert.doesNotMatch(cleanReaderHtml(two, "Title", {}, "Anna Muster, Ben Beispiel"), /Muster/);
  assert.match(cleanReaderHtml(two, "Title", {}, "Anna Muster, Carl Probe"), /Anna Muster und Ben Beispiel/);
});

process.env.DATABASE_PATH = ":memory:";
process.env.SESSION_SECRET = "author-tests-only-at-least-32-characters-long";

test("the author is stored with the item, filled in on a later poll and served by the API", async () => {
  const { db, runMigrations } = await import("../src/db/index.js");
  const repo = await import("../src/feeds/repository.js");
  const { serializeItem } = await import("../src/api/v1/serialize.js");
  runMigrations();
  const feed = Number(db.prepare("INSERT INTO feeds(url) VALUES ('https://author.example.test/feed')").run().lastInsertRowid);
  repo.upsertItems(feed, [{ guid: "a", title: "Story", contentHtml: "<p>Text</p>" }]);
  const id = Number((db.prepare("SELECT id FROM items WHERE guid = 'a'").get() as { id: number }).id);
  assert.equal(repo.findItemById(id)!.author, null);
  repo.upsertItems(feed, [{ guid: "a", title: "Story", contentHtml: "<p>Text</p>", author: "Anna Muster, Ben Beispiel" }]);
  assert.equal(repo.findItemById(id)!.author, "Anna Muster, Ben Beispiel");
  repo.upsertItems(feed, [{ guid: "a", title: "Story", contentHtml: "<p>Text</p>" }]);
  assert.equal(repo.findItemById(id)!.author, "Anna Muster, Ben Beispiel", "a poll without an author keeps the known one");
  const row = { ...repo.findItemById(id)!, feed_title: "Feed", read: 0, bookmarked: 0 } as unknown as Parameters<typeof serializeItem>[0];
  assert.equal(serializeItem(row, new Map(), false).author, "Anna Muster, Ben Beispiel");
  const revision = repo.findItemById(id)!.content_revision;
  repo.upsertItems(feed, [{ guid: "a", title: "Story", contentHtml: "<p>Text</p>", author: "Anna Muster, Ben Beispiel" }]);
  assert.equal(repo.findItemById(id)!.content_revision, revision, "the same author again changes nothing");
  repo.upsertItems(feed, [{ guid: "a", title: "Story", contentHtml: "<p>Text</p>", author: "Carl Probe" }]);
  assert.equal(repo.findItemById(id)!.content_revision, revision + 1, "a changed author is a new revision, so clients that hold the item learn of it");
  assert.equal(repo.findItemById(id)!.extraction_status, "pending", "the extraction status is left alone");
});
