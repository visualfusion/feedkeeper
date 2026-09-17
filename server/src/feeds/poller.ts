import Parser from "rss-parser";
import cron from "node-cron";
import { fetchFeed } from "./fetcher.js";
import { listFeedsDueForPoll, updateFeedAfterPoll, upsertItems, type Feed } from "./repository.js";

const parser = new Parser();

export async function pollFeed(feed: Feed): Promise<{ newItems: number }> {
  try {
    const fetched = await fetchFeed(feed.url, {
      etag: feed.etag ?? undefined,
      lastModified: feed.last_modified ?? undefined,
    });

    if (fetched.notModified) {
      updateFeedAfterPoll(feed.id, { error: null });
      return { newItems: 0 };
    }

    const parsed = await parser.parseString(fetched.body);

    const items = parsed.items.map((item) => ({
      guid: item.guid ?? item.link ?? item.title ?? crypto.randomUUID(),
      title: item.title,
      link: item.link,
      contentSnippet: item.contentSnippet ?? item.content,
      publishedAt: item.isoDate ?? item.pubDate,
    }));

    const newItems = upsertItems(feed.id, items);

    updateFeedAfterPoll(feed.id, {
      title: parsed.title,
      siteUrl: parsed.link,
      etag: fetched.etag,
      lastModified: fetched.lastModified,
      error: null,
    });

    return { newItems };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateFeedAfterPoll(feed.id, { error: message });
    return { newItems: 0 };
  }
}

export async function pollDueFeeds(): Promise<void> {
  const due = listFeedsDueForPoll();
  for (const feed of due) {
    await pollFeed(feed);
  }
}

export function startPollingScheduler(): void {
  // Runs every minute; each feed is only actually re-fetched once its own
  // poll_interval_minutes has elapsed (see listFeedsDueForPoll).
  cron.schedule("* * * * *", () => {
    pollDueFeeds().catch((error) => console.error("[poller] unexpected failure", error));
  });
}
