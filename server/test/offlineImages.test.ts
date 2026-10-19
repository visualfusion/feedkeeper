import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

test("offline copies point at article images served through this server", async () => {
  const server = createServer((req, res) => {
    const host = `http://${req.headers.host}`;
    if (req.url === "/feed.xml") {
      return res.writeHead(200, { "content-type": "application/rss+xml" }).end(
        `<?xml version="1.0"?><rss version="2.0"><channel><title>Source</title><item><guid>a</guid><title>With pictures</title><link>${host}/a</link><description>&lt;p&gt;Text&lt;/p&gt;&lt;img src="/inline.png"&gt;&lt;img src="/notes.txt"&gt;</description><enclosure url="${host}/lead.png" type="image/png" length="1"/></item></channel></rss>`,
      );
    }
    if (req.url === "/inline.png" || req.url === "/lead.png") return res.writeHead(200, { "content-type": "image/png" }).end(PNG);
    if (req.url === "/notes.txt") return res.writeHead(200, { "content-type": "text/plain" }).end("not an image");
    return res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  process.env.DATABASE_PATH = ":memory:";
  process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
  process.env.ALLOW_PRIVATE_FEEDS = "true";
  const cacheDir = mkdtempSync(join(tmpdir(), "feedkeeper-offline-cache-test-"));
  process.env.IMAGE_CACHE_PATH = cacheDir;
  const { db, runMigrations } = await import("../src/db/index.js");
  const repo = await import("../src/feeds/repository.js");
  const { subscribeToFeed } = await import("../src/feeds/service.js");
  const archive = await import("../src/feeds/archive.js");
  runMigrations();

  const addUser = db.prepare("INSERT INTO users (email, password_hash, display_name) VALUES (?, 'hash', ?)");
  const ownerId = Number(addUser.run("offline-owner@example.test", "Owner").lastInsertRowid);
  const otherId = Number(addUser.run("offline-other@example.test", "Other").lastInsertRowid);

  try {
    await subscribeToFeed(ownerId, `${base}/feed.xml`);
    const item = repo.listItemsForUser(ownerId, {})[0];
    db.prepare("UPDATE items SET image_url = ? WHERE id = ?").run(`${base}/lead.png`, item.id);
    const stored = repo.findItemForUser(ownerId, item.id)!;

    const origin = "https://feeds.example.test";
    const [served] = archive.withProxiedImages([stored], origin);
    const proxied = (url: string) => `${origin}/api/items/${item.id}/image?src=${encodeURIComponent(url)}&v=2`;
    assert.equal(served.image_url, proxied(`${base}/lead.png`));
    assert.ok((served.content_html ?? "").includes(`src="${proxied(`${base}/inline.png`)}"`));

    // Only the images the article itself shows can be fetched, and only by people who may see it.
    const image = await archive.fetchItemImage(ownerId, item.id, `${base}/inline.png`);
    assert.ok(typeof image === "object" && image.mime === "image/png");
    assert.equal(await archive.fetchItemImage(ownerId, item.id, `${base}/other.png`), "forbidden");
    assert.equal(await archive.fetchItemImage(otherId, item.id, `${base}/inline.png`), "forbidden");
    assert.equal(await archive.fetchItemImage(ownerId, item.id, `${base}/notes.txt`), "unsupported");

    // Characters that URLs may keep unescaped are escaped anyway, so the web app can find the address in the text.
    const odd = { ...stored, image_url: null, content_html: `<img src="${base}/img(1)'a.png">`, full_content_html: null };
    assert.doesNotMatch(archive.withProxiedImages([odd], origin)[0].content_html ?? "", /src="[^"]*[()']/);

    // Images already served from the archive are left alone.
    const archived = { ...stored, content_html: `<img src="${origin}/api/archive/images/7">`, image_url: null };
    assert.equal(archive.withProxiedImages([archived], origin)[0].content_html, archived.content_html);
  } finally {
    await archive.stopImageCache();
    rmSync(cacheDir, { recursive: true, force: true });
    server.close();
  }
});
