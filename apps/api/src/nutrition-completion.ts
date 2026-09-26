import { randomUUID } from "node:crypto";
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
  nutritionCatalog,
  nutritionEntitlement,
  nutritionMaterial,
} from "./nutrition.ts";
import {
  nutritionMethodSchema,
  nutritionTargetSchema,
  calculateCoachTarget,
  validateClientTargets,
} from "../../../packages/domain/src/nutrition-completion.ts";
import {
  localDate,
  dateOffset,
  nutritionTarget,
  validateNutritionWeek,
  nutritionWeekSchema,
  type NutritionPolicy,
  type NutritionProfile,
} from "../../../packages/domain/src/nutrition.ts";
import { requireRecentMfa } from "./security.ts";
const id = z.string().uuid();
const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
type Identity = Actor & { mfaAt?: string | null };
export async function clientNutritionTarget(
  tx: Tx,
  userId: string,
  profile: any,
  policy: NutritionPolicy,
  effectiveDate?: string,
) {
  const kcal = nutritionTarget(policy, profile.data.profile);
  const [target] = await tx.query(
    "SELECT * FROM records WHERE kind='nutrition_target' AND owner_user_id=$1 AND status='active' ORDER BY created_at DESC,id DESC LIMIT 1",
    [userId],
  );
  if (!target) return { id: null, kcal, details: null };
  const today = effectiveDate ?? localDate(profile.data.profile.timezone);
  if (
    target.data.profileId !== profile.id ||
    target.data.target.reviewOn < today
  )
    throw fail(
      409,
      "TARGET_REVIEW",
      "The coach must review the individual target after this intake change or review date.",
    );
  if (
    target.data.target.kcal < policy.minKcal ||
    target.data.target.kcal > policy.maxKcal
  )
    throw fail(
      409,
      "TARGET_LIMIT",
      "The individual target no longer fits the coach's approved limits.",
    );
  return {
    id: target.id,
    kcal: target.data.target.kcal,
    details: target.data.target,
  };
}
async function clientContext(tx: Tx, a: Actor, userId: string) {
  const [member] = await tx.query(
    "SELECT role FROM memberships WHERE tenant_id=$1 AND user_id=$2 AND role='subscriber'",
    [a.tenantId, userId],
  );
  if (!member) throw fail(404, "NOT_FOUND", "Nutrition client unavailable");
  const [permission] = await tx.query(
    "SELECT granted FROM consent_records WHERE user_id=$1 AND document_type='nutrition' ORDER BY created_at DESC,id DESC LIMIT 1",
    [userId],
  );
  if (!permission?.granted)
    throw fail(
      403,
      "NUTRITION_PERMISSION",
      "This client has not granted nutrition permission",
    );
  const [profile] = await tx.query(
    "SELECT * FROM records WHERE kind='nutrition_profile' AND owner_user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1",
    [userId],
  );
  if (!profile)
    throw fail(
      409,
      "PROFILE_REQUIRED",
      "The client must complete their food preferences first",
    );
  return profile;
}
export function nutritionCompletionRoutes(
  app: FastifyInstance,
  db: Database,
  identity: (r: FastifyRequest) => Identity,
  testing = false,
) {
  const owner = (req: FastifyRequest) => {
    const a = identity(req);
    if (a.role !== "owner")
      throw fail(403, "OWNER_REQUIRED", "Coach owner access required");
    return a;
  };
  app.get("/api/v1/nutrition/methods", async (req) => {
    const a = owner(req);
    return db.tenant(a, (tx) =>
      tx.query(
        "SELECT * FROM records WHERE kind='nutrition_method' ORDER BY created_at DESC",
      ),
    );
  });
  app.post("/api/v1/nutrition/methods", async (req) => {
    const a = owner(req),
      b = nutritionMethodSchema.parse(req.body);
    return db.tenant(a, async (tx) => {
      const m = await nutritionMaterial(tx);
      if (b.sourceIds.some((id) => !m.cases.some((c) => c.id === id)))
        throw fail(
          400,
          "METHOD_EVIDENCE",
          "Choose current confirmed teaching cases for this method",
        );
      const r = await putRecord(tx, a, "nutrition_method", b, {
        status: "confirmed",
      });
      await event(tx, a, "nutrition.method_confirmed", r.id);
      return r;
    });
  });
  app.get("/api/v1/nutrition/clients/:id/control", async (req) => {
    const a = owner(req),
      uid = id.parse((req.params as any).id);
    return db.tenant(a, async (tx) => {
      const profile = await clientContext(tx, a, uid),
        material = await nutritionMaterial(tx);
      return {
        profile,
        policy: material.policy,
        cases: material.cases,
        foods: material.foods,
        recipes: material.recipes,
        methods: await tx.query(
          "SELECT * FROM records WHERE kind='nutrition_method' AND status='confirmed' ORDER BY created_at DESC",
        ),
        targets: await tx.query(
          "SELECT * FROM records WHERE kind='nutrition_target' AND owner_user_id=$1 ORDER BY created_at DESC,id DESC",
          [uid],
        ),
        plans: await tx.query(
          "SELECT * FROM records WHERE kind='nutrition_plan' AND owner_user_id=$1 ORDER BY data->>'weekStart' DESC,created_at DESC",
          [uid],
        ),
        today: localDate(profile.data.profile.timezone),
      };
    });
  });
  app.post("/api/v1/nutrition/clients/:id/target", async (req) => {
    const a = owner(req),
      uid = id.parse((req.params as any).id),
      b = z
        .object({
          previousId: id.nullable(),
          profileId: id,
          target: nutritionTargetSchema,
          methodId: id.nullable(),
          weightKg: z.number().min(20).max(500).optional(),
        })
        .strict()
        .parse(req.body);
    return db.tenant(a, async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        a.tenantId + ":nutrition:" + uid,
      ]);
      const profile = await clientContext(tx, a, uid),
        m = await nutritionMaterial(tx);
      if (!m.policy)
        throw fail(
          409,
          "POLICY_REQUIRED",
          "Confirm the coach's nutrition policy first",
        );
      if (profile.id !== b.profileId)
        throw fail(
          409,
          "PROFILE_CHANGED",
          "The food profile changed. Reload before setting a target.",
        );
      nutritionTarget(m.policy.data.policy, profile.data.profile);
      const [prior] = await tx.query(
        "SELECT * FROM records WHERE kind='nutrition_target' AND owner_user_id=$1 AND status='active' ORDER BY created_at DESC,id DESC LIMIT 1",
        [uid],
      );
      if ((prior?.id ?? null) !== b.previousId)
        throw fail(
          409,
          "TARGET_CHANGED",
          "Reload the changed individual target",
        );
      const today = localDate(profile.data.profile.timezone);
      if (
        b.target.reviewOn < today ||
        b.target.reviewOn > dateOffset(today, 90)
      )
        throw fail(
          400,
          "REVIEW_DATE",
          "Review the target within the next ninety days",
        );
      let method: any = null;
      if (b.methodId) {
        [method] = await tx.query(
          "SELECT * FROM records WHERE kind='nutrition_method' AND status='confirmed' AND id=$1",
          [b.methodId],
        );
        if (!method) throw fail(404, "NOT_FOUND", "Calorie method unavailable");
        if (
          method.data.sourceIds.some(
            (id: string) => !m.cases.some((c) => c.id === id),
          )
        )
          throw fail(
            409,
            "METHOD_STALE",
            "This calorie method cites changed teaching; confirm a new method",
          );
        const result = calculateCoachTarget(
          method.data,
          { weightKg: b.weightKg },
          m.policy.data.policy,
          profile.data.profile,
        );
        if (result !== b.target.kcal)
          throw fail(
            400,
            "TARGET_CALCULATION",
            "The entered target does not match the selected coach method",
          );
      }
      if (
        b.target.kcal < m.policy.data.policy.minKcal ||
        b.target.kcal > m.policy.data.policy.maxKcal
      )
        throw fail(
          400,
          "TARGET_LIMIT",
          "Keep the individual target within the confirmed policy range",
        );
      if (prior)
        await tx.query("UPDATE records SET status='archived' WHERE id=$1", [
          prior.id,
        ]);
      const r = await putRecord(
        tx,
        a,
        "nutrition_target",
        {
          target: b.target,
          profileId: profile.id,
          previousId: prior?.id ?? null,
          method: method
            ? { id: method.id, ...method.data, weightKg: b.weightKg ?? null }
            : null,
          policyId: m.policy.id,
          allowedUses: ["render", "model_prompt"],
        },
        { ownerId: uid, status: "active" },
      );
      await event(tx, a, "nutrition.client_target_set", r.id, { userId: uid });
      return r;
    });
  });
  app.post("/api/v1/nutrition/clients/:id/plan", async (req) => {
    const a = owner(req),
      uid = id.parse((req.params as any).id),
      b = z
        .object({
          weekStart: z.iso.date(),
          profileId: id,
          previousId: id.nullable(),
          previousVersion: z.number().int().min(1).nullable(),
          week: nutritionWeekSchema,
          reason: z.string().trim().min(10).max(2000),
        })
        .strict()
        .parse(req.body);
    return db.tenant(a, async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        a.tenantId + ":nutrition:" + uid,
      ]);
      const profile = await clientContext(tx, a, uid),
        m = await nutritionMaterial(tx);
      if (!(await nutritionEntitlement(tx, uid)))
        throw fail(
          402,
          "NUTRITION_MEMBERSHIP",
          "Workout + nutrition membership is required",
        );
      if (profile.id !== b.profileId)
        throw fail(
          409,
          "PROFILE_CHANGED",
          "The food profile changed. Reload the plan editor.",
        );
      if (!m.policy)
        throw fail(
          409,
          "POLICY_REQUIRED",
          "Confirm the coach's nutrition policy first",
        );
      const today = localDate(profile.data.profile.timezone);
      if (
        dateOffset(b.weekStart, 6) < today ||
        b.weekStart > dateOffset(today, 28)
      )
        throw fail(
          400,
          "PLAN_DATE",
          "Assign a current week or one starting within four weeks",
        );
      const [prior] = await tx.query(
        "SELECT * FROM records WHERE kind='nutrition_plan' AND owner_user_id=$1 AND status='delivered' AND data->>'weekStart'=$2",
        [uid, b.weekStart],
      );
      if (
        (prior?.id ?? null) !== b.previousId ||
        (prior?.version ?? null) !== b.previousVersion
      )
        throw fail(
          409,
          "PLAN_CHANGED",
          "The delivered week changed. Reload before amending it.",
        );
      const target = await clientNutritionTarget(
        tx,
        uid,
        profile,
        m.policy.data.policy,
        b.weekStart,
      );
      const view = validateNutritionWeek({
        week: b.week,
        weekStart: b.weekStart,
        profile: profile.data.profile,
        policy: m.policy.data.policy,
        foods: m.foods,
        recipes: m.recipes,
        caseIds: m.cases.map((c) => c.id),
        targetKcal: target.kcal,
      });
      validateClientTargets(view, target.details);
      if (prior)
        await tx.query("UPDATE records SET status='archived' WHERE id=$1", [
          prior.id,
        ]);
      const plan = await putRecord(
        tx,
        a,
        "nutrition_plan",
        {
          weekStart: b.weekStart,
          profileId: profile.id,
          releaseId: null,
          digest: m.digest,
          choices: b.week,
          view,
          targetId: target.id,
          target: target.details,
          origin: "coach_assigned",
          previousId: prior?.id ?? null,
          reason: b.reason,
          allowedUses: ["render", "model_prompt"],
        },
        { ownerId: uid, status: "delivered" },
      );
      await putRecord(
        tx,
        a,
        "nutrition_plan_edit",
        {
          planId: plan.id,
          previousId: prior?.id ?? null,
          reason: b.reason,
          action: prior ? "amend" : "assign",
        },
        { ownerId: uid, status: "recorded" },
      );
      await event(tx, a, "nutrition.coach_plan_delivered", plan.id, {
        userId: uid,
        previousId: prior?.id ?? null,
      });
      return plan;
    });
  });
  app.post("/api/v1/nutrition/plans/:id/archive", async (req) => {
    const a = owner(req),
      planId = id.parse((req.params as any).id),
      b = z
        .object({
          version: z.number().int().min(1),
          reason: z.string().trim().min(10).max(2000),
        })
        .strict()
        .parse(req.body);
    return db.tenant(a, async (tx) => {
      const [old] = await tx.query(
        "SELECT * FROM records WHERE id=$1 AND kind='nutrition_plan'",
        [planId],
      );
      if (!old) throw fail(404, "NOT_FOUND", "Meal week unavailable");
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        a.tenantId + ":nutrition:" + old.owner_user_id,
      ]);
      const changed = await tx.query(
        "UPDATE records SET status='archived',version=version+1 WHERE id=$1 AND version=$2 AND status='delivered' RETURNING id",
        [old.id, b.version],
      );
      if (!changed.length)
        throw fail(409, "PLAN_CHANGED", "Reload this meal week");
      await putRecord(
        tx,
        a,
        "nutrition_plan_edit",
        { planId: old.id, action: "archive", reason: b.reason },
        { ownerId: old.owner_user_id, status: "recorded" },
      );
      await event(tx, a, "nutrition.plan_archived", old.id, {
        reason: b.reason,
      });
      return { archived: true };
    });
  });
  app.get("/api/v1/nutrition/catalog-history", async (req) => {
    const a = owner(req);
    return db.tenant(a, async (tx) => ({
      ...(await nutritionCatalog(tx, true)),
      active: await nutritionCatalog(tx),
      archives: await tx.query(
        "SELECT * FROM records WHERE kind='nutrition_catalog_archive' AND status='active'",
      ),
    }));
  });
  app.post("/api/v1/nutrition/catalog/:kind/:id/archive", async (req) => {
    const a = owner(req),
      p = z.object({ kind: z.enum(["food", "recipe"]), id }).parse(req.params),
      b = z
        .object({
          reason: z.string().trim().min(10).max(1000),
          archived: z.boolean(),
        })
        .strict()
        .parse(req.body);
    return db.tenant(a, async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        a.tenantId + ":nutrition:setup",
      ]);
      const [item] = await tx.query(
        `SELECT id FROM ${p.kind === "food" ? "nutrition_foods" : "nutrition_recipes"} WHERE id=$1`,
        [p.id],
      );
      if (!item) throw fail(404, "NOT_FOUND", "Catalog version unavailable");
      await tx.query(
        "UPDATE records SET status='withdrawn' WHERE kind='nutrition_catalog_archive' AND data->>'entityId'=$1 AND status='active'",
        [p.id],
      );
      const record = await putRecord(
        tx,
        a,
        "nutrition_catalog_archive",
        { entityId: p.id, entityKind: p.kind, reason: b.reason },
        { status: b.archived ? "active" : "withdrawn" },
      );
      await event(tx, a, "nutrition.catalog_availability_changed", p.id, {
        archived: b.archived,
        reason: b.reason,
      });
      return record;
    });
  });
  app.get("/api/v1/nutrition/recovery", async (req) => {
    const a = owner(req);
    return db.tenant(a, (tx) =>
      tx.query(
        `SELECT j.id,j.status,j.attempts,j.last_error,j.data,j.leased_until,r.id AS request_id,r.status AS request_status,r.data->>'providerState' AS provider_state,r.data->>'providerReference' AS provider_reference FROM jobs j LEFT JOIN records r ON r.kind='nutrition_request' AND r.data->>'requestKey'=j.id::text WHERE j.kind='nutrition_week' AND j.status IN ('blocked','failed','cancelled') ORDER BY j.created_at DESC LIMIT 100`,
      ),
    );
  });
  app.post("/api/v1/nutrition/recovery/:id", async (req) => {
    const a = owner(req),
      jobId = id.parse((req.params as any).id),
      b = z
        .object({
          attempts: z.number().int().min(0),
          action: z.enum([
            "retry_unsent",
            "provider_confirmed_not_processed",
            "provider_confirmed_processed_close",
            "close",
          ]),
          reason: z.string().trim().min(10).max(2000),
          providerReference: z.string().trim().max(500).optional(),
        })
        .strict()
        .parse(req.body);
    requireRecentMfa(a);
    return db.tenant(a, async (tx) => {
      const [job] = await tx.query(
        "SELECT * FROM jobs WHERE id=$1 AND kind='nutrition_week' FOR UPDATE",
        [jobId],
      );
      if (!job) throw fail(404, "NOT_FOUND", "Weekly job unavailable");
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        a.tenantId + ":nutrition:" + job.data.userId,
      ]);
      if (
        !["blocked", "failed", "cancelled"].includes(job.status) ||
        job.attempts !== b.attempts ||
        (job.leased_until && new Date(job.leased_until).getTime() > Date.now())
      )
        throw fail(409, "JOB_CHANGED", "Reload this job before recovering it");
      const [request] = await tx.query(
        "SELECT * FROM records WHERE kind='nutrition_request' AND data->>'requestKey'=$1",
        [job.id],
      );
      const state =
        request?.data.providerState ?? (request ? "uncertain" : "not_sent");
      if (b.action === "retry_unsent" && state !== "not_sent")
        throw fail(
          409,
          "PROVIDER_RECONCILIATION",
          "This request may have reached the provider. Obtain provider evidence before another paid attempt.",
        );
      const closes = ["close", "provider_confirmed_processed_close"].includes(
        b.action,
      );
      if (
        b.action.startsWith("provider_confirmed_") &&
        (!b.providerReference || b.providerReference.length < 6)
      )
        throw fail(
          400,
          "PROVIDER_EVIDENCE",
          "Record the provider's trace or support reference confirming the request was not processed.",
        );
      if (request?.status === "completed" && !closes)
        throw fail(409, "PLAN_EXISTS", "This request already delivered a plan");
      if (!closes) {
        const [profile] = await tx.query(
          "SELECT * FROM records WHERE kind='nutrition_profile' AND owner_user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1",
          [job.data.userId],
        );
        if (
          !profile ||
          profile.id !== job.data.profileId ||
          job.data.weekStart < localDate(profile.data.profile.timezone)
        )
          throw fail(
            409,
            "OBSOLETE_WEEK",
            "This week or profile is obsolete. Close it; the scheduler will prepare a current week.",
          );
        if (request)
          await tx.query(
            "UPDATE records SET status='retryable',version=version+1,updated_at=now() WHERE id=$1",
            [request.id],
          );
      }
      if (b.action === "close" && request && request.status !== "completed")
        await tx.query(
          "UPDATE records SET status='closed',version=version+1 WHERE id=$1",
          [request.id],
        );
      if (b.action === "provider_confirmed_processed_close" && request)
        await tx.query("UPDATE records SET data=data||$2::jsonb WHERE id=$1", [
          request.id,
          JSON.stringify({
            providerState: "responded",
            providerReference: b.providerReference,
          }),
        ]);
      const recovery = await putRecord(
        tx,
        a,
        "nutrition_recovery",
        { jobId, requestId: request?.id ?? null, providerState: state, ...b },
        { ownerId: job.data.userId, status: "recorded" },
      );
      await tx.query(
        "UPDATE jobs SET status=$2,leased_until=NULL,available_at=now(),last_error=NULL WHERE id=$1",
        [job.id, closes ? "cancelled" : "pending"],
      );
      await event(tx, a, "nutrition.week_recovered", job.id, {
        recoveryId: recovery.id,
        action: b.action,
      });
      return {
        status: closes ? "cancelled" : "pending",
        recoveryId: recovery.id,
      };
    });
  });
}
