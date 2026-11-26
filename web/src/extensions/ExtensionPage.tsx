import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { sendItemAction, type Item } from "../api/client.ts";
import { useAuth } from "../auth/AuthContext.tsx";
import { announceItemsChanged } from "../utils/badge.ts";
import { segmentJapaneseText, textLanguage } from "../utils/japanese.ts";
import { ArticleReaderModal } from "../components/ArticleReaderModal.tsx";
import { resolvePageExtensions, type ExtensionFooterAction, type PageExtension } from "./host.ts";
import { useExtensions } from "./useExtensions.ts";

export function ExtensionPage() {
  const { pageId } = useParams();
  const { user } = useAuth();
  const { i18n } = useTranslation();
  const language = i18n.resolvedLanguage || "en";
  const page = resolvePageExtensions(useExtensions(), language).find(({ id }) => id === pageId);

  // A registration can arrive after the account check and after this route has mounted.
  return user && page ? <MountedPage key={user.id} page={page} userId={user.id} language={language} /> : null;
}

function MountedPage({ page: { mount }, userId, language }: { page: PageExtension; userId: number; language: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [reader, setReader] = useState<{ item: Item; onChange: (item: Item) => void; actions?: ExtensionFooterAction[] } | null>(null);

  useEffect(() => {
    if (!container.current) return;
    const element = container.current;
    let active = true;
    let cleanup: ReturnType<PageExtension["mount"]>;
    try {
      cleanup = mount(element, {
        userId, language, appendText,
        openArticle: (item, onChange, actions) => { if (active) setReader({ item, onChange, actions }); },
      });
    } catch (error) {
      console.error("Could not mount extension page", error);
      element.replaceChildren();
    }
    return () => {
      active = false;
      if (typeof cleanup === "function") cleanup();
      element.replaceChildren();
      setReader(null);
    };
  }, [mount, userId, language]);

  function updateReader(item: Item) {
    if (!reader || reader.item.id !== item.id) return;
    reader.onChange(item);
    setReader((current) => current?.item.id === item.id ? { ...current, item: { ...current.item, ...item } } : current);
  }

  return (
    <>
      <div ref={container} />
      {reader && (
        <ArticleReaderModal item={reader.item} isOpen onClose={() => setReader(null)}
          onItemUpdated={(content) => updateReader({ ...reader.item, ...content })}
          onToggleRead={(item) => {
            void sendItemAction("read", item.id, !item.read).then(() => {
              announceItemsChanged();
              updateReader({ ...item, read: !item.read });
            }).catch(console.error);
          }}
          onToggleBookmark={(item) => {
            void sendItemAction("bookmark", item.id, !item.bookmarked)
              .then(() => updateReader({ ...item, bookmarked: !item.bookmarked })).catch(console.error);
          }}
          footerActions={reader.actions}
        />
      )}
    </>
  );
}

function appendText(element: HTMLElement, text: string) {
  if (textLanguage(text)) element.lang = "ja";
  for (const segment of segmentJapaneseText(text)) {
    if (segment.kind === "wbr") {
      element.append(document.createElement("wbr"));
    } else if (segment.kind === "nb") {
      const span = document.createElement("span");
      span.className = "nb";
      span.textContent = segment.value;
      element.append(span);
    } else {
      element.append(segment.value);
    }
  }
}
