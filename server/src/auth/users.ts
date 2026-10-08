import { db } from "../db/index.js";
import { hashPassword } from "./password.js";
import type { AvatarMimeType } from "./avatar.js";

export interface User {
  id: number;
  email: string;
  password_hash: string;
  display_name: string;
  role: "admin" | "user";
  created_at: string;
  avatar_updated_at: string | null;
  /** When the person closed the introduction to the app; null while it is still to be shown. */
  intro_dismissed_at: string | null;
}

// Joins only the avatar timestamp; the image itself is loaded on demand.
const SELECT_USER = `SELECT users.*, user_avatars.updated_at AS avatar_updated_at
  FROM users LEFT JOIN user_avatars ON user_avatars.user_id = users.id`;

export type PublicUser = Omit<User, "password_hash">;

export function toPublicUser(user: User): PublicUser {
  const { password_hash, ...rest } = user;
  return rest;
}

/** Marks the introduction as seen; it stays marked once it is (the first time counts). */
export function dismissIntro(userId: number): void {
  db.prepare("UPDATE users SET intro_dismissed_at = COALESCE(intro_dismissed_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) WHERE id = ?").run(userId);
}

export function findUserByEmail(email: string): User | undefined {
  return db.prepare<[string], User>(`${SELECT_USER} WHERE users.email = ?`).get(email.toLowerCase());
}

export function findUserById(id: number): User | undefined {
  return db.prepare<[number], User>(`${SELECT_USER} WHERE users.id = ?`).get(id);
}

export function createUser(input: {
  email: string;
  password: string;
  displayName: string;
  role: "admin" | "user";
}): User {
  const result = db
    .prepare(
      `INSERT INTO users (email, password_hash, display_name, role)
       VALUES (?, ?, ?, ?)`,
    )
    .run(input.email.toLowerCase(), hashPassword(input.password), input.displayName, input.role);

  return findUserById(Number(result.lastInsertRowid))!;
}

export function updateUserPassword(userId: number, newPassword: string): void {
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(newPassword), userId);
}

export function listUsers(): PublicUser[] {
  return db
    .prepare<[], User>(`${SELECT_USER} ORDER BY users.created_at ASC`)
    .all()
    .map(toPublicUser);
}

export function updateDisplayName(userId: number, displayName: string): void {
  db.prepare("UPDATE users SET display_name = ? WHERE id = ?").run(displayName, userId);
}

export function getUserAvatar(userId: number): { mime_type: AvatarMimeType; data: Buffer } | undefined {
  return db
    .prepare<[number], { mime_type: AvatarMimeType; data: Buffer }>("SELECT mime_type, data FROM user_avatars WHERE user_id = ?")
    .get(userId);
}

export function setUserAvatar(userId: number, mimeType: AvatarMimeType, data: Buffer): void {
  db.prepare(
    `INSERT INTO user_avatars (user_id, mime_type, data) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       mime_type = excluded.mime_type,
       data = excluded.data,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
  ).run(userId, mimeType, data);
}

export function deleteUserAvatar(userId: number): void {
  db.prepare("DELETE FROM user_avatars WHERE user_id = ?").run(userId);
}
