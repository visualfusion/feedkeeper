import { createHash } from "node:crypto";
import type { Request, Response } from "express";
import type { CachedImage } from "../feeds/imageCache.js";

/** Mutable proxy images revalidate; archive routes keep their separate immutable policy. */
export function sendArticleImage(req: Request, res: Response, image: CachedImage): void {
  const age = Math.max(0, Math.min(21600, Math.floor((image.cacheTtlMs ?? 21_600_000) / 1000)));
  const etag = `"${createHash("sha256").update(image.buffer).digest("hex")}"`;
  res.setHeader("Cache-Control", age ? `private, max-age=${age}` : "private, no-store");
  res.setHeader("ETag", etag);
  const matches = req.headers["if-none-match"]?.split(",").some(value => value.trim().replace(/^W\//, "") === etag || value.trim() === "*");
  if (matches) { res.status(304).end(); return; }
  res.type(image.mime).send(image.buffer);
}
