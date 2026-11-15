import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.DOMParser = dom.window.DOMParser;
globalThis.Node = dom.window.Node;

const {
  budouxParse,
  breakJapaneseHtml,
  phrasesInRun,
  segmentJapaneseText,
} = await import("../src/utils/japanese.ts");
const { sanitizeHtml } = await import("../src/utils/sanitizeHtml.ts");

test("budouxParse splits Japanese sentences without dropping characters", () => {
  const input = "新しい規則が十一月から適用されると発表しました。";
  const phrases = budouxParse(input);
  assert.equal(phrases.join(""), input);
  assert.ok(phrases.length >= 3, `expected multiple phrases, got ${JSON.stringify(phrases)}`);
});

test("phrasesInRun keeps compound particles together, binds short trailing predicates, and splits long runs at word boundaries", () => {
  const blocker = phrasesInRun("サイト向け統合コンテンツブロッカー");
  assert.equal(blocker.join(""), "サイト向け統合コンテンツブロッカー");
  assert.ok(blocker.length >= 2);
  assert.ok(blocker.at(-1)?.endsWith("ブロッカー"), `expected katakana word intact, got ${JSON.stringify(blocker)}`);

  const clause = phrasesInRun("場所によって差がある。");
  assert.deepEqual(clause, ["場所によって", "差がある。"]);
});

test("segmentJapaneseText passes non-Japanese strings through untouched", () => {
  const english = "Hello world from FeedKeeper!";
  assert.deepEqual(segmentJapaneseText(english), [{ kind: "text", value: english }]);

  const chinese = "国际新闻";
  assert.deepEqual(segmentJapaneseText(chinese), [{ kind: "text", value: chinese }]);
});

test("segmentJapaneseText emits wbr break opportunities and nb wrappers for short quotes", () => {
  const segments = segmentJapaneseText("新機能「あなたの新聞」が登場しました。");
  assert.ok(segments.some((seg) => seg.kind === "wbr"), "contains wbr break opportunities");
  assert.ok(
    segments.some((seg) => seg.kind === "nb" && seg.value === "「あなたの新聞」"),
    `keeps short quoted title unbreakable: ${JSON.stringify(segments)}`,
  );
  const reconstructed = segments.map((seg) => (seg.kind === "wbr" ? "" : seg.value)).join("");
  assert.equal(reconstructed, "新機能「あなたの新聞」が登場しました。");
});

test("breakJapaneseHtml handles mixed Latin/Japanese, ordinals, and short quotes", () => {
  assert.equal(
    breakJapaneseHtml("<p>App Storeでダウンロード</p>"),
    "<p>App Storeで<wbr>ダウンロード</p>",
  );
  assert.equal(
    breakJapaneseHtml("<p>場所によって差がある。</p>"),
    "<p>場所によって<wbr>差がある。</p>",
  );
  assert.equal(
    breakJapaneseHtml("<p>新機能「あなたの新聞」が登場しました。</p>"),
    '<p>新機能<wbr><span class="nb">「あなたの新聞」</span>が<wbr>登場しました。</p>',
  );
  assert.equal(
    breakJapaneseHtml("<p>第36条に基づく規定です。</p>"),
    "<p>第36条に<wbr>基づく<wbr>規定です。</p>",
  );
});

test("breakJapaneseHtml preserves tags, attributes, code blocks, and ruby furigana", () => {
  const englishHtml = '<p><a href="https://example.com" title="Japanese: 日本">Read more</a></p>';
  assert.equal(breakJapaneseHtml(englishHtml), englishHtml);

  const rubyHtml = "<p><ruby>漢<rt>かん</rt>字<rt>じ</rt></ruby>の読み方を解説します。</p>";
  assert.equal(
    breakJapaneseHtml(rubyHtml),
    "<p><ruby>漢<rt>かん</rt>字<rt>じ</rt></ruby>の<wbr>読み方を<wbr>解説します。</p>",
  );

  const linkedHtml = '<p>詳細は<a href="https://example.com/terms">「利用規約」</a>を確認してください。</p>';
  const brokenLink = breakJapaneseHtml(linkedHtml);
  assert.ok(!brokenLink.includes("</a><wbr>を"), `must not orphan hiragana particle after link: ${brokenLink}`);
  assert.ok(brokenLink.includes('<a href="https://example.com/terms">'), "link attribute stays intact");

  const codeHtml = '<pre><code>const title = "日本語のコメント";</code></pre><p>本文のテストです。</p>';
  const brokenCode = breakJapaneseHtml(codeHtml);
  assert.ok(brokenCode.startsWith('<pre><code>const title = "日本語のコメント";</code></pre>'), brokenCode);
});

test("breakJapaneseHtml composes cleanly after sanitizeHtml without stripping phrase markup", () => {
  const raw = '<p class="article-body" onclick="alert(1)">新機能「あなたの新聞」が登場しました。</p><script>bad()</script>';
  const output = breakJapaneseHtml(sanitizeHtml(raw));
  assert.doesNotMatch(output, /<script|onclick/i);
  assert.match(output, /<span class="nb">「あなたの新聞」<\/span>/);
  assert.match(output, /<wbr>/);
});
