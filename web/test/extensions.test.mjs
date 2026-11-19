import assert from "node:assert/strict";
import { test } from "node:test";
import { groupSettingsSections, pickLocalized, resolveFooterLinks, resolveLoginForm, resolveMeta, resolvePasswordCard, resolvePageExtensions, resolveArticlesNotice, resolveSettingsExtensions } from "../src/extensions/host.ts";

const builtIn = ["account", "general", "users", "database"];
const section = (id, extra = {}) => ({ id, label: `Label ${id}`, description: "Beschreibung", group: "Kunden", mount: () => {}, ...extra });
const withSettings = (settings) => ({ settings });

test("a host adds settings sections and hides built-in ones, and everything it hands over is checked", () => {
  const host = withSettings({
    hidden: ["users", "database", "no-such-section", 42],
    sections: [
      section("tenants"),
      section("overview", { group: "Betrieb", shortLabel: "Start", icon: ["M4 6h16"] }),
      section("account"),                       // clashes with a built-in section
      section("tenants", { label: "Again" }),   // repeats an id: the first one counts
      section("Bad ID"),                        // not a valid id
      section("no-mount", { mount: undefined }),
      section("long-label", { label: "x".repeat(81) }),
      section("bad-icon", { icon: [1] }),
      section("bad-admin", { admin: "yes" }),
      null, "text", 7,
    ],
  });
  const result = resolveSettingsExtensions(host, builtIn, false);
  assert.deepEqual([...result.hidden].sort(), ["database", "users"]);
  assert.deepEqual(result.sections.map((entry) => entry.id), ["tenants", "overview"]);
  assert.equal(result.sections[0].label, "Label tenants");
});

test("sections for administrators stay hidden from everyone else", () => {
  const host = withSettings({ sections: [section("plain"), section("secret", { admin: true })] });
  assert.deepEqual(resolveSettingsExtensions(host, builtIn, false).sections.map((entry) => entry.id), ["plain"]);
  assert.deepEqual(resolveSettingsExtensions(host, builtIn, true).sections.map((entry) => entry.id), ["plain", "secret"]);
  // An id that was refused to a regular user is not free for a later entry either.
  const clash = withSettings({ sections: [section("secret", { admin: true }), section("secret", { label: "Other" })] });
  assert.deepEqual(resolveSettingsExtensions(clash, builtIn, false).sections, []);
});

test("nothing a script puts there can break the page", () => {
  for (const host of [undefined, null, "text", 5, [], {}, { settings: "x" }, { settings: { sections: "x", hidden: "y" } }, { settings: { sections: [{}], hidden: [null] } }, { footerLinks: "x", loginForm: 3 }]) {
    const settings = resolveSettingsExtensions(host, builtIn, true);
    assert.equal(settings.sections.length, 0);
    assert.equal(settings.hidden.size, 0);
    assert.deepEqual(resolveFooterLinks(host, "en"), []);
    assert.equal(resolveLoginForm(host), null);
  }
});

test("sections are grouped in the order the groups first appear", () => {
  const groups = groupSettingsSections([
    { id: "a", group: "Kunden" }, { id: "b", group: "KI" }, { id: "c", group: "Kunden" }, { id: "d", group: "System" },
  ]);
  assert.deepEqual(groups.map((entry) => [entry.group, entry.sections.map((member) => member.id)]), [
    ["Kunden", ["a", "c"]], ["KI", ["b"]], ["System", ["d"]],
  ]);
});

test("texts and addresses are picked by language, with sensible fallbacks", () => {
  assert.equal(pickLocalized("Imprint", "de"), "Imprint");
  const labels = { de: "Impressum", en: "Legal notice", ja: "運営者情報" };
  assert.equal(pickLocalized(labels, "de"), "Impressum");
  assert.equal(pickLocalized(labels, "de-AT"), "Impressum");
  assert.equal(pickLocalized(labels, "JA"), "運営者情報");
  assert.equal(pickLocalized(labels, "fr"), "Legal notice");
  assert.equal(pickLocalized({ de: "Nur Deutsch" }, "fr"), "Nur Deutsch");
  assert.equal(pickLocalized({}, "en"), null);
  assert.equal(pickLocalized(5, "en"), null);
});

test("footer links follow the language and only ever link to pages or http(s) addresses", () => {
  const host = {
    footerLinks: [
      { label: { de: "Impressum", en: "Legal notice" }, href: { de: "/impressum", en: "/en/legal-notice" } },
      { label: "Operator", href: "https://example.org/about" },
      { label: "Script", href: "javascript:alert(1)" },
      { label: "Protocol-relative", href: "//evil.example/x" },
      { label: "Backslash", href: "/\\evil.example" },
      { label: "Data", href: "data:text/html,x" },
      { label: "", href: "/empty-label" },
      { label: "x".repeat(61), href: "/too-long" },
      { label: "No address" },
      "text", null,
    ],
  };
  assert.deepEqual(resolveFooterLinks(host, "de"), [
    { label: "Impressum", href: "/impressum", newTab: false, icon: null },
    { label: "Operator", href: "https://example.org/about", newTab: true, icon: null },
  ]);
  assert.equal(resolveFooterLinks(host, "en")[0].href, "/en/legal-notice");
  const many = { footerLinks: Array.from({ length: 20 }, (_, index) => ({ label: `Link ${index}`, href: `/page-${index}` })) };
  assert.equal(resolveFooterLinks(many, "en").length, 8);
});

test("a sign-in form from the host needs a mount function", () => {
  const mount = () => {};
  assert.equal(resolveLoginForm({ loginForm: { mount } }).mount, mount);
  assert.equal(resolveLoginForm({ loginForm: {} }), null);
  assert.equal(resolveLoginForm({ loginForm: { mount: "x" } }), null);
});

test("footer links can carry an icon and be limited to some places", () => {
  const host = {
    footerLinks: [
      { label: "Brand", href: "https://example.org", icon: "/logo.svg", placements: ["login", "page"] },
      { label: "Everywhere", href: "/all", icon: "javascript:alert(1)" },
    ],
  };
  assert.deepEqual(resolveFooterLinks(host, "en", "menu").map((link) => link.label), ["Everywhere"]);
  assert.deepEqual(resolveFooterLinks(host, "en", "page").map((link) => [link.label, link.icon]), [["Brand", "/logo.svg"], ["Everywhere", null]]);
  assert.equal(resolveFooterLinks(host, "en").length, 2);
});

test("a password card from the host needs a mount function", () => {
  const mount = () => {};
  const applies = () => true;
  assert.deepEqual(resolvePasswordCard({ passwordCard: { mount, applies } }), { mount, applies });
  assert.deepEqual(resolvePasswordCard({ passwordCard: { mount } }), { mount });
  assert.equal(resolvePasswordCard({ passwordCard: {} }), null);
  assert.equal(resolvePasswordCard({}), null);
});

test("starter packs of the host are added to the lists of the server, replace them on request, and are checked", async () => {
  const { resolveStarterPacks, resolveOnboarding } = await import("../src/extensions/host.ts");
  const { feedsForLanguage, feedsInAllLanguages } = await import("../src/onboarding/feedLists.ts");
  const fromServer = [
    { id: "news", iconSymbol: "newspaper", title: "Nachrichten", description: "Schlagzeilen.", feeds: [{ title: "Tagesschau", url: "https://example.org/tagesschau", lang: "de", description: "Die Meldungen." }] },
    { id: "technology", iconSymbol: "desktopcomputer", title: "Technik", description: "", feeds: [
      { title: "heise", url: "https://example.org/heise", lang: "de", description: "IT-News." },
      { title: "Verge", url: "https://example.org/verge", lang: "en", description: "Geräte." },
      { title: "ITmedia", url: "https://example.org/itmedia", lang: "ja", description: "" },
    ] },
  ];
  const own = { id: "company", title: { en: "Company", de: "Firma" }, feeds: [
    { title: "Blog", url: "https://example.org/feed.xml", lang: "de-AT", description: { en: "Our news", de: "Unsere Neuigkeiten" } },
    { title: "Script", url: "javascript:alert(1)" },
    { title: "Secret", url: "https://user:pass@example.org/feed" },
    { title: "", url: "https://example.org/empty" },
  ] };
  const added = resolveStarterPacks({ starterPacks: { packs: [own, { id: "Bad Id", title: "x", feeds: [] }, { id: "empty", title: "Empty", feeds: [{ title: "No", url: "ftp://example.org" }] }] } }, fromServer, "de");
  assert.deepEqual(added.map((pack) => pack.id), ["news", "technology", "company"]);
  const company = added.at(-1);
  assert.equal(company.title, "Firma");
  assert.deepEqual(company.feeds, [{ title: "Blog", url: "https://example.org/feed.xml", lang: "de", description: "Unsere Neuigkeiten" }]);
  assert.equal(added[0].feeds[0].description, "Die Meldungen.", "the description of a feed from the server is kept");
  assert.deepEqual(resolveStarterPacks({ starterPacks: { replace: true, packs: [own] } }, fromServer, "en").map((pack) => pack.id), ["company"]);
  assert.equal(resolveStarterPacks({}, fromServer, "en").length, fromServer.length);
  assert.equal(resolveStarterPacks({}, [], "en").length, 0, "without lists from the server nothing is shown");
  assert.equal(resolveOnboarding({ onboarding: { mount() {} } }) !== null, true);
  assert.equal(resolveOnboarding({ onboarding: {} }), null);

  const technology = added.find((pack) => pack.id === "technology");
  assert.ok(feedsForLanguage(technology, "de").every((feed) => feed.lang === "de" || feed.lang === "en"));
  assert.equal(feedsForLanguage(technology, "de")[0].lang, "de", "the own language comes first");
  assert.ok(feedsForLanguage(technology, "ja").length > 0 && feedsForLanguage(technology, "ja").every((feed) => feed.lang === "ja"), "Japanese readers get no English feeds where there are Japanese ones");
  assert.ok(feedsForLanguage({ feeds: [{ lang: "en" }] }, "ja").length === 1, "but a list without Japanese ones still shows the English ones");
  assert.ok(feedsForLanguage(technology, "en").every((feed) => feed.lang === "en"));
  assert.deepEqual(feedsInAllLanguages(technology, "de").map((feed) => feed.lang), ["de", "en", "ja"], "all languages: own first, English next, the rest after");
  assert.deepEqual(feedsInAllLanguages(technology, "ja").map((feed) => feed.lang), ["ja", "en", "de"]);
});

test("a notice above the articles needs a mount function, and `applies` is optional", () => {
  const mount = () => {};
  const applies = () => true;
  assert.deepEqual(resolveArticlesNotice({ articlesNotice: { mount, applies } }), { mount, applies });
  assert.deepEqual(resolveArticlesNotice({ articlesNotice: { mount } }), { mount });
  assert.equal(resolveArticlesNotice({ articlesNotice: {} }), null);
  assert.equal(resolveArticlesNotice({ articlesNotice: { mount: "x" } }), null);
  assert.equal(resolveArticlesNotice(undefined), null);
});

test("a host sets the page title and description by language, and only usable values replace the app's own", () => {
  const host = {
    meta: {
      title: { de: "FeedKeeper – deine Zeitung", en: "FeedKeeper – your newspaper" },
      description: { en: "A newspaper made from your feeds." },
    },
  };
  assert.deepEqual(resolveMeta(host, "de"), { title: "FeedKeeper – deine Zeitung", description: "A newspaper made from your feeds." });
  assert.deepEqual(resolveMeta(host, "de-AT").title, "FeedKeeper – deine Zeitung");
  assert.deepEqual(resolveMeta(host, "fr").title, "FeedKeeper – your newspaper");
  assert.deepEqual(resolveMeta({ meta: { title: "  Plain  " } }, "en"), { title: "Plain", description: null });
  // Too long, empty or not text: the app keeps its own wording.
  assert.deepEqual(resolveMeta({ meta: { title: "x".repeat(81), description: "y".repeat(301) } }, "en"), { title: null, description: null });
  assert.deepEqual(resolveMeta({ meta: { title: "   ", description: 5 } }, "en"), { title: null, description: null });
  for (const broken of [undefined, null, "text", 5, [], {}, { meta: "x" }, { meta: [] }, { meta: { title: {} } }]) {
    assert.deepEqual(resolveMeta(broken, "en"), { title: null, description: null });
  }
});

test("main navigation pages resolve only valid distinct registrations", () => {
  const mount = () => {};
  const page = (id, extra = {}) => ({ id, label: { en: "Overview", ja: "概要" }, icon: ["M4 6h16"], mount, ...extra });
  assert.deepEqual(resolvePageExtensions({}, "ja"), []);
  const pages = resolvePageExtensions({ pages: [
    page("start"), page("start"), page("../other"), page("empty", { icon: [] }),
    page("broken", { mount: null }), page("other"), page("third"), page("fourth"),
  ] }, "ja-JP");
  assert.deepEqual(pages.map(({ id, label }) => [id, label]), [["start", "概要"], ["other", "概要"], ["third", "概要"]]);
  assert.equal(pages[0].mount, mount);
});
