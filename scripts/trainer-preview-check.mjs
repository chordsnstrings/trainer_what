// Real pages and APIs, synthetic local model/audio providers only.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
const base = process.env.TEST_APP_URL;
if (!base || !["localhost", "127.0.0.1"].includes(new URL(base).hostname) || process.env.NODE_ENV === "production") throw Error("Use the isolated conversation runner");
const folder = "test-results/trainer-preview";
await mkdir(folder, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--use-file-for-fake-audio-capture=" + process.env.ONBOARDING_MICROPHONE_FIXTURE] });
const report = { checks: [], errors: [], captures: [] };
async function capture(page, path) {
  // Capture settled UI rather than a transient page/message arrival frame.
  await page.evaluate(async () => {
    await document.fonts.ready;
    for (const animation of document.getAnimations()) {
      if (animation.effect?.getTiming().iterations === Infinity) continue;
      try { animation.finish(); } catch {}
    }
  });
  await page.screenshot({ path, fullPage: true });
}
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, permissions: ["microphone"], serviceWorkers: "block" });
    const login = await context.request.post(base + "/api/v1/auth/login", { headers: { origin: base }, data: { email: `preview-${width}@example.test`, password: "TrainerDemo2026!" } });
    assert.equal(login.status(), 200);
    const before = (await context.cookies()).find(c => c.name === "session").value;
    // A fresh test profile for each screen size; its actual entry stays UI-tested.
    const reset = await context.request.post(base + "/api/v1/trainer-preview/start", { headers: { origin: base }, data: { reset: true } });
    assert.equal(reset.status(), 200, await reset.text());
    await context.request.post(base + "/api/v1/trainer-preview/end", { headers: { origin: base }, data: {} });
    const journeyStarted = Date.now();
    const page = await context.newPage(), escaped = [];
    page.on("pageerror", error => report.errors.push(error.message));
    page.on("request", request => {
      const pathname = new URL(request.url()).pathname;
      if (page.url().includes("/trainer/preview/app") && pathname.startsWith("/api/v1/") && !pathname.startsWith("/api/v1/trainer-preview") && !pathname.startsWith("/api/v1/public/")) escaped.push(pathname);
    });
    await page.goto(base + "/trainer/brain");
    await page.getByRole("button", { name: "Try client experience", exact: true }).click({ timeout: 45000 });
    await expect(page).toHaveURL(/\/trainer\/preview\/app\/intake$/);
    await expect(page.getByLabel("Trainer test controls")).toBeVisible();
    // The reported white-on-white preview panel must stay readable in both
    // saved appearances, including after a real server-rendered reload.
    for (const scheme of ["dark", "light"]) {
      await page.locator(".trainer-preview-bar > details > summary").click();
      const savedAppearance = page.waitForResponse(r => r.url().endsWith("/trainer-preview/run/preferences/appearance") && r.request().method() === "PUT");
      await page.locator(`.trainer-preview-bar input[name=appearance][value=${scheme}]`).check();
      assert.equal((await savedAppearance).status(), 200);
      await page.reload();
      await expect(page.locator(".member-shell")).toHaveAttribute("data-color-scheme", scheme);
      await expect(page.locator(".trainer-preview-bar > details")).not.toHaveAttribute("open", "");
      const contrast = await page.locator(".trainer-preview-bar").evaluate(bar => {
        const lum = value => {
          const channels = value.match(/[\d.]+/g).slice(0, 3).map(Number).map(x => x / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4);
          return channels.reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
        };
        const background = lum(getComputedStyle(bar).backgroundColor);
        return [...bar.querySelectorAll(".trainer-preview-top strong, .trainer-preview-top small, .trainer-preview-top button, details > summary")].map(el => {
          const foreground = lum(getComputedStyle(el).color);
          return { text: el.textContent, ratio: (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05) };
        });
      });
      for (const value of contrast) assert.ok(value.ratio >= 4.5, `${scheme} preview ${value.text}: ${value.ratio}`);
      await capture(page, `${folder}/${width}-preview-${scheme}.png`);
      report.captures.push(`${width}-preview-${scheme}`);
    }
    await page.getByLabel("I allow my information to be used for coaching.").check();
    await page.getByRole("button", { name: "Let's start", exact: true }).click();
    await page.getByLabel("Your onboarding message").fill("I'm 28, a beginner. Build sustainable strength. 3 days a week: Monday, Wednesday, Friday. 45 minutes. Dumbbells. No injuries or limitations.");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.getByRole("button", { name: "Review my answers", exact: true })).toBeVisible({ timeout: 45000 });
    await page.getByLabel("Your onboarding message").fill("let's get started.");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.locator(".onboarding-message.assistant").filter({ hasText: "Your profile is saved" })).toHaveCount(1, { timeout: 45000 });
    await expect(page.getByRole("link", { name: "Open Training", exact: true })).toHaveAttribute("href", "/trainer/preview/app/program");
    await page.goto(base + "/trainer/preview/app/chat");
    await page.locator("#chat-message").fill("What do I do when my strength training schedule changes?");
    await page.locator(".chat-composer button[type=submit]").click();
    await expect(page.locator(".chat-messages")).toContainText("What time do you have available?", { timeout: 45000 });
    await expect(page.getByRole("button", { name: /Approve for my test/ })).toHaveCount(0);
    await expect.poll(async () => (await (await context.request.get(base + "/api/v1/trainer-preview")).json()).workout, { timeout: 45000 }).toBe(true);
    await page.goto(base + "/trainer/preview/app/program");
    await expect(page).toHaveURL(/\/trainer\/preview\/app\/program$/);
    await page.getByRole("button", { name: "Use workout log", exact: true }).click({ timeout: 30000 });
    await expect(page).toHaveURL(/\/trainer\/preview\/app\/workouts\//);
    const logSet = page.getByRole("button", { name: /^Log set 1$/ }).last();
    await logSet.click();
    await expect.poll(async () => (await (await context.request.get(base + "/api/v1/trainer-preview/run/bootstrap")).json()).sets.length).toBe(1);
    await page.goto(base + "/trainer/preview/app/nutrition");
    await expect(page.locator(".member-shell")).toBeVisible();
    await expect(page.getByRole("heading", { name: /nutrition|food|meal/i }).first()).toBeVisible();
    // All member navigation, settings reads and mutation helpers stay scoped.
    assert.deepEqual(escaped, []);
    assert.equal((await context.cookies()).find(c => c.name === "session").value, before);
    assert.equal(await page.evaluate(() => !!localStorage.getItem("trainer:offline")), false);
    for (const path of ["/chat", "/program", "/nutrition"]) {
      await page.goto(base + "/trainer/preview/app" + path);
      await expect(page.getByLabel("Trainer test controls")).toBeVisible();
      if (path === "/chat") await expect(page.locator(".chat-messages")).toContainText("What time do you have available?");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      const name = width + path.replaceAll("/", "-");
      await capture(page, folder + "/" + name + ".png"); report.captures.push(name);
    }
    await page.goto(base + "/trainer/preview/app/chat");
    // The rapid screenshot reloads and complete setup journey share the real
    // trainer's 120/minute budget. Start voice/exit/resume in its next window,
    // rather than weakening the application limit for this synthetic run.
    await page.waitForTimeout(Math.max(0, 61_000 - (Date.now() - journeyStarted)));
    await page.getByRole("button", { name: "Call coach", exact: true }).click();
    await page.getByLabel("I allow my speech to be processed for this AI call.").check();
    await page.getByRole("button", { name: "Start call", exact: true }).click();
    await expect(page.getByRole("button", { name: "Mute microphone", exact: true })).toBeVisible({ timeout: 30000 });
    await expect.poll(async () => {
      const data = await (await context.request.get(base + "/api/v1/trainer-preview/run/messages/thread")).json();
      return data.messages.filter(m => /Spoken answer/.test(m.data.text)).length;
    }, { timeout: 45000, intervals: [1000] }).toBeGreaterThanOrEqual(2);
    await page.getByRole("button", { name: "End call", exact: true }).click();
    await page.getByRole("button", { name: "Close voice call", exact: true }).click();
    await page.getByLabel("Trainer test controls").getByRole("button", { name: "Back to My Brain", exact: true }).click();
    await expect(page).toHaveURL(/\/trainer\/brain$/);
    assert.equal((await (await context.request.get(base + "/api/v1/bootstrap")).json()).user.role, "owner");
    await page.getByRole("button", { name: "Try client experience", exact: true }).click();
    await expect(page).toHaveURL(/\/trainer\/preview\/app$/);
    const resumed = await (await context.request.get(base + "/api/v1/trainer-preview/run/bootstrap")).json();
    assert.equal(resumed.sets.length, 1);
    report.checks.push(width + "px: same login, conversational intake handoff, automatically approved chat/workout, saved set, nutrition, two hands-free voice turns, exit and resume");
    await context.close();
  }
  assert.deepEqual(report.errors, []);
} catch (e) {
  for (const context of browser.contexts()) for (const page of context.pages()) {
    await page.screenshot({ path: folder + "/failure.png", fullPage: true }).catch(() => {});
    console.error("Preview journey failure", page.url(), (await page.locator("body").innerText().catch(() => "")).slice(-6000));
  }
  throw e;
} finally { await writeFile(folder + "/report.json", JSON.stringify(report, null, 2)); await browser.close(); }
