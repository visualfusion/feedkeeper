const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", sbquo: "‚", bdquo: "„",
  laquo: "«", raquo: "»", ndash: "–", mdash: "—", hellip: "…", middot: "·",
  bull: "•", euro: "€", copy: "©", reg: "®", trade: "™", deg: "°",
  auml: "ä", ouml: "ö", uuml: "ü", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", szlig: "ß",
};

const ENTITY = /&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi;

function decodeOnce(text: string): string {
  return text.replace(ENTITY, (match, name: string) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[name] ?? match;
  });
}

/** A title as one line of text: entities decoded, line breaks and runs of spaces collapsed to one space, trimmed. */
export function plainTitle(text: string | null | undefined): string | undefined {
  const cleaned = decodeEntities(text)?.replace(/\s+/g, " ").trim();
  return cleaned || undefined;
}

/**
 * Decode HTML entities in plain-text fields such as titles. Some feeds encode twice
 * (`&amp;#8217;`), so decoding repeats until the text stops changing.
 */
export function decodeEntities(text: string): string;
export function decodeEntities(text: string | null | undefined): string | null | undefined;
export function decodeEntities(text: string | null | undefined): string | null | undefined {
  if (!text || !text.includes("&")) return text;
  let current = text;
  for (let pass = 0; pass < 3; pass++) {
    const next = decodeOnce(current);
    if (next === current) break;
    current = next;
  }
  return current;
}
