import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { SHORTCUT_GROUPS, hasCommandModifier, isEditableTarget } from "../src/utils/keyboard.ts";

test("isEditableTarget detects inputs, textareas, selects, and contenteditable elements", () => {
  assert.equal(isEditableTarget({ tagName: "INPUT" }), true);
  assert.equal(isEditableTarget({ tagName: "textarea" }), true);
  assert.equal(isEditableTarget({ tagName: "SELECT" }), true);
  assert.equal(isEditableTarget({ tagName: "DIV", isContentEditable: true }), true);
  assert.equal(isEditableTarget({ tagName: "DIV", isContentEditable: false }), false);
  assert.equal(isEditableTarget(null), false);
});

test("hasCommandModifier ignores Shift-only presses and catches Cmd, Ctrl, and Alt", () => {
  assert.equal(hasCommandModifier({ metaKey: false, ctrlKey: false, altKey: false }), false);
  assert.equal(hasCommandModifier({ metaKey: true, ctrlKey: false, altKey: false }), true);
  assert.equal(hasCommandModifier({ metaKey: false, ctrlKey: true, altKey: false }), true);
  assert.equal(hasCommandModifier({ metaKey: false, ctrlKey: false, altKey: true }), true);
});

test("all shortcut labels exist in en, de, ja, and ru locales", () => {
  const keys = SHORTCUT_GROUPS.flatMap((group) => [group.titleKey, ...group.entries.map((entry) => entry.labelKey)]);
  for (const lang of ["en", "de", "ja", "ru"]) {
    const locale = JSON.parse(readFileSync(new URL(`../src/i18n/locales/${lang}.json`, import.meta.url), "utf8"));
    for (const key of keys) {
      const value = key.split(".").reduce((acc, part) => (acc && typeof acc === "object" ? acc[part] : undefined), locale);
      assert.equal(typeof value, "string", `Missing ${key} in ${lang}.json`);
      assert.ok(value.length > 0, `Empty ${key} in ${lang}.json`);
    }
  }
});
