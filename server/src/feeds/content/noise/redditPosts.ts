import { count, flat, parseAddress, type ContentRoot, type NoiseStats } from "../shared.js";

const REDDIT_HOST = /(?:^|\.)reddit\.com$/i;
const REDDIT_USER_PATH = /^\/(?:u|user)\/[^/]+/i;
const REDDIT_COMMENTS_PATH = /^\/r\/[^/]+\/comments\//i;
const SUBMITTED_BY = /\bsubmitted\s+by\b/i;

function isRedditUrl(href: string | null | undefined, pathPattern: RegExp): boolean {
  if (!href) return false;
  const parsed = parseAddress(href);
  return Boolean(parsed && REDDIT_HOST.test(parsed.hostname) && pathPattern.test(parsed.pathname));
}

function isRedditPostTable(table: Element): boolean {
  const rows = [...table.querySelectorAll(":scope > tbody > tr, :scope > tr")];
  if (rows.length !== 1) return false;
  const cells = [...rows[0]!.children].filter(child => child.tagName === "TD");
  if (cells.length === 0 || cells.length > 2) return false;
  const bodyCell = cells[cells.length - 1]!;
  if (!SUBMITTED_BY.test(flat(bodyCell.textContent))) return false;
  const links = [...bodyCell.querySelectorAll("a[href]")];
  const hasAuthor = links.some(link => isRedditUrl(link.getAttribute("href"), REDDIT_USER_PATH));
  const hasComments = links.some(link => flat(link.textContent).toLowerCase() === "[comments]" && isRedditUrl(link.getAttribute("href"), REDDIT_COMMENTS_PATH));
  return hasAuthor && hasComments;
}

function externalLinkHost(href: string): string | null {
  const parsed = parseAddress(href);
  if (!parsed || !/^https?:$/.test(parsed.protocol)) return null;
  if (REDDIT_HOST.test(parsed.hostname) || parsed.hostname === "i.redd.it" || parsed.hostname === "v.redd.it") return null;
  return parsed.hostname.replace(/^www\./i, "");
}

/**
 * Reddit subreddit Atom feeds wrap every post in a 1-row layout `<table>` with a thumbnail cell and a body cell
 * ending in `submitted by /u/… [link] [comments]`. Unwrap the thumbnail and `.md` body and drop the forum chrome.
 */
export function cleanRedditPost(root: ContentRoot, stats: NoiseStats): boolean {
  let changed = false;
  for (const table of [...root.querySelectorAll("table")]) {
    if (!isRedditPostTable(table)) continue;
    const rows = [...table.querySelectorAll(":scope > tbody > tr, :scope > tr")];
    const cells = [...rows[0]!.children].filter(child => child.tagName === "TD");
    const doc = table.ownerDocument;
    const replacement: Node[] = [];

    if (cells.length === 2) {
      const thumbImg = cells[0]!.querySelector("img[src]");
      const src = (thumbImg?.getAttribute("src") ?? "").trim();
      if (thumbImg && src && !/^data:/i.test(src)) {
        const figure = doc.createElement("p");
        const cleanImg = doc.createElement("img");
        cleanImg.setAttribute("src", src);
        const alt = flat(thumbImg.getAttribute("alt"));
        if (alt) cleanImg.setAttribute("alt", alt);
        figure.append(cleanImg);
        replacement.push(figure);
      }
    }

    const bodyCell = cells[cells.length - 1]!;
    const md = bodyCell.querySelector("div.md");
    if (md) {
      for (const child of [...md.childNodes]) {
        if (child.nodeType === 8) continue; // Strip HTML comments (e.g. SC_OFF / SC_ON)
        replacement.push(child);
      }
    }

    // For link posts without body prose, preserve the external target link instead of `[link]`.
    if (!md || flat(md.textContent) === "") {
      const external = [...bodyCell.querySelectorAll("a[href]")].find(
        link => flat(link.textContent).toLowerCase() === "[link]" && externalLinkHost(link.getAttribute("href") ?? ""),
      );
      const href = external?.getAttribute("href") ?? "";
      const host = external ? externalLinkHost(href) : null;
      if (href && host) {
        const p = doc.createElement("p");
        const a = doc.createElement("a");
        a.setAttribute("href", href);
        a.textContent = host;
        p.append("↗ ", a);
        replacement.push(p);
      }
    }

    if (replacement.length > 0) {
      table.replaceWith(...replacement);
    } else {
      table.remove();
    }
    count(stats, "reddit-post");
    changed = true;
  }
  return changed;
}
