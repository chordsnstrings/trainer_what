// Calculator pages (money group): /earnings-calculator and /follower-calculator.
// Concept C treatment: inputs on the left, the result as a sheet, assumptions
// and the status chip in the margin. Copy follows section C16/C17 (proposed,
// pending owner approval) and content.json. Maths: site/assets/calc.js (1:1
// port of packages/domain). First-paint strings come from site/assets/money.js
// (F), the same formatter the page runs live, so nothing jumps on load.
// Styles: site/assets/money.css. Behaviour: site/assets/money.js.
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { ROOT } from "./lib/content.mjs";

const require = createRequire(import.meta.url);
const calc = require(resolve(ROOT, "site/assets/calc.js"));
const F = require(resolve(ROOT, "site/assets/money.js"));

const ROMAN = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii"];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------------------------------------------------------------------------
// Shared pieces

/** Hero status line: before any AED figure on the page. */
function statusStrip(h) {
  const link = `<a href="${h.esc("pricing.html#status")}">What works today<span class="arr" aria-hidden="true">→</span></a>`;
  return `<p class="status-strip">${h.flagged(
    "payments",
    `<span class="chip-dot" aria-hidden="true"></span>Subscriber payments and payouts are not on yet. ${link}`,
    `${h.icon("check", { size: 16 })}Subscriber payments and payouts are live. ${link}`,
  )}</p>`;
}

/** Number field with AED/% affixes; helpHtml is HTML. */
function numField(h, { id, label, value, k, min, max, step = 1, prefix = "", suffix = "", helpHtml = "", decimal = false, alt, upfrontOnly = false, placeholder }) {
  const unit = prefix || (suffix === "%" ? "%" : suffix);
  const labelAttrs = alt ? ` data-label-monthly="${h.esc(label)}" data-label-upfront="${h.esc(alt)}"` : "";
  return `<div class="field mc-field"${upfrontOnly ? " data-upfront-only hidden" : ""}>
  <label class="field-label" for="${id}"${labelAttrs}><span data-label-text>${h.esc(label)}</span>${unit ? `<span class="sr-only"> (${h.esc(unit)})</span>` : ""}</label>
  <div class="input-wrap${prefix ? " has-prefix" : ""}${suffix ? " has-suffix" : ""}">${prefix ? `<span class="affix affix--pre" aria-hidden="true">${h.esc(prefix)}</span>` : ""}<input class="input" id="${id}" type="number" inputmode="${decimal ? "decimal" : "numeric"}" min="${min}" max="${max}" step="${step}" value="${value ?? ""}"${placeholder ? ` placeholder="${h.esc(placeholder)}"` : ""} data-k="${k}"${helpHtml ? ` aria-describedby="${id}-help"` : ""}>${suffix ? `<span class="affix affix--suf" aria-hidden="true">${h.esc(suffix)}</span>` : ""}</div>
  ${helpHtml ? `<p class="field-help" id="${id}-help">${helpHtml}</p>` : ""}
</div>`;
}

/** Input group. mode: "static" (always open) | "open" | "phone-closed" | "closed". */
function group(h, { id, n, title, sum = "", sumKey, mode = "static", bodyHtml }) {
  if (mode === "static")
    return `<fieldset class="mc-group mc-group--static" id="${id}"><legend class="mc-gh"><span class="mc-gn">${n}</span><span class="mc-gt">${h.esc(title)}</span></legend><div class="mc-gfields">${bodyHtml}</div></fieldset>`;
  return `<div class="mc-group is-open" id="${id}" data-mc-group="${mode}">
  <h3 class="mc-gh"><button class="mc-gbtn" type="button" aria-expanded="true" aria-controls="${id}-body"><span class="mc-gn">${n}</span><span class="mc-gt">${h.esc(title)}</span><span class="mc-gsum" data-sum="${sumKey}">${h.esc(sum)}</span><span class="mc-gicon" aria-hidden="true"></span></button></h3>
  <div class="mc-gbody" id="${id}-body"><fieldset class="mc-ginner"><legend class="sr-only">${h.esc(title)}</legend><div class="mc-gfields">${bodyHtml}</div></fieldset></div>
</div>`;
}

/** Primary CTA under a result, plus the decision-8 price sub-line. */
function sheetCta(h, { price, extraHtml = "" }) {
  return `<div class="mc-cta">${h.cta({ location: "calculator", query: `?price_aed=${price}` })}${extraHtml}</div>
<p class="mc-carry" data-mc-carry><span class="mc-carry-t">Your price, ${h.valueSlot(`AED ${calc.whole(price)}`, { key: "price" })}, carries into setup</span> <span class="placeholder">proposed · decision 8</span></p>`;
}

const msBand = (h, { id, n, title, titleHtml, lede, paper = false, bodyHtml, className = "" }) =>
  h.band({ id, labelledby: `${id}-h`, paper, className, contentHtml: `${h.sectionHead({ n, title, titleHtml, lede, id: `${id}-h` })}${bodyHtml}` });

function faqBand(h, { id, n, items, relatedHtml }) {
  return h.band({
    id,
    labelledby: `${id}-h`,
    contentHtml: `${h.sectionHead({ n, title: "Questions", id: `${id}-h` })}
<div class="ms">${h.faq(items, { id: `${id}-faq` })}<div class="faq-side">
  <div class="mnote" role="note"><span class="mnote-k">More answers</span>${h.linkArrow("All questions", "/faq")}</div>
  <div class="mnote" role="note"><span class="mnote-k">See also</span><ul class="mc-related">${relatedHtml}</ul></div>
  ${h.kamranPill({ inline: true, location: "faq" })}
</div></div>`,
  });
}

// ---------------------------------------------------------------------------
// /earnings-calculator (C16)

function earnings({ page, h, pageFor }) {
  const { esc, each, mark, statusChip, flagged, valueSlot, liveRegion, methodBadge, linkArrow, secondary, shareButton, estimateLabel, pullQuote, faq, icon } = h;
  const D = calc.DEFAULT_EARNINGS_INPUTS;
  const o = F.earn(D);
  const sec = (id) => page.sections.find((s) => s.id === id);
  const fol = calc.estimateFollowerConversion(calc.DEFAULT_FOLLOWER_INPUTS).scenarios;
  const payChip = statusChip("payments", "Not on yet: subscriber payments", "Subscriber payments live");

  // Hero: split header; the arithmetic set as a four-line sum (desktop margin).
  const hero = `<section class="hero mc-hero" data-hero aria-labelledby="ec-h1">
  <div class="wrap mc-hero-grid">
    <div class="mc-hero-copy">
      <p class="eyebrow">Earnings calculator</p>
      <h1 class="display" id="ec-h1">What could your coaching ${mark("earn")} each month?</h1>
    </div>
    <div class="mc-hero-side">
      <p class="lede">Enter your subscribers, your price and the options you offer. See our share by band, and what remains before other costs.</p>
      ${statusStrip(h)}
      <p class="micro mc-def">Your AI (we call it your Trainer Brain) coaches subscribers with your method. You set the price.</p>
    </div>
  </div>
</section>`;

  // §1 The calculator: inputs | result sheet | margin notes.
  const inputs = `<form class="mc-in" aria-label="Your offer" novalidate data-reveal>
  ${group(h, {
    id: "ec-g1", n: "i", title: "Subscribers and price",
    bodyHtml: [
      numField(h, { id: "ec-subs", label: "Paying subscribers", value: D.subscribers, k: "subscribers", min: 0, max: 100000, helpHtml: `Don’t know yet? <a class="text-link" href="${h.esc("follower-calculator.html")}">Estimate it from followers</a>` }),
      `<div class="field mc-field"><label class="field-label" for="ec-billing">Billing</label><div class="input-wrap"><select class="input" id="ec-billing" data-k="billing"><option value="monthly" selected>Monthly</option><option value="upfront">Upfront for the whole programme</option></select></div></div>`,
      numField(h, { id: "ec-price", label: "Workout price per month", alt: "Workout programme price", value: D.workoutPriceAed, k: "workoutPriceAed", min: 0, max: 10000, prefix: "AED" }),
      numField(h, { id: "ec-months", label: "Programme length", value: D.programmeMonths, k: "programmeMonths", min: 1, max: 24, suffix: "months", upfrontOnly: true }),
      numField(h, { id: "ec-rate", label: "Your usual in-person rate per session", value: D.yourSessionRateAed, k: "yourSessionRateAed", min: 0, max: 10000, prefix: "AED" }),
    ].join(""),
  })}
  ${group(h, {
    id: "ec-g2", n: "ii", title: "Nutrition tier and voice", sum: o.sum2, sumKey: "g2", mode: "phone-closed",
    bodyHtml: [
      numField(h, { id: "ec-nshare", label: "Subscribers on workout + nutrition", value: D.nutritionSharePct, k: "nutritionSharePct", min: 0, max: 100, suffix: "%" }),
      numField(h, { id: "ec-nprice", label: "Workout + nutrition price per month", alt: "Workout + nutrition programme price", value: D.nutritionPriceAed, k: "nutritionPriceAed", min: 0, max: 10000, prefix: "AED" }),
      numField(h, { id: "ec-vshare", label: "Subscribers adding your voice coach", value: D.voiceSharePct, k: "voiceSharePct", min: 0, max: 100, suffix: "%", helpHtml: statusChip("voice", "Not on yet for subscribers", "Live for subscribers") }),
      numField(h, { id: "ec-vprice", label: "Voice add-on per month", value: D.voicePriceAed, k: "voicePriceAed", min: 0, max: 10000, prefix: "AED" }),
    ].join(""),
  })}
  ${group(h, {
    id: "ec-g3", n: "iii", title: "One-to-one sessions", sum: o.sum3, sumKey: "g3", mode: "phone-closed",
    bodyHtml: [
      numField(h, { id: "ec-sessions", label: "Paid one-to-one sessions each month", value: D.sessionsPerMonth, k: "sessionsPerMonth", min: 0, max: 1000 }),
      numField(h, { id: "ec-sprice", label: "Price per session", value: D.sessionPriceAed, k: "sessionPriceAed", min: 0, max: 10000, prefix: "AED" }),
    ].join(""),
  })}
</form>`;

  const BAND_LABELS = ["1–100", "101–300", "301–1,000", "Above 1,000"];
  const BAND_RATES = ["25%", "20%", "15%", "10%"];
  const sheet = `<div class="mc-sheet" data-reveal>
  <div class="mc-sheet-top"><span class="eyebrow">Illustrative arithmetic</span>${payChip}</div>
  <p class="mc-fig">${valueSlot(o.kept, { key: "kept", w: "10ch" })}</p>
  <p class="mc-fig-label">a month before other costs and tax</p>
  <div class="mc-same">
    <p class="mc-same-row"><span class="mc-same-k">The same money, in sessions at your usual rate</span><span class="mc-same-v">${valueSlot(o.sessions, { key: "sessions", w: "9ch", align: "end" })}</span></p>
    <div class="mc-tally"><span class="vx mc-tally-vx" data-vx="tally"><span>${o.tally}</span></span></div>
    <p class="mc-tally-key fine" aria-hidden="true">One mark, one session.</p>
  </div>
  <ol class="mc-ledger" aria-label="Line by line">
    <li><span class="ml-k">${valueSlot(o.subsK, { key: "subsK" })}</span><span class="ml-x">${valueSlot(o.subsX, { key: "subsX" })}</span><span class="ml-v">${valueSlot(o.subsV, { key: "subsV", align: "end", w: "11ch" })}</span></li>
    <li><span class="ml-k">Our share</span><span class="ml-x">${valueSlot(o.shareX, { key: "shareX" })}</span><span class="ml-v">${valueSlot(o.shareV, { key: "shareV", align: "end", w: "11ch" })}</span></li>
    <li><span class="ml-k">Sessions</span><span class="ml-x">${valueSlot(o.sessX, { key: "sessX" })}</span><span class="ml-v">${valueSlot(o.sessV, { key: "sessV", align: "end", w: "11ch" })}</span></li>
    <li class="ml-sum"><span class="ml-k"><span aria-hidden="true">∴</span><span class="sr-only">Therefore</span></span><span class="ml-x">Before other costs and tax</span><span class="ml-v">${valueSlot(o.kept, { key: "sumV", align: "end", w: "11ch" })}</span></li>
  </ol>
  <div class="mc-bands">
    <p class="mc-bands-k">Our share, band by band</p>
    <div class="mc-ruler" aria-hidden="true">
      <div class="mc-rbar"><span class="mc-rfill" style="--p:${o.p}"></span><i style="--l:.2"></i><i style="--l:.45"></i><i style="--l:.75"></i></div>
      <div class="mc-rlab">${each(BAND_RATES, (r, i) => `<span><b>${r}</b>${BAND_LABELS[i].replace("Above ", "")}${i === 3 ? "+" : ""}</span>`)}</div>
    </div>
    <div class="tbl-wrap"><table class="tbl mc-btbl">
      <caption class="sr-only">Commission by band</caption>
      <thead><tr><th scope="col">Subscribers</th><th scope="col" class="num">Rate</th><th scope="col" class="num">In band</th><th scope="col" class="num">Commission</th></tr></thead>
      <tbody>${each(o.bands, (b, i) => `<tr data-band="${i}"${b.empty ? ' class="is-empty"' : ""}><th scope="row">${BAND_LABELS[i]}</th><td class="num">${BAND_RATES[i]}</td><td class="num">${valueSlot(b.n, { key: "bn" + i, align: "end", w: "6ch" })}</td><td class="num">${valueSlot(b.c, { key: "bc" + i, align: "end", w: "10ch" })}</td></tr>`)}</tbody>
    </table></div>
  </div>
  ${sheetCta(h, { price: o.price, extraHtml: shareButton() })}
  ${liveRegion("ec-live")}
</div>`;

  const margin = `<aside class="mc-margin" aria-label="Notes on this estimate" data-reveal>
  <figure class="mnote mc-formula" role="note" aria-labelledby="ec-f1">
    <span class="mnote-k" id="ec-f1">The sum the sheet does</span>
    <ol class="mf-lines">
      <li><span class="mf-op" aria-hidden="true"></span><span class="mf-t">Subscribers × average price</span></li>
      <li><span class="mf-op" aria-label="minus">−</span><span class="mf-t">our share, band by band</span></li>
      <li><span class="mf-op" aria-label="plus">+</span><span class="mf-t">one-to-one sessions</span></li>
      <li class="mf-sum"><span class="mf-op" aria-label="equals">=</span><span class="mf-t">before other costs and tax</span></li>
    </ol>
    <span class="mc-note-p">Arithmetic on your numbers, not a forecast or promise.</span><span class="mc-note-line">${methodBadge("earnings-method", "Method")}</span>
  </figure>
  <div class="mnote" role="note"><span class="mnote-k">Status</span>${flagged("payments", "Subscriber payments and payouts are not on yet. You can set your price in setup today.", "Subscriber payments and payouts are live.")}</div>
  <div class="mnote" role="note"><span class="mnote-k">Each band, its own rate</span>25% for your first 100 paying subscribers, then 20%, 15% and 10%.<span class="mc-note-line">${linkArrow("Pricing in detail", "/pricing")}</span></div>
  <div class="mnote" role="note"><span class="mnote-k">Not included</span>Payment processing, your own domain, refunds, disputes and tax.<span class="mc-note-line">${linkArrow("All assumptions", "#assumptions")}</span></div>
</aside>`;

  const calculator = `<section class="band band--paper mc-calc-band" id="calculator" aria-labelledby="calculator-h">
  <div class="wrap">
    ${h.sectionHead({ n: 1, title: "Your numbers", id: "calculator-h" })}
    <div class="mc-calc" data-ec>${inputs}${sheet}${margin}</div>
  </div>
</section>`;

  // §2 Bridge: no subscriber count yet? Start from followers.
  const bridge = msBand(h, {
    id: "followers", n: 2, title: "Don’t know your subscriber count?",
    bodyHtml: h.msRow(
      `<p class="big-p">Start from your followers, then bring the count back here.</p>
<div class="mc-bridge" role="group" aria-label="Follower calculator, at its defaults">
  <div><p class="mc-bridge-k">Cautious</p><p class="mc-bridge-v tnum">${calc.countLabel(fol.cautious.activeMonth12)}</p></div>
  <div><p class="mc-bridge-k">Typical</p><p class="mc-bridge-v tnum">${calc.countLabel(fol.typical.activeMonth12)}</p></div>
  <div class="is-best"><p class="mc-bridge-k">Strong · best case</p><p class="mc-bridge-v tnum"><span class="mc-upto">up to</span> ${calc.countLabel(fol.strong.activeMonth12)}</p></div>
  <p class="mc-bridge-s">active subscribers after 12 months, at 7,000 followers and AED 199 ${estimateLabel()}</p>
</div>
<p class="mc-bridge-cta">${secondary("Estimate it from followers", "/follower-calculator", { location: "inline", variant: "button" })}</p>`,
      `<span class="mnote-k">Where these come from</span>The follower calculator’s defaults: 7,000 followers, 8 link Stories a month.<span class="mc-note-line">${methodBadge("follower-formula")}</span>`,
    ),
  });

  // §3 Assumptions: clauses, and what the sum leaves out.
  const as = sec("assumptions").bullets;
  const notIn = as[as.length - 1].replace(/^Not included:\s*/, "").replace(/\.$/, "").split(/, | and /);
  const assumptions = msBand(h, {
    id: "assumptions", n: 3, title: "Assumptions", paper: true,
    bodyHtml: `<div class="ms">
  <ol class="mc-clauses" data-reveal data-stagger>${each(as.slice(0, -1), (t, i) => `<li><span class="mc-cl-n">A${i + 1}</span><p>${esc(t)}</p></li>`)}</ol>
  <div class="mc-notin" data-reveal><p class="mc-notin-k">Not in the sum</p><ul>${each(notIn, (t) => `<li>${esc(cap(t))}</li>`)}</ul><p class="fine">Each appears on your monthly statement once payments are on.</p></div>
</div>
${pullQuote(`Arithmetic, <span class="nowrap">${mark("not a promise")}.</span>`, { className: "mc-pull" })}`,
  });

  // §4 How to use it: four numbered moves.
  const STEP_BODY = [
    "Subscribers you could reach in your first months, not your whole following.",
    "Your monthly or upfront price, plus the share on the nutrition tier and voice add-on.",
    "Paid one-to-one sessions you would still sell alongside the subscription.",
    "Subscriptions minus our share by band, plus sessions: what remains before other costs.",
  ];
  const steps = sec("use").steps;
  const use = msBand(h, {
    id: "use", n: 4, title: "How to use it",
    bodyHtml: `<ol class="mc-moves" data-reveal data-stagger>${each(steps, (s, i) => `<li><span class="mc-mv-n">${ROMAN[i]}</span><h3 class="mc-mv-t">${esc(s.title)}</h3><p>${esc(STEP_BODY[i])}</p>${i === 0 ? `<p class="mc-mv-link">${linkArrow("See the three counts", "/follower-calculator")}</p>` : ""}</li>`)}</ol>`,
  });

  // §5 Worked example, set as a proof (numbers computed, not typed).
  const w = calc.estimateEarnings({ ...D, subscribers: 120, workoutPriceAed: 199, nutritionSharePct: 0, voiceSharePct: 0, sessionsPerMonth: 0, yourSessionRateAed: 250 });
  const [b1, b2] = w.bands;
  const example = msBand(h, {
    id: "example", n: 5, title: "A worked example", paper: true,
    bodyHtml: `<div class="ms">
  <div class="mc-proof" data-reveal>
    <div class="mc-proof-top"><span class="mc-proof-k">Example · not a forecast</span>${payChip}</div>
    <ol class="mc-plines" data-stagger>
      <li><span class="pl-k">Given</span><span class="pl-x">120 subscribers × AED 199 a month</span><span class="pl-v">${calc.aedWhole(w.subscriptionMonthlyMinor)}</span></li>
      <li><span class="pl-k">Our share</span><span class="pl-x">first ${b1.subscribers} × AED 199 × ${b1.ratePct}%</span><span class="pl-v">${calc.aedWhole(b1.commissionMinor)}</span></li>
      <li><span class="pl-k"></span><span class="pl-x">next ${b2.subscribers} × AED 199 × ${b2.ratePct}%</span><span class="pl-v">${calc.aedWhole(b2.commissionMinor)}</span></li>
      <li class="pl-sum"><span class="pl-k"></span><span class="pl-x">Commission, ${calc.pct(w.effectiveCommissionPct)} overall</span><span class="pl-v">${calc.aedWhole(w.commissionMinor)}</span></li>
      <li class="pl-res"><span class="pl-k" aria-label="Therefore">∴</span><span class="pl-x">You keep, before payment processing and tax</span><span class="pl-v">${calc.aedWhole(w.beforeOtherCostsMinor)}</span></li>
    </ol>
    <div class="mc-proof-foot"><p class="tnum">About ${w.equivalentSessions} sessions at AED 250.</p><button class="btn btn-secondary btn-sm" type="button" data-ec-example>Try it in the calculator${icon("arrow", { size: 16, className: "mc-up" })}</button></div>
  </div>
  <div class="mnote" role="note" data-reveal><span class="mnote-k">Read it like this</span>${esc(sec("example").note)} Each band’s rate applies only to the subscribers inside it.</div>
</div>`,
  });

  const faqs = page.faqs.map((f) => ({ q: f.q, a: f.a }));
  const related = page.related.map((p) => `<li>${linkArrow(pageFor(p).navLabel, p)}</li>`).join("");

  return {
    main: [hero, calculator, bridge, assumptions, use, example, faqBand(h, { id: "questions", n: 6, items: faqs, relatedHtml: related })].join("\n"),
    title: page.title,
    description: page.description,
    calc: true,
    closing: { label: "Estimate from followers", path: "/follower-calculator" },
  };
}

// ---------------------------------------------------------------------------
// /follower-calculator (C17)

function followers({ page, content, h, pageFor }) {
  const { esc, each, mark, statusChip, flagged, valueSlot, liveRegion, methodBadge, sourceBadge, linkArrow, secondary, estimateLabel, pullQuote, chip, icon, addressPreview } = h;
  const D = calc.DEFAULT_FOLLOWER_INPUTS;
  const o = F.fol(D);
  const ch = F.chart(o.est);
  const sec = (id) => page.sections.find((s) => s.id === id);
  const src = (id) => content.sources.find((s) => s.id === id);
  const payChip = statusChip("payments", "Not on yet: subscriber payments", "Subscriber payments live");

  // Hero: the method in one line, pinned to the steps in §5.
  const hero = `<section class="hero mc-hero" data-hero aria-labelledby="fc-h1">
  <div class="wrap mc-hero-grid">
    <div class="mc-hero-copy">
      <p class="eyebrow">Follower calculator</p>
      <h1 class="display" id="fc-h1">How many followers could become <span class="nowrap">${mark("subscribers")}?</span></h1>
    </div>
    <div class="mc-hero-side">
      <p class="lede">Enter your followers, your price and how you share your link. See a cautious, typical and best case side by side.</p>
      ${statusStrip(h)}
      <p class="micro mc-def">Your AI (we call it your Trainer Brain) coaches the followers who subscribe, with your method.</p>
    </div>
  </div>
</section>`;
  const chain = `<figure class="mnote mc-formula" role="note" aria-labelledby="fc-f1">
      <span class="mnote-k" id="fc-f1">The method, in one line</span>
      <ol class="mf-lines">
        <li><span class="mf-op" aria-hidden="true"></span><span class="mf-t">People who see your link</span><span class="mf-pin">i · iv · v</span></li>
        <li><span class="mf-op" aria-label="times">×</span><span class="mf-t">the share who visit</span><span class="mf-pin">ii · iii</span></li>
        <li><span class="mf-op" aria-label="times">×</span><span class="mf-t">the share who pay</span><span class="mf-pin">vi</span></li>
        <li><span class="mf-op" aria-label="minus">−</span><span class="mf-t">cancellations</span><span class="mf-pin">vii</span></li>
        <li class="mf-sum"><span class="mf-op" aria-label="equals">=</span><span class="mf-t">active subscribers</span></li>
      </ol>
      <span class="mc-note-p">Pins are the steps in ${linkArrow("§5 How we calculate", "#method")}</span>
    </figure>`;

  // §1 Calculator.
  const inputs = `<form class="mc-in" aria-label="Your numbers" novalidate data-reveal>
  ${group(h, {
    id: "fc-g1", n: "i", title: "Your audience and price",
    bodyHtml: [
      numField(h, { id: "fc-followers", label: "Instagram followers", value: D.followers, k: "followers", min: 0, max: 10000000 }),
      numField(h, { id: "fc-price", label: "Your monthly price", value: D.priceAed, k: "priceAed", min: 1, max: 10000, prefix: "AED" }),
      numField(h, { id: "fc-stories", label: "Stories with your link each month", value: D.linkStoriesPerMonth, k: "linkStoriesPerMonth", min: 0, max: 60, helpHtml: "Two a week is 8 a month." }),
    ].join(""),
  })}
  ${group(h, {
    id: "fc-g2", n: "ii", title: "Reels and cancellations", sum: o.sumReels, sumKey: "reels", mode: "phone-closed",
    bodyHtml: [
      numField(h, { id: "fc-reels", label: "Reels or posts with a call to action each month", value: D.ctaReelsPerMonth, k: "ctaReelsPerMonth", min: 0, max: 60 }),
      `<div class="field mc-field mc-field--check"><label class="check" for="fc-keyword"><input type="checkbox" id="fc-keyword" data-k="keywordDms"${D.keywordDms ? " checked" : ""} aria-describedby="fc-keyword-help"><span>A comment keyword sends your link by DM</span></label><p class="field-help" id="fc-keyword-help">Without it, those posts count only through visits to your bio link.</p></div>`,
      numField(h, { id: "fc-cancel", label: "Members who cancel per year", value: D.yearlyCancelPct, k: "yearlyCancelPct", min: 5, max: 80, suffix: "%", helpHtml: "5 to 80. We assume 30% unless you know yours." }),
    ].join(""),
  })}
  ${group(h, {
    id: "fc-own", n: "iii", title: "Your own numbers (optional)", sum: "None entered", sumKey: "own", mode: "closed",
    bodyHtml: [
      numField(h, { id: "fc-visits", label: "Profile visits each month", value: "", k: "profileVisitsPerMonth", min: 0, max: 10000000, helpHtml: "From Instagram Insights. Your bio link is counted only when you enter this." }),
      numField(h, { id: "fc-members", label: "Broadcast channel members", value: "", k: "broadcastMembers", min: 0, max: 10000000 }),
      numField(h, { id: "fc-links", label: "Link messages in your channel each month", value: D.broadcastLinksPerMonth, k: "broadcastLinksPerMonth", min: 0, max: 60 }),
      numField(h, { id: "fc-views", label: "Average Story views", value: "", k: "storyViews", min: 0, max: 10000000, helpHtml: "From Instagram Insights. Replaces our guess of how many people see your Stories." }),
      numField(h, { id: "fc-eng", label: "Engagement rate", value: "", k: "engagementRatePct", min: 0, max: 100, step: 0.01, suffix: "%", decimal: true, helpHtml: "Average likes and comments per post, divided by followers. Leave blank if unsure." }),
    ].join(""),
  })}
</form>`;

  const ROWS = [
    ["first", "New in your first month"],
    ["active", "Active after 12 months"],
    ["signups", "Sign-ups over 12 months, before cancellations"],
    ["aed", "A month at month 12, at your price"],
  ];
  const HEAD = { cautious: "Cautious", typical: "Typical", strong: "Strong" };
  const scenTable = `<div class="mc-scen" role="table" aria-label="Three cases at your numbers">
  <div class="mc-scen-head" role="row"><span class="mc-scen-corner" role="columnheader"><span class="sr-only">Measure</span></span>${each(F.S, (k) => `<span class="mc-scen-h${k === "strong" ? " is-best" : ""}" role="columnheader">${HEAD[k]}${k === "strong" ? '<small aria-hidden="true">best case</small>' : ""}</span>`)}</div>
  ${each(ROWS, ([key, label]) => `<div class="mc-scen-row${key === "aed" ? " mc-scen-row--aed" : ""}" role="row"><span class="mc-scen-k" role="rowheader">${esc(label)}</span>${each(F.S, (k) => `<span class="mc-scen-v${k === "strong" ? " is-best" : ""}" role="cell">${valueSlot(o.cells[k][key], { key: `${k}-${key}` })}</span>`)}</div>`)}
</div>`;

  const sheet = `<div class="mc-sheet" data-reveal>
  <div class="mc-sheet-top">${estimateLabel()}${payChip}</div>
  <p class="mc-case"><span class="mc-case-tag">Best case</span>${valueSlot(o.caseText, { key: "case" })}</p>
  <p class="mc-fig"><span class="mc-upto" data-upto${o.upto ? "" : " hidden"}>Up to</span> ${valueSlot(o.headline, { key: "headline", w: "10ch" })}</p>
  <p class="mc-fig-label">a month at your price, before platform commission</p>
  ${scenTable}
  <p class="mc-cancel"><span class="mc-cancel-k">Cancellations, every case</span><span class="mc-cancel-v">${valueSlot(o.cancel, { key: "cancel" })}<span aria-hidden="true"> · </span>${valueSlot(o.cancelM, { key: "cancelM" })}</span></p>
  <p class="mc-growing" data-growing${o.growing ? "" : " hidden"}>${icon("arrow", { size: 14, className: "mc-rise" })}The best case is still growing at month 12.</p>
  <p class="fine mc-fine">A best case for an engaged, growing audience, not a typical result and not a promise. You may get fewer subscribers than the cautious figure.</p>
  ${sheetCta(h, { price: o.price, extraHtml: secondary("How we calculate this", "/methodology#follower-formula", { location: "calculator" }) })}
  ${liveRegion("fc-live")}
</div>`;

  const margin = `<aside class="mc-margin" aria-label="Notes on this estimate" data-reveal>
  ${chain}
  <div class="mnote" role="note"><span class="mnote-k">Read it like this</span>Published averages and our stated assumptions, applied to your inputs.<span class="mc-note-line">${methodBadge("follower-formula")}</span></div>
  <div class="mnote" role="note"><span class="mnote-k">Status</span>${flagged("payments", "Subscriber payments are not on yet, so no subscriber can pay you today.", "Subscriber payments are live.")}</div>
  <div class="mnote" role="note"><span class="mnote-k">Your biggest guess</span><span class="mc-mrow"><span>People who see your Stories, best case</span><b>${valueSlot(o.storyBest, { key: "storyBest" })}</b></span><button class="mc-textbtn" type="button" data-fc-views>Enter your Story views</button></div>
  <div class="mnote" role="note"><span class="mnote-k">Then, in AED</span><span class="mc-mrow"><span>Typical, active at month 12</span><b>${valueSlot(o.typ, { key: "typ" })}</b></span><a class="link-arrow" href="${esc(o.carry)}" data-fc-carry data-track="cta_click" data-track-props="${esc(JSON.stringify({ label: "Estimate earnings from it", location: "calculator" }))}"><span class="la">Estimate earnings from it</span><span class="arr" aria-hidden="true">→</span></a></div>
</aside>`;

  const calculator = `<section class="band band--paper mc-calc-band" id="calculator" aria-labelledby="calculator-h">
  <div class="wrap">
    ${h.sectionHead({ n: 1, title: "Your numbers", id: "calculator-h" })}
    <div class="mc-calc" data-fc>${inputs}${sheet}${margin}</div>
  </div>
</section>`;

  // §2 Month by month: one axis, three cases, legend + direct labels + table.
  const readout = F.readout(ch.vals, 11);
  const chart = msBand(h, {
    id: "months", n: 2, title: "Month by month",
    bodyHtml: `<div class="ms">
  <figure class="fig mc-chart-fig" data-reveal aria-labelledby="fc-f2">
    <div class="mc-chart" data-fc-chart>
      <div class="mc-chart-top">
        <ul class="mc-legend" aria-label="Legend">${each(F.S.slice().reverse(), (k) => `<li><svg class="mc-sw mc-sw--${k}" width="28" height="8" viewBox="0 0 28 8" aria-hidden="true"><line x1="1" y1="4" x2="27" y2="4"/></svg>${HEAD[k]}${k === "strong" ? " (best case)" : ""}</li>`)}</ul>
        <p class="mc-readout tnum" data-fc-readout aria-hidden="true">${esc(cap(readout))}</p>
      </div>
      <div class="mc-chart-box">
        <span class="vx mc-chart-vx" data-vx="chart"><span>${ch.html}</span></span>
        <div class="mc-hov" tabindex="0" role="slider" aria-label="Month on the chart" aria-valuemin="1" aria-valuemax="12" aria-valuenow="12" aria-valuetext="${esc(readout)}">
          <span class="mc-x" aria-hidden="true"></span>${each(F.S, (k) => `<i class="mc-dot mc-dot--${k}" aria-hidden="true" style="left:100%;top:${ch.pts[k][11]}%"></i>`)}
        </div>
      </div>
      <div class="mc-xax" aria-hidden="true">${each([1, 3, 6, 9, 12], (m) => `<span style="left:${((m - 1) / 11) * 100}%">${m === 1 ? '<span class="mc-xm">Month </span>1' : m}</span>`)}</div>
    </div>
    <figcaption class="fig-cap" id="fc-f2"><span class="fig-n">Fig. 2</span><span class="fig-t">Active subscribers each month, at your numbers</span>${estimateLabel()}</figcaption>
    <div class="mc-group mc-mtable" data-mc-group="closed">
      <h3 class="mc-gh"><button class="mc-gbtn" type="button" aria-expanded="false" aria-controls="fc-mt-body"><span class="mc-gt">Month by month, as a table</span><span class="mc-gicon" aria-hidden="true"></span></button></h3>
      <div class="mc-gbody" id="fc-mt-body"><div class="mc-ginner"><div class="tbl-wrap"><table class="tbl mc-mtbl"><caption class="sr-only">Active subscribers each month, three cases</caption><thead><tr><th scope="col">Month</th>${each(F.S, (k) => `<th scope="col" class="num">${HEAD[k]}</th>`)}</tr></thead><tbody data-fc-months>${F.monthRows(o.est)}</tbody></table></div></div></div>
    </div>
  </figure>
  <div class="mnote" role="note" data-reveal><span class="mnote-k">Read it like this</span>New subscribers join each month and some cancel. Active means paying that month. Drag or use the arrow keys to read any month.</div>
</div>`,
  });

  // §3 AddressPreview "Claim this address" + a live bio preview.
  const claim = msBand(h, {
    id: "claim", n: 3, title: "Your link, ready for your bio", paper: true,
    bodyHtml: `<div class="ms">
  <div class="mc-claim" data-reveal>
    ${addressPreview({ id: "fc-addr", location: "follower-calculator" })}
    <figure class="mc-bio" aria-labelledby="fc-f3">
      <div class="mc-bio-card" aria-hidden="true">
        <span class="mc-bio-av" data-bio-initials>Y</span>
        <div class="mc-bio-txt"><p class="mc-bio-name" data-bio-name>Your coaching name</p><p class="mc-bio-k">Link in bio</p><p class="mc-bio-url"><b data-bio-slug>your-name</b>.trainsyou.com</p></div>
      </div>
      <figcaption class="fig-cap" id="fc-f3"><span class="fig-n">Fig. 3</span><span class="fig-t">Your link, as it reads in a bio</span>${chip("neutral", "Preview")}</figcaption>
    </figure>
  </div>
  <div class="mnote" role="note" data-reveal><span class="mnote-k">Where it goes</span>Your bio, your link Stories and your keyword DMs. A trainsyou address is free.</div>
</div>`,
  });

  // §4 What moves your number: seven levers; three carry live deltas.
  const moves = sec("moves");
  const LEVER = { 0: "bioLink", 1: "keywordReels", 2: "moreStories" };
  const LTITLE = { bioLink: "Per 1,000 profile visits a month", moreStories: "4 more link Stories a month" };
  const LSRC = { 1: ["meta-instagram-ranking", "Instagram"], 2: ["nng-participation", "Nielsen Norman"], 3: ["socialinsider-stories", "Socialinsider"], 4: ["hootsuite-link-stickers", "Hootsuite"] };
  const lever = (t, i) => {
    const [title, why] = t.split(/:\s(.+)/);
    const id = LEVER[i];
    const note = id
      ? `<span class="mnote-k">Best case, this change alone</span><span class="lv-t">${id === "keywordReels" ? valueSlot(o.keywordTitle, { key: "lv-keywordTitle" }) : esc(LTITLE[id])}</span>
<dl class="lv-d"><div><dt>First month</dt><dd>${valueSlot(o.lv[id].first, { key: `lv-${id}-first`, align: "end" })}</dd></div><div><dt>Active at month 12</dt><dd>${valueSlot(o.lv[id].active, { key: `lv-${id}-active`, align: "end" })}</dd></div></dl>`
      : i === 6
        ? `<span class="mnote-k">Try it</span><a class="link-arrow" href="#fc-cancel" data-fc-focus="fc-cancel"><span class="la">Lower your yearly cancellations above</span><span class="arr" aria-hidden="true">→</span></a>`
        : i === 3
          ? `<span class="mnote-k">Not in the estimate</span>Levers 04 to 06 come from the sources beside them. The calculator does not model them.`
          : "";
    return `<li class="ms-row mc-lever" data-reveal><div class="ms-text"><p class="lv-h"><span class="lv-n">${String(i + 1).padStart(2, "0")}</span><b>${esc(title)}</b></p><p class="lv-why">${esc(cap(why || ""))}${LSRC[i] ? ` ${sourceBadge(LSRC[i][0], { label: LSRC[i][1] })}` : ""}</p></div>${note ? `<div class="mnote" role="note">${note}</div>` : '<div class="mnote mnote--empty" aria-hidden="true"></div>'}</li>`;
  };
  const movesBand = msBand(h, {
    id: "moves", n: 4, title: "What moves your number",
    lede: "Best case, one change at a time, against your numbers above.",
    bodyHtml: `<ol class="mc-levers">${each(moves.bullets, lever)}</ol>`,
  });

  // §5 How we calculate: the 8-step method, collapsed, with live figures.
  const how = sec("how");
  const STEP_SRC = [
    ["socialinsider-stories"], ["creatorflow-link-sticker"], [], ["socialinsider-reels", "metricool-2026", "communipass-auto-dm"],
    ["hopp-bio-link", "mailerlite-benchmarks"], ["dynamicyield-conversion", "revenuecat-state-2026"], [], ["socialinsider-engagement"],
  ];
  const method = msBand(h, {
    id: "method", n: 5, title: "How we calculate", paper: true,
    lede: "Eight steps. Open any one. Figures read cautious · typical · best case, at your numbers.",
    bodyHtml: `<div class="ms">
  <ol class="mc-method">${each(how.steps, (s, i) => `<li class="mm-row" data-mc-row="${i + 1}" data-reveal style="--i:${Math.min(i, 5)}">
    <h3 class="mm-h"><button class="mm-btn" type="button" aria-expanded="false" aria-controls="mm-${i}" id="mm-${i}-b"><span class="mm-n">${ROMAN[i]}</span><span class="mm-t">${esc(s.title)}</span><span class="mm-fig">${valueSlot(o.steps[i], { key: `st-${i}` })}</span><span class="mc-gicon" aria-hidden="true"></span></button></h3>
    <div class="mm-a" id="mm-${i}" role="region" aria-labelledby="mm-${i}-b"><div><p>${esc(s.body)}</p><p class="mm-src">${STEP_SRC[i].length ? `<span class="mm-src-k">Sources</span>${each(STEP_SRC[i], (id) => sourceBadge(id, { label: src(id).publisher }))}` : `<span class="mm-src-k">Method</span>${methodBadge("follower-formula", "Our assumption, explained")}`}</p></div></div>
  </li>`)}</ol>
  <div class="mnote" role="note" data-reveal><span class="mnote-k">Assumptions version</span><span class="tnum">${esc(calc.FOLLOWER_MODEL.version)}</span><span class="mc-note-line">${linkArrow("Every source, in full", "/methodology")}</span></div>
</div>`,
  });

  // §6 Why the headline is the best case.
  const strong = sec("strong-case");
  const why = msBand(h, {
    id: "best-case", n: 6, title: "Why the best case leads",
    bodyHtml: `${h.msRow(
      `<div class="prose">${each(strong.body, (p) => `<p>${esc(p)}</p>`)}</div>`,
      `<span class="mnote-k">At your numbers</span><span class="mc-mrow"><span>Best-case sign-ups over 12 months, as a share of followers</span><b>${valueSlot(o.share, { key: "share" })}</b></span><span class="mc-note-line">${sourceBadge("passion-creator-rates", { label: "Passion.io" })} ${sourceBadge("stan-creator-economy", { label: "Stan" })}</span>`,
    )}
${pullQuote(`A best case, not a <span class="nowrap">${mark("typical")} result.</span>`, { className: "mc-pull" })}`,
  });

  // §7 Sources, as a bibliography (external links open in a new tab).
  const ids = [...new Set([...how.sources, ...strong.sources, ...moves.sources])];
  const sources = msBand(h, {
    id: "sources", n: 7, title: "Sources", paper: true,
    lede: "Every ratio above comes from one of these, or is labelled our assumption.",
    bodyHtml: `<ol class="mc-bib">${each(ids, (id, i) => {
      const s = src(id);
      return `<li class="mc-bib-i" data-reveal style="--i:${i % 2}"><span class="mc-bib-n tnum">${i + 1}</span><div><p class="mc-bib-p">${esc(s.publisher)} <span class="mc-bib-e">${esc(s.evidence)}${s.published && s.published !== "undefined" ? ` · ${esc(s.published)}` : ""}</span></p><p class="mc-bib-t"><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}<span class="sr-only"> (opens in a new tab)</span><span class="mc-ext" aria-hidden="true">↗</span></a></p><p class="mc-bib-u">${esc(s.usedFor)}</p></div></li>`;
    })}</ol>`,
  });

  // §8 FAQ (4). Two answers trimmed to the 45-word limit and to the new
  // side-by-side results (proposed copy, decision 18).
  const FAQ_FIX = {
    "Is this a prediction of my results?": "No. It applies published averages and our stated assumptions to your inputs. The headline is a best case, shown beside the cautious and typical results. You may get fewer subscribers than the cautious figure.",
    "Why does the headline show the strong case?": "It shows what an engaged, growing audience with weekly sharing could reach, using the top values in the research and our stated assumptions. It is far above published creator averages, so we label it a best case and show cautious and typical beside it.",
  };
  const faqs = page.faqs.map((f) => ({ q: f.q, a: FAQ_FIX[f.q] || f.a }));
  const related = page.related.map((p) => `<li>${linkArrow(pageFor(p).navLabel, p)}</li>`).join("");

  return {
    main: [hero, calculator, chart, claim, movesBand, method, why, sources, faqBand(h, { id: "questions", n: 8, items: faqs, relatedHtml: related })].join("\n"),
    title: "Instagram followers to paying clients and subscribers calculator",
    description: page.description,
    calc: true,
    closing: { label: "Estimate my earnings", path: "/earnings-calculator" },
  };
}

export const pages = {
  "/earnings-calculator": earnings,
  "/follower-calculator": followers,
};
