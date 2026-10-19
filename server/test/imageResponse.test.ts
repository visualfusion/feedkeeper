import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { sendArticleImage } from "../src/api/imageResponse.js";

test("mutable image responses revalidate bytes and respect source cache limits", async () => {
  let body = Buffer.from("first"); let ttl = 60_000;
  const app = express();
  app.get("/image", (req, res) => sendArticleImage(req, res, { buffer: body, mime: "image/png", cacheTtlMs: ttl }));
  const server = createServer(app); await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/image`;
    const first = await fetch(url); const tag = first.headers.get("etag")!;
    assert.equal(first.headers.get("cache-control"), "private, max-age=60");
    assert.equal(await first.text(), "first");
    const unchanged = await fetch(url, { headers: { "If-None-Match": `W/${tag}` } });
    assert.equal(unchanged.status, 304); assert.equal(await unchanged.text(), "");
    body = Buffer.from("second"); ttl = 365 * 86400_000;
    const changed = await fetch(url, { headers: { "If-None-Match": tag } });
    assert.equal(changed.status, 200); assert.equal(await changed.text(), "second");
    assert.notEqual(changed.headers.get("etag"), tag); assert.equal(changed.headers.get("cache-control"), "private, max-age=21600");
    ttl = 0;
    assert.equal((await fetch(url)).headers.get("cache-control"), "private, no-store");
  } finally { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); }
});
