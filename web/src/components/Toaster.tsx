import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { dismissToast, getToasts, subscribeToasts } from "../utils/toast.ts";

/** Renders toasts above the mobile tab bar; announced politely to screen readers. */
export function Toaster() {
  const { t } = useTranslation();
  const toasts = useSyncExternalStore(subscribeToasts, getToasts);

  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[calc(6.5rem+env(safe-area-inset-bottom,0px))] z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6">
      {toasts.map((item) => (
        <div
          key={item.id}
          role={item.type === "error" ? "alert" : "status"}
          className="card animate-fade-in pointer-events-auto flex w-full max-w-md items-start gap-3 px-4 py-3 text-sm"
          style={{ boxShadow: "0 16px 40px -12px rgba(0, 0, 0, 0.35)" }}
        >
          <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white ${item.type === "error" ? "bg-[var(--c-danger)]" : item.type === "info" ? "bg-[var(--c-text-muted)]" : "bg-[var(--c-green3)]"}`} aria-hidden="true">
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              {item.type === "error" ? <path d="M12 7v6M12 17h.01" /> : item.type === "info" ? <path d="M12 7h.01M12 11v6" /> : <path d="m5 12 5 5 9-10" />}
            </svg>
          </span>
          <p className="min-w-0 flex-1 text-[var(--c-text)]">{item.message}</p>
          <button type="button" onClick={() => dismissToast(item.id)} aria-label={t("common.close")} className="-mr-1 shrink-0 rounded p-0.5 text-[var(--c-text-muted)] hover:text-[var(--c-text)] cursor-pointer">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
      ))}
    </div>
  );
}
