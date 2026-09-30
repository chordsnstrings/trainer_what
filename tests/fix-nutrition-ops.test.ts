import { principleForCategory } from "../packages/domain/src/nutrition-learning.ts";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, putRecord, type Database } from "@trainer/db";
import { ProviderUnavailable } from "@trainer/providers";
import { buildApp } from "../apps/api/src/app.ts";
import {
  scheduleNutrition,
  executeNutritionJob,
} from "../apps/api/src/nutrition-schedule.ts";
import { modelAccounting } from "../apps/api/src/model-accounting.ts";
import {
  claimJob,
  runClaimedJob,
  defaultHandlers,
} from "../apps/worker/src/dispatch.ts";
import {
  fixtureCases,
  fixturePolicy,
  fixtureCatalog,
  fixtureProfile,
  fixtureWeek,
} from "./nutrition-fixtures.ts";
import {
  nutritionTarget,
  nutritionCategories,
  localDate,
  dateOffset,
} from "../packages/domain/src/nutrition.ts";

let db: Database,
  app: Awaited<ReturnType<typeof buildApp>>,
  owner: any,
  workerCoach: any,
  cases: any[] = [],
  recipes: any[] = [],
  foods: any[] = [],
  release: any;
const today = localDate("Asia/Dubai"),
  origin = "http://localhost:3000",
  originalFetch = globalThis.fetch;
const envKeys = [
  "MODEL_BASE_URL",
  "MODEL_API_KEY",
  "MODEL_NAME",
  "MODEL_PRICE_VERSION",
  "MODEL_INPUT_USD_PER_MILLION",
  "MODEL_OUTPUT_USD_PER_MILLION",
  "MODEL_MAX_DAILY_CALLS",
  "MODEL_MAX_DAILY_CALLS_PER_SUBSCRIBER",
];
const saved = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
let modelCalls = 0,
  invalid = false,
  draftUnknownFood = false;
const payloads: Array<{ task: string; input: any; length: number }> = [];
const lastInput = (task: string) =>
  payloads.filter((p) => p.task === task).at(-1)!;

async function req(
  path: string,
  method: any = "GET",
  body?: any,
  as: any = owner,
) {
  return app.inject({
    url: "/api/v1" + path,
    method,
    headers: { origin, ...(as?.cookie ? { cookie: as.cookie } : {}) },
    payload: body,
  });
}
async function ok(path: string, method: any = "GET", body?: any, as?: any) {
  const r = await req(path, method, body, as);
  assert.ok(r.statusCode < 300, r.body);
  return r.json();
}
async function register(slug: string) {
  const r = await req(
    "/auth/register",
    "POST",
    {
      name: slug,
      email: slug + "@example.test",
      password: "NutritionOpsFixture2026!",
      slug,
      accepted: true,
    },
    {},
  );
  assert.equal(r.statusCode, 201, r.body);
  const cookie = String(r.headers["set-cookie"]).split(";")[0];
  return {
    ...(await ok("/bootstrap", "GET", undefined, { cookie })).user,
    cookie,
  };
}
// Each scenario uses its own entitled subscriber with a current nutrition profile.
async function subscriber(label: string) {
  const email = `ops-${label}@example.test`;
  const invite = await ok("/invitations", "POST", {
    email,
    role: "subscriber",
  });
  const r = await req(
    "/invitations/accept",
    "POST",
    {
      token: invite.url.split("/").pop(),
      name: "Ops " + label,
      email,
      password: "NutritionOpsFixture2026!",
      accepted: true,
    },
    {},
  );
  assert.equal(r.statusCode, 200, r.body);
  const cookie = String(r.headers["set-cookie"]).split(";")[0];
  const user = {
    ...(await ok("/bootstrap", "GET", undefined, { cookie })).user,
    cookie,
  };
  await db.tenant(owner, (tx) =>
    tx.query(
      "INSERT INTO subscriptions(id,tenant_id,user_id,status,period_end,data) VALUES($1,$2,$3,'active',now()+interval '30 days',$4)",
      [
        randomUUID(),
        owner.tenantId,
        user.userId,
        JSON.stringify({ modules: ["training", "nutrition"] }),
      ],
    ),
  );
  user.profile = await ok(
    "/nutrition/profile",
    "POST",
    {
      profile: fixtureProfile,
      processingConsent: true,
      modelConsent: true,
      version: 0,
    },
    user,
  );
  return user;
}
async function qualify() {
  const evaluation = await ok("/nutrition/evaluate", "POST", {});
  assert.equal(evaluation.status, "passed", JSON.stringify(evaluation.data));
  const preview = await ok("/nutrition/preview", "POST", {
    profile: fixtureProfile,
    weekStart: today,
  });
  release = await ok("/nutrition/releases", "POST", {
    evaluationId: evaluation.id,
    previewId: preview.id,
    confirmed: true,
  });
  assert.equal((await ok("/nutrition/coach")).ready, true);
  return release;
}
const rows = (sql: string, params: unknown[] = []) =>
  db.tenant(owner, (tx) => tx.query(sql, params));
async function jobsFor(userId: string) {
  return rows(
    "SELECT * FROM jobs WHERE kind='nutrition_week' AND data->>'userId'=$1 ORDER BY created_at",
    [userId],
  );
}
// Mirrors the worker claim for one known job so other tenant jobs stay untouched.
async function claim(jobId: string) {
  const [claimed] = await rows(
    "UPDATE jobs SET leased_until=now()+interval '2 minutes',attempts=attempts+1 WHERE id=$1 AND status='pending' RETURNING *",
    [jobId],
  );
  assert.ok(claimed, "job was not pending");
  return claimed;
}
async function bigRecipe(diet: string, marker: string) {
  const id = randomUUID(),
    step = (marker + " fixture preparation text. ").repeat(30).slice(0, 900);
  await db.tenant(owner, async (tx) => {
    await tx.query(
      "INSERT INTO nutrition_recipes(id,tenant_id,supersedes_id,name,description,diet_tags,slots,budget,yield_servings,source) VALUES($1,$2,NULL,$3,$4,$5,$6,'low',1,'Synthetic prompt-size fixture')",
      [
        id,
        owner.tenantId,
        marker + " " + id.slice(0, 8),
        ("Large synthetic description " + marker + ". ")
          .repeat(70)
          .slice(0, 2000),
        JSON.stringify([diet]),
        JSON.stringify(["Breakfast"]),
      ],
    );
    await tx.query(
      "INSERT INTO nutrition_recipe_options(tenant_id,recipe_id,option_key,name,equipment,minutes,steps,storage_note) VALUES($1,$2,'hob','Hob preparation',$3,20,$4,'Synthetic storage note')",
      [
        owner.tenantId,
        id,
        JSON.stringify(["hob"]),
        JSON.stringify(Array.from({ length: 10 }, () => step)),
      ],
    );
    await tx.query(
      "INSERT INTO nutrition_ingredients(tenant_id,recipe_id,option_key,position,food_id,grams) VALUES($1,$2,'hob',0,$3,400)",
      [owner.tenantId, id, foods[0].id],
    );
  });
  return id;
}

before(async () => {
  db = await createDatabase({ memory: true });
  app = await buildApp({ db, testing: true });
  owner = await register("nutrition-ops-coach");
  workerCoach = await register("nutrition-ops-worker");
  Object.assign(process.env, {
    MODEL_BASE_URL: "https://nutrition-ops.invalid/v1",
    MODEL_API_KEY: "synthetic-ops-key",
    MODEL_NAME: "nutrition-ops-fixture",
    MODEL_PRICE_VERSION: "fixture-v1",
    MODEL_INPUT_USD_PER_MILLION: "1",
    MODEL_OUTPUT_USD_PER_MILLION: "2",
    MODEL_MAX_DAILY_CALLS: "1000",
    MODEL_MAX_DAILY_CALLS_PER_SUBSCRIBER: "100",
  });
  globalThis.fetch = async (url, options) => {
    assert.equal(
      String(url),
      "https://nutrition-ops.invalid/v1/chat/completions",
    );
    modelCalls++;
    const body = JSON.parse(String(options?.body)),
      content = body.messages[1].content,
      { task, input } = JSON.parse(content);
    payloads.push({ task, input, length: content.length });
    let output: any;
    if (task === "nutrition_evaluation")
      output = {
        decisions: input.scenarios.map((s: any) => {
          let target = null;
          try {
            target = nutritionTarget(input.policy, s.profile);
          } catch {}
          const category =
              nutritionCategories.find((c) =>
                s.prompt.includes("[" + c + "]"),
              ) ?? "diet",
            teaching = input.cases.find(
              (c: any) => c.data.category === category && !c.data.exceptionId,
            ),
            recipe = input.recipes.find((r: any) =>
              r.slots.includes(s.requestedMealSlot),
            ),
            variant = recipe.variants.find((v: any) => v.key === "hob");
          const nutrients = Object.fromEntries(
            ["kcal", "protein", "carbohydrate", "fat"].map((key) => [
              key,
              variant.ingredients.reduce(
                (sum: number, i: any) =>
                  sum +
                  (input.foods.find((f: any) => f.id === i.foodId)
                    .nutrientsPer100g[key] *
                    i.grams) /
                    100,
                0,
              ),
            ]),
          );
          return {
            scenarioId: s.id,
            action: target === null ? "exception" : "plan",
            targetKcal: target,
            caseIds: [teaching.id],
            reason: "Applies the confirmed synthetic fixture policy.",
            principle: principleForCategory[category],
            rationaleEvidence: {
              caseId: teaching.id,
              quote: teaching.data.reason,
            },
            sampleMeal:
              target === null
                ? null
                : {
                    slot: s.requestedMealSlot,
                    recipeId: recipe.id,
                    variantKey: variant.key,
                    servings: 1,
                    ingredients: variant.ingredients,
                    nutrients,
                  },
          };
        }),
      };
    else if (task === "nutrition_week")
      output = fixtureWeek(
        input.recipes,
        input.cases.map((c: any) => c.id),
      );
    else if (task === "nutrition_recipe")
      output = {
        recipe: {
          name: "Drafted synthetic bowl",
          description: "Model-drafted fixture recipe for coach review.",
          dietTags: ["balanced"],
          slots: ["Lunch"],
          budget: "low",
          yieldServings: 1,
          variants: [
            {
              key: "hob",
              name: "Hob preparation",
              equipment: ["hob"],
              minutes: 15,
              steps: ["Use the measured synthetic ingredient."],
              ingredients: [
                {
                  foodId: draftUnknownFood ? randomUUID() : input.foods[0].id,
                  grams: 300,
                },
              ],
              storageNote: "Follow the product label.",
            },
          ],
          source: "Model draft for coach review",
        },
      };
    else if (task === "nutrition_policy")
      output = {
        policy: fixturePolicy([
          ...input.cases.map((c: any) => c.id),
          ...input.sources.map((s: any) => s.id),
        ]),
        gaps: [],
        conflicts: [],
      };
    else throw new Error("Unexpected model task " + task);
    return new Response(
      JSON.stringify({
        id: "ops-request-" + modelCalls,
        choices: [
          {
            message: {
              content: invalid ? "invalid JSON" : JSON.stringify(output),
            },
          },
        ],
        usage: { prompt_tokens: 200, completion_tokens: 100 },
      }),
      { status: 200 },
    );
  };
  // One qualified coach release shared by the scenarios below.
  await ok("/nutrition/setup", "PUT", { enabled: true, version: 0 });
  for (const { id: _, ...c } of fixtureCases())
    cases.push(await ok("/nutrition/cases", "POST", c));
  const catalog = fixtureCatalog(),
    mapping = new Map<string, string>();
  for (const f of catalog.foods) {
    const { id: fid, ...value } = f;
    const row = await ok("/nutrition/foods", "POST", { food: value });
    mapping.set(fid, row.id);
    foods.push(row);
  }
  for (const recipe of catalog.recipes) {
    const { id: _, ...value } = recipe;
    value.variants.forEach((v) =>
      v.ingredients.forEach((i) => (i.foodId = mapping.get(i.foodId)!)),
    );
    recipes.push(await ok("/nutrition/recipes", "POST", { recipe: value }));
  }
  const policy = await ok("/nutrition/policy", "POST", {
    policy: fixturePolicy(cases.map((c) => c.id)),
    reason: "Confirmed synthetic operations policy",
  });
  await ok("/nutrition/policy/" + policy.id + "/confirm", "POST", {});
  for (let i = 0; i < 24; i++) {
    const c = cases[i % cases.length],
      exception = i >= 20;
    await ok("/nutrition/scenarios", "POST", {
      category: c.data.category,
      prompt: `[${c.data.category}] Unseen operations situation ${i}; apply the available evidence.`,
      profile: {
        ...fixtureProfile,
        ...(exception ? { allergyStatus: "unknown" } : {}),
      },
      expect: exception ? "exception" : "plan",
      expectedTargetKcal: exception ? null : 1500,
      expectedCaseId: c.id,
      heldOut: true,
      expectedPrinciple: principleForCategory[c.data.category],
      ...(!exception
        ? {
            expectedMeal: {
              recipeIds: [recipes[0].id],
              slot: "Breakfast",
              minServings: 1,
              maxServings: 1,
            },
          }
        : {}),
    });
  }
  await qualify();
});
after(async () => {
  globalThis.fetch = originalFetch;
  for (const k of envKeys) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await app.close();
  await db.close();
});

test("worker dispatcher claims with a lease, backs off, fails terminally and fences stale leases", async () => {
  const insert = async (kind: string) => {
    const id = randomUUID();
    await db.tenant(workerCoach, (tx) =>
      tx.query(
        "INSERT INTO jobs(id,tenant_id,kind,intent_key,data) VALUES($1,$2,$3,$4,$5)",
        [id, workerCoach.tenantId, kind, "ops:" + id, JSON.stringify({})],
      ),
    );
    return id;
  };
  const job = async (id: string) =>
    (
      await db.tenant(workerCoach, (tx) =>
        tx.query(
          "SELECT *,extract(epoch FROM available_at-now())::float8 AS wait FROM jobs WHERE id=$1",
          [id],
        ),
      )
    )[0];
  const due = (id: string) =>
    db.tenant(workerCoach, (tx) =>
      tx.query(
        "UPDATE jobs SET available_at=now()-interval '1 second' WHERE id=$1",
        [id],
      ),
    );
  const failing = {
    ...defaultHandlers,
    email: async () => {
      throw new Error("Synthetic transport error");
    },
  };
  // This tenant's own onboarding jobs are not part of the scenario.
  await db.tenant(workerCoach, (tx) =>
    tx.query("UPDATE jobs SET status='cancelled' WHERE status='pending'"),
  );
  // Claim sets a lease and counts the attempt; a leased job cannot be claimed again.
  const emailId = await insert("email");
  const claimed = (await claimJob(db, workerCoach.tenantId))!;
  assert.equal(claimed.id, emailId);
  assert.equal(claimed.attempts, 1);
  assert.ok(claimed.leased_until);
  assert.equal(await claimJob(db, workerCoach.tenantId), null);
  // A generic failure retries after five minutes, then becomes terminal at four attempts.
  await runClaimedJob(db, workerCoach.tenantId, claimed, failing);
  let row = await job(emailId);
  assert.equal(row.status, "pending");
  assert.equal(row.last_error, "Provider delivery failed");
  assert.equal(row.leased_until, null);
  assert.ok(row.wait > 240 && row.wait <= 300, String(row.wait));
  for (let attempt = 2; attempt <= 4; attempt++) {
    await due(emailId);
    const next = (await claimJob(db, workerCoach.tenantId))!;
    assert.equal(next.attempts, attempt);
    await runClaimedJob(db, workerCoach.tenantId, next, failing);
  }
  row = await job(emailId);
  assert.equal(row.status, "failed");
  assert.equal(row.attempts, 4);
  // A stale claim cannot overwrite the current lease holder's state.
  const staleId = await insert("email");
  const current = await claimJob(db, workerCoach.tenantId);
  await runClaimedJob(
    db,
    workerCoach.tenantId,
    { ...current, leased_until: new Date(Date.now() - 60000) },
    failing,
  );
  row = await job(staleId);
  assert.equal(row.status, "pending");
  assert.ok(row.leased_until);
  assert.equal(row.last_error, null);
  await db.tenant(workerCoach, (tx) =>
    tx.query("UPDATE jobs SET status='cancelled' WHERE id=$1", [staleId]),
  );
  // Provider unavailability and unknown kinds block instead of retrying.
  const unavailableId = await insert("email");
  await runClaimedJob(
    db,
    workerCoach.tenantId,
    await claimJob(db, workerCoach.tenantId),
    {
      ...defaultHandlers,
      email: async () => {
        throw new ProviderUnavailable("email", "Email is not configured");
      },
    },
  );
  row = await job(unavailableId);
  assert.equal(row.status, "blocked");
  assert.equal(row.last_error, "Email is not configured");
  const unknownId = await insert("fax");
  await runClaimedJob(
    db,
    workerCoach.tenantId,
    await claimJob(db, workerCoach.tenantId),
  );
  row = await job(unknownId);
  assert.equal(row.status, "blocked");
  assert.equal(row.last_error, "No verified handler configured");
  // Finance handlers own their outcome; a dispatcher error does not rewrite it.
  const financeId = await insert("finance_fixture");
  let financeCalls = 0;
  await runClaimedJob(
    db,
    workerCoach.tenantId,
    await claimJob(db, workerCoach.tenantId),
    {
      ...defaultHandlers,
      finance: async () => {
        financeCalls++;
        throw new Error("Synthetic finance persistence failure");
      },
    },
  );
  assert.equal(financeCalls, 1);
  assert.equal((await job(financeId)).status, "pending");
  await db.tenant(workerCoach, (tx) =>
    tx.query("UPDATE jobs SET status='cancelled' WHERE id=$1", [financeId]),
  );
  // A nutrition exception blocks with a recovery backoff; a model spending cap waits
  // for the next Asia/Dubai day without consuming an attempt.
  const weekId = await insert("nutrition_week");
  await runClaimedJob(
    db,
    workerCoach.tenantId,
    await claimJob(db, workerCoach.tenantId),
    {
      ...defaultHandlers,
      nutrition: async () => ({ status: "exception", code: "TARGET_REVIEW" }),
    },
  );
  row = await job(weekId);
  assert.equal(row.status, "blocked");
  assert.equal(row.last_error, "TARGET_REVIEW");
  assert.ok(row.wait > 840 && row.wait <= 900, String(row.wait));
  const cappedId = await insert("nutrition_week");
  await runClaimedJob(
    db,
    workerCoach.tenantId,
    await claimJob(db, workerCoach.tenantId),
    {
      ...defaultHandlers,
      nutrition: async () => {
        throw Object.assign(new Error("cap"), {
          statusCode: 429,
          code: "MODEL_DAILY_LIMIT",
        });
      },
    },
  );
  row = await job(cappedId);
  assert.equal(row.status, "pending");
  assert.equal(row.attempts, 0);
  assert.equal(row.last_error, "MODEL_DAILY_LIMIT");
  const dubai = 4 * 3600000,
    nextDay =
      Math.floor((Date.now() + dubai) / 86400000) * 86400000 + 86400000 - dubai;
  assert.ok(
    Math.abs(new Date(row.available_at).getTime() - nextDay) < 5000,
    String(row.available_at),
  );
});

test("a pre-dispatch spending refusal leaves the week retryable and the same job delivers later", async () => {
  const s1 = await subscriber("cap");
  await scheduleNutrition(db, owner.tenantId);
  const [job] = await jobsFor(s1.userId);
  assert.ok(job);
  const [used] = await rows(
    "SELECT count(*)::int AS n FROM cost_events WHERE created_at >= date_trunc('day',now() AT TIME ZONE 'Asia/Dubai') AT TIME ZONE 'Asia/Dubai'",
  );
  process.env.MODEL_MAX_DAILY_CALLS = String(used.n);
  const before = modelCalls;
  try {
    await assert.rejects(executeNutritionJob(db, owner.tenantId, job), {
      code: "MODEL_DAILY_LIMIT",
    });
  } finally {
    process.env.MODEL_MAX_DAILY_CALLS = "1000";
  }
  assert.equal(modelCalls, before);
  const [request] = await rows(
    "SELECT * FROM records WHERE kind='nutrition_request' AND owner_user_id=$1",
    [s1.userId],
  );
  assert.equal(request.status, "retryable");
  assert.equal(request.data.providerState, "not_sent");
  assert.equal(
    (
      await rows(
        "SELECT id FROM records WHERE kind='nutrition_exception' AND owner_user_id=$1",
        [s1.userId],
      )
    ).length,
    0,
  );
  const result: any = await executeNutritionJob(db, owner.tenantId, job);
  assert.equal(result.plan.status, "delivered");
  assert.equal(result.plan.data.weekStart, job.data.weekStart);
  assert.equal(modelCalls, before + 1);
  // A request interrupted before dispatch (still not_sent after its lease) is resumed
  // under the same intent instead of blocking until the coach intervenes.
  const requestKey = randomUUID(),
    weekStart = dateOffset(today, 7);
  await db.tenant(owner, async (tx) => {
    const r = await putRecord(
      tx,
      owner,
      "nutrition_request",
      {
        requestKey,
        weekStart,
        profileId: s1.profile.id,
        releaseId: release.id,
        providerState: "not_sent",
        attempt: 1,
      },
      { ownerId: s1.userId, status: "running" },
    );
    await tx.query(
      "UPDATE records SET updated_at=now()-interval '5 minutes' WHERE id=$1",
      [r.id],
    );
  });
  const resumed = await ok(
    "/nutrition/generate",
    "POST",
    { requestKey, weekStart },
    s1,
  );
  assert.equal(resumed.plan?.status, "delivered", JSON.stringify(resumed));
  assert.equal(modelCalls, before + 2);
});

test("a deterministic validation failure is routed to the coach once instead of paid again daily", async () => {
  const s2 = await subscriber("invalid");
  await scheduleNutrition(db, owner.tenantId);
  const [job] = await jobsFor(s2.userId);
  invalid = true;
  const before = modelCalls;
  let result: any;
  try {
    result = await executeNutritionJob(db, owner.tenantId, job);
  } finally {
    invalid = false;
  }
  assert.equal(result.status, "exception");
  assert.equal(modelCalls, before + 1);
  // The next local day would otherwise produce a fresh intent key and a new paid call.
  await rows(
    "UPDATE jobs SET intent_key=intent_key||':previous-day',status='blocked' WHERE id=$1",
    [job.id],
  );
  await scheduleNutrition(db, owner.tenantId);
  // A provider-answered failure is never requeued by automatic not-sent recovery.
  const held = await jobsFor(s2.userId);
  assert.equal(held.length, 1);
  assert.equal(held[0].status, "blocked");
  const [open] = await rows(
    "SELECT * FROM records WHERE kind='nutrition_exception' AND owner_user_id=$1 AND status='open'",
    [s2.userId],
  );
  assert.ok(open);
  await ok("/nutrition/exceptions/" + open.id + "/resolve", "POST", {
    resolution: "Checked the recipes with the client; try the week again.",
  });
  await scheduleNutrition(db, owner.tenantId);
  const jobs = await jobsFor(s2.userId);
  assert.equal(jobs.length, 2);
  const delivered: any = await executeNutritionJob(db, owner.tenantId, jobs[1]);
  assert.equal(delivered.plan.status, "delivered");
  assert.equal(modelCalls, before + 2);
});

test("a scheduled week blocked before dispatch recovers automatically for the same week after backoff", async () => {
  const s3 = await subscriber("target");
  const target = {
    kcal: 1500,
    protein: 75,
    carbohydrate: 180,
    fat: 45,
    macroTolerancePercent: 20,
    hydrationMl: 2000,
    habits: ["Synthetic habit"],
    reviewOn: today,
    reason: "Individual synthetic arithmetic fixture",
    allowAutomaticAdjustment: false,
  };
  // An individual target bound to an earlier intake needs coach review first.
  const stale = await db.tenant(owner, (tx) =>
    putRecord(
      tx,
      owner,
      "nutrition_target",
      {
        target,
        profileId: randomUUID(),
        previousId: null,
        method: null,
        allowedUses: ["render", "model_prompt"],
      },
      { ownerId: s3.userId, status: "active" },
    ),
  );
  await scheduleNutrition(db, owner.tenantId);
  const [job] = await jobsFor(s3.userId);
  const weekStart = job.data.weekStart;
  await runClaimedJob(db, owner.tenantId, await claim(job.id));
  let [row] = await jobsFor(s3.userId);
  assert.equal(row.status, "blocked");
  assert.equal(row.last_error, "TARGET_REVIEW");
  const [opened] = await rows(
    "SELECT * FROM records WHERE kind='nutrition_exception' AND owner_user_id=$1 AND status='open'",
    [s3.userId],
  );
  assert.equal(opened.data.code, "TARGET_REVIEW");
  // Before the backoff elapses nothing is requeued or duplicated.
  await scheduleNutrition(db, owner.tenantId);
  [row] = await jobsFor(s3.userId);
  assert.equal(row.status, "blocked");
  assert.equal((await jobsFor(s3.userId)).length, 1);
  await ok(`/nutrition/clients/${s3.userId}/target`, "POST", {
    previousId: stale.id,
    profileId: s3.profile.id,
    target,
    methodId: null,
  });
  await rows(
    "UPDATE jobs SET available_at=now()-interval '1 second' WHERE id=$1",
    [job.id],
  );
  await scheduleNutrition(db, owner.tenantId);
  const jobs = await jobsFor(s3.userId);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].status, "pending");
  const [recovery] = await rows(
    "SELECT * FROM records WHERE kind='nutrition_recovery' AND data->>'jobId'=$1",
    [job.id],
  );
  assert.equal(recovery.data.action, "automatic_retry_unsent");
  await runClaimedJob(db, owner.tenantId, await claim(job.id));
  assert.equal((await jobsFor(s3.userId))[0].status, "completed");
  const [plan] = await rows(
    "SELECT * FROM records WHERE kind='nutrition_plan' AND owner_user_id=$1 AND status='delivered'",
    [s3.userId],
  );
  assert.equal(plan.data.weekStart, weekStart);
});

test("one subscriber cannot exhaust the workspace's daily nutrition model allowance", async () => {
  const s4 = await subscriber("allowance");
  process.env.MODEL_MAX_DAILY_CALLS_PER_SUBSCRIBER = "2";
  invalid = true;
  const before = modelCalls;
  try {
    for (const offset of [0, 1]) {
      const r = await ok(
        "/nutrition/generate",
        "POST",
        { requestKey: randomUUID(), weekStart: dateOffset(today, offset) },
        s4,
      );
      assert.equal(r.status, "exception");
    }
    const third = await req(
      "/nutrition/generate",
      "POST",
      { requestKey: randomUUID(), weekStart: dateOffset(today, 2) },
      s4,
    );
    assert.equal(third.statusCode, 429, third.body);
    assert.equal(third.json().code, "MODEL_USER_LIMIT");
    assert.equal(modelCalls, before + 2);
    await assert.rejects(
      modelAccounting(
        db,
        { tenantId: owner.tenantId, userId: s4.userId, role: "subscriber" },
        "meal_photo_estimate",
      ).reserve("nutrition-ops-fixture"),
      { code: "MODEL_USER_LIMIT" },
    );
  } finally {
    invalid = false;
    process.env.MODEL_MAX_DAILY_CALLS_PER_SUBSCRIBER = "100";
  }
  // Coach work is not limited by the subscriber allowance.
  const draft = await ok("/nutrition/recipes/draft", "POST", {
    request: "A quick synthetic lunch from the confirmed ingredients",
  });
  assert.equal(draft.recipe.name, "Drafted synthetic bowl");
  assert.equal(modelCalls, before + 3);
  // Subscriber nutrition calls together leave the final fifth for coach work.
  await db.tenant(workerCoach, async (tx) => {
    for (let i = 0; i < 8; i++)
      await tx.query(
        "INSERT INTO cost_events(id,tenant_id,user_id,task,provider,model,input_tokens,output_tokens,cost_usd,status) VALUES($1,$2,$3,'nutrition_week','configured-model','fixture',NULL,NULL,NULL,'reserved')",
        [randomUUID(), workerCoach.tenantId, randomUUID()],
      );
  });
  // A current follower of that workspace: model_usage_today() answers the
  // workspace-wide counts only to members (migration 061).
  const follower = randomUUID();
  await db.system(async (tx) => {
    await tx.query(
      "INSERT INTO users(id,name,email,password_hash) VALUES($1,'Ops allowance follower',$2,'fixture-unused')",
      [follower, `ops-allowance-${follower}@example.test`],
    );
    await tx.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'subscriber')",
      [workerCoach.tenantId, follower],
    );
  });
  process.env.MODEL_MAX_DAILY_CALLS = "10";
  try {
    await assert.rejects(
      modelAccounting(
        db,
        {
          tenantId: workerCoach.tenantId,
          userId: follower,
          role: "subscriber",
        },
        "nutrition_week",
      ).reserve("fixture"),
      { code: "MODEL_DAILY_LIMIT" },
    );
    await modelAccounting(
      db,
      { ...workerCoach, role: "owner" },
      "nutrition_evaluation",
    ).reserve("fixture");
  } finally {
    process.env.MODEL_MAX_DAILY_CALLS = "1000";
  }
});

test("teaching changes keep the release pin, then plans from earlier releases and coach weeks can be swapped", async () => {
  const s5 = await subscriber("release");
  const p1 = (
    await ok(
      "/nutrition/generate",
      "POST",
      { requestKey: randomUUID(), weekStart: today },
      s5,
    )
  ).plan;
  const p2 = (
    await ok(
      "/nutrition/generate",
      "POST",
      { requestKey: randomUUID(), weekStart: dateOffset(today, 14) },
      s5,
    )
  ).plan;
  const coachWeek = await ok(`/nutrition/clients/${s5.userId}/plan`, "POST", {
    weekStart: dateOffset(today, 7),
    profileId: s5.profile.id,
    previousId: null,
    previousVersion: null,
    week: fixtureWeek(
      recipes,
      cases.map((c) => c.id),
    ),
    reason: "Coach-assigned synthetic week for release changes",
  });
  assert.equal(coachWeek.data.releaseId, null);
  const first = release.id;
  // A catalog change halts new weeks and swaps with a clear, specific status.
  const { id: _, ...extra } = fixtureCatalog().foods[0];
  await ok("/nutrition/foods", "POST", {
    food: { ...extra, name: "Additional synthetic ingredient" },
  });
  const coach = await ok("/nutrition/coach");
  assert.equal(coach.ready, false);
  assert.ok(
    coach.gaps.some((g: string) => g.includes("changed after activation")),
    JSON.stringify(coach.gaps),
  );
  const halted = await req(
    "/nutrition/generate",
    "POST",
    { requestKey: randomUUID(), weekStart: dateOffset(today, 21) },
    s5,
  );
  assert.equal(halted.statusCode, 409);
  assert.equal(halted.json().code, "NUTRITION_NOT_READY");
  await qualify();
  assert.notEqual(release.id, first);
  // A week from the earlier release validates against the active release.
  const swapped = await ok(
    `/nutrition/plans/${p1.id}/swap`,
    "POST",
    {
      expectedVersion: p1.version,
      date: today,
      slot: "Breakfast",
      recipeId: recipes[0].id,
      variantKey: "microwave",
      servings: 1,
    },
    s5,
  );
  assert.equal(swapped.plan.data.releaseId, release.id);
  assert.equal(swapped.plan.data.digest, release.data.digest);
  // A coach-assigned week is reused by /generate, has options and can be swapped.
  const coachReuse = await ok(
    "/nutrition/generate",
    "POST",
    { requestKey: randomUUID(), weekStart: dateOffset(today, 7) },
    s5,
  );
  assert.equal(coachReuse.reused, true);
  assert.equal(coachReuse.plan.id, coachWeek.id);
  const options = await ok(
    `/nutrition/plans/${coachWeek.id}/options`,
    "GET",
    undefined,
    s5,
  );
  assert.ok(options.recipes.length >= 3);
  const coachSwap = await ok(
    `/nutrition/plans/${coachWeek.id}/swap`,
    "POST",
    {
      expectedVersion: coachWeek.version,
      date: dateOffset(today, 7),
      slot: "Breakfast",
      recipeId: recipes[0].id,
      variantKey: "microwave",
      servings: 1,
    },
    s5,
  );
  assert.equal(coachSwap.plan.data.coachAssignedId, coachWeek.id);
  assert.equal(
    (
      await ok(
        "/nutrition/generate",
        "POST",
        { requestKey: randomUUID(), weekStart: dateOffset(today, 7) },
        s5,
      )
    ).plan.id,
    coachSwap.plan.id,
  );
  // An automatic week from the earlier release is replaced once under the active release.
  const before = modelCalls;
  const regenerated = await ok(
    "/nutrition/generate",
    "POST",
    { requestKey: randomUUID(), weekStart: dateOffset(today, 14) },
    s5,
  );
  assert.equal(regenerated.reused, false);
  assert.equal(regenerated.plan.data.releaseId, release.id);
  assert.equal(regenerated.plan.data.previousId, p2.id);
  assert.equal(modelCalls, before + 1);
  const [archived] = await rows("SELECT status FROM records WHERE id=$1", [
    p2.id,
  ]);
  assert.equal(archived.status, "archived");
  const again = await ok(
    "/nutrition/generate",
    "POST",
    { requestKey: randomUUID(), weekStart: dateOffset(today, 14) },
    s5,
  );
  assert.equal(again.reused, true);
  assert.equal(modelCalls, before + 1);
});

test("knowledge ingestion, model drafts, release pause, single-use exception teaching, check-ins and pantry", async () => {
  // Sources: coach text is confirmed; imported documents wait for confirmation.
  const source = await ok("/nutrition/sources", "POST", {
    title: "Synthetic coach notes",
    text: "Prefer measured portions and reviewed recipes for everyday meals.",
    rights: true,
  });
  assert.equal(source.status, "confirmed");
  const document = await ok("/nutrition/documents", "POST", {
    title: "Synthetic imported guide",
    fileName: "guide.txt",
    contentBase64: Buffer.from(
      "Imported synthetic guidance about batch cooking and storage.",
    ).toString("base64"),
    rights: true,
  });
  assert.equal(document.status, "extracted");
  const compiled = await ok("/nutrition/policy/compile", "POST", {});
  assert.equal(compiled.status, "draft");
  // Identifiers reach the model as short references (prompt-refs), so the
  // sent sources are recognised by their titles and no full ID is sent.
  const sent = lastInput("nutrition_policy").input.sources.map(
    (s: any) => s.data.title,
  );
  assert.ok(sent.includes("Synthetic coach notes"));
  assert.ok(!sent.includes("Synthetic imported guide"));
  assert.ok(!JSON.stringify(lastInput("nutrition_policy")).includes(source.id));
  assert.match(lastInput("nutrition_policy").input.sources[0].id, /^S\d+$/);
  assert.ok(
    compiled.data.policy === null ||
      !compiled.data.policy.sourceIds.includes(document.id),
  );
  assert.ok(
    (compiled.data.policy ?? compiled.data.partialPolicy).sourceIds.includes(
      source.id,
    ),
  );
  await ok(`/nutrition/sources/${document.id}/confirm`, "POST", {});
  await ok("/nutrition/policy/compile", "POST", {});
  assert.ok(
    lastInput("nutrition_policy")
      .input.sources.map((s: any) => s.data.title)
      .includes("Synthetic imported guide"),
  );
  // Drafted recipes may only cite current ingredient facts and are not saved.
  const draft = await ok("/nutrition/recipes/draft", "POST", {
    request: "A quick synthetic lunch from the confirmed ingredients",
  });
  assert.ok(
    (await ok("/nutrition/coach")).foods.some(
      (f: any) => f.id === draft.recipe.variants[0].ingredients[0].foodId,
    ),
  );
  draftUnknownFood = true;
  try {
    const unknown = await req("/nutrition/recipes/draft", "POST", {
      request: "A quick synthetic lunch from the confirmed ingredients",
    });
    assert.equal(unknown.statusCode, 422);
  } finally {
    draftUnknownFood = false;
  }
  // Pause applies only to the active release and stops automatic delivery.
  const [archived] = await rows(
    "SELECT id FROM records WHERE kind='nutrition_release' AND status='archived' LIMIT 1",
  );
  assert.equal(
    (await req(`/nutrition/releases/${archived.id}/pause`, "POST", {}))
      .statusCode,
    409,
  );
  const [active] = await rows(
    "SELECT id FROM records WHERE kind='nutrition_release' AND status='published'",
  );
  await ok(`/nutrition/releases/${active.id}/pause`, "POST", {});
  assert.equal(
    (await req(`/nutrition/releases/${active.id}/pause`, "POST", {}))
      .statusCode,
    409,
  );
  const s6 = await subscriber("paused");
  assert.equal(await scheduleNutrition(db, owner.tenantId), 0);
  assert.equal((await jobsFor(s6.userId)).length, 0);
  const coach = await ok("/nutrition/coach");
  assert.ok(
    coach.gaps.some((g: string) =>
      g.startsWith("Automatic nutrition is paused"),
    ),
  );
  // Resolving an exception with teaching is single-use.
  const [open] = await rows(
    "SELECT * FROM records WHERE kind='nutrition_exception' AND status='open' ORDER BY created_at LIMIT 1",
  );
  assert.ok(open);
  const { id: __, ...teaching } = fixtureCases()[2];
  const body = {
    resolution: "Explained the portion limit and recorded the teaching.",
    teaching: {
      ...teaching,
      scenario:
        "A client exception about portions was reviewed after an automatic week was withheld.",
    },
  };
  assert.equal(
    (await ok(`/nutrition/exceptions/${open.id}/resolve`, "POST", body))
      .requiresNewRelease,
    true,
  );
  const repeated = await req(
    `/nutrition/exceptions/${open.id}/resolve`,
    "POST",
    body,
  );
  assert.equal(repeated.statusCode, 409);
  assert.equal(
    (
      await rows(
        "SELECT id FROM records WHERE kind='nutrition_case' AND data->>'exceptionId'=$1",
        [open.id],
      )
    ).length,
    1,
  );
  // Check-ins are idempotent by event key and fingerprint; future dates are refused.
  const checkin = {
    eventKey: randomUUID(),
    date: today,
    hunger: 3,
    difficulty: 2,
    weightKg: null,
    notes: "Synthetic check-in",
  };
  const saved = await ok("/nutrition/checkins", "POST", checkin, s6);
  assert.equal(
    (await ok("/nutrition/checkins", "POST", checkin, s6)).id,
    saved.id,
  );
  const changed = await req(
    "/nutrition/checkins",
    "POST",
    { ...checkin, hunger: 5 },
    s6,
  );
  assert.equal(changed.statusCode, 409);
  assert.equal(changed.json().code, "IDEMPOTENCY_CONFLICT");
  const future = await req(
    "/nutrition/checkins",
    "POST",
    { ...checkin, eventKey: randomUUID(), date: dateOffset(today, 2) },
    s6,
  );
  assert.equal(future.statusCode, 400);
  assert.equal(future.json().code, "CHECKIN_DATE");
  // Pantry entries must come from the subscriber's own grocery list.
  const [plan] = await rows(
    "SELECT * FROM records WHERE kind='nutrition_plan' AND status='delivered' AND owner_user_id<>$1 LIMIT 1",
    [s6.userId],
  );
  const ownPlan = await ok(`/nutrition/clients/${s6.userId}/plan`, "POST", {
    weekStart: today,
    profileId: s6.profile.id,
    previousId: null,
    previousVersion: null,
    week: fixtureWeek(
      recipes,
      cases.map((c) => c.id),
    ),
    reason: "Coach-assigned synthetic week for pantry checks",
  });
  const grocery = ownPlan.data.view.groceries[0].food.id;
  assert.equal(
    (
      await req(
        "/nutrition/pantry",
        "PUT",
        { planId: ownPlan.id, foodIds: [randomUUID()] },
        s6,
      )
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await req(
        "/nutrition/pantry",
        "PUT",
        { planId: plan.id, foodIds: [] },
        s6,
      )
    ).statusCode,
    400,
  );
  await ok(
    "/nutrition/pantry",
    "PUT",
    { planId: ownPlan.id, foodIds: [grocery] },
    s6,
  );
  const state = await ok("/nutrition", "GET", undefined, s6);
  const pantry = state.records.find((r: any) => r.kind === "nutrition_pantry");
  assert.deepEqual(pantry.data, { planId: ownPlan.id, foodIds: [grocery] });
});

test("prompts select relevant recipes and omit intake record IDs; oversized material gets an actionable 409", async () => {
  for (let i = 0; i < 20; i++) await bigRecipe("fixture-other-diet", "Other");
  // Catalog changes require requalification; evaluation sends only relevant recipes.
  await qualify();
  const evaluation = lastInput("nutrition_evaluation");
  assert.ok(evaluation.length < 180000, String(evaluation.length));
  assert.ok(
    evaluation.input.recipes.every((r: any) => r.dietTags.includes("balanced")),
  );
  const s7 = await subscriber("prompt");
  await ok(
    "/nutrition/checkins",
    "POST",
    {
      eventKey: randomUUID(),
      date: today,
      hunger: 3,
      difficulty: 3,
      weightKg: 70,
      notes: "Synthetic check-in",
    },
    s7,
  );
  const generated = await ok(
    "/nutrition/generate",
    "POST",
    { requestKey: randomUUID(), weekStart: today },
    s7,
  );
  assert.equal(generated.plan.status, "delivered");
  const week = lastInput("nutrition_week");
  assert.ok(week.length < 180000, String(week.length));
  assert.equal(week.input.recipes.length, 3);
  assert.ok(
    !JSON.stringify(week.input.recordedIntakeContext).includes("sourceId"),
  );
  assert.equal(week.input.recordedIntakeContext.consumed.weights[0].kg, 70);
  // Material that cannot be narrowed produces a readiness gap and a typed refusal
  // before any provider request.
  for (let i = 0; i < 20; i++) await bigRecipe("balanced", "Breakfast");
  const coach = await ok("/nutrition/coach");
  assert.ok(
    coach.gaps.some((g: string) => g.includes("model request bound")),
    JSON.stringify(coach.gaps),
  );
  const before = modelCalls;
  const refused = await req("/nutrition/evaluate", "POST", {});
  assert.equal(refused.statusCode, 409, refused.body);
  assert.equal(refused.json().code, "NUTRITION_CONTEXT_TOO_LARGE");
  assert.match(refused.json().message, /Archive unused recipes/);
  assert.equal(modelCalls, before);
});
