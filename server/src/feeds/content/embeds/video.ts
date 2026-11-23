import { PLAY_LABEL, PLAYER_TITLES } from "../patterns/play-labels/index.js";
import { OEMBED_PROVIDER_PLATFORMS } from "../patterns/oembed-providers.js";
import { type ContentRule, type ContentRoot, type NoiseStats, flat, linkParagraph, parseAddress, pruneEmpty } from "../shared.js";

const PLAY_SOURCE = /(?:^|[/_.-])play[-_]?(?:icon|button|btn)?\.(?:svg|png|webp|gif)(?:[?#]|$)/i;
const DURATION = /^\d{1,2}:\d{2}(:\d{2})?$/;
const PLAYER_BLOCK_LIMIT = 120;

function isPlayOverlay(image: Element): boolean {
  return PLAY_LABEL.test(flat(image.getAttribute("alt"))) || PLAY_SOURCE.test((image.getAttribute("src") ?? "").trim());
}

/** Direct video URL of the embeds that are common enough to be worth a link. Anything else is not turned into a link. */
export function embedTarget(source: string): { url: string; name: string } | null {
  const normalizedSource = source.trim().startsWith("//") ? `https:${source.trim()}` : source;
  const parsed = parseAddress(normalizedSource);
  if (!parsed) return null;
  const address = parsed;
  const host = address.hostname.replace(/^(?:www|m|mobile)\./, "");
  const segments = address.pathname.split("/").filter(Boolean);
  const path = `${address.pathname}${address.search}`;
  const providerMatches = (name: string) => OEMBED_PROVIDER_PLATFORMS.some(provider => provider.name === name && provider.host.test(host) && provider.post.test(path));
  if (providerMatches("YouTube") && /^youtube(-nocookie)?\.com$/.test(host) && segments[0] === "embed" && /^[\w-]{6,}$/.test(segments[1] ?? "")) {
    return { url: `https://www.youtube.com/watch?v=${segments[1]}`, name: "YouTube" };
  }
  if (providerMatches("YouTube") && /^(?:m\.)?youtube\.com$/.test(host) && segments[0] === "watch" && /^[\w-]{6,}$/.test(address.searchParams.get("v") ?? "")) {
    return { url: `https://www.youtube.com/watch?v=${address.searchParams.get("v")}`, name: "YouTube" };
  }
  if (providerMatches("YouTube") && host === "youtu.be" && /^[\w-]{6,}$/.test(segments[0] ?? "")) {
    return { url: `https://www.youtube.com/watch?v=${segments[0]}`, name: "YouTube" };
  }
  if (providerMatches("Vimeo") && host === "player.vimeo.com" && segments[0] === "video" && /^\d+$/.test(segments[1] ?? "")) {
    return { url: `https://vimeo.com/${segments[1]}`, name: "Vimeo" };
  }
  if (OEMBED_PROVIDER_PLATFORMS.some(provider => provider.name === "Dailymotion" && provider.host.test(host) && /^\/embed\/video\/[\w]+$/.test(address.pathname)) && host === "dailymotion.com" && segments[0] === "embed" && segments[1] === "video" && /^\w+$/.test(segments[2] ?? "")) {
    return { url: `https://www.dailymotion.com/video/${segments[2]}`, name: "Dailymotion" };
  }
  return null;
}

/** The name of the video site a watch-page address belongs to, for the labels of links that were saved without a title. */
function videoSiteName(source: string): string | null {
  const host = parseAddress(source)?.hostname.replace(/^(?:www|m)\./, "") ?? "";
  if (/^(?:youtube(?:-nocookie)?\.com|youtu\.be)$/.test(host)) return "YouTube";
  if (/^(?:player\.)?vimeo\.com$/.test(host)) return "Vimeo";
  if (/^dailymotion\.com$/.test(host)) return "Dailymotion";
  return null;
}

/**
 * Players need the publisher's script: a reader without it shows their play-button picture as a broken image and
 * leaves a dead block. What can be reached stays as one plain link to the video (`data-media="video"` tells a client
 * that the target is a video page); what cannot, because the player is a script-driven button without an address,
 * is left out. The video itself is never embedded here: that is for the client to decide.
 */
function resolveVideoPlayers(root: ContentRoot, stats: NoiseStats): { changed: boolean; links: Element[] } {
  const links: Element[] = [];
  let changed = false;
  const count = () => { stats["video"] = (stats["video"] ?? 0) + 1; changed = true; };

  for (const image of [...root.querySelectorAll("img")].filter(isPlayOverlay)) {
    if (!root.contains(image)) continue;
    const anchor = image.closest("a[href]");
    if (anchor) {
      const parent = anchor.parentNode;
      image.remove();
      const href = anchor.getAttribute("href");
      const scope = anchor.closest("p, div, figure, li") ?? anchor.parentElement;
      const twin = scope ? [...scope.querySelectorAll("a[href]")].find(other => other !== anchor && other.getAttribute("href") === href) : undefined;
      const label = flat(anchor.textContent);
      if (twin) {
        anchor.remove();
        pruneEmpty(parent);
        links.push(twin);
      } else {
        if (label === "" || DURATION.test(label)) anchor.textContent = flat(anchor.getAttribute("title")) || "Video";
        links.push(anchor);
      }
      count();
      continue;
    }
    // The player block is the widest wrapper that holds nothing but the label, the picture and no link to follow.
    let block: Element = image;
    while (block.parentElement) {
      const parent: Element = block.parentElement;
      if (flat(parent.textContent).length > PLAYER_BLOCK_LIMIT || parent.querySelector("a[href]") || parent.querySelectorAll("img").length > 1) break;
      block = parent;
    }
    const parent = block.parentNode;
    block.remove();
    pruneEmpty(parent);
    count();
  }

  for (const frame of [...root.querySelectorAll("iframe")]) {
    const target = embedTarget(frame.getAttribute("src") ?? frame.getAttribute("data-src") ?? "");
    if (!target) continue;
    const parent = frame.parentNode;
    const title = flat(frame.getAttribute("title"));
    const replacement = linkParagraph(frame.ownerDocument, target.url, title && !PLAYER_TITLES.some(pattern => pattern.test(title)) ? title : target.name);
    frame.replaceWith(replacement);
    pruneEmpty(parent);
    links.push(replacement.querySelector("a") as Element);
    count();
  }

  for (const video of [...root.querySelectorAll("video")]) {
    const source = (video.getAttribute("src") ?? video.querySelector("source[src]")?.getAttribute("src") ?? "").trim();
    if (!/^https?:\/\//i.test(source)) continue;
    const replacement = linkParagraph(video.ownerDocument, source, flat(video.getAttribute("title")) || "Video");
    video.replaceWith(replacement);
    links.push(replacement.querySelector("a") as Element);
    count();
  }
  return { changed, links };
}

/** Players and video embeds of the common video sites become one link to the video. */
export const videoPlayers: ContentRule = {
  name: "video-players",
  description: "Play-button pictures, players and video iframes become one marked link to the video page.",
  apply(root, stats) {
    const { changed, links } = resolveVideoPlayers(root, stats);
    links.forEach(link => link.setAttribute("data-media", "video"));
    // A video link already saved with the player's technical name as its label ("vimeo-player") shows the platform instead.
    let renamed = false;
    for (const link of root.querySelectorAll("a[data-media='video'][href]")) {
      const name = videoSiteName(link.getAttribute("href") ?? "");
      const label = flat(link.textContent);
      if (name && label && PLAYER_TITLES.some(pattern => pattern.test(label))) { link.textContent = name; renamed = true; }
    }
    return changed || renamed;
  },
};
