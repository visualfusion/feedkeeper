import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { Request } from "express";
import { TOTP, Secret } from "otpauth";
import { db } from "../db/index.js";
import { config } from "../config.js";

export const opaque = () => randomBytes(32).toString("base64url");
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const encryptionKey = () => createHash("sha256").update(`feedkeeper-totp:${config.sessionSecret}`).digest();
export function seal(text: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
}
function unseal(text: string): string {
  const data = Buffer.from(text, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8");
}
interface SecurityAccount { user_handle: string; version: number; totp_secret: string | null; totp_last_step: number }
export function securityAccount(userId: number): SecurityAccount {
  db.prepare("INSERT OR IGNORE INTO account_security (user_id, user_handle) VALUES (?, ?)").run(userId, opaque());
  return db.prepare<[number], SecurityAccount>("SELECT * FROM account_security WHERE user_id = ?").get(userId)!;
}
export function securityVersion(userId: number): number {
  return db.prepare<[number], { version: number }>("SELECT version FROM account_security WHERE user_id = ?").get(userId)?.version ?? 0;
}
export function sessionIsSecure(req: Request, userId: number): boolean {
  return (req.session?.securityVersion ?? 0) === securityVersion(userId);
}
export function hasTotp(userId: number): boolean { return Boolean(securityAccount(userId).totp_secret); }
export function securityBinding(req: Request, channel: string): string {
  if (channel === "native-login") return channel;
  if (req.headers.authorization) return hash(`${channel}:${req.headers.authorization}`);
  req.session ??= {};
  req.session.securityBinding ??= opaque();
  return hash(`${channel}:${req.session.securityBinding}`);
}
export interface Challenge { purpose: string; user_id: number | null; binding: string; version: number; payload: string; expires_at: number; attempts: number }
export function issueSecurityChallenge(purpose: string, userId: number | null, binding: string, payload: unknown, ttl = 5 * 60_000) {
  db.prepare("DELETE FROM security_challenges WHERE expires_at <= ?").run(Date.now());
  const id = opaque();
  db.prepare("INSERT INTO security_challenges (id_hash, purpose, user_id, binding, version, payload, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(hash(id), purpose, userId, binding, userId ? securityVersion(userId) : 0, JSON.stringify(payload), Date.now() + ttl);
  return id;
}
/** Count attempts before checking the factor, including requests that end in an error. */
export function readSecurityChallenge(id: unknown, purpose: string, binding: string, consume = false): Challenge | null {
  if (typeof id !== "string" || !/^[\w-]{43}$/.test(id)) return null;
  return db.transaction(() => {
    const row = db.prepare<[string], Challenge>("SELECT * FROM security_challenges WHERE id_hash = ?").get(hash(id));
    if (!row || row.purpose !== purpose || row.binding !== binding || row.expires_at <= Date.now() || row.attempts >= 5 || (row.user_id && row.version !== securityVersion(row.user_id))) return null;
    if (consume) db.prepare("DELETE FROM security_challenges WHERE id_hash = ?").run(hash(id));
    else db.prepare("UPDATE security_challenges SET attempts = attempts + 1 WHERE id_hash = ?").run(hash(id));
    return row;
  })();
}
export function discardSecurityChallenge(id: string): void { db.prepare("DELETE FROM security_challenges WHERE id_hash = ?").run(hash(id)); }
export function totpFor(secret?: string, label = "FeedKeeper") {
  return new TOTP({ issuer: "FeedKeeper", label, algorithm: "SHA1", digits: 6, period: 30, secret: secret ? Secret.fromBase32(secret) : new Secret({ size: 20 }) });
}
export function verifySecondFactor(userId: number, code: unknown): boolean {
  if (typeof code !== "string" || code.length > 80) return false;
  return db.transaction(() => {
    const account = securityAccount(userId);
    if (!account.totp_secret) return false;
    if (/^\d{6}$/.test(code)) {
      let delta: number | null;
      try { delta = totpFor(unseal(account.totp_secret)).validate({ token: code, window: 1 }); }
      catch { return false; }
      if (delta === null) return false;
      const step = Math.floor(Date.now() / 30_000) + delta;
      return db.prepare("UPDATE account_security SET totp_last_step = ? WHERE user_id = ? AND totp_last_step < ?").run(step, userId, step).changes === 1;
    }
    const normalized = code.toUpperCase().replace(/[ -]/g, "");
    if (!/^[A-F0-9]{24}$/.test(normalized)) return false;
    return db.prepare("DELETE FROM recovery_codes WHERE user_id = ? AND code_hash = ?").run(userId, hash(normalized)).changes === 1;
  })();
}
export function newRecoveryCodes(userId: number): string[] {
  db.prepare("DELETE FROM recovery_codes WHERE user_id = ?").run(userId);
  const codes = Array.from({ length: 10 }, () => randomBytes(12).toString("hex").toUpperCase());
  for (const code of codes) db.prepare("INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, ?)").run(userId, hash(code));
  return codes.map(code => code.match(/.{6}/g)!.join("-"));
}
/** Enabling MFA invalidates older password-only sessions, tokens, pairing codes and pending logins. */
export function revokeSecuritySessions(userId: number): void {
  db.prepare("UPDATE account_security SET version = version + 1 WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM personal_access_tokens WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM pairing_codes WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM security_challenges WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM oauth_grants WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM oauth_codes WHERE user_id = ?").run(userId);
}
export function beginMfa(req: Request, userId: number, channel: "web" | "native", context: unknown) {
  if (!hasTotp(userId)) return null;
  const challengeId = issueSecurityChallenge("mfa", userId, securityBinding(req, `${channel}-login`), context);
  if (channel === "web") { req.session!.pendingMfa = challengeId; }
  return { error: "mfa_required", challengeId, methods: ["totp", "recovery"], expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() };
}
