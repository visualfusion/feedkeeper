import { useAuth } from "../auth/AuthContext.tsx";

export interface PlanLimits {
  /** Whether the account may add feeds, import them and have them updated. Self-hosted accounts always may. */
  syncAllowed: boolean;
  /** Where the account's plan can be changed, when the server says so. */
  manageUrl: string | null;
}

/**
 * What the account's plan allows. A server without plans sends no capabilities (everything is allowed); one that does
 * sends a feature map in which `sync` must be true, the same rule the server enforces.
 */
export function usePlanLimits(): PlanLimits {
  const { user } = useAuth();
  const capabilities = user?.capabilities;
  return { syncAllowed: !capabilities || capabilities.features.sync === true, manageUrl: capabilities?.manageUrl ?? null };
}
