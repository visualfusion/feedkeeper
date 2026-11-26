import { useState } from "react";
import { useTranslation } from "react-i18next";
import { type Feed, type Item } from "../api/client.ts";
import { useAudioPlayer } from "../contexts/AudioPlayerContext.tsx";
import { formatMediaDuration } from "./MediaPlayer.tsx";
import { formatRelativeTime } from "../utils/relativeTime.ts";

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": "\"",
  "&#39;": "'",
};

function plainDescription(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, " ")
    .replace(/&(amp|lt|gt|quot|#39);/g, (entity) => HTML_ENTITIES[entity] ?? entity)
    .replace(/\s+/g, " ")
    .trim();
}

export function MediaShowHeader({ feed }: { feed: Feed }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const title = feed.label?.trim() || feed.title?.trim() || feed.url;
  const cover = feed.artwork_url || `/api/feeds/${feed.id}/icon`;
  const description = feed.description ? plainDescription(feed.description) : "";

  return (
    <div className="mb-6 flex items-start gap-4 rounded-2xl border border-[var(--c-border)] bg-[var(--c-surface)] p-4 sm:p-5">
      <img
        src={cover}
        alt=""
        className="h-20 w-20 sm:h-24 sm:w-24 rounded-xl object-cover shrink-0 border border-[var(--c-border)] bg-[var(--c-bg)]"
      />
      <div className="min-w-0 flex-1">
        <h2 className="text-lg sm:text-xl font-bold text-[var(--c-text)] leading-snug">{title}</h2>
        {description && (
          <>
            <p className={`mt-1.5 text-sm text-[var(--c-text-muted)] ${expanded ? "" : "line-clamp-2"}`}>
              {description}
            </p>
            {description.length > 140 && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="mt-1 text-xs font-medium text-[var(--c-blue3)] hover:underline cursor-pointer"
              >
                {expanded ? t("common.showLess") : t("common.showMore")}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function progressRatio(item: Item, activeTime?: number, activeDur?: number): number {
  const dur = activeDur && activeDur > 0 ? activeDur : (item.enclosure_duration_seconds ?? 0);
  if (dur <= 0) return 0;
  const pos = activeTime !== undefined
    ? activeTime
    : (item.media_position && !item.media_position.completed ? item.media_position.positionSeconds : 0);
  return Math.min(1, Math.max(0, pos / dur));
}

export function PodcastEpisodeList({
  feed,
  items,
  focusedItemId,
  onOpen,
  onBookmark,
  onRead,
}: {
  feed?: Feed;
  items: Item[];
  focusedItemId: number | null;
  onOpen: (item: Item) => void;
  onBookmark: (item: Item) => void;
  onRead: (item: Item) => void;
}) {
  const { t, i18n } = useTranslation();
  const audioPlayer = useAudioPlayer();

  return (
    <ul className="flex flex-col gap-3 animate-page-fade">
      {items.map((item) => {
        const isCurrent = audioPlayer.currentItem?.id === item.id;
        const isPlaying = isCurrent && audioPlayer.isPlaying;
        const dur = isCurrent && audioPlayer.duration > 0 ? audioPlayer.duration : (item.enclosure_duration_seconds ?? 0);
        const pos = isCurrent
          ? audioPlayer.currentTime
          : (item.media_position && !item.media_position.completed ? item.media_position.positionSeconds : 0);
        const ratio = progressRatio(item, isCurrent ? audioPlayer.currentTime : undefined, isCurrent ? audioPlayer.duration : undefined);
        const pubDate = item.published_at ? new Date(item.published_at) : null;
        const isFocused = focusedItemId === item.id;

        return (
          <li
            key={item.id}
            data-item-id={item.id}
            onClick={() => onOpen(item)}
            className={`card flex items-center gap-3.5 p-3.5 sm:p-4 transition-colors hover:bg-[var(--c-surface-hover)] hover:border-[var(--c-blue3)]/60 cursor-pointer ${
              isFocused ? "ring-2 ring-[var(--c-blue3)] border-[var(--c-blue3)] bg-[var(--c-surface-hover)]" : ""
            }`}
            style={{ opacity: item.read ? 0.65 : 1 }}
          >
            {item.enclosure_url && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  audioPlayer.togglePlay(item);
                }}
                aria-label={isPlaying ? t("player.pause") : t("player.play")}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--c-blue3)] text-white hover:opacity-90 cursor-pointer"
              >
                {isPlaying ? (
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
                ) : (
                  <svg className="w-4 h-4 translate-x-0.5" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                )}
              </button>
            )}

            {(item.image_url || feed?.artwork_url || item.feed_id) && (
              <img
                src={item.image_url || feed?.artwork_url || `/api/feeds/${item.feed_id}/icon`}
                alt=""
                className="h-12 w-12 rounded-lg object-cover shrink-0 border border-[var(--c-border)] bg-[var(--c-bg)]"
                loading="lazy"
              />
            )}

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-xs text-[var(--c-text-muted)] mb-0.5">
                {pubDate && <span>{formatRelativeTime(pubDate, i18n.resolvedLanguage)}</span>}
                {dur > 0 && (
                  <>
                    <span>·</span>
                    <span className="font-mono">
                      {pos > 5 && dur > pos
                        ? t("player.timeRemaining", { time: formatMediaDuration(dur - pos) })
                        : formatMediaDuration(dur)}
                    </span>
                  </>
                )}
              </div>
              <h3 className="text-sm sm:text-base font-semibold text-[var(--c-text)] line-clamp-2">{item.title}</h3>
              {ratio > 0 && (
                <div className="mt-2 h-1 w-full max-w-xs rounded-full bg-[var(--c-border)] overflow-hidden">
                  <div className="h-full bg-[var(--c-blue3)]" style={{ width: `${ratio * 100}%` }} />
                </div>
              )}
            </div>

            <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={() => onBookmark(item)}
                aria-label={t("items.bookmark")}
                className={`p-1.5 rounded-lg hover:bg-[var(--c-surface-hover)] cursor-pointer ${item.bookmarked ? "text-amber-500" : "text-[var(--c-text-muted)]"}`}
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill={item.bookmarked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => onRead(item)}
                aria-label={item.read ? t("items.markUnread") : t("items.markRead")}
                className="p-1.5 rounded-lg text-[var(--c-text-muted)] hover:bg-[var(--c-surface-hover)] cursor-pointer"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill={item.read ? "none" : "currentColor"} stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="6" />
                </svg>
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function VideoFeedGrid({
  items,
  focusedItemId,
  onOpen,
  onBookmark,
}: {
  items: Item[];
  focusedItemId: number | null;
  onOpen: (item: Item) => void;
  onBookmark: (item: Item) => void;
}) {
  const { t, i18n } = useTranslation();

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5 animate-page-fade">
      {items.map((item) => {
        const pubDate = item.published_at ? new Date(item.published_at) : null;
        const dur = item.enclosure_duration_seconds ?? 0;
        const ratio = progressRatio(item);
        const isFocused = focusedItemId === item.id;

        return (
          <article
            key={item.id}
            data-item-id={item.id}
            onClick={() => onOpen(item)}
            className={`card overflow-hidden flex flex-col cursor-pointer transition-colors hover:border-[var(--c-blue3)]/60 ${
              isFocused ? "ring-2 ring-[var(--c-blue3)] border-[var(--c-blue3)]" : ""
            }`}
            style={{ opacity: item.read ? 0.65 : 1 }}
          >
            <div className="relative aspect-video w-full bg-black overflow-hidden">
              {item.image_url ? (
                <img src={item.image_url} alt="" className="w-full h-full object-cover" loading="lazy" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-white/60">
                  <svg className="w-10 h-10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                </div>
              )}
              {dur > 0 && (
                <span className="absolute bottom-2 right-2 rounded-md bg-black/80 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-white">
                  {formatMediaDuration(dur)}
                </span>
              )}
              {ratio > 0 && (
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/25">
                  <div className="h-full bg-[var(--c-blue3)]" style={{ width: `${ratio * 100}%` }} />
                </div>
              )}
            </div>
            <div className="p-3.5 flex-1 flex flex-col justify-between gap-2">
              <h3 className="text-sm font-semibold text-[var(--c-text)] line-clamp-2 leading-snug min-h-[2.45rem]">{item.title}</h3>
              <div className="flex items-center justify-between text-xs text-[var(--c-text-muted)]">
                <span>{pubDate ? formatRelativeTime(pubDate, i18n.resolvedLanguage) : ""}</span>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onBookmark(item); }}
                  aria-label={t("items.bookmark")}
                  className={`p-1 rounded hover:bg-[var(--c-surface-hover)] cursor-pointer ${item.bookmarked ? "text-amber-500" : ""}`}
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill={item.bookmarked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                </button>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
