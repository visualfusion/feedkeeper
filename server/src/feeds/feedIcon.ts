import crypto from "node:crypto";
import { Resvg } from "@resvg/resvg-js";
import { extractLargestImageAsPng } from "@humanwhocodes/ico-to-png";
import { db } from "../db/index.js";
import { fetchImage } from "./fetcher.js";
import { readPollSettings } from "./pollSettings.js";
import { detectImageType } from "./archive.js";

const MAX_ICON_BYTES = 1024 * 1024;
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHED = 500;

export interface FeedIcon {
  buffer: Buffer;
  mime: string;
  hash: string;
}

const cache = new Map<number, { icon: FeedIcon | null; fetchedAt: number }>();

/** Compute stable content hash for versioning and caching. */
export function hashIconBuffer(buffer: Uint8Array): string {
  return crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 16);
}

/** Icons are small, so besides raster images the formats typical for favicons are accepted. */
export function detectIconType(buffer: Uint8Array): string | null {
  const raster = detectImageType(buffer);
  if (raster) return raster.mime;
  if (buffer.length >= 4 && buffer[0] === 0 && buffer[1] === 0 && buffer[2] === 1 && buffer[3] === 0) return "image/x-icon";
  const head = Buffer.from(buffer.subarray(0, 512)).toString("utf8").trimStart();
  return /^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)?<svg[\s>]/i.test(head) ? "image/svg+xml" : null;
}

/** Whether the user subscribes to the feed or has saved or annotated one of its articles. */
export function canAccessFeed(userId: number, feedId: number): boolean {
  return Boolean(
    db.prepare(
      `SELECT 1 FROM feeds f WHERE f.id = ?
         AND (EXISTS (SELECT 1 FROM subscriptions s WHERE s.feed_id = f.id AND s.user_id = ?)
           OR EXISTS (SELECT 1 FROM items i JOIN item_bookmarks b ON b.item_id = i.id WHERE i.feed_id = f.id AND b.user_id = ?)
           OR EXISTS (SELECT 1 FROM items i JOIN item_notes n ON n.item_id = i.id WHERE i.feed_id = f.id AND n.user_id = ?))`,
    ).get(feedId, userId, userId, userId),
  );
}

function candidates(feed: { icon_url: string | null; site_url: string | null; url: string }, declaredUrls: string[]): string[] {
  const urls = new Set<string>(declaredUrls);
  if (feed.icon_url) urls.add(feed.icon_url);
  for (const source of [feed.site_url, feed.url]) {
    try {
      if (source) urls.add(`${new URL(source).origin}/favicon.ico`);
    } catch {
      // Try the next source.
    }
  }
  return [...urls];
}

/** Keep the same raster icon in every client, including clients without SVG or ICO support. */
function rasterIcon(buffer: Buffer, mime: string): { buffer: Buffer; mime: string } {
  if (mime === "image/svg+xml") {
    const svg = new Resvg(buffer, { fitTo: { mode: "width", value: 512 }, font: { loadSystemFonts: false } });
    if (svg.width > 4096 || svg.height > 4096 || svg.width < 1 || svg.height < 1 ||
        svg.width / svg.height > 8 || svg.height / svg.width > 8) throw new Error("Invalid SVG icon size");
    return { buffer: svg.render().asPng(), mime: "image/png" };
  }
  if (mime === "image/x-icon") {
    const image = extractLargestImageAsPng(buffer);
    if (!image) throw new Error("Invalid ICO icon");
    return { buffer: Buffer.from(image.data), mime: "image/png" };
  }
  return { buffer, mime };
}

/** Store or update feed icon in database, only notifying subscribers when its content changes. */
export function storeFeedIcon(feedId: number, buffer: Buffer, mime: string): FeedIcon {
  ({ buffer, mime } = rasterIcon(buffer, mime));
  const hash = hashIconBuffer(buffer);
  db.prepare(
    `INSERT INTO feed_icons (feed_id, data, mime, hash, updated_at)
     VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     ON CONFLICT (feed_id) DO UPDATE SET data = excluded.data, mime = excluded.mime, hash = excluded.hash, updated_at = excluded.updated_at
     WHERE feed_icons.hash != excluded.hash OR feed_icons.mime != excluded.mime`,
  ).run(feedId, buffer, mime, hash);

  const icon: FeedIcon = { buffer, mime, hash };
  if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!);
  cache.set(feedId, { icon, fetchedAt: Date.now() });
  return icon;
}

/** Re-check remote candidates during the weekly feed poll, even if a stored icon exists. */
const refreshing = new Map<number, Promise<FeedIcon | null>>();
export function refreshFeedIcon(feedId: number, siteUrl?: string | null, declaredUrls: string[] = [], signal?: AbortSignal): Promise<FeedIcon | null> {
  const current = refreshing.get(feedId);
  if (current) return current;
  if (refreshing.size >= readPollSettings().maxWaiters) return Promise.resolve(null);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new DOMException("Icon deadline exceeded", "TimeoutError")), readPollSettings().attemptTimeoutMs);
  const deadline = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
  const promise = refreshIcon(feedId, siteUrl, declaredUrls, deadline).finally(() => {
    clearTimeout(timeout);
    refreshing.delete(feedId);
  });
  refreshing.set(feedId, promise);
  return promise;
}
async function refreshIcon(feedId: number, siteUrl: string | null | undefined, declaredUrls: string[], signal: AbortSignal): Promise<FeedIcon | null> {
  const feed = db.prepare<[number], { icon_url: string | null; site_url: string | null; url: string }>(
    "SELECT icon_url, site_url, url FROM feeds WHERE id = ?",
  ).get(feedId);
  for (const url of feed ? candidates({ ...feed, site_url: siteUrl ?? feed.site_url }, declaredUrls) : []) {
    if (signal.aborted) break;
    try {
      const { buffer } = await fetchImage(url, MAX_ICON_BYTES, signal);
      const mime = detectIconType(buffer);
      if (mime) {
        const icon = storeFeedIcon(feedId, buffer, mime);
        db.prepare("UPDATE feeds SET icon_url = ? WHERE id = ?").run(url, feedId);
        return icon;
      }
    } catch {
      // Keep the last good icon and try the next candidate.
    }
  }
  return null;
}

/** Retrieve icon hash from database without reading full blob. */
export function getFeedIconHash(feedId: number): string | null {
  const row = db.prepare<[number], { hash: string }>("SELECT hash FROM feed_icons WHERE feed_id = ?").get(feedId);
  return row?.hash ?? null;
}

/**
 * The feed's icon, fetched by this server so the browser and native apps can keep it for offline use
 * without asking third-party sites. Stored persistently in the database and cached in memory.
 */
export async function loadFeedIcon(feedId: number): Promise<FeedIcon | null> {
  const known = cache.get(feedId);
  if (known && Date.now() - known.fetchedAt < TTL_MS) return known.icon;

  // Check persistent storage
  const row = db.prepare<[number], { data: Buffer; mime: string; hash: string }>(
    "SELECT data, mime, hash FROM feed_icons WHERE feed_id = ?",
  ).get(feedId);
  if (row) {
    // Icons stored by older versions may still be SVG or ICO.
    let icon: FeedIcon;
    try {
      icon = row.mime === "image/svg+xml" || row.mime === "image/x-icon"
        ? storeFeedIcon(feedId, row.data, row.mime)
        : { buffer: row.data, mime: row.mime, hash: row.hash };
    } catch {
      return refreshFeedIcon(feedId);
    }
    if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!);
    cache.set(feedId, { icon, fetchedAt: Date.now() });
    return icon;
  }
  // Capacity pressure is temporary, not evidence that the publisher has no icon.
  // Do not poison the 24-hour negative cache when another refresh can try shortly.
  if (!refreshing.has(feedId) && refreshing.size >= readPollSettings().maxWaiters) return null;
  const icon = await refreshFeedIcon(feedId);
  if (!icon) {
    if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!);
    cache.set(feedId, { icon: null, fetchedAt: Date.now() });
  }
  return icon;
}

/** Forget remembered icons (tests). */
export function clearIconCache(feedId?: number): void {
  if (feedId !== undefined) {
    cache.delete(feedId);
    db.prepare("DELETE FROM feed_icons WHERE feed_id = ?").run(feedId);
  } else {
    cache.clear();
    db.prepare("DELETE FROM feed_icons").run();
  }
}
