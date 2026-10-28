/* The decision anatomy's first frame (/trainer-brain, "How it decides"): one
   sample reply taken apart into nine plates, from (a) the message to (i)
   what the member reads, with the margin notes (a)–(j), the trainer's
   rulebook, other members' moments and the What-if row. Pure: no CSS, no
   DOM; the runtime (anatomy.js) re-renders the plates from here for a
   What-if.

   Ported from the approved prototype's static half (docs/marketing-revamp-
   2026-10-26/prototypes/concept-c/src/showcase/c-anatomy.js) with the
   changes of docs/marketing-revamp-2026-10-26/phase1/PLAN.md §1.1 and WP3a:
   - the root's inner HTML only: the root comes from renderShowcase, the
     page supplies the skip link and, with heading: false, the H2; there is
     no live region (the runtime announces through the overlay layer's);
   - every inner id starts with the host id (o.id), so a note link reads
     #<id>-b;
   - re-skinned to the site's tokens: no section or figure numbers;
   - the first frame is the finished figure (every plate lit), so visitors
     who never get the engine (no JavaScript, reduced motion, crawlers,
     static mode) read all of it; its buttons wait, disabled, for the
     engine;
   - the rulebook, the card and the lanes read the sample trainer's data
     (defaults(), the traces), not literals. */
import { esc } from "./core.js";
import { decide, defaults, pick } from "./decide.js";
import * as U from "./ui.js";

/** The root element's classes for each kind this module renders (render.ts). */
export const ROOT = { anatomy: "ca sc-stage" };

export const COPY = {
  eyebrow: "How it decides",
  h2: "Anatomy of one decision",
  lede: "One reply, taken apart. Fixed checks before and after. One AI specialist in the middle. Your rules at every layer.",
  cap: "Omar asks to go up in weight. Sample, scripted, no AI model called.",
  hint: "Scroll to take it apart", first: "Checks first · your rules", after: "Checks after · your rules",
  book: ["Your method", "rules (sample)"], cites: ["finds your rule", "cites your rule", "your level"],
  j: ["Add", "5 kg", "2.5 kg", "next time.", "Learner suggests", "Confirmed", "About a minute later: check passed · live"],
  whatIf: [["knee", "What if his knee popped?", "t2", null], ["plan", "What if it’s a plan change?", "t8", null], ["level1", "What if you’re at level 1?", "t1", 1]],
  back: "Omar’s reply", tryAnother: "Try another moment", pause: "Pause", play: "Play",
  meanwhile: "Meanwhile: other members, one specialist each",
  ghosts: "Meanwhile, other members’ moments run at the same time. One specialist each.",
  sr: "A sample figure, taken apart in layers. Omar’s message passes four code checks, then one AI specialist that code picks, then more code checks, and is sent on its own, within your rules. The notes list every layer.",
};
/* The margin notes (SHOWCASE_DESIGN.md §6 C), (a)–(j). The trace test checks
   their numbers against the code (tests/marketing-brain-traces.test.ts). */
export const NOTES = {
  a: ["The message", "Omar logged four sets with 2 reps in reserve. He asks to go up."],
  b: ["Safety rules", "Read first, every time. Pain or red flags stop here. Nine kinds, in English and Arabic."],
  c: ["Your topics", "Topics you chose to answer yourself, like supplements. Not this one."],
  d: ["Memory", "His intake and his last 28 days of training. Facts from your app only."],
  e: ["Rule finder", "Which approved replies fit? One: +2.5 kg. That’s 4.2%, inside your 5% cap."],
  f: ["One specialist", "Seven coaching specialists. One is not on yet. Code picks one from the kind of moment. A rule fits, so it’s the Reply picker. It picks. It never writes."],
  g: ["Checks after", "Does it cite your rule? Only facts it was shown? Nothing changed meanwhile? All pass."],
  h: ["The lane", "Your Brain is at level 2 and passed its last check. So it sends on its own."],
  i: ["What Omar reads", "Your words, plus one line of numbers from your rule. No AI wording."],
  j: ["Your correction", "Edit any reply. Your AI suggests a rule. You confirm. About a minute later, your AI answers your test cases and code marks them. It goes live only if they pass."],
};
export const LET = "abcdefghij";
/* What code can pick from, each with its moment (SHOWCASE_DESIGN.md §4 (f));
   the coaching specialists not on yet sit on the shelf beside them. */
const COACH = [["reply_picker", "a rule fits"], ["draft_writer", "no rule fits"], ["plan_writer", "new plan"], ["week_reviewer", "week ends"], ["meal_photo", "meal photo"], ["voice_lines", "before a voice session"], ["set_logger", "during a workout"]];
/* Other members' moments (the ghost stacks): trace, moment, shown on phones. Each lights only its own node. */
export const GHOSTS = [["t8", "week ends", 1], ["t2", "knee", 1], ["t4", "meal photo", 1], ["t9", "creatine", 0], ["t10", "first plan", 0]];

/* ------------------------------------------------------------------ model */
export const stepOf = (r, sp) => r.steps.find((s) => s.sp == sp);
const kindTag = (t, r) => t.decide == "plan" ? (t.channel == "week_end" ? "Week ends" : "New plan") : r.steps.some((s) => s.sp == "draft_writer") ? "Chat · no rule fits" : t.decide == "chat_action" || t.decide == "chat_review" ? "Chat · a rule fits" : "Chat";
const hl = (text, words, cls = "ca-hit") => { let s = esc(text); for (const w of words || []) s = s.split(esc(w)).join(`<mark class="${cls}">${esc(w)}</mark>`); return s; };
/** Nine plates (a)–(i) for a trace under settings S. */
export function model(d, t, S) {
  const r = decide(t, S, d), stop = (stepOf(r, "safety") || {}).result == "hit", pk = pick(t, d, S), lanes = d.labels.lanes;
  const chk = (k, sp, name, stat) => {
    const s = stepOf(r, sp);
    if (!s) return { k, name, kind: "check", state: "na", stat: "—", say: "Not part of this moment." };
    if (s.result == "skipped") return { k, name, kind: "check", state: "skip", stat: "Not reached", say: "Not reached · no AI called" };
    const state = s.result == "hit" ? "hit" : s.result == "warn" ? "warn" : "pass";
    return { k, name, kind: "check", state, stat: stat(s), say: s.say, s };
  };
  const after = r.steps.filter((s) => s.sp == "checker" || s.sp == "confidence"), ck = stepOf(r, "checker"), gate = stepOf(r, "lane_gate");
  const ai = pk && stepOf(r, pk), out = ai && ai.out ? ai.out.reason || ai.out.change || ai.out.plan || ai.say : "";
  return { t, r, stop, pick: pk, tag: kindTag(t, r), plates: [
    { k: "a", name: "The message", kind: "msg", state: "pass", stat: `${t.member} · ${t.when}`, say: t.trigger.text },
    chk("b", "safety", "Safety rules", (s) => (s.result == "hit" ? "STOP" : "Clear")),
    chk("c", "topics", "Your topics", (s) => (s.result == "hit" ? "Your topic" : "Not yours")),
    chk("d", "memory", "Memory", () => "Read"),
    chk("e", "rule_finder", "Rule finder", (s) => (s.result != "found" ? "None fits" : t.decide == "chat_action" ? "1 fits" : "Found")),
    { k: "f", name: "Your Brain", kind: "ai", state: ai ? "lit" : "skip", stat: ai ? d.sp[pk].name : stop ? "Not reached" : d.labels.noAi, say: ai ? ai.say : "Not reached · no AI called", out, basis: ai && ai.basis },
    after.length ? { k: "g", name: "Checks after", kind: "check", state: after.some((s) => s.result == "warn") ? "warn" : "pass", stat: r.sure ? r.sure.display : "All pass", say: ck ? ck.say : after[0].say }
      : { k: "g", name: "Checks after", kind: "check", state: stop ? "skip" : "na", stat: stop ? "Not reached" : "—", say: stop ? "Not reached · no AI called" : "Not part of this moment." },
    { k: "h", name: "Lane gate", kind: "check", state: r.lane, stat: lanes[r.lane], say: gate ? gate.say : lanes[r.lane] },
    { k: "i", name: r.memberSees ? `What ${t.member} reads` : "What you see", kind: "msg", state: r.lane,
      stat: !r.memberSees ? "Your Today" : r.lane == "paused" ? "Safety notice" : r.memberSees.parts.some((x) => x.by == "ai") ? "AI words marked" : "No AI wording" },
  ] };
}
/** A plate the trace never reaches, or no part of it: its matrix stays dark. */
export const dark = (p) => p.state == "skip" || p.state == "na";

/* ------------------------------------------------------------------ markup */
/** Activity matrix, 3×3 dots (round: AI and messages, square: code); on: all lit. */
const MX = (kind, on) => `<span class="ca-mx" data-kind="${kind}" aria-hidden="true">${(on ? '<i class="on"></i>' : "<i></i>").repeat(9)}</span>`;
const TICK = U.icon("check", 14), STOPI = U.icon("octagon-x", 14);
const chip = (d, lane) => U.lane(d, lane, "ca-lane");
function statHTML(d, p) {
  if (p.k == "h") return chip(d, p.state);
  if (p.k == "a") return `<span class="ca-st ca-st--m">${esc(p.stat)}</span>`;
  const ic = p.state == "hit" ? STOPI : p.state == "pass" || p.state == "lit" ? TICK : "";
  return `<span class="ca-st" data-s="${p.state}">${ic}${esc(p.stat)}</span>`;
}
function memberHTML(d, M) {
  const { r } = M;
  if (r.memberSees) {
    const ai = r.memberSees.parts.some((x) => x.by == "ai");
    return `<div class="ca-ph"><p class="ca-phm">${r.memberSees.parts.map(U.marks).join(" ")}</p>${!ai && r.lane != "paused" ? `<span class="ph-noai">AI words: none</span>` : ""}</div>`;
  }
  const s = r.trainerSees || {};
  return `<div class="ca-ph ca-ph--td"><p class="ca-tdh"><span class="ph-av">LS</span>${esc(s.where || "Today")}</p><p class="ca-tdt">${esc(s.title || "")}</p><p class="ca-tdr">${esc(r.reasons ? r.reasons[0] : s.detail || "")}</p></div>`;
}
const dirOf = (t) => (t.trigger.lang == "ar" ? ' dir="rtl" lang="ar"' : "");
function moreHTML(d, M, p, S) {
  const { t, r } = M;
  switch (p.k) {
    case "a": return `<div class="ca-bub"><span class="ca-av">${esc(t.member[0])}</span><div><p${dirOf(t)}>${esc(t.trigger.text)}</p><small>${esc(t.member)} · ${esc(t.channel.replace(/_/g, " "))} · ${esc(t.when)} · sample</small></div></div>`;
    case "b": {
      const s = p.s || {};
      return `<p class="ca-scan${p.state == "hit" ? " is-hit" : ""}"${dirOf(t)}>${s.highlight ? hl(t.trigger.text, s.highlight) : `<span class="ca-sweep">${esc(t.trigger.text)}</span>`}</p><p class="ca-res">${p.state == "hit" ? `<b class="ca-stopw">STOP · No AI called</b> ` : ""}${esc(p.say)}</p>`;
    }
    case "e": return p.s && p.s.detail ? `<ul class="ca-rows">${p.s.detail.map((x, n) => `<li style="--n:${n}">${TICK}${esc(x.replace(/ ✓$/, ""))}</li>`).join("")}</ul><p class="ca-rule">${U.icon("quote", 14)}Your rule: <b>${esc(t.rule ? t.rule.title : "")}</b></p>` : `<p>${esc(p.say)}</p>`;
    case "f": return p.out ? `<p class="ca-why"><span class="ca-k">${p.basis ? esc(d.labels.basis[p.basis]) : "Reason"}</span><span class="ca-rs" data-full="${esc(p.out)}">${esc(p.out)}</span></p>` : `<p class="ca-why">${esc(p.say)}</p>`;
    case "g": {
      if (dark(p)) return `<p>${esc(p.say)}</p>`;
      const rows = String(p.say).split(" · ").map((x, n) => `<li style="--n:${n}">${/warning/.test(x) ? "" : TICK}${esc(x.replace(/ ✓$/, ""))}</li>`).join("");
      return `<ul class="ca-rows">${rows}</ul>${r.sure ? U.sure(d, t, r) : `<p class="ca-nos">${esc(d.labels.noChatScore)}</p>`}`;
    }
    case "h": return `<p>${esc(p.say)}</p>${t.decide == "chat_action" ? `<p class="ca-lv">Brain level ${S.level} · ${esc(d.labels.levels[S.level].name)} · Last check: passed (sample)</p>` : M.stop ? `<p class="ca-lv">${U.icon("lock", 14)}Safety rules · can’t switch off</p>` : ""}`;
    case "i": return `<div class="ph-key"><span><mark class="pv-you">Your words</mark></span><span><span class="pv-num">Numbers from your rule</span></span><span><span class="pv-ai">AI words</span></span></div>`;
    default: return `<p>${esc(p.say)}</p>`;
  }
}
/* (f) has two layouts: the compact row in the stack and the labelled grid
   when inspected. The grid is an overlay (.ca-x) that crossfades in, so the
   plate never reflows (no layout shift, no transform-origin jump); the
   drawer (.ca-more) hangs under the overlay. */
function brainHTML(d, M, more) {
  const pills = (x) => COACH.map(([sp, m]) => {
    const s = d.sp[sp], on = sp == M.pick;
    return `<span class="ca-sp" data-sp="${sp}" data-kind="${s.kind}"${on ? " data-pick" : ""}>${on ? MX(s.kind, true) : ""}${U.icon(s.icon, 14)}<b>${esc(s.name)}</b>${x ? `<small>${esc(m)}</small>${on ? `<em class="ca-tag">${esc(M.tag)}</em>` : ""}` : ""}</span>`;
  }).join("");
  const shelf = d.specialists.filter((s) => s.crew == "coach" && s.status == "not_on_yet")
    .map((s) => `<span class="ca-shelf">${U.icon(s.icon, 13)}${esc(s.name)} · ${esc(d.labels.status.not_on_yet)}</span>`).join("");
  return `<div class="ca-shell">${pills(0)}</div>${shelf}<div class="ca-x"><p class="ca-picks ca-xpick">${esc(d.labels.picks)}</p><div class="ca-shell">${pills(1)}</div>${shelf}${more}</div>`;
}
/** One plate, lit (the finished figure: the runtime dims and relights it). */
export function plateHTML(d, M, p, i, S) {
  const brain = p.k == "f", more = `<div class="ca-more">${moreHTML(d, M, p, S)}</div>`;
  return `<div class="ca-p${brain ? " ca-brain" : ""}" data-k="${p.k}" data-kind="${p.kind}" data-state="${p.state}" data-lit style="--i:${i}">` +
    `<div class="ca-f">${brain ? `<span class="ca-mono">LS</span>` : MX(p.kind, !dark(p))}<span class="ca-l">(${p.k})</span><b class="ca-n">${esc(p.name)}</b>` +
    `<span class="ca-kt">${brain ? "Code picks one specialist per moment" : p.kind == "check" ? "Code, no AI" : ""}</span>${statHTML(d, p)}</div>` +
    (brain ? brainHTML(d, M, more) : (p.k == "i" ? memberHTML(d, M) : `<p class="ca-s"${p.k == "a" ? dirOf(M.t) : ""}>${p.k == "a" && M.stop ? hl(p.say, stepOf(M.r, "safety").highlight) : esc(p.say)}</p>`) + more) +
    `<p class="ca-pn">${esc(NOTES[p.k][1])}</p></div>`;
}
export const stackHTML = (d, M, S) => M.plates.map((p, i) => plateHTML(d, M, p, i, S)).join("");
function ghostHTML(d, S) {
  return GHOSTS.map(([id, moment, ph], g) => {
    const t = d.trace(id), r = decide(t, S, d), pk = pick(t, d, S), stop = (stepOf(r, "safety") || {}).result == "hit", topic = (stepOf(r, "topics") || {}).result == "hit";
    return `<div class="ca-g" data-g="${g}"${ph ? "" : " data-desk"} data-run="4"><span class="ca-gl">${esc(t.member)} · ${esc(moment)}</span><div class="ca-gs">` +
      `<i data-k="m"></i><i data-k="c"${stop ? " data-hit" : topic ? " data-amber" : ""}><b>${stop ? "STOP · No AI called" : topic ? "Your topic" : ""}</b></i>` +
      `<i data-k="s"${pk ? "" : " data-none"}><b>${esc(pk ? d.sp[pk].name : d.labels.noAi)}</b></i><i data-k="l" data-lane="${r.lane}"><b>${esc(d.labels.lanes[r.lane].replace(", within your rules", ""))}</b></i></div></div>`;
  }).join("");
}
/** The trainer's rulebook (a product surface), with (j) the correction in it. */
function bookHTML(d, S, t) {
  const j = COPY.j, edit = d.trace("t7");
  return `<div class="ca-book"><p class="ca-bk">${esc(COPY.book[0])}</p><p class="ca-bn"><span class="ca-bc"><span>24</span><span>25</span></span> ${esc(COPY.book[1])}</p>` +
    `<p class="ca-bcite"><mark>${esc(t.rule.title)}</mark></p><p class="ca-blv">Brain level ${S.level} · ${esc(d.labels.levels[S.level].name)}</p>` +
    `<div class="ca-bj"><p class="ca-bj1"><small>You edit ${esc(edit.member)}’s draft</small>“${esc(j[0])} <s>${esc(j[1])}</s> <ins>${esc(j[2])}</ins> ${esc(j[3])}”</p>` +
    `<p class="ca-bj2"><small>${esc(j[4])}</small><b>${esc(edit.rule.title)}</b><span class="ca-stamp">${esc(j[5])}</span></p><p class="ca-bj3">${TICK}${esc(j[6])}</p></div></div>`;
}

/** The root's inner HTML: Omar's reply (t1) under the sample trainer's settings. */
export function renderStatic(d, o) {
  const S = defaults(d), t = d.trace("t1"), M = model(d, t, S), id = esc(o.id);
  const head = o.heading === false ? "" : `<header class="ca-head"><p class="ca-eb">${esc(COPY.eyebrow)}</p><h2 class="ca-h2" id="${id}-h">${esc(COPY.h2)}</h2><p class="ca-lede">${esc(COPY.lede)}</p></header>`;
  const notes = LET.split("").map((k) => `<li data-k="${k}" id="${id}-${k}"><button type="button" class="ca-nb" data-k="${k}" disabled><span class="ca-l">(${k})</span><b>${esc(NOTES[k][0])}</b></button><div class="ca-nt"><p>${esc(NOTES[k][1])}${k == "f" ? `<em>${esc(d.labels.picks)}</em><small>${esc(COPY.ghosts)}</small>` : ""}</p></div></li>`).join("");
  const whatIf = COPY.whatIf.map(([k, l]) => `<button type="button" class="ca-wb" data-w="${k}" aria-pressed="false" disabled>${esc(l)}</button>`).join("") +
    `<button type="button" class="ca-wb" data-w="base" aria-pressed="true" disabled>${esc(COPY.back)}</button>`;
  return `<div class="ca-frame"><div class="ca-grid">` +
    `<div class="ca-scene" dir="ltr" aria-hidden="true">` +
    `<div class="ca-ghosts">${ghostHTML(d, S)}</div>` +
    `<div class="ca-cam"><div class="ca-stack">${stackHTML(d, M, S)}</div></div>` +
    `<div class="ca-card"><span class="ph-av">LS</span><div><b>Answered ${esc(t.member)}</b><small>Feed · ${esc(t.when)} · sample</small></div>${chip(d, M.r.lane)}</div>` +
    bookHTML(d, S, t) +
    `<span class="ca-brk" data-b="1">${esc(COPY.first)}</span><span class="ca-brk" data-b="2">${esc(COPY.after)}</span>` +
    `<span class="ca-cite" data-c="e">${esc(COPY.cites[0])}</span><span class="ca-cite" data-c="g">${esc(COPY.cites[1])}</span><span class="ca-cite" data-c="h">${esc(COPY.cites[2])}</span>` +
    `<span class="ca-mean">${esc(COPY.meanwhile)}</span><b class="ca-stop">STOP · No AI called</b></div>` +
    `<svg class="ca-svg" aria-hidden="true" focusable="false"><path class="ca-thr"/><path class="ca-thr ca-thr--on" pathLength="1"/><path class="ca-rl" data-r="e"/><path class="ca-rl" data-r="g"/><path class="ca-rl" data-r="h"/><path class="ca-br" data-b="1"/><path class="ca-br" data-b="2"/><path class="ca-lead"/><circle class="ca-halo" r="14"/><circle class="ca-dot" r="4.5"/></svg>` +
    `<div class="ca-side">${head}<div class="ca-notes"><p class="ca-hint">${U.icon("chevron-down", 14)}${esc(COPY.hint)}</p><ol class="ca-nl">${notes}</ol><p class="ca-dots" aria-hidden="true">${"<i></i>".repeat(6)}</p></div>` +
    `<div class="ca-wi" role="group" aria-label="${esc(COPY.tryAnother)}">${whatIf}</div></div>` +
    `<div class="ca-foot"><p class="ca-cap">${esc(COPY.cap)}</p>${U.strip(d)}<button type="button" class="ca-pause" aria-pressed="false" disabled>${U.icon("pause", 14)}<span data-label>${esc(COPY.pause)}</span></button></div>` +
    `</div></div><p class="sc-sr">${esc(COPY.sr)}</p>`;
}
