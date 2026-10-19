import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { db } from "../db/index.js";
import { resolveAccessToken } from "../oauth/store.js";

const TOKEN_PREFIX = "fk_";
const OAUTH_ACCESS_PREFIX = "fk_oat_";
export type TokenScope = "read" | "write";
/** `api` tokens are created by hand (MCP, scripts); `device` tokens come from pairing a native app; `oauth` tokens come from a connector's sign-in and only work on /mcp. */
export type TokenKind = "api" | "device" | "oauth";

export interface PersonalAccessToken {
  id: number;
  user_id: number;
  name: string;
  token_hash: string;
  token_prefix: string;
  scope: TokenScope;
  kind: TokenKind;
  platform: string | null;
  app_version: string | null;
  created_at: string;
  last_used_at: string | null;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Returns the plaintext token once; only the hash is persisted.
export function createPersonalAccessToken(
  userId: number,
  name: string,
  scope: TokenScope,
  device?: { platform: string; appVersion: string | null },
): { id: number; token: string } {
  const secret = randomBytes(32).toString("base64url");
  const token = `${TOKEN_PREFIX}${device ? "dev_" : ""}${secret}`;
  const tokenHash = hashToken(token);
  const tokenPrefix = token.slice(0, 10);

  const result = db
    .prepare(
      `INSERT INTO personal_access_tokens (user_id, name, token_hash, token_prefix, scope, kind, platform, app_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(userId, name, tokenHash, tokenPrefix, scope, device ? "device" : "api", device?.platform ?? null, device?.appVersion ?? null);

  return { id: Number(result.lastInsertRowid), token };
}

export interface ResolvedToken {
  userId: number;
  scope: TokenScope;
  kind: TokenKind;
  tokenId: number;
}

export function resolveToken(token: string): ResolvedToken | null {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  if (token.startsWith(OAUTH_ACCESS_PREFIX)) {
    const grant = resolveAccessToken(token);
    return grant ? { userId: grant.userId, scope: grant.scope, kind: "oauth", tokenId: grant.grantId } : null;
  }
  const tokenHash = hashToken(token);

  const row = db
    .prepare<[string], PersonalAccessToken>(
      "SELECT * FROM personal_access_tokens WHERE token_hash = ?",
    )
    .get(tokenHash);

  if (!row) return null;

  // Defense in depth: even though the lookup is by exact hash match, compare
  // in constant time to avoid timing side channels on the hash comparison.
  const stored = Buffer.from(row.token_hash, "hex");
  const provided = Buffer.from(tokenHash, "hex");
  if (stored.length !== provided.length || !timingSafeEqual(stored, provided)) {
    return null;
  }

  const now = Date.now();
  const lastTouch = tokenLastTouch.get(row.id) ?? 0;
  if (!row.last_used_at || now - lastTouch >= TOKEN_TOUCH_INTERVAL_MS) {
    tokenLastTouch.set(row.id, now);
    db.prepare("UPDATE personal_access_tokens SET last_used_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(
      row.id,
    );
  }

  return { userId: row.user_id, scope: row.scope, kind: row.kind, tokenId: row.id };
}

const tokenLastTouch = new Map<number, number>();
const TOKEN_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

/** Hand-made tokens only; paired devices are listed separately. */
export function listTokensForUser(userId: number): Omit<PersonalAccessToken, "token_hash">[] {
  return db
    .prepare<[number], PersonalAccessToken>(
      "SELECT * FROM personal_access_tokens WHERE user_id = ? AND kind = 'api' ORDER BY created_at DESC",
    )
    .all(userId)
    .map(({ token_hash, ...rest }) => rest);
}

export function deleteToken(userId: number, tokenId: number): void {
  tokenLastTouch.delete(tokenId);
  db.prepare("DELETE FROM personal_access_tokens WHERE id = ? AND user_id = ? AND kind = 'api'").run(tokenId, userId);
}

export function listDevicesForUser(userId: number): Omit<PersonalAccessToken, "token_hash">[] {
  return db
    .prepare<[number], PersonalAccessToken>("SELECT * FROM personal_access_tokens WHERE user_id = ? AND kind = 'device' ORDER BY created_at DESC")
    .all(userId)
    .map(({ token_hash, ...rest }) => rest);
}

/** Revokes a device; its token stops working immediately. Returns whether one was removed. */
export function deleteDevice(userId: number, deviceId: number): boolean {
  tokenLastTouch.delete(deviceId);
  return db.prepare("DELETE FROM personal_access_tokens WHERE id = ? AND user_id = ? AND kind = 'device'").run(deviceId, userId).changes > 0;
}
