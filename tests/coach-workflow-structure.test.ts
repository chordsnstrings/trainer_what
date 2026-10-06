import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { trainingProgramSchema } from "../packages/domain/src/coaching-completion.ts";
import { sessionOrder } from "../packages/domain/src/session-structure.ts";
import {
  buildSessionScript,
  lineLanguage,
  planExercises,
  scriptIssues,
  scriptLines,
  sharedClips,
} from "../packages/domain/src/voice-session.ts";
import {
  initialRunnerState,
  parseVoiceCommand,
  stepRunner,
} from "../packages/domain/src/voice-runner.ts";
import { applyAdaptation } from "../packages/domain/src/brain-plans.ts";

const movement = (extra: Record<string, unknown> = {}) => ({
  instanceId: randomUUID(),
  name: "Split squat",
  sets: 2,
  reps: 8,
  restSeconds: 60,
  loadKg: 0,
  rir: 2,
  cue: "",
  ...extra,
});
const program = (exercises: any[]) =>
  trainingProgramSchema.parse({
    title: "Structured workout",
    goal: "Practice",
    daysPerWeek: 1,
    exercises,
  });

test("manual prescriptions preserve blocks, sides and repeated instances while rejecting ambiguous structures", () => {
  const p = program([
    movement({
      name: "Walk",
      sets: 1,
      reps: undefined,
      durationSeconds: 120,
      block: "warmup",
    }),
    movement({ side: "left", group: { id: "A", kind: "superset" } }),
    movement({ side: "right", group: { id: "A", kind: "superset" } }),
    movement({
      name: "Walk",
      sets: 1,
      reps: undefined,
      distanceMeters: 100,
      block: "cooldown",
    }),
  ]);
  assert.deepEqual(
    sessionOrder(p.exercises).map((p) => `${p.exercise}:${p.set}`),
    ["0:1", "1:1", "2:1", "1:2", "2:2", "3:1"],
  );
  assert.throws(() => program([movement({ durationSeconds: 30 })]));
  assert.throws(() =>
    program([
      movement({ instanceId: undefined }),
      movement({ instanceId: undefined }),
    ]),
  );
  assert.throws(() =>
    program([movement({ group: { id: "A", kind: "superset" } })]),
  );
  assert.throws(() => program([movement({ block: "cooldown" }), movement()]));
  const plan = planExercises(p),
    { script } = buildSessionScript({ title: p.title, exercises: plan });
  assert.deepEqual(scriptIssues(script, plan), []);
  assert.equal(script.warmup.length, 0);
  assert.equal(script.cooldown.length, 0);
  assert.match(script.exercises[1].setup.text, /left side/);
});

test("circuit execution alternates movements, rests between rounds and resumes without duplicate sets", () => {
  const exercises = planExercises(
    program([
      movement({ group: { id: "A", kind: "superset" } }),
      movement({ name: "Row", group: { id: "A", kind: "superset" } }),
    ]),
  );
  const { script } = buildSessionScript({ title: "Circuit", exercises });
  const ctx = { script, rules: script.rules, deliberate: true };
  let s = {
    ...initialRunnerState(script),
    phase: "set" as const,
    promptReady: true,
  };
  let effects;
  [s, effects] = stepRunner(ctx, s, {
    type: "command",
    command: { type: "done" },
  }) as any;
  assert.deepEqual([s.phase, s.exercise, s.set], ["setup", 1, 1]);
  assert.equal(effects.filter((e: any) => e.type === "log_set").length, 1);
  [s] = stepRunner(ctx, s, {
    type: "command",
    command: { type: "done" },
  }) as any;
  [s] = stepRunner(ctx, s, { type: "prompt_done" }) as any;
  [s] = stepRunner(ctx, s, {
    type: "command",
    command: { type: "done" },
  }) as any;
  assert.deepEqual([s.phase, s.restRemaining], ["rest", 60]);
  [s] = stepRunner(ctx, s, { type: "prompt_done" }) as any;
  [s] = stepRunner(ctx, s, {
    type: "command",
    command: { type: "done" },
  }) as any;
  [s] = stepRunner(ctx, s, { type: "tick", seconds: 60 }) as any;
  assert.deepEqual([s.exercise, s.set], [0, 2]);
  const restored = { ...initialRunnerState(script), logged: ["0:1", "1:1"] };
  let [next] = stepRunner(ctx, restored, { type: "start" });
  [next] = stepRunner(ctx, next, { type: "prompt_done" });
  [next] = stepRunner(ctx, next, {
    type: "command",
    command: { type: "done" },
  });
  assert.deepEqual([next.exercise, next.set], [0, 2]);
});

test("distance Done accepts an actual result and Arabic code prompts and shared clips stay Arabic", () => {
  const exercises = planExercises(
    program([movement({ name: "Row", reps: undefined, distanceMeters: 500 })]),
  );
  const { script } = buildSessionScript({
    title: "جلسة",
    exercises,
    language: "ar",
  });
  assert.deepEqual(scriptIssues(script, exercises), []);
  assert.ok(
    scriptLines(script)
      .filter((l) => l.owner === "code")
      .every((l) => lineLanguage(l) === "ar"),
  );
  assert.deepEqual(
    sharedClips("ar").map((c) => c.key.replace(/^ar:/, "")),
    sharedClips().map((c) => c.key),
  );
  const s = {
    ...initialRunnerState(script),
    phase: "set" as const,
    promptReady: true,
  };
  const [, effects] = stepRunner(
    { script, rules: script.rules, deliberate: true },
    s,
    { type: "command", command: parseVoiceCommand("done 320 metres") },
  );
  assert.equal(effects.find((e) => e.type === "log_set")?.distanceMeters, 320);
  const [, paused] = stepRunner({ script, rules: script.rules }, s, {
    type: "command",
    command: { type: "pause" },
  });
  assert.ok(
    paused.some(
      (e) =>
        e.type === "say" &&
        /تم الإيقاف/.test(e.text) &&
        e.items.some((i) => "clip" in i && i.clip === "ar:paused"),
    ),
  );
  const changed = structuredClone(script);
  changed.exercises[0].side = "left";
  assert.ok(scriptIssues(changed, exercises).includes("prescription:0"));
});

test("an adaptation targets a repeated instance and rejects ambiguous name-only changes", () => {
  const left = movement({ side: "left", alternatives: [] }),
    right = movement({ side: "right", alternatives: [] });
  const sessions = [
    {
      plannedSessionId: randomUUID(),
      sessionKey: "A",
      exercises: [left, right] as any,
    },
  ];
  assert.equal(
    applyAdaptation(sessions, [
      { sessionKey: "A", exercise: left.name, loadKg: 5 },
    ]).errors.length,
    1,
  );
  const r = applyAdaptation(sessions, [
    {
      sessionKey: "A",
      exercise: right.name,
      instanceId: right.instanceId,
      loadKg: 5,
    },
  ]);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(
    r.sessions[0].exercises.map((e) => e.loadKg),
    [0, 5],
  );
});

test("a distance reply cannot complete a rep set", () => {
  const { script } = buildSessionScript({
    title: "Strength",
    exercises: planExercises(program([movement()])),
  });
  const state = {
    ...initialRunnerState(script),
    phase: "set" as const,
    promptReady: true,
  };
  const [next, effects] = stepRunner(
    { script, rules: script.rules, deliberate: true },
    state,
    { type: "command", command: parseVoiceCommand("done 50 metres") },
  );
  assert.deepEqual(next.logged, []);
  assert.ok(!effects.some((e) => e.type === "log_set"));
});
