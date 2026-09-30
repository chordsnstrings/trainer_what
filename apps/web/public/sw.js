// The member app's service worker (docs/features/pwa.md).
//
// Versioned by release: the page registers /sw.js?v=<release>
// (components/pwa.ts), so every build installs a new worker. A new worker
// waits until the member taps "Reload" in the update toast (or every tab
// closes); the first install takes over at once. Caches:
// - trainer-shell-<release>: build assets and the offline page (no personal
//   data);
// - trainer-pages-<release>: member app pages opened on this device, removed
//   on sign-out, a coach switch or leaving a coach (CLEAR_PERSONAL and
//   clearPersonalCaches in components/pwa.ts).
// /api/ and the notification inbox are never cached; push stays payloadless.
const VERSION =
  new URL(self.location.href).searchParams.get("v")?.replace(/[^\w.-]/g, "") ||
  "dev";
const SHELL = "trainer-shell-" + VERSION;
const PAGES = "trainer-pages-" + VERSION;
// Under /app so a coach's own domain passes it through to the platform.
const OFFLINE_PAGE = "/app/offline";
const APP_HOME = "/app";

const isAppPath = (path) => path === APP_HOME || path.startsWith(APP_HOME + "/");
const isPersonal = (name) =>
  name.startsWith("trainer-pages-") || name.startsWith("trainer-workout-shell-");

/** Adds a page and the build assets it references (scripts, styles, fonts). */
async function precachePage(cache, path, assets) {
  const response = await fetch(path, { credentials: "same-origin" });
  if (!response.ok || response.redirected) return;
  const html = await response.clone().text();
  await cache.put(path, response);
  const found = html.match(/\/_next\/static\/[^"'\s<>)\\]+/g) || [];
  for (const url of found) assets.add(url);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL);
      const pages = await caches.open(PAGES);
      const assets = new Set();
      // The offline page must be there; the app home is a bonus.
      await precachePage(shell, OFFLINE_PAGE, assets);
      await precachePage(pages, APP_HOME, assets).catch(() => {});
      await Promise.all(
        [...assets].map((url) => shell.add(url).catch(() => {})),
      );
      // The first install controls pages at once; an update waits for the
      // member's "Reload" (or for every tab of the app to close).
      if (!self.registration.active) await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(
            (k) =>
              (k.startsWith("trainer-") && k !== SHELL && k !== PAGES) ||
              // Earlier releases' single cache held workout pages.
              k.startsWith("trainer-workout-shell-"),
          )
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  // Only this origin's pages can message this worker.
  const type = event.data && event.data.type;
  if (type === "SKIP_WAITING") void self.skipWaiting();
  if (type === "CLEAR_PERSONAL")
    event.waitUntil(
      caches
        .keys()
        .then((keys) =>
          Promise.all(keys.filter(isPersonal).map((k) => caches.delete(k))),
        ),
    );
});

async function offlineResponse() {
  const cached = await caches.match(OFFLINE_PAGE, {
    cacheName: SHELL,
    ignoreVary: true,
  });
  return (
    cached ||
    new Response(
      "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>You're offline</title><body style='font-family:system-ui,sans-serif;padding:24px'><h1>You're offline</h1><p>Connect to the internet, then try again.</p><p><a href=''>Try again</a></p>",
      { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
    )
  );
}

self.addEventListener("fetch", (event) => {
  const request = event.request,
    url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    url.pathname === "/app/notifications" ||
    url.pathname === "/trainer/notifications"
  )
    return;
  if (url.pathname.startsWith("/_next/static/")) {
    // Build assets never change under the same address.
    event.respondWith(
      (async () => {
        const saved = await caches.match(request, { ignoreVary: true });
        if (saved) return saved;
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(SHELL);
          await cache.put(request, response.clone());
        }
        return response;
      })(),
    );
    return;
  }
  if (request.mode !== "navigate") return;
  if (url.pathname === OFFLINE_PAGE) {
    event.respondWith(fetch(request).catch(() => offlineResponse()));
    return;
  }
  if (isAppPath(url.pathname)) {
    // Network first: the member sees fresh pages online; offline, the last
    // copy of this page, the app home, then the offline page.
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (response.ok && !response.redirected) {
            const cache = await caches.open(PAGES);
            await cache.put(url.pathname, response.clone());
          }
          return response;
        } catch {
          return (
            (await caches.match(url.pathname, {
              cacheName: PAGES,
              ignoreVary: true,
            })) ||
            (await caches.match(APP_HOME, {
              cacheName: PAGES,
              ignoreVary: true,
            })) ||
            (await offlineResponse())
          );
        }
      })(),
    );
    return;
  }
  // Any other page of this site: the offline page instead of the browser's
  // error page when there is no connection. Nothing is cached.
  event.respondWith(fetch(request).catch(() => offlineResponse()));
});

const PUSH_OPEN_PATH = "/api/v1/notifications/push/open";
self.addEventListener("push", (event) => {
  // Deliberately ignore payloads and never fetch inbox details for a shared screen.
  event.waitUntil(
    // A neutral title: member apps carry their trainer's brand.
    self.registration.showNotification("Coaching update", {
      body: "You have an update. Open the app to view your inbox.",
      tag: "trainer-updates",
      data: { url: PUSH_OPEN_PATH },
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      // Resolve the signed-in role on the server; notification data never supplies a URL.
      const target = new URL(PUSH_OPEN_PATH, self.location.origin).href;
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        try {
          const navigated = await client.navigate(target);
          if (navigated) {
            await navigated.focus();
            return;
          }
        } catch {}
      }
      await self.clients.openWindow(target);
    })(),
  );
});
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      // A new subscription must be explicitly connected to a current login session.
      if (event.newSubscription)
        await event.newSubscription.unsubscribe().catch(() => {});
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of windows)
        client.postMessage({ type: "trainer-push-subscription-changed" });
    })(),
  );
});
