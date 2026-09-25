import { runtimeConfig } from "../../../packages/providers/src/configuration.ts";
import { eraseMealCaptures } from "./meal-capture.ts";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  event,
  putRecord,
  type Actor,
  type Database,
  type Tx,
} from "@trainer/db";
import {
  nutritionModel,
  nutritionModelIdentity,
} from "../../../packages/providers/src/nutrition.ts";
import {
  foodSchema,
  recipeSchema,
  nutritionCaseSchema,
  nutritionPolicySchema,
  nutritionProfileSchema,
  nutritionScenarioSchema,
  nutritionEvaluationSchema,
  nutritionWeekSchema,
  nutritionCoverage,
  nutritionTarget,
  validateNutritionWeek,
  NutritionBlocked,
  nutritionSummary,
  localDate,
  dateOffset,
  type Food,
  type Recipe,
  type NutritionPolicy,
  type NutritionProfile,
  type NutritionWeek,
} from "../../../packages/domain/src/nutrition.ts";
import { modelAccounting } from "./model-accounting.ts";
import { requireRecentMfa } from "./security.ts";
import { extractDocument } from "./ingestion.ts";
type Row = Record<string, any>;
type Identity = Actor & { mfaAt?: string | null };
const id = z.string().uuid();
const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
const hash = (data: unknown) =>
  createHash("sha256").update(JSON.stringify(data)).digest("hex");
const internal = (a: Actor) => ({ ...a, role: "owner" });
async function lock(tx: Tx, a: Actor, suffix = "setup") {
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    a.tenantId + ":nutrition:" + suffix,
  ]);
}
async function find(tx: Tx, recordId: string, kind: string) {
  const [r] = await tx.query("SELECT * FROM records WHERE id=$1 AND kind=$2", [
    id.parse(recordId),
    kind,
  ]);
  if (!r) throw fail(404, "NOT_FOUND", "Nutrition item unavailable");
  return r;
}
async function latest(tx: Tx, kind: string, userId?: string, status?: string) {
  const [r] = await tx.query(
    "SELECT * FROM records WHERE kind=$1 AND ($2::uuid IS NULL OR owner_user_id=$2) AND ($3::text IS NULL OR status=$3) ORDER BY created_at DESC,id DESC LIMIT 1",
    [kind, userId ?? null, status ?? null],
  );
  return r;
}
async function consent(tx: Tx, userId: string, type: string) {
  const [r] = await tx.query(
    "SELECT id,granted FROM consent_records WHERE user_id=$1 AND document_type=$2 ORDER BY created_at DESC,id DESC LIMIT 1",
    [userId, type],
  );
  return r ?? { id: null, granted: false };
}
async function member(tx: Tx, a: Actor, userId: string) {
  const [m] = await tx.query(
    "SELECT role FROM memberships WHERE tenant_id=$1 AND user_id=$2 AND role='subscriber'",
    [a.tenantId, userId],
  );
  if (!m) throw fail(404, "SUBSCRIBER_UNAVAILABLE", "Subscriber unavailable");
}
export async function nutritionEntitlement(tx: Tx, userId: string) {
  const [s] = await tx.query(
    "SELECT * FROM subscriptions WHERE user_id=$1 AND status IN ('active','trialing') AND period_end>now()",
    [userId],
  );
  return !!s && s.data?.modules?.includes("nutrition") === true;
}
async function entitled(tx: Tx, userId: string) {
  if (!(await nutritionEntitlement(tx, userId)))
    throw fail(
      402,
      "NUTRITION_MEMBERSHIP",
      "Workout + nutrition membership is required for new nutrition activity.",
    );
}
async function permission(tx: Tx, userId: string, model = false) {
  const processing = await consent(tx, userId, "nutrition"),
    ai = await consent(tx, userId, "nutrition_model");
  if (!processing.granted || (model && !ai.granted))
    throw fail(
      403,
      "NUTRITION_PERMISSION",
      "Nutrition permission is required for this action.",
    );
  return { processing, ai };
}
export async function nutritionCatalog(
  tx: Tx,
): Promise<{ foods: Food[]; recipes: Recipe[] }> {
  const [f, r, o, i] = await Promise.all([
    tx.query("SELECT * FROM nutrition_foods ORDER BY id"),
    tx.query("SELECT * FROM nutrition_recipes ORDER BY id"),
    tx.query(
      "SELECT * FROM nutrition_recipe_options ORDER BY recipe_id,option_key",
    ),
    tx.query(
      "SELECT * FROM nutrition_ingredients ORDER BY recipe_id,option_key,position",
    ),
  ]);
  const foods = f.map((x) => ({
    id: x.id,
    name: x.name,
    preparation: x.preparation,
    nutrientsPer100g: x.nutrients,
    allergens: x.allergens,
    ingredientTags: x.ingredient_tags,
    allergenReviewComplete: x.allergen_review_complete,
    estimated: x.estimated,
    source: x.source,
  })) as Food[];
  const recipes = r.map((x) => ({
    id: x.id,
    name: x.name,
    description: x.description,
    dietTags: x.diet_tags,
    slots: x.slots,
    budget: x.budget,
    yieldServings: Number(x.yield_servings),
    source: x.source,
    variants: o
      .filter((v) => v.recipe_id === x.id)
      .map((v) => ({
        key: v.option_key,
        name: v.name,
        equipment: v.equipment,
        minutes: v.minutes,
        steps: v.steps,
        storageNote: v.storage_note,
        ingredients: i
          .filter((a) => a.recipe_id === x.id && a.option_key === v.option_key)
          .map((a) => ({ foodId: a.food_id, grams: Number(a.grams) })),
      })),
  })) as Recipe[];
  return { foods, recipes };
}
export async function nutritionMaterial(tx: Tx) {
  const cases = await tx.query(
    "SELECT * FROM records WHERE kind='nutrition_case' AND status='confirmed' ORDER BY id",
  );
  const sources = await tx.query(
    "SELECT * FROM records WHERE kind='nutrition_source' AND status='confirmed' ORDER BY id",
  );
  const policy = await latest(tx, "nutrition_policy", undefined, "confirmed"),
    catalog = await nutritionCatalog(tx);
  const snapshot = {
    cases: cases.map((r) => ({ id: r.id, data: r.data, version: r.version })),
    sources: sources.map((r) => ({
      id: r.id,
      data: r.data,
      version: r.version,
    })),
    policy: policy
      ? { id: policy.id, data: policy.data, version: policy.version }
      : null,
    ...catalog,
    model: nutritionModelIdentity(),
  };
  return {
    cases,
    sources,
    policy,
    ...catalog,
    digest: hash(snapshot),
    snapshot,
  };
}
export async function nutritionReadiness(tx: Tx) {
  const setup = await latest(tx, "nutrition_setup"),
    material = await nutritionMaterial(tx),
    release = await latest(tx, "nutrition_release", undefined, "published");
  const coverage = nutritionCoverage(material.cases as any),
    gaps = coverage
      .filter((c) => !c.covered)
      .map((c) => "Teach " + c.category + " through a client case.");
  if (!material.policy)
    gaps.push("Confirm the diet and automatic-action policy.");
  const validSources = new Set(
    [...material.cases, ...material.sources].map((r) => r.id),
  );
  if (
    material.policy?.data.policy.sourceIds.some(
      (i: string) => !validSources.has(i),
    )
  )
    gaps.push(
      "A policy source changed; confirm a policy using current teaching evidence.",
    );
  if (!material.foods.length || !material.recipes.length)
    gaps.push("Add ingredient facts and recipes with cooking options.");
  if (!release || release.data.digest !== material.digest)
    gaps.push("Evaluate and activate the current nutrition knowledge.");
  const configured =
    !!runtimeConfig().MODEL_API_KEY &&
    !!runtimeConfig().MODEL_BASE_URL &&
    !!runtimeConfig().MODEL_NAME;
  if (!configured)
    gaps.push(
      "A model connection is needed for evaluation and automatic delivery.",
    );
  if (
    process.env.NODE_ENV === "production" &&
    (runtimeConfig().NUTRITION_ENABLED !== "true" ||
      runtimeConfig().NUTRITION_SCOPE_APPROVED !== "true" ||
      release?.data.verificationMode !== "provider")
  )
    gaps.push(
      "Production nutrition activation and qualified scope review are pending.",
    );
  return {
    enabled: !!setup?.data.enabled,
    setup,
    coverage,
    gaps,
    ready: !!setup?.data.enabled && gaps.length === 0,
    release,
    material,
  };
}
export async function requireNutritionReady(tx: Tx) {
  const r = await nutritionReadiness(tx);
  if (!r.ready)
    throw fail(
      409,
      "NUTRITION_NOT_READY",
      r.gaps[0] ?? "Enable nutrition setup first.",
    );
  return r;
}
const weekInstruction =
  "Return {days:[{offset:0..6,meals:[{slot,recipeId,variantKey,servings,batchKey:null or shared preparation key}]}],caseIds:[confirmed coach case IDs],explanation}. Exactly seven days, every required slot each day. Choose only supplied recipe IDs/options, quarter-serving quantities inside policy limits, and ingredients compatible with the client. Respect daily calorie tolerance, diet, exclusions, budget, equipment, time and repeat limits. Shared batches must use the same recipe and option. Do not invent recipes or facts. Use the supplied targetKcal; no additional target calculation. If impossible, return no invented plan; the validator will route an exception.";
async function generate(input: any, a: Actor, db: Database) {
  return nutritionModel(
    "nutrition_week",
    weekInstruction,
    input,
    nutritionWeekSchema,
    modelAccounting(db, a, "nutrition_week"),
  );
}
function evidence(material: Awaited<ReturnType<typeof nutritionMaterial>>) {
  return {
    cases: material.snapshot.cases,
    policy: material.policy?.data.policy,
    foods: material.foods,
    recipes: material.recipes,
  };
}
async function exception(
  tx: Tx,
  a: Actor,
  userId: string,
  code: string,
  message: string,
  requestId?: string,
) {
  const [old] = await tx.query(
    "SELECT * FROM records WHERE kind='nutrition_exception' AND owner_user_id=$1 AND status='open' AND data->>'code'=$2",
    [userId, code],
  );
  if (old) return old;
  const e = await putRecord(
    tx,
    a,
    "nutrition_exception",
    { code, message, requestId: requestId ?? null },
    { ownerId: userId, status: "open" },
  );
  await event(tx, a, "nutrition.exception_opened", e.id, { code });
  return e;
}
function availabilityError(error: unknown) {
  if (error instanceof NutritionBlocked)
    return { code: error.code, message: error.message };
  return {
    code: "GENERATION_UNAVAILABLE",
    message:
      "A complete validated meal plan could not be prepared. Your current valid plan is preserved; the coach can inspect the exception.",
  };
}
async function deliver(
  tx: Tx,
  a: Actor,
  userId: string,
  data: any,
  previous?: Row,
) {
  if (previous)
    await tx.query(
      "UPDATE records SET status='archived',updated_at=now() WHERE id=$1",
      [previous.id],
    );
  const plan = await putRecord(
    tx,
    a,
    "nutrition_plan",
    {
      ...data,
      previousId: previous?.id ?? null,
      allowedUses: ["render", "model_prompt"],
    },
    { ownerId: userId, status: "delivered" },
  );
  await event(tx, a, "nutrition.plan_delivered", plan.id, {
    origin: data.origin,
    releaseId: data.releaseId,
  });
  return plan;
}
export async function nutritionTwin(tx: Tx, a: Actor, userId: string) {
  const allowed = (await consent(tx, userId, "nutrition")).granted,
    profile = await latest(tx, "nutrition_profile", userId);
  const logs = allowed
    ? await tx.query(
        "SELECT * FROM records WHERE kind='nutrition_log' AND owner_user_id=$1 ORDER BY created_at DESC LIMIT 3000",
        [userId],
      )
    : [];
  const checkins = allowed
    ? await tx.query(
        "SELECT * FROM records WHERE kind='nutrition_checkin' AND owner_user_id=$1 ORDER BY created_at DESC LIMIT 100",
        [userId],
      )
    : [];
  return {
    ...nutritionSummary(logs as any, checkins as any, profile, allowed),
    profileCapturedAt: allowed ? (profile?.created_at ?? null) : null,
    partialInput: logs.length === 3000,
  };
}

export function nutritionRoutes(
  app: FastifyInstance,
  db: Database,
  identity: (r: FastifyRequest) => Identity,
  testing = false,
) {
  const owner = (req: FastifyRequest) => {
    const a = identity(req);
    if (a.role !== "owner")
      throw fail(
        403,
        "OWNER_REQUIRED",
        "Only the coach owner can change nutrition teaching.",
      );
    return a;
  };
  const coach = (req: FastifyRequest) => {
    const a = identity(req);
    if (!["owner", "staff"].includes(a.role))
      throw fail(403, "COACH_REQUIRED", "Coach access required");
    return a;
  };
  const client = (req: FastifyRequest) => {
    const a = identity(req);
    if (a.role !== "subscriber")
      throw fail(
        403,
        "SUBSCRIBER_REQUIRED",
        "Use a subscriber account for this action",
      );
    return a;
  };
  const prefix = "/api/v1/nutrition";
  app.get(prefix + "/coach", async (req) => {
    const a = coach(req);
    return db.tenant(a, async (tx) => {
      const r = await nutritionReadiness(tx);
      return {
        ...r,
        material: undefined,
        foods: r.material.foods,
        recipes: r.material.recipes,
        policy: r.material.policy,
        cases: r.material.cases,
        sources: r.material.sources,
        records: await tx.query(
          "SELECT * FROM records WHERE kind IN ('nutrition_scenario','nutrition_evaluation','nutrition_preview','nutrition_policy','nutrition_release','nutrition_exception','nutrition_source') ORDER BY created_at DESC LIMIT 300",
        ),
        members: await tx.query(
          "SELECT u.id,u.name FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.tenant_id=$1 AND m.role='subscriber' ORDER BY u.name",
          [a.tenantId],
        ),
      };
    });
  });
  app.put(prefix + "/setup", async (req) => {
    const a = owner(req),
      b = z
        .object({ enabled: z.boolean(), version: z.number().int().min(0) })
        .strict()
        .parse(req.body);
    return db.tenant(a, async (tx) => {
      await lock(tx, a);
      const old = await latest(tx, "nutrition_setup");
      if ((old?.version ?? 0) !== b.version)
        throw fail(
          409,
          "VERSION_CONFLICT",
          "Reload the changed nutrition setup.",
        );
      if (old) {
        const [r] = await tx.query(
          "UPDATE records SET data=$2,version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
          [old.id, JSON.stringify({ enabled: b.enabled })],
        );
        return r;
      }
      return putRecord(
        tx,
        a,
        "nutrition_setup",
        { enabled: b.enabled },
        { status: "saved" },
      );
    });
  });
  app.post(prefix + "/cases", async (req) => {
    const a = owner(req),
      b = nutritionCaseSchema.parse(req.body);
    return db.tenant(a, async (tx) => {
      await lock(tx, a);
      const r = await putRecord(
        tx,
        a,
        "nutrition_case",
        { ...b, allowedUses: ["model_prompt", "trainer_specific_learning"] },
        { status: "confirmed" },
      );
      await event(tx, a, "nutrition.case_taught", r.id, {
        category: b.category,
      });
      return r;
    });
  });
  app.patch(prefix + "/cases/:id", async (req) => {
    const a = owner(req),
      b = z
        .object({
          version: z.number().int().positive(),
          answer: nutritionCaseSchema,
        })
        .strict()
        .parse(req.body);
    return db.tenant(a, async (tx) => {
      await lock(tx, a);
      const old = await find(tx, (req.params as any).id, "nutrition_case");
      if (old.version !== b.version)
        throw fail(
          409,
          "VERSION_CONFLICT",
          "Reload this case before changing it.",
        );
      await tx.query(
        "UPDATE records SET status='superseded',version=version+1 WHERE id=$1",
        [old.id],
      );
      return putRecord(
        tx,
        a,
        "nutrition_case",
        {
          ...b.answer,
          supersedesId: old.id,
          allowedUses: ["model_prompt", "trainer_specific_learning"],
        },
        { status: "confirmed" },
      );
    });
  });
  app.post(prefix + "/sources", async (req) => {
    const a = owner(req),
      b = z
        .object({
          title: z.string().min(2).max(160),
          text: z.string().min(10).max(60000),
          rights: z.literal(true),
        })
        .strict()
        .parse(req.body);
    return db.tenant(a, (tx) =>
      putRecord(
        tx,
        a,
        "nutrition_source",
        {
          ...b,
          allowedUses: ["model_prompt", "trainer_specific_learning"],
          origin: "coach",
        },
        { status: "confirmed" },
      ),
    );
  });
  app.post(
    prefix + "/documents",
    { bodyLimit: 8 * 1024 * 1024 },
    async (req) => {
      const a = owner(req),
        b = z
          .object({
            title: z.string().min(2).max(160),
            fileName: z.string().min(1).max(180),
            contentBase64: z
              .string()
              .max(7 * 1024 * 1024)
              .regex(/^[A-Za-z0-9+/]*={0,2}$/),
            rights: z.literal(true),
          })
          .strict()
          .parse(req.body);
      if (
        process.env.NODE_ENV === "production" &&
        runtimeConfig().FILE_IMPORTS_APPROVED !== "true"
      )
        throw fail(
          503,
          "IMPORT_REVIEW_PENDING",
          "Document import security review is pending.",
        );
      const text = await extractDocument(
        b.fileName,
        Buffer.from(b.contentBase64, "base64"),
      );
      return db.tenant(a, (tx) =>
        putRecord(
          tx,
          a,
          "nutrition_source",
          {
            title: b.title,
            text,
            rights: true,
            allowedUses: ["model_prompt", "trainer_specific_learning"],
            origin: "coach_document",
          },
          { status: "extracted" },
        ),
      );
    },
  );
  app.post(prefix + "/sources/:id/confirm", async (req) => {
    const a = owner(req);
    return db.tenant(a, async (tx) => {
      const r = await find(tx, (req.params as any).id, "nutrition_source");
      await tx.query(
        "UPDATE records SET status='confirmed',version=version+1 WHERE id=$1",
        [r.id],
      );
      return { ok: true };
    });
  });
  app.post(prefix + "/foods", async (req) => {
    const a = owner(req),
      b = z
        .object({ food: foodSchema, supersedesId: id.optional() })
        .strict()
        .parse(req.body);
    return db.tenant(a, async (tx) => {
      const fid = randomUUID();
      await tx.query(
        "INSERT INTO nutrition_foods(id,tenant_id,supersedes_id,name,preparation,nutrients,allergens,ingredient_tags,allergen_review_complete,estimated,source) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
        [
          fid,
          a.tenantId,
          b.supersedesId ?? null,
          b.food.name,
          b.food.preparation,
          JSON.stringify(b.food.nutrientsPer100g),
          JSON.stringify(b.food.allergens),
          JSON.stringify(b.food.ingredientTags),
          b.food.allergenReviewComplete,
          b.food.estimated,
          b.food.source,
        ],
      );
      await event(tx, a, "nutrition.food_version_created", fid);
      return { id: fid, ...b.food };
    });
  });
  app.post(prefix + "/recipes", async (req) => {
    const a = owner(req),
      b = z
        .object({ recipe: recipeSchema, supersedesId: id.optional() })
        .strict()
        .parse(req.body);
    return db.tenant(a, async (tx) => {
      const rid = randomUUID(),
        r = b.recipe;
      await tx.query(
        "INSERT INTO nutrition_recipes(id,tenant_id,supersedes_id,name,description,diet_tags,slots,budget,yield_servings,source) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [
          rid,
          a.tenantId,
          b.supersedesId ?? null,
          r.name,
          r.description,
          JSON.stringify(r.dietTags),
          JSON.stringify(r.slots),
          r.budget,
          r.yieldServings,
          r.source,
        ],
      );
      for (const v of r.variants) {
        await tx.query(
          "INSERT INTO nutrition_recipe_options(tenant_id,recipe_id,option_key,name,equipment,minutes,steps,storage_note) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
          [
            a.tenantId,
            rid,
            v.key,
            v.name,
            JSON.stringify(v.equipment),
            v.minutes,
            JSON.stringify(v.steps),
            v.storageNote,
          ],
        );
        for (const [position, i] of v.ingredients.entries())
          await tx.query(
            "INSERT INTO nutrition_ingredients(tenant_id,recipe_id,option_key,position,food_id,grams) VALUES($1,$2,$3,$4,$5,$6)",
            [a.tenantId, rid, v.key, position, i.foodId, i.grams],
          );
      }
      await event(tx, a, "nutrition.recipe_version_created", rid);
      return { id: rid, ...r };
    });
  });
  app.post(prefix + "/recipes/draft", async (req) => {
    const a = owner(req),
      b = z
        .object({ request: z.string().min(10).max(2000) })
        .strict()
        .parse(req.body),
      m = await db.tenant(a, nutritionMaterial);
    if (!m.foods.length)
      throw fail(
        409,
        "FOODS_REQUIRED",
        "Add ingredient facts before drafting a recipe.",
      );
    const result = await nutritionModel(
      "nutrition_recipe",
      "Draft {recipe:{name,description,dietTags,slots,budget:low|moderate|flexible,yieldServings,variants:[{key,name,equipment,minutes,steps,ingredients:[{foodId,grams}],storageNote}],source}}. Use only supplied foods. The coach will review and save this reusable recipe; do not invent nutritional values.",
      { request: b.request, ...evidence(m) },
      z.object({ recipe: recipeSchema }).strict(),
      modelAccounting(db, a, "nutrition_recipe"),
    );
    if (
      result.recipe.variants.some((v) =>
        v.ingredients.some((i) => !m.foods.some((f) => f.id === i.foodId)),
      )
    )
      throw fail(422, "UNKNOWN_FOOD", "The recipe cited unknown food facts.");
    return result;
  });
  app.post(prefix + "/policy/compile", async (req) => {
    const a = owner(req),
      m = await db.tenant(a, nutritionMaterial);
    if (nutritionCoverage(m.cases as any).some((c) => !c.covered))
      throw fail(
        409,
        "TEACHING_GAPS",
        "Answer a client case in each teaching category first.",
      );
    const schema = z
      .object({
        policy: nutritionPolicySchema.nullable(),
        gaps: z.array(z.string().max(2000)).max(30),
        conflicts: z.array(z.string().max(2000)).max(30),
      })
      .strict();
    const result = await nutritionModel(
      "nutrition_policy",
      "Extract {policy,gaps,conflicts} from the coach's case answers and confirmed sources. Missing numeric targets or limits must be gaps; do not invent them. policy fields: title,approach,supportedDiets,minAge,maxAge,targets:[{goal,kcal,reason}],minKcal,maxKcal,tolerancePercent,slots,minServings,maxServings,maxRecipeRepeats,allowSwaps,forbiddenIngredients,adjustment:{enabled,trigger:hunger_high|difficulty_low,requiredCheckins,minimumDays,deltaKcal,reason},boundaries,sourceIds. If required fields are not supported return policy:null with precise questions. Quarter-serving limits. All sourceIds must identify supplied teaching cases or confirmed source material. If automatic adjustment isn't expressly taught, enabled must be false; ask for the remaining adjustment fields rather than inventing them.",
      { cases: m.snapshot.cases, sources: m.snapshot.sources },
      schema,
      modelAccounting(db, a, "nutrition_compilation"),
    );
    return db.tenant(a, async (tx) => {
      const now = await nutritionMaterial(tx);
      if (now.digest !== m.digest)
        throw fail(
          409,
          "TEACHING_CHANGED",
          "Teaching changed during compilation. Try again.",
        );
      return putRecord(
        tx,
        a,
        "nutrition_policy",
        { ...result, compiledFrom: m.digest },
        { status: "draft" },
      );
    });
  });
  app.post(prefix + "/policy", async (req) => {
    const a = owner(req),
      b = z
        .object({
          policy: nutritionPolicySchema,
          reason: z.string().min(5).max(2000),
        })
        .strict()
        .parse(req.body);
    return db.tenant(a, async (tx) => {
      const m = await nutritionMaterial(tx),
        allowed = new Set([...m.cases, ...m.sources].map((r) => r.id));
      if (b.policy.sourceIds.some((i) => !allowed.has(i)))
        throw fail(
          400,
          "UNKNOWN_EVIDENCE",
          "Policy sources must be confirmed teaching cases or sources.",
        );
      return putRecord(
        tx,
        a,
        "nutrition_policy",
        { policy: b.policy, gaps: [], conflicts: [], reason: b.reason },
        { status: "draft" },
      );
    });
  });
  app.post(prefix + "/policy/:id/confirm", async (req) => {
    const a = owner(req);
    return db.tenant(a, async (tx) => {
      await lock(tx, a);
      const r = await find(tx, (req.params as any).id, "nutrition_policy"),
        p = nutritionPolicySchema.parse(r.data.policy);
      if (r.data.gaps?.length || r.data.conflicts?.length)
        throw fail(
          409,
          "POLICY_GAPS",
          "Resolve the displayed gaps and conflicts by saving a corrected policy.",
        );
      const m = await nutritionMaterial(tx),
        allowed = new Set([...m.cases, ...m.sources].map((x) => x.id));
      if (p.sourceIds.some((i) => !allowed.has(i)))
        throw fail(
          409,
          "TEACHING_CHANGED",
          "Confirm the current teaching material first.",
        );
      await tx.query(
        "UPDATE records SET status='archived' WHERE kind='nutrition_policy' AND status='confirmed'",
      );
      await tx.query(
        "UPDATE records SET status='confirmed',version=version+1,updated_at=now() WHERE id=$1",
        [r.id],
      );
      await event(tx, a, "nutrition.policy_confirmed", r.id);
      return { ok: true };
    });
  });
  app.post(prefix + "/scenarios", async (req) => {
    const a = owner(req),
      b = nutritionScenarioSchema.parse(req.body);
    return db.tenant(a, async (tx) => {
      const c = await find(tx, b.expectedCaseId, "nutrition_case");
      if (
        c.status !== "confirmed" ||
        c.data.scenario.trim() === b.prompt.trim()
      )
        throw fail(
          400,
          "HELD_OUT_REQUIRED",
          "Use a different scenario from the teaching case.",
        );
      return putRecord(tx, a, "nutrition_scenario", b, { status: "held_out" });
    });
  });
  app.post(prefix + "/evaluate", async (req) => {
    const a = owner(req),
      m = await db.tenant(a, nutritionMaterial),
      scenarios = await db.tenant(a, (tx) =>
        tx.query(
          "SELECT * FROM records WHERE kind='nutrition_scenario' AND status='held_out' ORDER BY id LIMIT 40",
        ),
      );
    if (
      !m.policy ||
      nutritionCoverage(m.cases as any).some((c) => !c.covered) ||
      scenarios.length < 20 ||
      nutritionCoverage(
        scenarios.map((s) => ({ ...s, status: "confirmed" })) as any,
      ).some((c) => !c.covered)
    )
      throw fail(
        409,
        "EVALUATION_COVERAGE",
        "Confirm all teaching categories, the policy, and at least twenty held-out cases spanning the categories.",
      );
    const expectedDigest = hash(
      scenarios.map((s) => ({ id: s.id, data: s.data, version: s.version })),
    );
    const result = await nutritionModel(
      "nutrition_evaluation",
      "For each unseen scenario return {decisions:[{scenarioId,action:plan|exception,targetKcal:number or null,caseIds:[relevant teaching IDs],reason}]}. Apply the coach policy and cases. Missing/unknown allergy data, specialist needs or unsupported age/diet/goal require exception. No expected answers are provided. Cite teaching cases, not scenario IDs.",
      {
        ...evidence(m),
        scenarios: scenarios.map((s) => ({
          id: s.id,
          prompt: s.data.prompt,
          profile: s.data.profile,
        })),
      },
      nutritionEvaluationSchema,
      modelAccounting(db, a, "nutrition_evaluation"),
    );
    const outcomes = scenarios.map((s) => {
      const answers = result.decisions.filter((d) => d.scenarioId === s.id),
        d = answers[0];
      let target: number | null = null;
      try {
        target = nutritionTarget(m.policy!.data.policy, s.data.profile);
      } catch {}
      return {
        scenarioId: s.id,
        passed:
          answers.length === 1 &&
          d.action === s.data.expect &&
          d.action === (target === null ? "exception" : "plan") &&
          d.targetKcal === s.data.expectedTargetKcal &&
          d.targetKcal === target &&
          d.caseIds.includes(s.data.expectedCaseId) &&
          d.caseIds.every((i) => m.cases.some((c) => c.id === i)),
      };
    });
    return db.tenant(a, async (tx) => {
      const current = await nutritionMaterial(tx);
      if (current.digest !== m.digest)
        throw fail(
          409,
          "TEACHING_CHANGED",
          "Teaching changed during evaluation.",
        );
      const r = await putRecord(
        tx,
        a,
        "nutrition_evaluation",
        {
          digest: m.digest,
          scenarioDigest: expectedDigest,
          outcomes,
          total: outcomes.length,
          passed: outcomes.filter((o) => o.passed).length,
          verificationMode: testing ? "fixture" : "provider",
          model: nutritionModelIdentity(),
        },
        {
          status:
            outcomes.every((o) => o.passed) &&
            result.decisions.length === scenarios.length
              ? "passed"
              : "failed",
        },
      );
      await event(tx, a, "nutrition.evaluated", r.id, {
        total: outcomes.length,
      });
      return r;
    });
  });
  app.post(prefix + "/preview", async (req) => {
    const a = owner(req),
      b = z
        .object({ profile: nutritionProfileSchema, weekStart: z.iso.date() })
        .strict()
        .parse(req.body),
      m = await db.tenant(a, nutritionMaterial);
    if (!m.policy)
      throw fail(409, "POLICY_REQUIRED", "Confirm the nutrition policy first.");
    const targetKcal = nutritionTarget(m.policy.data.policy, b.profile),
      week = await generate(
        { ...evidence(m), profile: b.profile, targetKcal },
        a,
        db,
      );
    const view = validateNutritionWeek({
      week,
      policy: m.policy.data.policy,
      profile: b.profile,
      foods: m.foods,
      recipes: m.recipes,
      caseIds: m.cases.map((c) => c.id),
      weekStart: b.weekStart,
    });
    return db.tenant(a, async (tx) => {
      if ((await nutritionMaterial(tx)).digest !== m.digest)
        throw fail(409, "TEACHING_CHANGED", "Teaching changed during preview.");
      return putRecord(
        tx,
        a,
        "nutrition_preview",
        {
          digest: m.digest,
          profile: b.profile,
          choices: week,
          view,
          verificationMode: testing ? "fixture" : "provider",
        },
        { status: "ready" },
      );
    });
  });
  app.post(prefix + "/releases", async (req) => {
    const a = owner(req);
    requireRecentMfa(a);
    const b = z
      .object({ evaluationId: id, previewId: id, confirmed: z.literal(true) })
      .strict()
      .parse(req.body);
    return db.tenant(a, async (tx) => {
      await lock(tx, a);
      const m = await nutritionMaterial(tx),
        evaluation = await find(tx, b.evaluationId, "nutrition_evaluation"),
        preview = await find(tx, b.previewId, "nutrition_preview"),
        scenarios = await tx.query(
          "SELECT * FROM records WHERE kind='nutrition_scenario' AND status='held_out' ORDER BY id LIMIT 40",
        );
      if (
        evaluation.status !== "passed" ||
        evaluation.data.digest !== m.digest ||
        preview.data.digest !== m.digest ||
        evaluation.data.scenarioDigest !==
          hash(
            scenarios.map((s) => ({
              id: s.id,
              data: s.data,
              version: s.version,
            })),
          ) ||
        nutritionCoverage(m.cases as any).some((c) => !c.covered)
      )
        throw fail(
          409,
          "STALE_READINESS",
          "A passing evaluation and a reviewed sample week of the current knowledge are required.",
        );
      if (
        process.env.NODE_ENV === "production" &&
        (evaluation.data.verificationMode !== "provider" ||
          preview.data.verificationMode !== "provider" ||
          runtimeConfig().NUTRITION_SCOPE_APPROVED !== "true")
      )
        throw fail(
          409,
          "PRODUCTION_REVIEW",
          "Provider evaluation and qualified scope review are required.",
        );
      await tx.query(
        "UPDATE records SET status='archived' WHERE kind='nutrition_release' AND status='published'",
      );
      const r = await putRecord(
        tx,
        a,
        "nutrition_release",
        {
          ...m.snapshot,
          digest: m.digest,
          evaluationId: evaluation.id,
          previewId: preview.id,
          verificationMode: evaluation.data.verificationMode,
          mode: "automatic_with_exceptions",
        },
        { status: "published" },
      );
      await event(tx, a, "nutrition.release_published", r.id);
      return r;
    });
  });
  app.post(prefix + "/releases/:id/pause", async (req) => {
    const a = owner(req);
    return db.tenant(a, async (tx) => {
      await lock(tx, a);
      const r = await find(tx, (req.params as any).id, "nutrition_release");
      await tx.query("UPDATE records SET status='paused' WHERE id=$1", [r.id]);
      await event(tx, a, "nutrition.release_paused", r.id);
      return { ok: true };
    });
  });
  app.post(prefix + "/exceptions/:id/resolve", async (req) => {
    const a = owner(req),
      b = z
        .object({
          resolution: z.string().min(10).max(4000),
          teaching: nutritionCaseSchema.optional(),
        })
        .strict()
        .parse(req.body);
    return db.tenant(a, async (tx) => {
      const r = await find(tx, (req.params as any).id, "nutrition_exception");
      await tx.query(
        "UPDATE records SET status='resolved',data=data||$2::jsonb WHERE id=$1",
        [
          r.id,
          JSON.stringify({ resolution: b.resolution, resolvedBy: a.userId }),
        ],
      );
      if (b.teaching)
        await putRecord(
          tx,
          a,
          "nutrition_case",
          {
            ...b.teaching,
            exceptionId: r.id,
            allowedUses: ["model_prompt", "trainer_specific_learning"],
          },
          { status: "confirmed" },
        );
      await event(tx, a, "nutrition.exception_resolved", r.id);
      return { ok: true, requiresNewRelease: !!b.teaching };
    });
  });
  // Subscriber operations are registered below; all private reads remain owner-scoped.
  subscriberRoutes(app, db, { client, coach, identity }, testing);
}

function subscriberRoutes(
  app: FastifyInstance,
  db: Database,
  auth: {
    client: (r: FastifyRequest) => Identity;
    coach: (r: FastifyRequest) => Identity;
    identity: (r: FastifyRequest) => Identity;
  },
  testing: boolean,
) {
  const prefix = "/api/v1/nutrition";
  app.get(prefix, async (req) => {
    const a = auth.identity(req);
    if (!["subscriber", "owner", "staff"].includes(a.role))
      throw fail(403, "NUTRITION_ACCESS", "Nutrition access denied");
    const uid =
      a.role === "subscriber" ? a.userId : id.parse((req.query as any).userId);
    return db.tenant(internal(a), async (tx) => {
      await member(tx, a, uid);
      const p = await consent(tx, uid, "nutrition"),
        ai = await consent(tx, uid, "nutrition_model"),
        profile = await latest(tx, "nutrition_profile", uid);
      if (a.role !== "subscriber" && !p.granted)
        return {
          userId: uid,
          entitled: false,
          processingConsent: false,
          modelConsent: false,
          profile: null,
          records: [],
          exceptions: [],
          twin: { state: "permission_denied" },
          today: localDate("Asia/Dubai"),
          ready: false,
        };
      const records = await tx.query(
        "SELECT * FROM records WHERE owner_user_id=$1 AND kind IN ('nutrition_plan','nutrition_log','nutrition_checkin','nutrition_pantry') ORDER BY created_at DESC LIMIT 500",
        [uid],
      );
      const exceptions = await tx.query(
        "SELECT id,status,data->>'code' AS code,data->>'message' AS message FROM records WHERE kind='nutrition_exception' AND owner_user_id=$1 AND status='open'",
        [uid],
      );
      return {
        userId: uid,
        entitled: await nutritionEntitlement(tx, uid),
        processingConsent: p.granted,
        modelConsent: ai.granted,
        profile,
        records,
        exceptions,
        twin: await nutritionTwin(tx, a, uid),
        today: localDate(profile?.data.profile.timezone ?? "Asia/Dubai"),
        ready: (await nutritionReadiness(tx)).ready,
      };
    });
  });
  app.post(prefix + "/profile", async (req) => {
    const a = auth.client(req),
      b = z
        .object({
          profile: nutritionProfileSchema,
          processingConsent: z.literal(true),
          modelConsent: z.boolean(),
          version: z.number().int().min(0),
        })
        .strict()
        .parse(req.body);
    return db.tenant(internal(a), async (tx) => {
      await lock(tx, a, a.userId);
      await entitled(tx, a.userId);
      const old = await latest(tx, "nutrition_profile", a.userId);
      if ((old?.version ?? 0) !== b.version)
        throw fail(
          409,
          "VERSION_CONFLICT",
          "Your profile changed. Reload it before saving.",
        );
      for (const [type, granted] of [
        ["nutrition", true],
        ["nutrition_model", b.modelConsent],
      ] as const)
        await tx.query(
          "INSERT INTO consent_records(id,tenant_id,user_id,document_type,document_version,granted) VALUES($1,$2,$3,$4,'nutrition-v1',$5)",
          [randomUUID(), a.tenantId, a.userId, type, granted],
        );
      if (!b.modelConsent) await eraseMealCaptures(tx, a.userId);
      const r = await putRecord(
        tx,
        a,
        "nutrition_profile",
        {
          profile: b.profile,
          supersedesId: old?.id ?? null,
          allowedUses: b.modelConsent ? ["render", "model_prompt"] : ["render"],
        },
        { status: "current" },
      );
      if (old) {
        await tx.query("UPDATE records SET status='superseded' WHERE id=$1", [
          old.id,
        ]);
        await tx.query("UPDATE records SET version=$2 WHERE id=$1", [
          r.id,
          old.version + 1,
        ]);
      }
      await tx.query(
        "UPDATE records SET status='needs_recheck' WHERE kind='nutrition_plan' AND owner_user_id=$1 AND status='delivered'",
        [a.userId],
      );
      await event(tx, a, "nutrition.profile_saved", r.id);
      return { ...r, version: (old?.version ?? 0) + 1 };
    });
  });
  app.post(prefix + "/generate", async (req) =>
    prepareNutritionWeek(
      db,
      auth.client(req),
      z
        .object({ requestKey: id, weekStart: z.iso.date() })
        .strict()
        .parse(req.body),
    ),
  );
  app.get(prefix + "/plans/:id/options", async (req) => {
    const a = auth.client(req);
    return db.tenant(internal(a), async (tx) => {
      await entitled(tx, a.userId);
      await permission(tx, a.userId);
      const plan = await find(tx, (req.params as any).id, "nutrition_plan");
      if (plan.owner_user_id !== a.userId)
        throw fail(404, "NOT_FOUND", "Plan unavailable");
      const ready = await requireNutritionReady(tx),
        profile = await latest(tx, "nutrition_profile", a.userId);
      if (
        plan.status !== "delivered" ||
        profile?.id !== plan.data.profileId ||
        ready.release!.id !== plan.data.releaseId
      )
        throw fail(
          409,
          "PLAN_CHANGED",
          "Generate a current plan before requesting changes.",
        );
      return {
        recipes: ready.material.recipes,
        policy: ready.material.policy!.data.policy,
      };
    });
  });
  app.post(prefix + "/plans/:id/swap", async (req) => {
    const a = auth.client(req),
      b = z
        .object({
          expectedVersion: z.number().int().positive(),
          date: z.iso.date(),
          slot: z.string().min(1).max(50),
          recipeId: id,
          variantKey: z.string().max(40),
          servings: z.number().positive().max(10).multipleOf(0.25),
        })
        .strict()
        .parse(req.body);
    return db.tenant(internal(a), async (tx) => {
      await lock(tx, a, a.userId);
      await entitled(tx, a.userId);
      await permission(tx, a.userId);
      const old = await find(tx, (req.params as any).id, "nutrition_plan");
      if (old.owner_user_id !== a.userId)
        throw fail(404, "NOT_FOUND", "Plan unavailable");
      const ready = await requireNutritionReady(tx),
        profile = await latest(tx, "nutrition_profile", a.userId);
      if (
        old.status !== "delivered" ||
        old.version !== b.expectedVersion ||
        old.data.profileId !== profile?.id ||
        ready.release!.id !== old.data.releaseId
      )
        throw fail(
          409,
          "PLAN_CHANGED",
          "The meal plan changed; reload it before swapping.",
        );
      const policy = ready.material.policy!.data.policy as NutritionPolicy;
      if (!policy.allowSwaps)
        throw fail(
          409,
          "SWAP_REVIEW",
          "The coach has not enabled automatic swaps.",
        );
      if (b.date < localDate(profile!.data.profile.timezone))
        throw fail(
          409,
          "HISTORICAL_MEAL",
          "Past meals retain their original plan.",
        );
      const [logged] = await tx.query(
        "SELECT id FROM records WHERE kind='nutrition_log' AND owner_user_id=$1 AND data ? 'planId' AND data->>'date'=$2 AND data->>'slot'=$3",
        [a.userId, b.date, b.slot],
      );
      if (logged)
        throw fail(
          409,
          "MEAL_RECORDED",
          "This meal is already recorded; correct the diary entry instead.",
        );
      const choices = structuredClone(old.data.choices) as NutritionWeek,
        day = choices.days.find(
          (d) => dateOffset(old.data.weekStart, d.offset) === b.date,
        ),
        meal = day?.meals.find((m) => m.slot === b.slot);
      if (!meal) throw fail(404, "MEAL_UNAVAILABLE", "Meal unavailable");
      Object.assign(meal, {
        recipeId: b.recipeId,
        variantKey: b.variantKey,
        servings: b.servings,
        batchKey: null,
      });
      let view;
      try {
        view = validateNutritionWeek({
          week: choices,
          policy,
          profile: profile!.data.profile,
          ...{ foods: ready.material.foods, recipes: ready.material.recipes },
          caseIds: ready.material.cases.map((c) => c.id),
          weekStart: old.data.weekStart,
          targetKcal: old.data.view.targetKcal,
        });
      } catch (error) {
        if (!(error instanceof NutritionBlocked)) throw error;
        await exception(tx, a, a.userId, error.code, error.message);
        return {
          status: "exception",
          code: error.code,
          message: error.message,
        };
      }
      const before = new Map<string, number>(
        old.data.view.groceries.map((g: any) => [g.food.id, g.grams]),
      );
      const delta = view.groceries.map((g) => ({
        foodId: g.food.id,
        grams: Math.round((g.grams - (before.get(g.food.id) ?? 0)) * 100) / 100,
      }));
      for (const [foodId, grams] of before)
        if (!view.groceries.some((g) => g.food.id === foodId))
          delta.push({ foodId, grams: -grams });
      return {
        plan: await deliver(
          tx,
          a,
          a.userId,
          {
            ...old.data,
            choices,
            view,
            origin: "automatic_swap",
            groceryChanges: delta,
          },
          old,
        ),
      };
    });
  });
  app.post(prefix + "/logs", async (req) => {
    const a = auth.client(req),
      b = z
        .object({
          eventKey: id,
          date: z.iso.date(),
          timezone: z.string().min(1).max(100),
          name: z.string().min(1).max(160),
          notes: z.string().max(2000),
          kcal: z.number().min(0).max(10000).nullable(),
          planId: id.optional(),
          slot: z.string().max(50).optional(),
          correctsId: id.optional(),
          deleted: z.boolean().default(false),
        })
        .strict()
        .parse(req.body);
    return db.tenant(internal(a), async (tx) => {
      await lock(tx, a, a.userId);
      await entitled(tx, a.userId);
      await permission(tx, a.userId);
      const fingerprint = hash(b),
        [old] = await tx.query(
          "SELECT * FROM records WHERE kind='nutrition_log' AND owner_user_id=$1 AND data->>'eventKey'=$2",
          [a.userId, b.eventKey],
        );
      if (old) {
        if (old.data.fingerprint !== fingerprint)
          throw fail(
            409,
            "IDEMPOTENCY_CONFLICT",
            "The saved meal event differs from this retry.",
          );
        return old;
      }
      const profile = await latest(tx, "nutrition_profile", a.userId);
      if (
        !profile ||
        b.timezone !== profile.data.profile.timezone ||
        b.date > localDate(b.timezone)
      )
        throw fail(
          400,
          "LOG_DATE",
          "Use your profile timezone and a date that is not in the future.",
        );
      if (b.correctsId) {
        const prior = await find(tx, b.correctsId, "nutrition_log");
        if (prior.owner_user_id !== a.userId)
          throw fail(404, "NOT_FOUND", "Diary entry unavailable");
        const [corrected] = await tx.query(
          "SELECT id FROM records WHERE kind='nutrition_log' AND data->>'correctsId'=$1",
          [prior.id],
        );
        if (corrected)
          throw fail(
            409,
            "LOG_CHANGED",
            "This entry already has a correction. Reload the diary.",
          );
      }
      let snapshot: any = null;
      if (b.planId) {
        const plan = await find(tx, b.planId, "nutrition_plan");
        if (plan.owner_user_id !== a.userId)
          throw fail(404, "NOT_FOUND", "Plan unavailable");
        snapshot = plan.data.view.days
          .find((d: any) => d.date === b.date)
          ?.meals.find((m: any) => m.slot === b.slot);
        if (!snapshot)
          throw fail(
            400,
            "MEAL_UNAVAILABLE",
            "Choose a meal from the indicated plan and date.",
          );
      }
      const r = await putRecord(
        tx,
        a,
        "nutrition_log",
        {
          ...b,
          fingerprint,
          mealSnapshot: snapshot,
          source: snapshot ? "plan_with_user_confirmation" : "user_estimate",
          allowedUses: ["render", "model_prompt"],
        },
        { ownerId: a.userId, status: "recorded" },
      );
      await event(tx, a, "nutrition.meal_logged", r.id);
      return r;
    });
  });
  app.post(prefix + "/checkins", async (req) => {
    const a = auth.client(req),
      b = z
        .object({
          eventKey: id,
          date: z.iso.date(),
          hunger: z.number().int().min(1).max(5),
          difficulty: z.number().int().min(1).max(5),
          weightKg: z.number().positive().max(500).nullable(),
          notes: z.string().max(2000),
        })
        .strict()
        .parse(req.body);
    return db.tenant(internal(a), async (tx) => {
      await lock(tx, a, a.userId);
      await entitled(tx, a.userId);
      await permission(tx, a.userId);
      const [old] = await tx.query(
        "SELECT * FROM records WHERE kind='nutrition_checkin' AND owner_user_id=$1 AND data->>'eventKey'=$2",
        [a.userId, b.eventKey],
      );
      if (old) {
        if (old.data.fingerprint !== hash(b))
          throw fail(
            409,
            "IDEMPOTENCY_CONFLICT",
            "This check-in differs from its original submission.",
          );
        return old;
      }
      const profile = await latest(tx, "nutrition_profile", a.userId);
      if (!profile || b.date > localDate(profile.data.profile.timezone))
        throw fail(
          400,
          "CHECKIN_DATE",
          "Choose a date that is not in the future.",
        );
      return putRecord(
        tx,
        a,
        "nutrition_checkin",
        { ...b, fingerprint: hash(b), allowedUses: ["render", "model_prompt"] },
        { ownerId: a.userId, status: "recorded" },
      );
    });
  });
  app.put(prefix + "/pantry", async (req) => {
    const a = auth.client(req),
      b = z
        .object({ planId: id, foodIds: z.array(id).max(300) })
        .strict()
        .parse(req.body);
    return db.tenant(internal(a), async (tx) => {
      await permission(tx, a.userId);
      const plan = await find(tx, b.planId, "nutrition_plan");
      if (
        plan.owner_user_id !== a.userId ||
        b.foodIds.some(
          (i) => !plan.data.view.groceries.some((g: any) => g.food.id === i),
        )
      )
        throw fail(
          400,
          "GROCERY_ITEM",
          "Choose ingredients from your own grocery list.",
        );
      return putRecord(tx, a, "nutrition_pantry", b, {
        ownerId: a.userId,
        status: "saved",
      });
    });
  });
  app.get(prefix + "/groceries/:id", async (req, reply) => {
    const a = auth.client(req);
    const csv = await db.tenant(internal(a), async (tx) => {
      const plan = await find(tx, (req.params as any).id, "nutrition_plan");
      if (plan.owner_user_id !== a.userId)
        throw fail(404, "NOT_FOUND", "Plan unavailable");
      const quote = (s: unknown) =>
        '"' +
        String(s)
          .replace(/^[=+@-]/, "'")
          .replaceAll('"', '""') +
        '"';
      return [
        "Ingredient,Preparation,Grams",
        ...plan.data.view.groceries.map((g: any) =>
          [quote(g.food.name), quote(g.food.preparation), g.grams].join(","),
        ),
      ].join("\n");
    });
    reply
      .type("text/csv")
      .header(
        "Content-Disposition",
        'attachment; filename="weekly-groceries.csv"',
      );
    return csv;
  });
}

export async function prepareNutritionWeek(
  db: Database,
  a: Actor,
  b: { requestKey: string; weekStart: string },
) {
  const initial = await db.tenant(internal(a), async (tx) => {
    await lock(tx, a, a.userId);
    await entitled(tx, a.userId);
    const permissions = await permission(tx, a.userId, true),
      profile = await latest(tx, "nutrition_profile", a.userId);
    if (!profile)
      throw fail(
        409,
        "PROFILE_REQUIRED",
        "Complete your nutrition profile first.",
      );
    const today = localDate(profile.data.profile.timezone);
    if (b.weekStart < today || b.weekStart > dateOffset(today, 28))
      throw fail(
        400,
        "PLAN_DATE",
        "Start a new plan today or within the next four weeks.",
      );
    const [prior] = await tx.query(
      "SELECT * FROM records WHERE kind='nutrition_request' AND owner_user_id=$1 AND data->>'requestKey'=$2",
      [a.userId, b.requestKey],
    );
    if (prior) {
      if (prior.data.weekStart !== b.weekStart)
        throw fail(
          409,
          "IDEMPOTENCY_CONFLICT",
          "This request key belongs to a different week.",
        );
      if (prior.status === "completed")
        return { done: await find(tx, prior.data.planId, "nutrition_plan") };
      return {
        blocked: {
          code: prior.data.code ?? "GENERATION_PENDING",
          message:
            prior.data.message ??
            "This request is still running. Refresh to check its result.",
        },
      };
    }
    const r = await requireNutritionReady(tx),
      m = r.material;
    const [existing] = await tx.query(
      "SELECT * FROM records WHERE kind='nutrition_plan' AND owner_user_id=$1 AND status='delivered' AND data->>'weekStart'=$2",
      [a.userId, b.weekStart],
    );
    if (existing && existing.data.profileId === profile.id)
      return { done: existing };
    const [running] = await tx.query(
      "SELECT id FROM records WHERE kind='nutrition_request' AND owner_user_id=$1 AND status='running' AND created_at>now()-interval '2 minutes'",
      [a.userId],
    );
    if (running)
      throw fail(
        409,
        "GENERATION_PENDING",
        "A meal plan is already being prepared.",
      );
    let targetKcal: number;
    try {
      targetKcal = nutritionTarget(m.policy!.data.policy, profile.data.profile);
    } catch (error) {
      const issue = availabilityError(error);
      await exception(tx, a, a.userId, issue.code, issue.message);
      return { blocked: issue };
    }
    const previous = await latest(tx, "nutrition_plan", a.userId),
      adjustment = m.policy!.data.policy.adjustment;
    let adjustmentEvidence: string[] = [];
    if (
      previous?.data.releaseId === r.release!.id &&
      previous.data.profileId === profile.id
    ) {
      targetKcal = previous.data.view.targetKcal;
      const checkins = await tx.query(
        "SELECT * FROM records WHERE kind='nutrition_checkin' AND owner_user_id=$1 AND created_at>$2 ORDER BY created_at DESC LIMIT 30",
        [a.userId, previous.created_at],
      );
      const distinct = [
        ...new Map(checkins.map((c) => [c.data.date, c])).values(),
      ];
      const oldDate = previous.data.weekStart;
      if (
        adjustment.enabled &&
        b.weekStart >= dateOffset(oldDate, adjustment.minimumDays) &&
        distinct.length >= adjustment.requiredCheckins
      ) {
        const sample = distinct.slice(0, adjustment.requiredCheckins);
        const dates = sample.map((c) => c.data.date).sort();
        if (
          dates.at(-1)! >= dateOffset(dates[0], adjustment.minimumDays) &&
          sample.every((c) =>
            adjustment.trigger === "hunger_high"
              ? c.data.hunger >= 4
              : c.data.difficulty <= 2,
          )
        ) {
          const next = targetKcal + adjustment.deltaKcal;
          if (
            next >= m.policy!.data.policy.minKcal &&
            next <= m.policy!.data.policy.maxKcal
          ) {
            targetKcal = next;
            adjustmentEvidence = sample.map((c) => c.id);
          } else
            await exception(
              tx,
              a,
              a.userId,
              "ADJUSTMENT_LIMIT",
              "Your check-ins suggest a change beyond the coach's automatic calorie limits.",
            );
        }
      }
    }
    const request = await putRecord(
      tx,
      a,
      "nutrition_request",
      { ...b, profileId: profile.id, releaseId: r.release!.id },
      { ownerId: a.userId, status: "running" },
    );
    return {
      request,
      profile,
      permissions,
      release: r.release!,
      material: m,
      targetKcal,
      adjustmentEvidence,
    };
  });
  if (initial.done) return { plan: initial.done, reused: true };
  if (initial.blocked) return { status: "exception", ...initial.blocked };
  const s = initial as Required<
    Pick<
      typeof initial,
      | "request"
      | "profile"
      | "permissions"
      | "release"
      | "material"
      | "targetKcal"
      | "adjustmentEvidence"
    >
  >;
  try {
    const week = await generate(
      {
        ...evidence(s.material),
        profile: s.profile.data.profile,
        targetKcal: s.targetKcal,
      },
      a,
      db,
    );
    const view = validateNutritionWeek({
      week,
      policy: s.material.policy!.data.policy,
      profile: s.profile.data.profile,
      foods: s.material.foods,
      recipes: s.material.recipes,
      caseIds: s.material.cases.map((c) => c.id),
      weekStart: b.weekStart,
      targetKcal: s.targetKcal,
    });
    return await db.tenant(internal(a), async (tx) => {
      await lock(tx, a, a.userId);
      await entitled(tx, a.userId);
      const now = await permission(tx, a.userId, true),
        profile = await latest(tx, "nutrition_profile", a.userId),
        ready = await requireNutritionReady(tx);
      if (
        profile?.id !== s.profile.id ||
        ready.release!.id !== s.release.id ||
        ready.material.digest !== s.material.digest ||
        now.processing.id !== s.permissions.processing.id ||
        now.ai.id !== s.permissions.ai.id
      )
        throw fail(
          409,
          "GENERATION_STALE",
          "Your profile, permission or coach knowledge changed during preparation.",
        );
      const [other] = await tx.query(
        "SELECT id FROM records WHERE kind='nutrition_plan' AND owner_user_id=$1 AND status='delivered' AND data->>'weekStart'=$2",
        [a.userId, b.weekStart],
      );
      if (other)
        throw fail(
          409,
          "PLAN_CHANGED",
          "Another plan has already been delivered for this week.",
        );
      const plan = await deliver(tx, a, a.userId, {
        weekStart: b.weekStart,
        profileId: s.profile.id,
        releaseId: s.release.id,
        digest: s.material.digest,
        choices: week,
        view,
        origin: "automatic",
        adjustmentEvidence: s.adjustmentEvidence,
        model: nutritionModelIdentity(),
      });
      await tx.query(
        "UPDATE records SET status='completed',data=data||$2::jsonb WHERE id=$1",
        [s.request.id, JSON.stringify({ planId: plan.id })],
      );
      return { plan, reused: false };
    });
  } catch (error) {
    const issue = availabilityError(error);
    await db.tenant(internal(a), async (tx) => {
      await lock(tx, a, a.userId);
      await tx.query(
        "UPDATE records SET status='failed',data=data||$2::jsonb WHERE id=$1 AND status='running'",
        [s.request.id, JSON.stringify(issue)],
      );
      await exception(tx, a, a.userId, issue.code, issue.message, s.request.id);
    });
    if ((error as any).statusCode) throw error;
    return { status: "exception", ...issue };
  }
}
