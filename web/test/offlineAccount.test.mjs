import assert from "node:assert/strict";
import test from "node:test";
import { offlineAccountId, setOfflineAccount } from "../src/utils/offlineAccount.ts";
import { readSnapshot, writeSnapshot } from "../src/utils/offlineStore.ts";
import { enqueue, pendingActions, flushQueue } from "../src/utils/offlineQueue.ts";

const storage = new Map();
globalThis.localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: key => storage.delete(key),
};
const stores = new Map();
globalThis.window = {};
globalThis.caches = window.caches = {
  open: async name => {
    if (!stores.has(name)) {
      const entries = new Map();
      stores.set(name, { match: async key => entries.get(key)?.clone(), put: async (key, value) => entries.set(key, value.clone()) });
    }
    return stores.get(name);
  },
};
const snapshot = userId => ({ userId, savedAt: new Date().toISOString(), saved: [{ id: userId, title: `Account ${userId}` }], recent: [], feedFolders: {} });

test("snapshots and queued actions are isolated even when accounts use the same article IDs", async () => {
  setOfflineAccount(1);
  await writeSnapshot(snapshot(1));
  enqueue("read", 42, true);
  setOfflineAccount(2);
  assert.equal(await readSnapshot(), null);
  assert.deepEqual(pendingActions(), []);
  await writeSnapshot(snapshot(1));
  assert.equal(await readSnapshot(), null, "a late write from the previous account is refused");
  await writeSnapshot(snapshot(2));
  enqueue("bookmark", 42, true);
  assert.equal((await readSnapshot()).userId, 2);
  setOfflineAccount(1);
  assert.equal((await readSnapshot()).userId, 1);
  assert.deepEqual(pendingActions(), [{ action: "read", itemId: 42, value: true }]);
});

test("legacy snapshots without ownership and mismatched snapshot bodies are rejected", async () => {
  setOfflineAccount(3);
  const legacy = { ...snapshot(1) }; delete legacy.userId;
  await (await caches.open("fk-offline")).put("/__offline/articles", new Response(JSON.stringify(legacy)));
  assert.equal(await readSnapshot(), null);
  await (await caches.open("fk-offline-3")).put("/__offline/articles", new Response(JSON.stringify(snapshot(1))));
  assert.equal(await readSnapshot(), null);
});

test("an account change in another tab revokes offline reads and queued actions immediately", async () => {
  setOfflineAccount(1);
  localStorage.setItem("fk_offline_owner", "2");
  assert.equal(offlineAccountId(), null);
  assert.equal(await readSnapshot(), null);
  assert.deepEqual(pendingActions(), []);
  enqueue("read", 99, true);
  assert.deepEqual(pendingActions(), []);
});

test("a running queue replay stops when its account changes", async () => {
  setOfflineAccount(4);
  enqueue("read", 1, true); enqueue("read", 2, true);
  const sent = [];
  await flushQueue(async (_action, id) => { sent.push(id); setOfflineAccount(5); }, () => false);
  assert.deepEqual(sent, [1]);
  setOfflineAccount(4);
  assert.equal(pendingActions().length, 2, "the new account cannot acknowledge the old account's queue");
});
