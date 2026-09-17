import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { listItemsForUser, listSubscriptionsForUser, markItemRead } from "../feeds/repository.js";
import { subscribeToFeed, unsubscribeFromFeed, FeedError } from "../feeds/service.js";
import { SsrfBlockedError } from "../feeds/ssrfGuard.js";

function textResult(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true as const };
}

// Builds a fresh MCP server scoped to a single authenticated user. A new
// instance is created per request (see mcp/http.ts) so tool handlers can
// safely close over `userId` without leaking data between users.
export function createMcpServerForUser(userId: number): McpServer {
  const server = new McpServer({ name: "feedkeeper", version: "0.1.0" });

  server.registerTool(
    "list_feeds",
    {
      title: "List subscribed feeds",
      description: "Lists all RSS/Atom feeds the current user is subscribed to, including unread counts.",
      inputSchema: {},
    },
    async () => textResult(listSubscriptionsForUser(userId)),
  );

  server.registerTool(
    "subscribe_feed",
    {
      title: "Subscribe to a feed",
      description: "Subscribes the current user to an RSS/Atom feed URL (e.g. a Google Alerts feed).",
      inputSchema: {
        url: z.string().url().describe("The feed's URL"),
        label: z.string().max(200).optional().describe("Optional display name for this feed"),
      },
    },
    async ({ url, label }) => {
      try {
        const subscription = await subscribeToFeed(userId, url, label ?? null);
        return textResult(subscription);
      } catch (error) {
        if (error instanceof SsrfBlockedError) return errorResult(error.message);
        if (error instanceof FeedError) return errorResult(error.message);
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );

  server.registerTool(
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

  server.registerTool(
    "get_new_items",
    {
      title: "Get new feed items",
      description: "Returns unread items, optionally filtered by feed or a search term.",
      inputSchema: {
        feedId: z.number().int().positive().optional(),
        search: z.string().max(200).optional(),
        limit: z.number().int().positive().max(200).optional(),
      },
    },
    async ({ feedId, search, limit }) =>
      textResult(listItemsForUser(userId, { feedId, search, limit, unreadOnly: true })),
  );

  server.registerTool(
    "search_items",
    {
      title: "Search feed items",
      description: "Full-text search (title/summary) across all items the user has access to, read or unread.",
      inputSchema: {
        query: z.string().min(1).max(200),
        feedId: z.number().int().positive().optional(),
        limit: z.number().int().positive().max(200).optional(),
      },
    },
    async ({ query, feedId, limit }) => textResult(listItemsForUser(userId, { search: query, feedId, limit })),
  );

  server.registerTool(
    "mark_read",
    {
      title: "Mark item as read",
      description: "Marks a feed item as read for the current user.",
      inputSchema: { itemId: z.number().int().positive() },
    },
    async ({ itemId }) => {
      markItemRead(userId, itemId);
      return textResult({ ok: true });
    },
  );

  return server;
}
