/** The key of the person's own choice of language, in a cookie (read by pages on the same site) and in local storage. */
export const LANGUAGE_KEY = "fk_lang";

/**
 * Remembers a language the person picked. Only an explicit choice is stored: without one the language follows the
 * system (the browser's preference), so a changed system setting is followed, and a choice made on another page of
 * the same site, such as the landing page of a hosted service, applies here as well.
 */
export function rememberLanguage(language: string): void {
  try {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${LANGUAGE_KEY}=${encodeURIComponent(language)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
  } catch {
    // Cookies may be blocked; the local copy below still applies to this site.
  }
  try {
    localStorage.setItem(LANGUAGE_KEY, language);
  } catch {
    // The choice then lasts until the page is closed.
  }
}
