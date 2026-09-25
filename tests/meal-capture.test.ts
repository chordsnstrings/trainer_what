import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import {
  createDatabase,
  putRecord,
  type Actor,
  type Database,
} from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";
import { tokenHash } from "../apps/api/src/auth.ts";
import {
  eraseMealCaptures,
  exportMealCaptures,
  purgeExpiredMealCaptures,
  sanitizeMealPhoto,
} from "../apps/api/src/meal-capture.ts";
import {
  capturedFoodSchema,
  captureTotals,
  lookupBarcode,
  normalizeGtin,
} from "../packages/providers/src/food.ts";
import {
  nutritionSummary,
  localDate,
} from "../packages/domain/src/nutrition.ts";
import { fixtureProfile } from "./nutrition-fixtures.ts";

type User = Actor & { cookie: string };
let db: Database,
  app: Awaited<ReturnType<typeof buildApp>>,
  owner: User,
  subscriber: User,
  neighbour: User,
  foreign: User,
  photo: string;
let calls = 0,
  lookupCalls = 0,
  invalidModel = false,
  missing = false,
  wrongCode = false,
  waitForModel: undefined | (() => Promise<void>);
const originalFetch = globalThis.fetch,
  origin = "http://localhost:3000";
const settings = {
  MODEL_BASE_URL: "https://capture-fixture.invalid/v1",
  MODEL_API_KEY: "capture-fixture-key",
  MODEL_NAME: "capture-fixture",
  MODEL_PRICE_VERSION: "fixture-v1",
  MODEL_INPUT_USD_PER_MILLION: "1",
  MODEL_OUTPUT_USD_PER_MILLION: "2",
  MODEL_MAX_DAILY_CALLS: "100",
  MODEL_VISION_ENABLED: "true",
  MEAL_PHOTOS_ENABLED: "true",
  FOOD_LOOKUP_ENABLED: "true",
};
const oldSettings = Object.fromEntries(
  Object.keys(settings).map((k) => [k, process.env[k]]),
);
let requestNumber = 0;
const food = {
  name: "Rice bowl",
  portion: "One small bowl",
  amount: 150,
  unit: "g" as const,
  kcal: 195,
  protein: 4,
  carbohydrate: 42,
  fat: 2,
  preparation: "cooked" as const,
  uncertainty: "Photo estimate; oils and scale are unknown",
};
async function request(
  path: string,
  method: any = "GET",
  payload?: any,
  as: User | null = subscriber,
) {
  return app.inject({
    method,
    url: "/api/v1" + path,
    remoteAddress: `198.51.100.${(++requestNumber % 250) + 1}`,
    headers: { origin, ...(as ? { cookie: as.cookie } : {}) },
    payload,
  });
}
async function ok(
  path: string,
  method = "GET",
  payload?: unknown,
  as: User = subscriber,
) {
  const result = await request(path, method, payload, as);
  assert.ok(result.statusCode < 300, result.body);
  return result.json();
}
async function actor(tenantId: string, role = "subscriber"): Promise<User> {
  const userId = randomUUID(),
    token = randomUUID();
  await db.system(async (tx) => {
    await tx.query(
      "INSERT INTO users(id,email,name,password_hash,email_verified) VALUES($1,$2,'Meal capture fixture','unused-test-password',true)",
      [userId, userId + "@capture.invalid"],
    );
    await tx.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)",
      [tenantId, userId, role],
    );
    await tx.query(
      "INSERT INTO sessions(token_hash,user_id,tenant_id,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
      [tokenHash(token), userId, tenantId],
    );
  });
  const a = { tenantId, userId, role, cookie: "session=" + token };
  if (role === "subscriber")
    await db.tenant({ ...a, role: "owner" }, async (tx) => {
      await tx.query(
        "INSERT INTO subscriptions(id,tenant_id,user_id,status,period_end,data) VALUES($1,$2,$3,'active',now()+interval '1 month','{\"modules\":[\"training\",\"nutrition\"]}')",
        [randomUUID(), tenantId, userId],
      );
      await putRecord(
        tx,
        a,
        "nutrition_profile",
        { profile: fixtureProfile, allowedUses: ["render", "model_prompt"] },
        { status: "current" },
      );
      for (const type of ["nutrition", "nutrition_model"])
        await tx.query(
          "INSERT INTO consent_records(id,tenant_id,user_id,document_type,document_version,granted) VALUES($1,$2,$3,$4,'capture-fixture',true)",
          [randomUUID(), tenantId, userId, type],
        );
    });
  return a;
}
const input = () => ({
  requestKey: randomUUID(),
  mime: "image/png",
  base64: photo,
  context: "Synthetic test meal",
  photoConsent: true,
});
const confirmInput = (name = "Rice bowl") => ({
  eventKey: randomUUID(),
  date: localDate("Asia/Dubai"),
  timezone: "Asia/Dubai",
  name,
  notes: "I checked the portion and hidden oils",
  items: [food],
  confirmed: true,
});
before(async () => {
  Object.assign(process.env, settings);
  db = await createDatabase({ memory: true });
  app = await buildApp({ db, testing: true });
  const tenant1 = randomUUID(),
    tenant2 = randomUUID();
  await db.system(async (tx) => {
    for (const id of [tenant1, tenant2])
      await tx.query(
        "INSERT INTO tenants(id,slug,name) VALUES($1,$2,'Capture fixture')",
        [id, "capture-" + id],
      );
  });
  owner = await actor(tenant1, "owner");
  subscriber = await actor(tenant1);
  neighbour = await actor(tenant1);
  foreign = await actor(tenant2);
  photo = (
    await sharp({
      create: { width: 64, height: 48, channels: 3, background: "#c2ac80" },
    })
      .png()
      .toBuffer()
  ).toString("base64");
  globalThis.fetch = async (url, options) => {
    if (
      String(url).startsWith("https://world.openfoodfacts.org/api/v2/product/")
    ) {
      lookupCalls++;
      assert.equal(options?.redirect, "error");
      assert.equal(options?.body, undefined);
      return Response.json(
        missing
          ? { status: 0 }
          : {
              status: 1,
              product: {
                code: wrongCode ? "0034000470693" : "3017620422003",
                product_name: "SYNTHETIC cereal",
                brands: "Fixture brand",
                serving_size: "40 g",
                ingredients_text: "Synthetic test data",
                allergens_tags: [],
                nutriments: {
                  "energy-kcal_100g": 400,
                  proteins_100g: 10,
                  carbohydrates_100g: 70,
                },
                rev: 9,
              },
            },
      );
    }
    assert.equal(
      String(url),
      "https://capture-fixture.invalid/v1/chat/completions",
    );
    calls++;
    const body = JSON.parse(String(options?.body));
    assert.equal(body.messages[1].content[1].type, "image_url");
    assert.match(
      body.messages[1].content[1].image_url.url,
      /^data:image\/jpeg;base64,/,
    );
    if (waitForModel) await waitForModel();
    return Response.json({
      id: "capture-request-" + calls,
      usage: { prompt_tokens: 40, completion_tokens: 90 },
      choices: [
        {
          message: {
            content: invalidModel
              ? "not-json"
              : JSON.stringify({
                  items: [food],
                  questions: ["Was any oil or sauce added?"],
                  notes: "Illustrative fixture estimate only",
                }),
          },
        },
      ],
    });
  };
});
after(async () => {
  globalThis.fetch = originalFetch;
  for (const [key, val] of Object.entries(oldSettings))
    if (val === undefined) delete process.env[key];
    else process.env[key] = val;
  await app.close();
  await db.close();
});

test("GTIN validation rejects bad checksums, non-product input and preserves normalized identifiers", () => {
  assert.equal(normalizeGtin("3017 6204 22003"), "3017620422003");
  assert.equal(normalizeGtin("034000470693"), "0034000470693");
  for (const input of [
    "3017620422004",
    "https://private/",
    "00000000",
    "1234567",
    "abcd3017620422003",
    "1e12",
  ])
    assert.throws(() => normalizeGtin(input));
});
test("meal images must decode, match their signature, fit limits and lose source metadata", async () => {
  const original = await sharp(Buffer.from(photo, "base64"))
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();
  assert.ok((await sharp(original).metadata()).exif);
  const sanitized = await sanitizeMealPhoto(
      original.toString("base64"),
      "image/jpeg",
    ),
    info = await sharp(sanitized).metadata();
  assert.equal(info.format, "jpeg");
  assert.equal(info.exif, undefined);
  assert.equal(info.orientation, undefined);
  await assert.rejects(
    () => sanitizeMealPhoto(photo, "image/jpeg"),
    /contents/,
  );
  await assert.rejects(
    () =>
      sanitizeMealPhoto(
        Buffer.from("<svg>not a meal</svg>").toString("base64"),
        "image/png",
      ),
    /contents/,
  );
  await assert.rejects(
    () => sanitizeMealPhoto("A".repeat(3000000), "image/png"),
    /2 MB/,
  );
  await assert.rejects(
    () =>
      sanitizeMealPhoto(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64"),
        "image/png",
      ),
    /decoded/,
  );
});
test("barcode source snapshots retain unknown nutrients and reject a mismatched product", async () => {
  const product = await lookupBarcode("3017620422003");
  assert.equal(product!.nutrientsPer100.fat, null);
  assert.equal(product!.allergens, null);
  assert.equal(product!.source.revision, "9");
  assert.match(product!.source.url, /3017620422003$/);
  missing = true;
  assert.equal(await lookupBarcode("3017620422003"), null);
  missing = false;
  wrongCode = true;
  await assert.rejects(() => lookupBarcode("3017620422003"), /identifiable/);
  wrongCode = false;
  assert.equal(captureTotals([food, { ...food, kcal: null }]).kcal, null);
  assert.equal(captureTotals([food]).kcal, 195);
  assert.throws(() => capturedFoodSchema.parse({ ...food, kcal: -1 }));
});
test("photo draft is private, removes image bytes and never writes the diary before confirmation", async () => {
  const b = input(),
    before = calls,
    d = await ok("/nutrition/captures/photo", "POST", b);
  assert.equal(d.status, "draft");
  assert.equal(calls, before + 1);
  assert.equal(d.data.estimated, true);
  const again = await ok("/nutrition/captures/photo", "POST", b);
  assert.equal(again.id, d.id);
  assert.equal(calls, before + 1);
  assert.equal(
    (
      await request("/nutrition/captures/photo", "POST", {
        ...b,
        context: "Changed",
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (await request("/nutrition/captures/" + d.id, "GET", undefined, neighbour))
      .statusCode,
    404,
  );
  assert.equal(
    (await request("/nutrition/captures/" + d.id, "GET", undefined, foreign))
      .statusCode,
    404,
  );
  assert.equal(
    (await request("/nutrition/captures/" + d.id, "GET", undefined, owner))
      .statusCode,
    403,
  );
  assert.equal(
    (await request("/nutrition/captures", "GET", undefined, null)).statusCode,
    401,
  );
  await db.tenant(owner, async (tx) => {
    const [row] = await tx.query(
      "SELECT media FROM meal_captures WHERE id=$1",
      [d.id],
    );
    assert.equal(row.media, null);
    const logs = await tx.query(
      "SELECT id FROM records WHERE kind='nutrition_log' AND owner_user_id=$1",
      [subscriber.userId],
    );
    assert.equal(logs.length, 0);
    const usage = await tx.query(
      "SELECT status,input_tokens,output_tokens FROM cost_events WHERE user_id=$1 AND task='meal_photo_estimate'",
      [subscriber.userId],
    );
    assert.ok(
      usage.some(
        (r) =>
          r.status === "recorded" &&
          r.input_tokens === 40 &&
          r.output_tokens === 90,
      ),
    );
  });
  await db.tenant(foreign, async (tx) => {
    assert.equal(
      (await tx.query("SELECT id FROM meal_captures WHERE id=$1", [d.id]))
        .length,
      0,
    );
  });
  const b2 = confirmInput(),
    log = await ok(`/nutrition/captures/${d.id}/confirm`, "POST", b2);
  assert.equal(log.data.source, "photo_estimate_with_user_confirmation");
  assert.equal(log.data.kcal, 195);
  assert.equal(log.data.provenance.captureId, d.id);
  assert.equal(
    (await ok(`/nutrition/captures/${d.id}/confirm`, "POST", b2)).id,
    log.id,
  );
  assert.equal(
    (
      await request(`/nutrition/captures/${d.id}/confirm`, "POST", {
        ...b2,
        name: "Changed meal",
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await request(
        `/nutrition/captures/${d.id}/confirm`,
        "POST",
        confirmInput(),
      )
    ).statusCode,
    409,
  );
  const correction = await ok("/nutrition/logs", "POST", {
    eventKey: randomUUID(),
    date: b2.date,
    timezone: b2.timezone,
    name: "Corrected portion",
    notes: "Updated after weighing",
    kcal: 210,
    correctsId: log.id,
    deleted: false,
  });
  const data = await ok("/nutrition");
  const summary = nutritionSummary(
    data.records.filter((r: any) => r.kind === "nutrition_log"),
    [],
    data.profile,
    true,
  );
  assert.equal(summary.loggedMeals, 1);
  assert.ok(summary.sourceIds?.includes(correction.id));
  assert.ok(!summary.sourceIds?.includes(log.id));
});
test("barcode confirmation requires a checked serving basis, preserves provenance and partial totals", async () => {
  const key = randomUUID(),
    before = lookupCalls,
    d = await ok("/nutrition/captures/barcode", "POST", {
      requestKey: key,
      code: "3017620422003",
    });
  assert.equal(
    (
      await ok("/nutrition/captures/barcode", "POST", {
        requestKey: key,
        code: "3017620422003",
      })
    ).id,
    d.id,
  );
  assert.equal(lookupCalls, before + 1);
  const b = {
    ...confirmInput("My cereal"),
    items: [
      {
        ...food,
        name: "Cereal",
        amount: 40,
        portion: "40 g",
        kcal: 160,
        protein: 4,
        carbohydrate: 28,
        fat: null,
      },
    ],
  };
  assert.equal(
    (await request(`/nutrition/captures/${d.id}/confirm`, "POST", b))
      .statusCode,
    400,
  );
  const log = await ok(`/nutrition/captures/${d.id}/confirm`, "POST", {
    ...b,
    labelUnit: "g",
  });
  assert.equal(log.data.kcal, 160);
  assert.equal(log.data.nutrients.fat, null);
  assert.equal(log.data.provenance.original.source.provider, "Open Food Facts");
  assert.equal(log.data.provenance.labelUnit, "g");
  const exported = await ok("/privacy/export");
  assert.ok(
    JSON.stringify(exported).includes(log.id) ||
      exported.records.some((r: any) => r.data.provenance?.captureId === d.id),
  );
});
test("missing entitlement and photo permission block analysis without provider usage", async () => {
  const before = calls;
  await db.tenant(owner, (tx) =>
    tx.query(
      'UPDATE subscriptions SET data=\'{"modules":["training"]}\' WHERE user_id=$1',
      [neighbour.userId],
    ),
  );
  assert.equal(
    (await request("/nutrition/captures/photo", "POST", input(), neighbour))
      .statusCode,
    402,
  );
  assert.equal(
    (
      await request("/nutrition/captures/photo", "POST", {
        ...input(),
        photoConsent: false,
      })
    ).statusCode,
    400,
  );
  assert.equal(calls, before);
  await db.tenant(owner, (tx) =>
    tx.query(
      'UPDATE subscriptions SET data=\'{"modules":["training","nutrition"]}\' WHERE user_id=$1',
      [neighbour.userId],
    ),
  );
});
test("invalid model output retains cost evidence and stable intent never repeats paid analysis", async () => {
  invalidModel = true;
  const b = input(),
    before = calls;
  const failed = await request("/nutrition/captures/photo", "POST", b);
  assert.equal(failed.statusCode, 503);
  assert.equal(calls, before + 1);
  invalidModel = false;
  const retry = await ok("/nutrition/captures/photo", "POST", b);
  assert.equal(retry.status, "failed");
  assert.equal(calls, before + 1);
  await ok(`/nutrition/captures/${retry.id}`, "DELETE");
  assert.equal(
    (await request("/nutrition/captures/photo", "POST", b)).statusCode,
    410,
  );
  assert.equal(calls, before + 1);
});
test("withdrawing photo permission during analysis discards the result and clears private bytes", async () => {
  const existingPlan = await db.tenant(owner, (tx) =>
    putRecord(
      tx,
      neighbour,
      "nutrition_plan",
      {
        weekStart: localDate("Asia/Dubai"),
        allowedUses: ["render", "model_prompt"],
      },
      { ownerId: neighbour.userId, status: "delivered" },
    ),
  );
  let begin!: () => void, finish!: () => void;
  const started = new Promise<void>((resolve) => {
      begin = resolve;
    }),
    pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
  waitForModel = async () => {
    begin();
    await pending;
  };
  const b = input(),
    before = calls,
    requestPromise = request("/nutrition/captures/photo", "POST", b, neighbour);
  await started;
  const duplicate = await ok("/nutrition/captures/photo", "POST", b, neighbour);
  assert.equal(duplicate.status, "running");
  assert.equal(calls, before + 1);
  await db.tenant(owner, async (tx) => {
    const exported = await exportMealCaptures(tx, neighbour.userId);
    assert.ok(
      exported.some((r) => r.photo_base64 && r.media_type === "image/jpeg"),
    );
  });
  await ok(
    "/privacy/consent",
    "POST",
    { type: "nutrition_photo", granted: false },
    neighbour,
  );
  finish();
  const result = await requestPromise;
  waitForModel = undefined;
  assert.ok([403, 404, 409].includes(result.statusCode), result.body);
  await db.tenant(owner, async (tx) => {
    const [row] = await tx.query(
      "SELECT media,data,status FROM meal_captures WHERE user_id=$1 AND request_key=$2",
      [neighbour.userId, b.requestKey],
    );
    assert.equal(row.media, null);
    assert.equal(row.status, "failed");
    assert.equal(row.data.estimate, undefined);
    assert.equal(
      (
        await tx.query(
          "SELECT id FROM records WHERE owner_user_id=$1 AND kind='nutrition_log'",
          [neighbour.userId],
        )
      ).length,
      0,
    );
    const costs = await tx.query(
      "SELECT status FROM cost_events WHERE user_id=$1 AND task='meal_photo_estimate'",
      [neighbour.userId],
    );
    assert.ok(costs.some((c) => c.status === "recorded"));
    const [plan] = await tx.query(
      "SELECT status,data FROM records WHERE id=$1",
      [existingPlan.id],
    );
    assert.equal(plan.status, "delivered");
    assert.deepEqual(plan.data.allowedUses, ["render", "model_prompt"]);
    for (const type of ["nutrition", "nutrition_model"]) {
      const [permission] = await tx.query(
        "SELECT granted FROM consent_records WHERE user_id=$1 AND document_type=$2 ORDER BY created_at DESC,id DESC LIMIT 1",
        [neighbour.userId, type],
      );
      assert.equal(permission.granted, true);
    }
  });
});
test("expiry and withdrawal scrub drafts while retaining intent deduplication", async () => {
  const b = input(),
    d = await ok("/nutrition/captures/photo", "POST", b),
    before = calls;
  await db.tenant(owner, (tx) =>
    tx.query(
      "UPDATE meal_captures SET expires_at=now()-interval '1 minute' WHERE id=$1",
      [d.id],
    ),
  );
  await purgeExpiredMealCaptures(db);
  assert.equal((await request(`/nutrition/captures/${d.id}`)).statusCode, 404);
  assert.equal(
    (await request("/nutrition/captures/photo", "POST", b)).statusCode,
    410,
  );
  assert.equal(calls, before);
  await db.tenant(owner, async (tx) => {
    const [row] = await tx.query(
      "SELECT media,data FROM meal_captures WHERE id=$1",
      [d.id],
    );
    assert.equal(row.media, null);
    assert.deepEqual(row.data, { expired: true });
    await eraseMealCaptures(tx, subscriber.userId);
    const exports = await exportMealCaptures(tx, subscriber.userId);
    assert.ok(exports.every((r) => !r.photo_base64 && !r.data.estimate));
  });
});
