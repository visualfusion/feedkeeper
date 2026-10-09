import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { Resvg } from "@resvg/resvg-js";

const PNG = new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="red"/></svg>').render().asPng();
const LARGE_PNG = new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="green"/></svg>').render().asPng();
const ICO = Buffer.alloc(22 + PNG.length);
ICO.writeUInt16LE(1, 2);
ICO.writeUInt16LE(1, 4);
ICO[6] = 16;
ICO[7] = 16;
ICO.writeUInt16LE(1, 10);
ICO.writeUInt16LE(32, 12);
ICO.writeUInt32LE(PNG.length, 14);
ICO.writeUInt32LE(22, 18);
PNG.copy(ICO, 22);

test("feed icons are served through this server to people who may see the feed", async () => {
  let svgColor = "red";
  let head = '<link rel="icon" href="/declared.svg">';
  const server = createServer((req, res) => {
    const host = `http://${req.headers.host}`;
    switch (req.url) {
      case "/feed.xml":
        if (req.headers["if-none-match"]) return res.writeHead(304).end();
        return res.writeHead(200, { "content-type": "application/rss+xml" }).end(`<?xml version="1.0"?><rss version="2.0"><channel><title>Icons</title><link>${host}/</link><item><guid>a</guid><title>One</title></item></channel></rss>`);
      case "/": return res.writeHead(200, { "content-type": "text/html" }).end(`<html><head>${head}</head></html>`);
      case "/large.png": return res.writeHead(200, { "content-type": "image/png" }).end(LARGE_PNG);
      case "/app/site.webmanifest": return res.writeHead(200, { "content-type": "application/manifest+json" }).end(JSON.stringify({ icons: [
        { src: "/missing.svg", type: "image/svg+xml", sizes: "any" },
        { src: "../large.png", sizes: "192x192 512x512", purpose: "any maskable" },
        { src: "/monochrome.svg", sizes: "any", purpose: "monochrome" },
        { src: "javascript:alert(1)", sizes: "1024x1024" },
        { sizes: "1024x1024" },
      ] }));
      case "/declared.svg": return res.writeHead(200, { "content-type": "image/svg+xml" }).end(`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="${svgColor}"/></svg>`);
      case "/favicon.ico": return res.writeHead(200, { "content-type": "image/x-icon" }).end(ICO);
      case "/page.html": return res.writeHead(200, { "content-type": "text/html" }).end("<html>not an icon</html>");
      default: return res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  process.env.DATABASE_PATH = ":memory:";
  process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
  process.env.ALLOW_PRIVATE_FEEDS = "true";
  const { db, runMigrations } = await import("../src/db/index.js");
  const { subscribeToFeed } = await import("../src/feeds/service.js");
  const { canAccessFeed, getFeedIconHash, loadFeedIcon, refreshFeedIcon } = await import("../src/feeds/feedIcon.js");
  const { discoverIconUrls } = await import("../src/feeds/icon.js");
  const { findFeedById } = await import("../src/feeds/repository.js");
  const { pollFeed } = await import("../src/feeds/poller.js");
  runMigrations();

  const addUser = db.prepare("INSERT INTO users (email, password_hash, display_name) VALUES (?, 'hash', ?)");
  const ownerId = Number(addUser.run("icon-owner@example.test", "Owner").lastInsertRowid);
  const otherId = Number(addUser.run("icon-other@example.test", "Other").lastInsertRowid);

  try {
    const feed = await subscribeToFeed(ownerId, `${base}/feed.xml`);
    assert.equal(canAccessFeed(ownerId, feed.id), true);
    assert.equal(canAccessFeed(otherId, feed.id), false);

    // The icon the site declares wins; SVG is converted to PNG.
    db.prepare("UPDATE feeds SET icon_url = ? WHERE id = ?").run(`${base}/declared.svg`, feed.id);
    const vectorIcon = await loadFeedIcon(feed.id);
    assert.equal(vectorIcon?.mime, "image/png");
    assert.equal(vectorIcon?.buffer.readUInt32BE(16), 512);
    assert.equal(vectorIcon?.buffer.readUInt32BE(20), 512);

    // A feed 304 still rechecks the icon when its weekly check is due.
    const previousHash = getFeedIconHash(feed.id);
    svgColor = "blue";
    db.prepare("UPDATE feeds SET etag = 'old-etag', icon_checked_at = '2020-01-01T00:00:00Z' WHERE id = ?").run(feed.id);
    assert.equal((await pollFeed(findFeedById(feed.id)!)).error, null);
    assert.notEqual(getFeedIconHash(feed.id), previousHash);

    // A missing SVG falls back to the manifest's large PNG before old and small icons.
    head = '<link rel="icon" href="/favicon.ico" sizes="16x16"><link rel="manifest" href="/app/site.webmanifest">';
    assert.deepEqual(await discoverIconUrls(base), [`${base}/missing.svg`, `${base}/large.png`, `${base}/favicon.ico`]);
    db.prepare("UPDATE feeds SET icon_checked_at = NULL WHERE id = ?").run(feed.id);
    assert.equal((await pollFeed(findFeedById(feed.id)!)).error, null);
    assert.deepEqual((await loadFeedIcon(feed.id))?.buffer, LARGE_PNG);
    assert.equal(findFeedById(feed.id)?.icon_url, `${base}/large.png`);

    // Broken manifests retain declared icons; failed downloads retain the last good image.
    head = '<link rel="icon" href="/large.png" sizes="512x512"><link rel="manifest" href="/page.html">';
    assert.deepEqual(await discoverIconUrls(base), [`${base}/large.png`]);
    const goodHash = getFeedIconHash(feed.id);
    db.prepare("UPDATE feeds SET icon_url = ?, site_url = NULL, url = ? WHERE id = ?").run(`${base}/missing.svg`, "not-a-url", feed.id);
    assert.equal(await refreshFeedIcon(feed.id, null, [`${base}/page.html`]), null);
    assert.equal(getFeedIconHash(feed.id), goodHash);
    assert.deepEqual((await loadFeedIcon(feed.id))?.buffer, LARGE_PNG);

    // Otherwise /favicon.ico is tried; things that are not images are never served.
    db.prepare("UPDATE feeds SET icon_url = ?, site_url = ? WHERE id = ?").run(`${base}/page.html`, base, feed.id);
    (await import("../src/feeds/feedIcon.js")).clearIconCache();
    assert.equal((await loadFeedIcon(feed.id))?.mime, "image/png");
    assert.deepEqual((await loadFeedIcon(feed.id))?.buffer, PNG);
  } finally {
    await (await import("../src/feeds/poller.js")).stopPollingScheduler();
    server.close();
  }
});
