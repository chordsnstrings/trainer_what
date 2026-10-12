// Explicit loopback UI double. API isolation and provider accounting run in trainer-photo-studio.test.ts.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { chromium, expect } from "@playwright/test";
const base = process.env.TEST_APP_URL;
if (
  !base ||
  !["localhost", "127.0.0.1"].includes(new URL(base).hostname) ||
  process.env.NODE_ENV === "production" ||
  !process.env.DEMO_PASSWORD
)
  throw Error("Use the isolated UX runner");
const folder = "test-results/photo-studio-ui";
await mkdir(folder, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  serviceWorkers: "block",
});
const page = await context.newPage();
page.setDefaultTimeout(30000);
const errors = [],
  checks = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  assert.equal(
    (
      await context.request.post(base + "/api/v1/auth/login", {
        headers: { origin: base },
        data: {
          email: "coach@example.test",
          password: process.env.DEMO_PASSWORD,
        },
      })
    ).status(),
    200,
  );
  const bytes = await sharp({
    create: { width: 600, height: 800, channels: 3, background: "#c8d3bf" },
  })
    .jpeg()
    .toBuffer();
  const upload = await context.request.post(base + "/api/v1/tenant/media", {
    headers: { origin: base },
    data: {
      filename: "Synthetic reference.jpg",
      data: bytes.toString("base64"),
      rightsConfirmed: true,
    },
  });
  assert.equal(upload.status(), 200);
  const photo = await upload.json();
  let jobs = [],
    requests = [],
    held,
    entered,
    release;
  await page.route("**/api/v1/tenant/photo-studio**", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    if (request.method() === "GET")
      return route.fulfill({
        json: { available: true, styles: [], items: jobs },
      });
    if (path.endsWith("/keep")) {
      const body = request.postDataJSON();
      assert.equal(body.likenessConfirmed, true);
      const result = { ...jobs[0], status: "kept", photo };
      jobs = [result];
      return route.fulfill({ json: result });
    }
    const body = request.postDataJSON();
    requests.push(body);
    entered?.();
    await held;
    jobs = [
      {
        id: randomUUID(),
        requestId: body.requestId,
        referenceIds: body.referenceIds,
        style: body.style,
        status: "ready",
        url: photo.url,
      },
    ];
    return route.fulfill({ json: jobs[0] });
  });
  await page.goto(base + "/trainer/galleries");
  await expect(page.locator(".photo-studio")).toBeVisible();
  const consentBanner = page.getByRole("button", {
    name: "No thanks",
    exact: true,
  });
  if (await consentBanner.count()) await consentBanner.click();
  await expect(
    page.getByRole("button", { name: "Create photo draft", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Use Synthetic reference.jpg as a reference" })
    .click();
  await page.getByRole("radio", { name: /Website cover/ }).check();
  await page
    .getByLabel("These are photos of me as an adult.", { exact: false })
    .check();
  await page.locator(".photo-studio textarea").fill("Warm neutral studio");
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.locator(".photo-studio").scrollIntoViewIfNeeded();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
    await page
      .locator(".photo-studio")
      .screenshot({ path: `${folder}/create-${width}.png` });
  }
  held = new Promise((r) => (release = r));
  const started = new Promise((r) => (entered = r));
  await page
    .getByRole("button", { name: "Create photo draft", exact: true })
    .click();
  await started;
  await expect(
    page.getByRole("button", { name: "Preparing your photo…", exact: true }),
  ).toBeDisabled();
  release();
  await expect(
    page.getByRole("button", { name: "Keep in photo library", exact: true }),
  ).toBeVisible();
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].referenceIds, [photo.id]);
  assert.equal(requests[0].consent, true);
  assert.equal(requests[0].style, "website");
  assert.ok(requests[0].requestId);
  await expect(
    page.getByRole("button", { name: "Keep in photo library", exact: true }),
  ).toBeDisabled();
  for (const width of [360, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page
      .locator(".photo-studio-drafts")
      .screenshot({ path: `${folder}/review-${width}.png` });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
  }
  await page
    .getByLabel("I checked the face, hands and body.", { exact: false })
    .check();
  await page
    .getByRole("button", { name: "Keep in photo library", exact: true })
    .click();
  await expect(page.locator(".photo-kept")).toContainText(
    "Kept in your photo library",
  );
  await expect(page.locator(".photo-grid")).toContainText(
    "Synthetic reference.jpg",
  );
  checks.push(
    "Reference selection, setting, consent, one pending request, original/draft comparison, explicit likeness review and library handoff at phone/tablet/desktop widths",
  );
  assert.deepEqual(errors, []);
  console.log("PASS photo studio UI: " + checks.join("; "));
} finally {
  await page
    .screenshot({ path: folder + "/last-state.png", fullPage: true })
    .catch(() => {});
  const layout = await page
    .evaluate(() =>
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
    )
    .catch(() => []);
  await writeFile(folder + "/layout.json", JSON.stringify(layout, null, 2));
  await writeFile(
    folder + "/report.json",
    JSON.stringify(
      { checks, errors, provider: "isolated UI double; no live model call" },
      null,
      2,
    ),
  );
  await browser.close();
}
