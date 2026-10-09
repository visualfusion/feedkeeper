import type { TFunction } from "i18next";
import { toast } from "./toast.ts";

export function reportFeedRefresh(result: { newItems: number; error: string | null; deferred?: boolean }, title: string, t: TFunction): void {
  if (result.deferred) toast.info(t("feeds.refreshPendingToast", { title }));
  else if (result.error) toast.error(t("feeds.refreshFailedToast", { title, error: result.error }));
  else toast.success(t("feeds.refreshedToast", { title, count: result.newItems }));
}

/** Shared by the feeds page, article refresh button and pull to refresh. */
export function reportAllRefresh(result: { refreshed: number; newItems: number; errors: number; deferred?: number }, t: TFunction): void {
  if (result.deferred) toast.info(t("feeds.refreshAllPendingToast", { count: result.deferred, newItems: result.newItems }));
  else if (!result.errors) toast.success(t("feeds.refreshedAllToast", { count: result.refreshed, newItems: result.newItems }));
  if (result.errors > 0) toast.error(t("feeds.failingCount", { count: result.errors }));
}
