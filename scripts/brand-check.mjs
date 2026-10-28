// trainsyou identity check (local Chromium only; never a cloud browser).
//
// Visits public marketing pages, sign-in pages, the directory and the
// trainer and Super admin workspace in light and dark colour schemes at
// 390px and 1440px, and fails on horizontal overflow, a missing or wrong
// lockup, text below WCAG AA contrast against its actual background, a
// missing trainsyou favicon, or page errors. Public platform pages are
// always light (28 September 2026): white canvas, the ink lockup, one white
// theme-color and no dark surface in either device scheme; the workspace
// keeps the white lockup in dark mode. Marketing pages start at the header
// logo's edge (one shared container); a Brain showcase's ink stage is the
// one dark surface allowed ([data-showcase]). The home page also gets a
// first screen pass as a new visitor sees it (the analytics notice in its
// default state; an automated browser, so the hero field is its still
// frame): at 1440x900 the H1, the primary action and the field's lanes on
// the first screen; at 390x844 the H1, and Noura's words, the STOP stamp and
// the Paused lane above y 770 (docs/marketing-revamp-2026-10-26/phase1/
// PLAN.md §4.3); the notice covers none of them; after a scroll the
// analytics bar is slim with 48 px controls and covers nothing at the end of
// the page; after an answer, No thanks or Close, no analytics control floats,
// after a reload too), and a reduced-motion, animation, right-to-left and
// word-count pass (the word budget and H2 cap of §4.3; the field still, the
// primary action's arrow nudging once; the reduced-motion pass follows the
// marketing motion switch, data-mk-motion on the marketing root,
// components/marketing/motion-mode.ts: with "always" the arrow nudges under
// reduced motion exactly as without it; with "device" nothing animates; the
// field mirrors right to left). It
// also checks that a subscriber's member app and a coach website show their
// trainer's branding, never the platform's, follow the device into dark mode
// with every text at AA, and set the trainer's browser colour for each
// scheme (docs/features/dark-mode.md; scripts/dark-check.mjs covers every
// member screen at phone size). Start it through
// scripts/run-brand-check.mjs, which seeds data and starts the servers.
import { createRequire } from "node:module";
import { existsSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const base = process.env.TEST_APP_URL ?? "http://localhost:3000";
const password = process.env.DEMO_PASSWORD ?? "TrainerDemo2026!";
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
  (existsSync("/opt/pw-browsers/chromium")
    ? "/opt/pw-browsers/chromium"
    : undefined);
const VIEWPORTS = [
  { name: "390px", width: 390, height: 844 },
  { name: "1440px", width: 1440, height: 1000 },
];
const SCHEMES = ["light", "dark"];
const PUBLIC_ROUTES = [
  "/",
  "/how-it-works",
  "/trainer-brain",
  "/pricing",
  "/features",
  "/follower-calculator",
  "/about",
  "/get-started",
  "/coaches",
  "/login",
  "/signup",
];
const WORKSPACE_ROUTES = [
  "/trainer",
  "/trainer/brain",
  "/trainer/subscribers",
  "/trainer/design",
  "/trainer/settings",
  "/admin",
  "/admin/settings",
];

const failures = [];
const checked = [];
const pageErrors = [];
const fail = (label, message) => failures.push(`${label}: ${message}`);

const browser = await chromium.launch({
  headless: true,
  ...(executablePath ? { executablePath } : {}),
});

async function context(viewport, colorScheme, reducedMotion = "no-preference") {
  const ctx = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    colorScheme,
    reducedMotion,
  });
  ctx.setDefaultNavigationTimeout(180_000);
  ctx.setDefaultTimeout(60_000);
  // Stay inside the API's normal request budget.
  let next = 0;
  await ctx.route("**/api/v1/**", async (route) => {
    const now = Date.now(),
      wait = Math.max(0, next - now);
    next = now + wait + 400;
    if (wait) await new Promise((r) => setTimeout(r, wait));
    await route.continue().catch(() => {});
  });
  ctx.on("page", (page) =>
    page.on("pageerror", (e) => pageErrors.push(`${page.url()}: ${e.message}`)),
  );
  return ctx;
}

async function settle(page) {
  await page
    .waitForFunction(() => !document.querySelector(".loading-screen"), null, {
      timeout: 90_000,
    })
    .catch(() => {});
  await page.locator("h1").first().waitFor({ timeout: 90_000 });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(300);
}
async function visit(page, path) {
  await page.goto(base + path, { waitUntil: "load" });
  await settle(page);
}
/**
 * Marketing pages reveal their lower sections as they scroll into view
 * (components/marketing/motion.tsx): scroll through once so the contrast
 * pass reads every section, and report any that never appeared.
 */
async function revealAll(page) {
  return page.evaluate(async () => {
    if (!document.querySelector(".mk")) return 0;
    const pause = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let y = 0; y <= document.documentElement.scrollHeight; y += Math.max(200, innerHeight - 100)) {
      scrollTo(0, y);
      await pause(80);
    }
    scrollTo(0, 0);
    await pause(700);
    return document.querySelectorAll("[data-mk-reveal='pending']").length;
  });
}
async function signIn(page, email) {
  await visit(page, "/login");
  await page.waitForFunction(() => {
    const form = document.querySelector("form");
    return !!form && Object.keys(form).some((k) => k.startsWith("__react"));
  });
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/(trainer|app)(\/|$)/, { timeout: 120_000 });
  await settle(page);
}

/** Overflow, the visible logo, the favicon and a text contrast scan. */
function measure(page) {
  return page.evaluate(() => {
    const parse = (c) => {
      // color-mix() and relative colours compute to color(srgb r g b / a), 0–1.
      const srgb = c.match(/color\(srgb ([^)]+)\)/);
      if (srgb) {
        const [r, g, b, a = 1] = srgb[1].split(/[ /]+/).filter(Boolean).map(Number);
        return { r: r * 255, g: g * 255, b: b * 255, a };
      }
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return { r, g, b, a };
    };
    const lum = ({ r, g, b }) => {
      const f = (v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (a, b) => {
      const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
      return (x + 0.05) / (y + 0.05);
    };
    const blend = (top, under) => ({
      r: top.r * top.a + under.r * (1 - top.a),
      g: top.g * top.a + under.g * (1 - top.a),
      b: top.b * top.a + under.b * (1 - top.a),
      a: 1,
    });
    /** The colour behind an element, or null over an image or gradient. */
    const backdrop = (el) => {
      const layers = [];
      for (let n = el; n; n = n.parentElement) {
        const s = getComputedStyle(n);
        if (s.backgroundImage !== "none") return null;
        const c = parse(s.backgroundColor);
        if (c && c.a > 0) {
          layers.push(c);
          if (c.a >= 1) break;
        }
      }
      let color = { r: 255, g: 255, b: 255, a: 1 };
      const rootBg = parse(getComputedStyle(document.documentElement).backgroundColor);
      if (rootBg && rootBg.a > 0) color = rootBg;
      for (const layer of layers.reverse()) color = blend(layer, color);
      return color;
    };
    const low = [];
    let scanned = 0;
    for (const el of document.body.querySelectorAll("*")) {
      const own = [...el.childNodes].some(
        (n) => n.nodeType === 3 && n.textContent.trim().length > 1,
      );
      if (!own) continue;
      if (el.closest("[aria-hidden='true'], [hidden], script, style, noscript"))
        continue;
      if (!el.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }))
        continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const s = getComputedStyle(el);
      if (el.closest(":disabled, [aria-disabled='true']")) continue;
      const fg = parse(s.color);
      const bg = backdrop(el);
      if (!fg || !bg) continue;
      scanned++;
      const shown = fg.a < 1 ? blend(fg, bg) : fg;
      const size = parseFloat(s.fontSize),
        bold = Number(s.fontWeight) >= 700;
      const needed = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
      const value = ratio(shown, bg);
      if (value < needed)
        low.push(
          `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/)[0] : ""} "${el.textContent.trim().slice(0, 30)}" ${value.toFixed(2)}:1`,
        );
    }
    // Focus rings (3px outline in --focus, drawn outside the element) need
    // 3:1 against the surface they sit on: the parent's backdrop. Trainer
    // themes draw their own white-and-black double ring; a Brain showcase
    // draws its own ring (--sc-ai-on on the ink stage, app/brain-stage.css),
    // whose contrast tests/marketing-showcase.test.ts holds at 3:1.
    const hex = (v) => {
      const m = v.trim().match(/^#([0-9a-f]{6})$/i);
      if (!m) return parse(v.trim());
      const n = parseInt(m[1], 16);
      return { r: n >> 16, g: (n >> 8) & 255, b: n & 255, a: 1 };
    };
    const lowFocus = [];
    for (const el of document.body.querySelectorAll(
      "a[href], button, input:not([type='hidden']), select, textarea, summary, [tabindex]:not([tabindex='-1'])",
    )) {
      if (el.closest(".trainer-theme, [data-showcase], [aria-hidden='true'], [hidden], :disabled")) continue;
      if (!el.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }))
        continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || !el.parentElement) continue;
      const ring = hex(getComputedStyle(el).getPropertyValue("--focus"));
      const under = backdrop(el.parentElement);
      if (!ring || !under) continue;
      const value = ratio(ring.a < 1 ? blend(ring, under) : ring, under);
      if (value < 3)
        lowFocus.push(
          `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/)[0] : ""} "${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 30)}" ${value.toFixed(2)}:1`,
        );
    }
    const logo = [...document.querySelectorAll(".brand-logo img")].find(
      (img) => img.checkVisibility?.() && img.getBoundingClientRect().width > 0,
    );
    const root = document.documentElement;
    const icon = document.querySelector("link[rel~='icon']");
    // Always-light public pages: the document, the body and the page root
    // show white, and no visible surface except a button or a Brain
    // showcase's ink stage ([data-showcase], the accepted exception of
    // docs/marketing-revamp-2026-10-26/showcase/SHOWCASE_DESIGN.md) is dark
    // (relative luminance below 0.2). Thin rules and meters under 12px are
    // not surfaces.
    const rgb = (c) => (c ? `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})` : null);
    const pageRoot = document.querySelector(".mk, .public");
    const surfaces = {
      html: rgb(parse(getComputedStyle(root).backgroundColor)),
      body: rgb(backdrop(document.body)),
      root: pageRoot ? rgb(backdrop(pageRoot)) : null,
    };
    const dark = [];
    for (const el of document.body.querySelectorAll("*")) {
      if (el.closest(".button, .mk-fake-button, [data-showcase]")) continue;
      const c = parse(getComputedStyle(el).backgroundColor);
      if (!c || c.a < 0.5 || lum(c) >= 0.2) continue;
      if (!el.checkVisibility?.({ opacityProperty: true, visibilityProperty: true })) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 12 || r.height < 12 || r.bottom <= 0) continue;
      dark.push(
        `${el.tagName.toLowerCase()}${typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\s+/)[0] : ""} ${rgb(c)}`,
      );
    }
    const themeColors = [...document.querySelectorAll("meta[name='theme-color']")].map(
      (meta) => `${meta.getAttribute("media") ?? "all"}=${meta.getAttribute("content")}`,
    );
    const colorScheme =
      document.querySelector("meta[name='color-scheme']")?.getAttribute("content") ?? null;
    // Marketing pages: the page content starts at the header logo's edge.
    const edgeOf = (selector) => {
      const el = document.querySelector(selector);
      return el && el.getBoundingClientRect().width ? Math.round(el.getBoundingClientRect().left) : null;
    };
    const edges = document.querySelector(".mk-page .mk-breadcrumbs")
      ? { logo: edgeOf(".mk-header .brand-logo"), page: edgeOf(".mk-page .mk-breadcrumbs") }
      : null;
    return {
      edges,
      surfaces,
      dark,
      themeColors,
      colorScheme,
      overflow: Math.max(
        root.scrollWidth - root.clientWidth,
        document.body.scrollWidth - document.body.clientWidth,
      ),
      platformUi: !!document.querySelector(".platform-ui"),
      logo: logo ? new URL(logo.src).pathname : null,
      logoWidth: logo ? Math.round(logo.getBoundingClientRect().width) : 0,
      anyBrandAsset: !![...document.querySelectorAll("img")].some((img) =>
        img.src.includes("/brand/"),
      ),
      icon: icon?.getAttribute("href") ?? null,
      canvas: getComputedStyle(root).backgroundColor,
      scanned,
      low,
      lowFocus,
    };
  });
}

const WHITE = "rgb(255, 255, 255)";
function assertPlatform(label, m, scheme, isPublic = false) {
  checked.push({ label, scanned: m.scanned, low: m.low.length, logo: m.logo });
  if (m.overflow > 1) fail(label, `horizontal overflow of ${m.overflow}px`);
  if (!m.platformUi) fail(label, "the platform surface is not .platform-ui");
  // Public platform pages are always light: the ink lockup in both schemes.
  const expected =
    scheme === "dark" && !isPublic
      ? "/brand/trainsyou-lockup-white.svg"
      : "/brand/trainsyou-lockup-ink.svg";
  if (isPublic && m.edges && m.edges.logo !== null && Math.abs(m.edges.logo - m.edges.page) > 1)
    fail(label, `page content starts at ${m.edges.page}px, the header logo at ${m.edges.logo}px`);
  if (isPublic) {
    for (const [where, value] of Object.entries(m.surfaces))
      if (value !== WHITE) fail(label, `${where} background is ${value}, expected white`);
    if (m.dark.length)
      fail(label, `${m.dark.length} dark surface(s): ${m.dark.slice(0, 5).join("; ")}`);
    if (m.themeColors.length !== 1 || m.themeColors[0].toLowerCase() !== "all=#ffffff")
      fail(label, `theme-color ${m.themeColors.join(", ")}, expected one #FFFFFF`);
    if (m.colorScheme !== "light") fail(label, `color-scheme meta ${m.colorScheme}`);
  }
  if (m.logo !== expected) fail(label, `visible logo ${m.logo}, expected ${expected}`);
  if (m.logo && m.logoWidth < 160) fail(label, `lockup ${m.logoWidth}px wide (minimum 160)`);
  // The trainer workspace installs as the trainer's own app
  // (MemberAppManifest), so its icon is the workspace's; every other
  // platform page shows the trainsyou favicon.
  const workspaceIcon =
    / \/trainer/.test(label) && m.icon?.startsWith("/api/v1/app/icons/");
  if (!m.icon?.startsWith("/brand/") && !workspaceIcon)
    fail(label, `favicon ${m.icon}`);
  if (m.low.length)
    fail(label, `${m.low.length} low-contrast text: ${m.low.slice(0, 5).join("; ")}`);
  if (m.lowFocus.length)
    fail(
      label,
      `${m.lowFocus.length} focus ring(s) below 3:1: ${m.lowFocus.slice(0, 5).join("; ")}`,
    );
}

/** BRAND_CHECK_SHOTS=<dir> keeps a first-screen image of a few pages. */
const SHOTS = process.env.BRAND_CHECK_SHOTS;
async function shot(page, label) {
  if (!SHOTS || !/ (\/|\/pricing|\/login|\/trainer|\/admin\/settings)$/.test(label))
    return;
  const name = label.replace(/[^a-z0-9]+/gi, "-").replace(/-+$/, "");
  await page.screenshot({ path: `${SHOTS}/${name}.png` }).catch(() => {});
}

/**
 * The first screen of the home page as a new visitor sees it (the optional
 * analytics notice in its default state; the hero field's still frame, as
 * every automated browser gets it): where the H1, the primary action and the
 * field's parts end (Noura's words, the STOP stamp, the Paused lane and all
 * the lanes), whether any visible notice covers them, and the left edge of
 * every region (one shared container).
 */
function firstScreen(page) {
  return page.evaluate(() => {
    const box = (el) => (el ? el.getBoundingClientRect() : null);
    const field = document.querySelector('.mk-hero [data-showcase="field"]');
    const parts = field
      ? {
          words: box(field.querySelector(".mc-hl")?.closest(".mc-msg")),
          stamp: box(field.querySelector(".mc-stamp")),
          paused: box(field.querySelector('.mc-lane[data-lane="paused"]')),
          lanes: box(field.querySelector(".mc-lanes")),
        }
      : null;
    const cta = box(document.querySelector(".mk-hero .mk-cta"));
    const notices = [...document.querySelectorAll(".acquisition-consent")]
      .map(box)
      .filter((r) => r && r.width > 0 && r.height > 0);
    const covers = (r) =>
      !!r && notices.some((n) => n.left < r.right && n.right > r.left && n.top < r.bottom && n.bottom > r.top);
    const left = (selector) => {
      const r = box(document.querySelector(selector));
      return r ? Math.round(r.left) : null;
    };
    return {
      h1: box(document.querySelector("h1")).bottom,
      cta: cta ? cta.bottom : null,
      field: parts && Object.fromEntries(Object.entries(parts).map(([k, r]) => [k, r ? Math.round(r.bottom) : null])),
      covered: { cta: covers(cta), field: !!parts && Object.values(parts).some(covers) },
      notices: notices.length,
      edges: {
        logo: left(".mk-header .brand-logo"),
        hero: left(".mk-hero h1"),
        band: left(".mk-home-inner h2"),
        closing: left(".mk-closing"),
        footer: left(".mk-footer-brand"),
      },
    };
  });
}

/**
 * The optional-analytics bar on a phone: its height, controls under 48 px,
 * and by how much it covers the end of the page after a full scroll (it
 * reserves its own space, so 0).
 */
async function consentBarLayout(page) {
  const bar = await page.evaluate(() => {
    const el = document.querySelector(".consent-bar");
    const r = el.getBoundingClientRect();
    return {
      height: Math.round(r.height),
      small: [...el.querySelectorAll("button")]
        .map((b) => [b.getAttribute("aria-label") || b.textContent.trim(), b.getBoundingClientRect()])
        .filter(([, box]) => box.height < 48 || box.width < 48)
        .map(([name, box]) => `${name} ${Math.round(box.width)}x${Math.round(box.height)}`),
    };
  });
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(250);
  const endCovered = await page.evaluate(() => {
    const top = document.querySelector(".consent-bar").getBoundingClientRect().top;
    const end = Math.max(
      ...[...document.querySelectorAll("footer, main")].map((el) => el.getBoundingClientRect().bottom),
    );
    return Math.max(0, Math.round(end - top));
  });
  return { ...bar, endCovered };
}
/**
 * Answers the bar, then fails if the bar or any analytics control still
 * floats (fixed or sticky) on the page or after a reload.
 */
async function consentAnswerChecks(page, label, answer) {
  await page
    .locator(".consent-bar")
    .getByRole("button", { name: answer, exact: true })
    .click();
  const floating = () =>
    page.evaluate(() =>
      [...document.querySelectorAll(".acquisition-consent, button, a")]
        .filter(
          (el) =>
            el.matches(".acquisition-consent") ||
            /analytics/i.test(`${el.textContent} ${el.getAttribute("aria-label") ?? ""}`),
        )
        .filter((el) => {
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) return false;
          for (let n = el; n && n !== document.body; n = n.parentElement)
            if (["fixed", "sticky"].includes(getComputedStyle(n).position)) return true;
          return false;
        })
        .map((el) => (el.getAttribute("aria-label") || el.textContent).trim().slice(0, 40)),
    );
  await page.waitForTimeout(800);
  let left = await floating();
  if (left.length) fail(label, `after "${answer}" analytics controls still float: ${left.join("; ")}`);
  await page.reload({ waitUntil: "load" });
  await settle(page);
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(1200);
  left = await floating();
  if (left.length) fail(label, `after "${answer}" and a reload analytics controls float: ${left.join("; ")}`);
}

/**
 * The home page's word budget and H2 cap (docs/marketing-revamp-2026-10-26/
 * phase1/PLAN.md §4.3): visible words in `main`, as C1 counts them (the
 * showcases, the sample screens, the follower calculator, screen-reader text
 * and closed or hidden content left out). C1's target is 400; the approved
 * copy measures more, so the measured figure is the budget (the plan's rule;
 * it is recorded in docs/features/marketing-site.md, and copy is never cut
 * without the owner): 624 on 28 October 2026 with sign-ups open, as this
 * check's seeded platform has them (610 with them closed). The H2s are the
 * registry's sections (resort, how, subscribers, control, economics,
 * followers, proof), the FAQ band and the closing panel.
 */
const HOME_WORDS = 624;
const HOME_H2 = 9;

/**
 * The home page: the first screen at 1440x900 and 390x844 with the hero
 * field, the word count and headings, the hero's motion with and without
 * reduced motion, and the field in right to left.
 */
async function homeChecks(scheme) {
  const seconds = (v) =>
    v.split(",").map((s) => (s.trim().endsWith("ms") ? parseFloat(s) / 1000 : parseFloat(s)));
  /** The marketing motion switch the page was built with ("device" when absent). */
  const motionSwitch = (page) =>
    page.evaluate(() => document.querySelector(".mk")?.getAttribute("data-mk-motion") ?? "device");
  /** The field's parts that must show in its still frame: Noura's words, the STOP stamp, the Paused lane. */
  const stillParts = (page) =>
    page.evaluate(() => {
      const field = document.querySelector('.mk-hero [data-showcase="field"]');
      if (!field) return null;
      return [field.querySelector(".mc-hl")?.closest(".mc-msg"), field.querySelector(".mc-stamp"), field.querySelector('.mc-lane[data-lane="paused"]')]
        .filter((el) => !el || !el.checkVisibility({ opacityProperty: true, visibilityProperty: true }))
        .map((el) => (el ? el.getAttribute("class") : "missing"));
    });
  /**
   * The hero plays once: the field shows its final frame from the first
   * paint and stays still (automated browsers never run the engine), the
   * primary action's arrow nudges once and is back in place by 3.5 s,
   * nothing loops and every animation ends within 4.5 s. Call it right
   * after the hero appears.
   */
  const heroPlaysOnce = async (page, label) => {
    const hidden = await stillParts(page);
    if (hidden === null) fail(label, "no field in the hero");
    else if (hidden.length) fail(label, `hidden in the field's still frame: ${hidden.join("; ")}`);
    const timing = await page.evaluate(() =>
      [...document.querySelectorAll(".mk *")].map((el) => {
        const s = getComputedStyle(el);
        return { name: s.animationName, delay: s.animationDelay, duration: s.animationDuration, count: s.animationIterationCount };
      }),
    );
    const animated = timing.filter((t) => t.name !== "none");
    const infinite = timing.filter((t) => t.count.includes("infinite"));
    const end = Math.max(
      0,
      ...animated.map((t) => {
        const d = seconds(t.delay),
          l = seconds(t.duration);
        return Math.max(...l.map((x, i) => x + (d[i] ?? d[0])));
      }),
    );
    await page.waitForTimeout(3500);
    const arrow = await page.evaluate(() => {
      const a = document.querySelector(".mk-hero .mk-cta > .lucide-arrow-right");
      return a ? { translate: getComputedStyle(a).translate, running: a.getAnimations().filter((x) => x.playState === "running").length } : null;
    });
    const field = await page.evaluate(
      () =>
        document
          .querySelector('.mk-hero [data-showcase="field"]')
          ?.getAnimations({ subtree: true })
          .filter((a) => a.playState === "running").length ?? 0,
    );
    if (!animated.some((t) => t.name === "mk-nudge")) fail(label, "the hero arrow has no nudge");
    if (!arrow || arrow.translate !== "none" || arrow.running) fail(label, `the hero arrow is not at rest after 3.5 s: ${JSON.stringify(arrow)}`);
    if (field) fail(label, `${field} animation(s) running in the field's still frame`);
    if (infinite.length) fail(label, `${infinite.length} infinite animation(s)`);
    if (end > 4.5) fail(label, `animation ends at ${end}s`);
    return { animated: animated.length, end };
  };
  // 1440x900: the H1, the primary action and the field's lanes on the first
  // screen; every region starts at the same edge; the notice covers none of
  // them and, after a scroll, is a slim bar.
  await screen(`${scheme} 1440x900 / first screen`, async () => {
    const ctx = await context({ width: 1440, height: 900 }, scheme);
    const page = await ctx.newPage();
    await visit(page, "/");
    const f = await firstScreen(page);
    const m = await page.evaluate(() => {
      const main = document.querySelector("main");
      const count = (t) => (t ?? "").split(/\s+/).filter(Boolean).length;
      // innerText already leaves out closed and hidden content.
      const skipped = [...main.querySelectorAll("[data-showcase], [data-sample-ui], .mk-home-calc, .sr-only")].filter(
        (el, _, all) => !all.some((other) => other !== el && other.contains(el)),
      );
      return {
        words: count(main.innerText) - skipped.reduce((n, el) => n + count(el.innerText), 0),
        skippedWords: skipped.reduce((n, el) => n + count(el.innerText), 0),
        h2: main.querySelectorAll("h2").length,
        h1: document.querySelectorAll("h1").length,
        nested: main.querySelectorAll(":is([data-showcase], .mk-home-calc) :is(h1, h2)").length,
      };
    });
    const label = `${scheme} 1440x900 /`;
    checked.push({ label, scanned: 0, low: 0, logo: "-" });
    if (f.h1 > 900 || f.cta === null || f.cta > 900)
      fail(label, `H1 ends at ${Math.round(f.h1)}px, primary action at ${f.cta === null ? "-" : Math.round(f.cta) + "px"}`);
    if (!f.field) fail(label, "no field in the hero");
    else if (f.field.lanes === null || f.field.lanes > 900) fail(label, `the field's lanes end at ${f.field.lanes}px`);
    if (f.covered.cta || f.covered.field) fail(label, "the analytics notice covers the primary action or the field");
    if (new Set(Object.values(f.edges)).size !== 1)
      fail(label, `regions start at different edges: ${JSON.stringify(f.edges)}`);
    if (m.words > HOME_WORDS) fail(label, `${m.words} visible words in main (limit ${HOME_WORDS}; showcases, sample screens and the calculator not counted)`);
    if (m.h2 > HOME_H2) fail(label, `${m.h2} H2 headings (limit ${HOME_H2})`);
    if (m.h1 !== 1 || m.nested) fail(label, `${m.h1} H1, ${m.nested} heading(s) in a showcase or the calculator`);
    await page.mouse.wheel(0, 600);
    const bar = await page
      .locator(".consent-bar")
      .waitFor({ timeout: 10_000 })
      .then(() => page.locator(".consent-bar").boundingBox());
    // One row: the sentence, two 48 px choices and a 48 px Close.
    if (!bar || bar.height > 72) fail(label, `the analytics bar after a scroll is ${bar?.height}px tall (limit 72)`);
    await consentAnswerChecks(page, label, "No thanks");
    console.log(
      `home 1440x900 ${scheme}: H1 bottom ${Math.round(f.h1)}px, CTA bottom ${Math.round(f.cta ?? 0)}px, field ${JSON.stringify(f.field)}, edges ${JSON.stringify(f.edges)}, ${f.notices} notice(s) before scrolling, bar ${Math.round(bar?.height ?? 0)}px after, ${m.words} words in main (limit ${HOME_WORDS}), ${m.skippedWords} in showcases, sample screens and the calculator, ${m.h2} H2 (limit ${HOME_H2})`,
    );
    await ctx.close();
  });
  // 390x844: the H1 and the field's key parts (Noura's words, the STOP stamp,
  // the Paused lane) above y 770, uncovered by the analytics notice; the
  // primary action follows the lede below the field (PLAN.md §4.4: H1 →
  // field → lede → CTA).
  await screen(`${scheme} 390x844 / first screen`, async () => {
    const ctx = await context({ width: 390, height: 844 }, scheme);
    const page = await ctx.newPage();
    await visit(page, "/");
    const f = await firstScreen(page);
    const label = `${scheme} 390x844 /`;
    checked.push({ label, scanned: 0, low: 0, logo: "-" });
    if (f.h1 > 844) fail(label, `H1 ends at ${Math.round(f.h1)}px`);
    if (!f.field) fail(label, "no field in the hero");
    else
      for (const [what, bottom] of [["Noura's words", f.field.words], ["the STOP stamp", f.field.stamp], ["the Paused lane", f.field.paused]])
        if (bottom === null || bottom > 770) fail(label, `${what} ${bottom === null ? "missing" : `end at ${bottom}px`} (above 770 expected)`);
    if (f.covered.field) fail(label, "the analytics notice covers the field");
    if (new Set(Object.values(f.edges)).size !== 1)
      fail(label, `regions start at different edges: ${JSON.stringify(f.edges)}`);
    // After a scroll: the slim bar, 48 px controls, the end of the page
    // clear of it; Close is an answer like any other.
    await page.mouse.wheel(0, 600);
    await page.locator(".consent-bar").waitFor({ timeout: 10_000 });
    const phoneBar = await consentBarLayout(page);
    if (phoneBar.small.length)
      fail(label, `analytics controls below 48px: ${phoneBar.small.join(", ")}`);
    if (phoneBar.height > 180) fail(label, `the analytics bar is ${phoneBar.height}px tall on a phone (limit 180)`);
    if (phoneBar.endCovered)
      fail(label, `the analytics bar covers the end of the page by ${phoneBar.endCovered}px`);
    await consentAnswerChecks(page, label, "Close");
    console.log(
      `home 390x844 ${scheme}: H1 bottom ${Math.round(f.h1)}px, field ${JSON.stringify(f.field)}, ${f.notices} notice(s) before scrolling, bar ${phoneBar.height}px after`,
    );
    await ctx.close();
  });
  // Reduced motion follows the marketing motion switch (data-mk-motion on
  // the marketing root): with "always" (the owner, 22 October 2026) the hero
  // plays exactly as without the setting (the same rules as "motion /"
  // below); with "device" nothing in the hero animates. The field shows its
  // final frame either way.
  await screen(`${scheme} reduced motion /`, async () => {
    const label = `${scheme} reduced motion /`;
    const ctx = await context(VIEWPORTS[1], scheme, "reduce");
    const page = await ctx.newPage();
    await page.goto(base + "/", { waitUntil: "domcontentloaded" });
    await page.locator(".mk-hero").waitFor();
    const switchMode = await motionSwitch(page);
    checked.push({ label, scanned: 0, low: 0, logo: "-" });
    if (switchMode === "always") {
      const r = await heroPlaysOnce(page, label);
      console.log(`home reduced motion ${scheme} (switch "always"): ${r.animated} animated elements, last ends at ${r.end}s`);
    } else {
      const hidden = await stillParts(page);
      if (hidden === null || hidden.length) fail(label, `the field's still frame: ${hidden === null ? "no field" : hidden.join("; ")}`);
      const bad = await page.evaluate(() =>
        [...document.querySelectorAll(".mk-hero *")]
          .map((el) => [el, getComputedStyle(el)])
          .filter(([, s]) => s.animationName !== "none")
          .map(([el, s]) => `${el.tagName.toLowerCase()}.${el.getAttribute("class")} ${s.animationName}`),
      );
      if (bad.length) fail(label, `${bad.length} animated: ${bad.slice(0, 4).join("; ")}`);
    }
    await ctx.close();
  });
  // Motion allowed: the arrow nudges once, everything ends within 4.5 s and
  // the field stays on its final frame.
  await screen(`${scheme} motion /`, async () => {
    const ctx = await context(VIEWPORTS[1], scheme);
    const page = await ctx.newPage();
    await page.goto(base + "/", { waitUntil: "domcontentloaded" });
    await page.locator(".mk-hero").waitFor();
    checked.push({ label: `${scheme} motion /`, scanned: 0, low: 0, logo: "-" });
    const r = await heroPlaysOnce(page, `${scheme} motion /`);
    console.log(`home motion ${scheme}: ${r.animated} animated elements, last ends at ${r.end}s`);
    await ctx.close();
  });
  // Right to left (1440): the field mirrors (its blocks swap sides) and the
  // lockup keeps its orientation.
  await screen(`${scheme} rtl 1440 /`, async () => {
    const label = `${scheme} rtl 1440 /`;
    const ctx = await context(VIEWPORTS[1], scheme, "reduce");
    const page = await ctx.newPage();
    /** The centres of the field's blocks: the message shell and each lane. */
    const centres = () =>
      page.evaluate(() => {
        const field = document.querySelector('.mk-hero [data-showcase="field"]');
        if (!field) return null;
        return [field.querySelector(".mc-shell"), ...field.querySelectorAll(".mc-lane")].map((el) => {
          const r = el?.getBoundingClientRect();
          return r && r.width ? r.left + r.width / 2 : null;
        });
      });
    await visit(page, "/");
    const ltr = await centres();
    await visit(page, "/?lang=ar");
    const rtl = await centres();
    const m = await page.evaluate(() => {
      const plain = (el) => {
        const s = getComputedStyle(el);
        return s.transform === "none" && (s.scale === "none" || s.scale === "1");
      };
      return {
        dir: document.documentElement.dir,
        lockup: [...document.querySelectorAll(".brand-logo, .brand-logo img")].every(plain),
      };
    });
    // Every pair of blocks more than 20 px apart in left to right swaps sides.
    const pairs = [];
    if (ltr && rtl)
      for (let i = 0; i < ltr.length; i++)
        for (let j = i + 1; j < ltr.length; j++)
          if (ltr[i] !== null && ltr[j] !== null && rtl[i] !== null && rtl[j] !== null && Math.abs(ltr[i] - ltr[j]) > 20)
            pairs.push(Math.sign(ltr[i] - ltr[j]) === -Math.sign(rtl[i] - rtl[j]));
    checked.push({ label, scanned: 0, low: 0, logo: "-" });
    if (m.dir !== "rtl") fail(label, `document direction ${m.dir}`);
    if (!ltr || !rtl) fail(label, "no field in the hero");
    else if (!pairs.length || !pairs.every(Boolean)) fail(label, `the field did not mirror: ${JSON.stringify({ ltr, rtl })}`);
    if (!m.lockup) fail(label, "the lockup is mirrored");
    await ctx.close();
  });
  // Arabic at 390: no public page overflows.
  await screen(`${scheme} rtl 390 public`, async () => {
    const ctx = await context(VIEWPORTS[0], scheme);
    const page = await ctx.newPage();
    for (const route of PUBLIC_ROUTES) {
      await visit(page, route + (route.includes("?") ? "&" : "?") + "lang=ar");
      const overflow = await page.evaluate(() =>
        Math.max(
          document.documentElement.scrollWidth - document.documentElement.clientWidth,
          document.body.scrollWidth - document.body.clientWidth,
        ),
      );
      checked.push({ label: `${scheme} 390px ${route}?lang=ar`, scanned: 0, low: 0, logo: "-" });
      if (overflow > 1) fail(`${scheme} 390px ${route}?lang=ar`, `horizontal overflow of ${overflow}px`);
    }
    await ctx.close();
  });
}

async function screen(label, fn) {
  try {
    await fn();
  } catch (e) {
    fail(label, String(e?.message ?? e).split("\n")[0]);
  }
}

try {
  // Static assets, manifest and social preview.
  for (const path of [
    "/brand/trainsyou-lockup-ink.svg",
    "/brand/favicon.ico",
    "/brand/app-icon-512.png",
    "/brand/social-share-1200x630.png",
  ]) {
    const r = await fetch(base + path);
    if (!r.ok) fail(path, `answered ${r.status}`);
  }
  const manifest = await (await fetch(base + "/manifest.webmanifest")).json();
  if (manifest.name !== "trainsyou") fail("manifest", `name ${manifest.name}`);
  if (!manifest.icons?.every((i) => i.src.startsWith("/brand/")))
    fail("manifest", "icons are not the trainsyou icons");
  const og = await fetch(base + "/og?path=%2Fpricing");
  if (!og.ok || og.headers.get("content-type") !== "image/png")
    fail("/og", `answered ${og.status} ${og.headers.get("content-type")}`);

  for (const scheme of SCHEMES) {
    // One signed-in context per scheme and audience; viewports resize it.
    const ctx = await context(VIEWPORTS[1], scheme);
    const page = await ctx.newPage();
    const member = await context(VIEWPORTS[1], scheme);
    const memberPage = await member.newPage();
    // Public pages first, signed out.
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const route of PUBLIC_ROUTES) {
        const label = `${scheme} ${viewport.name} ${route}`;
        await screen(label, async () => {
          await visit(page, route);
          const waiting = await revealAll(page);
          if (waiting) fail(label, `${waiting} section(s) never revealed after a scroll-through`);
          assertPlatform(label, await measure(page), scheme, true);
          await shot(page, label);
        });
      }
    }
    await homeChecks(scheme);
    // Sign in at desktop width (as the right-to-left check does).
    await screen(`${scheme} coach sign in`, () => signIn(page, "coach@example.test"));
    await screen(`${scheme} member sign in`, () =>
      signIn(memberPage, "sam.taylor@example.test"),
    );
    for (const viewport of VIEWPORTS) {
      for (const p of [page, memberPage])
        await p.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const route of WORKSPACE_ROUTES) {
        const label = `${scheme} ${viewport.name} ${route}`;
        await screen(label, async () => {
          await visit(page, route);
          // A redirect to sign-in would check the wrong screen.
          const at = await page.evaluate(() => ({
            path: location.pathname,
            workspace: !!document.querySelector(".workspace .sidebar"),
          }));
          if (at.path !== route || !at.workspace)
            throw new Error(`not the workspace (at ${at.path})`);
          const m = await measure(page);
          // The workspace sidebar is off canvas on phones.
          if (viewport.width < 651 && m.logo === null) m.logo = "offcanvas";
          if (m.logo === "offcanvas") {
            // The workspace keeps the white lockup in dark mode.
            const expected =
              scheme === "dark"
                ? "/brand/trainsyou-lockup-white.svg"
                : "/brand/trainsyou-lockup-ink.svg";
            const hidden = await page.evaluate(
              () =>
                [...document.querySelectorAll(".sidebar .brand-logo img")].map(
                  (img) =>
                    getComputedStyle(img).display !== "none"
                      ? new URL(img.src).pathname
                      : null,
                ).filter(Boolean)[0] ?? null,
            );
            m.logo = hidden === expected ? expected : hidden;
          }
          assertPlatform(label, m, scheme);
          await shot(page, label);
        });
      }
      // A subscriber's member app and a coach website carry the trainer's
      // brand: no platform lockup, no platform dark tokens.
      for (const [label, run] of [
        [
          `${scheme} ${viewport.name} coach website`,
          () => visit(memberPage, "/coach/alex-morgan"),
        ],
        [
          `${scheme} ${viewport.name} member app`,
          async () => {
            await visit(memberPage, "/app");
            if (
              !(await memberPage.evaluate(
                () => location.pathname === "/app" && !!document.querySelector(".workspace.trainer-theme"),
              ))
            )
              throw new Error("the member app did not open");
          },
        ],
      ])
        await screen(label, async () => {
          await run();
          const m = await measure(memberPage);
          checked.push({ label, scanned: m.scanned, low: m.low.length, logo: m.logo });
          if (m.platformUi || m.anyBrandAsset)
            fail(label, "shows the platform identity on a trainer-branded surface");
          if (m.overflow > 1) fail(label, `horizontal overflow of ${m.overflow}px`);
          // Subscriber surfaces follow the device (docs/features/dark-mode.md):
          // in dark the page is dark and every text reaches AA against it.
          if (scheme === "dark") {
            const surface = await memberPage.evaluate(() => {
              const el = document.querySelector("[data-color-scheme]");
              return el
                ? { choice: el.getAttribute("data-color-scheme"), colorScheme: getComputedStyle(el).colorScheme }
                : null;
            });
            if (surface?.choice !== "system" || surface.colorScheme !== "dark")
              fail(label, `does not follow the dark device: ${JSON.stringify(surface)}`);
            if (m.low.length)
              fail(label, `${m.low.length} low-contrast text in dark: ${m.low.slice(0, 5).join("; ")}`);
          }
          // The browser colour is the trainer's: the Design Studio primary in
          // light and the dark top bar colour in dark, one copy per scheme,
          // never the platform's paper and ink.
          const unified = () => {
            const metas = [...document.querySelectorAll("meta[name='theme-color']")];
            const of = (word) =>
              metas.find((meta) => (meta.getAttribute("media") ?? "").includes(word))
                ?.getAttribute("content")
                ?.toLowerCase();
            const light = of("light"),
              dark = of("dark");
            const lum = (hex) => {
              const n = parseInt(hex.slice(1), 16);
              const f = (v) => {
                const c = v / 255;
                return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
              };
              return 0.2126 * f(n >> 16) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
            };
            return (
              metas.length === 2 &&
              !!light &&
              !!dark &&
              /^#[0-9a-f]{6}$/.test(light) &&
              /^#[0-9a-f]{6}$/.test(dark) &&
              !["#f3f4f0", "#171917"].includes(light) &&
              !["#f3f4f0", "#171917"].includes(dark) &&
              lum(dark) < 0.05
            );
          };
          await memberPage
            .waitForFunction(unified, null, { timeout: 30_000 })
            .catch(() => {});
          if (!(await memberPage.evaluate(unified)))
            fail(
              label,
              `browser colour is not the trainer's: ${await memberPage.evaluate(() =>
                [...document.querySelectorAll("meta[name='theme-color']")]
                  .map((meta) => `${meta.getAttribute("media") ?? "all"}=${meta.getAttribute("content")}`)
                  .join(", "),
              )}`,
            );
        });
    }
    await ctx.close();
    await member.close();
  }
} finally {
  await browser.close();
}

for (const c of checked)
  console.log(
    `checked ${c.label}: ${c.scanned} text elements, ${c.low} below AA, logo ${c.logo}`,
  );
if (pageErrors.length) {
  console.error(`${pageErrors.length} page error(s):`);
  for (const e of [...new Set(pageErrors)].slice(0, 20)) console.error("  " + e);
}
if (failures.length || pageErrors.length) {
  console.error(`${failures.length} brand check failure(s):`);
  for (const f of failures) console.error("  " + f);
  process.exitCode = 1;
} else console.log(`Brand check passed: ${checked.length} screens.`);
