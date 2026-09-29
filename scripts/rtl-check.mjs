// Right-to-left layout check (local Chromium only; never a cloud browser).
//
// Visits the public, trainer, follower and Super admin screens of a seeded
// synthetic development app with the document in Arabic/right to left, at
// 390px and 1440px, and fails on horizontal page overflow, controls clipped
// outside the viewport, navigation that did not mirror, directional icons
// that did not flip, or the wrong document language source. Start it through
// scripts/run-rtl-check.mjs, which seeds data and starts the servers.
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";

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
const PUBLIC_ROUTES = [
  "/",
  "/how-it-works",
  "/pricing",
  "/faq",
  "/login",
  "/signup",
  "/coaches",
  "/join-coach/alex-morgan",
];
const TRAINER_ROUTES = [
  "/trainer",
  "/trainer/brain",
  "/trainer/subscribers",
  "/trainer/programs",
  "/trainer/nutrition",
  "/trainer/messages",
  "/trainer/notifications",
  "/trainer/bookings",
  "/trainer/finance",
  "/trainer/design",
  "/trainer/website",
  "/trainer/website/preview",
  "/trainer/team",
  "/trainer/settings",
];
const ADMIN_ROUTES = [
  "/admin",
  "/admin/settings",
  "/admin/governance",
  "/admin/metrics",
  "/admin/infrastructure",
  "/admin/support",
];
const FOLLOWER_ROUTES = [
  "/app",
  "/app/program",
  "/app/nutrition",
  "/app/nutrition/log",
  "/app/chat",
  "/app/bookings",
  "/app/progress",
  "/app/membership",
  "/app/profile",
  "/app/more",
];

const failures = [];
const checked = [];
const pageErrors = [];
function fail(label, message) {
  failures.push(`${label}: ${message}`);
}

const browser = await chromium.launch({
  headless: true,
  ...(executablePath ? { executablePath } : {}),
});

/** A browser context whose API calls stay inside the normal request budget. */
async function context(viewport) {
  const ctx = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
  });
  ctx.setDefaultNavigationTimeout(180_000);
  ctx.setDefaultTimeout(60_000);
  let next = 0;
  await ctx.route("**/api/v1/**", async (route) => {
    const now = Date.now(),
      wait = Math.max(0, next - now);
    next = now + wait + 600;
    if (wait) await new Promise((r) => setTimeout(r, wait));
    await route.continue().catch(() => {});
  });
  ctx.on("page", (page) => {
    page.on("pageerror", (e) => pageErrors.push(`${page.url()}: ${e.message}`));
    // In-flight API requests. Playwright's "networkidle" never settles on a
    // production build here (aborted link prefetches under routing), so
    // screens wait for their own API calls instead.
    const api = (r) => r.url().includes("/api/v1/");
    inflight.set(page, 0);
    const done = (r) => {
      if (api(r)) inflight.set(page, Math.max(0, inflight.get(page) - 1));
    };
    page.on("request", (r) => {
      if (api(r)) inflight.set(page, inflight.get(page) + 1);
    });
    page.on("requestfinished", done);
    page.on("requestfailed", done);
  });
  return ctx;
}
const inflight = new WeakMap();
/** Waits until the page has had no API request in flight for 800 ms. */
async function apiIdle(page, timeout = 45_000) {
  const until = Date.now() + timeout;
  let quietSince = Date.now();
  while (Date.now() < until) {
    if ((inflight.get(page) ?? 0) > 0) quietSince = Date.now();
    else if (Date.now() - quietSince >= 800) return;
    await page.waitForTimeout(100);
  }
}
/** React has hydrated the page's first form (a click before would submit natively). */
async function hydrated(page) {
  await page.waitForFunction(() => {
    const form = document.querySelector("form");
    return !!form && Object.keys(form).some((k) => k.startsWith("__react"));
  });
}

async function settle(page) {
  await page
    .waitForFunction(() => !document.querySelector(".loading-screen"), null, {
      timeout: 60_000,
    })
    .catch(() => {});
  await page.locator("h1").first().waitFor({ timeout: 60_000 });
  await apiIdle(page);
  await page.waitForTimeout(250);
}

async function visit(page, path) {
  await page.goto(base + path, { waitUntil: "load" });
  await settle(page);
}

/** Geometry and direction facts about the current page. */
function measure(page) {
  return page.evaluate(() => {
    const root = document.documentElement,
      width = window.innerWidth;
    const describe = (el) =>
      `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${
        typeof el.className === "string" && el.className
          ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".")
          : ""
      } "${(el.getAttribute("aria-label") || el.textContent || "")
        .trim()
        .slice(0, 40)}"`;
    const sidebar = document.querySelector(".sidebar");
    const sidebarRect = sidebar?.getBoundingClientRect();
    const sidebarOffCanvas =
      !!sidebarRect &&
      (sidebarRect.right <= 1 || sidebarRect.left >= width - 1);
    // A control is clipped when it is rendered but lies partly outside the
    // viewport horizontally, and no scroll container inside the page lets the
    // member reach it. Only overflow-x auto/scroll can be scrolled; an
    // ancestor with overflow hidden or clip cuts the control off.
    const clipped = [];
    for (const el of document.querySelectorAll(
      "a[href], button, input:not([type=hidden]), select, textarea, [role=button], summary",
    )) {
      if (el.closest(".site-honeypot, [aria-hidden='true'], [hidden]"))
        continue;
      if (sidebarOffCanvas && sidebar.contains(el)) continue;
      if (
        typeof el.checkVisibility === "function" &&
        !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })
      )
        continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      if (r.left >= -1 && r.right <= width + 1) continue;
      let scroller = el.parentElement,
        reachable = false;
      while (scroller && scroller !== document.body) {
        const style = getComputedStyle(scroller);
        if (
          /(auto|scroll)/.test(style.overflowX) &&
          scroller.scrollWidth > scroller.clientWidth + 1
        ) {
          const s = scroller.getBoundingClientRect();
          reachable = s.left >= -1 && s.right <= width + 1;
          break;
        }
        if (/(hidden|clip)/.test(style.overflowX)) break;
        scroller = scroller.parentElement;
      }
      if (!reachable) clipped.push(describe(el));
    }
    const mirrored = (selector) => {
      const icon = document.querySelector(selector);
      if (!icon) return null;
      const t = getComputedStyle(icon).transform;
      return t.startsWith("matrix(-1");
    };
    const center = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return r.width ? r.left + r.width / 2 : null;
    };
    const main = document
      .querySelector(".workspace > .main")
      ?.getBoundingClientRect();
    // The member app (components/member-shell.tsx): a side navigation from
    // 1024 px, a bottom tab bar below that.
    const visibleRect = (selector) => {
      const el = document.querySelector(selector);
      if (!el || getComputedStyle(el).display === "none") return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    };
    const memberShell = !!document.querySelector(".member-shell");
    const memberSide = visibleRect(".member-sidenav");
    const memberFrame = visibleRect(".member-frame");
    const memberTabs = visibleRect(".member-tabbar");
    const memberCurrentTab = document.querySelector(
      ".member-tabbar [aria-current='page']",
    )
      ? true
      : false;
    return {
      main: main ? { left: main.left, right: main.right } : null,
      dir: root.dir,
      lang: root.lang,
      bodyDirection: getComputedStyle(document.body).direction,
      width,
      overflow: root.scrollWidth - root.clientWidth,
      bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
      clipped: clipped.slice(0, 8),
      clippedCount: clipped.length,
      sidebar: sidebarRect
        ? { left: sidebarRect.left, right: sidebarRect.right }
        : null,
      sidebarOffCanvas,
      memberShell,
      memberSide,
      memberFrame,
      memberTabs,
      memberCurrentTab,
      memberBackMirrored: mirrored(".member-back .lucide-chevron-left"),
      chevronMirrored: mirrored(".topbar .lucide-chevron-right"),
      arrowMirrored: mirrored(".lucide-arrow-right, .lucide-arrow-up-right"),
      // The marketing header (.mk-header, its content in .mk-header-inner)
      // replaced .public-header on the platform pages; coach pages keep
      // .public-header.
      publicWordmark: center(
        ".public-header > .wordmark, .mk-header-inner > .wordmark",
      ),
      publicAction: center(
        ".public-header > .button, .mk-header-actions > .button",
      ),
      siteIdentity: center(".site-header > a"),
      siteNav: center(".site-header > nav"),
      emailDirection: (() => {
        const input = document.querySelector("input[type=email]");
        return input ? getComputedStyle(input).direction : null;
      })(),
      // A web address typed after a fixed prefix reads left to right.
      affixPrefixFirst: (() => {
        const affix = document.querySelector(".input-affix");
        const prefix = affix?.querySelector("span"),
          input = affix?.querySelector("input");
        if (!prefix || !input) return null;
        return (
          prefix.getBoundingClientRect().right <=
          input.getBoundingClientRect().left + 1
        );
      })(),
      // Timestamps pushed to the end of an audit row stay at its end (the
      // left edge in right to left).
      auditTimesAtEnd: (() => {
        const rows = [...document.querySelectorAll(".ps-audit-list li")]
          .map((li) => [li, li.querySelector(":scope > time")])
          .filter(([, time]) => time);
        if (!rows.length || width < 651) return null;
        return rows.every(
          ([li, time]) =>
            Math.abs(
              time.getBoundingClientRect().left -
                li.getBoundingClientRect().left,
            ) <= 1,
        );
      })(),
    };
  });
}

/** The common right-to-left assertions for one rendered screen. */
async function assertRtl(page, label, extra = {}) {
  const m = await measure(page);
  checked.push({ label, ...m });
  if (m.dir !== "rtl" || m.lang !== "ar")
    fail(label, `document is lang=${m.lang} dir=${m.dir}, expected ar/rtl`);
  if (m.bodyDirection !== "rtl")
    fail(label, "body is not laid out right to left");
  if (m.overflow > 1 || m.bodyOverflow > 1)
    fail(
      label,
      `horizontal overflow of ${Math.max(m.overflow, m.bodyOverflow)}px`,
    );
  if (m.clippedCount)
    fail(
      label,
      `${m.clippedCount} clipped control(s): ${m.clipped.join("; ")}`,
    );
  if (m.emailDirection && m.emailDirection !== "ltr")
    fail(label, "an email field is not left to right");
  if (m.arrowMirrored === false)
    fail(label, "a forward arrow icon did not mirror");
  if (m.affixPrefixFirst === false)
    fail(label, "an address prefix is not left of its input");
  if (m.auditTimesAtEnd === false)
    fail(label, "an audit timestamp is not at the end of its row");
  if (extra.workspace && m.memberShell) {
    // The member app: side navigation on the right from 1024 px, else a
    // bottom tab bar with the current tab marked; no navigation drawer.
    if (m.width >= 1024) {
      if (!m.memberSide) fail(label, "no member side navigation");
      else if (Math.abs(m.memberSide.right - m.width) > 1)
        fail(
          label,
          `member navigation is not on the right (right edge ${m.memberSide.right})`,
        );
      else if (!m.memberFrame || m.memberFrame.right > m.memberSide.left + 1)
        fail(label, "member content overlaps the side navigation");
    } else {
      if (!m.memberTabs) fail(label, "no bottom tab bar");
      else if (!m.memberCurrentTab)
        fail(label, "no tab is marked as the current page");
      if (m.memberSide) fail(label, "the side navigation shows on a phone");
    }
    if (m.memberBackMirrored === false)
      fail(label, "the back button's chevron did not mirror");
  } else if (extra.workspace) {
    if (!m.sidebar) fail(label, "no workspace navigation");
    else if (m.width >= 651) {
      if (Math.abs(m.sidebar.right - m.width) > 1)
        fail(
          label,
          `navigation is not on the right (right edge ${m.sidebar.right})`,
        );
      // The content column sits beside the navigation, not under it.
      if (!m.main || m.main.right > m.sidebar.left + 1 || m.main.left < -1)
        fail(
          label,
          `content overlaps the navigation (${JSON.stringify(m.main)})`,
        );
    } else if (!m.sidebarOffCanvas || m.sidebar.left < m.width - 1)
      fail(label, "closed mobile navigation is not off canvas on the right");
    if (m.chevronMirrored === false)
      fail(label, "the breadcrumb chevron did not mirror");
  }
  if (extra.publicHeader && m.width >= 651 && m.publicWordmark !== null) {
    if (!(m.publicWordmark > (m.publicAction ?? 0)))
      fail(
        label,
        "public header did not mirror (wordmark should be on the right)",
      );
  }
  if (extra.coachSite && m.siteIdentity !== null && m.siteNav !== null) {
    if (m.width >= 651 && !(m.siteIdentity > m.siteNav))
      fail(label, "coach website header did not mirror");
  }
  return m;
}

/** The mobile navigation opens from the right edge and closes again. */
async function assertMobileNavigation(page, label) {
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.waitForTimeout(400);
  const open = await page.evaluate(() => {
    const r = document.querySelector(".sidebar").getBoundingClientRect();
    return { left: r.left, right: r.right, width: window.innerWidth };
  });
  if (Math.abs(open.right - open.width) > 1 || open.left < 0)
    fail(
      label,
      `opened navigation is not against the right edge (${JSON.stringify(open)})`,
    );
  const clipped = await measure(page);
  if (clipped.clippedCount)
    fail(label, `open navigation clips ${clipped.clipped.join("; ")}`);
  await page.getByRole("button", { name: "Close navigation" }).click();
  await page.waitForTimeout(400);
}

async function signIn(page, email) {
  await page.goto(base + "/login", { waitUntil: "load" });
  await settle(page);
  // A click before hydration would submit the form natively (as a GET).
  await hydrated(page);
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/(trainer|app)(\/|$)/, { timeout: 120_000 });
  await settle(page);
}

/** Saves the member's language in the real settings screen. */
async function chooseLanguage(page, settingsPath, value) {
  await visit(page, settingsPath);
  const select = page.getByLabel("Message language");
  await select.waitFor();
  await select.selectOption(value);
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/v1/notifications/preferences") &&
        r.request().method() === "PUT",
    ),
    page.getByRole("button", { name: "Save preferences" }).click(),
  ]);
  if (!response.ok())
    throw new Error(`Saving the language failed: ${response.status()}`);
  await page.waitForFunction(
    (lang) => document.documentElement.lang === lang,
    value,
  );
}

/** Runs one screen's checks; an interaction that fails is a finding, not a crash. */
async function screen(label, fn) {
  try {
    await fn();
  } catch (e) {
    fail(label, String(e?.message ?? e).split("\n")[0]);
  }
}

/** The server-rendered <html> of a page for this context's cookies. */
async function serverHtml(ctx, path) {
  const response = await ctx.request.get(base + path);
  const html = await response.text();
  const match = /<html[^>]*>/.exec(html);
  return match ? match[0] : "";
}

// RTL_CHECK_ONLY=sources,public,trainer,follower limits a local run.
const only = new Set(
  (process.env.RTL_CHECK_ONLY ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);
const want = (section) => !only.size || only.has(section);

try {
  // 1. Language sources on public pages (fresh visitor, no cookie).
  if (want("sources")) {
    const ctx = await context(VIEWPORTS[1]);
    const page = await ctx.newPage();
    await visit(page, "/");
    const english = await measure(page);
    if (english.dir !== "ltr" || english.lang !== "en")
      fail(
        "default",
        `a new visitor sees lang=${english.lang} dir=${english.dir}`,
      );
    // English baseline: the public header keeps the wordmark on the left.
    if (!(english.publicWordmark < english.publicAction))
      fail("default", "English public header is not left to right");
    await visit(page, "/?lang=ar");
    await assertRtl(page, "public / ?lang=ar", { publicHeader: true });
    const cookie = (await ctx.cookies()).find((c) => c.name === "trainer_lang");
    if (cookie?.value !== "ar")
      fail("?lang=ar", "the language cookie was not set");
    // The cookie carries the choice to the next server render.
    if (!/lang="ar" dir="rtl"/.test(await serverHtml(ctx, "/pricing")))
      fail("cookie", "the server did not render the cookie's language");
    await visit(page, "/?lang=en");
    const back = await measure(page);
    if (back.dir !== "ltr")
      fail("?lang=en", "an explicit English choice did not apply");
    await ctx.close();
  }

  // 2. The coach publishes an Arabic website (real API, signed-in coach).
  if (want("sources") || want("public")) {
    const ctx = await context(VIEWPORTS[1]);
    const page = await ctx.newPage();
    await signIn(page, "coach@example.test");
    const result = await page.evaluate(async () => {
      const call = async (path, method = "GET", body) => {
        const r = await fetch("/api/v1" + path, {
          method,
          credentials: "same-origin",
          headers: body ? { "Content-Type": "application/json" } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        });
        const data = await r.json();
        if (!r.ok) throw new Error(`${path}: ${r.status} ${data.message}`);
        return data;
      };
      const current = await call("/tenant/site");
      const saved = await call("/tenant/site", "PUT", {
        version: current.version,
        site: {
          ...current.draft,
          language: "ar",
          headline: "تدريب يناسب حياتك",
          introduction:
            "برنامج قوة واضح وممتع، مع متابعة شخصية من مدربك. Strength that fits your week.",
          contactEmail: "alex@example.test",
          whatsapp: "+971501234567",
          cta: "ابدأ التدريب",
        },
      });
      await call("/tenant/site/publish", "POST", { version: saved.version });
      return saved.draft.language;
    });
    if (result !== "ar") fail("website", "the website language was not saved");
    if (want("sources")) {
      // The signed-in coach (language never chosen, so English) viewing
      // their own Arabic website on this device: the workspace mirrors the
      // member's language into its own cookie, never the explicit choice, so
      // the website keeps its language while the workspace stays English.
      const label = "signed-in coach's own Arabic website";
      // The workspace has applied the member's saved language once a
      // language cookie appears (a missing one is a finding below).
      await page
        .waitForFunction(
          () => /(^|; )trainer(_member)?_lang=/.test(document.cookie),
          null,
          { timeout: 30_000 },
        )
        .catch(() => {});
      const cookies = await ctx.cookies();
      if (cookies.find((c) => c.name === "trainer_member_lang")?.value !== "en")
        fail(label, "the member language cookie is not English");
      if (cookies.some((c) => c.name === "trainer_lang"))
        fail(label, "the workspace wrote the visitor's explicit choice");
      if (
        !/lang="ar" dir="rtl"/.test(await serverHtml(ctx, "/coach/alex-morgan"))
      )
        fail(label, "the server did not render the website's language");
      if (!/lang="en" dir="ltr"/.test(await serverHtml(ctx, "/trainer")))
        fail(label, "the workspace did not keep the member's language");
      await screen(label, async () => {
        await visit(page, "/coach/alex-morgan");
        await assertRtl(page, label, { coachSite: true });
      });
    }
    await ctx.close();
  }
  if (want("sources")) {
    // A visitor without a language choice gets the website's own language.
    const ctx = await context(VIEWPORTS[1]);
    const page = await ctx.newPage();
    if (
      !/lang="ar" dir="rtl"/.test(await serverHtml(ctx, "/coach/alex-morgan"))
    )
      fail("coach website", "the server did not render the website's language");
    await visit(page, "/coach/alex-morgan");
    await assertRtl(page, "coach website (site language)", { coachSite: true });
    await visit(page, "/coach/alex-morgan?lang=en");
    const english = await measure(page);
    if (english.dir !== "ltr")
      fail(
        "coach website ?lang=en",
        "the visitor's explicit choice did not win",
      );
    await ctx.close();
  }

  // 3. Every audience in right to left at both widths.
  for (const viewport of want("public") ? VIEWPORTS : []) {
    const ctx = await context(viewport);
    const page = await ctx.newPage();
    await visit(page, "/?lang=ar");
    for (const route of PUBLIC_ROUTES) {
      const label = `${viewport.name} public ${route}`;
      await screen(label, async () => {
        await visit(page, route);
        await assertRtl(page, label, { publicHeader: true });
      });
    }
    for (const section of ["", "/about", "/memberships", "/contact"]) {
      const label = `${viewport.name} coach website ${section || "/"}`;
      await screen(label, async () => {
        await visit(page, "/coach/alex-morgan" + section);
        await assertRtl(page, label, { coachSite: true });
      });
    }
    await ctx.close();
  }

  const members = [
    {
      email: "coach@example.test",
      settings: "/trainer/settings",
      routes: [...TRAINER_ROUTES, ...ADMIN_ROUTES],
      audience: "trainer/admin",
      section: "trainer",
    },
    {
      email: "sam.taylor@example.test",
      settings: "/app/profile",
      routes: FOLLOWER_ROUTES,
      audience: "follower",
      section: "follower",
    },
  ];
  for (const member of members.filter((m) => want(m.section))) {
    const ctx = await context(VIEWPORTS[1]);
    const page = await ctx.newPage();
    await signIn(page, member.email);
    // English until the member chooses Arabic; the choice applies at once,
    // is saved to the account and reaches the next server render.
    const before = await measure(page);
    if (before.dir !== "ltr")
      fail(
        member.audience,
        "the workspace was not left to right before the choice",
      );
    await chooseLanguage(page, member.settings, "ar");
    if (!/lang="ar" dir="rtl"/.test(await serverHtml(ctx, member.routes[0])))
      fail(
        member.audience,
        "the saved language did not reach the server render",
      );
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      for (const route of member.routes) {
        const label = `${viewport.name} ${member.audience} ${route}`;
        await screen(label, async () => {
          await visit(page, route);
          await assertRtl(page, label, { workspace: true });
          // Members navigate with the bottom tab bar (checked above); the
          // drawer belongs to the trainer and operator workspace.
          if (
            viewport.width < 651 &&
            route === member.routes[0] &&
            member.section !== "follower"
          )
            await assertMobileNavigation(
              page,
              `${viewport.name} ${member.audience} navigation`,
            );
        });
      }
    }
    // Leave the synthetic member in English for other local checks.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await chooseLanguage(page, member.settings, "en").catch((e) =>
      fail(
        `${member.audience} reset`,
        `switching back to English failed: ${e.message}`,
      ),
    );
    await ctx.close();
  }
} finally {
  await browser.close();
  await mkdir("test-results", { recursive: true });
  await writeFile(
    "test-results/rtl-check.json",
    JSON.stringify({ failures, pageErrors, checked }, null, 2),
  );
}
const screens = checked.length;
console.log(
  `RTL check: ${screens} screen measurements, ${failures.length} failure(s), ${pageErrors.length} page error(s).`,
);
for (const f of failures) console.log("FAIL " + f);
for (const e of pageErrors) console.log("PAGE ERROR " + e);
if (failures.length || pageErrors.length) process.exitCode = 1;
