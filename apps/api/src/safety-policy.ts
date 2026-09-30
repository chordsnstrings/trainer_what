import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  elevated,
  event,
  putPrivateRecord,
  putRecord,
  type Actor,
  type Database,
  type Tx,
} from "@trainer/db";
import {
  EFFECTIVE_DUE_SQL,
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
    Partial<
      Pick<
        SafetyDecision,
        "floor" | "floorCategories" | "policyTerms" | "reviewCategories"
      >
    >,
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
      floorCategories: decision.floorCategories ?? [],
      policyTerms: decision.policyTerms ?? [],
      reviewCategories: decision.reviewCategories ?? [],
    },
  };
}
/** Most recent follow-up questions kept on one open personal review. */
export const PERSONAL_REVIEW_FOLLOW_UPS = 10;
/**
 * A question the policy routes to the trainer joins the member's open
 * personal review, so repeated questions never create a stream of exceptions
 * or trainer alerts. The first open question keeps the deadline: the oldest
 * unanswered question governs escalation. Call under the member's training
 * lock (lockTraining), which serialises this read-then-write.
 */
export async function openPersonalReview(
  tx: Tx,
  a: Actor,
  userId: string,
  message: string,
  screen: SafetyDecision,
) {
  // Runs in the asking follower's own scope, which cannot read its review
  // items: the open review (if any) takes the follow-up in the database.
  if (userId !== a.userId)
    throw new Error("A personal review is opened by the asking member");
  const [open] = await tx.query<{ id: string | null }>(
    "SELECT member_policy_review_append($1::jsonb,$2::jsonb,$3) AS id",
    [
      JSON.stringify({
        text: message,
        askedAt: new Date().toISOString(),
        categories: screen.reviewCategories,
        policyVersion: screen.policy.pin.version,
      }),
      JSON.stringify(screen.reviewCategories),
      PERSONAL_REVIEW_FOLLOW_UPS,
    ],
  );
  if (open?.id) {
    await event(tx, a, "coaching.policy_review_required", open.id, {
      categories: screen.reviewCategories,
      policyVersion: screen.policy.pin.version,
      repeat: true,
    });
    return { id: open.id, created: false };
  }
  const review = await putPrivateRecord(
    tx,
    a,
    "exception",
    {
      category: "policy_review",
      description: message,
      subscriberId: userId,
      questionCount: 1,
      ...safetyDecisionData(screen, "personal_review"),
    },
    { status: "open", ownerId: userId },
  );
  await event(tx, a, "coaching.policy_review_required", review.id, {
    categories: screen.reviewCategories,
    policyVersion: screen.policy.pin.version,
  });
  // One alert per open review: follow-up questions join it silently.
  await notifyCoachingTeam(tx, a, {
    category: "coaching",
    dedupeKey: `policy-review:${review.id}`,
    title: "A client question needs your personal review",
    body: "The platform safety policy routed a coaching question to you instead of an automatic response. Open your exceptions to reply personally.",
    href: "/trainer/exceptions",
    templateKey: "policy-review",
  });
  return { id: review.id as string, created: true };
}
/**
 * Effective deadlines for open reviews, exactly as the escalation pass
 * applies them, so the trainer never sees a later deadline than the one
 * that escalates.
 */
export async function effectiveReviewDeadlines(tx: Tx) {
  const policy = await activeSafetyPolicy(tx);
  const rows = await tx.query(
    `SELECT id,${EFFECTIVE_DUE_SQL} AS due_at FROM records WHERE kind='exception' AND status='open' AND data->>'category' IN ('safety','policy_review') ORDER BY created_at DESC,id LIMIT 500`,
    [policy.holdReviewHours, policy.personalReviewHours],
  );
  return {
    policy: {
      version: policy.pin.version,
      holdReviewHours: policy.holdReviewHours,
      personalReviewHours: policy.personalReviewHours,
    },
    deadlines: Object.fromEntries(
      rows.map((r) => [String(r.id), new Date(r.due_at).toISOString()]),
    ),
  };
}
/**
 * Worker pass: an open safety hold or policy personal review past its
 * deadline is marked overdue once, logged and re-sent to the coaching team.
 * Deadlines only shorten: a later, stricter policy applies to open items.
 * Only due rows are fetched, safety holds first, so any number of open
 * not-yet-due reviews can never hide an overdue hold.
 */
export async function scheduleSafetyEscalations(
  db: Database,
  tenantId: string,
  now = new Date(),
) {
  const a: Actor = elevated("worker", {
    tenantId,
    role: "owner",
  });
  return db.tenant(a, async (tx) => {
    const policy = await activeSafetyPolicy(tx);
    const rows = await tx.query(
      `SELECT id,owner_user_id,created_at,data,due_at FROM (SELECT id,owner_user_id,created_at,data,${EFFECTIVE_DUE_SQL} AS due_at FROM records WHERE kind='exception' AND status='open' AND data->>'category' IN ('safety','policy_review') AND NOT (data ? 'overdueAt')) open_reviews WHERE due_at<=$3::timestamptz ORDER BY (data->>'category'='safety') DESC,due_at,id LIMIT 50`,
      [policy.holdReviewHours, policy.personalReviewHours, now.toISOString()],
    );
    let escalated = 0;
    for (const r of rows) {
      const escalation = {
        at: now.toISOString(),
        dueAt: new Date(r.due_at).toISOString(),
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
  // The deadline shown on each open review is the one that escalates it.
  app.get("/api/v1/safety/review-deadlines", async (req, reply) => {
    const a = identity(req);
    if (!["owner", "staff"].includes(a.role))
      throw fail(403, "TRAINER_REQUIRED", "Trainer access required");
    reply.header("Cache-Control", "no-store");
    return db.tenant(a, effectiveReviewDeadlines);
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
