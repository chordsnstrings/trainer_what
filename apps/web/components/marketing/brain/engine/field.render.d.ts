// Declarations for field.render.js (pure: no CSS, no DOM).
import type { BrainData, RenderOptions, ShowcaseKind, Trace } from "./types";

/** The root element's classes for each kind this module renders. */
export declare const ROOT: Partial<Record<ShowcaseKind, string>>;
/** The field's own copy (the honest sample labels come from the traces). */
export declare const COPY: Record<string, string | string[] | Record<string, string[] | string>>;
export declare const FIRST: readonly string[];
export declare const AFTER: readonly string[];
export declare const SHELL: readonly (readonly string[])[];
/** The member rows: one per moment, in order (t3 has none). */
export declare const ROWS: readonly string[];
/** Per moment: tile label, member-row chip, event icon, and the incoming text for events. */
export declare const FX: Record<string, string[]>;
/** The lanes at the first frame, by lane. */
export declare const START: Record<"sent" | "waits" | "paused", string[]>;
export declare const BLANES: readonly string[];
export declare const id0: (t: Trace) => string;
export declare const tagOf: (id: string) => string;
/** The plans slider's track fill (%) for a value. */
export declare const fill: (d: BrainData, v: number) => number;
export declare function nodeHTML(d: BrainData, sp: string, o?: { state?: string; cls?: string; who?: string; val?: string; valCls?: string; extra?: string }): string;
export declare function tileHTML(d: BrainData, id: string, cls?: string): string;
export declare function msgHTML(t: Trace, cls?: string): string;
export declare function subHTML(t: Trace): string;
/** The root's inner HTML; every inner id starts with the host id (o.id). */
export declare function renderStatic(d: BrainData, o: RenderOptions): string;
