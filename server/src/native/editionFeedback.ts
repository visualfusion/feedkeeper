import { db } from "../db/index.js";
import { canAccessItem } from "../feeds/repository.js";
import { normalizedTitle, significantTitleWords } from "./editionSelection.js";
import { NativeError } from "./requests.js";

const DECAY_HALF_LIFE_MS = 30 * 86_400_000;
const MIN_SIGNAL_WEIGHT = 0.35;
const MAX_PROFILE_ITEMS = 8;

export type EditionVoteValue = -1 | 0 | 1;

export interface EditionFeedbackState {
  votes: Record<string, -1 | 1>;
  totalCount: number;
}

export interface EditionFeedbackProfile {
  totalVotes: number;
  likedSources: string[];
  dislikedSources: string[];
  likedTopics: string[];
  dislikedTopics: string[];
}

interface FeedbackRow {
  item_id: number;
  feed_id: number;
  vote: -1 | 1;
  keywords_json: string;
  updated_at: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function decayedWeight(vote: -1 | 1, updatedAt: string, nowMs: number): number {
  const timestamp = Date.parse(updatedAt);
  if (!Number.isFinite(timestamp)) return vote;
  const ageMs = Math.max(0, nowMs - timestamp);
  return vote * Math.pow(0.5, ageMs / DECAY_HALF_LIFE_MS);
}

function parseKeywords(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  } catch {
    return [];
  }
}

export function extractFeedbackKeywords(title: string | null): string[] {
  return [...significantTitleWords(normalizedTitle(title))].slice(0, 16);
}

/**
 * Stores or clears an explicit reader vote (+1 / -1 / 0) for an article.
 * Feed and extracted title keywords are stored denormalized so retention cleanup preserves taste signals.
 */
export function setEditionFeedback(
  userId: number,
  itemId: number,
  vote: EditionVoteValue,
  now = new Date(),
): { itemId: number; vote: EditionVoteValue; totalCount: number } {
  if (vote === 0) {
    db.prepare("DELETE FROM edition_feedback WHERE user_id = ? AND item_id = ?").run(userId, itemId);
    const countRow = db.prepare<[number], { count: number }>(
      "SELECT COUNT(*) AS count FROM edition_feedback WHERE user_id = ?",
    ).get(userId);
    return { itemId, vote: 0, totalCount: countRow?.count ?? 0 };
  }

  if (!canAccessItem(userId, itemId)) {
    throw new NativeError("item_not_found", 404);
  }
  const item = db.prepare<[number], { feed_id: number; title: string | null }>(
    "SELECT feed_id, title FROM items WHERE id = ?",
  ).get(itemId);
  if (!item) {
    throw new NativeError("item_not_found", 404);
  }

  const keywords = extractFeedbackKeywords(item.title);
  const updatedAt = now.toISOString();
  db.prepare(
    `INSERT INTO edition_feedback (user_id, item_id, feed_id, vote, keywords_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, item_id) DO UPDATE SET
       feed_id = excluded.feed_id,
       vote = excluded.vote,
       keywords_json = excluded.keywords_json,
       updated_at = excluded.updated_at`,
  ).run(userId, itemId, item.feed_id, vote, JSON.stringify(keywords), updatedAt);

  const countRow = db.prepare<[number], { count: number }>(
    "SELECT COUNT(*) AS count FROM edition_feedback WHERE user_id = ?",
  ).get(userId);
  return { itemId, vote, totalCount: countRow?.count ?? 0 };
}

/** Returns stored votes for the given item IDs (or all recent votes if omitted) plus total feedback count. */
export function getEditionFeedback(userId: number, itemIds?: number[]): EditionFeedbackState {
  const totalCount = db.prepare<[number], { count: number }>(
    "SELECT COUNT(*) AS count FROM edition_feedback WHERE user_id = ?",
  ).get(userId)?.count ?? 0;

  let rows: { item_id: number; vote: -1 | 1 }[];
  if (itemIds && itemIds.length > 0) {
    const placeholders = itemIds.map(() => "?").join(", ");
    rows = db.prepare<(number | undefined)[], { item_id: number; vote: -1 | 1 }>(
      `SELECT item_id, vote FROM edition_feedback WHERE user_id = ? AND item_id IN (${placeholders})`,
    ).all(userId, ...itemIds);
  } else if (itemIds && itemIds.length === 0) {
    rows = [];
  } else {
    rows = db.prepare<[number], { item_id: number; vote: -1 | 1 }>(
      "SELECT item_id, vote FROM edition_feedback WHERE user_id = ? ORDER BY updated_at DESC LIMIT 200",
    ).all(userId);
  }

  const votes: Record<string, -1 | 1> = {};
  for (const row of rows) {
    votes[String(row.item_id)] = row.vote;
  }
  return { votes, totalCount };
}

export function resetEditionFeedback(userId: number): void {
  db.prepare("DELETE FROM edition_feedback WHERE user_id = ?").run(userId);
}

function aggregateSignals(userId: number, now = new Date()) {
  const rows = db.prepare<[number], FeedbackRow>(
    "SELECT item_id, feed_id, vote, keywords_json, updated_at FROM edition_feedback WHERE user_id = ? ORDER BY updated_at DESC LIMIT 500",
  ).all(userId);

  const nowMs = now.getTime();
  const sourceWeights = new Map<number, number>();
  const keywordWeights = new Map<string, number>();

  for (const row of rows) {
    const weight = decayedWeight(row.vote, row.updated_at, nowMs);
    sourceWeights.set(row.feed_id, (sourceWeights.get(row.feed_id) ?? 0) + weight);
    for (const keyword of parseKeywords(row.keywords_json)) {
      keywordWeights.set(keyword, (keywordWeights.get(keyword) ?? 0) + weight);
    }
  }

  return { totalVotes: rows.length, sourceWeights, keywordWeights };
}

/**
 * Builds a bounded scoring multiplier function for candidate articles based on past reader feedback.
 * Soft bounds prevent echo chambers: disliked sources/topics are damped rather than blocked.
 */
export function createEditionFeedbackScorer(
  userId: number,
  now = new Date(),
): (feedId: number, title: string | null) => number {
  const { totalVotes, sourceWeights, keywordWeights } = aggregateSignals(userId, now);
  if (totalVotes === 0) return () => 1;

  return (feedId: number, title: string | null) => {
    const sourceNet = sourceWeights.get(feedId) ?? 0;
    const sourceFactor = clamp(1 + sourceNet * 0.15, 0.55, 1.55);

    const keywords = extractFeedbackKeywords(title);
    let keywordNet = 0;
    for (const keyword of keywords) {
      keywordNet += keywordWeights.get(keyword) ?? 0;
    }
    const keywordFactor = clamp(1 + keywordNet * 0.18, 0.65, 1.45);
    return clamp(sourceFactor * keywordFactor, 0.45, 1.85);
  };
}

/** Summarizes reader feedback signals for external MCP curators and FeedKeeper Cloud. */
export function getFeedbackProfile(userId: number, now = new Date()): EditionFeedbackProfile {
  const { totalVotes, sourceWeights, keywordWeights } = aggregateSignals(userId, now);
  if (totalVotes === 0) {
    return { totalVotes: 0, likedSources: [], dislikedSources: [], likedTopics: [], dislikedTopics: [] };
  }

  const sourceNames = new Map<number, string>();
  const feedIds = [...sourceWeights.keys()];
  if (feedIds.length > 0) {
    const placeholders = feedIds.map(() => "?").join(", ");
    const rows = db.prepare<(number | undefined)[], { id: number; label: string | null; title: string | null }>(
      `SELECT f.id, NULLIF(TRIM(s.label), '') AS label, f.title
       FROM feeds f
       LEFT JOIN subscriptions s ON s.feed_id = f.id AND s.user_id = ?
       WHERE f.id IN (${placeholders})`,
    ).all(userId, ...feedIds);
    for (const row of rows) {
      const name = row.label ?? row.title;
      if (name) sourceNames.set(row.id, name);
    }
  }

  const rankedSources = [...sourceWeights.entries()]
    .map(([feedId, weight]) => ({ name: sourceNames.get(feedId), weight }))
    .filter((entry): entry is { name: string; weight: number } => Boolean(entry.name));

  const likedSources = rankedSources
    .filter((entry) => entry.weight >= MIN_SIGNAL_WEIGHT)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, MAX_PROFILE_ITEMS)
    .map((entry) => entry.name);

  const dislikedSources = rankedSources
    .filter((entry) => entry.weight <= -MIN_SIGNAL_WEIGHT)
    .sort((a, b) => a.weight - b.weight)
    .slice(0, MAX_PROFILE_ITEMS)
    .map((entry) => entry.name);

  const rankedTopics = [...keywordWeights.entries()].filter(([, weight]) => Math.abs(weight) >= MIN_SIGNAL_WEIGHT);
  const likedTopics = rankedTopics
    .filter(([, weight]) => weight > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_PROFILE_ITEMS)
    .map(([keyword]) => keyword);

  const dislikedTopics = rankedTopics
    .filter(([, weight]) => weight < 0)
    .sort((a, b) => a[1] - b[1])
    .slice(0, MAX_PROFILE_ITEMS)
    .map(([keyword]) => keyword);

  return { totalVotes, likedSources, dislikedSources, likedTopics, dislikedTopics };
}
