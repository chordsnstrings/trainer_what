// Declarations for data.js (the traces for one page).
import type { BrainData, RawBrainData, ShowcaseOptions } from "./types";

export declare const NON_TEXT_KEYS: readonly string[];
export declare function stripForClient(full: RawBrainData): RawBrainData;
/** Deep-copies raw; never changes it. */
export declare function prepare(raw: RawBrainData, o: Pick<ShowcaseOptions, "appName" | "flags">): BrainData;
