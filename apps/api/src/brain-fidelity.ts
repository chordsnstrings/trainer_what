/** Trainer-only human comparison. Never qualifies or delivers subscriber coaching. */
import { createHash, randomInt } from "node:crypto";
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
  modelDecision,
  coachDecisionPromptVersion,
  ModelOutputInvalid,
} from "@trainer/providers";
import { runtimeConfig } from "../../../packages/providers/src/configuration.ts";
import {
  modelCallBudget,
  modelRequestPin,
} from "../../../packages/providers/src/model-request.ts";
import { modelProviderName } from "../../../packages/providers/src/model-accounting.ts";
import { conversationContextPolicy } from "../../../packages/domain/src/conversation-context.ts";
import { trainerBrainContext } from "../../../packages/domain/src/trainer-brain.ts";
import {
  evaluationAnswerIssues,
  planBoundsSchema,
} from "../../../packages/domain/src/brain-plans.ts";
import {
  FIDELITY_VERSION,
  fidelityCaseSchema,
  fidelityRatingSchema,
  fidelityCorrectionSchema,
  fidelitySituation,
  fidelityOverlap,
  type FidelityCase,
} from "../../../packages/domain/src/brain-fidelity.ts";
import { candidateCommunication } from "./trainer-brain.ts";
import { activeSafetyPolicy } from "./safety-policy.ts";
import { screenSafety } from "../../../packages/domain/src/safety-policy.ts";
import { privacyMatches } from "./ingestion.ts";
import { modelAccounting } from "./model-accounting.ts";

const uuid = z.string().uuid();
const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
// JSONB reorders object keys; retries must compare content, not insertion order.
const canonical = (value: any): any =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
const digest = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
const lock = (tx: Tx, a: Actor) =>
  tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    `brain:fidelity:${a.tenantId}`,
  ]);
async function find(tx: Tx, id: string, kind: string) {
  const [r] = await tx.query("SELECT * FROM records WHERE id=$1 AND kind=$2", [
    id,
    kind,
  ]);
  if (!r) throw fail(404, "NOT_FOUND", "This review is unavailable.");
  return r;
}
function checkPrivacy(value: unknown) {
  if (privacyMatches(JSON.stringify(value)).length)
    throw fail(
      400,
      "PRIVATE_DETAILS",
      "Use a fictional situation without contact or account details.",
    );
}
/** None of these private case/run kinds is in bootstrap, material or compilation allowlists. */
async function comparisonMaterial(tx: Tx) {
  const [scope] = await tx.query(
    "SELECT count(*)::int AS n,coalesce(sum(octet_length(data::text)),0) AS bytes FROM records WHERE kind IN ('interview','source','coaching_teaching','scenario','coaching_scenario','brain_quiz_round') AND status NOT IN ('archived','discarded')",
  );
  if (scope.n > 2000 || Number(scope.bytes) > 4_000_000)
    throw fail(
      409,
      "REVIEW_SCOPE",
      "This workspace needs a narrower review of its teaching material before adding fidelity cases.",
    );
  const rows = await tx.query(
    "SELECT kind,data FROM records WHERE kind IN ('interview','source','coaching_teaching','scenario','coaching_scenario','brain_quiz_round') AND status NOT IN ('archived','discarded') ORDER BY id LIMIT 2001",
  );
  if (rows.length > 2000)
    throw fail(
      409,
      "REVIEW_SCOPE",
      "This workspace needs a narrower review of its teaching material before adding fidelity cases.",
    );
  const communication = await candidateCommunication(tx);
  const text: string[] = (communication.oneOnOne?.answers.examples ?? []).map(
    (e) => e.situation,
  );
  const [published] = await tx.query(
    "SELECT data->'communication'->'oneOnOne'->'answers'->'examples' AS examples FROM records WHERE kind='brain_release' AND status='published' ORDER BY created_at DESC,id DESC LIMIT 1",
  );
  text.push(
    ...(published?.examples ?? []).map((e: any) => String(e.situation ?? "")),
  );
  for (const r of rows) {
    if (r.kind === "brain_quiz_round")
      text.push(
        ...(r.data.cases ?? []).map((c: any) => String(c.message ?? "")),
      );
    else
      for (const key of ["prompt", "scenario", "question", "answer", "text"])
        if (typeof r.data[key] === "string") text.push(r.data[key]);
  }
  return text;
}
function overlaps(c: FidelityCase, material: string[]) {
  return material.some(
    (t) =>
      fidelityOverlap(c.request, t) || fidelityOverlap(fidelitySituation(c), t),
  );
}
async function currentContext(tx: Tx) {
  const [release] = await tx.query(
    "SELECT * FROM records WHERE kind='brain_release' AND status='published' ORDER BY created_at DESC,id DESC LIMIT 1",
  );
  const config = runtimeConfig(),
    brain = trainerBrainContext(release),
    policy = await activeSafetyPolicy(tx);
  const pin = {
    version: FIDELITY_VERSION,
    channel: "supervised_chat",
    releaseId: release?.id ?? null,
    brainDigest: digest(brain),
    trainerBrainVersion: brain.version,
    conversationVersion: conversationContextPolicy.version,
    promptVersion: coachDecisionPromptVersion,
    provider: modelProviderName(config),
    model: config.MODEL_NAME ?? null,
    request: modelRequestPin(config) ?? null,
    budget: modelCallBudget("coach_decision", config),
    safetyPolicy: policy.pin,
  };
  // The endpoint participates in freshness, but is not included in a user-facing receipt.
  return {
    release,
    brain,
    policy,
    pin,
    key: digest({ pin, endpoint: config.MODEL_BASE_URL }),
  };
}
const caseView = (c: any, contaminated: boolean) => ({
  id: c.id,
  title: c.data.title,
  status: c.status,
  turns: c.data.turns,
  request: c.data.request,
  createdAt: c.created_at,
  eligible: c.status === "held_out" && !contaminated,
});
function runView(r: any) {
  const revealed = r.status === "graded";
  const order: string[] = r.data.order ?? [];
  return {
    id: r.id,
    caseId: r.data.caseId,
    status: r.status,
    createdAt: r.created_at,
    interrupted:
      r.status === "generating" &&
      Date.now() - new Date(r.created_at).getTime() >
        r.data.pin.budget.timeoutMs + 120000,
    candidates: ["ready", "graded"].includes(r.status)
      ? order.map((source, i) => ({
          label: i ? "B" : "A",
          reply: r.data.candidates[source].reply,
          ...(revealed ? { source, ...r.data.candidates[source] } : {}),
        }))
      : [],
    ...(revealed
      ? {
          rating: r.data.rating,
          receipt: r.data.pin,
          usage: r.data.usage,
          gradedAt: r.data.gradedAt,
          teachingId: r.data.teachingId ?? null,
        }
      : {}),
    ...(r.status === "failed" ? { failure: r.data.failure } : {}),
  };
}

export function registerBrainFidelity(
  app: FastifyInstance,
  db: Database,
  identity: (req: FastifyRequest) => Actor,
) {
  const owner = (req: FastifyRequest) => {
    const a = identity(req);
    if (a.role !== "owner")
      throw fail(
        403,
        "OWNER_REQUIRED",
        "Only the trainer can review their Brain's replies.",
      );
    return a;
  };
  app.get("/api/v1/brain/fidelity", async (req) => {
    const a = owner(req);
    return db.tenant(a, async (tx) => {
      const context = await currentContext(tx),
        material = await comparisonMaterial(tx);
      const cases = await tx.query(
        "SELECT * FROM records WHERE kind='brain_fidelity_case' ORDER BY created_at DESC,id DESC LIMIT 100",
      );
      const runs = await tx.query(
        "SELECT * FROM records WHERE kind='brain_fidelity_run' ORDER BY created_at DESC,id DESC LIMIT 500",
      );
      const views = cases.map((c) => caseView(c, overlaps(c.data, material)));
      const eligible = new Set(
        views.filter((c) => c.eligible).map((c) => c.id),
      );
      const attempts = runs.filter(
        (r) => r.data.key === context.key && eligible.has(r.data.caseId),
      );
      const current = attempts.filter((r) => r.status === "graded");
      const scores = current.map(
        (r) => r.data.rating.scores[r.data.order.indexOf("brain")],
      );
      const mean = (key: string) =>
        scores.length
          ? Math.round(
              (scores.reduce((n, s) => n + s[key], 0) / scores.length) * 10,
            ) / 10
          : null;
      return {
        ready: !!context.release,
        cases: views,
        runs: runs.map(runView),
        summary: {
          count: scores.length,
          attempts: attempts.length,
          failed: attempts.filter((r) => r.status === "failed").length,
          pending: attempts.filter((r) => r.status === "generating").length,
          awaitingRatings: attempts.filter((r) => r.status === "ready").length,
          decision: mean("decision"),
          wording: mean("wording"),
          context: mean("context"),
        },
      };
    });
  });
  app.post("/api/v1/brain/fidelity/cases", async (req) => {
    const a = owner(req),
      b = fidelityCaseSchema.parse(req.body);
    checkPrivacy(b);
    return db.tenant(a, async (tx) => {
      await lock(tx, a);
      const rows = await tx.query(
        "SELECT * FROM records WHERE kind='brain_fidelity_case' ORDER BY id LIMIT 101",
      );
      // Saving after a lost response returns the same immutable case.
      const existing = rows.find((r) => digest(r.data) === digest(b));
      if (existing)
        return caseView(existing, overlaps(b, await comparisonMaterial(tx)));
      if (rows.length >= 100)
        throw fail(
          409,
          "CASE_LIMIT",
          "This review workspace holds at most 100 situations.",
        );
      if (
        overlaps(b, await comparisonMaterial(tx)) ||
        rows.some((r) =>
          fidelityOverlap(fidelitySituation(b), fidelitySituation(r.data)),
        )
      )
        throw fail(
          409,
          "CASE_OVERLAP",
          "Choose an unfamiliar situation, separate from your teaching, practice questions and saved reviews.",
        );
      const c = await putRecord(tx, a, "brain_fidelity_case", b, {
        status: "held_out",
      });
      await event(tx, a, "brain.fidelity_case_saved", c.id);
      return caseView(c, false);
    });
  });
  app.post("/api/v1/brain/fidelity/cases/:id/runs", async (req) => {
    const a = owner(req),
      caseId = uuid.parse((req.params as any).id);
    const prepared = await db.tenant(a, async (tx) => {
      await lock(tx, a);
      const c = await find(tx, caseId, "brain_fidelity_case"),
        context = await currentContext(tx);
      if (!context.release)
        throw fail(
          409,
          "BRAIN_NOT_READY",
          "Publish your checked Brain before comparing its replies.",
        );
      const [prior] = await tx.query(
        "SELECT * FROM records WHERE kind='brain_fidelity_run' AND data->>'caseId'=$1 AND data->>'key'=$2 ORDER BY created_at DESC,id DESC LIMIT 1",
        [caseId, context.key],
      );
      if (prior) return { existing: prior };
      if (
        c.status !== "held_out" ||
        overlaps(c.data, await comparisonMaterial(tx))
      )
        throw fail(
          409,
          "CASE_OVERLAP",
          "This situation is now teaching or practice material. Save a new unfamiliar one.",
        );
      const config = runtimeConfig();
      if (!config.MODEL_BASE_URL || !config.MODEL_API_KEY || !config.MODEL_NAME)
        throw fail(
          503,
          "MODEL_UNAVAILABLE",
          "Connect the coaching model before generating a comparison.",
        );
      const [count] = await tx.query(
        "SELECT count(*)::int AS n FROM records WHERE kind='brain_fidelity_run'",
      );
      if (count.n >= 500)
        throw fail(
          409,
          "REVIEW_LIMIT",
          "This review workspace holds at most 500 attempts.",
        );
      const r = await putRecord(
        tx,
        a,
        "brain_fidelity_run",
        {
          caseId,
          pin: context.pin,
          key: context.key,
          order: randomInt(2) ? ["brain", "trainer"] : ["trainer", "brain"],
        },
        { status: "generating" },
      );
      await event(tx, a, "brain.fidelity_started", r.id, {
        caseId,
        releaseId: context.release.id,
      });
      return { c, r, context };
    });
    if (prepared.existing) return runView(prepared.existing);
    const { c, r, context } = prepared;
    try {
      const example = c!.data as FidelityCase;
      const rules = context!.release.data.rules.filter((rule: any) =>
        rule.data.allowedUses?.includes("model_prompt"),
      );
      const generated = await modelDecision(
        "coaching",
        example.request,
        rules,
        modelAccounting(db, a, "evaluation"),
        {
          trainerBrain: context!.brain,
          conversation: {
            version: conversationContextPolicy.version,
            turns: example.turns.map((t, i) => ({
              ...t,
              sentAt: new Date(
                new Date(c!.created_at).getTime() -
                  (example.turns.length - i) * 60000,
              ).toISOString(),
            })),
          },
        },
      );
      const decision = generated.decision;
      const issues = evaluationAnswerIssues(decision, {
        library: new Map(),
        bounds: planBoundsSchema.parse({}),
        programExpected: false,
        citedText: rules
          .filter((rule: any) => decision.evidenceIds.includes(rule.id))
          .map((rule: any) =>
            [rule.data.title, rule.data.condition, rule.data.directive].join(
              ". ",
            ),
          )
          .join(" "),
        requestText: fidelitySituation(example),
      });
      const safety = screenSafety(fidelitySituation(example), context!.policy);
      if ((safety.hold || safety.review) && decision.type !== "escalation")
        issues.push("handover_required");
      if (issues.length) throw new ModelOutputInvalid();
      return await db.tenant(a, async (tx) => {
        const candidates = {
          trainer: {
            reply: example.referenceReply,
            reason: example.referenceReason,
            handover: example.expectHandover,
          },
          brain: {
            reply: decision.message,
            reason: decision.reason,
            handover: decision.type === "escalation",
            evidenceIds: decision.evidenceIds,
          },
        };
        const [saved] = await tx.query(
          "UPDATE records SET status='ready',version=version+1,updated_at=now(),data=data||$2::jsonb WHERE id=$1 AND status='generating' RETURNING *",
          [
            r!.id,
            JSON.stringify({
              candidates,
              usage: {
                inputTokens: generated.usage.input,
                outputTokens: generated.usage.output,
                costUsd: generated.usage.cost,
              },
            }),
          ],
        );
        await event(tx, a, "brain.fidelity_ready", r!.id);
        return runView(saved);
      });
    } catch (error) {
      // No automatic retry, including after a lost/unknown provider outcome.
      return db.tenant(a, async (tx) => {
        const [saved] = await tx.query(
          "UPDATE records SET status='failed',version=version+1,updated_at=now(),data=data||$2::jsonb WHERE id=$1 AND status='generating' RETURNING *",
          [
            r!.id,
            JSON.stringify({
              failure:
                error instanceof ModelOutputInvalid
                  ? "The answer failed the coaching checks and was withheld. This attempt will not be sent again."
                  : "The comparison could not finish. Any provider usage remains recorded; this attempt will not be sent again.",
            }),
          ],
        );
        await event(tx, a, "brain.fidelity_failed", r!.id);
        return runView(saved);
      });
    }
  });
  app.post("/api/v1/brain/fidelity/runs/:id/ratings", async (req) => {
    const a = owner(req),
      runId = uuid.parse((req.params as any).id),
      b = fidelityRatingSchema.parse(req.body);
    checkPrivacy(b.note);
    b.scores.sort((x, y) => x.label.localeCompare(y.label));
    return db.tenant(a, async (tx) => {
      await lock(tx, a);
      const r = await find(tx, runId, "brain_fidelity_run");
      if (r.status === "graded" && digest(r.data.rating) === digest(b))
        return runView(r);
      if (r.status !== "ready")
        throw fail(
          409,
          "REVIEW_STATE",
          "Ratings can be saved once, before the sources are revealed.",
        );
      const [saved] = await tx.query(
        "UPDATE records SET status='graded',version=version+1,updated_at=now(),data=data||$2::jsonb WHERE id=$1 RETURNING *",
        [
          r.id,
          JSON.stringify({
            rating: b,
            gradedAt: new Date().toISOString(),
            gradedBy: a.userId,
          }),
        ],
      );
      await event(tx, a, "brain.fidelity_graded", r.id);
      return runView(saved);
    });
  });
  app.post("/api/v1/brain/fidelity/runs/:id/teach", async (req) => {
    const a = owner(req),
      runId = uuid.parse((req.params as any).id),
      b = fidelityCorrectionSchema.parse(req.body);
    checkPrivacy(b);
    return db.tenant(a, async (tx) => {
      await lock(tx, a);
      const r = await find(tx, runId, "brain_fidelity_run"),
        c = await find(tx, r.data.caseId, "brain_fidelity_case");
      if (r.data.teachingId) {
        if (r.data.correctionDigest !== digest(b))
          throw fail(
            409,
            "ALREADY_TAUGHT",
            "This correction has already been saved. Review it in Brain teaching.",
          );
        return runView(r);
      }
      if (r.status !== "graded" || c.status !== "held_out")
        throw fail(
          409,
          "REVIEW_STATE",
          "Finish rating both replies before using this situation for teaching.",
        );
      const teaching = await putRecord(
        tx,
        a,
        "interview",
        {
          question: `Fictional conversation review: ${c.data.title}\n${fidelitySituation(c.data)}`,
          answer: `My reply: ${b.reply}\nMy reasoning: ${b.reason}`,
          origin: "fidelity_review",
          fidelityCaseId: c.id,
          fidelityRunId: r.id,
          allowedUses: ["model_prompt", "trainer_specific_learning"],
        },
        { status: "answered" },
      );
      await tx.query(
        "UPDATE records SET status='teaching',version=version+1,updated_at=now() WHERE id=$1",
        [c.id],
      );
      const [saved] = await tx.query(
        "UPDATE records SET version=version+1,updated_at=now(),data=data||$2::jsonb WHERE id=$1 RETURNING *",
        [
          r.id,
          JSON.stringify({
            teachingId: teaching.id,
            correctionDigest: digest(b),
          }),
        ],
      );
      await event(tx, a, "brain.fidelity_used_for_teaching", r.id, {
        caseId: c.id,
        teachingId: teaching.id,
      });
      return runView(saved);
    });
  });
}
