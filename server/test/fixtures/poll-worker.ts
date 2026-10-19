import express from "express";
import type { AddressInfo } from "node:net";
const { db, runMigrations } = await import("../../src/db/index.js");
const repo = await import("../../src/feeds/repository.js");
const poller = await import("../../src/feeds/poller.js");
runMigrations();
let feed = repo.findFeedByUrl(process.env.TEST_FEED_URL!);
if (!feed) {
  const user = Number(db.prepare("INSERT INTO users(email,password_hash,display_name) VALUES ('restart@example.test','x','Restart')").run().lastInsertRowid);
  feed = repo.createFeed(process.env.TEST_FEED_URL!,15); repo.subscribe(user,feed.id);
  db.prepare("UPDATE feeds SET icon_checked_at = ? WHERE id = ?").run(new Date().toISOString(),feed.id);
}
const server = express().listen(0,"127.0.0.1");
await new Promise<void>(done => server.once("listening",done));
poller.installPollingShutdown(server);
process.send?.({ type:"ready", port:(server.address() as AddressInfo).port });
if (process.env.TEST_RESUME === "true") {
  const result = await poller.pollFeed(feed);
  process.send?.({ type:"result", ...result });
} else poller.startPollingScheduler();
