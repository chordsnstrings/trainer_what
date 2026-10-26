// Page group "product": /how-it-works, /trainer-brain, /features, /features/* (11), /demo, /security-and-privacy.
// Copy: blueprint C2-C7 first (pending owner approval), content.json for the rest, passed
// through the C0 vocabulary rules (tx). Styles: assets/product.css. Behaviour: assets/product.js.
//
// Signature components on these pages:
//   /how-it-works   the 8-state stepper console (hwStepper)
//   /trainer-brain  the rule ledger with Confirm / Edit / Reject, release rollback, Compare my replies
//   /features       live bento mini-screens, product screen tabs, the 91-capability matrix
//   /features/*     one vignette per page with one state change (VIGNETTES)
//   /demo           four scenario consoles, rule builder (rir) and threshold meter
//   /security       the operator access log and the isolation diagram
import { createRequire } from "node:module";
import { content } from "./registry.mjs";
import {
  esc, icon, cta, ctaMicro, button, textLink, band, sectionHead, h1WithMark, chip, flagChip, offeringChip, notOnYet,
  sampleLabel, pendingTag, constraintList, faqList, withFrontier, frontierBullets, frontierBody, vx, swapPair,
  lanePill, phoneFrame, windowFrame, appHead, decisionConsole, ruleBuilder, thresholdSlider, kamranPill, dataTable,
  statementLines, relatedLinks, href,
} from "./components.mjs";

const calc = createRequire(import.meta.url)("../site/assets/calc.js");

/* ================================================================ shared */

const P = (path) => content.pages.find((p) => p.path === path);
const S = (page, id) => (page.sections || []).find((s) => s.id === id);

/** C0 vocabulary: grade-6 terms, "your AI" over "the Brain", "Not on yet" over "Available soon". */
const VOCAB = [
  [/held-out scenarios/g, "your test cases"],
  [/held-out situations/g, "test cases"],
  [/[“"]Available soon[”"]/g, "“Not on yet”"],
  [/Available soon/g, "Not on yet"],
  [/confidence threshold/g, "how sure it must be"],
  [/marginal bands of/g, "bands of"],
  [/\b[Yy]our Trainer Brain\b/g, (m) => (m[0] === "Y" ? "Your AI" : "your AI")],
  [/\bThe Brain\b/g, "Your AI"],
  [/\bthe Brain\b/g, "your AI"],
  [/\bYour Brain\b/g, "Your AI"],
  [/\byour Brain\b/g, "your AI"],
  [/\bmy Brain\b/g, "my AI"],
  [/\bthe floor\b/g, "the safety rules"],
];
const tx = (s) => VOCAB.reduce((t, [a, b]) => t.replace(a, b), String(s ?? ""));

/** Word budgets from C0. Over-budget copy is reported at build time. */
const LIMIT = { h1: 8, h2: 6, lede: 25, card: 18, faq: 45 };
const words = (s) => String(s).replace(/<[^>]+>/g, " ").trim().split(/\s+/).filter(Boolean).length;
function budget(kind, text, where = "") {
  const n = words(text);
  if (n > LIMIT[kind]) console.warn(`[product] ${kind} over budget (${n}/${LIMIT[kind]})${where ? " " + where : ""}: ${text}`);
  return text;
}

/** FAQ entries from content with the vocabulary applied; `rename` maps old question -> new question. */
function faqsOf(path, rename = {}, extra = []) {
  const list = withFrontier(P(path).faqs, path).map((f) => ({
    ...f,
    q: rename[f.q] ?? tx(f.q),
    a: tx(f.a),
    ...(f.aFrontier ? { aFrontier: tx(f.aFrontier) } : {}),
  }));
  return [...list, ...extra];
}
const OVERRIDE_A = {
  // Trimmed to the 45-word FAQ budget; meaning unchanged.
  "Is my AI trained on my data?": "It is taught with your material: confirmed rules, coaching cases, examples and corrections. Each version is tested on your test cases and can be rolled back. We do not claim to fine-tune a separate model on you, and your teaching stays private to your workspace.",
};
const fixA = (faqs) => faqs.map((f) => (OVERRIDE_A[f.q] ? { ...f, a: OVERRIDE_A[f.q] } : f));

/** Page hero: copy left (5 cols), product right (7 cols). Never carries data-reveal. */
function hero({ kicker, h1, mark = "", lede, media, secondary, chips = "", after = "", cls = "" }) {
  budget("h1", h1, "H1");
  budget("lede", lede, "lede");
  return `<section class="band band-white hero${cls ? " " + cls : ""}" data-hero aria-labelledby="hero-h">
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <p class="kicker">${esc(kicker)}</p>
      ${mark ? h1WithMark(h1, mark, { id: "hero-h" }) : `<h1 id="hero-h">${esc(h1)}</h1>`}
      ${chips ? `<div class="hero-chips">${chips}</div>` : ""}
      <p class="lede">${esc(lede)}</p>
      <div class="cta-row hero-ctas">${cta({ location: "hero", size: "lg" })}${secondary ? button(secondary[0], secondary[1], { location: "hero", size: "lg" }) : ""}</div>
      ${ctaMicro()}
      ${after}
    </div>
    <div class="hero-media">${media}</div>
  </div>
</section>`;
}

/** H2 with budget check. */
const h2 = (id, text, cls = "") => `<h2 id="${id}"${cls ? ` class="${cls}"` : ""}>${esc(budget("h2", text, "H2"))}</h2>`;

/** FAQ band: heading + links left, accordion right; Kamran inline on phones. */
function faqBand({ id = "faq", title = "Questions trainers ask", faqs, prefix = "pfq", related = [], tone = "white" }) {
  faqs.forEach((f) => { budget("faq", f.a, `FAQ "${f.q}"`); if (f.aFrontier) budget("faq", f.aFrontier, `FAQ (frontier) "${f.q}"`); });
  return band(
    { tone, cls: "faq-band pfaq", label: `${id}-h` },
    `<div class="split pfaq-split">
  <div class="s-copy" data-reveal>
    ${h2(`${id}-h`, title)}
    <p class="mt-s">${textLink("/faq", "All questions")}</p>
    ${related.length ? `<div class="pfaq-related">${relatedLinks(related, { title: "Related" })}</div>` : ""}
    <div class="kamran-inline-m">${kamranPill()}</div>
  </div>
  <div class="s-media" data-reveal>${faqList(faqs, { prefix })}</div>
</div>`,
  );
}

/* --------------------------------------------- mini product-UI vocabulary */
// Decorative product screens live inside devices that are aria-hidden or role="img";
// the meaning is always carried by real text beside them.
const ui = {
  h: (t, sub = "") => `<div class="ui-h"><p class="ui-title">${esc(t)}</p>${sub ? `<p class="ui-sub mono">${esc(sub)}</p>` : ""}</div>`,
  row: (k, v = "", { cls = "", raw = false } = {}) =>
    `<div class="ui-row${cls ? " " + cls : ""}"><span class="ui-k">${raw ? k : esc(k)}</span>${v !== "" ? `<span class="ui-v">${raw ? v : esc(v)}</span>` : ""}</div>`,
  btn: (t, v = "") => `<span class="ui-btn${v ? " ui-btn-" + v : ""}">${esc(t)}</span>`,
  btns: (...b) => `<div class="ui-btns">${b.join("")}</div>`,
  note: (t, ic = "check", cls = "") => `<p class="ui-note${cls ? " " + cls : ""}">${icon(ic)}<span>${esc(t)}</span></p>`,
  tog: (label, on, sub = "") => `<div class="ui-row ui-togrow"><span class="ui-k">${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ""}</span><span class="ui-tog${on ? " is-on" : ""}" aria-hidden="true"></span></div>`,
  label: (t) => `<p class="ui-label">${esc(t)}</p>`,
  input: (v, affix = "") => `<div class="ui-input"><span class="mono">${esc(v)}</span>${affix ? `<span class="ui-affix mono">${esc(affix)}</span>` : ""}</div>`,
  tabs: (on, list = ["Today", "Plan", "Chat", "Progress"]) => `<div class="app-tabs" aria-hidden="true">${list.map((t) => `<span${t === on ? ' class="is-on"' : ""}>${esc(t)}</span>`).join("")}</div>`,
  bar: (v, cls = "") => `<span class="ui-bar${cls ? " " + cls : ""}" style="--v:${v}"><span></span></span>`,
  url: (u) => `<div class="ui-url">${icon("lock")}<span class="mono">${esc(u)}</span></div>`,
};
const TICK = `<svg class="tick" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" pathLength="20"/></svg>`;
const SLUG = "layla-strength";
const DOMAIN = `${SLUG}.trainsyou.com`;

/** A stage behind a product object: the 24px dot grid, framed. */
const stage = (inner, cls = "") => `<div class="p-stage dots${cls ? " " + cls : ""}">${inner}</div>`;

/** Sample statement: 150 paying subscribers at AED 199 (same arithmetic as /pricing). */
function sampleStatement({ head = true } = {}) {
  const e = calc.compactEarnings(150, 199, 250);
  const lines = [
    { label: "150 subscribers × AED 199", value: calc.aed(e.subscriptionMonthlyMinor) },
    { label: "Our share · 1–100 at 25%", value: "− " + calc.aed(e.bands[0].commissionMinor), tone: "minus" },
    { label: "Our share · 101–150 at 20%", value: "− " + calc.aed(e.bands[1].commissionMinor), tone: "minus" },
    { label: "Card processing", value: "Itemised", tone: "muted" },
    { label: "Before processing", value: calc.aed(e.subscriptionMonthlyMinor - e.commissionMinor), tone: "total" },
  ];
  return `${head ? `<div class="stmt-head">${chip("Sample", "sample")}${notOnYet("payments", "subscriber payments")}</div>` : ""}${statementLines(lines)}`;
}

/* ======================================================== HOW IT WORKS */

/** The 8 states of the stepper console: [window screen, phone screen]. */
function hwScreens() {
  const setup = content.setupChecklist;
  const ledgerRow = (rule, src, status, tone) =>
    `<li class="ui-rule"><code class="mono">${esc(rule)}</code><span class="ui-rule-meta"><span class="rule-src mono">${esc(src)}</span>${status ? chip(status, tone) : ""}</span></li>`;
  return [
    // 1 · Claim your address
    [
      `${ui.h("Setup · Your page", "Step 3 of 6")}
      <div class="hw-setup">
        <ol class="hw-check">${setup.map((s, i) => `<li class="${i < 2 ? "is-done" : i === 2 ? "is-cur" : ""}">${i < 2 ? icon("check") : `<span class="hw-dot"></span>`}<span>${esc(s.label.replace("Brain", "AI"))}</span><span class="mono">${s.minutes} min</span></li>`).join("")}</ol>
        <div class="hw-form">
          ${ui.label("Your address")}
          ${ui.input(SLUG, ".trainsyou.com")}
          ${ui.note("Reserved for you", "check", "is-ok")}
          ${ui.row("Coaching name", "Layla Strength")}
          ${ui.row("Colours", `<span class="ui-sw" style="background:#D5F24A"></span><span class="ui-sw" style="background:#171917"></span>`, { raw: true })}
        </div>
      </div>`,
      `${ui.url(DOMAIN)}
      <div class="ui pv">
        <span class="pv-logo" aria-hidden="true">LS</span>
        <p class="ui-kick">Strength coaching</p>
        <p class="pv-h">Train with Layla, day by day</p>
        <p class="ui-sub">A plan in my method, adjusted as you train.</p>
        ${ui.btn("See coaching")}
      </div>
      <div class="ui pv-foot">${chip("Preview", "sample")}<span class="mono">Not published</span></div>`,
    ],
    // 2 · Teach your AI
    [
      `${ui.h("Your AI · Rules", "Quiz 5 of 8")}
      <ul class="ui-rules">
        <li class="ui-rule is-focus"><code class="mono">2 easy sessions at 3+ RIR → +2.5 kg</code><span class="ui-rule-meta"><span class="rule-src mono">Interview · 12 Oct</span>${ui.btn("Confirm")}${ui.btn("Edit", "ghost")}</span></li>
        ${ledgerRow("Missed session → next free day", "Quiz · Q4", "Confirmed", "applied")}
        ${ledgerRow("No equipment match → hand to me", "Case 2", "Confirmed", "applied")}
        ${ledgerRow("Deload every 4th week", "notes.pdf · reviewed", "Flagged", "toyou")}
      </ul>`,
      `<div class="ui">
        ${ui.h("Practice quiz", "Question 6 of 8")}
        <p class="ui-q">A client says squats felt easy two sessions running. What do you change?</p>
        <div class="ui-answer">Add 2.5 kg next session, if every set was done with 3 or more reps in reserve.</div>
        ${ui.bar(0.75)}
        ${ui.btns(ui.btn("Save answer"))}
      </div>`,
    ],
    // 3 · Test it
    [
      `${ui.h("Your AI · Test cases", "Waits for me")}
      <div class="ui-table">
        <div class="ui-tr ui-th"><span>Case</span><span>Expected</span><span>Your AI</span><span></span></div>
        <div class="ui-tr"><span>Squats easy, 3 RIR</span><span class="mono">+2.5 kg</span><span class="mono">+2.5 kg</span>${icon("check")}</div>
        <div class="ui-tr"><span>Missed Tuesday</span><span class="mono">Move to Thu</span><span class="mono">Move to Thu</span>${icon("check")}</div>
        <div class="ui-tr"><span>Knee pain</span><span class="mono">Pause</span><span class="mono">Pause</span>${icon("check")}</div>
      </div>
      <div class="hw-gates">${ui.row("Quiz answers", "8 of 8")}${ui.row("Your own cases", "3 of 3")}${ui.row("Automatic sending", "20 cases + checks", { cls: "is-locked" })}</div>`,
      `<div class="ui">
        ${ui.h("Sending mode")}
        ${ui.tog("Waits for me", true, "Every reply comes to you first")}
        ${ui.tog("Automatic for routine changes", false, "Needs 20 cases and passing checks")}
        <div class="hw-meter"><p><span>Cases</span><span class="mono">3 of 20</span></p>${ui.bar(0.15)}</div>
        ${ui.note("Supervised start is ready")}
      </div>`,
    ],
    // 4 · Create your offer
    [
      `${ui.h("Offer · Workout plan", "Draft")}
      <div class="hw-offer">
        <div>${ui.label("Monthly price")}${ui.input("199", "AED")}</div>
        <div>${ui.label("Billing")}<div class="ui-seg"><span class="is-on">Monthly</span><span>Upfront</span></div></div>
      </div>
      ${ui.row("Free trial", "Optional")}
      ${ui.row("Nutrition tier", "Add when ready")}
      ${ui.row("Voice add-on", "Not on yet")}
      <p class="hw-chiprow">${notOnYet("payments", "subscriber payments")}</p>`,
      `${appHead()}
      <div class="ui pv-offer">
        <p class="ui-kick">Workout plan</p>
        <p class="pv-price"><span class="mono">AED 199</span><small>a month</small></p>
        <ul class="ui-list">${["A dated plan, day by day", "Guided workouts, offline too", "Chat with Layla"].map((t) => `<li>${icon("check")}${esc(t)}</li>`).join("")}</ul>
        ${ui.btn("Join")}
        <p class="ui-sub mono">Preview · payments not on yet</p>
      </div>`,
    ],
    // 5 · Publish and share (not on yet)
    [
      `${ui.h("Launch checks", "Publishing: not on yet")}
      <ul class="hw-launch">
        <li>${icon("check")}<span>Subscriber preview checked</span></li>
        <li>${icon("check")}<span>Your AI tested on your cases</span></li>
        <li>${icon("check")}<span>Offer ready</span></li>
        <li class="is-wait">${icon("minus")}<span>Subscriber payments</span>${flagChip("payments", "Live", "Not on yet")}</li>
      </ul>
      ${ui.btns(ui.btn("Publish", "off"), ui.btn("Preview", "ghost"))}
      <p class="ui-sub mono">Publishing waits for payments</p>`,
      `<div class="ui">
        ${ui.h("Share your link", "Tagged, so you see what works")}
        <div class="hw-link"><span class="mono">${DOMAIN}/?ref=bio</span>${ui.btn("Copy", "ghost")}</div>
        <div class="hw-link"><span class="mono">${DOMAIN}/?ref=story</span>${ui.btn("Copy", "ghost")}</div>
        <p class="hw-chiprow">${flagChip("publish", "Live", "Not on yet")}</p>
      </div>`,
    ],
    // 6 · It coaches daily
    [
      `${ui.h("Inbox", "Today")}
      <ul class="hw-inbox">
        <li>${lanePill("Applied automatically", "applied")}<span class="mono">Squat 60 → 62.5 kg</span></li>
        <li>${lanePill("Rescheduled", "applied")}<span class="mono">Lower body B → Thu</span></li>
        <li>${lanePill("Handed to you", "toyou")}<span class="mono">Hotel gym, 2 weeks</span></li>
        <li>${lanePill("Paused, to you", "paused")}<span class="mono">Knee hurts</span></li>
      </ul>`,
      `${appHead()}
      <div class="ui">
        <p class="ui-sub mono">Week 3 · Day 2</p>
        <p class="ui-title ui-title-l">Lower body A</p>
        <ul class="ui-plan">
          <li><span>Back squat</span><span class="mono">4 × 6 · 62.5 kg</span></li>
          <li><span>Romanian deadlift</span><span class="mono">3 × 8 · 50 kg</span></li>
          <li><span>Walking lunge</span><span class="mono">3 × 10</span></li>
        </ul>
        ${ui.btn("Start guided session")}
        ${ui.note("Squat increased: two easy sessions in a row.")}
      </div>
      ${ui.tabs("Today")}`,
    ],
    // 7 · You correct, it learns
    [
      `${ui.h("Inbox · Draft for you", "Below your bar")}
      <div class="hw-draft">
        <p class="ui-k">“Travelling two weeks, hotel gym only.”</p>
        <p class="hw-draft-plan"><span class="rule-src mono">Draft</span>Dumbbells to 20 kg, same split</p>
        ${ui.btns(ui.btn("Approve", "ghost"), ui.btn("Correct"))}
      </div>
      <div class="hw-learn">
        <span class="rule-src mono">Suggested rule · from your correction</span>
        <code class="mono">hotel gym → dumbbell plan, keep the split</code>
        ${ui.btns(ui.btn("Confirm"), ui.btn("Edit", "ghost"))}
      </div>
      <p class="ui-sub mono">Next release checked against your test cases</p>`,
      `${appHead()}
      <div class="app-chat">
        <p class="bubble bubble-out">Travelling two weeks, hotel gym only. Can you rebuild my plan?</p>
        <p class="bubble bubble-in">Layla will answer this personally. You will see the reply here.</p>
      </div>
      ${ui.tabs("Chat")}`,
    ],
    // 8 · Get paid monthly (not on yet)
    [
      `${ui.h("Statement · sample month", "AED")}${sampleStatement()}`,
      `<div class="ui">
        ${ui.h("Payouts", "Monthly")}
        ${ui.row("To", "Verified UAE bank")}
        ${ui.row("Statement", "Itemised")}
        ${ui.row("After a bank change", "Short hold")}
        <p class="hw-chiprow">${chip("Sample", "sample")}${flagChip("payments", "Live", "Not on yet")}</p>
      </div>`,
    ],
  ];
}

function hwStepper() {
  const page = P("/how-it-works");
  const steps = S(page, "steps").steps.map((s, i) => {
    const title = i === 1 ? "Teach your AI" : s.title;
    let body = esc(tx(s.body));
    if (i === 6) body = frontierBody("/how-it-works", "steps", s.title, tx(s.body));
    if (i === 7) body = esc("Subscribers pay in AED and payouts reach your UAE bank. Your statement itemises costs.");
    const chipHtml = i === 4 ? flagChip("publish", "Live", "Not on yet") : i === 7 ? flagChip("payments", "Live", "Not on yet") : "";
    return { title, body, chipHtml };
  });
  const screens = hwScreens();
  const n = steps.length;
  const pad = (i) => String(i + 1).padStart(2, "0");
  // No viewBox: user units are CSS px, so pathLength-based dashes stay exact at any size.
  const line = (cls, x1, y1, x2, y2) =>
    `<svg class="hw-line ${cls}" aria-hidden="true" focusable="false"><line class="hw-line-bg" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/><line class="hw-line-fg" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" pathLength="${n - 1}"/></svg>`;
  const tabs = steps
    .map((s, i) => `<button type="button" role="tab" id="hw-t${i}" aria-controls="hw-p${i}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}"><span class="hw-node" aria-hidden="true"></span><span class="hw-n mono">${pad(i)}</span><span class="hw-t">${esc(s.title)}</span>${s.chipHtml ? `<span class="hw-tc">${s.chipHtml}</span>` : ""}</button>`)
    .join("");
  const panels = steps
    .map((s, i) => `<div class="hw-panel" role="tabpanel" id="hw-p${i}" aria-labelledby="hw-t${i}" tabindex="0"${i ? " hidden" : ""}>
  <p class="hw-count mono"><span aria-hidden="true">${pad(i)}/${String(n).padStart(2, "0")}</span><span class="sr-only">Step ${i + 1} of ${n}</span></p>
  <h3>${esc(s.title)} ${s.chipHtml}</h3>
  <p>${s.body}</p>
</div>`)
    .join("");
  const layers = (k) => screens.map((sc, i) => `<div class="hw-l${i === 0 ? " is-on" : ""}" data-i="${i}">${sc[k]}</div>`).join("");
  return `<div class="hw" id="hw" data-tabs data-hw style="--n:${n};--k:0">
  <div class="hw-rail" role="tablist" aria-label="From setup to daily coaching, ${n} steps">
    ${line("hw-line-v", 1, 0, 1, "100%")}${tabs}
  </div>
  ${line("hw-line-h", 0, 1, "100%", 1)}
  <div class="hw-main">
    <div class="hw-stage dots" aria-hidden="true">
      <div class="device window hw-win"><div class="window-screen"><div class="window-bar"><span class="window-title">Your workspace</span><span class="window-meta mono">Sample</span></div><div class="window-body hw-layers">${layers(0)}</div></div></div>
      ${phoneFrame(`<div class="hw-layers">${layers(1)}</div>`, { cls: "hw-phone" })}
    </div>
    <div class="hw-copy">
      ${panels}
      <div class="hw-nav"><button type="button" class="btn btn-ghost btn-sm" data-walk-step="-1">Previous</button><button type="button" class="btn btn-secondary btn-sm" data-walk-step="1">Next step</button></div>
    </div>
  </div>
</div>
<p class="hw-cap">${sampleLabel("Sample trainer · screens simplified")}</p>`;
}

/** Hero figure: the loop in one row: you teach → your AI decides → your subscriber trains. */
function hwLoop() {
  return `<figure class="loop" data-vignette data-state="start" aria-labelledby="loop-cap">
  ${stage(`<ol class="loop-row">
    <li class="loop-node">
      <p class="loop-k">You</p>
      <div class="rule-chip"><span class="rule-src">Your rule · confirmed</span><code class="rule-text mono">2 easy sessions → +2.5 kg</code></div>
    </li>
    <li class="loop-node loop-ai">
      <p class="loop-k">Your AI</p>
      <div class="loop-card">
        <p class="loop-conf"><span>How sure</span><span class="mono">86%</span></p>
        <div class="conf-track"><span class="conf-fill" style="--c:.86"></span><span class="conf-mark" style="--t:.8" aria-hidden="true"></span></div>
        ${lanePill("Checking your rule", "applied", { to: "Applied automatically" })}
      </div>
    </li>
    <li class="loop-node">
      <p class="loop-k">Your subscriber</p>
      <div class="loop-card loop-plan"><span>Mon · Squat</span><span class="mono">${swapPair("60 kg", "62.5 kg")}</span>${TICK}</div>
    </li>
  </ol>
  <p class="loop-back">${icon("arrow")}<span><strong>Unsure?</strong> It comes back to you. <strong>Pain?</strong> Paused, to you.</span></p>`, "loop-stage")}
  <figcaption id="loop-cap" class="loop-cap">${sampleLabel("Sample trainer · scripted · no AI model called")}<button type="button" class="cap-replay" data-vreplay>${icon("replay")}<span>Replay</span></button></figcaption>
</figure>`;
}

function hwLanes() {
  const t = S(P("/how-it-works"), "lanes").table;
  const cols = ["You", "Your AI", "Your subscriber"];
  const tone = ["you", "ai", "sub"];
  const rows = t.rows.map((r) => r.map((c) => tx(c).replace("below your how sure it must be", "below how sure it must be")));
  rows[2][1] = "Hands you anything below how sure it must be";
  return band(
    { tone: "white", cls: "lanes-band", label: "lanes-h" },
    `${sectionHead({ kicker: "Roles", title: budget("h2", tx(S(P("/how-it-works"), "lanes").heading)), id: "lanes-h", layout: "split", lede: "Once you’re live, three parties each do one job. Safety always comes back to you." })}
<div class="lanes-wrap" data-reveal>
<table class="lanes">
  <caption class="sr-only">${esc(t.caption)}</caption>
  <thead><tr>${cols.map((c, i) => `<th scope="col" class="ln-${tone[i]}"><span class="ln-dot" aria-hidden="true"></span>${esc(c)}</th>`).join("")}</tr></thead>
  <tbody>${rows.map((r, ri) => `<tr>${r.map((c, i) => `<td data-label="${esc(cols[i])}" class="ln-${tone[i]}${ri === 3 && i === 1 ? " ln-safety" : ""}"><span class="ln-n mono" aria-hidden="true">${String(ri + 1).padStart(2, "0")}</span>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody>
</table>
</div>`,
  );
}

function hwTime() {
  const list = content.setupChecklist;
  const total = list.reduce((s, x) => s + x.minutes, 0);
  return band(
    { tone: "paper", cls: "time-band", label: "time-h" },
    `<div class="split time-split">
  <div class="s-copy" data-reveal>
    <p class="kicker">Time to start</p>
    ${h2("time-h", `About ${total} minutes to start`)}
    <p class="sec-lede mt-s">Six guided steps. You can start teaching before your business details are complete.</p>
  </div>
  <div class="s-media" data-reveal>
    <div class="tl" style="--total:${total}">
      <div class="tl-bar" aria-hidden="true">${list.map((s, i) => `<span class="tl-seg" style="--w:${s.minutes};--i:${i}"><span class="tl-fill"></span></span>`).join("")}</div>
      <ol class="tl-list">${list.map((s, i) => `<li><span class="tl-min mono">${s.minutes} min</span><span class="tl-step"><strong>${esc(s.label.replace("Brain", "AI"))}</strong> ${i === list.length - 1 ? flagChip("publish", "Live", "Not on yet") : ""}<small>${esc(s.summary)}</small></span></li>`).join("")}</ol>
      <p class="tl-total"><span>Total</span><span class="mono">≈ ${total} min</span></p>
    </div>
  </div>
</div>`,
  );
}

function hwControl() {
  const items = [
    { t: "Inspect every rule", d: "Each one shows where it came from.", ui: `<div class="rule-chip"><span class="rule-src">Interview · 12 Oct</span><code class="rule-text mono">2 easy sessions → +2.5 kg</code></div>` },
    { t: "Roll back a release", d: "Return to an earlier version at any time.", ui: `<div class="ctl-rel mono"><span class="is-live">v4</span>${icon("arrow")}<span>v3</span><span class="ui-btn ui-btn-ghost">Roll back</span></div>` },
    { t: "Take over any conversation", d: "The digital coach steps back for that subscriber.", ui: `<div class="ctl-take"><span class="ui-btn">Take over</span><span class="mono">Digital coach paused</span></div>` },
    { t: "Write programmes yourself", d: "Templates and the exercise library, whenever you want.", ui: `<div class="ctl-prog mono"><span>Week 1</span><span>Week 2</span><span class="is-on">Week 3</span><span>Week 4</span></div>` },
  ];
  return band(
    { tone: "white", cls: "ctl-band", label: "ctl-h" },
    `${sectionHead({ kicker: "Control", title: tx(S(P("/how-it-works"), "control").heading), id: "ctl-h", layout: "split", lede: "Subscribers always see when guidance is digital." })}
<ul class="ctl-grid" data-reveal="stagger">${items.map((x) => `<li class="ctl ri"><div class="ctl-ui" aria-hidden="true">${x.ui}</div><h3>${esc(x.t)}</h3><p>${esc(budget("card", x.d))}</p></li>`).join("")}</ul>
<p class="frontier-line" data-show="frontier:on">${icon("check")}<span>A frontier model plus your corrections: it keeps getting better with time.</span></p>`,
  );
}

function howItWorks() {
  const page = P("/how-it-works");
  const faqs = fixA(faqsOf("/how-it-works", {
    "What does the Brain do when it is not sure?": "What does my AI do when it’s not sure?",
    "Is the AI trained on my data?": "Is my AI trained on my data?",
  }));
  return {
    main: [
      hero({
        kicker: "How it works",
        h1: "From your method to daily coaching",
        lede: "Teach it your method, test it, then publish. It coaches every subscriber daily and hands you what it’s unsure about.",
        media: hwLoop(),
        secondary: ["/demo", "Try the demo"],
      }),
      band(
        { tone: "paper", id: "steps", cls: "hw-band", label: "steps-h" },
        `${sectionHead({ kicker: "8 steps", title: tx(S(page, "steps").heading), id: "steps-h", layout: "split", lede: "Step through it. Each step shows the screen you’ll use and what your subscriber sees." })}
<div data-reveal>${hwStepper()}</div>`,
      ),
      hwLanes(),
      hwTime(),
      hwControl(),
      faqBand({ id: "hfaq", title: "Before you start", faqs, prefix: "hwq", related: ["/trainer-brain", "/demo", "/pricing"], tone: "paper" }),
    ].join("\n"),
    closing: { secondary: { label: "Try the demo", path: "/demo" } },
  };
}

/* ======================================================= TRAINER BRAIN */

const RULE_TEXT = "After two sessions at 3+ reps in reserve, add 2.5 kg";

function tbLedger() {
  const rows = [
    ["Missed session → next free day, never stack", "Quiz · Q4", chip("Confirmed", "applied")],
    ["No equipment match → hand to me", "Case 2", chip("Confirmed", "applied")],
    ["Deload every 4th week", "notes.pdf · reviewed", chip("Flagged · conflicts with case 3", "toyou")],
    ["Pain, medical, red flags → pause, to you", "Safety rules", `<span class="chip chip-neutral">${icon("lock")}Can’t switch off</span>`],
  ];
  return `<div class="tb-hero" data-ledger>
  ${stage(`<article class="rule-card" data-rule-card data-rc="pending" aria-labelledby="rc-h">
    <div class="rc-top"><span class="rule-src mono">Interview · 12 Oct</span><span class="rc-status mono">${vx("To review", 18, { cls: "vx-end" })}</span></div>
    <p class="rc-text" id="rc-h">${esc(RULE_TEXT)}</p>
    <div class="rc-edit" hidden><label class="sr-only" for="rc-input">Edit the rule</label><textarea id="rc-input" rows="2" maxlength="120">${esc(RULE_TEXT)}</textarea></div>
    <p class="rc-meta mono">Applies to · main lower-body lift</p>
    <div class="rc-actions">
      <button type="button" class="ui-b ui-b-ink" data-rc-act="confirm"><span class="rc-confirm-l">Confirm</span></button>
      <button type="button" class="ui-b" data-rc-act="edit">Edit</button>
      <button type="button" class="ui-b ui-b-no" data-rc-act="reject">Reject</button>
      <button type="button" class="ui-b" data-rc-act="undo" hidden>${icon("replay")}Undo</button>
    </div>
    <span class="rc-stamp" aria-hidden="true">${icon("check")}<span class="rc-stamp-l">Confirmed</span></span>
    <p class="sr-only" aria-live="polite" data-live></p>
  </article>
  <div class="device window tb-ledger"><div class="window-screen"><div class="window-bar"><span class="window-title">Your AI · Rules</span><span class="window-meta mono">${vx("1 to review · 1 flagged", 0, { cls: "tb-count" })}</span></div><div class="window-body">
    <div class="tb-ledger-head"><button type="button" class="ui-b" data-rc-act="all">Approve all <span class="mono">(1)</span></button><span class="note">Flagged rules are never in “Approve all”.</span></div>
    <ul class="tb-rows">${rows.map(([r, s, c]) => `<li><code class="mono">${esc(r)}</code><span class="tb-meta"><span class="rule-src mono">${esc(s)}</span>${c}</span></li>`).join("")}</ul>
  </div></div></div>`, "tb-stage")}
  <p class="tb-cap">${sampleLabel("Sample trainer · try Confirm, Edit or Reject")}</p>
</div>`;
}

function tbWhat() {
  const chain = [
    ["Decision", `Mon · Back squat <span class="mono">60 → 62.5 kg</span>`, lanePill("Applied automatically", "applied")],
    ["Your rule", `<code class="mono">2 easy sessions at 3+ RIR → +2.5 kg</code>`, ""],
    ["Source", `Interview · 12 Oct · “If two sessions move fast, I add a small jump.”`, ""],
    ["Release", `<span class="mono">v4</span> · checked against your test cases`, ""],
  ];
  return band(
    { tone: "paper", cls: "tbw-band", label: "tbw-h" },
    `<div class="split tbw-split">
  <div class="s-copy" data-reveal>
    <p class="kicker">What it is</p>
    ${h2("tbw-h", "Not a generic workout generator")}
    <p class="sec-lede mt-s">Every change traces back to something you taught. Every version can be rolled back.</p>
  </div>
  <div class="s-media" data-reveal>
    <ol class="trace" aria-label="One decision traced to its source">${chain.map(([k, v, x], i) => `<li class="trace-step"><span class="trace-k mono">${esc(k)}</span><span class="trace-v">${v}</span>${x}${i < chain.length - 1 ? `<span class="trace-why mono" aria-hidden="true">${["because", "from", "in"][i]}</span>` : ""}</li>`).join("")}</ol>
    <p class="mt-s">${sampleLabel("Sample trainer")}</p>
  </div>
</div>`,
  );
}

function tbTeach() {
  const items = [
    { k: "interview", t: "A guided interview", d: "What you recommend, why, and what changes it." },
    { k: "rule", t: "Rules you confirm", d: "Plain language, each with its source. Flagged rules never go into “Approve all”." },
    { k: "case", t: "Cases and examples", d: "Real decisions you made, not just principles." },
    { k: "document", t: "Your documents", d: "Used only after you review the extracted text." },
    { k: "quiz", t: "The practice quiz", d: "8 answers and 3 cases to start. 20 cases for automatic sending." },
  ];
  return band(
    { tone: "white", cls: "teach-band", label: "teach-h" },
    `${sectionHead({ kicker: "Teaching", title: "What you teach it", id: "teach-h", layout: "split", lede: "Five ways in. Every rule keeps its source, so you can always see where a decision came from." })}
<ol class="teach" data-reveal="stagger">${items.map((x, i) => `<li class="ri"><span class="teach-src mono">${esc(x.k)}</span><span class="teach-n mono" aria-hidden="true">${String(i + 1).padStart(2, "0")}</span><h3>${esc(x.t)}</h3><p>${esc(budget("card", x.d))}</p></li>`).join("")}</ol>`,
  );
}

function tbDecides() {
  const page = P("/trainer-brain");
  const sec = S(page, "decides");
  const viz = [
    `<div class="conf" style="--c:.86;--t:.8"><div class="conf-row"><span>How sure</span><span class="mono">86%</span></div><div class="conf-track"><span class="conf-fill"></span><span class="conf-mark" aria-hidden="true"></span></div><p class="conf-note mono">Above your bar (80%)</p></div>`,
    `<div class="conf" style="--c:.52;--t:.8"><div class="conf-row"><span>How sure</span><span class="mono">52%</span></div><div class="conf-track"><span class="conf-fill"></span><span class="conf-mark" aria-hidden="true"></span></div><p class="conf-note mono">Below your bar (80%)</p></div>`,
    `<div class="conf conf-lock"><div class="conf-row"><span>How sure</span><span class="mono">Not scored</span></div><p class="conf-safety">${icon("lock")}<span>Safety rules in code. No setting switches them off.</span></p></div>`,
  ];
  const tone = ["applied", "toyou", "paused"];
  const ex = ["“Squats felt easy” → +2.5 kg", "“Hotel gym for two weeks” → draft to you", "“My knee hurts” → workout paused"];
  return band(
    { tone: "paper", cls: "decide-band", label: "decide-h" },
    `${sectionHead({ kicker: "Decisions", title: tx(sec.heading), id: "decide-h", layout: "split", lede: tx(sec.body[0]) })}
<ul class="decide" data-reveal="stagger">${sec.cards.map((c, i) => `<li class="decide-card ri" data-tone="${tone[i]}">
  ${lanePill(c.label === "Handed to you" ? "Handed to you" : c.label, tone[i])}
  <h3>${esc(c.title)}</h3>
  <p>${esc(budget("card", tx(c.body)))}</p>
  <p class="decide-ex mono">${esc(ex[i])}</p>
  ${viz[i]}
</li>`).join("")}</ul>`,
  );
}

function tbBetter() {
  const bullets = [
    "Your corrections become suggested rules you confirm.",
    "Each release is checked against your test cases first.",
    "Every release is versioned, so you can roll back.",
    "“Compare my replies”: rate its reply blind against yours, 1–5 on five points.",
  ];
  const versions = [
    ["v1", "Interview", "12 Oct"],
    ["v2", "+ quiz", "14 Oct"],
    ["v3", "+ 3 cases", "16 Oct"],
    ["v4", "+ 2 corrections", "21 Oct"],
  ];
  const dims = [["Coaching decision", 4, 4], ["Tone and wording", 5, 4], ["Use of conversation", 4, 4], ["Explanation and reasoning", 4, 5], ["Knowing when to ask or defer", 5, 5]];
  const dots = (v, who) => `<span class="cmp-dots" role="img" aria-label="${who} ${v} of 5">${[1, 2, 3, 4, 5].map((k) => `<i${k <= v ? ' class="on"' : ""}></i>`).join("")}</span>`;
  const release = `<div class="rel" data-release data-pos="3">
  ${windowFrame(`<div class="rel-track">
      <span class="rel-live" aria-hidden="true"><span>Live</span></span>
      <ol class="rel-nodes">${versions.map(([v, w, d], i) => `<li data-v="${i}"><span class="rel-dot" aria-hidden="true"></span><b class="mono">${v}</b><small>${esc(w)}</small><small class="mono">${d}</small></li>`).join("")}</ol>
    </div>
    <div class="rel-foot"><p class="rel-status mono">${vx("v4 live · checked against your test cases", 0, { cls: "rel-msg" })}</p><button type="button" class="ui-b" data-rel-btn aria-describedby="rel-h">${vx("Roll back to v3", 0, { cls: "rel-btn-l" })}</button></div>
    <p class="sr-only" aria-live="polite" data-live></p>`, { title: "Releases", meta: "Sample", cls: "rel-window" })}
</div>`;
  const compare = `<div class="cmp" data-compare data-state="start">
  ${windowFrame(`<p class="cp-label">Subscriber</p>
    <p class="cmp-msg">“Week three done. Squats felt easy.”</p>
    <div class="cmp-replies">
      <div class="cmp-r"><p class="cmp-who">${swapPair("Reply A", "Your reply")}</p><p>Nice work. Two easy sessions, so Monday’s squat goes up to 62.5 kg.</p></div>
      <div class="cmp-r"><p class="cmp-who">${swapPair("Reply B", "Your AI")}</p><p>Great week. Squats move to 62.5 kg on Monday after two easy sessions.</p></div>
    </div>
    <dl class="cmp-scores">${dims.map(([d, a, b]) => `<div><dt>${esc(d)}</dt><dd>${dots(a, "Reply A")}${dots(b, "Reply B")}</dd></div>`).join("")}</dl>
    <div class="cmp-foot"><button type="button" class="ui-b ui-b-ink" data-compare-btn aria-pressed="false">${vx("Save ratings and reveal", 0, { cls: "cmp-btn-l" })}</button><span class="note">Labels stay hidden until you save both ratings.</span></div>
    <p class="sr-only" aria-live="polite" data-live></p>`, { title: "Compare my replies", meta: "Blind · sample", cls: "cmp-window" })}
</div>`;
  return band(
    { tone: "white", cls: "better-band", label: "better-h" },
    `<div class="better">
  <div class="better-copy" data-reveal>
    <p class="kicker">Learning</p>
    ${h2("better-h", "How it gets better")}
    <ul class="dash-list better-list">${bullets.map((b) => `<li>${esc(b)}</li>`).join("")}${frontierBullets("/trainer-brain", "learns")}</ul>
    <p class="mt-m">${textLink("/guides/writing-coaching-rules", "Writing coaching rules")}</p>
  </div>
  <div class="better-ui" data-reveal>
    <h3 class="sr-only" id="rel-h">Release timeline</h3>${release}
    <h3 class="sr-only">Compare my replies</h3>${compare}
  </div>
</div>`,
  );
}

function tbNeverMine() {
  const mine = [
    "Private to your workspace",
    "Isolated at the database layer",
    "Never used for another trainer",
    "Export or delete it whenever you like",
    "Your voice only with consent you can withdraw",
  ];
  return band(
    { tone: "paper", cls: "nm-band", label: "nm-never" },
    `<div class="nm">
  <div class="nm-col" data-reveal>${constraintList({ title: "What it never does", level: 2 }).replace('<h2 class="never-title">', '<h2 class="never-title" id="nm-never">')}</div>
  <div class="nm-col" data-reveal>
    ${h2("nm-mine", "Your method stays yours", "never-title")}
    <ul class="mine">${mine.map((m) => `<li>${icon("lock")}<span>${esc(m)}</span></li>`).join("")}</ul>
    <p class="mt-s">${textLink("/security-and-privacy", "Security and privacy")}</p>
  </div>
</div>`,
  );
}

function trainerBrain() {
  const faqs = fixA(faqsOf("/trainer-brain", {
    "Is the AI trained on my data?": "Is my AI trained on my data?",
    "Will the AI replace me?": "Will my AI replace me?",
    "Can another trainer see or use my Brain?": "Can another trainer see or use my AI?",
    "What if the Brain gets something wrong?": "What if my AI gets something wrong?",
  })).map((f) => ({ ...f, a: f.a.replace("checked against your scenarios", "checked against your test cases") }));
  return {
    title: "Trainer Brain: an AI trainer built from your judgment · trainsyou",
    main: [
      hero({
        kicker: "Trainer Brain",
        h1: "Your AI, built from your judgment",
        lede: tx(P("/trainer-brain").lede),
        media: tbLedger(),
        secondary: ["/demo", "Try the demo"],
        cls: "tb-hero-band",
      }),
      tbWhat(),
      tbTeach(),
      tbDecides(),
      tbBetter(),
      tbNeverMine(),
      faqBand({ id: "tfaq", title: "Questions about your AI", faqs, prefix: "tbq", related: ["/demo", "/features/safety", "/guides/writing-coaching-rules"] }),
    ].join("\n"),
    closing: { secondary: { label: "Try the demo", path: "/demo" } },
  };
}

/* ============================================================ FEATURES */

// The capability inventory (packages/contracts/src/marketing-features.ts), 91 items in 10 areas.
// Availability keys decide the chip; WHOOP, Zepp, Instagram and custom domains are fixed "Not on yet".
const M = ["model"], PAID = ["payments"];
const NUT = { availability: ["nutrition"], offering: "Optional tier" };
const VOI = { availability: ["voice"], offering: "Add-on" };
const it = (name, detail, extra = {}) => ({ name, detail, ...(Array.isArray(extra) ? { availability: extra } : extra) });
const MATRIX = [
  { id: "brain", title: "Your AI", audience: "You", page: "/trainer-brain", items: [
    it("Guided coaching interview", "Explain what you recommend, why, the alternatives and what changes your answer."),
    it("Rules in plain language", "Confirm, edit or reject each rule; every rule keeps its source.", M),
    it("Coaching cases and examples", "Teach real decisions, not just principles."),
    it("Your own documents", "Import your material and review the extracted text privately before it is used.", M),
    it("Conflict resolution", "When two sources disagree, you decide which rule wins.", M),
    it("Your test cases", "Start supervised with 8 quiz answers and 3 own cases. Automatic sending requires 20 cases and passing checks."),
    it("Checked before release", "Every version is tested against your test cases before it can go live.", M),
    it("Versioned releases and rollback", "Publish a version, compare it, and roll back at any time.", M),
    it("How sure it must be", "You choose which routine changes run automatically; the rest comes to you.", M),
    it("Learning from corrections", "Your approvals, corrections and subscriber outcomes become teaching for the next release.", M),
  ] },
  { id: "training", title: "Plans and workouts", audience: "You and your subscribers", page: "/features/ai-training-plans", items: [
    it("A personalised, dated plan", "Built by your AI from each subscriber’s goals, schedule, experience and equipment.", M),
    it("Adapts as they train", "Progressions, missed sessions and swaps follow your confirmed rules.", M),
    it("Hand-off when unsure", "Low-confidence decisions come to you as a draft to approve or correct.", M),
    it("Programme templates", "Write programmes yourself with the exercise library and assign them."),
    it("Automatic calendar", "Assigned programmes are scheduled by date, with rest days kept."),
    it("Move or skip a session", "Subscribers reschedule within your rules."),
    it("Guided session", "Exercise cues, sets, targets and rest timers, one step at a time.", PAID),
    it("Set logging", "Reps, load, effort and notes for every set, with corrections kept in history.", PAID),
    it("Approved swaps", "Subscribers can swap only to alternatives you approved.", PAID),
    it("Offline in the gym", "A workout opened online keeps working offline and syncs later.", PAID),
    it("One-tap pain report", "Pauses the workout and alerts you straight away."),
    it("Workout reminders", "Reminders, programme-ready and missed-session messages.", PAID),
  ] },
  { id: "nutrition", title: "Nutrition tier", audience: "You and your subscribers", page: "/features/nutrition", items: [
    it("Weekly meal plans", "Built from your recipes, rules and each subscriber’s targets and preferences.", NUT),
    it("Recipe options and swaps", "Only the swaps your teaching allows.", NUT),
    it("Grocery lists", "A consolidated shopping list for the week.", NUT),
    it("Pantry and leftovers", "Plans that use what the subscriber already has.", NUT),
    it("Food diary", "With favourites, copied meals and corrections.", NUT),
    it("Meal photo estimates", "Foods and portions estimated from a photo, confirmed by the subscriber.", NUT),
    it("Barcode lookup", "Packaged foods read by barcode, confirmed before logging.", NUT),
    it("Weekly check-ins", "Progress against the targets you set.", NUT),
    it("Your nutrition teaching", "Cases, recipes and calorie methods, checked before release.", NUT),
    it("Exceptions queue", "Decisions outside your rules come to you.", NUT),
  ] },
  { id: "voice", title: "Voice add-on", audience: "You and your subscribers", page: "/features/voice-coach", items: [
    it("Sessions in your own voice", "Personal narration in your coaching style, from your verified voice and approved plan.", VOI),
    it("Members’ own music", "Short cues and tap-to-talk while members play their own music app, subject to device playback rules.", VOI),
    it("Verified and consented", "Identity verification and your separate, recorded consent, which you can withdraw.", VOI),
    it("Only your subscribers", "Used only for your own subscribers who add it, never for another trainer’s.", VOI),
  ] },
  { id: "coaching", title: "Chat, progress and data", audience: "You and your subscribers", page: "/features/chat-and-digital-coach", items: [
    it("Private chat with you", "One thread per subscriber, with photo and PDF attachments."),
    it("Labelled digital coach", "Answers from your published teaching and is always labelled as digital.", ["model", "payments"]),
    it("Personal takeover", "Take over a subscriber and the digital coach steps back."),
    it("Scheduled follow-ups", "Check-in messages sent when you plan them.", PAID),
    it("Client Twin", "Goals, preferences and history in one coaching context, each with its date and source."),
    it("Progress page", "Completed sessions, training volume and best loads per exercise."),
    it("Apple Health import", "Subscribers can import an Apple Health export."),
    it("WHOOP connection", "Shared only with the subscriber’s permission and your policy.", ["whoop"]),
    it("Amazfit / Zepp connection", "Shared only with the subscriber’s permission and your policy.", ["zepp"]),
    it("Notifications and quiet hours", "An in-app inbox with preferences."),
  ] },
  { id: "bookings", title: "Bookings", audience: "You and your subscribers", page: "/features/bookings", items: [
    it("Session slots", "One-off or weekly slots with capacity."),
    it("Paid one-to-one sessions", "Card payment in AED at booking.", PAID),
    it("Cancellation rules", "Your window decides refunds automatically.", PAID),
    it("Attendance and no-shows", "Tracked per booking.", PAID),
    it("Calendar export", "Bookings in the subscriber’s own calendar."),
  ] },
  { id: "brand", title: "Your brand, website and app", audience: "You", page: "/features/website-and-domain", items: [
    it("Desktop visual website editor", "Drag and drop sections, create multiple pages and manage navigation."),
    it("Section template library", "282 layouts across 40 families, including heroes, videos, programmes, pricing, FAQs and contact forms."),
    it("AI starter sites", "AI assembles existing modules into an editable starter. Manual templates work without AI.", M),
    it("Before-and-after galleries", "Paired client transformation photos and captions, using material you have permission to publish."),
    it("Separate website and app styles", "Set website colours and typography independently from your member app."),
    it("Draft recovery", "Autosave, undo and redo, reusable sections and publication history. Restore to a draft before republishing."),
    it("Coaching website", "Responsive pages, videos, photo galleries and a contact form whose messages reach your inbox."),
    it("Private preview", "Preview desktop, tablet and phone layouts before publishing."),
    it("Your coaching address", "Reserved the moment you sign up."),
    it("Your own domain, bought for you", "Bought and renewed automatically, with the cost on your statement.", ["customDomains"]),
    it("Connect a domain you own", "Point an existing domain at your website.", ["customDomains"]),
    it("Installable app", "Subscribers add your app to their home screen with your name and icon."),
    it("Search titles and descriptions", "Set how your pages appear in search results."),
    it("Coach directory listing", "Optional: appear in the public directory of coaches."),
    it("English and Arabic member controls", "Core member screens support Arabic and right-to-left layouts. Coach content and marketing pages are not automatically translated."),
  ] },
  { id: "money", title: "Offers, payments and payouts", audience: "You", page: "/features/payments-and-payouts", items: [
    it("Two tiers", "Workout, or workout and nutrition, each at your price."),
    it("Your price in AED", "With the programme length you choose.", PAID),
    it("Monthly or upfront billing", "Bill the whole programme upfront, or month by month.", PAID),
    it("Trials and promotion codes", "Free trial days and codes when you want them.", PAID),
    it("Card checkout", "Through Stripe, with receipts and billing history for subscribers.", PAID),
    it("Refund decisions", "Requests you approve or decline, reconciled with the payment provider.", PAID),
    it("Transparent commission", "Bands of 25%, 20%, 15% and 10%."),
    it("Monthly statement", "From gross revenue to net, every cost itemised."),
    it("Ledger export", "Your ledger as a CSV file."),
    it("Monthly payouts", "To a verified UAE IBAN.", ["payouts"]),
  ] },
  { id: "growth", title: "Growth", audience: "You", page: "/follower-calculator", items: [
    it("Follower calculator", "A best case with cautious and typical scenarios, from cited benchmarks, with every assumption shown."),
    it("Connect Instagram", "Professional accounts fill the calculator with real numbers; access is not kept.", ["instagram"]),
    it("Tagged share links", "Links for your bio and Stories, so you see which ones bring visitors."),
    it("Consented visitor sources", "Where visitors came from, only when they allowed analytics."),
    it("Invite links", "Invite subscribers you already coach."),
    it("Website inquiries", "Contact-form messages in one inbox."),
  ] },
  { id: "trust", title: "Safety, privacy and team", audience: "You and your subscribers", page: "/features/safety", items: [
    it("Safety rules in code", "Pain, pregnancy and red flags pause training and come to you, whatever the settings."),
    it("Your own red flags", "Add terms that also pause training, and topics that come to you for review."),
    it("Escalation", "Unreviewed safety holds escalate until someone decides."),
    it("AI disclosure", "Accepted when subscribers join; digital replies are always labelled."),
    it("Workspace isolation", "Every workspace is separated at the database layer."),
    it("Strong sign-in", "Authenticator apps, passkeys and recovery codes."),
    it("Team roles", "Staff coaches without finance access; finance without coaching data."),
    it("Consent choices", "Separate choices for coaching data, marketing and analytics."),
    it("Export and deletion", "Trainers and subscribers can download their data and request deletion."),
  ] },
];
const CAP_COUNT = MATRIX.reduce((n, g) => n + g.items.length, 0);
const REPLACES = [
  { tool: "A website builder", instead: "A desktop drag-and-drop builder with multiple pages, section templates, galleries, videos and private previews." },
  { tool: "A booking tool", instead: "Session slots, paid bookings, cancellation rules and calendar export.", flag: "payments" },
  { tool: "A payment set-up and invoicing", instead: "Card checkout in AED, trials, promotions, refunds, statements and payouts.", flag: "payments" },
  { tool: "A client training app", instead: "A branded app with day-by-day plans, set logging, rest timers and offline mode." },
  { tool: "A meal-planning app", instead: "The optional nutrition tier: meal plans, recipes, grocery lists and a food diary." },
  { tool: "A client messaging app", instead: "Private chat, attachments, scheduled follow-ups and a labelled digital coach." },
  { tool: "Programme spreadsheets", instead: "Templates, an exercise library, automatic scheduling and progress tracking." },
];
const AVK = { model: "on", nutrition: "on", payments: "payments", payouts: "payments", voice: "voice", customDomains: "off", whoop: "off", zepp: "off", instagram: "off" };
/** Capability chip: "Not on yet" while a needed provider or flag is off; otherwise its offering. */
function capChip(item) {
  const keys = (item.availability || []).map((k) => AVK[k] ?? k);
  if (keys.includes("off")) return chip("Not on yet", "soon");
  const flags = [...new Set(keys.filter((f) => f !== "on"))];
  const label = item.offering || "Included";
  return flags.length ? flagChip(flags[0], label) : chip(label, "live");
}

/** The 11 feature pages, in site order, with their blueprint H1s (C5). */
const FEATURE_PATHS = content.pages.filter((p) => p.path.startsWith("/features/")).map((p) => p.path);

function featIndexHero() {
  const rows = MATRIX.map((g) => `<li><a href="#cap-${g.id}" data-cap-link="${g.id}"><span class="fx-t">${esc(g.title)}</span><span class="fx-a">${esc(g.audience)}</span><span class="fx-n mono">${String(g.items.length).padStart(2, "0")}</span>${icon("arrow")}</a></li>`).join("");
  return `<div class="fx">
  ${stage(`<div class="device window fx-win"><div class="window-screen"><div class="window-bar"><span class="window-title">Your workspace · ${CAP_COUNT} capabilities</span><span class="window-meta mono">${MATRIX.length} areas</span></div>
    <div class="window-body"><p class="fx-search mono">${icon("arrow")}<span>Jump to an area</span></p><ul class="fx-list">${rows}</ul></div></div></div>`, "fx-stage")}
  <p class="fx-cap">${sampleLabel("Counted from the product’s capability list")}</p>
</div>`;
}

function bento() {
  const page = P("/features");
  const cards = S(page, "groups").cards;
  const inbox = windowFrame(
    `<div class="mi-item">
      ${lanePill("Below your bar", "applied", { to: "Approved by you", from: "toyou" })}
      <p class="mi-q">Hotel gym for two weeks</p>
      <p class="mi-d"><span class="rule-src mono">Draft</span>Plan with dumbbells to 20 kg</p>
      <div class="ui-btns"><span class="ui-btn mi-press">Approve</span><span class="ui-btn ui-btn-ghost">Correct</span></div>
    </div>
    <div class="mi-item mi-dim">${lanePill("Applied automatically", "applied")}<span class="mono">Squat 60 → 62.5 kg</span></div>`,
    { title: "Inbox", meta: "Sample", cls: "mini-win" },
  );
  const today = phoneFrame(
    `${appHead()}
    <div class="ui">
      <p class="ui-sub mono">Week 3 · Day 2</p><p class="ui-title ui-title-l">Lower body A</p>
      <ul class="plan">
        <li class="plan-row is-target"><span class="pr-name">Back squat</span><span class="pr-sets mono">4 × 6</span><span class="pr-load mono">${swapPair("60 kg", "62.5 kg")}</span>${TICK}</li>
        <li class="plan-row"><span class="pr-name">Romanian deadlift</span><span class="pr-sets mono">3 × 8</span><span class="pr-load mono">50 kg</span></li>
      </ul>
      <p class="ui-note vg-in" style="--vd:1300ms">${icon("check")}<span>Squat increased: two easy sessions in a row.</span></p>
    </div>`,
    { cls: "mini-phone" },
  );
  const stmt = windowFrame(sampleStatement({ head: false }), { title: "Statement · sample month", meta: "AED", cls: "mini-win mini-stmt" });
  const pain = phoneFrame(
    `${appHead()}
    <div class="ui">
      <p class="ui-sub mono">Back squat · set 3 of 4</p><p class="ui-title ui-title-l">6 reps · 62.5 kg</p>
      <span class="ui-btn ui-btn-danger mi-press">Report pain</span>
      <div class="mi-paused vg-in" style="--vd:700ms"><p>${icon("minus")}Workout paused. Your coach has been told.</p></div>
      <div class="vg-in mi-lane" style="--vd:1000ms">${lanePill("Paused, sent to Layla", "paused")}</div>
    </div>`,
    { cls: "mini-phone" },
  );
  const screens = [inbox, today, stmt, pain];
  const titles = ["Your AI", "Subscriber experience", "Your business", "Trust"];
  const links = [["/trainer-brain", "Trainer Brain"], ["/features/subscriber-app", "Subscriber app"], ["/pricing", "Pricing"], ["/features/safety", "Safety"]];
  const tags = [chip("Included", "live"), chip("Included", "live"), `${chip("Sample", "sample")}${notOnYet("payments", "subscriber payments")}`, chip("Included", "live")];
  const labels = ["Sample Inbox: a hotel-gym request below your bar, approved by you.", "Sample Today screen: squat moves from 60 to 62.5 kilograms.", "Sample statement: 150 subscribers at AED 199.", "Sample workout: pain reported, workout paused and sent to the trainer."];
  return band(
    { tone: "paper", id: "parts", cls: "bento-band", label: "parts-h" },
    `${sectionHead({ kicker: "One platform", title: tx(S(page, "groups").heading), id: "parts-h", layout: "split", lede: "Each part is shown live below with sample data. Nothing here needs publishing or payments to preview." })}
<ul class="bento" data-reveal="stagger">${cards.map((c, i) => `<li class="bento-card ri bento-${i + 1}">
  <div class="bento-copy"><p class="bento-n mono">${String(i + 1).padStart(2, "0")}</p><h3>${esc(titles[i])}</h3><p>${esc(budget("card", tx(c.body)))}</p><div class="bento-foot"><span class="bento-tags">${tags[i]}</span>${textLink(links[i][0], links[i][1])}</div></div>
  <div class="bento-screen dots" data-vignette data-state="start" role="img" aria-label="${esc(labels[i])}">${screens[i]}</div>
</li>`).join("")}</ul>`,
  );
}

function subscriberCards() {
  const page = P("/features");
  const cards = S(page, "subscribers").cards;
  const chips = [
    chip("Included", "live"), chip("Included", "live"), chip("Included", "live"),
    `${chip("Add-on", "neutral")}${flagChip("voice", "Live", "Not on yet")}`,
    chip("Optional tier", "live"),
    `${chip("Included", "live")}${notOnYet("payments", "paid sessions")}`,
    chip("Included", "live"), chip("Included", "live"),
  ];
  return band(
    { tone: "white", id: "subscribers", cls: "subs-cards-band", label: "subs-h" },
    `${sectionHead({ kicker: "Under your name", title: tx(S(page, "subscribers").heading), id: "subs-h", layout: "split", lede: "Everything a subscriber touches carries your brand, once your page is live." })}
<ul class="sc-grid" data-reveal="stagger">${cards.map((c, i) => `<li class="sc ri"><span class="sc-n mono">${String(i + 1).padStart(2, "0")}</span><h3>${esc(c.title)}</h3><p>${esc(budget("card", tx(c.body)))}</p><p class="sc-chips">${chips[i]}</p></li>`).join("")}</ul>`,
  );
}

function productShots() {
  const shotInbox = windowFrame(
    `<div class="sh-q">
      <div class="sh-item">${lanePill("Below your bar", "toyou")}<strong>Hotel gym for two weeks</strong><span>Draft plan with dumbbells to 20 kg. Approve or correct.</span><div class="ui-btns">${ui.btn("Approve")}${ui.btn("Correct", "ghost")}</div></div>
      <div class="sh-item">${lanePill("Safety hold", "paused")}<strong>“My knee hurts when I squat”</strong><span>Workout paused. Training resumes when you decide.</span></div>
      <div class="sh-item sh-done">${lanePill("Applied automatically", "applied")}<strong>Squat 60 → 62.5 kg</strong><span>Your rule: two easy sessions at 3+ reps in reserve.</span></div>
    </div>`,
    { title: "Inbox", meta: "Inbox · Clients · My AI · More", cls: "sh-win" },
  );
  const shotToday = phoneFrame(
    `${appHead()}
    <div class="ui">
      <p class="ui-sub mono">Week 3 · Day 2</p><p class="ui-title ui-title-l">Lower body A</p>
      <ul class="ui-plan">
        <li><span>Back squat</span><span class="mono">4 × 6 · 62.5 kg · 120 s</span></li>
        <li><span>Romanian deadlift</span><span class="mono">3 × 8 · 50 kg · 90 s</span></li>
        <li><span>Walking lunge</span><span class="mono">3 × 10 · 60 s</span></li>
        <li><span>Plank</span><span class="mono">3 × 40 s · 45 s</span></li>
      </ul>
      ${ui.btn("Start guided session")}
      ${ui.note("Squat increased: two easy sessions in a row.")}
    </div>${ui.tabs("Today")}`,
    { cls: "sh-phone" },
  );
  const shotLogger = phoneFrame(
    `${appHead()}
    <div class="ui">
      <p class="ui-title">Back squat · set 3 of 4</p>
      <div class="ui-table"><div class="ui-tr ui-th"><span>Set</span><span>Load</span><span>Reps · RIR</span><span></span></div>
        <div class="ui-tr"><span>1</span><span class="mono">62.5 kg</span><span class="mono">6 · 3</span>${icon("check")}</div>
        <div class="ui-tr"><span>2</span><span class="mono">62.5 kg</span><span class="mono">6 · 3</span>${icon("check")}</div>
        <div class="ui-tr sh-cur"><span>3</span><span class="mono">62.5 kg</span><span class="mono">— · —</span><span></span></div></div>
      <div class="sh-timer"><span class="mono">1:24</span><small>rest remaining</small></div>
      <span class="ui-btn ui-btn-danger">Report pain</span>
      <p class="ui-sub mono">Saved on this phone — will sync</p>
    </div>`,
    { cls: "sh-phone" },
  );
  const shotStmt = windowFrame(`${sampleStatement()}<p class="stmt-foot mono">Monthly UAE payouts once payments are on</p>`, { title: "Monthly statement", meta: "150 subscribers at AED 199", cls: "sh-win" });
  const shotEditor = windowFrame(
    `<div class="ed">
      <div class="ed-side"><p class="ui-label">Section library</p><p class="ui-sub mono">282 layouts · 40 families</p><ul>${["Hero", "Programmes", "Video", "Before and after", "Pricing", "FAQ", "Contact"].map((x, i) => `<li${i === 3 ? ' class="is-on"' : ""}>${esc(x)}</li>`).join("")}</ul></div>
      <div class="ed-main"><div class="ed-tabs mono"><span class="is-on">Home</span><span>Coaching</span><span>Results</span><span>Contact</span></div>
        <div class="ed-block ed-hero"><span></span><span></span>${ui.btn("See coaching")}</div>
        <div class="ed-block ed-ba"><span>Before</span><span>After</span></div>
        <div class="ui-btns ed-actions">${ui.btn("Preview", "ghost")}${ui.btn("Publish")}</div>
      </div>
    </div>`,
    { title: "Website editor", meta: "Desktop editor · Draft saved", cls: "sh-win" },
  );
  const shots = [
    ["Inbox", shotInbox, "Your Inbox.", "Approved automatic changes are applied and logged; drafts below your bar and safety holds come to you."],
    ["Today", shotToday, "Your subscriber’s day.", "A dated plan in your method, with the reason for every change in plain language."],
    ["Logger", shotLogger, "The workout logger.", "Reps, load and effort per set, a rest timer, offline saving, and pain reporting in one tap."],
    ["Statement", shotStmt, "Your statement.", "Gross to net with our share by band, the same arithmetic as the pricing example."],
    ["Editor", shotEditor, "Your website builder.", "Multipage editing, reusable sections and recovery tools. Publish after reviewing your draft."],
  ];
  const tabs = shots.map(([t], i) => `<button type="button" role="tab" id="sh-t${i}" aria-controls="sh-p${i}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${esc(t)}</button>`).join("");
  const panels = shots.map(([t, dev, b, cap], i) => `<div class="sh-panel" role="tabpanel" id="sh-p${i}" aria-labelledby="sh-t${i}" tabindex="0"${i ? " hidden" : ""}>
  <div class="sh-stage dots" role="img" aria-label="Sample ${esc(t)} screen">${dev}</div>
  <div class="sh-cap"><p class="sh-k mono">${String(i + 1).padStart(2, "0")} / 05</p><p><strong>${esc(b)}</strong> ${esc(cap)}</p>${i === 3 ? `<p class="hero-chips">${chip("Sample", "sample")}${notOnYet("payments", "subscriber payments")}</p>` : ""}</div>
</div>`).join("");
  return band(
    { tone: "paper", id: "screens", cls: "shots-band", label: "screens-h" },
    `${sectionHead({ kicker: "Screens", title: "Inside the product", id: "screens-h", layout: "split", lede: "Five sample screens. Pick one; nothing rotates on its own." })}
<div class="shots" data-tabs data-reveal>
  <div class="ptabs" role="tablist" aria-label="Product screens" style="--n:5">${tabs}<span class="tab-ink" aria-hidden="true"></span></div>
  ${panels}
</div>
<p class="note mt-m">Illustrations with sample data, not a live account; your screens show your own brand, subscribers and figures.</p>`,
  );
}

function replacesBand() {
  return band(
    { tone: "white", id: "replaces", cls: "replaces-band", label: "replaces-h" },
    `<div class="split rp-split">
  <div class="s-copy" data-reveal>
    <p class="kicker">One workspace</p>
    ${h2("replaces-h", `The ${REPLACES.length} tools it replaces`)}
    <p class="sec-lede mt-s">Many trainers stitch a business together from separate subscriptions. Here is what each becomes.</p>
  </div>
  <div class="s-media" data-reveal>${dataTable({
    caption: "Tool categories and what replaces them",
    columns: ["Instead of", "In trainsyou"],
    rows: REPLACES.map((r) => [r.tool, { html: `${esc(r.instead)}${r.flag ? ` ${flagChip(r.flag, "Live", "Not on yet")}` : ""}` }]),
    cls: "rp-table",
  })}</div>
</div>`,
  );
}

function guidesBand() {
  const tiles = FEATURE_PATHS.map((p) => {
    const pg = P(p);
    return `<li class="ri"><a class="fg" href="${href(p)}" data-cta="link" data-loc="feature-guides"><span class="fg-top"><span class="fg-t">${esc(pg.navLabel)}</span>${icon("arrow")}</span><span class="fg-d">${esc(FEATURE[p.split("/").pop()].h1)}</span><span class="fg-chips">${offeringChip(pg)}</span></a></li>`;
  }).join("");
  return band(
    { tone: "paper", id: "feature-guides", cls: "fg-band", label: "fg-h" },
    `${sectionHead({ kicker: "Feature guides", title: "One page per feature", id: "fg-h", layout: "split", lede: "How each part works, with its own screen and what it needs to be on." })}
<ul class="fg-grid" data-reveal="stagger">${tiles}</ul>`,
  );
}

function capsBand() {
  const groups = MATRIX.map((g) => `<div class="cap" id="cap-${g.id}">
  <h3 class="cap-q"><button type="button" id="cap-${g.id}-b" aria-expanded="false" aria-controls="cap-${g.id}-p"><span class="cap-t">${esc(g.title)}</span><span class="cap-aud">${esc(g.audience)}</span><span class="cap-n mono">${g.items.length}</span><span class="faq-ic" aria-hidden="true"></span></button></h3>
  <div class="cap-a" id="cap-${g.id}-p" role="region" aria-labelledby="cap-${g.id}-b"><div>
    <ul class="cap-list">${g.items.map((x) => `<li><span class="cap-i"><strong>${esc(x.name)}</strong><span>${esc(tx(x.detail))}</span></span><span class="cap-chip">${capChip(x)}</span></li>`).join("")}</ul>
    ${g.page ? `<p class="cap-more">${textLink(g.page, `More about ${g.title.toLowerCase()}`)}</p>` : ""}
  </div></div>
</div>`).join("");
  return band(
    { tone: "white", id: "all-capabilities", cls: "caps-band", label: "caps-h" },
    `${sectionHead({ kicker: "The full list", title: `All ${CAP_COUNT} capabilities`, id: "caps-h", layout: "split", lede: `One workspace runs the whole coaching business, in ${MATRIX.length} areas. Open any area.` })}
<div class="caps-legend" data-reveal><span>${chip("Included", "live")} Live today</span><span>${chip("Optional tier", "live")} ${chip("Add-on", "neutral")} You choose to offer it</span><span>${chip("Not on yet", "soon")} Waiting for a provider or a launch gate</span><button type="button" class="ui-b caps-all" data-caps-all aria-controls="${MATRIX.map((g) => `cap-${g.id}-p`).join(" ")}">${vx("Open all", 0, { cls: "caps-all-l" })}</button></div>
<div class="caps" data-caps data-reveal>${groups}</div>`,
  );
}

function featuresIndex() {
  const faqs = [
    { id: "today", q: "Are all features available today?", a: "Most are. Anything that needs subscriber payments or an outside provider shows “Not on yet” until it is switched on, and publishing waits for payments. Everything else is included." },
    { id: "download", ...P("/features").faqs[1] },
  ];
  return {
    main: [
      hero({
        kicker: "Features",
        h1: "Everything you need, under your own name",
        lede: tx(P("/features").lede),
        media: featIndexHero(),
        secondary: ["/pricing", "See the pricing"],
        cls: "fx-hero",
      }),
      bento(),
      subscriberCards(),
      productShots(),
      replacesBand(),
      guidesBand(),
      capsBand(),
      faqBand({ id: "ffaq", title: "Feature questions", faqs, prefix: "fxq", related: ["/how-it-works", "/pricing"], tone: "paper" }),
    ].join("\n"),
    closing: { secondary: { label: "See the pricing", path: "/pricing" } },
  };
}

/* ====================================================== FEATURE DETAIL */

/** Member-app strings with their real Arabic from apps/web/lib/i18n/messages (RTL preview only). */
const t2 = (en, ar) => `<span data-en="${esc(en)}" data-ar="${esc(ar)}">${esc(en)}</span>`;
const AR = {
  today: t2("Today", "اليوم"), plan: t2("Plan", "الخطة"), chat: t2("Chat", "المحادثة"), progress: t2("Progress", "التقدّم"),
  start: t2("Start workout", "بدء التمرين"), install: t2("Install the app", "تثبيت التطبيق"),
  saved: t2("Saved on this phone — will sync when you are back online.", "محفوظ على هذا الهاتف، وستتم مزامنته عند عودة الاتصال."),
  pain: t2("Report pain", "الإبلاغ عن ألم"), rest: t2("Rest", "راحة"),
};

/** A phone row in the plan list: name, sets, load (optionally swapping). */
const planRow = (name, sets, load, to = "") =>
  `<li class="plan-row${to ? " is-target" : ""}"><span class="pr-name">${esc(name)}</span><span class="pr-sets mono">${esc(sets)}</span><span class="pr-load mono">${to ? swapPair(load, to) : esc(load)}</span>${to ? TICK : ""}</li>`;
/** A replay row under a vignette. */
const vgCap = (text) => `<div class="vg-cap">${sampleLabel(text)}<button type="button" class="cap-replay" data-vreplay>${icon("replay")}<span>Replay</span></button></div>`;
/** Vignette wrapper: one state change, played once (product.js). */
const vignette = (inner, { label, cls = "", cap = "Sample trainer · scripted", interactive = false } = {}) =>
  `<figure class="vg${cls ? " " + cls : ""}" data-vignette data-state="start">
  ${stage(inner, "vg-stage")}
  <figcaption>${interactive ? "" : `<span class="sr-only">${esc(label)}</span>`}${vgCap(cap)}</figcaption>
</figure>`;
const img = (label) => `role="img" aria-label="${esc(label)}"`;

const FEATURE = {
  "ai-training-plans": {
    h1: "Your AI plans every subscriber’s training",
    lede: "A dated, day-by-day plan for each subscriber, built from your rules. Confident changes are applied; anything unsure comes to you.",
    vignette: () => vignette(`<div class="vg-pair" ${img("Sample Today screen: back squat moves from 60 to 62.5 kilograms, with the reason shown, beside a dated week of sessions.")}>
      ${phoneFrame(`${appHead()}
        <div class="ui">
          <p class="ui-sub mono">Week 3 · Day 2 · Tue 21 Oct</p><p class="ui-title ui-title-l">Lower body A</p>
          <ul class="plan">${planRow("Back squat", "4 × 6", "60 kg", "62.5 kg")}${planRow("Romanian deadlift", "3 × 8", "50 kg")}${planRow("Walking lunge", "3 × 10", "60 s")}</ul>
          ${ui.btn("Start guided session")}
          <p class="vg-why vg-in" style="--vd:1300ms">${icon("check")}<span><strong>Why it changed:</strong> two easy sessions in a row.</span></p>
        </div>${ui.tabs("Today")}`, { cls: "vg-phone" })}
      <div class="vg-float vg-week">
        <p class="ui-title">Week 3</p>
        <ol>${[["Mon 20", "Upper A", ""], ["Tue 21", "Lower A", "is-on"], ["Wed 22", "Rest", "is-rest"], ["Thu 23", "Upper B", ""], ["Fri 24", "Rest", "is-rest"], ["Sat 25", "Lower B", ""], ["Sun 26", "Rest", "is-rest"]].map(([dd, s, c]) => `<li class="${c}"><span class="mono">${dd}</span><span>${s}</span></li>`).join("")}</ol>
      </div>
    </div>`, { label: "Sample: squat progresses by your rule" }),
    sees: `${appHead()}<div class="ui">
      ${ui.h("This week", "Plan")}
      <ul class="ui-plan">
        <li><span>Tue 21 · Lower body A</span><span class="mono">Done</span></li>
        <li><span>Thu 23 · Lower body B</span><span class="mono">Moved</span></li>
        <li><span>Sat 25 · Upper body B</span><span class="mono">Planned</span></li>
      </ul>
      ${ui.note("Moved from Wednesday: you missed a session. Friday stays a rest day.")}
      <p class="ui-review">${icon("dot")}<span>Layla is reviewing a change to next week.</span></p>
    </div>${ui.tabs("Plan")}`,
    control: `${ui.h("Automatic changes", "Your rules")}
      ${ui.tog("Progressions", true, "Two easy sessions → +2.5 kg")}
      ${ui.tog("Missed sessions", true, "Next free day, never stacked")}
      ${ui.tog("Exercise swaps", false, "Comes to you")}
      <div class="ui-row"><span class="ui-k">How sure it must be</span><span class="ui-v">80%</span></div>
      ${ui.bar(0.8)}
      ${ui.btns(ui.btn("Edit plan", "ghost"), ui.btn("Take over", "ghost"))}`,
    controlTitle: "Plans · Settings",
  },
  "subscriber-app": {
    h1: "Your training app, with your name on it",
    lede: "Your name, colours and icon. Today’s workout, set logging, rest timers and approved swaps, offline in the gym.",
    vignette: () => `<figure class="vg vg-app" data-vignette data-state="start">
      ${stage(`<div class="vg-pair">
        <div class="vg-rtl" data-rtl-target lang="en" dir="ltr" ${img("Sample member app for Layla Strength: today’s workout, saved for offline use, with tabs for Today, Plan, Chat and Progress.")}>${phoneFrame(`${appHead()}
          <div class="ui">
            <p class="ui-title ui-title-l">${AR.today}</p>
            <div class="today-card-p"><span class="tc-play" aria-hidden="true">${icon("arrow")}</span><span><strong>${AR.start}</strong><small>Lower body A · 45 min</small></span></div>
            <ul class="ui-plan"><li><span>Back squat</span><span class="mono">4 × 6 · 62.5 kg</span></li><li><span>Romanian deadlift</span><span class="mono">3 × 8 · 50 kg</span></li></ul>
            <p class="vg-offline">${icon("check")}${AR.saved}</p>
          </div>
          <div class="app-tabs" aria-hidden="true"><span class="is-on">${AR.today}</span><span>${AR.plan}</span><span>${AR.chat}</span><span>${AR.progress}</span></div>`, { cls: "vg-phone" })}</div>
        <div class="vg-float vg-home" aria-hidden="true">
          <div class="vg-icons"><span class="vg-ic"></span><span class="vg-ic"></span><span class="vg-ic vg-ic-ls vg-in" style="--vd:500ms"><b>LS</b></span><span class="vg-ic"></span></div>
          <p class="vg-home-l vg-in" style="--vd:700ms">Layla Strength is on your home screen</p>
        </div>
      </div>`, "vg-stage")}
      <figcaption>
        <div class="rtl-switch" role="group" aria-label="Preview the member app in"><button type="button" class="ui-b" data-rtl="en" aria-pressed="true">English</button><button type="button" class="ui-b" data-rtl="ar" aria-pressed="false" lang="ar">العربية</button></div>
        <p class="note">Member controls switch to Arabic, right to left. Coach-written content, like exercise names, isn’t translated automatically.</p>
        ${vgCap("Sample trainer · real member-app strings")}
      </figcaption>
    </figure>`,
    sees: `${appHead()}<div class="ui">
      <p class="ui-sub mono">Back squat · set 2 of 4</p>
      <p class="ui-title ui-title-l">6 reps · 62.5 kg</p>
      <p class="ui-cue">Brace, sit between your heels, drive up.</p>
      <div class="ui-log"><span>Reps <b class="mono">6</b></span><span>Load <b class="mono">62.5</b></span><span>Effort <b class="mono">RIR 3</b></span></div>
      <div class="sh-timer"><span class="mono">1:30</span><small>${AR.rest}</small></div>
      ${ui.btns(ui.btn("Swap", "ghost"), `<span class="ui-btn ui-btn-danger">${AR.pain}</span>`)}
    </div>`,
    control: `${ui.h("Member app", "Appearance")}
      ${ui.row("App icon", `<span class="ui-appicon">LS</span>`, { raw: true })}
      ${ui.row("Colours", `<span class="ui-sw" style="background:#D5F24A"></span><span class="ui-sw" style="background:#171917"></span>`, { raw: true })}
      ${ui.row("Website style", "Set separately")}
      ${ui.label("Approved swaps · Back squat")}
      <div class="ui-tags"><span>Goblet squat</span><span>Leg press</span><span class="is-add">+ Add</span></div>
      ${ui.note("Set corrections keep their history")}`,
    controlTitle: "Settings · Brand",
  },
  "website-and-domain": {
    h1: "Build your coaching website your way",
    lede: "A multipage coaching website in a desktop editor. Drag sections into place, preview every screen, then publish at your coaching address.",
    vignette: () => vignette(`<div class="device window vg-editor" ${img("Sample desktop website editor: a before-and-after section drops into the Home page and the draft saves.")}><div class="window-screen"><div class="window-bar"><span class="window-title">Website editor</span><span class="window-meta mono">${swapPair("Saving…", "Draft saved")}</span></div><div class="window-body">
      <div class="ed">
        <div class="ed-side"><p class="ui-label">Section library</p><p class="ui-sub mono">282 layouts · 40 families</p><ul>${["Hero", "Programmes", "Video", "Before and after", "Pricing", "FAQ", "Contact"].map((x, i) => `<li${i === 3 ? ' class="is-on"' : ""}>${esc(x)}</li>`).join("")}</ul></div>
        <div class="ed-main">
          <div class="ed-tabs mono"><span class="is-on">Home</span><span>Coaching</span><span>Results</span><span>Contact</span></div>
          <div class="ed-block ed-hero"><span></span><span></span>${ui.btn("See coaching")}</div>
          <div class="ed-slot"><div class="ed-block ed-ba vg-drop"><span>Before</span><span>After</span></div></div>
          <div class="ed-foot"><span class="mono">Desktop · Tablet · Phone</span>${ui.btns(ui.btn("Preview", "ghost"), ui.btn("Publish"))}</div>
        </div>
      </div>
    </div></div></div>`, { label: "Sample: a section drops into place", cap: "Sample trainer · scripted · the editor is desktop-only" }),
    sees: `${ui.url(DOMAIN)}<div class="ui pv">
      <span class="pv-logo" aria-hidden="true">LS</span>
      <p class="pv-h">Train with Layla, day by day</p>
      ${ui.btn("See coaching")}
      <div class="pv-ba"><span>Before</span><span>After</span></div>
      <p class="ui-sub mono">Shared with the client’s permission</p>
      ${ui.btn("Contact Layla", "ghost")}
    </div>`,
    control: `${ui.h("Publication history", "Desktop editor")}
      ${ui.row("v3 · Home, Coaching, Contact", "Live")}
      ${ui.row("v2 · 18 Oct", `<span class="ui-btn ui-btn-ghost">Restore to draft</span>`, { raw: true })}
      ${ui.row("Autosave · undo · redo", "On")}
      ${ui.row("Your address", "Reserved")}
      ${ui.row("Your own domain", `${chip("Not on yet", "soon")}`, { raw: true })}
      ${ui.note("Domain price shown before you buy", "dot")}`,
    controlTitle: "Website",
  },
  nutrition: {
    h1: "Nutrition coaching that follows your guidance",
    chips: `${chip("Optional tier", "live")}${chip("Can’t be bought alone", "neutral")}`,
    lede: "A higher-priced workout and nutrition tier. Weekly meal plans, recipes and grocery lists that follow your approach, plus a food diary.",
    vignette: () => vignette(`<div class="vg-pair" ${img("Sample food diary: a meal photo estimate is confirmed by the subscriber, then logged.")}>
      ${phoneFrame(`${appHead()}
        <div class="ui">
          <div class="ui-seg"><span>Plan</span><span>Groceries</span><span class="is-on">Diary</span></div>
          <div class="nu-photo" aria-hidden="true"><span class="nu-plate"></span></div>
          <p class="ui-title">Lunch · photo estimate</p>
          <ul class="ui-plan"><li><span>Grilled chicken</span><span class="mono">≈ 150 g</span></li><li><span>Rice</span><span class="mono">≈ 1 cup</span></li><li><span>Salad</span><span class="mono">≈ 1 bowl</span></li></ul>
          <div class="nu-status">${lanePill("Estimate · tap to confirm", "applied", { to: "Confirmed · logged", from: "neutral" })}</div>
          <p class="ui-sub mono">Nothing is logged until they confirm</p>
        </div>${ui.tabs("Today")}`, { cls: "vg-phone" })}
      <div class="vg-float vg-meals"><p class="ui-title">This week</p><ul>${[["Mon", "Chicken rice bowl"], ["Tue", "Lentil soup, flatbread"], ["Wed", "Salmon, potatoes"], ["Thu", "Leftovers: lentil soup"]].map(([dd, m]) => `<li><span class="mono">${dd}</span><span>${m}</span></li>`).join("")}</ul><p class="ui-sub mono">Grocery list · 18 items</p></div>
    </div>`, { label: "Sample: a meal photo estimate is confirmed" }),
    sees: `${appHead()}<div class="ui">
      ${ui.h("Grocery list", "Week of 20 Oct")}
      <ul class="ui-checks">${["Chicken breast · 600 g", "Brown rice · 1 kg", "Red lentils · 500 g", "Salmon fillets · 2", "Spinach · 1 bag"].map((x, i) => `<li${i < 2 ? ' class="is-on"' : ""}><span class="ui-cb" aria-hidden="true"></span>${esc(x)}</li>`).join("")}</ul>
      ${ui.note("Uses what they already have where possible")}
    </div>`,
    control: `${ui.h("Nutrition · your method", "Optional tier")}
      ${ui.row("Calorie target · sample client", "2,100 kcal")}
      ${ui.row("Method", "Your calorie method")}
      ${ui.row("Recipes", "Your recipes, checked before release")}
      ${ui.label("Exceptions queue")}
      <div class="ui-ex">${lanePill("Outside your rules", "toyou")}<span>Asks for a very low-calorie week</span></div>
      ${ui.note("Can’t be bought alone: workout and nutrition", "dot")}`,
    controlTitle: "Nutrition",
  },
  "voice-coach": {
    h1: "Your voice, running the session",
    chips: `${chip("Add-on", "neutral")}${flagChip("voice", "Live for subscribers", "Not on yet for subscribers")}`,
    lede: "Guided workouts in your verified voice and coaching style. You confirm the style and can withdraw consent at any time.",
    vignette: () => vignette(`<div class="vg-pair" ${img("Sample voice session in the trainer’s voice: the cue moves from the last set to rest, with own-music mode on.")}>
      ${phoneFrame(`${appHead()}
        <div class="ui vo">
          <p class="vo-badge">${icon("dot")}Generated from Layla’s voice</p>
          <p class="ui-sub mono">Lower body A · Back squat</p>
          <div class="vo-cue"><p class="vo-big">${swapPair("Set 4 of 4", "Rest · 90 s")}</p><p class="vo-line">${swapPair("“Last set. Same depth, drive up.”", "“Good. Breathe, then we finish.”")}</p></div>
          <div class="vo-wave" aria-hidden="true">${[6, 12, 18, 9, 14, 20, 11, 7, 16, 10, 5, 13, 19, 8].map((h) => `<i style="--h:${h}"></i>`).join("")}</div>
          <div class="vo-prog"><span class="vo-fill"></span></div>
          <div class="vo-ctl">${ui.btn("Pause", "ghost")}${ui.btn("Tap to talk")}</div>
          ${ui.tog("Own-music mode", true, "Short cues while your music plays")}
        </div>`, { cls: "vg-phone" })}
      <div class="vg-float vg-consent"><p class="ui-title">Your voice</p>${ui.row("Verified", "Yes")}${ui.row("Consent", "Recorded")}${ui.btns(ui.btn("Withdraw", "ghost"))}</div>
    </div>`, { label: "Sample: the voice cue moves to rest" }),
    sees: `${appHead()}<div class="ui">
      ${ui.h("Guided session", "Voice add-on")}
      <p class="ui-q">Your music app keeps playing. Short cues come in between sets.</p>
      ${ui.tog("Own-music mode", true)}
      ${ui.note("Voice generated from Layla’s, with her consent", "dot")}
      <span class="ui-btn ui-btn-danger">${AR.pain}</span>
      <p class="ui-sub mono">Same pause and pain report as every workout</p>
    </div>`,
    control: `${ui.h("Voice · settings", "Add-on")}
      ${ui.tog("Offer voice to subscribers", true)}
      ${ui.row("Add-on price", "Your price, monthly")}
      ${ui.row("Narration style", "Reviewed and confirmed")}
      ${ui.row("Identity", "Verified")}
      ${ui.row("Consent", `<span class="ui-btn ui-btn-ghost">Withdraw</span>`, { raw: true })}
      <p class="hw-chiprow">${chip("Add-on", "neutral")}${flagChip("voice", "Live for subscribers", "Not on yet for subscribers")}</p>`,
    controlTitle: "Voice",
  },
  bookings: {
    h1: "Add paid sessions to your AI coaching",
    lede: "Sell one-to-one sessions next to your AI coaching. Subscribers pay by card in AED, and your cancellation rules decide refunds.",
    vignette: () => vignette(`<div class="vg-pair" ${img("Sample booking screen: a one-to-one session at AED 250 is chosen and reserved.")}>
      ${phoneFrame(`${appHead()}
        <div class="ui">
          ${ui.h("Book a session", "With Layla")}
          <div class="bk-days mono"><span>Mon<b>20</b></span><span class="is-on">Tue<b>21</b></span><span>Wed<b>22</b></span><span>Thu<b>23</b></span></div>
          <ul class="bk-slots">
            <li class="bk-pick"><span><strong>07:00 · One-to-one</strong><small>Gym · 60 min · 1 place</small></span><span class="mono">AED 250</span>${TICK}</li>
            <li><span><strong>18:30 · Small group</strong><small>Park · 45 min · 4 of 8 left</small></span><span class="mono">Free</span></li>
          </ul>
          <p class="ui-sub">Free cancellation up to 24 hours before.</p>
          <div class="bk-btn">${swapPair("Book · AED 250", "Reserved · reminder the day before")}</div>
        </div>`, { cls: "vg-phone" })}
    </div>`, { label: "Sample: a session is reserved" }),
    sees: `${appHead()}<div class="ui">
      ${ui.h("Your bookings", "Upcoming")}
      <div class="bk-card"><strong>Tue 21 Oct · 07:00</strong><span>One-to-one with Layla · Gym</span><span class="mono">Paid · AED 250</span></div>
      ${ui.note("Reminder the day before")}
      ${ui.row("Cancel with refund", "Until Mon 07:00")}
      ${ui.btns(ui.btn("Add to calendar", "ghost"), ui.btn("Cancel", "ghost"))}
    </div>`,
    control: `${ui.h("Sessions", "This week")}
      <div class="ui-table bk-table"><div class="ui-tr ui-th"><span>Slot</span><span>Places</span><span>Price</span><span></span></div>
        <div class="ui-tr"><span>Mon 18:30 · group</span><span class="mono">6 / 8</span><span class="mono">Free</span><span></span></div>
        <div class="ui-tr"><span>Tue 07:00 · 1:1</span><span class="mono">1 / 1</span><span class="mono">AED 250</span><span></span></div>
        <div class="ui-tr"><span>Thu 07:00 · 1:1</span><span class="mono">0 / 1</span><span class="mono">AED 250</span><span></span></div></div>
      ${ui.row("Cancellation window", "24 h")}
      ${ui.row("Attendance", "Attended · No-show")}
      ${ui.btns(ui.btn("Add slot"), ui.btn("Export calendar", "ghost"))}`,
    controlTitle: "Bookings",
  },
  "chat-and-digital-coach": {
    h1: "Stay close without answering every message",
    lede: "Private chat with you, plus a clearly labelled digital coach that answers from your teaching. Anything outside your rules comes to you.",
    vignette: () => vignette(`<div class="vg-pair" ${img("Sample chat: the labelled digital coach answers a swap question, then the trainer takes over personally.")}>
      ${phoneFrame(`${appHead()}
        <div class="app-chat ch">
          <p class="bubble bubble-out">Can I swap squats for leg press today?</p>
          <div class="ch-in"><span class="ch-label">Digital coach</span><p class="bubble bubble-in">Yes. Leg press 3 × 10 is one of Layla’s approved swaps.</p></div>
          <p class="bubble bubble-out ch-att">Photo · form-check.jpg</p>
          <p class="ch-take vg-in" style="--vd:600ms">Layla is answering you personally for now.</p>
          <div class="ch-in vg-in" style="--vd:1000ms"><span class="ch-label ch-you">Layla</span><p class="bubble bubble-in">Nice depth. Keep the bar a little lower on your back.</p></div>
        </div>${ui.tabs("Chat")}`, { cls: "vg-phone" })}
      <div class="vg-float vg-takeover"><p class="ui-title">Sample subscriber</p><p class="ui-sub mono">${swapPair("Digital coach on", "You took over · digital coach paused")}</p>${ui.btns(`<span class="ui-btn mi-press">Take over</span>`)}</div>
    </div>`, { label: "Sample: you take over a conversation" }),
    sees: `${appHead()}<div class="app-chat">
      <div class="ch-in"><span class="ch-label">Digital coach</span><p class="bubble bubble-in">Your Thursday session moved to Friday. Saturday stays rest.</p></div>
      <div class="ch-in"><span class="ch-label ch-you">Layla · personal</span><p class="bubble bubble-in">How did the new warm-up feel?</p></div>
      <p class="app-meta mono">Scheduled check-in · Sun 18:00</p>
    </div>${ui.tabs("Chat")}`,
    control: `${ui.h("Conversations", "Inbox")}
      ${ui.row("Sample subscriber 1", "Digital coach")}
      ${ui.row("Sample subscriber 2", "You · took over")}
      ${ui.label("The digital coach may answer")}
      ${ui.tog("Plan and schedule questions", true)}
      ${ui.tog("Approved swaps", true)}
      ${ui.tog("Anything else", false, "Comes to you")}
      ${ui.btns(ui.btn("Hand back", "ghost"))}`,
    controlTitle: "Chat",
  },
  "progress-and-client-twin": {
    h1: "Every subscriber’s progress and context in one view",
    lede: "What a subscriber told you, logged and chose to share, each with its date and source. Unknowns stay unknown.",
    vignette: () => vignette(`<div class="device window vg-twin" ${img("Sample Client Twin: each field shows its date and source; an Apple Health import fills the steps field while sleep stays unknown.")}><div class="window-screen"><div class="window-bar"><span class="window-title">Client Twin · sample subscriber</span><span class="window-meta mono">Shared with permission</span></div><div class="window-body">
      <div class="tw">${[
        ["Goal", "Squat bodyweight by spring", "Intake · 12 Oct"],
        ["Schedule", "4 days a week, mornings", "Intake · 12 Oct"],
        ["Equipment", "Full gym", "Edited by subscriber · 15 Oct"],
        ["Injuries", "None reported", "Intake · 12 Oct"],
        ["Squat best", "62.5 kg × 6", "Logged · 21 Oct"],
      ].map(([k, v, s]) => `<div class="tw-row"><span class="tw-k">${k}</span><span class="tw-v">${v}</span><span class="tw-s mono">${s}</span></div>`).join("")}
        <div class="tw-row tw-new"><span class="tw-k">Steps</span><span class="tw-v">${swapPair("unknown", "8,400 a day")}</span><span class="tw-s mono">${swapPair("Not shared", "Apple Health export · 22 Oct")}</span></div>
        <div class="tw-row"><span class="tw-k">Sleep</span><span class="tw-v tw-unknown">unknown</span><span class="tw-s mono">WHOOP · not on yet</span></div>
      </div>
    </div></div></div>`, { label: "Sample: an Apple Health import fills one field" }),
    sees: `${appHead()}<div class="ui">
      ${ui.h("Your progress", "Last 8 weeks")}
      <div class="pg-bars" aria-hidden="true">${[0.35, 0.42, 0.5, 0.48, 0.6, 0.66, 0.72, 0.8].map((v) => `<i style="--v:${v}"></i>`).join("")}</div>
      <p class="ui-sub mono">Training volume per week</p>
      ${ui.row("Completed sessions", "18")}
      ${ui.row("Back squat best", "62.5 kg")}
      ${ui.row("Romanian deadlift best", "50 kg")}
    </div>${ui.tabs("Progress")}`,
    control: `${ui.h("Wearable policy", "Your choice")}
      ${ui.row("Apple Health export", "Import on")}
      ${ui.row("WHOOP", chip("Not on yet", "soon"), { raw: true })}
      ${ui.row("Amazfit / Zepp", chip("Not on yet", "soon"), { raw: true })}
      ${ui.tog("Your AI may use shared data", true, "Only within the subscriber’s consent")}
      ${ui.note("Unknown fields are never guessed", "dot")}`,
    controlTitle: "Progress",
  },
  "payments-and-payouts": {
    h1: "Monthly AED payouts to your UAE bank",
    lede: "Subscribers pay by card in AED. You set the price and billing, and payouts reach your verified UAE bank account monthly.",
    vignette: () => vignette(`<div class="device window vg-stmt" ${img("Sample monthly statement for 150 subscribers at AED 199, with the payout status moving from reconciling to scheduled.")}><div class="window-screen"><div class="window-bar"><span class="window-title">Statement · sample month</span><span class="window-meta mono">AED</span></div><div class="window-body">
      ${sampleStatement()}
      <div class="pay-row"><span>Payout · verified UAE bank</span>${lanePill("Reconciling", "applied", { to: "Scheduled for the 1st", from: "neutral" })}</div>
    </div></div></div>`, { label: "Sample: the payout is scheduled", cap: "Sample statement · scripted · payments not on yet" }),
    sees: `${appHead()}<div class="ui">
      ${ui.h("Workout plan", "Checkout preview")}
      <p class="pv-price"><span class="mono">AED 199</span><small>a month</small></p>
      ${ui.row("Renews", "Monthly")}
      ${ui.row("Stop renewal", "Any time")}
      ${ui.btn("Pay by card")}
      ${ui.row("Receipts and refunds", "In your account")}
    </div>`,
    control: `${ui.h("Offer · billing", "Workout plan")}
      <div class="hw-offer"><div>${ui.label("Price")}${ui.input("199", "AED")}</div><div>${ui.label("Billing")}<div class="ui-seg"><span class="is-on">Monthly</span><span>Upfront</span></div></div></div>
      ${ui.row("Free trial", "Optional")}
      ${ui.row("Promotion codes", "Optional")}
      <div class="ui-ex">${lanePill("Refund requested", "toyou")}${ui.btns(ui.btn("Approve", "ghost"), ui.btn("Decline", "ghost"))}</div>`,
    controlTitle: "Payments",
  },
  safety: {
    h1: "Safety rules your AI cannot override",
    lede: "Pain, medical issues and red flags pause the workout and come to you, by rules enforced in code, outside the AI.",
    vignette: () => `<figure class="vg vg-safety" data-vignette data-state="start">
      ${stage(`<div class="vg-pair">
        ${phoneFrame(`${appHead()}
          <div class="ui">
            <p class="ui-sub mono">Back squat · set 3 of 4</p>
            <div class="ui-table mini-sets"><div class="ui-tr"><span>1</span><span class="mono">62.5 kg</span><span class="mono">6 reps</span>${icon("check")}</div><div class="ui-tr"><span>2</span><span class="mono">62.5 kg</span><span class="mono">6 reps</span>${icon("check")}</div></div>
            <button type="button" class="ui-b sf-pain mi-press" data-pain>${icon("plus")}Report pain</button>
            <div class="sf-paused vg-in" style="--vd:600ms"><p>${icon("minus")}Workout paused. Your coach has been told.</p></div>
          </div>`, { cls: "vg-phone" })}
        <div class="vg-float vg-alert vg-in" style="--vd:1000ms" aria-hidden="true"><p class="ui-title">${icon("lock")}Safety hold</p><p class="ui-sub mono">Knee pain · back squat · now</p>${ui.btns(ui.btn("Review"))}</div>
      </div>`, "vg-stage")}
      <figcaption>${vgCap("Sample subscriber · scripted · tap Report pain")}<p class="sr-only" aria-live="polite" data-live></p></figcaption>
    </figure>`,
    sees: `${appHead()}<div class="ui">
      <div class="sf-paused sf-static"><p>${icon("minus")}Workout paused. Your coach has been told.</p></div>
      ${ui.h("Your trainer will review it")}
      <p class="ui-q">You’ll get Layla’s decision by chat and notification.</p>
      ${ui.note("This is coaching, not medical advice.", "dot")}
    </div>`,
    control: `${ui.h("Safety review", "1 item")}
      <div class="ui-ex">${lanePill("Safety hold", "paused")}<span>Knee pain during back squat</span></div>
      ${ui.btns(ui.btn("Resume"), ui.btn("Change plan", "ghost"), ui.btn("Keep paused", "ghost"))}
      ${ui.label("Your red flags")}
      <div class="ui-tags"><span>dizzy</span><span>chest</span><span class="is-add">+ Add</span></div>
      ${ui.row("Safety rules", `${icon("lock")}Can’t be removed`, { raw: true })}`,
    controlTitle: "Safety",
  },
  team: {
    h1: "Bring your team",
    lede: "Invite staff coaches and finance members with restricted roles. You keep ownership of the brand and your AI.",
    vignette: () => {
      const roles = ["Owner", "Staff coach", "Finance"];
      const areas = ["Your AI", "Subscribers and chat", "Review queue", "Earnings and payouts", "Website and app design", "Team and ownership"];
      const can = [[1, 1, 1, 1, 1, 1], [1, 1, 1, 0, 0, 0], [0, 0, 0, 1, 0, 0]];
      const tabs = roles.map((r, i) => `<button type="button" role="tab" id="rl-t${i}" aria-controls="rl-p${i}" aria-selected="${i === 1}" tabindex="${i === 1 ? 0 : -1}">${esc(r)}</button>`).join("");
      const panels = roles.map((r, i) => `<div role="tabpanel" id="rl-p${i}" aria-labelledby="rl-t${i}" tabindex="0" class="rl-panel"${i === 1 ? "" : " hidden"}><ul class="rl-list">${areas.map((a, k) => `<li class="${can[i][k] ? "is-yes" : "is-no"}" style="--i:${k}">${icon(can[i][k] ? "check" : "lock")}<span>${esc(a)}</span><span class="sr-only">${can[i][k] ? ": can open" : ": cannot open"}</span></li>`).join("")}</ul></div>`).join("");
      return `<figure class="vg vg-team">
        ${stage(`<div class="device window"><div class="window-screen"><div class="window-bar"><span class="window-title">Team · roles</span><span class="window-meta mono">Sample</span></div><div class="window-body">
          <div data-tabs class="rl"><div class="ptabs rl-tabs" role="tablist" aria-label="Role" style="--n:3">${tabs}<span class="tab-ink" aria-hidden="true"></span></div>${panels}</div>
        </div></div></div>`, "vg-stage")}
        <figcaption class="vg-cap">${sampleLabel("Sample workspace · choose a role")}</figcaption>
      </figure>`;
    },
    sees: `${appHead()}<div class="app-chat">
      <div class="ch-in"><span class="ch-label ch-you">Layla Strength · staff coach</span><p class="bubble bubble-in">Great session. I’ve noted the knee for Layla.</p></div>
      <div class="ch-in"><span class="ch-label">Digital coach</span><p class="bubble bubble-in">Tomorrow is a rest day.</p></div>
      <p class="app-meta mono">One brand, whichever coach replies</p>
    </div>${ui.tabs("Chat")}`,
    control: `${ui.h("Team", "3 people")}
      ${ui.row("You", "Owner")}
      ${ui.row("Staff coach", "Active")}
      ${ui.row("Finance", "Invited")}
      ${ui.label("Invite by email")}
      <div class="ui-input"><span class="mono">name@email.com</span></div>
      ${ui.note("Role changes and removals are recorded")}`,
    controlTitle: "Team",
  },
};

function featurePage(slug) {
  return (ctx) => {
    const page = ctx.page;
    const f = FEATURE[slug];
    const sec = (id) => S(page, id);
    const does = sec("does"), subs = sec("subscriber"), ctl = sec("control");
    const extra = (page.sections || []).filter((s) => !["does", "subscriber", "control"].includes(s.id));
    const status = f.chips ?? offeringChip(page);
    const H2 = { "What happens when a subscriber reports pain": "When a subscriber reports pain", "How a plan runs, week by week": "How a plan runs each week" };
    const heading = (s) => H2[s.heading] ?? tx(s.heading);
    const runs = extra.filter((s) => s.steps);
    const tables = extra.filter((s) => s.table);
    const notes = extra.filter((s) => !s.steps && !s.table);

    const heroHtml = hero({
      kicker: `Feature · ${page.navLabel}`,
      h1: f.h1,
      chips: status,
      lede: f.lede,
      media: f.vignette(),
      secondary: ["/features", "All features"],
      cls: "fd-hero",
    });

    const doesBand = band(
      { tone: "paper", cls: "does-band", label: "does-h" },
      `<div class="split does-split">
  <div class="s-copy" data-reveal><p class="kicker">${esc(page.navLabel)}</p>${h2("does-h", tx(does.heading))}</div>
  <ol class="s-media does" data-reveal="stagger">${does.bullets.map((b, i) => `<li class="ri"><span class="does-n mono">${String(i + 1).padStart(2, "0")}</span><span>${esc(tx(b))}</span></li>`).join("")}</ol>
</div>`,
    );

    const side = (kind, id, title, bullets, device) => `<div class="side side-${kind}" data-reveal>
  <p class="kicker">${kind === "sub" ? "Your subscriber" : "You"}</p>
  ${h2(id, title)}
  <ul class="check-list-p">${bullets.map((b) => `<li>${icon("check")}<span>${esc(tx(b))}</span></li>`).join("")}</ul>
  <div class="side-stage dots">${device}</div>
</div>`;
    const sidesBand = band(
      { tone: "white", cls: "sides-band", label: "sees-h" },
      `<div class="sides">
  ${side("sub", "sees-h", tx(subs.heading), subs.bullets, phoneFrame(f.sees, { cls: "side-phone", label: `Sample subscriber screen: ${tx(subs.heading).toLowerCase()}` }))}
  ${side("you", "ctl-h", tx(ctl.heading), ctl.bullets, `<div ${img(`Sample trainer screen: ${tx(ctl.heading).toLowerCase()}`)}>${windowFrame(f.control, { title: f.controlTitle, meta: "Sample", cls: "side-win" })}</div>`)}
</div>`,
    );

    const tones = ["paper", "white", "paper", "white"];
    let tk = 0;
    const runsBand = runs.length || tables.length
      ? band(
        { tone: tones[tk++], cls: "runs-band", label: "runs-h" },
        `${tables.map((s, k) => `<div class="runs-table${k ? " mt-l" : ""}" data-reveal>${h2(k ? `runs-t${k}` : "runs-h", heading(s))}<div class="mt-m">${dataTable({ caption: s.table.caption, columns: s.table.columns, rows: s.table.rows.map((r) => r.map(tx)) })}</div></div>`).join("")}
${runs.map((s, k) => `<div class="${tables.length || k ? "mt-l" : ""}">${sectionHead({ kicker: "How it runs", title: heading(s), id: !tables.length && !k ? "runs-h" : `runs-s${k}` })}
<ol class="runs" data-reveal="stagger" style="--cols:${Math.min(s.steps.length, 6)}">${s.steps.map((st, i) => `<li class="ri"><span class="runs-n mono">${String(i + 1).padStart(2, "0")}</span><h3>${esc(tx(st.title))}</h3><p>${esc(tx(st.body))}</p></li>`).join("")}</ol></div>`).join("")}`,
      )
      : "";

    const notesBand = notes.length
      ? band(
        { tone: tones[tk++], cls: "notes-band", label: "notes-h0" },
        `<div class="notes-grid">${notes.map((s, k) => `<div class="note-col" data-reveal>${h2(`notes-h${k}`, heading(s))}${s.bullets ? `<ul class="check-list-p mt-m">${s.bullets.map((b) => `<li>${icon("check")}<span>${esc(tx(b))}</span></li>`).join("")}</ul>` : ""}${(s.body || []).map((p) => `<p class="body-l mt-m">${esc(tx(p))}</p>`).join("")}${slug === "progress-and-client-twin" && s.id === "consent" ? `<p class="hero-chips">${chip("Apple Health · import", "live")}${chip("WHOOP · Not on yet", "soon")}${chip("Zepp · Not on yet", "soon")}</p>` : ""}</div>`).join("")}</div>`,
      )
      : "";

    const RENAME = {
      "Is the AI trained on my data?": "Is my AI trained on my data?",
      "Does the Brain explain its changes?": "Does my AI explain its changes?",
      "Does the AI decide whether pain is serious?": "Does my AI decide whether pain is serious?",
      "Who owns the brand and the Brain?": "Who owns the brand and my AI?",
      "How does the AI starter work?": "How do AI starter sites work?",
    };
    const faqs = fixA(faqsOf(page.path, RENAME)).slice(0, 5);
    return {
      main: [heroHtml, doesBand, sidesBand, runsBand, notesBand, faqBand({ id: "ffq", title: "Questions", faqs, prefix: "fdq", related: page.related || [], tone: tones[tk] })].filter(Boolean).join("\n"),
      closing: { secondary: { label: "Back to all features", path: "/features" } },
    };
  };
}

/* ================================================================ DEMO */

/** Insert html after an anchor that must exist (fails the build loudly if the console markup changes). */
function inject(html, anchor, add, { before = false } = {}) {
  if (!html.includes(anchor)) throw new Error(`[product] console anchor not found: ${anchor}`);
  return html.replace(anchor, before ? add + anchor : anchor + add);
}

const SCENARIOS = [
  {
    key: "easy", tab: "Squats felt easy", out: "Applied", tone: "applied",
    console: {},
    why: "Your rule: after two easy sessions at 3+ reps in reserve, add 2.5 kg. Applied, with the reason logged.",
  },
  {
    key: "missed", tab: "Missed yesterday", out: "Rescheduled", tone: "applied",
    console: {
      message: "I missed yesterday. Should I do two sessions today?",
      ruleSource: "Your rule · from quiz, Q4",
      rule: "missed → next free day, never stack",
      confidence: 91, laneTo: "Rescheduled automatically", day: "This week",
      rows: [
        { name: "Lower body B", sets: "45 min", from: "Wed", to: "Thu" },
        { name: "Rest day", sets: "—", from: "Thu", to: "Fri" },
        { name: "Upper body A", sets: "40 min", from: "Sat" },
      ],
      outcome: ["Lower body B", "Wed", "Thu"],
    },
    why: "Your rule: never stack two sessions. The missed one moves to Thursday, and Friday becomes a rest day.",
  },
  {
    key: "hotel", tab: "Hotel gym", out: "To you", tone: "toyou",
    console: {
      message: "Travelling two weeks, hotel gym only. Can you rebuild my plan?",
      ruleSource: "No rule you taught covers this",
      rule: "hotel gym · dumbbells to 20 kg → ?",
      confidence: 54, laneTo: "Handed to you", tone: "toyou", day: "Next 2 weeks",
      rows: [
        { name: "Back squat", sets: "4 × 6", from: "62.5 kg", to: "Draft" },
        { name: "Leg press", sets: "3 × 10", from: "120 kg", to: "Draft" },
        { name: "Lunge", sets: "3 × 10", from: "16 kg" },
      ],
      outcome: ["Plan · 2 weeks", "Unchanged", "Draft for you"],
    },
    reply: "Layla will answer this personally. You will see the reply here.",
    why: "Nothing you taught covers this equipment, so it’s below your bar. A draft comes to you, and the subscriber is told you’ll confirm.",
  },
  {
    key: "pain", tab: "Knee hurts", out: "Paused", tone: "paused",
    console: {
      message: "My knee hurts when I squat today.",
      ruleSource: "Safety rule · enforced in code",
      rule: "pain → pause workout, alert trainer",
      laneTo: "Workout paused, sent to you", tone: "paused", day: "Today · Lower body",
      rows: [
        { name: "Back squat", sets: "4 × 6", from: "Ready", to: "Paused" },
        { name: "Leg press", sets: "3 × 10", from: "Ready", to: "Paused" },
        { name: "Lunge", sets: "3 × 10", from: "Ready", to: "Paused" },
      ],
      outcome: ["Today’s workout", "Planned", "Paused"],
    },
    safety: true,
    reply: "Workout paused. Your coach has been told.",
    why: "Pain is a safety rule enforced in code, outside the AI. The workout pauses and you are alerted. No score is involved.",
  },
];

/** One scenario's console: decisionConsole() plus the scripted extras (reply bubble, typing dots, safety note). */
function demoConsole(s, i) {
  let html = decisionConsole({ id: `demo-c${i + 1}`, autoplay: i === 0, caption: "Sample trainer · scripted · no AI model called", cls: `dm-${s.tone}`, ...s.console });
  const dots = `<p class="bubble bubble-in demo-typing" aria-hidden="true"><i></i><i></i><i></i></p>`;
  const reply = s.reply ? `<p class="bubble bubble-in demo-reply">${esc(s.reply)}</p>` : "";
  html = inject(html, `<p class="app-meta mono">Read 18:40</p>`, `<div class="demo-slot">${dots}${reply}</div>`);
  if (s.safety) {
    html = html.replace(/<div class="conf"[\s\S]*?<\/p>\s*<\/div>/, `<div class="conf conf-lock"><div class="conf-row"><span>How sure it is</span><span class="mono conf-val">Not scored</span></div><p class="conf-safety">${icon("lock")}<span>Safety rules skip the score. No setting switches them off.</span></p></div>`);
    if (!html.includes("conf-lock")) throw new Error("[product] safety conf block not replaced");
  }
  return html;
}

function demoHero() {
  const tabs = SCENARIOS.map((s, i) => `<button type="button" role="tab" id="dm-t${i}" aria-controls="dm-p${i}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" data-scenario="${s.key}"><span class="dm-q">${esc(s.tab)}</span><span class="dm-out" data-tone="${s.tone}"><span class="lane-dot" aria-hidden="true"></span>${esc(s.out)}</span></button>`).join("");
  const panels = SCENARIOS.map((s, i) => `<div class="dm-panel" role="tabpanel" id="dm-p${i}" aria-labelledby="dm-t${i}"${i ? " hidden" : ""}>
  ${demoConsole(s, i)}
  <p class="dm-why"><span class="dm-why-k mono">Why</span><span>${esc(s.why)}</span></p>
</div>`).join("");
  return `<section class="band band-white hero demo-hero" data-hero aria-labelledby="hero-h">
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <p class="kicker">Interactive demo</p>
      <h1 id="hero-h">${esc(budget("h1", "See your AI make a coaching decision"))}</h1>
      <p class="lede">${esc(budget("lede", "Pick a subscriber message. Watch your AI apply your rule, hand it to you, or pause the workout."))}</p>
      <p class="demo-honest">${icon("dot")}<span>Scripted examples. No AI model is called.</span></p>
      <div class="cta-row hero-ctas">${cta({ location: "hero", size: "lg" })}${button("/how-it-works", "See how it works", { location: "hero", size: "lg" })}</div>
      ${ctaMicro()}
    </div>
    <div class="hero-media">
      <div class="dm" data-tabs data-demo>
        <div class="dm-tabs" role="tablist" aria-label="Four decisions" style="--n:4">${tabs}<span class="tab-ink" aria-hidden="true"></span></div>
        <div class="dm-panels">${panels}</div>
        <p class="sr-only" aria-live="polite" data-live></p>
      </div>
    </div>
  </div>
  <div class="wrap"><p class="note dm-note">${esc(S(P("/demo"), "scenarios").note)}</p></div>
</section>`;
}

function demoRule() {
  return band(
    { tone: "paper", id: "rule", cls: "dm-rule-band", label: "dm-rule-h" },
    `<div class="split dm-rule-split">
  <div class="s-copy" data-reveal>
    <p class="kicker">Your rule</p>
    ${h2("dm-rule-h", "Change the rule")}
    <p class="sec-lede mt-s">Edit the sample rule. The outcome recomputes the same way every time.</p>
    <ul class="dm-tries">
      <li><span class="mono">Try</span>3 sessions: not yet, one more easy session.</li>
      <li><span class="mono">Try</span>4+ reps in reserve: not yet, effort too high.</li>
      <li><span class="mono">Try</span>5 kg: a bigger jump, still applied.</li>
    </ul>
  </div>
  <div class="s-media" data-reveal>${ruleBuilder({ id: "demo-rule", rir: true })}<p class="mt-s">${sampleLabel("Sample trainer · scripted · no AI model called")}</p></div>
</div>`,
  );
}

function demoThreshold() {
  return band(
    { tone: "white", id: "threshold", cls: "dm-th-band", label: "dm-th-h" },
    `<div class="split dm-th-split">
  <div class="s-copy" data-reveal>
    <p class="kicker">Your bar</p>
    ${h2("dm-th-h", "How sure must it be?")}
    <p class="sec-lede mt-s">You set the bar. Below it, decisions come to you. Drag past 86% and the sample decision moves to you.</p>
  </div>
  <div class="s-media" data-reveal>
    ${windowFrame(`<div class="th-viz" style="--t:.8">
        <p class="th-case"><span>“Squats felt easy” → +2.5 kg</span><span class="mono">86% sure</span></p>
        <div class="th-track" aria-hidden="true"><span class="th-fill"></span><span class="th-rail"><span class="th-mark"><span class="mono">Your bar</span></span></span></div>
      </div>
      ${thresholdSlider({ id: "demo-th", confidence: 86, value: 80 })}`, { title: "Your settings · Automatic changes", meta: "Sample", cls: "th-window" })}
  </div>
</div>`,
  );
}

function demoNext() {
  const steps = [
    ["Setup", "Teach your real rules", "About 6 minutes for the first ones."],
    ["Waits for me", "Every reply comes to you", "Nothing reaches a subscriber without you."],
    ["Your choice", "Automatic for routine changes", "After 20 cases and passing checks."],
  ];
  return band(
    { tone: "paper", cls: "dm-next-band", label: "dm-next-h" },
    `<div class="split">
  <div class="s-copy" data-reveal>
    <p class="kicker">After you join</p>
    ${h2("dm-next-h", "What happens in your account")}
    <p class="sec-lede mt-s">You’ll teach your real rules in setup. Every reply waits for you until you choose otherwise.</p>
    <div class="cta-row mt-m">${cta({ location: "inline" })}</div>
    ${ctaMicro({ short: true })}
  </div>
  <ol class="s-media dm-next" data-reveal="stagger">${steps.map(([k, t, d], i) => `<li class="ri"><span class="dm-next-k mono">${String(i + 1).padStart(2, "0")} · ${esc(k)}</span><h3>${esc(t)}</h3><p>${esc(d)}</p></li>`).join("")}</ol>
</div>`,
  );
}

function demo() {
  const page = P("/demo");
  const f = (q) => page.faqs.find((x) => x.q === q);
  const faqs = [
    { id: "test", q: "Can I test my AI before launch?", a: "Yes. You write test cases with the answer you expect, and your AI is checked against them before a version can be published." },
    { id: "real", q: "Is this a real AI response?", a: "No. These scripted examples show how decisions flow. Your real AI uses your own confirmed rules and a tested release." },
    { id: "bar", q: "Who decides how sure it must be?", a: tx(f("Who decides the confidence threshold?").a) },
    { id: "pain", ...f("What happens when a subscriber reports pain?") },
  ];
  return {
    main: [demoHero(), demoRule(), demoThreshold(), demoNext(), faqBand({ id: "dfaq", title: "Demo questions", faqs, prefix: "dmq", related: ["/trainer-brain", "/features/safety", "/how-it-works"] })].join("\n"),
    closing: { secondary: { label: "See how it works", path: "/how-it-works" } },
  };
}

/* ============================================================ SECURITY */

function accessLog() {
  const rows = [
    { t: "09:14:02", e: "Operator signs in", d: "Separate admin tool · role-based access", ic: "check" },
    { t: "09:14:03", e: "Fresh authenticator check", d: "Applies when authenticator enforcement is switched on", ic: "lock", cond: true },
    { t: "09:14:20", e: "Opens a workspace record", d: "Workspace · Layla Strength", ic: "check" },
    { t: "09:14:20", e: "Logged", d: "Who, what and when, kept in the audit log", ic: "check", done: true },
  ];
  return `<figure class="alog" aria-labelledby="alog-cap">
  ${stage(`<div class="device window alog-win"><div class="window-screen"><div class="window-bar"><span class="window-title">Audit log · Operator access</span><span class="window-meta mono">Sample</span></div><div class="window-body">
    <ol class="alog-list">${rows.map((r) => `<li class="${r.cond ? "is-cond" : ""}${r.done ? " is-done" : ""}"><span class="alog-dot" aria-hidden="true">${icon(r.ic)}</span><span class="alog-t mono">${r.t}</span><span class="alog-e"><strong>${esc(r.e)}</strong><small>${esc(r.d)}</small></span>${r.cond ? `<span class="chip chip-neutral alog-chip">When enforcement is on</span>` : ""}</li>`).join("")}</ol>
    <p class="alog-foot mono">Every operator access is audited</p>
  </div></div></div>`, "alog-stage")}
  <figcaption id="alog-cap" class="alog-cap">${sampleLabel("Sample log · illustrative timestamps")}</figcaption>
</figure>`;
}

function secFacts() {
  const facts = [
    { t: "Sign-in", d: "Passkeys, authenticator apps, one-time recovery codes and a list of signed-in devices.", ui: `<div class="sf-tags mono"><span>${icon("check")}Passkey</span><span>${icon("check")}Authenticator</span><span>${icon("check")}Recovery codes</span></div>` },
    { t: "Workspace isolation", d: "Every workspace is separated at the database layer. Other trainers never see yours.", ui: `<div class="sf-iso"><span>Your workspace</span><i aria-hidden="true"></i><span>Another trainer</span></div>` },
    { t: "Keys, logs and HTTPS", d: "Provider keys encrypted at rest. Sensitive actions logged. Every page served over HTTPS.", ui: `<div class="sf-key mono"><span>provider key</span><span>•••• •••• ••••</span><span class="sf-ok">${icon("lock")}encrypted at rest</span></div>` },
    { t: "Consent", d: "Separate choices for coaching data, marketing and analytics. Export and deletion for everyone.", ui: `<div class="sf-cons">${ui.tog("Coaching data", true)}${ui.tog("Marketing", false)}${ui.tog("Analytics", false)}</div>` },
    { t: "AI disclosure", d: "Subscribers accept a digital coaching disclosure when they join. Digital guidance is always labelled.", ui: `<div class="ch-in sf-ai"><span class="ch-label">Digital coach</span><p class="bubble bubble-in">Thursday moves to Friday.</p></div>` },
    { t: "Payments", d: "Stripe holds card data. Payouts go only to a verified UAE IBAN, with a short hold after changes.", ui: `<div class="sf-pay mono"><span>Card data · held by Stripe</span><span>Payout · verified UAE IBAN</span></div>`, chip: flagChip("payments", "Live", "Not on yet") },
  ];
  return band(
    { tone: "paper", cls: "sec-facts-band", label: "facts-h" },
    `${sectionHead({ kicker: "Six protections", title: "What protects your workspace", id: "facts-h", layout: "split", lede: "Plain facts about how trainsyou is built today, with the conditions stated." })}
<ul class="sfacts" data-reveal="stagger">${facts.map((f) => `<li class="sfact ri"><div class="sfact-ui" aria-hidden="true">${f.ui}</div><h3>${esc(f.t)} ${f.chip || ""}</h3><p>${esc(budget("card", f.d, f.t))}</p></li>`).join("")}</ul>`,
  );
}

function secOperators() {
  const cols = ["Coaching data", "Finance", "Your AI"];
  const rows = [
    ["You (owner)", [1, 1, 1]],
    ["Staff coach", [1, 0, 1]],
    ["Finance member", [0, 1, 0]],
    ["Another trainer", [0, 0, 0]],
  ];
  const cell = (v) => (v ? `<span class="acc acc-yes">${icon("check")}<span>Can open</span></span>` : `<span class="acc acc-no">${icon("x")}<span>Cannot</span></span>`);
  return band(
    { tone: "white", cls: "sec-op-band", label: "op-h" },
    `<div class="split sec-op-split">
  <div class="s-copy" data-reveal>
    <p class="kicker">Operator access</p>
    ${h2("op-h", "Every operator access, audited")}
    <p class="sec-lede mt-s">Every operator access is audited. A fresh authenticator check applies when authenticator enforcement is switched on.</p>
    <p class="mt-s body-l">${esc(tx(S(P("/security-and-privacy"), "operators").body[0]).replace(" Fresh authenticator checks apply only when authenticator enforcement is enabled.", ""))}</p>
  </div>
  <div class="s-media" data-reveal>
    <div class="table-wrap"><table class="table acc-table"><caption>Who can open what in your workspace</caption>
      <thead><tr><th scope="col">Who</th>${cols.map((c) => `<th scope="col">${esc(c)}</th>`).join("")}</tr></thead>
      <tbody>${rows.map(([who, v]) => `<tr><th scope="row">${esc(who)}</th>${v.map((x) => `<td>${cell(x)}</td>`).join("")}</tr>`).join("")}
        <tr class="acc-op"><th scope="row">Platform operator</th><td colspan="3"><span class="acc acc-audit">${icon("lock")}<span>Separate tools, role-based, every action audited</span></span></td></tr>
      </tbody></table></div>
  </div>
</div>`,
  );
}

function secMethod() {
  const yours = ["Your AI · rules, cases, tests", "Subscribers and their data", "Your voice · with your consent"];
  const theirs = ["Their AI", "Their subscribers", "Their voice"];
  return band(
    { tone: "paper", cls: "sec-iso-band", label: "iso-h" },
    `<div class="split sec-iso-split">
  <div class="s-copy" data-reveal>
    <p class="kicker">Your method and voice</p>
    ${h2("iso-h", "Your method and voice stay yours")}
    <p class="sec-lede mt-s">Your teaching is never used for another trainer. Your voice is used only with consent you can withdraw.</p>
    <p class="mt-s">${textLink("/trainer-brain", "How your AI is built")}</p>
  </div>
  <div class="s-media" data-reveal>
    <figure class="iso" aria-labelledby="iso-cap">
      <div class="iso-row">
        <div class="iso-ws iso-you"><p class="iso-h">Your workspace</p><ul>${yours.map((x) => `<li>${icon("check")}${esc(x)}</li>`).join("")}</ul></div>
        <div class="iso-wall" aria-hidden="true"><span class="iso-lock">${icon("lock")}</span><span class="iso-x">${icon("x")}</span></div>
        <div class="iso-ws iso-them"><p class="iso-h">Another trainer’s workspace</p><ul>${theirs.map((x) => `<li>${icon("minus")}${esc(x)}</li>`).join("")}</ul></div>
      </div>
      <figcaption id="iso-cap" class="iso-cap"><span class="mono">Isolated at the database layer</span><span>Nothing crosses between workspaces.</span></figcaption>
    </figure>
  </div>
</div>`,
  );
}

function secCaveats() {
  const items = [
    "Some protections depend on how the platform is set up. A fresh authenticator check applies only when enforcement is switched on.",
    "Authenticator apps and passkeys are available, but not every setup requires them.",
    "Provider keys are encrypted at rest. We don’t claim that everything is.",
    "We make no certification claims.",
  ];
  return band(
    { tone: "white", cls: "sec-cav-band", label: "cav-h" },
    `<div class="split">
  <div class="s-copy" data-reveal><p class="kicker">Plain language</p>${h2("cav-h", "What we don’t claim")}<p class="sec-lede mt-s">Where a protection has a condition, we say so.</p></div>
  <div class="s-media" data-reveal><ul class="caveats">${items.map((x) => `<li>${icon("minus")}<span>${esc(x)}</span></li>`).join("")}</ul><p class="mt-m">${textLink("/ai-disclosure", "Read the AI disclosure")}</p></div>
</div>`,
  );
}

function security() {
  const faqs = faqsOf("/security-and-privacy", { "Who can see my Trainer Brain?": "Who can see my AI?", "Is wearable data sent to the AI?": "Is wearable data sent to my AI?" }).map((f) =>
    f.q === "Who can see my subscribers’ data?"
      ? { ...f, a: "You and the team members whose role allows it. Other trainers cannot. Platform operators use separate, audited tools; a fresh authenticator check applies when enforcement is switched on." }
      : f,
  );
  return {
    title: "Secure coaching platform: protecting your business and subscribers’ data · trainsyou",
    main: [
      hero({
        kicker: "Security and privacy",
        h1: "How we protect you and your subscribers",
        lede: "Isolated workspaces, strong sign-in, encrypted provider keys and audit logs. Subscribers choose what their coaching data is used for.",
        media: accessLog(),
        secondary: ["/ai-disclosure", "Read the AI disclosure"],
        cls: "sec-hero",
      }),
      secFacts(),
      secOperators(),
      secMethod(),
      secCaveats(),
      faqBand({ id: "sfaq", title: "Security questions", faqs, prefix: "sfq", related: ["/features/safety", "/ai-disclosure", "/privacy"], tone: "paper" }),
    ].join("\n"),
    closing: { secondary: { label: "Read the AI disclosure", path: "/ai-disclosure" } },
  };
}

export const pages = {
  "/how-it-works": howItWorks,
  "/trainer-brain": trainerBrain,
  "/features": featuresIndex,
  "/demo": demo,
  "/security-and-privacy": security,
  ...Object.fromEntries(Object.keys(FEATURE).map((slug) => [`/features/${slug}`, featurePage(slug)])),
};
