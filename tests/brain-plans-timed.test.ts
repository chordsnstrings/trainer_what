// Trainer Brain plans after the September 2026 model trial (work package
// core/fix-plans, F3): time and distance prescriptions, their progression and
// rest rules, the voice session for timed rounds, neutral wording for plan
// summaries withheld for health language, pregnancy position cautions, the
// no-increase gate after a harder or missed week, and short evidence
// references in the plan and adaptation prompts. The trial's own replies and
// profiles are the regression fixtures (brain-full/results-*.json,
// calls-seed.jsonl). No database and no real model.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adaptationDirectionIssues,
  adaptationProposalSchema,
  applyAdaptation,
  expandPlan,
  neutralPlanText,
  planDraftSchema,
  planExerciseSchema,
  planLibrary,
  planPromptVersion,
  planAdaptationPromptVersion,
  planTextIssues,
  planValidatorVersion,
  positionCautions,
  pregnancyWeek,
  progressionHolds,
  sessionMinutes,
  validateAdaptedWeek,
  validatePlan,
  type ExpandedExercise,
  type PlanBounds,
  type PlanDraft,
} from "../packages/domain/src/brain-plans.ts";
import {
  formatDistance,
  formatDuration,
  prescriptionText,
  spokenDistance,
  spokenDuration,
  workText,
} from "../packages/domain/src/prescription.ts";
import {
  buildSessionScript,
  planExercises,
  scriptIssues,
  sharedClips,
  spokenLines,
} from "../packages/domain/src/voice-session.ts";
import {
  initialRunnerState,
  runnerStatus,
  stepRunner,
  type RunnerEffect,
} from "../packages/domain/src/voice-runner.ts";
import {
  generateTrainingPlan,
  namesIdentifier,
  planAdaptationSystem,
  planGenerationSystem,
  planPromptRefs,
  proposePlanAdaptation,
  retrievePlanMaterial,
  unwrapReply,
} from "../packages/providers/src/brain-plans.ts";
import { promptRefsInstruction } from "../packages/providers/src/prompt-refs.ts";
import { withRuntimeConfig } from "../packages/providers/src/configuration.ts";
import { revisedExercise } from "../apps/api/src/training-programs.ts";
import { planAdaptation } from "./e2e/mocks/model-rules.ts";

// ---------------------------------------------------------------------------
// The trial's endurance coach (T3): library, bounds and a member profile.

const T3_LIBRARY: Array<[string, string[], number, string[], string]> = [
  [
    "Brisk Walk",
    ["bodyweight"],
    0,
    ["Treadmill Incline Walk"],
    "Fast enough to breathe harder, still able to talk.",
  ],
  [
    "Easy Run",
    ["bodyweight"],
    0,
    ["Brisk Walk", "Stationary Bike Easy"],
    "Conversational pace, short relaxed strides.",
  ],
  [
    "Run Intervals",
    ["bodyweight"],
    0,
    ["Bike Intervals"],
    "Hard but controlled efforts, walk the recoveries.",
  ],
  [
    "Tempo Run",
    ["bodyweight"],
    0,
    ["Easy Run"],
    "Comfortably hard, steady breathing.",
  ],
  [
    "Bike Intervals",
    ["stationary bike"],
    0,
    ["Run Intervals"],
    "30 seconds hard, 90 seconds easy.",
  ],
  [
    "Stationary Bike Easy",
    ["stationary bike"],
    0,
    ["Brisk Walk"],
    "Easy spin, conversational effort.",
  ],
  [
    "Rowing Intervals",
    ["rowing machine"],
    0,
    ["Bike Intervals"],
    "Legs, then body, then arms.",
  ],
  [
    "Treadmill Incline Walk",
    ["treadmill"],
    0,
    ["Brisk Walk"],
    "Brisk pace, hands off the rails.",
  ],
  [
    "Jump Rope",
    ["jump rope"],
    0,
    ["Low-Impact Step Jacks"],
    "Small hops, light on the feet.",
  ],
  [
    "Low-Impact Step Jacks",
    ["bodyweight"],
    0,
    [],
    "Step out and in, arms overhead.",
  ],
  [
    "Goblet Squat",
    ["dumbbells"],
    12,
    ["Bodyweight Squat"],
    "Elbows inside the knees, chest tall.",
  ],
  ["Bodyweight Squat", ["bodyweight"], 0, [], "Knees follow the toes."],
  ["Push-Up", ["bodyweight"], 0, [], "Body in one line, chest to the floor."],
  [
    "One-Arm Dumbbell Row",
    ["dumbbells"],
    14,
    ["Resistance Band Row"],
    "Pull the elbow to the hip.",
  ],
  [
    "Resistance Band Row",
    ["resistance band"],
    0,
    [],
    "Squeeze the shoulder blades.",
  ],
  [
    "Glute Bridge",
    ["bodyweight"],
    0,
    [],
    "Drive through the heels, pause at the top.",
  ],
  ["Plank", ["bodyweight"], 0, ["Dead Bug"], "Ribs down, squeeze the glutes."],
  ["Dead Bug", ["bodyweight"], 0, ["Plank"], "Low back stays on the floor."],
  [
    "Side-Lying Clamshell",
    ["resistance band"],
    0,
    [],
    "Heels together, open the knee slowly.",
  ],
  [
    "Sit-to-Stand from Chair",
    ["chair"],
    0,
    [],
    "Feet flat, stand tall, sit back slowly.",
  ],
  [
    "Dumbbell Floor Press",
    ["dumbbells"],
    6,
    [],
    "Elbows at 45 degrees, exhale as you press.",
  ],
  [
    "Incline Dumbbell Press",
    ["dumbbells", "bench"],
    6,
    [],
    "Exhale as you press.",
  ],
];
const library = planLibrary(
  T3_LIBRARY.map(([name, equipment, loadKg, alternatives, cue], i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    data: {
      name,
      equipment,
      ...(loadKg > 0 ? { loadKg } : {}),
      alternatives,
      cue,
    },
  })),
  [],
);
const T3_BOUNDS: PlanBounds = {
  maxWeeklyVolumeIncreasePct: 10,
  maxLoadJumpPct: 10,
  maxSessionMinutes: 60,
  minRestSeconds: 30,
  maxRestSeconds: 150,
  startLoadCapKg: { beginner: 12, intermediate: 20, advanced: 30 },
};
// T3S01: "Lose 15 kg of fat and run my first 5 km."
const T3S01 = {
  experience: "beginner" as const,
  daysPerWeek: 3,
  equipment: "Outdoor running, dumbbells, jump rope",
};
const ctx = { profile: T3S01, library, bounds: T3_BOUNDS, programmeDays: 28 };
const weeks = (factors: number[], deload = 4) =>
  factors.map((f, i) => ({
    week: i + 1,
    focus: i + 1 === deload ? "Recovery week" : "Build the running habit",
    volumeFactor: f,
    loadFactor: i + 1 === deload ? 0.9 : 1,
    rirDelta: i + 1 === deload ? 1 : 0,
    deload: i + 1 === deload,
  }));
const ex = (name: string, extra: Record<string, unknown>) => ({
  name,
  sets: 1,
  loadKg: 0,
  rir: 3,
  restSeconds: 0,
  cue: "",
  alternatives: [] as string[],
  ...extra,
});
/** The trial's T3S01 plan (Seed 2.0 Pro), written the way the v3 contract asks. */
const runWalkPlan = (factors = [1, 1.1, 1.15, 0.7]): PlanDraft =>
  planDraftSchema.parse({
    title: "4 Week Beginner Fat Loss and First 5 km Plan",
    summary:
      "Three sessions a week: run-walk intervals, a strength circuit and a steady endurance day, with a lighter fourth week.",
    sessions: [
      {
        key: "A",
        label: "Run-walk intervals",
        weekday: 1,
        exercises: [
          ex("Brisk Walk", { durationSeconds: 600, effort: "easy" }),
          ex("Run Intervals", {
            sets: 6,
            durationSeconds: 60,
            restSeconds: 90,
            rir: 2,
            effort: "hard",
          }),
        ],
      },
      {
        key: "B",
        label: "Full body strength circuit",
        weekday: 3,
        exercises: [
          ex("Goblet Squat", {
            sets: 3,
            reps: 12,
            loadKg: 10,
            rir: 2,
            restSeconds: 60,
          }),
          ex("Push-Up", { sets: 3, reps: 8, rir: 2, restSeconds: 60 }),
          ex("Plank", {
            sets: 3,
            durationSeconds: 30,
            rir: 2,
            restSeconds: 45,
            alternatives: ["Dead Bug"],
          }),
          ex("Jump Rope", {
            sets: 3,
            durationSeconds: 60,
            rir: 2,
            restSeconds: 60,
            alternatives: ["Low-Impact Step Jacks"],
          }),
        ],
      },
      {
        key: "C",
        label: "Steady endurance",
        weekday: 5,
        exercises: [
          ex("Brisk Walk", { durationSeconds: 300 }),
          ex("Easy Run", { durationSeconds: 1200, paceSecondsPerKm: 450 }),
        ],
      },
    ],
    weeks: weeks(factors),
    selfConfidence: 0.8,
    uncertainties: [],
    evidenceIds: [],
  });

// ---------------------------------------------------------------------------
// Schema

test("versions changed with the contract: plan prompt v3, adaptation prompt v2, validator v3", () => {
  assert.equal(planPromptVersion, "brain-plan-v3");
  assert.equal(planAdaptationPromptVersion, "brain-plan-adapt-v2");
  assert.equal(planValidatorVersion, "brain-plan-validator-v3");
});

test("an exercise is prescribed by exactly one of reps, a duration or a distance; rest 0 only for one continuous bout", () => {
  const ok = (e: Record<string, unknown>) =>
    planExerciseSchema.safeParse(ex("Easy Run", e)).success;
  // Timed, distance and interval work the old schema could not express.
  assert.ok(
    ok({ durationSeconds: 1200 }),
    "a 20-minute continuous run with no rest",
  );
  assert.ok(
    ok({ sets: 6, durationSeconds: 60, restSeconds: 90, effort: "hard" }),
    "intervals: rounds with recoveries",
  );
  assert.ok(
    ok({
      sets: 4,
      distanceMeters: 500,
      restSeconds: 120,
      paceSecondsPerKm: 300,
    }),
    "distance rounds with a pace",
  );
  assert.ok(
    ok({ distanceMeters: 3000, effort: "easy" }),
    "one continuous distance bout",
  );
  assert.ok(
    ok({ sets: 3, reps: 10, restSeconds: 60 }),
    "rep work is unchanged",
  );
  const issues = (e: Record<string, unknown>) =>
    (planExerciseSchema.safeParse(ex("Easy Run", e)).error?.issues ?? []).map(
      (i) => `${i.path.join(".")}: ${i.message}`,
    );
  assert.match(
    issues({ reps: 10, durationSeconds: 60, restSeconds: 60 }).join(),
    /exactly one of reps, durationSeconds or distanceMeters/,
  );
  assert.match(issues({ restSeconds: 60 }).join(), /exactly one of/);
  assert.match(
    issues({ sets: 6, durationSeconds: 60, restSeconds: 0 }).join(),
    /restSeconds: Rest must be at least 15 seconds/,
    "intervals need recoveries",
  );
  assert.match(
    issues({ sets: 3, reps: 10, restSeconds: 0 }).join(),
    /restSeconds/,
    "rep work still needs rest",
  );
  assert.match(
    issues({ reps: 10, restSeconds: 60, paceSecondsPerKm: 300 }).join(),
    /A pace needs/,
  );
  assert.match(
    issues({ durationSeconds: 3, restSeconds: 0 }).join(),
    /durationSeconds/,
  );
  assert.match(issues({ durationSeconds: 60, effort: "max" }).join(), /effort/);
});

test("trial regressions: the replies that failed on reps 0, reps above 30 and rest 0 fail as written, and pass once written as time", () => {
  // Seed 2.0 Pro, T2S04/plan: "sessions.3.exercises.2.reps Too small".
  const sidePlank = {
    name: "Side Plank from Knees",
    sets: 2,
    reps: 0,
    loadKg: 0,
    rir: 3,
    restSeconds: 45,
    cue: "Hips high, breathe steadily.",
    alternatives: ["Bird Dog"],
  };
  // T3S02/plan: minutes and seconds put into reps.
  const easyRun = {
    name: "Easy Run",
    sets: 1,
    reps: 28,
    loadKg: 0,
    rir: 3,
    restSeconds: 0,
    cue: "Conversational pace, short relaxed strides.",
    alternatives: ["Brisk Walk"],
  };
  const plank = {
    name: "Plank",
    sets: 3,
    reps: 45,
    loadKg: 0,
    rir: 2,
    restSeconds: 45,
    cue: "Ribs down, glutes squeezed, no sagging hips.",
    alternatives: ["Dead Bug"],
  };
  // T3S01/plan: a walk as one rep with no rest.
  const walk = {
    name: "Brisk Walk",
    sets: 1,
    reps: 1,
    loadKg: 0,
    rir: 3,
    restSeconds: 0,
    cue: "Warm up pace, loosen legs and breathing.",
    alternatives: ["Treadmill Incline Walk"],
  };
  for (const [e, path] of [
    [sidePlank, "reps"],
    [easyRun, "restSeconds"],
    [plank, "reps"],
    [walk, "restSeconds"],
  ] as const)
    assert.ok(
      planExerciseSchema
        .safeParse(e)
        .error?.issues.some((i) => i.path[0] === path),
      `${e.name} as written still fails on ${path}`,
    );
  const { reps: _a, ...plankTimed } = plank;
  const { reps: _b, ...runTimed } = easyRun;
  const { reps: _c, ...walkTimed } = walk;
  const { reps: _d, ...sideTimed } = sidePlank;
  for (const e of [
    { ...plankTimed, durationSeconds: 45 },
    { ...runTimed, durationSeconds: 28 * 60 },
    { ...walkTimed, durationSeconds: 600 },
    { ...sideTimed, durationSeconds: 20 },
  ])
    assert.ok(planExerciseSchema.safeParse(e).success, e.name);
});

// ---------------------------------------------------------------------------
// Expansion, validation and progression

test("the endurance coach's run-walk plan validates: timed work is scaled per round, session length counts time and pace", () => {
  const plan = runWalkPlan();
  const v = validatePlan(plan, ctx);
  assert.deepEqual(v.errors, []);
  // Rep sets per week: goblet squat and push-up only (3 + 3); timed work in minutes.
  assert.deepEqual(v.metrics.weeklyVolume, [6, 6, 6, 4]);
  assert.deepEqual(v.metrics.weeklyWorkMinutes, [45.5, 50, 52.5, 31.5]);
  assert.deepEqual(v.metrics.weeklyDistanceMeters, [0, 0, 0, 0]);
  const [w1, w2, , w4] = expandPlan(plan);
  const intervals = (w: typeof w1) => w.sessions[0].exercises[1];
  // Rounds stay; each round's work scales (to 5 s); rest is unchanged.
  assert.deepEqual(
    [
      intervals(w1).sets,
      intervals(w1).durationSeconds,
      intervals(w1).restSeconds,
    ],
    [6, 60, 90],
  );
  assert.deepEqual(
    [intervals(w2).sets, intervals(w2).durationSeconds],
    [6, 65],
  );
  assert.deepEqual(
    [intervals(w4).sets, intervals(w4).durationSeconds],
    [6, 40],
  );
  assert.equal(
    w2.sessions[2].exercises[1].durationSeconds,
    1320,
    "a 20-minute run becomes 22 minutes",
  );
  assert.equal(w1.sessions[2].exercises[1].paceSecondsPerKm, 450);
  // 8 + (1 + 5) + (1 + 20) = 35 minutes for walk and run.
  assert.equal(sessionMinutes(w1.sessions[2].exercises), 35);
  // Distance work is timed at its pace, or 10 min/km without one.
  assert.equal(
    sessionMinutes([
      { ...ex("Easy Run", { distanceMeters: 3000 }), alternatives: [] },
    ] as ExpandedExercise[]),
    8 + 1 + 30,
  );
  assert.equal(
    sessionMinutes([
      {
        ...ex("Easy Run", { distanceMeters: 3000, paceSecondsPerKm: 360 }),
        alternatives: [],
      },
    ] as ExpandedExercise[]),
    8 + 1 + 18,
  );
});

test("timed and distance work progress by at most the weekly limit, in total and per exercise", () => {
  // Week 2 at +30% breaks the trainer's 10% limit for timed work.
  const fast = validatePlan(runWalkPlan([1, 1.3, 1.3, 0.7]), ctx);
  assert.ok(
    fast.errors.some((e) =>
      /^Week 2: weekly timed work rises from 45 min 30 s to 59 min 30 s \(limit \+10%\)$/.test(
        e,
      ),
    ),
    fast.errors.join("\n"),
  );
  assert.ok(
    fast.errors.some((e) =>
      /^Week 2: Easy Run rises from 20 min to 26 min \(limit \+10%\)$/.test(e),
    ),
    fast.errors.join("\n"),
  );
  // One exercise jumping while the week's total stays flat is still caught.
  const plan = runWalkPlan([1, 1, 1, 0.7]);
  const jump = structuredClone(plan);
  jump.sessions[2].exercises[1].durationSeconds = 1200;
  const v = validatePlan(jump, {
    ...ctx,
    previousWeek: expandPlan(plan)[0].sessions.map((s) => ({
      key: s.key,
      exercises: s.exercises.map((e) =>
        e.name === "Easy Run" ? { ...e, durationSeconds: 900 } : e,
      ),
    })),
  });
  assert.ok(
    v.errors.some((e) =>
      /^Week 1: Easy Run rises from 15 min to 20 min/.test(e),
    ),
    v.errors.join("\n"),
  );
  // Distance: 3 km to 4 km in a week is refused, 3 km to 3.3 km is not.
  const km = (m: number) => [
    {
      key: "A",
      exercises: [
        {
          ...ex("Easy Run", { distanceMeters: m }),
          alternatives: [],
        } as ExpandedExercise,
      ],
    },
  ];
  const rise = validateAdaptedWeek(km(3000), km(4000), ctx);
  assert.ok(
    rise.errors.some(
      (e) =>
        e === "Next week: weekly distance rises from 3 km to 4 km (limit +10%)",
    ),
    rise.errors.join("\n"),
  );
  assert.deepEqual(validateAdaptedWeek(km(3000), km(3300), ctx).errors, []);
  // A small base may always rise by 30 s (like the one set rep work may add).
  const hold = (s: number) => [
    {
      key: "B",
      exercises: [
        {
          ...ex("Plank", { sets: 3, durationSeconds: s, restSeconds: 45 }),
          alternatives: [],
        } as ExpandedExercise,
      ],
    },
  ];
  assert.deepEqual(validateAdaptedWeek(hold(30), hold(40), ctx).errors, []);
  assert.ok(validateAdaptedWeek(hold(30), hold(45), ctx).errors.length > 0);
});

test("rest follows the trainer's bounds; only one continuous bout may have none", () => {
  const week = (e: Record<string, unknown>) => [
    {
      key: "A",
      exercises: [
        { ...ex("Easy Run", e), alternatives: [] } as ExpandedExercise,
      ],
    },
  ];
  assert.deepEqual(
    validateAdaptedWeek(
      [],
      week({ durationSeconds: 1200, restSeconds: 0 }),
      ctx,
    ).errors,
    [],
  );
  assert.deepEqual(
    validateAdaptedWeek(
      [],
      week({ sets: 6, durationSeconds: 60, restSeconds: 90 }),
      ctx,
    ).errors,
    [],
  );
  assert.ok(
    validateAdaptedWeek(
      [],
      week({ sets: 6, durationSeconds: 60, restSeconds: 0 }),
      ctx,
    ).errors.some((e) => /rest 0s is outside 30-150s/.test(e)),
  );
  assert.ok(
    validateAdaptedWeek(
      [],
      week({ sets: 6, durationSeconds: 60, restSeconds: 20 }),
      ctx,
    ).errors.some((e) => /rest 20s is outside/.test(e)),
  );
  assert.ok(
    validateAdaptedWeek(
      [],
      week({ sets: 3, reps: 10, restSeconds: 0 }),
      ctx,
    ).errors.some((e) => /rest 0s/.test(e)),
  );
  assert.ok(
    validateAdaptedWeek(
      [],
      week({ reps: 10, durationSeconds: 60, restSeconds: 60 }),
      ctx,
    ).errors.some((e) =>
      /needs exactly one of reps, a duration or a distance/.test(e),
    ),
  );
});

test("an adjustment keeps each exercise's measure and may change a round's duration or distance", () => {
  const next = [
    {
      plannedSessionId: "p1",
      sessionKey: "A",
      exercises: [
        {
          ...ex("Run Intervals", {
            sets: 6,
            durationSeconds: 60,
            restSeconds: 90,
            alternatives: ["Bike Intervals"],
          }),
        } as ExpandedExercise,
        {
          ...ex("Goblet Squat", {
            sets: 3,
            reps: 12,
            loadKg: 10,
            restSeconds: 60,
          }),
        } as ExpandedExercise,
      ],
    },
  ];
  const ok = applyAdaptation(next, [
    {
      sessionKey: "A",
      exercise: "Run Intervals",
      durationSeconds: 55,
      effort: "moderate",
    },
    { sessionKey: "A", exercise: "Goblet Squat", reps: 10 },
  ]);
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(
    [
      ok.sessions[0].exercises[0].durationSeconds,
      ok.sessions[0].exercises[0].effort,
      ok.sessions[0].exercises[1].reps,
    ],
    [55, "moderate", 10],
  );
  const wrong = applyAdaptation(next, [
    { sessionKey: "A", exercise: "Run Intervals", reps: 8 },
    { sessionKey: "A", exercise: "Goblet Squat", durationSeconds: 60 },
  ]);
  assert.deepEqual(wrong.errors, [
    "Run Intervals is prescribed by time; the adjustment cannot change reps",
    "Goblet Squat is prescribed by repetitions; the adjustment cannot change durationSeconds",
  ]);
  // A swap keeps the round: bike intervals for run intervals.
  const swap = applyAdaptation(next, [
    {
      sessionKey: "A",
      exercise: "Run Intervals",
      replaceWith: "Bike Intervals",
    },
  ]);
  assert.deepEqual(
    [
      swap.sessions[0].exercises[0].name,
      swap.sessions[0].exercises[0].durationSeconds,
    ],
    ["Bike Intervals", 60],
  );
  // The adaptation schema accepts the new fields and rest 0.
  assert.ok(
    adaptationProposalSchema.safeParse({
      changes: [
        {
          sessionKey: "C",
          exercise: "Easy Run",
          durationSeconds: 1320,
          restSeconds: 0,
        },
      ],
      reason: "r",
      selfConfidence: 0.7,
    }).success,
  );
});

test("a trainer's revision keeps one measure: a load or reps change leaves a run's time alone, a substitution brings its own", () => {
  const run = {
    name: "Run Intervals",
    sets: 6,
    durationSeconds: 60,
    restSeconds: 90,
    loadKg: 0,
    rir: 2,
    effort: "hard",
    cue: "",
  };
  assert.deepEqual(revisedExercise(run, { loadKg: 0, reps: 10, rir: 3 }), {
    ...run,
    loadKg: 0,
    rir: 3,
  });
  // The trial coach's "tired legs" action: easy running instead of intervals.
  const easy = {
    name: "Easy Run",
    sets: 1,
    reps: 1,
    restSeconds: 60,
    loadKg: 0,
    rir: 4,
    cue: "20 minutes at a conversational pace.",
  };
  const swapped = revisedExercise(run, easy);
  assert.equal(swapped.durationSeconds, undefined);
  assert.equal(swapped.effort, undefined);
  assert.deepEqual([swapped.name, swapped.reps], ["Easy Run", 1]);
  const squat = {
    name: "Goblet Squat",
    sets: 3,
    reps: 12,
    restSeconds: 60,
    loadKg: 10,
    rir: 2,
  };
  assert.deepEqual(revisedExercise(squat, { loadKg: 12, reps: 10, rir: 2 }), {
    ...squat,
    loadKg: 12,
    reps: 10,
  });
});

// ---------------------------------------------------------------------------
// No increases after a harder or missed week

const t1Week = [
  {
    plannedSessionId: "a",
    sessionKey: "A",
    exercises: (
      [
        ["Back Squat", 60],
        ["Bench Press", 50],
        ["Barbell Row", 40],
        ["Overhead Press", 30],
        ["Leg Press", 80],
      ] as const
    ).map(([name, loadKg]) => ({
      name,
      sets: 3,
      reps: 8,
      loadKg,
      rir: 2,
      restSeconds: 120,
      cue: "",
      alternatives: [],
    })),
  },
];
const outcomes = (adherence: number, rirDelta: number, week = t1Week) => ({
  adherence,
  loggedSets: Math.round(
    week.flatMap((s) => s.exercises).reduce((n, e) => n + e.sets, 0) *
      adherence,
  ),
  exercises: week
    .flatMap((s) => s.exercises)
    .map((e) => ({
      exercise: e.name,
      prescribed: { sets: e.sets, reps: e.reps, loadKg: e.loadKg, rir: e.rir },
      logged: {
        sets: Math.round(e.sets * adherence),
        averageRir: adherence > 0 ? Math.max(0, e.rir + rirDelta) : null,
      },
    })),
});

test("trial regression T1S07 (Seed 2.0 Pro): fifteen load increases after a harder-than-planned week are an error, not an automatic delivery", () => {
  // The member logged RIR 1 against a prescribed RIR 2; the model read that as spare capacity.
  const holds = progressionHolds(outcomes(1, -1));
  assert.deepEqual(holds, [
    "the week was harder than planned (Back Squat, Bench Press, Barbell Row, Overhead Press, Leg Press logged fewer reps in reserve than prescribed)",
  ]);
  const seed = {
    changes: [
      ["Back Squat", 62.5],
      ["Bench Press", 52.5],
      ["Barbell Row", 42.5],
      ["Overhead Press", 31.5],
      ["Leg Press", 82.5],
    ].map(([exercise, loadKg]) => ({
      sessionKey: "A",
      exercise: exercise as string,
      loadKg: loadKg as number,
    })),
  };
  const applied = applyAdaptation(t1Week, seed.changes);
  const issues = adaptationDirectionIssues(t1Week, applied.sessions, holds);
  assert.equal(issues.length, 1);
  assert.match(
    issues[0],
    /^Next week raises Back Squat \(session A: loadKg\); Bench Press \(session A: loadKg\);.* although the week was harder than planned/,
  );
  // Holding, or making the week easier, is fine.
  const easier = applyAdaptation(t1Week, [
    { sessionKey: "A", exercise: "Back Squat", loadKg: 57.5 },
  ]);
  assert.deepEqual(
    adaptationDirectionIssues(t1Week, easier.sessions, holds),
    [],
  );
});

test("trial regressions T1S04, T1S08, T3S01, T3S05: missed sessions or harder work hold progression; T1S01 (a full, easier week) may progress", () => {
  assert.deepEqual(progressionHolds(outcomes(0.67, 0)), [
    "sessions were missed this week",
  ]);
  assert.equal(progressionHolds(outcomes(0.5, -2)).length, 2);
  assert.deepEqual(progressionHolds(outcomes(0.33, 0)), [
    "sessions were missed this week",
  ]);
  assert.equal(progressionHolds(outcomes(0.75, -1)).length, 2);
  assert.deepEqual(progressionHolds(outcomes(0, 0)), [
    "nothing was logged this week",
  ]);
  assert.deepEqual(progressionHolds(outcomes(1, 1)), []);
  assert.deepEqual(progressionHolds(outcomes(1, 0)), []);
  const up = applyAdaptation(t1Week, [
    { sessionKey: "A", exercise: "Back Squat", loadKg: 62.5 },
  ]);
  assert.deepEqual(
    adaptationDirectionIssues(
      t1Week,
      up.sessions,
      progressionHolds(outcomes(1, 1)),
    ),
    [],
  );
  // A longer round is an increase too.
  const run = [
    {
      plannedSessionId: "r",
      sessionKey: "A",
      exercises: [
        {
          ...ex("Easy Run", { durationSeconds: 1200 }),
          alternatives: [],
        } as ExpandedExercise,
      ],
    },
  ];
  const longer = applyAdaptation(run, [
    { sessionKey: "A", exercise: "Easy Run", durationSeconds: 1320 },
  ]);
  assert.match(
    adaptationDirectionIssues(run, longer.sessions, [
      "sessions were missed this week",
    ])[0],
    /Easy Run \(session A: durationSeconds\)/,
  );
  // The e2e model double follows the same rule.
  assert.deepEqual(
    planAdaptation({
      outcomes: outcomes(1, 0),
      nextWeek: t1Week,
      progressionHold: ["sessions were missed this week"],
      material: { rules: [] },
    }).changes,
    [],
  );
});

// ---------------------------------------------------------------------------
// Member-facing wording and pregnancy positions

/** The five plans Claude Opus 5.5 and Sonnet 5 lost to the summary screen. */
const withheld = [
  [
    "T1S05/opus",
    "Draft for Karim to review before release. The intake lists high blood pressure and medication, and Karim's material says medical conditions in the intake go to him. The draft follows his beginner structure: 3 full-body sessions on non-consecutive days.",
  ],
  [
    "T1S06/sonnet",
    "Four-day upper/lower muscle-building draft. In line with the member's note that pressing below shoulder height is fine, upper-body work stays below shoulder height. This is not treatment for the shoulder.",
  ],
  [
    "T2S01/opus",
    "Three gentle home sessions following Layla's pregnancy approach. Stop and contact Layla and your midwife or doctor if you notice bleeding, spotting, fluid loss, dizziness, pain or reduced baby movement.",
  ],
  [
    "T2S02/opus",
    "A calm, home-based 4-week return to strength. If you notice any leaking, heaviness or pain, stop and tell your trainer, who will refer you to a pelvic health physiotherapist.",
  ],
  [
    "T2S06/sonnet",
    "Three gentle full-body home sessions per week. This plan gives no blood sugar, medication or diet advice; the trainer will coordinate with the member's doctor before release.",
  ],
] as const;

test("trial regressions: a summary withheld for health language is replaced by neutral wording from the plan instead of losing the plan", () => {
  for (const [scenario, summary] of withheld) {
    const draft = { ...runWalkPlan(), summary };
    assert.ok(
      planTextIssues(draft, library).some((i) =>
        /^Summary cannot be shown to the subscriber \(medical\)$/.test(
          i.message,
        ),
      ),
      scenario,
    );
    const neutral = neutralPlanText(draft);
    assert.deepEqual(
      neutral.replaced,
      [{ field: "summary", text: summary }],
      scenario,
    );
    assert.equal(
      neutral.draft.summary,
      "3 sessions a week for 4 weeks (Monday, Wednesday and Friday): Run-walk intervals, Full body strength circuit and Steady endurance. Week 4 is a lighter week.",
    );
    assert.deepEqual(planTextIssues(neutral.draft, library), [], scenario);
    assert.deepEqual(validatePlan(neutral.draft, ctx).errors, [], scenario);
  }
  // Title, labels and week focus with health words get neutral wording too.
  const all = neutralPlanText({
    ...runWalkPlan(),
    title: "Rehab plan for your knee",
    sessions: runWalkPlan().sessions.map((s, i) =>
      i === 0 ? { ...s, label: "Physio circuit" } : s,
    ),
    weeks: runWalkPlan().weeks.map((w) =>
      w.week === 4 ? { ...w, focus: "Symptom check week" } : w,
    ),
  });
  assert.deepEqual(
    all.replaced.map((r) => r.field),
    ["sessions.A.label", "weeks.4.focus", "title"],
  );
  assert.deepEqual(
    [all.draft.title, all.draft.sessions[0].label, all.draft.weeks[3].focus],
    ["4-week training plan", "Session A", "Lighter week"],
  );
  // Anything other than health language stays a screen error: links, contact details, approval claims, guarantees.
  for (const summary of [
    "Book at https://example.test",
    "Approved by your trainer, no need to check",
    "Call 050 123 4567",
    "Results guaranteed",
  ]) {
    const kept = neutralPlanText({ ...runWalkPlan(), summary });
    assert.deepEqual(kept.replaced, [], summary);
    assert.ok(planTextIssues(kept.draft, library).length > 0, summary);
  }
});

test("trial regression T2S01: a pregnant member past the first trimester gets a position caution for lying exercises", () => {
  const limitations =
    "Pregnant, 22 weeks, uncomplicated; obstetrician cleared exercise.";
  assert.equal(pregnancyWeek(limitations), 22);
  assert.equal(pregnancyWeek("second trimester"), 14);
  assert.equal(pregnancyWeek("Pregnant, first trimester"), 1);
  assert.equal(pregnancyWeek("Pregnant"), null);
  const sessions = [
    {
      exercises: [
        { name: "Sit-to-Stand from Chair" },
        { name: "Glute Bridge" },
        { name: "Dead Bug" },
        { name: "Side-Lying Clamshell" },
        { name: "Incline Dumbbell Press" },
        { name: "Dumbbell Floor Press" },
      ],
    },
  ];
  assert.deepEqual(positionCautions({ limitations }, sessions), [
    "Pregnancy after the first trimester: Glute Bridge, Dead Bug, Dumbbell Floor Press are usually done lying on the back or front; check the position or swap them",
  ]);
  assert.deepEqual(
    positionCautions({ limitations: "Pregnant, 10 weeks" }, sessions),
    [],
  );
  assert.equal(
    positionCautions({ limitations: "Pregnant" }, sessions).length,
    1,
    "an unknown stage is cautioned",
  );
  assert.deepEqual(
    positionCautions({ limitations: "Postpartum 10 weeks" }, sessions),
    [],
  );
  assert.deepEqual(positionCautions({ limitations: "None" }, sessions), []);
  // In the validator it is a warning (the safety floor already sends the plan to the trainer).
  const draft = runWalkPlan();
  draft.sessions[1].exercises.push({
    ...ex("Glute Bridge", { sets: 2, reps: 10, restSeconds: 60 }),
  } as any);
  const v = validatePlan(draft, {
    ...ctx,
    profile: {
      ...T3S01,
      limitations,
      goal: "Stay strong through my pregnancy",
    },
  });
  assert.deepEqual(v.errors, []);
  assert.ok(
    v.warnings.some((w) =>
      /^Pregnancy after the first trimester: Glute Bridge is usually done lying/.test(
        w,
      ),
    ),
  );
});

// ---------------------------------------------------------------------------
// Wording on screens and in the voice session

test("every screen words a prescription the same way", () => {
  assert.equal(formatDuration(45), "45 s");
  assert.equal(formatDuration(90), "1 min 30 s");
  assert.equal(formatDuration(3900), "1 h 5 min");
  assert.equal(formatDistance(400), "400 m");
  assert.equal(formatDistance(1500), "1.5 km");
  assert.equal(workText({ sets: 3, reps: 10 }), "3 × 10");
  assert.equal(workText({ sets: 1, durationSeconds: 1200 }), "20 min");
  assert.equal(workText({ sets: 6, durationSeconds: 60 }), "6 × 1 min");
  assert.equal(workText({ sets: 4, distanceMeters: 500 }), "4 × 500 m");
  assert.equal(
    prescriptionText({
      sets: 3,
      reps: 10,
      loadKg: 20,
      rir: 2,
      restSeconds: 90,
    }),
    "3 × 10 · 20 kg · RIR 2 · 1 min 30 s rest",
  );
  assert.equal(
    prescriptionText({
      sets: 6,
      durationSeconds: 60,
      effort: "hard",
      restSeconds: 90,
      rir: 1,
    }),
    "6 × 1 min · hard · 1 min 30 s rest",
  );
  assert.equal(
    prescriptionText({
      sets: 1,
      durationSeconds: 1200,
      effort: "easy",
      paceSecondsPerKm: 390,
      restSeconds: 0,
    }),
    "20 min · easy · 6:30 /km · continuous",
  );
  assert.equal(spokenDuration(90), "1 minute 30 seconds");
  assert.equal(spokenDistance(1500), "1.5 kilometres");
});

test("the voice session speaks timed and distance work in rounds and still validates against the plan", () => {
  const plan = planExercises({
    exercises: [
      {
        name: "Brisk Walk",
        sets: 1,
        durationSeconds: 300,
        restSeconds: 0,
        loadKg: 0,
        rir: 3,
        effort: "easy",
      },
      {
        name: "Run Intervals",
        sets: 3,
        durationSeconds: 30,
        restSeconds: 60,
        loadKg: 0,
        rir: 1,
        effort: "hard",
      },
      {
        name: "Row",
        sets: 2,
        distanceMeters: 500,
        restSeconds: 60,
        loadKg: 0,
        rir: 2,
      },
      {
        name: "Goblet Squat",
        sets: 2,
        reps: 10,
        restSeconds: 60,
        loadKg: 12,
        rir: 2,
      },
    ],
  });
  assert.deepEqual(
    plan.map((e) => [e.reps, e.durationSeconds, e.distanceMeters]),
    [
      [0, 300, undefined],
      [0, 30, undefined],
      [0, undefined, 500],
      [10, undefined, undefined],
    ],
  );
  const { script } = buildSessionScript({ title: "Run-walk", exercises: plan });
  assert.deepEqual(scriptIssues(script, plan), []);
  const text = (id: string) =>
    spokenLines(script).find((l) => l.id === id)?.text;
  assert.equal(
    text("ex:0:setup"),
    "Exercise 1 of 4: Brisk Walk. 5 minutes, easy effort.",
  );
  assert.equal(
    text("ex:0:set:1"),
    "5 minutes. The clock starts now. Say done if you stop early.",
  );
  assert.equal(
    text("ex:1:setup"),
    "Exercise 2 of 4: Run Intervals. 3 rounds of 30 seconds, hard effort.",
  );
  assert.equal(
    text("ex:1:set:2"),
    "Round 2 of 3. 30 seconds. The clock starts now. Say done if you stop early.",
  );
  assert.equal(text("ex:1:rest"), "Rest 1 minute.");
  assert.equal(
    text("ex:2:set:1"),
    "Round 1 of 2. 500 metres. Say done when you finish.",
  );
  assert.equal(
    text("ex:3:set:1"),
    "Set 1 of 2. 10 reps at 12 kilograms. Say done when you finish, or tell me how many reps you did.",
  );
  // The continuous walk has no rest prompts, and no audio is made for them.
  assert.equal(text("ex:0:rest"), undefined);
  // A changed duration is a changed prescription.
  assert.deepEqual(
    scriptIssues(
      script,
      plan.map((e, i) => (i === 1 ? { ...e, durationSeconds: 45 } : e)),
    ),
    ["prescription:1"],
  );
  assert.ok(
    sharedClips().some((c) => c.key === "time_up" && c.text === "Time."),
  );
  // Missing time: the plan cannot be voiced.
  assert.throws(
    () =>
      planExercises({
        exercises: [{ name: "Easy Run", sets: 1, restSeconds: 0 }],
      }),
    /missing its sets, reps, time or distance/,
  );
});

test("the runner times each round: the clock starts after the prompt, cues ten seconds and three-two-one, then logs the time and rests", () => {
  const plan = planExercises({
    exercises: [
      {
        name: "Run Intervals",
        sets: 2,
        durationSeconds: 30,
        restSeconds: 60,
        loadKg: 0,
        rir: 1,
      },
      {
        name: "Row",
        sets: 1,
        distanceMeters: 500,
        restSeconds: 60,
        loadKg: 0,
        rir: 2,
      },
    ],
  });
  const { script } = buildSessionScript({
    title: "Intervals",
    exercises: plan,
  });
  const ctx = { script, rules: script.rules };
  let s = initialRunnerState(script);
  const all: RunnerEffect[] = [];
  const step = (event: Parameters<typeof stepRunner>[2]) => {
    const [next, effects] = stepRunner(ctx, s, event);
    s = next;
    all.push(...effects);
    return effects;
  };
  step({ type: "start" });
  step({ type: "prompt_done" }); // intro -> warm-up
  step({ type: "command", command: { type: "done" } }); // warm-up -> setup
  step({ type: "prompt_done" }); // setup -> round 1 prompt
  assert.equal(s.phase, "set");
  step({ type: "tick", seconds: 5 });
  assert.equal(s.workLeft, null, "the clock waits for the round's prompt");
  step({ type: "prompt_done" });
  assert.equal(s.workLeft, 30);
  assert.equal(runnerStatus(ctx, s), "Run Intervals, round 1 of 2: 30 s left.");
  const cues = [
    ...step({ type: "tick", seconds: 20 }),
    ...step({ type: "tick", seconds: 7 }),
  ];
  assert.deepEqual(
    cues.map((c) => (c.type === "say" ? c.text : c.type)),
    ["Ten seconds.", "Three. Two. One."],
  );
  const end = step({ type: "tick", seconds: 3 });
  assert.equal(end[0].type === "say" && end[0].text, "Time.");
  const logged = end.find((e) => e.type === "log_set");
  assert.deepEqual(logged, {
    type: "log_set",
    exerciseIndex: 0,
    exercise: "Run Intervals",
    set: 1,
    reps: 0,
    loadKg: 0,
    durationSeconds: 30,
  });
  assert.equal(s.phase, "rest");
  step({ type: "tick", seconds: 60 }); // rest over -> round 2
  step({ type: "prompt_done" });
  step({ type: "tick", seconds: 12 });
  // Stopping early logs the time the round lasted.
  const early = step({ type: "command", command: { type: "done" } });
  assert.deepEqual(
    early.find((e) => e.type === "log_set"),
    {
      type: "log_set",
      exerciseIndex: 0,
      exercise: "Run Intervals",
      set: 2,
      reps: 0,
      loadKg: 0,
      durationSeconds: 12,
    },
  );
  assert.equal(s.phase, "rest");
  // Distance work waits for "done" (a number is not reps here) and logs the distance.
  step({ type: "tick", seconds: 60 }); // rest over -> the row's setup
  step({ type: "prompt_done" }); // setup -> the round prompt
  assert.equal(runnerStatus(ctx, s), "Row: 500 m.");
  const row = step({ type: "command", command: { type: "reps", reps: 12 } });
  assert.deepEqual(
    row.find((e) => e.type === "log_set"),
    {
      type: "log_set",
      exerciseIndex: 1,
      exercise: "Row",
      set: 1,
      reps: 0,
      loadKg: 0,
      distanceMeters: 500,
    },
  );
  assert.equal(s.phase, "cooldown");
});

test("a paused timed round resumes where its clock stopped", () => {
  const plan = planExercises({
    exercises: [
      {
        name: "Plank",
        sets: 1,
        durationSeconds: 40,
        restSeconds: 0,
        loadKg: 0,
        rir: 2,
      },
    ],
  });
  const { script } = buildSessionScript({ title: "Core", exercises: plan });
  const ctx = { script, rules: script.rules };
  let s = initialRunnerState(script);
  for (const event of [
    { type: "start" },
    { type: "prompt_done" },
    { type: "command", command: { type: "done" } },
    { type: "prompt_done" },
    { type: "prompt_done" },
    { type: "tick", seconds: 15 },
    { type: "command", command: { type: "pause" } },
    { type: "tick", seconds: 30 },
  ] as const)
    s = stepRunner(ctx, s, event as any)[0];
  assert.deepEqual([s.phase, s.workLeft], ["paused", 25]);
  const [resumed, effects] = stepRunner(ctx, s, {
    type: "command",
    command: { type: "resume" },
  });
  assert.deepEqual([resumed.phase, resumed.workLeft], ["set", 25]);
  assert.deepEqual(
    effects.map((e) => (e.type === "say" ? e.text : e.type)),
    ["Resuming.", "Go."],
  );
});

// ---------------------------------------------------------------------------
// Prompts: short references, the output contract and the safety wording

const RULE = "2432edf0-d62c-4eaf-91c5-f4aaf8f58d39";
const CASE = "03bd805e-116a-407f-b914-b18902927ffb";
const TEMPLATE = "df92c0e3-358b-4dde-9ce0-6535a0852d43";
const EXAMPLE = "3711bfdf-6248-4059-98e3-ea5557adb382";
const SNAPSHOT = "98e0b662-72a0-4e96-a2e2-1a8648139d91";
const material = () => {
  const retrieval = retrievePlanMaterial({
    tenantId: "t",
    segment: {
      goal: "endurance",
      experience: "beginner",
      daysPerWeek: 3,
      equipment: ["dumbbells"],
    },
    goal: "Run my first 5 km",
    rules: [
      {
        id: RULE,
        data: {
          title: "Running time",
          category: "progression",
          condition: "Endurance plans",
          directive: "Weekly running time goes up by 10% at most.",
          reason: "Joints adapt slowly",
          allowedUses: ["model_prompt"],
        },
      },
    ],
    cases: [
      {
        id: CASE,
        tenant_id: "t",
        kind: "coaching_teaching",
        status: "confirmed",
        data: {
          category: "program_build",
          scenario: "Beginner, 110 kg, first 5 km",
          recommendation: "Two walk-run sessions and one circuit",
          reason: "Joints adapt slower",
          alternatives: "Bike",
          changeWhen: "After 6 weeks",
          escalateWhen: "Joint pain",
          allowedUses: ["model_prompt", "trainer_specific_learning"],
        },
      },
    ],
    learning: [
      {
        id: EXAMPLE,
        tenant_id: "t",
        kind: "plan_learning",
        status: "confirmed",
        created_at: "2026-09-01",
        data: {
          type: "programme",
          decision: "approved",
          segment: {
            goal: "endurance",
            experience: "beginner",
            daysPerWeek: 3,
            equipment: ["dumbbells"],
          },
          allowedUses: ["model_prompt"],
        },
      },
    ],
    templates: [
      {
        id: TEMPLATE,
        data: {
          title: "Run + circuit",
          goal: "First 5 km",
          daysPerWeek: 3,
          weeks: 4,
          exercises: [],
          allowedUses: ["model_prompt"],
        },
      },
    ],
    library,
  });
  return retrieval;
};
const planInput = () => ({
  profile: {
    goal: "Lose 15 kg of fat and run my first 5 km.",
    ...T3S01,
    limitations: "None",
  },
  programme: { days: 28, weeks: 4, startDate: "2026-10-01" },
  bounds: T3_BOUNDS,
  twin: { snapshotId: SNAPSHOT, training: null, adherence: null },
  previous: null,
  material: material().material,
});
const config = {
  MODEL_BASE_URL: "https://plan-refs.invalid/v1",
  MODEL_API_KEY: "synthetic-key",
  MODEL_NAME: "plan-refs-fixture",
  MODEL_PRICE_VERSION: "fixture-v1",
  MODEL_INPUT_USD_PER_MILLION: "1",
  MODEL_OUTPUT_USD_PER_MILLION: "2",
};
const accounting = { reserve: async () => {}, record: async () => {} };
/** Calls the provider with a scripted reply; returns what the model was sent and the result. */
async function withReply<T>(
  reply: (sent: { system: string; user: any }) => unknown,
  call: () => Promise<T>,
) {
  const original = globalThis.fetch;
  const sent: Array<{ system: string; user: any; raw: string }> = [];
  globalThis.fetch = (async (_url: any, init: any) => {
    const body = JSON.parse(String(init?.body));
    const entry = {
      system: body.messages[0].content,
      raw: body.messages[1].content,
      user: JSON.parse(body.messages[1].content),
    };
    sent.push(entry);
    return Response.json({
      id: "fixture",
      usage: { prompt_tokens: 100, completion_tokens: 50 },
      choices: [{ message: { content: JSON.stringify(reply(entry)) } }],
    });
  }) as typeof fetch;
  try {
    const result = await withRuntimeConfig(config, call);
    return { result, sent: sent[0] };
  } finally {
    globalThis.fetch = original;
  }
}
const UUID_ANYWHERE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const planReply = (evidenceIds: string[], patch: Partial<PlanDraft> = {}) => ({
  ...runWalkPlan(),
  evidenceIds,
  ...patch,
});

test("the plan prompt is v3 with the timed-work contract, member wording, safety rules and short references; nothing sent carries a UUID", async () => {
  const system = planGenerationSystem(4);
  for (const phrase of [
    "Trainer Brain plan generator brain-plan-v3.",
    "exactly one measure: reps (1 to 30 per set)",
    "durationSeconds (per set) for timed work",
    "one continuous bout is sets 1 with restSeconds 0",
    "Never put a time or distance into reps and never use reps of 0",
    "total timed work, total distance and each exercise's work rise by at most bounds.maxWeeklyVolumeIncreasePct",
    "rirDelta is a whole number",
    "Leave out every exercise that the subscriber's limitations or the trainer's rules exclude",
    "pregnancy after the first trimester (from week 14, or when the stage is not stated), use no exercise done lying on the back or on the front",
    "never mention a diagnosis, medical condition, injury, medication, symptom, doctor, therapist, therapy or treatment",
    "Put notes for the trainer in uncertainties",
    promptRefsInstruction,
    "not wrapped in another object",
    "with exactly 4 rows",
    "the R, X, P or T references",
  ])
    assert.ok(system.includes(phrase), phrase);
  const { result, sent } = await withReply(
    () => planReply(["R1", "x1", " T1 ", "P1"]),
    () => generateTrainingPlan(planInput(), accounting),
  );
  assert.ok(!UUID_ANYWHERE.test(sent.raw), "no UUID reaches the model");
  assert.deepEqual(
    [
      sent.user.material.rules[0].id,
      sent.user.material.cases[0].id,
      sent.user.material.examples[0].id,
      sent.user.material.templates[0].id,
      sent.user.twin.snapshotId,
    ],
    ["R1", "X1", "P1", "T1", "ID1"],
  );
  assert.equal(sent.system, system);
  assert.deepEqual(result.errors, []);
  // References map back to the IDs the validator checks against the retrieval.
  assert.deepEqual(result.draft!.evidenceIds, [RULE, CASE, TEMPLATE, EXAMPLE]);
  const retrieval = material();
  assert.deepEqual(
    validatePlan(result.draft!, { ...ctx, evidenceIds: retrieval.evidenceIds })
      .errors,
    [],
  );
});

test("trial regressions T2S06, T3S03 and T2S02: a miscopied or one-character-off evidence ID is invalid output for the trainer, never matched to the nearest", async () => {
  for (const [scenario, copy, reason] of [
    ["T2S06/plan", "03bd05e-116a-407f-b914-b18902927ffb", "malformed uuid"],
    ["T3S03/plan", "df92c0e35-858b-4dde-9ce0-6535a0852d43", "malformed uuid"],
    ["T2S02/plan", "3711bfdf-6248-4059-98e3-ea5557adb38b", "unknown uuid"],
    ["unknown reference", "R9", "unknown ref"],
  ] as const) {
    const { result } = await withReply(
      () => planReply(["R1", copy]),
      () => generateTrainingPlan(planInput(), accounting),
    );
    assert.equal(result.draft, null, scenario);
    assert.equal(result.errors.length, 1, scenario);
    assert.match(
      result.errors[0],
      new RegExp(`^Model output: evidenceIds\\.1 ${reason} \\(`),
      scenario,
    );
  }
  // The full, correct UUID is still accepted.
  const { result } = await withReply(
    () => planReply([RULE]),
    () => generateTrainingPlan(planInput(), accounting),
  );
  assert.deepEqual(result.draft!.evidenceIds, [RULE]);
});

test("member wording that names an identifier is invalid output; trainer notes have their references expanded", async () => {
  const leaked = await withReply(
    () => planReply(["R1"], { summary: "Built on R1 and your template T1." }),
    () => generateTrainingPlan(planInput(), accounting),
  );
  assert.equal(leaked.result.draft, null);
  assert.deepEqual(leaked.result.errors, [
    "Model output: summary names an internal identifier",
  ]);
  const cue = await withReply(
    () =>
      planReply(["R1"], {
        sessions: runWalkPlan().sessions.map((s, i) =>
          i === 0
            ? {
                ...s,
                exercises: s.exercises.map((e, j) =>
                  j === 0 ? { ...e, cue: `See ${RULE}` } : e,
                ),
              }
            : s,
        ),
      }),
    () => generateTrainingPlan(planInput(), accounting),
  );
  assert.deepEqual(cue.result.errors, [
    "Model output: sessions.A.Brisk Walk.cue names an internal identifier",
  ]);
  const notes = await withReply(
    () =>
      planReply(["R1"], {
        uncertainties: ["R1 does not say how to handle heat"],
      }),
    () => generateTrainingPlan(planInput(), accounting),
  );
  assert.deepEqual(notes.result.draft!.uncertainties, [
    `${RULE} does not say how to handle heat`,
  ]);
  // Reference-shaped text that was never issued is not an identifier ("x10").
  const refs = planPromptRefs({ task: "plan_generation", ...planInput() });
  assert.equal(namesIdentifier(refs, "Plank x10 seconds"), false);
  assert.equal(namesIdentifier(refs, "Follow R1"), true);
});

test("trial regression (Claude Haiku 4.5): a plan or adjustment wrapped in one extra key is read; other shapes stay invalid", async () => {
  assert.deepEqual(unwrapReply({ program: { sessions: [] } }, "sessions"), {
    sessions: [],
  });
  assert.deepEqual(unwrapReply({ plan: { changes: [] } }, "changes"), {
    changes: [],
  });
  const other = { program: { sessions: [] }, requiresHumanReview: true };
  assert.equal(unwrapReply(other, "sessions"), other);
  const wrapped = await withReply(
    () => ({ program: planReply(["R1"]) }),
    () => generateTrainingPlan(planInput(), accounting),
  );
  assert.deepEqual(wrapped.result.errors, []);
  assert.ok(wrapped.result.draft);
  const unknown = await withReply(
    () => ({ program: planReply(["R1"]), explanation: "x" }),
    () => generateTrainingPlan(planInput(), accounting),
  );
  assert.equal(unknown.result.draft, null);
  assert.ok(unknown.result.errors.some((e) => /Unrecognized key/.test(e)));
});

test("the adaptation prompt is v2: it carries the code's progression hold, keeps measures and cites short references", async () => {
  const system = planAdaptationSystem();
  for (const phrase of [
    "Trainer Brain plan adaptation brain-plan-adapt-v2.",
    "Never increase load, sets, reps, duration or distance when progressionHold lists a reason",
    "logged reps in reserve below the prescription",
    "change reps only for rep work, durationSeconds only for timed work",
    "never with one the trainer's rules exclude",
    promptRefsInstruction,
    "(no other keys in a change)",
    "the R, X or P references you followed",
  ])
    assert.ok(system.includes(phrase), phrase);
  const hold = progressionHolds(outcomes(1, -1));
  const input = {
    profile: {
      experience: "intermediate",
      daysPerWeek: 4,
      equipment: "Full gym",
      goal: "Build muscle",
    },
    week: 2,
    currentWeek: t1Week,
    nextWeek: t1Week,
    outcomes: outcomes(1, -1),
    progressionHold: hold,
    bounds: T3_BOUNDS,
    material: material().material,
  };
  const { result, sent } = await withReply(
    () => ({
      changes: [],
      reason: "Keep next week as planned; R1 says to hold after a hard week.",
      selfConfidence: 0.8,
      uncertainties: [],
      evidenceIds: ["R1"],
    }),
    () => proposePlanAdaptation(input, accounting),
  );
  assert.deepEqual(sent.user.progressionHold, hold);
  assert.ok(!UUID_ANYWHERE.test(sent.raw));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.proposal!.evidenceIds, [RULE]);
  assert.equal(
    result.proposal!.reason,
    `Keep next week as planned; ${RULE} says to hold after a hard week.`,
  );
  // T1S07/adapt (Seed 2.0 Pro, first run): the miscopied rule ID is invalid output.
  const miscopy = await withReply(
    () => ({
      changes: [],
      reason: "r",
      selfConfidence: 0.8,
      evidenceIds: ["2432edf0-d62c-4eaf-91c5-f4aaf8d39"],
    }),
    () => proposePlanAdaptation(input, accounting),
  );
  assert.equal(miscopy.result.proposal, null);
  assert.match(
    miscopy.result.errors[0],
    /^Model output: evidenceIds\.0 malformed uuid/,
  );
});
