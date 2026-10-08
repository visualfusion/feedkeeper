import Parser from "rss-parser";
import cron from "node-cron";
import { fetchFeed } from "./fetcher.js";
import { discoverIconUrls, iconCheckDue } from "./icon.js";
import { refreshFeedIcon } from "./feedIcon.js";
import { decodeEntities, plainTitle } from "./text.js";
import { notifyNewItems } from "../push.js";
import { hasUserCapability } from "../auth/capabilities.js";
import { listFeedsDueForPoll, listSubscriberIds, updateFeedAfterPoll, updateFeedIcon, upsertItems, type Feed } from "./repository.js";

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

export async function pollFeed(feed: Feed): Promise<{ newItems: number; error: string | null }> {
  try {
    const refreshIconIfDue = async (siteUrl: string | null) => {
      if (!iconCheckDue(feed.icon_checked_at)) return;
      const iconUrls = siteUrl ? await discoverIconUrls(siteUrl) : [];
      updateFeedIcon(feed.id, feed.icon_url);
      await refreshFeedIcon(feed.id, siteUrl, iconUrls);
    };
    const fetched = await fetchFeed(feed.url, {
      etag: feed.etag ?? undefined,
      lastModified: feed.last_modified ?? undefined,
    });

    if (fetched.notModified) {
      await refreshIconIfDue(feed.site_url);
      updateFeedAfterPoll(feed.id, { error: null });
      return { newItems: 0, error: null };
    }

    const parsed = await parser.parseString(fetched.body);

    const items = parsed.items.map((item) => ({
      guid: item.guid ?? item.link ?? item.title ?? crypto.randomUUID(),
      title: plainTitle(item.title),
      link: item.link,
      contentSnippet: decodeEntities(item.contentSnippet ?? item.content) ?? undefined,
      contentHtml: item.contentEncoded ?? item["content:encoded"] ?? item.content ?? null,
      publishedAt: item.isoDate ?? item.pubDate,
      imageUrl: extractImageUrl(item),
    }));

    const newItems = upsertItems(feed.id, items);
    // A feed's first fetch brings in its whole backlog; only later arrivals are news.
    if (newItems > 0 && feed.last_success_at) void notifyNewItems(feed, newItems).catch(() => undefined);

    // Refresh the site's declared icon about once a week; failures keep the previous icon.
    await refreshIconIfDue(parsed.link || feed.site_url);

    updateFeedAfterPoll(feed.id, {
      title: plainTitle(parsed.title),
      siteUrl: parsed.link,
      etag: fetched.etag,
      lastModified: fetched.lastModified,
      error: null,
    });

    return { newItems, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateFeedAfterPoll(feed.id, { error: message });
    return { newItems: 0, error: message };
  }
}

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

export async function pollDueFeeds(): Promise<void> {
  const due = listFeedsDueForPoll().filter((feed) => feedHasActiveSubscriber(feed.id));
  for (const feed of due) {
    await pollFeed(feed);
  }
}

export function startPollingScheduler(): void {
  // Runs every minute; each feed is only actually re-fetched once its own
  // poll_interval_minutes has elapsed (see listFeedsDueForPoll).
  let running = false;
  cron.schedule("* * * * *", async () => {
    if (running) return;
    running = true;
    try {
      await pollDueFeeds();
    } catch (error) {
      console.error("[poller] unexpected failure", error);
    } finally {
      running = false;
    }
  });
}
