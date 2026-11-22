import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { parseFeedBody, resolveFeedIconUrls } from "../src/feeds/feedParser.js";

test("parseFeedBody parses JSON Feed v1.1 and v1 fields", async () => {
  const jsonFeed = JSON.stringify({
    version: "https://jsonfeed.org/version/1.1",
    title: "My &amp; Tech Blog",
    home_page_url: "https://example.org",
    description: "Notes on software",
    icon: "/icon-512.png",
    favicon: "https://example.org/favicon.ico",
    items: [
      {
        id: "post-1",
        url: "https://example.org/post-1",
        title: "First Post",
        content_html: "<p>Hello <b>world</b></p>",
        summary: "Short summary",
        image: "https://example.org/hero.jpg",
        date_published: "2026-11-19T12:00:00Z",
        authors: [{ name: "Alice" }, { name: "Bob" }],
      },
      {
        id: 42,
        external_url: "https://other.org/ext",
        title: "Text Only",
        content_text: "Plain text body",
        date_modified: "2026-11-18T10:00:00Z",
        author: { name: "Carol" },
        attachments: [
          { url: "https://example.org/audio.mp3", mime_type: "audio/mpeg" },
          { url: "https://example.org/cover.webp", mime_type: "image/webp" },
        ],
      },
    ],
  });

  const parsed = await parseFeedBody(jsonFeed);
  assert.equal(parsed.mimeType, "application/feed+json");
  assert.equal(parsed.title, "My & Tech Blog");
  assert.equal(parsed.link, "https://example.org");
  assert.deepEqual(resolveFeedIconUrls(parsed, "https://example.org/feed.json"), {
    icons: ["https://example.org/favicon.ico", "https://example.org/icon-512.png"],
    logos: ["https://example.org/icon-512.png"],
  });

  assert.equal(parsed.items.length, 2);
  assert.deepEqual(parsed.items[0], {
    guid: "post-1",
    title: "First Post",
    link: "https://example.org/post-1",
    contentSnippet: "Short summary",
    contentHtml: "<p>Hello <b>world</b></p>",
    publishedAt: "2026-11-19T12:00:00.000Z",
    imageUrl: "https://example.org/hero.jpg",
    authors: ["Alice", "Bob"],
    enclosureUrl: null,
    enclosureType: null,
    enclosureDurationSeconds: null,
    chaptersUrl: null,
  });
  assert.deepEqual(parsed.items[1], {
    guid: "42",
    title: "Text Only",
    link: "https://other.org/ext",
    contentSnippet: "Plain text body",
    contentHtml: null,
    publishedAt: "2026-11-18T10:00:00.000Z",
    imageUrl: "https://example.org/cover.webp",
    authors: ["Carol"],
    enclosureUrl: "https://example.org/audio.mp3",
    enclosureType: "audio/mpeg",
    enclosureDurationSeconds: null,
    chaptersUrl: null,
  });
});

test("parseFeedBody rejects non-feed JSON objects", async () => {
  await assert.rejects(parseFeedBody('{"hello":"world"}'));
  await assert.rejects(parseFeedBody('{"version":"https://jsonfeed.org/version/1.1","items":"nope"}'));
});

test("JSON Feed can be polled and probed end-to-end", async () => {
  const server = createServer((req, res) => {
    const host = `http://${req.headers.host}`;
    if (req.url === "/feed.json") {
      res.writeHead(200, { "content-type": "application/feed+json" }).end(JSON.stringify({
        version: "https://jsonfeed.org/version/1.1",
        title: "JSON Poller Test",
        home_page_url: `${host}/`,
        items: [
          {
            id: "item-1",
            url: `${host}/article-1`,
            title: "JSON Article",
            content_html: "<p>Body</p>",
            date_published: "2026-11-19T15:00:00Z",
          },
        ],
      }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  process.env.DATABASE_PATH = ":memory:";
  process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
  process.env.ALLOW_PRIVATE_FEEDS = "true";
  const { db, runMigrations } = await import("../src/db/index.js");
  const { subscribeToFeed } = await import("../src/feeds/service.js");
  const { probeFeed, stopPollingScheduler } = await import("../src/feeds/poller.js");
  runMigrations();

  try {
    const probe = await probeFeed(`${base}/feed.json`);
    assert.deepEqual(probe, { title: "JSON Poller Test", itemCount: 1 });

    const userId = Number(db.prepare("INSERT INTO users (email, password_hash, display_name) VALUES ('j@example.test', 'hash', 'J')").run().lastInsertRowid);
    const sub = await subscribeToFeed(userId, `${base}/feed.json`);
    assert.equal(sub.title, "JSON Poller Test");
    const items = db.prepare("SELECT guid, title, link FROM items WHERE feed_id = ?").all(sub.id) as Array<{ guid: string; title: string; link: string }>;
    assert.deepEqual(items, [{ guid: "item-1", title: "JSON Article", link: `${base}/article-1` }]);
  } finally {
    await stopPollingScheduler();
    server.close();
    db.close();
  }
});
