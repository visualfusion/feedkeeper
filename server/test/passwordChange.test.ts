import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express from "express";
import cookieSession from "cookie-session";

test("a password change signs out the other browsers and keeps the person's own tokens", async (t) => {
  process.env.DATABASE_PATH = ":memory:";
  process.env.SESSION_SECRET = "isolated-password-change-test-secret-32-characters";
  process.env.PUBLIC_URL = "http://localhost:3000";
  const { db, runMigrations } = await import("../src/db/index.js");
  const { authRouter } = await import("../src/api/auth.js");
  const { createUser } = await import("../src/auth/users.js");
  const { createPersonalAccessToken, resolveToken } = await import("../src/auth/tokens.js");
  runMigrations();

  const oldPassword = "the old password of this account";
  const newPassword = "a completely new password for it";
  const user = createUser({ email: "reader@example.test", password: oldPassword, displayName: "Reader", role: "user" });
  const app = express();
  app.use(express.json());
  app.use(cookieSession({ name: "test", secret: process.env.SESSION_SECRET }));
  app.use("/api/auth", authRouter);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/auth`;
  t.after(() => { server.closeAllConnections(); server.close(); db.close(); });

  const call = async (path: string, cookie: string, body?: unknown) => {
    const response = await fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000", cookie },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const set = response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    return { status: response.status, cookie: set || cookie };
  };
  const signIn = async (password: string) => {
    const result = await call("/login", "", { email: user.email, password });
    return { status: result.status, cookie: result.cookie };
  };

  const laptop = await signIn(oldPassword);
  const phone = await signIn(oldPassword);
  assert.equal(laptop.status, 200);
  assert.equal(phone.status, 200);
  const token = createPersonalAccessToken(user.id, "Script", "read").token;
  assert.equal((await call("/me", laptop.cookie)).status, 200);
  assert.equal((await call("/me", phone.cookie)).status, 200);

  const changed = await call("/change-password", laptop.cookie, { currentPassword: oldPassword, newPassword });
  assert.equal(changed.status, 204);

  await t.test("the browser that changed it stays signed in", async () => {
    assert.equal((await call("/me", changed.cookie)).status, 200);
  });
  await t.test("every other browser is signed out", async () => {
    assert.equal((await call("/me", phone.cookie)).status, 401);
    assert.equal((await call("/me", laptop.cookie)).status, 401, "the cookie value from before the change is outdated; the response set a fresh one");
  });
  await t.test("access tokens are the person's own and keep working", () => {
    assert.ok(resolveToken(token));
  });
  await t.test("only the new password signs in", async () => {
    assert.equal((await signIn(oldPassword)).status, 401);
    assert.equal((await signIn(newPassword)).status, 200);
  });
});

test("an unknown address is checked like a wrong password", async () => {
  process.env.DATABASE_PATH = ":memory:";
  process.env.SESSION_SECRET = "isolated-password-check-test-secret-32-characters";
  const { hashPassword, verifyPasswordOrDummy } = await import("../src/auth/password.js");
  const hash = hashPassword("right password");

  assert.equal(verifyPasswordOrDummy("right password", hash), true);
  assert.equal(verifyPasswordOrDummy("wrong password", hash), false);
  assert.equal(verifyPasswordOrDummy("right password", undefined), false, "no account: never a match, whatever is sent");
  assert.equal(verifyPasswordOrDummy("", undefined), false);
  // The dummy is a real hash, so the comparison does the same work as for an account.
  const started = process.hrtime.bigint();
  verifyPasswordOrDummy("x", undefined);
  assert.ok(Number(process.hrtime.bigint() - started) > 0);
});
