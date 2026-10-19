import { fetchFeed } from "./fetcher.js";
import { decodeEntities } from "./text.js";

const ICON_RECHECK_MS = 7 * 24 * 60 * 60 * 1000;

function attribute(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match ? (match[1] ?? match[2] ?? match[3] ?? null) : null;
}

interface IconCandidate { url: string; vector: boolean; size: number }

function headLinks(html: string): string[] {
  const end = html.search(/<\/head>/i);
  return html.slice(0, end === -1 ? 200_000 : Math.min(end, 200_000)).match(/<link\b[^>]*>/gi) ?? [];
}

function httpUrl(href: string, baseUrl: string): string | null {
  try {
    const url = new URL(decodeEntities(href), baseUrl);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function candidate(href: string, baseUrl: string, sizes: string, type: string, touch = false): IconCandidate | null {
  const url = httpUrl(href, baseUrl);
  if (!url) return null;
  // Use the shortest edge of every declared size; a wide banner is not a large square icon.
  const dimensions = [...sizes.matchAll(/(\d+)x(\d+)/gi)].map((match) => Math.min(Number(match[1]), Number(match[2])));
  return {
    url,
    vector: type.toLowerCase() === "image/svg+xml" || /\.svg$/i.test(new URL(url).pathname),
    size: Math.max(0, ...dimensions) || (touch ? 180 : 0),
  };
}

function rankedUrls(candidates: IconCandidate[]): string[] {
  candidates.sort((a, b) => Number(b.vector) - Number(a.vector) || b.size - a.size);
  return [...new Set(candidates.map((icon) => icon.url))].slice(0, 16);
}

function declaredCandidates(html: string, baseUrl: string): IconCandidate[] {
  const candidates: IconCandidate[] = [];

  for (const tag of headLinks(html)) {
    const rel = attribute(tag, "rel")?.toLowerCase().split(/\s+/) ?? [];
    const href = attribute(tag, "href");
    if (!href || rel.includes("mask-icon")) continue;
    const touch = rel.includes("apple-touch-icon") || rel.includes("apple-touch-icon-precomposed");
    if (!touch && !rel.includes("icon")) continue;

    const icon = candidate(href, baseUrl, attribute(tag, "sizes") ?? "", attribute(tag, "type") ?? "", touch);
    if (icon) candidates.push(icon);
  }
  return candidates;
}

/** Prefer scalable artwork, then the largest declared raster icons, including touch icons. */
export function pickIconUrls(html: string, baseUrl: string): string[] {
  return rankedUrls(declaredCandidates(html, baseUrl));
}

export function pickIconUrl(html: string, baseUrl: string): string | null {
  return pickIconUrls(html, baseUrl)[0] ?? null;
}

export function iconCheckDue(checkedAt: string | null): boolean {
  return !checkedAt || Date.now() - Date.parse(checkedAt) > ICON_RECHECK_MS;
}

/** Include a linked web-app manifest, which often contains the site's highest-resolution icons. */
export async function discoverIconUrls(siteUrl: string, signal?: AbortSignal): Promise<string[]> {
  try {
    const page = await fetchFeed(siteUrl, { signal });
    const candidates = declaredCandidates(page.body, page.finalUrl);
    const manifestTag = headLinks(page.body).find((tag) => attribute(tag, "rel")?.toLowerCase().split(/\s+/).includes("manifest"));
    const href = manifestTag && attribute(manifestTag, "href");
    const manifestUrl = href && httpUrl(href, page.finalUrl);
    if (manifestUrl) {
      try {
        const manifest = await fetchFeed(manifestUrl, { signal });
        const data: unknown = JSON.parse(manifest.body);
        const icons = data && typeof data === "object" && "icons" in data ? data.icons : null;
        for (const entry of Array.isArray(icons) ? icons.slice(0, 32) : []) {
          if (!entry || typeof entry !== "object" || typeof entry.src !== "string") continue;
          const purpose = typeof entry.purpose === "string" ? entry.purpose.split(/\s+/) : ["any"];
          if (!purpose.includes("any") && !purpose.includes("maskable")) continue;
          const icon = candidate(entry.src, manifest.finalUrl, typeof entry.sizes === "string" ? entry.sizes : "", typeof entry.type === "string" ? entry.type : "");
          if (icon) candidates.push(icon);
        }
      } catch {
        // A missing or invalid manifest must not discard the page's own icons.
      }
    }
    return rankedUrls(candidates);
  } catch {
    return [];
  }
}
