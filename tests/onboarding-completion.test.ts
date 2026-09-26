import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import Fastify, { type FastifyRequest, type FastifyReply } from "fastify";
import { z } from "zod";
import { createDatabase, putRecord, type Database } from "@trainer/db";
import {
  onboardingRoutes,
  publishStorefront,
} from "../apps/api/src/onboarding.ts";
import { coachingRuntimeReadiness } from "../apps/api/src/coaching-runtime.ts";
import { nutritionMaterial } from "../apps/api/src/nutrition.ts";
import { withRuntimeConfig } from "../packages/providers/src/configuration.ts";
import { fixtureCases, fixturePolicy } from "./nutrition-fixtures.ts";

let db: Database, app: ReturnType<typeof Fastify>;
const actors = new Map<string, any>();
const config = {
  LEGAL_APPROVED: "true",
  STRIPE_SECRET_KEY: "synthetic-onboarding-only",
  COMMERCE_APPROVED: "true",
  LEAN_BASE_URL: "https://onboarding.invalid",
  LEAN_ACCESS_TOKEN: "synthetic-onboarding-only",
  LEAN_SOURCE_ACCOUNT_ID: "synthetic-bank",
  PAYOUTS_APPROVED: "true",
  LEAN_CONTRACT_VERIFIED: "true",
  MODEL_BASE_URL: "https://model.onboarding.invalid",
  MODEL_API_KEY: "synthetic-onboarding-only",
  MODEL_NAME: "onboarding-fixture",
  VOICE_PROVIDER: "elevenlabs",
  VOICE_BASE_URL: "https://voice.onboarding.invalid",
  VOICE_API_KEY: "synthetic-onboarding-only",
  VOICE_MODEL: "onboarding-fixture",
  VOICE_PRICE_VERSION: "fixture-v1",
  VOICE_USD_PER_1000_CHARACTERS: "1",
  VOICE_DAILY_USD_LIMIT: "5",
  VOICE_CONTRACT_VERIFIED: "true",
};
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
function owner(req: FastifyRequest) {
  const a = actors.get(String(req.headers["x-fixture-owner"]));
  if (!a || a.role !== "owner")
    throw Object.assign(new Error("Owner required"), { statusCode: 403 });
  return a;
}
async function person() {
  const a = {
    tenantId: randomUUID(),
    userId: randomUUID(),
    role: "owner",
    emailVerified: true,
    mfaAt: new Date().toISOString(),
  };
  await db.system(async (tx) => {
    await tx.query(
      "INSERT INTO tenants(id,slug,name,theme) VALUES($1,$2,'Synthetic coach',$3)",
      [
        a.tenantId,
        "onboarding-" + a.tenantId,
        JSON.stringify({
          headline: "Train thoughtfully",
          bio: "Synthetic coaching biography",
          category: "Strength",
        }),
      ],
    );
    await tx.query(
      "INSERT INTO users(id,email,name,password_hash,email_verified) VALUES($1,$2,'Synthetic coach','synthetic',true)",
      [a.userId, a.userId + "@example.test"],
    );
    await tx.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')",
      [a.tenantId, a.userId],
    );
  });
  actors.set(a.userId, a);
  return a;
}
function req(
  a: any,
  path = "",
  method: any = "GET",
  payload?: unknown,
  overrides: Record<string, string | undefined> = {},
) {
  return withRuntimeConfig({ ...config, ...overrides }, () =>
    app.inject({
      url: "/api/v1/onboarding" + path,
      method,
      payload,
      headers: {
        "x-fixture-owner": a.userId,
        "x-fixture-config": JSON.stringify(overrides),
      },
    }),
  );
}
async function state(a: any, overrides?: Record<string, string | undefined>) {
  const r = await req(a, "", "GET", undefined, overrides);
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}
function step(s: any, key: string) {
  return s.steps.find((r: any) => r.key === key);
}
async function review(a: any, viewed?: any) {
  viewed ??= await state(a);
  const r = await req(a, "/preview", "PUT", {
    version: step(viewed, "preview").version,
    values: { digest: viewed.previewDigest },
  });
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}
async function legal(
  a: any,
  key: string,
  version: number,
  delay = "-1 minute",
) {
  await db.system((tx) =>
    tx.query(
      "INSERT INTO admin_documents(id,kind,key,version,title,content,status,effective_at,created_by,published_at) VALUES($1,'legal',$2,$3,$4,'Synthetic fixture text, not approved production copy','published',now()+$5::interval,$6,now())",
      [randomUUID(), key, version, "Synthetic " + key, delay, a.userId],
    ),
  );
}
async function baseBrain(a: any) {
  return db.tenant(a, async (tx) => {
    const rule = await putRecord(
      tx,
      a,
      "rule",
      {
        title: "Consistency",
        directive: "Follow the planned routine",
        allowedUses: ["model_prompt"],
      },
      { status: "confirmed" },
    );
    for (let i = 0; i < 20; i++)
      await putRecord(
        tx,
        a,
        "scenario",
        {
          prompt: `Synthetic independent base case ${i}`,
          expectedEvidenceId: rule.id,
          expectEscalation: false,
          heldOut: true,
        },
        { status: "held_out" },
      );
    const rules = (
      await tx.query(
        "SELECT * FROM records WHERE kind='rule' AND status='confirmed' ORDER BY id",
      )
    ).map((r) => ({ id: r.id, data: r.data, version: r.version }));
    const scenarios = await tx.query(
      "SELECT id FROM records WHERE kind='scenario' ORDER BY id",
    );
    const evaluation = await putRecord(
      tx,
      a,
      "evaluation",
      {
        rulesDigest: hash(rules),
        total: 20,
        passed: 20,
        outcomes: scenarios.map((r) => ({ scenarioId: r.id, passed: true })),
      },
      { status: "passed" },
    );
    const release = await putRecord(
      tx,
      a,
      "brain_release",
      { rules, evaluationId: evaluation.id, mode: "supervised" },
      { status: "published" },
    );
    return { rule, release };
  });
}
before(async () => {
  db = await createDatabase({ memory: true });
  app = Fastify();
  app.addHook(
    "onRequest",
    (
      req: FastifyRequest,
      _reply: FastifyReply,
      done: (error?: Error) => void,
    ) => {
      withRuntimeConfig(
        {
          ...config,
          ...JSON.parse(String(req.headers["x-fixture-config"] ?? "{}")),
        },
        done,
      );
    },
  );
  app.setErrorHandler((e: any, _req: FastifyRequest, reply: FastifyReply) =>
    reply
      .code(e instanceof z.ZodError ? 400 : (e.statusCode ?? 500))
      .send({ message: e.message, code: e.code }),
  );
  onboardingRoutes(app, db, owner);
  app.post("/api/v1/onboarding/launch", (req: FastifyRequest) =>
    publishStorefront(db, owner(req)),
  );
});
after(async () => {
  await app.close();
  await db.close();
});

test("launch requires effective published legal versions and previews expire when those versions change", async () => {
  const a = await person();
  let s = await state(a);
  assert.ok(s.gates.some((g: any) => g.key === "legal"));
  assert.ok(s.preview.legal.documents.every((d: any) => d.version === null));
  for (const key of ["terms", "privacy", "ai-disclosure"])
    await legal(a, key, 1);
  s = await state(a);
  assert.equal(
    s.gates.some((g: any) => g.key === "legal"),
    false,
  );
  await review(a, s);
  await legal(a, "privacy", 2, "1 day");
  const future = await state(a);
  assert.equal(step(future, "preview").status, "complete");
  assert.equal(
    future.preview.legal.documents.find((d: any) => d.key === "privacy")
      .version,
    1,
  );
  await legal(a, "privacy", 3, "-1 second");
  const current = await state(a);
  assert.equal(step(current, "preview").status, "draft");
  assert.notEqual(current.previewDigest, s.previewDigest);
  assert.equal(
    current.preview.legal.documents.find((d: any) => d.key === "privacy")
      .version,
    3,
  );
});

test("preview acknowledgement binds to what was shown and foreign teaching does not affect a workspace", async () => {
  const a = await person(),
    other = await person();
  const viewed = await state(a);
  await review(a, viewed);
  const reviewed = await state(a);
  const before = await state(other);
  await db.tenant(a, (tx) =>
    putRecord(
      tx,
      a,
      "coaching_teaching",
      {
        category: "message",
        scenario: "A missed week",
        recommendation: "Resume the planned routine",
        reason: "Build consistency",
      },
      { status: "confirmed" },
    ),
  );
  const changed = await state(a);
  assert.equal(step(changed, "interview").status, "complete");
  assert.equal(step(changed, "preview").status, "draft");
  assert.equal((await state(other)).previewDigest, before.previewDigest);
  const stale = await req(a, "/preview", "PUT", {
    version: step(reviewed, "preview").version,
    values: { digest: reviewed.previewDigest },
  });
  assert.equal(stale.statusCode, 409, stale.body);
  assert.equal(stale.json().code, "PREVIEW_CHANGED");
  assert.equal(step(await state(a), "preview").version, 1);
  assert.equal(
    (await req(a, "/preview", "PUT", { version: 1, values: {} })).statusCode,
    400,
  );
  await review(a, changed);
  assert.equal(step(await state(a), "preview").status, "complete");
});

test("base Brain and automatic qualification use current rules, action boundaries and model settings", async () => {
  const a = await person(),
    { rule } = await baseBrain(a);
  assert.equal(step(await state(a), "readiness").status, "complete");
  const action = await db.tenant(a, (tx) =>
    putRecord(
      tx,
      a,
      "coaching_action",
      {
        type: "message",
        title: "Consistency",
        response: "Resume your planned session",
        evidenceIds: [rule.id],
      },
      { status: "confirmed" },
    ),
  );
  const ready = await withRuntimeConfig(config, () =>
    db.tenant(a, coachingRuntimeReadiness),
  );
  await db.tenant(a, (tx) =>
    putRecord(
      tx,
      a,
      "coaching_runtime_release",
      {
        mode: "automatic",
        contractDigest: ready.contractDigest,
        brainId: ready.brainId,
      },
      { status: "published" },
    ),
  );
  let s = await state(a);
  assert.equal(s.teaching.runtime.automatic, true);
  assert.equal(step(s, "readiness").status, "complete");
  await review(a, s);
  const disconnected = await state(a, { MODEL_API_KEY: "" });
  assert.equal(disconnected.teaching.modelReady, false);
  assert.equal(step(disconnected, "readiness").status, "blocked");
  assert.match(step(disconnected, "readiness").blocker, /model connection/i);
  s = await state(a, { MODEL_NAME: "changed-model-fixture" });
  assert.equal(s.teaching.runtime.current, false);
  assert.equal(step(s, "readiness").status, "blocked");
  assert.equal(step(s, "preview").status, "draft");
  await db.tenant(a, (tx) =>
    tx.query(
      'UPDATE records SET data=data||\'{"response":"Use the shorter planned session"}\'::jsonb,version=version+1 WHERE id=$1',
      [action.id],
    ),
  );
  s = await state(a);
  assert.equal(s.teaching.runtime.current, false);
  assert.equal(s.teaching.brainCurrent, true);
  assert.match(
    step(s, "readiness").blocker,
    /automatic coaching qualification changed/i,
  );
  await db.tenant(a, (tx) =>
    tx.query(
      'UPDATE records SET data=data||\'{"directive":"Updated coach rule"}\'::jsonb,version=version+1 WHERE id=$1',
      [rule.id],
    ),
  );
  s = await state(a);
  assert.equal(s.teaching.brainCurrent, false);
  assert.match(step(s, "readiness").blocker, /current confirmed rules/i);
});

test("nutrition setup reflects independent current case checks and preview without requiring an existing release", async () => {
  const a = await person();
  await db.tenant(a, async (tx) => {
    await putRecord(
      tx,
      a,
      "nutrition_setup",
      { enabled: true },
      { status: "saved" },
    );
    const cases = [];
    for (const { id: _, ...data } of fixtureCases())
      cases.push(
        await putRecord(tx, a, "nutrition_case", data, { status: "confirmed" }),
      );
    await putRecord(
      tx,
      a,
      "nutrition_policy",
      { policy: fixturePolicy(cases.map((r) => r.id)) },
      { status: "confirmed" },
    );
    for (let i = 0; i < 20; i++)
      await putRecord(
        tx,
        a,
        "nutrition_scenario",
        {
          category: cases[i % cases.length].data.category,
          prompt: `Synthetic independent nutrition check ${i}`,
          expect: "plan",
          ...(i < 8
            ? {
                expectedMeal: {
                  recipeId: randomUUID(),
                  minServings: 1,
                  maxServings: 2,
                },
              }
            : {}),
        },
        { status: "held_out" },
      );
  });
  let s = await state(a);
  assert.equal(s.steps.length, 22);
  assert.equal(step(s, "nutrition-cases").status, "complete");
  assert.equal(step(s, "nutrition-preview").status, "blocked");
  await withRuntimeConfig(config, () =>
    db.tenant(a, async (tx) => {
      const material = await nutritionMaterial(tx),
        scenarios = await tx.query(
          "SELECT * FROM records WHERE kind='nutrition_scenario' AND status='held_out' ORDER BY id",
        );
      await putRecord(
        tx,
        a,
        "nutrition_evaluation",
        {
          qualificationVersion: 2,
          digest: material.digest,
          scenarioDigest: hash(
            scenarios.map((r) => ({
              id: r.id,
              data: r.data,
              version: r.version,
            })),
          ),
          verificationMode: "fixture",
        },
        { status: "passed" },
      );
      await putRecord(
        tx,
        a,
        "nutrition_preview",
        { digest: material.digest, verificationMode: "fixture" },
        { status: "ready" },
      );
    }),
  );
  s = await state(a);
  assert.equal(step(s, "nutrition-scenarios").status, "complete");
  assert.equal(step(s, "nutrition-preview").status, "complete");
  assert.equal(step(s, "nutrition-readiness").status, "blocked");
  assert.equal(s.teaching.nutrition.evaluationCurrent, true);
  await review(a, s);
  await db.tenant(a, (tx) =>
    putRecord(
      tx,
      a,
      "nutrition_method",
      {
        name: "Coach selected fixed target",
        method: { kind: "fixed", kcal: 1600 },
      },
      { status: "confirmed" },
    ),
  );
  s = await state(a);
  assert.equal(s.teaching.nutrition.calorieMethods, 1);
  assert.equal(step(s, "preview").status, "draft");
  await db.tenant(a, (tx) =>
    tx.query(
      "UPDATE records SET version=version+1 WHERE kind='nutrition_policy'",
    ),
  );
  s = await state(a);
  assert.equal(step(s, "nutrition-scenarios").status, "blocked");
  assert.equal(step(s, "nutrition-preview").status, "blocked");
  await db.tenant(a, async (tx) => {
    await tx.query(
      "UPDATE records SET data='{\"enabled\":false}' WHERE kind='nutrition_setup'",
    );
    await putRecord(
      tx,
      a,
      "product",
      {
        name: "Combined",
        tier: "workout_nutrition",
        stripePriceId: "fixture-price",
      },
      { status: "published" },
    );
  });
  s = await state(a);
  assert.equal(s.steps.length, 22);
  assert.equal(step(s, "nutrition-readiness").required, true);
  assert.match(step(s, "nutrition-readiness").blocker, /enable nutrition/i);
  assert.ok(s.gates.some((g: any) => g.key === "nutrition-readiness"));
});

test("saved website and gallery changes invalidate review while launch does not require website publication", async () => {
  const a = await person();
  await baseBrain(a);
  await db.tenant(a, async (tx) => {
    await putRecord(
      tx,
      a,
      "onboarding_step",
      {
        step: "identity",
        values: {
          businessName: "Synthetic Coaching",
          publicName: "Synthetic Coach",
          city: "Dubai",
          country: "AE",
          category: "Strength",
          audience: "Adults building consistency",
        },
      },
      { status: "saved" },
    );
    await putRecord(
      tx,
      a,
      "onboarding_step",
      { step: "brain-intro", values: { understood: true } },
      { status: "saved" },
    );
    await putRecord(
      tx,
      a,
      "product",
      {
        name: "Workout",
        tier: "workout",
        stripePriceId: "fixture-price",
        priceMinor: 10000,
      },
      { status: "published" },
    );
    await putRecord(
      tx,
      a,
      "beneficiary",
      { providerId: "fixture-beneficiary", holdUntil: "2020-01-01T00:00:00Z" },
      { status: "verified" },
    );
    await tx.query(
      'INSERT INTO coach_sites(tenant_id,draft,version) VALUES($1,\'{"headline":"My saved website draft"}\',1)',
      [a.tenantId],
    );
  });
  let s = await state(a);
  assert.equal(s.preview.website.published, null);
  assert.equal(s.preview.website.launchRequired, true);
  await review(a, s);
  s = await state(a);
  assert.equal(s.readyToPublish, true, JSON.stringify(s.gates));
  const galleryId = randomUUID(),
    mediaId = randomUUID();
  await db.tenant(a, async (tx) => {
    await tx.query(
      "INSERT INTO coach_galleries(id,tenant_id,owner_user_id,title) VALUES($1,$2,$3,'Training gallery')",
      [galleryId, a.tenantId, a.userId],
    );
    await tx.query(
      "INSERT INTO brand_media(id,tenant_id,owner_user_id,digest,media,width,height,filename) VALUES($1,$2,$3,'synthetic-photo-digest',$4,1,1,'synthetic.png')",
      [mediaId, a.tenantId, a.userId, Buffer.from([1])],
    );
    await tx.query(
      "INSERT INTO coach_gallery_photos(tenant_id,gallery_id,media_id,alt) VALUES($1,$2,$3,'A synthetic training photo')",
      [a.tenantId, galleryId, mediaId],
    );
  });
  s = await state(a);
  assert.equal(step(s, "preview").status, "draft");
  assert.equal(s.preview.galleries[0].photos.length, 1);
  await review(a, s);
  await db.tenant(a, (tx) =>
    tx.query(
      "UPDATE coach_gallery_photos SET caption='Updated caption' WHERE gallery_id=$1",
      [galleryId],
    ),
  );
  s = await state(a);
  assert.equal(step(s, "preview").status, "draft");
  await review(a, s);
  await db.tenant(a, (tx) =>
    tx.query(
      'UPDATE coach_sites SET draft=\'{"headline":"A revised private website"}\',version=version+1 WHERE tenant_id=$1',
      [a.tenantId],
    ),
  );
  s = await state(a);
  assert.equal(step(s, "preview").status, "draft");
  assert.equal(s.preview.website.published, null);
  assert.equal(s.preview.website.draft.headline, "A revised private website");
  await review(a, s);
  await db.tenant(a, (tx) =>
    tx.query(
      'INSERT INTO coach_design_drafts(tenant_id,data) VALUES($1,\'{"headline":"Private design"}\')',
      [a.tenantId],
    ),
  );
  s = await state(a);
  assert.equal(step(s, "preview").status, "draft");
  await review(a, s);
  const launched = await req(a, "/launch", "POST", {});
  assert.equal(launched.statusCode, 200, launched.body);
  s = await state(a);
  assert.equal(step(s, "publish").status, "complete");
  assert.equal(s.preview.website.launchRequired, false);
  assert.equal(s.preview.website.published, null);
  assert.equal(s.readyToPublish, true);
});

test("voice completion follows provider approval, verified identity and current consent; deferred optional steps stay deferred", async () => {
  const a = await person();
  let s = await state(a);
  assert.equal(step(s, "voice").status, "blocked");
  assert.equal(
    (await req(a, "/voice", "PUT", { version: 0, values: {}, defer: true }))
      .statusCode,
    200,
  );
  assert.equal(
    (
      await req(a, "/wearables", "PUT", {
        version: 0,
        values: { policy: "none" },
        defer: true,
      })
    ).statusCode,
    200,
  );
  s = await state(a);
  assert.equal(step(s, "voice").status, "deferred");
  assert.equal(step(s, "wearables").status, "deferred");
  await db.tenant(a, async (tx) => {
    await tx.query(
      "INSERT INTO trainer_voices(id,tenant_id,user_id,status,provider_voice_id,consent_version) VALUES($1,$2,$3,'verified','synthetic-voice','fixture-v1')",
      [randomUUID(), a.tenantId, a.userId],
    );
    await tx.query(
      "INSERT INTO consent_records(id,tenant_id,user_id,document_type,document_version,granted) VALUES($1,$2,$3,'voice','fixture-v1',true)",
      [randomUUID(), a.tenantId, a.userId],
    );
  });
  s = await state(a);
  assert.equal(step(s, "voice").status, "complete");
  assert.equal(
    step(await state(a, { VOICE_CONTRACT_VERIFIED: "false" }), "voice").status,
    "deferred",
  );
  await db.tenant(a, (tx) =>
    tx.query(
      "INSERT INTO consent_records(id,tenant_id,user_id,document_type,document_version,granted) VALUES($1,$2,$3,'voice','fixture-v1',false)",
      [randomUUID(), a.tenantId, a.userId],
    ),
  );
  s = await state(a);
  assert.equal(step(s, "voice").status, "deferred");
  assert.equal(
    s.gates.some((g: any) => g.key === "voice"),
    false,
  );
});
