// The Trainer Brain and demo pages (docs/marketing-revamp-2026-10-26/phase1/
// PLAN.md WP5): concept A's pages with concept C's anatomy and the shared
// playground. The registry's headings come in its order with "In short"
// after them; the roster, the figure's key, the playground's banner and the
// /demo moments say what the Brain traces say (the data the showcases play,
// through the same prepare()); the showcases are labelled by the page's own
// headings; the samples are the product's; nothing reaches /signup while
// sign-ups are closed, no placeholder or model name ships, and static mode
// renders the still frames.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { brandText, marketingPage, marketingPageFor, type MarketingPage } from "@trainer/contracts";
import { DEFAULT_FOLLOWER_MODEL } from "../packages/domain/src/marketing-calculators.ts";
import { decide, defaults, isOff } from "../apps/web/components/marketing/brain/engine/decide.js";
import { prepare } from "../apps/web/components/marketing/brain/engine/data.js";
import type { Lane, RawBrainData, ShowcaseFlags } from "../apps/web/components/marketing/brain/engine/types";
import { SHOWS } from "../apps/web/components/marketing/brain/roster.tsx";
import { COMPARE_POINTS } from "../apps/web/components/marketing/brain-page-islands.tsx";
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
 * voice, nutrition and the frontier model on. */
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
    frontier: state === "on",
  },
  followerModel: DEFAULT_FOLLOWER_MODEL,
  ...changes,
});
const BRAIN = marketingPage("/trainer-brain")!;
const DEMO = marketingPage("/demo")!;
const render = (page: MarketingPage, p: PublicPlatform, showcase: "live" | "static" = "live", origin = ORIGIN) =>
  renderToStaticMarkup(createElement(MarketingSite, { page, platform: p, origin, showcase }));
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
const t = (s: string) => brandText(s, APP);
const src = (path: string) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const TRACES = JSON.parse(src("apps/web/components/marketing/brain/data/traces.client.json")) as RawBrainData;
const flagsOf = (p: PublicPlatform): ShowcaseFlags => ({
  payments: p.availability.payments,
  payouts: p.availability.payouts,
  voice: p.availability.voice,
  nutrition: p.availability.nutrition,
  recovery: false,
});
/** The traces as a page renders them: the platform's name and flags. */
const data = (p: PublicPlatform) => prepare(TRACES, { appName: p.name, flags: flagsOf(p) });
const LANES = TRACES.labels.lanes as Record<Lane, string>;
/** The H2s in main, in order. */
const h2s = (html: string) => [...main(html).matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map((m) => decode(m[1]));
const sectionOf = (page: MarketingPage, id: string) => page.sections.find((s) => s.id === id)!;
/** The FAQ rows as the page shows them, and as its FAQPage structured data says them. */
function faqs(html: string) {
  const shown = [...main(html).matchAll(/<details class="mk-faq"><summary>([\s\S]*?)<\/summary><p>([\s\S]*?)<\/p><\/details>/g)].map((d) => [decode(d[1]), decode(d[2])]);
  const graph = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1].replace(/\\u003c/g, "<"));
  const ld = graph["@graph"].find((n: { "@type": string }) => n["@type"] === "FAQPage");
  return { shown, ld: ld.mainEntity.map((q: { name: string; acceptedAnswer: { text: string } }) => [q.name, q.acceptedAnswer.text]) };
}

test("both pages have their own renderer and the call to action Teach your AI — free", () => {
  assert.ok(TEACH_CTA_PATHS.has("/trainer-brain") && TEACH_CTA_PATHS.has("/demo"));
  const brain = render(BRAIN, platform("off")),
    demo = render(DEMO, platform("off"));
  assert.match(brain, /<div class="mk-container mk-page mk-tb-hero">/);
  assert.match(demo, /<div class="mk-container mk-page mk-dm-hero">/);
  for (const html of [brain, demo]) {
    assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1);
    const head = element(html, '<header class="mk-page-head">');
    assert.match(head, /<a class="button large mk-cta" href="\/signup">Teach your AI — free/);
    assert.match(decode(head), /Free to join · Nothing to pay upfront · Nothing goes live until you publish$/);
  }
  assert.match(element(brain, '<header class="mk-page-head">'), /href="\/demo">Try the demo/);
  assert.match(element(demo, '<header class="mk-page-head">'), /href="\/how-it-works">See how it works/);
  assert.match(element(brain, '<section class="mk-closing"'), /href="\/demo">Try the demo/);
  assert.match(element(demo, '<section class="mk-closing"'), /href="\/how-it-works">See how it works/);
});

test("/trainer-brain: the registry's H1, lede and headings in order, In short after them, the questions equal their structured data", () => {
  for (const state of STATES) {
    const p = platform(state);
    const page = marketingPageFor(BRAIN, p.availability);
    const html = render(BRAIN, p);
    const head = element(html, '<header class="mk-page-head">');
    assert.equal(decode(element(head, "<h1")), t(page.h1));
    assert.ok(decode(head).includes(t(page.lede!)));
    assert.deepEqual(h2s(html), [
      ...page.sections.map((s) => t(s.heading)),
      "In short",
      "Questions about your AI",
      t("Your coaching. Beyond your hours."),
    ]);
    for (const section of page.sections) assert.match(html, new RegExp(`id="${section.id}" aria-labelledby="${section.id}-h"`), section.id);
    const at = (needle: string) => main(html).indexOf(needle);
    for (const section of page.sections) assert.ok(at(`id="${section.id}"`) < at('id="in-short"'), section.id);
    assert.ok(at('id="in-short"') < at('id="faq"'));
    assert.ok(decode(element(html, 'id="in-short"')).endsWith(t(page.intro)));
    const { shown, ld } = faqs(html);
    assert.equal(shown.length, 4, state);
    assert.deepEqual(shown, ld, state);
    // The frontier line, in "How it gets better" and the trained-on answer, only with its flag.
    const learns = decode(element(html, 'id="learns"'));
    assert.equal(learns.includes("A frontier model plus your corrections: it keeps getting better with time."), state === "on", state);
    assert.equal(/frontier model/.test(decode(html)), state === "on", state);
  }
});

test("/demo: the registry's H1, lede and headings, the playground under the head, In short after the sections", () => {
  for (const state of STATES) {
    const html = render(DEMO, platform(state));
    const head = element(html, '<header class="mk-page-head">');
    assert.equal(decode(element(head, "<h1")), t(DEMO.h1));
    assert.ok(decode(head).includes(t(DEMO.lede!)));
    assert.ok(!decode(head).includes(t(DEMO.intro)));
    assert.deepEqual(h2s(html), [...DEMO.sections.map((s) => t(s.heading)), "In short", "Demo questions", t("Your coaching. Beyond your hours.")]);
    // The playground follows the head, before the first section.
    const at = (needle: string) => main(html).indexOf(needle);
    assert.ok(at('<header class="mk-page-head">') < at('<div id="sc-play" class="sc-host">'));
    assert.ok(at('<div id="sc-play" class="sc-host">') < at('id="next"'));
    assert.ok(at('id="moments"') < at('id="in-short"') && at('id="in-short"') < at('id="faq"'));
    const { shown, ld } = faqs(html);
    assert.equal(shown.length, 4, state);
    assert.deepEqual(shown, ld, state);
    // What happens in an account: the registry's three steps, then the call to action.
    const next = element(html, 'id="next"');
    assert.deepEqual([...next.matchAll(/<h3>([\s\S]*?)<\/h3>/g)].map((m) => decode(m[1])), ["Setup", "Waits for me", "Your choice"]);
    assert.match(next, state === "closed" ? /href="\/get-started#early-access">Join early access — free/ : /href="\/signup">Teach your AI — free/);
  }
});

test("the roster: 14 AI specialists and 11 code steps, as the registry counts them; each status follows prepare() in every state", () => {
  const inside = sectionOf(BRAIN, "inside");
  assert.equal(inside.body![1], "14 AI specialists and 11 code steps.");
  assert.equal(inside.note, TRACES.labels.howWeCount, "the registry's How we count is the traces' own");
  for (const state of STATES) {
    const p = platform(state);
    const d = data(p);
    const html = element(render(BRAIN, p), 'id="inside"');
    const cards = [...html.matchAll(/<li class="mk-tb-box" data-kind="(ai|check)"( data-off="")?>([\s\S]*?)<\/li>/g)];
    assert.deepEqual(
      [cards.filter((c) => c[1] === "ai").length, cards.filter((c) => c[1] === "check").length],
      [14, 11],
      state,
    );
    for (const s of d.specialists) {
      const card = cards.find((c) => decode(c[3]).startsWith(s.name + " "));
      assert.ok(card, `${state}: ${s.name}`);
      const text = decode(card![3]);
      assert.ok(text.includes(String((d.labels.status as Record<string, string>)[s.status])), `${state}: ${s.name} is ${s.status}`);
      assert.equal(!!card![2], s.status === "not_on_yet", `${state}: ${s.name} dashed`);
      assert.ok(text.includes(s.line), s.name);
    }
    // While subscriber payments are off, the roster says what that means.
    assert.equal(decode(html).includes(TRACES.labels.subscribers!), !p.availability.payments, state);
    assert.ok(decode(element(html, "<details")).endsWith(TRACES.labels.howWeCount as string));
  }
  // With payments on, "try it on yourself" goes live only with the flag an item needs.
  const paid = data(platform("payments"));
  assert.equal(paid.sp.reply_picker.status, "live");
  assert.equal(paid.sp.meal_photo.status, "try_yourself");
  assert.equal(data(platform("on")).sp.meal_photo.status, "live");
});

test("See it work plays, in the playground on the same page, a moment the specialist takes part in", () => {
  const p = platform("off");
  const d = data(p);
  const html = render(BRAIN, p);
  const links = [...element(html, 'id="inside"').matchAll(/<a class="text-link mk-link" href="([^"]+)" data-run="(t\d+)">/g)];
  const runs = d.specialists.filter((s) => s.status !== "not_on_yet" && SHOWS[s.id]);
  assert.equal(links.length, runs.length);
  assert.ok(runs.length >= 15);
  const play = element(html, '<div id="sc-play" class="sc-host">');
  for (const [, href, run] of links) {
    // The band that holds the playground: its heading stays in view.
    assert.equal(href, "#play");
    assert.match(play, new RegExp(`class="bp-chip" data-t="${run}"`), run);
  }
  assert.ok(element(html, 'id="play"').includes('<div id="sc-play" class="sc-host">'));
  for (const s of d.specialists) {
    if (!SHOWS[s.id]) continue;
    const trace = d.trace(SHOWS[s.id]);
    assert.ok(!trace.defaultOff, `${s.id}: its moment plays`);
    assert.ok(trace.steps.some((step) => step.sp === s.id), `${s.id} works in ${trace.id}`);
  }
  // Specialists that are not on yet link nowhere.
  const cards = [...element(html, 'id="inside"').matchAll(/<li class="mk-tb-box"[^>]*>([\s\S]*?)<\/li>/g)].map((m) => m[1]);
  for (const s of d.specialists.filter((x) => x.status === "not_on_yet")) {
    const card = cards.find((c) => decode(c).startsWith(s.name + " "));
    assert.ok(card && !card.includes("data-run="), s.name);
  }
});

test("the figure's key and the trace chain name the lanes as the showcases do", () => {
  const html = render(BRAIN, platform("off"));
  const decides = element(html, 'id="decides"');
  const bullets = sectionOf(BRAIN, "decides").bullets!;
  const rows = [...element(decides, '<ul class="mk-tb-list">').matchAll(/<li><span class="mk-pf-chip ([\w-]+)">([^<]+)<\/span> ([^<]+)<\/li>/g)];
  assert.deepEqual(rows.map((r) => `${r[2]}: ${r[3]}`), bullets.map(t));
  assert.deepEqual(rows.map((r) => r[1]), ["mk-pf-live", "mk-pf-soon", "mk-tb-paused"]);
  for (const [lane, row] of [["sent", rows[0]], ["waits", rows[1]], ["paused", rows[2]]] as const) assert.ok(LANES[lane].startsWith(row[2]), lane);
  // The trace chain's decision went out on its own, within the rules.
  const what = element(html, 'id="what"');
  assert.match(what, new RegExp(`<span class="mk-pf-chip mk-pf-live">${LANES.sent}</span>`));
  assert.match(what, /data-sample-ui/);
  assert.ok(decode(what).endsWith("Sample trainer"));
});

test("the showcases: labelled by the page's headings, the sample labels, a named Pause button, a button for every moment; /demo plays one on its own", () => {
  assert.equal(sectionOf(BRAIN, "play").note, TRACES.labels.long, "the registry's play note is the playground's banner");
  for (const state of STATES) {
    const p = platform(state);
    const brain = render(BRAIN, p),
      demo = render(DEMO, p);
    const anatomy = element(brain, '<div id="sc-anatomy" class="sc-host">');
    assert.match(anatomy, /^<div id="sc-anatomy" class="sc-host"><section class="ca sc-stage" data-showcase="anatomy" data-sc="pre" data-nosnippet aria-labelledby="decides-h">/);
    const plays = [
      [element(brain, '<div id="sc-play" class="sc-host">'), ' aria-labelledby="play-h"'],
      [element(demo, '<div id="sc-play" class="sc-host">'), ` aria-label="${t(DEMO.h1)}"`],
    ] as const;
    for (const [root, name] of plays)
      assert.match(root, new RegExp(`^<div id="sc-play" class="sc-host"><section class="bp" data-showcase="play" data-sc="pre" data-nosnippet${name}>`));
    for (const root of [anatomy, ...plays.map(([r]) => r)]) {
      // The page supplies the heading; the root carries the honesty strip.
      assert.doesNotMatch(root, /<h2[\s>]/);
      assert.ok(decode(root).includes(TRACES.labels.chip), state);
      assert.equal(decode(root).includes(TRACES.labels.subscribers!), !p.availability.payments, state);
    }
    assert.match(anatomy, /<button type="button" class="ca-pause" aria-pressed="false" disabled>[\s\S]*?<span data-label>Pause<\/span><\/button>/);
    for (const [root] of plays) {
      assert.ok(decode(root).includes(TRACES.labels.long));
      assert.match(root, /<button disabled type="button" class="bp-pause" aria-pressed="false"><span data-label>Pause<\/span>/);
      const chips = [...root.matchAll(/class="bp-chip" data-t="(t\d+)"[^>]*>([^<]+)/g)].map((m) => [m[1], m[2]]);
      assert.deepEqual(
        chips.map((c) => c[0]).sort(),
        TRACES.traces.map((x) => x.id.split("-")[0]).sort(),
        "a button for every moment",
      );
      for (const [id, label] of chips) assert.equal(label, TRACES.traces.find((x) => x.id.startsWith(id + "-"))!.chip);
    }
    // /demo plays its first moment on its own once (attract); /trainer-brain waits for a visitor.
    assert.match(plays[1][0], /<div class="bp-diagram" data-attract>/);
    assert.doesNotMatch(plays[0][0], /data-attract/);
  }
  // Skip the figure: to the playground's band, which follows the figure.
  const html = render(BRAIN, platform("off"));
  const decides = element(html, 'id="decides"');
  assert.match(decides, /<a class="text-link mk-link" href="#play">Skip the figure/);
  assert.ok(main(html).indexOf('id="play"') > main(html).indexOf('id="decides"'));
});

test("/demo's sample moments: every moment once, each with the outcome its trace's lane gives under the sample settings", () => {
  const d = data(platform("off"));
  const S = defaults(d);
  const OUTCOME: Array<[RegExp, Lane | "off"]> = [
    [/^are sent on their own, within your rules\b/, "sent"],
    [/^wait for you\b/, "waits"],
    [/^pause training\b/, "paused"],
    [/^asks the member to confirm\b/, "member"],
    [/^suggests a new rule\b/, "learn"],
    [/^is not on yet\b/, "off"],
  ];
  const text = sectionOf(DEMO, "moments").body!.join(" ");
  // Runs of quoted chips ("A", "B" and "C"), each followed by its outcome.
  const quotes = [...text.matchAll(/“([^”]+)”/g)];
  const said = new Map<string, Lane | "off">();
  let run: string[] = [];
  quotes.forEach((q, i) => {
    run.push(q[1]);
    const after = text.slice(q.index! + q[0].length, quotes[i + 1]?.index ?? text.length);
    if (/^(,| and|, and) $/.test(after)) return;
    const phrase = after.replace(/^[\s,]+/, "");
    const outcome = OUTCOME.find(([re]) => re.test(phrase));
    assert.ok(outcome, `no outcome after “${q[1]}”: "${phrase}"`);
    for (const chip of run) {
      assert.ok(!said.has(chip), `${chip} twice`);
      said.set(chip, outcome![1]);
    }
    run = [];
  });
  assert.equal(said.size, TRACES.traces.length, "every sample moment");
  for (const trace of d.traces)
    assert.equal(said.get(trace.chip), isOff(trace, S) ? "off" : decide(trace, S, d).lane, trace.chip);
  assert.ok(decode(element(render(DEMO, platform("off")), 'id="moments"')).includes(text));
});

test("the samples are the product's: Compare my replies rates the app's five points, Approve all skips the flagged rule, deletion is a request", () => {
  const fidelity = src("apps/web/components/brain-fidelity.tsx").match(/const dimensions = \[([\s\S]*?)\] as const;/)![1];
  assert.deepEqual(COMPARE_POINTS.map(([point]) => point), [...fidelity.matchAll(/\["\w+", "([^"]+)"\]/g)].map((m) => m[1]));
  const html = main(render(BRAIN, platform("off")));
  const hero = element(html, '<div class="mk-container mk-page mk-tb-hero">');
  const ledger = decode(element(hero, '<figure class="mk-tb-stack" data-sample-ui'));
  assert.ok(ledger.includes("1 to review · 1 flagged Approve all (1) Flagged rules are never in “Approve all”."));
  assert.ok(ledger.includes("Flagged · conflicts with case 3"));
  assert.ok(ledger.endsWith("Sample trainer · try Confirm, Edit or Reject"));
  assert.match(hero, /<button type="button" class="button">Confirm<\/button><button type="button" class="button secondary">Edit<\/button><button type="button" class="button secondary mk-tb-no">Reject<\/button>/);
  const yours = decode(element(html, 'id="yours"'));
  assert.ok(yours.includes("Download your data and request deletion"));
  assert.doesNotMatch(yours, /delete it whenever/i);
  // The release and comparison windows say they are samples.
  const learns = element(html, 'id="learns"');
  assert.match(decode(element(learns, '<div class="mk-tb-box mk-tb-rel"')), /^Releases Sample /);
  assert.match(decode(element(learns, '<div class="mk-tb-box mk-tb-cmp"')), /^Compare my replies Blind · sample /);
});

test("what it never does and what stays yours: the registry's lists, the Never sheet unsigned", () => {
  const html = render(BRAIN, platform("off"));
  const never = element(html, 'id="never"');
  const lines = [...never.matchAll(/<span class="mk-pf-never-word">Never<\/span><span>([^<]+)<\/span>/g)].map((m) => m[1]);
  assert.deepEqual(lines, sectionOf(BRAIN, "never").bullets);
  assert.ok(decode(never).endsWith(sectionOf(BRAIN, "never").note!));
  assert.doesNotMatch(never, /founder|signature|signed/i);
  const yours = [...element(html, 'id="yours"').matchAll(/<li>[\s\S]*?<span>([^<]+)<\/span><\/li>/g)].map((m) => m[1]);
  assert.deepEqual(yours, sectionOf(BRAIN, "yours").bullets);
  // The five ways to teach are the registry's cards.
  const teach = [...element(html, 'id="teach"').matchAll(/<h3>([^<]+)<\/h3><p>([^<]+)<\/p>/g)].map((m) => [m[1], decode(m[2])]);
  assert.deepEqual(teach, sectionOf(BRAIN, "teach").cards!.map((c) => [c.title, t(c.body)]));
});

test("states and honesty: no /signup while sign-ups are closed, no brand on a renamed platform, no placeholder or model name", () => {
  for (const page of [BRAIN, DEMO]) {
    const closed = render(page, platform("closed"));
    assert.doesNotMatch(closed, /href="\/signup/, page.path);
    assert.match(closed, /Join early access — free/, page.path);
    assert.doesNotMatch(decode(closed), /Teach your AI — free/, page.path);
    for (const state of STATES) {
      const html = render(page, platform(state));
      assert.doesNotMatch(decode(html), PLACEHOLDER, `${page.path} ${state}`);
      assert.doesNotMatch(decode(html), MODEL_OR_VENDOR, `${page.path} ${state}`);
      assert.doesNotMatch(html, /signup\.html|undefined-|\[(owner|rate)/, `${page.path} ${state}`);
      // Every id once (the showcases' inner ids carry their host's).
      const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
      assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), [], `${page.path} ${state}`);
    }
    const acme = render(page, platform("on", { name: "Acme Coaching", initials: "AC", coachAddressTemplate: "https://{slug}.acme.example" }), "live", "https://acme.example");
    assert.doesNotMatch(acme, /trainsyou/i, page.path);
  }
  for (const file of ["pages/trainer-brain.tsx", "pages/demo.tsx", "brain/roster.tsx", "brain-page-islands.tsx"])
    assert.doesNotMatch(src("apps/web/components/marketing/" + file), /trainsyou/i, file);
});

test("static mode (MARKETING_SHOWCASE=static): the still frames, the anatomy flat", () => {
  const brain = render(BRAIN, platform("off"), "static"),
    demo = render(DEMO, platform("off"), "static");
  assert.deepEqual([...brain.matchAll(/data-showcase="(\w+)" data-sc="off"( data-sc-flat)?/g)].map((m) => m[1] + (m[2] ?? "")), ["anatomy data-sc-flat", "play"]);
  assert.deepEqual([...demo.matchAll(/data-showcase="(\w+)" data-sc="off"/g)].map((m) => m[1]), ["play"]);
  for (const html of [brain, demo]) assert.doesNotMatch(html, /data-sc="pre"/);
  assert.equal(decode(element(brain, '<div id="sc-play"')), decode(element(render(BRAIN, platform("off")), '<div id="sc-play"')));
});
