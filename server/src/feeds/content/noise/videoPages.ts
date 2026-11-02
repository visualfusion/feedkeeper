import { flat, linkParagraph, type ContentRoot, type NoiseStats } from "../shared.js";
import de from "../patterns/video-pages/de.js";
import en from "../patterns/video-pages/en.js";
import ja from "../patterns/video-pages/ja.js";

const labels = new Set([...de, ...en, ...ja].map(value => value.toLowerCase()));
const date = /\b\d{1,2}\.\d{1,2}\.\d{4}\b|\b[A-Za-z]{3,9} \d{1,2},? \d{4}\b|\d{4}年\d{1,2}月\d{1,2}日/;

/** A video landing page with a poster and metadata, but no editorial paragraphs. */
export function cleanVideoPage(root: ContentRoot, url: string | null | undefined, title: string | null | undefined, stats: NoiseStats): boolean {
  if (!url) return false;
  try {
    const address = new URL(url);
    if (!/^https?:$/.test(address.protocol) || !/(^|\/)(videos?|mediathek|watch|clips?)(\/|$|[-.])/i.test(address.pathname)) return false;
  } catch { return false; }
  const mains = root.querySelectorAll("main");
  if (mains.length !== 1) return false;
  const main = mains[0]!;
  const images = main.querySelectorAll("img");
  if (images.length !== 1 || main.querySelector("article, blockquote, table, a[data-media]")) return false;
  for (const link of main.querySelectorAll("a[href]")) {
    if (link.closest("nav, ul, ol") || link.querySelector("img")) continue;
    // A home link is navigation; a transcript or another editorial link is content and must survive.
    try {
      const target = new URL(link.getAttribute("href")!, url);
      if (target.origin !== new URL(url).origin || target.pathname !== "/" || target.search || target.hash) return false;
    } catch { return false; }
  }
  const copy = main.cloneNode(true) as Element;
  copy.querySelectorAll("nav, ul, ol, form, img, picture, a, h1").forEach(element => element.remove());
  const blocks = [...copy.querySelectorAll("p")].filter(element => flat(element.textContent));
  if (!blocks.some(element => labels.has(flat(element.textContent).toLowerCase()))) return false;
  // All remaining words must be short metadata lines containing an explicit date.
  for (const block of blocks) {
    const text = flat(block.textContent);
    if (!labels.has(text.toLowerCase()) && (text.length > 160 || !date.test(text))) return false;
    block.remove();
  }
  if (flat(copy.textContent)) return false;
  const document = main.ownerDocument;
  const poster = document.createElement("p");
  poster.append(images[0]!.cloneNode(true));
  const card = linkParagraph(document, url, flat(title) || "Video");
  card.querySelector("a")!.setAttribute("data-media", "video");
  // Preserve attribution/broadcast metadata; omit the repeated publication timestamp and kind label.
  const credits = [...main.querySelectorAll("p")].filter(element => {
    const text = flat(element.textContent);
    return date.test(text) && /[,、]/.test(text) && text.length <= 160 && !element.querySelector("a, img");
  }).map(element => element.cloneNode(true));
  root.replaceChildren(poster, card, ...credits);
  stats["video-page"] = (stats["video-page"] ?? 0) + 1;
  return true;
}
