// The field and the board (docs/marketing-revamp-2026-10-26/phase1/PLAN.md
// WP2): the home hero's sample hour and band 2's board as the server renders
// their first frame (brain/engine/field.render.js), and the runtime's
// contract with that frame and the page (engine/field.js, engine/receipt.js
// and their sheets). The first frame tells the truth on its own: Noura's stop,
// the sample labels, the status strip while subscriber payments are off, the
// page's call to action, and sizes reserved so the engine moves nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderShowcase } from "../apps/web/components/marketing/brain/render.ts";
import { prepare } from "../apps/web/components/marketing/brain/engine/data.js";
import { decide, defaults, isOff, totals } from "../apps/web/components/marketing/brain/engine/decide.js";
import { diffLine, renderStatic } from "../apps/web/components/marketing/brain/engine/field.render.js";
import type { ShowcaseKind, ShowcaseOptions } from "../apps/web/components/marketing/brain/engine/types";
import { C0_BANNED, MODEL_OR_VENDOR, PLACEHOLDER, cssRules } from "./marketing-helpers.ts";

const repo = (path: string) => new URL("../" + path, import.meta.url);
const src = (path: string) => readFileSync(repo(path), "utf8");
const ENGINE = "apps/web/components/marketing/brain/engine/";
const RAW = JSON.parse(src("apps/web/components/marketing/brain/data/traces.client.json"));

const FLAGS = { payments: false, payouts: false, voice: false, nutrition: false, recovery: false };
const CLOSED = { label: "Join early access — free", href: "/get-started#early-access" };
const OPEN = { label: "Teach your AI — free", href: "/signup" };
const options = (patch: Partial<ShowcaseOptions> = {}): ShowcaseOptions => ({ appName: "trainsyou", cta: CLOSED, flags: FLAGS, ...patch });
const render = (kind: ShowcaseKind, patch: Partial<ShowcaseOptions> = {}, id = kind == "field" ? "sc-field" : "sc-board") =>
  renderShowcase(kind, { ...options(patch), kind, id, label: "A sample" }, "live");
const data = (patch: Partial<ShowcaseOptions> = {}) => prepare(RAW, options(patch));
const id0 = (t: { id: string }) => t.id.split("-")[0];
/** The storyboard's first frame (SHOWCASE_DESIGN.md §2): Sent (Fatima, Sara), Your Today (Khalid), Paused (Mariam). */
const START = { sent: ["t10", "t5"], waits: ["t9"], paused: ["t11"] };
/** The member rows, top to bottom: every moment that plays. */
const ROWS = ["t2", "t1", "t8", "t4", "t10", "t7", "t9", "t5", "t6", "t11", "t12"];
/** The screen-reader summary (SHOWCASE_DESIGN.md §6 A). */
const SUMMARY =
  "A sample animation. Messages from sample subscribers pass through code checks, then one AI specialist that code picks, then more code checks. Each ends sent on its own, waiting for you, or paused. Below it, every moment is listed as a button.";
/** Visible text: tags dropped, aria-hidden subtrees and templates removed, entities decoded. */
const text = (html: string) =>
  html
    .replace(/<template[\s\S]*?<\/template>/g, "")
    .replace(/<(\w+)[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/\1>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
/** The element that opens at `at` (an index of its "<"), through its matching close. */
function element(html: string, at: number) {
  const name = /^<(\w+)/.exec(html.slice(at))![1];
  const tags = new RegExp(`<(/?)${name}\\b[^>]*>`, "g");
  tags.lastIndex = at;
  let depth = 0;
  for (let m; (m = tags.exec(html)); ) if ((depth += m[1] ? -1 : 1) == 0) return html.slice(at, m.index + m[0].length);
  throw new Error("unclosed <" + name + ">");
}
const buttons = (html: string, cls: string) =>
  [...html.matchAll(new RegExp(`<button type="button" class="${cls}\\b[^"]*"[^>]*data-t="(t\\d+)"`, "g"))].map((m) => ({ id: m[1], html: element(html, m.index!) }));

test("the field's first frame: Noura's message and stop, the lanes at the storyboard's start, the Paused bin", () => {
  const html = render("field"), d = data(), t2 = d.trace("t2");
  assert.match(html, /^<section class="mc sc-stage" data-showcase="field" data-sc="pre" data-nosnippet aria-label="A sample">/);
  // Noura's words, her matched words marked (the stop paints them red), the stamp and the Safety node's STOP.
  const msg = element(html, html.indexOf('<div class="mc-msg is-hit mc-hitres" data-t="t2">'));
  for (const w of t2.steps[0].highlight as string[]) assert.ok(msg.includes(`<mark class="mc-hl">${esc(w)}</mark>`), w);
  const words = /<span class="mc-mt"><b>Noura<\/b>(.*?)<\/span><\/div>$/.exec(msg)![1].replace(/<[^>]+>/g, "").replace(/&#39;/g, "'");
  assert.equal(words, t2.trigger.text);
  assert.ok(html.includes(`<p class="mc-stamp sc-res">STOP · No AI called</p>`));
  const safety = element(html, html.indexOf('<div class="sc-node mc-n mc-hitres" data-sp="safety"'));
  assert.match(safety, /data-state="hit" data-who="N"/);
  assert.ok(safety.includes('<span class="mc-v sc-res">STOP</span>'));
  assert.ok(html.includes(`<span class="mc-s1 is-on"><b>Noura:</b> “a <em class="mc-red">pop</em> in my <em class="mc-red">knee</em>” <i>→</i> Safety rules stopped it.`), "the subtitle tells her moment");
  // Lanes: the storyboard's start, plus Noura's tile and counts as results the engine plays.
  const lane = (l: string) => element(html, html.indexOf(`<div class="mc-lane" data-lane="${l}"`));
  for (const l of ["sent", "waits", "paused"] as const) {
    const sec = lane(l), tiles = [...sec.matchAll(/<li class="mc-li( sc-res)?" data-t="(t\d+)">/g)].map((m) => m[2] + (m[1] ? "*" : ""));
    assert.deepEqual(tiles, l == "paused" ? ["t2*", ...START.paused] : START[l], l);
    // No landmark (A11Y-20): the tiles' list and the phone bin are named by the lane's heading (the bin also by its member).
    assert.match(sec, new RegExp(`^<div class="mc-lane" data-lane="${l}"><p class="mc-lh" id="sc-field-l-${l}">`));
    assert.match(sec, new RegExp(`<ul class="mc-tl" aria-labelledby="sc-field-l-${l}">`), `${l}: its list`);
    assert.match(sec, new RegExp(`<button type="button" class="mc-bin" data-bin="${l}" id="sc-field-b-${l}" aria-labelledby="sc-field-l-${l} sc-field-b-${l}" disabled>`), `${l}: its phone bin`);
    const n = START[l].length;
    assert.ok(sec.includes(l == "paused" ? `<span class="mc-c" aria-hidden="true"><span class="mc-pre">${n}</span><span class="mc-fin">${n + 1}</span></span>` : `<span class="mc-c" aria-hidden="true">${n}</span>`), `${l}: count`);
    assert.ok(sec.includes(`: ${l == "paused" ? n + 1 : n} in this sample hour`), `${l}: the count as text`);
  }
  assert.match(lane("paused"), /<span class="mc-last"><span class="mc-pre">Mariam<\/span><span class="mc-fin">Noura<\/span><\/span>/);
  assert.ok(html.includes(`<p class="mc-chk2">To check · already sent: <b>1</b></p>`));
});

test("every moment is a named button; the board sorts every moment by decide(); the drawing is hidden from assistive tech", () => {
  const field = render("field"), board = render("board"), d = data(), S = defaults(d);
  const playable = d.traces.filter((t) => !isOff(t, S)).map(id0);
  assert.deepEqual([...ROWS].sort(), [...playable].sort(), "one member row per moment that plays");
  const rows = buttons(field, "mc-m");
  assert.deepEqual(rows.map((r) => r.id), ROWS);
  for (const r of rows) {
    const t = d.trace(r.id), name = text(r.html).trim();
    assert.ok(name.startsWith(t.member + " ") && name.endsWith(`— ${t.chip}. See each step.`), `${r.id}: "${name}"`);
    // A short list of buttons: every member is its own tab stop (no roving tabindex without a composite role).
    assert.doesNotMatch(r.html.slice(0, r.html.indexOf(">")), /tabindex/, `${r.id}: a tab stop`);
  }
  for (const r of buttons(field, "mc-tile")) assert.ok(text(r.html).startsWith(" " + d.trace(r.id).member + " · "), r.id);
  // The board: one card per moment, in the column decide() gives it, counted; the totals line.
  const cards = buttons(board, "mb-b");
  assert.deepEqual(cards.map((c) => c.id).sort(), [...playable].sort());
  // Their receipts need the engine: until it arms them (and without it) the cards are disabled, like every other control.
  for (const c of cards) assert.match(c.html, /^<button type="button" class="mb-b" data-t="t\d+" disabled>/, c.id);
  for (const lane of ["sent", "waits", "paused", "member", "learn"]) {
    const col = element(board, board.indexOf(`<div class="mb-col" data-lane="${lane}"`));
    const ids = [...col.matchAll(/<li class="mb-c" data-t="(t\d+)">/g)].map((m) => m[1]);
    assert.deepEqual(ids, d.traces.filter((t) => !isOff(t, S) && decide(t, S, d).lane == lane).map(id0), lane);
    assert.ok(col.includes(`<span class="mb-n">${ids.length}</span>`), `${lane} count`);
    assert.match(col, new RegExp(`^<div class="mb-col" data-lane="${lane}"><p class="mb-ch" id="sc-board-h-${lane}">.*?<ul class="mb-list" aria-labelledby="sc-board-h-${lane}">`));
  }
  for (const c of cards) assert.match(text(c.html), new RegExp(`^ ${d.trace(c.id).member} ${d.trace(c.id).chip.replace(/[?().]/g, "\\$&")} `), c.id);
  assert.ok(board.includes(`<p class="mb-tot">${esc(totals(d, S))}</p>`));
  // The frame, the rails and the canvas are a picture: the buttons carry the moments.
  for (const m of ['<div class="mc-frame" aria-hidden="true">', '<svg class="mc-cv mc-rails" aria-hidden="true" focusable="false">', '<canvas class="mc-cv mc-cv2" aria-hidden="true">', '<p class="mc-sub" aria-hidden="true">'])
    assert.ok(field.includes(m), m);
  assert.ok(field.includes(`<p class="sc-sr">${SUMMARY}</p>`), "the screen-reader summary");
  // Controls are real controls: the level radios, the slider with its value text, the switch, the lock.
  for (const html of [field, board]) {
    assert.equal((html.match(/<button type="button" role="radio" aria-checked="(true|false)"/g) || []).length, 3);
    assert.match(html, /<input type="range" min="50" max="99" step="1" value="80" aria-valuetext="80%"/);
    // The slider speaks its value; the readout beside it is no second (polite, live) region.
    assert.match(html, /aria-valuetext="80%"[^>]*disabled><span aria-hidden="true">80%<\/span>/);
    assert.doesNotMatch(html, /<output|aria-live|role="status"/, "the engine's one live region is in the overlay layer");
    assert.match(html, /<button type="button" class="mc-sw" role="switch" aria-checked="true"/);
  }
  // Until the engine plays, its controls are not pressable (it enables what it wires); lane tiles are out of the tab order.
  for (const b of field.match(/<button[^>]*>/g)!) assert.ok(/ disabled>$/.test(b) || /class="mc-tile" data-t="t\d+" tabindex="-1">$/.test(b), b);
});

test("the labels stay honest: the sample chip and rates line, the status strip only while subscriber payments are off, t3 only behind its flag, no image", () => {
  const d = data();
  for (const kind of ["field", "board"] as const) {
    const off = render(kind), on = render(kind, { flags: { ...FLAGS, payments: true } });
    for (const s of [d.labels.chip, d.labels.rates]) {
      assert.ok(off.includes(esc(s)), `${kind}: ${s}`);
      assert.ok(on.includes(esc(s)), `${kind}, payments on: ${s}`);
    }
    assert.ok(off.includes(esc(d.labels.subscribers!)), `${kind}: the status strip`);
    assert.doesNotMatch(on, /Subscribers can(?:&#39;|’)t join yet/, `${kind}: payments on drops the strip`);
    for (const html of [off, on]) {
      assert.doesNotMatch(html, /<img|<video|<picture|poster=|url\(/i, `${kind}: never an image, video or poster`);
      assert.doesNotMatch(html, /data-t="t3"|Hamdan|Recovery 25%/, `${kind}: t3 stays off without its flag`);
      assert.doesNotMatch(html, PLACEHOLDER);
      assert.doesNotMatch(text(html), MODEL_OR_VENDOR);
      for (const { term } of C0_BANNED) assert.doesNotMatch(text(html), term, `${kind}: ${term}`);
    }
  }
  const field = render("field");
  assert.ok(field.includes(`<p class="mc-eyebrow">${d.labels.eyebrow}</p>`));
  // Every specialist that is not on yet says so, on its node and in the phones' count: with voice and
  // nutrition off that is the meal planner, meal photos, voice lines, the set logger and the recovery rule.
  for (const flags of [FLAGS, { ...FLAGS, voice: true, nutrition: true }]) {
    const html = render("field", { flags }), off = data({ flags }).specialists.filter((s) => s.status == "not_on_yet").map((s) => s.id);
    assert.ok(off.includes("recovery") && (flags.voice || off.length == 5), off.join());
    for (const sp of off) assert.match(html, new RegExp(`data-sp="${sp}"[^>]*>(?:(?!</div>).)*<span class="sc-offchip">Not on yet</span>`), sp);
    assert.equal((html.match(/<span class="sc-offchip">Not on yet<\/span>/g) || []).length, off.length);
    assert.ok(html.includes(`<span class="mc-noy" aria-hidden="true">Not on yet: ${off.length}</span>`));
  }
  // The shelf holds only what is not on yet; once nutrition is on, the Meal planner joins the specialists, beside
  // the Set logger (L2). The Recovery rule stays off in phase 1.
  const shelf = (html: string) => [...element(html, html.indexOf('<div class="mc-shelf">')).matchAll(/data-sp="(\w+)"/g)].map((m) => m[1]);
  const row3 = (html: string) => element(html, html.indexOf('<div class="mc-row mc-r3 mc-r3b'));
  assert.deepEqual(shelf(field), ["meal_planner", "recovery"]);
  assert.doesNotMatch(row3(field), /meal_planner|mc-r3p/);
  const fed = render("field", { flags: { ...FLAGS, nutrition: true } });
  assert.deepEqual(shelf(fed), ["recovery"]);
  assert.match(row3(fed), /^<div class="mc-row mc-r3 mc-r3b mc-r3p"><div class="sc-node mc-n" data-sp="set_logger"[\s\S]*<div class="sc-node mc-n" data-sp="meal_planner" data-kind="ai" data-state="idle" title="[^"]*">(?:(?!sc-offchip).)*<\/div><span class="mc-cr">/);
  // How we count opens without the engine (and in the still frame): a details element.
  assert.ok(field.includes(`<details class="mc-how"><summary>How we count</summary><p class="mc-howp">${esc(d.labels.howWeCount as string)}</p></details>`));
});

test("the call to action comes from the options: the receipts' link in the frame, never /signup while sign-ups are closed", () => {
  for (const kind of ["field", "board"] as const) {
    const closed = render(kind), open = render(kind, { cta: OPEN });
    assert.ok(closed.includes(`<template class="mc-cta"><a class="bp-btn bp-btn-p" href="/get-started#early-access" data-sc-cta>Join early access — free</a></template>`), kind);
    assert.doesNotMatch(closed, /href="\/signup"/, `${kind}: sign-ups closed`);
    assert.ok(open.includes(`<template class="mc-cta"><a class="bp-btn bp-btn-p" href="/signup" data-sc-cta>Teach your AI — free</a></template>`), `${kind}: open`);
    for (const html of [closed, open]) assert.doesNotMatch(html, /signup\.html|Start coaching/, kind);
  }
  for (const f of ["field.render.js", "field.js", "receipt.js"]) assert.doesNotMatch(src(ENGINE + f), /signup\.html|"\/signup"|Teach your AI/, `${f}: the call to action only from the options`);
});

test("inner ids start with the host id, every reference resolves, and the platform's name is escaped", () => {
  for (const [kind, host] of [["field", "hf"], ["board", "hb"]] as const) {
    const html = render(kind, {}, host), inner = html.replace(/^<section[^>]*>/, "");
    const ids = [...inner.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(ids.length >= 6, `${kind}: ${ids.length} ids`);
    for (const id of ids) assert.ok(id.startsWith(host + "-"), `${kind}: ${id}`);
    assert.equal(new Set(ids).size, ids.length, `${kind}: ids are unique`);
    for (const m of inner.matchAll(/\saria-(?:labelledby|describedby|controls)="([^"]+)"/g))
      for (const ref of m[1].split(" ")) assert.ok(ids.includes(ref), `${kind}: ${ref} resolves`);
  }
  // The safety lock names the platform's rule, as its receipts do; the name is escaped.
  const evil = "<b>Acme</b> & co";
  for (const kind of ["field", "board"] as const) {
    const html = render(kind, { appName: evil });
    assert.ok(html.includes(`<b>Platform safety rules</b><span class="sc-sr">. </span>${esc(evil)}. Can&#39;t switch off. You can only make them stricter.</span>`), kind);
    assert.doesNotMatch(html, /<b>Acme<\/b>/);
    assert.doesNotMatch(render(kind, { appName: "Acme" }), /trainsyou/i, `${kind}: a renamed platform`);
  }
});

test("the first frame is valid, stable HTML: tags balance, no block inside a paragraph, equal options give equal markup", () => {
  const VOID = new Set(["input", "br", "img", "hr", "meta", "link", "source", "wbr", "area", "col", "embed", "track", "path", "rect", "circle", "line", "polyline"]);
  const BLOCK = new Set(["div", "p", "ul", "ol", "li", "section", "header", "footer", "table", "form", "h2", "h3", "figure"]);
  for (const kind of ["field", "board"] as const) {
    const html = render(kind), stack: string[] = [];
    for (const m of html.matchAll(/<(\/?)(\w+)[^>]*?(\/?)>/g)) {
      const [, close, name, self] = m;
      if (VOID.has(name) || self) continue;
      if (close) assert.equal(stack.pop(), name, `${kind}: </${name}> at ${m.index}`);
      else {
        if (BLOCK.has(name)) assert.ok(!stack.includes("p") && !stack.includes("button"), `${kind}: <${name}> inside <p> or <button> at ${m.index}`);
        stack.push(name);
      }
    }
    assert.deepEqual(stack, [], `${kind}: every tag closes`);
    const d = data();
    assert.equal(renderStatic(d, { ...options(), kind, id: "x" }), renderStatic(data(), { ...options(), kind, id: "x" }));
  }
  // prepare() copies: rendering never changes the imported traces.
  assert.equal(JSON.stringify(RAW), src("apps/web/components/marketing/brain/data/traces.client.json").trim());
});

test("sizes are reserved so the engine moves nothing: two lines for the streamed readout, fixed count slots, one Pause width, Kamran's gutter", () => {
  const stage = cssRules(src("apps/web/app/brain-field.css")), run = cssRules(src(ENGINE + "field.run.css"));
  const decl = (rules: typeof stage, selector: string, prop: string, media?: string) =>
    rules.find((r) => r.selectors.includes(selector) && (!media || r.context.includes(media)) && r.declarations.some((d) => d.property == prop))
      ?.declarations.find((d) => d.property == prop)?.value;
  const PHONE = "@media (max-width: 760px)";
  // The streamed code-rule readout (phones): two 12 px lines, held.
  assert.equal(decl(stage, '[data-showcase="field"] .mc-cr', "height", PHONE), "24px");
  assert.equal(decl(stage, '[data-showcase="field"] .mc-cr', "line-height", PHONE), "12px");
  assert.equal(decl(stage, '[data-showcase="field"] .mc-cr', "-webkit-line-clamp", PHONE), "2");
  // Streamed words: the final copy holds the box, the live copy streams over it.
  assert.equal(decl(run, "[data-showcase] .mc-sf", "visibility"), "hidden");
  assert.equal(decl(run, "[data-showcase] .mc-sl", "position"), "absolute");
  const engine = src(ENGINE + "field.js");
  assert.match(engine, /class="mc-sf">\$\{line\}<span>\$\{esc\(text\)\}<\/span>\$\{basis\}<\/span><span class="mc-sl">/, "the readout streams over its final line");
  // Counts roll in fixed-width slots; the subtitle never changes size; lanes and rows have fixed heights.
  assert.equal(decl(stage, '[data-showcase="field"] .mc-c', "min-inline-size"), "2ch");
  assert.equal(decl(stage, '[data-showcase="field"] .mc-c', "font-variant-numeric"), "tabular-nums");
  assert.equal(decl(stage, '[data-showcase="field"] .mc-sub', "height"), "36px");
  assert.equal(decl(stage, '[data-showcase="field"] .mc-body', "height"), "458px");
  assert.equal(decl(stage, '[data-showcase="field"] .mc-lanes', "grid-template-rows"), "12px 168px 162px minmax(0, 1fr)");
  // Pause and Play (and "Play the field" under reduced motion) share one width: hidden sizers in the button.
  const html = render("field");
  assert.ok(html.includes('<span data-label>Pause</span><span class="mc-psz" aria-hidden="true">Pause</span><span class="mc-psz mc-psz2" aria-hidden="true">Play the field</span>'));
  // Phones: the bottom rows keep clear of Kamran's button (52 px, 16 px in, an 8 px gap: 76 px), even with no page gutter.
  const pad = decl(stage, '[data-showcase="field"]', "padding", PHONE)!.split(" ").at(-1)!;
  for (const s of ['[data-showcase="field"] .mc-ctrl', '[data-showcase="field"] .mc-foot'])
    assert.ok(parseFloat(decl(stage, s, "margin-inline-end", PHONE)!) + parseFloat(pad) >= 52 + 16 + 8, s);
  // Lane tiles sit in their lists by transforms once the engine plays; Noura's slot waits for her.
  assert.equal(decl(run, "[data-showcase] .mc-tl.is-stack > li", "position"), "absolute");
  assert.equal(decl(run, "[data-showcase] .mc-li.is-due", "visibility"), "hidden");
  // Nothing in the field is wider than the field: its one column shrinks, the header's legend wraps, the
  // members' column grows to its longest label (text spacing) and a tile's tag wraps.
  assert.equal(decl(stage, '[data-showcase="field"]', "grid-template-columns"), "minmax(0, 1fr)");
  assert.equal(decl(stage, '[data-showcase="field"] .mc-legend', "flex-wrap"), "wrap");
  assert.equal(decl(stage, '[data-showcase="field"] .mc-body', "grid-template-columns"), "minmax(106px, max-content) minmax(0, 1fr) 156px");
  assert.equal(decl(stage, '[data-showcase="field"] .mc-tag', "white-space"), undefined);
});

test("controls stay usable: contrast themes, phone hit areas, 320px, tips, the scroll lock", () => {
  const stage = cssRules(src("apps/web/app/brain-field.css")), run = cssRules(src(ENGINE + "field.run.css"));
  const rule = (rules: typeof stage, selector: string, media?: string) => rules.find((r) => r.selectors.includes(selector) && (!media || r.context.includes(media)));
  const value = (rules: typeof stage, selector: string, prop: string, media?: string) =>
    rules.find((r) => r.selectors.includes(selector) && (!media || r.context.includes(media)) && r.declarations.some((d) => d.property == prop))?.declarations.find((d) => d.property == prop)?.value;
  // Forced colours: the chosen level and the switch keep system colours (fills are dropped there).
  const FORCED = "@media (forced-colors: active)";
  for (const s of ['[data-showcase] .mc-lv button[aria-checked="true"]', '[data-showcase] .mc-sw[aria-checked="true"] .mc-swk']) {
    assert.equal(value(stage, s, "forced-color-adjust", FORCED), "none", s);
    assert.equal(value(stage, s, "background", FORCED), "Highlight", s);
  }
  assert.equal(value(stage, "[data-showcase] .mc-swk", "border", FORCED), "1px solid CanvasText");
  assert.equal(value(stage, "[data-showcase] .mc-swk::after", "background", FORCED), "CanvasText");
  // Phones: every armed field and board control is hit over at least 44px of height (More settings over 44px square).
  const PHONE = "@media (max-width: 760px)";
  const hit = '[data-showcase][data-sc="on"] :is(.mc-lv button, .mc-how summary, .mc-lock, .mc-chk, .mc-sw, .mc-moreb)::before';
  assert.equal(value(run, hit, "inset", PHONE), "calc(50% - 22px) 0");
  assert.equal(value(run, '[data-showcase="layer"] :is(.mc-lock, .mc-chk, .mc-sw)::before', "inset", PHONE), "calc(50% - 22px) 0");
  assert.equal(value(run, '[data-showcase][data-sc="on"] .mc-moreb.mc-moreb::before', "inset-inline", PHONE), "-6px");
  // Each hit area is its own: the board's control rows sit 16px apart (the lock's took the switch's foot), and the
  // field's Pause lies over the message below it (A11Y-7, A11Y-10).
  assert.equal(value(stage, '[data-showcase="board"] .mb-ctrl', "row-gap", PHONE), "16px");
  assert.equal(value(stage, '[data-showcase="field"] .mc-pause', "z-index"), "1");
  // Its ::after sits on the padding box: 26px less the 1px borders, plus 9 + 11 is 44 (L7), the top within the root's 8px padding.
  assert.equal(value(stage, '[data-showcase="field"] .mc-pause::after', "inset", PHONE), "-9px -4px -11px", "within the root's 8px top padding");
  assert.equal(value(stage, '[data-showcase="field"] .mc-pause::after', "inset"), "-10px -4px");
  assert.equal(value(stage, '[data-showcase="board"] .mc-bar input[type="range"]', "height", PHONE), "44px");
  assert.equal(value(run, '[data-showcase="layer"] .mc-sheet .mc-bar input[type="range"]', "height"), "44px");
  assert.equal(value(run, '[data-showcase="layer"] .mc-x', "min-block-size"), "44px");
  // 400% zoom (320x256): the open sheet stays within the viewport and scrolls inside, its title and Done in reach (A11Y-6).
  for (const [p, v] of [["max-height", "100dvh"], ["min-height", "min(300px, 100dvh)"], ["overflow-y", "auto"], ["overscroll-behavior", "contain"]])
    assert.equal(value(run, '[data-showcase="layer"] .mc-sheet', p), v, p);
  // 320px: the board's three levels (318px in a row) stack below 350px.
  assert.equal(value(stage, '[data-showcase="board"] .mc-lv', "display", "@media (max-width: 349px)"), "grid");
  // The hover tip can be hovered (WCAG 1.4.13): it takes the pointer while shown, across a bridge to its control.
  assert.equal(value(stage, "[data-showcase] .mc-chk:hover .mc-tip", "pointer-events"), "auto");
  assert.equal(value(stage, "[data-showcase] .mc-tip::after", "inset"), "100% 0 -8px");
  // The still frame's cards keep their look while disabled.
  assert.ok(rule(stage, '[data-showcase="board"] .mb-b:disabled')?.declarations.some((d) => d.property == "background" && d.value == "var(--sc-node)"));
  // The scroll lock (receipts and the phone sheet) keeps the scrollbar's gutter: nothing centred moves.
  assert.equal(value(run, "html.sc-lock", "overflow"), "hidden");
  assert.equal(value(run, "html.sc-lock", "scrollbar-gutter"), "stable");
});

test("the runtime keeps to the page: its own CSS by static import, receipts by a literal import, overlays in the layer, no test handles", () => {
  const code = (path: string) => src(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const field = code(ENGINE + "field.js"), receipt = code(ENGINE + "receipt.js");
  assert.match(field, /^import "\.\/field\.run\.css";$/m);
  assert.match(receipt, /^import "\.\/receipt\.css";$/m);
  assert.deepEqual([...field.matchAll(/\bimport\(([^)]*)\)/g)].map((m) => m[1]), ['"./receipt.js"', '"./receipt.js"'], "receipts and their prefetch: one literal import");
  assert.match(field, /C\.prefetch\(\(\) => import\("\.\/receipt\.js"\), root, 10000\)/);
  for (const [name, code] of [["field.js", field], ["receipt.js", receipt]] as const) {
    assert.doesNotMatch(code, /new URL\(|import\.meta\.url|\bfetch\(|document\.body|__mc|\bDBG\b|[?&]dbg|ba-lock/, name);
    assert.match(code, /C\.layer\(|o\.layer/, `${name}: overlays mount in the overlay layer`);
  }
  assert.match(receipt, /classList\.add\("sc-lock"\)/);
  assert.match(receipt, /classList\.remove\("sc-lock"\)/);
  // A modal receipt (dialog or phone sheet) owns the keyboard: the page behind is inert, Esc and Tab are
  // heard on the document, and Tab wraps from anywhere (its heading, the first focus, included).
  assert.match(receipt, /const undo = inline \? null : C\.inertOutside\(o\.layer\)/);
  assert.match(receipt, /\(inline \? box : document\)\.addEventListener\("keydown", key, !inline\)/);
  assert.match(receipt, /const i = f\.indexOf\(document\.activeElement\)/);
  // Closing lifts the opener's inert parts before focus goes back to it.
  assert.match(receipt, /o\.onClose && o\.onClose\(\);\s+if \(!quiet && opener/);
  // Receipts open one at a time, in the field and on the board; the phone sheet is a modal dialog.
  assert.equal((field.match(/(?:if \(|!b \|\| )opening\) return;/g) || []).length, 2);
  assert.match(field, /sheet\.setAttribute\("role", "dialog"\); sheet\.setAttribute\("aria-modal", "true"\)/);
  // Reduced motion: nothing replays through WAAPI; the auto-demo never overrides a level the visitor chose.
  assert.match(field, /if \(C\.reduced\(\)\) return;/);
  assert.match(field, /if \(!p\.touched\) ctl\.setLv\(n, true\)/);
  // The board clears its own pre-state; every Pause control is the scene's (aria-pressed, data-sc-pause).
  assert.match(field, /function mountBoard[\s\S]*?root\.setAttribute\("data-sc", "on"\)/);
  assert.match(field, /sc\.button\(pb, \{ pause: COPY\.pause, play: COPY\.playField \}\);\s+sc\.pause\(\);/, "reduced motion starts paused, on Play the field");
});

test("the board's line keeps the room of the longest it can say after one change, and its note is read out (ENG-5, A11Y-11)", () => {
  const board = render("board"), d = data(), S = defaults(d);
  const note = element(board, board.indexOf('<p class="mb-note">'));
  // The level note is visible text: only its sizer is hidden from assistive tech.
  assert.match(note, /^<p class="mb-note"><span>Up to 5 routine replies you choose can send automatically after a passing check\.<\/span><span class="mb-sz" aria-hidden="true">/);
  const line = element(board, board.indexOf('<p class="mb-diff">'));
  const sized = /^<p class="mb-diff"><span><\/span><span class="mb-sz" aria-hidden="true">([^<]+)<\/span><\/p>$/.exec(line)![1].replace(/&#39;/g, "'");
  // Every line a change from the sample settings and from the repro's steps can give fits the reserved one.
  const lane = (s: typeof S) => d.traces.map((t) => (isOff(t, s) ? null : decide(t, s, d).lane));
  const said = (a: typeof S, b: typeof S, key: string) => {
    const la = lane(a), lb = lane(b);
    return diffLine(d, d.traces.flatMap((t, n) => (la[n] && lb[n] && la[n] != lb[n] ? [[t, la[n]!, lb[n]!] as [typeof t, (typeof la)[number] & string, (typeof la)[number] & string]] : [])), key, b);
  };
  let s = S;
  for (const [key, v] of [["level", 1], ["supplementsTopic", false], ["level", 3], ["bar", 90], ["bar", 70], ["bar", 50], ["bar", 99]] as const) {
    const next = { ...s, [key]: v };
    const text = said(s, next, key);
    assert.ok(text.length <= sized.length, `${key} ${v}: "${text}" fits "${sized}"`);
    s = next;
  }
  assert.equal(said(S, { ...S, level: 1 }, "level"), "Omar moved to Waits for you.");
  assert.equal(sized, "Aisha and Fatima moved to Sent on its own, within your rules.", "two plans crossing the bar at once is the longest");
  // The engine writes the short line in the first span and keeps the reasons for the announcement.
  const js = src(ENGINE + "field.js");
  assert.match(js, /diff = root\.querySelector\("\.mb-diff > span"\)/);
  assert.match(js, /line = user \? diffLine\(d, moved\.map\(\(\[t, b, r\]\) => \[t, b, r\.lane\]\), key, S\) : ""/);
  assert.match(js, / Why: " \+ r\.why/, "the announcement keeps the reasons");
  const stage = cssRules(src("apps/web/app/brain-field.css"));
  assert.ok(stage.some((r) => r.selectors.includes('[data-showcase="board"] .mb-diff > span') && r.declarations.some((x) => x.property == "grid-area" && x.value == "1 / 1")));
});

test("the field's runtime: a receipt in the zoom turns into the phone's sheet, keyboard focus holds the field, the sheet hears Esc from anywhere, the mount yields first", () => {
  const js = src(ENGINE + "field.js"), rx = src(ENGINE + "receipt.js");
  // ENG-1: a layout that turns into the phone's closes the zoom and reopens the same moment as the sheet.
  assert.match(js, /if \(!ph\) undock\(\);\s+else unfit\(\);/);
  assert.match(js, /function unfit\(\) \{\s+if \(!ph \|\| !zoomHost \|\| !rx \|\| opening\) return;[\s\S]*?rx\.close\(true\);[\s\S]*?receipt\(id, from\);/);
  // A11Y-3: keyboard focus on a moment holds the field (a "focus" reason, lifted when focus leaves the body).
  assert.match(js, /k\.on\(body, "focusin", \(e\) => e\.target\.matches\(":focus-visible"\) && sc\.set\("focus", true\)\);/);
  assert.match(js, /k\.on\(body, "focusout", \(e\) => !body\.contains\(e\.relatedTarget\) && sc\.set\("focus", false\)\);/);
  // A11Y-5: the modal sheet's keys on the document, in the capture phase, only while it is open.
  assert.match(js, /document\.addEventListener\("keydown", sheetKey, true\)/);
  assert.match(js, /document\.removeEventListener\("keydown", sheetKey, true\)/);
  assert.doesNotMatch(js, /k\.on\(sheet, "keydown"/);
  // The inline receipt takes focus from a click on its text, so Esc reaches it.
  assert.match(rx, /tabindex: inline \? "-1" : null/);
  // L8: one inertOutside, the core's.
  for (const f of [js, rx]) assert.doesNotMatch(f, /function inertOutside/);
  assert.match(js, /C\.inertOutside\(L\.el\)/);
  assert.match(rx, /C\.inertOutside\(o\.layer\)/);
  // PERF-2: the chunk's evaluation and the mount are two tasks.
  assert.match(js, /export async function mount\(root, o\) \{\s+await C\.nextTask\(\);/);
  // L4: a receipt reads the moment's status as the page's flags make it.
  assert.match(rx, /const status = r\.off \? "not_on_yet" : t\.status;/);
});
