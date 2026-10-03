// Dark appearance check for subscriber surfaces (local Chromium only; never a
// cloud browser). docs/features/dark-mode.md.
//
// On a phone (390x844 and 360x740, touch) with the device in dark mode it
// signs in as the synthetic member and visits every member screen, a
// workout with its guided and voice-led sessions, the pain report sheet,
// the member app's "unavailable" screen and the coach website, and fails
// when:
// - the surface does not follow the device (no data-color-scheme, or the
//   document, the page root or the top and tab bars are not dark);
// - any visible text is below WCAG AA against the colour actually behind it
//   (4.5:1, 3:1 for large text; disabled controls included, since members
//   must be able to read why a button waits);
// - a form field's edge is below 3:1 against the surface it sits on;
// - a large light surface shows in dark mode (a hard-coded light colour),
//   except images and a coach logo's own plate;
// - the browser colour (theme-color) is not the coach's primary in light
//   and a dark colour in dark;
// - the page scrolls sideways.
// It then checks the member's choice: Profile and settings > Display
// preferences > Dark applies at once, survives a reload and a light device,
// and Light keeps the app light on a dark device; the choice is reset to
// "Match this device" at the end. The platform's public pages must stay
// light in dark mode. Start it through scripts/run-dark-check.mjs
// (npm run test:dark), which seeds data and starts the servers;
// DARK_CHECK_SHOTS=<dir> keeps a phone screenshot of each screen.
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const base = process.env.TEST_APP_URL ?? "http://localhost:3000";
const password = process.env.DEMO_PASSWORD;
if (!password) throw new Error("Use run-dark-check.mjs to generate fixture credentials");
const member = process.env.DARK_CHECK_MEMBER ?? "sam.taylor@example.test";
const coachSlug = process.env.DARK_CHECK_COACH ?? "alex-morgan";
const SHOTS = process.env.DARK_CHECK_SHOTS;
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
  (existsSync("/opt/pw-browsers/chromium")
    ? "/opt/pw-browsers/chromium"
    : undefined);
const PHONES = [
  { name: "390x844", width: 390, height: 844 },
  { name: "360x740", width: 360, height: 740 },
];
const MEMBER_ROUTES = [
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
const COACH_ROUTES = ["", "/about", "/memberships", "/galleries", "/contact"];
const PLATFORM_ROUTES = ["/", "/login", "/coaches"];

const failures = [];
const measured = [];
const pageErrors = [];
const fail = (label, message) => failures.push(`${label}: ${message}`);

/** Colours, contrast and surfaces, measured in the page. */
function inspect() {
  const parse = (c) => {
    const m = String(c).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const [r, g, b, a = 1] = m[1]
      .split(/[ ,/]+/)
      .filter(Boolean)
      .map(Number);
    return { r, g, b, a };
  };
  const hex = (v) => {
    const m = String(v)
      .trim()
      .match(/^#([0-9a-f]{6})$/i);
    if (!m) return parse(v);
    const n = parseInt(m[1], 16);
    return { r: n >> 16, g: (n >> 8) & 255, b: n & 255, a: 1 };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
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
  const root = document.documentElement;
  const rootBg = parse(getComputedStyle(root).backgroundColor);
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
      // A modal dialog sits in the top layer over its own backdrop.
      if (n.tagName === "DIALOG") break;
    }
    let color =
      rootBg && rootBg.a > 0 ? rootBg : { r: 255, g: 255, b: 255, a: 1 };
    for (const layer of layers.reverse()) color = blend(layer, color);
    return color;
  };
  const describe = (el) =>
    `${el.tagName.toLowerCase()}${
      typeof el.className === "string" && el.className
        ? "." + el.className.trim().split(/\s+/)[0]
        : ""
    } "${(el.textContent || el.getAttribute("aria-label") || "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 32)}"`;
  const shown = (el) =>
    !el.closest(
      "[aria-hidden='true'], [hidden], script, style, noscript, nextjs-portal",
    ) &&
    (!el.checkVisibility ||
      el.checkVisibility({ opacityProperty: true, visibilityProperty: true }));
  // Text contrast.
  const low = [];
  let scanned = 0;
  for (const el of document.body.querySelectorAll("*")) {
    const own = [...el.childNodes].some(
      (n) => n.nodeType === 3 && n.textContent.trim().length > 1,
    );
    if (!own || !shown(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const s = getComputedStyle(el);
    const fg = parse(s.color);
    const bg = backdrop(el);
    if (!fg || !bg) continue;
    scanned++;
    const text = fg.a < 1 ? blend(fg, bg) : fg;
    const size = parseFloat(s.fontSize),
      bold = Number(s.fontWeight) >= 700;
    const needed = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
    const value = ratio(text, bg);
    if (value < needed) low.push(`${describe(el)} ${value.toFixed(2)}:1`);
  }
  // Field edges (WCAG 1.4.11): 3:1 against the surface around the field.
  const lowFields = [];
  for (const el of document.querySelectorAll(
    "input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=range]):not([type=color]), select, textarea",
  )) {
    if (!shown(el) || el.closest(".number-stepper")) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || !el.parentElement) continue;
    const s = getComputedStyle(el);
    if (parseFloat(s.borderTopWidth) < 1) continue;
    const edge = parse(s.borderTopColor);
    const under = backdrop(el.parentElement);
    if (!edge || !under) continue;
    const value = ratio(edge.a < 1 ? blend(edge, under) : edge, under);
    if (value < 3) lowFields.push(`${describe(el)} ${value.toFixed(2)}:1`);
  }
  // Light surfaces left in dark mode.
  const light = [];
  for (const el of document.body.querySelectorAll("*")) {
    // A filled button may be light in dark mode (a light primary with dark
    // text); its text contrast is checked above.
    if (
      el.closest(
        "img, video, picture, canvas, svg, .coach-identity, nextjs-portal, button, .button, [role=button]",
      )
    )
      continue;
    const c = parse(getComputedStyle(el).backgroundColor);
    if (!c || c.a < 0.5 || lum(c) < 0.5) continue;
    if (!shown(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 40 || r.bottom <= 0) continue;
    light.push(`${describe(el)} rgb(${c.r}, ${c.g}, ${c.b})`);
  }
  const surface = document.querySelector("[data-color-scheme]");
  const lumOf = (el) => {
    const c = el ? backdrop(el) : null;
    return c ? Number(lum(c).toFixed(3)) : null;
  };
  const brand = surface ? getComputedStyle(surface) : null;
  return {
    path: location.pathname,
    scheme: surface?.getAttribute("data-color-scheme") ?? null,
    surfaceClass: surface?.className ?? null,
    rootLum: rootBg ? Number(lum(rootBg).toFixed(3)) : null,
    surfaceLum: lumOf(surface),
    topbarLum: lumOf(document.querySelector(".member-topbar")),
    tabbarLum: lumOf(document.querySelector(".member-tabbar")),
    colorScheme: surface ? getComputedStyle(surface).colorScheme : null,
    darkBar: brand?.getPropertyValue("--dark-white").trim() || null,
    themeColors: [...document.querySelectorAll("meta[name='theme-color']")].map(
      (m) => ({
        media: m.getAttribute("media"),
        color: m.getAttribute("content"),
      }),
    ),
    themeColorLum: [
      ...document.querySelectorAll("meta[name='theme-color']"),
    ].map((m) => {
      const c = hex(m.getAttribute("content") ?? "");
      return c ? Number(lum(c).toFixed(3)) : null;
    }),
    overflow: Math.max(
      root.scrollWidth - root.clientWidth,
      document.body.scrollWidth - document.body.clientWidth,
    ),
    loading: !!document.querySelector(".loading-screen .loading-indicator"),
    scanned,
    low,
    lowFields,
    light,
  };
}

async function settle(page) {
  await page
    .waitForFunction(
      () => !document.querySelector(".loading-screen .loading-indicator"),
      null,
      { timeout: 90_000 },
    )
    .catch(() => {});
  await page
    .waitForLoadState("networkidle", { timeout: 15_000 })
    .catch(() => {});
  await page.waitForTimeout(400);
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
async function shot(page, label) {
  if (!SHOTS) return;
  await page
    .screenshot({ path: `${SHOTS}/${label.replace(/[^a-z0-9]+/gi, "-")}.png` })
    .catch(() => {});
}

/** The dark rules for one measured screen. */
function assertDark(label, m, { shell = true } = {}) {
  measured.push({ label, ...m });
  if (m.loading) fail(label, "still loading");
  if (!m.scheme) fail(label, "the surface has no data-color-scheme");
  if (m.rootLum === null || m.rootLum > 0.05)
    fail(label, `the document background is not dark (luminance ${m.rootLum})`);
  if (m.surfaceLum === null || m.surfaceLum > 0.05)
    fail(label, `the page surface is not dark (luminance ${m.surfaceLum})`);
  if (m.colorScheme !== "dark") fail(label, `color-scheme is ${m.colorScheme}`);
  if (shell) {
    if (m.topbarLum === null || m.topbarLum > 0.06)
      fail(label, `the top bar is not dark (luminance ${m.topbarLum})`);
    if (m.tabbarLum === null || m.tabbarLum > 0.06)
      fail(label, `the tab bar is not dark (luminance ${m.tabbarLum})`);
  }
  if (m.overflow > 1) fail(label, `horizontal overflow of ${m.overflow}px`);
  if (m.low.length)
    fail(
      label,
      `${m.low.length} text element(s) below AA: ${m.low.slice(0, 6).join("; ")}`,
    );
  if (m.lowFields.length)
    fail(
      label,
      `${m.lowFields.length} field edge(s) below 3:1: ${m.lowFields.slice(0, 4).join("; ")}`,
    );
  if (m.light.length)
    fail(
      label,
      `${m.light.length} light surface(s) in dark mode: ${m.light.slice(0, 4).join("; ")}`,
    );
}

async function phoneContext(phone, colorScheme) {
  const ctx = await browser.newContext({
    viewport: { width: phone.width, height: phone.height },
    isMobile: phone.width < 1024,
    hasTouch: phone.width < 1024,
    colorScheme,
    serviceWorkers: "block",
  });
  ctx.setDefaultNavigationTimeout(180_000);
  ctx.setDefaultTimeout(60_000);
  // Stay inside the normal request budget.
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
async function signIn(ctx) {
  const response = await ctx.request.post(base + "/api/v1/auth/login", {
    headers: { origin: base },
    data: { email: member, password },
    failOnStatusCode: false,
  });
  if (response.status() !== 200)
    throw new Error(`member sign-in answered ${response.status()}`);
}
async function setChoice(ctx, theme) {
  const response = await ctx.request.put(
    base + "/api/v1/preferences/appearance",
    {
      headers: { origin: base },
      data: { theme },
      failOnStatusCode: false,
    },
  );
  if (!response.ok())
    throw new Error(`saving ${theme} answered ${response.status()}`);
}
async function answerAnalytics(page) {
  for (const name of [/without analytics/i, /^No thanks$/i]) {
    const choice = page.getByRole("button", { name });
    if (await choice.count().catch(() => 0))
      await choice
        .first()
        .click({ timeout: 5000 })
        .catch(() => {});
  }
}

const browser = await chromium.launch({
  headless: true,
  ...(executablePath ? { executablePath } : {}),
});
try {
  let install = null;
  for (const phone of PHONES) {
    const ctx = await phoneContext(phone, "dark");
    await signIn(ctx);
    // Start from the default: follow the device.
    await setChoice(ctx, "system");
    const page = await ctx.newPage();
    const boot = await (
      await ctx.request.get(base + "/api/v1/bootstrap")
    ).json();
    install ??= await (
      await ctx.request.get(base + "/api/v1/app/install")
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
    await page.goto(base + "/app", { waitUntil: "load" });
    await settle(page);
    await answerAnalytics(page);
    const routes = [
      ...MEMBER_ROUTES,
      ...(workout
        ? [
            `/app/workouts/${workout.id}`,
            `/app/guided/${workout.id}`,
            `/app/voice-session/${workout.id}`,
          ]
        : []),
    ];
    if (!workout) fail(phone.name, "no workout to check (seed a program)");
    for (const route of routes) {
      const label = `${phone.name} dark ${route.replace(/[0-9a-f-]{36}/, ":id")}`;
      try {
        await page.goto(base + route, { waitUntil: "load" });
        await settle(page);
        const m = await page.evaluate(inspect);
        if (m.path !== route) fail(label, `landed on ${m.path}`);
        assertDark(label, m);
        // The browser colour: the coach's primary in light, dark in dark.
        const light = m.themeColors.find((t) => t.media?.includes("light"));
        const dark = m.themeColors.find((t) => t.media?.includes("dark"));
        if (!light || !dark)
          fail(
            label,
            `theme-color ${JSON.stringify(m.themeColors)}, expected one per scheme`,
          );
        else {
          if (
            install?.themeColor &&
            light.color.toLowerCase() !== install.themeColor.toLowerCase()
          )
            fail(
              label,
              `light theme-color ${light.color}, the manifest has ${install.themeColor}`,
            );
          if (dark.color.toLowerCase() !== m.darkBar?.toLowerCase())
            fail(
              label,
              `dark theme-color ${dark.color}, the top bar is ${m.darkBar}`,
            );
        }
        await shot(page, label);
      } catch (e) {
        fail(label, e.message.split("\n")[0]);
      }
    }
    // The pain report sheet on the workout.
    if (workout) {
      const label = `${phone.name} dark pain report sheet`;
      try {
        await page.goto(base + `/app/workouts/${workout.id}`, {
          waitUntil: "load",
        });
        await settle(page);
        await page.locator(".sticky-action-bar .workout-pain").tap();
        await page.locator("dialog[open]").waitFor();
        await page.waitForTimeout(400);
        const m = await page.evaluate(inspect);
        const sheet = await page.evaluate(() => {
          const d = document.querySelector("dialog[open]");
          return d ? getComputedStyle(d).backgroundColor : null;
        });
        assertDark(label, m);
        if (
          !sheet ||
          !/rgba?\((\d+), (\d+), (\d+)/.test(sheet) ||
          sheet
            .match(/\d+/g)
            .slice(0, 3)
            .some((v) => Number(v) > 90)
        )
          fail(label, `the sheet background is ${sheet}`);
        await shot(page, label);
        await page.keyboard.press("Escape");
      } catch (e) {
        fail(label, e.message.split("\n")[0]);
      }
    }
    // A logged set (its glow and check), the rest timer and the next set.
    if (workout && phone === PHONES[0]) {
      const label = `${phone.name} dark workout after logging a set`;
      try {
        await page.goto(base + `/app/workouts/${workout.id}`, {
          waitUntil: "load",
        });
        await settle(page);
        const log = page.locator(".sticky-action-bar button", {
          hasText: /^Log set/,
        });
        if (await log.count()) {
          await log.first().tap();
          await page.waitForTimeout(1500);
          assertDark(label, await page.evaluate(inspect));
          await shot(page, label);
        } else fail(label, "no Log set button");
      } catch (e) {
        fail(label, e.message.split("\n")[0]);
      }
    }
    // The voice-led session running (text-guided without a trainer voice).
    if (workout && phone === PHONES[0]) {
      const label = `${phone.name} dark voice-led session running`;
      try {
        await page.goto(base + `/app/voice-session/${workout.id}`, {
          waitUntil: "load",
        });
        await settle(page);
        const start = page.getByRole("button", { name: /^Start .*session$/ });
        if (await start.count()) {
          await start.first().tap();
          await page.waitForTimeout(1500);
          await settle(page);
          assertDark(label, await page.evaluate(inspect));
          await shot(page, label);
        } else fail(label, "no Start button");
      } catch (e) {
        fail(label, e.message.split("\n")[0]);
      }
    }
    // The coach website.
    for (const route of COACH_ROUTES) {
      const label = `${phone.name} dark coach website${route || " home"}`;
      try {
        await page.goto(base + `/coach/${coachSlug}${route}`, {
          waitUntil: "load",
        });
        await settle(page);
        const m = await page.evaluate(inspect);
        assertDark(label, m, { shell: false });
        if (
          m.themeColors.length !== 2 ||
          m.themeColorLum.some((v) => v === null)
        )
          fail(
            label,
            `theme-color ${JSON.stringify(m.themeColors)}, expected one per scheme`,
          );
        else if (
          m.themeColors.find((t) => t.media?.includes("dark")) &&
          lumHex(m.themeColors.find((t) => t.media?.includes("dark")).color) >
            0.05
        )
          fail(
            label,
            `the dark theme-color is not dark: ${JSON.stringify(m.themeColors)}`,
          );
        await shot(page, label);
      } catch (e) {
        fail(label, e.message.split("\n")[0]);
      }
    }
    await ctx.close();
  }

  // Laptop width: the side navigation replaces the tab bar.
  {
    const ctx = await phoneContext({ width: 1280, height: 900 }, "dark");
    try {
      await signIn(ctx);
      const page = await ctx.newPage();
      for (const route of ["/app", "/app/profile"]) {
        const label = `1280x900 dark ${route}`;
        await page.goto(base + route, { waitUntil: "load" });
        await settle(page);
        await answerAnalytics(page);
        const m = await page.evaluate(inspect);
        assertDark(label, m, { shell: false });
        const side = await page.evaluate(() => {
          const nav = document.querySelector(
            ".member-sidenav, .member-shell aside, .member-side",
          );
          return nav ? getComputedStyle(nav).backgroundColor : null;
        });
        if (
          !side ||
          side
            .match(/\d+/g)
            .slice(0, 3)
            .some((v) => Number(v) > 90)
        )
          fail(label, `the side navigation background is ${side}`);
        await shot(page, label);
      }
    } catch (e) {
      fail("1280x900 dark", e.message.split("\n")[0]);
    } finally {
      await ctx.close();
    }
  }

  // The member app's "unavailable" screen, before the coach's brand is known.
  {
    const label = "390x844 dark workspace unavailable";
    const ctx = await phoneContext(PHONES[0], "dark");
    try {
      await signIn(ctx);
      await ctx.route("**/api/v1/bootstrap", (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: "{}",
        }),
      );
      const page = await ctx.newPage();
      await page.goto(base + "/app/more", { waitUntil: "load" });
      await page
        .getByRole("heading", { name: "Your coaching app could not open", exact: true })
        .waitFor();
      await page.waitForTimeout(300);
      assertDark(label, await page.evaluate(inspect), { shell: false });
      await shot(page, label);
    } catch (e) {
      fail(label, e.message.split("\n")[0]);
    } finally {
      await ctx.close();
    }
  }

  // The member's own choice.
  {
    const ctx = await phoneContext(PHONES[0], "light");
    try {
      await signIn(ctx);
      await setChoice(ctx, "system");
      const page = await ctx.newPage();
      await page.goto(base + "/app/profile", { waitUntil: "load" });
      await settle(page);
      await answerAnalytics(page);
      const scheme = () =>
        page.evaluate(() => ({
          choice: document
            .querySelector(".member-shell")
            ?.getAttribute("data-color-scheme"),
          dark:
            getComputedStyle(document.querySelector(".member-shell"))
              .colorScheme === "dark",
          cookie:
            document.cookie.match(/trainer_member_scheme=(\w+)/)?.[1] ?? null,
          metas: [...document.querySelectorAll("meta[name='theme-color']")].map(
            (m) => [m.getAttribute("media"), m.getAttribute("content")],
          ),
        }));
      let label = "light device, Display preferences > Dark";
      const before = await scheme();
      if (before.choice !== "system" || before.dark)
        fail(label, `before choosing: ${JSON.stringify(before)}`);
      await page.getByRole("radio", { name: /^Dark/ }).check();
      await page
        .getByText("Display preference saved.")
        .waitFor({ timeout: 20_000 });
      let now = await scheme();
      if (now.choice !== "dark" || !now.dark || now.cookie !== "dark")
        fail(label, `after choosing: ${JSON.stringify(now)}`);
      if (
        now.metas.some(([media]) => media) ||
        lumHex(now.metas[0]?.[1] ?? "") > 0.05
      )
        fail(
          label,
          `browser colour ${JSON.stringify(now.metas)}, expected one dark colour`,
        );
      const saved = await (
        await ctx.request.get(base + "/api/v1/notifications/preferences")
      ).json();
      if (saved.data?.theme !== "dark")
        fail(label, `saved theme ${saved.data?.theme}`);
      label = "light device, Dark after a reload";
      await page.goto(base + "/app", { waitUntil: "load" });
      await settle(page);
      assertDark(label, await page.evaluate(inspect));
      // The loading screen of the next visit already follows the choice.
      const first = await page.evaluate(() =>
        document
          .querySelector(".member-neutral, .member-shell")
          ?.getAttribute("data-color-scheme"),
      );
      if (first !== "dark") fail(label, `first paint scheme ${first}`);
      await shot(page, "choice-dark-on-light-device");
      label = "dark device, Display preferences > Light";
      await setChoice(ctx, "light");
      const darkCtx = await phoneContext(PHONES[0], "dark");
      await darkCtx.addCookies(await ctx.cookies());
      const darkPage = await darkCtx.newPage();
      await darkPage.goto(base + "/app", { waitUntil: "load" });
      await settle(darkPage);
      const lightNow = await darkPage.evaluate(inspect);
      if (
        lightNow.scheme !== "light" ||
        lightNow.surfaceLum < 0.5 ||
        lightNow.colorScheme !== "light"
      )
        fail(
          label,
          `scheme ${lightNow.scheme}, surface luminance ${lightNow.surfaceLum}, color-scheme ${lightNow.colorScheme}`,
        );
      if (lightNow.low.length)
        fail(
          label,
          `${lightNow.low.length} text element(s) below AA: ${lightNow.low.slice(0, 4).join("; ")}`,
        );
      await shot(darkPage, "choice-light-on-dark-device");
      await darkCtx.close();
      measured.push({ label: "member choice", ok: true });
    } catch (e) {
      fail("member choice", e.message.split("\n")[0]);
    } finally {
      await setChoice(ctx, "system").catch(() => {});
      await ctx.close();
    }
  }

  // The platform's own public pages stay light, even for a member who chose
  // Dark on this device.
  {
    const ctx = await phoneContext(PHONES[0], "dark");
    await ctx.addCookies([
      { name: "trainer_member_scheme", value: "dark", url: base },
    ]);
    const page = await ctx.newPage();
    for (const route of PLATFORM_ROUTES) {
      const label = `390x844 dark platform ${route}`;
      try {
        await page.goto(base + route, { waitUntil: "load" });
        await settle(page);
        const m = await page.evaluate(inspect);
        measured.push({ label, ...m });
        if (m.scheme)
          fail(label, `a platform page carries data-color-scheme=${m.scheme}`);
        if (m.rootLum === null || m.rootLum < 0.9)
          fail(label, `the document is not white (luminance ${m.rootLum})`);
      } catch (e) {
        fail(label, e.message.split("\n")[0]);
      }
    }
    await ctx.close();
  }
} finally {
  await browser.close();
  await mkdir("test-results", { recursive: true });
  await writeFile(
    "test-results/dark-check.json",
    JSON.stringify({ failures, pageErrors, measured }, null, 2),
  );
}

function lumHex(value) {
  const m = String(value)
    .trim()
    .match(/^#([0-9a-f]{6})$/i);
  if (!m) return 1;
  const n = parseInt(m[1], 16);
  const f = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(n >> 16) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
}

const screens = measured.filter((m) => "scanned" in m);
console.log(
  `Dark check: ${screens.length} screens (${screens.reduce((n, m) => n + m.scanned, 0)} text elements scanned), ${failures.length} failure(s), ${pageErrors.length} page error(s).`,
);
for (const f of failures) console.log("FAIL " + f);
for (const e of [...new Set(pageErrors)].slice(0, 20))
  console.log("PAGE ERROR " + e);
if (failures.length || pageErrors.length) process.exitCode = 1;
