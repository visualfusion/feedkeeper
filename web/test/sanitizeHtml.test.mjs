import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.DOMParser = dom.window.DOMParser;
globalThis.Node = dom.window.Node;

const { sanitizeHtml, leadingArticleImage, safeHttpUrl } = await import("../src/utils/sanitizeHtml.ts");

test("only HTTP links are offered for external navigation", () => {
  assert.equal(safeHttpUrl("javascript:alert(1)"), null);
  assert.equal(safeHttpUrl("data:text/html,evil"), null);
  assert.equal(safeHttpUrl("https://example.com/story"), "https://example.com/story");
});

test("removes active content and unsafe links from article HTML", () => {
  const html = `<script>alert(1)</script><svg onload="alert(2)"></svg>
    <img src="https://example.com/photo.jpg" onerror="alert(3)">
    <a href="javascript:alert(4)">bad</a><a href="/story">story</a>`;
  const clean = sanitizeHtml(html, { baseUrl: "https://example.com/article" });

  assert.doesNotMatch(clean, /<script|<svg|onerror|javascript:/i);
  assert.match(clean, /src="https:\/\/example\.com\/photo\.jpg"/);
  assert.match(clean, /href="https:\/\/example\.com\/story"/);
  assert.match(clean, /rel="noopener noreferrer"/);
});

test("removes the repeated hero image while preserving article text", () => {
  const clean = sanitizeHtml(
    '<p><img src="/hero.jpg"></p><p>Article text</p>',
    { baseUrl: "https://example.com/story", heroImageUrl: "https://example.com/hero.jpg" },
  );
  assert.doesNotMatch(clean, /<img/);
  assert.match(clean, /Article text/);
});

test("promotes a leading image and removes repeated copies from article content", () => {
  const html = `<article><p>
    <img src="https://example.com/photo.jpg">
    <img src="https://example.com/photo.jpg">
    </p><p>${"Article text. ".repeat(40)}</p>
    <p><img src="https://example.com/diagram.jpg"></p></article>`;
  const heroImageUrl = leadingArticleImage(html, "https://example.com/story");
  assert.equal(heroImageUrl, "https://example.com/photo.jpg");

  const clean = sanitizeHtml(html, { baseUrl: "https://example.com/story", heroImageUrl });
  assert.doesNotMatch(clean, /photo\.jpg/);
  assert.match(clean, /diagram\.jpg/);
  assert.match(clean, /Article text/);
});

test("removes adjacent duplicate images without removing later repeats after text", () => {
  const clean = sanitizeHtml(
    '<p><img src="/photo.jpg"><img src="/photo.jpg"></p><p>New section</p><p><img src="/photo.jpg"></p>',
    { baseUrl: "https://example.com/story" },
  );
  assert.equal((clean.match(/photo\.jpg/g) ?? []).length, 2);
});

test("does not promote tracking pixels or images deep in the article", () => {
  assert.equal(leadingArticleImage(
    `<p><img src="https://pixel.wp.com/tracker.gif" width="1" height="1"></p><p>${"Intro text. ".repeat(30)}</p><img src="/diagram.jpg">`,
    "https://example.com/story",
  ), null);
  assert.equal(leadingArticleImage(
    '<p><img src="/avatar.png" width="48" height="48"><img src="/article.jpg" width="640" height="360"></p>',
    "https://example.com/story",
  ), "https://example.com/article.jpg");
});

test("removes responsive picture hero variants with width/focal-point suffixes and proxied URLs", () => {
  const hero = "https://cdn.example.test/images/6f0f1c3a-3a07-4782-a5a6-cf3270ad98de_w520_r2.08_fpx41.99_fpy45.jpg";
  const body = `<figure>
    <picture><img src="https://cdn.example.test/images/6f0f1c3a-3a07-4782-a5a6-cf3270ad98de_w960_r1.5_fpx41.99_fpy45.jpg" alt="Player"></picture>
    <picture><img src="https://cdn.example.test/images/6f0f1c3a-3a07-4782-a5a6-cf3270ad98de_w520_r1.33_fpx41.99_fpy45.jpg" alt="Player"></picture>
    <figcaption>Lead photo credit</figcaption>
  </figure><p>${"Long enough body paragraph to avoid short-body heuristic. ".repeat(12)}</p>`;
  const clean = sanitizeHtml(body, { heroImageUrl: hero });
  assert.equal(clean.includes("<img"), false);
  assert.equal(clean.includes("Lead photo credit"), false);
  assert.equal(clean.includes("Long enough body paragraph"), true);

  const proxied = sanitizeHtml(
    `<figure><img src="https://img-proxy.example.test/?url=https://media.example.test/576203.JPG&amp;q=100&amp;f=webp"><figcaption>Proxy caption</figcaption></figure><p>${"Article text. ".repeat(40)}</p>`,
    { heroImageUrl: "https://media.example.test/576203.JPG" },
  );
  assert.equal(proxied.includes("<img"), false);
  assert.equal(proxied.includes("Proxy caption"), false);
});
