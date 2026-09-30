// Phone-first check for the member app and the signed-out subscriber pages
// (local Chromium only; never a cloud browser). Visits the directory, a
// coach's website, joining, sign-in, recovery and legal pages signed out,
// then signs in as the synthetic member and visits every member screen at
// 360x740 and 390x844 as a touch phone, and fails when:
// - the page scrolls sideways (horizontal overflow);
// - the bottom tab bar is missing, has no current tab (aria-current) or a
//   tab shorter than 56 px;
// - a control people tap is smaller than 44x44 px (links inside running
//   text are exempt, as in WCAG 2.5.8; a checkbox counts its label);
// - something fixed covers the tab bar or the screen's primary action;
// - with reduced motion, anything animates (a tab tap, opening a sheet);
// - visible text is smaller than 12 px (MIN_TEXT; captions, chips and
//   footnotes included);
// - the voice-led session, once started, has no Done and Pain controls in
//   the bottom action bar (safety controls are never below the fold);
// - signed out: a field's text is under 16 px or the trainer-marketing
//   footer shows.
// Start it through scripts/run-phone-check.mjs (npm run test:phone), which
// seeds data and starts the servers. docs/features/phone-first.md.
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const base = process.env.TEST_APP_URL ?? "http://localhost:3000";
const password = process.env.DEMO_PASSWORD ?? "TrainerDemo2026!";
const member = process.env.PHONE_CHECK_MEMBER ?? "sam.taylor@example.test";
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
  (existsSync("/opt/pw-browsers/chromium")
    ? "/opt/pw-browsers/chromium"
    : undefined);
export const PHONES = [
  { name: "360x740", width: 360, height: 740 },
  { name: "390x844", width: 390, height: 844 },
];
export const MEMBER_ROUTES = [
  "/app",
  "/app/program",
  "/app/timeline",
  "/app/chat",
  "/app/nutrition",
  "/app/nutrition/log",
  "/app/progress",
  "/app/bookings",
  "/app/twin",
  "/app/intake",
  "/app/wearables",
  "/app/galleries",
  "/app/notifications",
  "/app/support",
  "/app/membership",
  "/app/profile",
  "/app/more",
];
// Signed-out subscriber pages (docs/features/phone-first.md, "Public,
// joining and sign-in pages"). An invitation link is added when the
// synthetic owner can create one.
export const PUBLIC_ROUTES = [
  "/coaches",
  "/coach/alex-morgan",
  "/coach/alex-morgan/about",
  "/coach/alex-morgan/memberships",
  "/coach/alex-morgan/galleries",
  "/coach/alex-morgan/contact",
  "/join-coach/alex-morgan",
  "/login",
  "/forgot-password",
  "/magic-link",
  "/terms",
  "/privacy",
  "/ai-disclosure",
];
const owner = process.env.PHONE_CHECK_OWNER ?? "coach@example.test";
// PHONE_CHECK_LANG=ar runs every screen in Arabic (docs/features/arabic.md):
// the member's saved language for the member app, the ?lang= choice for the
// signed-out pages. Arabic labels are longer, so targets and overflow are
// re-measured, and each screen must render right to left.
const language = process.env.PHONE_CHECK_LANG === "ar" ? "ar" : "en";
/** Saves the member's language through the real preferences API. */
async function saveLanguage(ctx, value) {
  const current = await (
    await ctx.request.get(base + "/api/v1/notifications/preferences")
  ).json();
  const { options, ...body } = current;
  const saved = await ctx.request.put(
    base + "/api/v1/notifications/preferences",
    {
      headers: { origin: base },
      data: { ...body, data: { ...body.data, language: value } },
      failOnStatusCode: false,
    },
  );
  if (!saved.ok())
    throw new Error(`saving the language answered ${saved.status()}`);
}
const MIN_TARGET = 44;
const MIN_TAB = 56;
const MIN_TEXT = 12;

const failures = [];
const measured = [];
const pageErrors = [];
const fail = (label, message) => failures.push(`${label}: ${message}`);

/** Everything the rules need, measured in the page. */
function inspect({ minTarget, minTab, minText = 12, publicPage = false }) {
  const width = window.innerWidth;
  const root = document.documentElement;
  const visible = (el) =>
    (typeof el.checkVisibility !== "function" ||
      el.checkVisibility({ visibilityProperty: true })) &&
    // The analytics preferences control belongs to the root layout
    // (components/acquisition.tsx) and has its own check in
    // browser-completion-check.mjs; it is dismissed before measuring.
    !el.closest(
      "[aria-hidden='true'], [hidden], .sr-only, .skip-link, .acquisition-consent" +
        // The platform's marketing header on the directory and platform
        // sign-in pages belongs to the marketing site (brand-check.mjs).
        (publicPage ? ", .mk-header" : ""),
    );
  const describe = (el) =>
    `${el.tagName.toLowerCase()}${
      typeof el.className === "string" && el.className
        ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".")
        : ""
    } "${(el.getAttribute("aria-label") || el.textContent || el.value || "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 40)}"`;
  // Tap targets.
  const small = [];
  for (const el of document.querySelectorAll(
    "a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab]",
  )) {
    if (!visible(el)) continue;
    const style = getComputedStyle(el);
    // Links inside a sentence are exempt; standalone links are not.
    if (el.tagName === "A" && style.display === "inline") continue;
    let target = el;
    if (
      el.tagName === "INPUT" &&
      ["checkbox", "radio"].includes(el.type) &&
      el.closest("label")
    )
      target = el.closest("label");
    const r = target.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (r.width < minTarget - 0.5 || r.height < minTarget - 0.5)
      small.push(
        `${describe(el)} ${Math.round(r.width)}x${Math.round(r.height)}`,
      );
  }
  // Tab bar.
  const bar = document.querySelector(".member-tabbar");
  const barShown = !!bar && getComputedStyle(bar).display !== "none";
  const tabs = barShown ? [...bar.querySelectorAll("a")] : [];
  const current = tabs.filter((t) => t.getAttribute("aria-current") === "page");
  const shortTabs = tabs
    .filter((t) => t.getBoundingClientRect().height < minTab - 0.5)
    .map(describe);
  // Hit tests: is the element (or its content) what a tap at its centre reaches?
  const reaches = (el) => {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2,
      y = r.top + r.height / 2;
    if (y < 0 || y > window.innerHeight || x < 0 || x > width) return null;
    const hit = document.elementFromPoint(x, y);
    // The Next.js development indicator is not part of the app.
    if (hit?.closest?.("nextjs-portal")) return true;
    return hit && (hit === el || el.contains(hit))
      ? true
      : hit
        ? describe(hit)
        : "nothing";
  };
  const coveredTabs = tabs
    .map((t) => [describe(t), reaches(t)])
    .filter(([, r]) => r !== true && r !== null)
    .map(([t, r]) => `${t} under ${r}`);
  const sticky = document.querySelector(
    ".sticky-action-bar .sticky-action-buttons > :last-child",
  );
  // Form fields under 16 px make iOS zoom in.
  const smallFields = [
    ...document.querySelectorAll(
      "input:not([type=checkbox]):not([type=radio]):not([type=hidden]), select, textarea",
    ),
  ]
    .filter(
      (el) =>
        visible(el) &&
        !el.closest(".site-honeypot") &&
        parseFloat(getComputedStyle(el).fontSize) < 16,
    )
    .map(describe);
  // Text under the minimum size (read on a phone at arm's length).
  const smallText = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || seen.has(el) || !n.textContent.trim()) continue;
    seen.add(el);
    if (el.closest("script, style, noscript, nextjs-portal, svg, .site-honeypot"))
      continue;
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size < minText - 0.05)
      smallText.push(`${describe(el)} ${size.toFixed(1)}px`);
  }
  return {
    path: location.pathname,
    smallText,
    overflow: Math.max(
      root.scrollWidth - root.clientWidth,
      document.body.scrollWidth - document.body.clientWidth,
    ),
    small,
    barShown,
    tabCount: tabs.length,
    currentTabs: current.length,
    shortTabs,
    coveredTabs,
    stickyPrimary: sticky ? describe(sticky) : null,
    stickyReach: sticky ? reaches(sticky) : null,
    loading: !!document.querySelector(".loading-screen"),
    lang: document.documentElement.lang,
    dir: document.documentElement.dir,
    smallFields,
    // Subscribers never get the trainer-marketing footer.
    trainerFooter: !!document.querySelector(".mk-footer"),
  };
}

/**
 * The signed-out pages a subscriber meets before the app: the directory, a
 * coach's website, joining, sign-in, recovery and the legal documents. No
 * sideways scroll, 44 px tap targets, 16 px fields, the sticky action (when
 * there is one) reachable, and no trainer-marketing footer.
 */
async function publicCheck(phone) {
  const ctx = await browser.newContext({
    viewport: { width: phone.width, height: phone.height },
    isMobile: true,
    hasTouch: true,
    serviceWorkers: "block",
  });
  ctx.setDefaultNavigationTimeout(180_000);
  ctx.setDefaultTimeout(60_000);
  const routes = [...PUBLIC_ROUTES];
  // Arabic: the visitor's explicit choice, carried by the language cookie.
  if (language === "ar")
    await ctx.addCookies([
      { name: "trainer_lang", value: "ar", url: base, sameSite: "Lax" },
    ]);
  try {
    // An invitation link from the synthetic owner, in its own context.
    const staff = await browser.newContext();
    const signIn = await staff.request.post(base + "/api/v1/auth/login", {
      headers: { origin: base },
      data: { email: owner, password },
      failOnStatusCode: false,
    });
    if (signIn.ok()) {
      const invite = await staff.request.post(base + "/api/v1/invitations", {
        headers: { origin: base },
        data: {
          email: `phone-check-${phone.width}@example.test`,
          role: "subscriber",
        },
        failOnStatusCode: false,
      });
      if (invite.ok()) routes.push(new URL((await invite.json()).url).pathname);
    }
    await staff.close();
    const page = await ctx.newPage();
    page.on("pageerror", (e) => pageErrors.push(`${page.url()}: ${e.message}`));
    let answered = false;
    for (const route of routes) {
      const label = `${phone.name} signed out ${route.replace(/\/join\/[^/]+$/, "/join/:link")}`;
      try {
        await page.goto(base + route, { waitUntil: "load" });
        await settle(page);
        if (!answered)
          for (const name of [/without analytics|دون تحليلات/i, /^(No thanks|لا، شكرًا)$/i]) {
            const choice = page.getByRole("button", { name });
            if (await choice.count().catch(() => 0)) {
              await choice
                .first()
                .click({ timeout: 5000 })
                .catch(() => {});
              answered = true;
            }
          }
        const m = await page.evaluate(inspect, {
          minTarget: MIN_TARGET,
          minTab: MIN_TAB,
          minText: MIN_TEXT,
          publicPage: true,
        });
        measured.push({ label, ...m });
        if (language === "ar" && (m.lang !== "ar" || m.dir !== "rtl"))
          fail(label, `rendered lang=${m.lang} dir=${m.dir}, expected Arabic`);
        if (m.overflow > 1)
          fail(label, `horizontal overflow of ${m.overflow}px`);
        if (m.small.length)
          fail(
            label,
            `${m.small.length} tap target(s) under ${MIN_TARGET}px: ${m.small.slice(0, 6).join("; ")}`,
          );
        if (m.smallFields.length)
          fail(label, `fields under 16 px: ${m.smallFields.join("; ")}`);
        if (m.smallText.length)
          fail(
            label,
            `${m.smallText.length} text(s) under ${MIN_TEXT}px: ${m.smallText.slice(0, 6).join("; ")}`,
          );
        if (m.trainerFooter) fail(label, "shows the trainer-marketing footer");
        if (m.stickyPrimary && m.stickyReach !== true)
          fail(
            label,
            `the primary action ${m.stickyPrimary} is covered by ${m.stickyReach}`,
          );
      } catch (e) {
        fail(label, e.message.split("\n")[0]);
      }
    }
  } finally {
    await ctx.close();
  }
}

/** The first primary button in the page content, scrolled to the middle. */
async function primaryCovered(page) {
  return page.evaluate(() => {
    const main = document.querySelector("#member-main");
    const primary = [
      ...(main?.querySelectorAll(".button:not(.secondary)") ?? []),
    ].find(
      (el) =>
        !el.closest(".sticky-action-bar, dialog") &&
        (typeof el.checkVisibility !== "function" || el.checkVisibility()),
    );
    if (!primary) return null;
    primary.scrollIntoView({ block: "center", inline: "nearest" });
    const r = primary.getBoundingClientRect();
    const hit = document.elementFromPoint(
      r.left + r.width / 2,
      r.top + r.height / 2,
    );
    if (
      !hit ||
      hit === primary ||
      primary.contains(hit) ||
      hit.closest("nextjs-portal")
    )
      return null;
    const fixed = (el) => {
      for (let n = el; n && n !== document.body; n = n.parentElement)
        if (["fixed", "sticky"].includes(getComputedStyle(n).position))
          return true;
      return false;
    };
    return fixed(hit)
      ? `${(primary.textContent || "").trim().slice(0, 40)} is under ${hit.tagName.toLowerCase()}.${String(hit.className).split(" ")[0]}`
      : null;
  });
}

async function settle(page) {
  await page
    .waitForFunction(() => !document.querySelector(".loading-screen"), null, {
      timeout: 90_000,
    })
    .catch(() => {});
  await page
    .locator("h1")
    .first()
    .waitFor({ timeout: 60_000 })
    .catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(400);
  // Microanimations (a page settling in, the action bar sliding up) finish
  // before anything is measured; endless ones (a progress bar) are ignored.
  await page
    .waitForFunction(
      () =>
        document
          .getAnimations()
          .every(
            (a) =>
              a.playState !== "running" ||
              a.effect?.getComputedTiming().iterations === Infinity,
          ),
      null,
      { timeout: 5000 },
    )
    .catch(() => {});
}

async function reducedMotionCheck() {
  const label = "390x844 reduced motion";
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    serviceWorkers: "block",
    reducedMotion: "reduce",
  });
  ctx.setDefaultNavigationTimeout(180_000);
  ctx.setDefaultTimeout(60_000);
  try {
    const signIn = await ctx.request.post(base + "/api/v1/auth/login", {
      headers: { origin: base },
      data: { email: member, password },
      failOnStatusCode: false,
    });
    if (signIn.status() !== 200)
      throw new Error(`member sign-in answered ${signIn.status()}`);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => pageErrors.push(`${page.url()}: ${e.message}`));
    const moving = () =>
      page.evaluate(() =>
        document.getAnimations().map((a) => {
          const t = a.effect?.target;
          return `${a.animationName || a.transitionProperty || "script"} on ${
            t?.className || t?.tagName || "?"
          }`;
        }),
      );
    await page.goto(base + "/app", { waitUntil: "load" });
    await settle(page);
    await page.locator(".member-tabbar a[href='/app/more']").tap();
    await page.waitForURL("**/app/more");
    await page.waitForTimeout(120);
    let playing = await moving();
    if (playing.length)
      fail(label, `after a tab tap: ${playing.slice(0, 4).join("; ")}`);
    const boot = await (
      await ctx.request.get(base + "/api/v1/bootstrap")
    ).json();
    const workout = boot.records.find(
      (r) => r.kind === "workout" && r.status === "active",
    );
    if (workout) {
      await page.goto(base + `/app/workouts/${workout.id}`, {
        waitUntil: "load",
      });
      await settle(page);
      const pain = page.locator(".sticky-action-bar .workout-pain");
      if (await pain.count()) {
        await pain.tap();
        await page.waitForTimeout(80);
        playing = await moving();
        if (playing.length)
          fail(label, `opening a sheet: ${playing.slice(0, 4).join("; ")}`);
        await page.keyboard.press("Escape");
        await page.waitForTimeout(60);
        if (await page.evaluate(() => !!document.querySelector("dialog[open]")))
          fail(label, "the sheet did not close at once on Escape");
      }
    }
    measured.push({ label, reducedMotion: true });
  } catch (e) {
    fail(label, e.message.split("\n")[0]);
  } finally {
    await ctx.close();
  }
}

const browser = await chromium.launch({
  headless: true,
  ...(executablePath ? { executablePath } : {}),
});
try {
  for (const phone of PHONES) await publicCheck(phone);
  for (const phone of PHONES) {
    const ctx = await browser.newContext({
      viewport: { width: phone.width, height: phone.height },
      isMobile: true,
      hasTouch: true,
      serviceWorkers: "block",
    });
    ctx.setDefaultNavigationTimeout(180_000);
    ctx.setDefaultTimeout(60_000);
    // Stay inside the normal request budget.
    let next = 0;
    await ctx.route("**/api/v1/**", async (route) => {
      const now = Date.now(),
        wait = Math.max(0, next - now);
      next = now + wait + 500;
      if (wait) await new Promise((r) => setTimeout(r, wait));
      await route.continue().catch(() => {});
    });
    const signIn = await ctx.request.post(base + "/api/v1/auth/login", {
      headers: { origin: base },
      data: { email: member, password },
      failOnStatusCode: false,
    });
    if (signIn.status() !== 200)
      throw new Error(`member sign-in answered ${signIn.status()}`);
    // The member's own saved language decides the workspace's.
    if (language === "ar") await saveLanguage(ctx, "ar");
    const page = await ctx.newPage();
    page.on("pageerror", (e) => pageErrors.push(`${page.url()}: ${e.message}`));
    // A workout in progress, for the workout and guided screens.
    const boot = await (
      await ctx.request.get(base + "/api/v1/bootstrap")
    ).json();
    let workout = boot.records.find(
      (r) => r.kind === "workout" && r.status === "active",
    );
    const program = boot.records.find(
      (r) => r.kind === "program" && r.status === "assigned",
    );
    if (!workout && program) {
      const started = await ctx.request.post(base + "/api/v1/workouts/start", {
        headers: { origin: base },
        data: { programId: program.id },
        failOnStatusCode: false,
      });
      if (started.ok()) workout = await started.json();
    }
    // Answer the analytics question once, as a member would.
    await page.goto(base + "/app", { waitUntil: "load" });
    await settle(page);
    for (const name of [/without analytics|دون تحليلات/i, /^(No thanks|لا، شكرًا)$/i]) {
      const choice = page.getByRole("button", { name });
      if (await choice.count().catch(() => 0))
        await choice
          .first()
          .click({ timeout: 5000 })
          .catch(() => {});
    }
    const routes = [
      ...MEMBER_ROUTES,
      ...(workout
        ? [
            `/app/workouts/${workout.id}`,
            `/app/guided/${workout.id}`,
            // Last: starting it moves the session on.
            `/app/voice-session/${workout.id}`,
          ]
        : []),
    ];
    if (!workout) fail(phone.name, "no workout to check (seed a program)");
    for (const route of routes) {
      const label = `${phone.name} ${route.replace(/[0-9a-f-]{36}/, ":id")}`;
      try {
        await page.goto(base + route, { waitUntil: "load" });
        await settle(page);
        const m = await page.evaluate(inspect, {
          minTarget: MIN_TARGET,
          minTab: MIN_TAB,
          minText: MIN_TEXT,
        });
        measured.push({ label, ...m });
        if (m.smallText.length)
          fail(
            label,
            `${m.smallText.length} text(s) under ${MIN_TEXT}px: ${m.smallText.slice(0, 6).join("; ")}`,
          );
        if (route.startsWith("/app/voice-session/")) {
          // Prepare, then Start: each is the bar's one primary action.
          // Running: Done and Pain.
          const prepare = page.locator(".sticky-action-bar .voice-prepare");
          if (await prepare.count()) {
            await prepare.last().tap();
            await page
              .locator(".sticky-action-bar .voice-start")
              .waitFor({ timeout: 30_000 })
              .catch(() => {});
            await settle(page);
          }
          const start = page.locator(".sticky-action-bar .voice-start");
          if (!(await start.count()))
            fail(label, "Start session is not in the bottom action bar");
          else {
            await start.tap();
            await page.waitForTimeout(400);
            const running = await page.evaluate(inspect, {
              minTarget: MIN_TARGET,
              minTab: MIN_TAB,
              minText: MIN_TEXT,
            });
            measured.push({ label: label + " running", ...running });
            const bar = await page.evaluate(() => {
              const reach = (el) => {
                if (!el) return "missing";
                const r = el.getBoundingClientRect();
                const hit = document.elementFromPoint(
                  r.left + r.width / 2,
                  r.top + r.height / 2,
                );
                return r.bottom <= innerHeight && hit && (hit === el || el.contains(hit))
                  ? true
                  : "not reachable";
              };
              return {
                pain: reach(document.querySelector(".sticky-action-bar .voice-pain")),
                done: reach(document.querySelector(".sticky-action-bar .voice-done")),
              };
            });
            if (bar.pain !== true) fail(label + " running", `Pain: ${bar.pain}`);
            if (bar.done !== true) fail(label + " running", `Done: ${bar.done}`);
            if (running.overflow > 1)
              fail(label + " running", `horizontal overflow of ${running.overflow}px`);
          }
        }
        if (language === "ar" && (m.lang !== "ar" || m.dir !== "rtl"))
          fail(label, `rendered lang=${m.lang} dir=${m.dir}, expected Arabic`);
        if (m.loading) fail(label, "still loading");
        if (m.path !== route) fail(label, `landed on ${m.path}`);
        if (m.overflow > 1)
          fail(label, `horizontal overflow of ${m.overflow}px`);
        if (!m.barShown) fail(label, "no bottom tab bar");
        else {
          if (m.tabCount !== 5) fail(label, `${m.tabCount} tabs, expected 5`);
          if (m.currentTabs !== 1)
            fail(label, `${m.currentTabs} tabs marked aria-current="page"`);
          if (m.shortTabs.length)
            fail(label, `tabs under ${MIN_TAB}px: ${m.shortTabs.join("; ")}`);
          if (m.coveredTabs.length)
            fail(label, `covered tabs: ${m.coveredTabs.join("; ")}`);
        }
        if (m.small.length)
          fail(
            label,
            `${m.small.length} tap target(s) under ${MIN_TARGET}px: ${m.small.slice(0, 6).join("; ")}`,
          );
        if (m.stickyPrimary && m.stickyReach !== true)
          fail(
            label,
            `the primary action ${m.stickyPrimary} is covered by ${m.stickyReach}`,
          );
        const covered = await primaryCovered(page);
        if (covered) fail(label, covered);
      } catch (e) {
        fail(label, e.message.split("\n")[0]);
      }
    }
    await ctx.close();
  }
  // With reduced motion the member app is still: moving to another tab and
  // opening a bottom sheet start no animation at all (phone-first.css
  // "Motion", components/motion.ts).
  await reducedMotionCheck();
} finally {
  await browser.close();
  await mkdir("test-results", { recursive: true });
  await writeFile(
    `test-results/phone-check${language === "ar" ? "-ar" : ""}.json`,
    JSON.stringify({ failures, pageErrors, measured }, null, 2),
  );
}
console.log(
  `Phone check${language === "ar" ? " (Arabic)" : ""}: ${measured.length} screen measurements, ${failures.length} failure(s), ${pageErrors.length} page error(s).`,
);
for (const f of failures) console.log("FAIL " + f);
for (const e of pageErrors) console.log("PAGE ERROR " + e);
if (failures.length || pageErrors.length) process.exitCode = 1;
