import { base64URLStringToBuffer, bufferToBase64URLString, type PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { securityRequest } from "./security.ts";

interface LoginCallbacks {
  onAutofill: (available: boolean) => void;
  onSelect: () => void;
  onSuccess: () => Promise<void>;
  onError: (error: unknown) => void;
}

/** One pending ceremony per login form. Password submission and navigation cancel it. */
export function createPasskeyLogin(callbacks: LoginCallbacks) {
  let controller: AbortController | undefined;
  let renewal: ReturnType<typeof setTimeout> | undefined;
  function stop() {
    controller?.abort();
    controller = undefined;
    clearTimeout(renewal);
  }
  async function start(conditional = true) {
    if (controller && conditional) return;
    stop();
    const current = new AbortController();
    const { signal } = current;
    controller = current;
    let selected = false;
    try {
      if (conditional) {
        const available = await window.PublicKeyCredential?.isConditionalMediationAvailable?.().catch(() => false) ?? false;
        if (signal.aborted) return;
        callbacks.onAutofill(available);
        if (!available) return;
      }
      const options = await securityRequest<{ challengeId: string; publicKey: PublicKeyCredentialRequestOptionsJSON }>("/passkeys/options", {}, "POST", signal);
      if (signal.aborted) return;
      // Server challenges expire after five minutes, even while conditional UI is waiting.
      if (conditional) renewal = setTimeout(() => { stop(); void start(); }, 4 * 60_000);
      const result = await navigator.credentials.get({
        signal,
        ...(conditional ? { mediation: "conditional" as const } : {}),
        publicKey: {
          ...options.publicKey,
          extensions: options.publicKey.extensions as AuthenticationExtensionsClientInputs | undefined,
          challenge: base64URLStringToBuffer(options.publicKey.challenge),
          allowCredentials: conditional ? [] : options.publicKey.allowCredentials?.map(key => ({ type: "public-key", id: base64URLStringToBuffer(key.id), transports: key.transports as AuthenticatorTransport[] | undefined })),
        },
      }) as PublicKeyCredential | null;
      if (signal.aborted || !result) return;
      clearTimeout(renewal);
      selected = true;
      callbacks.onSelect();
      const response = result.response as AuthenticatorAssertionResponse;
      const credential = {
        id: result.id, rawId: bufferToBase64URLString(result.rawId), type: result.type,
        clientExtensionResults: result.getClientExtensionResults(),
        response: {
          clientDataJSON: bufferToBase64URLString(response.clientDataJSON),
          authenticatorData: bufferToBase64URLString(response.authenticatorData),
          signature: bufferToBase64URLString(response.signature),
          userHandle: response.userHandle ? bufferToBase64URLString(response.userHandle) : null,
        },
      };
      await securityRequest("/passkeys/verify", { challengeId: options.challengeId, credential }, "POST", signal);
      if (!signal.aborted) await callbacks.onSuccess();
    } catch (error) {
      if (!signal.aborted) {
        if (selected || !conditional) callbacks.onError(error);
        else if (!(error instanceof Error) || error.name !== "NotAllowedError") callbacks.onAutofill(false);
      }
    } finally {
      if (controller === current) { clearTimeout(renewal); controller = undefined; }
    }
  }
  return { start, stop };
}
