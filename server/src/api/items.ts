import { Router } from "express";
import { z } from "zod";
import { requireSession } from "../auth/middleware.js";
import { listItemsForUser, markAllRead, markItemRead, markItemUnread } from "../feeds/repository.js";

export const itemsRouter = Router();
itemsRouter.use(requireSession);

const listQuerySchema = z.object({
  feedId: z.coerce.number().int().positive().optional(),
  unreadOnly: z.coerce.boolean().optional(),
  search: z.string().max(200).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

itemsRouter.get("/", (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
    return;
  }
  const items = listItemsForUser(req.user!.id, parsed.data);
  res.json(items.map((item) => ({ ...item, read: Boolean(item.read) })));
});

const markAllReadSchema = z.object({ feedId: z.number().int().positive().optional() });

itemsRouter.post("/mark-all-read", (req, res) => {
  const parsed = markAllReadSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  const count = markAllRead(req.user!.id, parsed.data.feedId);
  res.json({ marked: count });
});

itemsRouter.post("/:itemId/read", (req, res) => {
  markItemRead(req.user!.id, Number(req.params.itemId));
  res.status(204).end();
});

itemsRouter.post("/:itemId/unread", (req, res) => {
  markItemUnread(req.user!.id, Number(req.params.itemId));
  res.status(204).end();
});
