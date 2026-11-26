import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type Item, type PodcastChapter } from "../api/client";
import { useAudioPlayer } from "../contexts/AudioPlayerContext.tsx";

export function formatMediaDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

export function youtubeVideoId(rawUrl?: string | null): string | null {
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    const host = parsed.hostname.toLowerCase();
    const parts = parsed.pathname.split("/").filter(Boolean);
    let candidate: string | null = null;
    if (host === "youtu.be") {
      candidate = parts[0] ?? null;
    } else if (
      host === "youtube.com" ||
      host === "www.youtube.com" ||
      host === "m.youtube.com" ||
      host === "music.youtube.com" ||
      host === "youtube-nocookie.com" ||
      host === "www.youtube-nocookie.com"
    ) {
      if (parsed.pathname === "/watch") {
        candidate = parsed.searchParams.get("v");
      } else if (parts.length >= 2 && ["embed", "shorts", "live", "v"].includes(parts[0])) {
        candidate = parts[1];
      }
    }
    return candidate && /^[A-Za-z0-9_-]{6,32}$/.test(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

export function MediaPlayer({ item }: { item: Item }) {
  const { t } = useTranslation();
  const audioPlayer = useAudioPlayer();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [chapters, setChapters] = useState<PodcastChapter[]>([]);
  const [youtubePlaying, setYoutubePlaying] = useState(false);
  const restoredForItemRef = useRef<number | null>(null);
  const lastSavedAtRef = useRef<number>(0);

  const isVideo = item.enclosure_type?.toLowerCase().startsWith("video/") ?? false;
  const ytId = !item.enclosure_url ? youtubeVideoId(item.link) : null;

  useEffect(() => {
    setYoutubePlaying(false);
  }, [item.id]);

  useEffect(() => {
    let active = true;
    setChapters([]);
    restoredForItemRef.current = null;
    lastSavedAtRef.current = 0;
    if (!item.chapters_url || !isVideo) return;
    api.itemChapters(item.id)
      .then((res) => {
        if (active) setChapters(res.chapters);
      })
      .catch(() => {
        if (active) setChapters([]);
      });
    return () => {
      active = false;
    };
  }, [item.id, item.chapters_url, isVideo]);

  if (ytId) {
    const thumb = item.image_url && !/^https?:\/\/(?:www\.)?youtube\.com\/v\//i.test(item.image_url)
      ? item.image_url
      : `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`;
    return (
      <div className="mb-6 rounded-xl border border-[var(--c-border)] bg-black overflow-hidden aspect-video relative">
        {youtubePlaying ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${ytId}?autoplay=1&rel=0`}
            title={item.title ?? "YouTube Video"}
            className="w-full h-full border-0"
            referrerPolicy="strict-origin-when-cross-origin"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        ) : (
          <button
            type="button"
            onClick={() => setYoutubePlaying(true)}
            aria-label={t("player.play")}
            className="group relative w-full h-full block cursor-pointer"
          >
            <img src={thumb} alt="" className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200" />
            <span className="absolute inset-0 bg-black/20 group-hover:bg-black/30 transition-colors flex items-center justify-center">
              <span className="w-16 h-16 rounded-full bg-black/60 backdrop-blur-md border border-white/25 text-white flex items-center justify-center shadow-lg group-hover:scale-105 transition-transform">
                <svg className="w-7 h-7 translate-x-0.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <polygon points="6 4 20 12 6 20 6 4" />
                </svg>
              </span>
            </span>
          </button>
        )}
      </div>
    );
  }

  if (!item.enclosure_url) return null;

  if (!isVideo) {
    const isCurrent = audioPlayer.currentItem?.id === item.id;
    const isPlaying = isCurrent && audioPlayer.isPlaying;
    const dur = isCurrent && audioPlayer.duration > 0 ? audioPlayer.duration : (item.enclosure_duration_seconds ?? 0);
    const current = isCurrent
      ? audioPlayer.currentTime
      : (item.media_position && !item.media_position.completed ? item.media_position.positionSeconds : 0);
    const activeChapters = isCurrent ? audioPlayer.chapters : chapters;

    return (
      <div className="mb-6 rounded-xl border border-[var(--c-border)] bg-[var(--c-surface)] p-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => audioPlayer.togglePlay(item)}
            aria-label={isPlaying ? t("player.pause") : t("player.play")}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--c-blue3)] text-white hover:opacity-90 cursor-pointer"
          >
            {isPlaying ? (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
            ) : (
              <svg className="w-4 h-4 translate-x-0.5" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
            )}
          </button>
          <div className="min-w-0 flex-1">
            {dur > 0 ? (
              <>
                <input
                  type="range"
                  min={0}
                  max={dur}
                  value={Math.min(current, dur)}
                  onChange={(e) => {
                    if (!isCurrent) audioPlayer.playItem(item);
                    audioPlayer.seek(Number(e.target.value));
                  }}
                  className="w-full accent-[var(--c-blue3)] cursor-pointer"
                />
                <div className="flex justify-between text-xs font-mono text-[var(--c-text-muted)]">
                  <span>{formatMediaDuration(current)}</span>
                  <span>{formatMediaDuration(dur)}</span>
                </div>
              </>
            ) : (
              <span className="text-sm text-[var(--c-text-muted)]">{t("player.play")}</span>
            )}
          </div>
          {isCurrent && (
            <button
              type="button"
              onClick={() => audioPlayer.skip(30)}
              className="rounded-lg px-2 py-1 text-xs font-semibold text-[var(--c-text-muted)] hover:bg-[var(--c-surface-hover)] hover:text-[var(--c-text)] cursor-pointer"
            >
              +30s
            </button>
          )}
        </div>

        {activeChapters.length > 0 && (
          <div className="mt-3 pt-3 border-t border-[var(--c-border)]/60">
            <div className="text-xs font-semibold uppercase tracking-[0.06em] text-[var(--c-text-muted)] mb-2">
              {t("reader.chapters")}
            </div>
            <ul className="max-h-48 overflow-y-auto flex flex-col gap-1">
              {activeChapters.map((chapter, idx) => (
                <li key={`${chapter.startTime}-${idx}`}>
                  <button
                    type="button"
                    onClick={() => {
                      if (!isCurrent) audioPlayer.playItem(item);
                      audioPlayer.seek(chapter.startTime);
                    }}
                    className="w-full text-left px-2 py-1.5 rounded-lg text-sm hover:bg-[var(--c-surface-hover)] flex items-center gap-3 transition-colors cursor-pointer"
                  >
                    <span className="font-mono text-xs text-[var(--c-text-muted)] shrink-0">
                      {formatMediaDuration(chapter.startTime)}
                    </span>
                    <span className="truncate text-[var(--c-text)]">{chapter.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  const syncPosition = (media: HTMLMediaElement, completed = false) => {
    const duration = Number.isFinite(media.duration) && media.duration > 0 ? Math.round(media.duration) : item.enclosure_duration_seconds ?? null;
    const pos = completed ? 0 : Math.max(0, Math.round(media.currentTime));
    lastSavedAtRef.current = Date.now();
    void api.setMediaPosition(item.id, {
      positionSeconds: pos,
      durationSeconds: duration,
      completed,
      updatedAt: new Date().toISOString(),
    }).catch(() => {});
  };

  const handleLoadedMetadata = (media: HTMLMediaElement) => {
    if (restoredForItemRef.current === item.id) return;
    restoredForItemRef.current = item.id;
    const saved = item.media_position;
    if (saved && !saved.completed && saved.positionSeconds > 0 && (!Number.isFinite(media.duration) || saved.positionSeconds < media.duration - 2)) {
      media.currentTime = saved.positionSeconds;
    }
  };

  const handleTimeUpdate = (media: HTMLMediaElement) => {
    if (media.paused || Date.now() - lastSavedAtRef.current < 10_000) return;
    syncPosition(media, false);
  };

  const seekTo = (seconds: number) => {
    const media = videoRef.current;
    if (!media) return;
    media.currentTime = seconds;
    void media.play().catch(() => {});
  };

  return (
    <div className="mb-6 rounded-xl border border-[var(--c-border)] bg-[var(--c-surface)] p-4">
      <video
        ref={videoRef}
        controls
        preload="metadata"
        src={item.enclosure_url}
        onLoadedMetadata={(e) => handleLoadedMetadata(e.currentTarget)}
        onTimeUpdate={(e) => handleTimeUpdate(e.currentTarget)}
        onPause={(e) => syncPosition(e.currentTarget, false)}
        onEnded={(e) => syncPosition(e.currentTarget, true)}
        className="w-full rounded-lg max-h-96 bg-black"
      />

      {chapters.length > 0 && (
        <div className="mt-3 pt-3 border-t border-[var(--c-border)]/60">
          <div className="text-xs font-semibold uppercase tracking-[0.06em] text-[var(--c-text-muted)] mb-2">
            {t("reader.chapters")}
          </div>
          <ul className="max-h-48 overflow-y-auto flex flex-col gap-1">
            {chapters.map((chapter, idx) => (
              <li key={`${chapter.startTime}-${idx}`}>
                <button
                  type="button"
                  onClick={() => seekTo(chapter.startTime)}
                  className="w-full text-left px-2 py-1.5 rounded-lg text-sm hover:bg-[var(--c-surface-hover)] flex items-center gap-3 transition-colors cursor-pointer"
                >
                  <span className="font-mono text-xs text-[var(--c-text-muted)] shrink-0">
                    {formatMediaDuration(chapter.startTime)}
                  </span>
                  <span className="truncate text-[var(--c-text)]">{chapter.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
