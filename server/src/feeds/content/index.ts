import { lazyImages } from "./noise/lazyImages.js";
import { EMBED_RULES, resolveEmbeds } from "./embeds/index.js";
import { embedHeadings } from "./embeds/headings.js";
import { boilerplate } from "./noise/boilerplate.js";
import { loadingPlaceholders } from "./noise/loading.js";
import { trackingPixels } from "./noise/pixels.js";
import { sidebars } from "./noise/sidebars.js";
import { teaserLinks } from "./noise/teaserLinks.js";
import type { ContentRoot, ContentRule, NoiseStats } from "./shared.js";

/**
 * Every rule of the content pipeline, in the order they run on a fetched page: embeds first (their address sits in
 * tags that are removed next), then the clutter around the story. The tests check each rule against its fixtures in
 * `test/fixtures/content/<rule name>` and that running it twice changes nothing. See `docs/content-rules.md`.
 */
export const PAGE_RULES: readonly ContentRule[] = [lazyImages, ...EMBED_RULES, embedHeadings, sidebars, loadingPlaceholders, trackingPixels, boilerplate, teaserLinks];

export { resolveEmbeds };

/** What a fetched page goes through before its scripts, frames and `noscript` blocks are removed. */
export function cleanPage(root: ContentRoot, stats: NoiseStats = {}): boolean {
  return PAGE_RULES.map(rule => rule.apply(root, stats)).some(Boolean);
}
