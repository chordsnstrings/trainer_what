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
// logo's edge (one shared container). The home page is the owner's design
// (25 October 2026, components/marketing/home-design.tsx): its own lockup
// and root, and a first screen pass as a new visitor sees it (the analytics
// notice in its default state must cover neither the H1 nor the primary
// action, both on the first screen at 390x844 and 1440x900; after a scroll
// the analytics bar is slim with 48 px controls and covers nothing at the
// end of the page; after an answer, No thanks or Close, no analytics control
// floats, after a reload too), and a reduced-motion, animation and
// right-to-left pass (its motion follows the device's setting, as in the
// design: it plays once, and under reduced motion everything shows). It
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
    // themes draw their own white-and-black double ring.
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
      if (el.closest(".trainer-theme, [aria-hidden='true'], [hidden], :disabled")) continue;
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
    const logo = [...document.querySelectorAll(".brand-logo img, .tyh-lockup img")].find(
      (img) => img.checkVisibility?.() && img.getBoundingClientRect().width > 0,
    );
    const root = document.documentElement;
    const icon = document.querySelector("link[rel~='icon']");
    // Always-light public pages: the document, the body and the page root
    // show white, and no visible surface except a button is dark (relative
    // luminance below 0.2). Thin rules and meters under 12px are not
    // surfaces.
    const rgb = (c) => (c ? `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})` : null);
    const pageRoot = document.querySelector(".mk, .public, .tyh");
    const surfaces = {
      html: rgb(parse(getComputedStyle(root).backgroundColor)),
      body: rgb(backdrop(document.body)),
      root: pageRoot ? rgb(backdrop(pageRoot)) : null,
    };
    const dark = [];
    for (const el of document.body.querySelectorAll("*")) {
      // Buttons, and the home design's pricing chart (its ink bars).
      if (el.closest(".button, .mk-fake-button, .tyh-btn, .tyh-bv")) continue;
      const c = parse(getComputedStyle(el).backgroundColor);
      if (!c || c.a < 0.5 || lum(c) >= 0.2) continue;
      if (!el.checkVisibility?.({ opacityProperty: true, visibilityProperty: true })) continue;
      const r = el.getBoundingClientRect();
      // Off the page (a skip link before it is focused) is not a surface.
      if (r.width < 12 || r.height < 12 || r.bottom <= 0 || r.right <= 0) continue;
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
      platformUi: !!document.querySelector(".platform-ui, .tyh"),
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
  // The home design shows its own lockup, the symbol on a Pace square, 24 px
  // tall (about 121 px wide) as the owner drew it.
  const home = / \/$/.test(label);
  const expected = home
    ? "/brand/trainsyou-lockup-pace.webp"
    : scheme === "dark" && !isPublic
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
  if (m.logo && m.logoWidth < (home ? 120 : 160))
    fail(label, `lockup ${m.logoWidth}px wide (minimum ${home ? 120 : 160})`);
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
 * analytics notice in its default state): where the H1 and the primary
 * action end, whether any visible notice covers them, and the left edge of
 * every region (one shared container).
 */
function firstScreen(page) {
  return page.evaluate(() => {
    const box = (el) => (el ? el.getBoundingClientRect() : null);
    const h1 = box(document.querySelector("h1"));
    const cta = box(document.querySelector('.tyh-hero [data-cta="hero"]'));
    const notices = [...document.querySelectorAll(".acquisition-consent")]
      .map(box)
      .filter((r) => r && r.width > 0 && r.height > 0);
    const covers = (r) =>
      notices.some((n) => n.left < r.right && n.right > r.left && n.top < r.bottom && n.bottom > r.top);
    const start = (selector) => {
      const r = box(document.querySelector(selector));
      return r ? Math.round(document.dir === "rtl" ? innerWidth - r.right : r.left) : null;
    };
    return {
      h1: h1.bottom,
      cta: cta.bottom,
      covered: covers(cta) || covers(h1),
      notices: notices.length,
      edges: {
        logo: start(".tyh-nav .tyh-lockup"),
        hero: start(".tyh-hero h1"),
        band: start("#how-h"),
        footer: start("footer .tyh-ft-b"),
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
 * The home page (the owner's design): the first screen at 1440x900 and
 * 390x844, its motion with and without reduced motion, and right to left.
 */
async function homeChecks(scheme) {
  const seconds = (v) =>
    v.split(",").map((s) => (s.trim().endsWith("ms") ? parseFloat(s) / 1000 : parseFloat(s)));
  /** The CSS animations on the page and when the last one ends. */
  const animations = (page) =>
    page.evaluate(() =>
      [...document.querySelectorAll(".tyh *")]
        .map((el) => getComputedStyle(el))
        .filter((s) => s.animationName !== "none")
        .map((s) => ({ delay: s.animationDelay, duration: s.animationDuration, count: s.animationIterationCount })),
    );
  /** After 5 s: the sample feed has played to its approved end. */
  const feedAtRest = (page) =>
    page.evaluate(() => ({
      shown: [...document.querySelectorAll(".tyh-fd")].filter((el) => Number(getComputedStyle(el).opacity) === 1).length,
      chip: document.querySelector(".tyh-fd[data-i='3'] .tyh-chip")?.textContent,
      replay: document.getElementById("replay")?.classList.contains("tyh-on"),
      hero: [...document.querySelectorAll(".tyh-hero-t > *")].every((el) => Number(getComputedStyle(el).opacity) === 1),
    }));
  // 1440x900: the H1 and the primary action fit the first screen; every
  // region starts at the same edge; the notice covers neither and, after a
  // scroll, is a slim bar.
  await screen(`${scheme} 1440x900 / first screen`, async () => {
    const ctx = await context({ width: 1440, height: 900 }, scheme);
    const page = await ctx.newPage();
    await visit(page, "/");
    const f = await firstScreen(page);
    const m = await page.evaluate(() => ({
      words: document.querySelector("main").innerText.split(/\s+/).filter(Boolean).length,
      h2: document.querySelectorAll("main h2").length,
      h1: document.querySelectorAll("h1").length,
    }));
    const label = `${scheme} 1440x900 /`;
    checked.push({ label, scanned: 0, low: 0, logo: "-" });
    if (f.h1 > 900 || f.cta > 900)
      fail(label, `H1 ends at ${Math.round(f.h1)}px, primary action at ${Math.round(f.cta)}px`);
    if (f.covered) fail(label, "the analytics notice covers the H1 or the primary action");
    if (new Set(Object.values(f.edges)).size !== 1)
      fail(label, `regions start at different edges: ${JSON.stringify(f.edges)}`);
    if (m.h1 !== 1) fail(label, `${m.h1} H1`);
    await page.mouse.wheel(0, 600);
    const bar = await page
      .locator(".consent-bar")
      .waitFor({ timeout: 10_000 })
      .then(() => page.locator(".consent-bar").boundingBox());
    // One row: the sentence, two 48 px choices and a 48 px Close.
    if (!bar || bar.height > 72) fail(label, `the analytics bar after a scroll is ${bar?.height}px tall (limit 72)`);
    await consentAnswerChecks(page, label, "No thanks");
    console.log(
      `home 1440x900 ${scheme}: H1 bottom ${Math.round(f.h1)}px, primary action bottom ${Math.round(f.cta)}px, edges ${JSON.stringify(f.edges)}, ${f.notices} notice(s) before scrolling, bar ${Math.round(bar?.height ?? 0)}px after, ${m.words} words in main, ${m.h2} H2`,
    );
    await ctx.close();
  });
  // 390x844: the H1 and the primary action on the first screen, uncovered
  // by the analytics notice.
  await screen(`${scheme} 390x844 / first screen`, async () => {
    const ctx = await context({ width: 390, height: 844 }, scheme);
    const page = await ctx.newPage();
    await visit(page, "/");
    const f = await firstScreen(page);
    const label = `${scheme} 390x844 /`;
    checked.push({ label, scanned: 0, low: 0, logo: "-" });
    if (f.h1 > 844 || f.cta > 844)
      fail(label, `H1 ends at ${Math.round(f.h1)}px, primary action at ${Math.round(f.cta)}px`);
    if (f.covered) fail(label, "the analytics notice covers the H1 or the primary action");
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
      `home 390x844 ${scheme}: H1 bottom ${Math.round(f.h1)}px, primary action bottom ${Math.round(f.cta)}px, ${f.notices} notice(s) before scrolling, bar ${phoneBar.height}px after`,
    );
    await ctx.close();
  });
  // Reduced motion (the device's setting, as in the design): nothing
  // animates, every block shows, and the feed shows its approved end at once.
  await screen(`${scheme} reduced motion /`, async () => {
    const label = `${scheme} reduced motion /`;
    const ctx = await context(VIEWPORTS[1], scheme, "reduce");
    const page = await ctx.newPage();
    await visit(page, "/");
    checked.push({ label, scanned: 0, low: 0, logo: "-" });
    const running = await animations(page);
    if (running.length) fail(label, `${running.length} animated element(s)`);
    const hidden = await page.evaluate(() =>
      [...document.querySelectorAll(".tyh-rv, .tyh-hw, .tyh-pt, .tyh-tl, .tyh-gd, .tyh-sx")]
        .filter((el) => Number(getComputedStyle(el).opacity) !== 1)
        .map((el) => el.getAttribute("class")),
    );
    if (hidden.length) fail(label, `${hidden.length} hidden: ${hidden.slice(0, 4).join("; ")}`);
    const feed = await feedAtRest(page);
    if (feed.shown !== 4 || feed.chip !== "Approved" || !feed.replay || !feed.hero)
      fail(label, `not the final picture at once: ${JSON.stringify(feed)}`);
    console.log(`home reduced motion ${scheme}: ${running.length} animated, ${hidden.length} hidden, feed ${JSON.stringify(feed)}`);
    await ctx.close();
  });
  // Motion allowed: the hero and the feed play once, nothing loops, the
  // last timed animation ends within 4.5 s, and after 5 s the feed rests
  // approved (the scroll scenes follow the scroll, not the clock).
  await screen(`${scheme} motion /`, async () => {
    const label = `${scheme} motion /`;
    const ctx = await context(VIEWPORTS[1], scheme);
    const page = await ctx.newPage();
    await page.goto(base + "/", { waitUntil: "domcontentloaded" });
    await page.locator(".tyh-hero").waitFor();
    checked.push({ label, scanned: 0, low: 0, logo: "-" });
    const timing = await animations(page);
    const end = Math.max(
      0,
      ...timing.map((t) => {
        const d = seconds(t.delay),
          l = seconds(t.duration);
        return Math.max(...l.map((x, i) => x + (d[i] ?? d[0])));
      }),
    );
    if (!timing.length) fail(label, "the hero has no entrance");
    if (timing.some((t) => t.count.includes("infinite"))) fail(label, "an animation repeats forever");
    if (end > 4.5) fail(label, `animation ends at ${end}s`);
    await page.waitForTimeout(5000);
    const feed = await feedAtRest(page);
    if (feed.shown !== 4 || feed.chip !== "Approved" || !feed.replay || !feed.hero)
      fail(label, `not at rest after 5 s: ${JSON.stringify(feed)}`);
    console.log(`home motion ${scheme}: ${timing.length} animated elements, last ends at ${end}s, feed ${JSON.stringify(feed)}`);
    await ctx.close();
  });
  // Right to left (1440): the layout mirrors with its logical properties
  // and the lockup keeps its orientation.
  await screen(`${scheme} rtl 1440 /`, async () => {
    const label = `${scheme} rtl 1440 /`;
    const ctx = await context(VIEWPORTS[1], scheme, "reduce");
    const page = await ctx.newPage();
    await visit(page, "/?lang=ar");
    const m = await page.evaluate(() => {
      const center = (el) => {
        const r = el.getBoundingClientRect();
        return r.left + r.width / 2;
      };
      const img = document.querySelector(".tyh-lockup img");
      return {
        dir: document.documentElement.dir,
        mirrored: center(document.querySelector(".tyh-hero-t")) > center(document.querySelector(".tyh-feed")),
        lockup: getComputedStyle(img).transform === "none" && getComputedStyle(img.parentElement).transform === "none",
      };
    });
    checked.push({ label, scanned: 0, low: 0, logo: "-" });
    if (m.dir !== "rtl") fail(label, `document direction ${m.dir}`);
    if (!m.mirrored) fail(label, "the hero did not mirror");
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
          // The home design's scroll scenes hide what is off screen, so its
          // every section is read with everything shown: under reduced
          // motion, as the design draws it then.
          if (route === "/") await page.emulateMedia({ reducedMotion: "reduce" });
          try {
            await visit(page, route);
            const waiting = await revealAll(page);
            if (waiting) fail(label, `${waiting} section(s) never revealed after a scroll-through`);
            assertPlatform(label, await measure(page), scheme, true);
            await shot(page, label);
          } finally {
            if (route === "/") await page.emulateMedia({ reducedMotion: "no-preference" });
          }
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
