/* trainsyou · Concept A "Live Brain" · Mission control (showcase-final.md §2).
   renderStatic(d)   server-rendered first frame (runs in Node and the browser).
   renderBoard(d)    home band 2, "Change a setting. Watch it re-sort." (static).
   mount(el)         bootstrap entry: data-showcase="field" | "board".
   Static rails: inline SVG drawn once per layout, under the HTML nodes. Everything that moves (rail dashes, dots,
   ghosts, rule lines, the nodes' 3×3 matrices): one canvas above the nodes; lines stop at node/lane/message boxes.
   One rAF loop (core). */
import * as C from "./brain/brain-core.js";
import { defaults, decide, isOff, pick, totals } from "./brain/brain-decide.js";
import * as U from "./brain/brain-ui.js";
const { h, esc, clamp } = C;

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
  lock: "Safety rules · can't switch off", lockTip: "Safety rules can't be switched off. You can only make them stricter.",
  lastCheck: "Last check: passed (sample)", supp: "Supplement questions: I answer myself", suppSub: "Your choice · off by default",
  suppOff: "Supplements still never send on their own.", drafted: "Drafted for you", more: "More settings", done: "Done",
  demo: "Demo", reading: "Paused while you read", play: "Play the field", stop: "STOP · No AI called", noAi: "No AI called",
  members: "Sample members. Open any moment to see each step.", level: "Brain level", picks: "Code picks",
  learn: ["You edit Zayed's draft", "Privacy: name becomes [client]", "Make this a rule?", "Confirmed", "About a minute later", "Passed · live"],
};
const FIRST = ["safety", "topics", "memory", "rule_finder"], AFTER = ["checker", "confidence", "lane_gate"];
const SHELL = [["reply_picker", "draft_writer", "plan_writer"], ["week_reviewer", "meal_photo", "voice_lines"]];
const ROWS = ["t2", "t1", "t8", "t4", "t10", "t7", "t9", "t5", "t6", "t11", "t12"];
/* Field-only presentation: tile label, member-row chip, event icon, incoming text for events. */
const FX = {
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
const BUB = { voice_lines: "Lines ready", learner: "Suggests: Upper body increments" };
const BLIP_AI = 620, BLIP_CODE = 300; // a ghost (another member's moment) passing through a node: how long it shows busy
const CAP = { sent: 12, waits: 8, paused: 4 }, SHOW = { sent: 4, waits: 3, paused: 2 };
/* First frame (spec §2 storyboard): lanes already hold these. */
const START = { sent: [["t10", 1], ["t5", 1]], waits: [["t9", 1]], paused: [["t11", 1]] };
const id0 = (t) => t.id.split("-")[0];
const tag = (id) => (id == "t10" ? "Spot check" : id == "t5" ? "Your rule, applied by code" : "");

/* ------------------------------------------------------------------ static markup */
function nodeHTML(d, sp, o = {}) {
  const s = d.sp[sp], off = s.status == "not_on_yet";
  return `<div class="sc-node mc-n${o.cls ? " " + o.cls : ""}" data-sp="${sp}" data-kind="${s.kind}" data-state="${o.state || "idle"}"${o.who ? ` data-who="${o.who}"` : ""}${off ? " data-off" : ""} title="${esc(s.name + ": " + s.line + (s.statusTip ? " " + s.statusTip : ""))}">` +
    `<span class="sc-mx"></span>${U.icon(s.icon, 14)}<span class="sc-nm">${esc(o.name || s.name)}</span>` +
    (s.usesAi ? `<span class="sc-badge">uses your AI</span>` : "") + (off ? `<span class="sc-offchip">Not on yet</span>` : "") +
    `<span class="mc-v">${o.val || ""}</span>${o.extra || ""}</div>`;
}
const tileHTML = (d, id, n = 1, cls = "") => {
  const t = d.trace(id), tg = tag(id);
  return `<li class="mc-li${cls}" data-t="${id}" data-n="${n}"><button type="button" class="mc-tile" data-t="${id}" tabindex="-1"><span class="mc-tn">${esc(t.member)} · ${esc(FX[id][0])}</span>${tg ? `<span class="mc-tag">${esc(tg)}</span>` : ""}<span class="mc-sub2"></span></button></li>`;
};
function msgHTML(t, hit) {
  let m = esc(FX[id0(t)][3] || t.trigger.text);
  const st = t.steps.find((s) => s.sp == "safety" && s.result == "hit");
  if (st) for (const w of st.highlight || []) m = m.split(esc(w)).join(`<mark class="mc-hl">${esc(w)}</mark>`);
  const ar = t.trigger.lang == "ar";
  return `<div class="mc-msg${hit ? " is-hit" : ""}" data-t="${id0(t)}"><span class="mc-mh"><span class="mc-av">${esc(t.member[0])}</span><b>${esc(t.member)}</b></span><span class="mc-mt"${ar ? ' dir="rtl" lang="ar"' : ""}><b>${esc(t.member)}</b>${m}</span></div>`;
}

/** The field's first frame (spec §2 "First frame"). Result states carry .mc-res
    and stay hidden under data-sc="pre" until the module plays (or 6 s pass). */
export function renderStatic(d, o = {}) {
  const S = defaults(d), lv = d.labels.levels;
  const count = (l) => START[l].length + (l == "paused" ? 1 : 0);
  const lane = (l) => {
    const [a, b] = COPY.lanes[l], pre = START[l].length, n = count(l);
    return `<section class="mc-lane" data-lane="${l}" aria-labelledby="mc-l-${l}">
<p class="mc-lh" id="mc-l-${l}">${l == "waits" ? `<span class="mc-ls" aria-hidden="true">LS</span>` : ""}<span class="mc-ln">${l == "paused" ? `<span class="mc-lnx">Training </span><span class="mc-lnp">paused</span>` : esc(a)}</span><span class="mc-lsub">${esc(b)}</span><span class="mc-c" aria-hidden="true">${n != pre ? `<span class="mc-pre">${pre}</span><span class="mc-res">${n}</span>` : n}</span><span class="sc-sr mc-csr">: ${n} in this sample hour</span></p>
<ul class="mc-tl">${l == "paused" ? tileHTML(d, "t2", 1, " mc-res") : ""}${START[l].map(([id]) => tileHTML(d, id)).join("")}</ul>
<p class="mc-more" hidden></p>${l == "waits" ? `<p class="mc-chk2">${esc(COPY.toCheck)}: <b>1</b></p>` : ""}
<button type="button" class="mc-bin" data-bin="${l}" disabled><span class="mc-last">${esc(d.trace((l == "paused" ? [["t2"]] : START[l])[0][0]).member)}</span><span class="sc-sr"> — open the list</span></button>
</section>`;
  };
  const members = ROWS.map((id, i) => {
    const t = d.trace(id);
    return `<li><button type="button" class="mc-m${i < 2 ? " is-on" : ""}" data-t="${id}" tabindex="${i ? -1 : 0}" disabled><span class="mc-av">${esc(t.member[0])}</span><span class="mc-mtx"><b>${esc(t.member)}</b><span class="mc-mc"${t.trigger.lang == "ar" ? ' dir="rtl" lang="ar"' : ""}>${esc(FX[id][1])}</span></span>${U.icon(FX[id][2], 12)}<span class="sc-sr"> — ${esc(t.chip)}. See each step.</span></button></li>`;
  }).join("");
  const t2 = d.trace("t2");
  const conf = `<span class="mc-gauge" aria-hidden="true"><i></i><b style="--bar:${S.bar}%"></b></span>`;
  const lvBtn = (n) => `<button type="button" role="radio" aria-checked="${n == S.level}" tabindex="${n == S.level ? 0 : -1}" data-level="${n}" disabled><b>${n}</b> <span class="mc-lvn">${esc(lv[n].name)}</span></button>`;
  return `<p class="sc-sr">${esc(COPY.sr)}</p>
<div class="mc-head"><p class="mc-eyebrow">${esc(d.labels.eyebrow)}</p><span class="mc-reading" hidden>${esc(COPY.reading)}</span>
<span class="mc-legend" aria-hidden="true"><span><i class="mc-lp"></i>${esc(COPY.legend[0])}</span><span><i class="mc-lq"></i>${esc(COPY.legend[1])}</span><span><i class="mc-lg"></i>${esc(COPY.legend[2])}</span></span>
<button type="button" class="mc-pause" aria-pressed="false" disabled><span class="mc-ip">${U.icon("pause", 12)}</span><span class="mc-ipl">${U.icon("play", 12)}</span><span data-label>Pause</span></button></div>
<div class="sc-strip mc-strip"><span class="mc-subs">${esc(d.labels.subscribers)}</span></div>
<div class="mc-body">
<canvas class="mc-cv" aria-hidden="true"></canvas><canvas class="mc-cv mc-cv2" aria-hidden="true"></canvas>
<ul class="mc-mem" aria-label="${esc(COPY.members)}">${members}</ul>
<div class="mc-frame" aria-hidden="true">
  <div class="mc-in">${msgHTML(t2, true).replace('class="mc-msg is-hit"', 'class="mc-msg is-hit mc-hitres"')}</div>
  <p class="mc-bl mc-bl1"><span>${esc(COPY.bands[0])}</span><span class="mc-br">${esc(COPY.rules)}</span></p>
  <div class="mc-row mc-first">${FIRST.map((sp) => nodeHTML(d, sp, sp == "safety" ? { state: "hit", cls: "mc-hitres", who: "N" } : {})).join("")}</div>
  <div class="mc-shell">
    <p class="mc-st"><span class="mc-mono">LS</span><b>${esc(COPY.bands[1])}</b><span class="mc-cap">${esc(COPY.shellCap)}</span></p>
    ${SHELL.map((r) => `<div class="mc-row mc-r3">${r.map((sp) => nodeHTML(d, sp, sp == "reply_picker" ? { state: "lit", who: "O" } : {})).join("")}</div>`).join("")}
    <div class="mc-row mc-r3 mc-r3b">${nodeHTML(d, "set_logger")}<span class="mc-cr">${esc(COPY.codeRule)}</span></div>
    <span class="mc-noy" aria-hidden="true">Not on yet: 2</span>
  </div>
  <p class="mc-stamp mc-res">${esc(COPY.stop)}</p>
  <p class="mc-bl mc-bl2"><span>${esc(COPY.bands[2])}</span><span class="mc-br">${esc(COPY.rules)}</span></p>
  <div class="mc-row mc-after">${AFTER.map((sp) => nodeHTML(d, sp, sp == "confidence" ? { extra: conf } : {})).join("")}</div>
  <div class="mc-learn"><span class="mc-k">${esc(COPY.bands[3])}</span>
    <div class="sc-node mc-n mc-tiny" data-sp="privacy" data-kind="check" data-state="idle" title="Privacy: code turns the client's name into [client]. Their message is never sent."><span class="sc-mx"></span>${U.icon("eye-off", 12)}<span class="sc-nm">Privacy</span><span class="mc-v"></span></div>
    ${nodeHTML(d, "learner", { cls: "mc-tiny" })}${nodeHTML(d, "examiner", { cls: "mc-tiny" })}</div>
  <div class="mc-shelf"><span class="mc-k">${esc(COPY.bands[4])}</span>${nodeHTML(d, "meal_planner", { cls: "mc-tiny" })}${nodeHTML(d, "recovery", { cls: "mc-tiny" })}</div>
  <div class="mc-spine"><span class="mc-bk"><b class="mc-bn">24</b> ${esc(COPY.book[1])}</span><span class="mc-bt2">${esc(COPY.book[0])}</span><span class="mc-new">Upper body increments</span></div>
</div>
<div class="mc-lanes"><p class="mc-lcap">${esc(COPY.hour)}</p>${["sent", "waits", "paused"].map(lane).join("")}</div>
<div class="mc-learncard" hidden></div>
</div>
<p class="mc-sub" aria-hidden="true"><span class="mc-s1 is-on">${subHTML(t2)}</span><span class="mc-s2"></span></p>
<div class="mc-ctrl">
  <div class="mc-lv" role="radiogroup" aria-label="${esc(COPY.level)}"><span class="mc-k" aria-hidden="true">${esc(COPY.level)}</span>${[1, 2, 3].map(lvBtn).join("")}<span class="mc-demo" aria-hidden="true">${esc(COPY.demo)}</span></div>
  <button type="button" class="mc-moreb" aria-expanded="false" aria-controls="mc-sheet" disabled>${U.icon("sliders-horizontal", 14)}${esc(COPY.more)}</button>
  <div class="mc-sheet" id="mc-sheet" role="group" aria-label="${esc(COPY.more)}">
    <p class="mc-sheet-h"><b>${esc(COPY.more)}</b><button type="button" class="mc-x" data-close disabled>${esc(COPY.done)}</button></p>
    <span class="mc-chk" tabindex="0" aria-describedby="mc-tip-l">${U.icon("check", 12)}${esc(COPY.lastCheck)}<span class="mc-tip" role="tooltip" id="mc-tip-l">${esc(lv.note)}</span></span>
    <label class="mc-bar"><span>${esc(d.labels.planSetting.label)}</span><span class="mc-bari"><input type="range" min="${d.labels.planSetting.min}" max="${d.labels.planSetting.max}" step="1" value="${S.bar}" aria-valuetext="${S.bar}%" disabled><output>${S.bar}%</output></span></label>
    <button type="button" class="mc-sw" role="switch" aria-checked="${S.supplementsTopic}" disabled><span class="mc-swk" aria-hidden="true"></span><span><b>${esc(COPY.supp)}</b><small>${esc(COPY.suppSub)}</small></span></button>
    <button type="button" class="mc-lock" aria-describedby="mc-tip-k" disabled>${U.icon("lock", 12)}${esc(COPY.lock)}<span class="mc-tip" role="tooltip" id="mc-tip-k">${esc(COPY.lockTip)}</span></button>
  </div>
</div>
<div class="mc-foot"><span class="sc-sample">${esc(d.labels.chip)}</span><span>${esc(d.labels.rates)}</span><button type="button" class="mc-how" aria-expanded="false" aria-controls="mc-howp" disabled>How we count</button><p class="mc-howp" id="mc-howp" hidden>${esc(d.labels.howWeCount)}</p></div>
<p class="mc-rm" hidden></p>`;
}
function subHTML(t) {
  let s = esc(t.subtitle);
  const st = t.steps.find((x) => x.sp == "safety" && x.result == "hit");
  if (st) for (const w of st.highlight || []) s = s.split(esc(w)).join(`<em class="mc-red">${esc(w)}</em>`);
  return s.replace(/ → /g, ` <i>→</i> `).replace(/^([^:]+:)/, "<b>$1</b>");
}

/* ------------------------------------------------------------------ board (home band 2) */
const BLANES = ["sent", "waits", "paused", "member", "learn"];
function boardCard(d, t, r) {
  const id = id0(t), st = r.steps.find((x) => x.sp in d.sp && d.sp[x.sp].kind == "ai" && x.sp != "learner");
  const who = st ? d.sp[st.sp] : null, hit = r.steps.find((x) => x.result == "hit");
  const by = hit ? `${d.sp[hit.sp].name} · ${COPY.noAi}` : who ? who.name : COPY.noAi;
  const code = t.decide == "voice" ? `<span class="mb-by" data-kind="check"><i aria-hidden="true"></i>Set logger · your rule</span>` : "";
  return `<li class="mb-c" data-t="${id}"><button type="button" class="mb-b" data-t="${id}"><span class="mb-h"><span class="mc-av">${esc(t.member[0])}</span><b>${esc(t.member)}</b><span>${esc(t.chip)}</span></span>` +
    `<span class="mb-by" data-kind="${who ? "ai" : "check"}"><i aria-hidden="true"></i>${esc(by)}</span>${code}${r.sure ? `<span class="mb-sure" data-ok="${r.lane == "sent" ? 1 : 0}">${esc(r.sure.display)}</span>` : ""}<span class="mb-why"></span></button></li>`;
}
export function renderBoard(d) {
  const S = defaults(d), lv = d.labels.levels, cols = {};
  BLANES.forEach((l) => (cols[l] = []));
  for (const t of d.traces) if (!isOff(t, S)) { const r = decide(t, S, d); cols[r.lane].push(boardCard(d, t, r)); }
  const lvBtn = (n) => `<button type="button" role="radio" aria-checked="${n == S.level}" tabindex="${n == S.level ? 0 : -1}" data-level="${n}" disabled><b>${n}</b> ${esc(lv[n].name)}</button>`;
  return `<div class="mb-ctrl">
  <div class="mc-lv" role="radiogroup" aria-label="${esc(COPY.level)}"><span class="mc-k" aria-hidden="true">${esc(COPY.level)}</span>${[1, 2, 3].map(lvBtn).join("")}</div>
  <label class="mc-bar"><span>${esc(d.labels.planSetting.label)}</span><span class="mc-bari"><input type="range" min="${d.labels.planSetting.min}" max="${d.labels.planSetting.max}" step="1" value="${S.bar}" aria-valuetext="${S.bar}%" disabled><output>${S.bar}%</output></span></label>
  <button type="button" class="mc-sw" role="switch" aria-checked="${S.supplementsTopic}" disabled><span class="mc-swk" aria-hidden="true"></span><span><b>${esc(COPY.supp)}</b><small>${esc(COPY.suppSub)}</small></span></button>
  <button type="button" class="mc-lock" aria-describedby="mb-tip-k" disabled>${U.icon("lock", 12)}${esc(COPY.lock)}<span class="mc-tip" role="tooltip" id="mb-tip-k">${esc(COPY.lockTip)}</span></button>
</div>
<p class="mb-note" aria-hidden="true">${esc(lv[S.level].summary)}</p>
<div class="mb-cols">${BLANES.map((l) => `<section class="mb-col" data-lane="${l}" aria-labelledby="mb-h-${l}"><p class="mb-ch" id="mb-h-${l}">${U.lane(d, l)}<span class="mb-n">${cols[l].length}</span></p><ul class="mb-list">${cols[l].join("")}</ul></section>`).join("")}</div>
<p class="mb-diff" role="status"></p>
<p class="mb-tot">${esc(totals(d, S))}</p>
<div class="sc-strip"><span class="sc-sample">${esc(d.labels.chip)}</span><span>${esc(d.labels.rates)}</span><span>${esc(d.labels.subscribers)}</span></div>`;
}

/* ================================================================== runtime */
const DBG = typeof location != "undefined" ? new URLSearchParams(location.search).get("dbg") || "" : "";
const PACE = "#D5F24A", RED = "#F08A80", AMBER = "#E0B25C", GREEN = "#7FCB9F";
const LC = { sent: GREEN, waits: AMBER, paused: RED, member: "#C9CEC6", learn: PACE };
let D = null, S = null;
const subs = new Set(); // settings listeners (field, board)
let touched = false;    // the visitor used a control: no auto-demo after that

/** One settings object per page; field, board and receipts share it. */
function set(k, v, src) {
  if (S[k] === v) return;
  const before = {};
  for (const t of D.traces) if (!isOff(t, S)) before[id0(t)] = decide(t, S, D);
  S[k] = v;
  subs.forEach((f) => f(k, before, src));
}

export async function mount(el) {
  D = D || (await C.load());
  S = S || defaults(D);
  if (!document.querySelector("link[data-ba-css]")) {
    const l = h("link", { rel: "stylesheet", href: new URL("brain/brain-anatomy.css", import.meta.url).href, "data-ba-css": "" });
    document.head.append(l);
  }
  return el.dataset.showcase == "board" ? mountBoard(el) : mountField(el);
}

/* ------------------------------------------------------------------ shared control wiring */
function wireControls(box, o = {}) {
  const lvs = [...box.querySelectorAll("[data-level]")], rng = box.querySelector(".mc-bar input"), out = box.querySelector(".mc-bar output");
  const sw = box.querySelector(".mc-sw"), lock = box.querySelector(".mc-lock");
  box.querySelectorAll("button[disabled], input[disabled]").forEach((b) => (b.disabled = false));
  const setLv = (n, demo) => {
    if (!demo) touched = true;
    set("level", n, demo ? "demo" : "user"); // every control set's sync() then updates its radios (after the FLIP reads)
  };
  lvs.forEach((b) => {
    b.addEventListener("click", () => setLv(+b.dataset.level));
    b.addEventListener("keydown", (e) => {
      const i = lvs.indexOf(b), k = e.key, n = k == "ArrowRight" || k == "ArrowDown" ? 1 : k == "ArrowLeft" || k == "ArrowUp" ? -1 : 0;
      if (!n) return;
      e.preventDefault();
      const nb = lvs[(i + n + 3) % 3];
      nb.focus(); setLv(+nb.dataset.level);
    });
  });
  let deb = 0;
  rng && rng.addEventListener("input", () => {
    out.textContent = rng.value + "%"; rng.setAttribute("aria-valuetext", rng.value + "%");
    paintRange(rng);
    clearTimeout(deb); deb = setTimeout(() => { touched = true; set("bar", +rng.value, "user"); }, 120);
  });
  rng && paintRange(rng);
  sw && sw.addEventListener("click", () => { touched = true; set("supplementsTopic", !S.supplementsTopic, "user"); });
  lock && lock.addEventListener("click", () => {
    lock.classList.remove("is-shake"); void lock.offsetWidth; lock.classList.add("is-shake");
    lock.classList.add("is-tip"); clearTimeout(lock._t); lock._t = setTimeout(() => lock.classList.remove("is-tip"), 3200);
    C.say(COPY.lockTip);
  });
  const sync = () => {
    lvs.forEach((b) => { const on = +b.dataset.level == S.level; b.setAttribute("aria-checked", on); b.tabIndex = on ? 0 : -1; });
    if (rng && +rng.value != S.bar) { rng.value = S.bar; out.textContent = S.bar + "%"; rng.setAttribute("aria-valuetext", S.bar + "%"); paintRange(rng); }
    sw && sw.setAttribute("aria-checked", S.supplementsTopic);
  };
  subs.add(sync);
  return { setLv, lvs, rng, sw, lock };
}
function paintRange(r) { r.style.setProperty("--fill", ((r.value - r.min) / (r.max - r.min)) * 100 + "%"); }

/* ------------------------------------------------------------------ the board */
function mountBoard(el) {
  const RM = C.reduced();
  wireControls(el);
  const note = el.querySelector(".mb-note"), diff = el.querySelector(".mb-diff"), tot = el.querySelector(".mb-tot");
  const lists = {};
  el.querySelectorAll(".mb-col").forEach((c) => (lists[c.dataset.lane] = c.querySelector(".mb-list")));
  const cards = {};
  el.querySelectorAll(".mb-c").forEach((c) => (cards[c.dataset.t] = c));
  // Re-sort only while the board is on screen. The field's auto-demo changes the level while the board is far below;
  // re-sorting (and measuring every card for FLIP) then costs a whole-page layout nobody sees. Catch up on arrival.
  let seen = false, pend = null;
  if (window.IntersectionObserver) new IntersectionObserver((e) => {
    seen = e[e.length - 1].isIntersecting;
    if (seen && pend) { const k = pend; pend = null; apply(k, "", false); }
  }).observe(el); else seen = true;
  el.addEventListener("click", (e) => {
    const b = e.target.closest(".mb-b");
    if (b) receipt(b.dataset.t, b, null);
  });
  function apply(k, src, anim) {
    const moved = [];
    const first = new Map();
    if (anim) Object.values(cards).forEach((c) => first.set(c, c.getBoundingClientRect()));
    for (const id in cards) {
      const t = D.trace(id), r = decide(t, S, D), c = cards[id], col = c.parentElement.parentElement.dataset.lane;
      const su = c.querySelector(".mb-sure");
      if (su) { su.textContent = r.sure ? r.sure.display : ""; su.dataset.ok = r.lane == "sent" ? 1 : 0; }
      c.querySelector(".mb-why").textContent = id == "t9" && !S.supplementsTopic ? COPY.drafted : "";
      if (col != r.lane) { lists[r.lane].append(c); moved.push([t, col, r]); }
    }
    el.querySelectorAll(".mb-col").forEach((c) => (c.querySelector(".mb-n").textContent = c.querySelectorAll(".mb-c").length));
    if (anim) flip(first, 420);
    note.textContent = k == "level" ? D.labels.levels[S.level].summary + (S.level > 1 ? " " + D.labels.levels.note : "") : k == "supplementsTopic" && !S.supplementsTopic ? COPY.suppOff : note.textContent;
    tot.textContent = totals(D, S);
    // the diff is a live region: it only describes a change the visitor just made (the auto-demo announces nothing)
    diff.textContent = src != "user" ? "" : moved.length ? moved.map(([t, b, r]) => `${t.member}: before, ${D.labels.lanes[b]}. Now, ${D.labels.lanes[r.lane]}.${r.why ? " Why: " + r.why : ""}`).join(" ")
      : k == "bar" ? "No moment crossed your bar." : k == "supplementsTopic" ? (S.supplementsTopic ? "Khalid's question waits for you personally." : "Khalid's question still waits for you, drafted for you. " + COPY.suppOff) : "";
  }
  subs.add((k, before, src) => { if (seen) apply(k, src, !RM); else pend = k; });
}
/** FLIP: first rects in, animate every moved element from there (WAAPI, finite). */
function flip(first, ms) {
  let i = 0;
  first.forEach((a, el) => {
    const b = el.getBoundingClientRect(), dx = a.left - b.left, dy = a.top - b.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    el.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: "none" }], { duration: ms, delay: 40 * i++, easing: "cubic-bezier(.4,0,.2,1)", fill: "backwards" });
  });
}

/** Replays a one-shot CSS effect without a forced reflow: the first time the class starts the CSS animation; after
    that the same keyframes run through WAAPI (pseudo-element effects need WAAPI pseudoElement support). */
const PSEUDO_FX = typeof KeyframeEffect != "undefined" && "pseudoElement" in KeyframeEffect.prototype;
const EASE = "cubic-bezier(.4, 0, .2, 1)", ENTER = "cubic-bezier(.2, .8, .2, 1)", SPRING = "cubic-bezier(.34, 1.4, .64, 1)";
const FXK = {
  "is-land": [[{ opacity: 0, transform: "translateX(-10px)" }, { opacity: 1, transform: "none" }], { duration: 280, easing: ENTER }],
  "is-roll": [[{ opacity: 0.2, transform: "translateY(-6px)" }, { opacity: 1, transform: "none" }], { duration: 280, easing: ENTER }],
  "is-bounce": [[{ transform: "translateY(-4px)" }, { transform: "none" }], { duration: 420, easing: SPRING }],
  "is-flash2": [[{ opacity: 1 }, { opacity: 0 }], { duration: 600, easing: EASE, pseudoElement: "::after" }],
  "is-alarm": [[{ opacity: 1 }, { opacity: 0 }], { duration: 700, easing: EASE, pseudoElement: "::after" }],
  "is-cite": [[{ opacity: 1 }, { opacity: 0 }], { duration: 640, easing: EASE, pseudoElement: "::after" }],
  "is-nudge": [[{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(1.025, 1.3)" }], { duration: 900, iterations: 2, easing: EASE, pseudoElement: "::after" }],
  "is-pulse": [[{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(1.6)" }], { duration: 900, iterations: 2, easing: EASE, pseudoElement: "::after" }],
};
function replay(el, cls) {
  if (!el) return;
  if (!el.classList.contains(cls)) { el.classList.add(cls); return; }
  const k = FXK[cls];
  if (k && el.animate && (!k[1].pseudoElement || PSEUDO_FX)) { try { el.animate(k[0], k[1]); return; } catch (e) { /* fall through */ } }
  el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
}

/* ------------------------------------------------------------------ receipts (zoom on desktop, sheet on phones) */
let zoomHost = null;
async function receipt(id, from, field) {
  const A = await import("./brain/brain-anatomy.js");
  const rect = from.getBoundingClientRect();
  const o = {
    from: rect, settings: S, cta: (field && field.cta) || "signup.html",
    onChange: (t) => field ? field.focusControl(t) : null,
    onClose: () => field && field.unzoom(),
  };
  if (field && !C.phone()) o.mount = await field.zoom(id);
  else if (field) field.hold(true);
  return A.open(id, o);
}

/* ------------------------------------------------------------------ the field */
function mountField(root) {
  const d = D, RM = C.reduced(), body = root.querySelector(".mc-body"), frame = root.querySelector(".mc-frame");
  const cv = root.querySelector(".mc-cv"), cv2 = root.querySelector(".mc-cv2"), $ = (s) => root.querySelector(s), $$ = (s) => [...root.querySelectorAll(s)];
  const cta = root.getAttribute("data-cta") || "signup.html";
  let ph = C.phone(), G = null, ctx = null, W = 0, T = 0, freeze = 0, seq = 0, drawnAt = -1e9;
  // Two layers. Static rails: drawn once per layout as inline SVG paths under the nodes (no per-frame cost, and not an
  // image, so never an LCP candidate). Everything that moves (rails' dash, dots, ghosts, rule lines, matrices): ONE
  // canvas above the nodes; lines and dots stop at node, lane and message boxes so they still pass "under" them. Where
  // Canvas2D is not GPU-backed every canvas costs a full-size copy each frame, so there is only one.
  const rails = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  rails.setAttribute("class", "mc-cv mc-rails"); rails.setAttribute("aria-hidden", "true"); rails.setAttribute("focusable", "false");
  cv.replaceWith(rails);
  const Q = [], dots = [], rules = [], streams = [], rips = [], R = C.rng(7), RG = C.rng(11);
  const at = (t, fn) => { let i = Q.length; while (i && Q[i - 1][0] > t) i--; Q.splice(i, 0, [t, fn]); };
  const sc = C.scene(root, { onState: (run, why) => { $(".mc-reading").hidden = !why.includes("read"); } });
  const NS = {}, nodes = {};
  $$(".mc-frame [data-sp]").forEach((n, i) => {
    const sp = n.dataset.sp;
    nodes[sp] = n; NS[sp] = { mode: "idle", t0: 0, i, ai: n.dataset.kind == "ai", on: [], roll: 0, owner: 0, blip: 0 };
  });
  root.classList.add("sc-cv");

  /* ---- reset the server-rendered result states, then play */
  const resetFirst = () => {
    $$(".mc-res").forEach((e) => e.classList.contains("mc-li") && e.remove());
    frame.classList.remove("is-stop", "is-dim");
    $(".mc-in .mc-msg").classList.remove("is-hit", "mc-hitres");
    setNode("safety", "idle");
  };

  /* ---- geometry: rects relative to the body, read once and on resize */
  function measure() {
    ph = C.phone();
    const b = body.getBoundingClientRect();
    const R_ = (el) => { const r = el.getBoundingClientRect(), x = r.left - b.left, y = r.top - b.top; return { x, y, w: r.width, h: r.height, r: x + r.width, b: y + r.height, cx: x + r.width / 2, cy: y + r.height / 2 }; };
    const g = { W: b.width, H: b.height, n: {}, m: {}, lane: {} };
    g.mx = {};
    for (const sp in nodes) if (nodes[sp].offsetParent) {
      g.n[sp] = R_(nodes[sp]);
      const slot = nodes[sp].querySelector(".sc-mx");
      if (slot && slot.offsetParent && slot.offsetWidth) g.mx[sp] = R_(slot);
    }
    $$(".mc-m").forEach((m) => (g.m[m.dataset.t] = R_(m)));
    $$(".mc-lane").forEach((l) => (g.lane[l.dataset.lane] = { box: R_(l), list: R_(l.querySelector(ph ? ".mc-lh" : ".mc-tl")) }));
    const lis = ph ? [] : $$(".mc-tl .mc-li:not([hidden])");
    g.pitch = lis.length > 1 && lis[1].parentElement == lis[0].parentElement ? lis[1].getBoundingClientRect().top - lis[0].getBoundingClientRect().top : lis[0] ? lis[0].getBoundingClientRect().height + 4 : 32;
    g.fr = R_(frame); g.inb = R_($(".mc-in")); g.shell = R_($(".mc-shell")); g.first = R_($(".mc-first")); g.after = R_($(".mc-after"));
    g.spine = ph ? null : R_($(".mc-spine")); g.lanes = R_($(".mc-lanes"));
    g.learn = ph ? null : R_($(".mc-learn"));
    g.bus1 = (g.first.b + g.shell.y) / 2; g.bus2 = (g.shell.b + g.after.y) / 2;
    const r1 = SHELL[0].map((sp) => g.n[sp]);
    g.ch = [(g.shell.x + r1[0].x) / 2, (r1[0].r + r1[1].x) / 2, (r1[1].r + r1[2].x) / 2, (r1[2].r + g.shell.r) / 2];
    g.gL = ph ? g.fr.x + 4 : g.fr.x - 8;
    g.nr = ph ? g.shell.r + 4 : (g.shell.r + g.spine.x) / 2;
    g.gR = ph ? g.fr.r - 4 : g.lanes.x - 8;
    g.bot = ph ? g.lanes.y - 7 : g.H - 5;
    // boxes the moving layer never draws inside (lines are cut at their edges in JS), so dots pass "under" nodes,
    // lane cards and the message: a canvas clip or an erase pass costs a full-canvas mask every frame.
    g.boxes = [...Object.values(g.n), ...Object.values(g.lane).map((l) => l.box), g.inb, ...(ph ? [R_($(".mc-cr"))] : [])].map((r) => ({ x: r.x, y: r.y, r: r.r, b: r.b })); // phones: the readout line too
    G = g;
    ctx = C.fit(cv2, g.W, g.H);
    drawnAt = -1e9;
    rails.setAttribute("width", g.W); rails.setAttribute("height", g.H); rails.setAttribute("viewBox", `0 0 ${g.W} ${g.H}`);
    rails.innerHTML = drawStatic();
  }
  const col = (sp) => { const n = G.n[sp], c = G.ch; return SHELL.findIndex((r) => r.includes(sp)) < 0 ? [c[0], c[1]] : [c[SHELL.flat().indexOf(sp) % 3], c[SHELL.flat().indexOf(sp) % 3 + 1]]; };
  const row = (sp) => SHELL.findIndex((r) => r.includes(sp));

  /* ---- static rails (inline SVG, drawn once per layout) */
  function drawStatic() {
    const g = G, out = [], f = (v) => Math.round(v * 10) / 10;
    const L = (pts, a = 0.17, w = 1) => out.push(`<path d="M${pts.map((p) => f(p[0]) + " " + f(p[1])).join("L")}" stroke-opacity="${a}"${w != 1 ? ` stroke-width="${w}"` : ""}/>`);
    L([[g.gL, g.bus1], [g.nr, g.bus1]]); L([[g.gL, g.bus2], [g.nr, g.bus2]]);
    for (const x of g.ch) L([[x, g.bus1], [x, g.bus2]], 0.08);
    L([[g.nr, g.bus1], [g.nr, g.bus2]], 0.08);
    for (const sp of FIRST) { const n = g.n[sp]; L([[n.cx, g.inb.b], [n.cx, g.bus1]], 0.08); }
    for (const sp of AFTER) { const n = g.n[sp]; L([[n.cx, g.bus2], [n.cx, n.cy]]); }
    for (const r of [...SHELL, ["set_logger"]]) { const n = g.n[r[0]]; L([[g.ch[0], n.cy], [g.ch[3], n.cy]], 0.08); }
    L([[g.first.x, g.first.cy], [g.first.r, g.first.cy]], 0.1); L([[g.after.x, g.after.cy], [g.after.r, g.after.cy]], 0.1);
    if (!ph) {
      L([[g.gL, g.inb.y], [g.gL, g.bot], [g.gR, g.bot], [g.gR, g.lanes.y + 14]], 0.1);
      for (const k in g.m) { const m = g.m[k]; L([[m.r, m.cy], [g.gL, m.cy]], 0.06); }
      const ln = g.learn; L([[ln.x, ln.cy], [ln.r, ln.cy]], 0.1);
    } else L([[g.gL, g.inb.cy], [g.gL, g.bot], [g.gR, g.bot]], 0.1);
    return `<g fill="none" stroke="#F3F4F0">${out.join("")}</g>`;
  }
  const laneRails = () => {
    const g = G, gate = g.n.lane_gate;
    return ["sent", "waits", "paused"].map((l) => {
      const t = laneTarget(l);
      return [l, ph ? [[gate.cx, gate.b], [gate.cx, g.bot], [t[0], g.bot], t] : [[gate.r, gate.cy], [g.gR, gate.cy], [g.gR, t[1]], t]];
    });
  };
  const laneTarget = (l) => { const L = G.lane[l]; return ph ? [L.box.cx, L.box.cy] : [L.box.x + 16, L.list.y + 12]; };

  /* ---- nodes and matrices */
  function setNode(sp, state, o = {}) {
    const n = nodes[sp];
    if (!n) return;
    const s = NS[sp];
    if (o.owner) s.owner = o.owner;
    else if (o.ifOwner && s.owner != o.ifOwner) return;
    n.dataset.state = state;
    const who = o.owner && WHO[o.owner];
    if (who && state != "idle") n.dataset.who = who; else if (n.dataset.who) delete n.dataset.who;
    s.mode = state == "work" ? (s.ai ? "ai" : "code") : state == "hit" ? "hit" : state == "skip" ? "skip" : state == "idle" ? "idle" : "pass";
    s.t0 = T;
    if (o.val != null) n.querySelector(".mc-v").textContent = o.val;
    if (state == "idle" && !o.keepVal) n.querySelector(".mc-v").textContent = "";
  }
  const disp = (rr) => (ph ? rr.sure.display.replace(" · your bar", " · bar") : rr.sure.display); // phones: fits the node
  const release = (sp, owner, ms = 1400) => at(W + ms, () => { if (NS[sp].owner == owner) setNode(sp, "idle"); });
  /* Matrices are drawn on the top canvas at each node's slot (one canvas, no per-node layers). */
  function drawMx(now, c) {
    const dim = frame.classList.contains("is-dim");
    for (const sp in NS) {
      const s = NS[sp], m = G.mx[sp], st = nodes[sp].dataset.state, lit = st == "lit" || (s.mode == "ai");
      if (!m || nodes[sp].hasAttribute("data-off")) continue;
      const age = now - s.t0, blip = now < s.blip && s.mode == "idle", dk = dim && sp != "safety" ? 0.35 : 1;
      if ((s.mode == "ai" || (blip && s.ai)) && now - s.roll > 90) { s.roll = now; s.on = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter(() => RG() < 0.45); }
      for (let i = 0; i < 9; i++) {
        const cx = i % 3, cy = (i / 3) | 0;
        let a;
        if (s.mode == "idle") a = 0.18 + 0.14 * (0.5 + 0.5 * Math.sin(((now + s.i * 230) / 2800) * 6.283));
        else if (s.mode == "ai") a = s.on.includes(i) ? 1 : 0.22;
        else if (s.mode == "code") a = cx == ((age / 80) | 0) % 3 ? 1 : 0.25;
        else if (s.mode == "hit") a = age < 480 && ((age / 120) | 0) % 2 ? 0.3 : 1;
        else if (s.mode == "skip") a = 0.12;
        else a = 1;
        if (blip) a = s.ai ? (s.on.includes(i) ? 1 : 0.2) : cx == (((now - s.b0) / 80) | 0) % 3 ? 0.95 : 0.25;
        c.globalAlpha = a * dk * (st == "idle" && !blip ? 0.8 : 1);
        c.fillStyle = s.mode == "hit" ? RED : lit ? "#171917" : "#F3F4F0";
        const x = m.x + 1.5 + cx * 5, y = m.y + 1.5 + cy * 5;
        if (s.ai) { c.beginPath(); c.arc(x + 1.5, y + 1.5, 1.5, 0, 6.283); c.fill(); } else c.fillRect(x, y, 3, 3);
      }
      // the busy node's outline: Pace for an AI specialist, paper for a code step; fades over the blip
      if (blip && !dim) {
        const n = G.n[sp], k = (now - s.b0) / (s.blip - s.b0), rr = s.ai ? n.h / 2 + 2 : 5;
        c.globalAlpha = (s.ai ? 0.6 : 0.4) * (1 - k * k); c.strokeStyle = "#F3F4F0"; c.lineWidth = 1;
        c.beginPath();
        if (c.roundRect) c.roundRect(n.x - 2, n.y - 2, n.w + 4, n.h + 4, rr); else c.rect(n.x - 2, n.y - 2, n.w + 4, n.h + 4);
        c.stroke();
      }
    }
    c.globalAlpha = 1;
  }

  /* ---- bubbles (inside their node), streamed at 40 characters/s */
  let capT = 0;
  function bubble(sp, text, o = {}) {
    const n = nodes[sp];
    if (!n || !n.offsetParent) return;
    if (ph) {
      // phones: one readout line inside the shell (beside Set logger) instead of floating bubbles
      const cap = $(".mc-cr"), nm = (d.sp[sp] && d.sp[sp].name) || "Privacy", life = (o.ai ? (text.length / 40) * 1000 : 0) + (o.hold || 1400);
      cap.innerHTML = `<b>${esc(nm)}:</b> `; cap.classList.add("is-read"); cap.classList.toggle("is-ai", !!o.ai);
      const tx = h("span"); cap.append(tx);
      if (o.ai && !RM && C.tier.name != "minimal") { tx.append(document.createTextNode(""), h("span.sc-caret")); streams.push({ el: tx, text, t0: W, done: false }); } else tx.textContent = text;
      if (o.basis) cap.insertAdjacentHTML("beforeend", " " + U.basis(d, o.basis));
      const my = ++capT;
      at(W + life, () => { if (capT == my) { cap.classList.remove("is-read", "is-ai"); cap.textContent = COPY.codeRule; } });
      return;
    }
    n.querySelectorAll(".mc-bub").forEach((b) => b.remove());
    const b = h("span.mc-bub" + (o.ai ? ".is-ai" : "") + (o.red ? ".is-red" : ""), { "data-pos": o.pos || (row(sp) == 0 || sp == "learner" || sp == "examiner" || sp == "privacy" ? "up" : "down") });
    const tx = h("span.mc-bt");
    b.append(tx);
    if (o.basis) b.insertAdjacentHTML("beforeend", U.basis(d, o.basis));
    n.append(b);
    if (o.ai && !RM && C.tier.name != "minimal") {
      const car = h("span.sc-caret");
      tx.append(document.createTextNode(""), car);
      streams.push({ el: tx, text, t0: W, done: false });
    } else tx.textContent = text;
    const life = (o.ai ? (text.length / 40) * 1000 : 0) + (o.hold || 1400);
    at(W + life, () => { b.classList.add("is-out"); setTimeout(() => b.remove(), 220); });
    return b;
  }

  /* ---- incoming message (one slot) */
  function incoming(t) {
    const box = $(".mc-in"), old = box.querySelector(".mc-msg:not(.is-out)");
    if (old) { old.classList.add("is-out"); setTimeout(() => old.remove(), 260); }
    box.insertAdjacentHTML("beforeend", msgHTML(t, false));
    const m = box.lastElementChild;
    m.classList.add("is-new");
    return m;
  }
  function memberOn(id, on) { const m = root.querySelector(`.mc-m[data-t="${id}"]`); m && m.classList.toggle("is-on", on); }

  /* ---- subtitle (160 ms crossfade) */
  let subA = true, subLock = 0;
  function sub(html, hold = 0) {
    if (W < subLock && !hold) return;
    if (hold) subLock = W + hold;
    const a = $(".mc-s1"), b = $(".mc-s2"), [on, off] = subA ? [b, a] : [a, b];
    on.innerHTML = html; on.classList.add("is-on"); off.classList.remove("is-on");
    subA = !subA;
  }

  /* ---- lanes and tiles */
  const tiles = {}; // id -> {li, lane, n}
  $$(".mc-li").forEach((li) => { if (!li.classList.contains("mc-res")) tiles[li.dataset.t] = { li, lane: li.closest(".mc-lane").dataset.lane, n: 1 }; });
  let spot = 1;
  const laneOf = (id) => { const t = d.trace(id), r = decide(t, S, d); return t.decide == "learn" ? "waits" : r.lane; };
  function land(id, lane, o = {}) {
    let tl = tiles[id];
    const list = root.querySelector(`.mc-lane[data-lane="${lane}"] .mc-tl`);
    if (!tl) {
      list.insertAdjacentHTML("afterbegin", tileHTML(d, id));
      tl = tiles[id] = { li: list.firstElementChild, lane, n: 0 };
    } else { list.prepend(tl.li); tl.lane = lane; }
    tl.n++;
    replay(tl.li, "is-land");
    replay(list.closest(".mc-lane"), "is-flash2");
    if (id == "t10" && lane == "sent") spot++;
    counts();
  }
  function counts() {
    for (const l of ["sent", "waits", "paused"]) {
      const sec = root.querySelector(`.mc-lane[data-lane="${l}"]`), lis = [...sec.querySelectorAll(".mc-li")];
      const n = Math.min(CAP[l], lis.reduce((a, li) => a + (tiles[li.dataset.t] ? tiles[li.dataset.t].n : 1), 0));
      const ce = sec.querySelector(".mc-c");
      if (ce.textContent != String(n)) { ce.textContent = n; replay(ce, "is-roll"); }
      sec.querySelector(".mc-csr").textContent = `: ${n} in this sample hour`;
      lis.forEach((li, i) => (li.hidden = i >= SHOW[l]));
      const more = n - Math.min(lis.length, SHOW[l]);
      const mo = sec.querySelector(".mc-more");
      mo.hidden = more <= 0; mo.textContent = "+" + more;
      sec.querySelector(".mc-last").textContent = lis[0] ? d.trace(lis[0].dataset.t).member : "—";
      if (l == "waits") sec.querySelector(".mc-chk2 b").textContent = spot && tiles.t10 && tiles.t10.lane == "sent" ? spot : 0;
    }
    rove();
  }
  function rove() {
    $$(".mc-lane").forEach((sec) => {
      const b = [...sec.querySelectorAll(".mc-li:not([hidden]) .mc-tile")];
      if (!b.some((x) => x.tabIndex == 0)) b.forEach((x, i) => (x.tabIndex = i ? -1 : 0));
    });
  }
  /** Settings changed: re-sort tiles with FLIP; future moments follow decide(). */
  /* Where a tile sits, from DOM order and the lane rects cached on measure (no layout read). */
  const slot = (li) => { const l = li.closest(".mc-lane").dataset.lane, i = [...li.parentElement.children].indexOf(li); return { l, i }; };
  function flipEst(prev, ms) {
    let n = 0;
    prev.forEach((a, li) => {
      if (li.hidden || !G.lane[a.l]) return;
      const b = slot(li), A = G.lane[a.l].list, B = G.lane[b.l].list;
      const dx = A.x - B.x, dy = A.y + a.i * G.pitch - (B.y + b.i * G.pitch);
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      li.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: "none" }], { duration: ms, delay: 40 * n++, easing: "cubic-bezier(.4,0,.2,1)", fill: "backwards" });
    });
  }
  function resort(k, before, src) {
    // the auto-demo runs inside the frame loop: estimate the FLIP from DOM order (no forced layout); a visitor's
    // change runs in its event handler and measures for real
    const est = src == "demo" && !ph, first = new Map(), moved = [];
    Object.values(tiles).forEach((tl) => first.set(tl.li, est ? slot(tl.li) : tl.li.getBoundingClientRect()));
    for (const id in tiles) {
      const tl = tiles[id], to = laneOf(id);
      const s2 = tl.li.querySelector(".mc-sub2");
      s2.textContent = id == "t9" && !S.supplementsTopic ? COPY.drafted : "";
      if (to != tl.lane) { root.querySelector(`.mc-lane[data-lane="${to}"] .mc-tl`).prepend(tl.li); tl.lane = to; moved.push(id); }
    }
    counts();
    if (!RM && !(src == "demo" && ph)) (est ? flipEst : flip)(first, 420); // phones: lanes are bins (no tile list)
    notes();
    function notes() {
    const gate = G && G.n.lane_gate;
    if (k == "level") {
      const L = d.labels.levels[S.level];
      if (gate && !ph) bubble("lane_gate", `Level ${S.level}: ${L.summary}`, { hold: 2600, pos: "down" }); // phones: the subtitle carries it (the 2-line readout cut it off)
      sub(`<b>Level ${S.level}:</b> ${esc(L.summary)}${S.level > 1 ? " " + esc(d.labels.levels.note) : ""}`, 2600);
    }
    if (k == "bar") {
      $$(".mc-gauge b").forEach((b) => b.style.setProperty("--bar", S.bar + "%"));
      sub(`<b>Your bar: ${S.bar}%.</b> Plans below it wait for you. Aisha's is 78%, Fatima's 86%.`, 2600);
    }
    if (k == "supplementsTopic") {
      setNode("topics", S.supplementsTopic ? "idle" : "warn", { val: S.supplementsTopic ? "" : "Off" });
      if (!S.supplementsTopic) bubble("topics", COPY.suppOff, { hold: 2600, pos: "down" });
      sub(S.supplementsTopic ? "<b>Supplements:</b> you answer these yourself. No AI called." : `<b>Supplements:</b> ${esc(COPY.drafted)}. ${esc(COPY.suppOff)}`, 2600);
    }
    if (src == "user") {
      const names = moved.map((id) => d.trace(id).member);
      C.say(names.length ? `${names.join(", ")} moved to ${COPY.laneShort[tiles[moved[0]].lane]}.` : "No moment changed lanes.");
    }
    }
  }
  subs.add(resort);

  /* ---- dots */
  function seg(pts, a, dur, ez) {
    const P = round(pts), lens = [0];
    for (let i = 1; i < P.length; i++) lens.push(lens[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    const L = lens[lens.length - 1];
    return { P, lens, L, a, b: a + (dur || clamp(L / 0.62, 200, 560)), ez };
  }
  function round(pts) {
    const out = [pts[0]], r = 9;
    for (let i = 1; i < pts.length - 1; i++) {
      const [p, q, n] = [pts[i - 1], pts[i], pts[i + 1]];
      const d1 = Math.hypot(q[0] - p[0], q[1] - p[1]), d2 = Math.hypot(n[0] - q[0], n[1] - q[1]);
      if (d1 < 1 || d2 < 1) { out.push(q); continue; }
      const k1 = Math.min(r, d1 / 2) / d1, k2 = Math.min(r, d2 / 2) / d2;
      const A = [q[0] - (q[0] - p[0]) * k1, q[1] - (q[1] - p[1]) * k1], B = [q[0] + (n[0] - q[0]) * k2, q[1] + (n[1] - q[1]) * k2];
      for (let s = 0; s <= 4; s++) { const u = s / 4, v = 1 - u; out.push([v * v * A[0] + 2 * v * u * q[0] + u * u * B[0], v * v * A[1] + 2 * v * u * q[1] + u * u * B[1]]); }
    }
    out.push(pts[pts.length - 1]);
    return out;
  }
  function posAt(dot, w) {
    let s = dot.segs[0];
    for (const x of dot.segs) { if (w >= x.a) s = x; else break; }
    if (!s) return null;
    let k = clamp((w - s.a) / (s.b - s.a), 0, 1);
    k = s.ez == "in" ? k * k : s.ez == "lin" ? k : C.ease.io(k);
    const target = k * s.L;
    let i = 1;
    while (i < s.lens.length - 1 && s.lens[i] < target) i++;
    const l0 = s.lens[i - 1], l1 = s.lens[i], u = l1 > l0 ? (target - l0) / (l1 - l0) : 0;
    return [s.P[i - 1][0] + (s.P[i][0] - s.P[i - 1][0]) * u, s.P[i - 1][1] + (s.P[i][1] - s.P[i - 1][1]) * u];
  }

  /* ---- routes: ops = {mv: pts[], dur?, ez?} | {node, dwell, in(), out()} | {fn} | {wait} */
  function route(id, o = {}) {
    const t = d.trace(id), r = decide(t, S, d), g = G, ops = [], k = t.decide, ghost = !!o.ghost;
    const steps = r.steps.filter((x) => x.result != "skipped");
    const has = (sp) => steps.some((x) => x.sp == sp);
    const ai = pick(t, d, S);
    let cur = o.start;
    const mv = (pts, dur, ez) => { ops.push({ mv: [cur, ...pts], dur, ez }); cur = pts[pts.length - 1]; };
    const N = (sp) => g.n[sp];
    const node = (sp, dwell, fin, fout) => ops.push({ node: sp, dwell: ghost ? 0 : dwell, in: ghost ? () => { const q = NS[sp]; q.b0 = T; q.blip = T + (q.ai ? BLIP_AI : BLIP_CODE); } : fin, out: ghost ? null : fout });
    const intoFirst = (sp) => { const n = N(sp); mv([[cur[0], g.first.y - 9], [n.cx, g.first.y - 9], [n.cx, n.cy]]); };
    const hop = (sp) => { const n = N(sp); mv([[n.cx, n.cy]], ghost ? null : clamp(Math.abs(n.cx - cur[0]) / 1.3, 60, 200)); };
    const down1 = () => mv([[cur[0], g.bus1]]);
    const toShell = (sp) => {
      const n = N(sp);
      if (sp == "set_logger" || row(sp) > 0) { const [l] = col(sp); mv([[l, g.bus1], [l, n.cy], [n.cx, n.cy]]); }
      else mv([[n.cx, g.bus1], [n.cx, n.cy]]);
    };
    const outShell = (sp) => { const n = N(sp), [, rr] = col(sp); mv([[rr, n.cy], [rr, g.bus2]]); };
    const toAfter = (sp) => { const n = N(sp); mv([[n.cx, g.bus2], [n.cx, n.cy]]); };
    const toLane = (l, dur, ez) => {
      const tg = laneTarget(l);
      if (ph) mv([[cur[0], g.bot], [tg[0], g.bot], tg], dur, ez);
      else mv([[g.gR, cur[1]], [g.gR, tg[1]], tg], dur, ez);
    };
    const hooks = o.hooks || {};
    const H = (name, ...a) => hooks[name] && hooks[name](...a);
    const firstChecks = FIRST.filter(has);
    // floors: Safety stops it. No AI called.
    if (k == "floor") {
      intoFirst("safety");
      node("safety", 120, () => H("scan"), () => H("stop"));
      if (!ghost) ops.push({ wait: 400 });
      const n = N("safety");
      if (ph) mv([[g.gL, n.cy], [g.gL, g.bot], [laneTarget("paused")[0], g.bot], laneTarget("paused")], ghost ? null : 600, "in");
      else mv([[g.gL, n.cy], [g.gL, g.bot], [g.gR, g.bot], [g.gR, laneTarget("paused")[1]], laneTarget("paused")], ghost ? null : 640, "in");
      ops.push({ fn: () => H("land", "paused") });
      return ops;
    }
    if (k == "voice") {
      mv([[cur[0], g.first.y - 9], [g.gL, g.first.y - 9], [g.gL, g.bus1]]);
      toShell("voice_lines"); node("voice_lines", 1000, () => H("ai", "voice_lines"), () => H("aiOut", "voice_lines"));
      outShell("voice_lines"); toAfter("checker"); node("checker", 140, () => H("work", "checker"), () => H("pass", "checker", "Lines checked"));
      ops.push({ fn: () => H("voice2") });
      return ops;
    }
    if (k == "recovery") {
      const n = N("recovery") || N("lane_gate");
      mv([[cur[0], g.first.y - 9], [g.gL, g.first.y - 9], [g.gL, n.cy], [n.cx, n.cy]]);
      node("recovery", 700, () => H("work", "recovery"), () => H("pass", "recovery", "−10% load"));
      toLane("sent"); ops.push({ fn: () => H("land", "sent") });
      return ops;
    }
    if (!firstChecks.length) firstChecks.push("safety");
    intoFirst(firstChecks[0]);
    firstChecks.forEach((sp, i) => {
      if (i) hop(sp);
      const st = steps.find((x) => x.sp == sp);
      node(sp, sp == "topics" && st.result == "hit" ? 420 : sp == "rule_finder" ? 160 : 110, () => H("work", sp), () => H("check", sp, st));
    });
    if (k == "topic" && !ai) {
      down1(); mv([[g.nr, g.bus1], [g.nr, g.bus2]]); toAfter("lane_gate");
      node("lane_gate", 160, () => H("work", "lane_gate"), () => H("gate", r.lane));
      toLane(r.lane); ops.push({ fn: () => H("land", r.lane) });
      return ops;
    }
    down1();
    if (ai) { ops.push({ fn: () => H("picks", ai) }); toShell(ai); node(ai, k == "meal" ? 1300 : 1100, () => H("ai", ai), () => H("aiOut", ai)); outShell(ai); }
    if (k == "meal") {
      toAfter("checker"); node("checker", 140, () => H("work", "checker"), () => H("pass", "checker", "Fits the format"));
      const m = g.m[id];
      if (m && !ph) mv([[g.gL, N("checker").cy], [g.gL, m.cy], [m.r - 10, m.cy]]);
      else mv([[g.gL, N("checker").cy], [g.gL, g.inb.cy], [g.inb.cx, g.inb.cy]]);
      ops.push({ fn: () => H("member") });
      return ops;
    }
    const after = AFTER.filter((sp) => has(sp) || (sp == "confidence" && has("checker") && has("lane_gate")));
    if (!after.length) after.push("lane_gate");
    toAfter(after[0]);
    after.forEach((sp, i) => {
      if (i) hop(sp);
      const st = steps.find((x) => x.sp == sp);
      if (sp == "confidence") node(sp, r.sure ? 560 : 60, () => H("conf", r), () => H("confOut", r));
      else if (sp == "lane_gate") node(sp, 170, () => H("work", sp), () => H("gate", r.lane));
      else node(sp, st && st.result == "warn" ? 200 : 120, () => H("work", sp), () => H("check", sp, st));
    });
    toLane(laneOf(id)); ops.push({ fn: () => H("land", laneOf(id)) });
    return ops;
  }
  function run(ops, t0, dot) {
    let tc = t0;
    for (const op of ops) {
      if (op.mv) { const s = seg(op.mv, tc, op.dur, op.ez); dot.segs.push(s); tc = s.b; }
      else if (op.node) { op.in && at(tc, op.in); tc += op.dwell; op.out && at(tc, op.out); }
      else if (op.wait) tc += op.wait;
      else if (op.fn) at(tc, op.fn);
    }
    dot.end = tc;
    return tc;
  }

  /* ---- a narrated moment */
  let codePicks = 0;
  const fg = new Set(), WHO = {}; // owner → the member's initial, shown on every node their moment lights

  function moment(id, o = {}) {
    const t = d.trace(id), r = decide(t, S, d), own = ++seq;
    WHO[own] = t.member[0];
    const dot = { segs: [], col: PACE, ghost: false, trail: [], born: W, end: 0, a: 1 };
    const m = { id, t, r, dot, own };
    fg.add(m);
    let msg = o.msg;
    if (o.first) { msg = $(".mc-in .mc-msg"); sub(subHTML(t)); }
    else if (!o.resume) { msg = incoming(t); if (!o.quiet) sub(subHTML(t)); }
    memberOn(id, true);
    const start = [G.inb.x + Math.min(G.inb.w / 2, 40), G.inb.b - 2]; // cached geometry: no forced layout per moment
    const hooks = {
      work: (sp) => setNode(sp, "work", { owner: own }),
      check: (sp, st) => {
        const plan = t.decide == "plan";
        const v = !st ? "✓" : st.result == "hit" ? (sp == "topics" ? "Your choice" : "STOP") : st.result == "none" || /^No approved/.test(st.say) ? "none fits"
          : sp == "safety" ? "clear" : sp == "memory" ? "read" : sp == "rule_finder" ? (plan ? "your rules" : "1 fits") : sp == "checker" ? (st.result == "warn" ? "1 warning" : plan ? "in your limits" : "cites your rule") : "✓";
        setNode(sp, st && st.result == "hit" ? (sp == "topics" ? "warn" : "hit") : st && st.result == "warn" ? "warn" : "pass", { owner: own, val: v });
        if (sp == "topics" && st && st.result == "hit") bubble("topics", `${COPY.noAi} · Your choice: you answer supplements`, { pos: "down", hold: 1800 });
        if (sp == "rule_finder" && t.decide == "learn") bubble("rule_finder", st.say, { pos: "down", hold: 1600 });
        if ((sp == "rule_finder" || sp == "checker") && t.rule && st && st.result != "warn" && st.result != "none" && t.decide != "plan" || (sp == "checker" && t.decide == "plan")) ruleLine(sp);
        release(sp, own, 1500);
      },
      pass: (sp, v) => { setNode(sp, "pass", { owner: own, val: v }); release(sp, own, 1500); },
      picks: (sp) => { if (codePicks++ < 2) { const c = $(".mc-cap"); c.classList.add("is-flash"); at(W + 900, () => c.classList.remove("is-flash")); } },
      ai: (sp) => {
        setNode(sp, "work", { owner: own });
        const st = r.steps.find((x) => x.sp == sp);
        bubble(sp, BUB[sp] || (st && st.say) || "", { ai: true, basis: st && st.basis, hold: 1400 });
      },
      aiOut: (sp) => { setNode(sp, "lit", { owner: own }); release(sp, own, 1700); },
      conf: (rr) => {
        const n = nodes.confidence;
        if (!rr.sure) { setNode("confidence", "idle", { val: "—", keepVal: true }); n.title = d.labels.noChatScore; return; }
        setNode("confidence", "work", { owner: own, val: disp(rr) });
        const pct = rr.sure.pct != null ? rr.sure.pct : Math.round(rr.sure.score * 100);
        n.querySelector(".mc-gauge i").style.setProperty("--v", pct / 100);
        n.classList.toggle("is-below", pct < S.bar);
      },
      confOut: (rr) => {
        if (!rr.sure) { at(W + 900, () => { if (NS.confidence.owner <= own) nodes.confidence.querySelector(".mc-v").textContent = ""; }); return; }
        const pct = rr.sure.pct != null ? rr.sure.pct : Math.round(rr.sure.score * 100);
        setNode("confidence", pct >= S.bar ? "pass" : "warn", { owner: own, val: disp(rr) });
        if (pct < S.bar) { dot.col = AMBER; replay(nodes.confidence, "is-bounce"); }
        at(W + 1600, () => { if (NS.confidence.owner == own) { setNode("confidence", "idle"); nodes.confidence.querySelector(".mc-gauge i").style.setProperty("--v", 0); nodes.confidence.classList.remove("is-below"); } });
      },
      gate: (lane) => {
        setNode("lane_gate", lane == "sent" ? "sent" : lane == "paused" ? "paused" : "waits", { owner: own, val: COPY.laneShort[lane] || "" });
        if (t.decide == "chat_action" && lane == "sent") ruleLine("lane_gate");
        dot.col = LC[lane] || PACE;
        release("lane_gate", own, 1300);
      },
      scan: () => { setNode("safety", "work", { owner: own }); msg && msg.classList.add("is-scan"); },
      stop: () => {
        setNode("safety", "hit", { owner: own, val: "STOP" });
        msg && msg.classList.add("is-hit");
        if (frame.classList.contains("is-stop")) { frame.classList.remove("is-stop"); void frame.offsetWidth; } // stops are >= 6 moments apart: rare
        frame.classList.add("is-stop", "is-dim");
        replay(root, "is-alarm");
        freeze = T + 400;
        at(W + 10, () => { dot.col = RED; });
        at(W + 700, () => frame.classList.remove("is-dim"));
        at(W + 1900, () => frame.classList.remove("is-stop"));
        release("safety", own, 2600);
      },
      member: () => {
        const m = root.querySelector(`.mc-m[data-t="${id}"]`), mm = root.querySelector(`.mc-in .mc-msg[data-t="${id}"]:not(.is-out)`);
        [m, mm].forEach((e) => e && (e.dataset.tag = "Priya confirms"));
        at(W + 2400, () => [m, mm].forEach((e) => e && delete e.dataset.tag));
      },
      land: (lane) => { land(id, lane); },
      voice2: () => {
        setNode("safety", "pass", { owner: own, val: "safety line" });
        bubble("safety", "Say pain or tap Stop", { pos: "down", hold: 1500 });
        at(W + 900, () => {
          const m2 = incoming({ ...t, id: t.id, trigger: { text: "“too heavy”", lang: "en" } });
          m2.querySelector(".mc-mt").textContent = "After set 1 she says: “too heavy”";
          const d2 = { segs: [], col: PACE, ghost: false, trail: [], born: W, end: 0, a: 1 };
          const n = G.n.safety, sp = G.n.set_logger, [l, rr2] = col("set_logger"), tg = laneTarget("sent");
          const ops2 = [{ mv: [[start[0], start[1]], [start[0], G.first.y - 9], [n.cx, G.first.y - 9], [n.cx, n.cy]] },
            { node: "safety", dwell: 300, in: () => setNode("safety", "work", { owner: own }), out: () => { setNode("safety", "pass", { owner: own, val: "no pain" }); bubble("safety", "Screened for pain, in English and Arabic", { pos: "down", hold: 1300 }); release("safety", own); } },
            { mv: [[n.cx, n.cy], [n.cx, G.bus1], [l, G.bus1], [l, sp.cy], [sp.cx, sp.cy]] },
            { node: "set_logger", dwell: 1000, in: () => { setNode("set_logger", "work", { owner: own }); bubble("set_logger", "“Too heavy” → your 10% rule → 54 kg", { pos: "down", hold: 1600 }); }, out: () => { setNode("set_logger", "pass", { owner: own, val: "54 kg" }); release("set_logger", own); } },
            { mv: [[sp.cx, sp.cy], [rr2, sp.cy], [rr2, G.bus2], ...(ph ? [[rr2, G.bot], [tg[0], G.bot], tg] : [[G.gR, G.bus2], [G.gR, tg[1]], tg])] },
            { fn: () => { d2.col = GREEN; land(id, "sent"); } }];
          d2.end = run(ops2, W, d2);
          dots.push(d2);
          // the second leg is still this moment: it holds its foreground slot until it lands
          at(d2.end + 300, () => { memberOn(id, false); fg.delete(m); });
        });
      },
    };
    let ops = route(id, { start, hooks });
    if (o.resume) {
      const i = ops.findIndex((x) => x.node == o.resume);
      ops = ops.slice(i);
      ops[0] = { ...ops[0], dwell: o.remain || 600, in: null };
      const n = G.n[o.resume];
      dot.segs.push(seg([[n.cx, n.cy], [n.cx, n.cy + 0.01]], W, 1));
      NS[o.resume].owner = own; NS[o.resume].mode = "ai";
      at(W + (o.remain || 600) + 1400, () => nodes[o.resume].querySelectorAll(".mc-bub").forEach((b) => { b.classList.add("is-out"); setTimeout(() => b.remove(), 220); }));
    }
    dot.end = run(ops, W, dot);
    dots.push(dot);
    at(dot.end + 200, () => { if (t.decide != "voice") fg.delete(m), memberOn(id, false); }); // voice: its second leg releases it
    at(dot.end + 1400, () => { if (!fg.size && !RM) sub(esc(COPY.tap)); });
    return m;
  }

  /* ---- rule lines from the rulebook spine (Pace, 1.5 px: draw 240, hold 400, fade 600) */
  function ruleLine(sp) {
    if (ph || !G.spine) return;
    const n = G.n[sp], x0 = G.spine.x;
    const pts = sp == "checker" ? [[x0, G.bus2 - 4], [n.cx + 10, G.bus2 - 4], [n.cx + 10, n.y]] : [[x0, n.cy], [n.r, n.cy]];
    rules.push({ s: seg(pts, T, 240, "lin"), t0: T });
    replay($(".mc-spine"), "is-cite");
  }

  /* ---- ghosts: unlabelled moments on true paths, never Not-on-yet nodes */
  const pool = d.traces.filter((t) => !isOff(t, S) && t.decide != "learn" && t.decide != "recovery");
  const wsum = pool.reduce((a, t) => a + t.weight, 0);
  const wpick = (rnd) => { let x = rnd() * wsum; for (const t of pool) if ((x -= t.weight) < 0) return t; return pool[0]; };
  let nextGhost = 0;
  function ghost() {
    if (dots.filter((x) => x.ghost).length >= C.tier.ghosts) return;
    const t = wpick(RG), g = G;
    const x = ph ? g.inb.x + 10 + RG() * (g.inb.w - 20) : g.first.x + RG() * g.first.w;
    const dot = { segs: [], ghost: true, born: W, end: 0, red: t.decide == "floor" };
    const lane = t.decide == "floor" ? "paused" : t.decide == "meal" ? null : laneOf(id0(t));
    dot.lc = LC[lane] || PACE;
    if (lane && g.lane[lane]) { const L = g.lane[lane], tg = laneTarget(lane); dot.rp = ph ? [tg[0], L.box.y] : [L.box.x, tg[1]]; }
    const ops = route(id0(t), { ghost: true, start: [x, g.inb.y + 6] });
    let tc = W;
    for (const op of ops) if (op.mv) { const s = seg(op.mv, tc, null, "lin"); s.b = s.a + s.L / (0.2 + RG() * 0.12); dot.segs.push(s); tc = s.b; } else if (op.node && op.in) at(tc, op.in);
    dot.end = tc;
    dots.push(dot);
  }

  /* ---- halo sprites (one radial gradient per colour, drawn once) */
  const haloCache = {};
  function halo(col) {
    if (haloCache[col]) return haloCache[col];
    const b = C.bitmap(28, 28), gr = b.c.createRadialGradient(14, 14, 0, 14, 14, 14);
    gr.addColorStop(0, col + "55"); gr.addColorStop(1, col + "00"); b.c.fillStyle = gr; b.c.fillRect(0, 0, 28, 28);
    return (haloCache[col] = b.cv);
  }

  /* ---- the loop */
  let mxTick = 0, lastStream = 0;
  const pre = []; // work that must run first in a frame (settings changes that FLIP)
  function frameFn(dt) {
    while (pre.length) pre.shift()();
    T += dt;
    if (T >= freeze) {
      W += dt;
      while (Q.length && Q[0][0] <= W) Q.shift()[1]();
      if (!RM && W >= nextGhost) { ghost(); nextGhost = W + 300 + RG() * 200; }
    }
    for (const s of streams) if (!s.done) {
      const n = Math.min(s.text.length, Math.round(((W - s.t0) / 1000) * 40));
      if (n != s.n) { s.n = n; s.el.firstChild.data = s.text.slice(0, n); }
      if (n >= s.text.length) { s.done = true; const car = s.el.querySelector(".sc-caret"); car && car.remove(); }
    }
    if (streams.length > 20) streams.splice(0, streams.length - 20);
    if (DBG.includes("nodraw")) return;
    // lite/minimal: while no dot or rule line moves, the matrices' breathing and the rail dashes redraw at ~12 fps
    if (C.tier.name != "full" && !dots.length && !rules.length && !rips.length && T - drawnAt < (C.tier.name == "minimal" ? 160 : 83)) return;
    drawnAt = T; draw();
  }
  function draw() {
    const g = G, c = ctx;
    c.clearRect(0, 0, g.W, g.H);
    // lane rails: dash 3 3, offset loop 1.6 s
    c.setLineDash([3, 3]); c.lineDashOffset = C.tier.name == "minimal" ? 0 : -((T / 1600) % 1) * 6; c.lineWidth = 1;
    for (const [l, pts] of laneRails()) { c.strokeStyle = LC[l] + "66"; c.beginPath(); poly(c, pts); c.stroke(); }
    c.setLineDash([]);
    // rule lines
    for (let i = rules.length - 1; i >= 0; i--) {
      const r = rules[i], age = T - r.t0, a = age < 640 ? 1 : 1 - (age - 640) / 600;
      if (a <= 0) { rules.splice(i, 1); continue; }
      const k = clamp(age / 240, 0, 1), s = r.s;
      c.strokeStyle = PACE; c.globalAlpha = a; c.lineWidth = 1.5; c.beginPath();
      let len = 0; c.moveTo(s.P[0][0], s.P[0][1]);
      for (let j = 1; j < s.P.length; j++) { const L = s.lens[j]; if (L <= k * s.L) c.lineTo(s.P[j][0], s.P[j][1]); else { const u = (k * s.L - s.lens[j - 1]) / (L - s.lens[j - 1]); c.lineTo(s.P[j - 1][0] + (s.P[j][0] - s.P[j - 1][0]) * u, s.P[j - 1][1] + (s.P[j][1] - s.P[j - 1][1]) * u); break; } }
      c.stroke(); c.globalAlpha = 1;
    }
    const halos = C.tier.spec.halos;
    for (let i = dots.length - 1; i >= 0; i--) {
      const dt_ = dots[i];
      if (W > dt_.end + (dt_.ghost ? 260 : 900)) { dots.splice(i, 1); continue; }
      const p = posAt(dt_, W);
      if (!p) continue;
      const fade = W > dt_.end ? Math.max(0, 1 - (W - dt_.end) / 260) : Math.min(1, (W - dt_.born) / 160);
      const hid = inBox(p[0], p[1]);
      if (dt_.ghost) {
        // ghosts: other members' moments (hidden while "inside" a node, which shows busy); a ripple where each lands
        if (W >= dt_.end && !dt_.rip) { dt_.rip = 1; dt_.rp && rips.push([dt_.rp[0], dt_.rp[1], dt_.lc, T]); }
        if (hid) continue;
        const gc = dt_.red ? RED : "#F3F4F0", q = posAt(dt_, W - 70);
        if (q && W > dt_.born + 70) { c.globalAlpha = 0.32 * fade; c.strokeStyle = gc; c.lineWidth = 2; c.lineCap = "round"; c.beginPath(); poly(c, [q, p]); c.stroke(); c.lineCap = "butt"; }
        if (halos) { c.globalAlpha = 0.16 * fade; c.fillStyle = gc; c.beginPath(); c.arc(p[0], p[1], 6.5, 0, 6.283); c.fill(); }
        c.globalAlpha = 0.85 * fade; c.fillStyle = gc;
        c.beginPath(); c.arc(p[0], p[1], 2.3, 0, 6.283); c.fill(); c.globalAlpha = 1;
        continue;
      }
      // the route so far stays lit (in the outcome colour once decided), then fades with the dot
      c.lineWidth = 2; c.strokeStyle = dt_.col; c.globalAlpha = 0.5 * (W > dt_.end ? Math.max(0, 1 - (W - dt_.end) / 900) : 1);
      c.beginPath();
      for (const sg of dt_.segs) {
        if (sg.a > W) break;
        if (sg.b <= W) poly(c, sg.P);
        else { const q = posAt({ segs: [sg] }, W), pts = [sg.P[0]]; let j = 1; const tgt = clamp((W - sg.a) / (sg.b - sg.a), 0, 1); while (j < sg.P.length - 1 && sg.lens[j] < (sg.ez == "in" ? tgt * tgt : sg.ez == "lin" ? tgt : C.ease.io(tgt)) * sg.L) pts.push(sg.P[j++]); pts.push(q); poly(c, pts); }
      }
      c.stroke(); c.globalAlpha = 1;
      // trail (600 ms)
      dt_.trail.push([p[0], p[1], T]);
      while (dt_.trail.length && T - dt_.trail[0][2] > 600) dt_.trail.shift();
      c.lineWidth = 1.5; c.strokeStyle = dt_.col;
      for (let j = 1; j < dt_.trail.length; j++) {
        const a = dt_.trail[j - 1], b = dt_.trail[j];
        if (inBox(a[0], a[1]) || inBox(b[0], b[1])) continue;
        c.globalAlpha = (1 - (T - b[2]) / 600) * 0.9 * fade; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke();
      }
      if (!hid) {
        c.globalAlpha = fade;
        if (halos) c.drawImage(halo(dt_.col), p[0] - 14, p[1] - 14, 28, 28);
        c.fillStyle = dt_.col; c.beginPath(); c.arc(p[0], p[1], 3.5, 0, 6.283); c.fill();
        c.globalAlpha = 1;
      }
    }
    // landing ripples, in the lane's colour (ghosts never change the counts)
    for (let i = rips.length - 1; i >= 0; i--) {
      const r = rips[i], k = (T - r[3]) / 520;
      if (k >= 1) { rips.splice(i, 1); continue; }
      const e = 1 - (1 - k) * (1 - k);
      c.globalAlpha = 0.9 * (1 - k); c.strokeStyle = r[2]; c.lineWidth = 1.5;
      c.beginPath(); c.arc(r[0], r[1], 2.5 + 10 * e, 0, 6.283); c.stroke();
    }
    c.globalAlpha = 1;
    drawMx(T, c);
  }
  /* Lines are cut at box edges (Liang-Barsky per box) instead of clipping the canvas. */
  function inBox(x, y) { for (const B of G.boxes) if (x > B.x && x < B.r && y > B.y && y < B.b) return true; return false; }
  function poly(c, pts) { for (let i = 1; i < pts.length; i++) cut(c, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]); }
  const hidT = [];
  function cut(c, x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0; let n = 0;
    for (const B of G.boxes) {
      if (Math.max(x0, x1) <= B.x || Math.min(x0, x1) >= B.r || Math.max(y0, y1) <= B.y || Math.min(y0, y1) >= B.b) continue;
      let t0 = 0, t1 = 1;
      const clipT = (p, q) => { if (p == 0) return q >= 0; const t = q / p; if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; } return true; };
      if (clipT(-dx, x0 - B.x) && clipT(dx, B.r - x0) && clipT(-dy, y0 - B.y) && clipT(dy, B.b - y0) && t1 > t0) { hidT[n++] = t0; hidT[n++] = t1; }
    }
    if (!n) { c.moveTo(x0, y0); c.lineTo(x1, y1); return; }
    const iv = []; for (let i = 0; i < n; i += 2) iv.push([hidT[i], hidT[i + 1]]);
    iv.sort((a, b) => a[0] - b[0]);
    let t = 0;
    for (const [a, b] of iv) { if (a > t) { c.moveTo(x0 + dx * t, y0 + dy * t); c.lineTo(x0 + dx * a, y0 + dy * a); } if (b > t) t = b; }
    if (t < 1) { c.moveTo(x0 + dx * t, y0 + dy * t); c.lineTo(x1, y1); }
  }

  /* ---- the 30-second story, then a seeded playlist (spec §2 storyboard) */
  let playlistAt = Infinity, lastStop = -99, nPlayed = 0, hourAt = 75000;
  function story() {
    const P = ph;
    at(0, () => moment("t2", { msg: $(".mc-in .mc-msg") , resume: null, first: true }));
    at(0, () => moment("t1", { resume: "reply_picker", remain: 700, quiet: true }));
    at(2200, () => moment("t8"));
    if (!P) at(3400, () => moment("t4", { quiet: true }));
    at(5200, () => moment("t10"));
    at(6600, () => moment("t7", { quiet: P }));
    at(8000, () => demo(1));
    at(11000, () => demo(2));
    at(12500, () => moment("t9"));
    at(14000, () => moment("t5"));
    at(16500, () => learnLoop());
    at(20600, () => nudge());
    playlistAt = 23400;
  }
  function demo(n) {
    if (touched) return;
    const b = root.querySelector(`.mc-ctrl [data-level="${n}"]`), dm = $(".mc-demo");
    b.classList.remove("is-press"); void b.offsetWidth; b.classList.add("is-press");
    dm.style.setProperty("--x", b.offsetLeft + b.offsetWidth / 2 + "px"); dm.classList.add("is-on");
    // applied at the start of a frame, before other events dirty the layout, so the FLIP read is cheap
    at(W + 320, () => pre.push(() => field.ctl.setLv(n, true)));
    at(W + 2400, () => { dm.classList.remove("is-on"); b.classList.remove("is-press"); });
  }
  function nudge() {
    if (touched) return;
    replay($(".mc-lv"), "is-nudge");
    sub(esc(COPY.turn), 2800);
  }
  function learnLoop() {
    const card = $(".mc-learncard"), L = COPY.learn, own = ++seq;
    replay($(".mc-lane[data-lane='waits'] .mc-ls"), "is-pulse");
    sub(subHTML(d.trace("t7")), 3600);
    card.innerHTML = `<p class="mc-lc-h"><span class="mc-ls">LS</span>${esc(L[0])}</p><p class="mc-lc-d">Draft: “Add <s>5 kg</s> <ins></ins> next time.”</p><p class="mc-lc-s" data-s="1">${esc(L[1])}</p><p class="mc-lc-s mc-lc-ai" data-s="2">Learner · <span></span> ${U.basis(d, "tests")}</p><p class="mc-lc-s" data-s="3"><span class="mc-q">${esc(L[2])}</span></p><p class="mc-lc-s" data-s="4"><span class="mc-ex">${esc(L[4])}</span> · Examiner: your AI answers your test cases, code marks them. <b></b></p>`;
    card.hidden = false; card.classList.remove("is-on"); void card.offsetWidth; card.classList.add("is-on");
    const ins = card.querySelector("ins"), sh = (i) => card.querySelector(`[data-s="${i}"]`).classList.add("is-on");
    const tz = tiles.t7 && tiles.t7.li; tz && tz.classList.add("is-edit");
    "2.5 kg".split("").forEach((ch, i) => at(W + 500 + i * 83, () => (ins.textContent += ch)));
    at(W + 1100, () => { sh(1); setNode("privacy", "pass", { owner: own, val: "[client]" }); release("privacy", own, 3000); });
    at(W + 1500, () => {
      sh(2);
      const tg = card.querySelector(".mc-lc-ai span"), txt = "Suggests: Upper body increments";
      tg.append(document.createTextNode(""), h("span.sc-caret"));
      streams.push({ el: tg, text: txt, t0: W, done: false });
      setNode("learner", "work", { owner: own });
      if (!ph && G.learn) { const n = G.n.learner, tl = G.lane.waits.box; const dt2 = { segs: [], col: PACE, ghost: false, trail: [], born: W, end: 0 }; dt2.segs.push(seg([[tl.x + 4, tl.cy], [G.gR, tl.cy], [G.gR, n.cy], [n.r, n.cy]], W, 700)); dt2.end = W + 700; dots.push(dt2); }
    });
    at(W + 2600, () => { setNode("learner", "lit", { owner: own }); release("learner", own, 1600); setNode("checker", "pass", { owner: own, val: "no new numbers ✓" }); release("checker", own); });
    at(W + 2900, () => sh(3));
    at(W + 3400, () => { const q = card.querySelector(".mc-q"); q.textContent = L[3]; q.classList.add("is-ok"); });
    at(W + 3600, () => { sh(4); setNode("examiner", "work", { owner: own, val: L[4] }); });
    at(W + 4300, () => {
      setNode("examiner", "pass", { owner: own, val: L[5] }); release("examiner", own, 1800);
      card.querySelector("[data-s='4'] b").textContent = L[5];
      const bn = $(".mc-bn"); bn.textContent = "25"; $(".mc-spine").classList.add("is-new");
      at(W + 3000, () => $(".mc-spine").classList.add("is-kept"));
    });
    at(W + 6400, () => { card.classList.remove("is-on"); tz && tz.classList.remove("is-edit"); });
    at(W + 6800, () => (card.hidden = true));
  }
  function nextFromPlaylist() {
    let t = wpick(R), tries = 0;
    while (tries++ < 12 && (t.decide == "floor" && nPlayed - lastStop < 6 || [...fg].some((m) => m.id == id0(t)))) t = wpick(R);
    if (t.decide == "floor") lastStop = nPlayed;
    nPlayed++;
    moment(id0(t));
  }
  function newHour() {
    const lanes = $(".mc-lanes");
    lanes.classList.add("is-reset");
    at(W + 420, () => {
      for (const id in tiles) tiles[id].li.remove();
      for (const k in tiles) delete tiles[k];
      for (const l in START) for (const [id] of START[l]) land(id, laneOf(id));
      spot = 1; counts();
      $(".mc-bn").textContent = "24"; $(".mc-spine").classList.remove("is-new", "is-kept");
      lanes.classList.remove("is-reset");
      sub(esc(COPY.newHour), 1800);
    });
  }
  let nextMoment = 0;
  function director() {
    if (W >= playlistAt && W >= nextMoment) {
      const max = ph ? 1 : 2;
      if (fg.size < max) nextFromPlaylist();
      nextMoment = W + 2400 + R() * 1200;
    }
    if (W >= hourAt) { hourAt += 75000; newHour(); }
  }

  /* ---- reduced motion: a static frame after the stop; "Play the field" crossfades every 2.5 s */
  function staticFinal() {
    for (const t of d.traces) { const id = id0(t); if (isOff(t, S) || id == "t4") continue; if (!tiles[id]) land(id, laneOf(id)); }
    land("t2", "paused");
    $$(".mc-m.is-on").forEach((m) => m.classList.remove("is-on"));
    memberOn("t2", true); memberOn("t1", true); // Omar's moment holds the lit Reply picker (its "O" badge)
    frame.classList.add("is-stop");
    $(".mc-in .mc-msg").classList.add("is-hit");
    setNode("safety", "hit", { val: "STOP" });
    sub(subHTML(d.trace("t2")));
  }
  let rmIdx = 0;
  const rmOrder = ["t1", "t8", "t4", "t10", "t7", "t9", "t5", "t6", "t11", "t12", "t2"];
  function rmStep() {
    const id = rmOrder[rmIdx++ % rmOrder.length], t = d.trace(id), r = decide(t, S, d);
    Object.keys(nodes).forEach((sp) => setNode(sp, "idle"));
    $$(".mc-bub").forEach((b) => b.remove());
    $$(".mc-m.is-on").forEach((m) => m.classList.remove("is-on"));
    memberOn(id, true);
    frame.classList.remove("is-stop");
    incoming(t);
    for (const st of r.steps) {
      if (!(st.sp in nodes) || st.result == "skipped") continue;
      const ai = d.sp[st.sp] && d.sp[st.sp].kind == "ai";
      setNode(st.sp, st.result == "hit" ? "hit" : ai ? "lit" : st.sp == "lane_gate" ? (r.lane == "sent" ? "sent" : r.lane == "paused" ? "paused" : "waits") : st.result == "warn" ? "warn" : "pass", { val: st.sp == "confidence" && r.sure ? r.sure.display : "" });
    }
    if (t.decide == "floor") { frame.classList.add("is-stop"); $(".mc-in .mc-msg:last-child").classList.add("is-hit"); }
    const a = pick(t, d, S);
    if (a) bubble(a, BUB[a] || r.steps.find((x) => x.sp == a).say, { ai: true, basis: r.steps.find((x) => x.sp == a).basis, hold: 2300 });
    sub(subHTML(t));
  }

  /* ---- interactions */
  const field = {
    cta,
    ctl: wireControls($(".mc-ctrl")),
    async zoom(id) {
      sc.set("read", true);
      const t = d.trace(id), a = pick(t, d, S) || "safety", n = G.n[a] || G.n.safety;
      body.style.transformOrigin = `${n.cx}px ${n.cy}px`;
      root.classList.add("is-zoom");
      const host = h("div.mc-rx");
      root.append(host);
      if (!RM) await new Promise((r) => setTimeout(r, 420));
      root.classList.add("is-read");
      zoomHost = host;
      return host;
    },
    unzoom() {
      root.classList.remove("is-read", "is-zoom");
      zoomHost && zoomHost.remove(); zoomHost = null;
      sc.set("read", false);
    },
    hold(on) { sc.set("read", on); },
    focusControl(t) {
      const k = t.decide;
      const el = k == "plan" ? $(".mc-bar input") : k == "topic" ? $(".mc-sw") : k == "floor" ? $(".mc-lock") : $(".mc-lv [aria-checked='true']");
      if (ph && el.closest(".mc-sheet")) openSheet(true);
      el.focus(); el.classList.remove("is-ping"); void el.offsetWidth; el.classList.add("is-ping");
    },
  };
  root.addEventListener("click", (e) => {
    const b = e.target.closest(".mc-tile, .mc-m");
    if (b && !b.disabled) { receipt(b.dataset.t, b, field); return; }
    const bin = e.target.closest(".mc-bin");
    if (bin) { binList(bin); return; }
    if (e.target.closest(".mc-moreb")) openSheet(!root.classList.contains("is-sheet"));
    if (e.target.closest("[data-close]")) openSheet(false);
    const how = e.target.closest(".mc-how");
    if (how) { const p = $(".mc-howp"); p.hidden = !p.hidden; how.setAttribute("aria-expanded", !p.hidden); }
  });
  root.addEventListener("keydown", (e) => {
    // phones: the settings sheet sits over a backdrop, so Tab cycles inside it until Done or Esc
    if (e.key == "Tab" && sheetOpen) {
      const f = [...root.querySelectorAll(".mc-sheet button:not([disabled]), .mc-sheet input:not([disabled]), .mc-sheet [tabindex='0']")];
      const i = f.indexOf(document.activeElement), n = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : (i == f.length - 1 ? 0 : i + 1);
      if (f.length) { e.preventDefault(); f[n].focus(); }
      return;
    }
    if (e.key == "Escape") { openSheet(false); const p = $(".mc-howp"); if (!p.hidden) { p.hidden = true; $(".mc-how").setAttribute("aria-expanded", "false"); } closeBin(); }
    const b = e.target.closest(".mc-tile, .mc-m");
    if (!b || !/^Arrow(Up|Down)$/.test(e.key)) return;
    const list = [...b.closest("ul").querySelectorAll(b.classList.contains("mc-m") ? ".mc-m" : ".mc-li:not([hidden]) .mc-tile")];
    const i = list.indexOf(b), nb = list[clamp(i + (e.key == "ArrowDown" ? 1 : -1), 0, list.length - 1)];
    e.preventDefault(); list.forEach((x) => (x.tabIndex = -1)); nb.tabIndex = 0; nb.focus();
  });
  let sheetOpen = false;
  function openSheet(on) {
    if (!ph && on) return;
    if (!on && !sheetOpen) return;
    root.classList.toggle("is-sheet", on);
    $(".mc-moreb").setAttribute("aria-expanded", on);
    if (on) { sc.set("read", true); setTimeout(() => $(".mc-sheet [data-close]").focus(), 30); }
    else if (sheetOpen) { sc.set("read", false); $(".mc-moreb").focus(); }
    sheetOpen = on;
  }
  let binBox = null, binFrom = null;
  function binList(bin) {
    closeBin();
    binFrom = bin; // Esc or Done returns focus here
    const l = bin.dataset.bin, lis = [...root.querySelectorAll(`.mc-lane[data-lane="${l}"] .mc-li`)];
    binBox = h("div.mc-binlist", { role: "dialog", "aria-label": COPY.lanes[l][0] });
    binBox.innerHTML = `<p><b>${esc(COPY.lanes[l][0])}</b><button type="button" class="mc-x" data-binx>${esc(COPY.done)}</button></p><ul>${lis.map((li) => `<li><button type="button" class="mc-tile" data-t="${li.dataset.t}">${li.querySelector(".mc-tn").innerHTML}</button></li>`).join("")}</ul>`;
    root.append(binBox);
    binBox.addEventListener("click", (e) => { if (e.target.closest("[data-binx]")) closeBin(bin); });
    binBox.querySelector("button").focus();
  }
  function closeBin(focus = binFrom) { if (binBox) { binBox.remove(); binBox = null; focus && focus.focus(); } }
  C.prefetch(new URL("brain/brain-anatomy.js", import.meta.url).href, root, 10000);
  // QA handle (qa/sc/*.cjs): state, plus moment/land/newHour to play any trace and check caps and the reset
  root.__mc = { dots, get G() { return G; }, get W() { return W; }, get T() { return T; }, fg, tiles, S: () => S, tier: C.tier, stats: C.stats, moment: (id) => moment(id), land: (id, l) => land(id, l), newHour: () => newHour() };

  /* ---- pause button, resize, start */
  const pb = $(".mc-pause");
  pb.disabled = false;
  $$(".mc-m, .mc-bin, .mc-moreb, .mc-how, [data-close]").forEach((b) => (b.disabled = false));
  measure();
  C.tier.on(() => { measure(); if (RM) draw(); });
  let rz = 0, lastW = G.W, lastP = ph;
  new ResizeObserver(() => {
    clearTimeout(rz);
    rz = setTimeout(() => { const w = body.getBoundingClientRect().width; if (Math.abs(w - lastW) < 2 && C.phone() == lastP) return; measure(); lastW = G.W; lastP = ph; dots.length = 0; if (RM) draw(); }, 120);
  }).observe(body);
  root.setAttribute("data-sc", "on");
  if (RM) {
    root.classList.add("is-rm");
    resetFirst(); staticFinal(); counts();
    pb.innerHTML = `${U.icon("play", 12)}<span data-label>${esc(COPY.play)}</span>`;
    let on = false, acc = 0;
    const lp = sc.loop((dt) => { if (!on) return false; acc += dt; T += dt; W += dt; while (Q.length && Q[0][0] <= W) Q.shift()[1](); if (acc >= 2500) { acc = 0; rmStep(); } draw(); }, 10);
    pb.addEventListener("click", () => {
      on = !on; pb.setAttribute("aria-pressed", String(!on));
      pb.innerHTML = `${U.icon(on ? "pause" : "play", 12)}<span data-label>${on ? "Pause" : esc(COPY.play)}</span>`;
      if (on) { rmStep(); lp.wake(); }
    });
    draw();
    return field;
  }
  sc.button(pb, { pause: "Pause", play: "Play" });
  resetFirst();
  counts();
  Object.keys(NS).forEach((sp) => { const s_ = NS[sp], n = nodes[sp], dly = (n.offsetTop + n.offsetLeft) * 0.9; if (s_.owner) return; s_.mode = "code"; s_.t0 = -dly; at(dly + 240, () => { if (!NS[sp].owner && NS[sp].mode == "code") NS[sp].mode = "idle"; }); });
  story();
  sc.loop((dt) => { frameFn(dt); director(); }, 60);
  return field;
}
