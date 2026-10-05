// Synthetic loopback journey, run through run-rtl-check.mjs. No provider calls.
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
const base = process.env.TEST_APP_URL;
if (!base || !["localhost", "127.0.0.1"].includes(new URL(base).hostname)) throw new Error("Loopback fixture only");
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
try {
  await page.goto(base + "/login");
  const decline = page.getByRole("button", { name: "No thanks", exact: true });
  if (await decline.isVisible()) await decline.click();
  await page.getByLabel("Email address").fill("coach@example.test");
  await page.getByLabel("Password", { exact: true }).fill(process.env.DEMO_PASSWORD || "TrainerDemo2026!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/(trainer|admin\/settings)$/);
  let failRead = true, slugWrites = 0;
  await page.route("**/api/v1/web-address", route => failRead
    ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Synthetic address outage" }) })
    : route.continue());
  await page.route("**/api/v1/web-address/slug", route => { slugWrites++; return route.continue(); });
  await page.goto(base + "/trainer/domains");
  await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  failRead = false;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your web address", exact: true })).toBeVisible();
  await expect(page.getByText("Synthetic address outage", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Domain connections are not enabled yet.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add domain", exact: true })).toHaveCount(0);
  await expect(page.getByText("Changing needs a recent authenticator check.", { exact: false })).toHaveCount(0);
  await page.getByLabel("Change address", { exact: true }).fill("cancelled-change");
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("button", { name: "Change", exact: true }).click();
  await page.waitForTimeout(200);
  assert.equal(slugWrites, 0, "Dismissed confirmation sends no mutation");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `Overflow at ${width}`);
  }
  assert.deepEqual(errors, []);
  console.log("PASS domain UI: read retry, capability gate, authenticator copy, rename cancellation, two widths, no page errors");
} finally {
  await browser.close();
}
