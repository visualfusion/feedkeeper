import { Router } from "express";
import { z } from "zod";
import { requireSession } from "../auth/middleware.js";
import { requireCapability } from "../auth/capabilities.js";
import { listSubscriptionsForUser, findFeedById, isUserSubscribed, reorderSubscriptions } from "../feeds/repository.js";
import { subscribeToFeed, unsubscribeFromFeed, updateFeedSettings, FeedError, MultipleFeedsFoundError } from "../feeds/service.js";
import { SsrfBlockedError, normalizeUrlCandidate } from "../feeds/ssrfGuard.js";
import { generateOpml, importOpmlFeeds } from "../feeds/opml.js";
import { pollFeed } from "../feeds/poller.js";
import { discoverFeeds } from "../feeds/discovery.js";
import { canAccessFeed, loadFeedIcon } from "../feeds/feedIcon.js";
import rateLimit from "express-rate-limit";

export const feedsRouter = Router();
feedsRouter.use(requireSession);

// Adding and updating feeds belongs to the plan's sync feature; reading, exporting and deleting stay available without it.
const requireSync = requireCapability("sync");

feedsRouter.get("/", (req, res) => {
  res.json(listSubscriptionsForUser(req.user!.id));
});

const reorderSchema = z.object({
  feedIds: z.array(z.number().int().positive()),
});

feedsRouter.put("/reorder", (req, res) => {
  const parsed = reorderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_feed_ids" });
    return;
  }
  const currentIds = listSubscriptionsForUser(req.user!.id).map((feed) => feed.id);
  const requestedIds = parsed.data.feedIds;
  if (requestedIds.length !== currentIds.length ||
      new Set(requestedIds).size !== currentIds.length ||
      requestedIds.some((id) => !currentIds.includes(id))) {
    res.status(400).json({ error: "invalid_feed_ids" });
    return;
  }
  reorderSubscriptions(req.user!.id, requestedIds);
  res.json({ ok: true });
});

const iconLimiter = rateLimit({ windowMs: 60 * 1000, limit: 600, standardHeaders: true, legacyHeaders: false });

// A feed's icon through this server, so it can be stored for offline use.
feedsRouter.get("/:feedId/icon", iconLimiter, async (req, res) => {
  const feedId = Number(req.params.feedId);
  const icon = canAccessFeed(req.user!.id, feedId) ? await loadFeedIcon(feedId) : null;
  if (!icon) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.setHeader("Cache-Control", "private, max-age=86400");
  // SVG icons must never run scripts, even when opened directly.
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  res.type(icon.mime).send(icon.buffer);
});

feedsRouter.get("/opml", (req, res) => {
  const opml = generateOpml(req.user!.id);
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="feedkeeper-subscriptions.opml"');
  res.send(opml);
});

feedsRouter.post("/opml", requireSync, async (req, res) => {
  const xmlContent =
    typeof req.body === "string"
      ? req.body
      : typeof req.body?.opml === "string"
        ? req.body.opml
        : null;

  if (!xmlContent || !xmlContent.trim()) {
    res.status(400).json({ error: "missing_opml_content" });
    return;
  }

  try {
    const result = await importOpmlFeeds(req.user!.id, xmlContent);
    res.json(result);
  } catch (error) {
    res.status(400).json({
      error: "invalid_opml",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

const urlField = z.preprocess(
  (val) => (typeof val === "string" ? normalizeUrlCandidate(val) : val),
  z.string().url(),
);

const discoverSchema = z.object({
  url: urlField,
});

feedsRouter.post("/discover", requireSync, async (req, res) => {
  const parsed = discoverSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
    return;
  }

  try {
    const feeds = await discoverFeeds(parsed.data.url);
    res.json({ feeds });
  } catch (error) {
    if (error instanceof SsrfBlockedError) {
      res.status(400).json({ error: "blocked_url", message: error.message });
      return;
    }
    res.status(400).json({ error: "discovery_failed", message: error instanceof Error ? error.message : String(error) });
  }
});

const subscribeSchema = z.object({
  url: urlField,
  label: z.string().max(200).nullable().optional(),
  folderId: z.number().int().positive().nullable().optional(),
});

feedsRouter.post("/", requireSync, async (req, res) => {
  const parsed = subscribeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
    return;
  }

  try {
    const subscription = await subscribeToFeed(
      req.user!.id,
      parsed.data.url,
      parsed.data.label ?? null,
      parsed.data.folderId ?? null,
    );
    res.status(201).json(subscription);
  } catch (error) {
    if (error instanceof SsrfBlockedError) {
      res.status(400).json({ error: "blocked_url", message: error.message });
      return;
    }
    if (error instanceof MultipleFeedsFoundError) {
      res.status(400).json({ error: "multiple_feeds_found", feeds: error.feeds });
      return;
    }
    if (error instanceof FeedError) {
      const status = error.message === "already_subscribed" ? 409 : 400;
      res.status(status).json({ error: error.message });
      return;
    }
    res.status(400).json({ error: "invalid_feed", message: error instanceof Error ? error.message : String(error) });
  }
});

const updateSchema = z.object({
  label: z.string().max(200).nullable().optional(),
  folderId: z.number().int().positive().nullable().optional(),
  pollIntervalMinutes: z.number().int().positive().max(10080).optional(),
  fullTextMode: z.enum(["auto", "never"]).optional(),
  notify: z.boolean().optional(),
  badge: z.boolean().optional(),
});

feedsRouter.patch("/:feedId", (req, res) => {
  const feedId = Number(req.params.feedId);
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
    return;
  }

  try {
    const subscription = updateFeedSettings(req.user!.id, feedId, parsed.data);
    res.json(subscription);
  } catch (error) {
    if (error instanceof FeedError) {
      res.status(404).json({ error: error.message });
      return;
    }
    throw error;
  }
});

feedsRouter.delete("/:feedId", (req, res) => {
  const feedId = Number(req.params.feedId);
  try {
    unsubscribeFromFeed(req.user!.id, feedId);
    res.status(204).end();
  } catch (error) {
    if (error instanceof FeedError) {
      res.status(404).json({ error: error.message });
      return;
    }
    throw error;
  }
});

feedsRouter.post("/:feedId/refresh", requireSync, async (req, res) => {
  const feedId = Number(req.params.feedId);
  if (!Number.isInteger(feedId) || feedId <= 0) {
    res.status(400).json({ error: "invalid_feed_id" });
    return;
  }

  const feed = findFeedById(feedId);
  if (!feed || !isUserSubscribed(req.user!.id, feedId)) {
    res.status(404).json({ error: "feed_not_found" });
    return;
  }

  const pollResult = await pollFeed(feed);
  const updatedFeed = listSubscriptionsForUser(req.user!.id).find((f) => f.id === feedId);
  res.json({
    feed: updatedFeed,
    newItems: pollResult.newItems,
    error: pollResult.error,
  });
});

feedsRouter.post("/refresh-all", requireSync, async (req, res) => {
  const subs = listSubscriptionsForUser(req.user!.id);
  let totalNewItems = 0;
  let errorCount = 0;

  for (const sub of subs) {
    const feed = findFeedById(sub.id);
    if (!feed) continue;
    const result = await pollFeed(feed);
    totalNewItems += result.newItems;
    if (result.error) errorCount++;
  }

  res.json({
    refreshed: subs.length,
    newItems: totalNewItems,
    errors: errorCount,
  });
});
