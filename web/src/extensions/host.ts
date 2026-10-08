// Extension points of the web app. A script that runs on the page can add pages to the settings, links to the
// footers, and replace the sign-in form, for example to brand an installation, add the legal pages an operator
// is required to link, or sign in through a company's single sign-on. The app reads one plain object:
//
//   window.feedkeeperExtensions = window.feedkeeperExtensions ?? {};
//   window.feedkeeperExtensions.footerLinks = [{ label: "Imprint", href: "/imprint" }];
//   window.dispatchEvent(new Event("feedkeeper:extensions-changed"));
//
// The script may run before or after the app starts; the app reads the object when a page renders and again
// whenever the event is dispatched. Everything in it is validated and a broken entry is ignored.
// See docs/extending-the-web-app.md.

/** Dispatch on `window` after changing `window.feedkeeperExtensions`. */
export const EXTENSIONS_CHANGED = "feedkeeper:extensions-changed";

/** A text or a URL that differs by language: either one value or values by language code (`de`, `en`, …). */
export type Localized<T extends string = string> = T | Record<string, T>;

export interface SettingsExtensionSection {
  /** The `?tab=` value of the section. Lowercase letters, digits and dashes; must not clash with a built-in section. */
  id: string;
  label: string;
  /** Shorter label for the chip row on narrow screens. */
  shortLabel?: string;
  description: string;
  /** Heading in the navigation. Sections with the same group are listed together, in order of appearance. */
  group: string;
  /** Path data (`d` attributes) of a 24×24 stroked icon. */
  icon?: string[];
  /** Only administrators see the section. */
  admin?: boolean;
  /** Fills the container when the section opens. The returned function runs when it closes. */
  mount: (container: HTMLElement) => void | (() => void);
}

export interface FooterLink {
  label: Localized;
  /** An address on this site (`/imprint`) or an `http(s)` URL. */
  href: Localized;
  /** Open in a new tab. */
  newTab?: boolean;
  /** A small image shown in front of the label (an address on this site or an `http(s)` URL). */
  icon?: string;
  /** Where the link is shown; every place when left out. */
  placements?: FooterPlacement[];
}

export type FooterPlacement = "login" | "menu" | "page";
const FOOTER_PLACEMENTS: readonly FooterPlacement[] = ["login", "menu", "page"];

export interface PasswordCardExtension {
  /** Whether the host's card replaces the password card for this user, for example for accounts that signed in without a password. */
  applies?: (user: { id: number; email: string; display_name: string | null }) => boolean | Promise<boolean>;
  /** Fills the container in place of the password card. */
  mount: (container: HTMLElement) => void | (() => void);
}

export interface LoginFormExtension {
  /** Fills the container where the sign-in form is. After signing in, reload the page. */
  mount: (container: HTMLElement) => void | (() => void);
}

declare global {
  interface Window {
    feedkeeperExtensions?: unknown;
  }
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const isText = (value: unknown, max: number): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function validSection(value: unknown): value is SettingsExtensionSection {
  if (!isObject(value)) return false;
  return (
    typeof value.id === "string" && ID_PATTERN.test(value.id) &&
    isText(value.label, 80) && isText(value.description, 300) && isText(value.group, 60) &&
    (value.shortLabel === undefined || isText(value.shortLabel, 40)) &&
    (value.icon === undefined || (Array.isArray(value.icon) && value.icon.length <= 8 && value.icon.every((path) => typeof path === "string" && path.length <= 400))) &&
    (value.admin === undefined || typeof value.admin === "boolean") &&
    typeof value.mount === "function"
  );
}

export interface ResolvedSettingsExtensions {
  /** Ids of built-in sections the host replaces. */
  hidden: Set<string>;
  sections: SettingsExtensionSection[];
}

/**
 * The settings sections the host asks for, checked against the built-in ones. Entries that are malformed, repeat
 * an id, clash with a built-in id or are meant for administrators when the user is none are left out.
 */
export function resolveSettingsExtensions(extensions: unknown, builtInIds: string[], isAdmin: boolean): ResolvedSettingsExtensions {
  const settings = isObject(extensions) && isObject(extensions.settings) ? extensions.settings : {};
  const hidden = new Set(Array.isArray(settings.hidden) ? settings.hidden.filter((id): id is string => typeof id === "string" && builtInIds.includes(id)) : []);
  const taken = new Set(builtInIds);
  const sections: SettingsExtensionSection[] = [];
  for (const candidate of Array.isArray(settings.sections) ? settings.sections : []) {
    if (!validSection(candidate) || taken.has(candidate.id)) continue;
    taken.add(candidate.id);
    if (candidate.admin && !isAdmin) continue;
    sections.push(candidate);
  }
  return { hidden, sections };
}

/** Sections by group, groups in order of first appearance. */
export function groupSettingsSections<T extends { group?: string }>(sections: T[]): Array<{ group: string; sections: T[] }> {
  const groups: Array<{ group: string; sections: T[] }> = [];
  for (const section of sections) {
    const name = section.group ?? "";
    const existing = groups.find((entry) => entry.group === name);
    if (existing) existing.sections.push(section);
    else groups.push({ group: name, sections: [section] });
  }
  return groups;
}

/** The value for a language: the exact code, its base (`de-AT` → `de`), English, then whatever there is. */
export function pickLocalized(value: unknown, language: string): string | null {
  if (typeof value === "string") return value;
  if (!isObject(value)) return null;
  const code = language.toLowerCase();
  for (const key of [code, code.split("-")[0], "en"]) {
    const found = Object.entries(value).find(([name]) => name.toLowerCase() === key)?.[1];
    if (typeof found === "string") return found;
  }
  const first = Object.values(value).find((entry): entry is string => typeof entry === "string");
  return first ?? null;
}

/** Only addresses on this site and http(s) URLs: a link must never run script. */
function safeHref(href: string): boolean {
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is rejected
  if (/[\u0000-\u001f\\]/.test(href) || href.length > 500) return false;
  return /^\/(?![/\\])/.test(href) || /^https?:\/\/[^\s/]+/i.test(href);
}

export interface ResolvedFooterLink {
  label: string;
  href: string;
  newTab: boolean;
  icon: string | null;
}

/** The footer links the host asks for, in its language-specific wording; invalid ones are left out. */
export function resolveFooterLinks(extensions: unknown, language: string, placement?: FooterPlacement): ResolvedFooterLink[] {
  const list = isObject(extensions) && Array.isArray(extensions.footerLinks) ? extensions.footerLinks : [];
  const links: ResolvedFooterLink[] = [];
  for (const entry of list.slice(0, 8)) {
    if (!isObject(entry)) continue;
    const label = pickLocalized(entry.label, language);
    const href = pickLocalized(entry.href, language);
    if (!label || !isText(label, 60) || !href || !safeHref(href)) continue;
    if (placement && Array.isArray(entry.placements) && !entry.placements.some((value) => value === placement && FOOTER_PLACEMENTS.includes(value))) continue;
    const icon = typeof entry.icon === "string" && safeHref(entry.icon) ? entry.icon : null;
    links.push({ label, href, newTab: entry.newTab === true || /^https?:/i.test(href), icon });
  }
  return links;
}

/** The replacement for the sign-in form, if the host provides a usable one. */
export function resolveLoginForm(extensions: unknown): LoginFormExtension | null {
  const login = isObject(extensions) ? extensions.loginForm : undefined;
  return isObject(login) && typeof login.mount === "function" ? (login as unknown as LoginFormExtension) : null;
}

/** The replacement for the password card of the account page, if the host provides a usable one. */
export function resolvePasswordCard(extensions: unknown): PasswordCardExtension | null {
  const card = isObject(extensions) ? extensions.passwordCard : undefined;
  if (!isObject(card) || typeof card.mount !== "function") return null;
  return { mount: card.mount as PasswordCardExtension["mount"], ...(typeof card.applies === "function" ? { applies: card.applies as PasswordCardExtension["applies"] } : {}) };
}
