import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {}),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const base = process.env.TEST_APP_URL ?? "http://localhost:3000";
await mkdir("test-results", { recursive: true });
await page.goto(base, { waitUntil: "networkidle" });
await page.screenshot({
  path: "test-results/landing-desktop.png",
  fullPage: true,
});
await page.goto(base + "/login");
await page.getByLabel("Email address").fill("coach@example.test");
await page
  .getByLabel("Password", { exact: true })
  .fill(process.env.DEMO_PASSWORD ?? "TrainerDemo2026!");
await page.getByRole("button", { name: "Sign in", exact: true }).click();
await page.waitForURL("**/trainer");
await page.getByRole("heading", { name: "Good to see you, Alex." }).waitFor();
await page.screenshot({
  path: "test-results/trainer-desktop.png",
  fullPage: true,
});
for (const route of [
  "/trainer/brain",
  "/trainer/subscribers",
  "/trainer/programs",
  "/trainer/finance",
  "/trainer/integrations",
  "/trainer/settings",
  "/admin",
]) {
  await page.goto(base + route);
  await page.locator(".page-heading h1").waitFor();
}
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(base + "/trainer");
await page.locator(".page-heading h1").waitFor();
const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth > window.innerWidth,
);
if (overflow) throw new Error("Mobile page overflows viewport");
await page.screenshot({
  path: "test-results/trainer-mobile.png",
  fullPage: true,
});
await page.getByRole("button", { name: "Open navigation" }).click();
await page.getByRole("link", { name: "My Brain", exact: true }).click();
await page.waitForURL("**/trainer/brain");
await writeFile(
  "test-results/browser-check.json",
  JSON.stringify({ routes: 9, mobileWidth: 390, overflow, errors }, null, 2),
);
await browser.close();
if (errors.length) throw new Error(errors.join("\n"));
console.log(
  "Browser smoke passed: landing, login, trainer routes, admin, mobile navigation and no overflow.",
);
