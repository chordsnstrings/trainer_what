// Audience pages for concept C "The Method":
//   /for-trainers (chapter list), /for-trainers/* (4 specialty chapters),
//   /uae (local brief), /get-started (checklist sheet), /signup (C12,
//   protected path), /login (C24).
// Copy is the section C proposed copy (pending owner approval, decision 18);
// everything else comes from content.json. Styles: site/assets/audience.css.
// Behaviour: site/assets/audience.js.
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { ROOT } from "./lib/content.mjs";

const require = createRequire(import.meta.url);
const calc = require(resolve(ROOT, "site/assets/calc.js"));

const PAY_CHIP = ["payments", "Not on yet: subscriber payments", "Subscriber payments live"];
const PAIN_FAQ = {
  q: "What happens when a subscriber reports pain?",
  a: "The workout pauses and you are alerted. Pain, medical issues and red flags are routed to you by rules enforced in code, outside your AI, so no prompt or setting can switch them off. Normal training stays paused until you review it.",
};

// ---------------------------------------------------------------------------
// Specialty data (content.json rules, shortened to the card budget where the
// blueprint gives a shorter form). Chapter numbers match the hub's contents.

const SPEC = {
  "/for-trainers/weight-loss": {
    ch: "I", n: 1, name: "Weight loss", key: "weight-loss",
    h1: "Weight-loss coaching, taught to your own AI",
    lede: "Teach your rules on load, adherence and habits once. Your AI adapts every plan as subscribers log, and asks you when unsure.",
    hub: "Load, adherence and habits, decided every day.",
    quote: "Two missed sessions in a week: hold next week’s volume.",
    rules: [
      ["Missed days", "When a subscriber misses two sessions in a week, keep next week’s volume the same instead of progressing.", "Reads the sessions logged that week."],
      ["Steady progress", "When weekly check-ins show steady progress, keep the plan and add one short conditioning finisher.", "Reads weekly check-ins."],
      ["Stalled progress", "No change for three weekly check-ins: flag the calorie target for review instead of cutting further.", "Hands the decision to you."],
    ],
    hero: {
      mark: "the same", scope: "Every weight-loss plan", who: "Sample subscriber · week 5", cap: "Rule 1.1, applied to a missed week",
      lines: [
        ["Sessions done", `<span class="au-dots" aria-hidden="true"><i class="on"></i><i class="on"></i><i></i><i></i></span><span>2 of 4</span>`],
        ["Missed this week", "2"],
      ],
      next: "Next week’s volume", from: "Progress", to: "Same as week 5", w: "14ch", delta: "Held",
    },
    paused: ["Dizziness, fainting or chest pain during exercise."],
    topics: [
      ["Requests for a very low-calorie diet or a rapid weight-loss target", true],
      ["Disordered-eating signals in chat or check-ins", true],
      ["Questions about medication", false],
    ],
    phases: [[2, "Weeks 1–2", "Habits"], [6, "Weeks 3–8", "Strength and conditioning"], [4, "Weeks 9–12", "Consolidation"]],
    weeks: 12,
    faqs: [
      { q: "Can my AI set calorie targets?", a: "Targets follow the calorie methods you teach, and you can edit any client’s target. Requests outside your rules come to you." },
      PAIN_FAQ,
    ],
  },
  "/for-trainers/strength": {
    ch: "II", n: 2, name: "Strength", key: "strength",
    h1: "Strength coaching, taught to your own AI",
    lede: "Teach your progression, deload and technique rules once. Your AI applies them to every lifter, and asks you when it’s unsure.",
    hub: "Load, reps in reserve, deloads and technique.",
    quote: "After two sessions at 3+ reps in reserve, add 2.5 kg.",
    rules: [
      ["Progress on evidence", "After two sessions at 3+ reps in reserve, add 2.5 kg.", "Reads logged reps in reserve."],
      ["Technique before load", "Form doubts: repeat the load and add a technique cue.", "Reads the lifter’s notes."],
      ["Deload", "Three weeks of rising effort: deload at 60% volume.", "Reads effort across weeks."],
    ],
    hero: {
      mark: "add 2.5 kg", scope: "Squat, bench press, deadlift", who: "Sample lifter · week 4", cap: "Rule 2.1, applied to a logged lift",
      lines: [
        ["Back squat, last two sessions", "4 × 6 at 62.5 kg"],
        ["Reps in reserve", "3, then 3"],
      ],
      next: "Next session", from: "62.5 kg", to: "65 kg", w: "8ch", delta: "+2.5 kg",
    },
    paused: ["Joint pain during or after a lift.", "A return from injury."],
    topics: [
      ["Requests to test a one-rep max without a coached session", true],
      ["Programme changes in the weeks before a competition", true],
      ["Supplement questions", false],
    ],
    phases: [[3, "Weeks 1–3", "Technique"], [6, "Weeks 4–9", "Progressive overload"], [1, "Week 10", "Deload"]],
    weeks: 10,
    faqs: [
      { q: "Does it read logged reps in reserve?", a: "Yes. Subscribers log reps, load and effort; your rules decide how those drive progression." },
      PAIN_FAQ,
    ],
  },
  "/for-trainers/muscle-gain": {
    ch: "III", n: 3, name: "Muscle gain", key: "muscle-gain",
    h1: "Muscle-gain coaching, taught to your own AI",
    lede: "Teach your volume, exercise and recovery rules once. Your AI builds each plan around schedule and equipment, and asks you when unsure.",
    hub: "Weekly volume, exercise swaps, recovery and food.",
    quote: "Add one set per muscle group a week while recovery is good.",
    rules: [
      ["Volume steps", "Add one set per muscle group per week while sessions are completed and recovery is reported as good.", "Reads completion and recovery."],
      ["Equipment swaps", "When a machine is unavailable, swap to the approved alternative for the same muscle and rep range.", "Uses alternatives you approved."],
      ["Recovery", "When soreness is reported for three days running, hold volume for a week.", "Reads daily check-ins."],
    ],
    hero: {
      mark: "one set", scope: "Every hypertrophy block", who: "Sample subscriber · week 3", cap: "Rule 3.1, applied to a good week",
      lines: [
        ["Chest, sets a week", `<span class="au-bars" aria-hidden="true"><i style="--h:.62"></i><i style="--h:.8"></i><i style="--h:1"></i></span><span>10 · 11 · 12</span>`],
        ["Recovery reported", "Good"],
      ],
      next: "Next week", from: "12 sets", to: "13 sets", w: "8ch", delta: "+1 set",
    },
    paused: ["Sharp pain rather than muscle soreness."],
    topics: [
      ["Supplement questions beyond your stated guidance", true],
      ["Rapid unexplained weight changes", true],
      ["Questions about medication", false],
    ],
    phases: [[4, "Weeks 1–4", "Base volume"], [6, "Weeks 5–10", "Volume progression"], [2, "Weeks 11–12", "Deload and review"]],
    weeks: 12,
    faqs: [
      { q: "Can I pair it with meal plans?", a: "Yes. Offer the workout and nutrition tier, so meal plans follow your nutrition teaching. Nutrition is an optional tier." },
      PAIN_FAQ,
    ],
  },
  "/for-trainers/pre-postnatal": {
    ch: "IV", n: 4, name: "Pre and postnatal", key: "pre-postnatal",
    h1: "Pre and postnatal coaching, taught to your AI",
    lede: "Pregnancy and red flags always come to you, enforced in code. Your AI drafts, you approve. Automation starts only after your clearance step.",
    hub: "Built for caution: pregnancy always comes to you.",
    quote: "No postnatal programme starts until you’ve reviewed clearance.",
    rules: [
      ["Clearance first", "No postnatal programme starts until the subscriber confirms medical clearance and you have reviewed it.", "Nothing runs until you review it."],
      ["Effort cap", "First weeks back: keep effort conversational, with no breath-holding lifts.", "Reads effort and notes."],
      ["Postnatal return", "Start with breathing and pelvic floor work before loaded core exercises.", "Sets the order of the block."],
    ],
    hero: {
      mark: "reviewed", scope: "Postnatal return", who: "Sample subscriber · postnatal", cap: "Rule 4.1, applied to a clearance message",
      lines: [
        ["Subscriber says", `<span class="au-said">“My doctor cleared me at 8 weeks.”</span>`],
        ["Mode", "Waits for me"],
      ],
      next: "Programme start", from: "Locked", to: "Your review", w: "12ch", delta: "To you", tone: "to",
    },
    paused: ["Any mention of pregnancy: training pauses and the decision is yours.", "Bleeding, dizziness, chest pain or pelvic pain."],
    topics: [
      ["Postnatal subscribers before your clearance step", true],
      ["Questions about diastasis", true],
      ["Any change in advice from the subscriber’s doctor", true],
    ],
    phases: [[1, "During pregnancy", "Drafts only. You approve."], [1, "Clearance", "Your review step", true], [1, "Postnatal return", "Breathing, pelvic floor, then strength"]],
    weeks: 0,
    faqs: [
      { q: "Is this safe for pregnant clients?", a: "It doesn’t give medical advice. Any mention of pregnancy pauses training and comes to you, enforced in code, so a pregnant subscriber’s training decisions are always yours: your AI drafts, you approve. Routine automation is for postnatal return, after your clearance step." },
      { q: "Can I switch the pregnancy pause off for my clients?", a: "No. Pregnancy is part of the safety rules that apply to every trainer. You review the pause and decide what happens next." },
      PAIN_FAQ,
    ],
  },
};
const SPEC_ORDER = ["/for-trainers/weight-loss", "/for-trainers/strength", "/for-trainers/muscle-gain", "/for-trainers/pre-postnatal"];

// ---------------------------------------------------------------------------
// Small shared helpers

/** A numbered band: sectionHead + content. */
function band(h, { id, n, title, titleHtml, lede, paper = false, cls = "", inner, attrs = "" }) {
  return `<section class="band${paper ? " band--paper" : ""}${cls ? " " + cls : ""}" id="${id}" aria-labelledby="${id}-h"${attrs}>
  <div class="wrap">
    ${h.sectionHead({ n, title, titleHtml, lede, id: id + "-h" })}
    ${inner}
  </div>
</section>`;
}

/** FAQ band with the margin column (more answers + inline Kamran on phones). */
function faqBand(h, { id = "questions", n, title = "Questions", items, faqId, paper = false }) {
  return band(h, {
    id, n, title, paper,
    inner: `<div class="ms">${h.faq(items, { id: faqId })}<div class="faq-side"><div class="mnote" role="note"><span class="mnote-k">More answers</span>${h.linkArrow("All questions", "/faq")}</div>${h.kamranPill({ inline: true, location: "faq" })}</div></div>`,
  });
}

/** Horizontal scale figure: rows of ranges/markers on a shared AED axis. */
function scaleRows(h, { rows, ticks, pos }) {
  const row = (r) => {
    const a = pos(r.a), b = r.b != null ? pos(r.b) : null;
    const mark = b == null
      ? `<span class="au-sc-dot" style="--a:${a.toFixed(2)}%"></span>`
      : `<span class="au-sc-bar${r.open ? " is-open" : ""}" style="--a:${a.toFixed(2)}%;--b:${b.toFixed(2)}%"></span>`;
    return `<li class="au-sc-row${r.you ? " is-you" : ""}">
  <p class="au-sc-k">${r.labelHtml}</p>
  <p class="au-sc-v"><span class="tnum">${h.esc(r.value)}</span>${r.noteHtml || ""}</p>
  <div class="au-sc-track" aria-hidden="true">${mark}</div>
</li>`;
  };
  return `<div class="au-scale">
  <ol class="au-sc-rows" data-stagger>${h.each(rows, row)}</ol>
  <div class="au-sc-axis" aria-hidden="true">${h.each(ticks, (t) => `<span style="--a:${pos(t).toFixed(2)}%">${h.esc(t.toLocaleString("en-US"))}</span>`)}</div>
</div>`;
}

/** Compact follower calculator (home §6 pattern) at a given example price. */
function followerCalc(h, { id = "followers", n, price, paper = true, lede }) {
  const D = { ...calc.DEFAULT_FOLLOWER_INPUTS, priceAed: price };
  const sc = calc.estimateFollowerConversion(D).scenarios;
  const scen = (k, label) => `<div class="scen${k === "strong" ? " is-best" : ""}">
  <p class="scen-k">${label}</p>
  <p class="scen-v">${h.valueSlot(calc.aedWhole(sc[k].revenueMonth12Minor), { key: k + "-aed", w: "10ch" })}</p>
  <p class="scen-s">Active at month 12: ${h.valueSlot(calc.countLabel(sc[k].activeMonth12), { key: k + "-active" })}</p>
</div>`;
  return band(h, {
    id, n, title: "What your followers could be worth", lede, paper,
    attrs: " data-calc-block",
    inner: `<div class="calc" data-au-calc>
  <form class="calc-in" aria-label="Your numbers" data-reveal>
    ${h.field({ id: "fc-followers", label: "Instagram followers", type: "number", value: D.followers, attrsObj: { inputmode: "numeric", min: 0, max: 10000000, "data-k": "followers" } })}
    ${h.field({ id: "fc-price", label: "Your monthly price", type: "number", value: D.priceAed, prefix: "AED", help: "Starts at this chapter’s example price.", attrsObj: { inputmode: "numeric", min: 1, max: 10000, "data-k": "priceAed" } })}
    ${h.field({ id: "fc-stories", label: "Stories with your link each month", type: "number", value: D.linkStoriesPerMonth, help: "Two a week is 8 a month.", attrsObj: { inputmode: "numeric", min: 0, max: 60, "data-k": "linkStoriesPerMonth" } })}
    <p class="fine calc-assume">Also assumes 4 Reels a month with a comment keyword and 30% yearly cancellations.</p>
  </form>
  <div class="calc-out" data-reveal>
    <div class="chips">${h.estimateLabel()}${h.statusChip(...PAY_CHIP)}</div>
    <p class="calc-k">Best case · an engaged, growing audience</p>
    <p class="calc-fig">Up to ${h.valueSlot(calc.aedWhole(sc.strong.revenueMonth12Minor), { key: "headline", w: "10ch" })}</p>
    <p class="calc-label">a month at your price, before platform commission</p>
    <div class="scens" role="group" aria-label="Three scenarios at month 12">${scen("cautious", "Cautious")}${scen("typical", "Typical")}${scen("strong", "Strong")}</div>
    <p class="fine calc-note">A best case, not a typical result, and not a promise. ${h.methodBadge("follower-formula")}</p>
    <div class="calc-cta">${h.cta({ location: "calculator" })}${h.secondary("Use the full calculator", "/follower-calculator", { location: "calculator" })}</div>
    ${h.liveRegion("fc-live")}
  </div>
</div>`,
  });
}

/** Strike line that draws when its reveal unit enters. */
const strike = `<svg class="au-strike" aria-hidden="true" width="100%" height="4" preserveAspectRatio="none"><line x1="0" y1="2" x2="100%" y2="2" pathLength="100"/></svg>`;

/** Early-access form (registration closed). Fields mirror the live form. */
function earlyForm(h, { id, compact = false }) {
  return `<form class="au-form au-early" novalidate data-au-form="early" aria-labelledby="${id}-t">
  <p class="au-form-k">Sign-ups are closed for now</p>
  <h2 class="au-form-t" id="${id}-t">Join early access</h2>
  <p class="au-form-sub">Free to join. We’ll tell you here when sign-ups reopen.</p>
  <p class="au-carry" data-au-slugchip hidden>We’ll keep the address you typed: <span class="au-url"><b data-au-slug>your-name</b>.trainsyou.com</span></p>
  ${auField({ id: id + "-name", label: "Your name", name: "name", auto: "name", err: "Enter your name." })}
  ${auField({ id: id + "-email", label: "Email", name: "email", type: "email", auto: "email", err: "Enter an email address, like name@example.com." })}
  ${compact ? "" : auField({ id: id + "-ig", label: "Instagram handle", optional: true, name: "instagram", auto: "off", placeholder: "@yourname" })}
  <label class="check au-check-field" data-field="consent"><input type="checkbox" name="consent" id="${id}-consent" aria-describedby="${id}-consent-e"><span>I agree that trainsyou may keep these details to contact me about early access. I can ask for them to be deleted at any time.</span></label>
  <p class="au-err" id="${id}-consent-e" data-err hidden>Tick the box so we can keep your details.</p>
  <button class="btn btn-primary btn-lg btn-block" type="submit">Join early access — free</button>
  <div class="au-done" data-au-done hidden tabindex="-1" role="status"><p class="au-done-t">${h.icon("check", { size: 18 })}You’re on the early-access list.</p><p>Prototype: nothing was sent. We’ll tell you here when sign-ups reopen.</p></div>
</form>`;
}

/** Plain labelled input with an inline error slot (sign-up, early access, sign in). */
function auField({ id, label, name, type = "text", auto, err = "", optional = false, placeholder = "", help = "", minlength, inputHtmlAfter = "" }) {
  const describe = [help && id + "-help", err && id + "-e"].filter(Boolean).join(" ");
  return `<div class="field au-field" data-field="${name}">
  <label class="field-label" for="${id}">${label}${optional ? ' <span class="muted">(optional)</span>' : ""}</label>
  <div class="input-wrap${inputHtmlAfter ? " has-suffix" : ""}"><input class="input" id="${id}" name="${name}" type="${type}"${auto ? ` autocomplete="${auto}"` : ""}${type === "email" ? ' inputmode="email" autocapitalize="none" spellcheck="false"' : ""}${placeholder ? ` placeholder="${placeholder}"` : ""}${minlength ? ` minlength="${minlength}"` : ""}${describe ? ` aria-describedby="${describe}"` : ""}>${inputHtmlAfter}</div>
  ${help ? `<p class="field-help" id="${id}-help">${help}</p>` : ""}
  ${err ? `<p class="au-err" id="${id}-e" data-err hidden>${err}</p>` : ""}
</div>`;
}

// ---------------------------------------------------------------------------
// /for-trainers: a chapter list per specialty, example rule as a pull quote.

function hub({ pageFor, h }) {
  const { esc, each, cta, secondary, microLine, mark, linkArrow, statusChip, icon } = h;
  const contents = `<nav class="au-contents" aria-label="Specialties">
  <div class="au-contents-head"><p class="au-contents-k">Contents</p><p class="au-contents-col">Example price, a month</p></div>
  <ol>${each(SPEC_ORDER, (p) => {
    const S = SPEC[p], ex = pageFor(p).examplePriceAed;
    return `<li><a href="${h.esc(pageFor(p).file)}"><span class="au-c-n">${S.ch}</span><span class="au-c-t">${esc(S.name)}</span><span class="au-c-dots" aria-hidden="true"></span><span class="au-c-p tnum">AED ${ex}</span></a></li>`;
  })}
    <li class="au-c-app"><a href="uae.html"><span class="au-c-n">App.</span><span class="au-c-t">In the UAE</span><span class="au-c-dots" aria-hidden="true"></span><span class="au-c-p"><span class="arr" aria-hidden="true">→</span></span></a></li>
  </ol>
  <p class="au-contents-foot">${statusChip(...PAY_CHIP)}<span>Example prices. You set yours.</span></p>
</nav>`;

  const hero = `<section class="hero au-hub-hero" data-hero aria-labelledby="hub-h1">
  <div class="wrap hero-grid au-hero-grid">
    <div class="hero-copy">
      <p class="eyebrow">For trainers</p>
      <h1 class="display" id="hub-h1">Your <span class="nowrap">${mark("specialty")},</span> taught to your own AI</h1>
      <p class="lede">Every specialty has its own rules and red flags. Choose yours to see example rules, what always comes to you, and an example price.</p>
      <div class="hero-actions">${cta({ location: "hero" })}${secondary("Try the demo", "/demo", { location: "hero" })}</div>
      ${microLine()}
    </div>
    ${contents}
  </div>
</section>`;

  const chapters = band(h, {
    id: "chapters", n: 1, title: "Four chapters, one method",
    lede: "Each chapter shows how your AI (we call it your Trainer Brain) would follow one specialty.",
    inner: `<div class="au-ch-key" data-reveal>${statusChip(...PAY_CHIP)}<span>Prices are examples for a month of coaching.</span></div>
<ol class="au-chapters">${each(SPEC_ORDER, (p, i) => {
      const S = SPEC[p], pg = pageFor(p);
      return `<li class="au-ch" data-reveal style="--i:${i}">
  <div class="au-ch-id">
    <p class="au-ch-n">Chapter ${S.ch}</p>
    <h3 class="au-ch-t"><a class="au-ch-link" href="${esc(pg.file)}">${esc(S.name)}</a></h3>
    <p class="au-ch-d">${esc(S.hub)}</p>
  </div>
  <blockquote class="au-ch-q"><p>“${esc(S.quote)}”</p><footer>Example rule · illustrative</footer></blockquote>
  <div class="au-ch-side">
    <p class="au-ch-price tnum">AED ${pg.examplePriceAed}</p>
    <p class="au-ch-unit">a month · example</p>
    <span class="au-ch-go" aria-hidden="true">Read chapter ${S.ch}<span class="arr">→</span></span>
  </div>
</li>`;
    })}</ol>`,
  });

  const ROUTES = [
    ["On a gym floor", "Start with what your followers could be worth.", [["Follower calculator", "/follower-calculator"]]],
    ["Already online", "Watch your AI decide, then check our share.", [["Try the demo", "/demo"], ["See pricing", "/pricing"]]],
    ["I run a studio", "Invite your staff coaches. You keep the brand.", [["Team features", "/features/team"]]],
  ];
  const routes = band(h, {
    id: "routes", n: 2, title: "How do you coach now?", paper: true,
    inner: `<ol class="au-routes" data-reveal data-stagger>${each(ROUTES, ([t, d, links]) => `<li class="au-route">
  <p class="au-route-k">If you coach</p>
  <h3 class="au-route-t">${esc(t)}</h3>
  <svg class="au-route-line" aria-hidden="true" width="12" height="56" viewBox="0 0 12 56" preserveAspectRatio="none"><line x1="6" y1="0" x2="6" y2="54" pathLength="100"/><path d="M1.5 48.5 6 54l4.5-5.5"/></svg>
  <p class="au-route-k">Turn to</p>
  <p class="au-route-d">${esc(d)}</p>
  <ul class="au-route-links">${each(links, ([l, p]) => `<li>${linkArrow(l, p, { attrsHtml: `data-track="cta_click" data-track-props="${esc(JSON.stringify({ label: l, location: "routes" }))}"` })}</li>`)}</ul>
</li>`)}</ol>`,
  });

  const where = band(h, {
    id: "where", n: 3, title: "Where you coach",
    inner: h.msRow(
      `<p class="big-p">In the UAE: prices in AED, a follower app in English and Arabic, and local facts with their sources.</p><p>${linkArrow("Read the UAE brief", "/uae")}</p>`,
      `<span class="mnote-k">Payouts to a UAE bank</span>${statusChip("payments", "Not on yet", "Live today")}`,
    ),
  });

  return {
    main: [hero, chapters, routes, where].join("\n"),
    closing: { label: "Try the demo", path: "/demo" },
  };
}

// ---------------------------------------------------------------------------
// Specialty chapter: rules typeset as a manual page, paused list as a sheet.

function specialty({ page, h, pageFor }) {
  const { esc, each, cta, secondary, microLine, mark, ruleCard, marginNote, sampleLabel, statusChip, chip, icon, linkArrow, valueSlot, table, msRow, sourceBadge, figure } = h;
  const S = SPEC[page.path];
  const price = page.examplePriceAed;
  const H = S.hero;
  const pp = S.key === "pre-postnatal";
  let n = 0;
  const next = () => ++n;

  // Hero: the specialty's first rule, confirmed, then applied to a sample log.
  const heroRule = S.rules[0][1];
  const card = ruleCard({
    kicker: `Rule ${S.n}.1 · ${S.rules[0][0]}`, text: heroRule, source: "Your interview", scope: H.scope,
    status: "confirmed", pins: true, actions: false, id: "au-rule",
  }).replace(esc(H.mark), mark(H.mark));
  const applied = `<div class="au-apply" data-au-apply data-from="${esc(H.from)}" data-to="${esc(H.to)}">
  <p class="au-apply-k"><span class="au-apply-arrow" aria-hidden="true">↳</span><span>Applied</span><span class="au-apply-who">${esc(H.who)}</span></p>
  <dl class="au-apply-lines">
    ${each(H.lines, ([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`)}
    <div class="au-apply-next"><dt>${esc(H.next)}</dt><dd><span class="au-delta${H.tone ? " au-delta--to" : ""}">${esc(H.delta)}</span>${valueSlot(H.from, { key: "au-next", w: H.w, align: "end" })}</dd></div>
  </dl>
</div>`;
  const hero = `<section class="hero au-spec-hero" data-hero aria-labelledby="sp-h1">
  <div class="wrap hero-grid au-hero-grid au-hero-grid--fig">
    <div class="hero-copy">
      <p class="eyebrow">For trainers · ${esc(S.name)}</p>
      <h1 class="display" id="sp-h1">${esc(S.h1)}</h1>
      <p class="lede">${esc(S.lede)}</p>
      <div class="hero-actions">${cta({ location: "hero" })}${secondary("See the full safety rules", "/features/safety", { location: "hero" })}</div>
      ${microLine()}
    </div>
    <figure class="au-fig" aria-labelledby="sp-fig-cap" data-au-fig>
      <div class="au-fig-body">
        <div class="au-fig-main">${card}${applied}</div>
        <div class="au-fig-notes">${marginNote("Source: your interview", { pin: "a" })}${marginNote("Applies only once you confirm it", { pin: "b" })}</div>
      </div>
      <figcaption class="fig-cap" id="sp-fig-cap"><span class="fig-n">Fig. 1</span><span class="fig-t">${esc(H.cap)}</span>${sampleLabel()}</figcaption>
    </figure>
  </div>
</section>`;

  // Pre and postnatal: "Waits for me" mode first.
  const waits = pp
    ? band(h, {
        id: "waits", n: next(), title: "Every reply waits for you",
        lede: "For pregnant subscribers, your AI only drafts. You approve every decision.",
        inner: `<div class="ms">
  ${figure({
    n: 2, caption: "The reply mode", className: "au-mode-fig",
    bodyHtml: h.windowFrame({
      title: "Reply mode · Layla Strength",
      bodyHtml: `<ul class="au-modes" aria-hidden="true">
  <li class="is-on"><span class="au-radio"></span><div><p class="au-mode-t">Waits for me</p><p class="au-mode-d">Every reply waits for your OK.</p></div><span class="chip chip--included">${icon("check", { size: 14 })}On</span></li>
  <li><span class="au-radio"></span><div><p class="au-mode-t">Automatic sending</p><p class="au-mode-d">Needs 20 cases and passing checks.</p></div><span class="chip chip--neutral">${icon("lock", { size: 14 })}Never for pregnancy</span></li>
</ul>`,
    }),
  })}
  <div class="mnote" role="note" data-reveal><span class="mnote-k">Postnatal return</span>Routine automation starts only after the clearance step you set.</div>
</div>`,
      })
    : "";

  // Rules typeset as a manual page.
  const rules = band(h, {
    id: "rules", n: next(), title: "Rules you might teach",
    lede: "Three illustrative rules. Your AI (we call it your Trainer Brain) learns your own wording, reasons and limits.",
    inner: `<article class="au-manual" data-reveal aria-label="Chapter ${S.ch}, ${esc(S.name)}: example rules">
  <header class="au-manual-head" aria-hidden="true"><span>Chapter ${S.ch} · ${esc(S.name)}</span><span>Rules you might teach</span></header>
  <ol class="au-rules" data-stagger>${each(S.rules, ([t, x, note], i) => `<li class="au-rule">
    <span class="au-rule-n">${S.n}.${i + 1}</span>
    <div class="au-rule-body"><h3 class="au-rule-t">${esc(t)}</h3><p class="au-rule-x">${esc(x)}</p></div>
    <p class="au-rule-note"><span class="mnote-k">Illustrative</span>${esc(note)}</p>
  </li>`)}</ol>
  <footer class="au-manual-foot"><span>You write your own. Each one waits for your OK.</span><span class="au-folio" aria-hidden="true">${S.n}</span></footer>
</article>`,
  });

  // Always paused: a Never-sheet-style list.
  const CORE = ["Pain", "Pregnancy", "Chest pain", "Dizziness", "Fainting", "Bleeding"];
  const paused = band(h, {
    id: "paused", n: next(), title: "Always paused, sent to you", paper: true,
    inner: `<div class="au-paused-grid">
  <div class="au-paused-copy" data-reveal>
    <p class="big-p">Some messages never wait for your AI. Training pauses and the message comes to you.</p>
    <p>No setting, prompt or rule can switch this off. It applies to every trainer.</p>
    <p>${linkArrow("See the full safety rules", "/features/safety")}</p>
  </div>
  <div class="never-sheet au-paused" data-reveal>
    <p class="au-pause-banner">${icon("pause", { size: 18 })}<span>Training paused</span><span class="au-pb-to">Sent to you</span></p>
    <p class="never-kicker">Safety rules · every trainer · v1</p>
    <h3 class="never-title">What always <em>pauses</em> training</h3>
    <ul class="au-flags" data-stagger>${each(CORE, (t) => `<li>${esc(t)}</li>`)}</ul>
    <ol class="never-list au-also">${each(S.paused, (t) => `<li><span class="never-word">Also</span><span class="never-text">${esc(t)}</span></li>`)}</ol>
    <p class="never-foot">${icon("lock", { size: 16 })}<span>Enforced in code, outside your AI. Normal training stays paused until you review it.</span></p>
  </div>
</div>`,
  });

  // Optional review topics: switches the visitor can flip (sample).
  const on = S.topics.filter((t) => t[1]).length;
  const topics = band(h, {
    id: "review", n: next(), title: "What else comes to you",
    lede: "Anything your AI isn’t sure about already comes to you. Beyond that, you choose.",
    inner: `<div class="ms">
  ${figure({
    n: pp ? 3 : 2, caption: "Your review topics", className: "au-topics-fig",
    bodyHtml: h.windowFrame({
      title: "Review topics · Layla Strength",
      chipHtml: `<span class="au-count">To you: ${valueSlot(on + (on === 1 ? " topic" : " topics"), { key: "au-count", w: "8ch" })}</span>`,
      bodyHtml: `<ul class="au-topics" data-au-topics>${each(S.topics, ([t, v], i) => `<li><button class="au-sw" type="button" role="switch" aria-checked="${v}" id="topic-${i}"><span class="au-sw-t">${esc(t)}</span><span class="switch-knob" aria-hidden="true"></span></button></li>`)}</ul>`,
    }),
  })}
  <div class="mnote" role="note" data-reveal><span class="mnote-k">Try it</span>Flip a topic. Your own red-flag words also pause training.</div>
</div>`,
  });

  // Programme outline: a phase ruler above the real table.
  const tbl = page.sections.find((s) => s.id === "programme").table;
  const total = S.phases.reduce((a, p) => a + p[0], 0);
  let at = 0;
  const ruler = `<div class="au-phases${pp ? " au-phases--gate" : ""}" data-reveal aria-hidden="true">
  ${S.weeks ? `<p class="au-ph-unit">Week</p><div class="au-ph-ticks" style="--n:${S.weeks}">${Array.from({ length: S.weeks }, (_, i) => `<span>${i + 1}</span>`).join("")}</div>` : ""}
  <div class="au-ph-bar" data-stagger>${each(S.phases, ([w, t, d, gate]) => {
    const o = at / total; at += w;
    return `<div class="au-ph${gate ? " is-gate" : ""}" style="--g:${w};--o:${o.toFixed(4)};--s:${(w / total).toFixed(4)}"><i></i><b>${gate ? icon("lock", { size: 14 }) : ""}${esc(t)}</b><small>${esc(d)}</small></div>`;
  })}</div>
</div>`;
  const programme = band(h, {
    id: "programme", n: next(), title: "An example programme outline",
    inner: `${ruler}${msRow(
      table({ caption: tbl.caption, columns: ["Phase", "Focus", "How your AI adapts it"], rows: tbl.rows.map((r) => r.map((c) => c.replace(/-/g, "–"))) }),
      `<span class="mnote-k">Illustrative</span>You set the length and content. ${total && S.weeks ? `This outline runs ${S.weeks} weeks.` : "Nothing runs past clearance without you."}`,
    )}`,
  });

  // Price ladder: one hour against a month (sourced rung + example rung).
  const pos = (v) => (v / 400) * 100;
  const ladder = band(h, {
    id: "ladder", n: next(), title: "A month, against one hour",
    inner: `<div class="ms">
  <figure class="fig au-ladder" data-reveal>
    <div class="fig-body">${scaleRows(h, {
      pos, ticks: [0, 100, 200, 300, 400],
      rows: [
        { a: 70, b: 350, value: "AED 70–350", labelHtml: "One session with a trainer in Dubai", noteHtml: sourceBadge("heytrainer-dubai-2026") },
        { a: price, value: `AED ${price}`, you: true, labelHtml: "A month of your AI coaching", noteHtml: `<span class="au-sc-ex">example</span>${statusChip(...PAY_CHIP)}` },
      ],
    })}</div>
    <figcaption class="fig-cap"><span class="fig-n">Fig. ${pp ? 4 : 3}</span><span class="fig-t">One hour, one month, in AED</span></figcaption>
  </figure>
  <div class="mnote" role="note" data-reveal><span class="mnote-k">Read it like this</span>One hour sells once. A month of your method can cost about the same as one session. You set your own price.</div>
</div>`,
  });

  const followers = followerCalc(h, { n: next(), price, lede: "It starts at this chapter’s example price. Change it to yours." });

  const arabic = pp
    ? band(h, {
        id: "arabic", n: next(), title: "In Arabic, honestly",
        inner: msRow(
          `<ul class="au-honest" data-stagger>
  <li><span class="au-honest-k">Your followers’ app</span><span>English and Arabic, right to left. ${chip("live", "Live today")}</span></li>
  <li><span class="au-honest-k">Your trainer area</span><span>English.</span></li>
  <li><span class="au-honest-k">What you write</span><span>Not auto-translated. It reaches followers as you wrote it.</span></li>
</ul>`,
          `<span class="mnote-k">See it</span>${linkArrow("The app in Arabic", "/uae#arabic")}`,
        ),
      })
    : "";

  const questions = faqBand(h, { n: next(), items: S.faqs, faqId: S.key + "-faq", paper: false });

  return {
    main: [hero, waits, rules, paused, topics, programme, ladder, followers, arabic, questions].filter(Boolean).join("\n"),
    title: page.title,
    calc: true,
    closing: { label: "See the full safety rules", path: "/features/safety" },
  };
}

// ---------------------------------------------------------------------------
// /uae: a long-form local brief with sources in the margin.

function uae({ page, h }) {
  const { esc, each, cta, secondary, microLine, mark, chip, statusChip, sourceBadge, linkArrow, msRow, icon, figure, phone } = h;
  const TOC = [
    ["here", "Built for here"], ["audience", "Your audience"], ["prices", "What followers pay"], ["emirates", "Emirate by emirate"],
    ["licences", "Licences and credentials"], ["arabic", "Arabic, honestly"], ["ramadan", "Ramadan"], ["questions", "Questions"],
  ];
  const hero = `<section class="hero au-uae-hero" data-hero aria-labelledby="uae-h1">
  <div class="wrap hero-grid au-hero-grid">
    <div class="hero-copy">
      <p class="eyebrow">United Arab Emirates</p>
      <h1 class="display" id="uae-h1">Built for personal trainers in the <span class="nowrap">${mark("UAE")}</span></h1>
      <p class="lede">Take your coaching online, priced in AED, with an app your followers can use in Arabic, and local facts with their sources.</p>
      <p class="status-strip">${h.flagged(
        "payments",
        `<span class="chip-dot" aria-hidden="true"></span>Subscriber payments and payouts are not on yet. <a href="get-started.html#status">What works today<span class="arr" aria-hidden="true">→</span></a>`,
        `${icon("check", { size: 16 })}Subscriber payments and payouts are live. <a href="get-started.html#status">What works today<span class="arr" aria-hidden="true">→</span></a>`,
      )}</p>
      <div class="hero-actions">${cta({ location: "hero" })}${secondary("See pricing in AED", "/pricing", { location: "hero" })}</div>
      ${microLine()}
    </div>
    <nav class="au-brief" aria-label="Brief contents">
      <p class="au-brief-k">Local brief</p>
      <p class="au-brief-t">United Arab Emirates</p>
      <p class="au-brief-d">As of 26 Oct 2026 · Sources in the margin</p>
      <ol>${each(TOC, ([id, t], i) => `<li><a href="#${id}"><span class="au-brief-n">§${i + 1}</span><span>${esc(t)}</span></a></li>`)}</ol>
    </nav>
  </div>
</section>`;

  const LOCAL = [
    ["Prices in AED", "You set your monthly price in dirhams.", chip("live", "Live today")],
    ["Payouts to a UAE IBAN", "Monthly, to a verified UAE bank account.", statusChip("payments", "Not on yet", "Live today")],
    ["English and Arabic", "Follower controls read right to left in Arabic.", chip("live", "Live today")],
    ["In-person bookings", "Paid sessions in your city, with your cancellation rules.", statusChip("payments", "Not on yet", "Live today")],
    ["UAE time", "Dates and reminders in the UAE time zone.", chip("live", "Live today")],
  ];
  const here = band(h, {
    id: "here", n: 1, title: "Built for here",
    inner: `<dl class="au-spec" data-reveal data-stagger>${each(LOCAL, ([t, d, c]) => `<div class="au-spec-row"><dt>${esc(t)}</dt><dd>${esc(d)}</dd><dd class="au-spec-st">${c}</dd></div>`)}</dl>`,
  });

  const audience = band(h, {
    id: "audience", n: 2, title: "Your audience is already here", paper: true,
    inner: `${msRow(
      `<div class="au-stats" data-stagger>
  <div class="au-stat"><p class="au-stat-v tnum">11.1M</p><p class="au-stat-k">internet users, 99.0% of people ${sourceBadge("datareportal-uae-2025")}</p></div>
  <div class="au-stat"><p class="au-stat-v tnum">7.60M</p><p class="au-stat-k">on Instagram, 67.8% of people ${sourceBadge("datareportal-uae-2025")}</p></div>
  <div class="au-stat"><p class="au-stat-v tnum">31.6</p><p class="au-stat-k">median age ${sourceBadge("datareportal-uae-2025")}</p></div>
</div>`,
      `<span class="mnote-k">Source</span>DataReportal, Digital 2025: the UAE, start of 2025.`,
    )}
${msRow(
  `<p class="big-p">Your followers already scroll here. Most trainers lack an offer they can afford every month, not an audience.</p>`,
  `<span class="mnote-k">What it means</span>Your AI (we call it your Trainer Brain) serves that offer without selling more hours.`,
)}`,
  });

  // Log scale so a session and a month sit on one readable axis.
  const lo = Math.log(50), hi = Math.log(3000);
  const pos = (v) => ((Math.log(v) - lo) / (hi - lo)) * 100;
  const prices = band(h, {
    id: "prices", n: 3, title: "What followers pay now",
    inner: `<div class="ms">
  <figure class="fig au-ladder au-ladder--log" data-reveal>
    <div class="fig-body">${scaleRows(h, {
      pos, ticks: [50, 100, 200, 500, 1000, 2000],
      rows: [
        { a: 70, b: 350, value: "AED 70–350", labelHtml: "One session <small>per hour</small>", noteHtml: sourceBadge("heytrainer-dubai-2026") },
        { a: 200, b: 700, open: true, value: "AED 200–700+", labelHtml: "One session, premium <small>per hour</small>", noteHtml: sourceBadge("embody-dubai-2025") },
        { a: 400, b: 2000, value: "AED 400–2,000", labelHtml: "Online coaching <small>per month</small>", noteHtml: sourceBadge("369mmafit-online-2026") },
        { a: 199, b: 249, value: "AED 199–249", you: true, labelHtml: "Your AI coaching <small>per month</small>", noteHtml: `<span class="au-sc-ex">example prices</span>${statusChip(...PAY_CHIP)}` },
      ],
    })}</div>
    <figcaption class="fig-cap"><span class="fig-n">Fig. 1</span><span class="fig-t">Published Dubai price guides, in AED, log scale</span></figcaption>
  </figure>
  <div class="mnote" role="note" data-reveal><span class="mnote-k">About these figures</span>Published price guides, not official statistics.</div>
</div>
${msRow(`<p class="big-p">Your AI coaching sits <span class="nowrap">in between.</span></p>`, `<span class="mnote-k">Your price</span>You choose it in setup. The specialty pages use AED 199 to 249 as examples.`)}`,
  });

  const emirates = band(h, {
    id: "emirates", n: 4, title: "Emirate by emirate", paper: true,
    inner: `<div class="au-cities" data-reveal data-stagger>
  <article class="au-city"><h3 class="au-city-k">Dubai</h3><p class="au-city-v tnum">2.73M</p><p class="au-city-d">took part in Dubai Fitness Challenge 2024. ${sourceBadge("dubai-fitness-challenge-2024")}</p></article>
  <article class="au-city"><h3 class="au-city-k">Abu Dhabi</h3><p class="au-city-v tnum">60.3%</p><p class="au-city-d">of residents meet WHO activity standards, up from 53.6%, from about 31,000 responses. ${sourceBadge("abu-dhabi-activity-survey-2026")}</p></article>
  <article class="au-city"><h3 class="au-city-k">Northern emirates</h3><p class="au-city-v au-city-v--none">No figure</p><p class="au-city-d">Online coaching follows subscribers anywhere. We found no published local prices, so we quote none.</p></article>
</div>`,
  });

  const licences = band(h, {
    id: "licences", n: 5, title: "Licences and credentials",
    inner: `<div class="ms">
  <article class="au-notice" data-reveal aria-label="Licences and credentials, information only">
    <span class="au-notice-stamp" aria-hidden="true">Information only</span>
    <div class="au-notice-item"><h3 class="h3">Advertiser permit</h3><p>Reports on the UAE Advertiser Permit say people promoting their own services through personal accounts are exempt. Rules change, so check with the UAE Media Council. This is information, not legal advice. ${sourceBadge("gulfnews-advertiser-permit")} ${sourceBadge("uae-media-council-permit")}</p><p>${linkArrow("Read the advertiser permit guide", "/guides/uae-advertiser-permit")}</p></div>
    <div class="au-notice-item"><h3 class="h3">Your trainer licence</h3><p>It depends on how and where you work: a gym, your own company, a free zone or a freelance permit. Check with your licensing authority.</p></div>
    <div class="au-notice-item"><h3 class="h3">Credentials</h3><p>trainsyou doesn’t verify credentials.</p></div>
  </article>
  <div class="mnote" role="note" data-reveal><span class="mnote-k">In setup</span>Setup collects your business details. Payments and launch have their own checks.</div>
</div>`,
  });

  // RTL preview vignette: real member-app Arabic strings (apps/web/lib/i18n).
  const t = (en, ar) => `<span data-ar="${esc(ar)}">${esc(en)}</span>`;
  const app = `<div class="app">
  <div class="app-top"><span class="app-icon">LS</span><div><p class="app-name">Layla Strength</p><p class="app-sub">layla-strength.trainsyou.com</p></div></div>
  <p class="app-h">${t("Today", "اليوم")}</p>
  <p class="app-sub">${t("Week 3", "الأسبوع 3")} · <span dir="auto">Lower body A</span></p>
  <div class="app-card">
    <p class="app-row"><span dir="auto">Back squat 4 × 6</span><b dir="ltr">62.5 kg</b></p>
    <p class="app-row"><span dir="auto">Romanian deadlift 3 × 8</span><b dir="ltr">50 kg</b></p>
    <p class="app-row"><span dir="auto">Walking lunge 3 × 10</span><b dir="ltr">16 kg</b></p>
  </div>
  <div class="app-btn">${t("Start workout", "بدء التمرين")}</div>
  <p class="au-app-pain">${t("Report pain", "الإبلاغ عن ألم")}</p>
  <p class="au-app-coach">${t("Digital coach", "المدرب الرقمي")} · Layla Strength</p>
  <div class="app-tabbar"><span class="on">${t("Today", "اليوم")}</span><span>${t("Plan", "الخطة")}</span><span>${t("Progress", "التقدّم")}</span><span>${t("Chat", "المحادثة")}</span></div>
</div>`;
  const arabic = band(h, {
    id: "arabic", n: 6, title: "Arabic, honestly", paper: true,
    inner: `<div class="au-ar">
  <div class="au-ar-copy" data-reveal>
    <ul class="au-honest" data-stagger>
      <li><span class="au-honest-k">Your followers’ app</span><span>English and Arabic, right to left. ${chip("live", "Live today")}</span></li>
      <li><span class="au-honest-k">Your trainer area</span><span>English.</span></li>
      <li><span class="au-honest-k">What you write</span><span>Not auto-translated. Exercise names stay as you wrote them.</span></li>
    </ul>
    <div class="au-lang" role="group" aria-label="Preview the follower app in">
      <button class="au-lang-b" type="button" data-au-lang="en" aria-pressed="true">English</button>
      <button class="au-lang-b" type="button" data-au-lang="ar" aria-pressed="false" lang="ar">العربية (Arabic)</button>
    </div>
  </div>
  ${figure({ n: 2, caption: "The follower app, in English or Arabic", className: "au-ar-fig", bodyHtml: phone({ screenHtml: app, label: "Sample follower app for Layla Strength. Switch the preview to see the Arabic layout.", rtlVignette: true }) })}
</div>`,
  });

  const ramadan = band(h, {
    id: "ramadan", n: 7, title: "Ramadan",
    inner: msRow(
      `<p class="big-p">Questions about fasting and meal timing come to you. Fasting is never treated as disordered eating.</p>`,
      `<span class="mnote-k">What we don’t claim</span>No Ramadan programmes. Your rules decide.`,
    ),
  });

  const f = (re) => page.faqs.find((x) => re.test(x.q)).a;
  const questions = faqBand(h, {
    n: 8, faqId: "uae-faq", paper: true,
    items: [
      { q: "Do I need a trade licence?", a: "You can set up and teach your AI without one. Business details are collected during setup, and payments and launch have their own checks. Check the licence you need with your licensing authority." },
      { q: "Can I coach subscribers in other emirates?", a: f(/other emirates/) },
      { q: "Do subscribers pay in AED?", a: "Yes, once subscriber payments are on. Prices, card payments, statements and payouts are all in AED. Today you can set your AED price in setup." },
      { q: "Is it available in Arabic?", a: f(/Arabic/) },
      { q: "Does trainsyou check my qualifications?", a: "No. trainsyou doesn’t verify credentials. You’re responsible for the licences and qualifications your work needs. Check with your licensing authority and your emirate’s sports authority." },
    ],
  });

  return {
    main: [hero, here, audience, prices, emirates, licences, arabic, ramadan, questions].join("\n"),
    title: "UAE personal trainers: take your coaching online",
    description: "Take your coaching online in the UAE: prices in AED, a follower app in English and Arabic, and local market facts with their sources.",
    closing: { label: "See pricing in AED", path: "/pricing" },
  };
}

// ---------------------------------------------------------------------------
// /get-started: a setup plan and a checklist sheet.

function getStarted({ page, content, h }) {
  const { esc, each, cta, linkArrow, microLine, mark, statusChip, chip, statusPanel, addressPreview, icon, whenOn, whenOff } = h;
  const hero = `<section class="hero au-gs-hero" data-hero aria-labelledby="gs-h1">
  <div class="wrap hero-grid au-hero-grid">
    <div class="hero-copy">
      <p class="eyebrow">Get started</p>
      <h1 class="display" id="gs-h1">Start your coaching business, <span class="nowrap">${mark("free")}</span></h1>
      <p class="lede">Six guided steps, about 15 minutes for a starter setup. Save and continue later. Bank details wait until your first payout.</p>
      <div class="hero-actions">${cta({ location: "hero" })}${linkArrow("See the six steps", "#steps")}</div>
      ${microLine()}
    </div>
    <div class="au-claim">
      ${whenOn("registration", `<p class="au-claim-k">Claim your address</p>${addressPreview({ id: "gs-addr", location: "get-started-hero" })}<p class="au-claim-foot">${icon("check", { size: 14 })}Free. You choose it for real in step 3.</p>`, "div")}
      ${whenOff("registration", earlyForm(h, { id: "gs-early", compact: true }), "div")}
    </div>
  </div>
</section>`;

  const steps = content.setupChecklist.map((s) => ({
    ...s,
    label: s.label.replace("Teach your Brain", "Teach your AI"),
  }));
  const total = steps.reduce((a, s) => a + s.minutes, 0);
  const stepsBand = band(h, {
    id: "steps", n: 1, title: "Six steps, about 15 minutes",
    lede: "From an account to your page, your AI (we call it your Trainer Brain) and launch checks.",
    inner: `<div class="ms au-steps-ms"><div class="ms-text">
<div class="au-mins" data-reveal aria-hidden="true">
  <div class="au-mins-bar" data-stagger>${each(steps, (s, i) => `<span style="--m:${s.minutes}"><i></i><b>${i + 1}</b></span>`)}</div>
  <p class="au-mins-total tnum">${total} min</p>
</div>
  <ol class="au-steps" data-reveal data-stagger>${each(steps, (s, i) => `<li>
    <span class="au-st-n">${i + 1}</span>
    <div class="au-st-b"><h3 class="au-st-t">${esc(s.label)}</h3><p>${esc(s.summary)}</p>${s.key === "live" ? `<p class="chips">${statusChip("publish", "Not on yet: publishing", "Publishing live")}</p>` : ""}</div>
    <p class="au-st-m tnum">${s.minutes} min</p>
  </li>`)}</ol></div>
  <div class="mnote" role="note" data-reveal><span class="mnote-k">Save and come back</span>Optional work can wait. Launch checks explain anything still needed before publishing.<br><br>Deeper teaching takes longer. Automatic sending needs 20 cases and passing checks.</div>
</div>`,
  });

  const NEED = [
    "Who you are, and a line about your coaching",
    "Your method, and the limits you keep",
    "An offer: who it’s for, your AED price, its length",
    "Photos or a logo, if you have them",
    "A UAE bank account, at your first payout",
  ];
  const DONT = ["A card", "A trade licence, to start", "A minimum number of followers", "Coding skills", "Your own domain"];
  const checklist = band(h, {
    id: "checklist", n: 2, title: "What you need, and don’t", paper: true,
    inner: `<article class="au-checklist" data-reveal aria-label="Checklist">
  <header class="au-cl-head" aria-hidden="true"><span>Checklist</span><span>Before you start</span></header>
  <div class="au-cl-cols">
    <div class="au-cl-col"><h3 class="au-cl-h">What you need</h3><ul class="au-need" data-stagger>${each(NEED, (t) => `<li><span class="au-box" aria-hidden="true">${icon("check", { size: 14 })}</span><span>${esc(t)}</span></li>`)}</ul></div>
    <div class="au-cl-col"><h3 class="au-cl-h">What you don’t</h3><ul class="au-dont" data-stagger>${each(DONT, (t) => `<li><span class="au-box au-box--x" aria-hidden="true"></span><span class="au-struck">${esc(t)}${strike}</span></li>`)}</ul></div>
  </div>
</article>`,
  });

  const status = band(h, {
    id: "status-band", n: 3, title: "What works today",
    inner: statusPanel({ id: "status", title: "Live today, and not on yet" }),
  });

  const LAUNCH = [
    "Your site and app go live at your coaching address.",
    "Subscribers join and pay in AED, once payments are on.",
    "Your AI plans from each subscriber’s input, in the mode you approved.",
  ];
  const AFTER = [
    "Share your tagged link in your bio and Stories.",
    "Review what your AI hands you. Each correction teaches it.",
    "See where visitors come from, with their consent.",
  ];
  const after = band(h, {
    id: "after", n: 4, title: "After you go live", paper: true,
    inner: `<div class="ms">
  <div class="au-after" data-reveal>
    <p class="chips au-after-chips">${chip("neutral", "Follows go-live")}${statusChip("publish", "Not on yet: publishing", "Publishing live")}</p>
    <div class="au-after-cols">
      <div><h3 class="h3">At launch</h3><ol class="au-after-list">${each(LAUNCH, (t) => `<li>${esc(t)}</li>`)}</ol></div>
      <div><h3 class="h3">Every week after</h3><ol class="au-after-list">${each(AFTER, (t) => `<li>${esc(t)}</li>`)}</ol></div>
    </div>
  </div>
  <div class="mnote" role="note" data-reveal><span class="mnote-k">Why it waits</span>Publishing opens with subscriber payments. Until then, preview exactly what subscribers will see.</div>
</div>`,
  });

  const f = (re) => page.faqs.find((x) => re.test(x.q)).a;
  const questions = faqBand(h, {
    n: 5, faqId: "gs-faq",
    items: [
      { q: "Do I need technical skills?", a: f(/technical/) },
      { q: "Do I need a minimum number of followers?", a: f(/minimum/) },
      { q: "Can I start before I have a trade licence ready?", a: "Yes. You can set up your brand and teach your AI while business details are collected. Payments and launch have their own checks." },
      { q: "Can I bring my existing clients?", a: f(/existing clients/) },
      { q: "Can I see it before subscribers do?", a: f(/before subscribers/) },
      { q: "Do I need my own domain?", a: f(/domain/) },
    ],
  });

  return {
    main: [hero, stepsBand, checklist, status, after, questions].join("\n"),
    title: page.title,
    closing: { label: "See how it works", path: "/how-it-works" },
  };
}

// ---------------------------------------------------------------------------
// /signup (C12, protected path): fast, calm, four fields, no card.

function signup({ h }) {
  const { esc, each, icon, ruleCard, sampleLabel } = h;
  const TICKS = ["Free to join, no card.", "About 15 minutes to start; stop any time.", "Nothing goes live until you publish."];
  const pwToggle = `<button class="au-pw" type="button" data-au-pw aria-controls="su-password" aria-label="Show password">Show</button>`;
  const form = `<form class="au-form au-signup-form" novalidate data-au-form="signup" aria-labelledby="su-card-t">
  <h2 class="au-form-t" id="su-card-t">Create your account</h2>
  <p class="au-carry" data-au-slugchip hidden><span class="au-url"><b data-au-slug>your-name</b>.trainsyou.com</span><span class="au-carry-x">— we’ll check it’s free in setup</span></p>
  <p class="au-carry au-carry--price" data-au-pricechip hidden><span>Your price: <b data-au-price>AED 199</b></span><span class="placeholder">shown after decision 8</span></p>
  <input type="hidden" name="slug" data-au-slugfield>
  ${auField({ id: "su-name", label: "Your name", name: "name", auto: "name", err: "Enter your name." })}
  ${auField({ id: "su-email", label: "Email address", name: "email", type: "email", auto: "email", err: "Enter an email address, like name@example.com." })}
  ${auField({ id: "su-password", label: "Password", name: "password", type: "password", auto: "new-password", minlength: 12, help: `<span data-au-pwhint>At least 12 characters.</span>`, err: "Use at least 12 characters.", inputHtmlAfter: pwToggle })}
  <label class="check au-check-field" data-field="terms"><input type="checkbox" name="terms" id="su-terms" aria-describedby="su-terms-e"><span>I accept the <a href="terms.html" target="_blank" rel="noopener">terms of service</a>, <a href="privacy.html" target="_blank" rel="noopener">privacy policy</a> and <a href="ai-disclosure.html" target="_blank" rel="noopener">digital coaching disclosure</a>.</span></label>
  <p class="au-err" id="su-terms-e" data-err hidden>Accept the terms to continue.</p>
  <button class="btn btn-primary btn-lg btn-block au-submit" type="submit"><span class="vx" data-vx="au-btn"><span>Start my setup</span></span>${icon("arrow", { size: 18 })}</button>
  <p class="au-restate">Free · No card · Nothing goes live until you publish</p>
  <div class="au-done" data-au-done hidden tabindex="-1" role="status"><p class="au-done-t">${icon("check", { size: 18 })}Your setup would open here.</p><p>Prototype: no account was created. Next comes step 2 of 6, About you.</p></div>
</form>`;
  const main = `<section class="hero au-signup" data-hero aria-labelledby="su-h1">
  <div class="wrap au-su-grid">
    <div class="au-su-story">
      <p class="eyebrow">Sign up</p>
      <h1 class="display" id="su-h1">Teach your AI. Start free.</h1>
      <ul class="au-ticks">${each(TICKS, (t) => `<li>${icon("check", { size: 18 })}<span>${esc(t)}</span></li>`)}</ul>
    </div>
    <div class="au-su-card">
      <div class="if-reg-open">${form}
        <p class="au-su-alt">Already have a coaching space? <a href="login.html">Sign in</a></p>
      </div>
      <div class="if-reg-closed" id="early-access">${earlyForm(h, { id: "su-early" })}</div>
    </div>
    <figure class="au-su-fig" aria-labelledby="su-fig-cap">
      <div class="au-su-fig-body">${ruleCard({ kicker: "Rule 01 · Progression", status: "confirmed", actions: false, source: "Your interview", scope: "Squat, bench press" })}</div>
      <figcaption class="fig-cap" id="su-fig-cap"><span class="fig-n">Fig. 1</span><span class="fig-t">A rule for your AI (we call it your Trainer Brain), confirmed by you</span>${sampleLabel()}</figcaption>
    </figure>
  </div>
</section>`;
  return { main, sticky: false, closing: false, kamran: false, bodyClass: "au-auth" };
}

// ---------------------------------------------------------------------------
// /login (C24): unchanged flow, marketing header kept, no sticky bar.

function login({ h }) {
  const { icon, linkArrow } = h;
  const main = `<section class="hero au-login" data-hero aria-labelledby="li-h1">
  <div class="wrap au-li-grid">
    <div class="au-li-copy">
      <p class="eyebrow">Trainers and subscribers</p>
      <h1 class="display" id="li-h1">Sign in</h1>
      <p class="lede">Welcome back. Sign in with the email address you use for coaching.</p>
    </div>
    <div class="au-li-card">
      <form class="au-form" novalidate data-au-form="login" aria-label="Sign in">
        ${auField({ id: "li-email", label: "Email address", name: "email", type: "email", auto: "email", err: "Enter the email address you use for coaching." })}
        ${auField({ id: "li-password", label: "Password", name: "password", type: "password", auto: "current-password", err: "Enter your password." })}
        <p class="au-li-forgot"><button class="au-textbtn" type="button" data-au-note="Prototype: the reset email isn’t sent here.">Forgot your password?</button></p>
        <button class="btn btn-primary btn-lg btn-block" type="submit">Sign in${icon("arrow", { size: 18 })}</button>
        <div class="au-done" data-au-done hidden tabindex="-1" role="status"><p class="au-done-t">${icon("check", { size: 18 })}You’d be signed in now.</p><p>Prototype: no account is checked here.</p></div>
      </form>
      <div class="au-li-alt" role="group" aria-labelledby="li-alt-k">
        <p class="au-li-alt-k" id="li-alt-k">Other ways to sign in</p>
        <button class="btn btn-secondary btn-block" type="button" data-au-note="Prototype: passkeys open your device’s prompt in the product.">Sign in with a passkey</button>
        <button class="btn btn-secondary btn-block" type="button" data-au-note="Prototype: the sign-in link isn’t emailed here.">Email me a sign-in link</button>
        <button class="au-textbtn" type="button" data-au-note="Prototype: recovery codes are checked in the product.">Lost your authenticator app? Use a recovery code</button>
        <p class="au-li-status" role="status" data-au-status></p>
      </div>
    </div>
    <div class="au-li-notes">
        <div class="mnote" role="note"><span class="mnote-k">Are you a coach?</span><a class="link-arrow" href="signup.html" data-track="cta_click" data-track-props='{"label":"Create your coaching space","location":"login"}'><span class="la">Create your coaching space</span><span class="arr" aria-hidden="true">→</span></a></div>
        <div class="mnote" role="note"><span class="mnote-k">Looking for a coach?</span>${linkArrow("Find a coach", "/coaches")}</div>
    </div>
  </div>
</section>`;
  return { main, sticky: false, closing: false, kamran: false, bodyClass: "au-auth" };
}

export const pages = {
  "/for-trainers": hub,
  ...Object.fromEntries(SPEC_ORDER.map((p) => [p, specialty])),
  "/uae": uae,
  "/get-started": getStarted,
  "/signup": signup,
  "/login": login,
};
