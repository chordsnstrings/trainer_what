// The decision anatomy and the playground, the two showcases of
// /trainer-brain (docs/marketing-revamp-2026-10-26/phase1/PLAN.md WP3): their
// first frames, the claims their copy shares with the product, their
// stylesheets and their runtimes' contracts. The browser checks
// (scripts/marketing-showcase-check.mjs) drive the runtimes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RED_FLAG_CATEGORIES, redFlagCategories } from "../packages/domain/src/red-flags.ts";
import { renderShowcase } from "../apps/web/components/marketing/brain/render.ts";
import { esc } from "../apps/web/components/marketing/brain/engine/core.js";
import { prepare } from "../apps/web/components/marketing/brain/engine/data.js";
import { decide, defaults, isOff, pick, totals } from "../apps/web/components/marketing/brain/engine/decide.js";
import { COPY, NOTES, ROOT, model, note, renderStatic } from "../apps/web/components/marketing/brain/engine/anatomy.render.js";
import * as play from "../apps/web/components/marketing/brain/engine/play.render.js";
import { closest } from "../apps/web/components/marketing/brain/engine/play.keys.js";
import type { BrainData, RawBrainData, RenderOptions, ShowcaseOptions } from "../apps/web/components/marketing/brain/engine/types";
import { C0_BANNED, MODEL_OR_VENDOR, PLACEHOLDER, cssRules } from "./marketing-helpers.ts";

const src = (path: string) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const ENGINE = "apps/web/components/marketing/brain/engine/";
const TRACES = JSON.parse(src("apps/web/components/marketing/brain/data/traces.client.json")) as RawBrainData;
const FLAGS = { payments: false, payouts: false, voice: false, nutrition: false, recovery: false };
const options = (patch: Partial<ShowcaseOptions> = {}): ShowcaseOptions => ({
  appName: "trainsyou",
  cta: { label: "Join early access — free", href: "/get-started#early-access" },
  flags: FLAGS,
  heading: false,
  labelledBy: "decides-h",
  ...patch,
});
const render = (patch: Partial<ShowcaseOptions> = {}, id = "sc-anatomy") => {
  const o: RenderOptions = { ...options(patch), kind: "anatomy", id };
  return { d: prepare(TRACES, o), html: renderStatic(prepare(TRACES, o), o) };
};
/** The elements of a render whose opening tag matches, as their opening tags. */
const tags = (html: string, re: RegExp) => [...html.matchAll(/<[a-z][^>]*>/g)].map((m) => m[0]).filter((t) => re.test(t));

// ---------------------------------------------------------------- 3a: the decision anatomy

test("the anatomy renders the root's inner HTML only: no outer section, skip link or live region; every inner id carries the host id", () => {
  const { html } = render({}, "sc-x");
  assert.doesNotMatch(html, /<section|data-sc-module|data-showcase|ca-skip|ca-after|Skip the|aria-live|data-live/);
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, "abcdefghij".split("").map((k) => "sc-x-" + k), "the notes, (a)–(j), are the only ids, each after the host id");
  // Every inner id is prefixed even with a heading of its own, and unique: its heading is not note (h).
  const withHead = render({ heading: true, labelledBy: undefined }, "sc-y").html;
  const own = [...withHead.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  for (const id of own) assert.ok(id.startsWith("sc-y-"), id);
  assert.equal(new Set(own).size, own.length, own.join(" "));
});

test("heading: false leaves the H2 to the page, which labels the root; with heading the figure carries its own", () => {
  const live = renderShowcase("anatomy", { ...options(), kind: "anatomy", id: "sc-anatomy" }, "live");
  const open = live.slice(0, live.indexOf(">") + 1);
  assert.equal(open, `<section class="${ROOT.anatomy}" data-showcase="anatomy" data-sc="pre" data-nosnippet role="group" aria-labelledby="decides-h">`);
  assert.equal(ROOT.anatomy, "ca sc-stage", "the ink stage");
  assert.doesNotMatch(live, /<h[1-6]/, "no heading of its own");
  const own = render({ heading: true, labelledBy: undefined }).html;
  assert.match(own, /<h2 class="ca-h2" id="sc-anatomy-title">Anatomy of one decision<\/h2>/);
  assert.match(own, new RegExp(`<p class="ca-lede">${COPY.lede}</p>`));
  assert.doesNotMatch(own, /§|Fig\. \d/, "no section or figure numbers (C's skin)");
  const flat = renderShowcase("anatomy", { ...options(), kind: "anatomy", id: "sc-anatomy" }, "static");
  assert.match(flat, /^<section class="ca sc-stage" data-showcase="anatomy" data-sc="off" data-sc-flat /);
});

test("the first frame is the finished figure: Omar's reply in nine lit plates, code picks the Reply picker, sent on its own", () => {
  const { d, html } = render();
  const plates = tags(html, /class="ca-p[ "]/);
  assert.deepEqual(plates.map((t) => t.match(/data-k="(\w)"/)![1]).join(""), "abcdefghi");
  assert.ok(plates.every((t) => / data-lit /.test(t)), "every plate lit");
  assert.deepEqual(plates.map((t) => t.match(/data-state="(\w+)"/)![1]), ["pass", "pass", "pass", "pass", "pass", "lit", "pass", "sent", "sent"]);
  assert.match(html, /<span class="ca-sp" data-sp="reply_picker" data-kind="ai" data-pick>/, "the picked pill");
  assert.equal(tags(html, /data-pick/).length, 2, "lit in the compact row and in the labelled grid");
  assert.equal(pick(d.trace("t1"), d, defaults(d)), "reply_picker");
  // (h) and the reply card: the lane decide() gives, in the data's words
  assert.match(html, /<span class="sc-lane ca-lane" data-lane="sent">Sent on its own, within your rules<\/span>/);
  assert.match(html, /<b>Answered Omar<\/b><small>Feed · 18:40 · sample<\/small>/);
  // matrices: every plate the moment reaches is lit
  const dark = [...html.matchAll(/<span class="ca-mx"[^>]*>((?:<i[^>]*><\/i>){9})<\/span>/g)].filter((m) => !/^(<i class="on"><\/i>){9}$/.test(m[1]));
  assert.equal(dark.length, 0);
  // the rulebook reads the sample trainer's level and Omar's rule
  assert.match(html, /<p class="ca-bcite"><mark>Barbell load progression<\/mark><\/p><p class="ca-blv">Brain level 2 · Routine replies<\/p>/);
  assert.match(html, /You edit Zayed’s draft/);
  assert.match(html, /<b>Upper body increments<\/b>/);
});

test("(f): the seven coaching specialists code picks from, each with its moment; one not on yet keeps its place, dashed and marked, so the plate matches the note's count", () => {
  const grid = (html: string) => html.slice(html.indexOf('<div class="ca-x">'));
  const pills = (html: string) => [...grid(html).matchAll(/<span class="ca-sp" data-sp="(\w+)" data-kind="(\w+)"/g)].map((m) => m[1] + ":" + m[2]);
  const off = (html: string) => [...grid(html).matchAll(/<span class="ca-sp" data-sp="(\w+)"[^>]*data-off/g)].map((m) => m[1]);
  const seven = ["reply_picker", "draft_writer", "plan_writer", "week_reviewer", "meal_photo", "voice_lines", "meal_planner"];
  const { d, html } = render();
  // The plate is the coach crew, all seven AI specialists, in every flag state; no shelf beside it.
  assert.deepEqual([...seven].sort(), d.specialists.filter((s) => s.crew == "coach").map((s) => s.id).sort());
  assert.deepEqual(pills(html), seven.map((s) => s + ":ai"));
  assert.equal((html.match(/<span class="ca-sp" /g) || []).length, 14, "seven in the compact row, seven in the labelled grid");
  assert.doesNotMatch(html, /ca-shelf/);
  // Voice and nutrition off (the platform's default): their specialists keep their places, marked.
  assert.deepEqual(off(html), ["meal_photo", "voice_lines", "meal_planner"]);
  assert.match(grid(html), /<b>Meal photo reader<\/b><small>meal photo · Not on yet<\/small>/);
  assert.match(grid(html), /<b>Meal planner<\/b><small>Not on yet<\/small>/);
  for (const s of d.specialists.filter((x) => x.crew == "coach")) assert.equal(off(html).includes(s.id), s.status == "not_on_yet", s.id);
  // Every flag on: nothing marked; the Meal planner has no sample moment.
  const all = render({ flags: { ...FLAGS, voice: true, nutrition: true, mealPhotos: true } }).html;
  assert.deepEqual(pills(all), seven.map((s) => s + ":ai"));
  assert.doesNotMatch(all, /data-off/);
  assert.match(grid(all), /<b>Meal planner<\/b><\/span>/);
  // The AI model off: every one marked.
  const noModel = render({ flags: { ...FLAGS, voice: true, nutrition: true, model: false } }).html;
  assert.deepEqual(off(noModel), seven);
  assert.match(html, /<em class="ca-tag">Chat · a rule fits<\/em>/);
  assert.ok(html.includes(String(d.labels.picks)), "Code picks the specialist. No AI chooses which AI runs.");
});

test("the ghost stacks run only moments that are on: one not on yet never runs beside Omar's, and no pill not on yet is tagged", () => {
  const places = (html: string) => [...html.matchAll(/<div class="ca-g" data-g="(\d)"/g)].map((m) => +m[1]);
  assert.deepEqual(places(render().html), [0, 1, 3, 4], "nutrition off: Priya's meal photo stays out; the others keep their places");
  assert.deepEqual(places(render({ flags: { ...FLAGS, voice: true, nutrition: true, mealPhotos: true } }).html), [0, 1, 2, 3, 4]);
  assert.deepEqual(places(render({ flags: { ...FLAGS, voice: true, nutrition: true } }).html), [0, 1, 3, 4], "meal photos have their own switches");
  assert.deepEqual(places(render({ flags: { ...FLAGS, model: false } }).html), [1, 3], "the AI model off: only code's moments, the knee stop and a topic");
  const js = src(ENGINE + "anatomy.js");
  assert.match(js, /const GP = ghostsOf\(d\)\.map\(/, "the runtime's tags follow the same list");
  assert.match(js, /pill\.hasAttribute\("data-off"\)\) return;/);
});
test("its buttons wait for the engine: notes, What-ifs and Pause disabled in the first frame; Omar's reply pressed", () => {
  const { html } = render();
  const buttons = tags(html, /^<button/);
  assert.equal(buttons.length, 10 + 4 + 1);
  assert.ok(buttons.every((b) => / disabled/.test(b) && /type="button"/.test(b)));
  const whatIf = buttons.filter((b) => /ca-wb/.test(b)).map((b) => b.match(/data-w="(\w+)" aria-pressed="(\w+)"/)!.slice(1).join("="));
  assert.deepEqual(whatIf, ["knee=false", "plan=false", "level1=false", "base=true"]);
  assert.match(html, /<div class="ca-wi" role="group" aria-label="Try another moment">/);
  // Pause names what a press does ("Pause" or "Play"), so it is no toggle: no aria-pressed (A11Y-11).
  assert.match(html, /<button type="button" class="ca-pause" disabled>/);
  assert.doesNotMatch(src(ENGINE + "anatomy.js"), /pb\.setAttribute\("aria-pressed"/);
});

test("the AI model off: Omar's moment is not on yet, and the figure says so: no pick, no lane, (f) to (j) said as once it is on", () => {
  const { d, html } = render({ flags: { ...FLAGS, model: false } }), S = defaults(d), M = model(d, d.trace("t1"), S);
  assert.ok(M.off && M.pick == null && d.trace("t1").status == "not_on_yet");
  assert.equal(M.plates.map((p) => p.k + ":" + p.state).join(" "), "a:pass b:pass c:pass d:pass e:pass f:skip g:skip h:skip i:skip");
  // Never a picked pill that is not on yet (ENG-3), and no lane: (h) and the card are a dashed "Not on yet".
  assert.equal(tags(html, /data-pick/).length, 0);
  assert.equal((html.match(/<span class="sc-lane ca-lane is-dashed">Not on yet<\/span>/g) || []).length, 2, "(h) and the reply card");
  assert.doesNotMatch(html, /data-lane="sent"|Sent on its own|Answered Omar/);
  assert.match(html, /<b>Omar · Squats felt easy<\/b>/);
  assert.match(html, /Built and tested\. Not on yet\./);
  assert.ok(html.includes(esc(COPY.srOff)));
  for (const k of ["f", "g", "h", "i", "j"]) assert.match(note(d, k, true), /once it is on/i, k);
  assert.match(note(d, "f", true), /^Seven coaching specialists\. None is on yet\. Code picks one from the kind of moment\. A rule fits, so it would be the Reply picker, once it is on\./);
  assert.ok(html.includes(esc(note(d, "h", true))), "the notes say it");
  // The What-ifs whose moment does not run say so; the knee stop (code only) still runs.
  const wi = tags(html, /class="ca-wb"/).map((t) => t.match(/data-w="(\w+)"/)![1] + (/ data-off/.test(t) ? ":off" : ""));
  assert.deepEqual(wi, ["knee", "plan:off", "level1:off", "base"]);
  assert.match(html, /What if it’s a plan change\?<small> · Not on yet<\/small>/);
  // With the model on, nothing of this.
  const on = render().html;
  assert.doesNotMatch(on, /data-off[^>]*>What if|is-dashed|Once it is on/);
  // The runtime keeps it: the card and every announcement read not on yet, never a lane.
  const js = src(ENGINE + "anatomy.js");
  assert.match(js, /c\.classList\.toggle\("is-dashed", M\.off\)/);
  assert.match(js, /const outcome = \(\) => \(M\.off \? d\.labels\.status\.not_on_yet : d\.labels\.lanes\[M\.r\.lane\]\)/);
});

test("a change of mode keeps the visitor's Pause (WCAG 2.2.2), and focus never stays on a note the phone step hides", () => {
  const js = src(ENGINE + "anatomy.js");
  // restart(): the pinned run's own Pause is read before it stops, kept through a flat run, and handed on.
  assert.match(js, /if \(run\.held\) held = run\.held\(\);\s+run\.stop\(\);[\s\S]*?run = figure\(root, d, S0, o, true, say, held\);/);
  assert.match(js, /if \(held0\) gsc\.pause\(\), gscIntro\.pause\(\);/);
  assert.match(js, /return \{ stop, held: \(\) => gsc\.reasons\.has\("user"\) \};/);
  // noteSet(): a focused note that leaves the step hands focus to the step's note, or to the figure.
  assert.match(js, /if \(was && was\.tabIndex < 0\) \{[\s\S]*?\.focus\(\{ preventScroll: true \}\);/);
});

test("honesty: sample labels, the status strip by payments state, the platform's safety rules, no placeholder, internals, links or images", () => {
  const { d, html } = render();
  assert.match(html, /<p class="ca-cap">Omar asks to go up in weight\. Sample, scripted, no AI model called\.<\/p>/);
  assert.ok(html.includes(`<span class="sc-sample">${d.labels.chip}</span>`), "the honesty chip");
  assert.ok(html.includes(esc(d.labels.subscribers)), "while subscriber payments are off, the strip says so");
  assert.match(html, /Omar · chat · 18:40 · sample/);
  assert.match(html, /24<\/span><span>25<\/span><\/span> rules \(sample\)/);
  assert.match(html, /Last check: passed \(sample\)/);
  const paid = render({ flags: { ...FLAGS, payments: true } });
  assert.equal(paid.d.labels.subscribers, undefined);
  assert.doesNotMatch(paid.html, /sc-subs|subscriber payments are not on/);
  // (b) cites the always-on rules with the platform's name, escaped
  assert.match(html, /<b>Platform safety rules<\/b> · trainsyou\. Can&#39;t switch off\./);
  const evil = render({ appName: "<b>x</b>" }).html;
  assert.match(evil, /&lt;b&gt;x&lt;\/b&gt;\. Can&#39;t switch off\./);
  assert.doesNotMatch(evil, /<b>x<\/b>/);
  assert.doesNotMatch(html, PLACEHOLDER);
  assert.doesNotMatch(html, /apps\/|packages\/|\.tsx?\b|basisCommit|verbatim|\{APP_NAME\}/, "no internal fields");
  assert.doesNotMatch(html, /<a |<img|<video|poster=|href=/, "no links (no call to action of its own) and no images");
});

test("the copy's claims hold in the product: nine kinds, 28 days, +2.5 kg is 4.2% inside the 5% cap, four sets at 2 in reserve, seven coaching specialists with one not on yet, level 2, the Reply picker", () => {
  const { d } = render();
  const S = defaults(d), t1 = d.trace("t1") as BrainData["traces"][number] & { inputs: Record<string, number> };
  assert.match(NOTES.b[1], /Nine kinds, in English and Arabic/);
  assert.equal(RED_FLAG_CATEGORIES.length, 9);
  assert.match(NOTES.d[1], /his last 28 days of training/);
  assert.ok(d.sp.memory.line.includes("the last 28 days of training"));
  const pct = ((t1.inputs.increaseKg / t1.inputs.loadKg) * 100).toFixed(1);
  assert.equal(NOTES.e[1], `Which approved replies fit? One: +${t1.inputs.increaseKg} kg. That’s ${pct}%, inside your ${S.capPct}% cap.`);
  assert.equal(NOTES.a[1], `Omar logged ${["", "one", "two", "three", "four"][t1.inputs.sets]} sets with ${t1.inputs.rir} reps in reserve. He asks to go up.`);
  const coach = d.specialists.filter((s) => s.crew == "coach" && s.kind == "ai");
  assert.equal(coach.length, 7);
  assert.match(NOTES.f[1], /^Seven coaching specialists\. \{off\}Code picks one/);
  // (f) counts the coaching specialists not on yet under the page's flags.
  const f = (flags: Partial<ShowcaseOptions["flags"]>) => note(render({ flags: { ...FLAGS, ...flags } }).d, "f");
  assert.equal(coach.filter((s) => s.status == "not_on_yet").length, 3, "voice and nutrition off: Meal planner, Meal photo reader, Voice lines");
  assert.match(note(d, "f"), /^Seven coaching specialists\. Three are not on yet\. Code picks one/);
  assert.match(f({ nutrition: true, mealPhotos: true }), /^Seven coaching specialists\. One is not on yet\. Code picks/);
  assert.match(f({ nutrition: true }), /^Seven coaching specialists\. Two are not on yet\. Code picks/, "meal photos have their own switches");
  assert.match(f({ nutrition: true, mealPhotos: true, voice: true }), /^Seven coaching specialists\. Code picks/);
  assert.match(f({ model: false }), /^Seven coaching specialists\. None is on yet\. Code picks/);
  assert.ok(render().html.includes(esc(note(d, "f"))), "the notes and plate (f) say it");
  assert.match(NOTES.f[1], /so it’s the Reply picker/);
  assert.equal(d.sp[pick(t1, d, S)!].name, "Reply picker");
  assert.match(NOTES.h[1], new RegExp(`at level ${S.level} and passed its last check`));
  const M = model(d, t1, S);
  assert.equal(M.r.lane, "sent");
  // "four code checks, then one AI specialist that code picks, then more code checks"
  assert.deepEqual(M.plates.map((p) => p.kind).join(" "), "msg check check check check ai check check msg");
  assert.match(COPY.sr, /passes four code checks, then one AI specialist that code picks, then more code checks, and is sent on its own/);
  assert.match(NOTES.i[1], /No AI wording/);
  assert.ok(!M.r.memberSees!.parts.some((x) => x.by == "ai"), "Omar reads no AI words");
  assert.match(NOTES.j[1], /About a minute later, your AI answers your test cases and code marks them\. It goes live only if they pass\./);
  assert.ok(d.trace("t7").steps.some((s) => s.sp == "examiner" && /About a minute later/.test(s.say)));
});

test("the What-ifs replay real decisions: a popped knee stops at the safety rules with no AI called; a plan change and level 1 wait for you", () => {
  const { d } = render();
  const S = defaults(d), state = (M: ReturnType<typeof model>) => M.plates.map((p) => p.k + ":" + p.state).join(" ");
  const knee = model(d, d.trace("t2"), S);
  assert.equal(COPY.whatIf[0][2], "t2");
  assert.ok(knee.stop && knee.pick == null && knee.r.lane == "paused");
  assert.equal(state(knee), "a:pass b:hit c:skip d:skip e:skip f:skip g:skip h:paused i:paused");
  const plan = model(d, d.trace("t8"), S);
  assert.equal(COPY.whatIf[1][2], "t8");
  assert.ok(plan.r.lane == "waits" && plan.pick == "week_reviewer" && plan.r.sure!.display.includes("your bar"));
  const level1 = model(d, d.trace("t1"), { ...S, level: COPY.whatIf[2][3]! });
  assert.ok(level1.r.lane == "waits" && COPY.whatIf[2][3] == 1);
});

test("the render is well-formed HTML: every element it opens, it closes (no parser fix-up, so no hydration mismatch)", () => {
  for (const patch of [{}, { heading: true }, { flags: { ...FLAGS, payments: true } }]) {
    const { html } = render(patch);
    const VOID = new Set(["br", "img", "input", "hr", "meta", "link"]);
    const stack: string[] = [];
    for (const m of html.matchAll(/<(\/?)([a-z][\w-]*)([^>]*?)(\/?)>/g)) {
      const [, close, name, , self] = m;
      if (self || VOID.has(name)) continue;
      if (!close) stack.push(name);
      else assert.equal(stack.pop(), name, `</${name}> closes <${stack.at(-1)}>`);
    }
    assert.deepEqual(stack, []);
    assert.doesNotMatch(html, /<p\b[^>]*>(?:(?!<\/p>).)*?<(div|ul|ol|p|header|section|figure)\b/s, "no block inside a paragraph");
  }
});

test("the anatomy's stylesheets: the pin, its frame and the card under the gate; flat by default; hover only in (hover: hover)", () => {
  const first = cssRules(src("apps/web/app/brain-anatomy.css"));
  const lazy = cssRules(src(ENGINE + "anatomy.run.css"));
  const GATE = 'html.sc-pin [data-showcase="anatomy"]:not([data-sc-flat])';
  const frame = first.find((r) => r.selector == GATE + " .ca-frame")!;
  const value = (r: { declarations: Array<{ property: string; value: string }> }, p: string) => r.declarations.find((x) => x.property == p)?.value;
  assert.ok(frame.context.includes("@media (min-height: 700px)"));
  assert.equal(value(frame, "position"), "sticky");
  assert.equal(value(frame, "inset-block-start"), "var(--sc-top)");
  assert.equal(value(frame, "block-size"), "calc(100svh - var(--sc-top))");
  const pre = first.find((r) => r.selector == 'html.sc-motion:not(.sc-late) [data-showcase="anatomy"][data-sc="pre"]')!;
  assert.ok(pre.context.includes("@media (min-height: 700px)"), "the reply card waits only where the figure pins");
  assert.deepEqual([value(pre, "--e"), value(pre, "--card")], ["0", "1"]);
  // Outside the gate nothing is positioned for 3D: the flat plates are the default.
  for (const r of first.filter((x) => !x.selector.startsWith(GATE) && !x.selector.startsWith("html.sc-motion")))
    for (const d of r.declarations) {
      assert.ok(!(d.property == "position" && /sticky|fixed/.test(d.value)), `${r.selector}: ${d.property}: ${d.value}`);
      assert.ok(!/^(perspective|transform-style)$/.test(d.property), `${r.selector}: ${d.property} outside the gate`);
    }
  for (const r of [...first, ...lazy])
    if (r.selectors.some((s) => s.includes(":hover"))) assert.ok(r.context.includes("@media (hover: hover)"), `${r.selector}: hover outside (hover: hover)`);
  // The runtime sheet styles the pinned figure only, on the viewports where it pins: a shorter window lays the
  // figure out flat, where its stamp (off screen in right to left) and the rest must not show.
  for (const r of lazy.filter((x) => !x.context.some((c) => c.startsWith("@keyframes")))) {
    assert.ok(r.context.includes("@media (min-height: 700px)"), `${r.selector}: outside @media (min-height: 700px)`);
    for (const s of r.selectors) assert.ok(s.startsWith('html.sc-pin [data-showcase="anatomy"]'), s);
  }
  // Before the end, the What-ifs are visually hidden, never out of the tab order; focus shows them.
  const wi = lazy.find((r) => r.selector.endsWith(".ca-wi:not(:focus-within)"))!;
  assert.ok(wi.selector.includes('[data-trace="t1"]:not([data-end], [data-sc-flat])'), wi.selector);
  assert.deepEqual(["position", "clip-path"].map((p) => value(wi, p)), ["absolute", "inset(50%)"]);
  const shown = lazy.find((r) => r.selector.endsWith(':not([data-end], [data-sc-flat]) .ca-wi') && value(r, "display") == "flex");
  assert.ok(shown, "displayed, so focusable");
  // Shown by focus, the group sits on the stage's colour and slides with the notes' titles, clear of the last two.
  assert.deepEqual(["background", "transform"].map((p) => value(shown!, p)), ["var(--sc-stage)", "translateY(var(--bh, 0px))"]);
  assert.match(src(ENGINE + "anatomy.js"), /col\.style\.setProperty\("--bh"/, "--bh is set on the side column, which holds both");
});

test("every runtime state the anatomy's lazy sheet styles is one its runtime sets", () => {
  const runtime = src(ENGINE + "anatomy.js") + src(ENGINE + "core.js");
  const html = render().html + render({ heading: true }).html;
  const statics = new Set([...html.matchAll(/\s(?:class="([^"]*)"|([\w-]+)(?:="[^"]*")?)/g)].flatMap((m) => (m[1] ? m[1].split(/\s+/) : [m[2]])));
  const tokens = new Set<string>();
  for (const r of cssRules(src(ENGINE + "anatomy.run.css")))
    for (const s of r.selectors) {
      for (const m of s.matchAll(/\.([\w-]+)/g)) if (!m[1].startsWith("sc-") && !statics.has(m[1])) tokens.add(m[1]);
      for (const m of s.matchAll(/\[([\w-]+)/g)) if (!statics.has(m[1]) && !["data-sc-flat", "data-showcase"].includes(m[1])) tokens.add(m[1]);
    }
  const camel = (a: string) => a.replace(/^data-/, "").replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
  const set = (t: string) => runtime.includes(`"${t}"`) || (t.startsWith("data-") && runtime.includes(`dataset.${camel(t)}`));
  assert.ok(tokens.size >= 12, [...tokens].join(" "));
  for (const t of tokens) assert.ok(set(t), `anatomy.run.css styles ${t}, which nothing sets`);
});

test("the anatomy's runtime: its own CSS and render module, the overlay layer's live region, owned window listeners, --sc-top, no switches", () => {
  const js = src(ENGINE + "anatomy.js");
  const body = js.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.match(body, /^import "\.\/anatomy\.run\.css";$/m);
  assert.match(body, /from "\.\/anatomy\.render\.js";/);
  assert.match(body, /C\.say\(/, "announcements go to the one live region");
  assert.doesNotMatch(body, /aria-live|data-live|document\.body|fetch\(|new URL\(|import\.meta|location\.search|--header-h/);
  assert.match(body, /k\.on\(window, "scroll", /);
  assert.match(body, /k\.on\(window, "hashchange", /);
  assert.doesNotMatch(body.replace(/k\.on\(window, "(scroll|hashchange)", /g, ""), /addEventListener\("(scroll|hashchange)"/, "every window listener is owned and removed");
  assert.match(body, /"--sc-top"/);
  assert.match(body, /L\.release\(\)/, "destroy releases the overlay layer");
  assert.match(body, /root\.setAttribute\("data-sc", "on"\)/);
  // A What-if replay is stopped by the next one, by Omar's reply, by scrolling back into the steps and by destroy.
  assert.match(body, /function whatIf\(w\) \{\s+press\(w\);\s+endReplay\(\);/);
  assert.match(body, /function clearWhatIf\(\) \{\s+if \(!wi\) return;\s+wi = null;\s+endReplay\(\);\s+press\("base"\);/);
  assert.match(body, /const stop = \(\) => \{[^}]*endReplay\(\);/);
  // Scrolling elsewhere wakes nothing.
  assert.match(body, /k\.on\(window, "scroll", \(\) => near && onScroll\(\), \{ passive: true \}\);/);
});

// ---------------------------------------------------------------- 3b: the playground

const playOptions = (patch: Partial<ShowcaseOptions> = {}): ShowcaseOptions => ({
  appName: "trainsyou",
  cta: { label: "Join early access — free", href: "/get-started#early-access" },
  flags: FLAGS,
  ...patch,
});
const playRender = (patch: Partial<ShowcaseOptions> = {}, id = "sc-play") => {
  const o: RenderOptions = { ...playOptions(patch), kind: "play", id };
  return { d: prepare(TRACES, o), html: play.renderStatic(prepare(TRACES, o), o) };
};
/** Visible text: tags dropped, aria-hidden subtrees removed, entities decoded. */
const visible = (html: string) =>
  html
    .replace(/<(\w+)[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/\1>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
/** Every moment's lane under the sample trainer's settings (t3 is off without its flag). */
const LANES = { t1: "sent", t2: "paused", t4: "member", t5: "sent", t6: "waits", t7: "learn", t8: "waits", t9: "waits", t10: "sent", t11: "paused", t12: "paused" } as const;

test("the shared stage sheet: a step not reached dims its frame and glyphs, never its text; pressed and checked survive forced colours", () => {
  const stage = cssRules(src("apps/web/app/brain-stage.css"));
  const rule = (sel: string, media = "") => stage.find((r) => r.selectors.includes(sel) && (media ? r.context.includes(media) : !r.context.length));
  const value = (r: { declarations: Array<{ property: string; value: string }> } | undefined, p: string) => r?.declarations.find((x) => x.property == p)?.value;
  for (const sel of ['[data-showcase] .sc-node[data-state="skip"]', '[data-showcase] .sc-step[data-result="skipped"]']) {
    assert.equal(value(rule(sel), "color"), "var(--sc-muted)", sel);
    assert.equal(value(rule(sel), "opacity"), undefined, `${sel}: text keeps its contrast`);
  }
  assert.equal(value(rule('[data-showcase] .sc-node[data-state="skip"]'), "border-style"), "dashed");
  const FORCED = "@media (forced-colors: active)";
  const fc = stage.find((r) => r.context.includes(FORCED) && /\.bp-chip/.test(r.selector) && /\.ca-wb/.test(r.selector) && /aria-pressed="true"/.test(r.selector));
  assert.ok(fc, "chips and What-ifs");
  assert.deepEqual(["forced-color-adjust", "background", "color"].map((p) => value(fc, p)), ["none", "Highlight", "HighlightText"]);
  // The chosen segment: its own rule in brain-play.css, after the authored one of the same specificity (A11Y-4: the
  // stage sheet's rule lost to it, so a dark contrast theme showed the chosen level unmarked).
  const play = cssRules(src("apps/web/app/brain-play.css")), seg = '[data-showcase="play"] .bp-seg button[aria-checked="true"]';
  const base = play.findIndex((r) => r.selectors.includes(seg) && !r.context.length), forced = play.findIndex((r) => r.selectors.includes(seg) && r.context.includes(FORCED));
  assert.ok(base >= 0 && forced > base, "the forced-colours segment rule follows the authored one");
  assert.deepEqual(["forced-color-adjust", "background", "color", "border-color"].map((p) => value(play[forced], p)), ["none", "Highlight", "HighlightText", "Highlight"]);
});
test("the playground renders the root's inner HTML: every inner id carries the host id, every reference resolves, no live region of its own", () => {
  for (const patch of [{}, { heading: false, labelledBy: "demo-h" }, { attract: true }]) {
    const { html } = playRender(patch, "sc-x");
    assert.doesNotMatch(html, /<section|data-showcase|aria-live|role="status"|data-sc-live/);
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(ids.length >= 5, ids.join(" "));
    for (const id of ids) assert.ok(id.startsWith("sc-x-"), id);
    assert.equal(new Set(ids).size, ids.length, "ids are unique");
    for (const m of html.matchAll(/\s(?:aria-(?:labelledby|describedby|controls)|for)="([^"]+)"/g))
      for (const ref of m[1].split(" ")) assert.ok(ids.includes(ref), `${ref} resolves`);
  }
  // Its own H2 by default; with heading: false the page's H2 labels the root.
  assert.match(playRender().html, /^<div class="bp-head"><h2 id="sc-play-h">Throw a moment at your Brain<\/h2><p>Pick something a member might say\./);
  const labelled = renderShowcase("play", { ...playOptions({ heading: false, labelledBy: "demo-h" }), kind: "play", id: "sc-play" }, "live");
  assert.match(labelled, /^<section class="bp" data-showcase="play" data-sc="pre" data-nosnippet role="group" aria-labelledby="demo-h"><p class="bp-banner">/);
  assert.equal(play.ROOT.play, "bp");
  // The steps' heading sits under the heading that names the playground: the band's H2 (or its own), or, on
  // /demo, the page's H1.
  assert.match(playRender().html, /<h3>What each step said<\/h3>/);
  assert.match(playRender({ heading: false, labelledBy: "play-h" }).html, /<h3>What each step said<\/h3>/);
  assert.match(playRender({ heading: false }).html, /<h2>What each step said<\/h2>/);
  // "How we count" opens without the engine.
  const { d: hd, html: hh } = playRender();
  assert.ok(hh.includes(`<details class="bp-how"><summary>How we count</summary><p class="bp-hownote">${esc(hd.labels.howWeCount as string)}</p></details>`));
  assert.match(renderShowcase("play", { ...playOptions(), kind: "play", id: "sc-play" }, "static"), /^<section class="bp" data-showcase="play" data-sc="off" data-nosnippet>/);
});

test("12 chips in the specialty's order, each a named button; a moment that does not run here dashed and not on yet; everything waits, disabled, for the engine", () => {
  const { d, html } = playRender();
  const chips = [...html.matchAll(/<button disabled type="button" class="bp-chip" data-t="(t\d+)" aria-pressed="(true|false)"( data-off)?>(.*?)<\/button>/g)];
  assert.deepEqual(chips.map((m) => m[1]), play.SPECS[0][2].map((i) => "t" + i), "Strength's order");
  for (const [, id, pressed, off, name] of chips) {
    const t = d.trace(id);
    assert.equal(name, esc(t.chip) + (off ? `<small>${(d.labels.status as Record<string, string>).not_on_yet}</small>` : ""), id);
    assert.equal(pressed, String(id == play.FIRST), `${id}: only the first frame's moment is pressed`);
    assert.equal(!!off, decide(t, defaults(d), d).off, `${id}: dashed only while it cannot play`);
  }
  // Low recovery (its flag), the voice session and the meal photo (their specialists wait for voice and meal photos).
  assert.deepEqual(chips.filter((m) => m[3]).map((m) => m[1]), ["t5", "t3", "t4"]);
  assert.ok(isOff(d.trace("t3"), defaults(d)));
  for (const [, , order] of play.SPECS) assert.deepEqual([...order].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual(play.SPECS.map(([, name]) => name), ["Strength", "Weight loss", "Muscle gain", "Pre- and postnatal"]);
  // Controls wait for the engine (it enables what it wires); the call to action is a plain link.
  const controls = tags(html, /^<(button|select|textarea|input)\b/);
  assert.ok(controls.length > 25, `${controls.length} controls`);
  for (const c of controls) assert.match(c, /^<\w+ disabled[ >]/, c);
  assert.match(html, /<button disabled type="button" class="bp-pause"><span data-label>Pause<\/span><span class="bp-psz" aria-hidden="true">Pause<\/span><\/button>/, "a named Pause button, one width for Pause and Play");
  // A slider speaks its value (aria-valuetext); its readout is hidden from assistive tech, never a second live region (A11Y-7).
  assert.doesNotMatch(html, /<output/);
  assert.doesNotMatch(src(ENGINE + "play.render.js"), /<output/);
});

test("the first frame is the first moment played: its nodes, code picks then each step, its result and settings; every moment's result is decide()'s lane", () => {
  const { d, html } = playRender();
  const S = defaults(d), t1 = d.trace(play.FIRST), r1 = decide(t1, S, d);
  const state = (sp: string) => html.match(new RegExp(`data-sp="${sp}"[^>]*? data-state="(\\w+)"`))![1];
  assert.deepEqual(["safety", "topics", "memory", "rule_finder", "reply_picker", "checker", "lane_gate"].map(state), ["pass", "pass", "pass", "pass", "lit", "pass", "sent"]);
  assert.deepEqual(["draft_writer", "plan_writer", "week_reviewer", "meal_photo", "voice_lines", "set_logger"].map(state), Array(6).fill("idle"), "code picks one specialist");
  assert.match(html, /data-sp="confidence"[^>]*>.*?<span class="sc-val" aria-hidden="true">—<\/span><\/div>/, "chat has no score");
  assert.deepEqual([...html.matchAll(/<div class="bp-bin" data-lane="(\w+)"( data-hot)?>/g)].map((m) => m[1] + (m[2] ? "*" : "")), ["sent*", "waits", "paused"]);
  assert.match(html, /<span class="bp-kind">Chat · a rule fits<\/span>/);
  // The steps: code picks first, then each step as it said it.
  const rows = [...html.matchAll(/<li class="sc-step( bp-picks)?" data-i="(\d+)"/g)].map((m) => (m[1] ? "picks" : m[2]));
  assert.deepEqual(rows, ["0", "1", "2", "3", "picks", "4", "5", "6"]);
  assert.ok(html.includes(`<li class="sc-step bp-picks" data-i="4">${d.labels.picks}</li>`));
  assert.equal(r1.steps.length, 7);
  // The result and the settings this moment reads.
  assert.ok(html.includes(`<div class="bp-res"><div class="bp-res-h">Result · Omar</div><div class="bp-lanewrap"><span class="sc-lane " data-lane="sent">${(d.labels.lanes as Record<string, string>).sent}</span></div>`));
  assert.equal(tags(html, /role="radio" data-k="level"/).length, 3);
  assert.match(html, /<input disabled type="range" data-k="capPct" min="1" max="10" step="1" value="5" aria-valuetext="5%">/);
  assert.match(html, /<input disabled type="range" data-k="minRir" min="1" max="10" step="1" value="2" aria-valuetext="2">/);
  // Every moment lands in its lane, except one that does not run here: the dashed card, built and tested, no run
  // (L9: Low recovery while its flag is off; the voice session and the meal photo while their specialists wait).
  for (const [id, lane] of Object.entries(LANES)) {
    const t = d.trace(id), r = decide(t, S, d);
    assert.equal(r.lane, lane, id);
    const html = play.resultHTML(d, t, r);
    if (r.off) assert.match(html, /^<div class="bp-offcard"><b>[^<]+<\/b><span class="sc-lane is-dashed" data-lane="\w+">.*<p>Built and tested\. Not on yet\.<\/p><p class="bp-note">Not on yet: [^<]+\.<\/p><\/div>$/, id);
    else assert.ok(html.includes(`<span class="sc-lane " data-lane="${lane}">${esc((d.labels.lanes as Record<string, string>)[lane])}</span>`), id);
  }
  assert.deepEqual(Object.keys(LANES).filter((id) => decide(d.trace(id), S, d).off), ["t4", "t5"]);
  assert.match(play.resultHTML(d, d.trace("t5"), decide(d.trace("t5"), S, d)), /Not on yet: Voice lines, Set logger\./);
  const t3 = d.trace("t3"), r3 = decide(t3, S, d);
  assert.ok(r3.off);
  assert.match(play.resultHTML(d, t3, r3), /^<div class="bp-offcard"><b>Low recovery<\/b><span class="sc-lane is-dashed" data-lane="sent">.*<p>Built and tested\. Not on yet\.<\/p><ul>/);
  // "Throw them all" ends on the totals line: the moments that run, and how many are not on yet.
  assert.equal(totals(d, S), (d.labels.totals as Record<string, string>).recoveryOff);
  assert.equal(totals(d, S, true), "In this sample: 2 within your rules · 0 member checks · 3 waited · 3 paused · 1 new rule · 3 not on yet");
  // A setting changed: the diff line names the lane before and after.
  const capped = decide(d.trace("t1"), { ...S, capPct: 3 }, d);
  assert.match(play.resultHTML(d, d.trace("t1"), capped, "sent"), /<p class="bp-why">Before: Sent on its own, within your rules\. Now: Waits for you\. Why: 2\.5 kg is 4\.2%, over your 3% cap\./);
});

test("the AI model off: every moment one of its specialists plays is the dashed card, the frame plays the knee stop, Throw them all counts what runs", () => {
  const { d, html } = playRender({ flags: { ...FLAGS, model: false } });
  const S = defaults(d);
  assert.equal(play.firstOf(d, S), "t2", "the first chip that runs: Noura's knee, a stop with no AI called");
  assert.match(html, /class="bp-chip" data-t="t2" aria-pressed="true">/);
  assert.match(html, /class="bp-chip" data-t="t1" aria-pressed="false" data-off>Squats felt easy<small>Not on yet<\/small>/);
  assert.match(html, /<div class="bp-res-h">Result · Noura<\/div><div class="bp-lanewrap"><span class="sc-lane " data-lane="paused">/);
  assert.doesNotMatch(html, /data-lane="sent" data-hot|<span class="bp-kind">Chat · a rule fits/);
  const off = Object.keys(LANES).filter((id) => decide(d.trace(id), S, d).off);
  assert.deepEqual(off, ["t1", "t4", "t5", "t6", "t7", "t8", "t10"]);
  assert.match(play.resultHTML(d, d.trace("t1"), decide(d.trace("t1"), S, d)), /<p class="bp-note">Not on yet: Reply picker\.<\/p>/);
  assert.equal(totals(d, S, true), "In this sample: 0 within your rules · 0 member checks · 1 waited · 3 paused · 0 new rules · 8 not on yet");
  // Under the settings, too: supplements drafted for you need the Draft writer, which waits for the model.
  assert.ok(!decide(d.trace("t9"), S, d).off && decide(d.trace("t9"), { ...S, supplementsTopic: false }, d).off);
  // The runtime plays nothing for them, and attract plays the first moment that runs.
  const js = src(ENGINE + "play.js");
  assert.match(js, /if \(r\.off\) \{[^\n]*\n\s+resetStage\(t, 0, r\); dot = null;[\s\S]*?waiting\(d, r\)\.forEach\(\(sp\) => setNode\(sp, "focus"\)\);/);
  assert.match(js, /attract = true; run\(first\);/);
  assert.match(js, /totals\(d, S, true\)/);
});

test("free text finds the closest sample through the local keyword table only: specific words first, nothing when no sample is close", () => {
  const cases: Array<[string, string | null]> = [
    ["I took creatine before my session", "t9"], ["any vitamin advice?", "t9"], ["chest pain since this morning", "t12"], ["صدري يعورني", "t12"],
    ["I'm pregnant", "t11"], ["حامل", "t11"], ["my knee hurts", "t2"], ["can I skip my deload?", "t6"], ["rest week?", "t6"],
    ["that felt easy, go up?", "t1"], ["photo of my lunch", "t4"], ["slept badly, whoop says 30", "t3"], ["new programme please", "t10"],
    ["how was my week", "t8"], ["can we talk now", "t5"],
    // Never a sample that is sent for text the app would hold, or for text no row knows.
    ["I think I tore my hamstring", "t2"], ["I can't breathe properly after sprints", "t12"], ["I'm bleeding from a cut on my hand", "t12"],
    ["I've been throwing up after meals to lose weight", "t12"], ["hello", null], ["How much protein should I eat?", null],
    // Everyday gym words stay with their own samples, or with none.
    ["What's the best way to breathe during squats?", null], ["Can I add weight to my chest press?", "t1"], ["Spotting my friend on bench", null], ["أحب حمل الأثقال", null],
  ];
  for (const [text, id] of cases) assert.equal(closest(text), id, text);
  // Every sample's own message finds its sample (You edit a reply and Week is over are not member messages).
  for (const t of TRACES.traces.filter((x) => !/^t(7|8)-/.test(x.id))) assert.equal(closest(t.trigger.text), t.id.split("-")[0], t.id);
  // At least as cautious as the app: every message the app's own safety tests hold maps to a sample the safety rules stop.
  const SAFE = ["t2", "t11", "t12"], held: string[] = [];
  for (const f of ["safety-floor", "messaging-safety-policy", "fix2-safety", "voice-talkback-retest", "fix-nutrition-safety"])
    for (const m of src(`tests/${f}.test.ts`).matchAll(/"((?:[^"\\\n]|\\.){10,400})"/g)) {
      let text = "";
      try {
        text = JSON.parse(`"${m[1]}"`);
      } catch {
        continue;
      }
      if (/\s/.test(text) && redFlagCategories(text).length) held.push(text);
    }
  assert.ok(held.length >= 200, `${held.length} held messages`);
  assert.deepEqual(held.filter((text) => !SAFE.includes(closest(text)!)), [], "held by the app, not by the table");
  assert.equal(play.COPY.closest, "Closest sample: {chip}. This page can't read new messages.");
  assert.equal(play.COPY.none, "No sample is close to that. This page can't read new messages: pick a sample moment.");
  // No network and no safety rules in the browser for free text: the table (its own chunk, loaded once the visitor
  // types), then a run of the sample, or nothing.
  const js = src(ENGINE + "play.js").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(js, /const keys = \(\) => import\("\.\/play\.keys\.js"\);/);
  assert.match(js, /keys\(\)\.then\(\(\{ closest \}\) => \{[\s\S]*?const id = closest\(v\), line = id \? COPY\.closest\.replace\("\{chip\}", d\.trace\(id\)\.chip\) : COPY\.none;/);
  assert.match(js, /if \(id\) run\(id, 0, line \+ " "\);\s+else C\.say\(line\);/);
  assert.doesNotMatch(src(ENGINE + "play.render.js"), /closest = |KEYS/, "the first frame's module carries no table");
  for (const f of ["play.js", "play.render.js", "play.keys.js"]) assert.doesNotMatch(src(ENGINE + f).replace(/\/\*[\s\S]*?\*\//g, ""), /red-flags|redFlag|fetch\(|XMLHttpRequest|sendBeacon/, f);
  assert.doesNotMatch(src(ENGINE + "play.keys.js"), /^import /m, "the table imports nothing");
});

test("honesty: the sample chip, banner, rates and speed lines, the status strip by payments, the platform's safety rule named and escaped; no placeholder, model name, C0 word, internals or images", () => {
  const { d, html } = playRender();
  assert.ok(html.includes(`<p class="bp-banner">${esc(d.labels.long)}</p>`), "the banner is labels.long");
  assert.ok(html.includes(`<span class="sc-sample">${esc(d.labels.chip)}</span>`));
  for (const s of [d.labels.rates, d.labels.speed as string, d.labels.howWeCount as string]) assert.ok(html.includes(esc(s)), s);
  assert.ok(html.includes(esc(d.labels.subscribers!)), "while subscriber payments are off, the strip says so");
  const paid = playRender({ flags: { ...FLAGS, payments: true } }).html;
  assert.doesNotMatch(paid, /sc-subs|subscriber payments are not on/);
  // The Not-on-yet shelf: Meal planner and Recovery rule, recovery fixed off.
  const shelf = html.slice(html.indexOf('<div class="bp-shelf">'), html.indexOf('<aside class="bp-book">'));
  assert.deepEqual([...shelf.matchAll(/data-sp="(\w+)"[^>]*data-off/g)].map((m) => m[1]), ["meal_planner", "recovery"]);
  assert.match(html, /Your method · <b>24<\/b> rules \(sample\)/);
  // The safety node is the platform's rule, with its name escaped.
  assert.match(html, /data-sp="safety" title="Safety rules: Reads every message first\. Pain or red flags pause training\. Platform safety rules: trainsyou\. Can&#39;t switch off\."/);
  const evil = playRender({ appName: "<b>x</b>" }).html;
  assert.match(evil, /&lt;b&gt;x&lt;\/b&gt;\. Can&#39;t switch off\./);
  assert.doesNotMatch(evil, /<b>x<\/b>/);
  for (const page of [html, paid, playRender({ attract: true }).html]) {
    assert.doesNotMatch(page, PLACEHOLDER);
    assert.doesNotMatch(visible(page), MODEL_OR_VENDOR);
    for (const { term } of C0_BANNED) assert.doesNotMatch(visible(page), term, String(term));
    assert.doesNotMatch(page, /apps\/|packages\/|basisCommit|verbatim|\{APP_NAME\}|signup\.html|undefined-/, "no internal fields or prototype leftovers");
    assert.doesNotMatch(page, /<img|<video|<canvas|poster=|url\(/, "no image: the engine adds the canvas");
  }
});

test("the call to action comes from the options: never /signup while sign-ups are closed", () => {
  assert.ok(playRender().html.includes(`<a class="bp-btn bp-btn-p bp-cta" href="/get-started#early-access" data-sc-cta>Join early access — free</a>`));
  assert.doesNotMatch(playRender().html, /href="\/signup"/);
  assert.ok(playRender({ cta: { label: "Teach your AI — free", href: "/signup" } }).html.includes(`<a class="bp-btn bp-btn-p bp-cta" href="/signup" data-sc-cta>Teach your AI — free</a>`));
  for (const f of ["play.render.js", "play.js"]) assert.doesNotMatch(src(ENGINE + f), /signup\.html|"\/signup"|Teach your AI|Start coaching/, `${f}: the call to action only from the options`);
});

test("with attract, what the run plays waits for the engine and the nodes look idle until then; without it the frame is final", () => {
  const still = playRender().html, waits = playRender({ attract: true }).html;
  assert.doesNotMatch(still, /sc-res|data-attract/);
  assert.match(waits, /<div class="bp-diagram" data-attract>/);
  for (const el of ['<span class="bp-kind sc-res">', '<ol class="sc-res">', '<div class="bp-res sc-res">', '<div class="bp-change sc-res">']) assert.ok(waits.includes(el), el);
  assert.equal(waits.replace(/ sc-res|<ol class="sc-res">| data-attract/g, (m) => (m == '<ol class="sc-res">' ? "<ol>" : "")), still, "otherwise the same frame");
  const pre = cssRules(src("apps/web/app/brain-play.css")).filter((r) => r.selector.includes('[data-sc="pre"]'));
  assert.deepEqual(pre.map((r) => r.selector), [
    'html.sc-motion:not(.sc-late) [data-showcase="play"][data-sc="pre"] [data-attract] .sc-node:not([data-off])',
    'html.sc-motion:not(.sc-late) [data-showcase="play"][data-sc="pre"] [data-attract] .bp-bin',
  ]);
});

test("the playground's frame is well-formed HTML: every element it opens, it closes; no block inside a paragraph or a button", () => {
  for (const patch of [{}, { heading: false }, { attract: true }, { flags: { ...FLAGS, payments: true } }]) {
    const { html } = playRender(patch);
    const VOID = new Set(["br", "img", "input", "hr", "meta", "link", "path", "rect", "circle", "polyline"]);
    const stack: string[] = [];
    for (const m of html.matchAll(/<(\/?)([a-z][\w-]*)([^>]*?)(\/?)>/g)) {
      const [, close, name, , self] = m;
      if (self || VOID.has(name)) continue;
      if (!close) {
        if (/^(div|p|ul|ol|li|section|form|h2|h3|aside|label)$/.test(name)) assert.ok(!stack.includes("p") && !stack.includes("button"), `<${name}> inside <p> or <button>`);
        stack.push(name);
      } else assert.equal(stack.pop(), name, `</${name}> closes <${stack.at(-1)}>`);
    }
    assert.deepEqual(stack, []);
  }
  // Equal options, equal markup; the imported traces stay as they were.
  assert.equal(playRender().html, playRender().html);
  assert.equal(JSON.stringify(TRACES), src("apps/web/components/marketing/brain/data/traces.client.json").trim());
});

test("the playground's sheets hold every size the engine writes into: the steps' height, one Pause width, the rulebook count, the totals line; phone toggles over regions the desktop shows", () => {
  const first = cssRules(src("apps/web/app/brain-play.css")), lazy = cssRules(src(ENGINE + "play.run.css"));
  const decl = (rules: typeof first, selector: string, prop: string, media?: string) =>
    rules.find((r) => r.selectors.includes(selector) && (!media || r.context.includes(media)) && r.declarations.some((x) => x.property == prop))?.declarations.find((x) => x.property == prop)?.value;
  const P = '[data-showcase="play"]', PHONE = "@media (max-width: 760px)";
  assert.equal(decl(first, `${P} .bp-logs`, "block-size"), "240px");
  assert.equal(decl(first, `${P} .bp-logs`, "contain"), "strict");
  assert.equal(decl(first, `${P} .bp-pause > span`, "grid-area"), "1 / 1");
  assert.equal(decl(first, `${P} .bp-psz`, "visibility"), "hidden");
  assert.equal(decl(first, `${P} .bp-book b`, "font-variant-numeric"), "tabular-nums");
  assert.equal(decl(lazy, `${P} .bp-totals`, "min-block-size"), "2.8em");
  assert.equal(decl(lazy, `${P} .is-due`, "visibility"), "hidden", "a result written with the click keeps its space until the run ends");
  assert.equal(decl(lazy, `${P} .bp-sf`, "visibility"), "hidden", "a streamed step holds its final words");
  assert.equal(decl(lazy, `${P} .bp-sl`, "position"), "absolute");
  // Phones: "Step by step" and "Change a setting" are toggles; the desktop shows both regions.
  assert.equal(decl(first, `${P} .bp-tg`, "display"), "none");
  assert.equal(decl(first, `${P} .bp-tg`, "display", PHONE), "flex");
  for (const s of [`${P} .bp-log`, `${P} .bp-set`, `${P} .bp-chg-h`]) assert.equal(decl(first, s, "display", PHONE), "none", s);
  for (const s of [`${P} [data-open] > .bp-log`, `${P} [data-open] > .bp-set`]) assert.equal(decl(lazy, s, "display", PHONE), "block", s);
  // Phones: the chip row's padding holds a focus ring, and a chip with keyboard focus is not snapped back out of view.
  assert.equal(decl(first, `${P} .bp-chips`, "scroll-padding-inline", PHONE), "var(--mk-gutter, 16px)");
  assert.equal(decl(lazy, `${P}[data-sc="on"] .bp-chips:has(:focus-visible)`, "scroll-snap-type", PHONE), "none");
  // Nothing sticks or pins: the playground scrolls with the page.
  for (const r of [...first, ...lazy]) for (const x of r.declarations) assert.ok(!(x.property == "position" && /sticky|fixed/.test(x.value)), r.selector);
  for (const r of [...first, ...lazy])
    if (r.selectors.some((s) => s.includes(":hover"))) assert.ok(r.context.includes("@media (hover: hover)"), `${r.selector}: hover outside (hover: hover)`);
});

test("every runtime state the playground's lazy sheet styles is one its runtime sets", () => {
  // The runtime writes the render module's atoms too (a moment's settings, the dashed card).
  const runtime = src(ENGINE + "play.js") + src(ENGINE + "play.render.js") + src(ENGINE + "core.js");
  const html = playRender().html + playRender({ attract: true }).html;
  const statics = new Set([...html.matchAll(/\s(?:class="([^"]*)"|([\w-]+)(?:="[^"]*")?)/g)].flatMap((m) => (m[1] ? m[1].split(/\s+/) : [m[2]])));
  const tokens = new Set<string>();
  for (const r of cssRules(src(ENGINE + "play.run.css")))
    for (const s of r.selectors) {
      for (const m of s.matchAll(/\.([\w-]+)/g)) if (!m[1].startsWith("sc-") && !statics.has(m[1])) tokens.add(m[1]);
      for (const m of s.matchAll(/\[([\w-]+)/g)) if (!statics.has(m[1]) && m[1] != "data-showcase") tokens.add(m[1]);
    }
  const camel = (a: string) => a.replace(/^data-/, "").replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
  const set = (t: string) => new RegExp(`(?<![\\w-])${t}(?![\\w-])`).test(runtime) || (t.startsWith("data-") && runtime.includes(`dataset.${camel(t)}`));
  assert.ok(tokens.size >= 20, [...tokens].join(" "));
  for (const t of tokens) assert.ok(set(t), `play.run.css styles ${t}, which nothing sets`);
});

test("the playground's runtime: its own CSS and render module, the overlay layer's live region, owned listeners, data-sc on; a result written with the click and shown when the run ends", () => {
  const js = src(ENGINE + "play.js");
  const body = js.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.match(body, /^import "\.\/play\.run\.css";$/m);
  assert.match(body, /from "\.\/play\.render\.js";/);
  assert.match(body, /L = C\.layer\(root\)/);
  assert.match(body, /L\.release\(\)/, "destroy releases the overlay layer");
  assert.match(body, /C\.say\(/, "announcements go to the one live region");
  assert.doesNotMatch(body, /aria-live|role="status"|data-live|document\.body|fetch\(|new URL\(|import\.meta|location\.search|_brainPlay|innerHTML = shell|removeAttribute\("data-sc"\)/);
  assert.equal(body.match(/\baddEventListener\(/g)!.length, 1, "every listener is owned (owned().on), so destroy removes it");
  assert.match(body, /root\.setAttribute\("data-sc", "on"\);\s+root\.setAttribute\("data-sc-tier", C\.tier\.name\);/);
  assert.match(body, /sc\.button\(\$\("\.bp-pause"\), \{ pause: COPY\.pause, play: COPY\.play \}\);/);
  assert.match(body, /showResult\(resultHTML\(d, t, r, before && before != r\.lane \? before : null\), true\);/, "written with the click");
  assert.match(body, /function finish\(t, r\) \{[\s\S]*?reveal\(\);/, "shown when the run ends");
  assert.match(body, /const wait = !!o\.attract && !RM && !o\.settled/, "attract: only with the option, never under reduced motion or from a settled frame");
  assert.match(body, /own = !attract;/, "a run is the visitor's unless attract started it");
  assert.match(body, /if \(own\) C\.say\(`Result: \$\{d\.labels\.lanes\[r\.lane\]\}`\);/, "the self-started run says nothing, even after the visitor presses a key");
  assert.match(body, /k\.on\(chips, "focusin", \(e\) => e\.target\.matches\("\.bp-chip:focus-visible"\) && e\.target\.scrollIntoView\(\{ block: "nearest", inline: "nearest" \}\)\);/, "a chip reached from the keyboard comes fully into view");
  // The Confidence node's state goes through setNode, so its dots follow it; the % compared is the one shown.
  assert.match(body, /setNode\(sp, \(r\.sure\.pct != null \? r\.sure\.pct : Math\.round\(r\.sure\.score \* 100\)\) >= r\.sure\.bar \? "pass" : "warn"\)/);
  assert.doesNotMatch(body, /dataset\.state = "warn"/);
  assert.match(body, /run\(id\) \{/, "run(traceId) for the island");
});
