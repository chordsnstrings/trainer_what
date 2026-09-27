import { z } from "zod";

/**
 * Server-side contract for the future Apple HealthKit companion app. The app
 * uploads HealthKit samples and statistics; the server keeps one record per
 * member and local day with the de-duplicated inputs, and derives observations
 * in the same {type,value,unit,measuredAt} model as the Apple export import.
 * See docs/HEALTHKIT_SYNC_API.md.
 */
export const HEALTHKIT_TYPES = [
  "workout",
  "heart_rate",
  "heart_rate_variability",
  "resting_heart_rate",
  "sleep_analysis",
  "step_count",
  "active_energy",
  "body_mass",
] as const;
export type HealthKitType = (typeof HEALTHKIT_TYPES)[number];
export const HEALTHKIT_LIMITS = {
  /** Samples and statistics in one upload. */
  batchSamples: 1000,
  deletedSampleIds: 500,
  /** Per upload, per type. */
  perType: {
    workout: 200,
    heart_rate: 750,
    heart_rate_variability: 500,
    resting_heart_rate: 200,
    sleep_analysis: 1000,
    step_count: 100,
    active_energy: 100,
    body_mass: 200,
  } satisfies Record<HealthKitType, number>,
  /** Stored per member and local day; further samples are skipped. */
  perDay: {
    workout: 50,
    heart_rate: 100,
    heart_rate_variability: 200,
    resting_heart_rate: 24,
    sleep_analysis: 500,
    step_count: 10,
    active_energy: 10,
    body_mass: 24,
  } satisfies Record<HealthKitType, number>,
  lookbackDays: 90,
  futureToleranceMinutes: 10,
  devicesPerMember: 5,
  /** Per device and UTC day. */
  dailyBatches: 1000,
  dailySamples: 50000,
  bodyBytes: 1048576,
  pairingCodeMinutes: 10,
} as const;

const MINUTE = 60000,
  HOUR = 3600000,
  DAY = 86400000;
const uuid = z
  .string()
  .regex(
    /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/,
    "Use the HealthKit sample UUID",
  )
  .transform((value) => value.toUpperCase());
// Local time with its UTC offset, exactly as the device reports it. The local
// calendar date decides the day a sample belongs to.
const time = z.iso.datetime({ offset: true });
const span = (maxMs: number) => (s: { start: string; end: string }) => {
  const start = Date.parse(s.start),
    end = Date.parse(s.end);
  return end >= start && end - start <= maxMs;
};
const quantity = <T extends HealthKitType, U extends [string, ...string[]]>(
  type: T,
  units: U,
  min: number,
  max: number,
) =>
  z
    .object({
      type: z.literal(type),
      id: uuid,
      start: time,
      end: time,
      value: z.number().finite().min(min).max(max),
      unit: z.enum(units),
    })
    .strict()
    .refine(span(26 * HOUR), "end must follow start within 26 hours");
const dailyTotal = <T extends HealthKitType, U extends [string, ...string[]]>(
  type: T,
  units: U,
  max: number,
) =>
  z
    .object({
      type: z.literal(type),
      start: time,
      end: time,
      value: z.number().finite().min(0).max(max),
      unit: z.enum(units),
    })
    .strict()
    .refine(
      (s) =>
        s.start.slice(11, 19) === "00:00:00" &&
        Date.parse(s.start) % 1000 === 0,
      "A daily total starts at local midnight",
    )
    .refine((s) => {
      const d = Date.parse(s.end) - Date.parse(s.start);
      return d >= 23 * HOUR && d <= 25 * HOUR;
    }, "A daily total covers one local day");
const bodyMass = z
  .object({
    type: z.literal("body_mass"),
    id: uuid,
    start: time,
    end: time,
    value: z.number().finite().positive(),
    unit: z.enum(["kg", "lb"]),
  })
  .strict()
  .refine(span(26 * HOUR), "end must follow start within 26 hours")
  .refine((s) => {
    const kg = s.unit === "lb" ? s.value * 0.45359237 : s.value;
    return kg >= 20 && kg <= 400;
  }, "Body mass must be between 20 and 400 kg");
const heartRate = z
  .object({
    type: z.literal("heart_rate"),
    start: time,
    end: time,
    unit: z.literal("count/min"),
    average: z.number().finite().min(20).max(260),
    minimum: z.number().finite().min(20).max(260),
    maximum: z.number().finite().min(20).max(260),
    sampleCount: z.number().int().min(1).max(100000).optional(),
  })
  .strict()
  .refine(
    (s) =>
      s.start.slice(13, 19) === ":00:00" && Date.parse(s.start) % 1000 === 0,
    "An hourly heart-rate statistic starts on the local hour",
  )
  .refine(
    (s) => Date.parse(s.end) - Date.parse(s.start) === HOUR,
    "An hourly heart-rate statistic covers one hour",
  )
  .refine(
    (s) => s.minimum <= s.average && s.average <= s.maximum,
    "minimum ≤ average ≤ maximum",
  );
const sleep = z
  .object({
    type: z.literal("sleep_analysis"),
    id: uuid,
    start: time,
    end: time,
    stage: z.enum([
      "in_bed",
      "asleep_unspecified",
      "awake",
      "asleep_core",
      "asleep_deep",
      "asleep_rem",
    ]),
  })
  .strict()
  .refine(
    (s) => Date.parse(s.end) > Date.parse(s.start),
    "end must follow start",
  )
  .refine(span(24 * HOUR), "A sleep segment lasts at most 24 hours");
const workout = z
  .object({
    type: z.literal("workout"),
    id: uuid,
    start: time,
    end: time,
    activity: z
      .string()
      .regex(
        /^[a-z][a-z0-9_]{1,47}$/,
        "Use the snake_case HealthKit activity name",
      ),
    durationSeconds: z.number().finite().positive().max(172800),
    activeEnergyKcal: z.number().finite().min(0).max(20000).optional(),
    distanceMeters: z.number().finite().min(0).max(1000000).optional(),
    averageHeartRate: z.number().finite().min(20).max(260).optional(),
  })
  .strict()
  .refine(
    (s) => Date.parse(s.end) > Date.parse(s.start),
    "end must follow start",
  )
  .refine(span(48 * HOUR), "A workout lasts at most 48 hours")
  .refine(
    (s) =>
      s.durationSeconds * 1000 <=
      Date.parse(s.end) - Date.parse(s.start) + MINUTE,
    "durationSeconds cannot exceed the workout span",
  );
export const healthKitSampleSchema = z.discriminatedUnion("type", [
  workout,
  heartRate,
  quantity("heart_rate_variability", ["ms"], 1, 1000),
  quantity("resting_heart_rate", ["count/min"], 20, 200),
  sleep,
  dailyTotal("step_count", ["count"], 200000),
  dailyTotal("active_energy", ["kcal", "kJ"], 83680),
  bodyMass,
]);
export type HealthKitSample = z.infer<typeof healthKitSampleSchema>;
export const healthKitBatchSchema = z
  .object({
    batchId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{8,64}$/, "Use 8-64 letters, digits, - or _"),
    samples: z
      .array(healthKitSampleSchema)
      .max(HEALTHKIT_LIMITS.batchSamples)
      .default([]),
    deletedSampleIds: z
      .array(uuid)
      .max(HEALTHKIT_LIMITS.deletedSampleIds)
      .default([]),
  })
  .strict()
  .superRefine((batch, ctx) => {
    if (!batch.samples.length && !batch.deletedSampleIds.length)
      ctx.addIssue({
        code: "custom",
        message: "Send at least one sample or deleted sample id",
        path: ["samples"],
      });
    const counts: Record<string, number> = {};
    const keys = new Set<string>();
    batch.samples.forEach((sample, index) => {
      counts[sample.type] = (counts[sample.type] ?? 0) + 1;
      const key = "id" in sample ? sample.id : sample.type + "|" + sample.start;
      if (keys.has(key))
        ctx.addIssue({
          code: "custom",
          message: "Each sample id or statistic period appears once per batch",
          path: ["samples", index],
        });
      keys.add(key);
    });
    for (const [type, count] of Object.entries(counts))
      if (count > HEALTHKIT_LIMITS.perType[type as HealthKitType])
        ctx.addIssue({
          code: "custom",
          message: `At most ${HEALTHKIT_LIMITS.perType[type as HealthKitType]} ${type} entries per batch`,
          path: ["samples"],
        });
    if (new Set(batch.deletedSampleIds).size !== batch.deletedSampleIds.length)
      ctx.addIssue({
        code: "custom",
        message: "Each deleted sample id appears once",
        path: ["deletedSampleIds"],
      });
  });
export type HealthKitBatch = z.infer<typeof healthKitBatchSchema>;

/** Values stored inside a synchronized-day record. Times are UTC ISO strings. */
export type StoredSample = {
  type:
    | "workout"
    | "heart_rate_variability"
    | "resting_heart_rate"
    | "body_mass"
    | "sleep_analysis";
  start: string;
  end: string;
  value?: number;
  unit?: string;
  stage?: string;
  activity?: string;
  durationSeconds?: number;
  activeEnergyKcal?: number;
  distanceMeters?: number;
  averageHeartRate?: number;
  deviceId: string;
};
export type StoredStatistic = {
  type: "heart_rate" | "step_count" | "active_energy";
  start: string;
  end: string;
  unit: string;
  value?: number;
  average?: number;
  minimum?: number;
  maximum?: number;
  sampleCount?: number;
  deviceId: string;
  reportedAt: string;
};
export type Observation = {
  type: string;
  value: number;
  unit: string;
  measuredAt: string;
  [detail: string]: unknown;
};
export type DayBucket = {
  day: string;
  samples: Record<string, StoredSample>;
  statistics: Record<string, StoredStatistic>;
  deviceIds: string[];
};
export type ApplyResult = {
  received: number;
  stored: number;
  updated: number;
  duplicates: number;
  deleted: number;
  skipped: { outsideWindow: number; dayLimit: number };
};

const iso = (ms: number) => new Date(ms).toISOString();
const round = (n: number, digits = 2) =>
  Math.round(n * 10 ** digits) / 10 ** digits;
/** The calendar date written in a local ISO timestamp. */
export const localDate = (value: string) => value.slice(0, 10);
const addDays = (date: string, days: number) =>
  new Date(Date.parse(date + "T00:00:00Z") + days * DAY)
    .toISOString()
    .slice(0, 10);
/**
 * Sleep belongs to the local date on which it ends, like the Health app's
 * sleep chart. A segment ending at or after 18:00 starts the next night.
 */
export function sleepDay(end: string) {
  return Number(end.slice(11, 13)) >= 18
    ? addDays(localDate(end), 1)
    : localDate(end);
}
export function bucketDay(sample: HealthKitSample) {
  return sample.type === "sleep_analysis"
    ? sleepDay(sample.end)
    : localDate(sample.start);
}
function storedSample(
  sample: Exclude<
    HealthKitSample,
    { type: "heart_rate" | "step_count" | "active_energy" }
  >,
  deviceId: string,
): StoredSample {
  const base = {
    type: sample.type,
    start: iso(Date.parse(sample.start)),
    end: iso(Date.parse(sample.end)),
    deviceId,
  };
  if (sample.type === "sleep_analysis") return { ...base, stage: sample.stage };
  if (sample.type === "workout")
    return {
      ...base,
      activity: sample.activity,
      durationSeconds: round(sample.durationSeconds, 1),
      ...(sample.activeEnergyKcal === undefined
        ? {}
        : { activeEnergyKcal: round(sample.activeEnergyKcal, 1) }),
      ...(sample.distanceMeters === undefined
        ? {}
        : { distanceMeters: round(sample.distanceMeters, 1) }),
      ...(sample.averageHeartRate === undefined
        ? {}
        : { averageHeartRate: round(sample.averageHeartRate, 1) }),
    };
  if (sample.type === "body_mass")
    return {
      ...base,
      value: round(
        sample.unit === "lb" ? sample.value * 0.45359237 : sample.value,
        3,
      ),
      unit: "kg",
    };
  return { ...base, value: round(sample.value, 3), unit: sample.unit };
}
function storedStatistic(
  sample: Extract<
    HealthKitSample,
    { type: "heart_rate" | "step_count" | "active_energy" }
  >,
  deviceId: string,
  now: Date,
): StoredStatistic {
  const base = {
    type: sample.type,
    start: iso(Date.parse(sample.start)),
    end: iso(Date.parse(sample.end)),
    deviceId,
    reportedAt: now.toISOString(),
  };
  if (sample.type === "heart_rate")
    return {
      ...base,
      unit: "count/min",
      average: round(sample.average, 1),
      minimum: round(sample.minimum, 1),
      maximum: round(sample.maximum, 1),
      ...(sample.sampleCount === undefined
        ? {}
        : { sampleCount: sample.sampleCount }),
    };
  if (sample.type === "active_energy")
    return {
      ...base,
      unit: "kcal",
      value: round(
        sample.unit === "kJ" ? sample.value / 4.184 : sample.value,
        1,
      ),
    };
  return { ...base, unit: "count", value: Math.round(sample.value) };
}
const sameStatistic = (a: StoredStatistic, b: StoredStatistic) =>
  a.value === b.value &&
  a.average === b.average &&
  a.minimum === b.minimum &&
  a.maximum === b.maximum &&
  a.sampleCount === b.sampleCount &&
  a.end === b.end;
export function emptyBucket(day: string): DayBucket {
  return { day, samples: {}, statistics: {}, deviceIds: [] };
}
/**
 * Applies one validated upload to the member's day buckets in place. Unknown
 * days are created in `buckets`. Returns counts only; no health values.
 */
export function applyHealthKitBatch(
  buckets: Map<string, DayBucket>,
  batch: Pick<HealthKitBatch, "samples" | "deletedSampleIds">,
  deviceId: string,
  now = new Date(),
): ApplyResult & { changedDays: Set<string> } {
  const result = {
    received: batch.samples.length,
    stored: 0,
    updated: 0,
    duplicates: 0,
    deleted: 0,
    skipped: { outsideWindow: 0, dayLimit: 0 },
    changedDays: new Set<string>(),
  };
  const oldest = now.getTime() - HEALTHKIT_LIMITS.lookbackDays * DAY,
    newest = now.getTime() + HEALTHKIT_LIMITS.futureToleranceMinutes * MINUTE;
  for (const id of batch.deletedSampleIds)
    for (const bucket of buckets.values())
      if (bucket.samples[id]) {
        delete bucket.samples[id];
        result.deleted++;
        result.changedDays.add(bucket.day);
      }
  for (const sample of batch.samples) {
    if (Date.parse(sample.end) < oldest || Date.parse(sample.start) > newest) {
      result.skipped.outsideWindow++;
      continue;
    }
    const day = bucketDay(sample);
    let bucket = buckets.get(day);
    if (!bucket) buckets.set(day, (bucket = emptyBucket(day)));
    const limit = HEALTHKIT_LIMITS.perDay[sample.type];
    if (
      sample.type === "heart_rate" ||
      sample.type === "step_count" ||
      sample.type === "active_energy"
    ) {
      const stat = storedStatistic(sample, deviceId, now),
        key = [stat.type, stat.start, deviceId].join("|"),
        prior = bucket.statistics[key];
      if (prior && sameStatistic(prior, stat)) {
        result.duplicates++;
        continue;
      }
      if (
        !prior &&
        Object.values(bucket.statistics).filter((s) => s.type === stat.type)
          .length >= limit
      ) {
        result.skipped.dayLimit++;
        continue;
      }
      bucket.statistics[key] = stat;
      if (prior) result.updated++;
      else result.stored++;
    } else {
      if (bucket.samples[sample.id]) {
        result.duplicates++;
        continue;
      }
      if (
        Object.values(bucket.samples).filter((s) => s.type === sample.type)
          .length >= limit
      ) {
        result.skipped.dayLimit++;
        continue;
      }
      bucket.samples[sample.id] = storedSample(sample, deviceId);
      result.stored++;
    }
    if (!bucket.deviceIds.includes(deviceId)) bucket.deviceIds.push(deviceId);
    result.changedDays.add(day);
  }
  return result;
}
/** Minutes covered by the union of the intervals. */
export function mergedMinutes(intervals: Array<[number, number]>) {
  const sorted = intervals
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let total = 0,
    current: [number, number] | null = null;
  for (const [a, b] of sorted) {
    if (!current || a > current[1]) {
      if (current) total += current[1] - current[0];
      current = [a, b];
    } else current[1] = Math.max(current[1], b);
  }
  if (current) total += current[1] - current[0];
  return total / MINUTE;
}
const ASLEEP = new Set([
  "asleep_unspecified",
  "asleep_core",
  "asleep_deep",
  "asleep_rem",
]);
const HK = {
  heart_rate: "HKQuantityTypeIdentifierHeartRate",
  heart_rate_variability: "HKQuantityTypeIdentifierHeartRateVariabilitySDNN",
  resting_heart_rate: "HKQuantityTypeIdentifierRestingHeartRate",
  body_mass: "HKQuantityTypeIdentifierBodyMass",
  workout: "HKWorkout",
} as const;
/**
 * Observations for the Client Twin and progress views. Instantaneous samples
 * keep their HealthKit type identifiers like the export import; totals for a
 * period appear only once that period has ended.
 */
export function deriveObservations(
  bucket: DayBucket,
  now = new Date(),
): Observation[] {
  const observations: Observation[] = [];
  const samples = Object.values(bucket.samples).sort(
    (a, b) => Date.parse(a.start) - Date.parse(b.start),
  );
  for (const s of samples) {
    if (s.type === "sleep_analysis") continue;
    if (s.type === "workout")
      observations.push({
        type: HK.workout,
        value: round((s.durationSeconds ?? 0) / 60),
        unit: "min",
        measuredAt: s.start,
        activity: s.activity,
        ...(s.activeEnergyKcal === undefined
          ? {}
          : { activeEnergyKcal: s.activeEnergyKcal }),
        ...(s.distanceMeters === undefined
          ? {}
          : { distanceMeters: s.distanceMeters }),
        ...(s.averageHeartRate === undefined
          ? {}
          : { averageHeartRate: s.averageHeartRate }),
      });
    else
      observations.push({
        type: HK[s.type],
        value: s.value!,
        unit: s.unit!,
        measuredAt: s.start,
      });
  }
  const workouts = samples.filter((s) => s.type === "workout");
  if (workouts.length)
    observations.push({
      type: "workout_minutes",
      value: round(
        mergedMinutes(
          workouts.map((w) => [
            Date.parse(w.start),
            Math.min(
              Date.parse(w.end),
              Date.parse(w.start) + (w.durationSeconds ?? 0) * 1000,
            ),
          ]),
        ),
      ),
      unit: "min",
      measuredAt: iso(Math.max(...workouts.map((w) => Date.parse(w.end)))),
      aggregation: "merged_workout_intervals",
    });
  const segments = samples.filter((s) => s.type === "sleep_analysis");
  const asleep = segments.filter((s) => ASLEEP.has(s.stage ?? ""));
  if (asleep.length)
    observations.push({
      type: "sleep_minutes",
      value: round(
        mergedMinutes(
          asleep.map((s) => [Date.parse(s.start), Date.parse(s.end)]),
        ),
      ),
      unit: "min",
      measuredAt: iso(Math.max(...asleep.map((s) => Date.parse(s.end)))),
      aggregation: "merged_asleep_intervals",
    });
  const inBed = segments.filter((s) => s.stage === "in_bed");
  if (inBed.length)
    observations.push({
      type: "in_bed_minutes",
      value: round(
        mergedMinutes(
          inBed.map((s) => [Date.parse(s.start), Date.parse(s.end)]),
        ),
      ),
      unit: "min",
      measuredAt: iso(Math.max(...inBed.map((s) => Date.parse(s.end)))),
      aggregation: "merged_in_bed_intervals",
    });
  const byPeriod = new Map<string, StoredStatistic[]>();
  for (const stat of Object.values(bucket.statistics)) {
    const key = stat.type + "|" + stat.start;
    byPeriod.set(key, [...(byPeriod.get(key) ?? []), stat]);
  }
  for (const stats of [...byPeriod.values()].sort(
    (a, b) => Date.parse(a[0].start) - Date.parse(b[0].start),
  )) {
    const first = stats[0];
    // A period's total or average is used only after it has ended.
    if (Date.parse(first.end) > now.getTime()) continue;
    if (first.type === "heart_rate") {
      // Two devices can report the same hour; the latest report is kept.
      const s = stats.reduce((a, b) =>
        a.reportedAt > b.reportedAt ||
        (a.reportedAt === b.reportedAt &&
          (a.sampleCount ?? 0) >= (b.sampleCount ?? 0))
          ? a
          : b,
      );
      observations.push({
        type: HK.heart_rate,
        value: s.average!,
        unit: "count/min",
        measuredAt: s.start,
        minimum: s.minimum,
        maximum: s.maximum,
        aggregation: "hourly_average",
      });
    } else
      // HealthKit statistics de-duplicate sources within a device; the most
      // complete device total is used when several devices report a day.
      observations.push({
        type:
          first.type === "step_count" ? "daily_steps" : "daily_active_energy",
        value: Math.max(...stats.map((s) => s.value ?? 0)),
        unit: first.type === "step_count" ? "count" : "kcal",
        measuredAt: iso(Date.parse(first.end) - 1000),
        aggregation: "daily_total",
      });
  }
  return observations;
}
/**
 * The earliest end of a stored statistic period (daily total or hourly heart
 * rate) that has not ended at `now`. The day's observations change at that
 * time even if no device syncs again, so the record is re-derived then.
 */
export function nextPeriodEnd(bucket: DayBucket, now = new Date()) {
  const pending = Object.values(bucket.statistics)
    .map((s) => Date.parse(s.end))
    .filter((end) => end > now.getTime());
  return pending.length ? iso(Math.min(...pending)) : null;
}
/** Rebuilds the day bucket kept inside a synchronized-day record. */
export function bucketFromData(data: {
  day?: unknown;
  samples?: unknown;
  statistics?: unknown;
  deviceIds?: unknown;
}): DayBucket {
  const object = (value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, any>)
      : {};
  return {
    day: String(data.day ?? ""),
    samples: object(data.samples),
    statistics: object(data.statistics),
    deviceIds: Array.isArray(data.deviceIds) ? data.deviceIds.map(String) : [],
  };
}
/**
 * Observations of a stored synchronized day as of `now`. Read paths use this
 * so a total whose period ended after the last upload appears without waiting
 * for another sync or the worker.
 */
export function currentDayObservations(
  data: Parameters<typeof bucketFromData>[0],
  now = new Date(),
) {
  return deriveObservations(bucketFromData(data), now);
}
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value as object)
            .sort()
            .map((k) => [k, canonical((value as Record<string, unknown>)[k])]),
        )
      : value;
/** Compares observation lists independently of stored key order. */
export function sameObservations(a: unknown, b: unknown) {
  return (
    JSON.stringify(canonical(a ?? [])) === JSON.stringify(canonical(b ?? []))
  );
}
export function bucketEmpty(bucket: DayBucket) {
  return (
    !Object.keys(bucket.samples).length &&
    !Object.keys(bucket.statistics).length
  );
}
/** A compact per-day view for progress screens; values only, no identifiers. */
export function daySummary(day: string, observations: Observation[]) {
  const pick = (type: string) => observations.filter((o) => o.type === type);
  const last = (type: string) => pick(type).at(-1)?.value ?? null;
  const hrv = pick(HK.heart_rate_variability).map((o) => o.value);
  const sortedHrv = [...hrv].sort((a, b) => a - b);
  return {
    day,
    steps: last("daily_steps"),
    activeEnergyKcal: last("daily_active_energy"),
    sleepMinutes: last("sleep_minutes"),
    workoutMinutes: last("workout_minutes"),
    workouts: pick(HK.workout).map((o) => ({
      activity: String(o.activity ?? "workout"),
      minutes: o.value,
    })),
    restingHeartRate: last(HK.resting_heart_rate),
    hrvMs: sortedHrv.length
      ? round(
          sortedHrv.length % 2
            ? sortedHrv[(sortedHrv.length - 1) / 2]
            : (sortedHrv[sortedHrv.length / 2 - 1] +
                sortedHrv[sortedHrv.length / 2]) /
                2,
          1,
        )
      : null,
    bodyMassKg: last(HK.body_mass),
  };
}
