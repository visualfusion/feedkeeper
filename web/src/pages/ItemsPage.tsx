import { useEffect, useState, useMemo, useRef, useSyncExternalStore } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api, ApiError, type Feed, type Folder, type Item } from "../api/client.ts";
import { CustomSelect, type SelectOption } from "../components/CustomSelect.tsx";
import { TodayDate } from "../components/TodayDate.tsx";
import { ArticleReaderModal } from "../components/ArticleReaderModal.tsx";
import { ArticleExcerpt } from "../components/ArticleExcerpt.tsx";
import { Favicon } from "../components/Favicon.tsx";
import { LoadingSpinner } from "../components/LoadingSpinner.tsx";
import { NewspaperGrid } from "../components/NewspaperGrid.tsx";
import { PullToRefresh } from "../components/PullToRefresh.tsx";
import { getItemsScrollY, setItemsScrollY, resetItemsScrollY } from "../utils/scrollState.ts";
import { toast } from "../utils/toast.ts";
import { announceItemsChanged } from "../utils/badge.ts";
import { syncOfflineCopy } from "../utils/offlineSync.ts";
import { RefreshIcon } from "../components/feeds/icons.tsx";
import { HostNotice } from "../components/onboarding/HostNotice.tsx";
import { Intro } from "../components/onboarding/Intro.tsx";
import { PlanNotice } from "../components/PlanNotice.tsx";
import { usePlanLimits } from "../utils/planLimits.ts";
import { Welcome } from "../components/onboarding/Welcome.tsx";

const PAGE_SIZE = 50;

function SearchIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

const PHONE_QUERY = "(max-width: 639px)";

/** Phones only get the newspaper layout; the list view needs the wider screen. */
function useIsPhone() {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(PHONE_QUERY);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(PHONE_QUERY).matches,
  );
}

export function ItemsPage() {
  const { t, i18n } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [feedsLoaded, setFeedsLoaded] = useState(false);
  const { syncAllowed } = usePlanLimits();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const loadVersion = useRef(0);
  const nextOffset = useRef(0);
  const scrollRestored = useRef(false);
  const [selectedArticle, setSelectedArticle] = useState<Item | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "newspaper">(() => {
    try {
      return localStorage.getItem("feedkeeper_items_view") === "newspaper" ? "newspaper" : "list";
    } catch {
      return "list";
    }
  });

  const isPhone = useIsPhone();
  const activeView = isPhone ? "newspaper" : viewMode;

  function changeViewMode(mode: "list" | "newspaper") {
    if (mode === viewMode) return;
    resetItemsScrollY();
    setViewMode(mode);
    window.scrollTo({ top: 0, behavior: "instant" });
    try {
      localStorage.setItem("feedkeeper_items_view", mode);
    } catch {
      // The view remains usable when storage is unavailable.
    }
  }

  const STORAGE_KEY_SCOPE = "feedkeeper_filter_scope";
  const STORAGE_KEY_UNREAD = "feedkeeper_filter_unread";
  const STORAGE_KEY_BOOKMARKED = "feedkeeper_filter_bookmarked";
  const articleParam = searchParams.get("article");

  // Initialize filterScope: URL takes precedence, then localStorage, fallback to ""
  const initialScope = (() => {
    const feedParam = searchParams.get("feed");
    if (feedParam) return `feed:${feedParam}`;
    const folderParam = searchParams.get("folder");
    if (folderParam) return `folder:${folderParam}`;
    try {
      const saved = localStorage.getItem(STORAGE_KEY_SCOPE);
      if (saved) return saved;
    } catch {
      // Ignore localStorage errors
    }
    return "";
  })();

  const initialUnreadOnly = (() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_UNREAD);
      if (saved !== null) return saved === "true";
    } catch {
      // Ignore localStorage errors
    }
    return true; // Default behavior: only unread
  })();

  const initialBookmarkedOnly = (() => {
    // The home screen shortcut opens the saved articles.
    if (searchParams.get("saved") === "1") return true;
    // A link to one article (from a notification) shows it in the normal list, not in a remembered saved view.
    if (searchParams.get("article")) return false;
    try {
      const saved = localStorage.getItem(STORAGE_KEY_BOOKMARKED);
      if (saved !== null) return saved === "true";
    } catch {
      // Ignore localStorage errors
    }
    return false;
  })();

  const [filterScope, setFilterScope] = useState<string>(initialScope);
  const [unreadOnly, setUnreadOnly] = useState<boolean>(initialUnreadOnly);
  const [bookmarkedOnly, setBookmarkedOnly] = useState<boolean>(initialBookmarkedOnly);
  // The saved list shows every saved article, read or not.
  const effectiveUnreadOnly = unreadOnly && !bookmarkedOnly;
  const [search, setSearch] = useState("");
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const mobileSearchRef = useRef<HTMLInputElement>(null);
  const mobileSearchButtonRef = useRef<HTMLButtonElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(61);
  const [toolbarDocked, setToolbarDocked] = useState(false);

  useEffect(() => {
    const header = document.querySelector<HTMLElement>("[data-app-header]");
    if (!header) return;
    const observer = new ResizeObserver(() => setHeaderHeight(header.getBoundingClientRect().height));
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    function updateDocked() {
      const toolbarTop = toolbarRef.current?.getBoundingClientRect().top;
      setToolbarDocked(window.scrollY > 0 && toolbarTop !== undefined && toolbarTop <= headerHeight + 1);
    }
    updateDocked();
    window.addEventListener("scroll", updateDocked, { passive: true });
    window.addEventListener("resize", updateDocked);
    return () => {
      window.removeEventListener("scroll", updateDocked);
      window.removeEventListener("resize", updateDocked);
    };
  }, [headerHeight]);

  useEffect(() => {
    if (mobileSearchOpen) mobileSearchRef.current?.focus();
  }, [mobileSearchOpen]);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 640px)");
    const closeOnDesktop = () => {
      if (desktop.matches) setMobileSearchOpen(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  function closeMobileSearch() {
    setMobileSearchOpen(false);
    requestAnimationFrame(() => mobileSearchButtonRef.current?.focus());
  }

  function updateSearch(value: string) {
    resetItemsScrollY();
    setSearch(value);
  }

  function toggleUnreadOnly() {
    resetItemsScrollY();
    setUnreadOnly((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY_UNREAD, String(next));
      } catch {
        // Ignore localStorage errors
      }
      return next;
    });
  }

  function toggleBookmarkedOnly() {
    resetItemsScrollY();
    setBookmarkedOnly((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY_BOOKMARKED, String(next));
      } catch {
        // Ignore localStorage errors
      }
      return next;
    });
  }

  // Restore scroll position when returning to items page
  useEffect(() => {
    if (loading || scrollRestored.current) return;
    const targetY = getItemsScrollY();
    const raf = requestAnimationFrame(() => {
      if (targetY > 0) {
        window.scrollTo({ top: targetY, behavior: "instant" });
      }
      scrollRestored.current = true;
    });
    return () => cancelAnimationFrame(raf);
  }, [loading]);

  // Track scroll position on items page
  useEffect(() => {
    function handleScroll() {
      if (scrollRestored.current && document.body.style.overflow !== "hidden") {
        setItemsScrollY(window.scrollY);
      }
    }
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      if (scrollRestored.current && document.body.style.overflow !== "hidden") {
        setItemsScrollY(window.scrollY);
      }
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  // Sync state if URL search params change (e.g. user clicked a feed in FeedsPage or browser back/forward)
  useEffect(() => {
    const feedParam = searchParams.get("feed");
    const folderParam = searchParams.get("folder");
    if (feedParam) {
      const newScope = `feed:${feedParam}`;
      if (newScope !== filterScope) resetItemsScrollY();
      setFilterScope(newScope);
      try {
        localStorage.setItem(STORAGE_KEY_SCOPE, newScope);
      } catch {
        // Ignore localStorage errors
      }
    } else if (folderParam) {
      const newScope = `folder:${folderParam}`;
      if (newScope !== filterScope) resetItemsScrollY();
      setFilterScope(newScope);
      try {
        localStorage.setItem(STORAGE_KEY_SCOPE, newScope);
      } catch {
        // Ignore localStorage errors
      }
    } else if (initialScope && !searchParams.toString()) {
      // If we restored from localStorage and URL has no params, reflect it in the URL
      const nextParams = new URLSearchParams(searchParams);
      if (initialScope.startsWith("feed:")) {
        nextParams.set("feed", initialScope.slice(5));
      } else if (initialScope.startsWith("folder:")) {
        nextParams.set("folder", initialScope.slice(7));
      }
      setSearchParams(nextParams, { replace: true });
    }
  }, [searchParams]);

  // Update URL search params and localStorage when filterScope changes
  function onScopeChange(newScope: string) {
    resetItemsScrollY();
    setFilterScope(newScope);
    try {
      if (newScope) {
        localStorage.setItem(STORAGE_KEY_SCOPE, newScope);
      } else {
        localStorage.removeItem(STORAGE_KEY_SCOPE);
      }
    } catch {
      // Ignore localStorage errors
    }
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("feed");
    nextParams.delete("folder");
    if (newScope.startsWith("feed:")) {
      nextParams.set("feed", newScope.slice(5));
    } else if (newScope.startsWith("folder:")) {
      nextParams.set("folder", newScope.slice(7));
    }
    setSearchParams(nextParams, { replace: true });
  }

  useEffect(() => {
    Promise.all([
      api.listFeeds(),
      api.listFolders().catch(() => ({ folders: [] })),
    ])
      .then(([f, fol]) => {
        setFeeds(f);
        setFolders(fol.folders);
        setFeedsLoaded(true);
      })
      .catch((err) => console.error("Failed to load initial feeds/folders:", err));
  }, []);

  const currentFeedId = filterScope.startsWith("feed:") ? Number(filterScope.slice(5)) : undefined;
  const currentFolderId = filterScope.startsWith("folder:") ? Number(filterScope.slice(7)) : undefined;

  /** No search, saved view or feed/folder scope: an empty list then says something about the library as a whole. */
  const plainView = !search && !bookmarkedOnly && currentFeedId === undefined && currentFolderId === undefined;
  /** Feeds exist but none has been fetched yet (just subscribed, the first fetch is still running). */
  const waitingForFirstArticles = plainView && feeds.length > 0 && feeds.every((feed) => !feed.last_polled_at);

  async function reloadFeeds(): Promise<Feed[] | null> {
    try {
      const [f, fol] = await Promise.all([api.listFeeds(), api.listFolders().catch(() => ({ folders: [] }))]);
      setFeeds(f);
      setFolders(fol.folders);
      setFeedsLoaded(true);
      return f;
    } catch (err) {
      console.error("Failed to reload feeds:", err);
      return null;
    }
  }

  async function reloadAfterSubscribing() {
    await reloadFeeds();
    await load();
    announceItemsChanged();
  }

  async function load() {
    const version = ++loadVersion.current;
    setLoading(true);
    setLoadError(false);
    setMoreError(false);
    setLoadingMore(false);
    try {
      const data = await api.listItems({
        feedId: currentFeedId,
        folderId: currentFolderId,
        unreadOnly: effectiveUnreadOnly,
        bookmarkedOnly,
        search: search || undefined,
        limit: PAGE_SIZE,
      });
      if (version === loadVersion.current) {
        setItems(data);
        nextOffset.current = data.length;
        setHasMore(data.length === PAGE_SIZE);
      }
    } catch (error) {
      if (version === loadVersion.current) {
        console.error("Failed to load items:", error);
        setLoadError(true);
      }
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }

  async function loadMore() {
    if (loadingMore || !hasMore) return;
    const version = loadVersion.current;
    setLoadingMore(true);
    setMoreError(false);
    try {
      const data = await api.listItems({
        feedId: currentFeedId,
        folderId: currentFolderId,
        unreadOnly: effectiveUnreadOnly,
        bookmarkedOnly,
        search: search || undefined,
        limit: PAGE_SIZE,
        offset: nextOffset.current,
      });
      if (version === loadVersion.current) {
        nextOffset.current += data.length;
        setItems((previous) => {
          const seen = new Set(previous.map((item) => item.id));
          return [...previous, ...data.filter((item) => !seen.has(item.id))];
        });
        setHasMore(data.length === PAGE_SIZE);
      }
    } catch (error) {
      if (version === loadVersion.current) {
        console.error("Failed to load more items:", error);
        setMoreError(true);
      }
    } finally {
      if (version === loadVersion.current) setLoadingMore(false);
    }
  }

  useEffect(() => {
    setItems([]);
    setLoading(true);
    setHasMore(false);
    setLoadingMore(false);
    const timeout = setTimeout(() => { void load(); }, 200);
    return () => {
      clearTimeout(timeout);
      loadVersion.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterScope, unreadOnly, bookmarkedOnly, search]);

  // After subscribing the first fetch can still be running: look again until a feed has been fetched, then load its articles.
  useEffect(() => {
    if (!waitingForFirstArticles) return;
    let ticks = 0;
    const timer = setInterval(() => {
      ticks++;
      void reloadFeeds().then((list) => {
        if (list?.some((feed) => feed.last_polled_at)) void load();
      });
      if (ticks >= 45) clearInterval(timer);
    }, 4000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitingForFirstArticles]);

  const linkMarkedRead = useRef<number | null>(null);

  // Synchronize selectedArticle with URL ?article=ID parameter
  useEffect(() => {
    if (articleParam) {
      const found = items.find((i) => i.id === Number(articleParam));
      setSelectedArticle(found ?? null);
      // Arriving from a notification: opening the article counts as reading it, once.
      if (found && !found.read && linkMarkedRead.current !== found.id) {
        linkMarkedRead.current = found.id;
        api.markRead(found.id).then(announceItemsChanged).catch(() => {});
        setItems((prev) => prev.map((i) => (i.id === found.id ? { ...i, read: true } : i)));
      }
    } else {
      setSelectedArticle(null);
    }
  }, [articleParam, items]);

  function openArticle(item: Item) {
    setSelectedArticle(item);
    if (!item.read) {
      api.markRead(item.id).then(announceItemsChanged).catch(() => {});
      setItems((prev) => {
        return prev.map((i) => (i.id === item.id ? { ...i, read: true } : i));
      });
      setSelectedArticle({ ...item, read: true });
    }
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("article", String(item.id));
    setSearchParams(nextParams);
  }

  function closeArticle() {
    setSelectedArticle(null);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("article");
    setSearchParams(nextParams);
  }

  const selectedIndex = selectedArticle
    ? items.findIndex((i) => i.id === selectedArticle.id)
    : -1;
  const hasNext = selectedIndex >= 0 && selectedIndex < items.length - 1;
  const hasPrev = selectedIndex > 0;

  function handleNext() {
    if (hasNext) {
      openArticle(items[selectedIndex + 1]);
    }
  }

  function handlePrev() {
    if (hasPrev) {
      openArticle(items[selectedIndex - 1]);
    }
  }

  // Changes need the server; say so instead of failing silently when there is no connection.
  async function whenOnline(action: () => Promise<void>) {
    try {
      await action();
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 0)) throw error;
      toast.error(t("common.offlineAction"));
    }
  }

  async function toggleRead(item: Item) {
    const nextRead = !item.read;
    if (item.read) await api.markUnread(item.id);
    else await api.markRead(item.id);
    announceItemsChanged();
    setItems((prev) => {
      return prev.map((i) => (i.id === item.id ? { ...i, read: nextRead } : i));
    });
    if (selectedArticle?.id === item.id) {
      setSelectedArticle((prev) => (prev ? { ...prev, read: nextRead } : null));
    }
  }

  async function toggleBookmark(item: Item) {
    const nextBookmarked = !item.bookmarked;
    if (item.bookmarked) await api.unbookmarkItem(item.id);
    else await api.bookmarkItem(item.id);
    // The server archives images in the background, so update the offline copy a little later.
    window.setTimeout(() => void syncOfflineCopy({ force: true }), nextBookmarked ? 20_000 : 0);
    setItems((prev) => {
      // In the saved list an unsaved article leaves the list, unless it is open in the reader.
      if (bookmarkedOnly && !nextBookmarked && selectedArticle?.id !== item.id) return prev.filter((i) => i.id !== item.id);
      return prev.map((i) => (i.id === item.id ? { ...i, bookmarked: nextBookmarked } : i));
    });
    if (selectedArticle?.id === item.id) {
      setSelectedArticle((prev) => (prev ? { ...prev, bookmarked: nextBookmarked } : null));
    }
  }

  async function onMarkAllRead() {
    await whenOnline(async () => {
      await api.markAllRead({ feedId: currentFeedId, folderId: currentFolderId });
      await load();
      announceItemsChanged();
    });
  }

  // Shared by the refresh button and pull to refresh, so both give the same feedback.
  const [refreshingAll, setRefreshingAll] = useState(false);
  async function refreshArticles() {
    setRefreshingAll(true);
    try {
      const res = await api.refreshAllFeeds();
      await load();
      toast.success(t("feeds.refreshedAllToast", { count: res.refreshed, newItems: res.newItems }));
      if (res.errors > 0) toast.error(t("feeds.failingCount", { count: res.errors }));
    } catch {
      toast.error(t("items.refreshFailed"));
    } finally {
      setRefreshingAll(false);
    }
  }

  const dateFormatter = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    dateStyle: "medium",
  });

  const timeFormatter = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    timeStyle: "short",
  });

  const scopeOptions = useMemo<SelectOption[]>(() => {
    const list: SelectOption[] = [{ value: "", label: t("items.allFeeds") }];
    if (folders.length > 0) {
      for (const folder of folders) {
        list.push({
          value: `folder:${folder.id}`,
          label: folder.name,
          group: t("feeds.folderGroup"),
          badge: folder.unread_count,
        });
      }
    }
    for (const feed of feeds) {
      list.push({
        value: `feed:${feed.id}`,
        label: feed.label ?? feed.title ?? feed.url,
        group: t("feeds.feedGroup"),
        badge: feed.unread_count,
      });
    }
    return list;
  }, [folders, feeds, t]);

  // The page title names the current filter; the generic title covers feeds that are still loading.
  const scopeTitle = filterScope
    ? scopeOptions.find((option) => option.value === filterScope)?.label ?? t("items.title")
    : t("items.allFeeds");

  function handleItemUpdated(updated: Item) {
    setItems((prev) => prev.map((it) => (it.id === updated.id ? updated : it)));
    if (selectedArticle?.id === updated.id) {
      setSelectedArticle(updated);
    }
  }

  const content = (
    <div className="flex flex-col gap-5 sm:gap-6">
      <div className="flex items-center justify-between gap-2 sm:gap-3">
        <div className="min-w-0">
          <h1 className="sr-only">{scopeTitle}</h1>
          <TodayDate className="block" />
        </div>
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="relative hidden h-11 w-[220px] shrink-0 grid-cols-2 rounded-xl border border-[var(--c-border)] bg-[var(--c-surface)] p-1 sm:grid" role="group" aria-label={t("items.viewMode")}>
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-1 left-1 w-[calc((100%-0.5rem)/2)] rounded-lg border border-[var(--c-mobile-nav-active-border)] bg-[var(--c-mobile-nav-active)] shadow-sm transition-transform duration-300 ease-[cubic-bezier(0.25,1,0.5,1)] motion-reduce:transition-none"
              style={{ transform: viewMode === "newspaper" ? "translateX(100%)" : "translateX(0)" }}
            />
            <button
              type="button"
              onClick={() => changeViewMode("list")}
              title={t("items.listView")}
              aria-label={t("items.listView")}
              aria-pressed={viewMode === "list"}
              className={`relative z-10 flex h-full min-w-0 items-center justify-center gap-1.5 rounded-lg text-xs sm:text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-[var(--c-blue3)] ${viewMode === "list" ? "text-[var(--c-text)]" : "text-[var(--c-text-muted)] hover:text-[var(--c-text)]"}`}
            >
              <svg className={`h-4 w-4 transition-transform duration-200 motion-reduce:transition-none ${viewMode === "list" ? "scale-105" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M8 6h12M8 12h12M8 18h12" /><circle cx="4" cy="6" r="1" fill="currentColor" stroke="none" /><circle cx="4" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="4" cy="18" r="1" fill="currentColor" stroke="none" /></svg>
              <span className="hidden sm:inline">{t("items.listView")}</span>
            </button>
            <button
              type="button"
              onClick={() => changeViewMode("newspaper")}
              title={t("items.newspaperView")}
              aria-label={t("items.newspaperView")}
              aria-pressed={viewMode === "newspaper"}
              className={`relative z-10 flex h-full min-w-0 items-center justify-center gap-1.5 rounded-lg text-xs sm:text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-[var(--c-blue3)] ${viewMode === "newspaper" ? "text-[var(--c-text)]" : "text-[var(--c-text-muted)] hover:text-[var(--c-text)]"}`}
            >
              <svg className={`h-4 w-4 transition-transform duration-200 motion-reduce:transition-none ${viewMode === "newspaper" ? "scale-105" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true"><rect x="2.5" y="3.5" width="19" height="17" rx="2" /><path d="M6 7h7v6H6zM16 7h2M16 10h2M6 16h12M6 18h8" /></svg>
              <span className="hidden sm:inline">{t("items.newspaperView")}</span>
            </button>
          </div>
          <button
            type="button"
            onClick={refreshArticles}
            disabled={refreshingAll || !syncAllowed}
            title={!syncAllowed ? t("plan.unavailable") : refreshingAll ? t("items.refreshing") : t("items.refresh")}
            aria-label={refreshingAll ? t("items.refreshing") : t("items.refresh")}
            className="btn-secondary hidden h-11 w-11 shrink-0 items-center justify-center p-0! sm:flex"
          >
            <RefreshIcon className={`h-5 w-5 ${refreshingAll ? "animate-spin motion-reduce:animate-none" : ""}`} />
          </button>
          <button
            type="button"
            onClick={onMarkAllRead}
            title={t("feeds.markAllRead")}
            aria-label={t("feeds.markAllRead")}
            className="btn-secondary flex h-11 w-11 shrink-0 items-center justify-center p-0!"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12l4 4 6-7M11 16l3 0 7-8" /></svg>
          </button>
        </div>
      </div>

      <div ref={toolbarRef} className="sticky z-20 py-2" style={{ top: headerHeight }}>
        {toolbarDocked && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-px bottom-0 left-1/2 w-screen -translate-x-1/2 border-y border-[var(--c-border)] backdrop-blur-md"
            style={{ backgroundColor: "color-mix(in srgb, var(--c-surface) 85%, transparent)" }}
          />
        )}
        <div className={`items-toolbar relative z-10 flex items-center gap-2 sm:gap-3 ${mobileSearchOpen ? "items-toolbar-open" : ""}`}>
          <div className="items-toolbar-scope min-w-0 flex-1 sm:flex-none sm:w-64" inert={mobileSearchOpen}>
            <CustomSelect
              value={filterScope}
              onChange={onScopeChange}
              options={scopeOptions}
              className="w-full"
              placeholder={t("items.allFeeds")}
            />
          </div>

          <div className="relative hidden sm:block flex-1 min-w-0">
            <input
              type="search"
              placeholder={t("items.searchPlaceholder")}
              aria-label={t("items.searchPlaceholder")}
              className="input w-full pl-9 pr-3"
              value={search}
              onChange={(e) => updateSearch(e.target.value)}
            />
            <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none opacity-45 text-[var(--c-text-muted)]"><SearchIcon /></span>
          </div>

          <div className="items-toolbar-search relative h-[38px] min-w-0 overflow-hidden sm:hidden">
            <button
              ref={mobileSearchButtonRef}
              type="button"
              onClick={() => setMobileSearchOpen(true)}
              aria-label={t("items.searchPlaceholder")}
              aria-controls="mobile-article-search"
              aria-expanded={mobileSearchOpen}
              title={t("items.searchPlaceholder")}
              aria-hidden={mobileSearchOpen}
              tabIndex={mobileSearchOpen ? -1 : 0}
              className={`absolute inset-y-0 left-0 z-10 flex w-[38px] items-center justify-center rounded-lg border transition-opacity duration-150 ${mobileSearchOpen ? "pointer-events-none opacity-0" : search ? "border-[var(--c-blue3)] bg-[var(--c-surface-hover)] text-[var(--c-text)] opacity-100" : "border-[var(--c-border)] bg-[var(--c-surface)] text-[var(--c-text-muted)] opacity-100"}`}
            >
              <SearchIcon />
            </button>
            <div className={`flex h-full min-w-0 items-center gap-2 transition-opacity duration-200 ${mobileSearchOpen ? "opacity-100 delay-75" : "pointer-events-none opacity-0"}`} inert={!mobileSearchOpen}>
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--c-text-muted)] opacity-60"><SearchIcon /></span>
              <input
                id="mobile-article-search"
                ref={mobileSearchRef}
                type="search"
                placeholder={t("items.searchPlaceholder")}
                aria-label={t("items.searchPlaceholder")}
                className="input min-w-0 flex-1 pl-9"
                value={search}
                onChange={(e) => updateSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") closeMobileSearch(); }}
              />
              <button
                type="button"
                onClick={closeMobileSearch}
                aria-label={t("common.close")}
                title={t("common.close")}
                className="w-[38px] h-[38px] rounded-lg border border-[var(--c-border)] bg-[var(--c-surface)] text-[var(--c-text-muted)] flex items-center justify-center shrink-0 cursor-pointer"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>

          <div className="items-toolbar-filters flex items-center gap-1.5 sm:gap-2 shrink-0" inert={mobileSearchOpen}>
            <button
              type="button"
              onClick={toggleBookmarkedOnly}
              title={bookmarkedOnly ? t("items.all") : t("items.bookmarkedOnly")}
              aria-label={t("items.bookmarkedOnly")}
              aria-pressed={bookmarkedOnly}
              className={`w-[38px] h-[38px] rounded-lg border flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
                bookmarkedOnly
                  ? "bg-amber-500/15 border-amber-500/40 text-amber-500"
                  : "bg-[var(--c-surface)] border-[var(--c-border)] text-[var(--c-text-muted)] hover:text-amber-500 hover:border-amber-500/30"
              }`}
            >
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill={bookmarkedOnly ? "currentColor" : "none"}
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            </button>

            <button
              type="button"
              onClick={toggleUnreadOnly}
              disabled={bookmarkedOnly}
              title={bookmarkedOnly ? t("items.unreadIgnoredInSaved") : unreadOnly ? t("items.all") : t("items.unreadOnly")}
              aria-label={t("items.unreadOnly")}
              aria-pressed={effectiveUnreadOnly}
              className={`w-[38px] h-[38px] rounded-lg border flex items-center justify-center shrink-0 transition-colors cursor-pointer disabled:cursor-default disabled:opacity-40 ${
                effectiveUnreadOnly
                  ? "bg-[var(--c-surface-hover)] border-[var(--c-blue3)] text-[var(--c-text)] shadow-xs"
                  : "bg-[var(--c-surface)] border-[var(--c-border)] text-[var(--c-text-muted)] hover:text-[var(--c-text)] hover:border-[var(--c-blue3)]"
              }`}
            >
              <svg
                className="w-3.5 h-3.5"
                viewBox="0 0 24 24"
                fill={effectiveUnreadOnly ? "currentColor" : "none"}
                stroke="currentColor"
                strokeWidth="2.2"
              >
                <circle cx="12" cy="12" r="9" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {feedsLoaded && feeds.length > 0 && !syncAllowed && <PlanNotice />}
      {feedsLoaded && feeds.length > 0 && !loadError && <Intro />}
      {feedsLoaded && feeds.length > 0 && !loadError && <HostNotice />}

      {loadError ? (
        <div role="alert" className="flex flex-col items-start gap-3">
          <p style={{ color: "var(--c-text-muted)" }}>{t("items.loadFailed")}</p>
          <button type="button" onClick={() => void load()} className="btn-secondary">{t("common.retry")}</button>
        </div>
      ) : loading && items.length === 0 ? (
        <LoadingSpinner size="lg" />
      ) : items.length === 0 && plainView && feedsLoaded && feeds.length === 0 ? (
        <Welcome onSubscribed={reloadAfterSubscribing} />
      ) : items.length === 0 && waitingForFirstArticles ? (
        <div role="status" className="card flex flex-col items-center gap-3 px-6 py-12 text-center">
          <LoadingSpinner size="lg" />
          <h2 className="text-lg font-semibold">{t("welcome.fetchingTitle")}</h2>
          <p className="max-w-sm text-sm text-[var(--c-text-muted)]">{t("welcome.fetchingHint")}</p>
        </div>
      ) : items.length === 0 && plainView && effectiveUnreadOnly && feeds.length > 0 ? (
        <div className="card flex flex-col items-center gap-3 px-6 py-12 text-center">
          <h2 className="text-lg font-semibold">{t("items.allReadTitle")}</h2>
          <p className="max-w-sm text-sm text-[var(--c-text-muted)]">{t("items.allReadHint")}</p>
          <button type="button" onClick={() => setUnreadOnly(false)} className="btn-secondary mt-1">{t("items.all")}</button>
        </div>
      ) : items.length === 0 ? (
        <p style={{ color: "var(--c-text-muted)" }}>{bookmarkedOnly && !search ? t("items.noSaved") : search ? t("items.noResults") : t("items.noItems")}</p>
      ) : activeView === "newspaper" ? (
        <NewspaperGrid items={items} onOpen={openArticle} onBookmark={toggleBookmark} onRead={toggleRead} />
      ) : (
        <ul className="flex flex-col gap-4 sm:gap-5 animate-page-fade">
          {items.map((item) => {
            const pubDate = item.published_at ? new Date(item.published_at) : null;

            return (
              <li
                key={item.id}
                onClick={() => openArticle(item)}
                className="card overflow-hidden p-4 sm:p-0 transition-colors duration-150 hover:bg-[var(--c-surface-hover)] hover:border-[var(--c-blue3)]/60 cursor-pointer group/card"
                style={{ opacity: item.read ? 0.6 : 1 }}
              >
                <div className="flex flex-col sm:flex-row sm:items-stretch justify-between gap-3 sm:gap-0">
                  {/* Article thumbnail if available */}
                  {item.image_url && (
                    <div
                      className="order-first w-[calc(100%+2rem)] -mx-4 -mt-4 sm:m-0 sm:w-52 sm:min-w-52 h-48 sm:h-auto sm:self-stretch overflow-hidden shrink-0 border-b sm:border-b-0 sm:border-r bg-[var(--c-bg)] group transition-opacity hover:opacity-90 block"
                      style={{ borderColor: "var(--c-border)" }}
                    >
                      <img
                        src={item.image_url}
                        alt=""
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                        loading="lazy"
                        onError={(e) => {
                          const parent = (e.currentTarget as HTMLElement).parentElement;
                          if (parent) parent.style.display = "none";
                        }}
                      />
                    </div>
                  )}

                  <div className="min-w-0 flex-1 sm:p-5 sm:pr-3 flex flex-col justify-between">
                    <div>
                      {/* Source row above headline with optional Favicon */}
                      <div className="mb-3 flex min-w-0 items-center gap-2 text-xs font-semibold tracking-[0.08em] uppercase text-[var(--c-text-muted)]">
                        <Favicon
                          feedId={item.feed_id}
                          iconUrl={item.feed_icon_url}
                          siteUrl={item.feed_site_url}
                          feedUrl={item.feed_url}
                          articleUrl={item.link}
                          className="w-3.5 h-3.5 rounded-xs shrink-0 object-contain"
                        />
                        <span className="truncate">{item.feed_title}</span>
                      </div>

                      <h2 className="text-lg leading-snug font-semibold text-[var(--c-text)]">
                        {item.title}
                      </h2>

                      <ArticleExcerpt item={item} className="mt-3 text-sm leading-relaxed line-clamp-3 text-[var(--c-text-muted)]" />
                    </div>

                    {/* Meta information row BELOW article text with icons and mobile action buttons */}
                    <div className="flex items-center justify-between gap-3 text-xs pt-5" style={{ color: "var(--c-text-muted)" }}>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 min-w-0">
                        {pubDate && (
                          <>
                            {/* Calendar date */}
                            <span className="inline-flex items-center gap-1.5">
                              <svg
                                className="w-3.5 h-3.5 shrink-0 opacity-70"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                                <line x1="16" y1="2" x2="16" y2="6" />
                                <line x1="8" y1="2" x2="8" y2="6" />
                                <line x1="3" y1="10" x2="21" y2="10" />
                              </svg>
                              <span>{dateFormatter.format(pubDate)}</span>
                            </span>

                            {/* Clock time */}
                            <span className="inline-flex items-center gap-1.5">
                              <svg
                                className="w-3.5 h-3.5 shrink-0 opacity-70"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <circle cx="12" cy="12" r="10" />
                                <polyline points="12 6 12 12 16 14" />
                              </svg>
                              <span>{timeFormatter.format(pubDate)}</span>
                            </span>
                          </>
                        )}
                      </div>

                      {/* Action buttons on mobile (inline with meta row) */}
                      <div
                        className="flex sm:hidden items-center gap-2 shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleBookmark(item);
                          }}
                          title={item.bookmarked ? t("items.unbookmark") : t("items.bookmark")}
                          aria-label={item.bookmarked ? t("items.unbookmark") : t("items.bookmark")}
                          className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
                            item.bookmarked
                              ? "bg-amber-500/15 border-amber-500/40 text-amber-500"
                              : "bg-[var(--c-surface)] border-[var(--c-border)] text-[var(--c-text-muted)] hover:text-amber-500 hover:border-amber-500/30"
                          }`}
                        >
                          <svg
                            className="w-4 h-4"
                            viewBox="0 0 24 24"
                            fill={item.bookmarked ? "currentColor" : "none"}
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleRead(item);
                          }}
                          title={item.read ? t("items.markUnread") : t("items.markRead")}
                          aria-label={item.read ? t("items.markUnread") : t("items.markRead")}
                          className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
                            !item.read
                              ? "bg-[var(--c-surface)] border-[var(--c-border)] text-[var(--c-blue1)] hover:border-[var(--c-blue3)]"
                              : "bg-[var(--c-surface)] border-[var(--c-border)] text-[var(--c-text-muted)] hover:text-[var(--c-text)] hover:border-[var(--c-blue3)]"
                          }`}
                        >
                          <svg
                            className="w-3.5 h-3.5"
                            viewBox="0 0 24 24"
                            fill={!item.read ? "currentColor" : "none"}
                            stroke="currentColor"
                            strokeWidth="2.2"
                          >
                            <circle cx="12" cy="12" r="9" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Desktop action buttons (top right) */}
                  <div
                    className="hidden sm:flex items-center gap-2 pt-5 pr-5 shrink-0 self-start"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleBookmark(item);
                      }}
                      title={item.bookmarked ? t("items.unbookmark") : t("items.bookmark")}
                      aria-label={item.bookmarked ? t("items.unbookmark") : t("items.bookmark")}
                      className={`w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
                        item.bookmarked
                          ? "bg-amber-500/15 border-amber-500/40 text-amber-500"
                          : "bg-[var(--c-surface)] border-[var(--c-border)] text-[var(--c-text-muted)] hover:text-amber-500 hover:border-amber-500/30"
                      }`}
                    >
                      <svg
                        className="w-4 h-4"
                        viewBox="0 0 24 24"
                        fill={item.bookmarked ? "currentColor" : "none"}
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleRead(item);
                      }}
                      title={item.read ? t("items.markUnread") : t("items.markRead")}
                      aria-label={item.read ? t("items.markUnread") : t("items.markRead")}
                      className={`w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
                        !item.read
                          ? "bg-[var(--c-surface)] border-[var(--c-border)] text-[var(--c-blue1)] hover:border-[var(--c-blue3)]"
                          : "bg-[var(--c-surface)] border-[var(--c-border)] text-[var(--c-text-muted)] hover:text-[var(--c-text)] hover:border-[var(--c-blue3)]"
                      }`}
                    >
                      <svg
                        className="w-3.5 h-3.5"
                        viewBox="0 0 24 24"
                        fill={!item.read ? "currentColor" : "none"}
                        stroke="currentColor"
                        strokeWidth="2.2"
                      >
                        <circle cx="12" cy="12" r="9" />
                      </svg>
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {!loadError && items.length > 0 && (hasMore || moreError) && (
        <button
          type="button"
          onClick={() => { void loadMore(); }}
          disabled={loadingMore}
          className="btn-secondary self-center"
        >
          {loadingMore ? t("common.loading") : moreError ? t("common.retry") : t("common.loadMore")}
        </button>
      )}

      {/* Modern Slide-over Reader Modal */}
      <ArticleReaderModal
        item={selectedArticle}
        isOpen={Boolean(selectedArticle)}
        onClose={closeArticle}
        onToggleBookmark={toggleBookmark}
        onToggleRead={toggleRead}
        onNext={handleNext}
        onPrevious={handlePrev}
        onItemUpdated={handleItemUpdated}
        hasNext={hasNext}
        hasPrev={hasPrev}
      />
    </div>
  );

  return (
    <PullToRefresh disabled={loading || !syncAllowed || Boolean(selectedArticle) || mobileSearchOpen} onRefresh={refreshArticles}>
      {content}
    </PullToRefresh>
  );
}
