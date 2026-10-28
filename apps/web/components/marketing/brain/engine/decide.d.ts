// Declarations for decide.js (the lane for a trace under the trainer's settings).
import type { BrainData, Lane, ShowcaseFlags, Step, Trace } from "./types";

/** The trainer's settings that decide() reads (defaults(): the sample trainer's). */
export type Settings = {
  level: number;
  lastCheckPassing: boolean;
  capPct: number;
  minRir: number;
  bar: number;
  planMode: "automatic" | "supervised";
  addEquipmentRule: boolean;
  oneMoreApproved: boolean;
  loggedShare: number;
  supplementsTopic: boolean;
  tooHeavyPct: number;
  recoveryFlag: boolean;
  recoveryRule: boolean;
  recoveryReading: number;
  lowLoadPct: number;
  lowVolumePct: number;
};
export type Decision = {
  lane: Lane;
  why: string | null;
  steps: Step[];
  memberSees: { verbatim: boolean; parts: Array<{ by: string; text: string }> } | null;
  trainerSees: { where: string; title: string; detail: string } | null;
  /** pct: whole percents, or one decimal where rounding would reach the bar the score misses. */
  sure: { display: string; score: number; bar: number; pct?: number } | null;
  reasons: string[] | null;
  tag: string | null;
  note: string | null;
  off: boolean;
};
export declare function defaults(d: BrainData | object, flags?: Partial<ShowcaseFlags> | null): Settings;
export declare const laneText: (d: BrainData, lane: Lane) => string;
export declare const isOff: (t: Trace, s?: Settings | null) => boolean;
export declare function pick(t: Trace, d: BrainData, s?: Settings): string | null;
export declare function reducedLoad(kg: number, pct: number): number | null;
export declare function reduceWorkout<T extends Record<string, unknown>>(list: T[], load: number, vol: number): T[];
export declare function planScore(
  t: Trace,
  s: Settings,
): { score: number; pct: number; bar: number; confident: boolean; auto: boolean; reasons: string[]; display: string };
export declare function decide(t: Trace, s: Settings, d: BrainData): Decision;
export declare function totals(d: BrainData, s: Settings): string;
