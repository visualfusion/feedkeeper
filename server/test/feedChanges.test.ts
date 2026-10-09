import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

const rss = (title: string, guids: string[]) => `<?xml version="1.0"?><rss version="2.0"><channel><title>${title}</title><link>https://example.test</link>${guids
  .map((guid) => `<item><guid>${guid}</guid><title>${guid}</title><link>http://HOST/${guid === "walled" ? "walled" : "article"}</link></item>`)
  .join("")}</channel></rss>`;
const article = `<html><head><title>Story</title></head><body><article><h1>Story</h1>${"<p>A long paragraph about something that matters a lot to readers.</p>".repeat(20)}</article></body></html>`;
const consentPage = `<html><head><title>Cookies zustimmen</title></head><body><h2>Cookies zustimmen</h2><p>Bitte stimmen Sie der Nutzung von Cookies zu oder bestellen Sie ein Abo.</p></body></html>`;

test("feed URL changes are validated and consent walls use article-specific retry delays", async () => {
  const hits: Record<string, number> = {};
  const server = createServer((req, res) => {
    const path = req.url ?? "/";
    hits[path] = (hits[path] ?? 0) + 1;
    const host = req.headers.host ?? "";
    if (path === "/old.xml") return res.writeHead(200, { "content-type": "application/rss+xml" }).end(rss("Old", ["one", "walled"]).replaceAll("HOST", host));
    if (path === "/new.xml") return res.writeHead(200, { "content-type": "application/rss+xml" }).end(rss("New", ["two"]).replaceAll("HOST", host));
    if (path === "/third.xml") return res.writeHead(200, { "content-type": "application/rss+xml" }).end(rss("Third", ["three"]).replaceAll("HOST", host));
    if (path === "/article") return res.writeHead(200, { "content-type": "text/html" }).end(article);
    if (path === "/walled") return res.writeHead(302, { location: "/sonstiges/zustimmung/auswahl.html" }).end();
    if (path.startsWith("/sonstiges/zustimmung/")) return res.writeHead(200, { "content-type": "text/html" }).end(consentPage);
    res.writeHead(404, { "content-type": "text/html" }).end("<html><body>not found</body></html>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  process.env.DATABASE_PATH = ":memory:";
  process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
  process.env.ALLOW_PRIVATE_FEEDS = "true";
  const { db, runMigrations } = await import("../src/db/index.js");
  const { subscribeToFeed, changeFeedUrl, updateFeedSettings } = await import("../src/feeds/service.js");
  const { findItemById, findFeedById, bookmarkItem } = await import("../src/feeds/repository.js");
  const { loadFullText } = await import("../src/feeds/fullText.js");
  runMigrations();

  const addUser = db.prepare("INSERT INTO users (email, password_hash, display_name) VALUES (?, 'hash', ?)");
  const ownerId = Number(addUser.run("changes-owner@example.test", "Owner").lastInsertRowid);
  const otherId = Number(addUser.run("changes-other@example.test", "Other").lastInsertRowid);
  const itemId = (guid: string) => (db.prepare("SELECT id FROM items WHERE guid = ? ORDER BY id DESC LIMIT 1").get(guid) as { id: number }).id;

  try {
    const subscribed = await subscribeToFeed(ownerId, `${base}/old.xml`, "Mine");
    const feedId = subscribed.id;
    bookmarkItem(ownerId, itemId("one"));

    // A broken address never replaces a working one.
    await assert.rejects(changeFeedUrl(ownerId, feedId, `${base}/missing.xml`), /feed_unreachable/);
    assert.equal(findFeedById(feedId)?.url, `${base}/old.xml`);

    // Sole subscriber: the feed moves in place and keeps items, bookmarks and the label.
    const moved = await changeFeedUrl(ownerId, feedId, `${base}/new.xml`);
    assert.equal(moved.previousItemsKept, true);
    assert.equal(moved.subscription.id, feedId);
    assert.equal(moved.subscription.label, "Mine");
    assert.equal(findFeedById(feedId)?.url, `${base}/new.xml`);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM item_bookmarks WHERE user_id = ?").get(ownerId)?.n, 1);
    assert.ok(itemId("two"));

    // Shared feed: the subscription moves to a new feed and the other reader is untouched.
    await subscribeToFeed(otherId, `${base}/new.xml`);
    const split = await changeFeedUrl(ownerId, feedId, `${base}/third.xml`);
    assert.equal(split.previousItemsKept, false);
    assert.notEqual(split.subscription.id, feedId);
    assert.equal(split.subscription.label, "Mine");
    assert.equal(findFeedById(feedId)?.url, `${base}/new.xml`);

    // Full text: a consent wall is remembered for this article, leaving other articles eligible.
    const oldFeed = await subscribeToFeed(otherId, `${base}/old.xml`);
    await assert.rejects(changeFeedUrl(otherId, oldFeed.id, `${base}/new.xml`), /already_subscribed/);
    assert.deepEqual(await loadFullText(otherId, itemId("walled")), { ok: false, error: "consent_wall" });
    assert.equal((await loadFullText(otherId, itemId("walled"), { force: true })).ok, false);
    assert.ok(findItemById(itemId("walled"))?.extraction_retry_at);
    const requestsBefore = hits["/walled"];
    assert.deepEqual(await loadFullText(otherId, itemId("walled")), { ok: false, error: "consent_wall" });
    assert.equal(hits["/walled"], requestsBefore);

    // A successful extraction clears the block.
    const loaded = await loadFullText(otherId, itemId("one"), { force: true });
    assert.equal(loaded.ok, true);
    assert.equal(findFeedById(oldFeed.id)?.full_text_blocked_at, null);

    // Per-subscription opt-out.
    updateFeedSettings(otherId, oldFeed.id, { fullTextMode: "never" });
    assert.deepEqual(await loadFullText(otherId, itemId("walled"), { force: true }), { ok: false, error: "full_text_disabled" });
  } finally {
    await (await import("../src/feeds/poller.js")).stopPollingScheduler();
    server.close();
    db.close();
  }
});
