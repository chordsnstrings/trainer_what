import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSessionScript,
  planExercises,
} from "../packages/domain/src/voice-session.ts";
import {
  initialRunnerState,
  stepRunner,
  type RunnerState,
} from "../packages/domain/src/voice-runner.ts";
import {
  remoteEvent,
  restoreProgress,
  saveProgress,
  mergeCompletedSets,
} from "../apps/web/lib/guided-runtime.ts";
import { SpeechGate, speechBand } from "../apps/web/lib/speech-gate.ts";

const script = buildSessionScript({
  title: "Strength",
  exercises: planExercises({
    exercises: [
      { name: "Squat", sets: 2, reps: 8, loadKg: 20, restSeconds: 30 },
      {
        name: "Plank",
        sets: 1,
        durationSeconds: 20,
        restSeconds: 0,
        mode: "timed",
      },
    ],
  }),
}).script;
const ctx = { script, rules: script.rules, deliberate: true };
const setup = (): RunnerState => ({
  ...initialRunnerState(script),
  phase: "setup",
});
const done = { type: "command", command: { type: "done" } } as const;
test("guided readiness, completion and full rest are explicit", () => {
  assert.equal(
    stepRunner(ctx, setup(), { type: "prompt_done" })[0].phase,
    "setup",
  );
  let s = stepRunner(ctx, setup(), done)[0];
  assert.equal(
    stepRunner(ctx, s, done)[1].length,
    0,
    "cannot complete during the start cue",
  );
  s = stepRunner(ctx, s, { type: "prompt_done" })[0];
  const [rest, effects] = stepRunner(ctx, s, done);
  assert.equal(effects.filter((e) => e.type === "log_set").length, 1);
  assert.equal(rest.restRemaining, 30);
  const early = stepRunner(ctx, rest, done)[0];
  assert.equal(early.phase, "rest");
  assert.equal(early.restRemaining, 30);
  assert.equal(
    stepRunner(ctx, early, { type: "tick", seconds: 30 })[0].phase,
    "set",
  );
  const waiting = stepRunner(ctx, rest, { type: "tick", seconds: 30 })[0];
  assert.equal(waiting.phase, "rest");
  assert.equal(
    stepRunner(ctx, waiting, { type: "extend_rest" })[0].restRemaining,
    15,
  );
  assert.equal(
    stepRunner({ ...ctx, autoPace: true }, rest, {
      type: "tick",
      seconds: 30,
    })[0].phase,
    "set",
  );
});
test("timed expiry never claims physical completion; next exercise waits", () => {
  let s = { ...setup(), exercise: 1, logged: ["0:1", "0:2"] };
  s = stepRunner(ctx, s, done)[0];
  s = stepRunner(ctx, s, { type: "prompt_done" })[0];
  const [expired, effects] = stepRunner(ctx, s, { type: "tick", seconds: 20 });
  assert.equal(expired.phase, "set");
  assert.equal(expired.workLeft, 0);
  assert.equal(
    effects.some((e) => e.type === "log_set"),
    false,
  );
  assert.equal(
    stepRunner(ctx, expired, {
      type: "command",
      command: { type: "reps", reps: 3 },
    })[1].length,
    0,
  );
  const [cooldown, logged] = stepRunner(ctx, expired, done);
  assert.equal(logged.find((e) => e.type === "log_set")?.durationSeconds, 20);
  assert.equal(
    stepRunner(ctx, cooldown, { type: "prompt_done" })[0].phase,
    "cooldown",
  );
});
test("progress is revision-bound and resumes paused, with no clock advancement", () => {
  const s: RunnerState = {
    ...setup(),
    phase: "rest",
    set: 1,
    restRemaining: 17,
  };
  const saved = saveProgress("a", s);
  assert.equal(restoreProgress(saved, "a", script).phase, "paused");
  assert.equal(restoreProgress(saved, "a", script).restRemaining, 17);
  assert.equal(restoreProgress(saved, "b", script).phase, "ready");
  assert.equal(restoreProgress("broken", "a", script).phase, "ready");
  assert.equal(
    restoreProgress(saveProgress("a", { ...s, exercise: 99 }), "a", script)
      .phase,
    "ready",
  );
});
test("remote controls cannot advance paused, stopped or finished sessions", () => {
  for (const phase of ["paused", "finished", "stopped", "ready"] as const)
    assert.equal(remoteEvent("nexttrack", { ...setup(), phase }), null);
  assert.deepEqual(remoteEvent("nexttrack", setup()), done);
  const paused = stepRunner(ctx, setup(), {
    type: "command",
    command: { type: "pause" },
  })[0];
  assert.equal(stepRunner(ctx, paused, done)[0].phase, "paused");
  assert.equal(remoteEvent("play", paused)?.type, "command");
});
test("ordinary logged sets are not performed again when switching into guidance", () => {
  const merged = mergeCompletedSets(
    { ...setup(), phase: "set" },
    ["0:1"],
    script,
  );
  assert.equal(merged.phase, "paused");
  assert.equal(merged.set, 2);
  let s = stepRunner(ctx, merged, {
    type: "command",
    command: { type: "resume" },
  })[0];
  s = stepRunner(ctx, s, done)[0];
  assert.equal(s.phase, "set");
  assert.equal(s.set, 2);
  const fresh = mergeCompletedSets(
    initialRunnerState(script),
    ["0:1", "0:2"],
    script,
  );
  const [next] = stepRunner(ctx, { ...fresh, phase: "warmup" }, done);
  assert.equal(next.phase, "setup");
  assert.equal(next.exercise, 1);
});
test("local speech gating rejects silence and transient impacts without cloud calls", () => {
  const gate = new SpeechGate();
  assert.equal(gate.sample(0, 0, 0, 0), false);
  assert.equal(gate.sample(0.6, 0.8, 30, 10), false);
  assert.equal(gate.sample(0, 0, 0, 50), false);
  assert.equal(gate.sample(0.2, 0.8, 20, 200), false);
  assert.equal(gate.sample(0.2, 0.8, 20, 400), true);
  assert.equal(gate.sample(0.9, 0.1, 20, 600), false);
  assert.deepEqual(
    speechBand(new Float32Array(256).fill(-Infinity), 48000, 512),
    { ratio: 0, activeBins: 0 },
  );
});
