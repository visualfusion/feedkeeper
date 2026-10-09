import { enqueueArticleContents } from "../../feeds/fullTextQueue.js";
import { Router, type Request } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { FULL_TEXT_STATUS } from "../items.js";
import { findArchivedImage, fetchItemImage, withArchivedImages, withProxiedImages } from "../../feeds/archive.js";
import { discoverFeeds } from "../../feeds/discovery.js";
import { loadFullText } from "../../feeds/fullText.js";
import { generateOpml, importOpmlFeeds } from "../../feeds/opml.js";
import { pollFeed, pollFeeds } from "../../feeds/poller.js";
import { canAccessFeed, loadFeedIcon } from "../../feeds/feedIcon.js";
import {
  addMutedKeyword,
  canAccessItem,
  createFolder,
  deleteFolder,
  deleteItemNote,
  findFeedById,
  findFolderById,
  findItemForUser,
  findItemNote,
  noteConflictState,
  isUserSubscribed,
  itemsWithNotes,
  listFoldersForUser,
  listItemsForUser,
  listMutedKeywords,
  listNotesForUser,
  listSubscriptionsForUser,
  markAllRead,
  removeMutedKeyword,
  reorderSubscriptions,
  searchItemsForUser,
  setItemNote,
  updateFolder,
} from "../../feeds/repository.js";
import { saveToInbox, deleteInboxItem } from "../../feeds/inbox.js";
import { changeFeedUrl, FeedError, MultipleFeedsFoundError, subscribeToFeed, unsubscribeFromFeed, updateFeedSettings } from "../../feeds/service.js";
import { SsrfBlockedError, normalizeUrlCandidate } from "../../feeds/ssrfGuard.js";
import { buildOverview } from "../../mcp/digest.js";
import { decodeCursor, encodeCursor } from "../../mcp/items.js";
import { readingPositions, serializeItem, serializeSubscriptionDetail } from "./serialize.js";
import { dismissEdition, editionCandidates, generateEdition, generateEditionSchema, getEdition, getEditionState, type ServerEdition } from "../../native/editions.js";
import { getNativePreferences, patchNativePreferences } from "../../native/preferences.js";
import { NativeError } from "../../native/requests.js";
import { capabilityDenial, hasUserCapability, requireCapability } from "../../auth/capabilities.js";

export const resourcesRouter = Router();

const API_BASE = "/api/v1";
const origin = (req: Request) => `${req.protocol}://${req.get("host")}`;
const imageLimiter = rateLimit({ windowMs: 60 * 1000, limit: 600, standardHeaders: true, legacyHeaders: false });

const urlField = z.preprocess((val) => (typeof val === "string" ? normalizeUrlCandidate(val) : val), z.string().url());
const invalid = (res: import("express").Response, details?: unknown) => void res.status(400).json({ error: "invalid_input", ...(details ? { details } : {}) });

function subscriptionOf(userId: number, id: number) {
  const subscription = listSubscriptionsForUser(userId).find((entry) => entry.id === id);
  return subscription ? serializeSubscriptionDetail(subscription) : null;
}

// ---- Account -------------------------------------------------------------

resourcesRouter.get("/overview", (req, res) => {
  res.json(buildOverview(req.user!.id));
});

// ---- Subscriptions -------------------------------------------------------

resourcesRouter.get("/subscriptions", (req, res) => {
  res.json(listSubscriptionsForUser(req.user!.id).map(serializeSubscriptionDetail));
});

const subscribeSchema = z.object({
  url: urlField,
  label: z.string().max(200).nullable().optional(),
  folderId: z.number().int().positive().nullable().optional(),
});

resourcesRouter.post("/subscriptions", async (req, res) => {
  const parsed = subscribeSchema.safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error.flatten());
  try {
    const created = await subscribeToFeed(req.user!.id, parsed.data.url, parsed.data.label ?? null, parsed.data.folderId ?? null);
    res.status(201).json(subscriptionOf(req.user!.id, created.id));
  } catch (error) {
    if (error instanceof SsrfBlockedError) return void res.status(400).json({ error: "blocked_url", message: error.message });
    if (error instanceof MultipleFeedsFoundError) return void res.status(409).json({ error: "multiple_feeds_found", feeds: error.feeds });
    if (error instanceof FeedError) return void res.status(error.message === "already_subscribed" ? 409 : 400).json({ error: error.message });
    res.status(400).json({ error: "invalid_feed", message: error instanceof Error ? error.message : String(error) });
  }
});

const reorderSchema = z.object({ ids: z.array(z.number().int().positive()) });

resourcesRouter.put("/subscriptions/order", (req, res) => {
  const parsed = reorderSchema.safeParse(req.body);
  const current = listSubscriptionsForUser(req.user!.id).map((subscription) => subscription.id);
  const ids = parsed.success ? parsed.data.ids : [];
  if (!parsed.success || ids.length !== current.length || new Set(ids).size !== current.length || ids.some((id) => !current.includes(id))) {
    return invalid(res, "ids must list every subscription exactly once");
  }
  reorderSubscriptions(req.user!.id, ids);
  res.status(204).end();
});

const updateSchema = z.object({
  url: urlField.optional(),
  label: z.string().max(200).nullable().optional(),
  folderId: z.number().int().positive().nullable().optional(),
  pollIntervalMinutes: z.number().int().positive().max(10080).optional(),
  fullTextMode: z.enum(["auto", "never"]).optional(),
  notify: z.boolean().optional(),
  badge: z.boolean().optional(),
});

resourcesRouter.patch("/subscriptions/:id", async (req, res) => {
  const id = Number(req.params.id);
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error.flatten());
  const { url, ...settings } = parsed.data;
  try {
    let targetId = id;
    if (url) targetId = (await changeFeedUrl(req.user!.id, id, url)).subscription.id;
    updateFeedSettings(req.user!.id, targetId, settings);
    res.json(subscriptionOf(req.user!.id, targetId));
  } catch (error) {
    if (error instanceof MultipleFeedsFoundError) return void res.status(409).json({ error: "multiple_feeds_found", feeds: error.feeds });
    if (error instanceof SsrfBlockedError) return void res.status(400).json({ error: "blocked_url", message: error.message });
    if (error instanceof FeedError) return void res.status(error.message === "not_subscribed" ? 404 : 400).json({ error: error.message });
    res.status(400).json({ error: "invalid_feed", message: error instanceof Error ? error.message : String(error) });
  }
});

resourcesRouter.delete("/subscriptions/:id", (req, res) => {
  try {
    unsubscribeFromFeed(req.user!.id, Number(req.params.id));
    res.status(204).end();
  } catch (error) {
    if (error instanceof FeedError) return void res.status(404).json({ error: error.message });
    throw error;
  }
});

async function refresh(userId: number, id: number) {
  const feed = findFeedById(id);
  if (!feed || !isUserSubscribed(userId, id)) return null;
  const result = await pollFeed(feed);
  return { subscription: subscriptionOf(userId, id), ...result };
}

resourcesRouter.post("/subscriptions/:id/refresh", async (req, res) => {
  const result = await refresh(req.user!.id, Number(req.params.id));
  if (!result) return void res.status(404).json({ error: "not_found" });
  res.json(result);
});

resourcesRouter.post("/refresh", async (req, res) => {
  const subscriptions = listSubscriptionsForUser(req.user!.id);
  const { newItems, errors, deferred } = await pollFeeds(subscriptions);

  res.json({ refreshed: subscriptions.length, newItems, errors, deferred });
});

resourcesRouter.get("/subscriptions/:id/icon", imageLimiter, async (req, res) => {
  const id = Number(req.params.id);
  const icon = canAccessFeed(req.user!.id, id) ? await loadFeedIcon(id) : null;
  if (!icon) return void res.status(404).json({ error: "not_found" });

  if (icon.hash) {
    res.setHeader("ETag", `"${icon.hash}"`);
    const ifNoneMatch = req.headers["if-none-match"];
    if (ifNoneMatch === `"${icon.hash}"` || ifNoneMatch === icon.hash) {
      return void res.status(304).end();
    }
  }

  const v = typeof req.query.v === "string" ? req.query.v : "";
  if (v && v === icon.hash) {
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  } else {
    res.setHeader("Cache-Control", "private, max-age=86400");
  }

  // SVG icons must never run scripts, even when opened directly.
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  res.type(icon.mime).send(icon.buffer);
});

resourcesRouter.post("/discover", async (req, res) => {
  const parsed = z.object({ url: urlField }).safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error.flatten());
  try {
    res.json({ feeds: await discoverFeeds(parsed.data.url) });
  } catch (error) {
    if (error instanceof SsrfBlockedError) return void res.status(400).json({ error: "blocked_url", message: error.message });
    res.status(400).json({ error: "discovery_failed", message: error instanceof Error ? error.message : String(error) });
  }
});

resourcesRouter.get("/opml", (req, res) => {
  res.setHeader("Content-Type", "text/x-opml; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="feedkeeper-subscriptions.opml"');
  res.send(generateOpml(req.user!.id));
});

resourcesRouter.post("/opml", async (req, res) => {
  const xml = typeof req.body === "string" ? req.body : typeof req.body?.opml === "string" ? req.body.opml : "";
  if (!xml.trim()) return void res.status(400).json({ error: "missing_opml_content" });
  try {
    res.json(await importOpmlFeeds(req.user!.id, xml));
  } catch (error) {
    res.status(400).json({ error: "invalid_opml", message: error instanceof Error ? error.message : String(error) });
  }
});

// ---- Folders and muted keywords -----------------------------------------

const serializeFolder = (folder: ReturnType<typeof listFoldersForUser>[number]) => ({
  id: folder.id,
  name: folder.name,
  iconSymbol: folder.icon_symbol ?? null,
  subscriptionCount: folder.feed_count,
  unreadCount: folder.unread_count,
});

export const SF_SYMBOL_REGEX = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/i;

const sfSymbolSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(SF_SYMBOL_REGEX, "Invalid SF Symbol name")
  .transform((val) => val.toLowerCase());

const createFolderSchema = z.object({
  name: z.string().trim().min(1).max(100),
  iconSymbol: sfSymbolSchema.nullable().optional(),
});

const patchFolderSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    iconSymbol: sfSymbolSchema.nullable().optional(),
  })
  .refine((data) => data.name !== undefined || data.iconSymbol !== undefined, {
    message: "Must provide name or iconSymbol",
  });

resourcesRouter.get("/folders", (req, res) => {
  res.json(listFoldersForUser(req.user!.id).map(serializeFolder));
});

resourcesRouter.post("/folders", (req, res) => {
  const parsed = createFolderSchema.safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error.flatten());
  if (parsed.data.iconSymbol !== undefined && !hasUserCapability(req.user!.id, "sync")) {
    return void res.status(403).json(capabilityDenial(req.user!.id, "sync"));
  }
  try {
    const folder = createFolder(req.user!.id, parsed.data.name, parsed.data.iconSymbol);
    res.status(201).json({
      id: folder.id,
      name: folder.name,
      iconSymbol: folder.icon_symbol ?? null,
      subscriptionCount: 0,
      unreadCount: 0,
    });
  } catch {
    res.status(409).json({ error: "folder_name_taken" });
  }
});

resourcesRouter.patch("/folders/:id", (req, res) => {
  const id = Number(req.params.id);
  const parsed = patchFolderSchema.safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error.flatten());
  if (parsed.data.iconSymbol !== undefined && !hasUserCapability(req.user!.id, "sync")) {
    return void res.status(403).json(capabilityDenial(req.user!.id, "sync"));
  }
  if (!findFolderById(req.user!.id, id)) return void res.status(404).json({ error: "folder_not_found" });
  try {
    updateFolder(req.user!.id, id, parsed.data);
  } catch {
    return void res.status(409).json({ error: "folder_name_taken" });
  }
  const folder = listFoldersForUser(req.user!.id).find((item) => item.id === id);
  if (!folder) return void res.status(404).json({ error: "folder_not_found" });
  res.json(serializeFolder(folder));
});

resourcesRouter.delete("/folders/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!findFolderById(req.user!.id, id)) return void res.status(404).json({ error: "folder_not_found" });
  deleteFolder(req.user!.id, id);
  res.status(204).end();
});

resourcesRouter.get("/muted-keywords", (req, res) => {
  res.json(listMutedKeywords(req.user!.id).map((keyword) => ({ id: keyword.id, keyword: keyword.keyword })));
});

resourcesRouter.post("/muted-keywords", (req, res) => {
  const parsed = z.object({ keyword: z.string().trim().min(1).max(100) }).safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error.flatten());
  const created = addMutedKeyword(req.user!.id, parsed.data.keyword);
  res.status(201).json({ id: created.id, keyword: created.keyword });
});

resourcesRouter.delete("/muted-keywords/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return invalid(res);
  removeMutedKeyword(req.user!.id, id);
  res.status(204).end();
});

// ---- Articles ------------------------------------------------------------

const dateInput = z.union([z.string().datetime({ offset: true }), z.string().date()]);
const flag = z.enum(["true", "false"]).transform((value) => value === "true");

const itemsQuery = z.object({
  subscriptionId: z.coerce.number().int().positive().optional(),
  folderId: z.coerce.number().int().positive().optional(),
  unread: flag.optional(),
  saved: flag.optional(),
  q: z.string().max(200).optional(),
  since: dateInput.optional(),
  until: dateInput.optional(),
  after: z.string().max(256).optional(),
  before: z.string().max(256).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  include: z.enum(["content"]).optional(),
  images: z.enum(["original", "proxy"]).default("original"),
});

type Row = ReturnType<typeof listItemsForUser>[number];

/** Rows ready for a native client: images served by this server where it keeps copies. */
function prepare(rows: Row[], req: Request, images: "original" | "proxy"): Row[] {
  const archived = withArchivedImages(rows, origin(req), API_BASE);
  return images === "proxy" ? withProxiedImages(archived, origin(req), API_BASE) : archived;
}

const searchQuery = z.object({
  q: z.string().trim().min(1).max(200),
  subscriptionId: z.coerce.number().int().positive().optional(),
  folderId: z.coerce.number().int().positive().optional(),
  unread: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
  saved: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
  include: z.enum(["content"]).optional(),
  images: z.enum(["original", "proxy"]).default("proxy"),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).default(0),
  sort: z.enum(["relevance", "date"]).default("relevance"),
});

resourcesRouter.get("/search", requireCapability("search.fts"), (req, res) => {
  const parsed = searchQuery.safeParse(req.query);
  if (!parsed.success) return invalid(res, parsed.error.flatten());
  const query = parsed.data;
  const withContent = query.include === "content";
  const limit = withContent ? Math.min(query.limit, 50) : query.limit;

  const { items: rows, total } = searchItemsForUser(req.user!.id, {
    query: query.q,
    feedId: query.subscriptionId,
    folderId: query.folderId,
    unreadOnly: query.unread,
    bookmarkedOnly: query.saved,
    sort: query.sort,
    limit,
    offset: query.offset,
  });

  const progress = readingPositions(req.user!.id, rows.map((row) => row.id));
  const hasNotes = itemsWithNotes(req.user!.id, rows.map((row) => row.id));

  res.json({
    query: query.q,
    total,
    items: prepare(rows, req, query.images).map((row) => serializeItem(row, progress, withContent, hasNotes.has(row.id))),
  });
});

resourcesRouter.get("/items", (req, res) => {
  const parsed = itemsQuery.safeParse(req.query);
  if (!parsed.success) return invalid(res, parsed.error.flatten());
  const query = parsed.data;
  const withContent = query.include === "content";
  const limit = withContent ? Math.min(query.limit, 50) : query.limit;
  let rows: Row[];
  try {
    rows = listItemsForUser(req.user!.id, {
      feedId: query.subscriptionId,
      folderId: query.folderId,
      unreadOnly: query.unread,
      bookmarkedOnly: query.saved,
      search: query.q,
      publishedSince: query.since,
      publishedUntil: query.until,
      before: query.before ? decodeCursor(query.before) : undefined,
      after: query.after ? decodeCursor(query.after) : undefined,
      sortByAdded: true,
      limit: limit + 1,
    });
  } catch {
    return void res.status(400).json({ error: "invalid_cursor" });
  }
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const progress = readingPositions(req.user!.id, page.map((row) => row.id));
  const hasNotes = itemsWithNotes(req.user!.id, page.map((row) => row.id));
  res.json({
    items: prepare(page, req, query.images).map((row) => serializeItem(row, progress, withContent, hasNotes.has(row.id))),
    newestCursor: page[0] ? encodeCursor(page[0]) : null,
    nextCursor: hasMore && page.length ? encodeCursor(page[page.length - 1]) : null,
  });
});

// Several articles with all their content in one request, for storing offline copies.
resourcesRouter.get("/items/bundle", (req, res) => {
  const parsed = z.object({ ids: z.string().regex(/^\d+(,\d+){0,49}$/), images: z.enum(["original", "proxy"]).default("proxy") }).safeParse(req.query);
  if (!parsed.success) return invalid(res, "ids: up to 50 comma separated article ids");
  const ids = [...new Set(parsed.data.ids.split(",").map(Number))];
  const rows = ids.map((id) => findItemForUser(req.user!.id, id)).filter((row): row is NonNullable<typeof row> => Boolean(row));
  const progress = readingPositions(req.user!.id, rows.map((row) => row.id));
  const hasNotes = itemsWithNotes(req.user!.id, rows.map((row) => row.id));
  res.json({ items: prepare(rows, req, parsed.data.images).map((row) => serializeItem(row, progress, true, hasNotes.has(row.id))) });
});

// Explicit extraction side effect; read-only devices continue to consume the shared cache.
resourcesRouter.post("/items/prepare", requireCapability("fulltext"), async (req, res) => {
  const parsed = z.object({ ids: z.array(z.number().int().positive()).min(1).max(50) }).strict().safeParse(req.body);
  if (!parsed.success) return invalid(res);
  try {
    const queued = enqueueArticleContents(req.user!.id, parsed.data.ids);
    res.status(202).json({ queued });
  } catch (error) {
    const code = error instanceof Error ? error.message : "preparation_failed";
    res.status(code === "item_not_found" ? 404 : code === "capability_not_available" ? 403 : code === "queue_full" ? 503 : 500).json({ error: code });
  }
});

resourcesRouter.get("/items/:id", (req, res) => {
  const parsed = z.object({ images: z.enum(["original", "proxy"]).default("original") }).safeParse(req.query);
  const row = parsed.success ? findItemForUser(req.user!.id, Number(req.params.id)) : undefined;
  if (!parsed.success) return invalid(res);
  if (!row) return void res.status(404).json({ error: "item_not_found" });
  const progress = readingPositions(req.user!.id, [row.id]);
  const hasNotes = itemsWithNotes(req.user!.id, [row.id]);
  res.json(serializeItem(prepare([row], req, parsed.data.images)[0], progress, true, hasNotes.has(row.id)));
});

resourcesRouter.post("/items/:id/full-text", requireCapability("fulltext"), async (req, res) => {
  const id = Number(req.params.id);
  const result = await loadFullText(req.user!.id, id, { force: req.query.force === "true" });
  if (!result.ok) {
    return void res.status(FULL_TEXT_STATUS[result.error]).json({ error: result.error, ...(result.error === "capability_not_available" ? { capability: "fulltext" } : {}), ...(result.message ? { message: result.message } : {}) });
  }
  const row = findItemForUser(req.user!.id, id)!;
  const hasNotes = itemsWithNotes(req.user!.id, [id]);
  res.json(serializeItem(prepare([row], req, req.query.images === "proxy" ? "proxy" : "original")[0], readingPositions(req.user!.id, [id]), true, hasNotes.has(id)));
});

const readAllSchema = z.object({ subscriptionId: z.number().int().positive().optional(), folderId: z.number().int().positive().optional() });

resourcesRouter.post("/items/read-all", requireCapability("sync"), (req, res) => {
  const parsed = readAllSchema.safeParse(req.body ?? {});
  if (!parsed.success) return invalid(res, parsed.error.flatten());
  res.json({ marked: markAllRead(req.user!.id, { feedId: parsed.data.subscriptionId, folderId: parsed.data.folderId }) });
});

// ---- Article Notes --------------------------------------------------------

const noteSchema = z.object({
  content: z.string().max(100_000),
  expectedRevision: z.number().int().nonnegative().optional(),
});

resourcesRouter.get("/items/:id/note", (req, res) => {
  const id = Number(req.params.id);
  if (!canAccessItem(req.user!.id, id)) return void res.status(404).json({ error: "item_not_found" });
  const note = findItemNote(req.user!.id, id);
  if (!note) return void res.status(404).json({ error: "note_not_found", current: noteConflictState(req.user!.id, id) });
  res.json({
    itemId: note.item_id,
    content: note.content,
    revision: note.revision,
    createdAt: note.created_at,
    updatedAt: note.updated_at,
  });
});

resourcesRouter.put("/items/:id/note", requireCapability("notes"), (req, res) => {
  const id = Number(req.params.id);
  if (!canAccessItem(req.user!.id, id)) return void res.status(404).json({ error: "item_not_found" });
  const parsed = noteSchema.safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error.flatten());
  const result = setItemNote(req.user!.id, id, parsed.data.content, parsed.data.expectedRevision);
  if ("conflict" in result) {
    return void res.status(409).json({ error: "revision_conflict", current: result.conflict });
  }
  const n = result.note;
  res.json({
    itemId: n.item_id,
    content: n.content,
    revision: n.revision,
    createdAt: n.created_at,
    updatedAt: n.updated_at,
  });
});

resourcesRouter.delete("/items/:id/note", (req, res) => {
  const id = Number(req.params.id);
  if (!canAccessItem(req.user!.id, id)) return void res.status(404).json({ error: "item_not_found" });
  const parsed = z.object({ expectedRevision: z.number().int().nonnegative().optional() }).safeParse(req.body ?? {});
  if (!parsed.success) return invalid(res, parsed.error.flatten());
  const result = deleteItemNote(req.user!.id, id, parsed.data.expectedRevision);
  if ("conflict" in result) return void res.status(409).json({ error: "revision_conflict", current: result.conflict });
  res.status(204).end();
});

resourcesRouter.get("/items/:id/note.md", (req, res) => {
  const id = Number(req.params.id);
  if (!canAccessItem(req.user!.id, id)) return void res.status(404).json({ error: "item_not_found" });
  const note = findItemNote(req.user!.id, id);
  if (!note) return void res.status(404).json({ error: "note_not_found" });
  const item = findItemForUser(req.user!.id, id);
  const title = item?.title ?? `Article #${id}`;
  const url = item?.link ? `Source: ${item.link}\n\n` : "";
  const md = `# ${title}\n\n${url}${note.content}\n`;
  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  res.setHeader("Content-Disposition", `inline; filename="note-${id}.md"`);
  res.send(md);
});

resourcesRouter.get("/notes/export", (req, res) => {
  const notes = listNotesForUser(req.user!.id);
  const sections = notes.map((note) => {
    const title = note.item_title ?? `Article #${note.item_id}`;
    const link = note.item_link ? `- Link: ${note.item_link}\n` : "";
    const feed = note.feed_title ? `- Feed: ${note.feed_title}\n` : "";
    const updated = `- Updated: ${note.updated_at}\n`;
    return `## ${title}\n${link}${feed}${updated}\n${note.content}`;
  });
  const md = `# FeedKeeper Notes\n\nExported: ${new Date().toISOString()}\nTotal notes: ${notes.length}\n\n---\n\n${sections.join("\n\n---\n\n")}\n`;
  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="feedkeeper-notes.md"');
  res.send(md);
});

// ---- Curated Edition ("Deine Zeitung") ------------------------------------

function editionResponse(req: Request, edition: ServerEdition) {
  const rows = edition.itemIds
    .map((id) => findItemForUser(req.user!.id, id))
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
  const progress = readingPositions(req.user!.id, rows.map((r) => r.id));
  const hasNotes = itemsWithNotes(req.user!.id, rows.map((r) => r.id));
  const prepared = prepare(rows, req, "original");
  return {
    ...edition,
    items: prepared.map((row) => serializeItem(row, progress, false, hasNotes.has(row.id))),
  };
}

function nativeAction(res: import("express").Response, action: () => void) {
  res.setHeader("Cache-Control", "private, no-store");
  try { action(); } catch (error) {
    if (!(error instanceof NativeError)) throw error;
    res.status(error.status).json({ error: error.code, ...(error.current !== undefined ? { current: error.current } : {}) });
  }
}

resourcesRouter.get("/native-preferences", (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  res.json(getNativePreferences(req.user!.id));
});

resourcesRouter.patch("/native-preferences", requireCapability("sync"), (req, res) => {
  nativeAction(res, () => res.json(patchNativePreferences(req.user!.id, req.body)));
});

resourcesRouter.get("/edition", (req, res) => {
  nativeAction(res, () => {
    const edition = getEdition(req.user!.id);
    if (!edition) return void res.status(404).json({ error: "no_edition", current: getEditionState(req.user!.id) });
    res.json(editionResponse(req, edition));
  });
});

resourcesRouter.get("/edition/state", (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  res.json(getEditionState(req.user!.id));
});

resourcesRouter.get("/edition/candidates", requireCapability("editions"), (req, res) => {
  const parsed = z.object({ limit: z.coerce.number().int().min(1).max(200).default(100) }).safeParse(req.query);
  if (!parsed.success) return invalid(res);
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ preferences: getNativePreferences(req.user!.id), current: getEditionState(req.user!.id), candidates: editionCandidates(req.user!.id, new Date(), parsed.data.limit) });
});

resourcesRouter.post("/edition/generate", requireCapability("editions"), (req, res) => {
  const parsed = generateEditionSchema.safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error.flatten());
  nativeAction(res, () => {
    const edition = generateEdition(req.user!.id, parsed.data);
    if (!edition) return void res.status(404).json({ error: "no_edition", current: getEditionState(req.user!.id) });
    res.json(editionResponse(req, edition));
  });
});

resourcesRouter.delete("/edition", (req, res) => {
  const parsed = z.object({ expectedRevision: z.number().int().min(0).optional(), requestId: z.uuid().optional() }).strict().safeParse(req.body ?? {});
  if (!parsed.success) return invalid(res);
  nativeAction(res, () => {
    dismissEdition(req.user!.id, parsed.data);
    res.status(204).end();
  });
});

// ---- Universal Inbox ("Save to FeedKeeper") -------------------------------

const saveInboxSchema = z
  .object({
    url: z.string().url().optional(),
    title: z.string().max(500).optional(),
    contentHtml: z.string().optional(),
    textContent: z.string().optional(),
    note: z.string().max(20000).optional(),
  })
  .refine((data) => Boolean(data.url || data.contentHtml || data.textContent), {
    message: "At least one of url, contentHtml, or textContent must be provided",
  });

resourcesRouter.post("/inbox", requireCapability("inbox"), async (req, res) => {
  const parsed = saveInboxSchema.safeParse(req.body ?? {});
  if (!parsed.success) return invalid(res, parsed.error.flatten());

  try {
    const result = await saveToInbox(req.user!.id, parsed.data);
    const progress = readingPositions(req.user!.id, [result.itemId]);
    const prepared = prepare([result.item], req, "original");
    res.status(201).json(serializeItem(prepared[0], progress, true, result.hasNote));
  } catch (error) {
    if (error instanceof SsrfBlockedError) {
      return void res.status(400).json({ error: error.message });
    }
    throw error;
  }
});

resourcesRouter.delete("/inbox/:id", requireCapability("inbox"), (req, res) => {
  const id = Number(req.params.id);
  const deleted = deleteInboxItem(req.user!.id, id);
  if (!deleted) {
    return void res.status(404).json({ error: "item_not_found" });
  }
  res.status(204).end();
});

// ---- Images --------------------------------------------------------------

resourcesRouter.get("/items/:id/image", imageLimiter, async (req, res) => {
  const src = typeof req.query.src === "string" ? req.query.src : "";
  try {
    const image = await fetchItemImage(req.user!.id, Number(req.params.id), src);
    if (image === "forbidden") return void res.status(404).json({ error: "not_found" });
    if (image === "unsupported") return void res.status(415).json({ error: "unsupported_image" });
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.type(image.mime).send(image.buffer);
  } catch {
    res.status(502).json({ error: "image_unavailable" });
  }
});

resourcesRouter.get("/archive/images/:imageId", (req, res) => {
  const image = findArchivedImage(req.user!.id, Number(req.params.imageId));
  if (!image) return void res.status(404).json({ error: "not_found" });
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  res.type(image.mime).sendFile(image.path, (error) => {
    if (error && !res.headersSent) res.status(404).json({ error: "not_found" });
  });
});
