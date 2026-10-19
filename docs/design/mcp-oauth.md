# OAuth for the remote MCP endpoint

Status: implemented in FeedKeeper `0.15.0`.

MCP connectors such as ChatGPT and Claude sign in to `/mcp` with OAuth 2.1 instead of a hand-made token. The server is both the authorization server and the resource server, following the [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization). Personal access tokens (`fk_…`) keep working unchanged.

## Discovery

A request to `/mcp` without a valid token gets `401` with

```
WWW-Authenticate: Bearer resource_metadata="<PUBLIC_URL>/.well-known/oauth-protected-resource/mcp"
```

| Path | Document |
| --- | --- |
| `/.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/mcp` | Resource metadata (RFC 9728): `resource` is `<PUBLIC_URL>/mcp`, the only authorization server is `<PUBLIC_URL>` |
| `/.well-known/oauth-authorization-server` and `/.well-known/openid-configuration` | Authorization server metadata (RFC 8414): endpoints, `S256` as the only PKCE method, public clients only, `authorization_response_iss_parameter_supported` |

These routes, the registration, token and revocation endpoints answer with open CORS and never use cookies.

## Endpoints

| Endpoint | Purpose |
| --- | --- |
| `POST /oauth/register` | Dynamic client registration (RFC 7591). Public clients only (`token_endpoint_auth_method: none`), 1–10 redirect URIs |
| `GET /oauth/authorize` | Validates the request, signs the user in if needed and shows the consent page |
| `POST /oauth/authorize/login` | Email and password form of the built-in sign-in |
| `POST /oauth/authorize/decision` | The user's answer from the consent page |
| `POST /oauth/token` | `authorization_code` and `refresh_token` grants |
| `POST /oauth/revoke` | Revocation by access or refresh token (RFC 7009); always answers `200` |

### Authorization request

- `response_type=code`, `code_challenge` with `code_challenge_method=S256`, an exact `redirect_uri` registered for the client, and optionally `state`, `scope` and `resource`.
- An unknown client or a redirect URI that does not match the registration is shown as an error page and never redirects. Every other problem redirects back with `error` and `state`.
- `resource`, when given, must be `<PUBLIC_URL>/mcp` (`invalid_target` otherwise).
- Scopes are `mcp:read` and `mcp:write`; unknown scopes are ignored. If the client asked for `mcp:read` only, the consent page offers no write access. Without a requested scope, read only is preselected.
- Successful and failed redirects carry `iss` (RFC 9207).

### Consent

The consent page appears on every authorization; consent is never remembered. It names the app, the host the user returns to and the signed-in account, and lets the user choose read only or read and write. Its form carries a CSRF token that binds user, client, redirect URI, state, challenge, scope and resource. The two form posts additionally reject requests from other origins, and the pages are sent with `no-store` and a restrictive CSP (`form-action` allows the client's redirect address only on the consent page). Client names are escaped.

### Token endpoint

- Authorization codes live 60 seconds and work once. A code is deleted on lookup, so a failed attempt cannot be retried with a corrected verifier. The PKCE verifier, client and redirect URI must match the request.
- Access tokens (`fk_oat_…`) live 1 hour, refresh tokens (`fk_ort_…`) 30 days and are rotated on every use. A refresh token that was already replaced revokes the whole grant.
- All codes and tokens are stored as SHA-256 hashes.
- Errors follow RFC 6749 and say nothing about the state of a token.

## Tokens and scope

OAuth grants live in their own table (`oauth_grants`, migration `0027_oauth.sql`), next to `oauth_clients` and `oauth_codes`; SQLite cannot widen the `kind` check of `personal_access_tokens`. `resolveToken` recognises the `fk_oat_` prefix and returns `kind: "oauth"`.

- `mcp:read` maps to the existing `read` token scope and `mcp:write` to `write`, so the tool filtering of `/mcp` applies unchanged.
- `/mcp` accepts `api` and `oauth` tokens. The native API accepts `api` and `device` tokens and rejects OAuth tokens, so a connector never reaches `/api/v1`.
- `/mcp` still requires the `mcp` capability on every request, and the consent page checks it before issuing a code (with `manageUrl` on the error page).

Settings → MCP lists the connected AI assistants (`GET /api/oauth-grants`) and disconnects them (`DELETE /api/oauth-grants/:id`).

## Limits and configuration

- Rate limits: 30 registrations per hour, 60 token or revocation requests per minute, 10 sign-in attempts per 15 minutes (per client address).
- At most 5000 registered clients; clients without a grant are removed after 30 days.
- Redirect URIs must use `https`, or `http` on `localhost`, `127.0.0.1` or `[::1]`, without credentials or fragment. `OAUTH_ALLOWED_REDIRECT_HOSTS` optionally restricts the `https` hosts.
- The issuer is `PUBLIC_URL`; it has to be the address clients reach the server at.

## Hosting products

`setOAuthHost` in `src/oauth/host.ts` replaces the built-in sign-in:

```ts
interface OAuthHost {
  /** The signed-in user's id, or null once the response (sign-in page, redirect) has been sent. */
  resolveResourceOwner(req: Request, res: Response): number | null;
}
```

Without a host, the cookie session is used and the built-in form is shown. Capability checks, consent and token issuing stay in the core.
