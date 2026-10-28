// Declarations for play.render.js (pure: no CSS, no DOM). Its other exports
// (the shell's tables and the HTML atoms) are for play.js only.
import type { Decision } from "./decide";
import type { BrainData, Lane, RenderOptions, ShowcaseKind, Trace } from "./types";

/** The root element's classes for each kind this module renders. */
export declare const ROOT: Partial<Record<ShowcaseKind, string>>;
/** The playground's own copy (the traces carry the moments'). */
export declare const COPY: Record<string, string>;
/** The moment the first frame shows played, and the one attract plays. */
export declare const FIRST: string;
/** "Your specialty": [value, label, the chips' order by trace number]. */
export declare const SPECS: Array<[string, string, number[]]>;
/** The result column for a moment's decision; prev: the lane before a settings change. */
export declare function resultHTML(d: BrainData, t: Trace, r: Decision, prev?: Lane | null): string;
/** The root's inner HTML; every inner id starts with the host id (o.id). */
export declare function renderStatic(d: BrainData, o: RenderOptions): string;
