import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

const SALT_ROUNDS = process.env.NODE_ENV === "test" ? 4 : 12;

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, SALT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): boolean {
  return bcrypt.compareSync(plain, hash);
}

// A hash nobody knows the password for. Checking it costs what checking a real one costs.
let unknownAccountHash: string | undefined;

/**
 * Like verifyPassword for a sign-in, where the account may not exist: an unknown address takes as long as a known
 * one, so the response time does not tell whether an account is registered.
 */
export function verifyPasswordOrDummy(plain: string, hash: string | undefined): boolean {
  unknownAccountHash ??= bcrypt.hashSync(randomBytes(16).toString("hex"), SALT_ROUNDS);
  const matches = bcrypt.compareSync(plain, hash ?? unknownAccountHash);
  return hash !== undefined && matches;
}
