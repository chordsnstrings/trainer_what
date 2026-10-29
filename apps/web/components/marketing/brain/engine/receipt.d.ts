// Declarations for receipt.js (the client runtime; it imports its own CSS).
import type { Decision, Settings } from "./decide";
import type { BrainData, ShowcaseOptions, Trace } from "./types";

export type ReceiptOptions = Pick<ShowcaseOptions, "cta"> & {
  d: BrainData;
  settings?: Settings;
  /** The tile or row it opened from (the dialog grows from there). */
  from?: DOMRect;
  /** The field's zoom host (desktop): the receipt lies inline in it. */
  mount?: HTMLElement;
  /** The overlay layer (core.js layer()): dialogs, sheets and backdrops mount here. */
  layer: HTMLElement;
  /** The host id; the receipt's ids start with it. */
  id: string;
  onChange?(t: Trace): void;
  onClose?(): void;
};
export type ReceiptApi = { el: HTMLElement; trace: Trace; close(quiet?: boolean): void };
export declare const COPY: Record<string, string | string[]>;
export declare function slots(d: BrainData, t: Trace, r: Decision): Array<Record<string, unknown>>;
export declare function receiptHTML(d: BrainData, t: Trace, r: Decision, o?: { stream?: boolean; id?: string }): string;
export declare function open(id: string, o: ReceiptOptions): ReceiptApi;
