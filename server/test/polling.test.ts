import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";

process.env.DATABASE_PATH = ":memory:";
process.env.SESSION_SECRET = "poll-integration-secret-at-least-32-chars";
process.env.ALLOW_PRIVATE_FEEDS = "true";
process.env.POLL_CONCURRENCY = "3";
process.env.POLL_HOST_CONCURRENCY = "1";
process.env.POLL_REQUEST_TIMEOUT_MS = "150";
process.env.POLL_ATTEMPT_TIMEOUT_MS = "500";
process.env.POLL_RETRY_BASE_MS = "50";
process.env.POLL_TICK_MS = "20";
const { db, runMigrations } = await import("../src/db/index.js");
const { fetchFeed, fetchImage, parseRetryAfter, FeedHttpError } = await import("../src/feeds/fetcher.js");
const { feedRequests, RequestGate, sourceHost } = await import("../src/feeds/requestGate.js");
const { readPollSettings } = await import("../src/feeds/pollSettings.js");
const repo = await import("../src/feeds/repository.js");
const poller = await import("../src/feeds/poller.js");
const { setPushSender, saveDevice } = await import("../src/push.js");
runMigrations();

function base(server: ReturnType<typeof createServer>) { return `http://127.0.0.1:${(server.address() as AddressInfo).port}`; }
async function listen(server: ReturnType<typeof createServer>) { await new Promise<void>(done => server.listen(0, "127.0.0.1", done)); return base(server); }
async function close(server: ReturnType<typeof createServer>) { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); }

test("Retry-After accepts seconds and HTTP dates, rejecting invalid/negative/fractional delays", () => {
  const now = Date.parse("2026-10-09T12:00:00Z");
  assert.equal(parseRetryAfter("120", now), now + 120000);
  assert.equal(parseRetryAfter("Fri, 09 Oct 2026 12:01:00 GMT", now), now + 60000);
  assert.equal(parseRetryAfter("Thu, 08 Oct 2026 12:01:00 GMT", now), now);
  assert.equal(parseRetryAfter("Friday, 09-Oct-26 12:01:00 GMT", now), now + 60000);
  assert.equal(parseRetryAfter("Fri Oct  9 12:01:00 2026", now), now + 60000);
  for (const value of [null, "", "-5", "1.5", "tomorrow", "Mon nonsense", "Monday October 9 2026"]) assert.equal(parseRetryAfter(value, now), undefined);
});

test("shared HTTP gate: hosts ignore ports, later hosts pass a blocked host, bounded waiters cancel cleanly", async () => {
  const settings = { ...readPollSettings(), concurrency: 2, hostConcurrency: 1, maxWaiters: 2 };
  const gate = new RequestGate(settings);
  assert.equal(sourceHost("https://EXAMPLE.test.:443/a"), "example.test");
  const signal = new AbortController();
  const release = await gate.acquire("one", signal.signal);
  const waiting = gate.acquire("one", signal.signal);
  const releaseOther = await gate.acquire("two", signal.signal);
  assert.equal(gate.stats.running, 2);
  const overflow = gate.acquire("three", signal.signal);
  await assert.rejects(gate.acquire("four", signal.signal), /request_queue_full/);
  signal.abort(new Error("cancelled"));
  await assert.rejects(waiting, /cancelled/);
  await assert.rejects(overflow, /cancelled/);
  release(); releaseOther();
  assert.deepEqual(gate.stats, { running: 0, waiting: 0 });
  gate.stop();
  await assert.rejects(gate.acquire("one", new AbortController().signal), /poll_shutdown/);
});

test("shared HTTP limits are initialized after host startup configuration", async () => {
  const previous = process.env.POLL_CONCURRENCY;
  const gate = new RequestGate();
  process.env.POLL_CONCURRENCY = "1";
  const signal = new AbortController().signal;
  try {
    const release = await gate.acquire("first",signal);
    const waiting = gate.acquire("second",signal);
    assert.deepEqual(gate.stats,{running:1,waiting:1});
    release(); (await waiting)();
  } finally { process.env.POLL_CONCURRENCY = previous; gate.stop(); }
});

test("HTTP deadline covers stalled headers, streaming bodies and redirect chains; slots are released", async () => {
  const source = createServer((req, res) => {
    if (req.url === "/headers") return;
    if (req.url === "/body") { res.writeHead(200); res.write("<rss>"); return; }
    const count = Number(req.url?.slice(1));
    setTimeout(() => res.writeHead(302, { location: `/${count + 1}` }).end(), 35);
  });
  const url = await listen(source);
  try {
    for (const path of ["headers", "body", "0"]) {
      const started = Date.now();
      await assert.rejects(fetchFeed(`${url}/${path}`));
      assert.ok(Date.now() - started < 700, "one deadline for the whole redirect chain");
      assert.equal(feedRequests.stats.running, 0);
    }
  } finally { await close(source); }
});

test("redirect destinations, icons and feed requests share one host limit and persistent cooldown", async () => {
  let running = 0; let maximum = 0; let hits = 0;
  const destination = createServer((req, res) => {
    hits++; running++; maximum = Math.max(maximum, running);
    setTimeout(() => {
      running--;
      if (req.url === "/busy") res.writeHead(429, { "retry-after": "3600" }).end();
      else res.end("<rss><channel><title>Feed</title></channel></rss>");
    }, 15);
  });
  const dest = await listen(destination);
  const redirect = createServer((_req, res) => res.writeHead(302, { location: `${dest}/feed` }).end());
  const redir = await listen(redirect);
  try {
    await Promise.all([fetchFeed(`${redir}/redirect`), fetchImage(`${dest}/image`, 1024), fetchFeed(`${dest}/feed`)]);
    assert.equal(maximum, 1, "ports cannot bypass the hostname budget");
    // Discovery before the first queued poll also persists the shared publisher cooldown.
    await assert.rejects(fetchFeed(`${dest}/busy`), FeedHttpError);
    assert.ok(db.prepare("SELECT retry_at FROM feed_poll_hosts").get()!.retry_at as number > Date.now());
    db.exec("DELETE FROM feed_poll_hosts");
    const f = repo.createFeed(`${dest}/busy`, 15);
    const user = Number(db.prepare("INSERT INTO users(email,password_hash,display_name) VALUES ('http@example.test','x','HTTP')").run().lastInsertRowid);
    repo.subscribe(user, f.id);
    const result = await poller.pollFeed(f);
    assert.equal(result.error, "feed_http_429");
    assert.ok(result.retryAt! >= Date.now() + 3_599_000);
    const before = hits;
    await assert.rejects(fetchFeed(`${dest}/feed`), /poll_deferred/);
    assert.equal(hits, before, "host cooldown blocks discovery/icon requests too");
    assert.ok(db.prepare("SELECT retry_at FROM feed_poll_hosts").get()!.retry_at as number > Date.now());
    db.exec("DELETE FROM feed_poll_hosts; DELETE FROM feed_poll_jobs");
  } finally { await close(destination); await close(redirect); }
});

test("new subscriptions join a known shared feed poll; OPML admits durable work without waiting tasks", async () => {
  let hits = 0;
  const source = createServer((req, res) => {
    if (!req.url?.startsWith("/feed/")) return res.writeHead(404).end();
    hits++;
    setTimeout(() => res.end('<rss version="2.0"><channel><title>Shared</title><item><guid>one</guid><title>One</title></item></channel></rss>'), 5);
  });
  const url = await listen(source);
  const owner = Number(db.prepare("INSERT INTO users(email,password_hash,display_name) VALUES ('shared-owner@example.test','x','Owner')").run().lastInsertRowid);
  const other = Number(db.prepare("INSERT INTO users(email,password_hash,display_name) VALUES ('shared-other@example.test','x','Other')").run().lastInsertRowid);
  const f = repo.createFeed(`${url}/feed/known`,15); repo.subscribe(owner, f.id);
  db.prepare("UPDATE feeds SET icon_checked_at = ? WHERE id = ?").run(new Date().toISOString(), f.id);
  const { subscribeToFeed } = await import("../src/feeds/service.js");
  const { importOpmlFeeds } = await import("../src/feeds/opml.js");
  try {
    const first = poller.pollFeed(f);
    const subscribed = await subscribeToFeed(other, f.url);
    await first;
    assert.equal(subscribed.id, f.id);
    assert.equal(hits, 1, "known source avoids rediscovery beside its shared poll");
    const outlines = Array.from({length:30}, (_,i) => `<outline text="Feed ${i}" xmlUrl="${url}/feed/import-${i}"/>`).join("");
    const result = await importOpmlFeeds(owner, `<opml version="2.0"><body>${outlines}</body></opml>`);
    assert.equal(result.imported,30);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM feed_poll_jobs").get()!.n,30);
    assert.equal(poller.pollingMetrics().waiters,0, "OPML creates no API waiter per feed");
    const end = Date.now() + 3000;
    while (poller.pollingMetrics().pending || poller.pollingMetrics().running) {
      assert.ok(Date.now() < end); await sleep(10);
    }
    assert.equal(hits,31);
  } finally { await close(source); }
});

test("icon capacity pressure does not create a day-long negative cache entry", async () => {
  const previous = process.env.POLL_MAX_WAITERS;
  process.env.POLL_MAX_WAITERS = "2";
  let hits = 0;
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6l8AAAAASUVORK5CYII=", "base64");
  const source = createServer((_req, res) => {
    hits++;
    setTimeout(() => res.writeHead(200,{ "content-type":"image/png" }).end(png),20);
  });
  const url = await listen(source);
  const { loadFeedIcon } = await import("../src/feeds/feedIcon.js");
  const feeds = [0,1,2].map(index => repo.createFeed(`${url}/${index}`,15));
  try {
    const first = loadFeedIcon(feeds[0].id);
    const second = loadFeedIcon(feeds[1].id);
    assert.equal(await loadFeedIcon(feeds[2].id),null);
    assert.ok((await first)?.buffer); assert.ok((await second)?.buffer);
    assert.ok((await loadFeedIcon(feeds[2].id))?.buffer,"overflow can immediately retry once there is room");
    assert.equal(hits,3);
  } finally {
    if (previous === undefined) delete process.env.POLL_MAX_WAITERS; else process.env.POLL_MAX_WAITERS = previous;
    await close(source);
  }
});

test("scheduler plus manual triggers insert and notify once; conditional 304 preserves content and validators", async () => {
  let hits = 0; let notices = 0;
  const source = createServer((req, res) => {
    hits++;
    if (req.headers["if-none-match"] === '"version-one"') {
      assert.equal(req.headers["if-modified-since"], "Thu, 08 Oct 2026 12:00:00 GMT");
      res.writeHead(304).end(); return;
    }
    setTimeout(() => res.writeHead(200, { etag: '"version-one"', "last-modified": "Thu, 08 Oct 2026 12:00:00 GMT" }).end('<rss version="2.0"><channel><title>Example</title><item><guid>one</guid><title>One</title></item></channel></rss>'), 25);
  });
  const url = await listen(source);
  const user = Number(db.prepare("INSERT INTO users(email,password_hash,display_name) VALUES ('once@example.test','x','Once')").run().lastInsertRowid);
  const f = repo.createFeed(`${url}/feed`, 15); repo.subscribe(user, f.id);
  db.prepare("UPDATE feeds SET icon_checked_at = ?, last_success_at = ? WHERE id = ?").run(new Date().toISOString(), new Date().toISOString(), f.id);
  db.prepare("UPDATE subscriptions SET notify = 1 WHERE feed_id = ?").run(f.id);
  saveDevice(user, { endpoint: "https://push.example.test/once", keys: { p256dh: "x", auth: "x" } });
  setPushSender(async () => { notices++; await sleep(5); });
  try {
    await poller.pollDueFeeds();
    const results = await Promise.all(Array.from({ length: 25 }, () => poller.pollFeed(f)));
    assert.equal(hits, 1);
    assert.ok(results.every(result => result.newItems === 1));
    const pushDeadline = Date.now() + 2000;
    while (poller.pollingMetrics().push.pending) {
      assert.ok(Date.now() < pushDeadline, "committed outbox must drain independently of poll result");
      await sleep(5);
    }
    assert.equal(notices, 1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM items WHERE feed_id = ?").get(f.id)!.n, 1);
    const result = await poller.pollFeed(f); // stale Feed object intentionally; queue must reload ETag.
    assert.deepEqual(result, { newItems: 0, error: null });
    assert.equal(hits, 2); assert.equal(notices, 1);
    const current = repo.findFeedById(f.id)!;
    assert.equal(current.etag, '"version-one"');
    assert.equal(current.last_modified, "Thu, 08 Oct 2026 12:00:00 GMT");
    assert.equal(current.consecutive_errors, 0);
    assert.equal(db.prepare("SELECT title FROM items WHERE feed_id = ?").get(f.id)!.title, "One");
  } finally { await close(source); await poller.stopPollingScheduler(); }
});

test("invalid configuration fails rather than silently removing limits", () => {
  const previous = process.env.POLL_CONCURRENCY;
  for (const invalid of ["0", "-1", "NaN", "Infinity", "4.5", "1000"]) {
    process.env.POLL_CONCURRENCY = invalid;
    assert.throws(readPollSettings, /POLL_CONCURRENCY/);
  }
  process.env.POLL_CONCURRENCY = previous;
  assert.equal(new FeedHttpError(503, 1, "example.test").status, 503);
});
