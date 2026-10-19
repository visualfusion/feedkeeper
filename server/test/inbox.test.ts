import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import express from "express";

test("Universal Inbox: save web clippings, sync, retention protection, and unsubscribe guard", async () => {
  const source = createServer((req, res) => {
    const host = `http://${req.headers.host}`;
    if (req.url === "/article") {
      return res.writeHead(200, { "content-type": "text/html" }).end(`
        <!DOCTYPE html>
        <html>
          <head><title>Exciting Read It Later Article</title></head>
          <body>
            <article>
              <h1>Exciting Read It Later Article</h1>
              <p>This is a great article about software architecture and read-it-later workflows.</p>
              <img src="${host}/illustration.png" />
            </article>
          </body>
        </html>
      `);
    }
    if (req.url === "/illustration.png") {
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
      return res.writeHead(200, { "content-type": "image/png" }).end(png);
    }
    return res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => source.listen(0, "127.0.0.1", resolve));
  const articleUrl = `http://127.0.0.1:${(source.address() as AddressInfo).port}/article`;

  process.env.DATABASE_PATH = ":memory:";
  process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
  process.env.ALLOW_PRIVATE_FEEDS = "true";
  process.env.ARCHIVE_PATH = mkdtempSync(join(tmpdir(), "feedkeeper-inbox-archive-"));
  const cacheDir = mkdtempSync(join(tmpdir(), "feedkeeper-inbox-cache-"));
  process.env.IMAGE_CACHE_PATH = cacheDir;

  const { db, runMigrations } = await import("../src/db/index.js");
  const { v1Router } = await import("../src/api/v1/index.js");
  const { createPersonalAccessToken } = await import("../src/auth/tokens.js");
  const { saveToInbox } = await import("../src/feeds/inbox.js");
  const { runCleanup, updateRetentionSettings } = await import("../src/feeds/cleanup.js");
  const { createMcpServerForUser } = await import("../src/mcp/server.js");
  const { archiveIdle, stopImageCache } = await import("../src/feeds/archive.js");

  runMigrations();

  const addUser = db.prepare("INSERT INTO users (email, password_hash, display_name) VALUES (?, 'hash', ?)");
  const userId = Number(addUser.run("inbox-tester@example.test", "Inbox Tester").lastInsertRowid);
  const token = createPersonalAccessToken(userId, "Test Device", "write").token;

  const app = express();
  app.use(express.json());
  app.use("/api/v1", v1Router);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;

  const call = async (path: string, init: { method?: string; body?: unknown } = {}) => {
    const headers: Record<string, string> = { "content-type": "application/json", authorization: `Bearer ${token}` };
    const response = await fetch(base + path, {
      method: init.method ?? "GET",
      headers,
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    const type = response.headers.get("content-type") ?? "";
    const payload = type.includes("application/json") ? await response.json() : await response.text();
    return { status: response.status, body: payload };
  };

  try {
    // 1. Check features list in /meta
    const metaRes = await call("/meta");
    assert.equal(metaRes.status, 200);
    assert.ok((metaRes.body as any).features.includes("inbox"));

    // 2. Save an article via API POST /api/v1/inbox
    const saveRes = await call("/inbox", {
      method: "POST",
      body: {
        url: articleUrl,
        note: "Remember to review architecture patterns.",
      },
    });
    assert.equal(saveRes.status, 201);
    const saved = saveRes.body as any;
    assert.equal(saved.title, "Exciting Read It Later Article");
    assert.equal(saved.state.saved, true);
    assert.equal(saved.state.hasNote, true);
    assert.equal(saved.hasFullText, false, "Very short extractions are not declared complete");
    assert.ok(saved.contentHtml.includes("software architecture"), "Available extracted content remains readable");
    assert.equal(saved.content.status, "partial");

    // 3. Verify Inbox subscription created and flagged with isInbox
    const syncRes = await call("/sync?since=0");
    assert.equal(syncRes.status, 200);
    const changes = (syncRes.body as any).changes;
    const subChange = changes.find((c: any) => c.entity === "subscription");
    assert.ok(subChange);
    assert.equal(subChange.data.isInbox, true);

    const inboxFeedId = subChange.id;

    // 4. Attempting to delete the inbox subscription must be rejected
    const unsubRes = await call(`/subscriptions/${inboxFeedId}`, { method: "DELETE" });
    assert.equal(unsubRes.status, 404);
    assert.equal((unsubRes.body as any).error, "cannot_unsubscribe_inbox");

    // 5. Save a pure text clipping
    const textClipping = await saveToInbox(userId, {
      title: "Quick thought",
      textContent: "A quick note saved without a web URL.",
    });
    assert.ok(textClipping.itemId > 0);
    assert.equal(textClipping.item.title, "Quick thought");
    assert.equal(textClipping.item.bookmarked, 1);

    // 6. Verify retention cleanup does not purge inbox items even with aggressive settings
    updateRetentionSettings({
      autoCleanupEnabled: true,
      retentionReadDays: 1,
      retentionMaxDays: 1,
      retentionMaxItemsPerFeed: 1,
    });
    // Mark the article as read and advance time
    db.prepare("INSERT INTO item_reads (user_id, item_id, read_at) VALUES (?, ?, '2020-01-01T00:00:00.000Z')").run(
      userId,
      saved.id,
    );
    db.prepare("UPDATE items SET created_at = '2020-01-01T00:00:00.000Z', published_at = '2020-01-01T00:00:00.000Z' WHERE feed_id = ?").run(
      inboxFeedId,
    );

    runCleanup();

    // Verify both items still exist
    const checkItem1 = db.prepare("SELECT * FROM items WHERE id = ?").get(saved.id);
    const checkItem2 = db.prepare("SELECT * FROM items WHERE id = ?").get(textClipping.itemId);
    assert.ok(checkItem1, "Saved web article should not be purged by retention");
    assert.ok(checkItem2, "Text clipping should not be purged by retention");

    // 7. Test MCP tool save_to_inbox
    const mcpServer = createMcpServerForUser(userId, "write");
    assert.ok(mcpServer);
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "inbox-test", version: "1" });
    await mcpServer.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const tools = (await client.listTools()).tools.map((t) => t.name);
      assert.ok(tools.includes("save_to_inbox"));
      const mcpSaveRes = await client.callTool({
        name: "save_to_inbox",
        arguments: { title: "MCP Clipping", textContent: "Saved via MCP", note: "Created via MCP" },
      });
      assert.equal(mcpSaveRes.isError, undefined);
    } finally {
      await client.close();
      await mcpServer.close();
    }

    // 8. Test DELETE /api/v1/inbox/:id
    const delRes = await call(`/inbox/${saved.id}`, { method: "DELETE" });
    assert.equal(delRes.status, 204);

    const deletedItem = db.prepare("SELECT * FROM items WHERE id = ?").get(saved.id);
    assert.equal(deletedItem, undefined);
  } finally {
    await archiveIdle();
    await stopImageCache();
    rmSync(cacheDir, { recursive: true, force: true });
    server.close();
    source.close();
  }
});
