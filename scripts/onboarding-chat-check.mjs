// Real application/API/database + isolated deterministic model fixture.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
const base = process.env.TEST_APP_URL;
if (!base || !["localhost", "127.0.0.1"].includes(new URL(base).hostname) || process.env.NODE_ENV === "production") throw Error("Use the isolated onboarding runner");
const folder = "test-results/onboarding-chat";
await mkdir(folder, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--use-file-for-fake-audio-capture=" + process.env.ONBOARDING_MICROPHONE_FIXTURE] });
const report = { checks: [], errors: [], captures: [] };
async function login(email, width, userAgent) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, ...(userAgent ? { userAgent } : {}), permissions: ["microphone"], serviceWorkers: "block" });
  const result = await context.request.post(base + "/api/v1/auth/login", { headers: { origin: base }, data: { email, password: "TrainerDemo2026!" } });
  assert.equal(result.status(), 200);
  const page = await context.newPage();
  page.on("pageerror", error => report.errors.push(error.message));
  return { context, page };
}
async function go(page, path) {
  await page.goto(base + path);
  await expect(page.locator(".onboarding-chat")).toBeVisible({ timeout: 45000 });
  await expect(page.getByLabel("Your onboarding message")).toBeVisible({ timeout: 30000 });
  const dismiss = page.getByRole("button", { name: "No thanks", exact: true });
  if (await dismiss.isVisible()) await dismiss.click();
}
async function capture(page, name) {
  const metrics = await page.evaluate(() => {
    const composer = document.querySelector(".onboarding-composer"), root = document.querySelector(".onboarding-chat");
    const unlabelled = [...root.querySelectorAll("input,textarea,select")].filter(e => e.getClientRects().length && !e.labels?.length && !e.getAttribute("aria-label"));
    return { overflow: document.documentElement.scrollWidth > innerWidth + 1, composerFits: composer.getBoundingClientRect().right <= innerWidth + 1, unlabelled: unlabelled.length };
  });
  assert.equal(metrics.overflow, false); assert.equal(metrics.composerFits, true); assert.equal(metrics.unlabelled, 0);
  await page.screenshot({ path: folder + "/" + name + ".png", fullPage: true });
  report.captures.push({ name, ...metrics });
}
try {
  async function share(page, name, text) {
    await page.getByRole("button", { name: "Attach files", exact: true }).click();
    await page.getByLabel("These are mine, or I have permission to use them.").check();
    await page.getByLabel("Choose files for this conversation").setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from(text) });
    await expect(page.getByLabel("Files ready to send")).toContainText(name);
    await page.locator(".onboarding-file-tray .onboarding-file-title").click();
    await expect(page.locator(".onboarding-file-tray pre")).toContainText(text);
    const send = page.getByRole("button", { name: "Send message", exact: true });
    await expect(send).toBeEnabled();
    const [sent] = await Promise.all([
      page.waitForResponse(r => r.url().endsWith("/onboarding-chat/messages") && r.request().method() === "POST", { timeout: 20000 }),
      send.click({ timeout: 15000 }),
    ]);
    assert.equal((await sent.json()).error, undefined);
    await expect(page.getByLabel("Files ready to send")).toHaveCount(0);
    await expect(page.locator(".onboarding-message.person").last()).toContainText(name);
  }
  async function voice(page, clone = false) {
    const saved = await page.locator('.onboarding-message.person svg[aria-label="From your voice conversation"]').count();
    await page.getByRole("button", { name: "Start voice conversation", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByLabel("I allow my speech to be processed for this AI call.").check();
    if (clone) { await page.getByLabel("Create my trainer voice while we talk").check(); await page.getByLabel("I agree to these voice permissions.").check(); }
    await capture(page, clone ? "trainer-call-permissions" : "client-call-permissions");
    await page.getByRole("button", { name: "Start call", exact: true }).click();
    await expect(page.getByRole("button", { name: "End call", exact: true })).toBeVisible();
    await expect.poll(() => page.locator('.onboarding-message.person svg[aria-label="From your voice conversation"]').count(), { timeout: 60000 }).toBeGreaterThan(saved + 1);
    // Two spontaneous microphone turns, no hold-to-talk or per-turn send.
    await capture(page, clone ? "trainer-hands-free-call" : "client-hands-free-call");
    await page.getByRole("button", { name: "Mute microphone", exact: true }).click();
    await expect(page.getByRole("button", { name: "Unmute microphone", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Unmute microphone", exact: true }).click();
    if (clone) await expect(page.locator(".onboarding-call-training")).toContainText(/ready to preview|being prepared|voice.*prepar/i, { timeout: 120000 });
    await page.getByRole("button", { name: "End call", exact: true }).click();
    await expect(page.getByRole("button", { name: "Call again", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Close voice call", exact: true }).click();
    report.checks.push((clone ? "Trainer Kamran call and opt-in Cartesia sample" : "Subscriber voice conversation") + ": automatic repeated turns, mute/unmute and hangup");
  }
  const { context: coach, page } = await login("coach@example.test", 1440);
  await go(page, "/setup");
  await expect(page.locator(".onboarding-chat")).toHaveAttribute("data-chat-style", "web");
  await page.getByLabel("Your onboarding message").fill("I'm Alex in Dubai. I coach busy beginners with simple strength sessions.");
  const sent = page.waitForResponse(r => r.url().endsWith("/onboarding-chat/messages") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  const response = await sent;
  const reply = await response.json();
  assert.equal(response.status(), 200, JSON.stringify(reply));
  assert.equal(reply.error, undefined, JSON.stringify({ error: reply.error, pending: reply.pending }));
  await expect(page.locator(".onboarding-message.assistant").filter({ hasText: "That sounds doable" })).toHaveCount(1, { timeout: 60000 });
  await page.reload();
  await expect(page.locator(".onboarding-message.person")).toContainText("busy beginners", { timeout: 30000 });
  await page.getByRole("button", { name: "View saved details", exact: true }).click();
  await expect(page.getByLabel("Saved details", { exact: true })).toContainText("Alex");
  await capture(page, "trainer-desktop");
  report.checks.push("Trainer multi-answer message, persisted resume and grounded review");
  await page.getByRole("button", { name: "Close review", exact: true }).click();
  await page.getByLabel("Your onboarding message").fill("A draft I have not sent yet");
  await page.reload();
  await expect(page.getByLabel("Your onboarding message")).toHaveValue("A draft I have not sent yet");
  await page.getByLabel("Your onboarding message").fill("");
  await page.getByRole("button", { name: "Save for later", exact: true }).click();
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 }); await capture(page, "trainer-phone");
  report.checks.push("Unsent draft recovery and code-only pause/resume");
  await share(page, "trainer-notes.txt", "Progress one small step at a time.");
  await page.getByLabel("Your onboarding message").fill("A draft survives the call");
  await voice(page, true);
  await expect(page.getByLabel("Your onboarding message")).toHaveValue("A draft survives the call");
  await coach.close();
  const { context: member, page: phone } = await login("sam.taylor@example.test", 390, "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1");
  // The demo has a complete profile; withdraw its synthetic permission to start fresh.
  const withdrawn = await member.request.post(base + "/api/v1/privacy/consent", { headers: { origin: base }, data: { type: "coaching", granted: false } });
  assert.equal(withdrawn.status(), 200);
  await phone.goto(base + "/app/intake");
  const checkbox = phone.getByLabel("I allow my information to be used for coaching.");
  await expect(checkbox).not.toBeChecked({ timeout: 30000 });
  await expect(phone.getByRole("button", { name: "Let's start", exact: true })).toBeDisabled();
  await checkbox.check();
  await phone.getByRole("button", { name: "Let's start", exact: true }).click();
  await expect(phone.getByLabel("Your onboarding message")).toBeVisible();
  await phone.getByLabel("Your onboarding message").fill("I'm 28, a beginner. Build sustainable strength. 3 days a week: Monday, Wednesday, Friday. 45 minutes. Dumbbells. No injuries or limitations.");
  const memberSent = phone.waitForResponse(r => r.url().endsWith("/onboarding-chat/messages") && r.request().method() === "POST");
  await phone.getByRole("button", { name: "Send message", exact: true }).click();
  const memberReply = await (await memberSent).json();
  assert.equal(memberReply.error, undefined, JSON.stringify({ error: memberReply.error }));
  await expect(phone.getByRole("button", { name: "Review my answers", exact: true })).toBeVisible({ timeout: 60000 });
  await phone.getByRole("button", { name: "Review my answers", exact: true }).click();
  await expect(phone.getByLabel("Saved details", { exact: true })).toContainText("Monday, Wednesday, Friday");
  await expect(phone.locator(".onboarding-chat")).toHaveAttribute("data-chat-style", "ios");
  await capture(phone, "client-review-phone");
  await phone.getByRole("button", { name: "Confirm my coaching profile", exact: true }).click();
  await expect(phone.locator(".onboarding-message.assistant").filter({ hasText: "Your profile is" })).toHaveCount(1, { timeout: 30000 });
  await phone.reload(); await expect(phone.getByRole("link", { name: /my workout|my training plan/ })).toBeVisible({ timeout: 30000 });
  await phone.setViewportSize({ width: 360, height: 740 }); await capture(phone, "client-small-phone");
  report.checks.push("Client explicit permission, multi-answer intake, review, real save and continuation");
  await share(phone, "my-notes.md", "I have dumbbells and prefer short sessions.");
  await voice(phone);
  await member.close();
  const { context: android, page: androidPage } = await login("coach@example.test", 360, "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36");
  await androidPage.emulateMedia({ reducedMotion: "reduce" }); await go(androidPage, "/setup");
  await expect(androidPage.locator(".onboarding-chat")).toHaveAttribute("data-chat-style", "android");
  assert.equal(await androidPage.locator(".onboarding-message").last().evaluate(e => getComputedStyle(e).animationName), "none");
  await capture(androidPage, "trainer-android-reduced-motion");
  await androidPage.setViewportSize({ width: 320, height: 740 }); await capture(androidPage, "trainer-320px");
  await android.close();
  report.checks.push("Private file previews and attachment-only sends for both roles; desktop, iPhone, Android and reduced-motion layouts");
  assert.deepEqual(report.errors, []);
} catch (error) {
  for (const context of browser.contexts()) for (const page of context.pages()) {
    console.error("Onboarding browser failure", JSON.stringify({ url: page.url(), errors: report.errors, text: (await page.locator("body").innerText().catch(() => "")).slice(-8000), buttons: await page.locator(".onboarding-composer button").evaluateAll(es => es.map(e => ({ label: e.getAttribute("aria-label"), disabled: e.disabled, box: e.getBoundingClientRect().toJSON() }))).catch(() => []) }));
    await page.screenshot({ path: folder + "/failure.png", fullPage: true }).catch(() => {});
  }
  throw error;
} finally {
  await writeFile(folder + "/report.json", JSON.stringify(report, null, 2));
  await browser.close();
}
