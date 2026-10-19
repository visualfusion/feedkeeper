import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express from "express";

test("a connector signs in with OAuth, PKCE and a consent page, then reaches /mcp with a rotating token", async () => {
  process.env.DATABASE_PATH = ":memory:";
  process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
  process.env.PUBLIC_URL = "http://localhost:3000";
  const { db, runMigrations } = await import("../src/db/index.js");
  const { oauthAuthorizeRouter, oauthPublicRouter } = await import("../src/oauth/routes.js");
  const { mcpRouter } = await import("../src/mcp/http.js");
  const { v1Router } = await import("../src/api/v1/index.js");
  const { resolveToken } = await import("../src/auth/tokens.js");
  const { hashPassword } = await import("../src/auth/password.js");
  runMigrations();

  const userId = Number(
    db.prepare("INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?)").run("oauth-owner@example.test", hashPassword("correct horse battery"), "Owner").lastInsertRowid,
  );

  // Stand-in for the cookie session: the test names the signed-in user in a header.
  const app = express();
  app.use(oauthPublicRouter);
  app.use(express.json());
  app.use((req, _res, next) => {
    const user = req.headers["x-test-user"];
    if (user) req.session = { userId: Number(user) } as typeof req.session;
    else req.session = {} as typeof req.session;
    next();
  });
  app.use(oauthAuthorizeRouter);
  app.use("/api/v1", v1Router);
  app.use("/mcp", mcpRouter);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const redirectUri = "https://chatgpt.example.test/callback";

  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");

  const form = (values: Record<string, string>) => new URLSearchParams(values).toString();
  const post = (path: string, values: Record<string, string>, headers: Record<string, string> = {}) =>
    fetch(base + path, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", ...headers }, body: form(values) });
  const tokenRequest = async (values: Record<string, string>) => {
    const response = await post("/oauth/token", values);
    return { status: response.status, body: (await response.json()) as Record<string, string | number> };
  };
  const hiddenFields = (html: string) => Object.fromEntries([...html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map((m) => [m[1]!, m[2]!.replace(/&amp;/g, "&")]));
  const mcpInitialize = (token?: string) =>
    fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } } }),
    });

  try {
    // Discovery: the 401 points at the resource metadata, which names this server as authorization server.
    const unauthorized = await mcpInitialize();
    assert.equal(unauthorized.status, 401);
    assert.match(unauthorized.headers.get("www-authenticate") ?? "", /resource_metadata="http:\/\/localhost:3000\/\.well-known\/oauth-protected-resource\/mcp"/);
    const resource = (await (await fetch(`${base}/.well-known/oauth-protected-resource/mcp`)).json()) as Record<string, unknown>;
    assert.equal(resource.resource, "http://localhost:3000/mcp");
    const metadata = (await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json()) as Record<string, unknown>;
    assert.deepEqual(metadata.code_challenge_methods_supported, ["S256"]);
    assert.equal(metadata.registration_endpoint, "http://localhost:3000/oauth/register");

    // Registration accepts https and loopback redirects, nothing else.
    const register = (body: unknown) => fetch(`${base}/oauth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    assert.equal((await register({ client_name: "Bad", redirect_uris: ["http://evil.example.test/cb"] })).status, 400);
    assert.equal((await register({ client_name: "Bad", redirect_uris: ["https://ok.example.test/cb#frag"] })).status, 400);
    assert.equal((await register({ client_name: "Bad", redirect_uris: ["https://ok.example.test/cb"], token_endpoint_auth_method: "client_secret_basic" })).status, 400);
    const registered = await register({ client_name: "ChatGPT <script>", redirect_uris: [redirectUri, "http://localhost:8123/cb"] });
    assert.equal(registered.status, 201);
    const client = (await registered.json()) as { client_id: string };

    const authorizeQuery = (extra: Record<string, string> = {}) =>
      form({ client_id: client.client_id, redirect_uri: redirectUri, response_type: "code", code_challenge: challenge, code_challenge_method: "S256", state: "xyz", scope: "mcp:read mcp:write", resource: "http://localhost:3000/mcp", ...extra });

    // An unknown client or redirect never redirects; a bad request redirects with an error and the state.
    assert.equal((await fetch(`${base}/oauth/authorize?${authorizeQuery({ client_id: "nope" })}`, { redirect: "manual" })).status, 400);
    assert.equal((await fetch(`${base}/oauth/authorize?${authorizeQuery({ redirect_uri: "https://evil.example.test/cb" })}`, { redirect: "manual" })).status, 400);
    const noPkce = await fetch(`${base}/oauth/authorize?${authorizeQuery({ code_challenge_method: "plain" })}`, { redirect: "manual" });
    assert.equal(noPkce.status, 303);
    assert.match(noPkce.headers.get("location")!, /^https:\/\/chatgpt\.example\.test\/callback\?error=invalid_request&state=xyz&iss=/);
    const wrongResource = await fetch(`${base}/oauth/authorize?${authorizeQuery({ resource: "https://other.example.test/mcp" })}`, { redirect: "manual" });
    assert.match(wrongResource.headers.get("location")!, /error=invalid_target/);

    // Signed out: the login form, with the client name escaped.
    const loginPage = await (await fetch(`${base}/oauth/authorize?${authorizeQuery()}`)).text();
    assert.match(loginPage, /action="\/oauth\/authorize\/login"/);
    assert.ok(!loginPage.includes("<script>"));
    const returnTo = hiddenFields(loginPage).return_to!;
    const badLogin = await post("/oauth/authorize/login", { email: "oauth-owner@example.test", password: "wrong", return_to: returnTo });
    assert.equal(badLogin.status, 401);
    assert.equal((await post("/oauth/authorize/login", { email: "oauth-owner@example.test", password: "x", return_to: "https://evil.example.test/" })).status, 400);

    // Signed in: the consent page carries every field and a CSRF token.
    const asUser = { "x-test-user": String(userId) };
    const consent = await fetch(`${base}/oauth/authorize?${authorizeQuery()}`, { headers: asUser });
    assert.equal(consent.status, 200);
    assert.match(consent.headers.get("content-security-policy") ?? "", /form-action 'self' https:/);
    const fields = hiddenFields(await consent.text());
    assert.ok(fields.csrf);

    // Forged forms and cross-site posts are refused.
    assert.equal((await post("/oauth/authorize/decision", { ...fields, csrf: "0".repeat(64), decision: "allow", grant_scope: "write" }, asUser)).status, 403);
    assert.equal((await post("/oauth/authorize/decision", { ...fields, redirect_uri: "http://localhost:8123/cb", decision: "allow", grant_scope: "write" }, asUser)).status, 403);
    assert.equal((await post("/oauth/authorize/decision", { ...fields, decision: "allow", grant_scope: "write" }, { ...asUser, origin: "https://evil.example.test" })).status, 403);
    assert.equal((await post("/oauth/authorize/decision", { ...fields, decision: "allow", grant_scope: "write" }, { ...asUser, "sec-fetch-site": "cross-site" })).status, 403);
    assert.equal((await post("/oauth/authorize/decision", { ...fields, decision: "allow", grant_scope: "write" }, { ...asUser, "sec-fetch-site": "same-site" })).status, 403);
    // Without Origin or Sec-Fetch-Site (old browsers, tools) the CSRF token still binds the form to the session.
    assert.equal((await post("/oauth/authorize/decision", { ...fields, csrf: "0".repeat(64), decision: "allow", grant_scope: "write" }, asUser)).status, 403);
    // A same-origin post under `Referrer-Policy: no-referrer` carries `Origin: null`; the browser says same-origin itself.
    const sameOriginNull = await post("/oauth/authorize/decision", { ...fields, decision: "deny" }, { ...asUser, origin: "null", "sec-fetch-site": "same-origin" });
    assert.equal(sameOriginNull.status, 303);
    assert.match(sameOriginNull.headers.get("location")!, /error=access_denied/);
    assert.equal(consent.headers.get("referrer-policy"), "same-origin");

    // Deny sends the user back with access_denied.
    const denied = await post("/oauth/authorize/decision", { ...fields, decision: "deny" }, asUser);
    assert.match(denied.headers.get("location")!, /error=access_denied&state=xyz/);

    // Allow with read-only scope, although the client asked for write.
    const allowed = await post("/oauth/authorize/decision", { ...fields, decision: "allow", grant_scope: "read" }, asUser);
    assert.equal(allowed.status, 303);
    const callback = new URL(allowed.headers.get("location")!);
    assert.equal(callback.origin + callback.pathname, redirectUri);
    assert.equal(callback.searchParams.get("state"), "xyz");
    assert.equal(callback.searchParams.get("iss"), "http://localhost:3000");
    const code = callback.searchParams.get("code")!;

    // A client id in HTTP Basic credentials that is not valid percent-encoding is an unknown client, not a server error.
    const malformed = await post("/oauth/token", { grant_type: "authorization_code", code: "x" }, { authorization: `Basic ${Buffer.from("%E0%A4%A:").toString("base64")}` });
    assert.equal(malformed.status, 401);
    assert.equal(((await malformed.json()) as { error: string }).error, "invalid_client");

    // A wrong verifier fails and spends the code.
    const wrong = await tokenRequest({ grant_type: "authorization_code", client_id: client.client_id, code, redirect_uri: redirectUri, code_verifier: randomBytes(48).toString("base64url") });
    assert.equal(wrong.body.error, "invalid_grant");
    const spent = await tokenRequest({ grant_type: "authorization_code", client_id: client.client_id, code, redirect_uri: redirectUri, code_verifier: verifier });
    assert.equal(spent.body.error, "invalid_grant");

    // The real exchange.
    const second = await post("/oauth/authorize/decision", { ...fields, decision: "allow", grant_scope: "write" }, asUser);
    const secondCode = new URL(second.headers.get("location")!).searchParams.get("code")!;
    const issued = await tokenRequest({ grant_type: "authorization_code", client_id: client.client_id, code: secondCode, redirect_uri: redirectUri, code_verifier: verifier, resource: "http://localhost:3000/mcp" });
    assert.equal(issued.status, 200);
    assert.equal(issued.body.token_type, "Bearer");
    assert.equal(issued.body.scope, "mcp:read mcp:write");
    const access = issued.body.access_token as string;
    const refresh = issued.body.refresh_token as string;
    assert.deepEqual({ ...resolveToken(access)!, tokenId: 0 }, { userId, scope: "write", kind: "oauth", tokenId: 0 });

    // The token opens /mcp but nothing else.
    assert.equal((await mcpInitialize(access)).status, 200);
    assert.equal((await fetch(`${base}/api/v1/meta`, { headers: { authorization: `Bearer ${access}` } })).status, 200);
    assert.equal((await fetch(`${base}/api/v1/devices`, { headers: { authorization: `Bearer ${access}` } })).status, 401);

    // Refresh rotates the pair; replaying the old refresh token revokes the grant.
    assert.equal((await tokenRequest({ grant_type: "refresh_token", client_id: "other", refresh_token: refresh })).status, 401);
    const rotated = await tokenRequest({ grant_type: "refresh_token", client_id: client.client_id, refresh_token: refresh });
    assert.equal(rotated.status, 200);
    assert.notEqual(rotated.body.refresh_token, refresh);
    assert.equal((await mcpInitialize(rotated.body.access_token as string)).status, 200);
    const { listGrantsForUser, deleteGrant } = await import("../src/oauth/store.js");
    const listed = listGrantsForUser(userId);
    assert.equal(listed.length, 1);
    assert.equal(listed[0]!.client_name, "ChatGPT <script>");
    assert.equal(listed[0]!.scope, "write");
    assert.equal(deleteGrant(userId + 1, listed[0]!.id), false);
    const replay = await tokenRequest({ grant_type: "refresh_token", client_id: client.client_id, refresh_token: refresh });
    assert.equal(replay.body.error, "invalid_grant");
    assert.equal((await mcpInitialize(rotated.body.access_token as string)).status, 401);

    // Access tokens expire; revocation removes a grant by either token.
    const third = await post("/oauth/authorize/decision", { ...fields, decision: "allow", grant_scope: "write" }, asUser);
    const thirdIssued = await tokenRequest({ grant_type: "authorization_code", client_id: client.client_id, code: new URL(third.headers.get("location")!).searchParams.get("code")!, redirect_uri: redirectUri, code_verifier: verifier });
    const thirdAccess = thirdIssued.body.access_token as string;
    db.prepare("UPDATE oauth_grants SET access_expires_at = '2000-01-01T00:00:00.000Z'").run();
    assert.equal((await mcpInitialize(thirdAccess)).status, 401);
    assert.equal((await post("/oauth/revoke", { token: thirdIssued.body.refresh_token as string, client_id: client.client_id })).status, 200);
    assert.equal((await tokenRequest({ grant_type: "refresh_token", client_id: client.client_id, refresh_token: thirdIssued.body.refresh_token as string })).body.error, "invalid_grant");
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM oauth_grants").get() as { n: number }).n, 0);
  } finally {
    server.close();
  }
});
