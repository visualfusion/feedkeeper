import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express from "express";

test("an account without the sync feature can read and delete, but not add or update feeds", async () => {
  process.env.DATABASE_PATH = ":memory:";
  process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";

  const { db, runMigrations } = await import("../src/db/index.js");
  const { feedsRouter } = await import("../src/api/feeds.js");
  const { foldersRouter } = await import("../src/api/folders.js");
  const repository = await import("../src/feeds/repository.js");
  const { feedHasActiveSubscriber } = await import("../src/feeds/poller.js");
  const { setCapabilitiesProvider } = await import("../src/auth/capabilities.js");
  type AccountCapabilities = import("../src/auth/capabilities.js").AccountCapabilities;
  runMigrations();

  const addUser = db.prepare("INSERT INTO users (email, password_hash, display_name) VALUES (?, 'hash', ?)");
  const frozen = Number(addUser.run("frozen@example.test", "Frozen").lastInsertRowid);
  const active = Number(addUser.run("active@example.test", "Active").lastInsertRowid);
  setCapabilitiesProvider({
    getCapabilitiesForUser(userId): AccountCapabilities {
      const sync = userId !== frozen;
      return { type: "test", features: { mcp: sync, sync, notes: sync, editions: sync, fulltext: sync, "search.fts": sync, inbox: sync }, manageUrl: "https://example.test/plan" };
    },
  });

  const own = repository.createFeed("https://example.test/own.xml", 30);
  const shared = repository.createFeed("https://example.test/shared.xml", 30);
  repository.subscribe(frozen, own.id);
  repository.subscribe(frozen, shared.id);
  repository.subscribe(active, shared.id);

  await t_feeds();
  async function t_feeds() {
    assert.equal(feedHasActiveSubscriber(own.id), false, "only an account without sync subscribes: no updates");
    assert.equal(feedHasActiveSubscriber(shared.id), true, "someone with sync subscribes too: the feed keeps being fetched");
  }

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const header = req.headers["x-test-session-user"];
    if (header) req.session = { userId: Number(header) } as typeof req.session;
    next();
  });
  app.use("/api/feeds", feedsRouter);
  app.use("/api/folders", foldersRouter);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (user: number, method: string, path: string, body?: unknown) => {
    const res = await fetch(base + path, { method, headers: { "content-type": "application/json", "x-test-session-user": String(user) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => null) as any };
  };

  try {
    for (const [method, path, body] of [
      ["POST", "/api/feeds", { url: "https://example.test/new.xml" }],
      ["POST", "/api/feeds/discover", { url: "https://example.test" }],
      ["POST", "/api/feeds/opml", {}],
      ["POST", `/api/feeds/${own.id}/refresh`, {}],
      ["POST", "/api/feeds/refresh-all", {}],
      ["POST", "/api/folders", { name: "New" }],
    ] as const) {
      const answer = await call(frozen, method, path, body);
      assert.equal(answer.status, 403, `${method} ${path}`);
      assert.equal(answer.body.error, "capability_not_available");
      assert.equal(answer.body.capability, "sync");
      assert.equal(answer.body.manageUrl, "https://example.test/plan", "the answer says where to change the plan");
    }
    assert.equal((await call(frozen, "GET", "/api/feeds")).body.length, 2, "reading stays");
    assert.equal((await call(frozen, "DELETE", `/api/feeds/${own.id}`)).status, 204, "deleting stays");
    assert.equal((await call(frozen, "GET", "/api/feeds")).body.length, 1);
    assert.notEqual((await call(active, "POST", "/api/folders", { name: "Fine" })).status, 403, "an account with sync is not limited");
  } finally {
    server.close();
    setCapabilitiesProvider({ getCapabilitiesForUser: () => ({ type: "selfhosted", features: { mcp: true, sync: true, notes: true, editions: true, fulltext: true, "search.fts": true, inbox: true }, manageUrl: null }) });
  }
});
