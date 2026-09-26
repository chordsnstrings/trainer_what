import type { FastifyInstance, FastifyRequest } from "fastify";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  event,
  putRecord,
  type Actor,
  type Database,
  type Tx,
} from "@trainer/db";
import {
  canonicalCoaching,
  coachingActions,
  teachingCaseSchema,
} from "../../../packages/domain/src/coaching-completion.ts";
import { currentClientTwin } from "./client-twin.ts";
import { workspaceLock } from "./privacy-lifecycle.ts";
import {
  assertTrainingOpen,
  deliverReviewedCoachingDecision,
  lockTraining,
} from "./coaching-completion.ts";
import {
  coachingCorrectionContext,
  coachingFeedbackRegression,
  confirmCoachingTeaching,
} from "./coaching-runtime.ts";

const uuid = z.string().uuid();
const version = z.number().int().positive();
const digest = (value: unknown) =>
  createHash("sha256").update(canonicalCoaching(value)).digest("hex");
const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
function trainer(req: FastifyRequest, ownerOnly = false) {
  const a = req.identity;
  if (!a) throw fail(401, "AUTH_REQUIRED", "Please sign in");
  if (!(ownerOnly ? ["owner"] : ["owner", "staff"]).includes(a.role))
    throw fail(
      403,
      "TRAINER_REQUIRED",
      ownerOnly
        ? "The trainer owner must confirm teaching"
        : "Trainer access required",
    );
  return a;
}
async function record(tx: Tx, key: string, kind: string) {
  const [r] = await tx.query("SELECT * FROM records WHERE id=$1 AND kind=$2", [
    uuid.parse(key),
    kind,
  ]);
  if (!r) throw fail(404, "NOT_FOUND", "This coaching item is unavailable");
  return r;
}
async function lockClient(tx: Tx, a: Actor, userId: string) {
  await lockTraining(tx, a, userId);
  const [member] = await tx.query(
    "SELECT user_id FROM memberships WHERE tenant_id=$1 AND user_id=$2 AND role='subscriber'",
    [a.tenantId, userId],
  );
  if (!member)
    throw fail(
      404,
      "CLIENT_UNAVAILABLE",
      "This client is no longer in this workspace",
    );
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    a.tenantId + ":brain",
  ]);
}
async function consent(tx: Tx, userId: string) {
  const [c] = await tx.query(
    "SELECT id,granted FROM consent_records WHERE user_id=$1 AND document_type='coaching' ORDER BY created_at DESC,id DESC LIMIT 1",
    [userId],
  );
  if (!c?.granted)
    throw fail(
      409,
      "COACHING_CONSENT_REQUIRED",
      "The client's digital coaching permission is not active",
    );
  return c;
}
async function reviewContext(tx: Tx, a: Actor, original: any) {
  await assertTrainingOpen(tx, original.owner_user_id);
  const permission = await consent(tx, original.owner_user_id);
  const twin = await currentClientTwin(tx, a, original.owner_user_id);
  const current = await coachingCorrectionContext(
    tx,
    original.data.request ?? "",
    original.owner_user_id,
  );
  if (!current.brainId)
    throw fail(
      409,
      "BRAIN_NOT_READY",
      "Publish your coaching Brain before reviewing this decision",
    );
  const lineage = {
    clientSnapshotId: twin.id,
    clientSnapshotDigest: twin.data.digest,
    brainVersionId: current.brainId,
    runtimeReleaseId: current.runtimeReleaseId,
    contractDigest: current.contractDigest,
    factsDigest: current.factsDigest,
    consentId: permission.id,
  };
  return {
    ...current,
    lineage,
    contextToken: digest(lineage),
    snapshot: twin.data.coaching,
  };
}
const normalizedCopy = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const historyQuery = z
  .object({
    q: z.string().trim().max(200).default(""),
    learningValue: z
      .enum(["meaningful", "cosmetic", "decision", "meaning"])
      .optional(),
    category: z.enum(coachingActions).optional(),
    subscriberId: uuid.optional(),
    limit: z.coerce.number().int().min(1).max(50).default(30),
    before: z.string().min(1).max(600).optional(),
  })
  .strict();
const historyCursor = z
  .object({
    at: z.iso.datetime({ offset: true }),
    id: uuid,
    scope: z.string().length(64),
  })
  .strict();
// Keep these expressions identical to migration034's partial GIN indexes. They
// index only correction copy and linked notes, never client snapshots or tests.
const correctionSearch = `to_tsvector('simple',
  coalesce(c.data->>'request','') || ' ' ||
  coalesce(c.data->'preferred'->>'message','') || ' ' ||
  coalesce(c.data->'rejected'->>'message','') || ' ' ||
  coalesce(c.data->>'explanation',''))`;
const outcomeSearch = `to_tsvector('simple',coalesce(o.data->>'note',''))`;
const preciseHistoryTime = `to_char(c.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
async function historyAccess(tx: Tx, a: Actor) {
  await workspaceLock(tx, a.tenantId);
  await lockTraining(tx, a);
}
export function correctionLearningValue(
  original: any,
  preferred: { actionId: string | null; type: string; message: string },
) {
  const structural =
    (original.actionId ?? null) !== preferred.actionId ||
    original.type !== preferred.type ||
    !!original.program;
  return structural
    ? "decision"
    : normalizedCopy(original.message ?? "") !==
        normalizedCopy(preferred.message)
      ? "meaning"
      : "cosmetic";
}
function semanticDiff(original: any, preferred: any) {
  return ["type", "actionId", "message", "program"].flatMap((field) => {
    const before = original[field] ?? null,
      after = preferred[field] ?? null;
    return canonicalCoaching(before) === canonicalCoaching(after)
      ? []
      : [{ field, before, after }];
  });
}
async function feedbackDetail(tx: Tx, correction: any, includeChecks: boolean) {
  const draft = await record(
    tx,
    correction.data.teachingDraftId,
    "coaching_teaching_draft",
  );
  const outcomes = await tx.query(
    "SELECT * FROM records WHERE kind='coaching_feedback_outcome' AND data->>'correctionId'=$1 ORDER BY created_at,id",
    [correction.id],
  );
  return {
    correction,
    draft,
    outcomes,
    outcomeOptions: await tx.query(
      "SELECT id,kind,created_at,coalesce(data->>'title',data->>'exercise',left(data->>'text',100),'Follow-up record') AS title FROM records WHERE owner_user_id=$1 AND created_at>=$2 AND kind IN ('workout','progress_measurement','message','coaching_followup','nutrition_checkin') ORDER BY created_at DESC,id DESC LIMIT 100",
      [correction.owner_user_id, correction.created_at],
    ),
    regression: includeChecks
      ? await coachingFeedbackRegression(
          tx,
          draft.data.teachingId ?? null,
          draft.data.scenarioIds ?? [],
          correction.data.request ?? "",
        )
      : null,
  };
}

/** Existing personal erasure deletes all subscriber-owned cases. Remove their copies first. */
export async function eraseCoachingFeedbackDerivedData(tx: Tx, userId: string) {
  const cases = await tx.query(
    "SELECT id FROM records WHERE kind='coaching_teaching' AND owner_user_id=$1",
    [userId],
  );
  if (!cases.length) return;
  // Call before deleting owned records, under the existing per-user training lock.
  const [scope] = await tx.query(
    "SELECT current_setting('app.tenant_id',true) AS tenant_id",
  );
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    scope.tenant_id + ":brain",
  ]);
  await tx.query(
    `UPDATE records r SET status=CASE WHEN status='published' THEN 'privacy_archived' ELSE status END,
    version=version+1,updated_at=now(),data=jsonb_set(data,'{contract,examples}',
      coalesce((SELECT jsonb_agg(item) FROM jsonb_array_elements(coalesce(r.data->'contract'->'examples','[]'::jsonb)) item
        WHERE NOT (item->>'id'=ANY($1::text[]))),'[]'::jsonb))
    WHERE kind='coaching_runtime_release' AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(coalesce(r.data->'contract'->'examples','[]'::jsonb)) item WHERE item->>'id'=ANY($1::text[]))`,
    [cases.map((row) => row.id)],
  );
}
/** Revocation invalidates the teaching digest; regranting consent does not silently restore it. */
export async function revokeCoachingFeedbackLearning(tx: Tx, userId: string) {
  const [scope] = await tx.query(
    "SELECT current_setting('app.tenant_id',true) AS tenant_id",
  );
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    scope.tenant_id + ":brain",
  ]);
  await tx.query(
    "UPDATE records SET status='permission_revoked',version=version+1,data=jsonb_set(data,'{allowedUses}','[]'::jsonb),updated_at=now() WHERE kind='coaching_teaching' AND owner_user_id=$1 AND status='confirmed'",
    [userId],
  );
}

export function registerCoachingFeedback(app: FastifyInstance, db: Database) {
  app.get("/api/v1/exceptions/:id/correction", async (req) => {
    const a = trainer(req);
    return db.tenant(a, async (tx) => {
      const exception = await record(tx, (req.params as any).id, "exception");
      await lockClient(tx, a, exception.owner_user_id);
      const current = await record(tx, exception.id, "exception");
      if (!current.data.decisionId)
        throw fail(
          409,
          "NO_DECISION",
          "This exception needs a direct trainer review",
        );
      const original = await record(tx, current.data.decisionId, "decision");
      if (original.owner_user_id !== current.owner_user_id)
        throw fail(409, "REVIEW_STALE", "The decision and client do not match");
      const context = await reviewContext(tx, a, original);
      return { exception: current, original, context };
    });
  });
  app.post("/api/v1/exceptions/:id/corrections", async (req) => {
    const a = trainer(req),
      b = z
        .object({
          requestKey: uuid,
          exceptionVersion: version,
          decisionVersion: version,
          contextToken: z.string().length(64),
          actionId: uuid.nullable(),
          message: z.string().trim().min(3).max(4000),
          explanation: z.string().trim().max(4000).default(""),
          reviewed: z.literal(true),
        })
        .strict()
        .parse(req.body);
    return db.tenant(a, async (tx) => {
      const exception = await record(tx, (req.params as any).id, "exception");
      await lockClient(tx, a, exception.owner_user_id);
      const [previous] = await tx.query(
        "SELECT * FROM records WHERE kind='coaching_correction' AND data->>'exceptionId'=$1 AND data->>'requestKey'=$2",
        [exception.id, b.requestKey],
      );
      if (previous) {
        if (previous.data.requestDigest !== digest(b))
          throw fail(
            409,
            "REQUEST_CHANGED",
            "This correction request was already used with different content",
          );
        return feedbackDetail(tx, previous, a.role === "owner");
      }
      const current = await record(tx, exception.id, "exception");
      if (current.status !== "open" || current.version !== b.exceptionVersion)
        throw fail(
          409,
          "EXCEPTION_CHANGED",
          "This exception changed; refresh before reviewing it",
        );
      const original = await record(tx, current.data.decisionId, "decision");
      if (
        original.owner_user_id !== current.owner_user_id ||
        original.status !== "pending_review" ||
        original.version !== b.decisionVersion
      )
        throw fail(
          409,
          "DECISION_CHANGED",
          "This decision changed; refresh before reviewing it",
        );
      const context = await reviewContext(tx, a, original);
      if (context.contextToken !== b.contextToken)
        throw fail(
          409,
          "CONTEXT_CHANGED",
          "The client's context or coaching material changed; review the current context first",
        );
      const action = b.actionId
        ? context.actions.find((row) => row.id === b.actionId)
        : null;
      if (b.actionId && !action)
        throw fail(
          409,
          "ACTION_UNAVAILABLE",
          "This action is not qualified for the current client and request",
        );
      const preferred = {
        type: action?.data.type ?? "message",
        actionId: action?.id ?? null,
        message: b.message,
      };
      const diff = semanticDiff(original.data, preferred),
        learningValue = correctionLearningValue(original.data, preferred);
      if (!diff.length)
        throw fail(
          400,
          "NO_CORRECTION",
          "Approve the original decision when no correction is needed",
        );
      if (learningValue !== "cosmetic" && b.explanation.length < 10)
        throw fail(
          400,
          "EXPLANATION_REQUIRED",
          "Explain the changed decision or meaning so this correction can teach your judgment",
        );
      const correctionId = randomUUID(),
        draftId = randomUUID();
      const replacement = await putRecord(
        tx,
        a,
        "decision",
        {
          ...preferred,
          ...context.lineage,
          request: original.data.request ?? "",
          correctionId,
          supersedesDecisionId: original.id,
          coachMessage: b.message,
          reason: b.explanation || "Wording or punctuation correction",
          requiresHumanReview: true,
          actionVersion: action?.version ?? null,
        },
        { ownerId: current.owner_user_id, status: "pending_review" },
      );
      const delivery = await deliverReviewedCoachingDecision(
        tx,
        a,
        replacement,
      );
      const correction = await putRecord(
        tx,
        a,
        "coaching_correction",
        {
          exceptionId: current.id,
          originalDecisionId: original.id,
          originalDecisionVersion: original.version,
          replacementDecisionId: replacement.id,
          teachingDraftId: draftId,
          requestKey: b.requestKey,
          requestDigest: digest(b),
          request: original.data.request ?? "",
          rejected: original.data,
          preferred: {
            ...preferred,
            action: action
              ? { id: action.id, version: action.version, data: action.data }
              : null,
          },
          semanticDiff: diff,
          explanation: b.explanation || null,
          category: preferred.type,
          learningValue,
          confidenceBeforeCorrection:
            typeof original.data.confidence === "number"
              ? original.data.confidence
              : null,
          originalContext: {
            clientSnapshotId: original.data.clientSnapshotId ?? null,
            brainVersionId: original.data.brainVersionId ?? null,
            runtimeReleaseId: original.data.runtimeReleaseId ?? null,
            factsDigest: original.data.factsDigest ?? null,
          },
          contextSnapshot: {
            ...context.lineage,
            coaching: context.snapshot,
            facts: context.facts,
          },
          delivery,
          reviewedBy: a.userId,
          allowedUses: ["render"],
        },
        {
          id: correctionId,
          ownerId: current.owner_user_id,
          status: "delivered",
        },
      );
      await putRecord(
        tx,
        a,
        "coaching_teaching_draft",
        {
          correctionId,
          scenario: original.data.request ?? "",
          category: preferred.type,
          recommendation: b.message,
          reason: b.explanation,
          alternatives: original.data.message ?? "",
          changeWhen: "",
          escalateWhen: "",
          scenarioIds: [],
          allowedUses: ["render"],
        },
        { id: draftId, ownerId: current.owner_user_id, status: "draft" },
      );
      await tx.query(
        "UPDATE records SET status='resolved',version=version+1,data=data||$2::jsonb,updated_at=now() WHERE id=$1",
        [
          current.id,
          JSON.stringify({
            correctionId,
            replacementDecisionId: replacement.id,
            resolvedBy: a.userId,
            resolution: b.explanation || "Wording corrected",
          }),
        ],
      );
      await event(tx, a, "coaching.correction_delivered", correctionId, {
        exceptionId: current.id,
        originalDecisionId: original.id,
        replacementDecisionId: replacement.id,
        learningValue,
      });
      return feedbackDetail(tx, correction, a.role === "owner");
    });
  });
  app.get("/api/v1/coaching/feedback", async (req) => {
    const a = trainer(req),
      b = historyQuery.parse(req.query),
      scope = digest({
        tenantId: a.tenantId,
        userId: a.userId,
        q: b.q,
        learningValue: b.learningValue ?? null,
        category: b.category ?? null,
        subscriberId: b.subscriberId ?? null,
      });
    return db.tenant(a, async (tx) => {
      await historyAccess(tx, a);
      // A bounded query must also finish promptly on a large workspace. Search
      // remains a trainer read; it neither creates teaching nor calls a model.
      await tx.query("SET LOCAL statement_timeout='3s'");
      let cursor: z.infer<typeof historyCursor> | undefined;
      if (b.before) {
        if (uuid.safeParse(b.before).success) {
          // Accept old clients' UUID cursors, but issue deletion-safe cursors.
          const [old] = await tx.query(
            `SELECT c.id,${preciseHistoryTime} AS at FROM records c
             WHERE c.id=$1 AND c.kind='coaching_correction'`,
            [b.before],
          );
          if (!old)
            throw fail(
              400,
              "INVALID_CURSOR",
              "Refresh the correction history before continuing",
            );
          cursor = { at: old.at, id: old.id, scope };
        } else {
          try {
            cursor = historyCursor.parse(
              JSON.parse(Buffer.from(b.before, "base64url").toString("utf8")),
            );
            if (cursor.scope !== scope) throw new Error("Changed filters");
          } catch {
            throw fail(
              400,
              "INVALID_CURSOR",
              "Refresh the correction history after changing filters",
            );
          }
        }
      }
      const rows = await tx.query(
        `WITH ${
          b.q
            ? `matches AS (
          SELECT c.id::text AS correction_id,c.owner_user_id FROM records c
          WHERE c.tenant_id=$1 AND c.kind='coaching_correction'
          AND ${correctionSearch} @@ plainto_tsquery('simple',$7)
          UNION
          SELECT o.data->>'correctionId',o.owner_user_id FROM records o
          WHERE o.tenant_id=$1 AND o.kind='coaching_feedback_outcome'
          AND ${outcomeSearch} @@ plainto_tsquery('simple',$7)
        ),`
            : ""
        } page AS (
          SELECT c.*,${preciseHistoryTime} AS cursor_at
          FROM records c
          WHERE c.tenant_id=$1 AND c.kind='coaching_correction'
          AND ($2::uuid IS NULL OR c.owner_user_id=$2)
          AND ($3::text IS NULL OR c.data->>'category'=$3)
          AND ($4::text IS NULL OR c.data->>'learningValue'=$4
            OR ($4='meaningful' AND c.data->>'learningValue' IN ('decision','meaning')))
          AND ($5::timestamptz IS NULL OR (c.created_at,c.id)<($5,$6::uuid))
          ${
            b.q
              ? `AND (c.id::text,c.owner_user_id) IN (SELECT correction_id,owner_user_id FROM matches)`
              : ""
          }
          ORDER BY c.created_at DESC,c.id DESC LIMIT $8
        )
        SELECT page.*,u.name AS "clientName",
          (SELECT count(*)::integer FROM records o
            WHERE o.tenant_id=page.tenant_id AND o.kind='coaching_feedback_outcome'
            AND o.owner_user_id=page.owner_user_id AND o.data->>'correctionId'=page.id::text) AS "outcomeCount",
          (SELECT left(o.data->>'note',240) FROM records o
            WHERE o.tenant_id=page.tenant_id AND o.kind='coaching_feedback_outcome'
            AND o.owner_user_id=page.owner_user_id AND o.data->>'correctionId'=page.id::text
            AND $7::text<>'' AND ${outcomeSearch} @@ plainto_tsquery('simple',$7)
            ORDER BY o.created_at DESC,o.id DESC LIMIT 1) AS "matchedOutcome"
        FROM page LEFT JOIN users u ON u.id=page.owner_user_id
        ORDER BY page.created_at DESC,page.id DESC`,
        [
          a.tenantId,
          b.subscriberId ?? null,
          b.category ?? null,
          b.learningValue ?? null,
          cursor?.at ?? null,
          cursor?.id ?? null,
          b.q,
          b.limit + 1,
        ],
      );
      const items = rows.slice(0, b.limit),
        last = items.at(-1);
      return {
        items: items.map(({ cursor_at, ...item }) => item),
        next:
          rows.length > b.limit && last
            ? Buffer.from(
                JSON.stringify({ at: last.cursor_at, id: last.id, scope }),
              ).toString("base64url")
            : null,
      };
    });
  });
  app.get("/api/v1/coaching/feedback/:id", async (req) => {
    const a = trainer(req);
    return db.tenant(a, async (tx) => {
      await historyAccess(tx, a);
      return feedbackDetail(
        tx,
        await record(tx, (req.params as any).id, "coaching_correction"),
        a.role === "owner",
      );
    });
  });
  app.post("/api/v1/coaching/feedback/:id/teaching-draft", async (req) => {
    const a = trainer(req),
      b = z
        .object({ version, teaching: teachingCaseSchema })
        .strict()
        .parse(req.body);
    return db.tenant(a, async (tx) => {
      const c = await record(tx, (req.params as any).id, "coaching_correction");
      await lockClient(tx, a, c.owner_user_id);
      const draft = await record(
        tx,
        c.data.teachingDraftId,
        "coaching_teaching_draft",
      );
      if (draft.status !== "draft" || draft.version !== b.version)
        throw fail(
          409,
          "DRAFT_CHANGED",
          "This teaching draft changed; refresh before saving",
        );
      const [saved] = await tx.query(
        "UPDATE records SET data=data||$2::jsonb,version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
        [draft.id, JSON.stringify({ ...b.teaching, editedBy: a.userId })],
      );
      await event(tx, a, "coaching.teaching_draft_saved", draft.id);
      return saved;
    });
  });
  app.post("/api/v1/coaching/feedback/:id/confirm-teaching", async (req) => {
    const a = trainer(req, true),
      b = z
        .object({
          version,
          reviewed: z.literal(true),
          clientDetailsRemoved: z.literal(true),
        })
        .strict()
        .parse(req.body);
    return db.tenant(a, async (tx) => {
      const c = await record(tx, (req.params as any).id, "coaching_correction");
      await lockClient(tx, a, c.owner_user_id);
      await consent(tx, c.owner_user_id);
      const draft = await record(
        tx,
        c.data.teachingDraftId,
        "coaching_teaching_draft",
      );
      if (draft.status !== "draft" || draft.version !== b.version)
        throw fail(
          409,
          "DRAFT_CHANGED",
          "This teaching draft changed; review the current version",
        );
      const body = Object.fromEntries(
        Object.keys(teachingCaseSchema.shape).map((key) => [
          key,
          draft.data[key],
        ]),
      );
      const teaching = await confirmCoachingTeaching(
        tx,
        a,
        body,
        c.owner_user_id,
      );
      await tx.query(
        "UPDATE records SET status='confirmed',version=version+1,data=data||$2::jsonb,updated_at=now() WHERE id=$1",
        [
          draft.id,
          JSON.stringify({
            teachingId: teaching.id,
            confirmedBy: a.userId,
            clientDetailsRemoved: true,
          }),
        ],
      );
      await event(tx, a, "coaching.correction_taught", c.id, {
        teachingId: teaching.id,
        draftId: draft.id,
      });
      return feedbackDetail(tx, c, true);
    });
  });
  app.post("/api/v1/coaching/feedback/:id/regression", async (req) => {
    const a = trainer(req, true),
      b = z
        .object({
          version,
          scenarioIds: z
            .array(uuid)
            .min(1)
            .max(20)
            .refine((ids) => new Set(ids).size === ids.length),
          independent: z.literal(true),
        })
        .strict()
        .parse(req.body);
    return db.tenant(a, async (tx) => {
      const c = await record(tx, (req.params as any).id, "coaching_correction");
      await lockClient(tx, a, c.owner_user_id);
      const draft = await record(
        tx,
        c.data.teachingDraftId,
        "coaching_teaching_draft",
      );
      if (draft.status !== "confirmed" || draft.version !== b.version)
        throw fail(
          409,
          "DRAFT_CHANGED",
          "Confirm the current teaching draft before linking independent checks",
        );
      const state = await coachingFeedbackRegression(
        tx,
        draft.data.teachingId,
        b.scenarioIds,
        c.data.request ?? "",
      );
      if (
        !state.teachingId ||
        b.scenarioIds.some((key) => !state.scenarios.some((s) => s.id === key))
      )
        throw fail(
          409,
          "INDEPENDENT_CHECK_REQUIRED",
          "Choose active independent checks; the corrected example itself cannot be a held-out test",
        );
      await tx.query(
        "UPDATE records SET version=version+1,data=data||$2::jsonb,updated_at=now() WHERE id=$1",
        [
          draft.id,
          JSON.stringify({
            scenarioIds: b.scenarioIds,
            checksLinkedBy: a.userId,
          }),
        ],
      );
      await event(tx, a, "coaching.correction_checks_linked", c.id, {
        scenarioIds: b.scenarioIds,
      });
      return feedbackDetail(tx, c, true);
    });
  });
  app.post("/api/v1/coaching/feedback/:id/outcomes", async (req) => {
    const a = trainer(req),
      b = z
        .object({
          recordIds: z
            .array(uuid)
            .min(1)
            .max(20)
            .refine((ids) => new Set(ids).size === ids.length),
          note: z.string().trim().max(2000).default(""),
        })
        .strict()
        .parse(req.body);
    return db.tenant(a, async (tx) => {
      const c = await record(tx, (req.params as any).id, "coaching_correction");
      await lockClient(tx, a, c.owner_user_id);
      const refs = await tx.query(
        "SELECT id,kind,version,created_at FROM records WHERE id=ANY($1::uuid[]) AND owner_user_id=$2 AND created_at>=$3 AND kind IN ('workout','progress_measurement','message','coaching_followup','nutrition_checkin')",
        [b.recordIds, c.owner_user_id, c.created_at],
      );
      if (refs.length !== b.recordIds.length)
        throw fail(
          400,
          "OUTCOME_UNAVAILABLE",
          "Choose follow-up evidence belonging to this client",
        );
      const outcome = await putRecord(
        tx,
        a,
        "coaching_feedback_outcome",
        {
          correctionId: c.id,
          references: refs,
          note: b.note,
          recordedBy: a.userId,
          allowedUses: ["render"],
        },
        { ownerId: c.owner_user_id, status: "recorded" },
      );
      await event(tx, a, "coaching.correction_outcome_recorded", c.id, {
        outcomeId: outcome.id,
      });
      return outcome;
    });
  });
}
