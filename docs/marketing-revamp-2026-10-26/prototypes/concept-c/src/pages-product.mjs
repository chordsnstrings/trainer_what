// Product pages for concept C "The Method" (owner: product page builder):
//   /how-it-works, /trainer-brain, /features, /features/* (11), /demo,
//   /security-and-privacy.
// Copy is the section C proposed copy (pending owner approval, decision 18);
// everything else comes from content.json. Styles: site/assets/product.css.
// Behaviour: site/assets/product.js. Helpers: src/lib-product*.mjs.
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { ROOT } from "./lib/content.mjs";
import {
  plain, checkCopy, faqX, FEATURES, featureChips, MATRIX, CAPABILITY_COUNT, capChip, REPLACES,
  xv, inEl, appTop, tabbar, ph, win, kv, pinEl, plate, procedure, manualList, relatedList,
} from "./lib-product.mjs";
import { featureSpecs } from "./lib-product-features.mjs";

const require = createRequire(import.meta.url);
const calc = require(resolve(ROOT, "site/assets/calc.js"));
const SPECS = featureSpecs({ calc });
import { anatomy, playground, BOOT, CSS, PLAY_COPY, brainData, nodeChip } from "./lib-brain.mjs";

const PAIN_A = "Training pauses and you are alerted. Pain and red flags are caught by safety rules in code, before any AI runs, so no prompt or setting can switch them off. Medical questions wait for your review.";
const DATA_A = "It is taught with your material: confirmed rules, cases, examples and corrections. Each version is checked against your test cases and can be rolled back. We don’t fine-tune a model on you, and your teaching stays private.";
const DATA_ON = "It runs on a frontier model, taught with your confirmed rules, cases, examples and corrections. Each version is checked against your test cases and can be rolled back. We don’t fine-tune a model on you; your teaching stays private.";

/** Shared hero shell: copy column + figure column. */
function heroShell(h, { id, eyebrow, h1Html, chipsHtml = "", lede, actionsHtml, extraHtml = "", figHtml, cls = "" }) {
  return `<section class="hero pd-hero ${cls}" data-hero aria-labelledby="${id}">
  <div class="wrap hero-grid pd-hero-grid">
    <div class="hero-copy">
      <p class="eyebrow">${h.esc(eyebrow)}</p>
      <h1 class="display" id="${id}">${h1Html}</h1>
      ${chipsHtml}
      ${lede ? lede.split("\n").map((l, i) => `<p class="lede${i ? " lede-2" : ""}">${h.esc(l)}</p>`).join("") : ""}
      ${extraHtml}
      <div class="hero-actions">${actionsHtml}</div>
      ${h.microLine()}
    </div>
    ${figHtml}
  </div>
</section>`;
}
const figCap = (h, n, caption, extra = "", id = "") =>
  `<figcaption class="fig-cap"${id ? ` id="${id}"` : ""}><span class="fig-n">Fig. ${n}</span>${caption ? `<span class="fig-t">${h.esc(caption)}</span>` : ""}${extra}${h.sampleLabel()}</figcaption>`;
const questionsBand = (h, { n, id, faqs, sideHtml, paper = false, title = "Questions" }) =>
  `<section class="band${paper ? " band--paper" : ""}" id="questions" aria-labelledby="${id}-h">
  <div class="wrap">
    ${h.sectionHead({ n, title, id: `${id}-h` })}
    <div class="ms">${faqX(faqs, { id })}<div class="faq-side">${sideHtml}${h.kamranPill({ inline: true, location: "faq" })}</div></div>
  </div>
</section>`;

// ===========================================================================
// /how-it-works: the numbered manual
// ===========================================================================

function howItWorks({ page, content, href, h }) {
  const { esc, each, cta, secondary, linkArrow, sectionHead, chip, statusChip, flagged, whenOn, icon, mark, statusPanel, marginNote } = h;
  const ok = (t) => `<li class="ok">${icon("check", { size: 13 })}${t}</li>`;
  const todo = (t) => `<li>${icon("circle", { size: 13 })}${t}</li>`;

  // Hero: Fig. 1, the method at work (plays once: ink token runs, value changes).
  const flowFig = `<figure class="hero-fig pd-flow-fig" aria-labelledby="hiw-fig1">
  <div class="pd-flow" data-play role="img" aria-label="Sample: a confirmed rule is tested, then changes a subscriber’s squat from 60 to 62.5 kg">
    <div class="pd-flow-step">
      <p class="pd-flow-k"><span>i</span>Your method</p>
      <p class="pd-flow-rule">Two easy sessions → add 2.5 kg</p>
      <p class="pd-flow-meta">${chip("live", "Confirmed · 12 Oct")}<span>Source: your interview</span></p>
    </div>
    <div class="pd-flow-link" aria-hidden="true"><i></i></div>
    <div class="pd-flow-step">
      <p class="pd-flow-k"><span>ii</span>Tested</p>
      <ul class="mini-checks pd-flow-checks">${ok("8 quiz answers")}${ok("3 client cases")}</ul>
      <p class="pd-flow-meta"><span>Mode: replies wait for you</span></p>
    </div>
    <div class="pd-flow-link" aria-hidden="true"><i></i></div>
    <div class="pd-flow-step pd-flow-step--out">
      <p class="pd-flow-k"><span>iii</span>Daily coaching</p>
      <p class="pd-flow-row"><span>Monday · Back squat 4 × 6</span><b>${xv("60 kg", "62.5 kg")}</b></p>
      <p class="pd-flow-meta">${inEl(`<span class="pd-flow-lane">${icon("check", { size: 13 })}Sent on its own, within your rules</span>`, { tag: "span", delay: 980 })}<span>Anything else waits for you</span></p>
    </div>
  </div>
  ${figCap(h, 1, "Your method, at work", "", "hiw-fig1")}
</figure>`;
  const hero = heroShell(h, {
    id: "hiw-h1",
    eyebrow: "How it works",
    h1Html: `From your method to ${mark("daily coaching")}`,
    lede: "Teach it your method, test it, then publish.\nIt coaches every subscriber daily.\nAnything outside your rules waits for you.",
    actionsHtml: cta({ location: "hero" }) + secondary("Try the demo", "/demo", { location: "hero" }),
    figHtml: flowFig,
    cls: "pd-hero--hiw",
  });

  // §1 The manual: a vertical contents list (tabs) + chapter pages with figures.
  const steps = page.sections.find((s) => s.id === "steps").steps;
  const live = chip("live", "Live today");
  const chapters = [
    {
      t: "Claim your address", time: "2 min", meta: "2 min",
      body: "Reserve your-name.trainsyou.com in setup, then choose your name, colours and starter page.",
      needs: "Your coaching name", status: live,
      win: win("Setup · Your page", `${kv("Address", `<span class="mini-url"><b>layla-strength</b>.trainsyou.com</span>`)}${kv("Name", "Layla Strength")}<p class="pd-sw-k">Colours</p><p class="pd-swatches"><span style="--c:#D5F24A"></span><span style="--c:#171917"></span><span style="--c:#F3F4F0"></span></p>${kv("Starter page", "Strength · classic")}`),
      phone: `<p class="pd-url">${icon("lock", { size: 11 })}layla-strength.trainsyou.com</p><p class="pd-site-k">Layla Strength</p><p class="pd-site-h">Strength coaching, planned for you</p><div class="app-btn">See coaching plans</div><div class="pd-site-pair"><span>Before</span><span>After</span></div><div class="pd-site-row"><b>Training plan</b><span>Day by day, in the app</span></div><div class="pd-site-row"><b>Contact</b><span>Messages reach your inbox</span></div><p class="pd-fine">Preview · not public yet</p>`,
    },
    {
      t: "Teach your AI", time: "6 min to start", meta: "6 min",
      body: plain(steps[1].body).replace("your Brain", "your AI"),
      needs: "8 quiz answers and 3 client cases", status: live,
      win: win("Teach · rules to review", `<div class="pd-rq"><p class="pd-rq-k">Rule 07 · from your interview</p><p class="pd-rq-t">After two sessions at 3+ reps in reserve, add 2.5 kg.</p><p class="pd-btns"><span class="btn-ui btn-ui--ink">Confirm</span><span class="btn-ui">Edit</span><span class="btn-ui">Reject</span></p></div><div class="pd-rq pd-rq--dim"><p class="pd-rq-k">Rule 08 · from a document</p><p class="pd-rq-t">Never stack two sessions in one day.</p></div>`),
      phone: `<p class="pd-sess-k">Practice quiz · 3 of 8</p><p class="pd-quiz-dots" aria-hidden="true"><i class="on"></i><i class="on"></i><i class="on"></i><i></i><i></i><i></i><i></i><i></i></p><p class="pd-quiz-q">A client misses Monday. What do you do?</p><p class="pd-quiz-a">Move it to the next free day. Keep a rest day between hard sessions.</p><div class="app-btn">Save answer</div><p class="pd-sw-k pd-mt">Next</p><p class="pd-quiz-n">A client says squats felt easy twice. What changes?</p>`,
    },
    {
      t: "Test it", time: "At your pace", meta: "your pace",
      body: "It starts supervised: every reply waits for you. Automatic sending needs 20 cases and passing checks.",
      needs: "20 cases for automatic sending", status: live,
      win: win("Test it", `<ul class="mini-checks pd-checks">${ok("8 quiz answers")}${ok("3 client cases")}${todo("20 cases for automatic sending · 3 of 20")}</ul>${kv("Mode", "Waits for me")}<p class="pd-fine">Your AI is checked against your test cases before each release.</p>`),
      phone: `${appTop("Preview as a subscriber")}<div class="pd-chat"><p class="bubble bubble--out">Can I train legs two days in a row?</p><p class="pd-who">Draft · waits for Layla</p><p class="bubble bubble--in pd-draft">Better not. Keep a rest day between hard leg sessions.</p></div>`,
    },
    {
      t: "Create your offer", time: "1 min", meta: "1 min",
      body: "Choose your plan, its length and your AED price. Add nutrition or voice when you’re ready.",
      needs: "Your price in AED", status: `${live}<span class="pd-nl">Subscriber payments: ${statusChip("payments", "Not on yet", "Live today")}</span>`,
      win: win("Your offer", `${kv("Plan", "Training plan")}${kv("Length", "12 weeks")}${kv("Price", "AED 199 a month")}${kv("Nutrition tier", "Optional · AED 299")}`, { chipHtml: h.sampleLabel("Sample") }),
      phone: `${appTop()}<p class="app-h">Training plan</p><p class="pd-price tnum">AED 199 <small>a month</small></p><p class="app-sub">12 weeks · a plan every day, in the app</p><ul class="pd-terms"><li>${icon("check", { size: 12 })}A dated plan, built from your rules</li><li>${icon("check", { size: 12 })}Guided workouts, offline in the gym</li><li>${icon("check", { size: 12 })}Chat with Layla and a labelled digital coach</li></ul><div class="app-btn">Join</div><p class="pd-fine">Workouts + nutrition: AED 299 a month</p>`,
    },
    {
      t: "Publish and share", time: "2 min", meta: "noton:publish",
      body: "Check the subscriber preview, publish, then share your tagged link in your bio and Stories.",
      needs: "Launch checks to pass", status: statusChip("publish", "Not on yet", "Live today"),
      win: win("Go live · launch checks", `<ul class="mini-checks pd-checks">${ok("Your page and app")}${ok("Your AI, tested")}${ok("Your details")}<li class="pd-check-wait">${flagged("payments", `<span class="chip-dot"></span>Subscriber payments · not on yet`, `${icon("check", { size: 13 })}Subscriber payments`)}</li></ul>${flagged("publish", `<span class="btn-ui is-off">Publish your page</span>`, `<span class="btn-ui btn-ui--ink">Publish your page</span>`)}`),
      phone: `<div class="pd-bio"><span class="app-icon pd-icon-lg">LS</span><p class="app-name">Layla Strength</p><p class="app-sub">Strength coach · Dubai</p><p class="pd-bio-link">${icon("share", { size: 11 })}layla-strength.trainsyou.com/?ref=bio</p></div><div class="pd-site-row"><b>Bio link</b><span>?ref=bio</span></div><div class="pd-site-row"><b>Story link</b><span>?ref=story</span></div><p class="pd-fine">Tagged links show which post brought each visitor.</p>`,
    },
    {
      t: "It coaches daily", time: "Every day", meta: "daily",
      body: "Each subscriber gets a dated plan. Replies wait for you unless you switch on automatic sending.",
      needs: "A published page", status: `<span class="pd-nl">After publishing</span>`,
      win: win("Today · decisions", `<ul class="pd-log-list"><li><em class="pd-st pd-st--ok">Sent on its own</em><span>Squat 60 → 62.5 kg · rule 07</span></li><li><em class="pd-st pd-st--you">To you</em><span>Hotel-gym plan · draft ready</span></li><li><em class="pd-st pd-st--pause">Paused</em><span>Knee pain · alert sent</span></li></ul>`),
      phone: `${appTop()}<p class="app-h">Today</p><p class="app-sub">Monday · Week 3 · Lower body A</p><div class="app-card"><p class="app-row"><span>Back squat 4 × 6</span><b>62.5 kg</b></p><p class="app-row"><span>Romanian deadlift 3 × 8</span><b>50 kg</b></p><p class="app-row"><span>Walking lunge 3 × 10</span><b>16 kg</b></p></div><div class="app-btn">Start workout</div><p class="app-offline"><span class="app-badge">${icon("check", { size: 12 })}Saved offline</span></p><div class="app-note"><p class="app-note-k">Digital coach · Layla Strength</p><p>Squats felt easy last week, so today is 62.5 kg.</p></div>`,
    },
    {
      t: "You correct, it learns", time: "When it asks", meta: "ongoing",
      bodyHtml: flagged("frontier", "Review your Inbox. Your corrections become suggested rules you confirm.", "Approve or correct what comes to you. Each tested release learns from it and keeps getting better."),
      needs: "Your Inbox", status: live,
      win: win("Your correction", `<p class="pd-sw-k">You wrote</p><p class="mini-quote">“Keep 60 kg. She slept badly.”</p><p class="pd-sw-k">Suggested rule</p><p class="pd-rq-t">After a poor-sleep note, hold the load.</p><p class="pd-btns"><span class="btn-ui btn-ui--ink">Confirm</span><span class="btn-ui">Edit</span></p>`),
      phone: `${appTop("Coach chat")}<div class="pd-chat"><p class="bubble bubble--out">Slept badly. Still train?</p><p class="pd-who">Layla</p><p class="bubble bubble--in">Yes, but keep 60 kg today. Sleep first.</p><p class="bubble bubble--out">Thanks, will do.</p><p class="pd-notice">Your coach replied personally</p></div>`,
    },
    {
      t: "Get paid monthly", time: "Monthly", meta: "noton:payments",
      body: "Subscribers pay in AED and payouts reach your UAE bank. Your statement itemises every cost.",
      needs: "A verified UAE IBAN", status: statusChip("payments", "Not on yet", "Live today"),
      win: win("Statement · monthly", `<dl class="pd-stmt-mini">${["Subscriptions", "Our share", "Payout to your UAE bank"].map((k) => `<div><dt>${k}</dt><dd>—</dd></div>`).join("")}</dl>`, { chipHtml: statusChip("payments", "Not on yet", "Live") }),
      phone: `${appTop()}<p class="app-h">Membership</p><p class="pd-price tnum">AED 199 <small>a month</small></p><p class="app-sub">Renews monthly · stop any time</p><div class="pd-site-row"><b>Invoices</b><span>Each month, in your account</span></div><div class="pd-site-row"><b>Refunds</b><span>A request your coach decides</span></div><p class="pd-fine">Payments are not on yet.</p>`,
    },
  ];
  const n = chapters.length;
  const metaHtml = (m) => {
    if (m.startsWith("noton:")) return h.statusChip(m.slice(6), "Not on yet", "Live");
    return `<span class="pd-man-m tnum">${esc(m)}</span>`;
  };
  const manual = `<div class="pd-manual" data-manual style="--n:${n}">
  <div class="pd-man-index">
    <p class="pd-man-k" id="man-k">Contents</p>
    <div class="pd-man-tabs" role="tablist" aria-labelledby="man-k" aria-orientation="vertical">
      <svg class="pd-man-line" aria-hidden="true" width="2" height="100%" preserveAspectRatio="none"><line class="sl-track" x1="1" y1="0" x2="1" y2="100%"/><line class="sl-fill" x1="1" y1="0" x2="1" y2="100%" pathLength="100" style="stroke-dashoffset:${100 - 100 / n}"/></svg>
      ${each(chapters, (c, i) => `<button class="pd-man-tab" role="tab" type="button" id="man-tab-${i}" aria-controls="man-panel-${i}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}"><span class="pd-man-n">${i + 1}</span><span class="pd-man-t">${esc(c.t)}</span>${metaHtml(c.meta)}</button>`)}
    </div>
  </div>
  <div class="pd-man-panels">${each(chapters, (c, i) => `<div class="tabpanel pd-man-panel" role="tabpanel" id="man-panel-${i}" aria-labelledby="man-tab-${i}" tabindex="0"${i ? " hidden" : ""}>
    <div class="pd-man-page">
      <p class="pd-man-of">Chapter ${i + 1} of ${n}</p>
      <h3 class="pd-man-h">${esc(c.t)}</h3>
      <p class="pd-man-p">${c.bodyHtml || esc(c.body)}</p>
      <dl class="pd-man-notes">
        <div><dt>Time</dt><dd>${esc(c.time)}</dd></div>
        <div><dt>You need</dt><dd>${esc(c.needs)}</dd></div>
        <div><dt>Status</dt><dd>${c.status}</dd></div>
      </dl>
    </div>
    <div class="pd-man-fig" role="img" aria-label="${esc(`Sample screens for chapter ${i + 1}: ${c.t}`)}">
      <div class="pd-man-win">${c.win}</div>
      ${ph(c.phone, { cls: "pd-phone--sm" })}
    </div>
  </div>`)}</div>
  <div class="pd-man-nav">
    <button class="btn btn-secondary btn-icon" type="button" data-man-step="-1" aria-label="Previous chapter">${icon("arrow", { className: "flip" })}</button>
    <p class="stepper-count" aria-hidden="true"><span class="vx" data-vx="man"><span>1</span></span> / ${n}</p>
    <button class="btn btn-secondary btn-icon" type="button" data-man-step="1" aria-label="Next chapter">${icon("arrow")}</button>
    <p class="pd-man-hint">${h.sampleLabel()}</p>
  </div>
</div>`;
  const manualBand = `<section class="band" id="manual" aria-labelledby="manual-h">
  <div class="wrap">
    ${sectionHead({ n: 1, title: "The manual, in eight chapters", id: "manual-h", lede: "Your AI (we call it your Trainer Brain) learns your method in setup. Time, needs and status sit in the margin." })}
    <div data-reveal>${manual}</div>
  </div>
</section>`;

  // §2 Who does what: three lanes as a typeset table.
  const lanesSec = page.sections.find((s) => s.id === "lanes").table;
  const heads = [["You", "user"], ["Your AI", "check"], ["Your subscriber", "share"]];
  const lanesRows = lanesSec.rows.map((r) => r.map((c) => plain(c)));
  const lanesTbl = `<div class="pd-lanes-tbl" data-reveal>
  <table class="tbl pd-ltbl"><caption>${esc(lanesSec.caption)}</caption>
    <thead><tr>${each(heads, ([t, ic]) => `<th scope="col"><span class="pd-lh">${icon(ic, { size: 16 })}${esc(t)}</span></th>`)}</tr></thead>
    <tbody>${each(lanesRows, (r) => `<tr>${each(r, (c, i) => `<td data-k="${esc(heads[i][0])}">${esc(c)}</td>`)}</tr>`)}</tbody>
  </table>
</div>`;
  // Echo of Concept C's showcase: Fig. 3 in brief, citing Fig. 3b (safety rules read first).
  const bd = brainData(), tb = href("/trainer-brain");
  const LAY = [["a", "The message", "msg"], ["b", "Safety rules", "hit"], ["c", "Your topics", "check"], ["d", "Memory", "check"], ["e", "Rule finder", "check"], ["f", "One specialist", "ai"], ["g", "Checks after", "check"], ["h", "The lane", "lane"], ["i", "What they read", "msg"]];
  const brief = `<figure class="c-brief" data-reveal aria-labelledby="brief-cap">
  <ol class="c-brief-l" aria-hidden="true">${each(LAY, ([k, t, kind]) => `<li data-kind="${kind}"><i>(${k})</i><span>${esc(t)}</span></li>`)}</ol>
  <figcaption class="c-brief-cap" id="brief-cap"><span class="fig-n">Fig. 3, in brief</span>Every message meets your safety rules first (see <a href="${tb}#fig-3b">Fig. 3b</a>). Then code picks one specialist, and your rules check the result. ${linkArrow("The full anatomy", "/trainer-brain#decides")}</figcaption>
</figure>`;
  const lanesBand = `<section class="band band--paper" id="who" aria-labelledby="who-h">
  <div class="wrap">
    ${sectionHead({ n: 2, title: "Who does what", id: "who-h" })}
    ${lanesTbl}
    ${brief}
  </div>
</section>`;

  // §3 Time to start: six steps, about 15 minutes, + live status.
  const list = content.setupChecklist;
  const total = list.reduce((s, x) => s + x.minutes, 0);
  const ledger = `<div class="pd-ledger" data-reveal>
  <p class="pd-led-total"><span class="pd-led-big tnum">${total}</span><span>minutes to start, in six steps</span></p>
  <div class="pd-led-bar" aria-hidden="true">${each(list, (x, i) => `<span style="--m:${x.minutes};--i:${i}"><i></i><b class="tnum">${x.minutes}</b></span>`)}</div>
  <ol class="pd-led-list" data-stagger>${each(list, (x, i) => `<li><span class="pd-led-n">${i + 1}</span><span class="pd-led-t">${esc(x.label.replace("Teach your Brain", "Teach your AI"))}</span><span class="pd-led-m tnum">${x.minutes} min</span><span class="pd-led-s">${esc(plain(x.summary))}</span></li>`)}</ol>
</div>`;
  const timeBand = `<section class="band" id="time" aria-labelledby="time-h">
  <div class="wrap">
    ${sectionHead({ n: 3, title: "About fifteen minutes to start", id: "time-h" })}
    <div class="pd-time">
      ${ledger}
      <div class="pd-time-side">
        ${statusPanel({ id: "status", title: "What works today", compact: true })}
        <p class="fine pd-time-note" data-reveal>Fifteen minutes to start, not to launch. Publishing waits until subscriber payments are on.</p>
      </div>
    </div>
  </div>
</section>`;

  // §4 Control stays visible (+ frontier line, flag on only).
  const controls = [
    ["Inspect every rule", "Each rule shows the source it came from.", "check"],
    ["Roll back a release", "Every version is kept. Go back in one step.", "arrow"],
    ["Take over any conversation", "Your AI steps back for that subscriber.", "user"],
    ["Write programmes yourself", "Templates and an exercise library, whenever you like.", "plus"],
  ];
  const controlBand = `<section class="band band--paper" id="control" aria-labelledby="control-h">
  <div class="wrap">
    ${sectionHead({ n: 4, title: "Control stays visible", id: "control-h" })}
    <div class="ms">
      <div class="ms-text">
        <ul class="pd-ctl" data-reveal data-stagger>${each(controls, ([t, d, ic]) => `<li><span class="pd-ctl-ic">${icon(ic, { size: 18, className: ic === "arrow" ? "flip" : "" })}</span><h3 class="pd-ctl-t">${esc(t)}</h3><p>${esc(d)}</p></li>`)}</ul>
        <p class="big-p pd-ctl-line" data-reveal>Subscribers always see when guidance is digital.</p>
        ${whenOn("frontier", `<blockquote class="pull pd-frontier" data-reveal><p>Frontier model plus your corrections.</p><footer class="pull-cite">It keeps getting better with time</footer></blockquote>`, "div")}
      </div>
      <div class="mnote" role="note" data-reveal><span class="mnote-k">Read more</span>${linkArrow("How your AI decides", "/trainer-brain")}${linkArrow("Safety rules in code", "/features/safety")}</div>
    </div>
  </div>
</section>`;

  // §5 FAQ (4).
  const faqs = [
    { q: "How long does setup take?", a: "About 15 minutes to start, in six short steps. You can keep teaching after that, and the checklist shows your progress. Publishing waits until subscriber payments are on." },
    { q: "What does my AI do when it isn’t sure?", a: plain(page.faqs[1].a) },
    { q: "Is my AI trained on my data?", a: DATA_A, aOn: DATA_ON },
    { q: "What happens when a subscriber reports pain?", a: PAIN_A },
  ];
  const questions = questionsBand(h, { n: 5, id: "hiw-faq", faqs, sideHtml: `<div class="mnote" role="note"><span class="mnote-k">More answers</span>${linkArrow("All questions", "/faq")}</div>` });

  checkCopy(page.path, { h1: "From your method to daily coaching", h2: ["The manual, in eight chapters", "Who does what", "About fifteen minutes to start", "Control stays visible"], lede: "Teach it your method, test it, then publish. It coaches every subscriber daily. Anything outside your rules waits for you.", faqs });
  return {
    main: [hero, manualBand, lanesBand, timeBand, controlBand, questions].join("\n"),
    title: page.title,
    css: CSS.anatomy,
    description: "Eight chapters from your address to monthly payouts: teach your AI your method, test it, publish your offer and let it coach every day.",
    closing: { label: "Try the demo", path: "/demo" },
  };
}

// ===========================================================================
// /trainer-brain: the flagship annotated manual
// ===========================================================================

function trainerBrain({ page, href, h }) {
  const { esc, each, cta, secondary, linkArrow, sectionHead, chip, flagged, whenOn, icon, mark, ruleCard, neverSheet, figure, liveRegion, marginNote, msRow } = h;
  const sec = (id) => page.sections.find((s) => s.id === id);

  // Hero: a rule waiting for your OK, with real Confirm / Edit / Reject.
  const ruleText = "After two sessions at 3+ reps in reserve, add 2.5 kg.";
  const heroFig = `<figure class="hero-fig pd-tb-fig" aria-labelledby="tb-fig1">
  <div class="pd-plate pd-tb-plate">
    <div class="pd-tb-deck" data-rule-review>
      <div class="pd-deck">
        <span class="pd-deck-sheet" aria-hidden="true"></span><span class="pd-deck-sheet pd-deck-sheet--2" aria-hidden="true"></span>
        ${ruleCard({ id: "tb-rule", pins: true, actions: false, text: ruleText, kicker: "Rule 07 · Progression" })}
      </div>
      <div class="pd-rc-actions" role="group" aria-label="Review rule 07">
        <div class="pd-rc-act" data-rc-step="pending">
          <button class="btn btn-primary btn-sm" type="button" data-rc="confirm">${icon("check", { size: 16 })}Confirm</button>
          <button class="btn btn-secondary btn-sm" type="button" data-rc="edit" aria-expanded="false" aria-controls="tb-edit">Edit</button>
          <button class="btn btn-secondary btn-sm" type="button" data-rc="reject">Reject</button>
        </div>
        <div class="pd-rc-act" data-rc-step="done" hidden>
          <p class="pd-rc-msg" data-rc-msg></p>
          <button class="btn btn-secondary btn-sm" type="button" data-rc="undo">Undo</button>
        </div>
      </div>
      <div class="pd-rc-edit" id="tb-edit" hidden>
        <label class="field-label" for="tb-edit-in">Rule wording</label>
        <textarea class="input pd-rc-ta" id="tb-edit-in" rows="2" maxlength="140">${esc(ruleText)}</textarea>
        <div class="pd-rc-edit-row"><button class="btn btn-primary btn-sm" type="button" data-rc="save">Save wording</button><span class="fine">It keeps its source.</span></div>
      </div>
      ${liveRegion("tb-live")}
    </div>
    <div class="pd-plate-notes">
      ${marginNote("Source: your interview, 12 Oct", { pin: "a" })}
      ${marginNote("Nothing is used until you confirm", { pin: "b" })}
      <p class="pd-try">${icon("arrow", { size: 14, className: "flip pd-try-ic" })}Try it: confirm, edit or reject.</p>
    </div>
  </div>
  ${figCap(h, 1, "A rule waiting for your OK", "", "tb-fig1")}
</figure>`;
  const hero = heroShell(h, {
    id: "tb-h1",
    eyebrow: "Trainer Brain",
    h1Html: `Your AI, built from your ${mark("judgment")}`,
    lede: "Your rules, cases and corrections in one private AI.\nRoutine replies use your approved words. Anything else waits for you.",
    actionsHtml: cta({ location: "hero" }) + secondary("Try the demo", "/demo", { location: "hero" }),
    figHtml: heroFig,
    cls: "pd-hero--tb",
  });

  // Contents strip (chapters) under the hero.
  const chaptersList = [["what", "What it is"], ["teach", "What you teach"], ["decides", "How it decides"], ["play", "Try a moment"], ["improves", "How it improves"], ["never", "What it never does"], ["yours", "Whose method it is"]];
  const contents = `<nav class="pd-chapters" aria-label="Chapters on this page"><div class="wrap"><ol>${each(chaptersList, ([id, t], i) => `<li><a href="#${id}"><span class="toc-n">§${i + 1}</span>${esc(t)}</a></li>`)}</ol></div></nav>`;

  // §1 What it is + provenance figure.
  const prov = `<div class="pd-prov" role="img" aria-label="Sample: a squat change traces back to rule 07, which came from your interview on 12 October">
  <div class="pd-prov-node"><p class="pd-sw-k">The change</p><p class="pd-prov-t">Monday · back squat <b class="tnum">60 → 62.5 kg</b></p><p class="pd-fine">Sent on its own, within your rules · reason logged</p></div>
  <div class="pd-prov-link" aria-hidden="true"><svg width="100%" height="100%" preserveAspectRatio="none"><line x1="0" y1="50%" x2="100%" y2="50%" pathLength="100"/></svg><span>because</span></div>
  <div class="pd-prov-node pd-prov-node--rule"><p class="pd-sw-k">Rule 07</p><p class="pd-prov-t pd-serif">After two sessions at 3+ reps in reserve, add 2.5 kg.</p><p class="pd-fine">Confirmed by you · 12 Oct</p></div>
  <div class="pd-prov-link" aria-hidden="true"><svg width="100%" height="100%" preserveAspectRatio="none"><line x1="0" y1="50%" x2="100%" y2="50%" pathLength="100"/></svg><span>taught in</span></div>
  <div class="pd-prov-node"><p class="pd-sw-k">Source</p><p class="pd-prov-t">Your interview · 12 Oct</p><p class="pd-fine">Question 4: “When do you add load?”</p></div>
</div>`;
  const what = `<section class="band" id="what" aria-labelledby="what-h">
  <div class="wrap">
    ${sectionHead({ n: 1, title: "What it is", id: "what-h" })}
    ${msRow(`<p class="big-p">Your AI (we call it your Trainer Brain) is built from your rules, cases and corrections. Not a generic workout generator.</p>`, `<span class="mnote-k">In one line</span>Every change traces back to something you taught. Every version can be rolled back.`)}
    ${figure({ n: "2a", caption: "Every change has a source", bodyHtml: prov, className: "pd-prov-fig" })}
  </div>
</section>`;

  // §2 What you teach it: five items + the review queue figure.
  const teachItems = [
    { title: "A guided interview", body: "What you recommend, why, and what changes it." },
    { title: "Rules you confirm", body: "Plain-language rules, each with its source. Flagged rules never go into “Approve all”." },
    { title: "Cases and worked examples", body: "Real decisions you made, not just principles." },
    { title: "Your documents", body: "Used only after you review the extracted text, privately." },
    { title: "The practice quiz", body: "8 answers and 3 own cases to start. 20 cases for automatic sending." },
  ];
  const queue = win("Rules to review · 3", `<ul class="pd-queue">
  <li><span class="pd-q-box is-on">${icon("check", { size: 12 })}</span><div><b>Rule 08</b><span>Missed session → next free day</span></div></li>
  <li><span class="pd-q-box is-on">${icon("check", { size: 12 })}</span><div><b>Rule 09</b><span>Lighter week every fifth week</span></div></li>
  <li class="is-flag"><span class="pd-q-box"></span><div><b>Rule 10 · flagged</b><span>Conflicts with rule 04. You decide which wins.</span></div><em>Not included</em></li>
</ul>
<p class="pd-btns"><span class="btn-ui btn-ui--ink">Approve all (2)</span><span class="btn-ui">Resolve rule 10</span></p>`, { label: "Sample review queue: approve all includes two rules and leaves the flagged rule out" });
  const teach = `<section class="band band--paper" id="teach" aria-labelledby="teach-h">
  <div class="wrap">
    ${sectionHead({ n: 2, title: "What you teach it", id: "teach-h" })}
    <div class="pd-teach">
      ${manualList(teachItems, { cls: "pd-mlist--teach" })}
      ${figure({ n: "2b", caption: "“Approve all” skips flagged rules", bodyHtml: queue, className: "pd-queue-fig" })}
    </div>
  </div>
</section>`;

  // §3 How it decides: Concept C's "Anatomy of a decision" (spec §4), pinned.
  const decides = anatomy({ n: 3, fig: 3, id: "decides" });

  // §4 The shared playground, in C's worked-example skin (spec §5).
  const play = `<section class="band band--paper c-playband" id="play" aria-labelledby="play-h">
  <div class="wrap">
    ${sectionHead({ n: 4, title: PLAY_COPY.h2, id: "play-h", lede: PLAY_COPY.lede })}
    <figure class="fig c-playfig">${playground({ id: "playground", labelledby: "play-h" })}<figcaption class="fig-cap"><span class="fig-n">Fig. 4</span><span class="fig-t">Twelve sample moments, each worked through</span>${h.sampleLabel()}</figcaption></figure>
  </div>
</section>`;

  // §4 How it improves: release timeline (rollback) + Compare my replies.
  const rel = [["v1", "12 Oct", "First rules"], ["v2", "16 Oct", "+ 3 cases"], ["v3", "20 Oct", "+ rule 07"], ["v4", "24 Oct", "+ your corrections"]];
  const releases = `<div class="pd-rel" data-releases>
  <div class="pd-rel-track">
    <ol class="pd-rel-list">${each(rel, ([v, d, c], i) => `<li${i === 3 ? ' class="is-live"' : ""}><span class="pd-rel-dot" aria-hidden="true"></span><b>${v}</b><span class="tnum">${d}</span><span class="pd-rel-c">${esc(c)}</span></li>`)}</ol>
    <span class="pd-rel-live" style="--at:3" aria-hidden="true"><span>Live</span></span>
  </div>
  <div class="pd-rel-foot">
    <p class="pd-rel-status"><span class="vx" data-vx="rel" style="--w:30ch"><span>Live: v4 · passed your test cases</span></span></p>
    <button class="btn btn-secondary btn-sm" type="button" data-rel-toggle><span class="vx" data-vx="rel-btn" style="--w:12ch"><span>Roll back to v3</span></span></button>
  </div>
  ${liveRegion("rel-live")}
</div>`;
  const dims = [["The call", 5, 5], ["Wording", 4, 5], ["Uses the chat", 4, 4], ["Explains why", 4, 3], ["Knows when to ask", 5, 5]];
  const dots = (n) => `<span class="pd-dots" role="img" aria-label="${n} of 5">${each([1, 2, 3, 4, 5], (i) => `<i${i <= n ? ' class="on"' : ""}></i>`)}</span>`;
  const compare = `<div class="pd-cmp" data-compare>
  <p class="pd-cmp-msg"><span class="pd-sw-k">Subscriber</span>“Can I swap squats for leg press this week? The rack is always busy at 6.”</p>
  <div class="pd-cmp-pair">
    <div class="pd-cmp-r"><p class="pd-cmp-k"><span class="vx" data-vx="cmp-a" style="--w:11ch"><span>Reply A</span></span></p><p>“Yes. Leg press 4 × 10 this week, same effort as your squats. Back to squats next week.”</p></div>
    <div class="pd-cmp-r"><p class="pd-cmp-k"><span class="vx" data-vx="cmp-b" style="--w:11ch"><span>Reply B</span></span></p><p>“Sure, use the leg press. Keep about 2 reps in reserve and we’ll return to squats Monday.”</p></div>
  </div>
  <table class="pd-cmp-tbl"><caption class="sr-only">Your ratings, 1 to 5</caption><thead><tr><th scope="col">You rate, 1–5</th><th scope="col">A</th><th scope="col">B</th></tr></thead><tbody>${each(dims, ([d, a, b]) => `<tr><th scope="row">${esc(d)}</th><td>${dots(a)}</td><td>${dots(b)}</td></tr>`)}</tbody></table>
  <div class="pd-cmp-foot"><button class="btn btn-secondary btn-sm" type="button" data-cmp-reveal aria-pressed="false">Reveal which is yours</button><p class="fine">A source-hidden review, not a scientific test.</p></div>
  ${liveRegion("cmp-live")}
</div>`;
  const learns = [
    "Your corrections become suggested rules you confirm.",
    "Each release is checked against your test cases first.",
    "Every release is versioned, so you can roll back.",
    "“Compare my replies”: rate its reply against yours, without knowing which is which.",
  ];
  const improves = `<section class="band band--paper" id="improves" aria-labelledby="improves-h">
  <div class="wrap">
    ${sectionHead({ n: 5, title: "How it gets better", id: "improves-h" })}
    <div class="pd-imp">
      <div class="pd-imp-text">
        ${manualList(learns.map((t) => ({ title: t })), { cls: "pd-mlist--compact" })}
        ${whenOn("frontier", `<p class="pd-frontier-line">A frontier model plus your corrections: it keeps getting better with time.</p>`, "div")}
      </div>
      <div class="pd-imp-figs">
        ${figure({ n: 5, caption: "Releases, with rollback", bodyHtml: releases, className: "pd-rel-fig" })}
        ${figure({ n: 6, caption: "Compare my replies", bodyHtml: compare, className: "pd-cmp-fig" })}
      </div>
    </div>
  </div>
</section>`;

  // §5 What it never does: the signed Never sheet.
  const never = `<section class="band" id="never" aria-labelledby="never-h">
  <div class="wrap">
    ${sectionHead({ n: 6, title: "What it never does", id: "never-h" })}
    <div class="ms pd-never">
      ${neverSheet({ titleHtml: "Four things your AI will <em>never</em> do" })}
      <div class="mnote" role="note" data-reveal><span class="mnote-k">Why it holds</span>Safety routing is part of the platform, not a setting. It applies to every trainer.${linkArrow("Safety rules in code", "/features/safety")}</div>
    </div>
  </div>
</section>`;

  // §6 Your method stays yours.
  const yoursItems = [
    ["Private to your workspace", "Isolated at the database layer. Another trainer can’t see it."],
    ["Never used for anyone else", "Your teaching coaches only your subscribers."],
    ["Yours to take or delete", "Export your method, or delete it."],
    ["Your voice, by consent", "Used only with consent you can withdraw."],
  ];
  const yours = `<section class="band band--paper" id="yours" aria-labelledby="yours-h">
  <div class="wrap">
    ${sectionHead({ n: 7, title: "Your method stays yours", id: "yours-h" })}
    <div class="ms">
      <dl class="pd-deed" data-reveal data-stagger>${each(yoursItems, ([t, d]) => `<div><dt>${icon("lock", { size: 16 })}${esc(t)}</dt><dd>${esc(d)}</dd></div>`)}</dl>
      <div class="mnote" role="note" data-reveal><span class="mnote-k">The details</span>${linkArrow("Security and privacy", "/security-and-privacy")}${linkArrow("Voice coach", "/features/voice-coach")}</div>
    </div>
  </div>
</section>`;

  // §7 FAQ (4).
  const faqs = [
    { q: "Is my AI trained on my data?", a: DATA_A, aOn: DATA_ON },
    { q: "Will my AI replace me?", a: "No. It’s built from your rules, cases and corrections, and coaches under your name. It hands you anything it isn’t sure about, and safety issues always come to you." },
    { q: "Can another trainer see or use my AI?", a: plain(page.faqs[2].a) },
    { q: "What if my AI gets something wrong?", a: "Correct it. The correction is recorded with its reason, becomes teaching, and is checked against your test cases before the next release. You can also roll back at any time." },
  ];
  const questions = questionsBand(h, { n: 8, id: "tb-faq", faqs, sideHtml: `<div class="mnote" role="note"><span class="mnote-k">More answers</span>${linkArrow("All questions", "/faq")}${linkArrow("Writing coaching rules", "/guides/writing-coaching-rules")}</div>` });

  checkCopy(page.path, { h1: "Your AI, built from your judgment", h2: ["What it is", "What you teach it", "Anatomy of one decision", PLAY_COPY.h2, "How it gets better", "What it never does", "Your method stays yours"], lede: "Your rules, cases and corrections in one private AI. Routine replies use your approved words. Anything else waits for you.", faqs });
  return {
    main: [hero, contents, what, teach, decides, play, improves, never, yours, questions].join("\n"),
    title: "Trainer Brain: an AI trainer built from your judgment",
    css: CSS.play, // brain-base, brain-play, then c-anatomy (C's skin wins)
    bodyEnd: BOOT,
    description: "Teach an AI trainer your coaching rules, cases and examples. It plans and adapts training for each subscriber, learns from your corrections and asks when unsure.",
    closing: { label: "Try the demo", path: "/demo" },
  };
}

// ===========================================================================
// /features: the editorial index, with the full inventory as an appendix
// ===========================================================================

function featuresIndex({ page, href, h, pageFor }) {
  const { esc, each, cta, secondary, linkArrow, sectionHead, chip, statusChip, icon, mark, figure, tabs, sampleLabel } = h;

  const idx = `<aside class="pd-idx" aria-labelledby="idx-k">
  <p class="pd-idx-k" id="idx-k">Appendix A · the inventory</p>
  <p class="pd-idx-big"><span class="tnum">${CAPABILITY_COUNT}</span><span>capabilities in ${MATRIX.length} areas, one workspace</span></p>
  <ol class="pd-idx-list">${each(MATRIX, (g, i) => `<li><a href="#cap-${g.id}" data-cap-link="${g.id}"><span class="toc-n">A${i + 1}</span><span>${esc(g.title)}</span><span class="tnum pd-idx-c">${g.items.length}</span></a></li>`)}</ol>
</aside>`;
  const hero = heroShell(h, {
    id: "feat-h1",
    eyebrow: "Features",
    h1Html: `Everything you need, under your ${mark("own name")}`,
    lede: "Your AI, a branded app and website, nutrition, bookings, payments and safety rules, in one workspace.",
    actionsHtml: cta({ location: "hero" }) + secondary("See the pricing", "/pricing", { location: "hero" }),
    figHtml: idx,
    cls: "pd-hero--feat",
  });

  // §1 Four parts of one platform (bento plates with mini screens).
  const subs = 150 * 19900, comm = calc.projectedCommission(150, 19900);
  const parts = [
    {
      t: "Your AI", p: "/trainer-brain", b: "We call it your Trainer Brain: teaching, testing, releases and handoffs. It learns from your corrections.",
      fig: win("Inbox · Layla Strength", `<p class="pd-part-row"><em class="pd-st pd-st--ok">Sent on its own</em><span>Squat 60 → 62.5 kg · rule 07</span></p><p class="pd-sw-k pd-part-k">Handed to you</p><p class="pd-part-q">“Hotel gym for two weeks”</p><p class="pd-part-a">→ Draft plan with dumbbells to 20 kg</p><p class="pd-btns"><span class="btn-ui btn-ui--ink">Approve</span><span class="btn-ui">Correct</span></p>`, { label: "Sample inbox: one change applied, and a hotel-gym draft plan to approve or correct" }),
    },
    {
      t: "Subscriber experience", p: "/features/subscriber-app", b: "Day-by-day plans, guided workouts, nutrition, voice, chat, bookings and progress.",
      fig: `<div class="pd-part-today" role="img" aria-label="Sample Today screen: week 3, day 2, lower body A"><p class="pd-sw-k">Today</p><p class="pd-part-h">Week 3 · Day 2</p><p class="app-sub">Lower body A</p><p class="app-row"><span>Back squat 4 × 6</span><b>62.5 kg</b></p><p class="app-row"><span>Romanian deadlift 3 × 8</span><b>50 kg</b></p><div class="app-btn">Start workout</div></div>`,
    },
    {
      t: "Your business", p: "/features/payments-and-payouts", b: "Website and address, offers and billing, promotions, statements, payouts and team roles.",
      fig: `<div class="pd-part-stmt" role="img" aria-label="Sample statement: 150 subscribers at AED 199"><p class="pd-part-chips">${sampleLabel("Sample")}${statusChip("payments", "Not on yet", "Live")}</p><dl class="pd-stmt-mini"><div><dt>150 × AED 199</dt><dd class="tnum">${calc.aedWhole(subs)}</dd></div><div><dt>Our share, by band</dt><dd class="tnum">−${calc.aedWhole(comm)}</dd></div><div><dt>Before card processing</dt><dd class="tnum">${calc.aedWhole(subs - comm)}</dd></div></dl></div>`,
    },
    {
      t: "Trust", p: "/features/safety", b: "Safety rules in code, AI disclosure, privacy controls, workspace isolation and security.",
      fig: `<div class="pd-part-trust" role="img" aria-label="Sample: the subscriber taps Report pain, the workout pauses and the trainer is alerted"><div class="pd-pt-a"><p class="pd-sw-k">Guided session · set 3</p><p class="pd-part-h">Back squat</p><span class="pd-pain">Report pain</span></div><span class="pd-part-arr" aria-hidden="true">↓</span><div class="pd-paused"><p class="pd-paused-t">${icon("pause", { size: 15 })}Workout paused</p><p>Layla is alerted. Normal training waits for her review.</p></div></div>`,
    },
  ];
  const partsBand = `<section class="band" id="parts" aria-labelledby="parts-h">
  <div class="wrap">
    ${sectionHead({ n: 1, title: "Four parts of one platform", id: "parts-h" })}
    <div class="pd-bento" data-reveal data-stagger>${each(parts, (x, i) => `<a class="pd-part pd-part--${i}" href="${href(x.p)}"><div class="pd-part-copy"><p class="pd-part-n">${["i", "ii", "iii", "iv"][i]}</p><h3 class="pd-part-t">${esc(x.t)}</h3><p>${esc(x.b)}</p><span class="pd-part-more" aria-hidden="true">Read more<span class="arr">→</span></span></div><div class="pd-part-fig">${x.fig}</div></a>`)}</div>
  </div>
</section>`;

  // §2 Where each feature sits: one "Fig." plate per feature, its layer of
  // Concept C's anatomy (spec §4 "Where it lives"). Names, lines and status
  // come from the shared trace data, so they match the showcase exactly.
  const bd = brainData(), tbl = href("/trainer-brain");
  const st = (id) => bd.labels.status[bd.sp[id].status];
  const LAYERS = [
    ["b", "/features/safety", "Safety", ["safety"], "Reads every message first. Pain or red flags pause training. No AI is called.", "STOP · No AI called"],
    ["f", "/features/chat-and-digital-coach", "Chat and digital coach", ["reply_picker", "draft_writer"], "A rule fits: it picks your approved reply. None fits: it drafts one, and it waits for you.", "Chat replies have no score"],
    ["g", "/features/ai-training-plans", "AI training plans", ["plan_writer", "confidence"], "Plans carry a score. Below your bar, the plan waits for you.", "86% · your bar 80%"],
    ["f", "/features/nutrition", "Nutrition", ["meal_photo", "meal_planner"], "Estimates a meal from a photo. Nothing is saved until the member confirms.", "4 items · all unsure"],
    ["f", "/features/voice-coach", "Voice coach", ["voice_lines", "set_logger"], "Opens with your safety line. “Too heavy” follows your rule. “Pain” stops the session.", "Your 10% rule → 54 kg"],
    ["d", "/features/progress-and-client-twin", "Progress and client twin", ["memory"], bd.sp.memory.line, "Facts from your app only"],
  ];
  const layersBand = `<section class="band c-inkband" id="layers" aria-labelledby="layers-h">
  <div class="wrap">
    ${sectionHead({ n: 2, title: "Where each feature sits", id: "layers-h", lede: "Each feature is one layer of the same decision. Code picks one specialist per moment; your rules check every layer." })}
    <ol class="c-fps" data-reveal data-stagger>${each(LAYERS, ([k, p, t, ids, line, tag]) => `<li class="c-fp"><a href="${href(p)}">
      <span class="c-fp-fig">Fig. 3${k}</span><span class="c-fp-t">${esc(t)}</span>
      <span class="c-fp-nodes">${ids.map((id) => nodeChip(bd, id)).join("")}</span>
      <span class="c-fp-d">${esc(line)}</span>
      <span class="c-fp-f"><span class="c-fp-tag${k == "b" ? " is-stop" : ""}">${esc(tag)}</span><span class="c-fp-s">${esc(st(ids[0]))}</span></span></a></li>`)}</ol>
    <p class="c-fp-note">Sample values. Fig. 3 takes one decision apart, layer by layer. ${linkArrow("See Fig. 3", "/trainer-brain#decides")}</p>
  </div>
</section>`;

  // §3 What your subscribers get: eight numbered items.
  const subsCards = page.sections.find((s) => s.id === "subscribers").cards;
  const extra = {
    "Your voice, optionally": chip("addon", "Add-on") + statusChip("voice", "Not on yet for subscribers", "Live"),
    "Nutrition, optionally": chip("optional", "Optional tier"),
    "You, when it matters": `<span class="pd-nl">Paid sessions: ${statusChip("payments", "Not on yet", "Live")}</span>`,
  };
  const subsBand = `<section class="band band--paper" id="subscribers" aria-labelledby="subs-h">
  <div class="wrap">
    ${sectionHead({ n: 3, title: "What your subscribers get", id: "subs-h", lede: "Once your page is live, under your name." })}
    <ol class="pd-eight" data-reveal data-stagger>${each(subsCards, (c, i) => `<li><span class="pd-eight-n">${["i", "ii", "iii", "iv", "v", "vi", "vii", "viii"][i]}</span><div><h3 class="pd-eight-t">${esc(c.title)}</h3><p>${esc(plain(c.body).replace("An add-on where a voice in your own verified voice runs the session.", "An add-on: your own verified voice runs the session."))}</p>${extra[c.title] ? `<p class="chips">${extra[c.title]}</p>` : ""}</div></li>`)}</ol>
  </div>
</section>`;

  // §3 Inside the product: five screens, visitor-chosen tabs.
  const screen = (n, cap, figHtml, notes) => `<div class="pd-screen"><figure class="fig pd-screen-fig"><div class="fig-body">${figHtml}</div>${figCap(h, n, cap)}</figure><div class="mnote" role="note">${notes}</div></div>`;
  const screens = [
    { id: "inbox", label: "Inbox", panelHtml: screen(3, "Your inbox", win("Inbox · Layla Strength", `<ul class="pd-log-list pd-log-list--lg"><li><em class="pd-st pd-st--ok">Sent on its own</em><span>Squat 60 → 62.5 kg</span><small>rule 07 · reason logged</small></li><li><em class="pd-st pd-st--you">To you</em><span>Hotel gym for two weeks</span><small>draft: dumbbells to 20 kg</small></li><li><em class="pd-st pd-st--pause">Paused</em><span>Knee pain reported</span><small>workout paused · alert sent</small></li></ul>`, { label: "Sample inbox with applied, handed-to-you and paused items" }), `<span class="mnote-k">Your inbox</span>What it applied, what it handed to you, and what paused. Approve or correct in one tap.`) },
    { id: "today", label: "Today", panelHtml: screen(3, "Their day, dated", ph(`${appTop()}<p class="app-h">Today</p><p class="app-sub">Monday · Week 3 · Lower body A</p><div class="app-card"><p class="app-row"><span>Back squat 4 × 6</span><b>62.5 kg</b></p><p class="app-row"><span>Romanian deadlift 3 × 8</span><b>50 kg</b></p><p class="app-row"><span>Walking lunge 3 × 10</span><b>16 kg</b></p></div><div class="app-btn">Start workout</div><p class="app-offline"><span class="app-badge">${icon("check", { size: 12 })}Saved offline</span></p>${tabbar("Plan")}`, { label: "Sample Today screen", cls: "pd-phone--md" }), `<span class="mnote-k">Today</span>A dated session, built from your rules. Works offline in the gym.`) },
    { id: "logger", label: "Logger", panelHtml: screen(3, "Logging a set", ph(`<p class="pd-sess-k">Guided session · 2 of 3</p><p class="app-h">Back squat</p><p class="app-sub">Set 2 of 4 · target 6 reps at 62.5 kg</p><div class="pd-log"><p><span>Reps</span><b>6</b></p><p><span>Load</span><b>62.5 kg</b></p><p><span>In reserve</span><b>3</b></p></div><div class="pd-rest"><svg viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="19"/><circle class="pd-rest-fill" cx="22" cy="22" r="19" pathLength="100"/></svg><p><b class="tnum">1:45</b><span>Rest</span></p></div><div class="app-btn">Log set</div><p class="pd-pain">Report pain</p>`, { label: "Sample set logger with rest timer", cls: "pd-phone--md" }), `<span class="mnote-k">Logger</span>Reps, load and effort per set, with a rest timer. Logged effort feeds the next decision.`) },
    { id: "statement", label: "Statement", panelHtml: screen(3, "A month, gross to net", `<div class="stmt" role="img" aria-label="Sample statement"><div class="stmt-head"><p class="stmt-t">Statement · October</p><div class="chips">${sampleLabel("Sample")}${statusChip("payments", "Not on yet", "Live")}</div></div><dl class="stmt-lines"><div><dt>150 subscribers × AED 199</dt><dd class="tnum">${calc.aedWhole(subs)}</dd></div><div><dt>Our share, by band</dt><dd class="tnum">−${calc.aedWhole(comm)}</dd></div><div><dt>Payment processing</dt><dd><span class="placeholder">itemised · decision 3</span></dd></div><div><dt>Before card processing</dt><dd class="tnum">${calc.aedWhole(subs - comm)}</dd></div></dl></div>`, `<span class="mnote-k">Statement</span>Every cost on one page. ${linkArrow("The commission maths", "/pricing")}`) },
    { id: "editor", label: "Editor", panelHtml: screen(3, "Your site, on desktop", win("Website editor · desktop", `<div class="pd-ed pd-ed--sm"><div class="pd-ed-rail"><p class="pd-sw-k">Sections</p><ul><li>Hero</li><li>Programmes</li><li class="is-pick">Before and after</li><li>Pricing</li><li>Contact form</li></ul></div><div class="pd-ed-canvas"><p class="pd-ed-nav"><b>Home</b><span>Coaching</span><span>Results</span><span>Contact</span></p><div class="pd-ed-block pd-ed-hero"><p class="pd-ed-t">Strength coaching, planned for you</p><span class="btn-ui btn-ui--ink">Join</span></div><div class="pd-ed-block"><p class="pd-ed-k">Before and after</p><p class="pd-ed-pair"><span>Before</span><span>After</span></p></div></div></div>`, { label: "Sample desktop website editor" }), `<span class="mnote-k">Editor</span>282 layouts in 40 section families. Desktop-only, with phone and tablet previews.`) },
  ];
  const insideBand = `<section class="band" id="inside" aria-labelledby="inside-h">
  <div class="wrap">
    ${sectionHead({ n: 4, title: "Inside the product", id: "inside-h", lede: "Five screens. Choose one; nothing changes on its own." })}
    <div data-reveal>${tabs({ id: "screens", label: "Product screens", tabs: screens, className: "pd-screens" })}</div>
  </div>
</section>`;

  // §4 Tools it replaces (id="replaces", test-encoded).
  const replacesBand = `<section class="band band--paper" id="replaces" aria-labelledby="replaces-h">
  <div class="wrap">
    ${sectionHead({ n: 5, title: "Tools it replaces", id: "replaces-h", lede: "Generic tool categories. Once your page is live, each becomes part of one workspace." })}
    <div class="tbl-wrap" data-reveal><table class="tbl pd-rtab"><caption>Instead of separate subscriptions</caption>
      <thead><tr><th scope="col">Instead of</th><th scope="col">In trainsyou</th></tr></thead>
      <tbody>${each(REPLACES, ([t, d, f], i) => `<tr style="--i:${i}"><th scope="row"><span class="pd-struck">${esc(t)}<svg class="pd-strike" aria-hidden="true" width="100%" height="4" preserveAspectRatio="none"><line x1="0" y1="2" x2="100%" y2="2" pathLength="100"/></svg></span></th><td>${esc(d)}${f ? ` ${statusChip(f, "Not on yet", "Live today")}` : ""}</td></tr>`)}</tbody>
    </table></div>
  </div>
</section>`;

  // §5 Feature guides (id="feature-guides"): the editorial index.
  const guides = Object.keys(FEATURES).map((p) => ({ p, pg: pageFor(p), f: FEATURES[p] }));
  const guidesBand = `<section class="band" id="feature-guides" aria-labelledby="guides-h">
  <div class="wrap">
    ${sectionHead({ n: 6, title: "Feature guides", id: "guides-h", lede: "Eleven short chapters, each with a worked figure." })}
    <ol class="pd-guides" data-reveal data-stagger>${each(guides, ({ p, pg, f }, i) => `<li><a href="${href(p)}"><span class="pd-g-n tnum">${String(i + 1).padStart(2, "0")}</span><span class="pd-g-main"><span class="pd-g-t">${esc(pg.navLabel)}</span><span class="pd-g-d">${esc(f.line)}</span></span><span class="pd-g-chips">${featureChips(pg)}</span><span class="arr pd-g-arr" aria-hidden="true">→</span></a></li>`)}</ol>
  </div>
</section>`;

  // §6 All capabilities, as Appendix A (id="all-capabilities"), collapsed.
  const capBand = `<section class="band band--paper" id="all-capabilities" aria-labelledby="caps-h">
  <div class="wrap">
    ${sectionHead({ n: 7, titleHtml: `All ${CAPABILITY_COUNT} capabilities`, id: "caps-h", lede: `Appendix A. One workspace, in ${MATRIX.length} areas. Open any area.` })}
    <div class="pd-legend" data-reveal><span class="pd-legend-k">Key</span>${chip("included", "Live today")}${chip("noton", "Not on yet")}${chip("optional", "Optional tier")}${chip("addon", "Add-on")}</div>
    <div class="pd-caps" data-caps>${each(MATRIX, (g, i) => `<div class="pd-cap" id="cap-${g.id}" data-reveal style="--i:${Math.min(i, 5)}">
      <h3 class="pd-cap-h"><button class="pd-cap-q" type="button" aria-expanded="false" aria-controls="cap-${g.id}-list" id="cap-${g.id}-q"><span class="pd-cap-n">A${i + 1}</span><span class="pd-cap-t">${esc(g.title)}</span><span class="pd-cap-aud">${esc(g.audience)}</span><span class="pd-cap-c tnum">${g.items.length}</span><span class="faq-icon" aria-hidden="true"></span></button></h3>
      <div class="pd-cap-a" id="cap-${g.id}-list" role="region" aria-labelledby="cap-${g.id}-q"><div>
        <ul class="pd-cap-list">${each(g.items, (it) => `<li><div><b>${esc(it[0])}</b><span>${esc(it[1])}</span></div><span class="chips">${capChip(it)}</span></li>`)}</ul>
        ${g.page ? `<p class="pd-cap-more">${linkArrow(`More about ${g.title.toLowerCase()}`, g.page)}</p>` : ""}
      </div></div>
    </div>`)}</div>
  </div>
</section>`;

  // §7 FAQ (2).
  const faqs = [
    { q: "Are all features available today?", a: "Most are. Subscriber payments, payouts, paid bookings and voice for subscribers are not on yet, and publishing your page waits for payments. Each item above shows its status." },
    { q: "Is the subscriber app a separate download?", a: page.faqs[1].a },
  ];
  const questions = questionsBand(h, { n: 8, id: "feat-faq", faqs, sideHtml: `<div class="mnote" role="note"><span class="mnote-k">Next</span>${linkArrow("See the pricing", "/pricing")}${linkArrow("Try the demo", "/demo")}</div>` });

  checkCopy(page.path, { h1: "Everything you need, under your own name", h2: ["Four parts of one platform", "What your subscribers get", "Inside the product", "Tools it replaces", "Feature guides", `All ${CAPABILITY_COUNT} capabilities`], lede: "Your AI, a branded app and website, nutrition, bookings, payments and safety rules, in one workspace.", faqs, cards: [...parts.map((x) => x.b), ...subsCards.map((c) => plain(c.body))] });
  return {
    main: [hero, partsBand, layersBand, subsBand, insideBand, replacesBand, guidesBand, capBand, questions].join("\n"),
    css: CSS.anatomy,
    title: page.title,
    closing: { label: "See the pricing", path: "/pricing" },
  };
}

// ===========================================================================
// /features/*: the feature detail template (Fig. 1–3, facts in the margin)
// ===========================================================================

function featureDetail(path) {
  return ({ page, href, h, pageFor }) => {
    const { esc, cta, secondary, linkArrow, sectionHead, mark, h1Html, figure, table, icon } = h;
    const f = FEATURES[path];
    const s = SPECS[path](page);
    const slug = path.split("/").pop();

    const langToggle = s.hero.rtl
      ? `<button class="pd-lang" type="button" role="switch" aria-checked="false" data-flag="rtl-preview" data-on="on" data-off="off" aria-label="Arabic preview, right to left"><span class="pd-lang-o">EN</span><span class="pd-lang-o" lang="ar">العربية</span><span class="pd-lang-k" aria-hidden="true"></span></button>`
      : "";
    const heroFig = `<figure class="hero-fig pd-fhero-fig" aria-labelledby="${slug}-fig1">
  ${s.hero.html}
  ${figCap(h, 1, s.hero.caption, s.hero.chip || "", `${slug}-fig1`)}
  ${langToggle ? `<div class="pd-lang-row"><span>Member app language</span>${langToggle}</div>` : ""}
</figure>`;
    const strip = s.statusStrip
      ? `<p class="status-strip">${h.flagged(
          "payments",
          `<span class="chip-dot" aria-hidden="true"></span>Subscriber payments and payouts are not on yet. <a href="${href("/pricing", "#status")}">What works today<span class="arr" aria-hidden="true">→</span></a>`,
          `${icon("check", { size: 16 })}Subscriber payments and payouts are live. <a href="${href("/pricing", "#status")}">What works today<span class="arr" aria-hidden="true">→</span></a>`,
        )}</p>`
      : "";
    const hero = heroShell(h, {
      id: `${slug}-h1`,
      eyebrow: `Feature · ${page.navLabel}`,
      h1Html: h1Html(f.h1, s.mark),
      chipsHtml: `<div class="pd-hero-chips">${featureChips(page)}</div>`,
      lede: s.lede,
      extraHtml: strip,
      actionsHtml: cta({ location: "hero" }) + secondary("Back to all features", "/features", { location: "hero" }),
      figHtml: heroFig,
      cls: `pd-hero--feature pd-hero--${slug}`,
    });

    // §1 What it does.
    const does = `<section class="band" id="does" aria-labelledby="${slug}-does">
  <div class="wrap">
    ${sectionHead({ n: 1, title: "What it does", id: `${slug}-does` })}
    <div class="ms">
      ${manualList(s.does.slice(0, 5).map((t) => ({ title: t })), { cls: "pd-mlist--does" })}
      <div class="mnote pd-glance" role="note" data-reveal><span class="mnote-k">At a glance</span>${featureChips(page)}<p>${s.doesNote}</p></div>
    </div>
  </div>
</section>`;

    // §2 + §3: the spread, subscriber page and trainer page side by side.
    const side = (n, id, title, spec, figN, kind) => `<section class="pd-side pd-side--${kind}" aria-labelledby="${slug}-${id}">
      ${sectionHead({ n, title, id: `${slug}-${id}` })}
      ${figure({ n: figN, caption: spec.caption, bodyHtml: `<div class="pd-side-plate">${spec.fig}</div>`, className: `pd-side-fig pd-side-fig--${kind}` })}
      <ul class="pd-ticks" data-reveal data-stagger>${spec.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>
    </section>`;
    const spread = `<div class="band band--paper pd-spread-band">
  <div class="wrap pd-spread">
    ${side(2, "sees", "What your subscriber sees", s.sees, 2, "sub")}
    ${side(3, "control", "What you control", s.control, 3, "you")}
  </div>
</div>`;

    // §4 How it runs.
    const runs = `<section class="band" id="runs" aria-labelledby="${slug}-runs">
  <div class="wrap">
    ${sectionHead({ n: 4, title: "How it runs", id: `${slug}-runs`, lede: s.runs.title + "." })}
    ${s.runs.steps ? procedure(s.runs.steps) : `<div data-reveal>${table({ ...s.runs.table, className: "pd-runs-tbl" })}</div>`}
  </div>
</section>`;

    // §5 Questions + related features.
    const related = relatedList(page.related || [], { pageFor, href, label: "Related" });
    const questions = questionsBand(h, { n: 5, id: `${slug}-faq`, faqs: s.faqs, paper: true, sideHtml: related });

    checkCopy(path, { h1: f.h1, h2: ["What it does", "What your subscriber sees", "What you control", "How it runs"], lede: s.lede, faqs: s.faqs });
    return {
      main: [hero, does, spread, runs, questions].join("\n"),
      title: page.title,
      closing: { label: "Back to all features", path: "/features" },
      bodyClass: "pd-feature-page",
    };
  };
}

// ===========================================================================
// /demo: worked examples, rule builder, threshold
// ===========================================================================

function demo({ page, href, h }) {
  const { esc, each, cta, secondary, linkArrow, sectionHead, icon, mark, tabs, liveRegion, sampleLabel, chip, ruleCard } = h;
  const lanes3 = (active) => `<ol class="lanes pd-lanes" data-lanes>${each([["applied", "Applied automatically", "check"], ["toyou", "Unsure → to you", "user"], ["paused", "Pain → paused, to you", "pause"]], ([k, t, ic]) => `<li class="lane lane--${k}${k === active ? " is-active" : ""}" data-lane="${k}">${icon(ic, { size: 16 })}<span>${esc(t)}</span><span class="lane-token" aria-hidden="true"></span></li>`)}</ol>`;

  // Hero: one decision read as a worked example (the t1 fixture; chat replies have no score).
  const key = `<aside class="pd-key" aria-labelledby="key-k">
  <p class="pd-key-k" id="key-k"><span>One decision, as a worked example</span>${sampleLabel()}</p>
  <ol>
    <li><span>1</span><b>The message</b><em>“All four of my back squat sets were at RIR 2 last session. Can I go up in weight?”</em></li>
    <li><span>2</span><b>Your rule</b><em>Barbell load progression: +2.5 kg, inside your 5% cap</em></li>
    <li><span>3</span><b>How sure</b><em>Chat replies have no score. They must cite your rule.</em></li>
    <li><span>4</span><b>The outcome</b><em class="tnum">Sent on its own, within your rules: 62.5 kg</em></li>
  </ol>
  ${linkArrow("Throw your own moment", "#play")}
</aside>`;
  const hero = heroShell(h, {
    id: "demo-h1",
    eyebrow: "Interactive demo",
    h1Html: "See your AI make a coaching decision",
    lede: "Pick a message. Watch each check and the one specialist code picks, and see where it goes. Then change a setting.",
    extraHtml: `<p class="pd-scripted">${icon("check", { size: 15 })}Scripted examples. No AI model is called.</p>`,
    actionsHtml: cta({ location: "hero" }) + secondary("See how it works", "/how-it-works", { location: "hero" }),
    figHtml: key,
    cls: "pd-hero--demo",
  });

  // §1 The shared playground (spec §5), in C's worked-example skin.
  const play = `<section class="band band--paper c-playband" id="play" aria-labelledby="play-h">
  <div class="wrap">
    ${sectionHead({ n: 1, title: PLAY_COPY.h2, id: "play-h", lede: PLAY_COPY.lede })}
    <figure class="fig c-playfig">${playground({ id: "playground", labelledby: "play-h" })}<figcaption class="fig-cap"><span class="fig-n">Fig. 1</span><span class="fig-t">Twelve sample moments, each worked through</span>${sampleLabel()}</figcaption></figure>
    <p class="c-play-more">${linkArrow("See one decision taken apart", "/trainer-brain#decides")}</p>
  </div>
</section>`;

  // §4 What happens next in your account.
  const next = `<section class="band" id="next" aria-labelledby="next-h">
  <div class="wrap">
    ${sectionHead({ n: 2, title: "What happens in your account", id: "next-h" })}
    <div class="pd-next">
      <div class="pd-next-copy" data-reveal>
        <p class="big-p">You’ll teach your real rules in setup. Every reply waits for you until you choose otherwise.</p>
        <div class="hero-actions">${cta({ location: "inline" })}${secondary("See how it works", "/how-it-works", { location: "inline" })}</div>
      </div>
      <div class="pd-next-card" data-reveal>${ruleCard({ status: "confirmed", actions: false, kicker: "Your first rule", text: "Your words go here, with their source.", source: "Your interview", scope: "Your subscribers" })}<p class="fine pd-next-note">Automatic sending needs 20 cases and passing checks.</p></div>
    </div>
  </div>
</section>`;

  // §5 FAQ (4).
  const faqs = [
    { q: "Can I test my own AI before launch?", a: "Yes. Write test cases with the answer you expect. Your AI is checked against them before a version can be published." },
    { q: "Is this a real AI response?", a: "No. These are scripted examples that show the decision flow. Your real AI uses your own confirmed rules and a tested release." },
    { q: "Who decides what sends on its own?", a: "You do. Chat replies send on their own only at Brain level 2 or 3, using replies you approved. Plans use your bar: how sure it must be to send alone." },
    { q: "What happens when a subscriber reports pain?", a: PAIN_A },
  ];
  const questions = questionsBand(h, { n: 3, id: "demo-faq", faqs, paper: false, sideHtml: `<div class="mnote" role="note"><span class="mnote-k">Read next</span>${linkArrow("How your AI decides", "/trainer-brain")}${linkArrow("Safety rules in code", "/features/safety")}</div>` });

  checkCopy(page.path, { h1: "See your AI make a coaching decision", h2: [PLAY_COPY.h2, "What happens in your account"], lede: "Pick a message. Watch each check and the one specialist code picks, and see where it goes. Then change a setting.", faqs });
  return {
    main: [hero, play, next, questions].join("\n"),
    title: "See an AI coach decide: interactive demo",
    description: "Twelve scripted sample moments: watch the checks and the one specialist code picks, then change a setting and run it again. No AI model is called.",
    css: CSS.play,
    bodyEnd: BOOT,
    closing: { label: "See how it works", path: "/how-it-works" },
  };
}

// ===========================================================================
// /security-and-privacy: "Our commitments", versioned and signed
// ===========================================================================

function security({ page, href, h }) {
  const { esc, each, cta, secondary, linkArrow, sectionHead, icon, mark, statusChip, chip, figure } = h;
  const commitments = [
    { t: "Strong sign-in", b: "Passkeys, authenticator apps and one-time recovery codes. See every signed-in device and sign one out remotely.", note: "Available to every account. Whether each account must use them depends on platform settings. See §4." },
    { t: "Your workspace, walled off", b: "Each workspace is separated at the database layer. Another trainer never sees your subscribers, teaching or records.", note: "Subscribers see only their own records." },
    { t: "Keys, logs and HTTPS", b: "Provider keys are encrypted at rest. Sensitive actions are recorded in audit logs. Every page is served over HTTPS.", note: "Private previews and app pages stay out of search engines." },
    { t: "Consent, export and deletion", b: "Separate choices for coaching data, marketing and analytics. Withdraw coaching-data consent in one step. Download or delete your data.", note: "Trainers and subscribers both." },
    { t: "Digital guidance is labelled", b: "Subscribers accept a digital coaching disclosure when they join. Digital replies are always labelled.", noteHtml: linkArrow("Read the AI disclosure", "/ai-disclosure") },
    { t: "Card data stays with Stripe", b: "Card numbers are handled by Stripe checkout, not stored by trainsyou. Payouts go only to a verified UAE IBAN, with a short hold after a bank change.", chipHtml: statusChip("payments", "Not on yet", "Live today"), note: "Applies once subscriber payments are on." },
  ];
  const cover = `<aside class="pd-cover" aria-labelledby="cover-t">
  <p class="pd-cover-k">Our commitments · v1</p>
  <p class="pd-cover-t" id="cover-t">Six things we do to protect you and your subscribers</p>
  <ol class="pd-cover-list">${each(commitments, (c, i) => `<li><a href="#c-${i + 1}"><span class="toc-n">${i + 1}</span><span>${esc(c.t)}</span></a></li>`)}</ol>
  <p class="pd-cover-sign"><span class="sig-line" aria-hidden="true"></span><span class="placeholder">Founder’s signature</span></p>
  <p class="pd-cover-date tnum">Version 1 · 26 Oct 2026</p>
</aside>`;
  const hero = heroShell(h, {
    id: "sec-h1",
    eyebrow: "Security and privacy",
    h1Html: `How we ${mark("protect")} you and your subscribers`,
    lede: "Your workspace is walled off, sign-in is strong, and operator access is logged. Here is what we commit to, in plain words.",
    actionsHtml: cta({ location: "hero" }) + secondary("Read the AI disclosure", "/ai-disclosure", { location: "hero" }),
    figHtml: cover,
    cls: "pd-hero--sec",
  });

  // §1 The commitments sheet.
  const sheet = `<section class="band band--paper" id="commitments" aria-labelledby="com-h">
  <div class="wrap">
    ${sectionHead({ n: 1, title: "Our commitments", id: "com-h", lede: "Six facts about how the platform works today. Each is true now; we don’t list plans." })}
    <article class="pd-sheet" aria-labelledby="com-h">
      <header class="pd-sheet-head" data-reveal><p class="pd-cover-k">trainsyou · Our commitments</p><p class="pd-sheet-v tnum">Version 1 · 26 Oct 2026</p></header>
      <ol class="pd-com">${each(commitments, (c, i) => `<li class="ms-row" id="c-${i + 1}" data-reveal>
        <div class="ms-text"><p class="pd-com-n">${String(i + 1).padStart(2, "0")}</p><h3 class="pd-com-t">${esc(c.t)}${c.chipHtml ? ` ${c.chipHtml}` : ""}</h3><p>${esc(c.b)}</p></div>
        <div class="mnote" role="note">${c.noteHtml || esc(c.note)}</div>
      </li>`)}</ol>
      <footer class="pd-sheet-foot" data-reveal>
        <p class="never-sign"><span class="sig-line" aria-hidden="true"></span><span class="placeholder">Founder’s name and signature</span><span class="sig-note">owner to supply · decision 2</span></p>
        <p class="fine">When anything here changes, the version and date change with it.</p>
      </footer>
    </article>
  </div>
</section>`;

  // §2 Operator access (audit ledger, sample).
  const ledger = `<div class="pd-audit" role="img" aria-label="Sample audit log entries: every operator access is recorded with who, what and why">
  <p class="pd-audit-h"><span>Time</span><span>Who</span><span>Action</span><span>Check</span></p>
  <p><span class="tnum">10:42</span><span>Operator · support</span><span>Opened workspace settings</span><span>${icon("check", { size: 13 })}Logged</span></p>
  <p><span class="tnum">10:44</span><span>Operator · support</span><span>Viewed a payout hold</span><span>${icon("check", { size: 13 })}Logged</span></p>
  <p class="pd-audit-cond"><span class="tnum">10:45</span><span>Operator · finance</span><span>Changed a payout setting</span><span>Fresh authenticator check, when enforcement is on</span></p>
</div>`;
  const operators = `<section class="band" id="operators" aria-labelledby="op-h">
  <div class="wrap">
    ${sectionHead({ n: 2, title: "Operator access", id: "op-h" })}
    ${h.msRow(`<p class="big-p">Every operator access is audited. A fresh authenticator check applies when authenticator enforcement is switched on.</p>`, `<span class="mnote-k">How</span>Operators use separate administration tools with role-based access.`)}
    ${figure({ n: 1, caption: "An audit log", bodyHtml: ledger, className: "pd-audit-fig" })}
  </div>
</section>`;

  // §3 Your method and voice.
  const method = `<section class="band band--paper" id="method" aria-labelledby="mv-h">
  <div class="wrap">
    ${sectionHead({ n: 3, title: "Your method and voice", id: "mv-h" })}
    <div class="two" data-reveal data-stagger>
      <div><h3 class="h3">${icon("lock", { size: 18 })}Your method</h3><p>Your AI (we call it your Trainer Brain) coaches only your subscribers. Your rules, cases and corrections are never used for another trainer.</p><p>${linkArrow("How your AI is built", "/trainer-brain")}</p></div>
      <div><h3 class="h3">${icon("mic", { size: 18 })}Your voice</h3><p>Used only after identity verification and your recorded consent, which you can withdraw.</p><p>${linkArrow("Voice coach", "/features/voice-coach")}</p></div>
    </div>
  </div>
</section>`;

  // §4 Plain-language caveats.
  const caveats = [
    ["Checks depend on settings", "Authenticator and passkey sign-in are available. Whether every account must use them depends on how the platform is set up."],
    ["No certification claims", "This page doesn’t claim any certification or compliance label. It describes what the platform does today."],
    ["Payment protections wait for payments", "Subscriber payments and payouts are not on yet. The card and payout protections apply once they are."],
  ];
  const caveatBand = `<section class="band" id="caveats" aria-labelledby="cav-h">
  <div class="wrap">
    ${sectionHead({ n: 4, title: "What we don’t claim", id: "cav-h" })}
    <ol class="pd-cav" data-reveal data-stagger>${each(caveats, ([t, b]) => `<li><h3 class="pd-cav-t">${esc(t)}</h3><p>${esc(b)}</p></li>`)}</ol>
  </div>
</section>`;

  // §5 FAQ (5).
  const faqs = [
    { q: "Are sensitive actions protected?", a: "Sensitive actions use permission checks and audit logs. Fresh authenticator codes are required when authenticator enforcement is switched on. Having the feature doesn’t mean every account must use it." },
    { q: "Who can see my AI?", a: "You, and team members whose role allows coaching screens. Your teaching is private to your workspace and never used for another trainer." },
    { q: "Can I download my data?", a: page.faqs[2].a },
    { q: "Who can see my subscribers’ data?", a: "You and team members whose role allows it. Other trainers can’t. Platform operators use separate, audited tools, with a fresh authenticator check when enforcement is on." },
    { q: "Is wearable data sent to the AI?", a: page.faqs[4].a },
  ];
  const questions = questionsBand(h, { n: 5, id: "sec-faq", faqs, paper: true, sideHtml: `<div class="mnote" role="note"><span class="mnote-k">Related</span>${linkArrow("Safety rules in code", "/features/safety")}${linkArrow("Privacy policy", "/privacy")}${linkArrow("AI disclosure", "/ai-disclosure")}</div>` });

  checkCopy(page.path, { h1: "How we protect you and your subscribers", h2: ["Our commitments", "Operator access", "Your method and voice", "What we don’t claim"], lede: "Your workspace is walled off, sign-in is strong, and operator access is logged. Here is what we commit to, in plain words.", faqs });
  return {
    main: [hero, sheet, operators, method, caveatBand, questions].join("\n"),
    title: "Secure coaching platform: protecting your business and data",
    description: "How trainsyou protects your business and your subscribers’ data: passkeys, authenticator apps, database-level isolation, encrypted keys, audit logs and consent.",
    closing: { label: "Read the AI disclosure", path: "/ai-disclosure" },
  };
}

// ===========================================================================

export const pages = {
  "/how-it-works": howItWorks,
  "/trainer-brain": trainerBrain,
  "/features": featuresIndex,
  "/demo": demo,
  "/security-and-privacy": security,
  ...Object.fromEntries(Object.keys(FEATURES).map((p) => [p, featureDetail(p)])),
};
