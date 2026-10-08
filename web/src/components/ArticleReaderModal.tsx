import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { api, ApiError, type Item } from "../api/client.js";
import { sanitizeHtml, leadingArticleImage, estimateReadingTime, safeHttpUrl } from "../utils/sanitizeHtml.js";
import { Favicon } from "./Favicon.js";

interface ArticleReaderModalProps {
  item: Item | null;
  isOpen: boolean;
  onClose: () => void;
  onToggleBookmark: (item: Item) => void;
  onToggleRead: (item: Item) => void;
  onNext?: () => void;
  onPrevious?: () => void;
  onItemUpdated?: (item: Item) => void;
  hasNext?: boolean;
  hasPrev?: boolean;
}

export function ArticleReaderModal({
  item,
  isOpen,
  onClose,
  onToggleBookmark,
  onToggleRead,
  onNext,
  onPrevious,
  onItemUpdated,
  hasNext = false,
  hasPrev = false,
}: ArticleReaderModalProps) {
  const { t, i18n } = useTranslation();
  // The header floats over the article; its height becomes the article's top offset.
  const [headerHeight, setHeaderHeight] = useState(61);
  const headerObserver = useRef<ResizeObserver | null>(null);
  const headerRef = useCallback((node: HTMLElement | null) => {
    headerObserver.current?.disconnect();
    if (!node) return;
    const update = () => setHeaderHeight(node.offsetHeight);
    update();
    headerObserver.current = new ResizeObserver(update);
    headerObserver.current.observe(node);
  }, []);
  const [copied, setCopied] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [showFullText, setShowFullText] = useState(false);
  const [extractedByline, setExtractedByline] = useState<string | null>(null);
  const [extractionError, setExtractionError] = useState<string | null>(null);
  const [consentWall, setConsentWall] = useState(false);
  // The subscription can opt out of fetching articles from the website.
  const fullTextDisabled = item?.feed_full_text_mode === "never";
  const [leadImage, setLeadImage] = useState<{ src: string; width: number; height: number } | null>(null);
  const articleUrl = item?.link ? safeHttpUrl(item.link) : null;

  // Sync state whenever active item changes
  useEffect(() => {
    setShowFullText(Boolean(item?.full_content_html));
    setExtractionError(null);
    setConsentWall(false);
    setExtractedByline(null);
  }, [item?.id, item?.full_content_html]);

  // Automatically trigger reader view extraction if configured and article not yet extracted.
  // Runs only when the modal opens or the active item changes; the derived values (articleUrl,
  // fullTextDisabled) and handleToggleFullText are read fresh from the current render, and
  // depending on them would re-run the extraction mid-flight.
  useEffect(() => {
    if (!isOpen || !item || !articleUrl) return;
    const isAutoReader = localStorage.getItem("feedkeeper_auto_reader_mode") !== "false";
    // Offline there is nothing to fetch; the article opens with what the feed provided.
    if (isAutoReader && !item.full_content_html && !fullTextDisabled && navigator.onLine) {
      handleToggleFullText();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, item?.id]);

  // Prevent background scrolling when reader modal is open
  useEffect(() => {
    if (isOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [isOpen]);

  // Extract full article text from original website via Readability
  const handleToggleFullText = useCallback(async () => {
    if (!item || extracting) return;

    if (item.full_content_html) {
      setShowFullText((prev) => !prev);
      return;
    }

    if (!articleUrl) return;

    setExtracting(true);
    setExtractionError(null);
    setConsentWall(false);
    try {
      const res = await api.extractContent(item.id);
      const updatedItem = {
        ...item,
        full_content_html: res.full_content_html,
      };
      if (res.byline) {
        setExtractedByline(res.byline);
      }
      setShowFullText(true);
      onItemUpdated?.(updatedItem);
    } catch (err: unknown) {
      if (err instanceof ApiError && err.code === "consent_wall") {
        setConsentWall(true);
      } else if (err instanceof ApiError && err.status === 0) {
        setExtractionError(t("common.offlineAction"));
      } else if (!(err instanceof ApiError && err.code === "full_text_disabled")) {
        console.error("Failed to extract full text:", err);
        setExtractionError(t("reader.extractionFailed"));
      }
    } finally {
      setExtracting(false);
    }
  }, [item, extracting, articleUrl, t, onItemUpdated]);

  // Keyboard navigation & shortcuts
  useEffect(() => {
    if (!isOpen || !item) return;

    const currentItem = item;

    function handleKeyDown(e: KeyboardEvent) {
      // Don't trigger if focus is inside an input or textarea
      if (
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if ((e.key === "j" || e.key === "ArrowRight") && hasNext && onNext) {
        e.preventDefault();
        onNext();
      } else if ((e.key === "k" || e.key === "ArrowLeft") && hasPrev && onPrevious) {
        e.preventDefault();
        onPrevious();
      } else if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        onToggleBookmark(currentItem);
      } else if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        onToggleRead(currentItem);
      } else if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        handleToggleFullText();
      } else if ((e.key === "o" || e.key === "O") && articleUrl) {
        e.preventDefault();
        window.open(articleUrl, "_blank", "noopener,noreferrer");
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, item, articleUrl, hasNext, hasPrev, onNext, onPrevious, onClose, onToggleBookmark, onToggleRead, handleToggleFullText]);

  // Format publication date & time
  const pubDate = useMemo(() => {
    if (!item?.published_at) return null;
    return new Date(item.published_at);
  }, [item?.published_at]);

  const formattedDate = useMemo(() => {
    if (!pubDate) return "";
    return new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: "medium" }).format(pubDate);
  }, [pubDate, i18n.resolvedLanguage]);

  const formattedTime = useMemo(() => {
    if (!pubDate) return "";
    return new Intl.DateTimeFormat(i18n.resolvedLanguage, { timeStyle: "short" }).format(pubDate);
  }, [pubDate, i18n.resolvedLanguage]);

  // Active content HTML (full text if toggled, otherwise feed HTML)
  const activeContentHtml = showFullText ? item?.full_content_html : item?.content_html;
  const heroImageUrl = useMemo(
    () => item?.image_url ?? leadingArticleImage(activeContentHtml ?? "", item?.link),
    [item?.image_url, activeContentHtml, item?.link],
  );
  useEffect(() => {
    setLeadImage(null);
    if (!isOpen || !heroImageUrl) return;
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (!cancelled && image.naturalWidth > 0 && image.naturalHeight > 0) {
        setLeadImage({ src: heroImageUrl, width: image.naturalWidth, height: image.naturalHeight });
      }
    };
    image.src = heroImageUrl;
    return () => { cancelled = true; };
  }, [isOpen, heroImageUrl]);
  const visibleLeadImage = leadImage?.src === heroImageUrl ? leadImage : null;
  const compactLeadImage = visibleLeadImage !== null && visibleLeadImage.width <= 320 && visibleLeadImage.height <= 240;

  // Sanitize full HTML content or format plain text snippet, removing duplicate hero image
  const sanitizedContent = useMemo(() => {
    if (!item) return "";
    if (activeContentHtml) {
      return sanitizeHtml(activeContentHtml, { heroImageUrl, baseUrl: item.link });
    }
    return "";
  }, [item, activeContentHtml, heroImageUrl]);

  // Estimated reading time
  const readingTime = useMemo(() => {
    const rawText = activeContentHtml ?? item?.content_snippet ?? "";
    return estimateReadingTime(rawText.replace(/<[^>]+>/g, " "));
  }, [activeContentHtml, item?.content_snippet]);

  // Copy article link to clipboard
  const handleCopyLink = async () => {
    if (!articleUrl) return;
    try {
      await navigator.clipboard.writeText(articleUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard write failures
    }
  };

  if (!isOpen || !item) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop overlay */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Reader Drawer Panel */}
      <div
        className="relative z-10 w-full sm:max-w-2xl md:max-w-3xl h-full h-[100dvh] bg-[var(--c-surface)] shadow-2xl flex flex-col border-0 sm:border-l border-[var(--c-border)] animate-drawer-in"
        role="dialog"
        aria-modal="true"
        aria-label={item.title ?? t("items.title")}
      >
        {/* Translucent bar over the scrolling article, styled like the app header */}
        <header
          ref={headerRef}
          className="absolute inset-x-0 top-0 z-20 px-4 py-3 border-b border-[var(--c-border)] backdrop-blur-md transform-gpu flex items-center justify-between gap-3"
          style={{
            paddingTop: "max(0.75rem, env(safe-area-inset-top, 0px))",
            backgroundColor: "color-mix(in srgb, var(--c-surface) 85%, transparent)",
          }}
        >
          {/* Source, in the same style as the article cards */}
          <div className="flex min-w-0 items-center gap-2 pr-2 text-xs font-semibold tracking-[0.08em] uppercase text-[var(--c-text-muted)]">
            <Favicon
              feedId={item.feed_id}
              iconUrl={item.feed_icon_url}
              siteUrl={item.feed_site_url}
              feedUrl={item.feed_url}
              articleUrl={item.link}
              className="h-3.5 w-3.5 shrink-0 rounded-xs object-contain"
            />
            <span className="truncate">{item.feed_title}</span>
          </div>

          {/* Close button (top right, touch-friendly & larger) */}
          <button
            type="button"
            onClick={onClose}
            title={t("reader.close")}
            aria-label={t("reader.close")}
            className="w-9 h-9 -mr-1 rounded-xl text-[var(--c-text-muted)] hover:text-[var(--c-text)] hover:bg-[var(--c-border)]/60 active:scale-95 transition-all cursor-pointer flex items-center justify-center shrink-0"
          >
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </header>

        {/* Scrollable Article Body */}
        {/* Own compositing layer: keeps WebKit from dropping images under the blurred header while scrolling */}
        <main className="flex-1 overflow-y-auto overscroll-contain transform-gpu" style={{ paddingTop: headerHeight }}>
          {visibleLeadImage && !compactLeadImage && (
            <img
              src={visibleLeadImage.src}
              alt=""
              className="block w-full max-h-[380px] object-cover"
              onError={() => setLeadImage(null)}
            />
          )}
          <div
            className="px-5 sm:px-10 py-6 sm:py-8"
            style={{ paddingBottom: "max(2rem, env(safe-area-inset-bottom, 0px))" }}
          >
          <article className="max-w-prose mx-auto">
            <div className="flow-root">
              {visibleLeadImage && compactLeadImage && (
                <div
                  className="float-right ml-4 mb-3 sm:ml-6 rounded-xl overflow-hidden border border-[var(--c-border)] bg-[var(--c-bg)] shadow-xs"
                  style={{ width: visibleLeadImage.width, maxWidth: "42%" }}
                >
                  <img src={visibleLeadImage.src} alt="" className="block w-full h-auto" onError={() => setLeadImage(null)} />
                </div>
              )}

              {/* Article Headline */}
              <h1 className="text-2xl sm:text-3xl font-bold font-['Manrope'] text-[var(--c-text)] leading-snug tracking-tight mb-3">
                {item.title}
              </h1>
            </div>

            {/* Meta information row */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-[var(--c-text-muted)] pb-5 border-b border-[var(--c-border)] mb-6 font-medium">
              {extractedByline && <span>{extractedByline}</span>}
              {formattedDate && (
                <>
                  {extractedByline && <span>•</span>}
                  <span className="inline-flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5 shrink-0 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                      <line x1="16" y1="2" x2="16" y2="6" />
                      <line x1="8" y1="2" x2="8" y2="6" />
                      <line x1="3" y1="10" x2="21" y2="10" />
                    </svg>
                    <span>{formattedDate}</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5 shrink-0 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                    <span>{formattedTime}</span>
                  </span>
                </>
              )}
              {(extractedByline || formattedDate) && <span>•</span>}
              <span>{t("reader.readingTime", { count: readingTime })}</span>
            </div>

            {/* Consent walls are expected, so they get a calm hint instead of an error */}
            {consentWall && (
              <div className="mb-6 p-4 rounded-xl border border-[var(--c-border)] bg-[var(--c-bg)] text-sm text-[var(--c-text-muted)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <span>{t("reader.consentWall")}</span>
                {articleUrl && (
                  <a href={articleUrl} target="_blank" rel="noreferrer noopener" className="btn-primary text-sm whitespace-nowrap self-start sm:self-center">
                    {t("reader.readOriginal")}
                  </a>
                )}
              </div>
            )}

            {/* Extraction Error Notice */}
            {extractionError && (
              <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-xs flex items-center justify-between gap-3">
                <span>{extractionError}</span>
                {articleUrl && (
                  <a
                    href={articleUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="underline font-semibold whitespace-nowrap hover:opacity-80"
                  >
                    {t("reader.openOriginal")}
                  </a>
                )}
              </div>
            )}

            {/* Main Content Area */}
            {sanitizedContent ? (
              <div
                className="reader-content"
                dangerouslySetInnerHTML={{ __html: sanitizedContent }}
              />
            ) : item.content_snippet ? (
              <div className="reader-content">
                {item.content_snippet.split("\n\n").map((para, i) => (
                  <p key={i}>{para}</p>
                ))}
              </div>
            ) : (
              <p className="text-[var(--c-text-muted)] italic">
                {t("items.noItems")}
              </p>
            )}

            {/* Clean Minimalist Touch-Friendly Article Footer */}
            <div className="mt-12 pt-6 border-t border-[var(--c-border)]/60 flex items-center justify-between gap-3">
              {/* Left group: Navigation (Prev / Next) */}
              <div className="flex items-center gap-2">
                {/* Previous item */}
                <button
                  type="button"
                  onClick={onPrevious}
                  disabled={!hasPrev}
                  title={t("reader.previous")}
                  aria-label={t("reader.previous")}
                  className="w-10 h-10 rounded-xl border border-[var(--c-border)] flex items-center justify-center text-[var(--c-text-muted)] hover:text-[var(--c-text)] hover:bg-[var(--c-border)]/40 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>

                {/* Next item */}
                <button
                  type="button"
                  onClick={onNext}
                  disabled={!hasNext}
                  title={t("reader.next")}
                  aria-label={t("reader.next")}
                  className="w-10 h-10 rounded-xl border border-[var(--c-border)] flex items-center justify-center text-[var(--c-text-muted)] hover:text-[var(--c-text)] hover:bg-[var(--c-border)]/40 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              </div>

              {/* Right group: Actions (Reader View, Bookmark, Read/Unread, Copy Link, Open in Browser) */}
              <div className="flex items-center gap-2">
                {/* Reader View toggle */}
                {articleUrl && (!fullTextDisabled || item.full_content_html) && (
                  <button
                    type="button"
                    onClick={handleToggleFullText}
                    disabled={extracting}
                    title={showFullText ? t("reader.togglePreview") : t("reader.toggleFullText")}
                    aria-label={showFullText ? t("reader.togglePreview") : t("reader.toggleFullText")}
                    className={`w-10 h-10 rounded-xl border flex items-center justify-center transition-all active:scale-95 cursor-pointer ${
                      showFullText
                        ? "bg-[var(--c-blue1)]/15 border-[var(--c-blue1)]/40 text-[var(--c-blue1)]"
                        : "border-[var(--c-border)] text-[var(--c-text-muted)] hover:text-[var(--c-text)] hover:bg-[var(--c-border)]/40"
                    }`}
                  >
                    {extracting ? (
                      <svg className="w-4 h-4 animate-spin text-[var(--c-blue1)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="12" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                      </svg>
                    )}
                  </button>
                )}

                {/* Bookmark item */}
                <button
                  type="button"
                  onClick={() => onToggleBookmark(item)}
                  title={item.bookmarked ? t("reader.unbookmark") : t("reader.bookmark")}
                  aria-label={item.bookmarked ? t("reader.unbookmark") : t("reader.bookmark")}
                  className={`w-10 h-10 rounded-xl border flex items-center justify-center transition-all active:scale-95 cursor-pointer ${
                    item.bookmarked
                      ? "bg-amber-500/15 border-amber-500/40 text-amber-500"
                      : "border-[var(--c-border)] text-[var(--c-text-muted)] hover:text-amber-500 hover:border-amber-500/30"
                  }`}
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill={item.bookmarked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                </button>

                {/* Read / Unread toggle */}
                <button
                  type="button"
                  onClick={() => onToggleRead(item)}
                  title={item.read ? t("reader.markUnread") : t("reader.markRead")}
                  aria-label={item.read ? t("reader.markUnread") : t("reader.markRead")}
                  className={`w-10 h-10 rounded-xl border flex items-center justify-center transition-all active:scale-95 cursor-pointer ${
                    !item.read
                      ? "border-[var(--c-border)] text-[var(--c-blue1)] hover:border-[var(--c-blue3)]"
                      : "border-[var(--c-border)] text-[var(--c-text-muted)] hover:text-[var(--c-text)]"
                  }`}
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill={!item.read ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.2">
                    <circle cx="12" cy="12" r="9" />
                  </svg>
                </button>

                {/* Copy link */}
                <button
                  type="button"
                  onClick={handleCopyLink}
                  title={copied ? t("reader.linkCopied") : t("reader.copyLink")}
                  aria-label={t("reader.copyLink")}
                  className="w-10 h-10 rounded-xl border border-[var(--c-border)] flex items-center justify-center text-[var(--c-text-muted)] hover:text-[var(--c-text)] hover:bg-[var(--c-border)]/40 transition-all active:scale-95 cursor-pointer relative"
                >
                  {copied ? (
                    <svg className="w-4 h-4 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                  )}
                </button>

                {/* Open in external browser */}
                {articleUrl && (
                  <a
                    href={articleUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    title={t("reader.openOriginal")}
                    aria-label={t("reader.openOriginal")}
                    className="w-10 h-10 rounded-xl border border-[var(--c-border)] flex items-center justify-center text-[var(--c-text-muted)] hover:text-[var(--c-text)] hover:bg-[var(--c-border)]/40 transition-all active:scale-95"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </a>
                )}
              </div>
            </div>
          </article>
          </div>
        </main>
      </div>
    </div>,
    document.body
  );
}
