import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import express from "express";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

test("the native API manages subscriptions, folders, keywords and articles", async () => {
  const source = createServer((req, res) => {
    const host = `http://${req.headers.host}`;
    const item = (n: number) => `<item><guid>g${n}</guid><title>Story ${n}</title><link>${host}/story${n}</link><pubDate>Thu, 01 Oct 2026 0${n}:00:00 GMT</pubDate><description>&lt;p&gt;Teaser ${n} zirconium&lt;/p&gt;&lt;img src="${host}/pic${n}.png"&gt;</description></item>`;
    if (req.url === "/feed.xml") return res.writeHead(200, { "content-type": "application/rss+xml" }).end(`<?xml version="1.0"?><rss version="2.0"><channel><title>Daily</title><link>${host}/</link>${[1, 2, 3].map(item).join("")}</channel></rss>`);
    if (/^\/story\d$/.test(req.url ?? "")) return res.writeHead(200, { "content-type": "text/html" }).end(`<html><head><title>Story</title></head><body><article><h1>Story</h1>${"<p>Long full text about zirconium and other things worth reading.</p>".repeat(12)}</article></body></html>`);
    if (/^\/pic\d\.png$/.test(req.url ?? "")) return res.writeHead(200, { "content-type": "image/png" }).end(PNG);
    return res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => source.listen(0, "127.0.0.1", resolve));
  const feedUrl = `http://127.0.0.1:${(source.address() as AddressInfo).port}/feed.xml`;

  process.env.DATABASE_PATH = ":memory:";
  process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
  process.env.ALLOW_PRIVATE_FEEDS = "true";
  process.env.ARCHIVE_PATH = mkdtempSync(join(tmpdir(), "feedkeeper-native-archive-"));
  const cacheDir = mkdtempSync(join(tmpdir(), "feedkeeper-native-cache-"));
  process.env.IMAGE_CACHE_PATH = cacheDir;
  const { db, runMigrations } = await import("../src/db/index.js");
  const { v1Router } = await import("../src/api/v1/index.js");
  const { createPersonalAccessToken } = await import("../src/auth/tokens.js");
  const archive = await import("../src/feeds/archive.js");
  runMigrations();

  const addUser = db.prepare("INSERT INTO users (email, password_hash, display_name) VALUES (?, 'hash', ?)");
  const ownerId = Number(addUser.run("native-owner@example.test", "Owner").lastInsertRowid);
  const otherId = Number(addUser.run("native-other@example.test", "Other").lastInsertRowid);
  const device = createPersonalAccessToken(ownerId, "iPhone", "write", { platform: "ios", appVersion: "1.0" }).token;
  const otherDevice = createPersonalAccessToken(otherId, "iPad", "write", { platform: "ios", appVersion: "1.0" }).token;
  const readOnly = createPersonalAccessToken(ownerId, "script", "read").token;

  const app = express();
  app.use(express.json());
  app.use("/api/v1", v1Router);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  const call = async (path: string, token: string | null, init: { method?: string; body?: unknown } = {}) => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (token) headers.authorization = `Bearer ${token}`;
    const response = await fetch(base + path, { method: init.method ?? "GET", headers, body: init.body ? JSON.stringify(init.body) : undefined });
    const type = response.headers.get("content-type") ?? "";
    const raw = Buffer.from(await response.arrayBuffer());
    return { status: response.status, type, raw, body: type.includes("json") && raw.length ? JSON.parse(raw.toString()) : null };
  };

  try {
    assert.equal((await call("/subscriptions", null)).status, 401);

    // Subscribing: the response is the subscription with counts; duplicates are refused.
    const created = await call("/subscriptions", device, { method: "POST", body: { url: feedUrl } });
    assert.equal(created.status, 201);
    const subscriptionId = created.body.id as number;
    assert.equal(created.body.title, "Daily");
    assert.equal(created.body.unreadCount, 3);
    assert.equal((await call("/subscriptions", device, { method: "POST", body: { url: feedUrl } })).status, 409);
    assert.deepEqual((await call("/subscriptions", otherDevice)).body, []);

    // Folders, keywords and settings.
    const folder = (await call("/folders", device, { method: "POST", body: { name: "News" } })).body;
    // Creating a folder that exists returns it, so a retried request is harmless; renaming onto a taken name is refused.
    assert.equal((await call("/folders", device, { method: "POST", body: { name: "News" } })).body.id, folder.id);
    const second = (await call("/folders", device, { method: "POST", body: { name: "Other" } })).body;
    assert.equal((await call(`/folders/${second.id}`, device, { method: "PATCH", body: { name: "News" } })).status, 409);
    await call(`/folders/${second.id}`, device, { method: "DELETE" });
    const patched = (await call(`/subscriptions/${subscriptionId}`, device, { method: "PATCH", body: { label: "My daily", folderId: folder.id, notify: true, badge: true, fullTextMode: "never" } })).body;
    assert.deepEqual([patched.label, patched.folderId, patched.folderName, patched.notify, patched.badge, patched.fullTextMode], ["My daily", folder.id, "News", true, true, "never"]);
    assert.equal((await call(`/subscriptions/${subscriptionId}`, otherDevice, { method: "PATCH", body: { label: "x" } })).status, 404);
    assert.equal((await call(`/folders/${folder.id}`, device, { method: "PATCH", body: { name: "Daily" } })).body.name, "Daily");
    assert.equal((await call("/folders", device)).body[0].subscriptionCount, 1);
    assert.equal((await call("/subscriptions/order", device, { method: "PUT", body: { ids: [subscriptionId] } })).status, 204);
    assert.equal((await call("/subscriptions/order", device, { method: "PUT", body: { ids: [] } })).status, 400);
    const keyword = (await call("/muted-keywords", device, { method: "POST", body: { keyword: "spam" } })).body;
    assert.deepEqual((await call("/muted-keywords", device)).body, [{ id: keyword.id, keyword: "spam" }]);
    assert.equal((await call(`/muted-keywords/${keyword.id}`, device, { method: "DELETE" })).status, 204);

    // Read-only tokens look but do not touch.
    assert.equal((await call("/subscriptions", readOnly)).status, 200);
    assert.equal((await call("/folders", readOnly, { method: "POST", body: { name: "Nope" } })).status, 403);

    // Article list: compact by default, cursor paging, filters and search.
    const page1 = (await call("/items?limit=2", device)).body;
    assert.equal(page1.items.length, 2);
    assert.ok(page1.nextCursor);
    assert.equal("contentHtml" in page1.items[0], false);
    assert.equal(page1.items[0].subscriptionId, subscriptionId);
    const page2 = (await call(`/items?limit=2&before=${page1.nextCursor}`, device)).body;
    assert.equal(page2.items.length, 1);
    assert.equal(page2.nextCursor, null);
    assert.equal((await call("/items?limit=2&before=nonsense", device)).status, 400);
    assert.equal((await call("/items?q=Story%202", device)).body.items.length, 1);
    assert.equal((await call(`/items?subscriptionId=${subscriptionId}&unread=true`, device)).body.items.length, 3);
    assert.deepEqual((await call("/items", otherDevice)).body.items, []);
    const target = page1.items[0].id as number;
    assert.equal((await call(`/items/${target}`, otherDevice)).status, 404);

    // State comes through mutations; the list shows it and the reading position.
    await call("/mutations", device, { method: "POST", body: { mutations: [
      { id: "native-test-0001", type: "item.read", itemId: target, value: true, at: new Date(Date.now() + 1000).toISOString() },
      { id: "native-test-0002", type: "item.progress", itemId: target, position: 0.5, at: new Date(Date.now() + 1000).toISOString() },
    ] } });
    assert.equal((await call("/items?unread=true", device)).body.items.length, 2);
    const detail = (await call(`/items/${target}`, device)).body;
    assert.deepEqual([detail.state.read, detail.state.progress], [true, 0.5]);
    assert.match(detail.contentHtml, /Teaser/);

    // Several articles in one request, with images going through this server.
    const bundle = (await call(`/items/bundle?ids=${page1.items.map((item: { id: number }) => item.id).join(",")},999999`, device)).body.items;
    assert.equal(bundle.length, 2);
    const proxied = /\/api\/v1\/items\/(\d+)\/image\?src=([^"]+)"/.exec(bundle[0].contentHtml);
    assert.ok(proxied, bundle[0].contentHtml);
    const media = await call(`/items/${proxied[1]}/image?src=${proxied[2]}`, device);
    assert.deepEqual([media.status, media.type], [200, "image/png"]);
    assert.equal((await call(`/items/${proxied[1]}/image?src=${proxied[2]}`, otherDevice)).status, 404);
    assert.equal((await call(`/items/${proxied[1]}/image?src=${encodeURIComponent("http://127.0.0.1/other.png")}`, device)).status, 404);

    // Full text, then saving archives it and its images, which are served under the v1 path.
    assert.equal((await call(`/items/${target}/full-text`, device, { method: "POST" })).body.error, "full_text_disabled");
    await call(`/subscriptions/${subscriptionId}`, device, { method: "PATCH", body: { fullTextMode: "auto" } });
    const full = await call(`/items/${target}/full-text`, device, { method: "POST" });
    assert.equal(full.status, 200);
    assert.match(full.body.fullTextHtml, /zirconium/);
    assert.equal(full.body.hasFullText, true);
    await call("/mutations", device, { method: "POST", body: { mutations: [{ id: "native-test-0003", type: "item.save", itemId: target, value: true, at: new Date(Date.now() + 2000).toISOString() }] } });
    await archive.archiveIdle();
    const saved = (await call("/items?saved=true", device)).body.items;
    assert.equal(saved.length, 1);
    assert.ok(saved[0].state.archivedAt);
    const archived = (await call(`/items/${target}`, device)).body;
    const archiveUrl = /\/api\/v1\/archive\/images\/(\d+)/.exec(archived.contentHtml + archived.fullTextHtml + archived.imageUrl);
    assert.ok(archiveUrl);
    assert.equal((await call(`/archive/images/${archiveUrl[1]}`, device)).status, 200);
    assert.equal((await call(`/archive/images/${archiveUrl[1]}`, otherDevice)).status, 404);

    // Mark everything read, overview, OPML and removing the subscription.
    assert.equal((await call("/items/read-all", device, { method: "POST", body: { subscriptionId } })).body.marked, 2);
    assert.equal((await call("/overview", device)).body.unread, 0);
    const opml = await call("/opml", device);
    assert.match(opml.raw.toString(), /<opml/);
    assert.equal((await call(`/subscriptions/${subscriptionId}`, otherDevice, { method: "DELETE" })).status, 404);
    assert.equal((await call(`/subscriptions/${subscriptionId}`, device, { method: "DELETE" })).status, 204);
    assert.equal((await call("/subscriptions", device)).body.length, 0);
    // The saved article stays readable after unsubscribing.
    assert.equal((await call(`/items/${target}`, device)).status, 200);
  } finally {
    await archive.stopImageCache();
    rmSync(cacheDir, { recursive: true, force: true });
    server.close();
    source.close();
  }
});
