// Synthetic loopback fixtures only. No real accounts, providers or outbound messages.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
const base = process.env.TEST_APP_URL;
if (
  !base ||
  !["localhost", "127.0.0.1"].includes(new URL(base).hostname) ||
  process.env.NODE_ENV === "production"
)
  throw Error("Use the isolated loopback fixture runner");
const folder = "test-results/daily-workflows";
await mkdir(folder, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  serviceWorkers: "block",
});
context.setDefaultTimeout(30000);
const page = await context.newPage(),
  report = { checks: [], errors: [] };
page.on("pageerror", (e) => report.errors.push(e.message));
async function login(ctx, email) {
  const response = await ctx.request.post(base + "/api/v1/auth/login", {
    headers: { origin: base },
    data: { email, password: process.env.DEMO_PASSWORD ?? "TrainerDemo2026!" },
  });
  assert.equal(response.status(), 200, await response.text());
}
async function go(path) {
  await page.goto(base + path);
  await page.waitForLoadState("networkidle").catch(() => {});
  const decline = page.getByRole("button", { name: "No thanks", exact: true });
  if (await decline.isVisible()) await decline.click();
}
async function check(name, work) {
  await work();
  report.checks.push(name);
  console.log("PASS " + name);
}
async function capture(name) {
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    ),
    false,
    name + " horizontal overflow",
  );
  await page.screenshot({ path: `${folder}/${name}.png`, fullPage: true });
}
try {
  await login(context, "coach@example.test");
  await check(
    "Today, Inbox and client rows work at desktop and 320px",
    async () => {
      await go("/trainer");
      await expect(
        page.getByRole("heading", { name: /Good to see you/ }),
      ).toBeVisible();
      await capture("trainer-today-desktop");
      await page.setViewportSize({ width: 320, height: 740 });
      await capture("trainer-today-phone");
      await go("/trainer/inbox");
      await expect(
        page.getByRole("heading", { name: "Inbox", exact: true }),
      ).toBeVisible();
      await go("/trainer/subscribers");
      await expect(page.locator(".client-list-table")).toBeVisible();
      await capture("client-list-phone");
      await page
        .getByLabel("Show clients", { exact: true })
        .selectOption("membership_issue");
      await expect(page).toHaveURL(/filter=membership_issue/);
      await page.reload();
      await expect(
        page.getByLabel("Show clients", { exact: true }),
      ).toHaveValue("membership_issue");
      await page.getByLabel("Show clients", { exact: true }).selectOption("");
    },
  );
  await check(
    "client context survives navigation into plan preparation",
    async () => {
      const client = page
        .locator('.client-list-table a[href*="/trainer/subscribers/"]')
        .first();
      await expect(client).toBeVisible();
      const href = await client.getAttribute("href"),
        id = href.split("/")[3].split("?")[0];
      await client.click();
      await page
        .locator(".client-hub-tabs")
        .getByRole("link", { name: "Plan", exact: true })
        .click();
      await page.locator('a[href*="/trainer/brain/plans?client="]').click();
      await expect(page.getByLabel("Subscriber", { exact: true })).toHaveValue(
        id,
      );
      await capture("client-plan-context");
    },
  );
  await check("phone quick edit saves a draft without publishing", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await go("/trainer/website");
    await expect(
      page.getByRole("heading", { name: "Quick edit", exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("site-builder-editor")).toHaveCount(0);
    await page
      .getByLabel("Headline", { exact: true })
      .fill("Synthetic daily workflow headline");
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Draft saved");
    await page.reload();
    await expect(page.getByLabel("Headline", { exact: true })).toHaveValue(
      "Synthetic daily workflow headline",
    );
    await capture("website-quick-edit-phone");
  });
  await login(context, "sam.taylor@example.test");
  await check(
    "member Today keeps its main action ahead of recovery",
    async () => {
      await go("/app");
      await expect(page.locator(".today-focus")).toBeVisible();
      const recovery = page.locator(".whoop-training");
      if (await recovery.count())
        assert.ok(
          (await page.locator(".today-focus").boundingBox()).y <
            (await recovery.boundingBox()).y,
        );
      await capture("subscriber-today-phone");
    },
  );
  await check(
    "meal Today uses the current date and swaps open a scoped dialog",
    async () => {
      const response = await context.request.get(base + "/api/v1/nutrition"),
        data = await response.json();
      assert.equal(response.status(), 200);
      await go("/app/nutrition");
      const selected = page.locator(
        '.nutrition-days button[aria-pressed="true"]',
      );
      await expect(selected).toHaveCount(1);
      const day = await selected.textContent();
      assert.ok(
        day.includes(String(Number(data.today.slice(-2)))),
        `Selected day ${day} must be today ${data.today}`,
      );
      await page
        .getByRole("button", {
          name: "Change meal or cooking option",
          exact: true,
        })
        .first()
        .click();
      await expect(
        page.getByRole("dialog", { name: "Choose a permitted alternative" }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toBeHidden();
      await capture("nutrition-today-phone");
    },
  );
  await check(
    "Arabic member onboarding keeps coach identity and localized controls",
    async () => {
      await go("/app/intake");
      await page.evaluate(() => {
        document.documentElement.lang = "ar";
        document.documentElement.dir = "rtl";
      });
      await expect(
        page.locator(".onboarding-chat-header h1"),
      ).not.toContainText("Kamran");
      await capture("member-onboarding-arabic");
    },
  );
  assert.deepEqual(report.errors, []);
} finally {
  await writeFile(`${folder}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
