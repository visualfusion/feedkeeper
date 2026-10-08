import Parser from "rss-parser";
import { fetchFeed } from "./fetcher.js";
import { assertPublicHttpUrl } from "./ssrfGuard.js";
import { decodeEntities, plainTitle } from "./text.js";

const rssParser = new Parser();

export interface DiscoveredFeed {
  url: string;
  title: string | null;
  type: string;
}

// Common alternate feed types found in HTML <head>
const FEED_MIME_TYPES = [
  "application/rss+xml",
  "application/atom+xml",
  "text/xml",
  "application/xml",
];

const MAX_PROBES = 15;
const COMMON_PATHS = ["/feed", "/rss.xml", "/atom.xml", "/feed.xml", "/index.xml", "/rss", "/rss.php?feed=RSS2.0", "/rss.php?feed=ATOM1.0"];
// Feed-looking URLs anywhere in a page, including JSON embedded in attributes.
const FEED_URL_IN_TEXT = /https?:\/\/[^\s"'<>\\]+?(?:\.rss|\.atom|\/feed\/?|\/(?:rss|atom|feed)\.xml)(?=["'\s<>\\]|$)/gi;

function sameUrl(a: string, b: string): boolean {
  const normalize = (value: string) => {
    try {
      const url = new URL(value);
      url.hash = "";
      return url.toString().replace(/\/$/, "");
    } catch {
      return value;
    }
  };
  return normalize(a) === normalize(b);
}

async function parseFeedAt(url: string): Promise<{ feed: DiscoveredFeed | null; html: string | null; finalUrl: string }> {
  const fetched = await fetchFeed(url);
  const finalUrl = fetched.finalUrl || url;
  try {
    const parsed = await rssParser.parseString(fetched.body);
    if (parsed.items && (parsed.title || parsed.description || parsed.items.length > 0)) {
      return { feed: { url: finalUrl, title: plainTitle(parsed.title) ?? null, type: "application/rss+xml" }, html: null, finalUrl };
    }
  } catch {
    // Not a feed; the caller may look for feed links in the HTML instead.
  }
  return { feed: null, html: fetched.body, finalUrl };
}

/**
 * Keep only candidates that really are feeds. Sites sometimes announce their own
 * homepage as RSS, so self-references are dropped and every candidate is fetched.
 */
async function keepRealFeeds(candidates: DiscoveredFeed[], pageUrl: string): Promise<DiscoveredFeed[]> {
  const toProbe = candidates.filter((candidate) => !sameUrl(candidate.url, pageUrl)).slice(0, MAX_PROBES);
  const probed = await Promise.all(
    toProbe.map(async (candidate) => {
      try {
        const { feed } = await parseFeedAt(candidate.url);
        return feed ? { ...feed, title: candidate.title ?? feed.title } : null;
      } catch {
        return null;
      }
    }),
  );
  const seen = new Set<string>();
  return probed.filter((feed): feed is DiscoveredFeed => {
    if (!feed || seen.has(feed.url)) return false;
    seen.add(feed.url);
    return true;
  });
}

/**
 * Given a URL, determines if it is already a direct RSS/Atom feed
 * or if it is an HTML page that links to one or more feeds (auto-discovery).
 */
export async function discoverFeeds(inputUrl: string): Promise<DiscoveredFeed[]> {
  const validated = await assertPublicHttpUrl(inputUrl);
  const targetUrl = validated.toString();

  // 1. The URL is already a feed.
  const page = await parseFeedAt(targetUrl);
  if (page.feed) return [page.feed];
  if (!page.html) return [];

  // 2. Feeds announced or linked on the page.
  const fromPage = await keepRealFeeds(extractFeedsFromHtml(page.html, page.finalUrl), page.finalUrl);
  if (fromPage.length > 0) return fromPage;

  // 3. Common feed paths; some lead to an overview page that lists the site's feeds.
  for (const path of COMMON_PATHS) {
    try {
      const candidateUrl = new URL(path, page.finalUrl).toString();
      if (sameUrl(candidateUrl, targetUrl)) continue;
      const candidate = await parseFeedAt(candidateUrl);
      if (candidate.feed) return [candidate.feed];
      if (candidate.html && !sameUrl(candidate.finalUrl, page.finalUrl)) {
        const listed = await keepRealFeeds(extractFeedsFromHtml(candidate.html, candidate.finalUrl), candidate.finalUrl);
        if (listed.length > 0) return listed;
      }
    } catch {
      // Try the next path.
    }
  }

  return [];
}

/**
 * Collect feed candidates from an HTML page: `<link rel="alternate">` tags first,
 * then feed-like links, then feed URLs mentioned in the page text. Candidates are
 * unverified; discoverFeeds checks them before use.
 */
export function extractFeedsFromHtml(html: string, baseUrl: string): DiscoveredFeed[] {
  const results: DiscoveredFeed[] = [];
  const seenUrls = new Set<string>();
  const add = (href: string, title: string | null, type: string) => {
    try {
      const resolved = new URL(href, baseUrl).toString();
      if (!/^https?:/i.test(resolved) || seenUrls.has(resolved)) return;
      seenUrls.add(resolved);
      results.push({ url: resolved, title, type });
    } catch {
      // Invalid URL, skip.
    }
  };

  for (const match of html.matchAll(/<link\b([^>]*)\/?>/gi)) {
    const attrs = match[1];
    const rel = getAttr(attrs, "rel")?.toLowerCase();
    const type = getAttr(attrs, "type")?.toLowerCase();
    const href = getAttr(attrs, "href");
    const title = getAttr(attrs, "title");
    if (href && type && rel?.split(/\s+/).includes("alternate") && FEED_MIME_TYPES.includes(type)) {
      add(href, title ? decodeEntities(title.trim()) : null, type);
    }
  }

  for (const match of html.matchAll(/<a\b([^>]*href=["']([^"']+)["'][^>]*)>(.*?)<\/a>/gis)) {
    const href = match[2];
    if (href.endsWith("/feed") || href.endsWith(".rss") || href.endsWith(".xml") || href.includes("/rss/")) {
      add(href, decodeEntities(match[3].replace(/<[^>]+>/g, "").trim()) || null, "application/rss+xml");
    }
  }

  for (const match of decodeEntities(html).matchAll(FEED_URL_IN_TEXT)) {
    add(match[0], null, "application/rss+xml");
  }

  return results;
}

function getAttr(attrsStr: string, attrName: string): string | null {
  const regex = new RegExp(`\\b${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = regex.exec(attrsStr);
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? null;
}

