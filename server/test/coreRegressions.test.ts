import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import express from "express";

test("feed metadata, retained articles, folder retries and account permissions", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "feedkeeper-regressions-"));
  process.env.DATABASE_PATH = ":memory:";
  process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
  process.env.ALLOW_SIGNUP = "true";
  process.env.ARCHIVE_PATH = join(directory, "archive");
  process.env.IMAGE_CACHE_PATH = join(directory, "cache");
  const { db, runMigrations } = await import("../src/db/index.js");
  const repo = await import("../src/feeds/repository.js");
  const sync = await import("../src/sync/changeLog.js");
  const { canAccessFeed } = await import("../src/feeds/feedIcon.js");
  const { ensureUserInbox, deleteInboxItem } = await import("../src/feeds/inbox.js");
  const capabilities = await import("../src/auth/capabilities.js");
  const { v1Router } = await import("../src/api/v1/index.js");
  const { foldersRouter } = await import("../src/api/folders.js");
  const { authRouter } = await import("../src/api/auth.js");
  const { onboardingRouter } = await import("../src/api/onboarding.js");
  const { securityVersion } = await import("../src/auth/security.js");
  runMigrations();
  const originalProvider = capabilities.getCapabilitiesProvider();
  const sessions: Record<string, unknown>[] = [];
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const userId = Number(req.get("x-test-user"));
    req.session = userId ? { userId, securityVersion: securityVersion(userId) } : {};
    res.on("finish", () => { sessions.push({ ...req.session }); });
    next();
  });
  app.use("/api/onboarding", onboardingRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/v1", v1Router);
  app.use("/api/folders", foldersRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (path: string, userId = 0, method = "GET", body?: unknown, headers: Record<string, string> = {}) => {
    const response = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json", "x-test-user": String(userId), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: response.status === 204 ? null : await response.json() as any };
  };
  t.after(async () => {
    capabilities.setCapabilitiesProvider(originalProvider);
    await (await import("../src/feeds/poller.js")).stopPollingScheduler();
    await (await import("../src/feeds/archive.js")).stopImageCache();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  await t.test("onboarding and signup replace session state and include the security version", async () => {
    for (const [path, email] of [["/api/onboarding", "admin@example.test"], ["/api/auth/signup", "signup@example.test"]]) {
      const result = await call(path, 0, "POST", { email, password: "test-password-long-enough", displayName: "Reader" });
      assert.equal(result.status, 201);
      assert.deepEqual(sessions.at(-1), { userId: result.body.id, securityVersion: securityVersion(result.body.id) });
    }
  });

  const addUser = db.prepare("INSERT INTO users (email, password_hash, display_name) VALUES (?, 'hash', 'Reader')");
  const owner = Number(addUser.run("owner@example.test").lastInsertRowid);
  const other = Number(addUser.run("other@example.test").lastInsertRowid);
  const outsider = Number(addUser.run("outsider@example.test").lastInsertRowid);
  const feed = repo.createFeed("https://example.test/feed", 15);
  repo.subscribe(owner, feed.id);
  repo.subscribe(other, feed.id);
  const row = { guid: "article", title: "Story", link: "https://example.test/story", contentHtml: "<p>News from the publisher.</p>", publishedAt: "2026-11-01T12:00:00Z", author: null };
  repo.upsertItems(feed.id, [row]);
  const itemId = (db.prepare("SELECT id FROM items WHERE feed_id = ?").get(feed.id) as { id: number }).id;

  await t.test("unchanged polls perform no item updates while changed dates and authors persist", () => {
    db.exec("CREATE TEMP TABLE item_updates (id INTEGER); CREATE TEMP TRIGGER count_item_updates AFTER UPDATE ON items BEGIN INSERT INTO item_updates VALUES (NEW.id); END;");
    repo.upsertItems(feed.id, [row]);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM item_updates").get()?.n, 0);
    const changed = { ...row, author: "New author", publishedAt: "2026-11-02T12:00:00Z" };
    repo.upsertItems(feed.id, [changed]);
    assert.equal(repo.findItemById(itemId)?.author, changed.author);
    assert.equal(repo.findItemById(itemId)?.published_at, changed.publishedAt);
    db.exec("DELETE FROM item_updates");
    repo.upsertItems(feed.id, [changed]);
    repo.upsertItems(feed.id, [{ guid: row.guid, author: null }]);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM item_updates").get()?.n, 0);
    assert.equal(repo.findItemById(itemId)?.author, changed.author);
  });

  await t.test("metadata changes notify every subscriber once and carry error changes including recovery", () => {
    for (const [column, value] of [["title", "New title"], ["site_url", "https://example.test/new"], ["last_error", "feed_blocked"], ["last_error", null]] as const) {
      const before = [sync.currentSeq(owner), sync.currentSeq(other)];
      db.prepare(`UPDATE feeds SET ${column} = ? WHERE id = ?`).run(value, feed.id);
      for (const [index, user] of [owner, other].entries()) {
        const changed = sync.listChanges(user, before[index]).changes;
        assert.equal(changed.length, 1);
        assert.equal(changed[0].entity, "subscription");
        assert.equal((changed[0].data as Record<string, unknown>).lastError, column === "last_error" ? value : null);
      }
      const seq = sync.currentSeq(owner);
      db.prepare(`UPDATE feeds SET ${column} = ? WHERE id = ?`).run(value, feed.id);
      assert.equal(sync.currentSeq(owner), seq, "unchanged metadata emits no event");
    }
    assert.deepEqual(sync.listChanges(outsider, 0).changes, []);
  });

  await t.test("folder retries preserve counts, apply explicit icons, and renaming conflicts return 409 in both APIs", async () => {
    const first = await call("/api/v1/folders", owner, "POST", { name: "News", iconSymbol: "newspaper" });
    const id = first.body.id;
    repo.updateSubscriptionFolder(owner, feed.id, id);
    const retry = await call("/api/v1/folders", owner, "POST", { name: "News", iconSymbol: "cpu" });
    assert.equal(retry.status, 201);
    assert.deepEqual([retry.body.id, retry.body.iconSymbol, retry.body.subscriptionCount, retry.body.unreadCount], [id, "cpu", 1, 1]);
    assert.equal((await call("/api/v1/folders", owner, "POST", { name: "News" })).body.iconSymbol, "cpu");
    assert.equal((await call("/api/v1/folders", owner, "POST", { name: "News", iconSymbol: null })).body.iconSymbol, null);
    const legacy = await call("/api/folders", owner, "POST", { name: "News" });
    assert.deepEqual([legacy.body.feed_count, legacy.body.unread_count], [1, 1]);
    const second = repo.createFolder(owner, "Other");
    for (const path of [`/api/folders/${second.id}`, `/api/v1/folders/${second.id}`]) {
      const conflict = await call(path, owner, "PATCH", { name: "News" });
      assert.equal(conflict.status, 409);
      assert.equal(conflict.body.error, "folder_name_taken");
    }
  });

  await t.test("an Authorization header never falls back to a valid browser session", async () => {
    assert.equal((await call("/api/v1/me", owner)).status, 200);
    for (const authorization of ["", "Basic dummy", "Bearer", "Bearer invalid"]) {
      assert.equal((await call("/api/v1/me", owner, "GET", undefined, { authorization })).status, 401);
    }
  });

  await t.test("disabled sync blocks imports and fetches but preserves generic management and independent notes", async () => {
    const features = { ...originalProvider.getCapabilitiesForUser(owner).features, sync: false };
    capabilities.setCapabilitiesProvider({ getCapabilitiesForUser: () => ({ type: "test", features, manageUrl: null }) });
    try {
      const feedsBefore = db.prepare("SELECT COUNT(*) AS n FROM feeds").get()?.n;
      for (const [path, body] of [
        ["/opml", { opml: '<opml><body><outline xmlUrl="https://example.test/new"/></body></opml>' }],
        ["/subscriptions", { url: "https://example.test/new" }],
        [`/subscriptions/${feed.id}/refresh`, {}], ["/refresh", {}], ["/discover", { url: "https://example.test/new" }],
      ] as const) {
        const denied = await call(`/api/v1${path}`, owner, "POST", body);
        assert.equal(denied.status, 403, path);
        assert.equal(denied.body.capability, "sync");
      }
      assert.equal((await call(`/api/v1/subscriptions/${feed.id}`, owner, "PATCH", { url: "https://example.test/new" })).status, 403);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM feeds").get()?.n, feedsBefore);
      assert.equal((await call(`/api/folders/${repo.findFolderByName(owner, "News")!.id}/read`, owner, "POST", {})).status, 403);
      assert.equal((await call("/api/v1/folders", owner, "POST", { name: "Plain" })).status, 201);
      assert.equal((await call("/api/v1/folders", owner, "POST", { name: "Locked", iconSymbol: "cpu" })).status, 403);
      const at = new Date().toISOString();
      const result = await call("/api/v1/mutations", owner, "POST", { mutations: [
        { id: "denied-read-mutation", itemId, at, type: "item.read", value: true },
        { id: "allowed-note-mutation", itemId, at, type: "item.note.set", content: "Independent note" },
      ] });
      assert.deepEqual(result.body.results.map((entry: { outcome: string }) => entry.outcome), ["rejected", "applied"]);
      assert.equal(result.body.results[0].capability, "sync");
      assert.equal(repo.findItemForUser(owner, itemId)?.read, 0);
      const { createMcpServerForUser } = await import("../src/mcp/server.js");
      const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
      const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const mcp = createMcpServerForUser(owner, "write");
      const client = new Client({ name: "capability-regression", version: "1" });
      await mcp.connect(serverTransport);
      await client.connect(clientTransport);
      try {
        for (const [name, args] of [
          ["subscribe_feed", { url: "https://example.test/new" }],
          ["discover_feeds", { url: "https://example.test/new" }],
          ["update_feed", { feedId: feed.id, url: "https://example.test/new" }],
          ["refresh_feed", { feedId: feed.id }],
          ["import_opml", { opml: '<opml><body><outline xmlUrl="https://example.test/new"/></body></opml>' }],
        ] as const) {
          const denied = await client.callTool({ name, arguments: args });
          assert.equal(denied.isError, true, name);
          assert.match(JSON.stringify(denied.content), /capability_not_available/);
        }
        assert.notEqual((await client.callTool({ name: "update_feed", arguments: { feedId: feed.id, label: "Still manageable" } })).isError, true);
      } finally { await client.close(); await mcp.close(); }
    } finally { capabilities.setCapabilitiesProvider(originalProvider); }
  });

  await t.test("notes keep unsubscribed items visible only to their author in lists, search and native API", async () => {
    repo.unsubscribe(owner, feed.id);
    repo.unsubscribe(other, feed.id);
    assert.ok(repo.findItemForUser(owner, itemId));
    assert.deepEqual(repo.listItemsForUser(owner).map(item => item.id), [itemId]);
    assert.deepEqual(repo.listItemsForUser(owner, { search: "Independent note" }).map(item => item.id), [itemId]);
    assert.deepEqual(repo.listItemsForUser(owner, { bookmarkedOnly: true }), []);
    assert.deepEqual(repo.listItemsForUser(outsider), []);
    assert.equal((await call("/api/v1/items", owner)).body.items[0].id, itemId);
  });

  await t.test("curated editions grant icon access after unsubscribing, dismissed and foreign editions do not", () => {
    repo.deleteItemNote(owner, itemId);
    assert.equal(canAccessFeed(owner, feed.id), false);
    db.prepare("INSERT INTO editions (user_id, item_ids, source, status) VALUES (?, ?, 'curated', 'active')").run(owner, JSON.stringify([itemId]));
    assert.equal(canAccessFeed(owner, feed.id), true);
    assert.equal(canAccessFeed(outsider, feed.id), false);
    db.prepare("UPDATE editions SET status = 'dismissed' WHERE user_id = ?").run(owner);
    assert.equal(canAccessFeed(owner, feed.id), false);
    db.prepare("UPDATE editions SET status = 'active', source = 'automatic' WHERE user_id = ?").run(owner);
    assert.equal(canAccessFeed(owner, feed.id), false);
  });

  await t.test("inbox deletes neither create subscriptions nor announce intermediate state and note changes", () => {
    assert.equal(deleteInboxItem(outsider, itemId), false);
    assert.equal(repo.findFeedByUrl(`feedkeeper://inbox/${outsider}`), undefined);
    const inbox = ensureUserInbox(owner);
    const id = Number(db.prepare("INSERT INTO items (feed_id, guid, title) VALUES (?, 'clipping', 'Clipping')").run(inbox.id).lastInsertRowid);
    repo.bookmarkItem(owner, id);
    repo.markItemRead(owner, id);
    repo.setItemNote(owner, id, "Personal note");
    db.prepare("INSERT INTO item_progress (user_id, item_id, position) VALUES (?, ?, 0.5)").run(owner, id);
    const before = sync.currentSeq(owner);
    assert.equal(deleteInboxItem(other, id), false);
    assert.ok(repo.findItemById(id));
    assert.equal(deleteInboxItem(owner, id), true);
    assert.equal(repo.findItemById(id), undefined);
    for (const table of ["item_bookmarks", "item_reads", "item_progress", "item_notes", "item_note_revisions"]) {
      assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE item_id = ?`).get(id)?.n, 0);
    }
    assert.deepEqual(sync.listChanges(owner, before).changes, []);
  });
});
