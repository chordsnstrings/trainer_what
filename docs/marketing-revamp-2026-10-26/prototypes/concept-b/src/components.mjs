// Shared component helpers. Every helper returns an HTML string.
// Foundation-owned: builders import these and may request new ones.
import { esc, href, sourceFor, C, content } from "./core.mjs";

let uid = 0;
const nextId = (p) => `${p}-${++uid}`;
const PRIMARY = "Teach your AI — free";
const PRIMARY_CLOSED = "Join early access — free";

/* ------------------------------------------------------------------ icons */
const ICONS = {
  arrow: '<svg class="arr" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.5 8h10M8.5 3.5 13 8l-4.5 4.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  check: '<svg viewBox="0 0 22 22" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="10" fill="currentColor" opacity=".13"/><path d="m6.6 11.3 3 3 5.9-6.3" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  cross: '<svg viewBox="0 0 22 22" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="10" fill="currentColor" opacity=".12"/><path d="m7.7 7.7 6.6 6.6m0-6.6-6.6 6.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  pending: '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="8.2" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2.6 2.6"/><circle cx="10" cy="10" r="2.2" fill="currentColor"/></svg>',
  lock: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="3.5" y="7" width="9" height="6.5" rx="1.6" stroke="currentColor" stroke-width="1.5"/><path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" stroke="currentColor" stroke-width="1.5"/></svg>',
  plus: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  minus: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  chevron: '<svg viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="m2.5 4.5 3.5 3.5 3.5-3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  prev: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  next: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  mic: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="5.5" y="2" width="5" height="8" rx="2.5" stroke="currentColor" stroke-width="1.5"/><path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  info: '<svg viewBox="0 0 18 18" fill="none" aria-hidden="true"><circle cx="9" cy="9" r="7.5" stroke="currentColor" stroke-width="1.5"/><path d="M9 8v4.5M9 5.4v.1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  faq: '<svg viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M2 7h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path class="v" d="M7 2v10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  sliders: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 4.5h7m3 0h2M2 11.5h2m3 0h7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="10.5" cy="4.5" r="1.6" stroke="currentColor" stroke-width="1.5"/><circle cx="5.5" cy="11.5" r="1.6" stroke="currentColor" stroke-width="1.5"/></svg>',
  signal: '<svg viewBox="0 0 18 10" aria-hidden="true"><rect x="0" y="7" width="3" height="3" rx="1" fill="currentColor"/><rect x="5" y="5" width="3" height="5" rx="1" fill="currentColor"/><rect x="10" y="2.5" width="3" height="7.5" rx="1" fill="currentColor"/><rect x="15" y="0" width="3" height="10" rx="1" fill="currentColor"/></svg>',
  battery: '<svg viewBox="0 0 26 12" fill="none" aria-hidden="true"><rect x=".75" y=".75" width="21.5" height="10.5" rx="3" stroke="currentColor" stroke-width="1.2" opacity=".5"/><rect x="2.5" y="2.5" width="16" height="7" rx="1.6" fill="currentColor"/><path d="M24 4.3v3.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" opacity=".5"/></svg>',
};
/** Inline icon by name (aria-hidden). Names: arrow, check, cross, pending, lock, plus, minus, chevron, prev, next, mic, info, faq, sliders, signal, battery. */
export const icon = (name) => ICONS[name] || "";

/* ------------------------------------------------------------- text bits */
/** Wrap the first occurrence of `word` in span.mk-mark (the Pace highlight). */
export function hl(text, word) {
  const t = esc(text);
  if (!word) return t;
  const w = esc(word), i = t.indexOf(w);
  return i < 0 ? t : t.slice(0, i) + `<span class="mk-mark">${w}</span>` + t.slice(i + w.length);
}
/** Archivo eyebrow. opts: { muted, plain, tag } */
export const eyebrow = (text, o = {}) =>
  text ? `<${o.tag || "p"} class="eyebrow${o.muted ? " eyebrow--muted" : ""}${o.plain ? " eyebrow--plain" : ""}">${esc(text)}</${o.tag || "p"}>` : "";

/**
 * Section header. { eyebrow, title, lede, level=2, id, center, row, after, cls }
 * `title` and `lede` are escaped; pass `titleHtml`/`ledeHtml` for markup.
 */
export function sectionHead(o) {
  const L = o.level || 2;
  const title = o.titleHtml ?? esc(o.title);
  const lede = o.ledeHtml ?? (o.lede ? esc(o.lede) : "");
  return `<div class="sec-head${o.center ? " sec-head--center" : ""}${o.row ? " sec-head--row" : ""}${o.cls ? " " + o.cls : ""}${o.reveal === false ? "" : " reveal"}">
  <div>${eyebrow(o.eyebrow, { muted: o.muted })}<h${L}${o.id ? ` id="${o.id}"` : ""}>${title}</h${L}>${lede ? `<p class="lede">${lede}</p>` : ""}</div>${o.after || ""}
</div>`;
}

/**
 * Full-width band. { id, tone: "white"|"paper"|"wash"|"pace", inner, narrow, cls, label, labelledby, tight }
 */
export function band(o) {
  const tone = o.tone && o.tone !== "white" ? ` band--${o.tone}` : "";
  const aria = o.labelledby ? ` aria-labelledby="${o.labelledby}"` : o.label ? ` aria-label="${esc(o.label)}"` : "";
  return `<section class="band${tone}${o.tight ? " band--tight" : ""}${o.cls ? " " + o.cls : ""}"${o.id ? ` id="${o.id}"` : ""}${aria}>
<div class="container${o.narrow ? " container--narrow" : ""}">${o.inner}</div>
</section>`;
}

/* ------------------------------------------------------------------- CTAs */
/**
 * The one primary CTA, "Teach your AI — free", linking to signup.html.
 * Switches to "Join early access — free" when registration is closed.
 * { location: "header"|"hero"|"sticky"|"inline"|"closing", size: "sm", block, href }
 */
export function primaryCta(o = {}) {
  const cls = ["btn", "js-primary", o.size === "sm" ? "btn--sm" : "", o.block ? "btn--block" : "", o.cls || ""].filter(Boolean).join(" ");
  return `<a class="${cls}" href="${esc(o.href || "signup.html")}" data-cta="${esc(o.location || "inline")}"><span class="if-reg-open">${PRIMARY}</span><span class="if-reg-closed">${PRIMARY_CLOSED}</span>${icon("arrow")}</a>`;
}
/** Secondary action as a text link with an arrow. { label, href (site path), location, button } */
export function secondaryLink(o) {
  if (!o) return "";
  if (o.button) return `<a class="btn btn--secondary" href="${esc(href(o.href))}" data-cta="${esc(o.location || "inline")}">${esc(o.label)}${icon("arrow")}</a>`;
  return `<a class="link" href="${esc(href(o.href))}" data-cta="${esc(o.location || "inline")}">${esc(o.label)}${icon("arrow")}</a>`;
}
/** Micro line under a primary CTA (registration-aware). */
export const microLine = () =>
  `<p class="cta-micro if-reg-open"><span>Free to join</span><span>Nothing to pay upfront</span><span>Nothing goes live until you publish</span></p><p class="cta-micro if-reg-closed"><span>Free to join</span><span>We'll tell you here when sign-ups reopen</span></p>`;
/** Primary CTA + optional secondary + micro line. { location, secondary: {label, href, button}, micro=true, stack } */
export function ctaRow(o = {}) {
  return `<div class="cta-row${o.stack === false ? "" : " cta-row--stack-sm"}">${primaryCta({ location: o.location })}${secondaryLink(o.secondary && { ...o.secondary, location: o.location })}</div>${o.micro === false ? "" : microLine()}`;
}

/* ------------------------------------------------------------------ chips */
/** chip(text, kind): kind = ok | off | err | line | sample | pace | ink | plain */
export const chip = (text, kind = "line") => `<span class="chip chip--${kind}">${esc(text)}</span>`;
/** Offering chip from content.json page.offering: Included | Optional tier | Add-on */
export const offeringChip = (offering) =>
  offering ? chip(offering, offering === "Included" ? "ok" : "line") : "";
const FLAG_CLASS = { payments: ["payments-off", "payments-on"], voice: ["voice-off", "voice-on"], publish: ["publish-gated", "publish-open"], frontier: ["frontier-off", "frontier-on"], registration: ["reg-closed", "reg-open"] };
/**
 * Honest status chip pair driven by a flag on <html>.
 * statusChip("payments", "subscriber payments") -> "Not on yet: subscriber payments" (or "Live: …" when on).
 */
export function statusChip(flag, what, o = {}) {
  const [off, on] = FLAG_CLASS[flag] || FLAG_CLASS.payments;
  const label = what ? `: ${what}` : "";
  return `<span class="chip chip--off if-${off}">Not on yet${esc(label)}</span>${o.hideOn ? "" : `<span class="chip chip--ok if-${on}">Live${esc(label)}</span>`}`;
}
/** "Sample trainer · scripted" (or custom text). */
export const sampleLabel = (text = "Sample trainer · scripted") => `<span class="chip chip--sample">${esc(text)}</span>`;
/** "Estimate, not a promise". */
export const estimateLabel = () => `<span class="label-estimate">Estimate, not a promise</span>`;
/** "Source →" badge to /methodology#id. Only for ids that exist in content.sources. */
export function srcBadge(id) {
  const s = sourceFor(id);
  if (!s) return "";
  return `<a class="src" href="${href("/methodology#" + id)}" aria-label="Source: ${esc(s.publisher)}, ${esc(s.title)}">Source${icon("arrow")}</a>`;
}
/** Owner wording under every AED take-home figure while payments are off. */
export const paymentsNote = () =>
  `<p class="payments-note if-payments-off">${icon("info")}<span>Subscriber payments are not on yet. Set up and teach your AI now.</span></p>`;

/* ----------------------------------------------------------- value slots */
/**
 * A figure that responds to input: crossfades (or digit-rolls) on change.
 * val("AED 199", { out: "price", w: "8ch", cls: "fig fig-md", align: "end" })
 */
export function val(text, o = {}) {
  const a = [];
  if (o.out) a.push(`data-out="${esc(o.out)}"`);
  if (o.showPrice !== undefined) a.push(`data-show-price="${o.showPrice}"`);
  if (o.attrs) a.push(o.attrs);
  const style = o.w ? ` style="--w:${o.w}"` : "";
  const align = o.align ? ` val--${o.align}` : "";
  return `<span class="val${align}${o.cls ? " " + o.cls : ""}"${style} ${a.join(" ")}><span class="val-cur">${esc(text)}</span></span>`;
}
export const aed = (n) => "AED " + C.whole(n);

/* ----------------------------------------------------------------- forms */
/** Number field with a unit affix. { label, in, value, min, max, step, suffix, help, id, sync } */
export function numberField(o) {
  const id = o.id || nextId("f-" + o.in);
  const help = o.help ? `<span class="field-help" id="${id}-h">${esc(o.help)}</span>` : "";
  return `<div class="field"><label for="${id}">${esc(o.label)}</label><div class="affix"><input id="${id}" type="number" inputmode="decimal" data-in="${o.in}" value="${esc(o.value)}"${o.min !== undefined ? ` min="${o.min}"` : ""}${o.max !== undefined ? ` max="${o.max}"` : ""} step="${o.step || 1}"${o.sync ? ` data-sync="${o.sync}"` : ""}${help ? ` aria-describedby="${id}-h"` : ""}>${o.suffix ? `<span aria-hidden="true">${esc(o.suffix)}</span>` : ""}</div>${help}</div>`;
}
/**
 * Range with a live figure. { label, in, value, min, max, step, display, out, valuetext:"{v} subscribers", sync, w }
 */
export function rangeField(o) {
  const id = o.id || nextId("r-" + o.in);
  const vt = o.valuetext || "{v}";
  return `<div class="range"><div class="range-top"><label for="${id}">${esc(o.label)}</label>${val(o.display ?? C.whole(o.value), { out: o.out, cls: "fig", w: o.w || "6ch", align: "end" })}</div>
<input id="${id}" type="range" data-in="${o.in}" min="${o.min}" max="${o.max}" step="${o.step || 1}" value="${o.value}" data-valuetext="${esc(vt)}" aria-valuetext="${esc(vt.replace("{v}", C.whole(o.value)))}"${o.sync ? ` data-sync="${o.sync}"` : ""}>
${o.ends ? `<div class="range-ends" aria-hidden="true"><span>${esc(o.ends[0])}</span><span>${esc(o.ends[1])}</span></div>` : ""}</div>`;
}
/** AddressPreview: "Claim this address" -> signup.html?slug=. { id, label, hint } */
export function addressPreview(o = {}) {
  const id = o.id || "addr";
  return `<div class="address" data-address="{slug}.trainsyou.com">
  <div class="field"><label for="${id}">${esc(o.label || "Your coaching name")}</label><input id="${id}" class="input" type="text" autocomplete="off" maxlength="60" placeholder="e.g. Layla Strength"></div>
  <div class="address-row"><p class="address-preview flash" aria-live="polite">${icon("lock")}<span class="ltr"><b>your-name</b>.trainsyou.com</span></p><a class="btn" href="signup.html" data-claim data-cta="${esc(o.location || "inline")}" data-label="Claim this address">Claim this address</a></div>
  <p class="field-help">${esc(o.hint || "We'll check it's free in setup.")}</p>
</div>`;
}

/* ------------------------------------------------------------ disclosure */
/** FAQ accordion. items: [{q, a}] (answers closed). { idPrefix, heading } */
export function faq(items, o = {}) {
  const p = o.idPrefix || "faq";
  return `<div class="faq">${items.map((it, i) => `
<div class="acc" id="${p}-${i + 1}">
  <h3 class="acc-q"><button class="acc-btn" type="button" aria-expanded="false" aria-controls="${p}-${i + 1}-a"><span>${esc(it.q)}</span><span class="acc-icon">${icon("faq")}</span></button></h3>
  <div class="acc-panel" id="${p}-${i + 1}-a" role="region" aria-label="${esc(it.q)}"><div class="acc-inner"><div>${it.html || esc(it.a)}</div></div></div>
</div>`).join("")}</div>`;
}

/* ---------------------------------------------------------------- status */
const STATUS_ITEMS = [
  { text: "Sign up free", flag: "registration", onClass: "reg-open", offClass: "reg-closed", offText: "New sign-ups (early access for now)" },
  { text: "Set up your page and app" },
  { text: "Teach and test your AI" },
  { text: "Preview what subscribers will see" },
  { text: "Publish your page to subscribers", flag: "publish", onClass: "publish-open", offClass: "publish-gated", offText: "Publishing your page to subscribers" },
  { text: "Subscriber payments in AED", flag: "payments", onClass: "payments-on", offClass: "payments-off" },
  { text: "Payouts to a UAE bank", flag: "payments", onClass: "payments-on", offClass: "payments-off" },
  { text: "Paid bookings", flag: "payments", onClass: "payments-on", offClass: "payments-off" },
  { text: "Voice add-on for subscribers", flag: "voice", onClass: "voice-on", offClass: "voice-off" },
];
/**
 * "Live today / Not on yet", built from the flags (dev panel toggles them).
 * { id="status", title, foot }
 */
export function statusPanel(o = {}) {
  const live = STATUS_ITEMS.map((it) => `<li${it.flag ? ` class="if-${it.onClass}"` : ""}>${icon("check")}<span>${esc(it.text)}</span></li>`).join("");
  const off = STATUS_ITEMS.filter((it) => it.flag).map((it) => `<li class="if-${it.offClass}">${icon("pending")}<span>${esc(it.offText || it.text)}</span></li>`).join("");
  return `<div class="status${o.cls ? " " + o.cls : ""}"${o.id === false ? "" : ` id="${o.id || "status"}"`} role="group" aria-label="What works today">
  <div class="status-col status-col--on"><h3><span class="dot" aria-hidden="true"></span>Live today</h3><ul class="status-list">${live}</ul></div>
  <div class="status-col status-col--off"><h3><span class="dot" aria-hidden="true"></span>Not on yet</h3><ul class="status-list">${off}</ul></div>
  ${o.foot === false ? "" : `<p class="status-foot">${esc(o.foot || "Nothing goes live until you publish. We never promise a date we can't keep.")}</p>`}
</div>`;
}
/** One-line strip under a hero, before any AED figure. */
export const statusStrip = (o = {}) =>
  `<p class="status-strip if-payments-off">${icon("pending").replace("<svg", '<svg width="18" height="18"')}<span>Subscriber payments and payouts are not on yet. <a href="${esc(o.href || "#status")}">What works today</a></span></p><p class="status-strip status-strip--on if-payments-on">${icon("check").replace("<svg", '<svg width="18" height="18"')}<span>Subscriber payments and payouts are live.</span></p>`;

/* -------------------------------------------------------- product frames */
const statusBar = () => `<div class="phone-status" aria-hidden="true"><span>9:41</span><span style="display:flex;gap:5px;align-items:center">${icon("signal")}${icon("battery")}</span></div>`;
/**
 * Phone device frame. { body, url, small, label (sample chip under the phone), cls, rtl, ariaLabel }
 * The frame is a product object: aria-label describes it; inner UI is real text.
 */
export function phone(o) {
  return `<figure class="phone-wrap${o.cls ? " " + o.cls : ""}" style="margin:0">
<div class="phone${o.small ? " phone--sm" : ""}${o.rtl ? " vignette-rtl" : ""}" role="group" aria-label="${esc(o.ariaLabel || "Sample phone screen")}"><div class="phone-screen"><span class="phone-island" aria-hidden="true"></span>${statusBar()}${o.url ? `<div class="phone-url">${icon("lock")}<span>${esc(o.url)}</span></div>` : ""}<div class="phone-body">${o.body}</div></div></div>
${o.label === false ? "" : `<figcaption class="phone-label">${sampleLabel(o.label)}</figcaption>`}</figure>`;
}
/** Trainer workspace window. { title, body, cls } */
export const windowFrame = (o) =>
  `<div class="window${o.cls ? " " + o.cls : ""}"><div class="window-bar" aria-hidden="true"><i></i><i></i><i></i><span>${esc(o.title || "")}</span></div><div class="window-body">${o.body}</div></div>`;

/** The sample offer screen: Layla Strength, AED 199 / Workouts + Nutrition AED 299. Prices follow data-show-price. */
export function offerScreen(price = 199) {
  return `<div class="po">
  <div class="po-brand"><span class="po-mono" aria-hidden="true">LS</span><div><b>Layla Strength</b><span>Strength coaching</span></div></div>
  <div class="po-poster"><span class="po-poster-k">Coached my way</span><span class="po-poster-t">Strength, planned daily.</span>
    <svg class="po-bar" viewBox="0 0 120 34" aria-hidden="true"><rect x="2" y="15" width="116" height="4" rx="2" fill="#171917"/><rect x="14" y="3" width="9" height="28" rx="2.5" fill="#171917"/><rect x="25" y="7" width="6" height="20" rx="2" fill="#171917"/><rect x="97" y="3" width="9" height="28" rx="2.5" fill="#171917"/><rect x="89" y="7" width="6" height="20" rx="2" fill="#171917"/></svg></div>
  <p class="po-choose">Choose your plan</p>
  <div class="po-plans">
    <div class="po-plan is-sel"><i class="po-radio" aria-hidden="true"></i><div class="po-plan-t"><b>Workouts</b><span>Daily plan</span></div><div class="po-price flash" data-flash-price>${val(aed(price), { showPrice: 0, cls: "fig", align: "end" })}<small>a month</small></div></div>
    <div class="po-plan"><i class="po-radio" aria-hidden="true"></i><div class="po-plan-t"><b>Workouts + Nutrition</b><span>Adds meal plans</span></div><div class="po-price">${val(aed(price + 100), { showPrice: 100, cls: "fig", align: "end" })}<small>a month</small></div></div>
  </div>
  <div class="po-cta">Subscribe · ${val(aed(price), { showPrice: 0 })}</div>
  <p class="po-fine">Digital coach, taught by Layla</p>
</div>`;
}
/** Subscriber "Today" screen for the sample trainer. */
export function todayScreen() {
  return `<div class="pt">
  <div class="pt-head"><span class="po-mono" aria-hidden="true">LS</span><div><b>Today</b><span>Tue 14 Oct · week 3</span></div></div>
  <div class="pt-card"><div class="pt-card-top"><b>Lower body A</b><span class="chip chip--ok">Works offline</span></div><span class="pt-meta">45 min · 4 exercises</span>
    <div class="pt-dots" aria-hidden="true"><i class="on"></i><i class="on"></i><i></i><i></i></div></div>
  <ul class="pt-list">
    <li class="done"><span>Back squat</span><b class="fig">3 × 5 · 62.5 kg</b></li>
    <li><span>Romanian deadlift</span><b class="fig">3 × 8 · 50 kg</b></li>
    <li><span>Split squat</span><b class="fig">3 × 10 each</b></li>
    <li><span>Plank</span><b class="fig">3 × 40 s</b></li>
  </ul>
  <div class="pt-tabs" aria-hidden="true"><span class="on">Today</span><span>Plan</span><span>Progress</span><span>Chat</span></div>
</div>`;
}

/** ControlFlow card: subscriber message, your rule, how sure, three lanes. */
export function controlFlow(o = {}) {
  return windowFrame({
    title: o.title || "Inbox · Sample",
    cls: "control-flow",
    body: `<p class="bubble-meta">Subscriber · week 3</p>
<p class="bubble">Week three done. Squats felt easy.</p>
<div class="cf-rule"><span class="chip chip--ink">Your rule</span><span>Two easy sessions → add 2.5 kg</span></div>
<div class="cf-sure"><span>How sure it is</span><b class="fig">86%</b></div>
<div class="meter" style="--v:.86" aria-hidden="true"><i></i></div>
<div class="lanes" role="list">
  <div class="lane is-active" role="listitem"><span>Applied automatically</span>${icon("check").replace("<svg", '<svg width="20" height="20"')}</div>
  <div class="lane lane--off" role="listitem"><span>Unsure → to you</span></div>
  <div class="lane lane--err" role="listitem"><span>Pain → paused, to you</span></div>
</div>
<div class="cf-out"><span>Back squat</span><span class="fig"><s>60 kg</s> → 62.5 kg</span></div>`,
  });
}
/** ConstraintList: what your AI never does (content: /trainer-brain "never"). */
export function constraintList(o = {}) {
  const tb = content.pages.find((p) => p.path === "/trainer-brain");
  const items = o.items || tb.sections.find((s) => s.id === "never").bullets;
  return `<ul class="tick-list never-list"${o.label ? ` aria-label="${esc(o.label)}"` : ""}>${items.map((b) => `<li>${icon("cross")}<span>${esc(b)}</span></li>`).join("")}</ul>`;
}

/** Sample statement. rows: [{label, value, sub, minus}], total: {label, value} */
export function statement(o) {
  return `<div class="statement${o.cls ? " " + o.cls : ""}">
  <div class="statement-head"><div><p class="h4">${esc(o.title || "Monthly statement")}</p><p class="fine">${esc(o.period || "Layla Strength · October")}</p></div><div class="chip-row">${sampleLabel("Sample")}${statusChip("payments", "", { hideOn: true })}</div></div>
  ${o.rows.map((r) => `<div class="st-row${r.sub ? " st-row--sub" : ""}"><span>${esc(r.label)}</span><span class="fig">${esc(r.value)}</span></div>`).join("")}
  ${o.total ? `<div class="st-row st-row--total"><span>${esc(o.total.label)}</span><span class="fig keep">${esc(o.total.value)}</span></div>` : ""}
  ${o.note ? `<p class="st-note">${esc(o.note)}</p>` : ""}
</div>`;
}

/* ------------------------------------------------------ money components */
/** Staircase of the four bands (25 / 20 / 15 / 10%). { here: band index to mark, labels } */
export function stairs(o = {}) {
  const H = [100, 80, 60, 40], P = ["25%", "20%", "15%", "10%"], L = o.labels || ["1–100", "101–300", "301–1,000", "1,001+"];
  return `<div class="stairs-wrap" role="img" aria-label="Our share by band: 25% for subscribers 1 to 100, 20% for 101 to 300, 15% for 301 to 1,000, 10% above 1,000">
  <div class="stairs">${H.map((h, i) => `<div class="stair${o.here === i ? " is-here" : ""}" style="--i:${i}"><span class="stair-hl"></span><b class="fig stair-pct">${P[i]}</b><span class="stair-bar" style="--h:${h};--i:${i}"></span></div>`).join("")}</div>
  <div class="stairs-labels" aria-hidden="true">${L.map((l) => `<span>${esc(l)}</span>`).join("")}</div>
</div>`;
}
/** Band meter: 4 equal bands that fill with subscribers (bound by calc.js data-band-fill). */
export function bandMeter(n = 150) {
  const fills = C.bandFills(n), labels = [["25%", "1–100"], ["20%", "101–300"], ["15%", "301–1,000"], ["10%", "1,001+"]];
  return `<div class="bands" aria-hidden="true">${labels.map(([r, l], i) => `<div class="band-cell"><div class="band-track" style="--i:${i}"><span class="band-fill" data-band-fill="${i}" style="--fill:${fills[i]}"></span></div><div class="band-meta"><b class="fig">${r}</b><span>${l}</span></div></div>`).join("")}</div>`;
}
/** Blended-rate axis, 25% (left) to 10% (right), marker bound by calc.js. */
export function rateAxis(ratePct) {
  return `<div class="rate-axis" aria-hidden="true"><div class="rate-line"></div><div class="rate-marker" data-rate-marker style="--pos:${C.ratePos(ratePct)}"><span><b class="fig">${val(C.pct1(ratePct), { out: "rate" })}</b><i></i></span></div></div><div class="rate-ends" aria-hidden="true"><span>25%</span><span>10%</span></div>`;
}
/** Grid of n static session marks with an aria-label stating the comparison. */
export function sessionMarks(n, label) {
  const groups = [];
  for (let left = n; left > 0; left -= 10) groups.push(`<span class="marks-ten">${"<i></i>".repeat(Math.min(10, left))}</span>`);
  return `<div class="marks" role="img" aria-label="${esc(label || `${n} sessions`)}">${groups.join("")}</div>`;
}

/**
 * Take-home tile (B signature): price and subscribers in, our share, you keep.
 * Compact earnings maths (no nutrition, voice or sessions). Bound by calc.js.
 * { subscribers=150, price=199, rate=250, name, vt, title, priceMin=199 }
 */
export function takeHomeTile(o = {}) {
  const n = o.subscribers ?? 150, p = o.price ?? 199, rate = o.rate ?? 250;
  const e = C.compactEarnings(n, p, rate);
  const vt = o.vt ? ` data-vt="price-tile" ${o.vt}` : "";
  return `<div class="tile takehome${o.cls ? " " + o.cls : ""}" data-calc="earnings" data-calc-name="${esc(o.name || "takehome")}"${vt}>
  <div class="tile-head"><p class="eyebrow">${esc(o.title || "What you keep")}</p><div class="chip-row">${sampleLabel("Sample")}${statusChip("payments", "subscriber payments")}</div></div>
  <div class="tile-inputs">
    ${rangeField({ label: "Your price a month", in: "price", value: p, min: o.priceMin ?? 199, max: 999, step: 1, display: aed(p), out: "price", valuetext: "AED {v} a month", sync: "price", w: "8ch" })}
    ${rangeField({ label: "Paying subscribers", in: "subscribers", value: n, min: 1, max: 1500, step: 1, out: "subscribers", valuetext: "{v} subscribers", w: "5ch" })}
    <input type="hidden" data-in="rate" value="${rate}">
  </div>
  <div class="tile-rows" data-result>
    <div class="tile-row"><span>Subscriptions a month</span>${val(C.aed(e.subscriptionMonthlyMinor), { out: "revenue", cls: "fig", align: "end", w: "11ch" })}</div>
    <div class="tile-row tile-row--minus"><span>Our share, ${val(C.pct1(e.effectiveCommissionPct), { out: "rate" })} overall</span>${val("−" + C.aed(e.commissionMinor), { out: "commission", cls: "fig", align: "end", w: "11ch" })}</div>
  </div>
  <div class="tile-keep">
    <div class="tile-keep-label"><span>You keep</span><span class="fine">before card processing</span></div>
    ${val(C.aed(e.beforeOtherCostsMinor), { out: "keep", cls: "fig fig-take keep", w: "9ch" })}
  </div>
  <div class="tile-foot">
    ${bandMeter(n)}
    <p class="tile-note">About ${val(C.whole(e.equivalentSessions), { out: "sessions" })} sessions at AED ${C.whole(rate)}, every month.</p>
    ${paymentsNote()}
  </div>
  <p class="sr-only" aria-live="polite" data-live></p>
</div>`;
}

/* ------------------------------------------------------------- navigation */
/** Breadcrumbs from page.parent. */
export function crumbs(page, lookup) {
  const trail = [];
  let p = page;
  while (p && p.parent) { const parent = lookup(p.parent); if (!parent) break; trail.unshift(parent); p = parent; }
  if (!trail.length) return "";
  return `<nav class="crumbs" aria-label="Breadcrumb"><a href="index.html">Home</a>${trail.map((t) => `<span aria-hidden="true">/</span><a href="${href(t.path)}">${esc(t.navLabel)}</a>`).join("")}<span aria-hidden="true">/</span><span aria-current="page">${esc(page.navLabel)}</span></nav>`;
}
/** Walkthrough stepper (visitor-controlled). steps: [{title, body, chip}] */
export function walk(steps, o = {}) {
  const id = o.id || "walk";
  return `<div class="walk" data-walk>
  <div class="walk-tabs" role="tablist" aria-label="${esc(o.label || "Walkthrough")}" data-wc-skip>${steps.map((s, i) => `<button class="walk-tab" role="tab" id="${id}-t${i}" aria-controls="${id}-p${i}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}"><span class="fig">${String(i + 1).padStart(2, "0")}</span><span class="t">${esc(s.title)}</span></button>`).join("")}</div>
  <div class="walk-progress" aria-hidden="true"><i style="--p:${1 / steps.length}"></i></div>
  ${steps.map((s, i) => `<div class="walk-panel tabpanel" role="tabpanel" id="${id}-p${i}" aria-labelledby="${id}-t${i}"${i ? " hidden" : ""}${i ? " data-wc-skip" : ""}><span class="fig fig-num" aria-hidden="true">${String(i + 1).padStart(2, "0")}</span><div><h3>${esc(s.title)}</h3><p>${esc(s.body)}</p>${s.chip ? `<div class="chip-row" style="margin-top:12px">${s.chip}</div>` : ""}</div><div class="walk-nav" data-wc-skip><span class="fine" data-walk-count>${i + 1} of ${steps.length}</span><button type="button" data-walk-prev aria-label="Previous step">${icon("prev")}</button><button type="button" data-walk-next aria-label="Next step">${icon("next")}</button></div></div>`).join("")}
</div>`;
}
/** "Talk to Kamran (AI voice)". { location, float } */
export const kamranPill = (o = {}) =>
  `<button type="button" class="kamran${o.float ? " kamran--float" : ""}${o.inline ? " kamran-inline" : ""}" data-kamran="${esc(o.location || "inline")}"><span class="k-dot">${icon("mic")}</span>Talk to Kamran (AI voice)</button>`;

/** Simple data table. { caption, columns, rows, figCols: [index...] } */
export function table(o) {
  const fig = new Set(o.figCols || []);
  return `<div class="table-wrap"><table class="table">${o.caption ? `<caption>${esc(o.caption)}</caption>` : ""}<thead><tr>${o.columns.map((c) => `<th scope="col">${esc(c)}</th>`).join("")}</tr></thead><tbody>${o.rows.map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${esc(c)}</th>` : `<td${fig.has(i) ? ' class="fig"' : ""}>${esc(c)}</td>`)).join("")}</tr>`).join("")}</tbody></table></div>`;
}
/** External link: new tab, rel=noopener. */
export const ext = (url, label) => `<a class="inline-link" href="${esc(url)}" target="_blank" rel="noopener">${esc(label)}<span class="sr-only"> (opens in a new tab)</span></a>`;
