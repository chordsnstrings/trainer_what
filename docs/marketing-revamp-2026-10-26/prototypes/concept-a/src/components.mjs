// Shared component helpers for concept A. Every helper returns an HTML string.
// Text arguments are escaped; arguments documented as `html` are inserted raw.
// Class vocabulary and behaviour hooks are documented in BUILDERS.md.
import { content, href, sourceById } from "./registry.mjs";
export { content, href, sourceById, PAGES, pageByPath, fileFor } from "./registry.mjs";

/* ------------------------------------------------------------------ basics */

/** Escape text for HTML text and attribute positions. */
export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Join an array of HTML strings (falsy entries dropped). */
export const join = (list, sep = "") => (list || []).filter(Boolean).join(sep);

/** Render a page path as an `<a>`: link("/pricing", "Pricing in detail", { cls: "tlink" }). */
export function link(path, label, { cls = "", attrs = "" } = {}) {
  const ext = /^https?:/.test(path);
  return `<a href="${esc(href(path))}"${cls ? ` class="${cls}"` : ""}${ext ? ' target="_blank" rel="noopener"' : ""}${attrs ? " " + attrs : ""}>${esc(label)}</a>`;
}

/** Small stroke icons (16px box, currentColor). Arrows mirror in RTL via .ic-dir. */
const ICONS = {
  arrow: '<path d="M3 8h9.5M8.5 4l4 4-4 4"/>',
  chevron: '<path d="M4 6l4 4 4-4"/>',
  check: '<path d="M3.5 8.5l3 3 6-7"/>',
  x: '<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>',
  plus: '<path d="M8 3.5v9M3.5 8h9"/>',
  minus: '<path d="M3.5 8h9"/>',
  replay: '<path d="M3.5 8a4.5 4.5 0 1 0 1.4-3.3M4.5 2.5v2.5H7"/>',
  external: '<path d="M6 4h6v6M12 4l-7.5 7.5"/>',
  dot: '<circle cx="8" cy="8" r="3" fill="currentColor" stroke="none"/>',
  lock: '<rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5.5a2.5 2.5 0 0 1 5 0V7"/>',
};
export function icon(name, cls = "") {
  const dir = name === "arrow" ? " ic-dir" : "";
  return `<svg class="ic${dir}${cls ? " " + cls : ""}" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ""}</svg>`;
}

/* ------------------------------------------------------------ CTA + links */

export const CTA_LABEL = "Teach your AI — free";
export const CTA_CLOSED = "Join early access — free";

/**
 * The one primary CTA. `location`: header | hero | inline | sticky | closing | menu.
 * Registration-closed wording and the early-access href are switched by site.js.
 */
export function cta({ location = "inline", size = "", block = false } = {}) {
  const cls = ["btn", "btn-primary", size && `btn-${size}`, block && "btn-block"].filter(Boolean).join(" ");
  return `<a class="${cls}" href="signup.html" data-cta="primary" data-loc="${location}"><span class="swap"><span data-show="registration:open">${CTA_LABEL}</span><span data-show="registration:closed">${CTA_CLOSED}</span></span>${icon("arrow", "btn-arrow")}</a>`;
}

/** The micro line under a primary CTA. */
export function ctaMicro({ short = false } = {}) {
  const open = short ? "Free to join" : "Free to join · Nothing to pay upfront · Nothing goes live until you publish";
  const closed = short ? "Free to join" : "Free to join · We’ll tell you here when sign-ups reopen";
  return `<p class="micro"><span data-show="registration:open">${esc(open)}</span><span data-show="registration:closed">${esc(closed)}</span></p>`;
}

/** A secondary action button: button("/demo", "Try the demo", { location: "hero" }). */
export function button(path, label, { location = "inline", variant = "secondary", size = "" } = {}) {
  const cls = ["btn", `btn-${variant}`, size && `btn-${size}`].filter(Boolean).join(" ");
  return `<a class="${cls}" href="${esc(href(path))}" data-cta="secondary" data-loc="${location}">${esc(label)}</a>`;
}

/** An inline text link with a nudging arrow: textLink("/pricing", "Pricing in detail"). */
export function textLink(path, label, { location = "inline" } = {}) {
  return `<a class="tlink" href="${esc(href(path))}" data-cta="link" data-loc="${location}"><span>${esc(label)}</span>${icon("arrow")}</a>`;
}

/* ------------------------------------------------------------- structure */

/**
 * A page band. tone: "white" | "paper". `inner` is html placed inside .wrap.
 * band({ id: "pricing", tone: "paper", label: "pricing-h" }, inner)
 */
export function band({ id = "", tone = "white", cls = "", label = "" } = {}, inner = "") {
  return `<section class="band band-${tone}${cls ? " " + cls : ""}"${id ? ` id="${id}"` : ""}${label ? ` aria-labelledby="${label}"` : ""}><div class="wrap">${inner}</div></section>`;
}

/**
 * Section header. layout: "stack" (default) or "split" (heading left, lede right on desktop).
 * sectionHead({ kicker: "How it works", title: "Three parts, one method", lede: "…", id: "how-h" })
 */
export function sectionHead({ kicker = "", title, lede = "", id = "", layout = "stack", level = 2, reveal = true } = {}) {
  return `<header class="sec-head sec-head-${layout}"${reveal ? " data-reveal" : ""}>
  <div class="sec-head-main">${kicker ? `<p class="kicker">${esc(kicker)}</p>` : ""}<h${level}${id ? ` id="${id}"` : ""}>${esc(title)}</h${level}></div>
  ${lede ? `<p class="sec-lede">${esc(lede)}</p>` : ""}
</header>`;
}

/** The page H1 with the Pace mark on one word: h1WithMark("Teach your AI. It trains…", "trains"). */
export function h1WithMark(text, word, { id = "", cls = "" } = {}) {
  let out = esc(text);
  if (word && text.includes(word)) out = esc(text).replace(esc(word), `<span class="mk-mark">${esc(word)}</span>`);
  return `<h1${id ? ` id="${id}"` : ""}${cls ? ` class="${cls}"` : ""}>${out}</h1>`;
}

/* ------------------------------------------------------------------ chips */

/** A chip. tone: live | soon | neutral | sample | estimate | applied | toyou | paused. */
export function chip(label, tone = "neutral", { cls = "" } = {}) {
  return `<span class="chip chip-${tone}${cls ? " " + cls : ""}">${esc(label)}</span>`;
}

/** Live flags the dev panel can toggle, and their honest defaults (section B/E). */
export const FLAGS = { payments: "off", registration: "open", frontier: "off", voice: "off", publish: "off" };
/** Availability key -> dev flag. Keys mapped to "on"/"off" are fixed in this prototype. */
const AVAIL_FLAG = { payments: "payments", payouts: "payments", voice: "voice", frontier: "frontier", publish: "publish", model: "on", nutrition: "on", customDomains: "off", whoop: "off", zepp: "off", instagram: "off" };
/** Integrations that never decide a feature's chip (the Progress chip fix: core availability, not some()). */
const NON_CORE = new Set(["whoop", "zepp", "instagram", "customDomains"]);

/**
 * A chip that follows a dev flag: onLabel while the flag is on, "Not on yet" while it is off.
 * flagChip("payments", "Included")
 */
export function flagChip(flag, onLabel = "Live", offLabel = "Not on yet") {
  const f = AVAIL_FLAG[flag] ?? flag;
  if (f === "on") return chip(onLabel, "live");
  if (f === "off") return chip(offLabel, "soon");
  return `<span class="chip chip-live" data-show="${f}:on">${esc(onLabel)}</span><span class="chip chip-soon" data-show="${f}:off">${esc(offLabel)}</span>`;
}

/** The feature-page chip from content (offering + core availability keys). */
export function offeringChip(page) {
  if (!page?.offering) return "";
  const core = (page.availability || []).filter((k) => !NON_CORE.has(k));
  const flags = [...new Set(core.map((k) => AVAIL_FLAG[k] ?? k))].filter((f) => f !== "on");
  if (flags.includes("off")) return chip("Not on yet", "soon");
  if (!flags.length) return chip(page.offering, "live");
  if (flags.length === 1) return flagChip(flags[0], page.offering);
  // Several flags: "Not on yet" unless every one is on (payments covers payouts).
  return flagChip(flags[0], page.offering);
}

/** "Not on yet: subscriber payments" style chip that disappears when the flag turns on. */
export function notOnYet(flag = "payments", what = "subscriber payments") {
  return `<span class="chip chip-soon" data-show="${AVAIL_FLAG[flag] ?? flag}:off">Not on yet: ${esc(what)}</span>`;
}

/** SourceBadge: "Source →" to methodology.html#<id>, beside every market figure. */
export function sourceBadge(id, { label = "Source" } = {}) {
  const s = sourceById(id);
  return `<a class="source-badge" href="methodology.html#${esc(id)}" title="${esc(s.publisher + ": " + s.title)}" data-track="source_open" data-source="${esc(id)}">${esc(label)}${icon("arrow")}</a>`;
}

/** EstimateLabel. */
export const estimateLabel = () => chip("Estimate, not a promise", "estimate");
/** SampleLabel: used on Layla Strength and all mock data. */
export const sampleLabel = (text = "Sample trainer · scripted") => `<span class="sample-label">${icon("dot")}${esc(text)}</span>`;
/** An owner-decision placeholder: visible, dashed, never mistaken for live copy. */
export const pendingTag = (text) => `<span class="pending-tag">${esc(text)}</span>`;

/* --------------------------------------------------------- proof blocks */

/** The four "never" lines from /trainer-brain (or your own `items`). */
export function constraintList({ title = "What your AI never does", items, level = 3, id = "" } = {}) {
  const list = items || content.pages.find((p) => p.path === "/trainer-brain").sections.find((s) => s.id === "never").bullets;
  return `<div class="never"${id ? ` id="${id}"` : ""}>
  <h${level} class="never-title">${esc(title)}</h${level}>
  <ul class="never-list" data-reveal="stagger">${list.map((t) => `<li class="ri">${icon("x", "never-x")}<span>${esc(t)}</span></li>`).join("")}</ul>
</div>`;
}

/** FounderNote placeholder until the owner supplies name, photo and words (decision 2). */
export function founderNote() {
  return `<figure class="founder">
  <div class="founder-photo" aria-hidden="true"><span>Photo</span></div>
  <figcaption>
    <p class="founder-quote">Why I built trainsyou, in the founder’s own words.</p>
    <p class="founder-name">Founder name · trainsyou</p>
    ${pendingTag("Awaiting the owner’s name, photo and note (decision 2)")}
  </figcaption>
</figure>`;
}

/** The items of the "Live today / Not on yet" panel. `flag` items move between columns. */
export const STATUS_ITEMS = [
  { text: "Create your account and set up your page and app" },
  { text: "Teach and test your AI" },
  { text: "Preview what subscribers will see" },
  { text: "Publishing your page to subscribers", flag: "publish" },
  { text: "Subscriber payments in AED", flag: "payments" },
  { text: "Payouts to a UAE bank", flag: "payments" },
  { text: "Paid bookings", flag: "payments" },
  { text: "Voice add-on for subscribers", flag: "voice" },
];

/** StatusPanel: "Live today / Not on yet", driven by the dev flags. */
export function statusPanel({ id = "status", level = 3, title = "What works today" } = {}) {
  const li = (it, show) => `<li${show ? ` data-show="${it.flag}:${show}"` : ""}>${icon(show === "off" ? "minus" : "check")}<span>${esc(it.text)}</span></li>`;
  const live = STATUS_ITEMS.map((it) => (it.flag ? li(it, "on") : li(it))).join("");
  const soon = STATUS_ITEMS.filter((it) => it.flag).map((it) => li(it, "off")).join("");
  return `<div class="status"${id ? ` id="${id}"` : ""}>
  <p class="status-title"><span class="status-dot" aria-hidden="true"></span>${esc(title)}</p>
  <div class="status-cols">
    <div class="status-col status-live"><h${level}>Live today</h${level}><ul>${live}</ul></div>
    <div class="status-col status-soon"><h${level}>Not on yet</h${level}><ul>${soon}</ul></div>
  </div>
</div>`;
}

/* --------------------------------------------------------------- widgets */

/**
 * FAQ accordion. faqs: [{ q, a, id?, aFrontier?, onlyFrontier? }]. Answers are in the HTML
 * (closed only when JS runs). aFrontier/onlyFrontier come from withFrontier().
 */
export function faqList(faqs, { prefix = "faq", level = 3 } = {}) {
  return `<div class="faq" data-accordion>${faqs
    .map((f, i) => {
      const id = `${prefix}-${f.id || i + 1}`;
      const answer = f.aFrontier
        ? `<p data-show="frontier:off">${esc(f.a)}</p><p data-show="frontier:on">${esc(f.aFrontier)}</p>`
        : `<p>${esc(f.a)}</p>`;
      return `<div class="faq-item"${f.onlyFrontier ? ' data-show="frontier:on"' : ""}>
  <h${level} class="faq-q"><button type="button" id="${id}-b" aria-expanded="false" aria-controls="${id}" data-faq="${esc(f.id || slug(f.q))}"><span>${esc(f.q)}</span><span class="faq-ic" aria-hidden="true"></span></button></h${level}>
  <div class="faq-a" id="${id}" role="region" aria-labelledby="${id}-b"><div>${answer}</div></div>
</div>`;
    })
    .join("")}</div>`;
}

/* ------------------------------------------- frontier availability lines */
// content.availabilityLines: wording shown only while the `frontier` flag is on (off live).
const linesFor = (path) => (content.availabilityLines || []).filter((l) => l.when === "frontier" && (!l.path || l.path === path));

/** FAQs for a page with frontier wording attached: matching answers get aFrontier; path-only questions are appended as onlyFrontier. */
export function withFrontier(faqs, path) {
  const out = faqs.map((f) => {
    const line = linesFor(path).find((l) => l.faq && l.faq.q === f.q);
    return line ? { ...f, aFrontier: line.faq.a } : f;
  });
  for (const l of linesFor(path)) if (l.path === path && l.faq && !out.some((f) => f.q === l.faq.q)) out.push({ ...l.faq, onlyFrontier: true });
  return out;
}
/** Extra bullets for section `sectionId` on `path`, as <li> html shown only with frontier on. */
export function frontierBullets(path, sectionId) {
  return linesFor(path).filter((l) => l.path === path && l.bullet?.section === sectionId).map((l) => `<li data-show="frontier:on">${esc(l.bullet.text)}</li>`).join("");
}
/** Body text for the step/card titled `title` in `sectionId`: returns html with both wordings, or plain fallback. */
export function frontierBody(path, sectionId, title, fallback) {
  const l = linesFor(path).find((x) => x.path === path && x.body?.section === sectionId && x.body.title === title);
  return l ? `<span data-show="frontier:off">${esc(fallback)}</span><span data-show="frontier:on">${esc(l.body.text)}</span>` : esc(fallback);
}
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);

/** Value slot for crossfading figures: vx("AED 23,084", 11). Update with ty.swap(el, text). */
export function vx(text, ch = 0, { cls = "" } = {}) {
  return `<span class="vx${cls ? " " + cls : ""}"${ch ? ` style="--vx-w:${ch}ch"` : ""}><span class="vx-cur">${esc(text)}</span></span>`;
}

/** Static two-state swap used by scripted vignettes: [data-state=done] shows `to`. */
export function swapPair(from, to, { cls = "" } = {}) {
  return `<span class="swap${cls ? " " + cls : ""}"><span class="vs-a">${esc(from)}</span><span class="vs-b" aria-hidden="true">${esc(to)}</span></span>`;
}

/** Lane pill. tone: applied | toyou | paused | wait. With `to`, it is a scripted swap. */
export function lanePill(label, tone = "applied", { to = "", from = "neutral" } = {}) {
  if (!to) return `<span class="lane-pill" data-tone="${tone}"><span class="lane-dot" aria-hidden="true"></span><span>${esc(label)}</span></span>`;
  return `<span class="lane-pill lane-pill-play" data-tone="${from}" data-tone-to="${tone}"><span class="lane-fill" aria-hidden="true"></span><span class="lane-dot" aria-hidden="true"></span>${swapPair(label, to)}</span>`;
}

const TICK = `<svg class="tick" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" pathLength="20"/></svg>`;

/** Phone device frame. `inner` is html for the screen. */
export function phoneFrame(inner, { cls = "", label = "" } = {}) {
  return `<div class="device phone${cls ? " " + cls : ""}"${label ? ` role="img" aria-label="${esc(label)}"` : ""}><div class="phone-screen"><div class="phone-status" aria-hidden="true"><span class="mono">18:41</span><span class="phone-island"></span><span class="phone-sig"></span></div>${inner}</div></div>`;
}

/** Laptop-window frame (trainer workspace). */
export function windowFrame(inner, { title = "", meta = "", cls = "" } = {}) {
  return `<div class="device window${cls ? " " + cls : ""}"><div class="window-screen"><div class="window-bar"><span class="window-title">${esc(title)}</span>${meta ? `<span class="window-meta mono">${esc(meta)}</span>` : ""}</div><div class="window-body">${inner}</div></div></div>`;
}

/** The sample subscriber-app header (Layla Strength, labelled Sample). */
export function appHead({ name = "Layla Strength", initials = "LS" } = {}) {
  return `<div class="app-head"><span class="app-avatar" aria-hidden="true">${esc(initials)}</span><span class="app-name">${esc(name)}</span>${chip("Sample", "sample")}</div>`;
}

/**
 * The Decision Console: phone + trainer panel; one decision's change plays once.
 * Start state is complete static HTML; site.js plays data-state="start" -> "done".
 * Options (all have the home defaults):
 *   message, ruleSource, rule, confidence (0-100), threshold (0-100),
 *   laneFrom, laneTo, tone ("applied" | "toyou" | "paused"),
 *   day, rows: [{ name, sets, from, to? }], outcome: [label, from, to],
 *   autoplay (true), id, caption, cls.
 */
export function decisionConsole(o = {}) {
  const c = {
    id: "console",
    message: "Week three done. Squats felt easy.",
    ruleSource: "Your rule · from interview, 12 Oct",
    rule: "2 easy sessions → +2.5 kg",
    confidence: 86,
    threshold: 80,
    laneFrom: "Checking your rule",
    laneTo: "Applied automatically",
    tone: "applied",
    day: "Mon · Lower body",
    rows: [
      { name: "Back squat", sets: "4 × 6", from: "60 kg", to: "62.5 kg" },
      { name: "Leg press", sets: "3 × 10", from: "120 kg" },
      { name: "Lunge", sets: "3 × 10", from: "16 kg" },
    ],
    outcome: ["Mon · Squat", "60 kg", "62.5 kg"],
    autoplay: true,
    caption: "Sample trainer · scripted · no AI model called",
    cls: "",
    ...o,
  };
  const rows = c.rows
    .map(
      (r) => `<li class="plan-row${r.to ? " is-target" : ""}"><span class="pr-name">${esc(r.name)}</span><span class="pr-sets mono">${esc(r.sets)}</span><span class="pr-load mono">${r.to ? swapPair(r.from, r.to) : esc(r.from)}</span>${r.to ? TICK : ""}</li>`,
    )
    .join("");
  const phone = phoneFrame(
    `${appHead()}
    <div class="app-chat"><p class="bubble bubble-out">${esc(c.message)}</p><p class="app-meta mono">Read 18:40</p></div>
    <div class="app-plan"><p class="app-plan-head"><span>Next session</span><span class="mono">${esc(c.day)}</span></p><ul class="plan">${rows}</ul></div>
    <div class="app-tabs" aria-hidden="true"><span class="is-on">Today</span><span>Plan</span><span>Chat</span><span>Progress</span></div>`,
    { cls: "console-phone" },
  );
  const panel = windowFrame(
    `<p class="cp-label">Subscriber · week 3</p>
    <p class="cp-quote">“${esc(c.message)}”</p>
    <div class="rule-chip"><span class="rule-src">${esc(c.ruleSource)}</span><code class="rule-text mono">${esc(c.rule)}</code></div>
    <div class="conf" style="--c:${c.confidence / 100};--t:${c.threshold / 100}">
      <div class="conf-row"><span>How sure it is</span><span class="mono conf-val">${c.confidence}%</span></div>
      <div class="conf-track"><span class="conf-fill"></span><span class="conf-mark" aria-hidden="true"></span></div>
      <p class="conf-note mono">Your bar ${c.threshold}% · ${c.confidence >= c.threshold ? "above it, it acts" : "below it, it asks you"}</p>
    </div>
    <div class="cp-lane">${lanePill(c.laneFrom, c.tone, { to: c.laneTo })}</div>
    <p class="cp-out"><span>${esc(c.outcome[0])}</span><span class="mono">${swapPair(c.outcome[1], c.outcome[2])}</span></p>`,
    { title: "Inbox · Decision", meta: "Sun 18:41", cls: "console-panel" },
  );
  return `<figure class="console brain-console${c.cls ? " " + c.cls : ""}" id="${c.id}" data-console${c.autoplay ? " data-autoplay" : ""} data-state="start" aria-labelledby="${c.id}-cap">
  <div class="console-stage">${phone}${panel}</div>
  <div class="console-lane-m">${lanePill(c.laneFrom, c.tone, { to: c.laneTo })}</div>
  <figcaption class="console-cap" id="${c.id}-cap">${sampleLabel(c.caption)}<button type="button" class="cap-replay" data-replay="${c.id}">${icon("replay")}<span>Replay</span></button></figcaption>
</figure>`;
}

/**
 * Number stepper with a crossfading value (role=spinbutton; arrows, +/- buttons 44px).
 * stepperField({ name: "sessions", value: 2, min: 1, max: 4, step: 1, label: "Easy sessions", unit: "" })
 */
export function stepperField({ name, value, min, max, step = 1, label, unit = "", ch = 3, suffix = "" }) {
  return `<span class="stepper" data-stepper="${name}" data-min="${min}" data-max="${max}" data-step="${step}" data-value="${value}">
  <button type="button" class="stepper-btn" data-delta="-1" aria-label="Less: ${esc(label)}">${icon("minus")}</button>
  <span class="stepper-val mono" role="spinbutton" tabindex="0" aria-label="${esc(label)}" aria-valuemin="${min}" aria-valuemax="${max}" aria-valuenow="${value}" aria-valuetext="${value}${unit ? " " + unit : ""}">${vx(String(value), ch)}${suffix ? `<span class="stepper-unit" aria-hidden="true">${esc(suffix)}</span>` : ""}</span>
  <button type="button" class="stepper-btn" data-delta="1" aria-label="More: ${esc(label)}">${icon("plus")}</button>
</span>`;
}

/**
 * Rule builder ("Change the rule"). Deterministic outcome against a sample log
 * (2 easy sessions at 3 reps in reserve, squat 60 kg). Fields: sessions, kg, and
 * optionally rir (the /demo version). site.js recomputes on every change.
 */
export function ruleBuilder({ id = "rule", rir = false, lift = "Squat", base = 60 } = {}) {
  return `<div class="rule-builder" id="${id}" data-rule-builder data-log-sessions="2" data-log-rir="3" data-base="${base}" data-lift="${esc(lift)}">
  <p class="rb-sentence"><span class="rb-k">Your rule</span> After ${stepperField({ name: "sessions", value: 2, min: 1, max: 4, label: "Easy sessions needed", unit: "sessions", ch: 1 })} easy sessions${rir ? ` at ${stepperField({ name: "rir", value: 3, min: 1, max: 5, label: "Reps in reserve, at least", unit: "reps", ch: 1, suffix: "+" })} reps in reserve` : ""}, add ${stepperField({ name: "kg", value: 2.5, min: 1.25, max: 10, step: 1.25, label: "Kilograms to add", unit: "kg", ch: 4, suffix: "kg" })}</p>
  <p class="rb-log mono">Sample log · 2 easy sessions${rir ? " · 3 reps in reserve" : ""} · ${esc(lift.toLowerCase())} ${base} kg</p>
  <div class="rb-out" data-state="done">
    <div class="rb-lane"><span class="lane-pill" data-tone="applied" data-rb-lane><span class="lane-dot" aria-hidden="true"></span>${vx("Applied automatically")}</span></div>
    <span class="rb-lift"><small>Next session</small>${esc(lift)}</span>
    <span class="rb-val mono">${base} kg → ${vx(base + 2.5 + " kg", 7, { cls: "rb-to" })}</span>
    ${TICK}
  </div>
  <p class="sr-only" aria-live="polite" data-live></p>
</div>`;
}

/**
 * Threshold slider ("How sure must it be?"): 60-95%, against a sample decision at `confidence`.
 */
export function thresholdSlider({ id = "threshold", confidence = 86, value = 80 } = {}) {
  return `<div class="threshold" data-threshold data-confidence="${confidence}">
  <div class="th-head"><label for="${id}">How sure must it be?</label><span class="mono th-val">${vx(value + "%", 4)}</span></div>
  <input type="range" id="${id}" min="60" max="95" step="1" value="${value}" aria-valuetext="${value}%: sure enough, applied automatically">
  <div class="th-scale mono" aria-hidden="true"><span>60%</span><span>Sample decision ${confidence}%</span><span>95%</span></div>
  <div class="th-out"><span class="lane-pill" data-tone="applied" data-th-lane><span class="lane-dot" aria-hidden="true"></span>${vx("Applied automatically", 21)}</span></div>
  <p class="sr-only" aria-live="polite" data-live></p>
</div>`;
}

/**
 * Visitor-controlled stepper (ARIA tabs + previous/next). steps: [{ title, body, chip? (html) }].
 */
export function walkthrough(steps, { id = "walk", label = "Steps" } = {}) {
  const n = steps.length;
  const pad = (i) => String(i + 1).padStart(2, "0");
  const tabs = steps
    .map((s, i) => `<button type="button" role="tab" id="${id}-t${i}" aria-controls="${id}-p${i}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}"><span class="walk-n mono">${pad(i)}</span><span class="walk-t">${esc(s.title)}</span>${s.chip ? `<span class="walk-flag">${s.chip}</span>` : ""}</button>`)
    .join("");
  const panels = steps
    .map(
      (s, i) => `<div class="walk-panel" role="tabpanel" id="${id}-p${i}" aria-labelledby="${id}-t${i}" tabindex="0"${i ? " hidden" : ""}>
  <p class="walk-count mono"><span aria-hidden="true">${pad(i)}/${String(n).padStart(2, "0")}</span><span class="sr-only">Step ${i + 1} of ${n}</span></p>
  <h3>${esc(s.title)} ${s.chip || ""}</h3>
  <p>${esc(s.body)}</p>
</div>`,
    )
    .join("");
  return `<div class="walk" data-tabs data-walk id="${id}" style="--n:${n}">
  <div class="walk-rail" role="tablist" aria-label="${esc(label)}">${tabs}<span class="tab-ink" aria-hidden="true"></span></div>
  <div class="walk-body">${panels}
    <div class="walk-nav"><button type="button" class="btn btn-ghost btn-sm" data-walk-step="-1">Previous</button><button type="button" class="btn btn-secondary btn-sm" data-walk-step="1">Next step</button></div>
  </div>
</div>`;
}

/** AddressPreview: "Claim this address" -> signup.html?slug=… (address_typed tracks length only). */
export function addressPreview({ id = "addr" } = {}) {
  return `<form class="address" data-address action="signup.html" novalidate>
  <label for="${id}">Your coaching name</label>
  <div class="address-row">
    <input id="${id}" name="name" type="text" autocomplete="off" maxlength="60" placeholder="e.g. Layla Strength" spellcheck="false">
    <a class="btn btn-secondary" href="signup.html" data-address-claim data-cta="claim" data-loc="inline">Claim this address</a>
  </div>
  <p class="address-out mono" aria-live="polite"><span class="address-slug" data-address-out>your-name</span>.trainsyou.com</p>
  <p class="hint">We’ll check it’s free in setup</p>
</form>`;
}

/** Kamran pill (inline variant; the floating one is in the layout). */
export function kamranPill({ inline = true } = {}) {
  return `<button type="button" class="kamran${inline ? " kamran-inline" : ""}" data-kamran><span class="kamran-dot" aria-hidden="true"></span>Talk to Kamran (AI voice)</button>`;
}

/** A plain data table. rows: array of arrays (html allowed in cells via { html }). */
export function dataTable({ caption = "", columns = [], rows = [], cls = "" }) {
  const cell = (v) => (v && typeof v === "object" ? v.html : esc(v));
  return `<div class="table-wrap"><table class="table${cls ? " " + cls : ""}">${caption ? `<caption>${esc(caption)}</caption>` : ""}<thead><tr>${columns.map((c) => `<th scope="col">${esc(c)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((v, i) => (i === 0 ? `<th scope="row">${cell(v)}</th>` : `<td>${cell(v)}</td>`)).join("")}</tr>`).join("")}</tbody></table></div>`;
}

/** Related pages as a quiet link row. */
export function relatedLinks(paths = [], { title = "Related" } = {}) {
  const valid = paths.filter((p) => p !== "/coaches");
  if (!valid.length) return "";
  return `<nav class="related" aria-label="${esc(title)}"><p class="kicker">${esc(title)}</p><ul>${valid.map((p) => `<li>${textLink(p, labelOf(p))}</li>`).join("")}</ul></nav>`;
}
const labelOf = (p) => content.pages.find((x) => x.path === p)?.navLabel ?? p;

/** Statement mock line list. lines: [{ label, value, tone?: "minus" | "total" | "muted" }]. */
export function statementLines(lines) {
  return `<dl class="stmt">${lines.map((l) => `<div class="stmt-row${l.tone ? " stmt-" + l.tone : ""}"><dt>${l.html ? l.label : esc(l.label)}</dt><dd class="mono">${esc(l.value)}</dd></div>`).join("")}</dl>`;
}
