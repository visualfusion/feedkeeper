import { CONTENTS_HEADINGS } from "../patterns/contents/index.js";
import { type ContentRule, count, flat, pruneEmpty } from "../shared.js";

const LIST_LIKE = "ul, ol, nav, details, dl, table";
/** How far down a block's first children a list may start and still count as the list under the heading. */
const LIST_DEPTH = 3;

/** Whether an element is a list or opens with one (a wrapper around the table of contents). */
function startsWithList(element: Element, depth = 0): boolean {
  if (element.matches(LIST_LIKE)) return true;
  const first = element.firstElementChild;
  return depth < LIST_DEPTH && first !== null && startsWithList(first, depth + 1);
}

/**
 * The heading of a table of contents that a script fills: "Table of Contents", "Inhaltsverzeichnis", "目次". Without the script
 * nothing follows it but the story. A heading goes only when the element after it neither is a list nor opens with one and holds no
 * links within the page; a table of contents that is there stays with its heading.
 */
export const emptyContents: ContentRule = {
  name: "empty-contents",
  description: "A \"Table of Contents\" heading with no list of links after it (a script builds the list) is removed.",
  apply(root, stats) {
    let changed = false;
    for (const heading of [...root.querySelectorAll("h1, h2, h3, h4, h5, h6")]) {
      if (!root.contains(heading) || !CONTENTS_HEADINGS.some(pattern => pattern.test(flat(heading.textContent)))) continue;
      // A wrapper that holds nothing but the heading belongs to it.
      let target: Element = heading;
      while (target.parentElement && target.parentElement.children.length === 1 && flat(target.parentElement.textContent) === flat(heading.textContent)) target = target.parentElement;
      const next = target.nextElementSibling;
      if (next && (startsWithList(next) || next.querySelectorAll("a[href^='#']").length >= 2)) continue;
      const parent = target.parentNode;
      target.remove();
      pruneEmpty(parent);
      count(stats, "empty-contents");
      changed = true;
    }
    return changed;
  },
};
