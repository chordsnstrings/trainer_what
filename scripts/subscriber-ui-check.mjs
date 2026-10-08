// Real local API + synthetic seed. Failure injection covers recovery boundaries.
// Run through scripts/run-subscriber-ui-check.mjs (ephemeral credentials).
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
const base = process.env.TEST_APP_URL;
if (!base || !["localhost", "127.0.0.1"].includes(new URL(base).hostname) || process.env.NODE_ENV === "production") throw Error("Use the isolated loopback fixture runner");
if (!process.env.DEMO_PASSWORD) throw Error("Use run-subscriber-ui-check.mjs to generate fixture credentials");
const folder = "test-results/subscriber-ui";
await mkdir(folder, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
context.setDefaultTimeout(30000);
const page = await context.newPage();
const report = { checks: [], errors: [] };
page.on("pageerror", e => report.errors.push(e.message));
let next = 0;
await page.route("**/api/v1/**", async route => {
  const delay = Math.max(0, next - Date.now()); next = Date.now() + delay + 500;
  if (delay) await new Promise(resolve => setTimeout(resolve, delay));
  await route.continue().catch(() => {});
});
const credentials = { email: "sam.taylor@example.test", password: process.env.DEMO_PASSWORD };
async function login(ctx, email = credentials.email) {
  const r = await ctx.request.post(base + "/api/v1/auth/login", { headers: { origin: base }, data: { ...credentials, email } });
  assert.equal(r.status(), 200);
}
async function go(path) {
  await page.goto(base + path);
  await expect(page.locator(".member-shell")).toBeVisible();
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
}
async function check(name, run) { await run(); report.checks.push(name); console.log("PASS " + name); }
const unavailable = route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Synthetic unavailable" }) });
try {
  await login(context); await go("/app");
  for (const name of [/without analytics/i, /^No thanks$/i]) {
    const button = page.getByRole("button", { name }); if (await button.count()) await button.first().click();
  }
  await check("default phone tab labels fit at 360px", async () => {
    await page.setViewportSize({ width: 360, height: 740 });
    assert.deepEqual(await page.locator(".member-tab-label").evaluateAll(labels => labels.filter(label => label.scrollWidth > label.clientWidth).map(label => label.textContent)), []);
    await page.setViewportSize({ width: 390, height: 844 });
  });
  let failReads = true, sent = 0;
  await page.route("**/api/v1/messages/thread*", route => failReads ? unavailable(route) : route.fallback());
  await check("chat initial failure has an explicit working retry", async () => {
    await go("/app/chat");
    await expect(page.locator(".member-shell [role=alert]")).toContainText("Messages could not be loaded");
    failReads = false;
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.locator(".member-shell [role=alert]")).toHaveCount(0);
  });
  await check("chat draft survives tab navigation and reload", async () => {
    await page.getByLabel("Your message", { exact: true }).fill("Synthetic retained draft");
    await page.locator('.member-tabbar a[href="/app"]').click();
    await page.locator('.member-tabbar a[href="/app/chat"]').click();
    await expect(page.getByLabel("Your message", { exact: true })).toHaveValue("Synthetic retained draft");
    await go("/app/chat");
    await expect(page.getByLabel("Your message", { exact: true })).toHaveValue("Synthetic retained draft");
  });
  await check("rejected chat sends retain the draft", async () => {
    await page.route("**/api/v1/messages", unavailable);
    await page.getByRole("button", { name: "Send to Alex", exact: true }).click();
    await expect(page.locator(".member-shell [role=alert]")).toContainText("Your message was not sent");
    await expect(page.getByLabel("Your message", { exact: true })).toHaveValue("Synthetic retained draft");
    await page.unroute("**/api/v1/messages", unavailable);
  });
  await check("committed chat send survives failed refresh without duplicate send", async () => {
    await page.route("**/api/v1/messages", async route => {
      sent++; const response = await route.fetch(); assert.ok(response.ok()); failReads = true; await route.fulfill({ response });
    });
    await page.getByRole("button", { name: "Send to Alex", exact: true }).click();
    await expect(page.locator(".member-shell [role=alert]")).toContainText("Messages could not be loaded");
    await expect(page.getByLabel("Your message", { exact: true })).toHaveValue("");
    await expect(page.getByText("Your message was not sent", { exact: false })).toHaveCount(0);
    await page.screenshot({ path: folder + "/chat-recovery.png", fullPage: true });
    failReads = false; await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.locator(".chat-messages")).toContainText("Synthetic retained draft");
    assert.equal(sent, 1); await go("/app/chat");
    await expect(page.getByLabel("Your message", { exact: true })).toHaveValue("");
  });
  await check("pending chat sends remain guarded when returning to the thread", async () => {
    await page.unroute("**/api/v1/messages");
    let release, started;
    const held = new Promise(resolve => { release = resolve; });
    const accepted = new Promise(resolve => { started = resolve; });
    await page.route("**/api/v1/messages", async route => {
      const response = await route.fetch(); assert.ok(response.ok()); started();
      await held; await route.fulfill({ response });
    });
    await page.getByLabel("Your message", { exact: true }).fill("Synthetic pending send");
    await page.getByRole("button", { name: "Send to Alex", exact: true }).click();
    await accepted;
    try {
      await page.locator('.member-tabbar a[href="/app"]').click();
      await page.locator('.member-tabbar a[href="/app/chat"]').click();
      await expect(page.getByRole("button", { name: "Send to Alex", exact: true })).toBeDisabled();
      await expect(page.getByLabel("Your message", { exact: true })).toBeDisabled();
    } finally { release(); }
    await expect(page.getByLabel("Your message", { exact: true })).toBeEnabled({ timeout: 20000 });
    await expect(page.getByLabel("Your message", { exact: true })).toHaveValue("");
    await page.unroute("**/api/v1/messages");
  });
  await check("intake answers and step survive navigation; consent remains explicit", async () => {
    await go("/app/intake");
    await page.getByRole("button", { name: "Use profile forms", exact: true }).last().click();
    await page.locator('[name="age"]').fill("28");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.locator('[name="goal"]').fill("Build sustainable strength");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.locator('[name="equipment"]').fill("Dumbbells");
    await go("/app/more"); await go("/app/intake");
    await expect(page.locator('[data-step="2"]')).toBeVisible();
    await expect(page.locator('[name="equipment"]')).toHaveValue("Dumbbells");
    await expect(page.locator('[name="goal"]')).toHaveValue("Build sustainable strength");
    await page.locator('[name="days"]').fill("");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.locator('[data-step="2"]')).toBeVisible();
    await page.locator('[name="days"]').fill("99");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.locator('[data-step="2"]')).toBeVisible();
    await page.locator('[name="days"]').fill("3");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.locator('[name="limitations"]').fill("Synthetic answer");
    await page.locator('[name="consent"]').check();
    await go("/app/intake");
    await expect(page.locator('[data-step="3"]')).toBeVisible();
    await expect(page.locator('[name="limitations"]')).toHaveValue("Synthetic answer");
    await expect(page.locator('[name="consent"]')).not.toBeChecked();
    await page.locator('[name="consent"]').check();
    await page.getByRole("button", { name: "Save coaching profile", exact: true }).click();
    await expect(page.locator(".intake-done")).toBeVisible();
    assert.equal(await page.evaluate(() => Object.keys(sessionStorage).some(k => k.endsWith(":member-intake"))), false);
  });
  const coach = await browser.newContext(); await login(coach, "coach@example.test");
  const slot = await coach.request.post(base + "/api/v1/bookings/slots", { headers: { origin: base }, data: { title: "Synthetic audit session", localStart: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 16), timezone: "UTC", durationMinutes: 45, capacity: 3, priceMinor: 0, location: "Test studio", recurrence: { count: 1, intervalWeeks: 1 } } });
  assert.ok(slot.ok(), "Synthetic booking slot: " + slot.status()); await coach.close();
  let failBookings = true;
  await page.route("**/api/v1/bookings", route => failBookings ? unavailable(route) : route.fallback());
  await check("bookings initial failure has a retry", async () => {
    await go("/app/bookings"); await expect(page.locator(".member-shell [role=alert]")).toContainText("Sessions could not be refreshed");
    failBookings = false; await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.getByText("Synthetic audit session", { exact: true })).toBeVisible();
  });
  await check("saved reservation is not reported failed when refresh fails", async () => {
    await page.route("**/api/v1/bookings/slots/*/reserve", async route => { const response = await route.fetch(); assert.ok(response.ok()); failBookings = true; await route.fulfill({ response }); });
    await page.getByRole("button", { name: "Reserve a place", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Book my place", exact: true }).click();
    await expect(page.getByText("Your session details are saved.", { exact: true })).toBeVisible();
    await expect(page.locator(".member-shell [role=alert]")).toContainText("Sessions could not be refreshed");
    await expect(page.getByRole("button", { name: "Reserve a place", exact: true })).toBeDisabled();
    failBookings = false; await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.locator(".member-shell [role=alert]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Cancel my place", exact: true })).toBeVisible();
  });
  await check("account security is grouped and provider results stay visible", async () => {
    await go("/app/profile?linked=google");
    await expect(page.locator("#security")).toHaveAttribute("open", "");
    await expect(page.locator("#security")).toContainText("Google");
    await expect(page.locator("#security [role=status]").filter({ hasText: "Google" })).toBeVisible();
    await expect(page.locator("#acct-password")).toBeVisible();
    await page.screenshot({ path: folder + "/security.png", fullPage: true });
  });
  await check("sign-out removes all subscriber drafts", async () => {
    await go("/app/chat"); await page.getByLabel("Your message", { exact: true }).fill("Synthetic private draft");
    await go("/app/more"); await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page.locator(".member-shell")).toHaveCount(0);
    assert.equal(await page.evaluate(() => Object.keys(sessionStorage).some(k => k.startsWith("trainer-workspace-draft:"))), false);
    await login(context); await go("/app/chat");
    await expect(page.getByLabel("Your message", { exact: true })).toHaveValue("");
  });
  assert.deepEqual(report.errors, []);
} finally {
  await writeFile(folder + "/report.json", JSON.stringify(report, null, 2));
  await browser.close();
}
