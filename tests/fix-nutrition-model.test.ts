/**
 * API flows of the nutrition model fixes (track F4): stated numbers and short
 * references in meal-week requests, declined and impossible weeks routed to
 * the coach, lease timing of weekly plans, policy compilation with blanks and
 * the evaluation contract. The fake provider replays the trial's reply shapes
 * (tests/nutrition-trial-fixtures.ts); see tests/fix-nutrition-trial.test.ts
 * for the pure checks.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, putRecord, type Database } from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";
import { claimJob } from "../apps/worker/src/dispatch.ts";
import {
  fixtureCases,
  fixturePolicy,
  fixtureCatalog,
  fixtureProfile,
  fixtureWeek,
} from "./nutrition-fixtures.ts";
import { trialReplies } from "./nutrition-trial-fixtures.ts";
import {
  nutritionTarget,
  localDate,
  scaledNutrients,
} from "../packages/domain/src/nutrition.ts";
import { principleForCategory } from "../packages/domain/src/nutrition-learning.ts";
import {
  nutritionBudget,
  NUTRITION_WEEK_LEASE_SECONDS,
} from "../packages/providers/src/nutrition.ts";

let db: Database,
  app: Awaited<ReturnType<typeof buildApp>>,
  owner: any,
  workerCoach: any,
  cases: any[] = [],
  recipes: any[] = [],
  foods: any[] = [];
const today = localDate("Asia/Dubai"),
  origin = "http://localhost:3000",
  originalFetch = globalThis.fetch,
  originalTimeout = AbortSignal.timeout;
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
const UUID_TEXT =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
type Sent = {
  task: string;
  input: any;
  system: string;
  content: string;
  maxTokens: number;
  timeoutMs: number | undefined;
};
const sent: Sent[] = [];
const last = (task: string) => sent.filter((s) => s.task === task).at(-1)!;
let modelCalls = 0;
/** Replaces the default answer for one task while set. */
const override: Partial<Record<string, (input: any) => unknown>> = {};
/** Holds the provider answer until released (to observe an in-flight week). */
let hold: Promise<void> | null = null;
let timeouts: number[] = [];

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
      password: "NutritionModelFixture2026!",
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
async function subscriber(label: string, profile = fixtureProfile) {
  const email = `model-${label}@example.test`;
  const invite = await ok("/invitations", "POST", {
    email,
    role: "subscriber",
  });
  const r = await req(
    "/invitations/accept",
    "POST",
    {
      token: invite.url.split("/").pop(),
      name: "Model " + label,
      email,
      password: "NutritionModelFixture2026!",
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
    { profile, processingConsent: true, modelConsent: true, version: 0 },
    user,
  );
  return user;
}
const rows = (sql: string, params: unknown[] = []) =>
  db.tenant(owner, (tx) => tx.query(sql, params));
const generate = (user: any, requestKey = randomUUID()) =>
  req("/nutrition/generate", "POST", { requestKey, weekStart: today }, user);
/**
 * Nutrients as a model states them after rounding to whole kcal and 0.1 g:
 * up to half a unit away from the app's figures (the trial's 572 for 571.8).
 */
const stated = (n: Record<string, number | null>) => ({
  kcal: n.kcal === null ? null : n.kcal + 0.4,
  protein: n.protein === null ? null : n.protein - 0.04,
  carbohydrate: n.carbohydrate === null ? null : n.carbohydrate + 0.04,
  fat: n.fat === null ? null : n.fat,
});
function evaluationAnswer(input: any) {
  return {
    decisions: input.scenarios.map((s: any) => {
      let target: number | null = null;
      try {
        target = nutritionTarget(input.policy, s.profile);
      } catch {}
      // The request does not name a scenario's category; like the trial's
      // checks, these prompts start with it, as a coach may write them. Like
      // every trial model, the answer cites the diet teaching for an
      // unsupported diet.
      const category = /^\[([a-z_-]+)\]/.exec(s.prompt)![1],
        cited = s.prompt.includes("unsupported-diet") ? "diet" : category;
      const teaching = input.cases.find((c: any) => c.data.category === cited),
        recipe = input.recipes.find((r: any) =>
          r.slots.includes(s.requestedMealSlot),
        ),
        variant = recipe.variants.find((v: any) => v.key === "hob"),
        ingredients = variant.ingredients.map((i: any) => ({
          foodId: i.foodId,
          grams: i.grams,
        }));
      return {
        scenarioId: s.id,
        action: target === null ? "exception" : "plan",
        targetKcal: target,
        caseIds: [teaching.id],
        reason: "Applies the confirmed synthetic fixture policy.",
        principle: (principleForCategory as Record<string, string>)[category],
        rationaleEvidence: { caseId: teaching.id, quote: teaching.data.reason },
        sampleMeal:
          target === null
            ? null
            : {
                slot: s.requestedMealSlot,
                recipeId: recipe.id,
                variantKey: variant.key,
                servings: 1,
                ingredients,
                nutrients: stated(
                  scaledNutrients(
                    ingredients.map((i: any) => ({
                      food: input.foods.find((f: any) => f.id === i.foodId),
                      grams: i.grams,
                    })),
                    1,
                  ),
                ),
              },
      };
    }),
  };
}

before(async () => {
  db = await createDatabase({ memory: true });
  app = await buildApp({ db, testing: true });
  owner = await register("nutrition-model-coach");
  workerCoach = await register("nutrition-model-worker");
  Object.assign(process.env, {
    MODEL_BASE_URL: "https://nutrition-model.invalid/v1",
    MODEL_API_KEY: "synthetic-model-key",
    MODEL_NAME: "nutrition-model-fixture",
    MODEL_PRICE_VERSION: "fixture-v1",
    MODEL_INPUT_USD_PER_MILLION: "1",
    MODEL_OUTPUT_USD_PER_MILLION: "2",
    MODEL_MAX_DAILY_CALLS: "1000",
    MODEL_MAX_DAILY_CALLS_PER_SUBSCRIBER: "100",
  });
  // The provider call's abort time is the only argument AbortSignal.timeout gets here.
  AbortSignal.timeout = (ms: number) => {
    timeouts.push(ms);
    return originalTimeout.call(AbortSignal, ms);
  };
  globalThis.fetch = async (url, options) => {
    assert.equal(
      String(url),
      "https://nutrition-model.invalid/v1/chat/completions",
    );
    modelCalls++;
    const body = JSON.parse(String(options?.body)),
      content = body.messages[1].content,
      { task, input } = JSON.parse(content);
    sent.push({
      task,
      input,
      content,
      system: body.messages[0].content,
      maxTokens: body.max_tokens,
      timeoutMs: timeouts.at(-1),
    });
    if (hold) await hold;
    let output: any = override[task]?.(input);
    if (output === undefined) {
      if (task === "nutrition_evaluation") output = evaluationAnswer(input);
      else if (task === "nutrition_week")
        output = fixtureWeek(
          input.recipes,
          input.cases.map((c: any) => c.id),
        );
      else throw new Error("Unexpected model task " + task);
    }
    return new Response(
      JSON.stringify({
        id: "model-request-" + modelCalls,
        choices: [
          {
            message: {
              content:
                typeof output === "string" ? output : JSON.stringify(output),
            },
          },
        ],
        usage: { prompt_tokens: 200, completion_tokens: 100 },
      }),
      { status: 200 },
    );
  };
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
    reason: "Confirmed synthetic model-contract policy",
  });
  await ok("/nutrition/policy/" + policy.id + "/confirm", "POST", {});
  for (let i = 0; i < 24; i++) {
    const c = cases[i % cases.length],
      exception = i >= 20;
    await ok("/nutrition/scenarios", "POST", {
      category: c.data.category,
      prompt: `[${c.data.category}] Unseen model-contract situation ${i}; apply the available evidence.`,
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
});
after(async () => {
  globalThis.fetch = originalFetch;
  AbortSignal.timeout = originalTimeout;
  for (const k of envKeys) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await app.close();
  await db.close();
});

test("evaluation keeps each check's category from the model, scales its budget and accepts the teaching behind a safety limit", async () => {
  const evaluation = await ok("/nutrition/evaluate", "POST", {});
  // Rounded worked meals and a diet-case citation for the unsupported-diet
  // check both failed every trial model; the v3 contract accepts them.
  assert.equal(
    evaluation.status,
    "passed",
    JSON.stringify(evaluation.data.outcomes),
  );
  const request = last("nutrition_evaluation");
  assert.equal(request.input.scenarios.length, 28);
  // The category of a held-out check is the coach's answer key: the model
  // must work out the principle itself (it gets only the category map).
  assert.ok(request.input.scenarios.every((s: any) => !("category" in s)));
  assert.deepEqual(request.input.categoryPrinciples, principleForCategory);
  assert.doesNotMatch(
    request.system,
    /Each scenario gives its teaching category/,
  );
  assert.match(
    request.system,
    /Decide which teaching category each scenario falls under/,
  );
  const budget = nutritionBudget("nutrition_evaluation", { scenarios: 28 });
  assert.equal(request.maxTokens, budget.maxTokens);
  assert.equal(request.timeoutMs, budget.timeoutMs);
  assert.ok(budget.timeoutMs > 30000);
  // v4: the quote is 4 to 15 consecutive words from the cited case itself.
  assert.match(request.system, /4 to 15 consecutive words \(at least 12 characters\)/);
  assert.match(request.system, /of the case given as caseId, which must also be in caseIds; never quote a scenario or another case/);
  assert.match(request.system, /nearest whole number/);
  assert.ok(!UUID_TEXT.test(request.content), "no full IDs are sent");
  assert.ok(request.input.scenarios.every((s: any) => /^Q\d+$/.test(s.id)));
  // Decisions are stored with the real scenario and case IDs.
  const caseIds = new Set(cases.map((c) => c.id));
  assert.ok(
    evaluation.data.decisions.every(
      (d: any) =>
        UUID_TEXT.test(d.scenarioId) &&
        d.caseIds.every((id: string) => caseIds.has(id)),
    ),
  );
  const diet = evaluation.data.systemScenarios.find((s: any) =>
    s.data.prompt.includes("unsupported-diet"),
  );
  assert.deepEqual(
    [...diet.data.acceptedCaseIds].sort(),
    cases
      .filter((c) => ["boundaries", "diet"].includes(c.data.category))
      .map((c) => c.id)
      .sort(),
  );
  const preview = await ok("/nutrition/preview", "POST", {
    profile: fixtureProfile,
    weekStart: today,
  });
  await ok("/nutrition/releases", "POST", {
    evaluationId: evaluation.id,
    previewId: preview.id,
    confirmed: true,
  });
  assert.equal((await ok("/nutrition/coach")).ready, true);
});

test("a meal-week request states the week's numbers, sends references and delivers the decoded plan", async () => {
  const s1 = await subscriber("numbers");
  timeouts = [];
  const r = await generate(s1);
  assert.equal(r.statusCode, 200, r.body);
  const plan = r.json().plan;
  assert.equal(plan.status, "delivered");
  const request = last("nutrition_week");
  // Daily range (1500 ± 5%), portions, slots and repeats, stated as numbers.
  for (const expected of [
    "between 1425 and 1575 kcal",
    "from 0.5 to 2, in steps of 0.25",
    "Breakfast, Lunch, Dinner",
    "at most 7 times in the week",
  ])
    assert.ok(request.system.includes(expected), expected);
  assert.equal(request.maxTokens, 12000);
  assert.equal(request.timeoutMs, 150000);
  // Short references instead of full IDs; each option shows one serving's nutrients.
  assert.ok(!UUID_TEXT.test(request.content));
  assert.ok(request.input.recipes.every((x: any) => /^M\d+$/.test(x.id)));
  assert.ok(request.input.foods.every((x: any) => /^G\d+$/.test(x.id)));
  assert.ok(request.input.cases.every((x: any) => /^X\d+$/.test(x.id)));
  const breakfast = request.input.recipes.find((x: any) =>
    x.slots.includes("Breakfast"),
  );
  assert.deepEqual(breakfast.variants[0].perServing, {
    kcal: 400,
    protein: 20,
    carbohydrate: 48,
    fat: 12,
  });
  // The stored week names the real recipes and cases.
  const recipeIds = new Set(recipes.map((x) => x.id));
  assert.ok(
    plan.data.choices.days.every((d: any) =>
      d.meals.every((m: any) => recipeIds.has(m.recipeId)),
    ),
  );
  assert.deepEqual(
    [...plan.data.choices.caseIds].sort(),
    cases.map((c) => c.id).sort(),
  );
  // The explanation the client reads never carries an identifier.
  assert.ok(!UUID_TEXT.test(plan.data.view.explanation));
});

test("a reply with a miscopied or unknown identifier becomes an exception, never a guess", async () => {
  for (const [label, damage] of [
    // The trial's Seed miscopy: a case ID without its last character.
    ["miscopy", (w: any) => ((w.caseIds[0] = cases[0].id.slice(0, -1)), w)],
    ["unknown", (w: any) => ((w.days[0].meals[0].recipeId = "M99"), w)],
  ] as const) {
    const user = await subscriber("id-" + label);
    override.nutrition_week = (input) => {
      const week: any = fixtureWeek(
        input.recipes,
        input.cases.map((c: any) => c.id),
      );
      return damage(week);
    };
    const before = modelCalls;
    let result: any;
    try {
      result = (await generate(user)).json();
    } finally {
      delete override.nutrition_week;
    }
    assert.equal(modelCalls, before + 1);
    assert.equal(result.status, "exception", JSON.stringify(result));
    assert.equal(result.code, "GENERATION_UNAVAILABLE");
    const [plan] = await rows(
      "SELECT id FROM records WHERE kind='nutrition_plan' AND owner_user_id=$1",
      [user.userId],
    );
    assert.equal(plan, undefined);
  }
  // A full-length copy that is one character off (a well-formed but unknown UUID).
  const user = await subscriber("id-near");
  override.nutrition_week = (input) => {
    const week: any = fixtureWeek(
      input.recipes,
      input.cases.map((c: any) => c.id),
    );
    const real = cases[0].id as string;
    week.caseIds = [real.slice(0, -1) + (real.endsWith("0") ? "1" : "0")];
    return week;
  };
  try {
    const result = (await generate(user)).json();
    assert.equal(result.code, "GENERATION_UNAVAILABLE");
  } finally {
    delete override.nutrition_week;
  }
});

test("a declined week goes to the coach with the model's reason; the client sees the general message", async () => {
  const s3 = await subscriber("declined");
  // Opus's reply shape for a week it could not build (trial T1S01).
  const trial = JSON.parse(trialReplies["opus:T1S01/meal_week"]);
  override.nutrition_week = (input) => ({
    days: [],
    caseIds: [input.cases[0].id],
    explanation: trial.explanation,
  });
  let result: any;
  try {
    result = (await generate(s3)).json();
  } finally {
    delete override.nutrition_week;
  }
  assert.equal(result.status, "exception");
  assert.equal(result.code, "PLAN_NOT_POSSIBLE");
  assert.ok(!("coachDetail" in result));
  assert.doesNotMatch(result.message, /dinner slot/);
  const [exception] = await rows(
    "SELECT * FROM records WHERE kind='nutrition_exception' AND owner_user_id=$1 AND status='open'",
    [s3.userId],
  );
  assert.equal(exception.data.code, "PLAN_NOT_POSSIBLE");
  assert.match(
    exception.data.coachDetail,
    /declined this week: No valid week can be built/,
  );
  const [request] = await rows(
    "SELECT * FROM records WHERE kind='nutrition_request' AND owner_user_id=$1",
    [s3.userId],
  );
  assert.equal(request.status, "failed");
  assert.equal(request.data.providerState, "responded");
  assert.ok(!JSON.stringify(request.data).includes("dinner slot"));
  // The client's own view has the message only; the coach sees the detail.
  const mine = await ok("/nutrition", "GET", undefined, s3);
  assert.deepEqual(Object.keys(mine.exceptions[0]).sort(), [
    "code",
    "id",
    "message",
    "status",
  ]);
  const coach = await ok("/nutrition/coach");
  assert.ok(
    coach.records.some(
      (x: any) =>
        x.kind === "nutrition_exception" &&
        x.owner_user_id === s3.userId &&
        /No valid week/.test(x.data.coachDetail),
    ),
  );
});

test("a coach boundary in the client's notes stops the week before any model call", async () => {
  // The trial's T2S05 and T3S02 notes (osteopenia with vitamin D; Ramadan
  // meal timing) passed every code gate in the trial, and an Arabic note.
  for (const [label, notes] of [
    ["osteopenia", "Osteopenia; takes vitamin D."],
    [
      "ramadan",
      "Fasting during Ramadan: eats only at suhoor (before dawn) and iftar (sunset).",
    ],
    ["ramadan-ar", "صائمة في رمضان وآكل عند السحور فقط"],
  ]) {
    const user = await subscriber("boundary-" + label, {
      ...fixtureProfile,
      notes,
    });
    const before = modelCalls;
    const r = await generate(user);
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().status, "exception", label);
    assert.equal(r.json().code, "SCOPE_REVIEW", label);
    assert.equal(modelCalls, before, "no model is asked: " + label);
    const [plan] = await rows(
      "SELECT id FROM records WHERE kind='nutrition_plan' AND owner_user_id=$1",
      [user.userId],
    );
    assert.equal(plan, undefined);
    const [exception] = await rows(
      "SELECT * FROM records WHERE kind='nutrition_exception' AND owner_user_id=$1 AND status='open'",
      [user.userId],
    );
    assert.equal(exception.data.code, "SCOPE_REVIEW");
  }
});

test("the trial's boundary declines end with the coach and no plan, whatever the notes say", async () => {
  // A boundary the code screen has no word for reaches the model; the week
  // request tells it to decline, and each trial decline (Seed, Opus and
  // Sonnet for T2S05 and T3S02) becomes PLAN_NOT_POSSIBLE for the coach.
  const notes = "Recovering from surgery last month.";
  for (const member of ["T2S05", "T3S02"])
    for (const model of ["seed", "opus", "sonnet"]) {
      const trial = JSON.parse(trialReplies[`${model}:${member}/meal_week`]);
      const user = await subscriber(`boundary-${model}-${member}`, {
        ...fixtureProfile,
        notes,
      });
      override.nutrition_week = (input) => {
        const ref = input.cases.find(
          (c: any) => c.data.category === "boundaries",
        ).id;
        return { ...trial, caseIds: [ref] };
      };
      let result: any;
      try {
        result = (await generate(user)).json();
      } finally {
        delete override.nutrition_week;
      }
      const label = model + " " + member;
      assert.equal(result.status, "exception", label);
      assert.equal(result.code, "PLAN_NOT_POSSIBLE", label);
      assert.ok(!("coachDetail" in result));
      const request = last("nutrition_week");
      assert.match(request.system, /Coach boundaries come first/);
      assert.equal(request.input.profile.notes, notes);
      const [plan] = await rows(
        "SELECT id FROM records WHERE kind='nutrition_plan' AND owner_user_id=$1",
        [user.userId],
      );
      assert.equal(plan, undefined, label);
      const [exception] = await rows(
        "SELECT * FROM records WHERE kind='nutrition_exception' AND owner_user_id=$1 AND status='open'",
        [user.userId],
      );
      assert.equal(exception.data.code, "PLAN_NOT_POSSIBLE", label);
      assert.ok(
        exception.data.coachDetail.includes(trial.explanation.slice(0, 60)),
        label,
      );
    }
});

test("a catalog that cannot fill the week goes to the coach before any model call", async () => {
  // Every fixture recipe option needs at least 10 minutes.
  const quick = { ...fixtureProfile, maxMinutes: 5 };
  const s4 = await subscriber("gap", quick);
  const before = modelCalls;
  const r = await generate(s4);
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().code, "CATALOG_GAP");
  assert.equal(modelCalls, before, "no model is paid for an impossible week");
  assert.equal(
    (
      await rows(
        "SELECT id FROM records WHERE kind='nutrition_request' AND owner_user_id=$1",
        [s4.userId],
      )
    ).length,
    0,
  );
  const [exception] = await rows(
    "SELECT * FROM records WHERE kind='nutrition_exception' AND owner_user_id=$1",
    [s4.userId],
  );
  assert.equal(exception.data.code, "CATALOG_GAP");
  assert.match(
    exception.data.coachDetail,
    /No recipe option fits this client for Breakfast, Lunch, Dinner .*up to 5 minutes/,
  );
  // The coach's preview for such a profile explains the gap directly.
  const preview = await req("/nutrition/preview", "POST", {
    profile: quick,
    weekStart: today,
  });
  assert.equal(preview.statusCode, 409);
  assert.equal(preview.json().code, "CATALOG_GAP");
  assert.match(preview.json().message, /No recipe option fits this client/);
  assert.equal(modelCalls, before);
});

test("an in-flight week holds its lease for the model timeout and answers GENERATION_PENDING meanwhile", async () => {
  const s5 = await subscriber("lease");
  // The manual job's lease while the provider has not answered yet.
  let release!: () => void;
  hold = new Promise<void>((resolve) => (release = resolve));
  const calls = modelCalls;
  const pending = generate(s5);
  // Bounded, so a request that never reaches the model fails here instead
  // of hanging the file (as it did when an earlier test left no release).
  for (let waited = 0; modelCalls === calls; waited += 5) {
    if (waited > 20000) {
      release();
      hold = null;
      assert.fail("the week never reached the model: " + (await pending).body);
    }
    await new Promise((r) => setTimeout(r, 5));
  }
  const [job] = await rows(
    "SELECT extract(epoch FROM leased_until-now())::float8 AS lease FROM jobs WHERE kind='nutrition_week' AND data->>'userId'=$1 AND status='running'",
    [s5.userId],
  );
  assert.ok(
    job.lease > NUTRITION_WEEK_LEASE_SECONDS - 30 &&
      job.lease <= NUTRITION_WEEK_LEASE_SECONDS,
    String(job.lease),
  );
  hold = null;
  release();
  assert.equal((await pending).json().plan.status, "delivered");
  // A request dispatched three minutes ago is still in flight (the old
  // two-minute window called it uncertain and sent the member to the coach).
  const running = await db.tenant(owner, async (tx) => {
    const r = await putRecord(
      tx,
      owner,
      "nutrition_request",
      {
        requestKey: randomUUID(),
        weekStart: today,
        profileId: s5.profile.id,
        providerState: "uncertain",
        attempt: 1,
      },
      { ownerId: s5.userId, status: "running" },
    );
    await tx.query(
      "UPDATE records SET updated_at=now()-interval '3 minutes' WHERE id=$1",
      [r.id],
    );
    return r;
  });
  const second = await req(
    "/nutrition/generate",
    "POST",
    { requestKey: randomUUID(), weekStart: dateAfter(7) },
    s5,
  );
  assert.equal(second.statusCode, 409, second.body);
  assert.equal(second.json().code, "GENERATION_PENDING");
  // After the lease, an unanswered dispatch needs the coach's reconciliation.
  await rows(
    `UPDATE records SET updated_at=now()-interval '${NUTRITION_WEEK_LEASE_SECONDS + 10} seconds' WHERE id=$1`,
    [running.id],
  );
  const third = await req(
    "/nutrition/generate",
    "POST",
    { requestKey: randomUUID(), weekStart: dateAfter(7) },
    s5,
  );
  assert.equal(third.json().code, "PROVIDER_RECONCILIATION");
});
function dateAfter(days: number) {
  return new Date(Date.parse(today + "T12:00:00Z") + days * 86400000)
    .toISOString()
    .slice(0, 10);
}

test("the worker's claim of a weekly plan outlasts its model timeout; other jobs keep two minutes", async () => {
  await db.tenant(workerCoach, (tx) =>
    tx.query("UPDATE jobs SET status='cancelled' WHERE status='pending'"),
  );
  const insert = async (kind: string, wait: number) => {
    const id = randomUUID();
    await db.tenant(workerCoach, (tx) =>
      tx.query(
        `INSERT INTO jobs(id,tenant_id,kind,intent_key,data,available_at) VALUES($1,$2,$3,$4,$5,now()-interval '${wait} seconds')`,
        [id, workerCoach.tenantId, kind, "model:" + id, JSON.stringify({})],
      ),
    );
    return id;
  };
  const week = await insert("nutrition_week", 20),
    email = await insert("email", 10);
  const lease = async () => {
    const job = (await claimJob(db, workerCoach.tenantId))!;
    const [row] = await db.tenant(workerCoach, (tx) =>
      tx.query(
        "SELECT extract(epoch FROM leased_until-now())::float8 AS lease FROM jobs WHERE id=$1",
        [job.id],
      ),
    );
    return { id: job.id, lease: row.lease };
  };
  const first = await lease(),
    second = await lease();
  assert.equal(first.id, week);
  assert.ok(
    first.lease > NUTRITION_WEEK_LEASE_SECONDS - 5,
    String(first.lease),
  );
  assert.ok(
    first.lease * 1000 > nutritionBudget("nutrition_week").timeoutMs + 60000,
  );
  assert.equal(second.id, email);
  assert.ok(second.lease > 110 && second.lease <= 120, String(second.lease));
});

test("policy compilation keeps blanks as questions for the coach and never confirms them", async () => {
  // Seed's T1 policy: every value taught except the calorie tolerance (null).
  const seed = JSON.parse(trialReplies["seed:T1/nutrition_policy"]);
  override.nutrition_policy = (input) => ({
    ...seed,
    policy: { ...seed.policy, sourceIds: input.cases.map((c: any) => c.id) },
  });
  let draft: any;
  try {
    draft = await ok("/nutrition/policy/compile", "POST", {});
  } finally {
    delete override.nutrition_policy;
  }
  assert.equal(draft.status, "draft");
  assert.equal(draft.data.policy, null);
  assert.equal(draft.data.partialPolicy.tolerancePercent, null);
  assert.deepEqual(
    draft.data.partialPolicy.sourceIds.sort(),
    cases.map((c) => c.id).sort(),
  );
  assert.ok(draft.data.gaps.some((g: string) => /tolerance/i.test(g)));
  const confirm = await req(
    `/nutrition/policy/${draft.id}/confirm`,
    "POST",
    {},
  );
  assert.equal(confirm.statusCode, 409);
  assert.equal(confirm.json().code, "POLICY_GAPS");
  // Opus's reply: policy null, questions, and conflicts described as objects.
  const opus = JSON.parse(trialReplies["opus:T1/nutrition_policy"]);
  override.nutrition_policy = (input) => ({
    ...opus,
    conflicts: opus.conflicts.map((c: any) => ({
      ...c,
      sourceIds: [input.cases[0].id],
    })),
  });
  try {
    const saved = await ok("/nutrition/policy/compile", "POST", {});
    assert.equal(saved.data.policy, null);
    assert.equal(saved.data.gaps.length, 3);
    assert.match(saved.data.conflicts[0], /Only I change targets/);
  } finally {
    delete override.nutrition_policy;
  }
  // A reply that is not a policy at all is still invalid output (nothing saved).
  override.nutrition_policy = () => trialReplies["haiku:T1/nutrition_policy"];
  try {
    const before = await rows(
      "SELECT count(*)::int AS n FROM records WHERE kind='nutrition_policy'",
    );
    const broken = await req("/nutrition/policy/compile", "POST", {});
    assert.equal(broken.statusCode, 503);
    const after = await rows(
      "SELECT count(*)::int AS n FROM records WHERE kind='nutrition_policy'",
    );
    assert.equal(after[0].n, before[0].n);
  } finally {
    delete override.nutrition_policy;
  }
  // The request itself names cases by reference only.
  assert.ok(!UUID_TEXT.test(last("nutrition_policy").content));
  assert.equal(last("nutrition_policy").maxTokens, 12000);
  assert.equal(last("nutrition_policy").timeoutMs, 150000);
});

test("nutrition screens health disclosures from training intake before model dispatch", async () => {
  const subscriberA = await subscriber("audit-intake");
  await ok("/intake", "POST", {
    age:32, goal:"Build strength", experience:"beginner", daysPerWeek:3,
    equipment:"Dumbbells", limitations:"I have diabetes and take insulin.", consent:true
  }, subscriberA);
  const disclosed = await db.tenant(subscriberA, async tx => ({
    profile: await tx.query("SELECT data->>'limitations' AS text FROM records WHERE kind='intake' AND owner_user_id=$1", [subscriberA.userId]),
    permission: await tx.query("SELECT granted FROM consent_records WHERE user_id=$1 AND document_type='coaching' ORDER BY created_at DESC,id DESC LIMIT 1", [subscriberA.userId]),
  }));
  assert.equal(disclosed.permission[0]?.granted, true);
  assert.match(disclosed.profile[0]?.text, /diabetes/);
  const { nutritionScopeSignals } = await import("../packages/domain/src/nutrition.ts");
  assert.ok(nutritionScopeSignals([disclosed.profile[0].text]).length > 0);
  const reply = await generate(subscriberA);
  assert.equal(reply.statusCode, 200, reply.body);
  assert.equal(reply.json().code, "SCOPE_REVIEW", JSON.stringify({status:reply.json().plan?.status,code:reply.json().code}));
  const subscriberB = await subscriber("audit-food", {...fixtureProfile,notes:"I have diabetes and take insulin."});
  const control = await generate(subscriberB);
  assert.equal(control.json().code, "SCOPE_REVIEW", control.body);
});

 test("meal weeks use permitted training schedules and corrected outcomes without estimating calorie burn",async () => {
  const m = await subscriber("coordinated",{...fixtureProfile,weightKg:75});
  await ok("/intake","POST",{age:30,goal:"Build strength",experience:"beginner",daysPerWeek:2,equipment:"Dumbbells",limitations:"",consent:true,availableWeekdays:[1,4],maxSessionMinutes:45},m);
  await db.tenant(owner,async tx => {
    const p = await putRecord(tx,owner,"program",{title:"Conditioning",exercises:[{name:"Row",sets:1,distanceMeters:500,restSeconds:0}]},{ownerId:m.userId,status:"assigned"});
    await putRecord(tx,owner,"planned_session",{date:today,label:"Conditioning",programId:p.id,program:p.data},{ownerId:m.userId,status:"planned"});
    const w = await putRecord(tx,owner,"workout",{programId:p.id,program:p.data},{ownerId:m.userId,status:"active"});
    const logId=randomUUID();
    await tx.query("INSERT INTO workout_events(id,tenant_id,user_id,workout_id,event_key,data) VALUES($1,$2,$3,$4,$5,$6)",[logId,owner.tenantId,m.userId,w.id,randomUUID(),JSON.stringify({exercise:"Row",exerciseIndex:0,set:1,reps:0,loadKg:0,distanceMeters:500})]);
    await putRecord(tx,owner,"workout_correction",{workoutId:w.id,eventId:logId,revision:1,values:{distanceMeters:400},note:"Tracker correction"},{ownerId:m.userId,status:"recorded"});
  });
  const response = await generate(m); assert.equal(response.statusCode,200,response.body); assert.ok(response.json().plan?.id, response.body.slice(0,500));
  const input = last("nutrition_week").input;
  assert.equal(input.profile.weightKg,75);
  assert.equal(input.recordedIntakeContext.training.upcoming.length,1);
  assert.equal(Number(input.recordedIntakeContext.training.recentReportedWork.reported_meters),400);
  assert.equal(response.json().plan.data.targetSource,"coach_goal_policy");
  assert.match(last("nutrition_week").system,/Do not estimate energy expenditure/);
 });
