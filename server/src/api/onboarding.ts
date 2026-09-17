import { Router } from "express";
import { z } from "zod";
import { hasAnyUser } from "../db/index.js";
import { createUser } from "../auth/users.js";

export const onboardingRouter = Router();

onboardingRouter.get("/status", (_req, res) => {
  res.json({ needsOnboarding: !hasAnyUser() });
});

const onboardingSchema = z.object({
  email: z.string().email(),
  password: z.string().min(10),
  displayName: z.string().min(1).max(100),
});

// Creates the first admin user. Only works while the instance has zero users;
// once an admin exists, all further accounts must be created by an admin.
onboardingRouter.post("/", (req, res) => {
  if (hasAnyUser()) {
    res.status(409).json({ error: "already_onboarded" });
    return;
  }

  const parsed = onboardingSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
    return;
  }

  const user = createUser({ ...parsed.data, role: "admin" });
  req.session!.userId = user.id;
  res.status(201).json({ id: user.id, email: user.email, displayName: user.display_name, role: user.role });
});
