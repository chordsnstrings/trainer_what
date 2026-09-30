// Sitewide marketing motion check (local Chromium only; never a cloud
// browser). It measures the marketing pages that carry the most motion, at
// 390x844 (a phone: touch, device pixel ratio 3) and 1366x900, with the CPU
// throttled 4x, and compares them with a base build (the release before the
// motion pass, c856d9d):
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
// - reduced motion: no reveal, no running animation or transition, no
//   settle, and the page is static.
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
// or credential. MOTION_NEW_URL / MOTION_BASE_URL use servers that are
// already running instead (with their own API). Without a base it compares with
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
const PAGES = (env.MOTION_PAGES ?? "/,/how-it-works,/pricing,/features,/earnings-calculator").split(",");
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

async function openPage(browser, device, url, options = {}) {
  const context = await browser.newContext({
    viewport: device.viewport,
    deviceScaleFactor: device.deviceScaleFactor,
    isMobile: device.isMobile,
    hasTouch: device.hasTouch,
    reducedMotion: options.reducedMotion ?? "no-preference",
    javaScriptEnabled: options.javaScript ?? true,
  });
  await context.addInitScript(instrument);
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
async function coldLoad(browser, device, base, path) {
  const { context, page, errors } = await openPage(browser, device, base + path);
  await page.waitForTimeout(2500);
  // LCP is read before the scroll-through: a visitor's own scroll ends LCP
  // reporting, but a scripted one does not, and sections revealed while
  // scrolling would count as late paints.
  const paint = await page.evaluate(() => ({ lcp: window.__mk.lcp, lcpElement: window.__mk.lcpElement }));
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

/** Reduced motion: no reveal, nothing running, all visible. */
async function reduced(browser, device, base) {
  const out = {};
  for (const path of PAGES) {
    const { context, page } = await openPage(browser, device, base + path, { reducedMotion: "reduce" });
    await page.waitForTimeout(1500);
    const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length);
    await scrollThrough(page);
    const state = await page.evaluate(revealState);
    const text = await page.evaluate(hiddenText);
    const runningAfter = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length);
    out[path] = { running, runningAfter, marked: state.marked, motionClass: state.motionClass, hidden: text.hidden };
    await context.close();
  }
  return out;
}

/**
 * Measures the builds. Cold loads alternate between the builds run by run,
 * so the machine's load affects both alike.
 */
async function measure(browser, builds) {
  const results = Object.fromEntries(
    Object.keys(builds).map((label) => [label, { url: builds[label], pages: {}, interactions: {}, noScript: {}, reduced: {} }]),
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
    }
    for (const [label, base] of Object.entries(builds)) {
      results[label].interactions[device.name] = {
        motion: await interactions(browser, device, base, "no-preference"),
        reduced: await interactions(browser, device, base, "reduce"),
      };
      results[label].noScript[device.name] = await noScript(browser, device, base);
      results[label].reduced[device.name] = await reduced(browser, device, base);
    }
  }
  return results;
}

/** A per-page summary: medians, the usual LCP element, worst CLS and scroll long tasks. */
function summarise(build) {
  const out = {};
  for (const [key, runs] of Object.entries(build.pages))
    out[key] = {
      lcp: median(runs.map((r) => r.lcp)),
      lcpElement: mode(runs.map((r) => r.lcpElement)),
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
const results = { at: new Date().toISOString(), runs: RUNS, throttle: THROTTLE, platform: PLATFORM, builds: {} };
try {
  const newUrl = env.MOTION_NEW_URL ?? (await serve(root.replace(/\/$/, ""), env.MOTION_WEB_PORT ?? "3931"));
  const baseUrl =
    env.MOTION_BASE_URL ?? (env.MOTION_BASE_DIR ? await serve(env.MOTION_BASE_DIR.replace(/\/$/, ""), env.MOTION_BASE_PORT ?? "3932") : null);
  results.builds = await measure(browser, baseUrl ? { new: newUrl, base: baseUrl } : { new: newUrl });
  const recorded = env.MOTION_BASELINE ? JSON.parse(await readFile(env.MOTION_BASELINE, "utf8")) : null;
  const baseBuild = results.builds.base ?? recorded?.builds?.base ?? null;
  const now = summarise(results.builds.new);
  const then = baseBuild ? summarise(baseBuild) : null;
  results.summary = { new: now, base: then };

  // The motion pass's own rules, on the new build.
  for (const [key, runs] of Object.entries(results.builds.new.pages)) {
    for (const r of runs) {
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
    }
  }
  for (const [device, byPath] of Object.entries(results.builds.new.noScript))
    for (const [path, r] of Object.entries(byPath)) {
      if (r.hidden.length) fail(`no JavaScript ${device} ${path}`, `hidden: ${r.hidden.slice(0, 3).join("; ")}`);
      if (r.marked || r.motionClass) fail(`no JavaScript ${device} ${path}`, "reveal marks without a script");
      if (r.scanned < 20) fail(`no JavaScript ${device} ${path}`, `only ${r.scanned} text elements scanned`);
    }
  for (const [device, byPath] of Object.entries(results.builds.new.reduced))
    for (const [path, r] of Object.entries(byPath)) {
      if (r.running || r.runningAfter) fail(`reduced motion ${device} ${path}`, `${r.running}/${r.runningAfter} running animation(s)`);
      if (r.marked || r.motionClass) fail(`reduced motion ${device} ${path}`, "the reveal ran");
      if (r.hidden.length) fail(`reduced motion ${device} ${path}`, `hidden: ${r.hidden.slice(0, 3).join("; ")}`);
    }
  for (const [device, { motion, reduced: still }] of Object.entries(results.builds.new.interactions)) {
    if (!(motion.settles > 0)) fail(`settle ${device}`, "the calculator result did not settle");
    if (still.settles) fail(`settle ${device}`, `${still.settles} settle animation(s) under reduced motion`);
    if (still.calculatorRunning || still.faqRunning || still.menuRunning || still.hoverRunning)
      fail(`reduced motion ${device}`, `running on interaction: ${JSON.stringify(still)}`);
    if (!motion.faq.open || !motion.faq.grew || motion.faq.answerOpacity !== "1")
      fail(`faq ${device}`, `the answer did not open fully: ${JSON.stringify(motion.faq)}`);
    if (!still.faq.open || still.faq.answerOpacity !== "1") fail(`faq reduced ${device}`, JSON.stringify(still.faq));
    if (device.startsWith("390") && !motion.menuOpen) fail(`menu ${device}`, "the phone menu did not open");
  }

  // Against the base: LCP, CLS and long tasks.
  if (then) {
    const baseInteractions = baseBuild.interactions;
    for (const [key, n] of Object.entries(now)) {
      const b = then[key];
      if (!b) continue;
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
    return `${key.padEnd(24)} LCP ${f(n.lcp).padStart(5)} (base ${f(b?.lcp).padStart(5)})  CLS ${f(n.clsLoad, 4)}/${f(n.clsScroll, 4)} (base ${f(b?.clsLoad, 4)}/${f(b?.clsScroll, 4)})  TBT ${f(n.tbtLoad).padStart(4)} (base ${f(b?.tbtLoad).padStart(4)})  scroll long tasks ${n.longTasksScroll} (base ${b?.longTasksScroll ?? "-"})  motion setup ${f(n.motionSetupMax, 1)} ms, callback ${f(n.motionCallbackMax, 1)} ms`;
  });
  console.log(rows.join("\n"));
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
