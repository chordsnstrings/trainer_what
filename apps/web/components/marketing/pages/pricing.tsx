// The pricing page (docs/marketing-revamp-2026-10-26/phase1/PLAN.md WP6):
// concept B's page in the house tokens. Every word comes from the /pricing
// registry entry (packages/contracts/src/marketing-content.ts), apart from
// the band labels, the sample statements and the calculators' own labels;
// every figure is the ledger's own: the bands from BANDS, each amount from
// estimateEarnings (packages/domain) and the lowest monthly price from
// MEMBERSHIP_MINIMUMS. What is live follows the platform's flags
// (proof.tsx), and the status strip comes before the first AED figure.
// The bands keep the home's structure (.mk-home-band > .mk-container
// .mk-home-inner), so the section reveal (motion.tsx) and the band rhythm
// are the same as on the home page; the rest is app/marketing-pricing.css,
// under .mk-pr-.
import Link from "next/link";
import { ArrowRight, Check, Info } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { MEMBERSHIP_MINIMUMS, type MarketingPage, type MarketingSection } from "@trainer/contracts";
import { BANDS } from "@trainer/domain";
import {
  DEFAULT_EARNINGS_INPUTS,
  aedWhole as aed,
  estimateEarnings,
} from "../../../../../packages/domain/src/marketing-calculators";
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
import { EstimateLabel, NotOnYet, SampleLabel, SourceBadge, StatusPanel, StatusStrip } from "../proof";
import { ShareSlider, TakeHome } from "../pricing-islands";

const whole = (n: number) => new Intl.NumberFormat("en-AE", { maximumFractionDigits: 0 }).format(n);
/** The lowest monthly price of a training membership, in whole dirhams. */
const MIN_PRICE_AED = MEMBERSHIP_MINIMUMS.training / 100;
/** The calculators' ranges, and the subscriber counts the share slider jumps to. */
const MAX_PRICE_AED = 999;
const MAX_SUBSCRIBERS = 1500;
const JUMPS = [100, 300, 1000, 1500];
/** The worked example: 150 paying subscribers at the lowest price, against an AED 250 session. */
export const PRICING_EXAMPLE = { subscribers: 150, priceAed: MIN_PRICE_AED, sessionRateAed: 250 };

/**
 * The published price anchors beside "An hour sells only once", each with
 * the sources behind it; the section's first paragraph states both ranges.
 */
export const PRICE_ANCHORS = [
  {
    label: "One-to-one session in Dubai",
    range: "AED 70–350",
    unit: "a session, sold once",
    sources: ["heytrainer-dubai-2026", "embody-dubai-2025"],
  },
  { label: "Online coaching in Dubai", range: "AED 400–2,000", unit: "a month", sources: ["369mmafit-online-2026"] },
];

/** The ledger's bands: where each starts and ends (null: open) and our share in it. */
function ledgerBands() {
  let from = 1;
  return BANDS.map((band) => {
    const open = !Number.isFinite(band.count);
    const row = { from, to: open ? null : from + band.count - 1, pct: band.bps / 100 };
    if (!open) from += band.count;
    return row;
  });
}

/** "301–1,000" for a range of numbers in registry text ("301-1,000"). */
const dashes = (text: string) => text.replace(/(\d)-(\d)/g, "$1–$2");

/** The example with the compact calculator's rule: one monthly price, no nutrition, voice or sessions. */
function workedExample() {
  return estimateEarnings({
    ...DEFAULT_EARNINGS_INPUTS,
    subscribers: PRICING_EXAMPLE.subscribers,
    billing: "monthly",
    workoutPriceAed: PRICING_EXAMPLE.priceAed,
    nutritionSharePct: 0,
    voiceSharePct: 0,
    sessionsPerMonth: 0,
    yourSessionRateAed: PRICING_EXAMPLE.sessionRateAed,
  });
}

/**
 * A full-width band: white, paper or the Pace wash. It carries its
 * registry section's id unless it holds several sections.
 */
function Band({
  section,
  tone,
  className = "",
  children,
}: {
  section?: MarketingSection;
  tone: "white" | "paper" | "wash";
  className?: string;
  children: ReactNode;
}) {
  const classes = `mk-home-band ${tone === "wash" ? "mk-pr-wash" : "mk-home-" + tone} ${className}`.trim();
  const inner = <div className="mk-container mk-home-inner">{children}</div>;
  return section ? (
    <section className={classes} id={section.id} aria-labelledby={section.id + "-h"}>
      {inner}
    </section>
  ) : (
    <div className={classes}>{inner}</div>
  );
}

/** A band's eyebrow, its registry heading and an optional lede. */
function BandHead({ id, eyebrow, heading, lede }: { id: string; eyebrow: string; heading: string; lede?: string }) {
  return (
    <div className="mk-pr-head">
      <p className="eyebrow">{eyebrow}</p>
      <h2 id={id + "-h"}>{heading}</h2>
      {lede && <p className="mk-pr-lede">{lede}</p>}
    </div>
  );
}

/** One row of a sample statement. */
function StatementRow({ label, value, kind }: { label: string; value: string; kind?: "sub" | "total" }) {
  return (
    <div className={kind ? "mk-pr-st-" + kind : undefined}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/**
 * Under every AED amount you keep while subscriber payments are off; it
 * invites the visitor to set up now only while sign-ups are open.
 */
function PaymentsNote({ registrationOpen }: { registrationOpen: boolean }) {
  return (
    <p className="mk-pr-note">
      <Info size={18} aria-hidden="true" />
      <span>
        Subscriber payments are not on yet.{registrationOpen ? " Set up and teach your AI now." : ""}
      </span>
    </p>
  );
}

/** Our share by band as falling stairs, from the ledger's bands. */
function Stairs() {
  const bands = ledgerBands();
  const top = bands[0].pct;
  const range = (b: (typeof bands)[number]) => (b.to === null ? `${whole(b.from)}+` : `${whole(b.from)}–${whole(b.to)}`);
  const said = bands
    .map((b, i) =>
      b.to === null
        ? `${b.pct}% above ${whole(b.from - 1)}`
        : `${b.pct}% for ${i === 0 ? "subscribers " : ""}${whole(b.from)} to ${whole(b.to)}`,
    )
    .join(", ");
  return (
    <figure className="mk-pr-stairs-card">
      <figcaption className="eyebrow">Our share falls as you grow</figcaption>
      <div className="mk-pr-stairs" role="img" aria-label={"Our share by band: " + said}>
        {bands.map((b) => (
          <div key={b.from} className="mk-pr-stair" style={{ "--pr-h": (b.pct / top) * 100 } as CSSProperties}>
            <b>{b.pct}%</b>
            <i />
            <span>{range(b)}</span>
          </div>
        ))}
      </div>
      <p className="mk-pr-fine">Each rate applies only to the subscribers in its band.</p>
    </figure>
  );
}

/** The worked example as a statement: 150 at the lowest price, band by band. */
function WorkedExample() {
  const e = workedExample();
  const price = "AED " + whole(PRICING_EXAMPLE.priceAed);
  return (
    <div className="mk-pr-statement">
      <div className="mk-pr-statement-head">
        <div>
          <p className="mk-pr-statement-title">Worked example</p>
          <p className="mk-pr-fine">
            {whole(PRICING_EXAMPLE.subscribers)} subscribers at {price}
          </p>
        </div>
        <SampleLabel text="Sample" />
      </div>
      <dl>
        <StatementRow label={`${whole(PRICING_EXAMPLE.subscribers)} × ${price}`} value={aed(e.subscriptionMonthlyMinor)} />
        {e.bands
          .filter((band) => band.subscribers > 0)
          .map((band) => (
            <StatementRow
              key={band.from}
              kind="sub"
              label={`Our share: ${whole(band.subscribers)} × ${band.ratePct}%`}
              value={"−" + aed(band.commissionMinor)}
            />
          ))}
        <StatementRow label="Commission in all" value={"−" + aed(e.commissionMinor)} />
        <StatementRow
          kind="total"
          label="You keep, before card processing and other costs"
          value={aed(e.beforeOtherCostsMinor)}
        />
      </dl>
      {e.equivalentSessions !== null && (
        <p className="mk-pr-fine">
          About {whole(e.equivalentSessions)} sessions at AED {whole(PRICING_EXAMPLE.sessionRateAed)}.
        </p>
      )}
    </div>
  );
}

/** A trainer's monthly statement with the example's figures; card processing is itemised, never a rate. */
function SampleStatement({ payments, payouts }: { payments: boolean; payouts: boolean }) {
  const e = workedExample();
  return (
    <div className="mk-pr-statement">
      <div className="mk-pr-statement-head">
        <div>
          <p className="mk-pr-statement-title">Monthly statement</p>
          <p className="mk-pr-fine">Layla Strength · October</p>
        </div>
        <div className="mk-pr-chips">
          <SampleLabel text="Sample" />
          <NotOnYet on={payments} what="subscriber payments" />
        </div>
      </div>
      <dl>
        <StatementRow
          label={`Subscriptions, ${whole(PRICING_EXAMPLE.subscribers)} × AED ${whole(PRICING_EXAMPLE.priceAed)}`}
          value={aed(e.subscriptionMonthlyMinor)}
        />
        <StatementRow label="Our share, by band" value={"−" + aed(e.commissionMinor)} />
        <StatementRow kind="sub" label="Card processing" value="Itemised" />
        <StatementRow kind="sub" label="Own domain (optional)" value={aed(0)} />
        <StatementRow kind="sub" label="Refunds and disputes" value={aed(0)} />
        <StatementRow
          kind="total"
          label="You keep, before card processing and other costs"
          value={aed(e.beforeOtherCostsMinor)}
        />
      </dl>
      <p className="mk-pr-fine">
        Sample statement. Payouts are monthly, to {payouts ? "your verified UAE IBAN." : "a verified UAE IBAN, once payouts are on."}
      </p>
    </div>
  );
}

/** One of the billing band's cards: a registry section with its own H2. */
function SectionCard({ section, t, children }: { section: MarketingSection; t: (s: string) => string; children?: ReactNode }) {
  return (
    <section className="mk-card" id={section.id} aria-labelledby={section.id + "-h"}>
      <h2 id={section.id + "-h"}>{t(section.heading)}</h2>
      {section.body?.map((p) => (
        <p key={p}>{t(p)}</p>
      ))}
      {!!section.bullets?.length && (
        <ul className="mk-pr-ticks">
          {section.bullets.map((b) => (
            <li key={b}>
              <Check size={16} aria-hidden="true" />
              <span>{t(b)}</span>
            </li>
          ))}
        </ul>
      )}
      {children}
    </section>
  );
}

/** The registry section with this id; a page without it fails loudly. */
function sectionOf(page: MarketingPage, id: string): MarketingSection {
  const section = page.sections.find((s) => s.id === id);
  if (!section) throw new Error(`${page.path} has no "${id}" section`);
  return section;
}

export function PricingPage({ page, platform }: Ctx) {
  const t = pageText(platform);
  const cta = primaryCta(page, platform);
  const { payments, payouts, voice, customDomains } = platform.availability;
  const [how, glance, bands, example, hours, statement, billing, payout, status] = [
    "how",
    "glance",
    "bands",
    "example",
    "hours",
    "statement",
    "billing",
    "payouts",
    "status",
  ].map((id) => sectionOf(page, id));
  const rates = BANDS.map((band) => band.bps / 100).join(" · ") + "%";
  return (
    <>
      <div className="mk-container mk-pr-hero">
        <Breadcrumbs page={page} t={t} />
        <div className="mk-pr-hero-grid">
          <PageHead page={page} platform={platform} t={t} cta={cta} secondary={secondaryCta(page)}>
            <StatusStrip platform={platform} />
          </PageHead>
          <Stairs />
        </div>
      </div>

      <Band section={glance} tone="white" className="mk-pr-rule">
        <BandHead id={glance.id} eyebrow="At a glance" heading={t(glance.heading)} />
        <div className="mk-cards mk-pr-glance">
          {glance.cards!.map((card) => (
            <article key={card.title} className={"mk-card" + (card.title === "What we take" ? " mk-pr-take" : "")}>
              <h3>{t(card.title)}</h3>
              {card.title === "What we take" && (
                <p className="mk-pr-rates" aria-hidden="true">
                  {rates}
                </p>
              )}
              <p>{t(card.body)}</p>
              {card.title === "Optional" && (!customDomains || !voice) && (
                <div className="mk-pr-chips">
                  <NotOnYet on={customDomains} what="your own domain" />
                  <NotOnYet on={voice} what="voice add-on" />
                </div>
              )}
            </article>
          ))}
        </div>
        {glance.body?.map((p) => (
          <p key={p} className="mk-pr-glance-line">
            {t(p)}
          </p>
        ))}
      </Band>

      <Band section={bands} tone="paper">
        <div className="mk-pr-split">
          <div className="mk-pr-stack">
            <BandHead id={bands.id} eyebrow="Commission" heading={t(bands.heading)} lede={bands.note && t(bands.note)} />
            {bands.table && (
              <div className="mk-pr-table-wrap">
                <table className="mk-pr-table">
                  <caption>{t(bands.table.caption)}</caption>
                  <thead>
                    <tr>
                      {bands.table.columns.map((c) => (
                        <th scope="col" key={c}>
                          {t(c)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {bands.table.rows.map(([first, ...rest]) => (
                      <tr key={first}>
                        <th scope="row">{dashes(t(first))}</th>
                        {rest.map((cell, i) => (
                          <td key={i}>{dashes(t(cell))}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="mk-pr-tool">
            <p className="eyebrow">Your blended rate</p>
            <ShareSlider priceAed={MIN_PRICE_AED} max={MAX_SUBSCRIBERS} initial={300} jumps={JUMPS} />
          </div>
        </div>
      </Band>

      <Band section={example} tone="wash">
        <div className="mk-pr-head-row">
          <BandHead id={example.id} eyebrow="Worked example" heading={t(example.heading)} lede={example.note && t(example.note)} />
          <NotOnYet on={payments} what="subscriber payments" />
        </div>
        <div className="mk-pr-split">
          <div className="mk-pr-stack">
            <WorkedExample />
            {!payments && <PaymentsNote registrationOpen={platform.registrationOpen} />}
          </div>
          <div className="mk-pr-stack">
            <div className="mk-pr-tool">
              <div className="mk-pr-tool-head">
                <p className="eyebrow">Try your numbers</p>
                <div className="mk-pr-chips">
                  <EstimateLabel />
                  <NotOnYet on={payments} what="subscriber payments" />
                </div>
              </div>
              <TakeHome
                minPriceAed={MIN_PRICE_AED}
                maxPriceAed={MAX_PRICE_AED}
                initialPrice={PRICING_EXAMPLE.priceAed}
                initialSubscribers={PRICING_EXAMPLE.subscribers}
                maxSubscribers={MAX_SUBSCRIBERS}
                sessionRateAed={PRICING_EXAMPLE.sessionRateAed}
              />
              {!payments && <PaymentsNote registrationOpen={platform.registrationOpen} />}
            </div>
            <Link className="text-link mk-link" href="/earnings-calculator">
              Add nutrition, voice and sessions <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </Band>

      <Band section={hours} tone="white">
        <div className="mk-pr-split mk-pr-center">
          <BandHead id={hours.id} eyebrow="Your hours" heading={t(hours.heading)} lede={hours.body?.[1] && t(hours.body[1])} />
          <figure className="mk-pr-anchors">
            {PRICE_ANCHORS.map((anchor) => (
              <div key={anchor.range} className="mk-pr-anchor">
                <span className="mk-pr-anchor-label">{anchor.label}</span>
                <span className="mk-pr-anchor-range">{anchor.range}</span>
                <span className="mk-pr-anchor-unit">
                  {anchor.unit}
                  {anchor.sources.map((id, i) => (
                    <SourceBadge key={id} id={id} label={anchor.sources.length > 1 ? `Source ${i + 1}` : "Source"} />
                  ))}
                </span>
              </div>
            ))}
            <figcaption>
              {hours.body?.[0] && <p>{t(hours.body[0])}</p>}
              {hours.note && <p className="mk-pr-fine">{t(hours.note)}</p>}
            </figcaption>
          </figure>
        </div>
      </Band>

      <Band section={statement} tone="paper">
        <div className="mk-pr-split mk-pr-center">
          <div className="mk-pr-stack">
            <BandHead id={statement.id} eyebrow="Your statement" heading={t(statement.heading)} />
            <ul className="mk-pr-ticks">
              {statement.bullets?.map((b) => (
                <li key={b}>
                  <Info size={18} aria-hidden="true" />
                  <span>{t(b)}</span>
                </li>
              ))}
            </ul>
          </div>
          <SampleStatement payments={payments} payouts={payouts} />
        </div>
      </Band>

      <Band tone="white">
        <div className="mk-cards mk-pr-cards">
          <SectionCard section={how} t={t} />
          <SectionCard section={billing} t={t}>
            <ul className="mk-pr-tags" aria-label="Billing options">
              {["Monthly", "Upfront", "Free trial days", "Promotion codes"].map((tag) => (
                <li key={tag}>{tag}</li>
              ))}
            </ul>
          </SectionCard>
          <SectionCard section={payout} t={t}>
            <NotOnYet on={payouts} what="payouts" />
          </SectionCard>
        </div>
      </Band>

      <Band section={status} tone="wash">
        <BandHead id={status.id} eyebrow="Status" heading={t(status.heading)} />
        <StatusPanel platform={platform} id="status-panel" />
        <p className="mk-pr-fine">Nothing goes live until you publish. We never promise a date we can’t keep.</p>
      </Band>

      <div className="mk-container mk-page mk-pr-end">
        <InShort page={page} t={t} />
        <Faqs page={page} t={t} heading="Pricing, answered" />
        <Related page={page} t={t} />
        <UpdatedLine page={page} />
      </div>
      <Closing cta={cta} platform={platform} secondary={closingLink(page)} />
    </>
  );
}
