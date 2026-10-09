import Parser from "rss-parser";
import type { Server } from "node:http";
import { fetchFeed } from "./fetcher.js";
import { discoverIconUrls, iconCheckDue } from "./icon.js";
import { refreshFeedIcon } from "./feedIcon.js";
import { decodeEntities, plainTitle } from "./text.js";
import { enqueueNewItemNotifications, startPushOutbox, stopPushOutbox } from "../pushOutbox.js";
import { hasUserCapability } from "../auth/capabilities.js";
import { findFeedById, listSubscriberIds, updateFeedAfterPoll, updateFeedIcon, upsertItems, type Feed } from "./repository.js";
import { db } from "../db/index.js";
import { configurePollHostCooldowns, PollQueue, type PollResult } from "./pollQueue.js";
import { feedRequests, PollDeferredError, sourceHost } from "./requestGate.js";

configurePollHostCooldowns();

type CustomItem = Parser.Item & {
  mediaContent?: unknown;
  mediaThumbnail?: unknown;
  contentEncoded?: string;
  "media:content"?: unknown;
  "media:thumbnail"?: unknown;
  "content:encoded"?: string;
};

function mediaAttribute(value: unknown, key: "url" | "medium" | "type"): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const attributes = record.$;
  if (typeof attributes === "object" && attributes !== null) {
    const nested = (attributes as Record<string, unknown>)[key];
    if (nested !== undefined) return nested;
  }
  return record[key];
}

const parser = new Parser<Record<string, unknown>, CustomItem>({
  customFields: {
    item: [
      ["media:content", "mediaContent", { keepArray: false }],
      ["media:thumbnail", "mediaThumbnail", { keepArray: false }],
      ["content:encoded", "contentEncoded", { keepArray: false }],
    ],
  },
});

function cleanImageUrl(url: string): string {
  return url.trim().replace(/&#038;/g, "&").replace(/&amp;/g, "&");
}

function isValidImageUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  const trimmed = url.trim();
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) return false;
  if (trimmed.includes("/1x1") || trimmed.includes("pixel.wp.com") || trimmed.includes("tracking") || trimmed.includes("beacon")) {
    if (trimmed.includes("pixel") || trimmed.includes("1x1")) return false;
  }
  return true;
}

function extractImageUrl(item: CustomItem): string | null {
  // 1. media:content (Media RSS)
  const mediaContent = item.mediaContent ?? item["media:content"];
  if (mediaContent) {
    if (isValidImageUrl(mediaContent)) return cleanImageUrl(mediaContent);
    const url = mediaAttribute(mediaContent, "url");
    const medium = mediaAttribute(mediaContent, "medium");
    const type = mediaAttribute(mediaContent, "type");
    if (isValidImageUrl(url) && (medium === "image" || !medium || (typeof type === "string" && type.startsWith("image/")))) {
      return cleanImageUrl(url);
    }
  }

  // 2. media:thumbnail
  const mediaThumbnail = item.mediaThumbnail ?? item["media:thumbnail"];
  if (mediaThumbnail) {
    if (isValidImageUrl(mediaThumbnail)) return cleanImageUrl(mediaThumbnail);
    const url = mediaAttribute(mediaThumbnail, "url");
    if (isValidImageUrl(url)) return cleanImageUrl(url);
  }

  // 3. enclosure
  if (item.enclosure?.url) {
    const url = item.enclosure.url;
    const type = item.enclosure.type ?? "";
    if (type.startsWith("image/") || /\.(jpe?g|png|webp|gif|avif|svg)(\?.*)?$/i.test(url)) {
      if (isValidImageUrl(url)) return cleanImageUrl(url);
    }
  }

  // 4. First <img> tag in HTML content or summary
  const htmlContent = item.contentEncoded ?? item["content:encoded"] ?? item.content ?? item.summary ?? "";
  if (typeof htmlContent === "string" && htmlContent.includes("<img")) {
    const match = htmlContent.match(/<img[^>]+src=["'](https?:\/\/[^"'\s>]+)["']/i);
    if (match && isValidImageUrl(match[1])) {
      return cleanImageUrl(match[1]);
    }
  }

  return null;
}

/** One attempt; the queue owns retries, admission, single-flight and the total deadline. */
async function pollAttempt(feed: Feed, signal: AbortSignal): Promise<PollResult> {
  const fetched = await fetchFeed(feed.url, { etag: feed.etag ?? undefined, lastModified: feed.last_modified ?? undefined, signal });
  const parsed = fetched.notModified ? null : await parser.parseString(fetched.body);
  signal.throwIfAborted();
  const current = findFeedById(feed.id);
  if (!current || current.url !== feed.url) throw new PollDeferredError(Date.now(), current ? sourceHost(current.url) : sourceHost(feed.url));
  // Recheck hosted capabilities after network I/O, before committing or sending notifications.
  if (!feedHasActiveSubscriber(feed.id)) return { newItems: 0, error: "feed_poll_not_allowed" };
  const items = parsed?.items.map(item => ({
    guid: item.guid ?? item.link ?? item.title ?? crypto.randomUUID(),
    title: plainTitle(item.title), link: item.link,
    contentSnippet: decodeEntities(item.contentSnippet ?? item.content) ?? undefined,
    contentHtml: item.contentEncoded ?? item["content:encoded"] ?? item.content ?? null,
    publishedAt: item.isoDate ?? item.pubDate, imageUrl: extractImageUrl(item),
  }));
  // No await in this transaction. Items, health/validators and job completion become visible together.
  const newItems = db.transaction(() => {
    const count = items ? upsertItems(feed.id, items) : 0;
    updateFeedAfterPoll(feed.id, {
      ...(parsed ? { title: plainTitle(parsed.title), siteUrl: parsed.link, etag: fetched.etag, lastModified: fetched.lastModified } : {}),
      error: null,
    });
    if (count > 0 && feed.last_success_at) enqueueNewItemNotifications(feed.id, count);
    db.prepare("DELETE FROM feed_poll_jobs WHERE feed_id = ?").run(feed.id);
    return count;
  })();
  // Push is committed above and dispatched independently of the feed deadline.
  startPushOutbox();
  // Bounded icon maintenance cannot retry a committed feed.
  try {
    signal.throwIfAborted();
    if (iconCheckDue(feed.icon_checked_at)) {
      const siteUrl = parsed?.link || feed.site_url;
      const urls = siteUrl ? await discoverIconUrls(siteUrl, signal) : [];
      signal.throwIfAborted();
      updateFeedIcon(feed.id, feed.icon_url);
      await refreshFeedIcon(feed.id, siteUrl, urls, signal);
    }
  } catch { /* Keep the successful poll; icon failures are best effort. */ }
  return { newItems, error: null };
}

let queue: PollQueue | undefined;
function pollingQueue(): PollQueue {
  queue ??= new PollQueue(pollAttempt, feedHasActiveSubscriber);
  queue.start();
  startPushOutbox();
  return queue;
}

/** Concurrent triggers share the same attempt result. Deferred work survives the HTTP caller. */
export function pollFeed(feed: Feed): Promise<PollResult> { return pollingQueue().submit(feed); }

/** Bounded consumers for explicit refresh-all. Each feed still uses the shared durable queue. */
export async function pollFeeds(feeds: Feed[]): Promise<{ newItems: number; errors: number; deferred: number }> {
  let cursor = 0;
  let newItems = 0;
  let errors = 0;
  let deferred = 0;
  await Promise.all(Array.from({ length: Math.min(pollingQueue().settings.concurrency, feeds.length) }, async () => {
    while (cursor < feeds.length) {
      const result = await pollFeed(feeds[cursor++]);
      newItems += result.newItems;
      if (result.error) errors++;
      if (result.deferred) deferred++;
    }
  }));
  return { newItems, errors, deferred };
}

/** Bulk imports need no suspended JavaScript task per subscription. */
export function requestFeedPoll(feed: Feed): void {
  const queue = pollingQueue();
  queue.enqueue(feed);
  queue.kick();
}

export function pollingMetrics() { return pollingQueue().metrics(); }

/** Fetch and parse a feed without storing anything, to validate a URL before switching to it. */
export async function probeFeed(url: string): Promise<{ title: string | null; itemCount: number }> {
  const fetched = await fetchFeed(url);
  const parsed = await parser.parseString(fetched.body);
  return { title: parsed.title ?? null, itemCount: parsed.items.length };
}

/**
 * Whether anyone who subscribes to the feed may have it updated. An account whose plan does not include syncing (a hosted
 * service after the trial) gets no updates, and a feed that only such accounts subscribe to is not fetched at all.
 */
export function feedHasActiveSubscriber(feedId: number): boolean {
  return listSubscriberIds(feedId).some((userId) => hasUserCapability(userId, "sync"));
}

/** Schedules due work, returning after bounded-page admission rather than a network round. */
export function pollDueFeeds(): Promise<void> { return pollingQueue().seedDue(); }

let scheduler: NodeJS.Timeout | undefined;
export function startPollingScheduler(): void {
  if (scheduler) return;
  const tick = () => { void pollDueFeeds().catch(() => console.error(JSON.stringify({ event: "feed_poll_seed_error" }))); };
  tick();
  scheduler = setInterval(tick, 60_000);
  scheduler.unref();
}

export async function stopPollingScheduler(): Promise<void> {
  if (scheduler) clearInterval(scheduler);
  scheduler = undefined;
  await Promise.all([queue?.stop(), stopPushOutbox()]);
  feedRequests.stop();
}

/** Graceful shutdown for server integrations; process-manager grace should be >= 45 seconds. */
export function installPollingShutdown(server: Server): void {
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    console.log(JSON.stringify({ event: "feed_poll_shutdown" }));
    const deadline = setTimeout(() => process.exit(1), 40_000);
    deadline.unref();
    const drained = new Promise<void>(resolve => server.close(() => resolve()));
    void Promise.all([stopPollingScheduler(), drained]).then(() => {
      server.closeAllConnections();
      process.exit(0);
    }, () => process.exit(1));
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
