// Synthetic local browser journeys; no provider calls or production data.
import assert from "node:assert/strict";
import { tsImport } from "tsx/esm/api";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
const base = process.env.TEST_APP_URL;
assert.ok(base && ["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--no-zygote",
    "--single-process",
    "--disable-software-rasterizer",
  ],
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  serviceWorkers: "block",
});
const page = await context.newPage();
page.setDefaultTimeout(15000);
const folder = "test-results/guided-complete";
await mkdir(folder, { recursive: true });
const report = { checks: [], screenshots: [], errors: [] };
page.on("pageerror", (e) => report.errors.push(e.message));
const { buildSessionScript, planExercises } = await tsImport(
  "../packages/domain/src/voice-session.ts",
  import.meta.url,
);
let script = buildSessionScript({
  title: "Strength",
  exercises: planExercises({
    exercises: [
      { name: "Squat", sets: 2, reps: 8, loadKg: 20, restSeconds: 30 },
      {
        name: "Plank",
        sets: 1,
        durationSeconds: 20,
        restSeconds: 0,
        mode: "timed",
      },
    ],
  }),
}).script;
const id = "10000000-0000-4000-8000-000000000001";
const gate = {
  mode: "text",
  reasons: [],
  held: false,
  premium: true,
  playbackConsent: false,
  transcriptionConsent: false,
  speechToText: false,
};
const view = () => ({
  id: "fixture-session",
  mode: "text",
  status: "ready",
  runnable: true,
  scriptFingerprint: "fixture-revision",
  script,
  audioStatus: "unavailable",
  audio: { readyKeys: [] },
  gate,
});
let progressVersion = 0;
let failLoad = false,
  failPain = false,
  painPosts = 0,
  logs = [],
  finishes = 0;
await page.addInitScript(() => {
  window.guidedActions = {};
  navigator.mediaSession.setActionHandler = (name, fn) => {
    window.guidedActions[name] = fn;
  };
  HTMLMediaElement.prototype.play = function () {
    queueMicrotask(() => this.dispatchEvent(new Event("playing")));
    return Promise.resolve();
  };
});
await page.route("**/api/v1/voice-sessions/**", async (route) => {
  if (route.request().url().endsWith("/progress"))
    return route.fulfill({ json: { version: ++progressVersion } });
  if (route.request().method() === "POST")
    return route.fulfill({ json: { ok: true } });
  if (failLoad) {
    failLoad = false;
    return route.fulfill({
      status: 503,
      json: { message: "Fixture session unavailable" },
    });
  }
  return route.fulfill({
    json: new URL(route.request().url()).pathname.includes("/workout/")
      ? { session: view(), gate }
      : view(),
  });
});
await page.route("**/api/v1/workouts/*/**", async (route) => {
  const path = new URL(route.request().url()).pathname;
  if (path.endsWith("/sets")) logs.push(route.request().postDataJSON());
  if (path.endsWith("/finish")) finishes++;
  if (path.endsWith("/pain")) {
    painPosts++;
    if (failPain)
      return route.fulfill({
        status: 503,
        json: { message: "Fixture offline" },
      });
  }
  return route.fulfill({ json: { ok: true } });
});
await page.route("**/api/v1/music", (route) =>
  route.fulfill({
    json: {
      target: 30,
      playlists: [
        {
          id: "flow",
          name: "Flow State",
          ar: "تركيز",
          tracks: [1, 2, 3].map((i) => ({
            id: "track-" + i,
            playlist: "flow",
            title: "Instrumental " + i,
            duration: 240,
            url: "/api/v1/music/track-" + i + "/audio",
          })),
        },
      ],
    },
  }),
);
await page.route("**/api/v1/music/*/audio", (route) =>
  route.fulfill({
    contentType: "audio/wav",
    body: Buffer.from(
      "UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=",
      "base64",
    ),
  }),
);
const root = () => page.locator(".voice-session");
const primary = () => page.locator(".voice-done");
async function go() {
  await page.goto(base + "/app/guided/" + id);
  await expect(root()).toBeVisible({ timeout: 45000 });
  const dismiss = page.getByRole("button", { name: "No thanks", exact: true });
  if (await dismiss.isVisible()) await dismiss.click();
}
async function check(name, fn) {
  await fn();
  report.checks.push(name);
  console.log("PASS " + name);
}
async function screenshot(name, width) {
  await page.setViewportSize({ width, height: 960 });
  await page.evaluate(() => scrollTo(0, 0));
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    ),
    false,
  );
  const path = folder + "/" + name + ".png";
  await page.screenshot({ path, fullPage: true });
  report.screenshots.push(path);
}
try {
  const login = await context.request.post(base + "/api/v1/auth/login", {
    headers: { origin: base },
    data: {
      email: "sam.taylor@example.test",
      password: process.env.DEMO_PASSWORD ?? "TrainerDemo2026!",
    },
  });
  assert.equal(login.status(), 200, await login.text());
  await check(
    "one guided runner with text, music and recoverable loading",
    async () => {
      await go();
      await expect(
        page.getByRole("button", { name: "Start session", exact: true }),
      ).toBeVisible();
    },
  );
  await page.clock.install();
  await page
    .getByRole("button", { name: "Start session", exact: true })
    .click();
  await primary().click();
  await primary().click();
  await check("setup waits for readiness", async () => {
    await expect(primary()).toHaveText("Ready");
    await page.clock.runFor(20000);
    await expect(primary()).toHaveText("Ready");
    assert.equal(logs.length, 0);
  });
  await primary().click();
  await page.clock.runFor(20000);
  await expect(primary()).toBeEnabled();
  await check(
    "confirmation logs once and early readiness preserves rest",
    async () => {
      await primary().click();
      await expect(root().locator(".voice-clock")).toContainText("0:30");
      await primary().click();
      await expect(root().locator(".voice-clock")).toContainText("0:30");
      assert.equal(logs.length, 1);
    },
  );
  await root()
    .getByRole("button", { name: "+15 seconds rest", exact: true })
    .click();
  await expect(root().locator(".voice-clock")).toContainText("0:45");
  await check(
    "reload restores paused progress and remaining rest",
    async () => {
      await page.reload();
      await expect(
        page.getByRole("button", { name: "Resume", exact: true }).first(),
      ).toBeVisible();
      await page.clock.runFor(10000);
      assert.equal(logs.length, 1);
    },
  );
  await page
    .getByRole("button", { name: "Resume", exact: true })
    .first()
    .click();
  await root()
    .locator("summary")
    .filter({ hasText: "Session options" })
    .click();
  await root()
    .getByRole("button", { name: "Workout library", exact: true })
    .click();
  await expect(root().getByLabel("Playlist", { exact: true })).toBeVisible();
  await root().getByRole("button", { name: "Play music", exact: true }).click();
  await check("music changes never advance sets", async () => {
    const before = logs.length;
    await root()
      .getByRole("button", { name: "Next song", exact: true })
      .click();
    await page.evaluate(() => window.guidedActions.nexttrack());
    assert.equal(logs.length, before);
  });
  await root()
    .getByLabel(/Lock-screen and headset controls/)
    .selectOption("coach");
  await check(
    "remote test consumes signal without changing workout",
    async () => {
      await root()
        .getByRole("button", { name: "Test remote controls", exact: true })
        .click();
      await page.evaluate(() => window.guidedActions.nexttrack());
      await expect(
        root().getByRole("button", { name: /Remote signal received/ }),
      ).toBeVisible();
      assert.equal(logs.length, 1);
    },
  );
  await screenshot("phone", 390);
  await screenshot("desktop", 1440);
  await page.evaluate(() => {
    document.documentElement.dir = "rtl";
  });
  await screenshot("rtl", 390);
  await check(
    "failed pain report stays durable and retries without resuming",
    async () => {
      failPain = true;
      await page
        .getByRole("button", { name: "Report pain", exact: true })
        .click();
      await expect(root().getByRole("alert")).toContainText("Stop");
      assert.ok(
        await page.evaluate(() =>
          Object.keys(localStorage).some((k) => k.endsWith(":pain")),
        ),
      );
      failPain = false;
      await root()
        .getByRole("button", { name: "Retry pain report", exact: true })
        .click();
      await expect(root().getByRole("alert")).toContainText("has been told");
      assert.equal(
        await page.evaluate(() =>
          Object.keys(localStorage).some((k) => k.endsWith(":pain")),
        ),
        false,
      );
      assert.equal(await primary().count(), 0);
      assert.equal(finishes, 0);
    },
  );
  await check(
    "timed work requires confirmation and completes the workout once",
    async () => {
      await page.evaluate(() => localStorage.clear());
      logs = [];
      await go();
      await page
        .getByRole("button", { name: "Start session", exact: true })
        .click();
      await primary().click();
      await primary().click();
      await primary().click();
      await page.clock.runFor(20000);
      await primary().click();
      await primary().click();
      await page.clock.runFor(31000);
      await page.clock.runFor(20000);
      await primary().click();
      await primary().click();
      await page.clock.runFor(30000);
      await expect(primary()).toHaveText("Ready");
      await primary().click();
      await page.clock.runFor(60000);
      assert.equal(logs.length, 2);
      await expect(root().locator(".voice-clock")).toContainText("0:00");
      await primary().click();
      assert.equal(logs.length, 3);
      assert.equal(logs[2].durationSeconds, 20);
      assert.equal(logs[2].reps, 0);
      await primary().click();
      await expect.poll(() => finishes).toBe(1);
    },
  );
  await check(
    "Arabic circuit preserves round order and actual distance",
    async () => {
      await page.evaluate(() => localStorage.clear());
      logs = [];
      script = buildSessionScript({
        title: "دائرة",
        language: "ar",
        exercises: planExercises({
          exercises: [
            {
              name: "Row",
              sets: 2,
              distanceMeters: 200,
              restSeconds: 30,
              group: { id: "A", kind: "superset" },
            },
            {
              name: "Plank",
              sets: 2,
              durationSeconds: 10,
              restSeconds: 30,
              group: { id: "A", kind: "superset" },
            },
          ],
        }),
      }).script;
      await go();
      await page
        .getByRole("button", { name: "Start session", exact: true })
        .click();
      await primary().click();
      await primary().click();
      await expect(primary()).toHaveText("Ready");
      await primary().click();
      await page.clock.runFor(20000);
      await root()
        .getByLabel(/Actual metres/)
        .fill("120");
      await primary().click();
      await expect(primary()).toHaveText("Ready");
      await expect.poll(() => logs.length).toBe(1);
      assert.equal(logs[0].distanceMeters, 120);
      assert.equal(logs[0].exerciseIndex, 0);
      await primary().click();
      await page.clock.runFor(30000);
      await primary().click();
      await expect(root()).toContainText("Next: Row");
      await expect.poll(() => logs.length).toBe(2);
      assert.equal(logs[1].exerciseIndex, 1);
      assert.equal(logs[1].durationSeconds, 10);
      await primary().click();
      await page.clock.runFor(31000);
      await expect(primary()).toHaveText("Ready");
      await primary().click();
      await page.clock.runFor(20000);
    await expect(root()).toContainText("الجولة 2");
    await expect(root().locator(".voice-now")).not.toContainText("0 reps");
      await screenshot("structured-arabic-distance", 390);
    },
  );
  assert.deepEqual(report.errors, []);
} finally {
  await page
    .screenshot({ path: folder + "/last-state.png", fullPage: true })
    .catch(() => {});
  await writeFile(folder + "/report.json", JSON.stringify(report, null, 2));
  await browser.close();
}
