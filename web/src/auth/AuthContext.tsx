import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ApiError, type User } from "../api/client.ts";

interface AuthState {
  user: User | null;
  loading: boolean;
  needsOnboarding: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const status = await api.onboardingStatus();
      if (status.needsOnboarding) {
        setNeedsOnboarding(true);
        setUser(null);
        return;
      }
      setNeedsOnboarding(false);
      try {
        setUser(await api.me());
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          setUser(null);
        } else {
          throw error;
        }
      }
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    await api.logout();
    setUser(null);
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, needsOnboarding, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
