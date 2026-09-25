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
const visitedRoutes = new Set();
const pages = [page];
function observe(page) {
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame() && frame.url().startsWith(base))
      visitedRoutes.add(new URL(frame.url()).pathname);
  });
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
  for (const route of ["/how-it-works", "/demo", "/pricing", "/faq"]) {
    await page.goto(base + route);
    await page.locator(".marketing-page h1").waitFor();
    if (route === "/demo") {
      await page
        .getByRole("button", { name: "New pain is reported", exact: true })
        .click();
      await page.getByText("Workout paused", { exact: true }).waitFor();
    }
  }
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
  await page.goto(base + "/trainer/onboarding/identity");
  await page
    .getByRole("heading", { name: "Business identity", exact: true })
    .waitFor();
  const savedIdentity = page.waitForResponse(
    (r) =>
      r.url().endsWith("/onboarding/identity") &&
      r.request().method() === "PUT" &&
      r.request().postDataJSON().values.audience ===
        "Adults building a lasting training habit",
  );
  for (const [label, value] of [
    ["Business or trade name", "Morgan Coaching"],
    ["Public coach name", "Alex Morgan"],
    ["City", "Dubai"],
    ["Coaching specialty", "Strength"],
    ["Who you coach", "Adults building a lasting training habit"],
  ])
    await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole("button", { name: "Save now", exact: true }).click();
  const savedResponse = await savedIdentity;
  if (!savedResponse.ok()) throw new Error("Onboarding save failed");
  await page
    .getByText("Saved. You can continue on another device.", { exact: true })
    .waitFor();
  await page.reload();
  if (
    (await page
      .getByLabel("Business or trade name", { exact: true })
      .inputValue()) !== "Morgan Coaching"
  )
    throw new Error("Onboarding did not resume persisted identity");
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
  await page.goto(base + "/trainer/onboarding/identity");
  await page
    .getByRole("heading", { name: "Business identity", exact: true })
    .waitFor();
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw new Error("Mobile onboarding overflows viewport");
  await page.screenshot({
    path: "test-results/onboarding-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1050 });
  for (const route of [
    "/trainer/nutrition",
    "/trainer/nutrition/cases",
    "/trainer/nutrition/recipes",
    "/trainer/nutrition/policy",
    "/trainer/nutrition/scenarios",
    "/trainer/nutrition/preview",
    "/trainer/nutrition/readiness",
    "/trainer/nutrition/exceptions",
  ]) {
    await page.goto(base + route);
    await page
      .getByRole("heading", { name: "Nutrition coaching", exact: true })
      .waitFor();
    if (route.endsWith("/cases"))
      await page.screenshot({
        path: "test-results/nutrition-coach-cases.png",
        fullPage: true,
      });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + "/trainer/onboarding/nutrition-cases");
  await page
    .getByRole("heading", { name: "Teach nutrition", exact: true })
    .waitFor();
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw new Error("Nutrition onboarding overflows mobile viewport");
  await page.screenshot({
    path: "test-results/nutrition-onboarding-mobile.png",
    fullPage: true,
  });
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
  await subscriber.goto(base + "/app/twin");
  await subscriber
    .getByRole("heading", {
      name: "Recorded training · last 28 days",
      exact: true,
    })
    .waitFor();
  if (
    await subscriber.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    )
  )
    throw new Error("Mobile Client Twin overflows viewport");
  await subscriber.screenshot({
    path: "test-results/client-twin-mobile.png",
    fullPage: true,
  });
  await subscriber.goto(base + "/app/nutrition");
  await subscriber
    .getByRole("heading", { name: "Your week of meals", exact: true })
    .waitFor();
  await subscriber.getByText("Warm breakfast bowl", { exact: true }).waitFor();
  await subscriber
    .getByText("Demonstration plan with synthetic food and coach data.", {
      exact: false,
    })
    .waitFor();
  await subscriber.screenshot({
    path: "test-results/nutrition-meals-mobile.png",
    fullPage: true,
  });
  if (
    await subscriber.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    )
  )
    throw new Error("Nutrition meals overflow mobile viewport");
  await subscriber
    .getByRole("button", { name: "Weekly groceries", exact: true })
    .click();
  await subscriber
    .getByRole("heading", { name: "One list for the week", exact: true })
    .waitFor();
  await subscriber.getByText("2800 g", { exact: true }).waitFor();
  await subscriber.locator(".nutrition-grocery input").first().check();
  await subscriber
    .getByRole("button", { name: "Save shopping progress", exact: true })
    .click();
  await subscriber
    .getByText("Pantry checklist saved", { exact: true })
    .waitFor();
  await subscriber.screenshot({
    path: "test-results/nutrition-groceries-mobile.png",
    fullPage: true,
  });
  await subscriber
    .getByRole("button", { name: "Meal plan", exact: true })
    .click();
  await subscriber
    .getByLabel(
      "Keep a private copy of the latest plan on this device for up to 12 hours.",
    )
    .check();
  await subscriber.waitForFunction(() =>
    Object.keys(localStorage).some(
      (k) => k.startsWith("trainer:nutrition:") && !k.endsWith(":queue"),
    ),
  );
  await subscriberContext.setOffline(true);
  await subscriber
    .getByRole("button", { name: "Log this meal", exact: true })
    .first()
    .click();
  await subscriber
    .getByText("1 meal entry/entries waiting to sync.", { exact: false })
    .waitFor();
  await subscriber.reload({ waitUntil: "domcontentloaded" });
  await subscriber
    .getByRole("heading", { name: "Your week of meals", exact: true })
    .waitFor();
  await subscriber
    .getByText("1 meal entry/entries waiting to sync.", { exact: false })
    .waitFor();
  await subscriberContext.setOffline(false);
  await subscriber.waitForFunction(
    () =>
      !Object.keys(localStorage)
        .filter(
          (k) => k.startsWith("trainer:nutrition:") && k.endsWith(":queue"),
        )
        .some((k) => JSON.parse(localStorage.getItem(k) ?? "[]").length),
  );
  await subscriber
    .getByRole("button", { name: "Meal diary", exact: true })
    .click();
  await subscriber.getByText(/1 meals across 1 days/).waitFor();
  // An empty replay queue must still refresh the private reference copy.
  await subscriberContext.setOffline(true);
  await subscriber.reload({ waitUntil: "domcontentloaded" });
  await subscriber
    .getByRole("heading", { name: "Your week of meals", exact: true })
    .waitFor();
  const refreshedNutrition = subscriber.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/v1/nutrition" &&
      response.request().method() === "GET" &&
      response.ok(),
  );
  await subscriberContext.setOffline(false);
  const refreshed = await (await refreshedNutrition).json();
  if (!refreshed.profile?.data.profile.age)
    throw new Error("Nutrition reconnect did not restore the server profile");
  await subscriber
    .getByRole("button", { name: "Meal diary", exact: true })
    .click();
  await subscriber.getByText(/1 meals across 1 days/).waitFor();
  await subscriberContext.close();
  await writeFile(
    "test-results/browser-check.json",
    JSON.stringify(
      {
        routes: visitedRoutes.size,
        routePaths: [...visitedRoutes].sort(),
        onboardingResume: true,
        clientTwin: true,
        mobileWidth: 390,
        overflow,
        offlineWorkoutReload: true,
        offlineSetReplay: true,
        nutritionOnboarding: true,
        nutritionMealsAndGroceries: true,
        nutritionPantryPersistence: true,
        nutritionOfflineReloadAndReplay: true,
        nutritionReconnectWithoutQueuedEntries: true,
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
