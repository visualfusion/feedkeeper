import { Router } from "express";
import { z } from "zod";
import { requireSession, requireAdmin } from "../auth/middleware.js";
import {
  getRetentionSettings,
  updateRetentionSettings,
  getDatabaseStats,
  runCleanup,
} from "../feeds/cleanup.js";

export const systemRouter = Router();
systemRouter.use(requireSession);
systemRouter.use(requireAdmin);

systemRouter.get("/retention", (_req, res) => {
  const settings = getRetentionSettings();
  const stats = getDatabaseStats();
  res.json({ settings, stats });
});

const updateRetentionSchema = z.object({
  retentionReadDays: z.number().int().min(0).max(3650).optional(),
  retentionMaxDays: z.number().int().min(0).max(3650).optional(),
  retentionMaxItemsPerFeed: z.number().int().min(0).max(100000).optional(),
  retentionMinItemsPerFeed: z.number().int().min(0).max(10000).optional(),
  autoCleanupEnabled: z.boolean().optional(),
});

systemRouter.patch("/retention", (req, res) => {
  const parsed = updateRetentionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
    return;
  }

  const settings = updateRetentionSettings(parsed.data);
  const stats = getDatabaseStats();
  res.json({ settings, stats });
});

systemRouter.post("/cleanup", (_req, res) => {
  try {
    const result = runCleanup();
    const stats = getDatabaseStats();
    res.json({ result, stats });
  } catch (error) {
    res.status(500).json({
      error: "cleanup_failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
