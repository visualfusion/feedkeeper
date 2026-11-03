import { type ContentRoot, type ContentRule, count, flat, pruneEmpty } from "../shared.js";

/** One to three characters that are neither letters nor digits: "★", "∞", "¶", "#", "↩". Non-breaking spaces around them count as blanks. */
const GLYPH_ONLY = /^[^\p{L}\p{N}]{1,3}$/u;

/** Whether any text follows the element in the document: only the tail of a story is looked at. */
function hasTextAfter(root: ContentRoot, element: Element): boolean {
  const document = root.nodeType === 9 ? (root as Document) : root.ownerDocument;
  if (!document) return false;
  const walker = document.createTreeWalker(root, 4);
  let reached = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (element.contains(node)) { reached = true; continue; }
    if (reached && flat(node.textContent) !== "") return true;
  }
  return false;
}

/**
 * Some blogs end every post with a permanent link that is only a symbol ("★", "∞", "¶"): a link to the post itself, of no use inside a reader.
 * The block must hold nothing but that one link, come after the text of the story and have nothing after it. A symbol inside a sentence,
 * a link with a picture and a block with more text stay.
 */
export const permalinkGlyphs: ContentRule = {
  name: "permalink-glyphs",
  description: "A block at the end of a story that holds only one link made of a single symbol such as \"★\" or \"¶\" is removed.",
  apply(root, stats) {
    let changed = false;
    const total = flat(root.textContent).length;
    for (const block of [...root.querySelectorAll("p, div")].reverse()) {
      if (!root.contains(block) || block.querySelector("p, div, img, picture, video, iframe")) continue;
      const links = block.querySelectorAll("a[href]");
      if (links.length !== 1) continue;
      const text = (block.textContent ?? "").replace(/[\s\u00a0]+/g, "");
      if (!GLYPH_ONLY.test(text) || flat(links[0].textContent).replace(/[\s\u00a0]+/g, "") !== text) continue;
      if (total - text.length < 120 || hasTextAfter(root, block)) continue;
      const parent = block.parentNode;
      block.remove();
      pruneEmpty(parent);
      count(stats, "permalink-glyphs");
      changed = true;
    }
    return changed;
  },
};
