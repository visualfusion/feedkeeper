import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const locales = ["en", "de", "ja"];
const load = (code) => JSON.parse(readFileSync(new URL(`../src/i18n/locales/${code}.json`, import.meta.url), "utf8"));

function keysOf(value, prefix = "") {
  return Object.entries(value).flatMap(([key, child]) =>
    child && typeof child === "object" ? keysOf(child, `${prefix}${key}.`) : [`${prefix}${key}`],
  );
}

function entriesOf(value, prefix = "") {
  return Object.entries(value).flatMap(([key, child]) =>
    child && typeof child === "object" ? entriesOf(child, `${prefix}${key}.`) : [[`${prefix}${key}`, String(child)]],
  );
}

const reference = new Set(keysOf(load("en")));

for (const code of locales.filter((code) => code !== "en")) {
  test(`${code} has the same text keys as en`, () => {
    const keys = new Set(keysOf(load(code)));
    assert.deepEqual([...reference].filter((key) => !keys.has(key)), [], `missing in ${code}.json`);
    assert.deepEqual([...keys].filter((key) => !reference.has(key)), [], `unknown in ${code}.json`);
  });
}

test("locales and OAuth pages follow terminology and typography rules across de, en and ja", () => {
  const forbiddenEn = ["cancelled", "Cancelled", "cancelling", "Cancelling", "customise", "minimise", "synchronise"];
  const forbiddenJa = [
    "サインイン",
    "サインアウト",
    "2要素認証",
    "２要素認証",
    "2ファクタ認証",
    "単語フィルター",
    "ミュートキーワード",
    "カテゴリ",
    "ブックマーク",
  ];
  const spaceBeforeUnit = /\d\s+[%€]/;
  const halfWidthPunctuationAfterJa = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}ー][?!]/u;
  const folderWithoutLongVowel = /フォルダ(?!ー)/;

  for (const code of locales) {
    for (const [key, text] of entriesOf(load(code))) {
      assert.doesNotMatch(text, spaceBeforeUnit, `${code}.json (${key}): no space before % or €`);
      if (code === "en") {
        for (const term of forbiddenEn) {
          assert.ok(!text.includes(term), `en.json (${key}): forbidden term "${term}" in "${text}"`);
        }
      }
      if (code === "ja") {
        for (const term of forbiddenJa) {
          assert.ok(!text.includes(term), `ja.json (${key}): forbidden term "${term}" in "${text}"`);
        }
        assert.doesNotMatch(text, folderWithoutLongVowel, `ja.json (${key}): use フォルダー instead of フォルダ`);
        assert.doesNotMatch(text, halfWidthPunctuationAfterJa, `ja.json (${key}): use full-width ？/！ in "${text}"`);
      }
    }
  }

  const oauthPages = readFileSync(new URL("../../server/src/oauth/pages.ts", import.meta.url), "utf8");
  for (const term of forbiddenJa) {
    assert.ok(!oauthPages.includes(term), `oauth/pages.ts: forbidden Japanese term "${term}"`);
  }
  assert.doesNotMatch(oauthPages, folderWithoutLongVowel, "oauth/pages.ts: use フォルダー instead of フォルダ");
});
