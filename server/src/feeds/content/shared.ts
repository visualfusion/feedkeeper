/** What was left out, by rule, so a rule that fires too often or never can be seen. */
export type NoiseStats = Record<string, number>;

/** What a rule works on: a fetched page or the fragment of an article. */
export type ContentRoot = Document | DocumentFragment;

/**
 * One self-contained clean-up step. A rule removes or rewrites one kind of clutter, reports whether it changed
 * anything and counts what it did in `stats` under its own name. It must be idempotent (a second run over its own
 * output changes nothing) and may only remove or rewrite, never invent content.
 */
export interface ContentRule {
  readonly name: string;
  readonly description: string;
  apply(root: ContentRoot, stats: NoiseStats): boolean;
}

export function flat(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/** Takes away what is left empty once an element is gone, up to (not including) the fragment itself. */
export function pruneEmpty(node: Node | null): void {
  while (node && node.parentNode && node.nodeType === 1) {
    const element = node as Element;
    if (flat(element.textContent) !== "" || element.querySelector("img, picture, video, iframe, a[href]")) return;
    const parent: Node | null = element.parentNode;
    element.remove();
    node = parent;
  }
}

/** A paragraph holding one plain link: what an embed becomes. Clients turn marked links into cards. */
export function linkParagraph(document: Document, url: string, text: string): Element {
  const paragraph = document.createElement("p");
  const link = document.createElement("a");
  const parsed = parseAddress(url);
  if (parsed && (parsed.protocol === "https:" || parsed.protocol === "http:")) {
    link.setAttribute("href", parsed.href);
  }
  link.textContent = text;
  paragraph.append(link);
  return paragraph;
}

export function parseAddress(source: string): URL | null {
  try { return new URL(source.startsWith("//") ? `https:${source}` : source); } catch { return null; }
}

export function count(stats: NoiseStats, name: string): void {
  stats[name] = (stats[name] ?? 0) + 1;
}
