// Nothing on the web is older than this, so an earlier date is a placeholder such as 1970-01-01.
const EARLIEST_PLAUSIBLE = Date.UTC(1991, 0, 1);
// Feeds may announce an article a little ahead of time or in another zone, but not by years.
const MAX_AHEAD_MS = 24 * 60 * 60 * 1000;

/**
 * The publish date of a feed entry as an ISO timestamp, or null when the feed gives none we can trust: missing,
 * not a date ("gestern", localised weekday names), a placeholder in the past or a date far in the future. Null makes
 * the app use the time it stored the article, so the article lists, ages and is cleaned up like any other.
 */
export function normalizePublishedAt(value: unknown, now: number = Date.now()): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  const time = Date.parse(text);
  if (!Number.isFinite(time) || time < EARLIEST_PLAUSIBLE || time > now + MAX_AHEAD_MS) return null;
  return new Date(time).toISOString();
}
