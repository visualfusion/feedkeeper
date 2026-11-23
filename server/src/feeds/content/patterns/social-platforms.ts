import { OEMBED_PROVIDER_PLATFORMS, type SocialPlatform } from "./oembed-providers.js";

export type { SocialPlatform } from "./oembed-providers.js";

/**
 * Platforms without suitable single-post schemes in the oEmbed provider registry.
 * Mastodon is handled separately because every instance has its own hostname.
 */
const CUSTOM_SOCIAL_PLATFORMS: SocialPlatform[] = [
  {
    name: "Threads",
    host: /^(?:(?:www|m|mobile)\.)?threads\.(?:net|com)$/i,
    post: /^https?:\/\/(?:(?:www|m|mobile)\.)?threads\.(?:net|com)\/@[\w.]+\/post\/[\w-]+(?:[/?#]|$)/i,
    kind: "social",
  },
  {
    name: "Facebook",
    host: /^(?:(?:www|m|mobile)\.)?facebook\.com$/i,
    post: {
      test: value =>
        /^https?:\/\/(?:(?:www|m|mobile)\.)?facebook\.com\/(?:[^/?#]+\/)?(?:posts|activity|photos|videos|permalink|watch|reel|share)\b/i.test(value) ||
        /^https?:\/\/(?:(?:www|m|mobile)\.)?facebook\.com\/(?:photo|permalink|story)\.php\?(?:[^#]*&)?(?:fbid|story_fbid|v)=/i.test(value) ||
        /^https?:\/\/(?:(?:www|m|mobile)\.)?facebook\.com\/[^#]*[?&](?:story_fbid|v)=/i.test(value),
    },
    kind: "social",
  },
  {
    name: "X",
    host: /^(?:(?:www|m|mobile)\.)?twitter\.com$/i,
    post: /^https?:\/\/(?:(?:www|m|mobile)\.)?twitter\.com\/(?:i\/|[\w]+\/)(?:web\/)?status\/\d+/i,
    kind: "social",
  },
];

/**
 * The platforms whose posts become a marked link (`data-media` + `data-source`).
 * A fixture in `test/fixtures/content/social-embeds` shows the expected result.
 */
export const SOCIAL_PLATFORMS: SocialPlatform[] = [
  ...OEMBED_PROVIDER_PLATFORMS,
  ...CUSTOM_SOCIAL_PLATFORMS,
];

/** Classes of the blockquote placeholders that the platforms' scripts turn into the real post. */
export const SOCIAL_QUOTE =
  "blockquote.instagram-media, blockquote.twitter-tweet, blockquote.tiktok-embed, blockquote.bluesky-embed, " +
  "blockquote.reddit-embed-bq, blockquote.text-post-media, blockquote.fb-xfbml-parse-ignore";

/**
 * Mastodon has no fixed host: any instance embeds a post as an iframe whose address ends in `/@user/<id>/embed`. The
 * path alone identifies it, so it is matched on every host, for frames only.
 */
export const MASTODON_EMBED_PATH = /^\/@[\w.]+\/\d{5,}\/embed\/?$/;
