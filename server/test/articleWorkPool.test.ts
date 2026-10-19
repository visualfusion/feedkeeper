import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { ArticleWorkPool, ArticleWorkBusyError, ArticleHostBusyError, readArticleWorkLimits } from "../src/feeds/articleWorkPool.js";
const limits = { concurrency: 2, hostConcurrency: 1, maxWaiting: 2, timeoutMs: 1000, agingMs: 50 };
const gate = () => { let release!: () => void; const promise = new Promise<void>(done => { release = done; }); return { promise, release }; };

test("article work bounds concurrency, skips a busy host and rejects excess work", async () => {
  const pool = new ArticleWorkPool(limits);
  const held = gate(); const started: string[] = [];
  const work = (name: string, wait = false) => async () => { started.push(name); if (wait) await held.promise; return name; };
  const first = pool.run("shared", work("first", true));
  const second = pool.run("shared", work("second"));
  const third = pool.run("other", work("third", true));
  const fourth = pool.run("shared", work("fourth"));
  await assert.rejects(pool.run("shared", work("overflow")), ArticleWorkBusyError);
  await sleep(0);
  assert.deepEqual(started, ["first", "third"]);
  assert.equal(pool.metrics().running, 2); assert.equal(pool.metrics().waiting, 2);
  held.release(); await Promise.all([first, second, third, fourth]);
  assert.equal(pool.metrics().running, 0); await pool.close();
});

test("old low priority work passes newer interactive requests", async () => {
  let now = 0; const pool = new ArticleWorkPool({ ...limits, concurrency: 1 }, () => now);
  const held = gate(); const order: string[] = [];
  const first = pool.run("a", async () => { await held.promise; });
  const older = pool.run("b", async () => { order.push("old"); }, 1);
  now = 300;
  const newer = pool.run("c", async () => { order.push("new"); }, 5);
  held.release(); await Promise.all([first, older, newer]);
  assert.deepEqual(order, ["old", "new"]); await pool.close();
});

test("timeouts cover waiting and active work without releasing outstanding I/O", async () => {
  const pool = new ArticleWorkPool({ ...limits, timeoutMs: 60 });
  const active = pool.run("a", signal => new Promise<void>((_done, fail) => signal.addEventListener("abort", () => fail(signal.reason), { once: true })));
  const waiting = pool.run("a", async () => { throw new Error("waiting work should not run"); });
  await Promise.all([assert.rejects(active), assert.rejects(waiting)]);
  assert.equal(pool.metrics().running, 0); assert.equal(pool.metrics().waiting, 0); await pool.close();
});

test("redirect destinations share host permits and shutdown rejects pending work", async () => {
  const pool = new ArticleWorkPool(limits); const held = gate();
  const first = pool.run("a", async () => { await held.promise; });
  const second = pool.run("b", async signal => {
    assert.throws(() => pool.move(signal, "a"), ArticleHostBusyError);
    pool.move(signal, "c"); assert.equal(pool.canStart("c"), false);
    await new Promise<void>((_done, fail) => signal.addEventListener("abort", () => fail(signal.reason), { once: true }));
  });
  const pending = pool.run("a", async () => {});
  const checks = Promise.all([first, assert.rejects(second), assert.rejects(pending, ArticleWorkBusyError)]);
  await sleep(0); const close = pool.close(); held.release(); await close; await checks;
  await assert.rejects(pool.run("d", async () => {}), ArticleWorkBusyError);
});

test("full text limits are conservative and reject invalid configuration", () => {
  assert.equal(readArticleWorkLimits({}).concurrency, 2);
  assert.equal(readArticleWorkLimits({}).hostConcurrency, 1);
  assert.throws(() => readArticleWorkLimits({ FULLTEXT_CONCURRENCY: "0" }));
  assert.throws(() => readArticleWorkLimits({ FULLTEXT_MAX_WAITING: "Infinity" }));
});

test("elapsed deadlines reject results even when synchronous work delayed the timer", async () => {
  let now = 0;
  const pool = new ArticleWorkPool({concurrency:1,hostConcurrency:1,maxWaiting:1,timeoutMs:100,agingMs:100}, () => now);
  await assert.rejects(pool.run("local.test", async () => { now = 101; return "late"; }), {name:"TimeoutError"});
  assert.equal(pool.metrics().running, 0); await pool.close();
});
