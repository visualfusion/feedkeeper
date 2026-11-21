import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import i18next from "i18next";
import { feedErrorMessage } from "../src/utils/feedError.ts";

const resources = Object.fromEntries(["en", "de", "ja"].map(code => [code, {
  translation: JSON.parse(readFileSync(new URL(`../src/i18n/locales/${code}.json`, import.meta.url), "utf8")),
}]));

for (const language of ["en", "de", "ja"]) {
  test(`${language}: stored feed error codes read as sentences`, async () => {
    const i18n = i18next.createInstance();
    await i18n.init({ lng: language, resources });
    const t = i18n.t.bind(i18n);
    const codes = ["feed_http_503", "feed_http_500", "feed_http_408", "feed_http_404", "feed_http_410", "feed_http_403", "feed_http_429", "feed_http_418", "feed_timeout", "feed_network_error", "feed_invalid_or_unavailable"];
    const messages = codes.map(code => feedErrorMessage(t, code));
    for (const [index, message] of messages.entries()) {
      assert.notEqual(message, codes[index], `${codes[index]} stays a code`);
      assert.ok(!message.includes("feeds.errors") && !message.includes("{{"), message);
    }
    assert.ok(messages[0].includes("503"));
    assert.ok(messages[3].includes("404"));
    // A code the app does not know is shown as it is rather than hidden.
    assert.equal(feedErrorMessage(t, "something_new"), "something_new");
  });
}

test("a missing status 5xx or timeout is reported as unavailable, a missing page as not found", async () => {
  const i18n = i18next.createInstance();
  await i18n.init({ lng: "en", resources });
  const t = i18n.t.bind(i18n);
  assert.equal(feedErrorMessage(t, "feed_http_502"), t("feeds.errors.unavailable", { status: 502 }));
  assert.equal(feedErrorMessage(t, "feed_http_408"), t("feeds.errors.unavailable", { status: 408 }));
  assert.equal(feedErrorMessage(t, "feed_http_404"), t("feeds.errors.notFound", { status: 404 }));
  assert.equal(feedErrorMessage(t, "feed_http_451"), t("feeds.errors.rejected", { status: 451 }));
  assert.equal(feedErrorMessage(t, "feed_http_429", "https://www.reddit.com/r/swift/.rss"), t("feeds.errors.redditLimited"));
  assert.equal(feedErrorMessage(t, "feed_http_429", "https://example.com/feed.xml"), t("feeds.errors.limited"));
});
