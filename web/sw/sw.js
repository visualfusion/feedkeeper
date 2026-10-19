// FeedKeeper service worker. Built into dist/sw.js, where the placeholder below is
// replaced with a hash of the build's file names so every release gets its own app cache.
const BUILD_ID = "__BUILD_ID__";
const STATIC_CACHE = `fk-static-${BUILD_ID}`;
const API_CACHE = "fk-api";
let privateGeneration = 0;
let authenticationChanges = 0;

async function invalidatePrivateCache() {
  privateGeneration++;
  await caches.delete(API_CACHE);
}

async function authenticate(request) {
  authenticationChanges++;
  try {
    await invalidatePrivateCache();
    return await fetch(request);
  } finally {
    // Responses that started before the cookie changed must not refill the new session's cache.
    await invalidatePrivateCache();
    authenticationChanges--;
  }
}
const SHELL = "/index.html";
const PRECACHE = ["/theme-init.js", "/manifest.webmanifest", "/logo.svg", "/favicon-32.png?v=2", "/app-icon-180.png?v=2", "/app-icon-192.png?v=2", "/app-icon-512.png?v=2"];
// The server answers with `Vary: Origin`, but entries cached without that header must still match.
const MATCH = { ignoreVary: true };
const NETWORK_TIMEOUT_MS = 4000;
const MAX_CACHED_ITEM_LISTS = 30;
const MAX_CACHED_IMAGES = 3000;

// Read-only API responses worth showing when the network is gone. Everything else
// (tokens, users, settings, mutations) always goes to the server.
const READABLE_API = [/^\/api\/onboarding\/status$/, /^\/api\/config$/, /^\/api\/auth\/me$/, /^\/api\/feeds$/, /^\/api\/folders$/, /^\/api\/items$/, /^\/api\/filters\/muted$/];
const FEED_ICON = /^\/api\/feeds\/\d+\/icon$/;
const MUTABLE_IMAGE = /^\/api\/items\/\d+\/image$/;
const IMMUTABLE_API = [/^\/api\/archive\/images\/\d+$/, /^\/api\/auth\/me\/avatar$/];
// Files next to index.html (theme script, manifest, icons) are the only other thing served from the cache. Any other
// path answers per request and per signed-in user, so a stored copy could show one account another's data.
const STATIC_FILE = /^\/[^/]+\.(?:js|css|svg|png|ico|webmanifest|txt|woff2?)$/;

self.addEventListener("install", (event) => {
  event.waitUntil(precache().catch(() => undefined).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name.startsWith("fk-static-") && name !== STATIC_CACHE).map((name) => caches.delete(name)));
      // Older releases stored personal responses without checking account ownership.
      await invalidatePrivateCache();
      await caches.delete("fk-offline");
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "cache-urls" || !Array.isArray(event.data.urls)) return;
  event.waitUntil(cacheUrls(event.data.urls));
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.method !== "GET") {
    if (url.pathname.startsWith("/api/auth/") || url.pathname.startsWith("/auth/") || url.pathname.startsWith("/api/onboarding/")) {
      event.respondWith(authenticate(request));
    }
    return;
  }
  // While a login changes the cookie, personal requests must bypass all offline responses.
  if (authenticationChanges && url.pathname.startsWith("/api/")) return;
  // Server-rendered OAuth pages and discovery documents must never be answered with the app shell.
  if (url.pathname.startsWith("/oauth/") || url.pathname.startsWith("/.well-known/")) return;

  if (request.mode === "navigate") {
    event.respondWith(navigate(request));
  } else if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirst(STATIC_CACHE, request));
  } else if (url.pathname.startsWith("/api/")) {
    // Lists for the offline copy are stored by the app itself.
    if (url.searchParams.has("offline")) return;
    if (FEED_ICON.test(url.pathname)) {
      event.respondWith(staleWhileRevalidate(API_CACHE, request));
    } else if (MUTABLE_IMAGE.test(url.pathname)) {
      event.respondWith(mutableImage(request));
    } else if (IMMUTABLE_API.some((pattern) => pattern.test(url.pathname))) {
      event.respondWith(cacheFirst(API_CACHE, request, MAX_CACHED_IMAGES));
    } else if (READABLE_API.some((pattern) => pattern.test(url.pathname))) {
      event.respondWith(networkFirst(API_CACHE, request, url.pathname === "/api/items" ? MAX_CACHED_ITEM_LISTS : 0));
    }
  } else if (!url.pathname.startsWith("/mcp") && STATIC_FILE.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(STATIC_CACHE, request));
  }
});

async function precache() {
  const cache = await caches.open(STATIC_CACHE);
  const response = await fetch(SHELL, { cache: "reload" });
  if (!response.ok) return;
  const html = await response.clone().text();
  await cache.put(SHELL, response);
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((match) => match[1]);
  await Promise.all([...PRECACHE, ...assets].map((asset) => cache.add(asset).catch(() => undefined)));
}

async function cacheUrls(urls) {
  const cache = await caches.open(STATIC_CACHE);
  await Promise.all(
    urls
      .filter((raw) => typeof raw === "string" && raw.startsWith("/assets/"))
      .map(async (path) => {
        if (!(await cache.match(path, MATCH))) await cache.add(path).catch(() => undefined);
      }),
  );
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);
}

async function navigate(request) {
  const cache = await caches.open(STATIC_CACHE);
  try {
    const response = await withTimeout(fetch(request), NETWORK_TIMEOUT_MS);
    if (response.ok && response.headers.get("content-type")?.includes("text/html")) cache.put(SHELL, response.clone());
    return response;
  } catch {
    return (await cache.match(SHELL, MATCH)) ?? Response.error();
  }
}

async function cacheFirst(cacheName, request, limit = 0) {
  const generation = privateGeneration;
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, MATCH);
  if (cached && (cacheName !== API_CACHE || generation === privateGeneration)) return cached;
  const response = await fetch(request);
  if (response.ok && (cacheName !== API_CACHE || generation === privateGeneration)) {
    await cache.put(request, response.clone());
    if (limit) await trim(cache, (key) => /\/api\/(archive\/images\/|items\/\d+\/image)/.test(key.url), limit);
  }
  return response;
}

async function mutableImage(request) {
  const generation = privateGeneration;
  const cache = await caches.open(API_CACHE);
  const cached = await cache.match(request, MATCH);
  const date = cached && Date.parse(cached.headers.get("date") ?? "");
  const maxAge = Number(cached?.headers.get("cache-control")?.match(/max-age=(\d+)/)?.[1] ?? 0);
  // Old immutable proxy responses must also expire at the new six-hour boundary.
  if (cached && generation === privateGeneration && !cached.headers.get("cache-control")?.includes("no-store") && Date.now() - date < Math.min(maxAge, 21600) * 1000) return cached;
  try {
    const headers = new Headers(request.headers);
    if (cached?.headers.get("etag")) headers.set("If-None-Match", cached.headers.get("etag"));
    let response = await withTimeout(fetch(new Request(request, { headers, cache: "no-cache" })), NETWORK_TIMEOUT_MS);
    if (response.status === 304 && cached) {
      const refreshed = new Headers(cached.headers);
      for (const name of ["date", "etag", "cache-control"]) if (response.headers.has(name)) refreshed.set(name, response.headers.get(name));
      refreshed.set("date", response.headers.get("date") ?? new Date().toUTCString());
      response = new Response(await cached.arrayBuffer(), { status: 200, headers: refreshed });
    }
    if (response.ok && generation === privateGeneration) {
      if (response.headers.get("cache-control")?.includes("no-store")) await cache.delete(request);
      else { await cache.put(request, response.clone()); await trim(cache, key => /\/api\/(archive\/images\/|items\/\d+\/image)/.test(key.url), MAX_CACHED_IMAGES); }
    }
    return response; // An online denial must never fall back to the previous account's bytes.
  } catch { return generation === privateGeneration ? cached ?? Response.error() : Response.error(); }
}

async function networkFirst(cacheName, request, limit) {
  let generation = privateGeneration;
  let cache = await caches.open(cacheName);
  try {
    const response = await withTimeout(fetch(request), NETWORK_TIMEOUT_MS);
    if (generation !== privateGeneration) throw new Error("session_changed");
    if (new URL(request.url).pathname === "/api/auth/me" && generation === privateGeneration) {
      if (response.ok) {
        const user = await response.clone().json();
        const previous = await cache.match(request, MATCH);
        const previousUser = previous ? await previous.json() : null;
        if (!Number.isSafeInteger(user.id) || user.id <= 0) return Response.error();
        if (previousUser?.id !== user.id) {
          await invalidatePrivateCache();
          generation = privateGeneration;
          cache = await caches.open(cacheName);
        }
      } else if (response.status === 401) {
        await invalidatePrivateCache();
      }
    }
    if (response.ok && generation === privateGeneration && !authenticationChanges) {
      await cache.put(request, response.clone());
      if (limit) await trim(cache, (key) => new URL(key.url).pathname === new URL(request.url).pathname, limit);
    }
    return response;
  } catch (error) {
    const cached = generation === privateGeneration && !authenticationChanges ? await cache.match(request, MATCH) : null;
    if (cached && generation === privateGeneration) return cached;
    throw error;
  }
}

async function staleWhileRevalidate(cacheName, request) {
  const generation = privateGeneration;
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, MATCH);
  const refresh = fetch(request)
    .then((response) => {
      if (response.ok && (cacheName !== API_CACHE || generation === privateGeneration)) return cache.put(request, response.clone()).then(() => response);
      return response;
    })
    .catch(() => undefined);
  return (cacheName !== API_CACHE || generation === privateGeneration ? cached : null) ?? (await refresh) ?? Response.error();
}

/** Drop the oldest entries so a long-lived install does not grow without bound. */
async function trim(cache, matches, limit) {
  const keys = (await cache.keys()).filter(matches);
  await Promise.all(keys.slice(0, Math.max(0, keys.length - limit)).map((key) => cache.delete(key)));
}

// Web Push: show what the server announces and open the app where it leads.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    (async () => {
      if (typeof data.unread === "number" && self.navigator.setAppBadge) {
        await (data.unread > 0 ? self.navigator.setAppBadge(data.unread) : self.navigator.clearAppBadge()).catch(() => undefined);
      }
      await self.registration.showNotification(data.title || "FeedKeeper", {
        body: data.body || "",
        icon: "/app-icon-192.png",
        tag: data.tag,
        // Without this a second message for the same feed would replace the first silently.
        renotify: Boolean(data.tag),
        data: { url: data.url },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // Only addresses inside the app are followed.
  let target = new URL("/items", self.location.origin);
  try {
    const requested = new URL(event.notification.data?.url || "/items", self.location.origin);
    if (requested.origin === self.location.origin) target = requested;
  } catch {
    // keep the default
  }
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (open) {
        await open.focus().catch(() => undefined);
        if ("navigate" in open) await open.navigate(target.href).catch(() => undefined);
      } else {
        await self.clients.openWindow(target.href);
      }
    })(),
  );
});
