import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

/** Runs the service worker source with stand-ins for its globals and returns what its fetch handler does. */
async function loadWorker() {
  const source = await readFile(new URL("../sw/sw.js", import.meta.url), "utf8");
  const handlers = {};
  const scope = { addEventListener: (type, handler) => { handlers[type] = handler; }, location: { origin: "https://rss.example" }, clients: { claim: async () => {} }, skipWaiting: async () => {} };
  const cache = { match: async () => undefined, put: async () => {}, add: async () => {}, delete: async () => true, keys: async () => [] };
  new Function("self", "caches", "fetch", source)(scope, { keys: async () => [], open: async () => cache, match: async () => undefined }, async () => { throw new Error("offline"); });
  return (pathname, init = {}) => {
    let answered = false;
    handlers.fetch({
      request: { method: "GET", mode: "cors", url: `https://rss.example${pathname}`, ...init },
      respondWith: (answer) => { answered = true; Promise.resolve(answer).catch(() => {}); },
    });
    return answered;
  };
}

test("the worker answers app files from its cache and leaves everything else to the network", async () => {
  const answers = await loadWorker();
  for (const path of ["/assets/index-abc.js", "/logo.svg", "/theme-init.js", "/manifest.webmanifest", "/favicon-32.png", "/api/auth/me", "/api/feeds/3/icon"]) {
    assert.equal(answers(path), true, `${path} is served by the worker`);
  }
  assert.equal(answers("/index.html", { mode: "navigate" }), true, "navigations still get the app shell");
});

test("paths that answer per signed-in user are never cached", async () => {
  const answers = await loadWorker();
  // Anything a hosting product adds outside /api/ falls here, as do the core's own dynamic routes.
  for (const path of ["/cloud/billing/status", "/billing/status", "/admin/users", "/export/opml", "/mcp", "/oauth/authorize", "/.well-known/oauth-authorization-server", "/api/auth/users", "/api/tokens"]) {
    assert.equal(answers(path), false, `${path} goes straight to the network`);
  }
  assert.equal(answers("/api/items", { method: "POST" }), false, "only GET requests are handled");
});
