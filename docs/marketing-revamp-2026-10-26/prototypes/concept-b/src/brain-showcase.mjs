// Concept B · Brain showcase markup for the generator (round 2, spec
// showcase-final.md §3 and §5): "24 hours of your Brain" (home band under
// the hero, /how-it-works) and the shared playground (/trainer-brain,
// /demo). Static first frames come from the same modules the browser runs.
import { readFileSync } from "node:fs";
import { SITE, esc } from "./core.mjs";
import { eyebrow, sectionHead, val } from "./components.mjs";

const Day = await import("./day/brain-day.js");
const DayHTML = await import("./day/brain-day-html.js");
const Play = await import("../site/assets/brain/brain-play.js");
const DATA = JSON.parse(readFileSync(`${SITE}/assets/brain/traces.client.json`, "utf8"));

/** Page assets for a showcase page. */
export const dayAssets = { styles: ["brain/brain-base.css", "day/brain-day.css"], scripts: ["brain/brain-boot.js"] };
export const playAssets = { styles: ["brain/brain-base.css", "brain/brain-play.css", "brain/brain-anatomy.css", "day/brain-day.css"], scripts: ["brain/brain-boot.js"] };
export const merge = (...a) => ({ styles: [...new Set(a.flatMap((x) => x.styles))], scripts: [...new Set(a.flatMap((x) => x.scripts))] });

/** The day itself: stage (pin / player) + static hour cards. */
export function dayShowcase(o = {}) {
  const M = Day.model(DATA, {});
  return `<div class="dy-wrap"><div class="dy" data-showcase="day" data-sc-module="assets/day/brain-day.js" data-cta="signup.html" style="--len:${o.len || 360}">
<div class="dy-pin" data-dy-pin><div data-dy-host>${DayHTML.stageHTML(DATA, { M, mode: "pin" })}</div></div>
${DayHTML.cardsHTML(DATA, { M })}
</div></div>`;
}

/** "24 hours of your Brain" as a band. home: the bridge from the hero's price. */
export function dayBand(o = {}) {
  const bridge = o.home
    ? `<p class="day-bridge"><span class="db-price">${val("AED 199", { showPrice: 0, cls: "fig" })}<small>a month</small></span><span class="db-arrow" aria-hidden="true"></span><span class="db-brain"><span class="db-av" aria-hidden="true">LS</span>Your Brain, all day, for each subscriber</span></p>`
    : "";
  // home: the price from the hero leads straight into the day (one story: your price → your Brain, all day)
  return `<section class="band dayband${o.home ? " dayband--home" : ""}${o.tone ? " band--" + o.tone : ""}" id="${o.id || "day"}" aria-labelledby="day-h">
<div class="container"><div class="day-head">
  <div>${bridge || eyebrow(o.eyebrow || "A sample day")}<h2 id="day-h">${esc(DayHTML.TEXT.h2)}</h2><p class="lede lede-pin">${esc(DayHTML.TEXT.lede)}</p><p class="lede lede-play">${esc(DayHTML.TEXT.ledePlay)}</p></div>
</div></div>
${dayShowcase(o)}${o.after ? `\n<div class="container">${o.after}</div>` : ""}
</section>`;
}

/** Shared playground "Throw a moment at your Brain", skinned for B. */
export function playground(o = {}) {
  return `<section class="band${o.tone ? " band--" + o.tone : ""} play-band" id="${o.id || "playground"}" aria-labelledby="play-h">
<div class="container">${sectionHead({ eyebrow: o.eyebrow || "Try it", title: "Throw a moment at your Brain", id: "play-h", lede: "Pick something a member might say. Watch each check and specialist work. Then change a setting and run it again." })}
<div class="bp bp--b" data-showcase="play" data-sc-module="assets/brain/brain-play.js" data-cta="signup.html" data-heading="off">${Play.renderStatic(DATA, { cta: "signup.html", heading: false }).replace(/<mark class="pv-you">([\s\S]*?)<\/mark>/g, '<span class="pv-you">$1</span>')}</div>
</div></section>`;
}

/** /features echo: static hour labels from the sample day ("12:30 · Meal photo"). */
export const HOURS = {
  "/features/voice-coach": ["07:30", "Voice session"],
  "/features/ai-training-plans": ["14:00", "First plan"],
  "/features/nutrition": ["12:30", "Meal photo"],
  "/features/chat-and-digital-coach": ["17:45", "Squats felt easy"],
  "/features/safety": ["19:20", "Safety stop"],
  "/trainer-brain": ["21:00", "You edit, it learns"],
};
export const hourTag = (path) => (HOURS[path] ? `<span class="hour-tag"><span class="fig">${HOURS[path][0]}</span>${esc(HOURS[path][1])}</span>` : "");
