/**
 * Blocks, in Japanese, that publishers put into their text without being part of the story. A block counts only when its whole text is one
 * of these lines (see `noise/boilerplate.ts`), so a sentence of the story that contains the words stays.
 */
export const ANYWHERE: readonly RegExp[] = [
  // Calls to follow the site on Google or elsewhere.
  /^(?:Google(?: ニュース)?でフォロー(?:する)?|Google ニュースで[^.!?]{2,40}をフォロー)$/i,
  /^(?:Googleで)?優先(?:ソース|的なソース)(?:として|に)(?:追加|設定)(?:する)?$/i,
  // The text of download buttons whose picture is gone.
  /^(?:App Storeからダウンロード|Google Playで手に入れよう|Google Playで入手|App Storeでダウンロード)$/i,
  // A picture's filename shown as text.
  /^[\w\-. ]{3,120}\.(?:jpe?g|png|webp|gif|avif)$/i,
];

/** Footers at the end of the text; they count only in the second half. */
export const TRAILING: readonly RegExp[] = [
  /^(?:この記事|本記事|本稿).{3,120}(?:で初出|に初出|で公開|に掲載|転載).*$/i,
  /^(?:この記事について(?:話し合う|語る|コメント)|コメントする)\b.{0,40}$/i,
  /^(?:関連記事|トピック|タグ|関連タグ):.{0,200}$/i,
];
