import { db } from "../db/index.js";

export interface MediaPositionEntry {
  positionSeconds: number;
  durationSeconds: number | null;
  completed: boolean;
  updatedAt: string;
}

interface MediaPositionRow {
  item_id: number;
  position_seconds: number;
  duration_seconds: number | null;
  completed: number;
  updated_at: string;
}

function toEntry(row: MediaPositionRow): MediaPositionEntry {
  return {
    positionSeconds: row.position_seconds,
    durationSeconds: row.duration_seconds,
    completed: Boolean(row.completed),
    updatedAt: row.updated_at,
  };
}

/** Loads per-user playback positions for a batch of item IDs. */
export function mediaPositions(userId: number, itemIds: number[]): Map<number, MediaPositionEntry> {
  if (itemIds.length === 0) return new Map();
  const rows = db
    .prepare(
      `SELECT item_id, position_seconds, duration_seconds, completed, updated_at
       FROM item_media_positions
       WHERE user_id = ? AND item_id IN (${itemIds.map(() => "?").join(",")})`,
    )
    .all(userId, ...itemIds) as MediaPositionRow[];
  return new Map(rows.map((row) => [row.item_id, toEntry(row)]));
}

/**
 * Stores a user's playback position for an item using last-write-wins timestamp resolution.
 * Reaching the end of an episode resets the saved position to 0 and marks it completed.
 */
export function upsertMediaPosition(
  userId: number,
  itemId: number,
  input: {
    positionSeconds: number;
    durationSeconds?: number | null;
    completed?: boolean;
    updatedAt?: string;
  },
): MediaPositionEntry {
  const duration = input.durationSeconds != null && Number.isFinite(input.durationSeconds) && input.durationSeconds > 0
    ? Math.round(input.durationSeconds)
    : null;
  const rawPos = Number.isFinite(input.positionSeconds) ? Math.max(0, Math.round(input.positionSeconds)) : 0;
  const completed = Boolean(input.completed) || (duration !== null && duration >= 15 && rawPos >= duration - 5);
  const storedPos = completed ? 0 : rawPos;

  const parsedTs = input.updatedAt ? Date.parse(input.updatedAt) : Number.NaN;
  const clientTs = Number.isFinite(parsedTs) ? new Date(parsedTs).toISOString() : new Date().toISOString();

  const existing = db
    .prepare(
      `SELECT item_id, position_seconds, duration_seconds, completed, updated_at
       FROM item_media_positions
       WHERE user_id = ? AND item_id = ?`,
    )
    .get(userId, itemId) as MediaPositionRow | undefined;

  if (existing && Date.parse(existing.updated_at) > Date.parse(clientTs)) {
    return toEntry(existing);
  }

  db.prepare(
    `INSERT INTO item_media_positions (user_id, item_id, position_seconds, duration_seconds, completed, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, item_id) DO UPDATE SET
       position_seconds = excluded.position_seconds,
       duration_seconds = COALESCE(excluded.duration_seconds, item_media_positions.duration_seconds),
       completed = excluded.completed,
       updated_at = excluded.updated_at`,
  ).run(userId, itemId, storedPos, duration, completed ? 1 : 0, clientTs);

  const saved = db
    .prepare(
      `SELECT item_id, position_seconds, duration_seconds, completed, updated_at
       FROM item_media_positions
       WHERE user_id = ? AND item_id = ?`,
    )
    .get(userId, itemId) as MediaPositionRow;
  return toEntry(saved);
}
