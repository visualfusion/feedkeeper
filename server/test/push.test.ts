import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

test("people who opted in get a push for new articles, but not for a feed's first fetch", async () => {
  let items = ["First story"];
  const server = createServer((req, res) => {
    if (req.url !== "/feed.xml") return res.writeHead(404).end();
    res.writeHead(200, { "content-type": "application/rss+xml" }).end(
      `<?xml version="1.0"?><rss version="2.0"><channel><title>Daily</title>${items.map((title, index) => `<item><guid>g${index}</guid><title>${title}</title><link>http://example.test/${index}</link></item>`).join("")}</channel></rss>`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  process.env.DATABASE_PATH = ":memory:";
  process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
  process.env.ALLOW_PRIVATE_FEEDS = "true";
  const { db, runMigrations } = await import("../src/db/index.js");
  const repo = await import("../src/feeds/repository.js");
  const { subscribeToFeed } = await import("../src/feeds/service.js");
  const { pollFeed } = await import("../src/feeds/poller.js");
  const push = await import("../src/push.js");
  runMigrations();

  const sent: { endpoint: string; payload: { title: string; body: string; url: string; unread: number } }[] = [];
  push.setPushSender(async (target, payload) => {
    if (target.endpoint.endsWith("/gone")) throw Object.assign(new Error("gone"), { statusCode: 410 });
    sent.push({ endpoint: target.endpoint, payload: JSON.parse(payload) });
  });

  const addUser = db.prepare("INSERT INTO users (email, password_hash, display_name) VALUES (?, 'hash', ?)");
  const subscriberId = Number(addUser.run("push-subscriber@example.test", "Subscriber").lastInsertRowid);
  const quietId = Number(addUser.run("push-quiet@example.test", "Quiet").lastInsertRowid);
  const keys = { p256dh: "key", auth: "auth" };

  try {
    const feed = await subscribeToFeed(subscriberId, `${base}/feed.xml`);
    await subscribeToFeed(quietId, `${base}/feed.xml`);
    repo.updateSubscriptionNotify(subscriberId, feed.id, true);
    repo.updateSubscriptionBadge(subscriberId, feed.id, true);
    push.saveDevice(subscriberId, { endpoint: "https://push.example.test/phone", keys });
    push.saveDevice(subscriberId, { endpoint: "https://push.example.test/gone", keys });
    push.saveDevice(quietId, { endpoint: "https://push.example.test/quiet", keys });

    // Nothing was announced for the articles that came with the subscription.
    assert.deepEqual(sent, []);

    items = ["First story", "Second story", "Third story"];
    const due = repo.findFeedById(feed.id)!;
    assert.equal((await pollFeed(due)).newItems, 2);
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Only the opted-in user is notified, on the device that still exists; the dead device is forgotten.
    assert.equal(sent.length, 1);
    assert.equal(sent[0].endpoint, "https://push.example.test/phone");
    assert.equal(sent[0].payload.title, "Daily");
    assert.match(sent[0].payload.body, /\(\+1\)$/);
    assert.equal(sent[0].payload.url, `/items?feed=${feed.id}`);
    assert.equal(sent[0].payload.unread, 3);

    assert.equal(push.hasDevice(subscriberId, "https://push.example.test/gone"), false);

    // Muted keywords keep articles from being announced.
    repo.addMutedKeyword(subscriberId, "fourth");
    items = [...items, "Fourth story"];
    await pollFeed(repo.findFeedById(feed.id)!);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(sent.length, 1);

    // Without the badge option the feed does not count towards the number on the app icon.
    repo.updateSubscriptionBadge(subscriberId, feed.id, false);
    items = [...items, "Fifth story"];
    await pollFeed(repo.findFeedById(feed.id)!);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(sent.length, 2);
    assert.equal(sent[1].payload.unread, 0);
    // A single new article opens directly.
    const fifth = (db.prepare("SELECT id FROM items WHERE title = 'Fifth story'").get() as { id: number }).id;
    assert.equal(sent[1].payload.url, `/items?feed=${feed.id}&article=${fifth}`);

    // A device can be re-registered and removed again.
    push.removeDevice(subscriberId, "https://push.example.test/phone");
    assert.equal(push.hasDevice(subscriberId, "https://push.example.test/phone"), false);
    assert.match(push.vapidPublicKey(), /^[A-Za-z0-9_-]{80,}$/);
  } finally {
    await (await import("../src/feeds/poller.js")).stopPollingScheduler();
    server.close();
  }
});
