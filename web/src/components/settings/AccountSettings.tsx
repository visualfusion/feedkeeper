import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { resolvePasswordCard } from "../../extensions/host.ts";
import { useExtensions } from "../../extensions/useExtensions.ts";
import { api, ApiError } from "../../api/client.ts";
import { useAuth } from "../../auth/AuthContext.tsx";
import { prepareAvatar } from "../../utils/avatarImage.ts";
import { UserAvatar } from "../UserAvatar.tsx";
import { ExtensionMount } from "./ExtensionMount.tsx";
import { SettingsCard, SettingBlock, SettingRow, Status, type StatusMessage } from "./ui.tsx";

import { SecuritySettings } from "./SecuritySettings.tsx";

function ProfileCard() {
  const { t } = useTranslation();
  const { user, setCurrentUser } = useAuth();
  const [displayName, setDisplayName] = useState(user?.display_name ?? "");
  const [savingName, setSavingName] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<StatusMessage>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!user) return null;
  const trimmedName = displayName.trim();

  async function onSaveName(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    setSavingName(true);
    try {
      const updated = await api.updateProfile(trimmedName);
      setCurrentUser(updated);
      setDisplayName(updated.display_name);
      setMessage({ type: "success", text: t("settings.profileSaved") });
    } catch {
      setMessage({ type: "error", text: t("common.error") });
    } finally {
      setSavingName(false);
    }
  }

  async function onPhotoSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setMessage(null);
    setUploading(true);
    try {
      setCurrentUser(await api.uploadAvatar(await prepareAvatar(file)));
    } catch (error) {
      setMessage({ type: "error", text: error instanceof ApiError ? t("common.error") : t("settings.avatarUnreadable") });
    } finally {
      setUploading(false);
    }
  }

  async function onRemovePhoto() {
    setMessage(null);
    setUploading(true);
    try {
      setCurrentUser(await api.deleteAvatar());
    } catch {
      setMessage({ type: "error", text: t("common.error") });
    } finally {
      setUploading(false);
    }
  }

  return (
    <SettingsCard title={t("settings.profileTitle")}>
      <SettingBlock>
        <div className="flex items-center gap-4">
          <UserAvatar user={user} className={`h-16 w-16 text-xl transition-opacity ${uploading ? "opacity-50" : ""}`} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{user.display_name || user.email}</p>
            <p className="truncate text-sm text-[var(--c-text-muted)]">{user.email}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className="btn-secondary px-3 py-1.5 text-sm" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
                {user.avatar_updated_at ? t("settings.avatarChange") : t("settings.avatarUpload")}
              </button>
              {user.avatar_updated_at && (
                <button type="button" className="btn-secondary px-3 py-1.5 text-sm text-danger" disabled={uploading} onClick={onRemovePhoto}>
                  {t("settings.avatarRemove")}
                </button>
              )}
            </div>
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onPhotoSelected} />
        </div>
        <p className="mt-3 text-xs text-[var(--c-text-muted)]">{t("settings.avatarHint")}</p>
      </SettingBlock>

      <form onSubmit={onSaveName}>
        <SettingRow label={t("settings.displayNameLabel")} htmlFor="profile-name" stacked>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <input id="profile-name" className="input sm:max-w-sm" required maxLength={100} autoComplete="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            <button type="submit" disabled={savingName || !trimmedName || trimmedName === user.display_name} className="btn-primary self-start">
              {t("common.save")}
            </button>
          </div>
          <div className="mt-2"><Status message={message} /></div>
        </SettingRow>
      </form>
    </SettingsCard>
  );
}

function PasswordCard() {
  const { t } = useTranslation();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState<StatusMessage>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (newPassword !== confirmPassword) {
      setMessage({ type: "error", text: t("settings.passwordMismatch") });
      return;
    }
    setSubmitting(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setMessage({ type: "success", text: t("settings.passwordChanged") });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (error) {
      setMessage({ type: "error", text: error instanceof ApiError && error.status === 401 ? t("settings.incorrectPassword") : t("common.error") });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <SettingsCard
        title={t("settings.changePasswordTitle")}
        description={t("settings.passwordHint")}
        footer={
          <>
            <Status message={message} />
            <button type="submit" disabled={submitting} className="btn-primary">{t("settings.changePasswordButton")}</button>
          </>
        }
      >
        <SettingBlock>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <input type="password" required autoComplete="current-password" placeholder={t("settings.currentPasswordLabel")} aria-label={t("settings.currentPasswordLabel")} className="input" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
            <input type="password" required minLength={10} autoComplete="new-password" placeholder={t("settings.newPasswordLabel")} aria-label={t("settings.newPasswordLabel")} className="input" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            <input type="password" required minLength={10} autoComplete="new-password" placeholder={t("settings.confirmPasswordLabel")} aria-label={t("settings.confirmPasswordLabel")} className="input" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
          </div>
        </SettingBlock>
      </SettingsCard>
    </form>
  );
}

/** The host's password card where it asks to replace it (for example for accounts without a password), else the built-in one. */
function PasswordSection() {
  const { user } = useAuth();
  const hostCard = resolvePasswordCard(useExtensions());
  const [replaced, setReplaced] = useState<boolean | null>(null);
  useEffect(() => {
    let current = true;
    setReplaced(null);
    if (!hostCard || !user) return;
    Promise.resolve(hostCard.applies ? hostCard.applies({ id: user.id, email: user.email, display_name: user.display_name ?? null }) : true)
      .then((value) => { if (current) setReplaced(value === true); })
      .catch(() => { if (current) setReplaced(false); });
    return () => { current = false; };
    // The functions identify the host's card; resolving builds a new object on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostCard?.mount, hostCard?.applies, user?.id]);
  if (!hostCard) return <PasswordCard />;
  if (replaced === null) return null;
  return replaced ? <ExtensionMount name="password-card" mount={hostCard.mount} /> : <PasswordCard />;
}

export function AccountSettings() {
  return (
    <div className="flex flex-col gap-5">
      <ProfileCard />
      <PasswordSection />
      <SecuritySettings />
    </div>
  );
}
