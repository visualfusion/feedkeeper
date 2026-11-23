import registry from "./providers.json" with { type: "json" };

export interface SocialPlatform {
  name: string;
  host: RegExp;
  /** Matches the address of a single item, as opposed to a profile, channel or start page. */
  post: { test(value: string): boolean };
  kind: "social" | "audio" | "video";
}

export const OEMBED_PROVIDER_SNAPSHOT = registry.snapshot_date;

const VIDEO_PROVIDERS = new Set(["YouTube", "Vimeo", "Dailymotion"]);
const AUDIO_PROVIDERS = new Set(["SoundCloud", "Spotify"]);

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
}

function compileHost(rawHost: string): string {
  if (rawHost === "*.youtube.com") {
    return `(?:[^.]+\\.)?youtube(?:-nocookie)?\\.com`;
  }
  if (rawHost.startsWith("*.")) {
    return `(?:[^.]+\\.)?${escapeRegex(rawHost.slice(2)).replace(/\\\*/g, "[^.]+")}`;
  }
  const bare = rawHost.replace(/^www\./, "");
  if (!bare.includes("*.") && bare.split(".").length === 2) {
    return `(?:(?:www|m|mobile)\\.)?${escapeRegex(bare)}`;
  }
  return escapeRegex(rawHost).replace(/\\\*/g, "[^.]+");
}

function compileScheme(scheme: string): RegExp {
  const match = /^(https?):\/\/([^/]+)(\/.*)$/.exec(scheme);
  if (!match) {
    throw new Error(`Invalid oEmbed scheme: ${scheme}`);
  }
  const host = compileHost(match[2]);
  const path = escapeRegex(match[3]).replace(/\\\*/g, "[^#]*");
  return new RegExp(`^${match[1]}://${host}${path}$`, "i");
}

/**
 * Single-item URL matchers derived from the versioned oEmbed provider registry snapshot.
 * Run `npm run update:oembed-providers` to refresh `providers.json`.
 */
export const OEMBED_PROVIDER_PLATFORMS: SocialPlatform[] = registry.providers.map(provider => {
  const name = provider.provider_name === "Bluesky Social" ? "Bluesky" : provider.provider_name;
  const schemes = provider.schemes.map(compileScheme);
  const paths = provider.item_paths.map(pattern => new RegExp(pattern, "i"));
  const hosts = provider.schemes.map(scheme => {
    const match = /^(https?):\/\/([^/]+)/.exec(scheme);
    if (!match) {
      throw new Error(`Invalid oEmbed scheme: ${scheme}`);
    }
    return compileHost(match[2]);
  });
  const host = new RegExp(`^(?:${[...new Set(hosts)].join("|")})$`, "i");

  const post = {
    test(value: string): boolean {
      try {
        const url = new URL(value);
        if (
          !host.test(url.hostname) ||
          !schemes.some(pattern => pattern.test(url.href)) ||
          !paths.some(pattern => pattern.test(url.pathname))
        ) {
          return false;
        }
        if (name === "YouTube" && url.pathname === "/watch" && !url.searchParams.has("v")) return false;
        if (name === "YouTube" && url.pathname === "/playlist" && !url.searchParams.has("list")) return false;
        return true;
      } catch {
        return false;
      }
    },
  };

  const kind = VIDEO_PROVIDERS.has(name) ? "video" : AUDIO_PROVIDERS.has(name) ? "audio" : "social";
  return { name, host, post, kind };
});
