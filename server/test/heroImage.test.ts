import assert from "node:assert/strict";
import { test } from "node:test";
import { comparableImageKey, imageVariant, largerHeroImage } from "../src/feeds/heroImage.js";

const base = "https://images.example.test/2026/10/purchased-11_1791277144_g5wyjVXE__wide__";
const article = `<figure><picture>
  <source media="(max-width:360px)" srcset="${base}360?v=1, ${base}720?v=1 2x">
  <source media="(min-width:1024px)" srcset="${base}824?v=1, ${base}1648?v=1 2x">
  <img width="824" height="654" src="${base}824?v=1" alt="Lufthansa">
</picture></figure><p>Text</p>`;

test("sizes in a file name, in a WordPress name and in the query are recognised, other addresses are not", () => {
  assert.deepEqual(imageVariant(`${base}148`), { key: `https://images.example.test/2026/10/purchased-11_1791277144_g5wyjVXE__wide__#`, width: 148 });
  assert.equal(imageVariant("https://example.test/wp/photo-300x200.jpg")?.width, 300);
  assert.equal(imageVariant("https://example.test/photo_640x360.png")?.width, 640);
  assert.equal(imageVariant("https://example.test/photo.jpg?w=400&q=80")?.width, 400);
  assert.equal(imageVariant("https://example.test/photo.jpg"), null);
  assert.equal(imageVariant("not a url"), null);
  assert.equal(imageVariant("https://example.test/photo-300x200.jpg")?.key, imageVariant("https://example.test/photo-1024x683.jpg")?.key);
});

test("a thumbnail of the feed is replaced by the larger size the article shows, up to the hero width", () => {
  assert.equal(largerHeroImage(`${base}148`, article, "https://www.example.test/a"), `${base}1648?v=1`);
  const wide = article.replace(/__1648/g, "__2400");
  assert.equal(largerHeroImage(`${base}148`, wide, null), `${base}824?v=1`, "a size beyond the hero width is left out");
});

test("nothing changes without a clearly larger variant of the same picture", () => {
  assert.equal(largerHeroImage(`${base}824`, article, null), `${base}1648?v=1`, "double the width is clearly larger");
  assert.equal(largerHeroImage(`${base}1648`, article, null), null, "already the largest");
  assert.equal(largerHeroImage(`${base}700`, `<img src="${base}824">`, null), null, "824 is not clearly larger than 700");
  assert.equal(largerHeroImage("https://example.test/other-100x50.jpg", article, null), null, "a different picture");
  assert.equal(largerHeroImage("https://example.test/photo.jpg", article, null), null, "no recognised size");
  assert.equal(largerHeroImage(null, article, null), null);
  assert.equal(largerHeroImage(`${base}148`, "", null), null);
  assert.equal(largerHeroImage(`${base}148`, "plain text", null), null);
});

test("comparableImageKey and aspect-ratio crop path variants match across presets and formats", () => {
  const presetA = "https://images.example.test/images/site/4/gs-squadron-42_6444778.jpg";
  const presetB = "https://images.example.test/images/site/290/gs-squadron-42_6444778.jpg";
  assert.equal(comparableImageKey(presetA), comparableImageKey(presetB));
  const cropSmall = "https://images.example.test/image/id/base/cropA/16x7/photo-238.webp?width=640";
  const cropLarge = "https://images.example.test/image/id/base/cropB/16x9-big/photo-238.jpg?width=1920";
  assert.equal(comparableImageKey(cropSmall), comparableImageKey(cropLarge));
  assert.equal(largerHeroImage(cropSmall, `<img src="${cropLarge}">`, null), cropLarge);

  const focalSmall = "https://cdn.example.test/images/6f0f1c3a-3a07-4782-a5a6-cf3270ad98de_w520_r2.08_fpx41.99_fpy45.jpg";
  const focalLarge = "https://cdn.example.test/images/6f0f1c3a-3a07-4782-a5a6-cf3270ad98de_w960_r1.5_fpx41.99_fpy45.jpg";
  assert.equal(comparableImageKey(focalSmall), comparableImageKey(focalLarge));
  assert.equal(largerHeroImage(focalSmall, `<img src="${focalLarge}">`, null), focalLarge);
});

