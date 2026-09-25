import { test } from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";
import {
  brandSchema,
  brandDesignSchema,
  brandImageSchema,
  brandCssVariables,
  brandContrast,
  brandPresets,
  brandSections,
  resolveBrandDesign,
} from "@trainer/contracts";

const identity = {
  name: "Coach Noura",
  bio: "Sustainable strength for real life.",
  category: "Strength",
  accent: "#244c46",
  headline: "Build strength. Keep your life.",
  timezone: "Asia/Dubai" as const,
};

test("legacy branding stays valid while structured design rejects arbitrary styling and hidden sections", () => {
  assert.equal(brandSchema.safeParse(identity).success, true);
  assert.equal(
    brandSchema.safeParse({ ...identity, css: "body{display:none}" }).success,
    false,
  );
  assert.equal(
    brandDesignSchema.safeParse({ fontUrl: "https://example.com/font.woff" })
      .success,
    false,
  );
  assert.equal(
    brandDesignSchema.safeParse({ primary: "red;display:none" }).success,
    false,
  );
  assert.equal(
    brandDesignSchema.safeParse({ typography: "Comic Sans" }).success,
    false,
  );
  assert.equal(
    brandDesignSchema.safeParse({
      sectionOrder: ["program", "program", "coach", "progress"],
    }).success,
    false,
  );
  assert.equal(
    brandDesignSchema.safeParse({ sectionOrder: ["program"] }).success,
    false,
  );
  assert.equal(
    brandDesignSchema.safeParse({ dashboardFocus: "coach" }).success,
    false,
  );
  assert.equal(
    brandDesignSchema.safeParse({
      dashboardFocus: "coach",
      sectionOrder: ["coach", "nutrition", "progress", "program"],
    }).success,
    true,
  );
  assert.equal(
    brandDesignSchema.safeParse({ welcome: "a".repeat(321) }).success,
    false,
  );
  assert.equal(
    brandDesignSchema.safeParse({ programLabel: "" }).success,
    false,
  );
  assert.equal(
    brandSchema.safeParse({ ...identity, brandVersion: 999 }).success,
    false,
  );
});

test("brand media permits public HTTPS images and rejects unsafe or credential-bearing URLs", () => {
  for (const url of [
    "",
    "https://cdn.example.com/coach/photo.jpg",
    "https://images.example.com/logo.svg",
  ])
    assert.equal(brandImageSchema.safeParse(url).success, true, url);
  for (const url of [
    "javascript:alert(1)",
    "data:image/png;base64,AAAA",
    "http://example.com/photo.jpg",
    "//example.com/photo.jpg",
    "https://user:password@example.com/a.jpg",
    "https://example.com/a.jpg?token=private",
    "https://example.com/a.jpg#private",
    "https://localhost/image.png",
    "https://private.local/image.png",
    "https://example.internal/a.png",
    "https://127.0.0.1/image.png",
    "https://169.254.169.254/metadata",
    "https://2130706433/a.png",
    "https://[::1]/a.png",
    "https://cdn.example.com:9443/a.png",
    "https://example.com/\\evil",
    "https://example.com/" + "a".repeat(1024),
  ])
    assert.equal(brandImageSchema.safeParse(url).success, false, url);
});

test("theme normalization is safe for existing tenants and malformed saved data", () => {
  assert.equal(resolveBrandDesign({ accent: "#123456" }).primary, "#123456");
  assert.equal(
    resolveBrandDesign({ accent: "url(javascript:alert(1))" }).primary,
    "#244c46",
  );
  assert.deepEqual(
    resolveBrandDesign({ design: { primary: "red" } }).sectionOrder,
    [...brandSections],
  );
  assert.deepEqual(resolveBrandDesign(null), resolveBrandDesign(undefined));
  const properties = brandCssVariables({
    design: { typography: "<script>", primary: "red" },
  });
  assert.equal(
    Object.values(properties).some(
      (v) => v.includes("<") || v.includes("javascript") || v.includes("url("),
    ),
    false,
  );
});

test("every curated and custom color keeps essential text at least 4.5:1", () => {
  for (const preset of brandPresets) {
    const design = brandDesignSchema.parse({
      preset: preset.id,
      primary: preset.primary,
      accent: preset.accent,
      surface: preset.surface,
      typography: preset.typography,
      corners: preset.corners,
    });
    const vars = brandCssVariables({ design });
    assert.ok(
      brandContrast(vars["--ink"], vars["--paper"]) >= 4.5,
      preset.name,
    );
    assert.ok(
      brandContrast(vars["--brand-on-primary"], vars["--brand-primary"]) >= 4.5,
      preset.name,
    );
  }
  const colors = [
    "#000000",
    "#ffffff",
    "#777777",
    "#767676",
    "#747474",
    "#808080",
    "#ffff00",
    "#ff00ff",
    "#00ffff",
    "#ff0000",
    "#00ff00",
    "#0000ff",
    "#332244",
  ];
  for (const color of colors) {
    const vars = brandCssVariables({
      design: brandDesignSchema.parse({
        surface: color,
        primary: color,
        accent: color,
      }),
    });
    for (const [foreground, background] of [
      ["--ink", "--paper"],
      ["--ink", "--white"],
      ["--muted", "--paper"],
      ["--muted", "--white"],
      ["--brand-link", "--paper"],
      ["--brand-link", "--white"],
      ["--brand-on-primary", "--brand-primary"],
      ["--brand-on-accent", "--brand-accent"],
      ["--brand-on-tint", "--brand-tint"],
    ])
      assert.ok(
        brandContrast(vars[foreground], vars[background]) >= 4.5,
        `${color} ${foreground} on ${background}`,
      );
  }
});

test("saved designs survive legacy edits, reject stale updates, and stay tenant-scoped", async () => {
  const db = await createDatabase({ memory: true });
  const app = await buildApp({ db, testing: true });
  async function request(
    path: string,
    method: any = "GET",
    body?: any,
    cookie?: string,
  ) {
    return app.inject({
      url: "/api/v1" + path,
      method,
      headers: {
        origin: "http://localhost:3000",
        ...(cookie ? { cookie } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      payload: body,
    });
  }
  async function register(slug: string) {
    const response = await request("/auth/register", "POST", {
      name: identity.name,
      slug,
      email: `${slug}@example.test`,
      password: "DesignTest2026!",
      accepted: true,
    });
    assert.equal(response.statusCode, 201, response.body);
    return String(response.headers["set-cookie"]).split(";")[0];
  }
  try {
    const first = await register("design-one"),
      second = await register("design-two");
    const design = brandDesignSchema.parse({
      preset: "clay",
      primary: "#733f32",
      tagline: "Strength that fits your life",
      welcome: "Let’s build the next chapter, together.",
      programLabel: "My strength practice",
      dashboardFocus: "coach",
      sectionOrder: ["coach", "program", "nutrition", "progress"],
    });
    const saved = await request(
      "/tenant/brand",
      "PUT",
      { ...identity, design, expectedVersion: 0 },
      first,
    );
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(saved.json().brandVersion, 1);
    assert.deepEqual(saved.json().theme.design, design);
    assert.equal(saved.json().theme.expectedVersion, undefined);
    const current = await request("/bootstrap", "GET", undefined, first);
    assert.equal(
      current.json().tenant.theme.design.programLabel,
      "My strength practice",
    );
    assert.equal(
      (await request("/bootstrap", "GET", undefined, second)).json().tenant
        .theme.design,
      undefined,
    );
    const stale = await request(
      "/tenant/brand",
      "PUT",
      {
        ...identity,
        design: { ...design, welcome: "Stale change" },
        expectedVersion: 0,
      },
      first,
    );
    assert.equal(stale.statusCode, 409, stale.body);
    const legacy = await request(
      "/tenant/brand",
      "PUT",
      { ...identity, headline: "A new introduction" },
      first,
    );
    assert.equal(legacy.statusCode, 200, legacy.body);
    assert.deepEqual(legacy.json().theme.design, design);
    assert.equal(legacy.json().brandVersion, 2);
    const unsafe = await request(
      "/tenant/brand",
      "PUT",
      {
        ...identity,
        design: { ...design, photoUrl: "javascript:alert(1)" },
        expectedVersion: 2,
      },
      first,
    );
    assert.equal(unsafe.statusCode, 400, unsafe.body);
    const invite = await request(
      "/invitations",
      "POST",
      { email: "design-client@example.test", role: "subscriber" },
      first,
    );
    const token = invite.json().url.split("/").pop();
    const accepted = await request("/invitations/accept", "POST", {
      token,
      name: "Design Client",
      email: "design-client@example.test",
      password: "DesignClient2026!",
    });
    assert.equal(accepted.statusCode, 200, accepted.body);
    const subscriber = String(accepted.headers["set-cookie"]).split(";")[0];
    assert.equal(
      (
        await request(
          "/tenant/brand",
          "PUT",
          { ...identity, design, expectedVersion: 2 },
          subscriber,
        )
      ).statusCode,
      403,
    );
    assert.equal(
      (await request("/bootstrap", "GET", undefined, subscriber)).json().tenant
        .theme.design.programLabel,
      design.programLabel,
    );
    const tenantId = current.json().tenant.id;
    await db.system((tx) =>
      tx.query("UPDATE tenants SET published=true WHERE id=$1", [tenantId]),
    );
    const storefront = await request("/public/trainers/design-one");
    assert.equal(storefront.statusCode, 200, storefront.body);
    assert.deepEqual(storefront.json().trainer.theme.design, design);
    const events = await db.tenant(current.json().user, (tx) =>
      tx.query("SELECT name FROM events WHERE name='tenant.brand_updated'"),
    );
    assert.equal(events.length, 2);
  } finally {
    await app.close();
    await db.close();
  }
});
