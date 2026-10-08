import { useMemo } from "react";
import type { Item } from "../api/client.ts";
import { articleExcerpt } from "../utils/articleExcerpt.ts";

export function ArticleExcerpt({ item, className }: { item: Item; className: string }) {
  const text = useMemo(() => articleExcerpt(item), [item]);
  return text ? <p className={className}>{text}</p> : null;
}
