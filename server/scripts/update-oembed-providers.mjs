import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const source = "https://oembed.com/providers.json";

const pathRules = {
  "Bluesky Social": ["^/profile/[^/]+/post/[^/]+/?$"],
  Dailymotion: ["^/video/[A-Za-z0-9]+/?$"],
  Flickr: ["^/photos/[^/]+/\\d+/?$", "^/p/[^/]+/?$"],
  Instagram: ["^/(?:[\\w.]+/)?(?:p|tv|reel|reels)/[\\w-]+/?$"],
  Reddit: ["^/r/[^/]+/comments/[^/]+"],
  SoundCloud: ["^/[^/]+/[^/]+/?$"],
  Spotify: ["^/(?:track|album|playlist|episode|show|artist)/[A-Za-z0-9]+/?$"],
  TikTok: ["^/@[^/]+/(?:video|photo)/\\d+/?$", "^/(?:video|photo)/\\d+/?$"],
  Vimeo: ["^/\\d{5,}/?$", "^/channels/[^/]+/\\d{5,}/?$", "^/video/\\d{5,}/?$"],
  X: ["^/(?:i/|[^/]+/)(?:web/)?status/\\d+/?$"],
  YouTube: ["^/watch$", "^/playlist$", "^/(?:shorts|live|embed|v)/[\\w-]{6,}/?$", "^/[\\w-]{6,}/?$"],
};

const response = await fetch(source);
if (!response.ok) {
  throw new Error(`Provider registry download failed: ${response.status}`);
}

const registry = await response.json();
const providers = registry.flatMap(provider => {
  const item_paths = pathRules[provider.provider_name];
  if (!item_paths) return [];
  const schemes = (provider.endpoints ?? [])
    .flatMap(endpoint => endpoint.schemes ?? [])
    .filter(scheme => scheme.startsWith("https://"));
  return schemes.length ? [{ provider_name: provider.provider_name, schemes: [...new Set(schemes)], item_paths }] : [];
});

const output = {
  source,
  snapshot_date: new Date().toISOString().slice(0, 10),
  providers,
};

await writeFile(
  resolve(import.meta.dirname, "../src/feeds/content/patterns/providers.json"),
  JSON.stringify(output, null, 2) + "\n",
);
