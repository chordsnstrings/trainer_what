import assert from "node:assert/strict";
import { checkSubscriberContrast } from "./subscriber-contrast.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
const base = process.env.TEST_APP_URL;
if (
  !base ||
  !["localhost", "127.0.0.1"].includes(new URL(base).hostname) ||
  !process.env.DEMO_PASSWORD ||
  process.env.NODE_ENV === "production"
)
  throw Error("Use the isolated WHOOP fixture runner");
const folder = "test-results/whoop-training";
await mkdir(folder, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
});
const report = { checks: [], errors: [] };
async function login(email) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    serviceWorkers: "block",
    // The demo seed schedules from Dubai's date; a UTC browser sees a rest day 20:00–24:00 UTC.
    timezoneId: "Asia/Dubai",
  });
  const response = await context.request.post(base + "/api/v1/auth/login", {
    headers: { origin: base },
    data: { email, password: process.env.DEMO_PASSWORD },
  });
  assert.equal(response.status(), 200, await response.text());
  const page = await context.newPage();
  page.on("pageerror", (e) => report.errors.push(e.message));
  // Space real requests to keep this scripted journey within the member API budget.
  let next = 0;
  await page.route("**/api/v1/**", async (route) => {
    const delay = Math.max(0, next - Date.now());
    next = Date.now() + delay + 250;
    if (delay) await new Promise((r) => setTimeout(r, delay));
    await route.continue().catch(() => {});
  });
  return { context, page };
}
async function screenshot(page, name) {
  await page.evaluate(async () => {
    window.scrollTo({ top: 0, behavior: "instant" });
    await new Promise(requestAnimationFrame);
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "No horizontal overflow",
  );
  await page.screenshot({
    path: `${folder}/${name}.png`,
    fullPage: true,
    animations: "disabled",
  });
}
async function declineAnalytics(page) {
  const notice = page.getByRole("complementary", {
    name: "Optional analytics",
    exact: true,
  });
  if (await notice.count())
    await notice
      .getByRole("button", { name: "No thanks", exact: true })
      .click();
}
try {
  const coach = await login("coach@example.test");
  await coach.page.goto(base + "/trainer/brain/plans");
  const rules = coach.page.getByRole("region", {
    name: "How recovery changes training",
    exact: true,
  });
  await expect(rules).toBeVisible();
  await declineAnalytics(coach.page);
  await rules.getByLabel("Use my recovery rules", { exact: true }).check();
  await rules.locator('[name="low-load"]').fill("10");
  await rules.locator('[name="low-volume"]').fill("25");
  await rules
    .getByRole("button", { name: "Save recovery rules", exact: true })
    .click();
  await expect(rules.getByRole("status")).toHaveText("Recovery rules saved.");
  await rules.scrollIntoViewIfNeeded();
  await screenshot(coach.page, "trainer-desktop");
  report.checks.push("Trainer saves recovery rules through the real API");
  const member = await login("sam.taylor@example.test");
  await member.page.setViewportSize({ width: 390, height: 844 });
  await member.page.goto(base + "/app/recovery");
  for (const name of [/without analytics/i, /^No thanks$/i]) {
    const b = member.page.getByRole("button", { name });
    if (await b.count()) await b.first().click();
  }
  const recovery = member.page.locator(".member-recovery");
  await expect(recovery).toContainText("25%");
  await declineAnalytics(member.page);
  const permission = recovery.getByRole("switch");
  await expect(permission).not.toBeChecked();
  await permission.click();
  await expect(permission).toBeChecked();
  await expect(recovery).toContainText(
    "Up to 10% less weight and 25% less reps",
  );
  await screenshot(member.page, "member-opt-in-phone");
  await member.page.reload();
  await expect(permission).toBeChecked();
  report.checks.push("Explicit member opt-in persists after reload");
  await expect(recovery.locator(".recovery-metrics")).toContainText("7.2");
  const checkedNode = await permission.elementHandle();
  await permission.click();
  await expect(permission).not.toBeChecked();
  assert.equal(
    await checkedNode.evaluate((el) => el.isConnected),
    true,
    "Switch remains mounted for smooth movement",
  );
  await permission.click();
  await expect(permission).toBeChecked();
  assert.ok(
    await permission.evaluate((el) => el.getBoundingClientRect().width >= 50),
    "Switch is not overridden by checkbox styles",
  );
  for (const width of [320, 390, 1280]) {
    await member.page.setViewportSize({ width, height: 844 });
    report.checks.push({
      screen: "recovery",
      width,
      contrast: await checkSubscriberContrast(member.page),
    });
    await screenshot(member.page, `recovery-${width}`);
  }
  await member.page.setViewportSize({ width: 320, height: 844 });
  await member.page.locator(".member-recovery").evaluate((root) => {
    const elements = [
      ...root.querySelectorAll("h1,h2,p,dt,dd,strong,small,button,a"),
    ];
    const sizes = elements.map((el) =>
      parseFloat(getComputedStyle(el).fontSize),
    );
    elements.forEach((el, i) => (el.style.fontSize = `${sizes[i] * 2}px`));
  });
  await screenshot(member.page, "recovery-large-text");
  await member.page.reload();
  await expect(permission).toBeChecked();
  await member.page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await permission.evaluate(
      (el) => getComputedStyle(el, "::before").transitionDuration,
    ),
    "0s",
  );
  await member.page.emulateMedia({ reducedMotion: "no-preference" });
  assert.equal(
    await permission.evaluate(
      (el) => getComputedStyle(el, "::before").transitionDuration,
    ),
    "0.18s",
  );
  await member.page.evaluate(
    () => (document.documentElement.dataset.reduceMotion = "on"),
  );
  assert.equal(
    await permission.evaluate(
      (el) => getComputedStyle(el, "::before").transitionDuration,
    ),
    "0s",
  );
  await member.page.evaluate(
    () => delete document.documentElement.dataset.reduceMotion,
  );
  await member.page
    .getByRole("link", { name: "Your coach’s rules", exact: true })
    .click();
  await expect(
    member.page.locator(".recovery-rules [data-current]"),
  ).toContainText("Low recovery");
  await screenshot(member.page, "recovery-rules-phone");
  await member.page.goto(base + "/app/voice");
  await expect(
    member.page.getByRole("heading", { name: "Voice guidance.", exact: true }),
  ).toBeVisible();
  await expect(member.page.locator(".voice-benefits")).toContainText(
    "Timers stay included with training",
  );
  await expect(
    member.page.getByText("Checking voice availability…", { exact: true }),
  ).toHaveCount(0);
  report.checks.push({
    screen: "voice",
    contrast: await checkSubscriberContrast(member.page),
  });
  await screenshot(member.page, "voice-phone");
  let pendingUpgrade = false,
    confirmations = 0;
  const upgradeFixture = {
    id: "00000000-0000-4000-8000-000000000020",
    name: "Synthetic training + voice",
    priceMinor: 29900,
    modules: ["training", "voice"],
    reason: null,
  };
  const optionsRoute = (route) =>
    route.fulfill({
      json: {
        offers: [upgradeFixture],
        blocked: pendingUpgrade,
        prepaid: false,
        pending: pendingUpgrade
          ? {
              id: "fixture-upgrade",
              status: "unknown",
              name: upgradeFixture.name,
              url: null,
            }
          : null,
      },
    });
  const quoteRoute = (route) =>
    route.fulfill({
      json: {
        id: "00000000-0000-4000-8000-000000000021",
        name: upgradeFixture.name,
        amountMinor: 6000,
        monthlyPriceMinor: 29900,
        renewalAt: new Date(Date.now() + 20 * 86400000).toISOString(),
        expiresAt: new Date(Date.now() + 300000).toISOString(),
      },
    });
  const confirmRoute = (route) => {
    confirmations++;
    pendingUpgrade = true;
    return route.fulfill({ json: { status: "pending", url: null } });
  };
  await member.page.route("**/api/v1/membership/upgrades", optionsRoute);
  await member.page.route("**/api/v1/membership/change-plan", quoteRoute);
  await member.page.route(
    "**/api/v1/membership/upgrades/confirm",
    confirmRoute,
  );
  await member.page.goto(base + "/app/membership");
  await member.page
    .getByRole("button", { name: "Review upgrade", exact: true })
    .click();
  const review = member.page.getByRole("dialog", {
    name: "Review your upgrade",
    exact: true,
  });
  await expect(review).toContainText("Due today");
  await expect(review).toContainText("New monthly price");
  await expect(review).toContainText("60");
  await expect(review).toContainText("299");
  await screenshot(member.page, "upgrade-review-phone");
  await review.getByRole("button", { name: /Confirm & pay/ }).click();
  await expect(
    member.page.getByText("Upgrade awaiting confirmation", { exact: true }),
  ).toBeVisible();
  await expect(
    member.page.getByRole("button", { name: "Review upgrade", exact: true }),
  ).toBeDisabled();
  assert.equal(confirmations, 1);
  report.checks.push(
    "Upgrade review states exact due-today and monthly amounts; pending outcome blocks another purchase (isolated UI fixtures)",
  );
  await member.page.unroute("**/api/v1/membership/upgrades", optionsRoute);
  await member.page.unroute("**/api/v1/membership/change-plan", quoteRoute);
  await member.page.unroute(
    "**/api/v1/membership/upgrades/confirm",
    confirmRoute,
  );

  await member.page.setViewportSize({ width: 390, height: 844 });

  await member.page.goto(base + "/app");
  await expect(
    member.page.getByRole("region", { name: "WHOOP recovery", exact: true }),
  ).toContainText("25%");
  const pending = member.page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/v1/workouts/start" &&
      r.request().method() === "POST",
  );
  await member.page.locator(".today-secondary").click();
  const started = await pending;
  assert.equal(started.status(), 200, await started.text());
  const workout = await started.json();
  assert.ok(workout.data.recoveryAdjustment?.changes.length);
  const receipt = member.page.getByRole("region", {
    name: "Adjusted for your recovery",
    exact: true,
  });
  await expect(receipt).toBeVisible();
  await receipt.getByText("See what changed", { exact: true }).click();
  await expect(receipt).toContainText("→");
  await expect(receipt.locator("ul")).toHaveCSS("opacity", "1");
  await screenshot(member.page, "adjusted-workout-phone");
  report.checks.push(
    "Today starts an adjusted workout and displays the real change receipt",
  );
  const load = member.page.locator('.set-row input[name="load"]').first();
  const reps = member.page.locator('.set-row input[name="reps"]').first();
  await load.fill("27.5");
  await reps.fill("9");
  await member.page.getByRole("button", { name: "90 s", exact: true }).click();
  await member.page
    .getByRole("button", { name: "Pause timer", exact: true })
    .click();
  const paused = await member.page.getByRole("timer").last().textContent();
  await member.page.reload();
  await expect(load).toHaveValue("27.5");
  await expect(reps).toHaveValue("9");
  await expect(member.page.getByRole("timer").last()).toHaveText(paused);
  await member.page
    .getByRole("button", { name: "Resume timer", exact: true })
    .click();
  await member.page
    .getByRole("button", { name: "Pause timer", exact: true })
    .click();
  await member.page.locator('.member-tabbar a[href="/app/program"]').click();
  await member.page.goto(base + `/app/workouts/${workout.id}`);
  await expect(load).toHaveValue("27.5");
  await expect(reps).toHaveValue("9");
  report.checks.push(
    "Unsubmitted set edits and paused rest timer survive reload and navigation",
  );
  await screenshot(member.page, "workout-restored-phone");

  await member.page.goto(base + `/app/voice-session/${workout.id}`);
  await expect(
    member.page.getByRole("region", {
      name: "Adjusted for your recovery",
      exact: true,
    }),
  ).toBeVisible();
  report.checks.push("Guided session shows the same recovery adjustment");
  // Signed-in members use their saved language, rather than a public URL hint.
  await member.page.goto(base + "/app/profile");
  await member.page
    .getByLabel(/Message language|لغة الرسائل/)
    .selectOption("ar");
  const languageSaved = member.page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/v1/notifications/preferences" &&
      r.request().method() === "PUT",
  );
  await member.page
    .getByRole("button", { name: "Save preferences", exact: true })
    .click();
  assert.equal((await languageSaved).status(), 200);
  await expect(member.page.locator("html")).toHaveAttribute("lang", "ar");
  await member.page.goto(base + "/app/recovery");
  await expect(member.page.locator("html")).toHaveAttribute("dir", "rtl");
  const arabic = member.page.locator(".member-recovery");
  await expect(arabic).toBeVisible();
  await screenshot(member.page, "member-arabic-phone");
  await arabic.getByRole("switch").click();
  await expect(arabic.getByRole("switch")).not.toBeChecked();
  await member.page.reload();
  await expect(arabic.getByRole("switch")).not.toBeChecked();
  report.checks.push("Arabic phone layout and revocable permission work");
  assert.deepEqual(report.errors, []);
  console.log(JSON.stringify(report));
} finally {
  await writeFile(`${folder}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
