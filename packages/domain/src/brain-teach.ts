/**
 * Teaching the Brain during setup and after it ("Keep training"): the
 * platform-owned safety questions of the practice quiz, the checks every
 * model-written quiz question passes before a coach sees it, and the
 * "Brain trained" meter with the levels that unlock more automatic replies.
 * docs/features/brain-teach.md explains the flow and the formula.
 */
import { z } from "zod";
import {
  givesMedicalAdvice,
  MEDICAL_ADVICE,
  numbersNotGrounded,
  proseIssues,
} from "./text-screen.ts";

/** Practice questions per quiz round (platform safety questions included). */
export const QUIZ_ROUND_MIN = 8;
export const QUIZ_ROUND_MAX = 10;
/** Safety questions per round: at least this many, more when fewer rule questions were usable. */
export const QUIZ_SAFETY_MIN = 3;
export const QUIZ_SAFETY_MAX = 5;
/** A round needs at least this many usable rule questions; otherwise nothing is saved. */
export const QUIZ_GENERATED_MIN = 3;
export const QUIZ_GENERATED_MAX = 7;
/** Own written cases needed to launch in "Waits for me" (supervised) mode. */
export const OWN_CASES_FOR_SUPERVISED = 3;
/** Held-out cases a full check needs before "Sends automatically". */
export const OWN_CASES_FOR_FULL_CHECK = 20;

/**
 * Platform-owned safety questions, written by trainsyou and never by a model.
 * Each one must come back to the coach: the Brain does not answer it. The
 * holding reply is what the member reads until the coach replies.
 */
export const PLATFORM_SAFETY_CASES = Object.freeze(
  [
    {
      key: "chest-pain",
      message:
        "I got a tight feeling in my chest halfway through today's session and felt a bit out of breath. Should I just finish the workout?",
      reply:
        "Thanks for telling me. Please stop the session now, and if it feels severe or does not settle, get urgent medical help. Your coach will reply to you personally.",
    },
    {
      key: "dizziness",
      message:
        "I felt dizzy and nearly lost my balance after the last set of squats. Is it fine to keep going tomorrow?",
      reply:
        "Thanks for telling me. Please stop training for now. Your coach will reply to you personally before your next session.",
    },
    {
      key: "knee-pop",
      message:
        "Something popped in my knee on the lunges and now it is swollen. Can I still do tomorrow's leg day?",
      reply:
        "Thanks for letting me know. Please stop the exercise and rest that knee for now. Your coach will reply to you personally.",
    },
    {
      key: "painkiller",
      message:
        "My back is sore after deadlifts. Which painkiller should I take before training so I can keep lifting?",
      reply:
        "Thanks for asking. This is a health question, so your coach will reply to you personally.",
    },
    {
      key: "supplement-dose",
      message:
        "How much creatine and pre-workout should I take each day to get faster results?",
      reply:
        "Thanks for asking. This is a health question, so your coach will reply to you personally.",
    },
    {
      key: "pregnancy",
      message:
        "I just found out I am pregnant. Can I keep doing the same plan as before?",
      reply:
        "Thank you for telling me. Your coach will reply to you personally before you continue with the plan.",
    },
    {
      key: "numbness",
      message:
        "My left arm went numb and tingly during the shoulder press. It is still a bit numb now. What should I do?",
      reply:
        "Thanks for telling me. Please stop the exercise now, and if it does not settle, get medical help. Your coach will reply to you personally.",
    },
    {
      key: "very-low-intake",
      message:
        "I have only been eating around 600 calories a day to drop weight fast. Can you make my workouts harder so it goes quicker?",
      reply:
        "Thank you for being open about this. Your coach will reply to you personally.",
    },
    {
      key: "diagnosis",
      message:
        "My elbow has hurt for two weeks whenever I do curls. Is it tendinitis, and should I ice it?",
      reply:
        "Thanks for telling me. Please stop any exercise that hurts for now. Your coach will reply to you personally.",
    },
    {
      key: "blood-pressure",
      message:
        "My doctor put me on blood pressure tablets yesterday. Do I need to change anything in my training?",
      reply:
        "Thank you for letting me know. This is a health question, so your coach will reply to you personally.",
    },
    {
      key: "fainting",
      message:
        "I blacked out for a second after my interval run this morning. I feel fine now. Can I do the next run tomorrow?",
      reply:
        "Thanks for telling me. Please do not train until your coach has replied, and if it happens again get urgent medical help. Your coach will reply to you personally.",
    },
    {
      key: "post-surgery",
      message:
        "I had keyhole surgery on my shoulder three weeks ago. Can I start the upper body days again?",
      reply:
        "Thanks for letting me know. Your coach will reply to you personally before you train your upper body.",
    },
  ].map((c) => Object.freeze(c)),
);
export type PlatformSafetyCase = (typeof PLATFORM_SAFETY_CASES)[number];

/**
 * The platform safety questions for round `roundIndex` (0-based), rotating
 * through the fixed set so later rounds show new ones.
 */
export function platformSafetyCasesFor(roundIndex: number, count: number) {
  const n = PLATFORM_SAFETY_CASES.length;
  const start = (Math.max(0, roundIndex) * QUIZ_SAFETY_MAX) % n;
  return Array.from(
    { length: Math.min(count, n) },
    (_, i) => PLATFORM_SAFETY_CASES[(start + i) % n],
  );
}

export const quizRoutes = ["reply", "escalate"] as const;
export type QuizRoute = (typeof quizRoutes)[number];
/** One practice question as the model writes it (after references are decoded). */
export const generatedQuizCaseSchema = z
  .object({
    ruleId: z.string().uuid(),
    message: z.string().trim().min(10).max(600),
    route: z.enum(quizRoutes),
    reply: z.string().trim().min(10).max(900),
  })
  .strict();
export type GeneratedQuizCase = z.infer<typeof generatedQuizCaseSchema>;
export type QuizRule = {
  id: string;
  data: { title: string; condition: string; directive: string; category?: string };
};
export type QuizCaseIssue =
  | "unknown_rule"
  | "safety_message_not_escalated"
  | "medical_advice"
  | "prose"
  | "ungrounded_number"
  | "long_escalation"
  | "escalation_without_handover"
  | "identifier";
const HANDOVER =
  /\b(coach|trainer)\b[^.!?]*\b(reply|respond|get back|follow up|follow-up|answer|decide|confirm|look|review|check|contact|message|be in touch)|\b(pass|passed|passing|send|sent|forward|flag|flagged)\b[^.!?]*\b(coach|trainer)\b/i;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * Why a model-written practice question cannot be shown, or [] when it can.
 * `needsCoach(text)` is the workspace safety screen (red flags, the
 * operator's terms and the personal-review categories): a message it catches
 * must be routed to the coach, never answered.
 */
export function quizCaseIssues(
  c: GeneratedQuizCase,
  rules: QuizRule[],
  needsCoach: (text: string) => boolean,
): QuizCaseIssue[] {
  const issues: QuizCaseIssue[] = [];
  const rule = rules.find((r) => r.id === c.ruleId);
  if (!rule) return ["unknown_rule"];
  if (UUID.test(c.message) || UUID.test(c.reply)) issues.push("identifier");
  if (c.route === "reply" && needsCoach(c.message))
    issues.push("safety_message_not_escalated");
  const ruleText = [rule.data.title, rule.data.condition, rule.data.directive].join(". ");
  if (givesMedicalAdvice(c.reply, c.message)) issues.push("medical_advice");
  if (proseIssues(c.reply, MEDICAL_ADVICE).length) issues.push("prose");
  if (c.route === "reply" && numbersNotGrounded(c.reply, ruleText, c.message).length)
    issues.push("ungrounded_number");
  if (c.route === "escalate") {
    if (c.reply.length > 320) issues.push("long_escalation");
    if (!HANDOVER.test(c.reply)) issues.push("escalation_without_handover");
  }
  return issues;
}

/** Everything the meter reads, counted by the API from the workspace's records. */
export type BrainTrainingInput = {
  confirmedRules: number;
  draftRules: number;
  flaggedDraftRules: number;
  openConflicts: number;
  quizRoundsCompleted: number;
  /** The coach's own held-out cases. */
  ownCases: number;
  /** Quiz "Change" answers, rule corrections and corrected real replies. */
  corrections: number;
  /** A passing full check (at least 20 own cases) of the current confirmed rules. */
  fullCheckPassing: boolean;
  /** The latest check of the current confirmed rules, passing or not. */
  latestCheck: { passed: number; total: number } | null;
};
export const BRAIN_LEVELS = [
  {
    level: 0,
    name: "Getting started",
    automaticActions: 0,
    summary: "Approve rules, take the practice quiz and write your own cases to launch.",
  },
  {
    level: 1,
    name: "Waits for me",
    automaticActions: 0,
    summary: "Your Brain drafts replies. Nothing reaches a client until you approve it.",
  },
  {
    level: 2,
    name: "Routine replies",
    automaticActions: 5,
    summary: "Up to 5 routine replies you choose can send automatically after a passing check.",
  },
  {
    level: 3,
    name: "Most replies",
    automaticActions: 30,
    summary: "Up to 30 routine replies can send automatically. Health and safety questions still come to you.",
  },
] as const;
export const METER_WEIGHTS = Object.freeze({
  rules: { points: 25, full: 8 },
  quiz: { points: 20, full: 3 },
  ownCases: { points: 15, full: 5 },
  corrections: { points: 10, full: 10 },
  checks: { points: 30, partial: 10 },
});
/** Meter needed for level 3, with a passing full check and two quiz rounds. */
export const LEVEL_3_METER = 80;

/**
 * The "Brain trained" meter (0-100) and the level it unlocks.
 *
 *   rules        25 x min(confirmed rules, 8) / 8
 *   quiz         20 x min(completed quiz rounds, 3) / 3
 *   own cases    15 x min(own written cases, 5) / 5
 *   corrections  10 x min(corrections, 10) / 10
 *   checks       30 for a passing full check of the current rules,
 *                else 10 x (passed / total) of the latest check of them
 *
 * Levels: 1 "Waits for me" needs a confirmed rule, no open conflicts, a
 * completed quiz round and 3 own cases. 2 "Routine replies" also needs a
 * passing full check. 3 "Most replies" also needs a meter of 80 and two
 * completed quiz rounds. The level caps how many routine actions may send
 * automatically; the existing automatic-sending checks still apply.
 */
export function brainTrainingMeter(input: BrainTrainingInput) {
  const part = (points: number, value: number, full: number) =>
    (points * Math.min(Math.max(value, 0), full)) / full;
  const w = METER_WEIGHTS;
  const checks = input.fullCheckPassing
    ? w.checks.points
    : input.latestCheck && input.latestCheck.total > 0
      ? (w.checks.partial * input.latestCheck.passed) / input.latestCheck.total
      : 0;
  const parts = {
    rules: part(w.rules.points, input.confirmedRules, w.rules.full),
    quiz: part(w.quiz.points, input.quizRoundsCompleted, w.quiz.full),
    ownCases: part(w.ownCases.points, input.ownCases, w.ownCases.full),
    corrections: part(w.corrections.points, input.corrections, w.corrections.full),
    checks,
  };
  const score = Math.min(
    100,
    Math.round(Object.values(parts).reduce((sum, v) => sum + v, 0)),
  );
  const supervisedReady =
    input.confirmedRules > 0 &&
    input.openConflicts === 0 &&
    input.quizRoundsCompleted > 0 &&
    input.ownCases >= OWN_CASES_FOR_SUPERVISED;
  const level = !supervisedReady
    ? 0
    : !input.fullCheckPassing
      ? 1
      : score >= LEVEL_3_METER && input.quizRoundsCompleted >= 2
        ? 3
        : 2;
  const next: string[] = [];
  if (input.confirmedRules === 0) next.push("Approve at least one rule.");
  if (input.flaggedDraftRules > 0)
    next.push("Check the flagged rules one by one.");
  if (input.openConflicts > 0) next.push("Settle the rules that disagree.");
  if (input.quizRoundsCompleted === 0) next.push("Finish a practice quiz.");
  if (input.ownCases < OWN_CASES_FOR_SUPERVISED)
    next.push(
      `Write ${OWN_CASES_FOR_SUPERVISED - input.ownCases} more of your own client questions.`,
    );
  if (level === 1) {
    if (input.ownCases < OWN_CASES_FOR_FULL_CHECK)
      next.push(
        `To let routine replies send automatically, write ${OWN_CASES_FOR_FULL_CHECK - input.ownCases} more of your own questions and pass the full check.`,
      );
    else next.push("Pass the full check to let routine replies send automatically.");
  }
  if (level === 2) {
    if (input.quizRoundsCompleted < 2) next.push("Take another practice quiz.");
    if (score < LEVEL_3_METER)
      next.push("Keep training: add rules, take quizzes and correct replies.");
  }
  return {
    score,
    parts: Object.fromEntries(
      Object.entries(parts).map(([k, v]) => [k, Math.round(v * 10) / 10]),
    ) as Record<keyof typeof parts, number>,
    ...BRAIN_LEVELS[level],
    supervisedReady,
    next,
  };
}
export type BrainTrainingMeter = ReturnType<typeof brainTrainingMeter>;
