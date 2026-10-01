/**
 * Per-member memory, built by code with no model call (docs/features/brain-learning.md).
 * It summarises what the member's own logs show: adherence by weekday, usual
 * loads, exercises often skipped or swapped, and the stated schedule and
 * equipment. Only names the trainer's library or programme already uses are
 * kept, and no free text the member wrote (notes, reasons, limitations) is
 * ever copied: anything about health goes to the coach, never into memory.
 * Callers build it only from sources that allow model use (current coaching
 * consent), so withdrawing consent or erasing the member removes it.
 */
import { normalizeTerm } from "./brain-plans.ts";

export const memberMemoryVersion = "member-memory-v1";
/** Adherence, skips and swaps look back this far; loads use the plan's 90 days. */
export const MEMORY_WINDOW_DAYS = 56;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export type MemoryInput = {
  /** The member's local date (YYYY-MM-DD). */
  today: string;
  daysPerWeek: number | null;
  equipment: string[];
  /** Planned sessions in the window: date, status and the exercises planned. */
  sessions: Array<{ date: string; status: string; exercises: string[]; loggedExercises: string[] }>;
  /** Effective logged sets (after corrections), newest first. */
  sets: Array<{ exercise: string; reps: number; loadKg: number; date: string }>;
  substitutions: Array<{ from: string; to: string }>;
  /** Exercise names the trainer's library or the member's programme uses. */
  known: string[];
};

export type MemberMemory = {
  version: typeof memberMemoryVersion;
  windowDays: number;
  statedSchedule: { daysPerWeek: number | null };
  equipment: string[];
  adherenceByWeekday: Array<{ weekday: (typeof WEEKDAYS)[number]; planned: number; completed: number }>;
  usualLoads: Array<{ exercise: string; loadKg: number; reps: number; sessions: number }>;
  oftenSkipped: Array<{ exercise: string; times: number }>;
  oftenSwapped: Array<{ from: string; to: string; times: number }>;
};

const median = (values: number[]) => {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b),
    m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round = (n: number, step: number) => Math.round(n / step) * step;
const weekday = (date: string) => WEEKDAYS[new Date(date + "T12:00:00Z").getUTCDay()];
const daysBefore = (date: string, days: number) =>
  new Date(Date.parse(date + "T12:00:00Z") - days * 86400000).toISOString().slice(0, 10);

/**
 * The memory, or null when there is nothing to remember yet. Pure: the same
 * input always gives the same memory, so it can be tested and digested.
 */
export function buildMemberMemory(input: MemoryInput): MemberMemory | null {
  const known = new Map<string, string>();
  for (const name of input.known) {
    const key = normalizeTerm(String(name ?? ""));
    if (key && !known.has(key)) known.set(key, String(name).slice(0, 80));
  }
  const name = (value: string) => known.get(normalizeTerm(String(value ?? ""))) ?? null;
  const from = daysBefore(input.today, MEMORY_WINDOW_DAYS);
  // A session counts once its date has passed (or it was completed early).
  const due = input.sessions.filter(
    (s) => s.date >= from && (s.date < input.today || s.status === "completed") && s.status !== "canceled",
  );
  const byDay = new Map<string, { planned: number; completed: number }>();
  for (const s of due) {
    const d = weekday(s.date),
      row = byDay.get(d) ?? { planned: 0, completed: 0 };
    row.planned++;
    if (s.status === "completed") row.completed++;
    byDay.set(d, row);
  }
  const adherenceByWeekday = WEEKDAYS.filter((d) => byDay.has(d)).map((d) => ({ weekday: d, ...byDay.get(d)! }));

  // Usual loads: per exercise, the heaviest set of each day, then the median.
  const perDay = new Map<string, Map<string, { loadKg: number; reps: number }>>();
  for (const set of input.sets) {
    const exercise = name(set.exercise);
    if (!exercise || !(set.loadKg > 0)) continue;
    const days = perDay.get(exercise) ?? new Map();
    const top = days.get(set.date);
    if (!top || set.loadKg > top.loadKg) days.set(set.date, { loadKg: set.loadKg, reps: set.reps });
    perDay.set(exercise, days);
  }
  const usualLoads = [...perDay]
    .map(([exercise, days]) => {
      const tops = [...days.values()];
      return {
        exercise,
        loadKg: round(median(tops.map((t) => t.loadKg)), 0.5),
        reps: Math.round(median(tops.map((t) => t.reps))),
        sessions: tops.length,
      };
    })
    .filter((r) => r.sessions >= 2)
    .sort((a, b) => b.sessions - a.sessions || (a.exercise < b.exercise ? -1 : 1))
    .slice(0, 15);

  // Skipped: planned in a completed session but nothing logged for it.
  const skipped = new Map<string, number>();
  for (const s of due.filter((s) => s.status === "completed")) {
    const logged = new Set(s.loggedExercises.map((e) => normalizeTerm(e)));
    for (const e of new Set(s.exercises.map((x) => name(x)).filter((x): x is string => !!x)))
      if (!logged.has(normalizeTerm(e))) skipped.set(e, (skipped.get(e) ?? 0) + 1);
  }
  const oftenSkipped = [...skipped]
    .filter(([, times]) => times >= 2)
    .map(([exercise, times]) => ({ exercise, times }))
    .sort((a, b) => b.times - a.times || (a.exercise < b.exercise ? -1 : 1))
    .slice(0, 8);
  const swaps = new Map<string, { from: string; to: string; times: number }>();
  for (const s of input.substitutions) {
    const a = name(s.from),
      b = name(s.to);
    if (!a || !b || a === b) continue;
    const key = a + "\u0000" + b,
      row = swaps.get(key) ?? { from: a, to: b, times: 0 };
    row.times++;
    swaps.set(key, row);
  }
  const oftenSwapped = [...swaps.values()]
    .filter((s) => s.times >= 2)
    .sort((a, b) => b.times - a.times || (a.from < b.from ? -1 : 1))
    .slice(0, 8);

  const equipment = [...new Set(input.equipment.map((e) => normalizeTerm(e)).filter((e) => e && e.length <= 40 && e.split(" ").length <= 4))]
    .sort()
    .slice(0, 12);
  if (!adherenceByWeekday.length && !usualLoads.length && !oftenSkipped.length && !oftenSwapped.length) return null;
  return {
    version: memberMemoryVersion,
    windowDays: MEMORY_WINDOW_DAYS,
    statedSchedule: { daysPerWeek: input.daysPerWeek ?? null },
    equipment,
    adherenceByWeekday,
    usualLoads,
    oftenSkipped,
    oftenSwapped,
  };
}
