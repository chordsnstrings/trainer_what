import { randomUUID } from "node:crypto";
import type { Actor, Database } from "@trainer/db";
import type { ModelAccounting } from "@trainer/providers";

export function modelAccounting(
  db: Database,
  actor: Actor,
  task: string,
): ModelAccounting {
  const id = randomUUID();
  // Internal accounting retains the authenticated tenant/user. It grants no financial reads to the caller.
  const a = { ...actor, role: "owner" };
  return {
    async reserve(model) {
      const limit = Number(process.env.MODEL_MAX_DAILY_CALLS ?? "100");
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10000)
        throw new Error(
          "MODEL_MAX_DAILY_CALLS must be an integer from 1 to 10000",
        );
      await db.tenant(a, async (tx) => {
        await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          a.tenantId,
        ]);
        const [used] = await tx.query(
          "SELECT count(*)::int AS n FROM cost_events WHERE created_at >= date_trunc('day',now() AT TIME ZONE 'Asia/Dubai') AT TIME ZONE 'Asia/Dubai'",
        );
        if (used.n >= limit)
          throw Object.assign(
            new Error(
              "This workspace has reached its daily AI request limit. Trainer-authored coaching remains available.",
            ),
            { statusCode: 429, code: "MODEL_DAILY_LIMIT" },
          );
        await tx.query(
          "INSERT INTO cost_events(id,tenant_id,user_id,task,provider,model,input_tokens,output_tokens,cost_usd,status) VALUES($1,$2,$3,$4,'configured-model',$5,NULL,NULL,NULL,'reserved')",
          [id, a.tenantId, a.userId, task, model],
        );
      });
    },
    async record(usage) {
      await db.tenant(a, async (tx) => {
        const rows = await tx.query(
          "UPDATE cost_events SET input_tokens=$2,output_tokens=$3,cost_usd=$4,price_version=$5,trace_id=$6,pricing=$7,status=$8 WHERE id=$1 AND status='reserved' RETURNING id",
          [
            id,
            usage.input,
            usage.output,
            usage.cost,
            usage.priceVersion,
            usage.requestId,
            JSON.stringify(usage.pricing),
            usage.cost === null ? "unknown" : "recorded",
          ],
        );
        if (!rows.length)
          throw new Error(
            "Usage reservation was already finalized; reconcile the provider request",
          );
      });
    },
  };
}
