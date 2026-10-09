import { createHash } from "node:crypto";
import type { Tx } from "@trainer/db";
import { candidateCommunication, communicationDigest, checkedCommunication } from "./trainer-brain.ts";
import {
  brainTrainingMeter,
  OWN_CASES_FOR_FULL_CHECK,
} from "../../../packages/domain/src/brain-teach.ts";

/** The digest evaluations store as rulesDigest (same as app.ts). */
export const confirmedRulesDigest = (rules: Array<Record<string, any>>) =>
  createHash("sha256")
    .update(
      JSON.stringify(
        [...rules]
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((r) => ({ id: r.id, data: r.data, version: r.version })),
      ),
    )
    .digest("hex");

const TEACHING_ORIGINS = new Set(["quiz", "keep_training_chat", "reply_correction", "onboarding_chat", "setup_assistant", "fidelity_review"]);

/**
 * Everything the teaching screens and the automation gate read, from the
 * caller's own workspace scope (owner or staff). Read-only.
 */
export async function brainTrainingState(tx: Tx) {
  const rows = await tx.query(
    "SELECT id,kind,status,version,data,created_at FROM records WHERE kind IN ('rule','conflict','scenario','brain_quiz_round','interview','rule_revision','evaluation','brain_release','coaching_correction','brain_suggestion') AND status<>'archived' ORDER BY created_at,id LIMIT 5000",
  );
  const of = (kind: string) => rows.filter((r) => r.kind === kind);
  const rules = of("rule");
  const confirmed = rules
    .filter((r) => r.status === "confirmed")
    .sort((a, b) => a.id.localeCompare(b.id));
  const drafts = rules.filter((r) => r.status === "draft");
  const rulesDigest = confirmedRulesDigest(confirmed);
  const communication = await candidateCommunication(tx);
  const styleDigest = communicationDigest(communication);
  const evaluations = of("evaluation").filter(
    (e) => e.data.rulesDigest === rulesDigest && checkedCommunication(e, communication),
  );
  const fullCheck = evaluations.find(
    (e) =>
      e.status === "passed" &&
      Number(e.data.total ?? 0) >= OWN_CASES_FOR_FULL_CHECK,
  );
  const latest = evaluations.at(-1);
  const rounds = of("brain_quiz_round");
  const completedRounds = rounds.filter((r) => r.status === "completed");
  const openRound = rounds.find((r) => r.status === "open") ?? null;
  const ownCases = of("scenario").filter((r) => r.status === "held_out");
  const interviews = of("interview");
  const quizChanges = interviews.filter(
    (i) => i.data.origin === "quiz" && i.data.verdict === "change",
  );
  const replyCorrections = of("coaching_correction");
  const corrections =
    quizChanges.length + of("rule_revision").length + replyCorrections.length;
  const openConflicts = of("conflict").filter(
    (c) => c.status !== "resolved",
  ).length;
  const release =
    of("brain_release").find((r) => r.status === "published") ?? null;
  const meter = brainTrainingMeter({
    confirmedRules: confirmed.length,
    draftRules: drafts.length,
    flaggedDraftRules: drafts.filter((r) => r.data.flags?.length).length,
    openConflicts,
    quizRoundsCompleted: completedRounds.length,
    ownCases: ownCases.length,
    corrections,
    fullCheckPassing: !!fullCheck,
    latestCheck: latest
      ? {
          passed: Number(latest.data.passed ?? 0),
          total: Number(latest.data.total ?? 0),
        }
      : null,
  });
  // Teaching already turned into draft rules: a compiled rule's coverage
  // names its sources; a reply correction is used once an interview cites it.
  const compiledSources = new Set(
    rules.flatMap((r) =>
      (r.data.compilationCoverage?.sources ?? []).map((s: any) => s.sourceId),
    ),
  );
  const convertedCorrections = new Set(
    interviews.map((i) => i.data.correctionId).filter(Boolean),
  );
  const uncompiledTeaching = interviews.filter(
    (i) =>
      TEACHING_ORIGINS.has(i.data.origin) &&
      !compiledSources.has(i.id) &&
      // Platform safety questions stay platform-owned: the coach's wording
      // is kept as teaching but never becomes a rule suggestion.
      i.data.source !== "platform" &&
      !(i.data.origin === "quiz" && i.data.verdict !== "change"),
  );
  return {
    rules,
    confirmed,
    drafts,
    rulesDigest,
    communication,
    communicationDigest: styleDigest,
    rounds,
    completedRounds,
    openRound,
    ownCases,
    openConflicts,
    release,
    fullCheck: fullCheck ?? null,
    /** The latest check of the current rules (passed or not). */
    latestEvaluation: latest ?? null,
    meter,
    uncompiledTeaching,
    // A correction the suggestion flow (brain-learning.ts) turned into a
    // suggested rule is listed there, not here.
    unconvertedCorrections: replyCorrections.filter(
      (c) =>
        !convertedCorrections.has(c.id) &&
        !of("brain_suggestion").some(
          (s) =>
            s.data.source?.correctionId === c.id &&
            ["suggested", "confirmed", "dismissed"].includes(s.status),
        ),
    ),
    /** Suggested rules from corrections, waiting for the coach. */
    learnedSuggestions: of("brain_suggestion").filter(
      (s) => s.status === "suggested",
    ),
  };
}
export type BrainTrainingState = Awaited<ReturnType<typeof brainTrainingState>>;
