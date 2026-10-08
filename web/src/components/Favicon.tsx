import { useEffect, useState } from "react";

const faviconLoads = new Map<string, Promise<boolean>>();

function loadFavicon(url: string): Promise<boolean> {
  let pending = faviconLoads.get(url);
  if (!pending) {
    pending = new Promise((resolve) => {
      const image = new Image();
      image.onload = () => resolve(image.naturalWidth > 0 && image.naturalHeight > 0);
      image.onerror = () => resolve(false);
      image.src = url;
    });
    faviconLoads.set(url, pending);
  }
  return pending;
}

interface FaviconProps {
  /** The feed, whose icon this server can deliver; it is kept for offline use. */
  feedId?: number;
  /** Icon declared by the site, discovered by the server; tried before guessing /favicon.ico. */
  iconUrl?: string | null;
  siteUrl?: string | null;
  feedUrl?: string | null;
  articleUrl?: string | null;
  className: string;
}

export function Favicon({ feedId, iconUrl, siteUrl, feedUrl, articleUrl, className }: FaviconProps) {
  const sourceKey = JSON.stringify([feedId, iconUrl, siteUrl, feedUrl, articleUrl]);
  const [loaded, setLoaded] = useState<{ key: string; url: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoaded(null);

    async function findFavicon() {
      // When feedId is present, the server is the authoritative source for the feed icon.
      if (feedId) {
        const serverIconUrl = `/api/feeds/${feedId}/icon`;
        if (await loadFavicon(serverIconUrl)) {
          if (!cancelled) setLoaded({ key: sourceKey, url: serverIconUrl });
        }
        return;
      }

      const candidates = new Set<string>();
      if (iconUrl && /^https?:\/\//i.test(iconUrl)) candidates.add(iconUrl);
      for (const source of [siteUrl, feedUrl, articleUrl]) {
        if (!source) continue;
        try {
          const parsed = new URL(source);
          if (parsed.protocol === "https:" || parsed.protocol === "http:") {
            candidates.add(`${parsed.origin}/favicon.ico`);
          }
        } catch {
          // Try the next source URL.
        }
      }

      for (const url of candidates) {
        if (await loadFavicon(url)) {
          if (!cancelled) setLoaded({ key: sourceKey, url });
          return;
        }
      }
    }

    void findFavicon();
    return () => { cancelled = true; };
    // sourceKey is the JSON encoding of every input prop, so it is the single value the effect
    // keys on and changes exactly when any of them does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey]);

  if (!loaded || loaded.key !== sourceKey) return null;
  return (
    <img
      src={loaded.url}
      alt=""
      className={className}
      loading="lazy"
      onError={() => {
        faviconLoads.set(loaded.url, Promise.resolve(false));
        setLoaded(null);
      }}
    />
  );
}
