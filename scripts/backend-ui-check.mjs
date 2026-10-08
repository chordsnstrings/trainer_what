// Isolated synthetic fixture only. Run with scripts/run-rtl-check.mjs.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { checkAffiliateUI } from "./affiliate-ui-check.mjs";
const base = process.env.TEST_APP_URL;
if (!base || !["localhost", "127.0.0.1"].includes(new URL(base).hostname) || process.env.NODE_ENV === "production") throw new Error("Use the isolated loopback fixture runner");
const folder = process.env.BACKEND_UI_QUICK ? "test-results/backend-ui-final" : "test-results/backend-ui";
await mkdir(folder, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const report = { startedAt: new Date().toISOString(), checks: [], captures: [], errors: [], httpErrors: [] };
page.on("pageerror", error => report.errors.push(error.message));
let nextRequest = 0, expectedFailure = false;
await page.route("**/api/v1/**", async route => {
  const delay = Math.max(0, nextRequest - Date.now()); nextRequest = Date.now() + delay + 600;
  if (delay) await new Promise(resolve => setTimeout(resolve, delay));
  await route.continue();
});
page.on("response", response => { if (response.url().includes("/api/v1/") && response.status() >= 400 && !(expectedFailure && new URL(response.url()).pathname === "/api/v1/setup/about" && [409, 503].includes(response.status()))) report.httpErrors.push({ url: new URL(response.url()).pathname, status: response.status() }); });
async function settled() {
  await expect(page.locator(".workspace.platform-ui")).toBeVisible({ timeout: 45000 });
  await expect(page.locator(".workspace-loading")).toHaveCount(0, { timeout: 45000 });
  await page.waitForLoadState("networkidle");
}
async function go(path) { await page.goto(base + path); await settled(); }
async function capture(name) {
  await page.screenshot({ path: `${folder}/${name}.png`, fullPage: true });
  const metrics = await page.evaluate(() => {
    const root = document.querySelector(".workspace.platform-ui"), sidebar = root.querySelector(".sidebar"), nav = sidebar.querySelector("nav");
    const controls = [...root.querySelectorAll("input:not([type=hidden]),select,textarea")].filter(el => el.getClientRects().length && !el.closest(".sbe,.setup-real-preview,.trainer-theme"));
    return { path: location.pathname + location.search, width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth + 1, background: getComputedStyle(root).backgroundColor, sidebarOverflow: getComputedStyle(sidebar).overflowY, navOverflow: getComputedStyle(nav).overflowY,
      unlabelled: controls.filter(el => !el.labels?.length && !el.getAttribute("aria-label") && !el.getAttribute("aria-labelledby") && !el.getAttribute("title")).map(el => ({ tag: el.tagName, name: el.name, placeholder: el.placeholder })) };
  });
  report.captures.push({ name, ...metrics });
  assert.equal(metrics.overflow, false, `${name}: horizontal overflow`);
  assert.equal(metrics.background, "rgb(255, 255, 255)", `${name}: white backend`);
  assert.equal(metrics.sidebarOverflow, "hidden", `${name}: one navigation scroll area`);
  assert.deepEqual(metrics.unlabelled, [], `${name}: every field has an accessible name`);
}
async function check(name, fn) { await fn(); report.checks.push(name); console.log(`PASS ${name}`); }
try {
  await page.goto(base + "/login");
  const declineAnalytics = page.getByRole("button", { name: "No thanks", exact: true });
  if (await declineAnalytics.isVisible()) await declineAnalytics.click();
  await page.getByLabel("Email address").fill("coach@example.test");
  await page.getByLabel("Password", { exact: true }).fill("TrainerDemo2026!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/(trainer|admin\/settings)$/); await settled();
  if (await declineAnalytics.isVisible()) await declineAnalytics.click();
  await check("immediate onboarding exit saves the latest answer", async () => {
    await go("/setup/about");
    const conversationOptions = page.getByRole("button", { name: "Conversation options", exact: true });
    if (await conversationOptions.isVisible()) await conversationOptions.click();
    const forms = page.getByRole("button", { name: "Use setup forms", exact: true });
    if (await forms.count()) await forms.last().click();
    await page.getByLabel("Your name, as clients will see it", { exact: true }).fill("Alex Save Before Exit");
    await page.getByRole("link", { name: "Save and continue later" }).click();
    await page.waitForURL("**/trainer"); await settled();
    await go("/setup/about");
    await expect(page.getByLabel("Your name, as clients will see it", { exact: true })).toHaveValue("Alex Save Before Exit");
  });
  await check("edits during an in-flight save are drained before Continue", async () => {
    await page.route("**/api/v1/setup/about", async route => { if (route.request().method() === "PUT") await new Promise(resolve => setTimeout(resolve, 700)); await route.fallback(); });
    const started = page.waitForRequest(r => r.url().endsWith("/setup/about") && r.method() === "PUT");
    await page.getByLabel("Your name, as clients will see it", { exact: true }).fill("Alex First Save"); await started;
    await page.getByLabel("Your name, as clients will see it", { exact: true }).fill("Alex Latest Save");
    await page.getByRole("link", { name: "Continue", exact: true }).click();
    await page.waitForURL("**/setup/page"); await settled();
    await page.unroute("**/api/v1/setup/about"); await go("/setup/about");
    await expect(page.getByLabel("Your name, as clients will see it", { exact: true })).toHaveValue("Alex Latest Save");
  });
  await check("failed saves block navigation and recover on retry", async () => {
    expectedFailure = true;
    await page.route("**/api/v1/setup/about", async route => route.request().method() === "PUT" ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Temporary fixture failure" }) }) : route.fallback());
    await page.getByLabel("Your name, as clients will see it", { exact: true }).fill("Alex Recovered Save");
    await page.getByRole("link", { name: "Save and continue later" }).click();
    await expect(page.getByRole("button", { name: "Retry saving", exact: true })).toBeVisible();
    assert.equal(new URL(page.url()).pathname, "/setup/about");
    await page.unroute("**/api/v1/setup/about"); expectedFailure = false;
    await page.getByRole("button", { name: "Retry saving", exact: true }).click();
    await expect(page.getByText("Saved. You can continue on another device.", { exact: true })).toBeVisible();
    await page.reload(); await settled();
    await expect(page.getByLabel("Your name, as clients will see it", { exact: true })).toHaveValue("Alex Recovered Save");
  });
  await check("stale onboarding drafts recover without overwriting another window", async () => {
    await go("/setup/about");
    const status = await page.evaluate(async () => {
      const setup = await (await fetch("/api/v1/setup")).json();
      const values = Object.fromEntries(Object.entries(setup.about.values).filter(([, value]) => value != null));
      const response = await fetch("/api/v1/setup/about", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: setup.about.version, values: { ...values, name: "Alex Other Window" } }) });
      return response.status;
    });
    assert.equal(status, 200); expectedFailure = true;
    await page.getByLabel("Your name, as clients will see it", { exact: true }).fill("Unsent local answer");
    await page.getByRole("link", { name: "Save and continue later" }).click();
    await page.getByRole("button", { name: "Load saved answers", exact: true }).click();
    await page.getByRole("dialog", { name: "Load saved answers?" }).getByRole("button", { name: "Load saved answers", exact: true }).click();
    await expect(page.getByLabel("Your name, as clients will see it", { exact: true })).toHaveValue("Alex Other Window");
    expectedFailure = false;
  });
  await check("client search and return context survive client navigation", async () => {
    await go("/trainer/subscribers"); await page.getByRole("textbox", { name: "Search clients" }).fill("Sam");
    await expect(page.locator(".table-wrap tbody a").first()).toBeVisible(); await page.waitForLoadState("networkidle");
    await page.locator(".table-wrap tbody a").first().click(); await page.waitForURL(url => /^\/trainer\/subscribers\/[^/]+$/.test(url.pathname)); await settled();
    await page.getByRole("textbox", { name: "Your message", exact: true }).fill("A recoverable coaching reply");
    await page.getByRole("link", { name: "All clients" }).click(); await page.waitForURL(url => url.pathname === "/trainer/subscribers"); await settled();
    await expect(page.getByRole("textbox", { name: "Search clients" })).toHaveValue("Sam");
    await page.locator(".table-wrap tbody a").first().click();
    await page.waitForURL(url => /^\/trainer\/subscribers\/[^/]+$/.test(url.pathname)); await settled();
    await expect(page.getByRole("textbox", { name: "Your message", exact: true })).toHaveValue("A recoverable coaching reply");
  });
  await check("settings tabs support keyboard and privacy deep links", async () => {
    await go("/trainer/settings#privacy");
    await expect(page.getByRole("tab", { name: "Privacy", exact: true })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("tab", { name: "Privacy", exact: true }).focus(); await page.keyboard.press("Home");
    await expect(page.getByRole("tab", { name: "Profile", exact: true })).toHaveAttribute("aria-selected", "true");
  });
  await check("admin navigation excludes coaching tasks and API keys have labels", async () => {
    await go("/admin/model-profiles");
    await expect(page.locator(".content h1")).toHaveText("AI model profiles");
    assert.equal(await page.locator('.sidebar a[href="/trainer/subscribers"]').count(), 0);
    for (const input of await page.locator('input[type="password"]').all()) await expect(input).toHaveAccessibleName(/API key/);
  });
  await check("setup opens the real website preview and returns from the desktop builder", async () => {
    await go("/setup/page");
    await expect(page.locator(".setup-real-preview")).toBeVisible();
    await page.getByRole("link", { name: "Open website builder", exact: true }).click();
    await page.waitForURL("**/trainer/website?from=setup");
    await expect(page.getByTestId("site-builder-editor")).toBeVisible({ timeout: 45000 });
    await page.getByRole("link", { name: "Back to setup", exact: true }).click();
    await page.waitForURL("**/setup/page"); await settled();
  });
  await check("unsaved admin settings require a keyboard-accessible discard decision", async () => {
    await go("/admin/model-profiles");
    await page.getByRole("button", { name: "Edit", exact: true }).first().click();
    const name = page.locator(".model-profiles > article").first().getByLabel("Name (Super admin only)", { exact: true });
    await name.fill("Unsaved fixture edit");
    await page.getByRole("link", { name: "Return to settings & connections" }).click();
    const dialog = page.getByRole("dialog", { name: "Discard changes?" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible(); await expect(name).toHaveValue("Unsaved fixture edit");
    await page.getByRole("link", { name: "Return to settings & connections" }).click();
    await dialog.getByRole("button", { name: "Discard and leave" }).click();
    await page.waitForURL("**/admin/settings"); await settled();
  });
  await check("the inbox and its navigation badge share one request", async () => {
    let requests = 0;
    const count = request => { if (new URL(request.url()).pathname === "/api/v1/trainer/inbox") requests++; };
    page.on("request", count); await go("/trainer"); page.off("request", count);
    assert.equal(requests, 1);
  });
  const routes = ["/trainer", "/trainer/subscribers", "/trainer/subscribers?view=invitations", "/trainer/subscribers?view=access", "/trainer/messages", "/trainer/brain", "/trainer/programs", "/trainer/nutrition", "/trainer/bookings", "/trainer/support", "/trainer/finance", "/trainer/finance?view=offers", "/trainer/finance?view=payouts", "/trainer/settings", "/trainer/settings?tab=security", "/trainer/settings?tab=notifications", "/trainer/settings?tab=workspace", "/trainer/team", "/trainer/integrations", "/trainer/design", "/trainer/galleries", "/trainer/domains", "/trainer/website/settings", "/setup/about", "/setup/page", "/setup/plan", "/admin/settings", "/admin/model-profiles", "/admin/platform-finance", "/admin/metrics", "/admin/alerts", "/admin/governance", "/admin/trainers", "/admin/support", "/admin/infrastructure/host"];
  const selectedRoutes = process.env.BACKEND_UI_QUICK ? ["/trainer", "/trainer/subscribers", "/trainer/settings", "/trainer/settings?tab=security", "/trainer/design", "/admin/model-profiles"] : routes;
  for (let i = 0; i < selectedRoutes.length; i++) { await go(selectedRoutes[i]); await capture(`desktop-${String(i).padStart(2, "0")}`); }
  for (const width of [390, 1100, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const path of ["/trainer", "/trainer/subscribers", "/trainer/settings", "/setup/about", "/admin/model-profiles"]) { await go(path); await capture(`${width}-${path.replaceAll("/", "-")}`); }
  }
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await go("/trainer"); await capture("dark-os-white-workspace");
  await page.evaluate(() => { document.documentElement.dir = "rtl"; }); await capture("rtl-workspace");
  await check("mobile menu closes with Escape and returns focus", async () => {
    await page.evaluate(() => { document.documentElement.dir = "ltr"; });
    await page.setViewportSize({ width: 390, height: 844 }); await go("/admin/model-profiles");
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(page.locator(".sidebar")).toHaveClass(/is-open/); await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Open navigation" })).toBeFocused();
  });
  await check("the website editor remains desktop only", async () => {
    await go("/trainer/website");
    await expect(page.getByTestId("site-builder-desktop-required")).toBeVisible();
    await expect(page.getByTestId("site-builder-editor")).toHaveCount(0);
  });
  await check("affiliate forms stay aligned and recover without losing drafts", async () => {
    const affiliatePage = await context.newPage();
    try { await checkAffiliateUI(affiliatePage, base, `${folder}/affiliates`); }
    finally { await affiliatePage.close(); }
  });
  await check("sign-out clears recoverable drafts from this tab", async () => {
    await go("/trainer");
    const drafts = () => page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith("trainer-workspace-draft:")));
    assert.ok((await drafts()).length > 0);
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page.locator(".sidebar-bottom").getByRole("button", { name: "Sign out", exact: true }).click();
    await page.waitForURL("**/login");
    assert.deepEqual(await drafts(), []);
  });
  assert.deepEqual(report.errors, []); assert.deepEqual(report.httpErrors, []);
} finally {
  if (report.captures.length < 52) await page.screenshot({ path: `${folder}/last-state.png`, fullPage: true }).catch(() => {});
  report.finishedAt = new Date().toISOString();
  await writeFile(`${folder}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
