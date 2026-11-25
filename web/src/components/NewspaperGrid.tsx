import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Item } from "../api/client.ts";
import { Favicon } from "./Favicon.tsx";
import { ArticleExcerpt } from "./ArticleExcerpt.tsx";
import { JapaneseText } from "./JapaneseText.tsx";
import { editorialCompanions, editorialFeatures } from "../utils/editorialLayout.ts";
import { textLanguage } from "../utils/japanese.ts";

interface NewspaperGridProps {
  items: Item[];
  focusedItemId?: number | null;
  onOpen: (item: Item) => void;
  onBookmark: (item: Item) => void;
  onRead: (item: Item) => void;
}

function EditorialImage({ url, featured }: { url: string | null | undefined; featured: boolean }) {
  const [status, setStatus] = useState<"loading" | "visible" | "hidden">("loading");
  if (!url || !/^https?:\/\//i.test(url)) return null;

  return (
    <div className={status === "hidden" ? "hidden" : "overflow-hidden border-b border-[var(--c-border)] bg-[var(--c-bg)]"}>
      <img
        src={url}
        alt=""
        loading="lazy"
        className={`w-full object-cover transition-transform duration-300 group-hover:scale-[1.025] ${featured ? "aspect-[3/2] lg:aspect-[16/9]" : "aspect-[3/2]"} ${status === "visible" ? "opacity-100" : "opacity-0"}`}
        onLoad={(event) => {
          const { naturalWidth, naturalHeight } = event.currentTarget;
          setStatus(naturalWidth >= (featured ? 400 : 160) && naturalHeight >= (featured ? 220 : 100) ? "visible" : "hidden");
        }}
        onError={() => setStatus("hidden")}
      />
    </div>
  );
}

/** A feature spans two of the three columns only from `lg` up; below that it is a card like any other, so its look follows the viewport. */
function EditorialCard({ item, featured, besideFeature, focused, onOpen, onBookmark, onRead }: {
  item: Item;
  featured: boolean;
  besideFeature: boolean;
  focused: boolean;
  onOpen: (item: Item) => void;
  onBookmark: (item: Item) => void;
  onRead: (item: Item) => void;
}) {
  const { t, i18n } = useTranslation();
  const pubDate = item.published_at ? new Date(item.published_at) : null;
  const date = pubDate && !Number.isNaN(pubDate.getTime()) ? pubDate : null;
  const formattedDate = date ? new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: "medium" }).format(date) : null;
  const formattedTime = date ? new Intl.DateTimeFormat(i18n.resolvedLanguage, { timeStyle: "short" }).format(date) : null;

  return (
    <li data-item-id={item.id} className={featured ? "lg:col-span-2" : ""}>
      <article
        className={`card group relative flex h-full flex-col overflow-hidden transition-colors duration-150 hover:border-[var(--c-blue3)] hover:bg-[var(--c-surface-hover)] ${
          focused ? "ring-2 ring-[var(--c-blue3)] border-[var(--c-blue3)] bg-[var(--c-surface-hover)]" : ""
        }`}
        style={{ opacity: item.read ? 0.65 : 1 }}
      >
        <button
          type="button"
          className="absolute inset-0 z-10 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-[var(--c-blue3)]"
          aria-label={item.title || item.feed_title || t("items.title")}
          onClick={() => onOpen(item)}
        />
        <EditorialImage key={item.image_url ?? ""} url={item.image_url} featured={featured} />
        <div className={`flex min-w-0 flex-1 flex-col ${featured ? "p-4 sm:p-5 lg:p-6" : "p-4 sm:p-5"}`}>
          <div className="mb-3 flex min-w-0 items-center gap-2 text-xs font-semibold tracking-[0.08em] uppercase text-[var(--c-text-muted)]">
            <Favicon feedId={item.feed_id} iconUrl={item.feed_icon_url} siteUrl={item.feed_site_url} feedUrl={item.feed_url} articleUrl={item.link} className="h-3.5 w-3.5 shrink-0 rounded-xs object-contain" />
            <span className="truncate">{item.feed_title}</span>
          </div>
          <h2
            lang={textLanguage(item.title || item.feed_title)}
            className={`text-[var(--c-text)] ${featured ? "text-lg leading-snug lg:text-2xl lg:leading-tight" : "text-lg leading-snug"} font-semibold${textLanguage(item.title || item.feed_title) === "ja" ? " ja-phrases" : ""}`}
          >
            {(item.title || item.feed_title) ? <JapaneseText text={(item.title || item.feed_title)!} /> : null}
          </h2>
          <ArticleExcerpt
            item={item}
            className={`mt-3 text-sm leading-relaxed text-[var(--c-text-muted)] ${featured ? "line-clamp-3 lg:line-clamp-4" : besideFeature ? "line-clamp-3 lg:line-clamp-12" : "line-clamp-3"}`}
          />
          <div className="pointer-events-none relative z-20 mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 pt-5 text-xs text-[var(--c-text-muted)]">
            {formattedDate && (
              <span className="inline-flex items-center gap-1.5" title={formattedTime ?? undefined}>
                <svg className="h-3.5 w-3.5 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M8 2v4M16 2v4M3 10h18" /></svg>
                {formattedDate}
              </span>
            )}
            {formattedTime && (
              <span className="inline-flex items-center gap-1.5">
                <svg className="h-3.5 w-3.5 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
                {formattedTime}
              </span>
            )}
            <div className="pointer-events-auto ml-auto flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => onBookmark(item)}
                title={item.bookmarked ? t("items.unbookmark") : t("items.bookmark")}
                aria-label={item.bookmarked ? t("items.unbookmark") : t("items.bookmark")}
                className={`grid h-8 w-8 place-items-center rounded-lg border transition-colors ${item.bookmarked ? "border-amber-500/40 bg-amber-500/15 text-amber-500" : "border-[var(--c-border)] text-[var(--c-text-muted)] hover:text-amber-500"}`}
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill={item.bookmarked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
              </button>
              <button
                type="button"
                onClick={() => onRead(item)}
                title={item.read ? t("items.markUnread") : t("items.markRead")}
                aria-label={item.read ? t("items.markUnread") : t("items.markRead")}
                className={`grid h-8 w-8 place-items-center rounded-lg border border-[var(--c-border)] transition-colors ${item.read ? "text-[var(--c-text-muted)]" : "text-[var(--c-blue3)]"}`}
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill={item.read ? "none" : "currentColor"} stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><circle cx="12" cy="12" r="9" /></svg>
              </button>
            </div>
          </div>
        </div>
      </article>
    </li>
  );
}

export function NewspaperGrid({ items, focusedItemId, onOpen, onBookmark, onRead }: NewspaperGridProps) {
  const features = useMemo(() => editorialFeatures(items), [items]);
  const companions = useMemo(() => editorialCompanions(features), [features]);

  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 sm:gap-5 animate-page-fade">
      {items.map((item, index) => (
        <EditorialCard
          key={item.id}
          item={item}
          featured={features[index]}
          besideFeature={companions[index]}
          focused={focusedItemId === item.id}
          onOpen={onOpen}
          onBookmark={onBookmark}
          onRead={onRead}
        />
      ))}
    </ul>
  );
}
