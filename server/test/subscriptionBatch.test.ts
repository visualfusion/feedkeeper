import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import express from "express";

test("subscribing in a batch answers at once, keeps working on the feeds and can be repeated", async () => {
  let slowHits = 0;
  const source = createServer((req, res) => {
    const feed = (title: string) => `<?xml version="1.0"?><rss version="2.0"><channel><title>${title}</title><item><guid>${title}-1</guid><title>${title} one</title></item></channel></rss>`;
    if (req.url === "/one.xml") return res.writeHead(200, { "content-type": "application/rss+xml" }).end(feed("One"));
    if (req.url === "/two.xml") return res.writeHead(200, { "content-type": "application/rss+xml" }).end(feed("Two"));
    if (req.url === "/slow.xml") { slowHits++; return void setTimeout(() => res.writeHead(200, { "content-type": "application/rss+xml" }).end(feed("Slow")), 1200); }
    return res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => source.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(source.address() as AddressInfo).port}`;

  process.env.DATABASE_PATH = ":memory:";
  process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
  process.env.ALLOW_PRIVATE_FEEDS = "true";
  process.env.ARCHIVE_PATH = mkdtempSync(join(tmpdir(), "feedkeeper-batch-archive-"));
  const cacheDir = mkdtempSync(join(tmpdir(), "feedkeeper-batch-cache-"));
  process.env.IMAGE_CACHE_PATH = cacheDir;
  const { db, runMigrations } = await import("../src/db/index.js");
  const { v1Router } = await import("../src/api/v1/index.js");
  const { createPersonalAccessToken } = await import("../src/auth/tokens.js");
  const archive = await import("../src/feeds/archive.js");
  const poller = await import("../src/feeds/poller.js");
  runMigrations();

  const addUser = db.prepare("INSERT INTO users (email, password_hash, display_name) VALUES (?, 'hash', ?)");
  const ownerId = Number(addUser.run("batch-owner@example.test", "Owner").lastInsertRowid);
  const otherId = Number(addUser.run("batch-other@example.test", "Other").lastInsertRowid);
  const device = createPersonalAccessToken(ownerId, "iPhone", "write", { platform: "ios", appVersion: "1.0" }).token;
  const otherDevice = createPersonalAccessToken(otherId, "iPad", "write", { platform: "ios", appVersion: "1.0" }).token;
  const readOnly = createPersonalAccessToken(ownerId, "script", "read").token;

  const app = express();
  app.use(express.json());
  app.use("/api/v1", v1Router);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  const call = async (path: string, token: string, init: { method?: string; body?: unknown } = {}) => {
    const response = await fetch(base + path, {
      method: init.method ?? "GET",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };

  try {
    const meta = (await call("/meta", device)).body;
    assert.ok(meta.features.includes("subscriptions.batch"));
    assert.equal(meta.limits.maxSubscriptionBatch, 200);

    const items = [
      { url: `${origin}/one.xml`, folder: "News" },
      { url: `${origin}/two.xml`, label: "Second", folder: "News" },
      { url: `${origin}/slow.xml`, folder: "Slow ones" },
      { url: "not a url" },
    ];
    const started = Date.now();
    const sent = await call("/subscriptions/batch", device, { method: "POST", body: { items } });
    assert.ok(Date.now() - started < 1000, "the answer does not wait for the slow source");
    assert.equal(sent.status, 200);
    assert.deepEqual(sent.body.results.map((result: { url: string; status: string }) => [result.url, result.status]), [
      [items[0].url, "added"], [items[1].url, "added"], [items[2].url, "added"], ["not a url", "invalid"],
    ]);
    assert.equal(sent.body.results[3].reason, "invalid_url");
    assert.deepEqual([sent.body.added, sent.body.exists, sent.body.invalid], [3, 0, 1]);

    const listed = (await call("/subscriptions", device)).body as Array<{ id: number; folderName: string | null; label: string | null; lastSuccessAt: string | null }>;
    assert.equal(listed.length, 3);
    assert.deepEqual(listed.map((subscription) => subscription.id).sort(), sent.body.results.slice(0, 3).map((result: { subscriptionId: number }) => result.subscriptionId).sort());
    assert.deepEqual(listed.map((subscription) => subscription.folderName).sort(), ["News", "News", "Slow ones"]);
    assert.equal(listed.find((subscription) => subscription.label === "Second")?.folderName, "News");
    assert.equal((await call("/folders", device)).body.length, 2, "folders are used by name, one per name");

    // The feeds are read in the background, including the one that took long.
    const end = Date.now() + 5000;
    for (;;) {
      const now = (await call("/subscriptions", device)).body as Array<{ lastSuccessAt: string | null }>;
      if (now.every((subscription) => subscription.lastSuccessAt)) break;
      assert.ok(Date.now() < end, "all feeds are fetched after the answer");
      await sleep(25);
    }

    // The status counts show the progress of the first fetch.
    const ids = sent.body.results.slice(0, 3).map((result: { subscriptionId: number }) => result.subscriptionId).join(",");
    assert.deepEqual((await call(`/subscriptions/status?ids=${ids}`, device)).body, { total: 3, loaded: 3, failed: 0, waiting: 0 });
    assert.equal((await call(`/subscriptions/status?ids=${ids}`, otherDevice)).body.total, 0, "another account sees none of them");
    assert.equal((await call("/subscriptions/status?ids=abc", device)).status, 400);
    assert.equal((await call("/subscriptions/status", device)).status, 400);

    // The same list again changes nothing; another account joins the shared feeds.
    const again = await call("/subscriptions/batch", device, { method: "POST", body: { items: items.slice(0, 3) } });
    assert.deepEqual([again.body.added, again.body.exists, again.body.invalid], [0, 3, 0]);
    assert.equal(slowHits, 1);
    assert.equal((await call("/folders", device)).body.length, 2);
    const shared = await call("/subscriptions/batch", otherDevice, { method: "POST", body: { items: [items[0]] } });
    assert.equal(shared.body.results[0].status, "added");
    assert.equal(shared.body.results[0].subscriptionId, sent.body.results[0].subscriptionId);

    // Limits and rights.
    assert.equal((await call("/subscriptions/batch", device, { method: "POST", body: { items: [] } })).status, 400);
    const tooMany = Array.from({ length: 201 }, (_, index) => ({ url: `${origin}/feed-${index}.xml` }));
    assert.equal((await call("/subscriptions/batch", device, { method: "POST", body: { items: tooMany } })).status, 400);
    assert.equal((await call("/subscriptions/batch", readOnly, { method: "POST", body: { items: items.slice(0, 1) } })).status, 403);
  } finally {
    await poller.stopPollingScheduler();
    await archive.stopImageCache();
    rmSync(cacheDir, { recursive: true, force: true });
    server.close();
    source.closeAllConnections();
    source.close();
  }
});
