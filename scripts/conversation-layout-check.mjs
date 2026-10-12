// The full spacing runner and this targeted check use only synthetic loopback accounts.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
const base = process.env.TEST_APP_URL;
if (
  !base ||
  !["localhost", "127.0.0.1"].includes(new URL(base).hostname) ||
  !process.env.DEMO_PASSWORD ||
  process.env.NODE_ENV === "production"
)
  throw Error("Use the isolated UX runner");
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
});
const context = await browser.newContext({
  viewport: { width: 320, height: 844 },
  serviceWorkers: "block",
});
const page = await context.newPage(),
  errors = [],
  checks = [];
page.on("pageerror", (e) => errors.push(e.message));
await mkdir("test-results/conversation-layout", { recursive: true });
try {
  const login = await context.request.post(base + "/api/v1/auth/login", {
    headers: { origin: base },
    data: {
      email: "sam.taylor@example.test",
      password: process.env.DEMO_PASSWORD,
    },
  });
  assert.equal(login.status(), 200);
  const messages = ["subscriber", "trainer", "digital_qualified"].map(
    (author, index) => ({
      id: `synthetic-${index}`,
      created_at: new Date().toISOString(),
      data: {
        author,
        text: "Your next training session is ready. Let’s take it one step at a time.",
      },
    }),
  );
  await page.route("**/api/v1/messages/thread*", (route) =>
    route.fulfill({
      json: { messages, personalReview: false, hasMore: false },
    }),
  );
  for (const theme of ["light", "dark", "system"]) {
    await page.emulateMedia({ colorScheme: theme === "light" ? "light" : "dark" });
    assert.equal(
      (
        await context.request.put(base + "/api/v1/preferences/appearance", {
          headers: { origin: base },
          data: { theme },
        })
      ).status(),
      200,
    );
    for (const lang of ["en", "ar"]) {
      const preferences = await (
        await context.request.get(base + "/api/v1/notifications/preferences")
      ).json();
      assert.equal(
        (
          await context.request.put(
            base + "/api/v1/notifications/preferences",
            {
              headers: { origin: base },
              data: {
                ...preferences,
                data: { ...preferences.data, language: lang },
              },
            },
          )
        ).status(),
        200,
      );
      await page.goto(base + "/app/chat?lang=" + lang);
      await expect(page.locator(".chat-messages > li")).toHaveCount(3);
      await page
        .getByRole("button", { name: /^No thanks$|^لا شكرًا$/ })
        .first()
        .click({ timeout: 2000 })
        .catch(() => {});
      await expect(page.locator("html")).toHaveAttribute(
        "dir",
        lang === "ar" ? "rtl" : "ltr",
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        ),
        false,
      );
      const contrast = await page
        .locator(".chat-message.is-assisted")
        .evaluate((el) => {
          const luma = (value) => {
            const values = value
              .match(/[\d.]+/g)
              .slice(0, 3)
              .map(Number)
              .map((v) => {
                v /= 255;
                return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
              });
            return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
          };
          const style = getComputedStyle(el),
            a = luma(style.color),
            b = luma(style.backgroundColor);
          return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        });
      assert.ok(contrast >= 4.5, `${theme} ${lang}: text contrast ${contrast}`);
      await page.screenshot({
        path: `test-results/conversation-layout/chat-${theme}-${lang}-320.png`,
        fullPage: true,
      });
      checks.push(
        `${theme} ${lang}: 320px, source labels, no overflow, readable reply contrast`,
      );
    }
  }
  assert.deepEqual(errors, []);
  console.log("PASS conversation layout: " + checks.join("; "));
} finally {
  await writeFile(
    "test-results/conversation-layout/report.json",
    JSON.stringify({ checks, errors }, null, 2),
  );
  await browser.close();
}
