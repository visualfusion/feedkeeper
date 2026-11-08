import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

test("MCP cursors isolate users and read-only tokens expose no write tools", async () => {
  process.env.DATABASE_PATH = ":memory:";
  process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";

  const { db, runMigrations } = await import("../src/db/index.js");
  const { createPersonalAccessToken, resolveToken } = await import("../src/auth/tokens.js");
  const { subscribe } = await import("../src/feeds/repository.js");
  const { listItemsPage, getItemForMcp } = await import("../src/mcp/items.js");
  const { createMcpServerForUser } = await import("../src/mcp/server.js");
  runMigrations();

  const addUser = db.prepare("INSERT INTO users (email, password_hash, display_name) VALUES (?, 'hash', ?)");
  const ownerId = Number(addUser.run("mcp-owner@example.test", "Owner").lastInsertRowid);
  const otherId = Number(addUser.run("mcp-other@example.test", "Other").lastInsertRowid);
  const feedId = Number(db.prepare("INSERT INTO feeds (url) VALUES (?)").run("https://example.test/feed").lastInsertRowid);
  subscribe(ownerId, feedId);

  const insert = db.prepare("INSERT INTO items (feed_id, guid, title, content_html, created_at) VALUES (?, ?, ?, ?, ?)");
  const ids = [1, 2, 3].map((number) => Number(insert.run(feedId, String(number), `Article ${number}`, "<p>Body</p>", "2026-01-01T00:00:00.000Z").lastInsertRowid));

  const first = listItemsPage(ownerId, { limit: 2 });
  assert.deepEqual(first.items.map((item) => item.id), [ids[2], ids[1]]);
  assert.ok(first.nextCursor);
  assert.equal("content_html" in first.items[0], false);
  assert.equal(getItemForMcp(ownerId, ids[2])?.content_html, "<p>Body</p>");
  assert.equal(getItemForMcp(otherId, ids[2]), null);

  const next = listItemsPage(ownerId, { limit: 2, before: first.nextCursor! });
  assert.deepEqual(next.items.map((item) => item.id), [ids[0]]);
  const newId = Number(insert.run(feedId, "4", "Article 4", "<p>New</p>", "2026-01-02T00:00:00.000Z").lastInsertRowid);
  assert.deepEqual(listItemsPage(ownerId, { after: first.newestCursor! }).items.map((item) => item.id), [newId]);
  assert.deepEqual(listItemsPage(otherId, {}).items, []);
  assert.throws(() => listItemsPage(ownerId, { before: "invalid" }), /invalid_cursor/);

  const readToken = createPersonalAccessToken(ownerId, "reader", "read");
  const writeToken = createPersonalAccessToken(ownerId, "writer", "write");
  assert.deepEqual(resolveToken(readToken.token), { userId: ownerId, scope: "read", kind: "api", tokenId: readToken.id });
  assert.deepEqual(resolveToken(writeToken.token), { userId: ownerId, scope: "write", kind: "api", tokenId: writeToken.id });

  for (const scope of ["read", "write"] as const) {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServerForUser(ownerId, scope);
    const client = new Client({ name: "feedkeeper-test", version: "1.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    assert.ok(names.includes("list_items"));
    assert.ok(names.includes("get_item"));
    assert.equal(names.includes("mark_read"), scope === "write");
    assert.equal(names.includes("unsubscribe_feed"), scope === "write");
    assert.equal(names.includes("unmute_keyword"), scope === "write");
    assert.equal(names.includes("cleanup_database"), false);
    assert.match(client.getInstructions() ?? "", /personal RSS reader/);
    await client.close();
    await server.close();
  }

  db.close();
});
