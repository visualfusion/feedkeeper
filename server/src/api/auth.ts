import express, { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { config } from "../config.js";
import { requireSession, requireAdmin } from "../auth/middleware.js";
import {
  createUser,
  deleteUserAvatar,
  findUserByEmail,
  findUserById,
  getUserAvatar,
  listUsers,
  setUserAvatar,
  toPublicUser,
  updateDisplayName,
  dismissIntro,
  updateUserPassword,
} from "../auth/users.js";
import { AVATAR_MAX_BYTES, detectAvatarType } from "../auth/avatar.js";
import { verifyPassword } from "../auth/password.js";
import { getUserCapabilities } from "../auth/capabilities.js";

import { beginMfa, securityVersion } from "../auth/security.js";
import { createSecurityRouter } from "../auth/securityRoutes.js";

export const authRouter = Router();
authRouter.use("/security", createSecurityRouter({ completeLogin: (req, res, userId) => {
  req.session = { userId, securityVersion: securityVersion(userId) };
  res.json(toPublicUser(findUserById(userId)!));
} }));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post("/login", loginLimiter, (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }

  const user = findUserByEmail(parsed.data.email);
  if (!user || !verifyPassword(parsed.data.password, user.password_hash)) {
    res.status(401).json({ error: "invalid_credentials" });
    return;
  }

  const mfa = beginMfa(req, user.id, "web", {});
  if (mfa) { res.status(403).json(mfa); return; }
  req.session = { userId: user.id, securityVersion: securityVersion(user.id) };
  res.json(toPublicUser(user));
});

authRouter.post("/logout", (req, res) => {
  req.session = null;
  res.status(204).end();
});

authRouter.get("/me", requireSession, (req, res) => {
  res.json({
    ...req.user,
    capabilities: getUserCapabilities(req.user!.id),
  });
});

const profileSchema = z.object({
  displayName: z.string().trim().min(1).max(100),
});

authRouter.patch("/me", requireSession, (req, res) => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
    return;
  }
  updateDisplayName(req.user!.id, parsed.data.displayName);
  res.json(toPublicUser(findUserById(req.user!.id)!));
});

// The introduction to the app is shown once per account; closing it on one device closes it everywhere.
authRouter.post("/me/intro", requireSession, (req, res) => {
  dismissIntro(req.user!.id);
  res.json(toPublicUser(findUserById(req.user!.id)!));
});

authRouter.get("/me/avatar", requireSession, (req, res) => {
  const avatar = getUserAvatar(req.user!.id);
  if (!avatar) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  // The client adds the update timestamp to the URL, so a changed photo gets a new cache key.
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  res.type(avatar.mime_type).send(avatar.data);
});

authRouter.put(
  "/me/avatar",
  requireSession,
  express.raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: AVATAR_MAX_BYTES }),
  (req, res) => {
    const data = Buffer.isBuffer(req.body) ? req.body : null;
    const mimeType = data ? detectAvatarType(data) : null;
    if (!data || !mimeType) {
      res.status(400).json({ error: "invalid_image" });
      return;
    }
    setUserAvatar(req.user!.id, mimeType, data);
    res.json(toPublicUser(findUserById(req.user!.id)!));
  },
);

authRouter.delete("/me/avatar", requireSession, (req, res) => {
  deleteUserAvatar(req.user!.id);
  res.json(toPublicUser(findUserById(req.user!.id)!));
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(10),
});

authRouter.post("/change-password", requireSession, loginLimiter, (req, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
    return;
  }

  const user = findUserById(req.user!.id)!;
  if (!verifyPassword(parsed.data.currentPassword, user.password_hash)) {
    res.status(401).json({ error: "invalid_credentials" });
    return;
  }

  updateUserPassword(user.id, parsed.data.newPassword);
  res.status(204).end();
});

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(10),
  displayName: z.string().min(1).max(100),
  role: z.enum(["admin", "user"]).default("user"),
});

// Admin-only user management. Signup stays closed by default (config.allowSignup);
// this is how additional accounts get created on a locked-down instance.
authRouter.get("/users", requireSession, requireAdmin, (_req, res) => {
  res.json(listUsers());
});

authRouter.post("/users", requireSession, requireAdmin, (req, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
    return;
  }
  if (findUserByEmail(parsed.data.email)) {
    res.status(409).json({ error: "email_taken" });
    return;
  }
  const user = createUser(parsed.data);
  res.status(201).json(toPublicUser(user));
});

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(10),
  displayName: z.string().min(1).max(100),
});

authRouter.post("/signup", (req, res) => {
  if (!config.allowSignup) {
    res.status(403).json({ error: "signup_disabled" });
    return;
  }
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
    return;
  }
  if (findUserByEmail(parsed.data.email)) {
    res.status(409).json({ error: "email_taken" });
    return;
  }
  const user = createUser({ ...parsed.data, role: "user" });
  req.session!.userId = user.id;
  res.status(201).json(toPublicUser(user));
});
