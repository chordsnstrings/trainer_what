// Public marketing site: registry integrity, per-page metadata, JSON-LD,
// discovery (sitemap paths, llms.txt), calculator arithmetic and disclaimers,
// and honesty scans (no registrar name, no invented social proof).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DIRECTORY_SPECIALTIES,
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
  robotsPolicy,
  type MarketingPage,
} from "@trainer/contracts";
import { projectedCommission } from "@trainer/domain";
import {
  DEFAULT_FOLLOWER_MODEL,
  FOLLOWER_MODEL_SETTING_KEYS,
  displayRange,
  engagementRate,
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
} from "../apps/web/components/marketing/islands.tsx";
import type { PublicPlatform } from "../apps/web/components/marketing/platform.ts";
import { INTEGRATION_CATALOG } from "../packages/providers/src/configuration.ts";

const ORIGIN = "https://trainsyou.example";
const APP = "TrainsYou";
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

test("the brief's page set exists: core pages, 11 features, 8 specialties, emirates and guides", () => {
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
    "/uae/dubai",
    "/uae/abu-dhabi",
    "/guides",
  ])
    assert.ok(isMarketingSitePath(path), path);
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
    assert.ok(m.title.length <= 90, `${page.path} title too long: ${m.title}`);
    assert.equal(m.canonical, page.path === "/" ? ORIGIN + "/" : ORIGIN + page.path);
    assert.equal(m.openGraph.url, m.canonical);
    assert.equal(m.openGraph.siteName, APP);
    assert.equal(m.openGraph.locale, "en_AE");
    assert.equal(m.twitter.title, m.title);
    assert.equal(m.robots.index, page.indexable);
    for (const text of [m.title, m.description])
      assert.doesNotMatch(text, /\{APP_NAME\}/);
  }
  // The brand is never hard-coded: another name renders everywhere.
  for (const page of site) {
    const text = brandText(allText(page), "Acme Coaching");
    assert.doesNotMatch(text, /\{APP_NAME\}|TrainsYou|Trainer Brain Platform/, page.path);
  }
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
  const home = JSON.parse(jsonLdScript(marketingJsonLd(marketingPage("/")!, ctx)))["@graph"];
  const org = home.find((n: any) => n["@type"] === "Organization");
  assert.equal(org.name, APP);
  assert.equal(org.description, brandText(ENTITY_SENTENCE, APP));
  assert.equal(org.contactPoint.email, ctx.supportEmail);
  assert.ok(home.some((n: any) => n["@type"] === "WebSite"));
  const how = JSON.parse(jsonLdScript(marketingJsonLd(marketingPage("/how-it-works")!, ctx)))["@graph"];
  assert.equal(how.find((n: any) => n["@type"] === "HowTo").step.length, 8);
  const guide = JSON.parse(jsonLdScript(marketingJsonLd(marketingPage("/guides/uae-advertiser-permit")!, ctx)))["@graph"];
  assert.ok(guide.some((n: any) => n["@type"] === "Article" && n.headline));
  const calc = JSON.parse(jsonLdScript(marketingJsonLd(marketingPage("/follower-calculator")!, ctx)))["@graph"];
  assert.ok(calc.some((n: any) => n["@type"] === "WebApplication"));
  // A hostile string cannot close the script element.
  assert.doesNotMatch(jsonLdScript({ name: "</script><script>x" }), /<\/script/i);
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

test("follower calculator arithmetic: tiers, engagement scaling, clamping and honest rounding", () => {
  const e = estimateFollowerConversion({
    followers: 5000,
    linkStoriesPerMonth: 8,
    priceAed: 199,
  });
  assert.equal(e.tierIndex, 0);
  assert.equal(e.engagementFactor, 1);
  assert.ok(Math.abs(e.linkViews.low - 3820) < 1e-6);
  assert.ok(Math.abs(e.linkViews.high - 4160) < 1e-6);
  assert.ok(Math.abs(e.visits.low - 38.2) < 1e-6);
  assert.ok(Math.abs(e.visits.high - 208) < 1e-6);
  assert.ok(Math.abs(e.subscribers.low - 0.57682) < 1e-6);
  assert.ok(Math.abs(e.subscribers.high - 11.2112) < 1e-6);
  assert.deepEqual(displayRange(e.subscribers), { low: 0, high: 11 });
  assert.equal(e.monthlyRevenueMinor.high, Math.round(11.2112 * 199 * 100));
  assert.ok(Math.abs(e.twelveMonthSubscribers.high - 11.2112 * 12) < 1e-6);
  assert.equal(e.assumptionsVersion, DEFAULT_FOLLOWER_MODEL.version);
  // Tier boundaries.
  const tier = (followers: number) =>
    estimateFollowerConversion({ followers, linkStoriesPerMonth: 4, priceAed: 100 }).tierIndex;
  assert.deepEqual([tier(5000), tier(5001), tier(10000), tier(50001), tier(100001), tier(9_000_000)], [0, 1, 1, 3, 4, 4]);
  // Engagement scales reach within the configured limits.
  const eng = (rate: number | null) =>
    estimateFollowerConversion({ followers: 5000, linkStoriesPerMonth: 8, priceAed: 199, engagementRatePct: rate });
  assert.equal(eng(0.96).engagementFactor, 2);
  assert.equal(eng(5).engagementFactor, 2);
  assert.equal(eng(0.12).engagementFactor, 0.5);
  assert.ok(Math.abs(eng(0.72).engagementFactor - 1.5) < 1e-9);
  assert.equal(eng(null).engagementFactor, 1);
  assert.ok(Math.abs(eng(0.96).reachPct.low - 19.1) < 1e-9);
  // Inputs are clamped; nothing is negative and nobody subscribes twice.
  const zero = estimateFollowerConversion({ followers: -50, linkStoriesPerMonth: -1, priceAed: -3 });
  assert.equal(zero.inputs.followers, 0);
  assert.equal(zero.subscribers.high, 0);
  assert.equal(zero.inputs.priceAed, 1);
  const tiny = estimateFollowerConversion(
    { followers: 3, linkStoriesPerMonth: 60, priceAed: 100 },
    { ...DEFAULT_FOLLOWER_MODEL, tiers: [{ upTo: null, reachLowPct: 100, reachHighPct: 100 }], linkClickLowPct: 100, linkClickHighPct: 100, purchaseLowPct: 100, purchaseHighPct: 100 },
  );
  assert.equal(tiny.subscribers.high, 3);
  assert.equal(tiny.twelveMonthSubscribers.high, 3);
  // Rounding never inflates the low end.
  assert.deepEqual(displayRange({ low: 0.99, high: 1.4 }), { low: 0, high: 1 });
  assert.deepEqual(displayRange({ low: 2, high: 1.2 }), { low: 2, high: 2 });
  assert.equal(engagementRate(1000, [{ likes: 10, comments: 2 }, { likes: 6, comments: 0 }]), 0.9);
  assert.equal(engagementRate(0, [{ likes: 1 }]), null);
  assert.equal(engagementRate(100, []), null);
});

test("the Super admin's assumptions: settings map onto the model and inconsistent sets fall back", () => {
  const k = FOLLOWER_MODEL_SETTING_KEYS;
  assert.deepEqual(followerModelFromSettings({}), DEFAULT_FOLLOWER_MODEL);
  const edited = followerModelFromSettings({
    [k.version]: "2026-10-01",
    [k.tiers[0][0]]: "8",
    [k.linkClickHighPct]: "4",
  });
  assert.equal(edited.version, "2026-10-01");
  assert.equal(edited.tiers[0].reachLowPct, 8);
  assert.equal(edited.linkClickHighPct, 4);
  assert.equal(edited.purchaseLowPct, DEFAULT_FOLLOWER_MODEL.purchaseLowPct);
  assert.deepEqual(
    followerModelFromSettings({ [k.purchaseLowPct]: "9", [k.purchaseHighPct]: "2" }),
    DEFAULT_FOLLOWER_MODEL,
  );
  // Each settings default equals the domain default (one source of truth).
  const marketing = INTEGRATION_CATALOG.find((i) => i.id === "marketing")!;
  assert.equal(marketing.controls, true);
  const defaults = Object.fromEntries(marketing.fields.map((f) => [f.key, f.defaultValue]));
  assert.deepEqual(
    followerModelFromSettings(defaults as Record<string, string>),
    DEFAULT_FOLLOWER_MODEL,
  );
  assert.equal(defaults[k.version], DEFAULT_FOLLOWER_MODEL.version);
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
  assert.match(follower, /Assumptions \(version 2026-09-28\)/);
  assert.match(follower, /no industry benchmark exists/);
  const earnings = decode(renderToStaticMarkup(createElement(EarningsCalculator, {})));
  assert.match(earnings, /Not an earnings promise/);
  assert.match(earnings, /AI usage at cost/);
  const pricing = decode(render(marketingPage("/pricing")!));
  assert.match(pricing, /An arithmetic example, not a forecast or promise/);
  const methodology = decode(render(marketingPage("/methodology")!));
  for (const source of MARKETING_SOURCES) assert.ok(methodology.includes(source.publisher), source.id);
  assert.match(methodology, /Follower calculator assumptions \(version 2026-09-28\)/);
  assert.equal(slugFromName("Layla Strength!"), "layla-strength");
  assert.equal(slugFromName("  99 Élan  Fit "), "elan-fit");
  assert.equal(slugFromName("ab"), "");
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
  const started = decode(render(marketingPage("/get-started")!, { ...platform, registrationOpen: false }));
  assert.match(started, /Join early access/);
  assert.match(started, /hello@trainsyou\.example/);
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
