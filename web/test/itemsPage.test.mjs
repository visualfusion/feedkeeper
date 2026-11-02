import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";

const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "https://reader.example/items" });
for (const name of ["window", "document", "Node", "DOMParser", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "Event", "KeyboardEvent", "localStorage", "sessionStorage"]) globalThis[name] = dom.window[name];
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
globalThis.Image = class {};
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0);
globalThis.cancelAnimationFrame = clearTimeout;
window.scrollTo = () => {};
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
const observers = new Set();
globalThis.IntersectionObserver = class {
  constructor(callback, options) { this.callback = callback; this.options = options; }
  observe() { observers.add(this); }
  disconnect() { observers.delete(this); }
};
const timers = new Set();
window.setTimeout = (callback, delay) => { const id = setTimeout(callback, delay); timers.add(id); return id; };
const { createRoot } = await import("react-dom/client");
const { MemoryRouter } = await import("react-router-dom");
const { AuthProvider } = await import("../src/auth/AuthContext.tsx");
const { ItemsPage } = await import("../src/pages/ItemsPage.tsx");
const { api, ApiError } = await import("../src/api/client.ts");
const i18n = createInstance();
await i18n.use(initReactI18next).init({ lng: "en", resources: { en: { translation: JSON.parse(readFileSync(new URL("../src/i18n/locales/en.json", import.meta.url), "utf8")) } }, interpolation: { escapeValue: false } });
const t = key => i18n.t(key);
const dialog = () => document.querySelector('[role="dialog"]');
const button = (key, parent = document) => parent.querySelector(`button[aria-label="${t(key)}"]`);
const card = id => [...document.querySelectorAll("li.card")].find(node => node.querySelector("h2")?.textContent === `Story ${id}`);
async function click(node) { assert.ok(node, "the expected control is present"); await act(async () => node.click()); }
async function waitFor(check) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return;
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  }
  assert.fail("The expected article state did not appear");
}
async function fixture({ count = 4, saved = false, fullText = false } = {}) {
  localStorage.clear();
  sessionStorage.clear();
  observers.clear();
  localStorage.setItem("feedkeeper_filter_bookmarked", String(saved));
  const rows = Array.from({ length: count }, (_, index) => ({
    id: index + 1, feed_id: 1, feed_title: "Source", feed_url: "https://publisher.example/feed", feed_full_text_mode: "auto",
    title: `Story ${index + 1}`, link: `https://publisher.example/${index + 1}`, published_at: "2026-11-01T12:00:00Z",
    content_html: "<p>Feed content.</p>", full_content_html: fullText ? "<p>Existing full text.</p>" : null,
    read: false, bookmarked: saved,
  }));
  const requests = [];
  const extractions = [];
  api.onboardingStatus = async () => ({ needsOnboarding: false });
  api.me = async () => ({ id: 1, intro_dismissed_at: "2026-11-01", displayName: "Reader" });
  api.listFeeds = async () => [{ id: 1, title: "Source", last_polled_at: "2026-11-01" }];
  api.listFolders = async () => ({ folders: [] });
  api.listItems = async (options = {}) => {
    requests.push(options);
    return rows.filter(row => (!options.unreadOnly || !row.read) && (!options.bookmarkedOnly || row.bookmarked))
      .slice(options.offset ?? 0, (options.offset ?? 0) + (options.limit ?? 50)).map(row => ({ ...row }));
  };
  api.markRead = async id => { rows.find(row => row.id === id).read = true; };
  api.markUnread = async id => { rows.find(row => row.id === id).read = false; };
  api.bookmarkItem = async id => { rows.find(row => row.id === id).bookmarked = true; };
  api.unbookmarkItem = async id => { rows.find(row => row.id === id).bookmarked = false; };
  api.extractContent = id => new Promise((resolve, reject) => extractions.push({ id, resolve, reject }));
  const root = createRoot(document.getElementById("root"));
  await act(async () => root.render(React.createElement(I18nextProvider, { i18n },
    React.createElement(AuthProvider, null, React.createElement(MemoryRouter, { initialEntries: ["/items"] }, React.createElement(ItemsPage))))));
  await waitFor(() => card(1));
  return {
    requests, extractions,
    nextPage: async () => {
      const observer = [...observers].find(observer => observer.options?.rootMargin === "600px 0px");
      assert.ok(observer, "the next-page sentinel is observed");
      await act(async () => observer.callback([{ isIntersecting: true }]));
    },
    cleanup: async () => {
      await act(async () => root.unmount());
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },
  };
}

for (const saved of [false, true]) {
  test(`${saved ? "saved" : "unread"} pagination does not skip articles after ten local state changes`, async () => {
    const f = await fixture({ count: 60, saved, fullText: true });
    try {
      for (let id = 1; id <= 10; id++) await click(button(saved ? "items.unbookmark" : "items.markRead", card(id)));
      await f.nextPage();
      assert.equal(f.requests.at(-1).offset, 40);
      for (let id = 11; id <= 60; id++) assert.ok(card(id), `Story ${id} remains reachable`);
    } finally { await f.cleanup(); }
  });
}

test("late extraction cannot switch articles, reopen a closed reader, or overwrite a newer bookmark", async () => {
  const f = await fixture();
  try {
    await click(card(1));
    await click(button("reader.next", dialog()));
    assert.deepEqual(f.extractions.map(request => request.id), [1, 2]);
    await act(async () => f.extractions[0].resolve({ full_content_html: "<p>Full story one.</p>", byline: "Author one" }));
    assert.equal(dialog().getAttribute("aria-label"), "Story 2");
    assert.ok(!dialog().textContent.includes("Author one"));
    await click(button("reader.bookmark", dialog()));
    await act(async () => f.extractions[1].resolve({ full_content_html: "<p>Full story two.</p>", byline: "Author two" }));
    assert.ok(button("reader.unbookmark", dialog()), "a later extraction preserves the current bookmark");
    assert.match(dialog().textContent, /Full story two\./);
    assert.match(dialog().textContent, /Author two/);
    await click(button("reader.next", dialog()));
    await click(button("reader.close", dialog()));
    await act(async () => f.extractions[2].resolve({ full_content_html: "<p>Full story three.</p>" }));
    assert.equal(dialog(), null);
  } finally { await f.cleanup(); }
});

test("rapid back navigation reuses each pending extraction and ignores an inactive article's errors", async () => {
  const f = await fixture();
  try {
    await click(card(1));
    await click(button("reader.next", dialog()));
    await click(button("reader.previous", dialog()));
    assert.deepEqual(f.extractions.map(request => request.id), [1, 2]);
    await act(async () => f.extractions[1].reject(new ApiError(422, "consent_wall")));
    assert.equal(dialog().getAttribute("aria-label"), "Story 1");
    assert.ok(!dialog().textContent.includes(t("reader.consentWall")));
    await act(async () => f.extractions[0].resolve({ full_content_html: "<p>Full story one.</p>" }));
    assert.match(dialog().textContent, /Full story one\./);
  } finally { await f.cleanup(); }
});
