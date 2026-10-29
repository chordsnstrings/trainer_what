// Declarations for field.render.js (pure: no CSS, no DOM). Its other exports
// (the copy, the moment tables and the HTML atoms) are for field.js only.
import type { Settings } from "./decide";
import type { BrainData, Lane, RenderOptions, ShowcaseKind, Trace } from "./types";

/** The root element's classes for each kind this module renders. */
export declare const ROOT: Partial<Record<ShowcaseKind, string>>;
/** The root's inner HTML; every inner id starts with the host id (o.id). */
export declare function renderStatic(d: BrainData, o: RenderOptions): string;
/** The board's line after one change the visitor made (moved: [trace, lane before, lane now]): who moved where, or what stayed. */
export declare function diffLine(d: BrainData, moved: Array<[Trace, Lane, Lane]>, key: string, S: Settings): string;
