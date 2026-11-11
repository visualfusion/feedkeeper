/** Hiragana or katakana: the sign that a text is Japanese (kanji alone could be Chinese). */
const KANA = /[぀-ヿㇰ-ㇿｦ-ﾟ]/;

/** Japanese text carries its own language, whatever the interface language is: the browser then breaks lines and picks the glyphs of Japanese. */
export function textLanguage(text: string | null | undefined): "ja" | undefined {
  return text && KANA.test(text.slice(0, 400)) ? "ja" : undefined;
}

/** Cuts a text to a length at the end of a sentence or clause; Japanese has no spaces to cut at. */
export function cutAtBoundary(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const stop = Math.max(slice.lastIndexOf("。"), slice.lastIndexOf("！"), slice.lastIndexOf("？"));
  if (stop >= max * 0.5) return slice.slice(0, stop + 1);
  const clause = Math.max(slice.lastIndexOf("、"), slice.lastIndexOf("，"));
  return `${(clause >= max * 0.5 ? slice.slice(0, clause) : slice).trimEnd()}…`;
}
