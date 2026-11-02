/** Consent notices that sit where an embed would be, in Japanese. See `de.ts` for what the two lists mean. */
export default {
  anchors: [
    /^(?:外部コンテンツ|おすすめの外部コンテンツ|埋め込みコンテンツ)$/i,
    /^(?:YouTube|Vimeo|Instagram|X|Twitter|TikTok|Spotify|Facebook)のコンテンツ$/i,
    /^(?:外部コンテンツを表示|コンテンツを表示|外部コンテンツを読み込む)$/i,
  ],
  companions: [
    /^(?:外部コンテンツの読み込みに同意する|同意して表示|コンテンツを表示する)$/i,
    /個人データが(?:外部|サードパーティ)/i,
    /プライバシーポリシー/i,
  ],
};
