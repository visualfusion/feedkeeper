import Parser from "rss-parser";
import { normalizePublishedAt } from "./dates.js";
import { authorLine } from "./author.js";
import { unwrapRedirectLink } from "./redirectLinks.js";
import { decodeEntities, plainTitle } from "./text.js";

export type FeedMimeType = "application/rss+xml" | "application/feed+json";

export interface ParsedFeedItem {
  guid: string;
  title: string | undefined;
  link: string | undefined;
  contentSnippet: string | undefined;
  contentHtml: string | null;
  publishedAt: string | undefined;
  imageUrl: string | null;
  authors: Array<string | undefined>;
}

export interface ParsedFeed {
  mimeType: FeedMimeType;
  title: string | undefined;
  description: string | undefined;
  link: string | undefined;
  icons: string[];
  logos: string[];
  items: ParsedFeedItem[];
}

type CustomItem = Parser.Item & {
  mediaContent?: unknown;
  mediaThumbnail?: unknown;
  contentEncoded?: string;
  author?: string;
  "media:content"?: unknown;
  "media:thumbnail"?: unknown;
  "content:encoded"?: string;
};

type CustomFeed = Record<string, unknown> & {
  icon?: unknown;
  image?: { url?: unknown };
};

const xmlParser = new Parser<CustomFeed, CustomItem>({
  customFields: {
    feed: ["icon"],
    item: [
      ["media:content", "mediaContent", { keepArray: false }],
      ["media:thumbnail", "mediaThumbnail", { keepArray: false }],
      ["content:encoded", "contentEncoded", { keepArray: false }],
    ],
  },
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function mediaAttribute(value: unknown, key: "url" | "medium" | "type"): unknown {
  if (!isRecord(value)) return undefined;
  if (isRecord(value.$) && value.$[key] !== undefined) return value.$[key];
  return value[key];
}

function cleanImageUrl(url: string): string {
  return url.trim().replace(/&(?:#038|amp);/g, "&");
}

function isValidImageUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  if (host === "pixel.wp.com" || host.endsWith(".pixel.wp.com")) return false;
  const pathAndQuery = (parsed.pathname + parsed.search).toLowerCase();
  if (pathAndQuery.includes("/1x1") || pathAndQuery.includes("pixel") || pathAndQuery.includes("tracking") || pathAndQuery.includes("beacon")) {
    return false;
  }
  return true;
}

function firstHtmlImageUrl(html: unknown): string | null {
  if (typeof html !== "string" || !html.includes("<img")) return null;
  const match = html.match(/<img[^>]+src=["'](https?:\/\/[^"'\s>]+)["']/i);
  return match && isValidImageUrl(match[1]) ? cleanImageUrl(match[1]) : null;
}

function extractXmlImageUrl(item: CustomItem): string | null {
  // 1. media:content (Media RSS)
  const mediaContent = item.mediaContent ?? item["media:content"];
  if (mediaContent) {
    if (isValidImageUrl(mediaContent)) return cleanImageUrl(mediaContent);
    const url = mediaAttribute(mediaContent, "url");
    const medium = mediaAttribute(mediaContent, "medium");
    const type = mediaAttribute(mediaContent, "type");
    if (isValidImageUrl(url) && (medium === "image" || !medium || (typeof type === "string" && type.startsWith("image/")))) {
      return cleanImageUrl(url);
    }
  }

  // 2. media:thumbnail
  const mediaThumbnail = item.mediaThumbnail ?? item["media:thumbnail"];
  if (mediaThumbnail) {
    if (isValidImageUrl(mediaThumbnail)) return cleanImageUrl(mediaThumbnail);
    const url = mediaAttribute(mediaThumbnail, "url");
    if (isValidImageUrl(url)) return cleanImageUrl(url);
  }

  // 3. enclosure
  if (item.enclosure?.url) {
    const url = item.enclosure.url;
    const type = item.enclosure.type ?? "";
    if (type.startsWith("image/") || /\.(jpe?g|png|webp|gif|avif|svg)(\?.*)?$/i.test(url)) {
      if (isValidImageUrl(url)) return cleanImageUrl(url);
    }
  }

  // 4. First <img> tag in HTML content or summary
  return firstHtmlImageUrl(item.contentEncoded ?? item["content:encoded"] ?? item.content ?? item.summary ?? "");
}

function extractJsonFeedImageUrl(item: Record<string, unknown>, contentHtml: string | null): string | null {
  if (isValidImageUrl(item.image)) return cleanImageUrl(item.image);
  if (isValidImageUrl(item.banner_image)) return cleanImageUrl(item.banner_image);

  if (Array.isArray(item.attachments)) {
    for (const attachment of item.attachments) {
      if (!isRecord(attachment)) continue;
      const mimeType = typeof attachment.mime_type === "string" ? attachment.mime_type.toLowerCase() : "";
      if (mimeType.startsWith("image/") && isValidImageUrl(attachment.url)) {
        return cleanImageUrl(attachment.url);
      }
    }
  }

  return firstHtmlImageUrl(contentHtml);
}

function extractJsonFeedAuthors(item: Record<string, unknown>): Array<string | undefined> {
  if (Array.isArray(item.authors)) {
    return item.authors.map((entry) => (isRecord(entry) ? asNonEmptyString(entry.name) : undefined));
  }
  if (isRecord(item.author)) {
    return [asNonEmptyString(item.author.name)];
  }
  return [];
}

function pushRawUrl(raw: unknown, into: string[]): void {
  if (typeof raw !== "string") return;
  const trimmed = raw.trim();
  if (trimmed) into.push(trimmed);
}

export function resolveFeedIconUrls(
  parsed: Pick<ParsedFeed, "icons" | "logos">,
  baseUrl: string,
): { icons: string[]; logos: string[] } {
  const resolve = (raw: string): string | null => {
    try {
      const resolved = new URL(raw.trim(), baseUrl);
      return resolved.protocol === "https:" || resolved.protocol === "http:" ? resolved.toString() : null;
    } catch {
      return null;
    }
  };
  return {
    icons: parsed.icons.map(resolve).filter((url): url is string => url !== null),
    logos: parsed.logos.map(resolve).filter((url): url is string => url !== null),
  };
}

/**
 * What identifies an item: its guid, or else its link or title. A guid element without text (`<guid isPermaLink="false"/>`) is read as an
 * object, and one such entry must not make the whole feed unreadable.
 */
export function itemGuid(item: { guid?: unknown; link?: string; title?: string }): string {
  if (typeof item.guid === "string" && item.guid !== "") return item.guid;
  return item.link || item.title || crypto.randomUUID();
}

/** The article address: its link, or its guid when the feed gives only that and the guid is a web address. */
export function itemLink(item: { link?: string; guid?: string }): string | undefined {
  if (item.link) return unwrapRedirectLink(item.link);
  return item.guid && /^https?:\/\//i.test(item.guid) ? unwrapRedirectLink(item.guid) : undefined;
}

function parseJsonFeed(body: string): ParsedFeed {
  const raw: unknown = JSON.parse(body);
  if (!isRecord(raw)) throw new Error("Invalid JSON feed: expected object");
  if (typeof raw.version !== "string" || !/^https?:\/\/jsonfeed\.org\/version\/1(?:\.\d+)?$/i.test(raw.version.trim())) {
    throw new Error("Invalid JSON feed: unsupported or missing version");
  }
  if (!Array.isArray(raw.items)) {
    throw new Error("Invalid JSON feed: items must be an array");
  }

  const title = plainTitle(asNonEmptyString(raw.title));
  const description = asNonEmptyString(raw.description);
  if (!title && !description && raw.items.length === 0) {
    throw new Error("Invalid JSON feed: empty feed");
  }

  const icons: string[] = [];
  const logos: string[] = [];
  pushRawUrl(raw.favicon, icons);
  pushRawUrl(raw.icon, icons);
  pushRawUrl(raw.icon, logos);

  const items: ParsedFeedItem[] = [];
  for (const entry of raw.items) {
    if (!isRecord(entry)) continue;
    const rawId = typeof entry.id === "string" && entry.id !== "" ? entry.id : typeof entry.id === "number" ? String(entry.id) : undefined;
    const rawLink = asNonEmptyString(entry.url) ?? asNonEmptyString(entry.external_url);
    const link = itemLink({ link: rawLink, guid: rawId });
    const itemTitle = plainTitle(asNonEmptyString(entry.title));
    const contentHtml = asNonEmptyString(entry.content_html) ?? null;
    const snippetSource = asNonEmptyString(entry.summary) ?? asNonEmptyString(entry.content_text) ?? contentHtml ?? undefined;

    items.push({
      guid: itemGuid({ guid: rawId, link, title: itemTitle }),
      title: itemTitle,
      link,
      contentSnippet: decodeEntities(snippetSource) ?? undefined,
      contentHtml,
      publishedAt: normalizePublishedAt(asNonEmptyString(entry.date_published) ?? asNonEmptyString(entry.date_modified)) ?? undefined,
      imageUrl: extractJsonFeedImageUrl(entry, contentHtml),
      authors: extractJsonFeedAuthors(entry),
    });
  }

  return {
    mimeType: "application/feed+json",
    title,
    description,
    link: asNonEmptyString(raw.home_page_url),
    icons,
    logos,
    items,
  };
}

export async function parseFeedBody(body: string): Promise<ParsedFeed> {
  if (body.trimStart().startsWith("{")) {
    return parseJsonFeed(body);
  }

  const parsed = await xmlParser.parseString(body);
  const icons: string[] = [];
  const logos: string[] = [];
  if (typeof parsed.icon === "string" && parsed.icon.trim()) icons.push(parsed.icon.trim());
  if (typeof parsed.image?.url === "string" && parsed.image.url.trim()) logos.push(parsed.image.url.trim());

  return {
    mimeType: "application/rss+xml",
    title: plainTitle(parsed.title),
    description: asNonEmptyString(parsed.description),
    link: asNonEmptyString(parsed.link),
    icons,
    logos,
    items: parsed.items.map((item) => ({
      guid: itemGuid(item),
      title: plainTitle(item.title),
      link: itemLink(item),
      contentSnippet: decodeEntities(item.contentSnippet ?? item.content) ?? undefined,
      contentHtml: item.contentEncoded ?? item["content:encoded"] ?? item.content ?? null,
      publishedAt: normalizePublishedAt(item.isoDate ?? item.pubDate) ?? undefined,
      imageUrl: extractXmlImageUrl(item),
      authors: [item.creator, item.author],
    })),
  };
}

export function formatFeedAuthor(authors: Array<string | undefined>, feedTitle: string | null, feedUrl: string): string | null {
  return authorLine(authors, { title: feedTitle, url: feedUrl });
}
