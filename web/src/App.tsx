import { useEffect, useLayoutEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AuthProvider, useAuth } from "./auth/AuthContext.tsx";
import { Layout } from "./components/Layout.tsx";
import { OnboardingPage } from "./pages/OnboardingPage.tsx";
import { LoginPage } from "./pages/LoginPage.tsx";
import { FeedsPage } from "./pages/FeedsPage.tsx";
import { ItemsPage } from "./pages/ItemsPage.tsx";
import { SettingsPage } from "./pages/SettingsPage.tsx";
import { LoadingSpinner } from "./components/LoadingSpinner.tsx";
import { OfflineScreen } from "./components/Offline.tsx";
import { hideSplash, isSplashVisible } from "./utils/splash.ts";
import { EXTENSIONS_CHANGED } from "./extensions/host.ts";

function MetaSync() {
  const { t, i18n } = useTranslation();

  // Before anything else reacts to the new language: a host script reads the page's `lang` for its texts, so the
  // attribute is set first and the host is told to read its settings sections and links again.
  useLayoutEffect(() => {
    document.documentElement.lang = i18n.resolvedLanguage || "en";
    window.dispatchEvent(new Event(EXTENSIONS_CHANGED));
  }, [i18n.resolvedLanguage]);

  useEffect(() => {
    const title = t("common.metaTitle");
    const desc = t("common.metaDescription");

    document.title = title;

    const descMeta = document.querySelector('meta[name="description"]');
    if (descMeta) descMeta.setAttribute("content", desc);

    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) ogTitle.setAttribute("content", title);

    const ogDesc = document.querySelector('meta[property="og:description"]');
    if (ogDesc) ogDesc.setAttribute("content", desc);

    const twTitle = document.querySelector('meta[name="twitter:title"]');
    if (twTitle) twTitle.setAttribute("content", title);

    const twDesc = document.querySelector('meta[name="twitter:description"]');
    if (twDesc) twDesc.setAttribute("content", desc);
  }, [i18n.resolvedLanguage, t]);

  return null;
}

function Gate({ children }: { children: React.ReactNode }) {
  const { user, loading, needsOnboarding, unreachable } = useAuth();

  useEffect(() => {
    if (!loading) hideSplash();
  }, [loading]);

  if (loading) {
    // On first launch the static splash from index.html covers the session check.
    if (isSplashVisible()) return null;
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-[var(--c-bg)] z-50">
        <LoadingSpinner size="lg" center={false} />
      </div>
    );
  }
  if (unreachable) return <OfflineScreen />;
  if (needsOnboarding) return <OnboardingPage />;
  if (!user) return <LoginPage />;
  return <>{children}</>;
}

export default function App() {
  useEffect(() => {
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
  }, []);

  return (
    <BrowserRouter>
      <MetaSync />
      <AuthProvider>
        <Gate>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Navigate to="/items" replace />} />
              <Route path="/items" element={<ItemsPage />} />
              <Route path="/feeds" element={<FeedsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/items" replace />} />
            </Route>
          </Routes>
        </Gate>
      </AuthProvider>
    </BrowserRouter>
  );
}
