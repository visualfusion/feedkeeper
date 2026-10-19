import { setOfflineAccount } from "./offlineAccount.ts";
import { updateBadge } from "./badge.ts";
import { clearQueue } from "./offlineQueue.ts";
import { cancelSync } from "./offlineSync.ts";
import { API_CACHE, OFFLINE_CACHE } from "./offlineStore.ts";

/** Register the service worker in production builds so the app starts without a connection. */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then(() => navigator.serviceWorker.ready)
      .then((registration) => {
        // Files loaded before the worker took over are not cached yet; hand them over.
        const urls = performance
          .getEntriesByType("resource")
          .map((entry) => new URL(entry.name))
          .filter((url) => url.origin === window.location.origin && url.pathname.startsWith("/assets/"))
          .map((url) => url.pathname);
        registration.active?.postMessage({ type: "cache-urls", urls });
      })
      .catch(() => undefined);
  });
}

/** Forget cached articles, account data and unsent changes, e.g. on logout from a shared device. */
export async function clearOfflineData(): Promise<void> {
  cancelSync();
  clearQueue();
  updateBadge(0);
  setOfflineAccount(null);
  if (!("caches" in window)) return;
  const names = await caches.keys();
  await Promise.all(names.filter(name => name === API_CACHE || name === OFFLINE_CACHE || name.startsWith(`${OFFLINE_CACHE}-`)).map(name => caches.delete(name)));
}
