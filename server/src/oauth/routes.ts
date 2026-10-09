import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import cors from "cors";
import express, { Router, type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { config } from "../config.js";
import { getUserCapabilities, hasUserCapability } from "../auth/capabilities.js";
import { hasTotp, securityVersion, sessionIsSecure } from "../auth/security.js";
import { verifyPassword } from "../auth/password.js";
import { findUserByEmail, findUserById } from "../auth/users.js";
import type { TokenScope } from "../auth/tokens.js";
import { ISSUER, MCP_RESOURCE } from "./constants.js";
import { getOAuthHost } from "./host.js";
import { renderConsent, renderError, renderLogin, type MessageKey } from "./pages.js";
import {
  consumeAuthorizationCode,
  createAuthorizationCode,
  findClient,
  issueGrant,
  registerClient,
  revokeByToken,
  rotateGrant,
  type IssuedTokens,
  type OAuthClient,
} from "./store.js";

const issuer = ISSUER;
const SCOPES = ["mcp:read", "mcp:write"];
const PKCE_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;

const noStore = (res: Response) => res.setHeader("Cache-Control", "no-store").setHeader("Pragma", "no-cache");

function oauthError(res: Response, status: number, error: string, description?: string): void {
  noStore(res);
  res.status(status).json({ error, ...(description ? { error_description: description } : {}) });
}

function sameResource(value: unknown): boolean {
  return typeof value === "string" && value.replace(/\/+$/, "") === MCP_RESOURCE;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** https anywhere (optionally limited to OAUTH_ALLOWED_REDIRECT_HOSTS) or plain http on this machine. */
function validRedirectUri(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === "http:") return LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol !== "https:") return false;
  const allowed = config.oauthAllowedRedirectHosts;
  return allowed.length === 0 || allowed.includes(url.hostname.toLowerCase());
}

// ---------------------------------------------------------------------------------------------
// Public endpoints: metadata, registration, token, revocation. Called by connector backends and
// browser tools without our cookies, so they get open CORS and no session.
// ---------------------------------------------------------------------------------------------

export const oauthPublicRouter = Router();
const openCors = cors({ origin: "*", credentials: false, methods: ["GET", "POST", "OPTIONS"] });
oauthPublicRouter.use(["/.well-known", "/oauth/register", "/oauth/token", "/oauth/revoke"], openCors);

const formBodies = [express.urlencoded({ extended: false, limit: "20kb" }), express.json({ limit: "20kb" })];

oauthPublicRouter.get(["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"], (_req, res) => {
  res.json({
    resource: MCP_RESOURCE,
    authorization_servers: [issuer],
    scopes_supported: SCOPES,
    bearer_methods_supported: ["header"],
    resource_name: "FeedKeeper MCP",
  });
});

oauthPublicRouter.get(["/.well-known/oauth-authorization-server", "/.well-known/openid-configuration"], (_req, res) => {
  res.json({
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: SCOPES,
    authorization_response_iss_parameter_supported: true,
  });
});

const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
const tokenLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });

const registerSchema = z.object({
  client_name: z.string().trim().min(1).max(100).optional(),
  redirect_uris: z.array(z.string().max(2000)).min(1).max(10),
  token_endpoint_auth_method: z.literal("none").optional(),
  grant_types: z.array(z.enum(["authorization_code", "refresh_token"])).optional(),
  response_types: z.array(z.literal("code")).optional(),
});

oauthPublicRouter.post("/oauth/register", registerLimiter, formBodies[1]!, (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    oauthError(res, 400, "invalid_client_metadata", "Public clients (token_endpoint_auth_method none) with 1-10 redirect_uris are supported.");
    return;
  }
  if (!parsed.data.redirect_uris.every(validRedirectUri)) {
    oauthError(res, 400, "invalid_redirect_uri", "Redirect URIs must be https, or http on localhost, without credentials or fragment.");
    return;
  }
  const client = registerClient(parsed.data.client_name ?? "MCP client", [...new Set(parsed.data.redirect_uris)]);
  if (!client) {
    oauthError(res, 503, "temporarily_unavailable", "Too many registered clients.");
    return;
  }
  noStore(res);
  res.status(201).json({
    client_id: client.client_id,
    client_name: client.client_name,
    redirect_uris: client.redirect_uris,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    client_id_issued_at: Math.floor(Date.parse(client.created_at) / 1000),
  });
});

function basicClientId(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Basic ")) return null;
  const [id] = Buffer.from(header.slice(6), "base64").toString("utf8").split(":");
  return id ? decodeURIComponent(id) : null;
}

const str = (value: unknown): string => (typeof value === "string" ? value : "");

function tokenResponse(res: Response, tokens: IssuedTokens, scope: TokenScope): void {
  noStore(res);
  res.json({
    access_token: tokens.accessToken,
    token_type: "Bearer",
    expires_in: tokens.expiresIn,
    refresh_token: tokens.refreshToken,
    scope: scope === "write" ? "mcp:read mcp:write" : "mcp:read",
  });
}

function pkceMatches(verifier: string, challenge: string): boolean {
  if (!PKCE_PATTERN.test(verifier)) return false;
  const computed = Buffer.from(createHash("sha256").update(verifier).digest("base64url"));
  const stored = Buffer.from(challenge);
  return computed.length === stored.length && timingSafeEqual(computed, stored);
}

oauthPublicRouter.post("/oauth/token", tokenLimiter, ...formBodies, (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const clientId = str(body.client_id) || basicClientId(req) || "";
  const client = clientId ? findClient(clientId) : null;
  if (!client) {
    oauthError(res, 401, "invalid_client");
    return;
  }
  if (body.resource !== undefined && !sameResource(body.resource)) {
    oauthError(res, 400, "invalid_target", `The only resource is ${MCP_RESOURCE}.`);
    return;
  }

  const grantType = str(body.grant_type);
  if (grantType === "authorization_code") {
    // The code is spent by the lookup, so a failed attempt cannot be retried with a corrected verifier.
    const code = consumeAuthorizationCode(str(body.code));
    if (!code || code.client_id !== client.client_id || code.redirect_uri !== str(body.redirect_uri) || !pkceMatches(str(body.code_verifier), code.code_challenge)) {
      oauthError(res, 400, "invalid_grant");
      return;
    }
    tokenResponse(res, issueGrant(code.user_id, client.client_id, code.scope), code.scope);
    return;
  }
  if (grantType === "refresh_token") {
    const result = rotateGrant(str(body.refresh_token), client.client_id);
    if (!result.ok) {
      oauthError(res, 400, "invalid_grant");
      return;
    }
    tokenResponse(res, result.tokens, result.scope);
    return;
  }
  oauthError(res, 400, "unsupported_grant_type");
});

oauthPublicRouter.post("/oauth/revoke", tokenLimiter, ...formBodies, (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  // RFC 7009: the answer never reveals whether the token existed.
  revokeByToken(str(body.token), str(body.client_id) || basicClientId(req));
  noStore(res);
  res.status(200).json({});
});

// ---------------------------------------------------------------------------------------------
// Authorization: runs in the user's browser with the cookie session.
// ---------------------------------------------------------------------------------------------

export const oauthAuthorizeRouter = Router();
const publicOrigin = new URL(issuer).origin;

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
const formOnly = express.urlencoded({ extended: false, limit: "20kb" });

/**
 * The consent and login forms only ever post from our own pages. Browsers state that themselves in
 * Sec-Fetch-Site; Origin is the fallback for older ones. With `Referrer-Policy: no-referrer` (helmet's
 * default) a same-origin form post carries `Origin: null`, so a null Origin alone proves nothing.
 */
function sameOriginOnly(req: Request, res: Response, next: NextFunction): void {
  const site = req.headers["sec-fetch-site"];
  const origin = req.headers.origin;
  const foreign = site !== undefined ? site !== "same-origin" : origin !== undefined && origin !== publicOrigin;
  if (foreign) {
    page(res, 403, renderError(req, "forbidden"));
    return;
  }
  next();
}

const LOOPBACK_FORM_ACTIONS = "http://localhost:* http://127.0.0.1:* http://[::1]:*";

/** Pages are never cached or framed. Consent may submit on to the client's redirect address, which form-action also covers after a redirect. */
function page(res: Response, status: number, html: string, allowRedirects = false): void {
  noStore(res);
  // The forms check where a post came from; give them an Origin to check.
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader(
    "Content-Security-Policy",
    `default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'${allowRedirects ? ` https: ${LOOPBACK_FORM_ACTIONS}` : ""}`,
  );
  res.status(status).type("html").send(html);
}

type Authorization =
  | { kind: "fatal"; message: MessageKey }
  | { kind: "redirect"; redirectUri: string; state: string; error: string }
  | {
      kind: "ok";
      client: OAuthClient;
      redirectUri: string;
      state: string;
      codeChallenge: string;
      requested: TokenScope | null;
      resource: string;
    };

function parseAuthorization(params: Record<string, unknown>): Authorization {
  const client = findClient(str(params.client_id));
  if (!client) return { kind: "fatal", message: "unknownClient" };
  const redirectUri = str(params.redirect_uri);
  // Unlike every other problem, these two must never bounce back to an unverified address.
  if (!client.redirect_uris.includes(redirectUri)) return { kind: "fatal", message: "badRedirect" };

  const state = str(params.state);
  const fail = (error: string): Authorization => ({ kind: "redirect", redirectUri, state, error });
  if (str(params.response_type) !== "code") return fail("unsupported_response_type");
  const codeChallenge = str(params.code_challenge);
  if (!PKCE_PATTERN.test(codeChallenge) || str(params.code_challenge_method) !== "S256") return fail("invalid_request");
  if (params.resource !== undefined && !sameResource(params.resource)) return fail("invalid_target");

  // Unknown scopes (openid, offline_access, ...) are ignored; the user picks the final level.
  const scopes = str(params.scope).split(/\s+/);
  const requested: TokenScope | null = scopes.includes("mcp:write") ? "write" : scopes.includes("mcp:read") ? "read" : null;
  return { kind: "ok", client, redirectUri, state, codeChallenge, requested, resource: MCP_RESOURCE };
}

function redirectBack(res: Response, redirectUri: string, values: Record<string, string>): void {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries({ ...values, iss: issuer })) if (value) url.searchParams.set(key, value);
  noStore(res);
  res.redirect(303, url.toString());
}

function csrfToken(userId: number, a: Extract<Authorization, { kind: "ok" }>): string {
  const material = ["oauth-consent", userId, a.client.client_id, a.redirectUri, a.state, a.codeChallenge, a.requested ?? "", a.resource].join("\n");
  return createHmac("sha256", config.sessionSecret).update(material).digest("hex");
}

function csrfValid(expected: string, given: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The signed-in user, or null once the host or the login page has taken over the response. */
function resolveOwner(req: Request, res: Response, client: OAuthClient): number | null {
  const host = getOAuthHost();
  if (host) return host.resolveResourceOwner(req, res);
  const userId = req.session?.userId as number | undefined;
  if (userId && findUserById(userId) && sessionIsSecure(req, userId)) return userId;
  page(res, 200, renderLogin(req, { clientName: client.client_name, returnTo: req.originalUrl }));
  return null;
}

function mayUseMcp(req: Request, res: Response, userId: number): boolean {
  if (hasUserCapability(userId, "mcp")) return true;
  page(res, 403, renderError(req, "noAccess", getUserCapabilities(userId).manageUrl));
  return false;
}

oauthAuthorizeRouter.get("/oauth/authorize", (req, res) => {
  const parsed = parseAuthorization(req.query);
  if (parsed.kind === "fatal") {
    page(res, 400, renderError(req, parsed.message));
    return;
  }
  if (parsed.kind === "redirect") {
    redirectBack(res, parsed.redirectUri, { error: parsed.error, state: parsed.state });
    return;
  }
  const userId = resolveOwner(req, res, parsed.client);
  if (userId === null || !mayUseMcp(req, res, userId)) return;

  const user = findUserById(userId)!;
  page(
    res,
    200,
    renderConsent(req, {
      clientName: parsed.client.client_name,
      redirectHost: new URL(parsed.redirectUri).host,
      userName: user.display_name || user.email,
      preselect: parsed.requested === "write" ? "write" : "read",
      allowWrite: parsed.requested !== "read",
      fields: {
        client_id: parsed.client.client_id,
        redirect_uri: parsed.redirectUri,
        state: parsed.state,
        code_challenge: parsed.codeChallenge,
        code_challenge_method: "S256",
        response_type: "code",
        scope: parsed.requested === "write" ? "mcp:read mcp:write" : parsed.requested === "read" ? "mcp:read" : "",
        resource: parsed.resource,
        csrf: csrfToken(userId, parsed),
      },
    }),
    true,
  );
});

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1), return_to: z.string().max(4000) });

oauthAuthorizeRouter.post("/oauth/authorize/login", sameOriginOnly, loginLimiter, formOnly, (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  // Only our own authorize URL is a valid destination; anything else would be an open redirect.
  if (!parsed.success || !parsed.data.return_to.startsWith("/oauth/authorize?")) {
    page(res, 400, renderError(req, "forbidden"));
    return;
  }
  const returnTo = parsed.data.return_to;
  const clientId = new URL(returnTo, issuer).searchParams.get("client_id") ?? "";
  const client = findClient(clientId);
  if (!client) {
    page(res, 400, renderError(req, "unknownClient"));
    return;
  }
  const user = findUserByEmail(parsed.data.email);
  if (!user || !verifyPassword(parsed.data.password, user.password_hash)) {
    page(res, 401, renderLogin(req, { clientName: client.client_name, returnTo, failed: true }));
    return;
  }
  if (hasTotp(user.id)) { res.redirect(303, `/login?next=${encodeURIComponent(returnTo)}`); return; }
  req.session = { userId: user.id, securityVersion: securityVersion(user.id) };
  res.redirect(303, returnTo);
});

oauthAuthorizeRouter.post("/oauth/authorize/decision", sameOriginOnly, formOnly, (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const parsed = parseAuthorization(body);
  if (parsed.kind === "fatal") {
    page(res, 400, renderError(req, parsed.message));
    return;
  }
  if (parsed.kind === "redirect") {
    redirectBack(res, parsed.redirectUri, { error: parsed.error, state: parsed.state });
    return;
  }
  const userId = resolveOwner(req, res, parsed.client);
  if (userId === null) return;
  // Every field of the consent page is bound into the token, so a forged or altered form fails here.
  if (!csrfValid(csrfToken(userId, parsed), str(body.csrf))) {
    page(res, 403, renderError(req, "forbidden"));
    return;
  }
  if (!mayUseMcp(req, res, userId)) return;

  if (str(body.decision) !== "allow") {
    redirectBack(res, parsed.redirectUri, { error: "access_denied", state: parsed.state });
    return;
  }
  const scope: TokenScope = str(body.grant_scope) === "write" && parsed.requested !== "read" ? "write" : "read";
  const code = createAuthorizationCode({
    clientId: parsed.client.client_id,
    userId,
    redirectUri: parsed.redirectUri,
    codeChallenge: parsed.codeChallenge,
    scope,
  });
  redirectBack(res, parsed.redirectUri, { code, state: parsed.state });
});
