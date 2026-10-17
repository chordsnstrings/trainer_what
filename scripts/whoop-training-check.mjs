import assert from "node:assert/strict";
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
  await member.page.goto(base + "/app/wearables");
  for (const name of [/without analytics/i, /^No thanks$/i]) {
    const b = member.page.getByRole("button", { name });
    if (await b.count()) await b.first().click();
  }
  const recovery = member.page.getByRole("region", {
    name: "WHOOP recovery",
    exact: true,
  });
  await expect(recovery).toContainText("25%");
  await declineAnalytics(member.page);
  const permission = recovery.getByRole("checkbox");
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
  await member.page.goto(base + "/app");
  await expect(
    member.page.getByRole("region", { name: "WHOOP recovery", exact: true }),
  ).toContainText("trainer’s rule");
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
  await member.page.goto(base + "/app/wearables");
  await expect(member.page.locator("html")).toHaveAttribute("dir", "rtl");
  const arabic = member.page.getByRole("region", {
    name: "التعافي من WHOOP",
    exact: true,
  });
  await expect(arabic).toBeVisible();
  await screenshot(member.page, "member-arabic-phone");
  await arabic.getByRole("checkbox").click();
  await expect(arabic.getByRole("checkbox")).not.toBeChecked();
  await member.page.reload();
  await expect(arabic.getByRole("checkbox")).not.toBeChecked();
  report.checks.push("Arabic phone layout and revocable permission work");
  assert.deepEqual(report.errors, []);
  console.log(JSON.stringify(report));
} finally {
  await writeFile(`${folder}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
