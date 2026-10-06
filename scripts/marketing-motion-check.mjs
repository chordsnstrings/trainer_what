// The coach-to-subscriber journey player in local Chromium, at 360x740,
// 390x844 (phones, touch) and 1366x900. Run it with
// `npm run test:marketing-motion-journey` (scripts/run-marketing-motion-check.mjs
// starts the production build against a stub platform API);
// `npm run test:marketing-motion` runs it and then the sitewide check.
//
// Checks: the launch gate (no player while a coach cannot launch); the
// player is visible with no horizontal overflow; the "Illustration with
// sample data" label shows at every width; auto-play starts only when at
// least half of the stage is on screen and holds while it is not; Pause,
// Play, Previous, Next and the chapter buttons work from the keyboard, with
// the step's name, the live announcement (Previous and Next only; a chapter
// button announces itself) and focus kept on Previous or Next at either
// end; the Play/Pause icon stays visible when paused, focused or hovered; a
// mouse over the player stops the chapter clock only (the chapter's beats
// finish) and an explicit Play wins over it; the active step card is on
// screen (the cards are a carousel at every width once the island runs);
// phones show one frame at a time, swap at the crossing, keep mock text at
// 11px or more and fit the controls in one row; reduced motion shows static
// complete chapters, never auto-plays and moves nothing even after Play;
// without JavaScript every step shows and no dead controls do; no layout
// shift while chapters change (and through one full, sped-up pass that ends
// on Replay; on the home band too); stage text passes WCAG AA contrast in
// every chapter; right to left mirrors. With the
// sitewide microanimations (components/marketing/motion.tsx): the section
// reveal runs on the page but never marks the player, and the hero relay's
// ring never pulses on the journey's copy of the mark (no double motion).
import { createRequire } from "node:module";
import { existsSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const base = process.env.TEST_APP_URL ?? "http://127.0.0.1:3967";
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
  (existsSync("/opt/pw-browsers/chromium")
    ? "/opt/pw-browsers/chromium"
    : undefined);
const browser = await chromium.launch({
  headless: true,
  ...(executablePath ? { executablePath } : {}),
});
const failures = [];
const passed = [];
function fail(label, message) {
  failures.push(`${label}: ${message}`);
  console.error(`FAIL ${label}: ${message}`);
}
function check(label, ok, message) {
  if (ok) passed.push(label);
  else fail(label, message);
}
const VIEWPORTS = [
  { width: 360, height: 740, phone: true },
  { width: 390, height: 844, phone: true },
  { width: 1366, height: 900, phone: false },
];
const TITLES = [
  "Claim your address",
  "Teach your Brain",
  "Test it",
  "Create your offer",
  "Publish and share",
  "It coaches daily",
  "You correct, it learns",
  "Get paid monthly",
];

async function context(vp, { reduced = false, js = true } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    ...(vp.phone
      ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
      : {}),
    reducedMotion: reduced ? "reduce" : "no-preference",
    javaScriptEnabled: js,
  });
  // No analytics prompt over the controls.
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("analytics-preference", "declined");
    } catch {}
  });
  return ctx;
}
async function open(ctx, path) {
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const response = await page.goto(base + path, { waitUntil: "load" });
  if (!response?.ok())
    throw new Error(`${path} answered ${response?.status()}`);
  return { page, errors };
}
const walk = (page) => page.locator(".mk-walk").first();
const state = (page) => walk(page).getAttribute("data-state");
const chapter = async (page) =>
  Number(await walk(page).getAttribute("data-chapter"));
/** The chapter clock on the active segment (null under reduced motion). */
const clock = (page) =>
  page.evaluate(() => {
    const a = document
      .querySelector(".mk-walk .mk-walk-seg[aria-current] i")
      ?.getAnimations()[0];
    return a ? { time: Number(a.currentTime), play: a.playState } : null;
  });
const center = (page) =>
  page.evaluate(() =>
    document
      .querySelector(".mk-walk-stage")
      .scrollIntoView({ block: "center", behavior: "instant" }),
  );
const away = (page) =>
  page.evaluate(() =>
    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: "instant",
    }),
  );
/** The Play/Pause/Replay icon: its computed opacity and the button's name. */
const icon = (page) =>
  page.evaluate(() => {
    const b = document.querySelector(".mk-walk-play");
    const svg = b.querySelector("svg");
    return {
      label: b.getAttribute("aria-label"),
      opacity: getComputedStyle(svg).opacity,
      animation: svg
        .getAnimations()
        .map((a) => a.playState)
        .join(),
    };
  });
/**
 * The mocks' text size against their frames: the CSS computes it from the
 * viewport (no container queries), so it must match the share of each
 * frame's real width it stands for (laptop 2.4%, or 3.6% on phones;
 * phone 5.4%), with the 11px (12.5px) floor, within 4%.
 */
const frameText = (page) =>
  page.evaluate(() => {
    const walk = document.querySelector(".mk-walk");
    const phoneWidth = innerWidth <= 760;
    return [
      [".w-coach", phoneWidth ? 0.036 : 0.024, phoneWidth ? 12.5 : 11],
      [".w-phone", 0.054, 11],
    ].map(([sel, k, floor]) => {
      const frame = walk.querySelector(sel);
      const dev = frame.querySelector(".w-dev");
      const want = Math.max(floor, frame.getBoundingClientRect().width * k);
      const got = parseFloat(getComputedStyle(dev).fontSize);
      return {
        sel,
        want: Number(want.toFixed(2)),
        got: Number(got.toFixed(2)),
        ok: Math.abs(got - want) <= want * 0.04,
      };
    });
  });
/** The live region's text. */
const said = (page) =>
  page.evaluate(
    () =>
      document.querySelector(".mk-walk [aria-live]")?.textContent.trim() ?? "",
  );
/** Share of the stage inside the viewport. */
const ratio = (page) =>
  page.evaluate(() => {
    const r = document.querySelector(".mk-walk-stage").getBoundingClientRect();
    const visible = Math.max(
      0,
      Math.min(r.bottom, innerHeight) - Math.max(r.top, 0),
    );
    return r.height ? visible / r.height : 0;
  });
const overflow = (page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
/**
 * The sitewide motion around the player: whether the reveal ran on the page
 * (.mk-motion), how many reveal marks sit on or in the player's section or
 * band, and the ring animation on the laptop bar's mark and the hero relay's.
 */
const interplay = (page) =>
  page.evaluate(() => {
    const holder = document
      .querySelector(".mk-walk")
      ?.closest(".mk-walk-section, .mk-walk-band");
    const marks = "[data-mk-reveal], [data-mk-item]";
    const ring = (selector) => {
      const el = document.querySelector(selector);
      return el ? getComputedStyle(el, "::after").animationName : null;
    };
    return {
      motion: !!document.querySelector(".mk.mk-motion"),
      holder: !!holder,
      marked:
        (holder?.closest(marks) ? 1 : 0) +
        (holder?.querySelectorAll(marks).length ?? 0),
      barRing: ring(".mk-walk .w-bar .mk-relay-mark"),
      heroRing: ring(".mk-relay .mk-relay-mark"),
    };
  });
async function waitFor(page, fn, arg, timeout = 8000) {
  try {
    await page.waitForFunction(fn, arg, { timeout, polling: 50 });
    return true;
  } catch {
    return false;
  }
}
/** Starts counting layout shifts (every entry, with or without input). */
const watchShifts = (page) =>
  page.evaluate(() => {
    window.__shifts = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries())
        window.__shifts.push({
          value: e.value,
          sources: (e.sources ?? []).map(
            (s) => s.node?.className ?? s.node?.nodeName ?? "?",
          ),
        });
    }).observe({ type: "layout-shift" });
  });
const shifts = (page) =>
  page.evaluate(() => {
    const list = window.__shifts ?? [];
    return {
      total: list.reduce((n, e) => n + e.value, 0),
      list: list.slice(0, 5),
    };
  });
/**
 * Layout boxes that must never move or resize while chapters change (offsets
 * ignore transforms, which never shift layout).
 */
const boxes = (page) =>
  page.evaluate(() =>
    [
      ".mk-walk-stage",
      ".mk-walk-bar",
      ".mk-walk-steps",
      ".mk-walk-caption",
      ".mk-walk-then",
      ".w-coach",
      ".w-phone",
      ".w-wire",
    ]
      .map((s) => document.querySelector(s))
      .filter(Boolean)
      .map((el) => {
        let x = 0,
          y = 0;
        for (let n = el; n; n = n.offsetParent) {
          x += n.offsetLeft;
          y += n.offsetTop;
        }
        return [el.className, x, y, el.offsetWidth, el.offsetHeight].join(" ");
      }),
  );
/** Animations whose target is inside the player. */
const walkAnimations = (page) =>
  page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => a.effect?.target && a.effect.target.closest?.(".mk-walk"))
      .map(
        (a) =>
          `${a.effect.target.className} ${a.animationName ?? "waapi"} ${a.playState}`,
      ),
  );

/** Mock text: sizes, and WCAG AA contrast against the painted background. */
const scanText = (page, label) =>
  page.evaluate((label) => {
    const parse = (c) => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (m) {
        const [r, g, b, a = "1"] = m[1].split(/[\s,/]+/).filter(Boolean);
        return [Number(r), Number(g), Number(b), Number(a)];
      }
      const s = c.match(/color\(srgb ([^)]+)\)/);
      if (s) {
        const [r, g, b, , a = "1"] = s[1].split(/\s+/);
        return [r * 255, g * 255, b * 255, Number(a === "/" ? 1 : a)];
      }
      return [0, 0, 0, 0];
    };
    const over = (top, bottom) => {
      const a = top[3];
      return [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a)).concat(1);
    };
    const lum = ([r, g, b]) =>
      [r, g, b]
        .map((v) => v / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
        .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    const background = (el) => {
      const layers = [];
      for (let n = el; n; n = n.parentElement) {
        const s = getComputedStyle(n);
        const bg = parse(s.backgroundColor);
        if (bg[3] > 0) layers.push(bg);
        if (bg[3] >= 1) break;
        // A highlight layer painted behind the text.
        const before = getComputedStyle(n, "::before");
        if (n.classList.contains("w-hl"))
          layers.push(parse(before.backgroundColor));
      }
      return layers
        .reverse()
        .reduce((acc, l) => over(l, acc), [255, 255, 255, 1]);
    };
    const out = { low: [], small: [], scanned: 0 };
    const stage = document.querySelector(".mk-walk-stage");
    const walker = document.createTreeWalker(stage, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      if (!t.textContent.trim()) continue;
      const el = t.parentElement;
      if (
        !el.checkVisibility({
          opacityProperty: true,
          visibilityProperty: true,
          contentVisibilityAuto: true,
        })
      )
        continue;
      // Hidden by an ancestor's opacity (the frame not shown on phones).
      let hidden = false;
      for (let n = el; n && n !== stage; n = n.parentElement)
        if (
          Number(getComputedStyle(n).opacity) === 0 ||
          getComputedStyle(n).contentVisibility === "hidden"
        )
          hidden = true;
      if (hidden) continue;
      out.scanned++;
      const s = getComputedStyle(el);
      const size = parseFloat(s.fontSize);
      if (size < 11)
        out.small.push(`${t.textContent.trim().slice(0, 30)} ${size}px`);
      const fg = over(parse(s.color), background(el));
      const bg = background(el);
      const [l1, l2] = [lum(fg), lum(bg)].sort((a, b) => b - a);
      const ratio = (l1 + 0.05) / (l2 + 0.05);
      const large =
        size >= 24 || (Number(s.fontWeight) >= 700 && size >= 18.66);
      if (ratio < (large ? 3 : 4.5))
        out.low.push(
          `${label} "${t.textContent.trim().slice(0, 30)}" ${ratio.toFixed(2)}:1`,
        );
    }
    return out;
  }, label);

// ---------------------------------------------------------------------------
// 1. The launch gate is gone: the walkthrough is always shown (owner, 30
// September 2026, journeyAvailable); parts not live yet keep their chips.
const stub = globalThis.__motionPlatform;
if (stub) {
  stub.set("closed");
  const ctx = await context(VIEWPORTS[2]);
  for (const path of ["/", "/how-it-works"]) {
    const { page } = await open(ctx, path);
    const players = await page.locator(".mk-walk").count();
    check(
      `gate closed ${path}`,
      players === 1,
      `${players} player(s) while no coach can launch (always shown)`,
    );
    if (path === "/how-it-works") {
      const steps = await page.locator("#steps ol.mk-steps > li").count();
      check("gate closed steps", steps === 8, `${steps} steps`);
    }
    await page.close();
  }
  await ctx.close();
  stub.set("ready");
} else console.log("No platform stub: the launch-gate checks are skipped.");

// ---------------------------------------------------------------------------
// 2. Motion allowed, at each viewport.
for (const vp of VIEWPORTS) {
  const tag = `${vp.width}x${vp.height}`;
  const ctx = await context(vp);
  // /how-it-works: the full player.
  {
    const { page, errors } = await open(ctx, "/how-it-works");
    await walk(page).waitFor();
    await page.waitForSelector(".mk-walk[data-ready]");
    const atLoad = await ratio(page);
    await page.waitForTimeout(1200);
    const loadState = await state(page);
    check(
      `${tag} auto-play at load follows visibility`,
      atLoad >= 0.5 ? loadState === "playing" : loadState === "idle",
      `stage ${Math.round(atLoad * 100)}% visible, state ${loadState}`,
    );
    const stage = await page.locator(".mk-walk-stage").boundingBox();
    check(
      `${tag} stage visible`,
      !!stage && stage.width > 200 && stage.height > 150,
      JSON.stringify(stage),
    );
    // The honesty label shows at every width (the sample data does).
    const label = await page.evaluate(() => {
      const el = document.querySelector(".mk-walk .w-tag");
      const r = el?.getBoundingClientRect();
      return {
        text: el?.textContent,
        visible: !!el?.checkVisibility({
          opacityProperty: true,
          visibilityProperty: true,
        }),
        width: Math.round(r?.width ?? 0),
        height: Math.round(r?.height ?? 0),
        regions: document.querySelectorAll("#steps [role=region]").length,
      };
    });
    check(
      `${tag} sample-data label visible`,
      label.text === "Illustration with sample data" &&
        label.visible &&
        label.width > 0 &&
        label.height > 0,
      JSON.stringify(label),
    );
    const text = await frameText(page);
    check(
      `${tag} mock text follows the frames`,
      text.every((t) => t.ok),
      JSON.stringify(text),
    );
    check(
      `${tag} one region for the steps`,
      label.regions === 0,
      `${label.regions} inner region(s)`,
    );
    if (vp.phone)
      check(
        `${tag} square stage`,
        Math.abs(stage.width - stage.height) <= 2,
        `${stage.width}x${stage.height}`,
      );
    check(
      `${tag} no horizontal overflow`,
      (await overflow(page)) <= 0,
      `${await overflow(page)}px wider than the viewport`,
    );
    // Auto-play only in view; it holds out of view and resumes.
    await away(page);
    await page.waitForTimeout(400);
    const out1 = await clock(page);
    await page.waitForTimeout(700);
    const out2 = await clock(page);
    check(
      `${tag} holds out of view`,
      !out1 || (out2.play !== "running" && out1.time === out2.time),
      `clock ${JSON.stringify(out1)} then ${JSON.stringify(out2)}`,
    );
    await center(page);
    const resumed = await waitFor(
      page,
      () => document.querySelector(".mk-walk")?.dataset.state === "playing",
    );
    const in1 = await clock(page);
    await page.waitForTimeout(600);
    const in2 = await clock(page);
    check(
      `${tag} plays in view`,
      resumed && in2?.play === "running" && in2.time > in1.time,
      `state ${await state(page)}, clock ${JSON.stringify(in1)} then ${JSON.stringify(in2)}`,
    );
    // Phones: one frame at a time, the strip, controls in one row, 11px text.
    if (vp.phone) {
      const layout = await page.evaluate(() => {
        const shown = [".w-coach", ".w-phone"].map((s) =>
          Number(getComputedStyle(document.querySelector(s)).opacity),
        );
        const bar = [...document.querySelectorAll(".mk-walk-bar button")].map(
          (b) => b.getBoundingClientRect(),
        );
        return {
          shown,
          chips: [...document.querySelectorAll(".w-chip")].map(
            (c) => getComputedStyle(c).display,
          ),
          tops: [...new Set(bar.map((r) => Math.round(r.top)))],
          small: bar.filter((r) => r.width < 24 || r.height < 24).length,
          right: Math.max(...bar.map((r) => r.right)),
          width: document.documentElement.clientWidth,
        };
      });
      check(
        `${tag} one frame at rest`,
        layout.shown.filter((o) => o === 1).length === 1,
        `opacities ${layout.shown}`,
      );
      check(
        `${tag} strip chips`,
        layout.chips.every((d) => d !== "none"),
        layout.chips.join(),
      );
      check(
        `${tag} controls in one row`,
        layout.tops.length === 1 &&
          layout.small === 0 &&
          layout.right <= layout.width,
        JSON.stringify(layout),
      );
    }
    // Keyboard: focus stops auto-play; Enter plays; Space pauses.
    await watchShifts(page);
    const before = await boxes(page);
    const play = page.locator(".mk-walk-play").first();
    await play.focus();
    check(
      `${tag} keyboard focus stops auto-play`,
      (await state(page)) === "paused",
      `state ${await state(page)}`,
    );
    await page.waitForTimeout(400);
    const focusedIcon = await icon(page);
    check(
      `${tag} Play icon visible while focused`,
      focusedIcon.opacity === "1",
      JSON.stringify(focusedIcon),
    );
    check(
      `${tag} button reads Play`,
      (await play.getAttribute("aria-label")) === "Play",
      await play.getAttribute("aria-label"),
    );
    await page.keyboard.press("Enter");
    check(
      `${tag} Enter plays`,
      (await state(page)) === "playing",
      `state ${await state(page)}`,
    );
    await page.waitForTimeout(300);
    await page.keyboard.press(" ");
    // A pause settles on the next frame.
    await page.waitForTimeout(150);
    const paused1 = await clock(page);
    await page.waitForTimeout(500);
    const paused2 = await clock(page);
    const running = await page.evaluate(
      () =>
        document
          .querySelector(".mk-walk-view")
          .getAnimations({ subtree: true })
          .filter((a) => a.playState === "running").length,
    );
    check(
      `${tag} Space pauses everything`,
      (await state(page)) === "paused" &&
        paused1.time === paused2.time &&
        running === 0,
      `state ${await state(page)}, clock ${JSON.stringify(paused1)}/${JSON.stringify(paused2)}, ${running} running`,
    );
    const pausedIcon = await icon(page);
    check(
      `${tag} Play icon visible while paused`,
      pausedIcon.opacity === "1" && pausedIcon.label === "Play",
      JSON.stringify(pausedIcon),
    );
    // Chapters: Tab reaches the current chapter; arrows, Home and End move
    // and select; the name is the step; the change is announced.
    const c0 = await chapter(page);
    await page.keyboard.press("Tab");
    // Previous step: focusable at the first step too (aria-disabled).
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      return {
        current: el?.getAttribute("aria-current"),
        seg: el?.dataset.seg,
      };
    });
    check(
      `${tag} Tab reaches the current chapter`,
      focused.current === "step" && Number(focused.seg) === c0 - 1,
      JSON.stringify(focused),
    );
    await page.keyboard.press("Home");
    check(
      `${tag} Home`,
      (await chapter(page)) === 1,
      `chapter ${await chapter(page)}`,
    );
    const saidBefore = await said(page);
    await page.keyboard.press("ArrowRight");
    const two = await page.evaluate(() => ({
      chapter: document.querySelector(".mk-walk").dataset.chapter,
      focus: document.activeElement?.dataset.seg,
      current: document.querySelector(".mk-walk [aria-current]")?.dataset.seg,
      said: document.querySelector(".mk-walk [aria-live]")?.textContent.trim(),
      run: document.querySelector(".mk-walk").hasAttribute("data-run"),
    }));
    // The focused chapter button names the step; the live region stays
    // quiet, so the step is read once.
    check(
      `${tag} ArrowRight selects the next step`,
      two.chapter === "2" &&
        two.focus === "1" &&
        two.current === "1" &&
        two.said === saidBefore &&
        two.run,
      JSON.stringify(two),
    );
    const beats = await page.evaluate(
      () =>
        document.querySelector(".mk-walk-view").getAnimations({ subtree: true })
          .length,
    );
    check(`${tag} the chapter's beats play`, beats > 0, `${beats} animations`);
    // Phones: the frames swap at the crossing (coach first, then phone).
    if (vp.phone) {
      await page.waitForTimeout(300);
      const early = await page.evaluate(() =>
        [".w-coach", ".w-phone"].map((s) =>
          Number(getComputedStyle(document.querySelector(s)).opacity),
        ),
      );
      await page.waitForTimeout(3300);
      const late = await page.evaluate(() =>
        [".w-coach", ".w-phone"].map((s) =>
          Number(getComputedStyle(document.querySelector(s)).opacity),
        ),
      );
      check(
        `${tag} frames swap at the crossing`,
        early[0] === 1 && early[1] === 0 && late[0] === 0 && late[1] === 1,
        `early ${early}, late ${late}`,
      );
    }
    await page.keyboard.press("End");
    check(
      `${tag} End`,
      (await chapter(page)) === 8,
      `chapter ${await chapter(page)}`,
    );
    const name = await page.evaluate(() => {
      const b = document.querySelector(".mk-walk [aria-current]");
      return b
        .getAttribute("aria-labelledby")
        .split(" ")
        .map((id) => document.getElementById(id).textContent)
        .join(" ");
    });
    check(
      `${tag} chapter buttons are named by their step`,
      name === "08 Get paid monthly",
      name,
    );
    await page.keyboard.press("ArrowLeft");
    check(
      `${tag} ArrowLeft`,
      (await chapter(page)) === 7,
      `chapter ${await chapter(page)}`,
    );
    // Previous and Next: announced, and at the last step Next keeps focus
    // (aria-disabled, not disabled) and does nothing more.
    await page.locator(".mk-walk [aria-label='Next step']").focus();
    await page.keyboard.press("Enter");
    const atEnd = await page.evaluate(() => ({
      focus: document.activeElement?.getAttribute("aria-label"),
      disabled: document.activeElement?.getAttribute("aria-disabled"),
      said: document.querySelector(".mk-walk [aria-live]")?.textContent.trim(),
    }));
    check(
      `${tag} Next step`,
      (await chapter(page)) === 8 &&
        atEnd.said === TITLES[7] &&
        atEnd.focus === "Next step" &&
        atEnd.disabled === "true",
      `chapter ${await chapter(page)}, ${JSON.stringify(atEnd)}`,
    );
    await page.keyboard.press("Enter");
    check(
      `${tag} Next at the last step stays put`,
      (await chapter(page)) === 8,
      `chapter ${await chapter(page)}`,
    );
    await page.locator(".mk-walk [aria-label='Previous step']").focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    check(
      `${tag} Previous step`,
      (await chapter(page)) === 6 && (await said(page)) === TITLES[5],
      `chapter ${await chapter(page)}, said ${await said(page)}`,
    );
    // The active step card is on screen: in the carousel's view, and the
    // carousel is a keyboard stop only while it scrolls.
    const card = await page.evaluate(() => {
      const sc = document.querySelector(".mk-walk-steps");
      const li = sc.querySelector("[data-step='6']").getBoundingClientRect();
      const box = sc.getBoundingClientRect();
      const scrolls = sc.scrollWidth > sc.clientWidth + 1;
      return {
        inView:
          li.left >= box.left - 1 &&
          li.right <= box.right + 1 &&
          li.left >= -1 &&
          li.right <= innerWidth + 1,
        scrolls,
        tab: sc.getAttribute("tabindex"),
      };
    });
    await page.waitForTimeout(700); // the smooth scroll settles
    const card2 = await page.evaluate(() => {
      const sc = document.querySelector(".mk-walk-steps");
      const li = sc.querySelector("[data-step='6']").getBoundingClientRect();
      const box = sc.getBoundingClientRect();
      return (
        li.left >= Math.max(box.left, 0) - 1 &&
        li.right <= Math.min(box.right, innerWidth) + 1
      );
    });
    check(
      `${tag} the active step card is in view`,
      card2 && card.scrolls && card.tab === "0",
      JSON.stringify({ ...card, settled: card2 }),
    );
    // Every chapter by keyboard, letting each play: nothing moves or resizes.
    await page.locator(".mk-walk [aria-current]").focus();
    await page.keyboard.press("Home");
    for (let i = 1; i < 8; i++) {
      await page.waitForTimeout(vp.phone ? 250 : 600);
      await page.keyboard.press("ArrowRight");
    }
    await page.waitForTimeout(5200);
    const after = await boxes(page);
    const moved = before.filter((b, i) => b !== after[i]);
    const cls = await shifts(page);
    check(
      `${tag} no layout shift while chapters change`,
      cls.total < 0.001 && moved.length === 0,
      `CLS ${cls.total.toFixed(4)} ${JSON.stringify(cls.list)}; moved ${moved.join(" | ")} -> ${after.join(" | ")}`,
    );
    const lingering = await page.evaluate(
      () =>
        document
          .querySelector(".mk-walk-view")
          .getAnimations({ subtree: true })
          .filter(
            (a) =>
              a.playState === "running" ||
              (a.effect?.getComputedTiming().iterations ?? 1) === Infinity,
          ).length,
    );
    check(
      `${tag} beats are one-off`,
      lingering === 0,
      `${lingering} still running 5 s after the last chapter change`,
    );
    check(
      `${tag} no overflow after chapters`,
      (await overflow(page)) <= 0,
      `${await overflow(page)}px`,
    );
    const around = await interplay(page);
    check(
      `${tag} sitewide reveal leaves the player alone`,
      around.motion && around.holder && around.marked === 0,
      JSON.stringify(around),
    );
    check(
      `${tag} the bar's mark does not pulse`,
      around.barRing === "none",
      JSON.stringify(around),
    );
    check(`${tag} no page errors`, errors.length === 0, errors.join(" | "));
    await page.close();
  }
  // The home band: compact, starts only in view.
  {
    const { page, errors } = await open(ctx, "/");
    await walk(page).waitFor();
    await page.waitForSelector(".mk-walk[data-ready]");
    const atLoad = await ratio(page);
    await page.waitForTimeout(1200);
    const s0 = await state(page);
    check(
      `${tag} home: auto-play at load follows visibility`,
      atLoad >= 0.5 ? s0 === "playing" : s0 === "idle",
      `stage ${Math.round(atLoad * 100)}% visible, state ${s0}`,
    );
    await center(page);
    const started = await waitFor(
      page,
      () => document.querySelector(".mk-walk")?.dataset.state === "playing",
    );
    check(
      `${tag} home: plays once in view`,
      started,
      `state ${await state(page)}`,
    );
    const text = await page.evaluate(() =>
      document.querySelector(".mk-walk-stage").textContent.trim(),
    );
    // Real words in the sample screens (owner, 6 October 2026).
    check(
      `${tag} home: the stage shows the sample screens' words`,
      text.includes("Your page") && text.includes("Layla Strength"),
      JSON.stringify(text.slice(0, 60)),
    );
    const caption = await page.locator(".mk-walk-caption").textContent();
    check(
      `${tag} home: caption is the active step`,
      caption === TITLES[(await chapter(page)) - 1],
      caption,
    );
    // What the step means for the subscriber, under the title; changing
    // chapters moves nothing.
    await watchShifts(page);
    const homeBefore = await boxes(page);
    await page.locator(".mk-walk [aria-current]").focus();
    await page.keyboard.press("Home");
    const lines = new Set();
    for (let i = 0; i < 8; i++) {
      if (i) await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(120);
      lines.add(
        await page.evaluate(
          () => document.querySelector(".mk-walk-then")?.textContent ?? "",
        ),
      );
    }
    const homeAfter = await boxes(page);
    const homeShift = await shifts(page);
    check(
      `${tag} home: each step's subscriber line`,
      lines.size === 8 &&
        [...lines].every((l) => l.startsWith("Your subscriber: ")),
      JSON.stringify([...lines].slice(0, 3)),
    );
    check(
      `${tag} home: no layout shift while chapters change`,
      homeShift.total < 0.001 && homeBefore.join("|") === homeAfter.join("|"),
      `CLS ${homeShift.total.toFixed(4)}; ${homeBefore.join(" | ")} -> ${homeAfter.join(" | ")}`,
    );
    const homeText = await frameText(page);
    check(
      `${tag} home: mock text follows the frames`,
      homeText.every((t) => t.ok),
      JSON.stringify(homeText),
    );
    check(
      `${tag} home: no horizontal overflow`,
      (await overflow(page)) <= 0,
      `${await overflow(page)}px`,
    );
    const around = await interplay(page);
    check(
      `${tag} home: sitewide reveal leaves the band alone`,
      around.motion && around.holder && around.marked === 0,
      JSON.stringify(around),
    );
    check(
      `${tag} home: the hero relay keeps its ring`,
      around.heroRing === "mk-ring",
      JSON.stringify(around),
    );
    check(
      `${tag} home: no page errors`,
      errors.length === 0,
      errors.join(" | "),
    );
    await page.close();
  }
  await ctx.close();
}

// ---------------------------------------------------------------------------
// 3. One full pass (sped up 20x through the Animation domain): every
// chapter in order, then it stops on Replay; no layout shift throughout.
{
  const ctx = await context(VIEWPORTS[2]);
  const { page } = await open(ctx, "/how-it-works");
  await page.waitForSelector(".mk-walk[data-ready]");
  await center(page);
  await waitFor(
    page,
    () => document.querySelector(".mk-walk")?.dataset.state === "playing",
  );
  await watchShifts(page);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Animation.enable");
  await cdp.send("Animation.setPlaybackRate", { playbackRate: 20 });
  await page.evaluate(() => {
    window.__seen = [];
    new MutationObserver(() => {
      const c = document.querySelector(".mk-walk").dataset.chapter;
      if (window.__seen.at(-1) !== c) window.__seen.push(c);
    }).observe(document.querySelector(".mk-walk"), {
      attributes: true,
      attributeFilter: ["data-chapter"],
    });
  });
  const ended = await waitFor(
    page,
    () => document.querySelector(".mk-walk")?.dataset.state === "ended",
    undefined,
    20_000,
  );
  await page.waitForTimeout(1000);
  const seen = await page.evaluate(() => window.__seen);
  const label = await page.locator(".mk-walk-play").getAttribute("aria-label");
  const cls = await shifts(page);
  check(
    "1366 full pass",
    ended &&
      seen.join() === "2,3,4,5,6,7,8" &&
      label === "Replay" &&
      (await chapter(page)) === 8 &&
      cls.total < 0.001,
    `ended ${ended}, chapters ${seen}, button ${label}, CLS ${cls.total.toFixed(4)} ${JSON.stringify(cls.list)}`,
  );
  await cdp.send("Animation.setPlaybackRate", { playbackRate: 1 });
  await page.close();
  await ctx.close();
}

// ---------------------------------------------------------------------------
// 3b. The mouse (1366): an explicit Play wins over the pointer resting on the
// player; a pointer that comes back stops only the chapter clock, so the
// chapter's beats finish (nothing freezes half-drawn); the Play/Pause icon
// stays visible throughout.
{
  const ctx = await context(VIEWPORTS[2]);
  const { page, errors } = await open(ctx, "/how-it-works");
  await page.waitForSelector(".mk-walk[data-ready]");
  await center(page);
  await waitFor(
    page,
    () => document.querySelector(".mk-walk")?.dataset.state === "playing",
  );
  const held = () =>
    page.evaluate(() =>
      document.querySelector(".mk-walk").hasAttribute("data-hold"),
    );
  // Choose chapter 3 with the mouse (the player pauses), then Play with the
  // mouse; the pointer stays over the player.
  await page.locator('.mk-walk [data-seg="2"]').click();
  check(
    "1366 mouse: a chapter button pauses",
    (await state(page)) === "paused" && (await chapter(page)) === 3,
    `state ${await state(page)}, chapter ${await chapter(page)}`,
  );
  await page.locator(".mk-walk-play").click();
  await page.waitForTimeout(150);
  const p1 = await clock(page);
  await page.waitForTimeout(700);
  const p2 = await clock(page);
  const playIcon = await icon(page);
  check(
    "1366 mouse: Play wins over the pointer on the player",
    (await state(page)) === "playing" &&
      !(await held()) &&
      p2?.play === "running" &&
      p2.time > p1.time &&
      playIcon.opacity === "1" &&
      playIcon.label === "Pause",
    `state ${await state(page)}, hold ${await held()}, clock ${JSON.stringify(p1)} then ${JSON.stringify(p2)}, icon ${JSON.stringify(playIcon)}`,
  );
  // Away and back, early in a fresh chapter: the clock stops, the beats go on.
  await page.locator('.mk-walk [data-seg="1"]').click();
  await page.locator(".mk-walk-play").click();
  await page.mouse.move(4, 4);
  await page.waitForTimeout(150);
  const stageBox = await page.locator(".mk-walk-stage").boundingBox();
  await page.mouse.move(
    stageBox.x + stageBox.width / 2,
    stageBox.y + stageBox.height / 2,
    { steps: 2 },
  );
  // Chapter 2's last beat ends 4.48 s after the chapter starts.
  await page.waitForTimeout(4700);
  const h1 = await clock(page);
  await page.waitForTimeout(500);
  const h2 = await clock(page);
  const beats = await page.evaluate(() =>
    document
      .querySelector(".mk-walk-view")
      .getAnimations({ subtree: true })
      .map((a) => a.playState),
  );
  const hoverIcon = await icon(page);
  check(
    "1366 mouse: hover stops the clock, not the beats",
    (await chapter(page)) === 2 &&
      (await state(page)) === "playing" &&
      !(await held()) &&
      h1?.time === h2?.time &&
      h2?.play !== "running" &&
      beats.length > 0 &&
      beats.every((b) => b === "finished") &&
      hoverIcon.opacity === "1",
    `chapter ${await chapter(page)}, state ${await state(page)}, hold ${await held()}, clock ${JSON.stringify(h1)}/${JSON.stringify(h2)}, beats ${[...new Set(beats)]} (${beats.length}), icon ${JSON.stringify(hoverIcon)}`,
  );
  // The pointer leaves: the clock runs on.
  await page.mouse.move(4, 4);
  await page.waitForTimeout(300);
  const l1 = await clock(page);
  await page.waitForTimeout(500);
  const l2 = await clock(page);
  check(
    "1366 mouse: the clock resumes when the pointer leaves",
    l2?.play === "running" && l2.time > l1.time,
    `clock ${JSON.stringify(l1)} then ${JSON.stringify(l2)}`,
  );
  check("1366 mouse: no page errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

// ---------------------------------------------------------------------------
// 4. Reduced motion: static complete chapters, no auto-play, nothing moves.
for (const vp of VIEWPORTS) {
  const tag = `${vp.width}x${vp.height} reduced`;
  const ctx = await context(vp, { reduced: true });
  const { page } = await open(ctx, "/how-it-works");
  await page.waitForSelector(".mk-walk[data-ready]");
  await center(page);
  await page.waitForTimeout(2500);
  const idle = await page.evaluate(() => {
    const w = document.querySelector(".mk-walk");
    return {
      state: w.dataset.state,
      chapter: w.dataset.chapter,
      run: w.hasAttribute("data-run"),
    };
  });
  check(
    `${tag}: no auto-play`,
    idle.state === "idle" && idle.chapter === "1" && !idle.run,
    JSON.stringify(idle),
  );
  check(
    `${tag}: nothing animates`,
    (await walkAnimations(page)).length === 0,
    (await walkAnimations(page)).join(" | "),
  );
  const play = page.locator(".mk-walk-play").first();
  await play.focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  const moving = await walkAnimations(page);
  const fill = await page.evaluate(
    () =>
      getComputedStyle(document.querySelector(".mk-walk [aria-current] i"))
        .scale,
  );
  check(
    `${tag}: Play moves nothing`,
    (await state(page)) === "playing" &&
      moving.length === 0 &&
      (fill === "1" || fill === "1 1"),
    `state ${await state(page)}, ${moving.join(" | ")}, fill ${fill}`,
  );
  // The slideshow still advances (sped up), with instant cuts.
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Animation.enable");
  await cdp.send("Animation.setPlaybackRate", { playbackRate: 20 });
  const advanced = await waitFor(
    page,
    () => document.querySelector(".mk-walk").dataset.chapter !== "1",
    undefined,
    5000,
  );
  await cdp.send("Animation.setPlaybackRate", { playbackRate: 1 });
  check(
    `${tag}: Play advances the chapters`,
    advanced,
    `chapter ${await chapter(page)}`,
  );
  // Chapters switch instantly and show their complete picture; stage text
  // passes AA in each (both sides on phones).
  await page.locator(".mk-walk [aria-current]").focus();
  await page.keyboard.press("Home");
  const low = [],
    small = [];
  let scanned = 0;
  for (let c = 1; c <= 8; c++) {
    if (c > 1) await page.keyboard.press("ArrowRight");
    const scene = await page.evaluate(
      (c) =>
        [...document.querySelectorAll(`.mk-walk [data-s="${c}"]`)].map(
          (s) => getComputedStyle(s).opacity,
        ),
      c,
    );
    if (!scene.every((o) => o === "1"))
      fail(`${tag}: chapter ${c} instant`, `scene opacities ${scene}`);
    for (const side of vp.phone ? ["coach", "phone"] : [""]) {
      if (side)
        await page.evaluate(
          (s) => (document.querySelector(".mk-walk").dataset.end = s),
          side,
        );
      const r = await scanText(page, `c${c}${side}`);
      low.push(...r.low);
      small.push(...r.small);
      scanned += r.scanned;
    }
  }
  check(
    `${tag}: stage text AA contrast (${scanned} scanned)`,
    low.length === 0 && scanned > 100,
    low.slice(0, 6).join(" | "),
  );
  check(
    `${tag}: stage text at least 11px`,
    small.length === 0,
    small.slice(0, 6).join(" | "),
  );
  check(
    `${tag}: nothing animated after the chapters`,
    (await walkAnimations(page)).length === 0,
    (await walkAnimations(page)).join(" | "),
  );
  await page.close();
  await ctx.close();
}

// ---------------------------------------------------------------------------
// 5. Without JavaScript: every step, chapter 1 complete, no dead controls.
for (const vp of [VIEWPORTS[1], VIEWPORTS[2]]) {
  const tag = `${vp.width}x${vp.height} no JS`;
  const ctx = await context(vp, { js: false });
  const page = await ctx.newPage();
  await page.goto(base + "/how-it-works");
  const r = await page.evaluate(() => ({
    steps: [...document.querySelectorAll("#steps ol.mk-steps > li h3")].map(
      (h) => h.textContent,
    ),
    bar: getComputedStyle(document.querySelector(".mk-walk-bar")).display,
    scene: [...document.querySelectorAll('.mk-walk [data-s="1"]')].map(
      (s) => getComputedStyle(s).opacity,
    ),
    hidden: [...document.querySelectorAll("#steps ol.mk-steps > li")].filter(
      (li) => !li.checkVisibility(),
    ).length,
  }));
  check(
    `${tag}: every step`,
    r.steps.join("|") === TITLES.join("|") && r.hidden === 0,
    JSON.stringify(r.steps),
  );
  check(`${tag}: no controls`, r.bar === "none", `bar display ${r.bar}`);
  check(
    `${tag}: chapter 1 complete`,
    r.scene.every((o) => o === "1"),
    `opacities ${r.scene}`,
  );
  await ctx.close();
}

// ---------------------------------------------------------------------------
// 5b. Phones: a horizontal swipe on the stage changes the chapter (and a
// vertical one scrolls the page instead).
{
  const vp = VIEWPORTS[1];
  const ctx = await context(vp);
  const { page } = await open(ctx, "/how-it-works");
  await page.waitForSelector(".mk-walk[data-ready]");
  await center(page);
  const box = await page.locator(".mk-walk-stage").boundingBox();
  const y = box.y + box.height / 2;
  const swipe = async (dx, dy = 0) => {
    await page.mouse.move(box.x + box.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + dx / 2, y + dy / 2, {
      steps: 4,
    });
    await page.mouse.move(box.x + box.width / 2 + dx, y + dy, { steps: 4 });
    await page.mouse.up();
  };
  const c0 = await chapter(page);
  await swipe(-120);
  const c1 = await chapter(page);
  await swipe(120);
  const c2 = await chapter(page);
  await swipe(-10, 80);
  const c3 = await chapter(page);
  check(
    "390x844 swipe",
    c1 === c0 + 1 && c2 === c0 && c3 === c0 && (await state(page)) === "paused",
    `chapters ${c0} -> ${c1} -> ${c2} -> ${c3}, state ${await state(page)}`,
  );
  await ctx.close();
}

// ---------------------------------------------------------------------------
// 6. Right to left: the player mirrors (coach at the inline start) and the
// arrow keys follow the reading direction.
for (const vp of [VIEWPORTS[1], VIEWPORTS[2]]) {
  const tag = `${vp.width}x${vp.height} rtl`;
  const ctx = await context(vp, { reduced: true });
  const { page, errors } = await open(ctx, "/how-it-works?lang=ar");
  await page.waitForSelector(".mk-walk[data-ready]");
  await center(page);
  const m = await page.evaluate((phone) => {
    const mid = (s) => {
      const r = document.querySelector(s).getBoundingClientRect();
      return r.left + r.width / 2;
    };
    return {
      dir: document.documentElement.dir,
      coach: mid(phone ? ".w-cc" : ".w-coach"),
      phone: mid(phone ? ".w-pc" : ".w-phone"),
    };
  }, vp.phone);
  check(
    `${tag}: mirrored`,
    m.dir === "rtl" && m.coach > m.phone,
    JSON.stringify(m),
  );
  await page.locator(".mk-walk [aria-current]").focus();
  await page.keyboard.press("ArrowLeft");
  check(
    `${tag}: ArrowLeft goes forward`,
    (await chapter(page)) === 2,
    `chapter ${await chapter(page)}`,
  );
  check(
    `${tag}: no horizontal overflow`,
    (await overflow(page)) <= 0,
    `${await overflow(page)}px`,
  );
  check(`${tag}: no page errors`, errors.length === 0, errors.join(" | "));
  await ctx.close();
}

await browser.close();
console.log(
  `marketing motion: ${passed.length} checks passed, ${failures.length} failed`,
);
if (failures.length) {
  for (const f of failures) console.error(" - " + f);
  process.exitCode = 1;
}
