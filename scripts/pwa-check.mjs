// Installable-app check (docs/features/pwa.md), local Chromium only (never a
// cloud browser), against running servers (TEST_APP_URL); start it through
// scripts/run-pwa-check.mjs (npm run test:pwa), which seeds a fresh database
// and starts the production build. It fails when:
// - Chromium reports an installability error (CDP
//   Page.getInstallabilityErrors) for the signed-in member app or the coach
//   website, or its manifest (Page.getAppManifest) has errors or lacks the
//   per-coach id, the launch marker, the maskable icon or the shortcuts;
// - the release's service worker does not control /app;
// - reloading /app or opening an unvisited member page offline shows the
//   browser's error page instead of Today or the offline screen;
// - the "New version ready" toast does not appear when a new worker waits,
//   or its Reload does not switch to that worker;
// - sign-out leaves a cached page or the saved member data behind.
// Results go to test-results/pwa-check.json.
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const base = process.env.TEST_APP_URL ?? "http://localhost:3000";
const password = process.env.DEMO_PASSWORD ?? "TrainerDemo2026!";
const member = process.env.PWA_CHECK_MEMBER ?? "sam.taylor@example.test";
const coachSlug = process.env.PWA_CHECK_COACH ?? "alex-morgan";
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
  (existsSync("/opt/pw-browsers/chromium")
    ? "/opt/pw-browsers/chromium"
    : undefined);

const failures = [];
const passed = [];
const pageErrors = [];
const check = (label, ok, detail = "") => {
  if (ok) passed.push(label);
  else failures.push(`${label}${detail ? ": " + detail : ""}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, timeout = 30_000, step = 250) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await fn().catch(() => undefined);
    if (value) return value;
    if (Date.now() > end) return value;
    await wait(step);
  }
}
/** Installability and the manifest Chromium actually parsed. */
async function manifestOf(page) {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { installabilityErrors } = await cdp.send(
      "Page.getInstallabilityErrors",
    );
    const manifest = await cdp.send("Page.getAppManifest");
    return {
      installabilityErrors,
      url: manifest.url,
      errors: manifest.errors,
      data: manifest.data ? JSON.parse(manifest.data) : null,
    };
  } finally {
    await cdp.detach().catch(() => {});
  }
}
/** Not Chromium's own error page ("No internet"). */
async function appShown(page) {
  if (page.url().startsWith("chrome-error://")) return "browser error page";
  return page.evaluate(() =>
    document.querySelector(".member-shell")
      ? "member app"
      : document.querySelector("#offline-title")
        ? "offline screen"
        : "",
  );
}

// A real (not incognito) profile: Chromium never offers to install from an
// incognito window. A fresh profile per context, removed afterwards.
const profiles = [];
const contexts = [];
async function phoneContext() {
  const dir = await mkdtemp(join(tmpdir(), "pwa-check-"));
  profiles.push(dir);
  const ctx = await chromium.launchPersistentContext(dir, {
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    serviceWorkers: "allow",
  });
  ctx.setDefaultNavigationTimeout(180_000);
  ctx.setDefaultTimeout(60_000);
  contexts.push(ctx);
  return ctx;
}
const summary = {};
try {
  // ---------------------------------------------------------------
  // The coach website, as a visitor.
  // ---------------------------------------------------------------
  {
    const ctx = await phoneContext();
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    page.on("pageerror", (e) => pageErrors.push(`${page.url()}: ${e.message}`));
    await page.goto(`${base}/coach/${coachSlug}`, { waitUntil: "load" });
    const site = await until(async () => {
      const m = await manifestOf(page);
      return m.data ? m : undefined;
    });
    summary.coachWebsite = site;
    check(
      "coach website: manifest is the coach's",
      site?.url?.includes(`/api/v1/public/sites/${coachSlug}/manifest.webmanifest`),
      site?.url,
    );
    check(
      "coach website: manifest parses without errors",
      site && !site.errors.length,
      JSON.stringify(site?.errors),
    );
    check(
      "coach website: installable",
      site && !site.installabilityErrors.length,
      JSON.stringify(site?.installabilityErrors),
    );
    check(
      "coach website: same app id as the member app",
      site?.data?.id === `/coach/${coachSlug}`,
      site?.data?.id,
    );
    check(
      "coach website: maskable icon",
      site?.data?.icons?.some((i) => i.purpose === "maskable"),
    );
    await ctx.close();
  }

  // ---------------------------------------------------------------
  // The member app.
  // ---------------------------------------------------------------
  const ctx = await phoneContext();
  const signIn = await ctx.request.post(base + "/api/v1/auth/login", {
    headers: { origin: base },
    data: { email: member, password },
    failOnStatusCode: false,
  });
  if (signIn.status() !== 200)
    throw new Error(`member sign-in answered ${signIn.status()}`);
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  page.on("pageerror", (e) => pageErrors.push(`${page.url()}: ${e.message}`));
  // The installed app opens here.
  await page.goto(base + "/app?source=pwa", { waitUntil: "load" });
  await page.waitForSelector(".member-shell", { timeout: 120_000 });
  for (const name of [/without analytics/i, /^No thanks$/i]) {
    const choice = page.getByRole("button", { name });
    if (await choice.count().catch(() => 0))
      await choice
        .first()
        .click({ timeout: 5000 })
        .catch(() => {});
  }
  // The member manifest replaces the platform's once the workspace loads.
  await until(() =>
    page.evaluate(() =>
      document
        .querySelector('link[rel="manifest"]')
        ?.getAttribute("href")
        ?.includes("/api/v1/app/manifest.webmanifest"),
    ),
  );
  const app = await until(async () => {
    const m = await manifestOf(page);
    return m.url?.includes("/api/v1/app/manifest.webmanifest") && m.data
      ? m
      : undefined;
  });
  summary.memberApp = app;
  check(
    "member app: the member manifest is linked",
    !!app,
    "platform manifest still linked",
  );
  check(
    "member app: manifest parses without errors",
    app && !app.errors.length,
    JSON.stringify(app?.errors),
  );
  check(
    "member app: installable",
    app && !app.installabilityErrors.length,
    JSON.stringify(app?.installabilityErrors),
  );
  const data = app?.data ?? {};
  check("member app: per-coach id", data.id === `/coach/${coachSlug}`, data.id);
  check(
    "member app: opens Today with the launch marker",
    data.start_url === "/app?source=pwa",
    data.start_url,
  );
  check("member app: standalone", data.display === "standalone");
  check(
    "member app: short name fits under an icon",
    typeof data.short_name === "string" && [...data.short_name].length <= 12,
    data.short_name,
  );
  check(
    "member app: 192, 512 and maskable 512 icons",
    ["192x192:any", "512x512:any", "512x512:maskable"].every((want) =>
      data.icons?.some((i) => `${i.sizes}:${i.purpose}` === want),
    ),
  );
  check(
    "member app: shortcuts with 96 px icons",
    data.shortcuts?.length >= 2 &&
      data.shortcuts.every((s) => s.icons?.[0]?.sizes === "96x96"),
    JSON.stringify(data.shortcuts?.map((s) => s.url)),
  );
  check(
    "member app: launch handler reuses the open window",
    JSON.stringify(data.launch_handler?.client_mode) ===
      JSON.stringify(["navigate-existing", "auto"]),
  );
  check("member app: lang and dir", !!data.lang && !!data.dir);
  // iOS meta.
  const head = await page.evaluate(() => ({
    capable: document
      .querySelector('meta[name="apple-mobile-web-app-capable"]')
      ?.getAttribute("content"),
    mobileCapable: document
      .querySelector('meta[name="mobile-web-app-capable"]')
      ?.getAttribute("content"),
    title: document
      .querySelector('meta[name="apple-mobile-web-app-title"]')
      ?.getAttribute("content"),
    touchIcon: document
      .querySelector('link[rel="apple-touch-icon"]')
      ?.getAttribute("href"),
    viewport: document
      .querySelector('meta[name="viewport"]')
      ?.getAttribute("content"),
  }));
  summary.head = head;
  check("iOS: apple-mobile-web-app-capable", head.capable === "yes");
  check("iOS: mobile-web-app-capable", head.mobileCapable === "yes");
  check("iOS: the coach's short name as the title", !!head.title, head.title);
  check(
    "iOS: the coach's 180 px icon",
    /\/api\/v1\/app\/icons\/.+\/180\.png/.test(head.touchIcon ?? ""),
    head.touchIcon,
  );
  check(
    "iOS: viewport-fit=cover",
    /viewport-fit=cover/.test(head.viewport ?? ""),
    head.viewport,
  );

  // Service worker: this release's, controlling /app.
  let controlled = await until(
    () =>
      page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? ""),
    20_000,
  );
  if (!controlled) {
    await page.reload({ waitUntil: "load" });
    controlled = await until(
      () =>
        page.evaluate(
          () => navigator.serviceWorker.controller?.scriptURL ?? "",
        ),
      20_000,
    );
  }
  summary.serviceWorker = controlled;
  check(
    "service worker controls /app, versioned by release",
    /\/sw\.js\?v=[\w.-]+$/.test(controlled ?? ""),
    controlled,
  );
  const cachesBefore = await page.evaluate(() => caches.keys());
  summary.cachesBefore = cachesBefore;
  check(
    "service worker precached the shell and the offline page",
    await page.evaluate(async () => {
      const keys = await caches.keys();
      const shell = keys.find((k) => k.startsWith("trainer-shell-"));
      return !!shell && !!(await (await caches.open(shell)).match("/app/offline"));
    }),
    JSON.stringify(cachesBefore),
  );

  // Offline: reload Today, then open a page never visited.
  await ctx.setOffline(true);
  await page.reload({ waitUntil: "load" }).catch(() => {});
  const offlineToday = await until(() => appShown(page), 30_000);
  summary.offlineToday = offlineToday;
  check(
    "offline reload of /app shows Today or the offline screen",
    offlineToday === "member app" || offlineToday === "offline screen",
    offlineToday,
  );
  await page
    .goto(base + "/app/galleries", { waitUntil: "load" })
    .catch(() => {});
  const offlineOther = await until(() => appShown(page), 30_000);
  summary.offlineOther = offlineOther;
  check(
    "offline, an unvisited member page shows the app or the offline screen",
    offlineOther === "member app" || offlineOther === "offline screen",
    offlineOther,
  );
  check(
    "offline indicator in the top bar",
    offlineOther !== "member app" ||
      (await page
        .locator(".member-offline")
        .isVisible()
        .catch(() => false)),
  );
  await page
    .goto(base + "/app/offline", { waitUntil: "load" })
    .catch(() => {});
  const offlinePage = await until(async () =>
    (await page.locator("#offline-title").isVisible().catch(() => false))
      ? await page.locator(".offline-card").innerText()
      : "",
  );
  summary.offlinePage = offlinePage;
  check(
    "the offline screen says what still works",
    /You.re offline/.test(offlinePage ?? "") &&
      /sync/.test(offlinePage ?? "") &&
      /Try again/.test(offlinePage ?? ""),
    offlinePage,
  );
  await ctx.setOffline(false);
  await page.goto(base + "/app", { waitUntil: "load" });
  await page.waitForSelector(".member-shell", { timeout: 120_000 });

  // A new release waits; the toast offers Reload.
  await page.evaluate(() =>
    navigator.serviceWorker.register("/sw.js?v=pwa-check-next", {
      scope: "/",
      updateViaCache: "none",
    }),
  );
  const toast = await until(
    () => page.locator(".app-update-toast").isVisible(),
    45_000,
  );
  check("a waiting new version shows the update toast", !!toast);
  if (toast) {
    await Promise.all([
      page.waitForEvent("load", { timeout: 60_000 }).catch(() => {}),
      page
        .locator(".app-update-toast")
        .getByRole("button", { name: "Reload" })
        .click(),
    ]);
    await page.waitForSelector(".member-shell", { timeout: 120_000 });
    const now = await until(
      () =>
        page.evaluate(
          () => navigator.serviceWorker.controller?.scriptURL ?? "",
        ),
      20_000,
    );
    check(
      "Reload switches to the new version",
      /v=pwa-check-next$/.test(now ?? ""),
      now,
    );
  }

  // Sign-out clears the personal caches and the saved member data.
  await page.goto(base + "/app/more", { waitUntil: "load" });
  await page.waitForSelector(".more-screen", { timeout: 120_000 });
  const pagesBefore = await page.evaluate(async () =>
    (await caches.keys()).filter((k) => k.startsWith("trainer-pages-")),
  );
  check(
    "member pages were cached before sign-out",
    pagesBefore.length > 0,
    JSON.stringify(pagesBefore),
  );
  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Sign out" }).last().click();
  await page.waitForURL(/\/login/, { timeout: 60_000 });
  const after = await page.evaluate(async () => ({
    caches: await caches.keys(),
    offline: localStorage.getItem("trainer:offline"),
    launch: localStorage.getItem("member-app:launch"),
  }));
  summary.afterSignOut = after;
  check(
    "sign-out removes every cached member page",
    !after.caches.some(
      (k) => k.startsWith("trainer-pages-") || k.startsWith("trainer-workout-"),
    ),
    JSON.stringify(after.caches),
  );
  check(
    "sign-out keeps the build shell (no personal data)",
    after.caches.some((k) => k.startsWith("trainer-shell-")),
    JSON.stringify(after.caches),
  );
  check(
    "sign-out removes the saved member data",
    after.offline === null && after.launch === null,
  );
  await ctx.close();
} catch (error) {
  failures.push(`check stopped: ${error?.stack ?? error}`);
} finally {
  for (const ctx of contexts) await ctx.close().catch(() => {});
  for (const dir of profiles) await rm(dir, { recursive: true, force: true });
}
if (pageErrors.length)
  failures.push(...pageErrors.map((e) => `page error: ${e}`));
await mkdir("test-results", { recursive: true });
await writeFile(
  "test-results/pwa-check.json",
  JSON.stringify({ base, passed, failures, summary }, null, 2),
);
for (const line of passed) console.log("ok   " + line);
for (const line of failures) console.log("FAIL " + line);
console.log(`${passed.length} passed, ${failures.length} failed`);
if (failures.length) process.exitCode = 1;
