/** Unsubmitted edits are drafts, never evidence that a set was completed.
 * Scoped to member + tenant + immutable prescription, and erased on sign-out. */
export type SetDraft = Partial<
  Record<"load" | "reps" | "duration" | "distance" | "rir", number | null>
>;
export type WorkoutCheckpoint = {
  version: 1;
  prescription: string;
  savedAt: number;
  drafts: Record<string, SetDraft>;
  rest: { until: number | null; total: number; remaining?: number } | null;
};
export const workoutCheckpointKey = (
  tenant: string,
  user: string,
  workout: string,
) => `trainer:workout-draft:${tenant}:${user}:${workout}`;
const limits = {
  load: 500,
  reps: 200,
  duration: 36000,
  distance: 200000,
  rir: 10,
};
export function restoreWorkoutCheckpoint(
  raw: string | null,
  prescription: string,
  now = Date.now(),
): WorkoutCheckpoint {
  const empty: WorkoutCheckpoint = {
    version: 1,
    prescription,
    savedAt: now,
    drafts: {},
    rest: null,
  };
  try {
    const value = JSON.parse(raw ?? "null");
    if (
      value?.version !== 1 ||
      value.prescription !== prescription ||
      !Number.isFinite(value.savedAt) ||
      now - value.savedAt > 7 * 86400000 ||
      value.savedAt > now + 60000
    )
      return empty;
    for (const [id, values] of Object.entries(value.drafts ?? {}).slice(
      0,
      500,
    )) {
      if (!values || typeof values !== "object") continue;
      const draft: SetDraft = {};
      for (const field of Object.keys(limits) as (keyof typeof limits)[]) {
        const n = (values as SetDraft)[field];
        if (
          n === null ||
          (typeof n === "number" &&
            Number.isFinite(n) &&
            n >= 0 &&
            n <= limits[field])
        )
          draft[field] = n;
      }
      empty.drafts[id] = draft;
    }
    const rest = value.rest;
    if (
      rest?.until === null &&
      Number.isFinite(rest.total) &&
      rest.total > 0 &&
      rest.total <= 36000 &&
      Number.isFinite(rest.remaining) &&
      rest.remaining > 0 &&
      rest.remaining <= rest.total
    )
      empty.rest = {
        until: null,
        total: rest.total,
        remaining: rest.remaining,
      };
    if (
      rest &&
      Number.isFinite(rest.until) &&
      Number.isFinite(rest.total) &&
      rest.total > 0 &&
      rest.total <= 36000 &&
      rest.until > now &&
      rest.until <= now + rest.total * 1000 + 1000
    )
      empty.rest = { until: rest.until, total: rest.total };
  } catch {
    /* Invalid or unavailable storage never changes the prescription. */
  }
  return empty;
}
