// The "frontier model" wording (plan section 6, docs/features/marketing-site.md
// "Frontier wording"): shown only while the availability flag "frontier" is
// on, through one filter used by the pages, their FAQ structured data and
// llms-full.txt; with the flag off the phrase appears nowhere.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AVAILABILITY_LINES,
  MARKETING_PAGES,
  brandText,
  llmsFullTxt,
  llmsTxt,
  marketingJsonLd,
  marketingPage,
  marketingPageFor,
  type MarketingPage,
} from "@trainer/contracts";
import { MarketingSite } from "../apps/web/components/marketing/site.tsx";
import type { PublicPlatform } from "../apps/web/components/marketing/platform.ts";
import { DEFAULT_FOLLOWER_MODEL } from "../packages/domain/src/marketing-calculators.ts";

const ORIGIN = "https://trainsyou.example";
const APP = "trainsyou";
const availability = (frontier: boolean) => ({
  model: true,
  nutrition: false,
  voice: false,
  customDomains: false,
  payments: true,
  payouts: true,
  whoop: false,
  zepp: false,
  instagram: false,
  frontier,
});
const platform = (frontier: boolean): PublicPlatform => ({
  name: APP,
  initials: "T",
  supportEmail: "hello@trainsyou.example",
  companyDetails: null,
  registrationOpen: true,
  coachAddressTemplate: ORIGIN + "/coach/{slug}",
  availability: availability(frontier),
  followerModel: DEFAULT_FOLLOWER_MODEL,
});
const ctx = (frontier: boolean) => ({
  origin: ORIGIN,
  appName: APP,
  supportEmail: "hello@trainsyou.example",
  availability: availability(frontier),
});
const html = (page: MarketingPage, frontier: boolean) =>
  renderToStaticMarkup(
    createElement(MarketingSite, { page, platform: platform(frontier), origin: ORIGIN }),
  );
const site = MARKETING_PAGES.filter((p) => p.renderer !== "workspace");
const FRONTIER = /frontier model/i;

test("flag off: 'frontier model' appears nowhere, including llms files and structured data", () => {
  for (const page of site) {
    // Raw HTML includes the JSON-LD script with the FAQ structured data.
    assert.doesNotMatch(html(page, false), FRONTIER, page.path);
    assert.doesNotMatch(JSON.stringify(marketingJsonLd(page, ctx(false))), FRONTIER, page.path);
    assert.equal(marketingPageFor(page, availability(false)), page, "unchanged");
  }
  assert.doesNotMatch(llmsTxt(ctx(false)), FRONTIER);
  assert.doesNotMatch(llmsFullTxt(ctx(false)), FRONTIER);
  // No context at all (old callers) is the flag-off text.
  assert.doesNotMatch(llmsFullTxt({ origin: ORIGIN, appName: APP }), FRONTIER);
  // The registry itself carries the flag-off text.
  assert.doesNotMatch(JSON.stringify(MARKETING_PAGES), FRONTIER);
});

test("flag on: the four lines show on their pages, in FAQ structured data and llms-full.txt", () => {
  const bullet = "A frontier model plus your corrections: it keeps getting better with time.";
  const brain = html(marketingPage("/trainer-brain")!, true);
  assert.ok(brain.includes(bullet), "trainer-brain bullet");
  assert.match(brain, /It runs on a frontier model, taught with your confirmed rules/);

  const faq = marketingPage("/faq")!;
  const faqHtml = html(faq, true);
  assert.ok(faqHtml.includes("Does it get better over time?"));
  const ld = marketingJsonLd(faq, ctx(true)) as { "@graph": Array<Record<string, unknown>> };
  const faqLd = ld["@graph"].find((n) => n["@type"] === "FAQPage") as {
    mainEntity: Array<{ name: string; acceptedAnswer: { text: string } }>;
  };
  const better = faqLd.mainEntity.find((q) => q.name === "Does it get better over time?");
  assert.match(better!.acceptedAnswer.text, /keeps getting better with time/);
  const trained = faqLd.mainEntity.find((q) => q.name === "Is the AI trained on my data?");
  assert.match(trained!.acceptedAnswer.text, /^It runs on a frontier model/);

  const how = html(marketingPage("/how-it-works")!, true);
  assert.ok(how.includes("Each tested release learns from it and keeps getting better."));

  const full = llmsFullTxt(ctx(true));
  for (const line of [bullet, "Does it get better over time?", "Each tested release learns from it"])
    assert.ok(full.includes(line), line);
  // Every page carrying the shared answer gets the new one, never both.
  for (const page of site) {
    const shown = marketingPageFor(page, availability(true));
    for (const f of shown.faqs)
      if (f.q === "Is the AI trained on my data?") assert.match(f.a, /frontier model/);
  }
});

test("frontier lines: idempotent filter, copy limits, never 'only gets better'", () => {
  const words = (s: string) => brandText(s, APP).split(/\s+/).filter(Boolean).length;
  for (const page of site) {
    const once = marketingPageFor(page, availability(true));
    assert.deepEqual(marketingPageFor(once, availability(true)), once, page.path);
  }
  // The copy limits of docs/features/marketing-site.md for each gated line.
  for (const line of AVAILABILITY_LINES) {
    assert.equal(line.when, "frontier");
    assert.doesNotMatch(JSON.stringify(line), /only gets better|always better|guarantee/i);
    if (line.bullet) {
      assert.ok(words(line.bullet.text) <= 12, line.bullet.text);
      const section = marketingPageFor(marketingPage(line.path!)!, availability(true)).sections.find(
        (s) => s.id === line.bullet!.section,
      )!;
      assert.ok(section.bullets!.length <= 5, "at most five bullets");
    }
    if (line.body) assert.ok(words(line.body.text) <= 18, line.body.text);
    if (line.faq) assert.ok(words(line.faq.a) <= 45, line.faq.q);
  }
});
