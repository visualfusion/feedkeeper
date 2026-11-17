/** Lines that only restate what a reader's head already shows, in Japanese. See `en.ts`. */
export default {
  weekdays: ["月", "火", "水", "木", "金", "土", "日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日", "日曜日"],
  relativeAges: [/^\d{1,3}\s*(?:秒|分|時間|日|週間|か月|ヶ月)前$/, /^(?:たった今|今さっき|数分前)$/],
  kickers: [/^(?:NEWS|ニュース|コラム|レポート|インタビュー|特集|レビュー)\s*[|｜/／・·•]\s*[^.!?。！？]{1,40}$/],
};
