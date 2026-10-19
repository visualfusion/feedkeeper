import assert from "node:assert/strict";
import { test } from "node:test";
import { detectAvatarType } from "../src/auth/avatar.js";

test("avatar uploads are identified by their file signature", () => {
  assert.equal(detectAvatarType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(detectAvatarType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
  assert.equal(detectAvatarType(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ")), "image/webp");
  assert.equal(detectAvatarType(new TextEncoder().encode("<svg onload=alert(1)>")), null);
  assert.equal(detectAvatarType(new Uint8Array()), null);
});

test("profile name and photo updates are scoped to the user", async () => {
  process.env.DATABASE_PATH = ":memory:";
  process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";

  const { db, runMigrations } = await import("../src/db/index.js");
  const users = await import("../src/auth/users.js");
  runMigrations();

  const owner = users.createUser({ email: "owner@example.test", password: "correct horse battery", displayName: "Owner", role: "admin" });
  const other = users.createUser({ email: "other@example.test", password: "correct horse battery", displayName: "Other", role: "user" });
  assert.equal(owner.avatar_updated_at, null);

  users.updateDisplayName(owner.id, "Renamed Owner");
  assert.equal(users.findUserById(owner.id)?.display_name, "Renamed Owner");
  assert.equal(users.findUserById(other.id)?.display_name, "Other");

  const photo = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  users.setUserAvatar(owner.id, "image/jpeg", photo);
  assert.deepEqual(users.getUserAvatar(owner.id), { mime_type: "image/jpeg", data: photo });
  assert.equal(users.getUserAvatar(other.id), undefined);
  assert.ok(users.findUserByEmail("owner@example.test")?.avatar_updated_at);
  assert.equal("data" in users.toPublicUser(users.findUserById(owner.id)!), false);

  const replacement = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  users.setUserAvatar(owner.id, "image/png", replacement);
  assert.equal(users.getUserAvatar(owner.id)?.mime_type, "image/png");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM user_avatars").get()?.count, 1);

  users.deleteUserAvatar(owner.id);
  assert.equal(users.findUserById(owner.id)?.avatar_updated_at, null);

  users.setUserAvatar(other.id, "image/jpeg", photo);
  db.prepare("DELETE FROM users WHERE id = ?").run(other.id);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM user_avatars").get()?.count, 0);
});

test("the introduction is marked once per account and stays marked", async () => {
  process.env.DATABASE_PATH = ":memory:";
  process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";

  const { runMigrations } = await import("../src/db/index.js");
  const users = await import("../src/auth/users.js");
  runMigrations();

  const first = users.createUser({ email: "intro-a@example.test", password: "correct horse battery", displayName: "A", role: "user" });
  const second = users.createUser({ email: "intro-b@example.test", password: "correct horse battery", displayName: "B", role: "user" });
  assert.equal(users.findUserById(first.id)?.intro_dismissed_at, null, "an account has not seen it yet, existing ones included");

  users.dismissIntro(first.id);
  const marked = users.findUserById(first.id)?.intro_dismissed_at;
  assert.ok(marked);
  assert.equal(users.findUserById(second.id)?.intro_dismissed_at, null, "only the account that closed it");
  users.dismissIntro(first.id);
  assert.equal(users.findUserById(first.id)?.intro_dismissed_at, marked, "the first time counts");
  assert.equal(users.toPublicUser(users.findUserById(first.id)!).intro_dismissed_at, marked);
});
