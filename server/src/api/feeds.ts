import { Router } from "express";
import { z } from "zod";
import { requireSession } from "../auth/middleware.js";
import { listSubscriptionsForUser } from "../feeds/repository.js";
import { subscribeToFeed, unsubscribeFromFeed, updateFeedSettings, FeedError } from "../feeds/service.js";
import { SsrfBlockedError } from "../feeds/ssrfGuard.js";

export const feedsRouter = Router();
feedsRouter.use(requireSession);

feedsRouter.get("/", (req, res) => {
  res.json(listSubscriptionsForUser(req.user!.id));
});

const subscribeSchema = z.object({
  url: z.string().url(),
  label: z.string().max(200).nullable().optional(),
});

feedsRouter.post("/", async (req, res) => {
  const parsed = subscribeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
    return;
  }

  try {
    const subscription = await subscribeToFeed(req.user!.id, parsed.data.url, parsed.data.label ?? null);
    res.status(201).json(subscription);
  } catch (error) {
    if (error instanceof SsrfBlockedError) {
      res.status(400).json({ error: "blocked_url", message: error.message });
      return;
    }
    if (error instanceof FeedError) {
      res.status(409).json({ error: error.message });
      return;
    }
    res.status(400).json({ error: "invalid_feed", message: error instanceof Error ? error.message : String(error) });
  }
});

const updateSchema = z.object({
  label: z.string().max(200).nullable().optional(),
  pollIntervalMinutes: z.number().int().positive().max(10080).optional(),
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
