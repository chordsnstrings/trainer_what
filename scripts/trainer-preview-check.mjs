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
    const page = await context.newPage(), escaped = [];
    page.on("pageerror", error => report.errors.push(error.message));
    page.on("request", request => {
      const pathname = new URL(request.url()).pathname;
      if (page.url().includes("/trainer/preview/app") && pathname.startsWith("/api/v1/") && !pathname.startsWith("/api/v1/trainer-preview") && !pathname.startsWith("/api/v1/public/")) escaped.push(pathname);
    });
    await page.goto(base + "/trainer/brain");
    await page.getByRole("button", { name: "Try my AI", exact: true }).click({ timeout: 45000 });
    await expect(page).toHaveURL(/\/trainer\/preview\/app\/intake$/);
    await expect(page.getByLabel("Trainer test controls")).toBeVisible();
    await page.getByLabel("I allow my information to be used for coaching.").check();
    await page.getByRole("button", { name: "Let's start", exact: true }).click();
    await page.getByLabel("Your onboarding message").fill("I'm 28, a beginner. Build sustainable strength. 3 days a week: Monday, Wednesday, Friday. 45 minutes. Dumbbells. No injuries or limitations.");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await page.getByRole("button", { name: "Review my answers", exact: true }).click({ timeout: 45000 });
    await page.getByRole("button", { name: "Confirm my coaching profile", exact: true }).click();
    await expect(page.locator(".onboarding-message.assistant").filter({ hasText: "Your profile is" })).toHaveCount(1, { timeout: 30000 });
    await page.goto(base + "/trainer/preview/app/chat");
    await page.locator("#chat-message").fill("What do I do when my strength training schedule changes?");
    await page.locator(".chat-composer button").filter({ hasText: /Ask.*digital/i }).click();
    await expect(page.locator(".trainer-preview-bar summary")).toContainText("reply ready to review", { timeout: 45000 });
    if (!await page.locator(".trainer-preview-bar details").evaluate(e => e.open)) await page.locator(".trainer-preview-bar summary").click();
    await expect(page.locator(".preview-review")).toContainText("What time do you have available?");
    await page.getByRole("button", { name: "Approve for my test conversation", exact: true }).click();
    await expect(page.locator(".chat-messages")).toContainText("What time do you have available?");
    await page.getByRole("button", { name: "Prepare my workout", exact: true }).click();
    await expect(page.getByRole("button", { name: "Approve for my test profile", exact: true })).toBeVisible({ timeout: 45000 });
    await page.getByRole("button", { name: "Approve for my test profile", exact: true }).click();
    await expect(page).toHaveURL(/\/trainer\/preview\/app\/program$/);
    await page.locator(".program-next button").click({ timeout: 30000 });
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
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      const name = width + path.replaceAll("/", "-");
      await page.screenshot({ path: folder + "/" + name + ".png", fullPage: true }); report.captures.push(name);
    }
    await page.goto(base + "/trainer/preview/app/chat");
    await page.getByRole("button", { name: "Talk to my digital coach", exact: true }).click();
    await page.getByLabel("I allow my speech to be processed for this AI call.").check();
    await page.getByRole("button", { name: "Start call", exact: true }).click();
    await expect(page.getByRole("button", { name: "Mute microphone", exact: true })).toBeVisible({ timeout: 30000 });
    await expect.poll(async () => {
      const data = await (await context.request.get(base + "/api/v1/trainer-preview/run/messages/thread")).json();
      return data.messages.filter(m => /Spoken answer/.test(m.data.text)).length;
    }, { timeout: 45000 }).toBeGreaterThanOrEqual(2);
    await page.getByRole("button", { name: "End call", exact: true }).click();
    await page.getByRole("button", { name: "Close voice call", exact: true }).click();
    await page.getByLabel("Trainer test controls").getByRole("button", { name: "Back to My Brain", exact: true }).click();
    await expect(page).toHaveURL(/\/trainer\/brain$/);
    assert.equal((await (await context.request.get(base + "/api/v1/bootstrap")).json()).user.role, "owner");
    await page.getByRole("button", { name: "Try my AI", exact: true }).click();
    await expect(page).toHaveURL(/\/trainer\/preview\/app$/);
    const resumed = await (await context.request.get(base + "/api/v1/trainer-preview/run/bootstrap")).json();
    assert.equal(resumed.sets.length, 1);
    report.checks.push(width + "px: same login, intake, reviewed chat, generated workout, saved set, nutrition, two hands-free voice turns, exit and resume");
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
