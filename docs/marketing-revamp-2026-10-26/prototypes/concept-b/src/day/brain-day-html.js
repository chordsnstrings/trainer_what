/* trainsyou · Concept B · "24 hours of your Brain": static HTML (start frame
   and reduced-motion hour cards). Runs in Node for the generator; the browser
   loads it only to rebuild the stage when the recovery flag is on. */
import * as U from "../../site/assets/brain/brain-ui.js";
import { model, esc, COPY, panelKey, GROUPS } from "./brain-day.js";
const initials = (n) => n.slice(0, 2).toUpperCase();
/* Beat captions (spec §6 B) and, for phones, the two long ones in two parts (split at the beat's capQ) */
export const CAPS = {
  t5: "Sara trains with your voice. It starts with your safety line. Code logs her reps and follows your too-heavy rule.",
  t8: "Aisha’s week ended. Your AI suggests next week. It’s 78% sure and your bar is 80%, so it waits.",
  t4: "Priya snaps her lunch. Your AI estimates it. Nothing is saved until she confirms.",
  t10: "Fatima finished her intake. Your AI writes her first plan. It’s 86% sure, so it goes out, and you get a spot check.",
  t1: "Omar’s squats felt easy. Your AI picks your approved reply. It sends on its own.",
  t2: "Noura’s knee popped. Safety rules pause her training at once. No AI is called.",
  t7: "You open Today. Safety first. You edit one reply, and your AI asks to make it a rule. About a minute later a check runs. It goes live only if it passes.",
  t9: "Overnight, Khalid asks about creatine. You chose to answer supplements yourself, so it waits in Today, due within 72 hours. Once a week, your AI reads your edits and suggests new rules. They wait for your OK.",
  t3: "Hamdan’s recovery is low. You turned on your recovery rule and he opted in, so code lightens his workout. No AI.",
};
const CAPM = {
  t7: ["You open Today. Safety first. You edit one reply, and your AI asks to make it a rule.", "About a minute later a check runs. It goes live only if it passes."],
  t9: ["Overnight, Khalid asks about creatine. You chose to answer supplements yourself, so it waits in Today, due within 72 hours.", "Once a week, your AI reads your edits and suggests new rules. They wait for your OK."],
};
export const TOTALS = {
  off: "In this sample day: 3 within your rules · 1 member check · 3 waited for you · 1 paused · 1 new rule",
  on: "In this sample day: 4 within your rules · 1 member check · 3 waited for you · 1 paused · 1 new rule",
};
const totals = (M) => (M.S.recoveryFlag ? TOTALS.on : TOTALS.off);
/* Band copy (spec §6 B) */
export const TEXT = {
  h2: "While you coach, it coaches",
  lede: "Scroll through a sample day. Your AI handles routine work within your rules. Anything unsure waits in your Today list.",
  ledePlay: "Watch a sample day. Your AI handles routine work within your rules. Anything unsure waits in your Today list.",
  endH: "Your method worked all day.",
  sr: "A sample animation of one day. Messages from sample subscribers pass through code checks, then one AI specialist that code picks, then more code checks. Each ends sent on its own, waiting for you, or paused. In the evening you check your Today list, and one edit becomes a new rule.",
};
/* Text, captions and panels for the stage (moved here from brain-day.js, so the browser module stays small: QA 27 Oct) */
export const introCap = (mode) => (mode == "play" ? "A sample day, in about 35 seconds. " : "Scroll to play a sample day. ") + "Each column is one member’s moment. Code picks one specialist for it, or none.";
export const introHTML = () => `<div class="dy-intro"><p class="dy-k">06:00 · The day starts</p><p class="dy-big">One Brain. Many specialists inside. All of them follow your rules.</p><p class="dy-picks">Code picks the specialist. No AI chooses which AI runs.</p></div>`;
export const seesIntro = `<div class="dy-sees-0"><p class="dy-k">What they see</p><p>Every reply shows where its words came from: yours, your rule’s numbers, or AI.</p></div>`;
export const PV_CAP = "A sample day at a glance. Each column is one member’s moment: checks, then one specialist or none, then more checks.";
/** Every subtitle the day can show, stacked in one grid cell so the stage never changes height (QA 27 Oct: no layout shift). */
export const capList = (M) => [["pin", introCap("pin")], ["play", introCap("play")], ["glance", PV_CAP], ...[...M.beats, M.outro].flatMap((b, i) => { const k = b.outro ? "o" : String(i); return CAPM[b.t] ? [[k, CAPS[b.t], "d"], [k + "a", CAPM[b.t][0], "m"], [k + "b", CAPM[b.t][1], "m"]] : [[k, CAPS[b.t]]]; })];
/* Panels, pure (Node and browser): rendered once for every beat and stacked, so a beat change only swaps visibility. */
export function miniHTML(d) {
  return `<div class="dy-mini" aria-hidden="true">${GROUPS.map((g) => `<div class="dy-mr${g.shell ? " dy-mr--b" : ""}"><span class="dy-ml">${esc(g.label)}</span><span class="dy-mi">${g.rows.map((id) => { const sp = d.sp[id]; return `<i class="dy-n" data-sp="${id}" data-kind="${sp.kind}" data-state="idle">${U.icon(sp.icon, 13)}${g.shell ? `<span class="dy-nn">${esc(sp.name)}</span>` : ""}</i>`; }).join("")}</span></div>`).join("")}</div>`;
}
export function nowPanelHTML(d, b) {
  const t = b.tr, lane = U.lane(d, b.lane);
  const msg = t.channel == "chat" || t.channel == "trainer_edit" ? t.trigger.text : t.trigger.text.replace(/^\[photo\]\s*/, "Meal photo: ");
  return `<header class="dy-nh"><span class="dy-av">${esc(initials(t.member))}</span><div class="dy-who"><b>${esc(b.t == "t7" ? "You, then Zayed" : t.member)}</b><span>${esc(b.at)} · ${esc(b.name)} · sample</span></div><span class="dy-lc" data-dy-lc aria-hidden="true">${lane}</span></header>
<p class="dy-msg" data-dy-msg>${esc(msg)}</p>
${b.t == "t7" ? `<ol class="dy-clear" data-dy-clear><li>Safety first: Noura’s report</li><li>Aisha’s plan change</li><li>Fatima’s spot check</li></ol>` : ""}
<ol class="dy-steps">${b.rows.map((x, j) => `<li class="dy-st" data-j="${j}" data-kind="${x.kind}" data-state="idle"><i class="dy-g" aria-hidden="true"></i><span class="dy-sn">${esc(x.name)}${x.usesAi ? ` <em class="dy-ua">uses your AI</em>` : ""}</span><span class="dy-say">${esc(x.say)}</span>${x.out ? `<span class="dy-out">${x.out.split(" ").map((w) => `<span class="dy-w">${esc(w)} </span>`).join("")}</span>` : ""}</li>`).join("")}</ol>`;
}
/** Today cards for the whole day, in their final order (safety first, then by time); the module only shows, hides and ticks them. */
export function todayHTML(M) {
  return [...M.beats, M.outro].map((b, i) => ({ b, o: b.today && b.today.tone == "paused" ? 0 : 1 + i })).filter((x) => x.b.today).sort((a, z) => a.o - z.o)
    .map(({ b }) => `<li class="dy-tc" data-t="${b.t}" data-tone="${b.today.tone || "waits"}" hidden><b>${esc(b.today.title)}</b><span>${esc(b.today.sub)}</span><i class="dy-ok" hidden>Done</i></li>`).join("");
}
export function seesPanelHTML(d, b) {
  const t = b.tr, r = b.r;
  if (b.t == "t7") return `<figure class="sc-phone dy-edit"><figcaption>Your Today, on your phone</figcaption><div class="ph-screen"><div class="ph-top"><span class="ph-av">LS</span><b>Your Today</b></div>
<div class="ph-msg"><span class="dy-ek">Your Brain drafted a reply · Zayed</span><p class="dy-et">Add <s data-dy-s>5 kg</s> <mark class="pv-you" data-dy-typed></mark> next time.</p></div>
<p class="dy-chip" data-dy-c1>Privacy: name becomes [client]</p><p class="dy-chip" data-dy-c2>Make this a rule? <b data-dy-conf></b></p><p class="dy-chip dy-chip--ok" data-dy-c3>About a minute later · <b>Passed · live</b></p></div></figure>`;
  let html = U.phone(d, t, r);
  if (t.channel == "voice") html = html.replace("What Sara sees", "What Sara hears").replace('<div class="ph-msg">', `<div class="ph-in">“too heavy”</div><div class="ph-msg">`).replace('<div class="ph-top">', `<p class="dy-sl">Say pain or tap Stop</p><div class="ph-top">`);
  if (t.channel == "meal_photo") html = html.replace('<div class="ph-msg">', `<div class="ph-in dy-photo">Lunch photo</div><div class="ph-msg">`);
  return html;
}

const TALLY = [["sent", "within your rules"], ["member", "member check"], ["waits", "waited for you"], ["paused", "paused"], ["learn", "new rule"]];
/* ------------------------------------------------------------------ HTML (shared by Node and the browser) */
const reel = (vals, cls, at = 0) => `<span class="dy-reel ${cls}"><span class="dy-strip"${at ? ` style="transform:translateY(-${at}em)"` : ""}>${vals.map((v) => `<span>${v}</span>`).join("")}</span></span>`;
function clockHTML() {
  const H = Array.from({ length: 25 }, (_, i) => String(i % 24).padStart(2, "0"));
  return `<p class="dy-clock" aria-hidden="true">${reel(H, "dy-hh", 6)}<span class="dy-colon">:</span>${reel(["0", "1", "2", "3", "4", "5", "0"], "dy-m1")}${reel(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0"], "dy-m2")}</p>`;
}
/** The stage at its start frame (06:00, nothing lit). The module binds to it. */
export function stageHTML(data, o = {}) {
  const M = o.M || model(data, o), d = M.d;
  const marks = [...M.beats, M.outro].map((b, i) => `<button type="button" class="dy-mk" data-k="${b.outro ? "o" : i}" aria-label="${esc(b.at)}, ${esc(b.name)}"><span>${esc(initials(b.tr.member))}</span></button>`).join("");
  const ic = (d2) => `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${d2}"/></svg>`;
  const all = [...M.beats, M.outro], on = o.mode == "play" ? "play" : "pin";
  // every caption and every beat's panels are rendered once and stacked in one grid cell: the stage keeps one height (no layout shift)
  const caps = capList(M).map(([k, t, v]) => `<span data-cap="${k}"${k == on ? ' class="is-cur"' : v ? ` class="dy-cap-${v}"` : ""}>${esc(t)}</span>`).join("");
  // the subtitle is aria-hidden (spec §1.6: the hour cards carry the same captions for screen readers); panels not shown are aria-hidden too
  const nows = `<div class="dy-pnl is-cur" data-pnl="intro">${introHTML(o.mode)}</div>` + all.map((b, i) => `<div class="dy-pnl" data-pnl="${panelKey(b, i)}" aria-hidden="true">${nowPanelHTML(d, b)}</div>`).join("");
  const sees = `<div class="dy-pnl is-cur" data-pnl="intro">${seesIntro}</div>` + all.map((b, i) => `<div class="dy-pnl" data-pnl="${panelKey(b, i)}" aria-hidden="true">${seesPanelHTML(d, b)}</div>`).join("");
  return `<div class="dy-stage sc-stage" data-dy-stage>
<i class="dy-wash" aria-hidden="true" style="opacity:1"></i>
<div class="dy-top">${U.strip(d)}<button type="button" class="dy-pause" aria-pressed="false" data-state="playing"><span data-label>Pause</span></button></div>
<div class="dy-ctl"><button type="button" class="dy-nav" data-dy-prev aria-label="Previous moment">${ic("M15 6l-6 6 6 6")}</button><label class="dy-scrub"><span class="sc-sr">Sample day position</span><input type="range" min="0" max="1000" value="0" data-dy-range aria-valuetext="06:00, the day starts"></label><button type="button" class="dy-nav" data-dy-next aria-label="Next moment">${ic("M9 6l6 6-6 6")}</button></div>
<div class="dy-a">
  <div class="dy-time">${clockHTML()}<p class="dy-sub"><span class="dy-sun" data-dy-sun aria-hidden="true"></span>Sample day · Dubai time</p>
    <p class="dy-you" data-you="coach"><span class="dy-yav" aria-hidden="true">LS</span><span data-dy-you>${esc(COPY.you.coach)}</span></p>
    <p class="dy-shelf dy-shelf--d" title="Built and tested. Not switched on yet."><span>Not on yet</span> Meal planner · Recovery rule</p>
    <div class="dy-legend"><span aria-hidden="true"><i class="dy-lg dy-lg-ai"></i>AI</span><span aria-hidden="true"><i class="dy-lg dy-lg-code"></i>Code</span><p class="dy-shelf" title="Built and tested. Not switched on yet."><span>Not on yet</span> Meal planner · Recovery rule</p></div>
    <dl class="dy-tally"><dt class="dy-tk">In this sample day</dt>${TALLY.map(([k, l]) => `<div data-lane="${k}"><dd data-dy-n="${k}">0</dd><dt>${esc(l)}</dt></div>`).join("")}</dl>
  </div>
  <div class="dy-board"><canvas class="dy-cv0" aria-hidden="true"></canvas><div class="dy-dim" aria-hidden="true"></div><div class="dy-gl" aria-hidden="true" hidden><div class="dy-gli"></div></div><canvas class="dy-cv" aria-hidden="true"></canvas><canvas class="dy-cvl" aria-hidden="true"></canvas><div class="dy-marks" role="group" aria-label="Moments in this sample day">${marks}</div></div>
</div>
<p class="dy-subtitle" data-dy-subtitle aria-hidden="true">${caps}</p>
<div class="dy-c">
  <section class="dy-now" aria-label="Right now"><div class="dy-pnls" data-dy-now>${nows}</div>${miniHTML(d)}<p class="dy-line" data-dy-line aria-hidden="true">${esc(COPY.introLine)}</p><p class="dy-stamp" aria-hidden="true">STOP · No AI called</p></section>
  <section class="dy-sees" aria-label="What the member sees"><div class="dy-pnls" data-dy-sees>${sees}</div></section>
  <section class="dy-today" aria-label="Your Today"><header class="dy-th"><span class="dy-yav" aria-hidden="true">LS</span><b>Your Today</b><span class="dy-cnt" data-dy-cnt>0 waiting</span></header><ol class="dy-tl" data-dy-tl data-empty>${todayHTML(M)}</ol><p class="dy-tnote" data-dy-tnote></p></section>
  <div class="dy-end" data-dy-end hidden aria-hidden="true"><h3>${esc(TEXT.endH)}</h3><p class="dy-tot">${esc(totals(M))}</p><p class="dy-subs">${esc(d.labels.subscribers)}</p>
    <div class="dy-end-cta"><a class="btn" href="${esc(o.cta || "signup.html")}" data-cta="day-end">Teach your AI — free${ic("M5 12h14M13 6l6 6-6 6")}</a><button type="button" class="dy-replay" data-dy-replay>Replay the day</button></div></div>
</div>
<p class="dy-strip2">${esc(d.labels.subscribers)}</p>
</div>`;
}
/** Reduced motion and no JS: the day as static hour cards, final state. */
export function cardsHTML(data, o = {}) {
  const M = o.M || model(data, o), d = M.d;
  const card = (b) => {
    const ai = b.rows.find((x) => x.ai && x.sp != "learner");
    const route = b.rows.filter((x) => x.kind != "picks").map((x) => `<li data-kind="${x.kind}" data-res="${x.res}"><b>${esc(x.name)}</b> ${esc(x.say)}</li>`).join("");
    return `<li class="dy-hc"><p class="dy-hc-t"><span class="fig">${esc(b.at)}</span>${esc(b.name)}</p>
<p class="dy-hc-c">${esc(CAPS[b.t])}</p><p class="dy-hc-l">${U.lane(d, b.lane)}${ai ? `<span class="dy-hc-ai">${esc(ai.name)} · code picked it</span>` : `<span class="dy-hc-ai">${esc(d.labels.noAi)}</span>`}</p>
<details class="dy-hc-d"><summary>Each step</summary><ol>${route}</ol></details></li>`;
  };
  return `<div class="dy-cards sc-stage" data-dy-cards>${U.strip(d)}<ol class="dy-hcs">${[...M.beats, M.outro].map(card).join("")}</ol>
<div class="dy-end-s"><h3>${esc(TEXT.endH)}</h3><p>${esc(totals(M))}</p></div></div>`;
}

