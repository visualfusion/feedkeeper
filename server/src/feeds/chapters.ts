import { fetchFeed } from "./fetcher.js";
import { findItemForUser } from "./repository.js";

export interface PodcastChapter {
  startTime: number;
  title: string;
  url?: string;
  img?: string;
}

const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_LIMIT = 200;
const chaptersCache = new Map<string, { expiresAt: number; chapters: PodcastChapter[] }>();

function asHttpUrl(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  try {
    const parsed = new URL(raw.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function parsePodcastChapters(body: string): PodcastChapter[] {
  const parsed: unknown = JSON.parse(body);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return [];
  const rawChapters = (parsed as { chapters?: unknown }).chapters;
  if (!Array.isArray(rawChapters)) return [];

  const chapters: PodcastChapter[] = [];
  for (const entry of rawChapters) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    if (record.toc === false) continue;
    const startTime = typeof record.startTime === "number" && Number.isFinite(record.startTime) && record.startTime >= 0 ? record.startTime : null;
    const title = typeof record.title === "string" ? record.title.trim() : "";
    if (startTime === null || !title) continue;

    const url = asHttpUrl(record.url);
    const img = asHttpUrl(record.img);
    chapters.push({
      startTime,
      title,
      ...(url ? { url } : {}),
      ...(img ? { img } : {}),
    });
  }

  chapters.sort((a, b) => a.startTime - b.startTime);
  return chapters;
}

export async function loadItemChapters(
  userId: number,
  itemId: number,
): Promise<{ status: "ok"; chapters: PodcastChapter[] } | { status: "not_found" } | { status: "unavailable" }> {
  const item = findItemForUser(userId, itemId);
  if (!item) return { status: "not_found" };
  if (!item.chapters_url) return { status: "ok", chapters: [] };

  const cached = chaptersCache.get(item.chapters_url);
  if (cached && cached.expiresAt > Date.now()) {
    return { status: "ok", chapters: cached.chapters };
  }

  try {
    const fetched = await fetchFeed(item.chapters_url, { priority: "interactive" });
    const chapters = parsePodcastChapters(fetched.body);
    if (chaptersCache.size >= CACHE_LIMIT) {
      const oldest = chaptersCache.keys().next().value;
      if (oldest) chaptersCache.delete(oldest);
    }
    chaptersCache.set(item.chapters_url, { expiresAt: Date.now() + CACHE_TTL_MS, chapters });
    return { status: "ok", chapters };
  } catch {
    return { status: "unavailable" };
  }
}
