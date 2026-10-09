import express from "express";
import { setTimeout as sleep } from "node:timers/promises";
const { db, runMigrations } = await import("../../src/db/index.js");
const { saveDevice, setPushSender } = await import("../../src/push.js");
const { startPushOutbox, enqueueNewItemNotifications } = await import("../../src/pushOutbox.js");
const { installPollingShutdown } = await import("../../src/feeds/poller.js");
runMigrations();
if (process.env.TEST_RESUME !== "true") {
  const repo = await import("../../src/feeds/repository.js");
  const feed = repo.createFeed("https://fixture.example.test/feed", 15);
  for (let index = 0; index < 6; index++) {
    const user = Number(db.prepare("INSERT INTO users(email,password_hash,display_name) VALUES (?,'x','Reader')").run(`push-${index}@example.test`).lastInsertRowid);
    repo.subscribe(user, feed.id); repo.updateSubscriptionNotify(user, feed.id, true);
    saveDevice(user, { endpoint: `https://push.example.test/${index}`, keys: { p256dh: "x", auth: "x" } });
  }
  repo.upsertItems(feed.id, [{ guid: "first", title: "Story" }]);
  db.transaction(() => enqueueNewItemNotifications(feed.id, 1))();
}
setPushSender(async target => {
  process.send?.({ type: "delivery", device: target.endpoint });
  await sleep(30);
});
const server = express().listen(0, "127.0.0.1");
await new Promise<void>(done => server.once("listening", done));
installPollingShutdown(server);
startPushOutbox();
if (process.env.TEST_RESUME === "true") {
  while (db.prepare("SELECT 1 FROM push_outbox LIMIT 1").get()) await sleep(5);
  process.send?.({ type: "done" });
}
