import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, putRecord, type Database } from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";
import { fixtureCatalog, fixtureProfile } from "./nutrition-fixtures.ts";
import { localDate } from "../packages/domain/src/nutrition.ts";
let db: Database,
  app: Awaited<ReturnType<typeof buildApp>>,
  owner: any,
  other: any;
const origin = "http://localhost:3000";
async function req(
  path: string,
  method: any = "GET",
  payload?: any,
  as = owner,
) {
  return app.inject({
    url: "/api/v1" + path,
    method,
    payload,
    headers: { origin, ...(as?.cookie ? { cookie: as.cookie } : {}) },
  });
}
async function ok(path: string, method: any = "GET", body?: any, as = owner) {
  const r = await req(path, method, body, as);
  assert.ok(r.statusCode < 300, r.body);
  return r.json();
}
async function register(slug: string) {
  const r = await req(
    "/auth/register",
    "POST",
    {
      slug,
      name: slug,
      email: slug + "@example.test",
      password: "CompletionFixture2026!",
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
before(async () => {
  db = await createDatabase({ memory: true });
  app = await buildApp({ db, testing: true });
  owner = await register("nutrition-completion");
  other = await register("nutrition-other");
});
after(async () => {
  await app.close();
  await db.close();
});
test("catalog candidates exclude superseded and archived facts while history is retained", async () => {
  const fixture = fixtureCatalog(),
    { id: _, ...food } = fixture.foods[0];
  const f = await ok("/nutrition/foods", "POST", { food });
  const { id: __, ...recipe } = fixture.recipes[0];
  recipe.variants = recipe.variants.map((v) => ({
    ...v,
    ingredients: [{ foodId: f.id, grams: 400 }],
  }));
  const r = await ok("/nutrition/recipes", "POST", { recipe });
  const f2 = await ok("/nutrition/foods", "POST", {
    food: { ...food, name: "Updated food facts" },
    supersedesId: f.id,
  });
  let c = await ok("/nutrition/catalog-history");
  assert.equal(c.foods.length, 2);
  assert.deepEqual(
    c.active.foods.map((x: any) => x.id),
    [f2.id],
  );
  assert.equal(c.active.recipes.length, 0);
  assert.equal(c.recipes[0].id, r.id);
  assert.equal(
    (await req("/nutrition/foods", "POST", { food, supersedesId: f.id }))
      .statusCode,
    409,
  );
  assert.equal(
    (await req("/nutrition/recipes", "POST", { recipe })).statusCode,
    409,
  );
  await ok(`/nutrition/catalog/food/${f2.id}/archive`, "POST", {
    archived: true,
    reason: "Retired after ingredient review",
  });
  c = await ok("/nutrition/catalog-history");
  assert.equal(c.active.foods.length, 0);
  assert.equal(
    (
      await req(
        `/nutrition/catalog/food/${f2.id}/archive`,
        "POST",
        { archived: false, reason: "Other tenant cannot change it" },
        other,
      )
    ).statusCode,
    404,
  );
  await ok(`/nutrition/catalog/food/${f2.id}/archive`, "POST", {
    archived: false,
    reason: "Reviewed and available again",
  });
  assert.equal((await ok("/nutrition/catalog-history")).active.foods.length, 1);
});
async function blockedJob(state: string | undefined) {
  const jobId = randomUUID();
  await db.tenant(owner, async (tx) => {
    const profile = await putRecord(
      tx,
      owner,
      "nutrition_profile",
      { profile: fixtureProfile },
      { ownerId: owner.userId, status: "active" },
    );
    await tx.query(
      "INSERT INTO jobs(id,tenant_id,kind,intent_key,data,status,attempts) VALUES($1::uuid,$2,'nutrition_week',$1::text,$3,'blocked',1)",
      [
        jobId,
        owner.tenantId,
        JSON.stringify({
          userId: owner.userId,
          profileId: profile.id,
          weekStart: localDate(fixtureProfile.timezone),
        }),
      ],
    );
    if (state)
      await putRecord(
        tx,
        owner,
        "nutrition_request",
        { requestKey: jobId, providerState: state },
        { ownerId: owner.userId, status: "failed" },
      );
  });
  return jobId;
}
test("weekly recovery retries only unsent intent and persists an auditable provider reconciliation", async () => {
  const unsent = await blockedJob("not_sent");
  assert.equal(
    (
      await ok(`/nutrition/recovery/${unsent}`, "POST", {
        attempts: 1,
        action: "retry_unsent",
        reason: "Provider configuration repaired",
      })
    ).status,
    "pending",
  );
  assert.equal(
    (
      await req(`/nutrition/recovery/${unsent}`, "POST", {
        attempts: 1,
        action: "retry_unsent",
        reason: "Duplicate recovery must conflict",
      })
    ).statusCode,
    409,
  );
  const unknown = await blockedJob("uncertain");
  assert.equal(
    (
      await req(`/nutrition/recovery/${unknown}`, "POST", {
        attempts: 1,
        action: "retry_unsent",
        reason: "Attempted provider call timed out",
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await req(`/nutrition/recovery/${unknown}`, "POST", {
        attempts: 1,
        action: "provider_confirmed_not_processed",
        reason: "No evidence must not allow replay",
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await req(
        `/nutrition/recovery/${unknown}`,
        "POST",
        {
          attempts: 1,
          action: "close",
          reason: "Another owner cannot recover this",
        },
        other,
      )
    ).statusCode,
    404,
  );
  await ok(`/nutrition/recovery/${unknown}`, "POST", {
    attempts: 1,
    action: "provider_confirmed_not_processed",
    reason: "Provider support confirms request never accepted",
    providerReference: "synthetic-case-0001",
  });
  const [audit] = await db.tenant(owner, (tx) =>
    tx.query(
      "SELECT * FROM records WHERE kind='nutrition_recovery' AND data->>'jobId'=$1",
      [unknown],
    ),
  );
  assert.equal(audit.data.providerState, "uncertain");
  assert.equal(audit.data.providerReference, "synthetic-case-0001");
});
