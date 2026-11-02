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

test("parseOpml flattens nested subfolders to the top level while keeping parent folder for sibling feeds", async () => {
  const { parseOpml } = await loadOpml();
  const feeds = parseOpml(documentWith(
    '<outline text="Tech">' +
      '<outline text="Heise" xmlUrl="https://example.com/heise.xml"/>' +
      '<outline text="Apple">' +
        '<outline text="MacRumors" xmlUrl="https://example.com/macrumors.xml"/>' +
      '</outline>' +
      '<outline text="Golem" xmlUrl="https://example.com/golem.xml"/>' +
    '</outline>',
  ));

  assert.deepEqual(feeds, [
    { url: "https://example.com/heise.xml", label: "Heise", folder: "Tech" },
    { url: "https://example.com/macrumors.xml", label: "MacRumors", folder: "Apple" },
    { url: "https://example.com/golem.xml", label: "Golem", folder: "Tech" },
  ]);
});

test("parseOpml handles case-insensitive attributes, OPML 1.0 url fallback, BOM, and empty body", async () => {
  const { parseOpml } = await loadOpml();

  assert.deepEqual(parseOpml("\uFEFF<?xml version=\"1.0\"?><opml version=\"2.0\"><body></body></opml>"), []);

  const feeds = parseOpml(
    "\uFEFF" +
      documentWith(
        '<outline Text="Folder" url="https://example.com/folder-page">' +
          '<outline Text="Custom Name" Title="Original Title" xmlURL="https://example.com/feed.xml?a=1&amp;amp;b=2" htmlURL="https://example.com"/>' +
          '<outline Title="Legacy OPML" url="https://example.com/legacy.xml"/>' +
        "</outline>",
      ),
  );

  assert.deepEqual(feeds, [
    {
      url: "https://example.com/feed.xml?a=1&b=2",
      label: "Custom Name",
      title: "Original Title",
      siteUrl: "https://example.com",
      folder: "Folder",
    },
    {
      url: "https://example.com/legacy.xml",
      label: "Legacy OPML",
      folder: "Folder",
    },
  ]);
});

test("generateOpml and importOpmlFeeds seed feed metadata and avoid saving fallback URLs as custom labels", async () => {
  const { generateOpml, importOpmlFeeds, parseOpml } = await loadOpml();
  const { runMigrations, db } = await import("../src/db/index.js");
  const { listSubscriptionsForUser } = await import("../src/feeds/repository.js");
  const { stopPollingScheduler } = await import("../src/feeds/poller.js");
  runMigrations();

  try {
    const user = db.prepare("INSERT INTO users (email, display_name, password_hash) VALUES (?, ?, ?)").run("opml@example.com", "OPML Tester", "hash");
    const userId = Number(user.lastInsertRowid);

    const opmlInput = documentWith(
      '<outline text="Tech">' +
        '<outline text="My Custom Label" title="Official Feed Title" xmlUrl="feed://93.184.216.34/rss.xml" htmlUrl="https://93.184.216.34/news"/>' +
        '<outline text="http://93.184.216.34/raw.xml" xmlUrl="http://93.184.216.34/raw.xml" htmlUrl="javascript:alert(1)"/>' +
      "</outline>",
    );

    const result = await importOpmlFeeds(userId, opmlInput);
    assert.equal(result.imported, 2);
    assert.equal(result.failed, 0);

    const subs = listSubscriptionsForUser(userId).filter((s) => !s.is_system_inbox);
    const first = subs.find((s) => s.url === "https://93.184.216.34/rss.xml");
    const second = subs.find((s) => s.url === "http://93.184.216.34/raw.xml");

    assert.ok(first);
    assert.equal(first.label, "My Custom Label");
    assert.equal(first.title, "Official Feed Title");
    assert.equal(first.site_url, "https://93.184.216.34/news");
    assert.equal(first.folder_name, "Tech");

    assert.ok(second);
    assert.equal(second.label, null);
    assert.equal(second.title, null);
    assert.equal(second.site_url, null);

    const exported = generateOpml(userId);
    assert.match(exported, /text="My Custom Label" title="Official Feed Title"/);
    assert.equal(parseOpml(exported).length, 2);
  } finally {
    await stopPollingScheduler();
  }
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
