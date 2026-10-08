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

export interface StarterPackExtension {
  /** Lowercase letters, digits and dashes. A pack with the id of a built-in one replaces it. */
  id: string;
  title: Localized;
  description?: Localized;
  feeds: Array<{ title: string; url: string; lang?: string }>;
}

export interface OnboardingExtension {
  /** Fills the container at the top of the welcome card that a person without feeds sees. */
  mount: (container: HTMLElement) => void | (() => void);
}

export interface ArticlesNoticeExtension {
  /** Whether the notice is shown to this user right now, for example until the person has closed it. Without it the notice always shows. */
  applies?: (user: { id: number; email: string; display_name: string | null }) => boolean | Promise<boolean>;
  /** Fills the container of the notice above the articles. Closing it is up to the host's content (then it answers `false` from `applies` the next time). */
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

/** Whether the host asks for its welcome content above the first steps of a person without feeds. */
export function resolveOnboarding(extensions: unknown): OnboardingExtension | null {
  const onboarding = isObject(extensions) ? extensions.onboarding : undefined;
  return isObject(onboarding) && typeof onboarding.mount === "function" ? (onboarding as unknown as OnboardingExtension) : null;
}

export interface ResolvedStarterPack {
  id: string;
  title: string;
  description: string;
  feeds: Array<{ title: string; url: string; lang: string }>;
}

/** Only `http(s)` addresses without credentials can be subscribed to. */
function feedAddress(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 500) return null;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * The starter packs the host adds to the built-in ones, or, with `replace: true`, instead of them. Packs and feeds
 * that are malformed are left out; at most 12 packs of 20 feeds.
 */
export function resolveStarterPacks<T extends { id: string; title: Localized; description?: Localized; feeds: Array<{ title: string; url: string; lang?: string }> }>(
  extensions: unknown, builtIn: T[], language: string,
): ResolvedStarterPack[] {
  const host = isObject(extensions) && isObject(extensions.starterPacks) ? extensions.starterPacks : {};
  const own = Array.isArray(host.packs) ? host.packs : [];
  const byId = new Map<string, { id: string; title: Localized; description?: Localized; feeds: Array<{ title: string; url: string; lang?: string }> }>();
  if (host.replace !== true) for (const pack of builtIn) byId.set(pack.id, pack);
  for (const candidate of own.slice(0, 12)) {
    if (!isObject(candidate) || typeof candidate.id !== "string" || !ID_PATTERN.test(candidate.id) || !Array.isArray(candidate.feeds)) continue;
    byId.set(candidate.id, candidate as unknown as StarterPackExtension);
  }
  const packs: ResolvedStarterPack[] = [];
  for (const pack of byId.values()) {
    const title = pickLocalized(pack.title, language);
    if (!title || !isText(title, 60)) continue;
    const feeds: ResolvedStarterPack["feeds"] = [];
    for (const feed of pack.feeds.slice(0, 20)) {
      if (!isObject(feed) || !isText(feed.title, 80)) continue;
      const url = feedAddress(feed.url);
      if (url) feeds.push({ title: feed.title, url, lang: typeof feed.lang === "string" ? feed.lang.toLowerCase().split("-")[0] : "" });
    }
    if (feeds.length > 0) packs.push({ id: pack.id, title, description: pickLocalized(pack.description, language) ?? "", feeds });
  }
  return packs;
}

/** The host's notice above the list of articles, if it provides a usable one. */
export function resolveArticlesNotice(extensions: unknown): ArticlesNoticeExtension | null {
  const notice = isObject(extensions) ? extensions.articlesNotice : undefined;
  if (!isObject(notice) || typeof notice.mount !== "function") return null;
  return { mount: notice.mount as ArticlesNoticeExtension["mount"], ...(typeof notice.applies === "function" ? { applies: notice.applies as ArticlesNoticeExtension["applies"] } : {}) };
}
