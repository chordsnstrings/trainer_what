import { randomUUID } from "node:crypto";
import { putRecord, type Database, type Actor } from "@trainer/db";
import {
  fixtureCatalog,
  fixtureCases,
  fixturePolicy,
  fixtureProfile,
  fixtureWeek,
} from "../tests/nutrition-fixtures.ts";
import {
  validateNutritionWeek,
  localDate,
} from "../packages/domain/src/nutrition.ts";
import { nutritionMaterial } from "../apps/api/src/nutrition.ts";

export async function seedNutritionDemo(db: Database, a: Actor) {
  if (process.env.NODE_ENV === "production")
    throw new Error("Nutrition fixtures are forbidden in production");
  return db.tenant(a, async (tx) => {
    const [exists] = await tx.query(
      "SELECT id FROM records WHERE kind='nutrition_setup'",
    );
    if (exists) return;
    const catalog = fixtureCatalog(),
      cases = fixtureCases(),
      policy = fixturePolicy(cases.map((c) => c.id));
    await putRecord(
      tx,
      a,
      "nutrition_setup",
      { enabled: true, synthetic: true },
      { status: "saved" },
    );
    for (const c of cases) {
      const { id, ...data } = c;
      await putRecord(
        tx,
        a,
        "nutrition_case",
        {
          ...data,
          synthetic: true,
          allowedUses: ["model_prompt", "trainer_specific_learning"],
        },
        { id, status: "confirmed" },
      );
    }
    await putRecord(
      tx,
      a,
      "nutrition_policy",
      { policy, gaps: [], conflicts: [], synthetic: true },
      { status: "confirmed" },
    );
    for (const f of catalog.foods)
      await tx.query(
        "INSERT INTO nutrition_foods(id,tenant_id,name,preparation,nutrients,allergens,ingredient_tags,allergen_review_complete,estimated,source) VALUES($1,$2,$3,$4,$5,$6,$7,true,true,$8)",
        [
          f.id,
          a.tenantId,
          f.name,
          f.preparation,
          JSON.stringify(f.nutrientsPer100g),
          JSON.stringify(f.allergens),
          JSON.stringify(f.ingredientTags),
          f.source,
        ],
      );
    for (const r of catalog.recipes) {
      await tx.query(
        "INSERT INTO nutrition_recipes(id,tenant_id,name,description,diet_tags,slots,budget,yield_servings,source) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          r.id,
          a.tenantId,
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
            r.id,
            v.key,
            v.name,
            JSON.stringify(v.equipment),
            v.minutes,
            JSON.stringify(v.steps),
            v.storageNote,
          ],
        );
        for (const [i, x] of v.ingredients.entries())
          await tx.query(
            "INSERT INTO nutrition_ingredients(tenant_id,recipe_id,option_key,position,food_id,grams) VALUES($1,$2,$3,$4,$5,$6)",
            [a.tenantId, r.id, v.key, i, x.foodId, x.grams],
          );
      }
    }
    const material = await nutritionMaterial(tx),
      release = await putRecord(
        tx,
        a,
        "nutrition_release",
        {
          ...material.snapshot,
          digest: material.digest,
          verificationMode: "fixture",
          synthetic: true,
          mode: "demonstration_only",
        },
        { status: "published" },
      );
    const [sam] = await tx.query(
      "SELECT u.id FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.tenant_id=$1 AND u.email='sam.taylor@example.test'",
      [a.tenantId],
    );
    if (!sam) return;
    for (const type of ["nutrition", "nutrition_model"])
      await tx.query(
        "INSERT INTO consent_records(id,tenant_id,user_id,document_type,document_version,granted) VALUES($1,$2,$3,$4,'synthetic-demo-only',true)",
        [randomUUID(), a.tenantId, sam.id, type],
      );
    const profile = await putRecord(
      tx,
      a,
      "nutrition_profile",
      {
        profile: fixtureProfile,
        synthetic: true,
        allowedUses: ["render", "model_prompt"],
      },
      { ownerId: sam.id, status: "current" },
    );
    const weekStart = localDate(fixtureProfile.timezone),
      choices = fixtureWeek(
        catalog.recipes,
        cases.map((c) => c.id),
      ),
      view = validateNutritionWeek({
        week: choices,
        policy,
        profile: fixtureProfile,
        ...catalog,
        caseIds: cases.map((c) => c.id),
        weekStart,
      });
    await putRecord(
      tx,
      a,
      "nutrition_plan",
      {
        weekStart,
        choices,
        view,
        profileId: profile.id,
        releaseId: release.id,
        digest: material.digest,
        origin: "synthetic_fixture",
        allowedUses: ["render"],
        synthetic: true,
      },
      { ownerId: sam.id, status: "delivered" },
    );
    await tx.query(
      'UPDATE subscriptions SET data=data||\'{"modules":["training","nutrition"],"tier":"workout_nutrition","synthetic":true}\'::jsonb WHERE user_id=$1',
      [sam.id],
    );
  });
}
