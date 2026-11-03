/**
 * Some feeds wrap every article address in a redirect through the publisher's tracker. Google Alerts links through
 * `https://www.google.com/url?...&url=<article>`, which is not the page to read and fails the full-text fetch. The article address
 * inside the wrapper is what an item should point to.
 */
const GOOGLE_HOST = /^(?:www\.)?google\.[a-z]{2,3}(?:\.[a-z]{2})?$/i;

export function unwrapRedirectLink(link: string): string;
export function unwrapRedirectLink(link: string | null | undefined): string | null | undefined;
export function unwrapRedirectLink(link: string | null | undefined): string | null | undefined {
  if (!link) return link;
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return link;
  }
  if (!GOOGLE_HOST.test(url.hostname) || url.pathname !== "/url") return link;
  const target = url.searchParams.get("url") ?? url.searchParams.get("q");
  return target && /^https?:\/\//i.test(target) ? target : link;
}
