import DOMPurify from "dompurify";

export interface SanitizeOptions {
  heroImageUrl?: string | null;
  baseUrl?: string | null;
  /** The words of the link the server puts at the end of an article its publisher flags as behind a paywall. */
  paywallLabel?: string;
}

export function safeHttpUrl(rawUrl: string, baseUrl?: string | null): string | null {
  try {
    const url = new URL(rawUrl, baseUrl || undefined);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function embeddedOriginalUrl(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  for (const [name, value] of url.searchParams) {
    if (!["url", "src", "image", "source"].includes(name.toLowerCase())) continue;
    const inner = safeHttpUrl(value);
    if (inner && inner !== rawUrl) return inner;
  }
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    decodedPath = url.pathname;
  }
  for (const marker of ["/https://", "/http://", "/https:/", "/http:/"]) {
    const idx = decodedPath.indexOf(marker);
    if (idx === -1) continue;
    const tail = decodedPath.slice(idx + 1).replace(/^(https?):\/(?!\/)/i, "$1://");
    const inner = safeHttpUrl(tail);
    if (inner && inner !== rawUrl) return inner;
  }
  return null;
}

function unwrapImageUrl(rawUrl: string | null): string | null {
  let current = rawUrl;
  for (let depth = 0; depth < 3 && current; depth++) {
    const inner = embeddedOriginalUrl(current);
    if (!inner) break;
    current = inner;
  }
  return current;
}

function imageFilename(url: string | null): string {
  const unwrapped = unwrapImageUrl(url);
  if (!unwrapped) return "";
  try {
    return new URL(unwrapped).pathname.split("/").filter(Boolean).at(-1)?.toLowerCase()
      ?.replace(/[-_]\d{2,4}x\d{2,4}(?=\.\w+$)/, "")
      .replace(/\.(?:webp|jpeg)$/, ".jpg") ?? "";
  } catch {
    return "";
  }
}

const sanitizeConfig = {
  USE_PROFILES: { html: true },
  // `data-media` and `data-source` are set by the server for videos, social posts and audio players, which show as a card.
  ALLOWED_ATTR: ["href", "src", "alt", "title", "width", "height", "data-media", "data-source"],
  ALLOW_DATA_ATTR: false,
  FORBID_TAGS: ["form", "input", "button", "textarea", "select", "style", "video", "audio", "source"],
};

function isPixel(img: Element, src: string | null): boolean {
  return (img.getAttribute("width") === "1" && img.getAttribute("height") === "1") ||
    Boolean(src && /feedsportal\.com|feedburner\.com|pixel\.wp\.com|statcounter\.com/i.test(src));
}

function isSmallImage(img: Element): boolean {
  const width = Number(img.getAttribute("width"));
  const height = Number(img.getAttribute("height"));
  return (width > 0 && width < 160) || (height > 0 && height < 100);
}

/** Finds a usable image before the article's main text for the reader hero. */
export function leadingArticleImage(rawHtml: string, baseUrl?: string | null): string | null {
  if (!rawHtml) return null;
  const cleanHtml = DOMPurify.sanitize(rawHtml, sanitizeConfig);
  const doc = new DOMParser().parseFromString(cleanHtml, "text/html");

  for (const img of doc.querySelectorAll("img")) {
    const before = doc.createRange();
    before.selectNodeContents(doc.body);
    before.setEndBefore(img);
    if (before.toString().trim().length > 160) return null;

    const src = safeHttpUrl(img.getAttribute("src") ?? "", baseUrl);
    if (src && !isPixel(img, src) && !isSmallImage(img)) return src;
  }
  return null;
}

/** Sanitizes feed and extracted article HTML before it enters the page. */
export function sanitizeHtml(rawHtml: string, options: SanitizeOptions = {}): string {
  if (!rawHtml) return "";

  const cleanHtml = DOMPurify.sanitize(rawHtml, sanitizeConfig);
  const doc = new DOMParser().parseFromString(cleanHtml, "text/html");
  const heroUrl = options.heroImageUrl ? safeHttpUrl(options.heroImageUrl, options.baseUrl) : null;
  const heroUnwrapped = unwrapImageUrl(heroUrl);
  const heroFilename = imageFilename(heroUnwrapped);
  const bodyTextLength = doc.body.textContent?.trim().length ?? 0;
  let previousImage: Element | null = null;
  let previousImageSrc: string | null = null;

  Array.from(doc.querySelectorAll("img")).forEach((img, index) => {
    const src = safeHttpUrl(img.getAttribute("src") ?? "", options.baseUrl);
    const srcUnwrapped = unwrapImageUrl(src);
    const filename = imageFilename(srcUnwrapped);
    let isArchivedLeadingHero = false;
    if (index === 0 && heroUrl?.includes("/archive/images/") && src?.includes("/archive/images/")) {
      const before = doc.createRange();
      before.selectNodeContents(doc.body);
      before.setEndBefore(img);
      isArchivedLeadingHero = !before.toString().trim();
    }
    const isDuplicateHero = Boolean(
      heroUrl && src &&
      (src === heroUrl || (heroUnwrapped && srcUnwrapped === heroUnwrapped) || (heroFilename && filename === heroFilename) || isArchivedLeadingHero || (index === 0 && bodyTextLength < 400)),
    );
    let isRepeatedImage = false;
    if (src && src === previousImageSrc && previousImage) {
      const between = doc.createRange();
      between.setStartAfter(previousImage);
      between.setEndBefore(img);
      isRepeatedImage = !between.toString().trim();
    }

    if (!src || isPixel(img, src) || isDuplicateHero || isRepeatedImage) {
      const alt = isDuplicateHero ? img.getAttribute("alt")?.trim() : null;
      const parentP = img.closest("p");
      const parentFigure = img.closest("figure");
      img.remove();
      if (parentFigure && !parentFigure.querySelector("img")) {
        parentFigure.remove();
      } else if (alt && alt.length >= 15 && parentP && parentP.textContent?.trim() === alt && !parentP.querySelector("img")) {
        parentP.remove();
      }
    } else {
      img.setAttribute("src", src);
      // Load eagerly: Safari lazy-loads images inside the reader's own scroll area
      // unreliably, so they briefly vanish while scrolling.
      img.removeAttribute("loading");
      previousImage = img;
      previousImageSrc = src;
    }
  });

  doc.querySelectorAll("a").forEach((link) => {
    const href = safeHttpUrl(link.getAttribute("href") ?? "", options.baseUrl);
    if (href) {
      link.setAttribute("href", href);
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noopener noreferrer");
    } else {
      link.removeAttribute("href");
    }
  });

  if (options.paywallLabel) {
    doc.querySelectorAll('a[data-media="paywall"]').forEach((link) => { link.textContent = options.paywallLabel ?? ""; });
  }

  doc.querySelectorAll("p, div, figure, a").forEach((element) => {
    if (!element.textContent?.trim() && !element.querySelector("img")) element.remove();
  });

  const nodes = Array.from(doc.body.childNodes);
  if (nodes.some((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) && !doc.body.querySelector("p")) {
    const paragraph = doc.createElement("p");
    nodes.forEach((node) => paragraph.appendChild(node));
    doc.body.appendChild(paragraph);
  }

  return DOMPurify.sanitize(doc.body.innerHTML, sanitizeConfig);
}

export function estimateReadingTime(text: string): number {
  if (!text) return 1;
  return Math.max(1, Math.ceil(text.trim().split(/\s+/).length / 200));
}
