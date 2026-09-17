import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth/AuthContext.tsx";
import { LanguageSwitcher } from "./LanguageSwitcher.tsx";
import { ThemeToggle } from "./ThemeToggle.tsx";

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-2 rounded-lg text-sm font-medium ${
    isActive ? "bg-[var(--c-blue1)] text-white" : "text-[var(--c-text-muted)] hover:text-[var(--c-text)]"
  }`;

export function Layout() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  const navLinks = (
    <>
      <NavLink to="/feeds" className={navLinkClass} onClick={() => setMenuOpen(false)}>
        {t("nav.feeds")}
      </NavLink>
      <NavLink to="/items" className={navLinkClass} onClick={() => setMenuOpen(false)}>
        {t("nav.items")}
      </NavLink>
      <NavLink to="/settings" className={navLinkClass} onClick={() => setMenuOpen(false)}>
        {t("nav.settings")}
      </NavLink>
    </>
  );

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b" style={{ borderColor: "var(--c-border)" }}>
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-6 min-w-0">
            <span className="font-semibold text-lg shrink-0" style={{ fontFamily: "Manrope, sans-serif" }}>
              {t("common.appName")}
            </span>
            <nav className="hidden md:flex gap-1">{navLinks}</nav>
          </div>

          <div className="hidden md:flex items-center gap-3">
            <LanguageSwitcher />
            <ThemeToggle />
            {user && (
              <button onClick={() => logout()} className="btn-secondary text-sm">
                {t("nav.logout")}
              </button>
            )}
          </div>

          <button
            className="md:hidden btn-secondary w-9 h-9 px-0 flex items-center justify-center shrink-0"
            aria-label={t("nav.menu")}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? "✕" : "☰"}
          </button>
        </div>

        {menuOpen && (
          <div className="md:hidden border-t px-4 py-4 flex flex-col gap-4" style={{ borderColor: "var(--c-border)" }}>
            <nav className="flex flex-col gap-1">{navLinks}</nav>
            <div className="flex items-center gap-3 pt-3 border-t" style={{ borderColor: "var(--c-border)" }}>
              <LanguageSwitcher />
              <ThemeToggle />
            </div>
            {user && (
              <button
                onClick={() => {
                  setMenuOpen(false);
                  logout();
                }}
                className="btn-secondary text-sm w-full"
              >
                {t("nav.logout")}
              </button>
            )}
          </div>
        )}
      </header>
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
