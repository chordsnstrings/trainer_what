// trainsyou identity check (local Chromium only; never a cloud browser).
//
// Visits public marketing pages, sign-in pages, the directory and the
// trainer and Super admin workspace in light and dark colour schemes at
// 390px and 1440px, and fails on horizontal overflow, a missing or wrong
// lockup for the scheme, text below WCAG AA contrast against its actual
// background, a missing trainsyou favicon, or page errors. It also checks
// that a subscriber's member app and a coach website show their trainer's
// branding, never the platform's. Start it through
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
  "/pricing",
  "/features",
  "/follower-calculator",
  "/about",
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

async function context(viewport, colorScheme) {
  const ctx = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    colorScheme,
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
    const logo = [...document.querySelectorAll(".brand-logo img")].find(
      (img) => img.checkVisibility?.() && img.getBoundingClientRect().width > 0,
    );
    const root = document.documentElement;
    const icon = document.querySelector("link[rel~='icon']");
    return {
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
    };
  });
}

function assertPlatform(label, m, scheme) {
  checked.push({ label, scanned: m.scanned, low: m.low.length, logo: m.logo });
  if (m.overflow > 1) fail(label, `horizontal overflow of ${m.overflow}px`);
  if (!m.platformUi) fail(label, "the platform surface is not .platform-ui");
  const expected =
    scheme === "dark"
      ? "/brand/trainsyou-lockup-white.svg"
      : "/brand/trainsyou-lockup-ink.svg";
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
}

/** BRAND_CHECK_SHOTS=<dir> keeps a first-screen image of a few pages. */
const SHOTS = process.env.BRAND_CHECK_SHOTS;
async function shot(page, label) {
  if (!SHOTS || !/ (\/|\/pricing|\/login|\/trainer|\/admin\/settings)$/.test(label))
    return;
  const name = label.replace(/[^a-z0-9]+/gi, "-").replace(/-+$/, "");
  await page.screenshot({ path: `${SHOTS}/${name}.png` }).catch(() => {});
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
          assertPlatform(label, await measure(page), scheme);
          await shot(page, label);
        });
      }
    }
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
