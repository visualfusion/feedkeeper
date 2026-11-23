import { MASTODON_EMBED_PATH, SOCIAL_PLATFORMS, SOCIAL_QUOTE, type SocialPlatform } from "../patterns/social-platforms.js";
import { type ContentRoot, type ContentRule, type NoiseStats, flat, linkParagraph, parseAddress, pruneEmpty } from "../shared.js";
export function socialPost(source: string): { platform: SocialPlatform; url: string } | null {
  const address = parseAddress(source.trim());
  if (!address || !/^https?:$/.test(address.protocol)) return null;
  const platform = SOCIAL_PLATFORMS.find(candidate => candidate.post.test(address.href));
  if (!platform) return null;
  const keepQuery = ["Facebook", "YouTube", "Spotify"].includes(platform.name);
  return { platform, url: address.origin + address.pathname.replace(/\/embed\/?$/, "/") + (keepQuery ? address.search : "") };
}
export function socialFrameTarget(source: string): { platform: SocialPlatform; url: string } | null {
  const address = parseAddress(source.trim()); if (!address) return null;
  const host = address.hostname.replace(/^www\./, "");
  const find = (name: string) => SOCIAL_PLATFORMS.find(platform => platform.name === name) as SocialPlatform;
  if (host === "platform.twitter.com" && address.searchParams.get("id")) return { platform: find("X"), url: "https://x.com/i/status/" + address.searchParams.get("id") };
  if (host === "tiktok.com" && /^\/embed\/(?:v\d\/)?(\d+)/.test(address.pathname)) return { platform: find("TikTok"), url: "https://www.tiktok.com/video/" + /(\d+)/.exec(address.pathname)?.[1] };
  if (host === "open.spotify.com") return socialPost(source.replace("/embed/", "/"));
  if (host === "w.soundcloud.com") { const inner = address.searchParams.get("url"); return inner ? socialPost(inner) : null; }
  if (host === "facebook.com" && /\/plugins\/(?:post|video)\.php$/.test(address.pathname)) { const inner = address.searchParams.get("href"); return inner ? socialPost(inner) : null; }
  if (MASTODON_EMBED_PATH.test(address.pathname) && /^https?:$/.test(address.protocol)) return { platform: { name: "Mastodon", host: /.*/, post: MASTODON_EMBED_PATH, kind: "social" }, url: address.origin + address.pathname.replace(/\/embed\/?$/, "") };
  return socialPost(source);
}
function excerpt(element: Element): string { const text = flat(element.querySelector("p")?.textContent ?? ""); return text.length > 160 ? text.slice(0, 157).trimEnd() + "…" : text; }
function resolveSocialEmbeds(root: ContentRoot, stats: NoiseStats): { changed: boolean; links: { link: Element; kind: string; source: string }[] } {
  const links: { link: Element; kind: string; source: string }[] = []; let changed = false;
  const count = () => { stats["social"] = (stats["social"] ?? 0) + 1; changed = true; };
  for (const quote of [...root.querySelectorAll(SOCIAL_QUOTE)]) {
    if (!root.contains(quote)) continue;
    const candidates = [quote.getAttribute("cite") ?? "", ...[...quote.querySelectorAll("a[href]")].map(anchor => anchor.getAttribute("href") ?? "")];
    const target = candidates.map(socialPost).filter((found): found is NonNullable<typeof found> => found !== null).pop();
    const parent = quote.parentNode;
    if (!target) { quote.remove(); pruneEmpty(parent); count(); continue; }
    const replacement = linkParagraph(quote.ownerDocument, target.url, excerpt(quote) || target.platform.name);
    quote.replaceWith(replacement); pruneEmpty(parent);
    links.push({ link: replacement.querySelector("a") as Element, kind: target.platform.kind, source: target.platform.name }); count();
  }
  for (const frame of [...root.querySelectorAll("iframe")]) {
    const target = socialFrameTarget(frame.getAttribute("src") ?? frame.getAttribute("data-src") ?? ""); if (!target) continue;
    const parent = frame.parentNode;
    const replacement = linkParagraph(frame.ownerDocument, target.url, flat(frame.getAttribute("title")) || target.platform.name);
    frame.replaceWith(replacement); pruneEmpty(parent);
    links.push({ link: replacement.querySelector("a") as Element, kind: target.platform.kind, source: target.platform.name }); count();
  }
  return { changed, links };
}
export const socialEmbeds: ContentRule = {
  name: "social-embeds", description: "Supported social posts and audio players become one marked link.",
  apply(root, stats) {
    const { changed, links } = resolveSocialEmbeds(root, stats);
    links.forEach(({ link, kind, source }) => { link.setAttribute("data-media", kind); link.setAttribute("data-source", source); });
    return changed;
  },
};
