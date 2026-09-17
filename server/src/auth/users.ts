import { db } from "../db/index.js";
import { hashPassword } from "./password.js";

export interface User {
  id: number;
  email: string;
  password_hash: string;
  display_name: string;
  role: "admin" | "user";
  created_at: string;
}

export type PublicUser = Omit<User, "password_hash">;

export function toPublicUser(user: User): PublicUser {
  const { password_hash, ...rest } = user;
  return rest;
}

export function findUserByEmail(email: string): User | undefined {
  return db.prepare<[string], User>("SELECT * FROM users WHERE email = ?").get(email.toLowerCase());
}

export function findUserById(id: number): User | undefined {
  return db.prepare<[number], User>("SELECT * FROM users WHERE id = ?").get(id);
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
    .prepare<[], User>("SELECT * FROM users ORDER BY created_at ASC")
    .all()
    .map(toPublicUser);
}
