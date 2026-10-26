// Page group "audience": /for-trainers, /for-trainers/*, /uae, /get-started, /signup, /login.
// Copy follows blueprint C8-C12 and C24 (pending owner approval); content.json supplies the rest.
// Styles: site/assets/audience.css. Behaviour: site/assets/audience.js (+ calc.js on specialty pages).
import { createRequire } from "node:module";
import {
  esc, icon, cta, ctaMicro, button, textLink, link, band, sectionHead, chip, flagChip, notOnYet, sourceBadge,
  estimateLabel, sampleLabel, pendingTag, statusPanel, faqList, vx, decisionConsole, addressPreview, kamranPill,
  phoneFrame, windowFrame, appHead, lanePill, relatedLinks, content, href,
} from "./components.mjs";

const calc = createRequire(import.meta.url)("../site/assets/calc.js");
const page = (p) => content.pages.find((x) => x.path === p);
const section = (p, id) => page(p).sections.find((s) => s.id === id);
const noDot = (s) => s.replace(/\.$/, "");
const yourAI = (s) => s.replace(/\bthe Brain\b/g, "your AI").replace(/\bthe AI\b/g, "your AI").replace(/\bThe Brain\b/g, "Your AI");

/* ================================================================ shared */

/** Page hero: 5/7 copy and media; the first screen is never marked for reveal. */
function hero({ kicker, h1, lede, secondary = "", media, after = "", cls = "" }) {
  return `<section class="band band-white hero${cls ? " " + cls : ""}" data-hero aria-labelledby="hero-h">
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <p class="kicker">${esc(kicker)}</p>
      <h1 id="hero-h">${esc(h1)}</h1>
      <p class="lede">${esc(lede)}</p>
      <div class="cta-row hero-ctas">${cta({ location: "hero", size: "lg" })}${secondary}</div>
      ${ctaMicro()}
    </div>
    <div class="hero-media">${media}</div>
  </div>${after}
</section>`;
}

/** One-line "Not on yet" strip under a hero (payments off only). */
const statusStrip = (text, target = "/get-started#status") =>
  `<div class="wrap"><p class="status-strip" data-show="payments:off">${icon("minus")}<span>${esc(text)}</span> <a href="${href(target)}">What works today</a></p></div>`;

/** FAQ band in the home pattern: heading left, accordion right, inline Kamran on phones. */
function faqBand({ id, title, faqs, prefix, related = [], tone = "white" }) {
  return band(
    { tone, cls: "faq-band aud-faq", label: id },
    `<div class="split faq-split">
  <div class="s-copy" data-reveal>
    <h2 id="${id}">${esc(title)}</h2>
    <p class="mt-s">${textLink("/faq", "All questions")}</p>
    <div class="kamran-inline-m">${kamranPill()}</div>
  </div>
  <div class="s-media" data-reveal>${faqList(faqs, { prefix })}${related.length ? `<div class="aud-related">${relatedLinks(related, { title: "Keep reading" })}</div>` : ""}</div>
</div>`,
  );
}

/** Highlight a rule's consequence (after the arrow) with the Pace sweep; it plays with its console. */
const markRule = (rule) => {
  const [cond, act] = rule.split(" → ");
  return act ? `${esc(cond)} → <span class="rule-mark">${esc(act)}</span>` : `<span class="rule-mark">${esc(rule)}</span>`;
};

/**
 * Decision console for one specialty scenario. Adds the rule highlight sweep, an optional
 * confidence note, a plan heading, tone classes for the lane colours and a phone-only rule line.
 */
function specConsole(s, { id, autoplay = true } = {}) {
  const c = s.console;
  let html = decisionConsole({ ...c, id, autoplay, cls: `spec-console tone-${c.tone}` });
  html = html.replace(/<code class="rule-text mono">([\s\S]*?)<\/code>/, `<code class="rule-text mono">${markRule(c.rule)}</code>`);
  if (c.confNote) html = html.replace(/<p class="conf-note mono">[\s\S]*?<\/p>/, `<p class="conf-note mono">${esc(c.confNote)}</p>`);
  if (c.planHead) html = html.replace("<span>Next session</span>", `<span>${esc(c.planHead)}</span>`);
  const ruleM = `<p class="spec-rule-m"><span class="rule-src">${esc(c.ruleSource)}</span><code class="mono">${markRule(c.rule)}</code></p>`;
  return html.replace('<figcaption class="console-cap"', `${ruleM}<figcaption class="console-cap"`);
}

/** An axis row aligned with a timeline's track column. */
const axisRow = (cls, labels) => `<div class="${cls} axis" aria-hidden="true"><span class="axis-in mono">${labels.map((l) => `<span>${esc(l)}</span>`).join("")}</span></div>`;

const UNIVERSAL_FLOOR = ["Pain", "Pregnancy", "Chest pain", "Dizziness", "Fainting", "Bleeding"];

/* ======================================================= specialty data */
// Console scenarios and short rule lines are scripted samples built from each page's
// illustrative rules in content.json. Card bodies stay within 18 words.
const SPECS = {
  "/for-trainers/weight-loss": {
    key: "weight-loss", name: "Weight loss",
    h1: "Weight-loss coaching, taught to your own AI",
    lede: "Teach how you handle load, adherence and habits. Your AI adapts each plan daily and hands you anything outside your rules.",
    tile: "Load, adherence and habits, adjusted every day.",
    tileRule: "2 missed sessions in a week → hold volume",
    console: {
      message: "Scale hasn’t moved in three weeks. Should I eat less?",
      ruleSource: "Your rule · from interview, 9 Oct",
      rule: "no change in 3 check-ins → calories to you",
      confidence: 91, threshold: 80, confNote: "Your rule sends this to you, not a cut",
      laneFrom: "Checking your rule", laneTo: "Sent to you", tone: "toyou",
      planHead: "Today’s targets", day: "Week 6",
      rows: [
        { name: "Calories", sets: "daily", from: "1,800", to: "Review" },
        { name: "Protein", sets: "daily", from: "120 g" },
        { name: "Steps", sets: "daily", from: "8,000" },
      ],
      outcome: ["Calorie target", "1,800 kcal", "With you"],
    },
    rules: [
      { title: "Missed days", rule: "2 missed sessions in a week → hold volume", body: "Next week’s volume stays the same instead of progressing.", lane: ["Applied automatically", "applied"] },
      { title: "Steady progress", rule: "steady check-ins → keep plan, add 1 finisher", body: "Steady weekly progress keeps the plan and adds one short conditioning finisher.", lane: ["Applied automatically", "applied"] },
      { title: "Stalled progress", rule: "no change in 3 check-ins → calories to you", body: "The calorie target comes to you for review instead of being cut further.", lane: ["Sent to you", "toyou"] },
    ],
    floor: ["Dizziness, fainting or chest pain during exercise"],
    weeks: [2, 6, 4],
    faqs: [
      { id: "calories", q: "Can your AI set calorie targets?", a: "Targets follow the calorie methods you teach, and you can edit any client’s target. Requests outside your rules come to you." },
    ],
  },
  "/for-trainers/strength": {
    key: "strength", name: "Strength",
    h1: "Strength coaching, taught to your own AI",
    lede: "Teach your progression, deload and technique rules once. Your AI applies them to every lifter and asks you when unsure.",
    tile: "Load, reps in reserve, deloads and technique.",
    tileRule: "2 sessions at 3+ RIR → +2.5 kg",
    console: {
      message: "Bench felt easy. Three reps left on every set.",
      ruleSource: "Your rule · from interview, 12 Oct",
      rule: "2 sessions at 3+ RIR → +2.5 kg",
      confidence: 88, threshold: 80,
      laneFrom: "Checking your rule", laneTo: "Applied automatically", tone: "applied",
      day: "Thu · Upper body",
      rows: [
        { name: "Bench press", sets: "4 × 5", from: "70 kg", to: "72.5 kg" },
        { name: "Barbell row", sets: "4 × 8", from: "60 kg" },
        { name: "Overhead press", sets: "3 × 8", from: "40 kg" },
      ],
      outcome: ["Thu · Bench", "70 kg", "72.5 kg"],
    },
    rules: [
      { title: "Progress on evidence", rule: "2 sessions · all sets 3+ RIR → +2.5 kg", body: "Load goes up only when the logged sets show room to spare.", lane: ["Applied automatically", "applied"] },
      { title: "Technique before load", rule: "form doubt → repeat load, add a cue", body: "A beginner who doubts their form repeats the load with a technique cue first.", lane: ["Applied automatically", "applied"] },
      { title: "Deload", rule: "3 weeks rising effort → deload at 60%", body: "When effort climbs at the same load for three weeks, volume drops to 60%.", lane: ["Applied automatically", "applied"] },
    ],
    floor: ["Joint pain during or after a lift", "A return from injury"],
    weeks: [3, 6, 1],
    faqs: [
      { id: "rir", q: "Does it read logged reps in reserve?", a: "Yes. Subscribers log reps, load and effort; your rules decide how those drive progression." },
    ],
  },
  "/for-trainers/muscle-gain": {
    key: "muscle-gain", name: "Muscle gain",
    h1: "Muscle-gain coaching, taught to your own AI",
    lede: "Teach your volume, exercise and recovery rules. Your AI builds each plan around their schedule and adjusts from their logs.",
    tile: "Weekly volume, exercise swaps and recovery.",
    tileRule: "sessions done + good recovery → +1 set",
    console: {
      message: "All four sessions done. Recovery feels good.",
      ruleSource: "Your rule · from interview, 3 Oct",
      rule: "sessions done + good recovery → +1 set",
      confidence: 84, threshold: 80,
      laneFrom: "Checking your rule", laneTo: "Applied automatically", tone: "applied",
      day: "Mon · Push",
      rows: [
        { name: "Incline press", sets: "× 10", from: "3 sets", to: "4 sets" },
        { name: "Cable fly", sets: "× 12", from: "3 sets" },
        { name: "Dips", sets: "× 8", from: "3 sets" },
      ],
      outcome: ["Chest · sets this week", "12", "13"],
    },
    rules: [
      { title: "Volume steps", rule: "sessions done + good recovery → +1 set", body: "One more set per muscle group each week while sessions are done and recovery is good.", lane: ["Applied automatically", "applied"] },
      { title: "Equipment swaps", rule: "machine unavailable → approved swap", body: "A missing machine swaps to your approved alternative for the same muscle and rep range.", lane: ["Applied automatically", "applied"] },
      { title: "Recovery", rule: "sore 3 days running → hold volume 1 week", body: "Three days of reported soreness holds volume for a week.", lane: ["Applied automatically", "applied"] },
    ],
    floor: ["Sharp pain rather than muscle soreness"],
    weeks: [4, 6, 2],
    faqs: [
      { id: "meals", q: "Can I pair it with meal plans?", a: "Yes. Offer the workout and nutrition tier so meal plans follow your nutrition teaching." },
    ],
  },
  "/for-trainers/pre-postnatal": {
    key: "pre-postnatal", name: "Pre and postnatal",
    h1: "Pre and postnatal coaching, taught to your AI",
    lede: "Pregnancy and red flags always pause and come to you, enforced in code. Routine automation starts only after your postnatal clearance.",
    tile: "Pregnancy always pauses. Automation starts after your clearance.",
    tileRule: "pregnancy mentioned → pause, send to you",
    console: {
      message: "I’m 20 weeks pregnant. Can I keep doing lunges?",
      ruleSource: "Safety rule · enforced in code",
      rule: "pregnancy mentioned → pause, send to you",
      confidence: 97, threshold: 80, confNote: "Acts at any score · can’t be switched off",
      laneFrom: "Checking safety rules", laneTo: "Paused, sent to you", tone: "paused",
      day: "Today",
      rows: [
        { name: "Lower body", sets: "40 min", from: "Planned", to: "Paused" },
        { name: "Walk", sets: "Wed", from: "Planned", to: "Paused" },
      ],
      outcome: ["Training", "Active", "Paused"],
    },
    rules: [
      { title: "Clearance first", rule: "no clearance + your review → no programme", body: "No postnatal programme starts until their doctor has cleared them and you have reviewed it.", lane: ["Waits for you", "toyou"] },
      { title: "Effort cap", rule: "first weeks back → talk-test effort", body: "Early weeks stay at an effort where they can hold a conversation. No breath-holding lifts.", lane: ["Applied automatically", "applied"] },
      { title: "Postnatal return", rule: "breathing + pelvic floor → then loaded core", body: "Breathing and pelvic floor work come before loaded core exercises.", lane: ["Applied automatically", "applied"] },
    ],
    floor: ["Any mention of pregnancy", "Pelvic pain"],
    weeks: null,
    faqs: [
      { id: "safe", q: "Is this safe for pregnant clients?", a: "The platform gives no medical advice. Any mention of pregnancy pauses training and comes to you, enforced in code. Your AI can draft; you approve. Routine automation is for postnatal return, after your clearance step." },
      { id: "switch", q: "Can I switch the pregnancy pause off for my clients?", a: "No. Pregnancy is part of the safety rules that apply to every trainer. You review the pause and decide what happens next." },
      { id: "arabic", q: "Can my subscribers use it in Arabic?", a: "The follower app supports English and Arabic, including right-to-left layouts. The trainer area is in English, and what you write is not translated automatically." },
    ],
  },
};
const SPEC_ORDER = ["/for-trainers/weight-loss", "/for-trainers/strength", "/for-trainers/muscle-gain", "/for-trainers/pre-postnatal"];
const priceOf = (path) => page(path).examplePriceAed;

/* ======================================================= /for-trainers */

function ftHero() {
  const tabs = SPEC_ORDER.map((p, i) => {
    const s = SPECS[p];
    return `<button type="button" role="tab" id="ft-t-${s.key}" aria-controls="ft-p-${s.key}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" data-key="${s.key}">${esc(s.name)}</button>`;
  }).join("");
  const panels = SPEC_ORDER.map((p, i) => {
    const s = SPECS[p];
    return `<div class="ft-panel" role="tabpanel" id="ft-p-${s.key}" aria-labelledby="ft-t-${s.key}"${i ? " hidden" : ""}>
  ${specConsole(s, { id: `ft-c-${s.key}`, autoplay: i === 0 })}
  <p class="ft-panel-foot"><span class="mono">Example price · AED ${priceOf(p)} a month</span>${textLink(p, `${s.name} coaching`)}</p>
</div>`;
  }).join("");
  const media = `<div class="ft-switch" data-tabs data-ft-switch>
  <div class="ft-switch-head"><p class="ft-switch-label" id="ft-switch-l">Pick a specialty. Watch your AI apply your rule.</p></div>
  <div class="ft-tabs" role="tablist" aria-labelledby="ft-switch-l">${tabs}</div>
  ${panels}
</div>`;
  return hero({
    kicker: "For trainers",
    h1: "Your specialty, taught to your own AI",
    lede: "Every specialty has its own rules, progressions and red flags. Choose yours to see the rules a trainer might teach.",
    secondary: button("/demo", "Try the demo", { location: "hero", size: "lg" }),
    media,
    cls: "ft-hero",
  });
}

function ftTiles() {
  const tiles = SPEC_ORDER.map((p) => {
    const s = SPECS[p];
    return `<li class="ri"><a class="ft-tile" href="${href(p)}" data-cta="link" data-loc="tile">
  <span class="ft-tile-top"><h3>${esc(s.name)}</h3>${icon("arrow", "ft-arrow")}</span>
  <span class="ft-tile-sub">${esc(s.tile)}</span>
  <span class="ft-tile-rule"><span class="rule-src">Example rule</span><code class="mono">${esc(s.tileRule)}</code></span>
  <span class="ft-tile-price"><span class="mono ft-aed">AED ${priceOf(p)}</span><span class="ft-per">a month · example price</span></span>
</a></li>`;
  }).join("");
  return band(
    { tone: "paper", cls: "ft-tiles-band", label: "tiles-h" },
    `${sectionHead({ kicker: "Four specialties", title: "Choose your specialty", id: "tiles-h", layout: "split", lede: "Each page shows rules a trainer might teach, what always comes back to you, and a follower estimate." })}
<ul class="ft-tiles" data-reveal="stagger">${tiles}</ul>
<p class="ft-tiles-note">${notOnYet("payments", "subscriber payments")}<span class="note">Example prices. You set your own in setup.</span></p>`,
  );
}

function ftRoutes() {
  const routes = [
    { k: "gym", h: "On a gym floor", b: "Your hours are full. See what a monthly price could add.", to: [["/follower-calculator", "What are my followers worth?"]] },
    { k: "online", h: "Already online", b: "Check your AI sounds like you, then check what we take.", to: [["/demo", "Try the demo"], ["/pricing", "See pricing"]] },
    { k: "studio", h: "I run a studio", b: "Invite staff coaches. You keep the brand and your AI.", to: [["/features/team", "Team features"]] },
  ];
  const rows = routes.map((r) => `<li class="route ri">
  <div class="route-if"><span class="mono route-n">if</span><h3>${esc(r.h)}</h3></div>
  <p class="route-b">${esc(r.b)}</p>
  <span class="route-line" aria-hidden="true"></span>
  <div class="route-to">${r.to.map(([p, l]) => button(p, l, { location: "routes" }).replace("</a>", `${icon("arrow", "btn-arrow")}</a>`)).join("")}</div>
</li>`).join("");
  return band(
    { tone: "white", cls: "routes-band", label: "routes-h" },
    `${sectionHead({ title: "How do you coach now?", id: "routes-h", lede: "Three starting points. Pick the one that sounds like you." })}
<ol class="routes" data-reveal="stagger">${rows}</ol>`,
  );
}

function ftWhere() {
  const rows = [
    ["Prices", "AED", flagChip("model", "Live")],
    ["Followers’ app", "English · Arabic, right-to-left", flagChip("model", "Live")],
    ["Time zone", "UAE · UTC+4", flagChip("model", "Live")],
    ["Payouts", "to a UAE bank", flagChip("payments", "Live")],
  ];
  return band(
    { tone: "paper", cls: "where-band", label: "where-h" },
    `<div class="split where-split">
  <div class="s-copy" data-reveal>
    <p class="kicker">Where you coach</p>
    <h2 id="where-h">Built for coaching in the UAE</h2>
    <p class="sec-lede mt-s">Priced in AED, with Arabic for your followers and dates in UAE time.</p>
  </div>
  <div class="s-media" data-reveal>
    <a class="where-card" href="${href("/uae")}" data-cta="link" data-loc="where">
      <span class="where-top"><span class="mono where-tag">UAE · AED · EN / AR</span>${icon("arrow", "ft-arrow")}</span>
      <span class="where-title">In the UAE</span>
      <dl class="where-rows">${rows.map(([k, v, c]) => `<div><dt class="mono">${esc(k)}</dt><dd><span>${esc(v)}</span>${c}</dd></div>`).join("")}</dl>
    </a>
  </div>
</div>`,
  );
}

function forTrainers() {
  return {
    main: [ftHero(), ftTiles(), ftRoutes(), ftWhere()].join("\n"),
    closing: { secondary: { label: "Try the demo", path: "/demo" } },
  };
}

/* ===================================================== specialty pages */

function specHero(path, s) {
  return hero({
    kicker: `For trainers · ${s.name}`,
    h1: s.h1,
    lede: s.lede,
    secondary: button("/features/safety", "See the full safety rules", { location: "hero", size: "lg" }),
    media: specConsole(s, { id: "sp-console" }),
    cls: `spec-hero spec-${s.key}`,
  });
}

/** Pre and postnatal: "Waits for me" mode, shown first. */
function waitsForMe() {
  const rows = [
    { who: "Subscriber · 22 weeks pregnant", msg: "Can I keep doing lunges?", lane: lanePill("Paused · yours to decide", "paused") },
    { who: "Subscriber · postnatal, week 9", msg: "My doctor cleared me today.", lane: lanePill("Draft waits for you", "toyou"), draft: "Great news. I’ll review it and start your return plan." },
  ];
  const inbox = windowFrame(
    `<div class="wm-mode" aria-hidden="true"><span class="wm-opt is-on">${icon("check")}Waits for me</span><span class="wm-opt">${icon("lock")}Automatic<small class="mono">20 cases + checks</small></span></div>
    <ul class="wm-list">${rows.map((r) => `<li><p class="cp-label">${esc(r.who)}</p><p class="wm-msg">“${esc(r.msg)}”</p>${r.draft ? `<p class="wm-draft"><span class="mono">Draft</span>${esc(r.draft)}</p>` : ""}<div class="wm-foot">${r.lane}${r.draft ? `<span class="wm-acts" aria-hidden="true"><span>Edit</span><span class="is-ink">Approve</span></span>` : ""}</div></li>`).join("")}</ul>`,
    { title: "Inbox · Waits for you", meta: "Sample", cls: "wm-window" },
  );
  return band(
    { tone: "paper", cls: "wm-band", label: "wm-h" },
    `<div class="split wm-split">
  <div class="s-copy" data-reveal>
    <p class="kicker">“Waits for me” mode</p>
    <h2 id="wm-h">Every reply waits for you</h2>
    <p class="sec-lede mt-s">Replies wait for your approval until you switch on automatic sending. That needs 20 cases and passing checks.</p>
    <p class="wm-note">For pregnant subscribers, every decision stays yours, whatever mode you choose.</p>
  </div>
  <div class="s-media" data-reveal>${inbox}${sampleLabel("Sample · scripted")}</div>
</div>`,
  );
}

function specRules(path, s) {
  const cards = s.rules.map((r, i) => `<li class="rcard ri">
  <p class="rcard-n mono">Rule ${String(i + 1).padStart(2, "0")}</p>
  <h3>${esc(r.title)}</h3>
  <div class="rule-chip"><span class="rule-src">Your rule · illustrative</span><code class="rule-text mono">${esc(r.rule)}</code></div>
  <p class="rcard-b">${esc(r.body)}</p>
  <div class="rcard-lane">${lanePill(r.lane[0], r.lane[1])}</div>
</li>`).join("");
  return band(
    { tone: s.key === "pre-postnatal" ? "white" : "paper", cls: "rules-band", label: "rules-h" },
    `${sectionHead({ kicker: "Illustrative", title: "Rules you might teach your AI", id: "rules-h", layout: "split", lede: "Your AI learns your own wording, reasons and limits. These show the shape a rule takes." })}
<ol class="rcards" data-reveal="stagger">${cards}</ol>`,
  );
}

function specFloor(path, s) {
  const review = section(path, "handoffs").bullets;
  const chips = [...UNIVERSAL_FLOOR.map((t) => ({ t, own: false })), ...s.floor.map((t) => ({ t, own: true }))];
  return band(
    { tone: s.key === "pre-postnatal" ? "paper" : "white", cls: "floor-band", label: "floor-h" },
    `${sectionHead({ kicker: "Safety", title: "Always paused, always sent to you", id: "floor-h", layout: "split", lede: "Enforced in code, outside your AI. No setting can switch it off." })}
<div class="floor-grid">
  <div class="floor" data-reveal>
    <div class="floor-head">${lanePill("Paused, sent to you", "paused")}<span class="mono floor-src">Safety rule · every trainer</span></div>
    <h3 class="floor-h3">Training pauses for</h3>
    <ul class="floor-chips" data-reveal="stagger">${chips.map((c) => `<li class="ri"><span class="chip chip-paused${c.own ? " is-own" : ""}">${esc(c.t)}</span></li>`).join("")}</ul>
    <p class="floor-own"><span class="floor-key" aria-hidden="true"></span>Outlined: added for ${esc(s.name.toLowerCase())} coaching</p>
    <p class="mt-s">${textLink("/features/safety", "See the full safety rules")}</p>
  </div>
  <div class="review" data-reveal>
    <div class="floor-head">${lanePill("Sent to you", "toyou")}<span class="mono floor-src">Your choice · switch on</span></div>
    <h3 class="floor-h3">Review topics you might add</h3>
    <p class="review-lede">Your AI already hands you anything it isn’t sure about. Examples a trainer might add:</p>
    <ul class="review-list">${review.map((b) => `<li>${icon("arrow")}<span>${esc(noDot(yourAI(b)))}</span></li>`).join("")}</ul>
  </div>
</div>`,
  );
}

function specProgramme(path, s) {
  const t = section(path, "programme").table;
  let segs;
  if (s.weeks) {
    const total = s.weeks.reduce((a, b) => a + b, 0);
    let start = 0;
    segs = s.weeks.map((w) => { const seg = { from: start / total, size: w / total }; start += w; return seg; });
  } else segs = [{ from: 0, size: 0.44 }, { from: 0.44, size: 0.12, gate: true }, { from: 0.56, size: 0.44 }];
  const axis = s.weeks
    ? axisRow("pg-axis", ["Week 1", `Week ${s.weeks.reduce((a, b) => a + b, 0)}`])
    : axisRow("pg-axis", ["Pregnancy", "Clearance", "Postnatal return"]);
  const rows = t.rows.map((r, i) => `<li class="pg-row ri${segs[i].gate ? " is-gate" : ""}" style="--i:${i}">
  <div class="pg-text"><p class="pg-phase mono">${esc(r[0].replace("-", "–"))}</p><h3>${esc(r[1])}</h3><p class="pg-how">${esc(yourAI(r[2]))}</p></div>
  <div class="pg-track" aria-hidden="true"><span class="pg-bar" style="--from:${segs[i].from.toFixed(4)};--size:${segs[i].size.toFixed(4)}">${segs[i].gate ? icon("lock") : ""}</span></div>
</li>`).join("");
  return band(
    { tone: s.key === "pre-postnatal" ? "white" : "paper", cls: "pg-band", label: "pg-h" },
    `${sectionHead({ kicker: "Programme", title: "An illustrative programme outline", id: "pg-h", layout: "split", lede: "How your AI adapts each phase. You set the length and content." })}
<div class="pg" data-reveal>
  ${axis}
  <ol class="pg-rows" data-reveal="stagger">${rows}</ol>
  <p class="note pg-cap">${esc(t.caption)}.</p>
</div>`,
  );
}

function specLadder(path, s) {
  const price = priceOf(path);
  const rungs = [
    { k: "One session with a trainer", v: "AED 70–350", u: "per session", src: sourceBadge("heytrainer-dubai-2026") },
    { k: "A month of your AI coaching", v: `AED ${price}`, u: "a month · example price", you: true, src: notOnYet("payments", "subscriber payments") },
  ];
  return band(
    { tone: "white", cls: "ladder-band", label: "ladder-h" },
    `<div class="split ladder-split">
  <div class="s-copy" data-reveal>
    <p class="kicker">Your price</p>
    <h2 id="ladder-h">Where your price sits</h2>
    <p class="sec-lede mt-s">AED ${price} a month sits inside what one session costs in Dubai.</p>
  </div>
  <div class="s-media" data-reveal>
    <div class="lscale" data-reveal aria-hidden="true">
      <div class="lscale-track">
        <span class="lscale-range" style="--from:${(70 / 400).toFixed(4)};--size:${(280 / 400).toFixed(4)}"><span class="lscale-l mono">One session · AED 70–350</span></span>
        <span class="lscale-you" style="--at:${(price / 400).toFixed(4)}"><span class="lscale-tag">Your month · <span class="mono">AED ${price}</span></span></span>
      </div>
      <div class="lscale-axis mono"><span>AED 0</span><span>100</span><span>200</span><span>300</span><span>400</span></div>
    </div>
    <ol class="ladder">${rungs.map((r) => `<li class="rung${r.you ? " is-you" : ""}"><span class="rung-k">${esc(r.k)}</span><span class="rung-v mono">${esc(r.v)}</span><span class="rung-u">${esc(r.u)}</span><span class="rung-src">${r.src}</span></li>`).join("")}</ol>
    <p class="mt-s">${pendingTag("Budget-gym rung waits on decision 19")}</p>
  </div>
</div>`,
  );
}

/** Compact follower calculator at a page's example price (maths: calc.js; first paint from the same module). */
function followerCalc(price, id = "afc") {
  const d = { followers: 7000, priceAed: price, linkStoriesPerMonth: 8 };
  const est = calc.estimateFollowers(d);
  const v = (k) => est.scenarios[k].revenueMonth12Minor;
  const max = Math.max(1, v("strong"));
  const lane = (key, label) =>
    `<div class="calc-lane" data-lane="${key}"><span class="calc-lane-label">${esc(label)}</span><span class="calc-lane-bar"><span style="--v:${(v(key) / max).toFixed(4)}"></span></span><span class="calc-lane-val">${vx(calc.aed(v(key)), 11, { cls: "vx-end" })}</span></div>`;
  const field = (k, label, value, maxv, affix = "") =>
    `<div class="field"><label for="${id}-${k}">${esc(label)}</label><div class="${affix ? "input-affix" : ""}">${affix ? `<span class="affix">${affix}</span>` : ""}<input class="input" id="${id}-${k}" data-k="${k}" type="number" inputmode="numeric" min="0" max="${maxv}" step="1" value="${value}"></div></div>`;
  return `<div class="calc" data-aud-fc>
  <div class="calc-inputs" data-reveal><form class="calc-form" novalidate>
    ${field("followers", "Instagram followers", d.followers, 10000000)}
    ${field("price", "Your monthly price", d.priceAed, 10000, "AED")}
    ${field("stories", "Stories with your link each month", d.linkStoriesPerMonth, 60)}
    <p class="note">Also assumes 4 keyword Reels a month and 30% of subscribers cancelling a year. ${textLink("/follower-calculator", "Change every input")}</p>
  </form></div>
  <div class="calc-result" data-reveal>
    ${windowFrame(
      `<div class="calc-head">${chip("Best case", "neutral")}${notOnYet("payments", "subscriber payments")}${estimateLabel()}</div>
      <p class="calc-figure-line"><span class="calc-upto">Up to</span> <span class="calc-figure">${vx(calc.aed(v("strong")), 10, { cls: "afc-strong" })}</span></p>
      <p class="calc-sub">a month at your price, before platform commission</p>
      <div class="calc-lanes">${lane("cautious", "Cautious")}${lane("typical", "Typical")}${lane("strong", "Best case")}</div>
      <div class="calc-foot">${sourceBadge("revenuecat-state-2026", { label: "Sources" })}<span class="note">Active subscribers after 12 months × your price.</span></div>
      <p class="sr-only" aria-live="polite" data-live></p>`,
      { title: "Follower estimate", meta: "12 months", cls: "calc-window" },
    )}
  </div>
  <div class="fc-cta">${cta({ location: "inline" })}${ctaMicro({ short: true })}</div>
</div>`;
}

function specCalc(path) {
  const price = priceOf(path);
  return band(
    { tone: "paper", cls: "fc-band", label: "fc-h" },
    `${sectionHead({ kicker: "Calculator", title: "What your followers could be worth", id: "fc-h", layout: "split", lede: `Starts at the example price of AED ${price}. Change it to yours. A best case, not a promise.` })}
${followerCalc(price)}`,
  );
}

function specialty(path) {
  return () => {
    const s = SPECS[path];
    const p = page(path);
    const pain = p.faqs.find((f) => /pain/.test(f.q));
    const faqs = s.key === "pre-postnatal" ? s.faqs : [...s.faqs, { id: "pain", q: pain.q, a: yourAI(pain.a) }];
    const parts = [specHero(path, s)];
    if (s.key === "pre-postnatal") parts.push(waitsForMe());
    parts.push(specRules(path, s), specFloor(path, s), specProgramme(path, s), specLadder(path, s), specCalc(path));
    parts.push(faqBand({ id: "sfaq-h", title: `${s.name} questions`, faqs, prefix: "sfaq", related: p.related }));
    return {
      main: parts.join("\n"),
      js: ["calc.js"],
      closing: { secondary: { label: "See the full safety rules", path: "/features/safety" } },
    };
  };
}

/* ================================================================ /uae */

// Real member-app strings (apps/web/lib/i18n/messages: nav.ts, plan.ts, chat.ts), English and Arabic.
const AR = {
  today: ["Today", "اليوم"], week: ["Today · week 4", "اليوم · الأسبوع 4"],
  yourWorkout: ["Your workout", "تمرينك"], session: ["Training session", "جلسة تدريب"], exercises: ["5 exercises", "5 تمارين"],
  start: ["Start workout", "بدء التمرين"], comingUp: ["Coming up", "القادم"], tomorrow: ["Tomorrow", "غدًا"],
  message: ["Message Layla Strength", "رسالة إلى Layla Strength"],
  tabs: [["Today", "اليوم"], ["Plan", "الخطة"], ["Chat", "المحادثة"], ["Progress", "التقدّم"]],
};
const t2 = ([en, ar], tag = "span", cls = "") => `<${tag}${cls ? ` class="${cls}"` : ""} data-ar="${esc(ar)}">${esc(en)}</${tag}>`;

function uaeVignette() {
  const screen = `${appHead()}
  <div class="uv" data-rtl-screen lang="en" dir="ltr">
    <p class="uv-date">${t2(AR.week)}</p>
    <div class="uv-card">
      ${t2(AR.yourWorkout, "p", "uv-k")}
      ${t2(AR.session, "p", "uv-title")}
      ${t2(AR.exercises, "p", "uv-meta")}
      ${t2(AR.start, "span", "uv-btn")}
    </div>
    ${t2(AR.comingUp, "p", "uv-h")}
    <ul class="uv-list">
      <li><span class="uv-ex">Back squat</span><span class="mono">4 × 6</span></li>
      <li><span class="uv-ex">Romanian deadlift</span><span class="mono">3 × 8</span></li>
      <li><span class="uv-ex">Walking lunge</span><span class="mono">3 × 10</span></li>
    </ul>
    <p class="uv-input">${t2(AR.message)}</p>
    <div class="app-tabs" aria-hidden="true">${AR.tabs.map((t, i) => t2(t, "span", i ? "" : "is-on")).join("")}</div>
  </div>`;
  return `<figure class="uv-stage" data-rtl aria-labelledby="uv-cap">
  <div class="uv-toggle" role="group" aria-label="Preview language"><button type="button" data-lang="en" aria-pressed="true">English</button><button type="button" data-lang="ar" aria-pressed="false" lang="ar">العربية</button></div>
  <div class="uv-device dots">${phoneFrame(screen, { cls: "uv-phone" })}
    <p class="uv-callout" aria-hidden="true"><span class="mono">Your words</span>stay as you wrote them</p>
  </div>
  <figcaption id="uv-cap" class="uv-cap">${sampleLabel("Sample trainer · real app strings")}<span class="note">Right-to-left preview applies to this screen only.</span></figcaption>
</figure>`;
}

function uaeHero() {
  return hero({
    kicker: "United Arab Emirates",
    h1: "Built for personal trainers in the UAE",
    lede: "AED prices, English and Arabic for followers, and dates in UAE time. Your audience is already on Instagram.",
    secondary: button("/pricing", "See pricing in AED", { location: "hero", size: "lg" }),
    media: uaeVignette(),
    after: statusStrip("Payouts and paid bookings are not on yet."),
    cls: "uae-hero",
  });
}

function uaeLocal() {
  const rows = [
    ["currency", "Prices and statements in AED", flagChip("model", "Live")],
    ["payouts", "Monthly, to a verified UAE IBAN", flagChip("payments", "Live")],
    ["languages", "English and Arabic for followers, right-to-left", flagChip("model", "Live")],
    ["bookings", "Paid in-person sessions in your city", flagChip("payments", "Live")],
    ["time zone", "Dates and reminders in UAE time", flagChip("model", "Live")],
  ];
  return band(
    { tone: "white", cls: "local-band", label: "local-h" },
    `<div class="split local-split">
  <div class="s-copy" data-reveal>
    <p class="kicker">Built for here</p>
    <h2 id="local-h">Built for the UAE</h2>
    <p class="sec-lede mt-s">Set up the way UAE coaching works. Two parts wait for payments.</p>
  </div>
  <div class="s-media" data-reveal>${windowFrame(
    `<dl class="spec-sheet">${rows.map(([k, v, c]) => `<div class="spec-row"><dt class="mono">${esc(k)}</dt><dd><span>${esc(v)}</span>${c}</dd></div>`).join("")}</dl>`,
    { title: "Workspace · Region", meta: "UAE", cls: "spec-window" },
  )}</div>
</div>`,
  );
}

function uaeAudience() {
  const figs = [
    { v: "11.1M", l: "internet users", s: "99.0% of the population" },
    { v: "7.60M", l: "Instagram users", s: "67.8% of the population" },
    { v: "31.6", l: "median age", s: "years" },
  ];
  return band(
    { tone: "paper", cls: "aud-band", label: "aud-h" },
    `${sectionHead({ kicker: "Your audience", title: "Your audience is already here", id: "aud-h", layout: "split", lede: "The people who follow you for workouts and meals are reachable where you already post." })}
<ul class="figs" data-reveal="stagger">${figs.map((f) => `<li class="fig ri"><p class="fig-v">${esc(f.v)}</p><p class="fig-l">${esc(f.l)}</p><p class="fig-s mono">${esc(f.s)}</p></li>`).join("")}</ul>
<p class="figs-src">${sourceBadge("datareportal-uae-2025")}<span class="note">DataReportal, Digital 2025: the UAE, January 2025.</span></p>`,
  );
}

function uaePrices() {
  const max = 2000;
  const rungs = [
    { k: "One-to-one session", lo: 70, hi: 350, v: "AED 70–350", u: "per session", src: "heytrainer-dubai-2026" },
    { k: "One-to-one session", lo: 200, hi: 700, v: "AED 200–700+", u: "per session", src: "embody-dubai-2025", plus: true },
    { k: "Your AI coaching", lo: 199, hi: 199, v: "AED 199", u: "a month · example price", you: true },
    { k: "Online coaching", lo: 400, hi: 2000, v: "AED 400–2,000", u: "a month", src: "369mmafit-online-2026" },
  ];
  const rows = rungs.map((r) => `<li class="lad-row ri${r.you ? " is-you" : ""}">
  <div class="lad-k"><span class="lad-name">${esc(r.k)}</span><span class="lad-u">${esc(r.u)}</span></div>
  <span class="lad-v mono">${esc(r.v)}</span>
  <span class="lad-track" aria-hidden="true"><span class="lad-bar${r.plus ? " is-open" : ""}" style="--from:${(r.lo / max).toFixed(4)};--size:${Math.max(0.012, (r.hi - r.lo) / max).toFixed(4)}"></span></span>
  <span class="lad-src">${r.you ? notOnYet("payments", "subscriber payments") : sourceBadge(r.src)}</span>
</li>`).join("");
  return band(
    { tone: "white", cls: "prices-band", label: "prices-h" },
    `${sectionHead({ kicker: "Prices", title: "What followers pay now", id: "prices-h", layout: "split", lede: "Published Dubai price guides, not official statistics. Your AI coaching sits in between." })}
<div class="lad" data-reveal>
  ${axisRow("lad-axis", ["AED 0", "500", "1,000", "1,500", "2,000"])}
  <ol class="lad-rows" data-reveal="stagger">${rows}</ol>
  <p class="lad-foot"><span class="lad-between">Your AI coaching sits in between: a month of your method for about the price of one session.</span>${pendingTag("Budget-gym rung: decision 19")}</p>
</div>`,
  );
}

function uaeEmirates() {
  const cols = [
    { h: "Dubai", v: "2.73M", l: "took part in Dubai Fitness Challenge 2024", src: sourceBadge("dubai-fitness-challenge-2024") },
    { h: "Abu Dhabi", v: "60.3%", l: "of residents meet WHO activity standards, up from 53.6% (about 31,000 responses)", src: sourceBadge("abu-dhabi-activity-survey-2026"), bars: [53.6, 60.3] },
    { h: "Northern emirates", v: "—", l: "We found no published local prices for Sharjah, Ajman or the north, so we quote none.", src: "" },
  ];
  return band(
    { tone: "paper", cls: "em-band", label: "em-h" },
    `${sectionHead({ kicker: "Across the emirates", title: "Dubai, Abu Dhabi and beyond", id: "em-h", layout: "split", lede: "Online coaching isn’t tied to where you train. In-person bookings happen where you publish them." })}
<ul class="em" data-reveal="stagger">${cols.map((c) => `<li class="em-col ri">
  <h3>${esc(c.h)}</h3>
  <p class="em-v${c.v === "—" ? " is-none" : ""}">${esc(c.v)}</p>
  ${c.bars ? `<div class="em-bars" aria-hidden="true">${c.bars.map((b, i) => `<span class="em-bar${i ? " is-now" : ""}" style="--w:${(b / 100).toFixed(3)}"><span class="mono">${b}%</span></span>`).join("")}</div>` : ""}
  <p class="em-l">${esc(c.l)}</p>
  ${c.src ? `<p class="em-src">${c.src}</p>` : ""}
</li>`).join("")}</ul>`,
  );
}

function uaeLicences() {
  return band(
    { tone: "white", cls: "lic-band", label: "lic-h" },
    `${sectionHead({ kicker: "Information only", title: "Licences and credentials", id: "lic-h", layout: "split", lede: "General information, not legal advice. Rules change, so check with the authority." })}
<div class="lic" data-reveal="stagger">
  <div class="lic-item ri rule-top">
    <h3>Advertiser permit</h3>
    <p>Reports on the UAE Advertiser Permit say people promoting their own services through personal accounts are exempt. Rules change, so check with the UAE Media Council. This is information, not legal advice.</p>
    <p class="lic-src">${sourceBadge("gulfnews-advertiser-permit")}${sourceBadge("uae-media-council-permit", { label: "Media Council" })}</p>
    <p>${textLink("/guides/uae-advertiser-permit", "Read the permit guide")}</p>
  </div>
  <div class="lic-item ri rule-top">
    <h3>Your trade licence</h3>
    <p>What you need depends on how and where you work. You can set up and teach your AI first; payments and launch have their own checks.</p>
    <p class="mt-s">${pendingTag("Mu’Ahal accreditation note waits on decision 19")}</p>
  </div>
  <div class="lic-item ri rule-top">
    <h3>Credentials</h3>
    <p>trainsyou doesn’t verify credentials. Your followers judge yours, so show them on your page.</p>
  </div>
</div>`,
  );
}

function uaeArabic() {
  const lines = [
    { k: "Followers’ app", v: "English and Arabic, right-to-left", c: chip("Included", "live") },
    { k: "Trainer area", v: "English", c: chip("English only", "neutral") },
    { k: "What you write", v: "Shown as written, never auto-translated", c: chip("As written", "neutral") },
  ];
  const ramadan = windowFrame(
    `<p class="cp-label">Subscriber · Ramadan</p>
    <p class="cp-quote">“Can I move my meals to after iftar?”</p>
    <div class="rule-chip"><span class="rule-src">Safety rule</span><code class="rule-text mono">fasting meal timing → to you</code></div>
    <div class="cp-lane rd-lane">${lanePill("Sent to you", "toyou")}</div>`,
    { title: "Inbox · Decision", meta: "Sample", cls: "rd-window" },
  );
  return band(
    { tone: "paper", cls: "ar-band", label: "ar-h" },
    `<div class="ar-grid">
  <div class="ar-col" data-reveal>
    <p class="kicker">Language</p>
    <h2 id="ar-h">Arabic, honestly</h2>
    <dl class="ar-lines">${lines.map((l) => `<div><dt>${esc(l.k)}</dt><dd><span>${esc(l.v)}</span>${l.c}</dd></div>`).join("")}</dl>
  </div>
  <div class="ar-col" data-reveal>
    <p class="kicker">Ramadan</p>
    <h2 id="rd-h">Fasting questions come to you</h2>
    <p class="sec-lede mt-s">Meal timing while fasting goes to you. Your AI never treats fasting as disordered eating.</p>
    <div class="mt-m">${ramadan}</div>
  </div>
</div>`,
  );
}

function uae() {
  const p = page("/uae");
  const f = (q) => p.faqs.find((x) => x.q.startsWith(q));
  const faqs = [
    { id: "licence", q: f("Do I need a trade").q, a: "You can set up and teach your AI without one. Business details are collected during setup, and payments and launch have their own checks. Check the licence you need with your licensing authority." },
    { id: "emirates", ...f("Can I coach subscribers") },
    { id: "aed", q: f("Do subscribers pay").q, a: "Prices are set in AED. Subscriber payments are not on yet; when they are, payments, statements and payouts are all in AED." },
    { id: "arabic", q: f("Is it available").q, a: "Member navigation and core workout, chat, nutrition, booking and account controls support English and Arabic, including right-to-left layouts. What coaches write is not translated automatically." },
    { id: "credentials", q: "Do you verify trainer credentials?", a: "No. trainsyou doesn’t verify credentials. Check the licence you need with your licensing authority, and show your qualifications on your page." },
  ];
  return {
    title: "Take your coaching online in the UAE · trainsyou",
    description: "For UAE personal trainers: take your coaching online with AED pricing, English and Arabic for followers and UAE time. Payouts and paid bookings are not on yet.",
    main: [uaeHero(), uaeLocal(), uaeAudience(), uaePrices(), uaeEmirates(), uaeLicences(), uaeArabic(),
      faqBand({ id: "ufaq-h", title: "UAE questions", faqs, prefix: "ufaq", related: ["/guides/pricing-online-coaching-uae", "/guides/uae-advertiser-permit", "/for-trainers"] })].join("\n"),
    closing: { secondary: { label: "See pricing in AED", path: "/pricing" } },
  };
}

/* ======================================================== /get-started */

function earlyAccess({ id = "early-access", heading = "Join early access", level = 2 } = {}) {
  return `<div class="early" id="${id}" data-show="registration:closed">
  <h${level} class="early-h">${esc(heading)}</h${level}>
  <p class="early-p">Sign-ups are paused. Leave your details and we’ll show it here when sign-ups reopen.</p>
  <form class="early-form" data-early novalidate>
    <div class="field"><label for="${id}-name">Your name</label><input id="${id}-name" name="name" type="text" autocomplete="name" required minlength="2"></div>
    <div class="field"><label for="${id}-email">Email address</label><input id="${id}-email" name="email" type="email" autocomplete="email" required><p class="field-err" id="${id}-email-err" hidden></p></div>
    <button class="btn btn-primary btn-block" type="submit">Join early access — free</button>
  </form>
  <div class="early-done" role="status" tabindex="-1" hidden>${icon("check")}<p><strong>You’re on the early-access list.</strong> Prototype: nothing was sent.</p></div>
</div>`;
}

function gsHero() {
  const media = `<div class="gs-claim" data-gs-claim>
  ${windowFrame(
    `<div class="gs-url" aria-hidden="true">${icon("lock")}<span class="mono"><span class="gs-slug" data-gs-slug>your-name</span><span class="gs-caret"></span>.trainsyou.com</span></div>
    <div class="gs-site" aria-hidden="true">
      <div class="gs-site-head"><span class="gs-ini" data-gs-ini>YN</span><span class="gs-name" data-gs-name>Your coaching name</span><span class="gs-join">Join</span></div>
      <div class="gs-site-hero"><span class="gs-line w80"></span><span class="gs-line w55"></span><span class="gs-pill"></span></div>
      <div class="gs-site-cards"><span></span><span></span><span></span></div>
    </div>
    <div class="gs-form">${addressPreview({ id: "gs-addr" })}</div>`,
    { title: "Your page · preview", meta: "not live until you publish", cls: "gs-window" },
  )}
  ${earlyAccess({ level: 2 })}
</div>`;
  return hero({
    kicker: "Get started",
    h1: "Start your coaching business, free",
    lede: page("/get-started").lede,
    secondary: button("/how-it-works", "See how it works", { location: "hero", size: "lg" }),
    media,
    after: `<div class="wrap"><p class="status-strip" data-show="publish:off">${icon("minus")}<span>Publishing and subscriber payments are not on yet. Setup and teaching work today.</span> <a href="#status">What works today</a></p></div>`,
    cls: "gs-hero",
  });
}

function gsSteps() {
  const steps = content.setupChecklist;
  const total = steps.reduce((a, s) => a + s.minutes, 0);
  let start = 0;
  const rows = steps.map((s, i) => {
    const from = start / total, size = s.minutes / total;
    start += s.minutes;
    const label = s.key === "brain" ? "Teach your AI" : s.label;
    const sum = s.key === "live" ? "Preview your site and app. Publish when the launch checks pass." : yourAI(s.summary);
    const extra = s.key === "live" ? flagChip("publish", "Live", "Publishing not on yet") : "";
    return `<li class="tl-row ri" style="--i:${i}">
  <span class="tl-n mono">${String(i + 1).padStart(2, "0")}</span>
  <div class="tl-text"><h3>${esc(label)}${extra}</h3><p>${esc(sum)}</p></div>
  <span class="tl-min mono">${s.minutes} min</span>
  <span class="tl-track" aria-hidden="true"><span class="tl-bar" style="--from:${from.toFixed(4)};--size:${size.toFixed(4)}"></span></span>
</li>`;
  }).join("");
  return band(
    { tone: "paper", cls: "tl-band", label: "tl-h" },
    `${sectionHead({ kicker: "Setup", title: "Six steps, about 15 minutes", id: "tl-h", layout: "split", lede: "Save and continue later. Optional work can wait; launch checks explain anything still needed." })}
<div class="tl" data-reveal>
  ${axisRow("tl-axis", ["0 min", `${total} min`])}
  <ol class="tl-rows" data-reveal="stagger">${rows}</ol>
  <p class="tl-foot"><span class="mono">≈ ${total} min</span><span class="note">Starter setup. Deeper teaching takes longer: 20 cases and passing checks turn on automatic sending.</span></p>
</div>`,
  );
}

function gsNeed() {
  const need = [
    ["Your identity", "and a short description of your coaching"],
    ["Your method", "how you coach, and the limits you keep"],
    ["An offer", "who it’s for, your AED price, length and billing"],
    ["Photos or a logo", "if you have them"],
    ["A UAE bank account", "at your first payout, not before"],
  ];
  const dont = ["A card", "A trade licence to start", "A minimum number of followers", "Coding skills", "Your own domain"];
  return band(
    { tone: "white", cls: "need-band", label: "need-h" },
    `<div class="need-grid">
  <div class="need-col" data-reveal>
    <h2 id="need-h">What you need</h2>
    <ul class="need-list">${need.map(([k, v]) => `<li>${icon("check", "need-ic")}<span><strong>${esc(k)}</strong> ${esc(v)}</span></li>`).join("")}</ul>
  </div>
  <div class="need-col need-not" data-reveal>
    <h2 id="dont-h">What you don’t need</h2>
    <ul class="need-list">${dont.map((k) => `<li>${icon("x", "need-ic")}<span>${esc(k)}</span></li>`).join("")}</ul>
  </div>
</div>`,
  );
}

function gsStatus() {
  return band(
    { tone: "paper", cls: "gs-status-band", label: "gss-h" },
    `<div class="split">
  <div class="s-copy" data-reveal><p class="kicker">Status</p><h2 id="gss-h">What works today</h2><p class="sec-lede mt-s">Everything in setup works now. Your page goes live once publishing and payments are on.</p></div>
  <div class="s-media" data-reveal>${statusPanel({ id: "status", title: "Live today / Not on yet" })}</div>
</div>`,
  );
}

function gsAfter() {
  const launch = section("/get-started", "launch").bullets;
  const after = section("/get-started", "after").bullets;
  return band(
    { tone: "white", cls: "after-band", label: "after-h" },
    `${sectionHead({ kicker: "Following go-live", title: "After you go live", id: "after-h", layout: "split", lede: "What happens once publishing is on. Until then, everything here is preview only." })}
<div class="after" data-reveal="stagger">
  <div class="after-col ri"><p class="after-k">${flagChip("publish", "Live", "Not on yet")}<span class="mono">At launch</span></p><ul class="after-list">${launch.map((b) => `<li>${esc(noDot(yourAI(b)))}</li>`).join("")}</ul></div>
  <div class="after-col ri"><p class="after-k">${flagChip("publish", "Live", "Not on yet")}<span class="mono">Week one onwards</span></p><ul class="after-list">${after.map((b) => `<li>${esc(noDot(yourAI(b.replace("the Brain", "your AI"))))}</li>`).join("")}</ul></div>
</div>`,
  );
}

function getStarted() {
  const faqs = page("/get-started").faqs.map((f, i) => ({ id: ["clients", "skills", "preview", "followers", "licence", "domain"][i], q: f.q, a: yourAI(f.a).replace("teach your Brain", "teach your AI") }));
  return {
    main: [gsHero(), gsSteps(), gsNeed(), gsStatus(), gsAfter(), faqBand({ id: "gfaq-h", title: "Before you start", faqs, prefix: "gfaq", related: ["/how-it-works", "/pricing", "/follower-calculator"] })].join("\n"),
    closing: { secondary: { label: "Try the demo", path: "/demo" } },
  };
}

/* ============================================================== /signup */

function signup() {
  const ticks = ["Free to join, no card.", "About 15 minutes to start; stop any time.", "Nothing goes live until you publish."];
  const field = ({ id, label, type = "text", ac, extra = "", hint = "", min = "" }) => `<div class="field su-field" data-field="${id}">
  <label for="su-${id}">${esc(label)}</label>
  <div class="su-input">${`<input id="su-${id}" name="${id}" type="${type}" autocomplete="${ac}"${min ? ` minlength="${min}"` : ""} required aria-describedby="su-${id}-err${hint ? ` su-${id}-hint` : ""}"${extra}>`}${type === "password" ? `<button type="button" class="su-show" data-pw-toggle aria-pressed="false" aria-controls="su-${id}">Show</button>` : ""}</div>
  ${hint}
  <p class="field-err" id="su-${id}-err" hidden></p>
</div>`;
  const pwHint = `<p class="su-pw" id="su-password-hint" data-pw-hint><span class="su-pw-ic" aria-hidden="true">${icon("check")}</span><span>At least 12 characters</span><span class="mono su-pw-n" aria-hidden="true">${vx("0", 2, { cls: "vx-end" })}/12</span></p>`;
  const card = `<section class="su-card" aria-labelledby="su-card-h">
  <h2 id="su-card-h">Create your trainer account</h2>
  <div data-show="registration:open">
    <div class="su-form-wrap" data-signup-form>
      <div class="su-carried">
        <p class="su-chip" data-slug-chip hidden>${icon("lock")}<span><span class="mono" data-slug-text>your-name</span><span class="mono">.trainsyou.com</span> — we’ll check it’s free in setup</span></p>
        <p class="su-chip su-price" data-price-chip hidden><span>Your price: <span class="mono" data-price-text>AED 199</span></span>${pendingTag("decision 8")}</p>
      </div>
      <div class="su-alert" role="alert" data-su-alert hidden></div>
      <form class="su-form" data-signup novalidate>
        ${field({ id: "name", label: "Your name", ac: "name", min: "2" })}
        ${field({ id: "email", label: "Email address", type: "email", ac: "email", extra: ' inputmode="email" autocapitalize="none" spellcheck="false"' })}
        ${field({ id: "password", label: "Password", type: "password", ac: "new-password", min: "12", hint: pwHint, extra: " data-pw" })}
        <div class="su-legal" data-field="terms">
          <label class="su-check"><input type="checkbox" name="terms" id="su-terms" required aria-describedby="su-terms-err"><span>I accept the ${link("/terms", "Terms of Service", { attrs: 'target="_blank" rel="noopener"' })}, ${link("/privacy", "Privacy Policy", { attrs: 'target="_blank" rel="noopener"' })} and ${link("/ai-disclosure", "AI Disclosure", { attrs: 'target="_blank" rel="noopener"' })}.</span></label>
          <p class="field-err" id="su-terms-err" hidden></p>
        </div>
        <div class="su-hidden" data-attr-fields></div>
        <button class="btn btn-primary btn-lg btn-block su-submit" type="submit"><span class="swap"><span class="su-go">Start my setup</span><span class="su-busy" aria-hidden="true">Opening your setup…</span></span>${icon("arrow", "btn-arrow")}</button>
      </form>
    </div>
    <div class="su-done" data-signup-done role="status" tabindex="-1" hidden>
      <span class="su-done-ic" aria-hidden="true">${icon("check")}</span>
      <h3>Account created</h3>
      <p>Prototype: nothing was sent. In the product, your setup opens here at step 2 of 6, <strong>About you</strong>.</p>
      <dl class="su-sum" data-su-sum></dl>
      <p class="note">Nothing goes live until you publish.</p>
      <div class="su-done-acts"><a class="btn btn-secondary" href="${href("/how-it-works")}">See what setup covers</a><button type="button" class="btn btn-ghost" data-su-reset>Start again</button></div>
    </div>
  </div>
  ${earlyAccess({ id: "su-early", heading: "Sign-up opens soon", level: 3 })}
  <p class="su-signin">Already have a coaching space? <a href="${href("/login")}">Sign in</a></p>
  <p class="su-pending">${pendingTag("Sign-up copy: owner decision 8")}</p>
</section>`;
  const echo = `<div class="su-echo" aria-label="Sample rule">
  <div class="rule-chip"><span class="rule-src">Your rule · from interview, 12 Oct</span><code class="rule-text mono">2 easy sessions → +2.5 kg</code></div>
  <p class="su-echo-cap">${sampleLabel("Sample · what you’ll teach first")}</p>
</div>`;
  return {
    main: `<section class="band band-white su-band" data-hero aria-labelledby="hero-h">
  <div class="wrap su-grid">
    <div class="su-head">
      <p class="kicker">Sign up</p>
      <h1 id="hero-h">Teach your AI. Start free.</h1>
      <ul class="su-ticks">${ticks.map((t) => `<li>${icon("check")}<span>${esc(t)}</span></li>`).join("")}</ul>
    </div>
    ${card}
    <div class="su-story">${echo}</div>
  </div>
</section>`,
    closing: false,
    bodyClass: "page-auth",
  };
}

/* =============================================================== /login */

function login() {
  return {
    main: `<section class="band band-paper li-band" data-hero aria-labelledby="hero-h">
  <div class="wrap">
    <div class="li-card">
      <h1 id="hero-h">Sign in</h1>
      <p class="li-intro">Welcome back. Sign in with the email address you use for coaching.</p>
      <div class="su-alert" role="alert" data-li-alert hidden></div>
      <form class="li-form" data-login novalidate>
        <div class="field"><label for="li-email">Email address</label><input id="li-email" name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck="false" enterkeyhint="next" required></div>
        <div class="field"><label for="li-password">Password</label><input id="li-password" name="password" type="password" autocomplete="current-password" enterkeyhint="go" required></div>
        <p class="li-forgot"><button type="button" class="li-link" data-proto-note="Password reset isn’t part of this prototype.">Forgot your password?</button></p>
        <button class="btn btn-primary btn-lg btn-block" type="submit">Sign in${icon("arrow", "btn-arrow")}</button>
      </form>
      <div class="li-alt" role="group" aria-label="Other ways to sign in">
        <button type="button" class="btn btn-secondary btn-block" data-proto-note="Sign-in links aren’t sent from this prototype.">Email me a sign-in link</button>
        <button type="button" class="li-link" data-proto-note="Recovery codes aren’t part of this prototype.">Lost your authenticator app? Use a recovery code</button>
      </div>
      <p class="li-note" role="status" data-li-note hidden></p>
      <div class="li-new">
        <p>Looking for a coach? <a href="${href("/coaches")}">Find a coach</a></p>
        <p data-show="registration:open">Are you a coach? <a href="${href("/signup")}" data-cta="link" data-loc="login">Create your coaching space</a></p>
      </div>
    </div>
  </div>
</section>`,
    closing: false,
    bodyClass: "page-auth",
  };
}

/* ======================================================= copy budgets */
// Build-time check of the C0 word budgets on this group's pages (warns; never blocks a build).
const words = (s) => s.replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/g, "x").trim().split(/\s+/).filter(Boolean).length;
function checkBudgets(path, html) {
  const out = [];
  const each = (re, max, what) => { for (const m of html.matchAll(re)) { const n = words(m[1]); if (n > max) out.push(`${what} ${n}>${max}: ${m[1].replace(/<[^>]+>/g, "").slice(0, 60)}`); } };
  each(/<h1[^>]*>([\s\S]*?)<\/h1>/g, 8, "H1");
  each(/<h2[^>]*>([\s\S]*?)<\/h2>/g, 6, "H2");
  each(/<p class="(?:lede|sec-lede[^"]*)">([\s\S]*?)<\/p>/g, 25, "lede");
  each(/<p class="(?:rcard-b|route-b|ft-tile-sub)">([\s\S]*?)<\/p>/g, 18, "card");
  each(/<div class="faq-a"[^>]*><div><p[^>]*>([\s\S]*?)<\/p>/g, 45, "FAQ");
  if ((html.match(/<h1[\s>]/g) || []).length !== 1) out.push("H1 count != 1");
  if (/the AI|an AI/.test(html.replace(/<p[^>]*>[\s\S]*?<\/p>/g, ""))) out.push("'the AI' / 'an AI' outside body text");
  for (const o of out) console.warn(`[audience copy] ${path}: ${o}`);
}
const checked = (path, render) => (ctx) => {
  const r = render(ctx);
  checkBudgets(path, r.main);
  return r;
};

export const pages = {
  "/for-trainers": checked("/for-trainers", forTrainers),
  "/for-trainers/weight-loss": checked("/for-trainers/weight-loss", specialty("/for-trainers/weight-loss")),
  "/for-trainers/strength": checked("/for-trainers/strength", specialty("/for-trainers/strength")),
  "/for-trainers/muscle-gain": checked("/for-trainers/muscle-gain", specialty("/for-trainers/muscle-gain")),
  "/for-trainers/pre-postnatal": checked("/for-trainers/pre-postnatal", specialty("/for-trainers/pre-postnatal")),
  "/uae": checked("/uae", uae),
  "/get-started": checked("/get-started", getStarted),
  "/signup": checked("/signup", signup),
  "/login": checked("/login", login),
};
