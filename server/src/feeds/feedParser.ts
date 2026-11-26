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
  enclosureUrl: string | null;
  enclosureType: string | null;
  enclosureDurationSeconds: number | null;
  chaptersUrl: string | null;
}

export type FeedKind = "article" | "audio" | "video";

export interface ParsedFeed {
  mimeType: FeedMimeType;
  title: string | undefined;
  description: string | undefined;
  link: string | undefined;
  icons: string[];
  logos: string[];
  artworkUrl?: string;
  items: ParsedFeedItem[];
}

type CustomItem = Parser.Item & {
  mediaContent?: unknown;
  mediaThumbnail?: unknown;
  mediaGroup?: unknown;
  rawLinks?: unknown;
  contentEncoded?: string;
  author?: string;
  itunesDuration?: unknown;
  itunesImage?: unknown;
  podcastChapters?: unknown;
  "media:content"?: unknown;
  "media:thumbnail"?: unknown;
  "media:group"?: unknown;
  "media:description"?: unknown;
  "content:encoded"?: string;
  "itunes:image"?: unknown;
  itunes?: { image?: unknown };
};

type CustomFeed = Record<string, unknown> & {
  icon?: unknown;
  image?: { url?: unknown };
};

const xmlParser = new Parser<CustomFeed, CustomItem>({
  customFields: {
    feed: ["icon", "itunes:image"],
    item: [
      ["link", "rawLinks", { keepArray: true }],
      ["media:content", "mediaContent", { keepArray: true }],
      ["media:thumbnail", "mediaThumbnail", { keepArray: false }],
      ["media:group", "mediaGroup", { keepArray: false }],
      ["content:encoded", "contentEncoded", { keepArray: false }],
      ["itunes:duration", "itunesDuration", { keepArray: false }],
      ["itunes:image", "itunesImage", { keepArray: false }],
      ["podcast:chapters", "podcastChapters", { keepArray: false }],
    ],
  },
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

const MIN_FEED_IMAGE_SIDE = 100;

function mediaAttribute(value: unknown, key: "url" | "medium" | "type" | "width" | "height" | "duration"): unknown {
  if (!isRecord(value)) return undefined;
  if (isRecord(value.$) && value.$[key] !== undefined) return value.$[key];
  return value[key];
}

function asHttpUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

const EXTENSION_MIME: Array<[RegExp, string]> = [
  [/\.mp3(\?.*)?$/i, "audio/mpeg"],
  [/\.m4a(\?.*)?$/i, "audio/mp4"],
  [/\.aac(\?.*)?$/i, "audio/aac"],
  [/\.(?:ogg|oga)(\?.*)?$/i, "audio/ogg"],
  [/\.opus(\?.*)?$/i, "audio/opus"],
  [/\.flac(\?.*)?$/i, "audio/flac"],
  [/\.wav(\?.*)?$/i, "audio/wav"],
  [/\.mp4(\?.*)?$/i, "video/mp4"],
  [/\.m4v(\?.*)?$/i, "video/x-m4v"],
  [/\.webm(\?.*)?$/i, "video/webm"],
  [/\.mov(\?.*)?$/i, "video/quicktime"],
];

function resolveMediaMime(rawType: unknown, url: string): string | null {
  if (typeof rawType === "string") {
    const normalized = rawType.toLowerCase().split(";")[0].trim();
    if (normalized === "application/ogg") return "audio/ogg";
    if (normalized.startsWith("audio/") || normalized.startsWith("video/")) return normalized;
  }
  for (const [pattern, mime] of EXTENSION_MIME) {
    if (pattern.test(url)) return mime;
  }
  return null;
}

export function parseDurationSeconds(raw: unknown): number | null {
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : null;
  }
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const value = Math.round(Number(trimmed));
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  const parts = trimmed.split(":");
  if (parts.length >= 2 && parts.length <= 3 && parts.every((part) => /^\d+$/.test(part))) {
    let total = 0;
    for (const part of parts) {
      total = total * 60 + Number(part);
    }
    return total > 0 ? total : null;
  }
  return null;
}

function extractXmlMedia(item: CustomItem): {
  enclosureUrl: string | null;
  enclosureType: string | null;
  enclosureDurationSeconds: number | null;
  chaptersUrl: string | null;
} {
  let enclosureUrl: string | null = null;
  let enclosureType: string | null = null;
  let mediaDuration: unknown = undefined;

  if (item.enclosure?.url) {
    const url = asHttpUrl(item.enclosure.url);
    const type = url ? resolveMediaMime(item.enclosure.type, url) : null;
    if (url && type) {
      enclosureUrl = url;
      enclosureType = type;
    }
  }

  if (!enclosureUrl && item.rawLinks) {
    for (const rawLink of asMediaEntries(item.rawLinks)) {
      if (!isRecord(rawLink) || !isRecord(rawLink.$)) continue;
      if (String(rawLink.$.rel ?? "").toLowerCase() !== "enclosure") continue;
      const url = asHttpUrl(rawLink.$.href);
      const type = url ? resolveMediaMime(rawLink.$.type, url) : null;
      if (url && type) {
        enclosureUrl = url;
        enclosureType = type;
        break;
      }
    }
  }

  const candidateMediaEntries: unknown[] = [];
  const directMedia = item.mediaContent ?? item["media:content"];
  if (directMedia) candidateMediaEntries.push(...asMediaEntries(directMedia));
  const mediaGroup = item.mediaGroup ?? item["media:group"];
  if (mediaGroup) {
    for (const group of asMediaEntries(mediaGroup)) {
      if (!isRecord(group)) continue;
      const grouped = group["media:content"] ?? group.mediaContent;
      if (grouped) candidateMediaEntries.push(...asMediaEntries(grouped));
    }
  }

  for (const entry of candidateMediaEntries) {
    if (mediaDuration === undefined) mediaDuration = mediaAttribute(entry, "duration");
    if (!enclosureUrl) {
      const url = asHttpUrl(mediaAttribute(entry, "url"));
      const type = url ? resolveMediaMime(mediaAttribute(entry, "type"), url) : null;
      if (url && type) {
        enclosureUrl = url;
        enclosureType = type;
        mediaDuration = mediaAttribute(entry, "duration") ?? mediaDuration;
      }
    }
  }

  const duration = parseDurationSeconds(item.itunesDuration ?? mediaDuration);
  const rawChaptersUrl = mediaAttribute(item.podcastChapters, "url");
  const rawChaptersType = mediaAttribute(item.podcastChapters, "type");
  const chaptersMime = typeof rawChaptersType === "string" ? rawChaptersType.toLowerCase().split(";")[0].trim() : "";
  const chaptersUrl =
    !chaptersMime || chaptersMime === "application/json+chapters" || chaptersMime === "application/json"
      ? asHttpUrl(rawChaptersUrl)
      : null;

  return {
    enclosureUrl,
    enclosureType,
    enclosureDurationSeconds: enclosureUrl ? duration : null,
    chaptersUrl: enclosureUrl ? chaptersUrl : null,
  };
}

function extractJsonFeedMedia(item: Record<string, unknown>): {
  enclosureUrl: string | null;
  enclosureType: string | null;
  enclosureDurationSeconds: number | null;
  chaptersUrl: string | null;
} {
  if (Array.isArray(item.attachments)) {
    for (const attachment of item.attachments) {
      if (!isRecord(attachment)) continue;
      const url = asHttpUrl(attachment.url);
      const type = url ? resolveMediaMime(attachment.mime_type, url) : null;
      if (url && type) {
        return {
          enclosureUrl: url,
          enclosureType: type,
          enclosureDurationSeconds: parseDurationSeconds(attachment.duration_in_seconds),
          chaptersUrl: null,
        };
      }
    }
  }
  return { enclosureUrl: null, enclosureType: null, enclosureDurationSeconds: null, chaptersUrl: null };
}

function asMediaEntries(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}

function parseDimension(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value !== "string") return null;
  const match = /^\s*(\d+(?:\.\d+)?)\s*(?:px)?\s*$/i.exec(value);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isTooSmallMedia(widthRaw: unknown, heightRaw: unknown): boolean {
  const width = parseDimension(widthRaw);
  const height = parseDimension(heightRaw);
  return (width !== null && width < MIN_FEED_IMAGE_SIDE) || (height !== null && height < MIN_FEED_IMAGE_SIDE);
}

function cleanImageUrl(url: string): string {
  return url.trim().replace(/&(?:#038|amp);/g, "&");
}

export function isAvatarImageUrl(url: string): boolean {
  try {
    const host = new URL(url.trim()).hostname.toLowerCase();
    return host === "avatars.githubusercontent.com" || host.endsWith(".avatars.githubusercontent.com");
  } catch {
    return false;
  }
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
  if (isAvatarImageUrl(url)) return false;
  const pathAndQuery = (parsed.pathname + parsed.search).toLowerCase();
  if (pathAndQuery.includes("/1x1") || pathAndQuery.includes("pixel") || pathAndQuery.includes("tracking") || pathAndQuery.includes("beacon")) {
    return false;
  }
  return true;
}

function htmlAttribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return match ? (match[1] ?? match[2] ?? match[3]) : undefined;
}

function firstHtmlImageUrl(html: unknown): string | null {
  if (typeof html !== "string" || !html.includes("<img")) return null;
  for (const [tag] of html.matchAll(/<img\b[^>]*>/gi)) {
    const src = htmlAttribute(tag, "src");
    if (!src) continue;
    const decodedSrc = decodeEntities(src);
    if (!isValidImageUrl(decodedSrc)) continue;
    if (isTooSmallMedia(htmlAttribute(tag, "width"), htmlAttribute(tag, "height"))) continue;
    const classes = htmlAttribute(tag, "class") ?? "";
    if (/\b(?:avatar|emoji|icon)\b/i.test(classes)) continue;
    return cleanImageUrl(decodedSrc);
  }
  return null;
}

type MediaSource = {
  mediaContent?: unknown;
  mediaThumbnail?: unknown;
  "media:content"?: unknown;
  "media:thumbnail"?: unknown;
};

function extractMediaImageUrl(source: MediaSource): string | null {
  // 1. media:content (Media RSS)
  const mediaContent = source.mediaContent ?? source["media:content"];
  if (mediaContent) {
    for (const entry of asMediaEntries(mediaContent)) {
      if (isValidImageUrl(entry)) return cleanImageUrl(entry);
      if (isTooSmallMedia(mediaAttribute(entry, "width"), mediaAttribute(entry, "height"))) continue;
      const url = mediaAttribute(entry, "url");
      const medium = mediaAttribute(entry, "medium");
      const type = mediaAttribute(entry, "type");
      const isImageType = typeof type === "string" && type.toLowerCase().startsWith("image/");
      const isNonImageType = typeof type === "string" && type.trim() !== "" && !isImageType;
      const isNonImageMedium = typeof medium === "string" && medium.trim() !== "" && medium.toLowerCase() !== "image";
      if (isNonImageType || isNonImageMedium) continue;
      if (isValidImageUrl(url) && (medium === "image" || !medium || isImageType)) {
        return cleanImageUrl(url);
      }
    }
  }

  // 2. media:thumbnail
  const mediaThumbnail = source.mediaThumbnail ?? source["media:thumbnail"];
  if (mediaThumbnail) {
    for (const entry of asMediaEntries(mediaThumbnail)) {
      if (isValidImageUrl(entry)) return cleanImageUrl(entry);
      if (isTooSmallMedia(mediaAttribute(entry, "width"), mediaAttribute(entry, "height"))) continue;
      const url = mediaAttribute(entry, "url");
      if (isValidImageUrl(url)) return cleanImageUrl(url);
    }
  }

  return null;
}

function extractXmlImageUrl(item: CustomItem): string | null {
  const direct = extractMediaImageUrl(item);
  if (direct) return direct;

  const mediaGroup = item.mediaGroup ?? item["media:group"];
  if (mediaGroup) {
    for (const group of asMediaEntries(mediaGroup)) {
      if (!isRecord(group)) continue;
      const grouped = extractMediaImageUrl(group as MediaSource);
      if (grouped) return grouped;
    }
  }

  // 3. itunes:image on episode level
  const itunesImage = item.itunesImage ?? item["itunes:image"];
  const itunesHref = isRecord(itunesImage)
    ? asNonEmptyString(isRecord(itunesImage.$) ? itunesImage.$.href : itunesImage.href)
    : asNonEmptyString(itunesImage);
  if (isValidImageUrl(itunesHref)) return cleanImageUrl(itunesHref);
  if (isRecord(item.itunes) && isValidImageUrl(item.itunes.image)) {
    return cleanImageUrl(item.itunes.image);
  }

  // 4. enclosure
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

    const media = extractJsonFeedMedia(entry);

    items.push({
      guid: itemGuid({ guid: rawId, link, title: itemTitle }),
      title: itemTitle,
      link,
      contentSnippet: decodeEntities(snippetSource) ?? undefined,
      contentHtml,
      publishedAt: normalizePublishedAt(asNonEmptyString(entry.date_published) ?? asNonEmptyString(entry.date_modified)) ?? undefined,
      imageUrl: extractJsonFeedImageUrl(entry, contentHtml),
      authors: extractJsonFeedAuthors(entry),
      ...media,
    });
  }

  return {
    mimeType: "application/feed+json",
    title,
    description,
    link: asNonEmptyString(raw.home_page_url),
    icons,
    logos,
    artworkUrl: logos[0] ?? icons[0],
    items,
  };
}

function extractXmlArtworkUrl(parsed: CustomFeed): string | undefined {
  const itunesImage = parsed["itunes:image"] ?? parsed.itunesImage;
  const href = isRecord(itunesImage)
    ? asNonEmptyString(isRecord(itunesImage.$) ? itunesImage.$.href : itunesImage.href)
    : asNonEmptyString(itunesImage);
  if (href && isValidImageUrl(href)) return href;
  if (isRecord(parsed.itunes) && typeof parsed.itunes.image === "string" && isValidImageUrl(parsed.itunes.image)) {
    return parsed.itunes.image.trim();
  }
  if (typeof parsed.image?.url === "string" && isValidImageUrl(parsed.image.url)) return parsed.image.url.trim();
  if (typeof parsed.icon === "string" && isValidImageUrl(parsed.icon)) return parsed.icon.trim();
  return undefined;
}

function asMediaText(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = asMediaText(entry);
      if (found) return found;
    }
    return undefined;
  }
  if (isRecord(value) && typeof value._ === "string") {
    return asNonEmptyString(value._) ?? undefined;
  }
  return asNonEmptyString(value) ?? undefined;
}

function extractXmlMediaDescription(item: CustomItem): string | undefined {
  const direct = asMediaText(item["media:description"]);
  if (direct) return direct;
  const mediaGroup = item.mediaGroup ?? item["media:group"];
  if (mediaGroup) {
    for (const group of asMediaEntries(mediaGroup)) {
      if (!isRecord(group)) continue;
      const grouped = asMediaText(group["media:description"] ?? group.mediaDescription);
      if (grouped) return grouped;
    }
  }
  return undefined;
}

function escapePlainDescriptionHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  return escaped
    .split(/\n{2,}/)
    .map((block) => `<p>${block.trim().replace(/\n/g, "<br>")}</p>`)
    .filter((block) => block !== "<p></p>")
    .join("");
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
  const artworkUrl = extractXmlArtworkUrl(parsed);
  if (artworkUrl && !logos.includes(artworkUrl)) logos.unshift(artworkUrl);

  return {
    mimeType: "application/rss+xml",
    title: plainTitle(parsed.title),
    description: decodeEntities(asNonEmptyString(parsed.description)) ?? undefined,
    link: asNonEmptyString(parsed.link),
    icons,
    logos,
    artworkUrl,
    items: parsed.items.map((item) => {
      const mediaDescription = extractXmlMediaDescription(item);
      const rawSnippet = item.contentSnippet ?? item.content ?? mediaDescription;
      const rawHtml = item.contentEncoded ?? item["content:encoded"] ?? item.content ?? null;
      return {
        guid: itemGuid(item),
        title: plainTitle(item.title),
        link: itemLink(item),
        contentSnippet: decodeEntities(rawSnippet) ?? undefined,
        contentHtml: rawHtml ?? (mediaDescription ? escapePlainDescriptionHtml(mediaDescription) : null),
        publishedAt: normalizePublishedAt(item.isoDate ?? item.pubDate) ?? undefined,
        imageUrl: extractXmlImageUrl(item),
        authors: [item.creator, item.author],
        ...extractXmlMedia(item),
      };
    }),
  };
}

function isYouTubeUrl(rawUrl: string | null | undefined): boolean {
  if (!rawUrl) return false;
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be";
  } catch {
    return false;
  }
}

/** Classifies a feed as `audio`, `video`, or `article` from its URL and recent items. */
export function detectFeedKind(
  feedUrl: string,
  items: Array<{ link?: string | null; enclosureUrl?: string | null; enclosureType?: string | null }>,
): FeedKind {
  if (isYouTubeUrl(feedUrl)) return "video";
  const sample = items.slice(0, 20);
  if (sample.length === 0) return "article";
  let audioCount = 0;
  let videoCount = 0;
  for (const item of sample) {
    if (item.enclosureType?.toLowerCase().startsWith("video/") || isYouTubeUrl(item.link)) {
      videoCount++;
    } else if (item.enclosureUrl) {
      audioCount++;
    }
  }
  if (videoCount > 0 && videoCount >= audioCount && videoCount * 2 >= sample.length) return "video";
  if (audioCount > 0 && audioCount * 2 >= sample.length) return "audio";
  return "article";
}

export function formatFeedAuthor(authors: Array<string | undefined>, feedTitle: string | null, feedUrl: string): string | null {
  return authorLine(authors, { title: feedTitle, url: feedUrl });
}
