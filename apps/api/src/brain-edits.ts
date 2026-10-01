/**
 * Learning from the coach's own edits, its retention and its privacy rules
 * (docs/features/brain-learning.md):
 * - once a week one model call groups the coach's recent plan, weekly
 *   adjustment and meal-week edits into "Suggested from your edits" (rules for
 *   plans, nutrition cases for meal weeks), each linked to its edits; nothing
 *   counts until the coach confirms it (brain-learning.ts confirm route);
 * - pending suggestions expire after 90 days, dismissed ones are deleted after
 *   30, and examples whose member was erased are removed;
 * - reviewed plan examples from an erased member are deleted and taken out of
 *   learning snapshots; examples from a member who withdrew coaching consent
 *   stop being used (brain-plans.ts filters them) and are marked revoked;
 * - the weekly sweep asks for the background check that puts new reviewed
 *   examples live (brain-plans.ts learning snapshots).
 */
import { randomUUID } from "node:crypto";
import {
  elevated,
  event,
  putRecord,
  type Actor,
  type Database,
  type Tx,
} from "@trainer/db";
import { ModelOutputInvalid } from "@trainer/providers";
import { withoutName } from "../../../packages/domain/src/brain-learning.ts";
import {
  EDIT_BATCH_LIMIT,
  planProfileDuplicate,
  type EditItem,
} from "../../../packages/domain/src/brain-edits.ts";
import { planSegment } from "../../../packages/domain/src/brain-plans.ts";
import { screenSafety } from "../../../packages/domain/src/safety-policy.ts";
import { suggestRulesFromEdits } from "../../../packages/providers/src/brain-edits.ts";
import { activeSafetyPolicy } from "./safety-policy.ts";
import { modelAccounting } from "./model-accounting.ts";
import { privacyMatches } from "./ingestion.ts";
import { requestBrainCheck, BRAIN_CHECK_JOB } from "./brain-check.ts";
import {
  loadPlanSettings,
  planQualificationState,
  waitingLearning,
} from "./brain-plans.ts";

export const WEEKLY_EDITS = "weekly_edits";
const WEEK_DAYS = 7;
export const SUGGESTION_EXPIRY_DAYS = 90;
export const DISMISSED_DELETE_DAYS = 30;
/** A weekly request needs at least this many new edits. */
const MIN_EDITS = 2;

// ---------------------------------------------------------------------------
// Privacy

const tenantOf = async (tx: Tx) =>
  (await tx.query("SELECT current_setting('app.tenant_id',true) AS id"))[0].id as string;
async function derivedLearningIds(tx: Tx, userId: string) {
  const rows = await tx.query(
    "SELECT l.id FROM records l JOIN records g ON g.kind='plan_generation' AND g.id::text=l.data->>'generationId' WHERE l.kind='plan_learning' AND g.owner_user_id=$1",
    [userId],
  );
  return rows.map((r) => r.id as string);
}
/**
 * Takes examples out of every learning snapshot that lists them; a live or
 * candidate snapshot that held one is archived (as teaching copies are), so
 * plans wait for the coach until a re-check of what remains passes.
 */
async function withdrawFromSnapshots(tx: Tx, ids: string[]) {
  if (!ids.length) return 0;
  const rows = await tx.query(
    `UPDATE records r SET status=CASE WHEN status IN ('published','candidate') THEN 'privacy_archived' ELSE status END,
    version=version+1,updated_at=now(),data=jsonb_set(data,'{rows}',
      coalesce((SELECT jsonb_agg(item) FROM jsonb_array_elements(coalesce(r.data->'rows','[]'::jsonb)) item
        WHERE NOT (item->>'id'=ANY($1::text[]))),'[]'::jsonb))
    WHERE kind='plan_learning_snapshot' AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(coalesce(r.data->'rows','[]'::jsonb)) item WHERE item->>'id'=ANY($1::text[]))
    RETURNING id`,
    [ids],
  );
  return rows.length;
}
async function lockBrain(tx: Tx, tenantId: string) {
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [tenantId + ":brain"]);
}
/**
 * Erasure hook (privacy-hooks.ts eraseAdditional, before the member's own
 * records go): deletes the reviewed plan examples that come from the member's
 * plans, takes them out of learning snapshots, deletes edit suggestions that
 * cite the member, and asks for a background re-check.
 */
export async function erasePlanLearningDerivedData(tx: Tx, userId: string) {
  const ids = await derivedLearningIds(tx, userId);
  const cited = await tx.query(
    "DELETE FROM records WHERE kind='brain_suggestion' AND data->'memberIds' ? $1::text RETURNING id",
    [userId],
  );
  if (!ids.length) return { examples: 0, suggestions: cited.length };
  const tenantId = await tenantOf(tx);
  await lockBrain(tx, tenantId);
  const snapshots = await withdrawFromSnapshots(tx, ids);
  await tx.query("DELETE FROM records WHERE kind='plan_learning' AND id=ANY($1::uuid[])", [ids]);
  if (snapshots) await requestBrainCheck(tx, { tenantId } as Actor, "privacy");
  return { examples: ids.length, suggestions: cited.length };
}
/**
 * Examples whose member no longer allows model use (withdrawn coaching
 * consent) are marked revoked and taken out of snapshots; brain-plans.ts
 * already stops using them at once. Examples whose plan is gone (a member
 * erased before this hook existed) are deleted. Runs in the weekly sweep.
 */
async function revokeWithdrawnLearning(tx: Tx, tenantId: string) {
  const rows = await tx.query(
    `SELECT l.id,g.id AS generation FROM records l LEFT JOIN records g ON g.kind='plan_generation' AND g.id::text=l.data->>'generationId'
     WHERE l.kind='plan_learning' AND l.status='confirmed' AND (g.id IS NULL OR NOT coalesce((SELECT i.data->'allowedUses' ? 'model_prompt' FROM records i WHERE i.kind='intake' AND i.owner_user_id=g.owner_user_id ORDER BY i.created_at DESC,i.id DESC LIMIT 1),false))`,
  );
  if (!rows.length) return 0;
  await lockBrain(tx, tenantId);
  const ids = rows.map((r) => r.id as string);
  const snapshots = await withdrawFromSnapshots(tx, ids);
  const orphans = rows.filter((r) => !r.generation).map((r) => r.id);
  if (orphans.length) await tx.query("DELETE FROM records WHERE kind='plan_learning' AND id=ANY($1::uuid[])", [orphans]);
  await tx.query(
    "UPDATE records SET status='permission_revoked',version=version+1,updated_at=now(),data=jsonb_set(data,'{allowedUses}','[]'::jsonb) WHERE kind='plan_learning' AND id=ANY($1::uuid[]) AND status='confirmed'",
    [ids],
  );
  // Pending edit suggestions that cite such a member go too.
  await tx.query(
    `DELETE FROM records s WHERE s.kind='brain_suggestion' AND s.status<>'confirmed' AND s.data->'source'->>'kind'='${WEEKLY_EDITS}' AND EXISTS (
       SELECT 1 FROM jsonb_array_elements_text(coalesce(s.data->'memberIds','[]'::jsonb)) m WHERE NOT coalesce((SELECT i.data->'allowedUses' ? 'model_prompt' FROM records i WHERE i.kind='intake' AND i.owner_user_id::text=m ORDER BY i.created_at DESC,i.id DESC LIMIT 1),false))`,
  );
  return snapshots;
}

// ---------------------------------------------------------------------------
// Retention

/**
 * Pending suggestions expire after 90 days (their example text is removed);
 * dismissed ones are deleted after 30 days; withheld and nothing-to-learn
 * records (never shown) after 90.
 */
export async function applyLearningRetention(tx: Tx) {
  const expired = await tx.query(
    `UPDATE records SET status='expired',version=version+1,updated_at=now(),data=data-'example'-'edits'-'coachWords'-'evidence'||'{"expired":true}'::jsonb
     WHERE kind='brain_suggestion' AND status='suggested' AND created_at<now()-interval '${SUGGESTION_EXPIRY_DAYS} days' RETURNING id`,
  );
  const deleted = await tx.query(
    `DELETE FROM records WHERE kind='brain_suggestion' AND ((status='dismissed' AND updated_at<now()-interval '${DISMISSED_DELETE_DAYS} days') OR (status IN ('withheld','nothing_to_learn') AND created_at<now()-interval '${SUGGESTION_EXPIRY_DAYS} days')) RETURNING id`,
  );
  return { expired: expired.length, deleted: deleted.length };
}

// ---------------------------------------------------------------------------
// Weekly sweep

const swept = new Map<string, number>();
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
/**
 * The per-workspace learning sweep of the worker cycle (at most hourly):
 * retention, withdrawn consent, the weekly check of new reviewed examples and
 * the weekly edit grouping. Only database work here; model calls run in the
 * queued jobs.
 */
export async function scheduleBrainLearning(
  db: Database,
  tenantId: string,
  options: { force?: boolean } = {},
) {
  if (!options.force && Date.now() - (swept.get(tenantId) ?? 0) < SWEEP_INTERVAL_MS) return null;
  swept.set(tenantId, Date.now());
  // Elevation "worker": the scheduled learning sweep of one workspace
  // (packages/db/src/scope.ts ELEVATIONS.worker); no member request here.
  const a = elevated("worker", { tenantId, role: "owner" });
  return db.tenant(a, async (tx) => {
    const retention = await applyLearningRetention(tx);
    const revoked = await revokeWithdrawnLearning(tx, tenantId);
    const [release] = await tx.query(
      "SELECT id FROM records WHERE kind='brain_release' AND status='published' LIMIT 1",
    );
    let check: string | null = null;
    if (release) {
      const { settings } = await loadPlanSettings(tx);
      const plans = await planQualificationState(tx, settings);
      const learning = await waitingLearning(tx);
      const [recent] = await tx.query(
        `SELECT id FROM records WHERE kind='plan_learning_snapshot' AND created_at>now()-interval '${WEEK_DAYS} days' LIMIT 1`,
      );
      const [pending] = await tx.query(
        `SELECT id FROM jobs WHERE kind='${BRAIN_CHECK_JOB}' AND status='pending' LIMIT 1`,
      );
      // New reviewed examples go live weekly through a passing check; plans
      // that lost their qualification (a privacy removal, a new prompt
      // version) are re-checked too.
      const lapsed = !plans.qualified && plans.latest?.status === "passed";
      if (!pending && ((plans.qualified && learning.waiting > 0 && !recent) || revoked || lapsed)) {
        check = lapsed || revoked ? "requalify" : "weekly_learning";
        await requestBrainCheck(tx, a, check, 0);
      }
    }
    const week = isoWeek(new Date());
    const [ran] = await tx.query(
      `SELECT id FROM jobs WHERE kind='brain_learning' AND intent_key=$1`,
      [`brain_learning:${WEEKLY_EDITS}:${tenantId}:${week}`],
    );
    let grouping = false;
    if (!ran && (await editsSince(tx, sinceLastRun(await lastRun(tx)))).length >= MIN_EDITS) {
      await tx.query(
        "INSERT INTO jobs(id,tenant_id,kind,intent_key,data) VALUES($1,$2,'brain_learning',$3,$4) ON CONFLICT(intent_key) DO NOTHING",
        [randomUUID(), tenantId, `brain_learning:${WEEKLY_EDITS}:${tenantId}:${week}`, JSON.stringify({ kind: WEEKLY_EDITS, week })],
      );
      grouping = true;
    }
    return { retention, revoked, check, grouping };
  });
}
export function isoWeek(at: Date) {
  const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const year = d.getUTCFullYear();
  const week = Math.ceil(((d.getTime() - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}
async function lastRun(tx: Tx) {
  const [run] = await tx.query(
    "SELECT created_at FROM records WHERE kind='brain_edit_run' ORDER BY created_at DESC,id DESC LIMIT 1",
  );
  return run?.created_at ? new Date(run.created_at) : null;
}
const sinceLastRun = (last: Date | null) => {
  const week = new Date(Date.now() - WEEK_DAYS * 86400000);
  return last && last > week ? last : week;
};

type Edit = EditItem & { id: string; source: "plan_learning" | "nutrition_plan_edit"; memberId: string; link: Record<string, string> };
/**
 * The coach's edits since `since`, oldest first (at most 30): edited or
 * rejected Brain plans and adjustments, and amended or archived meal weeks,
 * only from members whose data allows model use. Left out: edits whose note
 * the safety screen holds (health goes to the coach, never into learning) or
 * that carry contact details, and plans whose member profile repeats a
 * held-out plan scenario (the held-out set stays independent).
 */
async function editsSince(tx: Tx, since: Date): Promise<Edit[]> {
  const plans = await tx.query(
    `SELECT l.id,l.data,l.created_at,g.id AS generation_id,g.owner_user_id AS member_id,g.data->'inputs'->'profile' AS profile
     FROM records l JOIN records g ON g.kind='plan_generation' AND g.id::text=l.data->>'generationId'
     WHERE l.kind='plan_learning' AND l.status='confirmed' AND l.data->>'decision' IN ('edited','rejected') AND l.created_at>$1
       AND l.data->'allowedUses' ? 'model_prompt'
       AND coalesce((SELECT i.data->'allowedUses' ? 'model_prompt' FROM records i WHERE i.kind='intake' AND i.owner_user_id=g.owner_user_id ORDER BY i.created_at DESC,i.id DESC LIMIT 1),false)
     ORDER BY l.created_at,l.id LIMIT 60`,
    [since.toISOString()],
  );
  const meals = await tx.query(
    `SELECT e.id,e.data,e.created_at,e.owner_user_id AS member_id FROM records e JOIN records p ON p.kind='nutrition_plan' AND p.id::text=e.data->>'planId'
     WHERE e.kind='nutrition_plan_edit' AND e.data->>'action' IN ('amend','archive') AND e.created_at>$1 AND p.data->'allowedUses' ? 'model_prompt'
     ORDER BY e.created_at,e.id LIMIT 60`,
    [since.toISOString()],
  );
  const heldOut = (
    await tx.query("SELECT data FROM records WHERE kind='plan_scenario' AND status='held_out' LIMIT 51")
  ).map((s) => s.data.profile);
  const memberIds = [...new Set([...plans, ...meals].map((r) => r.member_id as string))];
  const names = new Map<string, string>(
    (memberIds.length
      ? await tx.query("SELECT id,name FROM users WHERE id=ANY($1::uuid[])", [memberIds])
      : []
    ).map((u) => [u.id, u.name ?? ""]),
  );
  const allNames = [...names.values()];
  const policy = await activeSafetyPolicy(tx);
  const clean = (text: unknown) => withoutName(String(text ?? ""), allNames).slice(0, 600);
  const blocked = (text: string) => !!text && (screenSafety(text, policy).hold || privacyMatches(text).length > 0);
  const clip = (v: unknown) =>
    typeof v === "string" ? clean(v).slice(0, 120) : typeof v === "number" || typeof v === "boolean" || v === null ? v : clean(JSON.stringify(v)).slice(0, 120);
  const out: Edit[] = [];
  for (const r of plans) {
    if (heldOut.some((p) => planProfileDuplicate(r.profile, p))) continue;
    const note = clean(r.data.note);
    const changes = (Array.isArray(r.data.diff) ? r.data.diff : []).slice(0, 15).map((c: any) => ({
      path: String(c?.path ?? "").slice(0, 160),
      from: clip(c?.from ?? null),
      to: clip(c?.to ?? null),
    }));
    if (blocked(note) || changes.some((c: any) => blocked(String(c.to ?? "")))) continue;
    out.push({
      ref: "",
      id: r.id,
      source: "plan_learning",
      memberId: r.member_id,
      kind: r.data.type === "adaptation" ? "adaptation" : "plan",
      action: String(r.data.decision),
      segment: r.data.segment ?? (r.profile ? planSegment(r.profile) : null),
      changes,
      note,
      link: { generationId: r.generation_id, href: `/trainer/subscribers/${r.member_id}/plan` },
      created: String(r.created_at),
    } as Edit & { created: string });
  }
  for (const r of meals) {
    const note = clean(r.data.reason);
    if (note.length < 10 || blocked(note)) continue;
    out.push({
      ref: "",
      id: r.id,
      source: "nutrition_plan_edit",
      memberId: r.member_id,
      kind: "meal_week",
      action: String(r.data.action),
      segment: null,
      changes: [],
      note,
      link: { planId: String(r.data.planId), href: `/trainer/subscribers/${r.member_id}` },
      created: String(r.created_at),
    } as Edit & { created: string });
  }
  return out
    .sort((x: any, y: any) => (x.created < y.created ? -1 : x.created > y.created ? 1 : x.id < y.id ? -1 : 1))
    .slice(-EDIT_BATCH_LIMIT)
    .map((e, i) => ({ ...e, ref: `E${i + 1}` }));
}

/**
 * Worker entry point for the weekly grouping (a `brain_learning` job with
 * `data.kind` "weekly_edits"): one model call for the coach's week of edits.
 * Suggestions are workspace records citing the members whose edits they come
 * from (`memberIds`), so erasing a member deletes them.
 */
export async function executeWeeklyEditsJob(db: Database, tenantId: string, job: any) {
  // Elevation "worker": a queued background job for one workspace
  // (packages/db/src/scope.ts ELEVATIONS.worker); no member request here.
  // Its records belong to the workspace owner (the coach confirms them).
  const system = elevated("worker", { tenantId, role: "owner" });
  const ownerId = await db.tenant(system, async (tx) => {
    const [o] = await tx.query("SELECT user_id FROM memberships WHERE role='owner' ORDER BY user_id LIMIT 1");
    return o?.user_id as string | undefined;
  });
  if (!ownerId) return null;
  const a = elevated("worker", { tenantId, role: "owner", userId: ownerId });
  const prepared = await db.tenant(a, async (tx) => {
    const [done] = await tx.query(
      "SELECT id FROM records WHERE kind='brain_edit_run' AND data->>'week'=$1",
      [String(job.data.week ?? "")],
    );
    if (done) return null;
    const edits = await editsSince(tx, sinceLastRun(await lastRun(tx)));
    const policy = await activeSafetyPolicy(tx);
    return { edits, policy };
  });
  if (!prepared) return null;
  const record = (data: Record<string, unknown>, status: string) =>
    db.tenant(a, async (tx) => {
      const run = await putRecord(
        tx,
        a,
        "brain_edit_run",
        { week: job.data.week, edits: prepared.edits.length, ...data },
        { status },
      );
      await event(tx, a, "brain.edit_run_completed", run.id, { status });
      return run;
    });
  if (prepared.edits.length < MIN_EDITS) return record({ suggestions: 0 }, "nothing_new");
  const items: EditItem[] = prepared.edits.map(({ ref, kind, action, segment, changes, note }) => ({ ref, kind, action, segment, changes, note }));
  let result;
  try {
    result = await suggestRulesFromEdits(
      items,
      modelAccounting(db, a, "brain_edits", { memberId: null }),
      (text) => screenSafety(text, prepared.policy).hold,
    );
  } catch (error) {
    if (!(error instanceof ModelOutputInvalid)) throw error;
    return record({ suggestions: 0, issue: "invalid_model_answer" }, "withheld");
  }
  return db.tenant(a, async (tx) => {
    const byRef = new Map(prepared.edits.map((e) => [e.ref, e]));
    let shown = 0;
    for (const { suggestion, issues } of result.suggestions) {
      const cited = [...new Set(suggestion.evidence)].map((r) => byRef.get(r)).filter((e): e is Edit => !!e);
      const text = `${suggestion.title}. ${suggestion.condition}. ${suggestion.directive}`;
      const all: string[] = [...issues];
      if (privacyMatches(text).length) all.push("personal_data");
      const status = all.length ? "withheld" : "suggested";
      if (status === "suggested") shown++;
      const row = await putRecord(
        tx,
        a,
        "brain_suggestion",
        {
          source: { kind: WEEKLY_EDITS, week: job.data.week },
          target: suggestion.target,
          rule: {
            title: suggestion.title,
            category: suggestion.category,
            condition: suggestion.condition,
            directive: suggestion.directive,
          },
          why: suggestion.why.slice(0, 600),
          issues: [...new Set(all)],
          promptVersion: result.promptVersion,
          // The cited edits as the model saw them (the confirm route re-checks
          // against them) and links to open each one.
          edits: cited.map(({ ref, kind, action, segment, changes, note }) => ({ ref, kind, action, segment, changes, note })),
          evidence: cited.map((e) => ({ ref: e.ref, kind: e.kind, source: e.source, id: e.id, memberId: e.memberId, ...e.link })),
          memberIds: [...new Set(cited.map((e) => e.memberId))],
        },
        { status },
      );
      await event(tx, a, "brain.suggestion_created", row.id, { status, source: WEEKLY_EDITS });
    }
    const run = await putRecord(
      tx,
      a,
      "brain_edit_run",
      { week: job.data.week, edits: prepared.edits.length, suggestions: result.suggestions.length, shown, promptVersion: result.promptVersion },
      { status: "completed" },
    );
    await event(tx, a, "brain.edit_run_completed", run.id, { status: "completed", shown });
    return run;
  });
}
