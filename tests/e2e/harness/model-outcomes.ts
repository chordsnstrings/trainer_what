/**
 * Per-request model outcomes (`--model-outcomes=FILE`): for every model call
 * the double answered, what the app did with the answer, read back from the
 * throwaway database at the end of the run (before teardown) and from the
 * harness's own API exchanges.
 *
 * One JSONL line per call: the call (number, hash, kind, source, time, this
 * run's value behind each placeholder), its usage row (cost_events, linked by
 * the provider request id the double returned), the harness step running at
 * that moment, the API request that was open when the model was called (the
 * trigger, with the answer the person got) and the next API answers in the
 * window, the events the workspace wrote from the reservation until the
 * workspace's next model call (at most two minutes, by the double's clock), the records and
 * side-table rows (meal captures, voice style suggestions, recipes) those
 * events name or that window wrote, and the request's input records by
 * placeholder. It is evidence for a reviewer to judge (delivered, sent to
 * review, withheld, error); it assigns no verdict itself. Rows are the final
 * state at the end of the run, so a later review or erasure shows through.
 */
import { writeFileSync } from "node:fs";
import type { ModelCall } from "../mocks/model.ts";
import type { StepResult } from "./report.ts";

type Read = <T = any>(sql: string, params?: unknown[]) => Promise<T[]>;
type Exchange = {
  who: string;
  method: string;
  path: string;
  status: number;
  startedAt: string;
  endedAt: string;
  body: string;
};

const WINDOW_MS = 120_000;
const RECORD_LIMIT = 60;
const FOLLOWING_LIMIT = 12;
const DATA_LIMIT = 20_000;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const isUuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
/** Model output that lands outside `records`; `media` (photo bytes) is never read. */
const SIDE_TABLES = ["meal_captures", "voice_session_styles", "nutrition_recipes", "nutrition_foods"];

const trimmed = (value: unknown) => {
  const text = JSON.stringify(value ?? null);
  return text.length <= DATA_LIMIT ? value : { truncated: true, length: text.length, head: text.slice(0, DATA_LIMIT) };
};
const ids = (value: unknown) => [...new Set(JSON.stringify(value ?? null).match(UUID) ?? [])];
const time = (iso: string | Date) => new Date(iso).getTime();

export async function writeModelOutcomes(
  path: string,
  calls: ModelCall[],
  steps: StepResult[],
  exchanges: Exchange[],
  read: Read,
) {
  const usage = await read(
    "SELECT c.trace_id,c.id,c.tenant_id,t.slug AS tenant,c.user_id,c.task,c.status,c.input_tokens,c.output_tokens,c.created_at FROM cost_events c JOIN tenants t ON t.id=c.tenant_id WHERE c.trace_id LIKE 'chatcmpl-mock-%'",
  );
  const byTrace = new Map(usage.map((u) => [u.trace_id, u]));
  const lines: string[] = [];
  for (const call of calls) {
    const u = byTrace.get(`chatcmpl-mock-${call.n}`);
    const at = time(call.at);
    const step = steps.find((s) => s.startedAt && time(s.startedAt) <= at && at <= time(s.startedAt) + s.durationMs);
    const trigger = exchanges.filter((x) => time(x.startedAt) <= at && at <= time(x.endedAt));
    const entry: Record<string, unknown> = {
      n: call.n,
      hash: call.hash,
      kind: call.kind,
      task: call.task,
      source: call.source,
      status: call.status,
      at: call.at,
      placeholders: call.placeholders,
      usage: u
        ? {
            tenant: u.tenant,
            userId: u.user_id,
            task: u.task,
            status: u.status,
            input: u.input_tokens,
            output: u.output_tokens,
            reservedAt: u.created_at,
          }
        : null,
      step: step
        ? {
            id: step.id,
            status: step.status,
            startedAt: step.startedAt,
            durationMs: step.durationMs,
            detail: step.detail,
            error: step.error?.slice(0, 1500),
          }
        : null,
      trigger,
    };
    // Anchored on the double's own clock: usage timestamps can be moved by the test clock (month close).
    const start = at;
    const tenantOf = (n: number) => byTrace.get(`chatcmpl-mock-${n}`)?.tenant_id;
    const next = u
      ? calls
          .filter((o) => o.n !== call.n && time(o.at) > at && tenantOf(o.n) === u.tenant_id)
          .reduce((min, o) => Math.min(min, time(o.at)), Infinity)
      : Infinity;
    const end = Math.min(next, at + WINDOW_MS);
    const settled = trigger.length ? Math.max(...trigger.map((x) => time(x.endedAt))) : at;
    entry.following = exchanges
      .filter((x) => time(x.startedAt) >= settled && time(x.startedAt) < end)
      .slice(0, FOLLOWING_LIMIT);
    if (u)
      try {
        await readBack(entry, call, u, start, end, next, at, read);
      } catch (error) {
        entry.readBackError = String((error as Error)?.message ?? error);
      }
    lines.push(JSON.stringify(entry));
  }
  writeFileSync(path, lines.join("\n") + (lines.length ? "\n" : ""));
  return lines.length;
}

async function readBack(
  entry: Record<string, unknown>,
  call: ModelCall,
  u: any,
  start: number,
  end: number,
  next: number,
  at: number,
  read: Read,
) {
  const events = await read(
    "SELECT name,subject_id,actor_id,data,created_at FROM events WHERE tenant_id=$1 AND created_at>=$2 AND created_at<$3 ORDER BY created_at,id",
    [u.tenant_id, new Date(start), new Date(end)],
  );
  const named = [...new Set(events.flatMap((e) => [e.subject_id, ...ids(e.data)]))].filter(isUuid);
  const records = await read(
    "SELECT id,kind,status,owner_user_id,version,created_at,updated_at,data FROM records WHERE tenant_id=$1 AND ((created_at>=$2 AND created_at<$3) OR id=ANY($4::uuid[])) ORDER BY created_at,id LIMIT $5",
    [u.tenant_id, new Date(start), new Date(end), named, RECORD_LIMIT],
  );
  const side = [];
  for (const table of SIDE_TABLES)
    for (const row of await read(
      `SELECT to_jsonb(t)-'media' AS row FROM ${table} t WHERE t.tenant_id=$1 AND ((to_jsonb(t)->>'id')=ANY($4::text[]) OR ((to_jsonb(t)->>'created_at')::timestamptz>=$2 AND (to_jsonb(t)->>'created_at')::timestamptz<$3) OR ((to_jsonb(t)->>'updated_at')::timestamptz>=$2 AND (to_jsonb(t)->>'updated_at')::timestamptz<$3))`,
      [u.tenant_id, new Date(start), new Date(end), named],
    ))
      side.push({ table, row: trimmed(row.row) });
  // The request's own inputs (rules, exercises, profile ...), by placeholder, without their data.
  const inputs = await read("SELECT id,kind,status FROM records WHERE tenant_id=$1 AND id=ANY($2::uuid[])", [
    u.tenant_id,
    Object.values(call.placeholders).filter(isUuid),
  ]);
  const placeholderOf = new Map(Object.entries(call.placeholders).map(([p, v]) => [v, p]));
  entry.window = {
    from: new Date(start).toISOString(),
    to: new Date(end).toISOString(),
    closedBy: next <= at + WINDOW_MS ? "next model call in this workspace" : "time limit",
  };
  entry.events = events.map((e) => ({
    name: e.name,
    subjectId: e.subject_id,
    actorId: e.actor_id,
    at: e.created_at,
    data: trimmed(e.data),
  }));
  entry.records = records.map((r) => ({
    id: r.id,
    kind: r.kind,
    status: r.status,
    ownerUserId: r.owner_user_id,
    version: r.version,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    data: trimmed(r.data),
  }));
  entry.sideRows = side;
  entry.inputs = inputs.map((r) => ({
    placeholder: placeholderOf.get(r.id),
    id: r.id,
    kind: r.kind,
    status: r.status,
  }));
}
