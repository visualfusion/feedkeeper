import { requireCapability } from "../auth/capabilities.js";
import { Router } from "express";
import { z } from "zod";
import { requireSession } from "../auth/middleware.js";
import {
  listFoldersForUser,
  createFolder,
  updateFolder,
  deleteFolder,
  findFolderById,
  markAllRead,
} from "../feeds/repository.js";

export const foldersRouter = Router();
foldersRouter.use(requireSession);

const folderNameSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

foldersRouter.get("/", (req, res) => {
  const folders = listFoldersForUser(req.user!.id);
  res.json({ folders });
});

foldersRouter.post("/", requireCapability("sync"), (req, res) => {
  const parsed = folderNameSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
    return;
  }

  const folder = createFolder(req.user!.id, parsed.data.name);
  res.status(201).json({
    ...folder,
    feed_count: 0,
    unread_count: 0,
  });
});

foldersRouter.patch("/:folderId", (req, res) => {
  const folderId = Number(req.params.folderId);
  const existing = findFolderById(req.user!.id, folderId);
  if (!existing) {
    res.status(404).json({ error: "folder_not_found" });
    return;
  }

  const parsed = folderNameSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
    return;
  }

  const updated = updateFolder(req.user!.id, folderId, parsed.data.name);
  res.json(updated);
});

foldersRouter.delete("/:folderId", (req, res) => {
  const folderId = Number(req.params.folderId);
  deleteFolder(req.user!.id, folderId);
  res.json({ success: true });
});

foldersRouter.post("/:folderId/read", (req, res) => {
  const folderId = Number(req.params.folderId);
  const updatedCount = markAllRead(req.user!.id, { folderId });
  res.json({ read: updatedCount });
});
