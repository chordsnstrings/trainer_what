// The Brain showcases in local Chromium (never a cloud browser):
// docs/marketing-revamp-2026-10-26/phase1/PLAN.md §4.3. Run it with
// `npm run test:marketing-showcase` after `npm run build`:
// scripts/run-marketing-motion-check.mjs starts the production build against
// its platform stub (MOTION_WEB_PORT / MOTION_API_PORT, defaults 3967/4967)
// and imports this module. The stub starts "closed" (sign-ups closed, every
// provider off); the closed checks and the metrics run first, then the stub
// turns to "assistant" (sign-ups open, payments on, Kamran's button on /)
// for the open pass and the Kamran check. The web server keeps a successful
// platform answer for a minute, so it never goes back.
//
// Pages: /, /trainer-brain, /demo and /pricing (SHOWCASE_PAGES narrows them).
// Every load carries ?sc=on (automated browsers get the engine only with it,
// brain/head.ts), except the JavaScript-off pass (1) and the robot pass (15).
// requestAnimationFrame is wrapped before any page script (frames, callbacks
// per frame, work per frame); the CPU is throttled only in the metrics pass.
//
// Judged (deterministic):
//  1. JavaScript off: on / at 390x844 Noura's words, "STOP · No AI called"
//     and the Paused lane end above y 770; the lanes fit 375x667; no image,
//     video or background image in a showcase; the lazy sheets (the CSS the
//     engine loads after the load event, receipts included) move no box of
//     the still frame at 390 and 1440 (on a second try as well: a box that
//     moves only once moved for another reason).
//  2. The largest paint is the H1 or the lede, at 390 and 1440.
//  3. Layout shift of 0.001 or less (report-only unless SHOWCASE_JUDGE_CLS
//     is set): load plus 10 s of the field and the board, 5 s after a
//     playground click (input excluded), scrolling the anatomy, and the
//     /pricing sliders (input excluded).
//  4. No horizontal overflow at 320, 360, 390 and 1440, left to right and in
//     ?lang=ar; no duplicate id, page error or console error; each page has
//     its showcases and each reaches data-sc="on" within 15 s of coming near.
//  5. With the engine's requests aborted after the load event, the hero ends
//     at data-sc="off" within 7 s of html[data-sc-ready] with its final frame
//     visible; with them stalled (never answered), the island's 6 s fallback
//     ends it, timed from html[data-sc-ready] (6 to 7 s); the anatomy ends
//     "off" within 7 s of coming near and goes flat only while entirely below
//     the viewport, with no layout shift.
//  6. While visible and running, data-sc-run is on the root and frames run;
//     it is gone within 1 s off screen, in a hidden document, after Pause
//     (which then reads "Play…", with no aria-pressed: its name changes),
//     under emulated reduced motion, with the member's reduce-motion cookie
//     and during a Kamran call (html[data-mk-call]); the rest of the
//     marketing motion still follows its switch (data-mk-motion); nothing in
//     a showcase animates forever. Pages start at ?tier=full; a pass the
//     watchdog ends at "minimal" (no anatomy frames by design) runs again.
//  7. ?tier=full&slow=30 steps data-sc-tier down within 5 s.
//  8. Kamran's button (the assistant stub on) meets no showcase control at
//     390x844 and 360x800, scroll 0.
//  9. A receipt takes focus, Esc closes it and returns focus; open, Pause,
//     close leaves "Play" and no frames; with the consent bar open
//     the phone receipt and settings sheet are topmost at their centres;
//     leaving with a receipt open leaves no overlay layer or scroll lock; a
//     receipt open in the field's zoom at 844x390, turned to 390x844, is the
//     phone's sheet, and closing it leaves no zoom and nothing inert.
// 10. The /demo playground under the page's flags, in the closed pass (the AI
//     model off) and again in the open pass (on): knee (code only, so it
//     runs in both), deload (waits for you; with the model off its chip and
//     card say not on yet and nothing runs), low recovery, free text (a close
//     sample, and none for "hello there"), a setting change (the before/now
//     line; with the model off, the creatine moment's supplements switch
//     hands it to the Draft writer, not on yet, and back) and the keyboard.
// 11. /trainer-brain: the pin (html.sc-pin, more than 3 viewports, steps
//     advance), the pinned frame flush under the header at 1440, 1000 and
//     390, flat plates under reduced motion and at 1440x650, and "See it
//     work" runs its moment (a link to a moment the playground is not
//     already showing).
// 12. Three rounds of / → /pricing → / → /trainer-brain → /demo → / by link
//     clicks: no errors, every arrival reaches "on", and no more animation
//     frame callbacks per frame in round 3 than in round 1.
// 13. Sign-ups closed: no href="/signup" on the four pages once mounted and
//     "Join early access — free" shows; open: "Teach your AI — free" shows
//     and every showcase call to action goes to /signup.
// 14. The /pricing calculators equal estimateEarnings (imported here).
// 15. Without ?sc=on an automated browser requests no engine chunk, gets no
//     sc-motion or sc-pin, and every root stays "pre" with its final frame
//     visible: the call, browser and completion checks see the still frames.
// 16. The keyboard and the board: at 1280x900, Tab from the top of / and of
//     /trainer-brain (no scrolling first) reaches the board's controls and the
//     playground's chips (the first Tab mounts every showcase); the board's
//     height holds through a change of each of its controls.
//
// Reported (judged only with SHOWCASE_JUDGE_METRICS=1, meant for real
// hardware; this container and CI have no GPU): frame gaps and engine work
// per frame (4x CPU, ?tier=full) after a scroll down 200 px and back (the
// field also partly under the header; with software compositing, as here,
// frame gaps are only reported: a canvas commit is a CPU copy, PERF-5), the
// STOP stamp after load, blocking time from the response's end (not the
// first paint, which the framework's own script task falls on either side
// of) to 5 s after the load event: the engine's share (long tasks in frames
// that ran its chunks or the island's) against a fixed budget, the page's
// against the build before phase 1 measured in the same session
// (SHOWCASE_BASELINE_URL, interleaved run by run; the number stored in
// scripts/marketing-showcase-baseline.json is shown for reference only:
// another machine's, PERF-4), long tasks from mounting (from the island's
// import, its performance mark, to "on" + 1 s, in frames that ran the
// engine's or the island's script, or only rendered; the consent bar opens
// on a first scroll before, and its cost is reported on its own, PERF-3),
// chip and slider latency, engine chunk sizes, shared JavaScript and global
// CSS against the baseline, and the showcase HTML on /trainer-brain.
// SHOWCASE_RUNS loads per page (default 1; 5 when judging), median.
// SHOWCASE_BASELINE_OUT=<file> writes the metrics as a new baseline (measure
// it on the build before phase 1, 4f35e5c, with SHOWCASE_CHECKS=metrics
// SHOWCASE_RUNS=5). SHOWCASE_CHECKS=1,4,metrics runs a subset.
// Results: test-results/marketing-showcase.json (SHOWCASE_OUT).
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { BRAND_COPY } from "../packages/contracts/src/brand.ts";
import {
  DEFAULT_EARNINGS_INPUTS,
  aedWhole,
  estimateEarnings,
} from "../packages/domain/src/marketing-calculators.ts";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const env = process.env;
const base = env.TEST_APP_URL ?? "http://127.0.0.1:3967";
const stub = globalThis.__motionPlatform ?? null;
const executablePath =
  env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
  (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);

/** The showcases each page carries (PLAN.md §2, WP4 and WP5). */
const KINDS = {
  "/": ["field", "board"],
  "/trainer-brain": ["anatomy", "play"],
  "/demo": ["play"],
  "/pricing": [],
};
const PAGES = (env.SHOWCASE_PAGES ?? Object.keys(KINDS).join(",")).split(",");
const CHECKS = env.SHOWCASE_CHECKS ? new Set(env.SHOWCASE_CHECKS.split(",")) : null;
const JUDGE_CLS = !!env.SHOWCASE_JUDGE_CLS;
const JUDGE_METRICS = !!env.SHOWCASE_JUDGE_METRICS;
const RUNS = Number(env.SHOWCASE_RUNS ?? (JUDGE_METRICS ? 5 : 1));
const BASELINE = env.SHOWCASE_BASELINE ?? root + "scripts/marketing-showcase-baseline.json";
/** The build before phase 1, served alongside (its own stub), for page blocking time measured in the same session. */
const BASELINE_URL = env.SHOWCASE_BASELINE_URL ?? null;
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const ROOTS = '[data-showcase]:not([data-showcase="layer"])';
const TEACH_AI = BRAND_COPY.primaryAction + " — free";
// teachCta(false) in components/marketing/frame.tsx.
const EARLY = "Join early access — free";
const LANES = { paused: "Training paused", waits: "Waits for you" };
const THROTTLE = 4;

const results = { base, pages: PAGES, checks: {}, reported: [], failures: [] };
const failures = results.failures;
function fail(label, message) {
  failures.push(`${label}: ${message}`);
  console.error(`FAIL ${label}: ${message}`);
}
function report(label, message) {
  results.reported.push(`${label}: ${message}`);
  console.log(`  ${label}: ${message}`);
}
const want = (n) => !CHECKS || CHECKS.has(String(n));
async function step(n, name, fn) {
  if (!want(n)) return;
  const started = Date.now();
  try {
    await fn();
  } catch (e) {
    fail(`${n}. ${name}`, String(e?.message ?? e).split("\n")[0]);
  }
  results.checks[`${n}. ${name}`] = Date.now() - started;
  console.log(`${n}. ${name}: ${((Date.now() - started) / 1000).toFixed(1)} s`);
}
const pages = (filter = () => true) => PAGES.filter(filter);
const withShowcases = () => pages((p) => KINDS[p]?.length);
const p95 = (values) => {
  const s = [...values].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * 0.95))] : null;
};
const median = (values) => {
  const s = values.filter((v) => v !== null && v !== undefined).sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : null;
};
const round = (v, d = 1) => (v === null || v === undefined ? null : Number(v.toFixed(d)));
const kb = (bytes) => round(bytes / 1024, 1);

/**
 * Installed before any page script. Every animation-frame callback with its
 * frame and its time; largest paint, layout shifts, long tasks and
 * interactions; and the showcase hooks as they change: html[data-sc-ready],
 * each root's data-sc, data-sc-tier and data-sc-flat (with whether the root
 * was then entirely below the viewport).
 */
function instrument() {
  const sc = (window.__sc = { frames: [], shifts: [], long: [], loaf: [], events: [], log: [], near: {}, lcp: null });
  try {
    performance.setResourceTimingBufferSize(2000);
  } catch {}
  const describe = (el) =>
    el?.nodeType === 1
      ? el.tagName.toLowerCase() +
        (el.id ? "#" + el.id : "") +
        (typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).join(".") : "")
      : (el?.nodeName ?? null);
  const request = window.requestAnimationFrame;
  let at = -1,
    count = 0,
    work = 0;
  window.requestAnimationFrame = function (callback) {
    return request.call(window, (now) => {
      if (now !== at) {
        if (at >= 0) sc.frames.push([at, count, work]);
        at = now;
        count = 0;
        work = 0;
      }
      const start = performance.now();
      try {
        return callback(now);
      } finally {
        count++;
        work += performance.now() - start;
      }
    });
  };
  const observe = (type, fn, extra) => {
    try {
      new PerformanceObserver((list) => list.getEntries().forEach(fn)).observe({ type, buffered: true, ...extra });
    } catch {}
  };
  observe("largest-contentful-paint", (e) => (sc.lcp = { t: e.startTime, node: e.element, size: e.size }));
  observe("layout-shift", (e) =>
    sc.shifts.push({ t: e.startTime, v: e.value, input: e.hadRecentInput, nodes: e.sources.map((s) => describe(s.node)) }),
  );
  observe("longtask", (e) => sc.long.push([e.startTime, e.duration]));
  // Long animation frames name the scripts that ran in them.
  observe("long-animation-frame", (e) => sc.loaf.push([e.startTime, e.duration, e.scripts.map((x) => x.sourceURL)]));
  observe("event", (e) => e.interactionId && sc.events.push({ name: e.name, t: e.startTime, d: e.duration, id: e.interactionId }), {
    durationThreshold: 16,
  });
  new MutationObserver((records) => {
    const t = performance.now();
    for (const r of records) {
      const el = r.target,
        value = el.getAttribute(r.attributeName);
      const entry = { t, name: r.attributeName, value, host: el === document.documentElement ? "html" : (el.parentElement?.id ?? "") };
      if (r.attributeName === "data-sc-flat" && value !== null) entry.below = el.getBoundingClientRect().top >= innerHeight;
      sc.log.push(entry);
    }
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-sc", "data-sc-ready", "data-sc-tier", "data-sc-flat"] });
  // When each showcase host first comes within the island's 200 px margin.
  document.addEventListener("DOMContentLoaded", () => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting && !(e.target.id in sc.near)) sc.near[e.target.id] = e.time;
      },
      { rootMargin: "200px" },
    );
    document.querySelectorAll(".sc-host").forEach((host) => io.observe(host));
  });
}

const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const contexts = new Set();

/**
 * A fresh context and page: phones (760 px wide or less) are touch screens
 * at device pixel ratio 3. The analytics answer and the welcome experiment
 * are answered here (the stub API has neither, and a 404 is a console
 * error). `reduced`: the device setting; `cookie`: the member's own choice.
 */
async function open({ viewport = DESKTOP, js = true, reduced = false, cookie = false, throttle = 0 } = {}) {
  const phone = viewport.width <= 760;
  const context = await browser.newContext({
    viewport,
    javaScriptEnabled: js,
    reducedMotion: reduced ? "reduce" : "no-preference",
    ...(phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 3 } : {}),
  });
  contexts.add(context);
  context.setDefaultTimeout(20_000);
  if (cookie) await context.addCookies([{ name: "trainer_member_motion", value: "reduce", url: base }]);
  await context.route(/\/api\/v1\/public\/(acquisition\/consent|experiments\/)/, (route) =>
    route.fulfill({ json: route.request().url().includes("/consent") ? { granted: false } : {} }),
  );
  await context.addInitScript(instrument);
  const page = await context.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push("page error: " + e.message));
  page.on("console", (m) => m.type() === "error" && page.errors.push("console: " + m.text()));
  if (throttle) await (await context.newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate: throttle });
  return page;
}
async function close(page) {
  contexts.delete(page.context());
  await page.context().close();
}
const href = (path, query = "sc=on") => base + path + (query ? (path.includes("?") ? "&" : "?") + query : "");
const go = (page, path, query) => page.goto(href(path, query), { waitUntil: "load" });

/** The host ids of the page's showcases, with their kinds, in page order. */
const hosts = (page) =>
  page.$$eval(ROOTS, (list) => list.map((r) => ({ id: r.parentElement.id, kind: r.getAttribute("data-showcase") })));
async function hostOf(page, kind) {
  const found = (await hosts(page)).find((h) => h.kind === kind);
  if (!found) throw new Error(`no ${kind} showcase on ${new URL(page.url()).pathname}`);
  return found.id;
}
const scState = (page, id) =>
  page.evaluate((id) => {
    const r = document.getElementById(id)?.firstElementChild;
    return r ? { sc: r.getAttribute("data-sc"), run: r.hasAttribute("data-sc-run"), tier: r.getAttribute("data-sc-tier"), flat: r.hasAttribute("data-sc-flat") } : null;
  }, id);
/**
 * Waits until the host's root has the attribute (`value`: with that value;
 * `not`: the opposite); false on timeout.
 */
const until = (page, id, test, timeout) =>
  page
    .waitForFunction(
      ([id, { attr, value, not }]) => {
        const r = document.getElementById(id)?.firstElementChild;
        if (!r) return false;
        const v = r.getAttribute(attr);
        return (value === undefined ? v !== null : v === value) !== !!not;
      },
      [id, test],
      { timeout, polling: 50 },
    )
    .then(
      () => true,
      () => false,
    );
const isOn = (page, id, timeout = 15_000) => until(page, id, { attr: "data-sc", value: "on" }, timeout);
const running = (page, id, on, timeout) => until(page, id, { attr: "data-sc-run", not: !on }, timeout);
const scrollToHost = (page, id, block = "center") =>
  page.evaluate(([id, block]) => document.getElementById(id).scrollIntoView({ block, behavior: "instant" }), [id, block]);
const scrollTop = (page, y = 0) => page.evaluate((y) => scrollTo({ top: y, behavior: "instant" }), y);

/**
 * Brings each showcase near in page order and waits for data-sc="on";
 * returns how long each took from coming into view (null: not within 15 s).
 */
async function mountAll(page) {
  const took = {};
  for (const { id } of await hosts(page)) {
    const t = Date.now();
    await scrollToHost(page, id);
    took[id] = (await isOn(page, id)) ? Date.now() - t : null;
  }
  await scrollTop(page);
  return took;
}
/** Frames recorded from now for `ms`: count, gaps under 250 ms, work and callbacks per frame. */
/** The frames of the next `ms`, or until `until()` settles first (a playground run's end). */
async function frames(page, ms, until) {
  const from = await page.evaluate(() => performance.now());
  await (until ? Promise.race([until().catch(() => {}), page.waitForTimeout(ms)]) : page.waitForTimeout(ms));
  return page.evaluate((from) => {
    const to = performance.now(), f = window.__sc.frames.filter(([t]) => t >= from && t <= to);
    const gaps = [];
    for (let i = 1; i < f.length; i++) if (f[i][0] - f[i - 1][0] < 250) gaps.push(f[i][0] - f[i - 1][0]);
    return { count: f.length, gaps, work: f.map((x) => x[2]), callbacks: f.map((x) => x[1]) };
  }, from);
}
/** Layout shift since `from` (page time), input excluded; with its sources. */
const shiftsSince = (page, from = 0) =>
  page.evaluate((from) => {
    const list = window.__sc.shifts.filter((s) => s.t >= from && !s.input);
    return { total: list.reduce((n, s) => n + s.v, 0), sources: [...new Set(list.flatMap((s) => s.nodes))].slice(0, 4) };
  }, from);
const now = (page) => page.evaluate(() => performance.now());
/** Horizontal overflow, duplicate ids and the visible CTA labels. */
const layout = (page) =>
  page.evaluate(() => {
    const d = document.documentElement;
    const ids = [...document.querySelectorAll("[id]")].map((e) => e.id);
    const visible = (e) => e.checkVisibility({ opacityProperty: true, visibilityProperty: true }) && e.getBoundingClientRect().width > 0;
    const overflow = Math.max(d.scrollWidth - d.clientWidth, document.body.scrollWidth - document.body.clientWidth);
    // What sticks out of the viewport (outside any clipping box), widest first, to name in a failure.
    const out = [];
    if (overflow > 0)
      for (const e of document.querySelectorAll("body *")) {
        const r = e.getBoundingClientRect(), by = Math.max(r.right - d.clientWidth, -r.left);
        if (!r.width || by <= 0.5 || !visible(e)) continue;
        let p = e.parentElement;
        while (p && p !== document.body && !/(auto|scroll|hidden|clip)/.test(getComputedStyle(p).overflowX)) p = p.parentElement;
        if (p === document.body || !p) out.push({ by, what: `${e.tagName.toLowerCase()}${e.id ? "#" + e.id : ""}${typeof e.className == "string" && e.className.trim() ? "." + e.className.trim().split(/\s+/).slice(0, 2).join(".") : ""} [${r.left.toFixed(1)}, ${r.right.toFixed(1)}]` });
      }
    return {
      overflow,
      offenders: out.sort((a, b) => b.by - a.by).slice(0, 3).map((o) => o.what),
      duplicates: [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))],
      labels: [...new Set([...document.querySelectorAll("a, button")].filter(visible).map((e) => e.textContent.replace(/\s+/g, " ").trim()))],
      signup: d.outerHTML.includes('href="/signup"'),
      ctas: [...document.querySelectorAll("a[data-sc-cta]")].map((a) => a.getAttribute("href")),
    };
  });
/** JS and CSS fetched after the load event (resource timing), with the time each started. */
const lateResources = (page) =>
  page.evaluate(() => {
    const load = performance.getEntriesByType("navigation")[0]?.loadEventStart ?? 0;
    return performance
      .getEntriesByType("resource")
      .filter((r) => r.startTime >= load && /\.(js|css)(\?|$)/.test(new URL(r.name).pathname))
      .map((r) => ({ url: r.name, at: r.startTime }));
  });
const isCss = (url) => new URL(url).pathname.endsWith(".css");
const gzipped = async (url) => gzipSync(Buffer.from(await (await fetch(url)).arrayBuffer())).length;
/** The island's chunks: the first HTML's scripts that call its mark (brain/mount.tsx), learnt once. */
const ISLAND = new Map();
async function islandChunks(page) {
  const urls = await page.evaluate(() => performance.getEntriesByType("resource").map((r) => r.name).filter((u) => /\/_next\/static\/.*\.js(\?|$)/.test(u)));
  for (const url of urls) if (!ISLAND.has(url)) ISLAND.set(url, (await (await fetch(url)).text()).includes("sc-mount:"));
  return urls.filter((url) => ISLAND.get(url));
}
/** The engine's chunks per page (the JS and CSS it fetches after the load event), learnt once. */
const ENGINE = new Map();
async function engineChunks(path) {
  if (ENGINE.has(path)) return ENGINE.get(path);
  const page = await open();
  await go(page, path);
  await mountAll(page);
  await page.waitForTimeout(500);
  const urls = new Set((await lateResources(page)).map((r) => r.url));
  await close(page);
  ENGINE.set(path, urls);
  return urls;
}
/** Opens a receipt from the field: a tile in the Sent lane (desktop) or the Paused bin's list (phones). */
async function openReceipt(page, id) {
  if (await page.locator(`#${id} .mc-bin[data-bin="paused"]`).isVisible()) {
    await page.click(`#${id} .mc-bin[data-bin="paused"]`);
    await page.click(`#${id} .mc-binlist .mc-tile`);
  } else await page.click(`#${id} .mc-lane[data-lane="sent"] .mc-tile`);
  await page.waitForSelector('[data-showcase="receipt"]', { timeout: 5000 });
}
const pauseState = (page, id) =>
  page.evaluate((id) => {
    const b = [...document.getElementById(id).querySelectorAll("[data-sc-pause]")].find((e) => e.checkVisibility());
    return b ? { pressed: b.getAttribute("aria-pressed"), label: (b.querySelector("[data-label]") ?? b).textContent.trim() } : null;
  }, id);
const clickPause = (page, id) =>
  page.evaluate((id) => [...document.getElementById(id).querySelectorAll("[data-sc-pause]")].find((e) => e.checkVisibility())?.click(), id);
/** A forced hidden (or visible again) document, as a background tab reports it. */
const setHidden = (page, hidden) =>
  page.evaluate((hidden) => {
    if (hidden) {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    } else {
      delete document.hidden;
      delete document.visibilityState;
    }
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
const motionSwitch = (page) => page.evaluate(() => document.querySelector(".mk")?.getAttribute("data-mk-motion") ?? "device");

// ---------------------------------------------------------------------------
// The closed platform (503: the pages' fallback, sign-ups closed).
stub?.set("closed");
if (!stub) console.log("No platform stub: one pass against the running server's platform; 8 and the open pass are skipped.");

await step(4, "pages (with 2 and 13)", () => pagePass("closed", [320, 360, 390, 1440], ["ltr", "rtl"]));

await step(1, "JavaScript off", async () => {
  const lazy = new Set();
  for (const path of withShowcases()) for (const url of await engineChunks(path)) if (isCss(url)) lazy.add(url);
  // The receipt's own sheet comes with its chunk, on demand.
  if (PAGES.includes("/")) {
    const page = await open();
    await go(page, "/");
    const id = await hostOf(page, "field");
    await isOn(page, id);
    const before = new Set((await lateResources(page)).map((r) => r.url));
    await openReceipt(page, id);
    await page.waitForTimeout(500);
    for (const r of await lateResources(page)) if (!before.has(r.url) && isCss(r.url)) lazy.add(r.url);
    await close(page);
  }
  const sheets = await Promise.all([...lazy].map(async (url) => (await fetch(url)).text()));
  report("1. lazy sheets", `${sheets.length}: ${[...lazy].map((u) => u.split("/").pop()).join(", ")}`);
  for (const viewport of [PHONE, { width: 375, height: 667 }, DESKTOP])
    for (const path of PAGES) {
      if (viewport.width === 375 && path !== "/") continue;
      const label = `1. JavaScript off ${viewport.width}x${viewport.height} ${path}`;
      const page = await open({ viewport, js: false });
      await go(page, path, "");
      const m = await page.evaluate(() => {
        const field = document.querySelector('[data-showcase="field"]');
        const seen = (el) => {
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) && r.height > 0 ? Math.round(r.bottom) : null;
        };
        return {
          media: [...document.querySelectorAll("[data-showcase] *")]
            .filter((e) => /^(img|video|picture)$/i.test(e.tagName) || /url\(/.test(getComputedStyle(e).backgroundImage))
            .map((e) => e.tagName.toLowerCase() + "." + String(e.className).split(" ")[0]),
          words: field ? seen(field.querySelector(".mc-hl")?.closest(".mc-msg")) : undefined,
          stamp: field ? seen(field.querySelector(".mc-stamp")) : undefined,
          paused: field ? seen(field.querySelector('.mc-lane[data-lane="paused"]')) : undefined,
          lanes: field ? [...field.querySelectorAll(".mc-lane")].map(seen) : [],
          roots: [...document.querySelectorAll("[data-showcase]")].map((r) => r.getAttribute("data-sc")),
        };
      });
      if (m.media.length) fail(label, `images in a showcase: ${m.media.slice(0, 3).join(", ")}`);
      if (m.roots.some((s) => s !== "pre")) fail(label, `roots ${m.roots.join(",")} without JavaScript (expected pre)`);
      if (path === "/" && viewport === PHONE)
        for (const [what, bottom] of [["Noura's words", m.words], ['"STOP · No AI called"', m.stamp], ["the Paused lane", m.paused]])
          if (bottom === null || bottom === undefined || bottom > 770) fail(label, `${what} ${bottom === null || bottom === undefined ? "not shown" : `ends at y ${bottom}`} (above 770 expected)`);
      if (path === "/" && viewport.width === 375 && (!m.lanes.length || m.lanes.some((b) => b === null || b > 667)))
        fail(label, `the lanes end at ${JSON.stringify(m.lanes)} (within 667 expected)`);
      if (viewport.width !== 375 && KINDS[path]?.length && sheets.length) {
        const boxes = () =>
          page.evaluate(() =>
            [...document.querySelectorAll("[data-showcase] *")].map((e) => {
              const r = e.getBoundingClientRect();
              return `${e.tagName.toLowerCase()}.${String(e.className).split(" ")[0]} ${[r.x, r.y, r.width, r.height].map((v) => Math.round(v * 10) / 10).join(",")}`;
            }),
          );
        // The still frame once the web fonts have swapped in and the layout has settled.
        const settled = async () => {
          await page.evaluate(() => document.fonts.ready);
          let last = await boxes();
          for (let i = 0; i < 10; i++) {
            await page.waitForTimeout(250);
            const again = await boxes();
            if (again.join("|") === last.join("|")) break;
            last = again;
          }
          return last;
        };
        const withSheets = (on) =>
          page.evaluate(
            ([sheets, on]) => {
              for (const s of document.querySelectorAll("style[data-lazy]")) s.remove();
              if (on)
                for (const css of sheets) {
                  const s = document.head.appendChild(document.createElement("style"));
                  s.dataset.lazy = "";
                  s.textContent = css;
                }
            },
            [sheets, on],
          );
        // Twice: a box that moves only once moved for another reason (a late
        // font or a busy machine), not because of the sheets.
        let moved = [],
          count = 0;
        for (let i = 0; i < 2; i++) {
          const before = await settled();
          await withSheets(true);
          const after = await settled();
          await withSheets(false);
          count = before.length;
          moved = before.length === after.length ? before.flatMap((b, j) => (b === after[j] ? [] : [`${b} → ${after[j].split(" ").pop()}`])) : [`${before.length} boxes → ${after.length}`];
          if (!moved.length) break;
        }
        if (moved.length) fail(label, `the lazy sheets moved ${moved.length} of ${count} boxes: ${moved.slice(0, 3).join("; ")}`);
      }
      await close(page);
    }
});

/** The page pass: overflow, ids, errors, mounting, the call to action, and (LTR at 390 and 1440) the largest paint. */
async function pagePass(state, widths, directions) {
  for (const width of widths)
    for (const dir of directions)
      for (const path of PAGES) {
        const viewport = width === 1440 ? DESKTOP : { width, height: { 320: 568, 360: 800 }[width] ?? 844 };
        const label = `${state} ${width} ${dir} ${path}`;
        const page = await open({ viewport });
        await go(page, path, dir === "rtl" ? "sc=on&lang=ar" : "sc=on");
        const found = (await hosts(page)).map((h) => h.kind);
        const missing = (KINDS[path] ?? []).filter((k) => !found.includes(k));
        if (missing.length) fail(`4. ${label}`, `missing showcase(s): ${missing.join(", ")} (found ${found.join(", ") || "none"})`);
        if (want(2) && dir === "ltr" && (width === 390 || width === 1440)) {
          // The largest paint once the showcases near the first screen have started.
          for (const id of await page.evaluate(() => Object.keys(window.__sc.near))) await isOn(page, id, 5000);
          await page.waitForTimeout(800);
          const lcp = await page.evaluate(() => {
            const n = window.__sc.lcp?.node;
            const h1 = document.querySelector("main h1");
            const lede = [...document.querySelectorAll("main p")].find(
              (p) => h1 && h1.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING && !p.closest("[data-showcase], .sr-only, .eyebrow") && p.textContent.trim().split(/\s+/).length >= 8,
            );
            const what = !n ? null : n.closest?.("h1") ? "h1" : lede && (n === lede || lede.contains(n)) ? "lede" : null;
            return { what, node: n ? n.tagName.toLowerCase() + "." + String(n.className).split(" ")[0] + ' "' + n.textContent.trim().slice(0, 40) + '"' : null, t: Math.round(window.__sc.lcp?.t ?? 0) };
          });
          results.lcp ??= {};
          results.lcp[label] = lcp;
          if (!lcp.what) fail(`2. ${label}`, `the largest paint is ${lcp.node ?? "missing"}, not the H1 or the lede`);
        }
        const took = await mountAll(page);
        for (const [id, ms] of Object.entries(took)) if (ms === null) fail(`4. ${label}`, `#${id} did not reach data-sc="on" within 15 s`);
        if (state === "closed" && dir === "ltr" && width === 1440) ENGINE.set(path, new Set((await lateResources(page)).map((r) => r.url)));
        await page.waitForTimeout(300);
        const m = await layout(page);
        if (m.overflow > 0) fail(`4. ${label}`, `horizontal overflow of ${m.overflow}px${m.offenders.length ? " (" + m.offenders.join("; ") + ")" : ""}`);
        if (m.duplicates.length) fail(`4. ${label}`, `duplicate id(s): ${m.duplicates.slice(0, 4).join(", ")}`);
        if (page.errors.length) fail(`4. ${label}`, page.errors.slice(0, 3).join(" | "));
        if (want(13) && dir === "ltr") {
          const cta = state === "closed" ? EARLY : TEACH_AI;
          if (!m.labels.some((l) => l.includes(cta))) fail(`13. ${label}`, `"${cta}" is not shown`);
          if (state === "closed" && m.signup) fail(`13. ${label}`, 'href="/signup" while sign-ups are closed');
          const target = state === "closed" ? "/get-started#early-access" : "/signup";
          const stray = m.ctas.filter((h) => h !== target);
          if (stray.length) fail(`13. ${label}`, `showcase calls to action go to ${stray.join(", ")}, not ${target}`);
        }
        await close(page);
      }
}

await step(3, "layout shift", async () => {
  const cls = (results.cls = {});
  const judge = (label, s) => {
    cls[label] = round(s.total, 5);
    const line = `CLS ${s.total.toFixed(5)}${s.sources.length ? ` from ${s.sources.join(", ")}` : ""}`;
    if (JUDGE_CLS && s.total > 0.001) fail(`3. ${label}`, line);
    else report(`3. ${label}`, line);
  };
  if (PAGES.includes("/"))
    for (const viewport of [PHONE, DESKTOP]) {
      const page = await open({ viewport });
      await go(page, "/");
      const field = await hostOf(page, "field"),
        board = await hostOf(page, "board");
      await isOn(page, field);
      await page.waitForTimeout(10_000);
      await scrollToHost(page, board);
      await isOn(page, board);
      await page.waitForTimeout(10_000);
      judge(`/ ${viewport.width}: load, the field and the board`, await shiftsSince(page));
      await close(page);
    }
  if (PAGES.includes("/demo")) {
    const page = await open();
    await go(page, "/demo");
    const id = await hostOf(page, "play");
    await scrollToHost(page, id, "start");
    await isOn(page, id);
    await settlePlay(page, id);
    const from = await now(page);
    await page.click(`#${id} .bp-chip[data-t="t2"]`);
    await page.waitForTimeout(5000);
    judge("/demo: 5 s after a playground click", await shiftsSince(page, from));
    await close(page);
  }
  if (PAGES.includes("/trainer-brain")) {
    const page = await open();
    await go(page, "/trainer-brain");
    const id = await hostOf(page, "anatomy");
    await scrollToHost(page, id, "start");
    await isOn(page, id);
    await scrollTop(page);
    const from = await now(page);
    const end = await page.evaluate((id) => {
      const r = document.getElementById(id).getBoundingClientRect();
      return Math.round(r.bottom + scrollY);
    }, id);
    for (let y = 0; y <= end; y += 160) {
      await scrollTop(page, y);
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(800);
    judge("/trainer-brain: scrolling the anatomy", await shiftsSince(page, from));
    await close(page);
  }
  if (PAGES.includes("/pricing")) {
    const page = await open();
    await go(page, "/pricing");
    const from = await now(page);
    for (const selector of ["#bands .mk-pr-calc input[type=range]", "#example .mk-pr-calc input[type=range] >> nth=0", "#example .mk-pr-calc input[type=range] >> nth=1"]) {
      const input = page.locator(selector);
      await input.scrollIntoViewIfNeeded();
      await input.focus();
      for (let i = 0; i < 8; i++) await page.keyboard.press("PageUp");
      await page.keyboard.press("End");
      await page.keyboard.press("Home");
    }
    await page.waitForTimeout(800);
    judge("/pricing: the sliders", await shiftsSince(page, from));
    await close(page);
  }
});

/** The playground at rest: no run in progress (a run ignores chip clicks). */
async function settlePlay(page, id, timeout = 20_000) {
  await page.waitForFunction(
    (id) => {
      const r = document.getElementById(id)?.firstElementChild;
      return !!r && !r.querySelector(".bp-res.is-due") && r.querySelector(".bp-chip")?.getAttribute("aria-disabled") !== "true";
    },
    id,
    { timeout, polling: 100 },
  );
}

await step(5, "lifecycle", async () => {
  /** Aborts every JS and CSS request from the load event on: the engine's chunks. */
  const abortAfterLoad = async (page) => {
    let loaded = false;
    page.on("load", () => (loaded = true));
    await page.route(/\/_next\/static\/.*\.(js|css)(\?|$)/, (route) => (loaded ? route.abort() : route.continue()));
  };
  results.fallback = {};
  const offAt = (page, id) => page.evaluate((id) => window.__sc.log.find((e) => e.host === id && e.name === "data-sc" && e.value === "off")?.t ?? null, id);
  // The hero: its chunks aborted (the load fails at once) or stalled (they
  // never answer, so the island's 6 s fallback ends it, timed from
  // html[data-sc-ready]: the hero is near from the start).
  if (PAGES.includes("/"))
    for (const how of ["aborted", "stalled"]) {
      const label = `5. / hero, engine ${how}`;
      const page = await open({ viewport: PHONE });
      if (how === "aborted") await abortAfterLoad(page);
      else {
        let loaded = false;
        page.on("load", () => (loaded = true));
        await page.route(/\/_next\/static\/.*\.(js|css)(\?|$)/, (route) => (loaded ? undefined : route.continue()));
      }
      await go(page, "/");
      const id = await hostOf(page, "field");
      const off = await until(page, id, { attr: "data-sc", value: "off" }, 10_000);
      const ready = await page.evaluate(() => window.__sc.log.find((e) => e.name === "data-sc-ready")?.t ?? null);
      const ended = await offAt(page, id);
      const after = ready !== null && ended !== null ? Math.round(ended - ready) : null;
      results.fallback[`hero ${how}`] = after;
      if (!off || after === null || after > 7000) fail(label, `not "off" within 7 s of html[data-sc-ready] (${after} ms)`);
      else if (how === "stalled" && after < 5900) fail(label, `"off" ${after} ms after html[data-sc-ready], before the 6 s fallback`);
      const hidden = await page.evaluate(
        (id) =>
          [...document.getElementById(id).firstElementChild.querySelectorAll(".sc-res, .mc-stamp, .mc-hl, .mc-lane")]
            .filter((e) => e.checkVisibility() && !e.checkVisibility({ opacityProperty: true, visibilityProperty: true }))
            .map((e) => String(e.className).split(" ")[0]),
        id,
      );
      if (hidden.length) fail(label, `final frame not visible: ${hidden.slice(0, 4).join(", ")}`);
      await close(page);
    }
  if (PAGES.includes("/trainer-brain"))
    for (const where of ["below", "in view"]) {
      const label = `5. /trainer-brain anatomy, engine aborted, ${where}`;
      const page = await open();
      await abortAfterLoad(page);
      await go(page, "/trainer-brain");
      const id = await hostOf(page, "anatomy");
      await page.waitForTimeout(1500); // load, then idle: the island now waits for the root to come near
      const top = await page.evaluate((id) => document.getElementById(id).getBoundingClientRect().top + scrollY, id);
      const height = page.viewportSize().height;
      if (where === "below" && top < height + 200) {
        report(label, `skipped: the anatomy starts at y ${Math.round(top)}, near from the start`);
        await close(page);
        continue;
      }
      // Below: the root's top 100 px under the viewport (inside the island's
      // 200 px margin). In view: its top 100 px from the viewport's top.
      const near = top < height + 200 ? await page.evaluate(() => window.__sc.log.find((e) => e.name === "data-sc-ready")?.t ?? 0) : null;
      await scrollTop(page, where === "below" ? top - height - 100 : top - 100);
      const from = near ?? (await now(page));
      const off = await until(page, id, { attr: "data-sc", value: "off" }, 9000);
      const ended = await offAt(page, id);
      results.fallback[where === "below" ? "anatomy below" : "anatomy in view"] = ended === null ? null : Math.round(ended - from);
      if (!off || ended === null || ended - from > 7000) fail(label, `not "off" within 7 s of coming near (${ended === null ? "never" : Math.round(ended - from) + " ms"})`);
      if (where === "in view") {
        await page.waitForTimeout(1500);
        const flat = await page.evaluate((id) => window.__sc.log.find((e) => e.host === id && e.name === "data-sc-flat" && e.value !== null) ?? null, id);
        if (flat?.below) {
          report(label, "skipped: it went flat (correctly) while below the viewport, before it came into view");
          await close(page);
          continue;
        }
        if (flat) fail(label, "went flat while in view");
        await scrollTop(page, 0);
      }
      if (!(await until(page, id, { attr: "data-sc-flat" }, 3000))) fail(label, "not flat once entirely below the viewport");
      const m = await page.evaluate(
        ([id, from]) => ({
          flats: window.__sc.log.filter((e) => e.host === id && e.name === "data-sc-flat" && e.value !== null),
          shifts: window.__sc.shifts.filter((s) => !s.input && s.t >= from),
        }),
        [id, from],
      );
      if (m.flats.some((e) => !e.below)) fail(label, "data-sc-flat was set while the root was in view");
      if (m.shifts.length) fail(label, `layout shift ${m.shifts.reduce((n, s) => n + s.v, 0).toFixed(5)} from ${[...new Set(m.shifts.flatMap((s) => s.nodes))].slice(0, 3).join(", ")}`);
      await close(page);
    }
});

/**
 * Frames per kind: running while visible; gone within 1 s off screen, in a
 * hidden document, after Pause, during a call and under the device's reduced
 * motion, and back each time; the member's cookie in a context of its own.
 * Pages start at ?tier=full. The watchdog can still step a busy machine down
 * to "minimal", where the anatomy draws no frames at all (by design), so a
 * pass that ends there is tried once more on a fresh page.
 */
async function framesFor(path, kind, viewport = DESKTOP) {
  const label = `6. ${path} ${kind}`;
  for (let attempt = 1; ; attempt++) {
    const { problems, tier } = await framesPass(path, kind, viewport, label);
    if (problems.length && tier === "minimal" && attempt === 1) {
      report(label, `the watchdog stepped down to "minimal" (${problems[0]}); tried once more`);
      continue;
    }
    for (const p of problems) fail(label, tier === "minimal" ? `${p} (tier "minimal")` : p);
    return;
  }
}
async function framesPass(path, kind, viewport, label) {
  const problems = [];
  const page = await open({ viewport });
  await go(page, path, "sc=on&tier=full");
  const id = await hostOf(page, kind);
  await scrollToHost(page, id, kind === "anatomy" ? "start" : "center");
  if (!(await isOn(page, id))) throw new Error(`${label}: never "on"`);
  if (kind === "anatomy") await scrollTop(page, await page.evaluate((id) => document.getElementById(id).getBoundingClientRect().top + scrollY + innerHeight * 0.4, id));
  const runs = async (what) => {
    if (!(await running(page, id, true, 4000))) return problems.push(`${what}: no data-sc-run while visible`);
    const f = await frames(page, 1000);
    if (!(f.count > 0)) problems.push(`${what}: no frame in 1 s while running`);
  };
  await runs("visible");
  const y = await page.evaluate(() => scrollY);
  const states = [
    ["off screen", () => page.evaluate((id) => scrollTo({ top: document.getElementById(id).getBoundingClientRect().bottom + scrollY + innerHeight, behavior: "instant" }), id), () => scrollTop(page, y)],
    ["a hidden document", () => setHidden(page, true), () => setHidden(page, false)],
    ["a Kamran call", () => page.evaluate(() => document.documentElement.setAttribute("data-mk-call", "")), () => page.evaluate(() => document.documentElement.removeAttribute("data-mk-call"))],
    ["Pause", () => clickPause(page, id), () => clickPause(page, id)],
    ["reduced motion (device)", () => page.emulateMedia({ reducedMotion: "reduce" }), () => page.emulateMedia({ reducedMotion: "no-preference" })],
  ];
  for (const [what, apply, undo] of states) {
    await apply();
    if (!(await running(page, id, false, 1000))) problems.push(`data-sc-run still set 1 s after ${what}`);
    if (what === "Pause") {
      // Its label says what a press does, so no aria-pressed: a toggle's name never changes.
      const p = await pauseState(page, id);
      if (!/^Play/.test(p?.label ?? "") || p.pressed !== null) problems.push(`Pause leaves ${JSON.stringify(p)} ("Play…" and no aria-pressed expected)`);
    }
    if (what.startsWith("reduced")) {
      await isOn(page, id, 5000);
      await page.waitForTimeout(500);
      if ((await scState(page, id))?.run) problems.push("frames run again under reduced motion");
    }
    await undo();
    if (what.startsWith("reduced")) await isOn(page, id, 5000);
    await runs(`after ${what}`);
  }
  const infinite = await page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => a.effect?.target?.closest?.("[data-showcase]") && a.effect.getComputedTiming().iterations === Infinity)
      .map((a) => a.animationName ?? "script"),
  );
  if (infinite.length) problems.push(`infinite animation(s): ${infinite.join(", ")}`);
  if (page.errors.length) problems.push(page.errors.slice(0, 3).join(" | "));
  const tier = (await scState(page, id))?.tier;
  await close(page);
  return { problems, tier };
}

await step(6, "frames", async () => {
  for (const [path, kind] of [["/", "field"], ["/demo", "play"], ["/trainer-brain", "anatomy"], ["/trainer-brain", "play"]])
    if (PAGES.includes(path)) await framesFor(path, kind);
  // Reduced motion from either source: the showcases still, the rest of the
  // marketing motion as its switch says ("always": .mk-motion and the reveals).
  for (const source of ["device", "cookie"])
    for (const path of withShowcases()) {
      const label = `6. ${path} reduced motion (${source})`;
      const page = await open({ reduced: source === "device", cookie: source === "cookie" });
      await go(page, path);
      if (source === "cookie" && !(await page.evaluate(() => document.documentElement.getAttribute("data-reduce-motion") === "on")))
        fail(label, "the cookie did not set html[data-reduce-motion]");
      const took = await mountAll(page);
      await page.waitForTimeout(700);
      const m = await page.evaluate(() => ({
        run: [...document.querySelectorAll("[data-sc-run]")].length,
        motion: !!document.querySelector(".mk.mk-motion"),
        classes: ["sc-motion", "sc-pin"].filter((c) => document.documentElement.classList.contains(c)),
      }));
      if (Object.values(took).includes(null)) fail(label, "a showcase never reached data-sc=\"on\"");
      if (m.run) fail(label, `${m.run} root(s) with data-sc-run`);
      if (m.classes.length) fail(label, `html has ${m.classes.join(", ")}`);
      const always = (await motionSwitch(page)) === "always";
      if (always !== m.motion) fail(label, `.mk-motion ${m.motion ? "set" : "missing"} with the switch at "${always ? "always" : "device"}"`);
      if (always) {
        await page.evaluate(async () => {
          for (let y = 0; y <= document.documentElement.scrollHeight; y += 400) {
            scrollTo({ top: y, behavior: "instant" });
            await new Promise((r) => setTimeout(r, 60));
          }
        });
        await page.waitForTimeout(800);
        const pending = await page.evaluate(() => document.querySelectorAll('[data-mk-reveal="pending"]').length);
        if (pending) fail(label, `${pending} section(s) never revealed (the reveals follow "always")`);
      }
      await close(page);
    }
});

await step(7, "watchdog", async () => {
  if (!PAGES.includes("/")) return;
  const page = await open();
  await go(page, "/", "sc=on&tier=full&slow=30");
  const id = await hostOf(page, "field");
  await isOn(page, id);
  const tier = (await scState(page, id)).tier;
  if (tier !== "full") fail("7. watchdog", `?tier=full started at "${tier}"`);
  const t = Date.now();
  const down = await until(page, id, { attr: "data-sc-tier", value: "full", not: true }, 5000);
  results.watchdog = { ms: Date.now() - t, tier: (await scState(page, id)).tier };
  if (!down) fail("7. watchdog", "?slow=30 did not step data-sc-tier down within 5 s");
  await close(page);
});

await step(9, "receipts and overlays", async () => {
  if (!PAGES.includes("/")) return;
  {
    const label = "9. 1440 receipt";
    const page = await open();
    await go(page, "/");
    const id = await hostOf(page, "field");
    await isOn(page, id);
    await page.waitForTimeout(1000);
    await openReceipt(page, id);
    await page.waitForTimeout(400);
    if (!(await page.evaluate(() => !!document.activeElement?.closest('[data-showcase="receipt"]')))) fail(label, "focus did not move into the receipt");
    await clickPause(page, id);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    const m = await page.evaluate(() => ({ open: document.querySelectorAll('[data-showcase="receipt"]').length, focus: document.activeElement?.className ?? "" }));
    if (m.open) fail(label, "Esc did not close the receipt");
    if (!/mc-tile/.test(m.focus)) fail(label, `focus returned to "${m.focus}", not the tile that opened it`);
    const p = await pauseState(page, id);
    if (!/^Play/.test(p?.label ?? "") || p.pressed !== null) fail(label, `open → Pause → close leaves ${JSON.stringify(p)}`);
    if (!(await running(page, id, false, 1000))) fail(label, "data-sc-run after open → Pause → close");
    if (page.errors.length) fail(label, page.errors.slice(0, 3).join(" | "));
    await close(page);
  }
  {
    const label = "9. 390x844 sheet and receipt";
    const page = await open({ viewport: PHONE });
    await go(page, "/");
    const id = await hostOf(page, "field");
    await isOn(page, id);
    // The analytics bar waits for the first scroll on marketing pages, then stays.
    await scrollTop(page, 120);
    await page.waitForTimeout(400);
    await scrollTop(page, 0);
    await page.waitForTimeout(400);
    const consent = await page.evaluate(() => [...document.querySelectorAll(".consent-bar")].some((e) => e.checkVisibility() && e.getBoundingClientRect().height > 0));
    if (!consent) fail(label, "the consent bar is not open");
    const topmost = (selector) =>
      page.evaluate((selector) => {
        const el = document.querySelector(selector);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return !!document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest(selector);
      }, selector);
    if (await page.locator(`#${id} .mc-moreb`).isVisible()) {
      await page.click(`#${id} .mc-moreb`);
      await page.waitForTimeout(450);
      if (!(await topmost(".sc-layer .mc-sheet"))) fail(label, "the settings sheet is not topmost at its centre");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    } else fail(label, "no settings button (.mc-moreb) on the phone field");
    await openReceipt(page, id);
    await page.waitForTimeout(700);
    if (!(await topmost('.sc-layer [data-showcase="receipt"]'))) fail(label, "the receipt is not topmost at its centre");
    // Leave with the receipt open (a client-side navigation).
    await page.evaluate(() => document.querySelector('a[href="/pricing"]')?.click());
    await page.waitForURL(/\/pricing/, { timeout: 10_000 });
    await page.waitForTimeout(600);
    const left = await page.evaluate(() => ({ layers: document.querySelectorAll(".sc-layer").length, lock: document.documentElement.classList.contains("sc-lock") }));
    if (left.layers || left.lock) fail(label, `after leaving with a receipt open: ${left.layers} overlay layer(s), sc-lock ${left.lock}`);
    if (page.errors.length) fail(label, page.errors.slice(0, 3).join(" | "));
    await close(page);
  }
  {
    // A phone held sideways shows the desktop field: its receipt opens in the zoom. Turned upright, the zoom has no
    // room; the same moment is the phone's sheet, and closing it leaves the field as it was (ENG-1).
    const label = "9. 844x390 receipt turned to 390x844";
    const page = await open({ viewport: { width: 844, height: 390 } });
    await go(page, "/");
    const id = await hostOf(page, "field");
    await isOn(page, id);
    await page.waitForTimeout(800);
    const tile = page.locator(`#${id} .mc-lane[data-lane="sent"] .mc-tile`).first();
    await tile.scrollIntoViewIfNeeded();
    await tile.click();
    await page.waitForSelector(`#${id} .mc-rx [data-showcase="receipt"]`, { timeout: 5000 });
    await page.waitForTimeout(600);
    await page.setViewportSize(PHONE);
    await page.waitForTimeout(1200);
    const turned = await page.evaluate((id) => {
      const box = document.querySelector('[data-showcase="receipt"]'), back = box?.querySelector('[data-a="back"]')?.getBoundingClientRect();
      return { mode: box?.dataset.mode ?? null, back: back ? Math.round(back.height) : 0, zoom: document.getElementById(id).firstElementChild.classList.contains("is-zoom") };
    }, id);
    if (turned.mode !== "sheet" || turned.back < 44 || turned.zoom) fail(label, `after turning: ${JSON.stringify(turned)} (want the sheet, its Back button shown, no zoom)`);
    await page.locator('[data-showcase="receipt"] [data-a="back"]').click().catch(() => {});
    await page.waitForTimeout(600);
    const after = await page.evaluate((id) => {
      const root = document.getElementById(id).firstElementChild;
      return { zoom: root.classList.contains("is-zoom"), inert: [...root.querySelectorAll(":scope > [inert]")].map((e) => e.className), lock: document.documentElement.classList.contains("sc-lock"), open: document.querySelectorAll('[data-showcase="receipt"]').length };
    }, id);
    if (after.zoom || after.inert.length || after.lock || after.open) fail(label, `after Back: ${JSON.stringify(after)}`);
    if (page.errors.length) fail(label, page.errors.slice(0, 3).join(" | "));
    await close(page);
  }
});

/** Step 10 on one platform state: reads which moments run from the chips (data-off: not on yet here). */
async function playground(label) {
  if (!PAGES.includes("/demo")) return;
  const page = await open();
  await go(page, "/demo");
  const id = await hostOf(page, "play");
  await scrollToHost(page, id, "start");
  await isOn(page, id);
  const lane = () => page.evaluate((id) => document.querySelector(`#${id} .bp-res .sc-lane:not(.is-ghost)`)?.textContent.trim() ?? null, id);
  const play = async (t, how = "click") => {
    await settlePlay(page, id);
    if (how === "click") await page.click(`#${id} .bp-chip[data-t="${t}"]`);
    else {
      await page.focus(`#${id} .bp-chip[data-t="${t}"]`);
      await page.keyboard.press(how);
    }
    await page.waitForTimeout(300);
    await settlePlay(page, id);
    return lane();
  };
  /** The result column of a moment that does not run here. */
  const offCard = () =>
    page.evaluate((id) => {
      const r = document.getElementById(id).firstElementChild;
      return { card: r.querySelector(".bp-offcard")?.textContent ?? "", due: !!r.querySelector(".bp-res.is-due"), steps: r.querySelectorAll(".bp-logs li").length };
    }, id);
  // Deload's Reply picker uses the AI model: its chip says whether the model is on here.
  const model = !(await page.evaluate((id) => document.querySelector(`#${id} .bp-chip[data-t="t6"]`).hasAttribute("data-off"), id));
  results.playground ??= {};
  results.playground[label] = { model };
  const knee = await play("t2");
  const noai = await page.evaluate((id) => document.querySelector(`#${id} .bp-noai`)?.checkVisibility() ?? false, id);
  if (knee !== LANES.paused || !noai) fail(label, `knee: "${knee}", No AI called ${noai}`);
  const deload = await play("t6");
  if (model ? deload !== LANES.waits : deload !== null) fail(label, `deload: "${deload}"`);
  if (!model) {
    const c = await offCard();
    if (!/Not on yet\..*Specialist not on yet: Reply picker\./.test(c.card) || c.steps) fail(label, `deload with the model off: ${JSON.stringify(c)}`);
  }
  await settlePlay(page, id);
  await page.click(`#${id} .bp-chip[data-t="t3"]`);
  await page.waitForTimeout(300);
  const low = await offCard();
  if (!/Not on yet/.test(low.card) || low.due || low.steps) fail(label, `low recovery: ${JSON.stringify(low)}`);
  // Free text: its keyword table loads when typing starts, so wait for the line.
  const ask = async (text) => {
    await settlePlay(page, id);
    await page.fill(`#${id} .bp-free textarea`, text);
    await page.click(`#${id} .bp-free button`);
    return page
      .waitForFunction((id) => document.querySelector(`#${id} .bp-closest`)?.textContent.trim() || null, id, { timeout: 5000, polling: 50 })
      .then((h) => h.jsonValue(), () => "");
  };
  const closest = await ask("my knee hurts");
  if (!/^Closest sample: /.test(closest)) fail(label, `free text: "${closest}"`);
  await settlePlay(page, id);
  const pressed = () => page.evaluate((id) => document.querySelector(`#${id} .bp-chip[aria-pressed="true"]`)?.dataset.t ?? null, id);
  const was = await pressed();
  await page.evaluate((id) => (document.querySelector(`#${id} .bp-closest`).textContent = ""), id);
  const none = await ask("hello there");
  await page.waitForTimeout(300);
  if (!/^No sample is close/.test(none) || (await pressed()) !== was) fail(label, `"hello there": "${none}", chip ${await pressed()} (no sample, nothing new plays)`);
  if (model) {
    await play("t1");
    await page.$eval(`#${id} input[data-k="capPct"]`, (e) => {
      e.value = "3";
      e.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.waitForTimeout(300);
    const why = await page.evaluate((id) => document.querySelector(`#${id} .bp-why`)?.textContent.trim() ?? "", id);
    if (!/^Before: .+ Now: /.test(why)) fail(label, `a setting change shows "${why}", not the before/now line`);
  } else {
    // Creatine runs on code alone; with supplement questions off it goes to the Draft writer, not on yet:
    // the card and the announcement say so at once, and "Run it again" runs nothing.
    const on = await play("t9");
    const flip = async () => {
      await settlePlay(page, id);
      await page.click(`#${id} input[data-k="supplementsTopic"]`);
      await page.waitForTimeout(700);
    };
    await flip();
    const said = await page.evaluate(() => document.querySelector("[data-sc-live]")?.textContent ?? "");
    await page.click(`#${id} .bp-again`);
    await page.waitForTimeout(300);
    const c = await offCard();
    await flip();
    const back = await lane();
    if (on !== LANES.waits || !/Specialist not on yet: Draft writer\./.test(c.card) || c.steps || !/Not on yet/.test(said) || back !== LANES.waits)
      fail(label, `creatine "${on}", supplements off ${JSON.stringify({ ...c, said })}, back on "${back}"`);
  }
  const enter = await play(model ? "t6" : "t9", "Enter");
  const space = await play("t2", "Space");
  if (enter !== LANES.waits || space !== LANES.paused) fail(label, `keyboard: Enter on ${model ? "deload" : "creatine"} "${enter}", Space on knee "${space}"`);
  if (page.errors.length) fail(label, page.errors.slice(0, 3).join(" | "));
  await close(page);
}
await step(10, "playground", () => playground("10. /demo"));

await step(11, "/trainer-brain", async () => {
  if (!PAGES.includes("/trainer-brain")) return;
  const frameAt = async (viewport, label) => {
    const page = await open({ viewport });
    await go(page, "/trainer-brain");
    const id = await hostOf(page, "anatomy");
    await scrollToHost(page, id, "start");
    await isOn(page, id);
    const g = await page.evaluate((id) => {
      const r = document.getElementById(id).firstElementChild;
      return {
        pin: document.documentElement.classList.contains("sc-pin"),
        top: r.getBoundingClientRect().top + scrollY,
        h: r.offsetHeight,
        f: r.querySelector(".ca-frame")?.offsetHeight ?? 0,
        scTop: parseFloat(getComputedStyle(r).getPropertyValue("--sc-top")) || 0,
        sticky: getComputedStyle(r.querySelector(".ca-frame") ?? r).position === "sticky",
      };
    }, id);
    const at = (q) => scrollTop(page, g.top - g.scTop + q * (g.h - g.f) + 1);
    await at(0.3);
    await page.waitForTimeout(500);
    const flush = await page.evaluate((id) => {
      const f = document.querySelector(`#${id} .ca-frame`)?.getBoundingClientRect();
      const h = document.querySelector(".mk-header")?.getBoundingClientRect();
      return f && h ? [Math.round(f.top), Math.round(h.bottom)] : null;
    }, id);
    if (!g.sticky || !flush || Math.abs(flush[0] - flush[1]) > 1) fail(`11. ${label}`, `pinned frame top ${flush?.[0]}, header bottom ${flush?.[1]} (sticky ${g.sticky})`);
    return { page, id, g, at };
  };
  {
    const { page, id, g, at } = await frameAt(DESKTOP, "1440x900");
    if (!g.pin) fail("11. 1440x900", "html.sc-pin is not set");
    if (!(g.h > 3 * DESKTOP.height)) fail("11. 1440x900", `the section is ${g.h}px tall (more than 3 viewports expected)`);
    const steps = [];
    for (let q = 0.05; q < 0.75; q += 0.08) {
      await at(q);
      await page.waitForTimeout(450);
      steps.push(await page.evaluate((id) => document.querySelector(`#${id} .ca-p.is-open`)?.dataset.k ?? null, id));
    }
    const seen = [...new Set(steps.filter(Boolean))];
    if (seen.length < 3 || seen.join("") !== [...seen].sort().join("")) fail("11. 1440x900", `steps while scrolling: ${steps.join(",")}`);
    await close(page);
  }
  for (const viewport of [{ width: 1000, height: 900 }, PHONE]) await close((await frameAt(viewport, `${viewport.width}x${viewport.height}`)).page);
  for (const [what, o] of [["reduced motion", { reduced: true }], ["1440x650", { viewport: { width: 1440, height: 650 } }]]) {
    const page = await open(o);
    await go(page, "/trainer-brain");
    const id = await hostOf(page, "anatomy");
    await scrollToHost(page, id, "start");
    await isOn(page, id, 8000);
    const sticky = await page.evaluate((id) => getComputedStyle(document.querySelector(`#${id} .ca-frame`)).position, id);
    if (sticky === "sticky") fail(`11. ${what}`, "the anatomy pins (flat plates expected)");
    await close(page);
  }
  {
    const page = await open();
    await go(page, "/trainer-brain");
    const links = page.locator('a[data-run][href^="#"]');
    const pick = await links.evaluateAll((as) =>
      as.findIndex((a) => document.querySelector(`${a.hash} .bp-chip[aria-pressed="true"]`)?.dataset.t !== a.dataset.run),
    );
    if (pick < 0) fail("11. See it work", `no See it work link (a[data-run]) to a moment the playground is not already showing (${await links.count()} links)`);
    else {
      const link = links.nth(pick);
      const t = await link.getAttribute("data-run");
      const target = (await link.getAttribute("href")).slice(1);
      await link.scrollIntoViewIfNeeded();
      await link.click();
      const ran = await page
        .waitForFunction(([target, t]) => document.querySelector(`#${target} .bp-chip[data-t="${t}"]`)?.getAttribute("aria-pressed") === "true", [target, t], { timeout: 10_000 })
        .then(() => true, () => false);
      if (!ran) fail("11. See it work", `the ${t} chip in #${target} is not pressed after the click`);
    }
    if (page.errors.length) fail("11. /trainer-brain", page.errors.slice(0, 3).join(" | "));
    await close(page);
  }
});

/** Clicks the first link to `to` a visitor can click (shown, not under anything, not in a closed menu). */
async function clickLinkTo(page, to) {
  const links = page.locator(`a[href="${to}"]`);
  for (let i = 0; i < (await links.count()); i++) {
    const link = links.nth(i);
    if (!(await link.isVisible())) continue;
    try {
      await link.scrollIntoViewIfNeeded({ timeout: 1000 });
      await link.click({ trial: true, timeout: 1000 });
    } catch {
      continue;
    }
    await link.click();
    return true;
  }
  return false;
}

await step(12, "navigation loop", async () => {
  if (!["/", "/pricing", "/trainer-brain", "/demo"].every((p) => PAGES.includes(p))) return;
  const page = await open();
  await go(page, "/");
  // The analytics bar opens on the first scroll and covers the footer's links: answer it.
  await scrollTop(page, 120);
  await page.locator(".consent-bar").getByRole("button", { name: "No thanks", exact: true }).click({ timeout: 5000 }).catch(() => {});
  await scrollTop(page);
  const perFrame = [];
  for (let round = 1; round <= 3; round++) {
    for (const to of ["/pricing", "/", "/trainer-brain", "/demo", "/"]) {
      const from = new URL(page.url()).pathname;
      if (!(await clickLinkTo(page, to))) {
        fail(`12. round ${round}`, `no link to ${to} a visitor can click on ${from}`);
        break;
      }
      await page.waitForFunction((to) => location.pathname === to, to, { timeout: 15_000 });
      const took = await mountAll(page);
      const late = Object.entries(took).filter(([, ms]) => ms === null);
      if (late.length) fail(`12. round ${round} ${from} → ${to}`, `${late.map(([id]) => "#" + id).join(", ")} never reached "on"`);
    }
    await scrollTop(page);
    await page.waitForTimeout(500);
    const f = await frames(page, 1000);
    perFrame.push(median(f.callbacks));
  }
  results.navigation = { callbacksPerFrame: perFrame };
  if (perFrame[2] === null || perFrame[0] === null || perFrame[2] > perFrame[0]) fail("12. navigation loop", `animation-frame callbacks per frame, rounds 1–3: ${perFrame.join(", ")}`);
  if (page.errors.length) fail("12. navigation loop", page.errors.slice(0, 3).join(" | "));
  await close(page);
});

await step(14, "pricing calculators", async () => {
  if (!PAGES.includes("/pricing")) return;
  const label = "14. /pricing";
  const page = await open();
  await go(page, "/pricing");
  const clean = (s) => s.replace(/[\s\u00a0\u202f]+/g, " ").trim();
  const pct = (n) => new Intl.NumberFormat("en-AE", { maximumFractionDigits: 1 }).format(n) + "%";
  const whole = (n) => new Intl.NumberFormat("en-AE", { maximumFractionDigits: 0 }).format(n);
  const minPrice = Number(await page.locator("#example .mk-pr-calc input[type=range]").first().getAttribute("min"));
  // The compact rule (components/marketing/pricing-islands.tsx takeHome): one
  // monthly price, no nutrition, voice or sessions; the example's AED 250 session.
  const estimate = (subscribers, price) =>
    estimateEarnings({ ...DEFAULT_EARNINGS_INPUTS, subscribers, billing: "monthly", workoutPriceAed: price, nutritionSharePct: 0, voiceSharePct: 0, sessionsPerMonth: 0, yourSessionRateAed: 250 });
  const share = page.locator("#bands .mk-pr-calc");
  for (const [i, [n, shown]] of [[100, "25%"], [300, "21.7%"], [1000, "17%"], [1500, "14.7%"]].entries()) {
    await share.locator(".mk-pr-jumps button").nth(i).click();
    await page.waitForTimeout(100);
    const got = clean(await share.locator(".mk-pr-marker b").innerText());
    if (got !== shown || got !== pct(estimate(n, minPrice).effectiveCommissionPct)) fail(label, `${n} subscribers: ${got} (expected ${shown})`);
  }
  const tile = page.locator("#example .mk-pr-calc");
  const [price, count] = [tile.locator("input[type=range]").nth(0), tile.locator("input[type=range]").nth(1)];
  /** As a visitor sets a range: PageUp or PageDown while a whole page is left, then the arrows. */
  const setRange = async (input, value) => {
    await input.scrollIntoViewIfNeeded();
    await input.focus();
    const read = () => input.evaluate((e) => Number(e.value));
    let jump = await input.evaluate((e) => (Number(e.max) - Number(e.min)) / 10);
    let cur = await read();
    for (let i = 0; i < 40 && Math.abs(value - cur) >= jump; i++) {
      await page.keyboard.press(value > cur ? "PageUp" : "PageDown");
      const next = await read();
      if (next === cur) break;
      jump = Math.abs(next - cur);
      cur = next;
    }
    for (let i = 0; i < 400 && cur !== value; i++) {
      await page.keyboard.press(value > cur ? "ArrowRight" : "ArrowLeft");
      cur = await read();
    }
  };
  for (const [p, n] of [[minPrice, 150], [299, 300], [999, 1500]]) {
    await setRange(price, p);
    await setRange(count, n);
    const e = estimate(n, p);
    const got = {
      subs: clean((await tile.locator(".mk-pr-rows dd").allInnerTexts())[0] ?? ""),
      share: clean(await tile.locator(".mk-pr-rows dt .mk-pr-slot").innerText()),
      keep: clean(await tile.locator(".mk-pr-keep-figure").innerText()),
    };
    const expected = { subs: clean(aedWhole(e.subscriptionMonthlyMinor)), share: pct(e.effectiveCommissionPct), keep: clean(aedWhole(e.beforeOtherCostsMinor)) };
    if (JSON.stringify(got) !== JSON.stringify(expected)) fail(label, `AED ${p} × ${n}: ${JSON.stringify(got)}, estimateEarnings ${JSON.stringify(expected)}`);
  }
  if (page.errors.length) fail(label, page.errors.slice(0, 3).join(" | "));
  await close(page);
});

await step(15, "robot path", async () => {
  for (const path of PAGES) {
    const label = `15. ${path}`;
    const engine = KINDS[path]?.length ? await engineChunks(path) : new Set();
    const page = await open({ viewport: PHONE });
    await go(page, path, "");
    await page.evaluate(async () => {
      for (let y = 0; y <= document.documentElement.scrollHeight; y += 500) {
        scrollTo({ top: y, behavior: "instant" });
        await new Promise((r) => setTimeout(r, 50));
      }
      scrollTo({ top: 0, behavior: "instant" });
    });
    await page.waitForTimeout(2500);
    const m = await page.evaluate(() => ({
      classes: ["sc-motion", "sc-pin"].filter((c) => document.documentElement.classList.contains(c)),
      roots: [...document.querySelectorAll("[data-showcase]:not([data-showcase=layer])")].map((r) => r.getAttribute("data-sc")),
      hidden: [...document.querySelectorAll("[data-showcase] .sc-res")]
        .filter((e) => e.checkVisibility() && !e.checkVisibility({ opacityProperty: true, visibilityProperty: true }))
        .map((e) => String(e.className).split(" ")[0]),
    }));
    const late = await lateResources(page);
    const fetched = late.filter((r) => engine.has(r.url)).map((r) => r.url.split("/").pop());
    for (const r of late.filter((r) => !isCss(r.url)))
      if ((await (await fetch(r.url)).text()).includes("data-sc-tier")) fetched.push(r.url.split("/").pop());
    if (fetched.length) fail(label, `engine chunk(s) requested without ?sc=on: ${[...new Set(fetched)].join(", ")}`);
    if (m.classes.length) fail(label, `html has ${m.classes.join(", ")}`);
    if (m.roots.some((s) => s !== "pre")) fail(label, `roots ${m.roots.join(",")} (pre expected)`);
    if (m.hidden.length) fail(label, `final frame hidden: ${m.hidden.slice(0, 4).join(", ")}`);
    await close(page);
  }
});

await step(16, "keyboard and board", async () => {
  // A Tab walk from the top, no scrolling first, 120 ms between presses (A11Y-2: the still frame's controls wait,
  // disabled, for the engine; mounting only once a host came near let Tab pass the board and most of the playground).
  const walk = async (path, kind, want, max) => {
    const label = `16. ${path} Tab walk`;
    const page = await open({ viewport: { width: 1280, height: 900 } });
    await go(page, path);
    const id = await hostOf(page, kind);
    const met = new Set();
    for (let i = 0; i < max && met.size < want.length; i++) {
      await page.keyboard.press("Tab");
      await page.waitForTimeout(120);
      const at = await page.evaluate(([id, want]) => want.find((s) => document.activeElement?.matches(`#${id} ${s}`)) ?? null, [id, want]);
      if (at) met.add(at);
    }
    const missed = want.filter((s) => !met.has(s));
    if (missed.length) fail(label, `Tab from the top never reached ${missed.join(", ")} (${kind}: ${(await scState(page, id))?.sc})`);
    if (page.errors.length) fail(label, page.errors.slice(0, 3).join(" | "));
    await close(page);
  };
  if (PAGES.includes("/")) await walk("/", "board", [".mc-lv [role=radio]", ".mc-bar input", ".mc-sw", ".mb-b"], 120);
  if (PAGES.includes("/trainer-brain")) await walk("/trainer-brain", "play", ["[data-spec]", ".bp-chip", "textarea"], 160);
  if (PAGES.includes("/")) {
    // The board keeps its height through a change of each control (ENG-5: its line grew and shrank by up to 74 px).
    const label = "16. / board height";
    for (const viewport of [PHONE, DESKTOP]) {
      const page = await open({ viewport });
      await go(page, "/");
      const id = await hostOf(page, "board");
      await scrollToHost(page, id, "start");
      await isOn(page, id);
      const height = () => page.evaluate((id) => Math.round(document.getElementById(id).firstElementChild.getBoundingClientRect().height * 10) / 10, id);
      const seen = [await height()];
      for (const act of [
        (p) => p.click(`#${id} .mc-lv [data-level="1"]`),
        (p) => p.click(`#${id} .mc-sw`),
        (p) => p.click(`#${id} .mc-lv [data-level="3"]`),
        ...["90", "70"].map((v) => (p) => p.evaluate(([id, v]) => {
          const r = document.querySelector(`#${id} .mc-bar input`);
          r.value = v;
          r.dispatchEvent(new Event("input", { bubbles: true }));
        }, [id, v])),
      ]) {
        await act(page);
        await page.waitForTimeout(700);
        seen.push(await height());
      }
      if (new Set(seen).size > 1) fail(`${label} ${viewport.width}`, `the board's height changed: ${seen.join(" → ")} px`);
      else report(`${label} ${viewport.width}`, `${seen[0]} px through five changes`);
      if (page.errors.length) fail(label, page.errors.slice(0, 3).join(" | "));
      await close(page);
    }
  }
});

// ---------------------------------------------------------------------------
// Metrics (reported; judged with SHOWCASE_JUDGE_METRICS=1): 390x844 at 4x CPU, ?tier=full.
const baseline = existsSync(BASELINE) ? JSON.parse(await readFile(BASELINE, "utf8")) : null;
await step("metrics", "metrics", async () => {
  const metrics = (results.metrics = { conditions: `390x844 DPR 3 touch, ${THROTTLE}x CPU, ?sc=on&tier=full, platform closed, median of ${RUNS}`, pages: {} });
  const judge = (label, ok, line) => (JUDGE_METRICS && !ok ? fail(`metrics ${label}`, line) : report(`metrics ${label}`, line + (ok ? "" : " (over budget)")));
  /** Blocking time from the response's end to 5 s after the load event: the page's, and the engine's share (long
      tasks in frames that ran one of the scripts `ours` names once that window has passed). */
  const blocking = async (page, ours = async () => []) => {
    await page.waitForTimeout(Math.max(0, await page.evaluate(() => performance.getEntriesByType("navigation")[0].loadEventStart + 5000 - performance.now())));
    const urls = await ours(page);
    return page.evaluate((urls) => {
      const nav = performance.getEntriesByType("navigation")[0], sc = window.__sc;
      const tasks = sc.long.filter(([t]) => t >= nav.responseEnd && t < nav.loadEventStart + 5000);
      const frames = sc.loaf.filter(([, , scripts]) => scripts.some((u) => urls.includes(u)));
      const ours = tasks.filter(([t, d]) => frames.some(([ft, fd]) => ft < t + d && ft + fd > t));
      const sum = (list) => list.reduce((n, [, d]) => n + Math.max(0, d - 50), 0);
      return { load: nav.loadEventStart, tbt: sum(tasks), engine: sum(ours), lcp: sc.lcp?.t ?? null };
    }, urls);
  };
  // Software compositing (no GPU, as in this container and CI): a canvas's commit is a CPU copy every frame, so frame
  // gaps say more about the machine than the engine there (PERF-5). Asked of WebGL once.
  let gpu = null;
  for (const path of PAGES) {
    const runs = [];
    for (let run = 0; run < RUNS; run++) {
      const page = await open({ viewport: PHONE, throttle: THROTTLE });
      await go(page, path, "sc=on&tier=full");
      gpu ??= await page.evaluate(() => {
        try {
          const gl = document.createElement("canvas").getContext("webgl"), info = gl?.getExtension("WEBGL_debug_renderer_info");
          return gl ? String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER)) : "none";
        } catch {
          return "none";
        }
      });
      const first = (await hosts(page))[0];
      // The STOP stamp on /: from the load event until "STOP · No AI called" shows.
      let stamp = null;
      if (path === "/" && first)
        stamp = await page
          .waitForFunction(
            (id) => {
              const r = document.getElementById(id)?.firstElementChild;
              const s = r?.querySelector(".mc-stamp");
              if (!s || r.getAttribute("data-sc") !== "on" || !s.checkVisibility({ opacityProperty: true, visibilityProperty: true }) || Number(getComputedStyle(s).opacity) < 0.99) return false;
              return performance.now() - performance.getEntriesByType("navigation")[0].loadEventStart;
            },
            first.id,
            { timeout: 15_000, polling: 50 },
          )
          .then((h) => h.jsonValue(), () => null);
      // Blocking time to 5 s after the load event (the engine mounts in it): the engine's chunks are the scripts
      // fetched after the load event, the island's those that set its mark.
      const load = await blocking(page, async (p) => [...(await lateResources(p)).map((x) => x.url).filter((u) => !isCss(u)), ...(await islandChunks(p))]);
      const r = { tbt: load.tbt, engineTbt: load.engine, lcp: load.lcp, stamp, frames: {}, mount: [] };
      // The same page of the build before phase 1, measured now, in turn (PERF-4).
      if (BASELINE_URL) {
        const before = await open({ viewport: PHONE, throttle: THROTTLE });
        await before.goto(new URL(path + "?sc=on&tier=full", BASELINE_URL).href, { waitUntil: "load" });
        r.baseTbt = (await blocking(before)).tbt;
        await close(before);
      }
      // The consent bar opens on the first scroll and restyles the page: before the mounts are timed, and on its
      // own (PERF-3: it shared a frame with the anatomy's mount).
      const barFrom = await page.evaluate(() => performance.now());
      await scrollTop(page, 60);
      await page.waitForTimeout(250);
      await scrollTop(page, 0);
      await page.waitForTimeout(500);
      r.consent = await page.evaluate((from) => window.__sc.long.filter(([t]) => t >= from).map(([, d]) => Math.round(d)), barFrom);
      // Per showcase: long tasks from mounting, then frames while it runs.
      for (const { id, kind } of await hosts(page)) {
        if ((await scState(page, id))?.sc !== "on") await scrollToHost(page, id, kind === "anatomy" ? "start" : "center");
        await isOn(page, id);
        await page.waitForTimeout(1000);
        // The long tasks from the island's import (its mark, brain/mount.tsx)
        // or, without one, from the root coming near, to "on" + 1 s, in long
        // animation frames that ran the engine's chunks or the island's own
        // (an engine module already loaded mounts in the island's callback,
        // as the board does), or only rendered: not the page's other work in
        // that second (the consent bar opening on the first scroll).
        const ours = [...(await lateResources(page)).map((x) => x.url).filter((u) => !isCss(u)), ...(await islandChunks(page))];
        const tasks = await page.evaluate(
          ([id, load, urls]) => {
            const sc = window.__sc;
            const from = performance.getEntriesByName(`sc-mount:${id}`)[0]?.startTime ?? Math.max(sc.near[id] ?? 0, load);
            const on = sc.log.find((e) => e.host === id && e.name === "data-sc" && e.value === "on")?.t ?? from;
            const frames = sc.loaf.filter(([, , scripts]) => !scripts.length || scripts.some((u) => urls.includes(u)));
            return sc.long
              .filter(([t, d]) => t + d >= from && t <= on + 1000 && frames.some(([ft, fd]) => ft < t + d && ft + fd > t))
              .map(([, d]) => Math.round(d));
          },
          [id, load.load, ours],
        );
        r.mount.push({ kind, tasks });
        if (kind === "board") continue;
        if (kind === "anatomy") await scrollTop(page, await page.evaluate((id) => document.getElementById(id).getBoundingClientRect().top + scrollY + innerHeight * 0.4, id));
        // As a visitor who has scrolled: down 200 px and back, the root in view.
        const y = await page.evaluate(() => scrollY);
        await scrollTop(page, y + 200);
        await page.waitForTimeout(400);
        await scrollTop(page, y);
        await page.waitForTimeout(600);
        if (kind === "play") {
          // A run plays at 60 fps, sampled from its start to its end; at rest the playground breathes at
          // 12 fps. Knee runs on code alone, so it runs under every flag state (Omar's needs the AI model).
          await settlePlay(page, id).catch(() => {});
          await page.click(`#${id} .bp-chip[data-t="t2"]`).catch(() => {});
          await page.waitForFunction((id) => document.querySelector(`#${id} .bp-res.is-due`), id, { timeout: 3000 }).catch(() => {});
        }
        await running(page, id, true, 3000);
        const sample = async (name, ms, until) => {
          const f = await frames(page, ms, until);
          r.frames[name] = { gap: round(p95(f.gaps)), work: round(p95(f.work), 2), count: f.count, tier: (await scState(page, id)).tier };
        };
        await sample(kind, kind === "play" ? 3000 : 4000, kind === "play" ? () => settlePlay(page, id, 3000) : undefined);
        if (kind === "field") {
          // Partly under the sticky header: its top 100 px above the header's bottom.
          await page.evaluate((id) => {
            const header = document.querySelector(".mk-header")?.getBoundingClientRect().bottom ?? 0;
            scrollBy({ top: document.getElementById(id).getBoundingClientRect().top - header + 100, behavior: "instant" });
          }, id);
          await page.waitForTimeout(600);
          await sample("field under the header", 2000);
          await scrollTop(page, y);
        }
        if (kind === "anatomy") {
          // While scrolling through the pin.
          const [scrolled] = await Promise.all([
            frames(page, 3000),
            page.evaluate(async () => {
              for (let i = 0; i < 60; i++) {
                scrollBy({ top: 30, behavior: "instant" });
                await new Promise((done) => setTimeout(done, 40));
              }
            }),
          ]);
          r.frames["anatomy scrolling"] = { gap: round(p95(scrolled.gaps)), work: round(p95(scrolled.work), 2), count: scrolled.count, tier: (await scState(page, id)).tier };
        }
      }
      // Engine chunks: what loads after the load event. The receipt's chunk
      // and sheet (the only ones that know .ba-burst) load on demand: open one on /.
      if (path === "/" && first) {
        await scrollTop(page);
        await openReceipt(page, first.id).catch(() => {});
        await page.waitForTimeout(800);
        await page.keyboard.press("Escape");
      }
      r.engine = 0;
      r.receipt = path === "/" ? 0 : null;
      for (const url of new Set((await lateResources(page)).map((x) => x.url))) {
        const body = Buffer.from(await (await fetch(url)).arrayBuffer());
        const size = gzipSync(body).length;
        if (body.includes("ba-burst")) r.receipt += size;
        else r.engine += size;
      }
      // Input latency: a chip on /demo (the knee: in the phone's first six, and code alone, so it runs
      // under every flag state), the share slider on /pricing (Event Timing).
      if (path === "/demo" && first) {
        await settlePlay(page, first.id).catch(() => {});
        const from = await now(page);
        await page.click(`#${first.id} .bp-chip[data-t="t2"]`);
        await page.waitForTimeout(600);
        r.input = await page.evaluate((from) => Math.max(0, ...window.__sc.events.filter((e) => e.t >= from).map((e) => e.d)), from);
      }
      const slider = page.locator("#bands .mk-pr-calc input[type=range]");
      if (path === "/pricing" && (await slider.count())) {
        const input = slider.first();
        await input.scrollIntoViewIfNeeded();
        await input.focus();
        const from = await now(page);
        for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
        await page.waitForTimeout(600);
        r.input = await page.evaluate((from) => Math.max(0, ...window.__sc.events.filter((e) => e.t >= from).map((e) => e.d)), from);
      }
      if (run === 0) {
        // The first HTML's own scripts and sheets, shared by every route on the catch-all.
        const firstLoad = await page.evaluate(() => {
          const load = performance.getEntriesByType("navigation")[0].loadEventStart;
          return performance.getEntriesByType("resource").filter((x) => x.startTime < load && /\/_next\/static\//.test(x.name) && /\.(js|css)(\?|$)/.test(x.name)).map((x) => x.name);
        });
        r.js = (await Promise.all(firstLoad.filter((u) => !isCss(u)).map(gzipped))).reduce((a, b) => a + b, 0);
        r.css = (await Promise.all(firstLoad.filter(isCss).map(gzipped))).reduce((a, b) => a + b, 0);
      }
      r.errors = page.errors;
      runs.push(r);
      await close(page);
    }
    const m = {
      tbt: round(median(runs.map((r) => r.tbt)), 0),
      engineTbt: round(median(runs.map((r) => r.engineTbt)), 0),
      baseTbt: BASELINE_URL ? round(median(runs.map((r) => r.baseTbt ?? null)), 0) : null,
      consent: runs[0].consent,
      lcp: round(median(runs.map((r) => r.lcp)), 0),
      stamp: round(median(runs.map((r) => r.stamp)), 0),
      engine: runs[0].engine,
      receipt: runs[0].receipt ?? null,
      input: round(median(runs.map((r) => r.input ?? null)), 0),
      js: runs[0].js,
      css: runs[0].css,
      frames: runs[0].frames,
      mount: runs[0].mount,
      errors: [...new Set(runs.flatMap((r) => r.errors))],
    };
    metrics.pages[path] = m;
    console.log(`  metrics ${path}: ${JSON.stringify(m)}`);
  }
  if (env.SHOWCASE_BASELINE_OUT) {
    const pagesOut = Object.fromEntries(Object.entries(metrics.pages).map(([p, m]) => [p, { tbt: m.tbt, lcp: m.lcp, js: m.js, css: m.css }]));
    let commit = null;
    try {
      commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root }).toString().trim();
    } catch {}
    const baselineOut = {
      about: "The build before phase 1 (PLAN.md §4.3): blocking time from the response's end to 5 s after the load event, the largest paint, and the first HTML's JavaScript and CSS (gzipped bytes). scripts/marketing-showcase-check.mjs compares with it.",
      commit,
      measured: new Date().toISOString().slice(0, 10),
      conditions: metrics.conditions,
      pages: pagesOut,
    };
    await writeFile(env.SHOWCASE_BASELINE_OUT, JSON.stringify(baselineOut, null, 2) + "\n");
    console.log(`Baseline written: ${env.SHOWCASE_BASELINE_OUT}`);
    return;
  }
  const budget = { "/": 45, "/trainer-brain": 50, "/demo": 37 };
  const software = /swiftshader|llvmpipe|software|^none$/i.test(gpu ?? "none");
  metrics.gpu = gpu;
  for (const [path, m] of Object.entries(metrics.pages)) {
    const b = baseline?.pages?.[path];
    for (const [kind, f] of Object.entries(m.frames)) {
      const line = `p95 frame gap ${f.gap} ms (budget 20; tier ${f.tier}, ${f.count} frames)`, ok = f.gap !== null && f.gap <= 20;
      if (software) report(`metrics ${path} ${kind} frame gap`, line + (ok ? "" : " (over budget)") + ` (software compositing, ${gpu}: reported, judged on GPU hardware)`);
      else judge(`${path} ${kind} frame gap`, ok, line);
      judge(`${path} ${kind} work`, f.work !== null && f.work <= 4, `p95 engine work per frame ${f.work} ms (budget 4)`);
    }
    if (path === "/") judge("/ STOP stamp", m.stamp !== null && m.stamp <= 2500, `the STOP stamp ${m.stamp} ms after load (budget 2500)`);
    // The engine's own blocking time: its mounts (each long task 80 ms or less) leave at most 2 x 30 ms, a margin on top.
    if (KINDS[path]?.length) judge(`${path} engine blocking`, m.engineTbt <= 100, `the engine's blocking time ${m.engineTbt} ms from the response's end to load + 5 s (budget 100)`);
    if (m.baseTbt !== null) judge(`${path} TBT`, m.tbt <= m.baseTbt + 100, `blocking time ${m.tbt} ms, the build before phase 1 ${m.baseTbt} ms in this session (budget +100)`);
    else report(`metrics ${path} TBT`, `${m.tbt} ms from the response's end (not judged without SHOWCASE_BASELINE_URL${b ? `; the stored ${b.tbt} ms was measured elsewhere, from the first paint` : ""})`);
    if (m.consent?.length) report(`metrics ${path} consent bar`, `long tasks as it opens on the first scroll: ${JSON.stringify(m.consent)} (page work, not the engine's)`);
    for (const { kind, tasks } of m.mount) judge(`${path} ${kind} mount`, tasks.length <= 2 && tasks.every((d) => d <= 80), `long tasks from mounting: ${JSON.stringify(tasks)} (budget 2, each 80 ms)`);
    if (m.input !== null) judge(`${path} input`, m.input <= 200, `input latency ${m.input} ms (budget 200)`);
    if (budget[path] !== undefined && KINDS[path]?.length) judge(`${path} engine`, m.engine <= budget[path] * 1024, `engine chunks ${kb(m.engine)} KB gzipped (budget ${budget[path]})`);
    if (m.receipt !== null) judge("/ receipt", m.receipt <= 7 * 1024, `the receipt on demand ${kb(m.receipt)} KB gzipped (budget 7)`);
    if (m.errors.length) fail(`metrics ${path}`, m.errors.slice(0, 3).join(" | "));
  }
  const shared = Object.values(metrics.pages)[0];
  const b = baseline ? Object.values(baseline.pages)[0] : null;
  if (shared && b) {
    judge("shared JS", shared.js - b.js <= 10 * 1024, `first-load JavaScript ${kb(shared.js)} KB gzipped, baseline ${kb(b.js)} (growth ${kb(shared.js - b.js)}, budget 10)`);
    judge("global CSS", shared.css - b.css <= 26 * 1024, `first-load CSS ${kb(shared.css)} KB gzipped, baseline ${kb(b.css)} (net added ${kb(shared.css - b.css)}, budget 26 gross)`);
  }
  if (PAGES.includes("/trainer-brain")) {
    // The showcase HTML on /trainer-brain: its copy in the HTML and its copy
    // in the inline RSC payload (each a text row), gzipped separately.
    const html = await (await fetch(href("/trainer-brain", ""))).text();
    const sections = [];
    for (let i = html.indexOf(" data-showcase="); i >= 0; i = html.indexOf(" data-showcase=", i + 1)) {
      const start = html.lastIndexOf("<section", i);
      let depth = 0,
        at = start;
      const tag = /<(\/?)section\b/g;
      tag.lastIndex = start;
      for (let m; (m = tag.exec(html)); ) {
        depth += m[1] ? -1 : 1;
        if (!depth) {
          at = m.index + "</section>".length;
          break;
        }
      }
      if (!sections.some(([s]) => s === start)) sections.push([start, at]);
    }
    const copy = sections.map(([s, e]) => html.slice(s, e)).join("");
    const flight = [...html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)].map((m) => JSON.parse(m[1])).join("");
    const rows = [];
    for (const m of flight.matchAll(/(?:^|\n)[0-9a-z]+:T([0-9a-f]+),/g)) {
      const text = Buffer.from(flight.slice(m.index + m[0].length), "utf8").subarray(0, parseInt(m[1], 16)).toString("utf8");
      if (/^<section [^>]*data-showcase=/.test(text)) rows.push(text);
    }
    const inline = JSON.stringify(rows.join("")).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
    const cost = gzipSync(copy).length + gzipSync(inline).length;
    metrics.showcaseHtml = { html: gzipSync(copy).length, rsc: gzipSync(inline).length, rows: rows.length };
    judge("/trainer-brain showcase HTML", cost <= 25 * 1024, `showcase HTML ${kb(cost)} KB gzipped (HTML ${kb(gzipSync(copy).length)} + RSC ${kb(gzipSync(inline).length)}, ${rows.length} RSC row(s); budget 25)`);
  }
});

// ---------------------------------------------------------------------------
// The open platform with Kamran's button on /.
if (stub && (want(4) || want(8) || want(10) || want(13))) {
  stub.set("assistant");
  await step(4, "open pages (with 13)", () => pagePass("open", [390], ["ltr"]));
  await step(10, "playground (open)", () => playground("10. /demo open"));
  await step(8, "Kamran", async () => {
    if (!PAGES.includes("/")) return;
    for (const viewport of [PHONE, { width: 360, height: 800 }]) {
      const label = `8. ${viewport.width}x${viewport.height}`;
      const page = await open({ viewport });
      await go(page, "/");
      const fab = page.locator(".mk-assistant-fab");
      await fab.waitFor({ timeout: 10_000 }).catch(() => {});
      for (const when of ["first frame", "on"]) {
        if (when === "on") for (const { id } of await hosts(page)) await isOn(page, id, 8000);
        await scrollTop(page);
        const hits = await page.evaluate(() => {
          const k = document.querySelector(".mk-assistant-fab")?.getBoundingClientRect();
          if (!k) return null;
          return [...document.querySelectorAll("[data-showcase] :is(button, a[href], input, select, textarea, [role=button], [role=radio], [tabindex]:not([tabindex='-1']))")]
            .filter((e) => e.checkVisibility({ opacityProperty: true, visibilityProperty: true }))
            .map((e) => [e, e.getBoundingClientRect()])
            .filter(([, r]) => r.width && r.height && r.left < k.right && r.right > k.left && r.top < k.bottom && r.bottom > k.top)
            .map(([e]) => e.tagName.toLowerCase() + "." + String(e.className).split(" ")[0]);
        });
        if (hits === null) fail(label, "Kamran's button is not shown (assistant stub)");
        else if (hits.length) fail(label, `${when}: Kamran's button meets ${hits.join(", ")}`);
        if (hits === null) break;
      }
      await close(page);
    }
  });
}

await browser.close();
for (const c of contexts) await c.close().catch(() => {});
results.seconds = Math.round(process.uptime());
const out = env.SHOWCASE_OUT ?? root + "test-results/marketing-showcase.json";
await mkdir(root + "test-results", { recursive: true });
await writeFile(out, JSON.stringify(results, null, 2));
console.log(`Results: ${out}`);
console.log(`Steps: ${Object.entries(results.checks).map(([k, ms]) => `${k} ${(ms / 1000).toFixed(0)} s`).join("; ")}`);
if (failures.length) {
  console.error(`${failures.length} failure(s):\n` + failures.map((f) => "  " + f).join("\n"));
  process.exitCode = 1;
} else console.log("Marketing showcase check passed.");
