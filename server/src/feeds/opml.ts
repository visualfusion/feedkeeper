import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import { config } from "../config.js";
import {
  listSubscriptionsForUser,
  findFeedByUrl,
  createFeed,
  seedFeedMetadata,
  isUserSubscribed,
  subscribe,
  createFolder,
  type Feed,
  type SubscribedFeed,
} from "./repository.js";
import { SsrfBlockedError, normalizeUrlCandidate } from "./ssrfGuard.js";
import { assertPublicFeedUrl } from "./blockedHosts.js";
import { requestFeedPoll } from "./poller.js";
import { decodeEntities, plainTitle } from "./text.js";

export interface OpmlFeedItem {
  url: string;
  label?: string;
  title?: string;
  siteUrl?: string;
  folder?: string;
}

export interface OpmlImportResult {
  imported: number;
  skipped: number;
  failed: number;
  errors: Array<{ url: string; reason: string }>;
}

const MAX_FOLDER_NAME_LENGTH = 100;
const MAX_FEED_LABEL_LENGTH = 200;

function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&'"]/g, (char) => {
    switch (char) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case "'":
        return "&apos;";
      case '"':
        return "&quot;";
      default:
        return char;
    }
  });
}

function feedToOutlineXml(s: SubscribedFeed, indent = "    "): string {
  const text = escapeXml(s.label || s.title || s.url);
  const title = escapeXml(s.title || s.label || s.url);
  const xmlUrl = escapeXml(s.url);
  const htmlUrl = s.site_url ? ` htmlUrl="${escapeXml(s.site_url)}"` : "";
  return `${indent}<outline text="${text}" title="${title}" type="rss" xmlUrl="${xmlUrl}"${htmlUrl} />`;
}

/**
 * Generates standard OPML 2.0 XML representation of all subscribed feeds for a user.
 */
export function generateOpml(userId: number): string {
  const subscriptions = listSubscriptionsForUser(userId).filter((s) => !s.is_system_inbox);

  // Group feeds by folder
  const unfiled: SubscribedFeed[] = [];
  const folders = new Map<string, SubscribedFeed[]>();

  for (const sub of subscriptions) {
    if (sub.folder_name) {
      const list = folders.get(sub.folder_name) ?? [];
      list.push(sub);
      folders.set(sub.folder_name, list);
    } else {
      unfiled.push(sub);
    }
  }

  const sections: string[] = [];

  // Add folder outlines
  for (const [folderName, feeds] of folders.entries()) {
    const escapedName = escapeXml(folderName);
    const feedOutlines = feeds.map((f) => feedToOutlineXml(f, "      ")).join("\n");
    sections.push(`    <outline text="${escapedName}" title="${escapedName}">\n${feedOutlines}\n    </outline>`);
  }

  // Add unfiled feeds
  for (const sub of unfiled) {
    sections.push(feedToOutlineXml(sub, "    "));
  }

  const outlines = sections.join("\n");
  const now = new Date().toUTCString();

  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>FeedKeeper Subscriptions</title>
    <dateCreated>${now}</dateCreated>
  </head>
  <body>
${outlines}
  </body>
</opml>
`;
}

/**
 * Reads an attribute from a parsed XML node case-insensitively in priority order.
 */
function getAttr(record: Record<string, unknown>, ...names: string[]): string | undefined {
  const entries = Object.entries(record);
  for (const name of names) {
    const target = `@_${name.toLowerCase()}`;
    for (const [key, value] of entries) {
      if (key.toLowerCase() === target) {
        if (typeof value === "string") return value;
        if (typeof value === "number" || typeof value === "boolean") return String(value);
      }
    }
  }
  return undefined;
}

/**
 * Recursively extracts outline elements containing a feed URL from parsed OPML.
 * Nested subfolders are flattened to the top level so each subfolder becomes its own folder.
 */
function extractOutlines(node: unknown, items: OpmlFeedItem[] = [], currentFolder?: string): OpmlFeedItem[] {
  if (!node || typeof node !== "object") return items;

  if (Array.isArray(node)) {
    for (const item of node) {
      extractOutlines(item, items, currentFolder);
    }
    return items;
  }

  const record = node as Record<string, unknown>;
  const hasChildren = Boolean(record.outline);

  // Leaf outlines without xmlUrl may use url="..." in older OPML 1.0 exports.
  const rawXmlUrl = getAttr(record, "xmlUrl") ?? (!hasChildren ? getAttr(record, "url") : undefined);
  const rawText = getAttr(record, "text");
  const rawTitle = getAttr(record, "title");
  const rawHtmlUrl = getAttr(record, "htmlUrl");

  const label = plainTitle(rawText ?? rawTitle)?.slice(0, MAX_FEED_LABEL_LENGTH);
  const title = plainTitle(rawTitle ?? rawText)?.slice(0, MAX_FEED_LABEL_LENGTH);
  const siteUrl = rawHtmlUrl?.trim() ? decodeEntities(rawHtmlUrl.trim()) : undefined;

  let childFolder = currentFolder;

  if (rawXmlUrl && rawXmlUrl.trim()) {
    const url = decodeEntities(rawXmlUrl.trim());
    const item: OpmlFeedItem = { url, label, folder: currentFolder };
    if (title && title !== label) item.title = title;
    if (siteUrl) item.siteUrl = siteUrl;
    items.push(item);
  } else if (label && hasChildren) {
    childFolder = label.slice(0, MAX_FOLDER_NAME_LENGTH);
  }

  if (hasChildren) {
    extractOutlines(record.outline, items, childFolder);
  }

  return items;
}

export const MAX_OPML_FEEDS = 2000;

/**
 * Parses an OPML document string and returns a list of feed URLs and their labels.
 */
export function parseOpml(xmlContent: string): OpmlFeedItem[] {
  const cleanedXml = xmlContent.replace(/^\uFEFF/, "").trim();
  if (!cleanedXml) {
    throw new Error("invalid_opml_format");
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    trimValues: true,
  });

  const parsed = parser.parse(cleanedXml);
  if (!parsed || typeof parsed.opml !== "object" || parsed.opml === null || !("body" in parsed.opml)) {
    throw new Error("invalid_opml_format");
  }

  const body = parsed.opml.body;
  const outlineRoot = body && typeof body === "object" ? (body as Record<string, unknown>).outline : undefined;
  const feeds = extractOutlines(outlineRoot);
  if (feeds.length > MAX_OPML_FEEDS) {
    throw new Error("too_many_opml_feeds");
  }
  return feeds;
}

const urlSchema = z.string().url();

function normalizeOpmlUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (/^feeds?:https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/^feeds?:/i, "");
  }
  if (/^feeds?:\/\//i.test(trimmed)) {
    const rest = trimmed.replace(/^feeds?:\/\//i, "");
    return /^https?:\/\//i.test(rest) ? rest : `https://${rest}`;
  }
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  return trimmed;
}

function sanitizeHttpUrl(raw?: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed.startsWith("//") ? `https:${trimmed}` : trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function isUrlFallbackLabel(label: string | undefined, rawUrl: string, normalizedUrl: string): boolean {
  if (!label) return true;
  const trimmed = label.trim();
  if (!trimmed) return true;
  if (trimmed === rawUrl || trimmed === normalizedUrl) return true;
  try {
    return new URL(normalizeOpmlUrl(trimmed)).toString() === normalizedUrl;
  } catch {
    try {
      return new URL(normalizeUrlCandidate(trimmed)).toString() === normalizedUrl;
    } catch {
      return false;
    }
  }
}

/**
 * Imports feeds from an OPML document string for the given user.
 */
export async function importOpmlFeeds(userId: number, xmlContent: string): Promise<OpmlImportResult> {
  const feedItems = parseOpml(xmlContent);

  const result: OpmlImportResult = {
    imported: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  const feedsToPoll: Feed[] = [];
  const folderCache = new Map<string, number>();

  for (const item of feedItems) {
    if (!item.url) continue;

    const candidateUrl = normalizeOpmlUrl(item.url);
    const urlCheck = urlSchema.safeParse(candidateUrl);
    if (!urlCheck.success) {
      result.failed++;
      result.errors.push({ url: item.url, reason: "invalid_url_format" });
      continue;
    }

    let normalizedUrl: string;
    try {
      const validated = await assertPublicFeedUrl(candidateUrl);
      normalizedUrl = validated.toString();
    } catch (error) {
      result.failed++;
      const reason = error instanceof SsrfBlockedError ? error.message : "url_validation_failed";
      result.errors.push({ url: item.url, reason });
      continue;
    }

    try {
      let feed = findFeedByUrl(normalizedUrl);
      if (!feed) {
        feed = createFeed(normalizedUrl, Math.max(config.minPollIntervalMinutes, 15));
      }

      const rawTitle = item.title ?? item.label;
      const seedTitle = isUrlFallbackLabel(rawTitle, item.url, normalizedUrl) ? null : (rawTitle ?? null);
      const seedSiteUrl = sanitizeHttpUrl(item.siteUrl);
      seedFeedMetadata(feed.id, { title: seedTitle, siteUrl: seedSiteUrl });

      if (isUserSubscribed(userId, feed.id)) {
        result.skipped++;
        continue;
      }

      let folderId: number | null = null;
      const folderName = item.folder?.trim().slice(0, MAX_FOLDER_NAME_LENGTH);
      if (folderName) {
        if (folderCache.has(folderName)) {
          folderId = folderCache.get(folderName)!;
        } else {
          const folder = createFolder(userId, folderName);
          folderId = folder.id;
          folderCache.set(folderName, folder.id);
        }
      }

      const customLabel = isUrlFallbackLabel(item.label, item.url, normalizedUrl) ? null : (item.label ?? null);
      subscribe(userId, feed.id, customLabel, folderId);
      result.imported++;
      feedsToPoll.push(feed);
    } catch (error) {
      result.failed++;
      result.errors.push({
        url: item.url,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Durable admission only: no detached serial loop or Promise per imported feed.
  for (const feed of feedsToPoll) requestFeedPoll(feed);

  return result;
}
