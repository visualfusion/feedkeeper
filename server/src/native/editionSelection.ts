import type { NativeSettings } from "./preferences.js";

export interface EditionCandidate {
  id: number;
  subscriptionId: number;
  folderId: number | null;
  sourceName?: string | null;
  folderName?: string | null;
  title: string | null;
  url: string | null;
  publishedAt: string;
  snippet: string | null;
  imageUrl: string | null;
  readingMinutes: number;
  previouslySelected: boolean;
  score: number;
}

/** Remove only known tracking parameters; meaningful query parameters remain distinct. */
export function canonicalArticleUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol)) return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key) || /^(fbclid|gclid|dclid|mc_cid|mc_eid)$/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  } catch { return null; }
}

function normalizedTitle(value: string | null): string {
  return (value ?? "").normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

const TITLE_STOPWORDS = new Set([
  // English
  "a", "an", "and", "are", "as", "at", "be", "been", "before", "after", "ahead", "about", "amid", "by", "for",
  "from", "has", "have", "had", "he", "her", "his", "in", "into", "is", "it", "its", "more", "new", "not", "of",
  "on", "or", "out", "over", "report", "reports", "said", "says", "she", "that", "the", "their", "them", "they",
  "this", "to", "up", "was", "were", "what", "when", "where", "which", "who", "why", "will", "with", "would",
  // German
  "aber", "als", "am", "an", "auch", "auf", "aus", "bei", "beim", "bis", "das", "dass", "dem", "den", "der", "des",
  "die", "ein", "eine", "einem", "einen", "einer", "eines", "er", "es", "für", "fur", "hat", "haben", "im", "in",
  "ist", "mit", "nach", "nicht", "noch", "nur", "oder", "sich", "sie", "sind", "so", "über", "uber", "um", "und",
  "uns", "unter", "vom", "von", "vor", "war", "was", "werden", "wie", "will", "wird", "wurde", "zu", "zum", "zur",
]);

function significantTitleWords(normalized: string): Set<string> {
  if (!normalized) return new Set();
  const tokens = normalized.split(" ").filter((word) => word.length >= 2 && !TITLE_STOPWORDS.has(word));
  return new Set(tokens);
}

interface PreparedCandidate {
  article: EditionCandidate;
  url: string | null;
  title: string;
  words: Set<string>;
  significant: Set<string>;
  published: number;
}

function duplicate(a: PreparedCandidate, b: PreparedCandidate): boolean {
  if (a.url && a.url === b.url) return true;
  if (a.title.length >= 25 && a.title === b.title) return true;
  if (Math.abs(a.published - b.published) > 48 * 3_600_000) return false;
  const words = a.words, otherWords = b.words;
  if (words.size >= 6 && otherWords.size >= 6) {
    const shared = [...words].filter((word) => otherWords.has(word)).length;
    if (shared / (words.size + otherWords.size - shared) >= 0.75) return true;
  }
  const sigA = a.significant, sigB = b.significant;
  const minSig = Math.min(sigA.size, sigB.size);
  const sameSource = a.article.subscriptionId === b.article.subscriptionId;
  if (sameSource && minSig >= 3) {
    const sharedSig = [...sigA].filter((word) => sigB.has(word)).length;
    if (sharedSig >= 3 || (sharedSig >= 2 && sharedSig / minSig >= 0.4)) return true;
  } else if (!sameSource && minSig >= 4) {
    const sharedSig = [...sigA].filter((word) => sigB.has(word)).length;
    if (sharedSig >= 4 || (sharedSig >= 3 && sharedSig / minSig >= 0.5)) return true;
  }
  return false;
}

/** Selection is deterministic and independent of images and device opening counters.
 * First favour new stories, then relax source caps to fill a small library fairly. */
export function selectEdition(candidates: EditionCandidate[], settings: NativeSettings): EditionCandidate[] {
  const chosen: EditionCandidate[] = [];
  const chosenKeys: PreparedCandidate[] = [];
  const chosenIds = new Set<number>();
  // Normalize URLs and Unicode once, not for every pair on every selection pass.
  const prepared = candidates.map((article): PreparedCandidate => {
    const title = normalizedTitle(article.title);
    return {
      article,
      title,
      words: new Set(title.split(" ")),
      significant: significantTitleWords(title),
      url: canonicalArticleUrl(article.url),
      published: Date.parse(article.publishedAt),
    };
  });
  const feeds = new Map<number, number>();
  const folders = new Map<number | null, number>();
  let minutes = 0;
  const distinctFolders = Math.max(1, new Set(candidates.map((item) => item.folderId)).size);
  const folderCap = Math.max(2, Math.ceil(settings.editionSize / distinctFolders * 1.5));
  // New stories precede repeats, including older background pieces within the seven-day window.
  for (const repeats of [false, true]) {
    for (const cap of [3, 6, 12, 24]) {
      while (chosen.length < settings.editionSize) {
        let best: PreparedCandidate | undefined;
        let bestScore = -Infinity;
        for (const candidate of prepared) {
          const item = candidate.article;
          if (item.previouslySelected !== repeats || chosenIds.has(item.id) ||
            (feeds.get(item.subscriptionId) ?? 0) >= cap ||
            (folders.get(item.folderId) ?? 0) >= Math.max(folderCap, cap) ||
            (settings.readingMinutes && minutes + item.readingMinutes > settings.readingMinutes && chosen.length > 0)) continue;
          const adjusted = item.score / (1 + (feeds.get(item.subscriptionId) ?? 0) * 0.7 + (folders.get(item.folderId) ?? 0) * 0.35);
          if (best && (adjusted < bestScore || (adjusted === bestScore &&
            (candidate.published < best.published || (candidate.published === best.published && item.id < best.article.id))))) continue;
          if (chosenKeys.some((selected) => duplicate(selected, candidate))) continue;
          best = candidate;
          bestScore = adjusted;
        }
        if (!best) break;
        const item = best.article;
        chosen.push(item);
        chosenKeys.push(best);
        chosenIds.add(item.id);
        minutes += item.readingMinutes;
        feeds.set(item.subscriptionId, (feeds.get(item.subscriptionId) ?? 0) + 1);
        folders.set(item.folderId, (folders.get(item.folderId) ?? 0) + 1);
      }
    }
  }
  return chosen;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
export function editionPeriod(now: Date, timeZone: string): { key: string; period: "morning" | "midday" | "evening" | "late" } {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
    if (formatters.size >= 100) formatters.clear();
    formatters.set(timeZone, formatter);
  }
  const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
  const hour = Number(parts.hour);
  const period = hour >= 5 && hour < 11 ? "morning" : hour >= 11 && hour < 17 ? "midday" : hour >= 17 && hour < 23 ? "evening" : "late";
  // The late issue spans midnight; use the preceding calendar date before 05:00.
  let day = `${parts.year}-${parts.month}-${parts.day}`;
  if (hour < 5) day = new Date(Date.parse(`${day}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  return { key: `${day}:${period}`, period };
}

/** Find the next actual boundary in the user's zone, including DST and fractional offsets. */
export function nextEditionBoundary(now: Date, timeZone: string): Date {
  const key = editionPeriod(now, timeZone).key;
  let low = Math.floor(now.getTime() / 60_000);
  let high = low + 60;
  while (editionPeriod(new Date(high * 60_000), timeZone).key === key) high += 60;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (editionPeriod(new Date(middle * 60_000), timeZone).key === key) low = middle;
    else high = middle;
  }
  return new Date(high * 60_000);
}
