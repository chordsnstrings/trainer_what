// Concept B · audience pages. Owner: the audience page builder.
//   /for-trainers, /for-trainers/* (4), /uae, /get-started, /signup, /login
// Copy follows blueprint C8-C12 and C24 (pending owner approval) and
// content.json for everything else. B treatment: price ladders lead.
import { esc, href, C, pageFor, content, wordCount } from "./core.mjs";
import {
  icon, hl, eyebrow, sectionHead, band, ctaRow, primaryCta, secondaryLink, chip, statusChip, sampleLabel,
  estimateLabel, srcBadge, paymentsNote, val, aed, numberField, addressPreview, faq, statusPanel, statusStrip,
  phone, windowFrame, table, crumbs,
} from "./components.mjs";

/* ===================================================================== */
/* Shared data                                                            */
/* ===================================================================== */
const SESSION = { lo: 70, hi: 350, src: "heytrainer-dubai-2026" }; // one Dubai session, published range
const PRICE_MIN = content.membershipPricing.MEMBERSHIP_MINIMUMS.training / 100; // AED 199
const FLOOR = ["Pain", "Pregnancy", "Chest pain", "Dizziness", "Fainting", "Bleeding"];
const STEPS = content.setupChecklist.map((s) => (s.key === "brain" ? { ...s, label: "Teach your AI" } : s));
const MINUTES = STEPS.reduce((n, s) => n + s.minutes, 0);
const pct = (v, max) => Math.max(0, Math.min(100, (v / max) * 100)).toFixed(2);
/** "your Brain" / "the Brain" in content answers becomes "your AI" (C0 copy rule). */
const ai = (s) => String(s).replace(/\b(?:[Tt]he|[Yy]our) Brain\b/g, (m) => (/^[TY]/.test(m) ? "Your AI" : "your AI")).replace(/outside the AI\b/g, "outside your AI");

/** Per-specialty copy (rules shortened to the 18-word card budget). */
const SPECIALTIES = [
  {
    path: "/for-trainers/weight-loss", short: "Weight loss", mark: "Weight-loss",
    h1: "Weight-loss coaching, taught to your own AI",
    lede: "Teach your rules on training load, adherence and habits. Your AI adapts every plan as subscribers log, and hands you anything outside them.",
    teaser: "Two missed sessions in a week? Keep next week’s volume the same.",
    rules: [
      ["Missed days", "When a subscriber misses two sessions in a week, keep next week’s volume the same."],
      ["Steady progress", "When weekly check-ins show steady progress, keep the plan and add a short conditioning finisher."],
      ["Stalled progress", "No change for three weekly check-ins? Flag the calorie target for review instead of cutting further."],
    ],
  },
  {
    path: "/for-trainers/strength", short: "Strength", mark: "Strength",
    h1: "Strength coaching, taught to your own AI",
    lede: "Teach your progression, deload and technique rules once. Your AI applies them to every lifter’s logged sets, and hands you anything unusual.",
    teaser: "Two sessions at 3+ reps in reserve? Add 2.5 kg to that lift.",
    rules: [
      ["Progress on evidence", "After two sessions at three or more reps in reserve, add 2.5 kg to that lift."],
      ["Technique before load", "When a beginner reports form doubts, repeat the load and add a technique cue."],
      ["Deload", "After three weeks of rising effort at the same load, deload at 60% volume."],
    ],
  },
  {
    path: "/for-trainers/muscle-gain", short: "Muscle gain", mark: "Muscle-gain",
    h1: "Muscle-gain coaching, taught to your own AI",
    lede: "Teach your volume, exercise and recovery rules. Your AI builds each subscriber’s plan around their schedule and equipment, and adjusts volume from their logs.",
    teaser: "Sessions done and recovery good? Add one set per muscle group a week.",
    rules: [
      ["Volume steps", "Add one set per muscle group a week while sessions are completed and recovery is good."],
      ["Equipment swaps", "Machine unavailable? Swap to the approved alternative for the same muscle and rep range."],
      ["Recovery", "When soreness is reported three days running, hold volume for a week."],
    ],
  },
  {
    path: "/for-trainers/pre-postnatal", short: "Pre and postnatal", mark: "postnatal",
    h1: "Pre and postnatal coaching, taught to your AI",
    lede: "Any mention of pregnancy, bleeding, dizziness or chest pain pauses training and comes to you. Routine automation starts only after your clearance step.",
    teaser: "No postnatal programme starts until clearance is confirmed and you’ve reviewed it.",
    rules: [
      ["Clearance first", "No postnatal programme starts until the subscriber confirms medical clearance and you’ve reviewed it."],
      ["Effort cap", "For the first weeks back, keep effort conversational. No breath-holding lifts."],
      ["Postnatal return", "Start with breathing and pelvic floor work before loaded core exercises."],
    ],
  },
].map((s) => ({ ...s, page: pageFor(s.path), price: pageFor(s.path).examplePriceAed }));
const specFor = (path) => SPECIALTIES.find((s) => s.path === path);

/* ===================================================================== */
/* Small components (audience group)                                      */
/* ===================================================================== */
/** Inner-page hero, split: copy left, an object right. */
function hero({ page, eyebrowText, h1, mark, lede, secondary, right, crumb = true, cls = "", extra = "" }) {
  return `<section class="page-hero au-hero ${cls}" data-hero aria-labelledby="h1">
<div class="container au-hero-grid">
  <div class="au-hero-copy">
    ${crumb && page ? crumbs(page, pageFor) : ""}
    ${eyebrow(eyebrowText)}
    <h1 id="h1" class="sweep">${hl(h1, mark)}</h1>
    <p class="lede">${esc(lede)}</p>
    ${ctaRow({ location: "hero", secondary })}
    ${extra}
  </div>
  ${right ? `<div class="au-hero-obj" data-wc-skip>${right}</div>` : ""}
</div>
</section>`;
}

/** Two-bar comparison on one AED scale: one session (range) against a month of your AI coaching. Static. */
function miniAxis(price, max = 400) {
  return `<span class="au-cmp" aria-hidden="true" style="--lo:${pct(SESSION.lo, max)};--hi:${pct(SESSION.hi, max)};--p:${pct(price, max)}">
  <span class="au-cmp-l">1 session</span><span class="au-cmp-track"><span class="au-cmp-range"></span></span><span class="au-cmp-v">AED ${SESSION.lo}–${SESSION.hi}</span>
  <span class="au-cmp-l">Your month</span><span class="au-cmp-track"><span class="au-cmp-bar"></span></span><span class="au-cmp-v">30 days</span>
</span>`;
}

/** Six setup steps as a minutes bar. { here: index marked "You're here", key: highlighted step key } */
function minutesBar(o = {}) {
  const label = `Six steps, about ${MINUTES} minutes: ` + STEPS.map((s) => `${s.label}, ${s.minutes} minute${s.minutes > 1 ? "s" : ""}`).join("; ");
  return `<div class="au-mins${o.cls ? " " + o.cls : ""}">
  <div class="au-mins-track" role="img" aria-label="${esc(label)}">${STEPS.map((s, i) => `<span class="au-mins-seg${s.key === o.key ? " is-key flash" : ""}${o.here === i ? " is-here" : ""}" style="--m:${s.minutes};--i:${i}"><b class="fig">${i + 1}</b></span>`).join("")}</div>
  <ol class="au-mins-legend" aria-hidden="true">${STEPS.map((s, i) => `<li${s.key === o.key ? ' class="is-key"' : o.here === i ? ' class="is-here"' : ""}><b class="fig">${i + 1}</b><span>${esc(s.label)}</span><span class="au-mins-m">${s.minutes} min</span></li>`).join("")}</ol>
</div>`;
}

/** Rule card body pieces. */
const ruleLine = (text) => `<div class="au-rule-line"><span class="chip chip--ink">Your rule</span><span class="au-hl">${esc(text)}</span></div>`;
const outcome = (label, from, to) => `<div class="au-outcome"><span>${esc(label)}</span><span class="fig flash" data-flash-outcome>${from ? `<s>${esc(from)}</s> → ` : ""}${esc(to)}</span></div>`;
const applied = (text, kind = "ok") => `<p class="au-applied au-applied--${kind}">${icon(kind === "ok" ? "check" : "pending")}<span>${esc(text)}</span></p>`;

/** Hero rule card for each specialty: the first rule, applied (start state complete). */
function heroCard(spec) {
  const k = spec.path.split("/").pop();
  let body = "";
  if (k === "strength") {
    body = `<p class="bubble-meta">Back squat · logged sets</p>
<ul class="au-log">
  <li><span>Session 1</span><span class="fig">3 × 5 · 60 kg</span><span class="chip chip--ok chip--plain">3 in reserve</span></li>
  <li><span>Session 2</span><span class="fig">3 × 5 · 60 kg</span><span class="chip chip--ok chip--plain">3 in reserve</span></li>
</ul>
${ruleLine("Two sessions at 3+ in reserve → add 2.5 kg")}
${outcome("Next session", "60 kg", "62.5 kg")}
${applied("Applied automatically. It follows your rule.")}`;
  } else if (k === "weight-loss") {
    const days = [["Mon", "done"], ["Tue", ""], ["Wed", "done"], ["Thu", ""], ["Fri", "missed"], ["Sat", "missed"], ["Sun", ""]];
    body = `<p class="bubble-meta">This week · 4 sessions planned</p>
<ul class="au-week" aria-label="Two sessions done, two missed">${days.map(([d, s]) => `<li class="au-day${s ? " is-" + s : ""}"><span>${d}</span><i aria-hidden="true">${s === "done" ? icon("check") : s === "missed" ? icon("cross") : ""}</i></li>`).join("")}</ul>
${ruleLine("Two missed sessions → hold next week’s volume")}
${outcome("Next week", "+1 set", "Same volume")}
${applied("Applied automatically. It follows your rule.")}`;
  } else if (k === "muscle-gain") {
    body = `<p class="bubble-meta">This week · logged</p>
<div class="au-chips-row"><span class="chip chip--ok chip--plain">Sessions 4 of 4</span><span class="chip chip--ok chip--plain">Recovery: good</span></div>
${ruleLine("All sessions done, recovery good → +1 set per muscle group")}
${outcome("Chest, next week", "12 sets", "13 sets")}
${applied("Applied automatically. It follows your rule.")}`;
  } else {
    body = `<p class="bubble-meta">Subscriber · postnatal</p>
<p class="bubble">My doctor has cleared me for exercise.</p>
${ruleLine("Clearance first: you review before anything starts")}
<div class="au-draft"><div class="au-draft-top"><span class="fine">Draft</span><span class="chip chip--off flash" data-flash-outcome>Waits for me</span></div><p>Postnatal return, week 1: breathing and pelvic floor work.</p><div class="au-draft-act" aria-hidden="true"><span class="au-fakebtn">Approve</span><span class="au-fakebtn au-fakebtn--line">Edit</span></div></div>
${applied("Nothing runs until you confirm it.", "off")}`;
  }
  return `<div class="au-stage">
  <div class="au-stage-label">${sampleLabel()}</div>
  ${windowFrame({ title: k === "pre-postnatal" ? "Inbox · “Waits for me” mode" : "Your AI · decision", cls: "au-rulecard", body })}
</div>`;
}

/** Specialty price ladder (B signature): one session against a month of your AI coaching. */
function priceLadder(spec) {
  const p = spec.price, max = 1000;
  return `<div class="au-ladder tile" data-ladder data-max="${max}">
  <div class="au-rung">
    <span class="au-rung-vis" aria-hidden="true"><i class="au-hour"></i><small>1 hour</small></span>
    <span class="au-rung-copy"><b>One session in Dubai</b><span>An hour, sold once</span></span>
    <span class="au-rung-fig"><span class="fig fig-md">AED ${SESSION.lo}–${SESSION.hi}</span>${srcBadge(SESSION.src)}</span>
  </div>
  <div class="au-rung au-rung--you">
    <span class="au-rung-vis" aria-hidden="true"><span class="au-days">${"<i></i>".repeat(30)}</span><small>30 days</small></span>
    <span class="au-rung-copy"><b>Your AI coaching</b><span>A month, coached every day</span></span>
    <span class="au-rung-fig"><span class="fig fig-md flash" data-flash-ladder>${val(aed(p), { showPrice: 0 })}</span>${statusChip("payments", "subscriber payments")}</span>
  </div>
  <div class="au-ladder-axis" aria-hidden="true" style="--lo:${pct(SESSION.lo, max)};--hi:${pct(SESSION.hi, max)};--p:${pct(p, max)}">
    <span class="au-big-rail"></span><span class="au-big-range"><span>One session</span></span>
    <span class="au-big-mark" data-ladder-mark><b class="fig">${val(aed(p), { showPrice: 0 })}</b><i></i></span>
    <span class="au-big-ticks">${[0, 250, 500, 750, 1000].map((t) => `<span style="--t:${pct(t, max)}">${C.whole(t)}</span>`).join("")}</span>
  </div>
  <div class="au-ladder-foot">
    <div class="pricer au-pricer" data-pricer data-min="${PRICE_MIN}" data-max="999" data-step="10" data-calc-name="ladder_price">
      <button class="pricer-btn" type="button" data-step="-1" aria-label="Lower the example price by AED 10"${p <= PRICE_MIN ? ' aria-disabled="true"' : ""}>${icon("minus")}</button>
      <div class="pricer-out">${val(aed(p), { cls: "fig", attrs: "data-pricer-out", w: "8ch", align: "center" })}<span class="per">try your own price</span></div>
      <button class="pricer-btn" type="button" data-step="1" aria-label="Raise the example price by AED 10">${icon("plus")}</button>
      <input type="hidden" data-sync="price" value="${p}" min="${PRICE_MIN}" max="999">
      <span class="sr-only" aria-live="polite" data-live></span>
    </div>
    <p class="au-ladder-read" data-ladder-read>${p <= SESSION.hi ? "Your price sits inside what one session costs." : "Your price is above one session, and coaches every day."}</p>
  </div>
</div>`;
}

/** Compact follower calculator at the example price (C9 section 7). */
function followerCalc(spec) {
  const fe = C.estimateFollowerConversion({ ...C.DEFAULT_FOLLOWER_INPUTS, priceAed: spec.price });
  const sc = fe.scenarios;
  const name = "follower_" + spec.path.split("/").pop().replace(/-/g, "_");
  return `<div class="au-fc" data-calc="follower" data-calc-name="${name}">
  <div class="au-fc-in reveal">
    <p class="eyebrow">Your numbers</p>
    ${numberField({ label: "Instagram followers", in: "followers", value: 7000, min: 0, max: 10000000, step: 100 })}
    ${numberField({ label: "Your monthly price", in: "price", value: spec.price, min: 1, max: 10000, suffix: "AED", sync: "price" })}
    ${numberField({ label: "Stories with your link each month", in: "stories", value: 8, min: 0, max: 60, help: "Two a week is 8 a month." })}
  </div>
  <div class="au-fc-out card reveal" data-result>
    <div class="chip-row au-fc-labels">${estimateLabel()}${statusChip("payments", "subscriber payments")}</div>
    <p class="au-fc-head"><span class="chip chip--ink">Best case</span> Up to ${val(C.aed(sc.strong.revenueMonth12Minor), { out: "strong.revenue", cls: "fig" })} a month at your price, before platform commission</p>
    <div class="au-scen" role="list">
      ${[["cautious", "Cautious"], ["typical", "Typical"], ["strong", "Best case"]].map(([k, l]) => `<div class="au-scen-col${k === "strong" ? " is-best" : ""}" role="listitem"><span class="au-scen-l">${l}</span>${val(C.aed(sc[k].revenueMonth12Minor), { out: k + ".revenue", cls: "fig au-scen-fig", w: "9ch" })}<span class="au-scen-u">a month at month&nbsp;12 · ${val(C.countLabel(sc[k].activeMonth12), { out: k + ".active" })} subscribers</span></div>`).join("")}
    </div>
    ${paymentsNote()}
    <p class="fine au-fc-fine">A best case for an engaged, growing audience, not a typical result. From published benchmarks and our stated assumptions. ${srcBadge("revenuecat-state-2026")}</p>
    <div class="au-fc-links">${secondaryLink({ label: "How we calculate this", href: "/methodology", location: "calculator" })}${secondaryLink({ label: "Full follower calculator", href: "/follower-calculator", location: "calculator" })}</div>
    <p class="sr-only" aria-live="polite" data-live></p>
  </div>
</div>`;
}

/** Programme outline: a week ruler (visual) plus the real table. */
function programme(sec) {
  const rows = sec.table.rows;
  const spans = rows.map((r) => {
    const m = String(r[0]).match(/(\d+)(?:\s*-\s*(\d+))?/);
    return m ? { a: +m[1], b: +(m[2] || m[1]) } : null;
  });
  const weeks = spans.every(Boolean) ? Math.max(...spans.map((s) => s.b)) : 0;
  const ruler = weeks
    ? `<div class="au-ruler reveal" aria-hidden="true" style="--n:${weeks}">
  <div class="au-ruler-weeks">${Array.from({ length: weeks }, (_, i) => `<span class="fig">${i + 1}</span>`).join("")}</div>
  <div class="au-ruler-track">${rows.map((r, i) => `<span class="au-seg au-seg--${i}" style="--w:${spans[i].b - spans[i].a + 1};--i:${i}"><b>${esc(r[1])}</b></span>`).join("")}</div>
  <p class="au-ruler-cap"><span>Week</span></p>
</div>`
    : `<div class="au-ruler au-ruler--phases reveal" aria-hidden="true">
  <div class="au-ruler-track">${rows.map((r, i) => `<span class="au-seg au-seg--${i}" style="--w:1;--i:${i}"><small>${esc(r[0])}</small><b>${esc(r[1])}</b></span>`).join("")}</div>
</div>`;
  return `${ruler}<div class="reveal au-prog-table">${table({ caption: sec.table.caption, columns: ["Phase", "Focus", "How your AI adapts it"], rows: rows.map((r) => [r[0], r[1], ai(r[2])]) })}</div>`;
}

/** Paused banner on a subscriber phone (reveals below the first screen). */
function pausedPhone() {
  return phone({
    small: true, label: "Sample", ariaLabel: "Sample subscriber screen: training paused, the trainer will review it",
    body: `<div class="au-paused">
  <div class="au-pause-banner" role="note"><span class="au-pause-ic" aria-hidden="true"><i></i><i></i></span><div><b>Training paused</b><span>Layla will review this before you continue.</span></div></div>
  <div class="pt-card"><div class="pt-card-top"><b>Lower body A</b></div><span class="pt-meta">You reported pain · 2 of 4 done</span></div>
  <ul class="pt-list au-pt-dim"><li class="done"><span>Back squat</span><b class="fig">3 × 5</b></li><li class="done"><span>Romanian deadlift</span><b class="fig">3 × 8</b></li><li><span>Split squat</span><b class="fig">—</b></li><li><span>Plank</span><b class="fig">—</b></li></ul>
  <p class="au-pause-note">Not medical advice. Your trainer decides what happens next.</p>
</div>`,
  });
}

/** Budget check at build time (house limits). Logs, never fails the build. */
function budgets(path, html) {
  const strip = (s) => s.replace(/<[^>]+>/g, " ");
  const over = [];
  const each = (re, max, what) => { for (const m of html.matchAll(re)) { const n = wordCount(m[1]); if (n > max) over.push(`${what} ${n}/${max}: ${strip(m[1]).replace(/\s+/g, " ").trim().slice(0, 70)}`); } };
  each(/<h1[^>]*>([\s\S]*?)<\/h1>/g, 8, "H1");
  each(/<h2[^>]*>([\s\S]*?)<\/h2>/g, 6, "H2");
  each(/<p class="lede">([\s\S]*?)<\/p>/g, 25, "lede");
  each(/<div class="acc-inner"><div>([\s\S]*?)<\/div><\/div>/g, 45, "FAQ");
  each(/<p class="au-card-body">([\s\S]*?)<\/p>/g, 18, "card");
  if ((html.match(/<h1[\s>]/g) || []).length !== 1) over.push("H1 count " + (html.match(/<h1[\s>]/g) || []).length);
  if (over.length) console.warn(`[audience] ${path} over budget:\n  ` + over.join("\n  "));
  return html;
}

/* ===================================================================== */
/* /for-trainers (C8)                                                     */
/* ===================================================================== */
function forTrainers(ctx) {
  const page = ctx.page;
  const heroHtml = `<section class="page-hero au-hero au-hero--index" data-hero aria-labelledby="h1">
<div class="container au-index-hero">
  <div>${eyebrow("For trainers")}<h1 id="h1" class="sweep">${hl("Your specialty, taught to your own AI", "specialty")}</h1></div>
  <div class="au-index-hero-r">
    <p class="lede">Every specialty has its own rules, progressions and red flags. Pick yours to see example rules, what always comes to you, and an example price.</p>
    ${ctaRow({ location: "hero", secondary: { label: "Try the demo", href: "/demo" } })}
  </div>
</div>
</section>`;

  const rows = band({
    id: "specialties", labelledby: "spec-h", cls: "au-band-flush",
    inner: `${sectionHead({ eyebrow: "Price ladder", title: "Your specialty, your price", id: "spec-h", row: true, reveal: false,
      after: `<div class="chip-row">${chip("Example prices", "line")}${statusChip("payments", "subscriber payments")}</div>` })}
<ul class="au-lrows reveal" data-stagger>${SPECIALTIES.map((s, i) => `<li><a class="au-lrow" href="${href(s.path)}" data-cta="specialty" data-label="${esc(s.short)}">
  <span class="fig au-lrow-n" aria-hidden="true">${String(i + 1).padStart(2, "0")}</span>
  <span class="au-lrow-main"><h3 class="au-lrow-name">${esc(s.short)}</h3><span class="au-lrow-rule"><span class="au-lrow-k">Example rule</span> <span class="au-lrow-t">${esc(s.teaser)}</span></span></span>
  <span class="au-lrow-ladder">${miniAxis(s.price)}</span>
  <span class="au-lrow-price"><span class="fig fig-band">${aed(s.price)}</span><span class="au-lrow-per">a month, example</span></span>
  <span class="au-lrow-go" aria-hidden="true">${icon("arrow")}</span>
</a></li>`).join("")}</ul>
<p class="fine au-lrows-foot"><span><span class="au-key au-key--range" aria-hidden="true"></span>One session in Dubai, AED ${SESSION.lo}–${SESSION.hi} ${srcBadge(SESSION.src)}</span><span><span class="au-key au-key--pace" aria-hidden="true"></span>A month of your AI coaching, at the example price</span><span>Scale: AED 0–400</span></p>`,
  });

  const routes = [
    { k: "gym", t: "On a gym floor", b: "Your hours are full. See what your followers could be worth each month.", links: [["Follower calculator", "/follower-calculator"]] },
    { k: "online", t: "Already online", b: "Check your AI sounds like you, then check exactly what we take.", links: [["Try the demo", "/demo"], ["See pricing", "/pricing"]] },
    { k: "studio", t: "I run a studio", b: "Invite staff coaches and finance members. You keep the brand and your AI.", links: [["Team features", "/features/team"]] },
  ];
  const glyph = {
    gym: `<span class="au-g au-g--gym" aria-hidden="true">${"<i></i>".repeat(12)}</span>`,
    online: `<span class="au-g au-g--online" aria-hidden="true"><i></i><i></i><i></i></span>`,
    studio: `<span class="au-g au-g--studio" aria-hidden="true"><i></i><i></i><i></i></span>`,
  };
  const how = band({
    id: "how-now", tone: "paper", labelledby: "how-h",
    inner: `${sectionHead({ eyebrow: "Your next step", title: "How do you coach now?", id: "how-h" })}
<div class="cols-3 au-routes reveal" data-stagger>${routes.map((r) => `<div class="card au-route">
  ${glyph[r.k]}
  <h3>${esc(r.t)}</h3><p class="au-card-body">${esc(r.b)}</p>
  <div class="au-route-links">${r.links.map(([l, p]) => secondaryLink({ label: l, href: p, location: "route" })).join("")}</div>
</div>`).join("")}</div>`,
  });

  const uae = band({
    id: "where", labelledby: "where-h",
    inner: `<a class="au-uae reveal" href="uae.html" data-cta="where" data-label="Built for UAE trainers">
  <div><p class="eyebrow">Where you coach</p><h2 id="where-h">Coaching in the UAE</h2><p class="lede">Prices in AED, an app your subscribers can use in English or Arabic, and dates in UAE time.</p></div>
  <ul class="au-uae-facts"><li><span class="fig fig-md">AED</span><span>Your price, set by you</span></li><li><span class="fig fig-md" lang="ar">ع</span><span>English and Arabic for subscribers</span></li><li><span class="fig fig-md">+4</span><span>UAE time zone</span></li></ul>
  <span class="au-uae-go">Built for UAE trainers${icon("arrow")}</span>
</a>`,
  });

  return {
    main: budgets(ctx.path, [heroHtml, rows, how, uae].join("\n")),
    closing: { secondary: { label: "Try the demo", href: "/demo" } },
  };
}

/* ===================================================================== */
/* Specialty pages (C9)                                                   */
/* ===================================================================== */
function specialty(ctx) {
  const page = ctx.page, spec = specFor(ctx.path), k = ctx.path.split("/").pop();
  const sec = (id) => page.sections.find((s) => s.id === id);
  const prenatal = k === "pre-postnatal";

  const heroHtml = hero({
    page, eyebrowText: `For trainers · ${spec.short}`,
    h1: spec.h1, mark: spec.mark, lede: spec.lede,
    secondary: { label: "See the full safety rules", href: "/features/safety" },
    right: heroCard(spec), cls: "au-hero--spec au-hero--" + k,
    extra: `<p class="au-d8 if-d8">${icon("info")}<span>Opens setup with your offer at ${aed(spec.price)} a month. Change it any time.</span></p>`,
  });

  const ladder = band({
    id: "price", tone: "wash", labelledby: "price-h",
    inner: `<div class="au-ladder-grid">
  <div class="reveal">${eyebrow("Price ladder")}<h2 id="price-h">Priced for every follower</h2>
    <p class="lede">One session sells an hour, once. At ${aed(spec.price)} a month, your AI coaching is priced like a single session, and coaches every day.</p>
    ${statusStrip({ href: "get-started.html#status" })}
    <p class="fine au-ladder-note">${aed(spec.price)} is an example. You set your own price in AED, from ${aed(PRICE_MIN)} a month.</p>
  </div>
  <div class="reveal">${priceLadder(spec)}</div>
</div>`,
  });

  const rules = band({
    id: "rules", labelledby: "rules-h",
    inner: `${sectionHead({ eyebrow: "Your rules", title: "Rules you might teach", id: "rules-h", lede: "Three examples. Your AI learns your own wording, reasons and limits; these only show the shape a rule takes." })}
<ol class="cols-3 au-rules reveal" data-stagger>${spec.rules.map(([t, b], i) => `<li class="card au-rule">
  <div class="au-rule-top"><span class="fig au-rule-n">${String(i + 1).padStart(2, "0")}</span>${chip("Illustrative", "line")}</div>
  <h3>${esc(t)}</h3><p class="au-card-body">${esc(b)}</p>
  <span class="au-rule-foot"><span class="chip chip--ink">Your rule</span></span>
</li>`).join("")}</ol>`,
  });

  const floor = band({
    id: "floor", tone: "paper", labelledby: "floor-h",
    inner: `<div class="split split--center au-floor">
  <div class="reveal">${eyebrow("Safety rules it can’t switch off")}<h2 id="floor-h">Always paused, always sent to you</h2>
    <p class="lede">Enforced in code, outside your AI. No prompt or setting can switch it off.</p>
    <ul class="au-flags" aria-label="Always paused">${FLOOR.map((f) => `<li class="chip chip--err">${esc(f)}</li>`).join("")}</ul>
    <h3 class="h4 au-floor-h">In ${esc(spec.short.toLowerCase())} coaching, that includes</h3>
    <ul class="tick-list au-floor-list">${sec("floor").bullets.map((b) => `<li>${icon("pending").replace("<svg", '<svg class="au-ic-err"')}<span>${esc(b)}</span></li>`).join("")}</ul>
    ${secondaryLink({ label: "See the full safety rules", href: "/features/safety", location: "inline" })}
  </div>
  <div class="au-floor-vis reveal">${pausedPhone()}</div>
</div>`,
  });

  const handoffs = band({
    id: "review", labelledby: "review-h",
    inner: `<div class="split split--center au-review">
  <div class="reveal">${eyebrow("Your call")}<h2 id="review-h">Choose what else comes to you</h2>
    <p class="lede">Your AI already hands you anything it isn’t sure about. Add your own red flags and review topics on top.</p></div>
  <div class="reveal">${windowFrame({ title: "Review topics · Sample", cls: "au-topics", body: `<ul class="au-topic-list">${sec("handoffs").bullets.map((b) => `<li><span>${esc(ai(b))}</span><span class="au-switch" aria-hidden="true"></span><span class="sr-only">On</span></li>`).join("")}</ul><p class="fine au-topics-foot">Examples a trainer in this specialty might set. Each one comes to you.</p>` })}</div>
</div>`,
  });

  const prog = band({
    id: "programme", tone: "paper", labelledby: "prog-h",
    inner: `${sectionHead({ eyebrow: "Programme", title: "An example programme outline", id: "prog-h", lede: "Illustrative structure only. You set the length and the content." })}
${programme(sec("programme"))}`,
  });

  const calc = band({
    id: "followers", tone: "wash", labelledby: "fc-h",
    inner: `${sectionHead({ eyebrow: "Follower calculator", title: "What your followers could be worth", id: "fc-h", lede: `Starts at the example price of ${aed(spec.price)}. Change it to yours.` })}
${followerCalc(spec)}`,
  });

  const faqs = page.faqs.map((f) => ({ q: ai(f.q), a: ai(f.a) }));
  if (prenatal) {
    faqs[0] = { q: "Is this safe for pregnant clients?", a: "The platform gives no medical advice. Any mention of pregnancy pauses training and comes to you, enforced in code. Your AI can draft; you approve every decision. Routine automation is only for postnatal return, after your clearance step." };
    faqs.push({ q: "Can my subscribers use it in Arabic?", a: "The subscriber app works in English and Arabic, right to left. Your trainer area is in English, and what you write is shown as you wrote it, never auto-translated." });
  }
  const others = SPECIALTIES.filter((s) => s.path !== spec.path);
  const faqBand = band({
    id: "faq", labelledby: "faq-h", cls: "band-rule",
    inner: `<div class="split au-faq-split">
  <div class="reveal">${eyebrow("Questions")}<h2 id="faq-h">${prenatal ? "Your safety questions" : "Before you start"}</h2></div>
  <div class="reveal">${faq(faqs, { idPrefix: "sq" })}</div>
</div>
<nav class="au-others reveal" aria-label="Other specialties"><p class="eyebrow eyebrow--muted">Other specialties</p><ul>${others.map((s) => `<li><a href="${href(s.path)}"><span>${esc(s.short)}</span><span class="fig">${aed(s.price)}</span><span class="fine">a month, example</span>${icon("arrow")}</a></li>`).join("")}</ul></nav>`,
  });

  return {
    main: budgets(ctx.path, [heroHtml, ladder, rules, floor, handoffs, prog, calc, faqBand].join("\n")),
    closing: { secondary: { label: "See the full safety rules", href: "/features/safety" } },
  };
}

/* ===================================================================== */
/* /uae (C10)                                                             */
/* ===================================================================== */
const AR = {
  today: ["Today", "اليوم"], program: ["Programme", "البرنامج"], programDetail: ["Your plan and training calendar", "خطتك وجدول تدريبك"],
  chat: ["Coach chat", "محادثة المدرب"], chatDetail: ["Messages with your coach", "رسائلك مع مدربك"],
  nutrition: ["Nutrition", "التغذية"], nutritionDetail: ["Meals, groceries and your diary", "الوجبات والتسوّق ويومياتك"],
  progress: ["Progress", "التقدّم"], progressDetail: ["Sessions, sets and personal bests", "الجلسات والمجموعات وأفضل أرقامك"],
  programTab: ["Plan", "الخطة"], chatTab: ["Chat", "المحادثة"],
};
const t2 = (key, tag = "span", cls = "") => `<${tag}${cls ? ` class="${cls}"` : ""} data-en="${esc(AR[key][0])}" data-ar="${esc(AR[key][1])}">${esc(AR[key][0])}</${tag}>`;

function uae(ctx) {
  const page = ctx.page;
  const sec = (id) => page.sections.find((s) => s.id === id);
  const MAX = 2000;
  const payRows = [
    { l: "One-to-one session", u: "per session", lo: 70, hi: 350, txt: "AED 70–350", pub: "Hey Trainer, 2026", src: "heytrainer-dubai-2026" },
    { l: "One-to-one session", u: "per session", lo: 200, hi: 700, open: true, txt: "AED 200–700+", pub: "Embody Fitness, 2025", src: "embody-dubai-2025" },
    { l: "Online coaching", u: "a month", lo: 400, hi: 2000, txt: "AED 400–2,000", pub: "369MMAFIT, 2026", src: "369mmafit-online-2026" },
  ];
  const payChart = `<div class="au-pay tile">
  <div class="tile-head"><p class="eyebrow">What followers pay now</p>${statusChip("payments", "subscriber payments")}</div>
  <div class="au-pay-t" role="table" aria-label="What followers pay now: published Dubai price guides, not official statistics, and your AI coaching">
    <div class="sr-only" role="rowgroup"><div role="row"><span role="columnheader">Service</span><span role="columnheader">Price</span><span role="columnheader">Source</span></div></div>
    <div role="rowgroup">
    ${payRows.map((r, i) => `<div class="au-pay-row" role="row" style="--lo:${pct(r.lo, MAX)};--hi:${pct(r.hi, MAX)};--i:${i}"><div class="au-pay-th" role="rowheader"><b>${esc(r.l)}</b><span>${esc(r.u)}</span></div><div class="au-pay-fig" role="cell"><span class="fig">${esc(r.txt)}</span></div><div class="au-pay-bar" aria-hidden="true"><span class="au-pay-range${r.open ? " is-open" : ""}"></span></div><div class="au-pay-src" role="cell"><span class="fine">${esc(r.pub)}</span>${srcBadge(r.src)}</div></div>`).join("")}
    <div class="au-pay-row au-pay-you" role="row" style="--p:${pct(PRICE_MIN, MAX)}"><div class="au-pay-th" role="rowheader"><b>Your AI coaching</b><span>a month, your price</span></div><div class="au-pay-fig" role="cell"><span class="fig flash" data-flash-pay>From ${aed(PRICE_MIN)}</span></div><div class="au-pay-bar" aria-hidden="true"><span class="au-pay-mark"></span></div><div class="au-pay-src" role="cell"><span class="fine">You set it</span></div></div>
    </div>
  </div>
  <div class="au-pay-axis" aria-hidden="true">${[0, 500, 1000, 1500, 2000].map((t) => `<span style="--t:${pct(t, MAX)}">${C.whole(t)}</span>`).join("")}</div>
  <p class="au-pay-line"><b>Your AI coaching sits in between.</b> <span class="fine">Published Dubai price guides, not official statistics.</span></p>
</div>`;

  const heroHtml = hero({
    page, eyebrowText: "United Arab Emirates", h1: "Built for personal trainers in the UAE", mark: "UAE",
    lede: "AED prices, English and Arabic for your subscribers, and a monthly price your followers can afford. Take your coaching online from here.",
    secondary: { label: "See pricing in AED", href: "/pricing" }, right: payChart, cls: "au-hero--uae",
  });

  const audience = band({
    id: "audience", tone: "paper", labelledby: "aud-h",
    inner: `${sectionHead({ eyebrow: "Your audience", title: "Your audience is already here", id: "aud-h", row: true, lede: "What most trainers lack is not an audience, but an offer followers can afford every month.", after: `<div class="chip-row"><span class="fine">DataReportal, January 2025</span>${srcBadge("datareportal-uae-2025")}</div>` })}
<ul class="au-stats reveal" data-stagger>
  <li><span class="fig fig-band">11.1M</span><b>internet users</b><span>99.0% of the population</span></li>
  <li><span class="fig fig-band">7.60M</span><b>Instagram users</b><span>67.8% of the population</span></li>
  <li><span class="fig fig-band">31.6</span><b>median age</b><span>across the UAE</span></li>
</ul>`,
  });

  const built = band({
    id: "built", labelledby: "built-h",
    inner: `${sectionHead({ eyebrow: "Built for here", title: "Built for how you work", id: "built-h" })}
<ul class="au-built reveal" data-stagger>
  <li><span class="fig au-built-k">AED</span><div><h3>AED pricing</h3><p class="au-card-body">Prices and statements in dirhams. You set the price.</p></div>${chip("Included", "ok")}</li>
  <li><span class="fig au-built-k">IBAN</span><div><h3>UAE bank payouts</h3><p class="au-card-body">Monthly payouts to a verified UAE IBAN.</p></div>${statusChip("payments", "payouts")}</li>
  <li><span class="fig au-built-k" lang="ar">ع</span><div><h3>English and Arabic</h3><p class="au-card-body">Subscribers can use the app in Arabic, right to left.</p></div>${chip("Included", "ok")}</li>
  <li><span class="fig au-built-k">1:1</span><div><h3>In-person bookings</h3><p class="au-card-body">Keep one-to-one sessions as paid bookings with your rules.</p></div>${statusChip("payments", "paid bookings")}</li>
  <li><span class="fig au-built-k">+4</span><div><h3>UAE time zone</h3><p class="au-card-body">Dates and reminders run on UAE time.</p></div>${chip("Included", "ok")}</li>
</ul>`,
  });

  const emirates = band({
    id: "emirates", tone: "paper", labelledby: "em-h",
    inner: `${sectionHead({ eyebrow: "Across the emirates", title: "Dubai, Abu Dhabi and beyond", id: "em-h" })}
<div class="cols-3 au-em reveal" data-stagger>
  <div class="au-em-col"><p class="eyebrow eyebrow--plain">Dubai</p><span class="fig fig-band">2.73M</span><p>took part in Dubai Fitness Challenge 2024.</p><p class="fine">Government of Dubai Media Office ${srcBadge("dubai-fitness-challenge-2024")}</p></div>
  <div class="au-em-col"><p class="eyebrow eyebrow--plain">Abu Dhabi</p><span class="fig fig-band">60.3%</span><p>of residents meet WHO activity standards, up from 53.6%. About 31,000 responses.</p><p class="fine">Abu Dhabi Sports and Physical Activity Survey ${srcBadge("abu-dhabi-activity-survey-2026")}</p></div>
  <div class="au-em-col au-em-col--none"><p class="eyebrow eyebrow--plain">Sharjah, Ajman and the north</p><span class="fig fig-band" aria-hidden="true">—</span><p>We found no published local price data, so we quote none.</p><p class="fine">Online coaching follows subscribers anywhere in the UAE.</p></div>
</div>`,
  });

  const licences = band({
    id: "licences", labelledby: "lic-h",
    inner: `<div class="split au-lic">
  <div class="reveal">${eyebrow("Information only")}<h2 id="lic-h">Licences and permits</h2><p class="lede">What applies depends on how and where you work. Check with the authority before you sell.</p></div>
  <div class="au-lic-list reveal" data-stagger>
    <div class="au-lic-item"><h3>Advertiser permit</h3><p>Reports on the UAE Advertiser Permit say people promoting their own services through personal accounts are exempt. Rules change, so check with the UAE Media Council. This is information, not legal advice.</p><div class="row">${srcBadge("gulfnews-advertiser-permit")}${secondaryLink({ label: "Read the permit guide", href: "/guides/uae-advertiser-permit", location: "inline" })}</div></div>
    <div class="au-lic-item"><h3>Your trainer licence</h3><p>${esc(sec("licensing").body[0].split(". ").slice(0, 2).join(". "))}. This is general information, not legal advice.</p></div>
    <p class="au-lic-note">${icon("info")}<span>trainsyou doesn’t verify credentials.</span></p>
  </div>
</div>`,
  });

  const vignette = phone({
    small: true, rtl: true, label: "Sample · real app strings", ariaLabel: "Sample subscriber app menu for Layla Strength, with an English and Arabic preview",
    body: `<div class="au-app">
  <div class="au-app-head"><span class="po-mono" aria-hidden="true">LS</span><div>${t2("today", "b")}<span class="au-app-coach" dir="auto" lang="en">Layla Strength</span></div></div>
  <div class="au-app-card" dir="auto" lang="en"><b>Lower body A</b><span>45 min · written by Layla</span></div>
  <ul class="au-app-list">${["program", "chat", "nutrition", "progress"].map((key) => `<li><span class="au-app-ic" aria-hidden="true"></span><span class="au-app-t">${t2(key, "b")}${t2(key + "Detail")}</span><span class="au-app-chev" aria-hidden="true">${icon("next")}</span></li>`).join("")}</ul>
  <div class="pt-tabs au-app-tabs"><span class="on">${t2("today")}</span>${t2("programTab")}${t2("progress")}${t2("chatTab")}</div>
</div>`,
  });
  const arabic = band({
    id: "arabic", labelledby: "ar-h",
    inner: `<div class="split split--center au-ar">
  <div class="reveal">${eyebrow("Language")}<h2 id="ar-h">Arabic, honestly</h2>
    <ul class="au-scope">
      <li><span class="chip chip--ok">English and Arabic</span><p><b>Your subscribers’ app.</b> Menus, workouts, chat and account screens, right to left.</p></li>
      <li><span class="chip chip--line">English</span><p><b>Your trainer area.</b> Setup and your workspace are in English.</p></li>
      <li><span class="chip chip--line">As you wrote it</span><p><b>What you write.</b> Plans and messages are never auto-translated.</p></li>
    </ul>
  </div>
  <div class="au-ar-vis reveal">
    <div class="au-langseg" role="group" aria-label="Preview language"><button type="button" aria-pressed="true" data-lang="en">English</button><button type="button" aria-pressed="false" data-lang="ar" lang="ar">العربية</button></div>
    ${vignette}
  </div>
</div>`,
  });

  const ramadan = band({
    id: "ramadan", tone: "paper", labelledby: "ram-h",
    inner: `<div class="split split--center au-ram">
  <div class="reveal">${eyebrow("Ramadan")}<h2 id="ram-h">Ramadan, in your hands</h2>
    <p class="lede">Questions about fasting and meal timing come to you. Your AI never treats fasting as disordered eating.</p>
    <p class="fine">We don’t offer Ramadan programmes. What changes during the month is your call.</p></div>
  <div class="reveal">${windowFrame({ title: "Inbox · Sample", cls: "au-ram-ui", body: `<p class="bubble-meta">Subscriber · nutrition</p><p class="bubble">During Ramadan, when should I eat before training?</p><div class="lane lane--off is-active"><span>Sent to you · fasting and meal timing</span>${icon("pending").replace("<svg", '<svg width="20" height="20"')}</div><p class="au-ram-foot">${icon("check").replace("<svg", '<svg class="icon-ok"')}<span>No reply goes out until you answer.</span></p>` })}</div>
</div>`,
  });

  const faqs = [
    { q: "Do I need a trade licence?", a: ai(page.faqs[0].a) },
    { q: page.faqs[1].q, a: page.faqs[1].a },
    { q: "Do subscribers pay in AED?", a: "Yes. Prices, card payments, statements and payouts are all in AED. Subscriber payments are not on yet; set up and teach your AI now." },
    { q: page.faqs[3].q, a: page.faqs[3].a },
    { q: "Do I need an advertiser permit to promote my own coaching?", a: pageFor("/faq").faqs.find((f) => /advertiser permit/.test(f.q)).a },
  ];
  const faqBand = band({
    id: "faq", labelledby: "faq-h", cls: "band-rule",
    inner: `<div class="split au-faq-split"><div class="reveal">${eyebrow("Questions")}<h2 id="faq-h">UAE questions</h2></div><div class="reveal">${faq(faqs, { idPrefix: "uq" })}</div></div>`,
  });

  return {
    main: budgets(ctx.path, [heroHtml, audience, built, emirates, licences, arabic, ramadan, faqBand].join("\n")),
    title: "Take your coaching online in the UAE · trainsyou",
    description: "For UAE personal trainers who want to take your coaching online: AED pricing, English and Arabic for subscribers, and a monthly price followers can afford.",
    head: `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600&display=swap">`,
    closing: { secondary: { label: "See pricing in AED", href: "/pricing" } },
  };
}

/* ===================================================================== */
/* /get-started (C11)                                                     */
/* ===================================================================== */
function getStarted(ctx) {
  const page = ctx.page;
  const sec = (id) => page.sections.find((s) => s.id === id);

  const heroRight = `<div class="au-gs-card tile">
  <div class="tile-head"><p class="eyebrow">15 minutes to your offer</p>${chip("Starter setup", "line")}</div>
  <p class="au-gs-total"><span class="fig fig-take">${MINUTES}</span><span>minutes, in six steps.<br>Save and come back any time.</span></p>
  ${minutesBar({ key: "plan" })}
  <p class="au-gs-key"><span class="au-key au-key--pace" aria-hidden="true"></span>Step 5 sets your offer and your price.</p>
</div>`;

  const heroHtml = `<section class="page-hero au-hero au-hero--gs" data-hero aria-labelledby="h1">
<div class="container au-hero-grid">
  <div class="au-hero-copy">
    ${eyebrow("Get started")}
    <h1 id="h1" class="sweep">${hl("Start your coaching business, free", "free")}</h1>
    <p class="lede">${esc(page.lede)}</p>
    ${ctaRow({ location: "hero", secondary: { label: "See how it works", href: "/how-it-works" } })}
    <div class="au-early if-reg-closed" id="early-access">${earlyAccessForm("gs")}</div>
  </div>
  <div class="au-hero-obj au-gs-side">
    <div data-wc-skip>${heroRight}</div>
    <div class="au-claim card">
      <p class="h4">Claim your coaching address</p>
      ${addressPreview({ id: "addr-gs", location: "hero", hint: "We'll check it's free in setup." })}
    </div>
  </div>
</div>
</section>`;

  const steps = band({
    id: "steps", tone: "paper", labelledby: "steps-h",
    inner: `${sectionHead({ eyebrow: "The setup", title: `Six steps, about ${MINUTES} minutes`, id: "steps-h", lede: sec("checklist").body[0] })}
<ol class="au-steps reveal" data-stagger>${STEPS.map((s, i) => {
      const key = s.key === "plan";
      const extra = key
        ? `<div class="au-step-price">
  <div class="pricer au-pricer" data-pricer data-min="${PRICE_MIN}" data-max="999" data-step="10" data-calc-name="setup_price">
    <button class="pricer-btn" type="button" data-step="-1" aria-label="Lower your price by AED 10" aria-disabled="true">${icon("minus")}</button>
    <div class="pricer-out"><span class="flash" data-flash-step>${val(aed(PRICE_MIN), { cls: "fig", attrs: "data-pricer-out", w: "8ch", align: "center" })}</span><span class="per">your price, a month</span></div>
    <button class="pricer-btn" type="button" data-step="1" aria-label="Raise your price by AED 10">${icon("plus")}</button>
    <input type="hidden" data-sync="price" value="${PRICE_MIN}" min="${PRICE_MIN}" max="999">
    <span class="sr-only" aria-live="polite" data-live></span>
  </div>
  <p class="au-step-share">At ${val(aed(PRICE_MIN), { showPrice: 0 })}, our share is 25% for your first 100 subscribers. We earn only when your subscribers pay. ${statusChip("payments", "subscriber payments")}</p>
</div>`
        : s.key === "live" ? `<div class="chip-row">${statusChip("publish", "publishing")}</div>`
        : s.key === "brain" ? `<p class="au-step-note">Every reply waits for you until automatic sending is on. That needs 20 cases and passing checks.</p>` : "";
      return `<li class="au-step${key ? " au-step--key" : ""}">
  <span class="fig au-step-n">${String(i + 1).padStart(2, "0")}</span>
  <div class="au-step-main"><h3>${esc(s.label)}</h3><p>${esc(ai(s.summary))}</p>${extra}</div>
  <div class="au-step-time"><span class="fig">${s.minutes}</span><span>min</span><span class="au-step-bar" style="--m:${s.minutes}" aria-hidden="true"></span></div>
</li>`;
    }).join("")}</ol>`,
  });

  const dont = ["A card", "A trade licence to start", "A minimum number of followers", "Coding skills", "Your own domain"];
  const need = band({
    id: "need", labelledby: "need-h",
    inner: `${sectionHead({ eyebrow: "Before you start", title: "What you need, and don’t", id: "need-h" })}
<div class="cols-2 au-need reveal" data-stagger>
  <div class="card au-need-yes"><h3>You’ll need</h3><ul class="tick-list">${sec("need").bullets.map((b) => `<li>${icon("check").replace("<svg", '<svg class="icon-ok"')}<span>${esc(b)}</span></li>`).join("")}</ul></div>
  <div class="card card--paper au-need-no"><h3>You won’t need</h3><ul class="au-strikes">${dont.map((d, i) => `<li style="--i:${i}"><span class="strike">${esc(d)}</span></li>`).join("")}</ul></div>
</div>`,
  });

  const status = band({
    id: "status-band", tone: "wash", labelledby: "status-h",
    inner: `${sectionHead({ eyebrow: "Status", title: "Live today, and not on yet", id: "status-h" })}<div class="reveal">${statusPanel({ id: "status" })}</div>`,
  });

  const after = band({
    id: "after", labelledby: "after-h",
    inner: `${sectionHead({ eyebrow: "After you go live", title: "Once your page is live", id: "after-h", row: true, after: `<div class="chip-row">${chip("Follows go-live", "line")}${statusChip("publish", "publishing")}</div>` })}
<div class="au-after reveal" data-stagger>
  <div class="au-after-col"><p class="eyebrow eyebrow--plain">At launch</p><ul class="tick-list">${sec("launch").bullets.map((b) => `<li>${icon("check").replace("<svg", '<svg class="icon-ok"')}<span>${esc(ai(b))}</span></li>`).join("")}</ul></div>
  <div class="au-after-line" aria-hidden="true"><span>Go live</span></div>
  <div class="au-after-col"><p class="eyebrow eyebrow--plain">After launch</p><ul class="tick-list">${sec("after").bullets.map((b) => `<li>${icon("check").replace("<svg", '<svg class="icon-ok"')}<span>${esc(ai(b))}</span></li>`).join("")}</ul></div>
</div>`,
  });

  const faqs = page.faqs.map((f) => ({ q: f.q, a: ai(f.a) }));
  const faqBand = band({
    id: "faq", labelledby: "faq-h", cls: "band-rule",
    inner: `<div class="split au-faq-split"><div class="reveal">${eyebrow("Questions")}<h2 id="faq-h">Setup, answered</h2></div><div class="reveal">${faq(faqs, { idPrefix: "gq" })}</div></div>`,
  });

  return {
    main: budgets(ctx.path, [heroHtml, steps, need, status, after, faqBand].join("\n")),
    title: "Get started · How to start online personal training in the UAE · trainsyou",
    closing: { secondary: { label: "See how it works", href: "/how-it-works" } },
  };
}

/* ===================================================================== */
/* Early-access form (registration closed)                                */
/* ===================================================================== */
function earlyAccessForm(p) {
  return `<form class="au-ea" data-au-early novalidate>
  <p class="h4">Sign-up opens soon</p>
  <p class="fine">Join early access and keep your place. We’ll tell you here when sign-ups reopen.</p>
  <div class="field"><label for="${p}-ea-name">Your name</label><input id="${p}-ea-name" name="name" type="text" autocomplete="name" required maxlength="120"></div>
  <div class="field"><label for="${p}-ea-email">Email</label><input id="${p}-ea-email" name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck="false" required maxlength="254" dir="ltr"></div>
  <div class="field"><label for="${p}-ea-ig">Instagram handle <span class="muted">(optional)</span></label><input id="${p}-ea-ig" name="instagram" type="text" autocomplete="off" maxlength="31" placeholder="@yourname" dir="ltr"></div>
  <label class="check"><input type="checkbox" name="consent" required><span>You can contact me about early access.</span></label>
  <p class="au-err" data-err hidden role="alert"></p>
  <button class="btn btn--block" type="submit">Join early access — free${icon("arrow")}</button>
  <p class="au-done" data-done hidden role="status"></p>
</form>`;
}

/* ===================================================================== */
/* /signup (C12, protected: copy pending owner approval)                  */
/* ===================================================================== */
function signup() {
  const ticks = ["Free to join, no card.", "About 15 minutes to start; stop any time.", "Nothing goes live until you publish."];
  const main = `<section class="au-auth au-signup" aria-labelledby="h1">
<div class="container au-auth-grid">
  <div class="au-auth-story">
    ${eyebrow("Free to join")}
    <h1 id="h1">Teach your AI.<br> <span class="mk-mark">Start free.</span></h1>
    <ul class="au-ticks">${ticks.map((t) => `<li>${icon("check")}<span>${esc(t)}</span></li>`).join("")}</ul>
  </div>
  <div class="au-auth-card card card--raised">
    <div class="if-reg-open">
      <h2 class="h3">Start coaching</h2>
      <p class="au-auth-sub"><span>Free</span><span>No card</span><span>Nothing goes live until you publish</span></p>
      <div class="chip-row au-carried" data-carried hidden>
        <span class="chip chip--line chip--plain au-slug" data-slug-chip hidden>${icon("lock")}<span><b class="ltr" data-slug-out>your-name</b>.trainsyou.com — we’ll check it’s free in setup</span></span>
        <span class="chip chip--pace au-price-chip if-d8" data-price-chip hidden>Your price: <b data-price-out>AED 199</b></span>
      </div>
      <form class="au-form" data-signup novalidate>
        <div class="field"><label for="su-name">Your name</label><input id="su-name" name="name" type="text" autocomplete="name" required minlength="2" maxlength="120" aria-describedby="su-name-e"><p class="au-ferr" id="su-name-e" data-ferr hidden></p></div>
        <div class="field"><label for="su-email">Email address</label><input id="su-email" name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck="false" required dir="ltr" aria-describedby="su-email-e"><p class="au-ferr" id="su-email-e" data-ferr hidden></p></div>
        <div class="field"><label for="su-pass">Password</label>
          <div class="au-pass"><input id="su-pass" name="password" type="password" autocomplete="new-password" required minlength="12" aria-describedby="su-pass-h su-pass-e"><button type="button" class="au-reveal-pw" data-pw-toggle aria-pressed="false" aria-label="Show password">Show</button></div>
          <p class="au-pw-help" id="su-pass-h" data-pw-help><span class="au-pw-dot" aria-hidden="true"></span><span data-pw-text>At least 12 characters.</span></p>
          <p class="au-ferr" id="su-pass-e" data-ferr hidden></p>
        </div>
        <label class="check au-legal"><input type="checkbox" id="su-legal" name="accepted" required aria-describedby="su-legal-e"><span>I accept the <a href="terms.html" target="_blank" rel="noopener">terms of service</a>, <a href="privacy.html" target="_blank" rel="noopener">privacy policy</a> and <a href="ai-disclosure.html" target="_blank" rel="noopener">digital coaching disclosure</a>.</span></label>
        <p class="au-ferr" id="su-legal-e" data-ferr hidden></p>
        <input type="hidden" name="slug" value=""><input type="hidden" name="price_aed" value=""><input type="hidden" name="source" value="">
        <button class="btn btn--block au-submit" type="submit">Start my setup${icon("arrow")}</button>
        <div class="au-done au-done--signup" data-done hidden role="status" tabindex="-1">${icon("check")}<div><b>Your account is ready.</b><span>Setup opens at step 2, About you. Prototype: nothing was sent.</span></div></div>
      </form>
      <p class="au-auth-alt">Already have a coaching space? <a href="login.html">Sign in</a></p>
    </div>
    <div class="if-reg-closed" id="early-access">${earlyAccessForm("su")}</div>
  </div>
  <div class="au-auth-next">
    <p class="eyebrow eyebrow--muted">What happens next</p>
    ${minutesBar({ here: 0, key: "plan", cls: "au-mins--sm" })}
    <p class="fine">Step 1 is this form. Then about you, your page, teaching your AI, your offer and price, and your launch checks.</p>
  </div>
</div>
</section>`;
  return { main: budgets("/signup", main), sticky: false, closing: false, title: "Create your trainer account · trainsyou" };
}

/* ===================================================================== */
/* /login (C24: unchanged)                                                */
/* ===================================================================== */
function login() {
  const main = `<section class="au-auth au-login" aria-labelledby="h1">
<div class="container container--narrow au-login-wrap">
  <div class="au-auth-card card card--raised au-login-card">
    <h1 id="h1" class="h2">${hl("Sign in", "Sign in")}</h1>
    <p class="muted au-login-intro">Welcome back. Sign in with the email address you use for coaching.</p>
    <form class="au-form" data-login novalidate>
      <div class="field"><label for="li-email">Email address</label><input id="li-email" name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck="false" enterkeyhint="next" required dir="ltr"></div>
      <div class="field"><label for="li-pass">Password</label><input id="li-pass" name="password" type="password" autocomplete="current-password" enterkeyhint="go" required></div>
      <p class="au-login-forgot"><button type="button" class="au-textbtn" data-proto-note="Prototype: this opens the password reset page.">Forgot your password?</button></p>
      <p class="au-err" data-err hidden role="alert"></p>
      <button class="btn btn--block" type="submit">Sign in${icon("arrow")}</button>
      <p class="au-done" data-done hidden role="status"></p>
    </form>
    <div class="au-login-alt" role="group" aria-label="Other ways to sign in">
      <button type="button" class="btn btn--secondary btn--block" data-proto-note="Prototype: your device would ask for your passkey.">Sign in with a passkey</button>
      <button type="button" class="btn btn--ghost btn--block" data-proto-note="Prototype: this opens the sign-in link page.">Email me a sign-in link</button>
      <button type="button" class="au-textbtn" data-proto-note="Prototype: this opens recovery-code sign-in.">Lost your authenticator app? Use a recovery code</button>
    </div>
    <p class="au-auth-alt if-reg-open">Are you a coach? <a href="signup.html" data-cta="login">Create your coaching space</a></p>
  </div>
</div>
</section>`;
  return { main: budgets("/login", main), sticky: false, closing: false, title: "Sign in · trainsyou" };
}

export const pages = {
  "/for-trainers": forTrainers,
  "/for-trainers/weight-loss": specialty,
  "/for-trainers/strength": specialty,
  "/for-trainers/muscle-gain": specialty,
  "/for-trainers/pre-postnatal": specialty,
  "/uae": uae,
  "/get-started": getStarted,
  "/signup": signup,
  "/login": login,
};
