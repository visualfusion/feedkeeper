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
