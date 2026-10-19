import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express from "express";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

test("account capabilities and feature negotiation for self-hosted instances", async () => {
  process.env.DATABASE_PATH = ":memory:";
  process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";

  const { db, runMigrations } = await import("../src/db/index.js");
  const { v1Router } = await import("../src/api/v1/index.js");
  const { authRouter } = await import("../src/api/auth.js");
  const { mcpRouter } = await import("../src/mcp/http.js");
  const { createPersonalAccessToken } = await import("../src/auth/tokens.js");
  const { setCapabilitiesProvider } = await import("../src/auth/capabilities.js");
  type CapabilitiesProvider = import("../src/auth/capabilities.js").CapabilitiesProvider;
  type AccountCapabilities = import("../src/auth/capabilities.js").AccountCapabilities;

  runMigrations();

  const addUser = db.prepare("INSERT INTO users (email, password_hash, display_name) VALUES (?, 'hash', ?)");
  const testUserId = Number(addUser.run("reader@example.test", "Test Reader").lastInsertRowid);
  const otherUserId = Number(addUser.run("other@example.test", "Other Reader").lastInsertRowid);

  const testToken = createPersonalAccessToken(testUserId, "Test Token", "write").token;
  const otherToken = createPersonalAccessToken(otherUserId, "Other Token", "write").token;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const header = req.headers["x-test-session-user"];
    if (header) {
      req.session = { userId: Number(header) } as typeof req.session;
    }
    next();
  });
  app.use("/api/auth", authRouter);
  app.use("/api/v1", v1Router);
  app.use("/mcp", mcpRouter);

  const server = app.listen(0);
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;

  const call = async (path: string, token: string | null, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) => {
    const headers: Record<string, string> = { "content-type": "application/json", ...init.headers };
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`${base}${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    const type = res.headers.get("content-type") ?? "";
    const body = type.includes("application/json") ? await res.json() : await res.text();
    return { status: res.status, body };
  };

  try {
    // 1. Default self-hosted behaviour:
    const v1MeRes = await call("/api/v1/me", testToken);
    assert.equal(v1MeRes.status, 200);
    const v1User = v1MeRes.body as { capabilities: AccountCapabilities };
    assert.equal(v1User.capabilities.type, "selfhosted");
    assert.equal(v1User.capabilities.features.mcp, true);
    assert.equal(v1User.capabilities.features.sync, true);

    const authMeRes = await call("/api/auth/me", null, { headers: { "x-test-session-user": String(testUserId) } });
    assert.equal(authMeRes.status, 200);
    const authUser = authMeRes.body as { capabilities: AccountCapabilities };
    assert.equal(authUser.capabilities.type, "selfhosted");

    // 2. Custom capability provider hook:
    class CustomProvider implements CapabilitiesProvider {
      getCapabilitiesForUser(userId: number): AccountCapabilities {
        const hasMcp = userId === testUserId;
        return {
          type: "custom",
          features: {
            mcp: hasMcp,
            sync: true,
            notes: true,
            editions: true,
            fulltext: true,
          },
          manageUrl: "https://account.example.test",
        };
      }

      hasCapability(userId: number, capability: string): boolean {
        const userCaps = this.getCapabilitiesForUser(userId);
        return Boolean(userCaps.features[capability]);
      }
    }

    setCapabilitiesProvider(new CustomProvider());

    // User without MCP capability receives 403 capability_not_available
    const mcpDeniedRes = await call("/mcp", otherToken, {
      method: "POST",
      body: { jsonrpc: "2.0", method: "tools/list", id: 1 },
    });
    assert.equal(mcpDeniedRes.status, 403);
    assert.equal((mcpDeniedRes.body as { error: string }).error, "capability_not_available");

    // User with MCP capability is authorized
    const mcpAllowedRes = await call("/mcp", testToken, {
      method: "POST",
      body: { jsonrpc: "2.0", method: "tools/list", id: 1 },
    });
    assert.notEqual(mcpAllowedRes.status, 403);

    // The feature map is authoritative even for selfhosted types and providers with an old hook.
    const features: AccountCapabilities["features"] = {
      mcp: true, sync: true, notes: true, editions: true, fulltext: false, "search.fts": true,
    };
    setCapabilitiesProvider({ getCapabilitiesForUser: () => ({ type: "selfhosted", features, manageUrl: "https://account.example.test" }) });
    const { createMcpServerForUser } = await import("../src/mcp/server.js");
    const { setItemNote, findItemNote } = await import("../src/feeds/repository.js");
    const feed = Number(db.prepare("INSERT INTO feeds (url, title) VALUES ('https://example.test/feed', 'Test')").run().lastInsertRowid);
    db.prepare("INSERT INTO subscriptions (user_id, feed_id) VALUES (?, ?)").run(testUserId, feed);
    const item = Number(db.prepare("INSERT INTO items (feed_id, guid, title, content_snippet, published_at, created_at) VALUES (?, 'capability', 'Capability story', 'needle', ?, ?)").run(feed, new Date().toISOString(), new Date().toISOString()).lastInsertRowid);
    setItemNote(testUserId, item, "Existing thought");
    const readToken = createPersonalAccessToken(testUserId, "Read only", "read").token;
    assert.equal((await call("/api/v1/me", testToken)).status, 200);
    assert.equal((await call("/api/v1/search?q=needle", testToken)).status, 200);
    assert.equal((await call(`/api/v1/items/${item}/full-text`, testToken, { method: "POST" })).status, 403);
    features.fulltext = true;
    delete features["search.fts"];
    assert.equal((await call("/api/v1/search?q=needle", testToken)).status, 403);

    features.notes = false;
    const noteDenied = await call(`/api/v1/items/${item}/note`, testToken, { method: "PUT", body: { content: "Blocked" } });
    assert.equal(noteDenied.status, 403);
    assert.equal((noteDenied.body as { capability: string }).capability, "notes");
    assert.equal((await call(`/api/v1/items/${item}/note`, testToken)).status, 200);
    assert.equal((await call(`/api/v1/items/${item}/note.md`, testToken)).status, 200);
    assert.equal((await call("/api/v1/notes/export", testToken)).status, 200);
    assert.equal(findItemNote(testUserId, item)?.content, "Existing thought");
    const at = new Date().toISOString();
    const blocked = { id: "blocked-note-id", type: "item.note.set", itemId: item, at, content: "Queued thought" };
    const mixed = await call("/api/v1/mutations", testToken, { method: "POST", body: { mutations: [blocked, { id: "allowed-read-id", type: "item.read", itemId: item, at, value: true }] } });
    const results = (mixed.body as { results: { outcome: string; retryable?: boolean }[] }).results;
    assert.deepEqual(results.map((entry) => entry.outcome), ["rejected", "applied"]);
    assert.equal(results[0].retryable, true);
    assert.equal(db.prepare("SELECT 1 FROM applied_mutations WHERE mutation_id = ?").get(blocked.id), undefined);
    features.notes = true;
    const retry = await call("/api/v1/mutations", testToken, { method: "POST", body: { mutations: [blocked] } });
    assert.equal((retry.body as { results: { outcome: string }[] }).results[0].outcome, "applied");
    assert.equal(findItemNote(testUserId, item)?.content, "Queued thought");

    features.sync = false;
    assert.equal((await call("/api/v1/sync", testToken)).status, 403);
    assert.equal((await call("/api/v1/items", testToken)).status, 200);
    assert.equal((await call("/api/v1/native-preferences", testToken)).status, 200);
    assert.equal((await call("/api/v1/native-preferences", testToken, { method: "PATCH", body: {} })).status, 403);
    assert.equal((await call("/api/v1/folders", testToken, { method: "POST", body: { name: "Plain" } })).status, 201);
    assert.equal((await call("/api/v1/folders", testToken, { method: "POST", body: { name: "Icon", iconSymbol: "cpu" } })).status, 403);
    assert.equal((await call(`/api/v1/items/${item}/note`, readToken, { method: "PUT", body: { content: "Forbidden" } })).status, 403);

    features.editions = false;
    assert.equal((await call("/api/v1/edition/state", testToken)).status, 200);
    assert.equal((await call("/api/v1/edition/candidates", testToken)).status, 403);
    assert.equal((await call("/api/v1/edition/candidates", testToken)).status, 403);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const scopedServer = createMcpServerForUser(testUserId, "write");
    const client = new Client({ name: "capability-test", version: "1" });
    await scopedServer.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const candidateResult = await client.callTool({ name: "get_edition_candidates", arguments: {} });
      assert.equal(candidateResult.isError, true);
      const stateResult = await client.callTool({ name: "get_edition", arguments: {} });
      assert.notEqual(stateResult.isError, true);
      const readResult = await client.callTool({ name: "mark_read", arguments: { itemId: item } });
      assert.equal(readResult.isError, true);
      features.fulltext = false;
      assert.equal((await client.callTool({ name: "fetch_full_text", arguments: { itemId: item } })).isError, true);
    } finally { await client.close(); await scopedServer.close(); }

    features.notes = false;
    assert.equal((await call(`/api/v1/items/${item}/note`, testToken, { method: "DELETE" })).status, 204);

  } finally {
    server.close();
    db.close();
  }
});
