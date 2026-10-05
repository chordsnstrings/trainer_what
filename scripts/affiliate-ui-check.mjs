// Affiliate form/layout checks use synthetic responses in the isolated loopback runner.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";

export async function checkAffiliateUI(page, base, folder) {
  assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
  await mkdir(folder, { recursive: true });
  const errors = [], posts = [], measurements = [];
  const onError = error => errors.push(error.message);
  page.on("pageerror", onError);
  let directoryFailure = true, readFailure = false, earningsFailure = true, populated = false;
  const agreement = { id: "agreement-alpha", provider: "Example provider", revision: 1, enabled: true, trainer_share_bps: 2500, disclosure: "A share of eligible provider earnings is paid to this coach.", terms_reference: "Approved agreement reference 2026-10" };
  const data = () => populated ? {
    contracts: [agreement],
    receipts: [{ id: "receipt-alpha", contract_id: agreement.id, period: "2026-10", amount_minor: 12000, trainer_minor: 3000, provider_reference: "Monthly aggregate report 2026-10", evidence_reference: "Verified aggregate evidence 2026-10" }],
    statements: [{ id: "statement-alpha", contract_id: agreement.id, period: "2026-09", amount_minor: 8000, trainer_minor: 2000 }],
  } : { contracts: [], receipts: [], statements: [] };
  const pattern = "**/api/v1/**affiliates**";
  const handler = async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() === "POST") {
      posts.push({ path, body: request.postDataJSON() });
      if (earningsFailure && path.endsWith("/receipts")) {
        earningsFailure = false;
        await route.fulfill({ status: 503, json: { message: "Fixture save unavailable" } });
      } else await route.fulfill({ json: { ok: true } });
    } else if (path === "/api/v1/admin/affiliates") {
      if (directoryFailure) { directoryFailure = false; await route.fulfill({ status: 503, json: { message: "Fixture directory unavailable" } }); }
      else await route.fulfill({ json: { tenants: [{ id: "workspace-alpha", name: "Example coaching" }, { id: "workspace-beta", name: "Second coaching workspace" }] } });
    } else if (readFailure) {
      readFailure = false;
      await route.fulfill({ status: 503, json: { message: "Fixture refresh unavailable" } });
    } else await route.fulfill({ json: path.includes("workspace-beta") ? { contracts: [], receipts: [], statements: [] } : data() });
  };
  const ready = async () => {
    await expect(page.locator(".affiliate-page")).toHaveAttribute("aria-busy", "false");
    await expect(page.getByRole("heading", { name: "Agreements and disclosure" })).toBeVisible();
  };
  const section = name => page.locator(".affiliate-page > section").filter({ has: page.getByRole("heading", { name, exact: true }) });
  const alert = page.locator(".affiliate-page").getByRole("alert");
  async function layout(width, name, rtl = false) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(rtl => { document.documentElement.dir = rtl ? "rtl" : "ltr"; }, rtl);
    await page.evaluate(() => window.scrollTo(0, 0));
    const result = await page.locator(".affiliate-page").evaluate(root => {
      const overlaps = [];
      for (const group of root.querySelectorAll(".af-form")) {
        const rects = [...group.querySelectorAll(":scope > label, :scope > .af-actions")].filter(el => el.getClientRects().length).map(el => ({ name: el.textContent.trim().slice(0, 45), r: el.getBoundingClientRect() }));
        for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i].r, b = rects[j].r;
          if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) overlaps.push([rects[i].name, rects[j].name]);
        }
      }
      const textarea = root.querySelector("textarea"), label = textarea.closest("label");
      return { width: innerWidth, rtl: document.documentElement.dir, overflow: document.documentElement.scrollWidth > innerWidth + 1, overlaps, textareaWidth: textarea.getBoundingClientRect().width, labelWidth: label.getBoundingClientRect().width, textareaHeight: textarea.getBoundingClientRect().height, formBorder: getComputedStyle(textarea.closest("fieldset")).borderTopWidth, checkLabels: [...root.querySelectorAll('input[type="checkbox"]')].map(el => getComputedStyle(el.closest("label")).display) };
    });
    assert.equal(result.overflow, false, name + " page overflow");
    assert.deepEqual(result.overlaps, [], name + " overlapping fields/actions");
    assert.ok(Math.abs(result.textareaWidth - result.labelWidth) < 2, name + " full-width disclosure");
    assert.ok(result.textareaHeight >= 112);
    assert.equal(result.formBorder, "0px");
    assert.deepEqual(result.checkLabels, ["flex", "flex"]);
    measurements.push(result);
    await page.screenshot({ path: `${folder}/${name}.png`, fullPage: false });
  }
  await page.route(pattern, handler);
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(base + "/admin/affiliates");
    await expect(page.locator(".affiliate-page")).toBeVisible({ timeout: 45_000 });
    await expect(alert).toContainText("Fixture directory unavailable");
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await ready();
    await layout(1920, "empty-desktop");
    await expect(page.getByText("No provider earnings recorded yet.")).toBeVisible();
    await page.getByLabel("Provider", { exact: true }).fill("Retained agreement draft");
    populated = true;
    readFailure = true;
    await page.getByRole("button", { name: "Refresh earnings", exact: true }).click();
    await expect(alert).toContainText("Fixture refresh unavailable");
    await expect(page.getByLabel("Provider", { exact: true })).toHaveValue("Retained agreement draft");
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await ready();
    await expect(alert).toHaveCount(0);
    await expect(page.getByLabel("Provider", { exact: true })).toHaveValue("Retained agreement draft");
    await page.getByRole("button", { name: "Edit agreement", exact: true }).click();
    await expect(page.getByLabel("Approved agreement reference")).toBeFocused();
    await page.getByLabel("Trainer share (%)").fill("32.5");
    await page.getByLabel("Reason", { exact: true }).fill("Updated approved revenue split");
    await page.getByLabel("Provider permission, disclosure and the earnings split are approved").check();
    await page.getByRole("button", { name: "Save agreement", exact: true }).click();
    await ready();
    assert.equal(posts.at(-1).body.trainerShareBps, 3250);
    assert.equal(posts.at(-1).body.providerPermissionConfirmed, true);
    await expect(page.getByLabel("Provider", { exact: true })).toHaveValue("");
    const earnings = section("Record provider earnings");
    await earnings.getByLabel("Provider statement reference").fill("aggregate-fixture-2026-10");
    await earnings.getByLabel("Reporting month").fill("2026-10");
    await earnings.getByLabel("Confirmed earnings (AED)").fill("123.45");
    await earnings.getByLabel("Evidence reference").fill("Verified synthetic report reference");
    await earnings.getByRole("button", { name: "Record earnings", exact: true }).click();
    await expect(alert).toContainText("Fixture save unavailable");
    await expect(earnings.getByLabel("Confirmed earnings (AED)")).toHaveValue("123.45");
    await earnings.getByRole("button", { name: "Record earnings", exact: true }).click();
    await ready();
    assert.equal(posts.at(-1).body.amountMinor, 12345);
    assert.ok(posts.at(-1).path.includes("workspace-alpha"));
    await expect(earnings.getByLabel("Confirmed earnings (AED)")).toHaveValue("");
    await page.locator(".af-record > summary").first().click();
    await page.locator(".af-record > summary").last().click();
    for (const width of [1920, 1440, 768, 390]) {
      await layout(width, `populated-${width}`);
      if (width === 1440) {
        await section("Add agreement").screenshot({ path: `${folder}/agreement-form.png` });
        await section("Statements and bank evidence").screenshot({ path: `${folder}/bank-evidence.png` });
      }
    }
    await layout(390, "populated-390-rtl", true);
    await page.evaluate(() => { document.documentElement.dir = "ltr"; });
    await page.locator(".affiliate-page").getByRole("combobox", { name: /^Workspace/ }).selectOption("workspace-beta");
    await ready();
    await expect(page.getByRole("button", { name: "Edit agreement", exact: true })).toHaveCount(0);
    await expect(page.getByText("No provider earnings recorded yet.")).toBeVisible();
    assert.deepEqual(errors, []);
    await writeFile(`${folder}/report.json`, JSON.stringify({ measurements, posts, errors }, null, 2));
    console.log("PASS affiliate UI: recovery, retained drafts, agreement/earnings submissions, workspace switch, six layout captures, no overlaps or overflow");
  } catch (error) {
    await page.screenshot({ path: `${folder}/failure.png`, fullPage: true }).catch(() => {});
    throw error;
  } finally {
    await page.unroute(pattern, handler);
    page.off("pageerror", onError);
  }
}

if (process.env.RTL_CHECK_MODULE === "./affiliate-ui-check.mjs") {
  const base = process.env.TEST_APP_URL;
  if (!base || !["localhost", "127.0.0.1"].includes(new URL(base).hostname) || process.env.NODE_ENV === "production") throw new Error("Use the isolated fixture runner");
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  const page = await browser.newPage();
  try {
    await page.goto(base + "/login");
    const decline = page.getByRole("button", { name: "No thanks", exact: true });
    if (await decline.isVisible()) await decline.click();
    await page.getByLabel("Email address").fill("coach@example.test");
    await page.getByLabel("Password", { exact: true }).fill(process.env.DEMO_PASSWORD ?? "TrainerDemo2026!");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(/\/(trainer|admin\/settings)$/);
    if (await decline.isVisible()) await decline.click();
    await checkAffiliateUI(page, base, "test-results/affiliate-ui");
  } finally { await browser.close(); }
}
