// The public marketing site registry: one typed list of pages from which the
// web pages, their metadata and JSON-LD, the discovery paths and sitemap, the
// navigation and footer, and llms.txt / llms-full.txt are all derived, so
// none of them can drift. Copy uses the token {APP_NAME}; it is replaced with
// the configured platform name (runtimeConfig().APP_NAME) when rendered.
import {
  AVAILABILITY_LINES,
  MARKETING_CONTENT,
  MARKETING_SOURCES,
  SETUP_CHECKLIST,
} from "./marketing-content.ts";
import {
  BRAND_ASSETS,
  BRAND_COPY,
  BRAND_NAME,
  BRAND_SHARE_IMAGE_ALT,
  usesBrandIdentity,
} from "./brand.ts";
export { AVAILABILITY_LINES, MARKETING_SOURCES, SETUP_CHECKLIST };

/**
 * The platform name when the Super admin has not set APP_NAME (the settings
 * default, and the fallback when the name cannot be read). A configured
 * APP_NAME overrides it everywhere.
 */
export const DEFAULT_PLATFORM_NAME = BRAND_NAME;

export type MarketingFaq = { q: string; a: string };
export type MarketingCard = { title: string; body: string; label?: string };
export type MarketingSection = {
  /** Stable anchor, also used by custom page layouts to place a block. */
  id: string;
  heading: string;
  body?: string[];
  bullets?: string[];
  cards?: MarketingCard[];
  steps?: Array<{ title: string; body: string }>;
  table?: { caption: string; columns: string[]; rows: string[][] };
  /** Fine print shown under the block. */
  note?: string;
  /** MARKETING_SOURCES ids cited by this block. */
  sources?: string[];
};
export type MarketingKind =
  | "home"
  | "page"
  | "feature"
  | "specialty"
  | "emirate"
  | "guide"
  | "hub"
  | "legal";
export type MarketingGroup =
  | "product"
  | "features"
  | "trainers"
  | "specialties"
  | "uae"
  | "guides"
  | "pricing"
  | "company"
  | "legal";
export type JsonLdKind =
  | "WebPage"
  | "AboutPage"
  | "CollectionPage"
  | "FAQPage"
  | "HowTo"
  | "Article"
  | "WebApplication";
/** Provider-driven availability shown as a chip on feature tiles and pages. */
export type AvailabilityKey =
  | "model"
  | "nutrition"
  | "voice"
  | "customDomains"
  | "payments"
  | "payouts"
  | "whoop"
  | "zepp"
  | "instagram"
  /** Active model profile: frontier tier, with a successful latest switch check. */
  | "frontier";
/**
 * A line shown only while an availability flag is on (for example the
 * "frontier model" wording, plan section 6). The registry pages keep the text
 * shown with the flag off; `marketingPageFor` is the one filter the pages,
 * their FAQ structured data and llms-full.txt all use.
 */
export type AvailabilityLine = {
  when: AvailabilityKey;
  /** The page it applies to; an FAQ answer without a path applies wherever the question appears. */
  path?: string;
  /** Appends a bullet to this section. */
  bullet?: { section: string; text: string };
  /** Replaces the body of the step or card with this title in this section. */
  body?: { section: string; title: string; text: string };
  /** Replaces the answer to this question, or (with a path) adds the question. */
  faq?: MarketingFaq;
};
export type MarketingPage = {
  path: string;
  kind: MarketingKind;
  group: MarketingGroup;
  /** Short label for navigation, footer and breadcrumbs. */
  navLabel: string;
  /** Document title before " | {APP_NAME}". */
  title: string;
  description: string;
  h1: string;
  /**
   * A substring of the H1 the renderer marks with the Pace highlight. The
   * H1 itself stays plain text for metadata, JSON-LD and llms files.
   */
  h1Highlight?: string;
  eyebrow: string;
  /**
   * A short hero line (25 words or fewer) shown under the H1 instead of the
   * introduction. The introduction then appears lower on the page, never
   * straight under the lede it would repeat: an "In short" section before
   * the FAQs, or on the home page the answer to its first FAQ. JSON-LD and
   * llms-full.txt carry it unchanged.
   */
  lede?: string;
  /**
   * Answer-first introduction (about 40-60 words). Shown under the H1 on
   * pages without a lede; see `lede` for where it goes on pages with one.
   */
  intro: string;
  /** Keyword hypothesis to validate after launch; no volume is claimed. */
  primaryKeyword: string;
  parent?: string;
  sections: MarketingSection[];
  faqs: MarketingFaq[];
  /** Primary call to action; defaults to claiming a coaching address. */
  cta?: { label: string; href: string };
  related: string[];
  /** ISO date of the last content review. */
  lastUpdated: string;
  indexable: boolean;
  jsonLd: JsonLdKind[];
  /** Feature pages: the providers whose status drives the chip. */
  availability?: AvailabilityKey[];
  /** "Included", "Optional tier", "Add-on"; shown when available. */
  offering?: string;
  /** Specialty pages: the price the follower calculator starts from. */
  examplePriceAed?: number;
  /** Legal pages keep their published-document renderer. */
  renderer?: "workspace";
};
/**
 * How much weight a source can bear, shown next to it on /methodology:
 * "Measured" (a dataset with a stated sample), "Measured; used as a proxy",
 * "Vendor claim", "Rule of thumb", "Creator example", "Platform statement",
 * "Official statistic", "Published price guide" or "Press report".
 */
export type SourceEvidence =
  | "Measured"
  | "Measured, brand accounts"
  | "Measured; used as a proxy"
  | "Vendor data"
  | "Vendor claim, no dataset"
  | "Rule of thumb"
  | "Creator example (owner-supplied)"
  | "Platform statement"
  | "Official statistic"
  | "Official announcement"
  | "Published price guide"
  | "Press report"
  | "Experiment";
export type MarketingSource = {
  id: string;
  publisher: string;
  title: string;
  url: string;
  evidence: SourceEvidence;
  /** Publication or update date as stated by the source, if any. */
  published?: string;
  retrieved: string;
  claim: string;
  usedFor: string;
};

/**
 * Specialties hidden from everything public for now (owner, 30 September
 * 2026): combat and endurance coaching need physical presence, and yoga and
 * pilates need their own workflow. Their specialty pages stay written in
 * marketing-content.ts but are left out of the registry (so every nav,
 * footer, sitemap, llms.txt, JSON-LD and hub listing drops them and their
 * addresses are a normal 404), and the directory specialty ids stay valid
 * but are not offered as choices. Remove an entry to switch it back on.
 */
export const HIDDEN_SPECIALTIES = ["combat", "endurance", "yoga", "pilates"] as const;
export type HiddenSpecialty = (typeof HIDDEN_SPECIALTIES)[number];
/** A specialty page slug or directory specialty id that is hidden. */
export function isHiddenSpecialty(slugOrId: string): boolean {
  return (HIDDEN_SPECIALTIES as readonly string[]).includes(
    slugOrId.replaceAll("_", "-"),
  );
}
function isHiddenPage(page: MarketingPage): boolean {
  return (
    page.kind === "specialty" &&
    isHiddenSpecialty(page.path.split("/").pop() ?? "")
  );
}

export const MARKETING_PAGES: readonly MarketingPage[] = MARKETING_CONTENT.filter(
  (page) => !isHiddenPage(page),
);
const byPath = new Map(MARKETING_PAGES.map((page) => [page.path, page]));

/** A trailing slash, query or fragment never changes the page. */
export function normalizeMarketingPath(path: string): string {
  return path.split(/[?#]/)[0].replace(/(.)\/+$/, "$1") || "/";
}
export function marketingPage(path: string): MarketingPage | undefined {
  return byPath.get(normalizeMarketingPath(path));
}
/** Every registry path, including legal pages rendered by the workspace. */
export function isMarketingPath(path: string): boolean {
  return byPath.has(normalizeMarketingPath(path));
}
/** Paths the marketing renderer owns (not the published legal documents). */
export function isMarketingSitePath(path: string): boolean {
  const page = marketingPage(path);
  return !!page && page.renderer !== "workspace";
}
/** Address prefixes whose unknown children are a 404, not the app. */
export const MARKETING_CHILD_PREFIXES = [
  "/features/",
  "/for-trainers/",
  "/uae/",
  "/guides/",
] as const;
/**
 * Retired addresses and where they now live (permanent redirects). The
 * Dubai and Abu Dhabi pages became sections of /uae: two thin pages with
 * the same bullets were a doorway pattern.
 */
export const MARKETING_REDIRECTS: Readonly<Record<string, string>> = {
  "/uae/dubai": "/uae#dubai",
  "/uae/abu-dhabi": "/uae#abu-dhabi",
};
export function marketingRedirect(path: string): string | undefined {
  return MARKETING_REDIRECTS[normalizeMarketingPath(path)];
}
export function isUnknownMarketingChild(path: string): boolean {
  const clean = normalizeMarketingPath(path);
  return (
    !byPath.has(clean) &&
    MARKETING_CHILD_PREFIXES.some((prefix) => clean.startsWith(prefix))
  );
}
export const INDEXABLE_MARKETING_PAGES = MARKETING_PAGES.filter(
  (page) => page.indexable,
);

/**
 * The editable calculator assumptions that page copy quotes. Copy uses tokens
 * such as {CLICK_SCENARIOS}, {PAID_SCENARIOS} and {ENGAGEMENT_AVG} so the
 * pages, the FAQ JSON-LD and llms-full.txt always state the values the
 * calculator uses (the Super admin can change them in platform settings).
 */
export type AssumptionScenario = "cautious" | "typical" | "strong";
export type AssumptionRates = {
  linkClickPct: number;
  dmOpenPct: number;
  broadcastClickPct: number;
  bioClickPct: number;
  paidPct: number;
  audienceRenewalPct: number;
};
export type AssumptionFigures = {
  scenarios: Record<AssumptionScenario, AssumptionRates>;
  engagementBenchmarkPct: number;
};
/** The cited defaults; equal to DEFAULT_FOLLOWER_MODEL (a test keeps them equal). */
export const CITED_ASSUMPTIONS: AssumptionFigures = {
  scenarios: {
    cautious: {
      linkClickPct: 1,
      dmOpenPct: 18,
      broadcastClickPct: 1.27,
      bioClickPct: 1,
      paidPct: 0.72,
      audienceRenewalPct: 0,
    },
    typical: {
      linkClickPct: 3,
      dmOpenPct: 30,
      broadcastClickPct: 1.45,
      bioClickPct: 2,
      paidPct: 2.9,
      audienceRenewalPct: 1.5,
    },
    strong: {
      linkClickPct: 5,
      dmOpenPct: 45,
      broadcastClickPct: 2.09,
      bioClickPct: 3,
      paidPct: 6.2,
      audienceRenewalPct: 8,
    },
  },
  engagementBenchmarkPct: 0.48,
};
const figure = (n: number) =>
  new Intl.NumberFormat("en-AE", { maximumFractionDigits: 2 }).format(n);
const figureRange = (low: number, high: number) =>
  low === high ? `${figure(low)}%` : `${figure(low)}-${figure(high)}%`;
/** "1%, 3% and 5%": cautious, typical and strong. */
const scenarioList = (figures: AssumptionFigures, key: keyof AssumptionRates) => {
  const { cautious, typical, strong } = figures.scenarios;
  return `${figure(cautious[key])}%, ${figure(typical[key])}% and ${figure(strong[key])}%`;
};
/** Replaces the brand and assumption tokens in registry copy. */
export function brandText(
  text: string,
  appName: string,
  figures: AssumptionFigures = CITED_ASSUMPTIONS,
): string {
  const { cautious, strong } = figures.scenarios;
  return text
    .replaceAll("{APP_NAME}", appName)
    .replaceAll(
      "{CLICK_RANGE}",
      figureRange(cautious.linkClickPct, strong.linkClickPct),
    )
    .replaceAll("{PURCHASE_RANGE}", figureRange(cautious.paidPct, strong.paidPct))
    .replaceAll("{CLICK_SCENARIOS}", scenarioList(figures, "linkClickPct"))
    .replaceAll("{PAID_SCENARIOS}", scenarioList(figures, "paidPct"))
    .replaceAll("{DM_SCENARIOS}", scenarioList(figures, "dmOpenPct"))
    .replaceAll("{BIO_SCENARIOS}", scenarioList(figures, "bioClickPct"))
    .replaceAll("{BROADCAST_SCENARIOS}", scenarioList(figures, "broadcastClickPct"))
    .replaceAll("{RENEWAL_SCENARIOS}", scenarioList(figures, "audienceRenewalPct"))
    .replaceAll("{RENEWAL_STRONG}", `${figure(strong.audienceRenewalPct)}%`)
    .replaceAll("{CLICK_STRONG}", `${figure(strong.linkClickPct)}%`)
    .replaceAll("{PAID_STRONG}", `${figure(strong.paidPct)}%`)
    .replaceAll(
      "{STRONG_PER_STORY}",
      `${figure((strong.linkClickPct * strong.paidPct) / 100)}%`,
    )
    .replaceAll("{ENGAGEMENT_AVG}", `${figure(figures.engagementBenchmarkPct)}%`);
}
/** The one entity sentence used on the home page, /about, llms.txt and JSON-LD. */
export const ENTITY_SENTENCE =
  "{APP_NAME} is a UAE platform that lets each personal trainer build a bespoke AI trainer, their Trainer Brain, from their own rules, cases and examples. It then sells personalised, day-by-day coaching to the trainer’s followers under the trainer’s own brand, priced in AED.";
export const NOT_STATEMENTS = [
  "It is not a generic workout generator: every plan follows the rules, cases and examples one trainer taught.",
  "It is not a medical service: pain, medical issues and red flags always go to the trainer, enforced in code.",
  "It does not replace the trainer: the Trainer Brain hands anything it is not confident about to the trainer.",
];

export function marketingBreadcrumbs(
  page: MarketingPage,
): Array<{ label: string; path: string }> {
  const chain: MarketingPage[] = [];
  let current: MarketingPage | undefined = page;
  const seen = new Set<string>();
  while (current && !seen.has(current.path)) {
    seen.add(current.path);
    chain.unshift(current);
    current = current.parent ? byPath.get(current.parent) : undefined;
  }
  if (chain[0]?.path !== "/") chain.unshift(byPath.get("/")!);
  return chain.map((p) => ({ label: p.navLabel, path: p.path }));
}
export function sourceById(id: string): MarketingSource | undefined {
  return MARKETING_SOURCES.find((source) => source.id === id);
}
/** Every source id a page cites, in order of first use. */
export function pageSources(page: MarketingPage): MarketingSource[] {
  const ids = [...new Set(page.sections.flatMap((s) => s.sources ?? []))];
  return ids.map((id) => sourceById(id)).filter((s) => !!s);
}

export type NavLink = { label: string; href: string };
export type NavGroup = { label: string; href?: string; links: NavLink[] };
const link = (path: string, label?: string): NavLink => ({
  label: label ?? byPath.get(path)?.navLabel ?? path,
  href: path,
});
/** Header navigation. */
export function marketingNav(): NavGroup[] {
  return [
    {
      label: "Product",
      links: [
        link("/how-it-works"),
        link("/trainer-brain"),
        link("/features"),
        link("/demo"),
        link("/security-and-privacy"),
      ],
    },
    {
      label: "For trainers",
      links: [
        link("/for-trainers", "By specialty"),
        link("/uae", "In the UAE"),
        link("/get-started"),
        link("/guides"),
      ],
    },
    { label: "Pricing", href: "/pricing", links: [] },
    {
      label: "Calculators",
      links: [link("/earnings-calculator"), link("/follower-calculator")],
    },
  ];
}
/** Footer site map: every indexable page, grouped. */
export function marketingFooter(): Array<{ label: string; links: NavLink[] }> {
  const of = (...groups: MarketingGroup[]) =>
    INDEXABLE_MARKETING_PAGES.filter(
      (p) => groups.includes(p.group) && p.path !== "/",
    ).map((p) => link(p.path));
  return [
    { label: "Product", links: of("product") },
    { label: "Features", links: of("features") },
    {
      label: "For trainers",
      links: [...of("trainers", "specialties", "uae", "guides")],
    },
    { label: "Pricing and tools", links: of("pricing") },
    {
      label: "Company",
      links: [...of("company"), link("/coaches", "Find a coach"), ...of("legal")],
    },
  ];
}

export type MarketingContext = {
  origin: string;
  appName: string;
  supportEmail?: string | null;
  /** The follower model in use, for the assumption tokens in copy. */
  followerModel?: AssumptionFigures;
  /** Provider availability; lines gated on a flag show only while it is on. */
  availability?: Partial<Record<AvailabilityKey, boolean>>;
};

/**
 * The page as shown for this availability: each AVAILABILITY_LINES entry whose
 * flag is on is applied; with every flag off (or none given) the page is the
 * registry text unchanged. Applying it twice changes nothing.
 */
export function marketingPageFor(
  page: MarketingPage,
  availability: Partial<Record<AvailabilityKey, boolean>> | undefined,
): MarketingPage {
  const lines = AVAILABILITY_LINES.filter(
    (line) =>
      availability?.[line.when] === true &&
      (line.path === undefined || line.path === page.path),
  );
  if (!lines.length) return page;
  let sections = page.sections;
  let faqs = page.faqs;
  for (const line of lines) {
    if (line.bullet) {
      const { section, text } = line.bullet;
      sections = sections.map((s) =>
        s.id === section && !(s.bullets ?? []).includes(text)
          ? { ...s, bullets: [...(s.bullets ?? []), text] }
          : s,
      );
    }
    if (line.body) {
      const { section, title, text } = line.body;
      const swap = <T extends { title: string; body: string }>(items?: T[]) =>
        items?.map((item) => (item.title === title ? { ...item, body: text } : item));
      sections = sections.map((s) =>
        s.id === section ? { ...s, cards: swap(s.cards), steps: swap(s.steps) } : s,
      );
    }
    if (line.faq) {
      const faq = line.faq;
      if (faqs.some((f) => f.q === faq.q))
        faqs = faqs.map((f) => (f.q === faq.q ? { ...f, a: faq.a } : f));
      else if (line.path !== undefined) faqs = [...faqs, faq];
    }
  }
  // Keep absent optional fields absent (renderers test for presence).
  sections = sections.map((s) => {
    const out = { ...s };
    if (out.cards === undefined) delete out.cards;
    if (out.steps === undefined) delete out.steps;
    return out;
  });
  return { ...page, sections, faqs };
}
/**
 * The social preview image of a page: the supplied trainsyou share card for
 * the brand's home page, otherwise app/og/route.tsx renders the page's own.
 */
export function marketingImage(origin: string, path: string, appName?: string) {
  const base = new URL(origin).origin;
  const normalized = normalizeMarketingPath(path);
  if (normalized === "/" && usesBrandIdentity(appName))
    return base + BRAND_ASSETS.shareImage;
  return base + "/og?path=" + encodeURIComponent(normalized);
}
export const MARKETING_IMAGE_SIZE = { width: 1200, height: 630 } as const;
/** The generated logo: initials of the configured name (API-rendered PNG). */
export const PLATFORM_LOGO_PATH = "/api/v1/public/platform/icon/512.png";
/** The organisation logo: the trainsyou lockup, or the generated initials. */
export function platformLogoPath(appName?: string) {
  return usesBrandIdentity(appName)
    ? BRAND_ASSETS.lockupInkPng
    : PLATFORM_LOGO_PATH;
}
/** The canonical address of a platform path. */
export function marketingCanonical(origin: string, path: string) {
  const base = new URL(origin).origin;
  return path === "/" ? base + "/" : base + path;
}

/** Plain metadata for a page; apps/web maps it onto Next's Metadata. */
export function marketingMetadata(page: MarketingPage, ctx: MarketingContext) {
  const title = `${brandText(page.title, ctx.appName, ctx.followerModel)} | ${ctx.appName}`;
  const description = brandText(page.description, ctx.appName, ctx.followerModel);
  const url = marketingCanonical(ctx.origin, page.path);
  const imageUrl = marketingImage(ctx.origin, page.path, ctx.appName);
  // The brand's home page shares the supplied card, whose alternative text
  // describes the card's own words; generated cards show the page's H1.
  const staticCard = imageUrl.endsWith(BRAND_ASSETS.shareImage);
  const image = {
    url: imageUrl,
    ...MARKETING_IMAGE_SIZE,
    alt: staticCard
      ? BRAND_SHARE_IMAGE_ALT
      : brandText(page.h1, ctx.appName, ctx.followerModel),
  };
  return {
    title,
    description,
    canonical: url,
    robots: page.indexable
      ? { index: true, follow: true }
      : { index: false, follow: true },
    openGraph: {
      type: page.kind === "guide" ? ("article" as const) : ("website" as const),
      url,
      title,
      description,
      siteName: ctx.appName,
      locale: "en_AE",
      images: [image],
    },
    twitter: {
      card: "summary_large_image" as const,
      title,
      description,
      images: [image.url],
    },
  };
}

/** Schema.org JSON-LD for a page, built only from text the page shows. */
export function marketingJsonLd(shown: MarketingPage, ctx: MarketingContext) {
  const page = marketingPageFor(shown, ctx.availability);
  const t = (text: string) => brandText(text, ctx.appName, ctx.followerModel);
  const base = new URL(ctx.origin).origin;
  const url = marketingCanonical(ctx.origin, page.path);
  const orgId = base + "/#organization";
  const organization = {
    "@type": "Organization",
    "@id": orgId,
    name: ctx.appName,
    url: base + "/",
    logo: base + platformLogoPath(ctx.appName),
    // The brand line is shown in every marketing footer.
    ...(usesBrandIdentity(ctx.appName) ? { slogan: BRAND_COPY.line } : {}),
    description: t(ENTITY_SENTENCE),
    areaServed: { "@type": "Country", name: "United Arab Emirates" },
    ...(ctx.supportEmail
      ? {
          contactPoint: {
            "@type": "ContactPoint",
            contactType: "customer support",
            email: ctx.supportEmail,
          },
        }
      : {}),
  };
  // Every page carries the Organization and WebSite nodes its references
  // (publisher, isPartOf, author) point at; the full description stays on
  // the home and about pages.
  const graph: Array<Record<string, unknown>> = [
    page.path === "/" || page.path === "/about"
      ? organization
      : {
          "@type": "Organization",
          "@id": orgId,
          name: ctx.appName,
          url: base + "/",
          logo: organization.logo,
        },
    {
      "@type": "WebSite",
      "@id": base + "/#website",
      url: base + "/",
      name: ctx.appName,
      inLanguage: "en-AE",
      publisher: { "@id": orgId },
    },
  ];
  const image = marketingImage(ctx.origin, page.path, ctx.appName);
  const primary = page.jsonLd.find((k) => k !== "FAQPage") ?? "WebPage";
  const webPage: Record<string, unknown> = {
    "@type": primary === "HowTo" || primary === "WebApplication" ? "WebPage" : primary,
    "@id": url + "#webpage",
    url,
    name: t(page.h1),
    description: t(page.description),
    inLanguage: "en-AE",
    dateModified: page.lastUpdated,
    isPartOf: { "@id": base + "/#website" },
    publisher: { "@id": orgId },
    breadcrumb: { "@id": url + "#breadcrumb" },
    primaryImageOfPage: { "@type": "ImageObject", url: image },
  };
  if (primary === "Article") {
    Object.assign(webPage, {
      "@type": "Article",
      headline: t(page.h1),
      datePublished: page.lastUpdated,
      author: { "@type": "Organization", name: ctx.appName, url: base + "/" },
      image,
      mainEntityOfPage: url,
    });
  }
  graph.push(webPage);
  graph.push({
    "@type": "BreadcrumbList",
    "@id": url + "#breadcrumb",
    itemListElement: marketingBreadcrumbs(page).map((crumb, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: t(crumb.label),
      item: marketingCanonical(ctx.origin, crumb.path),
    })),
  });
  if (page.jsonLd.includes("HowTo")) {
    const steps = page.sections.find((s) => s.steps)?.steps ?? [];
    graph.push({
      "@type": "HowTo",
      "@id": url + "#howto",
      name: t(page.h1),
      description: t(page.intro),
      step: steps.map((step, i) => ({
        "@type": "HowToStep",
        position: i + 1,
        name: t(step.title),
        text: t(step.body),
      })),
    });
  }
  if (page.jsonLd.includes("WebApplication"))
    graph.push({
      "@type": "WebApplication",
      "@id": url + "#app",
      name: t(page.h1),
      url,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Any (web browser)",
      isAccessibleForFree: true,
      description: t(page.intro),
      publisher: { "@id": orgId },
    });
  if (page.faqs.length && page.jsonLd.includes("FAQPage"))
    graph.push({
      "@type": "FAQPage",
      "@id": url + "#faq",
      mainEntity: page.faqs.map((faq) => ({
        "@type": "Question",
        name: t(faq.q),
        acceptedAnswer: { "@type": "Answer", text: t(faq.a) },
      })),
    });
  return { "@context": "https://schema.org", "@graph": graph };
}
/** JSON for a <script type="application/ld+json">, safe inside HTML. */
export function jsonLdScript(value: unknown): string {
  const separators = new RegExp("[\\u2028\\u2029]", "g");
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(separators, (c) => "\\u" + c.charCodeAt(0).toString(16));
}

/** The approved brand lines, when the platform carries the trainsyou brand. */
function brandSummary(appName: string): string[] {
  if (!usesBrandIdentity(appName)) return [];
  return [
    `${BRAND_COPY.descriptor}. ${BRAND_COPY.audience}. ${BRAND_COPY.line}`,
    "",
    BRAND_COPY.introduction,
    "",
  ];
}
/** llms.txt (llmstxt.org): H1, summary blockquote, then H2 link lists. */
export function llmsTxt(ctx: MarketingContext): string {
  const t = (text: string) => brandText(text, ctx.appName, ctx.followerModel);
  const line = (p: MarketingPage) =>
    `- [${t(p.navLabel)}](${marketingCanonical(ctx.origin, p.path)}): ${t(p.description)}`;
  const group = (...groups: MarketingGroup[]) =>
    INDEXABLE_MARKETING_PAGES.filter(
      (p) => groups.includes(p.group) && p.path !== "/",
    ).map(line);
  return [
    `# ${ctx.appName}`,
    "",
    `> ${t(ENTITY_SENTENCE)}`,
    "",
    ...brandSummary(ctx.appName),
    ...NOT_STATEMENTS.map((s) => `- ${s}`),
    "- Earnings and follower figures on this site are estimates with shown assumptions and cited sources, never promises. The follower calculator's headline is a strong case for an engaged, growing audience and weekly sharing, not a typical result; its cautious and typical scenarios are shown with it.",
    "",
    "## Product",
    ...group("product"),
    "",
    "## Features",
    ...group("features"),
    "",
    "## Pricing and calculators",
    ...group("pricing"),
    "",
    "## For trainers",
    ...group("trainers", "specialties", "uae"),
    "",
    "## Guides",
    ...group("guides"),
    "",
    "## Company",
    ...group("company"),
    `- [Find a coach](${marketingCanonical(ctx.origin, "/coaches")}): Public directory of published coaches who chose to be listed.`,
    "",
    "## Optional",
    `- [Full text for language models](${marketingCanonical(ctx.origin, "/llms-full.txt")}): Every page's text, FAQs and sources in one file.`,
    ...group("legal"),
    "",
  ].join("\n");
}

function sectionMarkdown(section: MarketingSection, t: (s: string) => string) {
  const out = [`### ${t(section.heading)}`, ""];
  for (const p of section.body ?? []) out.push(t(p), "");
  for (const b of section.bullets ?? []) out.push(`- ${t(b)}`);
  if (section.bullets?.length) out.push("");
  for (const c of section.cards ?? [])
    out.push(`- **${t(c.title)}**${c.label ? ` (${t(c.label)})` : ""}: ${t(c.body)}`);
  if (section.cards?.length) out.push("");
  (section.steps ?? []).forEach((s, i) =>
    out.push(`${i + 1}. **${t(s.title)}**: ${t(s.body)}`),
  );
  if (section.steps?.length) out.push("");
  if (section.table) {
    out.push(`${t(section.table.caption)}:`, "");
    out.push(`| ${section.table.columns.map(t).join(" | ")} |`);
    out.push(`| ${section.table.columns.map(() => "---").join(" | ")} |`);
    for (const row of section.table.rows) out.push(`| ${row.map(t).join(" | ")} |`);
    out.push("");
  }
  if (section.note) out.push(`_${t(section.note)}_`, "");
  for (const id of section.sources ?? []) {
    const s = sourceById(id);
    if (s) out.push(`Source: ${s.publisher}, "${s.title}", ${s.url}`);
  }
  if (section.sources?.length) out.push("");
  return out;
}
/** Every indexable marketing page as Markdown, for language models. */
export function llmsFullTxt(ctx: MarketingContext): string {
  const t = (text: string) => brandText(text, ctx.appName, ctx.followerModel);
  const out = [
    `# ${ctx.appName}: full site text`,
    "",
    `> ${t(ENTITY_SENTENCE)}`,
    "",
    ...brandSummary(ctx.appName),
  ];
  for (const registered of INDEXABLE_MARKETING_PAGES) {
    if (registered.renderer === "workspace") continue;
    const page = marketingPageFor(registered, ctx.availability);
    out.push(
      `## ${t(page.h1)}`,
      "",
      `URL: ${marketingCanonical(ctx.origin, page.path)}`,
      `Last updated: ${page.lastUpdated}`,
      "",
      t(page.intro),
      "",
    );
    for (const section of page.sections) {
      out.push(...sectionMarkdown(section, t));
      if (page.path === "/get-started" && section.id === "checklist")
        out.push(...SETUP_CHECKLIST.map((step, i) => `${i + 1}. ${step.label} (about ${step.minutes} min): ${step.summary}`));
    }
    if (page.faqs.length) {
      out.push("### Frequently asked questions", "");
      for (const faq of page.faqs) out.push(`**${t(faq.q)}**`, "", t(faq.a), "");
    }
  }
  out.push("## Sources", "");
  for (const s of MARKETING_SOURCES)
    out.push(
      `- ${s.publisher}, "${s.title}"${s.published ? ` (${s.published})` : ""}, retrieved ${s.retrieved} [${s.evidence}]: ${s.claim} ${s.url}`,
    );
  out.push("");
  return out.join("\n");
}

/**
 * The pages the home page voice assistant may speak from
 * (docs/features/kamran-assistant.md): the site's own words, as shown for
 * this availability, and nothing else. Feature pages contribute their
 * one-line description.
 */
export const ASSISTANT_FACT_PAGES = [
  "/",
  "/how-it-works",
  "/trainer-brain",
  "/pricing",
  "/earnings-calculator",
  "/follower-calculator",
  "/faq",
  "/get-started",
  "/about",
  "/security-and-privacy",
] as const;
/** The site facts the assistant is grounded in, as plain text. */
export function marketingAssistantFacts(ctx: MarketingContext): string {
  const t = (text: string) => brandText(text, ctx.appName, ctx.followerModel);
  const out: string[] = [];
  // Shared answers appear on several pages; each is given once.
  const seen = new Set<string>();
  for (const path of ASSISTANT_FACT_PAGES) {
    const registered = marketingPage(path);
    if (!registered) continue;
    const page = marketingPageFor(registered, ctx.availability);
    out.push(`## ${t(page.navLabel)} (${page.path})`, t(page.intro));
    // The calculator pages' own blocks are the calculators: the assistant asks
    // the code for numbers instead of reading the worked examples.
    if (!path.endsWith("-calculator"))
      for (const s of page.sections) {
        const lines = [
          ...(s.body ?? []),
          ...(s.bullets ?? []).map((b) => `- ${b}`),
          ...(s.cards ?? []).map((c) => `- ${c.title}: ${c.body}`),
          ...(s.steps ?? []).map((c, i) => `${i + 1}. ${c.title}: ${c.body}`),
          ...(s.table
            ? [s.table.caption + ":", ...s.table.rows.map((r) => r.join(" | "))]
            : []),
        ];
        if (lines.length) out.push(`### ${t(s.heading)}`, ...lines.map(t));
      }
    for (const f of page.faqs) {
      if (seen.has(f.q)) continue;
      seen.add(f.q);
      out.push(`Q: ${t(f.q)}`, `A: ${t(f.a)}`);
    }
    if (path === "/get-started")
      out.push(...SETUP_CHECKLIST.map((step, i) => `${i + 1}. ${step.label} (about ${step.minutes} min): ${step.summary}`));
    out.push("");
  }
  // Ground new product questions in shared answers without repeating whole feature pages.
  for (const path of ["/features/website-and-domain", "/features/subscriber-app", "/features/voice-coach"]) {
    const page = marketingPage(path)!;
    out.push(`## ${t(page.navLabel)} (${path})`);
    for (const faq of page.faqs) {
      if (seen.has(faq.q)) continue;
      seen.add(faq.q);
      out.push(`Q: ${t(faq.q)}`, `A: ${t(faq.a)}`);
    }
  }
  out.push("## Features (one line each)");
  for (const page of MARKETING_PAGES)
    if (page.kind === "feature")
      out.push(`- ${t(page.navLabel)}: ${t(page.description)}`);
  return out.join("\n");
}
