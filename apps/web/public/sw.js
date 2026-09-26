const CACHE = "trainer-workout-shell-v1";
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add("/app"))
      .then(() => self.skipWaiting()),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (k) => k.startsWith("trainer-workout-shell-") && k !== CACHE,
            )
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
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
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const saved = await cache.match(request);
        if (saved) return saved;
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response.clone());
        return response;
      }),
    );
    return;
  }
  if (
    request.mode === "navigate" &&
    (url.pathname === "/app" || url.pathname.startsWith("/app/"))
  ) {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response.ok) {
            const cache = await caches.open(CACHE);
            await cache.put(url.pathname, response.clone());
          }
          return response;
        })
        .catch(async () => {
          const cached =
            (await caches.match(url.pathname, { ignoreVary: true })) ??
            (await caches.match("/app", { ignoreVary: true }));
          return (
            cached ??
            new Response(
              "Open a workout while online before using it offline.",
              { status: 503, headers: { "Content-Type": "text/plain" } },
            )
          );
        }),
    );
  }
});

const PUSH_OPEN_PATH = "/api/v1/notifications/push/open";
self.addEventListener("push", (event) => {
  // Deliberately ignore payloads and never fetch inbox details for a shared screen.
  event.waitUntil(
    self.registration.showNotification("Trainer Brain", {
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
