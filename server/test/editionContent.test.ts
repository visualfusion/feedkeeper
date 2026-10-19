import assert from "node:assert/strict";
import { test } from "node:test";
import { hasEditionText, type EditionContent } from "../src/native/editionContent.js";

const empty: EditionContent = { title: "A news headline", content_snippet: null, content_html: null, full_content_html: null };

test("editions reject empty bodies, media players, repeated titles and prompts in all supported languages", () => {
  for (const body of [null, "", "[mehr]", "Read more…", "続きを読む", "動画を見る", "Watch video",
    '<img src="/cover.jpg" alt="A detailed photo description">',
    '<video controls><source src="/clip.mp4">Your browser does not support video.</video>',
    '<audio controls>Listen to this programme.</audio><iframe src="/player">Watch here</iframe>',
    '<h2>A news headline</h2><p>[<a href="/video">mehr</a>]</p>',
    '<a href="/video">Watch video</a><a href="/story">Read more</a>',
    '<script>tracking()</script><style>body{color:red}</style>']) {
    assert.equal(hasEditionText({ ...empty, content_snippet: "[mehr]", content_html: body }), false, String(body));
  }
  assert.equal(hasEditionText({ ...empty, content_snippet: empty.title }), false);
});

test("short reports, captions, transcripts and text alongside media remain eligible from any cached source", () => {
  for (const field of ["content_snippet", "content_html", "full_content_html"] as const) {
    for (const text of ["Rain today.", "速報：首相が辞任。", "<p>A short report.</p>",
      '<video src="/clip.mp4"></video><p>The president announced new elections.</p>',
      '<p>Transcript: Welcome to the evening news.</p>', '<figure><img src="/photo"><figcaption>Flooding in the city.</figcaption></figure>']) {
      assert.equal(hasEditionText({ ...empty, [field]: text }), true, `${field}: ${text}`);
    }
  }
  assert.equal(hasEditionText({ ...empty, content_html: "[mehr]", full_content_html: "<p>A cached full article.</p>" }), true);
  assert.equal(hasEditionText({ ...empty, content_snippet: "A useful feed summary.", full_content_html: "<video></video>" }), true);
});
