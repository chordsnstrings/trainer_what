// How much work one exercise prescribes: repetitions, or a duration or a
// distance per set. A set of timed or distance work is a round: "6 × 1 min,
// 90 s rest" is six one-minute efforts with recoveries between them, and one
// set with no rest is a single continuous bout (a 20-minute easy run). Pure
// and browser-safe: the plan validator, the voice session and every screen
// read and word a prescription the same way.

export type WorkMeasure = "reps" | "time" | "distance";
/** How hard timed or distance work should feel (rep work uses reps in reserve). */
export const EFFORTS = ["easy", "moderate", "hard"] as const;
export type Effort = (typeof EFFORTS)[number];
export type PrescribedWork = {
  sets: number;
  reps?: number | null;
  durationSeconds?: number | null;
  distanceMeters?: number | null;
  paceSecondsPerKm?: number | null;
  effort?: string | null;
  restSeconds?: number | null;
  loadKg?: number | null;
};
/**
 * Session-length estimate for distance work without a pace: 10 minutes per
 * kilometre (a brisk walk or a very easy jog), so a run, ride or row is never
 * under-counted against the trainer's session limit.
 */
export const DEFAULT_PACE_SECONDS_PER_KM = 600;
/** Seconds per repetition in the session-length estimate. */
export const SECONDS_PER_REP = 4;

const positive = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v > 0;
/** Which measure the prescription uses; a duration wins over a distance, which wins over reps. */
export function workMeasure(e: PrescribedWork): WorkMeasure {
  if (positive(e.durationSeconds)) return "time";
  if (positive(e.distanceMeters)) return "distance";
  return "reps";
}
/** How many of reps, duration and distance are given (a valid prescription has exactly one). */
export const measureCount = (e: PrescribedWork) =>
  [e.reps, e.durationSeconds, e.distanceMeters].filter(
    (v) => v !== undefined && v !== null,
  ).length;
/** One continuous bout of timed or distance work: the only work that may have no rest. */
export const continuousWork = (e: PrescribedWork) =>
  workMeasure(e) !== "reps" && e.sets === 1;
/** Seconds of work in one set: the duration, the distance at its pace, or four seconds a rep. */
export function workSeconds(e: PrescribedWork) {
  const measure = workMeasure(e);
  if (measure === "time") return e.durationSeconds!;
  if (measure === "distance")
    return (
      (e.distanceMeters! / 1000) *
      (positive(e.paceSecondsPerKm)
        ? e.paceSecondsPerKm
        : DEFAULT_PACE_SECONDS_PER_KM)
    );
  return (Number(e.reps) || 0) * SECONDS_PER_REP;
}
/** Timed work (seconds) and distance (metres) across all sets. */
export const totalSeconds = (e: PrescribedWork) =>
  workMeasure(e) === "time" ? e.sets * e.durationSeconds! : 0;
export const totalMeters = (e: PrescribedWork) =>
  workMeasure(e) === "distance" ? e.sets * e.distanceMeters! : 0;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
/** "45 s", "1 min", "1 min 30 s", "1 h 5 min". */
export function formatDuration(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60),
    rest = s % 60;
  return [h ? `${h} h` : "", m ? `${m} min` : "", rest ? `${rest} s` : ""]
    .filter(Boolean)
    .join(" ");
}
/** "400 m", "1.5 km", "10 km". */
export function formatDistance(meters: number) {
  const m = Math.max(0, Math.round(meters));
  if (m < 1000) return `${m} m`;
  return `${Math.round(m / 10) / 100} km`;
}
/** "6:00 /km". */
export function formatPace(secondsPerKm: number) {
  const s = Math.max(0, Math.round(secondsPerKm));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} /km`;
}
/** The work of one prescription: "3 × 10", "20 min", "6 × 1 min", "4 × 500 m", "3 km". */
export function workText(e: PrescribedWork) {
  const measure = workMeasure(e);
  const per =
    measure === "time"
      ? formatDuration(e.durationSeconds!)
      : measure === "distance"
        ? formatDistance(e.distanceMeters!)
        : String(e.reps ?? "");
  return measure !== "reps" && e.sets === 1 ? per : `${e.sets} × ${per}`;
}
/**
 * The prescription as one line for any screen:
 * "3 × 10 · 20 kg · RIR 2 · 90 s rest", "6 × 1 min · hard · 90 s rest",
 * "20 min · easy · 6:30 /km".
 */
export function prescriptionText(
  e: PrescribedWork & { rir?: number | null },
  options: { rir?: boolean; rest?: boolean } = {},
) {
  const measure = workMeasure(e);
  const parts = [workText(e)];
  if (positive(e.loadKg)) parts.push(`${e.loadKg} kg`);
  if (measure !== "reps") {
    if (e.effort) parts.push(e.effort);
    if (positive(e.paceSecondsPerKm))
      parts.push(formatPace(e.paceSecondsPerKm));
  } else if (options.rir !== false && typeof e.rir === "number")
    parts.push(`RIR ${e.rir}`);
  if (options.rest !== false) {
    const rest = Number(e.restSeconds ?? 0);
    if (rest > 0) parts.push(`${formatDuration(rest)} rest`);
    else if (continuousWork(e)) parts.push("continuous");
  }
  return parts.join(" · ");
}
/** Spoken duration for code-owned voice lines: "45 seconds", "1 minute 30 seconds", "1 hour 5 minutes". */
export function spokenDuration(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return plural(s, "second");
  const h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60),
    rest = s % 60;
  return [
    h ? plural(h, "hour") : "",
    m ? plural(m, "minute") : "",
    rest ? plural(rest, "second") : "",
  ]
    .filter(Boolean)
    .join(" ");
}
/** Spoken distance: "400 metres", "1.5 kilometres", "5 kilometres". */
export function spokenDistance(meters: number) {
  const m = Math.max(0, Math.round(meters));
  if (m < 1000) return plural(m, "metre");
  const km = Math.round(m / 10) / 100;
  return `${km} ${km === 1 ? "kilometre" : "kilometres"}`;
}
