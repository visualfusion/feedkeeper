import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import QRCode from "qrcode";
import { passkeyProof, registerPasskey, securityRequest } from "../../api/security.ts";
import { SettingsCard, SettingBlock } from "./ui.tsx";

interface SecurityStatus {
  totpEnabled: boolean;
  passkeysEnabled: boolean;
  emailReauthEnabled?: boolean;
  recoveryCodesRemaining: number;
  passkeys: { id: string; name: string; created_at: string }[];
}

function ReauthModal({
  status,
  onSuccess,
  onCancel,
}: {
  status: SecurityStatus;
  onSuccess: (token: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    passwordRef.current?.focus();
  }, []);

  async function handlePasskey() {
    setBusy(true);
    setError("");
    try {
      const token = await passkeyProof();
      onSuccess(token);
    } catch {
      setError(t("security.passkeyCancelled"));
    } finally {
      setBusy(false);
    }
  }

  async function handlePasswordSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!password.trim() && !emailCode.trim()) return;
    setBusy(true);
    setError("");
    try {
      const result = await securityRequest<{ reauthToken: string }>(
        emailSent ? "/reauth/email/confirm" : "/reauth",
        { password, code, emailCode },
      );
      onSuccess(result.reauthToken);
    } catch {
      setError(t("security.invalidCredentials"));
    } finally {
      setBusy(false);
    }
  }

  async function handleSendEmail() {
    setBusy(true);
    setError("");
    try {
      await securityRequest("/reauth/email", {});
      setEmailSent(true);
    } catch {
      setError(t("security.failed"));
    } finally {
      setBusy(false);
    }
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-xs animate-fade-in"
        onClick={busy ? undefined : onCancel}
        aria-hidden="true"
      />
      <div
        className="relative z-10 w-full max-w-md rounded-2xl border border-[var(--c-border)] bg-[var(--c-surface)] p-6 shadow-2xl animate-scale-in"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reauth-modal-title"
      >
        <div className="flex items-start justify-between gap-3 mb-2">
          <h2 id="reauth-modal-title" className="text-lg font-bold text-[var(--c-text)]">
            {t("security.confirmTitle")}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="text-[var(--c-text-muted)] hover:text-[var(--c-text)] p-1 rounded-lg"
            aria-label={t("security.cancel")}
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <p className="text-sm text-[var(--c-text-muted)] mb-5">
          {t("security.reauth")}
        </p>

        {error && (
          <p role="alert" className="text-sm text-[var(--c-danger)] mb-4 p-2.5 rounded-lg bg-[var(--c-danger-bg)] border border-[var(--c-danger-border)]">
            {error}
          </p>
        )}

        {status.passkeys.length > 0 && (
          <div className="mb-5">
            <button
              type="button"
              className="btn-primary w-full flex items-center justify-center gap-2 py-2.5 font-medium"
              onClick={handlePasskey}
              disabled={busy}
            >
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="7.5" cy="15.5" r="5.5" />
                <path d="m21 2-9.6 9.6M15.5 7.5l3 3M18.5 4.5l3 3" />
              </svg>
              {t("security.usePasskey")}
            </button>

            <div className="relative my-4 flex items-center justify-center">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-[var(--c-border)]" />
              </div>
              <span className="relative bg-[var(--c-surface)] px-3 text-xs uppercase tracking-wider text-[var(--c-text-muted)]">
                {t("security.orPassword")}
              </span>
            </div>
          </div>
        )}

        <form onSubmit={handlePasswordSubmit} className="flex flex-col gap-3">
          {!emailSent && (
            <label className="flex flex-col gap-1 text-xs font-medium text-[var(--c-text-muted)]">
              {t("security.password")}
              <input
                ref={passwordRef}
                className="input text-sm text-[var(--c-text)]"
                type="password"
                autoComplete="current-password"
                disabled={busy}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("security.password")}
                aria-label={t("security.password")}
                required={!status.emailReauthEnabled}
              />
            </label>
          )}

          {status.totpEnabled && (
            <label className="flex flex-col gap-1 text-xs font-medium text-[var(--c-text-muted)]">
              {t("security.code")}
              <input
                className="input text-sm text-[var(--c-text)]"
                autoComplete="one-time-code"
                inputMode="numeric"
                disabled={busy}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder={t("security.code")}
                aria-label={t("security.code")}
              />
            </label>
          )}

          {status.emailReauthEnabled && !emailSent && (
            <button
              type="button"
              className="btn-secondary self-start text-xs"
              disabled={busy}
              onClick={handleSendEmail}
            >
              {t("security.sendEmail")}
            </button>
          )}

          {emailSent && (
            <label className="flex flex-col gap-1 text-xs font-medium text-[var(--c-text-muted)]">
              {t("security.emailCode")}
              <input
                ref={passwordRef}
                className="input text-sm text-[var(--c-text)]"
                autoComplete="one-time-code"
                inputMode="numeric"
                disabled={busy}
                value={emailCode}
                onChange={(e) => setEmailCode(e.target.value)}
                placeholder={t("security.emailCode")}
                aria-label={t("security.emailCode")}
                required
              />
            </label>
          )}

          <div className="flex justify-end gap-2.5 mt-2">
            <button type="button" className="btn-secondary text-sm" onClick={onCancel} disabled={busy}>
              {t("security.cancel")}
            </button>
            <button
              type="submit"
              className="btn-primary text-sm"
              disabled={busy || (!password.trim() && !emailCode.trim())}
            >
              {t("security.confirmAction")}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

export function SecuritySettings() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<SecurityStatus>();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState<{ challengeId: string; secret: string; qr: string }>();
  const [recovery, setRecovery] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [proofRequest, setProofRequest] = useState<{ resolve: (token: string) => void; reject: (err: Error) => void } | null>(null);

  const load = async () => {
    const result = await securityRequest<SecurityStatus>("/", undefined, "GET");
    setStatus(result);
  };

  useEffect(() => {
    void load().catch(() => setError(t("security.failed")));
  }, [t]);

  function requestProof(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      setProofRequest({ resolve, reject });
    });
  }

  function handleProofSuccess(token: string) {
    const req = proofRequest;
    setProofRequest(null);
    if (req) req.resolve(token);
  }

  function handleProofCancel() {
    const req = proofRequest;
    setProofRequest(null);
    if (req) req.reject(new Error("cancelled"));
  }

  async function run(action: (reauthToken: string) => Promise<void>, message?: string) {
    setError("");
    setSuccess("");
    let token: string;
    try {
      token = await requestProof();
    } catch {
      // User cancelled reauth dialog
      return;
    }
    setBusy(true);
    let completed = false;
    try {
      await action(token);
      completed = true;
      if (message) setSuccess(t(message));
      await load();
    } catch (failure) {
      setError(
        t(
          completed
            ? "security.refreshFailed"
            : failure instanceof Error && failure.message === "last_passkey"
              ? "security.lastPasskey"
              : "security.failed",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  if (!status) return error ? <p role="alert">{error}</p> : null;

  return (
    <SettingsCard title={t("security.title")} description={t("security.intro")}>
      {success && (
        <div className="px-5 pt-3 pb-1 sm:px-6">
          <p
            role="status"
            className="flex items-center gap-2.5 rounded-xl border border-[var(--c-success-border)] bg-[var(--c-success-bg)] px-3.5 py-2.5 text-sm font-medium text-[var(--c-green3)]"
          >
            <svg className="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z"
                clipRule="evenodd"
              />
            </svg>
            <span>{success}</span>
          </p>
        </div>
      )}
      {error && (
        <div className="px-5 pt-3 pb-1 sm:px-6">
          <p
            role="alert"
            className="flex items-center gap-2.5 rounded-xl border border-[var(--c-danger-border)] bg-[var(--c-danger-bg)] px-3.5 py-2.5 text-sm font-medium text-[var(--c-danger)]"
          >
            <svg className="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10 5Zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
                clipRule="evenodd"
              />
            </svg>
            <span>{error}</span>
          </p>
        </div>
      )}

      <SettingBlock>
        <h3 className="font-semibold mb-3">{t("security.passkeys")}</h3>
        {!!status.passkeys.length && (
          <ul className="mb-4 divide-y divide-[var(--c-border)] rounded-xl border border-[var(--c-border)]">
            {status.passkeys.map((key) => (
              <li key={key.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere] text-sm font-medium">{key.name}</span>
                <button
                  type="button"
                  className="btn-secondary shrink-0 text-sm"
                  disabled={busy}
                  aria-label={t("security.removeNamed", { name: key.name })}
                  onClick={() =>
                    void run(
                      async (token) => {
                        await securityRequest(`/passkeys/${encodeURIComponent(key.id)}`, { reauthToken: token }, "DELETE");
                      },
                      "security.passkeyRemoved",
                    )
                  }
                >
                  {t("security.remove")}
                </button>
              </li>
            ))}
          </ul>
        )}
        {status.passkeysEnabled ? (
          <form
            className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              if (!busy && name.trim()) {
                const passkeyName = name.trim();
                void run(async (token) => {
                  await registerPasskey(token, passkeyName);
                  setName("");
                }, "security.passkeyAdded");
              }
            }}
          >
            <label className="min-w-0 text-sm font-medium">
              {t("security.passkeyName")}
              <input
                className="input mt-2"
                value={name}
                maxLength={100}
                disabled={busy}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("security.passkeyName")}
                aria-label={t("security.passkeyName")}
              />
            </label>
            <button type="submit" className="btn-primary whitespace-nowrap" disabled={busy || !name.trim()}>
              {t("security.addPasskey")}
            </button>
          </form>
        ) : (
          <p>{t("security.httpsRequired")}</p>
        )}
      </SettingBlock>

      <SettingBlock>
        <h3 className="font-semibold mb-3">{t("security.twoFactor")}</h3>
        <p className="text-sm mb-3">{t(status.totpEnabled ? "security.enabled" : "security.disabled")}</p>
        <p className="text-sm mb-3">{t("security.revocationHint")}</p>

        {!setup && (
          <button
            className="btn-secondary"
            disabled={busy || recovery.length > 0}
            onClick={() =>
              void run(
                async (token) => {
                  if (status.totpEnabled) {
                    await securityRequest("/totp/disable", { reauthToken: token });
                  } else {
                    const result = await securityRequest<{ challengeId: string; secret: string; uri: string }>(
                      "/totp/setup",
                      { reauthToken: token },
                    );
                    setSetup({ ...result, qr: await QRCode.toDataURL(result.uri) });
                  }
                },
                status.totpEnabled ? "security.updated" : "security.authenticatorStarted",
              )
            }
          >
            {t(status.totpEnabled ? "security.disable" : "security.enable")}
          </button>
        )}

        {setup && (
          <div className="flex flex-col gap-3 mt-3">
            <p>{t("security.scan")}</p>
            <img src={setup.qr} alt={t("security.qrAlt")} width={200} height={200} />
            <code className="break-all select-all">{setup.secret}</code>
            <input
              className="input"
              value={code}
              autoComplete="one-time-code"
              inputMode="numeric"
              onChange={(event) => setCode(event.target.value)}
              aria-label={t("security.code")}
              placeholder={t("security.code")}
            />
            <div className="flex gap-3">
              <button
                className="btn-primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    const result = await securityRequest<{ recoveryCodes: string[] }>("/totp/confirm", {
                      challengeId: setup.challengeId,
                      code,
                    });
                    setRecovery(result.recoveryCodes);
                    setSetup(undefined);
                    setCode("");
                    setSuccess(t("security.updated"));
                    await load();
                  } catch {
                    setError(t("security.failed"));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t("security.confirm")}
              </button>
              <button
                className="btn-secondary"
                disabled={busy}
                onClick={() => {
                  setSetup(undefined);
                  setCode("");
                }}
              >
                {t("security.cancel")}
              </button>
            </div>
          </div>
        )}

        {status.totpEnabled && !recovery.length && (
          <button
            className="btn-secondary ml-3"
            disabled={busy}
            onClick={() =>
              void run(async (token) => {
                const result = await securityRequest<{ recoveryCodes: string[] }>("/recovery-codes", {
                  reauthToken: token,
                });
                setRecovery(result.recoveryCodes);
              })
            }
          >
            {t("security.newRecovery")}
          </button>
        )}

        {!!recovery.length && (
          <div className="mt-4" role="status">
            <p className="mb-3">{t("security.saveRecovery")}</p>
            <pre className="select-all whitespace-pre-wrap">{recovery.join("\n")}</pre>
            <button className="btn-secondary mt-3" onClick={() => setRecovery([])}>
              {t("security.saved")}
            </button>
          </div>
        )}
      </SettingBlock>

      {proofRequest && (
        <ReauthModal
          status={status}
          onSuccess={handleProofSuccess}
          onCancel={handleProofCancel}
        />
      )}
    </SettingsCard>
  );
}
