import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, type Database, type Tx } from "@trainer/db";
import { safetySignal } from "@trainer/domain";
import { buildApp } from "../apps/api/src/app.ts";
import {
  fixtureCases,
  fixturePolicy,
  fixtureCatalog,
  fixtureProfile,
  fixtureWeek,
} from "./nutrition-fixtures.ts";
import {
  NutritionBlocked,
  allergenKey,
  nutritionCategories,
  nutritionExplanation,
  nutritionTarget,
  recipeCompatibility,
  localDate,
  dateOffset,
} from "../packages/domain/src/nutrition.ts";
import { principleForCategory } from "../packages/domain/src/nutrition-learning.ts";

test("a routine negation is honoured only when nothing in its sentence contradicts it", () => {
  for (const text of [
    "no pain until I squat, then sharp pain in my knee",
    "not dizzy but my chest hurts",
    "No pain at rest, only when I squat. Can I add weight?",
    "no pain before today but now my knee aches",
    "No pain but my ankle is swollen and bruised",
    "no pain at the start, then my shoulder gave out",
    "No pain at rest. Only when I squat.",
    "No pain at 2.5 kg but my knee clicks",
    "Zero pain while resting",
    "pain free except on stairs",
    "No pain, knee is swollen",
    "Knee swollen, no pain",
    "No injuries, although my wrist feels tender",
    "ما في ألم بس صدري يوجعني",
    "ما عندي ألم وقت الراحة بس لما أجري",
    "ما فيه ألم الحين، بس أمس كان قوي",
    "ما في ألم ولكن ركبتي منتفخة",
    "ما في ألم، ركبتي متورمة",
    "لا يوجد ألم إلا عند الجري",
    "ما احس بألم الا اذا ركضت",
    "ما عندي الام الا لما اركض",
    "ما في ألم. بس لما أجري",
  ])
    assert.equal(safetySignal(text), true, text);
  for (const text of [
    "no pain today",
    "pain-free session",
    "ما في ألم",
    "No pain at all, great session",
    "Zero pain this week",
    "Great session, no injuries",
    "Tired but no pain",
    "No pain. Great session!",
    "No pain today. When is my next session?",
    "ما في ألم، التمرين كان ممتاز",
    "ما عندي الام",
    "ما في ألم الحمد لله",
  ])
    assert.equal(safetySignal(text), false, text);
});

test("Arabic pains without madda and past-tense breathing are red flags; the mother is not", () => {
  for (const text of [
    "الام في الصدر",
    "عندي الام في ظهري",
    "ألام في ظهري",
    "عندي آلام في الركبة",
    "الالام",
    "الآلام في الركبة",
    "ما قدرت اتنفس",
    "ما اقدرت أتنفس",
    "ما استطعت التنفس",
    "لم أستطع التنفس",
  ])
    assert.equal(safetySignal(text), true, text);
  for (const text of [
    "الأم",
    "الأم تحب أولادها",
    "والأم كانت معي في النادي",
    "تمرين خفيف مع بالأم",
    "الأمر سهل",
  ])
    assert.equal(safetySignal(text), false, text);
});

test("the nutrition scope screen matches informal Arabic spellings of clinical terms", () => {
  const policy = fixturePolicy([randomUUID()]);
  for (const notes of [
    "انا مرضعه",
    "أنا مرضعة",
    "رضاعه طبيعيه",
    "رضاعة طبيعية",
    "حبلي في الشهر الرابع",
    "حبلى في الشهر الرابع",
    "عندي جلطه سابقة",
    "عندي جلطة سابقة",
    "الغده الدرقيه",
    "الغدة الدرقية",
    "اخذ ادويه للضغط",
    "آخذ أدوية للضغط",
    "مشاكل في الكلي",
    "مشاكل في الكلى",
    "حصوه كلي",
    "العلاج الكيميايي",
    "علاج كيميائي",
    "ضغط دم مرتفع",
    "تكميم المعده",
    "إنسولين",
  ])
    assert.throws(
      () => nutritionTarget(policy, { ...fixtureProfile, notes }),
      (e: any) => e instanceof NutritionBlocked && e.code === "SCOPE_REVIEW",
      notes,
    );
  for (const notes of [
    "Sugar-free drinks, kidney beans, chicken breast and chicken liver",
    "بدون سكر ومشروبات سكرية قليلة",
    "أحب حمل الأثقال وأكل سرطان البحر",
    "Medicine ball circuits and cardio, heart rate zone 2",
    "أبغى أغير أكلي بشكل كلي",
    "ضغط دمبل ثلاث جولات",
    "حبل القفز كل يوم",
  ])
    assert.equal(
      nutritionTarget(policy, { ...fixtureProfile, notes }),
      1500,
      notes,
    );
});

test("allergen names and explanation checks fold Arabic spellings on both sides", () => {
  for (const [reported, key] of [
    ["جبنه", "milk"],
    ["جبنة", "milk"],
    ["زبده", "milk"],
    ["زبدة", "milk"],
    ["قشطه", "milk"],
    ["لبنه", "milk"],
    ["بيضه", "egg"],
    ["تونه", "fish"],
    ["طحينة", "sesame"],
    ["فول سودانى", "peanut"],
    ["فول سوداني", "peanut"],
  ])
    assert.equal(allergenKey(reported), key, reported);
  const c = fixtureCatalog(),
    recipe = c.recipes[0],
    base = c.foods[0];
  assert.equal(
    recipeCompatibility(
      recipe,
      recipe.variants[0],
      new Map([[base.id, { ...base, name: "زبده بلدي", ingredientTags: [] }]]),
      { ...fixtureProfile, allergyStatus: "reported", allergens: ["milk"] },
      fixturePolicy([randomUUID()]),
    ),
    "Reported allergen conflict",
  );
  const check = (text: string) =>
    nutritionExplanation({
      text,
      targetKcal: 1500,
      days: [],
      slots: 3,
      batches: 0,
      recipes: [],
    }).explanationCheck.issues;
  assert.ok(check("خذ كبسوله يوميا").includes("clinical_or_supplement_advice"));
  assert.ok(
    check("جرعه واحده مع الفطور").includes("clinical_or_supplement_advice"),
  );
  assert.ok(check("خذ 5 وحده قبل الأكل").includes("dosage"));
  assert.ok(check("تقريبا 1800 سعره في اليوم").includes("calorie_mismatch"));
});

// Delivery against catalog retirement. The app runs on an instrumented database
// that records each tenant transaction's statements and can pause one mid-flight.
let base: Database,
  db: Database,
  app: Awaited<ReturnType<typeof buildApp>>,
  owner: any,
  cases: any[] = [],
  foods: any[] = [],
  recipes: any[] = [];
type Statement = { sql: string; values: unknown[] };
let recording: Statement[][] | null = null,
  pauseAfter:
    ((sql: string, log: Statement[]) => Promise<void> | undefined) | null =
    null,
  modelCalls = 0;
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
function instrument(inner: Database): Database {
  return {
    system: (fn) => inner.system(fn),
    close: () => inner.close(),
    tenant: (actor, fn) =>
      inner.tenant(actor, (tx) => {
        const log: Statement[] = [];
        recording?.push(log);
        const query = async (sql: string, values: any[] = []) => {
          log.push({ sql, values });
          const rows = await tx.query(sql, values);
          await pauseAfter?.(sql, log);
          return rows;
        };
        return fn({ query } as Tx);
      }),
  };
}
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
      password: "Fix2SafetyFixture2026!",
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
async function subscriber(label: string) {
  const email = `fix2-${label}@example.test`;
  const invite = await ok("/invitations", "POST", {
    email,
    role: "subscriber",
  });
  const r = await req(
    "/invitations/accept",
    "POST",
    {
      token: invite.url.split("/").pop(),
      name: "Fix2 " + label,
      email,
      password: "Fix2SafetyFixture2026!",
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
  await base.tenant(owner, (tx) =>
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
  await ok("/nutrition/releases", "POST", {
    evaluationId: evaluation.id,
    previewId: preview.id,
    confirmed: true,
  });
  assert.equal((await ok("/nutrition/coach")).ready, true);
}
async function addRecipe(index: number, name: string) {
  const { id: _, ...value } = fixtureCatalog().recipes[index];
  value.name = name;
  value.variants.forEach((v) =>
    v.ingredients.forEach((i) => (i.foodId = foods[index].id)),
  );
  return ok("/nutrition/recipes", "POST", { recipe: value });
}
function modelAnswer(task: string, input: any) {
  if (task === "nutrition_week")
    return fixtureWeek(
      input.recipes,
      input.cases.map((c: any) => c.id),
    );
  if (task !== "nutrition_evaluation")
    throw new Error("Unexpected model task " + task);
  return {
    decisions: input.scenarios.map((s: any) => {
      let target = null;
      try {
        target = nutritionTarget(input.policy, s.profile);
      } catch {}
      const category =
          nutritionCategories.find((c) => s.prompt.includes("[" + c + "]")) ??
          "diet",
        teaching = input.cases.find((c: any) => c.data.category === category),
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
              (input.foods.find((f: any) => f.id === i.foodId).nutrientsPer100g[
                key
              ] *
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
        rationaleEvidence: { caseId: teaching.id, quote: teaching.data.reason },
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
}

before(async () => {
  base = await createDatabase({ memory: true });
  db = instrument(base);
  app = await buildApp({ db, testing: true });
  owner = await register("fix2-safety-coach");
  Object.assign(process.env, {
    MODEL_BASE_URL: "https://fix2-safety.invalid/v1",
    MODEL_API_KEY: "synthetic-fixture-key",
    MODEL_NAME: "fix2-safety-fixture",
    MODEL_PRICE_VERSION: "fixture-v1",
    MODEL_INPUT_USD_PER_MILLION: "1",
    MODEL_OUTPUT_USD_PER_MILLION: "2",
    MODEL_MAX_DAILY_CALLS: "1000",
    MODEL_MAX_DAILY_CALLS_PER_SUBSCRIBER: "100",
  });
  globalThis.fetch = async (_url, options) => {
    modelCalls++;
    const body = JSON.parse(String(options?.body)),
      { task, input } = JSON.parse(body.messages[1].content);
    return new Response(
      JSON.stringify({
        id: "fix2-request-" + modelCalls,
        choices: [
          { message: { content: JSON.stringify(modelAnswer(task, input)) } },
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
    reason: "Confirmed synthetic fix2 policy",
  });
  await ok("/nutrition/policy/" + policy.id + "/confirm", "POST", {});
  for (let i = 0; i < 24; i++) {
    const c = cases[i % cases.length],
      exception = i >= 20;
    await ok("/nutrition/scenarios", "POST", {
      category: c.data.category,
      prompt: `[${c.data.category}] Unseen fix2 situation ${i}; apply the available evidence.`,
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

const readsCatalog = (s: Statement) =>
  /FROM nutrition_(?:foods|recipes)\b/.test(s.sql);

test("every transaction that delivers a week reads the catalog under the tenant setup lock", async () => {
  const client = await subscriber("lock-order");
  const logs: Statement[][] = [];
  recording = logs;
  try {
    const generated = (
      await ok(
        "/nutrition/generate",
        "POST",
        { requestKey: randomUUID(), weekStart: today },
        client,
      )
    ).plan;
    await ok(
      `/nutrition/plans/${generated.id}/swap`,
      "POST",
      {
        expectedVersion: generated.version,
        date: today,
        slot: "Breakfast",
        recipeId: recipes[0].id,
        variantKey: "microwave",
        servings: 1,
      },
      client,
    );
    await ok(`/nutrition/clients/${client.userId}/plan`, "POST", {
      weekStart: dateOffset(today, 7),
      profileId: client.profile.id,
      previousId: null,
      previousVersion: null,
      week: fixtureWeek(
        recipes,
        cases.map((c) => c.id),
      ),
      reason: "Coach-assigned week for the lock-order check",
    });
  } finally {
    recording = null;
  }
  const setupKey = owner.tenantId + ":nutrition:setup";
  const deliveries = logs.filter((log) =>
    log.some(
      (s) =>
        s.sql.startsWith("INSERT INTO records") &&
        s.values[2] === "nutrition_plan" &&
        s.values[4] === "delivered",
    ),
  );
  assert.equal(deliveries.length, 3);
  for (const log of deliveries) {
    const firstRead = log.findIndex(readsCatalog),
      guard = log.findIndex(
        (s) => /pg_advisory_xact_lock/.test(s.sql) && s.values[0] === setupKey,
      );
    assert.ok(firstRead >= 0);
    assert.ok(
      guard >= 0 && guard < firstRead,
      "catalog read without the setup lock: " +
        log.map((s) => s.sql.slice(0, 60)).join(" | "),
    );
  }
});

// Real interleaving needs separate connections; embedded PGlite runs one
// transaction at a time, so this runs where CI provides PostgreSQL.
test(
  "a retirement racing a delivery never leaves a delivered week that uses the retired recipe",
  {
    timeout: 120000,
    skip: process.env.DATABASE_URL
      ? false
      : "needs PostgreSQL connections to interleave (embedded PGlite serializes transactions)",
  },
  async () => {
    const client = await subscriber("race");
    const userLock = owner.tenantId + ":nutrition:" + client.userId;
    // Pause the client's delivery right after it has read the catalog, start the
    // retirement, and resume once the retirement has committed or is waiting on a lock.
    async function interleave(deliver: () => Promise<any>, retiredId: string) {
      let reached!: () => void, resume!: () => void;
      const atCatalog = new Promise<void>((r) => (reached = r)),
        resumed = new Promise<void>((r) => (resume = r));
      pauseAfter = (sql, log) => {
        const recipeRead = (s: string) => /FROM nutrition_recipes\b/.test(s);
        if (
          !recipeRead(sql) ||
          log.filter((s) => recipeRead(s.sql)).length !== 1 ||
          !log.some(
            (s) =>
              s.sql.includes("pg_advisory_xact_lock(") &&
              s.values[0] === userLock,
          ) ||
          log.some((s) => s.sql.includes("nutrition_request"))
        )
          return undefined;
        pauseAfter = null;
        reached();
        return resumed;
      };
      const delivery = deliver();
      await atCatalog;
      let settled = false,
        waited = false;
      const retirement = req(
        `/nutrition/catalog/recipe/${retiredId}/archive`,
        "POST",
        { archived: true, reason: "Recipe withdrawn during a delivery race" },
      ).finally(() => (settled = true));
      for (let i = 0; i < 400 && !settled && !waited; i++) {
        const [waiting] = await base.system((tx) =>
          tx.query(
            "SELECT count(*)::int AS n FROM pg_locks WHERE locktype='advisory' AND NOT granted",
          ),
        );
        waited = waiting.n > 0;
        if (!waited) await new Promise((r) => setTimeout(r, 25));
      }
      resume();
      const [d, r] = await Promise.all([delivery, retirement]);
      assert.ok(d.statusCode < 300, d.body);
      assert.ok(r.statusCode < 300, r.body);
      const plans = await base.tenant(owner, (tx) =>
        tx.query(
          "SELECT id,status,data FROM records WHERE kind='nutrition_plan' AND owner_user_id=$1",
          [client.userId],
        ),
      );
      const uses = (p: any) =>
        [...(p.data.choices?.days ?? []), ...(p.data.view?.days ?? [])].some(
          (day: any) => day.meals.some((m: any) => m.recipeId === retiredId),
        );
      assert.deepEqual(
        plans
          .filter((p) => p.status === "delivered" && uses(p))
          .map((p) => p.id),
        [],
      );
      // The week delivered inside the race is flagged for the coach's recheck.
      assert.ok(waited, "the retirement waits for the delivery's catalog lock");
      assert.equal(
        plans.find((p) => p.id === d.json().plan.id)?.status,
        "needs_recheck",
      );
    }
    const week = (
      await ok(
        "/nutrition/generate",
        "POST",
        { requestKey: randomUUID(), weekStart: today },
        client,
      )
    ).plan;
    await interleave(
      () =>
        req(
          `/nutrition/plans/${week.id}/swap`,
          "POST",
          {
            expectedVersion: week.version,
            date: today,
            slot: "Breakfast",
            recipeId: recipes[0].id,
            variantKey: "microwave",
            servings: 1,
          },
          client,
        ),
      recipes[1].id,
    );
    await addRecipe(1, "Replacement lunch bowl");
    await qualify();
    await interleave(
      () =>
        req(
          "/nutrition/generate",
          "POST",
          { requestKey: randomUUID(), weekStart: dateOffset(today, 7) },
          client,
        ),
      recipes[2].id,
    );
  },
);
