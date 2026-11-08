import { useEffect } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { BrandLockup } from "./BrandLockup.tsx";
import { DesktopNav } from "./DesktopNav.tsx";
import { ProfileMenu } from "./ProfileMenu.tsx";
import { OfflineBanner } from "./Offline.tsx";
import { Toaster } from "./Toaster.tsx";
import { resetItemsScrollY } from "../utils/scrollState.ts";
import { onItemsChanged, refreshBadge } from "../utils/badge.ts";
import { syncNow } from "../utils/offlineSync.ts";

export function Layout() {
  const { t } = useTranslation();
  const location = useLocation();

  // Send changes made offline and keep articles available offline: on start, when the app returns to the foreground and when the connection comes back.
  useEffect(() => {
    const sync = () => void syncNow();
    const onVisible = () => document.visibilityState === "visible" && sync();
    sync();
    window.addEventListener("online", sync);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", sync);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // The app icon shows how many articles are unread.
  useEffect(() => {
    let timer: number | undefined;
    const refresh = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void refreshBadge(), 800);
    };
    const onVisible = () => document.visibilityState === "visible" && refresh();
    refresh();
    const interval = window.setInterval(refresh, 2 * 60 * 1000);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", onVisible);
    const stop = onItemsChanged(refresh);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", onVisible);
      stop();
    };
  }, []);

  // Scroll to top when switching to non-article pages
  useEffect(() => {
    if (location.pathname !== "/items") {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      requestAnimationFrame(() => {
        window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      });
    }
  }, [location.pathname]);

  const handleItemsClick = () => {
    if (location.pathname === "/items") {
      resetItemsScrollY();
      window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
    }
  };

  const getActiveTabIndex = () => {
    if (location.pathname.startsWith("/feeds")) return 1;
    if (location.pathname.startsWith("/settings")) return 2;
    return 0; // /items or default
  };
  const activeTabIndex = getActiveTabIndex();

  return (
    <div className="min-h-screen flex flex-col">
      <header
        data-app-header
        className="sticky top-0 z-30 backdrop-blur-md border-b"
        style={{
          borderColor: "var(--c-border)",
          backgroundColor: "color-mix(in srgb, var(--c-surface) 85%, transparent)",
          paddingTop: "env(safe-area-inset-top, 0px)",
        }}
      >
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <NavLink
            to="/items"
            onClick={handleItemsClick}
            className="flex items-center gap-2.5 shrink-0 hover:opacity-85 transition-opacity"
          >
            <BrandLockup size={28} />
          </NavLink>

          <div className="flex items-center gap-3">
            <DesktopNav onItemsClick={handleItemsClick} />
            <ProfileMenu />
          </div>
        </div>
      </header>

      <OfflineBanner />

      {/* Main content with bottom padding for mobile tab bar */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 pt-4 pb-24 md:py-6">
        <div key={location.pathname} className="animate-page-fade">
          <Outlet />
        </div>
      </main>

      <Toaster />

      {/* Apple-style Floating Liquid Glass Tab Bar for Mobile */}
      <nav
        className="mobile-bottom-nav md:hidden fixed left-3 right-3 max-w-sm mx-auto z-40 pointer-events-auto no-drag select-none"
        aria-label={t("nav.menu")}
      >
        <div
          className="relative flex items-center justify-between p-1.5 rounded-full border backdrop-blur-2xl backdrop-saturate-180 transition-all duration-300 no-drag select-none"
          style={{
            backgroundColor: "color-mix(in srgb, var(--c-surface) 80%, transparent)",
            borderColor: "var(--c-border)",
            borderWidth: "1px",
            // Stays within the 12px gap to the screen edge so the shadow is not clipped.
            boxShadow: "0 2px 12px -4px rgba(0, 0, 0, 0.3)",
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {/* Sliding active indicator */}
          <div
            aria-hidden="true"
            className="absolute top-1.5 bottom-1.5 left-1.5 rounded-full bg-[var(--c-mobile-nav-active)] border border-[var(--c-mobile-nav-active-border)] shadow-sm transition-transform duration-300 ease-[cubic-bezier(0.25,1,0.5,1)] pointer-events-none no-drag"
            style={{
              width: "calc((100% - 0.75rem) / 3)",
              transform: `translateX(calc(${activeTabIndex} * 100%))`,
            }}
          />

          {/* Tab: Articles */}
          <NavLink
            to="/items"
            onClick={handleItemsClick}
            draggable={false}
            onDragStart={(e) => e.preventDefault()}
            onContextMenu={(e) => e.preventDefault()}
            className="relative z-10 flex-1 min-w-0 no-drag select-none"
          >
            {({ isActive }) => (
              <div
                className={`h-[54px] w-full rounded-full flex flex-col items-center justify-center gap-0.5 transition-colors duration-200 cursor-pointer no-drag select-none ${
                  isActive
                    ? "text-[var(--c-text)] font-semibold"
                    : "text-[var(--c-text-muted)] hover:text-[var(--c-text)] font-medium"
                }`}
              >
                <svg
                  className={`w-5 h-5 transition-transform duration-200 pointer-events-none ${isActive ? "scale-105" : ""}`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 6h16M4 12h16M4 18h12" />
                </svg>
                <span className="text-[11px] leading-tight tracking-tight pointer-events-none select-none">{t("nav.items")}</span>
              </div>
            )}
          </NavLink>

          {/* Tab: Feeds */}
          <NavLink
            to="/feeds"
            draggable={false}
            onDragStart={(e) => e.preventDefault()}
            onContextMenu={(e) => e.preventDefault()}
            className="relative z-10 flex-1 min-w-0 no-drag select-none"
          >
            {({ isActive }) => (
              <div
                className={`h-[54px] w-full rounded-full flex flex-col items-center justify-center gap-0.5 transition-colors duration-200 cursor-pointer no-drag select-none ${
                  isActive
                    ? "text-[var(--c-text)] font-semibold"
                    : "text-[var(--c-text-muted)] hover:text-[var(--c-text)] font-medium"
                }`}
              >
                <svg
                  className={`w-5 h-5 transition-transform duration-200 pointer-events-none ${isActive ? "scale-105" : ""}`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 11a9 9 0 0 1 9 9" />
                  <path d="M4 4a16 16 0 0 1 16 16" />
                  <circle cx="5" cy="19" r="1" />
                </svg>
                <span className="text-[11px] leading-tight tracking-tight pointer-events-none select-none">{t("nav.feeds")}</span>
              </div>
            )}
          </NavLink>

          {/* Tab: Settings */}
          <NavLink
            to="/settings"
            draggable={false}
            onDragStart={(e) => e.preventDefault()}
            onContextMenu={(e) => e.preventDefault()}
            className="relative z-10 flex-1 min-w-0 no-drag select-none"
          >
            {({ isActive }) => (
              <div
                className={`h-[54px] w-full rounded-full flex flex-col items-center justify-center gap-0.5 transition-colors duration-200 cursor-pointer no-drag select-none ${
                  isActive
                    ? "text-[var(--c-text)] font-semibold"
                    : "text-[var(--c-text-muted)] hover:text-[var(--c-text)] font-medium"
                }`}
              >
                <svg
                  className={`w-5 h-5 transition-transform duration-200 pointer-events-none ${isActive ? "scale-105" : ""}`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
                <span className="text-[11px] leading-tight tracking-tight pointer-events-none select-none">{t("nav.settings")}</span>
              </div>
            )}
          </NavLink>
        </div>
      </nav>
    </div>
  );
}
