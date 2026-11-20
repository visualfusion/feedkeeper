import type { Server } from "node:http";
import { fetchFeed } from "./fetcher.js";
import { discoverIconUrls, iconCheckDue } from "./icon.js";
import { refreshFeedIcon } from "./feedIcon.js";
import { enqueueNewItemNotifications, startPushOutbox, stopPushOutbox } from "../pushOutbox.js";
import { hasUserCapability } from "../auth/capabilities.js";
import { findFeedById, listSubscriberIds, updateFeedAfterPoll, updateFeedIcon, upsertItems, type Feed } from "./repository.js";
import { db } from "../db/index.js";
import { configurePollHostCooldowns, PollQueue, type PollResult } from "./pollQueue.js";
import { feedRequests, PollDeferredError, sourceHost } from "./requestGate.js";
import { readPollSettings } from "./pollSettings.js";
import { formatFeedAuthor, itemGuid, itemLink, parseFeedBody, resolveFeedIconUrls, type ParsedFeed } from "./feedParser.js";

export { itemGuid, itemLink };

configurePollHostCooldowns();

/**
 * Checks the feed's icon when it is due. The check starts right away but is not awaited, has its own deadline, and cannot retry or
 * fail a committed feed; downloads join the shared request limit as background work.
 */
function scheduleIconMaintenance(feed: Feed, parsed: ParsedFeed | null): void {
  if (!iconCheckDue(feed.icon_checked_at)) return;
  updateFeedIcon(feed.id, feed.icon_url);
  const signal = AbortSignal.timeout(readPollSettings().attemptTimeoutMs);
  const task = (async () => {
    try {
      const siteUrl = parsed?.link || feed.site_url;
      const htmlUrls = siteUrl ? await discoverIconUrls(siteUrl, signal) : [];
      const feedUrls = parsed ? resolveFeedIconUrls(parsed, siteUrl || feed.url) : { icons: [], logos: [] };
      signal.throwIfAborted();
      await refreshFeedIcon(feed.id, siteUrl, [...htmlUrls, ...feedUrls.icons], signal, feedUrls.logos);
    } catch { /* Keep the successful poll; icon failures are best effort. */ }
  })();
  iconChecks.add(task);
  void task.finally(() => iconChecks.delete(task));
}

const iconChecks = new Set<Promise<void>>();

/** Resolves once the icon checks started so far are done; used by shutdown and by tests that look at the stored icon. */
export async function settleIconChecks(): Promise<void> {
  while (iconChecks.size) await Promise.allSettled([...iconChecks]);
}

/** One attempt; the queue owns retries, admission, single-flight and the total deadline. */
async function pollAttempt(feed: Feed, signal: AbortSignal, interactive: boolean): Promise<PollResult> {
  const fetched = await fetchFeed(feed.url, {
    etag: feed.etag ?? undefined,
    lastModified: feed.last_modified ?? undefined,
    signal,
    priority: interactive ? "interactive" : "background",
  });
  const parsed = fetched.notModified ? null : await parseFeedBody(fetched.body);
  signal.throwIfAborted();
  const current = findFeedById(feed.id);
  if (!current || current.url !== feed.url) throw new PollDeferredError(Date.now(), current ? sourceHost(current.url) : sourceHost(feed.url));
  // Recheck hosted capabilities after network I/O, before committing or sending notifications.
  if (!feedHasActiveSubscriber(feed.id)) return { newItems: 0, error: "feed_poll_not_allowed" };
  const items = parsed?.items.map(item => ({
    guid: item.guid,
    title: item.title,
    link: item.link,
    contentSnippet: item.contentSnippet,
    contentHtml: item.contentHtml,
    publishedAt: item.publishedAt,
    imageUrl: item.imageUrl,
    author: formatFeedAuthor(item.authors, current.title, current.site_url ?? current.url),
  }));
  // No await in this transaction. Items, health/validators and job completion become visible together.
  const newItems = db.transaction(() => {
    const count = items ? upsertItems(feed.id, items) : 0;
    updateFeedAfterPoll(feed.id, {
      ...(parsed ? { title: parsed.title, siteUrl: parsed.link, etag: fetched.etag, lastModified: fetched.lastModified } : {}),
      error: null,
    });
    if (count > 0 && feed.last_success_at) enqueueNewItemNotifications(feed.id, count);
    db.prepare("DELETE FROM feed_poll_jobs WHERE feed_id = ?").run(feed.id);
    return count;
  })();
  // Push is committed above and dispatched independently of the feed deadline.
  startPushOutbox();
  // Icon upkeep is best effort. It runs after this result is returned: the poll slot is free again, and a new subscription that is
  // waiting for the first fetch is answered as soon as the feed is stored, not after the publisher's home page and icons.
  scheduleIconMaintenance(feed, parsed);
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
  const fetched = await fetchFeed(url, { priority: "interactive" });
  const parsed = await parseFeedBody(fetched.body);
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
  const { stopImageCache } = await import("./archive.js");
  const { stopFullTextScheduler } = await import("./fullTextQueue.js");
  await stopFullTextScheduler();
  await stopImageCache();
  await Promise.all([queue?.stop(), stopPushOutbox()]);
  feedRequests.stop();
  // Waiting icon downloads were just turned away; the ones in flight end with their own deadline.
  await settleIconChecks();
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
