import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

const rss = (title: string) => `<?xml version="1.0"?><rss version="2.0"><channel><title>${title}</title><item><guid>1</guid><title>Item</title></item></channel></rss>`;

test("discovery ignores self-referencing feed links and finds feeds on overview pages", async () => {
  const server = createServer((req, res) => {
    const host = `http://${req.headers.host}`;
    const html = (body: string) => res.writeHead(200, { "content-type": "text/html" }).end(`<html><head>${body}</head><body></body></html>`);
    switch (req.url) {
      // Homepage announcing itself as RSS, like deutschlandfunk.de.
      case "/": return html(`<link rel="alternate" type="application/rss+xml" href="${host}/">`);
      // /rss redirects to an overview page whose feed URLs only appear in embedded JSON.
      case "/rss": return res.writeHead(301, { location: "/rss-overview.html" }).end();
      case "/rss-overview.html": return html(`<div data-json="{&quot;pathRss&quot;:&quot;${host}/news.rss&quot;}"></div><div data-json="{&quot;pathRss&quot;:&quot;${host}/broken.rss&quot;}"></div>`);
      case "/news.rss": return res.writeHead(200, { "content-type": "application/rss+xml" }).end(rss("News"));
      case "/broken.rss": return html("not a feed");
      default: return res.writeHead(404).end();
    }
  });
  // A second site without any feed, to check that nothing is subscribed there.
  const plainSite = createServer((_req, res) => res.writeHead(200, { "content-type": "text/html" }).end("<html><body><p>No feeds here</p></body></html>"));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  await new Promise<void>((resolve) => plainSite.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const plainBase = `http://127.0.0.1:${(plainSite.address() as AddressInfo).port}`;

  process.env.DATABASE_PATH = ":memory:";
  process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
  process.env.ALLOW_PRIVATE_FEEDS = "true";
  const { db, runMigrations } = await import("../src/db/index.js");
  const { discoverFeeds } = await import("../src/feeds/discovery.js");
  const { subscribeToFeed } = await import("../src/feeds/service.js");
  runMigrations();

  try {
    assert.deepEqual(await discoverFeeds(`${base}/`), [{ url: `${base}/news.rss`, title: "News", type: "application/rss+xml" }]);

    const userId = Number(db.prepare("INSERT INTO users (email, password_hash, display_name) VALUES ('d@example.test', 'hash', 'D')").run().lastInsertRowid);
    // A page that is not a feed and links to none must not leave a subscription behind.
    await assert.rejects(subscribeToFeed(userId, `${plainBase}/`), /no_feeds_found/);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM subscriptions").get()?.n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM feeds").get()?.n, 0);

    const subscribed = await subscribeToFeed(userId, `${base}/`);
    assert.equal(subscribed.url, `${base}/news.rss`);
  } finally {
    await (await import("../src/feeds/poller.js")).stopPollingScheduler();
    server.close();
    plainSite.close();
    db.close();
  }
});
