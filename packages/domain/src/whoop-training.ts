import { z } from "zod";

export const WHOOP_TRAINING_VERSION = "whoop-training-v1";
export const WHOOP_SYNC_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const reduction = z
  .object({
    loadPercent: z.number().int().min(0).max(30),
    volumePercent: z.number().int().min(0).max(50),
  })
  .strict();
export const whoopTrainingPolicySchema = z
  .object({
    enabled: z.boolean().default(false),
    low: reduction.default({ loadPercent: 10, volumePercent: 25 }),
    moderate: reduction.default({ loadPercent: 0, volumePercent: 10 }),
  })
  .strict();
export type WhoopTrainingPolicy = z.infer<typeof whoopTrainingPolicySchema>;
export type WhoopTrainingRule = z.infer<typeof reduction>;
export type WhoopRecovery = {
  status: "ready" | "missing" | "stale" | "calibrating" | "unavailable";
  score: number | null;
  band: "low" | "moderate" | "high" | null;
  measuredAt: string | null;
  sourceId: string | null;
  sourceVersion: number | null;
  sleepHours: number | null;
  hrvMs: number | null;
  restingHeartRate: number | null;
};
export function whoopDate(value: string | Date, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

/** Only a scored, non-calibrating recovery attached to today's main sleep can change training. */
export function whoopRecovery(
  rows: any[],
  lastSyncedAt: string | null,
  timezone: string,
  now = new Date(),
): WhoopRecovery {
  const empty: WhoopRecovery = {
    status: "missing",
    score: null,
    band: null,
    measuredAt: null,
    sourceId: null,
    sourceVersion: null,
    sleepHours: null,
    hrvMs: null,
    restingHeartRate: null,
  };
  const observations = rows
    .filter(
      (r) =>
        r.status === "imported" &&
        r.data?.source === "whoop" &&
        r.data.allowedUses?.includes("deterministic_feature"),
    )
    .flatMap((r) =>
      (r.data.observations ?? []).map((o: any) => ({
        ...o,
        sourceId: r.id,
        sourceVersion: r.version,
      })),
    )
    .filter(
      (o) =>
        Number.isFinite(Date.parse(o.measuredAt)) && Number.isFinite(o.value),
    );
  const recovery = observations
    .filter((o) => o.type === "recovery_score")
    .sort((a, b) => Date.parse(b.measuredAt) - Date.parse(a.measuredAt))[0];
  if (!recovery || recovery.value < 0 || recovery.value > 100) return empty;
  const related = (type: string) =>
    observations.find(
      (o) => o.type === type && o.sleepId && o.sleepId === recovery.sleepId,
    )?.value ?? null;
  const sleep = related("sleep_seconds");
  const result: WhoopRecovery = {
    ...empty,
    score: recovery.value,
    band:
      recovery.value < 34 ? "low" : recovery.value < 67 ? "moderate" : "high",
    measuredAt: recovery.measuredAt,
    sourceId: recovery.sourceId,
    sourceVersion: recovery.sourceVersion,
    sleepHours: sleep == null ? null : Math.round(sleep / 360) / 10,
    hrvMs: related("hrv_rmssd_ms"),
    restingHeartRate: related("resting_heart_rate"),
    status: "ready",
  };
  const syncAge = now.getTime() - Date.parse(lastSyncedAt ?? "");
  const age = now.getTime() - Date.parse(recovery.measuredAt);
  if (
    !Number.isFinite(syncAge) ||
    syncAge < 0 ||
    syncAge > WHOOP_SYNC_MAX_AGE_MS ||
    age < 0 ||
    age > 26 * 3600000 ||
    whoopDate(recovery.measuredAt, timezone) !== whoopDate(now, timezone)
  )
    result.status = "stale";
  else if (recovery.calibrating === true) result.status = "calibrating";
  else if (recovery.trainingReady !== true) result.status = "unavailable";
  return result;
}

/** A workout-local reduction; the trainer's programme, sets, order and rest remain intact. */
export function reduceWhoopWorkout(program: any, rule: WhoopTrainingRule) {
  const checked = reduction.parse(rule);
  const changes: Array<{
    index: number;
    name: string;
    before: Record<string, number>;
    after: Record<string, number>;
  }> = [];
  const exercises = (program?.exercises ?? []).map(
    (exercise: any, index: number) => {
      if (["warmup", "cooldown"].includes(exercise.block)) return exercise;
      const next = { ...exercise },
        before: Record<string, number> = {},
        after: Record<string, number> = {};
      const reduce = (
        key: string,
        percent: number,
        unit: number,
        minimum: number,
      ) => {
        const original = exercise[key];
        if (
          typeof original !== "number" ||
          !Number.isFinite(original) ||
          original <= minimum ||
          percent === 0
        )
          return;
        // Round towards the original so the actual reduction cannot exceed the trainer's chosen limit.
        const value = Math.min(
          original,
          Math.max(
            minimum,
            Math.ceil((original * (1 - percent / 100)) / unit) * unit,
          ),
        );
        if (value < original) {
          next[key] = value;
          before[key] = original;
          after[key] = value;
        }
      };
      reduce("loadKg", checked.loadPercent, 0.5, 0);
      reduce("reps", checked.volumePercent, 1, 1);
      reduce("durationSeconds", checked.volumePercent, 1, 5);
      reduce("distanceMeters", checked.volumePercent, 10, 10);
      if (Object.keys(after).length) {
        // A pre-approved alternative must not restore the original heavier load.
        next.alternatives = (exercise.alternatives ?? []).map(
          (alternative: any) =>
            typeof alternative === "object" && alternative !== null
              ? {
                  ...alternative,
                  ...(typeof alternative.loadKg === "number"
                    ? {
                        loadKg: Math.min(
                          alternative.loadKg,
                          Math.ceil(
                            alternative.loadKg *
                              (1 - checked.loadPercent / 100) *
                              2,
                          ) / 2,
                        ),
                      }
                    : {}),
                }
              : alternative,
        );
        changes.push({ index, name: exercise.name, before, after });
      }
      return next;
    },
  );
  return {
    program: changes.length ? { ...program, exercises } : program,
    changes,
  };
}
