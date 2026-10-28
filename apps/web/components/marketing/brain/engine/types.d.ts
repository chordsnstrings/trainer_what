// The Brain showcases' published interfaces
// (docs/marketing-revamp-2026-10-26/phase1/PLAN.md §2 "Interfaces published by
// WP1"). The engine is plain ES modules; these declarations are its typed
// surface for the strict root typecheck.

export type ShowcaseKind = "field" | "board" | "play" | "anatomy";
/** "static": the still frame with no engine (MARKETING_SHOWCASE=static). */
export type ShowcaseMode = "live" | "static";
/** From PublicPlatform.availability; recovery is fixed off in phase 1. model:
    the AI model is connected (showcaseOptions() always sets it; a fixture
    without it counts as connected). */
export type ShowcaseFlags = { payments: boolean; payouts: boolean; voice: boolean; nutrition: boolean; recovery: boolean; model?: boolean };
export type ShowcaseOptions = {
  appName: string;
  /** teachCta(): "Teach your AI — free", or early access while sign-ups are closed. */
  cta: { label: string; href: string };
  flags: ShowcaseFlags;
  /** false: the page supplies the H2. */
  heading?: boolean;
  /** That H2's id; the root is then labelled by it. */
  labelledBy?: string;
  attract?: boolean;
};
export type RenderOptions = ShowcaseOptions & {
  kind: ShowcaseKind;
  /** The host id; it prefixes every inner id. */
  id: string;
  /** The root's accessible name when no H2 labels it (renderShowcase). */
  label?: string;
};
export type MountOptions = RenderOptions & {
  /** html.sc-late was set: visitors have seen the final frame, so start from it. */
  settled: boolean;
  /** Client-side navigation (the router). The island already routes plain
      left clicks on a[data-sc-cta], the overlay layer's included. */
  navigate(href: string): void;
};
export type ShowcaseApi = {
  /** Idempotent; removes its overlay nodes and html.sc-lock. */
  destroy(): void;
  /** The playground only: play one trace ("t2" or its full id). */
  run?(traceId: string): Promise<void>;
};

export type Lane = "sent" | "waits" | "paused" | "member" | "learn";
export type Status = "live" | "try_yourself" | "not_on_yet";
export type Specialist = {
  id: string;
  name: string;
  kind: "ai" | "check";
  crew: "teach" | "coach" | "guard";
  icon: string;
  line: string;
  signsOff: string;
  status: Status;
  statusTip?: string;
  /** For "not_on_yet": the setting it waits for. */
  flag?: string;
  /** The flag (besides payments) an item needs to be on at all; not on yet while it is off. */
  needs?: "nutrition" | "voice";
  usesAi?: boolean;
  /** traces.json only: "identifier · repo path" (the trace test checks it). */
  code?: string;
};
export type Step = {
  sp: string;
  at: number;
  dur: number;
  result: string;
  say: string;
  basis?: "recorded" | "tests" | "illustrative" | "computed";
  detail?: string[];
  [key: string]: unknown;
};
export type Trace = {
  id: string;
  chip: string;
  decide: string;
  member: string;
  when: string;
  channel: string;
  trigger: { text: string; lang: "en" | "ar"; gloss?: string };
  steps: Step[];
  lane: Lane;
  status: Status;
  needs?: "nutrition" | "voice";
  defaultOff?: boolean;
  [key: string]: unknown;
};
export type Labels = {
  chip: string;
  long: string;
  /** Present only while subscriber payments are off. */
  subscribers?: string;
  rates: string;
  [key: string]: unknown;
};
/** traces.json or traces.client.json, as imported. */
export type RawBrainData = {
  format: string;
  labels: Labels;
  settingsDefault: Record<string, unknown>;
  specialists: Specialist[];
  traces: Trace[];
  [key: string]: unknown;
};
/** prepare()'s output: a copy for one page, indexed. */
export type BrainData = RawBrainData & {
  flags: ShowcaseFlags;
  sp: Record<string, Specialist>;
  byId: Record<string, Trace>;
  trace(id: string): Trace;
  short(t: Trace): string;
};
