// Server-rendered public marketing pages. Every word comes from the registry
// in packages/contracts (marketing-content.ts), so the visible text, the
// JSON-LD and llms-full.txt agree. Interactive parts are small client islands.
import Link from "next/link";
import {
  Apple,
  ArrowRight,
  CalendarCheck,
  CalendarDays,
  Check,
  CheckCircle,
  CircleAlert,
  Dumbbell,
  MessageCircle,
  TrendingUp,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  BRAND_COPY,
  OFFERED_DIRECTORY_SPECIALTIES,
  MARKETING_PAGES,
  MARKETING_SOURCES,
  SETUP_CHECKLIST,
  brandText,
  jsonLdScript,
  marketingBreadcrumbs,
  marketingJsonLd,
  marketingPage,
  sourceById,
  usesBrandIdentity,
  type MarketingPage,
  type MarketingSection,
} from "@trainer/contracts";
import { BANDS } from "@trainer/domain";
import {
  aedWhole as aed,
  DEFAULT_FOLLOWER_INPUTS,
  FOLLOWER_SCENARIOS,
  displayCount,
  estimateEarnings,
  estimateFollowerConversion,
  followerModelAdjustments,
  type FollowerRateKey,
  type FollowerScenario,
} from "../../../../packages/domain/src/marketing-calculators";
import { claimCta, MarketingFooter, MarketingHeader, type Cta } from "./frame";
import {
  AddressPreview,
  DemoScenarios,
  EarlyAccessForm,
  EarningsCalculator,
  FollowerCalculator,
} from "./islands";
import { availabilityChip, Chip } from "./chip";
import { HeroFlow } from "./hero-flow";
import { Journey, JourneyBand, journeyAvailable } from "./journey";
import { MarketingMotion } from "./motion";
import type { PublicPlatform } from "./platform";
import {
  FeatureMatrix,
  IncludedStrip,
  ProductScreens,
  Replaces,
} from "./showcase";
export { availabilityChip };

type Ctx = { page: MarketingPage; platform: PublicPlatform; origin: string };
const dateLabel = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Dubai",
  }).format(new Date(iso + "T12:00:00Z"));

/** The CTA a page shows, following whether registration is open. */
function primaryCta(page: MarketingPage, platform: PublicPlatform): Cta {
  const claim = claimCta(platform.registrationOpen);
  if (!page.cta || page.cta.href === "/signup")
    return page.cta && platform.registrationOpen ? page.cta : claim;
  return page.cta;
}
function secondaryCta(page: MarketingPage): Cta {
  return page.path === "/follower-calculator"
    ? { label: "Estimate my earnings", href: "/earnings-calculator" }
    : { label: "Estimate what your followers are worth", href: "/follower-calculator" };
}

function SourceNote({ ids }: { ids?: string[] }) {
  const sources = (ids ?? []).map(sourceById).filter((s) => !!s);
  if (!sources.length) return null;
  return (
    <p className="mk-sources fine-print">
      Sources:{" "}
      {sources.map((s, i) => (
        <span key={s!.id}>
          {i > 0 && " · "}
          <a href={s!.url} rel="noopener" target="_blank">
            {s!.publisher}
            {s!.published ? `, ${s!.published}` : ""}
          </a>{" "}
          (<Link href={"/methodology#" + s!.id}>how we use it</Link>)
        </span>
      ))}
    </p>
  );
}

export function Section({
  section,
  t,
  headingLevel = 2,
}: {
  section: MarketingSection;
  t: (s: string) => string;
  headingLevel?: 2 | 3;
}) {
  const H = headingLevel === 2 ? "h2" : "h3";
  return (
    <section className="mk-section" id={section.id} aria-labelledby={section.id + "-h"}>
      <H id={section.id + "-h"}>{t(section.heading)}</H>
      {section.body?.map((p) => (
        <p key={p} className="mk-body">
          {t(p)}
        </p>
      ))}
      {!!section.bullets?.length && (
        <ul className="mk-list">
          {section.bullets.map((b) => (
            <li key={b}>
              <Check size={16} aria-hidden="true" />
              <span>{t(b)}</span>
            </li>
          ))}
        </ul>
      )}
      {!!section.cards?.length && (
        <div className="mk-cards">
          {section.cards.map((c) => (
            <article className="mk-card" key={c.title}>
              {c.label && <span className="badge">{t(c.label)}</span>}
              <h3>{t(c.title)}</h3>
              <p>{t(c.body)}</p>
            </article>
          ))}
        </div>
      )}
      {!!section.steps?.length && (
        <ol className="mk-steps">
          {section.steps.map((s, i) => (
            <li key={s.title}>
              <span className="mk-step-number" aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div>
                <h3>{t(s.title)}</h3>
                <p>{t(s.body)}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
      {section.table && (
        <div className="mk-table-wrap">
          <table className="mk-table">
            <caption>{t(section.table.caption)}</caption>
            <thead>
              <tr>
                {section.table.columns.map((c) => (
                  <th scope="col" key={c}>
                    {t(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {section.table.rows.map((row) => (
                <tr key={row.join("|")}>
                  {row.map((cell, i) => (
                    <td key={i}>{t(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {section.note && <p className="fine-print muted">{t(section.note)}</p>}
      <SourceNote ids={section.sources} />
    </section>
  );
}

function Faqs({
  page,
  t,
  heading = "Frequently asked questions",
}: {
  page: MarketingPage;
  t: (s: string) => string;
  heading?: string;
}) {
  if (!page.faqs.length) return null;
  return (
    <section className="mk-section mk-faqs" id="faq" aria-labelledby="faq-h">
      <h2 id="faq-h">{heading}</h2>
      {page.faqs.map((f) => (
        <details key={f.q} className="mk-faq">
          <summary>{t(f.q)}</summary>
          <p>{t(f.a)}</p>
        </details>
      ))}
    </section>
  );
}

function Related({ page, t }: { page: MarketingPage; t: (s: string) => string }) {
  const links = page.related
    .map((path) =>
      path === "/coaches"
        ? { path, label: "Find a coach" }
        : marketingPage(path)
          ? { path, label: marketingPage(path)!.navLabel }
          : null,
    )
    .filter((l) => !!l);
  if (!links.length) return null;
  return (
    <nav className="mk-related" aria-label="Related pages">
      <p className="eyebrow">RELATED</p>
      <ul>
        {links.map((l) => (
          <li key={l!.path}>
            <Link href={l!.path}>
              {t(l!.label)} <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Breadcrumbs({ page, t }: { page: MarketingPage; t: (s: string) => string }) {
  const crumbs = marketingBreadcrumbs(page);
  return (
    <nav className="mk-breadcrumbs" aria-label="Breadcrumb">
      <ol>
        {crumbs.map((c, i) => (
          <li key={c.path}>
            {i === crumbs.length - 1 ? (
              <span aria-current="page">{t(c.label)}</span>
            ) : (
              <Link href={c.path}>{t(c.label)}</Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * The closing panel on every marketing page: a contained Pace panel with ink
 * text and an ink button. The brand line is its heading on the trainsyou
 * platform; a renamed platform asks the call to action instead.
 */
function Closing({
  cta,
  platform,
  secondary,
}: {
  cta: Cta;
  platform: PublicPlatform;
  secondary: Cta;
}) {
  return (
    <div className="mk-container mk-closing-wrap">
      <section className="mk-closing" aria-labelledby="mk-closing-h">
        <h2 id="mk-closing-h">
          {usesBrandIdentity(platform.name) ? BRAND_COPY.line : "Ready to teach your AI?"}
        </h2>
        <p>Guided setup. Nothing goes live until you publish.</p>
        <div className="button-row">
          <Link className="button large mk-closing-cta" href={cta.href}>
            {cta.label} <ArrowRight size={17} aria-hidden="true" />
          </Link>
          <Link className="text-link mk-link" href={secondary.href}>
            {secondary.label} <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </div>
      </section>
    </div>
  );
}
const HOW_IT_WORKS: Cta = { label: "See how it works", href: "/how-it-works" };
/** The closing panel's second link: the follower estimate, or how it works. */
function closingLink(path: string): Cta {
  return path === "/" || path === "/follower-calculator"
    ? HOW_IT_WORKS
    : { label: "What are my followers worth?", href: "/follower-calculator" };
}

/**
 * The Pace highlight on part of a heading; the text itself is unchanged. A
 * span, not <mark>: the emphasis is decorative, and screen readers can
 * announce <mark> as "highlight" in the middle of the H1.
 */
function Highlighted({ text, mark }: { text: string; mark?: string }) {
  const at = mark ? text.indexOf(mark) : -1;
  if (!mark || at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <span className="mk-mark">{mark}</span>
      {text.slice(at + mark.length)}
    </>
  );
}

/**
 * The commission bands as short labels, from the ledger's own bands. The
 * list is labelled "Commission by paying subscriber", so the ranges count
 * paying subscribers: "25% · first 100", "20% · 101–300", ...
 */
export function bandPills(): string[] {
  const n = (v: number) => v.toLocaleString("en-GB");
  let from = 1;
  return BANDS.map((band) => {
    const range = !Number.isFinite(band.count)
      ? `${n(from)}+`
      : from === 1
        ? `first ${n(band.count)}`
        : `${n(from)}–${n(from + band.count - 1)}`;
    from += band.count;
    return `${band.bps / 100}% · ${range}`;
  });
}

/** A grid of child pages (hubs and the home feature grid). */
function PageTiles({
  pages,
  platform,
  t,
  withChips = false,
}: {
  pages: MarketingPage[];
  platform: PublicPlatform;
  t: (s: string) => string;
  withChips?: boolean;
}) {
  return (
    <ul className="mk-tiles">
      {pages.map((p) => (
        <li key={p.path}>
          <Link href={p.path} className="mk-tile">
            <span className="mk-tile-head">
              <strong>{t(p.navLabel)}</strong>
              {withChips && <Chip chip={availabilityChip(p, platform.availability)} />}
            </span>
            <span className="muted">{t(p.description)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
const childrenOf = (path: string) =>
  MARKETING_PAGES.filter((p) => p.parent === path && p.indexable);

/** Three example accounts in the strong case, computed live from the assumptions in use. */
function FollowerExamples({ platform }: { platform: PublicPlatform }) {
  const accounts = [3000, 7000, 30000];
  const whole = (n: number) => n.toLocaleString("en-AE");
  const count = (n: number) => {
    const c = displayCount(n);
    return c === null ? "< 1" : whole(c);
  };
  return (
    <div className="mk-table-wrap">
      <table className="mk-table">
        <caption>
          Strong case, a best case for an engaged, growing audience and not a
          typical result: AED 199 a month, 8 link Stories and 4 keyword Reels
          a month, 30% yearly cancellations (assumptions version{" "}
          {platform.followerModel.version})
        </caption>
        <thead>
          <tr>
            <th scope="col">Followers</th>
            <th scope="col">New subscribers, first month</th>
            <th scope="col">Active after 12 months</th>
            <th scope="col">Sign-ups over 12 months</th>
            <th scope="col">A month at month 12</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((followers) => {
            const e = estimateFollowerConversion(
              { ...DEFAULT_FOLLOWER_INPUTS, followers },
              platform.followerModel,
            ).scenarios.strong;
            return (
              <tr key={followers}>
                <td>{whole(followers)}</td>
                <td>{count(e.month1New)}</td>
                <td>{count(e.activeMonth12)}</td>
                <td>{count(e.signups12)}</td>
                <td>{aed(e.revenueMonth12Minor)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** A worked example computed with the same function as the calculator. */
function WorkedExample() {
  const e = estimateEarnings({
    subscribers: 150,
    billing: "monthly",
    workoutPriceAed: 199,
    programmeMonths: 1,
    nutritionSharePct: 0,
    nutritionPriceAed: 0,
    voiceSharePct: 0,
    voicePriceAed: 0,
    sessionsPerMonth: 0,
    sessionPriceAed: 0,
    yourSessionRateAed: 250,
  });
  return (
    <div className="mk-example card">
      <p className="eyebrow">WORKED EXAMPLE</p>
      <p>
        150 paying subscribers at AED 199 a month:{" "}
        <strong>{aed(e.subscriptionMonthlyMinor)}</strong> in subscriptions.
        Commission is {aed(e.bands[0].commissionMinor)} (25% on the first 100)
        plus {aed(e.bands[1].commissionMinor)} (20% on the next 50):{" "}
        <strong>{aed(e.commissionMinor)}</strong>. That leaves{" "}
        <strong>{aed(e.beforeOtherCostsMinor)}</strong> before payment
        processing and other costs, about {e.equivalentSessions}{" "}
        sessions at AED 250.
      </p>
      <p className="fine-print muted">
        An arithmetic example, not a forecast or promise.
      </p>
    </div>
  );
}

const SCENARIO_NAMES: Record<FollowerScenario, string> = {
  cautious: "Cautious",
  typical: "Typical",
  strong: "Strong case",
};
/** One rate row on /methodology: the per-scenario values and their basis. */
const RATE_ROWS: Array<{
  key: FollowerRateKey;
  label: string;
  basis: string;
  sources: Array<[string, string]>;
}> = [
  {
    key: "linkClickPct",
    label: "Link-sticker click, per viewer per link Story",
    basis: "Creator reports 1-5%, no industry benchmark (rule of thumb); IQFluence median 4.1%, strong creators 6-7% (vendor data)",
    sources: [["creatorflow-link-sticker", "Creatorflow"], ["iqfluence-story-links", "IQFluence"]],
  },
  {
    key: "dmOpenPct",
    label: "Keyword commenters who open the DM link",
    basis: "Vendor claims, no dataset",
    sources: [["communipass-auto-dm", "CommuniPass"], ["chatautodm-2026", "ChatAutoDM"]],
  },
  {
    key: "broadcastClickPct",
    label: "Broadcast members who open one link message",
    basis: "Email click medians for sports, health and fitness, all industries (measured; used as a proxy)",
    sources: [["mailerlite-benchmarks", "MailerLite"]],
  },
  {
    key: "bioClickPct",
    label: "Profile visitors who open the bio link in a month (only when you enter visits)",
    basis: "Rule of thumb, 1-3%",
    sources: [["hopp-bio-link", "Hopp by Wix"]],
  },
  {
    key: "paidPct",
    label: "Visit to paid subscriber",
    basis: "Luxury retail; Health & Fitness app downloads that turn paid within 35 days, median and upper quartile (measured; used as a proxy: an app install shows more intent than a Story tap, so these may overstate). No published benchmark exists for coaching subscriptions",
    sources: [
      ["dynamicyield-conversion", "Dynamic Yield"],
      ["revenuecat-state-2026", "RevenueCat"],
    ],
  },
  {
    key: "audienceRenewalPct",
    label: "New people each month: share of each audience new to your link",
    basis: "Cautious: the same people all year. Typical: about the yearly follower growth Socialinsider measured on brand accounts, 11-22% by tier, about 1-1.7% a month (measured; our rounding). Strong: our assumption for a growing audience, new followers plus people Instagram starts showing your content to; above the default monthly cancellations (2.9%), so more sharing never lowers month-12 subscribers",
    sources: [["socialinsider-engagement", "Socialinsider"]],
  },
];

function Methodology({ platform }: { platform: PublicPlatform }) {
  const m = platform.followerModel;
  const adjusted = new Set(followerModelAdjustments(m).map((a) => a.field));
  const tierLabel = (i: number) => {
    const upTo = m.tiers[i].upTo,
      from = i === 0 ? 0 : (m.tiers[i - 1].upTo ?? 0) + 1;
    return upTo === null
      ? `Above ${from - 1 > 0 ? (from - 1).toLocaleString("en-AE") : "0"}`
      : `${from.toLocaleString("en-AE")}–${upTo.toLocaleString("en-AE")}`;
  };
  // A value the operator changed no longer rests on the cited source.
  const Source = ({
    fields,
    links,
  }: {
    fields: string[];
    links: Array<[string, string]>;
  }) => {
    const list = links.map(([id, label], i) => (
      <span key={id}>
        {i > 0 && ", "}
        <a href={"#" + id}>{label}</a>
      </span>
    ));
    return fields.some((f) => adjusted.has(f)) ? (
      <span>
        <span className="badge amber">Adjusted by the operator</span> version{" "}
        {m.version}; differs from the cited source ({list})
      </span>
    ) : (
      <span>{list}</span>
    );
  };
  const worked = estimateFollowerConversion(DEFAULT_FOLLOWER_INPUTS, m);
  const count = (n: number) => {
    const c = displayCount(n);
    return c === null ? "fewer than 1" : c.toLocaleString("en-AE");
  };
  const strong = m.scenarios.strong;
  const perStory = Math.round(strong.linkClickPct * strong.paidPct) / 100;
  const signupShare =
    Math.round(
      (worked.scenarios.strong.signups12 / DEFAULT_FOLLOWER_INPUTS.followers) * 1000,
    ) / 10;
  return (
    <>
      <section className="mk-section" id="follower-assumptions" aria-labelledby="fa-h">
        <h2 id="fa-h">Follower calculator assumptions (version {m.version})</h2>
        <p className="mk-body">
          The calculator runs three scenarios with the same arithmetic. Cautious
          and typical use published averages. The strong case is a best case
          for an engaged, growing audience and weekly sharing, from the top
          values found in the research and our stated assumptions. It is not a typical result and not a promise, and you
          may get fewer subscribers than the cautious figure. The calculator
          headline shows the strong case and the other two sit under How we
          estimate.
        </p>
        {adjusted.size > 0 && (
          <p className="mk-body">
            <strong>Operator note:</strong>{" "}
            {m.changeNote ?? "No reason was recorded."}
          </p>
        )}
        <div className="mk-table-wrap">
          <table className="mk-table">
            <caption>
              Story audience: % of followers who see at least one of your
              Stories a month (your own Story views replace it)
            </caption>
            <thead>
              <tr>
                <th scope="col">Followers</th>
                <th scope="col">Cautious</th>
                <th scope="col">Typical</th>
                <th scope="col">Strong case</th>
                <th scope="col">Basis and label</th>
              </tr>
            </thead>
            <tbody>
              {m.tiers.map((tier, i) => (
                <tr key={i}>
                  <td>{tierLabel(i)}</td>
                  <td>{tier.storyPct.cautious}%</td>
                  <td>{tier.storyPct.typical}%</td>
                  <td>{tier.storyPct.strong}%</td>
                  <td>
                    {i === 0
                      ? "Cautious and typical: Socialinsider image and video reach (measured, brand accounts). Strong: our assumption, the 20.5% a six-frame Story sequence reached (measured on brand accounts of all sizes) used as a monthly audience. "
                      : i === 1
                        ? "Cautious: image reach, 3.5% (measured, brand accounts). Typical: the 5% vendor floor, above the measured 4.2% video reach (vendor claim). Strong: our assumption, the six-frame 20.5% used as a monthly audience, against a measured reach of 3.5-4.2% for this tier; HypeAuditor finds accounts of 1,000-10,000 followers engage most (vendor data). "
                        : "Image reach (measured); at least 5% (vendor claim); strong: the IQFluence 5-8% band, lower for larger accounts (vendor claim, no dataset). "}
                    <Source
                      fields={FOLLOWER_SCENARIOS.map((s) => `tiers.${i}.storyPct.${s}`)}
                      links={
                        i === 0
                          ? [["socialinsider-stories", "Socialinsider"]]
                          : i === 1
                            ? [
                                ["socialinsider-stories", "Socialinsider"],
                                ["iqfluence-engagement", "IQFluence"],
                                ["hypeauditor-2025", "HypeAuditor"],
                              ]
                            : [
                                ["socialinsider-stories", "Socialinsider"],
                                ["iqfluence-engagement", "IQFluence"],
                              ]
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mk-table-wrap">
          <table className="mk-table">
            <caption>Rates per scenario</caption>
            <thead>
              <tr>
                <th scope="col">Assumption</th>
                <th scope="col">Cautious</th>
                <th scope="col">Typical</th>
                <th scope="col">Strong case</th>
                <th scope="col">Basis and label</th>
              </tr>
            </thead>
            <tbody>
              {RATE_ROWS.map((row) => (
                <tr key={row.key}>
                  <td>{row.label}</td>
                  <td>{m.scenarios.cautious[row.key]}%</td>
                  <td>{m.scenarios.typical[row.key]}%</td>
                  <td>{m.scenarios.strong[row.key]}%</td>
                  <td>
                    {row.basis}.{" "}
                    <Source
                      fields={FOLLOWER_SCENARIOS.map((s) => `scenarios.${s}.${row.key}`)}
                      links={row.sources}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mk-table-wrap">
          <table className="mk-table">
            <caption>Other assumptions</caption>
            <thead>
              <tr>
                <th scope="col">Assumption</th>
                <th scope="col">Value</th>
                <th scope="col">Basis and label</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Reach of one call-to-action Reel or post, by tier</td>
                <td>
                  Cautious (feed posts):{" "}
                  {m.tiers.map((t) => t.reelPct.cautious + "%").join(" / ")}. Typical
                  and strong (Reels):{" "}
                  {m.tiers.map((t) => t.reelPct.strong + "%").join(" / ")}
                </td>
                <td>
                  Measured, brand accounts.{" "}
                  <Source
                    fields={m.tiers.flatMap((_, i) =>
                      FOLLOWER_SCENARIOS.map((s) => `tiers.${i}.reelPct.${s}`),
                    )}
                    links={[
                      ["socialinsider-reach", "Socialinsider"],
                      ["socialinsider-reels", "Socialinsider"],
                    ]}
                  />
                </td>
              </tr>
              <tr>
                <td>Comments per Reel view, by tier</td>
                <td>{m.tiers.map((t) => t.commentsPerViewPct + "%").join(" / ")}</td>
                <td>
                  Measured, brand accounts; our division of published medians.{" "}
                  <Source
                    fields={m.tiers.map((_, i) => `tiers.${i}.commentsPerViewPct`)}
                    links={[["socialinsider-engagement", "Socialinsider"]]}
                  />
                </td>
              </tr>
              <tr>
                <td>Keyword comments per view</td>
                <td>Comments per view × {m.keywordCommentFactor}</td>
                <td>
                  Measured (+202.78% comments with a comment call to action);
                  treating the extra comments as keyword comments is our
                  inference.{" "}
                  <Source
                    fields={["keywordCommentFactor"]}
                    links={[["metricool-2026", "Metricool"]]}
                  />
                </td>
              </tr>
              <tr>
                <td>How channels overlap</td>
                <td>
                  Cautious: Reels reach the same people as Stories. Typical and
                  strong: each Reel reaches new people. Stories and broadcast
                  are nested in every scenario
                </td>
                <td>
                  Our assumption, from a platform statement.{" "}
                  <Source fields={[]} links={[["meta-instagram-ranking", "Instagram"]]} />
                </td>
              </tr>
              <tr>
                <td>
                  Average engagement (scales Story reach and comments; the strong
                  Story share only down, as it already assumes an engaged
                  audience)
                </td>
                <td>
                  {m.engagementBenchmarkPct}%, scaling at most ×{m.engagementFactorMax}
                </td>
                <td>
                  Measured, brand accounts.{" "}
                  <Source
                    fields={["engagementBenchmarkPct", "engagementFactorMax"]}
                    links={[["socialinsider-engagement", "Socialinsider"]]}
                  />
                </td>
              </tr>
              <tr>
                <td>Members who cancel per year</td>
                <td>Your input, 5-80%; 30% unless you change it</td>
                <td>
                  Owner assumption. Published data show more cancellations: 32-54%
                  of Health &amp; Fitness app subscribers leave after the first
                  month (measured), and 45% of online coaching clients remain at
                  month 12 (vendor data).{" "}
                  <Source
                    fields={[]}
                    links={[
                      ["revenuecat-renewals", "RevenueCat"],
                      ["coachway-2026", "Coachway"],
                    ]}
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <section className="mk-section" id="strong-case" aria-labelledby="sc-h">
        <h2 id="sc-h">How the strong case is calibrated</h2>
        <p className="mk-body">
          The strong case is a best case for an engaged, growing audience and
          weekly sharing. It is not a typical result and not a promise.
        </p>
        <ul className="mk-list">
          <li>
            <Check size={16} aria-hidden="true" />
            <span>
              Per link Story, {strong.linkClickPct}% of viewers tap and{" "}
              {strong.paidPct}% of them pay: about {perStory}% of the people
              who see it each time. Each month {strong.audienceRenewalPct}% of
              the audience is new to your link, so sign-ups keep coming and
              active subscribers are still growing at month 12. [Our
              assumption; measured proxies]
            </span>
          </li>
          <li>
            <Check size={16} aria-hidden="true" />
            <span>
              Over 12 months the worked example below signs up about{" "}
              {signupShare}% of its followers, far above published creator
              averages. Passion.io’s course benchmarks put conversion at
              0.1-1% of an audience (low), 1.5-5% (mid) and 0.52-1.1% for
              higher-priced courses, and Stan’s creators with 1,000-10,000
              followers sell about USD 273 a month on average, against{" "}
              {aed(worked.scenarios.strong.revenueMonth12Minor)} a month in the
              strong case. [Rule of thumb; vendor data]
            </span>
          </li>
          <li>
            <Check size={16} aria-hidden="true" />
            <span>
              Our founder’s reading of creator sales, a fitness creator selling
              a USD 20 plan to roughly 0.5-1.5% of one video’s viewers, is an
              unverified example with no public source, so it is not used as
              evidence. Per view, the strong case’s {perStory}% is below it; the
              12-month figure adds repeat chances for the same viewers and the
              new people each month. [Unverified founder example]
            </span>
          </li>
          <li>
            <Check size={16} aria-hidden="true" />
            <span>
              The strong rates are the top values found in the research:{" "}
              {strong.linkClickPct}% link clicks (creator reports),{" "}
              {strong.dmOpenPct}% of keyword commenters opening the DM link
              (vendor claims) and {strong.paidPct}% visit to paid, the upper
              quartile of Health &amp; Fitness apps (measured; an app install
              shows more intent than a Story tap, so it may overstate). The
              Story audience up to 10,000 followers and the new people each
              month are our assumptions. [Measured; vendor claims; our
              assumption]
            </span>
          </li>
        </ul>
        <div className="mk-table-wrap">
          <table className="mk-table">
            <caption>
              Worked example: {DEFAULT_FOLLOWER_INPUTS.followers.toLocaleString("en-AE")}{" "}
              followers, AED {DEFAULT_FOLLOWER_INPUTS.priceAed},{" "}
              {DEFAULT_FOLLOWER_INPUTS.linkStoriesPerMonth} link Stories and{" "}
              {DEFAULT_FOLLOWER_INPUTS.ctaReelsPerMonth} keyword Reels a month,{" "}
              {DEFAULT_FOLLOWER_INPUTS.yearlyCancelPct}% yearly cancellations
            </caption>
            <thead>
              <tr>
                <th scope="col">Scenario</th>
                <th scope="col">First month</th>
                <th scope="col">Active after 12 months</th>
                <th scope="col">Sign-ups over 12 months</th>
                <th scope="col">A month at month 12</th>
              </tr>
            </thead>
            <tbody>
              {FOLLOWER_SCENARIOS.map((s) => {
                const r = worked.scenarios[s];
                return (
                  <tr key={s}>
                    <th scope="row">{SCENARIO_NAMES[s]}</th>
                    <td>{count(r.month1New)}</td>
                    <td>{count(r.activeMonth12)}</td>
                    <td>{count(r.signups12)}</td>
                    <td>{aed(r.revenueMonth12Minor)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="fine-print muted">
          Before platform commission, payment processing and tax. Trials,
          discounts, refunds and failed payments are not included; new
          followers count only through the new people each month.
        </p>
      </section>
      <section className="mk-section" id="sources" aria-labelledby="src-h">
        <h2 id="src-h">Sources</h2>
        <p className="mk-body">
          Each source is labelled by how much weight it can bear: measured
          (a dataset with a stated sample), used as a proxy, vendor data or
          claim, rule of thumb, platform statement, official figure, price
          guide or press report.
        </p>
        <ol className="mk-source-list">
          {MARKETING_SOURCES.map((s) => (
            <li key={s.id} id={s.id}>
              <p>
                <span className="badge">{s.evidence}</span>{" "}
                <strong>{s.publisher}</strong>,{" "}
                <a href={s.url} rel="noopener" target="_blank">
                  {s.title}
                </a>
                {s.published ? ` (${s.published})` : ""}. Retrieved{" "}
                {dateLabel(s.retrieved)}.
              </p>
              <p>{s.claim}</p>
              <p className="muted">Used for: {s.usedFor}</p>
            </li>
          ))}
        </ol>
      </section>
      <section className="mk-section" id="changes" aria-labelledby="ch-h">
        <h2 id="ch-h">Change log</h2>
        <ul className="mk-list">
          <li>
            <Check size={16} aria-hidden="true" />
            <span>
              28 September 2026: first publication of sources and calculator
              assumptions (version 2026-09-28).
            </span>
          </li>
          <li>
            <Check size={16} aria-hidden="true" />
            <span>
              28 September 2026 (version 2026-09-28.2): repeat link Stories now
              reach the same viewers, so the chance of a visit levels off
              instead of adding up; the twelve-month figure comes from the same
              Story audience and never exceeds viewers × conversion; visit to
              paid subscriber changed from 1.51-5.39% to 0.72% (Dynamic Yield
              luxury and jewellery, high-consideration retail) to 2.89% (EMEA
              average), because a monthly coaching subscription is a considered
              purchase and the UAE is in EMEA.
            </span>
          </li>
          <li>
            <Check size={16} aria-hidden="true" />
            <span>
              28 September 2026 (version 2026-09-28.3): three scenarios instead
              of one range, with the strong case as the headline at our owner’s
              direction; Reels with a comment keyword, the bio link and a
              broadcast channel join Stories; cancellations per year (30% unless
              you change it) give active subscribers after 12 months; your own
              Story views can replace the reach guess; and tier boundaries no
              longer lower an estimate (5,001 followers used to give fewer
              subscribers than 5,000).
            </span>
          </li>
          <li>
            <Check size={16} aria-hidden="true" />
            <span>
              28 September 2026 (version 2026-09-28.4): each audience now gains
              new people every month (typical about measured follower growth,
              strong our assumption), so sign-ups keep coming and more sharing
              never lowers the strong case’s month-12 subscribers; strong visit
              to paid is 6.2%, the Health &amp; Fitness upper quartile, instead
              of 10.7%, an all-category median for apps that charge before
              use; engagement no longer raises the strong Story share, which
              already assumes an engaged audience; keyword Reels count each
              Reel’s commenters afresh in the typical and strong cases; the
              monthly amount uses the whole number of subscribers shown; and an
              unverified creator sales figure is no longer presented as a
              source.
            </span>
          </li>
          {adjusted.size > 0 && (
            <li>
              <Check size={16} aria-hidden="true" />
              <span>
                Version {m.version}: the platform operator adjusted{" "}
                {adjusted.size} value{adjusted.size === 1 ? "" : "s"}.{" "}
                {m.changeNote ?? "No reason was recorded."}
              </span>
            </li>
          )}
        </ul>
      </section>
    </>
  );
}

function EarlyAccess({ platform }: { platform: PublicPlatform }) {
  if (platform.registrationOpen)
    return (
      <section className="mk-section" id="claim" aria-labelledby="claim-h">
        <h2 id="claim-h">Claim your coaching address</h2>
        {/* Shown without the scheme, as on the home page. */}
        <AddressPreview template={platform.coachAddressTemplate.replace(/^https?:\/\//, "")} />
      </section>
    );
  return (
    <section className="mk-section card" id="early-access" aria-labelledby="early-h">
      <h2 id="early-h">Join early access</h2>
      <p className="mk-body">
        Trainer registration opens once our legal documents are published. Leave
        your details and we will email you when it opens. Your calculator
        numbers and the address you typed come with you.
      </p>
      <EarlyAccessForm
        appName={platform.name}
        supportEmail={platform.supportEmail}
        specialties={OFFERED_DIRECTORY_SPECIALTIES.map((s) => ({ id: s.id, label: s.label }))}
      />
    </section>
  );
}

/** Page-specific blocks placed after the answer-first introduction. */
function CustomBlock({ page, platform, t }: Ctx & { t: (s: string) => string }) {
  switch (page.path) {
    case "/earnings-calculator":
      return <EarningsCalculator />;
    case "/follower-calculator":
      return (
        <FollowerCalculator
          model={platform.followerModel}
          addressTemplate={platform.coachAddressTemplate}
          claimHref={claimCta(platform.registrationOpen).href}
          claimLabel={platform.registrationOpen ? "Claim this address" : "Join early access"}
        />
      );
    case "/pricing":
      return (
        <>
          <WorkedExample />
          <EarningsCalculator compact />
        </>
      );
    case "/features":
      // The home page's "everything included" counts, as a paper strip.
      return <IncludedStrip t={t} />;
    case "/for-trainers":
    case "/guides":
      return <PageTiles pages={childrenOf(page.path)} platform={platform} t={t} />;
    case "/uae":
      return <DirectoryBlock place="the UAE" />;
    case "/get-started":
      return <EarlyAccess platform={platform} />;
    default:
      return null;
  }
}
function DirectoryBlock({ place }: { place: string }) {
  return (
    <aside className="mk-directory card">
      <UserRound size={20} aria-hidden="true" />
      <div>
        <h2>Looking for a coach in {place}?</h2>
        <p>Browse independent coaches who chose to be listed.</p>
      </div>
      <Link className="button secondary" href="/coaches">
        Browse the directory
      </Link>
    </aside>
  );
}
/** Published price anchors for one-to-one and online coaching (cited). */
function PriceAnchors() {
  return (
    <div className="mk-anchors">
      <div>
        <strong>AED 70–350</strong>
        <span>per one-to-one session in Dubai (Hey Trainer, 2026)</span>
      </div>
      <div>
        <strong>AED 200–700+</strong>
        <span>per session, basic to premium (Embody Fitness, 2025)</span>
      </div>
      <div>
        <strong>AED 400–2,000</strong>
        <span>a month for online coaching (369MMAFIT, 2026)</span>
      </div>
    </div>
  );
}
/** Blocks placed after a section, by section id. */
function AfterSection({
  page,
  section,
  platform,
  t,
}: {
  page: MarketingPage;
  section: MarketingSection;
  platform: PublicPlatform;
  t: (s: string) => string;
}) {
  if (page.path === "/pricing" && section.id === "hours") return <PriceAnchors />;
  // /features: screens and guides first; the full capability matrix (still
  // server-rendered and indexed) sits lower on the page.
  if (page.path === "/features" && section.id === "subscribers")
    return (
      <>
        <ProductScreens t={t} />
        <section className="mk-section" id="feature-guides" aria-labelledby="all-features-h">
          <h2 id="all-features-h">Feature guides</h2>
          <PageTiles
            pages={[marketingPage("/trainer-brain")!, ...childrenOf("/features")]}
            platform={platform}
            t={t}
            withChips
          />
        </section>
        <Replaces t={t} />
        <FeatureMatrix platform={platform} t={t} />
      </>
    );
  if (page.path === "/get-started" && section.id === "checklist")
    return (
      <ol className="mk-checklist">
        {SETUP_CHECKLIST.map((step) => (
          <li key={step.key}>
            <strong>{step.label}</strong>
            <span className={"badge " + (step.required ? "" : "green")}>
              {step.required ? "Required" : "Optional"}
            </span>
            <p className="muted">{step.summary}</p>
          </li>
        ))}
      </ol>
    );
  if (page.path === "/guides/instagram-followers-to-clients" && section.id === "examples")
    return <FollowerExamples platform={platform} />;
  if (page.kind === "specialty" && section.id === "followers")
    return (
      <FollowerCalculator
        model={platform.followerModel}
        initial={{ priceAed: page.examplePriceAed }}
        compact
        headingLevel={3}
      />
    );
  return null;
}

function StandardPage({ page, platform, origin }: Ctx) {
  const t = (s: string) => brandText(s, platform.name, platform.followerModel);
  const cta = primaryCta(page, platform),
    second = secondaryCta(page);
  const chip = availabilityChip(page, platform.availability);
  const demo = page.path === "/demo";
  return (
    <>
      <div className="mk-container mk-page">
        <Breadcrumbs page={page} t={t} />
        <header className="mk-page-head">
          <p className="eyebrow">{t(page.eyebrow)}</p>
          <h1>{t(page.h1)}</h1>
          {chip && <Chip chip={chip} />}
          {/* One short statement above the fold: the lede, or the
              answer-first introduction on pages without one. */}
          <p className={page.lede ? "mk-lede" : "mk-answer"}>{t(page.lede ?? page.intro)}</p>
          <div className="button-row">
            <Link className="button large mk-cta" href={cta.href}>
              {cta.label} <ArrowRight size={17} aria-hidden="true" />
            </Link>
            {!page.path.endsWith("-calculator") && (
              <Link className="text-link mk-link" href={second.href}>
                {second.label} <ArrowRight size={15} aria-hidden="true" />
              </Link>
            )}
          </div>
        </header>
        <CustomBlock page={page} platform={platform} origin={origin} t={t} />
        {page.sections.map((section) =>
          demo && section.id === "scenarios" ? (
            <section className="mk-section" key={section.id} aria-labelledby="scenarios-h">
              <h2 id="scenarios-h">{t(section.heading)}</h2>
              <DemoScenarios
                scenarios={(section.cards ?? []).map((c) => ({
                  title: t(c.title),
                  label: t(c.label ?? ""),
                  body: t(c.body),
                }))}
              />
              {section.note && <p className="fine-print muted">{t(section.note)}</p>}
            </section>
          ) : page.path === "/how-it-works" &&
            section.id === "steps" &&
            journeyAvailable(platform) ? (
            // The coach-to-subscriber journey player, with the same heading
            // and steps (components/marketing/journey.tsx).
            <div key={section.id}>
              <Journey section={section} platform={platform} t={t} />
            </div>
          ) : (
            <div key={section.id}>
              <Section section={section} t={t} />
              <AfterSection page={page} section={section} platform={platform} t={t} />
            </div>
          ),
        )}
        {page.kind === "emirate" && <DirectoryBlock place={page.navLabel} />}
        {page.path === "/about" && (
          <section className="mk-section" id="company" aria-labelledby="company-h">
            <h2 id="company-h">Company and contact</h2>
            {platform.companyDetails && <p className="mk-body">{platform.companyDetails}</p>}
            {platform.supportEmail ? (
              <p className="mk-body">
                Contact:{" "}
                <a className="ltr-data" href={"mailto:" + platform.supportEmail}>
                  {platform.supportEmail}
                </a>
              </p>
            ) : (
              <p className="mk-body">
                Signed-in trainers reach us through Support in their workspace.
              </p>
            )}
          </section>
        )}
        {page.path === "/methodology" && <Methodology platform={platform} />}
        {/* A page with a lede keeps its answer-first introduction (the text
            in JSON-LD and llms-full.txt) as a short summary before the FAQs,
            instead of repeating the lede straight under it. */}
        {page.lede && (
          <section className="mk-section mk-in-short" id="in-short" aria-labelledby="in-short-h">
            <h2 id="in-short-h">In short</h2>
            <p className="mk-body">{t(page.intro)}</p>
          </section>
        )}
        <Faqs page={page} t={t} />
        <Related page={page} t={t} />
        <p className="mk-updated muted">
          Last updated <time dateTime={page.lastUpdated}>{dateLabel(page.lastUpdated)}</time>
        </p>
      </div>
      <Closing cta={cta} platform={platform} secondary={closingLink(page.path)} />
    </>
  );
}

/**
 * A home band: the registry heading and body, a visual and up to two links.
 * Bands alternate white and paper; "split" puts the text beside the visual
 * on wide screens. Every band shares the one page container.
 */
function HomeSection({
  page,
  id,
  t,
  tone,
  split = false,
  visual,
  links = [],
  className = "",
}: {
  page: MarketingPage;
  id: string;
  t: (s: string) => string;
  tone: "white" | "paper";
  split?: boolean;
  visual?: ReactNode;
  links?: Cta[];
  className?: string;
}) {
  const section = page.sections.find((s) => s.id === id)!;
  const more = links.length > 0 && (
    <p className="mk-home-more">
      {links.map((link) => (
        <Link key={link.href} className="text-link mk-link" href={link.href}>
          {link.label} <ArrowRight size={15} aria-hidden="true" />
        </Link>
      ))}
    </p>
  );
  return (
    <section
      className={`mk-home-band mk-home-${tone} ${className}`.trim()}
      id={id}
      aria-labelledby={id + "-h"}
    >
      <div className={"mk-container mk-home-inner" + (split ? " mk-home-split" : "")}>
        <div className="mk-home-text">
          <h2 id={id + "-h"}>{t(section.heading)}</h2>
          {section.body?.map((p) => (
            <p key={p} className="mk-home-body">
              {t(p)}
            </p>
          ))}
          {split && more}
        </div>
        {visual && <div className="mk-home-visual">{visual}</div>}
        {!split && more}
      </div>
    </section>
  );
}

type Tile = {
  icon: LucideIcon;
  label: string;
  line: string;
  href: string;
  /** The feature page whose availability decides whether the tile shows. */
  gate?: string;
};
/**
 * What subscribers get: four flat tiles, each linking to its feature page
 * with one short line. Only features available now are shown ("Available
 * soon" stays on /features): the fourth tile is nutrition when that tier is
 * on, otherwise the first available of chat and bookings.
 */
function SubscriberTiles({ platform }: { platform: PublicPlatform }) {
  const core: Tile[] = [
    {
      icon: CalendarDays,
      label: "Daily plan",
      line: "Dated, built from your rules.",
      href: "/features/ai-training-plans",
    },
    {
      icon: Dumbbell,
      label: "Guided workouts",
      line: "Cues, set logging and rest timers.",
      href: "/features/subscriber-app",
    },
    {
      icon: TrendingUp,
      label: "Progress they can see",
      line: "Sessions and best loads, in one place.",
      href: "/features/progress-and-client-twin",
    },
  ];
  const extra: Tile[] = [
    {
      icon: Apple,
      label: "Nutrition",
      line: "Meal plans and a food diary, as an optional tier.",
      href: "/features/nutrition",
      gate: "/features/nutrition",
    },
    {
      icon: MessageCircle,
      label: "Chat",
      line: "With you and a clearly labelled digital coach.",
      href: "/features/chat-and-digital-coach",
      gate: "/features/chat-and-digital-coach",
    },
    {
      icon: CalendarCheck,
      label: "Sessions with you",
      line: "Paid one-to-one bookings, when it matters.",
      href: "/features/bookings",
      gate: "/features/bookings",
    },
  ];
  const available = (tile: Tile) =>
    !tile.gate ||
    !availabilityChip(marketingPage(tile.gate), platform.availability)?.soon;
  const tiles = [...core, ...extra.filter(available).slice(0, 1)];
  return (
    <ul className="mk-icon-tiles">
      {tiles.map(({ icon: Icon, label, line, href }) => (
        <li key={label}>
          <Link className="mk-icon-tile" href={href}>
            <span className="mk-icon-square" aria-hidden="true">
              <Icon size={22} />
            </span>
            <span className="mk-icon-label">{label}</span>
            <span className="mk-icon-line">{line}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** The trainer stays in charge: the decision flow (sample data). */
function ControlFlow() {
  // One image for assistive technology: the tag and the three paths are
  // summarised in its label; the drawn cards are presentational.
  return (
    <div
      className="mk-flow-card"
      role="img"
      aria-label="Illustration with sample data: a subscriber says squats felt easy; your rule adds 2.5 kg automatically. Unsure changes come to you, and pain pauses the workout and comes to you."
    >
      <p className="mk-relay-tag" aria-hidden="true">
        Illustration with sample data
      </p>
      <div className="mk-flow" aria-hidden="true">
        <div className="mk-flow-msg">
          <span className="small-label">SUBSCRIBER</span>
          <p>“Week three done. Squats felt easy.”</p>
        </div>
        <div className="mk-flow-brain">
          <span className="small-label">YOUR AI</span>
          <p>
            <strong>Your rule:</strong> two easy sessions at 3+ reps in reserve →
            add 2.5 kg.
          </p>
          <div className="mk-meter">
            <span style={{ inlineSize: "86%" }} />
          </div>
          <small>Confidence above your threshold</small>
        </div>
        <div className="mk-flow-lanes">
          <span className="mk-lane mk-lane-auto">
            <CheckCircle size={14} /> Applied automatically
          </span>
          <span className="mk-lane">
            <UserRound size={14} /> Unsure → to you
          </span>
          <span className="mk-lane mk-lane-safety">
            <CircleAlert size={14} /> Pain → paused, to you
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Your site and your price: the coaching address from the platform's
 * template (never a hard-coded domain), shown without the scheme, and the
 * commission bands by paying subscriber.
 */
function EconomicsVisual({ platform }: { platform: PublicPlatform }) {
  const template = platform.coachAddressTemplate.replace(/^https?:\/\//, "");
  const address = template.replace("{slug}", "yourname");
  return (
    <div className="mk-econ">
      {platform.registrationOpen ? (
        <AddressPreview template={template} />
      ) : (
        <div className="mk-browser">
          <span className="mk-browser-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span className="mk-browser-address ltr-data">{address}</span>
        </div>
      )}
      <div className="mk-bands-box">
        <p className="small-label" id="mk-bands-label">
          Commission by paying subscriber
        </p>
        <ul className="mk-band-pills" aria-labelledby="mk-bands-label">
          {bandPills().map((pill) => {
            const [rate, range] = pill.split(" · ");
            return (
              <li key={pill}>
                <strong>{rate}</strong> · {range}
              </li>
            );
          })}
        </ul>
        <p className="fine-print muted">
          Each rate applies only to the subscribers in its band.
        </p>
      </div>
    </div>
  );
}

function Home({ page, platform }: Ctx) {
  const t = (s: string) => brandText(s, platform.name, platform.followerModel);
  const cta = primaryCta(page, platform);
  // The follower estimate keeps its own block (the calculator is owned by
  // the calculator package; only its container is styled here).
  const calculator = (
    <div className="mk-home-calc"><FollowerCalculator model={platform.followerModel} compact headingLevel={3} /></div>
  );
  return (
    <>
      <section className="mk-hero" aria-labelledby="mk-hero-h">
        <div className="mk-container mk-hero-inner">
          <div className="mk-hero-copy">
            <div className="mk-hero-head">
              <p className="eyebrow">{t(page.eyebrow)}</p>
              <h1 id="mk-hero-h">
                <Highlighted text={t(page.h1)} mark={page.h1Highlight} />
              </h1>
            </div>
            <div className="mk-hero-body">
              {page.lede && <p className="mk-hero-lede">{t(page.lede)}</p>}
              <div className="button-row">
                <Link className="button large mk-cta" href={cta.href}>
                  {cta.label} <ArrowRight size={18} aria-hidden="true" />
                </Link>
                <Link className="text-link mk-link" href={HOW_IT_WORKS.href}>
                  {HOW_IT_WORKS.label} <ArrowRight size={16} aria-hidden="true" />
                </Link>
              </div>
              <p className="mk-hero-micro">
                Built for UAE trainers · You set the price in AED · No technical
                skills needed
              </p>
            </div>
          </div>
          <HeroFlow platform={platform} t={t} />
        </div>
      </section>
      {/* The whole workflow, coach to subscriber, once a coach can launch. */}
      {journeyAvailable(platform) && <JourneyBand platform={platform} t={t} />}
      <HomeSection
        page={page}
        id="subscribers"
        t={t}
        tone="white"
        visual={<SubscriberTiles platform={platform} />}
        links={[{ label: "All features", href: "/features" }]}
      />
      <HomeSection
        page={page}
        id="control"
        t={t}
        tone="paper"
        split
        visual={<ControlFlow />}
        links={[
          { label: "How your AI decides", href: "/trainer-brain" },
          { label: "Try the demo", href: "/demo" },
        ]}
      />
      <HomeSection
        page={page}
        id="economics"
        t={t}
        tone="white"
        split
        visual={<EconomicsVisual platform={platform} />}
        links={[{ label: "Pricing in detail", href: "/pricing" }]}
      />
      <HomeSection
        page={page}
        id="followers"
        t={t}
        tone="paper"
        className="mk-home-followers"
        visual={calculator}
        links={[{ label: "Open the full calculator", href: "/follower-calculator" }]}
      />
      <div className="mk-home-band mk-home-white">
        <div className="mk-container mk-home-inner">
          {/* All answers start closed: the home page stays under its word
              budget (scripts/brand-check.mjs). The first answer is the
              answer-first introduction, in the page's HTML, the FAQPage
              JSON-LD and llms-full.txt. */}
          <Faqs page={page} t={t} heading="Questions trainers ask" />
        </div>
      </div>
      <Closing cta={cta} platform={platform} secondary={closingLink(page.path)} />
    </>
  );
}

/** A complete marketing page: header, content, footer and JSON-LD. */
export function MarketingSite({ page, platform, origin }: Ctx) {
  const cta = primaryCta(page, platform);
  const jsonLd = marketingJsonLd(page, {
    origin,
    appName: platform.name,
    supportEmail: platform.supportEmail,
    followerModel: platform.followerModel,
  });
  return (
    <div className="public mk platform-ui">
      <MarketingHeader
        key={page.path}
        appName={platform.name}
        initials={platform.initials}
        cta={cta}
        path={page.path}
      />
      <main id="main" className="mk-main">
        {page.kind === "home" ? (
          <Home page={page} platform={platform} origin={origin} />
        ) : (
          <StandardPage page={page} platform={platform} origin={origin} />
        )}
      </main>
      <MarketingFooter appName={platform.name} initials={platform.initials} />
      {/* The section reveal (renders nothing; app/marketing.css holds the
          motion). */}
      <MarketingMotion path={page.path} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }}
      />
    </div>
  );
}
