import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, stat, unlink } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import express from "express";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};

test("image sharing preserves API permissions, archives and guarded downloads", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "feedkeeper-shared-images-"));
  process.env.DATABASE_PATH = ":memory:";
  process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
  process.env.ALLOW_PRIVATE_FEEDS = "true";
  process.env.ARCHIVE_PATH = join(directory, "archive");
  process.env.IMAGE_CACHE_PATH = join(directory, "cache");
  process.env.IMAGE_CACHE_CONCURRENCY = "1";
  process.env.IMAGE_CACHE_MAX_WAITERS = "1";
  const { db, runMigrations } = await import("../src/db/index.js");
  const repo = await import("../src/feeds/repository.js");
  const archive = await import("../src/feeds/archive.js");
  const { itemsRouter } = await import("../src/api/items.js");
  const { v1Router } = await import("../src/api/v1/index.js");
  runMigrations();
  const addUser = db.prepare("INSERT INTO users (email, password_hash, display_name) VALUES (?, 'hash', 'Reader')");
  const owner = Number(addUser.run("owner@example.test").lastInsertRowid);
  const other = Number(addUser.run("other@example.test").lastInsertRowid);
  const outsider = Number(addUser.run("outsider@example.test").lastInsertRowid);
  const shared = repo.createFeed("https://example.test/shared", 15).id;
  const privateFeed = repo.createFeed("https://example.test/private?token=secret", 15).id;
  repo.subscribe(owner, shared);
  repo.subscribe(other, shared);
  repo.subscribe(owner, privateFeed);
  db.exec("UPDATE subscriptions SET full_text_mode = 'never'");

  const counts = new Map<string, number>();
  let changing = PNG;
  let hold = deferred();
  let started = deferred();
  const source = createServer(async (req, res) => {
    const path = req.url!;
    counts.set(path, (counts.get(path) ?? 0) + 1);
    if (path.startsWith("/hold")) { started.resolve(); await hold.promise; }
    if (path === "/missing.png") return void res.writeHead(404).end();
    if (path === "/redirect.png") return void res.writeHead(302, { location: "/ok.png" }).end();
    if (path === "/bad-redirect.png") return void res.writeHead(302, { location: "file:///etc/passwd" }).end();
    if (path === "/timeout.png") { res.writeHead(200); res.flushHeaders(); return; }
    if (path === "/no-store.png") res.setHeader("Cache-Control", "no-store");
    if (path === "/max-age.png") res.setHeader("Cache-Control", "max-age=0");
    res.writeHead(200, { "content-type": "image/png" }).end(path === "/changing.png" ? changing : PNG);
  });
  await new Promise<void>((resolve) => source.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(source.address() as AddressInfo).port}`;
  const item = (path: string, feed = shared) => Number(db.prepare(
    "INSERT INTO items (feed_id, guid, image_url) VALUES (?, ?, ?)",
  ).run(feed, `${path}-${Math.random()}`, base + path).lastInsertRowid);
  const get = (user: number, id: number, path: string) => archive.fetchItemImage(user, id, base + path);
  const app = express();
  app.use((req, _res, next) => { req.session = { userId: Number(req.get("x-test-user")) }; next(); });
  app.use("/api/items", itemsRouter);
  app.use("/api/v1", v1Router);
  const api = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => api.once("listening", resolve));
  const apiBase = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
  const request = (route: string, id: number, path: string, user = owner) => fetch(`${apiBase}${route}/${id}/image?src=${encodeURIComponent(base + path)}`, { headers: { "x-test-user": String(user) } });
  t.after(async () => {
    hold.resolve();
    await archive.stopImageCache();
    api.closeAllConnections(); api.close();
    source.closeAllConnections(); source.close();
    db.close();
    await rm(directory, { recursive: true, force: true });
  });

  await t.test("many users and both APIs share the same image without granting access", async () => {
    const id = item("/hold-shared.png");
    const a = request("/api/items", id, "/hold-shared.png");
    await started.promise;
    const b = request("/api/v1/items", id, "/hold-shared.png", other);
    hold.resolve();
    const responses = await Promise.all([a, b]);
    assert.ok(responses.every((response) => response.status === 200));
    for (const response of responses) assert.deepEqual(Buffer.from(await response.arrayBuffer()), PNG);
    await Promise.all(Array.from({ length: 100 }, (_, index) => get(index % 2 ? owner : other, id, "/hold-shared.png")));
    assert.equal(counts.get("/hold-shared.png"), 1);
    assert.equal((await request("/api/v1/items", id, "/hold-shared.png", outsider)).status, 404);
    assert.equal(await get(owner, id, "/unlisted.png"), "forbidden");
    const privateId = item("/hold-shared.png", privateFeed);
    assert.equal(await get(other, privateId, "/hold-shared.png"), "forbidden");
    await get(owner, privateId, "/hold-shared.png");
    assert.equal(counts.get("/hold-shared.png"), 2, "different feed contexts do not share cache entries");
  });

  await t.test("full queues return 503 with Retry-After in both APIs", async () => {
    hold = deferred(); started = deferred();
    const aId = item("/hold-a.png");
    const bId = item("/hold-b.png");
    const cId = item("/ok.png");
    const a = get(owner, aId, "/hold-a.png");
    await started.promise;
    const b = get(owner, bId, "/hold-b.png");
    for (const route of ["/api/items", "/api/v1/items"]) {
      const response = await request(route, cId, "/ok.png");
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("retry-after"), "1");
    }
    hold.resolve();
    await Promise.all([a, b]);
  });

  await t.test("revoking access during a download prevents delivery", async () => {
    hold = deferred(); started = deferred();
    const id = item("/hold-revoked.png", privateFeed);
    const loading = get(owner, id, "/hold-revoked.png");
    await started.promise;
    db.prepare("DELETE FROM subscriptions WHERE user_id = ? AND feed_id = ?").run(owner, privateFeed);
    hold.resolve();
    assert.equal(await loading, "forbidden");
  });

  await t.test("archive and cache share bytes and preserve other users' saved copies", async () => {
    const id = item("/archived.png");
    const secondId = item("/archived.png");
    await get(owner, id, "/archived.png");
    repo.bookmarkItem(owner, id);
    repo.bookmarkItem(other, secondId);
    await archive.archiveItem(id);
    await archive.archiveItem(secondId);
    const rows = db.prepare("SELECT id, file_name FROM archived_images WHERE item_id IN (?, ?) ORDER BY item_id").all(id, secondId) as { id: number; file_name: string }[];
    assert.equal(rows.length, 2);
    const firstPath = join(directory, "archive", rows[0].file_name);
    const secondPath = join(directory, "archive", rows[1].file_name);
    assert.equal((await stat(firstPath)).ino, (await stat(secondPath)).ino);
    assert.ok((await stat(firstPath)).nlink >= 3);
    assert.equal(counts.get("/archived.png"), 1);
    for (const file of await readdir(join(directory, "cache"))) if (file.endsWith(".img")) await unlink(join(directory, "cache", file));
    await get(other, secondId, "/archived.png");
    assert.equal(counts.get("/archived.png"), 1, "existing archives repopulate the cache without downloading");
    repo.unbookmarkItem(owner, id); archive.pruneArchive();
    assert.deepEqual(await readFile(secondPath), PNG);
    repo.unbookmarkItem(other, secondId); archive.pruneArchive();
    await assert.rejects(stat(secondPath), { code: "ENOENT" });
    const cachedFiles = (await readdir(join(directory, "cache"))).filter((file) => file.endsWith(".img"));
    assert.ok(cachedFiles.length > 0, "removing archives preserves cached hard links");
    assert.deepEqual(await readFile(join(directory, "cache", cachedFiles[0])), PNG);
    assert.equal(counts.get("/archived.png"), 1);
  });

  await t.test("a saved snapshot cannot replace a new article's image at a reused URL", async () => {
    const saved = item("/changing.png");
    repo.bookmarkItem(owner, saved);
    await archive.archiveItem(saved);
    for (const file of await readdir(join(directory, "cache"))) if (file.endsWith(".img")) await unlink(join(directory, "cache", file));
    changing = Buffer.concat([PNG, Buffer.from("new version")]);
    const fresh = await get(other, item("/changing.png"), "/changing.png");
    assert.ok(typeof fresh === "object" && fresh.buffer.equals(changing));
    const snapshot = await get(owner, saved, "/changing.png");
    assert.ok(typeof snapshot === "object" && snapshot.buffer.equals(PNG));
    assert.equal(counts.get("/changing.png"), 2);
  });

  await t.test("missing sources, source cache policy, redirects and deadlines remain guarded", async () => {
    const missing = item("/missing.png");
    await assert.rejects(get(owner, missing, "/missing.png"));
    await assert.rejects(get(other, missing, "/missing.png"));
    assert.equal(counts.get("/missing.png"), 1);
    const privateImage = item("/no-store.png");
    await get(owner, privateImage, "/no-store.png");
    await get(other, privateImage, "/no-store.png");
    assert.equal(counts.get("/no-store.png"), 2);
    const expiredImage = item("/max-age.png");
    await get(owner, expiredImage, "/max-age.png");
    await get(other, expiredImage, "/max-age.png");
    assert.equal(counts.get("/max-age.png"), 2);
    assert.notEqual(await get(owner, item("/redirect.png"), "/redirect.png"), "unsupported");
    await assert.rejects(get(owner, item("/bad-redirect.png"), "/bad-redirect.png"));
    const previous = process.env.POLL_REQUEST_TIMEOUT_MS;
    process.env.POLL_REQUEST_TIMEOUT_MS = "100";
    try { await assert.rejects(get(owner, item("/timeout.png"), "/timeout.png")); }
    finally { if (previous === undefined) delete process.env.POLL_REQUEST_TIMEOUT_MS; else process.env.POLL_REQUEST_TIMEOUT_MS = previous; }
    process.env.ALLOW_PRIVATE_FEEDS = "false";
    try { await assert.rejects(get(owner, item("/blocked.png"), "/blocked.png")); }
    finally { process.env.ALLOW_PRIVATE_FEEDS = "true"; }
    assert.notEqual(await get(owner, item("/after-error.png"), "/after-error.png"), "unsupported");
  });
});
