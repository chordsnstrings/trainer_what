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
const failedRequests = [];
const pages = [page];
function observe(page) {
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("requestfailed", (r) =>
    failedRequests.push({ url: r.url(), error: r.failure()?.errorText }),
  );
}
observe(page);

const base = process.env.TEST_APP_URL ?? "http://localhost:3000";
await mkdir("test-results", { recursive: true });
try {
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
  const subscriberContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const subscriber = await subscriberContext.newPage();
  pages.push(subscriber);
  observe(subscriber);
  await subscriber.goto(base + "/login");
  await subscriber.getByLabel("Email address").fill("sam.taylor@example.test");
  await subscriber
    .getByLabel("Password", { exact: true })
    .fill(process.env.DEMO_PASSWORD ?? "TrainerDemo2026!");
  await subscriber
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await subscriber.waitForURL("**/app");
  await subscriber.goto(base + "/app/program");
  await subscriber
    .getByRole("button", { name: "Start workout" })
    .first()
    .click();
  await subscriber.waitForURL("**/app/workouts/*");
  await subscriber
    .getByText("Workout saved for this device.", { exact: false })
    .waitFor();
  const workoutUrl = subscriber.url();
  await subscriberContext.setOffline(true);
  await subscriber
    .locator(".set-row")
    .first()
    .getByRole("button", { name: "Log set", exact: true })
    .click();
  await subscriber
    .getByText("1 set logs waiting to sync.", { exact: false })
    .waitFor();
  await subscriber.reload({ waitUntil: "domcontentloaded" });
  await subscriber.locator(".set-row").first().waitFor();
  if (subscriber.url() !== workoutUrl)
    throw new Error("Offline reload did not preserve the workout route");
  await subscriber
    .getByText("1 set logs waiting to sync.", { exact: false })
    .waitFor();
  await subscriberContext.setOffline(false);
  await subscriber.waitForFunction(
    () =>
      !Object.keys(localStorage)
        .filter(
          (k) => k.startsWith("trainer:queue:") && !k.endsWith(":receipts"),
        )
        .some((k) => JSON.parse(localStorage.getItem(k) ?? "[]").length),
  );
  await subscriber
    .getByRole("button", { name: "Finish workout", exact: true })
    .click();
  await subscriber.getByText("Workout completed", { exact: true }).waitFor();
  await subscriber.screenshot({
    path: "test-results/subscriber-workout-mobile.png",
    fullPage: true,
  });
  for (const route of ["/app/bookings", "/app/support", "/app/profile"]) {
    await subscriber.goto(base + route);
    await subscriber.locator(".page-heading h1").waitFor();
  }
  await subscriberContext.close();
  await writeFile(
    "test-results/browser-check.json",
    JSON.stringify(
      {
        routes: 14,
        mobileWidth: 390,
        overflow,
        offlineWorkoutReload: true,
        offlineSetReplay: true,
        errors,
      },
      null,
      2,
    ),
  );
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    "Browser smoke passed: landing, login, trainer routes, admin, mobile navigation, no overflow and offline workout reload/replay.",
  );
} catch (error) {
  const details = [];
  for (const [index, p] of pages.entries()) {
    if (p.isClosed()) continue;
    await p
      .screenshot({ path: `test-results/failure-${index}.png`, fullPage: true })
      .catch(() => {});
    details.push({
      url: p.url(),
      text: await p
        .locator("body")
        .innerText()
        .catch(() => "unavailable"),
      caches: await p
        .evaluate(async () => {
          const result = {};
          for (const name of await caches.keys()) {
            result[name] = (await (await caches.open(name)).keys()).map(
              (r) => r.url,
            );
          }
          return result;
        })
        .catch(() => null),
    });
  }
  await writeFile(
    "test-results/browser-failure.json",
    JSON.stringify(
      { message: String(error), errors, failedRequests, pages: details },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser.close();
}
