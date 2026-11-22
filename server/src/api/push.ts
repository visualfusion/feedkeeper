import { Router } from "express";
import { z } from "zod";
import { requireSession } from "../auth/middleware.js";
import { assertPublicHttpUrl } from "../feeds/ssrfGuard.js";
import { hasDevice, removeDevice, saveDevice, sendToUser, vapidPublicKey } from "../push.js";

export const pushRouter = Router();
pushRouter.use(requireSession);

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(2000).refine((value) => value.startsWith("https://"), "https only"),
  keys: z.object({ p256dh: z.string().min(1).max(500), auth: z.string().min(1).max(500) }),
});

pushRouter.get("/key", (_req, res) => {
  res.json({ publicKey: vapidPublicKey() });
});

pushRouter.post("/devices", async (req, res) => {
  const parsed = subscriptionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  try {
    await assertPublicHttpUrl(parsed.data.endpoint);
  } catch {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  saveDevice(req.user!.id, parsed.data);
  res.status(204).end();
});

pushRouter.post("/devices/check", (req, res) => {
  const endpoint = typeof req.body?.endpoint === "string" ? req.body.endpoint : "";
  res.json({ registered: hasDevice(req.user!.id, endpoint) });
});

pushRouter.post("/devices/remove", (req, res) => {
  const endpoint = typeof req.body?.endpoint === "string" ? req.body.endpoint : "";
  removeDevice(req.user!.id, endpoint);
  res.status(204).end();
});

const TEST_TEXT: Record<string, string> = {
  en: "Notifications work.",
  de: "Benachrichtigungen funktionieren.",
  ja: "通知は正常に動作しています。",
  ru: "Уведомления работают.",
};

pushRouter.post("/test", async (req, res) => {
  // The test message follows the language of the app on the device that asked for it.
  const language = typeof req.body?.language === "string" ? req.body.language.slice(0, 2) : "en";
  const delivered = await sendToUser(req.user!.id, { title: "FeedKeeper", body: TEST_TEXT[language] ?? TEST_TEXT.en, url: "/items", tag: "test" });
  res.json({ delivered });
});
