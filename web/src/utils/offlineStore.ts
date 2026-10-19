import { offlineAccountId } from "./offlineAccount.ts";
import type { Item } from "../api/client.ts";

export const OFFLINE_CACHE = "fk-offline";
export const API_CACHE = "fk-api";
const SNAPSHOT_KEY = "/__offline/articles";
const PREF_KEY = "fk_offline_saved";
export const SYNCED_KEY = "fk_saved_synced_at";

/** Everything needed to read without a connection. */
export interface OfflineSnapshot {
  userId: number;
  savedAt: string;
  /** Saved articles, in the order they were saved. */
  saved: Item[];
  /** The newest unread articles. */
  recent: Item[];
  /** Folder of each feed, so the folder filter keeps working offline. */
  feedFolders: Record<number, number | null>;
}

export interface OfflineFilter {
  feedId?: number;
  folderId?: number;
  unreadOnly?: boolean;
  bookmarkedOnly?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}

const supported = () => typeof window !== "undefined" && "caches" in window;

export function offlineEnabled(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== "false";
  } catch {
    return true;
  }
}

export function setOfflineEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, String(enabled));
  } catch {
    // Ignore localStorage errors
  }
}

export async function readSnapshot(): Promise<OfflineSnapshot | null> {
  const userId = offlineAccountId();
  if (!supported() || userId === null) return null;
  try {
    const response = await (await caches.open(`${OFFLINE_CACHE}-${userId}`)).match(SNAPSHOT_KEY);
    const snapshot = response ? await response.json() as OfflineSnapshot : null;
    return offlineAccountId() === userId && snapshot?.userId === userId ? snapshot : null;
  } catch {
    return null;
  }
}

export async function writeSnapshot(snapshot: OfflineSnapshot): Promise<void> {
  const userId = offlineAccountId();
  if (!supported() || userId === null || snapshot.userId !== userId) return;
  const cache = await caches.open(`${OFFLINE_CACHE}-${userId}`);
  if (offlineAccountId() !== userId) return;
  await cache.put(SNAPSHOT_KEY, new Response(JSON.stringify(snapshot), { headers: { "Content-Type": "application/json" } }));
}

export async function deleteSnapshot(): Promise<void> {
  if (!supported()) return;
  const userId = offlineAccountId();
  await caches.delete(userId === null ? OFFLINE_CACHE : `${OFFLINE_CACHE}-${userId}`);
  try {
    localStorage.removeItem(userId === null ? SYNCED_KEY : `${SYNCED_KEY}-${userId}`);
  } catch {
    // Ignore localStorage errors
  }
}

/** Saved articles first (in saved order), then the unread ones that are not saved. */
export function offlineItems(snapshot: OfflineSnapshot): Item[] {
  const seen = new Set<number>();
  return [...snapshot.saved, ...snapshot.recent].filter((item) => !seen.has(item.id) && seen.add(item.id));
}

/** Apply the list filters to the offline copy; `items` should already include pending changes. */
export function filterOffline(items: Item[], feedFolders: OfflineSnapshot["feedFolders"], filter: OfflineFilter): Item[] {
  const needle = filter.search?.trim().toLowerCase();
  const matching = items.filter((item) => {
    if (filter.bookmarkedOnly && !item.bookmarked) return false;
    if (filter.unreadOnly && !filter.bookmarkedOnly && item.read) return false;
    if (filter.feedId && item.feed_id !== filter.feedId) return false;
    if (filter.folderId && feedFolders[item.feed_id] !== filter.folderId) return false;
    if (!needle) return true;
    return [item.title, item.content_snippet, item.full_content_html, item.content_html].some((text) => text?.toLowerCase().includes(needle));
  });
  // The saved view keeps the order of saving; everything else is newest first.
  const ordered = filter.bookmarkedOnly ? matching : [...matching].sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""));
  const offset = filter.offset ?? 0;
  return ordered.slice(offset, filter.limit ? offset + filter.limit : undefined);
}
