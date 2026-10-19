import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

test("saved articles are archived with full text and local images and outlive their subscription", async () => {
  const server = createServer((req, res) => {
    const host = `http://${req.headers.host}`;
    switch (req.url) {
      case "/feed.xml":
        return res.writeHead(200, { "content-type": "application/rss+xml" }).end(
          `<?xml version="1.0"?><rss version="2.0"><channel><title>Source</title><item><guid>a</guid><title>Quarterly gadget report</title><link>${host}/article</link><description>Short teaser</description></item><item><guid>b</guid><title>Other news</title><link>${host}/other</link></item></channel></rss>`,
        );
      case "/article":
        return res.writeHead(200, { "content-type": "text/html" }).end(
          `<html><head><title>Report</title></head><body><article><h1>Report</h1><p><img src="/photo.png" alt=""></p><p><img src="/drawing.svg"></p><p><img src="/pixel.gif" width="1" height="1"></p>${"<p>The archived body mentions a rare word: zirconium. It goes on for a while so the reader keeps it.</p>".repeat(12)}</article></body></html>`,
        );
      case "/photo.png": return res.writeHead(200, { "content-type": "image/png" }).end(PNG);
      case "/drawing.svg": return res.writeHead(200, { "content-type": "image/svg+xml" }).end("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>");
      default: return res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const archiveDir = mkdtempSync(join(tmpdir(), "feedkeeper-archive-test-"));
  const cacheDir = mkdtempSync(join(tmpdir(), "feedkeeper-image-cache-test-"));

  process.env.DATABASE_PATH = ":memory:";
  process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
  process.env.ALLOW_PRIVATE_FEEDS = "true";
  process.env.ARCHIVE_PATH = archiveDir;
  process.env.IMAGE_CACHE_PATH = cacheDir;
  const { db, runMigrations } = await import("../src/db/index.js");
  const repo = await import("../src/feeds/repository.js");
  const { subscribeToFeed, unsubscribeFromFeed } = await import("../src/feeds/service.js");
  const archive = await import("../src/feeds/archive.js");
  runMigrations();

  const addUser = db.prepare("INSERT INTO users (email, password_hash, display_name) VALUES (?, 'hash', ?)");
  const ownerId = Number(addUser.run("archive-owner@example.test", "Owner").lastInsertRowid);
  const otherId = Number(addUser.run("archive-other@example.test", "Other").lastInsertRowid);
  const itemId = (guid: string) => (db.prepare("SELECT id FROM items WHERE guid = ?").get(guid) as { id: number }).id;

  try {
    const feed = await subscribeToFeed(ownerId, `${base}/feed.xml`);
    const saved = itemId("a");
    assert.equal(repo.bookmarkItem(ownerId, saved), 1);
    archive.scheduleArchive(saved);
    await archive.archiveIdle();

    // Full text and only the raster image are archived; SVG and tracking pixels are skipped.
    const stored = repo.findItemById(saved)!;
    assert.ok(stored.archived_at);
    assert.match(stored.full_content_html ?? "", /zirconium/);
    const images = db.prepare("SELECT id, source_url, file_name, mime_type FROM archived_images WHERE item_id = ?").all(saved) as { id: number; source_url: string; file_name: string; mime_type: string }[];
    assert.deepEqual(images.map((image) => [image.source_url, image.mime_type]), [[`${base}/photo.png`, "image/png"]]);
    assert.ok(existsSync(join(archiveDir, images[0].file_name)));

    // Served HTML points at the local copy; only people who may see the article get the image.
    const [served] = archive.withArchivedImages([stored], "https://feeds.example.test");
    assert.match(served.full_content_html ?? "", new RegExp(`src="https://feeds.example.test/api/archive/images/${images[0].id}"`));
    assert.ok(archive.findArchivedImage(ownerId, images[0].id));
    assert.equal(archive.findArchivedImage(otherId, images[0].id), null);

    // The saved list ignores read state and the word filter, and searches the archived text.
    repo.markItemRead(ownerId, saved);
    repo.addMutedKeyword(ownerId, "gadget");
    assert.deepEqual(repo.listItemsForUser(ownerId, { bookmarkedOnly: true }).map((item) => item.id), [saved]);
    assert.equal(repo.listItemsForUser(ownerId, {}).some((item) => item.id === saved), false);
    assert.deepEqual(repo.listItemsForUser(ownerId, { bookmarkedOnly: true, search: "zirconium" }).map((item) => item.id), [saved]);
    assert.deepEqual(repo.listItemsForUser(ownerId, { search: "zirconium" }), []);

    // Unsubscribing keeps the saved article readable; the feed is no longer polled.
    unsubscribeFromFeed(ownerId, feed.id);
    assert.equal(repo.findItemById(itemId("a"))?.id, saved);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM items WHERE guid = 'b'").get()?.n, 0);
    assert.ok(repo.findItemForUser(ownerId, saved));
    assert.equal(repo.findItemForUser(otherId, saved), undefined);
    assert.equal(repo.listFeedsDueForPoll().some((due) => due.id === feed.id), false);
    assert.equal(repo.markItemUnread(ownerId, saved), 1);

    // Removing the bookmark deletes the archived files and, at cleanup, the leftover feed.
    assert.equal(repo.unbookmarkItem(ownerId, saved), 1);
    archive.pruneArchive();
    assert.deepEqual(readdirSync(archiveDir), []);
    assert.equal(repo.removeUnusedFeeds(), 1);
    assert.equal(repo.findItemById(saved), undefined);
  } finally {
    await archive.stopImageCache();
    server.close();
    db.close();
    rmSync(archiveDir, { recursive: true, force: true });
    rmSync(cacheDir, { recursive: true, force: true });
  }
});
