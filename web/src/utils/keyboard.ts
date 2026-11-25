export interface ShortcutEntry {
  keys: string[];
  labelKey: string;
}

export interface ShortcutGroup {
  titleKey: string;
  entries: ShortcutEntry[];
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    titleKey: "shortcuts.groups.library",
    entries: [
      { keys: ["J", "/", "↓"], labelKey: "shortcuts.nextItem" },
      { keys: ["K", "/", "↑"], labelKey: "shortcuts.previousItem" },
      { keys: ["Enter", "/", "O"], labelKey: "shortcuts.openArticle" },
      { keys: ["M"], labelKey: "shortcuts.toggleRead" },
      { keys: ["S"], labelKey: "shortcuts.toggleSaved" },
      { keys: ["V"], labelKey: "shortcuts.openOriginal" },
      { keys: ["/"], labelKey: "shortcuts.search" },
      { keys: ["R"], labelKey: "shortcuts.refresh" },
      { keys: ["Shift", "A"], labelKey: "shortcuts.markAllRead" },
      { keys: ["?"], labelKey: "shortcuts.showShortcuts" },
    ],
  },
  {
    titleKey: "shortcuts.groups.article",
    entries: [
      { keys: ["J", "/", "→"], labelKey: "shortcuts.nextArticle" },
      { keys: ["K", "/", "←"], labelKey: "shortcuts.previousArticle" },
      { keys: ["S"], labelKey: "shortcuts.toggleSaved" },
      { keys: ["M"], labelKey: "shortcuts.toggleRead" },
      { keys: ["V"], labelKey: "shortcuts.openOriginal" },
      { keys: ["R"], labelKey: "shortcuts.toggleFullText" },
      { keys: ["Esc"], labelKey: "shortcuts.close" },
    ],
  },
];

/** Returns true when typing into an editable control so global shortcuts stay out of the way. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const element = target as { tagName?: string; isContentEditable?: boolean };
  if (element.isContentEditable) return true;
  const tag = element.tagName?.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** Returns true when a system/browser modifier (Cmd, Ctrl, Alt) is held. */
export function hasCommandModifier(event: Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "altKey">): boolean {
  return event.metaKey || event.ctrlKey || event.altKey;
}

/** Opens an article link in a new tab when it uses http(s). */
export function openSafeExternalUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    window.open(parsed.href, "_blank", "noopener,noreferrer");
    return true;
  } catch {
    return false;
  }
}
