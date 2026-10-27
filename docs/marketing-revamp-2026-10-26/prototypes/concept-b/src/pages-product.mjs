// Concept B · product pages: /how-it-works, /trainer-brain, /features,
// the 11 /features/* pages, /demo and /security-and-privacy.
// Owner: the product page builder. Copy follows blueprint C2–C7 (pending
// owner approval) and content.json; styles in assets/product.css, scripts
// in assets/product.js. Every sample is labelled; no invented proof.
import { esc, href, C, pageFor } from "./core.mjs";
import {
  icon, hl, eyebrow, sectionHead, band, ctaRow, secondaryLink, chip, statusChip, offeringChip, sampleLabel,
  paymentsNote, statusStrip, val, aed, faq, phone, windowFrame, offerScreen, todayScreen, constraintList,
  statement, takeHomeTile, table, crumbs, ext,
} from "./components.mjs";
import { dayBand, dayAssets, playground, playAssets, merge, hourTag } from "./brain-showcase.mjs";

/* ===================================================================== */
/* Copy helpers: grade-6 vocabulary (C0) and word budgets                 */
/* ===================================================================== */
const VOCAB = [
  [/(?:your )?held-out scenarios/g, "your test cases"], [/held-out situations/g, "test cases"], [/Held-out test scenarios/g, "Your test cases"],
  [/your confidence threshold/gi, "how sure it must be"], [/confidence threshold/g, "how sure it must be"],
  [/[Mm]arginal bands of/g, "our share for each group of subscribers:"], [/[Ss]afety floor/g, "safety rules it can't switch off"],
  [/“Available soon”/g, "“Not on yet”"], [/Available soon/g, "Not on yet"], [/trainsyou learns/g, "Your AI learns"],
  [/\bthe Brain\b/g, "your AI"], [/\bThe Brain\b/g, "Your AI"], [/\byour Brain\b/g, "your AI"], [/\bYour Brain\b/g, "Your AI"],
  [/against your scenarios/g, "against your test cases"], [/anything below your threshold/g, "anything it isn’t sure enough about"], [/your Trainer Brain/g, "your AI"], [/Your Trainer Brain/g, "Your AI"], [/a Trainer Brain/g, "your AI"],
];
/** Apply the plain-words replacements to any content string. */
const fix = (s) => VOCAB.reduce((t, [a, b]) => t.replace(a, b), String(s ?? ""));
/** Headings: "AI" always belongs to someone. */
const qfix = (s) => fix(s).replace(/\b[Tt]he AI\b/g, "your AI").replace(/^your AI/, "Your AI").replace(/\ban AI\b/g, "your AI");
const words = (s) => String(s ?? "").replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
let CUR = "";
/** Build-time budget check (C0 copy rules): prints a warning, never fails. */
function budget(what, text, max) {
  const n = words(text);
  if (n > max) console.warn(`  budget ${CUR} · ${what}: ${n} words (max ${max}) · "${String(text).replace(/<[^>]+>/g, "").slice(0, 64)}"`);
}

/* ===================================================================== */
/* Layout helpers                                                         */
/* ===================================================================== */
/** Section header with H2 (≤6 words) and lede (≤25) budgets. */
function head(o) {
  budget("H2", o.title, 6);
  if (o.lede) budget("lede", o.lede, 25);
  return sectionHead(o);
}
/** Inner-page hero: eyebrow, H1 (Pace sweep on one word), chips, lede, CTA row, visual. */
function hero(o) {
  budget("H1", o.h1, 8);
  budget("lede", o.lede, 25);
  return `<section class="page-hero ph${o.cls ? " " + o.cls : ""}" data-hero aria-labelledby="h1">
<div class="container ph-grid${o.visual ? "" : " ph-grid--solo"}">
  <div class="ph-copy">
    ${o.crumbs || ""}${eyebrow(o.eyebrow)}
    <h1 id="h1" class="sweep">${hl(o.h1, o.mark)}</h1>
    ${o.chips ? `<div class="chip-row ph-chips">${o.chips}</div>` : ""}
    <p class="lede">${o.ledeHtml || esc(o.lede)}</p>
    ${ctaRow({ location: "hero", secondary: o.secondary })}
    ${o.after || ""}
  </div>
  ${o.visual ? `<div class="ph-visual" data-wc-skip>${o.visual}</div>` : ""}
</div>
</section>`;
}
/** Paper stage behind a product object (ruled like the home hero stage). */
const stage = (inner, o = {}) =>
  `<div class="p-stage${o.cls ? " " + o.cls : ""}">${o.label === false ? "" : `<div class="p-stage-label">${sampleLabel(o.label)}</div>`}${inner}</div>`;
/** FAQ items with fixed vocabulary and the 45-word budget. */
function faqList(items, prefix) {
  const fixed = items.map((it) => (it.html ? { q: qfix(it.q), html: it.html } : { q: qfix(it.q), a: fix(it.a) }));
  fixed.forEach((it) => (it.a ? [it.a] : it.html.split("</span>")).forEach((t) => budget("FAQ", t, 45)));
  return faq(fixed, { idPrefix: prefix });
}
/** FAQ band (left heading, right accordion). */
function faqBand(items, prefix, title = "Questions, answered", extra = "") {
  budget("H2", title, 6);
  return band({
    id: "faq", labelledby: "faq-h", cls: "band-rule",
    inner: `<div class="split p-faq"><div class="reveal">${eyebrow("Questions")}<h2 id="faq-h">${esc(title)}</h2>${extra}</div><div class="reveal">${faqList(items, prefix)}</div></div>`,
  });
}
/** Pick FAQs from a page by a question pattern, in the order given. */
const pickFaqs = (page, patterns) => patterns.map((re) => page.faqs.find((f) => re.test(f.q))).filter(Boolean);
/** Small tick / cross / pending list. */
const ticks = (items, kind = "check") =>
  `<ul class="tick-list">${items.map((t) => `<li>${icon(kind).replace("<svg", `<svg class="${kind === "check" ? "icon-ok" : "icon-" + kind}"`)}<span>${esc(fix(t))}</span></li>`).join("")}</ul>`;
/** Window title bar + body (trainer workspace). */
const win = (title, body, cls = "") => windowFrame({ title, body, cls: "mw" + (cls ? " " + cls : "") });
/** A labelled setting row inside a window. */
const mrow = (label, value, extra = "") => `<div class="mw-row"><span>${esc(label)}</span><b>${value}</b>${extra}</div>`;
/** Phone url pill drawn inside a screen layer. */
const purl = (u) => `<div class="mp-url">${icon("lock")}<span>${esc(u)}</span></div>`;
/** Two stacked values that crossfade when the vignette plays (state A → B). */
const swap = (a, b, cls = "") => `<span class="sw2${cls ? " " + cls : ""}"><span data-a>${a}</span><span data-b aria-hidden="true">${b}</span></span>`;
/** Animated tick (stroke-dashoffset) used when a state change lands. */
const tickDraw = () => `<svg class="tick-draw" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="currentColor" opacity=".14"/><path d="m5.8 10.3 2.8 2.8 5.6-6" pathLength="1"/></svg>`;
/** Status chips for a feature page: offering + one "Not on yet" per live-off flag. */
function featureChips(page) {
  const a = page.availability || [];
  const out = [offeringChip(page.offering)];
  if (a.includes("payments") || a.includes("payouts")) out.push(statusChip("payments", page.path.includes("bookings") ? "paid bookings" : "subscriber payments"));
  if (a.includes("voice")) out.push(statusChip("voice", "for subscribers"));
  return out.join("");
}

/* ---------------------------------------------------------------------- */
/* Capability registry (packages/contracts/src/marketing-features.ts),     */
/* copied verbatim except the grade-6 vocabulary. Live availability:       */
/* model and whoop on; payments, payouts, voice, zepp, customDomains and   */
/* instagram off; nutrition is an Optional tier shown by its offering.     */
/* ---------------------------------------------------------------------- */
const M = ["model"], P = ["payments"], NUT = { availability: ["nutrition"], offering: "Optional tier" }, VOI = { availability: ["voice"], offering: "Add-on" };
const FEATURE_MATRIX = [
  { id: "brain", title: "Your Trainer Brain", audience: "You", page: "/trainer-brain", items: [
    ["Guided coaching interview", "Explain what you recommend, why, the alternatives and what changes your answer."],
    ["Rules in plain language", "Confirm, edit or reject each rule; every rule keeps its source.", M],
    ["Coaching cases and examples", "Teach real decisions, not just principles."],
    ["Your own documents", "Import your material and review the extracted text privately before it is used.", M],
    ["Conflict resolution", "When two sources disagree, you decide which rule wins.", M],
    ["Your test cases", "Start supervised with 8 quiz answers and 3 own cases. Automatic sending requires 20 cases and passing checks."],
    ["Evaluation before release", "Every version is tested against your scenarios before it can go live.", M],
    ["Versioned releases and rollback", "Publish a version, compare it, and roll back at any time.", M],
    ["How sure it must be", "You choose which routine changes run automatically; the rest comes to you.", M],
    ["Learning from corrections", "Your approvals, corrections and subscriber outcomes become teaching for the next release.", M],
  ] },
  { id: "training", title: "Plans and workouts", audience: "You and your subscribers", page: "/features/ai-training-plans", items: [
    ["A personalised, dated plan", "Built by your AI from each subscriber’s goals, schedule, experience and equipment.", M],
    ["Adapts as they train", "Progressions, missed sessions and swaps follow your confirmed rules.", M],
    ["Hand-off when unsure", "Low-confidence decisions come to you as a draft to approve or correct.", M],
    ["Programme templates", "Write programmes yourself with the exercise library and assign them."],
    ["Automatic calendar", "Assigned programmes are scheduled by date, with rest days kept."],
    ["Move or skip a session", "Subscribers reschedule within your rules."],
    ["Guided session", "Exercise cues, sets, targets and rest timers, one step at a time.", P],
    ["Set logging", "Reps, load, effort and notes for every set, with corrections kept in history.", P],
    ["Approved swaps", "Subscribers can swap only to alternatives you approved.", P],
    ["Offline in the gym", "A workout opened online keeps working offline and syncs later.", P],
    ["One-tap pain report", "Pauses the workout and alerts you straight away."],
    ["Workout reminders", "Reminders, programme-ready and missed-session messages.", P],
  ] },
  { id: "nutrition", title: "Nutrition tier", audience: "You and your subscribers", page: "/features/nutrition", items: [
    ["Weekly meal plans", "Built from your recipes, rules and each subscriber’s targets and preferences.", NUT],
    ["Recipe options and swaps", "Only the swaps your teaching allows.", NUT],
    ["Grocery lists", "A consolidated shopping list for the week.", NUT],
    ["Pantry and leftovers", "Plans that use what the subscriber already has.", NUT],
    ["Food diary", "With favourites, copied meals and corrections.", NUT],
    ["Meal photo estimates", "Foods and portions estimated from a photo, confirmed by the subscriber.", NUT],
    ["Barcode lookup", "Packaged foods read by barcode, confirmed before logging.", NUT],
    ["Weekly check-ins", "Progress against the targets you set.", NUT],
    ["Your nutrition teaching", "Cases, recipes and calorie methods, evaluated before release.", NUT],
    ["Exceptions queue", "Decisions outside your rules come to you.", NUT],
  ] },
  { id: "voice", title: "Voice add-on", audience: "You and your subscribers", page: "/features/voice-coach", items: [
    ["Sessions in your own voice", "Personal narration in your coaching style, from your verified voice and approved plan.", VOI],
    ["Members’ own music", "Short cues and tap-to-talk while members play their own music app, subject to device playback rules.", VOI],
    ["Verified and consented", "Identity verification and your separate, recorded consent, which you can withdraw.", VOI],
    ["Only your subscribers", "Used only for your own subscribers who add it, never for another trainer’s.", VOI],
  ] },
  { id: "coaching", title: "Chat, progress and data", audience: "You and your subscribers", page: "/features/chat-and-digital-coach", items: [
    ["Private chat with you", "One thread per subscriber, with photo and PDF attachments."],
    ["Labelled digital coach", "Answers from your published teaching and is always labelled as digital.", [...M, ...P]],
    ["Personal takeover", "Take over a subscriber and the digital coach steps back."],
    ["Scheduled follow-ups", "Check-in messages sent when you plan them.", P],
    ["Client Twin", "Goals, preferences and history in one coaching context, each with its date and source."],
    ["Progress page", "Completed sessions, training volume and best loads per exercise."],
    ["Apple Health import", "Subscribers can import an Apple Health export."],
    ["WHOOP connection", "Shared only with the subscriber’s permission and your policy.", ["whoop"]],
    ["Amazfit / Zepp connection", "Shared only with the subscriber’s permission and your policy.", ["zepp"]],
    ["Notifications and quiet hours", "An in-app inbox with preferences."],
  ] },
  { id: "bookings", title: "Bookings", audience: "You and your subscribers", page: "/features/bookings", items: [
    ["Session slots", "One-off or weekly slots with capacity."],
    ["Paid one-to-one sessions", "Card payment in AED at booking.", P],
    ["Cancellation rules", "Your window decides refunds automatically.", P],
    ["Attendance and no-shows", "Tracked per booking.", P],
    ["Calendar export", "Bookings in the subscriber’s own calendar."],
  ] },
  { id: "brand", title: "Your brand, website and app", audience: "You", page: "/features/website-and-domain", items: [
    ["Desktop visual website editor", "Drag and drop sections, create multiple pages and manage navigation."],
    ["Section template library", "282 layouts across 40 families, including heroes, videos, programmes, pricing, FAQs and contact forms."],
    ["AI starter sites", "AI assembles existing modules into an editable starter. Manual templates work without AI.", M],
    ["Before-and-after galleries", "Paired client transformation photos and captions, using material you have permission to publish."],
    ["Separate website and app styles", "Set website colours and typography independently from your member app."],
    ["Draft recovery", "Autosave, undo and redo, reusable sections and publication history. Restore to a draft before republishing."],
    ["Coaching website", "Responsive pages, videos, photo galleries and a contact form whose messages reach your inbox."],
    ["Private preview", "Preview desktop, tablet and phone layouts before publishing."],
    ["Your coaching address", "Reserved the moment you sign up."],
    ["Your own domain, bought for you", "Bought and renewed automatically, with the cost on your statement.", ["customDomains"]],
    ["Connect a domain you own", "Point an existing domain at your website.", ["customDomains"]],
    ["Installable app", "Subscribers add your app to their home screen with your name and icon."],
    ["Search titles and descriptions", "Set how your pages appear in search results."],
    ["Coach directory listing", "Optional: appear in the public directory of coaches."],
    ["English and Arabic member controls", "Core member screens support Arabic and right-to-left layouts. Coach content and marketing pages are not automatically translated."],
  ] },
  { id: "money", title: "Offers, payments and payouts", audience: "You", page: "/features/payments-and-payouts", items: [
    ["Two tiers", "Workout, or workout and nutrition, each at your price."],
    ["Your price in AED", "With the programme length you choose.", P],
    ["Monthly or upfront billing", "Bill the whole programme upfront, or month by month.", P],
    ["Trials and promotion codes", "Free trial days and codes when you want them.", P],
    ["Card checkout", "Through Stripe, with receipts and billing history for subscribers.", P],
    ["Refund decisions", "Requests you approve or decline, reconciled with the payment provider.", P],
    ["Transparent commission", "Our share for each group of subscribers: 25%, 20%, 15% and 10%."],
    ["Monthly statement", "From gross revenue to net, every cost itemised."],
    ["Ledger export", "Your ledger as a CSV file."],
    ["Monthly payouts", "To a verified UAE IBAN.", ["payouts"]],
  ] },
  { id: "growth", title: "Growth", audience: "You", page: "/follower-calculator", items: [
    ["Follower calculator", "A strong case (a best case, not typical) with cautious and typical scenarios, from cited benchmarks and stated assumptions, with every assumption shown."],
    ["Connect Instagram", "Professional accounts fill the calculator with real numbers; access is not kept.", ["instagram"]],
    ["Tagged share links", "Links for your bio and Stories, so you see which ones bring visitors."],
    ["Consented visitor sources", "Where visitors came from, only when they allowed analytics."],
    ["Invite links", "Invite subscribers you already coach."],
    ["Website inquiries", "Contact-form messages in one inbox."],
  ] },
  { id: "trust", title: "Safety, privacy and team", audience: "You and your subscribers", page: "/features/safety", items: [
    ["Safety rules it can't switch off", "Pain, pregnancy and red flags pause training and come to you, whatever the settings."],
    ["Your own red flags", "Add terms that also pause training, and topics that come to you for review."],
    ["Escalation", "Unreviewed safety holds escalate until someone decides."],
    ["AI disclosure", "Accepted when subscribers join; digital replies are always labelled."],
    ["Workspace isolation", "Every workspace is separated at the database layer."],
    ["Strong sign-in", "Authenticator apps, passkeys and recovery codes."],
    ["Team roles", "Staff coaches without finance access; finance without coaching data."],
    ["Consent choices", "Separate choices for coaching data, marketing and analytics."],
    ["Export and deletion", "Trainers and subscribers can download their data and request deletion."],
  ] },
].map((g) => ({ ...g, items: g.items.map(([name, detail, x]) => ({ name, detail, ...(Array.isArray(x) ? { availability: x } : x || {}) })) }));
const CAPABILITY_COUNT = FEATURE_MATRIX.reduce((n, g) => n + g.items.length, 0);
/** Live flags for availability keys not on the dev panel. */
const STATIC_ON = { model: true, whoop: true, nutrition: true, zepp: false, customDomains: false, instagram: false };
/** Chip for one capability: dev-panel driven for payments/payouts/voice, static otherwise. */
function capChip(item) {
  const a = item.availability || [];
  const on = item.offering ? chip(item.offering, "line") : chip("Included", "ok");
  if (a.some((k) => k === "payments" || k === "payouts")) return `<span class="chip chip--off if-payments-off">Not on yet</span><span class="if-payments-on">${on}</span>`;
  if (a.includes("voice")) return `<span class="chip chip--off if-voice-off">Not on yet</span><span class="if-voice-on">${on}</span>`;
  if (a.some((k) => STATIC_ON[k] === false)) return chip("Not on yet", "off");
  return on;
}

/* ===================================================================== */
/* /how-it-works                                                          */
/* ===================================================================== */
const SAMPLE_STATEMENT = () => {
  const ex = C.compactEarnings(150, 199, 250);
  return statement({
    title: "Monthly statement", period: "Layla Strength · 150 subscribers at AED 199",
    rows: [
      { label: "Subscriptions, 150 × AED 199", value: C.aed(ex.subscriptionMonthlyMinor) },
      { label: "Our share: 100 × 25%", value: "−" + C.aed(ex.bands[0].commissionMinor), sub: true },
      { label: "Our share: 50 × 20%", value: "−" + C.aed(ex.bands[1].commissionMinor), sub: true },
    ],
    total: { label: "You keep, before card processing", value: C.aed(ex.beforeOtherCostsMinor) },
    note: "Payouts go monthly to a verified UAE IBAN, once payouts are on.",
    cls: "statement--compact",
  });
};

/** The eight steps: rail label, phase, panel copy, window layer, phone layer. */
function hiwSteps(page) {
  const s = page.sections.find((x) => x.id === "steps").steps;
  return [
    {
      title: s[0].title, phase: "Setup", body: s[0].body,
      win: win("Setup · Your page", `<p class="mw-k">Step 3 of 6</p>${mrow("Coaching name", "Layla Strength")}
        <div class="mw-row mw-row--addr"><span>Your address</span><b class="ltr">layla-strength.trainsyou.com</b>${chip("Reserved", "ok")}</div>
        <div class="mw-steps" aria-hidden="true"><i class="on"></i><i class="on"></i><i class="on"></i><i></i><i></i><i></i></div>`),
      phone: `${purl("layla-strength.trainsyou.com")}<div class="po-brand"><span class="po-mono" aria-hidden="true">LS</span><div><b>Layla Strength</b><span>Strength coaching</span></div></div>
        <div class="po-poster"><span class="po-poster-k">Coached my way</span><span class="po-poster-t">Strength, planned daily.</span></div>
        <div class="mp-skel"><i></i><i></i><i class="s"></i></div><span class="chip chip--line mp-chip">Draft page</span>`,
    },
    {
      title: "Teach your AI", phase: "Setup", body: "Confirm rules, answer the quiz and add client cases. Import documents after a private review.",
      win: win("Teach · Rules", `<div class="mw-rule"><div><b>Two easy sessions → add 2.5 kg</b><span>Source · Interview, 12 Oct</span></div>${chip("Confirmed", "ok")}</div>
        <div class="mw-rule"><div><b>Never stack two sessions in a day</b><span>Source · Your PDF, page 4</span></div>${chip("Confirmed", "ok")}</div>
        <div class="mw-rule mw-rule--flag"><div><b>Deload every fourth week</b><span>Two sources disagree · never in “Approve all”</span></div>${chip("Needs you", "off")}</div>`),
      phone: `<p class="mp-k">Quiz · 3 of 8</p><p class="mp-q">A client misses Monday. What do you do?</p><p class="bubble bubble--me mp-b">Move it to the next free day. Never two in one day.</p><div class="mp-skel"><i></i><i class="s"></i></div>`,
    },
    {
      title: s[2].title, phase: "Setup", body: s[2].body,
      win: win("Test · Your test cases", `<div class="mw-mode"><span>Mode</span><span class="chip chip--ink">Waits for me</span></div>
        ${mrow("Quiz answers", `<span class="fig">8 of 8</span>`, icon("check").replace("<svg", '<svg class="icon-ok"'))}
        ${mrow("Your own cases", `<span class="fig">3 of 3</span>`, icon("check").replace("<svg", '<svg class="icon-ok"'))}
        <div class="mw-meter"><div class="mw-row"><span>Automatic sending</span><b><span class="fig">3 of 20</span> cases</b></div><div class="meter" style="--v:.15" aria-hidden="true"><i></i></div></div>`),
      phone: `<p class="bubble-meta">Subscriber · week 1</p><p class="bubble mp-b">Can I train fasted in the morning?</p><div class="mp-draft"><span class="chip chip--off">Draft reply</span><span>Waits for Layla</span></div>`,
    },
    {
      title: s[3].title, phase: "Setup", body: "Set your price and billing. Add nutrition or voice when they’re on.",
      win: win("Offer · Your plan", `${mrow("Workouts", `<span class="fig">AED 199</span> a month`)}${mrow("Workouts + Nutrition", `<span class="fig">AED 299</span> a month`)}
        <div class="mw-seg" aria-hidden="true"><span class="on">Monthly</span><span>Upfront</span></div>${mrow("Free trial", `<span class="fig">7</span> days`)}`),
      phone: offerScreen(199),
    },
    {
      title: s[4].title, phase: "Launch", off: "publish", body: "Check the subscriber preview, publish, then share your tagged link in your bio and Stories.",
      chips: statusChip("publish", "publishing"),
      win: win("Share · Tagged links", `<div class="mw-link"><span>Bio</span><b class="ltr">layla-strength.trainsyou.com/?ref=bio</b></div>
        <div class="mw-link"><span>Story</span><b class="ltr">layla-strength.trainsyou.com/?ref=story</b></div>
        <div class="mw-publish"><span class="btn btn--sm" aria-disabled="true">Publish</span>${statusChip("publish", "publishing")}</div>`),
      phone: `${purl("layla-strength.trainsyou.com")}<span class="chip chip--line mp-chip">Subscriber preview</span><div class="po-brand"><span class="po-mono" aria-hidden="true">LS</span><div><b>Layla Strength</b><span>Strength coaching</span></div></div><div class="mp-skel"><i></i><i></i><i class="s"></i><i></i></div>`,
    },
    {
      title: s[5].title, phase: "Every day", body: "Each subscriber gets a dated plan. Replies wait for you until you turn on automatic sending.",
      win: win("Today · Plans sent", `<p class="mw-k">Tue 14 Oct</p>
        ${["Subscriber A · Lower body A", "Subscriber B · Upper body B", "Subscriber C · Rest day"].map((t) => `<div class="mw-row"><span>${t}</span>${icon("check").replace("<svg", '<svg class="icon-ok"')}</div>`).join("")}`),
      phone: todayScreen(),
    },
    {
      title: s[6].title, phase: "Every day", body: s[6].body,
      bodyOn: page.__frontierStep7,
      win: win("Inbox · Handed to you", `<p class="bubble-meta">Subscriber · week 5</p><p class="bubble">Hotel gym for two weeks. Can you rebuild my plan?</p>
        <div class="mw-draft"><span>Draft</span><b>Dumbbells to 20 kg, same days</b></div>
        <div class="mw-actions"><span class="btn btn--sm">Approve</span><span class="btn btn--sm btn--secondary">Correct</span></div><p class="mw-foot">Your correction becomes teaching.</p>`),
      phone: `<p class="bubble-meta">Digital coach · Layla Strength</p><p class="bubble mp-b">Good to know. Layla will confirm a plan for the hotel gym.</p><div class="mp-note">${icon("pending")}<span>Your trainer is reviewing this change.</span></div>`,
    },
    {
      title: s[7].title, phase: "Monthly", off: "payments", body: "Subscribers pay in AED and payouts reach your UAE bank. Your statement itemises costs.",
      chips: statusChip("payments", "subscriber payments"), statement: true,
      win: win("Payouts", `${mrow("Paid to", `<span class="ltr">UAE IBAN ···· 4821</span>`, chip("Verified", "ok"))}${mrow("Schedule", "Monthly")}
        <div class="mw-publish"><span>Next payout</span>${statusChip("payments", "payouts")}</div>`),
      phone: `<p class="mp-k">Membership</p><div class="mp-card"><b>Workouts</b><span class="fig">AED 199</span><small>a month · renews 14 Nov</small></div><div class="mp-skel"><i></i><i class="s"></i></div><div class="po-cta">Pay by card</div>`,
    },
  ];
}

function howItWorks(ctx) {
  const page = ctx.page;
  const frontierStep = ctx.content.availabilityLines.find((l) => l.when === "frontier" && l.path === "/how-it-works");
  page.__frontierStep7 = frontierStep && frontierStep.body.text;
  const steps = hiwSteps(page);
  const n = steps.length;

  const rail = steps.map((s, i) => `<button class="hiw-tab${i === 0 ? " is-done" : ""}" role="tab" id="hiw-t${i}" aria-label="Step ${i + 1}: ${esc(s.title)}" aria-controls="hiw-p${i}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">
    <span class="fig hiw-n">${String(i + 1).padStart(2, "0")}</span><span class="hiw-tt"><span class="t">${esc(s.title)}</span><span class="m">${esc(s.phase)}${s.off ? `<i class="hiw-off if-${s.off === "payments" ? "payments-off" : "publish-gated"}" title="Not on yet"></i>` : ""}</span></span></button>`).join("");
  const panels = steps.map((s, i) => {
    budget("step body", s.body, 25);
    const body = s.bodyOn ? `<p class="if-frontier-off">${esc(s.body)}</p><p class="if-frontier-on">${esc(s.bodyOn)}</p>` : `<p>${esc(s.body)}</p>`;
    return `<div class="hiw-panel tabpanel" role="tabpanel" id="hiw-p${i}" aria-labelledby="hiw-t${i}"${i ? " hidden" : ""}>
  <p class="eyebrow eyebrow--muted">Step ${i + 1} · ${esc(s.phase)}</p><h3>${esc(s.title)}</h3>${body}
  ${s.chips ? `<div class="chip-row">${s.chips}</div>` : ""}
  ${s.statement ? `<div class="hiw-statement">${SAMPLE_STATEMENT()}${paymentsNote()}</div>` : ""}
</div>`;
  }).join("");
  const layers = (k) => steps.map((s, i) => `<div class="hiw-scr${i === 0 ? " is-on" : ""}" data-s="${i}">${s[k]}</div>`).join("");

  const heroHtml = hero({
    eyebrow: "How it works", h1: "From your method to daily coaching", mark: "daily",
    lede: "Teach it your method, test it, then publish. It coaches every subscriber daily and hands you what it’s unsure about.",
    secondary: { label: "Try the demo", href: "/demo" },
    after: `<div class="ph-strip">${statusStrip({ href: "pricing.html#status" })}</div>`,
    visual: stage(`<ol class="hiw-chain" aria-label="Sample: from your address to your monthly statement">
      <li class="hc hc--addr"><span class="hc-k">Your address</span><span class="addr-pill">${icon("lock")}<span class="ltr">layla-strength.trainsyou.com</span></span></li>
      <li class="hc hc--rule"><span class="hc-k">Your rule</span><span class="hc-card"><span class="chip chip--ink">Confirmed</span><b>Two easy sessions → add 2.5 kg</b></span></li>
      <li class="hc hc--day"><span class="hc-k">Every day</span><span class="hc-card"><span class="fig">TUE 14</span><b>Lower body A · 45 min</b>${icon("check").replace("<svg", '<svg class="icon-ok"')}</span></li>
      <li class="hc hc--month"><span class="hc-k">Every month</span><span class="hc-card"><b>Your statement</b>${statusChip("payments", "payouts")}</span></li>
    </ol>`, { cls: "p-stage--chain" }),
  });

  const walkthrough = band({
    id: "steps", tone: "paper", labelledby: "steps-h",
    inner: `${head({ eyebrow: "The 8 steps", title: "Eight steps, at your pace", id: "steps-h", lede: "Setup takes about 15 minutes to start. Choose a step to see what you and your subscribers see." })}
<div class="hiw reveal" data-hiw>
  <div class="hiw-rail">
    <svg class="hiw-line" aria-hidden="true"><line class="bg" x1="1" y1="0" x2="1" y2="100%"/><line class="fg" x1="1" y1="0" x2="1" y2="100%" pathLength="1" style="--p:${1 / n}"/></svg>
    <svg class="hiw-hline" aria-hidden="true"><line class="bg" x1="0" y1="1" x2="100%" y2="1"/><line class="fg" x1="0" y1="1" x2="100%" y2="1" pathLength="1" style="--p:${1 / n}"/></svg>
    <div class="hiw-tabs" role="tablist" aria-label="The eight steps" aria-orientation="vertical">${rail}</div>
  </div>
  <div class="hiw-main">
    <div class="hiw-label">${sampleLabel()}</div>
    <div class="hiw-win" aria-hidden="true">${layers("win")}</div>
    <div class="hiw-phone" aria-hidden="true">${phone({ body: `<div class="hiw-stack">${layers("phone")}</div>`, label: false, small: true, ariaLabel: "Sample phone screen for this step" })}</div>
    <div class="hiw-panels">${panels}</div>
    <div class="hiw-nav"><span class="fine" data-hiw-count>1 of ${n}</span><button type="button" data-hiw-prev aria-label="Previous step" disabled>${icon("prev")}</button><button type="button" data-hiw-next aria-label="Next step">${icon("next")}</button></div>
  </div>
</div>`,
  });

  const lanes = page.sections.find((s) => s.id === "lanes").table;
  const laneRows = lanes.rows.map((r) => r.map((c) => fix(c).replace("Hands over anything below how sure it must be", "Hands you anything it isn’t sure enough about")));
  const who = band({
    id: "who", labelledby: "who-h",
    inner: `${head({ eyebrow: "Roles", title: "Who does what", id: "who-h", lede: "Once you’re live, every job has an owner. Safety always comes to you." })}
<div class="lanes-table reveal"><table class="lt">
  <caption class="sr-only">${esc(lanes.caption)}</caption>
  <thead><tr><th scope="col"><span class="chip chip--ink">You</span></th><th scope="col"><span class="chip chip--pace">Your AI</span></th><th scope="col"><span class="chip chip--line">Your subscriber</span></th></tr></thead>
  <tbody>${laneRows.map((r) => `<tr>${r.map((c, i) => `<td data-label="${["You", "Your AI", "Your subscriber"][i]}">${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody>
</table></div>`,
  });

  const setup = ctx.content.setupChecklist.map((x) => ({ ...x, label: x.key === "brain" ? "Teach your AI" : x.key === "live" ? "Preview and publish" : x.label }));
  const total = setup.reduce((t, x) => t + x.minutes, 0);
  const time = band({
    id: "time", tone: "paper", labelledby: "time-h",
    inner: `<div class="tts">
  <div class="tts-copy reveal">${eyebrow("Time to start")}<h2 id="time-h">Start in one sitting</h2>
    <p class="lede">Six guided steps. You can start teaching before your business details are complete.</p>
    <p class="tts-total"><span class="fig">${total}</span><span>minutes, about,<br>from sign-up to start</span></p></div>
  <div class="tts-viz">
    <div class="tts-track reveal" role="img" aria-label="Setup time by step: ${setup.map((x) => `${esc(x.label)} ${x.minutes} min`).join(", ")}; about ${total} minutes in all">${setup.map((x, i) => `<span class="tts-s${x.key === "brain" ? " tts-s--teach" : x.key === "live" ? " tts-s--live" : ""}" style="--m:${x.minutes};--i:${i}"><b class="fig">${x.minutes}</b></span>`).join("")}</div>
    <ol class="tts-list reveal" data-stagger>${setup.map((x) => `<li><span class="fig">${x.minutes} min</span><b>${esc(x.label)}</b><span class="fine">${esc(fix(x.summary))}</span>${x.key === "live" ? statusChip("publish", "publishing") : ""}</li>`).join("")}</ol>
  </div>
</div>
</div>`,
  });
  budget("H2", "Start in one sitting", 6);

  const tbLearn = ctx.content.availabilityLines.find((l) => l.when === "frontier" && l.path === "/trainer-brain");
  const control = band({
    id: "control", labelledby: "control-h",
    inner: `${head({ eyebrow: "Control", title: "Control stays visible", id: "control-h", lede: "Inspect every rule and its source, roll back a release, or take over any conversation." })}
<div class="cols-3 cv reveal" data-stagger>
  <div class="card cv-card"><div class="cv-ui"><div class="mw-rule"><div><b>Two easy sessions → add 2.5 kg</b><span>Source · Interview, 12 Oct</span></div>${chip("Confirmed", "ok")}</div></div><h3>Inspect every rule</h3><p class="muted">Each rule shows where it came from. Edit or reject it any time.</p></div>
  <div class="card cv-card"><div class="cv-ui"><div class="cv-rel"><span class="fig">v3</span><span class="fig">v4</span><span class="cv-live">Live</span></div><span class="cv-back">${icon("prev")}Roll back to v3</span></div><h3>Roll back a release</h3><p class="muted">Every release is versioned and tested. Go back one in a tap.</p></div>
  <div class="card cv-card"><div class="cv-ui"><div class="cv-take"><span class="chip chip--ink">You took over</span><span>Digital coach paused</span></div></div><h3>Take over any conversation</h3><p class="muted">Reply yourself whenever you like. Hand back when you’re done.</p></div>
</div>
<p class="cv-line reveal">${icon("info")}<span>Subscribers always see when guidance is digital.</span></p>
<p class="cv-line cv-line--frontier if-frontier-on">${icon("check")}<span>${esc(tbLearn ? tbLearn.bullet.text : "")}</span></p>`,
  });

  const fq = pickFaqs(page, [/setup take/, /not sure/, /trained on my data/, /pain/]);
  const frontierFaq = ctx.content.availabilityLines.find((l) => l.when === "frontier" && l.faq && !l.path);
  const items = fq.map((f) => {
    if (/not sure/.test(f.q)) return { q: "What does your AI do when it isn’t sure?", a: f.a };
    if (/trained on my data/.test(f.q)) return { q: f.q, html: `<span class="if-frontier-off">${esc(fix(f.a).replace(" We do not claim to fine-tune a separate model on you, and", " We don’t fine-tune a separate model on you, and"))}</span><span class="if-frontier-on">${esc(fix(frontierFaq.faq.a))}</span>` };
    if (/setup take/.test(f.q)) return { q: f.q, a: "About 15 minutes to start, in six guided steps. How much of your method you teach before publishing is up to you. You can start teaching before your business details are complete." };
    return f;
  });

  return {
    main: [heroHtml, dayBand({ eyebrow: "A sample day" }), walkthrough, who, time, control, faqBand(items, "hq")].join("\n"),
    closing: { secondary: { label: "Try the demo", href: "/demo" } },
    ...dayAssets,
  };
}

/* ===================================================================== */
/* /trainer-brain                                                         */
/* ===================================================================== */
function ruleCard() {
  return `<div class="rc-wrap">
  <div class="rc rc--flag" aria-hidden="true"><div class="rc-top"><span class="chip chip--off">Flagged</span><span class="rc-state">Two sources disagree</span></div><p class="rc-text">Deload every fourth week.</p><p class="rc-src">Never included in “Approve all”</p></div>
  <div class="rc" data-rule-card role="group" aria-label="Sample rule card">
    <span class="rc-tint" aria-hidden="true"></span>
    <div class="rc-top"><span class="chip chip--ink">Your rule</span><span class="rc-state">${val("Waiting for you", { attrs: "data-rc-state", align: "end" })}</span></div>
    <p class="rc-text">After two sessions at 3+ reps in reserve, add <b class="rc-kg flash">${val("2.5 kg", { attrs: "data-rc-kg", cls: "fig" })}</b>.</p>
    <p class="rc-src">${icon("info")}<span>Source · Interview, 12 Oct</span></p>
    <div class="rc-edit" data-rc-editor hidden>
      <p class="rc-edit-l" id="rc-edit-l">Add how much?</p>
      <div class="rc-opts" role="radiogroup" aria-labelledby="rc-edit-l">${["1 kg", "2.5 kg", "5 kg"].map((k) => `<button type="button" role="radio" class="rc-opt" aria-checked="${k === "2.5 kg"}" data-kg="${k}">${k}</button>`).join("")}</div>
      <button type="button" class="btn btn--sm" data-rc="save">Save</button>
    </div>
    <div class="rc-actions" data-rc-actions>
      <button type="button" class="btn btn--sm" data-rc="confirm">${icon("check").replace("<svg", '<svg width="18" height="18"')}Confirm</button>
      <button type="button" class="btn btn--sm btn--secondary" data-rc="edit">Edit</button>
      <button type="button" class="btn btn--sm btn--ghost" data-rc="reject">Reject</button>
    </div>
    <div class="rc-done" data-rc-done hidden><span data-rc-msg></span><button type="button" class="link" data-rc="undo">Undo</button></div>
    <span class="rc-stamp" aria-hidden="true">Confirmed</span>
    <p class="sr-only" aria-live="polite" data-live></p>
  </div>
</div>`;
}

function trainerBrain(ctx) {
  const page = ctx.page;
  const sec = (id) => page.sections.find((s) => s.id === id);
  const learnOn = ctx.content.availabilityLines.find((l) => l.when === "frontier" && l.path === "/trainer-brain");

  const heroHtml = hero({
    eyebrow: "Trainer Brain", h1: "Your AI, built from your judgment", mark: "judgment",
    lede: "Your rules and corrections in one private AI. Routine replies use your words. The rest waits for you.",
    secondary: { label: "Try the demo", href: "/demo" },
    visual: stage(`${ruleCard()}<p class="rc-hint">${icon("info")}Try it: confirm, edit or reject this rule.</p>`, { cls: "p-stage--rule" }),
  });

  const teach = [
    ["Interview", "A guided interview: what you recommend, why, and what changes it."],
    ["Rules", "Plain-language rules you confirm, each with its source. Flagged rules are never in “Approve all”."],
    ["Cases", "Coaching cases and worked examples of real decisions."],
    ["Documents", "Your own documents, after you review the extracted text."],
    ["Quiz", "The practice quiz: 8 answers to start, 20 cases for automatic sending."],
  ];
  const what = band({
    id: "what", tone: "paper", labelledby: "what-h",
    inner: `<div class="split tb-what">
  <div class="reveal">${eyebrow("What it is")}<h2 id="what-h">Not a generic workout generator</h2>
    <p class="tb-big">Every change traces back to something you taught. Every version can be rolled back.</p>
    <div class="chip-row">${chip("Private to your workspace", "line")}${chip("Versioned", "line")}${chip("Rollback any time", "line")}</div></div>
  <div class="reveal"><h3 class="tb-sub">What you teach it</h3>
    <ol class="tb-teach" data-stagger>${teach.map(([k, t], i) => `<li style="--i:${i}"><span class="fig">${String(i + 1).padStart(2, "0")}</span><div><b>${k}</b><p>${esc(t)}</p></div></li>`).join("")}</ol></div>
</div>`,
  });
  budget("H2", "Not a generic workout generator", 6);

  const decides = band({
    id: "decides", labelledby: "decides-h",
    inner: `${head({ eyebrow: "How it decides", title: "Three paths, every time", id: "decides-h", lede: "Code checks first, code picks one specialist, code checks after. Then every moment takes one of three paths." })}
<div class="cols-3 tb-paths reveal" data-stagger>
  ${[
    ["Within your rules", "ok", "Sent on its own", "A reply sends only when your approved reply fits. A plan sends only above your bar.", 0.86, "Plan · 86% · your bar 80%"],
    ["Anything unsure", "off", "Waits for you", "No approved reply, below your bar, or a topic you answer yourself. Medical questions too.", 0.78, "Plan · 78% · your bar 80%"],
    ["Red flags", "err", "Training paused", "Pain and red flags stop it in code. No AI is called. You review it first.", 0, "Rule"],
  ].map(([t, k, l, b, v, f]) => { budget("card", b, 18); return `<div class="card tb-path tb-path--${k}"><div class="tb-path-top"><h3>${t}</h3><span class="chip chip--${k}">${l}</span></div>
    ${k === "err" ? `<div class="tb-safe"><span>Pain reported</span>${icon("arrow")}<b>Training paused</b></div>` : `<div class="tb-sure"><span>${f.split(" · ")[0]}</span><b class="fig">${f.split(" · ").slice(1).join(" · ")}</b></div><div class="tb-mwrap" aria-hidden="true"><div class="meter" style="--v:${v}"><i></i></div><span class="tb-th"></span></div>`}
    <p class="muted">${esc(b)}</p></div>`; }).join("")}
</div>
<p class="fine tb-th-note reveal">Chat replies have no score. They must cite your rule. The line on each meter is your bar for plans. You set it.</p>`,
  });

  const versions = [["v1", "29 Sep"], ["v2", "6 Oct"], ["v3", "13 Oct"], ["v4", "20 Oct"]];
  const better = band({
    id: "better", tone: "paper", labelledby: "better-h",
    inner: `${head({ eyebrow: "How it gets better", title: "Better with every correction", id: "better-h", lede: "Corrections become suggested rules you confirm. Each release is checked against your test cases before it goes live." })}
<div class="tb-better">
  <div class="card tb-rel reveal" data-releases>
    <div class="tile-head"><p class="eyebrow">Releases</p>${sampleLabel("Sample")}</div>
    <div class="rel-track" style="--v:3">
      <span class="rel-live" aria-hidden="true"><span>Live</span></span>
      <ol class="rel-list">${versions.map(([v, d], i) => `<li class="rel" data-v="${i}"><span class="rel-dot"></span><b class="fig">${v}</b><span class="fine">${d}</span><span class="rel-ok">${icon("check").replace("<svg", '<svg class="icon-ok"')}Tested</span></li>`).join("")}</ol>
    </div>
    <div class="rel-foot"><p class="rel-now">${val("v4 is live", { attrs: "data-rel-now" })}</p><button type="button" class="btn btn--sm btn--secondary" data-rel-btn>${icon("prev")}<span data-rel-label>Roll back to v3</span></button></div>
    <p class="fine rel-note">A release reaches subscribers only after it passes your test cases.</p>
    <p class="sr-only" aria-live="polite" data-live></p>
  </div>
  <div class="card tb-cmp reveal" data-compare>
    <div class="tile-head"><p class="eyebrow">Compare my replies</p>${sampleLabel("Sample")}</div>
    <p class="bubble-meta">Subscriber asks</p><p class="bubble">Can I swap squats for leg press this week?</p>
    <div class="cmp-grid">
      ${[["A", "Your AI", "Swap is fine this week. Leg press 3 × 10, two reps in reserve, then squats on Monday.", [4, 5, 4, 4, 5]], ["B", "You", "Yes for this week. Same sets, start lighter, and tell me how your knees feel.", [5, 5, 5, 4, 5]]].map(([k, who, txt, r]) => `<div class="cmp">
        <p class="cmp-k">${swap("Reply " + k, who)}</p><p class="cmp-t">${esc(txt)}</p>
        <ul class="cmp-rate" aria-label="Sample ratings, 1 to 5">${["Right call", "Safe", "Clear", "Specific", "Sounds like me"].map((c, i) => `<li><span>${c}</span><span class="dots" aria-label="${r[i]} of 5">${[1, 2, 3, 4, 5].map((d) => `<i${d <= r[i] ? ' class="on"' : ""}></i>`).join("")}</span></li>`).join("")}</ul></div>`).join("")}
    </div>
    <div class="cmp-foot"><p class="fine">You rate both blind, 1–5 on five points.</p><button type="button" class="btn btn--sm btn--secondary" data-cmp-btn aria-pressed="false">Reveal which is yours</button></div>
  </div>
</div>
<ul class="tb-learn reveal">${sec("learns").bullets.map((b) => `<li>${icon("check").replace("<svg", '<svg class="icon-ok"')}<span>${esc(fix(b))}</span></li>`).join("")}<li class="if-frontier-on">${icon("check").replace("<svg", '<svg class="icon-ok"')}<span>${esc(learnOn.bullet.text)}</span></li></ul>`,
  });

  const yours = band({
    id: "yours", labelledby: "never-h",
    inner: `<div class="split split--even tb-yours">
  <div class="reveal">${eyebrow("Limits")}<h2 id="never-h">What it never does</h2>${constraintList({ label: "What your AI never does", items: sec("never").bullets.map((b) => fix(b)) })}</div>
  <div class="card card--paper reveal tb-own">${eyebrow("Ownership")}<h2 class="h3" id="own-h">Your method stays yours</h2>
    ${ticks(["Private to your workspace, isolated at the database layer.", "Never used for another trainer.", "Export it or delete it whenever you like.", "Your voice is used only with consent you can withdraw."])}
    ${secondaryLink({ label: "Security and privacy", href: "/security-and-privacy" })}</div>
</div>`,
  });

  const hours = band({
    id: "hours", tone: "wash", labelledby: "hours-h",
    inner: `<div class="cols-2 tb-why">
  <div class="tb-why-card reveal">${eyebrow("Why followers pay")}<h2 id="hours-h">Your method, your name, you</h2>
    <p class="lede">Followers pay for you, not for software. Your AI coaches in your way, and you stay behind every plan.</p>
    <div class="tb-brand"><span class="app-icon-tile" aria-hidden="true">LS</span><div><b>Layla Strength</b><span>Digital coach, taught by Layla</span></div>${sampleLabel("Sample")}</div>
    <p class="fine">Framing from the supportive accountability model: people keep going when they feel accountable to a real person. ${ext("https://pubmed.ncbi.nlm.nih.gov/21393123/", "Mohr et al., 2011")}</p></div>
  <div class="tb-why-card tb-hours reveal">${eyebrow("Your hours")}<h2 id="hours2-h">What this means for your hours</h2>
    <div class="tb-hcmp" role="img" aria-label="Illustration: one hour coaches one person once; your AI coaches every subscriber every day">
      <div class="tb-h1"><span class="tb-mark tb-mark--one"></span><b>One hour</b><span class="fine">One person, once</span></div>
      <div class="tb-hn"><span class="tb-marks">${"<i></i>".repeat(30)}</span><b>Your method</b><span class="fine">Every subscriber, every day</span></div>
    </div>
    ${secondaryLink({ label: "See the pricing", href: "/pricing" })}</div>
</div>`,
  });
  budget("H2", "Your method, your name, you", 6);
  budget("H2", "What this means for your hours", 6);

  const frontierFaq = ctx.content.availabilityLines.find((l) => l.when === "frontier" && l.faq && !l.path);
  const items = pickFaqs(page, [/trained on my data/, /replace me/, /another trainer/, /wrong/]).map((f) => {
    if (/trained on my data/.test(f.q)) return { q: f.q, html: `<span class="if-frontier-off">${esc(fix(f.a).replace(" We do not claim to fine-tune a separate model on you, and", " We don’t fine-tune a separate model on you, and"))}</span><span class="if-frontier-on">${esc(fix(frontierFaq.faq.a))}</span>` };
    if (/replace me/.test(f.q)) return { q: f.q, a: "No. Your AI is built from your rules, cases and corrections and coaches under your name. It hands you anything it isn’t confident about, and safety issues always come to you. Take over any subscriber at any time." };
    if (/another trainer/.test(f.q)) return { q: "Can another trainer see or use my AI?", a: f.a };
    return { q: "What if your AI gets something wrong?", a: f.a };
  });

  return {
    main: [heroHtml, what, decides, playground({ tone: "paper", eyebrow: "Try it on your Brain" }), better, yours, hours, faqBand(items, "bq")].join("\n"),
    closing: { secondary: { label: "Try the demo", href: "/demo" } },
    ...playAssets,
  };
}

/* ===================================================================== */
/* Shared feature-page pieces                                             */
/* ===================================================================== */
const FEATURE_PATHS = ["/features/ai-training-plans", "/features/subscriber-app", "/features/website-and-domain", "/features/nutrition", "/features/voice-coach", "/features/bookings", "/features/chat-and-digital-coach", "/features/progress-and-client-twin", "/features/payments-and-payouts", "/features/safety", "/features/team"];
/** New H1s (C5) and their highlight word; they double as tile lines on /features. */
const FEATURE_H1 = {
  "/features/ai-training-plans": ["Your AI plans every subscriber’s training", "plans"],
  "/features/subscriber-app": ["Your training app, with your name on it", "your name"],
  "/features/website-and-domain": ["Build your coaching website your way", "your way"],
  "/features/nutrition": ["Nutrition coaching that follows your guidance", "your guidance"],
  "/features/voice-coach": ["Your voice, running the session", "Your voice"],
  "/features/bookings": ["Add paid sessions to your AI coaching", "paid sessions"],
  "/features/chat-and-digital-coach": ["Stay close without answering every message", "Stay close"],
  "/features/progress-and-client-twin": ["Every subscriber’s progress and context in one view", "context"],
  "/features/payments-and-payouts": ["Monthly AED payouts to your UAE bank", "AED"],
  "/features/safety": ["Safety rules your AI cannot override", "cannot override"],
  "/features/team": ["Bring your team", "team"],
};
const ok = (cls = "icon-ok") => icon("check").replace("<svg", `<svg class="${cls}"`);
const no = () => icon("cross").replace("<svg", '<svg class="icon-no"');
/** Horizontal (desktop) / vertical (phone) numbered run of steps. */
const runline = (steps) => `<ol class="run reveal" data-stagger style="--n:${steps.length}">${steps.map((s, i) => { budget("step", s.body, 25); return `<li class="run-step"><span class="run-n fig">${String(i + 1).padStart(2, "0")}</span><h3>${esc(fix(s.title))}</h3><p>${esc(fix(s.body))}</p></li>`; }).join("")}</ol>`;
/** One-line description of a page for tiles: the rewritten H1 where we own it. */
const PRODUCT_H1 = { "/trainer-brain": "Your AI, built from your judgment", "/demo": "See your AI make a coaching decision", "/how-it-works": "From your method to daily coaching", "/security-and-privacy": "How we protect you and your subscribers", "/pricing": "Free to join. You set the price.", "/earnings-calculator": "Estimate what you keep, in AED", "/follower-calculator": "What your followers could be worth" };
const lineFor = (p) => (FEATURE_H1[p.path] ? FEATURE_H1[p.path][0] : PRODUCT_H1[p.path] || p.title);
/** Related feature tiles. */
function relatedTiles(paths) {
  const list = paths.map((p) => pageFor(p)).filter(Boolean);
  return `<div class="rel-tiles">${list.map((p) => `<a class="rtile" href="${href(p.path)}"><span class="rtile-k">${esc(p.navLabel)}</span><b>${esc(lineFor(p))}</b>${icon("arrow")}</a>`).join("")}</div>`;
}
/** Feature guide tile with corrected chips (core availability, C0). */
function guideTile(path) {
  const p = pageFor(path);
  return `<a class="gtile" href="${href(path)}"><span class="gtile-k">${esc(p.navLabel)}${hourTag(path) ? " " + hourTag(path) : ""}</span><b>${esc(FEATURE_H1[path][0])}</b><span class="chip-row">${featureChips(p)}</span><span class="gtile-go">${icon("arrow")}</span></a>`;
}

/* ===================================================================== */
/* /features (index)                                                      */
/* ===================================================================== */
/** Each capability's state class for the grid of 91 marks. */
function capState(item) {
  const a = item.availability || [];
  if (a.some((k) => k === "payments" || k === "payouts")) return "pay";
  if (a.includes("voice")) return "voice";
  if (a.some((k) => STATIC_ON[k] === false)) return "off";
  return item.offering === "Optional tier" ? "tier" : "in";
}
function capCounts(pay, voice) {
  const c = { in: 0, tier: 0, addon: 0, off: 0 };
  FEATURE_MATRIX.forEach((g) => g.items.forEach((it) => {
    const s = capState(it);
    if (s === "pay") c[pay ? "in" : "off"]++;
    else if (s === "voice") c[voice ? "addon" : "off"]++;
    else if (s === "off") c.off++;
    else c[s]++;
  }));
  return c;
}
const AREA_SHORT = { brain: "Your AI", training: "Plans", nutrition: "Nutrition", voice: "Voice", coaching: "Chat and data", bookings: "Bookings", brand: "Brand and app", money: "Money", growth: "Growth", trust: "Trust" };
function capGrid() {
  const combos = [[false, false], [true, false], [false, true], [true, true]];
  const flagCls = (pay, voice) => `if-payments-${pay ? "on" : "off"} if-voice-${voice ? "on" : "off"}`;
  const num = (key) => combos.map(([pay, voice]) => `<span class="${flagCls(pay, voice)}">${capCounts(pay, voice)[key]}</span>`).join("");
  const live = capCounts(false, false);
  return `<div class="capgrid" role="img" aria-label="${CAPABILITY_COUNT} capabilities in ${FEATURE_MATRIX.length} areas. Today ${live.in} are included, ${live.tier} are in the optional nutrition tier and ${live.off} are not on yet.">
  ${FEATURE_MATRIX.map((g) => `<div class="cg-row"><span class="cg-l">${esc(AREA_SHORT[g.id])}</span><span class="cg-m">${g.items.map((it) => `<i class="cg-${capState(it)}"></i>`).join("")}</span></div>`).join("")}
</div>
<ul class="cg-legend" aria-hidden="true">
  <li><i class="cg-in"></i><b class="fig">${num("in")}</b>Included</li>
  <li><i class="cg-tier"></i><b class="fig">${num("tier")}</b>Optional tier</li>
  <li class="if-voice-on"><i class="cg-addon"></i><b class="fig">${num("addon")}</b>Add-on</li>
  <li><i class="cg-off"></i><b class="fig">${num("off")}</b>Not on yet</li>
</ul>`;
}

function features(ctx) {
  const page = ctx.page;
  const ex = C.compactEarnings(150, 199, 250);
  const groups = page.sections.find((s) => s.id === "groups").cards;
  const subs = page.sections.find((s) => s.id === "subscribers").cards;

  const heroHtml = hero({
    eyebrow: "Features", h1: "Everything you need, under your own name", mark: "own name",
    lede: page.lede,
    secondary: { label: "See the pricing", href: "/pricing" },
    after: `<div class="ph-strip">${statusStrip({ href: "pricing.html#status" })}</div>`,
    visual: stage(`<div class="fx-count"><p class="fx-big"><span class="fig">${CAPABILITY_COUNT}</span><span>capabilities in one workspace, in ${FEATURE_MATRIX.length} areas</span></p>${capGrid()}<a class="link fx-all" href="#all-capabilities">See all ${CAPABILITY_COUNT}${icon("arrow")}</a></div>`, { label: false, cls: "p-stage--count" }),
  });

  const strike = (t) => `<li><span class="strike">${esc(t)}</span></li>`;
  const strikeOff = (t) => `<li><span class="strike">${esc(t)}</span>${statusChip("payments", "")}</li>`;
  const bento = band({
    id: "parts", tone: "paper", labelledby: "parts-h",
    inner: `${head({ eyebrow: "One platform", title: "Four parts of one platform", id: "parts-h", lede: "Each part shows the separate tools it replaces." })}
<div class="bento reveal" data-stagger>
  <article class="bcard bcard--ai"><div class="bcard-top"><span class="fig bcard-n">01</span><h3>Your AI</h3></div><p class="muted">${esc(fix(groups[0].body))}</p>
    <div class="bmini">${win("Inbox · Handed to you", `<p class="bubble">Hotel gym for two weeks.</p><div class="mw-draft"><span>Draft plan</span><b>Dumbbells to 20 kg</b></div><div class="mw-actions"><span class="btn btn--sm">Approve</span><span class="btn btn--sm btn--secondary">Correct</span></div>`)}</div>
    <div class="breplace"><p class="breplace-k">Replaces</p><ul>${strike("Programme spreadsheets")}</ul></div></article>
  <article class="bcard bcard--subs"><div class="bcard-top"><span class="fig bcard-n">02</span><h3>${esc(groups[1].title)}</h3></div><p class="muted">${esc(groups[1].body)}</p>
    <div class="bmini bmini--today"><div class="bt"><span class="po-mono" aria-hidden="true">LS</span><div><b>Lower body A</b><span>Week 3 · Day 2 · 45 min</span></div>${chip("Today", "ink")}</div><ul class="bt-list"><li><span>Back squat</span><b class="fig">4 × 6 · 62.5 kg</b></li><li><span>Romanian deadlift</span><b class="fig">3 × 8 · 50 kg</b></li><li><span>Split squat</span><b class="fig">3 × 10 each</b></li></ul><div class="chip-row">${chip("Works offline", "ok")}${chip("Your name and icon", "line")}</div></div>
    <div class="breplace"><p class="breplace-k">Replaces</p><ul>${strike("A client training app")}${strike("A meal-planning app")}${strike("A client messaging app")}</ul></div></article>
  <article class="bcard bcard--biz"><div class="bcard-top"><span class="fig bcard-n">03</span><h3>${esc(groups[2].title)}</h3></div><p class="muted">${esc(groups[2].body)}</p>
    <div class="bmini">${statement({ title: "Monthly statement", period: "150 × AED 199", rows: [{ label: "Subscriptions", value: C.aed(ex.subscriptionMonthlyMinor) }, { label: "Our share, by band", value: "−" + C.aed(ex.commissionMinor), sub: true }], total: { label: "You keep, before card processing", value: C.aed(ex.beforeOtherCostsMinor) }, cls: "statement--mini" })}${paymentsNote()}</div>
    <div class="breplace"><p class="breplace-k">Replaces</p><ul>${strike("A website builder")}${strikeOff("A booking tool")}${strikeOff("A payment set-up and invoicing")}</ul></div></article>
  <article class="bcard bcard--trust"><div class="bcard-top"><span class="fig bcard-n">04</span><h3>${esc(groups[3].title)}</h3></div><p class="muted">${esc(fix(groups[3].body))}</p>
    <div class="bmini bmini--safe"><div class="bs-row"><span class="chip chip--err">Pain reported</span>${icon("arrow")}<b>Workout paused</b></div><div class="bs-row"><span class="chip chip--ink">To you</span><span>Layla reviews before training resumes</span></div><div class="bs-row"><span class="chip chip--line">Digital coach</span><span>Digital replies are always labelled</span></div><div class="bs-row">${icon("lock").replace("<svg", '<svg class="bs-lock"')}<span>Your workspace, isolated at the database layer</span></div></div>
    <div class="breplace"><p class="breplace-k">Built in</p><ul><li><span>Safety rules it can’t switch off</span>${chip("Included", "ok")}</li></ul></div></article>
</div>
<p class="fx-note reveal">[Tool-cost note from published price pages: needs owner and legal OK to name competitors, decision 17.]</p>`,
  });

  const SUB_CHIP = [chip("Included", "ok"), `<span class="chip chip--off if-payments-off">Not on yet</span><span class="if-payments-on">${chip("Included", "ok")}</span>`, chip("Included", "ok"), `${chip("Add-on", "line")}${statusChip("voice", "", { hideOn: true })}`, chip("Optional tier", "line"), chip("Included", "ok"), chip("Included", "ok"), chip("Included", "ok")];
  const getBand = band({
    id: "subscribers", labelledby: "subs-h",
    inner: `${head({ eyebrow: "Under your name", title: "What your subscribers get", id: "subs-h" })}
<div class="cols-4 getgrid reveal" data-stagger>${subs.map((c, i) => { budget("card", c.body, 18); return `<div class="card card--flat gcard"><span class="fig gcard-n">${String(i + 1).padStart(2, "0")}</span><h3>${esc(c.title)}</h3><p class="muted">${esc(c.body)}</p><div class="chip-row">${SUB_CHIP[i]}</div></div>`; }).join("")}</div>`,
  });

  const SCREENS = [
    ["Inbox", win("Inbox · Sample", `<div class="ib-item ib-item--off"><span class="chip chip--off">Handed to you</span><b>Hotel gym for two weeks</b><span>Draft: dumbbells to 20 kg</span></div><div class="ib-item ib-item--err"><span class="chip chip--err">Paused</span><b>Knee hurts when I squat</b><span>Workout paused · you were alerted</span></div><div class="ib-item"><span class="chip chip--ok">Sent on its own</span><b>Squats felt easy</b><span>Your approved reply · +2.5 kg · cites your rule</span></div>`), ["Everything that needs you, in one queue.", "Approve or correct; corrections become teaching.", "Safety pauses always arrive here first."], "/trainer-brain", "How your AI decides"],
    ["Today", phone({ body: todayScreen(), small: true, label: false, ariaLabel: "Sample subscriber app, Today screen" }), ["Today’s session first, then the week ahead.", "Works offline in the gym.", "Your name and icon on their home screen."], "/features/subscriber-app", "The subscriber app"],
    ["Logger", phone({ body: `<div class="lg"><p class="mp-k">Back squat · set 2 of 4</p><p class="lg-t"><span class="fig">62.5 kg × 6</span><small>target</small></p><div class="lg-in"><span><small>Reps</small><b class="fig">6</b></span><span><small>kg</small><b class="fig">62.5</b></span><span><small>In reserve</small><b class="fig">3</b></span></div><div class="po-cta">Log set</div><div class="lg-rest"><span>Rest</span><b class="fig">2:00</b></div><span class="chip chip--ok mp-chip">Saved offline</span></div>`, small: true, label: false, ariaLabel: "Sample set logger" }), ["Reps, load, effort and a note for every set.", "A rest timer between sets.", "Saved on the phone, synced later."], "/features/ai-training-plans", "AI training plans"],
    ["Statement", `<div class="sc-stmt">${statement({ title: "Monthly statement", period: "Layla Strength · October", rows: [{ label: "Subscriptions, 150 × AED 199", value: C.aed(ex.subscriptionMonthlyMinor) }, { label: "Our share, by band", value: "−" + C.aed(ex.commissionMinor), sub: true }, { label: "Card processing", value: "[rate]", sub: true }], total: { label: "You keep, before card processing", value: C.aed(ex.beforeOtherCostsMinor) } })}${paymentsNote()}</div>`, ["From gross revenue to net, every cost itemised.", "Our share by band: 25%, 20%, 15%, 10%.", "A ledger CSV export."], "/features/payments-and-payouts", "Payments and payouts"],
    ["Editor", win("Website editor · Desktop", `<div class="ed-tabs"><span class="on">Home</span><span>Coaching</span><span>Results</span><span>Contact</span></div><div class="ed-body"><ul class="ed-side"><li class="on">Hero</li><li>Programmes</li><li>Before and after</li><li>Pricing</li><li>FAQ</li></ul><div class="ed-canvas"><div class="po-poster"><span class="po-poster-k">Coached my way</span><span class="po-poster-t">Strength, planned daily.</span></div><div class="ed-blocks"><i></i><i></i><i></i></div></div></div><p class="mw-foot">282 layouts in 40 section families · desktop-only editor</p>`), ["Drag and drop sections across many pages.", "Private previews for phone, tablet and desktop.", "Publish when your launch checks pass."], "/features/website-and-domain", "Website and domain"],
  ];
  const screens = band({
    id: "screens", tone: "paper", labelledby: "screens-h",
    inner: `${head({ eyebrow: "Inside the product", title: "Five screens, up close", id: "screens-h", lede: "Choose a screen. Every one is a sample with the layout of the real thing." })}
<div class="scr reveal">
  <div class="tabs scr-tabs" role="tablist" aria-label="Product screens" data-tabs>${SCREENS.map(([t], i) => `<button class="tab" role="tab" id="scr-t${i}" aria-controls="scr-p${i}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${t}</button>`).join("")}<span class="tab-ind" aria-hidden="true"></span></div>
  ${SCREENS.map(([t, ui, pts, link, label], i) => `<div class="tabpanel scr-panel" role="tabpanel" id="scr-p${i}" aria-labelledby="scr-t${i}"${i ? " hidden" : ""}><div class="scr-ui" data-wc-skip>${ui}<div class="scr-label">${sampleLabel()}</div></div><div class="scr-copy"><h3>${t}</h3>${ticks(pts)}${secondaryLink({ label, href: link })}</div></div>`).join("")}
</div>`,
  });

  const REPL = [
    ["A website builder", "A desktop drag-and-drop builder with multiple pages, section templates, galleries, videos and private previews.", ""],
    ["A booking tool", "Session slots, paid bookings, cancellation rules and calendar export.", "pay"],
    ["A payment set-up and invoicing", "Card checkout in AED, trials, promotions, refunds, statements and payouts.", "pay"],
    ["A client training app", "A branded app with day-by-day plans, set logging, rest timers and offline mode.", ""],
    ["A meal-planning app", "The optional nutrition tier: meal plans, recipes, grocery lists and a food diary.", "tier"],
    ["A client messaging app", "Private chat, attachments, scheduled follow-ups and a labelled digital coach.", ""],
    ["Programme spreadsheets", "Templates, an exercise library, automatic scheduling and progress tracking.", ""],
  ];
  const replaces = band({
    id: "replaces", labelledby: "replaces-h",
    inner: `${head({ eyebrow: "Fewer subscriptions", title: "The 7 tools it replaces", id: "replaces-h", lede: "Many trainers stitch a business together from separate tools. Here is what each becomes in one workspace." })}
<div class="table-wrap reveal"><table class="table repl"><caption class="sr-only">Tool categories and what replaces them</caption><thead><tr><th scope="col">Instead of</th><th scope="col">In trainsyou</th><th scope="col">Status</th></tr></thead><tbody>
${REPL.map(([t, i, k]) => `<tr><th scope="row"><span class="strike">${esc(t)}</span></th><td>${esc(i)}</td><td>${k === "pay" ? statusChip("payments", "") : k === "tier" ? chip("Optional tier", "line") : chip("Included", "ok")}</td></tr>`).join("")}
</tbody></table></div>`,
  });

  const guides = band({
    id: "feature-guides", tone: "paper", labelledby: "guides-h",
    inner: `${head({ eyebrow: "Feature guides", title: "How each feature works", id: "guides-h", lede: "Eleven short guides, each with the screens your subscribers and you will see. Times show where each runs in our sample day." })}
<div class="gtiles reveal" data-stagger>${FEATURE_PATHS.map(guideTile).join("")}<a class="gtile gtile--all" href="#all-capabilities"><span class="gtile-k">The full list</span><b>All ${CAPABILITY_COUNT} capabilities, with their status</b><span class="fig gtile-big">${CAPABILITY_COUNT}</span><span class="gtile-go">${icon("arrow")}</span></a></div>`,
  });

  const caps = band({
    id: "all-capabilities", labelledby: "caps-h",
    inner: `${head({ eyebrow: "The full list", title: `All ${CAPABILITY_COUNT} capabilities`, id: "caps-h", lede: `One workspace runs the whole coaching business, in ${FEATURE_MATRIX.length} areas. Open an area to see each capability and its status.` })}
<div class="cap-legend reveal" role="note"><span class="cap-legend-k">Live today</span>${chip("Included", "ok")}${chip("Optional tier", "line")}<span class="cap-legend-k">Not on yet</span>${chip("Not on yet", "off")}<span class="fine">Not on yet marks what waits for subscriber payments, payouts, the voice add-on or an outside provider.</span></div>
<div class="caps reveal">${FEATURE_MATRIX.map((g) => `<section class="cap" id="cap-${g.id}" aria-labelledby="cap-${g.id}-h">
  <h3 class="cap-h" id="cap-${g.id}-h"><button type="button" class="cap-btn" aria-expanded="false" aria-controls="cap-${g.id}-p"><span class="cap-t">${esc(fix(g.title).replace("Your Trainer Brain", "Your AI (Trainer Brain)"))}</span><span class="cap-meta"><span class="fine">${esc(g.audience)}</span><b class="fig">${g.items.length}</b></span><span class="acc-icon">${icon("faq")}</span></button></h3>
  <div class="cap-panel" id="cap-${g.id}-p"><div class="cap-inner"><ul class="cap-list">${g.items.map((it) => `<li><div><b>${esc(it.name)}</b><span>${esc(it.detail)}</span></div><span class="cap-chip">${capChip(it)}</span></li>`).join("")}</ul>
  ${g.page && g.page !== "/follower-calculator" ? secondaryLink({ label: "More about " + fix(g.title).replace("Your Trainer Brain", "your AI").toLowerCase().replace("your ai", "your AI"), href: g.page }) : g.page ? secondaryLink({ label: "Try the follower calculator", href: g.page }) : ""}</div></div>
</section>`).join("")}</div>`,
  });

  const items = [
    { q: "Are all features available today?", a: "Most are. Anything that needs subscriber payments, payouts, the voice add-on or an outside provider shows “Not on yet” until it’s switched on. Everything else is in every workspace." },
    page.faqs.find((f) => /separate download/.test(f.q)),
  ];

  return {
    main: [heroHtml, bento, getBand, screens, replaces, guides.replace(/<\/div>\s*<\/section>\s*$/, `<p class="fine day-link"><a class="link" href="how-it-works.html#day">See the whole sample day${icon("arrow")}</a></p></div>\n</section>`), caps, faqBand(items, "fq")].join("\n"),
    closing: { secondary: { label: "See the pricing", href: "/pricing" } },
  };
}

/* ===================================================================== */
/* Feature detail pages: one spec per page (C5 + Concept B treatment)     */
/* ===================================================================== */
const phoneV = (body, label) => phone({ body, small: true, label: false, ariaLabel: label });
const ptHead = (title, sub) => `<div class="pt-head"><span class="po-mono" aria-hidden="true">LS</span><div><b>${title}</b><span>${sub}</span></div></div>`;
/** A vignette root: plays one state change once (product.js). */
/* Vignettes ship in their final state (is-b, swap B text exposed); product.js
   arms only the ones that start below the first screen. */
const vig = (inner, label, cls = "") => `<div class="vg is-b${cls ? " " + cls : ""}" data-vig role="group" aria-label="${esc(label)}">${inner.replace(/<span data-a>/g, '<span data-a aria-hidden="true">').replace(/<span data-b aria-hidden="true">/g, "<span data-b>")}</div>`;
/** Bilingual string for the subscriber-app vignette (real member-app strings). */
const t2 = (en, ar) => `<span class="t-en">${en}</span><span class="t-ar" lang="ar">${ar}</span>`;

const FEATURE_SPECS = {
  "/features/ai-training-plans": {
    lede: "Your AI builds a dated plan for each subscriber, adapts it as they train, and hands you anything it isn’t sure about.",
    hero: () => vig(phoneV(`${ptHead("Today", "Tue 14 Oct · week 3")}
      <div class="pt-card"><div class="pt-card-top"><b>Lower body A</b><span class="chip chip--ok">Works offline</span></div><span class="pt-meta">45 min · 3 exercises</span></div>
      <ul class="pt-list vg-list">
        <li class="vg-hot"><span>Back squat</span><b class="fig">4 × 6 · <span class="flash" data-vflash>${swap("60 kg", "62.5 kg")}</span> · 120 s</b></li>
        <li><span>Romanian deadlift</span><b class="fig">3 × 8 · 50 kg</b></li>
        <li><span>Split squat</span><b class="fig">3 × 10 each</b></li>
      </ul>
      <div class="vg-why" data-b>${tickDraw()}<span>Changed: two easy sessions, so +2.5 kg. Your rule.</span></div>
      <div class="po-cta">Start guided session</div>`, "Sample Today screen"), "Sample: after two easy sessions, today's back squat moves from 60 kg to 62.5 kg and the reason is shown."),
    sub: () => phoneV(`${ptHead("Plan", "Week 3 · this week")}
      <ul class="wk">${[["Mon 13", "Upper body A", "done"], ["Tue 14", "Lower body A", "today"], ["Wed 15", "Rest day", ""], ["Thu 16", "Upper body B", ""], ["Fri 17", "Lower body B", "review"]].map(([d, t, k]) => `<li class="wk-${k || "x"}"><span class="fig">${d}</span><b>${t}</b>${k === "done" ? ok() : ""}</li>`).join("")}</ul>
      <div class="mp-note mp-note--ok">${icon("info")}<span>Why it changed: your squats felt easy twice.</span></div>
      <div class="mp-note">${icon("pending")}<span>Your trainer is reviewing Friday’s change.</span></div>`, "Sample plan screen with reasons"),
    ctl: () => win("Automatic changes", `${[["Progressions", "Automatic"], ["Missed sessions", "Automatic"], ["Approved swaps", "Automatic"], ["Anything new", "To you"]].map(([a, b]) => `<div class="mw-row"><span>${a}</span><b>${b === "To you" ? `<span class="chip chip--off">To you</span>` : `<span class="chip chip--ok">${b}</span>`}</b></div>`).join("")}
      <div class="mw-meter"><div class="mw-row"><span>How sure it must be</span><b class="fig">80%</b></div><div class="tb-mwrap"><div class="meter" style="--v:.8"><i></i></div></div></div>`),
    run: (p) => runline(p.sections.find((s) => s.id === "practice").steps),
    runTitle: "How a plan runs each week", faqs: [/explain/, /trained on my data/, /write programmes/, /pain/],
  },
  "/features/subscriber-app": {
    lede: "An app with your name, colours and icon. It guides each workout, works offline in the gym and reports pain in one tap.",
    head: '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600&display=swap">',
    heroCls: "vg-stage--rtl",
    hero: () => `<div class="rtl-toggle" role="group" aria-label="Preview language"><span class="fine">Preview</span><button type="button" data-rtl-set="off" aria-pressed="true">EN</button><button type="button" data-rtl-set="on" aria-pressed="false">AR</button></div>` + vig(phone({ cls: "vg-rtl-phone", rtl: true, small: true, label: false, ariaLabel: "Sample: Layla Strength's app installs to the home screen", body: `${purl("layla-strength.trainsyou.com")}
      <div class="inst"><span class="app-icon-tile inst-icon" aria-hidden="true">LS</span><b>${t2("Add Layla Strength to your home screen", "إضافة Layla Strength إلى الشاشة الرئيسية")}</b><span class="inst-sub">${t2("Open today's training in one tap. It works on a weak connection too.", "تدريب اليوم بلمسة واحدة، ويعمل حتى مع اتصال ضعيف.")}</span><span class="po-cta">${t2("Install the app", "تثبيت التطبيق")}</span></div>
      <div class="home" data-b><span class="home-i"></span><span class="home-i"></span><span class="home-i home-i--ls"><span class="app-icon-tile" aria-hidden="true">LS</span><small>Layla Strength</small></span><span class="home-i"></span></div>
      <span class="chip chip--ok mp-chip">${t2("Saved on this phone — will sync", "محفوظ على هذا الهاتف، وستتم مزامنته")}</span>
      <div class="pt-tabs"><span class="on">${t2("Today", "اليوم")}</span><span>${t2("Plan", "الخطة")}</span><span>${t2("Progress", "التقدّم")}</span><span>${t2("Chat", "المحادثة")}</span></div>` }), "Sample: install sheet, then the app icon lands on the home screen."),
    sub: () => phone({ body: todayScreen(), small: true, label: false, ariaLabel: "Sample Today screen" }),
    ctl: () => win("Member app appearance", `<div class="ap-row"><span class="app-icon-tile" aria-hidden="true">LS</span><div><b>Layla Strength</b><span>Icon, name and colours</span></div></div>
      <div class="ap-sw" aria-hidden="true"><i style="background:#171917"></i><i style="background:#D5F24A"></i><i style="background:#F3F4F0"></i><i style="background:#FFFFFF"></i></div>
      <p class="mw-k">Approved swaps</p>${mrow("Back squat", "Goblet squat · Leg press")}${mrow("Romanian deadlift", "Hip thrust")}<p class="mw-foot">Separate from your website design.</p>`),
    run: (p) => runline(p.sections.find((s) => s.id === "session").steps),
    runTitle: "A session, step by step", faqs: [/why their plan/, /download/, /without a connection/, /Arabic/],
  },
  "/features/website-and-domain": {
    lede: "A desktop editor with drag-and-drop sections and many pages. Preview every screen, then publish at your coaching address.",
    heroWide: true,
    hero: () => vig(win("Website editor · Desktop", `<div class="ed-tabs"><span class="on">Home</span><span>Coaching</span><span>Results</span><span>Contact</span></div>
      <div class="ed-body"><ul class="ed-side"><li>Hero</li><li>Programmes</li><li class="vg-new-l">Before and after</li><li>Pricing</li><li>FAQ</li><li>Contact form</li></ul>
      <div class="ed-canvas"><div class="po-poster"><span class="po-poster-k">Coached my way</span><span class="po-poster-t">Strength, planned daily.</span></div><div class="ed-new" data-b><span class="ed-ph"></span><span class="ed-ph"></span><small>Before and after</small></div><div class="ed-blocks"><i></i><i></i></div></div></div>
      <div class="ed-foot"><span class="chip chip--line">282 layouts in 40 section families</span><span class="chip chip--line">Desktop-only editor</span><span class="chip chip--line">Domain price shown before you buy</span></div>`, "vg-ed"), "Sample: a before-and-after section drops into the page in the desktop editor."),
    sub: () => phoneV(`${purl("layla-strength.trainsyou.com")}<div class="po-poster"><span class="po-poster-k">Coached my way</span><span class="po-poster-t">Strength, planned daily.</span></div>
      <div class="site-prog"><b>12-week strength</b><span>Day-by-day plan, coached your way</span></div><div class="site-ba"><span></span><span></span></div><div class="site-form"><span>Message Layla</span><i></i><div class="po-cta">Send</div></div>`, "Sample published website on a phone"),
    ctl: () => win("Publication history", `${mrow("v3 · 13 Oct", `<span class="chip chip--ok">Live</span>`)}${mrow("v2 · 6 Oct", `<span class="btn btn--sm btn--secondary">Restore to draft</span>`)}${mrow("v1 · 29 Sep", "")}<div class="mw-publish"><span>Draft saved 2 min ago</span><span>Undo · Redo</span></div>`),
    run: (p) => `<p class="lede run-lede reveal">${esc(p.sections.find((s) => s.id === "modules").body[0].split(". ")[0])}.</p>${runline(p.sections.find((s) => s.id === "launch").steps)}`,
    runTitle: "From starter to published site", faqs: [/Which sections/, /on my phone/, /AI starter/, /own domain/],
  },
  "/features/nutrition": {
    lede: "An optional higher-priced tier. Weekly meal plans, recipes and grocery lists that follow how you teach nutrition.",
    extraChips: chip("Can’t be bought alone", "line"), money: "nutrition",
    hero: () => vig(phoneV(`${ptHead("Meals", "Week 3 · Monday")}
      <div class="days" aria-hidden="true">${["M", "T", "W", "T", "F", "S", "S"].map((x, i) => `<span${i === 0 ? ' class="on"' : ""}>${x}</span>`).join("")}</div>
      <ul class="meals">${[["Breakfast", "Oats, berries, yoghurt", "420"], ["Lunch", "Chicken rice bowl", "610"], ["Dinner", "Salmon, potatoes, greens", "560"]].map(([k, t, n]) => `<li><span>${k}</span><b>${t}</b><span class="fig">${n} kcal</span></li>`).join("")}</ul>
      <div class="photo-est"><span class="plate" aria-hidden="true"></span><div><small>Meal photo · estimate</small><b>Chicken rice bowl · ~610 kcal</b></div><span class="pe-act">${swap(`<span class="chip chip--line">Confirm?</span>`, `<span class="chip chip--ok">Logged</span>`)}</span></div>
      <div class="mp-card mp-card--row"><b>Grocery list</b><span class="fig">18 items</span></div>`, "Sample weekly meal plan"), "Sample: a meal-photo estimate is confirmed by the subscriber and logged."),
    sub: () => phoneV(`<p class="mp-k">Grocery list · week 3</p><ul class="groc">${["Chicken breast · 1.2 kg", "Rice · 1 kg", "Greek yoghurt · 4", "Berries · 2 punnets", "Oats · 500 g", "Salmon · 4 fillets"].map((x, i) => `<li${i < 2 ? ' class="done"' : ""}><i></i><span>${x}</span></li>`).join("")}</ul><div class="mp-note mp-note--ok">${icon("info")}<span>Uses what’s already in the pantry.</span></div>`, "Sample grocery list"),
    ctl: () => win("Nutrition · Exceptions", `${mrow("Calorie target", `<span class="fig">2,200</span> kcal`, `<span class="chip chip--ink">Set by you</span>`)}<div class="mw-rule mw-rule--flag"><div><b>Subscriber B asks for a vegan week</b><span>Outside your rules · comes to you</span></div><span class="chip chip--off">Review</span></div>${mrow("Your teaching", "Cases, recipes, calorie methods", `<span class="chip chip--ok">Tested</span>`)}`),
    run: (p) => runline(p.sections.find((s) => s.id === "week").steps),
    runTitle: "How a nutrition week works", faqs: [/cost the subscriber more/, /edit a subscriber/, /medical/, /nutrition only/],
  },
  "/features/voice-coach": {
    lede: "Guided workouts in your verified voice, shaped by how you coach. Your consent, and you can withdraw it any time.",
    hero: () => vig(phoneV(`<p class="mp-k">Voice-led session</p><div class="vc-top"><span class="app-icon-tile vc-av" aria-hidden="true">LS</span><div><b>Back squat</b><span>Set 2 of 4 · 62.5 kg × 6</span></div></div>
      <div class="wave" aria-hidden="true">${[6, 10, 16, 9, 20, 26, 14, 22, 30, 18, 12, 24, 16, 28, 20, 10, 18, 8, 14, 6].map((h) => `<i style="--h:${h}"></i>`).join("")}</div>
      <p class="vc-cap">${swap("“Brace, breathe, drive up. Six reps.”", "“Good set. Rest two minutes.”")}</p>
      <div class="vc-bar" aria-hidden="true"><i></i></div>
      <div class="vc-ctl"><span class="vc-btn">Pause</span><span class="vc-btn vc-btn--pain">Report pain</span></div>
      <div class="mp-card mp-card--row"><b>Own-music mode</b><span class="chip chip--line">On</span></div>
      <p class="vc-fine">Your verified voice · consent can be withdrawn · own-music mode</p>`, "Sample voice session player"), "Sample: the voice cue moves from the set to the rest."),
    sub: () => phoneV(`<p class="mp-k">Own-music mode</p><div class="mp-card"><b>Short cues over your music</b><small>Tap to talk · your music app keeps playing</small></div><div class="vc-ctl"><span class="vc-btn">Tap to talk</span></div><div class="vc-ctl"><span class="vc-btn">Pause</span><span class="vc-btn vc-btn--pain">Report pain</span></div><p class="vc-fine">Voice generated from Layla’s, with her consent.</p>`, "Sample own-music mode"),
    ctl: () => win("Voice consent", `${mrow("Identity", "Verified", ok())}${mrow("Consent", "Recorded 12 Oct")}${mrow("Narration style", "Calm, direct, counts reps")}${mrow("Add-on price", "You set it")}<div class="mw-publish"><span class="btn btn--sm btn--secondary">Withdraw consent</span><span>Stops at once</span></div>`),
    run: (p) => runline(p.sections.find((s) => s.id === "how").steps),
    runTitle: "How the voice add-on works", faqs: [/coaching style/, /own music/, /Who can hear/, /withdraw/],
  },
  "/features/bookings": {
    lede: "Sell one-to-one sessions next to your AI coaching. Your cancellation rules decide refunds automatically.",
    hero: () => vig(phoneV(`${ptHead("Book time with Layla", "One-to-one · 60 min")}
      <div class="bk-price"><span class="fig">AED 250</span><span>a session</span></div>
      <div class="days days--wide" aria-hidden="true">${["Mon 20", "Tue 21", "Wed 22", "Thu 23"].map((x, i) => `<span${i === 2 ? ' class="on"' : ""}>${x}</span>`).join("")}</div>
      <ul class="slots"><li class="full"><b class="fig">07:00</b><span>Full</span></li><li class="vg-pick"><b class="fig">18:00</b><span>2 of 4 places left</span></li><li><b class="fig">19:30</b><span>4 of 4 places left</span></li></ul>
      <p class="bk-pol">${icon("info")}Free cancellation up to 24 h before</p>
      <div class="po-cta bk-cta">${swap("Choose a time", "Reserve · AED 250")}</div>`, "Sample booking screen"), "Sample: a subscriber picks the 18:00 slot and the reserve button shows the price."),
    sub: () => phoneV(`<p class="mp-k">Your bookings</p><div class="mp-card"><b>Thu 23 Oct · 18:00</b><small>One-to-one · Studio, Al Quoz</small></div><div class="mp-note">${icon("pending")}<span>Reminder the day before.</span></div><div class="mp-note mp-note--ok">${icon("info")}<span>Free cancellation until Wed 18:00.</span></div><div class="po-cta">Add to calendar</div>`, "Sample bookings list"),
    ctl: () => win("Session settings", `${mrow("Time", "Thu · 18:00 · weekly")}${mrow("Capacity", `<span class="fig">4</span> places`)}${mrow("Price", `<span class="fig">AED 250</span>`, statusChip("payments", "", { hideOn: true }))}${mrow("Cancellation window", `<span class="fig">24</span> h`)}${mrow("Location", "Studio, Al Quoz")}`),
    run: (p) => runline(p.sections.find((s) => s.id === "how").steps),
    runTitle: "How bookings work", faqs: [/show up/, /take place/, /free sessions/, /commission/],
  },
  "/features/chat-and-digital-coach": {
    lede: "Private chat with you, plus a clearly labelled digital coach that answers from your teaching. Take over any time.",
    hero: () => vig(phoneV(`${ptHead("Layla Strength", "Chat")}
      <p class="bubble mp-b">Here’s my food diary for the week.</p>
      <div class="att">${icon("info")}<span>week-3-diary.pdf</span></div>
      <p class="bubble-meta">Digital coach · from Layla’s teaching</p>
      <p class="bubble mp-b dc">Thanks. Tuesday and Friday look light on protein.</p>
      <div class="takeover" data-b><span class="chip chip--ink">You took over</span><span>Digital coach paused</span></div>
      <p class="bubble bubble--me mp-b" data-b>I’ll go through this with you tonight. Layla</p>`, "Sample chat screen"), "Sample: the trainer takes over the chat and the digital coach pauses."),
    sub: () => phoneV(`<p class="bubble-meta">Layla</p><p class="bubble mp-b">Great week. Keep Thursday light.</p><p class="bubble-meta">Digital coach · from Layla’s teaching</p><p class="bubble mp-b dc">Your next session is Lower body B on Friday.</p><div class="mp-note">${icon("info")}<span>Layla took over this chat.</span></div>`, "Sample chat with labelled replies"),
    ctl: () => win("Conversations", `<div class="mw-rule"><div><b>Subscriber A</b><span>Digital coach answering</span></div><span class="chip chip--line">Digital</span></div><div class="mw-rule"><div><b>Subscriber B</b><span>You took over</span></div><span class="btn btn--sm btn--secondary">Hand back</span></div><div class="mw-rule mw-rule--flag"><div><b>Subscriber C</b><span>Outside your rules</span></div><span class="chip chip--off">To you</span></div>`),
    run: (p) => runline(p.sections.find((s) => s.id === "flow").steps),
    runTitle: "How a conversation flows", faqs: [/photos/, /does not know/, /schedule/, /think the digital coach/],
  },
  "/features/progress-and-client-twin": {
    lede: "Progress and coaching context for each subscriber, every fact with its date and source. Unknowns stay unknown.",
    heroWide: true,
    hero: () => vig(win("Client Twin · Subscriber A", `<div class="tw">${[["Goal", "Squat 100 kg", "Intake · 2 Oct"], ["Training days", "Mon, Wed, Fri", "Intake · 2 Oct"], ["Equipment", "Full gym", "Edited by subscriber · 9 Oct"], ["Best back squat", "62.5 kg × 6", "Logged · 14 Oct"]].map(([k, v, s]) => `<div class="tw-row"><span>${k}</span><b>${v}</b><small>${s}</small></div>`).join("")}
      <div class="tw-row tw-row--hot"><span>Average sleep</span><b>${swap('<span class="unk">unknown</span>', "7 h 10 min")}</b><small>${swap("Not shared", "Apple Health · 20 Oct")}</small></div></div>
      <div class="mw-publish"><span>Apple Health export</span>${swap(`<span class="btn btn--sm btn--secondary">Import</span>`, `<span class="chip chip--ok">Imported</span>`)}</div>`, "vg-tw"), "Sample Client Twin: sleep was unknown until the subscriber imported an Apple Health export."),
    sub: () => phoneV(`<p class="mp-k">Progress</p><div class="pg-stats"><div><span class="fig">18</span><small>Sessions</small></div><div><span class="fig">62.5</span><small>Best squat, kg</small></div></div><div class="pg-bars" aria-hidden="true">${[40, 52, 48, 61, 66, 72].map((h) => `<i style="--h:${h}"></i>`).join("")}</div><small class="pg-cap">Training volume, last 6 weeks</small>`, "Sample progress page"),
    ctl: () => win("Wearable policy", `${mrow("Apple Health", "May inform coaching", ok())}${mrow("WHOOP", "With permission", ok())}${mrow("Amazfit / Zepp", "", `<span class="chip chip--off">Not on yet</span>`)}<p class="mw-foot">Your AI uses only what the subscriber agreed to.</p>`),
    run: (p) => `<div class="split run-split"><div class="reveal">${ticks(p.sections.find((s) => s.id === "twin").bullets)}</div><div class="card card--paper reveal"><h3>Wearables and consent</h3><p class="muted">${esc(fix(p.sections.find((s) => s.id === "consent").body[0]))}</p></div></div>`,
    runTitle: "What the Client Twin holds", faqs: [/come from/, /see a subscriber/, /own progress/, /wearables/],
  },
  "/features/payments-and-payouts": {
    lede: "Subscribers pay by card in AED. You set price and billing, and get one statement and a monthly payout.",
    money: "payments", heroWide: true,
    hero: () => {
      const ex = C.compactEarnings(150, 199, 250);
      return vig(`${statement({ title: "Monthly statement", period: "Layla Strength · October", rows: [{ label: "Subscriptions, 150 × AED 199", value: C.aed(ex.subscriptionMonthlyMinor) }, { label: "Our share: 100 × 25%", value: "−" + C.aed(ex.bands[0].commissionMinor), sub: true }, { label: "Our share: 50 × 20%", value: "−" + C.aed(ex.bands[1].commissionMinor), sub: true }, { label: "Card processing", value: "[rate]", sub: true }], total: { label: "You keep, before card processing", value: C.aed(ex.beforeOtherCostsMinor) }, note: "Payout: monthly, to a verified UAE IBAN, once payouts are on.", cls: "vg-stmt" })}<div class="vg-note">${paymentsNote()}</div>`, "Sample monthly statement");
    },
    sub: () => phoneV(`${ptHead("Layla Strength", "Checkout")}<div class="mp-card"><b>Workouts</b><span class="fig">AED 199</span><small>a month · 7-day free trial</small></div>${mrow("Card", "•••• 4242")}<div class="po-cta">Pay by card</div><p class="vc-fine">Renews monthly · stop renewal any time</p>`, "Sample checkout screen"),
    ctl: () => win("Billing", `<div class="mw-seg" aria-hidden="true"><span class="on">Monthly</span><span>Upfront</span></div>${mrow("Programme length", `<span class="fig">3</span> months`)}${mrow("Free trial", `<span class="fig">7</span> days`)}${mrow("Promotion code", "LAUNCH10")}<div class="mw-rule"><div><b>Refund request</b><span>Subscriber C · October</span></div><span class="btn btn--sm btn--secondary">Decide</span></div>`),
    run: (p) => `<div class="split run-split"><div class="reveal"><p class="lede">${esc(p.sections.find((s) => s.id === "billing").body[0])}</p></div><div class="card card--paper reveal"><h3>What your statement shows</h3>${ticks(p.sections.find((s) => s.id === "statement").bullets)}</div></div>`,
    runTitle: "Billing and your statement", faqs: [/currency/, /cancel/, /get paid/, /sets the subscription/],
  },
  "/features/safety": {
    lede: "Pain, medical issues and red flags pause the workout and come to you. Enforced in code, outside the AI.",
    hero: () => vig(phoneV(`<p class="mp-k">Guided session · set 2 of 4</p><div class="mp-card"><b>Back squat</b><span class="fig">62.5 kg × 6</span><small>Rest 120 s after this set</small></div>
      <div class="sf-btns"><span class="vc-btn">Log set</span><span class="vc-btn vc-btn--pain sf-pain">Report pain</span></div>
      <div class="sf-paused" data-b><b>Workout paused</b><span>Layla has been alerted and will review it.</span><small>This is coaching, not medical advice.</small></div>`, "Sample guided session")
      + `<div class="sf-alert" data-b aria-hidden="true">${win("Safety · to you", `<div class="mw-rule mw-rule--err"><div><b>Subscriber A reported pain</b><span>Training paused · review</span></div><span class="chip chip--err">Now</span></div>`)}</div>`, "Sample: the subscriber taps Report pain, the workout pauses and the trainer is alerted.", "vg-safety"),
    sub: () => phoneV(`<div class="sf-paused sf-paused--static"><b>Workout paused</b><span>Your trainer will review it.</span><small>This is coaching, not medical advice.</small></div><p class="bubble-meta">Layla</p><p class="bubble mp-b">Rest the knee today. We’ll adjust Thursday together.</p>`, "Sample paused workout"),
    ctl: () => win("Red flags", `<p class="mw-k">Always on</p><div class="rf">${["Pain reports", "Pregnancy", "Medical red flags"].map((x) => `<span class="chip chip--ink">${icon("lock")}${x}</span>`).join("")}</div><p class="mw-foot">Built in. You can’t remove these.</p><p class="mw-k">Yours</p><div class="rf">${["Recent surgery", "Shoulder injury"].map((x) => `<span class="chip chip--line">${x}<span aria-hidden="true">×</span></span>`).join("")}</div><div class="mw-row"><span>Add a red flag</span><b></b></div>`),
    run: (p) => runline(p.sections.find((s) => s.id === "pain").steps),
    runTitle: "When a subscriber reports pain", faqs: [/decide whether pain/, /own red flags/, /switch safety/],
  },
  "/features/team": {
    lede: "Invite staff coaches and finance members. Each role opens only the screens it needs. You keep the brand and your AI.",
    heroWide: true,
    hero: () => vig(win("Team · Roles", `<div class="roles"><span class="roles-hl" aria-hidden="true"></span><table class="rm"><caption class="sr-only">What each role can open (sample)</caption><thead><tr><th scope="col"><span class="sr-only">Area</span></th><th scope="col">Owner</th><th scope="col">Staff coach</th><th scope="col">Finance</th></tr></thead><tbody>
      ${[["Coaching and chat", 1, 1, 0], ["Your AI and reviews", 1, 1, 0], ["Earnings and payouts", 1, 0, 1], ["Design", 1, 0, 0], ["Team and ownership", 1, 0, 0]].map(([a, ...v]) => `<tr><th scope="row">${a}</th>${v.map((x) => `<td>${x ? ok() : no()}<span class="sr-only">${x ? "Yes" : "No"}</span></td>`).join("")}</tr>`).join("")}</tbody></table></div>`, "vg-roles"), "Sample roles matrix: owner, staff coach and finance."),
    sub: () => phoneV(`${ptHead("Layla Strength", "Chat")}<p class="bubble-meta">Staff coach · Layla Strength</p><p class="bubble mp-b">Nice work today. Same weight on Friday.</p><p class="bubble-meta">Digital coach · from Layla’s teaching</p><p class="bubble mp-b dc">Friday is Lower body B, 45 minutes.</p><div class="mp-note mp-note--ok">${icon("info")}<span>One brand, whoever replies.</span></div>`, "Sample chat with a staff coach"),
    ctl: () => win("Invite", `${mrow("Email", "coach@example.com")}${mrow("Role", "Staff coach")}<div class="mw-publish"><span class="btn btn--sm">Send invite</span><span>Their own account, no shared passwords</span></div><p class="mw-k">Activity</p>${mrow("Role changed · Finance", "Recorded")}`),
    run: (p) => `<div class="split run-split"><div class="reveal">${table({ caption: p.sections.find((s) => s.id === "roles").table.caption, columns: p.sections.find((s) => s.id === "roles").table.columns, rows: p.sections.find((s) => s.id === "roles").table.rows.map((r) => r.map(fix)) })}</div><div class="reveal">${runline(p.sections.find((s) => s.id === "invite").steps)}</div></div>`,
    runTitle: "Roles and invitations", faqs: [/reply to subscribers/, /read subscribers/, /remove a team member/, /owns the brand/],
  },
};

/** B money lead for payments and nutrition: the AED effect, with status. */
function moneyBand(kind) {
  if (kind === "payments") {
    return band({
      id: "aed", tone: "wash", labelledby: "aed-h",
      inner: `<div class="split split--center fd-money">
  <div class="reveal">${eyebrow("Your price, your take-home")}<h2 id="aed-h">What you keep, in AED</h2>
    <p class="lede">You set the price. Our share falls from 25% to 10% as you grow, and each rate applies only to its band.</p>
    <div class="chip-row fd-bill">${["Monthly", "Upfront", "Free trial days", "Promotion codes"].map((x) => `<span class="chip chip--line chip--plain">${x}</span>`).join("")}</div>
    ${secondaryLink({ label: "Pricing in detail", href: "/pricing" })}</div>
  <div class="reveal">${takeHomeTile({ subscribers: 150, price: 199, name: "takehome_payments", title: "Try your numbers" })}</div>
</div>`,
    });
  }
  const e = C.estimateEarnings({ ...C.DEFAULT_EARNINGS_INPUTS, subscribers: 100, nutritionSharePct: 30, voiceSharePct: 0, sessionsPerMonth: 0 });
  return band({
    id: "aed", tone: "wash", labelledby: "aed-h",
    inner: `<div class="split split--center fd-money">
  <div class="reveal">${eyebrow("The AED effect")}<h2 id="aed-h">A higher tier lifts your average</h2>
    <p class="lede">Workouts at AED 199, workouts and nutrition at AED 299. Each subscriber who adds nutrition raises your average price.</p>
    ${secondaryLink({ label: "Estimate my earnings", href: "/earnings-calculator" })}</div>
  <div class="tile nt reveal" data-calc="earnings" data-full data-calc-name="nutrition_tier">
    <div class="tile-head"><p class="eyebrow">Your average price</p><div class="chip-row">${sampleLabel("Sample")}${statusChip("payments", "subscriber payments")}</div></div>
    <input type="hidden" data-in="subscribers" value="100"><input type="hidden" data-in="price" value="199"><input type="hidden" data-in="nutritionPrice" value="299">
    <div class="nt-tiers"><div class="nt-tier"><span>Workouts</span><b class="fig">AED 199</b></div><div class="nt-tier nt-tier--n"><span>Workouts + Nutrition</span><b class="fig">AED 299</b></div></div>
    <div class="range"><div class="range-top"><label for="nt-share">Subscribers who add nutrition</label>${val("30%", { cls: "fig", w: "4ch", align: "end", attrs: "data-nt-share" })}</div>
      <input id="nt-share" type="range" data-in="nutritionShare" min="0" max="100" step="5" value="30" data-valuetext="{v}% add nutrition" aria-valuetext="30% add nutrition"><div class="range-ends" aria-hidden="true"><span>0%</span><span>100%</span></div></div>
    <div class="nt-out"><span>Average a month, per subscriber</span>${val(C.aed(e.averageMonthlyMinor), { out: "avg", cls: "fig fig-band keep", w: "8ch", align: "end" })}</div>
    <div class="nt-mix" aria-hidden="true"><i class="nt-mix-w"></i><i class="nt-mix-n" style="--s:.3"></i></div>
    ${paymentsNote()}
    <p class="sr-only" aria-live="polite" data-nt-live></p>
  </div>
</div>`,
  });
}

function featurePage(ctx) {
  const page = ctx.page, spec = FEATURE_SPECS[ctx.path], [h1, mark] = FEATURE_H1[ctx.path];
  const sec = (id) => page.sections.find((s) => s.id === id);
  const does = sec("does").bullets.slice(0, 5);
  const heroVisual = stage(spec.hero(), { cls: "vg-stage" + (spec.heroWide ? " vg-stage--wide" : "") + (spec.heroCls ? " " + spec.heroCls : "") });
  const money = !!spec.money;

  const heroHtml = hero({
    eyebrow: "Feature", h1, mark, lede: spec.lede, cls: "fd-hero" + (spec.heroWide ? " fd-hero--wide" : ""),
    crumbs: crumbs(page, pageFor),
    chips: featureChips(page) + (spec.extraChips || ""),
    secondary: { label: "Back to all features", href: "/features" },
    after: money || page.availability?.includes("payments") ? `<div class="ph-strip">${statusStrip({ href: "pricing.html#status" })}</div>` : "",
    visual: heroVisual,
  });

  const doesBand = band({
    id: "does", tone: money ? "white" : "paper", labelledby: "does-h",
    inner: `<div class="split fd-does"><div class="reveal">${eyebrow(page.navLabel)}<h2 id="does-h">What it does</h2></div>
<ol class="fd-list reveal" data-stagger>${does.map((b, i) => `<li><span class="fig">${String(i + 1).padStart(2, "0")}</span><p>${esc(fix(b))}</p></li>`).join("")}</ol></div>`,
  });

  const sees = band({
    id: "sees", tone: money ? "paper" : "white", labelledby: "sees-h",
    inner: `<div class="fd-pair">
  <div class="fd-dev reveal" data-wc-skip>${spec.sub()}<div class="fd-label">${sampleLabel()}</div></div>
  <div class="fd-copy reveal">${eyebrow("Subscriber view")}<h2 id="sees-h">What your subscriber sees</h2>${ticks(sec("subscriber").bullets)}</div>
</div>`,
  });
  const control = band({
    id: "control", tone: money ? "white" : "paper", labelledby: "ctl-h",
    inner: `<div class="fd-pair fd-pair--flip">
  <div class="fd-copy reveal">${eyebrow("Your controls")}<h2 id="ctl-h">What you control</h2>${ticks(sec("control").bullets)}</div>
  <div class="fd-dev fd-dev--win reveal" data-wc-skip>${spec.ctl()}<div class="fd-label">${sampleLabel()}</div></div>
</div>`,
  });
  const run = band({
    id: "runs", tone: money ? "paper" : "white", labelledby: "run-h", cls: money ? "" : "band-rule",
    inner: `${head({ eyebrow: "How it runs", title: spec.runTitle, id: "run-h" })}${spec.run(page)}`,
  });
  const faqItems = pickFaqs(page, spec.faqs);
  const related = `<div class="fd-related"><p class="eyebrow eyebrow--muted">Related features</p>${relatedTiles(page.related.filter((p) => p.startsWith("/features/") || p === "/trainer-brain" || p === "/demo" || p === "/security-and-privacy" || p === "/pricing" || p === "/earnings-calculator" || p === "/follower-calculator"))}${secondaryLink({ label: "All features", href: "/features" })}</div>`;

  return {
    main: [heroHtml, money ? moneyBand(spec.money) : "", doesBand, sees, control, run, faqBand(faqItems, "ff", "Questions, answered", related)].join("\n"),
    closing: { secondary: { label: "Back to all features", href: "/features" } },
    head: spec.head,
  };
}

/* ===================================================================== */
/* /demo — the hands-on proof (C6): four decisions, change the rule,      */
/* how sure it must be. Scripted; no AI model is called.                  */
/* ===================================================================== */
const SCENARIOS = [
  {
    tab: "Squats felt easy", lane: 0, sure: 86, label: "Applied automatically", chipK: "ok",
    msg: "Week three done. Squats felt easy.", meta: "Subscriber A · week 3",
    rule: "After 2 sessions at 3+ reps in reserve, add 2.5 kg to the main lower-body lift.",
    outK: "Back squat · Monday", outV: `<s>60 kg</s> → 62.5 kg`,
    reply: "Nice work. Monday’s squat moves to 62.5 kg because both sessions felt easy.",
    pays: "progress planned for them, your way.",
  },
  {
    tab: "Missed yesterday", lane: 0, sure: 92, label: "Rescheduled automatically", chipK: "ok",
    msg: "I missed yesterday. Should I do two sessions today?", meta: "Subscriber B · week 2",
    rule: "Never stack two sessions in a day. Move the missed one to the next free day; keep a rest day between hard sessions.",
    outK: "Lower body B", outV: `Thursday · Friday rest`,
    reply: "No need to double up. Lower body B moves to Thursday, and Friday is now a rest day.",
    pays: "a week that bends around real life.",
  },
  {
    tab: "Hotel gym", lane: 1, sure: 41, label: "Handed to you", chipK: "off",
    msg: "I’m travelling for two weeks with only a hotel gym. Can you rebuild my plan?", meta: "Subscriber C · week 5",
    rule: "", noRule: "Nothing you taught covers this equipment.",
    outK: "Draft for you", outV: `Dumbbells to 20 kg, same days`, approve: true,
    reply: "Good to know. Layla will confirm a plan for the hotel gym.",
    pays: "you, when it matters.",
  },
  {
    tab: "Knee hurts", lane: 2, sure: null, label: "Workout paused", chipK: "err",
    msg: "My knee hurts when I squat today.", meta: "Subscriber D · week 4",
    rule: "", safety: "Pain is a safety rule, enforced in code, outside the AI.",
    outK: "Today’s workout", outV: `Paused · you were alerted`,
    reply: "", paused: true,
    pays: "safety that never waits for a setting.",
  },
];

function demoConsole() {
  const s0 = SCENARIOS[0];
  const tabs = SCENARIOS.map((s, i) => `<button class="dm-tab" role="tab" id="dm-t${i}" aria-controls="dm-panel" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" data-key="${["squats_easy", "missed_session", "hotel_gym", "knee_pain"][i]}" data-sure="${s.sure ?? ""}" data-lane="${s.lane}" data-pays="${esc(s.pays)}" data-say="${esc(`${s.tab}: ${s.label}. ${s.outK}: ${s.outV.replace(/<[^>]+>/g, "")}.`)}"><span class="dm-tab-t">${esc(s.tab)}</span><span class="chip chip--${s.chipK}">${esc(s.label.replace(" automatically", ""))}</span></button>`).join("");
  const phoneLayers = SCENARIOS.map((s, i) => `<div class="dm-l${i === 0 ? " is-on" : ""}" data-l="${i}">
    <p class="bubble bubble--me dm-sub">${esc(s.msg)}</p>
    <div class="dm-rbox"><div class="dm-typing" aria-hidden="true"><i></i><i></i><i></i></div>
    ${s.paused ? `<div class="sf-paused dm-reply"><b>Workout paused</b><span>Layla has been alerted and will review it.</span><small>This is coaching, not medical advice.</small></div>`
      : `<div class="dm-reply"><p class="bubble-meta">Digital coach · from Layla’s teaching</p><p class="bubble dc">${esc(s.reply)}</p></div>`}</div>
    <div class="dm-dec dm-reply" aria-hidden="true"><span class="chip chip--${s.chipK}">${esc(s.label)}</span></div>
  </div>`).join("");
  const msgLayers = SCENARIOS.map((s, i) => `<div class="dm-l${i === 0 ? " is-on" : ""}" data-l="${i}"><p class="bubble-meta">${esc(s.meta)}</p><p class="bubble">${esc(s.msg)}</p>
    <div class="cf-rule dm-rule${s.rule ? "" : s.safety ? " dm-rule--safe" : " dm-rule--none"}">${s.rule ? `<span class="chip chip--ink">Your rule</span><span>${esc(s.rule)}</span>` : s.safety ? `<span class="chip chip--err">Safety rule</span><span>${esc(s.safety)}</span>` : `<span class="chip chip--off">No rule</span><span>${esc(s.noRule)}</span>`}</div></div>`).join("");
  const outLayers = SCENARIOS.map((s, i) => `<div class="dm-l dm-out-l${i === 0 ? " is-on" : ""}" data-l="${i}"><div class="dm-out dm-out--${s.chipK}">${tickDraw()}<span class="dm-out-k">${esc(s.outK)}</span><span class="fig dm-out-v">${s.outV}</span></div>
    ${s.approve ? `<div class="dm-approve" data-approve><button type="button" class="btn btn--sm" data-ap="approve">Approve</button><button type="button" class="btn btn--sm btn--secondary" data-ap="correct">Correct</button><span class="dm-ap-msg" data-ap-msg></span></div>` : ""}</div>`).join("");

  return `<div class="dm" data-demo data-stage="done">
  <div class="dm-tabs" role="tablist" aria-label="Four scripted decisions">${tabs}</div>
  <div class="dm-panel" role="tabpanel" id="dm-panel" aria-labelledby="dm-t0">
    <div class="dm-grid">
      <div class="dm-phone">${phone({ small: true, label: false, ariaLabel: "Sample subscriber chat", body: `${ptHead("Layla Strength", "Chat")}<div class="dm-stack dm-chat">${phoneLayers}</div>` })}</div>
      <div class="dm-inbox">${win("Inbox · Your workspace", `
        <div class="dm-stack">${msgLayers}</div>
        <div class="dm-sure"><span>How sure it is</span>${val(s0.sure + "%", { cls: "fig", w: "4ch", align: "end", attrs: "data-dm-sure" })}</div>
        <div class="dm-meter"><div class="meter" style="--v:${s0.sure / 100}"><i></i></div><span class="dm-th" title="How sure it must be: 80%"></span></div>
        <p class="dm-th-k">Line: how sure it must be, 80%</p>
        <div class="lanes dm-lanes" role="list" style="--lane:${s0.lane}" data-lane="${s0.lane}"><span class="dm-ind" aria-hidden="true"><i></i><i></i><i></i></span>
          <div class="lane is-active" role="listitem"><span>Automatic</span></div><div class="lane lane--off" role="listitem"><span>Unsure → to you</span></div><div class="lane lane--err" role="listitem"><span>Safety → paused, to you</span></div></div>
        <div class="dm-stack dm-outs">${outLayers}</div>`, "dm-win")}</div>
    </div>
    <div class="dm-pay"><p>At ${val("AED 199", { showPrice: 0 })} a month, this is what your subscriber is paying for: ${val(s0.pays, { attrs: "data-dm-pays" })}</p>${statusChip("payments", "subscriber payments")}</div>
    <p class="sr-only" aria-live="polite" data-dm-live></p>
  </div>
</div>`;
}

function ruleBuilder() {
  const stepper = (key, label, value, unit, aria) => `<span class="rb-step" role="group" aria-label="${esc(label)}"><button type="button" class="rb-btn" data-rb-step="${key}" data-d="-1" aria-label="Fewer: ${esc(aria)}">${icon("minus")}</button>${val(value, { cls: "fig rb-v", w: key === "kg" ? "3ch" : "1ch", align: "center", attrs: `data-rb-v="${key}"` })}<button type="button" class="rb-btn" data-rb-step="${key}" data-d="1" aria-label="More: ${esc(aria)}">${icon("plus")}</button>${unit ? `<span class="rb-u">${unit}</span>` : ""}</span>`;
  return `<div class="rb card card--raised" data-rb>
  <div class="tile-head"><p class="eyebrow">Your rule</p>${sampleLabel("Sample")}</div>
  <p class="rb-sentence">After ${stepper("n", "Sessions in a row", "2", "", "sessions in a row")} sessions at ${stepper("r", "Reps in reserve", "3", "", "reps in reserve")} or more reps in reserve, add ${stepper("kg", "Kilograms to add", "2.5", "", "kilograms to add")} kg to the squat.</p>
  <div class="rb-log"><p class="rb-log-k">Subscriber A’s last three sessions</p><ul>${[["Thu", 4], ["Mon", 3], ["Thu, last week", 1]].map(([d, r], i) => `<li class="rb-s${i < 2 ? " is-ok" : ""}" data-rb-s="${i}" data-rir="${r}"><span>${d}</span><b class="fig">${r}</b><small>in reserve</small><span class="rb-ok">${icon("check")}</span></li>`).join("")}</ul></div>
  <div class="rb-out flash" data-rb-out><span class="rb-out-k">Monday’s back squat</span>${val("60 kg → 62.5 kg", { cls: "fig rb-res", attrs: "data-rb-res" })}<span class="rb-chip">${val("Sent on its own, within your rules", { attrs: "data-rb-lane" })}</span></div>
  <p class="sr-only" aria-live="polite" data-live></p>
</div>`;
}

function thresholdTool() {
  return `<div class="th card card--raised" data-th>
  <div class="tile-head"><p class="eyebrow">Fatima’s first plan</p>${sampleLabel("Sample")}</div>
  <div class="range"><div class="range-top"><label for="th-range">How sure it must be to send alone (%)</label>${val("80%", { cls: "fig", w: "4ch", align: "end", attrs: "data-th-v" })}</div>
    <input id="th-range" type="range" min="60" max="95" step="1" value="80" style="--fill:57.14%" aria-valuetext="80%: clears your bar, sent on its own" data-th-in><div class="range-ends" aria-hidden="true"><span>60%</span><span>95%</span></div></div>
  <div class="th-viz" aria-hidden="true"><div class="th-bar"><i style="--v:.72"></i></div><span class="th-mark" style="--t:.6"><b>Must be 80%</b></span><span class="th-dec"><b>It is 86%</b></span><span class="th-axis"><span>50%</span><span>100%</span></span></div>
  <div class="lanes th-lanes" style="--lane:0" data-lane="0"><span class="dm-ind" aria-hidden="true"><i></i><i></i></span><div class="lane is-active"><span>Sent on its own</span></div><div class="lane lane--off"><span>Waits for you</span></div></div>
  <p class="th-res">${val("86% clears your bar. The plan is sent on its own.", { attrs: "data-th-res" })}</p>
  <p class="sr-only" aria-live="polite" data-live></p>
</div>`;
}

function demo(ctx) {
  const page = ctx.page;
  const heroHtml = hero({
    eyebrow: "Interactive demo", h1: "See your AI make a coaching decision", mark: "decision",
    lede: "Pick a message, change the rule, then set how sure it must be. Scripted examples. No AI model is called.",
    secondary: { label: "See how it works", href: "/how-it-works" }, cls: "dm-hero",
    visual: `<ol class="dm-steps" aria-label="Three things to try">${[["#playground", "Throw a moment", "12 sample moments"], ["#rule", "Change the rule", "Sessions, reserve, kilograms"], ["#sure", "Set your bar for plans", "From 60% to 95%"]].map(([h, t, s], i) => `<li><a href="${h}"><span class="fig">${String(i + 1).padStart(2, "0")}</span><span><b>${t}</b><small>${s}</small></span>${icon("arrow")}</a></li>`).join("")}</ol>`,
  });
  const decisions = band({
    id: "decisions", tone: "paper", labelledby: "dec-h", cls: "dm-band",
    inner: `${head({ eyebrow: "Four decisions", title: "Pick a subscriber message", id: "dec-h", lede: "Confident changes follow your rules. Unsure ones come to you. Pain always pauses the workout." })}
${demoConsole()}
<p class="fine dm-note">${esc(page.sections[0].note)}</p>`,
  });
  const rule = band({
    id: "rule", labelledby: "rule-h",
    inner: `<div class="split split--center dm-split">
  <div class="reveal">${eyebrow("Rule builder")}<h2 id="rule-h">Change the rule</h2><p class="lede">Edit any number. The decision recomputes against this subscriber’s last three sessions.</p>
    <ul class="tick-list dm-ticks">${["Try 3 sessions: one more easy session is needed.", "Try 4 or more in reserve: Monday’s session no longer counts.", "Your real rules come from your interview and quiz."].map((t) => `<li>${icon("info")}<span>${esc(t)}</span></li>`).join("")}</ul></div>
  <div class="reveal">${ruleBuilder()}</div>
</div>`,
  });
  const sure = band({
    id: "sure", tone: "paper", labelledby: "sure-h",
    inner: `<div class="split split--center dm-split">
  <div class="reveal">${eyebrow("Your bar for plans")}<h2 id="sure-h">How sure must a plan be?</h2><p class="lede">Plans carry a confidence score. Above your bar, a plan sends on its own. Below it, it waits for you.</p>
    <p class="fine">The sample plan is 86% sure. Move your bar past it to see the plan wait for you. Chat replies have no score. They must cite your rule.</p></div>
  <div class="reveal">${thresholdTool()}</div>
</div>`,
  });
  const next = band({
    id: "next", labelledby: "next-h",
    inner: `<div class="dm-next reveal">
  <div>${eyebrow("In your account")}<h2 id="next-h">What happens next</h2><p class="lede">You’ll teach your real rules in setup. Every reply waits for you until you choose otherwise.</p>${ctaRow({ location: "inline", secondary: { label: "See how it works", href: "/how-it-works" } })}</div>
  <ol class="dm-next-steps">${[["Teach", "Confirm your rules, answer 8 quiz questions, add 3 cases. About 6 minutes."], ["Waits for me", "Every reply comes to you first. Approve, correct or reply yourself."], ["Your choice", "Turn on automatic sending after 20 cases and passing checks."]].map(([t, b], i) => `<li><span class="fig">${String(i + 1).padStart(2, "0")}</span><b>${t}</b><p>${esc(b)}</p></li>`).join("")}</ol>
</div>`,
  });
  budget("H2", "What happens next", 6);
  const items = pickFaqs(page, [/test my own/, /real AI response/, /Who decides/, /pain/]).map((f) => {
    if (/test my own/.test(f.q)) return { q: "Can I test my own AI before launch?", a: "Yes. You write test cases with the answer you expect, and your AI is checked against them before a version can be published." };
    if (/real AI/.test(f.q)) return { q: "Is this a real AI response?", a: "No. These are scripted examples that show the decision flow. Your real AI uses your own confirmed rules and a tested release." };
    if (/Who decides/.test(f.q)) return { q: "Who decides how sure it must be?", a: f.a };
    return f;
  });
  return {
    main: [heroHtml, playground({ tone: "paper", eyebrow: "12 sample moments" }), rule, sure, next, faqBand(items, "dq")].join("\n"),
    closing: { secondary: { label: "See how it works", href: "/how-it-works" } },
    ...playAssets,
  };
}

/* ===================================================================== */
/* /security-and-privacy (C7, payments-first for Concept B)               */
/* ===================================================================== */
function security(ctx) {
  const page = ctx.page;
  const heroHtml = hero({
    eyebrow: "Security and privacy", h1: "How we protect you and your subscribers", mark: "protect",
    lede: "Card data stays with the payment provider. Workspaces are isolated, sign-in is strong, and each use of data needs consent.",
    secondary: { label: "Read the AI disclosure", href: "/ai-disclosure" },
    visual: stage(`<div class="iso" role="img" aria-label="Diagram: each trainer's workspace is isolated at the database layer; card numbers go to the payment provider and are not stored in trainsyou.">
  <div class="iso-ws iso-ws--you"><p class="iso-k">Layla Strength’s workspace</p><div class="iso-items"><span>Your method</span><span>Subscribers</span><span>Statements</span><span>Voice, with consent</span></div><p class="iso-lock">${icon("lock")}Only you and your team roles</p></div>
  <div class="iso-wall" aria-hidden="true"><span>Isolated at the database layer</span></div>
  <div class="iso-ws iso-ws--other"><p class="iso-k">Another trainer’s workspace</p><div class="iso-items"><span></span><span></span><span></span><span></span></div><p class="iso-lock">${icon("cross")}No access either way</p></div>
  <div class="iso-pay"><span class="iso-card">Card numbers</span>${icon("arrow")}<b>Payment provider</b><small>Not stored in trainsyou</small></div>
</div>`, { label: "Sample", cls: "p-stage--iso" }),
  });
  const facts = [
    ["Payments", "Stripe holds card data. Payouts go only to a verified UAE IBAN, held briefly after a bank change.", statusChip("payments", "payments")],
    ["Sign-in", "Passkeys, authenticator apps, recovery codes, and a device list you can sign out from.", chip("Included", "ok")],
    ["Workspace isolation", "Each workspace is separated at the database level. No trainer sees another’s data.", chip("Included", "ok")],
    ["Keys and logs", "Provider keys are encrypted at rest. Sensitive actions are logged. Every page uses HTTPS.", chip("Included", "ok")],
    ["Consent", "A separate choice for each use. Trainers and subscribers can export or delete their data.", chip("Included", "ok")],
    ["AI disclosure", "Subscribers accept a disclosure when they join. Digital guidance is always labelled.", chip("Included", "ok")],
  ];
  const factBand = band({
    id: "facts", tone: "paper", labelledby: "facts-h",
    inner: `${head({ eyebrow: "Six facts", title: "What we do, plainly", id: "facts-h", lede: "Money first, because that is where trust matters most." })}
<div class="cols-3 sp-facts reveal" data-stagger>${facts.map(([t, b, c], i) => { budget("card", b, 18); return `<div class="card sp-fact${i === 0 ? " sp-fact--pay" : ""}"><div class="sp-fact-top"><span class="fig sp-n">${String(i + 1).padStart(2, "0")}</span>${c}</div><h3>${t}</h3><p class="muted">${esc(b)}</p></div>`; }).join("")}</div>`,
  });
  const ops = band({
    id: "operators", labelledby: "ops-h",
    inner: `<div class="split split--center">
  <div class="reveal">${eyebrow("Operator access")}<h2 id="ops-h">Every operator access is audited</h2><p class="lede">Platform operators use separate tools with role-based access. A fresh authenticator check applies when authenticator enforcement is switched on.</p></div>
  <ol class="ops reveal" data-stagger aria-label="What happens when an operator opens a tool">
    <li><span class="fig">01</span><b>Operator opens a tool</b><span>Separate administration tools</span></li>
    <li><span class="fig">02</span><b>Role check</b><span>Only what their role allows</span></li>
    <li class="ops--cond"><span class="fig">03</span><b>Fresh authenticator check</b><span>When enforcement is switched on</span></li>
    <li><span class="fig">04</span><b>Logged</b><span>Recorded in the audit log</span></li>
  </ol>
</div>`,
  });
  budget("H2", "Every operator access is audited", 6);
  const method = band({
    id: "method", tone: "paper", labelledby: "method-h",
    inner: `${head({ eyebrow: "Your method and voice", title: "Yours, and only yours", id: "method-h" })}
<div class="cols-2 reveal" data-stagger>
  <div class="card sp-own"><h3>Your method</h3><p class="muted">Your rules, cases and corrections stay private to your workspace. They are never used for another trainer.</p>${secondaryLink({ label: "How your AI learns", href: "/trainer-brain" })}</div>
  <div class="card sp-own"><h3>Your voice</h3><p class="muted">Used only after identity checks and your recorded consent, only for your own subscribers. Withdraw it any time.</p>${secondaryLink({ label: "The voice coach", href: "/features/voice-coach" })}</div>
</div>`,
  });
  const caveats = band({
    id: "limits", labelledby: "limits-h",
    inner: `<div class="split">
  <div class="reveal">${eyebrow("In plain words")}<h2 id="limits-h">What we don’t claim</h2><p class="lede">We only say what we can show. These are today’s limits.</p></div>
  <ul class="sp-limits reveal">${[
    "Authenticator apps and passkeys are available. Requiring them is a platform setting, so not every sign-in asks for one yet.",
    "Fresh authenticator checks for operators apply only when that setting is switched on.",
    "We encrypt provider keys at rest. We don’t claim every record is encrypted.",
    "Wearable data reaches your AI only when the subscriber’s permission and your policy allow it.",
    "Subscriber payments and payouts are not on yet, so no card data is processed today.",
  ].map((t) => `<li>${icon("info")}<span>${esc(t)}</span></li>`).join("")}</ul>
</div>`,
  });
  const items = pickFaqs(page, [/sensitive actions/, /see my Trainer Brain/, /download my data/, /subscribers’ data/, /wearable/]).map((f) => {
    if (/subscribers’ data/.test(f.q)) return { q: f.q, a: "You and the team members whose role allows it. Other trainers cannot. Platform operators use separate, audited tools." };
    if (/Trainer Brain/.test(f.q)) return { q: "Who can see my AI and its teaching?", a: f.a };
    if (/wearable/.test(f.q)) return { q: "Is wearable data sent to my AI?", a: f.a };
    return f;
  });
  return {
    main: [heroHtml, factBand, ops, method, caveats, faqBand(items, "sq")].join("\n"),
    closing: { secondary: { label: "Read the AI disclosure", href: "/ai-disclosure" } },
  };
}


export const pages = {
  "/how-it-works": (ctx) => ((CUR = ctx.path), howItWorks(ctx)),
  "/trainer-brain": (ctx) => ((CUR = ctx.path), trainerBrain(ctx)),
  "/features": (ctx) => ((CUR = ctx.path), features(ctx)),
  ...Object.fromEntries(FEATURE_PATHS.map((p) => [p, (ctx) => ((CUR = ctx.path), featurePage(ctx))])),
  "/demo": (ctx) => ((CUR = ctx.path), demo(ctx)),
  "/security-and-privacy": (ctx) => ((CUR = ctx.path), security(ctx)),
};
