import { useState, type ReactNode } from "react";
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

  // The icons are the ones the controls themselves use, so the card shows what to look for.
  const points: Array<{ key: string; icon: ReactNode; solid?: boolean; className?: string }> = [
    {
      key: "views",
      className: "hidden sm:flex",
      icon: (
        <>
          <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2" />
          <path d="M18 14h-8" />
          <path d="M15 18h-5" />
          <path d="M10 6h8v4h-8V6Z" />
        </>
      ),
    },
    { key: "unread", solid: true, icon: <circle cx="12" cy="12" r="9" /> },
    { key: "star", icon: <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /> },
    { key: "folders", icon: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /> },
  ];

  return (
    <section className="card animate-fade-in flex flex-col gap-5 p-5 sm:p-7 shadow-xs" aria-labelledby="intro-title">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="intro-title" className="text-xl sm:text-2xl font-bold tracking-tight text-[var(--c-text)]" style={{ fontFamily: "Manrope, sans-serif" }}>
            {t("intro.title")}
          </h2>
          <p className="mt-0.5 text-xs sm:text-sm leading-relaxed text-[var(--c-text-muted)]">{t("intro.subtitle")}</p>
        </div>
        <button type="button" onClick={close} disabled={closing} aria-label={t("common.close")} className="shrink-0 rounded-lg p-1 text-[var(--c-text-muted)] hover:bg-[var(--c-surface-hover)] hover:text-[var(--c-text)] cursor-pointer">
          <CloseIcon />
        </button>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {points.map((point) => (
          <li
            key={point.key}
            className={`flex items-start gap-3.5 rounded-2xl border border-[var(--c-border)]/80 bg-[var(--c-surface-hover)]/25 p-4 ${point.className ?? ""}`}
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--c-border)] bg-[var(--c-surface)] text-[var(--c-text)]">
              <svg
                className={point.solid ? "h-3.5 w-3.5" : "h-4 w-4"}
                viewBox="0 0 24 24"
                fill={point.solid ? "currentColor" : "none"}
                stroke="currentColor"
                strokeWidth={point.solid ? 2.2 : 2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                {point.icon}
              </svg>
            </div>
            <div className="min-w-0">
              <h3 className="text-sm sm:text-base font-bold text-[var(--c-text)]" style={{ fontFamily: "Manrope, sans-serif" }}>
                {t(`intro.${point.key}Title`)}
              </h3>
              <p className="mt-0.5 text-xs sm:text-sm leading-relaxed text-[var(--c-text-muted)]">{t(`intro.${point.key}Text`)}</p>
            </div>
          </li>
        ))}
      </ul>
      <button type="button" onClick={close} disabled={closing} className="btn-primary self-start">{t("intro.done")}</button>
    </section>
  );
}
