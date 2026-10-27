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
 * "Live today / Not on yet" (the status panel and strip). Publishing waits
 * for both subscriber payments and payouts (the publish step in
 * apps/api/src/onboarding.ts needs a published offer and a payout account).
 */
export const STATUS_ITEMS: StatusItem[] = [
  { text: "Sign up free", offText: "New sign-ups (early access for now)", gates: ["registration"] },
  { text: "Set up your page and app" },
  { text: "Teach and test your AI" },
  { text: "Preview what subscribers will see" },
  {
    text: "Publish your page to subscribers",
    offText: "Publishing your page to subscribers",
    gates: ["payments", "payouts"],
  },
  { text: "Subscriber payments in AED", gates: ["payments"] },
  { text: "Payouts to a UAE bank", gates: ["payouts"] },
  { text: "Paid bookings", gates: ["payments"] },
  { text: "Voice add-on for subscribers", gates: ["voice"] },
];

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
 * "never" bullets. Each is enforced outside the AI: safety rules in code,
 * the labelled digital coach, workspace isolation.
 */
export const NEVER_LIST: string[] = [
  "Hide pain or red flags from you.",
  "Pretend to be you: subscribers see a labelled digital coach.",
  "Give medical advice.",
  "Use your teaching for anyone else: it stays private to your workspace.",
];
export const NEVER_NOTE =
  "Pain and red flags pause the workout and come to you. Enforced in code, outside the AI.";
