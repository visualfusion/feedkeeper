import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express from "express";

test("the change log and offline mutations keep devices in step", async () => {
  process.env.DATABASE_PATH = ":memory:";
  process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
  const { db, runMigrations } = await import("../src/db/index.js");
  const repo = await import("../src/feeds/repository.js");
  const { v1Router } = await import("../src/api/v1/index.js");
  const { pruneChangeLog } = await import("../src/sync/changeLog.js");
  runMigrations();

  const addUser = db.prepare("INSERT INTO users (email, password_hash, display_name) VALUES (?, 'hash', ?)");
  const ownerId = Number(addUser.run("sync-owner@example.test", "Owner").lastInsertRowid);
  const otherId = Number(addUser.run("sync-other@example.test", "Other").lastInsertRowid);
  const feedId = Number(db.prepare("INSERT INTO feeds (url, title) VALUES (?, 'Source')").run("https://example.test/feed").lastInsertRowid);
  const otherFeedId = Number(db.prepare("INSERT INTO feeds (url) VALUES (?)").run("https://example.test/other").lastInsertRowid);
  repo.subscribe(ownerId, feedId);
  repo.subscribe(otherId, otherFeedId);
  const insert = db.prepare("INSERT INTO items (feed_id, guid, title, created_at) VALUES (?, ?, ?, '2026-10-01T10:00:00.000Z')");
  const [a, b, c] = ["a", "b", "c"].map((guid) => Number(insert.run(feedId, guid, `Article ${guid}`).lastInsertRowid));
  const foreign = Number(insert.run(otherFeedId, "x", "Foreign").lastInsertRowid);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const user = req.headers["x-test-user"];
    if (user) req.session = { userId: Number(user) } as typeof req.session;
    next();
  });
  app.use("/api/v1", v1Router);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  const call = async (path: string, user: number, init: { method?: string; body?: unknown } = {}) => {
    const response = await fetch(base + path, {
      method: init.method ?? "GET",
      headers: { "content-type": "application/json", "x-test-user": String(user) },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };
  type Entry = { seq: number; entity: string; id: number; op: string; data?: Record<string, unknown> };
  const sync = async (since: number, user = ownerId, limit = 200) => (await call(`/sync?since=${since}&limit=${limit}`, user)).body as { changes: Entry[]; nextSeq: number; hasMore: boolean };
  const find = (changes: Entry[], entity: string, id: number) => changes.find((change) => change.entity === entity && change.id === id);

  try {
    // Data that existed before the log is delivered by the first sync (simulated by emptying the log).
    repo.markItemRead(ownerId, a);
    repo.bookmarkItem(ownerId, b);
    repo.addMutedKeyword(ownerId, "spam");
    db.prepare("DELETE FROM changes").run();
    db.prepare("DELETE FROM sync_state").run();
    const first = await sync(0);
    assert.deepEqual(find(first.changes, "item_state", a)?.data, { read: true, saved: false, savedAt: null, progress: null });
    assert.equal(find(first.changes, "item_state", b)?.data?.saved, true);
    assert.equal(find(first.changes, "subscription", feedId)?.data?.title, "Source");
    assert.equal(find(first.changes, "muted_keyword", repo.listMutedKeywords(ownerId)[0].id)?.data?.keyword, "spam");

    // Anything done afterwards, by any code path, shows up and moves forward in the log.
    repo.markItemUnread(ownerId, a);
    repo.markItemRead(ownerId, c);
    const folder = repo.createFolder(ownerId, "News");
    repo.updateSubscriptionFolder(ownerId, feedId, folder.id);
    repo.updateFolder(ownerId, folder.id, "Daily");
    const delta = await sync(first.nextSeq);
    assert.equal(find(delta.changes, "item_state", a)?.data?.read, false);
    assert.equal(find(delta.changes, "item_state", c)?.data?.read, true);
    assert.equal(find(delta.changes, "subscription", feedId)?.data?.folderId, folder.id);
    assert.equal(find(delta.changes, "folder", folder.id)?.data?.name, "Daily");
    assert.equal(delta.changes.every((change, index) => index === 0 || change.seq > delta.changes[index - 1].seq), true);

    // The log is compacted: three toggles leave one entry for the article.
    for (const read of [true, false, true]) {
      if (read) repo.markItemRead(ownerId, b);
      else repo.markItemUnread(ownerId, b);
    }
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM changes WHERE user_id = ? AND entity = 'item_state' AND entity_id = ?").get(ownerId, b)?.n, 1);

    // Paging, and nothing new means an empty answer that keeps the position.
    const page = await sync(0, ownerId, 2);
    assert.equal(page.changes.length, 2);
    assert.equal(page.hasMore, true);
    const latest = await sync(page.nextSeq, ownerId, 500);
    const end = await sync(latest.nextSeq);
    assert.deepEqual([end.changes.length, end.hasMore, end.nextSeq], [0, false, latest.nextSeq]);

    // Deletions are reported, and other users' changes are never visible.
    repo.deleteFolder(ownerId, folder.id);
    assert.equal(find((await sync(end.nextSeq)).changes, "folder", folder.id)?.op, "delete");
    assert.deepEqual((await sync(0, otherId)).changes.filter((change) => change.entity === "item_state"), []);

    // Mutations: applied once, replays are duplicates, unknown or foreign articles are rejected.
    const at = (secondsAgo: number) => new Date(Date.now() - secondsAgo * 1000).toISOString();
    const send = async (...mutations: object[]) => (await call("/mutations", ownerId, { method: "POST", body: { mutations } })).body.results as { id: string; outcome: string; error?: string }[];
    // The web app changed this article moments ago, so offline changes are dated just after that.
    const readMutation = { id: "mutation-0001", type: "item.read", itemId: a, value: true, at: at(-1) };
    assert.deepEqual((await send(readMutation)).map((result) => result.outcome), ["applied"]);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM item_reads WHERE user_id = ? AND item_id = ?").get(ownerId, a)?.n, 1);
    assert.deepEqual((await send(readMutation)).map((result) => result.outcome), ["duplicate"]);
    const rejected = await send({ id: "mutation-0002", type: "item.read", itemId: foreign, value: true, at: at(1) }, { id: "mutation-0003", type: "item.read", itemId: a, value: "yes", at: at(1) }, { id: "mutation-0004", type: "item.read", itemId: a, value: true, at: "2020-01-01T00:00:00Z" });
    assert.deepEqual(rejected.map((result) => result.error), ["item_not_found", "invalid_mutation", "invalid_time"]);

    // Last writer wins per field: an older change loses, a newer one wins, and other fields are independent.
    assert.deepEqual((await send({ id: "mutation-0005", type: "item.read", itemId: a, value: false, at: at(120) })).map((result) => result.outcome), ["stale"]);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM item_reads WHERE user_id = ? AND item_id = ?").get(ownerId, a)?.n, 1);
    assert.deepEqual((await send({ id: "mutation-0006", type: "item.read", itemId: a, value: false, at: at(-2) }, { id: "mutation-0007", type: "item.save", itemId: a, value: true, at: at(90) })).map((result) => result.outcome), ["applied", "applied"]);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM item_bookmarks WHERE user_id = ? AND item_id = ?").get(ownerId, a)?.n, 1);
    // A change made in the web app counts too: it is newer than an older offline change of a device.
    repo.markItemRead(ownerId, c);
    repo.markItemUnread(ownerId, c);
    assert.deepEqual((await send({ id: "mutation-0008", type: "item.read", itemId: c, value: true, at: at(3600) })).map((result) => result.outcome), ["stale"]);

    // Reading position: stored in between, dropped near the start or the end.
    await send({ id: "mutation-0009", type: "item.progress", itemId: b, position: 0.4, at: at(10) });
    assert.equal(find((await sync(0)).changes, "item_state", b)?.data?.progress, 0.4);
    await send({ id: "mutation-0010", type: "item.progress", itemId: b, position: 0.99, at: at(5) });
    assert.equal(find((await sync(0)).changes, "item_state", b)?.data?.progress, null);

    // Limits and scopes.
    assert.equal((await call("/mutations", ownerId, { method: "POST", body: { mutations: [] } })).status, 400);
    assert.equal((await call("/sync?since=abc", ownerId)).status, 400);

    // An article removed later is reported as deleted, and forgotten once the log is tidied up.
    db.prepare("DELETE FROM items WHERE id = ?").run(c);
    const afterDelete = await sync(0);
    assert.equal(find(afterDelete.changes, "item_state", c)?.op, "delete");
    pruneChangeLog();
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM changes WHERE entity = 'item_state' AND entity_id = ?").get(c)?.n, 0);
    assert.equal((await call(`/sync?since=${afterDelete.nextSeq}`, ownerId)).status, 200);

    // Old deletions are forgotten; a client that is behind them must start over, a new one is fine.
    const behind = (await sync(0)).nextSeq;
    const tombstone = repo.createFolder(ownerId, "Temporary");
    repo.deleteFolder(ownerId, tombstone.id);
    db.prepare("UPDATE changes SET changed_at = '2026-01-01T00:00:00.000Z' WHERE entity = 'folder' AND entity_id = ? AND user_id = ?").run(tombstone.id, ownerId);
    pruneChangeLog();
    assert.equal((await call(`/sync?since=${behind}`, ownerId)).status, 410);
    // A client that is ahead of the server's log, for example after a restore from backup, starts over too.
    assert.equal((await call(`/sync?since=${behind + 100000}`, ownerId)).status, 410);
    assert.equal((await call("/sync?since=0", ownerId)).status, 200);
  } finally {
    server.close();
  }
});
