// Synthetic UI contract journey. Checkout requests are intercepted; no provider is called.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
export async function checkMembershipCommerce({ browser, base }) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const login = await context.request.post(base + "/api/v1/auth/login", {
    headers: { origin: base },
    data: {
      email: "sam.taylor@example.test",
      password: process.env.DEMO_PASSWORD ?? "TrainerDemo2026!",
    },
  });
  assert.equal(login.ok(), true, await login.text());
  const page = await context.newPage(),
    errors = [],
    posted = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let paid = false;
  const language = async (locale) => {
    const p = await (
      await context.request.get(base + "/api/v1/notifications/preferences")
    ).json();
    const r = await context.request.put(
      base + "/api/v1/notifications/preferences",
      {
        headers: { origin: base },
        data: { ...p, data: { ...p.data, language: locale } },
      },
    );
    assert.equal(r.ok(), true, await r.text());
  };
  await page.route("**/api/v1/bootstrap", async (route) => {
    const response = await route.fetch(),
      data = await response.json();
    if (!paid) data.subscriptions = [];
    data.records = data.records.filter((r) => r.kind !== "product");
    data.records.push({
      id: "aa4d0a89-543d-4501-b3ba-07210305e219",
      kind: "product",
      status: "published",
      data: {
        name: "Synthetic training plan",
        priceMinor: 19900,
        billing: "monthly",
        tier: "workout",
        modules: ["training"],
      },
    });
    await route.fulfill({ response, json: data });
  });
  await page.route("**/api/v1/membership/passes", async (route) => {
    if (route.request().method() === "POST") {
      posted.push(route.request().postDataJSON());
      return route.fulfill({ json: { intentId: "synthetic-pass" } });
    }
    return route.fulfill({
      json: {
        paidTraining: paid,
        passes: {
          nutrition: { available: true, ready: true, priceMinor: 15000 },
          voice: { available: true, ready: true, priceMinor: 10000 },
        },
      },
    });
  });
  await page.route("**/api/v1/payments/checkout", async (route) => {
    posted.push(route.request().postDataJSON());
    await route.fulfill({ json: { intentId: "synthetic-pack" } });
  });
  await mkdir("test-results", { recursive: true });
  try {
    for (const locale of ["en", "ar"]) {
      await language(locale);
      await page.goto(base + "/app/membership?lang=" + locale);
      await page.waitForFunction(
        (lang) => document.documentElement.lang === lang,
        locale,
      );
      const select = page.locator(".membership-offers select");
      await select.waitFor();
      const decline = page.getByRole("button", {
        name: locale === "ar" ? "لا، شكراً" : "No thanks",
        exact: true,
      });
      await decline
        .waitFor({ state: "visible", timeout: 2500 })
        .then(() => decline.click())
        .catch(() => {});
      await select.selectOption("6");
      const offer = page.locator(".membership-offers li").first(),
        button = offer.getByRole("button");
      assert.equal(
        await button.isDisabled(),
        true,
        "prepaid terms require acknowledgement",
      );
      assert.match(await offer.innerText(), /1,074\.60/);
      await offer.getByRole("checkbox").check();
      await button.click();
      assert.equal(posted.at(-1).prepayMonths, 6);
      assert.equal(
        posted.at(-1).acceptedPolicyVersion,
        "membership-2026-10-14",
      );
      await select.selectOption("12");
      assert.equal(await button.isDisabled(), true);
      assert.match(await offer.innerText(), /1,671\.60/);
      for (const width of [390, 1280]) {
        await page.setViewportSize({ width, height: 950 });
        await page.evaluate(() => scrollTo(0, 0));
        assert.equal(
          await page
            .locator(".prepaid-terms")
            .evaluate((el) => getComputedStyle(el).display),
          "grid",
          "terms have a readable vertical layout",
        );
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth + 1,
          ),
          false,
          "purchase terms fit the screen",
        );
        await page.screenshot({
          path: `test-results/membership-pack-${locale}-${width}.png`,
          fullPage: true,
        });
      }
    }
    paid = true;
    await language("en");
    await page.goto(base + "/app/membership?lang=en");
    const section = page.locator("section", {
      has: page.locator("#module-passes-title"),
    });
    await section.getByRole("checkbox").check();
    await section
      .getByRole("button", { name: "Buy pass", exact: true })
      .first()
      .click();
    assert.equal(posted.at(-1).module, "nutrition");
    await section
      .getByRole("button", { name: "Buy pass", exact: true })
      .last()
      .click();
    assert.equal(posted.at(-1).module, "voice");
    await page.setViewportSize({ width: 390, height: 950 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
    await page.screenshot({
      path: "test-results/membership-passes-en-390.png",
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    console.log(
      "Commerce browser journey passed: EN/AR, phone/desktop, prepaid consent and totals, nutrition/voice pass payloads; no charges.",
    );
  } finally {
    await context.close();
  }
}
