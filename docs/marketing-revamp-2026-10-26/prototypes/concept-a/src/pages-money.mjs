// Page group "money": /earnings-calculator and /follower-calculator (blueprint C16, C17).
// Concept A treatment: a console-styled result window that stays beside the inputs,
// the scenarios (follower) and commission bands (earnings) as lanes, the result carried
// into sign-up. Maths: assets/calc.js (exact port); first paint is computed here with
// the same module, so the HTML already holds the real default figures (no count-up).
import { createRequire } from "node:module";
import { content } from "./registry.mjs";
import {
  esc, icon, cta, ctaMicro, button, textLink, band, sectionHead, chip, flagChip, notOnYet, sourceBadge,
  estimateLabel, sampleLabel, faqList, vx, windowFrame, phoneFrame, addressPreview, kamranPill, relatedLinks, sourceById,
} from "./components.mjs";

const calc = createRequire(import.meta.url)("../site/assets/calc.js");
const page = (p) => content.pages.find((x) => x.path === p);
const SCEN = ["cautious", "typical", "strong"];
const SCEN_LABEL = { cautious: "Cautious", typical: "Typical", strong: "Best case" };

/* ============================================================ shared bits */

/** A labelled number input. affix: "AED" (start) · end: "%" | "months" (end). */
function numField({ id, label, value, min = 0, max, step = 1, affix = "", end = "", hint = "", side = "", mode = "numeric", cls = "", k = "", fb = null, name = "" }) {
  const wrap = affix ? "input-affix" : end ? "input-affix affix-r" : "";
  const data = k ? ` data-k="${k}"${fb !== null ? ` data-fb="${fb}"` : ""}` : "";
  const input = `<input class="input mc-in" id="${id}" name="${name || id}"${data} type="number" inputmode="${mode}" min="${min}"${max !== undefined ? ` max="${max}"` : ""} step="${step}" value="${value ?? ""}"${hint ? ` aria-describedby="${id}-h"` : ""}>`;
  return `<div class="field mc-field${cls ? " " + cls : ""}">
  <div class="mc-lab"><label for="${id}">${label}</label>${side}</div>
  ${wrap ? `<div class="${wrap}">${affix ? `<span class="affix">${affix}</span>` : ""}${input}${end ? `<span class="affix">${end}</span>` : ""}</div>` : input}
  ${hint ? `<p class="hint" id="${id}-h">${hint}</p>` : ""}
</div>`;
}

/** A numbered group of inputs (console language: mono step number + ink rule). */
function group(id, n, title, inner, extra = "") {
  return `<fieldset class="mc-group" id="${id}">
  <legend class="mc-legend"><span class="mono mc-n">${n}</span><span>${esc(title)}</span>${extra}</legend>
  <div class="mc-fields">${inner}</div>
</fieldset>`;
}

/** The result + CTA column; sticky beside the inputs on desktop. */
const side = (inner) => `<div class="mc-side" id="result" tabindex="-1"><div class="mc-side-in">${inner}</div></div>`;

/** The carried-price line: proposed copy, shown as pending until owner decision 8. */
const carryLine = (price) =>
  `<p class="mc-carry" data-show="registration:open"><span class="mc-carry-tag">Decision 8</span><span>Your price, AED ${vx(String(price), 0, { cls: "mc-carry-v" })}, carries into setup</span></p>`;

/** Method badge for the earnings arithmetic (it has no market source; it links its method). */
const methodBadge = (hash, label = "Method") =>
  `<a class="source-badge" href="methodology.html#${hash}" data-track="source_open" data-source="${hash}">${esc(label)}${icon("arrow")}</a>`;

/** The phone "peek": the live headline, pinned under the header while the inputs scroll (≤1000 px). */
const peek = (label, value, sub, pre = "") =>
  `<a class="mc-peek" href="#result"><span class="mc-peek-k">${esc(label)}</span><span class="mc-peek-v">${pre ? `<small>${esc(pre)}</small> ` : ""}<span class="mono">${value}</span></span><span class="mc-peek-s">${esc(sub)}</span>${icon("chevron", "mc-peek-ic")}</a>`;

/* ===================================================== EARNINGS CALCULATOR */

const ED = calc.EARNINGS_DEFAULTS;
const bandName = (b) => (b.to === null ? `${calc.whole(b.from)}+` : `${calc.whole(b.from)}–${calc.whole(b.to)}`);
const BAND_SIZE = [100, 200, 700, 500]; // lane fill scale; the open band uses the pricing meter's 500
const fillOf = (b, i) => Math.min(1, b.subscribers / BAND_SIZE[i]);

function earnHero() {
  const e = calc.estimateEarnings(ED);
  const sess = e.equivalentSessions ?? 0;
  const cells = Array.from({ length: 60 }, (_, i) => `<i${i < sess ? ' class="on"' : ""}></i>`).join("");
  const bandRows = e.bands
    .map(
      (b, i) => `<div class="mc-band${b.subscribers ? " is-used" : ""}" data-band="${i}">
      <span class="mc-band-k"><span>${bandName(b)}</span><span class="mono">${b.ratePct}%</span></span>
      <span class="mc-band-bar" aria-hidden="true"><span style="--v:${fillOf(b, i).toFixed(4)}"></span></span>
      <span class="mc-band-n mono">${vx(calc.whole(b.subscribers), 5, { cls: "vx-end" })}</span>
      <span class="mc-band-v mono">${vx("− " + calc.aed(b.commissionMinor), 12, { cls: "vx-end" })}</span>
    </div>`,
    )
    .join("");
  const form = `<form class="mc-form" novalidate aria-label="Your offer">
  ${peek("Before other costs", vx(calc.aed(e.beforeOtherCostsMinor), 11, { cls: "o-net" }), "a month")}
  ${group(
    "me-g1",
    "01",
    "Subscribers and price",
    `<div class="field mc-field mc-wide">
      <div class="mc-lab"><label for="me-subs">Paying subscribers</label></div>
      <div class="mc-subs"><input class="input mc-in mono-in" id="me-subs" name="subs" data-k="subscribers" type="number" inputmode="numeric" min="0" max="100000" step="1" value="${ED.subscribers}" aria-describedby="me-subs-h">
      <div class="mc-range"><input type="range" id="me-subs-r" min="0" max="1500" step="1" value="${ED.subscribers}" aria-label="Paying subscribers, slider" aria-valuetext="${ED.subscribers} paying subscribers">
        <div class="mc-ticks mono" aria-hidden="true"><span style="--at:${100 / 1500}">100</span><span style="--at:${300 / 1500}">300</span><span style="--at:${1000 / 1500}">1,000</span><span style="--at:1">1,500</span></div></div></div>
      <p class="hint" id="me-subs-h">Don’t know your subscriber count? <a class="inline-link" href="follower-calculator.html" data-cta="link" data-loc="inline">Estimate it from followers</a></p>
    </div>
    <div class="field mc-field mc-wide" role="radiogroup" aria-labelledby="me-bill-l">
      <div class="mc-lab"><span class="label" id="me-bill-l">Billing</span></div>
      <div class="mc-seg"><label><input type="radio" name="billing" value="monthly" checked><span>Monthly</span></label><label><input type="radio" name="billing" value="upfront"><span>Upfront programme</span></label></div>
    </div>
    ${numField({ id: "me-price", name: "price", k: "workoutPriceAed", label: '<span class="u-m">Workout price per month</span><span class="u-u">Workout programme price</span>', value: ED.workoutPriceAed, max: 10000, affix: "AED" })}
    <div class="mc-more" data-upfront-only><div>${numField({ id: "me-months", name: "months", k: "programmeMonths", label: "Programme length", value: ED.programmeMonths, min: 1, max: 24, end: "months" })}</div></div>`,
  )}
  ${group(
    "me-g2",
    "02",
    "Nutrition and voice",
    `${numField({ id: "me-nshare", name: "nshare", k: "nutritionSharePct", label: "Subscribers on workout + nutrition", value: ED.nutritionSharePct, max: 100, end: "%", side: chip("Optional tier", "live") })}
    ${numField({ id: "me-nprice", name: "nprice", k: "nutritionPriceAed", label: '<span class="u-m">Workout + nutrition price per month</span><span class="u-u">Workout + nutrition programme price</span>', value: ED.nutritionPriceAed, max: 10000, affix: "AED" })}
    ${numField({ id: "me-vshare", name: "vshare", k: "voiceSharePct", label: "Subscribers adding your voice coach", value: ED.voiceSharePct, max: 100, end: "%", side: flagChip("voice", "Live") })}
    ${numField({ id: "me-vprice", name: "vprice", k: "voicePriceAed", label: "Voice add-on per month", value: ED.voicePriceAed, max: 10000, affix: "AED" })}`,
  )}
  ${group(
    "me-g3",
    "03",
    "Sessions and your rate",
    `${numField({ id: "me-sess", name: "sessions", k: "sessionsPerMonth", label: "Paid one-to-one sessions each month", value: ED.sessionsPerMonth, max: 1000, side: notOnYet("payments", "paid bookings") })}
    ${numField({ id: "me-sprice", name: "sprice", k: "sessionPriceAed", label: "Price per session", value: ED.sessionPriceAed, max: 10000, affix: "AED" })}
    ${numField({ id: "me-rate", name: "rate", k: "yourSessionRateAed", label: "Your usual in-person rate per session", value: ED.yourSessionRateAed, max: 10000, affix: "AED", cls: "mc-wide", hint: "Used only to compare: how many sessions the result equals." })}`,
  )}
</form>`;
  const result = windowFrame(
    `<p class="mc-eyebrow mono">Illustrative arithmetic</p>
    <div class="calc-head">${notOnYet("payments", "subscriber payments")}${estimateLabel()}</div>
    <p class="calc-figure-line"><span class="calc-figure mc-fig">${vx(calc.aed(e.beforeOtherCostsMinor), 10, { cls: "o-net" })}</span></p>
    <p class="calc-sub">a month before other costs and tax</p>
    <div class="mc-hours"><p>About <strong class="mono">${vx(calc.whole(sess), 0, { cls: "o-sess" })}</strong> one-to-one sessions at your usual <span class="mono">${vx("AED " + ED.yourSessionRateAed, 0, { cls: "o-rate" })}</span></p><span class="mc-cells" aria-hidden="true">${cells}<b class="mc-cells-more"${sess > 60 ? "" : " hidden"}>+${Math.max(0, sess - 60)}</b></span></div>
    <dl class="mc-stmt">
      <div class="mc-row"><dt>Subscriptions<span class="u-u"> (monthly equivalent)</span> <span class="mc-dim">· ${vx(calc.whole(ED.subscribers), 0, { cls: "o-n" })} × ${vx(calc.aed(e.averageMonthlyMinor), 0, { cls: "o-avg" })} average</span></dt><dd class="mono">${vx(calc.aed(e.subscriptionMonthlyMinor), 12, { cls: "vx-end o-subs" })}</dd></div>
      <div class="mc-row mc-row-k"><dt>Our share <span class="mc-dim">(<span class="mono">${vx(calc.pct(e.effectiveCommissionPct, 2), 0, { cls: "o-pct" })}</span> overall, by band)</span></dt><dd class="mono">${vx("− " + calc.aed(e.commissionMinor), 12, { cls: "vx-end o-comm" })}</dd></div>
      <div class="mc-bands" role="group" aria-label="Our share by band">${bandRows}</div>
      <div class="mc-row"><dt>One-to-one sessions</dt><dd class="mono">${vx(calc.aed(e.sessionsMonthlyMinor), 12, { cls: "vx-end o-sessamt" })}</dd></div>
      <div class="mc-row mc-total"><dt>Before other costs</dt><dd class="mono">${vx(calc.aed(e.beforeOtherCostsMinor), 12, { cls: "vx-end o-net" })}</dd></div>
    </dl>
    <div class="calc-foot">${methodBadge("earnings-calculator")}<span class="note">Not an earnings promise. Excludes payment processing, your own domain, refunds, disputes, any booking fee and tax.</span></div>
    <p class="sr-only" aria-live="polite" data-live></p>`,
    { title: "Earnings estimate", meta: "AED · monthly", cls: "calc-window mc-window" },
  );
  const act = `<div class="mc-act">
    <div class="cta-row">${cta({ location: "inline" })}<button type="button" class="btn btn-secondary" data-share>${icon("external")}<span>Send this to myself</span></button></div>
    <div class="u-m">${carryLine(ED.workoutPriceAed)}</div>
    ${ctaMicro({ short: true })}
    <p class="mc-share-out" data-share-out aria-live="polite"></p>
  </div>`;
  return `<section class="band band-white hero mc-hero" data-hero aria-labelledby="hero-h">
  <div class="wrap mc-grid" data-earn-calc>
    <div class="mc-copy">
      <p class="kicker">Earnings calculator</p>
      <h1 id="hero-h">What could your coaching earn each month?</h1>
      <p class="lede">Enter your subscribers, price and options. We apply commission by band and show what’s left. Arithmetic on your numbers, not a promise.</p>
    </div>
    ${form}
    ${side(result + act)}
  </div>
</section>`;
}

function earnBridge() {
  const steps = [
    ["followers", "Your followers"],
    ["visits", "See your link"],
    ["subs", "Subscribe"],
  ];
  return band(
    { tone: "paper", cls: "band-tight mc-bridge-band", label: "bridge-h" },
    `<div class="mc-bridge" data-reveal>
  <div class="mc-bridge-copy">
    <h2 id="bridge-h">Don’t know your subscriber count?</h2>
    <p class="sec-lede mt-s">Estimate it from your followers, price and how often you share your link.</p>
  </div>
  <ol class="mc-pipe" aria-label="What the follower calculator estimates">${steps
    .map(([k, l], i) => `<li class="mc-pipe-${k}"><span class="mono">${String(i + 1).padStart(2, "0")}</span>${esc(l)}</li>`)
    .join(`<li class="mc-pipe-arrow" aria-hidden="true">${icon("arrow")}</li>`)}</ol>
  <div class="mc-bridge-go">${button("/follower-calculator", "Estimate it from followers", { location: "inline" })}</div>
</div>`,
  );
}

function earnAssumptions() {
  const s = page("/earnings-calculator").sections.find((x) => x.id === "assumptions");
  const keys = ["bands", "upfront", "tier mix", "voice", "sessions"];
  const rows = s.bullets.slice(0, 5).map((b, i) => `<li class="ri"><code class="mono mc-led-k">${keys[i]}</code><span>${esc(b)}</span></li>`);
  const excluded = ["Payment processing", "Your own domain", "Refunds", "Disputes", "Tax"];
  rows.push(`<li class="ri mc-led-x"><code class="mono mc-led-k">excluded</code><span><span class="mc-led-lead">Not included:</span> <span class="mc-led-chips">${excluded.map((x) => chip(x, "neutral")).join("")}</span></span></li>`);
  return band(
    { tone: "white", id: "assumptions", cls: "mc-assume-band", label: "assume-h" },
    `<div class="split">
  <div class="s-copy" data-reveal>
    <p class="kicker">Assumptions</p>
    <h2 id="assume-h">What the arithmetic assumes</h2>
    <p class="sec-lede mt-s">Six lines, nothing hidden. The result is what remains before the costs we leave out.</p>
    <p class="mt-s">${textLink("/methodology#earnings-calculator", "Read the method")}</p>
  </div>
  <div class="s-media"><ul class="mc-ledger" data-reveal="stagger">${rows.join("")}</ul></div>
</div>`,
  );
}

function earnHowTo() {
  const steps = [
    { t: "Start cautiously", b: "Enter subscribers you could reach in your first months, not your whole following.", to: "#me-g1", l: "Subscribers" },
    { t: "Enter your offer", b: "Your monthly or upfront price, and the share you expect on nutrition and voice.", to: "#me-g2", l: "Your offer" },
    { t: "Add sessions", b: "Paid one-to-one sessions you would still sell alongside the subscription.", to: "#me-g3", l: "Sessions" },
    { t: "Read the result", b: "Subscriptions minus our share by band, plus sessions: what’s left before other costs.", to: "#result", l: "The result" },
  ];
  return band(
    { tone: "paper", cls: "mc-how-band", label: "how-h" },
    `${sectionHead({ kicker: "How to use it", title: "Four inputs, one honest number", id: "how-h", layout: "split", lede: "Start small. A believable number is more useful than a big one." })}
<ol class="mc-how" data-reveal="stagger">${steps
      .map(
        (s, i) => `<li class="ri"><span class="mono mc-how-n">${String(i + 1).padStart(2, "0")}</span><h3>${esc(s.t)}</h3><p>${esc(s.b)}</p><a class="mc-jump" href="${s.to}" data-jump><span>Go to ${esc(s.l.toLowerCase())}</span>${icon("arrow")}</a></li>`,
      )
      .join("")}</ol>`,
  );
}

function earnExample() {
  const e = calc.compactEarnings(120, 199, 250);
  const [b1, b2] = e.bands;
  const keep = e.beforeOtherCostsMinor;
  const total = e.subscriptionMonthlyMinor;
  const w = (m) => ((m / total) * 100).toFixed(3);
  const sec = page("/earnings-calculator").sections.find((x) => x.id === "example");
  return band(
    { tone: "white", id: "example", cls: "mc-example-band", label: "ex-h" },
    `<div class="split">
  <div class="s-copy" data-reveal>
    <p class="kicker">A worked example</p>
    <h2 id="ex-h">120 subscribers at AED 199</h2>
    <p class="sec-lede mt-s">Our share is 25% on the first 100 and 20% on the next 20: ${calc.aed(e.commissionMinor)}, ${calc.pct(e.effectiveCommissionPct, 2)} overall. You keep ${calc.aed(keep)} before processing and tax.</p>
    <p class="note mt-s">${esc(sec.note)}</p>
    <div class="cta-row mt-m"><button type="button" class="btn btn-secondary" data-load-example>${icon("replay")}<span>Load this example</span></button></div>
  </div>
  <div class="s-media" data-reveal>
    <figure class="mc-wf card" aria-labelledby="wf-cap">
      <div class="mc-wf-head">${chip("Sample", "sample")}${notOnYet("payments", "subscriber payments")}</div>
      <p class="mc-wf-total"><span class="mono">${calc.aed(total)}</span> in subscriptions <span class="mc-dim">· 120 × AED 199</span></p>
      <div class="mc-wf-bar" aria-hidden="true">
        <span class="mc-wf-seg is-share" style="--w:${w(b1.commissionMinor)};--i:0"></span>
        <span class="mc-wf-seg is-share is-share2" style="--w:${w(b2.commissionMinor)};--i:1"></span>
        <span class="mc-wf-seg is-keep" style="--w:${w(keep)};--i:2"><span class="mono">You keep ${calc.aed(keep)}</span></span>
      </div>
      <dl class="mc-wf-lines">
        <div><dt><i class="sw sw-share" aria-hidden="true"></i>Our share · subscribers 1–100 at 25%</dt><dd class="mono">− ${calc.aed(b1.commissionMinor)}</dd></div>
        <div><dt><i class="sw sw-share2" aria-hidden="true"></i>Our share · subscribers 101–120 at 20%</dt><dd class="mono">− ${calc.aed(b2.commissionMinor)}</dd></div>
        <div class="mc-wf-keep"><dt><i class="sw sw-keep" aria-hidden="true"></i>You keep, before processing and tax</dt><dd class="mono">${calc.aed(keep)}</dd></div>
      </dl>
      <figcaption id="wf-cap" class="mc-wf-cap mono">≈ ${calc.whole(e.equivalentSessions)} sessions at AED 250 · arithmetic, not a forecast</figcaption>
    </figure>
  </div>
</div>`,
  );
}

function faqBand({ title, id, faqs, prefix, related, tone = "paper", lead = "" }) {
  return band(
    { tone, cls: "faq-band", label: id },
    `<div class="split faq-split">
  <div class="s-copy" data-reveal>
    <h2 id="${id}">${esc(title)}</h2>
    ${lead}
    <p class="mt-s">${textLink("/faq", "All questions")}</p>
    <div class="kamran-inline-m">${kamranPill()}</div>
    <div class="mt-m">${relatedLinks(related)}</div>
  </div>
  <div class="s-media" data-reveal>${faqList(faqs, { prefix })}</div>
</div>`,
  );
}

function earnings() {
  const p = page("/earnings-calculator");
  return {
    main: [
      earnHero(),
      earnBridge(),
      earnAssumptions(),
      earnHowTo(),
      earnExample(),
      faqBand({ title: "Earnings questions", id: "efaq-h", faqs: p.faqs.map((f, i) => ({ ...f, id: ["falls", "earn", "sessions"][i] })), prefix: "efaq", related: p.related }),
    ].join("\n"),
    js: ["calc.js"],
    closing: { secondary: { label: "Estimate from followers", path: "/follower-calculator" } },
  };
}

/* ===================================================== FOLLOWER CALCULATOR */

const FD = calc.FOLLOWER_DEFAULTS;
const countLabel = (n) => (calc.displayCount(n) === null ? "< 1" : calc.whole(calc.displayCount(n)));
const gainLabel = (n) => (n < 0.05 ? "about the same" : n < 10 ? `+${n.toFixed(1)}` : `+${calc.whole(Math.round(n))}`);

/** Port of followerLevers (packages/domain/src/marketing-calculators.ts): one change at a time, strong case. */
function levers(input) {
  const base = calc.estimateFollowers(input), i = base.inputs, now = base.scenarios.strong;
  const cap = (n) => Math.min(60, n);
  const changes = {
    bioLink: { profileVisitsPerMonth: (i.profileVisitsPerMonth ?? 0) + 1000 },
    keywordReels: i.keywordDms && i.ctaReelsPerMonth > 0 ? { ctaReelsPerMonth: cap(i.ctaReelsPerMonth + 4) } : { keywordDms: true, ctaReelsPerMonth: Math.max(i.ctaReelsPerMonth, 4) },
    moreStories: { linkStoriesPerMonth: cap(i.linkStoriesPerMonth + 4) },
  };
  const out = {};
  for (const [id, change] of Object.entries(changes)) {
    const next = calc.estimateFollowers({ ...i, ...change }).scenarios.strong;
    out[id] = { month1New: next.month1New - now.month1New, activeMonth12: next.activeMonth12 - now.activeMonth12, revenueMonth12Minor: next.revenueMonth12Minor - now.revenueMonth12Minor };
  }
  return out;
}

/** Y-axis ceiling: the next 1/1.2/1.5/2/2.5/3/4/5/6/8/10 step. */
function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
/** Chart geometry for the three activeByMonth series (viewBox 600 × 220, months 1-12). */
function chartGeom(est) {
  const max = niceMax(Math.max(...SCEN.map((s) => est.scenarios[s].activeMonth12), ...SCEN.map((s) => Math.max(...est.scenarios[s].activeByMonth))));
  const pts = {};
  const ends = {};
  for (const s of SCEN) {
    const a = est.scenarios[s].activeByMonth;
    pts[s] = a.map((v, m) => `${((m / 11) * 600).toFixed(1)},${(220 - (v / max) * 220).toFixed(1)}`).join(" ");
    ends[s] = (1 - a[11] / max) * 100;
  }
  // Direct labels never collide: keep 11% between them, top-down.
  const order = [...SCEN].sort((a, b) => ends[a] - ends[b]);
  const lab = {};
  let last = -100;
  for (const s of order) { lab[s] = Math.max(ends[s], last + 11); last = lab[s]; }
  const over = last - 100;
  if (over > 0) for (const s of order) lab[s] -= over;
  return { max, pts, ends, lab };
}

function followerResult(est) {
  const S = est.scenarios;
  const strong = S.strong;
  const used = est.inputs;
  const weekly = used.linkStoriesPerMonth >= 4 || (used.keywordDms && used.ctaReelsPerMonth >= 4);
  const growing = strong.activeByMonth[11] > strong.activeByMonth[10] + 1e-9;
  const max = Math.max(1, ...SCEN.map((s) => S[s].revenueMonth12Minor));
  const rows = [
    ["m1", "New in your first month", (s) => countLabel(S[s].month1New)],
    ["a12", "Active after 12 months", (s) => countLabel(S[s].activeMonth12)],
    ["su", "Sign-ups over 12 months", (s) => countLabel(S[s].signups12)],
    ["aed", "A month at month 12", (s) => calc.aed(S[s].revenueMonth12Minor)],
  ];
  const head = `<div class="mc-sc-row mc-sc-head" role="row"><span role="columnheader" class="mc-sc-corner"><span class="sr-only">Measure</span></span>${SCEN.map(
    (s) => `<span role="columnheader" class="mc-sc-h${s === "strong" ? " is-best" : ""}">${SCEN_LABEL[s]}</span>`,
  ).join("")}</div>`;
  const body = rows
    .map(
      ([k, label, val]) => `<div class="mc-sc-row" role="row" data-row="${k}"><span role="rowheader" class="mc-sc-k">${label}</span>${SCEN.map(
        (s) => `<span role="cell" class="mc-sc-v mono${s === "strong" ? " is-best" : ""}" data-s="${s}">${vx(val(s), k === "aed" ? 10 : 5, { cls: "vx-end" })}${
          k === "aed" ? `<span class="mc-sc-bar" aria-hidden="true"><span style="--v:${(S[s].revenueMonth12Minor / max).toFixed(4)}"></span></span>` : ""
        }</span>`,
      ).join("")}</div>`,
    )
    .join("");
  return windowFrame(
    `<div class="calc-head">${chip("Best case", "neutral")}${notOnYet("payments", "subscriber payments")}${estimateLabel()}</div>
    <p class="calc-figure-line"><span class="calc-upto">Up to</span> <span class="calc-figure mc-fig">${vx(calc.aed(strong.revenueMonth12Minor), 10, { cls: "o-strong" })}</span></p>
    <p class="calc-sub">a month at your price, before platform commission</p>
    <p class="mc-context"><span class="mc-context-dot" aria-hidden="true"></span><span>${vx(`Best case: an engaged, growing audience${weekly ? " and weekly sharing" : ""}${growing ? ", still growing at month 12" : ""}.`, 0, { cls: "o-ctx" })}</span></p>
    <div class="mc-sc" role="table" aria-label="Three scenarios at your numbers">${head}${body}</div>
    <div class="calc-foot">${sourceBadge("revenuecat-state-2026", { label: "Sources" })}<span class="note">Active subscribers after 12 months × your price, after ${vx(calc.pct(used.yearlyCancelPct), 0, { cls: "o-cancel" })} yearly cancellations. You may get fewer than the cautious figure.</span></div>
    <p class="sr-only" aria-live="polite" data-live></p>`,
    { title: "Follower estimate", meta: `12 months · v${est.assumptionsVersion}`, cls: "calc-window mc-window" },
  );
}

function followHero() {
  const est = calc.estimateFollowers(FD);
  const form = `<form class="mc-form" novalidate aria-label="Your numbers">
  ${peek("Best case", vx(calc.aed(est.scenarios.strong.revenueMonth12Minor), 10, { cls: "o-strong" }), "a month at month 12", "Up to")}
  ${group(
    "mf-g1",
    "01",
    "Your audience",
    `${numField({ id: "mf-followers", k: "followers", fb: 0, label: "Instagram followers", value: FD.followers, max: 10000000 })}
    ${numField({ id: "mf-price", k: "priceAed", fb: 1, label: "Your monthly price", value: FD.priceAed, min: 1, max: 10000, affix: "AED" })}`,
  )}
  ${group(
    "mf-g2",
    "02",
    "How you share your link",
    `${numField({ id: "mf-stories", k: "linkStoriesPerMonth", fb: 0, label: "Stories with your link each month", value: FD.linkStoriesPerMonth, max: 60, hint: "Two a week is 8 a month." })}
    ${numField({ id: "mf-reels", k: "ctaReelsPerMonth", fb: 0, label: "Reels or posts with a call to action each month", value: FD.ctaReelsPerMonth, max: 60 })}
    <div class="field mc-field mc-wide mc-check"><label for="mf-kw"><input type="checkbox" id="mf-kw" name="kw" checked aria-describedby="mf-kw-h"><span class="mc-box" aria-hidden="true">${icon("check")}</span><span>A comment keyword sends your link by DM</span></label><p class="hint" id="mf-kw-h">Without it, those posts count only through visits to your bio link.</p></div>`,
  )}
  ${group(
    "mf-g3",
    "03",
    "Cancellations",
    `${numField({ id: "mf-cancel", k: "yearlyCancelPct", fb: FD.yearlyCancelPct, label: "Members who cancel per year", value: FD.yearlyCancelPct, min: 5, max: 80, end: "%", hint: "5 to 80. We assume 30% unless you know yours.", cls: "mc-wide" })}`,
  )}
  <div class="mc-opt">
    <button type="button" class="mc-opt-btn" aria-expanded="false" aria-controls="mf-opt" data-opt><span><span class="mono mc-n">04</span>Your own numbers <span class="mc-dim">(optional)</span></span><span class="faq-ic" aria-hidden="true"></span></button>
    <div class="mc-more" id="mf-opt" role="region" aria-label="Your own numbers"><div><div class="mc-fields">
      ${numField({ id: "mf-visits", k: "profileVisitsPerMonth", label: "Profile visits each month", value: "", max: 10000000, hint: "From Instagram Insights. Your bio link is counted only when you enter this." })}
      ${numField({ id: "mf-views", k: "storyViews", label: "Average Story views", value: "", max: 10000000, hint: "From Instagram Insights. Replaces our guess of how many people see your Stories." })}
      ${numField({ id: "mf-members", k: "broadcastMembers", label: "Broadcast channel members", value: "", max: 10000000 })}
      ${numField({ id: "mf-links", k: "broadcastLinksPerMonth", fb: 0, label: "Link messages in your channel each month", value: FD.broadcastLinksPerMonth, max: 60 })}
      ${numField({ id: "mf-eng", k: "engagementRatePct", label: "Engagement rate", value: "", max: 100, step: 0.01, end: "%", mode: "decimal", hint: "Average likes and comments per post, divided by followers. Leave blank if unsure.", cls: "mc-wide" })}
    </div></div></div>
  </div>
</form>`;
  const act = `<div class="mc-act">
    <div class="cta-row">${cta({ location: "inline" })}${button("/methodology#follower-calculator", "How we calculate this", { location: "inline" })}</div>
    ${carryLine(FD.priceAed)}
    ${ctaMicro({ short: true })}
  </div>`;
  return `<section class="band band-white hero mc-hero" data-hero aria-labelledby="hero-h">
  <div class="wrap mc-grid" data-follow-calc>
    <div class="mc-copy">
      <p class="kicker">Follower calculator</p>
      <h1 id="hero-h">How many followers could become subscribers?</h1>
      <p class="lede">Enter your followers, your price and how you share your link. See a best case, with cautious and typical beside it.</p>
    </div>
    ${form}
    ${side(followerResult(est) + act)}
  </div>
</section>`;
}

function followAddress() {
  const story = `<div class="mc-story">
    <div class="mc-story-bars" aria-hidden="true">${Array.from({ length: 6 }, (_, i) => `<i${i < 3 ? ' class="on"' : ""}></i>`).join("")}</div>
    <div class="mc-story-who"><span class="app-avatar" aria-hidden="true">LS</span><span>Layla Strength</span>${chip("Sample", "sample")}</div>
    <div class="mc-story-card" aria-hidden="true"><p class="mc-story-card-h"><span>Mon · Lower body</span><span class="mono">45 min</span></p><p><span>Back squat</span><span class="mono">4 × 6 · 62.5 kg</span></p><p><span>Leg press</span><span class="mono">3 × 10 · 120 kg</span></p><p><span>Lunge</span><span class="mono">3 × 10 · 16 kg</span></p></div>
    <p class="mc-story-text">Monday’s plan is waiting in your app.</p>
    <p class="mc-story-sub">Your coaching, every day</p>
    <span class="mc-sticker" data-sticker><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M6.5 9.5l3-3M7 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1M9 11.5l-1 1A2.5 2.5 0 0 1 4.5 9l1-1"/></svg><span class="mono">${vx("your-name", 0, { cls: "o-slug" })}.trainsyou.com</span></span>
  </div>`;
  return band(
    { tone: "paper", id: "claim", cls: "mc-claim-band", label: "claim-h" },
    `<div class="split mc-claim">
  <div class="s-copy" data-reveal>
    <p class="kicker">Your link</p>
    <h2 id="claim-h">Claim the link you’ll share</h2>
    <p class="sec-lede mt-s">Every link Story, keyword reply and bio link points to your page. Type your coaching name to see it.</p>
    <div class="card mt-m">${addressPreview({ id: "mf-addr" })}</div>
    <p class="note mt-s">Your page goes live when you publish. ${flagChip("publish", "Publishing is on", "Publishing: not on yet")}</p>
  </div>
  <div class="s-media mc-story-stage dots" data-reveal>
    ${phoneFrame(story, { cls: "mc-story-phone", label: "Sample link Story for Layla Strength, with a link sticker showing your coaching address." })}
    <div class="mc-story-cap">${sampleLabel("Sample Story · the sticker shows your address")}</div>
  </div>
</div>`,
  );
}

function followLevers(est) {
  const sec = page("/follower-calculator").sections.find((x) => x.id === "moves");
  const L = levers(FD);
  const live = { 0: ["bioLink", "Per 1,000 profile visits a month"], 1: ["keywordReels", "4 more keyword Reels a month"], 2: ["moreStories", "4 more link Stories a month"] };
  const src = { 1: "meta-instagram-ranking", 2: "nng-participation", 3: "socialinsider-stories", 4: "hootsuite-link-stickers" };
  const rows = sec.bullets.map((b, i) => {
    const [t, ...rest] = b.split(":");
    const desc = rest.join(":").trim();
    const lv = live[i];
    const gain = lv
      ? `<div class="mc-lever-gain" data-lever="${lv[0]}"><p class="mc-lever-what">${esc(lv[1])}</p><p class="mc-lever-line"><span class="mono mc-g">${vx(gainLabel(L[lv[0]].month1New), 0, { cls: "g-m1" })}</span> in your first month</p><p class="mc-lever-line"><span class="mono mc-g">${vx(gainLabel(L[lv[0]].activeMonth12), 0, { cls: "g-a12" })}</span> active after 12 months</p></div>`
      : "";
    return `<li class="mc-lever${lv ? " has-gain" : ""}"><span class="mono mc-lever-n">${String(i + 1).padStart(2, "0")}</span><div class="mc-lever-t"><h3>${esc(t)}</h3><p>${esc(desc.charAt(0).toUpperCase() + desc.slice(1))}${src[i] ? " " + sourceBadge(src[i]) : ""}</p></div>${gain}</li>`;
  });
  return band(
    { tone: "white", id: "levers", cls: "mc-levers-band", label: "levers-h" },
    `${sectionHead({ kicker: "Levers", title: "What moves your number", id: "levers-h", layout: "split", lede: "Seven levers you control. Three show their effect on your best case, one change at a time." })}
<div class="mc-levers-grid">
  <ol class="mc-levers" data-reveal>${rows.join("")}</ol>
  <aside class="mc-guess" data-reveal aria-labelledby="guess-h">
    <p class="kicker">Biggest guess</p>
    <h3 id="guess-h">How many people see your Stories</h3>
    <p class="mc-guess-fig mono">${vx("≈ " + calc.whole(Math.round(est.scenarios.strong.storyViewers)), 8, { cls: "o-viewers" })}</p>
    <p class="mc-guess-sub">people a month in the best case. Your own average Story views replace this guess.</p>
    <button type="button" class="btn btn-secondary mt-m" data-enter-views>Enter my Story views</button>
  </aside>
</div>`,
  );
}

function followMethod(est) {
  const sec = page("/follower-calculator").sections.find((x) => x.id === "how");
  const stepSrc = [["socialinsider-stories"], ["creatorflow-link-sticker"], ["socialinsider-engagement"], ["socialinsider-reels", "metricool-2026", "communipass-auto-dm"], ["hopp-bio-link", "mailerlite-benchmarks"], ["dynamicyield-conversion", "revenuecat-state-2026"], [], ["socialinsider-engagement"]];
  const g = chartGeom(est);
  const S = est.scenarios;
  const lines = SCEN.map((s) => `<g class="mc-line mc-line-${s}" data-line="${s}"><polyline points="${g.pts[s]}" vector-effect="non-scaling-stroke"/></g>`).join("");
  const ends = SCEN.map(
    (s) => `<span class="mc-end mc-end-${s}" data-end="${s}" style="--y:${g.ends[s].toFixed(2)}"></span><span class="mc-dl mc-dl-${s}" data-dl="${s}" style="--y:${g.lab[s].toFixed(2)}">${SCEN_LABEL[s]} <b class="mono">${vx(countLabel(S[s].activeMonth12), 0)}</b></span>`,
  ).join("");
  const grid = [1, 0.5, 0].map((f) => `<span class="mc-gl${f ? "" : " mc-gl-0"}" data-gl="${f}" style="--y:${(1 - f) * 100}"><b class="mono">${vx(calc.whole(g.max * f), 0)}</b></span>`).join("");
  const table = `<details class="mc-tbl"><summary>Show the 12 months as a table</summary><div class="table-wrap"><table class="table mc-months"><caption>Active subscribers each month, at your numbers</caption><thead><tr><th scope="col">Month</th>${SCEN.map((s) => `<th scope="col">${SCEN_LABEL[s]}</th>`).join("")}</tr></thead><tbody>${Array.from({ length: 12 }, (_, m) => `<tr><th scope="row">${m + 1}</th>${SCEN.map((s) => `<td class="mono">${countLabel(S[s].activeByMonth[m])}</td>`).join("")}</tr>`).join("")}</tbody></table></div></details>`;
  const chart = windowFrame(
    `<div class="mc-legend-row"><span class="mc-key mc-key-strong">Best case</span><span class="mc-key mc-key-typical">Typical</span><span class="mc-key mc-key-cautious">Cautious</span></div>
    <figure class="mc-chart" data-chart aria-labelledby="chart-cap">
      <div class="mc-plot" role="img" aria-label="Active subscribers rise over 12 months in every scenario; the best case reaches the highest number. Values are in the table below.">
        ${grid}
        <svg viewBox="0 0 600 220" preserveAspectRatio="none" aria-hidden="true">${lines}</svg>
        ${ends}
        <span class="mc-cross" aria-hidden="true"></span>
        <div class="mc-tip" aria-hidden="true"></div>
      </div>
      <div class="mc-x mono" aria-hidden="true"><span>Month 1</span><span>6</span><span>12</span></div>
      <figcaption id="chart-cap" class="note">Active subscribers after cancellations, at your numbers. ${estimateLabel()}</figcaption>
    </figure>
    ${table}`,
    { title: "Active subscribers · month by month", meta: "your numbers", cls: "mc-chart-window" },
  );
  const steps = sec.steps
    .map(
      (s, i) => `<li class="mc-step">
  <h3 class="mc-step-q"><button type="button" aria-expanded="false" aria-controls="mstep-${i + 1}" id="mstep-${i + 1}-b"><span class="mono mc-n">${String(i + 1).padStart(2, "0")}</span><span class="mc-step-t">${esc(s.title)}</span><span class="faq-ic" aria-hidden="true"></span></button></h3>
  <div class="mc-more" id="mstep-${i + 1}" role="region" aria-labelledby="mstep-${i + 1}-b"><div><p>${esc(s.body)}</p>${stepSrc[i].length ? `<p class="mc-step-src">${stepSrc[i].map((id) => sourceBadge(id, { label: sourceById(id).publisher })).join("")}</p>` : `<p class="mc-step-src note">Your input; 30% is an owner assumption.</p>`}</div></div>
</li>`,
    )
    .join("");
  return band(
    { tone: "paper", id: "method", cls: "mc-method-band", label: "method-h" },
    `${sectionHead({ kicker: "Method", title: "How we calculate", id: "method-h", layout: "split", lede: `Published averages and our stated assumptions, applied to your numbers. Assumptions version ${est.assumptionsVersion}.` })}
<div class="mc-method">
  <div class="mc-method-l" data-reveal>
    ${chart}
    <div class="mc-why">
      <h3>Why the headline shows the best case</h3>
      <p>It is a best case for an engaged, growing audience and weekly sharing, not a typical result and not a promise. Per link Story, 5% tap and 6.2% of them pay: about 0.31% of viewers. Each month 8% of your audience is new to your link.</p>
      <p>Over a year it signs up about 2% of followers, up to 10,000. Published creator averages sit far lower: 0.52–1.1% for higher-priced courses ${sourceBadge("passion-creator-rates")}, and about USD 273 a month for creators with 1,000–10,000 followers ${sourceBadge("stan-creator-economy")}.</p>
    </div>
  </div>
  <div class="mc-method-r" data-reveal>
    <p class="mc-method-k">The method in 8 steps</p>
    <ol class="mc-steps" data-steps>${steps}</ol>
    <p class="mt-s">${textLink("/methodology#follower-calculator", "Full methodology")}</p>
  </div>
</div>`,
  );
}

function followSources() {
  const p = page("/follower-calculator");
  const ids = [...new Set(p.sections.flatMap((s) => s.sources || []))];
  const rows = ids.map((id) => {
    const s = sourceById(id);
    return `<li class="ri"><div class="mc-src-t"><span class="mc-src-p">${esc(s.publisher)}</span><a href="${esc(s.url)}" target="_blank" rel="noopener" class="mc-src-a">${esc(s.title)}${icon("external")}<span class="sr-only"> (opens in a new tab)</span></a></div><div class="mc-src-m">${chip(s.evidence, "neutral")}<a class="mc-src-m-link" href="methodology.html#${esc(id)}">How we use it</a></div></li>`;
  });
  return band(
    { tone: "white", id: "sources", cls: "mc-sources-band", label: "src-h" },
    `${sectionHead({ kicker: "Sources", title: "The sources behind the ratios", id: "src-h", layout: "split", lede: `${ids.length} published sources, each labelled with how strong its evidence is. Our own assumptions are marked as ours in the method.` })}
<ul class="mc-src" data-reveal="stagger">${rows.join("")}</ul>`,
  );
}

function follower() {
  const p = page("/follower-calculator");
  const est = calc.estimateFollowers(FD);
  const f = (q) => p.faqs.find((x) => x.q.startsWith(q));
  // Answers kept within 45 words; the Instagram answer follows the live state (not on yet).
  const faqs = [
    { id: "prediction", q: f("Is this a prediction").q, a: "No. It applies published averages and our stated assumptions to your inputs. The headline is a best case; cautious and typical sit beside it, and you may get fewer subscribers than the cautious figure. Your content, audience, offer and price change the real number." },
    { id: "best-case", q: "Why does the headline show the best case?", a: "It shows what an engaged, growing audience with weekly sharing could reach, using the top values in the research and our stated assumptions. It is far above published creator averages, so we label it a best case and show cautious and typical beside it." },
    { id: "matters", ...f("Which of my numbers") },
    { id: "instagram", q: f("Can I use my real Instagram").q, a: "Not yet. Connecting an Instagram professional account is not on yet. For now, enter your followers, Story views and engagement from Instagram Insights." },
  ];
  return {
    title: "Instagram followers to paying clients calculator · How many become paying subscribers · trainsyou",
    main: [
      followHero(),
      followAddress(),
      followLevers(est),
      followMethod(est),
      followSources(),
      faqBand({ title: "Follower questions", id: "ffaq-h", faqs, prefix: "ffaq", related: p.related, lead: `<p class="mt-s">${flagChip("instagram", "Live", "Instagram connect: not on yet")}</p>` }),
    ].join("\n"),
    js: ["calc.js"],
    closing: { secondary: { label: "Estimate my earnings", path: "/earnings-calculator" } },
  };
}

export const pages = { "/earnings-calculator": earnings, "/follower-calculator": follower };
