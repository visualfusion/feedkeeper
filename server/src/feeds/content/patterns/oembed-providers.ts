/**
 * Curated single-item URL patterns from the oEmbed provider registry.
 *
 * Snapshot: 2026-11-23
 * Source: https://oembed.com/providers.json
 *
 * The registry also contains profile, collection, playlist and discovery-only schemes. Those are
 * intentionally omitted: FeedKeeper turns a URL into a card only when it identifies one item.
 * Refresh this snapshot when updating provider support; keep non-registry platforms in
 * social-platforms.ts.
 */
export interface SocialPlatform {
  name: string;
  host: RegExp;
  /** The path and query of one item, never a profile or collection. */
  post: RegExp;
  kind: "social" | "audio";
}

export const OEMBED_PROVIDER_SNAPSHOT = "2026-11-23";

export const OEMBED_PROVIDER_PLATFORMS: SocialPlatform[] = [
  { name: "YouTube", host: /^(?:youtube(?:-nocookie)?\.com|youtu\.be)$/, post: /^(?:\/watch\?(?:[^#&]+&)*v=[\w-]{6,}(?:&[^#]*)?|\/(?:shorts|live|embed)\/[\w-]{6,})$/, kind: "social" },
  { name: "Vimeo", host: /^(?:vimeo\.com|player\.vimeo\.com)$/, post: /^(?:\/(?:video\/)?\d{5,}|\/channels\/[^/]+\/\d{5,})$/, kind: "social" },
  { name: "Dailymotion", host: /^(?:dailymotion\.com|dai\.ly)$/, post: /^(?:\/video\/[a-zA-Z0-9]+|\/[a-zA-Z0-9]+)$/, kind: "social" },
  { name: "Flickr", host: /^(?:flickr\.com|flic\.kr)$/, post: /^(?:\/photos\/[^/]+\/\d+|\/p\/[a-zA-Z0-9]+)$/, kind: "social" },
  { name: "Imgur", host: /^imgur\.com$/, post: /^\/[a-zA-Z0-9]{5,8}$/, kind: "social" },
  { name: "Mixcloud", host: /^mixcloud\.com$/, post: /^\/[^/]+\/[^/]+\/?$/, kind: "audio" },
  { name: "TED", host: /^ted\.com$/, post: /^\/talks\/[\w-]+/, kind: "social" },
  { name: "Tumblr", host: /^(?:[a-z0-9-]+\.)?tumblr\.com$/, post: /^\/[^/]+\/\d{8,}(?:\/[^/]*)?$/, kind: "social" },
  { name: "Kickstarter", host: /^(?:kickstarter\.com|kck\.st)$/, post: /^\/(?:projects\/[^/]+\/[^/]+|[\w-]+)\/?$/, kind: "social" },
  { name: "ReverbNation", host: /^reverbnation\.com$/, post: /^\/[^/]+\/(?:song|music)\/[^/]+/, kind: "audio" },
  { name: "VideoPress", host: /^videopress\.com$/, post: /^\/v\/[\w-]+/, kind: "social" },
  { name: "Speaker Deck", host: /^speakerdeck\.com$/, post: /^\/[^/]+\/[^/]+/, kind: "social" },
  { name: "Pocket Casts", host: /^(?:pca\.st|pocketcasts\.com)$/, post: /^(?:\/episode\/[\w-]+|\/[^/]+)$/, kind: "audio" },
  { name: "Anghami", host: /^(?:anghami\.com|play\.anghami\.com)$/, post: /^\/(?:song|album|playlist|podcast|episode)\/[\w-]+/, kind: "audio" },
  { name: "Canva", host: /^canva\.com$/, post: /^\/design\/[\w-]+\/view/, kind: "social" },
  { name: "Pinterest", host: /^(?:pinterest\.com|[a-z]{2}\.pinterest\.com)$/, post: /^\/pin\/\d+/, kind: "social" },
  { name: "GIPHY", host: /^giphy\.com$/, post: /^\/gifs\/[^/]+-[\w]+/, kind: "social" },
  { name: "Audioboom", host: /^audioboom\.com$/, post: /^\/posts\/\d+/, kind: "audio" },
  { name: "Audius", host: /^(?:audius\.co|audius\.content)$/, post: /^\/[^/]+\/[^/]+/, kind: "audio" },
  { name: "Spotify", host: /^open\.spotify\.com$/, post: /^\/(?:track|album|episode|show|artist)\/[\w]+$/, kind: "audio" },
  { name: "SoundCloud", host: /^soundcloud\.com$/, post: /^\/[^/]+\/[^/]+/, kind: "audio" },
  { name: "Instagram", host: /^instagram\.com$/, post: /^\/(?:[\w.]+\/)?(?:p|reel|reels|tv)\/[\w-]+/, kind: "social" },
  { name: "X", host: /^(?:twitter|x)\.com$/, post: /^\/(?:i\/|[\w]+\/)(?:web\/)?status\/\d+/, kind: "social" },
  { name: "TikTok", host: /^tiktok\.com$/, post: /\/(?:video|photo)\/\d+/, kind: "social" },
  { name: "Bluesky", host: /^bsky\.app$/, post: /^\/profile\/[^/]+\/post\/[\w]+/, kind: "social" },
  { name: "Reddit", host: /^reddit\.com$/, post: /^\/r\/\w+\/comments\//, kind: "social" },
  { name: "Facebook", host: /^facebook\.com$/, post: /\/(?:posts|videos|photos|permalink|watch|reel|share)\b|[?&](?:story_fbid|v)=/, kind: "social" },
];

