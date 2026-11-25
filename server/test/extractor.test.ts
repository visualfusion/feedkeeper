import assert from "node:assert/strict";
import { test } from "node:test";
import { extractArticleFromUrl } from "../src/feeds/extractor.js";
import { SsrfBlockedError } from "../src/feeds/ssrfGuard.js";

test("article extraction rejects redirects to internal addresses", async () => {
  const requests: string[] = [];
  const mockFetch: typeof fetch = async (input) => {
    requests.push(String(input));
    return new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1/private" },
    });
  };

  await assert.rejects(extractArticleFromUrl("https://93.184.216.34/article", mockFetch), SsrfBlockedError);
  assert.deepEqual(requests, ["https://93.184.216.34/article"]);
});

test("article extraction skips oversized responses", async () => {
  let requests = 0;
  const mockFetch: typeof fetch = async () => {
    requests++;
    return new Response("too large", {
      headers: { "content-length": String(6 * 1024 * 1024) },
    });
  };

  assert.equal(await extractArticleFromUrl("https://93.184.216.34/article", mockFetch), null);
  assert.equal(requests, 1);
});

test("article extraction resolves WordPress lazy-loaded images to src", async () => {
  const html = `
    <!DOCTYPE html>
    <html>
      <head><title>Mimikama Test</title></head>
      <body>
        <article>
          <h1>Mimikama Test Title</h1>
          <p>Hier ist ein ausführlicher Artikeltext über ein Gerücht im Internet, der lang genug ist um als vollständiger Inhalt erkannt zu werden. Mehr Text für den Hauptinhalt.</p>
          <img src="data:image/svg+xml,%3Csvg%3E%3C/svg%3E" data-lazy-src="https://www.mimikama.org/wp-content/uploads/2026/10/real-image.png" alt="Beispiel">
          <p>Weiterer Text nach dem Bild um die Mindestlänge für Readability locker zu erreichen und sicherzustellen, dass der Artikel als OK eingestuft wird.</p>
        </article>
      </body>
    </html>
  `;
  const mockFetch: typeof fetch = async () => new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });

  const result = await extractArticleFromUrl("https://93.184.216.34/article", mockFetch);
  assert.ok(result);
  assert.ok(result.contentHtml.includes('src="https://www.mimikama.org/wp-content/uploads/2026/10/real-image.png"'));
  assert.ok(!result.contentHtml.includes('src="data:image/svg'));
});

test("article extraction keeps the video behind a consent plugin and a social post as a marked link", async () => {
  const text = "Ein ausführlicher Absatz, der lang genug ist, damit der Artikel als vollständiger Inhalt erkannt wird und Readability ihn behält. ".repeat(4);
  const html = `<html><head><script>window.x = 1;</script></head><body><article><h1>Titel</h1><p>${text}</p>` +
    '<figure class="wp-block-embed"><div class="embed-privacy-container" data-embed-provider="youtube"><p>An dieser Stelle befindet sich ein externer Inhalt von YouTube.</p>' +
    '<div class="embed-privacy-content"><script type="pmdelayedscript">var _e = \'{\\"embed\\":\\"&lt;iframe title=&quot;Vigil&quot; src=&quot;https:\\\\/\\\\/www.youtube-nocookie.com\\\\/embed\\\\/Ea1eWarxdxQ&quot;&gt;&lt;\\\\/iframe&gt;\\"}\';</script></div></div></figure>' +
    `<p>${text}</p><iframe src="https://www.youtube.com/embed/AbCdEf12345" title="Trailer"></iframe>` +
    '<blockquote class="instagram-media"><a href="https://www.instagram.com/p/DAbc_12-x/?utm_source=ig_embed">Post</a></blockquote>' +
    `<p>${text}</p></article></body></html>`;
  const mockFetch: typeof fetch = async () => new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });

  const result = await extractArticleFromUrl("https://93.184.216.34/article", mockFetch);
  assert.ok(result);
  assert.match(result.contentHtml, /href="https:\/\/www\.youtube\.com\/watch\?v=Ea1eWarxdxQ"[^>]*data-media="video"/);
  assert.match(result.contentHtml, /href="https:\/\/www\.youtube\.com\/watch\?v=AbCdEf12345"[^>]*data-media="video"/);
  assert.match(result.contentHtml, /href="https:\/\/www\.instagram\.com\/p\/DAbc_12-x\/"[^>]*data-media="social"/);
  assert.doesNotMatch(result.contentHtml, /externer Inhalt|<iframe|<script/);
});

test("an article its publisher flags as not free keeps its text and ends with a paywall link when enough of it is there", async () => {
  const text = "Ein ausführlicher Absatz, der lang genug ist, damit der Artikel als vollständiger Inhalt erkannt wird und Readability ihn behält. ".repeat(24);
  const page = (body: string) => `<html><head><script type="application/ld+json">{"isAccessibleForFree": false}</script></head><body><article><h1>Titel</h1>${body}</article></body></html>`;
  const mockFetch = (html: string): typeof fetch => async () => new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });

  const long = await extractArticleFromUrl("https://93.184.216.34/article", mockFetch(page(`<p>${text}</p>`)));
  assert.ok(long, "enough text is delivered");
  assert.match(long.contentHtml, /<a href="https:\/\/93\.184\.216\.34\/article" data-media="paywall" data-source="93\.184\.216\.34">/);

  const teaser = await extractArticleFromUrl("https://93.184.216.34/article", mockFetch(page("<p>Nur ein kurzer Anriss, der lang genug ist, um als Inhalt zu gelten, aber weit unter der Grenze für einen ganzen Artikel liegt und deshalb als Paywall gilt.</p>")));
  assert.equal(teaser, null, "a teaser stays a paywall");
});

test("worker pool keeps the main event loop responsive across large HTML documents and stops cleanly", async () => {
  const { stopExtractorPool } = await import("../src/feeds/extractorPool.js");
  const paragraph = "<p>Ein langer Absatz mit genug Text für die Readability-Erkennung im Worker-Thread. ".repeat(30) + "</p>";
  const largeHtml = `<html><head><title>Worker Test</title></head><body><article><h1>Worker Test</h1>${paragraph.repeat(40)}</article></body></html>`;
  const mockFetch: typeof fetch = async () => new Response(largeHtml, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });

  let maxGap = 0;
  let last = performance.now();
  const ticker = setInterval(() => {
    const now = performance.now();
    maxGap = Math.max(maxGap, now - last);
    last = now;
  }, 5);
  try {
    const results = await Promise.all([
      extractArticleFromUrl("https://93.184.216.34/one", mockFetch),
      extractArticleFromUrl("https://93.184.216.35/two", mockFetch),
    ]);
    assert.ok(results.every(r => r && r.title === "Worker Test"));
    assert.ok(maxGap < 250, `main event loop stayed responsive (max timer gap ${Math.round(maxGap)}ms)`);
  } finally {
    clearInterval(ticker);
    await stopExtractorPool();
  }
});

test("worker pool recycles workers after reaching max tasks and continues parsing", async () => {
  const { stopExtractorPool } = await import("../src/feeds/extractorPool.js");
  const prevMax = process.env.EXTRACTOR_WORKER_MAX_TASKS;
  const prevWorkers = process.env.EXTRACTOR_WORKERS;
  process.env.EXTRACTOR_WORKER_MAX_TASKS = "1";
  process.env.EXTRACTOR_WORKERS = "1";
  const paragraph = "<p>Ein langer Absatz mit genug Text für die Readability-Erkennung nach Worker-Recycling. ".repeat(10) + "</p>";
  const html = `<html><head><title>Recycle Test</title></head><body><article><h1>Recycle Test</h1>${paragraph}</article></body></html>`;
  const mockFetch: typeof fetch = async () => new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  try {
    await stopExtractorPool();
    for (let i = 0; i < 3; i++) {
      const result = await extractArticleFromUrl(`https://93.184.216.34/recycle-${i}`, mockFetch);
      assert.equal(result?.title, "Recycle Test");
    }
  } finally {
    if (prevMax === undefined) delete process.env.EXTRACTOR_WORKER_MAX_TASKS;
    else process.env.EXTRACTOR_WORKER_MAX_TASKS = prevMax;
    if (prevWorkers === undefined) delete process.env.EXTRACTOR_WORKERS;
    else process.env.EXTRACTOR_WORKERS = prevWorkers;
    await stopExtractorPool();
  }
});
