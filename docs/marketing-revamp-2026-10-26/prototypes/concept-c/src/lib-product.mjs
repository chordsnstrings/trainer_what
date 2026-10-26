// Product group helpers for concept C "The Method" (owner: product builder).
// Small UI builders for annotated figures (phones, workspace windows,
// plates with margin notes), the capability inventory, copy helpers and a
// build-time copy check. Imported only by src/pages-product.mjs.
import * as h from "./lib/components.mjs";

const { esc, each, cx, icon, chip, statusChip, offeringChip, marginNote } = h;

// ---------------------------------------------------------------------------
// Copy helpers

/** Grade-6 wording for content.json text (section C0) and "your AI" ownership. */
export function plain(s) {
  return String(s ?? "")
    .replace(/\bmy Trainer Brain\b/g, "my AI")
    .replace(/\bmy Brain\b/g, "my AI")
    .replace(/\b[Yy]our Trainer Brain\b/g, (m) => (m[0] === "Y" ? "Your AI" : "your AI"))
    .replace(/\ba Trainer Brain\b/g, "your AI")
    .replace(/\b(the|your) Brain\b/g, "your AI")
    .replace(/\b(The|Your) Brain\b/g, "Your AI")
    .replace(/below your (confidence )?threshold/g, "it isn’t sure enough about")
    .replace(/low-confidence decisions/g, "unsure decisions")
    .replace(/The confidence you require/g, "How sure it must be")
    .replace(/held-out scenarios/g, "your test cases")
    .replace(/\byour scenarios\b/g, "your test cases")
    .replace(/confidence threshold/g, "how sure it must be")
    .replace(/[Mm]arginal bands of /g, "bands of ")
    .replace(/“?Available soon”?/g, "Not on yet");
}
const words = (s) => String(s).replace(/<[^>]+>/g, " ").trim().split(/\s+/).filter(Boolean).length;
const BANNED = /\b(seamless|revolutionary|cutting-edge|unlock|empower|game-changing|trusted by|guaranteed|passive income)\b|#1/i;

/**
 * Build-time copy check against section C0 limits. Prints warnings, never
 * throws, so the owner sees every breach in the build log.
 */
export function checkCopy(path, { h1, h2 = [], lede, faqs = [], cards = [] }) {
  const warn = (m) => console.warn(`  ! ${path}: ${m}`);
  if (h1 && (words(h1) > 8 || /:/.test(h1))) warn(`H1 "${h1}" breaks the 8-word / no-colon rule`);
  h2.forEach((t) => words(t) > 6 && warn(`H2 "${t}" is ${words(t)} words (max 6)`));
  if (lede && words(lede) > 25) warn(`lede is ${words(lede)} words (max 25)`);
  cards.forEach((t) => words(t) > 18 && warn(`card body "${t.slice(0, 40)}…" is ${words(t)} words (max 18)`));
  faqs.forEach((f) => [f.a, f.aOn].filter(Boolean).forEach((a) => words(a) > 45 && warn(`FAQ "${f.q}" answer is ${words(a)} words (max 45)`)));
  [h1, lede, ...h2, ...cards, ...faqs.flatMap((f) => [f.q, f.a, f.aOn])].filter(Boolean).forEach((t) => BANNED.test(t) && warn(`banned word in "${t.slice(0, 50)}"`));
}

// ---------------------------------------------------------------------------
// FAQ with optional flag-dependent answers: { q, a, aOn?, flag? }.
// Renders through h.faq so the markup and behaviour stay identical.

export function faqX(items, opts = {}) {
  const swaps = [];
  const html = h.faq(
    items.map((it, i) => {
      if (!it.aOn) return it;
      swaps.push([`@@FQ${i}@@`, h.flagged(it.flag || "frontier", esc(it.a), esc(it.aOn))]);
      return { q: it.q, a: `@@FQ${i}@@` };
    }),
    opts,
  );
  return swaps.reduce((s, [k, v]) => s.replace(k, v), html);
}

// ---------------------------------------------------------------------------
// Feature registry: new H1s (section C5), one-line outcomes, chips.

export const FEATURES = {
  "/features/ai-training-plans": { h1: "Your AI plans every subscriber’s training", line: "A dated plan for each subscriber that adapts as they train." },
  "/features/subscriber-app": { h1: "Your training app, with your name on it", line: "Day by day, offline in the gym, with your icon on their phone." },
  "/features/website-and-domain": { h1: "Build your coaching website your way", line: "282 layouts in 40 section families, previewed before you publish." },
  "/features/nutrition": { h1: "Nutrition coaching that follows your guidance", line: "Meal plans, grocery lists and a food diary, as a higher tier." },
  "/features/voice-coach": { h1: "Your voice, running the session", line: "Guided workouts in your verified voice, with your consent." },
  "/features/bookings": { h1: "Add paid sessions to your AI coaching", line: "One-to-one sessions with your price and your cancellation rules." },
  "/features/chat-and-digital-coach": { h1: "Stay close without answering every message", line: "Private chat, a labelled digital coach, and takeover any time." },
  "/features/progress-and-client-twin": { h1: "Every subscriber’s progress and context in one view", line: "Progress they can see, and context with a date and source." },
  "/features/payments-and-payouts": { h1: "Monthly AED payouts to your UAE bank", line: "Card payments in AED, clear statements, monthly payouts." },
  "/features/safety": { h1: "Safety rules your AI cannot override", line: "Pain and red flags pause the workout and come to you." },
  "/features/team": { h1: "Bring your team", line: "Staff coaches and finance roles, each limited to what they need." },
};

/**
 * Chips for a feature page: offering + availability (BUILDERS §9).
 * payments/payouts follow the payments flag, voice the voice flag; model is
 * live (no chip). Progress uses core availability (Included), never some().
 */
export function featureChips(page) {
  const a = page.availability || [];
  let out = offeringChip(page.offering || "Included");
  if (a.includes("payments") || a.includes("payouts")) out += statusChip("payments", "Not on yet", "Live today");
  if (a.includes("voice")) out += statusChip("voice", "Not on yet for subscribers", "Live for subscribers");
  if (page.path === "/features/nutrition") out += chip("neutral", "Can’t be bought alone");
  return `<span class="chips">${out}</span>`;
}

// ---------------------------------------------------------------------------
// Capability inventory (packages/contracts/src/marketing-features.ts, 1:1).
// Availability: model, whoop, customDomains and nutrition are live today;
// payments, payouts and voice follow the dev flags; zepp and instagram are
// not on yet (research-final principle 6 and the synthesis live list).

const model = ["model"], paid = ["payments"];
const nut = { availability: ["nutrition"], offering: "Optional tier" };
const voi = { availability: ["voice"], offering: "Add-on" };
export const MATRIX = [
  { id: "brain", title: "Your AI", audience: "You", page: "/trainer-brain", items: [
    ["Guided coaching interview", "Explain what you recommend, why, the alternatives and what changes your answer."],
    ["Rules in plain language", "Confirm, edit or reject each rule; every rule keeps its source.", { availability: model }],
    ["Coaching cases and examples", "Teach real decisions, not just principles."],
    ["Your own documents", "Import your material and review the extracted text privately before it is used.", { availability: model }],
    ["Conflict resolution", "When two sources disagree, you decide which rule wins.", { availability: model }],
    ["Your test cases", "Start supervised with 8 quiz answers and 3 own cases. Automatic sending needs 20 cases and passing checks."],
    ["Checked before release", "Every version is tested against your test cases before it can go live.", { availability: model }],
    ["Versioned releases and rollback", "Publish a version, compare it, and roll back at any time.", { availability: model }],
    ["How sure it must be", "You choose which routine changes run automatically; the rest comes to you.", { availability: model }],
    ["Learning from corrections", "Your approvals, corrections and subscriber outcomes become teaching for the next release.", { availability: model }],
  ] },
  { id: "training", title: "Plans and workouts", audience: "You and your subscribers", page: "/features/ai-training-plans", items: [
    ["A personalised, dated plan", "Built by your AI from each subscriber’s goals, schedule, experience and equipment.", { availability: model }],
    ["Adapts as they train", "Progressions, missed sessions and swaps follow your confirmed rules.", { availability: model }],
    ["Hand-off when unsure", "Unsure decisions come to you as a draft to approve or correct.", { availability: model }],
    ["Programme templates", "Write programmes yourself with the exercise library and assign them."],
    ["Automatic calendar", "Assigned programmes are scheduled by date, with rest days kept."],
    ["Move or skip a session", "Subscribers reschedule within your rules."],
    ["Guided session", "Exercise cues, sets, targets and rest timers, one step at a time.", { availability: paid }],
    ["Set logging", "Reps, load, effort and notes for every set, with corrections kept in history.", { availability: paid }],
    ["Approved swaps", "Subscribers can swap only to alternatives you approved.", { availability: paid }],
    ["Offline in the gym", "A workout opened online keeps working offline and syncs later.", { availability: paid }],
    ["One-tap pain report", "Pauses the workout and alerts you straight away."],
    ["Workout reminders", "Reminders, programme-ready and missed-session messages.", { availability: paid }],
  ] },
  { id: "nutrition", title: "Nutrition tier", audience: "You and your subscribers", page: "/features/nutrition", items: [
    ["Weekly meal plans", "Built from your recipes, rules and each subscriber’s targets and preferences.", nut],
    ["Recipe options and swaps", "Only the swaps your teaching allows.", nut],
    ["Grocery lists", "A consolidated shopping list for the week.", nut],
    ["Pantry and leftovers", "Plans that use what the subscriber already has.", nut],
    ["Food diary", "With favourites, copied meals and corrections.", nut],
    ["Meal photo estimates", "Foods and portions estimated from a photo, confirmed by the subscriber.", nut],
    ["Barcode lookup", "Packaged foods read by barcode, confirmed before logging.", nut],
    ["Weekly check-ins", "Progress against the targets you set.", nut],
    ["Your nutrition teaching", "Cases, recipes and calorie methods, checked before release.", nut],
    ["Exceptions queue", "Decisions outside your rules come to you.", nut],
  ] },
  { id: "voice", title: "Voice add-on", audience: "You and your subscribers", page: "/features/voice-coach", items: [
    ["Sessions in your own voice", "Personal narration in your coaching style, from your verified voice and approved plan.", voi],
    ["Members’ own music", "Short cues and tap-to-talk while members play their own music app.", voi],
    ["Verified and consented", "Identity verification and your separate, recorded consent, which you can withdraw.", voi],
    ["Only your subscribers", "Used only for your own subscribers who add it, never for another trainer’s.", voi],
  ] },
  { id: "coaching", title: "Chat, progress and data", audience: "You and your subscribers", page: "/features/chat-and-digital-coach", items: [
    ["Private chat with you", "One thread per subscriber, with photo and PDF attachments."],
    ["Labelled digital coach", "Answers from your published teaching and is always labelled as digital.", { availability: [...model, ...paid] }],
    ["Personal takeover", "Take over a subscriber and the digital coach steps back."],
    ["Scheduled follow-ups", "Check-in messages sent when you plan them.", { availability: paid }],
    ["Client Twin", "Goals, preferences and history in one coaching context, each with its date and source."],
    ["Progress page", "Completed sessions, training volume and best loads per exercise."],
    ["Apple Health import", "Subscribers can import an Apple Health export."],
    ["WHOOP connection", "Shared only with the subscriber’s permission and your policy.", { availability: ["whoop"] }],
    ["Amazfit / Zepp connection", "Shared only with the subscriber’s permission and your policy.", { availability: ["zepp"] }],
    ["Notifications and quiet hours", "An in-app inbox with preferences."],
  ] },
  { id: "bookings", title: "Bookings", audience: "You and your subscribers", page: "/features/bookings", items: [
    ["Session slots", "One-off or weekly slots with capacity."],
    ["Paid one-to-one sessions", "Card payment in AED at booking.", { availability: paid }],
    ["Cancellation rules", "Your window decides refunds automatically.", { availability: paid }],
    ["Attendance and no-shows", "Tracked per booking.", { availability: paid }],
    ["Calendar export", "Bookings in the subscriber’s own calendar."],
  ] },
  { id: "brand", title: "Your brand, website and app", audience: "You", page: "/features/website-and-domain", items: [
    ["Desktop visual website editor", "Drag and drop sections, create multiple pages and manage navigation."],
    ["Section template library", "282 layouts across 40 families, including heroes, videos, programmes, pricing, FAQs and contact forms."],
    ["AI starter sites", "AI assembles existing modules into an editable starter. Manual templates work without AI.", { availability: model }],
    ["Before-and-after galleries", "Paired client photos and captions, using material you have permission to publish."],
    ["Separate website and app styles", "Set website colours and typography independently from your member app."],
    ["Draft recovery", "Autosave, undo and redo, reusable sections and publication history."],
    ["Coaching website", "Responsive pages, videos, galleries and a contact form whose messages reach your inbox."],
    ["Private preview", "Preview desktop, tablet and phone layouts before publishing."],
    ["Your coaching address", "Reserved the moment you sign up."],
    ["Your own domain, bought for you", "Bought and renewed automatically, with the cost on your statement.", { availability: ["customDomains"] }],
    ["Connect a domain you own", "Point an existing domain at your website.", { availability: ["customDomains"] }],
    ["Installable app", "Subscribers add your app to their home screen with your name and icon."],
    ["Search titles and descriptions", "Set how your pages appear in search results."],
    ["Coach directory listing", "Optional: appear in the public directory of coaches."],
    ["English and Arabic member controls", "Core member screens support Arabic and right-to-left layouts. Coach content isn’t translated automatically."],
  ] },
  { id: "money", title: "Offers, payments and payouts", audience: "You", page: "/features/payments-and-payouts", items: [
    ["Two tiers", "Workout, or workout and nutrition, each at your price."],
    ["Your price in AED", "With the programme length you choose.", { availability: paid }],
    ["Monthly or upfront billing", "Bill the whole programme upfront, or month by month.", { availability: paid }],
    ["Trials and promotion codes", "Free trial days and codes when you want them.", { availability: paid }],
    ["Card checkout", "Receipts and billing history for subscribers.", { availability: paid }],
    ["Refund decisions", "Requests you approve or decline, reconciled with the payment provider.", { availability: paid }],
    ["Open commission", "Our share for each group of subscribers: 25%, 20%, 15% and 10%."],
    ["Monthly statement", "From gross revenue to net, every cost itemised."],
    ["Ledger export", "Your ledger as a CSV file."],
    ["Monthly payouts", "To a verified UAE IBAN.", { availability: ["payouts"] }],
  ] },
  { id: "growth", title: "Growth", audience: "You", page: "/follower-calculator", items: [
    ["Follower calculator", "Cautious, typical and best cases from cited benchmarks, with every assumption shown."],
    ["Connect Instagram", "Professional accounts fill the calculator with real numbers; access is not kept.", { availability: ["instagram"] }],
    ["Tagged share links", "Links for your bio and Stories, so you see which ones bring visitors."],
    ["Consented visitor sources", "Where visitors came from, only when they allowed analytics."],
    ["Invite links", "Invite subscribers you already coach."],
    ["Website inquiries", "Contact-form messages in one inbox."],
  ] },
  { id: "trust", title: "Safety, privacy and team", audience: "You and your subscribers", page: "/features/safety", items: [
    ["Safety rules in code", "Pain, pregnancy and red flags pause training and come to you, whatever the settings."],
    ["Your own red flags", "Add terms that also pause training, and topics that come to you for review."],
    ["Escalation", "Unreviewed safety holds escalate until someone decides."],
    ["AI disclosure", "Accepted when subscribers join; digital replies are always labelled."],
    ["Workspace isolation", "Every workspace is separated at the database layer."],
    ["Strong sign-in", "Authenticator apps, passkeys and recovery codes."],
    ["Team roles", "Staff coaches without finance access; finance without coaching data."],
    ["Consent choices", "Separate choices for coaching data, marketing and analytics."],
    ["Export and deletion", "Trainers and subscribers can download their data and request deletion."],
  ] },
];
export const CAPABILITY_COUNT = MATRIX.reduce((n, g) => n + g.items.length, 0);

/** Chip for one capability row. */
export function capChip([, , o = {}]) {
  const a = o.availability || [];
  if (a.includes("payments") || a.includes("payouts")) return statusChip("payments", "Not on yet", o.offering || "Live today");
  if (a.includes("voice")) return chip("addon", "Add-on") + statusChip("voice", "Not on yet", "Live today");
  if (a.includes("zepp") || a.includes("instagram")) return chip("noton", "Not on yet");
  if (o.offering === "Optional tier") return chip("optional", "Optional tier");
  return chip("included", "Live today");
}

/** Generic tool categories one workspace replaces (never a competitor). */
export const REPLACES = [
  ["A website builder", "A desktop builder with multiple pages, section templates, galleries and private previews."],
  ["A booking tool", "Session slots, paid bookings, cancellation rules and calendar export.", "payments"],
  ["Payments and invoicing", "Card checkout in AED, trials, promotions, refunds, statements and payouts.", "payments"],
  ["A client training app", "A branded app with day-by-day plans, set logging, rest timers and offline mode."],
  ["A meal-planning app", "The optional nutrition tier: meal plans, recipes, grocery lists and a food diary."],
  ["A client messaging app", "Private chat, attachments, scheduled follow-ups and a labelled digital coach."],
  ["Programme spreadsheets", "Templates, an exercise library, automatic scheduling and progress tracking."],
];

// ---------------------------------------------------------------------------
// UI builders for figures (sample data, Layla Strength)

/** Crossfading value: `a` at first paint, `b` once the figure plays. */
export const xv = (a, b, cls = "") => `<span class="${cx("pd-x", cls)}"><span class="pd-a" aria-hidden="true">${a}</span><span class="pd-b">${b}</span></span>`;
/** An element that enters when its figure plays (start state keeps its space). */
export const inEl = (html, { tag = "div", cls = "", delay = 0 } = {}) =>
  `<${tag} class="${cx("pd-in", cls)}"${delay ? ` style="--pd-d:${delay}ms"` : ""}>${html}</${tag}>`;

export const appTop = (sub = "layla-strength.trainsyou.com", name = "Layla Strength") =>
  `<div class="app-top"><span class="app-icon">LS</span><div><p class="app-name">${esc(name)}</p><p class="app-sub">${esc(sub)}</p></div></div>`;
export const tabbar = (on = "Plan", tabs = ["Plan", "Food", "Progress", "Chat"]) =>
  `<div class="app-tabbar">${each(tabs, (t) => `<span${t === on ? ' class="on"' : ""}>${esc(t)}</span>`)}</div>`;
/** Phone with an app screen. label: accessible description (role=img). */
export const ph = (inner, { label, cls = "", rtl = false } = {}) =>
  h.phone({ screenHtml: `<div class="app pd-app">${inner}</div>`, label, className: cx("pd-phone", cls), rtlVignette: rtl });
/** Workspace window as a labelled illustration. */
export const win = (title, body, { label, chipHtml = "", cls = "" } = {}) =>
  `<div class="${cx("pd-win", cls)}"${label ? ` role="img" aria-label="${esc(label)}"` : ""}>${h.windowFrame({ title, bodyHtml: body, chipHtml })}</div>`;
/** A labelled key/value line inside UI. */
export const kv = (k, v, cls = "") => `<p class="${cx("pd-kv", cls)}"><span>${k}</span><b>${v}</b></p>`;
export const pinEl = (p) => `<span class="pin" aria-hidden="true">${esc(p)}</span>`;

/**
 * Annotated plate: a device on paper with margin notes (C's "Fig." style).
 * notes: [[pin, text], ...]. play: the plate plays one state change once.
 */
export function plate({ deviceHtml, notes = [], play = true, cls = "" }) {
  return `<div class="${cx("pd-plate", cls)}"${play ? " data-play" : ""}>
  <div class="pd-plate-dev">${deviceHtml}</div>
  ${notes.length ? `<div class="pd-plate-notes">${each(notes, ([p, t]) => marginNote(esc(t), { pin: p }))}</div>` : ""}
</div>`;
}

/** Procedure: numbered steps with a drawn rule (How it runs). */
export function procedure(steps, { cls = "" } = {}) {
  return `<div class="${cx("pd-proc", cls)}" data-reveal style="--n:${steps.length}">${h.ruleLine()}<ol data-stagger>${each(
    steps,
    (s, i) => `<li><span class="pd-proc-n" aria-hidden="true">${i + 1}</span><div><h3 class="pd-proc-t">${esc(s.title)}</h3><p>${s.html || esc(plain(s.body))}</p></div></li>`,
  )}</ol></div>`;
}

/** Numbered manual list: big serif numerals, title + line, optional note. */
export function manualList(items, { cls = "", start = 1 } = {}) {
  return `<ol class="${cx("pd-mlist", cls)}">${each(
    items,
    (it, i) => `<li data-reveal style="--i:${Math.min(i, 5)}"><span class="pd-ml-n" aria-hidden="true">${String(i + start).padStart(2, "0")}</span><div class="pd-ml-body"><p class="pd-ml-t">${it.titleHtml || esc(it.title)}</p>${it.body ? `<p class="pd-ml-d">${it.bodyHtml || esc(it.body)}</p>` : ""}</div>${it.note ? `<p class="pd-ml-note">${it.note}</p>` : ""}</li>`,
  )}</ol>`;
}

/** Related pages list (margin of the FAQ band). */
export function relatedList(paths, { pageFor, href, label = "Related" }) {
  return `<div class="mnote pd-related" role="note"><span class="mnote-k">${esc(label)}</span><ul>${each(
    paths,
    (p) => `<li><a href="${href(p)}"><span>${esc(pageFor(p).navLabel)}</span><span class="arr" aria-hidden="true">→</span></a></li>`,
  )}</ul></div>`;
}
