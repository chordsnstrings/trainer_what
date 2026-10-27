// Declarations for play.render.js (pure: no CSS, no DOM).
import type { BrainData, RenderOptions, ShowcaseKind } from "./types";

/** The root element's classes for each kind this module renders. */
export declare const ROOT: Partial<Record<ShowcaseKind, string>>;
/** The root's inner HTML; every inner id starts with the host id (o.id). */
export declare function renderStatic(d: BrainData, o: RenderOptions): string;
