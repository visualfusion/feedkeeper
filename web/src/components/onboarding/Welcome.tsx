import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError, type Feed } from "../../api/client.ts";
import { resolveOnboarding, resolveStarterPacks, type ResolvedStarterPack } from "../../extensions/host.ts";
import { useExtensions } from "../../extensions/useExtensions.ts";
import { BUILT_IN_STARTER_PACKS, feedsForLanguage } from "../../onboarding/starterPacks.ts";
import { toast } from "../../utils/toast.ts";
import { AddFeedPanel } from "../feeds/AddFeedPanel.tsx";
import { UploadIcon } from "../feeds/icons.tsx";
import { ExtensionMount } from "../settings/ExtensionMount.tsx";
import { PlanNotice } from "../PlanNotice.tsx";
import { usePlanLimits } from "../../utils/planLimits.ts";

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
 * What a person without feeds sees: add a site by its address, pick a starter pack or import a subscription file.
 * Used on the articles page and on the feeds page, so both lead to the same first steps.
 */
export function Welcome({ onSubscribed }: { onSubscribed: () => void | Promise<void> }) {
  const { t, i18n } = useTranslation();
  const { syncAllowed } = usePlanLimits();
  const extensions = useExtensions();
  const hostWelcome = resolveOnboarding(extensions);
  const language = i18n.resolvedLanguage || "en";
  const packs = useMemo(
    () => resolveStarterPacks(extensions, BUILT_IN_STARTER_PACKS, language)
      .map((pack) => ({ ...pack, feeds: feedsForLanguage(pack, language) }))
      .filter((pack) => pack.feeds.length > 0),
    [extensions, language],
  );
  const [openPack, setOpenPack] = useState<string | null>(null);
  const [unchecked, setUncheckedFeeds] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<Progress | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const pack = packs.find((entry) => entry.id === openPack) ?? null;
  const chosen = pack ? pack.feeds.filter((feed) => !unchecked.has(feed.url)) : [];

  function toggleFeed(url: string) {
    setUncheckedFeeds((current) => {
      const next = new Set(current);
      if (!next.delete(url)) next.add(url);
      return next;
    });
  }

  async function subscribeChosen(selected: ResolvedStarterPack) {
    const feeds = selected.feeds.filter((feed) => !unchecked.has(feed.url));
    if (feeds.length === 0) return;
    setProgress({ done: 0, total: feeds.length });
    const folderId = await folderIdFor(selected.title);
    let added = 0;
    let failed = 0;
    let finished = 0;
    // A few at a time: every address is fetched once to check it, and a slow site must not hold up the others.
    const queue = [...feeds];
    const worker = async () => {
      for (let feed = queue.shift(); feed; feed = queue.shift()) {
        try {
          await api.subscribeFeed(feed.url, null, folderId);
          added++;
        } catch (error) {
          // A feed that is subscribed to already is as good as added.
          if (error instanceof ApiError && error.code === "already_subscribed") added++;
          else failed++;
        }
        setProgress({ done: ++finished, total: feeds.length });
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, feeds.length) }, worker));
    setProgress(null);
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

  function PackIcon({ id }: { id: string }) {
    switch (id) {
      case "news":
        return (
          <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2" />
            <path d="M18 14h-8" />
            <path d="M15 18h-5" />
            <path d="M10 6h8v4h-8V6Z" />
          </svg>
        );
      case "technology":
        return (
          <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect width="20" height="14" x="2" y="3" rx="2" />
            <line x1="8" x2="16" y1="21" y2="21" />
            <line x1="12" x2="12" y1="17" y2="21" />
          </svg>
        );
      case "apple":
        return (
          <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 6.37c.62-.75 1.04-1.8 0.93-2.85-.9.04-1.99.6-2.63 1.35-.57.65-1.07 1.71-.93 2.73.99.08 2.02-.48 2.63-1.23Z" />
          </svg>
        );
      case "science":
        return (
          <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10 2v7.527a2 2 0 0 1-.211.896L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.069-10.127A2 2 0 0 1 14 9.527V2" />
            <path d="M8.5 2h7" />
            <path d="M7 16h10" />
          </svg>
        );
      case "design":
        return (
          <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
            <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
            <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
            <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
            <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.563-2.512 5.563-5.563C22 6.5 17.5 2 12 2Z" />
          </svg>
        );
      default:
        return null;
    }
  }

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
        {/* Path 1: Starter Packs */}
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
              {packs.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  aria-pressed={openPack === entry.id}
                  disabled={busy}
                  onClick={() => { setOpenPack(openPack === entry.id ? null : entry.id); setUncheckedFeeds(new Set()); }}
                  className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs sm:text-sm font-semibold cursor-pointer transition-all ${
                    openPack === entry.id
                      ? "border-[var(--c-blue1)] bg-[var(--c-blue1)] text-white shadow-xs"
                      : "border-[var(--c-border)] bg-[var(--c-surface)] hover:border-[var(--c-blue3)] hover:bg-[var(--c-surface-hover)] text-[var(--c-text)]"
                  }`}
                >
                  <PackIcon id={entry.id} />
                  <span>{entry.title}</span>
                </button>
              ))}
            </div>
            {pack && (
              <div className="flex flex-col gap-3 pt-2 animate-fade-in border-t border-[var(--c-border)]/60">
                {pack.description && <p className="text-xs sm:text-sm text-[var(--c-text-muted)]">{pack.description}</p>}
                <ul className="divide-y divide-[var(--c-border)] rounded-xl border border-[var(--c-border)] bg-[var(--c-surface)]">
                  {pack.feeds.map((feed) => (
                    <li key={feed.url}>
                      <label className="flex cursor-pointer items-center gap-3 px-3.5 py-2.5 hover:bg-[var(--c-surface-hover)]/50 transition-colors">
                        <input type="checkbox" checked={!unchecked.has(feed.url)} disabled={busy} onChange={() => toggleFeed(feed.url)} className="rounded accent-[var(--c-blue1)]" />
                        <span className="min-w-0 flex-1 truncate text-xs sm:text-sm font-medium">{feed.title}</span>
                        {feed.lang && <span className="shrink-0 text-[0.625rem] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--c-surface-hover)] text-[var(--c-text-muted)]">{feed.lang}</span>}
                      </label>
                    </li>
                  ))}
                </ul>
                <button type="button" disabled={busy || chosen.length === 0} onClick={() => void subscribeChosen(pack)} className="btn-primary self-start text-xs sm:text-sm font-semibold px-4 py-2">
                  {progress ? t("welcome.subscribingProgress", { done: progress.done, total: progress.total }) : t("welcome.subscribePack", { count: chosen.length })}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Path 2: Add single Website/Feed */}
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

        {/* Path 3: Import OPML */}
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
