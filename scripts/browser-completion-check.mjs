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

export async function checkAcquisitionConsent({ page, base }) {
  localFixture(base);
  const panel = page.getByRole("complementary", {
    name: "Optional analytics preferences",
  });
  await page.goto(
    base + "/?utm_source=browser-smoke&utm_campaign=consent-check",
  );
  await panel
    .getByRole("button", { name: "Continue without analytics", exact: true })
    .waitFor();
  assert.equal(
    (await page.context().cookies(base)).some(
      (cookie) => cookie.name === "acquisition",
    ),
    false,
    "An analytics identifier must not exist before consent",
  );
  await panel
    .getByRole("button", { name: "Continue without analytics", exact: true })
    .click();
  await page.reload();
  await panel
    .getByRole("button", { name: "Analytics preferences", exact: true })
    .click();
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
      panel
        .getByRole("button", { name: "Allow optional analytics", exact: true })
        .click(),
  );
  assert.equal(granted.granted, true);
  assert.equal(granted.firstTouch.source, "browser-smoke");
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
        base + "/pricing?utm_source=browser-return&utm_campaign=second-touch",
      ),
    (response) =>
      response.request().postDataJSON()?.source === "browser-return",
  );
  await panel
    .getByRole("button", { name: "Analytics preferences", exact: true })
    .click();
  // Reload the consent readback so the displayed last touch reflects the saved visit.
  await page.reload();
  await panel
    .getByRole("button", { name: "Analytics preferences", exact: true })
    .click();
  await panel
    .getByText(
      "First source: browser-smoke. Last tagged source: browser-return.",
      { exact: true },
    )
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
      panel
        .getByRole("button", {
          name: "Withdraw analytics consent",
          exact: true,
        })
        .click(),
  );
  assert.equal(withdrawn.granted, false);
  assert.equal(
    (await page.context().cookies(base)).some(
      (item) => item.name === "acquisition",
    ),
    false,
  );
  await page.reload();
  await panel
    .getByRole("button", { name: "Analytics preferences", exact: true })
    .waitFor();
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
  };
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
  observe(publicPage);
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
