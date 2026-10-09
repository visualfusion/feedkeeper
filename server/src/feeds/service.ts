import { config } from "../config.js";
import {
  createFeed,
  findFeedByUrl,
  isUserSubscribed,
  subscribe,
  unsubscribe as unsubscribeRepo,
  listSubscriptionsForUser,
  updateSubscriptionLabel,
  updateSubscriptionFolder,
  updateFeedPollInterval,
  updateSubscriptionFullTextMode,
  updateSubscriptionNotify,
  updateSubscriptionBadge,
  findFolderById,
  findFeedById,
  countFeedSubscribers,
  replaceFeedUrl,
  moveSubscription,
  type FullTextMode,
  type SubscribedFeed,
} from "./repository.js";
import { pollFeed, probeFeed } from "./poller.js";
import { assertPublicHttpUrl } from "./ssrfGuard.js";

import { discoverFeeds } from "./discovery.js";

export class FeedError extends Error {}
export class NoFeedsFoundError extends FeedError {
  constructor() {
    super("no_feeds_found");
    this.name = "NoFeedsFoundError";
  }
}
export class MultipleFeedsFoundError extends FeedError {
  constructor(public feeds: Array<{ url: string; title: string | null; type: string }>) {
    super("multiple_feeds_found");
    this.name = "MultipleFeedsFoundError";
  }
}

/** Turn a feed or website URL into a feed URL, using auto-discovery for website addresses. */
async function resolveFeedUrl(inputUrl: string): Promise<{ url: string }> {
  const validated = await assertPublicHttpUrl(inputUrl.trim());
  const targetUrl = validated.toString();
  // A known shared feed needs no second discovery download beside its queued poll.
  if (findFeedByUrl(targetUrl)) return { url: targetUrl };

  try {
    const discovered = await discoverFeeds(targetUrl);
    if (discovered.length === 1) return { url: discovered[0].url };
    if (discovered.length > 1) {
      const exact = discovered.find((d) => d.url === targetUrl);
      if (exact) return { url: exact.url };
      throw new MultipleFeedsFoundError(discovered);
    }
  } catch (err) {
    if (err instanceof FeedError) throw err;
    // Otherwise fall back to trying the given URL directly
  }
  return { url: targetUrl };
}

export async function subscribeToFeed(
  userId: number,
  inputUrl: string,
  label: string | null = null,
  folderId: number | null = null,
): Promise<SubscribedFeed> {
  if (folderId !== null && !findFolderById(userId, folderId)) {
    throw new FeedError("folder_not_found");
  }
  const { url: targetUrl } = await resolveFeedUrl(inputUrl);

  let feed = findFeedByUrl(targetUrl);
  if (!feed) {
    feed = createFeed(targetUrl, Math.max(config.minPollIntervalMinutes, 15));
  }

  if (isUserSubscribed(userId, feed.id)) {
    throw new FeedError("already_subscribed");
  }

  subscribe(userId, feed.id, label, folderId);

  // Fetch immediately so the user sees items right away instead of waiting
  // for the next scheduler tick.
  const pollResult = await pollFeed(feed);

  // A feed that has never been read successfully and fails right away is not a feed
  // (e.g. a homepage that announces itself as RSS); don't keep the subscription.
  if (pollResult.error && !pollResult.deferred && !findFeedById(feed.id)?.last_success_at) {
    unsubscribeRepo(userId, feed.id);
    throw new NoFeedsFoundError();
  }

  const subscription = listSubscriptionsForUser(userId).find((s) => s.id === feed!.id);
  if (!subscription) throw new FeedError("subscription_lookup_failed");
  return subscription;
}

export function unsubscribeFromFeed(userId: number, feedId: number): void {
  if (!isUserSubscribed(userId, feedId)) {
    throw new FeedError("not_subscribed");
  }
  const feed = findFeedById(feedId);
  if (feed?.is_system_inbox) {
    throw new FeedError("cannot_unsubscribe_inbox");
  }
  unsubscribeRepo(userId, feedId);
}

export function updateFeedSettings(
  userId: number,
  feedId: number,
  settings: { label?: string | null; folderId?: number | null; pollIntervalMinutes?: number; fullTextMode?: FullTextMode; notify?: boolean; badge?: boolean },
): SubscribedFeed {
  if (!isUserSubscribed(userId, feedId)) {
    throw new FeedError("not_subscribed");
  }

  if (settings.folderId != null && !findFolderById(userId, settings.folderId)) {
    throw new FeedError("folder_not_found");
  }

  if (settings.label !== undefined) {
    updateSubscriptionLabel(userId, feedId, settings.label);
  }

  if (settings.folderId !== undefined) {
    updateSubscriptionFolder(userId, feedId, settings.folderId);
  }

  if (settings.fullTextMode !== undefined) {
    updateSubscriptionFullTextMode(userId, feedId, settings.fullTextMode);
  }

  if (settings.notify !== undefined) {
    updateSubscriptionNotify(userId, feedId, settings.notify);
  }

  if (settings.badge !== undefined) {
    updateSubscriptionBadge(userId, feedId, settings.badge);
  }

  if (settings.pollIntervalMinutes !== undefined) {
    // The poll interval is stored per feed (shared across every subscriber),
    // so it's floored account-wide rather than trusting each caller's input.
    const minutes = Math.max(settings.pollIntervalMinutes, config.minPollIntervalMinutes);
    updateFeedPollInterval(feedId, minutes);
  }

  const subscription = listSubscriptionsForUser(userId).find((s) => s.id === feedId);
  if (!subscription) throw new FeedError("subscription_lookup_failed");
  return subscription;
}

/**
 * Switch a subscription to a new feed URL, e.g. after a site moved its feed. The new URL is
 * fetched and parsed first, so a broken address never replaces a working one. When the user
 * is the only subscriber, the feed is updated in place and keeps its items, read state and
 * bookmarks; otherwise the subscription moves to a separate feed for the new URL.
 */
export async function changeFeedUrl(
  userId: number,
  feedId: number,
  inputUrl: string,
): Promise<{ subscription: SubscribedFeed; previousItemsKept: boolean }> {
  const current = findFeedById(feedId);
  if (!current || !isUserSubscribed(userId, feedId)) throw new FeedError("not_subscribed");

  const { url } = await resolveFeedUrl(inputUrl);
  let target = feedId;
  const lookup = () => {
    const subscription = listSubscriptionsForUser(userId).find((s) => s.id === target);
    if (!subscription) throw new FeedError("subscription_lookup_failed");
    return subscription;
  };
  if (url === current.url) return { subscription: lookup(), previousItemsKept: true };

  const existing = findFeedByUrl(url);
  if (existing && isUserSubscribed(userId, existing.id)) throw new FeedError("already_subscribed");

  try {
    await probeFeed(url);
  } catch (error) {
    throw new FeedError(`feed_unreachable: ${error instanceof Error ? error.message : String(error)}`);
  }

  let previousItemsKept: boolean;
  if (!existing && countFeedSubscribers(feedId) === 1) {
    replaceFeedUrl(feedId, url);
    previousItemsKept = true;
  } else {
    const next = existing ?? createFeed(url, current.poll_interval_minutes);
    moveSubscription(userId, feedId, next.id);
    target = next.id;
    previousItemsKept = false;
  }

  const feed = findFeedById(target);
  if (feed) await pollFeed(feed);
  return { subscription: lookup(), previousItemsKept };
}
