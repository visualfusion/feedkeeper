/**
 * Blocks, in Japanese, that publishers put into their text without being part of the story. A block counts only when its whole text is one
 * of these lines (see `noise/boilerplate.ts`), so a sentence of the story that contains the words stays.
 */
export const ANYWHERE: readonly RegExp[] = [
  // Calls to follow the site on Google or elsewhere.
  /^(?:Google(?: ニュース)?でフォロー(?:する)?|Google ニュースで[^.!?。]{2,40}をフォロー)$/i,
  /^(?:Googleで)?[^.!?。]{0,40}優先(?:ソース|的なソース)(?:として|に)(?:追加|設定)(?:する)?[^.!?。]{0,60}[。.]?$/i,
  // The text of download buttons whose picture is gone.
  /^(?:App Storeからダウンロード|Google Playで手に入れよう|Google Playで入手|App Storeでダウンロード|Google Playで[^.!?。]{2,40}を入手)$/i,
  // A picture's filename shown as text.
  /^[\w\-. ]{3,120}\.(?:jpe?g|png|webp|gif|avif)$/i,
];

/** Orphaned recommendation headings without a following list. */
export const ORPHAN_HEADINGS: readonly RegExp[] = [
  /^(?:関連記事|おすすめ記事|オススメ記事|人気の記事|人気記事|最新記事|新着記事|注目の記事)$/i,
];

/** Footers at the end of the text; they count only in the second half. */
export const TRAILING: readonly RegExp[] = [
  /^(?:この記事|本記事|本稿).{3,120}(?:で初出|に初出|で公開|に掲載|転載).*$/i,
  /^(?:この記事について(?:話し合う|語る|コメント)|コメントする)\b.{0,40}$/i,
  /^(?:関連記事|トピック|タグ|関連タグ):.{0,200}$/i,
  // Author social follow lines at the end of an article.
  /^[^.!?。]{1,40}(?:をフォロー|のSNS)\s*[:：]\s*(?:X(?:\s*\/\s*Twitter)?|Twitter|Bluesky|Mastodon|Threads|Instagram|Facebook|YouTube|LinkedIn|TikTok|RSS)\b.{0,120}$/i,
  ...ORPHAN_HEADINGS,
  // Calls at the end of an article to follow on Google News or download the app.
  /^(?:さらに[^.!?。]{2,40}[？?]\s*)?(?:Google(?:ニュース|ディスカバー)?で[^.!?。]{2,40}をフォロー(?:するか、公式アプリを入手)?|公式アプリを入手)[。.]?$/i,
];

/** Copy of a newsletter signup box (container with a form before Readability, or orphaned box afterwards). */
export const NEWSLETTER_BOX: readonly RegExp[] = [
  /(?:(?:日刊|週刊|月刊|無料).{0,20}(?:ニュースレター|メルマガ)|(?:ニュースレター|メルマガ).{0,60}(?:登録|購読|受信|メールボックス|無料))/,
];
