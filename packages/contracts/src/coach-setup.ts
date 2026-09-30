// The coach setup wizard (owner decisions of 30 September 2026): one wizard of
// six steps, about 15 minutes, save and continue later, skip for later, and
// automatic go-live checks instead of a long checklist. Shared by the API
// (apps/api/src/coach-setup.ts) and the web wizard.
import { z } from "zod";

export const SETUP_STEPS = [
  { key: "account", label: "Create account", minutes: 1 },
  { key: "about", label: "About you", minutes: 3 },
  { key: "page", label: "Your page", minutes: 2 },
  { key: "brain", label: "Teach your Brain", minutes: 6 },
  { key: "plan", label: "Your plan", minutes: 1 },
  { key: "live", label: "Go live", minutes: 2 },
] as const;
export type SetupStepKey = (typeof SETUP_STEPS)[number]["key"];
export type SetupStepStatus =
  | "done"
  | "in_progress"
  | "not_started"
  | "skipped"
  | "waiting";

/**
 * What "Brain taught to the wizard's minimum" means. Held-out scenarios whose
 * data.origin is "platform_quiz" are the "Would you reply like this?" answers
 * the coach confirmed; every other held-out scenario is one the coach wrote.
 * The full 20-case set stays required only for "Sends automatically".
 */
export const SETUP_BRAIN_MINIMUM = { quiz: 8, own: 3 } as const;
export const SETUP_EVALUATION_MINIMUM =
  SETUP_BRAIN_MINIMUM.quiz + SETUP_BRAIN_MINIMUM.own;
export const SCENARIO_ORIGINS = ["coach", "platform_quiz"] as const;
/** The earlier standard: twenty cases the coach wrote. Still accepted. */
export const FULL_CASE_SET = 20;
/**
 * Whether the held-out cases are enough to evaluate and publish a Brain for
 * "Waits for me": the wizard's minimum (8 confirmed quiz answers and 3 cases
 * the coach wrote) or the earlier full set of 20.
 */
export function brainCaseCoverage(
  cases: ReadonlyArray<{ data?: { origin?: unknown } | null }>,
) {
  const quiz = cases.filter((c) => c.data?.origin === "platform_quiz").length;
  const own = cases.length - quiz;
  return {
    quiz,
    own,
    total: cases.length,
    // At least 3 cases are always the coach's own, so the check never rests
    // on platform cases alone.
    enough:
      own >= SETUP_BRAIN_MINIMUM.own &&
      (quiz >= SETUP_BRAIN_MINIMUM.quiz || cases.length >= FULL_CASE_SET),
  };
}

/** Answers the wizard keeps between visits (all optional: save and resume). */
export const setupAboutSchema = z
  .object({
    name: z.string().trim().max(100).optional(),
    specialty: z.string().max(40).optional(),
    audience: z.string().trim().max(500).optional(),
    emirate: z.string().max(20).optional(),
    instagram: z.string().trim().max(31).optional(),
    programmeUrl: z.union([z.literal(""), z.url().max(500)]).optional(),
    programmeSourceId: z.string().uuid().optional(),
  })
  .strict();
export const setupPageSchema = z
  .object({ digest: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();
export const setupSaveSchema = z
  .object({
    version: z.number().int().min(0),
    values: z.record(z.string(), z.unknown()).default({}),
    /** "Skip for later": the step stays unfinished and go-live still checks it. */
    skip: z.boolean().default(false),
  })
  .strict();

export const GO_LIVE_CHECKS = [
  "real_name",
  "email_verified",
  "page_ready",
  "page_clean",
  "subdomain",
  "priced_plan",
  "brain_minimum",
  "authenticator",
] as const;
export type GoLiveCheck = (typeof GO_LIVE_CHECKS)[number];

export const COACH_REPORT_REASONS = [
  "unsafe_advice",
  "medical_claims",
  "impersonation",
  "offensive",
  "scam",
  "other",
] as const;
export const coachReportSchema = z
  .object({
    reason: z.enum(COACH_REPORT_REASONS),
    details: z.string().trim().max(2000).default(""),
    email: z
      .union([z.literal(""), z.email().max(254)])
      .default("")
      .transform((v) => v.toLowerCase()),
  })
  .strict();

export const signupCodeRequestSchema = z
  .object({ email: z.email().max(254).transform((s) => s.toLowerCase()) })
  .strict();
export const signupCodeVerifySchema = z
  .object({
    email: z.email().max(254).transform((s) => s.toLowerCase()),
    code: z.string().regex(/^\d{6}$/),
    name: z.string().trim().min(2).max(100),
    /** Optional: an account made with a code can add a password later. */
    password: z.string().min(12).max(128).optional(),
    accepted: z.literal(true),
  })
  .strict();
