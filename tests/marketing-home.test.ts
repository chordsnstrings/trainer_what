// The home page (docs/marketing-revamp-2026-10-26/phase1/PLAN.md WP4):
// concept A's "Live Brain" home in the house tokens. The hero keeps one H1
// and its copy short, the field sits between the H1 and the lede, and the
// first paint waits for the whole hero; the bands are the registry's, in
// its order; every figure is computed (BANDS, estimateFollowerConversion)
// and every sample line is the traces' own; what is not on yet says so
// under every platform state, and the call to action never reaches
// /signup while sign-ups are closed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  HOME_OFFER,
  PROOF_LINKS,
  REPLACES,
  brandText,
  marketingPage,
  marketingPageFor,
} from "@trainer/contracts";
import { BANDS } from "@trainer/domain";
import {
  DEFAULT_FOLLOWER_INPUTS,
  DEFAULT_FOLLOWER_MODEL,
  aedWhole,
  estimateFollowerConversion,
} from "../packages/domain/src/marketing-calculators.ts";
import type { RawBrainData, Trace } from "../apps/web/components/marketing/brain/engine/types";
import { MarketingSite } from "../apps/web/components/marketing/site.tsx";
import { TEACH_CTA_PATHS } from "../apps/web/components/marketing/page-parts.tsx";
import type { PublicPlatform } from "../apps/web/components/marketing/platform.ts";
import { MODEL_OR_VENDOR, PLACEHOLDER } from "./marketing-helpers.ts";

const ORIGIN = "https://trainsyou.example";
const APP = "trainsyou";
type State = "closed" | "off" | "payments" | "on";
const STATES: State[] = ["closed", "off", "payments", "on"];
/** closed: sign-ups closed, every flag off; off: sign-ups open, payments and
 * payouts off; payments: payments on, payouts off; on: payments, payouts,
 * voice and nutrition on. */
const platform = (state: State, changes: Partial<PublicPlatform> = {}): PublicPlatform => ({
  name: APP,
  initials: "T",
  supportEmail: null,
  companyDetails: null,
  registrationOpen: state !== "closed",
  coachAddressTemplate: ORIGIN + "/coach/{slug}",
  availability: {
    model: true,
    nutrition: state === "on",
    voice: state === "on",
    customDomains: false,
    payments: state === "payments" || state === "on",
    payouts: state === "on",
    whoop: false,
    zepp: false,
    instagram: false,
    frontier: false,
  },
  followerModel: DEFAULT_FOLLOWER_MODEL,
  ...changes,
});
const PAGE = marketingPage("/")!;
const render = (p: PublicPlatform, showcase: "live" | "static" = "live", origin = ORIGIN) =>
  renderToStaticMarkup(createElement(MarketingSite, { page: PAGE, platform: p, origin, showcase }));
const main = (html: string) => html.slice(html.indexOf("<main"), html.indexOf("</main>"));
/** Visible text, with the non-breaking spaces of formatted amounts as spaces. */
const decode = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<template[\s\S]*?<\/template>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[\s  ]+/g, " ")
    .trim();
/** The markup of the first element opening with `open`, to its matching close. */
function element(html: string, open: RegExp | string): string {
  const found = typeof open === "string" ? html.indexOf(open) : html.search(open);
  assert.ok(found >= 0, `no ${open}`);
  // A marker inside a tag (`id="faq"`) means the element whose tag holds it.
  const start = html.lastIndexOf("<", found);
  const tag = html.slice(start + 1).match(/^[a-z0-9]+/)![0];
  let depth = 0;
  const re = new RegExp(`<${tag}[\\s>]|</${tag}>`, "g");
  re.lastIndex = start;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return html.slice(start, m.index + m[0].length);
  }
  throw new Error("unclosed " + tag);
}
const hero = (html: string) => element(html, '<section class="mk-hero mk-hm-hero"');
/** The hero without the field's first frame: the copy the visitor reads. */
const heroCopy = (html: string) => {
  const section = hero(html);
  return section.replace(element(section, '<div id="sc-field"'), "");
};
const t = (s: string) => brandText(s, APP);
const src = (path: string) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
/** The traces the showcases play: the flow window tells three of their moments. */
const TRACES = JSON.parse(src("apps/web/components/marketing/brain/data/traces.client.json")) as RawBrainData;
type Sample = Trace & { rule: { title: string }; inputs?: { increaseKg: number } };
const sample = (id: string) => TRACES.traces.find((trace) => trace.id.split("-")[0] === id) as Sample;

test("the hero: one H1 that the field follows, then the lede, the calls to action and the micro line", () => {
  assert.ok(TEACH_CTA_PATHS.has("/"));
  for (const state of STATES) {
    const html = render(platform(state));
    const section = hero(html);
    assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1, state);
    // The H1 is the registry's; the renderer adds the highlight and the
    // phones' line break, never words.
    const h1 = element(section, "<h1");
    assert.equal(decode(h1), t(PAGE.h1));
    assert.match(h1, new RegExp(`<span class="mk-mark">${PAGE.h1Highlight}</span>`));
    assert.match(h1, /<span class="mk-hm-l1">[\s\S]*<\/span><br class="mk-hm-br"\/><span class="mk-hm-l2">/);
    // DOM order H1, field, lede, calls to action, micro line: what phones
    // show and the focus order (no CSS order).
    const at = (needle: string) => {
      const i = section.indexOf(needle);
      assert.ok(i >= 0, `${state}: ${needle}`);
      return i;
    };
    const order = [
      at("<h1"),
      at('<div id="sc-field" class="sc-host">'),
      at('<p class="mk-hero-lede">'),
      at('class="button large mk-cta"'),
      at('class="button large secondary"'),
      at('<p class="mk-pf-micro">'),
    ];
    assert.deepEqual(order, [...order].sort((a, b) => a - b), state);
    assert.ok(decode(section).includes(t(PAGE.lede!)));
    const open = state !== "closed";
    assert.match(
      decode(heroCopy(html)),
      open
        ? /Teach your AI — free Try the demo Free to join · Nothing to pay upfront · Nothing goes live until you publish$/
        : /Join early access — free Try the demo Free to join · We’ll tell you here when sign-ups reopen$/,
      state,
    );
    assert.match(section, open ? /<a class="button large mk-cta" href="\/signup">/ : /<a class="button large mk-cta" href="\/get-started#early-access">/);
    assert.match(section, /<a class="button large secondary" href="\/demo">Try the demo<\/a>/);
    // A short hero with one name in it ("your AI"): the field's sample
    // lines carry the Pace marks (<mark class="mc-hl">), the copy never.
    const copy = heroCopy(html);
    assert.doesNotMatch(copy, /<mark[\s>]/, state);
    assert.doesNotMatch(decode(section), /Trainer Brain/, state);
    assert.doesNotMatch(decode(section), /payouts to a UAE bank/i, state);
    assert.match(decode(section), /\bUAE\b/);
  }
});

test("the first paint waits for the whole hero: one rel=expect, to the hero's last child", () => {
  const html = render(platform("off"));
  assert.deepEqual(html.match(/<link rel="expect"[^>]*>/g), ['<link rel="expect" href="#mk-hero-end" blocking="render"/>']);
  assert.ok(hero(html).endsWith('<span id="mk-hero-end" hidden=""></span></section>'));
  // In the source, the link comes before the copy.
  const source = src("apps/web/components/marketing/pages/home.tsx");
  const section = source.slice(source.indexOf('<section className="mk-hero mk-hm-hero"'));
  assert.ok(section.indexOf('<link rel="expect" href="#mk-hero-end" blocking="render" />') < section.indexOf('className="eyebrow"'));
  assert.match(section, /<span id="mk-hero-end" hidden \/>\s+<\/section>/);
  // No other marketing page blocks its first paint.
  for (const page of ["/how-it-works", "/pricing", "/trainer-brain", "/demo", "/features"]) {
    const other = renderToStaticMarkup(
      createElement(MarketingSite, { page: marketingPage(page)!, platform: platform("off"), origin: ORIGIN }),
    );
    assert.doesNotMatch(other, /rel="expect"/, page);
  }
});

test("the bands: the registry's headings in order; the showcases' bands keep still and the board is named by its heading", () => {
  const html = render(platform("off"));
  const h2s = [...main(html).matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map((m) => decode(m[1]));
  assert.deepEqual(h2s, [...PAGE.sections.map((s) => t(s.heading)), "Questions trainers ask", t("Your coaching. Beyond your hours.")]);
  for (const section of PAGE.sections)
    assert.match(html, new RegExp(`<section class="[^"]*" id="${section.id}" aria-labelledby="${section.id}-h">`), section.id);
  // The section reveal leaves the showcases' bands alone (motion.tsx NEVER).
  assert.match(html, /<section class="mk-home-band mk-home-paper mk-sc-band mk-hm-resort" id="resort"/);
  assert.equal((html.match(/data-showcase="(field|board)"/g) ?? []).length, 2);
  assert.match(element(html, '<div id="sc-field"'), /^<div id="sc-field" class="sc-host"><section class="mc sc-stage" data-showcase="field" data-sc="pre" data-nosnippet aria-label="A sample hour of your Brain">/);
  assert.match(element(html, '<div id="sc-board"'), /<section class="mb sc-stage" data-showcase="board" data-sc="pre" data-nosnippet aria-labelledby="resort-h">/);
  // Every other band keeps the sitewide reveal structure.
  for (const id of ["how", "subscribers", "control", "economics", "followers", "proof", "faq"])
    assert.match(element(html, `id="${id}"`), new RegExp(`^<section class="mk-home-band [^"]+" id="${id}" aria-labelledby="${id}-h"><div class="mk-container mk-home-inner">`), id);
  // The body links to the deeper pages.
  const links = [...main(html).matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  for (const href of ["/trainer-brain", "/demo", "/features", "/pricing", "/follower-calculator", "/how-it-works", "/faq", "/methodology", "/pricing#bands", "#status"])
    assert.ok(links.includes(href), href);
  assert.deepEqual(
    [...element(html, '<ul class="mk-hm-checks">').matchAll(/<a href="([^"]+)">([\s\S]*?)<svg/g)].map((m) => [m[1], decode(m[2])]),
    PROOF_LINKS.map((l) => [l.href, l.label]),
  );
  // The closing panel's second link is the demo.
  assert.match(element(html, '<section class="mk-closing"'), /href="\/demo">Try the demo/);
});

test("seven closed questions, the introduction first, equal to the FAQPage structured data in every state", () => {
  for (const state of STATES) {
    const html = render(platform(state));
    const details = [...main(html).matchAll(/<details class="mk-faq"><summary>([\s\S]*?)<\/summary><p>([\s\S]*?)<\/p><\/details>/g)];
    assert.equal(details.length, 7, state);
    const graph = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1].replace(/\\u003c/g, "<"));
    const faq = graph["@graph"].find((n: { "@type": string }) => n["@type"] === "FAQPage");
    assert.deepEqual(
      faq.mainEntity.map((q: { name: string; acceptedAnswer: { text: string } }) => [q.name, q.acceptedAnswer.text]),
      details.map((d) => [decode(d[1]), decode(d[2])]),
      state,
    );
    assert.equal(decode(details[0][1]), `How does ${APP} work?`);
    assert.equal(decode(details[0][2]), t(PAGE.intro));
    // "Can subscribers pay me today?" follows the payments flag.
    const today = details.find((d) => decode(d[1]) === "Can subscribers pay me today?")!;
    const payments = state === "payments" || state === "on";
    assert.equal(
      decode(today[2]),
      payments
        ? "Yes. Subscribers pay you by card in AED."
        : "Not yet. Subscriber payments are not on yet, and publishing your page waits for them. With an account you can already set up your page and app, and teach and test your AI.",
    );
    assert.match(element(html, 'id="faq"'), /href="\/faq">All questions/);
  }
});

test("free to start: what works today before any amount, the ledger's bands, the tools with their status, the address while sign-ups are open", () => {
  for (const state of STATES) {
    const html = main(render(platform(state)));
    const economics = element(html, 'id="economics"');
    // The status panel ("#status") comes before the first AED figure on the page.
    assert.ok(html.indexOf('id="status"') < html.search(/AED\s?[\d,]{2,}/), state);
    // The band list is BANDS: each rate and its range of paying subscribers.
    let from = 1;
    const expected = BANDS.map((band) => {
      const open = !Number.isFinite(band.count);
      const n = (v: number) => v.toLocaleString("en-GB");
      const range = open ? `${n(from)}+` : from === 1 ? `first ${n(band.count)}` : `${n(from)}–${n(from + band.count - 1)}`;
      if (!open) from += band.count;
      return `${band.bps / 100}% ${range}`;
    });
    const bands = [...element(economics, '<ul class="mk-hm-bands"').matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => decode(m[1]));
    assert.deepEqual(bands, expected);
    assert.deepEqual(expected, ["25% first 100", "20% 101–300", "15% 301–1,000", "10% 1,001+"]);
    // Tools it replaces: every REPLACES row, "Not on yet" while a provider it needs is off.
    const p = platform(state);
    const tools = [...element(economics, '<ul class="mk-hm-tools"').matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => decode(m[1]));
    assert.equal(tools.length, REPLACES.length);
    for (const row of REPLACES) {
      const name = row.tool.replace(/^An? /, "").replace(/^./, (c) => c.toUpperCase());
      const on = (row.availability ?? []).every((key) => p.availability[key]);
      assert.ok(tools.includes(on ? name : `${name} Not on yet`), `${state}: ${name}`);
    }
    // The claim box only while sign-ups are open, with the primary style's
    // wrapper (marketing.css: .mk-econ .mk-address .button).
    const claim = economics.match(/<div class="mk-econ"><div class="mk-address">[\s\S]*?<a class="button" href="\/signup">Claim this address<\/a>/);
    assert.equal(!!claim, state !== "closed", state);
    assert.equal(/Claim this address|your-name/.test(economics), state !== "closed", state);
  }
  // The address preview shows the platform's address without the scheme.
  const html = render(platform("off", { coachAddressTemplate: "https://{slug}.coach.example" }));
  assert.ok(decode(element(html, 'id="economics"')).includes("your-name.coach.example"));
  assert.ok(decode(element(html, 'id="subscribers"')).includes("Your site, your app icon, your-name.coach.example ."));
  assert.doesNotMatch(main(html), /https:\/\/[^"]*coach\.example/);
});

test("the follower estimate: the calculator's own figures, its status and source, and a call to action under it", () => {
  const estimate = estimateFollowerConversion(DEFAULT_FOLLOWER_INPUTS, DEFAULT_FOLLOWER_MODEL);
  const amounts = (["strong", "typical", "cautious"] as const).map((s) => decode(aedWhole(estimate.scenarios[s].revenueMonth12Minor)));
  assert.deepEqual(amounts, ["AED 23,084", "AED 2,985", "AED 398"]);
  for (const state of STATES) {
    const followers = element(render(platform(state)), 'id="followers"');
    const calc = decode(element(followers, '<div class="mk-home-calc">'));
    for (const amount of amounts) assert.ok(calc.includes(amount), `${state}: ${amount}`);
    const chips = decode(element(followers, '<p class="mk-hm-chips">'));
    const payments = state === "payments" || state === "on";
    assert.equal(chips, (payments ? "" : "Not on yet: subscriber payments ") + "Estimate, not a promise Source");
    assert.match(followers, /<a class="mk-pf-src"[^>]* href="\/methodology#revenuecat-state-2026"/);
    assert.match(
      decode(element(followers, '<div class="mk-hm-calc-foot">')),
      state === "closed" ? /^Join early access — free Free to join Open the full calculator$/ : /^Teach your AI — free Free to join Open the full calculator$/,
    );
  }
});

test("you stay in charge: the flow window tells the traces' own moments; the Never sheet is unsigned", () => {
  const html = render(platform("off"));
  const control = element(html, 'id="control"');
  const window = element(control, '<figure class="mk-hm-window"');
  assert.match(window, /data-sample-ui/);
  const omar = sample("t1"),
    yousef = sample("t6"),
    noura = sample("t2");
  const text = decode(window);
  const cap = (TRACES.settingsDefault.progression as { capPct: number }).capPct;
  const lane = TRACES.labels.lanes as Record<string, string>;
  assert.ok(text.includes(`${omar.member} ${omar.trigger.text}`));
  assert.ok(text.includes(`Your rule ${omar.rule.title} · +${omar.inputs!.increaseKg} kg within your ${cap}% cap`));
  assert.ok(text.includes(String(TRACES.labels.noChatScore)));
  const lanes = [...window.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) => decode(m[1]));
  assert.deepEqual(lanes, [
    `${lane.sent} ${omar.member} → your approved reply, +${omar.inputs!.increaseKg} kg This one`,
    `${lane.waits} ${yousef.member}: “skip the deload”`,
    `${lane.paused} ${noura.member}: “a pop in my knee”`,
  ]);
  // Each quote is the member's own words, and each moment ends in its lane.
  assert.ok(yousef.trigger.text.includes("skip the deload") && yousef.lane === "waits");
  assert.ok(noura.trigger.text.includes("a pop in my knee") && noura.lane === "paused");
  assert.equal(omar.lane, "sent");
  // The registry's body, its lead-in in bold.
  const body = PAGE.sections.find((s) => s.id === "control")!.body![0];
  assert.ok(decode(control).includes(t(body)));
  assert.match(control, /<strong>“Waits for me” mode:<\/strong> replies wait/);
  const never = element(control, '<div class="mk-pf-never"');
  assert.doesNotMatch(never, /founder|signature|signed/i);
  assert.match(control, /href="\/trainer-brain">How your AI decides/);
});

test("what subscribers get: the offer with its status, the sample app labelled and on the platform's address", () => {
  for (const state of STATES) {
    const p = platform(state);
    const subscribers = element(render(p), 'id="subscribers"');
    const rows = [...element(subscribers, '<ul class="mk-hm-offer">').matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => decode(m[1]));
    assert.deepEqual(
      rows,
      HOME_OFFER.map((item) => {
        const on = (item.availability ?? []).every((key) => p.availability[key]);
        return `${t(item.text)} ${item.offering}${on ? "" : " Not on yet"}`;
      }),
      state,
    );
    const phone = element(subscribers, '<figure class="mk-hm-sample"');
    assert.match(phone, /data-sample-ui/);
    assert.ok(decode(phone).endsWith("Sample trainer"));
    assert.ok(decode(phone).includes("trainsyou.example/coach/layla-strength"));
    // Meals only while the nutrition tier is on.
    assert.equal(/Meals/.test(decode(phone)), p.availability.nutrition, state);
  }
  // No literal coaching domain in the page's source: the address comes from the platform.
  assert.doesNotMatch(src("apps/web/components/marketing/pages/home.tsx"), /\.trainsyou\.com|trainsyou\.example/);
});

test("the walkthrough: the /how-it-works steps as tabs; publishing and getting paid say Not on yet until payments and payouts are on", () => {
  for (const state of STATES) {
    const p = platform(state);
    const how = element(render(p), 'id="how"');
    const steps = marketingPageFor(marketingPage("/how-it-works")!, p.availability).sections.find((s) => s.id === "steps")!.steps!;
    const rail = element(how, '<div class="mk-hm-walk-rail" role="tablist"');
    assert.match(rail, new RegExp(`aria-label="Setup to payday, ${steps.length} steps"`));
    const tabs = [...rail.matchAll(/<button[^>]*role="tab"[^>]*>([\s\S]*?)<\/button>/g)].map((m) => decode(m[1]));
    const live = p.availability.payments && p.availability.payouts;
    assert.deepEqual(
      tabs,
      steps.map((s, i) => `0${i + 1} ${t(s.title)}${!live && ["Publish and share", "Get paid monthly"].includes(s.title) ? " Not on yet" : ""}`),
      state,
    );
    // Tabs: the first selected and in the tab order, each with its panel;
    // only the first panel shows before any input.
    const buttons = [...rail.matchAll(/<button[^>]*role="tab"[^>]*>/g)].map((m) => m[0]);
    buttons.forEach((b, i) => {
      assert.match(b, new RegExp(`id="home-walk-t${i}" aria-controls="home-walk-p${i}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}"`));
    });
    const panels = [...how.matchAll(/<div class="mk-hm-walk-panel" role="tabpanel" id="home-walk-p(\d)" aria-labelledby="home-walk-t\d" tabindex="0"( hidden="")?>([\s\S]*?)<\/div>/g)];
    assert.equal(panels.length, steps.length);
    panels.forEach((m, i) => {
      assert.equal(!!m[2], i > 0);
      assert.ok(decode(m[3]).endsWith(t(steps[i].body)));
    });
    assert.match(how, /<button type="button" class="button secondary" aria-disabled="true">Previous<\/button><button type="button" class="button secondary" aria-disabled="false">Next step<\/button>/);
    // The three steps above it are the registry's.
    const three = [...element(how, '<ol class="mk-hm-steps">').matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => decode(m[1]));
    assert.deepEqual(three, PAGE.sections.find((s) => s.id === "how")!.steps!.map((s, i) => `0${i + 1} ${t(s.title)} ${t(s.body)}`));
  }
});

test("states and honesty: no /signup while sign-ups are closed, no brand on a renamed platform, no placeholder or model name, the still frame in static mode", () => {
  const closed = render(platform("closed"));
  assert.doesNotMatch(closed, /href="\/signup/);
  assert.match(closed, /Join early access — free/);
  assert.doesNotMatch(decode(closed), /Teach your AI — free/);
  // The showcases' own call to action follows the same rule.
  for (const id of ["sc-field", "sc-board"]) {
    const frame = element(closed, `<div id="${id}"`);
    assert.doesNotMatch(frame, /\/signup/, id);
  }
  const open = render(platform("off"));
  assert.match(element(open, '<div id="sc-field"'), /href="\/signup"/);
  for (const state of STATES) {
    const html = render(platform(state));
    assert.doesNotMatch(decode(html), PLACEHOLDER, state);
    assert.doesNotMatch(decode(html), MODEL_OR_VENDOR, state);
    assert.doesNotMatch(html, /signup\.html|\[(owner|rate)/, state);
  }
  // A renamed platform: its own name, never trainsyou, anywhere on the page.
  const acme = render(
    platform("on", { name: "Acme Coaching", initials: "AC", coachAddressTemplate: "https://{slug}.acme.example" }),
    "live",
    "https://acme.example",
  );
  assert.doesNotMatch(acme, /trainsyou/i);
  assert.match(decode(acme), /How does Acme Coaching work\?/);
  // MARKETING_SHOWCASE=static: both showcases render their still frame.
  const still = render(platform("off"), "static");
  assert.equal((still.match(/data-sc="off"/g) ?? []).length, 2);
  assert.doesNotMatch(still, /data-sc="pre"/);
  assert.equal(decode(element(still, '<div id="sc-field"')), decode(element(open, '<div id="sc-field"')));
});
