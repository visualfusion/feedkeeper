import assert from "node:assert/strict";
import { test } from "node:test";

async function loadOpml() {
  process.env.DATABASE_PATH = ":memory:";
  process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
  return import("../src/feeds/opml.js");
}

const documentWith = (outlines: string) =>
  `<?xml version="1.0"?><opml version="2.0"><body>${outlines}</body></opml>`;

test("parseOpml extracts nested feeds and ignores folder outlines without xmlUrl", async () => {
  const { parseOpml } = await loadOpml();
  const feeds = parseOpml(documentWith(
    '<outline text="News"><outline text="Example" xmlUrl="https://example.com/rss"/></outline>' +
    '<outline text="No feed"/>',
  ));

  assert.deepEqual(feeds, [{
    url: "https://example.com/rss",
    label: "Example",
    folder: "News",
  }]);
});

test("parseOpml accepts exactly the maximum number of feeds", async () => {
  const { MAX_OPML_FEEDS, parseOpml } = await loadOpml();
  const outlines = Array.from(
    { length: MAX_OPML_FEEDS },
    (_, index) => `<outline xmlUrl="https://example.com/${index}"/>`,
  ).join("");

  assert.equal(parseOpml(documentWith(outlines)).length, MAX_OPML_FEEDS);
});

test("parseOpml rejects an oversized import before it can create subscriptions", async () => {
  const { MAX_OPML_FEEDS, parseOpml } = await loadOpml();
  const outlines = Array.from(
    { length: MAX_OPML_FEEDS + 1 },
    (_, index) => `<outline xmlUrl="https://example.com/${index}"/>`,
  ).join("");

  assert.throws(
    () => parseOpml(documentWith(outlines)),
    { message: "too_many_opml_feeds" },
  );
});
