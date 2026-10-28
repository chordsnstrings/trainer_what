// The decision anatomy and the playground, the two showcases of
// /trainer-brain (docs/marketing-revamp-2026-10-26/phase1/PLAN.md WP3): their
// first frames, the claims their copy shares with the product, their
// stylesheets and their runtimes' contracts. The browser checks
// (scripts/marketing-showcase-check.mjs) drive the runtimes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RED_FLAG_CATEGORIES } from "../packages/domain/src/red-flags.ts";
import { renderShowcase } from "../apps/web/components/marketing/brain/render.ts";
import { esc } from "../apps/web/components/marketing/brain/engine/core.js";
import { prepare } from "../apps/web/components/marketing/brain/engine/data.js";
import { defaults, pick } from "../apps/web/components/marketing/brain/engine/decide.js";
import { COPY, NOTES, ROOT, model, renderStatic } from "../apps/web/components/marketing/brain/engine/anatomy.render.js";
import type { BrainData, RawBrainData, RenderOptions, ShowcaseOptions } from "../apps/web/components/marketing/brain/engine/types";
import { PLACEHOLDER, cssRules } from "./marketing-helpers.ts";

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
  // Every inner id is prefixed even with a heading of its own.
  const withHead = render({ heading: true, labelledBy: undefined }, "sc-y").html;
  for (const m of withHead.matchAll(/\sid="([^"]+)"/g)) assert.ok(m[1].startsWith("sc-y-"), m[1]);
});

test("heading: false leaves the H2 to the page, which labels the root; with heading the figure carries its own", () => {
  const live = renderShowcase("anatomy", { ...options(), kind: "anatomy", id: "sc-anatomy" }, "live");
  const open = live.slice(0, live.indexOf(">") + 1);
  assert.equal(open, `<section class="${ROOT.anatomy}" data-showcase="anatomy" data-sc="pre" data-nosnippet aria-labelledby="decides-h">`);
  assert.equal(ROOT.anatomy, "ca sc-stage", "the ink stage");
  assert.doesNotMatch(live, /<h[1-6]/, "no heading of its own");
  const own = render({ heading: true, labelledBy: undefined }).html;
  assert.match(own, /<h2 class="ca-h2" id="sc-anatomy-h">Anatomy of one decision<\/h2>/);
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

test("(f): what code can pick from, each with its moment, and the coaching specialists not on yet on the shelf", () => {
  const { d, html } = render();
  const shell = html.slice(html.indexOf('<div class="ca-x">'));
  const pills = [...shell.matchAll(/<span class="ca-sp" data-sp="(\w+)" data-kind="(\w+)"/g)].slice(0, 7).map((m) => m[1] + ":" + m[2]);
  assert.deepEqual(pills, ["reply_picker:ai", "draft_writer:ai", "plan_writer:ai", "week_reviewer:ai", "meal_photo:ai", "voice_lines:ai", "set_logger:check"]);
  const coach = d.specialists.filter((s) => s.crew == "coach" && s.kind == "ai");
  const notOnYet = coach.filter((s) => s.status == "not_on_yet");
  assert.deepEqual(notOnYet.map((s) => s.id), ["meal_planner"]);
  assert.deepEqual(coach.filter((s) => s.status != "not_on_yet").map((s) => s.id).sort(), pills.filter((p) => p.endsWith(":ai")).map((p) => p.split(":")[0]).sort(), "every coaching specialist that is on is a pill");
  assert.equal((html.match(/<span class="ca-shelf">/g) || []).length, 2, "the shelf, in the compact row and the labelled grid");
  assert.match(html, /Meal planner · Not on yet<\/span>/);
  assert.match(html, /<em class="ca-tag">Chat · a rule fits<\/em>/);
  assert.ok(html.includes(String(d.labels.picks)), "Code picks the specialist. No AI chooses which AI runs.");
});

test("its buttons wait for the engine: notes, What-ifs and Pause disabled in the first frame; Omar's reply pressed", () => {
  const { html } = render();
  const buttons = tags(html, /^<button/);
  assert.equal(buttons.length, 10 + 4 + 1);
  assert.ok(buttons.every((b) => / disabled/.test(b) && /type="button"/.test(b)));
  const whatIf = buttons.filter((b) => /ca-wb/.test(b)).map((b) => b.match(/data-w="(\w+)" aria-pressed="(\w+)"/)!.slice(1).join("="));
  assert.deepEqual(whatIf, ["knee=false", "plan=false", "level1=false", "base=true"]);
  assert.match(html, /<div class="ca-wi" role="group" aria-label="Try another moment">/);
  assert.match(html, /<button type="button" class="ca-pause" aria-pressed="false" disabled>/);
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
  assert.match(NOTES.f[1], /^Seven coaching specialists\. One is not on yet\./);
  assert.equal(coach.length, 7);
  assert.equal(coach.filter((s) => s.status == "not_on_yet").length, 1);
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
  // The runtime sheet styles the pinned figure only.
  for (const r of lazy.filter((x) => !x.context.some((c) => c.startsWith("@keyframes"))))
    for (const s of r.selectors) assert.ok(s.startsWith('html.sc-pin [data-showcase="anatomy"]'), s);
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
});
