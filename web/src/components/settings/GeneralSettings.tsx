import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "../LanguageSwitcher.tsx";
import { currentInstallMode, promptInstall, subscribeInstallPrompt } from "../../utils/installPrompt.ts";
import { getTheme, setTheme, subscribeTheme, type Theme } from "../../utils/theme.ts";
import { offlineEnabled, offlineItems, readSnapshot, setOfflineEnabled } from "../../utils/offlineStore.ts";
import { removeOfflineCopy, syncOfflineCopy } from "../../utils/offlineSync.ts";
import { disablePush, enablePush, pushStatus, type PushStatus } from "../../utils/push.ts";
import { api } from "../../api/client.ts";
import { toast } from "../../utils/toast.ts";
import { SettingsCard, SettingRow, Toggle } from "./ui.tsx";

function ThemeSwitch() {
  const { t } = useTranslation();
  const theme = useSyncExternalStore(subscribeTheme, getTheme);
  const options: { value: Theme; label: string }[] = [
    { value: "light", label: t("settings.themeLight") },
    { value: "dark", label: t("settings.themeDark") },
    { value: "system", label: t("settings.themeSystem") },
  ];

  return (
    <div className="grid grid-cols-3 gap-1 rounded-xl border border-[var(--c-border)] p-0.5" role="group" aria-label={t("settings.theme")}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => setTheme(option.value)}
          aria-pressed={theme === option.value}
          className={`h-8 rounded-lg px-3 text-sm font-medium transition-colors cursor-pointer ${
            theme === option.value
              ? "border border-[var(--c-mobile-nav-active-border)] bg-[var(--c-mobile-nav-active)] text-[var(--c-text)] shadow-sm"
              : "text-[var(--c-text-muted)] hover:text-[var(--c-text)]"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function InstallRow() {
  const { t } = useTranslation();
  const mode = useSyncExternalStore(subscribeInstallPrompt, currentInstallMode);
  if (mode === "installed" || mode === "unsupported") return null;

  return (
    <SettingRow
      label={t("settings.installApp")}
      hint={mode === "ios" ? t("settings.installAppIos") : mode === "mac-safari" ? t("settings.installAppMacSafari") : t("settings.installAppHint")}
    >
      {mode === "prompt" && (
        <button type="button" onClick={() => void promptInstall()} className="btn-primary whitespace-nowrap">{t("settings.installAppButton")}</button>
      )}
    </SettingRow>
  );
}

function NotificationsRow() {
  const { t, i18n } = useTranslation();
  const installMode = useSyncExternalStore(subscribeInstallPrompt, currentInstallMode);
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void pushStatus().then(setStatus).catch(() => setStatus("unsupported"));
  }, []);

  if (status === null) return <SettingRow label={t("settings.notifications")} />;
  if (status === "unsupported") {
    // iPhones and iPads only deliver notifications to apps on the home screen.
    const hint = installMode === "ios" ? t("settings.notificationsIos") : t("settings.notificationsUnsupported");
    return <SettingRow label={t("settings.notifications")} hint={hint} />;
  }

  async function onChange(checked: boolean) {
    setBusy(true);
    try {
      if (checked) setStatus(await enablePush());
      else {
        await disablePush();
        setStatus("off");
      }
    } catch {
      toast.error(t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    try {
      const { delivered } = await api.sendTestPush(i18n.resolvedLanguage ?? "en");
      if (delivered === 0) toast.error(t("settings.notificationsTestFailed"));
    } catch {
      toast.error(t("common.error"));
    }
  }

  return (
    <SettingRow
      label={t("settings.notifications")}
      hint={status === "blocked" ? t("settings.notificationsBlocked") : t("settings.notificationsHint")}
      htmlFor="notifications-toggle"
      inline
    >
      <div className="flex items-center gap-3">
        {status === "on" && <button type="button" onClick={() => void sendTest()} className="btn-secondary px-3 py-1.5 text-sm">{t("settings.notificationsTest")}</button>}
        <Toggle id="notifications-toggle" label={t("settings.notifications")} checked={status === "on"} onChange={(checked) => !busy && status !== "blocked" && void onChange(checked)} />
      </div>
    </SettingRow>
  );
}

function OfflineRow() {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(offlineEnabled);
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    void readSnapshot().then((snapshot) => setCount(snapshot ? offlineItems(snapshot).length : null));
  }, [enabled]);

  async function onChange(checked: boolean) {
    setEnabled(checked);
    setOfflineEnabled(checked);
    if (!checked) {
      await removeOfflineCopy();
      setCount(null);
      return;
    }
    const stored = await syncOfflineCopy({ force: true });
    if (stored !== null) setCount(stored);
  }

  return (
    <SettingRow
      label={t("settings.offlineSaved")}
      hint={`${t("settings.offlineSavedHint")}${enabled && count !== null ? ` ${t("settings.offlineSavedCount", { count })}` : ""}`}
      htmlFor="offline-saved-toggle"
      inline
    >
      <Toggle id="offline-saved-toggle" label={t("settings.offlineSaved")} checked={enabled} onChange={(checked) => void onChange(checked)} />
    </SettingRow>
  );
}

export function GeneralSettings() {
  const { t } = useTranslation();
  const [autoReaderMode, setAutoReaderMode] = useState(() => localStorage.getItem("feedkeeper_auto_reader_mode") !== "false");

  return (
    <div className="flex flex-col gap-5">
      <SettingsCard title={t("settings.appearanceTitle")}>
        <SettingRow label={t("settings.theme")} hint={t("settings.themeHint")}>
          <ThemeSwitch />
        </SettingRow>
        <SettingRow label={t("settings.language")} hint={t("settings.languageHint")}>
          <LanguageSwitcher />
        </SettingRow>
      </SettingsCard>

      <SettingsCard title={t("settings.readingTitle")}>
        <SettingRow label={t("settings.autoReaderMode")} hint={t("settings.autoReaderModeHint")} htmlFor="auto-reader-toggle" inline>
          <Toggle
            id="auto-reader-toggle"
            label={t("settings.autoReaderMode")}
            checked={autoReaderMode}
            onChange={(checked) => {
              setAutoReaderMode(checked);
              localStorage.setItem("feedkeeper_auto_reader_mode", checked ? "true" : "false");
            }}
          />
        </SettingRow>
        <OfflineRow />
        <NotificationsRow />
        <InstallRow />
      </SettingsCard>
    </div>
  );
}
