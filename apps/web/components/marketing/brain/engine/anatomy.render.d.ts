// Declarations for anatomy.render.js (pure: no CSS, no DOM).
import type { Decision, Settings } from "./decide";
import type { BrainData, RenderOptions, ShowcaseKind, Trace } from "./types";

/** The root element's classes for each kind this module renders. */
export declare const ROOT: Partial<Record<ShowcaseKind, string>>;
/** The figure's own copy (the margin notes are NOTES). */
export declare const COPY: {
  eyebrow: string;
  h2: string;
  lede: string;
  cap: string;
  hint: string;
  first: string;
  after: string;
  book: [string, string];
  cites: [string, string, string];
  j: string[];
  /** [key, label, trace, level or null] */
  whatIf: Array<[string, string, string, number | null]>;
  back: string;
  tryAnother: string;
  pause: string;
  play: string;
  meanwhile: string;
  ghosts: string;
  sr: string;
};
/** The margin notes (a)–(j): [title, text]; (f)'s text holds {off} (note() fills it). */
export declare const NOTES: Record<string, [string, string]>;
/** A note's text under the page's flags: (f) counts the coaching specialists not on yet. */
export declare function note(d: BrainData, k: string): string;
/** Other members' moments: [trace, moment, shown on phones]. */
export declare const GHOSTS: Array<[string, string, 0 | 1]>;
/** The ghost stacks the page's flags let run (a moment not on yet never runs); g is each one's place. */
export declare function ghostsOf(d: BrainData): Array<{ id: string; moment: string; ph: 0 | 1; g: number }>;
/** One plate of the figure: (a)–(i). */
export type Plate = { k: string; name: string; kind: "msg" | "check" | "ai"; state: string; stat?: string; say: string };
/** The nine plates for a trace under the trainer's settings, the decision, and the specialist code picked. */
export declare function model(
  d: BrainData,
  t: Trace,
  S: Settings,
): { t: Trace; r: Decision; stop: boolean; pick: string | null; tag: string; plates: Plate[] };
/** The root's inner HTML; every inner id starts with the host id (o.id). */
export declare function renderStatic(d: BrainData, o: RenderOptions): string;
