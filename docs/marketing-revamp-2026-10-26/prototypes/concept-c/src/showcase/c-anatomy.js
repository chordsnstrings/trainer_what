/* trainsyou · Concept C "The Method" · Anatomy of a decision (spec §4).
   Universal ES module. render(d, o) returns the whole section as HTML (the
   Node generator writes it, so the first frame is real HTML); mount(el)
   adds the 1.2 s burst, the message pulse, the ambient "meanwhile" stacks,
   the pinned scroll steps (a)–(j) and the What-if replays. One rAF loop
   (brain-core), no libraries, no canvas, no infinite CSS animation. */
import * as Core from "./brain/brain-core.js";
import * as Dec from "./brain/brain-decide.js";
import * as U from "./brain/brain-ui.js";
const B = { ...Core, ...Dec }, { esc } = Core;

export const COPY = {
  eyebrow: "How it decides", h2: "Anatomy of one decision",
  lede: "One reply, taken apart. Fixed checks before and after. One AI specialist in the middle. Your rules at every layer.",
  cap: (n) => `Fig. ${n} — Omar asks to go up in weight. Sample, scripted, no AI model called.`,
  hint: "Scroll to take it apart", first: "Checks first · your rules", after: "Checks after · your rules",
  book: ["Your method", "rules (sample)"], cites: ["finds your rule", "cites your rule", "your level"],
  j: ["You edit Zayed’s draft", "Add", "5 kg", "2.5 kg", "next time.", "Learner suggests", "Upper body increments", "Confirmed", "About a minute later: check passed · live"],
  whatIf: [["knee", "What if his knee popped?", "t2", null], ["plan", "What if it’s a plan change?", "t8", null], ["level1", "What if you’re at level 1?", "t1", 1]],
  back: "Omar’s reply", skip: "Skip the animated figure", meanwhile: "Meanwhile: other members, one specialist each",
  ghosts: "Meanwhile, other members’ moments run at the same time. One specialist each.",
  sr: "A sample figure, taken apart in layers. Omar’s message passes four code checks, then one AI specialist that code picks, then more code checks, and is sent on its own, within your rules. The notes list every layer.",
};
/* C's margin notes (spec §6 C), (a)–(j). */
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
const LET = "abcdefghij";
/* The seven coaching specialists, each with its moment (spec §4 (f)); Meal planner sits on the "Not on yet" shelf. */
const COACH = [["reply_picker", "a rule fits"], ["draft_writer", "no rule fits"], ["plan_writer", "new plan"], ["week_reviewer", "week ends"], ["meal_photo", "meal photo"], ["voice_lines", "before a voice session"], ["set_logger", "during a workout"]];
/* Other members' moments (ghost stacks): trace, label, phone? Each lights only its own node. */
const GHOSTS = [["t8", "Aisha · week ends", 1], ["t2", "Noura · knee", 1], ["t4", "Priya · meal photo", 1], ["t9", "Khalid · creatine", 0], ["t10", "Fatima · first plan", 0]];
const LANE = { sent: "Sent on its own, within your rules", waits: "Waits for you", paused: "Training paused", member: "The member confirms", learn: "New rule for you" };
const RX = 56, RZ = -32, PERSP = 1600;

/* ------------------------------------------------------------------ model */
const stepOf = (r, sp) => r.steps.find((s) => s.sp == sp);
const kindTag = (t, r) => t.decide == "plan" ? (t.channel == "week_end" ? "Week ends" : "New plan") : r.steps.some((s) => s.sp == "draft_writer") ? "Chat · no rule fits" : t.decide == "chat_action" || t.decide == "chat_review" ? "Chat · a rule fits" : "Chat";
const hl = (text, words, cls = "ca-hit") => { let s = esc(text); for (const w of words || []) s = s.split(esc(w)).join(`<mark class="${cls}">${esc(w)}</mark>`); return s; };
/** Nine plates (a)–(i) for a trace under settings S. */
export function model(d, t, S) {
  const r = B.decide(t, S, d), stop = (stepOf(r, "safety") || {}).result == "hit", pk = B.pick(t, d, S);
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
    { k: "f", name: "Your Brain", kind: "ai", state: pk ? "lit" : "skip", stat: pk ? d.sp[pk].name : stop ? "Not reached" : d.labels.noAi, say: pk ? ai.say : "Not reached · no AI called", out, basis: ai && ai.basis },
    after.length ? { k: "g", name: "Checks after", kind: "check", state: after.some((s) => s.result == "warn") ? "warn" : "pass", stat: r.sure ? r.sure.display : "All pass", say: ck ? ck.say : after[0].say }
      : { k: "g", name: "Checks after", kind: "check", state: stop ? "skip" : "na", stat: stop ? "Not reached" : "—", say: stop ? "Not reached · no AI called" : "Not part of this moment." },
    { k: "h", name: "Lane gate", kind: "check", state: r.lane, stat: LANE[r.lane], say: gate ? gate.say : LANE[r.lane] },
    { k: "i", name: r.memberSees ? `What ${t.member} reads` : "What you see", kind: "msg", state: r.lane,
      stat: !r.memberSees ? "Your Today" : r.lane == "paused" ? "Safety notice" : r.memberSees.parts.some((x) => x.by == "ai") ? "AI words marked" : "No AI wording" },
  ] };
}

/* ------------------------------------------------------------------ markup */
const MX = (kind) => `<span class="ca-mx" data-kind="${kind}" aria-hidden="true">${"<i></i>".repeat(9)}</span>`;
const TICK = U.icon("check", 14), STOPI = U.icon("octagon-x", 14);
const chip = (lane) => `<span class="ca-lane" data-lane="${lane}">${esc(LANE[lane])}</span>`;
function statHTML(p) {
  if (p.k == "h") return chip(p.state);
  if (p.k == "a") return `<span class="ca-st ca-st--m">${esc(p.stat)}</span>`;
  const ic = p.state == "hit" ? STOPI : p.state == "pass" || p.state == "lit" ? TICK : "";
  return `<span class="ca-st" data-s="${p.state}">${ic}${esc(p.stat)}</span>`;
}
function memberHTML(d, M) {
  const { t, r } = M;
  if (r.memberSees) {
    const ai = r.memberSees.parts.some((x) => x.by == "ai");
    return `<div class="ca-ph"><p class="ca-phm">${r.memberSees.parts.map(U.marks).join(" ")}</p>${!ai && r.lane != "paused" ? `<span class="ph-noai">AI words: none</span>` : ""}</div>`;
  }
  const s = r.trainerSees || {};
  return `<div class="ca-ph ca-ph--td"><p class="ca-tdh"><span class="ph-av">LS</span>${esc(s.where || "Today")}</p><p class="ca-tdt">${esc(s.title || "")}</p>${r.reasons ? `<p class="ca-tdr">${esc(r.reasons[0])}</p>` : `<p class="ca-tdr">${esc(s.detail || "")}</p>`}</div>`;
}
function moreHTML(d, M, p, S) {
  const { t, r } = M;
  switch (p.k) {
    case "a": return `<div class="ca-bub"><span class="ca-av">${esc(t.member[0])}</span><div><p${t.trigger.lang == "ar" ? ' dir="rtl" lang="ar"' : ""}>${esc(t.trigger.text)}</p><small>${esc(t.member)} · ${esc(t.channel.replace(/_/g, " "))} · ${esc(t.when)} · sample</small></div></div>`;
    case "b": {
      const s = p.s || {};
      return `<p class="ca-scan${p.state == "hit" ? " is-hit" : ""}">${s.highlight ? hl(t.trigger.text, s.highlight) : `<span class="ca-sweep">${esc(t.trigger.text)}</span>`}</p><p class="ca-res">${p.state == "hit" ? `<b class="ca-stopw">STOP · No AI called</b> ` : ""}${esc(p.say)}</p>`;
    }
    case "e": return p.s && p.s.detail ? `<ul class="ca-rows">${p.s.detail.map((x, n) => `<li style="--n:${n}">${TICK}${esc(x.replace(/ ✓$/, ""))}</li>`).join("")}</ul><p class="ca-rule">${U.icon("quote", 14)}Your rule: <b>${esc(t.rule ? t.rule.title : "")}</b></p>` : `<p>${esc(p.say)}</p>`;
    case "f": return `${p.out ? `<p class="ca-why"><span class="ca-k">${p.basis ? esc(d.labels.basis[p.basis]) : "Reason"}</span><span class="ca-rs" data-full="${esc(p.out)}">${esc(p.out)}</span></p>` : `<p class="ca-why">${esc(p.say)}</p>`}`;
    case "g": {
      if (p.state == "skip" || p.state == "na") return `<p>${esc(p.say)}</p>`;
      const rows = String(p.say).split(" · ").map((x, n) => `<li style="--n:${n}">${/warning/.test(x) ? "" : TICK}${esc(x.replace(/ ✓$/, ""))}</li>`).join("");
      return `<ul class="ca-rows">${rows}</ul>${r.sure ? U.sure(d, t, r) : `<p class="ca-nos">${esc(d.labels.noChatScore)}</p>`}`;
    }
    case "h": return `<p>${esc(p.say)}</p>${t.decide == "chat_action" ? `<p class="ca-lv">Brain level ${S.level} · ${esc(d.labels.levels[S.level].name)} · Last check: passed (sample)</p>` : M.stop ? `<p class="ca-lv">${U.icon("lock", 14)}Safety rules · can’t switch off</p>` : ""}`;
    case "i": return `<div class="ph-key"><span><mark class="pv-you">Your words</mark></span><span><span class="pv-num">Numbers from your rule</span></span><span><span class="pv-ai">AI words</span></span></div>`;
    default: return `<p>${esc(p.say)}</p>`;
  }
}
/* (f) has two layouts: the compact row in the stack and the labelled grid when inspected.
   The grid is an overlay (.ca-x) that crossfades in, so the plate never reflows (no layout
   shift, no transform-origin jump); the drawer (.ca-more) hangs under the overlay. */
function brainHTML(d, M, more) {
  const pills = (x) => COACH.map(([sp, m]) => {
    const s = d.sp[sp], on = sp == M.pick;
    return `<span class="ca-sp" data-sp="${sp}" data-kind="${s.kind}"${on ? " data-on" : ""}>${on ? MX(s.kind) : ""}${U.icon(s.icon, 14)}<b>${esc(s.name)}</b>${x ? `<small>${esc(m)}</small>${on ? `<em class="ca-tag">${esc(M.tag)}</em>` : ""}` : ""}</span>`;
  }).join("");
  const shelf = `<span class="ca-shelf">${U.icon("utensils", 13)}${esc(d.sp.meal_planner.name)} · ${esc(d.labels.status.not_on_yet)}</span>`;
  return `<div class="ca-shell">${pills(0)}</div>${shelf}<div class="ca-x"><p class="ca-picks ca-xpick">${esc(d.labels.picks)}</p><div class="ca-shell">${pills(1)}</div>${shelf}${more}</div>`;
}
export function plateHTML(d, M, p, i, S, notes) {
  const brain = p.k == "f", more = `<div class="ca-more">${moreHTML(d, M, p, S)}</div>`;
  return `<div class="ca-p${brain ? " ca-brain" : ""}" data-k="${p.k}" data-kind="${p.kind}" data-state="${p.state}" style="--i:${i}">` +
    `<div class="ca-f">${brain ? `<span class="ca-mono">LS</span>` : MX(p.kind)}<span class="ca-l">(${p.k})</span><b class="ca-n">${esc(p.name)}</b>` +
    `<span class="ca-kt">${brain ? "Code picks one specialist per moment" : p.kind == "check" ? "Code, no AI" : ""}</span>${statHTML(p)}</div>` +
    (brain ? brainHTML(d, M, more) : (p.k == "i" ? memberHTML(d, M) : `<p class="ca-s"${p.k == "a" && M.t.trigger.lang == "ar" ? ' dir="rtl" lang="ar"' : ""}>${p.k == "a" && M.stop ? hl(p.say, stepOf(M.r, "safety").highlight) : esc(p.say)}</p>`) + more) +
    `<p class="ca-pn"><i>Fig. ${notes.fig}${p.k}</i> ${esc(NOTES[p.k][1])}</p></div>`;
}
const stackHTML = (d, M, S, o) => M.plates.map((p, i) => plateHTML(d, M, p, i, S, o)).join("");
function ghostHTML(d, S) {
  return GHOSTS.map(([id, label, ph], g) => {
    const t = d.trace(id), r = B.decide(t, S, d), pk = B.pick(t, d, S), stop = (stepOf(r, "safety") || {}).result == "hit", topic = (stepOf(r, "topics") || {}).result == "hit";
    return `<div class="ca-g" data-g="${g}"${ph ? "" : " data-desk"} data-run="4"><span class="ca-gl">${esc(label)}</span><div class="ca-gs">` +
      `<i data-k="m"></i><i data-k="c"${stop ? ' data-hit' : topic ? ' data-amber' : ""}><b>${stop ? "STOP · No AI called" : topic ? "Your topic" : ""}</b></i>` +
      `<i data-k="s"${pk ? "" : " data-none"}><b>${esc(pk ? d.sp[pk].name : d.labels.noAi)}</b></i><i data-k="l" data-lane="${r.lane}"><b>${esc(LANE[r.lane].replace(", within your rules", ""))}</b></i></div></div>`;
  }).join("");
}
function bookHTML(d) {
  const j = COPY.j;
  return `<div class="ca-book"><p class="ca-bk">${esc(COPY.book[0])}</p><p class="ca-bn"><span class="ca-bc" data-a="24" data-b="25"><span>24</span><span>25</span></span> ${esc(COPY.book[1])}</p>` +
    `<p class="ca-bcite"><mark>Barbell load progression</mark></p><p class="ca-blv">Brain level 2 · Routine replies</p>` +
    `<div class="ca-bj"><p class="ca-bj1"><small>${esc(j[0])}</small>“${esc(j[1])} <s>${esc(j[2])}</s> <ins>${esc(j[3])}</ins> ${esc(j[4])}”</p>` +
    `<p class="ca-bj2"><small>${esc(j[5])}</small><b>${esc(j[6])}</b><span class="ca-stamp">${esc(j[7])}</span></p><p class="ca-bj3">${TICK}${esc(j[8])}</p></div></div>`;
}

/** The whole section. o: {n (section number), fig (figure number), id, cta}. */
export function render(d, o = {}) {
  Core.index(d);
  const S = B.defaults(d), M = model(d, d.trace("t1"), S), n = o.n || 1, fig = o.fig || n, hid = (o.id || "anatomy") + "-h";
  const notes = { fig };
  const noteLis = LET.split("").map((k) => `<li data-k="${k}" id="fig-${fig}${k}"><button type="button" class="ca-nb" data-k="${k}"><span class="ca-l">(${k})</span><b>${esc(NOTES[k][0])}</b></button><div class="ca-nt"><p>${esc(NOTES[k][1])}${k == "f" ? `<em>${esc(d.labels.picks)}</em><small>${esc(COPY.ghosts)}</small>` : ""}</p></div></li>`).join("");
  return `<section class="ca" id="${esc(o.id || "anatomy")}" data-showcase="anatomy" data-sc-module="assets/c-anatomy.js" data-sc="pre" data-fig="${fig}" aria-labelledby="${hid}">
<div class="ca-frame"><a class="skip ca-skip" href="#${esc(o.id || "anatomy")}-after">${esc(COPY.skip)}</a><div class="ca-grid wrap">
  <div class="ca-scene" aria-hidden="true">
    <div class="ca-ghosts">${ghostHTML(d, S)}</div>
    <div class="ca-cam"><div class="ca-stack">${stackHTML(d, M, S, notes)}</div></div>
    <div class="ca-card"><span class="ph-av">LS</span><div><b>Answered Omar</b><small>Feed · 18:40 · sample</small></div>${chip("sent")}</div>
    ${bookHTML(d)}
    <span class="ca-brk" data-b="1">${esc(COPY.first)}</span><span class="ca-brk" data-b="2">${esc(COPY.after)}</span>
    <span class="ca-cite" data-c="e">${esc(COPY.cites[0])}</span><span class="ca-cite" data-c="g">${esc(COPY.cites[1])}</span><span class="ca-cite" data-c="h">${esc(COPY.cites[2])}</span>
    <span class="ca-mean">${esc(COPY.meanwhile)}</span>
    <b class="ca-stop">STOP · No AI called</b>
  </div>
  <svg class="ca-svg" aria-hidden="true" focusable="false"><path class="ca-thr"/><path class="ca-thr ca-thr--on" pathLength="1"/><path class="ca-rl" data-r="e"/><path class="ca-rl" data-r="g"/><path class="ca-rl" data-r="h"/><path class="ca-br" data-b="1"/><path class="ca-br" data-b="2"/><path class="ca-lead"/><circle class="ca-halo" r="14"/><circle class="ca-dot" r="4.5"/></svg>
  <div class="ca-side">
    <header class="ca-head"><p class="ca-eb"><span class="sn">§${esc(n)}</span>${esc(COPY.eyebrow)}</p><h2 class="ca-h2" id="${hid}">${esc(COPY.h2)}</h2><p class="ca-lede">${esc(COPY.lede)}</p></header>
    <div class="ca-notes"><p class="ca-hint">${U.icon("chevron-down", 14)}${esc(COPY.hint)}</p><ol class="ca-nl">${noteLis}</ol><p class="ca-dots" aria-hidden="true">${"<i></i>".repeat(6)}</p></div>
    <div class="ca-wi" role="group" aria-label="Try another moment">${COPY.whatIf.map(([k, l]) => `<button type="button" class="ca-wb" data-w="${k}" aria-pressed="false">${esc(l)}</button>`).join("")}<button type="button" class="ca-wb" data-w="base" aria-pressed="true">${esc(COPY.back)}</button></div>
  </div>
  <div class="ca-foot"><p class="ca-cap">${esc(COPY.cap(fig))}</p>${U.strip(d)}<button type="button" class="ca-pause" data-state="playing" aria-pressed="false">${U.icon("pause", 14)}<span data-label>Pause</span></button></div>
</div></div>
<p class="sr-only">${esc(COPY.sr)}</p><span class="ca-after" id="${esc(o.id || "anatomy")}-after" tabindex="-1"></span>
<p class="sr-only" aria-live="polite" data-live></p>
</section>`;
}

/* ------------------------------------------------------------------ browser */
const num = (cs, k) => parseFloat(cs.getPropertyValue(k)) || 0;
const sm = (a, b, k) => B.clamp((k - a) / (b - a), 0, 1);
const smooth = (k) => k * k * (3 - 2 * k);
/** Step table. Desktop: (a)–(i) 0.08 each from 0.06, (j) 0.78–0.90, recompress 0.90–1.
    Phones: 6 steps (fan out; a+b+c; d+e; f; g+h; i+j), focus plate per step. */
const DESK = { hold: 0.06, step: 0.08, j: [0.78, 0.9] };
const PHONE = [[0, 0.08, null, ""], [0.08, 0.23, "b", "abc"], [0.23, 0.38, "e", "de"], [0.38, 0.53, "f", "f"], [0.53, 0.68, "h", "gh"], [0.68, 0.8, "i", "i"], [0.8, 0.9, "j", "j"]];
function stateAt(p, phone) {
  const end = p >= 0.9, e = end ? 1 - smooth(sm(0.9, 0.985, p)) : 1;
  const j = p >= 0.78 && p < 0.9 ? (p - 0.78) / 0.12 : 0;
  if (phone) {
    const row = PHONE.find((x) => p >= x[0] && p < x[1]) || PHONE[0], q = (p - row[0]) / (row[1] - row[0]);
    const k = end ? -1 : row[2] == "j" ? -1 : LET.indexOf(row[2]);
    return { e, k, q, j: row[2] == "j" ? q : 0, end, notes: end ? "" : row[3], dot: PHONE.indexOf(row) - 1 };
  }
  const k = p >= DESK.hold && p < 0.78 ? Math.floor((p - DESK.hold) / DESK.step) : -1;
  return { e, k, q: k >= 0 ? (p - DESK.hold - k * DESK.step) / DESK.step : 0, j, end, notes: k >= 0 ? LET[k] : j ? "j" : "" };
}
/** Scroll position (p) of a note letter, for the note buttons and #fig-3x links. */
function pOf(k, phone) {
  if (phone) { const r = PHONE.find((x) => x[3].includes(k)) || PHONE[0]; return (r[0] + r[1]) / 2; }
  return k == "j" ? 0.87 : DESK.hold + LET.indexOf(k) * DESK.step + DESK.step * 0.5;
}

export async function mount(el) {
  const d = await B.load();
  const S0 = B.defaults(d), phone = B.phone(), RM = B.reduced();
  const $ = (s) => el.querySelector(s), $$ = (s) => [...el.querySelectorAll(s)];
  const grid = $(".ca-grid"), scene = $(".ca-scene"), cam = $(".ca-cam"), stack = $(".ca-stack"), svg = $(".ca-svg"), book = $(".ca-book");
  const live = $("[data-live]"), noteLis = $$(".ca-nl li"), dots = $$(".ca-dots i"), ghosts = $$(".ca-g");
  const flat = RM || innerHeight < 700 || getComputedStyle(el).getPropertyValue("--flat").trim() == "1";
  let plates = [], mores = [], tagEl = null, M = null, mode = "t1";
  if (flat) el.setAttribute("data-flat", "");

  /* ---------------- plates (re-rendered only for a What-if) */
  function setTrace(id, level) {
    const S = level ? { ...S0, level } : S0;
    M = model(d, d.trace(id), S);
    stack.innerHTML = stackHTML(d, M, S, { fig: el.dataset.fig });
    plates = $$(".ca-stack .ca-p");
    mores = plates.map((n) => n.querySelector(".ca-more"));
    tagEl = plates[5] && plates[5].querySelector(".ca-x .ca-tag");
    el.dataset.trace = id + (level ? "l" + level : "");
    $(".ca-card b").textContent = id == "t1" && !level ? "Answered Omar" : `${M.t.member} · ${M.t.chip}`;
    const c = $(".ca-card .ca-lane"); c.dataset.lane = M.r.lane; c.textContent = LANE[M.r.lane];
    $(".ca-bcite mark").textContent = M.t.rule ? M.t.rule.title : "Platform safety rules";
  }
  setTrace("t1");

  /* ---------------- scroll → p → V (pinned). The loop is registered before every other subscriber of this
     figure, so its one scrollY read per frame happens before any style write of that frame (no forced
     style/layout); the scroll handler itself only flags and wakes it. No rect reads in the loop. */
  let target = 0, cur = 0, curStep = "", wi = null, need = false;
  const render = B.loop(() => {
    if (need) { need = false; readScroll(false); }
    if (cur != target) { cur += (target - cur) * 0.28; if (Math.abs(target - cur) < 0.0004) cur = target; apply(cur); }
    return cur != target;
  });

  /* ---------------- geometry (rect reads on resize and step change only) */
  let G = null;
  function layout() {
    const g = grid.getBoundingClientRect(), s = scene.getBoundingClientRect(), cs = getComputedStyle(el);
    const top = el.getBoundingClientRect().top + scrollY, frame = $(".ca-frame").offsetHeight;
    G = { W: g.width, H: g.height, ox: s.left - g.left + s.width * num(cs, "--ox") / 100, oy: s.top - g.top + s.height * num(cs, "--oy") / 100,
      pw: num(cs, "--pw"), ph: num(cs, "--ph"), gap: num(cs, "--gap"), tz: num(cs, "--tz"), ty: num(cs, "--ty"), tx: num(cs, "--tx"), txf: cs.getPropertyValue("--txf").trim() ? num(cs, "--txf") : num(cs, "--tx"),
      top, len: Math.max(1, el.offsetHeight - frame), lift: num(cs, "--lift"), vh: innerHeight, hh: num(getComputedStyle(document.documentElement), "--header-h") || 72, sx: s.left - g.left, sy: s.top - g.top, sw: s.width, sh: s.height };
    const b = book.getBoundingClientRect();
    G.book = [b.right - g.left, b.top - g.top + b.height * 0.5];
    // (f) keeps its compact box when inspected; its overlay hangs below it. Lift it by half the overhang so
    // the inspected card sits where the grown plate used to (layout values, read on resize only).
    // Never lift its header out of the scene (short phones): the camera is at 0.86 while (f) is inspected.
    const fp = plates[5], x = fp && fp.querySelector(".ca-x");
    if (x && !flat) {
      const over = Math.max(0, (x.offsetTop + x.offsetHeight - fp.offsetHeight) / 2), k = PERSP / (PERSP - G.tz);
      const room = G.ty - fp.offsetHeight / 2 + (G.oy - G.sy - 12) / (0.86 * k); // the inspected centre sits at oy + cam·k·(ty − fx)
      G.fx = B.clamp(room, 0, over);
    } else G.fx = 0;
    svg.setAttribute("viewBox", `0 0 ${G.W} ${G.H}`);
    notesGeo(g);
    noteAt = null; last = {};
    draw(true);
  }
  /* Desktop notes: titles never move in layout. The open note's text is out of flow under its title and the
     titles below slide down by its height with a transform (no layout shift, no layout per frame), so each
     title's anchor is fixed: read here on resize (and when fonts load), never in the loop. */
  const nl = $(".ca-nl");
  let noteAt = null, NA = {}, BH = {};
  function notesGeo(g) {
    if (phone || flat) return;
    const lr = nl.getBoundingClientRect();
    noteLis.forEach((li) => { const k = li.dataset.k; BH[k] = li.querySelector(".ca-nt").offsetHeight; NA[k] = [lr.left - g.left - 10, lr.top - g.top + li.offsetTop + 13]; });
  }
  function noteAnchor() {
    const li = noteLis.find((x) => x.hasAttribute("data-focus"));
    return !li || phone ? null : NA[li.dataset.k] || null;
  }
  /** Stack-local point → grid px (rotateX(56e) rotateZ(-32e), camera scale, perspective 1600). */
  function P(x, y, z, V) {
    const rz = (RZ * V.e * Math.PI) / 180, rx = (RX * V.e * Math.PI) / 180;
    const x1 = x * Math.cos(rz) - y * Math.sin(rz), y1 = x * Math.sin(rz) + y * Math.cos(rz);
    const y2 = y1 * Math.cos(rx) - z * Math.sin(rx), z2 = y1 * Math.sin(rx) + z * Math.cos(rx), k = PERSP / (PERSP - z2);
    return [G.ox + V.cam * x1 * k, G.oy - LF() + V.cam * y2 * k];
  }
  const zOf = (i, V) => (4 - i) * G.gap * V.ex[i];
  // pre-pin camera lift; the intro teaser (V.tl) cancels it so the card it brings forward stays inside the scene
  const LF = () => V.pre * G.lift * (1 - (V.tl || 0));

  /* ---------------- the view: everything is a function of V */
  // V = {e, ex[9], cam, k (inspected), f (flatness), q, j, lit (plates lit up to index), pulse (0..1 along a→i), dim, ghost, book, stop}
  let V = { pre: 0, e: 1, ex: Array(9).fill(1), cam: 1, k: -1, f: 0, q: 0, j: 0, lit: 9, pulse: null, ghost: 0.72, end: 0, rules: 0, stop: 0 }, last = {};
  const fx = (v) => v.toFixed(2);
  /* Style writes go to the few elements that use them (never inherited from the
     section root, which would restyle the whole figure every frame), and only on change. */
  const memo = new WeakMap();
  const put = (node, k, v) => { if (!node) return; let m = memo.get(node); if (!m) memo.set(node, (m = {})); if (m[k] !== v) { m[k] = v; k[0] == "-" ? node.style.setProperty(k, v) : (node.style[k] = v); } };
  const card = $(".ca-card"), stopEl = $(".ca-stop"), ghostWrap = $(".ca-ghosts"), mean = $(".ca-mean");
  const labs = { brk: $$(".ca-brk"), cite: { e: $('.ca-cite[data-c="e"]'), g: $('.ca-cite[data-c="g"]'), h: $('.ca-cite[data-c="h"]') } };
  function draw(force) {
    if (!G) return;
    const e = V.e, pre = LF().toFixed(1) + "px", pl = B.clamp(e / 0.25, 0, 1);
    put(stack, "transform", `rotateX(${fx(RX * e)}deg) rotateZ(${fx(RZ * e)}deg)`);
    put(cam, "transform", `scale(${V.cam.toFixed(3)})`);
    put(cam, "translate", `0 -${pre}`);
    // direct properties, not inherited custom properties: a custom property set here restyled every
    // descendant each frame (~55 ghost elements; QA 27 Oct trace: 125 elements, 16–24 ms a frame at 4x)
    const cv = B.clamp((0.35 - e) / 0.3, 0, 1);
    put(card, "translate", `-50% calc(-50% - ${pre})`); put(stopEl, "translate", `-50% calc(-50% - ${pre})`);
    put(card, "opacity", fx(cv)); put(card, "transform", `scale(${(0.94 + cv * 0.06).toFixed(3)})`);
    put(ghostWrap, "opacity", fx(Math.min(1, V.ghost))); put(mean, "opacity", fx(Math.min(1, V.ghost * 1.8)));
    put(ghostWrap, "transform", `translateY(-${pre}) scale(${V.cam.toFixed(3)})`);
    plates.forEach((n, i) => {
      const me = i == V.k, z = zOf(i, V);
      let tr = `translateZ(${z.toFixed(1)}px)`;
      if (me && V.f > 0) {
        const f = V.f, s56 = Math.sin((RX * Math.PI) / 180), c56 = Math.cos((RX * Math.PI) / 180);
        const dx = (i == 5 ? G.txf : G.tx) * f, dy = (G.ty - (i == 5 ? G.fx : 0) + z * s56) * f, dz = (G.tz - z * c56) * f;
        tr += ` rotateZ(${fx(32 * f)}deg) rotateX(${fx(-56 * f)}deg) translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, ${dz.toFixed(1)}px)`;
      } else if (V.k >= 0) tr += ` translateZ(${(-30 * V.f).toFixed(1)}px)`;
      put(n, "transform", tr);
      // burst/recompress fade only; dimming for inspect and (j) is a class with a CSS transition
      const op = B.clamp(V.ex[i] * e / 0.25, 0, 1);
      put(n, "opacity", op >= 1 ? "" : op.toFixed(3));
      put(n, "transition", op >= 1 ? "" : "none"); // per-frame opacity must not retrigger the dim transition every frame
      n.toggleAttribute("data-me", me && V.f > 0.02);
      n.toggleAttribute("data-lit", i < V.lit);
      n.classList.toggle("is-on", me && V.f > 0.55);
      if (me && i != 5) put(mores[i], "--q", fx(V.q)); // (f)'s drawer has no --q effects (it reveals by words below)
    });
    // inspected (f): reason reveals with scroll
    const fp = plates[5], rs = fp && fp.querySelector(".ca-rs");
    if (rs) { const full = rs.dataset.full; let n = V.k == 5 ? Math.round(full.length * B.clamp((V.q - 0.25) / 0.5, 0, 1)) : V.lit > 5 ? full.length : 0;
      if (n > 0 && n < full.length) n = Math.max(0, full.lastIndexOf(" ", n)); /* word by word: ~20 text layouts, not one a frame */ if (last.rs != n) { rs.textContent = full.slice(0, n) || " "; last.rs = n; } }
    const dim = V.k >= 0 && V.f > 0.12 ? "k" : V.j > 0.02 ? "j" : "";
    if ((stack.dataset.dim || "") != dim) dim ? (stack.dataset.dim = dim) : stack.removeAttribute("data-dim");
    put(tagEl, "--fq", fx(V.k == 5 ? B.clamp((V.q - 0.08) / 0.2, 0, 1) : 0));
    const bk = V.k >= 0 && (phone || ![4, 6, 7].includes(V.k)) ? 1 - V.f : 1;
    put(book, "opacity", fx(pl * bk * (phone ? B.clamp(1 - V.pre * 3, 0, 1) : 1)));
    put(book, "--jq", fx(V.j));
    book.toggleAttribute("data-jl", V.j > 0.5);
    el.toggleAttribute("data-end", !!V.end);
    const ins = V.k >= 0 && V.f > 0.3 ? LET[V.k] : "";
    if (ghostWrap.dataset.insp != ins) ghostWrap.dataset.insp = ins;
    el.toggleAttribute("data-stop", !!V.stop);
    // svg: thread, pulse, rule lines, brackets, leader
    paths(true);
  }
  const at = (i, V, dx = 0) => P(dx, 0, zOf(i, V), V);
  const L2 = (a, b) => `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}`;
  const amemo = new WeakMap();
  const attr = (node, k, v) => { let m = amemo.get(node); if (!m) amemo.set(node, (m = {})); if (m[k] !== v) { m[k] = v; node.setAttribute(k, v); } };
  function paths(on) {
    const sv = [...svg.children].map((n) => ({ setAttribute: (k, v) => attr(n, k, v), classList: n.classList, style: n.style })), e = V.e;
    const vis = on && e >= 0.3 ? B.clamp((e - 0.3) / 0.4, 0, 1) : 0;
    const svv = fx(vis);
    labs.brk.forEach((x) => put(x, "--sv", el.hasAttribute("data-step") || (V.k >= 0 && V.f > 0.15) ? "0" : svv)); // hidden while a plate is inspected (also the intro teaser)
    for (const k in labs.cite) put(labs.cite[k], "--sv", svv);
    if (!vis) { for (const p of sv) p.setAttribute("d", ""); svg.classList.remove("has-dot"); return; }
    put(svg, "opacity", fx(vis));
    svg.classList.toggle("is-insp", V.k >= 0 && V.f > 0.15);
    const top = at(0, V), bot = at(8, V);
    sv[0].setAttribute("d", L2([top[0], top[1] - 30], [bot[0], bot[1] + 30]));
    sv[1].setAttribute("d", L2([top[0], top[1] - 30], [bot[0], bot[1] + 30]));
    const pu = V.pulse, y0 = top[1] - 30, y1 = bot[1] + 30;
    let py = 0;
    if (pu != null) {
      const i = B.clamp(Math.floor(pu), 0, 7), a = at(i, V)[1], b = at(i + 1, V)[1];
      py = pu < 0 ? top[1] + (top[1] - y0) * pu : pu > 8 ? bot[1] + (y1 - bot[1]) * (pu - 8) : a + (b - a) * (pu - i);
    }
    put(svg.children[1], "strokeDashoffset", pu == null ? "1" : fx(1 - B.clamp((py - y0) / (y1 - y0), 0, 1)));
    sv[1].classList.toggle("is-red", !!V.stop);
    // rule lines from the rulebook to (e), (g), (h); lit as the pulse passes them
    const lx = -G.pw / 2;
    const kz = PERSP / (PERSP - G.tz * V.f);
    [[4, "e"], [6, "g"], [7, "h"]].forEach(([i, k], n) => {
      const me = V.k == i && V.f > 0.15;
      const a = G.book, b = me ? [G.ox + V.cam * (G.tx * V.f - G.pw / 2) * kz, G.oy - LF() + V.cam * (G.ty * V.f) * kz] : at(i, V, lx), p = sv[2 + n];
      p.setAttribute("d", `M${a[0].toFixed(1)} ${a[1].toFixed(1)}C${(a[0] + 60).toFixed(1)} ${a[1].toFixed(1)} ${(b[0] - 60).toFixed(1)} ${b[1].toFixed(1)} ${b[0].toFixed(1)} ${b[1].toFixed(1)}`);
      const lit = V.k == i ? 1 : V.k >= 0 ? 0 : V.pulse != null && V.pulse > i - 0.2 && V.pulse < i + 1.8 ? 1 : 0;
      p.classList.toggle("is-off", V.k >= 0 && (!me || phone));
      p.classList.toggle("is-on", !!lit);
      const c = labs.cite[k];
      if (c) { put(c, "transform", `translate(${(b[0] - G.sx - 6).toFixed(1)}px, ${(b[1] - G.sy).toFixed(1)}px)`); c.classList.toggle("is-on", !!lit && (me || (V.pulse != null && Math.abs(V.pulse - i) < 1.2))); }
    });
    // "Your rules" brackets beside (b)–(e) and (g)–(h)
    const bx = lx - 26;
    [[1, 4, 1], [6, 7, 2]].forEach(([a, b, k], n) => {
      const A = at(a, V, bx), Z = at(b, V, bx);
      sv[5 + n].setAttribute("d", `M${(A[0] + 8).toFixed(1)} ${A[1].toFixed(1)}L${A[0].toFixed(1)} ${A[1].toFixed(1)}L${Z[0].toFixed(1)} ${Z[1].toFixed(1)}L${(Z[0] + 8).toFixed(1)} ${Z[1].toFixed(1)}`);
      put(labs.brk[n], "transform", `translate(${(A[0] - G.sx - 10).toFixed(1)}px, ${((A[1] + Z[1]) / 2 - G.sy).toFixed(1)}px)`);
    });
    // leader: inspected plate → its note (desktop)
    const lead = sv[7];
    if (!phone && V.k >= 0 && V.f > 0.6 && !el.hasAttribute("data-tease")) { // no leader during the intro teaser: its note is below the fold
      noteAt = noteAt || noteAnchor();
      const k = PERSP / (PERSP - G.tz), a = [G.ox + V.cam * ((V.k == 5 ? G.txf : G.tx) + G.pw / 2) * k, G.oy - LF() + V.cam * G.ty * k];
      lead.setAttribute("d", noteAt ? `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${(noteAt[0] - 24).toFixed(1)} ${noteAt[1].toFixed(1)}L${noteAt[0].toFixed(1)} ${noteAt[1].toFixed(1)}` : "");
    } else lead.setAttribute("d", "");
    // pulse dot
    if (pu != null) {
      for (const c of [sv[8], sv[9]]) c.setAttribute("cx", top[0].toFixed(1)), c.setAttribute("cy", py.toFixed(1));
      svg.classList.add("has-dot");
    } else svg.classList.remove("has-dot");
  }

  /* ---------------- matrices: code sweep / AI sparkle (one plate at a time) */
  const rnd = B.rng(7);
  const sparkAt = new WeakMap();
  function sparkle(n, kind, k) {
    if (kind == "ai" && k < 1) { const t = performance.now(); if (t - (sparkAt.get(n) || 0) < 90) return; sparkAt.set(n, t); }
    // (f): the lit pill's matrix (in the compact row and in the overlay), never the first pill's
    const mxs = n.classList.contains("ca-brain") ? n.querySelectorAll(".ca-sp[data-on] .ca-mx") : [n.querySelector(".ca-mx")];
    const on = [...Array(9)].map((_, i) => (k >= 1 ? "on" : kind == "check" ? (i % 3 <= Math.floor(k * 3) ? "on" : "") : rnd() < 0.45 ? "on" : ""));
    for (const mx of mxs) if (mx) for (let i = 0; i < 9; i++) if (mx.children[i].className != on[i]) mx.children[i].className = on[i];
  }

  /* ---------------- ghosts: other members' moments, one specialist each */
  const gsc = B.scene(scene, { resumeOnInput: true, onState: (run) => el.toggleAttribute("data-paused", !run && gsc && (gsc.reasons.has("user") || gsc.reasons.has("idle"))) });
  gsc.button($(".ca-pause"), { pause: "Pause", play: "Play" });
  gsc.pause("intro"); // ghosts start after the burst (they are invisible before it; no frames spent on them)
  const G0 = ghosts.map((g, i) => ({ g, t: i * 420, run: -1 }));
  // the pill a ghost member's moment uses, in the inspected Brain card (base trace only)
  const GP = GHOSTS.map(([id, label]) => [B.pick(d.trace(id), d, S0), label.split(" ")[0]]);
  function byTag(i, on) {
    const [sp, who] = GP[i];
    if (!sp || !plates[5] || el.dataset.trace != "t1") return;
    const pill = plates[5].querySelector(`.ca-x .ca-sp[data-sp="${sp}"]`);
    if (!pill || pill.hasAttribute("data-on")) return;
    on ? pill.setAttribute("data-by", who) : pill.removeAttribute("data-by");
  }
  const tierGhosts = () => (B.tier.name == "minimal" ? 0 : B.tier.name == "lite" ? 2 : phone ? 3 : 5);
  let clock = 0;
  const amb = gsc.loop((dt) => {
    clock += dt;
    const max = tierGhosts();
    if (!max) { G0.forEach((x, i) => { if (x.run != -2) x.g.dataset.run = "4", x.run = -2, byTag(i, false); }); return false; } // stacks hidden: no tags either // minimal tier: no ghosts, so no frames (tiers never step back up)
    G0.forEach((x, i) => {
      if (i >= max || (phone && x.g.hasAttribute("data-desk"))) { if (x.run != -2) x.g.dataset.run = "4", x.run = -2, byTag(i, !(phone && x.g.hasAttribute("data-desk"))); return; } // static, lit stacks keep their tag
      const c = clock - x.t;
      if (c < 0) return;
      const per = 5200 + i * 700, ph = c % per, run = ph < 300 ? 0 : ph < 700 ? 1 : ph < 1300 ? 2 : ph < 1900 ? 3 : ph < per - 500 ? 4 : 5;
      if (run != x.run) { x.g.dataset.run = x.run = run; byTag(i, run >= 2 && run <= 4); }
    });
  }, 30);

  /* ---------------- intro: burst (1.2 s, 0.9 s on phones), then Omar's pulse runs once.
     The pulse is in plate units (-0.7 → 8.8); a plate lights as the pulse reaches it. */
  let introTl = null, introDone = false;
  /* pulse keyframes (ms, plate): a → e, a hold at (f) of h ms while the teaser plays, then g → i */
  const TEASE = (h) => [[0, -0.7], [140, 0], [300, 1], [450, 2], [600, 3], [750, 4], [920, 5], [h, 5], [h + 200, 6], [h + 400, 7], [h + 660, 8], [h + 920, 8.8]];
  function runPulse(tl, T, keys, onStop) {
    const len = keys[keys.length - 1][0], pAt = (u) => { for (let i = 1; i < keys.length; i++) if (u <= keys[i][0]) { const [a, pa] = keys[i - 1], [b, pb] = keys[i]; return pa + ((pb - pa) * (u - a)) / (b - a || 1); } return keys[keys.length - 1][1]; };
    const arrive = [...Array(9)].map((_, i) => (keys.find((x) => x[1] >= i) || [len])[0]);
    tl.span(T, len, (k) => {
      const u = k * len;
      V.pulse = pAt(u);
      V.lit = Math.max(V.lit, B.clamp(Math.floor(V.pulse + 1e-6) + 1, 0, 9));
      for (let i = 0; i < 9; i++) {
        const st = M.plates[i].state, s = (u - arrive[i]) / (i == 5 ? 820 : 220);
        if (s >= 0 && s <= 1.3 && st != "skip" && st != "na") sparkle(plates[i], i == 5 ? "ai" : "check", Math.min(1, s));
      }
      if (onStop && V.pulse >= 0.97 && !V.stop) onStop();
      draw();
    });
    tl.at(T + len + 120, () => { V.pulse = null; draw(); });
  }
  function intro() {
    if (RM || flat) return finish();
    const tl = (introTl = B.timeline(gsc_intro));
    const dur = phone ? 900 : 1200;
    V = { ...V, e: 0, ex: Array(9).fill(0), lit: 0, pulse: null, ghost: 0, rules: 1 };
    for (const n of plates) n.querySelectorAll(".ca-mx i").forEach((x) => (x.className = ""));
    el.removeAttribute("data-sc"); el.setAttribute("data-tease", ""); // one style pass for both
    draw();
    tl.span(0, dur, (k) => { V.e = B.ease.out(k); V.ex = V.ex.map((_, i) => B.ease.out(B.clamp(k * 1.3 - (8 - i) * 0.035, 0, 1))); draw(); });
    tl.span(dur * 0.5, 700, (k) => { V.ghost = 0.72 * k; draw(); });
    // Teaser (round 2 review): when the pulse reaches (f), "Your Brain" comes forward by itself with its seven
    // specialists, the one code picked lit, while other members' stacks run beside it. Time-driven, once;
    // any scroll into the pin skips it (introTl.skip) and the scroll state takes over.
    const T0 = dur + 100, F0 = T0 + 860, F1 = F0 + 3400, cam = (f) => 1 - 0.14 * f;
    runPulse(tl, T0, TEASE(F1 - T0 + 380));
    tl.at(F0 + 620, () => { gsc.set("intro", false); });
    tl.span(F0, 560, (k) => { const f = smooth(k); V.k = 5; V.f = f; V.tl = f; V.q = 0; V.cam = cam(f); V.ghost = 0.72 + 0.38 * f; draw(); });
    tl.span(F0 + 360, 1900, (k) => { V.q = 0.08 + 0.7 * k; draw(); });
    tl.span(F1, 460, (k) => { const f = 1 - smooth(k); V.f = f; V.tl = f; V.cam = cam(f); V.ghost = 0.72 + 0.38 * f; if (k >= 1) { V.k = -1; V.q = 0; } draw(); });
    return tl.play().then(finish);
  }
  const gsc_intro = B.scene(el, { idle: 0 });
  // the intro now runs ~7 s (burst + teaser), so Pause stops it too (WCAG 2.2.2), not only the ambient stacks
  $(".ca-pause").addEventListener("click", () => (gsc.reasons.has("user") || gsc.reasons.has("idle") ? gsc_intro.pause() : gsc_intro.play()));
  function finish() {
    introTl = null; introDone = true;
    gsc.set("intro", false);
    el.removeAttribute("data-sc");
    V = { ...V, e: 1, ex: Array(9).fill(1), lit: 9, pulse: null, ghost: 0.72, tl: 0, k: -1, f: 0, q: 0, cam: 1 };
    curStep = "?"; el.removeAttribute("data-tease");
    for (const n of plates) sparkle(n, n.dataset.kind == "msg" ? "check" : n.dataset.kind, 1);
    if (!flat) onScroll(true);
    draw();
  }

  function apply(p) {
    if (!introDone) return;
    if (wi && p < 0.88) clearWhatIf();
    if (wi) return;
    const s = stateAt(p, phone);
    const f = s.k >= 0 ? B.clamp(Math.min(s.q / 0.22, (1 - s.q) / 0.14), 0, 1) : 0;
    V.e = s.e; V.ex.fill(1); V.k = s.k; V.f = smooth(f); V.q = s.q; V.j = s.j; V.end = s.end; V.lit = 9; V.rules = 1;
    V.cam = 1 - 0.14 * (s.k == 5 ? V.f : 0) - 0.06 * Math.min(1, s.j * 2);
    V.ghost = s.k == 5 ? 0.72 + 0.38 * V.f : s.k >= 0 ? 0.72 - 0.47 * V.f : s.j ? 0.15 : 0.72;
    draw();
    const key = s.notes + (s.end ? "end" : "");
    if (key != curStep) { curStep = key; noteSet(s.notes, s.k >= 0 ? LET[s.k] : s.j ? "j" : "", s.dot); }
  }
  function noteSet(list, foc, dot) {
    noteLis.forEach((li) => { const on = !!list && list.includes(li.dataset.k); li.toggleAttribute("data-on", on); li.toggleAttribute("data-focus", li.dataset.k == foc); li.querySelector("button").setAttribute("aria-current", on ? "step" : "false"); });
    el.toggleAttribute("data-step", !!list);
    dots.forEach((x, i) => x.toggleAttribute("data-on", phone && i <= dot));
    if (!phone) nl.style.setProperty("--bh", (foc && BH[foc] ? BH[foc] : 0) + "px");
    noteAt = null;
  }
  function readScroll(force) {
    if (!G || flat) return;
    const y = scrollY, p = B.clamp((y - (G.top - G.hh)) / G.len, 0, 1), pre = B.clamp((G.top - G.hh - y) / (G.vh - G.hh), 0, 1);
    if (pre != V.pre) { V.pre = pre; if (!introDone || cur == target) draw(); }
    if (introTl && p > 0.015) introTl.skip();
    target = p;
    if (force) { cur = p; apply(cur); }
  }
  function onScroll(force) {
    if (force) readScroll(true);
    else need = true;
    render.wake();
  }
  addEventListener("scroll", () => onScroll(), { passive: true });
  const ro = new ResizeObserver(() => { layout(); onScroll(true); });
  ro.observe(grid);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { layout(); onScroll(true); });

  /* ---------------- note buttons and #fig-nx links jump to the step */
  const jump = (k) => {
    if (flat) { const p = plates[LET.indexOf(k)]; p && p.scrollIntoView({ behavior: RM ? "auto" : "smooth", block: "center" }); return; }
    scrollTo({ top: G.top - G.hh + pOf(k, phone) * G.len + 1, behavior: RM ? "auto" : "smooth" });
  };
  el.addEventListener("click", (e) => {
    const nb = e.target.closest(".ca-nb");
    if (nb) return jump(nb.dataset.k);
    const w = e.target.closest(".ca-wb");
    if (w) whatIf(w.dataset.w, w);
  });
  const fromHash = () => { const m = location.hash.match(/^#fig-\d+([a-j])$/); if (m) setTimeout(() => jump(m[1]), 60); };
  addEventListener("hashchange", fromHash);

  /* ---------------- What-if: re-explode with another trace and run it (2.4 s) */
  function whatIf(k, btn) {
    gsc.play(); gsc_intro.play(); // a What-if is the visitor asking for motion
    $$(".ca-wb").forEach((b) => b.setAttribute("aria-pressed", String(b == btn)));
    if (k == "base") { clearWhatIf(); onScroll(true); live.textContent = "Omar: Sent on its own, within your rules."; return; }
    const [, , id, lvl] = COPY.whatIf.find((x) => x[0] == k);
    setTrace(id, lvl);
    wi = k;
    const stop = M.stop;
    live.textContent = `${M.t.member}: ${LANE[M.r.lane]}.${stop ? " No AI called." : ""}`;
    if (RM || flat) { V = { ...V, e: 1, ex: Array(9).fill(1), lit: 9, k: -1, f: 0, end: 0, stop: stop ? 1 : 0, cam: 1 }; draw(); for (const n of plates) sparkle(n, n.dataset.kind == "msg" ? "check" : n.dataset.kind, 1); return; }
    const tl = B.timeline(gsc_intro);
    V = { ...V, k: -1, f: 0, j: 0, end: 0, lit: 0, stop: 0, pulse: null, cam: 1, rules: 1 };
    for (const n of plates) n.querySelectorAll(".ca-mx i").forEach((x) => (x.className = ""));
    const e0 = V.e;
    tl.span(0, 500, (q) => { V.e = e0 + (1 - e0) * B.ease.out(q); V.ex.fill(1); draw(); });
    const keys = stop ? [[0, -0.7], [140, 0], [340, 1], [900, 1], [1300, 7], [1500, 8], [1800, 8.8]]
      : [[0, -0.7], [140, 0], [300, 1], [440, 2], [580, 3], [720, 4], [900, 5], [1500, 5], [1680, 6], [1860, 7], [2080, 8], [2300, 8.8]];
    runPulse(tl, 420, keys, stop ? () => { V.stop = 1; } : null);
    tl.play();
  }
  function clearWhatIf() {
    if (!wi) return;
    wi = null;
    setTrace("t1");
    $$(".ca-wb").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.w == "base")));
    V.stop = 0; V.lit = 9; V.pulse = null;
    for (const n of plates) sparkle(n, n.dataset.kind == "msg" ? "check" : n.dataset.kind, 1);
  }

  /* ---------------- start */
  layout();
  if (flat) { introDone = true; el.removeAttribute("data-sc"); V.lit = 9; for (const n of plates) sparkle(n, n.dataset.kind == "msg" ? "check" : n.dataset.kind, 1); draw(true); gsc.pause("flat"); fromHash(); return { el }; }
  const p0 = B.clamp((scrollY - (G.top - G.hh)) / G.len, 0, 1);
  if (p0 > 0.015 || location.hash.match(/^#fig-/)) { finish(); fromHash(); }
  else {
    // burst when at least a quarter of the frame is in view
    const io = new IntersectionObserver((en) => { if (en.some((x) => x.isIntersecting)) { io.disconnect(); intro(); } }, { threshold: phone ? 0.12 : 0.22 });
    io.observe($(".ca-frame"));
  }
  // tiers (spec §1.6): lite drops halos and most ghosts, minimal drops ghosts; the watchdog only steps down
  el.dataset.tier = B.tier.name;
  B.tier.on((n) => { el.dataset.tier = n; draw(true); });
  return { el, whatIf, jump, get V() { return V; } };
}
