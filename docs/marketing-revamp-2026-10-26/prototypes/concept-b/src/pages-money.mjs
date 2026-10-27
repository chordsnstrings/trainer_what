// Concept B · money pages: /earnings-calculator and /follower-calculator.
// Owner: the money page builder. Copy follows blueprint C16 and C17
// (pending owner approval); everything else comes from content.json.
// The maths is assets/calc.js (a line-for-line port of
// packages/domain/src/marketing-calculators.ts). First-paint figures are
// computed here with the same file, so the page never counts up on load.
import { esc, C, pageFor, sourceFor } from "./core.mjs";
import {
  icon, hl, eyebrow, sectionHead, band, primaryCta, secondaryLink, chip, statusChip, sampleLabel, estimateLabel,
  srcBadge, paymentsNote, val, faq, statusStrip, phone, offerScreen, statement, sessionMarks, rateAxis,
  addressPreview, ext, crumbs, microLine, aed,
} from "./components.mjs";

/* ===================================================================== */
/* Shared helpers (money group only)                                      */
/* ===================================================================== */
const STATUS_HREF = "pricing.html#status";
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
/** Grade-6 vocabulary (C0): "marginal bands" becomes plain words. */
const plain = (s) => String(s ?? "").replace(/the standard marginal bands of/g, "our bands of").replace(/standard marginal bands/g, "our bands").replace(/Commission is marginal: each band/g, "Each band").replace(/marginal bands/g, "bands");
const attrs = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== false).map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${esc(v)}"`)).join("");

/** Calculator hero: crumbs, eyebrow, H1 (sweep), lede and the status strip. */
function heroHead(o) {
  return `<div class="mx-hero-head">
  <div class="mx-hero-title">${o.crumbs || ""}${eyebrow(o.eyebrow)}<h1 id="h1" class="sweep">${hl(o.h1, o.word)}</h1></div>
  <div class="mx-hero-side"><p class="lede">${esc(o.lede)}</p>${statusStrip({ href: STATUS_HREF })}</div>
</div>`;
}

/**
 * A number field with an optional unit and help line.
 * { id, label | labelHtml, in, value, min, max, step, suffix, unit (sr-only), help, cls, decimal, placeholder, sync }
 */
function numField(o) {
  const help = o.help ? `<span class="field-help" id="${o.id}-h">${esc(o.help)}</span>` : "";
  const input = `<input${attrs({ id: o.id, type: "number", inputmode: o.decimal ? "decimal" : "numeric", "data-in": o.in, value: o.value ?? "", min: o.min, max: o.max, step: o.step || 1, placeholder: o.placeholder, "data-sync": o.sync, "aria-describedby": help ? `${o.id}-h` : undefined })}>`;
  return `<div class="field mx-field${o.cls ? " " + o.cls : ""}"><label for="${o.id}">${o.labelHtml || esc(o.label)}${o.unit ? `<span class="sr-only"> (${esc(o.unit)})</span>` : ""}</label><div class="affix">${input}${o.suffix ? `<span aria-hidden="true">${esc(o.suffix)}</span>` : ""}</div>${help}</div>`;
}

/** Log slider position (0..LOG_STEPS) for a value between lo and hi. */
const LOG_STEPS = 400;
const logPos = (v, lo, hi) => Math.round(((Math.log10(Math.min(hi, Math.max(lo, v))) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * LOG_STEPS);

/**
 * B's editable figure: a big number input with a slider that drives it.
 * { id, label | labelHtml, in, value, min, max, prefix, unit, sync, help,
 *   slider: { min, max, step, scale: "lin"|"log", lo, hi, ends: [a, b], valuetext } }
 */
function bigField(o) {
  const s = o.slider;
  const help = o.help ? `<p class="field-help" id="${o.id}-h">${esc(o.help)}</p>` : "";
  const input = `<input${attrs({ id: o.id, class: "fig", type: "number", inputmode: "numeric", "data-in": o.in, value: o.value, min: o.min, max: o.max, step: 1, "data-sync": o.sync, "aria-describedby": help ? `${o.id}-h` : undefined })}>`;
  let slider = "";
  if (s) {
    const log = s.scale === "log";
    const pos = log ? logPos(o.value, s.lo, s.hi) : Math.min(s.max, Math.max(s.min, o.value));
    const vt = s.valuetext || "{v}";
    const fillPct = log ? (pos / LOG_STEPS) * 100 : ((pos - s.min) / (s.max - s.min)) * 100;
    slider = `<input${attrs({ type: "range", class: "mx-slide", "data-mirror": o.id, "data-scale": log ? "log" : "lin", "data-lo": log ? s.lo : undefined, "data-hi": log ? s.hi : undefined, min: log ? 0 : s.min, max: log ? LOG_STEPS : s.max, step: log ? 1 : s.step || 1, value: pos, "aria-label": `${o.sliderLabel || o.label} (slider)`, "data-valuetext": vt, "aria-valuetext": vt.replace("{v}", C.whole(o.value)) })} style="--fill:${fillPct.toFixed(2)}%">
${s.ends ? `<div class="range-ends" aria-hidden="true"><span>${esc(s.ends[0])}</span><span>${esc(s.ends[1])}</span></div>` : ""}`;
  }
  return `<div class="mx-big">
  <div class="mx-big-top"><label for="${o.id}">${o.labelHtml || esc(o.label)}${o.unit ? `<span class="sr-only"> (${esc(o.unit)})</span>` : ""}</label>
    <div class="mx-num">${o.prefix ? `<span class="mx-num-pre" aria-hidden="true">${esc(o.prefix)}</span>` : ""}${input}</div></div>
  ${slider}${help}
</div>`;
}

/** Percentage slider whose figure is updated by money.js (data-show-of). */
function shareSlider(o) {
  return `<div class="range mx-share"><div class="range-top"><label for="${o.id}">${esc(o.label)}</label>${val(o.value + "%", { cls: "fig", w: "4ch", align: "end", attrs: `data-show-of="${o.in}"` })}</div>
<input id="${o.id}" type="range" data-in="${o.in}" min="0" max="100" step="1" value="${o.value}" data-valuetext="{v}% of subscribers" aria-valuetext="${o.value}% of subscribers" style="--fill:${o.value}%"></div>`;
}

/** An option group inside the earnings tile. */
const optGroup = (o) => `<div class="mx-opt"><div class="mx-opt-head"><h3>${esc(o.title)}</h3>${o.chips ? `<div class="chip-row">${o.chips}</div>` : ""}</div>${o.body}</div>`;

/** "Your price, AED 199, carries into setup" (decision 8 only). */
const d8Line = (price) => `<p class="mx-d8 if-d8">${icon("info")}<span>Your price, ${val(price, { out: "price" })}, carries into setup. Change it any time.</span></p>`;

/** FAQ band: the question list beside a short "keep going" column. */
function faqBand(o) {
  return band({
    id: "faq", labelledby: "faq-h", cls: "band-rule",
    inner: `<div class="mx-faq-split">
  <div class="mx-faq-head reveal">${eyebrow("Questions")}<h2 id="faq-h">${esc(o.title)}</h2></div>
  <div class="mx-faq-list reveal">${faq(o.items, { idPrefix: o.idPrefix })}</div>
  <nav class="mx-related reveal" aria-label="Related pages"><p class="eyebrow eyebrow--muted">Keep going</p><ul>${o.related.map((r) => `<li>${secondaryLink({ label: r[0], href: r[1], location: "related" })}</li>`).join("")}</ul></nav>
</div>`,
  });
}

/* ===================================================================== */
/* EARNINGS CALCULATOR  /earnings-calculator  (C16)                       */
/* ===================================================================== */
const BAND_LABELS = ["1–100", "101–300", "301–1,000", "Above 1,000"];

function earningsTile() {
  const D = C.DEFAULT_EARNINGS_INPUTS;
  const e = C.estimateEarnings(D);
  const fills = C.bandFills(D.subscribers);
  const mo = (a, b) => `<span class="if-mo">${a}</span><span class="if-up">${b}</span>`;

  const main = `<div class="mx-main">
  <div class="mx-tile-head"><h2 id="ec-h" class="eyebrow">Your offer</h2><p class="fine">Every figure is yours to change</p></div>
  ${bigField({ id: "ec-subs", label: "Paying subscribers", in: "subscribers", value: D.subscribers, min: 0, max: 100000, slider: { min: 0, max: 1500, ends: ["0", "1,500+"], valuetext: "{v} subscribers" } })}
  ${bigField({ id: "ec-price", label: "Workout price", sliderLabel: "Workout price", labelHtml: mo("Workout price a month", "Workout programme price"), unit: "AED", prefix: "AED", in: "price", value: D.workoutPriceAed, min: 0, max: 10000, sync: "price", slider: { min: 0, max: 1000, ends: ["AED 0", "AED 1,000+"], valuetext: "AED {v}" } })}
</div>`;

  const opts = `<div class="mx-opts">
  ${optGroup({
    title: "Billing",
    body: `<fieldset class="mx-seg" data-mx-seg><legend class="sr-only">Billing</legend>
      <span class="mx-seg-ind" aria-hidden="true"></span>
      <label><input type="radio" name="ec-billing" value="monthly" checked data-billing-radio><span>Monthly</span></label>
      <label><input type="radio" name="ec-billing" value="upfront" data-billing-radio><span>Upfront<span class="sr-only"> for the whole programme</span></span></label>
    </fieldset>
    <input type="hidden" data-in="billing" value="monthly">
    ${numField({ id: "ec-months", label: "Programme length", in: "months", value: D.programmeMonths, min: 1, max: 24, suffix: "months", cls: "if-up", help: "Shown as a monthly equivalent: price divided by months." })}`,
  })}
  ${optGroup({
    title: "Nutrition tier", chips: chip("Optional tier", "line"),
    body: `<div class="mx-pair">${shareSlider({ id: "ec-nshare", label: "Subscribers on workout + nutrition", in: "nutritionShare", value: D.nutritionSharePct })}
      ${numField({ id: "ec-nprice", labelHtml: mo("Workout + nutrition price a month", "Workout + nutrition programme price"), unit: "AED", in: "nutritionPrice", value: D.nutritionPriceAed, min: 0, max: 10000, suffix: "AED" })}</div>`,
  })}
  ${optGroup({
    title: "Voice coach", chips: chip("Add-on", "line") + statusChip("voice", ""),
    body: `<div class="mx-pair">${shareSlider({ id: "ec-vshare", label: "Subscribers adding your voice coach", in: "voiceShare", value: D.voiceSharePct })}
      ${numField({ id: "ec-vprice", label: "Voice add-on a month", unit: "AED", in: "voicePrice", value: D.voicePriceAed, min: 0, max: 10000, suffix: "AED" })}</div>`,
  })}
  ${optGroup({
    title: "Sessions",
    body: `<div class="mx-fields3">
      ${numField({ id: "ec-sessions", label: "Paid one-to-one sessions each month", in: "sessions", value: D.sessionsPerMonth, min: 0, max: 1000 })}
      ${numField({ id: "ec-sprice", label: "Price per session", unit: "AED", in: "sessionPrice", value: D.sessionPriceAed, min: 0, max: 10000, suffix: "AED" })}
      ${numField({ id: "ec-rate", label: "Your usual in-person rate per session", unit: "AED", in: "rate", value: D.yourSessionRateAed, min: 0, max: 10000, suffix: "AED", help: "For the sessions comparison." })}
    </div>`,
  })}
</div>`;

  const result = `<div class="mx-res" id="share" data-result data-vt="price-tile" data-vt-from="index.html">
  <h2 class="sr-only">Your result</h2>
  <div class="mx-res-head"><p class="label-estimate">Illustrative arithmetic</p><div class="chip-row">${statusChip("payments", "subscriber payments")}</div></div>
  <p class="mx-keep-l">You keep</p>
  <div class="mx-keep flash" data-mx-keep>${val(C.aed(e.beforeOtherCostsMinor), { out: "keep", cls: "fig keep" })}</div>
  <p class="mx-keep-sub">a month, before card processing, other costs and tax</p>
  <dl class="mx-rows">
    <div class="mx-row"><dt>Average per subscriber</dt><dd>${val(C.aed(e.averageMonthlyMinor), { out: "avg", cls: "fig", align: "end" })}</dd></div>
    <div class="mx-row"><dt>Subscriptions ${mo("a month", "(monthly equivalent)")}</dt><dd>${val(C.aed(e.subscriptionMonthlyMinor), { out: "revenue", cls: "fig", align: "end" })}</dd></div>
    <div class="mx-row mx-row--minus"><dt>Our share, ${val(C.pct1(e.effectiveCommissionPct), { out: "rate" })} overall</dt><dd>${val("−" + C.aed(e.commissionMinor), { out: "commission", cls: "fig", align: "end" })}</dd></div>
    <div class="mx-row"><dt>One-to-one sessions</dt><dd>${val(C.aed(e.sessionsMonthlyMinor), { out: "sessionsIncome", cls: "fig", align: "end" })}</dd></div>
  </dl>
  <p class="mx-hours"><span class="mx-hours-ic" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span>That is about <b class="fig">${val(C.whole(e.equivalentSessions), { out: "sessions" })}</b> sessions a month at your usual rate, <span data-rate-show>${C.aed(D.yourSessionRateAed * 100)}</span>.</span></p>
  ${paymentsNote()}
  <div class="cta-row mx-res-cta">${primaryCta({ location: "calculator" })}<a class="link" href="#share" data-share-calc data-cta="calculator">Send this to myself${icon("arrow")}</a></div>
  ${d8Line(C.aed(D.workoutPriceAed * 100))}
  ${microLine()}
  <p class="sr-only" aria-live="polite" data-live></p>
</div>`;

  const bands = `<div class="mx-bands reveal">
  <div class="mx-bands-head">
    <div><h3 class="eyebrow" id="ec-bands-h">Our share by band</h3><p class="fine">Reaching a new band lowers the rate for subscribers in that band only.</p></div>
    <div class="mx-axis"><p class="fine">Overall share</p>${rateAxis(e.effectiveCommissionPct)}</div>
  </div>
  <ol class="mx-band-list" aria-labelledby="ec-bands-h">${e.bands.map((b, k) => `
    <li class="mx-band">
      <div class="mx-band-top"><span class="mx-band-range">${BAND_LABELS[k]}</span><b class="fig mx-band-rate">${b.ratePct}%</b></div>
      <span class="band-track mx-band-track" style="--i:${k}" aria-hidden="true"><span class="band-fill" data-band-fill="${k}" style="--fill:${fills[k]}"></span></span>
      <dl class="mx-band-nums"><div><dt>Subscribers</dt><dd>${val(C.whole(b.subscribers), { out: `band.${k}.subs`, cls: "fig" })}</dd></div><div><dt>Our share</dt><dd>${val(C.aed(b.commissionMinor), { out: `band.${k}.commission`, cls: "fig" })}</dd></div></dl>
    </li>`).join("")}
  </ol>
</div>`;

  return `<section class="mx-tile mx-ecalc" data-calc="earnings" data-full data-calc-name="earnings_page" data-billing="monthly" aria-label="Earnings calculator">
${main}
${result}
${opts}
${bands}
</section>`;
}

function earnings(ctx) {
  const page = ctx.page;
  const sec = (id) => page.sections.find((s) => s.id === id);
  const fe = C.estimateFollowerConversion(C.DEFAULT_FOLLOWER_INPUTS).scenarios;
  const ex = C.compactEarnings(120, 199, 250);

  /* 1-2. Calculator and result panel (the hero). */
  const hero = `<section class="page-hero mx-hero" data-hero aria-labelledby="h1">
<div class="container">
  ${heroHead({
    crumbs: crumbs({ ...page, parent: "/pricing" }, pageFor),
    eyebrow: "Earnings calculator",
    h1: page.h1, word: "earn",
    lede: "Your subscribers, your price, your options. It applies our share by band and shows what you keep, and how many sessions that equals.",
  })}
  ${earningsTile()}
</div>
</section>`;

  /* 3. Don't know your subscriber count? */
  const SC = [["cautious", "Cautious"], ["typical", "Typical"], ["strong", "Best case"]];
  const bridge = band({
    id: "from-followers", tone: "paper", labelledby: "bridge-h",
    inner: `<div class="mx-bridge">
  <div class="mx-bridge-copy reveal">${eyebrow("Follower calculator")}<h2 id="bridge-h">Don't know your subscriber count?</h2>
    <p class="lede">Estimate it from your followers, then use the result in the calculator above.</p>
    ${secondaryLink({ label: "Open the follower calculator", href: "/follower-calculator", location: "inline" })}</div>
  <div class="mx-bridge-tool card card--raised reveal" data-calc="follower" data-calc-name="follower_bridge" data-mx-bridge>
    <div class="mx-bridge-top">${numField({ id: "br-followers", label: "Your Instagram followers", in: "followers", value: 7000, min: 0, max: 10000000 })}
      <input type="hidden" data-in="price" value="199"><input type="hidden" data-in="stories" value="8"></div>
    <p class="mx-bridge-q">Active subscribers after 12 months, with 8 link Stories a month:</p>
    <div class="mx-picks" role="group" aria-label="Use a scenario as your subscriber count">${SC.map(([k, l]) => {
      const n = C.displayCount(fe[k].activeMonth12) || 0;
      return `<button type="button" class="mx-pick${k === "strong" ? " mx-pick--best" : ""}" data-pick="${k}" data-n="${n}" aria-label="Use ${l.toLowerCase()}: ${C.countLabel(fe[k].activeMonth12)} subscribers"><span class="mx-pick-l">${l}</span>${val(C.countLabel(fe[k].activeMonth12), { out: `${k}.active`, cls: "fig mx-pick-n" })}<span class="mx-pick-use">Use this ${icon("arrow")}</span></button>`;
    }).join("")}</div>
    <div class="mx-bridge-foot">${estimateLabel()}<a class="link link--quiet" href="follower-calculator.html" data-cta="inline">How we estimate this${icon("arrow")}</a></div>
    <p class="sr-only" aria-live="polite" data-mx-live></p>
  </div>
</div>`,
  });

  /* 4. Assumptions: what the result leaves out. */
  const how = sec("assumptions").bullets.slice(0, 5);
  const assumptions = band({
    id: "assumptions", labelledby: "assume-h",
    inner: `<div class="split split--center mx-assume">
  <div class="reveal">${eyebrow("Assumptions")}<h2 id="assume-h">What the result leaves out</h2>
    <ul class="tick-list mx-assume-list">${how.map((b) => `<li>${icon("info")}<span>${esc(plain(b))}</span></li>`).join("")}</ul>
  </div>
  <div class="mx-receipt reveal">
    <div class="mx-receipt-head"><p class="h4">Not in this result</p><span class="fine">Your statement itemises them</span></div>
    <ul class="mx-receipt-list">
      <li><span>Card processing</span><span class="mx-owner">[rate: owner to state]</span></li>
      <li><span>Your own domain, if you choose one</span>${chip("Not counted", "plain")}</li>
      <li><span>Refunds and disputes</span>${chip("Not counted", "plain")}</li>
      <li><span>Any booking fee in your finance policy</span>${chip("Not counted", "plain")}</li>
      <li><span>Tax</span>${chip("Not counted", "plain")}</li>
    </ul>
    <p class="mx-receipt-foot">Not an earnings promise. ${secondaryLink({ label: "Assumptions in full", href: "/methodology", location: "inline" })}</p>
  </div>
</div>`,
  });

  /* 5. How to use it (four steps, bodies kept to 18 words). */
  const USE_BODY = [
    "Enter subscribers you could reach in your first months, not your whole following.",
    "Your monthly or upfront price, plus who takes the nutrition tier and the voice add-on.",
    "Paid one-to-one sessions you would still sell alongside the subscription.",
    "Subscriptions minus our share by band, plus sessions: what remains, in sessions at your rate.",
  ];
  const use = band({
    id: "use", tone: "paper", labelledby: "use-h",
    inner: `${sectionHead({ eyebrow: "Four steps", title: sec("use").heading, id: "use-h" })}
<ol class="mx-use reveal" data-stagger>${sec("use").steps.map((s, i) => `<li><span class="fig mx-use-n" aria-hidden="true">${String(i + 1).padStart(2, "0")}</span><h3>${esc(s.title)}</h3><p>${esc(USE_BODY[i])}</p></li>`).join("")}</ol>`,
  });

  /* 6. Worked example (content figures, recomputed with the real maths). */
  const b = ex.bands;
  const worked = band({
    id: "example", tone: "wash", labelledby: "example-h",
    inner: `${sectionHead({ eyebrow: "Check the maths", title: sec("example").heading, id: "example-h", row: true, after: `<div class="chip-row">${statusChip("payments", "subscriber payments")}</div>` })}
<div class="split split--even mx-worked">
  <div class="reveal">
    ${statement({
      title: "120 subscribers at AED 199", period: "A month, by band",
      rows: [
        { label: "120 × AED 199", value: C.aed(ex.subscriptionMonthlyMinor) },
        { label: "Our share: 100 × 25%", value: "−" + C.aed(b[0].commissionMinor), sub: true },
        { label: "Our share: 20 × 20%", value: "−" + C.aed(b[1].commissionMinor), sub: true },
        { label: `Our share in all, ${C.pct(ex.effectiveCommissionPct)} overall`, value: "−" + C.aed(ex.commissionMinor) },
      ],
      total: { label: "You keep, before card processing and tax", value: C.aed(ex.beforeOtherCostsMinor) },
      note: sec("example").note,
    })}
    <div class="mx-worked-cta"><button type="button" class="btn btn--secondary" data-example>Try it in the calculator${icon("arrow")}</button></div>
    ${paymentsNote()}
  </div>
  <div class="mx-hourcard reveal" data-wc-skip>
    ${eyebrow("Your hours")}
    <p class="mx-hour-big"><b class="fig fig-band">${C.whole(ex.equivalentSessions)} sessions</b><span>a month at AED 250 each, to earn the same ${C.aed(ex.beforeOtherCostsMinor)}.</span></p>
    ${sessionMarks(ex.equivalentSessions, `${ex.equivalentSessions} session marks: the one-to-one sessions at AED 250 it would take to match ${C.aed(ex.beforeOtherCostsMinor)} a month`)}
    <p class="fine mx-hour-src">Sample session price inside the published Dubai range of AED 70–350. ${srcBadge("heytrainer-dubai-2026")}</p>
  </div>
</div>`,
  });

  /* 7. FAQ (3). */
  const faqs = faqBand({
    title: "Earnings, answered", idPrefix: "eq", items: page.faqs.map((f) => ({ ...f, a: plain(f.a) })),
    related: [["Follower calculator", "/follower-calculator"], ["Pricing in detail", "/pricing"], ["Methodology", "/methodology"]],
  });

  return {
    main: [hero, bridge, assumptions, use, worked, faqs].join("\n"),
    closing: { secondary: { label: "Send this to myself", href: "#share" } },
  };
}

/* ===================================================================== */
/* FOLLOWER CALCULATOR  /follower-calculator  (C17)                       */
/* ===================================================================== */
const SCEN = [
  { k: "cautious", label: "Cautious", note: "Same viewers all year" },
  { k: "typical", label: "Typical", note: "Published averages" },
  { k: "strong", label: "Best case", note: "Engaged, growing audience" },
];
/** A lever's gain, as the current component prints it. */
const gainLabel = (n) => (n < 0.05 ? "about the same" : n < 10 ? `+${n.toFixed(1)}` : `+${C.whole(Math.round(n))}`);
const revGain = (m) => (m > 0 ? "+" + C.aed(m) : "no change");

/** 12 bars of active subscribers by month on one shared scale (aria-hidden). */
function spark(series, max) {
  return `<div class="mx-spark" aria-hidden="true">${series.map((v, m) => {
    const r = max > 0 ? v / max : 0;
    return `<b data-m="${m + 1}"><i style="--v:${(v > 0 ? Math.max(0.05, r) : 0).toFixed(4)}"></i></b>`;
  }).join("")}</div>`;
}

function followerTile() {
  const D = C.DEFAULT_FOLLOWER_INPUTS;
  const est = C.estimateFollowerConversion(D);
  const sc = est.scenarios;
  const max = Math.max(...SCEN.flatMap((s) => sc[s.k].activeByMonth));

  const inputs = `<div class="mx-fin">
  <div class="mx-tile-head"><h2 id="fc-in-h" class="eyebrow">Your numbers</h2></div>
  ${bigField({ id: "fc-followers", label: "Instagram followers", in: "followers", value: D.followers, min: 0, max: 10000000, slider: { scale: "log", lo: 100, hi: 1000000, ends: ["100", "1M"], valuetext: "{v} followers" } })}
  ${bigField({ id: "fc-price", label: "Your monthly price", unit: "AED", prefix: "AED", in: "price", value: D.priceAed, min: 1, max: 10000, sync: "price", slider: { min: 1, max: 1000, ends: ["AED 1", "AED 1,000+"], valuetext: "AED {v}" } })}
  <div class="mx-big">
    <div class="mx-big-top"><label for="fc-stories">Stories with your link each month</label></div>
    <div class="mx-step" data-mx-step>
      <button type="button" class="pricer-btn" data-step-by="-1" aria-label="One fewer link Story a month">${icon("minus")}</button>
      <input id="fc-stories" class="fig" type="number" inputmode="numeric" data-in="stories" value="${D.linkStoriesPerMonth}" min="0" max="60" step="1" aria-describedby="fc-stories-h">
      <button type="button" class="pricer-btn" data-step-by="1" aria-label="One more link Story a month">${icon("plus")}</button>
    </div>
    <p class="field-help" id="fc-stories-h">Two a week is 8 a month.</p>
  </div>
  <div class="acc mx-more">
    <button type="button" class="mx-acc-btn" data-mx-acc aria-expanded="false" aria-controls="fc-more"><span><b>More inputs</b><span class="fine">Reels, cancellations and your own numbers</span></span><span class="acc-icon">${icon("faq")}</span></button>
    <div class="acc-panel" id="fc-more" role="region" aria-label="More inputs"><div class="acc-inner"><div class="mx-more-in">
      ${numField({ id: "fc-reels", label: "Reels or posts with a call to action each month", in: "reels", value: D.ctaReelsPerMonth, min: 0, max: 60 })}
      <div class="field mx-field"><label class="check"><input type="checkbox" data-in="keywordDms" checked aria-describedby="fc-kw-h"><span>A comment keyword sends your link by DM</span></label><span class="field-help" id="fc-kw-h">Without it, those posts count only through visits to your bio link.</span></div>
      ${numField({ id: "fc-cancel", label: "Members who cancel per year", unit: "%", in: "cancel", value: D.yearlyCancelPct, min: 5, max: 80, suffix: "%", help: "5 to 80. We assume 30% unless you know yours." })}
      <p class="mx-own-h">Your own numbers <span class="muted">(optional)</span></p>
      ${numField({ id: "fc-visits", label: "Profile visits each month", in: "visits", min: 0, max: 10000000, placeholder: "Optional", help: "From Instagram Insights. Your bio link is counted only when you enter this." })}
      ${numField({ id: "fc-members", label: "Broadcast channel members", in: "members", min: 0, max: 10000000, placeholder: "Optional" })}
      ${numField({ id: "fc-links", label: "Link messages in your channel each month", in: "links", value: D.broadcastLinksPerMonth, min: 0, max: 60 })}
      ${numField({ id: "fc-views", label: "Average Story views", in: "views", min: 0, max: 10000000, placeholder: "Optional", help: "From Instagram Insights. Replaces our guess of how many people see your Stories." })}
      ${numField({ id: "fc-eng", label: "Engagement rate", unit: "%", in: "engagement", min: 0, max: 100, step: 0.01, decimal: true, suffix: "%", placeholder: "Optional", help: "Average likes and comments per post, divided by followers. Leave blank if unsure." })}
    </div></div></div>
  </div>
</div>`;

  const cols = SCEN.map((s) => {
    const r = sc[s.k];
    return `<div class="mx-scen mx-scen--${s.k}${s.k === "strong" ? " flash" : ""}" role="listitem"${s.k === "strong" ? " data-mx-best" : ""}>
  <div class="mx-scen-head"><span class="mx-scen-l">${s.label}</span><span class="mx-scen-d">${s.note}</span></div>
  <p class="mx-scen-fig">${val(C.aed(r.revenueMonth12Minor), { out: `${s.k}.revenue`, cls: "fig" })}</p>
  <p class="mx-scen-u">a month at month&nbsp;12</p>
  <div class="mx-spark-wrap" data-spark="${s.k}">${spark(r.activeByMonth, max)}<p class="mx-spark-read" aria-hidden="true" data-spark-read>Active subscribers, months 1–12</p></div>
  <dl class="mx-scen-stats">
    <div><dt>New in month 1</dt><dd>${val(C.countLabel(r.month1New), { out: `${s.k}.month1`, cls: "fig", align: "end" })}</dd></div>
    <div><dt>Active at month 12</dt><dd>${val(C.countLabel(r.activeMonth12), { out: `${s.k}.active`, cls: "fig", align: "end" })}</dd></div>
    <div><dt>Sign-ups in 12 months</dt><dd>${val(C.countLabel(r.signups12), { out: `${s.k}.signups`, cls: "fig", align: "end" })}</dd></div>
  </dl>
</div>`;
  }).join("");

  const out = `<div class="mx-fout" data-result data-mx-fout>
  <h2 class="sr-only">Your estimate</h2>
  <div class="mx-res-head">${estimateLabel()}<div class="chip-row">${statusChip("payments", "subscriber payments")}</div></div>
  <p class="mx-best-line"><span class="chip chip--ink">Best case</span><span>Up to ${val(C.aed(sc.strong.revenueMonth12Minor), { out: "strong.revenue", cls: "fig" })} a month at your price of ${val(aed(D.priceAed), { out: "price" })}, before platform commission</span></p>
  <div class="mx-scens" role="list" aria-label="Three scenarios at your numbers">${cols}</div>
  <p class="fine mx-why">A best case for an engaged, growing audience and weekly sharing, not a typical result. It is far above published creator averages, and you may get fewer subscribers than the cautious figure. ${srcBadge("stan-creator-economy")} ${srcBadge("revenuecat-state-2026")}</p>
  ${paymentsNote()}
  <div class="cta-row mx-res-cta">${primaryCta({ location: "calculator" })}${secondaryLink({ label: "How we calculate this", href: "/methodology", location: "calculator" })}</div>
  ${d8Line(aed(D.priceAed))}
  ${microLine()}
  <p class="sr-only" aria-live="polite" data-live></p>
</div>`;

  return `<section class="mx-tile mx-fcalc" data-calc="follower" data-calc-name="follower_page" aria-label="Follower calculator">
${inputs}
${out}
</section>`;
}

function follower(ctx) {
  const page = ctx.page;
  const sec = (id) => page.sections.find((s) => s.id === id);
  const D = C.DEFAULT_FOLLOWER_INPUTS;
  const est = C.estimateFollowerConversion(D);
  const levers = C.followerLevers(D);

  const hero = `<section class="page-hero mx-hero" data-hero aria-labelledby="h1">
<div class="container">
  ${heroHead({
    crumbs: crumbs({ ...page, parent: "/pricing" }, pageFor),
    eyebrow: "Follower calculator",
    h1: "How many followers could become subscribers?", word: "subscribers",
    lede: "Your followers, your price, how often you share your link. See cautious, typical and best-case results side by side.",
  })}
  ${followerTile()}
</div>
</section>`;

  /* 3. AddressPreview: Claim this address, beside the sample offer page. */
  const claim = band({
    id: "claim", tone: "paper", labelledby: "claim-h",
    inner: `<div class="split split--center mx-claim">
  <div class="reveal">${eyebrow("Your address")}<h2 id="claim-h">Claim your address</h2>
    <p class="lede">Your page and app live at your own address. Type your coaching name to see it.</p>
    <div class="card mx-claim-card">${addressPreview({ id: "addr-fc", location: "calculator-address" })}</div>
  </div>
  <div class="mx-claim-stage reveal" data-wc-skip>
    ${phone({ body: offerScreen(D.priceAed), url: "layla-strength.trainsyou.com", label: "Sample offer page · your name and price", ariaLabel: "Sample offer page. Your coaching name and your price from the calculator appear on it." })}
  </div>
</div>`,
  });

  /* 4. What moves your number: 7 levers; three carry live best-case gains. */
  const LIVE = { 0: "bioLink", 1: "keywordReels", 2: "moreStories" };
  const SRC = { 0: "hopp-bio-link", 1: "meta-instagram-ranking", 3: "socialinsider-stories", 4: "hootsuite-link-stickers" };
  const BODY = { 2: "More viewers get a chance to tap before they drift away, and new followers see your link." };
  const CAPTION = {
    bioLink: "your bio link, per 1,000 profile visits a month",
    keywordReels: "4 more Reels a month with a comment keyword",
    moreStories: "4 more link Stories a month",
  };
  const moves = sec("moves").bullets.map((t, i) => {
    const at = t.indexOf(": ");
    return { title: t.slice(0, at), body: BODY[i] || cap(t.slice(at + 2)), id: LIVE[i], src: SRC[i] };
  });
  const leverLive = (id) => {
    const l = levers.find((x) => x.id === id);
    return `<div class="mx-lever-live" data-lever="${id}"${l ? "" : " hidden"}>
  <p class="mx-lever-cap">Best case at your numbers, with <span data-lever-cap>${CAPTION[id]}</span></p>
  <dl class="mx-lever-figs">
    <div><dt>Month 1</dt><dd>${val(l ? gainLabel(l.month1New) : "", { cls: "fig", attrs: 'data-lever-out="month1New"' })}</dd></div>
    <div><dt>Active at 12</dt><dd>${val(l ? gainLabel(l.activeMonth12) : "", { cls: "fig", attrs: 'data-lever-out="activeMonth12"' })}</dd></div>
    <div><dt>A month</dt><dd>${val(l ? revGain(l.revenueMonth12Minor) : "", { cls: "fig", attrs: 'data-lever-out="revenueMonth12Minor"' })}</dd></div>
  </dl>
</div>`;
  };
  const movesBand = band({
    id: "moves", labelledby: "moves-h",
    inner: `${sectionHead({ eyebrow: "Levers", title: sec("moves").heading, id: "moves-h", lede: "The first three are measured at your numbers: best case, one change at a time." })}
<ol class="mx-levers mx-levers--live reveal" data-stagger>${moves.slice(0, 3).map((m, i) => `<li class="mx-lever card"><span class="fig mx-lever-n" aria-hidden="true">${String(i + 1).padStart(2, "0")}</span><h3>${esc(m.title)}</h3><p>${esc(m.body)}</p>${leverLive(m.id)}${m.src ? `<div class="mx-lever-src">${srcBadge(m.src)}</div>` : ""}</li>`).join("")}</ol>
<p class="fine mx-levers-note">AED: a month at month&nbsp;12, at your price, before platform commission. ${statusChip("payments", "subscriber payments")}</p>
<ol class="mx-levers mx-levers--more reveal" data-stagger start="4">${moves.slice(3).map((m, j) => `<li class="mx-lever"><span class="fig mx-lever-n" aria-hidden="true">${String(j + 4).padStart(2, "0")}</span><h3>${esc(m.title)}</h3><p>${esc(m.body)}${m.src ? ` ${srcBadge(m.src)}` : ""}</p></li>`).join("")}</ol>`,
  });

  /* 5. The 8-step method, collapsed; two steps carry a line at your numbers. */
  const sc = est.scenarios;
  const views = `About ${SCEN.map((s) => C.whole(Math.round(sc[s.k].storyViewers))).join(", ").replace(/, ([^,]*)$/, " and $1")} people see your Stories each month at your numbers (cautious, typical, best case).`;
  const churn = `At your numbers: ${C.pct(est.inputs.yearlyCancelPct)} a year is about ${C.pct(Math.round(est.monthlyCancelPct * 100) / 100)} a month.`;
  const LIVE_LINE = { 0: ["views", views], 6: ["churn", churn] };
  const steps = sec("how").steps;
  const strongBody = sec("strong-case").body;
  const method = band({
    id: "method", tone: "paper", labelledby: "method-h",
    inner: `<div class="split mx-method">
  <div class="mx-method-copy reveal">${eyebrow("Method")}<h2 id="method-h">How we calculate</h2>
    <p class="lede">Eight steps from followers to subscribers. Open any step to see the ratio and its source.</p>
    <div class="mx-method-why"><p class="h4">Why the best case leads</p>${strongBody.map((p) => `<p>${esc(p)}</p>`).join("")}
      <div class="chip-row">${sec("strong-case").sources.map((id) => srcBadge(id)).join("")}</div></div>
    <p class="fine">Assumptions version ${esc(C.DEFAULT_FOLLOWER_MODEL.version)}. ${secondaryLink({ label: "Sources and methodology", href: "/methodology", location: "inline" })}</p>
  </div>
  <ol class="mx-steps8 reveal" data-stagger>${steps.map((s, i) => `
    <li class="acc mx-step8">
      <h3 class="acc-q"><button type="button" class="mx-acc-btn" data-mx-acc aria-expanded="false" aria-controls="fm-${i + 1}"><span class="fig mx-step8-n" aria-hidden="true">${String(i + 1).padStart(2, "0")}</span><span class="mx-step8-t">${esc(s.title)}</span><span class="acc-icon">${icon("faq")}</span></button></h3>
      <div class="acc-panel" id="fm-${i + 1}" role="region" aria-label="${esc(s.title)}"><div class="acc-inner"><div><p>${esc(s.body)}</p>${LIVE_LINE[i] ? `<p class="mx-live-line" data-method="${LIVE_LINE[i][0]}">${esc(LIVE_LINE[i][1])}</p>` : ""}</div></div></div>
    </li>`).join("")}
  </ol>
</div>`,
  });

  /* 6. Sources: every ratio the estimate uses. */
  const ids = [...new Set([...sec("how").sources, ...sec("strong-case").sources, ...sec("moves").sources])].filter((id) => sourceFor(id));
  const sources = band({
    id: "sources", labelledby: "sources-h",
    inner: `${sectionHead({ eyebrow: "Sources", title: "Where the ratios come from", id: "sources-h", lede: "Each ratio links to its source. Evidence labels show how much weight it can carry.", after: secondaryLink({ label: "All sources in our methodology", href: "/methodology", location: "inline" }), row: true })}
<ul class="mx-sources reveal" data-stagger id="mx-sources">${ids.map((id) => {
      const s = sourceFor(id);
      return `<li class="mx-source"><div class="mx-source-top"><b>${esc(s.publisher)}</b>${s.evidence ? chip(s.evidence, "plain") : ""}</div><p class="mx-source-t">${ext(s.url, s.title)}</p><p class="fine">${esc(s.claim)}</p></li>`;
    }).join("")}</ul>
<button type="button" class="btn btn--secondary mx-sources-more" data-mx-sources aria-controls="mx-sources" aria-expanded="false">Show all ${ids.length} sources${icon("chevron")}</button>`,
  });

  /* 7. FAQ (4). Answers kept to 45 words and matched to the side-by-side results. */
  const items = [
    { q: page.faqs[0].q, a: "No. It applies published averages and our stated assumptions to your inputs. The best case leads; cautious and typical sit beside it, and you may get fewer subscribers than the cautious figure. Your content, audience, offer and price change the real number." },
    { q: "Why does the headline show the best case?", a: "It shows what an engaged, growing audience with weekly sharing could reach, from the top research values and our stated assumptions. It is far above published creator averages, so we label it Best case and show cautious and typical beside it." },
    { q: page.faqs[2].q, a: page.faqs[2].a },
    { q: page.faqs[3].q, a: page.faqs[3].a },
  ];
  const faqs = faqBand({
    title: "Follower maths, answered", idPrefix: "fq", items,
    related: [["Earnings calculator", "/earnings-calculator"], ["Followers to clients guide", "/guides/instagram-followers-to-clients"], ["Methodology", "/methodology"]],
  });

  return {
    title: "Instagram followers to paying subscribers and clients calculator · trainsyou",
    main: [hero, claim, movesBand, method, sources, faqs].join("\n"),
    closing: { secondary: { label: "Estimate my earnings", href: "/earnings-calculator" } },
  };
}

export const pages = { "/earnings-calculator": earnings, "/follower-calculator": follower };
