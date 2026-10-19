import { canAccessItem } from "../feeds/repository.js";
import { db } from "../db/index.js";
import {
  listFoldersForUser,
  listMutedKeywords,
  listSubscriptionsForUser,
  type SubscribedFeed,
} from "../feeds/repository.js";
import { getEdition, getEditionState } from "../native/editions.js";
import { getNativePreferences } from "../native/preferences.js";

const TOMBSTONE_DAYS = 90;
const MAX_PAGE = 500;

export type ChangeEntity = "item_state" | "item_content" | "subscription" | "folder" | "muted_keyword" | "note" | "edition" | "native_preferences";

export interface Change {
  seq: number;
  entity: ChangeEntity;
  id: number;
  op: "upsert" | "delete";
  data?: Record<string, unknown>;
}

export function serializeSubscription(subscription: SubscribedFeed) {
  return {
    id: subscription.id,
    url: subscription.url,
    title: subscription.title,
    siteUrl: subscription.site_url,
    label: subscription.label,
    folderId: subscription.folder_id,
    position: subscription.position,
    pollIntervalMinutes: subscription.poll_interval_minutes,
    fullTextMode: subscription.full_text_mode,
    notify: Boolean(subscription.notify),
    badge: Boolean(subscription.badge),
    isInbox: Boolean(subscription.is_system_inbox),
    iconHash: subscription.icon_hash ?? null,
    iconUrl: subscription.icon_hash
      ? `/api/v1/subscriptions/${subscription.id}/icon?v=${subscription.icon_hash}`
      : `/api/v1/subscriptions/${subscription.id}/icon`,
  };
}

interface BatchItemStateRow {
  id: number;
  read: number;
  saved_at: string | null;
  progress: number | null;
}

interface BatchItemContentRow {
  id: number;
  is_empty_gallery: number;
  content_revision: number;
  source: "reader" | "feed" | "snippet";
  extraction_status: string;
  extraction_attempted_at: string | null;
  extraction_retry_at: string | null;
}

interface BatchNoteRow {
  item_id: number;
  content: string;
  revision: number;
  created_at: string;
  updated_at: string;
}

function loadItemStates(userId: number, itemIds: number[]): Map<number, Record<string, unknown>> {
  const result = new Map<number, Record<string, unknown>>();
  if (!itemIds.length) return result;
  const rows = db
    .prepare<[number, number, number, string], BatchItemStateRow>(
      `SELECT i.id,
              r.item_id IS NOT NULL AS read,
              b.created_at AS saved_at,
              p.position AS progress
       FROM items i
       LEFT JOIN item_reads r ON r.user_id = ? AND r.item_id = i.id
       LEFT JOIN item_bookmarks b ON b.user_id = ? AND b.item_id = i.id
       LEFT JOIN item_progress p ON p.user_id = ? AND p.item_id = i.id
       WHERE i.id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))`,
    )
    .all(userId, userId, userId, JSON.stringify(itemIds));
  for (const row of rows) {
    result.set(row.id, {
      read: Boolean(row.read),
      saved: row.saved_at !== null,
      savedAt: row.saved_at,
      progress: row.progress,
    });
  }
  return result;
}

function loadItemContents(userId: number, itemIds: number[]): Map<number, Record<string, unknown>> {
  const result = new Map<number, Record<string, unknown>>();
  if (!itemIds.length) return result;
  const rows = db
    .prepare<[string], BatchItemContentRow>(
      `SELECT i.id,
              i.content_revision,
              i.is_empty_gallery,
              CASE WHEN i.full_content_html IS NOT NULL AND i.full_content_html != '' THEN 'reader'
                   WHEN i.content_html IS NOT NULL AND i.content_html != '' THEN 'feed'
                   ELSE 'snippet' END AS source,
              i.extraction_status,
              i.extraction_attempted_at,
              i.extraction_retry_at
       FROM items i
       WHERE i.id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))`,
    )
    .all(JSON.stringify(itemIds));
  for (const row of rows) {
    if (!canAccessItem(userId, row.id)) continue;
    result.set(row.id, {
      revision: row.content_revision,
      source: row.source,
      status: row.extraction_status,
      attemptedAt: row.extraction_attempted_at,
      retryAt: row.extraction_retry_at,
      isEmptyGallery: Boolean(row.is_empty_gallery),
    });
  }
  return result;
}

/**
 * Add the data a user already had before the log existed. Everything that is in the log
 * keeps its place; the rest is appended, so a first sync with since=0 delivers the full state.
 */
export function ensureChangeLog(userId: number): void {
  if (db.prepare("SELECT 1 FROM sync_state WHERE user_id = ?").get(userId)) return;
  db.transaction(() => {
    db.prepare("INSERT OR IGNORE INTO sync_state (user_id) VALUES (?)").run(userId);
    let seq = db.prepare<[number], { seq: number }>("SELECT COALESCE(MAX(seq), 0) AS seq FROM changes WHERE user_id = ?").get(userId)!.seq;
    const add = db.prepare(
      `INSERT OR IGNORE INTO changes (user_id, entity, entity_id, op, seq, changed_at) VALUES (?, ?, ?, 'upsert', ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
    );
    const addAll = (entity: ChangeEntity, ids: number[]) => ids.forEach((id) => { if (add.run(userId, entity, id, seq + 1).changes) seq++; });
    addAll("subscription", listSubscriptionsForUser(userId).map((subscription) => subscription.id));
    addAll("folder", listFoldersForUser(userId).map((folder) => folder.id));
    addAll("muted_keyword", listMutedKeywords(userId).map((keyword) => keyword.id));
    const itemIds = db
      .prepare<[number, number, number], { item_id: number }>(
        `SELECT item_id FROM item_reads WHERE user_id = ?
         UNION SELECT item_id FROM item_bookmarks WHERE user_id = ?
         UNION SELECT item_id FROM item_progress WHERE user_id = ?`,
      )
      .all(userId, userId, userId)
      .map((row) => row.item_id);
    addAll("item_state", itemIds);
    const noteIds = db
      .prepare<[number], { item_id: number }>("SELECT item_id FROM item_notes WHERE user_id = ?")
      .all(userId)
      .map((row) => row.item_id);
    addAll("note", noteIds);
    if (db.prepare<[number], { user_id: number }>("SELECT user_id FROM editions WHERE user_id = ?").get(userId)) {
      addAll("edition", [1]);
    }
    if (getNativePreferences(userId).revision > 0) addAll("native_preferences", [1]);
  })();
}

export class ResyncRequired extends Error {
  constructor() {
    super("resync_required");
  }
}

export function currentSeq(userId: number): number {
  return db
    .prepare<[number, number], { seq: number }>(
      `SELECT MAX(
         COALESCE((SELECT MAX(seq) FROM changes WHERE user_id = ?), 0),
         COALESCE((SELECT MAX(last_seq, pruned_through) FROM sync_state WHERE user_id = ?), 0)
       ) AS seq`,
    )
    .get(userId, userId)!.seq;
}

/** Everything that changed after `since`, oldest first, with the current data of each object. */
export function listChanges(userId: number, since: number, limit = 200): { changes: Change[]; nextSeq: number; hasMore: boolean } {
  ensureChangeLog(userId);
  const state = db.prepare<[number], { pruned_through: number }>("SELECT pruned_through FROM sync_state WHERE user_id = ?").get(userId)!;
  // A client that is behind a forgotten deletion cannot know about it and has to start over.
  if (since > 0 && since < state.pruned_through) throw new ResyncRequired();
  // A position beyond the end of the log means the server was restored from an older backup.
  if (since > currentSeq(userId)) throw new ResyncRequired();

  const page = Math.min(Math.max(limit, 1), MAX_PAGE);
  const rows = db
    .prepare<[number, number, number], { entity: ChangeEntity; entity_id: number; op: "upsert" | "delete"; seq: number }>(
      "SELECT entity, entity_id, op, seq FROM changes WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT ?",
    )
    .all(userId, since, page + 1);
  const hasMore = rows.length > page;
  const slice = rows.slice(0, page);

  const hasUpsert = (entity: ChangeEntity) => slice.some((row) => row.entity === entity && row.op !== "delete");
  const subscriptions = hasUpsert("subscription")
    ? new Map(listSubscriptionsForUser(userId).map((subscription) => [subscription.id, subscription]))
    : new Map<number, SubscribedFeed>();
  const folders = hasUpsert("folder")
    ? new Map(listFoldersForUser(userId).map((folder) => [folder.id, folder]))
    : new Map<number, ReturnType<typeof listFoldersForUser>[number]>();
  const keywords = hasUpsert("muted_keyword")
    ? new Map(listMutedKeywords(userId).map((keyword) => [keyword.id, keyword]))
    : new Map<number, ReturnType<typeof listMutedKeywords>[number]>();

  const stateIds = [...new Set(slice.filter((row) => row.entity === "item_state" && row.op !== "delete").map((row) => row.entity_id))];
  const itemStates = loadItemStates(userId, stateIds);

  const contentIds = [...new Set(slice.filter((row) => row.entity === "item_content" && row.op !== "delete").map((row) => row.entity_id))];
  const itemContents = loadItemContents(userId, contentIds);

  const noteUpsertIds = [...new Set(slice.filter((row) => row.entity === "note" && row.op !== "delete").map((row) => row.entity_id))];
  const notes = new Map<number, BatchNoteRow>();
  if (noteUpsertIds.length) {
    const noteRows = db
      .prepare<[number, string], BatchNoteRow>(
        `SELECT n.item_id, n.content, COALESCE(r.revision, 1) AS revision, n.created_at, n.updated_at
         FROM item_notes n
         LEFT JOIN item_note_revisions r ON r.user_id = n.user_id AND r.item_id = n.item_id
         WHERE n.user_id = ? AND n.item_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))`,
      )
      .all(userId, JSON.stringify(noteUpsertIds));
    for (const note of noteRows) notes.set(note.item_id, note);
  }

  const noteDeleteIds = [...new Set(slice.filter((row) => row.entity === "note" && row.op === "delete").map((row) => row.entity_id))];
  const noteRevisions = new Map<number, number>();
  if (noteDeleteIds.length) {
    const revRows = db
      .prepare<[number, string], { item_id: number; revision: number }>(
        `SELECT item_id, revision FROM item_note_revisions
         WHERE user_id = ? AND item_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))`,
      )
      .all(userId, JSON.stringify(noteDeleteIds));
    for (const rev of revRows) noteRevisions.set(rev.item_id, rev.revision);
  }

  const changes = slice.map((row): Change => {
    const change: Change = { seq: row.seq, entity: row.entity, id: row.entity_id, op: row.op };
    if (row.entity === "edition") {
      const state = getEditionState(userId);
      const edition = getEdition(userId);
      return edition ? { ...change, op: "upsert", data: { ...edition } } :
        { ...change, op: "delete", data: { revision: state.revision, status: state.status } };
    }
    if (row.entity === "note" && row.op === "delete") {
      const revision = noteRevisions.get(row.entity_id);
      return revision !== undefined ? { ...change, data: { revision } } : change;
    }
    if (row.op === "delete") return change;
    let data: Record<string, unknown> | null | undefined;
    if (row.entity === "item_content") {
      data = itemContents.get(row.entity_id) ?? null;
    } else if (row.entity === "item_state") {
      data = itemStates.get(row.entity_id) ?? null;
    } else if (row.entity === "subscription") {
      const subscription = subscriptions.get(row.entity_id);
      data = subscription && serializeSubscription(subscription);
    } else if (row.entity === "folder") {
      const folder = folders.get(row.entity_id);
      data = folder && { name: folder.name, iconSymbol: folder.icon_symbol ?? null };
    } else if (row.entity === "muted_keyword") {
      const keyword = keywords.get(row.entity_id);
      data = keyword && { keyword: keyword.keyword };
    } else if (row.entity === "note") {
      const note = notes.get(row.entity_id);
      data = note && {
        itemId: note.item_id,
        content: note.content,
        revision: note.revision,
        createdAt: note.created_at,
        updatedAt: note.updated_at,
      };
    } else if (row.entity === "native_preferences") {
      data = { ...getNativePreferences(userId) };
    }
    // The object disappeared after it was logged (for example an article removed by retention).
    return data ? { ...change, data } : { ...change, op: "delete" };
  });

  return { changes, nextSeq: slice.length ? slice[slice.length - 1].seq : since, hasMore };
}

/** Forget deletions older than the tombstone window and objects that no longer exist. */
export function pruneChangeLog(): number {
  const cutoff = new Date(Date.now() - TOMBSTONE_DAYS * 86_400_000).toISOString();
  return db.transaction(() => {
    db.prepare(
      `UPDATE sync_state SET
         last_seq = MAX(last_seq, pruned_through, COALESCE(
           (SELECT MAX(seq) FROM changes WHERE changes.user_id = sync_state.user_id), 0)),
         pruned_through = MAX(pruned_through, COALESCE(
           (SELECT MAX(seq) FROM changes WHERE changes.user_id = sync_state.user_id AND op = 'delete' AND changed_at < ?), 0))`,
    ).run(cutoff);
    const old = db.prepare("DELETE FROM changes WHERE op = 'delete' AND changed_at < ?").run(cutoff).changes;
    const gone = db.prepare("DELETE FROM changes WHERE entity IN ('item_state', 'item_content') AND entity_id NOT IN (SELECT id FROM items)").run().changes;
    const goneNotes = db.prepare("DELETE FROM changes WHERE entity = 'note' AND entity_id NOT IN (SELECT id FROM items)").run().changes;
    db.prepare("DELETE FROM applied_mutations WHERE applied_at < ?").run(new Date(Date.now() - 30 * 86_400_000).toISOString());
    return old + gone + goneNotes;
  })();
}
