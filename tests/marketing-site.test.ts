// Public marketing site: registry integrity, per-page metadata, JSON-LD,
// discovery (sitemap paths, llms.txt), calculator arithmetic and disclaimers,
// and honesty scans (no registrar name, no invented social proof).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CAPABILITY_COUNT,
  CITED_ASSUMPTIONS,
  DIRECTORY_SPECIALTIES,
  FEATURE_MATRIX,
  REPLACES,
  ENTITY_SENTENCE,
  INDEXABLE_MARKETING_PAGES,
  MARKETING_PAGES,
  MARKETING_SOURCES,
  PRIVATE_ROUTE_SEGMENTS,
  PUBLIC_MARKETING_PATHS,
  SETUP_CHECKLIST,
  brandText,
  isIndexablePlatformPath,
  isMarketingPath,
  isMarketingSitePath,
  isUnknownMarketingChild,
  jsonLdScript,
  llmsFullTxt,
  llmsTxt,
  marketingBreadcrumbs,
  marketingFooter,
  marketingJsonLd,
  marketingMetadata,
  marketingNav,
  marketingPage,
  marketingRedirect,
  MARKETING_REDIRECTS,
  robotsPolicy,
  type MarketingPage,
} from "@trainer/contracts";
import { projectedCommission, safetySignal } from "@trainer/domain";
import { SAFETY_FLOOR } from "../packages/domain/src/safety-policy.ts";
import {
  DEFAULT_FOLLOWER_INPUTS,
  DEFAULT_FOLLOWER_MODEL,
  FOLLOWER_MODEL_SETTING_KEYS,
  aedWhole,
  displayCount,
  displayRange,
  estimateEarnings,
  estimateFollowerConversion,
  followerModelFromSettings,
  type EarningsInputs,
} from "../packages/domain/src/marketing-calculators.ts";
import { baseRegistry } from "../apps/api/src/onboarding.ts";
import { MarketingSite } from "../apps/web/components/marketing/site.tsx";
import {
  EarningsCalculator,
  FollowerCalculator,
  slugFromName,
  withEarlyAccessContext,
} from "../apps/web/components/marketing/islands.tsx";
import type { PublicPlatform } from "../apps/web/components/marketing/platform.ts";
import { INTEGRATION_CATALOG } from "../packages/providers/src/configuration.ts";

const ORIGIN = "https://trainsyou.example";
// The platform default (DEFAULT_PLATFORM_NAME): the trainsyou brand.
const APP = "trainsyou";
const ctx = { origin: ORIGIN, appName: APP, supportEmail: "hello@trainsyou.example" };
const platform: PublicPlatform = {
  name: APP,
  initials: "T",
  supportEmail: ctx.supportEmail,
  companyDetails: null,
  registrationOpen: true,
  coachAddressTemplate: ORIGIN + "/coach/{slug}",
  availability: {
    model: true,
    nutrition: false,
    voice: false,
    customDomains: false,
    payments: true,
    payouts: true,
    whoop: false,
    zepp: false,
    instagram: false,
  },
  followerModel: DEFAULT_FOLLOWER_MODEL,
};
const site = MARKETING_PAGES.filter((p) => p.renderer !== "workspace");
const render = (page: MarketingPage, p: PublicPlatform = platform) =>
  renderToStaticMarkup(
    createElement(MarketingSite, { page, platform: p, origin: ORIGIN }),
  );
const decode = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ");
const allText = (page: MarketingPage) =>
  [
    page.title,
    page.description,
    page.h1,
    page.intro,
    page.eyebrow,
    ...page.sections.flatMap((s) => [
      s.heading,
      ...(s.body ?? []),
      ...(s.bullets ?? []),
      ...(s.cards ?? []).flatMap((c) => [c.title, c.body, c.label ?? ""]),
      ...(s.steps ?? []).flatMap((st) => [st.title, st.body]),
      ...(s.table ? [s.table.caption, ...s.table.columns, ...s.table.rows.flat()] : []),
      s.note ?? "",
    ]),
    ...page.faqs.flatMap((f) => [f.q, f.a]),
  ].join("\n");

test("registry: unique paths, titles, descriptions and headings; parents, related links and sources resolve", () => {
  const unique = (values: string[], what: string) =>
    assert.equal(new Set(values).size, values.length, `duplicate ${what}`);
  unique(MARKETING_PAGES.map((p) => p.path), "path");
  unique(MARKETING_PAGES.map((p) => p.title), "title");
  unique(MARKETING_PAGES.map((p) => p.description), "description");
  unique(MARKETING_PAGES.map((p) => p.h1), "h1");
  const sourceIds = new Set(MARKETING_SOURCES.map((s) => s.id));
  unique(MARKETING_SOURCES.map((s) => s.id), "source id");
  for (const page of MARKETING_PAGES) {
    assert.match(page.path, /^\/[a-z0-9/-]*$/, page.path);
    assert.match(page.lastUpdated, /^\d{4}-\d{2}-\d{2}$/, page.path);
    assert.ok(
      page.description.length >= 70 && page.description.length <= 175,
      `${page.path} description is ${page.description.length} characters`,
    );
    if (page.parent) assert.ok(marketingPage(page.parent), page.path + " parent");
    for (const path of page.related)
      assert.ok(path === "/coaches" || marketingPage(path), `${page.path} → ${path}`);
    for (const section of page.sections)
      for (const id of section.sources ?? [])
        assert.ok(sourceIds.has(id), `${page.path} cites unknown ${id}`);
    unique(page.sections.map((s) => s.id), page.path + " section id");
    if (page.renderer !== "workspace") {
      const words = brandText(page.intro, APP).split(/\s+/).length;
      // Answer-first introductions: about 40-60 words.
      assert.ok(words >= 35 && words <= 65, `${page.path} intro has ${words} words`);
    }
    // No marketing page sits under a private app or sign-in address.
    assert.ok(
      !(PRIVATE_ROUTE_SEGMENTS as readonly string[]).includes(page.path.split("/")[1]),
      page.path,
    );
  }
  for (const source of MARKETING_SOURCES) {
    assert.match(source.url, /^https:\/\//);
    assert.match(source.retrieved, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test("the brief's page set exists: core pages, 11 features, 8 specialties, the UAE page and guides", () => {
  for (const path of [
    "/",
    "/how-it-works",
    "/trainer-brain",
    "/demo",
    "/features",
    "/pricing",
    "/earnings-calculator",
    "/follower-calculator",
    "/security-and-privacy",
    "/faq",
    "/about",
    "/methodology",
    "/get-started",
    "/for-trainers",
    "/uae",
    "/guides",
  ])
    assert.ok(isMarketingSitePath(path), path);
  // Dubai and Abu Dhabi are sections of /uae; their old addresses redirect.
  assert.equal(marketingRedirect("/uae/dubai"), "/uae#dubai");
  assert.equal(marketingRedirect("/uae/abu-dhabi/"), "/uae#abu-dhabi");
  const uae = marketingPage("/uae")!;
  for (const id of ["dubai", "abu-dhabi"]) assert.ok(uae.sections.some((s) => s.id === id), id);
  for (const target of Object.values(MARKETING_REDIRECTS))
    assert.ok(isMarketingSitePath(target.split("#")[0]), target);
  assert.equal(MARKETING_PAGES.filter((p) => p.kind === "feature").length, 11);
  const specialties = MARKETING_PAGES.filter((p) => p.kind === "specialty");
  assert.equal(specialties.length, 8);
  // Specialty slugs are directory specialty ids with hyphens.
  const ids = new Set<string>(DIRECTORY_SPECIALTIES.map((s) => s.id));
  for (const page of specialties) {
    const slug = page.path.split("/").pop()!;
    assert.ok(ids.has(slug.replaceAll("-", "_")), slug);
    assert.equal(page.sections.find((s) => s.id === "rules")?.cards?.length, 3);
    assert.ok(page.sections.every((s) => s.id !== "rules" || s.cards!.every((c) => c.label === "Illustrative")));
    assert.ok(page.examplePriceAed! > 0);
  }
  // No Sharjah page until it has genuinely local content (doorway pages).
  assert.equal(marketingPage("/uae/sharjah"), undefined);
});

test("specialty pages match the safety floor: enforced items are listed as enforced, trainer examples never repeat them", () => {
  const specialties = MARKETING_PAGES.filter((p) => p.kind === "specialty");
  assert.equal(specialties.length, 8);
  for (const page of specialties) {
    const floor = page.sections.find((s) => s.id === "floor")?.bullets ?? [];
    const handoffs = page.sections.find((s) => s.id === "handoffs")?.bullets ?? [];
    assert.ok(floor.length > 0 && handoffs.length > 0, page.path);
    // Every "enforced in code" claim is really caught by the red-flag screen.
    for (const item of floor) assert.equal(safetySignal(item), true, `${page.path}: ${item}`);
    // "Examples a trainer might set" never lists what the floor already does.
    for (const item of handoffs) assert.equal(safetySignal(item), false, `${page.path}: ${item}`);
    for (const card of page.sections.find((s) => s.id === "rules")?.cards ?? [])
      assert.equal(safetySignal(card.body), false, `${page.path} rule: ${card.title}`);
  }
  // Pregnancy is a mandatory hold, so the page says so and never promises routine automation.
  assert.ok(SAFETY_FLOOR.holdCategories.includes("pregnancy"));
  const prenatal = marketingPage("/for-trainers/pre-postnatal")!;
  const prenatalText = allText(prenatal);
  assert.match(prenatalText, /Any mention of pregnancy, bleeding, dizziness or chest pain pauses training/);
  assert.match(prenatalText, /For pregnant subscribers the Brain drafts and you approve/);
  assert.doesNotMatch(prenatalText, /plan routine sessions/);
});

test("discovery: every indexable page is a public marketing path and in the sitemap list", () => {
  assert.deepEqual(
    [...PUBLIC_MARKETING_PATHS],
    INDEXABLE_MARKETING_PAGES.map((p) => p.path),
  );
  for (const legacy of ["/", "/how-it-works", "/demo", "/pricing", "/faq", "/terms", "/privacy", "/ai-disclosure"])
    assert.ok(PUBLIC_MARKETING_PATHS.includes(legacy), legacy);
  for (const path of PUBLIC_MARKETING_PATHS) {
    assert.equal(isIndexablePlatformPath(path), true, path);
    assert.equal(isMarketingPath(path + "/"), true, path);
  }
  assert.equal(isUnknownMarketingChild("/features/teleportation"), true);
  assert.equal(isUnknownMarketingChild("/features/nutrition"), false);
  assert.equal(isUnknownMarketingChild("/uae/sharjah"), true);
  assert.equal(isUnknownMarketingChild("/trainer/growth"), false);
  assert.equal(isIndexablePlatformPath("/features/teleportation"), false);
  // robots.txt keeps allowing every crawler (including AI search) on the platform.
  const robots = robotsPolicy(ORIGIN, false);
  assert.deepEqual(robots.rules.allow, ["/"]);
  assert.equal(robots.sitemap, ORIGIN + "/sitemap.xml");
  // RFC 9309: "$" anchors the end, anything else is a prefix.
  const blocked = (path: string) =>
    robots.rules.disallow.some((rule) =>
      rule.endsWith("$") ? path === rule.slice(0, -1) : path.startsWith(rule),
    );
  for (const path of PUBLIC_MARKETING_PATHS) assert.equal(blocked(path), false, path);
  assert.equal(blocked("/trainer/growth"), true);
  // Navigation and the footer site map only point at registry pages.
  for (const group of marketingNav())
    for (const link of [...group.links, ...(group.href ? [{ href: group.href }] : [])])
      assert.ok(isMarketingSitePath(link.href), link.href);
  const footer = marketingFooter().flatMap((c) => c.links.map((l) => l.href));
  for (const path of PUBLIC_MARKETING_PATHS)
    if (path !== "/") assert.ok(footer.includes(path), "footer misses " + path);
});

test("metadata: unique branded titles, canonical and Open Graph addresses per page", () => {
  const titles = new Set<string>();
  for (const page of MARKETING_PAGES) {
    const m = marketingMetadata(page, ctx);
    assert.ok(m.title.endsWith(" | " + APP), m.title);
    assert.ok(!titles.has(m.title), "duplicate title " + m.title);
    titles.add(m.title);
    // Search results show about 60 characters of a title and 155 of a description.
    assert.ok(m.title.length <= 60, `${page.path} title too long (${m.title.length}): ${m.title}`);
    assert.ok(m.description.length <= 155, `${page.path} description too long (${m.description.length})`);
    assert.doesNotMatch(m.title, new RegExp(`${APP}.*\\| ${APP}$`), `${page.path} repeats the brand`);
    // A large social preview of this page; the brand's home page uses the
    // supplied trainsyou share card.
    assert.equal(m.twitter.card, "summary_large_image");
    assert.equal(
      m.openGraph.images[0].url,
      page.path === "/"
        ? ORIGIN + "/brand/social-share-1200x630.png"
        : ORIGIN + "/og?path=" + encodeURIComponent(page.path),
    );
    assert.equal(m.twitter.images[0], m.openGraph.images[0].url);
    assert.equal(m.canonical, page.path === "/" ? ORIGIN + "/" : ORIGIN + page.path);
    assert.equal(m.openGraph.url, m.canonical);
    assert.equal(m.openGraph.siteName, APP);
    assert.equal(m.openGraph.locale, "en_AE");
    assert.equal(m.twitter.title, m.title);
    assert.equal(m.robots.index, page.indexable);
    for (const text of [m.title, m.description])
      assert.doesNotMatch(text, /\{APP_NAME\}/);
  }
  // The brand is never hard-coded: another name renders everywhere, with
  // its own generated preview instead of the trainsyou artwork.
  for (const page of site) {
    const text = brandText(allText(page), "Acme Coaching");
    assert.doesNotMatch(text, /\{APP_NAME\}|trainsyou|Trainer Brain Platform/i, page.path);
  }
  const acme = marketingMetadata(marketingPage("/")!, { ...ctx, appName: "Acme Coaching" });
  assert.equal(acme.openGraph.images[0].url, ORIGIN + "/og?path=%2F");
  assert.equal(acme.title, "AI personal trainer platform for UAE coaches | Acme Coaching");
});

test("JSON-LD: valid schema.org graphs built from the page's visible text", () => {
  for (const page of site) {
    const graph = marketingJsonLd(page, ctx);
    const script = jsonLdScript(graph);
    assert.doesNotMatch(script, /<|>/, page.path);
    const parsed = JSON.parse(script);
    assert.equal(parsed["@context"], "https://schema.org");
    const nodes = parsed["@graph"] as any[];
    for (const node of nodes) assert.equal(typeof node["@type"], "string", page.path);
    const crumbs = nodes.find((n) => n["@type"] === "BreadcrumbList");
    assert.deepEqual(
      crumbs.itemListElement.map((i: any) => i.position),
      marketingBreadcrumbs(page).map((_, i) => i + 1),
    );
    assert.equal(crumbs.itemListElement[0].item, ORIGIN + "/");
    assert.equal(crumbs.itemListElement.at(-1).item, page.path === "/" ? ORIGIN + "/" : ORIGIN + page.path);
    const html = decode(render(page));
    assert.ok(html.includes(brandText(page.h1, APP)), page.path + " h1 visible");
    const faq = nodes.find((n) => n["@type"] === "FAQPage");
    if (page.faqs.length && page.jsonLd.includes("FAQPage")) {
      assert.equal(faq.mainEntity.length, page.faqs.length, page.path);
      for (const q of faq.mainEntity) {
        assert.ok(html.includes(q.name), `${page.path}: question not visible: ${q.name}`);
        assert.ok(html.includes(q.acceptedAnswer.text), `${page.path}: answer not visible`);
      }
    } else assert.equal(faq, undefined, page.path);
    const howTo = nodes.find((n) => n["@type"] === "HowTo");
    if (howTo)
      for (const step of howTo.step) assert.ok(html.includes(step.text), step.name);
    const webPage = nodes.find((n) => String(n["@id"]).endsWith("#webpage"));
    assert.equal(webPage.url, page.path === "/" ? ORIGIN + "/" : ORIGIN + page.path);
    assert.equal(webPage.dateModified, page.lastUpdated);
  }
  // Every page carries the Organization and WebSite nodes it refers to.
  for (const page of site) {
    const nodes = marketingJsonLd(page, ctx)["@graph"] as any[];
    const ids = new Set(nodes.map((n) => n["@id"]));
    const org = nodes.find((n) => n["@type"] === "Organization");
    assert.equal(org?.name, APP, page.path);
    assert.equal(org.logo, ORIGIN + "/brand/trainsyou-lockup-ink.png");
    assert.ok(nodes.some((n) => n["@type"] === "WebSite"), page.path);
    for (const ref of JSON.stringify(nodes).matchAll(/"@id":"([^"]+)"/g))
      assert.ok(ids.has(ref[1]), `${page.path}: dangling reference ${ref[1]}`);
  }
  const home = JSON.parse(jsonLdScript(marketingJsonLd(marketingPage("/")!, ctx)))["@graph"];
  const org = home.find((n: any) => n["@type"] === "Organization");
  assert.equal(org.name, APP);
  assert.equal(org.description, brandText(ENTITY_SENTENCE, APP));
  assert.equal(org.contactPoint.email, ctx.supportEmail);
  assert.ok(home.some((n: any) => n["@type"] === "WebSite"));
  const how = JSON.parse(jsonLdScript(marketingJsonLd(marketingPage("/how-it-works")!, ctx)))["@graph"];
  assert.equal(how.find((n: any) => n["@type"] === "HowTo").step.length, 8);
  const guide = JSON.parse(jsonLdScript(marketingJsonLd(marketingPage("/guides/uae-advertiser-permit")!, ctx)))["@graph"];
  const article = guide.find((n: any) => n["@type"] === "Article");
  assert.ok(article.headline);
  assert.deepEqual(article.author, { "@type": "Organization", name: APP, url: ORIGIN + "/" });
  assert.equal(article.image, ORIGIN + "/og?path=%2Fguides%2Fuae-advertiser-permit");
  const calc = JSON.parse(jsonLdScript(marketingJsonLd(marketingPage("/follower-calculator")!, ctx)))["@graph"];
  assert.ok(calc.some((n: any) => n["@type"] === "WebApplication"));
  // A hostile string cannot close the script element.
  assert.doesNotMatch(jsonLdScript({ name: "</script><script>x" }), /<\/script/i);
});

const registryWords = (page: MarketingPage) =>
  [
    page.intro,
    ...page.sections.flatMap((s) => [
      s.heading,
      ...(s.body ?? []),
      ...(s.bullets ?? []),
      ...(s.cards ?? []).flatMap((c) => [c.title, c.body]),
      ...(s.steps ?? []).flatMap((st) => [st.title, st.body]),
      ...(s.table ? [s.table.caption, ...s.table.columns, ...s.table.rows.flat()] : []),
      s.note ?? "",
    ]),
    ...page.faqs.flatMap((f) => [f.q, f.a]),
  ]
    .join(" ")
    .split(/\s+/)
    .filter(Boolean).length;

test("SEO depth: no thin indexable pages; guides go deep", () => {
  const thin = site
    .filter((p) => p.indexable && p.kind !== "hub")
    .map((p) => [p.path, registryWords(p)] as const)
    .filter(([, words]) => words < 350);
  assert.deepEqual(thin, [], "indexable pages below 350 words");
  for (const guide of site.filter((p) => p.kind === "guide"))
    assert.ok(registryWords(guide) >= 500, `${guide.path}: ${registryWords(guide)} words`);
  assert.ok(registryWords(marketingPage("/guides/pricing-online-coaching-uae")!) >= 1000);
});

// Intl separates "AED" with a no-break space; registry copy uses a normal space.
const aedText = (minor: number) => aedWhole(minor).replace(/\s/g, " ");
test("the pricing guide's worked examples are the calculator's own arithmetic", () => {
  const guide = marketingPage("/guides/pricing-online-coaching-uae")!;
  const rows = guide.sections.find((s) => s.id === "examples")!.table!.rows;
  const base = { billing: "monthly" as const, programmeMonths: 1, nutritionSharePct: 0, nutritionPriceAed: 0, voiceSharePct: 0, voicePriceAed: 0, sessionsPerMonth: 0, sessionPriceAed: 0, yourSessionRateAed: 250 };
  for (const row of rows) {
    const [n, price] = row[0].match(/\d+/g)!.map(Number);
    const e = estimateEarnings({ ...base, subscribers: n, workoutPriceAed: price });
    const aedWhole = (minor: number) => aedText(minor);
    assert.equal(row[1], aedWhole(e.subscriptionMonthlyMinor), row[0]);
    assert.ok(row[2].startsWith(aedWhole(e.commissionMinor)), row[0]);
    assert.equal(row[3], aedWhole(e.beforeOtherCostsMinor), row[0]);
    assert.equal(row[4], "About " + e.equivalentSessions, row[0]);
  }
  const text = allText(guide);
  const upfront = estimateEarnings({ ...base, subscribers: 60, billing: "upfront", workoutPriceAed: 540, programmeMonths: 3 });
  for (const minor of [upfront.averageMonthlyMinor, upfront.subscriptionMonthlyMinor, upfront.commissionMinor, upfront.beforeOtherCostsMinor])
    assert.ok(text.includes(aedText(minor)), aedText(minor));
  const mix = estimateEarnings({ ...base, subscribers: 100, workoutPriceAed: 199, nutritionSharePct: 30, nutritionPriceAed: 299 });
  for (const minor of [mix.averageMonthlyMinor, mix.subscriptionMonthlyMinor, mix.commissionMinor])
    assert.ok(text.includes(aedText(minor)), aedText(minor));
  const calc = allText(marketingPage("/earnings-calculator")!);
  const e = estimateEarnings({ ...base, subscribers: 120, workoutPriceAed: 199 });
  for (const minor of [e.subscriptionMonthlyMinor, e.commissionMinor, e.beforeOtherCostsMinor])
    assert.ok(calc.includes(aedText(minor)), aedText(minor));
});

test("the product at full size: a complete capability matrix, screens and counts from the registry", () => {
  assert.ok(CAPABILITY_COUNT >= 60, `${CAPABILITY_COUNT} capabilities`);
  assert.equal(CAPABILITY_COUNT, FEATURE_MATRIX.reduce((n, g) => n + g.items.length, 0));
  const names = FEATURE_MATRIX.flatMap((g) => g.items.map((i) => i.name));
  assert.equal(new Set(names).size, names.length, "duplicate capability");
  for (const group of FEATURE_MATRIX) if (group.page) assert.ok(isMarketingSitePath(group.page), group.page);
  // The brief's must-haves are all listed.
  for (const required of ["Client Twin", "Offline in the gym", "WHOOP connection", "Team roles", "Monthly statement", "Trials and promotion codes", "Your own domain, bought for you", "Arabic-ready layout", "Export and deletion", "Sessions in your own voice", "Barcode lookup"])
    assert.ok(names.includes(required), required);
  // Generic categories only: never a competitor's name.
  for (const r of REPLACES) assert.match(r.tool, /^(A|An|Programme) /);
  const features = decode(render(marketingPage("/features")!));
  assert.match(features, new RegExp(`Every capability: ${CAPABILITY_COUNT} in ${FEATURE_MATRIX.length} areas`));
  for (const name of names.slice(0, 5)) assert.ok(features.includes(name), name);
  assert.match(features, /One workspace instead of 7 separate tools/);
  for (const screen of ["Your review queue.", "Your subscriber’s day.", "The workout logger.", "Your statement."])
    assert.ok(features.includes(screen), screen);
  assert.match(features, /Illustrations with sample data/);
  // Provider-dependent items say "Available soon" while their provider is off.
  const off = decode(render(marketingPage("/features")!, { ...platform, availability: { ...platform.availability, voice: false } }));
  assert.match(off, /Sessions in your own voice.*?Available soon/);
  const on = decode(render(marketingPage("/features")!, { ...platform, availability: { ...platform.availability, voice: true } }));
  assert.match(on, /Sessions in your own voice.*?Add-on/);
  const home = decode(render(marketingPage("/")!));
  assert.match(home, new RegExp(`Everything included in ${APP}`));
  assert.ok(home.includes(`${CAPABILITY_COUNT} capabilities in one workspace`));
  assert.ok(home.includes("Your review queue."));
});

test("registration closed: early access captures the visitor's details and numbers instead of a dead end", () => {
  const closed = { ...platform, registrationOpen: false };
  const page = render(marketingPage("/get-started")!, closed);
  assert.match(page, /id="early-access"/);
  assert.match(page, /name="email"/);
  assert.match(page, /name="consent"/);
  assert.match(page, /name="website"/, "honeypot field");
  assert.doesNotMatch(decode(page), /Check back soon/);
  // The follower calculator hands its numbers to early access.
  const calculator = render(marketingPage("/follower-calculator")!, closed);
  assert.match(calculator, /Join early access/);
  assert.equal(
    withEarlyAccessContext("/get-started#early-access", { followers: 5000, stories: 8, price: 199, estimate: "0-5", slug: undefined }),
    "/get-started?followers=5000&stories=8&price=199&estimate=0-5#early-access",
  );
  assert.equal(withEarlyAccessContext("/signup", { followers: 1 }), "/signup");
});

test("llms.txt follows llmstxt.org and llms-full.txt carries every page, FAQ and source", () => {
  const txt = llmsTxt(ctx);
  const lines = txt.split("\n");
  assert.equal(lines[0], "# " + APP);
  assert.equal(lines[2], "> " + brandText(ENTITY_SENTENCE, APP));
  assert.ok(lines.includes("## Optional"));
  for (const page of INDEXABLE_MARKETING_PAGES)
    if (page.path !== "/")
      assert.ok(txt.includes(`(${ORIGIN}${page.path})`), page.path);
  assert.doesNotMatch(txt, /\{APP_NAME\}/);
  const full = llmsFullTxt(ctx);
  for (const page of site) {
    assert.ok(full.includes("## " + brandText(page.h1, APP)), page.path);
    for (const faq of page.faqs) assert.ok(full.includes(brandText(faq.a, APP)), faq.q);
  }
  for (const source of MARKETING_SOURCES) assert.ok(full.includes(source.url), source.id);
  assert.doesNotMatch(full, /\{APP_NAME\}/);
});

test("follower calculator: the headline is the strong case; cautious and typical sit under How we estimate", () => {
  const html = renderToStaticMarkup(
    createElement(FollowerCalculator, { model: DEFAULT_FOLLOWER_MODEL }),
  );
  const text = decode(html);
  const e = estimateFollowerConversion(DEFAULT_FOLLOWER_INPUTS);
  const { cautious, typical, strong } = e.scenarios;
  // Defaults: 7,000 followers, AED 199, 8 link Stories, 4 keyword Reels, 30% a year.
  assert.match(html, /value="7000"/);
  assert.match(text, /ESTIMATE, NOT A PROMISE/);
  assert.match(text, /Strong case an engaged, growing audience and weekly sharing/);
  assert.match(text, new RegExp(`Up to ${displayCount(strong.month1New)} new paying subscribers in your first month`));
  // One best-case qualifier on every headline line; the strong case is still
  // growing at month 12 (the owner's direction).
  assert.match(text, new RegExp(`Up to ${displayCount(strong.activeMonth12)} active subscribers after 12 months, after 30% yearly cancellations, and still growing`));
  assert.ok(text.includes(`Up to ${aedText(strong.revenueMonth12Minor)} a month at your price, before platform commission`), text);
  assert.ok(text.includes(`Up to ${displayCount(strong.signups12)} sign-ups over 12 months, before cancellations`), text);
  assert.doesNotMatch(text, /About \d+ active/);
  assert.match(text, /A best case for an engaged, growing audience, not a typical result and not a promise/);
  // The headline figure is the strong case, not the typical one.
  const figure = html.match(/class="mk-result-figure">([^<]*(?:<!-- -->)?[^<]*)</)![1].replace(/<!-- -->/g, "");
  assert.equal(figure, `Up to ${displayCount(strong.month1New)}`);
  // Cautious and typical appear only in the How we estimate table.
  const details = text.slice(text.indexOf("How we estimate"));
  assert.match(details, /How we estimate \(assumptions version 2026-09-28\.4\)/);
  const row = (name: string, r: typeof strong) =>
    `${name} ${r.month1New < 1 ? "fewer than 1" : displayCount(r.month1New)} ${displayCount(r.activeMonth12) ?? "fewer than 1"} ${displayCount(r.signups12) ?? "fewer than 1"} ${aedText(r.revenueMonth12Minor)}`;
  assert.ok(details.includes(row("Cautious", cautious)), details);
  assert.ok(details.includes(row("Typical", typical)), details);
  assert.ok(details.includes(row("Strong case", strong)), details);
  assert.ok(!text.slice(0, text.indexOf("How we estimate")).includes("Typical"));
  // Levers: strong-case gains, worded for the trainer.
  assert.match(text, /What raises your number/);
  // Each lever shows its gain in the headline figure (active at month 12).
  assert.ok(
    text.includes(`Bio link to your page, per 1,000 profile visits a month +1.9 in your first month, +17 active after 12 months (+${aedText(338_300)} a month).`),
    text,
  );
  assert.match(text, /Your bio link reaches people your Stories miss/);
  assert.match(text, /4 more Reels a month with a comment keyword/);
  assert.match(text, /4 more link Stories a month/);
  assert.match(text, /get a chance to tap before they drift away, and they subscribe sooner/);
  assert.match(text, /New people each month: 0%, 1\.5% and 8% of each audience is new to your link every month/);
  assert.match(text, /the strong case is our assumption up to 10,000 followers/);
  assert.match(text, /far above published creator averages/);
  assert.doesNotMatch(text, /Humiston|1–3% of an engaged audience|pay before they start/);
  assert.match(text, /A broadcast channel with 300 members and 4 link messages a month/);
  assert.match(text, /The strong case assumes about 1,435 people see your Stories each month/);
  // Labelled inputs, including cancellations and the optional channels.
  for (const label of [
    "Instagram followers",
    "Your monthly price",
    "Stories with your link each month",
    "Reels or posts with a call to action each month",
    "A comment keyword sends your link by DM",
    "Members who cancel per year",
    "Profile visits each month",
    "Broadcast channel members",
    "Link messages in your channel each month",
    "Average Story views",
    "Engagement rate",
  ])
    assert.ok(text.includes(label), label);
  const labels = [...html.matchAll(/<label for="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(labels.length >= 11);
  for (const id of labels) assert.ok(html.includes(`id="${id}"`), id);
  assert.match(html, /type="checkbox"[^>]*checked=""/);
  // Compact (home, specialty pages): the strong headline, no levers, fewer inputs.
  const compact = decode(
    renderToStaticMarkup(
      createElement(FollowerCalculator, { model: DEFAULT_FOLLOWER_MODEL, compact: true, initial: { followers: 3000 } }),
    ),
  );
  const small = estimateFollowerConversion({ ...DEFAULT_FOLLOWER_INPUTS, followers: 3000 }).scenarios.strong;
  assert.match(compact, new RegExp(`Up to ${displayCount(small.month1New)} new paying subscribers`));
  assert.doesNotMatch(compact, /What raises your number/);
  assert.doesNotMatch(compact, /Members who cancel per year/);
  assert.match(compact, /ESTIMATE, NOT A PROMISE/);
  // Tiny accounts never show "Up to 0".
  const tiny = decode(
    renderToStaticMarkup(
      createElement(FollowerCalculator, { model: DEFAULT_FOLLOWER_MODEL, initial: { followers: 20 } }),
    ),
  );
  assert.match(tiny, /Fewer than 1 new paying subscriber in your first month/);
  // "Fewer than 1" active subscriber is valued at nothing, not at the price.
  assert.match(tiny, /Fewer than 1 active subscriber after 12 months/);
  assert.match(tiny, /AED 0 a month at your price/);
  assert.doesNotMatch(tiny, /Up to AED 0/);
  // "Weekly sharing" only when the inputs share weekly.
  const quiet = decode(
    renderToStaticMarkup(
      createElement(FollowerCalculator, {
        model: DEFAULT_FOLLOWER_MODEL,
        initial: { linkStoriesPerMonth: 2, ctaReelsPerMonth: 0 },
      }),
    ),
  );
  assert.match(quiet, /Strong case an engaged, growing audience Up to/);
  assert.doesNotMatch(quiet, /weekly sharing/);
});

test("the guide's example accounts and the methodology worked example use the model", () => {
  const guide = decode(render(marketingPage("/guides/instagram-followers-to-clients")!));
  assert.match(guide, /Strong case, a best case for an engaged, growing audience and not a typical result/);
  const seven = estimateFollowerConversion(DEFAULT_FOLLOWER_INPUTS).scenarios.strong;
  assert.ok(
    guide.includes(`7,000 ${displayCount(seven.month1New)} ${displayCount(seven.activeMonth12)} ${displayCount(seven.signups12)} ${aedText(seven.revenueMonth12Minor)}`),
    "7,000 followers row",
  );
  const methodology = decode(render(marketingPage("/methodology")!));
  assert.match(methodology, /How the strong case is calibrated/);
  assert.match(methodology, /The strong case is a best case for an engaged, growing audience and weekly sharing\. It is not a typical result and not a promise\./);
  // No named creator or unverified sales figure is presented as a source; the
  // founder's example is labelled unverified and compared per view only.
  const full = llmsFullTxt(ctx);
  for (const [name, page] of [["methodology", methodology], ["guide", guide], ["llms-full.txt", full]] as const) {
    assert.doesNotMatch(page, /Humiston|swoleaf|bought a USD 20 plan|creators say about 1-3%/, name);
    assert.doesNotMatch(page, /sell far more|can do far better|pay before they start/, name);
  }
  assert.match(methodology, /an unverified example with no public source, so it is not used as evidence\. Per view, the strong case’s 0\.31% is below it/);
  assert.match(methodology, /\[Unverified founder example\]/);
  // The calibration states what the comparison sources actually say.
  assert.match(methodology, /0\.1-1% of an audience \(low\), 1\.5-5% \(mid\) and 0\.52-1\.1% for higher-priced courses/);
  assert.match(methodology, new RegExp(`about USD 273 a month on average, against ${aedText(seven.revenueMonth12Minor)} a month in the strong case`));
  assert.match(methodology, /Strong: our assumption, the six-frame 20\.5% used as a monthly audience, against a measured reach of 3\.5-4\.2% for this tier/);
  assert.match(methodology, /an app install shows more intent than a Story tap, so these may overstate/);
  assert.match(methodology, /Owner assumption\./);
  assert.ok(
    methodology.includes(`Strong case ${displayCount(seven.month1New)} ${displayCount(seven.activeMonth12)} ${displayCount(seven.signups12)} ${aedText(seven.revenueMonth12Minor)}`),
    "worked example row",
  );
  // Every source carries its label.
  for (const source of MARKETING_SOURCES)
    assert.ok(methodology.includes(`${source.evidence} ${source.publisher}`), source.id);
  for (const label of ["Measured, brand accounts", "Vendor claim, no dataset", "Rule of thumb", "Measured; used as a proxy"])
    assert.ok(MARKETING_SOURCES.some((s) => s.evidence === label), label);
  assert.ok(!MARKETING_SOURCES.some((s) => /creator example|owner-supplied/i.test(s.evidence)));
  assert.match(methodology, /version 2026-09-28\.3\): three scenarios instead of one range/);
  assert.match(methodology, /version 2026-09-28\.4\): each audience now gains new people every month/);
  // No page calls the follower result an estimate range any more.
  for (const path of ["/about", "/features", "/methodology"])
    assert.doesNotMatch(decode(render(marketingPage(path)!)), /estimate ranges?\b|shown as ranges/, path);
});

test("earnings calculator: marginal bands match the ledger's projection; upfront and tier mix", () => {
  const base: EarningsInputs = {
    subscribers: 150,
    billing: "monthly",
    workoutPriceAed: 199,
    programmeMonths: 3,
    nutritionSharePct: 0,
    nutritionPriceAed: 0,
    voiceSharePct: 0,
    voicePriceAed: 0,
    sessionsPerMonth: 0,
    sessionPriceAed: 0,
    yourSessionRateAed: 250,
  };
  const e = estimateEarnings(base);
  assert.equal(e.subscriptionMonthlyMinor, 2_985_000);
  assert.equal(e.commissionMinor, 696_500);
  assert.equal(e.bands[0].commissionMinor, 497_500);
  assert.equal(e.bands[1].commissionMinor, 199_000);
  assert.equal(e.bands[1].subscribers, 50);
  assert.equal(e.beforeOtherCostsMinor, 2_288_500);
  assert.equal(e.equivalentSessions, 92);
  assert.equal(e.effectiveCommissionPct, 23.33);
  for (const n of [0, 1, 100, 101, 300, 301, 1000, 1001, 2500])
    assert.equal(
      estimateEarnings({ ...base, subscribers: n }).commissionMinor,
      projectedCommission(n, 19_900),
      String(n),
    );
  const upfront = estimateEarnings({ ...base, billing: "upfront", workoutPriceAed: 597 });
  assert.equal(upfront.averageMonthlyMinor, 19_900);
  const mix = estimateEarnings({ ...base, nutritionSharePct: 30, nutritionPriceAed: 299 });
  assert.equal(mix.averageMonthlyMinor, 22_900);
  const sessions = estimateEarnings({ ...base, sessionsPerMonth: 10, sessionPriceAed: 300 });
  assert.equal(sessions.sessionsMonthlyMinor, 300_000);
  assert.equal(sessions.beforeOtherCostsMinor, 2_288_500 + 300_000);
  assert.equal(estimateEarnings({ ...base, yourSessionRateAed: 0 }).equivalentSessions, null);
  assert.equal(estimateEarnings({ ...base, subscribers: -5 }).commissionMinor, 0);
});

test("calculators and pages carry their estimate disclaimers", () => {
  const follower = decode(
    renderToStaticMarkup(createElement(FollowerCalculator, { model: DEFAULT_FOLLOWER_MODEL })),
  );
  assert.match(follower, /ESTIMATE, NOT A PROMISE/);
  assert.match(follower, /not a prediction or promise of results/);
  assert.match(follower, /you may get fewer subscribers than the cautious figure/);
  assert.match(follower, /A best case for an engaged, growing audience, not a typical result/);
  assert.match(follower, /How we estimate \(assumptions version 2026-09-28\.4\)/);
  assert.match(follower, /No published benchmark exists for coaching subscriptions/i);
  assert.match(follower, /no industry benchmark exists/);
  const earnings = decode(renderToStaticMarkup(createElement(EarningsCalculator, {})));
  assert.match(earnings, /Not an earnings promise/);
  assert.match(earnings, /AI usage at cost/);
  const pricing = decode(render(marketingPage("/pricing")!));
  assert.match(pricing, /An arithmetic example, not a forecast or promise/);
  const methodology = decode(render(marketingPage("/methodology")!));
  for (const source of MARKETING_SOURCES) assert.ok(methodology.includes(source.publisher), source.id);
  assert.match(methodology, /Follower calculator assumptions \(version 2026-09-28\.4\)/);
  assert.match(methodology, /not a typical result and not a promise/);
  assert.doesNotMatch(methodology, /Adjusted by the operator/);
  assert.equal(slugFromName("Layla Strength!"), "layla-strength");
  assert.equal(slugFromName("  99 Élan  Fit "), "elan-fit");
  assert.equal(slugFromName("ab"), "");
});

test("the assumptions shown are the assumptions used: settings change the pages, FAQ JSON-LD and llms-full.txt", () => {
  const k = FOLLOWER_MODEL_SETTING_KEYS;
  const text = (p: PublicPlatform, path: string) => decode(render(marketingPage(path)!, p));
  const cited = text(platform, "/follower-calculator");
  assert.match(cited, /1%, 3% and 5% chance \(cautious, typical, strong\) of opening one link Story/);
  assert.match(cited, /visit to paid of 0\.72%, 2\.9% and 6\.2%/);
  assert.match(cited, /Each month 0%, 1\.5% and 8% of each audience is new to your link/);
  assert.match(cited, /18%, 30% and 45% of commenters open the link/);
  assert.match(cited, /compared with the 0\.48% average/);
  assert.match(cited, /turns 5% × 6\.2%, about 0\.31% of the people who see it, into subscribers, and each month 8% of your audience is new to your link/);
  assert.doesNotMatch(cited, /\{[A-Z_]+\}/);
  const model = followerModelFromSettings({
    [k.version]: "2026-11-01",
    [k.rates.linkClickPct.cautious]: "2",
    [k.rates.linkClickPct.strong]: "4",
    [k.rates.paidPct.strong]: "9",
    [k.engagementBenchmarkPct]: "0.6",
    [k.changeNote]: "Operator trial data, October 2026",
  });
  assert.equal(model.version, "2026-11-01");
  const edited = { ...platform, followerModel: model };
  const page = text(edited, "/follower-calculator");
  assert.match(page, /2%, 3% and 4% chance \(cautious, typical, strong\)/);
  assert.match(page, /visit to paid of 0\.72%, 2\.9% and 9%/);
  assert.match(page, /compared with the 0\.6% average/);
  assert.match(page, /turns 4% × 9%, about 0\.36% of the people who see it/);
  assert.match(text(edited, "/guides/instagram-followers-to-clients"), /uses 2%, 3% and 4% of viewers per link Story/);
  const full = llmsFullTxt({ ...ctx, followerModel: model });
  assert.match(full, /visit to paid of 0\.72%, 2\.9% and 9%/);
  assert.doesNotMatch(full, /\{[A-Z_]+\}/);
  assert.doesNotMatch(llmsFullTxt(ctx), /\{[A-Z_]+\}/);
  // The calculator itself uses the edited values.
  const calc = decode(renderToStaticMarkup(createElement(FollowerCalculator, { model })));
  const strong = estimateFollowerConversion(DEFAULT_FOLLOWER_INPUTS, model).scenarios.strong;
  assert.match(calc, new RegExp(`Up to ${displayCount(strong.month1New)} new paying`));
  assert.match(calc, /adjusted by the platform operator/);
  // Methodology marks edited values instead of crediting the source for them.
  const methodology = text(edited, "/methodology");
  assert.match(methodology, /Adjusted by the operator version 2026-11-01; differs from the cited source \( Creatorflow , IQFluence \)/);
  assert.match(methodology, /Adjusted by the operator version 2026-11-01; differs from the cited source \( Dynamic Yield , RevenueCat \)/);
  assert.match(methodology, /Operator trial data, October 2026/);
  // No unresolved token anywhere in the registry output.
  for (const p of site)
    assert.doesNotMatch(text(edited, p.path), /\{[A-Z_]+\}/, p.path);
});

test("the brand, availability and registration state come from the platform, not the code", () => {
  const home = render(marketingPage("/")!, { ...platform, name: "Acme Coaching", initials: "AC" });
  assert.match(home, /Acme Coaching/);
  assert.doesNotMatch(home, /trainerbrain|>b\.</);
  const features = decode(render(marketingPage("/features")!));
  assert.match(features, /Voice coach Available soon/);
  assert.match(features, /Safety Included/);
  const open = decode(render(marketingPage("/features/voice-coach")!, {
    ...platform,
    availability: { ...platform.availability, voice: true },
  }));
  assert.match(open, /Add-on/);
  const closed = render(marketingPage("/")!, { ...platform, registrationOpen: false });
  assert.match(closed, /Join early access/);
  assert.doesNotMatch(closed, /href="\/signup"/);
  const startedHtml = render(marketingPage("/get-started")!, { ...platform, registrationOpen: false });
  const started = decode(startedHtml);
  assert.match(started, /Join early access/);
  // The configured support address stays available as a fallback.
  assert.match(startedHtml, /mailto:hello@trainsyou\.example/);
  for (const step of SETUP_CHECKLIST) assert.ok(started.includes(step.label), step.label);
});

test("the marketing setup checklist mirrors the onboarding registry", () => {
  assert.deepEqual(
    SETUP_CHECKLIST.map((s) => [s.key, s.label, s.required]),
    baseRegistry.map(([key, label, , required]) => [key, label, required]),
  );
  assert.equal(SETUP_CHECKLIST.at(-1)!.key, "share");
});

// Registrars are never named (the owner's instruction), nor the payout
// provider; and no invented social proof or hype appears in public copy.
const REGISTRARS = /\b(namecheap|godaddy|porkbun|gandi|dynadot|tucows|opensrs|enom|name\.com|hover\.com|google domains|squarespace domains|cloudflare registrar)\b/i;
const HYPE = /trusted by|as seen in|#1\b|guaranteed|passive income|revolutionary|the best\b|best-in-class|world-class|\d+\+? (trainers|coaches) (use|trust)|★/i;
test("honesty scan: public pages never name a registrar, the payout provider or invented proof", async () => {
  const texts: Array<[string, string]> = [
    ["llms.txt", llmsTxt(ctx)],
    ["llms-full.txt", llmsFullTxt(ctx)],
  ];
  for (const page of site) texts.push([page.path, decode(render(page))]);
  for (const [where, text] of texts) {
    assert.doesNotMatch(text, REGISTRARS, where);
    assert.doesNotMatch(text, /\bLean\b/, where);
    assert.doesNotMatch(text, HYPE, where);
  }
  // Source files of the public site, including the directory frame.
  const dir = new URL("../apps/web/components/marketing/", import.meta.url);
  const files = [
    ...(await readdir(dir)).map((f) => new URL(f, dir)),
    new URL("../packages/contracts/src/marketing-content.ts", import.meta.url),
    new URL("../packages/contracts/src/marketing.ts", import.meta.url),
    new URL("../apps/web/components/trainer-growth.tsx", import.meta.url),
  ];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, REGISTRARS, file.pathname);
  }
});
