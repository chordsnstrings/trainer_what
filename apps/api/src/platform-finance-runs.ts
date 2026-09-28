import { randomUUID } from "node:crypto";
import type { Database } from "@trainer/db";

// The run log of platform finance jobs (platform_finance_runs, migration
// 075) and the registry of jobs the worker runs every pass
// (docs/features/platform-finance.md). Kept apart from the screens so every
// phase's module can register a job or record a run without importing them.

/** Records the start of a platform finance run; returns its id. */
export async function startRun(
  db: Database,
  kind: string,
  actorId: string | null,
  result: Record<string, unknown> = {},
) {
  const id = randomUUID();
  await db.system((tx) =>
    tx.query(
      "INSERT INTO platform_finance_runs(id,kind,status,actor_id,result) VALUES($1,$2,'running',$3,$4)",
      [id, kind, actorId, JSON.stringify(result)],
    ),
  );
  return id;
}
export async function finishRun(
  db: Database,
  id: string,
  outcome: { result?: Record<string, unknown>; error?: string },
) {
  await db.system((tx) =>
    tx.query(
      "UPDATE platform_finance_runs SET status=$2,finished_at=now(),result=result||$3::jsonb,error=$4 WHERE id=$1 AND status='running'",
      [
        id,
        outcome.error ? "failed" : "succeeded",
        JSON.stringify(outcome.result ?? {}),
        outcome.error ? outcome.error.replace(/\s+/g, " ").slice(0, 1000) : null,
      ],
    ),
  );
}
/** The latest run of a kind, if any. */
export async function lastRun(db: Database, kind: string, status?: string) {
  const [row] = await db.system((tx) =>
    tx.query(
      "SELECT * FROM platform_finance_runs WHERE kind=$1 AND ($2::text IS NULL OR status=$2) ORDER BY started_at DESC LIMIT 1",
      [kind, status ?? null],
    ),
  );
  return row ?? null;
}
/** Whether a kind last succeeded (or was attempted, `anyStatus`) within `ms`. */
export async function ranWithin(
  db: Database,
  kind: string,
  ms: number,
  now = new Date(),
  anyStatus = false,
) {
  const [row] = await db.system((tx) =>
    tx.query(
      "SELECT 1 FROM platform_finance_runs WHERE kind=$1 AND ($2 OR status IN ('succeeded','running')) AND started_at>$3 LIMIT 1",
      [kind, anyStatus, new Date(now.getTime() - ms).toISOString()],
    ),
  );
  return !!row;
}
const platformJobs: Array<{
  id: string;
  run: (db: Database, now: Date) => Promise<unknown>;
}> = [];
/** Adds a platform finance job to the worker's hourly pass (phases C and D). */
export function registerPlatformFinanceJob(job: {
  id: string;
  run: (db: Database, now: Date) => Promise<unknown>;
}) {
  if (!platformJobs.some((j) => j.id === job.id)) platformJobs.push(job);
}
/** The registered jobs, in registration order. */
export function platformFinanceJobs() {
  return [...platformJobs];
}
