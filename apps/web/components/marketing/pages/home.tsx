// The home page (docs/marketing-revamp-2026-10-26/phase1/PLAN.md WP4):
// concept A's "Live Brain" home in the house tokens. Every word comes from
// the "/" registry entry (packages/contracts/src/marketing-content.ts),
// apart from the labels of the sample mock-ups, the flow window's sample
// lines (the traces' own: the Brain showcases tell the same moments) and a
// few link labels. What is live follows the platform's flags (proof.tsx).
// The hero's first frame is the field, the band after it the board
// (brain/showcase.tsx); their bands carry .mk-sc-band, so the section
// reveal leaves them alone while the engine measures them. Every other band
// keeps the .mk-home-band > .mk-container.mk-home-inner structure, so the
// reveal (motion.tsx) and the band rhythm stay the sitewide ones; the rest
// is app/marketing-home.css, under .mk-hm-.
import Link from "next/link";
import { ArrowRight, Check, Lock, Minus, Play } from "lucide-react";
import type { ReactNode } from "react";
import {
  HOME_OFFER,
  PROOF_LINKS,
  REPLACES,
  marketingPage,
  marketingPageFor,
  type HomeOfferItem,
  type MarketingPage,
  type MarketingSection,
} from "@trainer/contracts";
import { BANDS } from "@trainer/domain";
import traces from "../brain/data/traces.client.json";
import { showcaseOptions } from "../brain/options";
import { BrainShowcase } from "../brain/showcase";
import type { RawBrainData, Trace } from "../brain/engine/types";
import { teachCta } from "../frame";
import { Walkthrough } from "../home-islands";
import { AddressPreview, FollowerCalculator } from "../islands";
import {
  Closing,
  Highlighted,
  closingLink,
  pageText,
  primaryCta,
  secondaryCta,
  type Ctx,
} from "../page-parts";
import type { PublicPlatform } from "../platform";
import {
  CtaMicro,
  EstimateLabel,
  NeverSheet,
  NotOnYet,
  SampleLabel,
  SourceBadge,
  StatusChip,
  StatusPanel,
} from "../proof";

const pad = (i: number) => String(i + 1).padStart(2, "0");
/** Whether every provider a line needs is on. */
const live = (platform: PublicPlatform, needs: readonly (keyof PublicPlatform["availability"])[] = []) =>
  needs.every((key) => platform.availability[key]);

/** The traces the Brain showcases play (brain/data): the flow window tells three of their moments. */
const SAMPLE = traces as unknown as RawBrainData;
const sample = (id: string) => SAMPLE.traces.find((t) => t.id.split("-")[0] === id)!;
/** The words a trace's subtitle quotes from the member ("a pop in my knee"). */
const quoted = (trace: Trace) => String(trace.subtitle).match(/“([^”]+)”/)![1];

/**
 * The ledger's bands as the share and its range of paying subscribers:
 * "25%" "first 100", "20%" "101–300", ... "10%" "1,001+".
 */
function homeBands(): Array<{ rate: string; range: string }> {
  const n = (v: number) => v.toLocaleString("en-GB");
  let from = 1;
  return BANDS.map((band) => {
    const open = !Number.isFinite(band.count);
    const range = open
      ? `${n(from)}+`
      : from === 1
        ? `first ${n(band.count)}`
        : `${n(from)}–${n(from + band.count - 1)}`;
    if (!open) from += band.count;
    return { rate: `${band.bps / 100}%`, range };
  });
}

/** "A website builder" → "Website builder": the tool categories as short names. */
const toolName = (tool: string) => tool.replace(/^An? /, "").replace(/^./, (c) => c.toUpperCase());

function sectionOf(page: MarketingPage, id: string): MarketingSection {
  const section = page.sections.find((s) => s.id === id);
  if (!section) throw new Error(`The home page has no "${id}" section`);
  return section;
}

/**
 * A full-width band, white or paper, labelled by its registry heading.
 * `rule` draws the line between two white bands; `showcase` marks a band
 * that holds a Brain showcase (.mk-sc-band: no reveal).
 */
function Band({
  section,
  tone,
  rule = false,
  showcase = false,
  className = "",
  children,
}: {
  section: MarketingSection;
  tone: "white" | "paper";
  rule?: boolean;
  showcase?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const classes = ["mk-home-band", "mk-home-" + tone, rule && "mk-hm-rule", showcase && "mk-sc-band", className];
  return (
    <section className={classes.filter(Boolean).join(" ")} id={section.id} aria-labelledby={section.id + "-h"}>
      <div className="mk-container mk-home-inner">{children}</div>
    </section>
  );
}

/** A band's heading and its first paragraph; `split` puts the paragraph beside it on wide screens. */
function BandHead({
  section,
  t,
  split = false,
}: {
  section: MarketingSection;
  t: (s: string) => string;
  split?: boolean;
}) {
  return (
    <div className={"mk-hm-head" + (split ? " mk-hm-head-split" : "")}>
      <h2 id={section.id + "-h"}>{t(section.heading)}</h2>
      {section.body?.[0] && <p className="mk-hm-lede">{t(section.body[0])}</p>}
    </div>
  );
}

function More({ href, children }: { href: string; children: ReactNode }) {
  return (
    <p className="mk-home-more">
      <Link className="text-link mk-link" href={href}>
        {children} <ArrowRight size={15} aria-hidden="true" />
      </Link>
    </p>
  );
}

/**
 * The H1 as concept A's two fixed lines on phones: the words up to the
 * highlight, then a break shown only below 761px, so a late font cannot
 * re-wrap the line above the field. One text block at every width: the
 * break adds no text, and the space after it shows only on wide screens.
 */
function HeroTitle({ text, mark }: { text: string; mark?: string }) {
  const at = mark ? text.indexOf(mark) : -1;
  if (!mark || at < 0) return <Highlighted text={text} mark={mark} />;
  const end = at + mark.length;
  return (
    <>
      <span className="mk-hm-l1">
        <Highlighted text={text.slice(0, end)} mark={mark} />
      </span>
      <br className="mk-hm-br" />
      <span className="mk-hm-l2">{text.slice(end)}</span>
    </>
  );
}

/**
 * What a subscriber gets, each with how it is offered: green while it is
 * available, otherwise the offering in grey and "Not on yet".
 */
function OfferChips({ item, platform }: { item: HomeOfferItem; platform: PublicPlatform }) {
  const on = live(platform, item.availability);
  return (
    <span className="mk-hm-offer-chips">
      {on ? <StatusChip on label={item.offering} /> : <span className="mk-pf-chip mk-hm-neutral">{item.offering}</span>}
      <NotOnYet on={on} />
    </span>
  );
}

/**
 * A sample subscriber app under the trainer's name (data-sample-ui: the
 * home word budget leaves it out). The address comes from the platform's
 * template, never a literal domain; chat shows while the AI is on and
 * meals while the nutrition tier is.
 */
function SamplePhone({ platform }: { platform: PublicPlatform }) {
  const address = platform.coachAddressTemplate.replace(/^https?:\/\//, "").replace("{slug}", "layla-strength");
  const { model, nutrition } = platform.availability;
  return (
    <figure className="mk-hm-sample" data-sample-ui>
      <div className="mk-hm-stage">
        <p className="mk-hm-url" aria-hidden="true">
          <Lock size={13} />
          <span className="ltr-data">{address}</span>
        </p>
        <div
          className="mk-hm-phone"
          role="img"
          aria-label={`Sample subscriber app for Layla Strength: today's workout saved for offline and squat progress from 50 to 62.5 kg${nutrition ? ", with meals logged" : ""}.`}
        >
          <div className="mk-hm-ph-status">
            <span>18:41</span>
            <i className="mk-hm-ph-island" />
          </div>
          <div className="mk-hm-ph-head">
            <span className="mk-hm-ph-av">LS</span>
            <span>Layla Strength</span>
            <span className="mk-hm-ph-tag">Sample</span>
          </div>
          <div className="mk-hm-ph-today">
            <p className="mk-hm-ph-date">Monday · Week 4</p>
            <p className="mk-hm-ph-title">Lower body, 45 min</p>
            <p className="mk-hm-ph-start">
              <span className="mk-hm-ph-play">
                <Play size={14} />
              </span>
              <span>
                <strong>Start workout</strong>
                <small>5 exercises · saved for offline</small>
              </span>
            </p>
            <div className="mk-hm-ph-progress">
              <p>
                <span>Squat</span>
                <span className="mk-hm-ph-mono">50 → 62.5 kg</span>
              </p>
              <svg viewBox="0 0 200 48" className="mk-hm-ph-spark" fill="none" stroke="currentColor" strokeLinejoin="round" strokeLinecap="round">
                <polyline points="2,44 34,40 66,34 98,30 130,22 162,16 198,6" strokeWidth={2} />
                <circle cx="198" cy="6" r="3.5" strokeWidth={1.6} style={{ fill: "var(--lime)" }} />
              </svg>
            </div>
            {nutrition && (
              <p className="mk-hm-ph-row">
                <span>Meals</span>
                <span className="mk-hm-ph-mono">3 of 4 logged</span>
              </p>
            )}
          </div>
          <p className="mk-hm-ph-tabs">
            <span className="mk-hm-ph-on">Today</span>
            <span>Plan</span>
            {model && <span>Chat</span>}
            <span>Progress</span>
          </p>
        </div>
        <p className="mk-hm-icon" aria-hidden="true">
          <span>LS</span>
          <small>Layla</small>
        </p>
      </div>
      <figcaption>
        <SampleLabel text="Sample trainer" />
      </figcaption>
    </figure>
  );
}

/**
 * How your AI decides, as a sample window: Omar's message from the field,
 * the rule it cites, then the three lanes with a moment from each (the
 * traces' own names and words; tests/marketing-home.test.ts holds them to
 * the traces).
 */
function FlowWindow() {
  const omar = sample("t1"),
    yousef = sample("t6"),
    noura = sample("t2");
  const lanes = SAMPLE.labels.lanes as Record<"sent" | "waits" | "paused", string>;
  const increase = (omar.inputs as { increaseKg: number }).increaseKg;
  const cap = (SAMPLE.settingsDefault.progression as { capPct: number }).capPct;
  const rows: Array<{ tone: "sent" | "waits" | "paused"; example: string }> = [
    { tone: "sent", example: `${omar.member} → your approved reply, +${increase} kg` },
    { tone: "waits", example: `${yousef.member}: “${quoted(yousef)}”` },
    { tone: "paused", example: `${noura.member}: “${quoted(noura)}”` },
  ];
  return (
    <figure className="mk-hm-window" data-sample-ui>
      <figcaption className="mk-hm-window-bar">
        <span>How your AI decides</span>
        <span className="mk-hm-window-meta">Sample</span>
      </figcaption>
      <div className="mk-hm-flow">
        <p className="mk-hm-flow-msg">
          <span className="mk-hm-flow-who">{omar.member}</span>
          <span className="mk-hm-bubble">{omar.trigger.text}</span>
        </p>
        <p className="mk-hm-flow-rule">
          <span className="mk-hm-rule-chip">
            <span className="mk-hm-rule-src">Your rule</span>
            <span className="mk-hm-rule-text">
              {String((omar.rule as { title: string }).title)} · +{increase} kg within your {cap}% cap
            </span>
          </span>
          <span className="mk-hm-flow-score">{String(SAMPLE.labels.noChatScore)}</span>
        </p>
        <ul className="mk-hm-lanes">
          {rows.map((row) => (
            <li key={row.tone} className={row.tone === "sent" ? "mk-hm-on" : undefined}>
              <span className="mk-hm-lane" data-tone={row.tone}>
                <span className="mk-hm-lane-dot" aria-hidden="true" />
                {lanes[row.tone]}
              </span>
              <span className="mk-hm-lane-ex">{row.example}</span>
              {row.tone === "sent" && (
                <span className="mk-hm-here">
                  <Check size={14} aria-hidden="true" />
                  This one
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </figure>
  );
}

/** The home page: the hero's field, then the bands of concept A in the registry's order. */
export function HomePage({ page, platform, showcase = "live" }: Ctx) {
  const t = pageText(platform);
  const cta = primaryCta(page, platform);
  const demo = secondaryCta(page);
  const options = showcaseOptions(platform, teachCta(platform.registrationOpen));
  const { payments, payouts } = platform.availability;
  const resort = sectionOf(page, "resort"),
    how = sectionOf(page, "how"),
    subscribers = sectionOf(page, "subscribers"),
    control = sectionOf(page, "control"),
    economics = sectionOf(page, "economics"),
    followers = sectionOf(page, "followers"),
    proof = sectionOf(page, "proof");
  // The walkthrough is the /how-it-works steps (their availability lines
  // included); publishing and getting paid wait for payments and payouts.
  const steps = sectionOf(marketingPageFor(marketingPage("/how-it-works")!, platform.availability), "steps").steps ?? [];
  const waits = new Set(payments && payouts ? [] : ["Publish and share", "Get paid monthly"]);
  const walk = steps.map((step) => ({
    title: t(step.title),
    body: t(step.body),
    flag: waits.has(step.title) ? <NotOnYet on={false} /> : undefined,
  }));
  const tools = REPLACES.map((r) => ({ name: toolName(r.tool), on: live(platform, r.availability) }));
  const template = platform.coachAddressTemplate.replace(/^https?:\/\//, "");
  const [lead, rest] = (control.body?.[0] ?? "").split(/(?<=^[^:]{1,40}:) /);
  return (
    <>
      <section className="mk-hero mk-hm-hero" aria-labelledby="mk-hero-h">
        {/* The first paint waits for the whole hero, the field's first frame
            included (React puts this in <head>; browsers without rel=expect
            ignore it): #mk-hero-end is the hero's last child. */}
        <link rel="expect" href="#mk-hero-end" blocking="render" />
        {/* One order for every reader: H1, field, lede, calls to action.
            Phones show it as it is; wide screens put the field in the
            second column with grid areas, never CSS order. */}
        <div className="mk-container mk-hm-hero-grid">
          <p className="eyebrow">{t(page.eyebrow)}</p>
          <h1 id="mk-hero-h">
            <HeroTitle text={t(page.h1)} mark={page.h1Highlight} />
          </h1>
          <div className="mk-hm-hero-media">
            <BrainShowcase kind="field" id="sc-field" label="A sample hour of your Brain" options={options} mode={showcase} />
          </div>
          {page.lede && <p className="mk-hero-lede">{t(page.lede)}</p>}
          <div className="button-row mk-hm-ctas">
            <Link className="button large mk-cta" href={cta.href}>
              {cta.label} <ArrowRight size={18} aria-hidden="true" />
            </Link>
            <Link className="button large secondary" href={demo.href}>
              {demo.label}
            </Link>
          </div>
          <CtaMicro registrationOpen={platform.registrationOpen} />
        </div>
        <span id="mk-hero-end" hidden />
      </section>

      <Band section={resort} tone="paper" showcase className="mk-hm-resort">
        <BandHead section={resort} t={t} split />
        <BrainShowcase
          kind="board"
          id="sc-board"
          label="Every sample moment, sorted by your settings"
          options={{ ...options, heading: false, labelledBy: resort.id + "-h" }}
          mode={showcase}
        />
        <More href="/demo">Throw a moment at your Brain</More>
      </Band>

      <Band section={how} tone="white">
        <BandHead section={how} t={t} />
        <ol className="mk-hm-steps">
          {how.steps?.map((step, i) => (
            <li key={step.title}>
              <span className="mk-hm-n">{pad(i)}</span>
              <h3>{t(step.title)}</h3>
              <p>{t(step.body)}</p>
            </li>
          ))}
        </ol>
        <div className="mk-hm-walk-wrap">
          <div className="mk-hm-walk-head">
            <p className="mk-hm-walk-label">Setup to payday · {walk.length} steps</p>
            <Link className="text-link mk-link" href="/how-it-works">
              See how it works <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </div>
          <Walkthrough steps={walk} label={`Setup to payday, ${walk.length} steps`} />
        </div>
      </Band>

      <Band section={subscribers} tone="white" rule>
        <div className="mk-hm-split mk-hm-flip">
          <div className="mk-hm-copy">
            <BandHead section={subscribers} t={t} />
            <ul className="mk-hm-offer">
              {HOME_OFFER.map((item) => (
                <li key={item.text}>
                  <span>{t(item.text)}</span>
                  <OfferChips item={item} platform={platform} />
                </li>
              ))}
            </ul>
            <div>
              <p className="mk-hm-brand">
                Your site, your app icon,{" "}
                <span className="ltr-data mk-hm-mono">{template.replace("{slug}", "your-name")}</span>.
              </p>
              {subscribers.note && <p className="mk-hm-note">{t(subscribers.note)}</p>}
            </div>
            <More href="/features">All features</More>
          </div>
          <div className="mk-hm-media">
            <SamplePhone platform={platform} />
          </div>
        </div>
      </Band>

      <Band section={control} tone="paper">
        <div className="mk-hm-split mk-hm-control">
          <div className="mk-hm-copy">
            <div className="mk-hm-head">
              <h2 id={control.id + "-h"}>{t(control.heading)}</h2>
              <p className="mk-hm-lede">
                {rest ? (
                  <>
                    <strong>{t(lead)}</strong> {t(rest)}
                  </>
                ) : (
                  t(lead)
                )}
              </p>
            </div>
            <NeverSheet />
            <More href="/trainer-brain">How your AI decides</More>
          </div>
          <div className="mk-hm-media">
            <FlowWindow />
          </div>
        </div>
      </Band>

      <Band section={economics} tone="white">
        <BandHead section={economics} t={t} split />
        <div className="mk-hm-econ">
          {/* What works today comes before any figure (PROOF_LINKS "#status"). */}
          <StatusPanel platform={platform} />
          <ol className="mk-hm-facts">
            {economics.bullets?.map((fact, i, all) => (
              <li key={fact}>
                <span className="mk-hm-n">{pad(i)}</span>
                <h3>{t(fact)}</h3>
                {/* The last fact, "Our share falls as you grow": the ledger's bands. */}
                {i === all.length - 1 && (
                  <>
                    <ul className="mk-hm-bands" aria-label="Our share by paying subscribers">
                      {homeBands().map((band) => (
                        <li key={band.rate}>
                          <b>{band.rate}</b> {band.range}
                        </li>
                      ))}
                    </ul>
                    {economics.note && <p className="mk-hm-note">{t(economics.note)}</p>}
                  </>
                )}
              </li>
            ))}
          </ol>
        </div>
        <div className="mk-hm-econ-lower">
          <div>
            <p className="mk-hm-tools-h">Tools it replaces</p>
            <ul className="mk-hm-tools">
              {[...tools.filter((tool) => tool.on), ...tools.filter((tool) => !tool.on)].map((tool) => (
                <li key={tool.name}>
                  {tool.on ? <Check size={15} aria-hidden="true" /> : <Minus size={15} aria-hidden="true" />}
                  <span>{tool.name}</span>
                  <NotOnYet on={tool.on} />
                </li>
              ))}
            </ul>
            <p className="mk-hm-note">Once your page is live.</p>
          </div>
          {/* The address preview only while sign-ups are open; .mk-econ
              gives its claim button the primary style (marketing.css). */}
          {platform.registrationOpen && (
            <div className="mk-econ">
              <AddressPreview template={template} />
              <p className="mk-hm-note">We’ll check it’s free in setup</p>
            </div>
          )}
        </div>
        <More href="/pricing">Pricing in detail</More>
      </Band>

      <Band section={followers} tone="paper">
        <BandHead section={followers} t={t} split />
        <p className="mk-hm-chips">
          <NotOnYet on={payments} what="subscriber payments" />
          <EstimateLabel />
          <SourceBadge id="revenuecat-state-2026" />
        </p>
        {/* The calculator is the follower calculator's own compact widget
            (islands.tsx); it shows no call to action, so the page adds one. */}
        <div className="mk-home-calc">
          <FollowerCalculator model={platform.followerModel} compact headingLevel={3} />
        </div>
        <div className="mk-hm-calc-foot">
          <div>
            <Link className="button mk-cta" href={cta.href}>
              {cta.label} <ArrowRight size={17} aria-hidden="true" />
            </Link>
            <CtaMicro registrationOpen={platform.registrationOpen} short />
          </div>
          <Link className="text-link mk-link" href="/follower-calculator">
            Open the full calculator <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </div>
      </Band>

      <Band section={proof} tone="white">
        <div className="mk-hm-split">
          <div className="mk-hm-head">
            <h2 id={proof.id + "-h"}>{t(proof.heading)}</h2>
          </div>
          <div>
            {proof.body?.[0] && <p className="mk-hm-lede">{t(proof.body[0])}</p>}
            <ul className="mk-hm-checks">
              {PROOF_LINKS.map((link) => (
                <li key={link.href}>
                  <Link href={link.href}>
                    {t(link.label)} <ArrowRight size={17} aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Band>

      {/* All answers start closed: the first is the answer-first
          introduction, in the page's HTML, the FAQPage JSON-LD and
          llms-full.txt. */}
      <section className="mk-home-band mk-home-white mk-hm-rule" id="faq" aria-labelledby="faq-h">
        <div className="mk-container mk-home-inner">
          <div className="mk-hm-split">
            <div className="mk-hm-head">
              <h2 id="faq-h">Questions trainers ask</h2>
              <More href="/faq">All questions</More>
            </div>
            <div className="mk-faqs">
              {page.faqs.map((f) => (
                <details key={f.q} className="mk-faq">
                  <summary>{t(f.q)}</summary>
                  <p>{t(f.a)}</p>
                </details>
              ))}
            </div>
          </div>
        </div>
      </section>

      <Closing cta={cta} platform={platform} secondary={closingLink(page)} />
    </>
  );
}
