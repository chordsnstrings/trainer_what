// trainsyou identity check (local Chromium only; never a cloud browser).
//
// Visits public marketing pages, sign-in pages, the directory and the
// trainer and Super admin workspace in light and dark colour schemes at
// 390px and 1440px, and fails on horizontal overflow, a missing or wrong
// lockup, text below WCAG AA contrast against its actual background, a
// missing trainsyou favicon, or page errors. Public platform pages are
// always light (28 September 2026): white canvas, the ink lockup, one white
// theme-color and no dark surface in either device scheme; the workspace
// keeps the white lockup in dark mode. The home page also gets a first
// screen, reduced-motion, animation, right-to-left and word-count pass. It
// also checks that a subscriber's member app and a coach website show their
// trainer's branding, never the platform's. Start it through
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
    const logo = [...document.querySelectorAll(".brand-logo img")].find(
      (img) => img.checkVisibility?.() && img.getBoundingClientRect().width > 0,
    );
    const root = document.documentElement;
    const icon = document.querySelector("link[rel~='icon']");
    // Always-light public pages: the document, the body and the page root
    // show white, and no visible surface except a button is dark (relative
    // luminance below 0.2). Thin rules and meters under 12px are not
    // surfaces.
    const rgb = (c) => (c ? `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})` : null);
    const pageRoot = document.querySelector(".mk, .public");
    const surfaces = {
      html: rgb(parse(getComputedStyle(root).backgroundColor)),
      body: rgb(backdrop(document.body)),
      root: pageRoot ? rgb(backdrop(pageRoot)) : null,
    };
    const dark = [];
    for (const el of document.body.querySelectorAll("*")) {
      if (el.closest(".button, .mk-fake-button")) continue;
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
    return {
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
 * The home page: the first screen at 1440x900 and 390x844, the word count,
 * the relay's motion with and without reduced motion, and the relay in
 * right to left.
 */
async function homeChecks(scheme) {
  const seconds = (v) =>
    v.split(",").map((s) => (s.trim().endsWith("ms") ? parseFloat(s) / 1000 : parseFloat(s)));
  // 1440x900: the whole hero, header included, fits the first screen.
  await screen(`${scheme} 1440x900 / first screen`, async () => {
    const ctx = await context({ width: 1440, height: 900 }, scheme);
    const page = await ctx.newPage();
    await visit(page, "/");
    const m = await page.evaluate(() => {
      const main = document.querySelector("main");
      const calc = document.querySelector(".mk-home-calc");
      const count = (t) => (t ?? "").split(/\s+/).filter(Boolean).length;
      return {
        heroBottom: document.querySelector(".mk-hero").getBoundingClientRect().bottom,
        words: count(main.innerText) - count(calc?.innerText),
        h2: [...main.querySelectorAll("h2")].length,
        h1: document.querySelectorAll("h1").length,
        relayH: document.querySelectorAll(".mk-relay h1, .mk-relay h2, .mk-relay h3, .mk-home-calc h1").length,
      };
    });
    checked.push({ label: `${scheme} 1440x900 /`, scanned: 0, low: 0, logo: "-" });
    if (m.heroBottom > 900) fail(`${scheme} 1440x900 /`, `hero ends at ${Math.round(m.heroBottom)}px`);
    if (m.words > 400) fail(`${scheme} 1440x900 /`, `${m.words} visible words in main (limit 400)`);
    if (m.h2 > 6) fail(`${scheme} 1440x900 /`, `${m.h2} H2 headings`);
    if (m.h1 !== 1 || m.relayH) fail(`${scheme} 1440x900 /`, `${m.h1} H1, ${m.relayH} headings in the relay or calculator`);
    console.log(`home 1440x900 ${scheme}: hero bottom ${Math.round(m.heroBottom)}px, ${m.words} words in main, ${m.h2} H2`);
    await ctx.close();
  });
  // 390x844: the H1 and the primary action on the first screen; steps stack.
  await screen(`${scheme} 390x844 / first screen`, async () => {
    const ctx = await context({ width: 390, height: 844 }, scheme);
    const page = await ctx.newPage();
    await visit(page, "/");
    const m = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll(".mk-relay-steps > li")].map((n) =>
        n.getBoundingClientRect(),
      );
      return {
        h1: document.querySelector("h1").getBoundingClientRect().bottom,
        cta: document.querySelector(".mk-hero .mk-cta").getBoundingClientRect().bottom,
        stacked:
          nodes.length === 3 &&
          nodes.every((r) => Math.abs(r.left - nodes[0].left) < 2) &&
          nodes[0].bottom <= nodes[1].top &&
          nodes[1].bottom <= nodes[2].top,
      };
    });
    checked.push({ label: `${scheme} 390x844 /`, scanned: 0, low: 0, logo: "-" });
    if (m.h1 > 844 || m.cta > 844)
      fail(`${scheme} 390x844 /`, `H1 ends at ${Math.round(m.h1)}px, primary action at ${Math.round(m.cta)}px`);
    if (!m.stacked) fail(`${scheme} 390x844 /`, "the relay steps do not stack vertically");
    console.log(`home 390x844 ${scheme}: H1 bottom ${Math.round(m.h1)}px, CTA bottom ${Math.round(m.cta)}px, steps stacked ${m.stacked}`);
    await ctx.close();
  });
  // Reduced motion: nothing animates and the final picture shows at once.
  await screen(`${scheme} reduced motion /`, async () => {
    const ctx = await context(VIEWPORTS[1], scheme, "reduce");
    const page = await ctx.newPage();
    await page.goto(base + "/", { waitUntil: "domcontentloaded" });
    await page.locator(".mk-relay").waitFor();
    const bad = await page.evaluate(() =>
      [...document.querySelectorAll(".mk-relay *")]
        .filter((el) => !el.classList.contains("mk-relay-dot"))
        .map((el) => [el, getComputedStyle(el)])
        .filter(([, s]) => s.animationName !== "none" || Number(s.opacity) !== 1)
        .map(([el, s]) => `${el.tagName.toLowerCase()}.${el.getAttribute("class")} ${s.animationName} ${s.opacity}`),
    );
    checked.push({ label: `${scheme} reduced motion /`, scanned: 0, low: 0, logo: "-" });
    if (bad.length) fail(`${scheme} reduced motion /`, `${bad.length} animated or hidden: ${bad.slice(0, 4).join("; ")}`);
    await ctx.close();
  });
  // Motion allowed: it plays once, ends within 4.5 s, and rests on the final
  // picture (the decorative dot rests hidden).
  await screen(`${scheme} motion /`, async () => {
    const ctx = await context(VIEWPORTS[1], scheme);
    const page = await ctx.newPage();
    await page.goto(base + "/", { waitUntil: "domcontentloaded" });
    await page.locator(".mk-relay").waitFor();
    const timing = await page.evaluate(() =>
      [...document.querySelectorAll(".mk *")].map((el) => {
        const s = getComputedStyle(el);
        return {
          name: s.animationName,
          delay: s.animationDelay,
          duration: s.animationDuration,
          count: s.animationIterationCount,
          relay: !!el.closest(".mk-relay"),
        };
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
    await page.waitForTimeout(5000);
    const resting = await page.evaluate(() =>
      [...document.querySelectorAll(".mk-relay *")]
        .map((el) => [el, Number(getComputedStyle(el).opacity)])
        .filter(([el, o]) => (el.classList.contains("mk-relay-dot") ? o !== 0 : o !== 1))
        .map(([el, o]) => `${el.getAttribute("class")} ${o}`),
    );
    checked.push({ label: `${scheme} motion /`, scanned: 0, low: 0, logo: "-" });
    if (!animated.some((t) => t.relay)) fail(`${scheme} motion /`, "the relay has no animation");
    if (infinite.length) fail(`${scheme} motion /`, `${infinite.length} infinite animation(s)`);
    if (end > 4.5) fail(`${scheme} motion /`, `animation ends at ${end}s`);
    if (resting.length) fail(`${scheme} motion /`, `not at rest after 5 s: ${resting.slice(0, 4).join("; ")}`);
    console.log(`home motion ${scheme}: ${animated.length} animated elements, last ends at ${end}s`);
    await ctx.close();
  });
  // Right to left (1440): the steps mirror, the wires point to the next
  // step, and the lockup and the relay mark keep their orientation.
  await screen(`${scheme} rtl 1440 /`, async () => {
    const ctx = await context(VIEWPORTS[1], scheme, "reduce");
    const page = await ctx.newPage();
    await visit(page, "/?lang=ar");
    const m = await page.evaluate(() => {
      const center = (r) => r.left + r.width / 2;
      const nodes = [...document.querySelectorAll(".mk-relay-steps > li")];
      const boxes = nodes.map((n) => n.getBoundingClientRect());
      const wires = nodes.slice(0, 2).map((n, i) => {
        const head = n.querySelector(".mk-relay-head").getBoundingClientRect();
        const wire = n.querySelector(".mk-relay-wire").getBoundingClientRect();
        return Math.sign(center(head) - center(wire)) === Math.sign(center(boxes[i + 1]) - center(wire));
      });
      const plain = (el) => {
        const s = getComputedStyle(el);
        return s.transform === "none" && (s.scale === "none" || s.scale === "1");
      };
      return {
        dir: document.documentElement.dir,
        mirrored: center(boxes[0]) > center(boxes[1]) && center(boxes[1]) > center(boxes[2]),
        wires,
        lockup: [...document.querySelectorAll(".brand-logo, .brand-logo img")].every(plain),
        mark: [...document.querySelectorAll(".mk-relay-mark, .mk-relay-mark svg")].every(plain),
      };
    });
    checked.push({ label: `${scheme} rtl 1440 /`, scanned: 0, low: 0, logo: "-" });
    if (m.dir !== "rtl") fail(`${scheme} rtl 1440 /`, `document direction ${m.dir}`);
    if (!m.mirrored) fail(`${scheme} rtl 1440 /`, "the relay steps did not mirror");
    if (!m.wires.every(Boolean)) fail(`${scheme} rtl 1440 /`, `wires point away: ${m.wires}`);
    if (!m.lockup || !m.mark) fail(`${scheme} rtl 1440 /`, "the lockup or the relay mark is mirrored");
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
          // The browser colour is the trainer's in both schemes: every
          // theme-color copy (the root layout has one per scheme) changes.
          const unified = () => {
            const metas = [...document.querySelectorAll("meta[name='theme-color']")];
            return (
              metas.length > 0 &&
              metas.every(
                (meta) =>
                  !meta.getAttribute("media") &&
                  meta.getAttribute("content") === metas[0].getAttribute("content"),
              ) &&
              !["#f3f4f0", "#171917"].includes(
                metas[0].getAttribute("content").toLowerCase(),
              )
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
