import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.ts";
import { useAuth } from "../../auth/AuthContext.tsx";
import { CloseIcon } from "../feeds/icons.tsx";

/**
 * A short introduction for every account, shown once after the first feeds are in: where the views, the filter, the
 * star and the folders are. Closing it (on any device) is remembered with the account, including for older accounts.
 */
export function Intro() {
  const { t } = useTranslation();
  const { user, setCurrentUser } = useAuth();
  const [closing, setClosing] = useState(false);
  if (!user || user.intro_dismissed_at) return null;

  async function close() {
    setClosing(true);
    try {
      setCurrentUser(await api.dismissIntro());
    } catch {
      // Not saved: it shows again next time, which is better than losing the hint silently.
      setClosing(false);
    }
  }

  const points: Array<{ key: string; className?: string }> = [
    { key: "views", className: "hidden sm:block" },
    { key: "unread" },
    { key: "star" },
    { key: "folders" },
  ];

  return (
    <section className="card animate-fade-in flex flex-col gap-3 p-4 sm:p-5" aria-labelledby="intro-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="intro-title" className="text-base font-semibold">{t("intro.title")}</h2>
          <p className="text-sm text-[var(--c-text-muted)]">{t("intro.subtitle")}</p>
        </div>
        <button type="button" onClick={close} disabled={closing} aria-label={t("common.close")} className="shrink-0 rounded-lg p-1 text-[var(--c-text-muted)] hover:bg-[var(--c-surface-hover)] hover:text-[var(--c-text)] cursor-pointer">
          <CloseIcon />
        </button>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {points.map((point) => (
          <li key={point.key} className={point.className}>
            <p className="text-sm font-medium">{t(`intro.${point.key}Title`)}</p>
            <p className="text-sm text-[var(--c-text-muted)]">{t(`intro.${point.key}Text`)}</p>
          </li>
        ))}
      </ul>
      <button type="button" onClick={close} disabled={closing} className="btn-primary self-start">{t("intro.done")}</button>
    </section>
  );
}
