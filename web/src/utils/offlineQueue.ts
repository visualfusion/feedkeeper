import { offlineAccountId } from "./offlineAccount.ts";
import type { Item } from "../api/client.ts";

/** A change made without a connection, replayed once the server is reachable again. */
export type ItemAction = "read" | "bookmark";

const storageKey = () => {
  const userId = offlineAccountId();
  return userId === null ? null : `fk_offline_queue-${userId}`;
};
const listeners = new Set<() => void>();

// Keyed by action and article, so toggling twice offline leaves only the final state.
function load(): Map<string, boolean> {
  const key = storageKey();
  if (key === null) return new Map();
  try {
    return new Map(JSON.parse(localStorage.getItem(key) ?? "[]") as [string, boolean][]);
  } catch {
    return new Map();
  }
}

function save(queue: Map<string, boolean>): void {
  const key = storageKey();
  if (key === null) return;
  try {
    if (queue.size === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify([...queue]));
  } catch {
    // Ignore localStorage errors
  }
  listeners.forEach((listener) => listener());
}

const keyOf = (action: ItemAction, itemId: number) => `${action}:${itemId}`;

export function enqueue(action: ItemAction, itemId: number, value: boolean): void {
  const queue = load();
  queue.set(keyOf(action, itemId), value);
  save(queue);
}

export function dequeue(action: ItemAction, itemId: number): void {
  const queue = load();
  if (queue.delete(keyOf(action, itemId))) save(queue);
}

/** Drop unsent changes, which must never be sent under another account. */
export function clearQueue(): void {
  if (load().size > 0) save(new Map());
}

export function pendingCount(): number {
  return load().size;
}

export function subscribeQueue(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function pendingActions(): { action: ItemAction; itemId: number; value: boolean }[] {
  return [...load()].map(([key, value]) => {
    const [action, id] = key.split(":");
    return { action: action as ItemAction, itemId: Number(id), value };
  });
}

/** Show pending changes in lists that were loaded earlier, so the app agrees with what the user did. */
export function applyPending(items: Item[]): Item[] {
  const queue = load();
  if (queue.size === 0) return items;
  return items.map((item) => {
    const read = queue.get(keyOf("read", item.id));
    const bookmarked = queue.get(keyOf("bookmark", item.id));
    return read === undefined && bookmarked === undefined ? item : { ...item, read: read ?? item.read, bookmarked: bookmarked ?? item.bookmarked };
  });
}

/** Send queued changes in order; stops at the first one that should be retried later. */
export async function flushQueue(send: (action: ItemAction, itemId: number, value: boolean) => Promise<unknown>, transient: (error: unknown) => boolean): Promise<number> {
  let handled = 0;
  const userId = offlineAccountId();
  for (const { action, itemId, value } of pendingActions()) {
    if (userId === null || offlineAccountId() !== userId) return handled;
    try {
      await send(action, itemId, value);
    } catch (error) {
      // Keep the change while the server is unreachable, busy or the session needs renewing;
      // anything else (for example an article that no longer exists) cannot succeed later either.
      if (transient(error)) return handled;
    }
    if (offlineAccountId() !== userId) return handled;
    dequeue(action, itemId);
    handled++;
  }
  return handled;
}
