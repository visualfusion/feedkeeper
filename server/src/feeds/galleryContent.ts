import { JSDOM } from "jsdom";

const GALLERY_COMPONENTS = new Set([
  "bilder", "bildergalerie", "bildergalerien", "fotogalerie", "fotogalerien", "fotostrecke", "fotostrecken",
  "galerie", "galerien", "gallery", "galleries", "photogallery", "photogalleries", "slideshow", "slideshows",
  "photos", "pictures", "images",
]);
const PLACEHOLDERS = new Set([
  "", "mehr", "weiterlesen", "mehr lesen", "read more", "more", "continue reading",
  "zur galerie", "zur bildergalerie", "view gallery", "続きを読む", "もっと読む",
]);

function isPlaceholder(source: string | null | undefined): boolean {
  const fragment = JSDOM.fragment(source ?? "");
  fragment.querySelectorAll("script, style, noscript").forEach(node => node.remove());
  fragment.querySelectorAll("p, div, br, li, h1, h2, h3, blockquote, figcaption").forEach(node => node.append(" "));
  const normalized = (fragment.textContent ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return PLACEHOLDERS.has(normalized);
}

/** A gallery path alone is not enough: even one editorial sentence or caption keeps the article visible. */
export function isEmptyGallery(item: {
  link?: string | null;
  content_snippet?: string | null;
  content_html?: string | null;
  full_content_html?: string | null;
}): boolean {
  if (!item.link) return false;
  let path: string;
  try { path = decodeURIComponent(new URL(item.link).pathname).toLowerCase(); } catch { return false; }
  if (!path.split(/[^\p{L}\p{N}]+/u).some(component => GALLERY_COMPONENTS.has(component))) return false;
  return isPlaceholder(item.content_snippet) && isPlaceholder(item.full_content_html || item.content_html);
}
