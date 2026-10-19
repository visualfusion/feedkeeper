import { decodeEntities } from "./text.js";

const GENERIC_NAMES = /^(admin(istrator)?|redaktion(steam)?|redaktionsteam|editors?|editorial( team| staff)?|staff|team|webmaster|redakteur(in)?|autor|author|unknown|unbekannt|n\/?a|null|undefined|anonymous|anonym|gast|guest|user|news|newsdesk|desk)$/i;
const MAX_AUTHORS = 6;
const MAX_LENGTH = 160;

function key(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/** One name of a feed's author field. `staff@site.test (Anna Muster)` is the name in brackets; a bare address is no name. */
function nameOf(raw: string): string | null {
  let text = decodeEntities(raw).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const bracketed = text.match(/^\S+@\S+\s*\(([^)]+)\)$/);
  if (bracketed) text = bracketed[1].trim();
  else if (/^<?\S+@\S+>?$/.test(text)) return null;
  const withAddress = text.match(/^(.+?)\s*<\S+@\S+>$/);
  if (withAddress) text = withAddress[1].trim();
  text = text.replace(/^(von|by|text|autor(in)?|author)\s*:?\s+/i, "").trim();
  if (!text || /^https?:\/\//i.test(text) || GENERIC_NAMES.test(text)) return null;
  return text;
}

/**
 * The author line of an item: every distinct name the feed gives, in order, joined by commas. Nothing is made up:
 * addresses without a name, generic names ("admin", "Redaktion") and the publication's own name are no authors.
 */
export function authorLine(raw: unknown, publication: { title?: string | null; url?: string | null } = {}): string | null {
  const values = (Array.isArray(raw) ? raw : [raw]).filter((value): value is string => typeof value === "string");
  const own = new Set<string>();
  if (publication.title) own.add(key(publication.title));
  try { if (publication.url) own.add(key(new URL(publication.url).hostname.replace(/^www\./, ""))); } catch { /* an unparsable feed address is no reason to lose the author */ }
  // "Engadget" is the publication of "Engadget - Technology News" and of engadget.com alike.
  const isOwn = (name: string) => name.length >= 4 && [...own].some(known => known === name || known.startsWith(name));
  const names: string[] = [];
  for (const value of values) {
    for (const part of (decodeEntities(value) ?? "").split(/\s*(?:;|\s\/\s|\s&\s|\s+und\s+|\s+and\s)\s*/i)) {
      const name = nameOf(part);
      if (!name || isOwn(key(name)) || names.some(known => key(known) === key(name))) continue;
      names.push(name);
    }
  }
  const line = names.slice(0, MAX_AUTHORS).join(", ");
  return line && line.length <= MAX_LENGTH ? line : line ? line.slice(0, MAX_LENGTH).replace(/[,\s]+\S*$/, "") || null : null;
}
