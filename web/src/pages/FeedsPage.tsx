import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api, type Feed, type Folder } from "../api/client.ts";
import { type SelectOption } from "../components/CustomSelect.tsx";
import { LoadingSpinner } from "../components/LoadingSpinner.tsx";
import { ActionMenu } from "../components/ActionMenu.tsx";
import { FeedRow, formatInterval } from "../components/feeds/FeedRow.tsx";
import { Welcome } from "../components/onboarding/Welcome.tsx";
import { PlanNotice } from "../components/PlanNotice.tsx";
import { usePlanLimits } from "../utils/planLimits.ts";
import { AddFeedPanel } from "../components/feeds/AddFeedPanel.tsx";
import { FolderManager } from "../components/feeds/FolderManager.tsx";
import { toast } from "../utils/toast.ts";
import { DownloadIcon, FolderIcon, PlusIcon, RefreshIcon, SearchIcon, UploadIcon } from "../components/feeds/icons.tsx";

const POLL_PRESETS = [5, 15, 30, 60, 180, 360, 720, 1440];
const UNCATEGORIZED = "none";

type Filter = "all" | "failing" | typeof UNCATEGORIZED | `folder:${number}`;

interface FeedGroup {
  key: string;
  name: string;
  feeds: Feed[];
}

function matchesQuery(feed: Feed, query: string): boolean {
  if (!query) return true;
  const haystack = [feed.label, feed.title, feed.url, feed.site_url].filter(Boolean).join(" ").toLowerCase();
  return haystack.includes(query.toLowerCase());
}

export function FeedsPage() {
  const { t } = useTranslation();
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);
  const [panel, setPanel] = useState<"add" | "folders" | null>(null);
  const [editingFeedId, setEditingFeedId] = useState<number | null>(null);
  const [refreshingIds, setRefreshingIds] = useState<Set<number>>(new Set());
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [query, setQuery] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  // Opened from the home screen shortcut or the system share sheet: start adding a feed.
  const [sharedUrl] = useState(() => {
    const text = [searchParams.get("url"), searchParams.get("text"), searchParams.get("add")].filter(Boolean).join(" ");
    return text.match(/https?:\/\/[^\s]+/i)?.[0] ?? "";
  });
  useEffect(() => {
    if (!searchParams.has("add") && !searchParams.has("url") && !searchParams.has("text")) return;
    if (syncAllowed) setPanel("add");
    setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [filter, setFilter] = useState<Filter>("all");
  const [drag, setDrag] = useState<{ group: string; from: number; over: number } | null>(null);
  const [importing, setImporting] = useState(false);
  const [highlightedId, setHighlightedId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      const [feedsData, foldersData] = await Promise.all([api.listFeeds(), api.listFolders().catch(() => ({ folders: [] }))]);
      setFeeds(feedsData);
      setFolders(foldersData.folders);
    } catch (err) {
      console.error("Failed to load feeds:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  // Bring a newly added feed into view so long lists still show where it landed.
  useEffect(() => {
    if (highlightedId === null) return;
    document.getElementById(`feed-${highlightedId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    const timer = window.setTimeout(() => setHighlightedId(null), 2500);
    return () => window.clearTimeout(timer);
  }, [highlightedId, feeds]);

  // Titles come from the feeds themselves; some contain line breaks and runs of spaces.
  const { syncAllowed } = usePlanLimits();
  const feedName = (feed: Feed) => (feed.label ?? feed.title ?? feed.url).replace(/\s+/g, " ").trim();

  async function onFeedAdded(feed: Feed) {
    toast.success(t("feeds.subscribedToast", { title: feedName(feed) }));
    setQuery("");
    setFilter("all");
    await load();
    setHighlightedId(feed.id);
  }

  const folderOptions = useMemo<SelectOption[]>(
    () => [{ value: "", label: t("feeds.noFolder") }, ...folders.map((f) => ({ value: String(f.id), label: f.name }))],
    [folders, t],
  );
  const intervalOptions = useMemo<SelectOption[]>(
    () => POLL_PRESETS.map((minutes) => ({ value: String(minutes), label: formatInterval(t, minutes) })),
    [t],
  );

  // Feeds keep their saved order inside each category; categories are alphabetical, uncategorized last.
  const allGroups = useMemo<FeedGroup[]>(() => {
    const byFolder = new Map<number | null, Feed[]>();
    for (const feed of feeds) {
      const key = feed.folder_id ?? null;
      byFolder.set(key, [...(byFolder.get(key) ?? []), feed]);
    }
    const groups: FeedGroup[] = [...folders]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((folder) => ({ key: `folder:${folder.id}`, name: folder.name, feeds: byFolder.get(folder.id) ?? [] }));
    groups.push({ key: UNCATEGORIZED, name: t("feeds.uncategorized"), feeds: byFolder.get(null) ?? [] });
    return groups.filter((group) => group.feeds.length > 0);
  }, [feeds, folders, t]);

  const visibleGroups = useMemo(() => {
    return allGroups
      .filter((group) => filter === "all" || filter === "failing" || group.key === filter)
      .map((group) => ({
        ...group,
        feeds: group.feeds.filter((feed) => matchesQuery(feed, query) && (filter !== "failing" || Boolean(feed.last_error))),
      }))
      .filter((group) => group.feeds.length > 0);
  }, [allGroups, filter, query]);

  const totalUnread = feeds.reduce((sum, feed) => sum + feed.unread_count, 0);
  const failingCount = feeds.filter((feed) => feed.last_error).length;
  // Reordering only makes sense on the unfiltered list.
  const canReorder = !query && filter !== "failing";

  async function onDrop() {
    if (!drag || drag.from === drag.over) {
      setDrag(null);
      return;
    }
    const groups = allGroups.map((group) => {
      if (group.key !== drag.group) return group.feeds;
      const reordered = [...group.feeds];
      const [moved] = reordered.splice(drag.from, 1);
      reordered.splice(drag.over, 0, moved);
      return reordered;
    });
    const ordered = groups.flat();
    setFeeds(ordered);
    setDrag(null);
    try {
      await api.reorderFeeds(ordered.map((feed) => feed.id));
    } catch (err) {
      console.error("Failed to save feed order:", err);
      await load();
    }
  }

  async function onRefreshFeed(feedId: number) {
    setRefreshingIds((prev) => new Set(prev).add(feedId));
    try {
      const res = await api.refreshFeed(feedId);
      if (res.feed) setFeeds((prev) => prev.map((f) => (f.id === feedId ? res.feed : f)));
      else await load();
      if (res.error) toast.error(t("feeds.refreshFailedToast", { title: res.feed ? feedName(res.feed) : "", error: res.error }));
      else toast.success(t("feeds.refreshedToast", { title: res.feed ? feedName(res.feed) : "", count: res.newItems }));
    } catch {
      toast.error(t("common.error"));
    } finally {
      setRefreshingIds((prev) => {
        const next = new Set(prev);
        next.delete(feedId);
        return next;
      });
    }
  }

  async function onRefreshAll() {
    setRefreshingAll(true);
    try {
      const res = await api.refreshAllFeeds();
      await load();
      toast.success(t("feeds.refreshedAllToast", { count: res.refreshed, newItems: res.newItems }));
      if (res.errors > 0) toast.error(t("feeds.failingCount", { count: res.errors }));
    } catch {
      toast.error(t("common.error"));
    } finally {
      setRefreshingAll(false);
    }
  }

  async function onUnsubscribe(feed: Feed) {
    if (!confirm(t("feeds.unsubscribeConfirm", { title: feedName(feed) }))) return;
    try {
      await api.unsubscribeFeed(feed.id);
      toast.success(t("feeds.unsubscribedToast", { title: feedName(feed) }));
      await load();
    } catch {
      toast.error(t("common.error"));
    }
  }

  async function onMarkAllRead(feed: Feed) {
    try {
      await api.markAllRead(feed.id);
      toast.success(t("feeds.markedReadToast", { title: feedName(feed) }));
      await load();
    } catch {
      toast.error(t("common.error"));
    }
  }

  function exportOpml() {
    const link = document.createElement("a");
    link.href = api.exportOpmlUrl();
    link.download = "feedkeeper-subscriptions.opml";
    link.click();
  }

  async function onFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const res = await api.importOpml(await file.text());
      if (res.failed > 0) toast.error(t("feeds.importPartial", { imported: res.imported, skipped: res.skipped, failed: res.failed }));
      else toast.success(t("feeds.importSuccess", { imported: res.imported, skipped: res.skipped }));
      await load();
    } catch {
      toast.error(t("feeds.importFailed"));
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const chips: { key: Filter; label: string; count?: number; danger?: boolean }[] = [
    { key: "all", label: t("feeds.filterAll"), count: feeds.length },
    ...allGroups.map((group) => ({ key: group.key as Filter, label: group.name, count: group.feeds.length })),
    ...(failingCount > 0 ? [{ key: "failing" as Filter, label: t("feeds.filterFailing"), count: failingCount, danger: true }] : []),
  ];

  return (
    // Bottom room lets the last feed scroll clear of the toast after it was added.
    <div className="flex flex-col gap-6 pb-24">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">{t("feeds.title")}</h1>
          {!loading && feeds.length > 0 && (
            <p className="mt-1 text-sm text-[var(--c-text-muted)]">
              {t("feeds.feedCount", { count: feeds.length })} · {t("feeds.unread", { count: totalUnread })}
              {failingCount > 0 && (
                <>
                  {" · "}
                  <button type="button" onClick={() => setFilter("failing")} className="text-[var(--c-danger)] hover:underline cursor-pointer">
                    {t("feeds.failingCount", { count: failingCount })}
                  </button>
                </>
              )}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {/* Without feeds the empty state below carries the same button. */}
          {(loading || feeds.length > 0) && (
            <button type="button" disabled={!syncAllowed} title={syncAllowed ? undefined : t("plan.unavailable")} onClick={() => setPanel(panel === "add" ? null : "add")} className="btn-primary inline-flex items-center gap-1.5 whitespace-nowrap">
              <PlusIcon className="h-4 w-4" />
              <span className="hidden sm:inline">{t("feeds.addFeed")}</span>
              <span className="sm:hidden">{t("feeds.addFeedShort")}</span>
            </button>
          )}
          <ActionMenu
            label={t("feeds.moreActions")}
            items={[
              { label: refreshingAll ? t("feeds.refreshing") : t("feeds.refreshAll"), icon: <RefreshIcon className={`h-4 w-4 ${refreshingAll ? "animate-spin" : ""}`} />, onSelect: onRefreshAll, disabled: refreshingAll || !syncAllowed },
              { label: t("feeds.manageFolders"), icon: <FolderIcon />, onSelect: () => setPanel("folders") },
              { label: importing ? t("feeds.importing") : t("feeds.importOpml"), icon: <UploadIcon />, onSelect: () => fileInputRef.current?.click(), disabled: importing || !syncAllowed },
              { label: t("feeds.exportOpml"), icon: <DownloadIcon />, onSelect: exportOpml },
            ]}
          />
          <input type="file" ref={fileInputRef} onChange={onFileSelected} accept=".opml,.xml,text/xml,application/xml" className="hidden" />
        </div>
      </div>

      {!syncAllowed && feeds.length > 0 && <PlanNotice />}
      {panel === "add" && syncAllowed && (
        <AddFeedPanel
          folderOptions={folderOptions}
          defaultFolderId={filter.startsWith("folder:") ? Number(filter.slice(7)) : null}
          initialUrl={sharedUrl}
          onClose={() => setPanel(null)}
          onAdded={onFeedAdded}
        />
      )}
      {panel === "folders" && <FolderManager folders={folders} onClose={() => setPanel(null)} onChanged={load} />}

      {loading ? (
        <LoadingSpinner size="lg" />
      ) : feeds.length === 0 ? (
        panel !== "add" && <Welcome onSubscribed={load} />
      ) : (
        <>
          <div className="flex flex-col gap-3">
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--c-text-muted)] opacity-60"><SearchIcon /></span>
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("feeds.searchPlaceholder")} aria-label={t("feeds.searchPlaceholder")} className="input pl-9" />
            </div>
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0" role="group" aria-label={t("feeds.folder")}>
              {chips.map((chip) => {
                const active = filter === chip.key;
                return (
                  <button
                    key={chip.key}
                    type="button"
                    onClick={() => setFilter(chip.key)}
                    aria-pressed={active}
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer ${
                      active
                        ? "border-[var(--c-mobile-nav-active-border)] bg-[var(--c-mobile-nav-active)] text-[var(--c-text)]"
                        : "border-[var(--c-border)] text-[var(--c-text-muted)] hover:text-[var(--c-text)]"
                    } ${chip.danger && !active ? "text-[var(--c-danger)]" : ""}`}
                  >
                    {chip.label}
                    {chip.count !== undefined && <span className="text-xs tabular-nums opacity-70">{chip.count}</span>}
                  </button>
                );
              })}
            </div>
          </div>

          {visibleGroups.length === 0 ? (
            <p className="text-sm text-[var(--c-text-muted)]">{t("feeds.noMatches")}</p>
          ) : (
            <div className="flex flex-col gap-6 animate-page-fade">
              {visibleGroups.map((group) => {
                const unread = group.feeds.reduce((sum, feed) => sum + feed.unread_count, 0);
                return (
                  <section key={group.key}>
                    <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
                      <h2 className="truncate text-xs font-semibold tracking-[0.08em] uppercase text-[var(--c-text-muted)]">{group.name}</h2>
                      <span className="shrink-0 text-xs text-[var(--c-text-muted)]">
                        {t("feeds.feedCount", { count: group.feeds.length })}
                        {unread > 0 && ` · ${t("feeds.unread", { count: unread })}`}
                      </span>
                    </div>
                    <ul className="card divide-y divide-[var(--c-border)]">
                      {group.feeds.map((feed, index) => (
                        <FeedRow
                          key={feed.id}
                          feed={feed}
                          editing={editingFeedId === feed.id}
                          refreshing={refreshingIds.has(feed.id)}
                          highlighted={highlightedId === feed.id}
                          folderOptions={folderOptions}
                          intervalOptions={intervalOptions}
                          onEdit={(editing) => setEditingFeedId(editing ? feed.id : null)}
                          onRefresh={() => void onRefreshFeed(feed.id)}
                          onMarkRead={() => void onMarkAllRead(feed)}
                          onUnsubscribe={() => void onUnsubscribe(feed)}
                          onSaved={load}
                          drag={canReorder && group.feeds.length > 1 ? {
                            isDragging: drag?.group === group.key && drag.from === index,
                            isDragOver: drag?.group === group.key && drag.over === index && drag.from !== index,
                            onDragStart: (event) => {
                              event.dataTransfer.effectAllowed = "move";
                              event.dataTransfer.setData("text/plain", String(feed.id));
                              setDrag({ group: group.key, from: index, over: index });
                            },
                            onDragOver: (event) => {
                              if (drag?.group !== group.key) return;
                              event.preventDefault();
                              if (drag.over !== index) setDrag({ ...drag, over: index });
                            },
                            onDragEnd: () => void onDrop(),
                          } : undefined}
                        />
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
