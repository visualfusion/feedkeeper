import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  listItemsForUser,
  listSubscriptionsForUser,
  markItemRead,
  markItemUnread,
  markAllRead,
  findFeedById,
  isUserSubscribed,
  bookmarkItem,
  unbookmarkItem,
  listMutedKeywords,
  addMutedKeyword,
  removeMutedKeyword,
  listFoldersForUser,
  findFolderById,
  createFolder,
  updateFolder,
  deleteFolder,
  updateSubscriptionFolder,
  applyToItems,
} from "../feeds/repository.js";
import type { TokenScope } from "../auth/tokens.js";
import { getItemForMcp, listItemsPage } from "./items.js";
import { buildDigest, buildOverview, truncate } from "./digest.js";
import { registerPromptsAndResources } from "./promptsAndResources.js";
import { subscribeToFeed, unsubscribeFromFeed, updateFeedSettings, changeFeedUrl, FeedError, MultipleFeedsFoundError } from "../feeds/service.js";
import { saveToInbox } from "../feeds/inbox.js";
import { loadFullText } from "../feeds/fullText.js";
import { pruneArchive, scheduleArchive } from "../feeds/archive.js";
import { SsrfBlockedError, normalizeUrlCandidate } from "../feeds/ssrfGuard.js";
import { generateOpml, importOpmlFeeds } from "../feeds/opml.js";
import { pollFeed } from "../feeds/poller.js";
import { discoverFeeds } from "../feeds/discovery.js";
import { APP_VERSION } from "../version.js";
import { dismissEdition, editionCandidates, getEditionState, publishCuratedEdition, publishEditionFields } from "../native/editions.js";
import { getNativePreferences } from "../native/preferences.js";
import { NativeError } from "../native/requests.js";
import { capabilityDenial, hasUserCapability } from "../auth/capabilities.js";

function textResult(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true as const };
}

const dateInput = z.union([z.string().datetime({ offset: true }), z.string().date()]);
const publishedRange = {
  since: dateInput.optional().describe("Filter for items published at or after this ISO date or date-time"),
  until: dateInput.optional().describe("Filter for items published at or before this ISO date or date-time"),
};

// Item actions accept one ID or a batch, so clients can triage many articles in one call.
const itemSelection = {
  itemId: z.number().int().positive().optional().describe("A single item ID to target"),
  itemIds: z.array(z.number().int().positive()).min(1).max(200).optional().describe("An array of up to 200 item IDs to target in batch"),
};

function selectedItemIds({ itemId, itemIds }: { itemId?: number; itemIds?: number[] }): number[] {
  return [...(itemIds ?? []), ...(itemId ? [itemId] : [])];
}

// Builds a fresh MCP server scoped to a single authenticated user. A new
// instance is created per request (see mcp/http.ts) so tool handlers can
// safely close over `userId` without leaking data between users.
export function createMcpServerForUser(userId: number, scope: TokenScope): McpServer {
  const server = new McpServer(
    { name: "feedkeeper", version: APP_VERSION },
    {
      instructions:
        "FeedKeeper is a personal RSS reader, article archiver, and news curation service. " +
        "Use it to read, search, and triage RSS/Atom feeds, fetch full article text, manage reading lists, " +
        "and read or publish curated newspaper editions.",
    },
  );

  const mcpUrlSchema = z.preprocess(
    (val) => (typeof val === "string" ? normalizeUrlCandidate(val) : val),
    z.string().url(),
  );

  const readOnlyAnnotations = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };

  const readOnlyOpenWorldAnnotations = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  };

  const writeAdditiveAnnotations = {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  };

  const writeAdditiveIdempotentAnnotations = {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };

  const writeOpenWorldAnnotations = {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  };

  const writeDestructiveAnnotations = {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  };

  server.registerTool(
    "list_feeds",
    {
      title: "List subscribed feeds",
      description: "Lists all RSS/Atom feeds the current user is subscribed to, including subscription settings, unread counts, and polling health status. Safe read-only operation. To inspect a single feed in detail, use get_feed. To discover new feeds, use discover_feeds.",
      annotations: readOnlyAnnotations,
      inputSchema: {
        onlyWithErrors: z.boolean().optional().describe("When true, only returns feeds whose last poll failed or that have consecutive errors"),
      },
    },
    async ({ onlyWithErrors }) => {
      const feeds = listSubscriptionsForUser(userId);
      return textResult(onlyWithErrors ? feeds.filter((feed) => feed.last_error || feed.consecutive_errors > 0) : feeds);
    },
  );

  server.registerTool(
    "get_feed",
    {
      title: "Get subscribed feed details",
      description: "Returns metadata, subscription settings, polling health status, and unread count for a single subscribed feed by its numeric feed ID. Safe read-only operation. Use list_feeds to view all subscribed feeds.",
      annotations: readOnlyAnnotations,
      inputSchema: {
        feedId: z.number().int().positive().describe("The numeric ID of the subscribed feed to inspect"),
      },
    },
    async ({ feedId }) => {
      const feed = listSubscriptionsForUser(userId).find((f) => f.id === feedId);
      if (!feed) return errorResult("feed_not_found: Feed does not exist or user is not subscribed");
      return textResult(feed);
    },
  );

  if (scope === "write") server.registerTool(
    "subscribe_feed",
    {
      title: "Subscribe to a feed",
      description: "Subscribes the current user to an RSS/Atom feed URL or website URL (auto-discovering the feed link if a website URL is provided). Requires write scope. Idempotent: subscribing to an already subscribed feed returns the existing subscription. Returns the subscription record. For API documentation, see https://github.com/visualfusion/feedkeeper.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: {
        url: mcpUrlSchema.describe("The RSS/Atom feed URL or website URL to subscribe to"),
        label: z.string().max(200).optional().describe("Optional custom display name for this feed subscription"),
        folderId: z.number().int().positive().optional().describe("Optional folder/category ID to place the new subscription in"),
      },
    },
    async ({ url, label, folderId }) => {
      if (!hasUserCapability(userId, "sync")) return { ...textResult(capabilityDenial(userId, "sync")), isError: true as const };
      try {
        const subscription = await subscribeToFeed(userId, url, label ?? null, folderId ?? null);
        return textResult(subscription);
      } catch (error) {
        if (error instanceof SsrfBlockedError) return errorResult(error.message);
        if (error instanceof MultipleFeedsFoundError) {
          return textResult({
            error: "multiple_feeds_found",
            message: "Multiple feeds found. Please specify one of the following feed URLs:",
            feeds: error.feeds,
          });
        }
        if (error instanceof FeedError) return errorResult(error.message);
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );

  server.registerTool(
    "discover_feeds",
    {
      title: "Discover feeds on a website",
      description: "Inspects a website URL and discovers available RSS, Atom, and JSON feed links from HTML link tags. Safe read-only operation: does NOT subscribe to any feed. Returns a list of discovered candidate feed URLs and titles. Use subscribe_feed to subscribe to one of the discovered URLs. For API documentation, see https://github.com/visualfusion/feedkeeper.",
      annotations: readOnlyOpenWorldAnnotations,
      inputSchema: {
        url: mcpUrlSchema.describe("The website URL to scan for available RSS/Atom feed links"),
      },
    },
    async ({ url }) => {
      if (!hasUserCapability(userId, "sync")) return { ...textResult(capabilityDenial(userId, "sync")), isError: true as const };
      try {
        const feeds = await discoverFeeds(url);
        return textResult({ feeds });
      } catch (error) {
        if (error instanceof SsrfBlockedError) return errorResult(error.message);
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );

  if (scope === "write") server.registerTool(
    "unsubscribe_feed",
    {
      title: "Unsubscribe from a feed",
      description: "Unsubscribes the current user from a feed by its feed ID. Destructive action. Feeds and other users' subscriptions are unaffected. Returns { ok: true } on success.",
      annotations: writeDestructiveAnnotations,
      inputSchema: {
        feedId: z.number().int().positive().describe("The numeric ID of the feed to unsubscribe from"),
      },
    },
    async ({ feedId }) => {
      try {
        unsubscribeFromFeed(userId, feedId);
        return textResult({ ok: true });
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );

  if (scope === "write") server.registerTool(
    "save_to_inbox",
    {
      title: "Save article or clipping to Universal Inbox",
      description: "Saves a web article URL, raw HTML, plain text/markdown clipping, or personal note directly into the user's Universal Inbox. At least one of url, contentHtml, or textContent must be provided. Returns { success: true, itemId: number, title: string, url: string, hasNote: boolean }. For API documentation, see https://github.com/visualfusion/feedkeeper.",
      annotations: writeOpenWorldAnnotations,
      inputSchema: {
        url: mcpUrlSchema.optional().describe("Web page URL to fetch, extract via Readability, and save"),
        title: z.string().max(500).optional().describe("Optional custom title for the saved inbox item"),
        contentHtml: z.string().optional().describe("Optional pre-rendered HTML content for the clipping"),
        textContent: z.string().optional().describe("Optional plain text or markdown clipping content"),
        note: z.string().max(20000).optional().describe("Optional personal note or editorial summary attached to the saved item"),
      },
    },
    async ({ url, title, contentHtml, textContent, note }) => {
      if (!url && !contentHtml && !textContent) {
        return errorResult("At least one of url, contentHtml, or textContent must be provided");
      }
      if (!hasUserCapability(userId, "inbox")) {
        return { ...textResult(capabilityDenial(userId, "inbox")), isError: true as const };
      }
      try {
        const result = await saveToInbox(userId, { url, title, contentHtml, textContent, note });
        return textResult({
          success: true,
          itemId: result.itemId,
          title: result.item.title,
          url: result.item.link,
          hasNote: result.hasNote,
        });
      } catch (error) {
        if (error instanceof SsrfBlockedError) return errorResult(error.message);
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );

  server.registerTool(
    "list_folders",
    {
      title: "List folders / categories",
      description: "Lists all feed categories/folders created by the current user, including feed counts and unread article counts per folder. Safe read-only operation.",
      annotations: readOnlyAnnotations,
      inputSchema: {},
    },
    async () => textResult(listFoldersForUser(userId)),
  );

  if (scope === "write") server.registerTool(
    "create_folder",
    {
      title: "Create a feed folder",
      description: "Creates a new category folder to organize feed subscriptions. Requires write scope. Returns the created folder object with its assigned id, name, and position. Folders can be assigned to feeds using move_feed_to_folder.",
      annotations: writeAdditiveAnnotations,
      inputSchema: {
        name: z.string().trim().min(1).max(100).describe("The unique display name for the new folder (1 to 100 characters)"),
      },
    },
    async ({ name }) => textResult(createFolder(userId, name)),
  );

  if (scope === "write") server.registerTool(
    "move_feed_to_folder",
    {
      title: "Move feed to folder",
      description: "Assigns a subscribed feed to a folder, or removes it from all folders (unfiled) if folderId is null. Requires write scope. Returns { ok: true } on success.",
      annotations: writeAdditiveIdempotentAnnotations,
      inputSchema: {
        feedId: z.number().int().positive().describe("The numeric ID of the subscribed feed to move"),
        folderId: z.number().int().positive().nullable().describe("The target folder ID, or null to move the feed to unfiled (root level)"),
      },
    },
    async ({ feedId, folderId }) => {
      if (!isUserSubscribed(userId, feedId)) return errorResult("not_subscribed");
      if (folderId !== null && !findFolderById(userId, folderId)) return errorResult("folder_not_found");
      updateSubscriptionFolder(userId, feedId, folderId);
      return textResult({ ok: true });
    },
  );

  if (scope === "write") server.registerTool(
    "update_feed",
    {
      title: "Update feed settings",
      description: "Updates subscription settings for a feed: custom display name, poll interval, full-text extraction policy, push notification preference, badge counter inclusion, or updates the feed URL if the publisher relocated. Returns the updated subscription record. For API documentation, see https://github.com/visualfusion/feedkeeper.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: {
        feedId: z.number().int().positive().describe("The numeric ID of the subscribed feed to update"),
        url: mcpUrlSchema.optional().describe("New feed URL or website URL if the feed moved (auto-discovered and validated)"),
        label: z.string().max(200).nullable().optional().describe("Custom display name; pass null or empty string to restore the original feed title"),
        pollIntervalMinutes: z.number().int().positive().max(10_080).optional().describe("Poll interval in minutes (subject to server minimum)"),
        fullText: z.enum(["auto", "never"]).optional().describe("'auto' allows the reader to fetch full articles; 'never' always retains the feed content"),
        notify: z.boolean().optional().describe("Whether to send push notifications to user devices when new articles arrive"),
        badge: z.boolean().optional().describe("Whether to count unread articles from this feed in the app icon badge number"),
      },
    },
    async ({ feedId, url, label, pollIntervalMinutes, fullText, notify, badge }) => {
      if (url && !hasUserCapability(userId, "sync")) return { ...textResult(capabilityDenial(userId, "sync")), isError: true as const };
      try {
        let targetFeedId = feedId;
        let previousItemsKept: boolean | undefined;
        if (url) {
          const changed = await changeFeedUrl(userId, feedId, url);
          targetFeedId = changed.subscription.id;
          previousItemsKept = changed.previousItemsKept;
        }
        const subscription = updateFeedSettings(userId, targetFeedId, { label, pollIntervalMinutes, fullTextMode: fullText, notify, badge });
        return textResult(previousItemsKept === undefined ? subscription : { ...subscription, previousItemsKept });
      } catch (error) {
        if (error instanceof MultipleFeedsFoundError) {
          return textResult({
            error: "multiple_feeds_found",
            message: "Multiple feeds found. Call again with one of these feed URLs:",
            feeds: error.feeds,
          });
        }
        if (error instanceof SsrfBlockedError) return errorResult(error.message);
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );

  if (scope === "write") server.registerTool(
    "rename_folder",
    {
      title: "Rename a feed folder",
      description: "Renames an existing feed category folder for the current user. Requires write scope. Returns the updated folder record { id, name, position }. Returns error if folderId is not found or name is already taken.",
      annotations: writeAdditiveIdempotentAnnotations,
      inputSchema: {
        folderId: z.number().int().positive().describe("The numeric ID of the folder to rename"),
        name: z.string().trim().min(1).max(100).describe("The new unique display name for the folder (1 to 100 characters)"),
      },
    },
    async ({ folderId, name }) => {
      if (!findFolderById(userId, folderId)) return errorResult("folder_not_found");
      try {
        return textResult(updateFolder(userId, folderId, name));
      } catch {
        return errorResult("folder_name_taken");
      }
    },
  );

  if (scope === "write") server.registerTool(
    "delete_folder",
    {
      title: "Delete a feed folder",
      description: "Deletes a feed category folder. Subscribed feeds inside the folder remain intact and are moved to the root level (unfiled). Destructive action for the folder organization. Returns { ok: true } on success.",
      annotations: writeDestructiveAnnotations,
      inputSchema: {
        folderId: z.number().int().positive().describe("The numeric ID of the folder to delete"),
      },
    },
    async ({ folderId }) => {
      if (!findFolderById(userId, folderId)) return errorResult("folder_not_found");
      deleteFolder(userId, folderId);
      return textResult({ ok: true });
    },
  );

  server.registerTool(
    "get_digest",
    {
      title: "Digest of recent articles grouped by feed",
      description: "Returns recent articles grouped by subscribed feed with short summaries (newest first). This is the fastest and most token-efficient way to scan what is new. Defaults to unread articles. Do NOT use this tool for pagination, full text, or deep filtering—use list_items for cursor pagination or get_new_items for unread filtering, and follow up with get_item for full article bodies.",
      annotations: readOnlyAnnotations,
      inputSchema: {
        feedId: z.number().int().positive().optional().describe("Optional feed ID to limit the digest to a single feed"),
        folderId: z.number().int().positive().optional().describe("Optional folder ID to limit the digest to feeds in that folder"),
        unreadOnly: z.boolean().optional().describe("When true (default), includes only unread articles; set false to include read articles"),
        hours: z.number().int().positive().max(720).optional().describe("Only include articles published in the last N hours (e.g. 24)"),
        since: dateInput.optional().describe("Only articles published at or after this ISO date or date-time (overrides hours)"),
        maxItemsPerFeed: z.number().int().positive().max(20).optional().describe("Maximum number of articles to include per feed (default: 5)"),
        snippetChars: z.number().int().positive().max(1000).optional().describe("Maximum character length of each article summary snippet (default: 200)"),
      },
    },
    async (args) => textResult(buildDigest(userId, args)),
  );

  server.registerTool(
    "get_overview",
    {
      title: "Account overview and reading statistics",
      description: "Returns account-wide statistics: total subscribed feeds, total unread articles, saved/bookmarked count, top feeds with the most unread items, folder unread counts, and feeds currently experiencing poll failures. Safe read-only overview.",
      annotations: readOnlyAnnotations,
      inputSchema: {},
    },
    async () => textResult(buildOverview(userId)),
  );

  server.registerTool(
    "get_new_items",
    {
      title: "List unread articles with optional filters",
      description: "Returns a flat list of unread articles matching specified filters (feed, folder, search query, bookmarked status, date range). Use this tool when you specifically need unread articles as a flat list or need article HTML content. Unlike get_digest, articles are flat rather than grouped. Unlike list_items, this tool returns only unread articles and does not use cursors. Follow up with get_item for individual full articles.",
      annotations: readOnlyAnnotations,
      inputSchema: {
        feedId: z.number().int().positive().optional().describe("Optional feed ID filter"),
        folderId: z.number().int().positive().optional().describe("Optional folder ID filter"),
        search: z.string().max(200).optional().describe("Optional search phrase to match against title or summary"),
        bookmarkedOnly: z.boolean().optional().describe("When true, only returns unread articles that are bookmarked"),
        ...publishedRange,
        limit: z.number().int().positive().max(200).optional().describe("Maximum number of unread items to return (1 to 200, default: 50)"),
        includeContent: z.boolean().optional().describe("When false, omits article HTML content to save tokens (default: true)"),
        snippetChars: z.number().int().positive().max(2000).optional().describe("Truncate each item summary to this many characters"),
      },
    },
    async ({ feedId, folderId, search, bookmarkedOnly, since, until, limit, includeContent, snippetChars }) =>
      textResult(listItemsForUser(userId, {
        feedId, folderId, search, bookmarkedOnly, limit, unreadOnly: true, publishedSince: since, publishedUntil: until,
      }).map(({ content_html, full_content_html, content_lead: _lead, lead_version: _leadVersion, ...item }) => ({
        ...item,
        ...(includeContent === false ? {} : { content_html, full_content_html }),
        content_snippet: snippetChars ? truncate(item.content_snippet, snippetChars) : item.content_snippet,
      }))),
  );

  server.registerTool(
    "list_items",
    {
      title: "Paginate items chronologically with cursors",
      description: "Lists articles chronologically with bidirectional cursor-based pagination. Use this tool for comprehensive browsing or historical paging through both read and unread articles. Pass nextCursor as 'before' to page backwards into older history, or newestCursor as 'after' to stream newly added items. Do NOT use for quick digests (use get_digest) or unread-only triage (use get_new_items).",
      annotations: readOnlyAnnotations,
      inputSchema: {
        feedId: z.number().int().positive().optional().describe("Optional feed ID filter"),
        folderId: z.number().int().positive().optional().describe("Optional folder ID filter"),
        unreadOnly: z.boolean().optional().describe("When true, only lists unread articles; default is false (all articles)"),
        bookmarkedOnly: z.boolean().optional().describe("When true, only lists bookmarked articles"),
        before: z.string().max(256).optional().describe("Cursor to fetch older items (pass nextCursor from a previous page)"),
        after: z.string().max(256).optional().describe("Cursor to fetch newer items (pass newestCursor from a previous page)"),
        ...publishedRange,
        limit: z.number().int().positive().max(100).optional().describe("Number of items to fetch per page (1 to 100, default: 20)"),
      },
    },
    async (args) => {
      try {
        return textResult(listItemsPage(userId, args));
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );

  server.registerTool(
    "get_item",
    {
      title: "Get single article content and metadata",
      description: "Returns full metadata and stored content (HTML or plain text) for a single subscribed article by its numeric itemId. Content is chunked at 40,000 characters; use offset and content.revision to paginate large articles. If an article only has an RSS teaser/summary and full web text is desired, call fetch_full_text.",
      annotations: readOnlyAnnotations,
      inputSchema: {
        itemId: z.number().int().positive().describe("The numeric ID of the article to retrieve"),
        maxChars: z.number().int().positive().max(40_000).optional().describe("Maximum character length of content to return (up to 40,000)"),
        format: z.enum(["html", "text"]).optional().describe("Format of content: 'html' for sanitized HTML, 'text' for plain text extraction"),
        offset: z.number().int().nonnegative().max(10_000_000).optional().describe("Character offset for reading subsequent chunks of large articles"),
        revision: z.number().int().positive().optional().describe("Revision token returned in previous chunk to ensure pagination consistency"),
      },
    },
    async ({ itemId, maxChars, offset, revision, format }) => {
      try {
        const item = getItemForMcp(userId, itemId, maxChars, offset, revision, format);
        return item ? textResult(item) : errorResult("item_not_found");
      } catch { return errorResult("content_revision_conflict"); }
    },
  );

  if (scope === "write") server.registerTool(
    "fetch_full_text",
    {
      title: "Extract full web article text",
      description: "Downloads and extracts the clean, full-length article text from the original publisher website via Readability, permanently caching it on the server and returning it. Use this tool ONLY when get_item indicates that the feed provided only an excerpt or teaser. If full text is already cached, it returns cached content unless force=true is passed.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: {
        itemId: z.number().int().positive().describe("The numeric ID of the article whose full web content should be extracted"),
        force: z.boolean().optional().describe("When true, forces re-downloading and re-extracting from the web even if already cached"),
      },
    },
    async ({ itemId, force }) => {
      if (!hasUserCapability(userId, "fulltext")) return { ...textResult(capabilityDenial(userId, "fulltext")), isError: true as const };
      const result = await loadFullText(userId, itemId, { force });
      if (!result.ok) return errorResult(result.message ? `${result.error}: ${result.message}` : result.error);
      return textResult({
        id: result.id,
        title: result.title ?? undefined,
        byline: result.byline ?? undefined,
        cached: result.cached,
        ...getItemForMcp(userId, itemId),
      });
    },
  );

  server.registerTool(
    "search_items",
    {
      title: "Search articles by keyword or phrase",
      description: "Searches article titles and summaries using SQLite FTS5 full-text search across all accessible items. Returns matching articles matching the query phrase, with optional feed, folder, bookmark, and date filters. Safe read-only search.",
      annotations: readOnlyAnnotations,
      inputSchema: {
        query: z.string().min(1).max(200).describe("The search term or phrase to find in article titles and content summaries"),
        feedId: z.number().int().positive().optional().describe("Optional feed ID filter"),
        folderId: z.number().int().positive().optional().describe("Optional folder ID filter"),
        bookmarkedOnly: z.boolean().optional().describe("When true, restricts search to bookmarked items"),
        ...publishedRange,
        limit: z.number().int().positive().max(200).optional().describe("Maximum number of search results to return (1 to 200, default: 50)"),
      },
    },
    async ({ query, feedId, folderId, bookmarkedOnly, since, until, limit }) =>
      textResult(listItemsForUser(userId, {
        search: query, feedId, folderId, bookmarkedOnly, limit, publishedSince: since, publishedUntil: until,
      })),
  );

  const itemActions = [
    ["mark_read", "Mark articles as read", "Marks one or more subscribed articles as read. Accepts a single itemId or an array of itemIds for batch processing. Idempotent: already-read articles remain read. Returns { ok: true, updated: number } where updated is the count of items that actually transitioned from unread to read.", writeAdditiveIdempotentAnnotations, markItemRead],
    ["mark_unread", "Mark articles as unread", "Marks one or more subscribed articles as unread. Accepts a single itemId or an array of itemIds for batch processing. Idempotent. Returns { ok: true, updated: number } where updated is the count of items that actually transitioned to unread.", writeAdditiveIdempotentAnnotations, markItemUnread],
    ["bookmark_item", "Bookmark articles for later", "Bookmarks (stars) one or more articles for permanent retention. Bookmarked articles retain full text and images and survive automatic retention cleanup and feed unsubscription. Idempotent. Returns { ok: true, updated: number }.", writeAdditiveIdempotentAnnotations, (userId: number, itemId: number) => {
      const changed = bookmarkItem(userId, itemId);
      if (changed) scheduleArchive(itemId);
      return changed;
    }],
    ["unbookmark_item", "Remove article bookmarks", "Removes bookmark status from one or more articles. Safely triggers archive pruning for unreferenced cached assets. Idempotent. Returns { ok: true, updated: number }.", writeDestructiveAnnotations, (userId: number, itemId: number) => {
      const changed = unbookmarkItem(userId, itemId);
      if (changed) pruneArchive();
      return changed;
    }],
  ] as const;
  if (scope === "write") for (const [name, title, description, annotations, change] of itemActions) {
    server.registerTool(name, { title, description, annotations, inputSchema: itemSelection }, async (args) => {
      if (!hasUserCapability(userId, "sync")) return { ...textResult(capabilityDenial(userId, "sync")), isError: true as const };
      const itemIds = selectedItemIds(args);
      if (itemIds.length === 0) return errorResult("Provide itemId or itemIds");
      return textResult({ ok: true, updated: applyToItems(itemIds, (itemId) => change(userId, itemId)) });
    });
  }

  if (scope === "write") server.registerTool(
    "mark_all_read",
    {
      title: "Mark all articles as read",
      description: "Marks all unread articles as read in a single operation. Can be scoped to a single feed or an entire folder. Idempotent. Returns { marked: number } with the count of newly read items.",
      annotations: writeDestructiveAnnotations,
      inputSchema: {
        feedId: z.number().int().positive().optional().describe("Optional feed ID to limit the mark-all-read operation to one feed"),
        folderId: z.number().int().positive().optional().describe("Optional folder ID to limit the mark-all-read operation to one folder"),
      },
    },
    async ({ feedId, folderId }) => hasUserCapability(userId, "sync")
      ? textResult({ marked: markAllRead(userId, { feedId, folderId }) })
      : { ...textResult(capabilityDenial(userId, "sync")), isError: true as const },
  );

  server.registerTool(
    "list_muted_keywords",
    {
      title: "List muted keywords",
      description: "Lists all keyword filters configured for the current user. Articles matching any active muted keyword are automatically filtered out from new item views and newspaper editions. Safe read-only.",
      annotations: readOnlyAnnotations,
      inputSchema: {},
    },
    async () => textResult(listMutedKeywords(userId)),
  );

  if (scope === "write") server.registerTool(
    "add_muted_keyword",
    {
      title: "Add a muted keyword filter",
      description: "Adds a new keyword filter rule. Articles whose title or summary contains this keyword (case-insensitive) will be suppressed from feeds and editions. Requires write scope. Returns the created keyword rule { id, keyword, created_at }.",
      annotations: writeAdditiveAnnotations,
      inputSchema: {
        keyword: z.string().trim().min(1).max(100).describe("The keyword phrase to filter out from feeds and editions (1 to 100 characters)"),
      },
    },
    async ({ keyword }) => textResult(addMutedKeyword(userId, keyword)),
  );

  if (scope === "write") server.registerTool(
    "unmute_keyword",
    {
      title: "Remove a muted keyword filter",
      description: "Removes an existing muted keyword filter by its numeric keywordId. Future and existing articles matching this keyword will once again be visible. Returns { ok: true } on success.",
      annotations: writeDestructiveAnnotations,
      inputSchema: {
        keywordId: z.number().int().positive().describe("The numeric ID of the muted keyword rule to remove"),
      },
    },
    async ({ keywordId }) => {
      removeMutedKeyword(userId, keywordId);
      return textResult({ ok: true });
    },
  );

  server.registerTool(
    "export_opml",
    {
      title: "Export feeds as OPML XML",
      description: "Exports all subscribed feeds and folder structures of the current user as an OPML 2.0 XML document. Safe read-only operation.",
      annotations: readOnlyAnnotations,
      inputSchema: {},
    },
    async () => ({ content: [{ type: "text" as const, text: generateOpml(userId) }] }),
  );

  if (scope === "write") server.registerTool(
    "import_opml",
    {
      title: "Import feeds from OPML XML",
      description: "Imports feed subscriptions and folders from an OPML 2.0 XML string for the current user. Existing subscriptions are preserved. Requires write scope. Returns { imported: number, failed: number, foldersCreated: number }.",
      annotations: writeAdditiveAnnotations,
      inputSchema: {
        opml: z.string().min(1).describe("The OPML 2.0 XML document string to parse and import"),
      },
    },
    async ({ opml }) => {
      if (!hasUserCapability(userId, "sync")) return { ...textResult(capabilityDenial(userId, "sync")), isError: true as const };
      try {
        const result = await importOpmlFeeds(userId, opml);
        return textResult(result);
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );

  if (scope === "write") server.registerTool(
    "refresh_feed",
    {
      title: "Refresh feed poll",
      description: "Requests an immediate poll of a subscribed feed from its origin URL and returns its updated health status, number of new items found, and error state. Respects origin HTTP cache headers and backoff pauses. Returns { success: boolean, newItems: number, error: string | null, deferred: boolean, retryAt: string | null, feed: object }.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      inputSchema: {
        feedId: z.number().int().positive().describe("The numeric ID of the subscribed feed to refresh"),
      },
    },
    async ({ feedId }) => {
      if (!hasUserCapability(userId, "sync")) return { ...textResult(capabilityDenial(userId, "sync")), isError: true as const };
      const feed = findFeedById(feedId);
      if (!feed || !isUserSubscribed(userId, feedId)) {
        return errorResult("Feed not found or not subscribed");
      }
      try {
        const result = await pollFeed(feed);
        const updated = listSubscriptionsForUser(userId).find((f) => f.id === feedId);
        return textResult({
          success: !result.error,
          newItems: result.newItems,
          error: result.error,
          deferred: result.deferred ?? false,
          retryAt: result.retryAt,
          feed: updated,
        });
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );

  const editionAction = (action: () => unknown) => {
    try { return textResult(action()); }
    catch (error) {
      if (!(error instanceof NativeError)) throw error;
      return { ...textResult({ error: error.code, ...(error.current !== undefined ? { current: error.current } : {}) }), isError: true as const };
    }
  };

  const capabilityAction = (capability: string, action: () => unknown) => {
    if (!hasUserCapability(userId, capability)) return { ...textResult(capabilityDenial(userId, capability)), isError: true as const };
    return editionAction(action);
  };

  server.registerTool("get_edition", {
    title: "Get current curated newspaper edition",
    description: "Returns the authoritative edition state, publication metadata, article list, and revision number for the user's curated newspaper edition ('Deine Zeitung'). Returns the current revision (even if empty, expired, or dismissed), which must be passed as expectedRevision when calling publish_edition. Safe read-only.",
    annotations: readOnlyAnnotations,
    inputSchema: {},
  }, async () => textResult(getEditionState(userId)));

  server.registerTool("get_edition_candidates", {
    title: "Get candidate articles for newspaper curation",
    description: "Use this tool ONLY when preparing to curate a newspaper edition with publish_edition. Returns a bounded shortlist of unread articles from the last 7 days scored for editorial curation, user reading preferences, and current revision. Do NOT use for general reading or browsing (use get_digest or get_new_items instead).",
    annotations: readOnlyAnnotations,
    inputSchema: {
      limit: z.number().int().min(1).max(200).default(100).describe("Maximum number of candidate articles to evaluate (1 to 200, default: 100)"),
    },
  }, async ({ limit }) => capabilityAction("editions", () => ({ preferences: getNativePreferences(userId), current: getEditionState(userId), candidates: editionCandidates(userId, new Date(), limit) })));

  if (scope === "write") server.registerTool("publish_edition", {
    title: "Publish curated newspaper edition",
    description: "Publishes an ordered selection of 1 to 24 article IDs as the user's official curated edition ('Deine Zeitung'). The published edition remains available until the next edition is published or expires. Pass the revision from get_edition as expectedRevision for optimistic concurrency, and a UUID requestId for idempotent retries. Does NOT alter underlying articles. Requires write scope.",
    annotations: writeAdditiveIdempotentAnnotations,
    inputSchema: publishEditionFields,
  }, async (input) => capabilityAction("editions", () => publishCuratedEdition(userId, input)));

  if (scope === "write") server.registerTool("dismiss_edition", {
    title: "Dismiss the current newspaper edition",
    description: "Explicitly dismisses the current curated edition so it is no longer shown as active. Requires a UUID requestId and the current revision as expectedRevision for conflict detection. Requires write scope. Returns { ok: true } on success.",
    annotations: writeDestructiveAnnotations,
    inputSchema: {
      requestId: z.uuid().describe("Unique idempotency UUID for this dismiss operation"),
      expectedRevision: z.number().int().min(0).describe("The current edition revision number obtained from get_edition"),
    },
  }, async (input) => editionAction(() => dismissEdition(userId, input)));

  registerPromptsAndResources(server, userId, scope);

  return server;
}
