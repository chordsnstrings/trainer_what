import {
  initialRunnerState,
  type RunnerEvent,
  type RunnerState,
} from "../../../packages/domain/src/voice-runner.ts";
import type { SessionScript } from "../../../packages/domain/src/voice-session.ts";

export const progressKey = (tenant: string, user: string, workout: string) =>
  `trainer:guided:${tenant}:${user}:${workout}`;

/** Never resume a clock after a reload, or restore a different prescription. */
export function restoreProgress(
  raw: string | null,
  fingerprint: string,
  script: SessionScript,
): RunnerState {
  const fresh = initialRunnerState(script);
  try {
    const saved = JSON.parse(raw ?? "null");
    const s = saved?.state as RunnerState;
    if (
      saved?.version !== 1 ||
      saved.fingerprint !== fingerprint ||
      !s ||
      ![
        "ready",
        "intro",
        "warmup",
        "setup",
        "set",
        "rest",
        "cooldown",
        "finished",
        "paused",
        "stopped",
      ].includes(s.phase) ||
      !Number.isInteger(s.exercise) ||
      !script.exercises[s.exercise] ||
      !Number.isInteger(s.set) ||
      s.set < 1 ||
      s.set > script.exercises[s.exercise].sets ||
      !Array.isArray(s.targets) ||
      s.targets.length !== fresh.targets.length ||
      s.targets.some(
        (row, i) =>
          !Array.isArray(row) ||
          row.length !== fresh.targets[i].length ||
          row.some(
            (t) =>
              !Number.isFinite(t.reps) ||
              t.reps < 0 ||
              t.reps > 200 ||
              !Number.isFinite(t.loadKg) ||
              t.loadKg < 0 ||
              t.loadKg > script.exercises[i].loadKg,
          ),
      ) ||
      !Array.isArray(s.logged) ||
      !Array.isArray(s.skipped) ||
      !Number.isFinite(s.restRemaining) ||
      s.restRemaining < 0 ||
      s.restRemaining > 900 ||
      !Number.isFinite(s.setElapsed) ||
      s.setElapsed < 0 ||
      (s.workLeft != null &&
        (!Number.isFinite(s.workLeft) ||
          s.workLeft < 0 ||
          s.workLeft > (script.exercises[s.exercise].durationSeconds ?? 0)))
    )
      return fresh;
    if (["ready", "finished", "stopped"].includes(s.phase)) return s;
    const resume = s.phase === "paused" ? s.resume : s.phase;
    if (
      !resume ||
      !["intro", "warmup", "setup", "set", "rest", "cooldown"].includes(resume)
    )
      return fresh;
    return { ...s, phase: "paused", resume };
  } catch {
    return fresh;
  }
}

export function saveProgress(
  fingerprint: string,
  state: RunnerState,
  baseVersion = 0,
) {
  return JSON.stringify({
    version: 1,
    fingerprint,
    state,
    baseVersion,
    savedAt: Date.now(),
  });
}

/** Incorporate ordinary workout logging without asking the member to repeat it. */
export function mergeCompletedSets(
  state: RunnerState,
  completed: string[],
  script: SessionScript,
): RunnerState {
  const logged = [...new Set([...state.logged, ...completed])];
  let next = { ...state, logged };
  const phase = state.phase === "paused" ? state.resume : state.phase;
  if (
    ["setup", "set"].includes(phase ?? "") &&
    logged.includes(`${state.exercise}:${state.set}`)
  ) {
    for (let i = 0; i < script.exercises.length; i++)
      for (let set = 1; set <= script.exercises[i].sets; set++) {
        if (
          !logged.includes(`${i}:${set}`) &&
          !state.skipped.includes(`${i}:${set}`)
        )
          return {
            ...next,
            exercise: i,
            set,
            phase: "paused",
            resume: "setup",
            workLeft: null,
            setElapsed: 0,
            promptReady: false,
          };
      }
    next = { ...next, phase: "paused", resume: "cooldown" };
  }
  return next;
}

/** Media buttons never impersonate a repetition counter. Next confirms the target. */
export function remoteEvent(
  action: MediaSessionAction,
  state: RunnerState,
): RunnerEvent | null {
  if (["ready", "finished", "stopped"].includes(state.phase)) return null;
  if (action === "pause")
    return state.phase === "paused"
      ? null
      : { type: "command", command: { type: "pause" } };
  if (action === "play")
    return state.phase === "paused"
      ? { type: "command", command: { type: "resume" } }
      : null;
  if (action === "previoustrack")
    return { type: "command", command: { type: "repeat" } };
  if (action === "nexttrack" && state.phase !== "paused")
    return { type: "command", command: { type: "done" } };
  return null;
}

export function phaseToken(s: RunnerState) {
  return `${s.phase}:${s.exercise}:${s.set}`;
}
