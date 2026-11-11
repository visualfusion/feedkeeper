import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
globalThis.document = dom.window.document;

const { articleExcerpt } = await import("../src/utils/articleExcerpt.ts");

test("uses cached reader text before feed content or teaser", () => {
  assert.equal(articleExcerpt({
    full_content_html: "<p>Complete &amp; useful article.</p><script>bad()</script>",
    content_html: "<p>Short feed content.</p>",
    content_snippet: "Tiny teaser.",
  }), "Complete & useful article.");
});

test("uses feed content when no reader text is cached", () => {
  assert.equal(articleExcerpt({
    full_content_html: null,
    content_html: "<img src='photo.jpg'><p>First paragraph.</p><p>Second paragraph.</p>",
    content_snippet: "Short teaser.",
  }), "First paragraph. Second paragraph.");
});

test("falls back to teaser when available HTML has no text", () => {
  assert.equal(articleExcerpt({
    full_content_html: null,
    content_html: "<img src='photo.jpg'>",
    content_snippet: "  Short   teaser.  ",
  }), "Short teaser.");
});

test("keeps the teaser if feed HTML contains only a short caption", () => {
  assert.equal(articleExcerpt({
    full_content_html: null,
    content_html: "<p>Photo credit</p>",
    content_snippet: "A useful account of the whole story.",
  }), "A useful account of the whole story.");
});

test("keeps large article bodies out of card markup", () => {
  const excerpt = articleExcerpt({ full_content_html: `<p>${"word ".repeat(300)}</p>`, content_html: null, content_snippet: null });
  assert.ok(excerpt.length <= 651);
  assert.ok(excerpt.endsWith("…"));
});

test("a long Japanese excerpt ends at a full stop or a comma, not in the middle of a phrase", () => {
  const sentence = "新しい規則が十一月から適用されると発表しました。";
  const excerpt = articleExcerpt({ full_content_html: `<p>${sentence.repeat(60)}</p>`, content_html: null, content_snippet: null });
  assert.ok(excerpt.endsWith("。"), excerpt);
  assert.ok(excerpt.length <= 650);
  assert.equal(excerpt.length % sentence.length, 0);
});

test("the language of a text is Japanese only with kana; Latin and kanji-only text stay unmarked", async () => {
  const { textLanguage } = await import("../src/utils/japanese.ts");
  assert.equal(textLanguage("新しい規則が発表されました"), "ja");
  assert.equal(textLanguage("The ministry confirmed"), undefined);
  assert.equal(textLanguage("国际新闻"), undefined);
  assert.equal(textLanguage(null), undefined);
});

test("a long Latin excerpt is cut exactly as before", () => {
  const word = "ministry ";
  const excerpt = articleExcerpt({ full_content_html: `<p>${word.repeat(100)}</p>`, content_html: null, content_snippet: null });
  assert.equal(excerpt.length, 651);
  assert.ok(excerpt.endsWith("…"));
});
