import { AsyncLocalStorage } from "node:async_hooks";
import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

process.env.DATABASE_PATH = ":memory:";
process.env.SESSION_SECRET = "poll-queue-test-secret-at-least-32-chars";
const { db, runMigrations } = await import("../src/db/index.js");
const { PollQueue, retryDelay } = await import("../src/feeds/pollQueue.js");
const { readPollSettings } = await import("../src/feeds/pollSettings.js");
const { FeedHttpError } = await import("../src/feeds/fetcher.js");
const { createFeed, subscribe } = await import("../src/feeds/repository.js");
runMigrations();
const user = Number(db.prepare("INSERT INTO users(email,password_hash,display_name) VALUES ('queue@example.test','x','Queue')").run().lastInsertRowid);
const settings = { ...readPollSettings(), concurrency: 3, hostConcurrency: 1, maxWaiters: 3, attemptTimeoutMs: 100, retryBaseMs: 20, retryMaxMs: 100, tickMs: 20, maxRetries: 2 };
function feed(host: string, index: string | number) {
  const f = createFeed(`https://${host}/${index}`, 15); subscribe(user, f.id); return f;
}
async function until(check: () => boolean, timeout = 3000) {
  const end = Date.now() + timeout;
  while (!check()) { assert.ok(Date.now() < end, "condition timed out"); await sleep(5); }
}
function reset() { db.exec("DELETE FROM feeds; DELETE FROM feed_poll_hosts"); }

test("poll queue: bounds, host fairness, single-flight, bounded waiters and current feed data", async () => {
  reset();
  let running = 0; let maximum = 0;
  const hosts = new Map<string, number>();
  const seen: number[] = [];
  const q = new PollQueue(async (f, signal) => {
    const host = new URL(f.url).hostname;
    running++; maximum = Math.max(maximum, running);
    hosts.set(host, (hosts.get(host) ?? 0) + 1);
    assert.equal(hosts.get(host), 1);
    seen.push(f.id);
    try { await sleep(25, undefined, { signal }); return { newItems: 1, error: null }; }
    finally { running--; hosts.set(host, hosts.get(host)! - 1); }
  }, () => true, { ...settings, attemptTimeoutMs: 500 });
  const hot = Array.from({ length: 12 }, (_, i) => feed("hot.example.test", i));
  const cold = [feed("cold.example.test", 1), feed("other.example.test", 1)];
  for (const f of [...hot, ...cold]) q.enqueue(f);
  const a = q.submit(hot[0]);
  const b = q.submit(hot[0]);
  assert.equal(a, b, "queued callers share one Promise");
  await until(() => seen.includes(hot[0].id));
  const c = q.submit(hot[0]);
  assert.deepEqual(await a, await c);
  await until(() => q.metrics().pending === 0 && q.metrics().running === 0);
  assert.equal(maximum, 3);
  assert.equal(seen.filter(id => id === hot[0].id).length, 1);
  assert.ok(seen.indexOf(cold[0].id) < 3, "hot host does not hide later hosts");
  assert.equal(new Set(seen).size, 14, "every due feed eventually runs");
  await q.stop();
});

test("poll queue: retries back off, release workers, honor Retry-After and cannot be reset manually", async () => {
  reset();
  const times: number[] = [];
  const faulty = feed("fault.example.test", 1);
  const good = feed("good.example.test", 1);
  const q = new PollQueue(async f => {
    if (f.id === faulty.id) { times.push(Date.now()); throw new FeedHttpError(503, times[0] + 150, "fault.example.test"); }
    return { newItems: 1, error: null };
  }, () => true, { ...settings, concurrency: 1 });
  q.start();
  const first = await q.submit(faulty);
  assert.equal(first.deferred, true);
  assert.ok(first.retryAt! >= times[0] + 150);
  assert.equal((await q.submit(faulty)).deferred, true);
  assert.equal(times.length, 1);
  assert.equal((await q.submit(good)).newItems, 1, "backoff never holds the worker");
  await until(() => times.length === 3);
  await until(() => q.metrics().running === 0);
  await sleep(50);
  assert.equal(times.length, 3, "initial attempt plus two retries only");
  assert.ok(times[1] - times[0] >= 145);
  assert.equal((await q.submit(faulty)).deferred, true);
  assert.equal(times.length, 3, "manual request cannot reset exhausted budget");
  assert.equal(q.metrics().retries, 2);
  await q.stop();
  assert.equal(retryDelay(0, settings, 0), 10);
  assert.equal(retryDelay(1, settings, 1), 40);
  assert.equal(retryDelay(10, settings, 1), 100);
});

test("poll queue: deadline frees capacity, shutdown preserves jobs and restart reloads them", async () => {
  reset();
  const stalled = feed("stalled.example.test", 1);
  const good = feed("good.example.test", 2);
  const q = new PollQueue(async (_f, signal) => { await sleep(10_000, undefined, { signal }); return { newItems: 0, error: null }; }, () => true, { ...settings, concurrency: 1 });
  const result = await q.submit(stalled);
  assert.equal(result.error, "feed_timeout");
  assert.equal(result.deferred, true);
  assert.equal(q.metrics().running, 0);
  const waiting = q.submit(good);
  await until(() => q.metrics().running === 1);
  await q.stop();
  assert.equal((await waiting).deferred, true);
  const draining = feed("draining.example.test", 1);
  assert.equal((await q.submit(draining)).deferred, true);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM feed_poll_jobs").get()!.n, 3, "requests arriving during HTTP drain remain durable");
  const done: number[] = [];
  const restart = new PollQueue(async f => { done.push(f.id); return { newItems: 0, error: null }; }, () => true, settings);
  restart.start(); restart.kick();
  await until(() => restart.metrics().pending === 0 && restart.metrics().running === 0);
  assert.deepEqual(new Set(done), new Set([stalled.id, good.id, draining.id]));
  await restart.stop();
});

test("poll queue: admission is bounded and pending work remains durable after caller timeout", async () => {
  reset();
  const q = new PollQueue(async (_f, signal) => { await sleep(1000, undefined, { signal }); return { newItems: 0, error: null }; }, () => true, { ...settings, concurrency: 1, maxWaiters: 2 });
  const feeds = Array.from({ length: 20 }, (_, i) => feed("bounded.example.test", i));
  const requests = feeds.map(f => q.submit(f));
  assert.ok(q.metrics().waiters <= 2);
  const results = await Promise.all(requests);
  assert.ok(results.filter(result => result.deferred).length >= 18);
  assert.equal(q.metrics().pending, 20);
  await q.stop();
});

test("poll queue: capability changes cancel queued jobs before I/O", async () => {
  reset();
  let allowed = true; let calls = 0;
  const q = new PollQueue(async () => { calls++; return { newItems: 0, error: null }; }, () => allowed, settings);
  const f = feed("access.example.test", 1);
  q.enqueue(f); allowed = false; q.kick();
  await until(() => q.metrics().pending === 0);
  assert.equal(calls, 0);
  await q.stop();
});

test("poll queue: disabling immediate retries still preserves transient initial failures for the regular interval", async () => {
  reset();
  const f = feed("no-extra-retry.example.test", 1);
  const q = new PollQueue(async () => { throw new FeedHttpError(503, undefined, "no-extra-retry.example.test"); }, () => true, { ...settings, maxRetries: 0 });
  const result = await q.submit(f);
  assert.equal(result.deferred, true, "a transient failure must not be treated as an invalid new subscription");
  assert.ok(result.retryAt! >= Date.now() + 899_000);
  assert.equal(q.metrics().retries, 0);
  assert.equal(q.metrics().pending, 1);
  await q.stop();
});

test("background polling must not inherit stale request capability caches", async () => {
  reset();
  const requestCache = new AsyncLocalStorage<boolean>();
  let allowed = true; let calls = 0;
  const q = new PollQueue(async () => { calls++; assert.equal(requestCache.getStore(),undefined); return { newItems: 0, error: null }; }, () => requestCache.getStore() ?? allowed, settings);
  const f = feed("request-cache.example.test",1);
  const result = requestCache.run(true, () => q.submit(f));
  allowed = false;
  assert.equal((await result).error,"feed_poll_not_allowed");
  assert.equal(calls,0,"worker resolves current permissions outside the originating request's cache");
  await q.stop();
});
