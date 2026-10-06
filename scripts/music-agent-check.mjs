import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
const base = process.env.TEST_APP_URL ?? "http://127.0.0.1:3193";
assert.ok(
  ["127.0.0.1", "localhost"].includes(new URL(base).hostname),
  "Use an isolated local fixture",
);
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {}),
});
const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  }),
  page = await context.newPage();
page.setDefaultTimeout(20000);
const folder = "test-results/music-agent";
await mkdir(folder, { recursive: true });
const report = { checks: [], screenshots: [], errors: [] };
page.on("pageerror", (e) => report.errors.push(e.message));
async function check(name, fn) {
  await fn();
  report.checks.push(name);
  console.log("PASS " + name);
}
try {
  const login = await context.request.post(base + "/api/v1/auth/login", {
    headers: { origin: base },
    data: {
      email: "coach@example.test",
      password: process.env.DEMO_PASSWORD ?? "TrainerDemo2026!",
    },
  });
  assert.equal(login.status(), 200, await login.text());
  await page.goto(base + "/admin/music");
  const dismiss = page.getByRole("button", { name: "No thanks", exact: true });
  if (await dismiss.isVisible()) await dismiss.click();
  const region = page.getByRole("region", { name: "Music agent" });
  await check("music agent starts paused with a saved status", async () => {
    await expect(region).toBeVisible();
    await expect(region.getByText("Paused", { exact: true })).toBeVisible();
  });
  await check("refresh preserves unsaved budget edits", async () => {
    await region.locator("summary").click();
    await region
      .getByLabel("Total generation requests", { exact: true })
      .fill("100");
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(
      region.getByLabel("Total generation requests", { exact: true }),
    ).toHaveValue("100");
  });
  await check(
    "starting persists the agent and budgets across reload",
    async () => {
      await region.getByLabel(/Earlier purchases/).check();
      await region
        .getByRole("button", { name: "Start music agent", exact: true })
        .click();
      await expect(
        region.getByRole("button", { name: "Pause agent", exact: true }),
      ).toBeVisible();
      await page.reload();
      await expect(
        region.getByRole("button", { name: "Pause agent", exact: true }),
      ).toBeVisible();
      await region.locator("summary").click();
      await expect(
        region.getByLabel("Total generation requests", { exact: true }),
      ).toHaveValue("100");
    },
  );
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => scrollTo(0, 0));
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
    const path = folder + "/" + width + ".png";
    await page.screenshot({ path, fullPage: true });
    report.screenshots.push(path);
  }
  await check("pause persists across reload", async () => {
    await region
      .getByRole("button", { name: "Pause agent", exact: true })
      .click();
    await expect(region.getByText("Paused", { exact: true })).toBeVisible();
    await page.reload();
    await expect(region.getByText("Paused", { exact: true })).toBeVisible();
  });
  assert.deepEqual(report.errors, []);
} finally {
  await writeFile(folder + "/report.json", JSON.stringify(report, null, 2));
  await browser.close();
}
