import { useMemo } from "react";
import type { Item } from "../api/client.ts";
import { articleExcerpt } from "../utils/articleExcerpt.ts";
import { textLanguage } from "../utils/japanese.ts";
import { JapaneseText } from "./JapaneseText.tsx";

export function ArticleExcerpt({ item, className }: { item: Item; className: string }) {
  const text = useMemo(() => articleExcerpt(item), [item]);
  if (!text) return null;
  const lang = textLanguage(text);
  return (
    <p className={lang === "ja" ? `${className} ja-phrases` : className} lang={lang}>
      <JapaneseText text={text} />
    </p>
  );
}
