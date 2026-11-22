import assert from "node:assert/strict";
import { test } from "node:test";
import { BUILT_IN_FEED_LISTS } from "../src/feeds/feedListsData.js";
import { pickFeedListLanguage, resolveFeedLists } from "../src/feeds/feedLists.js";

const LANGUAGES = ["en", "de", "ja", "ru"] as const;

test("the built-in feed lists are complete, short and free of duplicates", () => {
  const ids = new Set<string>();
  const urls = new Set<string>();
  for (const list of BUILT_IN_FEED_LISTS) {
    assert.ok(/^[a-z][a-z0-9-]{1,30}$/.test(list.id), `list id ${list.id}`);
    assert.ok(!ids.has(list.id), `duplicate list ${list.id}`);
    ids.add(list.id);
    assert.ok(/^[a-z0-9.]+$/.test(list.iconSymbol), `symbol of ${list.id}`);
    assert.ok(list.feeds.length >= 3, `${list.id} has too few feeds`);
    for (const language of LANGUAGES) {
      assert.ok(list.title.trim() && list.title.length <= 30, `${list.id} title ${language}`);
      assert.ok(list.description[language].trim() && list.description[language].length <= 120, `${list.id} description ${language}`);
    }
    for (const feed of list.feeds) {
      const url = new URL(feed.url);
      assert.ok(url.protocol === "https:" && !url.username && !url.password, `address of ${feed.title}`);
      assert.ok(!urls.has(feed.url), `${feed.url} appears twice`);
      urls.add(feed.url);
      assert.ok(feed.title.trim().length > 0 && feed.title.length <= 28, `title of ${feed.url} is too long`);
      assert.ok(!/ [–—-] |:/.test(feed.title), `title of ${feed.url} carries an appendix`);
      assert.ok(LANGUAGES.includes(feed.lang), `language of ${feed.title}`);
      for (const language of LANGUAGES) {
        assert.ok(feed.description[language].trim() && feed.description[language].length <= 90, `${feed.title} description ${language}`);
      }
    }
  }
});

test("the lists are answered in the language asked for, English as the fallback", () => {
  assert.equal(pickFeedListLanguage("de-DE,de;q=0.9,en;q=0.8"), "de");
  assert.equal(pickFeedListLanguage("ja"), "ja");
  assert.equal(pickFeedListLanguage("fr-FR, de;q=0.5"), "de");
  assert.equal(pickFeedListLanguage("fr"), "en");
  assert.equal(pickFeedListLanguage(undefined), "en");

  const german = resolveFeedLists("de");
  assert.equal(german.length, BUILT_IN_FEED_LISTS.length);
  assert.equal(german.find((list) => list.id === "news")!.title, "News");
  const verge = german.flatMap((list) => list.feeds).find((feed) => feed.title === "The Verge")!;
  assert.match(verge.description, /Geräte/);
  assert.equal(verge.lang, "en");
});

test("the native API serves the lists to signed-in clients and advertises the feature", async () => {
  process.env.DATABASE_PATH = ":memory:";
  process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
  const { default: express } = await import("express");
  const { db, runMigrations } = await import("../src/db/index.js");
  const { v1Router } = await import("../src/api/v1/index.js");
  const { createPersonalAccessToken } = await import("../src/auth/tokens.js");
  runMigrations();
  const userId = Number(db.prepare("INSERT INTO users (email, password_hash, display_name) VALUES ('lists@example.test', 'hash', 'Lists')").run().lastInsertRowid);
  const token = createPersonalAccessToken(userId, "iPhone", "read", { platform: "ios", appVersion: "1.0" }).token;

  const app = express();
  app.use("/api/v1", v1Router);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}/api/v1`;
  const get = (path: string, headers: Record<string, string> = {}) => fetch(base + path, { headers: { authorization: `Bearer ${token}`, ...headers } });
  try {
    assert.equal((await fetch(base + "/feed-lists")).status, 401);
    const meta = await (await fetch(base + "/meta")).json() as { features: string[] };
    assert.ok(meta.features.includes("feed-lists"));

    const japanese = await (await get("/feed-lists?lang=ja")).json() as { lists: Array<{ id: string; title: string; feeds: unknown[] }> };
    assert.equal(japanese.lists.find((list) => list.id === "news")!.title, "News");
    const header = await (await get("/feed-lists", { "accept-language": "de-DE,de;q=0.9" })).json() as { lists: Array<{ id: string; title: string }> };
    assert.equal(header.lists.find((list) => list.id === "news")!.title, "News");
  } finally {
    server.close();
  }
});
