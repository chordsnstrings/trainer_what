// Motion check for the member app (docs/features/motion.md), local Chromium
// only (never a cloud browser). At 390x844 as a touch phone with the CPU
// slowed 4x (DevTools CPU throttling), it signs in as the synthetic member
// and plays the flows that animate most: answering the analytics bar,
// switching tabs, opening a sub-page and going back, opening and closing a
// bottom sheet, rolling a stepper, logging a set, finishing a workout and
// sending a chat message. It fails when:
// - a long animation frame over 50 ms was caused by the animations (its
//   style, layout and paint time, or its animation-frame callbacks, over
//   50 ms while an animation ran; frames spent running the app's own code
//   are reported, not failed);
// - an animated element caused a layout shift;
// - a running animation (document.getAnimations(), View Transition
//   pseudo-elements included) moves anything but transform, opacity,
//   stroke-dashoffset or grid-template-rows, lasts over 420 ms (bars and
//   rings: 700 ms), or repeats without being one of the live loops;
// - the analytics bar is still in the page after an answer;
// - with prefers-reduced-motion emulated, or with the member's own "Reduce
//   motion" choice (the device cookie), any transform animation runs.
// Start it through scripts/run-motion-check.mjs (npm run test:motion), which
// seeds a fresh database and starts the production build. Results go to
// test-results/motion-check.json.
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const base = process.env.TEST_APP_URL ?? "http://localhost:3000";
const password = process.env.DEMO_PASSWORD ?? "TrainerDemo2026!";
const member = process.env.MOTION_CHECK_MEMBER ?? "sam.taylor@example.test";
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
  (existsSync("/opt/pw-browsers/chromium")
    ? "/opt/pw-browsers/chromium"
    : undefined);
const PHONE = { width: 390, height: 844 };
const CPU_SLOWDOWN = 4;
const LIMIT = 420;
const PROGRESS_LIMIT = 700;
const LONG = 50;
/** What may move (transitionProperty or keyframe properties). */
const ALLOWED = new Set([
  "transform",
  "translate",
  "scale",
  "rotate",
  "opacity",
  "stroke-dashoffset",
  "grid-template-rows",
  // A disclosure's content stays visible until it has closed (discrete).
  "content-visibility",
]);
const MOVES = new Set(["transform", "translate", "scale", "rotate"]);
/** The live loops (loading, typing, listening): the only repeats. */
const LIVE = /^motion-(shimmer|refresh|typing|breathe)$/;
/** Bars and rings may take up to PROGRESS_LIMIT. */
const PROGRESS = /motion-meter-fill|progress-ring-value/;

const failures = [];
const report = [];
const pageErrors = [];
const fail = (label, message) => failures.push(`${label}: ${message}`);

/** Runs in the page before any script: records animations, frames, shifts. */
function instrument() {
  const M = (window.__motion = { seen: [], longFrames: [], shifts: [] });
  const live = new Map();
  const kebab = (p) => p.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
  const describe = (node) => {
    if (!node || node.nodeType !== 1) return String(node?.nodeName ?? "?");
    const cls = (node.getAttribute("class") ?? "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 3)
      .join(".");
    return node.tagName.toLowerCase() + (cls ? "." + cls : "");
  };
  const sample = () => {
    const now = performance.now();
    const all = new Set([
      ...document.getAnimations(),
      ...(document.documentElement?.getAnimations?.({ subtree: true }) ?? []),
    ]);
    for (const a of all) {
      if (a.playState !== "running") continue;
      let entry = live.get(a);
      if (entry) {
        entry.last = now;
        continue;
      }
      const effect = a.effect;
      const timing = effect?.getComputedTiming?.() ?? {};
      let props = [];
      if (a.transitionProperty) props = [a.transitionProperty];
      else
        try {
          props = [
            ...new Set(
              (effect?.getKeyframes?.() ?? []).flatMap((k) =>
                Object.keys(k)
                  .filter(
                    (p) =>
                      !["offset", "easing", "composite", "computedOffset"].includes(p),
                  )
                  .map(kebab),
              ),
            ),
          ];
        } catch {
          props = ["?"];
        }
      entry = {
        name: a.animationName || a.transitionProperty || a.id || "script",
        kind: a.constructor?.name ?? "Animation",
        target: describe(effect?.target) + (effect?.pseudoElement ?? ""),
        props,
        endTime: timing.endTime,
        iterations: timing.iterations,
        first: now,
        last: now,
      };
      Object.defineProperty(entry, "node", { value: effect?.target ?? null });
      live.set(a, entry);
      M.seen.push(entry);
    }
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
  const observe = (type, fn) => {
    try {
      new PerformanceObserver((list) => list.getEntries().forEach(fn)).observe({
        type,
        buffered: true,
      });
    } catch {}
  };
  observe("long-animation-frame", (e) =>
    M.longFrames.push({
      start: e.startTime,
      duration: e.duration,
      renderStart: e.renderStart,
      styleAndLayoutStart: e.styleAndLayoutStart,
      scripts: (e.scripts ?? []).map((s) => ({
        invoker: s.invoker,
        type: s.invokerType,
        duration: s.duration,
      })),
    }),
  );
  observe("layout-shift", (e) =>
    M.shifts.push({
      start: e.startTime,
      value: e.value,
      recent: e.hadRecentInput,
      nodes: (e.sources ?? []).map((s) => s.node).filter(Boolean),
    }),
  );
  /** What happened between two moments (performance.now). */
  window.__motionReport = (from, to) => {
    const inside = (t) => t >= from && t <= to;
    const animations = M.seen.filter((a) => inside(a.first));
    // The windows in which a finite animation ran.
    const windows = animations
      .filter((a) => a.iterations !== Infinity)
      .map((a) => [a.first, a.last + 20]);
    const during = (start, end) =>
      windows.some(([a, b]) => start < b && end > a);
    const frames = M.longFrames
      .filter((f) => inside(f.start) && during(f.start, f.start + f.duration))
      .map((f) => {
        const end = f.start + f.duration;
        const render = f.renderStart ? end - f.renderStart : 0;
        const layout = f.styleAndLayoutStart ? end - f.styleAndLayoutStart : 0;
        const raf = f.scripts
          .filter((s) => /FrameRequestCallback/.test(s.invoker ?? ""))
          .reduce((n, s) => n + s.duration, 0);
        const app = f.scripts
          .filter((s) => !/FrameRequestCallback/.test(s.invoker ?? ""))
          .reduce((n, s) => n + s.duration, 0);
        return {
          duration: Math.round(f.duration),
          render: Math.round(render),
          layout: Math.round(layout),
          raf: Math.round(raf),
          app: Math.round(app),
          causedByMotion: raf > 50 || (Math.max(render, layout) > 50 && app < 16),
        };
      });
    // A shift is the animations' when a shifted node is (inside) an element
    // that was animating at that moment and no input caused it.
    const shifts = M.shifts
      .filter((s) => inside(s.start) && !s.recent && s.value > 0)
      .map((s) => {
        const moving = M.seen.filter(
          (a) =>
            a.node &&
            s.start >= a.first - 20 &&
            s.start <= a.last + 20 &&
            s.nodes.some((n) => a.node === n || a.node.contains?.(n)),
        );
        return {
          value: Number(s.value.toFixed(4)),
          by: moving.map((a) => `${a.name} on ${a.target}`),
        };
      });
    return {
      animations: animations.map(({ node, ...a }) => ({
        ...a,
        endTime: Math.round(a.endTime ?? 0),
      })),
      frames,
      shifts,
    };
  };
}

/** Plays `action`, lets it settle, and checks what moved. */
async function step(run, label, action, { settle = 900, expect } = {}) {
  const { page } = run;
  const name = `${run.name} · ${label}`;
  try {
    const from = await page.evaluate(() => performance.now());
    await action();
    await page.waitForTimeout(settle);
    const to = await page.evaluate(() => performance.now());
    const got = await page.evaluate(([a, b]) => window.__motionReport(a, b), [
      from,
      to,
    ]);
    report.push({ run: run.name, step: label, ...got });
    for (const a of got.animations) {
      const where = `${a.name} on ${a.target}`;
      // React's own zero-length settings on a View Transition (the overlay
      // collapsed so taps reach the page, an unaffected root hidden) are
      // not motion.
      if (!a.endTime && a.iterations !== Infinity) continue;
      const bad = a.props.filter((p) => !ALLOWED.has(p));
      if (bad.length) fail(name, `${where} animates ${bad.join(", ")}`);
      if (a.iterations === Infinity) {
        if (!LIVE.test(a.name)) fail(name, `${where} repeats forever`);
        continue;
      }
      const limit = PROGRESS.test(a.target) ? PROGRESS_LIMIT : LIMIT;
      if (a.endTime > limit)
        fail(name, `${where} lasts ${a.endTime} ms (limit ${limit} ms)`);
      if (run.still && a.props.some((p) => MOVES.has(p)))
        fail(name, `${where} moves with reduced motion`);
    }
    for (const f of got.frames)
      if (f.causedByMotion)
        fail(
          name,
          `a ${f.duration} ms frame during an animation (render ${f.render} ms, layout ${f.layout} ms, animation callbacks ${f.raf} ms)`,
        );
    for (const s of got.shifts)
      if (s.by.length)
        fail(name, `layout shift ${s.value} from ${s.by.join("; ")}`);
    if (expect) {
      const missing = expect(got);
      if (missing) fail(name, missing);
    }
    return got;
  } catch (e) {
    fail(name, e.message.split("\n")[0]);
    // What the screen showed, for the failure report.
    const shown = await page
      .evaluate(() =>
        (document.querySelector("#member-main")?.innerText ?? "")
          .replace(/\s+/g, " ")
          .slice(0, 300),
      )
      .catch(() => "");
    if (shown) fail(name, `the screen showed: ${shown}`);
    return null;
  }
}

const moved = (got, pattern) =>
  got.animations.some((a) => pattern.test(`${a.name} ${a.target}`));

async function signedInRun(browser, name, { reduced = false, cookie = false }) {
  const ctx = await browser.newContext({
    viewport: PHONE,
    isMobile: true,
    hasTouch: true,
    serviceWorkers: "block",
    reducedMotion: reduced ? "reduce" : "no-preference",
  });
  ctx.setDefaultNavigationTimeout(180_000);
  ctx.setDefaultTimeout(60_000);
  // Stay inside the API's normal request budget across the three runs.
  let next = 0;
  await ctx.route("**/api/v1/**", async (route) => {
    const now = Date.now(),
      wait = Math.max(0, next - now);
    next = now + wait + 400;
    if (wait) await new Promise((r) => setTimeout(r, wait));
    await route.continue().catch(() => {});
  });
  if (cookie)
    await ctx.addCookies([
      { name: "trainer_member_motion", value: "reduce", url: base },
    ]);
  const signIn = await ctx.request.post(base + "/api/v1/auth/login", {
    headers: { origin: base },
    data: { email: member, password },
    failOnStatusCode: false,
  });
  if (signIn.status() !== 200)
    throw new Error(`member sign-in answered ${signIn.status()}`);
  // A workout in progress for this run.
  const boot = await (await ctx.request.get(base + "/api/v1/bootstrap")).json();
  let workout = boot.records.find(
    (r) => r.kind === "workout" && r.status === "active",
  );
  const program = boot.records.find(
    (r) => r.kind === "program" && ["assigned", "template"].includes(r.status),
  );
  if (!workout && program) {
    const started = await ctx.request.post(base + "/api/v1/workouts/start", {
      headers: { origin: base },
      data: { programId: program.id },
      failOnStatusCode: false,
    });
    if (started.ok()) workout = await started.json();
  }
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(`${name} ${page.url()}: ${e.message}`));
  await page.addInitScript(instrument);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_SLOWDOWN });
  return { ctx, page, name, workout, still: reduced || cookie };
}

async function ready(page) {
  await page
    .waitForFunction(() => !document.querySelector(".loading-screen"), null, {
      timeout: 120_000,
    })
    .catch(() => {});
  await page.locator("#member-main").waitFor({ timeout: 120_000 });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
}

async function tapTab(page, id, path) {
  await page.locator(`.member-tabbar a[data-tab="${id}"]`).tap();
  await page.waitForURL("**" + path, { timeout: 60_000 });
  await page.locator("#member-main").waitFor();
}

async function flows(run) {
  const { page, workout } = run;
  const vt = () => page.evaluate(() => document.documentElement.dataset.vt ?? "");
  await page.goto(base + "/app", { waitUntil: "load" });
  await ready(page);
  if (run.still) {
    const attr = await page.evaluate(() =>
      document.documentElement.getAttribute("data-reduce-motion"),
    );
    if (run.name === "in-app reduce" && attr !== "on")
      fail(run.name, `<html data-reduce-motion> is ${attr}, expected "on"`);
  }
  // The analytics bar: a choice removes it from the page completely.
  const noThanks = page.getByRole("button", { name: /^No thanks$/ });
  if (await noThanks.count()) {
    await step(run, "answer analytics", () => noThanks.first().tap(), {
      settle: 800,
      expect: (got) =>
        !run.still && !moved(got, /motion-bar-out/)
          ? "the analytics bar did not slide away"
          : null,
    });
    const left = await page.locator(".consent-bar, .acquisition-consent").count();
    if (left) fail(run.name, "the analytics bar is still in the page after an answer");
  } else report.push({ run: run.name, step: "answer analytics", skipped: "no bar" });

  await step(run, "tab: programme", () => tapTab(page, "program", "/app/program"), {
    expect: (got) =>
      run.still
        ? null
        : !moved(got, /view-transition/)
          ? "no view transition between tabs"
          : !moved(got, /member-tab-icon::before/)
            ? "the tab pill did not slide"
            : null,
  });
  if (!run.still && (await vt()) !== "nav-tab")
    fail(run.name, `tab switch marked data-vt=${await vt()}`);
  await step(run, "tab: more", () => tapTab(page, "more", "/app/more"));
  await step(
    run,
    "sub-page forward",
    async () => {
      await page.locator("a.more-link[href='/app/bookings']").tap();
      await page.waitForURL("**/app/bookings");
      await page.locator("#member-main").waitFor();
    },
    {
      expect: (got) =>
        run.still || moved(got, /view-transition-new/)
          ? null
          : "the sub-page did not slide in",
    },
  );
  if (!run.still && (await vt()) !== "nav-forward")
    fail(run.name, `opening a sub-page marked data-vt=${await vt()}`);
  await step(run, "back", async () => {
    await page.locator(".member-back").tap();
    await page.waitForURL("**/app/more");
  });
  if (!run.still && (await vt()) !== "nav-back")
    fail(run.name, `going back marked data-vt=${await vt()}`);

  if (!workout) fail(run.name, "no workout to check (seed a program)");
  else {
    await page.goto(base + `/app/workouts/${workout.id}`, { waitUntil: "load" });
    await ready(page);
    await page.locator(".sticky-action-bar").waitFor();
    await page.waitForTimeout(600);
    await step(run, "open sheet", async () => {
      await page.locator(".sticky-action-bar .workout-pain").tap();
      await page.locator("dialog.bottom-sheet[open]").waitFor();
    }, {
      settle: 600,
      expect: (got) =>
        run.still || moved(got, /motion-sheet-up|motion-dialog-in/)
          ? null
          : "the sheet did not slide up",
    });
    await step(run, "close sheet", async () => {
      await page.locator("dialog.bottom-sheet[open] .bottom-sheet-close").tap();
    }, { settle: 600 });
    if (await page.locator("dialog.bottom-sheet[open]").count())
      fail(run.name, "the sheet did not close");
    await step(run, "stepper", async () => {
      await page
        .locator(".set-row:not(.is-done) .stepper-button")
        .nth(1)
        .tap();
    }, {
      settle: 500,
      expect: (got) =>
        run.still || moved(got, /stepper-ghost|stepper-input/)
          ? null
          : "the stepper number did not roll",
    });
    await step(run, "log set", async () => {
      await page.locator(".sticky-action-bar button[type=submit]").tap();
      await page.locator(".set-row.is-done").first().waitFor();
    }, {
      settle: 1200,
      expect: (got) =>
        run.still || moved(got, /motion-draw|motion-glow/)
          ? null
          : "a logged set did not confirm itself",
    });
    await step(run, "finish", async () => {
      const now = page.locator(".workout-finish button");
      if (await now.count()) await now.first().tap();
      else
        await page
          .locator(".sticky-action-bar button:not(.workout-pain)")
          .last()
          .tap();
      await page.locator(".workout-complete").waitFor({ timeout: 60_000 });
    }, {
      settle: 1500,
      expect: (got) =>
        run.still || moved(got, /progress-ring-value|motion-draw/)
          ? null
          : "no completion moment after Finish",
    });
  }

  // Display preferences: changing the appearance crossfades the page (a
  // View Transition, opacity only); "Reduce motion" stills the app at once.
  if (!run.still) {
    await page.goto(base + "/app/profile", { waitUntil: "load" });
    await ready(page);
    const dark = page.locator('input[name="appearance"][value="dark"]');
    await dark.waitFor();
    // The choice applies inside the transition's update, a frame after the
    // tap, so wait for it rather than expect it at once.
    const choose = async (input) => {
      await input.click();
      await page.waitForFunction((el) => el.checked, await input.elementHandle());
    };
    await step(run, "theme switch", () => choose(dark), {
      settle: 700,
      expect: (got) =>
        moved(got, /view-transition-new\(root\)/) &&
        got.animations
          .filter((a) => /view-transition/.test(a.target) && a.endTime)
          .every((a) => a.props.every((p) => p === "opacity"))
          ? null
          : "the theme did not crossfade (opacity only)",
    });
    await choose(page.locator('input[name="appearance"][value="light"]'));
    await page.waitForTimeout(700);
    await page.locator('input[name="motion"][value="reduce"]').check();
    const attr = await page.evaluate(() =>
      document.documentElement.getAttribute("data-reduce-motion"),
    );
    if (attr !== "on")
      fail(run.name, `"Reduce motion" set data-reduce-motion=${attr}`);
    await step(run, "tab after Reduce motion", () => tapTab(page, "today", "/app"), {
      expect: (got) =>
        got.animations.some((a) => a.endTime && a.props.some((p) => MOVES.has(p)))
          ? "something moved after choosing Reduce motion"
          : null,
    });
    await page.goto(base + "/app/profile", { waitUntil: "load" });
    await ready(page);
    await page.locator('input[name="motion"][value="system"]').check();
  }

  await page.goto(base + "/app/chat", { waitUntil: "load" });
  await ready(page);
  await page.locator(".chat-send").first().waitFor();
  const text = `Motion check ${run.name} ${Date.now().toString(36)}`;
  await page.locator("textarea").first().fill(text);
  await step(run, "send chat", async () => {
    await page.locator("button.chat-send[type=submit]").tap();
    await page.getByText(text, { exact: true }).last().waitFor({ timeout: 60_000 });
  }, {
    settle: 1200,
    expect: (got) =>
      run.still || moved(got, /motion-rise-in/)
        ? null
        : "the sent message did not slide in",
  });
}

const browser = await chromium.launch({
  headless: true,
  ...(executablePath ? { executablePath } : {}),
});
try {
  for (const [name, options] of [
    ["motion", {}],
    ["reduced (device)", { reduced: true }],
    ["in-app reduce", { cookie: true }],
  ]) {
    const run = await signedInRun(browser, name, options);
    try {
      await flows(run);
    } catch (e) {
      fail(name, e.message.split("\n")[0]);
    } finally {
      await run.ctx.close();
    }
  }
} finally {
  await browser.close();
  await mkdir("test-results", { recursive: true });
  await writeFile(
    "test-results/motion-check.json",
    JSON.stringify({ failures, pageErrors, report }, null, 2),
  );
}
const counted = report.reduce((n, r) => n + (r.animations?.length ?? 0), 0);
const appFrames = report.reduce(
  (n, r) => n + (r.frames?.filter((f) => !f.causedByMotion).length ?? 0),
  0,
);
console.log(
  `Motion check: ${report.length} steps, ${counted} animations checked, ${appFrames} long frame(s) from app work (not animations), ${failures.length} failure(s), ${pageErrors.length} page error(s).`,
);
for (const f of failures) console.log("FAIL " + f);
for (const e of pageErrors) console.log("PAGE ERROR " + e);
if (failures.length || pageErrors.length) process.exitCode = 1;
