/* The playground ("Throw a moment at your Brain", /trainer-brain and /demo):
   its first frame, as HTML strings. Pure: no CSS, no DOM, nothing at import,
   so the server render (render.ts) and the tests import it; play.js, the
   runtime, adopts the same markup and builds on these atoms. Ported from the
   approved prototype's static half (docs/marketing-revamp-2026-10-26/
   prototypes/shared/brain/brain-play.js, in concept A's skin) with the
   changes of docs/marketing-revamp-2026-10-26/phase1/PLAN.md §1.1 and WP3b:
   - the root's inner HTML only (render.ts writes the root); heading: false
     leaves the H2 to the page;
   - every inner id starts with the host id (o.id): the prototype rendered
     undefined-* ids;
   - the call to action comes from the options (ui.js cta());
   - the frame is the first moment (t1) played to its end: node states, the
     steps, the result and its settings. Visitors who never get the engine
     read all of it, and the engine starts from it without moving anything;
     its controls wait, disabled, for the engine;
   - with attract (the page plays that moment once on its own), what the run
     plays carries .sc-res and the nodes look idle until the engine starts
     (app/brain-stage.css, app/brain-play.css);
   - no live region of its own: the engine announces through the overlay
     layer's (core.js say());
   - "Step by step" and "Change a setting" are phone-only toggles over
     regions the desktop always shows, so no width needs another first
     frame; the Pause label keeps one width; the canvas, the skip link, the
     stamp and the "Throw them all" box are the engine's to add. */
import { esc } from "./core.js";
import { decide, defaults, isOff } from "./decide.js";
import * as U from "./ui.js";

/** The root element's classes for each kind this module renders (render.ts). */
export const ROOT = { play: "bp" };

export const COPY = {
  h2: "Throw a moment at your Brain", lede: "Pick something a member might say. Watch each check and specialist work. Then change a setting and run it again.",
  placeholder: "Or type what a member might say", run: "Run it", all: "Throw them all", change: "Change a setting", again: "Run it again",
  panel: "What each step said", skip: "Skip to result", steps: "Step by step", moments: "Sample moments",
  closest: "Closest sample: {chip}. This page can't read new messages.", more: "More moments", specialty: "Your specialty",
  allTitle: "Every sample moment at once", back: "Back to one moment", result: "Result", off: "Built and tested. Not on yet.",
  picks: "Code picks", stop: "STOP · No AI called", pause: "Pause", play: "Play", how: "How we count",
  lock: "Safety rules · can't switch off", lockTip: "Safety rules can't be switched off. You can only make them stricter.",
};
/** The moment the first frame shows played, and the one attract plays. */
export const FIRST = "t1";
/** "Your specialty" only reorders the chips (traces by number; the first 6 show on phones). */
export const SPECS = [["strength", "Strength", [1, 6, 8, 2, 5, 10, 3, 9, 7, 4, 11, 12]], ["weight_loss", "Weight loss", [4, 10, 8, 9, 2, 1, 3, 6, 7, 5, 12, 11]],
  ["muscle_gain", "Muscle gain", [10, 1, 8, 9, 4, 6, 5, 2, 3, 7, 12, 11]], ["prenatal", "Pre- and postnatal", [11, 2, 12, 10, 5, 4, 9, 1, 8, 6, 3, 7]]];
/* Free text → the closest sample, through this table only: no network, no
   safety rules in the browser (the owner's default). Specific matches first,
   so "chest pain" is t12, not t2. */
const KEYS = [[/pregnan|حامل/i, 11], [/chest|dizzy|faint|numb|ألم|يعور|دوخة|صدري/i, 12], [/pain|hurt|injur|pop|swell|knee/i, 2],
  [/creatine|supplement|protein powder|pre-workout|vitamin|medication/i, 9], [/deload|skip|rest week/i, 6], [/easy|heavier|add weight|go up|\brir\b/i, 1],
  [/photo|meal|\bate\b|lunch|calories/i, 4], [/tired|sleep|recovery|whoop|hrv/i, 3], [/\bnew\b|plan|programme/i, 10], [/week/i, 8], [/voice|talk|session/i, 5]];
export const closest = (text) => "t" + ((KEYS.find(([re]) => re.test(text)) || [0, 1])[1]);
/** The AI specialists code picks from, in the "Your Brain" shell. */
export const COACH = ["reply_picker", "draft_writer", "plan_writer", "week_reviewer", "meal_photo", "voice_lines"];
const KIND = { chat_action: "Chat · a rule fits", chat_review: "Chat · a rule fits", topic: "Chat · your topic", floor: "Chat", plan: "", meal: "Meal photo", voice: "Before a voice session", learn: "Chat · no rule fits", recovery: "Workout starts" };
/** The kind of moment, as the shell's tag shows it (code picks the specialist from it). */
export const kindTag = (t, r) => (t.decide == "plan" ? (t.channel == "week_end" ? "Week ends" : "New plan") : r.steps.some((s) => s.sp == "draft_writer") && t.decide != "learn" ? "Chat · no rule fits" : KIND[t.decide]);
export const RES = { clear: "pass", read: "pass", found: "pass", pass: "pass", applied: "pass", confirmed: "pass", asks: "pass", score: "pass", none: "warn", warn: "warn", skipped: "skip",
  sent: "sent", waits: "waits", paused: "paused", picked: "lit", review: "lit", wrote: "lit", estimated: "lit", suggested: "lit" };
/** A step's node state once it has run: a safety hit stops, any other hit warns. */
export const stateOf = (s) => (s.result == "hit" ? (s.sp == "safety" ? "hit" : "warn") : RES[s.result] || "pass");
/** The Confidence node's value: the plan's score against your bar; chat has none. */
export const sureVal = (t, r) => (r.sure ? r.sure.display.replace(" · your bar", " · bar") : t.sure ? "" : "—");
const initials = (n) => n.split(/\s+/).map((x) => x[0]).join("").slice(0, 2).toUpperCase();

/* ------------------------------------------------------------------ atoms */
/** "Change and run again": only the settings this moment reads. u: the host id. */
export function controlsHTML(d, t, S, u) {
  const L = d.labels, out = [];
  const rng = (k, lab, min, max, v, unit = "%") => `<label class="bp-ctl"><span>${esc(lab)}</span><span class="bp-rng"><input type="range" data-k="${k}" min="${min}" max="${max}" step="1" value="${v}" aria-valuetext="${v}${unit}"><output>${v}${unit}</output></span></label>`;
  const sw = (k, lab, on, sub) => `<label class="bp-ctl bp-sw"><input type="checkbox" role="switch" data-k="${k}"${on ? " checked" : ""}><span>${esc(lab)}${sub ? `<small>${esc(sub)}</small>` : ""}</span></label>`;
  const seg = (k, lab, opts, v) => `<div class="bp-ctl"><span id="${u}-${k}">${esc(lab)}</span><div class="bp-seg" role="radiogroup" aria-labelledby="${u}-${k}">${opts.map(([val, txt]) => `<button type="button" role="radio" data-k="${k}" data-v="${val}" aria-checked="${String(val) == String(v)}" tabindex="${String(val) == String(v) ? 0 : -1}">${esc(txt)}</button>`).join("")}</div></div>`;
  for (const c of t.controls) {
    if (c == "level") out.push(seg("level", "Brain level", [1, 2, 3].map((n) => [n, `${n} ${L.levels[n].name}`]), S.level) + `<p class="bp-sum">${esc(L.levels[S.level].summary)}</p>` +
      (t.decide == "chat_action" ? sw("lastCheckPassing", "Last check: passed (sample)", S.lastCheckPassing, L.levels.note) : ""));
    if (c == "capPct") out.push(rng("capPct", "Maximum increase (%)", 1, 10, S.capPct));
    if (c == "minRir") out.push(rng("minRir", "Minimum recorded repetitions in reserve", 1, 10, S.minRir, ""));
    if (c == "safetyLocked") out.push(`<button type="button" class="bp-lock" data-lock aria-describedby="${u}-locktip">${U.icon("lock")}<span>${esc(COPY.lock)}</span></button><p class="bp-locktip" id="${u}-locktip" hidden>${esc(COPY.lockTip)}</p>`);
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
/** The result column: the lane, what the member sees, what you see, your rule. */
export function resultHTML(d, t, r, prev) {
  if (r.off) return `<div class="bp-offcard"><b>${esc(t.chip)}</b>${U.lane(d, "sent", "is-dashed")}<p>${esc(COPY.off)}</p><ul>${t.steps[1].detail.map((x) => `<li>${esc(x)}</li>`).join("")}</ul><p class="bp-note">${esc(d.labels.basis.tests)} · ${esc(d.labels.recoveryCaption)}</p></div>`;
  const changed = prev && prev != r.lane;
  return `<div class="bp-res-h">${esc(COPY.result)} · ${esc(t.member)}</div><div class="bp-lanewrap">${U.lane(d, r.lane)}${changed ? U.lane(d, prev, "is-ghost") : ""}</div>` +
    (r.why || changed ? `<p class="bp-why">${changed ? `Before: ${esc(d.labels.lanes[prev])}. Now: ${esc(d.labels.lanes[r.lane])}. ` : ""}${r.why ? "Why: " + esc(r.why) : ""}</p>` : "") +
    (r.tag ? `<p class="bp-note"><span class="bp-tag">${esc(r.tag)}</span> ${esc(r.note || "")}</p>` : r.note ? `<p class="bp-note">${esc(r.note)}</p>` : "") +
    (r.sure ? U.sure(d, t, r) : "") + U.phone(d, t, r) + `<div class="bp-yousee"><span class="bp-k">What you see</span>${U.today(d, t, r)}</div>` + U.rule(t);
}
/** The member's message; hl: the words a safety hit marks. */
export const msgHTML = (t, hl) => `<div class="bp-msg"><span class="bp-av">${esc(initials(t.member))}</span><div class="bp-mb"><div class="bp-mh"><b>${esc(t.member)}</b><span>${esc(t.channel.replace(/_/g, " "))} · ${esc(t.when)} · sample</span></div>` +
  `<p class="bp-mt" dir="${t.trigger.lang == "ar" ? "rtl" : "ltr"}" lang="${t.trigger.lang}">${hl ? hlText(t.trigger.text, hl) : esc(t.trigger.text)}</p>${t.trigger.gloss ? `<p class="bp-gloss">${esc(t.trigger.gloss)}</p>` : ""}</div></div>`;
export function hlText(txt, words) {
  let s = esc(txt);
  for (const w of words) s = s.split(esc(w)).join(`<mark class="bp-hl">${esc(w)}</mark>`);
  return s;
}
/** The log's rows for steps from..end: code picks first, then each step as it said it. */
export const picksRow = (d, i) => `<li class="sc-step bp-picks" data-i="${i}">${esc(d.labels.picks)}</li>`;
export const isPick = (d, s) => s.sp in d.sp && d.sp[s.sp].kind == "ai" && s.sp != "learner";
const chipHTML = (d, t, S, on) => `<button type="button" class="bp-chip" data-t="${d.short(t)}" aria-pressed="${on}"${isOff(t, S) ? " data-off" : ""}>${esc(t.chip)}${isOff(t, S) ? `<small>${esc(d.labels.status.not_on_yet)}</small>` : ""}</button>`;

/** The diagram: checks first, the shell code picks one specialist in, checks after, the lanes, what learns, the shelf, your rulebook. */
function nodesHTML(d, S, t, r, a) {
  const end = {};
  for (const s of r.steps) end[s.sp] = [stateOf(s), s.result == "skipped" ? "Not reached" : ""];
  if (end.confidence) end.confidence[1] = sureVal(t, r);
  else end.confidence = ["idle", sureVal(t, r)];
  const n = (sp, o) => {
    const e = end[sp], html = U.node(sp, d, o);
    return e ? html.replace('data-state="idle"', `data-state="${e[0]}"`).replace('<span class="sc-val" aria-hidden="true"></span>', `<span class="sc-val" aria-hidden="true">${esc(e[1])}</span>`) : html;
  };
  // The safety node is the platform's rule, as a stop's result names it ("Platform safety rules", "{APP_NAME}. Can't switch off.").
  const safe = d.sp.safety, rule = d.trace("t2").rule;
  const safety = n("safety", { title: false }).replace('data-sp="safety"', `data-sp="safety" title="${esc(`${safe.name}: ${safe.line} ${rule.title}: ${rule.source}`)}"`);
  const lanes = [["sent", d.labels.lanes.sent.split(",")[0]], ["waits", "Your Today"], ["paused", d.labels.lanes.paused]];
  return msgHTML(t) +
    `<div class="bp-band" data-band="before"><div class="bp-bl"><span>Checks first</span><span class="bp-rules">Your rules</span></div><div class="bp-row bp-r4">${safety}${["topics", "memory", "rule_finder"].map((s) => n(s)).join("")}</div></div>` +
    `<div class="bp-shell"><div class="bp-sh-h"><span class="bp-mono">LS</span><b>Your Brain</b><span class="bp-cap">Code picks one specialist per moment</span><span class="bp-kind${a}">${esc(kindTag(t, r))}</span></div>` +
    `<div class="bp-pills">${COACH.map((s) => n(s)).join("")}</div><div class="bp-row2">${n("set_logger", { name: "Set logger" })}${S.recoveryFlag ? n("recovery", { on: 1 }) : ""}<span class="bp-cl">code rules for workouts</span></div></div>` +
    `<div class="bp-band" data-band="after"><div class="bp-bl"><span>Checks after</span><span class="bp-rules">Your rules</span></div><div class="bp-row bp-r3">${["checker", "confidence", "lane_gate"].map((s) => n(s)).join("")}</div></div>` +
    `<div class="bp-lanes">${lanes.map(([l, txt]) => `<div class="bp-bin" data-lane="${l}"${l == r.lane ? " data-hot" : ""}>${l == "waits" ? '<span class="bp-mono">LS</span>' : ""}<span>${esc(txt)}</span></div>`).join("")}</div>` +
    `<div class="bp-low"><div class="bp-learn"><span class="bp-bl">Learns from you</span><div class="bp-lrow"><div class="sc-node bp-priv" data-sp="code" data-kind="check" data-state="${end.code ? end.code[0] : "idle"}"><span class="sc-mx" aria-hidden="true"></span>${U.icon("eye-off")}<span class="sc-nm">Privacy</span><span class="sc-val" aria-hidden="true"></span></div>${n("learner")}${n("examiner")}</div></div>` +
    `<div class="bp-shelf"><span class="bp-bl">${esc(d.labels.status.not_on_yet)}</span><div class="bp-lrow">${n("meal_planner")}${S.recoveryFlag ? "" : n("recovery")}</div></div></div>` +
    `<aside class="bp-book"><span>Your method · <b>24</b> rules (sample)</span></aside>`;
}

/** The root's inner HTML: the playground with its first moment played. */
export function renderStatic(d, o) {
  const S = defaults(d), t = d.trace(FIRST), r = decide(t, S, d), u = o.id;
  // With attract, the engine plays this moment once: what it plays waits for it.
  const a = o.attract ? " sc-res" : "";
  const ord = SPECS[0][2], i0 = r.steps.findIndex((s) => isPick(d, s));
  const rows = r.steps.map((s, i) => (i == i0 ? picksRow(d, i) : "") + U.stepRow(d, t, s).replace('<li class="sc-step"', `<li class="sc-step" data-i="${i}"`)).join("");
  const html = (o.heading === false ? "" : `<div class="bp-head"><h2 id="${u}-h">${esc(COPY.h2)}</h2><p>${esc(COPY.lede)}</p></div>`) +
    `<p class="bp-banner">${esc(d.labels.long)}</p><div class="bp-grid"><div class="bp-pick">` +
    `<label class="bp-lab"><span>${esc(COPY.specialty)}</span><select data-spec>${SPECS.map(([k, n]) => `<option value="${k}">${esc(n)}</option>`).join("")}</select></label>` +
    `<div class="bp-chips" role="group" aria-label="${esc(COPY.moments)}">${ord.map((i) => chipHTML(d, d.trace("t" + i), S, "t" + i == FIRST)).join("")}</div>` +
    `<button type="button" class="bp-more" aria-expanded="false">${esc(COPY.more)}</button>` +
    `<form class="bp-free"><label class="sc-sr" for="${u}-text">${esc(COPY.placeholder)}</label><textarea id="${u}-text" rows="2" maxlength="140" placeholder="${esc(COPY.placeholder)}"></textarea><button class="bp-btn bp-btn-p">${esc(COPY.run)}</button></form>` +
    `<p class="bp-closest"></p><button type="button" class="bp-btn bp-all-b">${U.icon("layers")}<span>${esc(COPY.all)}</span></button></div>` +
    `<div class="bp-stage sc-stage"><div class="bp-top">${U.strip(d)}<button type="button" class="bp-pause" aria-pressed="false"><span data-label>${esc(COPY.pause)}</span><span class="bp-psz" aria-hidden="true">${esc(COPY.pause)}</span></button></div>` +
    `<div class="bp-diagram"${o.attract ? " data-attract" : ""}>${nodesHTML(d, S, t, r, a)}</div>` +
    `<div class="bp-logd"><button type="button" class="bp-tg" aria-expanded="false" aria-controls="${u}-log">${esc(COPY.steps)}</button><div class="bp-log" id="${u}-log"><h3>${esc(COPY.panel)}</h3><div class="bp-logs"><ol${o.attract ? ' class="sc-res"' : ""}>${rows}</ol></div></div></div>` +
    `<div class="bp-foot"><span>${esc(d.labels.rates)}</span><span>${esc(d.labels.speed)}</span><button type="button" class="bp-how" aria-expanded="false" aria-controls="${u}-how">${esc(COPY.how)}</button><p class="bp-hownote" id="${u}-how" hidden>${esc(d.labels.howWeCount)}</p></div></div>` +
    `<div class="bp-out" id="${u}-out" tabindex="-1"><div class="bp-res${a}">${resultHTML(d, t, r)}</div>` +
    `<div class="bp-change${a}"><p class="bp-chg-h">${esc(COPY.change)}</p><button type="button" class="bp-tg" aria-expanded="false" aria-controls="${u}-set">${esc(COPY.change)}</button>` +
    `<div class="bp-set" id="${u}-set"><div class="bp-ctls">${controlsHTML(d, t, S, u)}</div><button type="button" class="bp-btn bp-again">${esc(COPY.again)}</button></div></div>` +
    U.cta(o, "bp-btn bp-btn-p bp-cta") + `</div></div>`;
  // Until the engine plays, its controls are not pressable (it enables what it wires).
  return html.replace(/<(button|select|textarea|input)\b/g, "<$1 disabled");
}
