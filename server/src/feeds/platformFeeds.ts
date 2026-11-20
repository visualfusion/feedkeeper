/**
 * Some platforms never announce their feed on the page people paste, but the feed address follows a fixed pattern.
 * These rules turn such a page address into the candidates worth trying. A candidate is only used when it really is a feed.
 */

// Paths of medium.com that belong to the site, not to a writer or a publication.
const MEDIUM_RESERVED = new Set(["", "feed", "m", "me", "plans", "membership", "search", "tag", "topics", "about", "jobs", "policy", "creators", "new-story", "settings", "library", "notifications"]);

const GITHUB_RESERVED = new Set([
  "settings", "notifications", "explore", "topics", "trending", "collections", "events", "sponsors",
  "login", "signup", "orgs", "users", "search", "marketplace", "features", "enterprise", "pricing",
  "about", "security", "new", "organizations", "apps", "codespaces", "copilot", "pulls", "issues",
  "discussions", "watching", "stars", "dashboard",
]);

const YOUTUBE_CHANNEL_ID = /^UC[A-Za-z0-9_-]{10,64}$/;
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

export function platformFeedCandidates(url: URL): string[] {
  const host = url.hostname.toLowerCase().replace(/^(www|old|new|m)\./, "");
  const segments = url.pathname.split("/").filter(Boolean);

  if (host === "reddit.com") {
    // /r/name, /r/name/top, /user/name: every one of them has a feed at the end of its base path.
    if ((segments[0] === "r" || segments[0] === "user") && segments[1] && SAFE_SEGMENT.test(segments[1])) {
      return [`https://www.reddit.com/${segments[0]}/${segments[1]}/.rss`];
    }
    return [];
  }

  if (host === "medium.com") {
    const first = segments[0];
    if (!first || MEDIUM_RESERVED.has(first)) return [];
    return [`https://medium.com/feed/${first}`];
  }

  if (host === "youtube.com") {
    if (url.pathname === "/playlist") {
      const list = url.searchParams.get("list");
      return list && /^[A-Za-z0-9_-]{10,64}$/.test(list) ? [`https://www.youtube.com/feeds/videos.xml?playlist_id=${list}`] : [];
    }
    if (segments[0] === "channel" && segments[1] && YOUTUBE_CHANNEL_ID.test(segments[1])) {
      return [`https://www.youtube.com/feeds/videos.xml?channel_id=${segments[1]}`];
    }
    return [];
  }

  if (host === "bsky.app") {
    if (segments[0] === "profile" && segments[1] && /^[A-Za-z0-9._:-]{1,253}$/.test(segments[1])) {
      return [`https://bsky.app/profile/${segments[1]}/rss`];
    }
    return [];
  }

  if (host === "github.com") {
    const owner = segments[0];
    if (!owner || GITHUB_RESERVED.has(owner.toLowerCase())) return [];
    if (segments.length >= 2 && SAFE_SEGMENT.test(owner) && SAFE_SEGMENT.test(segments[1])) {
      const feedKind = segments[2] === "commits" ? "commits.atom" : "releases.atom";
      return [`https://github.com/${owner}/${segments[1]}/${feedKind}`];
    }
    if (/^[A-Za-z0-9-]+$/.test(owner)) {
      return [`https://github.com/${owner}.atom`];
    }
    return [];
  }

  if (host === "substack.com") {
    if (segments[0]?.startsWith("@")) {
      const handle = segments[0].slice(1);
      if (/^[A-Za-z0-9_-]{1,64}$/.test(handle)) return [`https://${handle}.substack.com/feed`];
    }
    return [];
  }

  if (host.endsWith(".substack.com") && host !== "substack.com") {
    return [`https://${host}/feed`];
  }

  if (host === "codeberg.org") {
    if (segments.length >= 2 && SAFE_SEGMENT.test(segments[0]) && SAFE_SEGMENT.test(segments[1])) {
      return [`https://codeberg.org/${segments[0]}/${segments[1]}/releases.rss`];
    }
    return [];
  }

  return [];
}

/**
 * Mastodon / Fediverse profiles (`https://instance/@handle`) expose an RSS feed at `/@handle.rss`,
 * often without a `<link rel="alternate">` on their SPA shell. Checked as a fallback after HTML discovery.
 */
export function fediverseFeedCandidate(url: URL): string | null {
  const host = url.hostname.toLowerCase().replace(/^(www|m)\./, "");
  if (host === "medium.com" || host === "youtube.com" || host === "substack.com" || host === "tiktok.com") return null;
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments[0]?.startsWith("@") && /^@[A-Za-z0-9_.-]{1,100}$/.test(segments[0])) {
    return `${url.origin}/${segments[0]}.rss`;
  }
  return null;
}

/** Extracts a YouTube channel RSS feed URL from channel page HTML (`/@handle`, `/c/...`, `/user/...`). */
export function youtubeChannelFeedFromHtml(html: string, url: URL): string | null {
  const host = url.hostname.toLowerCase().replace(/^(www|m)\./, "");
  if (host !== "youtube.com") return null;
  const match = /"(?:externalId|channelId)"\s*:\s*"(UC[A-Za-z0-9_-]{10,64})"/.exec(html);
  return match ? `https://www.youtube.com/feeds/videos.xml?channel_id=${match[1]}` : null;
}

/** The numeric id of a show on Apple Podcasts (`…/podcast/name/id1204393114`), if the address is one. */
export function applePodcastId(url: URL): string | null {
  if (url.hostname.toLowerCase() !== "podcasts.apple.com") return null;
  return /\/id(\d{4,12})(?:[/?]|$)/.exec(url.pathname)?.[1] ?? null;
}

/** The feed address in the answer of Apple's lookup service, if it names one. */
export function feedUrlFromAppleLookup(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { results?: Array<{ feedUrl?: unknown }> };
    const feedUrl = parsed.results?.find((result) => typeof result.feedUrl === "string")?.feedUrl;
    return typeof feedUrl === "string" ? feedUrl : null;
  } catch {
    return null;
  }
}
