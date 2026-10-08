import assert from "node:assert/strict";
import { test } from "node:test";
import { groupSettingsSections, pickLocalized, resolveFooterLinks, resolveLoginForm, resolvePasswordCard, resolveSettingsExtensions } from "../src/extensions/host.ts";

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

test("starter packs of the host are added to the built-in ones, replace them on request, and are checked", async () => {
  const { resolveStarterPacks, resolveOnboarding } = await import("../src/extensions/host.ts");
  const { BUILT_IN_STARTER_PACKS, feedsForLanguage } = await import("../src/onboarding/starterPacks.ts");
  const own = { id: "company", title: { en: "Company", de: "Firma" }, feeds: [
    { title: "Blog", url: "https://example.org/feed.xml", lang: "de-AT" },
    { title: "Script", url: "javascript:alert(1)" },
    { title: "Secret", url: "https://user:pass@example.org/feed" },
    { title: "", url: "https://example.org/empty" },
  ] };
  const added = resolveStarterPacks({ starterPacks: { packs: [own, { id: "Bad Id", title: "x", feeds: [] }, { id: "empty", title: "Empty", feeds: [{ title: "No", url: "ftp://example.org" }] }] } }, BUILT_IN_STARTER_PACKS, "de");
  assert.deepEqual(added.map((pack) => pack.id), [...BUILT_IN_STARTER_PACKS.map((pack) => pack.id), "company"]);
  const company = added.at(-1);
  assert.equal(company.title, "Firma");
  assert.deepEqual(company.feeds, [{ title: "Blog", url: "https://example.org/feed.xml", lang: "de" }]);
  assert.deepEqual(resolveStarterPacks({ starterPacks: { replace: true, packs: [own] } }, BUILT_IN_STARTER_PACKS, "en").map((pack) => pack.id), ["company"]);
  assert.equal(resolveStarterPacks({}, BUILT_IN_STARTER_PACKS, "en").length, BUILT_IN_STARTER_PACKS.length);
  assert.equal(resolveOnboarding({ onboarding: { mount() {} } }) !== null, true);
  assert.equal(resolveOnboarding({ onboarding: {} }), null);

  const technology = added.find((pack) => pack.id === "technology");
  assert.ok(feedsForLanguage(technology, "de").every((feed) => feed.lang === "de" || feed.lang === "en"));
  assert.equal(feedsForLanguage(technology, "de")[0].lang, "de", "the own language comes first");
  assert.ok(feedsForLanguage(technology, "ja").some((feed) => feed.lang === "ja"));
  assert.ok(feedsForLanguage(technology, "en").every((feed) => feed.lang === "en"));
});

test("the built-in starter packs have unique ids, https addresses and titles in every language", async () => {
  const { BUILT_IN_STARTER_PACKS } = await import("../src/onboarding/starterPacks.ts");
  assert.equal(new Set(BUILT_IN_STARTER_PACKS.map((pack) => pack.id)).size, BUILT_IN_STARTER_PACKS.length);
  const urls = BUILT_IN_STARTER_PACKS.flatMap((pack) => pack.feeds.map((feed) => feed.url));
  assert.equal(new Set(urls).size, urls.length, "no feed twice");
  for (const pack of BUILT_IN_STARTER_PACKS) {
    for (const language of ["en", "de", "ja"]) {
      assert.ok(pack.title[language] && pack.description[language], `${pack.id} has a ${language} title and description`);
    }
    for (const feed of pack.feeds) assert.match(feed.url, /^https:\/\//);
  }
});
