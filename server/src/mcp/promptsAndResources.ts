import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { TokenScope } from "../auth/tokens.js";
import { generateOpml } from "../feeds/opml.js";
import { listItemsForUser, listSubscriptionsForUser } from "../feeds/repository.js";
import { buildDigest } from "./digest.js";
import { getItemForMcp } from "./items.js";

const userMessage = (text: string) => ({ messages: [{ role: "user" as const, content: { type: "text" as const, text } }] });

/** Ready-made prompts and readable resources, so MCP clients can offer FeedKeeper without custom instructions. */
export function registerPromptsAndResources(server: McpServer, userId: number, scope: TokenScope): void {
  server.registerPrompt(
    "daily_briefing",
    {
      title: "Daily briefing",
      description: "A short briefing of what is new in your feeds, grouped by topic.",
      argsSchema: { hours: z.string().regex(/^\d{1,3}$/).optional().describe("How many hours to look back (default 24)") },
    },
    ({ hours }) =>
      userMessage(
        `Use the FeedKeeper tool get_digest with hours=${hours ?? "24"} to see what is new. Write a briefing: group the articles by topic rather than by feed, lead with the most important stories, give each one a sentence, and mention the article ids so I can ask for more. Skip trivia. If something deserves a closer look, fetch it with get_item.`,
      ),
  );

  server.registerPrompt(
    "catch_up_on_topic",
    {
      title: "Catch up on a topic",
      description: "Find and summarize what your feeds say about a topic.",
      argsSchema: { topic: z.string().min(1).max(200).describe("The topic or search words") },
    },
    ({ topic }) =>
      userMessage(
        `Search my FeedKeeper articles for "${topic}" with search_items (also check saved articles with bookmarkedOnly). Read the most relevant ones with get_item and summarize how the story developed, with the sources and dates. Say clearly if there is little or nothing.`,
      ),
  );

  server.registerPrompt(
    "saved_reading_list",
    {
      title: "Saved reading list",
      description: "Summarize the articles you saved for later and suggest what to read first.",
    },
    () =>
      userMessage(
        "List my saved FeedKeeper articles with list_items (bookmarkedOnly=true). Give each a one-line summary, group them by theme, and suggest a reading order with rough reading effort.",
      ),
  );

  server.registerPrompt(
    "triage_unread",
    {
      title: "Triage unread articles",
      description: scope === "write" ? "Go through unread articles, save the keepers and mark the rest as read." : "Go through unread articles and recommend what to keep.",
      argsSchema: { feedId: z.string().regex(/^\d{1,9}$/).optional().describe("Only this feed (id)") },
    },
    ({ feedId }) =>
      userMessage(
        `Look at my unread FeedKeeper articles${feedId ? ` of feed ${feedId}` : ""} with get_digest. Recommend which are worth reading, which to save for later and which to skip.${scope === "write" ? " Ask me before you save or mark anything, then use bookmark_item and mark_read for the ones I confirm." : ""}`,
      ),
  );

  server.registerResource(
    "feeds",
    "feedkeeper://feeds",
    { title: "Subscribed feeds", description: "All subscriptions with unread counts and health.", mimeType: "application/json" },
    (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(listSubscriptionsForUser(userId), null, 2) }] }),
  );

  server.registerResource(
    "opml",
    "feedkeeper://opml",
    { title: "Subscriptions as OPML", description: "The subscription list in OPML 2.0, for backup or migration.", mimeType: "text/x-opml" },
    (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/x-opml", text: generateOpml(userId) }] }),
  );

  server.registerResource(
    "saved",
    "feedkeeper://saved",
    { title: "Saved articles", description: "The newest 100 saved articles, without their content.", mimeType: "application/json" },
    (uri) => {
      const items = listItemsForUser(userId, { bookmarkedOnly: true, limit: 100 }).map(({ content_html: _html, full_content_html: _full, content_lead: _lead, lead_version: _leadVersion, ...item }) => item);
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(items, null, 2) }] };
    },
  );

  server.registerResource(
    "digest",
    "feedkeeper://digest",
    { title: "Unread digest", description: "Unread articles of the last 24 hours, grouped by feed.", mimeType: "application/json" },
    (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(buildDigest(userId, { hours: 24 }), null, 2) }] }),
  );

  server.registerResource(
    "item",
    new ResourceTemplate("feedkeeper://items/{itemId}", { list: undefined }),
    { title: "Article", description: "One article with its stored content.", mimeType: "application/json" },
    (uri, variables) => {
      const item = getItemForMcp(userId, Number(variables.itemId));
      if (!item) throw new Error("item_not_found");
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(item, null, 2) }] };
    },
  );
}
