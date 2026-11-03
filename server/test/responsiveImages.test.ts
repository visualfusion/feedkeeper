import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { extractArticleFromUrl } from "../src/feeds/extractor.js";
import { cleanReaderHtml } from "../src/feeds/contentNoise.js";
import { normalizeImageSources } from "../src/feeds/imageSources.js";

const images = [
  '<img src="/fallback.jpg" srcset="/small.jpg 1x, /large.jpg 2x" sizes="100vw" alt="Fallback">',
  '<img src="data:image/png;base64,AAAA" data-srcset="relative.jpg 640w, /large.jpg 1280w" alt="Relative">',
  '<picture><source type="image/webp" srcset="/picture.webp 1x, /large.webp 2x"><img alt="Picture"></picture>',
  '<img data-srcset="data:image/png;base64,AAAA 1x, /real.jpg 2x" alt="Placeholder">',
];
const sources = ["/fallback.jpg", "relative.jpg", "/picture.webp", "/real.jpg"];

test("responsive images survive extraction and reader cleaning with relative URLs and picture fallbacks", async () => {
  const text = "An editorial paragraph with enough details to count as the full article. ".repeat(10);
  const html = `<html><head><title>Responsive images</title></head><body><article><h1>Responsive images</h1><p>${text}</p>${images.join("")}<p>${text}</p></article></body></html>`;
  const result = await extractArticleFromUrl("https://93.184.216.34/story/", async () => new Response(html));
  assert.ok(result);
  const extracted = JSDOM.fragment(cleanReaderHtml(result.contentHtml));
  assert.deepEqual([...extracted.querySelectorAll("img")].map(img => img.getAttribute("src")), sources.map(src => new URL(src, "https://93.184.216.34/story/").href));
  const reader = JSDOM.fragment(cleanReaderHtml(images.join("")));
  assert.deepEqual([...reader.querySelectorAll("img")].map(img => img.getAttribute("src")), sources);
  assert.equal(reader.querySelector("picture source"), null);
});

test("raw responsive HTML uses only local archive or proxy image URLs", async () => {
  process.env.DATABASE_PATH = ":memory:";
  process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
  const { articleImageUrls, rewriteArchivedImages, withProxiedImages } = await import("../src/feeds/archive.js");
  const base = "https://publisher.example/story/";
  const urls = sources.map(src => new URL(src, base).href);
  const html = images.join("");
  assert.deepEqual(articleImageUrls(html, base), urls);
  const archived = rewriteArchivedImages(html, base, new Map(urls.map((url, index) => [url, index + 1])), "https://reader.example");
  const doc = JSDOM.fragment(archived);
  assert.deepEqual([...doc.querySelectorAll("img")].map(img => img.getAttribute("src")), urls.map((_, index) => `https://reader.example/api/archive/images/${index + 1}`));
  assert.equal(doc.querySelector("[srcset], [data-srcset], [sizes], picture source"), null);
  const [proxied] = withProxiedImages([{ id: 7, link: base, content_html: html }], "https://reader.example");
  const proxyDoc = JSDOM.fragment(proxied.content_html);
  for (const [index, image] of [...proxyDoc.querySelectorAll("img")].entries()) {
    const url = new URL(image.getAttribute("src")!);
    assert.equal(url.origin, "https://reader.example");
    assert.equal(url.searchParams.get("src"), urls[index]);
  }
  assert.equal(proxyDoc.querySelector("[srcset], [data-srcset], [sizes], picture source"), null);
  const unsafe = '<img src="javascript:alert(1)" data-srcset="data:image/png;base64,AAAA 1x, javascript:alert(2) 2x">';
  assert.deepEqual(articleImageUrls(unsafe, base), []);
});

test("a greater-than sign inside a media query does not end the source tag and leak into the text", () => {
  const html = '<figure><picture>'
    + '<source media="(resolution >= 3x)" srcset="_media/framed.1600w.avif" type="image/avif">'
    + '<source srcset="_media/framed.1088w.avif" type="image/avif">'
    + '<img src="_media/framed.png" alt="Framed" width="800" height="1000">'
    + '</picture></figure>';
  const normalized = normalizeImageSources(html);
  assert.equal(normalized.includes("3x)"), false, "no piece of the media query is left over");
  assert.equal(normalized.includes("<source"), false);
  assert.equal(JSDOM.fragment(normalized).textContent?.trim(), "");
  assert.equal(JSDOM.fragment(normalized).querySelector("img")?.getAttribute("src"), "_media/framed.png");
  const cleaned = JSDOM.fragment(cleanReaderHtml(normalized));
  assert.equal(cleaned.textContent?.trim(), "");
});
