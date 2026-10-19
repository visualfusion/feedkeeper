const OWNER_KEY = "fk_offline_owner";
let activeUserId: number | null = null;

/** Bind local data only after authentication; another tab changing accounts revokes this binding. */
export function setOfflineAccount(userId: number | null): void {
  activeUserId = userId;
  try {
    if (userId === null) localStorage.removeItem(OWNER_KEY);
    else localStorage.setItem(OWNER_KEY, String(userId));
    localStorage.removeItem("fk_offline_queue");
    localStorage.removeItem("fk_saved_synced_at");
  } catch {
    // Without persistent ownership, offline storage stays unavailable.
  }
}

export function offlineAccountId(): number | null {
  try {
    return activeUserId !== null && localStorage.getItem(OWNER_KEY) === String(activeUserId) ? activeUserId : null;
  } catch {
    return null;
  }
}
