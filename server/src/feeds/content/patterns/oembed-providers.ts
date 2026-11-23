import registry from "./providers.json" with { type: "json" };
export interface SocialPlatform { name: string; host: RegExp; post: { test(value: string): boolean }; kind: "social" | "audio" | "video"; }
export const OEMBED_PROVIDER_SNAPSHOT = registry.snapshot_date;
const VIDEO = new Set(["YouTube", "Vimeo", "Dailymotion"]);
const AUDIO = new Set(["SoundCloud", "Spotify"]);
function escapeRegex(value: string): string { return value.replace(/[.*+?^$()|[\]\\]/g, "\\$&"); }
function compileScheme(scheme: string): RegExp {
  const match = /^(https?):\/\/([^/]+)(\/.*)$/.exec(scheme);
  if (!match) throw new Error("Invalid oEmbed scheme: " + scheme);
  const host = escapeRegex(match[2]).replace(/\\\*/g, "[^.]+");
  const path = escapeRegex(match[3]).replace(/\\\*/g, "[^#]*");
  return new RegExp("^" + match[1] + "://" + host + path + "$", "i");
}
export const OEMBED_PROVIDER_PLATFORMS: SocialPlatform[] = registry.providers.map(provider => {
  const name = provider.provider_name === "Bluesky Social" ? "Bluesky" : provider.provider_name;
  const schemes = provider.schemes.map(compileScheme);
  const paths = provider.item_paths.map(pattern => new RegExp(pattern, "i"));
  const hosts = provider.schemes.map(scheme => {
    const match = /^(https?):\/\/([^/]+)/.exec(scheme);
    if (!match) throw new Error("Invalid oEmbed scheme: " + scheme);
    return escapeRegex(match[2]).replace(/\\\*/g, "[^.]+");
  });
  const host = new RegExp("^(?:" + hosts.join("|") + ")$", "i");
  const post = { test(value: string): boolean {
    try {
      const url = new URL(value);
      if (!host.test(url.hostname) || !schemes.some(pattern => pattern.test(url.href)) || !paths.some(pattern => pattern.test(url.pathname))) return false;
      if (name === "YouTube" && url.pathname === "/watch" && !url.searchParams.has("v")) return false;
      if (name === "YouTube" && url.pathname === "/playlist" && !url.searchParams.has("list")) return false;
      return true;
    } catch { return false; }
  } };
  return { name, host, post, kind: VIDEO.has(name) ? "video" : AUDIO.has(name) ? "audio" : "social" };
});
