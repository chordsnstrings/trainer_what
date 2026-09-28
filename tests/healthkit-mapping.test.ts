import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HEALTHKIT_LIMITS,
  applyHealthKitBatch,
  bucketDay,
  bucketFromData,
  currentDayObservations,
  daySummary,
  deriveObservations,
  healthKitBatchSchema,
  mergedMinutes,
  nextPeriodEnd,
  sameObservations,
  sleepDay,
  type DayBucket,
} from "../packages/domain/src/healthkit.ts";
import { clientTwin } from "../packages/domain/src/client-twin.ts";

const now = new Date("2026-09-27T10:00:00Z");
let serial = 0;
const id = () =>
  `6F1C1F3E-8B6A-4C77-9D1E-${String(++serial).padStart(12, "0")}`;
const batch = (samples: unknown[], extra: Record<string, unknown> = {}) =>
  healthKitBatchSchema.parse({
    batchId: "batch-" + serial++ + "-x",
    samples,
    ...extra,
  });
const issues = (value: unknown) => {
  const r = healthKitBatchSchema.safeParse(value);
  assert.equal(r.success, false, "expected a validation failure");
  return JSON.stringify(r.error!.issues);
};

test("strict validation rejects unknown types, units, shapes and oversized batches", () => {
  const base = { batchId: "batch-0001" };
  assert.match(
    issues({ ...base, samples: [{ type: "blood_glucose", id: id() }] }),
    /discriminator/i,
  );
  assert.match(
    issues({
      ...base,
      samples: [
        {
          type: "resting_heart_rate",
          id: id(),
          start: "2026-09-26T07:00:00+04:00",
          end: "2026-09-26T07:00:00+04:00",
          value: 55,
          unit: "bpm",
        },
      ],
    }),
    /unit/,
  );
  // Timestamps need an explicit UTC offset or Z; local time without one is ambiguous.
  assert.match(
    issues({
      ...base,
      samples: [
        {
          type: "resting_heart_rate",
          id: id(),
          start: "2026-09-26T07:00:00",
          end: "2026-09-26T07:00:00",
          value: 55,
          unit: "count/min",
        },
      ],
    }),
    /start/,
  );
  // Unknown fields are refused rather than silently stored.
  assert.match(
    issues({
      ...base,
      samples: [
        {
          type: "body_mass",
          id: id(),
          start: "2026-09-26T07:00:00+04:00",
          end: "2026-09-26T07:00:00+04:00",
          value: 80,
          unit: "kg",
          sourceName: "Scale",
        },
      ],
    }),
    /unrecognized|sourceName/i,
  );
  // Daily totals must cover one local day starting at midnight.
  assert.match(
    issues({
      ...base,
      samples: [
        {
          type: "step_count",
          start: "2026-09-26T06:00:00+04:00",
          end: "2026-09-27T06:00:00+04:00",
          value: 100,
          unit: "count",
        },
      ],
    }),
    /midnight/,
  );
  assert.match(
    issues({
      ...base,
      samples: [
        {
          type: "heart_rate",
          start: "2026-09-26T06:30:00+04:00",
          end: "2026-09-26T07:30:00+04:00",
          unit: "count/min",
          average: 70,
          minimum: 60,
          maximum: 80,
        },
      ],
    }),
    /hour/,
  );
  assert.match(
    issues({
      ...base,
      samples: [
        {
          type: "heart_rate",
          start: "2026-09-26T06:00:00+04:00",
          end: "2026-09-26T07:00:00+04:00",
          unit: "count/min",
          average: 90,
          minimum: 60,
          maximum: 80,
        },
      ],
    }),
    /minimum/,
  );
  const repeated = id();
  const rhr = (sampleId: string) => ({
    type: "resting_heart_rate",
    id: sampleId,
    start: "2026-09-26T07:00:00+04:00",
    end: "2026-09-26T07:00:00+04:00",
    value: 55,
    unit: "count/min",
  });
  assert.match(
    issues({ ...base, samples: [rhr(repeated), rhr(repeated.toLowerCase())] }),
    /once per batch/,
  );
  assert.match(
    issues({
      ...base,
      samples: Array.from(
        { length: HEALTHKIT_LIMITS.perType.resting_heart_rate + 1 },
        () => rhr(id()),
      ),
    }),
    /At most 200 resting_heart_rate/,
  );
  assert.match(issues({ ...base, samples: [] }), /at least one/);
  assert.match(issues({ batchId: "short", samples: [rhr(id())] }), /batchId/);
  assert.match(
    issues({
      ...base,
      samples: [
        {
          type: "workout",
          id: id(),
          start: "2026-09-26T07:00:00+04:00",
          end: "2026-09-26T07:30:00+04:00",
          activity: "running",
          durationSeconds: 3600,
        },
      ],
    }),
    /durationSeconds/,
  );
  assert.match(
    issues({
      ...base,
      samples: [
        {
          type: "body_mass",
          id: id(),
          start: "2026-09-26T07:00:00+04:00",
          end: "2026-09-26T07:00:00+04:00",
          value: 1000,
          unit: "lb",
        },
      ],
    }),
    /Body mass/,
  );
});

test("sleep belongs to the local wake date and other samples to their local start date", () => {
  assert.equal(sleepDay("2026-09-26T06:45:00+04:00"), "2026-09-26");
  assert.equal(sleepDay("2026-09-25T23:30:00+04:00"), "2026-09-26");
  assert.equal(sleepDay("2026-09-30T18:00:00+04:00"), "2026-10-01");
  assert.equal(sleepDay("2026-09-26T15:00:00+04:00"), "2026-09-26");
  // The device's own offset decides the date, not UTC.
  assert.equal(
    bucketDay({
      type: "resting_heart_rate",
      id: id(),
      start: "2026-09-26T01:00:00+04:00",
      end: "2026-09-26T01:00:00+04:00",
      value: 50,
      unit: "count/min",
    }),
    "2026-09-26",
  );
  assert.equal(
    mergedMinutes([
      [0, 60000 * 30],
      [60000 * 20, 60000 * 50],
      [60000 * 60, 60000 * 70],
    ]),
    60,
  );
});

test("upload mapping de-duplicates samples, converts units and keeps the most complete totals", () => {
  const buckets = new Map<string, DayBucket>();
  const sleepA = id(),
    sleepB = id(),
    weight = id(),
    run = id();
  const first = batch([
    {
      type: "sleep_analysis",
      id: sleepA,
      start: "2026-09-25T23:00:00+04:00",
      end: "2026-09-26T03:00:00+04:00",
      stage: "asleep_core",
    },
    // Overlapping sleep from a second source counts once.
    {
      type: "sleep_analysis",
      id: sleepB,
      start: "2026-09-26T02:00:00+04:00",
      end: "2026-09-26T06:30:00+04:00",
      stage: "asleep_deep",
    },
    {
      type: "sleep_analysis",
      id: id(),
      start: "2026-09-25T22:30:00+04:00",
      end: "2026-09-26T06:45:00+04:00",
      stage: "in_bed",
    },
    {
      type: "sleep_analysis",
      id: id(),
      start: "2026-09-26T03:00:00+04:00",
      end: "2026-09-26T03:10:00+04:00",
      stage: "awake",
    },
    {
      type: "body_mass",
      id: weight,
      start: "2026-09-26T07:00:00+04:00",
      end: "2026-09-26T07:00:00+04:00",
      value: 176.37,
      unit: "lb",
    },
    {
      type: "active_energy",
      start: "2026-09-26T00:00:00+04:00",
      end: "2026-09-27T00:00:00+04:00",
      value: 2092,
      unit: "kJ",
    },
    {
      type: "step_count",
      start: "2026-09-26T00:00:00+04:00",
      end: "2026-09-27T00:00:00+04:00",
      value: 9000,
      unit: "count",
    },
    {
      type: "workout",
      id: run,
      start: "2026-09-26T18:00:00+04:00",
      end: "2026-09-26T18:50:00+04:00",
      activity: "running",
      durationSeconds: 2700,
      activeEnergyKcal: 420,
      distanceMeters: 7000,
      averageHeartRate: 150,
    },
    {
      type: "heart_rate",
      start: "2026-09-26T18:00:00+04:00",
      end: "2026-09-26T19:00:00+04:00",
      unit: "count/min",
      average: 128,
      minimum: 70,
      maximum: 171,
      sampleCount: 300,
    },
    // Today's total is stored but not used before the day ends.
    {
      type: "step_count",
      start: "2026-09-27T00:00:00+04:00",
      end: "2026-09-28T00:00:00+04:00",
      value: 1200,
      unit: "count",
    },
  ]);
  const r1 = applyHealthKitBatch(buckets, first, "device-a", now);
  assert.deepEqual(
    { stored: r1.stored, duplicates: r1.duplicates, skipped: r1.skipped },
    { stored: 10, duplicates: 0, skipped: { outsideWindow: 0, dayLimit: 0 } },
  );
  const day = buckets.get("2026-09-26")!;
  const obs = deriveObservations(day, now);
  const one = (type: string) => obs.filter((o) => o.type === type);
  assert.equal(one("sleep_minutes")[0].value, 450, "23:00-06:30 merged");
  assert.equal(one("in_bed_minutes")[0].value, 495);
  assert.equal(one("HKQuantityTypeIdentifierBodyMass")[0].value, 80);
  assert.equal(one("HKQuantityTypeIdentifierBodyMass")[0].unit, "kg");
  assert.equal(one("daily_active_energy")[0].value, 500);
  assert.equal(one("daily_steps")[0].value, 9000);
  assert.equal(one("workout_minutes")[0].value, 45);
  assert.deepEqual(
    { ...one("HKWorkout")[0], measuredAt: undefined },
    {
      type: "HKWorkout",
      value: 45,
      unit: "min",
      measuredAt: undefined,
      activity: "running",
      activeEnergyKcal: 420,
      distanceMeters: 7000,
      averageHeartRate: 150,
    },
  );
  assert.equal(one("HKQuantityTypeIdentifierHeartRate")[0].value, 128);
  // Daily totals are measured inside their own local day.
  assert.equal(one("daily_steps")[0].measuredAt, "2026-09-26T19:59:59.000Z");
  assert.equal(
    deriveObservations(buckets.get("2026-09-27")!, now).length,
    0,
    "an in-progress day contributes no total",
  );
  assert.equal(
    deriveObservations(
      buckets.get("2026-09-27")!,
      new Date("2026-09-28T01:00:00Z"),
    )[0].value,
    1200,
  );

  // A resend is a duplicate; a second device's larger total wins; a changed
  // statistic from the same device replaces the earlier report.
  const r2 = applyHealthKitBatch(
    buckets,
    batch([
      {
        type: "sleep_analysis",
        id: sleepA,
        start: "2026-09-25T23:00:00+04:00",
        end: "2026-09-26T03:00:00+04:00",
        stage: "asleep_core",
      },
      {
        type: "step_count",
        start: "2026-09-26T00:00:00+04:00",
        end: "2026-09-27T00:00:00+04:00",
        value: 9000,
        unit: "count",
      },
      {
        type: "step_count",
        start: "2026-09-27T00:00:00+04:00",
        end: "2026-09-28T00:00:00+04:00",
        value: 3400,
        unit: "count",
      },
    ]),
    "device-a",
    now,
  );
  assert.deepEqual(
    { stored: r2.stored, updated: r2.updated, duplicates: r2.duplicates },
    { stored: 0, updated: 1, duplicates: 2 },
  );
  applyHealthKitBatch(
    buckets,
    batch(
      [
        {
          type: "step_count",
          start: "2026-09-26T00:00:00+04:00",
          end: "2026-09-27T00:00:00+04:00",
          value: 9400,
          unit: "count",
        },
        {
          type: "step_count",
          start: "2026-09-26T00:00:00+04:00",
          end: "2026-09-27T00:00:00+04:00",
          value: 1,
          unit: "count",
        },
      ].slice(0, 1),
    ),
    "device-b",
    now,
  );
  assert.equal(
    deriveObservations(buckets.get("2026-09-26")!, now).find(
      (o) => o.type === "daily_steps",
    )!.value,
    9400,
  );
  // Deletions made in the Health app remove the stored sample.
  const r3 = applyHealthKitBatch(
    buckets,
    batch([], { deletedSampleIds: [weight, id()] }),
    "device-a",
    now,
  );
  assert.equal(r3.deleted, 1);
  assert.equal(
    deriveObservations(buckets.get("2026-09-26")!, now).some(
      (o) => o.type === "HKQuantityTypeIdentifierBodyMass",
    ),
    false,
  );
  const summary = daySummary(
    "2026-09-26",
    deriveObservations(buckets.get("2026-09-26")!, now),
  );
  assert.deepEqual(
    {
      steps: summary.steps,
      sleep: summary.sleepMinutes,
      workout: summary.workoutMinutes,
      energy: summary.activeEnergyKcal,
      body: summary.bodyMassKg,
    },
    { steps: 9400, sleep: 450, workout: 45, energy: 500, body: null },
  );
  assert.deepEqual(summary.workouts, [{ activity: "running", minutes: 45 }]);
});

test("look-back window, future tolerance and per-day limits skip samples without failing the batch", () => {
  const buckets = new Map<string, DayBucket>();
  const old = new Date(now.getTime() - 91 * 86400000).toISOString();
  const future = new Date(now.getTime() + 11 * 60000).toISOString();
  const r = applyHealthKitBatch(
    buckets,
    batch([
      {
        type: "resting_heart_rate",
        id: id(),
        start: old,
        end: old,
        value: 50,
        unit: "count/min",
      },
      {
        type: "resting_heart_rate",
        id: id(),
        start: future,
        end: future,
        value: 50,
        unit: "count/min",
      },
      ...Array.from(
        { length: HEALTHKIT_LIMITS.perDay.resting_heart_rate + 3 },
        (_, i) => ({
          type: "resting_heart_rate",
          id: id(),
          start: `2026-09-26T0${i % 10}:0${i % 6}:00+04:00`,
          end: `2026-09-26T0${i % 10}:0${i % 6}:00+04:00`,
          value: 50 + i,
          unit: "count/min",
        }),
      ),
    ]),
    "device-a",
    now,
  );
  assert.deepEqual(r.skipped, { outsideWindow: 2, dayLimit: 3 });
  assert.equal(r.stored, HEALTHKIT_LIMITS.perDay.resting_heart_rate);
});

test("the Client Twin reads synchronized daily totals and HealthKit identifiers", () => {
  const buckets = new Map<string, DayBucket>();
  applyHealthKitBatch(
    buckets,
    batch([
      {
        type: "resting_heart_rate",
        id: id(),
        start: "2026-09-26T07:00:00+04:00",
        end: "2026-09-26T07:00:00+04:00",
        value: 52,
        unit: "count/min",
      },
      {
        type: "heart_rate_variability",
        id: id(),
        start: "2026-09-26T07:05:00+04:00",
        end: "2026-09-26T07:06:00+04:00",
        value: 61,
        unit: "ms",
      },
      {
        type: "step_count",
        start: "2026-09-26T00:00:00+04:00",
        end: "2026-09-27T00:00:00+04:00",
        value: 10500,
        unit: "count",
      },
      {
        type: "active_energy",
        start: "2026-09-26T00:00:00+04:00",
        end: "2026-09-27T00:00:00+04:00",
        value: 610,
        unit: "kcal",
      },
      {
        type: "workout",
        id: id(),
        start: "2026-09-26T18:00:00+04:00",
        end: "2026-09-26T19:00:00+04:00",
        activity: "traditional_strength_training",
        durationSeconds: 3000,
      },
      {
        type: "sleep_analysis",
        id: id(),
        start: "2026-09-25T23:00:00+04:00",
        end: "2026-09-26T06:00:00+04:00",
        stage: "asleep_unspecified",
      },
    ]),
    "device-a",
    now,
  );
  const records = [...buckets.values()].map((b, i) => ({
    id: "00000000-0000-0000-0000-00000000000" + i,
    kind: "wearable",
    status: "imported",
    created_at: now.toISOString(),
    data: {
      source: "apple_health",
      origin: "apple_healthkit",
      allowedUses: ["render", "deterministic_feature"],
      observations: deriveObservations(b, now),
    },
  }));
  const twin = clientTwin({
    records: records as any,
    sets: [],
    coachingConsent: true,
    wearableConsent: null,
    now,
  });
  const metric = (key: string) =>
    twin.wearables.metrics.find((m: any) => m.key === key)!;
  assert.equal(metric("resting_heart_rate").latest, 52);
  assert.equal(metric("hrv").latest, 61);
  assert.equal(metric("daily_steps").latest, 10500);
  assert.equal(metric("daily_active_energy").latest, 610);
  assert.equal(metric("workout_minutes").latest, 50);
  assert.equal(metric("sleep_minutes").latest, 420);
  assert.equal(metric("daily_steps").state, "current");
  assert.deepEqual(metric("daily_steps").sources, ["apple_health"]);
  const denied = clientTwin({
    records: records as any,
    sets: [],
    coachingConsent: true,
    wearableConsent: false,
    now,
  });
  assert.equal(
    denied.wearables.metrics.find((m: any) => m.key === "daily_steps")!.state,
    "permission_denied",
  );
});

test("totals and hourly averages sent before their period ends complete later without new values", () => {
  // Last sync at 22:30 local time on 26 September; the phone then stays quiet.
  const lastSync = new Date("2026-09-26T18:30:00Z");
  const buckets = new Map<string, DayBucket>();
  const upload = [
    {
      type: "step_count",
      start: "2026-09-26T00:00:00+04:00",
      end: "2026-09-27T00:00:00+04:00",
      value: 8400,
      unit: "count",
    },
    {
      type: "active_energy",
      start: "2026-09-26T00:00:00+04:00",
      end: "2026-09-27T00:00:00+04:00",
      value: 530,
      unit: "kcal",
    },
    {
      type: "heart_rate",
      start: "2026-09-26T22:00:00+04:00",
      end: "2026-09-26T23:00:00+04:00",
      unit: "count/min",
      average: 64,
      minimum: 58,
      maximum: 80,
    },
  ];
  applyHealthKitBatch(buckets, batch(upload), "device-a", lastSync);
  const bucket = buckets.get("2026-09-26")!;
  const types = (o: Array<{ type: string }>) => o.map((x) => x.type).sort();
  // Nothing whose period is still running is used yet.
  assert.deepEqual(deriveObservations(bucket, lastSync), []);
  // The earliest running period says when the day next changes.
  assert.equal(nextPeriodEnd(bucket, lastSync), "2026-09-26T19:00:00.000Z");
  const afterHour = new Date("2026-09-26T19:00:01Z");
  assert.deepEqual(types(deriveObservations(bucket, afterHour)), [
    "HKQuantityTypeIdentifierHeartRate",
  ]);
  assert.equal(nextPeriodEnd(bucket, afterHour), "2026-09-26T20:00:00.000Z");
  // After local midnight the unchanged totals complete the day.
  const nextMorning = new Date("2026-09-27T03:00:00Z");
  assert.equal(nextPeriodEnd(bucket, nextMorning), null);
  // The usual unchanged re-send is a duplicate and changes no stored input...
  const resend = applyHealthKitBatch(
    buckets,
    batch(upload),
    "device-a",
    nextMorning,
  );
  assert.equal(resend.duplicates, 3);
  assert.equal(resend.changedDays.size, 0);
  // ...but the stored day, read again, now carries the completed totals.
  const stored = JSON.parse(
    JSON.stringify({
      day: bucket.day,
      samples: bucket.samples,
      statistics: bucket.statistics,
      deviceIds: bucket.deviceIds,
      observations: deriveObservations(bucket, lastSync),
    }),
  );
  const current = currentDayObservations(stored, nextMorning);
  assert.deepEqual(types(current), [
    "HKQuantityTypeIdentifierHeartRate",
    "daily_active_energy",
    "daily_steps",
  ]);
  assert.equal(sameObservations(current, stored.observations), false);
  const summary = daySummary("2026-09-26", current);
  assert.equal(summary.steps, 8400);
  assert.equal(summary.activeEnergyKcal, 530);
  // Stored key order does not make identical observations look different.
  const reordered = current.map((o) =>
    Object.fromEntries(Object.entries(o).reverse()),
  );
  assert.equal(sameObservations(current, reordered), true);
  // Malformed stored data yields an empty day rather than an error.
  assert.deepEqual(
    bucketFromData({ day: "2026-09-26", samples: [], statistics: null }),
    { day: "2026-09-26", samples: {}, statistics: {}, deviceIds: [] },
  );
});
