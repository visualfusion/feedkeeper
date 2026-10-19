import { offlineAccountId } from "./offlineAccount.ts";
import { api, isTransient, sendItemAction, type Item } from "../api/client.ts";
import { flushQueue } from "./offlineQueue.ts";
import { API_CACHE, SYNCED_KEY, deleteSnapshot, offlineEnabled, writeSnapshot } from "./offlineStore.ts";

const PAGE_SIZE = 100;
const MAX_SAVED = 300;
// Stays below the service worker's own limit for stored images, so syncing never pushes out earlier ones.
const MAX_IMAGES = 1500;
const RECENT_LIMIT = 100;
const MIN_INTERVAL_MS = 5 * 60 * 1000;
// Archived images and images fetched through the server, whatever host the server believed it had.
const OWN_IMAGE_URL = /https?:\/\/[^"'\s<>)]+(\/api\/(?:archive\/images\/\d+|items\/\d+\/image\?src=[^"'\s<>)]+))/g;

let running: Promise<number | null> | null = null;
// Bumped on logout, so a sync that is still running does not write the previous account's data afterwards.
let generation = 0;

export function cancelSync(): void {
  generation++;
}

function lastSync(): number {
  try {
    return Number(localStorage.getItem(`${SYNCED_KEY}-${offlineAccountId()}`)) || 0;
  } catch {
    return 0;
  }
}

/** Address images through this page's own origin, so the stored copies are found again offline. */
function localize(text: string | null | undefined, found: Set<string>): string | null | undefined {
  return text?.replace(OWN_IMAGE_URL, (_match, path: string) => {
    const url = `${window.location.origin}${path}`;
    found.add(url);
    return url;
  });
}

function localizeItem(item: Item, found: Set<string>): Item {
  return {
    ...item,
    image_url: localize(item.image_url, found),
    content_html: localize(item.content_html, found),
    full_content_html: localize(item.full_content_html, found),
  };
}

async function downloadImages(cache: Cache, urls: string[], cancelled: () => boolean): Promise<void> {
  const queue = urls.slice(0, MAX_IMAGES);
  const worker = async () => {
    for (let url = queue.shift(); url && !cancelled(); url = queue.shift()) {
      const cached = await cache.match(url, { ignoreVary: true });
      const immutable = /\/api\/archive\/images\/\d+/.test(new URL(url).pathname);
      const age = Number(cached?.headers.get("cache-control")?.match(/max-age=(\d+)/)?.[1] ?? 0);
      const fresh = cached && Date.now() - Date.parse(cached.headers.get("date") ?? "") < Math.min(age, 21600) * 1000;
      if (cached && (immutable || fresh)) continue;
      try {
        const response = await fetch(url, { credentials: "include" });
        if (response.ok && !cancelled()) await cache.put(url, response);
      } catch {
        // The image stays online-only; the next sync tries again.
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
}

async function dropCachedImages(cache: Cache, keep: Set<string>): Promise<void> {
  for (const request of await cache.keys()) {
    if (/\/api\/(archive\/images\/|items\/\d+\/image)/.test(request.url) && !keep.has(request.url)) await cache.delete(request);
  }
}

/** Send changes made offline. Returns how many were handled. */
export async function flushPending(): Promise<number> {
  return navigator.onLine ? flushQueue(sendItemAction, isTransient) : 0;
}

/** Send pending changes and bring the offline copy up to date; a new copy is made right away when changes were sent. */
export async function syncNow(): Promise<void> {
  const sent = await flushPending();
  await syncOfflineCopy({ force: sent > 0 });
}

/**
 * Keep saved articles and the newest unread ones, with their images, on this device.
 * Returns the number of articles stored, or null when nothing was done (disabled, offline or too recent).
 */
export function syncOfflineCopy(options: { force?: boolean } = {}): Promise<number | null> {
  const userId = offlineAccountId();
  if (userId === null || !("caches" in window) || !offlineEnabled() || !navigator.onLine) return Promise.resolve(null);
  // A change that arrives while a sync runs gets its own run afterwards.
  if (running) return options.force ? running.then(() => syncOfflineCopy(options)) : running;
  if (!options.force && Date.now() - lastSync() < MIN_INTERVAL_MS) return Promise.resolve(null);

  const started = generation;
  const cancelled = () => started !== generation || offlineAccountId() !== userId;
  running = (async () => {
    try {
      const found = new Set<string>();
      const savedRaw: Item[] = [];
      for (let offset = 0; savedRaw.length < MAX_SAVED; offset += PAGE_SIZE) {
        const page = await api.listItems({ bookmarkedOnly: true, limit: PAGE_SIZE, offset, offline: true });
        savedRaw.push(...page);
        if (page.length < PAGE_SIZE) break;
      }
      const recentRaw = await api.listItems({ unreadOnly: true, limit: RECENT_LIMIT, offline: true });
      const feeds = await api.listFeeds().catch(() => []);

      const saved = savedRaw.slice(0, MAX_SAVED).map((item) => localizeItem(item, found));
      const recent = recentRaw.map((item) => localizeItem(item, found));
      if (cancelled()) return null;
      const cache = await caches.open(API_CACHE);
      if (cancelled()) return null;
      await downloadImages(cache, [...found], cancelled);
      if (cancelled()) return null;
      await dropCachedImages(cache, found);

      if (cancelled()) return null;
      await writeSnapshot({ userId, savedAt: new Date().toISOString(), saved, recent, feedFolders: Object.fromEntries(feeds.map((feed) => [feed.id, feed.folder_id])) });
      if (cancelled()) return null;
      localStorage.setItem(`${SYNCED_KEY}-${userId}`, String(Date.now()));
      return new Set([...saved, ...recent].map((item) => item.id)).size;
    } catch {
      return null;
    } finally {
      running = null;
    }
  })();
  return running;
}

/** Turn the offline copy off and free the space. */
export async function removeOfflineCopy(): Promise<void> {
  await deleteSnapshot();
  if (!("caches" in window)) return;
  await dropCachedImages(await caches.open(API_CACHE), new Set());
}
