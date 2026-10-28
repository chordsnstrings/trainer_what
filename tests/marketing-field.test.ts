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
import { renderStatic } from "../apps/web/components/marketing/brain/engine/field.render.js";
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
  const lane = (l: string) => element(html, html.indexOf(`<section class="mc-lane" data-lane="${l}"`));
  for (const l of ["sent", "waits", "paused"] as const) {
    const sec = lane(l), tiles = [...sec.matchAll(/<li class="mc-li( sc-res)?" data-t="(t\d+)">/g)].map((m) => m[2] + (m[1] ? "*" : ""));
    assert.deepEqual(tiles, l == "paused" ? ["t2*", ...START.paused] : START[l], l);
    assert.match(sec, new RegExp(`<button type="button" class="mc-bin" data-bin="${l}" disabled>`), `${l}: its phone bin`);
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
  }
  for (const r of buttons(field, "mc-tile")) assert.ok(text(r.html).startsWith(" " + d.trace(r.id).member + " · "), r.id);
  // The board: one card per moment, in the column decide() gives it, counted; the totals line.
  const cards = buttons(board, "mb-b");
  assert.deepEqual(cards.map((c) => c.id).sort(), [...playable].sort());
  for (const lane of ["sent", "waits", "paused", "member", "learn"]) {
    const col = element(board, board.indexOf(`<section class="mb-col" data-lane="${lane}"`));
    const ids = [...col.matchAll(/<li class="mb-c" data-t="(t\d+)">/g)].map((m) => m[1]);
    assert.deepEqual(ids, d.traces.filter((t) => !isOff(t, S) && decide(t, S, d).lane == lane).map(id0), lane);
    assert.ok(col.includes(`<span class="mb-n">${ids.length}</span>`), `${lane} count`);
    assert.match(col, new RegExp(`^<section class="mb-col" data-lane="${lane}" aria-labelledby="sc-board-h-${lane}">`));
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
  assert.equal((field.match(/<span class="sc-offchip">Not on yet<\/span>/g) || []).length, 2, "Meal planner and Recovery rule say so");
  assert.ok(field.includes('<span class="mc-noy" aria-hidden="true">Not on yet: 2</span>'));
  assert.ok(field.includes(`<p class="mc-howp" id="sc-field-howp" hidden>${esc(d.labels.howWeCount as string)}</p>`));
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
    assert.ok(ids.length >= (kind == "field" ? 7 : 6), `${kind}: ${ids.length} ids`);
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
  // The board clears its own pre-state; every Pause control is the scene's (aria-pressed, data-sc-pause).
  assert.match(field, /function mountBoard[\s\S]*?root\.setAttribute\("data-sc", "on"\)/);
  assert.match(field, /sc\.button\(pb, \{ pause: COPY\.pause, play: COPY\.playField \}\);\s+sc\.pause\(\);/, "reduced motion starts paused, on Play the field");
});
