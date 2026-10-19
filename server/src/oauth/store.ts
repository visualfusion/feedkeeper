import { createHash, randomBytes } from "node:crypto";
import { db } from "../db/index.js";
import type { TokenScope } from "../auth/tokens.js";

export const ACCESS_TTL_MS = 60 * 60 * 1000;
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const CODE_TTL_MS = 60 * 1000;
/** Clients nobody ever authorized are dropped after this long. */
const UNUSED_CLIENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_CLIENTS = 5000;

export interface OAuthClient {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  created_at: string;
}

interface ClientRow extends Omit<OAuthClient, "redirect_uris"> {
  redirect_uris: string;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function newSecret(prefix: string): string {
  return `${prefix}${randomBytes(32).toString("base64url")}`;
}

const now = () => new Date().toISOString();
const inMs = (ms: number) => new Date(Date.now() + ms).toISOString();

export function registerClient(name: string, redirectUris: string[]): OAuthClient | null {
  return db.transaction(() => {
    db.prepare(
      `DELETE FROM oauth_clients WHERE created_at < ? AND NOT EXISTS (SELECT 1 FROM oauth_grants WHERE oauth_grants.client_id = oauth_clients.client_id)`,
    ).run(new Date(Date.now() - UNUSED_CLIENT_TTL_MS).toISOString());
    const count = (db.prepare("SELECT COUNT(*) AS n FROM oauth_clients").get() as { n: number }).n;
    if (count >= MAX_CLIENTS) return null;
    const clientId = `fkc_${randomBytes(16).toString("base64url")}`;
    db.prepare("INSERT INTO oauth_clients (client_id, client_name, redirect_uris) VALUES (?, ?, ?)").run(clientId, name, JSON.stringify(redirectUris));
    return findClient(clientId)!;
  })();
}

export function findClient(clientId: string): OAuthClient | null {
  const row = db.prepare<[string], ClientRow>("SELECT * FROM oauth_clients WHERE client_id = ?").get(clientId);
  return row ? { ...row, redirect_uris: JSON.parse(row.redirect_uris) as string[] } : null;
}

export function createAuthorizationCode(input: {
  clientId: string;
  userId: number;
  redirectUri: string;
  codeChallenge: string;
  scope: TokenScope;
}): string {
  const code = newSecret("fkcode_");
  db.prepare("DELETE FROM oauth_codes WHERE expires_at <= ?").run(now());
  db.prepare(
    `INSERT INTO oauth_codes (code_hash, client_id, user_id, redirect_uri, code_challenge, scope, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(hash(code), input.clientId, input.userId, input.redirectUri, input.codeChallenge, input.scope, inMs(CODE_TTL_MS));
  return code;
}

export interface RedeemedCode {
  client_id: string;
  user_id: number;
  redirect_uri: string;
  code_challenge: string;
  scope: TokenScope;
}

/** A code works once: it is deleted whether or not the caller's checks pass afterwards. */
export function consumeAuthorizationCode(code: string): RedeemedCode | null {
  return db.transaction(() => {
    const row = db
      .prepare<[string], RedeemedCode & { expires_at: string }>("SELECT * FROM oauth_codes WHERE code_hash = ?")
      .get(hash(code));
    if (!row) return null;
    db.prepare("DELETE FROM oauth_codes WHERE code_hash = ?").run(hash(code));
    return row.expires_at > now() ? row : null;
  })();
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export function issueGrant(userId: number, clientId: string, scope: TokenScope): IssuedTokens {
  const accessToken = newSecret("fk_oat_");
  const refreshToken = newSecret("fk_ort_");
  db.prepare(
    `INSERT INTO oauth_grants (user_id, client_id, scope, access_hash, access_expires_at, refresh_hash, refresh_expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(userId, clientId, scope, hash(accessToken), inMs(ACCESS_TTL_MS), hash(refreshToken), inMs(REFRESH_TTL_MS));
  return { accessToken, refreshToken, expiresIn: ACCESS_TTL_MS / 1000 };
}

interface GrantRow {
  id: number;
  user_id: number;
  client_id: string;
  scope: TokenScope;
  access_expires_at: string;
  refresh_hash: string;
  previous_refresh_hash: string | null;
  refresh_expires_at: string;
  last_used_at?: string | null;
}

export type RefreshResult =
  | { ok: true; tokens: IssuedTokens; scope: TokenScope }
  | { ok: false };

/** Swaps in a new token pair. A refresh token that was already replaced revokes the whole grant. */
export function rotateGrant(refreshToken: string, clientId: string): RefreshResult {
  return db.transaction((): RefreshResult => {
    const refreshHash = hash(refreshToken);
    const reused = db.prepare<[string], GrantRow>("SELECT * FROM oauth_grants WHERE previous_refresh_hash = ?").get(refreshHash);
    if (reused) {
      db.prepare("DELETE FROM oauth_grants WHERE id = ?").run(reused.id);
      return { ok: false };
    }
    const grant = db.prepare<[string], GrantRow>("SELECT * FROM oauth_grants WHERE refresh_hash = ?").get(refreshHash);
    if (!grant || grant.client_id !== clientId || grant.refresh_expires_at <= now()) return { ok: false };
    const accessToken = newSecret("fk_oat_");
    const newRefresh = newSecret("fk_ort_");
    db.prepare(
      `UPDATE oauth_grants SET access_hash = ?, access_expires_at = ?, refresh_hash = ?, previous_refresh_hash = ?, refresh_expires_at = ? WHERE id = ?`,
    ).run(hash(accessToken), inMs(ACCESS_TTL_MS), hash(newRefresh), refreshHash, inMs(REFRESH_TTL_MS), grant.id);
    return { ok: true, scope: grant.scope, tokens: { accessToken, refreshToken: newRefresh, expiresIn: ACCESS_TTL_MS / 1000 } };
  })();
}

export interface ResolvedGrant {
  userId: number;
  scope: TokenScope;
  grantId: number;
}

const grantLastTouch = new Map<number, number>();
const GRANT_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export function resolveAccessToken(token: string): ResolvedGrant | null {
  const row = db
    .prepare<[string], GrantRow>("SELECT * FROM oauth_grants WHERE access_hash = ?")
    .get(hash(token));
  if (!row || row.access_expires_at <= now()) return null;
  const nowMs = Date.now();
  const lastTouch = grantLastTouch.get(row.id) ?? 0;
  if (!row.last_used_at || nowMs - lastTouch >= GRANT_TOUCH_INTERVAL_MS) {
    grantLastTouch.set(row.id, nowMs);
    db.prepare("UPDATE oauth_grants SET last_used_at = ? WHERE id = ?").run(now(), row.id);
  }
  return { userId: row.user_id, scope: row.scope, grantId: row.id };
}

/** Revokes by either token. Returns whether a grant was removed. */
export function revokeByToken(token: string, clientId: string | null): boolean {
  const tokenHash = hash(token);
  const grant = db
    .prepare<[string, string], { id: number; client_id: string }>("SELECT id, client_id FROM oauth_grants WHERE access_hash = ? OR refresh_hash = ?")
    .get(tokenHash, tokenHash);
  if (!grant || (clientId && grant.client_id !== clientId)) return false;
  grantLastTouch.delete(grant.id);
  return db.prepare("DELETE FROM oauth_grants WHERE id = ?").run(grant.id).changes > 0;
}

export interface GrantSummary {
  id: number;
  client_name: string;
  scope: TokenScope;
  created_at: string;
  last_used_at: string | null;
}

export function listGrantsForUser(userId: number): GrantSummary[] {
  return db
    .prepare<[number], GrantSummary>(
      `SELECT g.id, c.client_name, g.scope, g.created_at, g.last_used_at
       FROM oauth_grants g JOIN oauth_clients c ON c.client_id = g.client_id
       WHERE g.user_id = ? ORDER BY g.created_at DESC`,
    )
    .all(userId);
}

export function deleteGrant(userId: number, grantId: number): boolean {
  return db.prepare("DELETE FROM oauth_grants WHERE id = ? AND user_id = ?").run(grantId, userId).changes > 0;
}
