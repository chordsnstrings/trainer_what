/**
 * The Brain replies check: every held-out case the coach wrote (and the
 * practice quiz minimum) answered by the current approved rules, with the
 * same checks a member reply gets. Used by `POST /brain/evaluate` and by the
 * background "Check my Brain" job (brain-check.ts).
 */
import { createHash } from "node:crypto";
import { event, putRecord, type Actor, type Database } from "@trainer/db";
import {
  brainCaseCoverage,
  FULL_CASE_SET,
  SETUP_BRAIN_MINIMUM,
} from "@trainer/contracts";
import {
  MODEL_EVIDENCE_LIMIT,
  ModelOutputInvalid,
  coachDecisionPromptVersion,
  modelDecision,
} from "@trainer/providers";
import {
  evaluationAnswerIssues,
  planLibrary,
} from "../../../packages/domain/src/brain-plans.ts";
import { loadPlanSettings } from "./brain-plans.ts";
import { modelAccounting } from "./model-accounting.ts";
import { candidateCommunication, communicationDigest } from "./trainer-brain.ts";
import { trainerBrainContext, conversationExampleOverlaps } from "../../../packages/domain/src/trainer-brain.ts";

const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
// A published release must fit in one model request beside the client's
// profile and Client Twin, so no confirmed rule is silently left unseen.
export const RELEASE_RULE_LIMIT = MODEL_EVIDENCE_LIMIT - 2;
export const HELD_OUT_SCENARIO_LIMIT = 30;
export function assertReleaseRuleLimit(count: number) {
  if (count > RELEASE_RULE_LIMIT)
    throw fail(
      409,
      "RULE_LIMIT",
      `A Brain release can include at most ${RELEASE_RULE_LIMIT} confirmed rules; return extra rules to draft before evaluating`,
    );
}

export async function evaluateBrainReplies(db: Database, a: Actor) {
  const material = await db.tenant(a, async (tx) => ({
    communication: await candidateCommunication(tx),
    rules: await tx.query(
      "SELECT * FROM records WHERE kind='rule' AND status='confirmed' ORDER BY id",
    ),
    cases: await tx.query(
      "SELECT * FROM records WHERE kind='scenario' AND status='held_out' ORDER BY id LIMIT $1",
      [HELD_OUT_SCENARIO_LIMIT + 1],
    ),
    // The trainer's library and plan bounds grade any program an answer
    // proposes.
    plan: {
      library: planLibrary(
        await tx.query(
          "SELECT * FROM records WHERE kind='exercise' AND status='active' ORDER BY data->>'name',id LIMIT 1000",
        ),
        await tx.query(
          "SELECT * FROM records WHERE kind='program' AND status='template' ORDER BY created_at DESC,id LIMIT 100",
        ),
      ),
      bounds: (await loadPlanSettings(tx)).settings.bounds,
    },
  }));
  // Every held-out scenario is evaluated; none is silently dropped.
  if (material.cases.length > HELD_OUT_SCENARIO_LIMIT)
    throw fail(
      409,
      "EVAL_SCOPE",
      `Evaluation covers at most ${HELD_OUT_SCENARIO_LIMIT} held-out scenarios; nothing has been evaluated`,
    );
  assertReleaseRuleLimit(material.rules.length);
  if (material.cases.some(c => conversationExampleOverlaps(material.communication, c.data.prompt)))
    throw fail(409, "EVAL_EXAMPLE_OVERLAP", "Keep practice questions separate from your conversation examples. Replace the overlapping practice question before checking your Brain.");
  // The setup wizard's minimum (8 confirmed quiz answers and 3 cases the
  // coach wrote) or the earlier 20; "Sends automatically" keeps its own
  // full check in coaching-runtime.ts.
  if (!brainCaseCoverage(material.cases).enough)
    throw fail(
      409,
      "EVAL_COVERAGE",
      `Answer at least ${SETUP_BRAIN_MINIMUM.quiz} practice quiz questions and write ${SETUP_BRAIN_MINIMUM.own} of your own cases (or add ${FULL_CASE_SET} cases) before checking your Brain`,
    );
  const outcomes: Array<{
    scenarioId: string;
    passed: boolean;
    error?: string;
    issues?: string[];
  }> = [];
  for (const c of material.cases) {
    let generated: Awaited<ReturnType<typeof modelDecision>>;
    try {
      generated = await modelDecision(
        "held_out_evaluation",
        c.data.prompt,
        material.rules.map((r) => ({ id: r.id, data: r.data })),
        modelAccounting(db, a, "evaluation"),
        { trainerBrain: trainerBrainContext({ data: { rules: material.rules, communication: material.communication } }) },
      );
    } catch (error) {
      // An invalid answer fails its scenario; the rest of the run and the
      // calls already paid for are kept. Configuration and network
      // failures still stop the evaluation.
      if (!(error instanceof ModelOutputInvalid)) throw error;
      outcomes.push({
        scenarioId: c.id,
        passed: false,
        error: "invalid_model_answer",
      });
      continue;
    }
    const routed = c.data.expectEscalation
      ? generated.decision.type === "escalation"
      : generated.decision.evidenceIds.includes(c.data.expectedEvidenceId);
    // Citing the right rule is not enough: the wording and any program
    // must also be safe to show a member.
    const cited = material.rules.filter((r) =>
      generated.decision.evidenceIds.includes(r.id),
    );
    const issues = evaluationAnswerIssues(generated.decision, {
      ...material.plan,
      programExpected:
        !c.data.expectEscalation &&
        generated.decision.type === "program_build",
      citedText: cited
        .map((r) => [r.data.title, r.data.condition, r.data.directive].join(". "))
        .join(" "),
      requestText: String(c.data.prompt ?? ""),
    });
    outcomes.push({
      scenarioId: c.id,
      passed: routed && !issues.length,
      ...(issues.length ? { issues } : {}),
    });
  }
  const digest = createHash("sha256")
    .update(
      JSON.stringify(
        material.rules.map((r) => ({
          id: r.id,
          data: r.data,
          version: r.version,
        })),
      ),
    )
    .digest("hex");
  return db.tenant(a, async (tx) => {
    const r = await putRecord(
      tx,
      a,
      "evaluation",
      {
        outcomes,
        total: outcomes.length,
        passed: outcomes.filter((x) => x.passed).length,
        rulesDigest: digest,
        communicationDigest: communicationDigest(material.communication),
        promptVersion: coachDecisionPromptVersion,
      },
      { status: outcomes.every((x) => x.passed) ? "passed" : "failed" },
    );
    await event(tx, a, "brain.evaluation_completed", r.id, {
      total: outcomes.length,
    });
    return r;
  });
}
