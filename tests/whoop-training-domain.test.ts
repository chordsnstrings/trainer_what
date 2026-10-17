import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeWhoopObservations } from "../packages/providers/src/integrations.ts";
import {
  whoopRecovery,
  reduceWhoopWorkout,
  whoopTrainingPolicySchema,
} from "../packages/domain/src/whoop-training.ts";
import {
  buildSessionScript,
  planExercises,
  scriptIssues,
} from "../packages/domain/src/voice-session.ts";

const now = new Date("2026-10-17T10:00:00Z"),
  end = "2026-10-17T06:00:00Z";
const sleep = {
  id: "sleep-one",
  end,
  nap: false,
  score_state: "SCORED",
  score: {
    sleep_performance_percentage: 85,
    stage_summary: {
      total_light_sleep_time_milli: 14400000,
      total_slow_wave_sleep_time_milli: 7200000,
      total_rem_sleep_time_milli: 7200000,
    },
  },
};
const recovery = {
  cycle_id: 123,
  sleep_id: sleep.id,
  created_at: "2026-10-16T22:00:00Z",
  updated_at: "2026-10-17T09:00:00Z",
  score_state: "SCORED",
  score: {
    recovery_score: 25,
    hrv_rmssd_milli: 44.1,
    resting_heart_rate: 61,
    user_calibrating: false,
  },
};
function observations(r: any = recovery, s: any = sleep) {
  return normalizeWhoopObservations([
    { path: "recovery", row: r },
    ...(s ? [{ path: "activity/sleep", row: s }] : []),
  ]);
}
function rows(obs: any[] = observations()) {
  return obs.map((o, i) => ({
    id: String(i),
    version: 3,
    status: "imported",
    data: {
      source: "whoop",
      allowedUses: ["render", "deterministic_feature"],
      observations: [o],
    },
  }));
}
test("WHOOP v2 recovery links to the main sleep end, with HRV, RHR and actual sleep duration", () => {
  const obs = observations();
  assert.equal(obs.length, 5);
  assert.equal(obs[0].id, "recovery:123:recovery_score");
  assert.equal(obs[0].measuredAt, new Date(end).toISOString());
  assert.equal(obs[0].trainingReady, true);
  const state = whoopRecovery(rows(obs), now.toISOString(), "UTC", now);
  assert.equal(state.status, "ready");
  assert.equal(state.score, 25);
  assert.equal(state.band, "low");
  assert.equal(state.sleepHours, 8);
  assert.equal(state.hrvMs, 44.1);
  assert.equal(state.restingHeartRate, 61);
  assert.equal(state.sourceVersion, 3);
});
test("unscored or invalid provider readings cannot be used, and unknown calibration is conservative", () => {
  assert.equal(
    observations({ ...recovery, score_state: "PENDING_SCORE" }).filter(
      (o) => o.type === "recovery_score",
    ).length,
    0,
  );
  assert.equal(
    observations({
      ...recovery,
      score: {
        ...recovery.score,
        recovery_score: 101,
        hrv_rmssd_milli: NaN,
        resting_heart_rate: -1,
      },
    }).filter((o) => o.id.startsWith("recovery:")).length,
    0,
  );
  assert.equal(observations(recovery, { ...sleep, end: "bad-date" }).length, 0);
  for (const s of [
    null,
    { ...sleep, nap: true },
    { ...sleep, score_state: "PENDING_SCORE" },
  ])
    assert.equal(observations(recovery, s)[0].trainingReady, false);
  assert.equal(
    observations({ ...recovery, score: { recovery_score: 25 } })[0].calibrating,
    true,
  );
});
test("only fresh, current-local-day, scored and permitted recovery can affect training", () => {
  const checks = [
    [rows(), "2026-10-17T07:59:59Z", "stale"],
    [rows(), "2026-10-17T10:00:01Z", "stale"],
    [rows(), null, "stale"],
    [
      rows(
        observations({
          ...recovery,
          score: { ...recovery.score, user_calibrating: true },
        }),
      ),
      now.toISOString(),
      "calibrating",
    ],
    [
      rows(observations(recovery, { ...sleep, nap: true })),
      now.toISOString(),
      "unavailable",
    ],
    [
      rows().map((r) => ({ ...r, status: "superseded" })),
      now.toISOString(),
      "missing",
    ],
    [
      rows().map((r) => ({
        ...r,
        data: { ...r.data, allowedUses: ["render"] },
      })),
      now.toISOString(),
      "missing",
    ],
    [
      rows(observations(recovery, { ...sleep, end: "2026-10-16T23:00:00Z" })),
      now.toISOString(),
      "stale",
    ],
    [
      rows(observations(recovery, { ...sleep, end: "2026-10-17T11:00:00Z" })),
      now.toISOString(),
      "stale",
    ],
  ] as const;
  for (const [r, sync, expected] of checks)
    assert.equal(whoopRecovery(r as any, sync, "UTC", now).status, expected);
  const localRows = rows(
    observations(recovery, { ...sleep, end: "2026-10-16T22:00:00Z" }),
  );
  assert.equal(
    whoopRecovery(localRows, now.toISOString(), "Asia/Dubai", now).status,
    "ready",
  );
});
test("WHOOP recovery bands follow the published boundaries without raising any load", () => {
  for (const [score, band] of [
    [0, "low"],
    [33, "low"],
    [34, "moderate"],
    [66, "moderate"],
    [67, "high"],
    [100, "high"],
  ] as const)
    assert.equal(
      whoopRecovery(
        rows(
          observations({
            ...recovery,
            score: { ...recovery.score, recovery_score: score },
          }),
        ),
        now.toISOString(),
        "UTC",
        now,
      ).band,
      band,
    );
  assert.throws(() =>
    whoopTrainingPolicySchema.parse({
      low: { loadPercent: 31, volumePercent: 50 },
    }),
  );
  assert.throws(() =>
    whoopTrainingPolicySchema.parse({
      moderate: { loadPercent: 0, volumePercent: -10 },
    }),
  );
  assert.equal(whoopTrainingPolicySchema.parse({}).enabled, false);
});
test("recovery reductions preserve the original programme, protected blocks and circuit structure", () => {
  const program = {
    title: "Mixed practice",
    exercises: [
      {
        name: "Warm-up",
        block: "warmup",
        sets: 1,
        durationSeconds: 300,
        restSeconds: 0,
      },
      {
        name: "Squat",
        sets: 3,
        reps: 10,
        loadKg: 40,
        restSeconds: 90,
        rir: 2,
        group: { id: "c1", type: "circuit" },
        alternatives: [{ name: "Goblet squat", loadKg: 20 }],
      },
      { name: "Plank", sets: 2, durationSeconds: 60, restSeconds: 30 },
      { name: "Walk", sets: 1, distanceMeters: 500, restSeconds: 0 },
      {
        name: "Cool-down",
        block: "cooldown",
        sets: 1,
        durationSeconds: 60,
        restSeconds: 0,
      },
    ],
  };
  const original = structuredClone(program);
  const result = reduceWhoopWorkout(program, {
    loadPercent: 10,
    volumePercent: 25,
  });
  assert.deepEqual(program, original);
  assert.deepEqual(result.program.exercises[0], original.exercises[0]);
  assert.deepEqual(result.program.exercises[4], original.exercises[4]);
  assert.equal(result.program.exercises[1].loadKg, 36);
  assert.equal(result.program.exercises[1].reps, 8);
  assert.equal(result.program.exercises[1].alternatives[0].loadKg, 18);
  assert.deepEqual(
    result.program.exercises[1].group,
    original.exercises[1].group,
  );
  assert.equal(result.program.exercises[1].sets, 3);
  assert.equal(result.program.exercises[1].restSeconds, 90);
  assert.equal(result.program.exercises[2].durationSeconds, 45);
  assert.equal(result.program.exercises[3].distanceMeters, 380);
  assert.equal(result.changes.length, 3);
  assert.strictEqual(
    reduceWhoopWorkout(program, { loadPercent: 0, volumePercent: 0 }).program,
    program,
  );
});
test("rounding never exceeds trainer limits, produces invalid minimums or increases work", () => {
  for (const reps of [1, 2, 3, 5, 10, 99])
    for (const loadKg of [0, 0.3, 1, 2.5, 40, 499])
      for (const percent of [1, 10, 25, 30]) {
        const exercise = {
          name: "Squat",
          sets: 1,
          reps,
          loadKg,
          restSeconds: 60,
        };
        const e = reduceWhoopWorkout(
          { exercises: [exercise] },
          { loadPercent: percent, volumePercent: percent },
        ).program.exercises[0];
        assert.ok(
          e.reps <= reps && e.reps >= Math.max(1, reps * (1 - percent / 100)),
        );
        assert.ok(
          e.loadKg <= loadKg &&
            e.loadKg >= loadKg * (1 - percent / 100) - 0.00001,
        );
      }
});
test("guided scripts reject the old prescription and accept the actual recovery-adjusted workout", () => {
  const program = {
    title: "Strength",
    exercises: [
      { name: "Squat", sets: 3, reps: 10, loadKg: 40, restSeconds: 90 },
    ],
  };
  const adjusted = reduceWhoopWorkout(program, {
    loadPercent: 10,
    volumePercent: 25,
  }).program;
  const originalScript = buildSessionScript({
    exercises: planExercises(program),
    title: program.title,
  });
  assert.ok(
    scriptIssues(originalScript.script, planExercises(adjusted)).length > 0,
  );
  const adjustedScript = buildSessionScript({
    exercises: planExercises(adjusted),
    title: program.title,
  });
  assert.equal(
    scriptIssues(adjustedScript.script, planExercises(adjusted)).length,
    0,
  );
});
