/**
 * Loads a member's code-built memory (packages/domain/src/member-memory.ts)
 * from their own records in the caller's scope. Only sources that allow model
 * use are read: without current coaching rights on the intake (withdrawn
 * consent removes them) there is no memory. Nothing is stored: erasing the
 * member's records erases what it is built from.
 */
import type { Tx } from "@trainer/db";
import { effectiveWorkoutSets } from "../../../packages/domain/src/coaching-completion.ts";
import { memberEquipment } from "../../../packages/domain/src/brain-plans.ts";
import {
  buildMemberMemory,
  MEMORY_WINDOW_DAYS,
  type MemberMemory,
} from "../../../packages/domain/src/member-memory.ts";

const LOAD_DAYS = 90;
const isoDate = (at: Date) => at.toISOString().slice(0, 10);

export async function loadMemberMemory(
  tx: Tx,
  userId: string,
  options: { today?: string } = {},
): Promise<MemberMemory | null> {
  const [intake] = await tx.query(
    "SELECT data FROM records WHERE kind='intake' AND owner_user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1",
    [userId],
  );
  if (!intake?.data?.allowedUses?.includes("model_prompt")) return null;
  const today = options.today ?? isoDate(new Date());
  const from = isoDate(new Date(Date.parse(today + "T12:00:00Z") - MEMORY_WINDOW_DAYS * 86400000));
  const sessions = await tx.query(
    "SELECT id,status,data->>'date' AS date,data->'program'->'exercises' AS exercises FROM records WHERE kind='planned_session' AND owner_user_id=$1 AND data->>'date'>=$2 AND data->>'date'<=$3 ORDER BY data->>'date',id LIMIT 400",
    [userId, from, today],
  );
  const programs = await tx.query(
    "SELECT data FROM records WHERE kind='program' AND owner_user_id=$1 AND status='assigned' ORDER BY created_at DESC,id DESC LIMIT 2",
    [userId],
  );
  const workouts = sessions.length
    ? await tx.query(
        "SELECT id,data->>'plannedSessionId' AS planned FROM records WHERE kind='workout' AND owner_user_id=$1 AND data->>'plannedSessionId'=ANY($2::text[])",
        [userId, sessions.map((s) => s.id)],
      )
    : [];
  const sets = await tx.query(
    `SELECT * FROM workout_events WHERE user_id=$1 AND created_at>=now()-interval '${LOAD_DAYS} days' ORDER BY created_at DESC,id DESC LIMIT 1000`,
    [userId],
  );
  const corrections = sets.length
    ? await tx.query(
        "SELECT * FROM records WHERE kind='workout_correction' AND owner_user_id=$1 AND data->>'eventId'=ANY($2::text[])",
        [userId, sets.map((s) => s.id)],
      )
    : [];
  const swaps = await tx.query(
    `SELECT data->>'from' AS "from",data->>'to' AS "to" FROM records WHERE kind='workout_substitution' AND owner_user_id=$1 AND created_at>=now()-interval '${MEMORY_WINDOW_DAYS} days' ORDER BY created_at DESC LIMIT 200`,
    [userId],
  );
  const effective = effectiveWorkoutSets(sets, corrections);
  const plannedOf = new Map(workouts.map((w) => [w.id, w.planned]));
  const logged = new Map<string, string[]>();
  for (const s of effective) {
    const planned = plannedOf.get(s.workout_id);
    if (planned) logged.set(planned, [...(logged.get(planned) ?? []), String(s.data.exercise ?? "")]);
  }
  const names = (rows: any) => (Array.isArray(rows) ? rows.map((e: any) => String(e?.name ?? "")) : []);
  // Names the coach prescribed (planned sessions and the assigned programme,
  // with the alternatives they list).
  const prescribed = (rows: any): string[] =>
    Array.isArray(rows)
      ? rows.flatMap((e: any) => [
          String(e?.name ?? ""),
          ...(Array.isArray(e?.alternatives) ? e.alternatives : []).map((x: any) => String(typeof x === "string" ? x : (x?.name ?? ""))),
        ])
      : [];
  const known = [
    ...sessions.flatMap((s) => prescribed(s.exercises)),
    ...programs.flatMap((p) => [
      ...prescribed(p.data.exercises),
      ...(p.data.sessions ?? []).flatMap((s: any) => prescribed(s.exercises)),
    ]),
  ];
  return buildMemberMemory({
    today,
    daysPerWeek: Number(intake.data.daysPerWeek) || null,
    equipment: memberEquipment(String(intake.data.equipment ?? "")).items,
    sessions: sessions.map((s) => ({
      date: s.date,
      status: s.status,
      exercises: names(s.exercises),
      loggedExercises: logged.get(s.id) ?? [],
    })),
    sets: effective.map((s) => ({
      exercise: String(s.data.exercise ?? ""),
      reps: Number(s.data.reps) || 0,
      loadKg: Number(s.data.loadKg) || 0,
      date: isoDate(new Date(s.created_at)),
    })),
    substitutions: swaps.map((s) => ({ from: String(s.from ?? ""), to: String(s.to ?? "") })),
    known,
  });
}
