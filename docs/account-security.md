# Passkeys and two-factor authentication

Every installation can offer passkeys and authenticator codes. Open **Settings → Account → Account security** to manage them. Nothing is enabled automatically for existing accounts.

## Passkeys

Add a passkey after confirming your identity with your current password (and second factor, if enabled), or an existing passkey. Give it a name so you can identify it later. You can register multiple passkeys and remove them individually.

Passkeys use WebAuthn. FeedKeeper requires user verification with the device's PIN or biometrics, during registration and login. A verified passkey signs in without a password or an additional authenticator code. The server stores public keys, never private keys or biometric data.

Set `PUBLIC_URL` to the **stable external HTTPS origin** of your installation, for example `https://feeds.example.org`. The RP ID is its hostname; the exact origin and RP ID are checked against server configuration, never inferred from incoming headers. Localhost is permitted for development. An ordinary HTTP LAN address cannot use passkeys. Changing the domain can make existing passkeys unusable; retain a working password/recovery route and enroll new passkeys before retiring the old domain.

## Authenticator codes

1. Confirm your identity on the security page.
2. Scan the QR code with an authenticator app, or enter the setup key manually.
3. Enter its six-digit code to activate two-factor authentication.
4. Save the ten recovery codes somewhere safe. Each can replace an authenticator code once. They are shown only when created; generating a new set invalidates the previous set.

TOTP uses 30-second codes and tolerates one time step of clock drift in either direction. A code that has already been accepted cannot be reused. Keep the server's clock synchronized.

Enabling or disabling the authenticator revokes other browser sessions, device and API tokens, OAuth grants and codes, pairing codes and unfinished sign-ins. The browser making the change stays signed in to display the recovery codes. Reconnect your apps and scripts afterwards. Article data is preserved.

The setup key is encrypted with a key derived from `SESSION_SECRET`; recovery codes and challenge handles are hashed. Back up **both the database and the existing secret securely**. Rotating `SESSION_SECRET` also makes stored TOTP keys unreadable. Recovery codes remain usable; disable and enroll the authenticator again using a recovery code or a passkey. Do not rotate the secret as a substitute for revoking sessions.

## Recovery for the operator

If a person loses the authenticator and all recovery codes, an operator with local database access can remove that factor:

```sh
npm run security:recover -- --email reader@example.org --confirm
# Docker:
docker compose exec feedkeeper npm run security:recover -- --email reader@example.org --confirm
```

Verify the person's identity through your own trusted process first. The command removes TOTP and recovery codes and revokes sessions and tokens. Password and passkeys stay unchanged. It grants no access on its own. Keep access to the server and its database restricted.

## API and integrations

The built-in cookie login uses `/api/auth/security`. Read `/config` for supported methods and authenticated `GET /` for the account's state.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/passkeys/options` → `/passkeys/verify` | Discoverable passkey login; options return `{ challengeId, publicKey }`, verification takes `{ challengeId, credential }`. |
| POST | `/mfa` | Complete a password login that returned `403 mfa_required`; takes `{ challengeId, code }`. Accepts TOTP or one recovery code. |
| POST | `/reauth` | Password and optional second factor → one-time `{ reauthToken }`. |
| POST | `/reauth/passkey/options` → `/reauth/passkey/verify` | Passkey → one-time reauthentication proof. |
| POST | `/passkeys/register/options` → `/passkeys/register/verify` | Proof → registration options; verification takes `{ challengeId, credential, name }`. |
| DELETE | `/passkeys/:id` | Remove an owned credential with `{ reauthToken }`. |
| POST | `/totp/setup` → `/totp/confirm` | Proof → secret, QR payload URI and setup challenge; confirmation takes `{ challengeId, code }` and returns recovery codes. |
| POST | `/totp/disable` | Disable with a fresh proof. |
| POST | `/recovery-codes` | Replace recovery codes with a fresh proof. |

Challenges expire after five minutes, have at most five attempts, and are bound to their purpose and client channel. Browser login challenges are also bound to the browser cookie; management proofs are bound to the authenticated session or device. A partial login does not create a user session or token. API tokens and read-only device tokens cannot change security settings.

The OAuth login page links to passkey login and sends accounts with TOTP through the same full login flow before consent. Native clients of a self-hosted installation can continue to pair from an authenticated browser and use revocable device tokens; they do not need to handle passwords or TOTP during synchronization.

Products embedding the server can use `createSecurityRouter` with their own authenticated-account middleware and completed-login callback, and `beginMfa` for additional first-factor providers. All password and provider login paths must honor the account's factor policy. A password reset must preserve TOTP and revoke pending first-factor proofs. Domain association for native passkeys remains the client's responsibility.
