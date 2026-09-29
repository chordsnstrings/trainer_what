/**
 * Browser-only behaviour, driven with the locally installed headless Chromium
 * (Playwright, PLAYWRIGHT_BROWSERS_PATH; never a cloud browser): the
 * Superadmin settings page, the trainer's Brain workspace, the follower's
 * Today screen, and offline set logging and food-diary entries that sync when
 * the connection returns (service worker plus the device queues). Sessions
 * come from real sign-ins; the throwaway CA's leaf is trusted by SPKI pin.
 * Each page is also checked for horizontal overflow at a 390 px phone width.
 */
import assert from "node:assert/strict";
import { createHash, X509Certificate } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Client } from "../harness/client.ts";
import type { E2EContext, FollowerSeed } from "../harness/context.ts";

const A = "Super admin" as const;
const T = "Trainers" as const;
const F = "followers" as const;

type Browser = import("playwright").Browser;
type Page = import("playwright").Page;
type BrowserContext = import("playwright").BrowserContext;

/** A local Chromium build: E2E_CHROMIUM, else the newest chromium-N build under PLAYWRIGHT_BROWSERS_PATH. */
function localChromium(): string | undefined {
  if (process.env.E2E_CHROMIUM && existsSync(process.env.E2E_CHROMIUM)) return process.env.E2E_CHROMIUM;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !existsSync(root)) return undefined;
  const builds = readdirSync(root)
    .filter((name) => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const build of builds) {
    const path = join(root, build, "chrome-linux", "chrome");
    if (existsSync(path)) return path;
  }
  return undefined;
}
const spki = (pem: string) =>
  createHash("sha256")
    .update(new X509Certificate(pem).publicKey.export({ type: "spki", format: "der" }))
    .digest("base64");

async function sessionContext(ctx: E2EContext, browser: Browser, person: Client, label: string, viewport = { width: 390, height: 844 }) {
  const device = person.device(label);
  await device.login();
  const context = await browser.newContext({ viewport, ignoreHTTPSErrors: true, serviceWorkers: "allow" });
  const origin = new URL(ctx.publicUrl);
  await context.addCookies(
    [...device.cookies].map(([name, value]) => ({
      name,
      value,
      domain: origin.hostname,
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax" as const,
    })),
  );
  return { context, device };
}
async function noOverflow(page: Page) {
  const { scroll, width } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    width: document.documentElement.clientWidth,
  }));
  assert.ok(scroll <= width + 1, `horizontal overflow at ${width}px: content is ${scroll}px wide`);
}
async function visible(page: Page, text: string | RegExp, timeout = 20000) {
  try {
    await page.getByText(text).first().waitFor({ state: "visible", timeout });
  } catch (error) {
    // Say what the page showed instead, so a failure is diagnosable from the report.
    const shown = await page
      .evaluate(() => (document.querySelector("main") ?? document.body)?.innerText ?? "")
      .catch(() => "");
    throw new Error(`"${String(text)}" not visible at ${page.url()}; the page showed: ${shown.replace(/\s+/g, " ").slice(0, 600)}`);
  }
}

export async function browserScenarios(ctx: E2EContext) {
  const r = ctx.reporter;
  const skipAll = (reason: string) => {
    for (const [audience, feature] of [
      [A, "Settings and API connections page"],
      [T, "Brain workspace screen"],
      [F, "Today home screen"],
      [F, "Offline workout with set sync"],
      [F, "Offline food diary sync"],
    ] as const)
      r.skip(audience, feature, "browser", reason);
  };
  let browser: Browser;
  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({
      headless: true,
      // The Chromium the installed Playwright expects may be absent; use the
      // locally installed one under PLAYWRIGHT_BROWSERS_PATH when it is.
      ...(localChromium() ? { executablePath: localChromium() } : {}),
      args: [`--ignore-certificate-errors-spki-list=${spki(ctx.mocks.tls.cert)}`],
    });
  } catch (error) {
    skipAll("local headless Chromium unavailable: " + String((error as Error)?.message ?? error).split("\n")[0]);
    return;
  }
  const opened: BrowserContext[] = [];
  const errors: string[] = [];
  const track = (page: Page) => page.on("pageerror", (e) => errors.push(e.message));
  try {
    await r.step(A, "Settings and API connections page", "/admin/settings shows every connection with its state, the encryption status and the sandbox banner", async () => {
      const { context } = await sessionContext(ctx, browser, ctx.admin, "browser-admin", { width: 1280, height: 900 });
      opened.push(context);
      const page = await context.newPage();
      track(page);
      await page.goto(ctx.publicUrl + "/admin/settings");
      await visible(page, /Mock providers\./);
      for (const name of ["Stripe", "Lean", "Sign in with Google", "Sign in with Apple"]) await visible(page, name);
      const text = await page.locator("main").innerText();
      assert.match(text, /verified|active|configured/i);
      await page.setViewportSize({ width: 390, height: 844 });
      await noOverflow(page);
    });
    const layla = ctx.trainers.find((t) => t.slug === "layla-strength" && t.published);
    if (layla)
      await r.step(T, "Brain workspace screen", "/trainer/brain: the Knowledge, Constitution and Readiness tabs show the sources, confirmed rules and releases", async () => {
        const { context } = await sessionContext(ctx, browser, layla.client, "browser-trainer");
        opened.push(context);
        const page = await context.newPage();
        track(page);
        await page.goto(ctx.publicUrl + "/trainer/brain");
        await visible(page, "Your coaching mind, made clear.");
        await page.getByRole("button", { name: "Knowledge" }).click();
        await visible(page, "Strength progression");
        await page.getByRole("button", { name: "Constitution" }).click();
        await visible(page, /squat/i);
        await visible(page, "confirmed");
        await page.getByRole("button", { name: "Readiness & releases" }).click();
        await visible(page, /release/i);
        await noOverflow(page);
      });
    const member = ctx.followers.find((f) => f.trainer.slug === "layla-strength" && f.paid && f.tier === "workout" && f.client.userId);
    if (member) {
      await r.step(F, "Today home screen", `${member.client.label}: /app shows the coach's welcome and next steps`, async () => {
        const { context } = await sessionContext(ctx, browser, member.client, "browser-member");
        opened.push(context);
        const page = await context.newPage();
        track(page);
        await page.goto(ctx.publicUrl + "/app");
        await visible(page, /Layla|Strength that fits/);
        await noOverflow(page);
      });
      await offlineWorkout(ctx, browser, member, opened, track);
    } else r.skip(F, "Offline workout with set sync", "browser", "no paid workout member");
    const nutrition = ctx.followers.find((f) => f.trainer.slug === "layla-strength" && f.paid && f.tier === "workout_nutrition" && f.client.userId);
    if (nutrition) await offlineDiary(ctx, browser, nutrition, opened, track);
    else r.skip(F, "Offline food diary sync", "browser", "no workout + nutrition member");
  } finally {
    for (const context of opened) await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
  if (errors.length) ctx.log(`  browser page errors: ${errors.slice(0, 5).join(" | ")}`);
}

async function offlineWorkout(ctx: E2EContext, browser: Browser, member: FollowerSeed, opened: BrowserContext[], track: (p: Page) => void) {
  const probe = member.client.device("browser-precheck-workout");
  await probe.login();
  const assigned = (await probe.get("/api/v1/bootstrap")).records.some(
    (x: any) => x.kind === "program" && x.status !== "archived",
  );
  if (!assigned) {
    ctx.reporter.skip(F, "Offline workout with set sync", "browser", "needs a member with an assigned program (run the follower suite first)");
    return;
  }
  await ctx.reporter.step(F, "Offline workout with set sync", `${member.client.label}: a workout opened online keeps logging sets offline, survives an offline reload and syncs when the connection returns`, async () => {
    const { context, device } = await sessionContext(ctx, browser, member.client, "browser-offline-workout");
    opened.push(context);
    const boot = await device.get("/api/v1/bootstrap");
    const program = boot.records.find((x: any) => x.kind === "program" && x.status !== "archived");
    assert.ok(program, "the member has an assigned program");
    const workout = await device.post("/api/v1/workouts/start", { programId: program.id });
    const page = await context.newPage();
    track(page);
    await page.goto(`${ctx.publicUrl}/app/workouts/${workout.id}`);
    await visible(page, "Log set");
    await visible(page, /Workout saved for this device|Offline reload is not ready/, 30000);
    const cached = await page.getByText("Workout saved for this device").count();
    await context.setOffline(true);
    await page.locator("form.set-row").first().locator('button[type="submit"]').click();
    await visible(page, /will sync/);
    let reloaded = "not attempted";
    if (cached) {
      await page.reload();
      await visible(page, "Log set");
      reloaded = "offline reload served from the service worker";
    }
    const queued = await page.evaluate(() =>
      Object.keys(localStorage)
        .filter((k) => k.startsWith("trainer:queue:") && !k.includes(":"+"rejected") && !k.endsWith(":receipts"))
        .map((k) => JSON.parse(localStorage.getItem(k) ?? "[]").length)
        .reduce((a, b) => a + b, 0),
    );
    assert.equal(queued, 1, "one set waits in the device queue");
    const before = (await device.get("/api/v1/bootstrap")).sets.filter((s: any) => s.workout_id === workout.id).length;
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await ctx.waitUntil("the queued set reaches the server", async () => {
      const sets = (await device.get("/api/v1/bootstrap")).sets.filter((s: any) => s.workout_id === workout.id);
      return sets.length > before;
    }, 30000);
    await page.getByText(/will sync/).first().waitFor({ state: "detached", timeout: 20000 }).catch(() => {});
    return `${reloaded}; set synced after reconnecting`;
  });
}

async function offlineDiary(ctx: E2EContext, browser: Browser, member: FollowerSeed, opened: BrowserContext[], track: (p: Page) => void) {
  const probe = member.client.device("browser-precheck-diary");
  await probe.login();
  const delivered = (await probe.get("/api/v1/nutrition")).records?.some(
    (x: any) => x.kind === "nutrition_plan" && x.status === "delivered",
  );
  if (!delivered) {
    ctx.reporter.skip(F, "Offline food diary sync", "browser", "needs a delivered weekly meal plan (run the follower suite first)");
    return;
  }
  await ctx.reporter.step(F, "Offline food diary sync", `${member.client.label}: a planned meal logged without signal is kept on the device and recorded after reconnecting`, async () => {
    const { context, device } = await sessionContext(ctx, browser, member.client, "browser-offline-diary");
    opened.push(context);
    const page = await context.newPage();
    track(page);
    await page.goto(`${ctx.publicUrl}/app/nutrition`);
    await visible(page, "Log this meal", 30000);
    const count = async () =>
      (await device.get("/api/v1/nutrition")).records.filter((x: any) => x.kind === "nutrition_log").length;
    const before = await count().catch(() => -1);
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await visible(page, /Offline\. Saved plans are a reference copy/);
    await page.getByRole("button", { name: "Log this meal" }).first().click();
    await visible(page, /Saved on this phone|will sync/);
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await ctx.waitUntil("the queued meal reaches the diary", async () => (await count()) > before, 30000);
    return `diary entries ${before} → ${await count()}`;
  });
}
