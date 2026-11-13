import { type ContentRule, count, pruneEmpty } from "../shared.js";

/** An expression that is nothing but the name of a state variable. */
const STATE_NAME = /^[A-Za-z_$][\w$]*$/;

/** Whether an `x-data` object declares the variable and starts it out as `false` (`{ open: false }`). */
function declaration(data: string, name: string): "false" | "other" | null {
  const escaped = name.replace(/\$/g, "\\$");
  if (!new RegExp(`(?:^|[{,\\s])${escaped}\\s*:`).test(data)) return null;
  return new RegExp(`(?:^|[{,\\s])${escaped}\\s*:\\s*false\\b`).test(data) ? "false" : "other";
}

/** Whether the state that an element's `x-show` names starts out as false in the nearest scope that declares it. */
function startsHidden(element: Element): boolean {
  const name = (element.getAttribute("x-show") ?? "").trim();
  if (!STATE_NAME.test(name)) return false;
  for (let scope: Element | null = element; scope; scope = scope.parentElement) {
    const data = scope.getAttribute("x-data");
    if (data === null) continue;
    const declared = declaration(data, name);
    if (declared) return declared === "false";
  }
  return false;
}

/**
 * Hover cards, menus and dialogs that a framework shows only after a click or a hover. Alpine writes it as `x-show="open"` with
 * `x-data="{ open: false }"` on the wrapper: the card is hidden until a script flips the state. A reader runs no script, so the
 * state never changes and what sits in the card (an author's biography, a menu of the site) would be read as part of the story.
 * Only a bare state name that starts out `false` counts; any other expression is left alone.
 */
export const stateHidden: ContentRule = {
  name: "state-hidden",
  description: "Elements that Alpine shows only while a state that starts out false is true (hover cards, menus, dialogs) are removed.",
  apply(root, stats) {
    let changed = false;
    for (const element of [...root.querySelectorAll("[x-show]")]) {
      if (!root.contains(element) || !startsHidden(element)) continue;
      const parent = element.parentNode;
      element.remove();
      pruneEmpty(parent);
      count(stats, "state-hidden");
      changed = true;
    }
    return changed;
  },
};
