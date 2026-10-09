import { Router, type Request, type Response, type RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";
import { db } from "../db/index.js";
import { config } from "../config.js";
import { findUserById } from "./users.js";
import { verifyPassword } from "./password.js";
import { requireSessionOrDevice } from "./middleware.js";
import { discardSecurityChallenge, hasTotp, issueSecurityChallenge, newRecoveryCodes, readSecurityChallenge, revokeSecuritySessions, seal, securityAccount, securityBinding, securityVersion, totpFor, verifySecondFactor } from "./security.js";

export interface SecurityRouteOptions {
  publicUrl?: string;
  channel?: "web" | "native";
  authenticate?: RequestHandler;
  emailReauthEnabled?: (userId: number) => boolean;
  canRemoveLastPasskey?: (userId: number) => boolean;
  /** Return null for malformed login context (for example missing device information). */
  loginContext?: (req: Request) => Record<string, unknown> | null;
  completeLogin: (req: Request, res: Response, userId: number, context: Record<string, unknown>) => void;
}
interface PasskeyRow { id: string; user_id: number; public_key: Buffer; counter: number; transports: string; name: string; created_at: string; last_used_at: string | null }
export function createSecurityRouter(options: SecurityRouteOptions): Router {
  const router = Router();
  const origin = new URL(options.publicUrl ?? config.publicUrl).origin;
  const rpID = new URL(origin).hostname;
  const passkeysEnabled = origin.startsWith("https:") || rpID === "localhost" || rpID === "127.0.0.1";
  const channel = options.channel ?? "web";
  const binding = (req: Request) => securityBinding(req, `${channel}-login`);
  const managementBinding = (req: Request) => securityBinding(req, `${channel}-management`);
  const invalid = (res: Response) => { res.status(400).json({ error: "invalid_or_expired_code" }); };
  const limiter = rateLimit({ windowMs: 15 * 60_000, limit: 40, standardHeaders: true, legacyHeaders: false, message: { error: "too_many_requests" } });
  router.use((_req, res, next) => { res.setHeader("Cache-Control", "private, no-store"); next(); });
  router.use((req, res, next) => {
    if (req.method !== "GET" && (req.headers["sec-fetch-site"] === "cross-site" || (req.headers.origin && req.headers.origin !== origin))) {
      res.status(403).json({ error: "invalid_origin" }); return;
    }
    next();
  });
  router.use(limiter);
  const management: RequestHandler[] = [options.authenticate ?? requireSessionOrDevice, (req, res, next) => {
    if (req.tokenScope === "read" || (req.tokenKind && req.tokenKind !== "device")) { res.status(403).json({ error: "forbidden" }); return; }
    next();
  }];
  const proof = (req: Request): boolean => {
    const row = readSecurityChallenge(req.body?.reauthToken, "reauth", managementBinding(req), true);
    return row?.user_id === req.user!.id;
  };
  const issueProof = (req: Request, res: Response) => res.json({ reauthToken: issueSecurityChallenge("reauth", req.user!.id, managementBinding(req), {}) });
  const list = (userId: number) => db.prepare<[number], Omit<PasskeyRow, "public_key" | "counter" | "transports" | "user_id">>("SELECT id, name, created_at, last_used_at FROM passkeys WHERE user_id = ? ORDER BY created_at").all(userId);
  router.get("/config", (_req, res) => res.json({ passkeys: passkeysEnabled, totp: true }));
  router.get("/pending", (req, res) => res.json({ challengeId: req.session?.pendingMfa ?? null }));
  router.post("/mfa", (req, res) => {
    const row = readSecurityChallenge(req.body?.challengeId, "mfa", binding(req));
    if (!row?.user_id || !verifySecondFactor(row.user_id, req.body?.code)) { invalid(res); return; }
    discardSecurityChallenge(req.body.challengeId);
    options.completeLogin(req, res, row.user_id, JSON.parse(row.payload));
  });
  router.post("/passkeys/options", async (req, res) => {
    if (!passkeysEnabled) { res.status(503).json({ error: "https_required" }); return; }
    const context = options.loginContext?.(req) ?? (channel === "web" ? { remember: req.body?.remember === true } : null);
    if (context === null) { res.status(400).json({ error: "invalid_input" }); return; }
    const publicKey = await generateAuthenticationOptions({ rpID, userVerification: "required" });
    const challengeId = issueSecurityChallenge("passkey-login", null, binding(req), { challenge: publicKey.challenge, context });
    res.json({ challengeId, publicKey });
  });
  async function assertion(req: Request, purpose: string, keyBinding: string) {
    const row = readSecurityChallenge(req.body?.challengeId, purpose, keyBinding, true);
    if (!row) return null;
    const credential = req.body?.credential;
    if (typeof credential?.id !== "string") return null;
    const saved = db.prepare<[string], PasskeyRow>("SELECT * FROM passkeys WHERE id = ?").get(credential.id);
    if (!saved || (row.user_id && saved.user_id !== row.user_id)) return null;
    const handle = credential.response?.userHandle;
    // Discoverable login must identify the account. A scoped reauthentication may omit the handle.
    if ((!row.user_id && !handle) || (handle != null && handle !== securityAccount(saved.user_id).user_handle)) return null;
    const version = securityVersion(saved.user_id);
    try {
      const result = await verifyAuthenticationResponse({ response: credential, expectedChallenge: JSON.parse(row.payload).challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
        credential: { id: saved.id, publicKey: new Uint8Array(saved.public_key), counter: saved.counter, transports: JSON.parse(saved.transports) } });
      if (!result.verified || version !== securityVersion(saved.user_id)) return null;
      // Avoid accepting two assertions against the same older counter after asynchronous verification.
      const updated = db.prepare("UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ? AND counter = ?").run(result.authenticationInfo.newCounter, new Date().toISOString(), saved.id, saved.counter);
      if (!updated.changes) return null;
      return { userId: saved.user_id, payload: JSON.parse(row.payload) };
    } catch { return null; }
  }
  router.post("/passkeys/verify", async (req, res) => {
    const result = await assertion(req, "passkey-login", binding(req));
    if (!result) { invalid(res); return; }
    options.completeLogin(req, res, result.userId, result.payload.context);
  });
  router.get("/", ...management, (req, res) => res.json({ totpEnabled: hasTotp(req.user!.id), passkeysEnabled, emailReauthEnabled: options.emailReauthEnabled?.(req.user!.id) === true, passkeys: list(req.user!.id), recoveryCodesRemaining: (db.prepare("SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = ?").get(req.user!.id) as { n: number }).n }));
  router.post("/reauth", ...management, (req, res) => {
    const user = findUserById(req.user!.id)!;
    if (typeof req.body?.password !== "string" || req.body.password.length > 1024 || !verifyPassword(req.body.password, user.password_hash) || (hasTotp(user.id) && !verifySecondFactor(user.id, req.body.code))) {
      res.status(401).json({ error: "invalid_credentials" }); return;
    }
    issueProof(req, res);
  });
  router.post("/reauth/passkey/options", ...management, async (req, res) => {
    if (!passkeysEnabled) { res.status(503).json({ error: "https_required" }); return; }
    const publicKey = await generateAuthenticationOptions({ rpID, userVerification: "required", allowCredentials: list(req.user!.id).map(key => ({ id: key.id })) });
    res.json({ challengeId: issueSecurityChallenge("passkey-reauth", req.user!.id, managementBinding(req), { challenge: publicKey.challenge }), publicKey });
  });
  router.post("/reauth/passkey/verify", ...management, async (req, res) => {
    const result = await assertion(req, "passkey-reauth", managementBinding(req));
    if (!result || result.userId !== req.user!.id) { invalid(res); return; }
    issueProof(req, res);
  });
  router.post("/passkeys/register/options", ...management, async (req, res) => {
    if (!passkeysEnabled) { res.status(503).json({ error: "https_required" }); return; }
    if (!proof(req)) { res.status(401).json({ error: "reauth_required" }); return; }
    const user = findUserById(req.user!.id)!;
    if (list(user.id).length >= 20) { res.status(400).json({ error: "passkey_limit" }); return; }
    const publicKey = await generateRegistrationOptions({ rpID, rpName: "FeedKeeper", userName: user.email, userDisplayName: user.display_name, userID: Buffer.from(securityAccount(user.id).user_handle, "base64url"), attestationType: "none", excludeCredentials: list(user.id).map(key => ({ id: key.id })), authenticatorSelection: { residentKey: "required", userVerification: "required" } });
    res.json({ challengeId: issueSecurityChallenge("passkey-register", user.id, managementBinding(req), { challenge: publicKey.challenge }), publicKey });
  });
  router.post("/passkeys/register/verify", ...management, async (req, res) => {
    const row = readSecurityChallenge(req.body?.challengeId, "passkey-register", managementBinding(req), true);
    if (row?.user_id !== req.user!.id || typeof req.body?.name !== "string" || !req.body.name.trim() || req.body.name.length > 100) { invalid(res); return; }
    try {
      const result = await verifyRegistrationResponse({ response: req.body.credential, expectedChallenge: JSON.parse(row.payload).challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true });
      if (!result.verified || !result.registrationInfo || row.version !== securityVersion(req.user!.id)) { invalid(res); return; }
      if (list(req.user!.id).length >= 20) { res.status(400).json({ error: "passkey_limit" }); return; }
      const key = result.registrationInfo.credential;
      const transports = key.transports ?? [];
      db.prepare("INSERT INTO passkeys (id, user_id, public_key, counter, transports, name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(key.id, req.user!.id, Buffer.from(key.publicKey), key.counter, JSON.stringify(transports), req.body.name.trim(), new Date().toISOString());
      res.status(201).json({ passkeys: list(req.user!.id) });
    } catch { invalid(res); }
  });
  router.delete("/passkeys/:id", ...management, (req, res) => {
    if (!proof(req)) { res.status(401).json({ error: "reauth_required" }); return; }
    // A host may have passwordless accounts: never remove the final usable passkey through this endpoint.
    if (list(req.user!.id).length <= 1 && !(options.canRemoveLastPasskey?.(req.user!.id) ?? true)) { res.status(409).json({ error: "last_passkey" }); return; }
    db.prepare("DELETE FROM passkeys WHERE id = ? AND user_id = ?").run(String(req.params.id), req.user!.id);
    res.status(204).end();
  });
  router.post("/totp/setup", ...management, (req, res) => {
    if (!proof(req)) { res.status(401).json({ error: "reauth_required" }); return; }
    if (hasTotp(req.user!.id)) { res.status(409).json({ error: "totp_already_enabled" }); return; }
    const totp = totpFor(undefined, req.user!.email);
    res.json({ challengeId: issueSecurityChallenge("totp-setup", req.user!.id, managementBinding(req), { secret: seal(totp.secret.base32) }), secret: totp.secret.base32, uri: totp.toString() });
  });
  router.post("/totp/confirm", ...management, (req, res) => {
    const row = readSecurityChallenge(req.body?.challengeId, "totp-setup", managementBinding(req));
    if (row?.user_id !== req.user!.id || typeof req.body?.code !== "string" || !/^\d{6}$/.test(req.body.code) || hasTotp(req.user!.id)) { invalid(res); return; }
    const result = db.transaction(() => {
      db.prepare("UPDATE account_security SET totp_secret = ?, totp_last_step = -1 WHERE user_id = ?").run(JSON.parse(row.payload).secret, row.user_id);
      if (!verifySecondFactor(row.user_id!, req.body.code)) { db.prepare("UPDATE account_security SET totp_secret = NULL WHERE user_id = ?").run(row.user_id); return null; }
      const recoveryCodes = newRecoveryCodes(row.user_id!);
      revokeSecuritySessions(row.user_id!);
      // Keep this authenticated browser open so the recovery codes can be saved; other sessions are revoked.
      if (!req.headers.authorization) req.session!.securityVersion = securityVersion(row.user_id!);
      return recoveryCodes;
    })();
    if (!result) { invalid(res); return; }
    res.json({ recoveryCodes: result });
  });
  router.post("/totp/disable", ...management, (req, res) => {
    if (!proof(req)) { res.status(401).json({ error: "reauth_required" }); return; }
    db.transaction(() => {
      db.prepare("UPDATE account_security SET totp_secret = NULL, totp_last_step = -1 WHERE user_id = ?").run(req.user!.id);
      db.prepare("DELETE FROM recovery_codes WHERE user_id = ?").run(req.user!.id);
      revokeSecuritySessions(req.user!.id);
      if (!req.headers.authorization) req.session!.securityVersion = securityVersion(req.user!.id);
    })();
    res.status(204).end();
  });
  router.post("/recovery-codes", ...management, (req, res) => {
    if (!proof(req)) { res.status(401).json({ error: "reauth_required" }); return; }
    if (!hasTotp(req.user!.id)) { res.status(400).json({ error: "totp_required" }); return; }
    res.json({ recoveryCodes: db.transaction(() => newRecoveryCodes(req.user!.id))() });
  });
  return router;
}
