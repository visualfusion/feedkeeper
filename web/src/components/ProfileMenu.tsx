import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth/AuthContext.tsx";
import { getTheme, setTheme, subscribeTheme, type Theme } from "../utils/theme.ts";
import { currentInstallMode, promptInstall, subscribeInstallPrompt } from "../utils/installPrompt.ts";
import { UserAvatar } from "./UserAvatar.tsx";
import { FooterLinks } from "./FooterLinks.tsx";

const themeIcons: Record<Theme, ReactNode> = {
  light: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></>,
  dark: <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />,
  system: <><circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor" stroke="none" /></>,
};

const itemClass = "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium text-[var(--c-text)] transition-colors hover:bg-[var(--c-surface-hover)] focus-visible:outline-2 focus-visible:outline-[var(--c-blue3)] cursor-pointer";

/** Account menu bundling theme, settings, installation and logout; on mobile, settings stay in the tab bar. */
export function ProfileMenu({ onOpenShortcuts }: { onOpenShortcuts?: () => void }) {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const location = useLocation();
  const theme = useSyncExternalStore(subscribeTheme, getTheme);
  const installMode = useSyncExternalStore(subscribeInstallPrompt, currentInstallMode);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => setOpen(false), [location.pathname]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!user) return null;

  const themeLabels: Record<Theme, string> = {
    light: t("settings.themeLight"),
    dark: t("settings.themeDark"),
    system: t("settings.themeSystem"),
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={t("nav.account")}
        title={user.display_name || user.email}
        className={`flex rounded-full transition-shadow cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--c-blue3)] ${
          open || location.pathname.startsWith("/settings")
            ? "ring-2 ring-[var(--c-blue3)] ring-offset-2 ring-offset-[var(--c-surface)]"
            : "hover:ring-2 hover:ring-[var(--c-border)] hover:ring-offset-2 hover:ring-offset-[var(--c-surface)]"
        }`}
      >
        <UserAvatar user={user} className="h-9 w-9 text-xs" />
      </button>

      {open && (
        <div
          id={panelId}
          className="card animate-fade-in absolute right-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] p-1.5 shadow-xl"
          style={{ boxShadow: "0 16px 40px -12px rgba(0, 0, 0, 0.35)" }}
        >
          <div className="flex items-center gap-3 px-3 pt-2 pb-3">
            <UserAvatar user={user} className="h-10 w-10 text-sm" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-[var(--c-text)]">{user.display_name || user.email}</p>
              {user.display_name && <p className="truncate text-xs text-[var(--c-text-muted)]">{user.email}</p>}
            </div>
          </div>

          <div className="border-t border-[var(--c-border)] px-3 py-3">
            <p className="mb-2 text-xs font-semibold tracking-[0.08em] uppercase text-[var(--c-text-muted)]">{t("settings.theme")}</p>
            <div className="grid grid-cols-3 gap-1 rounded-xl border border-[var(--c-border)] p-0.5" role="group" aria-label={t("settings.theme")}>
              {(Object.keys(themeIcons) as Theme[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setTheme(option)}
                  aria-pressed={theme === option}
                  className={`flex h-8 items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--c-blue3)] ${
                    theme === option
                      ? "border border-[var(--c-mobile-nav-active-border)] bg-[var(--c-mobile-nav-active)] text-[var(--c-text)] shadow-sm"
                      : "text-[var(--c-text-muted)] hover:text-[var(--c-text)]"
                  }`}
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{themeIcons[option]}</svg>
                  {themeLabels[option]}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col border-t border-[var(--c-border)] pt-1.5">
            <NavLink to="/settings" className={`${itemClass} max-md:hidden`}>
              <svg className="h-4 w-4 text-[var(--c-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
              {t("nav.settings")}
            </NavLink>
            {onOpenShortcuts && (
              <button
                type="button"
                className={`${itemClass} hidden md:flex justify-between`}
                onClick={() => { setOpen(false); onOpenShortcuts(); }}
              >
                <span className="flex items-center gap-3">
                  <svg className="h-4 w-4 text-[var(--c-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" /></svg>
                  {t("shortcuts.title")}
                </span>
                <kbd className="rounded border border-[var(--c-border)] bg-[var(--c-surface-hover)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--c-text-muted)]">?</kbd>
              </button>
            )}
            {installMode === "prompt" && (
              <button type="button" className={itemClass} onClick={() => { setOpen(false); void promptInstall(); }}>
                <svg className="h-4 w-4 text-[var(--c-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5" /><path d="M5 21h14" /></svg>
                {t("settings.installApp")}
              </button>
            )}
            <button
              type="button"
              className={`${itemClass} text-[var(--c-danger)]! hover:bg-[var(--c-danger-bg)]!`}
              onClick={() => { setOpen(false); void logout(); }}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
              {t("nav.logout")}
            </button>
          </div>
          <FooterLinks placement="menu" />
        </div>
      )}
    </div>
  );
}
