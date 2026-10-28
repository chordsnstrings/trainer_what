// The Brain showcases' options, from the platform facts
// (docs/marketing-revamp-2026-10-26/phase1/PLAN.md §1.5). The server render
// and the island receive the same object.
import { PUBLISH_GATES, gatesState } from "@trainer/contracts";
import type { Cta } from "../frame";
import type { PublicPlatform } from "../platform";
import type { ShowcaseMode, ShowcaseOptions } from "./engine/types";

/**
 * The options for every showcase on a page: the platform name, the page's
 * call to action (teachCta) and the flags from the platform's availability.
 * `extra` adds heading, labelledBy or attract; the name, the call to action
 * and the flags always come from the platform. Recovery stays off in phase 1
 * (the owner's default), whatever the platform says. While the AI model is
 * off, every specialist that uses it is not on yet (prepare()); nothing is
 * live for subscribers until trainers can publish (publish: every
 * PUBLISH_GATES gate on, sign-ups included, as the status panel reads them).
 */
export function showcaseOptions(
  platform: PublicPlatform,
  cta: Cta,
  extra?: Partial<ShowcaseOptions>,
): ShowcaseOptions {
  const a = platform.availability;
  return {
    ...extra,
    appName: platform.name,
    cta: { label: cta.label, href: cta.href },
    flags: {
      payments: a.payments,
      payouts: a.payouts,
      voice: a.voice,
      nutrition: a.nutrition,
      mealPhotos: a.mealPhotos,
      model: a.model,
      publish: gatesState(platform, PUBLISH_GATES) === true,
      recovery: false,
    },
  };
}

/**
 * The kill switch: MARKETING_SHOWCASE=static on the web service renders
 * every showcase as its still frame, with no engine. Read per request
 * (app/[[...path]]/page.tsx), so a restart applies it without a build.
 */
export function showcaseMode(value: string | undefined): ShowcaseMode {
  return value === "static" ? "static" : "live";
}
