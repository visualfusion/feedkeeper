import { config } from "../config.js";
import {
  createFeed,
  findFeedByUrl,
  isUserSubscribed,
  subscribe,
  unsubscribe as unsubscribeRepo,
  listSubscriptionsForUser,
  updateSubscriptionLabel,
  updateFeedPollInterval,
  type SubscribedFeed,
} from "./repository.js";
import { pollFeed } from "./poller.js";
import { assertPublicHttpUrl } from "./ssrfGuard.js";

export class FeedError extends Error {}

export async function subscribeToFeed(
  userId: number,
  url: string,
  label: string | null,
): Promise<SubscribedFeed> {
  const validated = await assertPublicHttpUrl(url);
  const normalizedUrl = validated.toString();

  let feed = findFeedByUrl(normalizedUrl);
  if (!feed) {
    feed = createFeed(normalizedUrl, Math.max(config.minPollIntervalMinutes, 15));
  }

  if (isUserSubscribed(userId, feed.id)) {
    throw new FeedError("already_subscribed");
  }

  subscribe(userId, feed.id, label);

  // Fetch immediately so the user sees items right away instead of waiting
  // for the next scheduler tick.
  await pollFeed(feed);

  const subscription = listSubscriptionsForUser(userId).find((s) => s.id === feed!.id);
  if (!subscription) throw new FeedError("subscription_lookup_failed");
  return subscription;
}

export function unsubscribeFromFeed(userId: number, feedId: number): void {
  if (!isUserSubscribed(userId, feedId)) {
    throw new FeedError("not_subscribed");
  }
  unsubscribeRepo(userId, feedId);
}

export function updateFeedSettings(
  userId: number,
  feedId: number,
  settings: { label?: string | null; pollIntervalMinutes?: number },
): SubscribedFeed {
  if (!isUserSubscribed(userId, feedId)) {
    throw new FeedError("not_subscribed");
  }

  if (settings.label !== undefined) {
    updateSubscriptionLabel(userId, feedId, settings.label);
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
