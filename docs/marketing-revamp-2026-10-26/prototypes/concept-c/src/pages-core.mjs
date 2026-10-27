// Core pages built by the foundation: Home ("/") and Pricing ("/pricing").
// They set the visual and motion bar for every other page. Copy is the
// section C proposed copy (pending owner approval, decision 18).
// Styles: site/assets/core.css. Behaviour: site/assets/core.js.
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { ROOT } from "./lib/content.mjs";
import { anatomy, BOOT, CSS } from "./lib-brain.mjs";

const require = createRequire(import.meta.url);
const calc = require(resolve(ROOT, "site/assets/calc.js"));

// ---------------------------------------------------------------------------
// Home

function home({ page, href, h }) {
  const {
    esc, each, cta, secondary, linkArrow, microLine, sectionHead, ruleCard, marginNote, sampleLabel, chip,
    statusChip, whenOn, whenOff, flagged, neverSheet, founderLetter, windowFrame, lanes, phone, figure,
    statusPanel, addressPreview, pullQuote, mark, faq, stepper, field, estimateLabel, methodBadge, kamranPill,
    liveRegion, icon, valueSlot,
  } = h;

  // 1. Hero: compact, so "Anatomy of a decision" (the band right under it)
  // starts inside the first screen. The H1 stays the LCP element.
  const hero = `<section class="hero hero-home hero-c2" data-hero aria-labelledby="home-h1">
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <p class="eyebrow">For UAE personal trainers</p>
      <h1 class="display" id="home-h1">Taught by you. It ${mark("trains")} every subscriber.</h1>
    </div>
    <div class="hero-side">
      <p class="lede">Your AI learns how you coach, then coaches under your name.</p>
      <p class="lede lede-2">Routine replies use your approved words. Anything else waits for you.</p>
      <div class="hero-actions">${cta({ location: "hero" })}${secondary("Try the demo", "/demo", { location: "hero" })}</div>
      ${microLine()}
    </div>
  </div>
</section>`;

  // §1 Anatomy of a decision (spec §4): burst on view, then pinned scroll steps.
  const decides = anatomy({ n: 1, fig: 1, id: "decides" });

  // §1 What you teach it (replaces step 1 of the how-it-works band).
  const teach = `<section class="band" id="teach" aria-labelledby="teach-h">
  <div class="wrap">
    ${sectionHead({ n: 2, title: "What you teach it", id: "teach-h" })}
    <div class="teach">
      <div class="teach-copy" data-reveal>
        <p class="teach-intro">Your AI (we call it your Trainer Brain) learns three things from you.</p>
        <ol class="teach-list" data-stagger>
          <li><span class="tl-n">i</span><span class="tl-t">Rules</span><span class="tl-d">Plain words, with sources.</span></li>
          <li><span class="tl-n">ii</span><span class="tl-t">Cases</span><span class="tl-d">Real clients you coached.</span></li>
          <li><span class="tl-n">iii</span><span class="tl-t">A quiz</span><span class="tl-d">Eight answers, your judgement.</span></li>
        </ol>
      </div>
      ${pullQuote(`“Add 2.5&nbsp;kg after two <span class="nowrap">${mark("easy sessions")}.”</span>`, { cite: "Example rule", className: "teach-pull" })}
    </div>
  </div>
</section>`;

  // §2 Two-part band: you stay in charge + the signed Never sheet.
  const controlFig = figure({
    n: 2,
    className: "cf-fig",
    bodyHtml: windowFrame({
      title: "Inbox · Layla Strength",
      bodyHtml: `<div class="cf">
  <div class="cf-row"><span class="cf-k">Subscriber</span><p class="bubble bubble--in">All four of my back squat sets were at RIR 2 last session. Can I go up in weight?</p></div>
  <div class="cf-row"><span class="cf-k">Your rule</span><p class="cf-rule">Barbell load progression: +2.5 kg, inside your 5% cap</p></div>
  <div class="cf-row"><span class="cf-k">How sure</span><p class="cf-nos">Chat replies have no score. They must cite your rule. This one does.</p></div>
  <div class="cf-row cf-row--lanes"><span class="cf-k">Goes to</span>${lanes({ active: "applied" })}</div>
</div>`,
    }),
  });
  const charge = `<section class="band band--charge" id="charge" aria-labelledby="charge-h">
  <div class="wrap">
    ${sectionHead({ n: 3, title: "You stay in charge", id: "charge-h" })}
    <div class="charge">
      <div class="charge-a">
        <p class="charge-p" data-reveal>Every reply waits for you until you choose otherwise. Level 2 needs a passing check of 20+ of your own cases.</p>
        ${controlFig}
        <p data-reveal>${linkArrow("How your AI decides", "/trainer-brain")}</p>
      </div>
      <div class="charge-b">${neverSheet({ compact: true })}</div>
    </div>
  </div>
</section>`;

  // §3 How it works: steps 2 and 3, then the 8-chapter stepper (visitor-led).
  const mini = {
    address: `<div class="mini"><span class="mini-k">Your address</span><p class="mini-url"><b>layla-strength</b>.trainsyou.com</p><span class="btn-ui btn-ui--ink">Claim this address</span></div>`,
    teach: `<div class="mini"><span class="mini-k">Rule 07 · Sample</span><p class="mini-serif">Two easy sessions → add 2.5 kg</p><p class="mini-wait"><span class="chip-dot"></span>Waiting for your OK</p><div class="mini-btns"><span class="btn-ui btn-ui--ink">Confirm</span><span class="btn-ui">Edit</span></div></div>`,
    test: `<div class="mini"><span class="mini-k">Test it</span><ul class="mini-checks"><li class="ok">${icon("check", { size: 14 })}8 quiz answers</li><li class="ok">${icon("check", { size: 14 })}3 client cases</li><li>${icon("circle", { size: 14 })}20 cases for automatic sending</li></ul><p class="mini-mode">Mode: <b>Waits for me</b></p></div>`,
    offer: `<div class="mini"><span class="mini-k">Your offer · Sample</span><p class="mini-serif">Training plan</p><p class="mini-price tnum">AED 199 <small>a month</small></p><p class="mini-sub">Nutrition tier: optional</p></div>`,
    publish: `<div class="mini"><span class="mini-k">Go live</span>${flagged("publish", `<span class="btn-ui is-off">Publish your page</span>`, `<span class="btn-ui btn-ui--ink">Publish your page</span>`)}<p class="mini-sub">Shares as layla-strength.trainsyou.com</p></div>`,
    daily: `<div class="mini"><span class="mini-k">Today · Monday</span><p class="mini-serif">Lower body A</p><p class="mini-line tnum"><span>Back squat 4 × 6</span><b>62.5 kg</b></p><p class="mini-line tnum"><span>Romanian deadlift 3 × 8</span><b>50 kg</b></p></div>`,
    correct: `<div class="mini"><span class="mini-k">Your correction</span><p class="mini-quote">“Keep 60 kg. She slept badly.”</p><span class="mini-k">Suggested rule</span><p class="mini-serif">After a poor-sleep note, hold the load.</p><span class="btn-ui btn-ui--ink">Confirm</span></div>`,
    paid: `<div class="mini"><span class="mini-k">Statement · monthly</span><p class="mini-line"><span>Subscriptions</span><b>—</b></p><p class="mini-line"><span>Our share</span><b>—</b></p><p class="mini-line"><span>Payout to your UAE bank</span><b>—</b></p></div>`,
  };
  const chapter = (title, lineHtml, figHtml, chipHtml = "") => ({
    title,
    panelHtml: `<div class="chapter"><div class="chapter-copy"><h4 class="chapter-t">${esc(title)}</h4><p>${lineHtml}</p>${chipHtml ? `<p class="chips">${chipHtml}</p>` : ""}</div><div class="chapter-fig">${figHtml}</div></div>`,
  });
  const chapters = [
    chapter("Claim your address", "Your name becomes your own trainsyou address, free.", mini.address),
    chapter("Teach your AI", "Confirm rules, answer the quiz, add client cases.", mini.teach),
    chapter("Test it", "It waits for you. Automatic sending needs 20 cases and passing checks.", mini.test),
    chapter("Create your offer", "Choose your plan, its length and your AED price.", mini.offer),
    chapter("Publish and share", "Go live and share your tagged link.", mini.publish, statusChip("publish", "Not on yet", "Live today")),
    chapter("It coaches daily", "A dated plan and guided workouts for every subscriber.", mini.daily),
    chapter(
      "You correct, it learns",
      flagged("frontier", "Your corrections become suggested rules you confirm.", "Approve or correct what comes to you. Each tested release learns from it and keeps getting better."),
      mini.correct,
    ),
    chapter("Get paid monthly", "Payouts to your UAE bank, every month.", mini.paid, statusChip("payments", "Not on yet", "Live today")),
  ];
  const how = `<section class="band band--paper" id="how" aria-labelledby="how-h">
  <div class="wrap">
    ${sectionHead({ n: 4, titleHtml: "Then it coaches. <em>You decide.</em>", id: "how-h" })}
    <ol class="how-steps" data-reveal data-stagger>
      <li><span class="hs-n">1</span><div><h3 class="hs-t">You teach</h3><p><a href="#teach-h">As in §1</a>.</p></div></li>
      <li><span class="hs-n">2</span><div><h3 class="hs-t">It coaches</h3><p>A dated plan every day, guided workouts, and changes as they train.</p></div></li>
      <li><span class="hs-n">3</span><div><h3 class="hs-t">You decide</h3><p>Routine: sent within your rules. Anything else: waits for you. Red flags: paused.</p></div></li>
    </ol>
    <div class="how-stepper" data-reveal>
      ${stepper({ id: "chapters", label: "Setup, chapter by chapter", steps: chapters })}
    </div>
    <p class="how-more" data-reveal>${linkArrow("See how it works", "/how-it-works")}</p>
  </div>
</section>`;

  // §4 Under your name: the subscriber app as a product object.
  const app = `<div class="app">
  <div class="app-top"><span class="app-icon">LS</span><div><p class="app-name">Layla Strength</p><p class="app-sub">layla-strength.trainsyou.com</p></div></div>
  <p class="app-h">Today</p>
  <p class="app-sub">Monday · Week 3 · Lower body A</p>
  <div class="app-card">
    <p class="app-row"><span>Back squat 4 × 6</span><b>62.5 kg</b></p>
    <p class="app-row"><span>Romanian deadlift 3 × 8</span><b>50 kg</b></p>
    <p class="app-row"><span>Walking lunge 3 × 10</span><b>16 kg</b></p>
  </div>
  <div class="app-btn">Start workout</div>
  <p class="app-offline"><span class="app-badge">${icon("check", { size: 12 })}Saved offline</span></p>
  <div class="app-note"><p class="app-note-k">Digital coach · Layla Strength</p><p>Squats felt easy last week, so today is 62.5 kg. Tell me if anything hurts.</p></div>
  <div class="app-tabbar"><span class="on">Plan</span><span>Food</span><span>Progress</span><span>Chat</span></div>
</div>`;
  const subscribers = `<section class="band" id="subscribers" aria-labelledby="subs-h">
  <div class="wrap">
    ${sectionHead({ n: 5, title: "What subscribers get, under your name", id: "subs-h" })}
    <div class="subs">
      <div class="subs-copy" data-reveal>
        <ul class="subs-list">
          <li>Daily plan</li>
          <li>Guided workouts, offline in the gym</li>
          <li>Progress they can see</li>
          <li>Meals, groceries and a food diary ${chip("optional", "Optional tier")}</li>
          <li>Voice sessions in your voice ${chip("addon", "Add-on")} ${statusChip("voice", "Not on yet for subscribers", "Live for subscribers")}</li>
        </ul>
        <p class="subs-brand">Your site, your app icon, <span class="nowrap">your-name.trainsyou.com</span>.</p>
        <p class="fine subs-cap">Once your page is live.</p>
        <p>${linkArrow("All features", "/features")}</p>
      </div>
      ${figure({ n: 3, className: "subs-fig", bodyHtml: phone({ screenHtml: app, label: "Sample subscriber app for Layla Strength: today’s workout, saved offline" }) })}
    </div>
  </div>
</section>`;

  // §5 Free to start. Your price. Status first, before any AED figure.
  const tools = [
    ["Website builder"], ["Client app"], ["Meal-planning app"], ["Messaging app"], ["Spreadsheets"],
    ["Booking tool", "payments"], ["Payments and invoicing", "payments"],
  ];
  const price = `<section class="band" id="price" aria-labelledby="price-h">
  <div class="wrap">
    ${sectionHead({ n: 6, title: "Free to start. Your price.", id: "price-h" })}
    <div class="price">
      ${statusPanel({ id: "status", compact: true })}
      <div class="price-facts" data-reveal>
        <dl class="facts" data-stagger>
          <div><dt>Free</dt><dd>to join</dd></div>
          <div><dt>Your price</dt><dd>in AED</dd></div>
          <div><dt><span class="tnum">25% → 10%</span></dt><dd>our share, falling as you grow</dd></div>
        </dl>
        <ol class="fact-bands tnum" aria-label="Our share for each group of subscribers">${each(
          [["25%", "first 100", 1], ["20%", "101–300", 0.8], ["15%", "301–1,000", 0.6], ["10%", "1,001+", 0.4]],
          ([r, a, v], i) => `<li style="--i:${i};--v:${v}"><span class="fb-bar" aria-hidden="true"><i></i></span><b>${r}</b><span>${a}</span></li>`,
        )}</ol>
        <p class="fine fact-bands-note">Each rate applies only to the subscribers in its group.</p>
        <blockquote class="pull price-pull"><p>We earn only when your subscribers pay.</p></blockquote>
      </div>
    </div>
    <div class="replaces" data-reveal>
      <p class="replaces-k">Replaces, once live</p>
      <ul class="replaces-list" data-stagger>${each(
        tools,
        ([t, flag]) =>
          flag
            ? `<li class="is-pending">${esc(t)} ${statusChip(flag, "Not on yet", "Included")}</li>`
            : `<li><span class="struck">${esc(t)}<svg class="strike" aria-hidden="true" width="100%" height="4" preserveAspectRatio="none"><line x1="0" y1="2" x2="100%" y2="2" pathLength="100"/></svg></span></li>`,
      )}</ul>
    </div>
    <div class="price-claim" data-reveal>
      ${addressPreview({ id: "home-addr", location: "home-price" })}
      <p>${linkArrow("Pricing in detail", "/pricing")}</p>
    </div>
  </div>
</section>`;

  // §6 Follower calculator block (reported separately from the word budget).
  const D = calc.DEFAULT_FOLLOWER_INPUTS;
  const est = calc.estimateFollowerConversion(D);
  const sc = est.scenarios;
  const scen = (k, label) => `<div class="scen${k === "strong" ? " is-best" : ""}">
  <p class="scen-k">${esc(label)}</p>
  <p class="scen-v">${valueSlot(calc.aedWhole(sc[k].revenueMonth12Minor), { key: k + "-aed", w: "10ch" })}</p>
  <p class="scen-s">Active at month 12: ${valueSlot(calc.countLabel(sc[k].activeMonth12), { key: k + "-active" })}</p>
</div>`;
  const followers = `<section class="band band--paper" id="followers" aria-labelledby="followers-h" data-calc-block>
  <div class="wrap">
    ${sectionHead({ n: 7, title: "What are your followers worth?", id: "followers-h" })}
    <div class="calc" data-follower-calc>
      <form class="calc-in" aria-label="Your numbers" data-reveal>
        ${field({ id: "fc-followers", label: "Instagram followers", type: "number", value: D.followers, attrsObj: { inputmode: "numeric", min: 0, max: 10000000, "data-k": "followers" } })}
        ${field({ id: "fc-price", label: "Your monthly price", type: "number", value: D.priceAed, prefix: "AED", attrsObj: { inputmode: "numeric", min: 1, max: 10000, "data-k": "priceAed" } })}
        ${field({ id: "fc-stories", label: "Stories with your link each month", type: "number", value: D.linkStoriesPerMonth, help: "Two a week is 8 a month.", attrsObj: { inputmode: "numeric", min: 0, max: 60, "data-k": "linkStoriesPerMonth" } })}
        <p class="fine calc-assume">Also assumes 4 Reels a month with a comment keyword and 30% yearly cancellations.</p>
      </form>
      <div class="calc-out" data-reveal>
        <div class="chips">${estimateLabel()}${statusChip("payments", "Not on yet: subscriber payments", "Subscriber payments live")}</div>
        <p class="calc-k">Best case · an engaged, growing audience</p>
        <p class="calc-fig">Up to ${valueSlot(calc.aedWhole(sc.strong.revenueMonth12Minor), { key: "headline", w: "10ch" })}</p>
        <p class="calc-label">a month at your price, before platform commission</p>
        <div class="scens" role="group" aria-label="Three scenarios at month 12">${scen("cautious", "Cautious")}${scen("typical", "Typical")}${scen("strong", "Strong")}</div>
        <p class="fine calc-note">A best case, not a typical result, and not a promise. ${methodBadge("follower-formula")}</p>
        <div class="calc-cta">${cta({ location: "calculator" })}${secondary("Use the full calculator", "/follower-calculator", { location: "calculator" })}</div>
        ${liveRegion("fc-live")}
      </div>
    </div>
  </div>
</section>`;

  // §7 Founder letter + honest proof links.
  const letter = `<section class="band" id="letter" aria-labelledby="letter-h">
  <div class="wrap">
    ${sectionHead({ n: 8, title: "A letter, not testimonials", id: "letter-h" })}
    <div class="proof">
      ${founderLetter()}
      <div class="proof-side" data-reveal>
        <p class="proof-p">We publish no testimonials, logos, ratings or counts we can’t show. Check these instead:</p>
        <ul class="proof-links">
          <li>${linkArrow("Try the demo", "/demo")}</li>
          <li>${linkArrow("Every market figure sourced", "/methodology")}</li>
          <li>${linkArrow("The commission maths", "/pricing")}</li>
          <li>${linkArrow("What works today", "#status")}</li>
        </ul>
      </div>
    </div>
  </div>
</section>`;

  // §8 FAQ: six questions, ordered by objection; answers closed.
  const faqs = [
    { q: "Will my AI replace me?", a: page.faqs.find((f) => /replace/.test(f.q)).a },
    { q: "What happens when a subscriber reports pain?", a: page.faqs.find((f) => /pain/.test(f.q)).a },
    { q: "Does it cost anything to join?", a: page.faqs.find((f) => /cost/.test(f.q)).a },
    { q: "Will my followers pay?", a: "Some may. Share your link in your bio and Stories; followers choose your offer on your page. The follower calculator shows cautious, typical and best cases. An estimate, not a promise." },
    { q: "Can subscribers pay me today?", a: "Not yet. Subscriber payments are not on yet, and publishing your page waits for them. Today you can sign up, set up your page and app, and teach and test your AI." },
    { q: "Do I need technical skills?", a: page.faqs.find((f) => /technical/.test(f.q)).a },
  ];
  const questions = `<section class="band band--paper" id="questions" aria-labelledby="faq-h">
  <div class="wrap">
    ${sectionHead({ n: 9, title: "Before you start", id: "faq-h" })}
    <div class="ms">
      ${faq(faqs, { id: "home-faq" })}
      <div class="faq-side"><div class="mnote" role="note">${linkArrow("All questions", "/faq")}</div>${kamranPill({ inline: true, location: "faq" })}</div>
    </div>
  </div>
</section>`;

  return {
    main: [hero, decides, teach, charge, how, subscribers, price, followers, letter, questions].join("\n"),
    title: "Free-to-join AI trainer platform for UAE coaches",
    calc: true,
    css: CSS.anatomy,
    bodyEnd: BOOT,
    closing: { label: "Try the demo", path: "/demo" },
  };
}

// ---------------------------------------------------------------------------
// Pricing

function pricing({ page, h }) {
  const {
    esc, each, cta, secondary, linkArrow, sectionHead, chip, statusChip, flagged, statusPanel, faq, field,
    estimateLabel, methodBadge, sourceBadge, liveRegion, valueSlot, table, mark, msRow, sampleLabel, icon,
  } = h;
  const sec = (id) => page.sections.find((s) => s.id === id);
  const bandsTable = sec("bands").table;

  const toc = [
    ["glance", "At a glance"], ["falls", "How our share falls"], ["proof", "A worked example"], ["numbers", "Your numbers"],
    ["hours", "An hour sells only once"], ["statement", "Your statement"], ["billing", "Billing and payouts"],
    ["status", "What works today"], ["questions", "Questions"],
  ];
  const hero = `<section class="hero hero-pricing" data-hero aria-labelledby="pricing-h1">
  <div class="wrap hero-grid hero-grid--toc">
    <div class="hero-copy">
      <p class="eyebrow">Pricing</p>
      <h1 class="display" id="pricing-h1">Free to join. You set the ${mark("price")}.</h1>
      <p class="lede">Nothing to pay upfront. We earn only when your subscribers pay, and our share falls as you grow.</p>
      <p class="status-strip">${flagged(
        "payments",
        `<span class="chip-dot" aria-hidden="true"></span>Subscriber payments and payouts are not on yet. <a href="#status">What works today<span class="arr" aria-hidden="true">→</span></a>`,
        `${icon("check", { size: 16 })}Subscriber payments and payouts are live. <a href="#status">What works today<span class="arr" aria-hidden="true">→</span></a>`,
      )}</p>
      <div class="hero-actions">${cta({ location: "hero" })}${secondary("Estimate my earnings", "/earnings-calculator", { location: "hero" })}</div>
    </div>
    <nav class="toc" aria-label="On this page">
      <p class="toc-k">Contents</p>
      <ol>${each(toc, ([id, t], i) => `<li><a href="#${id}"><span class="toc-n">§${i + 1}</span><span>${esc(t)}</span></a></li>`)}</ol>
    </nav>
  </div>
</section>`;

  // §1 At a glance: three columns.
  const glance = `<section class="band" id="glance" aria-labelledby="glance-h">
  <div class="wrap">
    ${sectionHead({ n: 1, title: "At a glance", id: "glance-h" })}
    <div class="glance" data-reveal data-stagger>
      <div class="gl-col">
        <p class="gl-k">Free</p>
        <p class="gl-big">AED 0</p>
        <ul class="gl-list"><li>Joining</li><li>Your site and app</li><li>Teaching your AI</li><li>A free <span class="nowrap">your-name.trainsyou.com</span> address</li></ul>
      </div>
      <div class="gl-col">
        <p class="gl-k">What we take</p>
        <p class="gl-big tnum">25 · 20 · 15 · 10%</p>
        <ul class="gl-list"><li>Our share of each paying subscriber, by band</li><li>Card processing, itemised on your statement <span class="placeholder">rate: owner to confirm (decision 3)</span></li></ul>
      </div>
      <div class="gl-col">
        <p class="gl-k">Optional</p>
        <p class="gl-big">Your choice</p>
        <ul class="gl-list"><li>Your own domain, priced before you buy</li><li>Add-ons, such as voice sessions ${statusChip("voice", "Not on yet for subscribers", "Live")}</li></ul>
      </div>
    </div>
    <blockquote class="pull pricing-pull" data-reveal><p>We earn ${mark("only when")} your subscribers pay.</p></blockquote>
  </div>
</section>`;

  // §2 How our share falls: band table + slider with blended rate.
  // Piecewise display scale so the first band is readable on phones; the
  // slider runs 0-1000 positions mapped to 1-1,500 subscribers (core.js).
  const SEGS = [
    [0, 0.2, "25%", "1–100"], [0.2, 0.25, "20%", "101–300"], [0.45, 0.3, "15%", "301–1,000"], [0.75, 0.25, "10%", "1,001+"],
  ];
  const start = 300;
  const startPos = 450;
  const blended = calc.blendedRatePct(start, 199);
  const falls = `<section class="band band--paper" id="falls" aria-labelledby="falls-h">
  <div class="wrap">
    ${sectionHead({ n: 2, title: "How our share falls", id: "falls-h" })}
    <div class="ms">
      <div class="ms-text">
        <div class="meter-block" data-band-meter data-reveal>
          <div class="bm-read" aria-hidden="true">
            <p><span class="bm-k">Paying subscribers</span><span class="bm-v">${valueSlot(calc.whole(start), { key: "count", w: "5ch" })}</span></p>
            <p><span class="bm-k">Our blended share</span><span class="bm-v">${valueSlot(blended.toFixed(1) + "%", { key: "rate", w: "5ch" })}</span></p>
            <p><span class="bm-k">You keep</span><span class="bm-v">${valueSlot((100 - blended).toFixed(1) + "%", { key: "keep", w: "5ch" })}</span></p>
          </div>
          <div class="bm-track">
            <div class="bm-bar" aria-hidden="true">${each(SEGS, ([l, w], i) => `<span class="bm-seg" style="--l:${l};--w:${w};--i:${i}"><i></i></span>`)}<span class="bm-fill" style="--p:${startPos / 1000}"></span>${each(SEGS.slice(1), ([l]) => `<span class="bm-cut" style="--l:${l}"></span>`)}</div>
            <label class="sr-only" for="bm-range">Paying subscribers, from 1 to 1,500</label>
            <input class="range bm-range" id="bm-range" type="range" min="0" max="1000" step="1" value="${startPos}" aria-valuetext="${start} subscribers: our share ${blended.toFixed(1)}%">
            <div class="bm-labels" aria-hidden="true">${each(SEGS, ([l, , r, a, b]) => `<span style="--l:${l}"><b>${r}</b><small>${a}</small></span>`)}</div>
          </div>
          ${liveRegion("bm-live")}
        </div>
      </div>
      <div class="mnote" role="note" data-reveal><span class="mnote-k">Same price for everyone</span>At AED 199: 100 → 25%, 300 → 21.7%, 1,000 → 17%, 1,500 → 14.7%.</div>
    </div>
    ${msRow(
      table({ caption: bandsTable.caption, columns: bandsTable.columns, rows: bandsTable.rows.map((r) => r.map((c) => String(c).replace(/(\d)-(\d)/g, "$1–$2"))), numeric: [1], className: "bands-tbl" }),
      `<span class="mnote-k">Band rule</span>${esc(sec("bands").note)}`,
    )}
  </div>
</section>`;

  // §3 Worked example, set like a proof.
  const proof = `<section class="band" id="proof" aria-labelledby="proof-h">
  <div class="wrap">
    ${sectionHead({ n: 3, title: "A worked example", id: "proof-h" })}
    <div class="ms">
      <div class="proof-sheet" data-reveal>
        <div class="proof-top"><span class="proof-k">Example · not a forecast</span>${statusChip("payments", "Not on yet: subscriber payments", "Subscriber payments live")}</div>
        <ol class="proof-lines" data-stagger>
          <li><span class="pl-k">Given</span><span class="pl-x tnum">150 subscribers × AED 199 a month</span><span class="pl-v tnum">AED 29,850</span></li>
          <li><span class="pl-k">Our share</span><span class="pl-x tnum">first 100 × AED 199 × 25%</span><span class="pl-v tnum">AED 4,975</span></li>
          <li><span class="pl-k"></span><span class="pl-x tnum">next 50 × AED 199 × 20%</span><span class="pl-v tnum">AED 1,990</span></li>
          <li class="pl-sum"><span class="pl-k"></span><span class="pl-x">Commission</span><span class="pl-v tnum">AED 6,965</span></li>
          <li class="pl-result"><span class="pl-k therefore" aria-label="Therefore">∴</span><span class="pl-x">You keep, before card processing</span><span class="pl-v tnum">AED 22,885</span></li>
        </ol>
        <p class="proof-foot tnum">About 92 sessions at AED 250.</p>
      </div>
      <div class="mnote" role="note" data-reveal><span class="mnote-k">Read it like this</span>Each band’s rate applies only to the subscribers inside it. Card processing is itemised on top.</div>
    </div>
  </div>
</section>`;

  // §4 Compact earnings calculator.
  const E = calc.DEFAULT_EARNINGS_INPUTS;
  const ce = calc.estimateEarnings({ ...E, nutritionSharePct: 0, voiceSharePct: 0, sessionsPerMonth: 0 });
  const numbers = `<section class="band band--paper" id="numbers" aria-labelledby="numbers-h">
  <div class="wrap">
    ${sectionHead({ n: 4, title: "Your numbers", id: "numbers-h" })}
    <div class="calc" data-earnings-calc>
      <form class="calc-in" aria-label="Your offer" data-reveal>
        ${field({ id: "ec-subs", label: "Paying subscribers", type: "number", value: E.subscribers, attrsObj: { inputmode: "numeric", min: 0, max: 100000, "data-k": "subscribers" } })}
        ${field({ id: "ec-price", label: "Your price per month", type: "number", value: E.workoutPriceAed, prefix: "AED", attrsObj: { inputmode: "numeric", min: 0, max: 10000, "data-k": "workoutPriceAed" } })}
        ${field({ id: "ec-rate", label: "Your usual in-person rate per session", type: "number", value: E.yourSessionRateAed, prefix: "AED", attrsObj: { inputmode: "numeric", min: 0, max: 10000, "data-k": "yourSessionRateAed" } })}
      </form>
      <div class="calc-out" data-reveal>
        <div class="chips"><span class="eyebrow">Illustrative arithmetic</span>${statusChip("payments", "Not on yet: subscriber payments", "Subscriber payments live")}</div>
        <p class="calc-fig">${valueSlot(calc.aedWhole(ce.beforeOtherCostsMinor), { key: "kept", w: "10ch" })}</p>
        <p class="calc-label">a month before other costs and tax</p>
        <dl class="calc-lines">
          <div><dt>Subscriptions</dt><dd>${valueSlot(calc.aedWhole(ce.subscriptionMonthlyMinor), { key: "subs", w: "11ch", align: "end" })}</dd></div>
          <div><dt>Our share overall</dt><dd>${valueSlot(calc.pct(ce.effectiveCommissionPct), { key: "eff", w: "6ch", align: "end" })}</dd></div>
          <div><dt>Commission</dt><dd>${valueSlot("−" + calc.aedWhole(ce.commissionMinor), { key: "comm", w: "11ch", align: "end" })}</dd></div>
          <div><dt>Sessions at your usual rate, for the same money</dt><dd>${valueSlot("about " + ce.equivalentSessions, { key: "sessions", w: "9ch", align: "end" })}</dd></div>
        </dl>
        <p class="fine">Not an earnings promise. Excludes payment processing, your own domain, refunds, disputes, any booking fee and tax. ${methodBadge("earnings-method", "Assumptions")}</p>
        <div class="calc-cta">${secondary("Estimate my earnings", "/earnings-calculator", { location: "inline", variant: "button" })}</div>
        ${liveRegion("ec-live")}
      </div>
    </div>
  </div>
</section>`;

  // §5 An hour sells only once (sourced anchors).
  const hoursSec = sec("hours");
  const hours = `<section class="band" id="hours" aria-labelledby="hours-h">
  <div class="wrap">
    ${sectionHead({ n: 5, title: hoursSec.heading, id: "hours-h" })}
    <div class="anchors" data-reveal data-stagger>
      <div class="anchor"><p class="anchor-v tnum">AED 70–350</p><p class="anchor-k">a one-to-one session in Dubai ${sourceBadge("heytrainer-dubai-2026")}</p><p class="anchor-s">Experienced or premium trainers charge more. ${sourceBadge("embody-dubai-2025")}</p></div>
      <div class="anchor"><p class="anchor-v tnum">AED 400–2,000</p><p class="anchor-k">a month of online coaching ${sourceBadge("369mmafit-online-2026")}</p></div>
    </div>
    ${msRow(`<p class="big-p">Your AI coaches many people at once, at a monthly price more followers can afford. You keep the sessions only you can serve.</p>`, `<span class="mnote-k">About these figures</span>${esc(hoursSec.note)}`)}
  </div>
</section>`;

  // §6 Statement extras as a sample statement.
  const statement = `<section class="band band--paper" id="statement" aria-labelledby="statement-h">
  <div class="wrap">
    ${sectionHead({ n: 6, title: "Your statement", id: "statement-h" })}
    <div class="ms">
      <div class="stmt" data-reveal>
        <div class="stmt-head"><p class="stmt-t">Statement · one month</p><div class="chips">${sampleLabel("Sample · the worked example")}${statusChip("payments", "Not on yet", "Live")}</div></div>
        <dl class="stmt-lines">
          <div><dt>Subscriptions</dt><dd class="tnum">AED 29,850</dd></div>
          <div><dt>Our share, by band</dt><dd class="tnum">−AED 6,965</dd></div>
          <div><dt>Payment processing</dt><dd><span class="placeholder">itemised · decision 3</span></dd></div>
          <div><dt>Your own domain, if you choose one</dt><dd>itemised</dd></div>
          <div><dt>Refunds, disputes and any booking fee in your finance policy</dt><dd>itemised</dd></div>
        </dl>
      </div>
      <div class="mnote" role="note" data-reveal><span class="mnote-k">Every cost, one place</span>Nothing is taken that isn’t on your monthly statement.</div>
    </div>
  </div>
</section>`;

  // §7 Billing and payouts.
  const billing = `<section class="band" id="billing" aria-labelledby="billing-h">
  <div class="wrap">
    ${sectionHead({ n: 7, title: "Billing and payouts", id: "billing-h" })}
    <div class="two" data-reveal data-stagger>
      <div><h3 class="h3">Programme length and billing</h3><p>${esc(sec("billing").body[0])}</p></div>
      <div><h3 class="h3">Monthly payouts to a UAE bank ${statusChip("payments", "Not on yet", "Live")}</h3><p>${esc(sec("payouts").body[0])}</p></div>
    </div>
  </div>
</section>`;

  // §8 Live today / Not on yet (full panel).
  const status = `<section class="band band--paper" aria-labelledby="status-h">
  <div class="wrap">
    ${sectionHead({ n: 8, title: "What works today", id: "status-h" })}
    ${statusPanel({ id: "status", title: "Live today, and not on yet" })}
  </div>
</section>`;

  // §9 FAQ (6).
  const f = (re) => page.faqs.find((x) => re.test(x.q)).a;
  const faqs = [
    { q: "What does it cost to join?", a: f(/cost anything/) },
    { q: "Who sets the price?", a: f(/Who sets/) },
    { q: "What will I pay?", a: f(/What will I pay/) },
    { q: "How does commission work with different prices?", a: f(/different prices/) },
    { q: "Who owns my subscribers’ data, and what if I leave?", a: "Your method and your subscribers’ records stay private to your workspace and are never used for another trainer. Subscribers can export or delete their data. Export wording for trainers who leave is being confirmed." },
    { q: "Can subscribers pay me today?", a: "Not yet. Subscriber payments are not on yet, and publishing your page waits for them. Today you can sign up, set up your page and app, and teach and test your AI." },
  ];
  const questions = `<section class="band" id="questions" aria-labelledby="pfaq-h">
  <div class="wrap">
    ${sectionHead({ n: 9, title: "Questions", id: "pfaq-h" })}
    <div class="ms">${faq(faqs, { id: "pricing-faq" })}<div class="faq-side"><div class="mnote" role="note"><span class="mnote-k">More answers</span>${linkArrow("All questions", "/faq")}</div>${h.kamranPill({ inline: true, location: "faq" })}</div></div>
  </div>
</section>`;

  return {
    main: [hero, glance, falls, proof, numbers, hours, statement, billing, status, questions].join("\n"),
    title: page.title,
    calc: true,
    closing: { label: "Estimate my earnings", path: "/earnings-calculator" },
  };
}

export const pages = { "/": home, "/pricing": pricing };
