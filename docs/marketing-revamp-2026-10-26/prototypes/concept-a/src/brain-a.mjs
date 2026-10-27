// Concept A's Brain pieces for the product pages (spec showcase-final.md §2 "Where it lives", §5, §6).
// Everything is rendered from the shared sample data, so names, lanes and numbers match the engine.
import { readFileSync } from "node:fs";
import { index } from "../site/assets/brain/brain-core.js";
import { decide, defaults, isOff, pick } from "../site/assets/brain/brain-decide.js";
import * as U from "../site/assets/brain/brain-ui.js";
import { renderStatic as playStatic } from "../site/assets/brain/brain-play.js";
import { esc, band, sectionHead, textLink, cta, href } from "./components.mjs";

export const BRAIN = index(JSON.parse(readFileSync(new URL("../site/assets/brain/traces.client.json", import.meta.url), "utf8")));
const BOOT = readFileSync(new URL("../site/assets/brain/brain-boot.js", import.meta.url), "utf8").replace(/^\/\*[\s\S]*?\*\/\s*/, "");
/** The ≤ 1 KB bootstrap, inlined at the end of <main> (load → idle → near → import). */
export const boot = () => `<script>${BOOT}</script>`;
/** Stylesheets a page with a Brain showcase needs (base tokens first, A's skin last). */
export const CSS = ["brain/brain-base.css", "brain/brain-play.css", "brain/brain-anatomy.css", "a-echo.css"];
const d = BRAIN, S = defaults(d);
const sp = (id) => d.sp[id];

/* ------------------------------------------------------------------ playground (spec §5), A skin */
export function playground({ id = "play", heading = true } = {}) {
  return `<div class="bp a-play" id="${id}" data-showcase="play" data-sc-module="assets/brain/brain-play.js" data-cta="${href("/signup")}"${heading ? "" : ' data-heading="off"'}>${playStatic(d, { cta: href("/signup"), heading })}</div>`;
}
export function playBand({ id = "play-band", tone = "white" } = {}) {
  return band({ tone, cls: "a-play-band", id, label: "" }, playground({ heading: true }));
}

/* ------------------------------------------------------------------ small static atoms in the field's language */
const node = (id, o = {}) => {
  const s = sp(id), off = s.status == "not_on_yet";
  return `<span class="an" data-kind="${s.kind}" data-state="${o.state || "idle"}"${off ? " data-off" : ""}><i class="an-mx" aria-hidden="true"></i>${esc(s.name)}${s.usesAi ? ` <small class="an-badge">uses your AI</small>` : ""}${off ? ` <small class="an-off">Not on yet</small>` : ""}${o.val ? `<b class="an-v">${esc(o.val)}</b>` : ""}</span>`;
};
const lane = (l, extra = "") => `<span class="an-lane" data-lane="${l}">${esc(d.labels.lanes[l])}${extra}</span>`;
const arrow = `<span class="an-ar" aria-hidden="true">→</span>`;
const basis = (b) => (b ? `<small class="an-basis" data-basis="${b}">${esc(d.labels.basis[b])}</small>` : "");
const sample = () => `<p class="an-sample"><span>${esc(d.labels.chip)}</span></p>`;

/* ------------------------------------------------------------------ /trainer-brain: roster with status chips */
const CREWS = [
  ["coach", "Coach · one per moment", "Code picks one of these from the kind of moment. Never two on one message."],
  ["teach", "Teach · works with you", "These help you teach. Nothing they write is used until you confirm it."],
  ["guard", "Guard · code, no AI", "Fixed steps around every moment. They follow your rules and the safety floor."],
];
/** The one trace that shows each specialist at work (for "See it work" → the playground). */
const SHOWS = { reply_picker: "t1", draft_writer: "t7", plan_writer: "t10", week_reviewer: "t8", meal_photo: "t4", voice_lines: "t5", learner: "t7", examiner: "t7",
  safety: "t2", topics: "t9", memory: "t1", rule_finder: "t1", checker: "t1", confidence: "t8", lane_gate: "t6", set_logger: "t5", today: "t7" };
export function roster() {
  const crew = (k) => d.specialists.filter((s) => s.crew == k);
  const card = (s) => {
    const tip = s.status == "not_on_yet" ? "Built and tested. Not switched on yet." : s.statusTip || (s.status == "live" ? "" : d.labels.statusTip.default);
    const t = SHOWS[s.id];
    return `<li class="ro-c" data-kind="${s.kind}"${s.status == "not_on_yet" ? " data-off" : ""}>
  <p class="ro-h"><i class="an-mx" aria-hidden="true"></i><b>${esc(s.name)}</b>${s.usesAi ? `<small class="an-badge">uses your AI</small>` : ""}</p>
  <p class="ro-k">${esc(d.labels.kind[s.kind])}</p>
  <p class="ro-l">${esc(s.line)}</p>
  <p class="ro-s"><span class="ro-chip" data-status="${s.status}">${esc(d.labels.status[s.status])}</span>${tip ? `<span class="ro-tip">${esc(tip)}</span>` : ""}</p>
  ${t && s.status != "not_on_yet" ? `<a class="ro-run" href="#play" data-run="${t}">See it work${U.icon("arrow-right", 12)}</a>` : ""}
</li>`;
  };
  return band(
    { tone: "white", cls: "ro-band", id: "inside", label: "ro-h" },
    `${sectionHead({ kicker: "Inside your AI", title: "Who’s inside your Brain", id: "ro-h", layout: "split", lede: "Specialists inside your AI handle every message. Code checks every step. You decide what goes out." })}
<div class="ro-legend" aria-hidden="true"><span><i class="an-mx" data-k="ai"></i>${esc(d.labels.kind.ai)}</span><span><i class="an-mx" data-k="check"></i>${esc(d.labels.kind.check)}</span>
<details class="ro-how"><summary>How we count</summary><p>${esc(d.labels.howWeCount)}</p></details></div>
<p class="ro-picks">${esc(d.labels.picks)}</p>
${CREWS.map(([k, t, l]) => `<section class="ro-crew" aria-labelledby="ro-${k}"><header><h3 id="ro-${k}">${esc(t)}</h3><p>${esc(l)}</p></header><ul class="ro-list">${crew(k).map(card).join("")}</ul></section>`).join("")}
<p class="ro-note">${esc(d.labels.subscribers)}</p>`,
  );
}

/* ------------------------------------------------------------------ /trainer-brain: how it decides (round-one correction) */
export function decides() {
  const t1 = d.trace("t1"), t8 = d.trace("t8"), t10 = d.trace("t10"), r8 = decide(t8, S, d), r10 = decide(t10, S, d);
  const cards = [
    { l: "sent", h: "Routine, and it fits your rules", b: "A chat reply goes out only when your approved reply fits and the Checker finds it cites your rule. Plans go out when Confidence meets your bar.",
      ex: [`${t1.member}: “Can I go up in weight?” ${arrow} ${node("reply_picker", { state: "lit" })} ${arrow} cites your rule`, `${t10.member}’s first plan ${arrow} Confidence <b class="an-num">${esc(r10.sure.display)}</b>`],
      note: d.labels.noChatScore },
    { l: "waits", h: "Unsure, or yours to answer", b: "No approved reply fits, the plan is below your bar, it’s a topic you answer yourself, or it’s a medical question. It goes to your Today list.",
      ex: [`${t8.member}’s week ${arrow} Confidence <b class="an-num">${esc(r8.sure.display)}</b>`, `Khalid: creatine ${arrow} ${esc(d.labels.noAi)} · your topic`],
      note: d.labels.levels.note },
    { l: "paused", h: "Pain or red flags", b: "Pain and red flags are caught by safety rules in code, before any AI runs. You can make them stricter, never switch them off.",
      ex: [`Noura: “a pop in my knee” ${arrow} <b class="an-stop">STOP · No AI called</b>`, `Hana (Arabic): chest pain, dizzy ${arrow} paused`],
      note: "Your Today list shows safety first." },
  ];
  return band(
    { tone: "paper", cls: "decide-band a-decide", label: "decide-h" },
    `${sectionHead({ kicker: "Decisions", title: "How it decides", id: "decide-h", layout: "split", lede: "Code checks every message first, picks one specialist, then checks again. Every moment ends in one of three places." })}
<ul class="ad" data-reveal="stagger">${cards.map((c) => `<li class="ad-c ri" data-lane="${c.l}"><p>${lane(c.l)}</p><h3>${esc(c.h)}</h3><p class="ad-b">${esc(c.b)}</p><ul class="ad-ex">${c.ex.map((x) => `<li>${x}</li>`).join("")}</ul><p class="ad-n">${esc(c.note)}</p></li>`).join("")}</ul>
${sample()}`,
  );
}

/* ------------------------------------------------------------------ /features: node vignettes (spec §2 "Where it lives") */
function vig({ title, link, linkLabel, trace, rows, foot }) {
  const t = d.trace(trace);
  return `<li class="fv-c"><div class="fv-stage sc-stage" data-showcase="echo">
  <p class="fv-msg"><span class="mc-av" aria-hidden="true">${esc(t.member[0])}</span><span><b>${esc(t.member)}</b> ${rows.msg || esc(t.trigger.text)}</span></p>
  <ol class="fv-flow">${rows.flow.map((x) => `<li>${x}</li>`).join("")}</ol>
  <p class="fv-out">${rows.out}</p>
  ${foot ? `<p class="fv-foot">${foot}</p>` : ""}
  <p class="an-sample"><span>${esc(d.labels.chip)}</span></p>
</div><h3>${esc(title)}</h3><p>${textLink(link, linkLabel)}</p></li>`;
}
export function featureEchoes() {
  const t2 = d.trace("t2"), t4 = d.trace("t4"), t5 = d.trace("t5"), t10 = d.trace("t10"), t8 = d.trace("t8");
  const hl = (t) => { let m = esc(t.trigger.text); for (const w of t.steps[0].highlight || []) m = m.split(esc(w)).join(`<em class="an-red">${esc(w)}</em>`); return m; };
  const r10 = decide(t10, S, d), r8 = decide(t8, S, d), st = (t, s) => t.steps.find((x) => x.sp == s);
  const items = [
    vig({ title: "Safety: the stop", link: "/features/safety", linkLabel: "Safety in detail", trace: "t2",
      rows: { msg: hl(t2), flow: [node("safety", { state: "hit", val: "STOP" }), `<span class="an-skip">${esc(d.labels.noAi)} · ${["topics", "memory", "rule_finder"].map((x) => esc(sp(x).name)).join(" · ")}: not reached</span>`],
        out: `${lane("paused")} <b class="an-stop">STOP · No AI called</b>` } }),
    vig({ title: "Nutrition: the meal photo reader", link: "/features/nutrition", linkLabel: "Nutrition in detail", trace: "t4",
      rows: { msg: "Sends a meal photo: penne in a creamy sauce.", flow: [node("safety", { state: "pass", val: "clear" }), `${arrow} ${node("meal_photo", { state: "lit" })} <span class="an-say">${esc(st(t4, "meal_photo").say)}</span> ${basis(st(t4, "meal_photo").basis)}`, `${arrow} ${node("checker", { state: "pass" })}`],
        out: `${lane("member")} <span class="an-say">Nothing is saved until Priya confirms.</span>` },
      foot: `${node("meal_planner")} Plans a week of meals from your recipes.` }),
    vig({ title: "Voice coach: lines, safety line, set logger", link: "/features/voice-coach", linkLabel: "Voice coach in detail", trace: "t5",
      rows: { msg: "Starts a voice-guided session. After set 1 she says: “too heavy”.", flow: [`${node("voice_lines", { state: "lit" })} <span class="an-say">Lines ready, written before the session</span> ${basis("tests")}`,
        `${arrow} ${node("safety", { state: "pass" })} <span class="an-say">Say pain or tap Stop · her reply is screened for pain, in English and Arabic</span>`, `${arrow} ${node("set_logger", { state: "pass" })} <span class="an-say">${esc(st(t5, "set_logger").say)}</span>`],
        out: `${lane("sent")} <span class="an-say">${esc(t5.laneNote)}</span>` } }),
    vig({ title: "AI training plans: writer and Confidence", link: "/features/ai-training-plans", linkLabel: "AI training plans in detail", trace: "t10",
      rows: { msg: "Finishes her intake. Her first plan is due.", flow: [`${node("plan_writer", { state: "lit" })} <span class="an-say">${esc(st(t10, "plan_writer").say)}</span> ${basis("illustrative")}`, `${arrow} ${node("checker", { state: "pass" })}`,
        `${arrow} ${node("confidence", { state: "pass" })} <b class="an-num">${esc(r10.sure.display)}</b>`],
        out: `${lane("sent")} <span class="an-tag">Spot check</span>` },
      foot: `${esc(t8.member)}’s week: ${node("week_reviewer")} ${arrow} Confidence <b class="an-num">${esc(r8.sure.display)}</b> ${arrow} ${lane("waits")}` }),
  ];
  return band(
    { tone: "paper", cls: "fv-band", label: "fv-h" },
    `${sectionHead({ title: "The specialists behind each feature", id: "fv-h", layout: "split", lede: "Each feature is a few steps inside your Brain. Code picks the one specialist a moment needs." })}
<ul class="fv">${items.join("")}</ul>
<p class="mt-m">${textLink("/demo", "Throw a moment at your Brain")}</p>`,
  );
}

/* ------------------------------------------------------------------ /how-it-works: the path every moment takes */
export function pathBand() {
  const t1 = d.trace("t1"), t8 = d.trace("t8"), t2 = d.trace("t2"), r8 = decide(t8, S, d);
  const coach = ["reply_picker", "draft_writer", "plan_writer", "week_reviewer", "meal_photo", "voice_lines"];
  const col = (k, title, inner) => `<li class="hp-col" data-k="${k}"><p class="hp-k">${esc(title)}</p>${inner}</li>`;
  const ex = [
    [t1.member, "Can I go up in weight?", "Reply picker", "cites your rule", "sent"],
    [t8.member, "Her week ends", "Week reviewer", r8.sure.display, "waits"],
    [t2.member, "A pop in my knee", "STOP · No AI called", "", "paused"],
  ];
  return band(
    { tone: "white", cls: "hp-band", label: "hp-h" },
    `${sectionHead({ kicker: "Inside every moment", title: "One path for every moment", id: "hp-h", layout: "split", lede: "Checks first, one specialist that code picks, checks after. Then it’s sent, it waits for you, or training pauses." })}
<div class="hp sc-stage" data-showcase="echo">
  <ol class="hp-flow">
    ${col("first", "Checks first · your rules", ["safety", "topics", "memory", "rule_finder"].map((x) => node(x)).join(""))}
    ${col("one", "Code picks one specialist", `<span class="hp-shell"><span class="hp-st"><span class="mc-mono">LS</span>Your Brain</span>${coach.map((x) => node(x, { state: x == "reply_picker" ? "lit" : "idle" })).join("")}${node("set_logger")}</span>`)}
    ${col("after", "Checks after · your rules", ["checker", "confidence", "lane_gate"].map((x) => node(x)).join(""))}
    ${col("lane", "Where it ends", ["sent", "waits", "paused"].map((l) => lane(l)).join(""))}
    ${col("you", "You", `${node("today")}<span class="hp-you">Your edit ${arrow} ${node("learner")} ${arrow} you confirm ${arrow} ${node("examiner")}</span>`)}
  </ol>
  <ul class="hp-ex">${ex.map(([m, q, s, v, l]) => `<li><b>${esc(m)}</b> “${esc(q)}” ${arrow} <span${l == "paused" ? ' class="an-stop"' : ""}>${esc(s)}</span>${v ? ` ${arrow} <span class="an-num">${esc(v)}</span>` : ""} ${arrow} ${lane(l)}</li>`).join("")}</ul>
  <p class="hp-picks">${esc(d.labels.picks)} ${esc(d.labels.noChatScore)}</p>
  ${sample()}
</div>
<p class="mt-m hp-links">${textLink("/", "Watch a sample hour of your Brain")}${textLink("/demo", "Throw a moment at your Brain")}</p>`,
  );
}

/** Roster "See it work" → run that moment in the playground on the same page. */
export const rosterScript = () => `<script>document.addEventListener("click",function(e){var a=e.target.closest("[data-run]");if(!a)return;e.preventDefault();var id=a.getAttribute("data-run"),p=document.getElementById("play");if(!p)return;p.scrollIntoView({behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth",block:"start"});var n=0;(function go(){var c=p.querySelector('.bp-chip[data-t="'+id+'"]:not([disabled])');if(c){var m=p.querySelector(".bp-more");if(c.offsetParent===null&&m)m.click();c.click();return}if(n++<40)setTimeout(go,100)})()});</script>`;
