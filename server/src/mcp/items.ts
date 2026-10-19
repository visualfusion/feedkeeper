import { contentMetadata, readerHtml, sourceText } from "../feeds/articleContent.js";
import { z } from "zod";
import { findItemForUser, listItemsForUser } from "../feeds/repository.js";

const cursorSchema = z.object({
  createdAt: z.string().datetime({ offset: true }),
  id: z.number().int().positive(),
});

type ItemCursor = z.infer<typeof cursorSchema>;

export function encodeCursor(item: { created_at: string; id: number }): string {
  return Buffer.from(JSON.stringify({ createdAt: item.created_at, id: item.id })).toString("base64url");
}

export function decodeCursor(value: string): ItemCursor {
  if (value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid_cursor");
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) throw new Error("invalid_cursor");
  try {
    return cursorSchema.parse(JSON.parse(decoded.toString("utf8")));
  } catch {
    throw new Error("invalid_cursor");
  }
}

export function listItemsPage(
  userId: number,
  options: {
    feedId?: number;
    folderId?: number;
    unreadOnly?: boolean;
    bookmarkedOnly?: boolean;
    before?: string;
    after?: string;
    since?: string;
    until?: string;
    limit?: number;
  },
) {
  const limit = options.limit ?? 50;
  const rows = listItemsForUser(userId, {
    feedId: options.feedId,
    folderId: options.folderId,
    unreadOnly: options.unreadOnly,
    bookmarkedOnly: options.bookmarkedOnly,
    before: options.before ? decodeCursor(options.before) : undefined,
    after: options.after ? decodeCursor(options.after) : undefined,
    publishedSince: options.since,
    publishedUntil: options.until,
    sortByAdded: true,
    limit: limit + 1,
  });
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const items = page.map(({ content_html: _contentHtml, full_content_html: _fullContentHtml, content_lead: _lead, lead_version: _leadVersion, ...item }) => item);
  return {
    items,
    newestCursor: page[0] ? encodeCursor(page[0]) : null,
    nextCursor: hasMore && page.length ? encodeCursor(page[page.length - 1]) : null,
  };
}

export const MAX_CONTENT_LENGTH = 40_000;

export function getItemForMcp(userId: number, itemId: number, maxChars = MAX_CONTENT_LENGTH, offset = 0, revision?: number, format: "html" | "text" = "html") {
  const item = findItemForUser(userId, itemId);
  if (!item) return null;
  if (revision !== undefined && revision !== item.content_revision) throw new Error("content_revision_conflict");
  const content = readerHtml(item.full_content_html ?? item.content_html, item.title, item.author);
  const body = format === "text" ? sourceText(item) : content ?? "";
  let end = Math.min(offset + Math.min(maxChars, MAX_CONTENT_LENGTH), body.length);
  if (end < body.length && /[\uD800-\uDBFF]/.test(body[end - 1])) end--;
  if (end === offset && offset < body.length) end = Math.min(offset + 2, body.length);

  const { content_lead: _lead, lead_version: _leadVersion, ...visible } = item;
  return {
    ...visible,
    content_html: format === "html" ? body.slice(offset, end) : undefined,
    content_truncated: end < body.length,
    full_content_html: undefined,
    content: contentMetadata(item),
    ...(format === "text" ? { text: body.slice(offset, end) } : {}),
    format,
    offset,
    nextOffset: end < body.length ? end : null,
  };
}
