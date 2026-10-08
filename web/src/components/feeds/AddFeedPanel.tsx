import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError, type DiscoveredFeed, type Feed } from "../../api/client.ts";
import { toast } from "../../utils/toast.ts";
import { CustomSelect, type SelectOption } from "../CustomSelect.tsx";
import { CloseIcon } from "./icons.tsx";

/** Subscribe by website or feed URL; lets the user pick when a site offers several feeds. */
export function AddFeedPanel({ folderOptions, defaultFolderId, initialUrl = "", compact = false, onClose, onAdded }: {
  folderOptions: SelectOption[];
  defaultFolderId: number | null;
  /** Address to start with, e.g. one shared from another app. */
  initialUrl?: string;
  /** Only the address field and the button, without the card around them (for the welcome card). */
  compact?: boolean;
  onClose: () => void;
  onAdded: (feed: Feed) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [url, setUrl] = useState(initialUrl);
  const [label, setLabel] = useState("");
  const [folderId, setFolderId] = useState<number | null>(defaultFolderId);
  const [submitting, setSubmitting] = useState(false);
  const [candidates, setCandidates] = useState<DiscoveredFeed[]>([]);

  async function subscribe(targetUrl: string, customLabel: string | null) {
    setSubmitting(true);
    setCandidates([]);
    try {
      const feed = await api.subscribeFeed(targetUrl, customLabel, folderId);
      setUrl("");
      setLabel("");
      await onAdded(feed);
    } catch (err) {
      if (err instanceof ApiError && err.code === "multiple_feeds_found" && err.data && typeof err.data === "object" && "feeds" in err.data) {
        setCandidates((err.data as { feeds: DiscoveredFeed[] }).feeds);
      } else if (err instanceof ApiError && err.code === "already_subscribed") {
        toast.error(t("feeds.alreadySubscribed"));
      } else if (err instanceof ApiError && (err.code === "no_feeds_found" || err.code === "invalid_feed")) {
        toast.error(t("feeds.noFeedsFoundOnPage"));
      } else {
        toast.error(t("feeds.subscribeFailed"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    let target = url.trim();
    if (target && !/^https?:\/\//i.test(target)) target = target.startsWith("//") ? `https:${target}` : `https://${target}`;
    void subscribe(target, label.trim() || null);
  }

  return (
    <section className={compact ? "flex flex-col gap-4" : "card animate-fade-in flex flex-col gap-4 p-4 sm:p-5"}>
      {!compact && <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">{t("feeds.addFeed")}</h2>
        <button type="button" onClick={onClose} className="rounded-lg p-1 text-[var(--c-text-muted)] hover:bg-[var(--c-surface-hover)] hover:text-[var(--c-text)] cursor-pointer" aria-label={t("common.close")}>
          <CloseIcon />
        </button>
      </div>}

      <form onSubmit={onSubmit} className={`flex flex-col gap-3 ${compact ? "sm:flex-row sm:items-start" : ""}`}>
        <input
          type="text"
          required
          autoFocus={!compact}
          placeholder={t("feeds.urlPlaceholder")}
          className={compact ? "input sm:flex-1" : "input"}
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            if (candidates.length) setCandidates([]);
          }}
        />
        <div className="flex flex-col gap-3 sm:flex-row">
          {!compact && <input type="text" placeholder={t("feeds.labelPlaceholder")} className="input sm:flex-1" value={label} onChange={(e) => setLabel(e.target.value)} />}
          {!compact && <CustomSelect value={folderId ? String(folderId) : ""} onChange={(val) => setFolderId(val ? Number(val) : null)} options={folderOptions} className="w-full sm:w-52" placeholder={t("feeds.noFolder")} />}
          <button type="submit" disabled={submitting} className="btn-primary whitespace-nowrap">
            {submitting ? t("feeds.subscribing") : t("feeds.subscribe")}
          </button>
        </div>
      </form>

      {candidates.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-[var(--c-text-muted)]">{t("feeds.multipleFeedsFound")}</p>
          <ul className="divide-y divide-[var(--c-border)] rounded-xl border border-[var(--c-border)]">
            {candidates.map((candidate) => (
              <li key={candidate.url} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{candidate.title ?? candidate.url}</p>
                  <p className="truncate text-xs text-[var(--c-text-muted)]">{candidate.url}</p>
                </div>
                <button type="button" disabled={submitting} onClick={() => subscribe(candidate.url, candidate.title || label.trim() || null)} className="btn-primary shrink-0 px-3 py-1.5 text-xs">
                  {t("feeds.subscribe")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
