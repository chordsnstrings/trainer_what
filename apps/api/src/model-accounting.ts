import { runtimeConfig } from "../../../packages/providers/src/configuration.ts";
import { randomUUID } from "node:crypto";
import type { Actor, Database } from "@trainer/db";
import type { ModelAccounting } from "@trainer/providers";

// Subscriber-initiated nutrition calls (weekly plans and meal photos) have their own
// daily allowance and cannot use the workspace's final fifth, which stays available
// for the coach's teaching, evaluation and other members.
const SUBSCRIBER_CAPPED_TASKS = ["nutrition_week", "meal_photo_estimate"];
const dailyLimit = (key: string, value: string) => {
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10000)
    throw new Error(key + " must be an integer from 1 to 10000");
  return limit;
};

export function modelAccounting(
  db: Database,
  actor: Actor,
  task: string,
): ModelAccounting {
  const id = randomUUID();
  // Accounting runs in the caller's own scope: the workspace-wide daily counts
  // come from model_usage_today() (migration 061), and a member reads and
  // finalizes only its own usage rows. Nobody is raised to the owner role.
  const a = actor;
  return {
    async reserve(model) {
      const config = runtimeConfig(),
        limit = dailyLimit(
          "MODEL_MAX_DAILY_CALLS",
          config.MODEL_MAX_DAILY_CALLS ?? "100",
        ),
        capped =
          actor.role === "subscriber" && SUBSCRIBER_CAPPED_TASKS.includes(task),
        personal = capped
          ? dailyLimit(
              "MODEL_MAX_DAILY_CALLS_PER_SUBSCRIBER",
              config.MODEL_MAX_DAILY_CALLS_PER_SUBSCRIBER?.trim() || "20",
            )
          : 0;
      await db.tenant(a, async (tx) => {
        await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          a.tenantId,
        ]);
        const [used] = await tx.query(
          "SELECT n,subscribers,mine FROM model_usage_today($1::text[],$2)",
          [SUBSCRIBER_CAPPED_TASKS, a.userId],
        );
        if (
          used.n >= limit ||
          (capped && used.subscribers >= Math.ceil(limit * 0.8))
        )
          throw Object.assign(
            new Error(
              "This workspace has reached its daily AI request limit. Trainer-authored coaching remains available.",
            ),
            { statusCode: 429, code: "MODEL_DAILY_LIMIT" },
          );
        if (capped && used.mine >= personal)
          throw Object.assign(
            new Error(
              "You have reached today's limit for AI nutrition requests. Your current plan and manual meal entry remain available; try again tomorrow.",
            ),
            { statusCode: 429, code: "MODEL_USER_LIMIT" },
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
