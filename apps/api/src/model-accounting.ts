import { runtimeConfig } from "../../../packages/providers/src/configuration.ts";
import { randomUUID } from "node:crypto";
import type { Actor, Database } from "@trainer/db";
import {
  modelProviderName,
  type ModelAccounting,
} from "../../../packages/providers/src/model-accounting.ts";
import { costTags, reviewedModelPrice } from "./cost-accounting.ts";

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

/**
 * Accounting for one model call. Every row records the real provider and
 * model, the member the call serves (`memberId`; a subscriber's own calls
 * default to the subscriber), the product and whether that member's access is
 * complimentary (docs/features/platform-finance.md). The price is the Super
 * admin's reviewed price for the provider and model when one is in effect,
 * else the AI model settings' price.
 */
export function modelAccounting(
  db: Database,
  actor: Actor,
  task: string,
  options: { memberId?: string | null } = {},
): ModelAccounting {
  const id = randomUUID();
  // Accounting runs in the caller's own scope: the workspace-wide daily counts
  // come from model_usage_today() (migration 061), and a member reads and
  // finalizes only its own usage rows. Nobody is raised to the owner role.
  const a = actor;
  const memberId =
    options.memberId !== undefined
      ? options.memberId
      : actor.role === "subscriber"
        ? actor.userId
        : null;
  return {
    async reserve(model) {
      const config = runtimeConfig(),
        provider = modelProviderName(config),
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
      const price = await reviewedModelPrice(db, provider, model);
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
        const tags = await costTags(tx, memberId, task);
        await tx.query(
          "INSERT INTO cost_events(id,tenant_id,user_id,task,provider,model,input_tokens,output_tokens,cost_usd,status,member_id,product,complimentary) VALUES($1,$2,$3,$4,$5,$6,NULL,NULL,NULL,'reserved',$7,$8,$9)",
          [
            id,
            a.tenantId,
            a.userId,
            task,
            provider,
            model,
            tags.memberId,
            tags.product,
            tags.complimentary,
          ],
        );
      });
      return price;
    },
    async record(usage) {
      await db.tenant(a, async (tx) => {
        // A price-sheet cost is also the row's estimate: a provider invoice
        // that differs is recorded as a correction, never by editing it.
        const rows = await tx.query(
          "UPDATE cost_events SET input_tokens=$2,output_tokens=$3,cost_usd=$4,price_version=$5,trace_id=$6,pricing=$7,status=$8,estimated_cost_usd=$4 WHERE id=$1 AND status='reserved' RETURNING id",
          [
            id,
            usage.input,
            usage.output,
            usage.cost,
            usage.priceVersion,
            usage.requestId,
            // The row's pricing inputs, plus the reasoning tokens inside the
            // output and the request style that answered (a retry after a
            // refused parameter names it): docs/features/model-gateway.md.
            JSON.stringify({
              ...usage.pricing,
              ...(usage.reasoning ? { reasoningTokens: usage.reasoning } : {}),
              ...(usage.request
                ? {
                    requestStyle: usage.request.style,
                    requestStyleSource: usage.request.source,
                    ...(usage.request.retriedAfterRefusal
                      ? { refusedParameter: usage.request.retriedAfterRefusal }
                      : {}),
                  }
                : {}),
            }),
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
