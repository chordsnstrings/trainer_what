// Declarations for ui.js (the shared HTML-string atoms).
import type { Decision } from "./decide";
import type { BrainData, Lane, ShowcaseOptions, Step, Trace } from "./types";

export declare const icon: (n: string, s?: number) => string;
export declare function node(sp: string, d: BrainData, o?: { cls?: string; on?: unknown; title?: boolean; name?: string }): string;
export declare const lane: (d: BrainData, l: Lane, cls?: string) => string;
export declare const basis: (d: BrainData, b?: string) => string;
export declare const strip: (d: BrainData) => string;
export declare const cta: (o: Pick<ShowcaseOptions, "cta">, cls?: string) => string;
export declare const kindOf: (d: BrainData, st: Step) => string;
export declare const nameOf: (d: BrainData, st: Step, t: Trace) => string;
export declare function outLines(st: Step): string[];
export declare function marks(p: { by: string; text: string }): string;
export declare function phone(d: BrainData, t: Trace, r: Decision): string;
export declare function today(d: BrainData, t: Trace, r: Decision): string;
export declare const rule: (t: Trace) => string;
export declare function sure(d: BrainData, t: Trace, r: Decision): string;
export declare function stepRow(d: BrainData, t: Trace, st: Step, o?: { stream?: boolean }): string;
export declare function streamer(el: HTMLElement, text: string): (k: number) => void;
export declare const ICONS: Record<string, string>;
