/** Whole bylines with an explicit timestamp, only ahead of the first editorial line. */
export default [/^(?:著者|執筆|文)[:：]\s*[^。！？\n]{1,40}\s+[I|·–—-]\s*\d{4}年\d{1,2}月\d{1,2}日\s*[-–|·]\s*\d{1,2}:\d{2}$/u];
