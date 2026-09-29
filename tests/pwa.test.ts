// The installable member app (docs/features/pwa.md): install manifests,
// the service worker's caching, update and clearing rules, and the rules for
// when install, update and notification prompts may appear.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import {
  APP_ICON_FILES,
  APP_SHORTCUTS,
  coachSiteManifest,
  memberAppManifest,
  platformManifest,
  shortAppName,
  type AppIconFile,
} from "../packages/contracts/src/index.ts";
import {
  cacheNames,
  consentAnswered,
  hasUnsavedInput,
  inAppBrowser,
  installKeys,
  installRoute,
  isPersonalCache,
  isSessionScreen,
  lastSyncedText,
  offlineSavedAt,
  queuedSummary,
  serviceWorkerUrl,
  showInstallCard,
  showUpdateToast,
  LAUNCH_COLOUR_SCRIPT,
} from "../apps/web/components/pwa.ts";
import { leaveSession } from "../apps/web/components/offline-queue.ts";

const root = new URL("../", import.meta.url);
const source = (path: string) => readFile(new URL(path, root), "utf8");

const icon = (file: AppIconFile) => `/icons/key/${file}?v=1`;
const base = {
  slug: "amal",
  name: "Amal Al Suwaidi Coaching",
  role: "subscriber",
  primary: "#733f32",
  surface: "#fbf5ef",
  icon,
};

test("the member manifest: one id per coach, Today with a launch marker, maskable icon, lang and dir", () => {
  const m = memberAppManifest({
    ...base,
    features: { nutrition: true, bookings: true },
  });
  assert.equal(m.id, "/coach/amal");
  assert.equal(
    memberAppManifest({ ...base, slug: "bilal", features: { nutrition: false, bookings: false } }).id,
    "/coach/bilal",
  );
  assert.equal(m.start_url, "/app?source=pwa");
  assert.equal(m.scope, "/");
  assert.equal(m.display, "standalone");
  assert.equal(m.short_name, "Amal Al");
  assert.ok(Array.from(m.short_name).length <= 12);
  assert.equal(
    m.description,
    "Your training, meals and messages with Amal Al Suwaidi Coaching.",
  );
  assert.equal(m.theme_color, "#733f32");
  assert.equal(m.background_color, "#fbf5ef");
  assert.deepEqual(m.categories, ["health", "fitness", "lifestyle"]);
  assert.deepEqual(m.launch_handler.client_mode, ["navigate-existing", "auto"]);
  assert.deepEqual(
    m.icons.map((i) => [i.src, i.sizes, i.purpose]),
    [
      ["/icons/key/192.png?v=1", "192x192", "any"],
      ["/icons/key/512.png?v=1", "512x512", "any"],
      ["/icons/key/maskable-512.png?v=1", "512x512", "maskable"],
    ],
  );
  assert.deepEqual([m.lang, m.dir], ["en", "ltr"]);
  const arabic = memberAppManifest({
    ...base,
    language: "ar",
    features: { nutrition: false, bookings: false },
  });
  assert.deepEqual([arabic.lang, arabic.dir], ["ar", "rtl"]);
  // Anything else is English, never an injected value.
  assert.equal(
    memberAppManifest({ ...base, language: "fr<", features: { nutrition: false, bookings: false } }).lang,
    "en",
  );
});

test("shortcuts appear only for features the member can use, each with a 96 px icon", () => {
  const urls = (features: { nutrition: boolean; bookings: boolean }) =>
    (memberAppManifest({ ...base, features }).shortcuts ?? []).map((s) => s.url);
  assert.deepEqual(urls({ nutrition: false, bookings: false }), [
    "/app/program?source=shortcut",
    "/app/chat?source=shortcut",
  ]);
  assert.deepEqual(urls({ nutrition: true, bookings: true }), [
    "/app/program?source=shortcut",
    "/app/nutrition/log?source=shortcut",
    "/app/chat?source=shortcut",
    "/app/bookings?source=shortcut",
  ]);
  const all = memberAppManifest({
    ...base,
    features: { nutrition: true, bookings: true },
  }).shortcuts!;
  for (const shortcut of all) {
    assert.equal(shortcut.icons.length, 1);
    assert.equal(shortcut.icons[0].sizes, "96x96");
    const file = shortcut.icons[0].src.split("/").pop()!.split("?")[0];
    assert.ok(Object.hasOwn(APP_ICON_FILES, file), file);
    assert.equal(APP_ICON_FILES[file as AppIconFile].size, 96);
    assert.ok(shortcut.short_name.length <= 12);
  }
  // Every shortcut has its icon file.
  for (const id of Object.keys(APP_SHORTCUTS))
    assert.ok(Object.hasOwn(APP_ICON_FILES, `shortcut-${id}-96.png`), id);
  // The coach's team opens the trainer workspace, with no shortcuts.
  const team = memberAppManifest({
    ...base,
    role: "owner",
    features: { nutrition: true, bookings: true },
  });
  assert.equal(team.start_url, "/trainer?source=pwa");
  assert.equal("shortcuts" in team, false);
});

test("the coach website and platform manifests", () => {
  const site = coachSiteManifest({
    slug: "amal",
    name: "Amal Al Suwaidi Coaching",
    primary: "#733f32",
    surface: "#fbf5ef",
    language: "ar",
  });
  // The same app as the member manifest of that coach.
  assert.equal(site.id, "/coach/amal");
  assert.equal(site.start_url, "/app?source=pwa");
  assert.equal(site.short_name, shortAppName("Amal Al Suwaidi Coaching"));
  assert.deepEqual([site.lang, site.dir], ["ar", "rtl"]);
  assert.deepEqual(
    site.icons.map((i) => i.purpose),
    ["any", "any", "maskable"],
  );
  const platform = platformManifest();
  // Apps installed before the launch marker keep their id ("/app").
  assert.equal(platform.id, "/app");
  assert.equal(platform.start_url, "/app?source=pwa");
  assert.equal(platform.display, "standalone");
  assert.deepEqual(platform.launch_handler.client_mode, [
    "navigate-existing",
    "auto",
  ]);
});

test("in-app browsers and install routes", () => {
  const iphone =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
  const android =
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36";
  assert.equal(inAppBrowser(iphone), null);
  assert.equal(inAppBrowser(android), null);
  assert.equal(inAppBrowser(iphone + " Instagram 350.0"), "Instagram");
  assert.equal(inAppBrowser(android + " [FB_IAB/FB4A;FBAV/480.0]"), "Facebook");
  assert.equal(inAppBrowser(android + " musical_ly_2024"), "TikTok");
  assert.equal(inAppBrowser(iphone + " WhatsApp/24.1"), "WhatsApp");
  const route = (userAgent: string, extra: Partial<Parameters<typeof installRoute>[0]> = {}) =>
    installRoute({ userAgent, standalone: false, promptAvailable: false, ...extra });
  assert.equal(route(iphone), "ios");
  assert.equal(route(iphone.replace("Version/17.5", "CriOS/129.0")), "ios-other");
  assert.equal(route(iphone + " Instagram 350.0"), "in-app");
  // In-app browsers win even when a prompt is somehow kept.
  assert.equal(route(android + " Instagram", { promptAvailable: true }), "in-app");
  assert.equal(route(android, { promptAvailable: true }), "prompt");
  assert.equal(route(android), "menu");
  assert.equal(route(android, { standalone: true }), "installed");
  // iPadOS reports a Mac with touch.
  assert.equal(
    route("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15", {
      platform: "MacIntel",
      maxTouchPoints: 5,
    }),
    "ios",
  );
});

test("the install card waits for use and the analytics choice, and never returns once dismissed or installed", () => {
  const card = (over: Partial<Parameters<typeof showInstallCard>[0]> = {}) =>
    showInstallCard({
      installed: false,
      dismissed: false,
      consentAnswered: true,
      visits: 2,
      loggedSession: false,
      ...over,
    });
  assert.equal(card(), true);
  assert.equal(card({ visits: 1 }), false);
  assert.equal(card({ visits: 1, loggedSession: true }), true);
  assert.equal(card({ consentAnswered: false }), false);
  assert.equal(card({ dismissed: true }), false);
  assert.equal(card({ installed: true }), false);
  assert.equal(consentAnswered(null, undefined), false);
  assert.equal(consentAnswered(null, false), false);
  assert.equal(consentAnswered(null, true), true);
  for (const stored of ["allowed", "declined", "dismissed"])
    assert.equal(consentAnswered(stored, false), true);
  assert.equal(consentAnswered("maybe", false), false);
  // Remembered per member on this device, by ids only.
  const keys = installKeys("t1", "u1");
  assert.equal(keys.dismissed, "member-app:install-dismissed:t1:u1");
  assert.notEqual(installKeys("t1", "u2").dismissed, keys.dismissed);
  // Outside the trainer: prefix, so sign-out's clearing keeps the dismissal.
  assert.ok(!keys.dismissed.startsWith("trainer:"));
});

test("the update toast never shows during a session, and a reload never loses typed input", () => {
  assert.equal(showUpdateToast({ waiting: true, path: "/app" }), true);
  assert.equal(showUpdateToast({ waiting: false, path: "/app" }), false);
  for (const path of [
    "/app/workouts/w1",
    "/app/guided/w1",
    "/app/voice-session/w1",
    "/app/voice-session/planned/p1",
  ]) {
    assert.equal(isSessionScreen(path), true, path);
    assert.equal(showUpdateToast({ waiting: true, path }), false, path);
  }
  assert.equal(isSessionScreen("/app/chat"), false);
  // hasUnsavedInput compares each field with its default value.
  class Input {
    type = "text";
    value = "";
    defaultValue = "";
    checked = false;
    defaultChecked = false;
    constructor(props: Partial<Input>) {
      Object.assign(this, props);
    }
    closest() {
      return null;
    }
  }
  const doc = (fields: Input[]) =>
    ({ querySelectorAll: () => fields }) as unknown as ParentNode;
  const globals = globalThis as Record<string, unknown>;
  const saved = [globals.HTMLInputElement, globals.HTMLSelectElement];
  globals.HTMLInputElement = Input;
  globals.HTMLSelectElement = class {};
  try {
    assert.equal(hasUnsavedInput(doc([new Input({})])), false);
    assert.equal(
      hasUnsavedInput(doc([new Input({ value: "Tired today" })])),
      true,
    );
    assert.equal(
      hasUnsavedInput(doc([new Input({ type: "checkbox", checked: true })])),
      true,
    );
    // A chosen file or a search box is not typed work to protect.
    assert.equal(
      hasUnsavedInput(doc([new Input({ type: "search", value: "oats" })])),
      false,
    );
  } finally {
    [globals.HTMLInputElement, globals.HTMLSelectElement] = saved;
  }
});

test("plain offline and queue wording", () => {
  assert.equal(queuedSummary(1, "set"), "1 set log saved on this phone — will sync");
  assert.equal(queuedSummary(3, "meal"), "3 meals saved on this phone — will sync");
  const now = Date.UTC(2026, 8, 29, 12, 0);
  assert.equal(lastSyncedText(null, now), null);
  assert.equal(lastSyncedText(now - 20_000, now), "Last updated just now.");
  assert.equal(lastSyncedText(now - 5 * 60_000, now), "Last updated 5 minutes ago.");
  assert.equal(lastSyncedText(now - 60 * 60_000, now), "Last updated 1 hour ago.");
  const older = lastSyncedText(now - 3 * 24 * 3600_000, now)!;
  assert.match(older, /^Last updated 26 Sept, \d{1,2}:\d{2}/);
  // No seconds and no time zone names in the wording.
  assert.doesNotMatch(older, /:\d{2}:\d{2}|UTC|GMT|\//);
  assert.equal(offlineSavedAt(JSON.stringify({ savedAt: 5 })), 5);
  assert.equal(offlineSavedAt("not json"), null);
  assert.equal(offlineSavedAt(null), null);
});

test("cache names follow the release and only page caches are personal", () => {
  assert.deepEqual(cacheNames("r7"), {
    shell: "trainer-shell-r7",
    pages: "trainer-pages-r7",
  });
  assert.equal(serviceWorkerUrl("2026 a/b"), "/sw.js?v=2026%20a%2Fb");
  assert.equal(isPersonalCache("trainer-pages-r7"), true);
  assert.equal(isPersonalCache("trainer-workout-shell-v1"), true);
  assert.equal(isPersonalCache("trainer-shell-r7"), false);
});

test("leaving a session clears cached pages after the sign-out, never before", async () => {
  const store = new Map<string, string>([["trainer:offline", "{}"]]);
  const storage = {
    get length() {
      return store.size;
    },
    key: (i: number) => [...store.keys()][i] ?? null,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  const order: string[] = [];
  const left = await leaveSession(storage, "t", "u", {
    online: false,
    post: async () => {},
    confirm: () => true,
    leave: async () => void order.push("leave"),
    afterLeave: async () => void order.push("caches"),
  });
  assert.equal(left, true);
  assert.deepEqual(order, ["leave", "caches"]);
  assert.equal(store.has("trainer:offline"), false);
  // Choosing to stay clears nothing.
  store.set("trainer:queue:t:u", JSON.stringify([{ body: { eventKey: "e" } }]));
  const stayed = await leaveSession(storage, "t", "u", {
    online: false,
    post: async () => {},
    confirm: () => false,
    leave: async () => void order.push("leave2"),
    afterLeave: async () => void order.push("caches2"),
  });
  assert.equal(stayed, false);
  assert.deepEqual(order, ["leave", "caches"]);
});

test("the launch script only colours the member app and only with a hex colour", () => {
  const run = (path: string, stored: string | null) => {
    const attributes: Record<string, string> = {};
    const style: Record<string, string> = {};
    vm.runInNewContext(LAUNCH_COLOUR_SCRIPT, {
      location: { pathname: path },
      localStorage: { getItem: () => stored },
      document: {
        documentElement: {
          setAttribute: (k: string, v: string) => (attributes[k] = v),
          style: { setProperty: (k: string, v: string) => (style[k] = v) },
        },
      },
    });
    return { attributes, style };
  };
  assert.deepEqual(run("/app", "#fbf5ef").style, { "--member-launch": "#fbf5ef" });
  assert.deepEqual(run("/app/chat", "#fbf5ef").attributes, { "data-launch": "member" });
  assert.deepEqual(run("/login", "#fbf5ef").style, {});
  assert.deepEqual(run("/app", "red;background:url(x)").style, {});
  assert.deepEqual(run("/approach", "#fbf5ef").style, {});
});

// ------------------------------------------------------------------
// The service worker, run in a sandbox with fake caches and network.
// ------------------------------------------------------------------

type Stored = { body: string; status: number };
function serviceWorker(release = "r2", activeBefore = false) {
  const caches = new Map<string, Map<string, Stored>>();
  const handlers = new Map<string, (event: any) => void>();
  const network = { online: true, pages: new Map<string, string>() };
  let skipped = 0,
    claimed = 0;
  const keyOf = (request: any) =>
    typeof request === "string"
      ? request
      : new URL(request.url, "https://app.test").pathname +
        new URL(request.url, "https://app.test").search;
  const toResponse = (s: Stored) =>
    new Response(s.body, { status: s.status, headers: { "Content-Type": "text/html" } });
  const fetchFake = async (request: any) => {
    if (!network.online) throw new TypeError("Failed to fetch");
    const key = keyOf(request).split("?")[0];
    const body = network.pages.get(key);
    return body === undefined
      ? new Response("missing", { status: 404 })
      : new Response(body, { status: 200 });
  };
  const cacheStorage = {
    async open(name: string) {
      if (!caches.has(name)) caches.set(name, new Map());
      const cache = caches.get(name)!;
      return {
        async put(request: any, response: Response) {
          cache.set(keyOf(request), {
            body: await response.text(),
            status: response.status,
          });
        },
        async add(request: any) {
          const response = await fetchFake(request);
          if (!response.ok) throw new TypeError("bad status");
          cache.set(keyOf(request), { body: await response.text(), status: 200 });
        },
      };
    },
    async keys() {
      return [...caches.keys()];
    },
    async delete(name: string) {
      return caches.delete(name);
    },
    async match(request: any, options: { cacheName?: string } = {}) {
      const names = options.cacheName ? [options.cacheName] : [...caches.keys()];
      for (const name of names) {
        const hit = caches.get(name)?.get(keyOf(request));
        if (hit) return toResponse(hit);
      }
      return undefined;
    },
  };
  const self: any = {
    location: new URL(`https://app.test/sw.js?v=${release}`),
    registration: { active: activeBefore ? {} : null },
    addEventListener: (type: string, handler: (event: any) => void) =>
      handlers.set(type, handler),
    skipWaiting: async () => void skipped++,
    clients: { claim: async () => void claimed++, matchAll: async () => [] },
  };
  vm.runInNewContext(swSource, {
    self,
    caches: cacheStorage,
    fetch: fetchFake,
    URL,
    Response,
    Set,
    Promise,
  });
  const dispatch = async (type: string, event: any) => {
    const waits: Promise<unknown>[] = [];
    let responded: Promise<Response> | undefined;
    handlers.get(type)!({
      ...event,
      waitUntil: (p: Promise<unknown>) => waits.push(p),
      respondWith: (p: Promise<Response>) => (responded = p),
    });
    await Promise.all(waits);
    return responded ? await responded : undefined;
  };
  return {
    caches,
    network,
    dispatch,
    get skipped() {
      return skipped;
    },
    get claimed() {
      return claimed;
    },
    navigate: (path: string) =>
      dispatch("fetch", {
        request: { method: "GET", url: "https://app.test" + path, mode: "navigate" },
      }),
  };
}
let swSource = "";

test("the service worker precaches the offline page and app shell by release and takes over only on first install", async () => {
  swSource = await source("apps/web/public/sw.js");
  assert.doesNotMatch(swSource, /trainer-workout-shell-v1"/);
  const sw = serviceWorker("r2");
  sw.network.pages.set(
    "/app/offline",
    '<html><script src="/_next/static/chunks/a.js"></script><link href="/_next/static/css/b.css"></html>',
  );
  sw.network.pages.set("/app", "<html>app shell</html>");
  sw.network.pages.set("/_next/static/chunks/a.js", "js");
  sw.network.pages.set("/_next/static/css/b.css", "css");
  await sw.dispatch("install", {});
  assert.deepEqual([...sw.caches.keys()].sort(), [
    "trainer-pages-r2",
    "trainer-shell-r2",
  ]);
  assert.deepEqual([...sw.caches.get("trainer-shell-r2")!.keys()].sort(), [
    "/_next/static/chunks/a.js",
    "/_next/static/css/b.css",
    "/app/offline",
  ]);
  assert.ok(sw.caches.get("trainer-pages-r2")!.has("/app"));
  assert.equal(sw.skipped, 1);
  // An update waits for the member's Reload.
  const update = serviceWorker("r3", true);
  update.network.pages.set("/app/offline", "<html>offline</html>");
  await update.dispatch("install", {});
  assert.equal(update.skipped, 0);
  await update.dispatch("message", { data: { type: "SKIP_WAITING" } });
  assert.equal(update.skipped, 1);
});

test("activation removes other releases' caches; sign-out clears only personal pages", async () => {
  const sw = serviceWorker("r3");
  for (const name of [
    "trainer-shell-r2",
    "trainer-pages-r2",
    "trainer-workout-shell-v1",
    "trainer-shell-r3",
    "trainer-pages-r3",
    "someone-else",
  ])
    sw.caches.set(name, new Map([["/x", { body: "x", status: 200 }]]));
  await sw.dispatch("activate", {});
  assert.deepEqual([...sw.caches.keys()].sort(), [
    "someone-else",
    "trainer-pages-r3",
    "trainer-shell-r3",
  ]);
  assert.equal(sw.claimed, 1);
  await sw.dispatch("message", { data: { type: "CLEAR_PERSONAL" } });
  assert.deepEqual([...sw.caches.keys()].sort(), [
    "someone-else",
    "trainer-shell-r3",
  ]);
});

test("offline navigation shows the saved page, then the app home, then the offline page, never the browser's error", async () => {
  const sw = serviceWorker("r4");
  sw.network.pages.set("/app/chat", "chat page");
  sw.network.pages.set("/app/offline", "offline page");
  // Online: fetched and saved.
  assert.equal(await (await sw.navigate("/app/chat"))!.text(), "chat page");
  assert.ok(sw.caches.get("trainer-pages-r4")!.has("/app/chat"));
  await sw.dispatch("install", {});
  sw.network.online = false;
  assert.equal(await (await sw.navigate("/app/chat?source=pwa"))!.text(), "chat page");
  // Never saved: the offline page (the app home was not available either).
  sw.caches.get("trainer-pages-r4")!.delete("/app");
  assert.equal(await (await sw.navigate("/app/bookings"))!.text(), "offline page");
  // Pages outside the app get the offline page too, and are never saved.
  assert.equal(await (await sw.navigate("/login"))!.text(), "offline page");
  assert.ok(!sw.caches.get("trainer-pages-r4")!.has("/login"));
  // Without any cache the worker still answers with its own short page.
  const bare = serviceWorker("r5");
  bare.network.online = false;
  const fallback = (await bare.navigate("/app"))!;
  assert.equal(fallback.status, 503);
  assert.match(await fallback.text(), /You're offline/);
});

test("the API, notifications and other origins are never intercepted", async () => {
  const sw = serviceWorker("r6");
  for (const url of [
    "https://app.test/api/v1/bootstrap",
    "https://app.test/app/notifications",
    "https://elsewhere.test/app",
  ])
    assert.equal(
      await sw.dispatch("fetch", {
        request: { method: "GET", url, mode: "navigate" },
      }),
      undefined,
      url,
    );
  assert.equal(
    await sw.dispatch("fetch", {
      request: { method: "POST", url: "https://app.test/app", mode: "navigate" },
    }),
    undefined,
  );
});

test("installed-app wiring in the root layout and the web app", async () => {
  const layout = await source("apps/web/app/layout.tsx");
  assert.match(layout, /appleWebApp: \{ capable: true, title: name, statusBarStyle: "default" \}/);
  assert.match(layout, /"apple-mobile-web-app-capable": "yes"/);
  assert.match(layout, /LAUNCH_COLOUR_SCRIPT/);
  assert.match(layout, /import "\.\/pwa\.css"/);
  const config = await source("apps/web/next.config.ts");
  assert.match(config, /generateBuildId: async \(\) => release/);
  assert.match(config, /NEXT_PUBLIC_APP_RELEASE: release/);
  // One registration address for everyone (the push card included).
  const push = await source("apps/web/components/push-notifications.tsx");
  assert.doesNotMatch(push, /register\("\/sw\.js"/);
  const workspace = await source("apps/web/components/workspace.tsx");
  assert.doesNotMatch(workspace, /register\("\/sw\.js"/);
  assert.doesNotMatch(workspace, /trainer-workout-shell-v1/);
  const css = (await source("apps/web/app/pwa.css")).replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );
  assert.doesNotMatch(css, /max-width/);
  assert.doesNotMatch(css, /@keyframes|animation|transition/);
});
