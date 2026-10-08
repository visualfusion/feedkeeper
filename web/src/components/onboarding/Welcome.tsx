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

  return (
    <section className="card flex flex-col gap-6 p-5 sm:p-7" aria-labelledby="welcome-title">
      <div className="flex flex-col gap-2">
        <h2 id="welcome-title" className="text-xl font-semibold">{t("welcome.title")}</h2>
        <p className="max-w-xl text-sm text-[var(--c-text-muted)]">{t("welcome.intro")}</p>
      </div>

      {hostWelcome && <ExtensionMount name="onboarding" mount={hostWelcome.mount} />}

      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">{t("welcome.addTitle")}</h3>
        <AddFeedPanel compact folderOptions={[]} defaultFolderId={null} onClose={() => {}} onAdded={onAdded} />
      </div>

      {packs.length > 0 && (
        <div className="flex flex-col gap-3">
          <div>
            <h3 className="text-sm font-semibold">{t("welcome.packsTitle")}</h3>
            <p className="text-sm text-[var(--c-text-muted)]">{t("welcome.packsHint")}</p>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label={t("welcome.packsTitle")}>
            {packs.map((entry) => (
              <button
                key={entry.id}
                type="button"
                aria-pressed={openPack === entry.id}
                disabled={busy}
                onClick={() => { setOpenPack(openPack === entry.id ? null : entry.id); setUncheckedFeeds(new Set()); }}
                className={`rounded-full border px-4 py-1.5 text-sm font-medium cursor-pointer transition-colors ${openPack === entry.id ? "border-[var(--c-text)] bg-[var(--c-surface-hover)]" : "border-[var(--c-border)] hover:bg-[var(--c-surface-hover)]"}`}
              >
                {entry.title}
              </button>
            ))}
          </div>
          {pack && (
            <div className="flex flex-col gap-3 animate-fade-in">
              {pack.description && <p className="text-sm text-[var(--c-text-muted)]">{pack.description}</p>}
              <ul className="divide-y divide-[var(--c-border)] rounded-xl border border-[var(--c-border)]">
                {pack.feeds.map((feed) => (
                  <li key={feed.url}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5">
                      <input type="checkbox" checked={!unchecked.has(feed.url)} disabled={busy} onChange={() => toggleFeed(feed.url)} />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{feed.title}</span>
                      {feed.lang && <span className="shrink-0 text-xs uppercase text-[var(--c-text-muted)]">{feed.lang}</span>}
                    </label>
                  </li>
                ))}
              </ul>
              <button type="button" disabled={busy || chosen.length === 0} onClick={() => void subscribeChosen(pack)} className="btn-primary self-start">
                {progress ? t("welcome.subscribingProgress", { done: progress.done, total: progress.total }) : t("welcome.subscribePack", { count: chosen.length })}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2 border-t border-[var(--c-border)] pt-4">
        <h3 className="text-sm font-semibold">{t("welcome.importTitle")}</h3>
        <p className="text-sm text-[var(--c-text-muted)]">{t("welcome.importHint")}</p>
        <button type="button" disabled={busy} onClick={() => fileInput.current?.click()} className="btn-secondary inline-flex items-center gap-1.5 self-start">
          <UploadIcon />
          {importing ? t("feeds.importing") : t("feeds.importOpml")}
        </button>
        <input type="file" ref={fileInput} onChange={onFileSelected} accept=".opml,.xml,text/xml,application/xml" className="hidden" />
      </div>
    </section>
  );
}
