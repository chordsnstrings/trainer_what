// Declarations for anatomy.render.js (pure: no CSS, no DOM).
import type { BrainData, RenderOptions, ShowcaseKind } from "./types";

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
/** The margin notes (a)–(j): [title, text]. */
export declare const NOTES: Record<string, [string, string]>;
/** The root's inner HTML; every inner id starts with the host id (o.id). */
export declare function renderStatic(d: BrainData, o: RenderOptions): string;
