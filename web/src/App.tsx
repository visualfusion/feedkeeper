import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext.tsx";
import { Layout } from "./components/Layout.tsx";
import { OnboardingPage } from "./pages/OnboardingPage.tsx";
import { LoginPage } from "./pages/LoginPage.tsx";
import { FeedsPage } from "./pages/FeedsPage.tsx";
import { ItemsPage } from "./pages/ItemsPage.tsx";
import { SettingsPage } from "./pages/SettingsPage.tsx";

function Gate({ children }: { children: React.ReactNode }) {
  const { user, loading, needsOnboarding } = useAuth();

  if (loading) return null;
  if (needsOnboarding) return <OnboardingPage />;
  if (!user) return <LoginPage />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Gate>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Navigate to="/feeds" replace />} />
              <Route path="/feeds" element={<FeedsPage />} />
              <Route path="/items" element={<ItemsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/feeds" replace />} />
            </Route>
          </Routes>
        </Gate>
      </AuthProvider>
    </BrowserRouter>
  );
}
