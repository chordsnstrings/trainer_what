// Shared component helpers for concept C "The Method". Every helper returns
// an HTML string. Text arguments are escaped unless the parameter name ends
// in `Html` (or is documented as HTML). Class vocabulary: src/BUILDERS.md.
// DO NOT EDIT in page builds: request changes in your report.
import { href } from "./registry.mjs";
import { source } from "./content.mjs";

// ---------------------------------------------------------------------------
// Basics

export const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Attribute string from an object: attrs({id:"x", hidden:true, tabindex:false}). */
export const attrs = (obj = {}) =>
  Object.entries(obj)
    .filter(([, v]) => v !== false && v !== null && v !== undefined)
    .map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${esc(v)}"`))
    .join("");

export const cx = (...c) => c.flat().filter(Boolean).join(" ");
/** Map and join: each(items, (x, i) => `<li>${x}</li>`). */
export const each = (items = [], fn) => items.map(fn).join("");
/** Slug for ids: "Will my AI replace me?" -> "will-my-ai-replace-me". */
export const slug = (s) =>
  String(s).toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
/** Props for tyTrack as a data attribute. */
const trackProps = (props) => esc(JSON.stringify(props));

// ---------------------------------------------------------------------------
// Icons (inline SVG, 1.5px strokes, currentColor). icon("check"), etc.

const ICONS = {
  check: '<path d="M4 10.5l4 4 8-9"/>',
  circle: '<circle cx="10" cy="10" r="5.5"/>',
  arrow: '<path d="M4 10h12M11 5l5 5-5 5"/>',
  chevron: '<path d="M6 8l4 4 4-4"/>',
  plus: '<path d="M10 4v12M4 10h12"/>',
  close: '<path d="M5 5l10 10M15 5L5 15"/>',
  menu: '<path d="M3 6h14M3 10h14M3 14h14"/>',
  pause: '<path d="M7.5 5v10M12.5 5v10"/>',
  user: '<circle cx="10" cy="7" r="3"/><path d="M4 17c1-3.5 3.5-5 6-5s5 1.5 6 5"/>',
  lock: '<rect x="4.5" y="9" width="11" height="8" rx="1"/><path d="M7 9V6.5a3 3 0 016 0V9"/>',
  mic: '<rect x="7.5" y="3" width="5" height="9" rx="2.5"/><path d="M5 10a5 5 0 0010 0M10 15v2.5"/>',
  share: '<path d="M10 3v10M6 7l4-4 4 4M4 12v4h12v-4"/>',
  wifi: '<path d="M3 8a10 10 0 0114 0M5.5 10.5a6.5 6.5 0 019 0M8 13a3 3 0 014 0"/><circle cx="10" cy="15.5" r=".6"/>',
};
export function icon(name, { size = 20, className = "", label } = {}) {
  const a11y = label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"';
  return `<svg class="${cx("ic", "ic-" + name, className)}" width="${size}" height="${size}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" ${a11y}>${ICONS[name] || ""}</svg>`;
}

// ---------------------------------------------------------------------------
// Product-state flags. The dev panel sets data attributes on <html>; CSS hides
// the other branch. Default (live) state: payments off, publishing blocked,
// registration open, frontier off, voice off.

const FLAG_CLASS = {
  payments: ["if-payments-off", "if-payments-on"],
  publish: ["if-publish-blocked", "if-publish-open"],
  voice: ["if-voice-off", "if-voice-on"],
  frontier: ["if-frontier-off", "if-frontier-on"],
  registration: ["if-reg-closed", "if-reg-open"],
};
/** Shown only while `flag` is off / blocked / closed. */
export const whenOff = (flag, html, tag = "span") => `<${tag} class="${FLAG_CLASS[flag][0]}">${html}</${tag}>`;
/** Shown only while `flag` is on / open. */
export const whenOn = (flag, html, tag = "span") => `<${tag} class="${FLAG_CLASS[flag][1]}">${html}</${tag}>`;
/** Two branches in one call: flagged("payments", offHtml, onHtml). */
export const flagged = (flag, offHtml, onHtml, tag = "span") =>
  whenOff(flag, offHtml, tag) + whenOn(flag, onHtml, tag);

// ---------------------------------------------------------------------------
// Chips and labels

/**
 * chip(kind, text): kinds = included | optional | addon | noton | live |
 * sample | estimate | neutral.
 */
export function chip(kind, text, { className = "" } = {}) {
  const glyph =
    kind === "included" || kind === "live" ? icon("check", { size: 14 })
    : kind === "noton" ? '<span class="chip-dot" aria-hidden="true"></span>'
    : "";
  return `<span class="${cx("chip", "chip--" + kind, className)}">${glyph}${esc(text)}</span>`;
}
/**
 * A chip that follows a flag: "Not on yet: subscriber payments" while off,
 * and `onText` (default "Live today") while on.
 */
export function statusChip(flag, offText, onText = "Live today") {
  return flagged(flag, chip("noton", offText), chip("live", onText));
}
/** The offering chip of a feature (content.json `offering`). */
export function offeringChip(offering) {
  const kind = { Included: "included", "Optional tier": "optional", "Add-on": "addon" }[offering] || "neutral";
  return chip(kind, offering);
}
export const sampleLabel = (text = "Sample trainer · scripted") => chip("sample", text);
export const estimateLabel = () => chip("estimate", "Estimate, not a promise");

/** "Source →" badge linking to methodology.html#<source id>. */
export function sourceBadge(id, { label = "Source" } = {}) {
  const s = source(id);
  return `<a class="src" href="${href("/methodology", "#" + id)}" aria-label="${esc(`${label}: ${s.publisher}, ${s.title} (methodology)`)}" title="${esc(s.publisher)}">${esc(label)}<span class="arr" aria-hidden="true">→</span></a>`;
}

/**
 * Badge to a /methodology section (for figures built from several sources),
 * e.g. methodBadge("follower-formula", "Sources"). Section ids on
 * /methodology: principles, follower-formula, earnings-method.
 */
export function methodBadge(anchor, label = "Sources") {
  return `<a class="src" href="${href("/methodology", "#" + anchor)}" aria-label="${esc(`${label}: how we calculate this (methodology)`)}">${esc(label)}<span class="arr" aria-hidden="true">→</span></a>`;
}

// ---------------------------------------------------------------------------
// CTAs

export const CTA_LABEL = "Teach your AI — free";
export const CTA_CLOSED_LABEL = "Join early access — free";

/**
 * The one primary CTA. location: header | hero | sticky | inline | closing.
 * Registration closed swaps the label (CSS) and the target (site.js).
 */
export function cta({ location = "inline", size = "lg", block = false, className = "", query = "" } = {}) {
  return `<a class="${cx("btn btn-primary", size === "lg" && "btn-lg", size === "sm" && "btn-sm", block && "btn-block", className)}" href="${href("/signup" + query)}" data-cta="primary" data-track="cta_click" data-track-props="${trackProps({ label: CTA_LABEL, location })}"><span class="if-reg-open">${CTA_LABEL}</span><span class="if-reg-closed">${CTA_CLOSED_LABEL}</span></a>`;
}
/** Page-relevant secondary action. variant: "link" (text + arrow) or "button". */
export function secondary(label, path, { location = "inline", variant = "link", className = "" } = {}) {
  const t = `data-track="cta_click" data-track-props="${trackProps({ label, location })}"`;
  if (variant === "button")
    return `<a class="${cx("btn btn-secondary btn-lg", className)}" href="${href(path)}" ${t}>${esc(label)}</a>`;
  return linkArrow(label, path, { className, attrsHtml: t });
}
/** Text link with a nudging arrow (mirrors in RTL). */
export function linkArrow(label, path, { className = "", attrsHtml = "" } = {}) {
  const url = String(path).startsWith("#") ? path : href(path);
  return `<a class="${cx("link-arrow", className)}" href="${url}" ${attrsHtml}><span class="la">${esc(label)}</span><span class="arr" aria-hidden="true">→</span></a>`;
}
/** Micro line under hero CTAs. */
export function microLine() {
  return `<p class="micro">${flagged(
    "registration",
    "Free to join · We’ll tell you here when sign-ups reopen",
    "Free to join · Nothing to pay upfront · Nothing goes live until you publish",
  )}</p>`;
}

// ---------------------------------------------------------------------------
// Typography blocks

/** Pace highlighter mark on a phrase (max one per viewport). */
export const mark = (text) => `<span class="mk-mark">${esc(text)}</span>`;
/** H1 text with `highlight` wrapped in the highlighter mark. */
export function h1Html(text, highlight) {
  if (!highlight || !text.includes(highlight)) return esc(text);
  const i = text.indexOf(highlight);
  return esc(text.slice(0, i)) + mark(highlight) + esc(text.slice(i + highlight.length));
}

/**
 * Section head: "§n" + drawing rule + H2 (+ lede). titleHtml is HTML.
 * Pass n:null to drop the section number.
 */
export function sectionHead({ n, titleHtml, title, lede, id, level = 2, className = "", reveal = true }) {
  const t = titleHtml ?? esc(title);
  const H = `h${level}`;
  return `<header class="${cx("sec-head", className)}"${reveal ? " data-reveal" : ""}>
  <div class="sec-rule">${n != null ? `<span class="sn">§${esc(n)}</span>` : ""}${ruleLine()}</div>
  <${H} class="h${level}"${id ? ` id="${id}"` : ""}>${t}</${H}>
  ${lede ? `<p class="sec-lede">${esc(lede)}</p>` : ""}
</header>`;
}
/** A 1px SVG rule that draws (stroke-dashoffset) when its reveal unit enters. */
export const ruleLine = () =>
  `<svg class="rule-svg" aria-hidden="true" width="100%" height="2" preserveAspectRatio="none"><line x1="0" y1="1" x2="100%" y2="1" pathLength="100"/></svg>`;

/**
 * A page band. contentHtml is HTML. Options: paper (paper background),
 * id, labelledby (id of its heading), className, tight (less padding).
 */
export function band({ id, labelledby, paper = false, tight = false, className = "", contentHtml, wrap = true }) {
  return `<section class="${cx("band", paper && "band--paper", tight && "band--tight", className)}"${attrs({ id, "aria-labelledby": labelledby })}>
${wrap ? `<div class="wrap">${contentHtml}</div>` : contentHtml}
</section>`;
}

/**
 * Manuscript row: text (8 cols) + margin note (4 cols). At <=760px the note
 * becomes an inline note under the text. Both args are HTML.
 */
export function msRow(textHtml, noteHtml = "", { reveal = true, className = "" } = {}) {
  return `<div class="${cx("ms-row", className)}"${reveal ? " data-reveal" : ""}><div class="ms-text">${textHtml}</div>${
    noteHtml ? `<div class="mnote" role="note">${noteHtml}</div>` : '<div class="mnote mnote--empty" aria-hidden="true"></div>'
  }</div>`;
}
/** A margin note on its own (HTML). Use inside .ms-row or a figure. */
export const marginNote = (noteHtml, { pin } = {}) =>
  `<div class="mnote" role="note">${pin ? `<span class="pin" aria-hidden="true">${esc(pin)}</span>` : ""}${noteHtml}</div>`;

/** Pull quote in serif italic; textHtml may contain mark(). */
export const pullQuote = (textHtml, { cite = "", className = "" } = {}) =>
  `<blockquote class="${cx("pull", className)}" data-reveal><p>${textHtml}</p>${cite ? `<footer class="pull-cite">${esc(cite)}</footer>` : ""}</blockquote>`;

/** Figure with an editorial caption: "Fig. 2 — The paused workout" (caption optional). */
export function figure({ n, caption = "", bodyHtml, sample = true, className = "", reveal = true }) {
  return `<figure class="${cx("fig", className)}"${reveal ? " data-reveal" : ""}>
  <div class="fig-body">${bodyHtml}</div>
  <figcaption class="fig-cap"><span class="fig-n">Fig. ${esc(n)}</span>${caption ? `<span class="fig-t">${esc(caption)}</span>` : ""}${sample ? sampleLabel() : ""}</figcaption>
</figure>`;
}

// ---------------------------------------------------------------------------
// Values (stacked-span crossfade, tabular figures). site.js: tySwap(el, text)

/** A fixed-width value slot. w = CSS width (e.g. "9ch"); align start|end. */
export const valueSlot = (text, { w, align = "start", className = "", key } = {}) =>
  `<span class="${cx("vx", align === "end" && "vx--end", className)}"${w ? ` style="--w:${esc(w)}"` : ""}${key ? ` data-vx="${esc(key)}"` : ""}><span>${esc(text)}</span></span>`;
/** Visually hidden polite live region for widget results. */
export const liveRegion = (id) => `<p class="sr-only" aria-live="polite" id="${esc(id)}"></p>`;

// ---------------------------------------------------------------------------
// Proof components

/**
 * StatusPanel "Live today / Not on yet" built from the flags. Items move
 * between the columns when the dev panel flips a flag.
 */
const ALWAYS_LIVE = ["Create your account", "Set up your page and app", "Teach and test your AI", "Preview what subscribers will see"];
const GATED = [
  ["publish", "Publish your page to subscribers"],
  ["payments", "Subscriber payments in AED"],
  ["payments", "Payouts to a UAE bank"],
  ["payments", "Paid bookings"],
  ["voice", "Voice add-on for subscribers"],
];
// Short labels for word-budgeted pages (compact panel on the home page).
const ALWAYS_LIVE_SHORT = ["Sign up", "Set up your page and app", "Teach and test your AI", "Preview what subscribers see"];
const GATED_SHORT = [["publish", "Publishing your page"], ["payments", "Subscriber payments"], ["payments", "Payouts"], ["payments", "Paid bookings"], ["voice", "Voice for subscribers"]];
/**
 * statusPanel({ id, title, compact, headingLevel }): compact uses the short
 * labels and drops the date line (for the word-budgeted home page).
 */
export function statusPanel({ id = "status", title = "What works today", compact = false, headingLevel = 3 } = {}) {
  const live = compact ? ALWAYS_LIVE_SHORT : ALWAYS_LIVE, gated = compact ? GATED_SHORT : GATED;
  const H = `h${headingLevel}`;
  const item = (text, cls = "") => `<li${cls ? ` class="${cls}"` : ""}>${text}</li>`;
  return `<div class="${cx("status-panel", compact && "status-panel--compact")}" id="${esc(id)}" data-reveal>
  <div class="sp-head"><${H} class="sp-title">${esc(title)}</${H}>${compact ? "" : '<span class="sp-date">As of 26 Oct 2026</span>'}</div>
  <div class="sp-cols">
    <div class="sp-col sp-live"><p class="sp-label">${icon("check", { size: 16 })}Live today</p><ul>${each(live, (t) => item(esc(t)))}${each(gated, ([f, t]) => item(esc(t), FLAG_CLASS[f][1]))}</ul></div>
    <div class="sp-col sp-not"><p class="sp-label"><span class="chip-dot" aria-hidden="true"></span>Not on yet</p><ul>${each(gated, ([f, t]) => item(esc(t), FLAG_CLASS[f][0]))}<li class="sp-none if-all-on">Nothing. Everything is on.</li></ul></div>
  </div>
</div>`;
}

/** The constraint list as a signed "Never" sheet. */
export const NEVER_ITEMS = [
  ["Hide pain or red flags.", "They pause the workout and come to you."],
  ["Pretend to be you.", "Subscribers see a labelled digital coach."],
  ["Give medical advice.", ""],
  ["Use your teaching for anyone else.", ""],
];
export function neverSheet({ titleHtml = "What your AI will <em>never</em> do", headingLevel = 3, signed = true, compact = false } = {}) {
  const H = `h${headingLevel}`;
  return `<div class="${cx("never-sheet", compact && "never-sheet--compact")}" data-reveal>
  ${compact ? "" : '<p class="never-kicker">Limits · v1 · 26 Oct 2026</p>'}
  <${H} class="never-title">${titleHtml}</${H}>
  <ol class="never-list">${each(
    NEVER_ITEMS,
    ([t, d], i) => `<li style="--i:${i}"><span class="never-word">Never</span><span class="never-text">${esc(t)}${d && !compact ? ` <span class="never-sub">${esc(d)}</span>` : ""}</span></li>`,
  )}</ol>
  <p class="never-foot">${icon("lock", { size: 16 })}<span>Pain and red flags pause the workout and come to you. Enforced in code, outside the AI.</span></p>
  ${signed ? `<p class="never-sign"><span class="sig-line" aria-hidden="true"></span><span class="placeholder">Founder’s signature</span>${compact ? "" : '<span class="sig-note">owner to supply · decision 2</span>'}</p>` : ""}
</div>`;
}

/** Founder letter placeholder (decision 2: owner supplies photo, name, words). */
export function founderLetter({ headingLevel = 3, title = "Why I built this" } = {}) {
  const H = `h${headingLevel}`;
  return `<article class="letter" data-reveal aria-label="Founder letter">
  <div class="letter-photo" role="img" aria-label="Founder photo placeholder"><span>Founder photo</span><small>owner to supply</small></div>
  <div class="letter-body">
    <p class="letter-kicker">A letter from the founder</p>
    <${H} class="letter-title">${esc(title)}</${H}>
    <div class="letter-lines" aria-label="Placeholder for the founder’s note">
      <span></span><span></span><span></span><span class="short"></span>
      <p class="letter-tag">Founder’s note goes here (decision 2).</p>
    </div>
    <p class="letter-sign"><span class="placeholder">Founder’s name</span>, founder of trainsyou</p>
  </div>
</article>`;
}

// ---------------------------------------------------------------------------
// Product frames

/**
 * Typeset rule card (C's signature object).
 * status: "pending" | "confirmed". pins: annotation letters for source/status.
 * In the home hero, core.js plays the pending -> confirmed change once.
 */
export function ruleCard({
  kicker = "Rule 07 · Progression",
  text = "After two sessions at 3+ reps in reserve, add 2.5 kg.",
  source: src = "Interview, 12 Oct",
  scope = "Squat, bench press",
  status = "pending",
  confirmedOn = "26 Oct",
  pins = false,
  actions = true,
  sample = true,
  id,
  className = "",
} = {}) {
  const confirmed = status === "confirmed";
  const pending = `<span class="rc-state rc-state--wait"><span class="chip-dot" aria-hidden="true"></span>Waiting for your OK</span>`;
  const done = `<span class="rc-state rc-state--ok">${icon("check", { size: 14 })}Confirmed · ${esc(confirmedOn)}</span>`;
  return `<div class="${cx("rule-card", confirmed && "is-confirmed", className)}"${id ? ` id="${esc(id)}"` : ""} data-rule-card>
  <span class="rc-wash" aria-hidden="true"></span><span class="rc-edge" aria-hidden="true"></span>
  <div class="rc-head"><span class="rc-kicker">${esc(kicker)}</span>${sample ? '<span class="rc-sample">Sample</span>' : ""}</div>
  <p class="rc-text">${esc(text)}</p>
  <dl class="rc-meta">
    <div><dt>Source</dt><dd>${esc(src)}${pins ? '<span class="pin" aria-hidden="true">a</span>' : ""}</dd></div>
    <div><dt>Applies to</dt><dd>${esc(scope)}</dd></div>
    <div><dt>Status</dt><dd><span class="vx" data-vx="rule-status">${confirmed ? `<span>${done}</span>` : `<span>${pending}</span>`}</span>${pins ? '<span class="pin" aria-hidden="true">b</span>' : ""}</dd></div>
  </dl>
  ${actions ? `<div class="rc-actions" aria-hidden="true"><span class="btn-ui btn-ui--ink" data-rc-confirm><span class="vx" data-vx="rc-btn" style="--w:9ch">${confirmed ? "<span>Confirmed</span>" : "<span>Confirm</span>"}</span></span><span class="btn-ui">Edit</span><span class="btn-ui">Reject</span></div>` : ""}
  <span class="rc-stamp" aria-hidden="true"><span>Confirmed</span><b>${esc(confirmedOn)}</b></span>
  <template data-rc-wait>${pending}</template><template data-rc-done>${done}</template>
</div>`;
}

/** Phone device frame (a product object). screenHtml is the app UI. */
export function phone({ screenHtml, label = "", className = "", rtlVignette = false } = {}) {
  return `<div class="${cx("phone", className)}"${label ? ` role="img" aria-label="${esc(label)}"` : ""}${rtlVignette ? " data-rtl-vignette" : ""}>
  <div class="phone-screen">${screenHtml}</div>
</div>`;
}
/** Trainer workspace window (laptop panel). bodyHtml is the UI. */
export function windowFrame({ title, bodyHtml, chipHtml = "", className = "" } = {}) {
  return `<div class="${cx("window", className)}">
  <div class="window-bar"><span class="window-title">${esc(title)}</span>${chipHtml}</div>
  <div class="window-body">${bodyHtml}</div>
</div>`;
}
/** Decision lanes. active: "applied" | "toyou" | "paused". */
export function lanes({ active = "applied" } = {}) {
  const L = [
    ["applied", "Sent on its own, within your rules", "check"],
    ["toyou", "Waits for you", "user"],
    ["paused", "Training paused", "pause"],
  ];
  return `<ol class="lanes">${each(
    L,
    ([k, t, ic]) => `<li class="${cx("lane", "lane--" + k, k === active && "is-active")}">${icon(ic, { size: 16 })}<span>${esc(t)}</span>${k === active ? '<span class="lane-token" aria-hidden="true"></span>' : ""}</li>`,
  )}</ol>`;
}

// ---------------------------------------------------------------------------
// Widgets

/** AddressPreview: "Claim this address" -> signup.html?slug=... */
export function addressPreview({ id = "addr", location = "inline" } = {}) {
  return `<form class="addr" action="${href("/signup")}" method="get" data-address data-track-location="${esc(location)}">
  <label class="addr-label" for="${esc(id)}">Your coaching name</label>
  <div class="addr-row">
    <input class="input" id="${esc(id)}" name="name" type="text" autocomplete="off" spellcheck="false" maxlength="60" placeholder="e.g. Layla Strength" data-address-input>
    <button class="btn btn-secondary" type="submit">Claim this address</button>
  </div>
  <p class="addr-preview"><span class="addr-url"><span data-address-slug>your-name</span>.trainsyou.com</span><span class="caret" aria-hidden="true"></span></p>
  <p class="addr-hint">We’ll check it’s free in setup.</p>
  <p class="sr-only" aria-live="polite" data-address-live></p>
</form>`;
}

/** Table with caption. numeric: indexes of right-aligned tabular columns. */
export function table({ caption, columns, rows, numeric = [], className = "", rowHeaders = true }) {
  return `<div class="tbl-wrap"><table class="${cx("tbl", className)}">
  ${caption ? `<caption>${esc(caption)}</caption>` : ""}
  <thead><tr>${each(columns, (c, i) => `<th scope="col"${numeric.includes(i) ? ' class="num"' : ""}>${esc(c)}</th>`)}</tr></thead>
  <tbody>${each(
    rows,
    (r) => `<tr>${each(r, (c, i) =>
      i === 0 && rowHeaders ? `<th scope="row">${esc(c)}</th>` : `<td${numeric.includes(i) ? ' class="num"' : ""}>${esc(c)}</td>`,
    )}</tr>`,
  )}</tbody>
</table></div>`;
}

/**
 * FAQ accordion (button + region; grid-rows disclosure). items: [{q, a}].
 * Each item fires faq_open with its question id.
 */
export function faq(items, { id = "faq", headingLevel = 3, className = "" } = {}) {
  const H = `h${headingLevel}`;
  return `<div class="${cx("faq", className)}" data-faq>${each(items, (it, i) => {
    const qid = `${id}-${i}`;
    return `<div class="faq-item" data-reveal style="--i:${Math.min(i, 5)}">
  <${H} class="faq-h"><button class="faq-q" type="button" aria-expanded="false" aria-controls="${qid}" id="${qid}-q" data-faq-id="${esc(slug(it.q))}"><span class="faq-n">${String(i + 1).padStart(2, "0")}</span><span class="faq-qt">${esc(it.q)}</span><span class="faq-icon" aria-hidden="true"></span></button></${H}>
  <div class="faq-a" id="${qid}" role="region" aria-labelledby="${qid}-q"><div><p>${esc(it.a)}</p></div></div>
</div>`;
  })}</div>`;
}

/**
 * ARIA tabs. tabs: [{ id, label (HTML ok), panelHtml }]. site.js wires
 * arrows/Home/End and roving tabindex; panels enter by opacity + 8px rise.
 */
export function tabs({ id, label, tabs: list, className = "", tabClass = "" }) {
  return `<div class="${cx("tabs", className)}" data-tabs="${esc(id)}">
  <div class="tablist" role="tablist" aria-label="${esc(label)}">${each(
    list,
    (t, i) => `<button class="${cx("tab", tabClass)}" role="tab" type="button" id="${esc(id)}-tab-${i}" aria-controls="${esc(id)}-panel-${i}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" data-tab-key="${esc(t.id || i)}">${t.label}</button>`,
  )}<span class="tab-ink" aria-hidden="true"></span></div>
  ${each(
    list,
    (t, i) => `<div class="tabpanel" role="tabpanel" id="${esc(id)}-panel-${i}" aria-labelledby="${esc(id)}-tab-${i}" tabindex="0"${i ? " hidden" : ""}>${t.panelHtml}</div>`,
  )}
</div>`;
}

/**
 * Stepper = tabs + prev/next + an SVG progress line (stroke-dashoffset).
 * steps: [{ title, panelHtml }]. Visitor-controlled; never auto-advances.
 */
export function stepper({ id, label, steps }) {
  const n = steps.length;
  return `<div class="stepper" data-stepper="${esc(id)}" style="--n:${n}">
  <div class="stepper-rail">
    <svg class="stepper-line" aria-hidden="true" width="100%" height="2" preserveAspectRatio="none"><line class="sl-track" x1="0" y1="1" x2="100%" y2="1"/><line class="sl-fill" x1="0" y1="1" x2="100%" y2="1" pathLength="100" style="stroke-dashoffset:${100 - 100 / n}"/></svg>
    <div class="tablist stepper-tabs" role="tablist" aria-label="${esc(label)}">${each(
      steps,
      (s, i) => `<button class="step-tab" role="tab" type="button" id="${esc(id)}-tab-${i}" aria-controls="${esc(id)}-panel-${i}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}"><span class="step-num">${i + 1}</span><span class="step-name">${esc(s.title)}</span></button>`,
    )}</div>
  </div>
  <div class="stepper-panels">${each(
    steps,
    (s, i) => `<div class="tabpanel step-panel" role="tabpanel" id="${esc(id)}-panel-${i}" aria-labelledby="${esc(id)}-tab-${i}" tabindex="0"${i ? " hidden" : ""}>${s.panelHtml}</div>`,
  )}</div>
  <div class="stepper-nav">
    <button class="btn btn-secondary btn-icon" type="button" data-step="-1" aria-label="Previous chapter">${icon("arrow", { className: "flip" })}</button>
    <p class="stepper-count" aria-hidden="true"><span class="vx" data-vx="step"><span>1</span></span> / ${n}</p>
    <button class="btn btn-secondary btn-icon" type="button" data-step="1" aria-label="Next chapter">${icon("arrow")}</button>
  </div>
</div>`;
}

/** Talk to Kamran pill. inline: in-flow on phones; float: desktop corner. */
export function kamranPill({ inline = true, location = "inline" } = {}) {
  return `<button class="${cx("kamran", inline ? "kamran--inline" : "kamran--float")}" type="button" data-kamran data-track-location="${esc(location)}"><span class="kamran-ic">${icon("mic", { size: 16 })}</span>Talk to Kamran (AI voice)</button>`;
}

/** "Send this to myself": Web Share, copy-link fallback ("Link copied"). */
export function shareButton({ label = "Send this to myself", className = "" } = {}) {
  return `<button class="${cx("btn btn-secondary btn-lg", className)}" type="button" data-share>${icon("share", { size: 18 })}<span>${esc(label)}</span></button><span class="sr-only" aria-live="polite" data-share-status></span>`;
}

/** Labelled form field. inputHtml lets you pass a custom control. */
export function field({ id, label, type = "text", value = "", suffix = "", prefix = "", help = "", attrsObj = {}, inputHtml = "" }) {
  const control =
    inputHtml ||
    `<input class="input" id="${esc(id)}" type="${esc(type)}" value="${esc(value)}"${attrs(attrsObj)}${help ? ` aria-describedby="${esc(id)}-help"` : ""}>`;
  return `<div class="field">
  <label class="field-label" for="${esc(id)}">${esc(label)}</label>
  <div class="${cx("input-wrap", prefix && "has-prefix", suffix && "has-suffix")}">${prefix ? `<span class="affix affix--pre">${esc(prefix)}</span>` : ""}${control}${suffix ? `<span class="affix affix--suf">${esc(suffix)}</span>` : ""}</div>
  ${help ? `<p class="field-help" id="${esc(id)}-help">${esc(help)}</p>` : ""}
</div>`;
}

/** Visible "not built yet" stub body (dispatcher fallback). */
export function stubMain(page, moduleName) {
  return `<section class="hero hero--stub" data-hero><div class="wrap">
  <p class="eyebrow">${esc(page.eyebrow || page.navLabel)}</p>
  <h1 class="display">${esc(page.h1)}</h1>
  ${page.lede ? `<p class="lede">${esc(page.lede)}</p>` : ""}
  <div class="stub-banner" role="note"><strong>Not built yet.</strong> This page belongs to <code>${esc(moduleName)}</code>. It renders the content.json headline only.</div>
</div></section>`;
}
