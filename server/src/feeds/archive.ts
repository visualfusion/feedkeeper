import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { link, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { config } from "../config.js";
import { db } from "../db/index.js";
import { fetchImage } from "./fetcher.js";
import { loadFullText } from "./fullText.js";
import { canAccessItem, findItemById, findItemForUser } from "./repository.js";
import { decodeEntities } from "./text.js";
import { ImageCache, ImageCacheBusyError, type CachedImage } from "./imageCache.js";
import { detectImageType } from "./imageTypes.js";
export { detectImageType } from "./imageTypes.js";

const MAX_IMAGES_PER_ARTICLE = 30;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const FILE_NAME = /^\d+-[0-9a-f]{16}\.(jpg|png|webp|gif|avif)$/;

let imageCache: ImageCache | undefined;
let imageCacheTimer: NodeJS.Timeout | undefined;
let imageCacheStopping = false;
let imageCachePruning = false;
const archiveWrites = new Set<string>();

async function storeArchivedImage(destination: string, image: CachedImage): Promise<void> {
  const temporary = `${destination}.tmp`;
  archiveWrites.add(temporary);
  archiveWrites.add(destination);
  try {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
    if (image.path) await link(image.path, temporary).catch(() => writeFile(temporary, image.buffer, { mode: 0o600 }));
    else await writeFile(temporary, image.buffer, { mode: 0o600 });
    await rename(temporary, destination);
  } finally { archiveWrites.delete(temporary); }
}

function sharedImages(): ImageCache {
  if (!imageCache) {
    imageCache = new ImageCache(config.imageCache);
    imageCacheTimer = setInterval(() => {
      if (imageCachePruning) return;
      imageCachePruning = true;
      void imageCache!.prune().catch(() => undefined).then(() => {
        console.log(JSON.stringify({ event: "image_cache", ...imageCache!.metrics() }));
      }).finally(() => { imageCachePruning = false; });
    }, 60_000);
    imageCacheTimer.unref();
  }
  return imageCache;
}

export async function stopImageCache(): Promise<void> {
  imageCacheStopping = true;
  if (imageCacheTimer) clearInterval(imageCacheTimer);
  await imageCache?.close();
}

function sharedImage(item: { id: number; feed_id: number }, url: string): Promise<CachedImage | "unsupported"> {
  if (imageCacheStopping) return Promise.reject(new ImageCacheBusyError());
  const archived = db.prepare<[number, string], { file_name: string }>(
    "SELECT file_name FROM archived_images WHERE item_id = ? AND source_url = ?",
  ).get(item.id, url);
  // An old saved snapshot must not replace a newer article's image at the same URL.
  const scope = archived ? `${item.feed_id}:archive:${item.id}` : item.feed_id;
  return sharedImages().get(scope, url, async (signal) => {
    if (archived) {
      const path = join(archiveDir(), archived.file_name);
      try {
        const buffer = await readFile(path);
        if (buffer.length <= MAX_IMAGE_BYTES && detectImageType(buffer)) return { buffer, path };
      } catch { /* Recover a missing archived file from its source. */ }
    }
    return fetchImage(url, MAX_IMAGE_BYTES, signal);
  });
}

function archiveDir(): string {
  return resolve(config.archivePath);
}

function srcAttribute(tag: string): { value: string; start: number; end: number } | null {
  const match = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
  if (!match) return null;
  const value = match[1] ?? match[2] ?? match[3] ?? "";
  const start = match.index + match[0].indexOf(value, match[0].indexOf("="));
  return { value, start, end: start + value.length };
}

function resolveImageUrl(raw: string, baseUrl: string | null): string | null {
  try {
    const url = new URL(decodeEntities(raw.trim()), baseUrl ?? undefined);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Image URLs an article shows, in order, without tracking pixels. */
export function articleImageUrls(html: string, baseUrl: string | null): string[] {
  const urls = new Set<string>();
  for (const [tag] of html.matchAll(/<img\b[^>]*>/gi)) {
    if (/\swidth\s*=\s*["']?1["'\s>]/i.test(tag) && /\sheight\s*=\s*["']?1["'\s>]/i.test(tag)) continue;
    const src = srcAttribute(tag);
    const url = src && resolveImageUrl(src.value, baseUrl);
    if (url) urls.add(url);
  }
  return [...urls];
}

/** Replace the `src` of every image for which `replacement` knows a new address. */
function rewriteImageSources(html: string, baseUrl: string | null, replacement: (url: string) => string | undefined): string {
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = srcAttribute(tag);
    const url = src && resolveImageUrl(src.value, baseUrl);
    const next = url ? replacement(url) : undefined;
    return src && next ? `${tag.slice(0, src.start)}${next}${tag.slice(src.end)}` : tag;
  });
}

/** Point archived images in article HTML at their local copies under `origin`. */
export function rewriteArchivedImages(html: string, baseUrl: string | null, images: Map<string, number>, origin: string, apiBase = "/api"): string {
  if (images.size === 0) return html;
  return rewriteImageSources(html, baseUrl, (url) => {
    const id = images.get(url);
    return id ? archivedImageUrl(origin, id, apiBase) : undefined;
  });
}

/** Absolute, so the web app treats archived images like any other image URL. */
export function archivedImageUrl(origin: string, imageId: number, apiBase = "/api"): string {
  return `${origin.replace(/\/$/, "")}${apiBase}/archive/images/${imageId}`;
}

function hasBookmark(itemId: number): number | undefined {
  return db.prepare<[number], { user_id: number }>("SELECT user_id FROM item_bookmarks WHERE item_id = ? LIMIT 1").get(itemId)?.user_id;
}

/** Keep a saved article readable for good: fetch its full text and store its images locally. */
export async function archiveItem(itemId: number): Promise<void> {
  const userId = hasBookmark(itemId);
  if (userId === undefined) return;

  // Respects per-feed full-text settings and consent walls; falls back to the feed content.
  await loadFullText(userId, itemId).catch(() => undefined);
  const item = findItemById(itemId);
  if (!item) return;

  const html = item.full_content_html ?? item.content_html ?? "";
  const heroUrl = item.image_url ? resolveImageUrl(item.image_url, item.link) : null;
  const urls = [...new Set([...(heroUrl ? [heroUrl] : []), ...articleImageUrls(html, item.link)])].slice(0, MAX_IMAGES_PER_ARTICLE);
  const known = new Set(db.prepare<[number], { source_url: string }>("SELECT source_url FROM archived_images WHERE item_id = ?").all(itemId).map((row) => row.source_url));
  const insert = db.prepare("INSERT INTO archived_images (item_id, source_url, file_name, mime_type, byte_size) VALUES (?, ?, ?, ?, ?) ON CONFLICT (item_id, source_url) DO NOTHING");

  mkdirSync(archiveDir(), { recursive: true });
  for (const url of urls) {
    if (imageCacheStopping) return;
    if (known.has(url)) continue;
    try {
      const image = await sharedImage(item, url);
      if (image === "unsupported") continue;
      const { buffer } = image;
      const type = detectImageType(buffer);
      if (!type) continue;
      const fileName = `${itemId}-${createHash("sha256").update(url).digest("hex").slice(0, 16)}.${type.ext}`;
      const destination = join(archiveDir(), fileName);
      try {
        await storeArchivedImage(destination, image);
        // The last bookmark or article may have disappeared while the image was loading.
        if (!hasBookmark(itemId) || !findItemById(itemId)) {
          unlinkSync(destination);
          continue;
        }
        insert.run(itemId, url, fileName, type.mime, buffer.length);
      } finally {
        archiveWrites.delete(destination);
      }
    } catch (error) {
      // Leave the durable bookmark pending so startup can finish it later.
      if (error instanceof ImageCacheBusyError || imageCacheStopping) return;
      // A missing image should not stop the rest of the article from being archived.
    }
  }

  if (!imageCacheStopping) db.prepare("UPDATE items SET archived_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(itemId);
}

const queue: number[] = [];
let draining = false;

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (queue.length > 0) {
      const itemId = queue.shift()!;
      await archiveItem(itemId).catch((error) => console.warn(`[archive] item ${itemId}:`, error));
    }
  } finally {
    draining = false;
  }
}

/** Archive in the background, one article at a time, so saving stays instant. */
export function scheduleArchive(itemId: number): void {
  if (!queue.includes(itemId)) queue.push(itemId);
  void drain();
}

/** Catch up on saved articles that were never archived, e.g. saved before this feature. */
export function scheduleMissingArchives(): number {
  const rows = db.prepare<[], { id: number }>(
    "SELECT DISTINCT i.id FROM items i JOIN item_bookmarks b ON b.item_id = i.id WHERE i.archived_at IS NULL ORDER BY i.id",
  ).all();
  rows.forEach((row) => scheduleArchive(row.id));
  return rows.length;
}

/** Wait until queued archiving is done (used by tests and shutdown). */
export async function archiveIdle(): Promise<void> {
  while (draining || queue.length > 0) await new Promise((resolve) => setTimeout(resolve, 20));
}

/** Delete archived images of articles nobody has saved anymore, plus stray files. */
export function pruneArchive(): number {
  const stale = db.prepare<[], { id: number; item_id: number; file_name: string }>(
    "SELECT a.id, a.item_id, a.file_name FROM archived_images a WHERE NOT EXISTS (SELECT 1 FROM item_bookmarks b WHERE b.item_id = a.item_id)",
  ).all();
  db.transaction(() => {
    for (const row of stale) {
      db.prepare("DELETE FROM archived_images WHERE id = ?").run(row.id);
      db.prepare("UPDATE items SET archived_at = NULL WHERE id = ?").run(row.item_id);
    }
    db.prepare("UPDATE items SET archived_at = NULL WHERE archived_at IS NOT NULL AND id NOT IN (SELECT item_id FROM item_bookmarks)").run();
  })();

  let removed = 0;
  let files: string[];
  try {
    files = readdirSync(archiveDir());
  } catch {
    return 0;
  }
  const kept = new Set(db.prepare<[], { file_name: string }>("SELECT file_name FROM archived_images").all().map((row) => row.file_name));
  for (const file of files) {
    if (file.endsWith(".tmp") && FILE_NAME.test(file.slice(0, -4)) && !archiveWrites.has(join(archiveDir(), file))) {
      try { unlinkSync(join(archiveDir(), file)); removed++; } catch { /* Already gone. */ }
      continue;
    }
    if (!FILE_NAME.test(file) || kept.has(file)) continue;
    try {
      unlinkSync(join(archiveDir(), file));
      removed++;
    } catch {
      // Already gone.
    }
  }
  return removed;
}

/** Local copies for the given items, keyed by original URL. */
export function archivedImagesFor(itemIds: number[]): Map<number, Map<string, number>> {
  const result = new Map<number, Map<string, number>>();
  if (itemIds.length === 0) return result;
  const rows = db.prepare(`SELECT id, item_id, source_url FROM archived_images WHERE item_id IN (${itemIds.map(() => "?").join(",")})`).all(...itemIds) as { id: number; item_id: number; source_url: string }[];
  for (const row of rows) {
    if (!result.has(row.item_id)) result.set(row.item_id, new Map());
    result.get(row.item_id)!.set(row.source_url, row.id);
  }
  return result;
}

/** An archived image the user may see (they subscribe to or saved its article). */
export function findArchivedImage(userId: number, imageId: number): { path: string; mime: string } | null {
  const row = db.prepare<[number], { item_id: number; file_name: string; mime_type: string }>("SELECT item_id, file_name, mime_type FROM archived_images WHERE id = ?").get(imageId);
  if (!row || !canAccessItem(userId, row.item_id)) return null;
  return { path: join(archiveDir(), row.file_name), mime: row.mime_type };
}

/** Swap image URLs of archived articles for their local copies before sending them to the browser. */
export function withArchivedImages<T extends { id: number; link: string | null; image_url?: string | null; content_html?: string | null; full_content_html?: string | null }>(items: T[], origin: string, apiBase = "/api", withContent = true): T[] {
  const archived = archivedImagesFor(items.map((item) => item.id));
  return items.map((item) => {
    const images = archived.get(item.id);
    if (!images) return item;
    const hero = item.image_url ? resolveImageUrl(item.image_url, item.link) : null;
    return {
      ...item,
      image_url: hero && images.has(hero) ? archivedImageUrl(origin, images.get(hero)!, apiBase) : item.image_url,
      content_html: withContent && item.content_html ? rewriteArchivedImages(item.content_html, item.link, images, origin, apiBase) : item.content_html,
      full_content_html: withContent && item.full_content_html ? rewriteArchivedImages(item.full_content_html, item.link, images, origin, apiBase) : item.full_content_html,
    };
  });
}


type ImageSource = { link: string | null; image_url?: string | null; content_html?: string | null; full_content_html?: string | null };

/** Every image address an article shows: the lead image first, then those in the text. */
export function itemImageUrls(item: ImageSource): string[] {
  const hero = item.image_url ? resolveImageUrl(item.image_url, item.link) : null;
  return [...new Set([...(hero ? [hero] : []), ...articleImageUrls(item.full_content_html ?? "", item.link), ...articleImageUrls(item.content_html ?? "", item.link)])];
}

function proxiedImageUrl(origin: string, itemId: number, imageUrl: string, apiBase = "/api"): string {
  return `${origin.replace(/\/$/, "")}${apiBase}/items/${itemId}/image?src=${encodeURIComponent(imageUrl).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)}&v=2`;
}

/**
 * For offline copies: point the first images of articles that are not archived at an endpoint
 * of this server, so the browser can store them without cross-origin requests.
 */
export function withProxiedImages<T extends ImageSource & { id: number }>(items: T[], origin: string, apiBase = "/api", withContent = true): T[] {
  const own = `${origin.replace(/\/$/, "")}/api/`;
  return items.map((item) => {
    const urls = new Set(itemImageUrls(item).filter((url) => !url.startsWith(own)));
    if (urls.size === 0) return item;
    const replace = (url: string) => (urls.has(url) ? proxiedImageUrl(origin, item.id, url, apiBase) : undefined);
    const hero = item.image_url ? resolveImageUrl(item.image_url, item.link) : null;
    return {
      ...item,
      image_url: hero && urls.has(hero) ? proxiedImageUrl(origin, item.id, hero, apiBase) : item.image_url,
      content_html: withContent && item.content_html ? rewriteImageSources(item.content_html, item.link, replace) : item.content_html,
      full_content_html: withContent && item.full_content_html ? rewriteImageSources(item.full_content_html, item.link, replace) : item.full_content_html,
    };
  });
}

/** Download one of an article's own images for the offline copy, or null when it is not one of them. */
export async function fetchItemImage(userId: number, itemId: number, imageUrl: string): Promise<CachedImage | "forbidden" | "unsupported"> {
  const item = findItemForUser(userId, itemId);
  if (!item) return "forbidden";
  const isMatch = (it: typeof item) => {
    const hero = it.image_url ? resolveImageUrl(it.image_url, it.link) : null;
    return hero === imageUrl || itemImageUrls(it).includes(imageUrl);
  };
  if (!isMatch(item)) return "forbidden";
  const image = await sharedImage(item, imageUrl);
  // Access or the article's image list can change while a shared download is running.
  const current = findItemForUser(userId, itemId);
  if (!current || !isMatch(current)) return "forbidden";
  return image;
}
