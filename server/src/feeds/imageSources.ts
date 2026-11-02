/** A script accidentally parsed as a URL is never an image, even after it was made absolute. */
export const SCRIPT_IMAGE_SOURCE = /\bthis\.src\s*=/i;

export function usableImageSource(raw: string | null): string | null {
  const source = raw?.trim();
  if (!source || SCRIPT_IMAGE_SOURCE.test(source)) return null;
  try {
    const url = new URL(source, "https://image-source.invalid/");
    return url.protocol === "https:" || url.protocol === "http:" ? source : null;
  } catch { return null; }
}

/** URLs may contain commas (notably data placeholders); descriptors end at the next comma. */
export function firstSrcsetSource(srcset: string | null): string | null {
  let rest = srcset?.trim() ?? "";
  while (rest) {
    const match = /^([^\s]+)\s*/.exec(rest)!;
    const source = match[1].replace(/,+$/, "");
    rest = rest.slice(match[0].length);
    if (!match[1].endsWith(",")) {
      const comma = rest.indexOf(",");
      rest = comma < 0 ? "" : rest.slice(comma + 1).trim();
    }
    const usable = usableImageSource(source);
    if (usable) return usable;
  }
  return null;
}

export function imageSource(attribute: (name: string) => string | null): string | null {
  for (const name of ["src", "data-lazy-src", "data-src", "data-original", "data-actualsrc"]) {
    const source = usableImageSource(attribute(name));
    if (source) return source;
  }
  for (const name of ["data-lazy-srcset", "data-srcset", "srcset"]) {
    const source = firstSrcsetSource(attribute(name));
    if (source) return source;
  }
  return null;
}

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return match ? match[1] ?? match[2] ?? match[3] : null;
}

/** Keep one fallback image before archive/proxy rewriting, including raw HTML stored by older versions. */
export function normalizeImageSources(html: string): string {
  const normalize = (tag: string, fallback: string | null = null) => {
    const source = imageSource((name) => attribute(tag, name)) ?? fallback;
    if (!source) return tag;
    const escaped = source.replace(/"/g, "&quot;");
    const withoutSources = tag.replace(/\s+(?:(?:data-(?:lazy-)?)?src(?:set)?|sizes|data-sizes|data-original|data-actualsrc)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+)/gi, "");
    return withoutSources.replace(/\s*\/?>$/, (end) => ` src="${escaped}"${end}`);
  };
  const pictures = html.replace(/<picture\b[^>]*>[\s\S]*?<\/picture\s*>/gi, (picture) => {
    let fallback: string | null = null;
    const withoutSources = picture.replace(/<source\b[^>]*>/gi, (tag) => {
      fallback ??= firstSrcsetSource(attribute(tag, "data-lazy-srcset") ?? attribute(tag, "data-srcset") ?? attribute(tag, "srcset"));
      return "";
    });
    return withoutSources.replace(/<img\b[^>]*>/gi, (tag) => normalize(tag, fallback));
  });
  return pictures.replace(/<img\b[^>]*>/gi, (tag) => normalize(tag));
}
