import { useState, type DragEvent } from "react";
import { announceItemsChanged } from "../../utils/badge.ts";
import { pushSupported } from "../../utils/push.ts";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api, type Feed } from "../../api/client.ts";
import { usePlanLimits } from "../../utils/planLimits.ts";
import { ActionMenu, type ActionMenuItem } from "../ActionMenu.tsx";
import { CustomSelect, type SelectOption } from "../CustomSelect.tsx";
import { Favicon } from "../Favicon.tsx";
import { formatRelativeTime } from "../../utils/relativeTime.ts";
import { toast } from "../../utils/toast.ts";
import { AlertIcon, CheckAllIcon, EditIcon, GripIcon, RefreshIcon, TrashIcon } from "./icons.tsx";

export function formatInterval(t: (key: string, opts?: Record<string, unknown>) => string, minutes: number): string {
  if (minutes < 60) return t("feeds.minutesShort", { count: minutes });
  return t("feeds.hoursShort", { count: Math.round(minutes / 60) });
}

function hostOf(url: string | null): string | null {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, "") : null;
  } catch {
    return null;
  }
}

function FeedEditor({ feed, folderOptions, intervalOptions, onClose, onSaved }: {
  feed: Feed;
  folderOptions: SelectOption[];
  intervalOptions: SelectOption[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [label, setLabel] = useState(feed.label?.trim() || feed.title?.trim() || feed.url);
  const [labelChanged, setLabelChanged] = useState(false);
  const [folderId, setFolderId] = useState<number | null>(feed.folder_id ?? null);
  const [pollInterval, setPollInterval] = useState(feed.poll_interval_minutes);
  const [fullText, setFullText] = useState(feed.full_text_mode !== "never");
  const [notify, setNotify] = useState(feed.notify !== 0);
  const [badge, setBadge] = useState(feed.badge !== 0);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await api.updateFeed(feed.id, {
        ...(labelChanged ? { label: label.trim() || null } : {}),
        folderId,
        pollIntervalMinutes: pollInterval,
        fullTextMode: fullText ? "auto" : "never",
        notify,
        badge,
      });
      announceItemsChanged();
      toast.success(t("feeds.changesSaved"));
      onClose();
      await onSaved();
    } catch {
      toast.error(t("common.error"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 border-t border-[var(--c-border)] bg-[var(--c-bg)]/60 px-4 py-4 sm:px-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1.5 text-xs font-medium text-[var(--c-text-muted)]">
          {t("feeds.labelPlaceholder")}
          <input
            type="text"
            className="input text-sm"
            placeholder={feed.title ?? feed.url}
            value={label}
            onChange={(e) => {
              setLabel(e.target.value);
              setLabelChanged(true);
            }}
          />
        </label>
        <div className="flex flex-col gap-1.5 text-xs font-medium text-[var(--c-text-muted)]">
          {t("feeds.folder")}
          <CustomSelect value={folderId ? String(folderId) : ""} onChange={(val) => setFolderId(val ? Number(val) : null)} options={folderOptions} className="w-full" placeholder={t("feeds.noFolder")} />
        </div>
        <div className="flex flex-col gap-1.5 text-xs font-medium text-[var(--c-text-muted)]">
          {t("feeds.interval")}
          <CustomSelect value={String(pollInterval)} onChange={(val) => setPollInterval(Number(val))} options={intervalOptions} className="w-full" />
        </div>
      </div>

      <label className="flex cursor-pointer select-none items-start gap-2.5 text-sm">
        <input type="checkbox" className="mt-0.5 rounded" checked={fullText} onChange={(e) => setFullText(e.target.checked)} />
        <span>
          {t("feeds.fullText")}
          <span className="mt-0.5 block text-xs text-[var(--c-text-muted)]">
            {feed.full_text_blocked_at ? t("feeds.fullTextBlocked") : t("feeds.fullTextHint")}
          </span>
        </span>
      </label>

      {pushSupported() && (
        <label className="flex cursor-pointer select-none items-start gap-2.5 text-sm">
          <input type="checkbox" className="mt-0.5 rounded" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          <span>
            {t("feeds.notify")}
            <span className="mt-0.5 block text-xs text-[var(--c-text-muted)]">{t("feeds.notifyHint")}</span>
          </span>
        </label>
      )}

      {"setAppBadge" in navigator && (
        <label className="flex cursor-pointer select-none items-start gap-2.5 text-sm">
          <input type="checkbox" className="mt-0.5 rounded" checked={badge} onChange={(e) => setBadge(e.target.checked)} />
          <span>
            {t("feeds.badge")}
            <span className="mt-0.5 block text-xs text-[var(--c-text-muted)]">{t("feeds.badgeHint")}</span>
          </span>
        </label>
      )}

      <p className="truncate font-mono text-xs text-[var(--c-text-muted)]" title={feed.url}>{feed.url}</p>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="btn-secondary px-3 py-1.5 text-sm">{t("common.cancel")}</button>
        <button type="button" onClick={save} disabled={saving} className="btn-primary px-4 py-1.5 text-sm">{t("common.save")}</button>
      </div>
    </div>
  );
}

export interface FeedRowProps {
  feed: Feed;
  editing: boolean;
  refreshing: boolean;
  /** Briefly marks a feed that was just added. */
  highlighted?: boolean;
  folderOptions: SelectOption[];
  intervalOptions: SelectOption[];
  onEdit: (editing: boolean) => void;
  onRefresh: () => void;
  onMarkRead: () => void;
  onUnsubscribe: () => void;
  onSaved: () => Promise<void>;
  drag?: {
    isDragging: boolean;
    isDragOver: boolean;
    onDragStart: (event: DragEvent) => void;
    onDragOver: (event: DragEvent) => void;
    onDragEnd: () => void;
  };
}

/** One subscription: favicon, name, source and health at a glance, actions tucked into a menu. */
export function FeedRow({ feed, editing, refreshing, highlighted = false, folderOptions, intervalOptions, onEdit, onRefresh, onMarkRead, onUnsubscribe, onSaved, drag }: FeedRowProps) {
  const { t, i18n } = useTranslation();
  const { syncAllowed } = usePlanLimits();
  const name = feed.label ?? feed.title ?? feed.url;
  const host = hostOf(feed.site_url) ?? hostOf(feed.url);
  const failing = Boolean(feed.last_error);
  const pending = !feed.last_polled_at;

  const actions: ActionMenuItem[] = [
    { label: refreshing ? t("feeds.refreshing") : t("feeds.refreshFeed"), icon: <RefreshIcon className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />, onSelect: onRefresh, disabled: refreshing || !syncAllowed },
    ...(feed.unread_count > 0 ? [{ label: t("feeds.markAllRead"), icon: <CheckAllIcon />, onSelect: onMarkRead }] : []),
    { label: t("feeds.edit"), icon: <EditIcon />, onSelect: () => onEdit(!editing) },
    { label: t("feeds.unsubscribe"), icon: <TrashIcon />, onSelect: onUnsubscribe, danger: true },
  ];

  return (
    <li
      id={`feed-${feed.id}`}
      draggable={Boolean(drag) && !editing}
      onDragStart={drag?.onDragStart}
      onDragOver={drag?.onDragOver}
      onDragEnd={drag?.onDragEnd}
      className={`group/feed relative scroll-mt-28 first:rounded-t-xl last:rounded-b-xl transition-[opacity,background-color] duration-700 ${highlighted ? "bg-[var(--c-mobile-nav-active)]" : ""} ${drag?.isDragging ? "opacity-40" : ""} ${drag?.isDragOver ? "shadow-[inset_0_2px_0_var(--c-blue3)]" : ""}`}
    >
      <div className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
        {drag && (
          <span className="absolute left-0.5 top-[1.4rem] hidden cursor-grab text-[var(--c-text-muted)] opacity-0 transition-opacity group-hover/feed:opacity-60 active:cursor-grabbing sm:block" title={t("feeds.dragHandle")} aria-hidden="true">
            <GripIcon />
          </span>
        )}

        <Favicon feedId={feed.id} iconUrl={feed.icon_url} siteUrl={feed.site_url} feedUrl={feed.url} className="h-5 w-5 shrink-0 rounded object-contain" />

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            {(failing || pending) && (
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${failing ? "bg-[var(--c-danger)]" : "bg-[var(--c-text-muted)]"}`}
                title={failing ? t("feeds.statusFailing", { count: feed.consecutive_errors || 1 }) : t("feeds.statusPending")}
              />
            )}
            <Link to={`/items?feed=${feed.id}`} className="truncate font-semibold text-[var(--c-text)] hover:underline">
              {name}
            </Link>
          </div>
          <p className="mt-0.5 truncate text-xs text-[var(--c-text-muted)]">
            {[
              host,
              t("feeds.everyInterval", { interval: formatInterval(t, feed.poll_interval_minutes) }),
              feed.last_polled_at ? t("feeds.checkedAgo", { time: formatRelativeTime(new Date(feed.last_polled_at), i18n.resolvedLanguage) }) : t("feeds.statusPending"),
            ].filter(Boolean).join(" · ")}
          </p>
          {failing && (
            <p className="mt-1.5 flex items-start gap-1.5 text-xs text-[var(--c-danger)]" title={feed.last_error ?? undefined}>
              <AlertIcon />
              <span className="line-clamp-2 break-all">{feed.last_error}</span>
            </p>
          )}
        </div>

        {feed.unread_count > 0 && (
          <Link
            to={`/items?feed=${feed.id}`}
            className="shrink-0 rounded-full bg-[var(--c-mobile-nav-active)] px-2.5 py-0.5 text-xs font-semibold tabular-nums text-[var(--c-text)] hover:bg-[var(--c-border)]"
            title={t("feeds.unread", { count: feed.unread_count })}
          >
            {feed.unread_count}
          </Link>
        )}

        <ActionMenu label={t("feeds.moreActions")} items={actions} className="-mr-2 shrink-0" />
      </div>

      {editing && <FeedEditor feed={feed} folderOptions={folderOptions} intervalOptions={intervalOptions} onClose={() => onEdit(false)} onSaved={onSaved} />}
    </li>
  );
}
