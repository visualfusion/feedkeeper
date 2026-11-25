import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAudioPlayer } from "../contexts/AudioPlayerContext.tsx";
import { formatMediaDuration } from "./MediaPlayer.tsx";

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 2] as const;
const SLEEP_OPTIONS: Array<number | null> = [null, 15, 30, 60];

export function GlobalMiniPlayer() {
  const { t } = useTranslation();
  const player = useAudioPlayer();
  const [expanded, setExpanded] = useState(false);

  const item = player.currentItem;
  if (!item) return null;

  const dur = player.duration > 0 ? player.duration : (item.enclosure_duration_seconds ?? 0);
  const progressPct = dur > 0 ? Math.min(100, Math.max(0, (player.currentTime / dur) * 100)) : 0;

  return (
    <>
      <div
        role="region"
        aria-label={t("player.nowPlaying")}
        className="fixed bottom-[78px] md:bottom-4 left-3 right-3 md:left-auto md:right-6 md:w-[420px] z-40 rounded-2xl border border-[var(--c-border)] bg-[var(--c-surface)]/95 backdrop-blur-md shadow-xl overflow-hidden"
      >
        <div className="h-0.5 w-full bg-[var(--c-border)]">
          <div className="h-full bg-[var(--c-blue3)] transition-all duration-200" style={{ width: `${progressPct}%` }} />
        </div>
        <div className="flex items-center gap-3 px-3.5 py-2.5">
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="flex min-w-0 flex-1 items-center gap-3 text-left cursor-pointer"
          >
            {item.image_url ? (
              <img src={item.image_url} alt="" className="h-10 w-10 rounded-lg object-cover shrink-0 border border-[var(--c-border)]" />
            ) : (
              <div className="h-10 w-10 rounded-lg bg-[var(--c-surface-hover)] border border-[var(--c-border)] flex items-center justify-center shrink-0 text-[var(--c-text-muted)]">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
                  <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
                </svg>
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-[var(--c-text)]">{item.title}</div>
              <div className="truncate text-xs text-[var(--c-text-muted)]">
                {item.feed_title ?? ""}
                {dur > 0 ? ` · ${formatMediaDuration(player.currentTime)} / ${formatMediaDuration(dur)}` : ""}
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => player.skip(-15)}
            aria-label={t("player.back15")}
            className="hidden sm:flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-[var(--c-text-muted)] hover:bg-[var(--c-surface-hover)] hover:text-[var(--c-text)] cursor-pointer"
          >
            -15
          </button>
          <button
            type="button"
            onClick={() => player.togglePlay()}
            aria-label={player.isPlaying ? t("player.pause") : t("player.play")}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--c-blue3)] text-white hover:opacity-90 cursor-pointer"
          >
            {player.isPlaying ? (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
            ) : (
              <svg className="w-4 h-4 translate-x-0.5" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
            )}
          </button>
          <button
            type="button"
            onClick={() => player.stop()}
            aria-label={t("common.close")}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--c-text-muted)] hover:bg-[var(--c-surface-hover)] hover:text-[var(--c-text)] cursor-pointer"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
      </div>

      {expanded && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4"
          onClick={() => setExpanded(false)}
        >
          <div
            className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl border border-[var(--c-border)] bg-[var(--c-surface)] p-5 shadow-2xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--c-text-muted)]">{t("player.nowPlaying")}</span>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                aria-label={t("common.close")}
                className="h-8 w-8 rounded-full flex items-center justify-center text-[var(--c-text-muted)] hover:bg-[var(--c-surface-hover)] cursor-pointer"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>

            {item.image_url && (
              <div className="mb-4 flex justify-center">
                <img src={item.image_url} alt="" className="w-48 h-48 rounded-2xl object-cover border border-[var(--c-border)] shadow-md" />
              </div>
            )}

            <h2 className="text-lg font-bold text-[var(--c-text)] leading-snug text-center mb-1">{item.title}</h2>
            <p className="text-sm text-[var(--c-text-muted)] text-center mb-5">{item.feed_title}</p>

            {dur > 0 && (
              <div className="mb-4">
                <input
                  type="range"
                  min={0}
                  max={dur}
                  value={Math.min(player.currentTime, dur)}
                  onChange={(e) => player.seek(Number(e.target.value))}
                  className="w-full accent-[var(--c-blue3)] cursor-pointer"
                />
                <div className="flex justify-between text-xs font-mono text-[var(--c-text-muted)] mt-1">
                  <span>{formatMediaDuration(player.currentTime)}</span>
                  <span>{formatMediaDuration(dur)}</span>
                </div>
              </div>
            )}

            <div className="flex items-center justify-center gap-6 mb-5">
              <button type="button" onClick={() => player.skip(-15)} className="px-3 py-1.5 rounded-lg text-sm font-semibold text-[var(--c-text)] hover:bg-[var(--c-surface-hover)] cursor-pointer">
                -15s
              </button>
              <button
                type="button"
                onClick={() => player.togglePlay()}
                className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--c-blue3)] text-white hover:opacity-90 cursor-pointer"
              >
                {player.isPlaying ? (
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
                ) : (
                  <svg className="w-5 h-5 translate-x-0.5" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                )}
              </button>
              <button type="button" onClick={() => player.skip(30)} className="px-3 py-1.5 rounded-lg text-sm font-semibold text-[var(--c-text)] hover:bg-[var(--c-surface-hover)] cursor-pointer">
                +30s
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--c-border)] pt-4 mb-4">
              <div className="flex items-center gap-1">
                {SPEED_OPTIONS.map((rate) => (
                  <button
                    key={rate}
                    type="button"
                    onClick={() => player.setRate(rate)}
                    className={`rounded-md px-2 py-1 text-xs font-semibold cursor-pointer ${
                      player.playbackRate === rate
                        ? "bg-[var(--c-blue3)] text-white"
                        : "bg-[var(--c-surface-hover)] text-[var(--c-text-muted)] hover:text-[var(--c-text)]"
                    }`}
                  >
                    {rate}x
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1">
                {SLEEP_OPTIONS.map((mins) => {
                  const active = mins === null ? player.sleepRemainingSec === null : (player.sleepRemainingSec !== null && Math.ceil(player.sleepRemainingSec / 60) <= mins && Math.ceil(player.sleepRemainingSec / 60) > (mins === 15 ? 0 : mins === 30 ? 15 : 30));
                  return (
                    <button
                      key={String(mins)}
                      type="button"
                      onClick={() => player.setSleepTimer(mins)}
                      className={`rounded-md px-2 py-1 text-xs font-medium cursor-pointer ${
                        active
                          ? "bg-[var(--c-blue3)]/20 text-[var(--c-text)] border border-[var(--c-blue3)]/50"
                          : "bg-[var(--c-surface-hover)] text-[var(--c-text-muted)] hover:text-[var(--c-text)]"
                      }`}
                    >
                      {mins === null ? t("player.sleepOff") : `${mins}m`}
                    </button>
                  );
                })}
              </div>
            </div>

            {player.chapters.length > 0 && (
              <div className="border-t border-[var(--c-border)] pt-3">
                <div className="text-xs font-semibold uppercase tracking-[0.06em] text-[var(--c-text-muted)] mb-2">
                  {t("reader.chapters")}
                </div>
                <ul className="max-h-44 overflow-y-auto flex flex-col gap-1">
                  {player.chapters.map((chapter, idx) => (
                    <li key={`${chapter.startTime}-${idx}`}>
                      <button
                        type="button"
                        onClick={() => player.seek(chapter.startTime)}
                        className="w-full text-left px-2 py-1.5 rounded-lg text-sm hover:bg-[var(--c-surface-hover)] flex items-center gap-3 cursor-pointer"
                      >
                        <span className="font-mono text-xs text-[var(--c-text-muted)] shrink-0">{formatMediaDuration(chapter.startTime)}</span>
                        <span className="truncate text-[var(--c-text)]">{chapter.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
