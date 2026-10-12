// Isolated fixture audit: shared spacing, both chat perspectives and photo review.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
const base = process.env.TEST_APP_URL;
if (
  !base ||
  !["localhost", "127.0.0.1"].includes(new URL(base).hostname) ||
  process.env.NODE_ENV === "production" ||
  !process.env.DEMO_PASSWORD
)
  throw Error("Use the isolated UX runner");
const folder = "test-results/ux-spacing";
await mkdir(folder, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
});
const report = { checks: [], screens: [], errors: [] };
async function session(email) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: "block",
  });
  const login = await context.request.post(base + "/api/v1/auth/login", {
    headers: { origin: base },
    data: { email, password: process.env.DEMO_PASSWORD },
  });
  assert.equal(login.status(), 200);
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  let next = 0;
  await page.route("**/api/v1/**", async (route) => {
    const delay = Math.max(0, next - Date.now());
    next = Date.now() + delay + 650;
    if (delay) await new Promise((r) => setTimeout(r, delay));
    await route.continue().catch(() => {});
  });
  return { context, page };
}
async function visit(page, path) {
  await page.goto(base + path);
  await expect(page.locator(".workspace")).toBeVisible();
  await page
    .waitForLoadState("networkidle", { timeout: 15000 })
    .catch(() => {});
  await page
    .getByRole("button", { name: "No thanks", exact: true })
    .waitFor({ state: "visible", timeout: 2000 })
    .catch(() => {});
  for (const name of [/without analytics/i, /^No thanks$/i]) {
    const button = page.getByRole("button", { name });
    if (await button.count()) await button.first().click();
  }
}
async function capture(page, key, screenshot = false) {
  const m = await page.evaluate(() => ({
    width: innerWidth,
    overflow: document.documentElement.scrollWidth - innerWidth,
    clipped: [
      ...document.querySelectorAll(
        ".content input:not([type=checkbox]):not([type=radio]),.content textarea,.content select,.tabs > a",
      ),
    ]
      .filter(
        (el) =>
          el.getClientRects().length &&
          !el.closest(".sbe,.sb-site,.trainer-theme,.setup-real-preview"),
      )
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.left < -1 || r.right > innerWidth + 1;
      })
      .map(
        (el) =>
          el.tagName +
          ":" +
          (el.getAttribute("name") || el.getAttribute("aria-label") || ""),
      ),
  }));
  report.screens.push({ key, ...m });
  if (m.overflow > 1 || m.clipped.length) {
    await page.screenshot({
      path: `${folder}/failure-${key}.png`,
      fullPage: true,
    });
    const layout = await page.evaluate(() =>
      [...document.querySelectorAll("body *")]
        .filter(
          (el) =>
            el.getClientRects().length &&
            getComputedStyle(el).position !== "fixed",
        )
        .map((el) => ({
          tag: el.tagName,
          className: el.className,
          width: el.getBoundingClientRect().width,
          right: el.getBoundingClientRect().right,
        }))
        .filter((el) => el.right > innerWidth + 2)
        .slice(-30),
    );
    await writeFile(
      `${folder}/failure-layout.json`,
      JSON.stringify(layout, null, 2),
    );
  }
  assert.ok(m.overflow <= 1, `${key}: overflow ${m.overflow}`);
  assert.deepEqual(m.clipped, [], key + ": clipped controls");
  if (screenshot)
    await page.screenshot({ path: `${folder}/${key}.png`, fullPage: true });
}
try {
  const trainer = await session("coach@example.test");
  const routes = [
    "/trainer",
    "/trainer/subscribers",
    "/trainer/messages",
    "/trainer/programs",
    "/trainer/nutrition",
    "/trainer/bookings",
    "/trainer/finance",
    "/trainer/analytics",
    "/trainer/settings",
    "/trainer/settings?tab=security",
    "/trainer/settings?tab=notifications",
    "/trainer/team",
    "/trainer/integrations",
    "/trainer/voice",
    "/trainer/domains",
    "/trainer/design",
    "/trainer/galleries",
    "/trainer/website/settings",
  ];
  for (const width of [360, 768, 1440]) {
    await trainer.page.setViewportSize({
      width,
      height: width === 360 ? 844 : 1000,
    });
    for (const path of process.env.UX_AUDIT_ROUTES
      ? process.env.UX_AUDIT_ROUTES.split(",")
      : routes) {
      await visit(trainer.page, path);
      const key = `trainer-${width}-${path.replace(/^\/trainer\/?/, "home-").replace(/[^a-z0-9-]/gi, "-")}`;
      await capture(
        trainer.page,
        key,
        [
          "/trainer/domains",
          "/trainer/analytics",
          "/trainer/messages",
          "/trainer/galleries",
        ].includes(path),
      );
      if (path === "/trainer/domains") {
        const tabs = await trainer.page
          .locator(".tabs > a")
          .evaluateAll((nodes) =>
            nodes.map((node) => ({
              height: node.getBoundingClientRect().height,
              padding: parseFloat(getComputedStyle(node).paddingInlineStart),
            })),
          );
        assert.ok(tabs.every((tab) => tab.height >= 44 && tab.padding >= 12));
        const form = trainer.page.locator(".domain-connect-form");
        await expect(form).toBeVisible();
        assert.ok(
          await form.evaluate(
            (el) => parseFloat(getComputedStyle(el).rowGap) >= 16,
          ),
        );
      }
      if (path === "/trainer/analytics") {
        await expect(
          trainer.page.locator(".retention-metrics > div"),
        ).toHaveCount(5);
      }
      if (path === "/trainer/voice") {
        assert.doesNotMatch(
          await trainer.page.locator(".content").innerText(),
          /Cartesia|ElevenLabs/,
        );
      }
    }
  }
  report.checks.push(
    "18 trainer sections at 360, 768 and 1440px: page width, controls, settings tabs, domain spacing and grouped retention metrics",
  );
  const member = await session("sam.taylor@example.test");
  let messages = Array.from({ length: 70 }, (_, index) => ({
    id: `synthetic-${index}`,
    created_at: new Date(Date.now() - (70 - index) * 60000).toISOString(),
    data: {
      author:
        index % 3 === 0
          ? "subscriber"
          : index % 3 === 1
            ? "trainer"
            : "digital_qualified",
      text: `Synthetic check-in ${index}. Let’s keep today’s session focused and comfortable.`,
      attachments: [],
    },
  }));
  await member.page.route("**/api/v1/messages/thread*", (route) =>
    route.fulfill({
      json: { messages, hasMore: false, personalReview: false },
    }),
  );
  for (const width of [360, 768, 1440]) {
    await member.page.setViewportSize({ width, height: 900 });
    for (const path of [
      "/app",
      "/app/program",
      "/app/nutrition",
      "/app/chat",
      "/app/more",
      "/app/settings",
    ]) {
      await visit(member.page, path);
      await capture(
        member.page,
        `member-${width}-${path.replace(/[^a-z0-9]/gi, "-")}`,
        path === "/app/chat",
      );
    }
  }
  await visit(member.page, "/app/chat");
  await expect(member.page.locator(".chat-messages > li")).toHaveCount(70);
  assert.notEqual(
    await member.page
      .locator(".chat-message.is-personal")
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor),
    await member.page
      .locator(".chat-message.is-assisted")
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor),
  );
  await member.page.locator(".conversation-scroll").evaluate((el) => {
    el.scrollTop = 200;
    el.dispatchEvent(new Event("scroll"));
  });
  const top = await member.page
    .locator(".conversation-scroll")
    .evaluate((el) => el.scrollTop);
  messages = [
    ...messages,
    {
      id: "synthetic-new",
      created_at: new Date().toISOString(),
      data: {
        author: "trainer",
        text: "A new personal reply while you are reading earlier messages.",
      },
    },
  ];
  await expect(member.page.locator(".conversation-latest")).toBeVisible({
    timeout: 15000,
  });
  assert.ok(
    Math.abs(
      (await member.page
        .locator(".conversation-scroll")
        .evaluate((el) => el.scrollTop)) - top,
    ) < 2,
  );
  await member.page
    .getByRole("button", { name: "Latest messages", exact: true })
    .click();
  await expect
    .poll(() =>
      member.page
        .locator(".conversation-scroll")
        .evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop),
    )
    .toBeLessThan(3);
  report.checks.push(
    "Member sections at three widths; source labels and colours; incoming replies preserve reading position and Latest messages returns to the end",
  );
  await member.context.close();
  await trainer.context.close();
  assert.deepEqual(report.errors, []);
  console.log(
    `PASS UX audit: ${report.screens.length} screens; ${report.checks.length} grouped checks`,
  );
} finally {
  await writeFile(folder + "/report.json", JSON.stringify(report, null, 2));
  await browser.close();
}
