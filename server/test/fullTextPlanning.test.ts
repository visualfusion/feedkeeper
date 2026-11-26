import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
process.env.DATABASE_PATH = ":memory:";
process.env.SESSION_SECRET = "planning-test-fixture-only-32-characters";
process.env.ALLOW_PRIVATE_FEEDS = "true";
process.env.FULLTEXT_TIMEOUT_MS = "3000";
const until = async (predicate: () => boolean, timeout = 5000) => {
  const end = Date.now() + timeout;
  while (!predicate()) { assert.ok(Date.now() < end, "fixture deadline"); await sleep(10); }
};

test("publisher pauses expire without being prolonged by direct requests", async () => {
  const { recordFullTextBlock, isBackgroundFullTextPaused, pruneFullTextBlocks } = await import("../src/feeds/fullTextBackoff.js");
  const host = "blocked.example";
  const start = Date.now();
  recordFullTextBlock(host, start);
  recordFullTextBlock(host, start + 1);
  assert.equal(isBackgroundFullTextPaused(host, start + 2), false);
  const blockedAt = start + 2;
  recordFullTextBlock(host, blockedAt);
  recordFullTextBlock(host, blockedAt + 10 * 60_000);
  assert.equal(isBackgroundFullTextPaused(host, blockedAt + 30 * 60_000 - 1), true);
  assert.equal(isBackgroundFullTextPaused(host, blockedAt + 30 * 60_000), false);
  assert.equal(pruneFullTextBlocks(blockedAt + 30 * 60_000), 0);
});

test("durable full texts share triggers, retry without occupying workers and resume after shutdown", async () => {
  const { db, runMigrations } = await import("../src/db/index.js");
  const repo = await import("../src/feeds/repository.js");
  const queue = await import("../src/feeds/fullTextQueue.js");
  const { loadFullText } = await import("../src/feeds/fullText.js");
  runMigrations();
  const requests = new Map<string, number>();
  const starts: string[] = [];
  let hold = false;
  const body = "<html><title>Local fixture</title><article><h1>Local fixture</h1><p>" + "A useful article with facts and context. ".repeat(100) + "</p></article></html>";
  const source = createServer((req, res) => {
    const path = req.url!; starts.push(path); requests.set(path, (requests.get(path) ?? 0) + 1);
    if (path.startsWith("/blocked")) return res.writeHead(403).end();
    if (path === "/unextractable") return res.writeHead(200, { "Content-Type": "text/html" }).end("<html><body><div></div></body></html>");
    if (path === "/retry" && requests.get(path) === 1) return res.writeHead(429, { "Retry-After": "1" }).end();
    if (path === "/retry-date" && requests.get(path) === 1) return res.writeHead(503, { "Retry-After": new Date(Date.now()+2000).toUTCString() }).end();
    if (path === "/timeout" || path === "/held" && hold) return;
    setTimeout(() => res.writeHead(200, { "Content-Type": "text/html" }).end(body), path === "/slow" || path === "/waiters" ? 80 : 5);
  });
  await new Promise<void>(done => source.listen(0, "127.0.0.1", done));
  const alternate = createServer((_req, res) => res.writeHead(200, { "Content-Type": "text/html" }).end(body));
  await new Promise<void>(done => alternate.listen(0, "::1", done));
  try {
    const base = `http://127.0.0.1:${(source.address() as AddressInfo).port}`;
    const user = Number(db.prepare("INSERT INTO users(email,password_hash,display_name) VALUES ('planner@example.test','fixture','Planner')").run().lastInsertRowid);
    const other = Number(db.prepare("INSERT INTO users(email,password_hash,display_name) VALUES ('shared@example.test','fixture','Shared')").run().lastInsertRowid);
    const feed = repo.createFeed(base + "/feed", 15).id;
    repo.subscribe(user, feed); repo.subscribe(other, feed);
    const add = (path: string, link = base + path) => {
      repo.upsertItems(feed, [{ guid: path, link, title: path, contentHtml: "<p>Teaser</p>" }]);
      return (db.prepare("SELECT id FROM items WHERE guid=?").get(path) as { id: number }).id;
    };
    const shared = add("/slow");
    queue.enqueueArticleContents(user, [shared]);
    const results = await Promise.all([loadFullText(user, shared), loadFullText(other, shared), queue.prepareArticleContents(user, [shared])]);
    assert.equal(requests.get("/slow"), 1); assert.ok(results[0].ok && results[1].ok);
    const retry = add("/retry"); const fast = add("/fast");
    const waiting = loadFullText(user, retry); await until(() => queue.fullTextMetrics().throttled > 0);
    const outside = add("/outside", `http://[::1]:${(alternate.address() as AddressInfo).port}/outside`);
    const fastStarted = Date.now();
    assert.equal((await loadFullText(user, outside)).ok, true);
    assert.ok(Date.now() - fastStarted < 900, "backoff leaves workers available to other hosts");
    await loadFullText(user, fast); // same source host must honour the cooldown
    assert.equal((await waiting).ok, true); assert.equal(requests.get("/retry"), 2);
    assert.ok(starts.indexOf("/fast") > starts.indexOf("/retry"));
    assert.ok(queue.fullTextMetrics().retries >= 1);
    const dated = add("/retry-date");
    assert.equal((await loadFullText(user, dated)).ok, true);
    assert.equal(requests.get("/retry-date"), 2); assert.ok(queue.fullTextMetrics().throttled >= 2);
    const bounded = add("/waiters");
    const consumers = Array.from({ length: 65 }, (_, i) => loadFullText(i % 2 ? other : user, bounded));
    assert.equal(queue.fullTextMetrics().waiters, 64);
    assert.deepEqual(await consumers[64], { ok: false, error: "queue_full" });
    await until(() => requests.has("/waiters"));
    db.prepare("DELETE FROM subscriptions WHERE user_id=? AND feed_id=?").run(other, feed);
    const delivered = await Promise.all(consumers.slice(0,64));
    delivered.forEach((result, i) => assert.equal(result.ok, i % 2 === 0, "each joined caller is reauthorized before delivery"));
    assert.equal(requests.get("/waiters"), 1); repo.subscribe(other, feed);
    const failed = add("/timeout");
    assert.equal((await loadFullText(user, failed)).ok, false); assert.equal(requests.get("/timeout"), 3);
    hold = true; const interrupted = add("/held");
    const interruptedResult = loadFullText(user, interrupted); await until(() => requests.has("/held"));
    await queue.stopFullTextScheduler();
    assert.equal((await interruptedResult).ok, false);
    assert.ok(db.prepare("SELECT 1 FROM full_text_jobs WHERE item_id=?").get(interrupted));
    assert.equal(repo.findItemById(interrupted)!.extraction_retry_at, null, "shutdown does not impose a failure backoff");
    db.prepare("UPDATE full_text_jobs SET created_at='' WHERE item_id=?").run(interrupted);
    hold = false; queue.startFullTextScheduler();
    assert.notEqual((db.prepare("SELECT created_at FROM full_text_jobs WHERE item_id=?").get(interrupted) as {created_at:string}).created_at, "", "restart repairs ages written by a rolled-back server");
    await until(() => repo.findItemById(interrupted)!.full_content_html !== null);
    assert.equal(db.prepare("SELECT 1 FROM full_text_jobs WHERE item_id=?").get(interrupted), undefined);
    await queue.stopFullTextScheduler();
    db.transaction(() => {
      const insert = db.prepare("INSERT INTO items(feed_id,guid,title,link) VALUES (?,?,?,?)");
      for (let i=0;i<1001;i++) insert.run(feed, `capacity-${i}`, "Capacity fixture", base+`/capacity/${i}`);
      db.prepare("INSERT INTO full_text_jobs(item_id,user_id,created_at) SELECT id,?,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM items WHERE guid LIKE 'capacity-%' ORDER BY id LIMIT 1000").run(user);
    })();
    const ids = db.prepare("SELECT id FROM items WHERE guid LIKE 'capacity-%' ORDER BY id").all() as {id:number}[];
    assert.deepEqual(queue.enqueueArticleContents(user, [ids[0].id]), [ids[0].id], "duplicate preparation fits an already full queue");
    assert.throws(() => queue.enqueueArticleContents(user, [ids[1000].id]), /queue_full/);
    assert.equal((db.prepare("SELECT COUNT(*) n FROM full_text_jobs").get() as {n:number}).n, 1000);
    db.prepare("DELETE FROM full_text_jobs").run();
    db.prepare("DELETE FROM items WHERE guid LIKE 'capacity-%'").run();

    const blocked = Array.from({ length: 8 }, (_, index) => add(`/blocked-${index}`));
    const healthy = add("/other-host", `http://[::1]:${(alternate.address() as AddressInfo).port}/other-host`);
    // Ignore earlier fixtures still eligible for automatic preparation.
    db.prepare("UPDATE items SET extraction_retry_at='2099-01-01T00:00:00.000Z' WHERE id < ?").run(blocked[0]);
    queue.startFullTextScheduler();
    await until(() => queue.fullTextMetrics().queued === 0 && repo.findItemById(healthy)!.extraction_status === "ready");
    assert.equal([...requests].filter(([path]) => path.startsWith("/blocked")).length, 3);
    assert.equal(queue.scheduleFullTexts(), 0, "paused hosts do not refill the queue");
    const untouched = blocked.find(id => repo.findItemById(id)!.extraction_status === "pending")!;
    assert.deepEqual(await loadFullText(user, untouched), { ok: false, error: "bot_blocked" });
    assert.equal([...requests].filter(([path]) => path.startsWith("/blocked")).length, 4, "a direct request still reaches the publisher");
    const recovered = add("/recovered");
    assert.equal((await loadFullText(user, recovered)).ok, true);
    assert.equal(queue.scheduleFullTexts(), 4, "a successful request resumes automatic work for the host");

    // Unextractable content does not trigger immediate retries or infinite hourly background loops.
    db.prepare("DELETE FROM full_text_jobs").run();
    db.prepare("UPDATE items SET extraction_status='feed_only'").run();
    const unextractable = add("/unextractable");
    assert.deepEqual(await loadFullText(user, unextractable), { ok: false, error: "could_not_extract_content" });
    assert.equal(requests.get("/unextractable"), 1);
    const failedItem = repo.findItemById(unextractable)!;
    assert.equal(failedItem.extraction_status, "failed");
    assert.ok(Date.parse(failedItem.extraction_retry_at!) > Date.now() + 6 * 86400_000);
    db.prepare("UPDATE items SET extraction_retry_at='2020-01-01T00:00:00.000Z' WHERE id=?").run(unextractable);
    assert.equal(queue.scheduleFullTexts(), 0, "failed items are not rescheduled in background");

    const stale = add("/stale");
    db.prepare("UPDATE items SET created_at='2020-01-01T00:00:00.000Z' WHERE id=?").run(stale);
    assert.equal(queue.scheduleFullTexts(), 0, "stale subscription items older than 14 days are skipped in background");

    // SSRF-blocked article URLs record a failed attempt instead of staying pending in an infinite loop.
    const ssrfBlocked = add("/ssrf-blocked", "http://127.0.0.1/internal");
    process.env.ALLOW_PRIVATE_FEEDS = "false";
    try {
      assert.deepEqual(await loadFullText(user, ssrfBlocked), { ok: false, error: "extraction_failed" });
    } finally {
      process.env.ALLOW_PRIVATE_FEEDS = "true";
    }
    const ssrfItem = repo.findItemById(ssrfBlocked)!;
    assert.equal(ssrfItem.extraction_status, "failed");
    assert.ok(Date.parse(ssrfItem.extraction_retry_at!) > Date.now() + 6 * 86400_000);
    assert.equal(queue.scheduleFullTexts(), 0, "SSRF-blocked items are not rescheduled in background");

    // A high-volume feed cannot monopolize background full-text scheduling.
    db.prepare("DELETE FROM full_text_jobs").run();
    db.prepare("UPDATE items SET extraction_status='feed_only'").run();
    const firehose = repo.createFeed(base + "/firehose", 15).id;
    const normal = repo.createFeed(base + "/normal", 15).id;
    repo.subscribe(user, firehose);
    repo.subscribe(user, normal);
    db.transaction(() => {
      const insert = db.prepare("INSERT INTO items(feed_id,guid,title,link) VALUES (?,?,?,?)");
      for (let i = 0; i < 15; i++) insert.run(firehose, `firehose-${i}`, "Firehose", base + `/firehose/${i}`);
      insert.run(normal, "normal-0", "Normal", base + "/normal/0");
    })();
    assert.equal(queue.scheduleFullTexts(), 11, "caps per-feed background batch at 10 while still scheduling other feeds");
    const scheduledFeeds = db.prepare("SELECT i.feed_id, COUNT(*) n FROM full_text_jobs j JOIN items i ON i.id=j.item_id GROUP BY i.feed_id").all() as { feed_id: number; n: number }[];
    assert.equal(scheduledFeeds.find(r => r.feed_id === firehose)?.n, 10);
    assert.equal(scheduledFeeds.find(r => r.feed_id === normal)?.n, 1);
  } finally { await queue.stopFullTextScheduler(); alternate.closeAllConnections(); await new Promise<void>(done => alternate.close(() => done())); source.closeAllConnections(); await new Promise<void>(done => source.close(() => done())); }
});
