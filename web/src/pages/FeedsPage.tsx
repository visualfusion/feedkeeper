import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError, type Feed } from "../api/client.ts";

const POLL_PRESETS = [5, 15, 30, 60, 180, 360, 720, 1440];

function formatInterval(t: (key: string, opts?: Record<string, unknown>) => string, minutes: number): string {
  if (minutes < 60) return t("feeds.minutesShort", { count: minutes });
  return t("feeds.hoursShort", { count: Math.round(minutes / 60) });
}

export function FeedsPage() {
  const { t, i18n } = useTranslation();
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingFeedId, setEditingFeedId] = useState<number | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editInterval, setEditInterval] = useState(15);

  async function load() {
    setLoading(true);
    try {
      setFeeds(await api.listFeeds());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.subscribeFeed(url, label || null);
      setUrl("");
      setLabel("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.code : t("common.error"));
    } finally {
      setSubmitting(false);
    }
  }

  async function onUnsubscribe(feed: Feed) {
    const title = feed.label ?? feed.title ?? feed.url;
    if (!confirm(t("feeds.unsubscribeConfirm", { title }))) return;
    await api.unsubscribeFeed(feed.id);
    await load();
  }

  function startEdit(feed: Feed) {
    setEditingFeedId(feed.id);
    setEditLabel(feed.label ?? "");
    setEditInterval(feed.poll_interval_minutes);
  }

  async function saveEdit(feedId: number) {
    await api.updateFeed(feedId, { label: editLabel || null, pollIntervalMinutes: editInterval });
    setEditingFeedId(null);
    await load();
  }

  async function onMarkAllRead(feed: Feed) {
    await api.markAllRead(feed.id);
    await load();
  }

  const dateFormatter = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    dateStyle: "short",
    timeStyle: "short",
  });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t("feeds.title")}</h1>

      <form onSubmit={onSubmit} className="card p-4 flex flex-col sm:flex-row gap-3">
        <input
          type="url"
          required
          placeholder={t("feeds.urlPlaceholder")}
          className="input sm:flex-1"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <input
          type="text"
          placeholder={t("feeds.labelPlaceholder")}
          className="input sm:w-56"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <button type="submit" disabled={submitting} className="btn-primary whitespace-nowrap">
          {t("feeds.subscribe")}
        </button>
      </form>
      {error && <p className="text-sm text-red-500">{error}</p>}

      {loading ? (
        <p style={{ color: "var(--c-text-muted)" }}>{t("common.loading")}</p>
      ) : feeds.length === 0 ? (
        <p style={{ color: "var(--c-text-muted)" }}>{t("feeds.noFeeds")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {feeds.map((feed) => (
            <li key={feed.id} className="card p-4 flex flex-col gap-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">{feed.label ?? feed.title ?? feed.url}</p>
                  <p className="text-sm truncate" style={{ color: "var(--c-text-muted)" }}>
                    {feed.url}
                  </p>
                  <p className="text-xs mt-1" style={{ color: "var(--c-text-muted)" }}>
                    {t("feeds.lastPolled")}:{" "}
                    {feed.last_polled_at ? dateFormatter.format(new Date(feed.last_polled_at)) : t("common.never")}
                    {" · "}
                    {t("feeds.interval")}: {formatInterval(t, feed.poll_interval_minutes)}
                    {feed.last_error && (
                      <span className="text-red-500">
                        {" "}
                        · {t("feeds.error")}: {feed.last_error}
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {feed.unread_count > 0 && (
                    <span
                      className="text-xs font-medium px-2 py-1 rounded-full"
                      style={{ backgroundColor: "var(--c-green3)", color: "#0f141e" }}
                    >
                      {t("feeds.unread", { count: feed.unread_count })}
                    </span>
                  )}
                  {feed.unread_count > 0 && (
                    <button onClick={() => onMarkAllRead(feed)} className="btn-secondary text-sm whitespace-nowrap">
                      {t("feeds.markAllRead")}
                    </button>
                  )}
                  <button
                    onClick={() => (editingFeedId === feed.id ? setEditingFeedId(null) : startEdit(feed))}
                    className="btn-secondary text-sm"
                  >
                    {t("feeds.edit")}
                  </button>
                  <button onClick={() => onUnsubscribe(feed)} className="btn-secondary text-sm">
                    {t("feeds.unsubscribe")}
                  </button>
                </div>
              </div>

              {editingFeedId === feed.id && (
                <div
                  className="flex flex-col sm:flex-row gap-3 pt-3 border-t"
                  style={{ borderColor: "var(--c-border)" }}
                >
                  <input
                    type="text"
                    placeholder={t("feeds.labelPlaceholder")}
                    className="input sm:flex-1"
                    value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                  />
                  <select
                    className="input sm:w-48"
                    value={editInterval}
                    onChange={(e) => setEditInterval(Number(e.target.value))}
                  >
                    {POLL_PRESETS.map((minutes) => (
                      <option key={minutes} value={minutes}>
                        {formatInterval(t, minutes)}
                      </option>
                    ))}
                  </select>
                  <button onClick={() => saveEdit(feed.id)} className="btn-primary text-sm whitespace-nowrap">
                    {t("common.save")}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
