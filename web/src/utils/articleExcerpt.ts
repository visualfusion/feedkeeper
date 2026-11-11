import type { Item } from "../api/client.ts";
import { cutAtBoundary, textLanguage } from "./japanese.ts";

type ArticleContent = Pick<Item, "full_content_html" | "content_html" | "content_snippet">;

const MAX_EXCERPT_LENGTH = 650;

function plainText(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  template.content.querySelectorAll("script, style, noscript, template, svg, [hidden], [aria-hidden='true']")
    .forEach((element) => element.remove());
  template.content.querySelectorAll("p, div, li, br, blockquote, section, article, h1, h2, h3, h4, h5, h6")
    .forEach((element) => element.after(" "));
  return template.content.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

export function articleExcerpt(item: ArticleContent): string | null {
  const readerText = item.full_content_html?.trim() ? plainText(item.full_content_html) : "";
  const feedText = !readerText && item.content_html?.trim() ? plainText(item.content_html) : "";
  const snippet = item.content_snippet?.replace(/\s+/g, " ").trim() ?? "";
  const text = readerText || (feedText.length >= snippet.length ? feedText : snippet);
  if (!text) return null;
  if (text.length <= MAX_EXCERPT_LENGTH) return text;
  return textLanguage(text) === "ja"
    ? cutAtBoundary(text, MAX_EXCERPT_LENGTH)
    : `${text.slice(0, MAX_EXCERPT_LENGTH).trimEnd()}…`;
}
