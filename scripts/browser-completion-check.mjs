import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
const require = createRequire(import.meta.url);
const sharp = require("sharp");
function localFixture(base) {
  assert.ok(
    ["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname),
    "Completion browser checks require the local synthetic workspace",
  );
}

async function mutation(page, path, method, action, matches = () => true) {
  const pending = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/v1" + path &&
      response.request().method() === method &&
      matches(response),
  );
  await action();
  const response = await pending;
  assert.ok(
    response.ok(),
    `${method} ${path}: ${response.status()} ${await response.text()}`,
  );
  return response.json();
}
async function imageVisible(page, alt) {
  const image = page.getByRole("img", { name: alt, exact: true });
  await image.waitFor({ state: "visible" });
  await image.evaluate((element) => element.decode());
  assert.ok(
    await image.evaluate((element) => element.naturalWidth > 0),
    "The uploaded photo must decode in the browser",
  );
}

/** A one-page, text-only fixture exercises the real PDF sanitizer and browser download. */
function samplePdf() {
  const content = "BT /F1 14 Tf 20 100 Td (Synthetic browser attachment) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 160] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const crossReference = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${crossReference}\n%%EOF\n`;
  return Buffer.from(pdf);
}

/**
 * Where the optional-analytics controls are on the current page: the first
 * prompt's bar, its controls' sizes, whether the end of the page scrolls
 * clear of it, and every analytics control that floats (fixed or sticky,
 * itself or through an ancestor).
 */
async function consentLayout(page) {
  return page.evaluate(() => {
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
    };
    const floats = (el) => {
      for (let node = el; node && node !== document.body; node = node.parentElement) {
        const position = getComputedStyle(node).position;
        if (position === "fixed" || position === "sticky") return true;
      }
      return false;
    };
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
    };
    const floating = [
      ...document.querySelectorAll(".acquisition-consent, button, a, [role='button']"),
    ]
      .filter(
        (el) =>
          el.matches(".acquisition-consent") ||
          /analytics/i.test(`${el.textContent} ${el.getAttribute("aria-label") ?? ""}`),
      )
      .filter((el) => visible(el) && floats(el))
      .map((el) => (el.getAttribute("aria-label") || el.textContent || el.className).trim().slice(0, 60));
    const bar = document.querySelector(".consent-bar");
    const inset =
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--member-bottom-inset")) || 0;
    return {
      viewport: { width: innerWidth, height: innerHeight },
      overflow: document.documentElement.scrollWidth - innerWidth,
      inset,
      floating,
      open: !!document.querySelector("dialog.consent-sheet[open]"),
      bar: bar && visible(bar)
        ? {
            ...box(bar),
            controls: [...bar.querySelectorAll("button")].map((b) => ({
              name: (b.getAttribute("aria-label") || b.textContent).trim(),
              ...box(b),
            })),
            privacy: [...bar.querySelectorAll("a")].map((a) => a.getAttribute("href")),
          }
        : null,
    };
  });
}
/** The end of the page (its last footer, else main) after a full scroll. */
async function pageEnd(page) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(250);
  return page.evaluate(() => {
    const ends = [...document.querySelectorAll("footer, main")].filter(
      (el) => el.getBoundingClientRect().height > 0,
    );
    return Math.max(...ends.map((el) => el.getBoundingClientRect().bottom));
  });
}
/** The first prompt, before an answer: slim, reachable and covering nothing. */
async function assertConsentBar(page, label) {
  await page.locator(".consent-bar").waitFor();
  const layout = await consentLayout(page);
  const { bar, viewport } = layout;
  assert.ok(bar, `${label}: the analytics bar must show before an answer`);
  assert.ok(
    Math.abs(bar.bottom - (viewport.height - layout.inset)) <= 1,
    `${label}: the bar must sit on the bottom edge or the member app's bottom bar (bottom ${bar.bottom}, viewport ${viewport.height}, inset ${layout.inset})`,
  );
  assert.ok(Math.abs(bar.width - viewport.width) <= 1, `${label}: the bar spans the screen`);
  assert.ok(
    bar.height <= (viewport.width < 760 ? 180 : 72),
    `${label}: the bar is ${bar.height}px tall`,
  );
  const names = bar.controls.map((c) => c.name);
  assert.deepEqual(names, ["Allow analytics", "No thanks", "Close"], `${label}: ${names}`);
  for (const control of bar.controls)
    assert.ok(
      control.height >= 48 && control.width >= 48,
      `${label}: ${control.name} is ${control.width}x${control.height}px (48px minimum)`,
    );
  const [allow, decline] = bar.controls;
  assert.ok(
    Math.abs(allow.height - decline.height) <= 1 &&
      (viewport.width >= 760 || Math.abs(allow.width - decline.width) <= 1),
    `${label}: Allow and No thanks must carry equal weight`,
  );
  assert.deepEqual(bar.privacy, ["/privacy"], `${label}: the privacy policy link`);
  assert.ok(layout.overflow <= 1, `${label}: horizontal overflow of ${layout.overflow}px`);
  // It reserves its own space: the end of the page scrolls clear of it.
  const end = await pageEnd(page);
  const after = await consentLayout(page);
  assert.ok(
    end <= after.bar.top + 1,
    `${label}: the bar covers the end of the page (content ends at ${end}, bar starts at ${after.bar.top})`,
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  return { height: Math.round(bar.height), endClear: true };
}
/** After any answer: nothing about analytics floats, and no bar returns. */
async function assertNoFloatingConsent(page, label) {
  // Give the consent readback time to arrive after a load.
  await page.waitForTimeout(1200);
  const layout = await consentLayout(page);
  assert.equal(layout.bar, null, `${label}: the analytics bar returned after an answer`);
  assert.deepEqual(layout.floating, [], `${label}: floating analytics controls remain`);
}

export async function checkAcquisitionConsent({ page, base }) {
  localFixture(base);
  const bar = page.getByRole("complementary", { name: "Optional analytics" });
  const sheet = page.getByRole("dialog", { name: "Optional site analytics" });
  // Marketing pages have no floating button: the footer's "Analytics
  // preferences" opens the preferences sheet (retried until the page is
  // hydrated).
  const openPreferences = async () => {
    for (let attempt = 0; ; attempt++) {
      await page
        .getByRole("button", { name: "Analytics preferences", exact: true })
        .click();
      const opened = await sheet
        .getByRole("heading", { name: "Optional site analytics" })
        .waitFor({ timeout: 5000 })
        .then(
          () => true,
          () => false,
        );
      if (opened) return;
      if (attempt === 5) throw new Error("The analytics preferences did not open");
    }
  };
  await page.goto(base + "/?utm_source=instagram&utm_campaign=consent-check", {
    waitUntil: "networkidle",
  });
  // The first prompt waits for the visitor to scroll, so it never covers
  // the hero on the first screen; then it is a slim bar.
  await page.waitForTimeout(500);
  assert.equal(
    await bar.count(),
    0,
    "The analytics prompt must not cover the first screen before the visitor scrolls",
  );
  await page.mouse.wheel(0, 600);
  await bar.getByRole("button", { name: "No thanks", exact: true }).waitFor();
  const desktopBar = await assertConsentBar(page, "home 1440 before an answer");
  await page.mouse.wheel(0, 600);
  assert.equal(
    (await page.context().cookies(base)).some(
      (cookie) => cookie.name === "acquisition",
    ),
    false,
    "An analytics identifier must not exist before consent",
  );
  await bar.getByRole("button", { name: "No thanks", exact: true }).click();
  await assertNoFloatingConsent(page, "home after No thanks");
  await page.reload({ waitUntil: "networkidle" });
  await page.mouse.wheel(0, 600);
  await assertNoFloatingConsent(page, "home after No thanks and a reload");
  assert.equal(await bar.count(), 0, "A declined prompt must not return");
  await openPreferences();
  assert.equal(
    (await page.context().cookies(base)).some(
      (cookie) => cookie.name === "acquisition",
    ),
    false,
  );
  const granted = await mutation(
    page,
    "/public/acquisition/consent",
    "POST",
    () =>
      sheet
        .getByRole("button", { name: "Allow optional analytics", exact: true })
        .click(),
  );
  assert.equal(granted.granted, true);
  assert.equal(granted.firstTouch.source, "instagram");
  // The sheet closes with the answer; nothing is left floating.
  await sheet.waitFor({ state: "detached" });
  await assertNoFloatingConsent(page, "home after allowing");
  const cookie = (await page.context().cookies(base)).find(
    (item) => item.name === "acquisition",
  );
  assert.ok(
    cookie?.httpOnly,
    "Granted attribution must use the server's HttpOnly cookie",
  );
  assert.equal(
    await page.evaluate(() =>
      document.cookie
        .split(";")
        .some((item) => item.trim().startsWith("acquisition=")),
    ),
    false,
  );

  await mutation(
    page,
    "/public/acquisition/visit",
    "POST",
    () =>
      page.goto(
        base + "/pricing?utm_source=newsletter&utm_campaign=second-touch",
      ),
    (response) => response.request().postDataJSON()?.source === "newsletter",
  );
  await assertNoFloatingConsent(page, "/pricing after allowing");
  await openPreferences();
  // Reload the consent readback so the displayed last touch reflects the saved visit.
  await page.reload({ waitUntil: "networkidle" });
  await openPreferences();
  await sheet
    .getByText("First source: instagram. Last tagged source: newsletter.", {
      exact: true,
    })
    .waitFor();
  assert.equal(
    (await page.context().cookies(base)).find(
      (item) => item.name === "acquisition",
    )?.value,
    cookie.value,
    "Navigation must retain the existing consent identity",
  );
  const withdrawn = await mutation(
    page,
    "/public/acquisition/consent",
    "DELETE",
    () =>
      sheet
        .getByRole("button", {
          name: "Withdraw analytics consent",
          exact: true,
        })
        .click(),
  );
  assert.equal(withdrawn.granted, false);
  await sheet.waitFor({ state: "detached" });
  assert.equal(
    (await page.context().cookies(base)).some(
      (item) => item.name === "acquisition",
    ),
    false,
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Analytics preferences", exact: true })
    .waitFor();
  await page.mouse.wheel(0, 600);
  await assertNoFloatingConsent(page, "/pricing after withdrawing and a reload");
  assert.equal(
    await page.evaluate(() => localStorage.getItem("analytics-preference")),
    "declined",
  );
  assert.equal(
    (await page.context().cookies(base)).some(
      (item) => item.name === "acquisition",
    ),
    false,
  );
  return {
    declinedWithoutIdentifier: true,
    explicitOptIn: true,
    httpOnlyCookie: true,
    firstAndLastTouch: true,
    withdrawalClearsCookie: true,
    declinePersists: true,
    desktopBarHeight: desktopBar.height,
    nothingFloatsAfterAnswer: true,
  };
}

/**
 * Phone first (390x844 and 360x740): on a coach website and in the member
 * app the first prompt shows at once as the slim bar, above the member app's
 * bottom chrome, with 48 px choices, and the end of each page scrolls clear
 * of it. Close, like No thanks, is an answer: the bar and every floating
 * analytics control are gone on every page and after a reload. The answer
 * changes from the coach website's footer link (a bottom sheet on phones)
 * and from Profile > Privacy in the member app.
 */
export async function checkConsentOnPhone({ browser, base, member, password }) {
  localFixture(base);
  const phone = async (width, height) => {
    const context = await browser.newContext({
      viewport: { width, height },
      isMobile: true,
      hasTouch: true,
    });
    // Stay inside the API's normal request budget.
    let next = 0;
    await context.route("**/api/v1/**", async (route) => {
      const now = Date.now(),
        wait = Math.max(0, next - now);
      next = now + wait + 400;
      if (wait) await new Promise((r) => setTimeout(r, wait));
      await route.continue().catch(() => {});
    });
    return context;
  };
  const site = "/coach/alex-morgan";
  const result = {};

  // 360x740: the smallest phone; the bar fits without horizontal scroll.
  const small = await phone(360, 740);
  const narrow = await small.newPage();
  await narrow.goto(base + site, { waitUntil: "networkidle" });
  result.coachSite360 = await assertConsentBar(narrow, "coach website 360x740");
  await small.close();

  // 390x844: the coach website, then Close.
  const visitor = await phone(390, 844);
  const page = await visitor.newPage();
  await page.goto(base + site, { waitUntil: "networkidle" });
  result.coachSite390 = await assertConsentBar(page, "coach website 390x844");
  // The hero's call to action is not under the bar on the first screen.
  const covered = await page.evaluate(() => {
    const bar = document.querySelector(".consent-bar")?.getBoundingClientRect();
    const cta = document.querySelector(".site-hero .button")?.getBoundingClientRect();
    return !!bar && !!cta && cta.bottom > bar.top && cta.top < bar.bottom;
  });
  assert.equal(covered, false, "The bar covers the coach website's call to action");
  await page
    .getByRole("complementary", { name: "Optional analytics" })
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await assertNoFloatingConsent(page, "coach website after Close");
  assert.equal(
    await page.evaluate(() => localStorage.getItem("analytics-preference")),
    "dismissed",
  );
  await page.reload({ waitUntil: "networkidle" });
  await assertNoFloatingConsent(page, "coach website after Close and a reload");
  await page.goto(base + site + "/about", { waitUntil: "networkidle" });
  await assertNoFloatingConsent(page, "coach website about after Close");
  // The footer link opens the preferences as a bottom sheet.
  const sheet = page.getByRole("dialog", { name: "Optional site analytics" });
  await page
    .locator(".site-footer")
    .getByRole("button", { name: "Analytics preferences", exact: true })
    .click();
  await sheet.waitFor();
  // Measure where the sheet rests, after its opening motion.
  await sheet.evaluate((el) =>
    Promise.all(el.getAnimations().map((animation) => animation.finished)),
  );
  const shape = await sheet.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { bottom: r.bottom, width: r.width, height: innerHeight, viewport: innerWidth };
  });
  assert.ok(
    Math.abs(shape.bottom - shape.height) <= 1 && Math.abs(shape.width - shape.viewport) <= 1,
    `The preferences must open as a bottom sheet on a phone: ${JSON.stringify(shape)}`,
  );
  await sheet.getByRole("button", { name: "Close", exact: true }).click();
  await sheet.waitFor({ state: "detached" });
  await assertNoFloatingConsent(page, "coach website after closing the sheet");
  await visitor.close();

  // The member app: the bar before an answer, No thanks, then Profile >
  // Privacy.
  if (member) {
    const app = await phone(390, 844);
    const m = await app.newPage();
    await m.goto(base + "/login", { waitUntil: "networkidle" });
    await m.waitForFunction(() => {
      const form = document.querySelector("form");
      return !!form && Object.keys(form).some((k) => k.startsWith("__react"));
    });
    await m.getByLabel("Email address").fill(member);
    await m.getByLabel("Password", { exact: true }).fill(password);
    await m.getByRole("button", { name: "Sign in", exact: true }).click();
    await m.waitForURL(/\/app(\/|$)/, { timeout: 120_000 });
    await m.locator("h1").first().waitFor();
    result.memberApp = await assertConsentBar(m, "member app 390x844");
    await m
      .getByRole("complementary", { name: "Optional analytics" })
      .getByRole("button", { name: "No thanks", exact: true })
      .click();
    await assertNoFloatingConsent(m, "member app after No thanks");
    for (const route of ["/app/program", "/app/chat", "/app/profile"]) {
      await m.goto(base + route, { waitUntil: "networkidle" });
      await m.locator("h1").first().waitFor();
      await assertNoFloatingConsent(m, `${route} after No thanks`);
    }
    const privacy = m.locator("#privacy");
    await privacy.getByRole("heading", { name: "Optional site analytics" }).waitFor();
    await privacy.getByText("Off for this browser.", { exact: true }).waitFor();
    const on = await mutation(m, "/public/acquisition/consent", "POST", () =>
      privacy.getByRole("button", { name: "Turn on analytics", exact: true }).click(),
    );
    assert.equal(on.granted, true);
    await privacy.getByText("On for this browser.", { exact: true }).waitFor();
    await assertNoFloatingConsent(m, "Profile after turning analytics on");
    const off = await mutation(m, "/public/acquisition/consent", "DELETE", () =>
      privacy.getByRole("button", { name: "Turn off analytics", exact: true }).click(),
    );
    assert.equal(off.granted, false);
    await privacy.getByText("Off for this browser.", { exact: true }).waitFor();
    await m.reload({ waitUntil: "networkidle" });
    await assertNoFloatingConsent(m, "Profile after turning analytics off and a reload");
    await app.close();
    result.profileSetting = true;
  }
  return result;
}

export async function checkCompletionFlows({
  coach,
  subscriber,
  browser,
  base,
  observe,
  pages,
}) {
  localFixture(base);
  const run = Date.now().toString(36);
  const galleryTitle = `Browser gallery ${run}`,
    alt = `Synthetic training photo ${run}`,
    headline = `Thoughtful training ${run}`;
  const photo = await sharp({
    create: { width: 96, height: 64, channels: 3, background: "#4b756d" },
  })
    .png()
    .toBuffer();
  const publicContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const publicPage = await publicContext.newPage();
  pages.push(publicPage);
  await observe(publicPage);
  await coach.setViewportSize({ width: 1440, height: 1050 });
  await coach.goto(base + "/trainer/galleries");
  await coach
    .getByRole("heading", { name: "Photos & galleries.", exact: true })
    .waitFor();
  await coach
    .getByLabel("New gallery title", { exact: true })
    .fill(galleryTitle);
  const gallery = await mutation(coach, "/tenant/galleries", "POST", () =>
    coach.getByRole("button", { name: "Create gallery", exact: true }).click(),
  );
  const editor = coach.locator(".gallery-editor");
  await editor.getByLabel("Choose photos", { exact: true }).setInputFiles({
    name: `synthetic-gallery-${run}.png`,
    mimeType: "image/png",
    buffer: photo,
  });
  await editor
    .getByLabel("I have permission to use and publish these photos.", {
      exact: true,
    })
    .check();
  const uploaded = await mutation(coach, "/tenant/media", "POST", () =>
    editor.getByRole("button", { name: "Upload photos", exact: true }).click(),
  );
  await editor
    .getByLabel("Description for accessibility", { exact: true })
    .fill(alt);
  await editor
    .getByLabel("Caption", { exact: true })
    .fill("Synthetic gallery photo used only for browser verification.");
  await mutation(coach, `/tenant/galleries/${gallery.id}/photos`, "PUT", () =>
    editor
      .getByRole("button", { name: "Save photos and order", exact: true })
      .click(),
  );
  await coach.getByText("Photos saved.", { exact: true }).waitFor();
  const clientGalleryLoad = subscriber.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/v1/tenant/galleries" &&
      response.request().method() === "GET",
  );
  await subscriber.goto(base + "/app/galleries");
  assert.ok(
    (await clientGalleryLoad).ok(),
    "Client galleries must load before checking draft isolation",
  );
  await subscriber
    .getByRole("heading", { name: "Coach galleries.", exact: true })
    .waitFor();
  assert.equal(
    await subscriber
      .getByRole("heading", { name: galleryTitle, exact: true })
      .count(),
    0,
    "Private drafts must not appear in the client gallery",
  );
  assert.equal(
    (await publicPage.request.get(base + uploaded.url)).status(),
    404,
    "Private gallery photos must not be anonymously retrievable",
  );
  await editor
    .getByLabel("Show this gallery", { exact: true })
    .selectOption("both");
  await mutation(coach, `/tenant/galleries/${gallery.id}`, "PATCH", () =>
    editor
      .getByRole("button", { name: "Save gallery details", exact: true })
      .click(),
  );
  await coach.reload();
  await coach
    .getByRole("heading", { name: galleryTitle, exact: true })
    .waitFor();
  await imageVisible(coach, alt);

  await coach.goto(base + "/trainer/website");
  await coach.getByLabel("Headline", { exact: true }).fill(headline);
  await coach
    .getByLabel("Introduction", { exact: true })
    .fill("Synthetic website introduction from the browser publication check.");
  await mutation(coach, "/tenant/site", "PUT", () =>
    coach
      .getByRole("button", { name: "Save private draft", exact: true })
      .click(),
  );
  await coach
    .getByRole("link", { name: "Preview saved draft", exact: true })
    .click();
  await coach.getByRole("heading", { name: headline, exact: true }).waitFor();
  await publicPage.goto(base + "/coach/alex-morgan");
  // The first analytics prompt is the slim bar; any answer ends it.
  await publicPage
    .getByRole("complementary", { name: "Optional analytics" })
    .getByRole("button", { name: "No thanks", exact: true })
    .click();
  await publicPage.getByRole("navigation", { name: "Coach website" }).waitFor();
  assert.equal(
    await publicPage
      .getByRole("heading", { name: headline, exact: true })
      .count(),
    0,
    "Saving a private website draft must not publish it",
  );
  await coach.goto(base + "/trainer/website");
  await mutation(coach, "/tenant/site/publish", "POST", () =>
    coach.getByRole("button", { name: "Publish website", exact: true }).click(),
  );
  await coach
    .getByText("Your website is published.", { exact: true })
    .waitFor();
  await publicPage.reload();
  await publicPage
    .getByRole("heading", { name: headline, exact: true })
    .waitFor();
  await publicPage
    .getByRole("navigation", { name: "Coach website" })
    .getByRole("link", { name: "Galleries", exact: true })
    .click();
  await publicPage
    .getByRole("heading", { name: galleryTitle, exact: true })
    .waitFor();
  await imageVisible(publicPage, alt);
  assert.equal(
    await publicPage.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    "Published website gallery must fit the mobile viewport",
  );
  await subscriber.goto(base + "/app/galleries");
  await subscriber
    .getByRole("heading", { name: galleryTitle, exact: true })
    .waitFor();
  await imageVisible(subscriber, alt);

  await subscriber.goto(base + "/app/chat");
  await subscriber
    .getByRole("heading", { name: "Talk with your coach", exact: true })
    .waitFor();
  await subscriber
    .getByLabel(
      "I have permission to share these files in this conversation.",
      { exact: true },
    )
    .check();
  const attachment = await mutation(
    subscriber,
    "/chat/attachments",
    "POST",
    () =>
      subscriber
        .getByLabel("Choose photos or PDFs", { exact: true })
        .setInputFiles({
          name: `synthetic-chat-${run}.pdf`,
          mimeType: "application/pdf",
          buffer: samplePdf(),
        }),
  );
  const messageText = `Synthetic attachment message ${run}`;
  await subscriber
    .getByLabel("Your message", { exact: true })
    .fill(messageText);
  const sent = await mutation(subscriber, "/messages", "POST", () =>
    subscriber
      .getByRole("button", { name: "Send to trainer", exact: true })
      .click(),
  );
  assert.equal(sent.data.attachments.length, 1);
  assert.equal(sent.data.attachments[0].id, attachment.id);
  await subscriber
    .getByRole("region", { name: "Conversation" })
    .getByText(messageText, { exact: true })
    .waitFor();
  await coach.goto(base + "/trainer/messages");
  await coach
    .getByLabel("Client", { exact: true })
    .selectOption({ label: "Sam Taylor" });
  const received = coach
    .getByRole("region", { name: "Conversation" })
    .locator("article")
    .filter({ hasText: messageText });
  const fileLink = received.getByRole("link", {
    name: `Download ${attachment.fileName}`,
    exact: true,
  });
  await fileLink.waitFor();
  assert.equal(
    (
      await publicPage.request.get(
        base + "/api/v1/chat/attachments/" + attachment.id,
      )
    ).status(),
    401,
    "Conversation attachments must remain private",
  );
  const pendingDownload = coach.waitForEvent("download");
  await fileLink.click();
  const download = await pendingDownload;
  assert.equal(await download.failure(), null);
  assert.equal(download.suggestedFilename(), attachment.fileName);
  const bytes = await readFile(await download.path());
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
  await mutation(coach, `/chat/attachments/${attachment.id}`, "DELETE", () =>
    received.getByRole("button", { name: "Remove file", exact: true }).click(),
  );
  await fileLink.waitFor({ state: "detached" });
  await subscriber.reload();
  await subscriber.getByText(messageText, { exact: true }).waitFor();
  assert.equal(
    await subscriber
      .getByRole("link", {
        name: `Download ${attachment.fileName}`,
        exact: true,
      })
      .count(),
    0,
  );
  assert.equal(
    (
      await subscriber.request.get(
        base + "/api/v1/chat/attachments/" + attachment.id,
      )
    ).status(),
    404,
  );

  await coach.goto(base + "/trainer/notifications");
  await coach
    .getByRole("heading", { name: "Your notifications.", exact: true })
    .waitFor();
  const notice = coach
    .locator("article")
    .filter({
      has: coach.getByRole("heading", {
        name: "You have a new coaching message",
        exact: true,
      }),
    })
    .first();
  await notice.getByRole("button", { name: "Mark read", exact: true }).click();
  await notice.getByText(/· Read/).waitFor();
  await coach.reload();
  await coach
    .locator("article")
    .filter({
      has: coach.getByRole("heading", {
        name: "You have a new coaching message",
        exact: true,
      }),
    })
    .first()
    .getByText(/· Read/)
    .waitFor();

  await subscriber.goto(base + "/app/profile");
  const preferences = subscriber.locator("section").filter({
    has: subscriber.getByRole("heading", {
      name: "Notifications",
      exact: true,
    }),
  });
  await preferences.getByLabel("Email reminders", { exact: true }).uncheck();
  await preferences
    .getByLabel("Booking notifications", { exact: true })
    .check();
  await preferences.getByLabel("Workout reminders", { exact: true }).uncheck();
  await preferences
    .getByLabel("Optional product news", { exact: true })
    .uncheck();
  await preferences.getByLabel("Time zone", { exact: true }).fill("Asia/Dubai");
  await preferences
    .getByLabel("Quiet hours start", { exact: true })
    .fill("23:00");
  await preferences
    .getByLabel("Quiet hours end", { exact: true })
    .fill("06:30");
  await mutation(subscriber, "/notifications/preferences", "PUT", () =>
    preferences
      .getByRole("button", { name: "Save preferences", exact: true })
      .click(),
  );
  await subscriber.reload();
  await preferences.getByLabel("Quiet hours start", { exact: true }).waitFor();
  assert.equal(
    await preferences
      .getByLabel("Email reminders", { exact: true })
      .isChecked(),
    false,
  );
  assert.equal(
    await preferences
      .getByLabel("Workout reminders", { exact: true })
      .isChecked(),
    false,
  );
  assert.equal(
    await preferences
      .getByLabel("Booking notifications", { exact: true })
      .isChecked(),
    true,
  );
  assert.equal(
    await preferences
      .getByLabel("Optional product news", { exact: true })
      .isChecked(),
    false,
  );
  assert.equal(
    await preferences.getByLabel("Time zone", { exact: true }).inputValue(),
    "Asia/Dubai",
  );
  assert.equal(
    await preferences
      .getByLabel("Quiet hours start", { exact: true })
      .inputValue(),
    "23:00",
  );
  assert.equal(
    await preferences
      .getByLabel("Quiet hours end", { exact: true })
      .inputValue(),
    "06:30",
  );
  await publicContext.close();
  return {
    launchState:
      "seeded only for the known synthetic demo workspace; real launch gates are covered by onboarding tests",
    photoUploadAndGalleryPersistence: true,
    privateGalleryHidden: true,
    websiteDraftIsolation: true,
    websitePublication: true,
    publicAndClientPhotoVisibility: true,
    chatAttachmentSendDownloadDelete: true,
    chatAttachmentAnonymousDenied: true,
    notificationReadPersists: true,
    notificationPreferencesPersist: true,
  };
}
