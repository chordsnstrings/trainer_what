import { z } from "zod";
import type { SessionScript } from "./voice-session.ts";
export const guidedProgressSchema = z
  .object({
    phase: z.enum([
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
    ]),
    resume: z
      .enum([
        "ready",
        "intro",
        "warmup",
        "setup",
        "set",
        "rest",
        "cooldown",
        "finished",
        "stopped",
      ])
      .optional(),
    exercise: z.number().int().min(0).max(100),
    set: z.number().int().min(1).max(20),
    restRemaining: z.number().int().min(0).max(900),
    setElapsed: z.number().int().min(0).max(86400),
    workLeft: z.number().min(0).max(7200).nullable().optional(),
    promptReady: z.boolean().optional(),
    restReady: z.boolean().optional(),
    targets: z
      .array(
        z
          .array(
            z
              .object({
                reps: z.number().int().min(0).max(200),
                loadKg: z.number().min(0).max(500),
              })
              .strict(),
          )
          .max(20),
      )
      .max(100),
    logged: z.array(z.string().regex(/^\d+:\d+$/)).max(2000),
    skipped: z.array(z.string().regex(/^\d+:\d+$/)).max(2000),
    encouragement: z.number().int().min(0).max(2000),
    stopReason: z.enum(["pain", "hold", "member"]).optional(),
    struggleSaid: z.boolean().optional(),
  })
  .strict();
export function checkpointMatches(
  s: z.infer<typeof guidedProgressSchema>,
  script: SessionScript,
) {
  const ex = script.exercises[s.exercise];
  return (
    !!ex &&
    s.set <= ex.sets &&
    s.targets.length === script.exercises.length &&
    s.targets.every(
      (row, i) =>
        row.length === script.exercises[i].sets &&
        row.every((t) => t.loadKg <= script.exercises[i].loadKg),
    ) &&
    (s.workLeft == null || s.workLeft <= (ex.durationSeconds ?? 0)) &&
    [...s.logged, ...s.skipped].every((key) => {
      const [i, set] = key.split(":").map(Number);
      return (
        !!script.exercises[i] && set >= 1 && set <= script.exercises[i].sets
      );
    })
  );
}
