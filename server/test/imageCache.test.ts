import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ImageCache, ImageCacheBusyError } from "../src/feeds/imageCache.js";
import { readImageCacheSettings } from "../src/feeds/imageCacheSettings.js";
import { FeedHttpError } from "../src/feeds/fetcher.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const settings = readImageCacheSettings({});
const image = async () => ({ buffer: PNG });

test("shared image cache", async (t) => {
  await t.test("same feed and URL share one download; other feeds and tokens stay separate", async (t) => {
    const path = await mkdtemp(join(tmpdir(), "feedkeeper-cache-"));
    const cache = new ImageCache({ ...settings, path });
    t.after(async () => { await cache.close(); await rm(path, { recursive: true, force: true }); });
    let downloads = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const load = async () => { downloads++; await gate; return image(); };
    const requests = Array.from({ length: 100 }, () => cache.get(1, "https://example.test/image?token=secret", load));
    release();
    const images = await Promise.all(requests);
    assert.equal(downloads, 1);
    assert.ok(images.every((row) => typeof row === "object" && row.buffer.equals(PNG)));
    await cache.get(1, "https://example.test/image?token=secret", load);
    assert.equal(downloads, 1);
    await cache.get(2, "https://example.test/image?token=secret", load);
    await cache.get(1, "https://example.test/image?token=different", load);
    assert.equal(downloads, 3);
    assert.equal(cache.metrics().shared, 99);
    assert.doesNotMatch(await readFile(join(path, "index.json"), "utf8"), /secret|example\.test|token/);
  });

  await t.test("active work and waiting work have hard limits, including duplicate callers", async (t) => {
    const cache = new ImageCache({ ...settings, maxBytes: 0, concurrency: 1, maxWaiters: 1 });
    t.after(() => cache.close());
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let active = 0;
    let maximum = 0;
    const load = async () => { active++; maximum = Math.max(maximum, active); await gate; active--; return image(); };
    const a = cache.get(1, "https://example.test/a", load);
    const b = cache.get(1, "https://example.test/b", load);
    const shared = cache.get(1, "https://example.test/a", load);
    await assert.rejects(cache.get(1, "https://example.test/c", load), ImageCacheBusyError);
    assert.deepEqual([cache.metrics().running, cache.metrics().pending], [1, 1]);
    release();
    await Promise.all([a, b, shared]);
    assert.equal(maximum, 1);
  });

  await t.test("LRU eviction respects both bytes and entries; expired and deleted files recover", async (t) => {
    const path = await mkdtemp(join(tmpdir(), "feedkeeper-cache-"));
    let now = 1_000;
    const cache = new ImageCache({ ...settings, path, maxBytes: PNG.length * 2, maxEntries: 2, ttlMs: 100 }, () => now);
    t.after(async () => { await cache.close(); await rm(path, { recursive: true, force: true }); });
    let downloads = 0;
    const load = async () => { downloads++; return image(); };
    await cache.get(1, "a", load);
    now++;
    const b = await cache.get(1, "b", load);
    now++;
    await cache.get(1, "a", load);
    now++;
    await cache.get(1, "c", load);
    assert.equal(downloads, 3);
    assert.deepEqual([cache.metrics().entries, cache.metrics().bytes], [2, PNG.length * 2]);
    assert.ok(typeof b === "object" && b.path);
    await assert.rejects(stat(b.path), { code: "ENOENT" });
    const a = await cache.get(1, "a", load);
    assert.ok(typeof a === "object" && a.path);
    await unlink(a.path);
    await cache.get(1, "a", load);
    assert.equal(downloads, 4);
    now += 101;
    await cache.get(1, "a", load);
    assert.equal(downloads, 5);
    assert.equal((await readdir(path)).filter((file) => file.endsWith(".img")).length, 1);
    // Byte limit works independently of the entry limit.
    const large = { buffer: Buffer.concat([PNG, Buffer.alloc(PNG.length)]) };
    await cache.get(1, "large", async () => large);
    assert.deepEqual([cache.metrics().entries, cache.metrics().bytes], [1, PNG.length * 2]);
    await cache.get(1, "oversize", async () => ({ buffer: Buffer.concat([large.buffer, PNG]) }));
    assert.equal(cache.metrics().bytes, PNG.length * 2);
  });

  await t.test("only missing images and unsupported formats get a short negative cache", async (t) => {
    let now = 1_000;
    const cache = new ImageCache({ ...settings, maxBytes: 0, negativeTtlMs: 100 }, () => now);
    t.after(() => cache.close());
    let downloads = 0;
    const missing = async () => { downloads++; throw new FeedHttpError(404, undefined, "example.test"); };
    await assert.rejects(cache.get(1, "missing", missing), FeedHttpError);
    await assert.rejects(cache.get(1, "missing", missing), FeedHttpError);
    assert.equal(downloads, 1);
    now += 101;
    await assert.rejects(cache.get(1, "missing", missing), FeedHttpError);
    assert.equal(downloads, 2);
    for (const status of [403, 429, 500, 503]) {
      let attempts = 0;
      const load = async () => { attempts++; throw new FeedHttpError(status, undefined, "example.test"); };
      await assert.rejects(cache.get(1, `status-${status}`, load));
      await assert.rejects(cache.get(1, `status-${status}`, load));
      assert.equal(attempts, 2);
    }
    assert.equal(await cache.get(1, "svg", async () => ({ buffer: Buffer.from("<svg/>") })), "unsupported");
    assert.equal(await cache.get(1, "svg", image), "unsupported");
    now += 101;
    assert.notEqual(await cache.get(1, "svg", image), "unsupported");
  });

  await t.test("restart reuses files, removes orphans and recovers corrupted metadata", async () => {
    const path = await mkdtemp(join(tmpdir(), "feedkeeper-cache-"));
    let cache = new ImageCache({ ...settings, path });
    try {
      await cache.get(1, "a", image);
      await cache.close();
      const orphan = join(path, `${"f".repeat(64)}.img`);
      await writeFile(orphan, PNG);
      cache = new ImageCache({ ...settings, path });
      await cache.get(1, "a", async () => { throw new Error("must reuse disk cache"); });
      await assert.rejects(stat(orphan), { code: "ENOENT" });
      await cache.close();
      await writeFile(join(path, "index.json"), "interrupted JSON");
      cache = new ImageCache({ ...settings, path });
      await cache.get(1, "b", image);
      assert.equal(cache.metrics().entries, 1);
    } finally { await cache.close(); await rm(path, { recursive: true, force: true }); }
  });

  await t.test("source policy and failed storage do not prevent delivery", async () => {
    const path = await mkdtemp(join(tmpdir(), "feedkeeper-cache-"));
    let cache = new ImageCache({ ...settings, path });
    try {
      let downloads = 0;
      const load = async () => { downloads++; return { buffer: PNG, cacheTtlMs: 0 }; };
      await cache.get(1, "private", load);
      await cache.get(1, "private", load);
      assert.equal(downloads, 2);
      assert.equal(cache.metrics().bytes, 0);
      await cache.close();
      const badPath = join(path, "file");
      await writeFile(badPath, "not a directory");
      cache = new ImageCache({ ...settings, path: badPath });
      assert.notEqual(await cache.get(1, "a", image), "unsupported");
      assert.equal(cache.metrics().storageErrors, 1);
    } finally { await cache.close(); await rm(path, { recursive: true, force: true }); }
  });

  await t.test("shutdown aborts active downloads and clears waiting jobs", async () => {
    const cache = new ImageCache({ ...settings, maxBytes: 0, concurrency: 1 });
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const load = (signal: AbortSignal) => new Promise<{ buffer: Buffer }>((_resolve, reject) => {
      started();
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
    const a = cache.get(1, "a", load);
    const b = cache.get(1, "b", load);
    const settled = Promise.allSettled([a, b]);
    await ready;
    await cache.close();
    assert.ok((await settled).every((row) => row.status === "rejected"));
    await assert.rejects(cache.get(1, "c", image), ImageCacheBusyError);
    assert.deepEqual([cache.metrics().running, cache.metrics().pending], [0, 0]);
  });

  await t.test("deadlines include queue waiting without releasing a still-running worker", async () => {
    const previous = process.env.POLL_REQUEST_TIMEOUT_MS;
    process.env.POLL_REQUEST_TIMEOUT_MS = "100";
    const cache = new ImageCache({ ...settings, maxBytes: 0, concurrency: 1, maxWaiters: 1 });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    // A deliberately uncooperative loader models filesystem I/O that cannot stop immediately.
    const a = cache.get(1, "a", async () => { await gate; return image(); });
    const b = cache.get(1, "b", image);
    const settled = Promise.allSettled([a, b]);
    const keepAlive = setTimeout(() => undefined, 2_000);
    try {
      const start = Date.now();
      assert.ok((await settled).every((row) => row.status === "rejected"));
      assert.ok(Date.now() - start < 1_000);
      assert.deepEqual([cache.metrics().running, cache.metrics().pending], [1, 0]);
    } finally {
      clearTimeout(keepAlive);
      release();
      await cache.close();
      if (previous === undefined) delete process.env.POLL_REQUEST_TIMEOUT_MS;
      else process.env.POLL_REQUEST_TIMEOUT_MS = previous;
    }
  });

  await t.test("invalid settings fail early", () => {
    assert.throws(() => readImageCacheSettings({ IMAGE_CACHE_MAX_BYTES: "-1" }), /IMAGE_CACHE_MAX_BYTES/);
    assert.throws(() => readImageCacheSettings({ IMAGE_CACHE_CONCURRENCY: "0" }), /IMAGE_CACHE_CONCURRENCY/);
    assert.equal(readImageCacheSettings({ IMAGE_CACHE_MAX_BYTES: "0" }).maxBytes, 0);
  });
});
