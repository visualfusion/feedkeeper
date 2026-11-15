import { SIDEBAR_HEADINGS, SIDEBAR_SELECTORS } from "../patterns/sidebars/index.js";
import { type ContentRoot, type ContentRule, count, flat, pruneEmpty } from "../shared.js";

const HEADINGS = "h2, h3, h4";
/** Only the second half of the text can hold a list of other articles: before it, the same title is part of the story. */
const AFTER_SHARE = 0.5;
const MIN_LINKS = 2;

function level(heading: Element): number {
  return Number(heading.tagName.slice(1));
}

function textBefore(root: ContentRoot, node: Node): number {
  const range = root.ownerDocument?.createRange() ?? (root as Document).createRange();
  range.setStart(root, 0);
  range.setEndBefore(node);
  return flat(range.toString()).length;
}

/** Climbs out of a single-heading wrapper (like `<header><h2>Most Read</h2></header>`) so its siblings are the section. */
function sectionAnchor(heading: Element): Element {
  let anchor = heading;
  const text = flat(heading.textContent);
  while (!anchor.nextElementSibling && anchor.parentElement &&
    anchor.parentElement.children.length === 1 && flat(anchor.parentElement.textContent) === text) {
    anchor = anchor.parentElement;
  }
  return anchor;
}

/** The elements that follow a heading up to the next heading of the same or a higher level. */
function sectionOf(anchor: Element, headingLevel: number): Element[] {
  const section: Element[] = [];
  for (let sibling = anchor.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
    if (/^H[1-6]$/.test(sibling.tagName) && level(sibling) <= headingLevel) break;
    section.push(sibling);
  }
  return section;
}

function removeBlock(element: Element, stats: Record<string, number>): void {
  const parent = element.parentNode;
  element.remove();
  pruneEmpty(parent);
  count(stats, "sidebar");
}

/**
 * Lists of other articles ("Popular Stories", "Related articles", "Mehr zum Thema") sit inside the article's container
 * on many sites, so a reader that picks the container takes them along as if they were the story. They go by their
 * markup, or by a heading that names them, when it stands in the second half of the text and is followed by links.
 */
export const sidebars: ContentRule = {
  name: "sidebars",
  description: "Lists of recommended, related or popular articles inside the article's container are removed.",
  apply(root, stats) {
    let changed = false;
    for (const selector of SIDEBAR_SELECTORS) {
      for (const element of [...root.querySelectorAll(selector)]) {
        if (!root.contains(element)) continue;
        removeBlock(element, stats);
        changed = true;
      }
    }
    const total = flat(root.textContent).length;
    if (total === 0) return changed;
    for (const heading of [...root.querySelectorAll(HEADINGS)]) {
      if (!root.contains(heading) || !SIDEBAR_HEADINGS.some(pattern => pattern.test(flat(heading.textContent)))) continue;
      const anchor = sectionAnchor(heading);
      const section = sectionOf(anchor, level(heading));
      const links = section.reduce((sum, element) => sum + element.querySelectorAll("a[href]").length + (element.matches("a[href]") ? 1 : 0), 0);
      if (links < MIN_LINKS || textBefore(root, anchor) / total < AFTER_SHARE) continue;
      section.forEach(element => element.remove());
      removeBlock(anchor, stats);
      changed = true;
    }
    return changed;
  },
};
