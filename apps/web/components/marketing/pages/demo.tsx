// The demo page (docs/marketing-revamp-2026-10-26/phase1/PLAN.md WP5):
// concept A's /demo, where the playground is the demo. Every word around it
// comes from the /demo registry entry (packages/contracts/src/
// marketing-content.ts), apart from the sample moments' outcomes, which
// come from the traces with the page's flags (momentLines); the playground
// (brain/showcase.tsx) plays the sample moments of the Brain traces, starts
// with one moment on its own (attract) and carries its own honesty labels.
// It sits in the head's container, whose host the section reveal never
// touches (motion.tsx). Bands keep the house structure; the rest is
// app/marketing-brain-pages.css, under .mk-dm-.
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import raw from "../brain/data/traces.client.json";
import { prepare } from "../brain/engine/data.js";
import { decide, defaults } from "../brain/engine/decide.js";
import type { Lane, RawBrainData, ShowcaseOptions } from "../brain/engine/types";
import { showcaseOptions } from "../brain/options";
import { BrainShowcase } from "../brain/showcase";
import { teachCta } from "../frame";
import {
  Breadcrumbs,
  Closing,
  Faqs,
  InShort,
  PageHead,
  Related,
  Section,
  UpdatedLine,
  closingLink,
  pageText,
  primaryCta,
  secondaryCta,
  type Ctx,
} from "../page-parts";
import { CtaMicro } from "../proof";
import { Band, BandHead, sectionOf } from "./trainer-brain";

/** How a moment ends, as the moments section says it: one moment, then several. */
const OUTCOME: Record<Lane | "off", [string, string]> = {
  sent: ["is sent on its own, within your rules", "are sent on their own, within your rules"],
  waits: ["waits for you", "wait for you"],
  paused: ["pauses training", "pause training"],
  member: ["asks the member to confirm", "ask the member to confirm"],
  learn: ["suggests a new rule", "suggest a new rule"],
  off: ["is not on yet", "are not on yet"],
};
/** “A”, “B” and “C”. */
function quoted(chips: string[]) {
  const q = chips.map((chip) => `“${chip}”`);
  return q.length > 1 ? `${q.slice(0, -1).join(", ")} and ${q[q.length - 1]}` : q[0];
}
/**
 * The sample moments' outcomes, as the playground plays them on this page:
 * each moment's lane with the sample settings (decide()), or "not on yet"
 * while what it needs is off (its status from prepare() and the page's
 * flags). Two paragraphs: the moments that reply or wait, then the rest.
 */
export function momentLines(options: Pick<ShowcaseOptions, "appName" | "flags">): string[] {
  const d = prepare(raw as unknown as RawBrainData, options);
  const settings = defaults(d);
  const chips = new Map<Lane | "off", string[]>();
  for (const trace of d.traces) {
    const outcome = trace.status === "not_on_yet" ? "off" : decide(trace, settings, d).lane;
    chips.set(outcome, [...(chips.get(outcome) ?? []), trace.chip]);
  }
  const say = (outcomes: Array<Lane | "off">) =>
    outcomes.flatMap((o) => {
      const list = chips.get(o);
      return list ? [`${quoted(list)} ${OUTCOME[o][list.length > 1 ? 1 : 0]}.`] : [];
    });
  const paragraphs = [say(["sent", "waits"]), say(["paused", "member", "learn", "off"])]
    .filter((sentences) => sentences.length > 0)
    .map((sentences) => sentences.join(" "));
  paragraphs[0] = "With the sample settings, " + paragraphs[0];
  return paragraphs;
}

/** The demo page: the head, the playground, what happens in an account, then the sample moments. */
export function DemoPage({ page, platform, showcase = "live" }: Ctx) {
  const t = pageText(platform);
  const cta = primaryCta(page, platform);
  const options = showcaseOptions(
    platform,
    teachCta(platform.registrationOpen),
    { heading: false, attract: true },
  );
  const next = sectionOf(page, "next"),
    moments = sectionOf(page, "moments");
  return (
    <>
      <div className="mk-container mk-page mk-dm-hero">
        <Breadcrumbs page={page} t={t} />
        <PageHead
          page={page}
          platform={platform}
          t={t}
          cta={cta}
          secondary={secondaryCta(page)}
        >
          <CtaMicro registrationOpen={platform.registrationOpen} />
        </PageHead>
        {/* The page's H1 names the playground. */}
        <BrainShowcase
          kind="play"
          id="sc-play"
          label={t(page.h1)}
          options={options}
          mode={showcase}
        />
      </div>

      <Band section={next} tone="paper">
        <BandHead section={next} t={t} eyebrow="After you join" />
        <ol className="mk-steps">
          {next.steps?.map((step, i) => (
            <li key={step.title}>
              <span className="mk-step-number" aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div>
                <h3>{t(step.title)}</h3>
                <p>{t(step.body)}</p>
              </div>
            </li>
          ))}
        </ol>
        <div>
          <Link className="button large mk-cta" href={cta.href}>
            {cta.label} <ArrowRight size={17} aria-hidden="true" />
          </Link>
          <CtaMicro registrationOpen={platform.registrationOpen} short />
        </div>
      </Band>

      <div className="mk-container mk-page mk-dm-end">
        <Section section={{ ...moments, body: momentLines(options) }} t={t} />
        <InShort page={page} t={t} />
        <Faqs page={page} t={t} heading="Demo questions" />
        <Related page={page} t={t} />
        <UpdatedLine page={page} />
      </div>
      <Closing cta={cta} platform={platform} secondary={closingLink(page)} />
    </>
  );
}
