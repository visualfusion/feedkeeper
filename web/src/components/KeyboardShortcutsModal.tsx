import { useEffect, useId } from "react";
import { useTranslation } from "react-i18next";
import { SHORTCUT_GROUPS } from "../utils/keyboard.ts";

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function Keycap({ label }: { label: string }) {
  return (
    <kbd className="inline-flex min-w-7 items-center justify-center rounded-md border border-[var(--c-border)] bg-[var(--c-surface-hover)] px-2 py-0.5 font-sans text-xs font-semibold text-[var(--c-text)] shadow-xs">
      {label}
    </kbd>
  );
}

export function KeyboardShortcutsModal({ isOpen, onClose }: KeyboardShortcutsModalProps) {
  const { t } = useTranslation();
  const titleId = useId();

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      data-shortcuts-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-fade-in"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="card w-full max-w-2xl max-h-[85vh] overflow-y-auto p-5 sm:p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-[var(--c-border)] pb-4">
          <div>
            <h2 id={titleId} className="text-lg font-semibold text-[var(--c-text)]">
              {t("shortcuts.title")}
            </h2>
            <p className="mt-1 text-sm text-[var(--c-text-muted)]">{t("shortcuts.subtitle")}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            title={t("common.close")}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--c-border)] text-[var(--c-text-muted)] transition-colors hover:bg-[var(--c-surface-hover)] hover:text-[var(--c-text)] cursor-pointer"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="mt-5 grid gap-6 sm:grid-cols-2">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.titleKey}>
              <h3 className="mb-2.5 text-xs font-semibold tracking-[0.08em] uppercase text-[var(--c-text-muted)]">
                {t(group.titleKey)}
              </h3>
              <ul className="divide-y divide-[var(--c-border)]">
                {group.entries.map((entry) => (
                  <li key={`${group.titleKey}:${entry.labelKey}`} className="flex items-center justify-between gap-3 py-2">
                    <span className="text-sm text-[var(--c-text)]">{t(entry.labelKey)}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {entry.keys.map((key, index) =>
                        entry.keys.length > 1 && key === "/" ? (
                          <span key={`${index}-${key}`} className="px-0.5 text-xs text-[var(--c-text-muted)]">
                            /
                          </span>
                        ) : (
                          <Keycap key={`${index}-${key}`} label={key} />
                        ),
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
