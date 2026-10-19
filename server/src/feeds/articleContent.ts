import { createHash } from "node:crypto";
import { JSDOM } from "jsdom";
import type { Item } from "./repository.js";
import { decodeEntities } from "./text.js";
import { cleanReaderHtml, cleanSnippet, derivedText } from "./contentNoise.js";

/**
 * Plain publisher content, shared by readers, search consumers and MCP. Deliberately not cleaned: length decisions
 * (which text is the better copy, what retention keeps) must not depend on which phrases the rules know.
 */
export function articleText(html: string | null | undefined): string {
  if (!html) return "";
  const fragment = JSDOM.fragment(html);
  fragment.querySelectorAll("script, style, noscript, nav, footer").forEach(node => node.remove());
  fragment.querySelectorAll("p, div, br, li, h1, h2, h3, h4, blockquote").forEach(node => node.append(" "));
  return (fragment.textContent ?? "").replace(/\s+/g, " ").trim();
}

const READER_CACHE_LIMIT = 300;
const readerCache = new Map<string, string>();

/**
 * Article HTML as a reader shows it, without breadcrumbs, repeated headline and similar page chrome. Computed when
 * served and never stored, so the publisher's original stays intact and rule changes apply to old articles too.
 */
export function readerHtml(html: string | null | undefined, title?: string | null, author?: string | null): string | null {
  if (!html) return html ?? null;
  const key = createHash("sha1").update(title ?? "").update("\0").update(author ?? "").update("\0").update(html).digest("base64");
  const cached = readerCache.get(key);
  if (cached !== undefined) return cached;
  const cleaned = cleanReaderHtml(html, title, {}, author);
  if (readerCache.size >= READER_CACHE_LIMIT) readerCache.delete(readerCache.keys().next().value as string);
  readerCache.set(key, cleaned);
  return cleaned;
}

export function contentMetadata(item: Item) {
  const source = item.full_content_html ? "reader" : item.content_html ? "feed" : "snippet";
  return { revision: item.content_revision, source, status: item.extraction_status,
    attemptedAt: item.extraction_attempted_at, retryAt: item.extraction_retry_at, isEmptyGallery: Boolean(item.is_empty_gallery) };
}

export function sourceText(item: Item) {
  return `${decodeEntities(item.title) ?? ""}\n${derivedText(item.full_content_html || item.content_html, item.title) || cleanSnippet(decodeEntities(item.content_snippet), item.title) || ""}`.trim();
}

/** Prefer existing substantive publisher text over a shorter extracted teaser. */
export function improvesContent(item: Item, extracted: string): boolean {
  const candidate = articleText(extracted).length;
  const existing = articleText(item.full_content_html || item.content_html).length;
  return candidate >= 200 && candidate >= existing * 0.9;
}
