// Server-rendered public marketing pages. Every word comes from the registry
// in packages/contracts (marketing-content.ts), so the visible text, the
// JSON-LD and llms-full.txt agree. Interactive parts are small client islands.
import Link from "next/link";
import {
  Apple,
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle,
  CircleAlert,
  Dumbbell,
  TrendingUp,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  BRAND_COPY,
  DIRECTORY_SPECIALTIES,
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
  displayRange,
  estimateEarnings,
  estimateFollowerConversion,
  followerModelAdjustments,
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
    <div className="mk-closing-wrap">
      <section className="mk-closing" aria-labelledby="mk-closing-h">
        <h2 id="mk-closing-h">
          {usesBrandIdentity(platform.name) ? BRAND_COPY.line : "Ready to teach your AI?"}
        </h2>
        <p>Guided setup. Nothing goes live until you publish.</p>
        <div className="button-row">
          <Link className="button large" href={cta.href}>
            {cta.label} <ArrowRight size={17} aria-hidden="true" />
          </Link>
          <Link className="text-link" href={secondary.href}>
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

/** The Pace highlight on part of a heading; the text itself is unchanged. */
function Highlighted({ text, mark }: { text: string; mark?: string }) {
  const at = mark ? text.indexOf(mark) : -1;
  if (!mark || at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="mk-mark">{mark}</mark>
      {text.slice(at + mark.length)}
    </>
  );
}

/** The commission bands as short labels, from the ledger's own bands. */
export function bandPills(): string[] {
  const n = (v: number) => v.toLocaleString("en-GB");
  let from = 1;
  return BANDS.map((band) => {
    const range = Number.isFinite(band.count)
      ? `${n(from)}–${n(from + band.count - 1)}`
      : `${n(from)}+`;
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

/** Three example accounts, computed live from the assumptions in use. */
function FollowerExamples({ platform }: { platform: PublicPlatform }) {
  const accounts: Array<[number, number]> = [
    [2000, 8],
    [8000, 8],
    [30000, 12],
  ];
  const whole = (n: number) => n.toLocaleString("en-AE");
  const span = (r: { low: number; high: number }) =>
    r.low === r.high ? whole(r.low) : `${whole(r.low)}–${whole(r.high)}`;
  return (
    <div className="mk-table-wrap">
      <table className="mk-table">
        <caption>
          Estimate ranges at AED 199 a month (assumptions version{" "}
          {platform.followerModel.version})
        </caption>
        <thead>
          <tr>
            <th scope="col">Followers</th>
            <th scope="col">Link Stories a month</th>
            <th scope="col">People who see your Stories</th>
            <th scope="col">New subscribers, first month</th>
            <th scope="col">After twelve months</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map(([followers, stories]) => {
            const e = estimateFollowerConversion(
              { followers, linkStoriesPerMonth: stories, priceAed: 199 },
              platform.followerModel,
            );
            return (
              <tr key={followers}>
                <td>{whole(followers)}</td>
                <td>{stories}</td>
                <td>{span(displayRange(e.storyViewers))}</td>
                <td>{span(displayRange(e.subscribers))}</td>
                <td>{span(displayRange(e.twelveMonthSubscribers))}</td>
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
        processing, AI usage and other costs, about {e.equivalentSessions}{" "}
        sessions at AED 250.
      </p>
      <p className="fine-print muted">
        An arithmetic example, not a forecast or promise.
      </p>
    </div>
  );
}

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
    href,
    label,
  }: {
    fields: string[];
    href: string;
    label: string;
  }) =>
    fields.some((f) => adjusted.has(f)) ? (
      <span>
        <span className="badge amber">Adjusted by the operator</span> version{" "}
        {m.version}; differs from the cited source (
        <a href={href}>{label}</a>)
      </span>
    ) : (
      <a href={href}>{label}</a>
    );
  return (
    <>
      <section className="mk-section" id="follower-assumptions" aria-labelledby="fa-h">
        <h2 id="fa-h">Follower calculator assumptions (version {m.version})</h2>
        {adjusted.size > 0 && (
          <p className="mk-body">
            <strong>Operator note:</strong>{" "}
            {m.changeNote ?? "No reason was recorded."}
          </p>
        )}
        <div className="mk-table-wrap">
          <table className="mk-table">
            <caption>Values in use now; the platform operator can review them</caption>
            <thead>
              <tr>
                <th scope="col">Assumption</th>
                <th scope="col">Low</th>
                <th scope="col">High</th>
                <th scope="col">Source</th>
              </tr>
            </thead>
            <tbody>
              {m.tiers.map((tier, i) => (
                <tr key={i}>
                  <td>Story reach, {tierLabel(i)} followers</td>
                  <td>{tier.reachLowPct}%</td>
                  <td>{tier.reachHighPct}%</td>
                  <td>
                    <Source
                      fields={[`tiers.${i}.reachLowPct`, `tiers.${i}.reachHighPct`]}
                      href="#socialinsider-stories"
                      label="Socialinsider"
                    />
                  </td>
                </tr>
              ))}
              <tr>
                <td>Link-sticker click-through, per viewer per link Story</td>
                <td>{m.linkClickLowPct}%</td>
                <td>{m.linkClickHighPct}%</td>
                <td>
                  <Source
                    fields={["linkClickLowPct", "linkClickHighPct"]}
                    href="#creatorflow-link-sticker"
                    label="Creator reports"
                  />
                </td>
              </tr>
              <tr>
                <td>
                  Visit to paid subscriber (retail e-commerce purchase rates; no
                  published benchmark exists for coaching subscriptions)
                </td>
                <td>{m.purchaseLowPct}%</td>
                <td>{m.purchaseHighPct}%</td>
                <td>
                  <Source
                    fields={["purchaseLowPct", "purchaseHighPct"]}
                    href="#dynamicyield-conversion"
                    label="Dynamic Yield"
                  />
                </td>
              </tr>
              <tr>
                <td>Average engagement (for scaling reach)</td>
                <td colSpan={2}>
                  {m.engagementBenchmarkPct}%, scaling at most ×{m.engagementFactorMax}
                </td>
                <td>
                  <Source
                    fields={["engagementBenchmarkPct", "engagementFactorMax"]}
                    href="#socialinsider-engagement"
                    label="Socialinsider"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <section className="mk-section" id="sources" aria-labelledby="src-h">
        <h2 id="src-h">Sources</h2>
        <ol className="mk-source-list">
          {MARKETING_SOURCES.map((s) => (
            <li key={s.id} id={s.id}>
              <p>
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
        <AddressPreview template={platform.coachAddressTemplate} />
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
        specialties={DIRECTORY_SPECIALTIES.map((s) => ({ id: s.id, label: s.label }))}
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
  if (page.path === "/features" && section.id === "subscribers")
    return (
      <>
        <ProductScreens t={t} />
        <FeatureMatrix platform={platform} t={t} />
        <Replaces t={t} />
        <section className="mk-section" aria-labelledby="all-features-h">
          <h2 id="all-features-h">Feature guides</h2>
          <PageTiles
            pages={[marketingPage("/trainer-brain")!, ...childrenOf("/features")]}
            platform={platform}
            t={t}
            withChips
          />
        </section>
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
      <div className="mk-page">
        <Breadcrumbs page={page} t={t} />
        <header className="mk-page-head">
          <p className="eyebrow">{t(page.eyebrow)}</p>
          <h1>{t(page.h1)}</h1>
          {chip && <Chip chip={chip} />}
          {/* A short lede in the hero; the answer-first introduction follows. */}
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
        {page.lede && <p className="mk-summary">{t(page.intro)}</p>}
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
 * A home band: the registry heading and body, a visual and a link. Bands
 * alternate white and paper; "split" puts the text beside the visual on
 * wide screens.
 */
function HomeSection({
  page,
  id,
  t,
  tone,
  split = false,
  visual,
  link,
  className = "",
}: {
  page: MarketingPage;
  id: string;
  t: (s: string) => string;
  tone: "white" | "paper";
  split?: boolean;
  visual?: ReactNode;
  link?: Cta;
  className?: string;
}) {
  const section = page.sections.find((s) => s.id === id)!;
  const more = link && (
    <p className="mk-home-more">
      <Link className="text-link mk-link" href={link.href}>
        {link.label} <ArrowRight size={15} aria-hidden="true" />
      </Link>
    </p>
  );
  return (
    <section
      className={`mk-home-band mk-home-${tone} ${className}`.trim()}
      id={id}
      aria-labelledby={id + "-h"}
    >
      <div className={"mk-home-inner" + (split ? " mk-home-split" : "")}>
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

/** What subscribers get: four ink icons on paper squares. */
function SubscriberTiles({ platform }: { platform: PublicPlatform }) {
  // The same registry entry and chip as the nutrition item on /features.
  const nutrition = availabilityChip(
    marketingPage("/features/nutrition"),
    platform.availability,
  );
  const tiles: Array<[LucideIcon, string, ReturnType<typeof availabilityChip>]> = [
    [CalendarDays, "Daily plan", null],
    [Dumbbell, "Guided workouts", null],
    [TrendingUp, "Progress they can see", null],
    [Apple, "Nutrition", nutrition],
  ];
  return (
    <ul className="mk-icon-tiles">
      {tiles.map(([Icon, label, chip]) => (
        <li key={label}>
          <span className="mk-icon-square" aria-hidden="true">
            <Icon size={22} />
          </span>
          <span className="mk-icon-label">{label}</span>
          <Chip chip={chip} />
        </li>
      ))}
    </ul>
  );
}

/** The trainer stays in charge: the decision flow (sample data). */
function ControlFlow() {
  return (
    <div className="mk-flow-card">
      <p className="mk-relay-tag">Illustration with sample data</p>
      <div className="mk-flow" aria-hidden="true">
        <div className="mk-flow-msg">
          <span className="small-label">SUBSCRIBER</span>
          <p>“Week three done. Squats felt easy.”</p>
        </div>
        <div className="mk-flow-brain">
          <span className="small-label">YOUR TRAINER BRAIN</span>
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
 * template (never a hard-coded domain) and the commission bands.
 */
function EconomicsVisual({ platform }: { platform: PublicPlatform }) {
  const address = platform.coachAddressTemplate
    .replace("{slug}", "yourname")
    .replace(/^https?:\/\//, "");
  return (
    <div className="mk-econ">
      {platform.registrationOpen ? (
        <AddressPreview template={platform.coachAddressTemplate} />
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
      <ul className="mk-band-pills" aria-label="Commission bands">
        {bandPills().map((pill) => {
          const [rate, range] = pill.split(" · ");
          return (
            <li key={pill}>
              <strong>{rate}</strong> · {range}
            </li>
          );
        })}
      </ul>
      <p className="fine-print muted">Marginal bands: each band keeps its own rate.</p>
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
        <div className="mk-hero-copy">
          <p className="eyebrow">{t(page.eyebrow)}</p>
          <h1 id="mk-hero-h">
            <Highlighted text={t(page.h1)} mark={page.h1Highlight} />
          </h1>
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
            You set the price in AED · No technical skills needed
          </p>
        </div>
        <HeroFlow platform={platform} t={t} />
      </section>
      <HomeSection
        page={page}
        id="subscribers"
        t={t}
        tone="white"
        visual={<SubscriberTiles platform={platform} />}
        link={{ label: "All features", href: "/features" }}
      />
      <HomeSection
        page={page}
        id="control"
        t={t}
        tone="paper"
        split
        visual={<ControlFlow />}
        link={{ label: "See four decisions in the demo", href: "/demo" }}
      />
      <HomeSection
        page={page}
        id="economics"
        t={t}
        tone="white"
        split
        visual={<EconomicsVisual platform={platform} />}
        link={{ label: "Pricing in detail", href: "/pricing" }}
      />
      <HomeSection
        page={page}
        id="followers"
        t={t}
        tone="paper"
        className="mk-home-followers"
        visual={calculator}
        link={{ label: "Open the full calculator", href: "/follower-calculator" }}
      />
      <div className="mk-home-band mk-home-white">
        <div className="mk-home-inner">
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
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }}
      />
    </div>
  );
}
