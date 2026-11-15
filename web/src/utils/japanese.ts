import { BUDOUX_JA_MODEL } from "./budouxModel.ts";

/** Hiragana or katakana: the sign that a text is Japanese (kanji alone could be Chinese). */
const KANA = /[぀-ヿㇰ-ㇿｦ-ﾟ]/;

const TOTAL_SCORE = Object.values(BUDOUX_JA_MODEL).reduce(
  (sum, table) => sum + Object.values(table).reduce((tableSum, weight) => tableSum + weight, 0),
  0,
);

const WORD_SEGMENTER = new Intl.Segmenter("ja", { granularity: "word" });
const MAX_PHRASE_LENGTH = 14;

const OPENING_PUNCTUATION = new Set(["「", "『", "（", "［", "【", "〈", "《", "〔", "｛", "｟"]);
const CLOSING_BRACKETS = new Set(["」", "』", "）", "］", "】", "〉", "》", "〕", "｝", "｠"]);
const CLOSING_PUNCTUATION = new Set(["。", "、", "，", "．", "！", "？", ...CLOSING_BRACKETS]);
const LINE_START_FORBIDDEN = new Set([
  ...CLOSING_PUNCTUATION,
  "っ", "ッ", "ゃ", "ゅ", "ょ", "ャ", "ュ", "ョ",
  "ぁ", "ぃ", "ぅ", "ぇ", "ぉ", "ァ", "ィ", "ゥ", "ェ", "ォ",
  "ゎ", "ヮ", "ヵ", "ヶ", "ー", "・", "：", "；", "〜", "～",
  "…", "‥", "々", "ゝ", "ゞ", "ヽ", "ヾ",
]);
const ATTACHING_ASCII = new Set([".", ",", ")", "]", "}", ":", ";", "!", "?", "%", "/", "-"]);

/** Compound particles that BudouX often detaches from their preceding case particle (`に`, `と`, `を`). */
const COMPOUND_PARTICLES = new Set([
  "よって", "よる", "より", "ついて", "おいて", "おける", "とって", "ともに",
  "対して", "対する", "関して", "関する", "して", "としての",
  "あたって", "あたり", "わたって", "わたり", "応じて", "応じた",
  "めぐって", "めぐる", "通じて", "通して",
]);

const SKIPPED_HTML_TAGS = new Set([
  "script", "style", "svg", "code", "pre", "kbd", "samp", "textarea", "ruby", "rt", "rp",
]);
const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr",
]);
const BLOCK_BOUNDARY_TAGS = new Set([
  "p", "/p", "li", "/li", "div", "/div", "blockquote", "/blockquote",
  "h1", "/h1", "h2", "/h2", "h3", "/h3", "h4", "/h4", "h5", "/h5", "h6", "/h6",
  "summary", "/summary", "figcaption", "/figcaption", "td", "/td", "th", "/th", "br",
]);

export type JapaneseSegment =
  | { kind: "text"; value: string }
  | { kind: "nb"; value: string }
  | { kind: "wbr" };

export function containsKana(text: string): boolean {
  return KANA.test(text);
}

/** Japanese text carries its own language, whatever the interface language is: the browser then breaks lines and picks the glyphs of Japanese. */
export function textLanguage(text: string | null | undefined): "ja" | undefined {
  return text && KANA.test(text.slice(0, 400)) ? "ja" : undefined;
}

/** Cuts a text to a length at the end of a sentence or clause; Japanese has no spaces to cut at. */
export function cutAtBoundary(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const stop = Math.max(slice.lastIndexOf("。"), slice.lastIndexOf("！"), slice.lastIndexOf("？"));
  if (stop >= max * 0.5) return slice.slice(0, stop + 1);
  const clause = Math.max(slice.lastIndexOf("、"), slice.lastIndexOf("，"));
  return `${(clause >= max * 0.5 ? slice.slice(0, clause) : slice).trimEnd()}…`;
}

function isHiraganaCode(code: number): boolean {
  return code >= 0x3041 && code <= 0x309f;
}

function isKatakanaWord(text: string): boolean {
  return /^[\u30a1-\u30f6\u30fc]{1,}$/.test(text);
}

function isJapaneseCode(code: number): boolean {
  return (
    (code >= 0x3000 && code <= 0x303f) ||
    (code >= 0x3040 && code <= 0x309f) ||
    (code >= 0x30a0 && code <= 0x30ff) ||
    (code >= 0x31f0 && code <= 0x31ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xff01 && code <= 0xffef) ||
    code === 0x2025 ||
    code === 0x2026
  );
}

export function budouxParse(text: string): string[] {
  const chars = Array.from(text);
  if (chars.length <= 1) return chars.length ? [text] : [];
  const phrases: string[] = [chars[0]!];
  for (let i = 1; i < chars.length; i++) {
    let score = -TOTAL_SCORE;
    if (i >= 3) score += 2 * (BUDOUX_JA_MODEL.UW1?.[chars[i - 3]!] ?? 0);
    if (i >= 2) score += 2 * (BUDOUX_JA_MODEL.UW2?.[chars[i - 2]!] ?? 0);
    score += 2 * (BUDOUX_JA_MODEL.UW3?.[chars[i - 1]!] ?? 0);
    score += 2 * (BUDOUX_JA_MODEL.UW4?.[chars[i]!] ?? 0);
    if (i + 1 < chars.length) score += 2 * (BUDOUX_JA_MODEL.UW5?.[chars[i + 1]!] ?? 0);
    if (i + 2 < chars.length) score += 2 * (BUDOUX_JA_MODEL.UW6?.[chars[i + 2]!] ?? 0);
    if (i >= 2) score += 2 * (BUDOUX_JA_MODEL.BW1?.[chars[i - 2]! + chars[i - 1]!] ?? 0);
    score += 2 * (BUDOUX_JA_MODEL.BW2?.[chars[i - 1]! + chars[i]!] ?? 0);
    if (i + 1 < chars.length) score += 2 * (BUDOUX_JA_MODEL.BW3?.[chars[i]! + chars[i + 1]!] ?? 0);
    if (i >= 3) score += 2 * (BUDOUX_JA_MODEL.TW1?.[chars[i - 3]! + chars[i - 2]! + chars[i - 1]!] ?? 0);
    if (i >= 2) score += 2 * (BUDOUX_JA_MODEL.TW2?.[chars[i - 2]! + chars[i - 1]! + chars[i]!] ?? 0);
    if (i + 1 < chars.length) score += 2 * (BUDOUX_JA_MODEL.TW3?.[chars[i - 1]! + chars[i]! + chars[i + 1]!] ?? 0);
    if (i + 2 < chars.length) score += 2 * (BUDOUX_JA_MODEL.TW4?.[chars[i]! + chars[i + 1]! + chars[i + 2]!] ?? 0);

    if (score > 0) phrases.push(chars[i]!);
    else phrases[phrases.length - 1] += chars[i]!;
  }
  return phrases;
}

/** Word segments that keep katakana loanword prefixes (e.g. single-char `ブ` + `ロッカー`) whole. */
function wordSegments(text: string): Array<{ segment: string; index: number; isWordLike: boolean }> {
  const raw = Array.from(WORD_SEGMENTER.segment(text), (entry) => ({
    segment: entry.segment,
    index: entry.index,
    isWordLike: Boolean(entry.isWordLike),
  }));
  const merged: Array<{ segment: string; index: number; isWordLike: boolean }> = [];
  for (const item of raw) {
    const prev = merged.at(-1);
    if (
      prev &&
      isKatakanaWord(prev.segment) &&
      isKatakanaWord(item.segment) &&
      Array.from(prev.segment).length <= 2
    ) {
      prev.segment += item.segment;
    } else {
      merged.push(item);
    }
  }
  return merged;
}

function keepingWordsWhole(run: string, phrases: string[]): string[] {
  if (phrases.length <= 1) return phrases;
  const spans = wordSegments(run)
    .filter((entry) => entry.isWordLike && entry.segment.length >= 2)
    .map((entry) => ({ start: entry.index, end: entry.index + entry.segment.length }));
  if (spans.length === 0) return phrases;

  const result: string[] = [phrases[0]!];
  let offset = phrases[0]!.length;
  for (let i = 1; i < phrases.length; i++) {
    const next = phrases[i]!;
    const insideWord = spans.some((span) => offset > span.start && offset < span.end);
    if (insideWord) {
      result[result.length - 1] += next;
    } else {
      result.push(next);
    }
    offset += next.length;
  }
  return result;
}

function splittingLongPhrases(phrases: string[]): string[] {
  const result: string[] = [];
  for (const phrase of phrases) {
    if (Array.from(phrase).length <= MAX_PHRASE_LENGTH) {
      result.push(phrase);
      continue;
    }
    const words = wordSegments(phrase);
    if (words.length <= 1) {
      result.push(phrase);
      continue;
    }
    const target = phrase.length / 2;
    let bestOffset = 0;
    let bestDiff = Infinity;
    for (let i = 1; i < words.length; i++) {
      const boundary = words[i]!.index;
      if (boundary <= 0 || boundary >= phrase.length) continue;
      if (LINE_START_FORBIDDEN.has(words[i]!.segment[0] ?? "")) continue;
      const diff = Math.abs(boundary - target);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestOffset = boundary;
      }
    }
    if (bestOffset > 0) {
      const left = phrase.slice(0, bestOffset);
      const right = phrase.slice(bestOffset);
      result.push(...splittingLongPhrases([left]), ...splittingLongPhrases([right]));
    } else {
      result.push(phrase);
    }
  }
  return result;
}

function bindPunctuation(phrases: string[]): string[] {
  if (phrases.length <= 1) return phrases;
  const attachedClosers: string[] = [];
  for (const phrase of phrases) {
    const chars = Array.from(phrase);
    let moveCount = 0;
    for (const ch of chars) {
      if (LINE_START_FORBIDDEN.has(ch)) moveCount++;
      else break;
    }
    if (moveCount > 0 && attachedClosers.length > 0) {
      attachedClosers[attachedClosers.length - 1] += chars.slice(0, moveCount).join("");
      const rest = chars.slice(moveCount).join("");
      if (rest) attachedClosers.push(rest);
    } else {
      attachedClosers.push(phrase);
    }
  }

  const attachedOpeners: string[] = [];
  let carriedOpener = "";
  for (const phrase of attachedClosers) {
    const chars = Array.from(phrase);
    let openerCount = 0;
    for (let i = chars.length - 1; i >= 0; i--) {
      if (OPENING_PUNCTUATION.has(chars[i]!)) openerCount++;
      else break;
    }
    const head = carriedOpener + (openerCount > 0 ? chars.slice(0, chars.length - openerCount).join("") : phrase);
    carriedOpener = openerCount > 0 ? chars.slice(chars.length - openerCount).join("") : "";
    if (head) attachedOpeners.push(head);
  }
  if (carriedOpener) {
    if (attachedOpeners.length > 0) attachedOpeners[attachedOpeners.length - 1] += carriedOpener;
    else attachedOpeners.push(carriedOpener);
  }
  return attachedOpeners;
}

function regroupCompoundParticles(phrases: string[]): string[] {
  if (phrases.length <= 1) return phrases;
  const result: string[] = [phrases[0]!];
  for (let i = 1; i < phrases.length; i++) {
    const prev = result[result.length - 1]!;
    const curr = phrases[i]!;
    const prevLast = Array.from(prev).at(-1);
    const matchesParticle = COMPOUND_PARTICLES.has(curr) || Array.from(COMPOUND_PARTICLES).some((p) => curr.startsWith(p));
    if (
      matchesParticle &&
      (prevLast === "に" || prevLast === "と" || prevLast === "を") &&
      Array.from(prev).length + Array.from(curr).length <= 12
    ) {
      result[result.length - 1] = prev + curr;
    } else {
      result.push(curr);
    }
  }
  return result;
}

function hasClosingBracket(text: string): boolean {
  return Array.from(text).some((ch) => CLOSING_BRACKETS.has(ch));
}

function bindShortQuotedPhrases(phrases: string[]): string[] {
  if (phrases.length <= 1) return phrases;
  const result: string[] = [];
  let i = 0;
  while (i < phrases.length) {
    const first = phrases[i]!;
    const firstChar = Array.from(first)[0];
    if (firstChar && OPENING_PUNCTUATION.has(firstChar) && !hasClosingBracket(first)) {
      let combined = first;
      let j = i + 1;
      let closed = false;
      while (j < phrases.length && Array.from(combined).length <= 16) {
        const nextPhrase = phrases[j]!;
        combined += nextPhrase;
        j++;
        if (hasClosingBracket(nextPhrase)) {
          closed = true;
          break;
        }
      }
      if (j > i + 1 && closed && Array.from(combined).length <= 16) {
        result.push(combined);
        i = j;
        continue;
      }
    }
    result.push(first);
    i++;
  }
  return result;
}

function bindShortTrailingPhrase(phrases: string[]): string[] {
  if (phrases.length <= 1) return phrases;
  const result = [...phrases];
  const last = result[result.length - 1]!;
  const prev = result[result.length - 2]!;
  const lastLen = Array.from(last).length;
  const prevLen = Array.from(prev).length;
  if (lastLen <= 3 && prevLen + lastLen <= 10 && !CLOSING_PUNCTUATION.has(Array.from(prev).at(-1) ?? "")) {
    result.splice(result.length - 2, 2, prev + last);
  }
  return result;
}

/** Splits a contiguous run of Japanese characters into natural line-break phrases. */
export function phrasesInRun(run: string): string[] {
  if (!containsKana(run)) return run ? [run] : [];
  let phrases = budouxParse(run);
  phrases = keepingWordsWhole(run, phrases);
  phrases = splittingLongPhrases(phrases);
  phrases = bindPunctuation(phrases);
  phrases = regroupCompoundParticles(phrases);
  phrases = bindShortQuotedPhrases(phrases);
  phrases = bindShortTrailingPhrase(phrases);
  return phrases;
}

function allowsBreak(last: string, first: string): boolean {
  const firstCode = first.codePointAt(0)!;
  return (
    isJapaneseCode(last.codePointAt(0)!) &&
    isJapaneseCode(firstCode) &&
    !OPENING_PUNCTUATION.has(last) &&
    !LINE_START_FORBIDDEN.has(first) &&
    !isHiraganaCode(firstCode)
  );
}

function joinsFollowingRun(last: string, run: string): boolean {
  if (/^[0-9]$/.test(last)) return true;
  const first = Array.from(run)[0];
  if (!first) return false;
  const code = first.codePointAt(0)!;
  return isHiraganaCode(code) || LINE_START_FORBIDDEN.has(first);
}

/** Splits a phrase starting with a short quoted span into `{ quote, suffix }` when applicable. */
function splitShortQuotedPhrase(phrase: string): { quote: string; suffix: string } | null {
  const chars = Array.from(phrase);
  const first = chars[0];
  if (!first || !OPENING_PUNCTUATION.has(first) || chars.length <= 2 || chars.length > 16) return null;
  let closeIndex = -1;
  for (let i = chars.length - 1; i >= 1; i--) {
    if (CLOSING_BRACKETS.has(chars[i]!)) {
      closeIndex = i;
      break;
    }
  }
  if (closeIndex <= 0) return null;
  return {
    quote: chars.slice(0, closeIndex + 1).join(""),
    suffix: chars.slice(closeIndex + 1).join(""),
  };
}

function pushTextSegment(segments: JapaneseSegment[], value: string, unbreakable = false): void {
  if (!value) return;
  const kind = unbreakable ? "nb" : "text";
  const prev = segments.at(-1);
  if (prev && prev.kind === kind) {
    prev.value += value;
  } else {
    segments.push({ kind, value });
  }
}

/** Converts plain text into breakable phrase segments (returns a single text segment for non-Japanese strings). */
export function segmentJapaneseText(text: string, allowUnbreakable = true): JapaneseSegment[] {
  if (!text) return [];
  const hasJapaneseOpener = allowUnbreakable && Array.from(text).some((ch) => OPENING_PUNCTUATION.has(ch));
  if (!containsKana(text) && !hasJapaneseOpener) {
    return [{ kind: "text", value: text }];
  }

  const segments: JapaneseSegment[] = [];
  let plainBuffer = "";
  let nbBuffer = "";
  let nbOpen = false;
  let run = "";
  let afterRun = false;
  let heldOpeners = "";

  const flushPlain = () => {
    if (plainBuffer) {
      pushTextSegment(segments, plainBuffer, false);
      plainBuffer = "";
    }
  };

  const closeNb = () => {
    if (nbOpen) {
      pushTextSegment(segments, nbBuffer, true);
      nbBuffer = "";
      nbOpen = false;
    }
  };

  const appendChar = (ch: string) => {
    if (nbOpen) nbBuffer += ch;
    else plainBuffer += ch;
  };

  const pushWbr = () => {
    if (nbOpen) return;
    flushPlain();
    if (segments.length > 0 && segments.at(-1)?.kind !== "wbr") {
      segments.push({ kind: "wbr" });
    }
  };

  const lastEmittedChar = (): string | undefined => {
    const active = nbOpen ? nbBuffer : plainBuffer;
    if (active) return Array.from(active).at(-1);
    for (let i = segments.length - 1; i >= 0; i--) {
      const seg = segments[i]!;
      if (seg.kind !== "wbr" && seg.value) return Array.from(seg.value).at(-1);
    }
    return undefined;
  };

  const endsWithOrdinalPrefix = (): boolean => {
    const active = nbOpen ? nbBuffer : plainBuffer;
    if (active) return active.endsWith("第");
    const lastSeg = segments.at(-1);
    return Boolean(lastSeg && lastSeg.kind !== "wbr" && lastSeg.value.endsWith("第"));
  };

  const endsWithNbspEntity = (): boolean => {
    const active = nbOpen ? nbBuffer : plainBuffer;
    return active.endsWith("&nbsp;");
  };

  const flushRun = () => {
    if (!run) return;
    const runChars = Array.from(run);
    let openerCount = 0;
    for (let i = runChars.length - 1; i >= 0; i--) {
      if (OPENING_PUNCTUATION.has(runChars[i]!)) openerCount++;
      else break;
    }
    const openers = openerCount > 0 ? runChars.slice(runChars.length - openerCount).join("") : "";
    const body = openerCount > 0 ? runChars.slice(0, runChars.length - openerCount).join("") : run;
    if (containsKana(body)) {
      const last = lastEmittedChar();
      if (last && !/\s/.test(last) && !endsWithNbspEntity() && !joinsFollowingRun(last, body)) {
        pushWbr();
      }
      const phrases = phrasesInRun(body);
      phrases.forEach((phrase, index) => {
        if (index > 0) pushWbr();
        const quoted = allowUnbreakable ? splitShortQuotedPhrase(phrase) : null;
        if (quoted) {
          flushPlain();
          pushTextSegment(segments, quoted.quote, true);
          plainBuffer += quoted.suffix;
        } else {
          plainBuffer += phrase;
        }
      });
      afterRun = openers.length === 0;
      if (openers.length > 0) pushWbr();
    } else {
      appendChar(body);
    }
    heldOpeners = openers;
    run = "";
  };

  for (const ch of Array.from(text)) {
    const code = ch.codePointAt(0)!;
    if (isJapaneseCode(code)) {
      if (!run) closeNb();
      run += ch;
    } else {
      flushRun();
      if (heldOpeners) {
        if (!allowUnbreakable || /\s/.test(ch)) {
          appendChar(heldOpeners);
        } else {
          flushPlain();
          nbBuffer += heldOpeners;
          nbOpen = true;
        }
        heldOpeners = "";
      }
      if (/\s/.test(ch)) closeNb();
      if (
        afterRun &&
        !/\s/.test(ch) &&
        !ATTACHING_ASCII.has(ch) &&
        !(endsWithOrdinalPrefix() && /^[0-9]$/.test(ch))
      ) {
        pushWbr();
      }
      afterRun = false;
      appendChar(ch);
    }
  }

  flushRun();
  if (heldOpeners) appendChar(heldOpeners);
  closeNb();
  flushPlain();
  return segments;
}

function renderSegmentsToHtml(segments: JapaneseSegment[]): string {
  return segments
    .map((seg) => {
      if (seg.kind === "wbr") return "<wbr>";
      if (seg.kind === "nb") return `<span class="nb">${seg.value}</span>`;
      return seg.value;
    })
    .join("");
}

function tagName(tag: string): string {
  const match = /^<\/?([a-zA-Z0-9-]+)/.exec(tag);
  if (!match) return "";
  return (tag.startsWith("</") ? "/" : "") + match[1]!.toLowerCase();
}

function isOpeningTag(tag: string, name: string): boolean {
  return (
    !name.startsWith("/") &&
    name.length > 0 &&
    !VOID_TAGS.has(name) &&
    !tag.endsWith("/>") &&
    !tag.startsWith("<!")
  );
}

function openersToCarry(text: string, html: string, nextIndex: number): string {
  if (nextIndex >= html.length) return "";
  const close = html.indexOf(">", nextIndex);
  if (close === -1) return "";
  const tag = html.slice(nextIndex, close + 1);
  if (!isOpeningTag(tag, tagName(tag))) return "";
  const chars = Array.from(text);
  let count = 0;
  for (let i = chars.length - 1; i >= 0; i--) {
    if (OPENING_PUNCTUATION.has(chars[i]!)) count++;
    else break;
  }
  return count > 0 && count < chars.length ? chars.slice(chars.length - count).join("") : "";
}

/** Inserts `<wbr>` and `<span class="nb">` phrase break hints into sanitized HTML containing Japanese text. */
export function breakJapaneseHtml(html: string): string {
  if (!containsKana(html)) return html;

  let result = "";
  let index = 0;
  let skipping: string | null = null;
  let inSummary = false;
  let previousEnd: string | null = null;
  let carried = "";

  while (index < html.length) {
    if (html[index] === "<") {
      const close = html.indexOf(">", index);
      if (close !== -1) {
        const tag = html.slice(index, close + 1);
        const name = tagName(tag);
        if (carried && !isOpeningTag(tag, name)) {
          result += carried;
          carried = "";
        }
        result += tag;
        if (!skipping && SKIPPED_HTML_TAGS.has(name)) {
          skipping = name;
        } else if (skipping && name === `/${skipping}`) {
          skipping = null;
        }
        if (name === "summary") inSummary = true;
        else if (name === "/summary") inSummary = false;
        if (BLOCK_BOUNDARY_TAGS.has(name)) {
          previousEnd = null;
        }
        index = close + 1;
        continue;
      }
    }

    const next = html.indexOf("<", index);
    const endIdx = next === -1 ? html.length : next;
    let text = html.slice(index, endIdx);
    if (!skipping) {
      text = carried + text;
      carried = openersToCarry(text, html, endIdx);
      if (carried) text = text.slice(0, text.length - carried.length);
      const first = Array.from(text)[0];
      if (previousEnd && first && allowsBreak(previousEnd, first)) {
        result += "<wbr>";
      }
      result += renderSegmentsToHtml(segmentJapaneseText(text, !inSummary));
      const last = Array.from(text).at(-1);
      previousEnd = last && isJapaneseCode(last.codePointAt(0)!) ? last : null;
    } else {
      result += text;
    }
    index = endIdx;
  }

  return result + carried;
}
