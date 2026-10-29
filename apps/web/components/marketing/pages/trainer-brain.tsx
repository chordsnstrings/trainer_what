// The Trainer Brain page (docs/marketing-revamp-2026-10-26/phase1/PLAN.md
// WP5): concept A's page in the house tokens, with concept C's anatomy as
// "How it decides". Every claim comes from the /trainer-brain registry entry
// (packages/contracts/src/marketing-content.ts), the shared Never list
// (marketing-proof.ts) or the Brain traces (brain/data); the components add
// only labels and the sample controls' own lines (brain-page-islands.tsx),
// each marked as a sample. The anatomy and the playground are Brain
// showcases (brain/showcase.tsx) under the page's own headings; their bands
// carry .mk-sc-band, so the section reveal leaves them alone while the
// engine measures them. Every band keeps the house structure (.mk-home-band
// > .mk-container.mk-home-inner), so the reveal (motion.tsx) and the band
// rhythm are the home's; the rest is app/marketing-brain-pages.css, under
// .mk-tb-.
import Link from "next/link";
import { ArrowDown, ArrowRight, Check, Lock } from "lucide-react";
import type { ReactNode } from "react";
import type { MarketingPage, MarketingSection } from "@trainer/contracts";
import traces from "../brain/data/traces.client.json";
import { showcaseOptions } from "../brain/options";
import { Roster, type Crew } from "../brain/roster";
import { BrainShowcase } from "../brain/showcase";
import type { Lane, RawBrainData } from "../brain/engine/types";
import {
  CompareReplies,
  ReleaseTimeline,
  RuleLedger,
} from "../brain-page-islands";
import { teachCta } from "../frame";
import {
  Breadcrumbs,
  Closing,
  Faqs,
  InShort,
  PageHead,
  Related,
  UpdatedLine,
  closingLink,
  pageText,
  primaryCta,
  secondaryCta,
  type Ctx,
} from "../page-parts";
import { CtaMicro, NeverSheet, SampleLabel } from "../proof";

/** The lane names the showcases use (brain/data): the trace chain and the figure's key say the same. */
const LANES = (traces as unknown as RawBrainData).labels.lanes as Record<
  Lane,
  string
>;
/** A lane as a proof chip: sent green, waits amber, paused red. */
const LANE_CHIP: Partial<Record<Lane, string>> = {
  sent: "mk-pf-chip mk-pf-live",
  waits: "mk-pf-chip mk-pf-soon",
  paused: "mk-pf-chip mk-tb-paused",
};
/** The playground's host on this page. */
const PLAY = "sc-play";

export function sectionOf(page: MarketingPage, id: string): MarketingSection {
  const section = page.sections.find((s) => s.id === id);
  if (!section) throw new Error(`${page.path} has no "${id}" section`);
  return section;
}

/**
 * A full-width band, white or paper, labelled by its registry heading.
 * `showcase` marks a band that holds a Brain showcase (.mk-sc-band: no
 * reveal).
 */
export function Band({
  section,
  tone,
  showcase = false,
  className = "",
  children,
}: {
  section: MarketingSection;
  tone: "white" | "paper";
  showcase?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const classes = [
    "mk-home-band",
    "mk-home-" + tone,
    showcase && "mk-sc-band",
    className,
  ];
  return (
    <section
      className={classes.filter(Boolean).join(" ")}
      id={section.id}
      aria-labelledby={section.id + "-h"}
    >
      <div className="mk-container mk-home-inner">{children}</div>
    </section>
  );
}

/** A band's eyebrow, its registry heading and first paragraph; `children` follow them. */
export function BandHead({
  section,
  t,
  eyebrow,
  children,
}: {
  section: MarketingSection;
  t: (s: string) => string;
  eyebrow?: string;
  children?: ReactNode;
}) {
  return (
    <div className="mk-home-text">
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h2 id={section.id + "-h"}>{t(section.heading)}</h2>
      {section.body?.[0] && (
        <p className="mk-home-body">{t(section.body[0])}</p>
      )}
      {children}
    </div>
  );
}

/** The registry's lane bullets ("Training paused: …") as the lane, then what sends a moment there. */
function laneOf(bullet: string): { lane: Lane; name: string; rest: string } {
  const at = bullet.indexOf(": ");
  const name = bullet.slice(0, at);
  const lane = (Object.keys(LANES) as Lane[]).find((l) =>
    LANES[l].startsWith(name),
  );
  if (at < 0 || !lane)
    throw new Error(`/trainer-brain decides: "${bullet}" names no lane`);
  return { lane, name, rest: bullet.slice(at + 2) };
}

/**
 * One sample decision traced back to what the trainer taught: the change,
 * the rule it applied, where the rule came from and the release it is in
 * (concept A's "What it is"). It is the traces' "Squats felt easy" (the
 * anatomy's moment): the same jump under the same rule and limits.
 */
function TraceChain() {
  const steps: Array<{ key: string; value: ReactNode }> = [
    {
      key: "Decision",
      value: (
        <>
          Mon · Back squat <code>60 → 62.5 kg</code>{" "}
          <span className={LANE_CHIP.sent}>{LANES.sent}</span>
        </>
      ),
    },
    {
      key: "Your rule",
      value: <code>Every set at 2+ RIR → +2.5 kg, up to 5%</code>,
    },
    {
      key: "Source",
      value:
        "Interview · 12 Oct · “If every set leaves two reps in reserve, I add a small jump.”",
    },
    {
      key: "Release",
      value: (
        <>
          <code>v4</code> · checked against your test cases
        </>
      ),
    },
  ];
  return (
    <figure className="mk-tb-stack" data-sample-ui>
      <ol
        className="mk-tb-stack mk-tb-trace"
        aria-label="One decision traced to its source"
      >
        {steps.map((step) => (
          <li key={step.key} className="mk-tb-box mk-tb-row">
            <span className="mk-tb-mono">{step.key}</span>
            <span>{step.value}</span>
          </li>
        ))}
      </ol>
      <figcaption>
        <SampleLabel text="Sample trainer" />
      </figcaption>
    </figure>
  );
}

/** The tag over each way of teaching: the kind of source a rule keeps. */
const TEACH_SOURCE: Record<string, string> = {
  "A guided interview": "Interview",
  "Rules you confirm": "Rule",
  "Cases and examples": "Case",
  "Your documents": "Document",
  "The practice quiz": "Quiz",
};

/** The Trainer Brain page: the rule ledger, then concept A's bands in the registry's order. */
export function TrainerBrainPage({ page, platform, showcase = "live" }: Ctx) {
  const t = pageText(platform);
  const cta = primaryCta(page, platform);
  const options = showcaseOptions(
    platform,
    teachCta(platform.registrationOpen),
  );
  const [what, inside, decides, play, teach, learns, never, yours] = [
    "what",
    "inside",
    "decides",
    "play",
    "teach",
    "learns",
    "never",
    "yours",
  ].map((id) => sectionOf(page, id));
  const crews: Crew[] = (inside.cards ?? []).map((card) => ({
    id: card.title.toLowerCase() as Crew["id"],
    title: t(card.title),
    label: card.label && t(card.label),
    body: t(card.body),
  }));
  return (
    <>
      <div className="mk-container mk-page mk-tb-hero">
        {/* As on the home page: the first paint waits for the whole hero,
            so the page head (centred beside the ledger) never paints
            beside a half-parsed ledger and then moves. */}
        <link rel="expect" href="#mk-tb-hero-end" blocking="render" />
        <Breadcrumbs page={page} t={t} />
        <div className="mk-home-inner mk-home-split">
          <PageHead
            page={page}
            platform={platform}
            t={t}
            cta={cta}
            secondary={secondaryCta(page)}
          >
            <CtaMicro registrationOpen={platform.registrationOpen} />
          </PageHead>
          <figure className="mk-tb-stack" data-sample-ui>
            <div className="mk-tb-stack mk-tb-stage">
              <RuleLedger />
            </div>
            <figcaption>
              <SampleLabel text="Sample trainer · try Confirm, Edit or Reject" />
            </figcaption>
          </figure>
        </div>
        <span id="mk-tb-hero-end" hidden />
      </div>

      <Band section={what} tone="paper">
        <div className="mk-home-inner mk-home-split">
          <BandHead section={what} t={t} eyebrow="What it is" />
          <TraceChain />
        </div>
      </Band>

      <Band section={inside} tone="white">
        <BandHead section={inside} t={t} eyebrow="Inside your AI">
          {inside.body?.[1] && (
            <p className="mk-home-body">
              <strong>{t(inside.body[1])}</strong>
            </p>
          )}
        </BandHead>
        <Roster
          crews={crews}
          options={options}
          play={play.id}
          howWeCount={t(inside.note ?? "")}
        />
      </Band>

      <Band section={decides} tone="paper" showcase>
        <BandHead section={decides} t={t} eyebrow="How it decides">
          <p className="mk-home-more">
            <a className="text-link mk-link" href={"#" + play.id}>
              Skip the figure <ArrowDown size={15} aria-hidden="true" />
            </a>
          </p>
        </BandHead>
        <BrainShowcase
          kind="anatomy"
          id="sc-anatomy"
          label={t(decides.heading)}
          options={{
            ...options,
            heading: false,
            labelledBy: decides.id + "-h",
          }}
          mode={showcase}
        />
        {/* The figure's key: the three lanes a moment ends in. */}
        <ul className="mk-tb-list">
          {(decides.bullets ?? []).map((bullet) => {
            const { lane, name, rest } = laneOf(t(bullet));
            return (
              <li key={bullet}>
                <span className={LANE_CHIP[lane]}>{name}</span> {rest}
              </li>
            );
          })}
        </ul>
      </Band>

      <Band section={play} tone="white" showcase>
        <BandHead section={play} t={t} />
        <BrainShowcase
          kind="play"
          id={PLAY}
          label={t(play.heading)}
          options={{ ...options, heading: false, labelledBy: play.id + "-h" }}
          mode={showcase}
        />
      </Band>

      <Band section={teach} tone="paper">
        <BandHead section={teach} t={t} eyebrow="Teaching" />
        <div className="mk-cards">
          {teach.cards?.map((card) => (
            <article className="mk-card" key={card.title}>
              {TEACH_SOURCE[card.title] && (
                <span className="badge">{TEACH_SOURCE[card.title]}</span>
              )}
              <h3>{t(card.title)}</h3>
              <p>{t(card.body)}</p>
            </article>
          ))}
        </div>
      </Band>

      <Band section={learns} tone="white">
        <div className="mk-home-inner mk-home-split mk-tb-top">
          <BandHead section={learns} t={t} eyebrow="Learning">
            <ul className="mk-list">
              {learns.bullets?.map((bullet) => (
                <li key={bullet}>
                  <Check size={16} aria-hidden="true" />
                  <span>{t(bullet)}</span>
                </li>
              ))}
            </ul>
            <p className="mk-home-more">
              <Link
                className="text-link mk-link"
                href="/guides/writing-coaching-rules"
              >
                Writing coaching rules{" "}
                <ArrowRight size={15} aria-hidden="true" />
              </Link>
            </p>
          </BandHead>
          <div className="mk-tb-stack">
            <ReleaseTimeline />
            <CompareReplies />
          </div>
        </div>
      </Band>

      <div className="mk-home-band mk-home-paper">
        <div className="mk-container mk-home-inner">
          <div className="mk-cards">
            <section id={never.id} aria-labelledby={never.id + "-h"}>
              <NeverSheet
                title={t(never.heading)}
                headingLevel={2}
                id={never.id + "-h"}
              />
            </section>
            {/* The Never sheet's card, for what stays the trainer's. */}
            <section
              id={yours.id}
              aria-labelledby={yours.id + "-h"}
              className="mk-pf-never mk-tb-stack"
            >
              <h2 className="mk-pf-never-title" id={yours.id + "-h"}>
                {t(yours.heading)}
              </h2>
              <ul className="mk-list">
                {yours.bullets?.map((bullet) => (
                  <li key={bullet}>
                    <Lock size={16} aria-hidden="true" />
                    <span>{t(bullet)}</span>
                  </li>
                ))}
              </ul>
              <p className="mk-home-more">
                <Link
                  className="text-link mk-link"
                  href="/security-and-privacy"
                >
                  Security and privacy{" "}
                  <ArrowRight size={15} aria-hidden="true" />
                </Link>
              </p>
            </section>
          </div>
        </div>
      </div>

      <div className="mk-container mk-page">
        <InShort page={page} t={t} />
        <Faqs page={page} t={t} heading="Questions about your AI" />
        <Related page={page} t={t} />
        <UpdatedLine page={page} />
      </div>
      <Closing cta={cta} platform={platform} secondary={closingLink(page)} />
    </>
  );
}
