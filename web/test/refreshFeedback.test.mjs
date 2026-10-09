import assert from "node:assert/strict";
import { test } from "node:test";
import i18next from "i18next";
import { readFileSync } from "node:fs";
import { reportFeedRefresh, reportAllRefresh } from "../src/utils/refreshFeedback.ts";
import { getToasts, dismissToast } from "../src/utils/toast.ts";

// No real timers or DOM required for the feedback store.
globalThis.window = { setTimeout: () => 0 };
const resources = Object.fromEntries(["en", "de", "ja"].map(code => [code, {
  translation: JSON.parse(readFileSync(new URL(`../src/i18n/locales/${code}.json`, import.meta.url), "utf8")),
}]));

for (const language of ["en", "de", "ja"]) {
  test(`${language}: deferred single and bulk refreshes never announce completion`, async () => {
    const i18n = i18next.createInstance();
    await i18n.init({ lng: language, resources });
    const t = i18n.t.bind(i18n);
    const clear = () => getToasts().forEach(item => dismissToast(item.id));
    clear();
    for (const error of [null, "feed_http_503"]) {
      reportFeedRefresh({ newItems: 0, error, deferred: true }, "Example", t);
      const message = getToasts().at(-1);
      assert.equal(message.type, "info");
      assert.equal(message.message, t("feeds.refreshPendingToast", { title: "Example" }));
      assert.ok(!message.message.includes("feeds."));
    }
    clear();
    reportAllRefresh({ refreshed: 10, newItems: 5, errors: 2, deferred: 3 }, t);
    assert.deepEqual(getToasts().map(item => item.type), ["info", "error"]);
    assert.equal(getToasts()[0].message, t("feeds.refreshAllPendingToast", { count: 3, newItems: 5 }));
    clear();
    reportAllRefresh({ refreshed: 1, newItems: 0, errors: 0, deferred: 1 }, t);
    assert.equal(getToasts()[0].message, t("feeds.refreshAllPendingToast", { count: 1, newItems: 0 }));
    clear();
    // Older servers omit deferred; ordinary success and permanent errors still work.
    reportFeedRefresh({ newItems: 2, error: null }, "Example", t);
    assert.equal(getToasts()[0].type, "success");
    reportFeedRefresh({ newItems: 0, error: "feed_http_404" }, "Example", t);
    assert.equal(getToasts()[1].type, "error");
    clear();
    reportAllRefresh({ refreshed: 2, newItems: 4, errors: 0 }, t);
    assert.equal(getToasts()[0].type, "success");
    clear();
    reportAllRefresh({ refreshed: 2, newItems: 0, errors: 2 }, t);
    assert.deepEqual(getToasts().map(item => item.type), ["error"]);
    clear();
  });
}
