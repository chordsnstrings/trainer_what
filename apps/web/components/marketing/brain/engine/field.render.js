/* The field and the board's first frame: a stub until WP2 ports it
   (docs/marketing-revamp-2026-10-26/phase1/PLAN.md §2), and never on a page
   before then. It renders what every showcase root carries (the honesty
   strip, which follows the payments flag), the showcase's name, the
   always-on safety rule (it carries the platform name) and the call to
   action from the options, so the server render, its key and the tests run
   on real content. Pure: no CSS, no DOM. */
import { esc } from "./core.js";
import * as U from "./ui.js";

/** The root element's classes for each kind this module renders (render.ts). */
export const ROOT = { field: "mc sc-stage", board: "mb sc-stage" };
const NAME = { field: "A sample hour of your Brain", board: "Every sample moment, sorted by your settings" };

/** The root's inner HTML. */
export function renderStatic(d, o) {
  return `<div class="sc-stub">${U.strip(d)}<p>${esc(NAME[o.kind])}</p>${U.rule(d.trace("t2"))}${U.cta(o)}</div>`;
}
