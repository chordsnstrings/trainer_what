// Pure decisions of the coach setup wizard (docs/features/setup-wizard.md),
// shared by the screens and their tests. No React, no fetch.
import { SETUP_STEPS, type SetupStepKey } from "@trainer/contracts";

export { SETUP_STEPS };
export type { SetupStepKey };

/** Where the wizard lives; `/trainer/setup` (the sign-up reply) is an alias. */
export const SETUP_PATH = "/setup";
export const KEEP_TRAINING = "keep-training";
const STEP_KEYS = SETUP_STEPS.map((s) => s.key) as SetupStepKey[];

export type WizardStep = {
  key: SetupStepKey;
  label: string;
  minutes: number;
  status: "done" | "in_progress" | "not_started" | "skipped" | "waiting";
  version: number;
};

/** True for the wizard's own addresses (`/setup…` and `/trainer/setup…`). */
export function isSetupPath(path: string) {
  return /^\/(?:trainer\/)?setup(?:\/|$)/.test(path);
}

/**
 * What a wizard address shows: one of the six steps, the "Keep training" hub,
 * or the step to resume (`null` step). Unknown segments resume.
 */
export function setupView(path: string): {
  step: SetupStepKey | null;
  keepTraining: boolean;
} {
  const segment = path.replace(/^\/(?:trainer\/)?setup\/?/, "").split("/")[0];
  if (segment === KEEP_TRAINING) return { step: null, keepTraining: true };
  return {
    step: (STEP_KEYS as string[]).includes(segment)
      ? (segment as SetupStepKey)
      : null,
    keepTraining: false,
  };
}

export const setupHref = (step: SetupStepKey | typeof KEEP_TRAINING) =>
  `${SETUP_PATH}/${step}`;

/**
 * The older checklist addresses that the wizard now covers. Every other
 * `/trainer/onboarding/*` screen (interview, uploads, payout, share...)
 * keeps opening as before.
 */
export function legacySetupRedirect(path: string): string | null {
  const clean = path.replace(/\/+$/, "");
  const map: Record<string, SetupStepKey | ""> = {
    "/trainer/onboarding": "",
    "/trainer/onboarding/account": "account",
    "/trainer/onboarding/identity": "about",
    "/trainer/onboarding/brand": "page",
    "/trainer/onboarding/preview": "page",
    "/trainer/onboarding/offer": "plan",
    "/trainer/onboarding/publish": "live",
  };
  if (!(clean in map)) return null;
  const step = map[clean];
  return step ? setupHref(step) : SETUP_PATH;
}

/** The step before and after `key` (for Back and Continue). */
export function neighbours(key: SetupStepKey) {
  const i = STEP_KEYS.indexOf(key);
  return {
    previous: i > 0 ? STEP_KEYS[i - 1] : null,
    next: i < STEP_KEYS.length - 1 ? STEP_KEYS[i + 1] : null,
  };
}

/** Steps a coach can do by chatting with the setup assistant. */
export const CHAT_STEPS = ["about", "page", "brain", "plan"] as const;
export type ChatStep = (typeof CHAT_STEPS)[number];
export const hasChat = (key: SetupStepKey): key is ChatStep =>
  (CHAT_STEPS as readonly string[]).includes(key);
/** Steps that can be skipped for later (go-live still checks them). */
export const canSkip = (key: SetupStepKey) =>
  key === "about" || key === "page" || key === "brain" || key === "plan";

export const STATUS_WORDS: Record<WizardStep["status"], string> = {
  done: "Done",
  in_progress: "Started",
  not_started: "To do",
  skipped: "Skipped for later",
  waiting: "Waiting on trainsyou",
};

/** "About 9 minutes left", "Less than a minute left", "All done". */
export function timeLeft(minutes: number) {
  if (minutes <= 0) return "All done";
  if (minutes < 1) return "Less than a minute left";
  return `About ${minutes} minute${minutes === 1 ? "" : "s"} left`;
}

// ------------------------------------------------------------ subdomain

/** What the coach types, as an address name: lower case, spaces as hyphens. */
export function subdomainInput(raw: string) {
  return raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[\s_.]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 40);
}

export type SubdomainCheck = {
  name: string;
  host: string | null;
  available: boolean;
  current: boolean;
  reason: "format" | "hyphen" | "reserved" | "taken" | null;
  message: string | null;
  suggestions?: string[];
};
/** The line under the address field. */
export function subdomainLine(check: SubdomainCheck | null, checking: boolean) {
  if (checking) return { tone: "muted", text: "Checking…" } as const;
  if (!check) return null;
  if (check.current)
    return { tone: "success", text: "This is your address." } as const;
  if (check.available)
    return {
      tone: "success",
      text: `${check.host ?? check.name} is free.`,
    } as const;
  return {
    tone: "error",
    text: check.message ?? "Choose another address.",
  } as const;
}

// ------------------------------------------------------------ brain step

export type RuleCard = {
  id: string;
  version: number;
  status: "draft" | "confirmed";
  title: string;
  category?: string;
  condition?: string;
  directive?: string;
  reason?: string;
  flags: string[];
  warning: boolean;
};

/** Draft cards split for "Approve all" and the flagged one-by-one list. */
export function ruleGroups(rules: RuleCard[]) {
  const drafts = rules.filter((r) => r.status === "draft");
  return {
    approved: rules.filter((r) => r.status === "confirmed"),
    clean: drafts.filter((r) => !r.warning),
    flagged: drafts.filter((r) => r.warning),
  };
}

const FLAG_WORDS: Record<string, string> = {
  medical_advice: "sounds like medical advice",
  red_flag_not_stopped: "does not stop for a health warning sign",
  link: "contains a link",
  contact: "contains contact details",
  approval_claim: "claims an approval",
  guarantee: "promises a result",
};
/** Plain words for a rule's warning flags. */
export function flagWords(flags: string[]) {
  return flags.map((f) => FLAG_WORDS[f] ?? f.replaceAll("_", " "));
}

export type QuizCase = {
  id: string;
  source: "rule" | "platform";
  message: string;
  route: "reply" | "escalate";
  reply: string;
  answer: { verdict: "yes" | "change"; reply: string | null } | null;
};
/** The first question still waiting for an answer, and the count so far. */
export function quizPosition(cases: QuizCase[]) {
  const index = cases.findIndex((c) => !c.answer);
  return {
    current: index === -1 ? null : cases[index],
    number: index === -1 ? cases.length : index + 1,
    answered: cases.filter((c) => c.answer).length,
    total: cases.length,
  };
}

/** What still stands between the coach and "Waits for me". */
export function brainChecklist(input: {
  approvedRules: number;
  flaggedDrafts: number;
  quizDone: boolean;
  ownCases: number;
  ownNeeded: number;
}) {
  return [
    {
      key: "rules",
      label: "Approve your rules",
      done: input.approvedRules > 0 && input.flaggedDrafts === 0,
      detail:
        input.approvedRules === 0
          ? "Nothing approved yet"
          : input.flaggedDrafts
            ? `${input.flaggedDrafts} flagged rule${input.flaggedDrafts === 1 ? "" : "s"} still to check`
            : `${input.approvedRules} approved`,
    },
    {
      key: "quiz",
      label: "Practice quiz",
      done: input.quizDone,
      detail: input.quizDone ? "Finished" : "8 to 10 questions",
    },
    {
      key: "cases",
      label: "Your own client questions",
      done: input.ownCases >= input.ownNeeded,
      detail: `${Math.min(input.ownCases, input.ownNeeded)} of ${input.ownNeeded}`,
    },
  ];
}

// ------------------------------------------------------------ plan step

/** A plan name to start from: "Strength coaching with Alex". */
export function suggestedPlanName(name: string, specialty?: string | null) {
  const first = name.trim().split(/\s+/)[0] ?? "";
  const kind = specialty?.trim() ? specialty.trim() : "Coaching";
  const base = /coaching/i.test(kind) ? kind : `${kind} coaching`;
  return first ? `${base} with ${first}` : base;
}

/** AED text typed by the coach as minor units, or null when unreadable. */
export function priceMinor(text: string): number | null {
  const clean = text.replace(/[,\s]/g, "").replace(/^aed/i, "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}

// ------------------------------------------------------------ go live

/** "abu_dhabi" → "Abu Dhabi". */
export function emirateLabel(id: string) {
  return id
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export type GoLiveCheck = {
  key: string;
  label: string;
  owner: "coach" | "trainsyou";
  ok: boolean;
  reason?: string | null;
};
/** Coach checks first (the ones they can fix), then one trainsyou line. */
export function goLiveGroups(checks: GoLiveCheck[]) {
  const coach = checks.filter((c) => c.owner === "coach");
  const trainsyou = checks.filter((c) => c.owner === "trainsyou" && !c.ok);
  return {
    coach,
    open: coach.filter((c) => !c.ok),
    trainsyou,
  };
}

/** Where a failing coach check is fixed in the wizard. */
export function checkStep(key: string): SetupStepKey | null {
  if (key === "real_name") return "about";
  if (key === "email_verified") return "account";
  if (["page_ready", "page_clean", "subdomain"].includes(key)) return "page";
  if (key === "priced_plan") return "plan";
  if (key === "brain_minimum") return "brain";
  return null;
}

// ------------------------------------------------------------ keep training

/** The "Brain trained" meter's label: "62 of 100". */
export const meterText = (score: number) =>
  `${Math.max(0, Math.min(100, Math.round(score)))} of 100`;

/** Error from an API call, keeping the server's code for decisions. */
export type ApiError = Error & { code?: string; status?: number };
export function apiError(status: number, body: any): ApiError {
  return Object.assign(
    new Error(
      typeof body?.message === "string" && body.message
        ? body.message
        : "Something went wrong. Please try again.",
    ),
    { code: body?.code as string | undefined, status },
  );
}

// ------------------------------------------------------------ assistant drafts

type Draft = Record<string, unknown>;
const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * The About you fields an assistant draft fills in: the name, an offered
 * specialty, who they coach and, when the city is an emirate, the emirate.
 * Anything else stays as the coach typed it.
 */
export function aboutFromDraft(
  draft: Draft,
  offered: { specialties: ReadonlyArray<{ id: string }>; emirates: readonly string[] },
) {
  const out: Partial<Record<"name" | "specialty" | "audience" | "emirate", string>> = {};
  const name = text(draft.publicName) ?? text(draft.businessName);
  if (name) out.name = name.slice(0, 100);
  const specialty = text(draft.specialty);
  if (specialty && offered.specialties.some((s) => s.id === specialty))
    out.specialty = specialty;
  const audience = text(draft.audience);
  if (audience) out.audience = audience.slice(0, 500);
  const emirate = emirateFromCity(text(draft.city), offered.emirates);
  if (emirate) out.emirate = emirate;
  return out;
}
/** Cities inside an emirate that coaches name instead of the emirate. */
const CITY_EMIRATE: Record<string, string> = { "al ain": "abu_dhabi" };
/**
 * The emirate a free-text city names: "Dubai Marina and JLT" is Dubai,
 * "Al Ain" is Abu Dhabi. Nothing when no emirate is named.
 */
export function emirateFromCity(city: string | null, emirates: readonly string[]) {
  if (!city) return null;
  const words = " " + city.toLowerCase().replace(/[^a-z]+/g, " ").trim() + " ";
  for (const [name, id] of Object.entries(CITY_EMIRATE))
    if (words.includes(" " + name + " ") && emirates.includes(id)) return id;
  return (
    emirates.find((id) => words.includes(" " + id.replaceAll("_", " ") + " ")) ??
    null
  );
}

/** The page text an assistant draft fills in (headline and about you). */
export function pageFromDraft(draft: Draft) {
  const out: Partial<Record<"headline" | "bio", string>> = {};
  const headline = text(draft.headline),
    bio = text(draft.bio);
  if (headline) out.headline = headline.slice(0, 160);
  if (bio) out.bio = bio.slice(0, 2000);
  return out;
}

/**
 * The plan form an assistant draft fills in. A price is only ever one the
 * coach wrote (the assistant's checks drop any other number); the coach
 * still saves it.
 */
export function planFromDraft(draft: Draft) {
  const out: Partial<{
    name: string;
    description: string;
    price: string;
    billing: "monthly" | "upfront";
    days: string;
  }> = {};
  const name = text(draft.name),
    description = text(draft.description);
  if (name) out.name = name.slice(0, 100);
  if (description) out.description = description.slice(0, 1500);
  if (typeof draft.priceAed === "number" && Number.isFinite(draft.priceAed))
    out.price = String(draft.priceAed);
  if (draft.billing === "monthly" || draft.billing === "upfront")
    out.billing = draft.billing;
  if (typeof draft.programmeDays === "number") out.days = String(draft.programmeDays);
  return out;
}
