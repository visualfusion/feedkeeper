import { useState, useEffect, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { passkeyLogin, securityRequest } from "../api/security.ts";
import { ApiError, api } from "../api/client.ts";
import { useAuth } from "../auth/AuthContext.tsx";
import { ExtensionMount } from "../components/settings/ExtensionMount.tsx";
import { FooterLinks } from "../components/FooterLinks.tsx";
import { resolveLoginForm } from "../extensions/host.ts";
import { useExtensions } from "../extensions/useExtensions.ts";
import { BrandLockup } from "../components/BrandLockup.tsx";

export function LoginPage() {
  const { t } = useTranslation();
  const { refresh } = useAuth();
  const [email, setEmail] = useState("");
  const [challengeId, setChallengeId] = useState<string>();
  const [code, setCode] = useState("");
  const [passkeys, setPasskeys] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showGithubLink, setShowGithubLink] = useState(true);
  const [githubUrl, setGithubUrl] = useState("https://github.com/visualfusion/feedkeeper");
  const hostForm = resolveLoginForm(useExtensions());

  useEffect(() => {
    void securityRequest<{ passkeys: boolean }>("/config", undefined, "GET").then(result => setPasskeys(result.passkeys)).catch(() => {});
    api
      .getConfig()
      .then((cfg) => {
        if (cfg) {
          setShowGithubLink(cfg.showGithubLink);
          if (cfg.githubUrl) setGithubUrl(cfg.githubUrl);
        }
      })
      .catch(() => {
        // Fall back to default
      });
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (challengeId) await securityRequest("/mfa", { challengeId, code });
      else await api.login(email, password);
      await finished();
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === "mfa_required") {
        setChallengeId((failure.data as { challengeId: string }).challengeId); setPassword("");
      } else setError(t("login.error"));
    } finally {
      setSubmitting(false);
    }
  }

  async function finished() {
    const next = new URLSearchParams(window.location.search).get("next");
    if (next?.startsWith("/oauth/authorize?")) window.location.assign(next);
    else await refresh();
  }
  async function withPasskey() {
    setSubmitting(true); setError(null);
    try { await passkeyLogin(); await finished(); }
    catch { setError(t("login.error")); }
    finally { setSubmitting(false); }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4">
      <div className="card p-8 w-full max-w-sm">
        <div className="flex flex-col items-center mb-6 text-center">
          <h1 className="mb-3">
            <BrandLockup size={44} />
          </h1>
          <p className="text-xs mt-1" style={{ color: "var(--c-text-muted)" }}>
            {t("login.subtitle")}
          </p>
        </div>
        {hostForm ? (
          <ExtensionMount name="login-form" mount={hostForm.mount} />
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            {!challengeId && <><div>
              <label className="text-sm font-medium block mb-1">{t("login.emailLabel")}</label>
              <input
                type="email"
                required
                autoFocus
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium block mb-1">{t("login.passwordLabel")}</label>
              <input
                type="password"
                required
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            </>}
            {challengeId && <><label htmlFor="mfa-code">{t("security.code")}</label><input id="mfa-code" className="input" autoFocus autoComplete="one-time-code" value={code} onChange={event => setCode(event.target.value)} required /><button type="button" className="btn-secondary" onClick={() => { setChallengeId(undefined); setCode(""); }}>{t("security.cancel")}</button></>}
            {passkeys && !challengeId && <button type="button" className="btn-secondary" disabled={submitting} onClick={() => void withPasskey()}>{t("security.signInPasskey")}</button>}
            {error && <p className="text-sm text-danger">{error}</p>}
            <button type="submit" disabled={submitting} className="btn-primary">
              {t("login.submit")}
            </button>
          </form>
        )}
      </div>

      <FooterLinks placement="login" />

      {showGithubLink && (
        <div className="mt-4 text-center">
          <a
            href={githubUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-[var(--c-text-muted)] hover:text-[var(--c-text)] transition-colors opacity-80 hover:opacity-100"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
              <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
              />
            </svg>
            <span>{t("login.viewOnGithub")}</span>
          </a>
        </div>
      )}
    </div>
  );
}
