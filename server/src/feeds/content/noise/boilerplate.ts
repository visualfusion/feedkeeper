import { BOILERPLATE_ANYWHERE, BOILERPLATE_TRAILING } from "../patterns/boilerplate/index.js";
import { type ContentRoot, type ContentRule, type NoiseStats, count, flat, pruneEmpty } from "../shared.js";

const BLOCKS = "p, div, li, h2, h3, h4, h5, h6, span";
const NESTED = "p, div, li, ul, ol, h2, h3, h4, h5, h6";
/** Footers can only sit in the second half of the text: before it, the same words are part of the story. */
const AFTER_SHARE = 0.5;
/** A list after a removed box ("Follow topics and authors …") that holds names, or nothing at all, belongs to the box. */
const LIST_ITEM_LIMIT = 60;

function textBefore(root: ContentRoot, node: Node): number {
  const range = root.ownerDocument?.createRange() ?? (root as Document).createRange();
  range.setStart(root, 0);
  range.setEndBefore(node);
  return flat(range.toString()).length;
}

/** The list that directly follows a block, when it only holds short names or empty items. */
function followingNameList(block: Element): Element | null {
  const next = block.nextElementSibling;
  if (!next || !/^(UL|OL)$/.test(next.tagName)) return null;
  const items = [...next.querySelectorAll("li")];
  return items.length > 0 && items.every(item => flat(item.textContent).length <= LIST_ITEM_LIMIT) ? next : null;
}

/** Elements that start a line of their own; a run of text between two `<br>` that holds one of them is not a plain line. */
const LINE_BREAKING = `${NESTED}, img, picture, video, audio, iframe, table, blockquote, figure`;

/** The text nodes and inline elements of a container, cut at every `<br>`. */
function linesOf(container: ParentNode): Node[][] {
  const lines: Node[][] = [[]];
  container.childNodes.forEach(node => {
    if (node.nodeName === "BR") lines.push([]);
    else lines[lines.length - 1]!.push(node);
  });
  return lines;
}

function isPlainLine(nodes: Node[]): boolean {
  return nodes.every(node => node.nodeType === 3 || (node.nodeType === 1 && !(node as Element).matches(LINE_BREAKING) && !(node as Element).querySelector(LINE_BREAKING)));
}

/**
 * Lines that sites add to their own text: "Follow us on Google", the words of a download button, the file name of a picture shown as text,
 * "This article first appeared on …", the related links under a MacRumors story. A block goes when its whole text is one of these lines
 * (footers only in the second half), together with the list of names that follows a "follow topics" box.
 */
export const boilerplate: ContentRule = {
  name: "boilerplate",
  description: "Blocks that only hold a follow-us call, a download button text, an image file name or an \"appeared first on\" footer are removed.",
  apply(root, stats) {
    let changed = false;
    const total = flat(root.textContent).length;
    for (const block of [...root.querySelectorAll(BLOCKS)]) {
      if (!root.contains(block) || block.querySelector("img, picture, video, audio, iframe") || block.querySelector(NESTED)) continue;
      const text = flat(block.textContent);
      if (text === "" || text.length > 400) continue;
      const anywhere = BOILERPLATE_ANYWHERE.some(pattern => pattern.test(text));
      const trailing = !anywhere && total > 0 && textBefore(root, block) / total >= AFTER_SHARE && BOILERPLATE_TRAILING.some(pattern => pattern.test(text));
      if (!anywhere && !trailing) continue;
      const parent = block.parentNode;
      followingNameList(block)?.remove();
      block.remove();
      pruneEmpty(parent);
      count(stats, "boilerplate");
      changed = true;
    }
    if (inlineCalls(root, stats)) changed = true;
    return lineFooters(root, stats, total) || changed;
  },
};

/** A short line holds more than the call ("November 12, 2026 · Add as a preferred source on Google"): longer text is prose and is left alone. */
const SHORT_LINE = 200;

/**
 * The same calls as a link inside a short line of other words, or in front of a picture in the same paragraph: the link goes, the rest stays.
 * A block that holds nothing else was dealt with above.
 */
function inlineCalls(root: ContentRoot, stats: NoiseStats): boolean {
  let changed = false;
  for (const link of [...root.querySelectorAll("a[href]")]) {
    const parent = link.parentElement;
    if (!parent || !root.contains(link) || link.querySelector("img, picture, video, audio, iframe")) continue;
    const text = flat(link.textContent);
    if (text === "" || text.length > 120 || !BOILERPLATE_ANYWHERE.some(pattern => pattern.test(text))) continue;
    const line = flat(parent.textContent);
    if (line.length > SHORT_LINE) continue;
    link.remove();
    count(stats, "boilerplate");
    changed = true;
  }
  return changed;
}

/**
 * Footers that stand as bare text between `<br>` ("This article … first appeared on …", "Discuss this article in our forums"), not in a block of
 * their own. Each such line is checked like a block; the breaks left at the end of the container go with them.
 */
function lineFooters(root: ContentRoot, stats: Record<string, number>, total: number): boolean {
  let changed = false;
  const containers: ParentNode[] = [root, ...root.querySelectorAll("div, p, li, td, section, article, main, blockquote")];
  for (const container of containers) {
    if (![...container.childNodes].some(node => node.nodeName === "BR")) continue;
    let removed = false;
    for (const line of linesOf(container)) {
      if (line.length === 0 || !isPlainLine(line)) continue;
      const text = flat(line.map(node => node.textContent ?? "").join(""));
      if (text === "" || text.length > 400) continue;
      const anywhere = BOILERPLATE_ANYWHERE.some(pattern => pattern.test(text));
      const trailing = !anywhere && total > 0 && textBefore(root, line[0]!) / total >= AFTER_SHARE && BOILERPLATE_TRAILING.some(pattern => pattern.test(text));
      if (!anywhere && !trailing) continue;
      const after = line[line.length - 1]!.nextSibling;
      line.forEach(node => node.parentNode?.removeChild(node));
      if (after?.nodeName === "BR") after.parentNode?.removeChild(after);
      count(stats, "boilerplate");
      removed = true;
    }
    if (!removed) continue;
    while (container.lastChild && (container.lastChild.nodeName === "BR" || (container.lastChild.nodeType === 3 && flat(container.lastChild.textContent) === ""))) container.removeChild(container.lastChild);
    changed = true;
  }
  return changed;
}
