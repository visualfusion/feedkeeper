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
import { findUserById } from "../auth/users.js";
import { getDatabaseStats, runCleanup } from "../feeds/cleanup.js";
import { APP_VERSION } from "../version.js";
import { dismissEdition, editionCandidates, generateEdition, generateEditionSchema, getEditionState, publishCuratedEdition, publishEditionFields } from "../native/editions.js";
import { getNativePreferences, patchNativePreferences, preferencePatchSchema } from "../native/preferences.js";
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
  since: dateInput.optional().describe("Only items published at or after this ISO date or date-time"),
  until: dateInput.optional().describe("Only items published at or before this ISO date or date-time"),
};

// Item actions accept one ID or a batch, so clients can triage many articles in one call.
const itemSelection = {
  itemId: z.number().int().positive().optional().describe("A single item ID"),
  itemIds: z.array(z.number().int().positive()).min(1).max(200).optional().describe("Up to 200 item IDs"),
};

function selectedItemIds({ itemId, itemIds }: { itemId?: number; itemIds?: number[] }): number[] {
  return [...(itemIds ?? []), ...(itemId ? [itemId] : [])];
}

// Builds a fresh MCP server scoped to a single authenticated user. A new
// instance is created per request (see mcp/http.ts) so tool handlers can
// safely close over `userId` without leaking data between users.
export function createMcpServerForUser(userId: number, scope: TokenScope): McpServer {
  const server = new McpServer({ name: "feedkeeper", version: APP_VERSION });

  server.registerTool(
    "list_feeds",
    {
      title: "List subscribed feeds",
      description: "Lists all RSS/Atom feeds the current user is subscribed to, including unread counts and polling health.",
      inputSchema: {
        onlyWithErrors: z.boolean().optional().describe("Only return feeds whose last poll failed"),
      },
    },
    async ({ onlyWithErrors }) => {
      const feeds = listSubscriptionsForUser(userId);
      return textResult(onlyWithErrors ? feeds.filter((feed) => feed.last_error || feed.consecutive_errors > 0) : feeds);
    },
  );

  const mcpUrlSchema = z.preprocess(
    (val) => (typeof val === "string" ? normalizeUrlCandidate(val) : val),
    z.string().url(),
  );

  if (scope === "write") server.registerTool(
    "subscribe_feed",
    {
      title: "Subscribe to a feed",
      description: "Subscribes the current user to an RSS/Atom feed URL or website URL (auto-discovering the feed).",
      inputSchema: {
        url: mcpUrlSchema.describe("The feed URL or website URL"),
        label: z.string().max(200).optional().describe("Optional display name for this feed"),
        folderId: z.number().int().positive().optional().describe("Optional folder/category ID"),
      },
    },
    async ({ url, label, folderId }) => {
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
      description: "Inspects a website URL and discovers available RSS/Atom feed links.",
      inputSchema: {
        url: mcpUrlSchema.describe("The website URL to discover feeds from"),
      },
    },
    async ({ url }) => {
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
      description: "Removes a feed subscription for the current user.",
      inputSchema: { feedId: z.number().int().positive() },
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
      title: "Save article or note to Inbox",
      description: "Saves a web article URL, raw HTML, text clipping, or markdown note directly into the user's Universal Inbox.",
      inputSchema: {
        url: mcpUrlSchema.optional().describe("Web page URL to fetch, extract, and save"),
        title: z.string().max(500).optional().describe("Optional custom title"),
        contentHtml: z.string().optional().describe("Optional pre-rendered HTML content"),
        textContent: z.string().optional().describe("Optional plain text or markdown clipping"),
        note: z.string().max(20000).optional().describe("Optional note or summary attached to the saved item"),
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
      description: "Lists all feed categories/folders created by the user, including feed and unread counts.",
      inputSchema: {},
    },
    async () => textResult(listFoldersForUser(userId)),
  );

  if (scope === "write") server.registerTool(
    "create_folder",
    {
      title: "Create folder",
      description: "Creates a new category/folder to organize feeds.",
      inputSchema: { name: z.string().trim().min(1).max(100) },
    },
    async ({ name }) => textResult(createFolder(userId, name)),
  );

  if (scope === "write") server.registerTool(
    "move_feed_to_folder",
    {
      title: "Move feed to folder",
      description: "Assigns a feed to a folder, or removes it from all folders if folderId is null.",
      inputSchema: {
        feedId: z.number().int().positive(),
        folderId: z.number().int().positive().nullable(),
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
      description: "Changes a subscription: its feed URL (e.g. when a site moved its feed and polling keeps failing), display name, poll interval, whether the reader may fetch full articles, and whether new articles trigger push notifications or count in the app icon number. A new URL is fetched and validated before it replaces the old one. If the returned feed ID differs from the one passed in, use the new ID from now on. The poll interval applies to every subscriber of the feed and has a server-wide minimum.",
      inputSchema: {
        feedId: z.number().int().positive(),
        url: mcpUrlSchema.optional().describe("New feed URL or website URL (the feed is auto-discovered)"),
        label: z.string().max(200).nullable().optional().describe("Custom display name; null or empty restores the feed title"),
        pollIntervalMinutes: z.number().int().positive().max(10_080).optional(),
        fullText: z.enum(["auto", "never"]).optional().describe("auto: the reader may fetch full articles; never: always show the feed content"),
        notify: z.boolean().optional().describe("Send push notifications to the user's devices when this feed has new articles"),
        badge: z.boolean().optional().describe("Count this feed's unread articles in the number on the app icon"),
      },
    },
    async ({ feedId, url, label, pollIntervalMinutes, fullText, notify, badge }) => {
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
      title: "Rename folder",
      description: "Renames one of the user's folders.",
      inputSchema: { folderId: z.number().int().positive(), name: z.string().trim().min(1).max(100) },
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
      title: "Delete folder",
      description: "Deletes a folder. Its feeds stay subscribed and move out of any folder.",
      inputSchema: { folderId: z.number().int().positive() },
    },
    async ({ folderId }) => {
      if (!findFolderById(userId, folderId)) return errorResult("folder_not_found");
      deleteFolder(userId, folderId);
      return textResult({ ok: true });
    },
  );

  server.registerTool(
    "get_new_items",
    {
      title: "Get new feed items",
      description: "Returns unread items, optionally filtered by feed, folder, search term, or bookmarks.",
      inputSchema: {
        feedId: z.number().int().positive().optional(),
        folderId: z.number().int().positive().optional(),
        search: z.string().max(200).optional(),
        bookmarkedOnly: z.boolean().optional(),
        ...publishedRange,
        limit: z.number().int().positive().max(200).optional(),
        includeContent: z.boolean().optional().describe("Set to false to leave out the article HTML and save tokens (default: true)"),
        snippetChars: z.number().int().positive().max(2000).optional().describe("Shorten each item's summary to this many characters"),
      },
    },
    async ({ feedId, folderId, search, bookmarkedOnly, since, until, limit, includeContent, snippetChars }) =>
      textResult(listItemsForUser(userId, {
        feedId, folderId, search, bookmarkedOnly, limit, unreadOnly: true, publishedSince: since, publishedUntil: until,
      }).map(({ content_html, full_content_html, ...item }) => ({
        ...item,
        ...(includeContent === false ? {} : { content_html, full_content_html }),
        content_snippet: snippetChars ? truncate(item.content_snippet, snippetChars) : item.content_snippet,
      }))),
  );

  server.registerTool(
    "get_digest",
    {
      title: "Digest of new articles",
      description: "Returns articles grouped by feed with short snippets, newest first: the cheapest way to see what is new. Defaults to unread articles. Use hours (e.g. 24) or since to limit the period, and maxItemsPerFeed / snippetChars to control size. Follow up with get_item for the full article.",
      inputSchema: {
        feedId: z.number().int().positive().optional(),
        folderId: z.number().int().positive().optional(),
        unreadOnly: z.boolean().optional().describe("Include read articles too when false (default: true)"),
        hours: z.number().int().positive().max(720).optional().describe("Only articles published in the last N hours"),
        since: dateInput.optional().describe("Only articles published at or after this ISO date or date-time (overrides hours)"),
        maxItemsPerFeed: z.number().int().positive().max(20).optional().describe("Articles listed per feed (default: 5)"),
        snippetChars: z.number().int().positive().max(1000).optional().describe("Length of each snippet (default: 200)"),
      },
    },
    async (args) => textResult(buildDigest(userId, args)),
  );

  server.registerTool(
    "get_overview",
    {
      title: "Account overview",
      description: "Returns counts for the whole account: subscribed feeds, unread and saved articles, the feeds with the most unread articles, folders with their unread counts, and feeds that are failing.",
      inputSchema: {},
    },
    async () => textResult(buildOverview(userId)),
  );

  server.registerTool(
    "list_items",
    {
      title: "List items with a cursor",
      description: "Lists compact article records by time added. Use nextCursor as before to fetch older pages, or newestCursor as after to fetch newly added items. When paging new items, keep the original after cursor while following nextCursor.",
      inputSchema: {
        feedId: z.number().int().positive().optional(),
        folderId: z.number().int().positive().optional(),
        unreadOnly: z.boolean().optional(),
        bookmarkedOnly: z.boolean().optional(),
        before: z.string().max(256).optional(),
        after: z.string().max(256).optional(),
        ...publishedRange,
        limit: z.number().int().positive().max(100).optional(),
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
      title: "Get an article",
      description: "Returns one subscribed article, including cached feed or reader content when available. Content is paginated at 40,000 characters; follow nextOffset with offset and the returned content.revision to read every part. Pass maxChars for less.",
      inputSchema: {
        itemId: z.number().int().positive(),
        maxChars: z.number().int().positive().max(40_000).optional().describe("Shorten the content to this many characters"),
        format: z.enum(["html", "text"]).optional().describe("Use text to read plain publisher text without HTML markup"),
        offset: z.number().int().nonnegative().max(10_000_000).optional(),
        revision: z.number().int().positive().optional().describe("Keep pagination on the same content revision"),
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
      title: "Fetch an article's full text",
      description: "Downloads the full article from its website when the feed only has a teaser, caches it and returns it. Content is capped at 40,000 characters; use get_item with nextOffset and content.revision for remaining text.",
      inputSchema: {
        itemId: z.number().int().positive(),
        force: z.boolean().optional().describe("Fetch again even when a cached full text exists"),
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
      title: "Search feed items",
      description: "Searches item titles and summaries for a phrase across all items the user can access.",
      inputSchema: {
        query: z.string().min(1).max(200),
        feedId: z.number().int().positive().optional(),
        folderId: z.number().int().positive().optional(),
        bookmarkedOnly: z.boolean().optional(),
        ...publishedRange,
        limit: z.number().int().positive().max(200).optional(),
      },
    },
    async ({ query, feedId, folderId, bookmarkedOnly, since, until, limit }) =>
      textResult(listItemsForUser(userId, {
        search: query, feedId, folderId, bookmarkedOnly, limit, publishedSince: since, publishedUntil: until,
      })),
  );

  const itemActions = [
    ["mark_read", "Mark items as read", "Marks one or more subscribed items as read.", markItemRead],
    ["mark_unread", "Mark items as unread", "Marks one or more subscribed items as unread.", markItemUnread],
    ["bookmark_item", "Bookmark items", "Saves one or more items for later. Saved items keep their full text and images, survive retention cleanup and unsubscribing.", (userId: number, itemId: number) => {
      const changed = bookmarkItem(userId, itemId);
      if (changed) scheduleArchive(itemId);
      return changed;
    }],
    ["unbookmark_item", "Remove bookmarks", "Removes the bookmark from one or more items.", (userId: number, itemId: number) => {
      const changed = unbookmarkItem(userId, itemId);
      if (changed) pruneArchive();
      return changed;
    }],
  ] as const;
  if (scope === "write") for (const [name, title, description, change] of itemActions) {
    server.registerTool(name, { title, description, inputSchema: itemSelection }, async (args) => {
      if (!hasUserCapability(userId, "sync")) return { ...textResult(capabilityDenial(userId, "sync")), isError: true as const };
      const itemIds = selectedItemIds(args);
      if (itemIds.length === 0) return errorResult("Provide itemId or itemIds");
      // `updated` counts items whose state actually changed.
      return textResult({ ok: true, updated: applyToItems(itemIds, (itemId) => change(userId, itemId)) });
    });
  }

  if (scope === "write") server.registerTool(
    "mark_all_read",
    {
      title: "Mark all items as read",
      description: "Marks all subscribed items as read, optionally limited to one feed or folder.",
      inputSchema: {
        feedId: z.number().int().positive().optional(),
        folderId: z.number().int().positive().optional(),
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
      description: "Lists all muted keywords configured for the current user.",
      inputSchema: {},
    },
    async () => textResult(listMutedKeywords(userId)),
  );

  if (scope === "write") server.registerTool(
    "add_muted_keyword",
    {
      title: "Add muted keyword",
      description: "Mutes a keyword. Articles containing this keyword will be filtered out from your feed.",
      inputSchema: { keyword: z.string().min(1).max(100) },
    },
    async ({ keyword }) => textResult(addMutedKeyword(userId, keyword)),
  );

  if (scope === "write") server.registerTool(
    "remove_muted_keyword",
    {
      title: "Remove muted keyword",
      description: "Unmutes a keyword by its ID.",
      inputSchema: { keywordId: z.number().int().positive() },
    },
    async ({ keywordId }) => {
      removeMutedKeyword(userId, keywordId);
      return textResult({ ok: true });
    },
  );

  server.registerTool(
    "export_opml",
    {
      title: "Export feeds as OPML",
      description: "Exports all subscribed feeds of the current user as an OPML 2.0 XML string.",
      inputSchema: {},
    },
    async () => ({ content: [{ type: "text" as const, text: generateOpml(userId) }] }),
  );

  if (scope === "write") server.registerTool(
    "import_opml",
    {
      title: "Import feeds from OPML",
      description: "Imports feeds from an OPML 2.0 XML string for the current user.",
      inputSchema: {
        opml: z.string().min(1).describe("The OPML XML content to import"),
      },
    },
    async ({ opml }) => {
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
      title: "Refresh a feed",
      description: "Requests an update of a subscribed feed and returns its health. Respects source pauses; deferred=true means work is still pending.",
      inputSchema: {
        feedId: z.number().int().positive().describe("The ID of the feed to refresh"),
      },
    },
    async ({ feedId }) => {
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

  server.registerTool("get_native_preferences", {
    title: "Get native reading preferences",
    description: "Returns the user's app-only folder order, newspaper exclusions, preferred sections, time zone and edition size. These settings do not change the web reader.",
    inputSchema: {},
  }, async () => textResult(getNativePreferences(userId)));

  server.registerTool("get_edition", {
    title: "Get current edition",
    description: "Returns the authoritative edition state and revision, including when absent, expired or dismissed. Call before publishing with expectedRevision.",
    inputSchema: {},
  }, async () => textResult(getEditionState(userId)));

  server.registerTool("get_edition_candidates", {
    title: "Get edition candidates",
    description: "Returns a bounded shortlist of unread articles from the last seven days, respecting muted keywords and app-only section visibility. Includes the current revision and user preferences. Includes sourceName and folderName. Use get_item to inspect selected articles, then publish_edition with expectedRevision and a stable requestId.",
    inputSchema: { limit: z.number().int().min(1).max(200).default(100) },
  }, async ({ limit }) => capabilityAction("editions", () => ({ preferences: getNativePreferences(userId), current: getEditionState(userId), candidates: editionCandidates(userId, new Date(), limit) })));

  if (scope === "write") server.registerTool("update_native_preferences", {
    title: "Update native reading preferences",
    description: "Patches app-only preferences using expectedRevision and a UUID requestId. Retried requests return their original result; conflicts include the current settings. Folder IDs must belong to the current user. Never changes the web folder list or stream.",
    inputSchema: preferencePatchSchema.shape,
  }, async (input) => capabilityAction("sync", () => patchNativePreferences(userId, input)));

  if (scope === "write") server.registerTool("publish_edition", {
    title: "Publish curated edition",
    description: "Publishes an ordered list of 1 to 24 accessible article IDs. Curated editions override automatic ones until expiry (default 24 hours, maximum seven days). App-only hidden sections and muted keywords are respected. Supply the revision from get_edition as expectedRevision and a UUID requestId for conflict detection and safe retries. Optional title and summary are editorial text; original articles stay unchanged.",
    inputSchema: publishEditionFields,
  }, async (input) => capabilityAction("editions", () => publishCuratedEdition(userId, input)));

  if (scope === "write") server.registerTool("generate_edition", {
    title: "Generate an automatic edition",
    description: "Ensures an automatic edition exists without disturbing a valid current issue. force=true requests a new automatic selection and requires expectedRevision. A valid curated edition must be explicitly dismissed first. Use a stable UUID requestId for retries.",
    inputSchema: generateEditionSchema.shape,
  }, async (input) => capabilityAction("editions", () => {
    const parsed = generateEditionSchema.safeParse(input);
    if (!parsed.success) throw new NativeError("invalid_input");
    return { edition: generateEdition(userId, parsed.data), current: getEditionState(userId) };
  }));

  if (scope === "write") server.registerTool("dismiss_edition", {
    title: "Dismiss the current edition",
    description: "Explicitly dismisses the current edition, including curated issues, using a revision and stable UUID requestId. Automatic scheduling waits until the next time slot; generate_edition with force=true can start a new issue immediately.",
    inputSchema: { requestId: z.uuid(), expectedRevision: z.number().int().min(0) },
  }, async (input) => editionAction(() => dismissEdition(userId, input)));

  const currentUser = findUserById(userId);
  if (scope === "write" && currentUser?.role === "admin") {
    server.registerTool(
      "cleanup_database",
      {
        title: "Clean up database and retention",
        description: "Admin tool: runs item retention cleanup and VACUUM to purge old/read items and reclaim disk space.",
        inputSchema: {
          retentionReadDays: z.number().int().min(0).optional().describe("Override read items retention in days"),
          retentionMaxDays: z.number().int().min(0).optional().describe("Override total item age retention in days"),
          retentionMaxItemsPerFeed: z.number().int().min(0).optional().describe("Override maximum items per feed cap"),
        },
      },
      async (args) => {
        try {
          const result = runCleanup(args);
          const stats = getDatabaseStats();
          return textResult({ result, stats });
        } catch (error) {
          return errorResult(error instanceof Error ? error.message : String(error));
        }
      },
    );
  }

  registerPromptsAndResources(server, userId, scope);

  return server;
}
