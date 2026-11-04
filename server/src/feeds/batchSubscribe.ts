import { config } from "../config.js";
import { db } from "../db/index.js";
import { assertPublicFeedUrl, blockedUrlBody } from "./blockedHosts.js";
import { requestFeedPoll } from "./poller.js";
import { createFeed, createFolder, findFeedByUrl, isUserSubscribed, subscribe, type Feed } from "./repository.js";
import { SsrfBlockedError, normalizeUrlCandidate } from "./ssrfGuard.js";

/** Most feeds one request may carry; clients send longer lists in several requests. */
export const MAX_SUBSCRIPTION_BATCH = 200;

const MAX_FOLDER_NAME_LENGTH = 100;
const MAX_LABEL_LENGTH = 200;
/** Address checks resolve names, so they run a few at a time instead of one after the other. */
const CHECK_CONCURRENCY = 8;

export interface BatchSubscriptionItem {
  url: string;
  label?: string | null;
  /** The name of a folder: an existing one is used, otherwise it is created. */
  folder?: string | null;
}

export type BatchSubscriptionStatus = "added" | "exists" | "invalid";

export interface BatchSubscriptionResult {
  /** The address as it was sent, so a client can match results to its own list. */
  url: string;
  status: BatchSubscriptionStatus;
  /** The subscription's id (the id of its feed), for `added` and `exists`. */
  subscriptionId?: number;
  /** Why an address was refused: `invalid_url`, a blocked-address code or `url_validation_failed`. */
  reason?: string;
}

async function checkAddress(raw: string): Promise<{ url: string } | { reason: string }> {
  let candidate: string;
  try {
    candidate = new URL(normalizeUrlCandidate(raw)).toString();
  } catch {
    return { reason: "invalid_url" };
  }
  try {
    return { url: (await assertPublicFeedUrl(candidate)).toString() };
  } catch (error) {
    return { reason: error instanceof SsrfBlockedError ? blockedUrlBody(error).error : "url_validation_failed" };
  }
}

async function checkAll(items: BatchSubscriptionItem[]): Promise<Array<{ url: string } | { reason: string }>> {
  const checked: Array<{ url: string } | { reason: string }> = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(CHECK_CONCURRENCY, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      checked[index] = await checkAddress(items[index].url);
    }
  }));
  return checked;
}

/**
 * Subscribes to many feeds in one go. Addresses are checked like a single subscription, but a feed is not read first: it is stored and
 * its first fetch joins the durable poll queue, so the answer comes in seconds, whatever the sources do, and the work goes on if the
 * client goes away. A feed that cannot be read shows its error on the subscription like any other failing feed and is retried on the
 * usual schedule. Sending the same list again changes nothing (`exists`).
 */
export async function subscribeBatch(userId: number, items: BatchSubscriptionItem[]): Promise<BatchSubscriptionResult[]> {
  const checked = await checkAll(items);
  const created: Feed[] = [];
  const results = db.transaction(() => {
    const folders = new Map<string, number>();
    return items.map((item, index): BatchSubscriptionResult => {
      const check = checked[index];
      if ("reason" in check) return { url: item.url, status: "invalid", reason: check.reason };
      let feed = findFeedByUrl(check.url);
      const isNew = !feed;
      feed ??= createFeed(check.url, Math.max(config.minPollIntervalMinutes, 15));
      if (isUserSubscribed(userId, feed.id)) return { url: item.url, status: "exists", subscriptionId: feed.id };
      const folderName = item.folder?.trim().slice(0, MAX_FOLDER_NAME_LENGTH);
      let folderId: number | null = null;
      if (folderName) {
        folderId = folders.get(folderName) ?? createFolder(userId, folderName).id;
        folders.set(folderName, folderId);
      }
      subscribe(userId, feed.id, item.label?.trim().slice(0, MAX_LABEL_LENGTH) || null, folderId);
      // A feed that other accounts already read is up to date; only a new one needs its first fetch.
      if (isNew || !feed.last_success_at) created.push(feed);
      return { url: item.url, status: "added", subscriptionId: feed.id };
    });
  })();
  for (const feed of created) requestFeedPoll(feed);
  return results;
}

export interface FetchStatus {
  /** How many of the asked-for subscriptions belong to the account. */
  total: number;
  /** Read at least once. */
  loaded: number;
  /** Not read yet and the last attempt failed; the usual schedule retries them. */
  failed: number;
  /** Not read yet and no attempt has failed so far. */
  waiting: number;
}

/** How far the first fetch of the given subscriptions (feed ids) has come, as counts, so a client can show progress cheaply. */
export function fetchStatusFor(userId: number, ids: number[]): FetchStatus {
  const status: FetchStatus = { total: 0, loaded: 0, failed: 0, waiting: 0 };
  if (ids.length === 0) return status;
  const rows = db.prepare<unknown[], { last_success_at: string | null; last_error: string | null }>(
    `SELECT f.last_success_at, f.last_error FROM subscriptions s JOIN feeds f ON f.id = s.feed_id
     WHERE s.user_id = ? AND s.feed_id IN (${ids.map(() => "?").join(",")})`,
  ).all(userId, ...ids);
  for (const row of rows) {
    status.total++;
    if (row.last_success_at) status.loaded++;
    else if (row.last_error) status.failed++;
    else status.waiting++;
  }
  return status;
}
