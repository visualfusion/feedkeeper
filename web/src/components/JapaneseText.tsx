import { Fragment, useMemo } from "react";
import { containsKana, segmentJapaneseText } from "../utils/japanese.ts";

/** Renders Japanese plain text with BudouX `<wbr>` phrase-break hints and unbreakable short quotes. */
export function JapaneseText({ text }: { text: string }) {
  const nodes = useMemo(() => {
    if (!text || !containsKana(text)) return text;
    return segmentJapaneseText(text).map((segment, index) => {
      if (segment.kind === "wbr") return <wbr key={index} />;
      if (segment.kind === "nb") return <span key={index} className="nb">{segment.value}</span>;
      return <Fragment key={index}>{segment.value}</Fragment>;
    });
  }, [text]);

  return <>{nodes}</>;
}
