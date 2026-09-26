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
import { nutritionCatalog, nutritionEntitlement } from "./nutrition.ts";
import { localDate } from "../../../packages/domain/src/nutrition.ts";
import { requireRecentMfa } from "./security.ts";
const id = z.string().uuid();
const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
type Identity = Actor & { mfaAt?: string | null };
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
