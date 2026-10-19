import assert from "node:assert/strict";
import test from "node:test";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => void storage.set(key, String(value)),
  removeItem: (key) => void storage.delete(key),
};
const { setOfflineAccount } = await import("../src/utils/offlineAccount.ts");
const queue = await import("../src/utils/offlineQueue.ts");

const item = (id, read = false, bookmarked = false) => ({ id, read, bookmarked });

test("keeps only the last state per article and action", () => {
  storage.clear();
  setOfflineAccount(1);
  queue.enqueue("read", 1, true);
  queue.enqueue("read", 1, false);
  queue.enqueue("bookmark", 1, true);
  assert.equal(queue.pendingCount(), 2);
  assert.deepEqual(queue.pendingActions().map((entry) => [entry.action, entry.value]), [["read", false], ["bookmark", true]]);
});

test("shows pending changes on lists loaded earlier", () => {
  storage.clear();
  setOfflineAccount(1);
  queue.enqueue("read", 2, true);
  queue.enqueue("bookmark", 3, true);
  const result = queue.applyPending([item(1), item(2), item(3)]);
  assert.deepEqual(result.map((entry) => [entry.read, entry.bookmarked]), [[false, false], [true, false], [false, true]]);
});

test("a change sent successfully leaves the queue; an unreachable server stops the replay", async () => {
  storage.clear();
  setOfflineAccount(1);
  queue.enqueue("read", 1, true);
  queue.enqueue("read", 2, true);
  queue.enqueue("bookmark", 3, true);
  const sent = [];
  const handled = await queue.flushQueue(async (action, id) => {
    if (id === 3) throw new Error("offline");
    sent.push(`${action}:${id}`);
  }, (error) => error.message === "offline");
  assert.equal(handled, 2);
  assert.deepEqual(sent, ["read:1", "read:2"]);
  assert.equal(queue.pendingCount(), 1);
});

test("changes survive a busy server or an expired session", async () => {
  storage.clear();
  setOfflineAccount(1);
  queue.enqueue("read", 1, true);
  const handled = await queue.flushQueue(async () => { throw Object.assign(new Error("busy"), { status: 429 }); }, (error) => error.status === 429);
  assert.equal(handled, 0);
  assert.equal(queue.pendingCount(), 1);
});

test("a change the server rejects is dropped instead of blocking the queue", async () => {
  storage.clear();
  setOfflineAccount(1);
  queue.enqueue("bookmark", 9, true);
  queue.enqueue("read", 1, true);
  const handled = await queue.flushQueue(async (_action, id) => {
    if (id === 9) throw new Error("not found");
  }, () => false);
  assert.equal(handled, 2);
  assert.equal(queue.pendingCount(), 0);
});
