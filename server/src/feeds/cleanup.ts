import { existsSync, statSync } from "node:fs";
import cron from "node-cron";
import { db } from "../db/index.js";
import { config } from "../config.js";
import { removeUnusedFeeds } from "./repository.js";
import { pruneArchive } from "./archive.js";
import { pruneChangeLog } from "../sync/changeLog.js";

export interface RetentionSettings {
  retentionReadDays: number;
  retentionMaxDays: number;
  retentionMaxItemsPerFeed: number;
  autoCleanupEnabled: boolean;
}

export interface DatabaseStats {
  totalItems: number;
  readItems: number;
  feedsCount: number;
  oldestItemDate: string | null;
  databaseSizeBytes: number;
}

export interface CleanupResult {
  deletedReadItems: number;
  deletedOldItems: number;
  deletedPerFeedExcess: number;
  totalDeleted: number;
  sizeBefore: number;
  sizeAfter: number;
}

export function getDatabaseFileSizeBytes(): number {
  let size = 0;
  for (const path of [config.databasePath, `${config.databasePath}-wal`, `${config.databasePath}-shm`]) {
    if (existsSync(path)) {
      try {
        size += statSync(path).size;
      } catch {
        // ignore if concurrently removed
      }
    }
  }
  return size;
}

export function getDatabaseStats(): DatabaseStats {
  const totalItemsRow = db.prepare("SELECT COUNT(*) AS count FROM items").get() as { count: number };
  const readItemsRow = db.prepare("SELECT COUNT(DISTINCT item_id) AS count FROM item_reads").get() as { count: number };
  const feedsRow = db.prepare("SELECT COUNT(*) AS count FROM feeds").get() as { count: number };
  const oldestRow = db.prepare("SELECT MIN(COALESCE(published_at, created_at)) AS oldest FROM items").get() as { oldest: string | null };

  return {
    totalItems: totalItemsRow.count,
    readItems: readItemsRow.count,
    feedsCount: feedsRow.count,
    oldestItemDate: oldestRow.oldest,
    databaseSizeBytes: getDatabaseFileSizeBytes(),
  };
}

export function getRetentionSettings(): RetentionSettings {
  try {
    const rows = db.prepare<[], { key: string; value: string }>("SELECT key, value FROM system_settings").all();
    const map = new Map(rows.map((r) => [r.key, r.value]));

    return {
      retentionReadDays: Number(map.get("retention_read_days") ?? config.retentionReadDays),
      retentionMaxDays: Number(map.get("retention_max_days") ?? config.retentionMaxDays),
      retentionMaxItemsPerFeed: Number(map.get("retention_max_items_per_feed") ?? config.retentionMaxItemsPerFeed),
      autoCleanupEnabled: (map.get("auto_cleanup_enabled") ?? String(config.autoCleanupEnabled)) === "true",
    };
  } catch {
    return {
      retentionReadDays: config.retentionReadDays,
      retentionMaxDays: config.retentionMaxDays,
      retentionMaxItemsPerFeed: config.retentionMaxItemsPerFeed,
      autoCleanupEnabled: config.autoCleanupEnabled,
    };
  }
}

export function updateRetentionSettings(settings: Partial<RetentionSettings>): RetentionSettings {
  const updateStmt = db.prepare(
    `INSERT INTO system_settings (key, value, updated_at)
     VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  );

  const apply = db.transaction(() => {
    if (settings.retentionReadDays !== undefined) {
      updateStmt.run("retention_read_days", String(Math.max(0, settings.retentionReadDays)));
    }
    if (settings.retentionMaxDays !== undefined) {
      updateStmt.run("retention_max_days", String(Math.max(0, settings.retentionMaxDays)));
    }
    if (settings.retentionMaxItemsPerFeed !== undefined) {
      updateStmt.run("retention_max_items_per_feed", String(Math.max(0, settings.retentionMaxItemsPerFeed)));
    }
    if (settings.autoCleanupEnabled !== undefined) {
      updateStmt.run("auto_cleanup_enabled", String(settings.autoCleanupEnabled));
    }
  });

  apply();
  return getRetentionSettings();
}

export function runCleanup(custom?: Partial<RetentionSettings>): CleanupResult {
  const settings = {
    ...getRetentionSettings(),
    ...custom,
  };

  const sizeBefore = getDatabaseFileSizeBytes();
  let deletedReadItems = 0;
  let deletedOldItems = 0;
  let deletedPerFeedExcess = 0;

  // 1. Delete read items older than retentionReadDays (excluding bookmarked items and items with notes)
  if (settings.retentionReadDays > 0) {
    const res = db.prepare(
      `DELETE FROM items
       WHERE id IN (
         SELECT i.id
         FROM items i
         WHERE i.id NOT IN (SELECT item_id FROM item_bookmarks)
           AND i.id NOT IN (SELECT item_id FROM item_notes)
           AND i.feed_id NOT IN (SELECT id FROM feeds WHERE is_system_inbox = 1)
           AND i.id NOT IN (SELECT CAST(selected.value AS INTEGER) FROM editions e, json_each(e.item_ids) selected
             WHERE e.source = 'curated' AND e.status <> 'dismissed')
           AND i.id IN (SELECT item_id FROM item_reads)
           AND NOT EXISTS (
             SELECT 1 FROM subscriptions s
             WHERE s.feed_id = i.feed_id
               AND NOT EXISTS (SELECT 1 FROM item_reads r WHERE r.item_id = i.id AND r.user_id = s.user_id)
           )
           AND COALESCE(julianday(i.published_at), julianday(i.created_at)) <= julianday('now', '-' || ? || ' days')
       )`,
    ).run(settings.retentionReadDays);
    deletedReadItems = res.changes;
  }

  // 2. Delete all items older than retentionMaxDays (excluding bookmarked items and items with notes)
  if (settings.retentionMaxDays > 0) {
    const res = db.prepare(
      `DELETE FROM items
       WHERE id NOT IN (SELECT item_id FROM item_bookmarks)
         AND id NOT IN (SELECT item_id FROM item_notes)
         AND feed_id NOT IN (SELECT id FROM feeds WHERE is_system_inbox = 1)
         AND id NOT IN (SELECT CAST(selected.value AS INTEGER) FROM editions e, json_each(e.item_ids) selected
           WHERE e.source = 'curated' AND e.status <> 'dismissed')
         AND COALESCE(julianday(published_at), julianday(created_at)) <= julianday('now', '-' || ? || ' days')`,
    ).run(settings.retentionMaxDays);
    deletedOldItems = res.changes;
  }

  // 3. Delete items exceeding retentionMaxItemsPerFeed (excluding bookmarked items and items with notes)
  if (settings.retentionMaxItemsPerFeed > 0) {
    const res = db.prepare(
      `DELETE FROM items
       WHERE id NOT IN (SELECT item_id FROM item_bookmarks)
         AND id NOT IN (SELECT item_id FROM item_notes)
         AND feed_id NOT IN (SELECT id FROM feeds WHERE is_system_inbox = 1)
         AND id NOT IN (SELECT CAST(selected.value AS INTEGER) FROM editions e, json_each(e.item_ids) selected
           WHERE e.source = 'curated' AND e.status <> 'dismissed')
         AND id IN (
           SELECT id FROM (
             SELECT id, ROW_NUMBER() OVER (
               PARTITION BY feed_id
               ORDER BY COALESCE(julianday(published_at), julianday(created_at)) DESC, id DESC
             ) as rn
             FROM items
           )
           WHERE rn > ?
         )`,
    ).run(settings.retentionMaxItemsPerFeed);
    deletedPerFeedExcess = res.changes;
  }

  // Feeds kept only for saved articles go once nothing of them is saved anymore.
  removeUnusedFeeds();
  pruneArchive();
  pruneChangeLog();

  const totalDeleted = deletedReadItems + deletedOldItems + deletedPerFeedExcess;

  // Optimize query planning; rebuild storage only when this run freed substantial pages.
  db.exec("PRAGMA optimize;");
  if (totalDeleted > 0) {
    try {
      const freelist = (db.pragma("freelist_count", { simple: true }) as number) ?? 0;
      if (freelist > 500) {
        db.exec("VACUUM;");
      }
    } catch (err) {
      console.warn("[cleanup] VACUUM skipped or could not run:", err);
    }
  }

  const sizeAfter = getDatabaseFileSizeBytes();

  return {
    deletedReadItems,
    deletedOldItems,
    deletedPerFeedExcess,
    totalDeleted,
    sizeBefore,
    sizeAfter,
  };
}

export function startCleanupScheduler(): void {
  // Run daily at 03:00 AM server time
  cron.schedule("0 3 * * *", () => {
    const settings = getRetentionSettings();
    if (!settings.autoCleanupEnabled) {
      return;
    }

    try {
      console.log("[cleanup] running daily automated housekeeping...");
      const result = runCleanup(settings);
      console.log(
        `[cleanup] automated housekeeping complete: ${result.totalDeleted} items deleted (read: ${result.deletedReadItems}, max age: ${result.deletedOldItems}, feed cap: ${result.deletedPerFeedExcess}). Database size: ${(result.sizeBefore / 1024 / 1024).toFixed(2)} MB -> ${(result.sizeAfter / 1024 / 1024).toFixed(2)} MB`,
      );
    } catch (err) {
      console.error("[cleanup] error during automated housekeeping:", err);
    }
  });
}
