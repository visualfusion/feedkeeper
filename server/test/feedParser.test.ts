import assert from "node:assert/strict";
import { test } from "node:test";
import { parseFeedBody } from "../src/feeds/feedParser.js";

test("GitHub Atom feeds ignore small author avatars and keep real release screenshots", async () => {
  const releasesAtom = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/" xml:lang="en-US">
  <title>Release notes from feedkeeper</title>
  <entry>
    <id>tag:github.com,2008:Repository/1/v0.42.4</id>
    <link rel="alternate" type="text/html" href="https://github.com/visualfusion/feedkeeper/releases/tag/v0.42.4"/>
    <title>FeedKeeper 0.42.4</title>
    <content type="html">&lt;p&gt;This maintenance release makes feed errors easier to understand.&lt;/p&gt;</content>
    <author><name>visualfusion</name></author>
    <media:thumbnail height="30" width="30" url="https://avatars.githubusercontent.com/u/1937591?s=60&amp;v=4"/>
  </entry>
  <entry>
    <id>tag:github.com,2008:Repository/1/v0.43.0</id>
    <link rel="alternate" type="text/html" href="https://github.com/visualfusion/feedkeeper/releases/tag/v0.43.0"/>
    <title>FeedKeeper 0.43.0</title>
    <content type="html">&lt;p&gt;Release with screenshot:&lt;/p&gt;&lt;p&gt;&lt;img src="https://user-images.githubusercontent.com/1937591/screenshot.png" alt="Screenshot"&gt;&lt;/p&gt;</content>
    <author><name>visualfusion</name></author>
    <media:thumbnail height="30" width="30" url="https://avatars.githubusercontent.com/u/1937591?s=60&amp;v=4"/>
  </entry>
</feed>`;

  const parsedReleases = await parseFeedBody(releasesAtom);
  assert.equal(parsedReleases.items.length, 2);
  assert.equal(parsedReleases.items[0]!.imageUrl, null);
  assert.equal(parsedReleases.items[1]!.imageUrl, "https://user-images.githubusercontent.com/1937591/screenshot.png");

  const activityAtom = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/" xml:lang="en-US">
  <title>GitHub Public Timeline Feed</title>
  <entry>
    <id>tag:github.com,2008:issue_closed/1</id>
    <link type="text/html" rel="alternate" href="https://github.com/visualfusion/feedkeeper/issues/13"/>
    <title>visualfusion closed an issue</title>
    <media:thumbnail height="30" width="30" url="https://avatars.githubusercontent.com/u/1937591?s=30&amp;v=4"/>
    <content type="html">&lt;div&gt;&lt;img class="avatar avatar-user" src="https://avatars.githubusercontent.com/u/1937591?s=64&amp;amp;v=4" width="32" height="32"&gt;&lt;img src="https://example.org/badge.png" width="16" height="16" class="icon"&gt;&lt;/div&gt;</content>
  </entry>
</feed>`;

  const parsedActivity = await parseFeedBody(activityAtom);
  assert.equal(parsedActivity.items[0]!.imageUrl, null);
});

test("extractXmlImageUrl preserves regular thumbnails and skips tiny icons", async () => {
  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>Example News</title>
    <item>
      <guid>item-1</guid>
      <title>Publisher thumbnail</title>
      <link>https://example.test/story-1</link>
      <media:thumbnail url="https://example.test/thumb__wide__148" width="148" height="100"/>
    </item>
    <item>
      <guid>item-2</guid>
      <title>Small icon thumbnail followed by real image</title>
      <link>https://example.test/story-2</link>
      <media:thumbnail url="https://example.test/avatar.png" width="48" height="48"/>
      <description>&lt;p&gt;&lt;img src="https://example.test/icon.png" width="24" height="24"&gt;&lt;img src="https://example.test/photo.jpg" width="800" height="600"&gt;&lt;/p&gt;</description>
    </item>
  </channel>
</rss>`;

  const parsed = await parseFeedBody(rss);
  assert.equal(parsed.items[0]!.imageUrl, "https://example.test/thumb__wide__148");
  assert.equal(parsed.items[1]!.imageUrl, "https://example.test/photo.jpg");
});

test("migration 0046 clears stored GitHub avatar hero URLs and bumps content revision", async () => {
  process.env.DATABASE_PATH = ":memory:";
  process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
  const { db, runMigrations } = await import("../src/db/index.js");
  runMigrations();

  const feedId = Number(db.prepare("INSERT INTO feeds (url, title) VALUES ('https://github.com/visualfusion/feedkeeper/releases.atom', 'Releases')").run().lastInsertRowid);
  db.prepare("INSERT INTO items (feed_id, guid, title, image_url) VALUES (?, 'g1', 'Release 1', 'https://avatars.githubusercontent.com/u/1937591?s=60&v=4')").run(feedId);
  db.prepare("INSERT INTO items (feed_id, guid, title, image_url) VALUES (?, 'g2', 'Release 2', 'https://user-images.githubusercontent.com/1937591/screenshot.png')").run(feedId);

  const { readFileSync } = await import("node:fs");
  const sql = readFileSync(new URL("../src/db/migrations/0046_drop_avatar_hero_images.sql", import.meta.url), "utf8");
  db.exec(sql);

  const g1 = db.prepare<[number], { image_url: string | null; content_revision: number }>("SELECT image_url, content_revision FROM items WHERE feed_id = ? AND guid = 'g1'").get(feedId)!;
  const g2 = db.prepare<[number], { image_url: string | null; content_revision: number }>("SELECT image_url, content_revision FROM items WHERE feed_id = ? AND guid = 'g2'").get(feedId)!;
  assert.equal(g1.image_url, null);
  assert.equal(g1.content_revision, 2);
  assert.equal(g2.image_url, "https://user-images.githubusercontent.com/1937591/screenshot.png");
  assert.equal(g2.content_revision, 1);
});
