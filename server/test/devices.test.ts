import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express from "express";

test("a native app pairs with a one-time code and gets its own revocable token", async () => {
  process.env.DATABASE_PATH = ":memory:";
  process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
  const { db, runMigrations } = await import("../src/db/index.js");
  const { v1Router } = await import("../src/api/v1/index.js");
  const { createPairingCode } = await import("../src/auth/pairing.js");
  const { requireBearerToken } = await import("../src/auth/middleware.js");
  const { default: rateLimit } = await import("express-rate-limit");
  const { resolveToken, createPersonalAccessToken } = await import("../src/auth/tokens.js");
  runMigrations();

  const addUser = db.prepare("INSERT INTO users (email, password_hash, display_name) VALUES (?, 'hash', ?)");
  const ownerId = Number(addUser.run("device-owner@example.test", "Owner").lastInsertRowid);
  const otherId = Number(addUser.run("device-other@example.test", "Other").lastInsertRowid);

  // Stand-in for the cookie session: the test names the signed-in user in a header.
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const user = req.headers["x-test-user"];
    if (user) req.session = { userId: Number(user) } as typeof req.session;
    next();
  });
  app.use("/api/v1", v1Router);
  app.get("/mcp-like", rateLimit({ windowMs: 60000, limit: 100 }), requireBearerToken, (_req, res) => void res.json({ ok: true }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  const call = async (path: string, init: RequestInit & { user?: number; token?: string } = {}) => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (init.user) headers["x-test-user"] = String(init.user);
    if (init.token) headers.authorization = `Bearer ${init.token}`;
    const response = await fetch(base + path, { ...init, headers });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };

  try {
    // Anyone can read what the server supports; nothing else without credentials.
    const meta = await call("/meta");
    assert.equal(meta.status, 200);
    assert.equal(meta.body.apiVersion, 1);
    assert.ok(meta.body.features.includes("pairing"));

    // The cleanup rules are public, so apps can apply the same retention to their offline copy.
    const { updateRetentionSettings } = await import("../src/feeds/cleanup.js");
    updateRetentionSettings({ retentionReadDays: 14, retentionMaxDays: 60, retentionMaxItemsPerFeed: 500, autoCleanupEnabled: false });
    const rules = await call("/meta");
    assert.ok(rules.body.features.includes("retention"));
    assert.deepEqual(rules.body.limits.retention, { enabled: false, readDays: 14, maxDays: 60, maxItemsPerFeed: 500, protectActiveEdition: true });
    assert.equal(rules.body.limits.retentionDays, 60);
    assert.equal((await call("/me")).status, 401);
    assert.equal((await call("/pairing-codes", { method: "POST" })).status, 401);

    // The web app asks for a code and builds the QR payload from it.
    const created = await call("/pairing-codes", { method: "POST", user: ownerId });
    assert.equal(created.status, 201);
    assert.match(created.body.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.match(created.body.pairingUrl, /^feedkeeper:\/\/pair\?server=.+&code=/);

    // The app redeems it once; typing it in lower case without dashes works too.
    const pair = (code: string) => call("/devices/pair", { method: "POST", body: JSON.stringify({ code, deviceName: "Anna's iPhone", platform: "ios", appVersion: "1.0" }) });
    assert.equal((await pair("AAAA-BBBB-CCCC")).status, 400);
    const paired = await pair(created.body.code.replace(/-/g, "").toLowerCase());
    assert.equal(paired.status, 201);
    assert.match(paired.body.token, /^fk_dev_/);
    assert.equal(paired.body.user.email, "device-owner@example.test");
    assert.equal((await pair(created.body.code)).status, 400);

    // The device token identifies the owner and appears in the device list as the current device.
    const me = await call("/me", { token: paired.body.token });
    assert.equal(me.body.email, "device-owner@example.test");
    assert.equal(me.body.deviceId, paired.body.deviceId);
    const devices = await call("/devices", { token: paired.body.token });
    assert.deepEqual(devices.body.map((device: { name: string; platform: string; current: boolean }) => [device.name, device.platform, device.current]), [["Anna's iPhone", "ios", true]]);

    // A new code replaces the old one, and codes expire.
    const first = createPairingCode(ownerId);
    const second = createPairingCode(ownerId);
    assert.equal((await pair(first.code)).status, 400);
    db.prepare("UPDATE pairing_codes SET expires_at = ? WHERE user_id = ?").run(new Date(Date.now() - 1000).toISOString(), ownerId);
    assert.equal((await pair(second.code)).status, 400);

    // Devices are separate from hand-made tokens, and each is limited to its owner.
    createPersonalAccessToken(ownerId, "script", "read");
    assert.equal((await call("/devices", { user: ownerId })).body.length, 1);
    const foreign = await call("/devices", { user: otherId });
    assert.deepEqual(foreign.body, []);
    assert.equal((await call(`/devices/${paired.body.deviceId}`, { method: "DELETE", user: otherId })).status, 404);
    assert.equal(resolveToken(paired.body.token)?.kind, "device");

    // The MCP endpoint takes hand-made tokens only, never a paired device's token.
    const mcpLike = (token: string) => fetch(base.replace("/api/v1", "/mcp-like"), { headers: { authorization: `Bearer ${token}` } }).then((response) => response.status);
    assert.equal(await mcpLike(paired.body.token), 401);

    // Revoking stops the token right away.
    assert.equal((await call(`/devices/${paired.body.deviceId}`, { method: "DELETE", user: ownerId })).status, 204);
    assert.equal((await call("/me", { token: paired.body.token })).status, 401);
  } finally {
    server.close();
  }
});
