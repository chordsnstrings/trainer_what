/* The field ("A sample hour of your Brain", the home hero) and the board
   (band 2, "Change a setting. Watch it re-sort."): their first frame, as
   HTML strings. Pure: no CSS, no DOM, nothing at import, so the server
   render (render.ts) and the tests import it; field.js, the runtime, builds
   on the same markup. Ported from the approved prototype's static half
   (docs/marketing-revamp-2026-10-26/prototypes/concept-a/site/assets/
   a-field.js) with the changes of docs/marketing-revamp-2026-10-26/phase1/
   PLAN.md §1.1 and WP2:
   - every inner id starts with the host id (o.id);
   - the status strip follows the payments flag (prepare() in data.js);
   - results the engine plays carry .sc-res (hidden only while it may still
     play them, app/brain-stage.css), and .mc-pre/.mc-fin swap a count or a
     name for the same moment; everything else is the final frame;
   - slots are reserved so the engine's changes move nothing: the two-line
     code-rule readout, fixed-width counts, the Pause label's width;
   - the board has no live region of its own (the engine's one is in the
     overlay layer);
   - the receipts' call to action comes from the options, and the frame
     carries it, so the host's key changes with it (brain/showcase.tsx);
   - the safety lock's tip names the platform's rule, as its receipts do. */
import { esc } from "./core.js";
import { decide, defaults, isOff, totals } from "./decide.js";
import * as U from "./ui.js";

/** The root element's classes for each kind this module renders (render.ts). */
export const ROOT = { field: "mc sc-stage", board: "mb sc-stage" };

/* ------------------------------------------------------------------ copy */
export const COPY = {
  sr: "A sample animation. Messages from sample subscribers pass through code checks, then one AI specialist that code picks, then more code checks. Each ends sent on its own, waiting for you, or paused. Below it, every moment is listed as a button.",
  bands: ["Checks first", "Your Brain", "Checks after", "Learns from you", "Not on yet"],
  rules: "Your rules", shellCap: "Code picks one specialist per moment", codeRule: "code rule for workouts",
  book: ["Your method", "rules (sample)"],
  lanes: { sent: ["Sent on its own", "within your rules"], waits: ["Your Today", "Waits for you"], paused: ["Training paused", "Safety first"] },
  laneShort: { sent: "Sent", waits: "Your Today", paused: "Paused" },
  hour: "In this sample hour", toCheck: "To check · already sent",
  tap: "Tap any moment to see each step", turn: "Your turn: set Brain level to 1, or tap any moment to see each step",
  newHour: "New sample hour", legend: ["AI specialist", "Code, no AI", "Other members' moments"],
  lock: "Safety rules · can't switch off", stricter: "You can only make them stricter.",
  lastCheck: "Last check: passed (sample)", supp: "Supplement questions: I answer myself", suppSub: "Your choice · off by default",
  suppOff: "Supplements still never send on their own.", drafted: "Drafted for you", more: "More settings", done: "Done",
  demo: "Demo", reading: "Paused while you read", pause: "Pause", play: "Play", playField: "Play the field",
  stop: "STOP · No AI called", noAi: "No AI called", openList: "open the list",
  members: "Sample members. Open any moment to see each step.", level: "Brain level",
  learn: ["You edit Zayed's draft", "Privacy: name becomes [client]", "Make this a rule?", "Confirmed", "About a minute later", "Passed · live"],
  rule: "Upper body increments",
};
/* The Brain frame: checks first, the specialists code picks from (two rows
   of three, then the Set logger), checks after. */
export const FIRST = ["safety", "topics", "memory", "rule_finder"], AFTER = ["checker", "confidence", "lane_gate"];
export const SHELL = [["reply_picker", "draft_writer", "plan_writer"], ["week_reviewer", "meal_photo", "voice_lines"]];
/** The member rows, one per moment (t3 only plays with its flag, and has no row). */
export const ROWS = ["t2", "t1", "t8", "t4", "t10", "t7", "t9", "t5", "t6", "t11", "t12"];
/** Field-only presentation per moment: tile label, member-row chip, event icon, the incoming text for events. */
export const FX = {
  t1: ["+2.5 kg", "Up in weight?", "message-square"],
  t2: ["knee", "Knee popped", "message-square"],
  t3: ["lighter workout", "Recovery 25%", "heart-pulse", "Starts today's workout. Recovery 25%."],
  t4: ["meal", "Meal photo", "camera", "Sends a meal photo: penne in a creamy sauce."],
  t5: ["54 kg", "Voice session", "audio-lines", "Starts a voice-guided session."],
  t6: ["deload?", "Skip deload?", "message-square"],
  t7: ["draft", "Add weight?", "message-square"],
  t8: ["plan · 78%", "Week ended", "calendar-check", "Her programme week ends."],
  t9: ["creatine", "Creatine?", "message-square"],
  t10: ["first plan", "Intake done", "calendar-range", "Finishes her intake. Her first plan is due."],
  t11: ["pregnancy", "Pregnant", "message-square"],
  t12: ["chest pain", "صدري يعورني", "message-square"],
};
/** The lanes at the first frame (the storyboard's): Noura's stop then lands in Training paused. */
export const START = { sent: ["t10", "t5"], waits: ["t9"], paused: ["t11"] };
export const id0 = (t) => t.id.split("-")[0];
export const tagOf = (id) => (id == "t10" ? "Spot check" : id == "t5" ? "Your rule, applied by code" : "");

/* ------------------------------------------------------------------ atoms */
/** A node in the field: pill = AI specialist, square = code. The matrix slot is drawn by the engine. */
export function nodeHTML(d, sp, o = {}) {
  const s = d.sp[sp], off = s.status == "not_on_yet";
  return `<div class="sc-node mc-n${o.cls ? " " + o.cls : ""}" data-sp="${sp}" data-kind="${s.kind}" data-state="${o.state || "idle"}"${o.who ? ` data-who="${o.who}"` : ""}${off ? " data-off" : ""} title="${esc(s.name + ": " + s.line + (s.statusTip ? " " + s.statusTip : ""))}">` +
    `<span class="sc-mx"></span>${U.icon(s.icon, 14)}<span class="sc-nm">${esc(s.name)}</span>` +
    (s.usesAi ? `<span class="sc-badge">uses your AI</span>` : "") + (off ? `<span class="sc-offchip">${esc(d.labels.status.not_on_yet)}</span>` : "") +
    `<span class="mc-v${o.valCls ? " " + o.valCls : ""}">${o.val ? esc(o.val) : ""}</span>${o.extra || ""}</div>`;
}
/** A lane tile: a real button that opens the moment's receipt. */
export function tileHTML(d, id, cls = "") {
  const t = d.trace(id), tg = tagOf(id);
  return `<li class="mc-li${cls}" data-t="${id}"><button type="button" class="mc-tile" data-t="${id}" tabindex="-1"><span class="mc-tn">${esc(t.member)} · ${esc(FX[id][0])}</span>${tg ? `<span class="mc-tag">${esc(tg)}</span>` : ""}<span class="mc-sub2"></span></button></li>`;
}
/** The incoming message; a stop's matched words are marked (red only once it is a hit). */
export function msgHTML(t, cls = "") {
  let m = esc(FX[id0(t)][3] || t.trigger.text);
  const st = t.steps.find((s) => s.sp == "safety" && s.result == "hit");
  if (st) for (const w of st.highlight || []) m = m.split(esc(w)).join(`<mark class="mc-hl">${esc(w)}</mark>`);
  const ar = t.trigger.lang == "ar";
  return `<div class="mc-msg${cls}" data-t="${id0(t)}"><span class="mc-av" aria-hidden="true">${esc(t.member[0])}</span><span class="mc-mt"${ar ? ' dir="rtl" lang="ar"' : ""}><b>${esc(t.member)}</b>${m}</span></div>`;
}
/** The subtitle line for a moment: name in bold, arrows in Pace, a stop's words in red. */
export function subHTML(t) {
  let s = esc(t.subtitle);
  const st = t.steps.find((x) => x.sp == "safety" && x.result == "hit");
  if (st) for (const w of st.highlight || []) s = s.split(esc(w)).join(`<em class="mc-red">${esc(w)}</em>`);
  return s.replace(/ → /g, ` <i>→</i> `).replace(/^([^:]+:)/, "<b>$1</b>");
}
/** The Brain level segment: the trainer's three levels, as radios. In the field,
    phones show the chosen level's name in its own fixed slot (a change moves
    nothing), and the auto-demo's chip marks its presses. */
function levels(d, S, inField) {
  const lv = d.labels.levels;
  const b = (n) => `<button type="button" role="radio" aria-checked="${n == S.level}" tabindex="${n == S.level ? 0 : -1}" data-level="${n}" disabled><b>${n}</b> <span class="mc-lvn">${esc(lv[n].name)}</span></button>`;
  return `<div class="mc-lv" role="radiogroup" aria-label="${esc(COPY.level)}"><span class="mc-k" aria-hidden="true">${esc(COPY.level)}</span>${[1, 2, 3].map(b).join("")}` +
    (inField ? `<span class="mc-lvnow" aria-hidden="true">${esc(lv[S.level].name)}</span><span class="mc-demo" aria-hidden="true">${esc(COPY.demo)}</span>` : "") + `</div>`;
}
/** The plans slider (how sure a plan must be to send alone); --fill paints its track. */
export const fill = (d, v) => ((v - d.labels.planSetting.min) / (d.labels.planSetting.max - d.labels.planSetting.min)) * 100;
const bar = (d, S) => `<label class="mc-bar"><span>${esc(d.labels.planSetting.label)}</span><span class="mc-bari"><input type="range" min="${d.labels.planSetting.min}" max="${d.labels.planSetting.max}" step="1" value="${S.bar}" aria-valuetext="${S.bar}%" style="--fill:${fill(d, S.bar).toFixed(1)}%" disabled><output>${S.bar}%</output></span></label>`;
const supp = (S) => `<button type="button" class="mc-sw" role="switch" aria-checked="${S.supplementsTopic}" disabled><span class="mc-swk" aria-hidden="true"></span><span><b>${esc(COPY.supp)}</b><small>${esc(COPY.suppSub)}</small></span></button>`;
/** The safety lock. Its tip is the platform's rule, as a stop's receipt shows
    it ("Platform safety rules", "{APP_NAME}. Can't switch off."). */
const lock = (d, tip) => {
  const r = d.trace("t2").rule;
  return `<button type="button" class="mc-lock" aria-describedby="${tip}" disabled>${U.icon("lock", 12)}${esc(COPY.lock)}<span class="mc-tip" role="tooltip" id="${tip}"><b>${esc(r.title)}</b><span class="sc-sr">. </span>${esc(r.source)} ${esc(COPY.stricter)}</span></button>`;
};
/** The receipts' call to action (receipt.js renders the same, from the same
    options). Inert here: the frame carries it so that a change to it, such as
    sign-ups opening, changes the host's key and remounts the island with it. */
const cta = (o) => `<template class="mc-cta">${U.cta(o)}</template>`;

/* ------------------------------------------------------------------ the field */
function field(d, o) {
  const S = defaults(d), lv = d.labels.levels, id = esc(o.id);
  const lane = (l) => {
    const [a, b] = COPY.lanes[l], pre = START[l].length, n = pre + (l == "paused" ? 1 : 0);
    const last = (ids) => esc(d.trace(ids[0]).member);
    const count = n != pre ? `<span class="mc-pre">${pre}</span><span class="mc-fin">${n}</span>` : n;
    return `<section class="mc-lane" data-lane="${l}" aria-labelledby="${id}-l-${l}">` +
      `<p class="mc-lh" id="${id}-l-${l}">${l == "waits" ? `<span class="mc-ls" aria-hidden="true">LS</span>` : ""}<span class="mc-ln">${l == "paused" ? `<span class="mc-lnx">Training </span><span class="mc-lnp">paused</span>` : esc(a)}</span><span class="mc-lsub">${esc(b)}</span><span class="mc-c" aria-hidden="true">${count}</span><span class="sc-sr mc-csr">: ${n} in this sample hour</span></p>` +
      `<ul class="mc-tl">${l == "paused" ? tileHTML(d, "t2", " sc-res") : ""}${START[l].map((x) => tileHTML(d, x)).join("")}<li class="mc-more" aria-hidden="true" hidden></li></ul>` +
      (l == "waits" ? `<p class="mc-chk2">${esc(COPY.toCheck)}: <b>1</b></p>` : "") +
      `<button type="button" class="mc-bin" data-bin="${l}" disabled><span class="mc-last">${l == "paused" ? `<span class="mc-pre">${last(START.paused)}</span><span class="mc-fin">${last(["t2"])}</span>` : last(START[l])}</span><span class="sc-sr"> — ${esc(COPY.openList)}</span></button></section>`;
  };
  const members = ROWS.map((x, i) => {
    const t = d.trace(x);
    return `<li><button type="button" class="mc-m${i < 2 ? " is-on" : ""}" data-t="${x}" tabindex="${i ? -1 : 0}" disabled><span class="mc-av" aria-hidden="true">${esc(t.member[0])}</span><span class="mc-mtx"><b>${esc(t.member)}</b><span class="mc-mc"${t.trigger.lang == "ar" ? ' dir="rtl" lang="ar"' : ""}>${esc(FX[x][1])}</span></span>${U.icon(FX[x][2], 12)}<span class="sc-sr"> — ${esc(t.chip)}. See each step.</span></button></li>`;
  }).join("");
  const off = d.specialists.filter((s) => s.status == "not_on_yet").length;
  const conf = `<span class="mc-gauge" aria-hidden="true"><i></i><b style="--bar:${S.bar}%"></b></span>`;
  return `<p class="sc-sr">${esc(COPY.sr)}</p>` +
    `<div class="mc-head"><p class="mc-eyebrow">${esc(d.labels.eyebrow)}</p><span class="mc-reading" hidden>${esc(COPY.reading)}</span>` +
    `<span class="mc-legend" aria-hidden="true"><span><i class="mc-lp"></i>${esc(COPY.legend[0])}</span><span><i class="mc-lq"></i>${esc(COPY.legend[1])}</span><span><i class="mc-lg"></i>${esc(COPY.legend[2])}</span></span>` +
    `<button type="button" class="mc-pause" aria-pressed="false" disabled><span class="mc-ip">${U.icon("pause", 12)}</span><span class="mc-ipl">${U.icon("play", 12)}</span><span data-label>${esc(COPY.pause)}</span><span class="mc-psz" aria-hidden="true">${esc(COPY.pause)}</span><span class="mc-psz mc-psz2" aria-hidden="true">${esc(COPY.playField)}</span></button></div>` +
    (d.labels.subscribers ? `<div class="sc-strip mc-strip"><span>${esc(d.labels.subscribers)}</span></div>` : "") +
    `<div class="mc-body"><svg class="mc-cv mc-rails" aria-hidden="true" focusable="false"></svg><canvas class="mc-cv mc-cv2" aria-hidden="true"></canvas>` +
    `<ul class="mc-mem" aria-label="${esc(COPY.members)}">${members}</ul>` +
    `<div class="mc-frame" aria-hidden="true">` +
    `<div class="mc-in">${msgHTML(d.trace("t2"), " is-hit mc-hitres")}</div>` +
    `<p class="mc-bl mc-bl1"><span>${esc(COPY.bands[0])}</span><span class="mc-br">${esc(COPY.rules)}</span></p>` +
    `<div class="mc-row mc-first">${FIRST.map((sp) => nodeHTML(d, sp, sp == "safety" ? { state: "hit", cls: "mc-hitres", who: "N", val: "STOP", valCls: "sc-res" } : {})).join("")}</div>` +
    `<div class="mc-shell"><p class="mc-st"><span class="mc-mono">LS</span><b>${esc(COPY.bands[1])}</b><span class="mc-cap">${esc(COPY.shellCap)}</span></p>` +
    SHELL.map((r) => `<div class="mc-row mc-r3">${r.map((sp) => nodeHTML(d, sp, sp == "reply_picker" ? { state: "lit", who: "O" } : {})).join("")}</div>`).join("") +
    `<div class="mc-row mc-r3 mc-r3b">${nodeHTML(d, "set_logger")}<span class="mc-cr">${esc(COPY.codeRule)}</span></div>` +
    `<span class="mc-noy" aria-hidden="true">${esc(COPY.bands[4])}: ${off}</span></div>` +
    `<p class="mc-stamp sc-res">${esc(COPY.stop)}</p>` +
    `<p class="mc-bl mc-bl2"><span>${esc(COPY.bands[2])}</span><span class="mc-br">${esc(COPY.rules)}</span></p>` +
    `<div class="mc-row mc-after">${AFTER.map((sp) => nodeHTML(d, sp, sp == "confidence" ? { extra: conf } : {})).join("")}</div>` +
    `<div class="mc-learn"><span class="mc-k">${esc(COPY.bands[3])}</span>` +
    `<div class="sc-node mc-n mc-tiny" data-sp="privacy" data-kind="check" data-state="idle" title="Privacy: code turns the client's name into [client]. Their message is never sent."><span class="sc-mx"></span>${U.icon("eye-off", 12)}<span class="sc-nm">Privacy</span><span class="mc-v"></span></div>` +
    `${nodeHTML(d, "learner", { cls: "mc-tiny" })}${nodeHTML(d, "examiner", { cls: "mc-tiny" })}</div>` +
    `<div class="mc-shelf"><span class="mc-k">${esc(COPY.bands[4])}</span>${nodeHTML(d, "meal_planner", { cls: "mc-tiny" })}${nodeHTML(d, "recovery", { cls: "mc-tiny" })}</div>` +
    `<div class="mc-spine"><span class="mc-bk"><b class="mc-bn">24</b> ${esc(COPY.book[1])}</span><span class="mc-bt2">${esc(COPY.book[0])}</span><span class="mc-new">${esc(COPY.rule)}</span></div>` +
    `</div>` +
    `<div class="mc-lanes"><p class="mc-lcap">${esc(COPY.hour)}</p>${["sent", "waits", "paused"].map(lane).join("")}</div>` +
    `</div>` +
    `<p class="mc-sub" aria-hidden="true"><span class="mc-s1 is-on">${subHTML(d.trace("t2"))}</span><span class="mc-s2"></span></p>` +
    `<div class="mc-ctrl">${levels(d, S, true)}` +
    `<button type="button" class="mc-moreb" aria-expanded="false" aria-controls="${id}-sheet" disabled>${U.icon("sliders-horizontal", 14)}<span class="mc-mbl">${esc(COPY.more)}</span></button>` +
    `<div class="mc-sheet" id="${id}-sheet" role="group" aria-label="${esc(COPY.more)}">` +
    `<p class="mc-sheet-h"><b>${esc(COPY.more)}</b><button type="button" class="mc-x" data-close disabled>${esc(COPY.done)}</button></p>` +
    `<span class="mc-chk" tabindex="0" aria-describedby="${id}-tip-l">${U.icon("check", 12)}${esc(COPY.lastCheck)}<span class="mc-tip" role="tooltip" id="${id}-tip-l">${esc(lv.note)}</span></span>` +
    `${bar(d, S)}${supp(S)}${lock(d, `${id}-tip-k`)}</div></div>` +
    `<div class="mc-foot"><span class="sc-sample">${esc(d.labels.chip)}</span><span>${esc(d.labels.rates)}</span><button type="button" class="mc-how" aria-expanded="false" aria-controls="${id}-howp" disabled>How we count</button><p class="mc-howp" id="${id}-howp" hidden>${esc(d.labels.howWeCount)}</p></div>` +
    cta(o);
}

/* ------------------------------------------------------------------ the board */
export const BLANES = ["sent", "waits", "paused", "member", "learn"];
/** The line under a card that says why it waits: Khalid's question while the
    trainer leaves supplement questions to a draft. */
export const whyOf = (id, S) => (id == "t9" && !S.supplementsTopic ? COPY.drafted : "");
/** The note under the board's controls once the level changes. */
export const levelNote = (d, n) => d.labels.levels[n].summary + (n > 1 ? " " + d.labels.levels.note : "");
/** Every setting the controls reach from S: each level, each step of the plans slider, supplements either way. */
function reach(d, S) {
  const { min, max } = d.labels.planSetting, out = [];
  for (const level of [1, 2, 3]) for (let bar = min; bar <= max; bar++) for (const supplementsTopic of [true, false]) out.push({ ...S, level, bar, supplementsTopic });
  return out;
}
/** One card per moment: who handled it (the specialist code picked, or the
    code that stopped it) and, for plans, how sure it is. A sizer's copy (sz)
    names no moment: it only holds the card's size. */
export function boardCard(d, t, r, why = "", sz = false) {
  const id = id0(t), st = r.steps.find((x) => x.sp in d.sp && d.sp[x.sp].kind == "ai" && x.sp != "learner");
  const who = st ? d.sp[st.sp] : null, hit = r.steps.find((x) => x.result == "hit");
  const by = hit ? `${d.sp[hit.sp].name} · ${COPY.noAi}` : who ? who.name : COPY.noAi;
  const code = t.decide == "voice" ? `<span class="mb-by" data-kind="check"><i aria-hidden="true"></i>Set logger · your rule</span>` : "";
  return (sz ? `<li><button type="button" class="mb-b" tabindex="-1">` : `<li class="mb-c" data-t="${id}"><button type="button" class="mb-b" data-t="${id}">`) +
    `<span class="mb-h"><span class="mc-av" aria-hidden="true">${esc(t.member[0])}</span><b>${esc(t.member)}</b><span>${esc(t.chip)}</span></span>` +
    `<span class="mb-by" data-kind="${who ? "ai" : "check"}"><i aria-hidden="true"></i>${esc(by)}</span>${code}${r.sure ? `<span class="mb-sure" data-ok="${r.lane == "sent" ? 1 : 0}">${esc(r.sure.display)}</span>` : ""}<span class="mb-why">${esc(why)}</span></button></li>`;
}
/* Reserved room, so a re-sort moves no box: each column keeps the size of
   every card it can hold at any setting the controls reach (each in its
   tallest form), from an inert copy laid in the same cell as its list, and
   the note keeps the size of its longest text. */
function board(d, o) {
  const S = defaults(d), lv = d.labels.levels, id = esc(o.id), cols = {}, room = {};
  BLANES.forEach((l) => ((cols[l] = []), (room[l] = new Map())));
  for (const t of d.traces) if (!isOff(t, S)) { const r = decide(t, S, d); cols[r.lane].push(boardCard(d, t, r, whyOf(id0(t), S))); }
  for (const s of reach(d, S)) for (const t of d.traces) if (!isOff(t, s)) {
    const m = room[decide(t, s, d).lane];
    m.set(t, m.get(t) || whyOf(id0(t), s));
  }
  const sizer = (l) => {
    const m = room[l], fixed = m.size == cols[l].length && [...m.values()].every((w) => !w);
    return fixed ? "" : `<ul class="mb-list mb-sz" aria-hidden="true" inert>${d.traces.filter((t) => m.has(t)).map((t) => boardCard(d, t, decide(t, S, d), m.get(t), true)).join("")}</ul>`;
  };
  const longest = [1, 2, 3].map((n) => levelNote(d, n)).concat(COPY.suppOff).reduce((a, b) => (b.length > a.length ? b : a));
  return `<div class="mb-ctrl">${levels(d, S, false)}${bar(d, S)}${supp(S)}${lock(d, `${id}-tip-k`)}</div>` +
    `<p class="mb-note" aria-hidden="true"><span>${esc(lv[S.level].summary)}</span><span class="mb-sz">${esc(longest)}</span></p>` +
    `<div class="mb-cols">${BLANES.map((l) => `<section class="mb-col" data-lane="${l}" aria-labelledby="${id}-h-${l}"><p class="mb-ch" id="${id}-h-${l}">${U.lane(d, l)}<span class="mb-n">${cols[l].length}</span></p><ul class="mb-list">${cols[l].join("")}</ul>${sizer(l)}</section>`).join("")}</div>` +
    `<p class="mb-diff"></p><p class="mb-tot">${esc(totals(d, S))}</p>` +
    `<div class="sc-strip"><span class="sc-sample">${esc(d.labels.chip)}</span><span>${esc(d.labels.rates)}</span>${d.labels.subscribers ? `<span>${esc(d.labels.subscribers)}</span>` : ""}</div>` +
    cta(o);
}

/** The root's inner HTML: the field or the board's first frame. */
export function renderStatic(d, o) {
  return o.kind == "board" ? board(d, o) : field(d, o);
}
