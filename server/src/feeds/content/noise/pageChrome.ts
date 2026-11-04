import { type ContentRule, count, flat, pruneEmpty } from "../shared.js";

/** A paragraph this long is prose, not a menu entry: an element that holds one is never page chrome, whatever it is called. */
const PROSE_CHARACTERS = 200;

/** What only a site's own navigation contains. */
const NAVIGATION = "nav, [role='navigation'], [role='menubar'], menu";

/** A page header holds the site's navigation, or even the page's main area; an article's own header holds a headline and a byline. */
const PAGE_HEADER_PARTS = `${NAVIGATION}, main`;

function holdsProse(element: Element): boolean {
  return [...element.querySelectorAll("p")].some(paragraph => flat(paragraph.textContent).length >= PROSE_CHARACTERS);
}

/**
 * Some publishers put their whole page header into the text of an article: a menu of magazines with empty entries
 * (their icons are drawn by a stylesheet), service links, the logo and lists of the publisher's other pages. A reader
 * shows all of it before the first line of the story. A header that contains navigation, and any navigation of its own, are
 * the site and not the story: they go, unless prose sits inside, which means the markup is broken and wraps the article.
 */
export const pageChrome: ContentRule = {
  name: "page-chrome",
  description: "A page header that holds the site's navigation, and any navigation element, are removed from the text of an article.",
  apply(root, stats) {
    let changed = false;
    const remove = (element: Element) => {
      if (!element.parentNode || holdsProse(element)) return;
      const parent = element.parentNode;
      element.remove();
      pruneEmpty(parent);
      count(stats, "page-chrome");
      changed = true;
    };
    for (const header of [...root.querySelectorAll("header")].filter(candidate => candidate.querySelector(PAGE_HEADER_PARTS))) remove(header);
    for (const navigation of [...root.querySelectorAll(NAVIGATION)]) remove(navigation);
    return changed;
  },
};
