import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { config } from "../config.js";
import { requireSession, requireAdmin } from "../auth/middleware.js";
import { createUser, findUserByEmail, findUserById, listUsers, toPublicUser, updateUserPassword } from "../auth/users.js";
import { verifyPassword } from "../auth/password.js";

export const authRouter = Router();

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

  req.session!.userId = user.id;
  res.json(toPublicUser(user));
});

authRouter.post("/logout", (req, res) => {
  req.session = null;
  res.status(204).end();
});

authRouter.get("/me", requireSession, (req, res) => {
  res.json(req.user);
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
