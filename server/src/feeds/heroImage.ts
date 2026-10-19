import { decodeEntities } from "./text.js";

/** The widest picture a hero needs; a still larger variant is not worth the bytes. */
const MAX_HERO_WIDTH = 2000;
/** A larger variant must be clearly larger than the feed's picture, so a small difference does not change anything. */
const MIN_GAIN = 1.5;

interface Variant { key: string; width: number }

/**
 * Splits an image address into what identifies the picture and the width of this size. Publishers name sizes in the
 * file name (`…__wide__148`, `-300x200.jpg`, `_300x200.jpg`) or in the query (`?w=300`); two addresses with the same
 * key are the same picture in different sizes. Addresses without a recognised size have no variant.
 */
export function imageVariant(raw: string): Variant | null {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  const path = url.pathname;
  const named = /^(.*__[a-z]+__)(\d{2,4})$/i.exec(path) ?? /^(.*[-_])(\d{2,4})x\d{2,4}(\.[a-z0-9]{2,5})?$/i.exec(path);
  if (named) {
    // The query of such addresses is a cache version (`?v=…`), not part of the picture.
    return { key: `${url.origin}${named[1]}#${named[3] ?? ""}`, width: Number(named[2]) };
  }
  const widthParam = ["w", "width"].find((name) => /^\d{2,4}$/.test(url.searchParams.get(name) ?? ""));
  if (widthParam) {
    const rest = new URLSearchParams(url.searchParams);
    for (const name of ["w", "width", "h", "height", "q", "quality", "fit", "dpr"]) rest.delete(name);
    return { key: `${url.origin}${path}?${rest.toString()}`, width: Number(url.searchParams.get(widthParam)) };
  }
  return null;
}

/** Every image address in the HTML: `src` of images and each entry of a `srcset`. */
function imageAddresses(html: string, baseUrl: string | null): string[] {
  const found = new Set<string>();
  const add = (raw: string): void => {
    const value = decodeEntities(raw.trim());
    if (!value || value.startsWith("data:")) return;
    try {
      const url = new URL(value, baseUrl ?? undefined);
      if (url.protocol === "https:" || url.protocol === "http:") found.add(url.toString());
    } catch { /* A broken address is not a candidate. */ }
  };
  for (const [tag] of html.matchAll(/<(?:img|source)\b[^>]*>/gi)) {
    const src = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    if (src) add(src[1] ?? src[2] ?? "");
    const srcset = /\ssrcset\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    if (srcset) for (const entry of (srcset[1] ?? srcset[2] ?? "").split(/,\s+/)) add(entry.trim().split(/\s+/)[0] ?? "");
  }
  return [...found];
}

/**
 * A feed often offers a thumbnail (`…__wide__148`) of the picture that its article shows in full size. When the
 * article carries the same picture in a clearly larger size, that size is the better hero; otherwise there is none.
 */
export function largerHeroImage(imageUrl: string | null | undefined, html: string | null | undefined, baseUrl: string | null): string | null {
  if (!imageUrl || !html || !html.includes("<")) return null;
  const current = imageVariant(imageUrl);
  if (!current) return null;
  let best: { url: string; width: number } | null = null;
  for (const address of imageAddresses(html, baseUrl)) {
    const variant = imageVariant(address);
    if (!variant || variant.key !== current.key) continue;
    if (variant.width < current.width * MIN_GAIN || variant.width > MAX_HERO_WIDTH) continue;
    if (!best || variant.width > best.width) best = { url: address, width: variant.width };
  }
  return best?.url ?? null;
}
