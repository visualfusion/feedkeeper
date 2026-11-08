import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError, type Feed, type FeedList } from "../../api/client.ts";
import { resolveOnboarding, resolveStarterPacks } from "../../extensions/host.ts";
import { useExtensions } from "../../extensions/useExtensions.ts";
import { feedsForLanguage, feedsInAllLanguages } from "../../onboarding/feedLists.ts";
import { toast } from "../../utils/toast.ts";
import { AddFeedPanel } from "../feeds/AddFeedPanel.tsx";
import { UploadIcon } from "../feeds/icons.tsx";
import { ExtensionMount } from "../settings/ExtensionMount.tsx";
import { PlanNotice } from "../PlanNotice.tsx";
import { usePlanLimits } from "../../utils/planLimits.ts";
import { PackIcon } from "./PackIcon.tsx";

interface Progress { done: number; total: number }

/** The folder with this name, created when there is none yet; null when folders are not available. */
async function folderIdFor(name: string): Promise<number | null> {
  try {
    const existing = (await api.listFolders()).folders.find((folder) => folder.name === name);
    return existing ? existing.id : (await api.createFolder(name)).id;
  } catch {
    return null;
  }
}

/**
 * What a person without feeds sees: add a site by its address, pick feeds from the lists or import a subscription file.
 * Used on the articles page and on the feeds page, so both lead to the same first steps.
 */
export function Welcome({ onSubscribed }: { onSubscribed: () => void | Promise<void> }) {
  const { t, i18n } = useTranslation();
  const { syncAllowed } = usePlanLimits();
  const extensions = useExtensions();
  const hostWelcome = resolveOnboarding(extensions);
  const language = i18n.resolvedLanguage || "en";
  const [serverLists, setServerLists] = useState<FeedList[]>([]);
  const [allLanguages, setAllLanguages] = useState(false);
  const packs = useMemo(
    () => resolveStarterPacks(extensions, serverLists, language)
      .map((pack) => ({ ...pack, feeds: allLanguages ? feedsInAllLanguages(pack, language) : feedsForLanguage(pack, language) }))
      .filter((pack) => pack.feeds.length > 0),
    [extensions, serverLists, language, allLanguages],
  );
  const [openPack, setOpenPack] = useState<string | null>(null);
  // The chosen addresses over all lists, so feeds from different lists can be added together.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<Progress | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const pack = packs.find((entry) => entry.id === openPack) ?? packs[0] ?? null;
  const chosenCount = packs.reduce((sum, entry) => sum + entry.feeds.filter((feed) => selected.has(feed.url)).length, 0);
  const allOfPackChosen = pack !== null && pack.feeds.every((feed) => selected.has(feed.url));

  useEffect(() => {
    let current = true;
    api.feedLists(language).then(
      (response) => { if (current) setServerLists(response.lists); },
      // Without the server's lists the host's own packs and the other ways to add feeds still work.
      () => { if (current) setServerLists([]); },
    );
    return () => { current = false; };
  }, [language]);

  function toggleFeed(url: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(url)) next.add(url);
      return next;
    });
  }

  function toggleAllOfPack() {
    if (!pack) return;
    setSelected((current) => {
      const next = new Set(current);
      for (const feed of pack.feeds) {
        if (allOfPackChosen) next.delete(feed.url);
        else next.add(feed.url);
      }
      return next;
    });
  }

  async function subscribeChosen() {
    const jobs: Array<{ url: string; folderName: string }> = [];
    for (const entry of packs) {
      for (const feed of entry.feeds) if (selected.has(feed.url)) jobs.push({ url: feed.url, folderName: entry.title });
    }
    if (jobs.length === 0) return;
    setProgress({ done: 0, total: jobs.length });
    const folderIds = new Map<string, number | null>();
    for (const name of new Set(jobs.map((job) => job.folderName))) folderIds.set(name, await folderIdFor(name));
    let added = 0;
    let failed = 0;
    let finished = 0;
    const done = new Set<string>();
    // A few at a time: every address is fetched once to check it, and a slow site must not hold up the others.
    const queue = [...jobs];
    const worker = async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        try {
          await api.subscribeFeed(job.url, null, folderIds.get(job.folderName) ?? null);
          added++;
          done.add(job.url);
        } catch (error) {
          // A feed that is subscribed to already is as good as added.
          if (error instanceof ApiError && error.code === "already_subscribed") {
            added++;
            done.add(job.url);
          } else failed++;
        }
        setProgress({ done: ++finished, total: jobs.length });
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, jobs.length) }, worker));
    setProgress(null);
    // What went wrong stays chosen, so it can be tried again.
    setSelected((current) => new Set([...current].filter((url) => !done.has(url))));
    if (failed > 0) toast.error(t("welcome.packPartial", { added, failed }));
    else toast.success(t("welcome.packAdded", { count: added }));
    if (added > 0) await onSubscribed();
  }

  async function onFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const result = await api.importOpml(await file.text());
      if (result.failed > 0) toast.error(t("feeds.importPartial", { imported: result.imported, skipped: result.skipped, failed: result.failed }));
      else toast.success(t("feeds.importSuccess", { imported: result.imported, skipped: result.skipped }));
      if (result.imported > 0) await onSubscribed();
    } catch {
      toast.error(t("feeds.importFailed"));
    } finally {
      setImporting(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function onAdded(feed: Feed) {
    toast.success(t("feeds.subscribedToast", { title: feed.label || feed.title || feed.url }));
    await onSubscribed();
  }

  const busy = progress !== null || importing;

  // An account whose plan does not include adding feeds gets the reason instead of the first steps.
  if (!syncAllowed) return <PlanNotice />;

  return (
    <section className="card flex flex-col gap-6 p-5 sm:p-7 shadow-xs" aria-labelledby="welcome-title">
      <div className="flex flex-col gap-2">
        <div className="min-w-0">
          <h2 id="welcome-title" className="text-xl sm:text-2xl font-bold tracking-tight text-[var(--c-text)]" style={{ fontFamily: "Manrope, sans-serif" }}>
            {t("welcome.title")}
          </h2>
          <p className="max-w-xl text-xs sm:text-sm text-[var(--c-text-muted)] mt-0.5 leading-relaxed">{t("welcome.intro")}</p>
        </div>
      </div>

      {hostWelcome && <ExtensionMount name="onboarding" mount={hostWelcome.mount} />}

      <div className="grid grid-cols-1 gap-4">
        {/* Starter packs */}
        {packs.length > 0 && (
          <div className="rounded-2xl border border-[var(--c-border)]/80 bg-[var(--c-surface-hover)]/25 p-4 sm:p-5 flex flex-col gap-3.5">
            <div>
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-[var(--c-blue1)]/10 text-[var(--c-blue1)] flex items-center justify-center shrink-0">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="10"/>
                    <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>
                  </svg>
                </div>
                <h3 className="text-sm sm:text-base font-bold text-[var(--c-text)]" style={{ fontFamily: "Manrope, sans-serif" }}>{t("welcome.packsTitle")}</h3>
              </div>
              <p className="text-xs sm:text-sm text-[var(--c-text-muted)] mt-1 ml-9.5">{t("welcome.packsHint")}</p>
            </div>
            <div className="flex flex-wrap gap-2" role="group" aria-label={t("welcome.packsTitle")}>
              {packs.map((entry) => {
                const count = entry.feeds.filter((feed) => selected.has(feed.url)).length;
                const active = pack?.id === entry.id;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    aria-pressed={active}
                    disabled={busy}
                    onClick={() => setOpenPack(entry.id)}
                    className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs sm:text-sm font-semibold cursor-pointer transition-all ${
                      active
                        ? "border-[var(--c-blue1)] bg-[var(--c-blue1)] text-white shadow-xs"
                        : "border-[var(--c-border)] bg-[var(--c-surface)] hover:border-[var(--c-blue3)] hover:bg-[var(--c-surface-hover)] text-[var(--c-text)]"
                    }`}
                  >
                    <PackIcon id={entry.id} />
                    <span>{entry.title}</span>
                    {count > 0 && (
                      <span className={`rounded-full px-1.5 text-[0.625rem] font-bold leading-4 ${active ? "bg-white/25 text-white" : "bg-[var(--c-blue1)] text-white"}`}>{count}</span>
                    )}
                  </button>
                );
              })}
            </div>
            {pack && (
              <div className="flex flex-col gap-3 pt-2 animate-fade-in border-t border-[var(--c-border)]/60">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                  {pack.description && <p className="text-xs sm:text-sm text-[var(--c-text-muted)]">{pack.description}</p>}
                  <button type="button" disabled={busy} onClick={toggleAllOfPack} className="text-xs sm:text-sm font-semibold text-[var(--c-blue1)] cursor-pointer hover:underline">
                    {allOfPackChosen ? t("welcome.deselectAll") : t("welcome.selectAll")}
                  </button>
                </div>
                <ul className="divide-y divide-[var(--c-border)] rounded-xl border border-[var(--c-border)] bg-[var(--c-surface)]">
                  {pack.feeds.map((feed) => (
                    <li key={feed.url}>
                      <label className="flex cursor-pointer items-start gap-3 px-3.5 py-2.5 hover:bg-[var(--c-surface-hover)]/50 transition-colors">
                        <input type="checkbox" checked={selected.has(feed.url)} disabled={busy} onChange={() => toggleFeed(feed.url)} className="mt-0.5 rounded accent-[var(--c-blue1)]" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs sm:text-sm font-medium">{feed.title}</span>
                          {feed.description && <span className="block text-xs text-[var(--c-text-muted)] leading-snug">{feed.description}</span>}
                        </span>
                        {feed.lang && <span className="shrink-0 text-[0.625rem] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--c-surface-hover)] text-[var(--c-text-muted)]">{feed.lang}</span>}
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <button type="button" disabled={busy || chosenCount === 0} onClick={() => void subscribeChosen()} className="btn-primary self-start text-xs sm:text-sm font-semibold px-4 py-2">
                {progress ? t("welcome.subscribingProgress", { done: progress.done, total: progress.total }) : t("welcome.subscribePack", { count: chosenCount })}
              </button>
              <label className="inline-flex items-center gap-2 text-xs sm:text-sm text-[var(--c-text-muted)] cursor-pointer">
                <input type="checkbox" checked={allLanguages} disabled={busy} onChange={(event) => setAllLanguages(event.target.checked)} className="rounded accent-[var(--c-blue1)]" />
                {t("welcome.allLanguages")}
              </label>
            </div>
          </div>
        )}

        {/* Add single feed or site */}
        <div className="rounded-2xl border border-[var(--c-border)]/80 bg-[var(--c-surface-hover)]/25 p-4 sm:p-5 flex flex-col gap-3.5">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[var(--c-blue1)]/10 text-[var(--c-blue1)] flex items-center justify-center shrink-0">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
                <path d="M2 12h20" />
              </svg>
            </div>
            <h3 className="text-sm sm:text-base font-bold text-[var(--c-text)]" style={{ fontFamily: "Manrope, sans-serif" }}>{t("welcome.addTitle")}</h3>
          </div>
          <AddFeedPanel compact folderOptions={[]} defaultFolderId={null} onClose={() => {}} onAdded={onAdded} />
        </div>

        {/* OPML import */}
        <div className="rounded-2xl border border-[var(--c-border)]/80 bg-[var(--c-surface-hover)]/25 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-[var(--c-blue1)]/10 text-[var(--c-blue1)] flex items-center justify-center shrink-0">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 8v13H3V8" />
                  <path d="M1 3h22v5H1z" />
                  <path d="M10 12h4" />
                </svg>
              </div>
              <h3 className="text-sm sm:text-base font-bold text-[var(--c-text)]" style={{ fontFamily: "Manrope, sans-serif" }}>{t("welcome.importTitle")}</h3>
            </div>
            <p className="text-xs sm:text-sm text-[var(--c-text-muted)] mt-1 ml-9.5">{t("welcome.importHint")}</p>
          </div>
          <button type="button" disabled={busy} onClick={() => fileInput.current?.click()} className="btn-secondary inline-flex items-center gap-2 shrink-0 text-xs sm:text-sm font-semibold px-4 py-2">
            <UploadIcon />
            {importing ? t("feeds.importing") : t("feeds.importOpml")}
          </button>
          <input type="file" ref={fileInput} onChange={onFileSelected} accept=".opml,.xml,text/xml,application/xml" className="hidden" />
        </div>
      </div>
    </section>
  );
}
