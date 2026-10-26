// Core pages built by the foundation: "/" (home) and "/pricing".
// They set the visual and motion bar; copy follows blueprint C1 and C15.
import { createRequire } from "node:module";
import { content } from "./registry.mjs";
import {
  esc, icon, cta, ctaMicro, button, textLink, band, sectionHead, h1WithMark, chip, flagChip, notOnYet, sourceBadge,
  estimateLabel, sampleLabel, pendingTag, constraintList, founderNote, statusPanel, faqList, vx, decisionConsole,
  ruleBuilder, walkthrough, addressPreview, kamranPill, phoneFrame, windowFrame, appHead, dataTable, statementLines, lanePill,
} from "./components.mjs";

// The browser maths module doubles as a CommonJS module, so first-paint figures match the live widgets.
const calc = createRequire(import.meta.url)("../site/assets/calc.js");
const page = (p) => content.pages.find((x) => x.path === p);
const faqFrom = (p, q) => page(p).faqs.find((f) => f.q === q);

/* =============================================================== HOME */

function homeHero() {
  return `<section class="band band-white hero" data-hero aria-labelledby="hero-h">
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <p class="kicker">For UAE personal trainers</p>
      ${h1WithMark("Teach your AI. It trains your subscribers.", "trains", { id: "hero-h" })}
      <p class="lede">Share your rules. Your AI coaches every subscriber day by day, your way.</p>
      <div class="cta-row hero-ctas">${cta({ location: "hero", size: "lg" })}${button("/demo", "Try the demo", { location: "hero", size: "lg" })}</div>
      ${ctaMicro()}
    </div>
    <div class="hero-media">${decisionConsole({ id: "hero-console" })}</div>
  </div>
</section>`;
}

function homeChangeRule() {
  return band(
    { tone: "paper", cls: "rule-band", label: "rule-h" },
    `<div class="split">
  <div class="s-copy" data-reveal>
    <h2 id="rule-h">Change the rule yourself</h2>
    <p class="sec-lede mt-s">Edit the sample rule. Watch the decision change.</p>
    <p class="mt-m">${textLink("/demo", "Open the full demo", { location: "inline" })}</p>
  </div>
  <div class="s-media rule-media" data-reveal>${ruleBuilder({ id: "home-rule" })}${sampleLabel("Sample trainer · scripted · no AI model called")}</div>
</div>`,
  );
}

function homeHow() {
  const steps = [
    { n: "01", t: "You teach", b: "Rules, cases and an 8-answer quiz shape your AI (we call it your Trainer Brain)." },
    { n: "02", t: "It coaches", b: "A dated plan daily, guided workouts, adjusted as they train." },
    { n: "03", t: "You decide", b: "Confident → applied. Unsure → to you. Pain → paused." },
  ];
  const chapters = page("/how-it-works").sections.find((s) => s.id === "steps").steps.map((s) => ({
    title: s.title,
    body: s.body,
    chip: s.title === "Publish and share" ? notOnYetChip("publish") : s.title === "Get paid monthly" ? notOnYetChip("payments") : "",
  }));
  return band(
    { tone: "white", cls: "how-band", label: "how-h" },
    `${sectionHead({ title: "How it works", id: "how-h" })}
<ol class="how-steps" data-reveal="stagger">${steps
      .map((s) => `<li class="how-step ri"><span class="mono how-n">${s.n}</span><h3>${esc(s.t)}</h3><p>${esc(s.b)}</p></li>`)
      .join("")}</ol>
<div class="how-walk" data-reveal>
  <div class="how-walk-head"><p class="walk-label" id="home-walk-l">Setup to payday · 8 steps</p>${textLink("/how-it-works", "See how it works")}</div>
  ${walkthrough(chapters, { id: "home-walk", label: "Setup to payday, 8 steps" })}
</div>`,
  );
}
/** "Not on yet" chip that turns into "Live" with its flag. */
const notOnYetChip = (flag) => flagChip(flag, "Live", "Not on yet");

function homeSubscribers() {
  const items = [
    ["A daily plan, your way", chip("Included", "live")],
    ["Guided workouts, offline too", chip("Included", "live")],
    ["Progress they can see", chip("Included", "live")],
    ["Nutrition: meals, groceries, food diary", chip("Optional tier", "live")],
    ["Sessions led in your voice", `${chip("Add-on", "neutral")}${flagChip("voice", "Live", "Not on yet")}`],
  ];
  const screen = `${appHead()}
  <div class="today">
    <p class="today-date mono">Monday · Week 4</p>
    <p class="today-title">Lower body, 45 min</p>
    <div class="today-card"><span class="today-play" aria-hidden="true">${icon("arrow")}</span><span><strong>Start workout</strong><small>5 exercises · saved for offline</small></span></div>
    <div class="today-progress">
      <p><span>Squat</span><span class="mono">50 → 62.5 kg</span></p>
      <svg viewBox="0 0 200 48" class="spark" aria-hidden="true"><polyline points="2,44 34,40 66,34 98,30 130,22 162,16 198,6" /><circle cx="198" cy="6" r="3.5" /></svg>
    </div>
    <div class="today-row"><span>Meals</span><span class="mono">3 of 4 logged</span></div>
  </div>
  <div class="app-tabs" aria-hidden="true"><span class="is-on">Today</span><span>Plan</span><span>Chat</span><span>Progress</span></div>`;
  return band(
    { tone: "white", cls: "subs-band", label: "subs-h" },
    `<div class="split split-flip subs-split">
  <div class="s-copy" data-reveal>
    ${sectionHead({ title: "What subscribers get, under your name", id: "subs-h", reveal: false })}
    <ul class="offer-list">${items.map(([t, c]) => `<li><span>${esc(t)}</span><span class="offer-chips">${c}</span></li>`).join("")}</ul>
    <p class="brand-line">Your site, your app icon, <span class="mono">your-name.trainsyou.com</span>.</p>
    <p class="note mt-s">Once your page is live.</p>
    <p class="mt-s">${textLink("/features", "All features")}</p>
  </div>
  <div class="s-media" data-reveal>
    <div class="subs-stage dots">
      <div class="url-chip" aria-hidden="true">${icon("lock")}<span class="mono">laylastrength.trainsyou.com</span></div>
      ${phoneFrame(screen, { cls: "subs-phone", label: "Sample subscriber app for Layla Strength: today's workout saved for offline, squat progress from 50 to 62.5 kg, and meals logged." })}
      <div class="app-icon" aria-hidden="true"><span>LS</span><small>Layla</small></div>
    </div>
    ${sampleLabel("Sample trainer")}
  </div>
</div>`,
  );
}

function homeControl() {
  const lanes = [
    { tone: "applied", label: "Applied automatically", ex: "Squats felt easy → +2.5 kg", on: true },
    { tone: "toyou", label: "Unsure → to you", ex: "Hotel gym for two weeks" },
    { tone: "paused", label: "Pain → paused, to you", ex: "“My knee hurts when I squat”" },
  ];
  const flow = windowFrame(
    `<div class="flow">
  <p class="flow-msg"><span class="cp-label">Subscriber</span><span class="bubble bubble-out">Week three done. Squats felt easy.</span></p>
  <div class="flow-rule"><div class="rule-chip"><span class="rule-src">Your rule</span><code class="rule-text mono">two easy sessions → add 2.5 kg</code></div><span class="flow-conf mono">86% sure</span></div>
  <ul class="flow-lanes">${lanes
    .map((l) => `<li class="flow-lane${l.on ? " is-on" : ""}">${lanePill(l.label, l.tone)}<span class="mono flow-ex">${esc(l.ex)}</span>${l.on ? `<span class="flow-here">${icon("check")}This one</span>` : ""}</li>`)
    .join("")}</ul>
</div>`,
    { title: "How your AI decides", meta: "Sample", cls: "flow-window" },
  );
  return band(
    { tone: "paper", cls: "control-band", label: "control-h" },
    `<div class="split control-split">
  <div class="s-copy" data-reveal>
    <h2 id="control-h">You stay in charge</h2>
    <p class="waits"><strong>“Waits for me” mode:</strong> replies wait for you until automatic sending is on. That needs 20 cases and passing checks.</p>
    <p class="mt-s">${textLink("/trainer-brain", "How your AI decides")}</p>
  </div>
  <div class="s-media" data-reveal>${flow}</div>
</div>
${constraintList({ items: ["Hide pain or red flags from you.", "Pretend to be you.", "Give medical advice.", "Use your teaching elsewhere."], id: "never" })}`,
  );
}

function homeEconomics() {
  const replaces = ["Website builder", "Client app", "Meal-planning app", "Messaging app", "Spreadsheets"];
  return band(
    { tone: "white", id: "what-works", cls: "econ-band", label: "econ-h" },
    `${sectionHead({ title: "Free to start. Your price.", id: "econ-h", layout: "split", lede: "We earn only when your subscribers pay." })}
<div class="econ-grid">
  <div class="econ-status" data-reveal>${statusPanel({ id: "status" })}</div>
  <ol class="econ-facts" data-reveal="stagger">
    <li class="ri"><span class="mono econ-n">01</span><h3>Free to join</h3></li>
    <li class="ri"><span class="mono econ-n">02</span><h3>You set the AED price</h3></li>
    <li class="ri"><span class="mono econ-n">03</span><h3>Our share falls as you grow</h3>
      <ul class="band-list mono"><li><b>25%</b> first 100</li><li><b>20%</b> 101–300</li><li><b>15%</b> 301–1,000</li><li><b>10%</b> 1,001+</li></ul>
      <p class="note">Each rate applies to its band only.</p></li>
  </ol>
</div>
<div class="econ-lower">
  <div class="replaces" data-reveal>
    <p class="replaces-h">Tools it replaces</p>
    <ul class="replaces-list">${replaces.map((r) => `<li>${icon("check")}${esc(r)}</li>`).join("")}
      <li>${icon("minus")}Booking tool ${notOnYetChip("payments")}</li>
      <li>${icon("minus")}Payments and invoicing ${notOnYetChip("payments")}</li></ul>
    <p class="note">Once your page is live.</p>
  </div>
  <div class="claim card" data-reveal>${addressPreview({ id: "home-addr" })}</div>
</div>
<p class="econ-link">${textLink("/pricing", "Pricing in detail")}</p>`,
  );
}

/** Compact follower calculator (home band 6); maths from calc.js, first paint computed here. */
function followerMini() {
  const d = { followers: 7000, priceAed: 199, linkStoriesPerMonth: 8 };
  const est = calc.estimateFollowers(d);
  const v = (s) => est.scenarios[s].revenueMonth12Minor;
  const max = Math.max(1, v("strong"));
  const lane = (key, label) =>
    `<div class="calc-lane" data-lane="${key}"><span class="calc-lane-label">${esc(label)}</span><span class="calc-lane-bar"><span style="--v:${(v(key) / max).toFixed(4)}"></span></span><span class="calc-lane-val">${vx(calc.aed(v(key)), 11, { cls: "vx-end" })}</span></div>`;
  const field = (id, label, value, max, affix = "") =>
    `<div class="field"><label for="${id}">${esc(label)}</label><div class="${affix ? "input-affix" : ""}">${affix ? `<span class="affix">${affix}</span>` : ""}<input class="input mono-input" id="${id}" name="${id}" type="number" inputmode="numeric" min="0" max="${max}" step="1" value="${value}"></div></div>`;
  return `<div class="calc" data-follower-calc>
  <div class="calc-inputs" data-reveal><form class="calc-form" novalidate>
    ${field("fc-followers", "Instagram followers", d.followers, 10000000)}
    ${field("fc-price", "Your monthly price", d.priceAed, 10000, "AED")}
    ${field("fc-stories", "Stories with your link each month", d.linkStoriesPerMonth, 60)}
    <p class="note">Also assumes 4 keyword Reels a month and 30% of subscribers cancelling a year. ${textLink("/follower-calculator", "Change every input")}</p>
  </form></div>
  <div class="calc-result" data-reveal>
    ${windowFrame(
      `<div class="calc-head">${chip("Best case", "neutral")}${notOnYet("payments", "subscriber payments")}${estimateLabel()}</div>
      <p class="calc-figure-line"><span class="calc-upto">Up to</span> <span class="calc-figure">${vx(calc.aed(v("strong")), 10, { cls: "fc-strong" })}</span></p>
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

function homeFollowers() {
  return band(
    { tone: "paper", cls: "fc-band", label: "fc-h" },
    `${sectionHead({ kicker: "Calculator", title: "What are your followers worth?", id: "fc-h", layout: "split", lede: "A best case for an engaged, growing audience, from published benchmarks. An estimate, not a promise." })}
${followerMini()}`,
  );
}

function homeProof() {
  const checks = [
    ["/demo", "Try the demo"],
    ["/methodology", "Every market figure sourced"],
    ["/pricing#share", "The commission maths"],
    ["#status", "What works today"],
  ];
  return band(
    { tone: "white", cls: "proof-band", label: "proof-h" },
    `<div class="split proof-split">
  <div class="s-copy" data-reveal>
    <h2 id="proof-h">Proof you can check</h2>
    <div class="mt-m">${founderNote()}</div>
  </div>
  <div class="s-media" data-reveal>
    <p class="body-l">We publish no testimonials, logos, ratings or counts we can’t show. Check these instead:</p>
    <ul class="check-list">${checks.map(([p, l]) => `<li>${textLink(p, l)}</li>`).join("")}</ul>
  </div>
</div>`,
  );
}

function homeFaq() {
  const faqs = [
    { id: "replace", q: "Will my AI replace me?", a: faqFrom("/faq", "Will the AI replace me?").a },
    { id: "pain", ...faqFrom("/faq", "What happens when a subscriber reports pain?") },
    { id: "cost", ...faqFrom("/faq", "Does it cost anything to join?") },
    { id: "followers", ...faqFrom("/faq", "Will my followers pay?") },
    { id: "pay-today", q: "Can subscribers pay me today?", a: "Not yet. Subscriber payments are not on yet, and publishing your page waits for them. Today you can join, set up your page and app, and teach and test your AI." },
    { id: "skills", ...faqFrom("/faq", "Do I need technical skills?") },
  ];
  return band(
    { tone: "white", cls: "faq-band", label: "faq-h" },
    `<div class="split faq-split">
  <div class="s-copy" data-reveal>
    <h2 id="faq-h">Questions trainers ask</h2>
    <p class="mt-s">${textLink("/faq", "All questions")}</p>
    <div class="kamran-inline-m">${kamranPill()}</div>
  </div>
  <div class="s-media" data-reveal>${faqList(faqs, { prefix: "hfaq" })}</div>
</div>`,
  );
}

function home() {
  return {
    title: "trainsyou · Teach your AI. It trains your subscribers.",
    main: [homeHero(), homeChangeRule(), homeHow(), homeSubscribers(), homeControl(), homeEconomics(), homeFollowers(), homeProof(), homeFaq()].join("\n"),
    js: ["calc.js"],
    closing: { secondary: { label: "Try the demo", path: "/demo" } },
  };
}

/* ============================================================ PRICING */

function pricingHero() {
  const steps = [
    { r: 25, l: "1–100" },
    { r: 20, l: "101–300" },
    { r: 15, l: "301–1,000" },
    { r: 10, l: "1,001+" },
  ];
  return `<section class="band band-white hero pricing-hero" data-hero aria-labelledby="hero-h">
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <p class="kicker">Pricing</p>
      <h1 id="hero-h">Free to join. You set the price.</h1>
      <p class="lede">Nothing to pay upfront. We earn only when your subscribers pay, and our share falls as you grow.</p>
      <div class="cta-row hero-ctas">${cta({ location: "hero", size: "lg" })}${button("/earnings-calculator", "Estimate my earnings", { location: "hero", size: "lg" })}</div>
      ${ctaMicro()}
    </div>
    <div class="hero-media">
      <figure class="stairs dots" aria-labelledby="stairs-cap">
        <div class="stairs-chart" role="img" aria-label="What you keep per paying subscriber, before card processing: 75% for subscribers 1 to 100, 80% for 101 to 300, 85% for 301 to 1,000 and 90% above 1,000. Our share is 25%, 20%, 15% and 10%.">
          ${steps.map((s) => `<div class="stair" style="--k:${(100 - s.r) / 100}"><span class="stair-track"><span class="stair-share mono">${s.r}% ours</span><span class="stair-keep"><span class="stair-rate mono">${100 - s.r}%</span><small>you keep</small></span></span><span class="stair-l mono">${s.l}</span></div>`).join("")}
        </div>
        <figcaption id="stairs-cap"><span>What you keep per paying subscriber, by band</span><span class="mono">Before card processing · each rate applies only to its band</span></figcaption>
      </figure>
    </div>
  </div>
  <div class="wrap"><p class="status-strip" data-show="payments:off">${icon("minus")}<span>Subscriber payments and payouts are not on yet.</span> <a href="#status">What works today</a></p></div>
</section>`;
}

function pricingGlance() {
  const cols = [
    { h: "Free", b: "Joining, your site and app, teaching your AI, and a free trainsyou address.", extra: "" },
    { h: "What we take", b: "Our share per paying subscriber: 25%, 20%, 15% or 10% by band. Card processing itemised.", extra: pendingTag("Card-processing rate: owner decision 3") },
    { h: "Optional", b: "Your own domain, priced before you buy, and add-ons you choose.", extra: "" },
  ];
  return band(
    { tone: "white", cls: "glance-band", label: "glance-h" },
    `${sectionHead({ kicker: "At a glance", title: "What’s free, what we take", id: "glance-h", layout: "split", lede: "We earn only when your subscribers pay." })}
<ul class="glance" data-reveal="stagger">${cols.map((c) => `<li class="ri"><h3>${esc(c.h)}</h3><p>${esc(c.b)}</p>${c.extra}</li>`).join("")}</ul>`,
  );
}

function bandMeter() {
  const n = 300, price = 199;
  const e = calc.compactEarnings(n, price, 250);
  const segs = [
    { r: 25, from: 1, size: 100, l: "1–100" },
    { r: 20, from: 101, size: 200, l: "101–300" },
    { r: 15, from: 301, size: 700, l: "301–1,000" },
    { r: 10, from: 1001, size: 500, l: "1,001+" },
  ];
  const fillFor = (s) => Math.max(0, Math.min(1, (n - s.from + 1) / s.size));
  return `<div class="meter card" data-band-meter data-reveal>
  <div class="meter-controls">
    <div class="meter-n"><label for="meter-range">Paying subscribers</label><span class="mono meter-count">${vx(calc.whole(n), 5, { cls: "vx-end" })}</span></div>
    <input type="range" id="meter-range" min="1" max="1500" step="1" value="${n}" aria-valuetext="${n} paying subscribers">
    <div class="field meter-price"><label for="meter-price">At your monthly price</label><div class="input-affix"><span class="affix">AED</span><input class="input" id="meter-price" type="number" inputmode="numeric" min="1" max="10000" value="${price}"></div></div>
  </div>
  <div class="meter-bar" aria-hidden="true">${segs
    .map((s, i) => `<div class="seg${fillFor(s) > 0 && fillFor(s) < 1 ? " is-active" : ""}" style="--i:${i}" data-from="${s.from}" data-size="${s.size}"><span class="seg-rate mono">${s.r}%</span><span class="seg-track"><span class="seg-fill" style="--f:${fillFor(s)}"></span></span><span class="seg-l mono">${s.l}</span></div>`)
    .join("")}</div>
  <dl class="meter-out">
    <div><dt>Blended rate</dt><dd class="mono">${vx(calc.pct(e.effectiveCommissionPct), 6, { cls: "m-rate" })}</dd></div>
    <div><dt>Our share a month</dt><dd class="mono">${vx(calc.aed(e.commissionMinor), 11, { cls: "m-share" })}</dd></div>
    <div><dt>You keep, before card processing ${notOnYet("payments", "payments")}</dt><dd class="mono">${vx(calc.aed(e.subscriptionMonthlyMinor - e.commissionMinor), 11, { cls: "m-keep" })}</dd></div>
  </dl>
  <p class="note">Reaching a new band lowers the rate for subscribers in that band only.</p>
  <p class="sr-only" aria-live="polite" data-live></p>
</div>`;
}

function pricingShare() {
  const t = page("/pricing").sections.find((s) => s.id === "bands").table;
  return band(
    { tone: "paper", id: "share", cls: "share-band", label: "share-h" },
    `${sectionHead({ kicker: "Commission", title: "How our share falls", id: "share-h", layout: "split", lede: "Move the slider. Each band keeps its own rate, so growing never raises the rate on earlier subscribers." })}
<div class="share-grid">
  ${bandMeter()}
  <div class="share-table" data-reveal>${dataTable({ caption: t.caption, columns: t.columns, rows: t.rows.map((r) => [r[0], { html: `<span class="mono">${esc(r[1])}</span>` }]) })}</div>
</div>`,
  );
}

function pricingExample() {
  const e = calc.compactEarnings(150, 199, 250);
  const b1 = e.bands[0], b2 = e.bands[1];
  const keep = e.subscriptionMonthlyMinor - e.commissionMinor;
  const lines = [
    { label: "150 paying subscribers × AED 199", value: calc.aed(e.subscriptionMonthlyMinor) },
    { label: "Our share · subscribers 1–100 at 25%", value: "− " + calc.aed(b1.commissionMinor), tone: "minus" },
    { label: "Our share · subscribers 101–150 at 20%", value: "− " + calc.aed(b2.commissionMinor), tone: "minus" },
    { label: "You keep, before card processing", value: calc.aed(keep), tone: "total" },
    { label: "Card processing", value: "Itemised", tone: "muted" },
  ];
  const stmt = windowFrame(
    `<div class="stmt-head">${chip("Sample", "sample")}${notOnYet("payments", "subscriber payments")}</div>${statementLines(lines)}<p class="stmt-foot mono">≈ ${calc.whole(Math.round(keep / 25000))} sessions at AED 250</p>`,
    { title: "Statement · sample month", meta: "AED", cls: "stmt-window" },
  );
  return band(
    { tone: "white", cls: "example-band", label: "example-h" },
    `<div class="split">
  <div class="s-copy" data-reveal>
    <p class="kicker">Worked example</p>
    <h2 id="example-h">150 subscribers at AED 199</h2>
    <p class="sec-lede mt-s">Commission is ${calc.aed(b1.commissionMinor)} plus ${calc.aed(b2.commissionMinor)}: ${calc.aed(e.commissionMinor)}. You keep ${calc.aed(keep)} before card processing, about ${Math.round(keep / 25000)} sessions at AED 250.</p>
  </div>
  <div class="s-media" data-reveal>${stmt}</div>
</div>`,
  );
}

function earningsMini() {
  const d = { n: 60, price: 199, rate: 250 };
  const e = calc.compactEarnings(d.n, d.price, d.rate);
  const field = (id, label, value, max, affix = "") =>
    `<div class="field"><label for="${id}">${esc(label)}</label><div class="${affix ? "input-affix" : ""}">${affix ? `<span class="affix">${affix}</span>` : ""}<input class="input" id="${id}" type="number" inputmode="numeric" min="0" max="${max}" step="1" value="${value}"></div></div>`;
  return `<div class="calc" data-earnings-calc>
  <form class="calc-inputs" novalidate data-reveal>
    ${field("ec-subs", "Paying subscribers", d.n, 100000)}
    ${field("ec-price", "Workout price per month", d.price, 10000, "AED")}
    ${field("ec-rate", "Your usual in-person rate per session", d.rate, 10000, "AED")}
  </form>
  <div class="calc-result" data-reveal>${windowFrame(
    `<div class="calc-head">${notOnYet("payments", "subscriber payments")}${estimateLabel()}</div>
    <p class="calc-figure-line"><span class="calc-figure">${vx(calc.aed(e.beforeOtherCostsMinor), 10, { cls: "ec-net" })}</span></p>
    <p class="calc-sub">a month before other costs and tax · about <span class="mono">${vx(calc.whole(e.equivalentSessions), 0, { cls: "ec-sess" })}</span> sessions at your usual rate</p>
    <dl class="stmt mt-m">
      <div class="stmt-row"><dt>Subscriptions</dt><dd>${vx(calc.aed(e.subscriptionMonthlyMinor), 11, { cls: "vx-end ec-subs" })}</dd></div>
      <div class="stmt-row"><dt>Our share (<span class="mono">${vx(calc.pct(e.effectiveCommissionPct, 2), 0, { cls: "ec-pct" })}</span> overall)</dt><dd>${vx("− " + calc.aed(e.commissionMinor), 13, { cls: "vx-end ec-comm" })}</dd></div>
    </dl>
    <p class="note mt-s">Not an earnings promise. Excludes payment processing, your own domain, refunds, disputes, any booking fee and tax. <a class="inline-link" href="methodology.html#earnings-calculator">Assumptions</a></p>
    <p class="sr-only" aria-live="polite" data-live></p>`,
    { title: "Earnings estimate", meta: "monthly", cls: "calc-window" },
  )}</div>
  <div class="fc-cta">${button("/earnings-calculator", "Estimate my earnings", { location: "inline" })}<p class="micro">Add nutrition, voice and sessions there.</p></div>
</div>`;
}

function pricingCalc() {
  return band(
    { tone: "paper", cls: "ecalc-band", label: "ecalc-h" },
    `${sectionHead({ kicker: "Calculator", title: "Estimate what you keep", id: "ecalc-h", layout: "split", lede: "Subscriptions only, at one price. Everything else is in the full calculator." })}
${earningsMini()}`,
  );
}

function pricingHours() {
  const s = page("/pricing").sections.find((x) => x.id === "hours");
  return band(
    { tone: "white", cls: "hours-band", label: "hours-h" },
    `<div class="split">
  <div class="s-copy" data-reveal>
    <p class="kicker">Why online</p>
    <h2 id="hours-h">${esc(s.heading)}</h2>
    <p class="sec-lede mt-s">${esc(s.body[1])}</p>
  </div>
  <div class="s-media hours-figs" data-reveal="stagger">
    <div class="hours-fig ri"><p class="fact-figure mono-fig">AED 70–350</p><p>a one-to-one session in Dubai ${sourceBadge("heytrainer-dubai-2026")}</p></div>
    <div class="hours-fig ri"><p class="fact-figure mono-fig">AED 400–2,000</p><p>a month of online coaching ${sourceBadge("369mmafit-online-2026")}</p></div>
    <p class="note ri">${esc(s.note)}</p>
  </div>
</div>`,
  );
}

function pricingDetails() {
  const p = page("/pricing");
  const sec = (id) => p.sections.find((s) => s.id === id);
  const st = sec("statement"), bi = sec("billing"), po = sec("payouts");
  return band(
    { tone: "white", cls: "details-band", label: "details-h" },
    `${sectionHead({ kicker: "The fine print", title: "Billing, statements and payouts", id: "details-h" })}
<div class="cols-3 details" data-reveal="stagger">
  <div class="ri rule-top"><h3>${esc(st.heading)}</h3><ul class="dash-list">${st.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul></div>
  <div class="ri rule-top"><h3>${esc(bi.heading)}</h3><p>${esc(bi.body[0])}</p></div>
  <div class="ri rule-top"><h3>${esc(po.heading)} ${flagChip("payments", "Live", "Not on yet")}</h3><p>${esc(po.body[0])}</p></div>
</div>`,
  );
}

function pricingStatus() {
  return band(
    { tone: "paper", cls: "status-band", label: "status-h" },
    `<div class="split">
  <div class="s-copy" data-reveal><p class="kicker">Status</p><h2 id="status-h">What works today</h2><p class="sec-lede mt-s">Everything here can be set up and previewed now. Money moves once payments are on.</p></div>
  <div class="s-media" data-reveal>${statusPanel({ id: "status", title: "Live today / Not on yet" })}</div>
</div>`,
  );
}

function pricingFaq() {
  const p = page("/pricing");
  const f = (q) => p.faqs.find((x) => x.q === q);
  const faqs = [
    { id: "join", q: "What does it cost to join?", a: f("Does it cost anything to join?").a.replace(/^No\. /, "Nothing. ") },
    { id: "price", q: "Who sets the price?", a: f("Who sets the subscription price?").a },
    { id: "pay", ...f("What will I pay?") },
    { id: "mixed", q: "How does commission work with different prices?", a: f("How is commission counted when I have different prices?").a },
    { id: "data", q: "Who owns my subscribers’ data, and what if I leave?", a: "Subscribers choose what their coaching data is used for and can export or delete it. Your teaching stays private to your workspace. What you can take with you if you leave is being confirmed." },
    { id: "today", q: "Can subscribers pay me today?", a: "Not yet. Subscriber payments are not on yet, and publishing your page waits for them. Today you can join, set up your page and app, and teach and test your AI." },
  ];
  return band(
    { tone: "white", cls: "faq-band", label: "pfaq-h" },
    `<div class="split faq-split">
  <div class="s-copy" data-reveal>
    <h2 id="pfaq-h">Pricing questions</h2>
    <p class="mt-s">${textLink("/faq", "All questions")}</p>
    <p class="mt-s">${pendingTag("Portability wording: owner to confirm")}</p>
    <div class="kamran-inline-m">${kamranPill()}</div>
  </div>
  <div class="s-media" data-reveal>${faqList(faqs, { prefix: "pfaq" })}</div>
</div>`,
  );
}

function pricing() {
  return {
    main: [pricingHero(), pricingGlance(), pricingShare(), pricingExample(), pricingCalc(), pricingHours(), pricingDetails(), pricingStatus(), pricingFaq()].join("\n"),
    js: ["calc.js"],
    closing: { secondary: { label: "Estimate my earnings", path: "/earnings-calculator" } },
  };
}

export const pages = { "/": home, "/pricing": pricing };
