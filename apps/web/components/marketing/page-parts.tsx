// The parts every marketing page shares: the page head, sections, "In
// short", FAQs, related links, breadcrumbs, the "Last updated" line and the
// closing panel, plus the calls to action. The standard renderer (site.tsx)
// and the pages with a renderer of their own (its BESPOKE map) use the same
// ones, so a page keeps the house structure whoever renders it. Every word
// still comes from the registry (packages/contracts/src/marketing-content.ts).
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import type { ReactNode } from "react";
import {
  BRAND_COPY,
  brandText,
  marketingBreadcrumbs,
  marketingPage,
  sourceById,
  usesBrandIdentity,
  type MarketingPage,
  type MarketingSection,
} from "@trainer/contracts";
import { availabilityChip, Chip } from "./chip";
import { claimCta, teachCta, type Cta } from "./frame";
import type { PublicPlatform } from "./platform";

/** What a page renderer gets: MarketingSite's props. */
export type Ctx = {
  page: MarketingPage;
  platform: PublicPlatform;
  origin: string;
  /**
   * "static" renders every Brain showcase as its still frame, with no engine
   * (MARKETING_SHOWCASE=static on the web service). Default "live".
   */
  showcase?: "live" | "static";
};

/** The page's text: registry copy with the platform name and figures filled in. */
export function pageText(platform: PublicPlatform): (s: string) => string {
  return (s) => brandText(s, platform.name, platform.followerModel);
}

export const dateLabel = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Dubai",
  }).format(new Date(iso + "T12:00:00Z"));

/**
 * The pages whose primary call to action is "Teach your AI — free"
 * (teachCta). Each page joins in the change that redesigns it; every other
 * page keeps claimCta or its own call to action.
 */
export const TEACH_CTA_PATHS: ReadonlySet<string> = new Set<string>(["/pricing", "/", "/trainer-brain", "/demo"]);

/** The CTA a page shows, following whether registration is open. */
export function primaryCta(page: MarketingPage, platform: PublicPlatform): Cta {
  if (TEACH_CTA_PATHS.has(page.path)) return teachCta(platform.registrationOpen);
  const claim = claimCta(platform.registrationOpen);
  if (!page.cta || page.cta.href === "/signup")
    return page.cta && platform.registrationOpen ? page.cta : claim;
  return page.cta;
}
/** The link beside the primary CTA: the page's own, or a calculator. */
export function secondaryCta(page: MarketingPage): Cta {
  if (page.secondaryCta) return page.secondaryCta;
  return page.path === "/follower-calculator"
    ? { label: "Estimate my earnings", href: "/earnings-calculator" }
    : { label: "Estimate what your followers are worth", href: "/follower-calculator" };
}

export function SourceNote({ ids }: { ids?: string[] }) {
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

/**
 * The head of every page but the home: eyebrow, H1 (with the Pace highlight
 * when the registry names one), the availability chip, one short statement
 * and the calls to action. `secondary` null leaves out the second link (the
 * calculators); `children` follow the buttons, such as a micro line.
 */
export function PageHead({
  page,
  platform,
  t,
  cta,
  secondary,
  children,
}: {
  page: MarketingPage;
  platform: PublicPlatform;
  t: (s: string) => string;
  cta: Cta;
  secondary: Cta | null;
  children?: ReactNode;
}) {
  const chip = availabilityChip(page, platform.availability);
  return (
    <header className="mk-page-head">
      <p className="eyebrow">{t(page.eyebrow)}</p>
      <h1>
        <Highlighted text={t(page.h1)} mark={page.h1Highlight} />
      </h1>
      {chip && <Chip chip={chip} />}
      {/* One short statement above the fold: the lede, or the
          answer-first introduction on pages without one. */}
      <p className={page.lede ? "mk-lede" : "mk-answer"}>{t(page.lede ?? page.intro)}</p>
      <div className="button-row">
        <Link className="button large mk-cta" href={cta.href}>
          {cta.label} <ArrowRight size={17} aria-hidden="true" />
        </Link>
        {secondary && (
          <Link className="text-link mk-link" href={secondary.href}>
            {secondary.label} <ArrowRight size={15} aria-hidden="true" />
          </Link>
        )}
      </div>
      {children}
    </header>
  );
}

/**
 * A page with a lede keeps its answer-first introduction (the text in
 * JSON-LD and llms-full.txt) as a short summary before the FAQs, instead of
 * repeating the lede straight under it. Pages without a lede show the
 * introduction in their head instead.
 */
export function InShort({ page, t }: { page: MarketingPage; t: (s: string) => string }) {
  if (!page.lede) return null;
  return (
    <section className="mk-section mk-in-short" id="in-short" aria-labelledby="in-short-h">
      <h2 id="in-short-h">In short</h2>
      <p className="mk-body">{t(page.intro)}</p>
    </section>
  );
}

export function Faqs({
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

export function Related({ page, t }: { page: MarketingPage; t: (s: string) => string }) {
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

/** The registry's review date, under the content. */
export function UpdatedLine({ page }: { page: MarketingPage }) {
  return (
    <p className="mk-updated muted">
      Last updated <time dateTime={page.lastUpdated}>{dateLabel(page.lastUpdated)}</time>
    </p>
  );
}

export function Breadcrumbs({ page, t }: { page: MarketingPage; t: (s: string) => string }) {
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
export function Closing({
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
export const HOW_IT_WORKS: Cta = { label: "See how it works", href: "/how-it-works" };
/** The closing panel's second link: the page's own, the follower estimate, or how it works. */
export function closingLink(page: MarketingPage): Cta {
  if (page.secondaryCta) return page.secondaryCta;
  return page.path === "/" || page.path === "/follower-calculator"
    ? HOW_IT_WORKS
    : { label: "What are my followers worth?", href: "/follower-calculator" };
}

/**
 * The Pace highlight on part of a heading; the text itself is unchanged. A
 * span, not <mark>: the emphasis is decorative, and screen readers can
 * announce <mark> as "highlight" in the middle of the H1.
 */
export function Highlighted({ text, mark }: { text: string; mark?: string }) {
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
