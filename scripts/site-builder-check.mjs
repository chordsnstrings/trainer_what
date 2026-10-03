// A destructive journey against the known synthetic, loopback-only demo coach.
// Run through the existing isolated fixture runner after `npm run build`:
// RTL_CHECK_MODULE=./site-builder-check.mjs RTL_WEB_PORT=3129 RTL_API_PORT=4129 \
// RTL_DATA_DIR=.data/site-builder-check RTL_WEB_MODE=start node scripts/run-rtl-check.mjs
// Or point TEST_APP_URL at an already-running, isolated local fixture.
// No model provider or live account is used; the starter response is intercepted.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { chromium, expect } from "@playwright/test";
import sharp from "sharp";

const base = process.env.TEST_APP_URL ?? "http://localhost:3129";
const target = new URL(base);
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) ||
  !["http:", "https:"].includes(target.protocol) ||
  process.env.NODE_ENV === "production"
)
  throw new Error(
    "The builder journey only changes an isolated loopback fixture",
  );

await mkdir("test-results", { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {}),
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1050 },
});
const page = await context.newPage();
const publicContext = await browser.newContext({
  viewport: { width: 1440, height: 1050 },
});
const publicPage = await publicContext.newPage();
const report = {
  startedAt: new Date().toISOString(),
  base,
  checks: [],
  pageErrors: [],
  failedRequests: [],
  screenshots: [],
  status: "running",
};
let nextRequest = 0;
for (const p of [page, publicPage]) {
  p.setDefaultTimeout(20_000);
  p.on("pageerror", (error) => report.pageErrors.push(error.message));
  p.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText ?? "unknown";
    if (
      request.url().startsWith(base) &&
      !/ERR_ABORTED|NS_BINDING_ABORTED/.test(failure)
    )
      report.failedRequests.push({ url: request.url(), failure });
  });
  await p.route("**/api/v1/**", async (route) => {
    const now = Date.now();
    const delay = Math.max(0, nextRequest - now);
    nextRequest = now + delay + 650;
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    await route.continue();
  });
}

async function check(name, fn) {
  const start = Date.now();
  try {
    const result = await fn();
    report.checks.push({
      name,
      status: "passed",
      elapsedMs: Date.now() - start,
    });
    console.log("PASS", name);
    return result;
  } catch (error) {
    report.checks.push({
      name,
      status: "failed",
      elapsedMs: Date.now() - start,
      error: String(error?.stack ?? error),
    });
    throw error;
  }
}
async function api(path, method = "GET", data) {
  const response = await page.request.fetch(base + "/api/v1" + path, {
    method,
    ...(data === undefined ? {} : { data }),
    headers: { origin: target.origin },
  });
  assert.equal(
    response.status(),
    200,
    `${method} ${path}: ${await response.text()}`,
  );
  return response.json();
}
async function publicSite() {
  const response = await publicPage.request.get(
    base + "/api/v1/public/sites/alex-morgan",
  );
  assert.equal(response.status(), 200, await response.text());
  return response.json();
}
async function noOverflow(p, label) {
  const measurement = await p.evaluate(() => ({
    viewport: innerWidth,
    width: document.documentElement.scrollWidth,
  }));
  assert.ok(
    measurement.width <= measurement.viewport + 1,
    `${label} overflows: ${JSON.stringify(measurement)}`,
  );
  const panels = await p
    .locator(".sbe:visible :is(.sbe-left-scroll,.sbe-right-panel)")
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const css = getComputedStyle(node);
        return {
          padding: css.padding,
          width: node.clientWidth,
          content: node.scrollWidth,
        };
      }),
    );
  for (const panel of panels) {
    assert.equal(
      panel.padding,
      panels[0].padding,
      `${label}: editor panel gutters should align`,
    );
    assert.ok(
      panel.content <= panel.width + 1,
      `${label}: editor controls should fit their panel`,
    );
  }
}
async function capture(p, name) {
  const path = `test-results/site-builder-${name}.png`;
  await p.screenshot({ path, fullPage: true });
  report.screenshots.push(path);
}
async function saved() {
  await expect(page.getByTestId("builder-save-status")).toContainText(
    "Draft saved",
    { timeout: 25_000 },
  );
}
async function mutate(path, method, act) {
  const responsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/v1" + path &&
      response.request().method() === method,
  );
  const [response] = await Promise.all([responsePromise, act()]);
  assert.equal(
    response.status(),
    200,
    `${method} ${path}: ${await response.text()}`,
  );
  return response.json();
}
async function nativeDrag(source, target) {
  await source.scrollIntoViewIfNeeded();
  const from = await source.boundingBox();
  assert.ok(from, "the dragged control must have a position");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  // Native HTML drag activates the editor's initially collapsed drop zones.
  await page.mouse.move(
    from.x + from.width / 2 + 12,
    from.y + from.height / 2 + 12,
    { steps: 4 },
  );
  await expect(page.getByTestId("site-builder-editor")).toHaveClass(
    /is-dragging/,
  );
  await target.scrollIntoViewIfNeeded();
  const to = await target.boundingBox();
  assert.ok(to && to.height > 0, "the active drop zone must be visible");
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 12,
  });
  await page.mouse.move(to.x + to.width / 2 + 1, to.y + to.height / 2);
  await page.mouse.up();
}
async function publish() {
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  const published = await mutate("/tenant/site/publish", "POST", () =>
    page
      .getByRole("dialog", { name: "Ready to go live?" })
      .getByRole("button", { name: "Publish website", exact: true })
      .click(),
  );
  await saved();
  return published;
}
const sections = () => page.locator(".sbe-canvas-section");
const heroSection = () =>
  page.locator('.sbe-canvas-section:has([data-module="hero"])').first();

// The journeys below intentionally use the visible editor and its actual
// persistence endpoints. Catalogue internals are never edited through JS.
try {
  await check("synthetic coach signs in", async () => {
    await page.goto(base + "/login");
    await page
      .getByLabel("Email address", { exact: true })
      .fill("coach@example.test");
    await page
      .getByLabel("Password", { exact: true })
      .fill(process.env.DEMO_PASSWORD ?? "TrainerDemo2026!");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(/\/(trainer|admin\/settings)$/);
  });

  const run = randomUUID().slice(0, 8);
  const legacyHeadline = `Existing coaching welcome ${run}`;
  let baselineRevision;
  await check(
    "legacy publication remains live while the editor converts privately",
    async () => {
      const current = await api("/tenant/site");
      const legacy = await api("/tenant/site", "PUT", {
        version: current.version,
        site: {
          headline: legacyHeadline,
          introduction: "Existing coaching introduction.",
          about: "A trainer biography that must survive migration.",
          contactEmail: "coach@example.test",
          pages: [
            {
              slug: "existing-approach",
              title: "Existing approach",
              body: "An existing page body that must survive migration.",
              visible: true,
            },
          ],
        },
      });
      await api("/tenant/site/publish", "POST", { version: legacy.version });
      baselineRevision = (await publicSite()).publishedRevision;
      await page.goto(base + "/trainer/website");
      await expect(page.getByTestId("site-builder-editor")).toBeVisible();
      await expect(
        heroSection().locator('[data-builder-field="title"]'),
      ).toHaveText(legacyHeadline);
      await heroSection().click();
      await expect(
        page.getByRole("textbox", { name: "Title", exact: true }),
      ).toHaveValue(legacyHeadline);
      await publicPage.goto(base + "/coach/alex-morgan");
      await expect(
        publicPage.getByRole("heading", { name: legacyHeadline, exact: true }),
      ).toBeVisible();
      assert.equal((await publicSite()).publishedRevision, baselineRevision);
      await noOverflow(page, "desktop editor at 1440");
    },
  );

  await check(
    "template preview waits for application and creates a multipage draft",
    async () => {
      const prior = await api("/tenant/site");
      await page
        .getByRole("button", { name: "Templates", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "Start with a complete design.",
      });
      await dialog
        .locator(".sbe-template-card")
        .filter({ has: page.getByText("Minimal", { exact: true }) })
        .click();
      await expect(dialog.getByLabel("Starter preview page")).toHaveCount(1);
      assert.equal((await api("/tenant/site")).version, prior.version);
      const result = await mutate("/tenant/site", "PUT", () =>
        dialog
          .getByRole("button", { name: "Use this starter", exact: true })
          .click(),
      );
      assert.equal(result.draft.builder.pages.length, 4);
      assert.equal((await publicSite()).publishedRevision, baselineRevision);
      await saved();
    },
  );

  let faqId;
  await check(
    "comprehensive catalogue search and real drag-to-add section",
    async () => {
      const cards = page.locator("[data-module-id]");
      assert.ok(
        (await cards.count()) >= 35,
        "the section library must cover at least 35 families",
      );
      const layouts = await cards.locator("small").allTextContents();
      assert.ok(layouts.every((text) => Number.parseInt(text, 10) >= 6));
      await page
        .getByLabel("Search sections", { exact: true })
        .fill("before after");
      await expect(
        page.locator('[data-module-id="transformation"]'),
      ).toHaveCount(1);
      await expect(
        page.locator('[data-module-id="transformation"]'),
      ).toContainText("Before & after gallery");
      await page.getByLabel("Search sections", { exact: true }).fill("");

      assert.ok(
        layouts.reduce((n, text) => n + Number.parseInt(text, 10), 0) >= 270,
      );
      const before = await sections().count();
      await page.getByLabel("Search sections", { exact: true }).fill("FAQ");
      await expect(cards).toHaveCount(1);
      const result = await mutate("/tenant/site", "PUT", () =>
        nativeDrag(
          page.locator('[data-module-id="faq"]'),
          page.locator('[data-drop-index="1"]'),
        ),
      );
      const home = result.draft.builder.pages.find((p) => p.slug === "");
      assert.equal(home.sections.length, before + 1);
      assert.equal(home.sections[1].moduleId, "faq");
      faqId = home.sections[1].id;
      await page.getByLabel("Search sections", { exact: true }).fill("");
      await saved();
    },
  );

  await check(
    "drag reorder, undo and redo preserve section identity",
    async () => {
      const card = page.locator(
        `.sbe-canvas-section[data-section-id="${faqId}"]`,
      );
      await card.hover();
      const moved = await mutate("/tenant/site", "PUT", () =>
        nativeDrag(
          card.locator(".sbe-section-grip"),
          page.locator('[data-drop-index="0"]'),
        ),
      );
      assert.equal(moved.draft.builder.pages[0].sections[0].id, faqId);
      const undone = await mutate("/tenant/site", "PUT", () =>
        page.getByRole("button", { name: "Undo", exact: true }).click(),
      );
      assert.equal(undone.draft.builder.pages[0].sections[1].id, faqId);
      const redone = await mutate("/tenant/site", "PUT", () =>
        page.getByRole("button", { name: "Redo", exact: true }).click(),
      );
      assert.equal(redone.draft.builder.pages[0].sections[0].id, faqId);
      await mutate("/tenant/site", "PUT", () =>
        page.getByRole("button", { name: "Undo", exact: true }).click(),
      );
      await saved();
    },
  );

  let publishedTitle = `Coaching designed around you ${run}`;
  await check(
    "inspector and inline text edits autosave and survive reload",
    async () => {
      await heroSection().click();
      await mutate("/tenant/site", "PUT", () =>
        page
          .getByRole("textbox", { name: "Title", exact: true })
          .fill(publishedTitle),
      );
      await mutate("/tenant/site", "PUT", async () => {
        const inline = heroSection().locator('[data-builder-field="body"]');
        await inline.fill(
          "Thoughtful coaching built around a consistent weekly routine.",
        );
        await page.getByRole("textbox", { name: "Title", exact: true }).click();
      });
      await saved();
      await page.reload();
      await page.getByLabel("Current page", { exact: true }).waitFor();
      await expect(
        heroSection().locator('[data-builder-field="title"]'),
      ).toHaveText(publishedTitle);
      await expect(
        heroSection().locator('[data-builder-field="body"]'),
      ).toHaveText(
        "Thoughtful coaching built around a consistent weekly routine.",
      );
      assert.equal((await publicSite()).publishedRevision, baselineRevision);
    },
  );

  await check(
    "overlapping autosave and repeated manual saves serialize the newest content",
    async () => {
      let releaseFirst;
      const firstStarted = new Promise((resolve) => {
        releaseFirst = resolve;
      });
      let delayed = false;
      const responses = [];
      const watch = (response) => {
        if (
          new URL(response.url()).pathname === "/api/v1/tenant/site" &&
          response.request().method() === "PUT"
        )
          responses.push(response.status());
      };
      page.on("response", watch);
      const delayFirst = async (route) => {
        if (route.request().method() === "PUT" && !delayed) {
          delayed = true;
          releaseFirst();
          await new Promise((resolve) => setTimeout(resolve, 1300));
        }
        await route.fallback();
      };
      await page.route("**/api/v1/tenant/site", delayFirst);
      await heroSection().click();
      await page
        .getByRole("textbox", { name: "Title", exact: true })
        .fill(`An intermediate edit ${run}`);
      await Promise.race([
        firstStarted,
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("The first autosave did not start")),
            20_000,
          ),
        ),
      ]);
      publishedTitle = `The newest coaching welcome ${run}`;
      await page
        .getByRole("textbox", { name: "Title", exact: true })
        .fill(publishedTitle);
      await page.keyboard.press("Control+s");
      await page.keyboard.press("Control+s");
      await saved();
      await expect
        .poll(async () => {
          const state = await api("/tenant/site");
          return state.draft.builder.pages[0].sections.find(
            (s) => s.moduleId === "hero",
          ).content.title;
        })
        .toBe(publishedTitle);
      assert.ok(
        responses.length >= 2,
        "both the initial and newest edits must be saved",
      );
      assert.deepEqual(
        responses.filter((status) => status !== 200),
        [],
      );
      await page.unroute("**/api/v1/tenant/site", delayFirst);
      page.off("response", watch);
      await page.reload();
      await page.getByLabel("Current page", { exact: true }).waitFor();
      await expect(
        heroSection().locator('[data-builder-field="title"]'),
      ).toHaveText(publishedTitle);
    },
  );

  let mediaUrl;
  await check(
    "photo library upload and selection stay private before publication",
    async () => {
      await heroSection().click();
      const inspector = page.getByRole("complementary", {
        name: "Content and design inspector",
      });
      await inspector
        .locator("summary")
        .filter({ hasText: /^Image$/ })
        .click();
      await inspector
        .getByRole("button", { name: "Choose photo", exact: true })
        .first()
        .click();
      const dialog = page.getByRole("dialog", { name: "Your photo library" });
      await dialog
        .getByLabel("I have permission to upload and publish these photos.", {
          exact: true,
        })
        .check();
      const photo = await sharp({
        create: { width: 960, height: 720, channels: 3, background: "#64836d" },
      })
        .png()
        .toBuffer();
      const filename = `builder-coaching-photo-${run}.png`;
      const uploaded = await mutate("/tenant/media", "POST", () =>
        dialog.locator('input[type="file"]').setInputFiles({
          name: filename,
          mimeType: "image/png",
          buffer: photo,
        }),
      );
      mediaUrl = uploaded.url;
      assert.equal(
        (await publicPage.request.get(base + mediaUrl)).status(),
        404,
      );
      await mutate("/tenant/site", "PUT", () =>
        dialog.getByRole("button").filter({ hasText: filename }).click(),
      );
      await mutate("/tenant/site", "PUT", () =>
        inspector
          .getByLabel(/^Image description/)
          .fill("Synthetic coaching studio photograph"),
      );
      assert.equal(
        (await publicPage.request.get(base + mediaUrl)).status(),
        404,
      );
      await saved();
    },
  );

  let newPageId;
  const pageTitle = "My coaching approach",
    oldSlug = "approach-journal",
    newSlug = "my-coaching-approach";
  const seoTitle = `A considered coaching approach ${run}`;
  await check(
    "new page, renamed address, navigation and individual search settings persist",
    async () => {
      await page.getByRole("tab", { name: "Pages", exact: true }).click();
      await page.getByRole("button", { name: "New page", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Add a page" });
      await dialog
        .getByLabel("New page title", { exact: true })
        .fill("Approach journal");
      const created = await mutate("/tenant/site", "PUT", () =>
        dialog
          .getByRole("button", { name: "Create page", exact: true })
          .click(),
      );
      newPageId = created.draft.builder.pages.find(
        (p) => p.slug === oldSlug,
      ).id;
      await mutate("/tenant/site", "PUT", async () => {
        await page
          .getByRole("textbox", { name: "Page title", exact: true })
          .fill(pageTitle);
        await page.getByLabel(/^Page address/).fill(newSlug);
        await page.getByLabel(/^Search title/).fill(seoTitle);
        await page
          .getByLabel(/^Search description/)
          .fill(
            "Our approach combines consistent practice with thoughtful coaching.",
          );
        await page
          .getByLabel("Show in the navigation menu", { exact: true })
          .uncheck();
        await page
          .getByLabel("Ask search engines not to list this page", {
            exact: true,
          })
          .check();
      });
      await page.getByRole("tab", { name: "Sections", exact: true }).click();
      await page.getByLabel("Search sections", { exact: true }).fill("text");
      await mutate("/tenant/site", "PUT", () =>
        page.locator('[data-module-id="text"]').click(),
      );
      await mutate("/tenant/site", "PUT", async () => {
        await page
          .getByRole("textbox", { name: "Title", exact: true })
          .fill(pageTitle);
        await page
          .getByRole("textbox", { name: "Body", exact: true })
          .fill(
            "Start with a routine you can repeat and review it with your coach.",
          );
      });
      const state = await api("/tenant/site");
      const custom = state.draft.builder.pages.find((p) => p.id === newPageId);
      assert.equal(custom.slug, newSlug);
      assert.equal(custom.inNavigation, false);
      assert.equal(custom.noindex, true);
      assert.ok(
        state.draft.builder.redirects.some(
          (r) => r.from === oldSlug && r.toPageId === newPageId,
        ),
      );
      await saved();
    },
  );

  await check(
    "nested columns can be edited, moved and reused as independent saved sections",
    async () => {
      await page.getByRole("tab", { name: "Sections", exact: true }).click();
      await page.getByLabel("Search sections", { exact: true }).fill("");
      const added = await mutate("/tenant/site", "PUT", () =>
        page.locator('[data-module-id="columns"]').click(),
      );
      const original = added.draft.builder.pages
        .find((p) => p.id === newPageId)
        .sections.at(-1);
      const heading = original.content.elements[0].children.find(
        (element) => element.type === "heading",
      );
      const secondColumn = original.content.elements[1];
      const inspector = page.getByRole("complementary", {
        name: "Content and design inspector",
      });
      await inspector
        .locator(".sbe-element-tree button")
        .filter({ hasText: heading.text.slice(0, 32) })
        .first()
        .click();
      const originalText = `A nested coaching detail ${run}`;
      await mutate("/tenant/site", "PUT", () =>
        inspector
          .getByRole("textbox", { name: "Text", exact: true })
          .fill(originalText),
      );
      const moved = await mutate("/tenant/site", "PUT", () =>
        inspector
          .getByRole("combobox", { name: "Move element into", exact: true })
          .selectOption(secondColumn.id),
      );
      const movedSection = moved.draft.builder.pages
        .find((p) => p.id === newPageId)
        .sections.find((s) => s.id === original.id);
      assert.ok(
        !movedSection.content.elements[0].children.some(
          (element) => element.id === heading.id,
        ),
      );
      assert.equal(
        movedSection.content.elements[1].children.find(
          (element) => element.id === heading.id,
        ).text,
        originalText,
      );
      const card = page.locator(
        `.sbe-canvas-section[data-section-id="${original.id}"]`,
      );
      await card.hover();
      await card
        .getByRole("button", { name: "Save section", exact: true })
        .click();
      const savedName = `Coaching detail layout ${run}`;
      const dialog = page.getByRole("dialog", { name: "Save this section" });
      await dialog
        .getByRole("textbox", { name: "Section name", exact: true })
        .fill(savedName);
      await mutate("/tenant/site", "PUT", () =>
        dialog
          .getByRole("button", { name: "Save section", exact: true })
          .click(),
      );
      await page
        .getByLabel("Current page", { exact: true })
        .selectOption({ label: "Home" });
      const inserted = await mutate("/tenant/site", "PUT", () =>
        page
          .locator(".sbe-saved-card button")
          .filter({ hasText: savedName })
          .click(),
      );
      const copy = inserted.draft.builder.pages
        .find((p) => p.slug === "")
        .sections.at(-1);
      assert.equal(copy.moduleId, "columns");
      assert.notEqual(copy.id, original.id);
      await inspector
        .locator(".sbe-element-tree button")
        .filter({ hasText: originalText.slice(0, 32) })
        .first()
        .click();
      const copyText = `An independently edited copy ${run}`;
      await mutate("/tenant/site", "PUT", () =>
        inspector
          .getByRole("textbox", { name: "Text", exact: true })
          .fill(copyText),
      );
      await saved();
      await page.reload();
      await page.getByLabel("Current page", { exact: true }).waitFor();
      const persisted = (await api("/tenant/site")).draft.builder;
      const source = persisted.pages
        .find((p) => p.id === newPageId)
        .sections.find((s) => s.id === original.id);
      const copied = persisted.pages
        .find((p) => p.slug === "")
        .sections.find((s) => s.id === copy.id);
      assert.ok(JSON.stringify(source).includes(originalText));
      assert.ok(!JSON.stringify(source).includes(copyText));
      assert.ok(JSON.stringify(copied).includes(copyText));
      assert.equal(persisted.savedSections[0].name, savedName);
    },
  );

  await check(
    "mocked module-based AI proposal is previewed, applied privately and undoable",
    async () => {
      const initial = await api("/tenant/site");
      const proposed = structuredClone(initial.draft.builder);
      // Real template/AI proposals contain a fresh empty library; the editor
      // must preserve the trainer's existing reusable sections when applying.
      proposed.savedSections = [];
      proposed.pages
        .find((p) => p.slug === "")
        .sections.find((s) => s.moduleId === "hero").content.title =
        `Suggested starter welcome ${run}`;
      let calls = 0;
      await page.route("**/api/v1/tenant/site/starter/options", (route) =>
        route.fulfill({
          json: { available: true, model: "Website assistant" },
        }),
      );
      await page.route("**/api/v1/tenant/site/starter", (route) => {
        calls++;
        const body = route.request().postDataJSON();
        assert.match(body.requestId, /^[0-9a-f-]{36}$/);
        assert.equal(body.version, initial.version);
        return route.fulfill({
          json: {
            builder: proposed,
            source: "ai",
            cached: false,
            requestId: body.requestId,
          },
        });
      });
      await page
        .getByRole("button", { name: "AI starter", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "A head start, shaped around you.",
      });
      await dialog
        .getByLabel(/^Describe your coaching website/)
        .fill(
          "A calm coaching website for busy professionals who want a consistent training routine.",
        );
      await dialog
        .getByRole("button", { name: "Generate starter", exact: true })
        .click();
      await expect(
        dialog.getByText("Your suggested website", { exact: true }),
      ).toBeVisible();
      assert.equal(calls, 1);
      assert.equal(
        (await api("/tenant/site")).version,
        initial.version,
        "proposal preview must not save",
      );
      assert.equal((await publicSite()).publishedRevision, baselineRevision);
      const applied = await mutate("/tenant/site", "PUT", () =>
        dialog
          .getByRole("button", { name: "Use this starter", exact: true })
          .click(),
      );
      assert.deepEqual(
        applied.draft.builder.pages.map((p) =>
          p.sections.map((s) => [s.moduleId, s.variant]),
        ),
        proposed.pages.map((p) =>
          p.sections.map((s) => [s.moduleId, s.variant]),
        ),
      );
      assert.deepEqual(
        applied.draft.builder.savedSections,
        initial.draft.builder.savedSections,
      );
      assert.equal((await publicSite()).publishedRevision, baselineRevision);
      const undone = await mutate("/tenant/site", "PUT", () =>
        page.getByRole("button", { name: "Undo", exact: true }).click(),
      );
      assert.equal(
        undone.draft.builder.pages[0].sections.find(
          (s) => s.moduleId === "hero",
        ).content.title,
        publishedTitle,
      );
      await saved();
    },
  );

  let firstBuilderRevision;
  await check(
    "publish renders the draft and owned media on desktop and phone",
    async () => {
      await capture(page, "editor-1440");
      await publish();
      const live = await publicSite();
      firstBuilderRevision = live.publishedRevision;
      assert.notEqual(firstBuilderRevision, baselineRevision);
      assert.equal(
        (await publicPage.request.get(base + mediaUrl)).status(),
        200,
      );
      await publicPage.goto(base + "/coach/alex-morgan");
      await expect(
        publicPage.getByRole("heading", { name: publishedTitle, exact: true }),
      ).toBeVisible();
      await expect(
        publicPage.getByAltText("Synthetic coaching studio photograph"),
      ).toBeVisible();
      await noOverflow(publicPage, "published desktop");
      await capture(publicPage, "public-desktop");
      await publicPage.setViewportSize({ width: 390, height: 844 });
      await noOverflow(publicPage, "published phone");
      await expect(
        publicPage.getByRole("heading", { name: publishedTitle, exact: true }),
      ).toBeVisible();
      await capture(publicPage, "public-phone");
    },
  );

  await check(
    "renamed public page redirects and renders its own SEO without a menu entry",
    async () => {
      const redirected = await publicPage.request.get(
        base + `/coach/alex-morgan/${oldSlug}`,
        { maxRedirects: 0 },
      );
      assert.equal(redirected.status(), 308);
      assert.ok(
        redirected.headers().location.endsWith(`/coach/alex-morgan/${newSlug}`),
      );
      await publicPage.goto(base + `/coach/alex-morgan/${oldSlug}`);
      await expect(publicPage).toHaveURL(
        base + `/coach/alex-morgan/${newSlug}`,
      );
      await expect(
        publicPage.getByRole("heading", { name: pageTitle, exact: true }),
      ).toBeVisible();
      await expect(publicPage).toHaveTitle(seoTitle);
      await expect(
        publicPage.locator('meta[name="description"]'),
      ).toHaveAttribute(
        "content",
        "Our approach combines consistent practice with thoughtful coaching.",
      );
      await expect(publicPage.locator('meta[name="robots"]')).toHaveAttribute(
        "content",
        /noindex/,
      );
      await expect(publicPage.locator('link[rel="canonical"]')).toHaveAttribute(
        "href",
        base + `/coach/alex-morgan/${newSlug}`,
      );
      assert.equal(
        await publicPage.locator(`.sb-header a[href$="/${newSlug}"]`).count(),
        0,
      );
      await noOverflow(publicPage, "custom phone page");
    },
  );

  await check(
    "publication history restores a private draft before an explicit republish",
    async () => {
      await page
        .getByLabel("Current page", { exact: true })
        .selectOption({ label: "Home" });
      await heroSection().click();
      const secondTitle = `A later published welcome ${run}`;
      await mutate("/tenant/site", "PUT", () =>
        page
          .getByRole("textbox", { name: "Title", exact: true })
          .fill(secondTitle),
      );
      await publish();
      const secondRevision = (await publicSite()).publishedRevision;
      await page
        .getByRole("button", { name: "Published versions", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "Published versions",
        exact: true,
      });
      await expect(dialog.locator(".sbe-history-list > button")).toHaveCount(3);
      await dialog.locator(".sbe-history-list > button").nth(1).click();
      await mutate("/tenant/site/restore", "POST", () =>
        dialog
          .getByRole("button", { name: "Restore to draft", exact: true })
          .click(),
      );
      assert.equal((await publicSite()).publishedRevision, secondRevision);
      const restored = await api("/tenant/site");
      assert.equal(
        restored.draft.builder.pages[0].sections.find(
          (s) => s.moduleId === "hero",
        ).content.title,
        publishedTitle,
      );
      await publish();
      assert.equal(
        (await publicSite()).publishedRevision,
        firstBuilderRevision,
      );
    },
  );

  await check(
    "a stale editing window preserves local changes and never overwrites saved work",
    async () => {
      const latest = await api("/tenant/site");
      const remote = structuredClone(latest.draft);
      remote.builder.footer.text = `A change from another editor ${run}`;
      await api("/tenant/site", "PUT", {
        version: latest.version,
        site: remote,
      });
      await heroSection().click();
      const conflictResponse = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/v1/tenant/site" &&
          response.request().method() === "PUT",
      );
      await page
        .getByRole("textbox", { name: "Title", exact: true })
        .fill(`Unsaved conflicting welcome ${run}`);
      assert.equal((await conflictResponse).status(), 409);
      await expect(
        page.getByText(/This website was updated in another window/),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Download my draft", exact: true }),
      ).toBeVisible();
      assert.equal(
        (await api("/tenant/site")).draft.builder.footer.text,
        remote.builder.footer.text,
      );
      assert.equal(
        (await publicSite()).publishedRevision,
        firstBuilderRevision,
      );
      await page
        .getByRole("button", { name: "Load saved draft", exact: true })
        .click();
      await page.getByRole("dialog", { name: "Confirm action" }).getByRole("button", { name: "Continue", exact: true }).click();
      await saved();
      await expect(
        heroSection().locator('[data-builder-field="title"]'),
      ).toHaveText(publishedTitle);
    },
  );

  await check(
    "desktop canvas has phone preview controls and the editor is unavailable on phones",
    async () => {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await noOverflow(page, "desktop editor at 1920");
      await capture(page, "editor-1920");
      await page
        .getByRole("button", { name: "Phone preview", exact: true })
        .click();
      await expect(page.locator(".sbe-canvas-frame")).toHaveAttribute(
        "data-viewport",
        "mobile",
      );
      await noOverflow(page, "phone canvas on a desktop");
      let phoneEditorRequests = 0;
      page.on("request", (request) => {
        if (
          /\/api\/v1\/tenant\/site(?:\/preview)?$/.test(
            new URL(request.url()).pathname,
          )
        )
          phoneEditorRequests++;
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.reload();
      await expect(
        page.getByTestId("site-builder-desktop-required"),
      ).toBeVisible();
      await expect(page.getByTestId("site-builder-editor")).toHaveCount(0);
      assert.equal(
        phoneEditorRequests,
        0,
        "a phone must not mount or load the editor",
      );
      await noOverflow(page, "desktop-only explanation on a phone");
      await capture(page, "desktop-required-phone");
    },
  );

  assert.deepEqual(report.pageErrors, [], "uncaught browser errors");
  assert.deepEqual(report.failedRequests, [], "failed same-origin requests");
  report.status = "passed";
  console.log(
    `Builder browser check passed: ${report.checks.length} journeys.`,
  );
} catch (error) {
  report.status = "failed";
  report.failure = String(error?.stack ?? error);
  await capture(page, "failure").catch(() => {});
  throw error;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(
    "test-results/site-builder-check.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  await browser.close();
}
