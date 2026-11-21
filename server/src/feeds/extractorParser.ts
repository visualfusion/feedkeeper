import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { cleanPage } from "./content/index.js";
import { SCRIPT_IMAGE_SOURCE } from "./imageSources.js";

export interface ExtractedArticle {
  title: string | null;
  byline: string | null;
  contentHtml: string;
  textContent: string;
  excerpt: string | null;
  siteName: string | null;
}

export type WorkerExtractionResult =
  | { status: "ok"; article: ExtractedArticle }
  | { status: "consent_wall" }
  | { status: "partial"; article: ExtractedArticle }
  | { status: "paywall" | "failed" };

const CONSENT_SELECTORS = [
  "#onetrust-consent-sdk",
  "#cmpbox",
  "#usercentrics-root",
  "[id*='sp_message_container']",
  "[class*='cookie-banner']",
  "[class*='cookie-consent']",
  "[class*='consent-banner']",
  "[id*='cookie-notice']",
  "[id*='cookie-banner']",
  ".qc-cmp2-container",
  "#didomi-host",
  "dialog[open]",
  ".cookie-wall",
  ".consent-wall",
  "[data-nosnippet]",
];

/** From this many characters of text, a page that calls itself not free still holds the article, and its text is kept. */
const PAYWALL_TEXT_MIN = 2500;

function cleanConsentDom(doc: Document): void {
  for (const sel of CONSENT_SELECTORS) {
    try {
      doc.querySelectorAll(sel).forEach((el) => el.remove());
    } catch {
      // ignore invalid selector in edge environments
    }
  }
}

function isSafeSource(value: string | null): value is string {
  if (!value) return false;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 4000 || /^javascript:/i.test(trimmed)) return false;
  return /^https?:\/\//i.test(trimmed) || /^data:image\//i.test(trimmed) || trimmed.startsWith("/");
}

function resolveLazyImages(doc: Document): void {
  const images = doc.querySelectorAll("img");
  for (const img of images) {
    const lazySrc =
      img.getAttribute("data-lazy-src") ||
      img.getAttribute("data-src") ||
      img.getAttribute("data-original") ||
      img.getAttribute("data-actualsrc");
    const src = img.getAttribute("src");
    if (isSafeSource(lazySrc) && (!src || src.startsWith("data:") || src.length < 10 || SCRIPT_IMAGE_SOURCE.test(src))) {
      img.setAttribute("src", encodeURI(lazySrc.trim()));
    }
    const lazySrcset = img.getAttribute("data-lazy-srcset") || img.getAttribute("data-srcset");
    const srcset = img.getAttribute("srcset");
    if (isSafeSource(lazySrcset) && (!srcset || srcset.startsWith("data:"))) {
      img.setAttribute("srcset", encodeURI(lazySrcset.trim()));
    }
  }
  const sources = doc.querySelectorAll("source");
  for (const source of sources) {
    const lazySrcset = source.getAttribute("data-lazy-srcset") || source.getAttribute("data-srcset");
    if (isSafeSource(lazySrcset)) {
      source.setAttribute("srcset", encodeURI(lazySrcset.trim()));
    }
  }
}

/**
 * Checks if a given URL or extracted HTML/text is a cookie / consent wall rather than article content.
 */
export function isConsentContent(finalUrl: string, html: string, title?: string | null, text?: string | null): boolean {
  if (
    /\/zustimmung[/?]/i.test(finalUrl) ||
    /\/consent[/?]/i.test(finalUrl) ||
    /\/cookie-wall/i.test(finalUrl) ||
    /\/pur-abo[/?]/i.test(finalUrl) ||
    /\/cmp[/?]/i.test(finalUrl) ||
    /\/privacy-wall/i.test(finalUrl)
  ) {
    return true;
  }

  const combined = `${title || ""} ${text || ""} ${html}`.toLowerCase();
  const strongSignatures = [
    "cookies zustimmen",
    "nutzung aller cookies",
    "tracking zustimmen",
    "einwilligung verwalten",
    "werbung und tracking, indem sie",
    "zustimmen & weiter",
    "bevor sie fortfahren",
    "accept all cookies",
    "cookie-einstellungen",
    "alle cookies akzeptieren",
    "cookies akzeptieren",
    "we value your privacy",
  ];

  const headText = `${title || ""} ${text || ""}`.toLowerCase().slice(0, 600);

  const hits = strongSignatures.filter(sig => combined.includes(sig));
  if (hits.length === 0) return false;
  const heading = (title || "").toLowerCase();
  if (strongSignatures.some(sig => heading.includes(sig))) return true;
  return (text || "").length < 1200 && hits.length >= 2 && hits.some(sig => headText.includes(sig));
}

/**
 * Checks cached HTML to see if it was a saved consent banner instead of real article content.
 */
export function isCachedConsentSnippet(html: string): boolean {
  return isConsentContent("", html, "", html.replace(/<[^>]+>/g, " "));
}

/** The link at the end of an article whose publisher flags it as behind a paywall; clients show it as a card. */
function paywallNotice(pageUrl: string): string {
  const address = new URL(pageUrl);
  const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return `<p><a href="${escape(address.href)}" data-media="paywall" data-source="${escape(address.hostname.replace(/^www\./, ""))}">${escape(address.hostname.replace(/^www\./, ""))}</a></p>`;
}

/** Pure CPU-bound JSDOM + Readability extraction so worker threads can run it off the HTTP event loop. */
export function parseArticleHtml(html: string, url: string): WorkerExtractionResult {
  const dom = new JSDOM(html, { url });
  let parsed;
  const paywalled = /"isAccessibleForFree"\s*:\s*(?:false|"false")/i.test(html);
  try {
    // The content rules run first: players and consent plugins keep the address of an embed in the very tags removed next.
    cleanPage(dom.window.document);
    dom.window.document.querySelectorAll("script, style, svg, iframe, noscript").forEach(element => element.remove());
    cleanConsentDom(dom.window.document);
    resolveLazyImages(dom.window.document);

    parsed = new Readability(dom.window.document, { charThreshold: 60 }).parse();
    if (isConsentContent(url, parsed?.content ?? html, parsed?.title, parsed?.textContent)) {
      return { status: "consent_wall" };
    }
    // Publishers flag a whole article as not free although the page carries its text; enough of it is the article.
    if (
      (paywalled && (parsed?.textContent?.length ?? 0) < PAYWALL_TEXT_MIN) ||
      ((parsed?.textContent?.length ?? 0) < PAYWALL_TEXT_MIN &&
        /(?:subscribe to (?:continue|read)|sign in to (?:continue|read)|abonnieren und weiterlesen|nur für abonnenten|jetzt abonnieren.{0,40}weiterlesen)/i.test(
          parsed?.textContent ?? "",
        ))
    ) {
      return { status: "paywall" };
    }
    if (!parsed?.content) return { status: "failed" };
  } finally {
    dom.window.close();
  }

  return {
    status: (parsed.textContent?.trim().length ?? 0) < 200 ? "partial" : "ok",
    article: {
      title: parsed.title || null,
      byline: parsed.byline || null,
      contentHtml: paywalled ? `${parsed.content}${paywallNotice(url)}` : parsed.content,
      textContent: parsed.textContent || "",
      excerpt: parsed.excerpt || null,
      siteName: parsed.siteName || null,
    },
  };
}
