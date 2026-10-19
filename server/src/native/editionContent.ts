import { JSDOM } from "jsdom";
import { decodeEntities } from "../feeds/text.js";

export interface EditionContent {
  title: string | null;
  content_snippet: string | null;
  content_html: string | null;
  full_content_html: string | null;
}

const PROMPTS = new Set([
  "mehr", "weiterlesen", "mehr lesen", "read more", "more", "continue reading",
  "video", "zum video", "video ansehen", "video abspielen", "watch video", "watch the video", "play video",
  "audio", "zum audio", "audio anhören", "listen", "listen now", "listen to audio",
  "続きを読む", "もっと読む", "動画を見る", "動画を再生", "音声を聞く",
]);

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** No length threshold: a short news sentence is useful, a media player or read-more link alone is not. */
export function hasEditionText(item: EditionContent): boolean {
  const title = normalize(decodeEntities(item.title) ?? "");
  return [item.content_snippet, item.content_html, item.full_content_html].some(source => {
    if (!source) return false;
    const fragment = JSDOM.fragment(source);
    fragment.querySelectorAll("script, style, noscript, nav, footer, video, audio, iframe, object, embed").forEach(node => node.remove());
    fragment.querySelectorAll("a, p, span, h1, h2, h3, h4").forEach(node => {
      const text = normalize(node.textContent ?? "");
      if (text === title || PROMPTS.has(text)) node.remove();
    });
    fragment.querySelectorAll("p, div, br, li, h1, h2, h3, h4, blockquote, figcaption").forEach(node => node.append("\n"));
    return (fragment.textContent ?? "").split(/\n/).some(line => {
      const text = normalize(line);
      return text !== "" && text !== title && !PROMPTS.has(text);
    });
  });
}
