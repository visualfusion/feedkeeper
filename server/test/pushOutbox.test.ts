import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { AsyncLocalStorage } from "node:async_hooks";

process.env.DATABASE_PATH = ":memory:";
process.env.SESSION_SECRET = "push-outbox-test-secret-at-least-32-characters";
process.env.ALLOW_PRIVATE_FEEDS = "true";
process.env.POLL_REQUEST_TIMEOUT_MS = "200";
process.env.POLL_ATTEMPT_TIMEOUT_MS = "300";
const { db, runMigrations } = await import("../src/db/index.js");
const repo = await import("../src/feeds/repository.js");
const { setPushSender, saveDevice } = await import("../src/push.js");
const { PushOutbox, enqueueNewItemNotifications } = await import("../src/pushOutbox.js");
runMigrations();

async function until(condition: () => boolean) {
  const end = Date.now() + 5000;
  while (!condition()) { assert.ok(Date.now() < end, "outbox made no progress"); await sleep(5); }
}
let serial = 0;
function fixture(people = 1, devices = 1) {
  const feed = repo.createFeed(`https://source-${++serial}.example.test/feed`, 15);
  db.prepare("UPDATE feeds SET last_success_at = ?, icon_checked_at = ? WHERE id = ?").run(new Date().toISOString(), new Date().toISOString(), feed.id);
  const users = Array.from({ length: people }, (_, index) => {
    const user = Number(db.prepare("INSERT INTO users(email,password_hash,display_name) VALUES (?,'x','Reader')")
      .run(`reader-${serial}-${index}@example.test`).lastInsertRowid);
    repo.subscribe(user, feed.id); repo.updateSubscriptionNotify(user, feed.id, true);
    for (let device = 0; device < devices; device++) saveDevice(user, {
      endpoint: `https://push.example.test/${user}/${device}`, keys: { p256dh: "x", auth: "x" },
    });
    return user;
  });
  repo.upsertItems(feed.id, [{ guid: "first", title: "First story" }]);
  return { feed, users };
}
function pending() { return Number(db.prepare("SELECT COUNT(*) n FROM push_outbox").get()!.n); }

test("push event rolls back with the article transaction and uses a committed article/subscription ceiling", async () => {
  const { feed, users } = fixture();
  assert.throws(db.transaction(() => { enqueueNewItemNotifications(feed.id, 1); throw new Error("rollback"); }));
  assert.equal(pending(), 0);
  db.transaction(() => enqueueNewItemNotifications(feed.id, 1))();
  repo.upsertItems(feed.id, [{ guid: "second", title: "Later story" }]);
  const later = Number(db.prepare("INSERT INTO users(email,password_hash,display_name) VALUES ('later@example.test','x','Later')").run().lastInsertRowid);
  repo.subscribe(later, feed.id); repo.updateSubscriptionNotify(later, feed.id, true);
  saveDevice(later, { endpoint: "https://push.example.test/later", keys: { p256dh: "x", auth: "x" } });
  const sent: string[] = [];
  setPushSender(async (target, body) => {
    assert.equal(target.endpoint, `https://push.example.test/${users[0]}/0`);
    sent.push(JSON.parse(body).body);
  });
  const worker = new PushOutbox(); worker.start();
  try { await until(() => pending() === 0); assert.deepEqual(sent, ["First story"]); }
  finally { await worker.stop(); }
});

test("one device at a time; graceful stop saves the cursor and a fresh worker sends every remaining recipient once", async () => {
  const { feed } = fixture(12, 2);
  enqueueNewItemNotifications(feed.id, 1);
  let release!: () => void;
  const blocked = new Promise<void>(done => { release = done; });
  const sent: string[] = [];
  let active = 0; let maximum = 0;
  setPushSender(async target => {
    active++; maximum = Math.max(maximum, active);
    sent.push(target.endpoint);
    if (sent.length === 1) await blocked;
    else await sleep(1);
    active--;
  });
  const first = new PushOutbox(); first.start();
  await until(() => active === 1);
  const stopped = first.stop();
  release(); await stopped;
  assert.equal(sent.length, 1); assert.equal(pending(), 1);
  assert.ok(Number(db.prepare("SELECT device_cursor FROM push_outbox").get()!.device_cursor) > 0);
  const second = new PushOutbox(); second.start();
  try {
    await until(() => pending() === 0);
    assert.equal(sent.length, 24); assert.equal(new Set(sent).size, 24); assert.equal(maximum, 1);
  } finally { await first.stop(); await second.stop(); }
});

test("push retries release the worker, are bounded, honor Retry-After, and do not block another feed", async () => {
  const bad = fixture(); const good = fixture();
  enqueueNewItemNotifications(bad.feed.id, 1); enqueueNewItemNotifications(good.feed.id, 1);
  let badAttempts = 0; let goodAttempts = 0;
  setPushSender(async target => {
    if (target.endpoint === `https://push.example.test/${bad.users[0]}/0`) {
      badAttempts++;
      throw Object.assign(new Error("busy"), { statusCode: 503, headers: { "retry-after": "3600" } });
    }
    goodAttempts++;
  });
  const worker = new PushOutbox(); worker.start();
  try {
    await until(() => goodAttempts === 1 && worker.metrics().running === 0);
    assert.equal(badAttempts, 1);
    assert.ok(Number(db.prepare("SELECT available_at FROM push_outbox WHERE feed_id = ?").get(bad.feed.id)!.available_at) > Date.now() + 3_599_000);
    for (let attempt = 2; attempt <= 3; attempt++) {
      db.prepare("UPDATE push_outbox SET available_at = 0 WHERE feed_id = ?").run(bad.feed.id);
      worker.kick(); await until(() => badAttempts === attempt && worker.metrics().running === 0);
    }
    await until(() => pending() === 0);
    assert.equal(worker.metrics().retries, 2); assert.equal(worker.metrics().dropped, 1);
  } finally { await worker.stop(); }
});

test("queued notifications recheck opt-out, muted keywords and account capabilities", async () => {
  const { feed, users } = fixture(3);
  enqueueNewItemNotifications(feed.id, 1);
  repo.updateSubscriptionNotify(users[0], feed.id, false);
  repo.addMutedKeyword(users[1], "first");
  const capabilities = await import("../src/auth/capabilities.js");
  const previous = capabilities.getCapabilitiesProvider();
  capabilities.setCapabilitiesProvider({ getCapabilitiesForUser: user => {
    const value = previous.getCapabilitiesForUser(user);
    return { ...value, features: { ...value.features, sync: user !== users[2] } };
  } });
  let sent = 0; setPushSender(async () => { sent++; });
  const worker = new PushOutbox(); worker.start();
  try { await until(() => pending() === 0); assert.equal(sent, 0); }
  finally { await worker.stop(); capabilities.setCapabilitiesProvider(previous); }
});

test("background push dispatch does not inherit the triggering HTTP request context", async () => {
  const { feed } = fixture();
  const request = new AsyncLocalStorage<string>();
  let sent = 0;
  setPushSender(async () => { assert.equal(request.getStore(), undefined); sent++; });
  const worker = new PushOutbox();
  request.run("cached-request-capabilities", () => {
    enqueueNewItemNotifications(feed.id, 1); worker.start();
  });
  try { await until(() => pending() === 0); assert.equal(sent, 1); }
  finally { await worker.stop(); }
});

test("the production push sender enforces an absolute deadline and destroys its request agent", async context => {
  const webpush = (await import("web-push")).default;
  const { sendPushTarget } = await import("../src/push.js");
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let started = false; let destroyed = 0;
  context.mock.method(webpush, "sendNotification", (_target, _payload, options) => {
    started = true;
    context.mock.method(options.agent, "destroy", () => { destroyed++; });
    return new Promise(() => {}); // No network: simulate a provider that never settles.
  });
  setPushSender(null);
  const delivery = sendPushTarget({ endpoint: "https://push.example.test/stalled", keys: { p256dh: "x", auth: "x" } }, {
    title: "Example", body: "Story", url: "/items",
  });
  const rejected = assert.rejects(delivery, { name: "TimeoutError" });
  for (let attempt = 0; !started && attempt < 10; attempt++) await Promise.resolve();
  assert.equal(started, true);
  context.mock.timers.tick(10_000);
  await rejected;
  assert.ok(destroyed > 0);
});

test("slow fanout outlives the feed deadline without occupying a poll worker or duplicating concurrent-trigger notifications", async () => {
  const { feed } = fixture(8);
  let release!: () => void;
  const blocked = new Promise<void>(done => { release = done; });
  let notices = 0; let hits = 0;
  setPushSender(async () => { notices++; if (notices === 1) await blocked; });
  const source = createServer((_req, res) => {
    hits++;
    setTimeout(() => res.end('<rss version="2.0"><channel><title>New</title><item><guid>new</guid><title>New story</title></item></channel></rss>'), 15);
  });
  await new Promise<void>(done => source.listen(0, "127.0.0.1", done));
  const url = `http://127.0.0.1:${(source.address() as AddressInfo).port}/feed`;
  db.prepare("UPDATE feeds SET url = ? WHERE id = ?").run(url, feed.id);
  const poller = await import("../src/feeds/poller.js");
  try {
    const results = await Promise.all(Array.from({ length: 20 }, () => poller.pollFeed(repo.findFeedById(feed.id)!)));
    assert.ok(results.every(result => result.newItems === 1 && result.error === null));
    await until(() => notices === 1);
    await sleep(350); // Deliberately beyond the configured 300 ms feed attempt budget.
    assert.equal(poller.pollingMetrics().running, 0);
    assert.equal(pending(), 1); assert.equal(hits, 1);
    release(); await until(() => pending() === 0);
    assert.equal(notices, 8);
    assert.equal((await poller.pollFeed(repo.findFeedById(feed.id)!)).newItems, 0);
    await sleep(10); assert.equal(notices, 8);
  } finally {
    release(); await poller.stopPollingScheduler();
    source.closeAllConnections(); await new Promise<void>(done => source.close(() => done()));
    setPushSender(null);
  }
});
