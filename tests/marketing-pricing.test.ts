// The /pricing page (docs/marketing-revamp-2026-10-26/phase1/PLAN.md WP6):
// concept B's page in the house tokens. Every figure is the ledger's own
// (BANDS and estimateEarnings in packages/domain, MEMBERSHIP_MINIMUMS in
// packages/contracts), no card-processing rate or prototype placeholder
// ships, what is not on yet says so under both payment states, and the call
// to action never reaches /signup while sign-ups are closed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MEMBERSHIP_MINIMUMS,
  brandText,
  monthlyMinimum,
  marketingPage,
  marketingPageFor,
  type MarketingPage,
} from "@trainer/contracts";
import { BANDS } from "@trainer/domain";
import {
  DEFAULT_EARNINGS_INPUTS,
  DEFAULT_FOLLOWER_MODEL,
  aedWhole,
  estimateEarnings,
} from "../packages/domain/src/marketing-calculators.ts";
import { MarketingSite } from "../apps/web/components/marketing/site.tsx";
import { TEACH_CTA_PATHS } from "../apps/web/components/marketing/page-parts.tsx";
import { PRICE_ANCHORS, PRICING_EXAMPLE } from "../apps/web/components/marketing/pages/pricing.tsx";
import { bandFills, sharePct, takeHome } from "../apps/web/components/marketing/pricing-islands.tsx";
import type { PublicPlatform } from "../apps/web/components/marketing/platform.ts";
import { PLACEHOLDER } from "./marketing-helpers.ts";

const ORIGIN = "https://trainsyou.example";
const APP = "trainsyou";
type State = "closed" | "off" | "payments" | "on";
const STATES: State[] = ["closed", "off", "payments", "on"];
/** closed: sign-ups closed, every flag off; off: sign-ups open, payments and
 * payouts off; payments: payments on, payouts off; on: payments, payouts,
 * voice and custom domains on. */
const platform = (state: State): PublicPlatform => ({
  name: APP,
  initials: "T",
  supportEmail: null,
  companyDetails: null,
  registrationOpen: state !== "closed",
  coachAddressTemplate: ORIGIN + "/coach/{slug}",
  availability: {
    model: true,
    nutrition: false,
    voice: state === "on",
    customDomains: state === "on",
    payments: state === "payments" || state === "on",
    payouts: state === "on",
    whoop: false,
    zepp: false,
    instagram: false,
    frontier: false,
  },
  followerModel: DEFAULT_FOLLOWER_MODEL,
});
const PAGE = marketingPage("/pricing")!;
const render = (state: State) =>
  renderToStaticMarkup(createElement(MarketingSite, { page: PAGE, platform: platform(state), origin: ORIGIN }));
const main = (html: string) => html.slice(html.indexOf("<main"), html.indexOf("</main>"));
/** Visible text, with the non-breaking spaces of formatted amounts as spaces. */
const decode = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[\s  ]+/g, " ");
/** The markup from the tag holding one marker to the next marker. */
const between = (html: string, from: string, to: string) => {
  const at = html.indexOf(from);
  assert.ok(at >= 0, from);
  const start = html.lastIndexOf("<", at);
  const end = html.indexOf(to, at);
  assert.ok(end > at, to);
  return html.slice(start, end);
};
const section = (html: string, id: string, next: string) => between(html, `id="${id}"`, `id="${next}"`);
const text = (page: MarketingPage) =>
  [
    page.title,
    page.description,
    page.h1,
    page.lede ?? "",
    page.intro,
    page.eyebrow,
    ...page.sections.flatMap((s) => [
      s.heading,
      ...(s.body ?? []),
      ...(s.bullets ?? []),
      ...(s.cards ?? []).flatMap((c) => [c.title, c.body]),
      ...(s.table ? [s.table.caption, ...s.table.columns, ...s.table.rows.flat()] : []),
      s.note ?? "",
    ]),
    ...page.faqs.flatMap((f) => [f.q, f.a]),
  ].join("\n");
/** The compact calculator's rule: one monthly price, no nutrition, voice or sessions. */
const compact = (subscribers: number, priceAed: number, sessionRateAed = 0) =>
  estimateEarnings({
    ...DEFAULT_EARNINGS_INPUTS,
    subscribers,
    billing: "monthly",
    workoutPriceAed: priceAed,
    nutritionSharePct: 0,
    voiceSharePct: 0,
    sessionsPerMonth: 0,
    yourSessionRateAed: sessionRateAed,
  });
const aed = (minor: number) => aedWhole(minor).replace(/ /g, " ");
const whole = (n: number) => new Intl.NumberFormat("en-AE").format(n);
const MIN_PRICE = MEMBERSHIP_MINIMUMS.training / 100;
const JUMPS = [100, 300, 1000, 1500];

test("the bands come from the ledger: the registry table, the stairs, the meters and the rates in the copy", () => {
  let from = 1;
  const rows = BANDS.map((band) => {
    const open = !Number.isFinite(band.count);
    const range = open ? `Above ${whole(from - 1)}` : `${whole(from)}-${whole(from + band.count - 1)}`;
    if (!open) from += band.count;
    return [range, band.bps / 100 + "%"];
  });
  const bands = PAGE.sections.find((s) => s.id === "bands")!;
  assert.deepEqual(bands.table!.rows, rows);
  const rates = BANDS.map((band) => band.bps / 100);
  // Every rate the registry states is a band rate, in the ledger's order.
  for (const run of text(PAGE).matchAll(/(\d+)%, (\d+)%, (\d+)% (?:and|or) (\d+)%/g))
    assert.deepEqual(run.slice(1).map(Number), rates, run[0]);
  const html = main(render("off"));
  const shown = decode(section(html, "bands", "example"));
  for (const [range, rate] of rows) assert.ok(shown.includes(`${range.replace(/(\d)-(\d)/g, "$1–$2")} ${rate}`), range);
  // The hero stairs and the glance card: the same four rates and ranges.
  const stairs = between(html, 'class="mk-pr-stairs-card"', "</figure>");
  assert.deepEqual([...decode(stairs).matchAll(/(\d+)%/g)].map((m) => Number(m[1])), rates);
  assert.match(decode(stairs), /1–100 .* 101–300 .* 301–1,000 .* 1,001\+/);
  assert.match(
    stairs,
    /aria-label="Our share by band: 25% for subscribers 1 to 100, 20% for 101 to 300, 15% for 301 to 1,000, 10% above 1,000"/,
  );
  assert.match(decode(section(html, "glance", "bands")), /25 · 20 · 15 · 10%/);
  const fills = (n: number) => bandFills(compact(n, MIN_PRICE).bands, n, 1500);
  assert.deepEqual(fills(1), [0.01, 0, 0, 0]);
  assert.deepEqual(fills(150), [1, 0.25, 0, 0]);
  assert.deepEqual(fills(1000), [1, 1, 1, 0]);
  assert.deepEqual(fills(1500), [1, 1, 1, 1]);
});

test("every figure is the ledger's: the worked example, the sample statement and both calculators' first frame", () => {
  const e = compact(PRICING_EXAMPLE.subscribers, PRICING_EXAMPLE.priceAed, PRICING_EXAMPLE.sessionRateAed);
  // The plan's worked example: 150 × AED 199 = 29,850; 4,975 + 1,990 =
  // 6,965; you keep 22,885; about 92 sessions at AED 250. The lowest price
  // is the training membership's minimum, never a typed 199.
  assert.equal(PRICING_EXAMPLE.priceAed, MIN_PRICE);
  assert.deepEqual(
    [e.subscriptionMonthlyMinor, e.bands[0].commissionMinor, e.bands[1].commissionMinor, e.commissionMinor, e.beforeOtherCostsMinor, e.equivalentSessions],
    [2_985_000, 497_500, 199_000, 696_500, 2_288_500, 92],
  );
  // The registry says the same example in words, for llms-full.txt and the
  // assistant, which do not see the page's statement.
  const [first, next] = e.bands;
  assert.deepEqual(PAGE.sections.find((s) => s.id === "example")!.body, [
    `${PRICING_EXAMPLE.subscribers} subscribers at ${aed(PRICING_EXAMPLE.priceAed * 100)} a month bring ${aed(e.subscriptionMonthlyMinor)}. Our share is ${first.ratePct}% of the first ${first.subscribers} and ${next.ratePct}% of the next ${next.subscribers}: ${aed(e.commissionMinor)}.`,
    `You keep ${aed(e.beforeOtherCostsMinor)} before card processing and other costs, about ${e.equivalentSessions} sessions at AED ${PRICING_EXAMPLE.sessionRateAed}.`,
  ]);
  for (const state of STATES) {
    const html = main(render(state));
    const example = decode(section(html, "example", "hours"));
    assert.match(example, new RegExp(`150 × AED 199 ${aed(e.subscriptionMonthlyMinor)}`));
    assert.match(example, new RegExp(`Our share: 100 × 25% −${aed(e.bands[0].commissionMinor)}`));
    assert.match(example, new RegExp(`Our share: 50 × 20% −${aed(e.bands[1].commissionMinor)}`));
    assert.match(example, new RegExp(`Commission in all −${aed(e.commissionMinor)}`));
    assert.match(example, new RegExp(`You keep, before card processing and other costs ${aed(e.beforeOtherCostsMinor)}`));
    assert.match(example, /About 92 sessions at AED 250\./);
    const statement = decode(section(html, "statement", "how"));
    assert.match(statement, new RegExp(`Subscriptions, 150 × AED 199 ${aed(e.subscriptionMonthlyMinor)}`));
    assert.match(statement, new RegExp(`Our share, by band −${aed(e.commissionMinor)}`));
    // The lowest prices, beside the calculator and in "Who sets the price?",
    // are the ones activation enforces (membership-pricing.ts).
    const tool = decode(section(html, "example", "hours"));
    assert.ok(
      tool.includes(`Prices start at ${aed(MEMBERSHIP_MINIMUMS.training)} a month, ${aed(MEMBERSHIP_MINIMUMS.nutrition)} with nutrition or voice included and ${aed(MEMBERSHIP_MINIMUMS.complete)} with both.`),
      state,
    );
    assert.deepEqual(
      [monthlyMinimum({}), monthlyMinimum({ tier: "workout_nutrition" }), monthlyMinimum({ premiumVoice: true }), monthlyMinimum({ tier: "workout_nutrition", premiumVoice: true })],
      [MEMBERSHIP_MINIMUMS.training, MEMBERSHIP_MINIMUMS.nutrition, MEMBERSHIP_MINIMUMS.nutrition, MEMBERSHIP_MINIMUMS.complete],
    );
    assert.match(
      decode(between(html, "Who sets the price?", "</details>")),
      new RegExp(`from ${MEMBERSHIP_MINIMUMS.training / 100} a month \\(${MEMBERSHIP_MINIMUMS.nutrition / 100} with nutrition or voice included, ${MEMBERSHIP_MINIMUMS.complete / 100} with both\\)`),
    );
    // Every amount on the page is one of these: no other figure ships.
    const allowed = new Set([
      ...[e.subscriptionMonthlyMinor, e.commissionMinor, e.beforeOtherCostsMinor, ...e.bands.map((b) => b.commissionMinor)].map(aed),
      ...Object.values(MEMBERSHIP_MINIMUMS).map(aed),
      aed(PRICING_EXAMPLE.priceAed * 100),
      "AED " + PRICING_EXAMPLE.sessionRateAed,
      aed(0),
      ...PRICE_ANCHORS.map((a) => a.range),
      ...PRICE_ANCHORS.map((a) => a.range.replace("–", "-")),
    ]);
    for (const [match] of decode(html).matchAll(/AED [\d,]+(?:[–-][\d,]+)?\+?/g)) {
      const figure = match.replace(/,$/, "");
      assert.ok(allowed.has(figure), `${state}: ${figure}`);
    }
    // Every percentage is a band rate or a share the ledger computes: no
    // card-processing rate.
    const shares = new Set<number>([
      ...BANDS.map((band) => band.bps / 100),
      ...[...JUMPS, 300].map((n) => compact(n, MIN_PRICE).effectiveCommissionPct),
      e.effectiveCommissionPct,
    ]);
    const pcts = new Set([...shares].map((n) => sharePct(n)));
    for (const [p] of decode(html).matchAll(/\d+(?:\.\d+)?%/g)) assert.ok(pcts.has(p), `${state}: ${p}`);
  }
});

test("the share slider: 1 to 1,500, jumps to 100, 300, 1,000 and 1,500, one decimal, one polite live region", () => {
  assert.deepEqual(
    JUMPS.map((n) => sharePct(compact(n, MIN_PRICE).effectiveCommissionPct)),
    ["25%", "21.7%", "17%", "14.7%"],
  );
  // The share does not depend on the price (every band's rate of a whole
  // dirham is exact), so the slider computes it at the lowest price.
  for (const n of [1, 99, 100, 101, 150, 300, 301, 777, 1000, 1001, 1500])
    for (let price = MIN_PRICE; price <= 999; price += 50)
      assert.equal(compact(n, price).effectiveCommissionPct, compact(n, MIN_PRICE).effectiveCommissionPct, `${n} at ${price}`);
  const slider = between(main(render("off")), 'id="bands"', 'id="example"');
  const input = slider.match(/<input[^>]*type="range"[^>]*>/g)!;
  assert.equal(input.length, 1);
  assert.match(input[0], /min="1"/);
  assert.match(input[0], /max="1500"/);
  assert.match(input[0], /value="300"/);
  assert.match(input[0], /aria-valuetext="300 subscribers"/);
  const buttons = [...slider.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => m[1]);
  assert.equal(buttons.length, 4);
  JUMPS.forEach((n, i) => {
    const share = sharePct(compact(n, MIN_PRICE).effectiveCommissionPct);
    // Shown "1,000 → 17%"; heard "1,000 subscribers: 17%".
    assert.equal(decode(buttons[i].replace(/<span class="sr-only">[^<]*<\/span>/g, "")).trim(), `${whole(n)} → ${share}`);
    assert.equal(decode(buttons[i].replace(/<span aria-hidden="true">[^<]*<\/span>/g, "")).trim(), `${whole(n)} subscribers: ${share}`);
  });
  assert.equal((slider.match(/aria-live=/g) ?? []).length, 1);
  assert.match(slider, /<p class="sr-only" aria-live="polite"><\/p>/);
  assert.match(decode(slider), /Our share overall ?: 21\.7%/);
});

test("the take-home tile: from the membership minimum, the ledger's figures, one polite live region", () => {
  const html = main(render("off"));
  const calc = between(html.slice(html.indexOf('id="example"')), 'class="mk-pr-calc"', 'href="/earnings-calculator"');
  const inputs = calc.match(/<input[^>]*type="range"[^>]*>/g)!;
  assert.equal(inputs.length, 2);
  assert.match(inputs[0], new RegExp(`min="${MIN_PRICE}"`));
  assert.match(inputs[0], /max="999"/);
  assert.match(inputs[0], /value="199"/);
  assert.match(inputs[0], /aria-valuetext="AED 199 a month"/);
  assert.match(inputs[1], /min="1"/);
  assert.match(inputs[1], /max="1500"/);
  assert.match(inputs[1], /value="150"/);
  assert.match(inputs[1], /aria-valuetext="150 subscribers"/);
  const e = takeHome(150, MIN_PRICE, 250);
  assert.deepEqual(e, compact(150, MIN_PRICE, 250));
  const shown = decode(calc);
  assert.match(shown, new RegExp(`Subscriptions a month ${aed(e.subscriptionMonthlyMinor)}`));
  assert.match(shown, new RegExp(`Our share, ${sharePct(e.effectiveCommissionPct).replace(".", "\\.")} overall −${aed(e.commissionMinor)}`));
  assert.match(shown, new RegExp(`You keep before card processing and other costs ${aed(e.beforeOtherCostsMinor)}`));
  assert.match(shown, /About 92 sessions at AED 250, every month\./);
  assert.equal((calc.match(/aria-live=/g) ?? []).length, 1);
  // Readouts sit in fixed-width slots (app/marketing-pricing.css).
  assert.equal((calc.match(/class="mk-pr-slot mk-pr-out"/g) ?? []).length, 2);
});

test("labels: an arithmetic example, samples and the estimate; no card-processing rate and no placeholder", () => {
  for (const state of STATES) {
    const html = main(render(state));
    const example = section(html, "example", "hours");
    assert.match(decode(example), /An arithmetic example, not a forecast or promise\./);
    assert.match(decode(example), /Worked example 150 subscribers at AED 199 Sample/);
    assert.match(decode(example), /Try your numbers Estimate, not a promise/);
    const statement = decode(section(html, "statement", "how"));
    assert.match(statement, /Monthly statement Layla Strength · October Sample/);
    assert.match(statement, /Card processing Itemised Own domain/);
    assert.doesNotMatch(render(state), PLACEHOLDER, state);
  }
  assert.doesNotMatch(text(PAGE), PLACEHOLDER);
  for (const state of STATES) assert.doesNotMatch(text(marketingPageFor(PAGE, platform(state).availability)), PLACEHOLDER);
});

test("payments off and on: the strip before any AED figure, the chips, the notes and the paid answer", () => {
  const strip = (html: string) => decode(html.match(/<p class="mk-pf-strip[^"]*">([\s\S]*?)<\/p>/)![1]).trim();
  const firstAed = (html: string) => decode(html).search(/AED [\d,]/);
  for (const state of STATES) {
    const html = main(render(state));
    const shown = decode(html);
    const payments = state === "payments" || state === "on";
    const payouts = state === "on";
    const at = shown.indexOf(strip(html));
    assert.ok(at > 0 && at < firstAed(html), `${state}: the strip comes before the first amount`);
    // "What works today" opens the status band.
    if (!(payments && payouts)) assert.match(html, /<p class="mk-pf-strip">[\s\S]*?<a href="#status">What works today<\/a>/);
    assert.match(html, /<section [^>]*id="status"/);
    const faq = decode(between(html, "Can subscribers pay me today?", "</details>")).trim();
    if (!payments) {
      assert.match(strip(html), /Subscriber payments and payouts are not on yet\. What works today/);
      // The example's head, the calculator, the sample statement and "How you earn".
      assert.equal((shown.match(/Not on yet: subscriber payments/g) ?? []).length, 4, state);
      assert.match(decode(section(html, "status", "in-short")), /Not on yet .*Subscriber payments in AED/);
      assert.match(faq, /^Can subscribers pay me today\? Not yet\./);
      // Under every amount you keep; it invites a visit only while sign-ups are open.
      const notes = [...html.matchAll(/<p class="mk-pr-note">[\s\S]*?<span>([\s\S]*?)<\/span><\/p>/g)].map((m) => decode(m[1]));
      assert.equal(notes.length, 2, state);
      for (const note of notes)
        assert.equal(note.trim(), state === "closed" ? "Subscriber payments are not on yet." : "Subscriber payments are not on yet. Set up and teach your AI now.");
    } else {
      assert.doesNotMatch(shown, /Not on yet: subscriber payments|Subscriber payments are not on yet/);
      assert.match(faq, /Yes\. Subscribers pay you by card in AED\./);
      assert.match(strip(html), payouts ? /Subscriber payments and payouts are live\./ : /Payouts are not on yet\. What works today/);
    }
    assert.equal(/Not on yet: payouts/.test(decode(section(html, "payouts", "status"))), !payouts, state);
    // "How you earn" says what is not on yet of what it describes.
    const how = decode(section(html, "how", "billing"));
    assert.equal(/Not on yet: subscriber payments/.test(how), !payments, state);
    assert.equal(/Not on yet: payouts/.test(how), !payouts, state);
    assert.match(
      decode(section(html, "statement", "how")),
      payouts ? /Payouts are monthly, to your verified UAE IBAN\./ : /Payouts are monthly, to a verified UAE IBAN, once payouts are on\./,
    );
    const optional = decode(section(html, "glance", "bands"));
    assert.equal(/Not on yet: voice add-on/.test(optional), state !== "on", state);
    assert.equal(/Not on yet: your own domain/.test(optional), state !== "on", state);
  }
});

test("the calls to action: Teach your AI — free, early access while sign-ups are closed (never /signup), Estimate my earnings", () => {
  assert.ok(TEACH_CTA_PATHS.has("/pricing"));
  assert.equal(PAGE.cta, undefined);
  const links = (html: string, label: string) =>
    [...html.matchAll(new RegExp(`<a [^>]*href="([^"]+)"[^>]*>${label}`, "g"))].map((m) => m[1]);
  const open = render("off");
  const closed = render("closed");
  for (const [html, label, href] of [
    [open, "Teach your AI — free", "/signup"],
    [closed, "Join early access — free", "/get-started#early-access"],
  ]) {
    // The header, the hero and the closing panel.
    assert.ok(links(html, label).length >= 3, label);
    assert.ok(links(html, label).every((h) => h === href), label);
    for (const part of [between(html, 'class="mk-page-head"', "</header>"), between(html, 'class="mk-closing"', "</section>")]) {
      assert.deepEqual(links(part, label), [href]);
      assert.deepEqual(links(part, "Estimate my earnings"), ["/earnings-calculator"]);
    }
  }
  assert.doesNotMatch(closed, /href="\/signup/);
  assert.doesNotMatch(closed, /Teach your AI — free|Set up and teach your AI now/);
});

test("B's order in the house frame: one H1, In short, FAQs, related links, Last updated; the old calculator and anchors are gone", () => {
  const html = main(render("off"));
  const order = ["glance", "bands", "example", "hours", "statement", "how", "billing", "payouts", "status", "in-short", "faq"].map((id) =>
    html.indexOf(`id="${id}"`),
  );
  assert.ok(order.every((at, i) => at > 0 && (i === 0 || at > order[i - 1])), `order ${order}`);
  assert.ok(html.indexOf('class="mk-related"') > order.at(-1)!);
  assert.ok(html.indexOf("Last updated") > html.indexOf('class="mk-related"'));
  assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1);
  assert.match(html, /<nav class="mk-breadcrumbs"/);
  assert.match(decode(html), /Pricing, answered/);
  for (const faq of marketingPageFor(PAGE, platform("off").availability).faqs)
    assert.ok(decode(html).includes(brandText(faq.q, APP)), faq.q);
  // The compact calculator and the three old anchors leave /pricing.
  assert.doesNotMatch(html, /mk-calculator|mk-anchors/);
  assert.doesNotMatch(decode(html), /AED 200–700\+/);
  // The hours band: B's two anchors with their sources, body[1] as the lede
  // and body[0] with the note as the caption.
  const hours = PAGE.sections.find((s) => s.id === "hours")!;
  const band = section(html, "hours", "statement");
  assert.equal(PRICE_ANCHORS.length, 2);
  for (const anchor of PRICE_ANCHORS) {
    assert.ok(hours.body![0].includes(anchor.range.replace("–", "-")), anchor.range);
    assert.match(decode(band), new RegExp(anchor.range));
  }
  assert.deepEqual([...new Set(PRICE_ANCHORS.flatMap((a) => a.sources))].sort(), [...hours.sources!].sort());
  const badges = [...band.matchAll(/href="\/methodology#([\w-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(badges, PRICE_ANCHORS.flatMap((a) => a.sources));
  assert.ok(decode(band).indexOf(hours.body![1]) < decode(band).indexOf(PRICE_ANCHORS[0].range));
  assert.ok(decode(band).indexOf(hours.body![0]) > decode(band).indexOf(PRICE_ANCHORS[1].range));
  assert.ok(decode(band).includes(hours.note!));
});
