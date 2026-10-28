// Sitewide marketing motion check (local Chromium only; never a cloud
// browser). It measures the marketing pages that carry the most motion, at
// 390x844 (a phone: touch, device pixel ratio 3) and 1366x900, with the CPU
// throttled 4x. The four pages phase 1 redesigned (/, /trainer-brain, /demo
// and /pricing, docs/marketing-revamp-2026-10-26/phase1/PLAN.md) are held to
// absolute budgets (BUDGETS: LCP, its element the H1 or the lede, CLS, long
// tasks while scrolling and blocking time on load, medians of MOTION_RUNS);
// a base build would only compare different pages. Every other page is
// compared with a base build (the release before the motion pass, c856d9d):
// - LCP (median of MOTION_RUNS cold loads, the same element) and CLS, on
//   load and while scrolling through every reveal, are not worse than base;
// - no long task (> 50 ms) comes from motion: the reveal script's own work
//   (its setup and every IntersectionObserver callback, timed where they
//   run) stays under 50 ms, the median run shows no more long tasks while
//   scrolling through the reveals than base, and blocking time on load
//   shows no gross regression (it is mostly hydration and varies by
//   hundreds of ms between identical loads); long tasks while the
//   calculator settles and a FAQ or the menu opens are reported;
// - every word is visible with JavaScript off, and after a scroll-through
//   with it on; nothing on the first screen ever waits for a reveal;
// - reduced motion, both the device setting (emulated) and, separately, the
//   member's own choice (the trainer_member_motion=reduce cookie), follows
//   the marketing motion switch the build carries (data-mk-motion on the
//   marketing root, components/marketing/motion-mode.ts):
//   - "always": the same as without it: .mk-motion, the reveals, the
//     settle, a FAQ unfolding, the phone menu and the journey's auto-play
//     (on /how-it-works). Timed cold loads under each source
//     (MOTION_REDUCED_RUNS per page and width, default 3) must keep the
//     motion pass's own rules and CLS 0 (0.001 allowance) while scrolling;
//     their LCP, blocking time and scroll long tasks are compared with the
//     same cohort on MOTION_MAIN_DIR (the build before the switch) and on
//     the base, and reported, not judged (the owner accepted that cost on
//     22 October 2026);
//   - "device": no reveal, no running animation or transition, no settle,
//     and the page is static;
// - the pinned scroll scenes follow both settings in either mode: /?scenes=on
//   (automated browsers only get scenes with it) has <html class="scenes-on">
//   before the first paint without reduced motion, and none under either
//   source, where the journey auto-plays ("always") or waits ("device");
//   once / mounts no scene (phase 1 parks the engine, docs/features/
//   scroll-scenes.md), only the class and CLS are checked there;
// - the scenes' frame loop is event-driven (scroll-scenes.ts): with scenes on,
//   every animation-frame callback on the page is counted; frames run while
//   the page scrolls through the journey's pin, none at all in the second
//   that starts 500 ms after the last input, and a data-scenes-still toggle
//   or "scenes-on" removed without a scroll wakes it (no inline style is
//   left under a scene);
// - the concept pass (22 October 2026), untimed, on the build under test at
//   both widths, without reduced motion and (with "always") under each
//   source (the device setting and the member's cookie), and in Arabic at
//   390: the commission pills (while / has them) wait for their own
//   trigger and load from the inline start 80ms apart on the enter curve,
//   the home FAQ rows cascade 40ms apart (at most 240ms), the closing
//   button's arrow nudges once 280ms after the button itself comes into
//   view, the hero's arrow nudges once and is still by 3 s, and at rest by
//   5 s on its own timeline, both arrows nudge toward the reading
//   direction, the /features set ticks wait for the set table's own trigger
//   at every width and pop 80ms apart from 520ms, and nothing overflows
//   sideways.
//
// It starts `next start` for this checkout's existing production build (run
// `npm run build` first) and, with MOTION_BASE_DIR, for a built checkout of
// the base, on local ports. Both read one local stub for the only API route
// the marketing pages use, GET /api/v1/public/platform, the same one as
// scripts/run-marketing-motion-check.mjs: by default "ready" (registration
// open; model, payments and payouts available), so the journey player's
// launch gate is open and / and /how-it-works are measured with the player;
// MOTION_PLATFORM=closed answers 503 instead (the pages then use their
// fallback platform facts and the gate stays closed). No database, provider
// or credential. MOTION_MAIN_DIR (or MOTION_MAIN_URL, port MOTION_MAIN_PORT,
// default 3933) adds a built checkout of main before the switch, measured
// only for the reduced-motion cohort. MOTION_NEW_URL / MOTION_BASE_URL use
// servers that are already running instead (with their own API). Without a base it compares with
// MOTION_BASELINE, a JSON file written by an earlier run (its "builds.base"),
// or only reports. MOTION_RUNS cold loads per page and width (default 5),
// after one untimed load per build. Results: test-results/
// marketing-motion-sitewide.json.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { DEFAULT_FOLLOWER_MODEL } from "../packages/domain/src/marketing-calculators.ts";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const env = process.env;
const RUNS = Number(env.MOTION_RUNS ?? 5);
const REDUCED_RUNS = Number(env.MOTION_REDUCED_RUNS ?? 3);
/** The reduced-motion sources: the device setting, and the member's own choice. */
const SOURCES = ["reduce", "cookie"];
const PAGES = (env.MOTION_PAGES ?? "/,/how-it-works,/trainer-brain,/demo,/pricing,/features,/earnings-calculator").split(",");
/**
 * Absolute budgets for the pages phase 1 redesigned (medians at 4x CPU, both
 * widths, the static frames automated browsers get): LCP within 2.5 s on its
 * H1 or lede, no layout shift (0.001 allowance) on load or while scrolling,
 * no long task while scrolling through the reveals, and blocking time on
 * load within TBT. Set from the build's own measurements with headroom.
 */
const REDESIGNED = ["/", "/trainer-brain", "/demo", "/pricing"];
const BUDGETS = { lcp: 2500, cls: 0.001, longTasksScroll: 0, tbtLoad: 700 };
const VIEWPORTS = [
  { name: "390x844", viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  { name: "1366x900", viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
];
const THROTTLE = 4;
const executablePath =
  env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);

await mkdir(root + "test-results", { recursive: true });
const log = createWriteStream(root + "test-results/marketing-motion-sitewide-servers.log");
const PLATFORM = env.MOTION_PLATFORM === "closed" ? "closed" : "ready";
const apiPort = env.MOTION_API_PORT ?? "4931";
let stub = null;
/** The platform stub both servers read (see the header). */
async function startStub() {
  if (stub) return;
  if (await answers(`http://127.0.0.1:${apiPort}/health`))
    throw new Error(`port ${apiPort} answers; the check needs an unused API port (MOTION_API_PORT)`);
  const availability = {
    model: true,
    nutrition: false,
    voice: false,
    customDomains: false,
    payments: true,
    payouts: true,
    whoop: false,
    zepp: false,
    instagram: false,
    frontier: false,
  };
  stub = createServer((req, res) => {
    const path = (req.url ?? "").split("?")[0];
    if (path === "/health") return res.writeHead(200).end("ok");
    if (path === "/api/v1/public/platform" && PLATFORM === "ready") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(
        JSON.stringify({
          name: "trainsyou",
          initials: "T",
          supportEmail: null,
          companyDetails: null,
          registrationOpen: true,
          coachAddressTemplate: "https://trainsyou.example/coach/{slug}",
          availability,
          followerModel: DEFAULT_FOLLOWER_MODEL,
        }),
      );
    }
    res.writeHead(path === "/api/v1/public/platform" ? 503 : 404).end();
  });
  await new Promise((resolve) => stub.listen(Number(apiPort), "127.0.0.1", resolve));
}
const children = [];
const failures = [];
const fail = (label, message) => failures.push(`${label}: ${message}`);

async function answers(url) {
  return fetch(url, { signal: AbortSignal.timeout(2000) }).then(
    () => true,
    () => false,
  );
}
/** Starts `next start` for a built checkout; the API is left unreachable. */
async function serve(dir, port) {
  const url = `http://localhost:${port}`;
  if (await answers(url)) throw new Error(`${url} is already answering; choose another port`);
  if (!existsSync(dir + "/apps/web/.next/BUILD_ID")) throw new Error(`${dir} has no production build (npm run build)`);
  await startStub();
  const child = spawn(
    process.execPath,
    [dir + "/node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: dir + "/apps/web",
      env: {
        ...env,
        NEXT_TELEMETRY_DISABLED: "1",
        PUBLIC_APP_URL: url,
        API_INTERNAL_URL: `http://127.0.0.1:${apiPort}`,
        INTERNAL_PROXY_SECRET: randomBytes(32).toString("hex"),
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    },
  );
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  children.push(child);
  for (let i = 0; i < 200; i++) {
    if (child.exitCode !== null) throw new Error(`the server in ${dir} exited; see test-results/marketing-motion-sitewide-servers.log`);
    if (await fetch(url + "/").then((r) => r.ok, () => false)) return url;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`timed out starting ${url}`);
}

/**
 * Installed before any page script: LCP, layout shifts, long tasks, and the
 * motion script's own work, timed where it runs: the reveal's setup (from
 * adding .mk-motion to registering its print listener), each callback of
 * its IntersectionObserver (the one with the reveal's root margin) and the
 * settle animations.
 */
function instrument() {
  const describe = (el) =>
    el
      ? `${el.tagName.toLowerCase()}${typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\s+/).join(".") : ""} "${(el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40)}"`
      : null;
  const mk = (window.__mk = {
    phase: "load",
    lcp: null,
    lcpElement: null,
    shifts: [],
    longTasks: [],
    settles: 0,
    setupStart: null,
    setup: null,
    callbacks: [],
  });
  // Whether the head script turned the scroll scenes on before the body
  // was parsed (that is, before the first paint).
  document.addEventListener("DOMContentLoaded", () => {
    mk.scenesAtParse = document.documentElement.classList.contains("scenes-on");
  });
  const add = DOMTokenList.prototype.add;
  DOMTokenList.prototype.add = function (...names) {
    if (names.includes("mk-motion")) mk.setupStart = performance.now();
    return add.apply(this, names);
  };
  const listen = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, ...rest) {
    if (type === "beforeprint" && mk.setupStart !== null && mk.setup === null) mk.setup = performance.now() - mk.setupStart;
    return listen.call(this, type, ...rest);
  };
  const Observer = window.IntersectionObserver;
  if (Observer) {
    const Timed = function (callback, options) {
      if (options?.rootMargin !== "0px 0px -10% 0px") return new Observer(callback, options);
      return new Observer(function (entries, observer) {
        const start = performance.now();
        try {
          return callback.call(this, entries, observer);
        } finally {
          mk.callbacks.push({ duration: performance.now() - start, phase: mk.phase });
        }
      }, options);
    };
    Timed.prototype = Observer.prototype;
    window.IntersectionObserver = Timed;
  }
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      mk.lcp = e.startTime;
      mk.lcpElement = describe(e.element);
      mk.lcpNode = e.element;
    }
  }).observe({ type: "largest-contentful-paint", buffered: true });
  new PerformanceObserver((list) => {
    for (const e of list.getEntries())
      if (!e.hadRecentInput) mk.shifts.push({ value: e.value, at: e.startTime, phase: mk.phase });
  }).observe({ type: "layout-shift", buffered: true });
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) mk.longTasks.push({ duration: e.duration, at: e.startTime, phase: mk.phase });
  }).observe({ type: "longtask", buffered: true });
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (...args) {
    mk.settles++;
    return animate.apply(this, args);
  };
}

/** Counts every animation-frame callback on the page (the scenes' idle stop). */
function countFrames() {
  const request = window.requestAnimationFrame;
  window.__frames = [];
  window.requestAnimationFrame = function (callback) {
    return request.call(window, (now) => {
      window.__frames.push(performance.now());
      return callback(now);
    });
  };
}

/** Text hidden by opacity or visibility (not by layout: display none, closed details). */
function hiddenText() {
  const hidden = [];
  let scanned = 0;
  for (const el of document.querySelectorAll("header *, main *, footer *")) {
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (!own) continue;
    // The journey's stage is a decorative illustration (aria-hidden) whose
    // other chapters and, on phones, other side wait at opacity 0;
    // scripts/marketing-motion-check.mjs checks its words.
    if (el.closest("details:not([open]) > :not(summary), [hidden], .mk-dropdown, .sr-only, .mk-walk-stage, script, style, noscript")) continue;
    if (!el.checkVisibility()) continue; // no box: a responsive or closed part
    scanned++;
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true }))
      hidden.push(`${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]} "${el.textContent.trim().slice(0, 30)}"`);
  }
  return { scanned, hidden };
}

/** Where the reveal stands: waiting units, and any on the first screen or in the hero. */
function revealState() {
  const pending = [...document.querySelectorAll('[data-mk-reveal="pending"]')];
  return {
    motionClass: !!document.querySelector(".mk.mk-motion"),
    marked: document.querySelectorAll("[data-mk-reveal]").length,
    pending: pending.length,
    pendingOnFirstScreen: pending
      .filter((el) => el.getBoundingClientRect().top - 12 < window.innerHeight)
      .map((el) => el.className || el.tagName),
    pendingInHero: pending.filter((el) => el.closest(".mk-hero, .mk-page-head, .mk-relay")).length,
    lcpWaits: !!window.__mk?.lcpNode?.closest?.('[data-mk-reveal="pending"]'),
    infinite: document
      .getAnimations()
      .filter((a) => a.effect?.getComputedTiming?.().iterations === Infinity)
      .map((a) => a.animationName ?? a.transitionProperty ?? "script"),
  };
}

async function scrollThrough(page) {
  await page.evaluate(async () => {
    const pause = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let y = 0; y <= document.documentElement.scrollHeight - window.innerHeight + 300; y += 300) {
      window.scrollTo(0, y);
      await pause(120);
    }
    await pause(900);
  });
}

/**
 * A fresh context. `reducedMotion`: "no-preference", "reduce" (the device
 * setting, emulated) or "cookie" (no device setting; the member's own
 * "Reduce motion" choice, the trainer_member_motion=reduce cookie).
 */
async function openPage(browser, device, url, options = {}) {
  const pref = options.reducedMotion ?? "no-preference";
  const context = await browser.newContext({
    viewport: device.viewport,
    deviceScaleFactor: device.deviceScaleFactor,
    isMobile: device.isMobile,
    hasTouch: device.hasTouch,
    reducedMotion: pref === "reduce" ? "reduce" : "no-preference",
    javaScriptEnabled: options.javaScript ?? true,
  });
  if (pref === "cookie")
    await context.addCookies([{ name: "trainer_member_motion", value: "reduce", url: new URL(url).origin }]);
  await context.addInitScript(instrument);
  if (options.frames) await context.addInitScript(countFrames);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  if (options.throttle !== false) {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
  }
  await page.goto(url, { waitUntil: "load", timeout: 120_000 });
  return { context, page, errors };
}

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};
const mode = (xs) => {
  const counts = new Map();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};
/** Cumulative layout shift: the largest session window (1 s gap, 5 s cap). */
function cls(shifts) {
  let best = 0,
    current = 0,
    start = -Infinity,
    last = -Infinity;
  for (const s of [...shifts].sort((a, b) => a.at - b.at)) {
    if (s.at - last > 1000 || s.at - start > 5000) {
      current = 0;
      start = s.at;
    }
    current += s.value;
    last = s.at;
    best = Math.max(best, current);
  }
  return best;
}
const tbt = (tasks) => sum(tasks.map((t) => Math.max(0, t.duration - 50)));

/** One cold load: LCP, CLS and long tasks on load and during a scroll-through. */
async function coldLoad(browser, device, base, path, reducedMotion = "no-preference") {
  const { context, page, errors } = await openPage(browser, device, base + path, { reducedMotion });
  await page.waitForTimeout(2500);
  // LCP is read before the scroll-through: a visitor's own scroll ends LCP
  // reporting, but a scripted one does not, and sections revealed while
  // scrolling would count as late paints.
  const paint = await page.evaluate(() => {
    const n = window.__mk.lcpNode;
    const h1 = document.querySelector("main h1");
    // The lede: the first paragraph of 8 words or more after the H1, outside a showcase.
    const lede = [...document.querySelectorAll("main p")].find(
      (p) => h1 && h1.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING && !p.closest("[data-showcase], .sr-only, .eyebrow") && p.textContent.trim().split(/\s+/).length >= 8,
    );
    const role = !n ? null : n.closest?.("h1") ? "h1" : lede && (n === lede || lede.contains(n)) ? "lede" : null;
    return { lcp: window.__mk.lcp, lcpElement: window.__mk.lcpElement, lcpRole: role };
  });
  const atLoad = await page.evaluate(revealState);
  const loadHidden = await page.evaluate(hiddenText);
  await page.evaluate(() => (window.__mk.phase = "scroll"));
  await scrollThrough(page);
  const after = await page.evaluate(revealState);
  const visible = await page.evaluate(hiddenText);
  const mk = await page.evaluate(() => ({
    shifts: window.__mk.shifts,
    longTasks: window.__mk.longTasks,
    setup: window.__mk.setup,
    callbacks: window.__mk.callbacks.map((c) => c.duration),
  }));
  await context.close();
  const phase = (name) => mk.longTasks.filter((t) => t.phase === name);
  return {
    lcp: paint.lcp,
    lcpElement: paint.lcpElement,
    lcpRole: paint.lcpRole,
    clsLoad: cls(mk.shifts.filter((s) => s.phase === "load")),
    clsScroll: cls(mk.shifts.filter((s) => s.phase === "scroll")),
    longTasksLoad: phase("load").length,
    tbtLoad: tbt(phase("load")),
    longTasksScroll: phase("scroll").map((t) => Math.round(t.duration)),
    motionSetup: mk.setup,
    motionCallbackMax: mk.callbacks.length ? Math.max(...mk.callbacks) : null,
    motionCallbacks: mk.callbacks.length,
    pendingAtLoad: atLoad.pending,
    pendingOnFirstScreen: atLoad.pendingOnFirstScreen,
    pendingInHero: atLoad.pendingInHero,
    lcpWaits: atLoad.lcpWaits,
    motionClass: atLoad.motionClass,
    hiddenAtLoad: loadHidden.hidden.length,
    pendingAfterScroll: after.pending,
    hiddenAfterScroll: visible.hidden,
    infinite: after.infinite,
    errors,
  };
}

/** Interactions that trigger motion: the calculator settle, a FAQ, the phone menu. */
async function interactions(browser, device, base, reducedMotion) {
  const out = {};
  // The calculator settles after typing.
  {
    const { context, page } = await openPage(browser, device, base + "/earnings-calculator", { reducedMotion });
    await page.waitForTimeout(2000);
    await page.evaluate(() => {
      window.__mk.phase = "interact";
      window.__mk.settles = 0;
    });
    const field = page.getByLabel("Paying subscribers");
    await field.scrollIntoViewIfNeeded();
    await field.fill("250");
    await page.waitForTimeout(700);
    out.settles = await page.evaluate(() => window.__mk.settles);
    out.calculatorRunning = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length);
    out.calculatorLongTasks = await page.evaluate(() =>
      window.__mk.longTasks.filter((t) => t.phase === "interact").map((t) => Math.round(t.duration)),
    );
    await context.close();
  }
  // A FAQ opens (height and fade), and on phones the menu opens.
  {
    const { context, page } = await openPage(browser, device, base + "/how-it-works", { reducedMotion });
    await page.waitForTimeout(2000);
    await page.evaluate(() => (window.__mk.phase = "interact"));
    const faq = page.locator("details.mk-faq").first();
    await faq.scrollIntoViewIfNeeded();
    await page.waitForTimeout(700);
    const closed = await faq.evaluate((d) => d.getBoundingClientRect().height);
    await faq.locator("summary").click();
    const during = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length);
    await page.waitForTimeout(600);
    out.faq = await faq.evaluate(
      (d, closed) => ({
        open: d.open,
        grew: d.getBoundingClientRect().height > closed + 10,
        answerOpacity: getComputedStyle(d.querySelector("p")).opacity,
      }),
      closed,
    );
    out.faqRunning = during;
    if (device.isMobile) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.locator(".mk-mobile-menu > summary").click();
      out.menuRunning = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length);
      await page.waitForTimeout(600);
      out.menuOpen = await page.locator(".mk-mobile-menu").evaluate((d) => d.open);
    } else {
      const cta = page.locator(".mk-page-head .mk-cta");
      await page.evaluate(() => window.scrollTo(0, 0));
      await cta.hover();
      out.hoverRunning = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length);
    }
    out.interactLongTasks = await page.evaluate(() =>
      window.__mk.longTasks.filter((t) => t.phase === "interact").map((t) => Math.round(t.duration)),
    );
    await context.close();
  }
  return out;
}

/** JavaScript off: every word shows and nothing is marked. */
async function noScript(browser, device, base) {
  const out = {};
  for (const path of PAGES) {
    const { context, page } = await openPage(browser, device, base + path, { javaScript: false, throttle: false });
    await page.waitForTimeout(300);
    const text = await page.evaluate(hiddenText);
    const state = await page.evaluate(() => ({
      marked: document.querySelectorAll("[data-mk-reveal]").length,
      motionClass: !!document.querySelector(".mk-motion"),
    }));
    out[path] = { scanned: text.scanned, hidden: text.hidden, ...state };
    await context.close();
  }
  return out;
}

/** The marketing motion switch a build carries (data-mk-motion; "device" before it existed). */
async function switchOf(browser, base) {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(base + "/", { waitUntil: "domcontentloaded", timeout: 120_000 });
  const mode = await page.evaluate(() => document.querySelector(".mk")?.getAttribute("data-mk-motion") ?? "device");
  await context.close();
  return mode;
}

/**
 * Reduced motion, from one source ("reduce": the device setting; "cookie":
 * the member's own choice): whether the setting took, what runs at load,
 * the reveal, what is hidden after a scroll-through, and the journey's
 * auto-play once its stage is in view (/how-it-works).
 */
async function reducedState(browser, device, base, source = "reduce") {
  const out = {};
  for (const path of PAGES) {
    const { context, page, errors } = await openPage(browser, device, base + path, { reducedMotion: source });
    const setting = await page.evaluate(() => ({
      os: matchMedia("(prefers-reduced-motion: reduce)").matches,
      member: document.documentElement.dataset.reduceMotion === "on",
    }));
    await page.waitForTimeout(1500);
    const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length);
    await page.waitForTimeout(4000);
    let journey = null;
    if (await page.locator(".mk-walk-stage").count()) {
      await page.evaluate(() => document.querySelector(".mk-walk-stage").scrollIntoView({ block: "center", behavior: "instant" }));
      journey = await page
        .waitForFunction(() => document.querySelector(".mk-walk")?.dataset.state === "playing", null, { timeout: 4000, polling: 100 })
        .then(
          () => "playing",
          () => page.evaluate(() => document.querySelector(".mk-walk")?.dataset.state ?? null),
        );
      await page.evaluate(() => window.scrollTo(0, 0));
    }
    await scrollThrough(page);
    const state = await page.evaluate(revealState);
    const text = await page.evaluate(hiddenText);
    const runningAfter = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length);
    out[path] = {
      setting,
      running,
      runningAfter,
      journey,
      marked: state.marked,
      motionClass: state.motionClass,
      pendingAfterScroll: state.pending,
      infinite: state.infinite,
      hidden: text.hidden,
      errors,
    };
    await context.close();
  }
  return out;
}
/** Reduced motion from the device setting (the original pass, kept for "device" builds). */
const reduced = (browser, device, base) => reducedState(browser, device, base, "reduce");

/**
 * The pinned scroll scenes on /?scenes=on (automated browsers get scenes
 * only with it): on before the first paint without reduced motion; off under
 * either reduced-motion source, whatever the marketing switch, and then the
 * journey plays or waits as the switch says. CLS on load in each.
 */
async function scenes(browser, device, base) {
  const out = {};
  for (const pref of ["no-preference", ...SOURCES]) {
    const { context, page, errors } = await openPage(browser, device, base + "/?scenes=on", { reducedMotion: pref, frames: true });
    await page.waitForTimeout(2000);
    const r = await page.evaluate(() => ({
      atParse: window.__mk.scenesAtParse ?? null,
      after: document.documentElement.classList.contains("scenes-on"),
      clsLoad: window.__mk.shifts.reduce((n, s) => n + s.value, 0),
    }));
    // The frame loop (scroll-scenes.ts): frames while scrolling, none once
    // idle, and woken without a scroll by the attributes it watches.
    r.mounted = await page.evaluate(() => !!document.querySelector("[data-scene]"));
    const engine = !r.after || !r.mounted
      ? null
      : await page.evaluate(async () => {
          const pause = (ms) => new Promise((done) => setTimeout(done, ms));
          const since = (t) => window.__frames.filter((f) => f > t).length;
          const html = document.documentElement;
          const out = {};
          const band = document.querySelector("[data-scene='journey']");
          const top = band ? band.getBoundingClientRect().top + scrollY : innerHeight;
          let t = performance.now();
          for (let i = 1; i <= 6; i++) {
            scrollTo(0, top + i * innerHeight * 0.3);
            await pause(60);
          }
          out.scrollFrames = since(t);
          await pause(500);
          t = performance.now();
          await pause(1000);
          out.idleFrames = since(t);
          t = performance.now();
          html.setAttribute("data-scenes-still", "");
          await pause(200);
          out.stillFrames = since(t);
          html.removeAttribute("data-scenes-still");
          await pause(700);
          t = performance.now();
          html.classList.remove("scenes-on");
          await pause(300);
          out.offFrames = since(t);
          out.styledAfterOff = [...document.querySelectorAll("[data-scene], [data-scene] *")].filter(
            (el) => el.style.transform || el.style.opacity || el.style.clipPath,
          ).length;
          return out;
        });
    let journey = null;
    if (!r.after && (await page.locator(".mk-walk-stage").count())) {
      await page.evaluate(() => document.querySelector(".mk-walk-stage").scrollIntoView({ block: "center", behavior: "instant" }));
      journey = await page
        .waitForFunction(() => document.querySelector(".mk-walk")?.dataset.state === "playing", null, { timeout: 4000, polling: 100 })
        .then(
          () => "playing",
          () => page.evaluate(() => document.querySelector(".mk-walk")?.dataset.state ?? null),
        );
    }
    out[pref] = { ...r, engine, journey, errors };
    await context.close();
  }
  return out;
}

/**
 * The concept pass's motion on the build under test (22 October 2026,
 * docs/features/marketing-motion.md): the commission pills wait for their
 * own trigger and load from the inline start 80ms apart on the enter
 * curve, the home FAQ rows cascade 40ms apart (at most 240ms), the closing
 * button's arrow nudges once when the button itself comes into view, the
 * hero's arrow nudges once, over by 3 s and at rest by 5 s (read on its
 * own, untouched timeline before its direction is checked), the
 * /features set ticks wait for the set table's own trigger and pop 80ms
 * apart from 520ms, and nothing overflows sideways. Untimed: CPU
 * throttling is off.
 */
async function conceptMotion(browser, device, base, reducedMotion, query = "") {
  const out = { errors: [] };
  /** The nudge's peak (a direction check): held there, read, then let go.
   * It moves the animation's timeline, so nothing timed is read after it. */
  const peak = (page, selector) =>
    page.evaluate((sel) => {
      const el = document.querySelector(sel);
      const a = el?.getAnimations().find((x) => x.animationName === "mk-nudge");
      if (!a) return null;
      const t = a.effect.getTiming();
      a.pause();
      a.currentTime = t.delay + t.duration / 2;
      const value = getComputedStyle(el).translate;
      a.play();
      return value;
    }, selector);
  const timings = (page, selector, name) =>
    page.evaluate(
      ([sel, nm]) =>
        [...document.querySelectorAll(sel)].map((el) => {
          const a = el.getAnimations().find((x) => (x.animationName ?? x.transitionProperty) === nm);
          if (!a) return null;
          const t = a.effect.getTiming();
          return { delay: Math.round(t.delay), duration: Math.round(t.duration), easing: t.easing, iterations: t.iterations };
        }),
      [selector, name],
    );
  const until = (page, fn) => page.waitForFunction(fn, null, { timeout: 4000, polling: 50 }).then(() => true, () => false);
  try {
    const { context, page, errors } = await openPage(browser, device, base + "/" + query, { reducedMotion, throttle: false });
    await until(page, () => document.querySelector(".mk.mk-motion"));
    await page.waitForTimeout(200);
    out.hero = (await timings(page, ".mk-hero .mk-cta > .lucide-arrow-right", "mk-nudge"))[0] ?? null;
    // The commission pills, while / still has them (phase 1's home lists the bands without them).
    out.pillsAtLoad = await page.evaluate(() =>
      document.querySelector(".mk-band-pills > li")
        ? { cue: document.querySelector(".mk-band-pills").dataset.mkCue ?? null, translate: getComputedStyle(document.querySelector(".mk-band-pills > li")).translate }
        : null,
    );
    if (out.pillsAtLoad) {
      await page.evaluate(() => document.querySelector(".mk-band-pills").scrollIntoView({ block: "center", behavior: "instant" }));
      out.pillsIn = await until(page, () => document.querySelector(".mk-band-pills").dataset.mkCue === "in");
      out.pills = await timings(page, ".mk-band-pills > li", "translate");
    }
    out.overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await page.evaluate(() => document.querySelector(".mk-faqs").scrollIntoView({ block: "start", behavior: "instant" }));
    out.faqIn = await until(page, () => document.querySelector(".mk-faqs").dataset.mkCue === "in");
    out.faq = (await timings(page, ".mk-faqs > *", "translate")).map((t) => t?.delay ?? null);
    await page.evaluate(() => document.querySelector(".mk-closing-cta").scrollIntoView({ block: "center", behavior: "instant" }));
    out.closingIn = await until(page, () => document.querySelector(".mk-closing-cta").dataset.mkCue === "in");
    out.closing = (await timings(page, ".mk-closing-cta > .lucide-arrow-right", "mk-nudge"))[0] ?? null;
    out.closingPeak = await peak(page, ".mk-closing-cta > .lucide-arrow-right");
    // The hero's hand-off, on its own timeline (nothing has touched it), is
    // over by 5 s from the load.
    await page.waitForTimeout(Math.max(0, 5000 - (await page.evaluate(() => performance.now()))));
    out.heroAt5s = await page.evaluate(() => {
      const a = document.querySelector(".mk-hero .mk-cta > .lucide-arrow-right");
      return {
        at: Math.round(performance.now()),
        translate: getComputedStyle(a).translate,
        running: a.getAnimations().filter((x) => x.playState === "running").length,
      };
    });
    // Only then its direction: the nudge is restarted (its CSS animation
    // replayed) and held at its peak. The arrow is an SVG element, which
    // has no offsetWidth: reading its computed style is what applies the
    // "none" before the rule's animation comes back.
    await page.evaluate(() => {
      const a = document.querySelector(".mk-hero .mk-cta > .lucide-arrow-right");
      a.style.animation = "none";
      void getComputedStyle(a).animationName;
      a.style.animation = "";
    });
    out.heroPeak = await peak(page, ".mk-hero .mk-cta > .lucide-arrow-right");
    out.overflowAfter = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    out.errors.push(...errors);
    await context.close();
  } catch (e) {
    out.errors.push(String(e?.message ?? e));
  }
  try {
    const { context, page } = await openPage(browser, device, base + "/features" + query, { reducedMotion, throttle: false });
    await until(page, () => document.querySelector(".mk.mk-motion"));
    await page.waitForTimeout(200);
    // The set table has its own trigger (data-mk-cue), at every width.
    out.setsWait = await page.evaluate(() => ({
      cue: document.querySelector(".mk-sets")?.dataset.mkCue ?? null,
      opacity: [...document.querySelectorAll(".mk-sets svg")].map((s) => getComputedStyle(s).opacity),
    }));
    if (out.setsWait.cue === "pending") {
      await page.evaluate(() => document.querySelector(".mk-sets").scrollIntoView({ block: "center", behavior: "instant" }));
      out.setsIn = await until(page, () => document.querySelector(".mk-sets").dataset.mkCue === "in");
      out.ticks = (await timings(page, ".mk-sets svg", "scale")).map((t) => t?.delay ?? null);
      await page.waitForTimeout(1200);
      out.ticksAfter = await page.evaluate(() =>
        [...document.querySelectorAll(".mk-sets svg")].map((s) => `${getComputedStyle(s).opacity} ${getComputedStyle(s).scale}`),
      );
    }
    await context.close();
  } catch (e) {
    out.errors.push(String(e?.message ?? e));
  }
  return out;
}

/**
 * Measures the builds. Cold loads alternate between the builds run by run,
 * so the machine's load affects both alike. `builds` are measured without
 * reduced motion and, with `reducedBuilds` (the new build, main before the
 * switch and the base), under each reduced-motion source as well.
 */
async function measure(browser, builds, reducedBuilds) {
  const all = { ...builds, ...reducedBuilds };
  const results = Object.fromEntries(
    Object.keys(all).map((label) => [
      label,
      { url: all[label], pages: {}, reducedPages: {}, interactions: {}, noScript: {}, reduced: {}, scenes: {} },
    ]),
  );
  for (const device of VIEWPORTS) {
    for (const path of PAGES) {
      const key = `${device.name} ${path}`;
      for (const label of Object.keys(builds)) results[label].pages[key] = [];
      // One untimed load per build first (server caches, the browser's own
      // first-load costs), then the builds alternate which goes first.
      for (const base of Object.values(builds)) await coldLoad(browser, device, base, path);
      for (let i = 0; i < RUNS; i++) {
        const order = Object.entries(builds);
        if (i % 2) order.reverse();
        for (const [label, base] of order) results[label].pages[key].push(await coldLoad(browser, device, base, path));
      }
      for (const label of Object.keys(builds)) {
        const runs = results[label].pages[key];
        console.log(
          `${label.padEnd(4)} ${key}: LCP ${runs.map((r) => Math.round(r.lcp)).join("/")} ms, CLS ${runs.map((r) => r.clsLoad.toFixed(4)).join("/")} + scroll ${runs.map((r) => r.clsScroll.toFixed(4)).join("/")}, TBT ${runs.map((r) => Math.round(r.tbtLoad)).join("/")} ms, scroll long tasks ${runs.map((r) => r.longTasksScroll.length).join("/")}, waiting at load ${runs[0].pendingAtLoad}`,
        );
      }
      // The reduced-motion cohort, timed: each source, the builds alternating.
      if (reducedBuilds && REDUCED_RUNS > 0)
        for (const source of SOURCES) {
          const rkey = `${key} ${source}`;
          for (const label of Object.keys(reducedBuilds)) results[label].reducedPages[rkey] = [];
          for (const base of Object.values(reducedBuilds).filter((b) => !Object.values(builds).includes(b)))
            await coldLoad(browser, device, base, path, source);
          for (let i = 0; i < REDUCED_RUNS; i++) {
            const order = Object.entries(reducedBuilds);
            if (i % 2) order.reverse();
            for (const [label, base] of order)
              results[label].reducedPages[rkey].push(await coldLoad(browser, device, base, path, source));
          }
          for (const label of Object.keys(reducedBuilds)) {
            const runs = results[label].reducedPages[rkey];
            console.log(
              `${label.padEnd(4)} ${rkey}: LCP ${runs.map((r) => Math.round(r.lcp)).join("/")} ms, CLS ${runs.map((r) => r.clsLoad.toFixed(4)).join("/")} + scroll ${runs.map((r) => r.clsScroll.toFixed(4)).join("/")}, TBT ${runs.map((r) => Math.round(r.tbtLoad)).join("/")} ms, scroll long tasks ${runs.map((r) => r.longTasksScroll.length).join("/")}, .mk-motion ${runs.filter((r) => r.motionClass).length}/${runs.length}`,
            );
          }
        }
    }
    for (const [label, base] of Object.entries(builds)) {
      if (label === "new") {
        // Every source, and the scenes, on the build under test.
        results[label].interactions[device.name] = {
          motion: await interactions(browser, device, base, "no-preference"),
          reduced: await interactions(browser, device, base, "reduce"),
          cookie: await interactions(browser, device, base, "cookie"),
        };
        results[label].noScript[device.name] = await noScript(browser, device, base);
        results[label].reduced[device.name] = await reducedState(browser, device, base, "reduce");
        results[label].reducedCookie ??= {};
        results[label].reducedCookie[device.name] = await reducedState(browser, device, base, "cookie");
        results[label].scenes[device.name] = await scenes(browser, device, base);
        results[label].concept ??= {};
        results[label].concept[device.name] = {
          motion: await conceptMotion(browser, device, base, "no-preference"),
          reduced: await conceptMotion(browser, device, base, "reduce"),
          cookie: await conceptMotion(browser, device, base, "cookie"),
          // Right to left at 390: the pills enter from the right and the
          // arrows nudge left (the hero copy stays English).
          ...(device.name.startsWith("390") ? { rtl: await conceptMotion(browser, device, base, "no-preference", "?lang=ar") } : {}),
        };
      } else {
        results[label].interactions[device.name] = {
          motion: await interactions(browser, device, base, "no-preference"),
          reduced: await interactions(browser, device, base, "reduce"),
        };
        results[label].noScript[device.name] = await noScript(browser, device, base);
        results[label].reduced[device.name] = await reduced(browser, device, base);
      }
    }
  }
  return results;
}

/** A per-page summary: medians, the usual LCP element, worst CLS and scroll long tasks. */
function summarise(build, which = "pages") {
  const out = {};
  for (const [key, runs] of Object.entries(build[which] ?? {}))
    out[key] = {
      lcp: median(runs.map((r) => r.lcp)),
      lcpElement: mode(runs.map((r) => r.lcpElement)),
      lcpRole: mode(runs.map((r) => r.lcpRole)),
      clsLoad: Math.max(...runs.map((r) => r.clsLoad)),
      clsScroll: Math.max(...runs.map((r) => r.clsScroll)),
      tbtLoad: median(runs.map((r) => r.tbtLoad)),
      longTasksLoad: median(runs.map((r) => r.longTasksLoad)),
      // The median run: a busy machine adds the odd long task to any run.
      longTasksScroll: median(runs.map((r) => r.longTasksScroll.length)),
      motionSetupMax: runs.some((r) => r.motionSetup !== null) ? Math.max(...runs.map((r) => r.motionSetup ?? 0)) : null,
      motionCallbackMax: runs.some((r) => r.motionCallbackMax !== null) ? Math.max(...runs.map((r) => r.motionCallbackMax ?? 0)) : null,
    };
  return out;
}

const browser = await chromium.launch({
  headless: true,
  ...(executablePath ? { executablePath } : {}),
  args: ["--disable-background-networking", "--disable-component-update"],
});
const results = { at: new Date().toISOString(), runs: RUNS, reducedRuns: REDUCED_RUNS, throttle: THROTTLE, platform: PLATFORM, builds: {} };
try {
  const newUrl = env.MOTION_NEW_URL ?? (await serve(root.replace(/\/$/, ""), env.MOTION_WEB_PORT ?? "3931"));
  const baseUrl =
    env.MOTION_BASE_URL ?? (env.MOTION_BASE_DIR ? await serve(env.MOTION_BASE_DIR.replace(/\/$/, ""), env.MOTION_BASE_PORT ?? "3932") : null);
  const mainUrl =
    env.MOTION_MAIN_URL ?? (env.MOTION_MAIN_DIR ? await serve(env.MOTION_MAIN_DIR.replace(/\/$/, ""), env.MOTION_MAIN_PORT ?? "3933") : null);
  // The switch each build carries; the rules below follow the new build's.
  results.switch = { new: await switchOf(browser, newUrl) };
  if (mainUrl) results.switch.main = await switchOf(browser, mainUrl);
  if (baseUrl) results.switch.base = await switchOf(browser, baseUrl);
  const always = results.switch.new === "always";
  console.log(`marketing motion switch: ${JSON.stringify(results.switch)}`);
  if (!["always", "device"].includes(results.switch.new)) fail("switch", `data-mk-motion ${results.switch.new}`);
  const builds = baseUrl ? { new: newUrl, base: baseUrl } : { new: newUrl };
  const reducedBuilds = { new: newUrl, ...(mainUrl ? { main: mainUrl } : {}), ...(baseUrl ? { base: baseUrl } : {}) };
  results.builds = await measure(browser, builds, reducedBuilds);
  const recorded = env.MOTION_BASELINE ? JSON.parse(await readFile(env.MOTION_BASELINE, "utf8")) : null;
  const baseBuild = results.builds.base ?? recorded?.builds?.base ?? null;
  const now = summarise(results.builds.new);
  const then = baseBuild ? summarise(baseBuild) : null;
  results.summary = { new: now, base: then };

  /** The motion pass's own rules for one timed load (with the reveal running). */
  const ownRules = (key, r) => {
    if (r.errors.length) fail(key, `page errors: ${r.errors.slice(0, 2).join("; ")}`);
    if (r.pendingOnFirstScreen.length) fail(key, `waiting on the first screen: ${r.pendingOnFirstScreen.join(", ")}`);
    if (r.pendingInHero) fail(key, `${r.pendingInHero} unit(s) in the hero, page heading or relay wait`);
    if (r.lcpWaits) fail(key, "the LCP element waits for a reveal");
    if (!r.motionClass) fail(key, "the page root never got .mk-motion");
    if (r.pendingAfterScroll) fail(key, `${r.pendingAfterScroll} unit(s) still waiting after a scroll-through`);
    if (r.hiddenAfterScroll.length) fail(key, `hidden after a scroll-through: ${r.hiddenAfterScroll.slice(0, 3).join("; ")}`);
    if (r.infinite.length) fail(key, `infinite animation(s): ${r.infinite.join(", ")}`);
    // No long task from motion: the reveal's own work stays well under 50 ms.
    if (r.motionSetup === null || r.motionSetup > 50) fail(key, `the reveal's setup took ${r.motionSetup} ms`);
    if (r.motionCallbackMax !== null && r.motionCallbackMax > 50)
      fail(key, `a reveal callback took ${Math.round(r.motionCallbackMax)} ms`);
  };
  // The motion pass's own rules, on the new build.
  for (const [key, runs] of Object.entries(results.builds.new.pages)) for (const r of runs) ownRules(key, r);
  // The reduced-motion cohort, timed: with "always" the same rules, and
  // CLS 0 (0.001 allowance) on load and while scrolling, now that the
  // reveals run; with "device" nothing waits and the page stays still.
  for (const [key, runs] of Object.entries(results.builds.new.reducedPages))
    for (const r of runs) {
      if (always) ownRules(key, r);
      else {
        if (r.errors.length) fail(key, `page errors: ${r.errors.slice(0, 2).join("; ")}`);
        if (r.motionClass || r.pendingAtLoad) fail(key, "the reveal ran under reduced motion");
        if (r.hiddenAfterScroll.length) fail(key, `hidden after a scroll-through: ${r.hiddenAfterScroll.slice(0, 3).join("; ")}`);
      }
      if (r.clsLoad > 0.001) fail(key, `CLS on load ${r.clsLoad.toFixed(4)}`);
      if (r.clsScroll > 0.001) fail(key, `CLS while scrolling ${r.clsScroll.toFixed(4)}`);
    }
  for (const [device, byPath] of Object.entries(results.builds.new.noScript))
    for (const [path, r] of Object.entries(byPath)) {
      if (r.hidden.length) fail(`no JavaScript ${device} ${path}`, `hidden: ${r.hidden.slice(0, 3).join("; ")}`);
      if (r.marked || r.motionClass) fail(`no JavaScript ${device} ${path}`, "reveal marks without a script");
      if (r.scanned < 20) fail(`no JavaScript ${device} ${path}`, `only ${r.scanned} text elements scanned`);
    }
  // Reduced motion, from each source: the setting must have taken.
  const reducedBy = { reduce: results.builds.new.reduced, cookie: results.builds.new.reducedCookie ?? {} };
  for (const [source, byDevice] of Object.entries(reducedBy))
    for (const [device, byPath] of Object.entries(byDevice))
      for (const [path, r] of Object.entries(byPath)) {
        const label = `reduced motion (${source === "reduce" ? "device setting" : "member's choice"}) ${device} ${path}`;
        if (source === "reduce" ? !r.setting.os : !r.setting.member || r.setting.os)
          fail(label, `the setting did not take: ${JSON.stringify(r.setting)}`);
        if (r.errors.length) fail(label, `page errors: ${r.errors.slice(0, 2).join("; ")}`);
        if (r.hidden.length) fail(label, `hidden: ${r.hidden.slice(0, 3).join("; ")}`);
        if (r.infinite.length) fail(label, `infinite animation(s): ${r.infinite.join(", ")}`);
        if (always) {
          // The same as without the setting.
          if (!r.motionClass) fail(label, "the page root never got .mk-motion");
          if (r.pendingAfterScroll) fail(label, `${r.pendingAfterScroll} unit(s) still waiting after a scroll-through`);
          if (r.journey !== null && r.journey !== "playing") fail(label, `the journey did not auto-play (state ${r.journey})`);
        } else {
          if (r.running || r.runningAfter) fail(label, `${r.running}/${r.runningAfter} running animation(s)`);
          if (r.marked || r.motionClass) fail(label, "the reveal ran");
          if (r.journey === "playing") fail(label, "the journey auto-played");
        }
      }
  for (const [device, { motion, reduced: still, cookie }] of Object.entries(results.builds.new.interactions)) {
    if (!(motion.settles > 0)) fail(`settle ${device}`, "the calculator result did not settle");
    if (!motion.faq.open || !motion.faq.grew || motion.faq.answerOpacity !== "1")
      fail(`faq ${device}`, `the answer did not open fully: ${JSON.stringify(motion.faq)}`);
    if (device.startsWith("390") && !motion.menuOpen) fail(`menu ${device}`, "the phone menu did not open");
    for (const [source, other] of [["device setting", still], ["member's choice", cookie]]) {
      if (!other) continue;
      if (always) {
        // The same as without the setting: the settle plays, a FAQ unfolds
        // fully, the menu opens, and whatever moved without the setting
        // moves with it.
        if (!(other.settles > 0)) fail(`settle reduced (${source}) ${device}`, "the calculator result did not settle");
        if (!other.faq.open || !other.faq.grew || other.faq.answerOpacity !== "1")
          fail(`faq reduced (${source}) ${device}`, `the answer did not open fully: ${JSON.stringify(other.faq)}`);
        if (device.startsWith("390") && !other.menuOpen) fail(`menu reduced (${source}) ${device}`, "the phone menu did not open");
        for (const k of ["faqRunning", "menuRunning", "hoverRunning"])
          if (motion[k] > 0 && !(other[k] > 0))
            fail(`reduced motion (${source}) ${device}`, `${k}: ${motion[k]} without the setting, ${other[k]} with it`);
      } else {
        if (other.settles) fail(`settle ${device}`, `${other.settles} settle animation(s) under reduced motion (${source})`);
        if (other.calculatorRunning || other.faqRunning || other.menuRunning || other.hoverRunning)
          fail(`reduced motion (${source}) ${device}`, `running on interaction: ${JSON.stringify(other)}`);
        if (!other.faq.open || other.faq.answerOpacity !== "1") fail(`faq reduced (${source}) ${device}`, JSON.stringify(other.faq));
      }
    }
  }
  // The concept pass (22 October 2026): each effect on its own trigger, in
  // order, mirrored right to left, and over in time; with "always" the
  // device's reduced motion sees the same.
  for (const [device, bySource] of Object.entries(results.builds.new.concept ?? {}))
    for (const [source, c] of Object.entries(bySource)) {
      // With "device" either reduced-motion source stops all of it (checked
      // by the reduced-motion rules above).
      if ((source === "reduced" || source === "cookie") && !always) continue;
      const label = `concept motion ${source} ${device}`;
      if (c.errors.length) fail(label, `errors: ${c.errors.slice(0, 2).join("; ")}`);
      if (!c.hero || c.hero.delay + c.hero.duration > 3000 || c.hero.iterations !== 1)
        fail(label, `the hero arrow's nudge: ${JSON.stringify(c.hero)}`);
      if (!c.heroAt5s || c.heroAt5s.translate !== "none" || c.heroAt5s.running) fail(label, `the hero arrow is not at rest by 5 s: ${JSON.stringify(c.heroAt5s)}`);
      const sign = source === "rtl" ? -1 : 1;
      if (c.heroPeak !== `${3 * sign}px` || c.closingPeak !== `${3 * sign}px`)
        fail(label, `the arrows nudge the wrong way: hero ${c.heroPeak}, closing ${c.closingPeak}`);
      if (c.pillsAtLoad === null) console.log(`${label}: no commission pills on / (phase 1's home); their motion is not checked`);
      else {
        if (c.pillsAtLoad.cue !== "pending" || c.pillsAtLoad.translate !== `${-16 * sign}px`)
          fail(label, `the pills do not wait at the inline start: ${JSON.stringify(c.pillsAtLoad)}`);
        const pills = c.pills ?? [];
        if (!c.pillsIn || pills.length !== 4 || !pills.every((t, i) => t && t.delay === i * 80 && t.easing === "cubic-bezier(0.2, 0.8, 0.2, 1)"))
          fail(label, `the pills do not load 80ms apart on the enter curve: ${JSON.stringify(pills)}`);
      }
      if (!c.faqIn || (c.faq ?? []).some((d, i) => d !== Math.min(i * 40, 240))) fail(label, `the FAQ rows: ${JSON.stringify(c.faq)}`);
      if (!c.closingIn || !c.closing || c.closing.delay !== 280 || c.closing.iterations !== 1 || c.closing.delay + c.closing.duration > 700)
        fail(label, `the closing nudge: ${JSON.stringify(c.closing)}`);
      if (c.overflow > 0 || c.overflowAfter > 0) fail(label, `horizontal overflow ${c.overflow}/${c.overflowAfter}`);
      // The set ticks wait (hidden) for the table's own trigger at every
      // width, pop 80ms apart from 520ms, and end shown.
      if (c.setsWait?.cue !== "pending" || !c.setsWait.opacity.length || c.setsWait.opacity.some((o) => o !== "0"))
        fail(label, `the set ticks do not wait for their table: ${JSON.stringify(c.setsWait)}`);
      else if (!c.setsIn || JSON.stringify(c.ticks) !== JSON.stringify([520, 600]) || !(c.ticksAfter ?? []).every((t) => t === "1 none" || t === "1 1"))
        fail(label, `the set ticks: in ${c.setsIn}, delays ${JSON.stringify(c.ticks)}, after ${JSON.stringify(c.ticksAfter)}`);
    }
  // The pinned scenes follow both settings in either mode (Variant B).
  for (const [device, byPref] of Object.entries(results.builds.new.scenes))
    for (const [pref, r] of Object.entries(byPref)) {
      const label = `/?scenes=on ${pref} ${device}`;
      if (r.errors.length) fail(label, `page errors: ${r.errors.slice(0, 2).join("; ")}`);
      if (r.clsLoad > 0.001) fail(label, `CLS on load ${r.clsLoad.toFixed(4)}`);
      if (pref === "no-preference") {
        if (!r.atParse || !r.after) fail(label, `scenes not on before the first paint (${r.atParse}/${r.after})`);
        // The frame loop is event-driven and stops when idle (while / mounts a scene).
        const e = r.engine;
        if (!r.mounted) console.log(`${label}: no scene on / (the scroll scenes are parked); the frame loop is not measured`);
        else if (!e) fail(label, "the frame loop was not measured");
        else {
          if (!(e.scrollFrames > 0)) fail(label, `no animation frame while scrolling through the journey (${e.scrollFrames})`);
          if (e.idleFrames !== 0) fail(label, `${e.idleFrames} animation frame(s) in the second after 500 ms without input`);
          if (!(e.stillFrames > 0)) fail(label, "data-scenes-still did not wake the frame loop");
          if (!(e.offFrames > 0) || e.styledAfterOff)
            fail(label, `scenes-on removed without a scroll: ${e.offFrames} frame(s), ${e.styledAfterOff} element(s) still styled inline`);
        }
      } else {
        if (r.atParse || r.after) fail(label, `scenes on under reduced motion (${r.atParse}/${r.after})`);
        // The journey band left / in phase 1 (it stays on /how-it-works).
        if (r.journey !== null && (always ? r.journey !== "playing" : r.journey === "playing"))
          fail(label, `the journey ${r.journey === "playing" ? "auto-played" : `did not auto-play (state ${r.journey})`}`);
      }
    }

  // The pages phase 1 redesigned: absolute budgets, with or without a base.
  const redesigned = (key) => REDESIGNED.includes(key.slice(key.indexOf(" ") + 1));
  for (const [key, n] of Object.entries(now)) {
    if (!redesigned(key)) continue;
    if (n.lcp > BUDGETS.lcp) fail(key, `LCP ${Math.round(n.lcp)} ms (budget ${BUDGETS.lcp} ms)`);
    if (!n.lcpRole) fail(key, `the LCP element is ${n.lcpElement}, not the H1 or the lede`);
    if (n.clsLoad > BUDGETS.cls) fail(key, `CLS on load ${n.clsLoad.toFixed(4)} (budget ${BUDGETS.cls})`);
    if (n.clsScroll > BUDGETS.cls) fail(key, `CLS while scrolling ${n.clsScroll.toFixed(4)} (budget ${BUDGETS.cls})`);
    if (n.longTasksScroll > BUDGETS.longTasksScroll)
      fail(key, `${n.longTasksScroll} long task(s) while scrolling through the reveals (budget ${BUDGETS.longTasksScroll})`);
    if (n.tbtLoad > BUDGETS.tbtLoad) fail(key, `blocking time on load ${Math.round(n.tbtLoad)} ms (budget ${BUDGETS.tbtLoad} ms)`);
  }
  // Every other page against the base: LCP, CLS and long tasks.
  if (then) {
    const baseInteractions = baseBuild.interactions;
    for (const [key, n] of Object.entries(now)) {
      const b = then[key];
      if (!b || redesigned(key)) continue;
      const allowance = Math.max(50, b.lcp * 0.05);
      if (n.lcp > b.lcp + allowance)
        fail(key, `LCP ${Math.round(n.lcp)} ms against ${Math.round(b.lcp)} ms (allowance ${Math.round(allowance)} ms)`);
      if (n.lcpElement !== b.lcpElement) fail(key, `LCP element ${n.lcpElement}, base ${b.lcpElement}`);
      if (n.clsLoad > b.clsLoad + 0.001) fail(key, `CLS on load ${n.clsLoad.toFixed(4)}, base ${b.clsLoad.toFixed(4)}`);
      if (n.clsScroll > b.clsScroll + 0.001) fail(key, `CLS while scrolling ${n.clsScroll.toFixed(4)}, base ${b.clsScroll.toFixed(4)}`);
      if (n.longTasksScroll > b.longTasksScroll)
        fail(key, `${n.longTasksScroll} long task(s) while scrolling through the reveals, base ${b.longTasksScroll}`);
      // Blocking time on load is mostly hydration and varies by a few hundred
      // ms between identical loads here; the motion script's own time is
      // checked above. This guards against a gross regression only.
      if (n.tbtLoad > b.tbtLoad + Math.max(100, b.tbtLoad * 0.25))
        fail(key, `blocking time on load ${Math.round(n.tbtLoad)} ms, base ${Math.round(b.tbtLoad)} ms`);
    }
    // One sample each, so reported rather than judged: typing re-renders
    // the calculator in both builds; the settle itself is a few elements.
    for (const [device, i] of Object.entries(results.builds.new.interactions)) {
      const b = baseInteractions?.[device]?.motion;
      console.log(
        `interactions ${device}: long tasks while typing ${JSON.stringify(i.motion.calculatorLongTasks)} (base ${JSON.stringify(b?.calculatorLongTasks)}), opening a FAQ${device.startsWith("390") ? " and the menu" : ""} ${JSON.stringify(i.motion.interactLongTasks)} (base ${JSON.stringify(b?.interactLongTasks)}); ${i.motion.settles} settle animation(s)`,
      );
    }
  } else console.log("No base build or baseline: the comparison with base was not made.");

  // A table of the medians.
  const rows = Object.entries(now).map(([key, n]) => {
    const b = then?.[key];
    const f = (v, d = 0) => (v === null || v === undefined ? "-" : Number(v).toFixed(d));
    return `${key.padEnd(24)} LCP ${f(n.lcp).padStart(5)} (${redesigned(key) ? "budget " + BUDGETS.lcp : "base " + f(b?.lcp).padStart(5)})  CLS ${f(n.clsLoad, 4)}/${f(n.clsScroll, 4)} (base ${f(b?.clsLoad, 4)}/${f(b?.clsScroll, 4)})  TBT ${f(n.tbtLoad).padStart(4)} (base ${f(b?.tbtLoad).padStart(4)})  scroll long tasks ${n.longTasksScroll} (base ${b?.longTasksScroll ?? "-"})  motion setup ${f(n.motionSetupMax, 1)} ms, callback ${f(n.motionCallbackMax, 1)} ms`;
  });
  console.log(rows.join("\n"));

  // The reduced-motion cohort (both sources): medians on the new build
  // against main before the switch and against the base, with the budget
  // marks (LCP within max(50 ms, 5%) and the same element, blocking time
  // within max(100 ms, 25%), no more scroll long tasks). Reported, not
  // judged: the owner accepted the cost of motion for every visitor
  // (22 October 2026, "we can always switch it back").
  const cohort = {
    new: summarise(results.builds.new, "reducedPages"),
    main: results.builds.main ? summarise(results.builds.main, "reducedPages") : null,
    base: results.builds.base ? summarise(results.builds.base, "reducedPages") : null,
  };
  const over = (n, b) =>
    !b
      ? []
      : [
          ...(n.lcp > b.lcp + Math.max(50, b.lcp * 0.05) ? ["LCP"] : []),
          ...(n.lcpElement !== b.lcpElement ? ["LCP element"] : []),
          ...(n.tbtLoad > b.tbtLoad + Math.max(100, b.tbtLoad * 0.25) ? ["TBT"] : []),
          ...(n.longTasksScroll > b.longTasksScroll ? ["scroll long tasks"] : []),
          ...(n.clsLoad > b.clsLoad + 0.001 || n.clsScroll > b.clsScroll + 0.001 ? ["CLS"] : []),
        ];
  results.reducedCohort = Object.fromEntries(
    Object.entries(cohort.new).map(([key, n]) => [
      key,
      { new: n, main: cohort.main?.[key] ?? null, base: cohort.base?.[key] ?? null, overMain: over(n, cohort.main?.[key]), overBase: over(n, cohort.base?.[key]) },
    ]),
  );
  const f = (v, d = 0) => (v === null || v === undefined ? "-" : Number(v).toFixed(d));
  console.log("Reduced-motion cohort (medians; new / main / base; reported, not judged):");
  for (const [key, c] of Object.entries(results.reducedCohort))
    console.log(
      `${key.padEnd(31)} LCP ${f(c.new.lcp)}/${f(c.main?.lcp)}/${f(c.base?.lcp)}  TBT ${f(c.new.tbtLoad)}/${f(c.main?.tbtLoad)}/${f(c.base?.tbtLoad)}  scroll long tasks ${c.new.longTasksScroll}/${c.main?.longTasksScroll ?? "-"}/${c.base?.longTasksScroll ?? "-"}  CLS ${f(c.new.clsLoad, 4)}+${f(c.new.clsScroll, 4)}${c.overMain.length ? `  over main: ${c.overMain.join(", ")}` : ""}${c.overBase.length ? `  over base: ${c.overBase.join(", ")}` : ""}`,
    );
} catch (e) {
  fail("marketing motion check", String(e?.stack ?? e));
} finally {
  await browser.close();
  for (const c of children)
    try {
      process.kill(-c.pid, "SIGTERM");
    } catch {}
  stub?.close();
  log.end();
}
results.failures = failures;
const out = env.MOTION_OUT ?? root + "test-results/marketing-motion-sitewide.json";
await writeFile(out, JSON.stringify(results, null, 2));
console.log(`Results: ${out}`);
if (failures.length) {
  console.error(`${failures.length} failure(s):\n` + failures.map((f) => "  " + f).join("\n"));
  process.exit(1);
}
console.log("Marketing motion check passed.");
