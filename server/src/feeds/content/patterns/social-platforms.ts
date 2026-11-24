import { OEMBED_PROVIDER_PLATFORMS, type SocialPlatform } from "./oembed-providers.js";
export type { SocialPlatform } from "./oembed-providers.js";
const CUSTOM_SOCIAL_PLATFORMS: SocialPlatform[] = [
  { name: "Threads", host: /^threads\.(?:net|com)$/i, post: /^https?:\/\/(?:www\.)?threads\.(?:net|com)\/@[\w.]+\/post\/[\w-]+$/i, kind: "social" },
  { name: "Facebook", host: /^(?:www\.)?facebook\.com$/i, post: { test: value => /^https?:\/\/(?:www\.)?facebook\.com\/(?:[^/?#]+\/)?(?:posts|activity|photos|videos|permalink|watch|reel|share)\b/i.test(value) || /^https?:\/\/(?:www\.)?facebook\.com\/photo\.php\?(?:[^#]*&)?fbid=/i.test(value) }, kind: "social" },
  { name: "X", host: /^twitter\.com$/i, post: /^https?:\/\/(?:www\.)?twitter\.com\/(?:i\/|[\w]+\/)(?:web\/)?status\/\d+/i, kind: "social" },
];
export const SOCIAL_PLATFORMS: SocialPlatform[] = [...OEMBED_PROVIDER_PLATFORMS, ...CUSTOM_SOCIAL_PLATFORMS];
export const SOCIAL_QUOTE = "blockquote.instagram-media, blockquote.twitter-tweet, blockquote.tiktok-embed, blockquote.bluesky-embed, " +
  "blockquote.reddit-embed-bq, blockquote.text-post-media, blockquote.fb-xfbml-parse-ignore";
export const MASTODON_EMBED_PATH = /^\/@[\w.]+\/\d{5,}\/embed\/?$/;
