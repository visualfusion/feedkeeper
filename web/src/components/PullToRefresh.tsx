import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

const TRIGGER_DISTANCE = 68;
const MAX_DISTANCE = 92;
// Pulls may start on links and card buttons (newspaper cards are one big button);
// only fields where touches mean typing or selecting are left alone.
const IGNORED_TARGETS = "input, select, textarea, [contenteditable='true'], [data-no-pull]";

/** Swallow the click a browser may still fire after a drag that started on a button or link. */
function suppressNextClick() {
  const swallow = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  window.addEventListener("click", swallow, { capture: true, once: true });
  window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 400);
}

export function PullToRefresh({
  children,
  disabled = false,
  onRefresh,
}: {
  children: ReactNode;
  disabled?: boolean;
  onRefresh: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const distanceRef = useRef(0);
  const [distance, setDistance] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);

  const startRefresh = useCallback(() => {
    if (refreshing) return;
    setFailed(false);
    setRefreshing(true);
    setDistance(56);
    void onRefresh()
      .catch(() => setFailed(true))
      .finally(() => {
        setRefreshing(false);
        setDistance(0);
      });
  }, [refreshing, onRefresh]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let start: { x: number; y: number } | null = null;

    function reset() {
      start = null;
      distanceRef.current = 0;
      setDragging(false);
      setDistance(0);
    }

    function onTouchStart(event: TouchEvent) {
      if (disabled || refreshing || event.touches.length !== 1 || window.scrollY > 1 ||
          !window.matchMedia("(any-pointer: coarse)").matches ||
          document.body.style.overflow === "hidden" ||
          (event.target as Element).closest(IGNORED_TARGETS)) return;
      start = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    }

    function onTouchMove(event: TouchEvent) {
      if (!start || event.touches.length !== 1) return;
      const dx = event.touches[0].clientX - start.x;
      const dy = event.touches[0].clientY - start.y;
      if (window.scrollY > 1 || Math.abs(dx) > Math.abs(dy)) {
        reset();
        return;
      }
      if (dy <= 0) {
        distanceRef.current = 0;
        setDistance(0);
        return;
      }
      event.preventDefault();
      const next = Math.min(MAX_DISTANCE, dy * 0.72);
      distanceRef.current = next;
      setDragging(true);
      setDistance(next);
    }

    function onTouchEnd() {
      if (!start) return;
      const ready = distanceRef.current >= TRIGGER_DISTANCE;
      if (distanceRef.current > 8) suppressNextClick();
      reset();
      if (ready) startRefresh();
    }

    root.addEventListener("touchstart", onTouchStart, { passive: true });
    root.addEventListener("touchmove", onTouchMove, { passive: false });
    root.addEventListener("touchend", onTouchEnd);
    root.addEventListener("touchcancel", reset);
    return () => {
      root.removeEventListener("touchstart", onTouchStart);
      root.removeEventListener("touchmove", onTouchMove);
      root.removeEventListener("touchend", onTouchEnd);
      root.removeEventListener("touchcancel", reset);
    };
  }, [disabled, refreshing, onRefresh, startRefresh]);

  const progress = refreshing ? 1 : Math.min(1, distance / TRIGGER_DISTANCE);

  return (
    <div ref={rootRef}>
      <button
        type="button"
        // Keyboard and screen-reader access on phones; larger screens show a visible refresh button.
        className="sr-only focus:not-sr-only sm:hidden"
        onClick={startRefresh}
        disabled={disabled || refreshing}
      >
        {t("items.refresh")}
      </button>
      <div
        aria-hidden="true"
        className="relative flex items-center justify-center overflow-hidden"
        style={{ height: distance, transition: dragging ? "none" : "height 220ms ease-out" }}
      >
        <div
          className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--c-border)] bg-[var(--c-surface)] text-[var(--c-text)] shadow-sm"
          style={{ opacity: Math.min(1, distance / 30), transform: `scale(${0.65 + progress * 0.35})` }}
        >
          <svg
            className={`h-5 w-5 ${refreshing ? "animate-spin motion-reduce:animate-none" : ""}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={refreshing ? undefined : { transform: `rotate(${progress * 270}deg)` }}
          >
            <path d="M18 7a8 8 0 1 0 2 5" pathLength="100" strokeDasharray={`${progress * 100} 100`} />
            <path d="M18 3v4h-4" opacity={progress} />
          </svg>
        </div>
      </div>
      {refreshing && <span className="sr-only" role="status">{t("items.refreshing")}</span>}
      {failed && <p className="mb-3 text-center text-sm text-[var(--c-danger)]" role="alert">{t("items.refreshFailed")}</p>}
      {children}
    </div>
  );
}
