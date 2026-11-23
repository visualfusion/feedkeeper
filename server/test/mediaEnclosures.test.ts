import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

test("parseDurationSeconds normalizes numeric, MM:SS, and HH:MM:SS formats", async () => {
  process.env.DATABASE_PATH ??= ":memory:";
  process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters";
  const { parseDurationSeconds } = await import("../src/feeds/feedParser.js");
  assert.equal(parseDurationSeconds(3600), 3600);
  assert.equal(parseDurationSeconds("3600"), 3600);
  assert.equal(parseDurationSeconds("42:15"), 2535);
  assert.equal(parseDurationSeconds("1:02:30"), 3750);
  assert.equal(parseDurationSeconds("0"), null);
  assert.equal(parseDurationSeconds("invalid"), null);
});

test("parseFeedBody extracts audio/video enclosures, duration, and chapters from RSS and JSON Feed", async () => {
  process.env.DATABASE_PATH ??= ":memory:";
  process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters";
  const { parseFeedBody } = await import("../src/feeds/feedParser.js");
  const rss = `<?xml version="1.0" encoding="UTF-8"?>
  <rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:podcast="https://podcastindex.org/namespace/1.0">
    <channel>
      <title>Podcast Show</title>
      <item>
        <guid>ep-1</guid>
        <title>Episode 1</title>
        <link>https://example.org/ep-1</link>
        <enclosure url="https://cdn.example.org/ep-1.mp3" type="audio/mpeg" length="123456" />
        <itunes:duration>42:15</itunes:duration>
        <podcast:chapters url="https://cdn.example.org/ep-1.chapters.json" type="application/json+chapters" />
      </item>
    </channel>
  </rss>`;

  const parsedRss = await parseFeedBody(rss);
  assert.equal(parsedRss.items[0]?.enclosureUrl, "https://cdn.example.org/ep-1.mp3");
  assert.equal(parsedRss.items[0]?.enclosureType, "audio/mpeg");
  assert.equal(parsedRss.items[0]?.enclosureDurationSeconds, 2535);
  assert.equal(parsedRss.items[0]?.chaptersUrl, "https://cdn.example.org/ep-1.chapters.json");

  const jsonFeed = JSON.stringify({
    version: "https://jsonfeed.org/version/1.1",
    title: "Video Feed",
    items: [
      {
        id: "vid-1",
        url: "https://example.org/vid-1",
        title: "Demo Video",
        attachments: [
          { url: "https://cdn.example.org/demo.mp4", mime_type: "video/mp4", duration_in_seconds: 125 },
        ],
      },
    ],
  });

  const parsedJson = await parseFeedBody(jsonFeed);
  assert.equal(parsedJson.items[0]?.enclosureUrl, "https://cdn.example.org/demo.mp4");
  assert.equal(parsedJson.items[0]?.enclosureType, "video/mp4");
  assert.equal(parsedJson.items[0]?.enclosureDurationSeconds, 125);
});

test("parsePodcastChapters filters hidden chapters and sorts by startTime", async () => {
  process.env.DATABASE_PATH ??= ":memory:";
  process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters";
  const { parsePodcastChapters } = await import("../src/feeds/chapters.js");
  const chapters = parsePodcastChapters(JSON.stringify({
    version: "1.2.0",
    chapters: [
      { startTime: 120, title: "Topic B", url: "https://example.org/b" },
      { startTime: 60, title: "Hidden Ad", toc: false },
      { startTime: 0, title: "Intro" },
    ],
  }));

  assert.deepEqual(chapters, [
    { startTime: 0, title: "Intro" },
    { startTime: 120, title: "Topic B", url: "https://example.org/b" },
  ]);
});

test("media enclosures and chapters are stored, serialized, and served via loadItemChapters", async () => {
  const server = createServer((req, res) => {
    const host = `http://${req.headers.host}`;
    if (req.url === "/podcast.xml") {
      res.writeHead(200, { "content-type": "application/rss+xml" }).end(`<?xml version="1.0"?>
        <rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:podcast="https://podcastindex.org/namespace/1.0">
          <channel>
            <title>Podcast Feed</title>
            <item>
              <guid>ep-100</guid>
              <title>Episode 100</title>
              <link>${host}/ep-100</link>
              <enclosure url="${host}/ep-100.mp3" type="audio/mpeg" length="999" />
              <itunes:duration>01:05:00</itunes:duration>
              <podcast:chapters url="${host}/ep-100.chapters.json" type="application/json+chapters" />
            </item>
          </channel>
        </rss>`);
      return;
    }
    if (req.url === "/ep-100.chapters.json") {
      res.writeHead(200, { "content-type": "application/json+chapters" }).end(JSON.stringify({
        version: "1.2.0",
        chapters: [{ startTime: 0, title: "Intro" }, { startTime: 90, title: "Main Topic" }],
      }));
      return;
    }
    res.writeHead(404).end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  process.env.DATABASE_PATH = ":memory:";
  process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
  process.env.ALLOW_PRIVATE_FEEDS = "true";
  const { db, runMigrations } = await import("../src/db/index.js");
  const { subscribeToFeed } = await import("../src/feeds/service.js");
  const { findItemForUser } = await import("../src/feeds/repository.js");
  const { serializeItem, readingPositions } = await import("../src/api/v1/serialize.js");
  const { loadItemChapters } = await import("../src/feeds/chapters.js");
  const { stopPollingScheduler } = await import("../src/feeds/poller.js");
  runMigrations();

  try {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const userId = Number(db.prepare("INSERT INTO users (email, password_hash, display_name) VALUES (?, 'hash', 'P')").run(`media-p-${suffix}@example.test`).lastInsertRowid);
    const otherUserId = Number(db.prepare("INSERT INTO users (email, password_hash, display_name) VALUES (?, 'hash', 'O')").run(`media-o-${suffix}@example.test`).lastInsertRowid);
    const sub = await subscribeToFeed(userId, `${base}/podcast.xml`);
    const itemRow = db.prepare<[number], { id: number }>("SELECT id FROM items WHERE feed_id = ?").get(sub.id)!;
    const item = findItemForUser(userId, itemRow.id)!;

    const serialized = serializeItem(item, readingPositions(userId, [item.id]), true, false);
    assert.deepEqual(serialized.media, {
      url: `${base}/ep-100.mp3`,
      type: "audio/mpeg",
      durationSeconds: 3900,
      chaptersUrl: `${base}/ep-100.chapters.json`,
    });

    const chaptersRes = await loadItemChapters(userId, item.id);
    assert.deepEqual(chaptersRes, {
      status: "ok",
      chapters: [{ startTime: 0, title: "Intro" }, { startTime: 90, title: "Main Topic" }],
    });
    assert.deepEqual(await loadItemChapters(otherUserId, item.id), { status: "not_found" });
  } finally {
    await stopPollingScheduler();
    server.close();
    db.close();
  }
});
