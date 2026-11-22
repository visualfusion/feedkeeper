import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type Item, type PodcastChapter } from "../api/client";

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

export function MediaPlayer({ item }: { item: Item }) {
  const { t } = useTranslation();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [chapters, setChapters] = useState<PodcastChapter[]>([]);

  useEffect(() => {
    let active = true;
    setChapters([]);
    if (!item.chapters_url) return;
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
  }, [item.id, item.chapters_url]);

  if (!item.enclosure_url) return null;

  const isVideo = item.enclosure_type?.toLowerCase().startsWith("video/") ?? false;

  const seekTo = (seconds: number) => {
    const media = isVideo ? videoRef.current : audioRef.current;
    if (!media) return;
    media.currentTime = seconds;
    void media.play().catch(() => {});
  };

  return (
    <div className="mb-6 rounded-xl border border-[var(--c-border)] bg-[var(--c-surface)] p-4">
      {isVideo ? (
        <video
          ref={videoRef}
          controls
          preload="metadata"
          src={item.enclosure_url}
          className="w-full rounded-lg max-h-96 bg-black"
        />
      ) : (
        <audio
          ref={audioRef}
          controls
          preload="metadata"
          src={item.enclosure_url}
          className="w-full"
        />
      )}

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
