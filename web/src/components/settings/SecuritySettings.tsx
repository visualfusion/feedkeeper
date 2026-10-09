import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import QRCode from "qrcode";
import { passkeyProof, registerPasskey, securityRequest } from "../../api/security.ts";
import { SettingsCard, SettingBlock } from "./ui.tsx";
interface SecurityStatus { totpEnabled: boolean; passkeysEnabled: boolean; emailReauthEnabled?: boolean; recoveryCodesRemaining: number; passkeys: { id: string; name: string; created_at: string }[] }
export function SecuritySettings() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<SecurityStatus>();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [usePasskey, setUsePasskey] = useState(false);
  const [emailCode, setEmailCode] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [setup, setSetup] = useState<{ challengeId: string; secret: string; qr: string }>();
  const [recovery, setRecovery] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async () => setStatus(await securityRequest<SecurityStatus>("/", undefined, "GET"));
  useEffect(() => { void load().catch(() => setError(t("security.failed"))); }, [t]);
  async function run(action: () => Promise<void>, clear = true) {
    setBusy(true); setError("");
    try { await action(); await load(); setPassword(""); setCode(""); setEmailCode(""); if (clear) setEmailSent(false); }
    catch (failure) { setError(t(failure instanceof Error && failure.message === "last_passkey" ? "security.lastPasskey" : "security.failed")); }
    finally { setBusy(false); }
  }
  async function proof() {
    if (usePasskey) return passkeyProof();
    const result = await securityRequest<{ reauthToken: string }>(emailSent ? "/reauth/email/confirm" : "/reauth", { password, code, emailCode });
    return result.reauthToken;
  }
  if (!status) return error ? <p role="alert">{error}</p> : null;
  return <SettingsCard title={t("security.title")} description={t("security.intro")}>
    <SettingBlock>
      <p className="text-sm mb-3">{t("security.reauth")}</p>
      {!!status.passkeys.length && <label className="flex gap-2 mb-3"><input type="checkbox" checked={usePasskey} onChange={event => setUsePasskey(event.target.checked)} />{t("security.usePasskey")}</label>}
      {!usePasskey && <div className="flex flex-col gap-3">
        {!emailSent && <input className="input" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} aria-label={t("security.password")} placeholder={t("security.password")} />}
        {status.totpEnabled && <input className="input" autoComplete="one-time-code" value={code} onChange={event => setCode(event.target.value)} aria-label={t("security.code")} placeholder={t("security.code")} />}
        {status.emailReauthEnabled && !emailSent && <button className="btn-secondary self-start" disabled={busy} onClick={() => void run(async () => { await securityRequest("/reauth/email", {}); setEmailSent(true); }, false)}>{t("security.sendEmail")}</button>}
        {emailSent && <input className="input" autoComplete="one-time-code" value={emailCode} onChange={event => setEmailCode(event.target.value)} aria-label={t("security.emailCode")} placeholder={t("security.emailCode")} />}
      </div>}
    </SettingBlock>
    <SettingBlock>
      <h3 className="font-semibold mb-3">{t("security.passkeys")}</h3>
      {status.passkeys.map(key => <div key={key.id} className="flex justify-between items-center gap-3 mb-2"><span>{key.name}</span><button className="btn-secondary" disabled={busy} onClick={() => void run(async () => { await securityRequest(`/passkeys/${encodeURIComponent(key.id)}`, { reauthToken: await proof() }, "DELETE"); })}>{t("security.remove")}</button></div>)}
      {status.passkeysEnabled ? <div className="flex flex-wrap gap-3"><input className="input sm:max-w-sm" value={name} maxLength={100} onChange={event => setName(event.target.value)} aria-label={t("security.passkeyName")} placeholder={t("security.passkeyName")} /><button className="btn-primary" disabled={busy || !name.trim()} onClick={() => void run(async () => { await registerPasskey(await proof(), name); setName(""); })}>{t("security.addPasskey")}</button></div> : <p>{t("security.httpsRequired")}</p>}
    </SettingBlock>
    <SettingBlock>
      <h3 className="font-semibold mb-3">{t("security.twoFactor")}</h3>
      <p className="text-sm mb-3">{t(status.totpEnabled ? "security.enabled" : "security.disabled")}</p>
      <p className="text-sm mb-3">{t("security.revocationHint")}</p>
      {!setup && <button className="btn-secondary" disabled={busy || recovery.length > 0} onClick={() => void run(async () => {
        const reauthToken = await proof();
        if (status.totpEnabled) { await securityRequest("/totp/disable", { reauthToken }); }
        else { const result = await securityRequest<{ challengeId: string; secret: string; uri: string }>("/totp/setup", { reauthToken }); setSetup({ ...result, qr: await QRCode.toDataURL(result.uri) }); }
      })}>{t(status.totpEnabled ? "security.disable" : "security.enable")}</button>}
      {setup && <div className="flex flex-col gap-3 mt-3"><p>{t("security.scan")}</p><img src={setup.qr} alt={t("security.qrAlt")} width={200} height={200} /><code className="break-all select-all">{setup.secret}</code><input className="input" value={code} autoComplete="one-time-code" inputMode="numeric" onChange={event => setCode(event.target.value)} aria-label={t("security.code")} placeholder={t("security.code")} /><div className="flex gap-3"><button className="btn-primary" disabled={busy} onClick={() => void run(async () => { const result = await securityRequest<{ recoveryCodes: string[] }>("/totp/confirm", { challengeId: setup.challengeId, code }); setRecovery(result.recoveryCodes); setSetup(undefined); })}>{t("security.confirm")}</button><button className="btn-secondary" disabled={busy} onClick={() => { setSetup(undefined); setCode(""); }}>{t("security.cancel")}</button></div></div>}
      {status.totpEnabled && !recovery.length && <button className="btn-secondary ml-3" disabled={busy} onClick={() => void run(async () => { const result = await securityRequest<{ recoveryCodes: string[] }>("/recovery-codes", { reauthToken: await proof() }); setRecovery(result.recoveryCodes); })}>{t("security.newRecovery")}</button>}
      {!!recovery.length && <div className="mt-4" role="status"><p className="mb-3">{t("security.saveRecovery")}</p><pre className="select-all whitespace-pre-wrap">{recovery.join("\n")}</pre><button className="btn-secondary mt-3" onClick={() => setRecovery([])}>{t("security.saved")}</button></div>}
      {error && <p role="alert" className="text-danger mt-3">{error}</p>}
    </SettingBlock>
  </SettingsCard>;
}
