import { startAuthentication, startRegistration, type PublicKeyCredentialRequestOptionsJSON, type PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";
import { ApiError } from "./client.ts";
export async function securityRequest<T = void>(path: string, body?: unknown, method = "POST"): Promise<T> {
  const response = await fetch(`/api/auth/security${path}`, { method, credentials: "same-origin", headers: { "Content-Type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const result = response.status === 204 ? undefined : await response.json();
  if (!response.ok) throw new ApiError(response.status, result.error, result);
  return result;
}
export async function passkeyLogin() {
  const options = await securityRequest<{ challengeId: string; publicKey: PublicKeyCredentialRequestOptionsJSON }>("/passkeys/options", {});
  const credential = await startAuthentication({ optionsJSON: options.publicKey });
  await securityRequest("/passkeys/verify", { challengeId: options.challengeId, credential });
}
export async function passkeyProof(): Promise<string> {
  const options = await securityRequest<{ challengeId: string; publicKey: PublicKeyCredentialRequestOptionsJSON }>("/reauth/passkey/options", {});
  const credential = await startAuthentication({ optionsJSON: options.publicKey });
  return (await securityRequest<{ reauthToken: string }>("/reauth/passkey/verify", { challengeId: options.challengeId, credential })).reauthToken;
}
export async function registerPasskey(reauthToken: string, name: string) {
  const options = await securityRequest<{ challengeId: string; publicKey: PublicKeyCredentialCreationOptionsJSON }>("/passkeys/register/options", { reauthToken });
  const credential = await startRegistration({ optionsJSON: options.publicKey });
  await securityRequest("/passkeys/register/verify", { challengeId: options.challengeId, credential, name });
}
