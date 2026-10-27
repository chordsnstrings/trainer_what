/* trainsyou Brain showcase · "Throw a moment at your Brain" (spec §5).
   mount(el, opts) builds the playground into el; renderStatic(data) returns
   the no-JS HTML (t1 resolved) for a Node generator. See README.md. */
import * as Core from "./brain-core.js";
import * as Dec from "./brain-decide.js";
const B = { ...Core, ...Dec };
import * as U from "./brain-ui.js";
const { esc } = B;

export const COPY = {
  h2: "Throw a moment at your Brain", lede: "Pick something a member might say. Watch each check and specialist work. Then change a setting and run it again.",
  placeholder: "Or type what a member might say", run: "Run it", all: "Throw them all", change: "Change a setting", again: "Run it again",
  panel: "What each step said", idle: "Pick a moment above", cta: "Teach your AI — free", skip: "Skip to result", steps: "Step by step",
  closest: "Closest sample: {chip}. This page can't read new messages.", more: "More moments", specialty: "Your specialty",
  allTitle: "Every sample moment at once", back: "Back to one moment", result: "Result", off: "Built and tested. Not on yet.",
  picks: "Code picks", noAi: "No AI called", stop: "STOP · No AI called",
};
const SPECS = [["strength", "Strength", [1, 6, 8, 2, 5, 10, 3, 9, 7, 4, 11, 12]], ["weight_loss", "Weight loss", [4, 10, 8, 9, 2, 1, 3, 6, 7, 5, 12, 11]],
  ["muscle_gain", "Muscle gain", [10, 1, 8, 9, 4, 6, 5, 2, 3, 7, 12, 11]], ["prenatal", "Pre- and postnatal", [11, 2, 12, 10, 5, 4, 9, 1, 8, 6, 3, 7]]];
/* Free text → closest sample (no network). Specific matches first, so "chest pain" is t12, not t2. */
const KEYS = [[/pregnan|حامل/i, 11], [/chest|dizzy|faint|numb|ألم|يعور|دوخة|صدري/i, 12], [/pain|hurt|injur|pop|swell|knee/i, 2],
  [/creatine|supplement|protein powder|pre-workout|vitamin|medication/i, 9], [/deload|skip|rest week/i, 6], [/easy|heavier|add weight|go up|\brir\b/i, 1],
  [/photo|meal|\bate\b|lunch|calories/i, 4], [/tired|sleep|recovery|whoop|hrv/i, 3], [/\bnew\b|plan|programme/i, 10], [/week/i, 8], [/voice|talk|session/i, 5]];
export const closest = (text) => "t" + ((KEYS.find(([re]) => re.test(text)) || [0, 1])[1]);
const COACH = ["reply_picker", "draft_writer", "plan_writer", "week_reviewer", "meal_photo", "voice_lines"];
const KIND = { chat_action: "Chat · a rule fits", chat_review: "Chat · a rule fits", topic: "Chat · your topic", floor: "Chat", plan: "", meal: "Meal photo", voice: "Before a voice session", learn: "Chat · no rule fits", recovery: "Workout starts" };
const kindTag = (t, r) => (t.decide == "plan" ? (t.channel == "week_end" ? "Week ends" : "New plan") : r.steps.some((s) => s.sp == "draft_writer") && t.decide != "learn" ? "Chat · no rule fits" : KIND[t.decide]);
const RES = { clear: "pass", read: "pass", found: "pass", pass: "pass", applied: "pass", confirmed: "pass", asks: "pass", score: "pass", none: "warn", warn: "warn", skipped: "skip",
  sent: "sent", waits: "waits", paused: "paused", picked: "lit", review: "lit", wrote: "lit", estimated: "lit", suggested: "lit" };
const COL = { text: "#F3F4F0", line: "#3A3F39", lime: "#D5F24A", ink: "#171917", red: "#F08A80", amber: "#E0B25C", green: "#7FCB9F" };
const initials = (n) => n.split(/\s+/).map((x) => x[0]).join("").slice(0, 2).toUpperCase();

/* --------------------------------------------------------------- static markup */
function controlsHTML(d, t, S, u = "bp") {
  const L = d.labels, out = [];
  const rng = (k, lab, min, max, v, unit = "%") => `<label class="bp-ctl"><span>${esc(lab)}</span><span class="bp-rng"><input type="range" data-k="${k}" min="${min}" max="${max}" step="1" value="${v}" aria-valuetext="${v}${unit}"><output>${v}${unit}</output></span></label>`;
  const sw = (k, lab, on, sub) => `<label class="bp-ctl bp-sw"><input type="checkbox" role="switch" data-k="${k}"${on ? " checked" : ""}><span>${esc(lab)}${sub ? `<small>${esc(sub)}</small>` : ""}</span></label>`;
  const seg = (k, lab, opts, v) => `<div class="bp-ctl"><span id="${u}-${k}">${esc(lab)}</span><div class="bp-seg" role="radiogroup" aria-labelledby="${u}-${k}">${opts.map(([val, txt]) => `<button type="button" role="radio" data-k="${k}" data-v="${val}" aria-checked="${String(val) == String(v)}" tabindex="${String(val) == String(v) ? 0 : -1}">${esc(txt)}</button>`).join("")}</div></div>`;
  for (const c of t.controls) {
    if (c == "level") out.push(seg("level", "Brain level", [1, 2, 3].map((n) => [n, `${n} ${L.levels[n].name}`]), S.level) + `<p class="bp-sum">${esc(L.levels[S.level].summary)}</p>` +
      (t.decide == "chat_action" ? sw("lastCheckPassing", "Last check: passed (sample)", S.lastCheckPassing, L.levels.note) : ""));
    if (c == "capPct") out.push(rng("capPct", "Maximum increase (%)", 1, 10, S.capPct));
    if (c == "minRir") out.push(rng("minRir", "Minimum recorded repetitions in reserve", 1, 10, S.minRir, ""));
    if (c == "safetyLocked") out.push(`<button type="button" class="bp-lock" data-lock aria-describedby="${u}-locktip">${U.icon("lock")}<span>Safety rules · can't switch off</span></button><p class="bp-locktip" id="${u}-locktip" hidden>Safety rules can't be switched off. You can only make them stricter.</p>`);
    if (c == "threshold") out.push(rng("bar", L.planSetting.label, L.planSetting.min, L.planSetting.max, S.bar));
    if (c == "planMode") out.push(seg("planMode", "Delivery", [["automatic", "Sends automatically when it is sure"], ["supervised", "Waits for me (every plan comes to me)"]], S.planMode));
    if (c == "addEquipmentRule") out.push(sw("addEquipmentRule", "Add a confirmed rule about equipment", S.addEquipmentRule));
    if (c == "oneMoreApproved") out.push(sw("oneMoreApproved", "Approve one more similar plan", S.oneMoreApproved));
    if (c == "loggedShare") out.push(seg("loggedShare", "How much of the week she logged", [[1, "All"], [0.5, "Half"], [0.25, "A quarter"]], S.loggedShare));
    if (c == "supplementsTopic") out.push(sw("supplementsTopic", "Supplement questions: I answer myself", S.supplementsTopic, "Your choice · off by default"));
    if (c == "tooHeavyPct") out.push(rng("tooHeavyPct", "When a client says “too heavy”, lower the next set by up to (%)", 0, 20, S.tooHeavyPct));
    if (c == "recoveryReading") out.push(seg("recoveryReading", "Today's recovery (sample reading)", [[25, "25%"], [55, "55%"], [80, "80%"]], S.recoveryReading));
    if (c == "recoveryOn") out.push(sw("recoveryRule", "My recovery rule is on", S.recoveryRule, L.recoveryCaption));
    if (c == "lowLoadPct") out.push(rng("lowLoadPct", "Low recovery: lower the load by (%)", 0, 30, S.lowLoadPct));
    if (c == "lowVolumePct") out.push(rng("lowVolumePct", "Low recovery: lower the volume by (%)", 0, 50, S.lowVolumePct));
  }
  return out.join("") || `<p class="bp-sum">This moment has no setting to change. ${t.decide == "meal" ? "The member confirms every item." : "Try another moment."}</p>`;
}
/** Result column HTML (also used for the no-JS state). */
export function resultHTML(d, t, r, prev) {
  if (r.off) return `<div class="bp-offcard"><b>${esc(t.chip)}</b>${U.lane(d, "sent", "is-dashed")}<p>${esc(COPY.off)}</p><ul>${t.steps[1].detail.map((x) => `<li>${esc(x)}</li>`).join("")}</ul><p class="bp-note">${esc(d.labels.basis.tests)} · ${esc(d.labels.recoveryCaption)}</p></div>`;
  const changed = prev && prev != r.lane;
  return `<div class="bp-res-h">${esc(COPY.result)} · ${esc(t.member)}</div><div class="bp-lanewrap">${U.lane(d, r.lane)}${changed ? U.lane(d, prev, "is-ghost") : ""}</div>` +
    (r.why || changed ? `<p class="bp-why">${changed ? `Before: ${esc(d.labels.lanes[prev])}. Now: ${esc(d.labels.lanes[r.lane])}. ` : ""}${r.why ? "Why: " + esc(r.why) : ""}</p>` : "") +
    (r.tag ? `<p class="bp-note"><span class="bp-tag">${esc(r.tag)}</span> ${esc(r.note || "")}</p>` : r.note ? `<p class="bp-note">${esc(r.note)}</p>` : "") +
    (r.sure ? U.sure(d, t, r) : "") + U.phone(d, t, r) + `<div class="bp-yousee"><span class="bp-k">What you see</span>${U.today(d, t, r)}</div>` + U.rule(t);
}
function nodesHTML(d, S) {
  const n = (sp, o) => U.node(sp, d, o);
  return `<div class="bp-msg" data-empty><p class="bp-ph">${esc(COPY.idle)}</p></div>` +
    `<div class="bp-band" data-band="before"><div class="bp-bl"><span>Checks first</span><span class="bp-rules">Your rules</span></div><div class="bp-row bp-r4">${["safety", "topics", "memory", "rule_finder"].map((s) => n(s)).join("")}</div></div>` +
    `<div class="bp-shell"><div class="bp-sh-h"><span class="bp-mono">LS</span><b>Your Brain</b><span class="bp-cap">Code picks one specialist per moment</span><span class="bp-kind" hidden></span></div>` +
    `<div class="bp-pills">${COACH.map((s) => n(s)).join("")}</div><div class="bp-row2">${n("set_logger", { name: "Set logger" })}${S.recoveryFlag ? n("recovery", { on: 1 }) : ""}<span class="bp-cl">code rules for workouts</span></div>` +
    `<div class="bp-noai" hidden>${esc(COPY.noAi)}</div><div class="bp-stamp" hidden>${esc(COPY.stop)}</div></div>` +
    `<div class="bp-band" data-band="after"><div class="bp-bl"><span>Checks after</span><span class="bp-rules">Your rules</span></div><div class="bp-row bp-r3">${["checker", "confidence", "lane_gate"].map((s) => n(s)).join("")}</div></div>` +
    `<div class="bp-lanes">${[["sent", d.labels.lanes.sent.split(",")[0]], ["waits", "Your Today"], ["paused", d.labels.lanes.paused]].map(([l, txt]) => `<div class="bp-bin" data-lane="${l}">${l == "waits" ? '<span class="bp-mono">LS</span>' : ""}<span>${esc(txt)}</span></div>`).join("")}</div>` +
    `<div class="bp-low"><div class="bp-learn"><span class="bp-bl">Learns from you</span><div class="bp-lrow"><div class="sc-node bp-priv" data-sp="code" data-kind="check" data-state="idle"><span class="sc-mx"></span>${U.icon("eye-off")}<span class="sc-nm">Privacy</span><span class="sc-val"></span></div>${n("learner")}${n("examiner")}</div></div>` +
    `<div class="bp-shelf"><span class="bp-bl">Not on yet</span><div class="bp-lrow">${n("meal_planner")}${S.recoveryFlag ? "" : n("recovery")}</div></div></div>` +
    `<aside class="bp-book"><span>Your method · <b>24</b> rules (sample)</span></aside><canvas class="bp-cv" aria-hidden="true"></canvas>`;
}
function shellHTML(d, S, o, u = "bp") {
  const ord = SPECS[0][2];
  return (o.heading === false ? "" : `<div class="bp-head"><h2>${esc(COPY.h2)}</h2><p>${esc(COPY.lede)}</p></div>`) +
    `<p class="bp-banner">${esc(d.labels.long)}</p><div class="bp-grid"><div class="bp-pick">` +
    `<label class="bp-lab"><span>${esc(COPY.specialty)}</span><select data-spec>${SPECS.map(([k, n]) => `<option value="${k}">${esc(n)}</option>`).join("")}</select></label>` +
    `<div class="bp-chips" role="group" aria-label="Sample moments">${ord.map((i) => chipHTML(d, d.trace("t" + i), S)).join("")}</div>` +
    `<button type="button" class="bp-more" aria-expanded="false">${esc(COPY.more)}</button>` +
    `<form class="bp-free"><label class="sc-sr" for="${u}-text">${esc(COPY.placeholder)}</label><textarea id="${u}-text" rows="2" maxlength="140" placeholder="${esc(COPY.placeholder)}"></textarea><button class="bp-btn bp-btn-p">${esc(COPY.run)}</button></form>` +
    `<p class="bp-closest" role="status"></p><button type="button" class="bp-btn bp-all-b">${U.icon("layers")}<span>${esc(COPY.all)}</span></button></div>` +
    `<div class="bp-stage sc-stage" data-sc-stage><div class="bp-top">${U.strip(d)}<button type="button" class="bp-pause" aria-pressed="false"><span data-label>Pause</span></button><a href="#${u}-out" class="bp-skip" hidden>${esc(COPY.skip)}</a></div>` +
    `<div class="bp-diagram">${nodesHTML(d, S)}</div><div class="bp-all" hidden></div>` +
    `<details class="bp-logd" open><summary>${esc(COPY.steps)}</summary><div class="bp-log"><h3>${esc(COPY.panel)}</h3><div class="bp-logs"><ol></ol></div></div></details>` +
    `<div class="bp-foot"><span>${esc(d.labels.rates)}</span><span>${esc(d.labels.speed)}</span><button type="button" class="bp-how" aria-expanded="false">How we count</button><p class="bp-hownote" hidden>${esc(d.labels.howWeCount)}</p></div></div>` +
    `<div class="bp-out" id="${u}-out" tabindex="-1"><div class="bp-res"></div><details class="bp-change"><summary>${esc(COPY.change)}</summary><div class="bp-ctls"></div><button type="button" class="bp-btn bp-again">${esc(COPY.again)}</button></details>` +
    `<a class="bp-btn bp-btn-p bp-cta" href="${esc(o.cta || "signup.html")}">${esc(COPY.cta)}</a></div></div>`;
}
const chipHTML = (d, t, S) => `<button type="button" class="bp-chip" data-t="${d.short(t)}" aria-pressed="false"${B.isOff(t, S) ? " data-off" : ""}>${esc(t.chip)}${B.isOff(t, S) ? `<small>${esc(d.labels.status.not_on_yet)}</small>` : ""}</button>`;

/** No-JS markup: the full playground with t1 resolved. Works in Node. */
export function renderStatic(d, o = {}) {
  d = B.index(d);
  const S = { ...B.defaults(d), recoveryFlag: !!o.recovery }, t = d.trace("t1"), r = B.decide(t, S, d);
  let html = shellHTML(d, S, o);
  for (const s of r.steps) html = html.replace(new RegExp(`data-sp="${s.sp}" data-kind="(\\w+)" data-state="idle"`), (m, k) => `data-sp="${s.sp}" data-kind="${k}" data-state="${RES[s.result] || "pass"}"`);
  return html.replace(/<button(?! type="button" class="bp-how")/g, "<button disabled").replace(/<(select|textarea)/g, "<$1 disabled")
    .replace('<span class="bp-kind" hidden></span>', `<span class="bp-kind">${esc(kindTag(t, r))}</span>`)
    .replace(`<div class="bp-bin" data-lane="${r.lane}">`, `<div class="bp-bin" data-lane="${r.lane}" data-hot>`).replace('<div class="bp-res"></div>', `<div class="bp-res">${resultHTML(d, t, r)}</div>`)
    .replace("<ol></ol>", `<ol>${r.steps.map((s) => U.stepRow(d, t, s)).join("")}</ol>`)
    .replace('<div class="bp-ctls"></div>', `<div class="bp-ctls">${controlsHTML(d, t, S)}</div>`)
    .replace(`<div class="bp-msg" data-empty><p class="bp-ph">${esc(COPY.idle)}</p></div>`, msgHTML(t));
}
const msgHTML = (t, hl) => `<div class="bp-msg"><span class="bp-av">${initials(t.member)}</span><div class="bp-mb"><div class="bp-mh"><b>${esc(t.member)}</b><span>${esc(t.channel.replace(/_/g, " "))} · ${esc(t.when)} · sample</span></div>` +
  `<p class="bp-mt" dir="${t.trigger.lang == "ar" ? "rtl" : "ltr"}" lang="${t.trigger.lang}">${hl ? hlText(t.trigger.text, hl) : esc(t.trigger.text)}</p>${t.trigger.gloss ? `<p class="bp-gloss">${esc(t.trigger.gloss)}</p>` : ""}</div></div>`;
function hlText(txt, words) {
  let s = esc(txt);
  for (const w of words) s = s.split(esc(w)).join(`<mark class="bp-hl">${esc(w)}</mark>`);
  return s;
}

/* --------------------------------------------------------------- mount */
let uid = 0;
export async function mount(el, o = {}) {
  const ds = el.dataset;
  o = { src: ds.src, cta: ds.cta, heading: ds.heading == "off" ? false : undefined, recovery: ds.recovery ? ds.recovery == "on" : undefined, ...o };
  const d = await B.load(o.src);
  const S = B.defaults(d);
  if (o.recovery != null) S.recoveryFlag = !!o.recovery;
  const RM = () => B.reduced();
  el.classList.add("bp");
  el.setAttribute("data-showcase", el.getAttribute("data-showcase") || "play");
  const u = "bp" + ++uid;
  // Layout-shift guard (QA 27 Oct, concept C): the no-JS markup shows t1's result; the live playground starts
  // idle and fills the result at the end of a run, which pushed "Change a setting" and the CTA down (and the
  // mount itself could shorten the page). Keep the static result's height reserved, and the whole block's.
  const pre = el.querySelector(".bp-res"), resH = pre ? pre.offsetHeight : 0, elH = resH ? el.offsetHeight : 0;
  el.innerHTML = shellHTML(d, S, o, u);
  if (resH) el.querySelector(".bp-res").style.minHeight = resH + "px", (el.style.minHeight = elH + "px");
  el.removeAttribute("data-sc");
  el.classList.add("sc-cv");
  const $ = (s, r = el) => r.querySelector(s), $$ = (s, r = el) => [...r.querySelectorAll(s)];
  const stage = $(".bp-stage"), dia = $(".bp-diagram"), cv = $(".bp-cv"), logOl = $(".bp-log ol"), res = $(".bp-res"), ctls = $(".bp-ctls");
  const allBox = $(".bp-all"), msgBox = () => $(".bp-msg"), shell = $(".bp-shell"), kindEl = $(".bp-kind");
  const sc = B.scene(stage, { resumeOnInput: true });
  sc.button($(".bp-pause"));
  if (B.phone()) $(".bp-logd").open = false;
  if (!B.phone()) $(".bp-change").open = true;
  $(".bp-change").style.visibility = "hidden"; // "Change and run again" belongs to a moment: hidden (space kept, so no layout shift) until the first run (QA 27 Oct)

  /* ---------------- geometry (read on resize only) */
  let G = null, ctx = null, edges = null, dirty = true, font = "", sub = null;
  const nodeEl = (sp) => (sp == "code" ? $(".bp-priv") : $(`.bp-diagram .sc-node[data-sp="${sp}"]`));
  function measure() {
    const b = dia.getBoundingClientRect();
    if (!b.width) return;
    const R = (e) => { const r = e.getBoundingClientRect(); return { x: r.left - b.left, y: r.top - b.top, w: r.width, h: r.height, cx: r.left - b.left + r.width / 2, cy: r.top - b.top + r.height / 2, r: r.right - b.left, b: r.bottom - b.top }; };
    G = { w: b.width, h: b.height, n: {}, mx: {}, bins: {}, ai: {} };
    $$(".sc-node", dia).forEach((e) => { const sp = e.dataset.sp; G.n[sp] = R(e); const m = e.querySelector(".sc-mx"); if (m && !e.hasAttribute("data-off")) G.mx[sp] = R(m); G.ai[sp] = e.dataset.kind == "ai"; });
    $$(".bp-bin", dia).forEach((e) => (G.bins[e.dataset.lane] = R(e)));
    G.idx = {}; Object.keys(G.mx).forEach((k, i) => (G.idx[k] = i));
    G.font = font || (font = "600 11px " + (getComputedStyle(stage).getPropertyValue("--sc-mono").trim() || "monospace"));
    G.msg = R(msgBox()); G.shell = R(shell); G.book = R($(".bp-book")); G.kind = R(kindEl.hidden ? $(".bp-cap") : kindEl); G.lanes = R($(".bp-lanes"));
    if (!ctx || cv._w != G.w || cv._h != G.h || cv._t != B.tier.name) { ctx = B.fit(cv, G.w, G.h); cv._w = G.w; cv._h = G.h; cv._t = B.tier.name; }
    dirty = false;
    drawEdges();
    paint();
  }
  // geometry is re-read on the next frame (layout is due then anyway), never mid-handler
  const need = () => { dirty = true; RM() || !sub ? measure() : sub.wake(); };
  function drawEdges() {
    const { cv: c2, c } = B.bitmap(G.w, G.h), n = G.n;
    c.strokeStyle = COL.line; c.lineWidth = 1;
    const seg = (pts) => { c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.stroke(); };
    const row = (ids) => ids.forEach((id, i) => i && Math.abs(n[ids[i - 1]].cy - n[id].cy) < 4 && n[id].x > n[ids[i - 1]].r && seg([[n[ids[i - 1]].r, n[id].cy], [n[id].x, n[id].cy]]));
    seg([[n.safety.cx, G.msg.b], [n.safety.cx, n.safety.y]]);
    row(["safety", "topics", "memory", "rule_finder"]); row(["checker", "confidence", "lane_gate"]); row(["learner", "examiner"]); row(["code", "learner"]);
    seg([[n.rule_finder.cx, n.rule_finder.b], [n.rule_finder.cx, G.shell.y]]);
    seg([[n.checker.cx, G.shell.b], [n.checker.cx, n.checker.y]]);
    const ly = G.lanes.y - 8;
    seg([[n.lane_gate.cx, n.lane_gate.b], [n.lane_gate.cx, ly]]);
    seg([[G.bins.sent.cx, ly], [G.bins.paused.cx, ly]]);
    for (const k in G.bins) seg([[G.bins[k].cx, ly], [G.bins[k].cx, G.bins[k].y]]);
    edges = c2;
  }
  new ResizeObserver(() => need()).observe(dia);

  /* ---------------- canvas state */
  const st = {}; // sp → {s, t0}
  let lines = [], dot = null, trail = [], clock = 0, runTl = null, mode = "one", minis = [];
  const rnd = B.rng(7);
  const setNode = (sp, s) => {
    const e = nodeEl(sp);
    if (e) e.dataset.state = s;
    st[sp] = { s, t0: clock };
    if (RM()) paint();
  };
  function matrix(c, sp, now, rm) {
    const m = G.mx[sp], e = st[sp] || { s: "idle", t0: 0 }, k = G.n[sp];
    if (!m || !k) return;
    const ai = G.ai[sp], age = clock - e.t0;
    const idx = G.idx[sp];
    let col = COL.text, on = () => 1;
    const s = e.s;
    if (s == "idle") { const a = rm ? 0.25 : 0.25 + 0.07 * Math.sin(((now + idx * 230) / 2800) * Math.PI * 2); on = () => a; }
    else if (s == "work" && ai) { col = COL.ink; const f = Math.floor(age / 90), r = B.rng(f * 31 + idx), lit = new Set([...Array(3 + Math.floor(r() * 3))].map(() => Math.floor(r() * 9))); on = (i) => (lit.has(i) ? 1 : 0.15); }
    else if (s == "work") { const colN = Math.floor(age / 80) % 3; on = (i) => (i % 3 == colN ? 1 : 0.2); }
    else if (s == "hit") { col = COL.red; on = () => (age < 480 && Math.floor(age / 120) % 2 ? 0.15 : 1); }
    else if (s == "skip") on = () => 0.12;
    else if (s == "warn" || s == "waits") col = COL.amber;
    else if (s == "paused") col = COL.red;
    else if (s == "sent") col = COL.green;
    else if (s == "lit") col = COL.ink;
    c.fillStyle = col;
    for (let i = 0; i < 9; i++) {
      c.globalAlpha = on(i);
      const x = m.x + 1.5 + (i % 3) * 5 + 1.5, y = m.y + 1.5 + Math.floor(i / 3) * 5 + 1.5;
      if (ai) { c.beginPath(); c.arc(x, y, 1.5, 0, 6.283); c.fill(); } else c.fillRect(x - 1.5, y - 1.5, 3, 3);
    }
    c.globalAlpha = 1;
  }
  const route = (a, b) => {
    if (Math.abs(a[1] - b[1]) < 6) return [a, b];
    const my = b[1] > a[1] ? a[1] + (b[1] - a[1]) / 2 : b[1] + (a[1] - b[1]) / 2;
    return [a, [a[0], my], [b[0], my], b];
  };
  const plen = (p) => p.reduce((s, q, i) => (i ? s + Math.hypot(q[0] - p[i - 1][0], q[1] - p[i - 1][1]) : 0), 0);
  function along(p, k) {
    let L = plen(p) * k;
    for (let i = 1; i < p.length; i++) {
      const s = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
      if (L <= s || i == p.length - 1) { const f = s ? Math.min(1, L / s) : 1; return [B.lerp(p[i - 1][0], p[i][0], f), B.lerp(p[i - 1][1], p[i][1], f)]; }
      L -= s;
    }
    return p[p.length - 1];
  }
  function stroke(c, p, k) { // partial polyline 0..k
    const L = plen(p) * k; let acc = 0;
    c.beginPath(); c.moveTo(p[0][0], p[0][1]);
    for (let i = 1; i < p.length; i++) {
      const s = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
      if (acc + s >= L) { const f = s ? (L - acc) / s : 1; c.lineTo(B.lerp(p[i - 1][0], p[i][0], f), B.lerp(p[i - 1][1], p[i][1], f)); break; }
      c.lineTo(p[i][0], p[i][1]); acc += s;
    }
    c.stroke();
  }
  function paint(now = performance.now()) {
    if (!G || !ctx) return;
    const c = ctx;
    c.clearRect(0, 0, G.w, G.h);
    if (mode == "all") return;
    c.drawImage(edges, 0, 0, G.w, G.h);
    // the run's route, dashed and moving (one dash animation)
    if (dot && dot.keys && !RM()) {
      c.save(); c.strokeStyle = COL.lime; c.globalAlpha = 0.28; c.setLineDash([3, 3]); c.lineDashOffset = -(now / 1600 * 6) % 6;
      c.beginPath(); for (const k of dot.keys) if (!k.red) k.p().forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.stroke(); c.restore();
    }
    for (const l of lines) {
      const a = clock - l.t0;
      if (a < 0) continue;
      const k = Math.min(1, a / l.draw), fade = a > l.draw + l.hold ? 1 - (a - l.draw - l.hold) / l.fade : 1;
      if (fade <= 0) continue;
      c.save(); c.globalAlpha = Math.max(0, fade); c.strokeStyle = l.col; c.lineWidth = l.w || 1.5;
      const P = typeof l.p == "function" ? l.p() : l.p;
      stroke(c, P, l.ease ? B.ease.in(k) : B.ease.out(k));
      if (l.label && k >= 1) { c.fillStyle = l.col; c.font = G.font; c.fillText(l.label, P[P.length - 1][0] + 6, P[P.length - 1][1] - 6); }
      c.restore();
    }
    lines = lines.filter((l) => clock - l.t0 < l.draw + l.hold + l.fade || l.keep);
    const rm = RM();
    for (const sp in G.mx) matrix(c, sp, now, rm);
    if (dot && dot.pos && !RM()) {
      c.save(); c.strokeStyle = COL.lime; c.lineWidth = 1.5;
      for (let i = 1; i < trail.length; i++) { const a = 1 - (clock - trail[i][2]) / 600; if (a <= 0) continue; c.globalAlpha = a; c.beginPath(); c.moveTo(trail[i - 1][0], trail[i - 1][1]); c.lineTo(trail[i][0], trail[i][1]); c.stroke(); }
      const [x, y] = dot.pos;
      if (B.tier.spec.halos) { const g = c.createRadialGradient(x, y, 0, x, y, 14); g.addColorStop(0, "rgba(213,242,74,.25)"); g.addColorStop(1, "rgba(213,242,74,0)"); c.globalAlpha = 1; c.fillStyle = g; c.fillRect(x - 14, y - 14, 28, 28); }
      c.globalAlpha = 1; c.fillStyle = dot.red ? COL.red : COL.lime; c.beginPath(); c.arc(x, y, 4, 0, 6.283); c.fill(); c.restore();
    }
  }
  // one loop subscriber: 60 fps while a run plays, 12 fps breathing when idle
  sub = sc.loop((dt, now) => {
    clock += dt;
    if (dirty) measure();
    if (dot && dot.keys) moveDot();
    paint(now);
    sub.fps = runTl || lines.length || mode == "all" ? 60 : 12;
    return !RM();
  }, 12);
  B.onReduced(() => { sub.wake(); paint(); });
  B.tier.on(() => need());

  /* ---------------- the dot */
  function moveDot() {
    const K = dot.keys, t = runTl ? runTl.t : Infinity;
    let i = K.findIndex((k) => k.at > t);
    if (i == -1) { const q = K[K.length - 1].p(); dot.pos = q[q.length - 1]; return; }
    const k = K[i], a = Math.max(k.dep, i ? K[i - 1].at : 0), q = k.p();
    if (t < a) dot.pos = q[0];
    else dot.pos = along(q, B.ease.io(B.clamp((t - a) / (k.at - a), 0, 1)));
    dot.red = k.red;
    trail.push([dot.pos[0], dot.pos[1], clock]);
    while (trail.length && clock - trail[0][2] > 600) trail.shift();
  }
  // anchors are getters, so routes follow any layout change mid-run
  const bin = (l) => () => [G.bins[l].cx, G.bins[l].cy], MSG = () => [G.msg.cx, G.msg.b - 4];
  const anchor = (t, s) => {
    if (s.sp == "any_ai" || (s.sp == "lane_gate" && t.decide == "floor")) return null;
    if (s.sp == "you" || s.sp == "today") return { id: "waits", f: bin("waits") };
    if (s.sp == "member") return { id: "msg", f: MSG };
    return G.n[s.sp] ? { id: s.sp, f: () => [G.n[s.sp].cx, G.n[s.sp].cy] } : null;
  };

  /* ---------------- log */
  function logRow(t, s, i, stream) {
    const li = document.createElement("li");
    li.innerHTML = U.stepRow(d, t, s, { stream });
    const row = li.firstChild;
    row.dataset.i = i;
    logOl.append(row);
    return row;
  }

  /* ---------------- a run */
  let cur = null, R = null, before = null, busy = false, attract = false, touched = false;
  function chipsBusy(on) {
    busy = on;
    $$(".bp-chip, .bp-all-b, .bp-free button").forEach((b) => b.setAttribute("aria-disabled", String(on)));
    $(".bp-skip").hidden = !on || RM();
  }
  function resetStage(t, from) {
    for (const sp in G.n) if (from == 0) setNode(sp, "idle");
    $$(".sc-val", dia).forEach((e) => (e.textContent = ""));
    $$(".bp-bin", dia).forEach((b) => b.removeAttribute("data-hot"));
    shell.classList.remove("is-dim"); $$(".bp-band[data-band=after], .bp-low").forEach((e) => e.classList.remove("is-dim"));
    $(".bp-stamp").hidden = $(".bp-noai").hidden = true;
    $(".bp-book b").textContent = "24";
    lines = []; trail = [];
    if (from == 0) { logOl.textContent = ""; }
    else $$("li[data-i]", logOl).forEach((li) => +li.dataset.i >= from && li.remove());
    const tag = kindTag(t, B.decide(t, S, d));
    kindEl.hidden = !tag; kindEl.textContent = tag || "";
    $(".sc-node[data-sp=confidence] .sc-val").textContent = t.sure ? "" : "—";
    $(".sc-node[data-sp=confidence]").title = t.sure ? d.sp.confidence.line : d.labels.noChatScore;
  }
  function run(id, from = 0) {
    const t = d.trace(id);
    if (!t || !G) return;
    if (runTl) runTl.stop(), (runTl = null);
    if (mode == "all") showAll(false);
    // the run plays in the stage (and pauses offscreen): read this before any DOM write
    // phones (round 2 review): a chip sits above the stage, so a tap whose stage starts low would play the run
    // below the fold; bring the stage up. A self-started (attract) run never scrolls.
    const sb = stage.getBoundingClientRect(), away = !attract && (sb.top > innerHeight - 160 || sb.bottom < 160 || (B.phone() && sb.top > innerHeight * 0.4));
    const r = B.decide(t, S, d);
    $$(".bp-chip").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.t == d.short(t))));
    before = cur == t && R ? R.lane : null;
    if (cur != t) from = 0, (ctls.innerHTML = controlsHTML(d, t, S, u));
    const old = cur == t && R ? R.steps : [];
    cur = t;
    $(".bp-change").style.visibility = "";
    if (!attract) el.style.minHeight = ""; // the mount guard has done its job (a run is visitor-caused)
    if (r.off) { // Low recovery while its flag is off: no run, no pulse
      R = r; resetStage(t, 0); dot = null;
      msgBox().outerHTML = msgHTML(t); need();
      nodeEl("recovery") && (nodeEl("recovery").dataset.state = "focus");
      res.innerHTML = resultHTML(d, t, r);
      B.say(`${t.chip}: ${COPY.off}`);
      return;
    }
    R = r;
    resetStage(t, from);
    if (from) [...old.slice(from), ...r.steps.slice(from)].forEach((s) => G.n[s.sp] && setNode(s.sp, "idle"));
    else msgBox().outerHTML = msgHTML(t);
    need();
    const steps = r.steps, base = from ? steps[from].at - 300 : -500, tl = (runTl = B.timeline(sc));
    const floor = t.decide == "floor", ai = steps.find((s) => s.sp in d.sp && d.sp[s.sp].kind == "ai" && s.sp != "learner");
    // dot keyframes
    let prev = (from && anchor(t, steps[from - 1])) || { id: "msg", f: MSG }, keys = [], lastAt = 0;
    const leg = (a, b) => () => route(a(), b());
    steps.forEach((s, i) => {
      if (i < from) return;
      const T = s.at - base, a = anchor(t, s);
      if (a && a.id != prev.id) {
        const p = leg(prev.f, a.f), dur = B.clamp(plen(p()) * 1.1, 160, 420);
        keys.push({ at: T, dep: Math.max(lastAt + 60, T - dur), p }); prev = a; lastAt = T;
      }
      tl.at(T, () => startStep(t, s, i, r));
      tl.at(T + s.dur, () => endStep(t, s, i, r));
      if (s.out && !RM()) {
        const txt = U.outLines(s).join("\n");
        tl.span(T + 120, (txt.length / 40) * 1000, (k) => { const pre = logOl.querySelector(`[data-i="${i}"] .sc-out`); if (pre) { pre._f = pre._f || U.streamer(pre, pre.dataset.full); pre._f(k); } });
      }
    });
    const last = steps[steps.length - 1], end = last.at + last.dur - base + 120;
    const dest = r.lane == "member" ? MSG : r.lane == "learn" ? () => [G.book.cx, G.book.cy] : G.bins[r.lane] && bin(r.lane);
    if (floor) { // the red route: along the inline-start and bottom edges into Training paused
      const p = () => { const s0 = G.n.safety, yb = G.lanes.b + 6, pb = G.bins.paused; return [[s0.x, s0.cy], [5, s0.cy], [5, yb], [pb.cx, yb], [pb.cx, pb.b]]; };
      keys.push({ at: end + 600, dep: end, p, red: true });
      tl.at(end, () => lines.push({ p, t0: clock, draw: 600, hold: 99999, fade: 300, col: COL.red, w: 2, ease: 1, keep: 1 }));
    } else if (dest) keys.push({ at: end + 380, dep: end, p: leg(prev.f, dest) });
    dot = { keys, pos: keys.length ? keys[0].p()[0] : null };
    tl.at(end + (floor ? 650 : 420), () => finish(t, r));
    if (!attract) chipsBusy(true); // the attract run stays interruptible: any chip takes over
    sub.wake();
    if (away) dia.scrollIntoView({ block: "start", behavior: RM() ? "auto" : "smooth" });
    const p = tl.play(1);
    if (RM()) tl.skip();
    return p;
  }
  function startStep(t, s, i, r) {
    const sp = s.sp == "today" ? null : s.sp, kind = sp && d.sp[sp] ? d.sp[sp].kind : "check";
    if (sp && G.n[sp]) setNode(sp, s.result == "skipped" ? "skip" : "work");
    if (s.sp == "any_ai") { $(".bp-noai").hidden = false; COACH.forEach((c) => setNode(c, "skip")); }
    if (kind == "ai" && sp != "learner" && !RM()) { // code picks: one straight line from the moment's kind to the one specialist
      lines.push({ p: () => [[G.kind.cx, G.kind.b], [G.n[sp].cx, G.n[sp].y]], t0: clock - 1, draw: 240, hold: 500, fade: 600, col: COL.lime, label: COPY.picks });
      const li = document.createElement("li"); li.className = "sc-step bp-picks"; li.dataset.i = i; li.textContent = d.labels.picks; logOl.append(li);
    }
    logRow(t, s, i, kind == "ai" && !RM());
    // rule lines from the rulebook to the node that cites a rule
    const cites = (sp == "rule_finder" && s.result == "found") || (sp == "checker" && /cites your rule/i.test(s.say)) || (sp == "lane_gate" && /level|bar/i.test(s.say)) || (sp == "set_logger") || (sp == "topics" && s.result == "hit");
    if (cites && G.n[sp] && !RM()) { lines.push({ p: () => { const n = G.n[sp], y = n.y - 6; return [[G.book.x, y], [n.cx, y], [n.cx, n.y]]; }, t0: clock + 60, draw: 240, hold: 400, fade: 600, col: COL.lime }); }
    if (s.sp == "safety" && s.result == "hit" && !RM()) { // scan sweep over the words
      msgBox().classList.add("is-scan");
    }
  }
  function endStep(t, s, i, r) {
    const sp = s.sp;
    if (sp == "any_ai") return;
    let state = RES[s.result] || "pass";
    if (s.result == "hit") state = sp == "safety" ? "hit" : "warn";
    if (G.n[sp]) setNode(sp, state);
    if (sp == "confidence" && r.sure) { const v = nodeEl("confidence").querySelector(".sc-val"); v.textContent = r.sure.display.replace(" · your bar", " · bar"); nodeEl("confidence").dataset.state = r.sure.score * 100 >= r.sure.bar ? "pass" : "warn"; }
    if (s.result == "skipped") { const v = nodeEl(sp) && nodeEl(sp).querySelector(".sc-val"); if (v) v.textContent = "Not reached"; }
    if (sp == "safety" && s.result == "hit") {
      const m = msgBox(); m.classList.remove("is-scan");
      m.querySelector(".bp-mt").innerHTML = hlText(t.trigger.text, s.highlight || []);
      const stamp = $(".bp-stamp"); stamp.hidden = false;
      shell.classList.add("is-dim"); $$(".bp-band[data-band=after], .bp-low").forEach((e) => e.classList.add("is-dim"));
    }
    if (sp == "learner" && s.result == "suggested") lines.push({ p: () => [[G.n.learner.r, G.n.learner.cy], [G.book.x, G.n.learner.cy]], t0: clock, draw: 700, hold: 600, fade: 600, col: COL.lime });
    if (sp == "examiner") $(".bp-book b").textContent = "25";
  }
  function finish(t, r) {
    runTl = null;
    const bin = $(`.bp-bin[data-lane="${r.lane}"]`);
    if (bin) bin.setAttribute("data-hot", "");
    if (t.decide == "floor") { shell.classList.remove("is-dim"); $$(".is-dim", dia).forEach((e) => e.classList.remove("is-dim")); }
    if (r.lane == "member") msgBox().dataset.tag = `${t.member} confirms`;
    res.innerHTML = resultHTML(d, t, r, before && before != r.lane ? before : null);
    $(".bp-again").classList.remove("bp-btn-p");
    chipsBusy(false);
    if (!attract) B.say(`Result: ${d.labels.lanes[r.lane]}`); // the self-started run announces nothing
    attract = false;
    paint();
  }

  /* ---------------- settings */
  let deb = 0;
  function changed() {
    if (!cur) return;
    const r = B.decide(cur, S, d), was = R ? R.lane : null;
    res.innerHTML = resultHTML(d, cur, r, was && was != r.lane ? was : null);
    $(".bp-again").classList.add("bp-btn-p");
    const sum = $(".bp-sum", ctls);
    if (sum && cur.controls.includes("level")) sum.textContent = d.labels.levels[S.level].summary;
    clearTimeout(deb);
    deb = setTimeout(() => B.say(`${d.labels.lanes[r.lane]}${r.why ? ". " + r.why : ""}`), 400);
  }
  ctls.addEventListener("input", (e) => {
    const x = e.target, k = x.dataset.k;
    if (!k) return;
    if (x.type == "range") { S[k] = +x.value; const u = k == "minRir" ? "" : "%"; x.setAttribute("aria-valuetext", x.value + u); x.nextElementSibling.textContent = x.value + u; }
    if (x.type == "checkbox") S[k] = x.checked;
    clearTimeout(x._d); x._d = setTimeout(changed, 120);
  });
  ctls.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.lock != null) {
      b.classList.remove("is-shake"); void b.offsetWidth; b.classList.add("is-shake");
      $("#bp-locktip").hidden = false; B.say("Safety rules can't be switched off. You can only make them stricter.");
      return;
    }
    if (b.getAttribute("role") == "radio") pickRadio(b);
  });
  ctls.addEventListener("keydown", (e) => {
    const b = e.target;
    if (b.getAttribute("role") != "radio" || !/Arrow(Left|Right|Up|Down)/.test(e.key)) return;
    e.preventDefault();
    const all = [...b.parentElement.children], i = all.indexOf(b), n = all[(i + (/Right|Down/.test(e.key) ? 1 : all.length - 1)) % all.length];
    pickRadio(n); n.focus();
  });
  function pickRadio(b) {
    [...b.parentElement.children].forEach((x) => { const on = x == b; x.setAttribute("aria-checked", String(on)); x.tabIndex = on ? 0 : -1; });
    const k = b.dataset.k, v = b.dataset.v;
    S[k] = isNaN(+v) ? v : +v;
    changed();
  }
  $(".bp-again").addEventListener("click", () => {
    if (!cur || busy) return;
    const r = B.decide(cur, S, d), old = R ? R.steps : [];
    let k = r.steps.findIndex((s, i) => !old[i] || JSON.stringify(s) != JSON.stringify(old[i]));
    if (r.lane != (R && R.lane) && k == -1) k = r.steps.length - 1;
    run(d.short(cur), Math.max(0, k));
  });

  /* ---------------- attract (round 2 review): the first time the stage is half in view and nobody has used the
     playground yet, it plays the first moment of the list once, so it never opens as an empty diagram. Not under
     reduced motion; silent; chips stay live and any visitor action takes over. */
  const touch = () => { touched = true; attract = false; }; // a tap or a key, not a scroll that starts on it
  ["click", "keydown", "change"].forEach((ev) => el.addEventListener(ev, touch, { capture: true }));
  if (!RM() && o.attract !== false && ds.attract != "off" && typeof IntersectionObserver == "function") {
    const io = new IntersectionObserver((es) => {
      // "well in view": 45% of the stage, or half the viewport when the stage is taller than that (phones)
      if (!es.some((e) => e.isIntersecting && e.intersectionRect.height >= Math.min(e.boundingClientRect.height * 0.45, innerHeight * 0.5))) return;
      io.disconnect();
      setTimeout(() => {
        if (touched || cur || mode != "one" || !G) return;
        const id = $$(".bp-chip").map((c) => c.dataset.t).find((x) => !B.decide(d.trace(x), S, d).off);
        if (id) { attract = true; run(id); }
      }, 700);
    }, { threshold: [0.1, 0.2, 0.3, 0.45] });
    io.observe(stage);
  }

  /* ---------------- picker */
  el.addEventListener("click", (e) => {
    const c = e.target.closest(".bp-chip");
    if (c) { if (busy) return e.preventDefault(); return run(c.dataset.t); }
    if (e.target.closest(".bp-skip")) { e.preventDefault(); runTl && runTl.skip(); $(".bp-out").focus(); return; }
    if (e.target.closest(".bp-all-b") && !busy) return showAll(true);
    if (e.target.closest(".bp-how")) { const b = $(".bp-how"), n = $(".bp-hownote"); n.hidden = !n.hidden; b.setAttribute("aria-expanded", String(!n.hidden)); }
    if (e.target.closest(".bp-more")) { const b = $(".bp-more"); el.classList.toggle("is-all-chips"); b.setAttribute("aria-expanded", String(el.classList.contains("is-all-chips"))); }
    const m = e.target.closest(".bp-mini");
    if (m) { showAll(false); run(m.dataset.t); }
    if (e.target.closest(".bp-back")) showAll(false);
  });
  $("[data-spec]").addEventListener("change", (e) => {
    const ord = SPECS.find((s) => s[0] == e.target.value)[2], box = $(".bp-chips");
    ord.forEach((i) => box.append(box.querySelector(`[data-t="t${i}"]`)));
  });
  $(".bp-free").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = $(".bp-free textarea").value.trim();
    if (!v || busy) return;
    const id = closest(v), t = d.trace(id);
    $(".bp-closest").textContent = COPY.closest.replace("{chip}", t.chip);
    run(id);
  });

  /* ---------------- throw them all */
  function showAll(on) {
    if (!on) {
      mode = "one"; allBox.hidden = true; dia.hidden = false; minis.forEach((m) => m.tl && m.tl.stop()); minis = [];
      if (allTl) allTl.stop(), (allTl = null);
      need(); return;
    }
    if (runTl) runTl.stop(), (runTl = null);
    mode = "all"; dot = null;
    const list = SPECS[0][2].map((i) => d.trace("t" + i));
    allBox.innerHTML = `<div class="bp-all-h"><b>${esc(COPY.allTitle)}</b><button type="button" class="bp-btn bp-back">${esc(COPY.back)}</button></div><div class="bp-minis">` +
      list.map((t) => { const r = B.decide(t, S, d), off = r.off, ai = off ? null : B.pick(t, d, S); return `<button type="button" class="bp-mini" data-t="${d.short(t)}"${off ? " data-off" : ""} aria-label="${esc(`${t.member}: ${t.chip}. ${off ? COPY.off : (ai ? d.sp[ai].name : d.labels.noAi || "No AI called") + ". " + d.labels.lanes[r.lane]}. Open it`)}"><span class="bp-mini-h"><b>${esc(t.member)}</b> ${esc(t.chip)}</span>${off ? "" : `<span class="bp-mini-ai is-wait" data-kind="${ai ? "ai" : "check"}" aria-hidden="true"><i></i>${esc(ai ? d.sp[ai].name : d.labels.noAi || "No AI called")}</span>`}<span class="bp-mini-s">${off ? `<i class="bp-ms" data-kind="check" data-state="skip"></i>` : r.steps.map((s) => `<i class="bp-ms" data-kind="${s.sp in d.sp ? d.sp[s.sp].kind : "check"}" data-state="idle"></i>`).join("")}</span>${off ? `<span class="sc-offchip">${esc(d.labels.status.not_on_yet)}</span>` : U.lane(d, r.lane, "is-wait")}</button>`; }).join("") +
      `</div><p class="bp-totals" aria-live="off"></p>`;
    dia.hidden = true; allBox.hidden = false;
    // phones: the button sits above the stage, so bring the twelve stacks up (round 2 review)
    const lowAll = B.phone() && stage.getBoundingClientRect().top > innerHeight * 0.4;
    $(".bp-back", allBox).focus({ preventScroll: lowAll });
    if (lowAll) allBox.scrollIntoView({ block: "start", behavior: RM() ? "auto" : "smooth" });
    const tl = (allTl = B.timeline(sc));
    let endAt = 0;
    $$(".bp-mini", allBox).forEach((m, j) => {
      const t = d.trace(m.dataset.t), r = B.decide(t, S, d), blocks = $$(".bp-ms", m), t0 = j * 120;
      if (r.off) return;
      // the one specialist code picked (or "No AI called") shows the moment it is decided
      const aiEl = m.querySelector(".bp-mini-ai"), ai = B.pick(t, d, S), si = ai ? r.steps.findIndex((s) => s.sp == ai) : r.steps.findIndex((s) => s.result == "hit");
      const sx = si < 0 ? r.steps[r.steps.length - 1] : r.steps[si];
      tl.at(t0 + (sx.at + (ai ? 0 : sx.dur)) * 0.6, () => aiEl.classList.remove("is-wait"));
      r.steps.forEach((s, i) => {
        const a = t0 + s.at * 0.6;
        tl.at(a, () => (blocks[i].dataset.state = s.result == "skipped" ? "skip" : "work"));
        tl.at(a + Math.max(s.dur * 0.6, 90), () => (blocks[i].dataset.state = s.result == "hit" && s.sp == "safety" ? "hit" : RES[s.result] || "pass"));
      });
      const last = r.steps[r.steps.length - 1], e = t0 + (last.at + last.dur) * 0.6 + 150;
      tl.at(e, () => m.querySelector(".sc-lane").classList.remove("is-wait"));
      endAt = Math.max(endAt, e);
    });
    tl.at(endAt + 200, () => { $(".bp-totals", allBox).textContent = B.totals(d, S); B.say(B.totals(d, S)); });
    const p = tl.play(1);
    if (RM()) tl.skip();
    return p;
  }
  let allTl = null;

  measure();
  const api = { run, settings: S, data: d, scene: sc, showAll, closest, get result() { return R; } };
  el._brainPlay = api;
  return api;
}
