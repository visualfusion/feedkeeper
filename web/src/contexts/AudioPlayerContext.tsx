import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api, type Item, type PodcastChapter } from "../api/client.ts";

interface AudioPlayerContextValue {
  currentItem: Item | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
  sleepRemainingSec: number | null;
  chapters: PodcastChapter[];
  playItem: (item: Item) => void;
  togglePlay: (item?: Item) => void;
  seek: (seconds: number) => void;
  skip: (deltaSeconds: number) => void;
  setRate: (rate: number) => void;
  setSleepTimer: (minutes: number | null) => void;
  stop: () => void;
}

const AudioPlayerContext = createContext<AudioPlayerContextValue | null>(null);

export function AudioPlayerProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [currentItem, setCurrentItem] = useState<Item | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [sleepRemainingSec, setSleepRemainingSec] = useState<number | null>(null);
  const [chapters, setChapters] = useState<PodcastChapter[]>([]);

  const lastSyncedAtRef = useRef(0);
  const currentItemRef = useRef<Item | null>(null);
  currentItemRef.current = currentItem;
  const playbackRateRef = useRef(playbackRate);
  playbackRateRef.current = playbackRate;

  const syncPosition = useCallback((item: Item, pos: number, dur: number, completed: boolean) => {
    lastSyncedAtRef.current = Date.now();
    void api.setMediaPosition(item.id, {
      positionSeconds: completed ? 0 : Math.max(0, Math.round(pos)),
      durationSeconds: dur > 0 ? Math.round(dur) : item.enclosure_duration_seconds ?? null,
      completed,
      updatedAt: new Date().toISOString(),
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const audio = new Audio();
    audio.preload = "metadata";
    audioRef.current = audio;

    const onTimeUpdate = () => {
      const time = audio.currentTime;
      setCurrentTime(time);
      const item = currentItemRef.current;
      if (item && !audio.paused && Date.now() - lastSyncedAtRef.current >= 10_000) {
        syncPosition(item, time, Number.isFinite(audio.duration) ? audio.duration : 0, false);
      }
    };
    const onLoadedMetadata = () => {
      audio.playbackRate = playbackRateRef.current;
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
      }
      const item = currentItemRef.current;
      const saved = item?.media_position;
      if (item && saved && !saved.completed && saved.positionSeconds > 5 && (!Number.isFinite(audio.duration) || saved.positionSeconds < audio.duration - 5)) {
        audio.currentTime = saved.positionSeconds;
        setCurrentTime(saved.positionSeconds);
      }
    };
    const onPlay = () => setIsPlaying(true);
    const onError = () => setIsPlaying(false);
    const onPause = () => {
      setIsPlaying(false);
      const item = currentItemRef.current;
      if (item && !audio.ended) {
        syncPosition(item, audio.currentTime, Number.isFinite(audio.duration) ? audio.duration : 0, false);
      }
    };
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
      const item = currentItemRef.current;
      if (item) syncPosition(item, 0, Number.isFinite(audio.duration) ? audio.duration : 0, true);
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);

    return () => {
      audio.pause();
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
    };
  }, [syncPosition]);

  useEffect(() => {
    if (sleepRemainingSec === null) return;
    if (sleepRemainingSec <= 0) {
      audioRef.current?.pause();
      setSleepRemainingSec(null);
      return;
    }
    const timer = window.setTimeout(() => {
      setSleepRemainingSec((prev) => (prev !== null ? prev - 1 : null));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [sleepRemainingSec]);

  useEffect(() => {
    let active = true;
    setChapters([]);
    if (!currentItem?.chapters_url) return;
    api.itemChapters(currentItem.id)
      .then((res) => { if (active) setChapters(res.chapters); })
      .catch(() => { if (active) setChapters([]); });
    return () => { active = false; };
  }, [currentItem?.id, currentItem?.chapters_url]);

  const playItem = useCallback((item: Item) => {
    const audio = audioRef.current;
    if (!audio || !item.enclosure_url) return;
    if (currentItemRef.current?.id === item.id) {
      void audio.play().catch(() => {});
      return;
    }
    if (currentItemRef.current) {
      syncPosition(currentItemRef.current, audio.currentTime, Number.isFinite(audio.duration) ? audio.duration : 0, false);
    }
    setCurrentItem(item);
    setDuration(item.enclosure_duration_seconds ?? 0);
    const initial = item.media_position && !item.media_position.completed ? item.media_position.positionSeconds : 0;
    setCurrentTime(initial);
    audio.src = item.enclosure_url;
    audio.playbackRate = playbackRate;
    void audio.play().catch(() => {});
  }, [playbackRate, syncPosition]);

  const togglePlay = useCallback((item?: Item) => {
    const audio = audioRef.current;
    if (!audio) return;
    if (item && item.id !== currentItemRef.current?.id) {
      playItem(item);
      return;
    }
    if (!currentItemRef.current) return;
    if (audio.paused) {
      void audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }, [playItem]);

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const maxDur = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : duration;
    const target = Math.max(0, maxDur > 0 ? Math.min(seconds, maxDur) : seconds);
    audio.currentTime = target;
    setCurrentTime(target);
  }, [duration]);

  const skip = useCallback((deltaSeconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    seek(audio.currentTime + deltaSeconds);
  }, [seek]);

  const setRate = useCallback((rate: number) => {
    setPlaybackRate(rate);
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }, []);

  const setSleepTimer = useCallback((minutes: number | null) => {
    setSleepRemainingSec(minutes && minutes > 0 ? minutes * 60 : null);
  }, []);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      if (currentItemRef.current) {
        syncPosition(currentItemRef.current, audio.currentTime, Number.isFinite(audio.duration) ? audio.duration : 0, false);
      }
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    setCurrentItem(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setSleepRemainingSec(null);
    setChapters([]);
  }, [syncPosition]);

  return (
    <AudioPlayerContext.Provider
      value={{
        currentItem,
        isPlaying,
        currentTime,
        duration,
        playbackRate,
        sleepRemainingSec,
        chapters,
        playItem,
        togglePlay,
        seek,
        skip,
        setRate,
        setSleepTimer,
        stop,
      }}
    >
      {children}
    </AudioPlayerContext.Provider>
  );
}

const NOOP_PLAYER: AudioPlayerContextValue = {
  currentItem: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  playbackRate: 1,
  sleepRemainingSec: null,
  chapters: [],
  playItem: () => {},
  togglePlay: () => {},
  seek: () => {},
  skip: () => {},
  setRate: () => {},
  setSleepTimer: () => {},
  stop: () => {},
};

export function useAudioPlayer(): AudioPlayerContextValue {
  return useContext(AudioPlayerContext) ?? NOOP_PLAYER;
}
