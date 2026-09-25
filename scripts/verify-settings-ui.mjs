import { createHmac, randomUUID } from "node:crypto";

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

/** Injects a single local bootstrap failure per device. Retry must use the real
 * API with the same authenticated session, without navigating to sign-in. */
export async function verifyBootstrapRecovery({ base, page, onRetryView }) {
  ensure(
    ["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname),
    "Bootstrap fault injection may only target a local synthetic app",
  );
  const route = "/admin/settings";
  for (const [device, viewport] of [
    ["desktop", { width: 1440, height: 1050 }],
    ["mobile", { width: 390, height: 844 }],
  ]) {
    await page.setViewportSize(viewport);
    let injected = 0;
    await page.route(
      base + "/api/v1/bootstrap",
      async (request) => {
        injected++;
        await request.fulfill({
          status: 429,
          contentType: "application/json",
          body: JSON.stringify({ error: "Synthetic temporary rate limit" }),
        });
      },
      { times: 1 },
    );
    await page.goto(base + route, { waitUntil: "networkidle" });
    await page
      .getByRole("heading", {
        name: "Your workspace is temporarily unavailable.",
        exact: true,
      })
      .waitFor();
    ensure(injected === 1, "Expected exactly one synthetic bootstrap failure");
    ensure(
      new URL(page.url()).pathname === route,
      "Temporary bootstrap failure redirected the user",
    );
    ensure(
      (await page.getByRole("alert").innerText()) ===
        "Too many requests. Wait a moment, then retry.",
      "Temporary bootstrap error explanation is missing",
    );
    if (onRetryView) await onRetryView(page, { route, device });
    const recovered = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/v1/bootstrap" &&
        response.status() === 200,
    );
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await recovered;
    await page
      .getByRole("heading", { name: "Platform settings.", exact: true })
      .waitFor();
    ensure(
      new URL(page.url()).pathname === route,
      "Retry failed to restore the requested workspace route",
    );
    ensure(
      (await page
        .getByRole("button", { name: "Retry", exact: true })
        .count()) === 0,
      "Recovered workspace still shows its transient error",
    );
  }
  return {
    temporaryBootstrapFailurePreservesRoute: true,
    bootstrapRetryRecoversRealSessionDesktopAndMobile: true,
    syntheticBootstrapFailures: 2,
  };
}

export async function prepareScreenshotFixtures() {
  ensure(
    process.env.NODE_ENV === "development" &&
      !process.env.DATABASE_URL &&
      /\/\.data\/app-views-[a-f0-9]+$/.test(process.env.PGLITE_DATA_DIR ?? ""),
    "Public screenshot fixture requires its isolated embedded database",
  );
  const { createDatabase } = await import("@trainer/db");
  const db = await createDatabase();
  try {
    await db.system(async (tx) => {
      const [owner] = await tx.query(
        "SELECT m.tenant_id FROM memberships m JOIN users u ON u.id=m.user_id WHERE u.email='coach@example.test' AND m.role='owner'",
      );
      ensure(owner, "Synthetic coach fixture is missing");
      // This fixture exercises the public renderer only. It is not production
      // publication or evidence that the business/provider launch gates passed.
      await tx.query(
        "UPDATE tenants SET published=true WHERE id=$1 AND slug='alex-morgan'",
        [owner.tenant_id],
      );
      await tx.query(
        "UPDATE records SET status='active',data=data || '{\"synthetic\":true}'::jsonb WHERE tenant_id=$1 AND kind='product'",
        [owner.tenant_id],
      );
      const [subscriber] = await tx.query(
        "SELECT id FROM users WHERE email='sam.taylor@example.test'",
      );
      ensure(subscriber, "Synthetic subscriber is missing");
      await tx.query(
        "INSERT INTO consent_records(id,tenant_id,user_id,document_type,document_version,granted) VALUES($1,$2,$3,'nutrition_photo','synthetic-screenshot-only',true)",
        [randomUUID(), owner.tenant_id, subscriber.id],
      );
      const photo = {
        synthetic: true,
        source: "synthetic_screenshot_fixture",
        promptVersion: "fixture-only",
        model: "no-model-call",
        estimate: {
          items: [
            {
              name: "Synthetic chicken and rice",
              portion: "One bowl, approximately 350 g",
              amount: 350,
              unit: "g",
              kcal: 520,
              protein: 38,
              carbohydrate: 58,
              fat: 15,
              preparation: "cooked",
              uncertainty:
                "Synthetic UI fixture. No image analysis was performed.",
            },
          ],
          questions: ["Was any cooking oil or dressing added?"],
          notes:
            "Synthetic photo-estimate fixture for interface verification. No photo was sent to a provider.",
        },
      };
      const barcode = {
        synthetic: true,
        source: "synthetic_screenshot_fixture",
        product: {
          code: "4006381333931",
          name: "Synthetic oat drink",
          brand: "UI fixture · no provider lookup",
          servingLabel: "250 ml",
          ingredients:
            "Synthetic example: water, oats. Check your real package.",
          allergens: null,
          nutrientsPer100: { kcal: 48, protein: 1, carbohydrate: 7, fat: 1.5 },
          preparation: "as_sold",
          source: {
            provider: "Open Food Facts",
            url: "https://example.invalid/synthetic-label-fixture",
            retrievedAt: new Date().toISOString(),
            revision: "synthetic",
            licence: "Synthetic fixture; no database material retrieved",
            basis: "Synthetic label example for UI verification",
          },
        },
      };
      for (const [kind, data] of [
        ["photo", photo],
        ["barcode", barcode],
      ])
        await tx.query(
          "INSERT INTO meal_captures(id,tenant_id,user_id,request_key,fingerprint,kind,status,data) VALUES($1,$2,$3,$4,'synthetic-ui-fixture',$5,'draft',$6)",
          [
            randomUUID(),
            owner.tenant_id,
            subscriber.id,
            randomUUID(),
            kind,
            JSON.stringify(data),
          ],
        );
    });
  } finally {
    await db.close();
  }
}
function totp(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const character of secret.replace(/=+$/, "").toUpperCase()) {
    const index = alphabet.indexOf(character);
    ensure(index >= 0, "Invalid fixture authenticator encoding");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8)
    bytes.push(parseInt(bits.slice(index, index + 8), 2));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const hash = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const offset = hash[19] & 15;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(
    6,
    "0",
  );
}

/** Runs against a newly seeded, loopback-only development app. No screenshots
 * are taken while credentials or authenticator enrollment data are in use. */
export async function verifySettingsUi({
  base,
  trainer,
  subscriber,
  password,
  onVerifiedView,
}) {
  const { page, ctx } = trainer;
  const request = async (path, method = "GET", data) => {
    const response = await ctx.request.fetch(base + "/api/v1" + path, {
      method,
      headers: { origin: base },
      ...(data === undefined ? {} : { data }),
    });
    return { response, payload: await response.json() };
  };
  let result = await request("/auth/security");
  ensure(
    result.response.ok() && result.payload.mfaConfigured,
    "Fixture security encryption is unavailable",
  );
  ensure(
    !result.payload.mfaEnabled,
    "Use a fresh synthetic fixture database for screenshot verification",
  );
  result = await request("/auth/mfa/enroll", "POST", { password });
  ensure(
    result.response.ok() && result.payload.secret,
    "Fixture authenticator enrollment failed",
  );
  const code = totp(result.payload.secret);
  result = await request("/auth/mfa/confirm", "POST", { code });
  ensure(result.response.ok(), "Fixture authenticator verification failed");

  // A subscriber cannot inspect platform keys or write another role's settings.
  const denied = await subscriber.ctx.request.get(
    base + "/api/v1/admin/settings",
  );
  ensure(
    denied.status() === 403,
    "Subscriber unexpectedly read superadmin settings",
  );
  const initial = await request("/admin/settings");
  ensure(
    initial.response.ok() && Array.isArray(initial.payload.integrations),
    "Superadmin settings catalog is unavailable",
  );
  ensure(
    initial.payload.integrations.every((item) =>
      Object.values(item.secrets).every((value) => typeof value === "boolean"),
    ),
    "Catalog exposes non-boolean credential metadata",
  );

  const fixtureKey = "synthetic-settings-verification-only-not-a-provider-key";
  await page.goto(base + "/admin/integrations/model", {
    waitUntil: "networkidle",
  });
  for (const [label, value] of [
    ["API base URL", "https://model.example.invalid/v1"],
    ["Model ID", "synthetic-coach-model"],
    ["Input price / million tokens (USD)", "1"],
    ["Output price / million tokens (USD)", "2"],
    ["Reviewed price version", "synthetic-screenshot-fixture"],
    ["Maximum daily calls per workspace", "100"],
  ])
    await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByLabel("API key", { exact: true }).fill(fixtureKey);
  async function save() {
    const pending = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/v1/admin/settings/model" &&
        response.request().method() === "PUT",
    );
    await page
      .getByRole("button", { name: "Save configuration", exact: true })
      .click();
    const response = await pending;
    ensure(response.ok(), `Settings UI save failed (${response.status()})`);
    ensure(
      !(await response.text()).includes(fixtureKey),
      "Settings save response exposed a credential",
    );
    await page.waitForLoadState("networkidle");
  }
  await save();
  await page.reload({ waitUntil: "networkidle" });
  ensure(
    (await page.getByLabel("Model ID", { exact: true }).inputValue()) ===
      "synthetic-coach-model",
    "Model settings did not survive reload",
  );
  ensure(
    (await page.getByLabel("API key", { exact: true }).inputValue()) === "",
    "Saved credential was repopulated into a form",
  );
  let catalog = await request("/admin/settings");
  let model = catalog.payload.integrations.find((item) => item.id === "model");
  ensure(
    model.secrets.MODEL_API_KEY === true && !model.active,
    "Unverified saved integration must retain only credential presence and stay inactive",
  );
  ensure(
    !JSON.stringify(catalog.payload).includes(fixtureKey),
    "Catalog or audit exposed a credential",
  );
  await onVerifiedView?.("Saved credentials · value hidden");
  await page.getByLabel("Remove saved API key", { exact: true }).check();
  await save();
  await page.reload({ waitUntil: "networkidle" });
  catalog = await request("/admin/settings");
  model = catalog.payload.integrations.find((item) => item.id === "model");
  ensure(
    model.secrets.MODEL_API_KEY === false && !model.active,
    "Explicit credential clear did not persist",
  );
  ensure(
    catalog.payload.audit.filter(
      (item) => item.integrationId === "model" && item.action === "saved",
    ).length >= 2,
    "Settings changes did not produce audit entries",
  );
  ensure(
    !(await page.locator("body").innerText()).includes(fixtureKey),
    "Credential text is visible after clear",
  );
  await onVerifiedView?.("Credentials cleared");

  await page.goto(base + "/trainer/design", { waitUntil: "networkidle" });
  await onVerifiedView?.("Design studio · initial view", "/trainer/design");
  const welcome =
    "A little stronger, a little more you. Welcome to your coaching space.";
  await page.getByLabel(/^Welcome message/).fill(welcome);
  await page
    .getByLabel(/^Your tagline/)
    .fill("Strength for your everyday life.");
  await page.getByRole("tab", { name: "Style", exact: true }).click();
  await page
    .locator(".design-presets button")
    .filter({ hasText: "Clay" })
    .click();
  await page.getByLabel(/^Typography/).selectOption("editorial");
  await page.getByRole("tab", { name: "Home layout", exact: true }).click();
  await page.getByLabel(/^Program navigation label/).fill("Your strength plan");
  await page.getByLabel(/^Dashboard focus/).selectOption("nutrition");
  const designSaved = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/v1/tenant/brand" &&
      response.request().method() === "PUT",
  );
  await page.getByRole("button", { name: "Save design", exact: true }).click();
  ensure((await designSaved).ok(), "Trainer design save failed");
  await page.reload({ waitUntil: "networkidle" });
  ensure(
    (await page.getByLabel(/^Welcome message/).inputValue()) === welcome,
    "Trainer welcome message did not survive reload",
  );
  await page.getByRole("tab", { name: "Style", exact: true }).click();
  ensure(
    (await page.getByLabel(/^Typography/).inputValue()) === "editorial",
    "Trainer typography did not survive reload",
  );
  await page.getByRole("tab", { name: "Home layout", exact: true }).click();
  ensure(
    (await page.getByLabel(/^Program navigation label/).inputValue()) ===
      "Your strength plan",
    "Trainer navigation label did not survive reload",
  );
  ensure(
    (await page.getByLabel(/^Dashboard focus/).inputValue()) === "nutrition",
    "Trainer home focus did not survive reload",
  );
  const savedBrand = await request("/bootstrap");
  ensure(
    savedBrand.payload.tenant.theme.design.sectionOrder[0] === "nutrition",
    "Home section order did not persist",
  );
  await subscriber.page.goto(base + "/app", { waitUntil: "networkidle" });
  await subscriber.page.getByText(welcome, { exact: true }).waitFor();
  await subscriber.page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Your strength plan", exact: true })
    .waitFor({ state: "attached" });
  const primary = await subscriber.page
    .locator(".trainer-theme")
    .first()
    .evaluate((element) =>
      getComputedStyle(element).getPropertyValue("--brand-primary").trim(),
    );
  ensure(
    primary.toLowerCase() ===
      savedBrand.payload.tenant.theme.design.primary.toLowerCase(),
    "Client app does not use the persisted trainer palette",
  );
  // Verify another role cannot change the brand, regardless of client-side UI.
  const forbiddenBrand = await subscriber.ctx.request.put(
    base + "/api/v1/tenant/brand",
    {
      headers: { origin: base },
      data: {
        name: "Unauthorized change",
        headline: "Synthetic forbidden attempt",
      },
    },
  );
  ensure(
    forbiddenBrand.status() === 403,
    "Subscriber unexpectedly changed the trainer brand",
  );
  return {
    synthetic: true,
    realLocalApi: true,
    localAuthenticatorStepUp: true,
    subscriberSettingsDenied: true,
    settingsSavedAndReloaded: true,
    secretsNeverReturned: true,
    credentialClearPersisted: true,
    unverifiedProviderStayedInactive: true,
    auditRecorded: true,
    brandSavedAndReloaded: true,
    clientWelcomeApplied: true,
    clientNavigationApplied: true,
    clientPaletteApplied: true,
    homeFocusPersisted: true,
    subscriberBrandWriteDenied: true,
    thirdPartyCalls: 0,
  };
}
