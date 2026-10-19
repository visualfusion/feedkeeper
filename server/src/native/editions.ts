import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "../db/index.js";
import { canAccessItem } from "../feeds/repository.js";
import { decodeEntities } from "../feeds/text.js";
import { editionPeriod, selectEdition, type EditionCandidate } from "./editionSelection.js";
import { getNativePreferences } from "./preferences.js";
import { checkEditionLayout, editionLayoutSchema, type EditionLayout } from "./editionLayout.js";
import { NativeError, nativeRequest } from "./requests.js";
import { hasEditionText, type EditionContent } from "./editionContent.js";

export const overviewSchema = z.array(z.object({
  heading: z.string().trim().min(1).max(160),
  segments: z.array(z.object({
    text: z.string().min(1).max(1000),
    itemId: z.number().int().positive().optional(),
  }).strict()).min(1).max(20),
}).strict()).min(1).max(5).refine((blocks) =>
  blocks.reduce((sum, block) => sum + block.heading.length + block.segments.reduce((n, segment) => n + segment.text.length, 0), 0) <= 3000,
  "Overview text must not exceed 3000 characters");
export type EditionOverviewInput = z.infer<typeof overviewSchema>;
export type EditionOverview = (EditionOverviewInput[number] & { id: string })[];

export interface ServerEdition {
  id: string;
  revision: number;
  source: "curated";
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  period: "morning" | "midday" | "evening" | "late";
  title: string | null;
  summary: string | null;
  overview: EditionOverview | null;
  /** How the writer of the issue wants it set; null for unstructured issues. */
  layout: EditionLayout | null;
  preferencesRevision: number;
  itemIds: number[];
}
interface EditionRow {
  user_id: number;
  edition_id: string;
  revision: number;
  source: "automatic" | "curated";
  status: "active" | "expired" | "dismissed";
  created_at: string;
  updated_at: string;
  expires_at: string;
  period: string | null;
  title: string | null;
  summary: string | null;
  overview: string | null;
  layout: string | null;
  preferences_revision: number;
  item_ids: string;
}
export interface EditionState {
  revision: number;
  status: "none" | "active" | "expired" | "dismissed";
  edition: ServerEdition | null;
}

function storedEdition(userId: number): EditionRow | undefined {
  return db.prepare<[number], EditionRow>("SELECT * FROM editions WHERE user_id = ?").get(userId);
}
function serialize(row: EditionRow): ServerEdition {
  const prefs = getNativePreferences(row.user_id);
  return {
    id: row.edition_id, revision: row.revision, source: "curated",
    createdAt: row.created_at, updatedAt: row.updated_at, expiresAt: row.expires_at,
    period: (row.period?.split(":").pop() as ServerEdition["period"] | undefined) ?? editionPeriod(new Date(row.created_at), prefs.timeZone).period,
    title: row.title, summary: row.summary, overview: row.overview ? JSON.parse(row.overview) : null, layout: row.layout ? JSON.parse(row.layout) : null,
    preferencesRevision: row.preferences_revision,
    itemIds: JSON.parse(row.item_ids),
  };
}
export function getEditionState(userId: number, now = new Date()): EditionState {
  const row = storedEdition(userId);
  if (!row) return { revision: 0, status: "none", edition: null };
  if (row.source !== "curated") return { revision: row.revision, status: "expired", edition: null };
  const status = row.status === "active" && Date.parse(row.expires_at) <= now.getTime() ? "expired" : row.status;
  return { revision: row.revision, status, edition: status === "active" ? serialize(row) : null };
}
/** Expiry schedules the next publication; it does not take the last issue away from readers. */
export function getEdition(userId: number, _now = new Date()): ServerEdition | null {
  const row = storedEdition(userId);
  return row?.source === "curated" && row.status !== "dismissed" ? serialize(row) : null;
}
function checkRevision(userId: number, expectedRevision: number | undefined, now: Date): void {
  const current = getEditionState(userId, now);
  if (expectedRevision !== undefined && current.revision !== expectedRevision) throw new NativeError("revision_conflict", 409, current);
}
function writeEdition(userId: number, itemIds: number[], source: ServerEdition["source"], expiry: Date, now: Date, title: string | null = null, summary: string | null = null, overview: EditionOverviewInput | null = null, layout: EditionLayout | null = null): ServerEdition {
  const prefs = getNativePreferences(userId);
  const id = randomUUID();
  const revision = (storedEdition(userId)?.revision ?? 0) + 1;
  const created = now.toISOString();
  db.prepare(`INSERT INTO editions (user_id, edition_id, item_ids, revision, source, status, created_at, updated_at, expires_at, period, title, summary, preferences_revision, overview, layout)
    VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET edition_id = excluded.edition_id, item_ids = excluded.item_ids,
      revision = excluded.revision, source = excluded.source, status = 'active', created_at = excluded.created_at,
      updated_at = excluded.updated_at, expires_at = excluded.expires_at, period = excluded.period,
      title = excluded.title, summary = excluded.summary, preferences_revision = excluded.preferences_revision, overview = excluded.overview,
      layout = excluded.layout`)
    .run(userId, id, JSON.stringify(itemIds), revision, source, created, created, expiry.toISOString(), editionPeriod(now, prefs.timeZone).key, title, summary, prefs.revision, overview ? JSON.stringify(overview.map((block, index) => ({ id: `topic-${index + 1}`, ...block }))) : null, layout ? JSON.stringify(layout) : null);
  db.prepare("INSERT INTO edition_history (user_id, edition_id, item_ids, revision, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(userId, id, JSON.stringify(itemIds), revision, created);
  db.prepare(`DELETE FROM edition_history WHERE user_id = ? AND edition_id NOT IN
    (SELECT edition_id FROM edition_history WHERE user_id = ? ORDER BY revision DESC LIMIT 32)`)
    .run(userId, userId);
  return serialize(storedEdition(userId)!);
}

export const publishEditionFields = {
  itemIds: z.array(z.number().int().positive()).min(1).max(24),
  expiresAt: z.string().datetime({ offset: true }).optional(),
  durationHours: z.number().positive().max(168).optional(),
  expectedRevision: z.number().int().min(0).optional(),
  requestId: z.uuid().optional(),
  title: z.string().trim().min(1).max(200).optional(),
  summary: z.string().trim().min(1).max(2000).optional(),
  overview: overviewSchema.optional(),
  layout: editionLayoutSchema.optional(),
};
const publishSchema = z.object(publishEditionFields).strict().refine((input) => !(input.expiresAt && input.durationHours), "Use expiresAt or durationHours, not both");
export type PublishEditionInput = z.infer<typeof publishSchema>;

/** Legacy ensure requests read the latest publication; they never select or publish articles. */
export const ensureEditionSchema = z.object({
  requestId: z.uuid(),
  expectedRevision: z.number().int().min(0).optional(),
  force: z.boolean().default(false),
}).strict().refine((input) => !input.force || input.expectedRevision !== undefined, "force requires expectedRevision");

/** Curated publications obey the app's hard exclusions. Read/saved articles
 * may be selected deliberately by an agent, but foreign and muted items cannot be published. */
export function publishCuratedEdition(userId: number, input: PublishEditionInput, now = new Date()): ServerEdition {
  if (input.layout !== undefined && !editionLayoutSchema.safeParse(input.layout).success) throw new NativeError("invalid_layout");
  const parsed = publishSchema.safeParse(input);
  if (!parsed.success) throw new NativeError("invalid_input");
  const { requestId, ...data } = parsed.data;
  return nativeRequest(userId, requestId, "edition.publish", data, () => {
    checkRevision(userId, data.expectedRevision, now);
    if (new Set(data.itemIds).size !== data.itemIds.length) throw new NativeError("duplicate_item_ids");
    if (data.overview?.some((block) => !block.segments.some((segment) => segment.itemId !== undefined) ||
      block.segments.some((segment) => segment.itemId !== undefined && !data.itemIds.includes(segment.itemId)))) {
      throw new NativeError("invalid_overview_reference");
    }
    if (data.layout) checkEditionLayout(data.layout, data.itemIds, data.overview?.length ?? 0);
    const prefs = getNativePreferences(userId);
    for (const id of data.itemIds) {
      if (!canAccessItem(userId, id)) throw new NativeError("item_not_found", 404);
      const item = db.prepare<[number, number, number], EditionContent & { folder_id: number | null; subscribed: number; muted: number; is_empty_gallery: number }>(
        `SELECT s.folder_id, s.id IS NOT NULL AS subscribed, i.is_empty_gallery,
          i.title, i.content_snippet, i.content_html, i.full_content_html,
          EXISTS (SELECT 1 FROM user_muted_keywords m WHERE m.user_id = ? AND
            (instr(lower(coalesce(i.title, '')), lower(m.keyword)) > 0 OR instr(lower(coalesce(i.content_snippet, '')), lower(m.keyword)) > 0)) AS muted
         FROM items i LEFT JOIN subscriptions s ON s.feed_id = i.feed_id AND s.user_id = ? WHERE i.id = ?`,
      ).get(userId, userId, id)!;
      if (item.is_empty_gallery || !hasEditionText(item) || item.muted || (item.subscribed && (item.folder_id === null ? !prefs.showUnfiled : prefs.hiddenFolderIds.includes(item.folder_id)))) {
        throw new NativeError("item_excluded");
      }
    }
    const expiry = data.expiresAt ? new Date(data.expiresAt) : new Date(now.getTime() + (data.durationHours ?? 24) * 3_600_000);
    if (expiry.getTime() <= now.getTime() || expiry.getTime() > now.getTime() + 168 * 3_600_000) throw new NativeError("invalid_expiry");
    return writeEdition(userId, data.itemIds, "curated", expiry, now, data.title ?? null, data.summary ?? (data.overview?.map((block) => `${block.heading}: ${block.segments.map((segment) => segment.text).join("")}`).join("\n\n").slice(0, 2000).replace(/[\uD800-\uDBFF]$/, "") ?? null), data.overview ?? null, data.layout ?? null);
  }, now);
}

/** Compatibility entry point for existing internal callers. New agents supply a
 * request ID and expected revision to publishCuratedEdition. */
export function publishEdition(userId: number, itemIds: number[], expiresAt?: string | null): ServerEdition {
  return publishCuratedEdition(userId, { itemIds, ...(expiresAt ? { expiresAt } : {}) });
}

export function dismissEdition(userId: number, input: { expectedRevision?: number; requestId?: string } = {}, now = new Date()): EditionState {
  return nativeRequest(userId, input.requestId, "edition.dismiss", { expectedRevision: input.expectedRevision }, () => {
    checkRevision(userId, input.expectedRevision, now);
    const row = storedEdition(userId);
    if (row && row.status !== "dismissed") {
      db.prepare("UPDATE editions SET status = 'dismissed', revision = revision + 1, updated_at = ?, period = ? WHERE user_id = ?")
        .run(now.toISOString(), editionPeriod(now, getNativePreferences(userId).timeZone).key, userId);
    }
    return getEditionState(userId, now);
  }, now);
}
export function deleteEdition(userId: number): boolean {
  const existed = Boolean(getEdition(userId));
  dismissEdition(userId);
  return existed;
}

/** Bound candidate gathering before building a shortlist for an agent or the curator. */
const AUTOMATIC_EDITION_LIMIT = 4000;

/** How often each feed appeared in the editions of the last 72 hours, so a feed that was shown a lot waits its turn. */
function recentSourceUse(userId: number, itemIds: number[]): Map<number, number> {
  const use = new Map<number, number>();
  for (let start = 0; start < itemIds.length; start += 500) {
    const chunk = itemIds.slice(start, start + 500);
    const rows = db.prepare<unknown[], { feed_id: number }>(
      `SELECT i.feed_id FROM items i JOIN subscriptions s ON s.feed_id = i.feed_id AND s.user_id = ?
       WHERE i.id IN (${chunk.map(() => "?").join(",")})`,
    ).all(userId, ...chunk);
    for (const row of rows) use.set(row.feed_id, (use.get(row.feed_id) ?? 0) + 1);
  }
  return use;
}

/**
 * Takes candidates round by round, one per source: volume says nothing about relevance, so a feed with three
 * articles a week competes on equal terms with one that posts eighty. Sources that were shown less lately (and are
 * not yet in the head of the list) go first within a round; inside a source the better scored article goes first,
 * and an article offered before only after the new ones.
 */
export function takeFairly(rest: EditionCandidate[], head: EditionCandidate[], recentUse: Map<number, number>): EditionCandidate[] {
  const queues = new Map<number, EditionCandidate[]>();
  for (const item of [...rest].sort((a, b) =>
    Number(a.previouslySelected) - Number(b.previouslySelected) || b.score - a.score || b.id - a.id)) {
    const queue = queues.get(item.subscriptionId);
    if (queue) queue.push(item); else queues.set(item.subscriptionId, [item]);
  }
  const inHead = new Map<number, number>();
  for (const item of head) inHead.set(item.subscriptionId, (inHead.get(item.subscriptionId) ?? 0) + 1);
  const order = [...queues.keys()].sort((a, b) =>
    (inHead.get(a) ?? 0) - (inHead.get(b) ?? 0) || (recentUse.get(a) ?? 0) - (recentUse.get(b) ?? 0) ||
    queues.get(b)![0].score - queues.get(a)![0].score || a - b);
  const result: EditionCandidate[] = [];
  for (let round = 0; result.length < rest.length; round++) {
    for (const source of order) {
      const item = queues.get(source)![round];
      if (item) result.push(item);
    }
  }
  return result;
}

/**
 * A source may fill at most its fair share of the shortlist (the size divided by the number of sources), however
 * much it publishes; the surplus of busy feeds is left out instead of crowding out the rest. A shortlist that would
 * become too small to choose from is topped up in the same fair order, so no account ends up with an empty one.
 */
export function fairShortlist(head: EditionCandidate[], fairOrder: EditionCandidate[], limit: number, sources: number): EditionCandidate[] {
  const share = Math.max(2, Math.ceil(limit / Math.max(1, sources)));
  const used = new Map<number, number>();
  const kept: EditionCandidate[] = [];
  const surplus: EditionCandidate[] = [];
  for (const item of [...head, ...fairOrder]) {
    const count = used.get(item.subscriptionId) ?? 0;
    if (count < share) {
      used.set(item.subscriptionId, count + 1);
      kept.push(item);
    } else surplus.push(item);
  }
  const minimum = Math.min(limit, 24);
  return [...kept, ...surplus.slice(0, Math.max(0, minimum - kept.length))].slice(0, limit);
}

export function editionCandidates(userId: number, now = new Date(), limit = 200): EditionCandidate[] {
  const prefs = getNativePreferences(userId);
  const previousItemIds = db.prepare<[number, string], { item_ids: string }>(
    "SELECT item_ids FROM edition_history WHERE user_id = ? AND created_at >= ?",
  ).all(userId, new Date(now.getTime() - 72 * 3_600_000).toISOString()).flatMap((row) => JSON.parse(row.item_ids) as number[]);
  const previous = new Set(previousItemIds);
  // Fetch bounded candidates per source, so a busy feed cannot hide the others.
  const rows = db.prepare<[number, number, number, string, string], EditionContent & {
    id: number; feed_id: number; folder_id: number | null; title: string | null; link: string | null;
    content_snippet: string | null; image_url: string | null; published: string; content_chars: number; source_name: string | null; folder_name: string | null;
  }>(`SELECT r.id, r.feed_id, r.folder_id, r.title, r.link, r.content_snippet, r.image_url,
        r.source_name, r.folder_name, r.published, r.source_rank, full_item.content_html, full_item.full_content_html,
        length(coalesce(full_item.full_content_html, full_item.content_html, r.content_snippet, '')) AS content_chars
      FROM (
        SELECT i.id, i.feed_id, s.folder_id, i.title, i.link, i.content_snippet, i.image_url,
          coalesce(s.label, f.title) AS source_name, folders.name AS folder_name,
          strftime('%Y-%m-%dT%H:%M:%fZ', coalesce(julianday(i.published_at), julianday(i.created_at))) AS published,
          row_number() OVER (PARTITION BY i.feed_id ORDER BY coalesce(julianday(i.published_at), julianday(i.created_at)) DESC, i.id DESC) AS source_rank
        FROM items i JOIN subscriptions s ON s.feed_id = i.feed_id AND s.user_id = ?
        JOIN feeds f ON f.id = i.feed_id LEFT JOIN folders ON folders.id = s.folder_id
        WHERE i.is_empty_gallery = 0
          AND NOT EXISTS (SELECT 1 FROM item_reads r WHERE r.item_id = i.id AND r.user_id = ?)
          AND NOT EXISTS (SELECT 1 FROM user_muted_keywords m WHERE m.user_id = ? AND
            (instr(lower(coalesce(i.title, '')), lower(m.keyword)) > 0 OR instr(lower(coalesce(i.content_snippet, '')), lower(m.keyword)) > 0))
          AND coalesce(julianday(i.published_at), julianday(i.created_at)) BETWEEN julianday(?) AND julianday(?)
      ) r
      JOIN items full_item ON full_item.id = r.id
      WHERE r.source_rank <= 40 ORDER BY r.source_rank, r.published DESC, r.id DESC LIMIT 4000`)
    .all(userId, userId, userId, new Date(now.getTime() - 7 * 86_400_000).toISOString(), now.toISOString());
  const scored: EditionCandidate[] = rows.filter((row) =>
    (row.folder_id === null ? prefs.showUnfiled : !prefs.hiddenFolderIds.includes(row.folder_id)) && hasEditionText(row))
    .map((row) => ({
      id: row.id, sourceName: row.source_name, folderName: row.folder_name, subscriptionId: row.feed_id, folderId: row.folder_id,
      title: row.title, url: row.link, publishedAt: row.published, snippet: decodeEntities(row.content_snippet) ?? null, imageUrl: row.image_url,
      readingMinutes: Math.max(1, Math.ceil(row.content_chars / 1400)), previouslySelected: previous.has(row.id),
      score: Math.pow(0.5, Math.max(0, now.getTime() - Date.parse(row.published)) / (18 * 3_600_000)) *
        (row.folder_id !== null && prefs.preferredFolderIds.includes(row.folder_id) ? 1.4 : 1),
    }));
  // Candidate requests expose a shortlist in which every source has a fair chance, not only the busiest one.
  if (limit < AUTOMATIC_EDITION_LIMIT) {
    const sorted = selectEdition(scored, { ...prefs, editionSize: Math.min(limit, 24), readingMinutes: null });
    const selected = new Set(sorted.map((item) => item.id));
    const rest = scored.filter((item) => !selected.has(item.id));
    return fairShortlist(sorted, takeFairly(rest, sorted, recentSourceUse(userId, previousItemIds)), limit,
      new Set(scored.map((item) => item.subscriptionId)).size);
  }
  return scored.sort((a, b) => b.score - a.score || b.id - a.id);
}
