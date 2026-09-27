import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { event, type Actor, type Database, type Tx } from "@trainer/db";
import {
  REVIEW_CATEGORIES,
  SAFETY_FLOOR,
  SAFETY_POLICY_KEY,
  effectiveSafetyPolicy,
  screenSafety,
  validateSafetyPolicy,
  type EffectiveSafetyPolicy,
  type SafetyScreen,
} from "../../../packages/domain/src/safety-policy.ts";
import { notifyCoachingTeam } from "./notifications.ts";

const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
const HOUR = 3600_000;
const SYSTEM_ACTOR = "00000000-0000-0000-0000-000000000000";

/** Reads the published policy inside a tenant transaction (trainer_app helper). */
export async function activeSafetyPolicy(tx: Tx) {
  const [row] = await tx.query<{ value: any }>(
    "SELECT published_safety_policy() AS value",
  );
  return effectiveSafetyPolicy(row?.value ?? null);
}
/** Reads the published policy from a system transaction (operators only). */
export async function publishedSafetyPolicy(tx: Tx) {
  const [row] = await tx.query(
    "SELECT key,version,content,effective_at FROM admin_documents WHERE kind='safety' AND key=$1 AND status='published' AND effective_at<=now() ORDER BY effective_at DESC,version DESC LIMIT 1",
    [SAFETY_POLICY_KEY],
  );
  return effectiveSafetyPolicy(
    row
      ? {
          key: row.key,
          version: row.version,
          content: row.content,
          effectiveAt: new Date(row.effective_at).toISOString(),
        }
      : null,
  );
}
export type SafetyDecision = SafetyScreen & { policy: EffectiveSafetyPolicy };
/** Code floor first, then the published policy's tightening terms and categories. */
export async function screenForSafety(
  tx: Tx,
  text: string,
): Promise<SafetyDecision> {
  const policy = await activeSafetyPolicy(tx);
  return { ...screenSafety(text, policy), policy };
}
/** The pinned policy data stored on every safety decision record. */
export function safetyDecisionData(
  decision: Pick<SafetyDecision, "policy"> &
    Partial<Pick<SafetyDecision, "floor" | "policyTerms" | "reviewCategories">>,
  kind: "hold" | "personal_review",
  now = new Date(),
) {
  const hours =
    kind === "hold"
      ? decision.policy.holdReviewHours
      : decision.policy.personalReviewHours;
  return {
    safetyPolicy: decision.policy.pin,
    reviewDueAt: new Date(now.getTime() + hours * HOUR).toISOString(),
    screening: {
      floor: decision.floor ?? null,
      policyTerms: decision.policyTerms ?? [],
      reviewCategories: decision.reviewCategories ?? [],
    },
  };
}
/**
 * Worker pass: an open safety hold or policy personal review past its
 * deadline is marked overdue once, logged and re-sent to the coaching team.
 * Deadlines only shorten: a later, stricter policy applies to open items.
 */
export async function scheduleSafetyEscalations(
  db: Database,
  tenantId: string,
  now = new Date(),
) {
  const a: Actor = { tenantId, userId: SYSTEM_ACTOR, role: "owner" };
  return db.tenant(a, async (tx) => {
    const rows = await tx.query(
      "SELECT id,owner_user_id,created_at,data FROM records WHERE kind='exception' AND status='open' AND data->>'category' IN ('safety','policy_review') AND NOT (data ? 'overdueAt') ORDER BY created_at,id LIMIT 50",
    );
    if (!rows.length) return 0;
    const policy = await activeSafetyPolicy(tx);
    let escalated = 0;
    for (const r of rows) {
      const hours =
        r.data.category === "safety"
          ? policy.holdReviewHours
          : policy.personalReviewHours;
      const pinned = Date.parse(r.data.reviewDueAt ?? ""),
        current = new Date(r.created_at).getTime() + hours * HOUR,
        due = Number.isFinite(pinned) ? Math.min(pinned, current) : current;
      if (due > now.getTime()) continue;
      const escalation = {
        at: now.toISOString(),
        dueAt: new Date(due).toISOString(),
        safetyPolicy: policy.pin,
      };
      const [updated] = await tx.query(
        "UPDATE records SET data=data||$2::jsonb,version=version+1,updated_at=now() WHERE id=$1 AND kind='exception' AND status='open' AND NOT (data ? 'overdueAt') RETURNING id",
        [r.id, JSON.stringify({ overdueAt: escalation.at, escalation })],
      );
      if (!updated) continue;
      escalated++;
      await event(tx, a, "safety.review_overdue", r.id, {
        category: r.data.category,
        dueAt: escalation.dueAt,
        policyVersion: policy.pin.version,
      });
      await notifyCoachingTeam(tx, a, {
        category: "safety",
        dedupeKey: `safety-overdue:${r.id}`,
        title:
          r.data.category === "safety"
            ? "A safety review is overdue"
            : "A personal review is overdue",
        body:
          r.data.category === "safety"
            ? "A client's paused training passed its safety review deadline. Open your exceptions and review it now; the platform safety team can see overdue reviews."
            : "A client question routed to you by the safety policy passed its review deadline. Open your exceptions and reply personally.",
        href: "/trainer/exceptions",
        templateKey: "safety-review-overdue",
      });
    }
    return escalated;
  });
}

type Identity = Actor & { platformRole?: string; mfaAt?: string | null };
export function policySummary(policy: EffectiveSafetyPolicy) {
  return {
    version: policy.pin.version,
    effectiveAt: policy.pin.effectiveAt,
    source: policy.pin.source,
    ignored: policy.pin.ignored,
    holdReviewHours: policy.holdReviewHours,
    personalReviewHours: policy.personalReviewHours,
    redFlagTerms: policy.redFlagTerms,
    personalReviewCategories: policy.personalReviewCategories.map((key) => ({
      key,
      label: REVIEW_CATEGORIES[key].label,
    })),
    personalReviewTerms: policy.personalReviewTerms,
    summary: policy.summary,
    floor: {
      holdReviewHours: SAFETY_FLOOR.holdReviewHours,
      personalReviewHours: SAFETY_FLOOR.personalReviewHours,
      holdCategories: SAFETY_FLOOR.holdCategories,
    },
  };
}
export function registerSafetyPolicy(
  app: FastifyInstance,
  db: Database,
  identity: (req: FastifyRequest) => Identity,
  operator: (req: FastifyRequest, roles: string[]) => Identity,
) {
  // Trainers see the rules that govern their attention list.
  app.get("/api/v1/safety/policy", async (req) => {
    const a = identity(req);
    if (!["owner", "staff"].includes(a.role))
      throw fail(403, "TRAINER_REQUIRED", "Trainer access required");
    return policySummary(await db.tenant(a, activeSafetyPolicy));
  });
  app.get("/api/v1/admin/safety-policy", async (req) => {
    operator(req, ["admin", "safety"]);
    const policy = await db.system(publishedSafetyPolicy);
    return {
      key: SAFETY_POLICY_KEY,
      active: policySummary(policy),
      categories: Object.entries(REVIEW_CATEGORIES).map(([key, c]) => ({
        key,
        label: c.label,
        terms: c.terms,
      })),
      example: {
        schema: 1,
        summary: "Reviewed coaching safety policy",
        redFlagTerms: ["dialysis"],
        personalReviewCategories: ["medication"],
        personalReviewTerms: [],
        holdReviewHours: 12,
        personalReviewHours: 48,
      },
    };
  });
  app.post("/api/v1/admin/safety-policy/check", async (req) => {
    operator(req, ["admin", "safety"]);
    const b = z
      .object({ content: z.string().min(2).max(60000) })
      .strict()
      .parse(req.body);
    const result = validateSafetyPolicy(b.content);
    return result.ok
      ? { ok: true, effective: policySummary(result.effective) }
      : result;
  });
}
