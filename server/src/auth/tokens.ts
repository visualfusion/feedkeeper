import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { db } from "../db/index.js";

const TOKEN_PREFIX = "fk_";

export interface PersonalAccessToken {
  id: number;
  user_id: number;
  name: string;
  token_hash: string;
  token_prefix: string;
  created_at: string;
  last_used_at: string | null;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Returns the plaintext token once; only the hash is persisted.
export function createPersonalAccessToken(userId: number, name: string): { id: number; token: string } {
  const secret = randomBytes(32).toString("base64url");
  const token = `${TOKEN_PREFIX}${secret}`;
  const tokenHash = hashToken(token);
  const tokenPrefix = token.slice(0, 10);

  const result = db
    .prepare(
      `INSERT INTO personal_access_tokens (user_id, name, token_hash, token_prefix)
       VALUES (?, ?, ?, ?)`,
    )
    .run(userId, name, tokenHash, tokenPrefix);

  return { id: Number(result.lastInsertRowid), token };
}

export function resolveUserIdFromToken(token: string): number | null {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
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

  db.prepare("UPDATE personal_access_tokens SET last_used_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(
    row.id,
  );

  return row.user_id;
}

export function listTokensForUser(userId: number): Omit<PersonalAccessToken, "token_hash">[] {
  return db
    .prepare<[number], PersonalAccessToken>(
      "SELECT * FROM personal_access_tokens WHERE user_id = ? ORDER BY created_at DESC",
    )
    .all(userId)
    .map(({ token_hash, ...rest }) => rest);
}

export function deleteToken(userId: number, tokenId: number): void {
  db.prepare("DELETE FROM personal_access_tokens WHERE id = ? AND user_id = ?").run(tokenId, userId);
}
