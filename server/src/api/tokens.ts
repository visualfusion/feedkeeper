import { Router } from "express";
import { z } from "zod";
import { requireSession } from "../auth/middleware.js";
import { createPersonalAccessToken, deleteToken, listTokensForUser } from "../auth/tokens.js";

export const tokensRouter = Router();
tokensRouter.use(requireSession);

tokensRouter.get("/", (req, res) => {
  res.json(listTokensForUser(req.user!.id));
});

const createSchema = z.object({ name: z.string().min(1).max(100) });

tokensRouter.post("/", (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  // The plaintext token is only ever returned here, right after creation.
  const { id, token } = createPersonalAccessToken(req.user!.id, parsed.data.name);
  res.status(201).json({ id, token });
});

tokensRouter.delete("/:tokenId", (req, res) => {
  deleteToken(req.user!.id, Number(req.params.tokenId));
  res.status(204).end();
});
