import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { chromium, expect } from "@playwright/test";
import { websiteFacts, arabicWebsiteFacts, secondWebsiteOffer } from "./website-onboarding-fixture.mjs";
const base = process.env.TEST_APP_URL;
if (!base || !["localhost", "127.0.0.1"].includes(new URL(base).hostname) || process.env.NODE_ENV === "production" || process.env.WEBSITE_ONBOARDING_FIXTURE !== "true") throw Error("Use the isolated website onboarding fixture");
const folder = "test-results/onboarding-website";
await mkdir(folder, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
let activePage;
const report = { checks: [], captures: [], errors: [] };
async function capture(page, name) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  assert.equal(overflow, false, name + " must fit the viewport");
  await page.screenshot({ path: `${folder}/${name}.png`, fullPage: true }); report.captures.push(name);
}
try {
  for (const [name, width, facts] of [["desktop", 1440, websiteFacts], ["phone-arabic", 390, arabicWebsiteFacts]]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block" });
    context.setDefaultTimeout(15000);
    const unique = randomUUID().replaceAll("-", "");
    const registered = await context.request.post(base + "/api/v1/auth/register", { headers: { origin: base }, data: { name: "Synthetic Website Coach", email: `website-${unique}@example.test`, password: "SyntheticWebsite2026!", slug: `website-${unique}`, accepted: true } });
    assert.equal(registered.status(), 201, await registered.text());
    const page = await context.newPage(); activePage = page; page.on("pageerror", e => report.errors.push(e.message));
    await page.goto(base + "/setup/page");
    await expect(page.locator('.onboarding-chat[data-chat-mode="website"]')).toBeVisible({ timeout: 45000 });
    const dismiss = page.getByRole("button", { name: "No thanks", exact: true }); if (await dismiss.isVisible()) await dismiss.click();
    await page.getByLabel("Your onboarding message").fill(Object.values(facts).join(". "));
    const reply = page.waitForResponse(r => r.url().endsWith("/onboarding-chat/messages") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    const answered = await (await reply).json();
    assert.equal(answered.error, undefined, JSON.stringify({ error: answered.error, question: answered.lastQuestion, missing: answered.missing }));
    assert.equal(answered.lastQuestion.field, "website.offers", JSON.stringify({ question: answered.lastQuestion, missing: answered.missing, facts: answered.facts }));
    if (name === "desktop") {
      await page.getByRole("button", { name: "Add another package", exact: true }).click({ timeout: 30000 });
      await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeDisabled();
      await page.getByLabel("Your onboarding message").fill(Object.values(secondWebsiteOffer).join(". "));
      await page.getByRole("button", { name: "Send message", exact: true }).click();
      await expect(page.locator(".onboarding-website-offers")).toContainText(secondWebsiteOffer.name, { timeout: 30000 });
    }
    await page.getByRole("button", { name: "These are my packages", exact: true }).click({ timeout: 30000 });
    const photos = page.getByRole("region", { name: "Photos for your website" });
    await expect(photos).toBeVisible({ timeout: 30000 });
    await photos.getByRole("checkbox").check();
    const fixture = color => sharp({ create: { width: 640, height: 800, channels: 3, background: color } }).png().toBuffer();
    await page.getByLabel("Upload website photos").setInputFiles([
      { name: "synthetic-portrait.png", mimeType: "image/png", buffer: await fixture("#7c957b") },
      { name: "synthetic-training.png", mimeType: "image/png", buffer: await fixture("#8b7966") },
    ]);
    await expect(photos.locator('.onboarding-website-photo-detail')).toHaveCount(2, { timeout: 30000 });
    await photos.getByLabel("What does this photo show?").nth(0).fill(name === "desktop" ? "Alex in the training studio" : "أليكس في قاعة التدريب");
    await photos.getByLabel("What does this photo show?").nth(1).fill(name === "desktop" ? "My strength training space" : "مساحة تدريب القوة");
    await capture(page, name + "-photos");
    await photos.getByRole("button", { name: "Use these photos", exact: true }).click();
    await expect(page.locator(".onboarding-website-ready")).toContainText("Your website draft is ready", { timeout: 60000 });
    await capture(page, name + "-ready");
    const siteResponse = await context.request.get(base + "/api/v1/tenant/site"); assert.equal(siteResponse.status(), 200);
    const site = await siteResponse.json(); assert.equal(site.published, null); assert.equal(site.version, 1);
    assert.equal(site.draft.builder.pages.length, 3);
    assert.ok(site.draft.builder.pages.flatMap(p => p.sections).some(s => s.moduleId === "scroll-journey"));
    await page.locator(".onboarding-website-ready").getByRole("link", { name: "Review my website", exact: true }).click();
    await expect(page.locator(".sb-preview-notice")).toContainText("Private draft preview", { timeout: 30000 });
    await expect(page.locator(".sb-preview h1")).toContainText(facts.headline);
    const imageCount = await page.locator('.sb-preview img[src^="/api/v1/media/"]:visible').count(); assert.ok(imageCount >= 2);
    for (const image of await page.locator('.sb-preview img[src^="/api/v1/media/"]:visible').all()) await image.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => page.locator('.sb-preview img[src^="/api/v1/media/"]:visible').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0))).toBe(true);
    await capture(page, name + "-home");
    // Native programme action follows the private page + section anchor on phones too.
    await page.locator('a.sb-button[href*="/coaching#"]:visible').first().click();
    await expect(page).toHaveURL(/\/trainer\/website\/preview\/coaching#/);
    await expect(page.locator(".sb-plan").filter({ hasText: facts.name })).toContainText(facts.name);
    await expect(page.locator(".sb-plan").filter({ hasText: facts.name }).locator(".sb-plan-price")).toContainText(/399|٣٩٩/);
    await expect(page.locator(".sb-plan").filter({ hasText: facts.name })).toContainText(name === "desktop" ? "Draft offer" : "مسودة باقة");
    if (name === "desktop") await expect(page.locator(".sb-plan").filter({ hasText: secondWebsiteOffer.name })).toContainText("249");
    await capture(page, name + "-pricing");
    await page.reload(); await expect(page.locator(".sb-plan").filter({ hasText: facts.name })).toContainText(facts.name);
    await page.locator('.sb-preview-notice a[href="/setup/page"]').click();
    await expect(page.locator(".onboarding-website-ready")).toBeVisible({ timeout: 30000 });
    assert.equal((await (await context.request.get(base + "/api/v1/tenant/site")).json()).version, 1);
    report.checks.push(name + ": real onboarding, two explicit photo uploads, automatic AI draft, scroll journey, native prices, private navigation and reload persistence");
    await context.close();
  }
  assert.deepEqual(report.errors, []);
} catch (error) {
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({ path: folder + "/failure.png", fullPage: true });
    console.error(await activePage.locator("body").innerText());
  }
  throw error;
} finally {
  await writeFile(folder + "/report.json", JSON.stringify(report, null, 2)); await browser.close();
}
console.log(JSON.stringify(report));
