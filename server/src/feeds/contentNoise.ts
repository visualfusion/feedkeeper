import { JSDOM } from "jsdom";

/**
 * Publisher pages carry page chrome inside the article body: breadcrumbs, dateline repeats, player leftovers,
 * recommendation lists, follow prompts. This module removes it in two layers that follow one principle:
 *
 * - `cleanReaderHtml` is what a reader shows. It removes only what cannot work in a reader or merely repeats what
 *   the reader already shows (breadcrumbs, in-page jump links, a date line, the headline, consent placeholders,
 *   player labels). Attribution, sponsored and affiliate content, disclosures and a publisher's own calls to action
 *   stay: a source's revenue model is not ours to remove.
 * - `derivedText` and `cleanSnippet` feed text that is not read as a page (snippets, search, teasers, curation).
 *   There noise only costs relevance, so credits, ads, calls to action and recommendation lists go as well.
 *
 * Rules are structural or generic idioms. A phrase belongs here only when more than one publisher uses it.
 */

const BLOCKS = "p, li, h1, h2, h3, h4, h5, h6, blockquote, figcaption, dt, dd, td, th, pre";

/** What was left out, by rule, so a rule that fires too often or never can be seen. */
export type NoiseStats = Record<string, number>;

function flat(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function leafBlocks(root: ParentNode): Element[] {
  return [...root.querySelectorAll(`${BLOCKS}, div`)].filter(element =>
    !element.querySelector(BLOCKS) && (element.tagName !== "DIV" || !element.querySelector("div")));
}

function charsBefore(root: DocumentFragment, element: Element): number {
  const range = root.ownerDocument.createRange();
  range.setStart(root, 0);
  range.setEndBefore(element);
  return range.toString().length;
}

const BREADCRUMB_MARKERS = [
  "[aria-label*='breadcrumb' i]",
  "[itemtype*='BreadcrumbList' i]",
  "[class~='breadcrumb']",
  "[class~='breadcrumbs']",
];

const LANGUAGE_NAMES = ["English", "Deutsch", "Français", "Español", "Italiano", "Português", "Nederlands", "Polski", "Türkçe",
  "Русский", "日本語", "한국어", "简体字", "繁體字", "简体中文", "繁體中文", "中文", "العربية"];

const CONSENT_ANCHORS = [
  /^Empfohlener redaktioneller Inhalt\b/i,
  /An dieser Stelle findest du einen externen Inhalt/i,
  /Du kannst ihn dir mit einem Klick anzeigen lassen/i,
];
const CONSENT_COMPANIONS = [
  /\bInhalte? (von \S+ )?erlauben\b/i, /-Inhalte erlauben\b/i, /^Ich bin damit einverstanden, dass mir .+ angezeigt werden/i,
  /Personenbezogene Daten können an Drittplattformen/i, /^Link zum .+-Inhalt$/i, /^Mehr dazu in unserer Datenschutzerklärung/i,
];

const PRODUCT_CARD_CHARACTERS = 220;
/** An amount of money: `88,89 EUR`, `$199`, `19.99 €`. */
const PRICE = /(?:\d[\d.,]*\s?(?:€|EUR|\$|USD|£|GBP|CHF)|(?:€|\$|£)\s?\d)/;
const MONTHS = "Januar|Februar|März|Maerz|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember|January|February|March|June|July|October|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|Jan\\.|Feb\\.";
const TIME_OF_DAY = "(?:[,\\s•·|-]+\\d{1,2}[:.]\\d{2}(?::\\d{2})?(?:\\s?(?:Uhr|[ap]\\.?m\\.?))?)?";
/** A whole line that is a date, with or without a time: `15. Oktober 2026, 10:51 Uhr`, `Oct 15, 2026`, `15.10.2026`. */
const DATE_PART = `(?:\\d{1,2}\\.\\s?\\d{1,2}\\.\\s?\\d{2,4}|\\d{1,2}\\.?\\s(?:${MONTHS})\\.?\\s\\d{4}|(?:${MONTHS})\\.?\\s\\d{1,2},?\\s\\d{4})`;
const DATE_ONLY = new RegExp(`^${DATE_PART}${TIME_OF_DAY}$`, "iu");
/** The date at the end of a byline (`von Michael Bartl I 15.10.2026 - 11:41`): the author stays, the date is in the reader's head. */
const BYLINE = /^(von|by|text|autor(in)?|author|written by|words by|story by|report(ed)? by|posted by|photo(s)? by)\b/i;
const BYLINE_DATE_TAIL = new RegExp(`(?:^|\\s)[|•·–—I-]\\s*${DATE_PART}${TIME_OF_DAY}\\s*$`, "iu");

function stripBylineDate(block: Element): boolean {
  const walker = block.ownerDocument.createTreeWalker(block, 4);
  let last: Text | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) if (flat(node.textContent)) last = node as Text;
  if (!last || !BYLINE_DATE_TAIL.test(last.data)) return false;
  last.data = last.data.replace(BYLINE_DATE_TAIL, "");
  return true;
}
/** A whole line that is a reading time: `2 min`, `5 Min. Lesezeit`, `Lesezeit: 3 Minuten`, `4 min read`. */
const READING_TIME_ONLY = /^(?:Lesezeit:?\s*)?\d{1,3}\s*(?:min\.?|minuten?|minutes?)(?:\s*(?:Lesezeit|read|lesen))?$/i;

/** JSON-LD and similar: an object with a schema context or type, standing as text. */
function isStructuredData(text: string): boolean {
  if (text.length < 20 || !text.startsWith("{") || !/"@(context|type)"/.test(text)) return false;
  try { return typeof JSON.parse(text) === "object"; } catch { return false; }
}

function removeReaderNoise(root: DocumentFragment, title: string | null | undefined, stats: NoiseStats, author?: string | null): boolean {
  let changed = false;
  const drop = (element: Element, rule: string) => {
    if (!element.parentNode) return;
    element.remove();
    stats[rule] = (stats[rule] ?? 0) + 1;
    changed = true;
  };

  for (const selector of BREADCRUMB_MARKERS) {
    try { root.querySelectorAll(selector).forEach(element => drop(element, "breadcrumb")); } catch { /* selector unsupported by the DOM */ }
  }
  // Breadcrumbs without markup hints: a short list near the start whose items are single short links.
  for (const list of root.querySelectorAll("ol, ul")) {
    const items = [...list.children].filter(child => child.tagName === "LI");
    if (items.length < 2 || items.length > 8 || charsBefore(root, list) > 300) continue;
    const onlyLinks = items.every(item => {
      const links = item.querySelectorAll("a");
      const label = flat(item.textContent);
      return links.length === 1 && label.length > 0 && label.length <= 30 && flat(links[0].textContent) === label;
    });
    if (onlyLinks) drop(list, "breadcrumb");
  }

  // A product card of a shop link: its picture is a CSS background, which no reader draws, and its price is a snapshot
  // that is out of date when the article is read later. What is left would be a label, a link and a number.
  for (const shell of [...root.querySelectorAll("[style*='url(' i]")]) {
    if (!shell.parentNode || !/background(-image)?\s*:[^;]*url\(/i.test(shell.getAttribute("style") ?? "") || flat(shell.textContent) !== "") continue;
    let card: Element | null = null;
    for (let ancestor = shell.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const text = flat(ancestor.textContent);
      if (text.length > PRODUCT_CARD_CHARACTERS) break;
      if (ancestor.querySelector("a[href]") && PRICE.test(text)) card = ancestor;
    }
    if (card) {
      const parent = card.parentElement;
      drop(card, "product-card");
      // A long product name can put the enclosing header just beyond the card's size limit.
      if (parent && PRODUCT_LABEL.test(flat(parent.textContent)) && !parent.querySelector("img, picture, iframe, video, a[href]")) {
        drop(parent, "empty-product-label");
      }
    }
  }

  // Structured data is for machines. Frameworks render it as an element of any name (`<component type="application/ld+json">`),
  // and a stray block may hold nothing else: neither is text for a reader.
  for (const element of [...root.querySelectorAll("[type]")]) {
    if (/^application\/([\w.+-]*\+)?json(;.*)?$/i.test(element.getAttribute("type") ?? "")) drop(element, "structured-data");
  }
  for (const block of leafBlocks(root)) {
    if (block.parentNode && isStructuredData(flat(block.textContent))) drop(block, "structured-data");
  }

  const headline = normalized(title ?? "");
  const seen = new Set<string>();
  const authorKeys = (author ?? "").split(",").map(name => normalized(name)).filter(Boolean);
  const cleanByline = (block: Element, text: string) => {
    if (!BYLINE.test(text)) return;
    if (authorKeys.length > 0 && authorKeys.every(name => normalized(text).includes(name))) { drop(block, "byline"); return; }
    if (stripBylineDate(block)) { stats["byline-date"] = (stats["byline-date"] ?? 0) + 1; changed = true; }
  };
  // Some publishers use an inline wrapper as a standalone byline. Never treat spans inside prose as metadata.
  for (const span of root.querySelectorAll("span")) {
    if (!root.contains(span) || span.closest(BLOCKS) || span.querySelector(`${BLOCKS}, div`)) continue;
    const text = flat(span.textContent);
    if (text.length > 60 || !BYLINE.test(text) || charsBefore(root, span) > 800) continue;
    if ([...(span.parentNode?.childNodes ?? [])].some(node => node !== span && node.nodeType === 3 && flat(node.textContent))) continue;
    if ([...(span.parentElement?.children ?? [])].some(sibling => sibling !== span &&
      !sibling.matches(`${BLOCKS}, div, article, section, header, footer, figure, ul, ol, table, aside`) && flat(sibling.textContent))) continue;
    cleanByline(span, text);
  }
  let leading = 0;
  let reachedText = false;
  let pastStart = false;
  for (const block of leafBlocks(root)) {
    const text = flat(block.textContent);
    if (!text) continue;
    const position = leading++;
    const heading = /^H[1-3]$/.test(block.tagName);
    // Before the first real paragraph: a standalone date and a section chip repeat what the page head says.
    if (!reachedText && text.length >= 80) reachedText = true;
    if (!reachedText && position < 12) {
      const anchorsInBlock = block.querySelectorAll("a");
      const chip = anchorsInBlock.length === 1 && flat(anchorsInBlock[0].textContent) === text && text.length <= 30 && text.split(" ").length <= 3;
      if (chip) { drop(block, "section-chip"); continue; }
      if (/^(\d{1,2}\.\s?\d{1,2}\.\s?\d{2,4}|[A-Z][a-z]{2,8}\.? \d{1,2}, \d{4})([,\s•·|-]+\d{1,2}[:.]\d{2}( Uhr)?)?$/.test(text)) { drop(block, "dateline"); continue; }
    }

    // Near the start, a line that is only a date or a reading time repeats what the reader shows in its own head.
    if (!pastStart && text.length <= 60) {
      const before = charsBefore(root, block);
      if (before > 800) {
        pastStart = true;
      } else {
        if (DATE_ONLY.test(text)) { drop(block, "dateline"); continue; }
        if (READING_TIME_ONLY.test(text)) { drop(block, "reading-time"); continue; }
        // When the feed names the author, the reader shows the name in its head: a byline that only says that goes.
        cleanByline(block, text);
        if (!root.contains(block)) continue;
      }
    }
    if (headline && normalized(text) === headline && (position < 4 || (heading && position < 14))) { drop(block, "title-repeat"); continue; }
    if (position < 14 && /^(Audiobeitrag|Videobeitrag)\s*>/.test(text) && headline && normalized(text).endsWith(headline)) { drop(block, "title-repeat"); continue; }
    if (/^[>›»|/·•–—-]+$/.test(text)) { drop(block, "separator"); continue; }
    if (/^(Audiobeitrag|Videobeitrag|Autoplay)$/i.test(text) || (position < 8 && /^Bild$/.test(text))) { drop(block, "player"); continue; }
    if (!pastStart && text.length <= 70 && block.querySelector("time") && charsBefore(root, block) <= 600) {
      const rest = flat(text.replace(flat(block.querySelector("time")?.textContent), ""));
      if (/^(stand|zuletzt aktualisiert|aktualisiert|ver(ö|oe)ffentlicht|updated|published|posted)?\s*[:·|•-]*\s*$/i.test(rest)) { drop(block, "dateline"); continue; }
    }
    const anchors = block.querySelectorAll("a");
    if (text.length <= 60 && anchors.length === 1 && anchors[0].getAttribute("href")?.startsWith("#") && flat(anchors[0].textContent) === text) {
      drop(block, "jump-link"); continue;
    }
    if (text.length <= 200 && /^\d{1,2}:\d{2}\b/.test(text) && /\bAutoplay\b/i.test(text)) { drop(block, "player"); continue; }
    if (text.length <= 160 && LANGUAGE_NAMES.filter(name => text.includes(name)).length >= 4) { drop(block, "language-switch"); continue; }
    if (position < 10 && text.length >= 30) {
      const key = normalized(text);
      if (seen.has(key)) { drop(block, "repeat"); continue; }
      seen.add(key);
    }
  }

  // A comment section's house rules at the end of the text: no reader has comments, so heading and what follows go.
  const total = (root.textContent ?? "").length;
  for (const block of leafBlocks(root)) {
    if (!block.parentNode || !COMMENT_RULES_HEADING.test(flat(block.textContent))) continue;
    if (total - charsBefore(root, block) > TAIL_CHARACTERS) continue;
    let node: Node = block;
    while (node.parentNode && node !== root) {
      while (node.nextSibling) node.nextSibling.remove();
      node = node.parentNode;
    }
    drop(block, "comment-rules");
    break;
  }

  // Empty nested slots are structural evidence: the next story paragraph is outside this ad container.
  // Do not infer an empty ad from a standalone heading followed by text (which may itself be sponsored).
  for (const container of [...root.querySelectorAll("div, aside, section, p")]) {
    if (!root.contains(container)) continue;
    const text = flat(container.textContent);
    const product = PRODUCT_LABEL.test(text);
    if (!product && !AD_LABEL.test(text)) continue;
    if (container.querySelector("img, picture, iframe, video, audio, a[href], object, embed")) continue;
    const emptySlot = container.querySelector("div:empty, ins:empty");
    // Readability may remove the empty slot, leaving only its enclosing block and label paragraph.
    const isolated = container.matches("div, aside, section") && container.querySelector("p") &&
      (product || AD_SLOT_LABEL.test(text));
    const next = container.nextElementSibling;
    const nextHasMedia = next && (next.matches("img, picture, iframe, video, audio, a[href]") ||
      next.querySelector("img, picture, iframe, video, audio, a[href]"));
    if (emptySlot || (isolated && !nextHasMedia)) drop(container, product ? "empty-product-label" : "empty-ad-label");
  }

  // An ad label whose ad is not there (a script fills it): sponsored content itself stays, the label above nothing goes.
  const labelled = leafBlocks(root);
  labelled.forEach((block, index) => {
    if (!block.parentNode || !AD_LABEL.test(flat(block.textContent)) || block.querySelector("img, iframe, a")) return;
    const sibling = block.nextElementSibling;
    if (sibling && (sibling.matches("img, iframe, video, picture, figure, a") || sibling.querySelector("img, iframe, video, picture, a"))) return;
    const next = labelled.slice(index + 1).find(other => other.parentNode && flat(other.textContent));
    if (!next || /^H[1-6]$/.test(next.tagName) || AD_LABEL.test(flat(next.textContent))) drop(block, "empty-ad-label");
  });

  // Consent placeholders of embedded third-party content: only the neighbours of a known anchor phrase go.
  const blocks = leafBlocks(root);
  blocks.forEach((block, index) => {
    if (!block.parentNode || flat(block.textContent).length > 400 || !CONSENT_ANCHORS.some(pattern => pattern.test(flat(block.textContent)))) return;
    drop(block, "consent-placeholder");
    for (const next of blocks.slice(index + 1, index + 7)) {
      const text = flat(next.textContent);
      if (!next.parentNode || text.length > 220) break;
      if (CONSENT_ANCHORS.some(pattern => pattern.test(text)) || CONSENT_COMPANIONS.some(pattern => pattern.test(text))) drop(next, "consent-placeholder");
    }
  });
  return changed;
}

const PRESENTATIONAL_TAGS = new Set(["FONT", "BIG", "SMALL", "CENTER", "TT", "U", "STRIKE", "S", "BASEFONT", "BLINK", "NOBR", "SPAN", "MARK"]);
const PRESENTATIONAL_ATTRIBUTES = ["style", "class", "color", "face", "size", "bgcolor", "align", "valign", "border", "cellpadding",
  "cellspacing", "background", "hspace", "vspace", "nowrap"];
const SIZED_TAGS = new Set(["IMG", "VIDEO", "CANVAS", "IFRAME", "EMBED", "OBJECT"]);
// Tracking and scripting hooks no client uses. Lazy-load sources stay: they may be an image's only address.
const LAZY_SOURCES = new Set(["data-src", "data-srcset", "data-lazy-src", "data-original"]);
const INERT_ATTRIBUTES = new Set(["role", "tabindex", "itemprop", "itemscope", "itemtype", "itemid", "draggable", "contenteditable"]);

function isInertAttribute(name: string): boolean {
  if (LAZY_SOURCES.has(name)) return false;
  return name.startsWith("data-") || name.startsWith("aria-") || name.startsWith("on") || INERT_ATTRIBUTES.has(name);
}
const EMPHASIS_EXEMPT = "h1, h2, h3, h4, h5, h6, th, strong, b";

function wrapChildren(element: Element, tag: "strong" | "em"): void {
  const wrapper = element.ownerDocument.createElement(tag);
  while (element.firstChild) wrapper.append(element.firstChild);
  element.append(wrapper);
}

/**
 * Typography belongs to the client: fonts, sizes, colours, alignment and classes are removed so that only
 * structure (headings, paragraphs, lists, quotes, tables, links, images) and emphasis (bold, italic) are left.
 * Emphasis that was only a style (`font-weight: bold` on a span) is kept as strong or em.
 */
function removeTypography(root: DocumentFragment, stats: NoiseStats): boolean {
  let changed = false;
  root.querySelectorAll("style, link[rel~='stylesheet']").forEach(node => { node.remove(); changed = true; });
  const targets = new Set([...root.querySelectorAll("a[href^='#']")].map(anchor => (anchor.getAttribute("href") ?? "").slice(1)));
  for (const element of [...root.querySelectorAll("*")]) {
    const style = element.getAttribute("style") ?? "";
    const bold = /font-weight\s*:\s*(bold|bolder|[6-9]00)\b/i.test(style);
    const italic = /font-style\s*:\s*(italic|oblique)\b/i.test(style);
    const plain = !element.matches(EMPHASIS_EXEMPT) && !element.closest(EMPHASIS_EXEMPT) && flat(element.textContent) !== "";
    for (const name of PRESENTATIONAL_ATTRIBUTES) {
      if (element.hasAttribute(name)) { element.removeAttribute(name); changed = true; }
    }
    for (const name of element.getAttributeNames()) {
      if (isInertAttribute(name)) { element.removeAttribute(name); changed = true; }
    }
    if (!SIZED_TAGS.has(element.tagName)) {
      for (const name of ["width", "height"]) {
        if (element.hasAttribute(name)) { element.removeAttribute(name); changed = true; }
      }
    }
    if (plain && bold) wrapChildren(element, "strong");
    if (plain && italic && !element.closest("em, i")) wrapChildren(element, "em");
    const anchorTarget = element.id && targets.has(element.id);
    if (element.id && !anchorTarget) { element.removeAttribute("id"); changed = true; }
    if (element.tagName === "A" && element.hasAttribute("name") && !targets.has(element.getAttribute("name") ?? "")) { element.removeAttribute("name"); changed = true; }
    if (PRESENTATIONAL_TAGS.has(element.tagName) && !anchorTarget) {
      element.replaceWith(...element.childNodes);
      changed = true;
    }
  }
  if (changed) stats["typography"] = (stats["typography"] ?? 0) + 1;
  return changed;
}

function serialize(root: DocumentFragment): string {
  const holder = root.ownerDocument.createElement("div");
  holder.append(root);
  return holder.innerHTML;
}

/** The article HTML as a reader should show it. Unchanged input is returned as is. */
export function cleanReaderHtml(html: string, title?: string | null, stats: NoiseStats = {}, author?: string | null): string {
  if (!html) return html;
  const root = JSDOM.fragment(html);
  const images = resolveCustomImages(root, stats);
  const duplicates = collapseAdjacentImages(root, stats);
  const variants = collapseImageVariants(root, stats);
  const videos = resolveVideoPlayers(root, stats);
  const noise = removeReaderNoise(root, title, stats, author);
  const typography = removeTypography(root, stats);
  videos.links.forEach(link => { if (root.contains(link)) link.setAttribute("data-media", "video"); });
  return images || duplicates || variants || videos.changed || noise || typography ? serialize(root) : html;
}

const PLAY_LABEL = /^(video starten|video abspielen|abspielen|wiedergabe( starten)?|play( video)?|watch( video)?|start video)$/i;
const PLAY_SOURCE = /(?:^|[/_.-])play[-_]?(?:icon|button|btn)?\.(?:svg|png|webp|gif)(?:[?#]|$)/i;
const DURATION = /^\d{1,2}:\d{2}(:\d{2})?$/;
const PLAYER_BLOCK_LIMIT = 120;

function isPlayOverlay(image: Element): boolean {
  return PLAY_LABEL.test(flat(image.getAttribute("alt"))) || PLAY_SOURCE.test((image.getAttribute("src") ?? "").trim());
}

/** Takes away what is left empty once a player is gone, up to (not including) the fragment itself. */
function pruneEmpty(node: Node | null): void {
  while (node && node.parentNode && node.nodeType === 1) {
    const element = node as Element;
    if (flat(element.textContent) !== "" || element.querySelector("img, picture, video, iframe, a[href]")) return;
    const parent: Node | null = element.parentNode;
    element.remove();
    node = parent;
  }
}

/** Direct video URL of the embeds that are common enough to be worth a link. Anything else is not turned into a link. */
function embedTarget(source: string): { url: string; name: string } | null {
  let address: URL;
  try { address = new URL(source.startsWith("//") ? `https:${source}` : source); } catch { return null; }
  const host = address.hostname.replace(/^www\./, "");
  const segments = address.pathname.split("/").filter(Boolean);
  if (/^youtube(-nocookie)?\.com$/.test(host) && segments[0] === "embed" && /^[\w-]{6,}$/.test(segments[1] ?? "")) {
    return { url: `https://www.youtube.com/watch?v=${segments[1]}`, name: "YouTube" };
  }
  if (host === "player.vimeo.com" && segments[0] === "video" && /^\d+$/.test(segments[1] ?? "")) {
    return { url: `https://vimeo.com/${segments[1]}`, name: "Vimeo" };
  }
  if (host === "dailymotion.com" && segments[0] === "embed" && segments[1] === "video" && /^\w+$/.test(segments[2] ?? "")) {
    return { url: `https://www.dailymotion.com/video/${segments[2]}`, name: "Dailymotion" };
  }
  return null;
}

function videoLink(document: Document, url: string, text: string): Element {
  const paragraph = document.createElement("p");
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.textContent = text;
  paragraph.append(link);
  return paragraph;
}

/**
 * Players need the publisher's script: a reader without it shows their play-button picture as a broken image and
 * leaves a dead block. What can be reached stays as one plain link to the video (`data-media="video"` tells a client
 * that the target is a video page); what cannot, because the player is a script-driven button without an address,
 * is left out. The video itself is never embedded here: that is for the client to decide.
 */
function resolveVideoPlayers(root: DocumentFragment, stats: NoiseStats): { changed: boolean; links: Element[] } {
  const links: Element[] = [];
  let changed = false;
  const count = () => { stats["video"] = (stats["video"] ?? 0) + 1; changed = true; };

  for (const image of [...root.querySelectorAll("img")].filter(isPlayOverlay)) {
    if (!root.contains(image)) continue;
    const anchor = image.closest("a[href]");
    if (anchor) {
      const parent = anchor.parentNode;
      image.remove();
      const href = anchor.getAttribute("href");
      const scope = anchor.closest("p, div, figure, li") ?? anchor.parentElement;
      const twin = scope ? [...scope.querySelectorAll("a[href]")].find(other => other !== anchor && other.getAttribute("href") === href) : undefined;
      const label = flat(anchor.textContent);
      if (twin) {
        anchor.remove();
        pruneEmpty(parent);
        links.push(twin);
      } else {
        if (label === "" || DURATION.test(label)) anchor.textContent = flat(anchor.getAttribute("title")) || "Video";
        links.push(anchor);
      }
      count();
      continue;
    }
    // The player block is the widest wrapper that holds nothing but the label, the picture and no link to follow.
    let block: Element = image;
    while (block.parentElement) {
      const parent: Element = block.parentElement;
      if (flat(parent.textContent).length > PLAYER_BLOCK_LIMIT || parent.querySelector("a[href]") || parent.querySelectorAll("img").length > 1) break;
      block = parent;
    }
    const parent = block.parentNode;
    block.remove();
    pruneEmpty(parent);
    count();
  }

  for (const frame of [...root.querySelectorAll("iframe")]) {
    const target = embedTarget(frame.getAttribute("src") ?? frame.getAttribute("data-src") ?? "");
    if (!target) continue;
    const parent = frame.parentNode;
    const replacement = videoLink(frame.ownerDocument, target.url, flat(frame.getAttribute("title")) || target.name);
    frame.replaceWith(replacement);
    pruneEmpty(parent);
    links.push(replacement.querySelector("a") as Element);
    count();
  }

  for (const video of [...root.querySelectorAll("video")]) {
    const source = (video.getAttribute("src") ?? video.querySelector("source[src]")?.getAttribute("src") ?? "").trim();
    if (!/^https?:\/\//i.test(source)) continue;
    const replacement = videoLink(video.ownerDocument, source, flat(video.getAttribute("title")) || "Video");
    video.replaceWith(replacement);
    links.push(replacement.querySelector("a") as Element);
    count();
  }
  return { changed, links };
}

/**
 * Some publishers wrap a picture in their own element and let a script fill the image: `<a-img src="/imgs/…">`
 * around an `<img>` that only holds a grey placeholder. Without the script no reader would ever show the picture, so
 * the wrapper's address takes the placeholder's place and the wrapper, which means nothing outside the page, goes.
 */
function resolveCustomImages(root: DocumentFragment, stats: NoiseStats): boolean {
  let changed = false;
  for (const wrapper of [...root.querySelectorAll("a-img")]) {
    const source = (wrapper.getAttribute("src") ?? "").trim();
    if (source && !/^data:/i.test(source)) {
      let image = wrapper.querySelector("img");
      if (!image) {
        image = wrapper.ownerDocument.createElement("img");
        image.setAttribute("alt", wrapper.getAttribute("alt") ?? "");
        wrapper.append(image);
      }
      const current = (image.getAttribute("src") ?? "").trim();
      if (!current || /^data:/i.test(current)) image.setAttribute("src", source);
    }
    wrapper.replaceWith(...wrapper.childNodes);
    changed = true;
  }
  if (changed) stats["custom-image"] = (stats["custom-image"] ?? 0) + 1;
  return changed;
}

/**
 * Publishers put one badge in two colour schemes into a link (`<a><img alt="X"><img alt="X"></a>`) and let their
 * stylesheet show one of them. A reader has no such stylesheet, so both stand there at full size. Images that carry
 * the same label inside one link and no other text are variants of one thing: the link keeps its label as text, or,
 * without a label, its first image. The call to action itself stays.
 */
function collapseImageVariants(root: DocumentFragment, stats: NoiseStats): boolean {
  let changed = false;
  for (const anchor of [...root.querySelectorAll("a")]) {
    const images = [...anchor.querySelectorAll("img")];
    if (images.length < 2 || flat(anchor.textContent) !== "") continue;
    const labels = new Set(images.map(image => flat(image.getAttribute("alt"))));
    if (labels.size !== 1) continue;
    const [label] = labels;
    if (label) anchor.replaceChildren(anchor.ownerDocument.createTextNode(label));
    else images.slice(1).forEach(image => image.remove());
    stats["image-variants"] = (stats["image-variants"] ?? 0) + 1;
    changed = true;
  }
  return changed;
}

/** Responsive copies may be separate images whose CSS normally hides one. Only exact adjacent copies go;
 * text, other media, different links, captions and responsive sources keep images distinct. */
function collapseAdjacentImages(root: DocumentFragment, stats: NoiseStats): boolean {
  const walker = root.ownerDocument.createTreeWalker(root, 1 | 4);
  let previous: string | null = null;
  const duplicates: Element[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === 3) {
      if (flat(node.textContent)) previous = null;
      continue;
    }
    const element = node as Element;
    if (element.matches("video, audio, iframe, object, embed, hr")) previous = null;
    if (element.tagName !== "IMG") continue;
    const src = flat(element.getAttribute("data-src") || element.getAttribute("data-lazy-src") ||
      element.getAttribute("data-original") || element.getAttribute("src"));
    if (!src || /^(data|blob):/i.test(src)) { previous = null; continue; }
    const picture = element.closest("picture");
    const key = JSON.stringify([src, element.getAttribute("srcset"), element.getAttribute("data-srcset"),
      element.getAttribute("alt"), element.getAttribute("title"), element.closest("a")?.getAttribute("href"),
      [...(picture?.querySelectorAll("source") ?? [])].map(source =>
        [source.getAttribute("srcset"), source.getAttribute("media"), source.getAttribute("type")])]);
    if (previous === key) duplicates.push(picture?.querySelectorAll("img").length === 1 ? picture : element);
    else previous = key;
  }
  for (const duplicate of duplicates) {
    const parent = duplicate.parentNode;
    duplicate.remove();
    pruneEmpty(parent);
    stats["duplicate-image"] = (stats["duplicate-image"] ?? 0) + 1;
  }
  return duplicates.length > 0;
}

const CREDIT_PATTERNS: RegExp[] = [
  /^(©|\(c\)\s|copyright\b)/i,
  /^[([]?(Bild|Foto|Fotos|Bildquelle|Bildrechte|Bildnachweis|Titelbild|Beitragsbild|Photo|Image|Credits?|Grafik|Illustration)[)\]]?\s*[:/|]/i,
  /\|\s*(Image|Photo|Foto|Bild|Credit)s?\s*:/i,
  /\(\s*(Bildquelle|Bildrechte|Foto|Bild|Photo|Image|Credit|Quelle)\s*:[^)]{1,60}\)\s*\.?$/i,
  /\bBildrechte:\s*(Bildrechte:\s*)?[^.]{1,60}$/i,
  /©[^\n]{1,40}$/,
  /\/\s*(Getty Images|Reuters|AP|AFP|dpa|Imago)\s*$/i,
  /\bvia (REUTERS|Reuters|AP|AFP|dpa|Getty Images|Imagen)\s*$/,
  /^Quelle:?\s*\S{0,40}$/i,
];
const HEAD_META_PATTERNS: RegExp[] = [
  /^(Stand|Aktualisiert|Zuletzt aktualisiert|Ver(ö|oe)ffentlicht|Updated|Published|Posted)\b.{0,40}\d/i,
  /^von\s+.{2,40}\s[I|]\s+\d{1,2}\.\d{1,2}\.\d{2,4}/i,
  /^(\d{1,2}\.\s?\d{1,2}\.\s?\d{2,4}|[A-Z][a-z]{2,8}\.? \d{1,2}, \d{4})([,\s•·|-]+\d{1,2}[:.]\d{2}( Uhr)?)?$/,
  /^\p{L}[\p{L}\p{N} .&-]{0,30}\s(\d{1,2}\.\s?\d{1,2}\.\s?\d{2,4}|[A-Z][a-z]{2,8}\.? \d{1,2}, \d{4})([,\s•·|-]+\d{1,2}[:.]\d{2}( Uhr)?)?$/u,
  /^(Kommentare|Kommentieren|Comments|Teilen|Share|Drucken|Print|Merken|Vorlesen)$/i,
  /^(Schlagw(ö|oe)rter|Schlagworte|Tags?|Keywords|Themen)\s*:?\s+[^.!?]{0,160}$/i,
];
const AD_PATTERNS: RegExp[] = [
  /^(Anzeige|Werbung|Advertisement|Advertorial|Sponsored|Gesponsert|Promoted)\s*:?$/i,
  /\b(affiliate|partner)[- ]?links?\b/i,
  /\bwe (may|might) (receive|earn) a commission\b/i,
  /^FTC:/i,
  /\bClick Here to Buy\b/i,
  /^Hurry,/i,
  /^Worth checking out on Amazon/i,
  /\bProvision\b.{0,60}\b(Links?|Einkäufe|Käufe)\b/i,
];
const SOCIAL_NETWORKS = ["Facebook", "Instagram", "Reddit", "Threads", "Twitter", "Mastodon", "YouTube", "TikTok", "Google News", "Flipboard", "WhatsApp", "LinkedIn"];
const CALL_TO_ACTION_PATTERNS: RegExp[] = [
  /\b(bevorzugte[nr]?\s+(Google-)?Quelle|bei Google bevorzugen|preferred source)\b/i,
  /\bWo du uns folgen kannst\b/i,
  /^Folge[nt]? uns\b/i,
  /\bFolge uns auch auf\b/i,
  /\bUns auf Google folgen\b/i,
  /\bfollow us\b/i,
  /\bFügt uns doch bei Google\b/i,
  /\bAuf dem Laufenden bleiben\?/i,
  /\bNewsletter\b.{0,240}\b(Anmeldung|anmelden|abonnier\w*|subscribe)\b/i,
  /\b(subscribe|abonnier\w+)\b.{0,60}\b(newsletter|YouTube|channel|Kanal)\b/i,
  /\bBy subscribing\b/i,
  /^SUBSCRIBE NOW$/i,
  /^Hier geht'?s zur Anmeldung!?$/i,
  /^★.+★$/,
];
const COMMENT_PATTERNS: RegExp[] = [
  /\b(let us know|tell us) .{0,40}in the comments\b/i,
  /\bNur angemeldete Benutzer können kommentieren\b/i,
];
const AD_LABEL = /^(Anzeige|Werbung|Advertisement|Advertising|Advertorial|Ads?|Sponsored( content| post)?|Paid (content|post)|Gesponsert|Promoted|広告|広告掲載|スポンサー(?:記事|コンテンツ)?|宣伝|PR)\s*[:：]?$/i;
const AD_SLOT_LABEL = /^(Anzeige|Werbung|Advertisement|Advertising|Ads?|広告|広告掲載|宣伝)\s*[:：]?$/i;
const PRODUCT_LABEL = /^(Produkthinweis|Produktempfehlung|Product (notice|recommendation)|商品紹介|商品案内|製品紹介)\s*[:：]?$/i;
const COMMENT_RULES_HEADING = /^(Regeln für Kommentare|Kommentarregeln|Kommentar-Richtlinien|Community[- ]Richtlinien|(Comment(ing)?|Community|Discussion|House) (rules|guidelines|policy|policies)|Rules for comments|Commenting rules)\s*:?$/i;
const TAG_LABEL = /^(Schlagw(ö|oe)rter|Schlagworte|Tags?|Keywords|Themen|Topics)\s*:?$/i;
const VIDEO_CARD = /^\d{1,2}:\d{2}(:\d{2})?(?=\D)\s*\S/;
const SECTION_LABEL = /^(Auch interessant|Das könnte (dich|Sie|euch) (auch )?interessieren|Mehr zum Thema|Lesen Sie auch|Lies auch|Lest auch|Aktuelle News|Weitere (Artikel|Meldungen|News)|Popular Stories|Related (Stories|Articles|Posts|Reading)|More (Stories|from)|Top Stories|Meistgelesen|Topaktuell|Regeln für Kommentare|Kommentare|Comments?)\b\s*:?/i;

const MIN_KEPT_CHARACTERS = 150;
const HEAD_BLOCKS = 6;
const TAIL_CHARACTERS = 1500;
const TAIL_CUT_FROM = 0.6;

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some(pattern => pattern.test(text));
}

function isSocialList(text: string): boolean {
  return text.length <= 200 && SOCIAL_NETWORKS.filter(name => text.includes(name)).length >= 3;
}

function isLinkOnly(block: Element, text: string): boolean {
  const anchors = block.querySelectorAll("a");
  return anchors.length === 1 && flat(anchors[0].textContent) === text;
}

/**
 * Plain, single-line publisher text without page chrome: for snippets, search, teasers and curation, never for
 * display as a page. Falls back to the plain flattening when cleaning would leave almost nothing.
 */
export function derivedText(html: string | null | undefined, title?: string | null, stats: NoiseStats = {}): string {
  if (!html) return "";
  const root = JSDOM.fragment(html);
  root.querySelectorAll("script, style, noscript, nav, footer").forEach(node => node.remove());
  const plain = () => {
    root.querySelectorAll("p, div, br, li, h1, h2, h3, h4, blockquote").forEach(node => node.append(" "));
    return flat(root.textContent);
  };
  removeReaderNoise(root, title, stats);
  root.querySelectorAll("figcaption").forEach(node => node.remove());

  const entries = leafBlocks(root).map(element => ({ element, text: flat(element.textContent) })).filter(entry => entry.text);
  const total = entries.reduce((sum, entry) => sum + entry.text.length, 0);
  if (entries.length === 0 || total < 2 * MIN_KEPT_CHARACTERS) return plain();

  const dropped = new Set<number>();
  const mark = (index: number, rule: string) => {
    if (dropped.has(index)) return;
    dropped.add(index);
    stats[rule] = (stats[rule] ?? 0) + 1;
  };
  let before = 0;
  let cutAt = -1;
  entries.forEach((entry, index) => {
    const { text } = entry;
    const early = index < HEAD_BLOCKS || before <= 600;
    const late = total - before - text.length <= TAIL_CHARACTERS || index >= entries.length - 8;
    const position = before / total;
    before += text.length;
    if (cutAt >= 0) return;

    if (SECTION_LABEL.test(text) && text.length <= 400) {
      if (position >= TAIL_CUT_FROM && before - text.length >= MIN_KEPT_CHARACTERS) { cutAt = index; stats["recommendations"] = (stats["recommendations"] ?? 0) + 1; return; }
      mark(index, "recommendations");
      for (let next = index + 1; next < entries.length && isLinkOnly(entries[next].element, entries[next].text); next++) mark(next, "recommendations");
      return;
    }
    if (TAG_LABEL.test(text)) {
      mark(index, "head-meta");
      for (let next = index + 1; next < entries.length && isLinkOnly(entries[next].element, entries[next].text); next++) mark(next, "head-meta");
      return;
    }
    if (text.length > 400) return;
    if (text.length <= 160 && VIDEO_CARD.test(text) && entry.element.querySelector("a")) mark(index, "player");
    else if (matchesAny(text, AD_PATTERNS)) mark(index, "advertising");
    else if (text.length <= 300 && (early || late) && matchesAny(text, CALL_TO_ACTION_PATTERNS)) mark(index, "call-to-action");
    else if (text.length <= 300 && late && matchesAny(text, COMMENT_PATTERNS)) mark(index, "comments");
    else if (isSocialList(text)) mark(index, "call-to-action");
    else if (early && text.length <= 160 && matchesAny(text, HEAD_META_PATTERNS)) mark(index, "head-meta");
    else if ((early || late) && text.length <= 300 && matchesAny(text, CREDIT_PATTERNS)) {
      mark(index, "credit");
      // In the head a credit line follows the caption it belongs to.
      const caption = entries[index - 1];
      if (early && caption && index - 1 < HEAD_BLOCKS && caption.text.length <= 200 && /^(©|\(c\)|copyright|Bildrechte|Bildquelle|Foto|Photo|Image|Credit)/i.test(text)) mark(index - 1, "credit");
    }
  });

  const kept = entries.filter((_, index) => !dropped.has(index) && (cutAt < 0 || index < cutAt)).map(entry => entry.text);
  const text = kept.join(" ");
  if (text.length < Math.min(MIN_KEPT_CHARACTERS, total) && text.length < total * 0.7) return plain();
  return text;
}

const SNIPPET_LINE_PATTERNS: RegExp[] = [
  /^(Der|Die|Das) Beitrag .+ (erschien|wurde) zuerst\b.*$/i,
  /^The post .+ appeared first on\b.*$/i,
  /^This article, ".+" first appeared on\b.*$/i,
  /^Discuss this article in our forums\.?$/i,
  /^Read (the )?full story( here| at .+)?\.?$/i,
  /^Zum Beitrag:.*$/i,
  /^(more…|more\.\.\.|Mehr|Weiterlesen|Read more)$/i,
  /^(Related Roundup|Related Forum|Tags?|Buyer's Guide):.*$/i,
  /^★.+★$/,
  /^Wo du uns folgen kannst:.*$/i,
  /^Auf dem Laufenden bleiben\?$/i,
  /^Fügt uns doch bei Google.*$/i,
];
const SNIPPET_INLINE_PATTERNS: RegExp[] = [
  /\s*(Der|Die|Das) Beitrag [^\n]+? (erschien|wurde) zuerst (auf|bei|beim) [^\n]*?\.(?=\s|$)(\s*(Folge uns auch auf|Über unseren Newsletter)[^\n]*?\.(?=\s|$))*/gi,
  /\s*Über unseren Newsletter [^\n]*?\.(?=\s|$)/gi,
  /\s*The post [^\n]+? appeared first on [^\n]*?\.(?=\s|$)/gi,
];

/**
 * A feed's summary without the footers feed plugins append ("The post … appeared first on …", "Read the full
 * story at …"), without a repeated headline and with whitespace collapsed to paragraphs.
 */
export function cleanSnippet(snippet: string | null | undefined, title?: string | null): string | null {
  if (snippet === null || snippet === undefined) return null;
  let text = snippet.replace(/\r\n?/g, "\n").replace(/[ \t\u00a0]+/g, " ");
  for (const pattern of SNIPPET_INLINE_PATTERNS) text = text.replace(pattern, "");
  const headline = normalized(title ?? "");
  const lines = text.split("\n").map(line => line.trim()).filter((line, index) =>
    line && !SNIPPET_LINE_PATTERNS.some(pattern => pattern.test(line)) && !isSocialList(line) &&
    !(index === 0 && headline && normalized(line) === headline));
  return lines.join("\n").trim();
}

/** Raised whenever the rules above change what they remove, so stored leads are derived again. */
export const LEAD_VERSION = 1;
const LEAD_LENGTH = 600;

function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  let slice = text.slice(0, max);
  if (/[\uD800-\uDBFF]$/.test(slice)) slice = slice.slice(0, -1);
  const sentence = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? "));
  if (sentence >= max * 0.5) return slice.slice(0, sentence + 1);
  const space = slice.lastIndexOf(" ");
  return (space >= max * 0.5 ? slice.slice(0, space) : slice).replace(/[\s,;:–-]+$/, "") + "…";
}

/**
 * The beginning of an article as one plain line, for teasers: the cleaned body, or the cleaned feed summary when
 * that says more (a failed download leaves only the summary).
 */
export function leadText(parts: { html?: string | null; snippet?: string | null; title?: string | null }, max = LEAD_LENGTH): string {
  const body = derivedText(parts.html, parts.title);
  const summary = flat(cleanSnippet(parts.snippet, parts.title));
  return shorten(body.length >= summary.length ? body : summary, max);
}
