// Proof shared by the phase 1 pages (docs/marketing-revamp-2026-10-26/phase1/
// PLAN.md §1.6; PLAYBOOK C0 "Status" and "Proof components"): what works
// today and what is not on yet, what subscribers get, the checks a visitor
// can make instead of testimonials, and what a trainer's AI never does.
// Gates name the platform's own flags, so a status follows the platform,
// never the copy. The renderer is components/marketing/proof.tsx; the
// registry (marketing-content.ts) reuses the lists as section bullets.
import type { AvailabilityKey } from "./marketing.ts";

/** A flag a status waits for: new sign-ups ("registration") or a provider. */
export type StatusGate = "registration" | AvailabilityKey;
export type StatusItem = {
  /** Shown under "Live today" once every gate is on. */
  text: string;
  /** Shown under "Not on yet" while a gate is off; defaults to `text`. */
  offText?: string;
  /** Every gate must be on; an item without gates is live today. */
  gates?: StatusGate[];
};

/**
 * What publishing a page waits for: the go-live checks trainsyou owns
 * (apps/api/src/onboarding.ts): card payments ("payments"), the coaching
 * assistant ("model") and approved legal documents, which in production
 * are also what opens sign-ups ("registration"). Bank details are asked at
 * the first payout, not before launch, so payouts are not among them.
 */
export const PUBLISH_GATES: StatusGate[] = ["registration", "payments", "model"];
/** Teaching and testing your AI need the coaching assistant (the same "model" check). */
export const TEACH_GATES: StatusGate[] = ["model"];

/** "Live today / Not on yet" (the status panel and strip). */
export const STATUS_ITEMS: StatusItem[] = [
  { text: "Sign up free", offText: "New sign-ups (early access for now)", gates: ["registration"] },
  { text: "Set up your page and app" },
  { text: "Teach and test your AI", offText: "Teaching and testing your AI", gates: TEACH_GATES },
  { text: "Preview what subscribers will see" },
  {
    text: "Publish your page to subscribers",
    offText: "Publishing your page to subscribers",
    gates: PUBLISH_GATES,
  },
  { text: "Subscriber payments in AED", gates: ["payments"] },
  { text: "Payouts to a UAE bank", gates: ["payouts"] },
  { text: "Paid bookings", gates: ["payments"] },
  // Subscribers buy it at checkout, so it waits for their payments too.
  { text: "Voice add-on for subscribers", gates: ["voice", "payments"] },
];

/** The platform flags a status reads; llms-full.txt may not know whether sign-ups are open. */
export type StatusFlags = {
  registrationOpen?: boolean;
  availability?: Partial<Record<AvailabilityKey, boolean>>;
};
/**
 * Whether every gate is on: false once one is off, undefined while the
 * others are on and sign-ups are unknown, true otherwise (no gates: true).
 */
export function gatesState(flags: StatusFlags, gates: readonly StatusGate[] = []): boolean | undefined {
  const states = gates.map((gate) =>
    gate === "registration" ? flags.registrationOpen : flags.availability?.[gate] === true,
  );
  if (states.includes(false)) return false;
  return states.includes(undefined) ? undefined : true;
}

export type HomeOfferItem = {
  text: string;
  /** As on /features: included, the optional tier or an add-on. */
  offering: "Included" | "Optional tier" | "Add-on";
  /** The providers it needs; it shows "Not on yet" while one is off. */
  availability?: AvailabilityKey[];
};
/** What subscribers get under the trainer's name (the home "subscribers" band). */
export const HOME_OFFER: HomeOfferItem[] = [
  { text: "A daily plan, your way", offering: "Included" },
  { text: "Guided workouts, offline too", offering: "Included" },
  { text: "Progress they can see", offering: "Included" },
  { text: "Nutrition: meals, groceries, food diary", offering: "Optional tier", availability: ["nutrition"] },
  { text: "Sessions led in your voice", offering: "Add-on", availability: ["voice"] },
];

/**
 * "Proof you can check": what a visitor can verify for themselves. The
 * site publishes no testimonials, logos, ratings or counts it cannot show.
 * "#status" is the status panel on the same page.
 */
export const PROOF_LINKS: Array<{ label: string; href: string }> = [
  { label: "Try the demo", href: "/demo" },
  { label: "Every market figure sourced", href: "/methodology" },
  { label: "The commission maths", href: "/pricing#bands" },
  { label: "What works today", href: "#status" },
];

/**
 * What a trainer's AI never does: the Never sheet and the registry's
 * "never" bullets. Each line is a whole sentence that starts with "Never",
 * so it says the same wherever it is printed: the sheet sets the word apart,
 * llms-full.txt and the assistant facts print the line under any heading.
 * Each is enforced outside the AI: safety rules in code, the labelled
 * digital coach, workspace isolation.
 */
export const NEVER_LIST: string[] = [
  "Never hide pain or red flags from you.",
  "Never pretend to be you: subscribers see a labelled digital coach.",
  "Never give medical advice.",
  "Never use your teaching for anyone else: it’s private to your workspace.",
];
export const NEVER_NOTE =
  "Pain and red flags pause the workout and come to you. Enforced in code, outside the AI.";
