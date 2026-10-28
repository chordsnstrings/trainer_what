// Declarations for core.js (the engine core; see that file).
import type { BrainData } from "./types";

export declare const clamp: (v: number, a: number, b: number) => number;
export declare const lerp: (a: number, b: number, k: number) => number;
export declare const ease: { io(k: number): number; out(k: number): number; in(k: number): number };
export declare function rng(seed: number): () => number;
export declare function h(sel: string, props?: Record<string, unknown> | null, ...kids: unknown[]): HTMLElement;
export declare const esc: (s: unknown) => string;
export declare function load<T extends object>(data: T): Promise<T & BrainData>;
export declare function index<T extends object>(d: T): T & BrainData;
export declare function reduced(): boolean;
export declare function onReduced(fn: (reduced: boolean) => void): () => void;
export declare const phone: () => boolean;
export type TierName = "full" | "lite" | "minimal";
export declare const tier: {
  readonly name: TierName;
  readonly spec: { ghosts: [number, number]; halos: boolean; dpr: number; fps: number };
  readonly ghosts: number;
  down(why: string): void;
  up(why: string): void;
  on(fn: (name: TierName) => void): () => void;
  log: Array<[TierName, string]>;
};
export type LoopHandle = { wake(): void; stop(): void; fps: number | undefined; readonly awake: boolean };
export declare function loop(fn: (dt: number, now: number) => boolean | void, o?: { fps?: number; scene?: Scene }): LoopHandle;
export type Scene = {
  el: HTMLElement;
  root: HTMLElement;
  reasons: Set<string>;
  running: boolean;
  /** When the scene last started running (performance.now()): idle counts from it or the last input. */
  since: number;
  idleMs: number;
  set(reason: string, on: boolean): void;
  pause(reason?: string): void;
  play(): void;
  loop(fn: (dt: number, now: number) => boolean | void, fps?: number): LoopHandle;
  button(b: HTMLElement, labels?: { pause: string; play: string }): void;
  destroy(): void;
};
export declare function scene(
  el: HTMLElement,
  /** resumeOnInput: input ends an idle pause unless false. */
  o?: { idle?: number; resumeOnInput?: boolean; onState?(running: boolean, reasons: string[]): void },
): Scene;
export declare function destroyAll(): void;
export type Timeline = {
  readonly t: number;
  at(ms: number, fn: (t: number) => void): Timeline;
  span(ms: number, dur: number, fn: (k: number) => void): Timeline;
  play(speed?: number): Promise<void>;
  skip(): void;
  stop(): void;
};
export declare function timeline(sc?: Scene): Timeline;
export declare function layer(root: HTMLElement): { el: HTMLElement; release(): void };
export declare function inertOutside(el: Element): () => void;
export declare function say(msg: string): void;
export declare function fit(cv: HTMLCanvasElement, w: number, h: number): CanvasRenderingContext2D;
export declare function bitmap(w: number, h: number): { cv: OffscreenCanvas | HTMLCanvasElement; c: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D };
export declare function prefetch(loader: () => Promise<unknown>, el?: Element | null, ms?: number): () => void;
