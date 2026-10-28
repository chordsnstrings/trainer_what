// The demo page (docs/marketing-revamp-2026-10-26/phase1/PLAN.md WP5):
// concept A's /demo, where the playground is the demo. Every word around it
// comes from the /demo registry entry (packages/contracts/src/
// marketing-content.ts); the playground (brain/showcase.tsx) plays the
// sample moments of the Brain traces, starts with one moment on its own
// (attract) and carries its own honesty labels. It sits in the head's
// container, whose host the section reveal never touches (motion.tsx).
// Bands keep the house structure; the rest is app/marketing-brain-pages.css,
// under .mk-dm-.
import Link from "next/link";
import { ArrowRight } from "lucide-react";
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
        <Section section={moments} t={t} />
        <InShort page={page} t={t} />
        <Faqs page={page} t={t} heading="Demo questions" />
        <Related page={page} t={t} />
        <UpdatedLine page={page} />
      </div>
      <Closing cta={cta} platform={platform} secondary={closingLink(page)} />
    </>
  );
}
