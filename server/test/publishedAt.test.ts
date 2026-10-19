import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import Parser from "rss-parser";

const NOW = Date.parse("2026-10-13T08:00:00.000Z");

test("a publish date is kept only when it is a date that can be trusted", async () => {
  const { normalizePublishedAt } = await import("../src/feeds/dates.js");
  const at = (value: unknown) => normalizePublishedAt(value, NOW);

  assert.equal(at("Tue, 13 Oct 2026 08:00:00 GMT"), "2026-10-13T08:00:00.000Z");
  assert.equal(at("2026-10-13T10:00:00+02:00"), "2026-10-13T08:00:00.000Z");
  assert.equal(at("  2026-10-12T22:30:00Z  "), "2026-10-12T22:30:00.000Z");
  assert.equal(at("2026-10-14T07:00:00Z"), "2026-10-14T07:00:00.000Z", "a few hours ahead is clock skew, not an error");

  // Text that is no date: localised weekday names, words, empty values.
  for (const garbage of ["Di, 13 Okt 2026 08:00:00 +0200", "gestern", "Garbage date", "2026-13-45", "", "   ", undefined, null, 5, {}]) {
    assert.equal(at(garbage), null, JSON.stringify(garbage));
  }
  // Placeholders: the epoch, a year nobody published in, the far future.
  for (const placeholder of ["Thu, 01 Jan 1970 00:00:00 GMT", "1970-01-01T00:00:00Z", "0001-01-01T00:00:00Z", "9999-12-31T23:59:59Z", "2099-01-01T00:00:00Z"]) {
    assert.equal(at(placeholder), null, placeholder);
  }
});

test("what the feed parser hands over ends up as a date or as no date", async () => {
  const { normalizePublishedAt } = await import("../src/feeds/dates.js");
  const parser = new Parser();
  const feed = (date: string) => `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title><item><guid>a</guid><title>Item</title><pubDate>${date}</pubDate></item></channel></rss>`;
  const stored = async (date: string) => {
    const item = (await parser.parseString(feed(date))).items[0]!;
    return normalizePublishedAt(item.isoDate ?? item.pubDate, NOW);
  };
  assert.equal(await stored("Tue, 13 Oct 2026 08:00:00 GMT"), "2026-10-13T08:00:00.000Z");
  assert.equal(await stored("Di, 13 Okt 2026 08:00:00 +0200"), null, "localised weekday: previously stored as text and pinned to the top");
  assert.equal(await stored("gestern"), null);
  assert.equal(await stored("Thu, 01 Jan 1970 00:00:00 GMT"), null, "placeholder date: previously made new articles look ancient");
});

test("entries with unusable dates list and age by when they were stored", async (t) => {
  process.env.DATABASE_PATH = ":memory:";
  process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
  const { db, runMigrations } = await import("../src/db/index.js");
  const { listItemsForUser, subscribe } = await import("../src/feeds/repository.js");
  const { runCleanup } = await import("../src/feeds/cleanup.js");
  runMigrations();
  t.after(() => db.close());

  const user = Number(db.prepare("INSERT INTO users (email, password_hash, display_name) VALUES ('reader@example.test', 'hash', 'Reader')").run().lastInsertRowid);
  const feed = Number(db.prepare("INSERT INTO feeds (url, title) VALUES ('https://example.test/feed', 'Feed')").run().lastInsertRowid);
  subscribe(user, feed, null, null);
  const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  const add = db.prepare("INSERT INTO items (feed_id, guid, title, published_at, created_at) VALUES (?, ?, ?, ?, ?)");
  const id = (guid: string, published: string | null, createdDaysAgo: number) =>
    Number(add.run(feed, guid, guid, published, iso(createdDaysAgo)).lastInsertRowid);

  // The state older versions left behind: text where a date should be, and placeholders.
  const real = id("real", iso(1), 1);
  const fresh = id("fresh-without-date", null, 0);
  const german = id("german-weekday", "Di, 13 Okt 2026 08:00:00 +0200", 0);
  const empty = id("empty-string", "", 2);
  const epoch = id("epoch", "1970-01-01T00:00:00.000Z", 0);
  const future = id("year-9999", "9999-12-31T00:00:00.000Z", 0);

  await t.test("the migration turns them into entries without a date", () => {
    db.exec(readFileSync(join(import.meta.dirname, "../src/db/migrations/0032_normalize_published_at.sql"), "utf8"));
    const dates = db.prepare<[], { guid: string; published_at: string | null }>("SELECT guid, published_at FROM items ORDER BY id").all();
    assert.deepEqual(
      Object.fromEntries(dates.map((row) => [row.guid, row.published_at === null ? null : "kept"])),
      { real: "kept", "fresh-without-date": null, "german-weekday": null, "empty-string": null, epoch: null, "year-9999": null },
    );
  });

  await t.test("the list orders them by the time they were stored, among dated entries", () => {
    // Stored today: the four entries without a usable date come before the one stored yesterday, newest first.
    const listed = listItemsForUser(user, { limit: 50 }).map((row) => row.id);
    assert.deepEqual(new Set(listed.slice(0, 4)), new Set([fresh, german, epoch, future]));
    assert.deepEqual(listed.slice(4), [real, empty]);
  });

  await t.test("the age cleanup counts from when they were stored, so new articles are not removed", () => {
    // Before the fix the epoch and the placeholder past made these brand new articles "older than 90 days".
    const result = runCleanup({ retentionReadDays: 0, retentionMaxDays: 90, retentionMaxItemsPerFeed: 0 });
    assert.equal(result.deletedOldItems, 0);
    const left = db.prepare<[], { n: number }>("SELECT COUNT(*) AS n FROM items").get()!.n;
    assert.equal(left, 6);
  });
});
