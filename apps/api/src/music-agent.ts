import { randomUUID } from "node:crypto";
import type { Database, Tx } from "@trainer/db";
import { z } from "zod";
import {
  MUSIC_PLAYLISTS,
  MUSIC_TARGET,
  musicBrief,
} from "../../../packages/domain/src/workout-music.ts";
import {
  runtimeConfig,
  withRuntimeConfig,
} from "../../../packages/providers/src/configuration.ts";
import { musicCredits } from "../../../packages/providers/src/suno-music.ts";
import {
  planMusic,
  MusicPlanRejected,
  MUSIC_PLAN_SIZE,
  MUSIC_PLAN_TOKENS,
  MUSIC_PLAN_VERSION,
} from "../../../packages/providers/src/music-planner.ts";
import { resolveSiteStarterConfig } from "./site-builder-starter.ts";
// Fill the finite library within the daily limits. Historical lifetime caps
// are no longer controls; retain their database columns for rollback only.
const MAX_INT = 2_147_483_647;
export const MUSIC_DAILY_PLAN_LIMIT = 8;
export const musicAgentSettings = z
  .object({
    enabled: z.boolean(),
    autoPublish: z.boolean(),
    recoveryConfirmed: z.boolean(),
    externalRequests: z.number().int().min(0).max(MAX_INT),
    externalCredits: z.number().min(0).finite(),
    // An already-open admin page can save after deployment. Discard its old
    // caps instead of silently bringing them back into operation or the audit.
    requestLimit: z.number().int().positive().optional(),
    creditLimit: z.number().positive().finite().optional(),
    modelCallLimit: z.number().int().positive().optional(),
    modelUsdLimit: z.number().positive().finite().optional(),
  })
  .strict()
  .transform(
    ({
      requestLimit,
      creditLimit,
      modelCallLimit,
      modelUsdLimit,
      ...settings
    }) => settings,
  );
const fail = (code: string, message: string) =>
  Object.assign(new Error(message), { statusCode: 409, code });
type AgentRow = {
  enabled: boolean;
  auto_publish: boolean;
  recovery_confirmed: boolean;
  external_requests: number;
  external_credits: number;
  requested_by: string | null;
  next_check_at: string | null;
  status: string;
  message: string | null;
  checked_at: string | null;
};
export async function musicBudgetLock(tx: Tx) {
  await tx.query(
    "SELECT pg_advisory_xact_lock(hashtext('workout-music-budget'))",
  );
}
export async function musicAgentSummary(tx: Tx) {
  const [agent] = await tx.query<AgentRow>(
    "SELECT enabled,auto_publish,recovery_confirmed,external_requests,external_credits,requested_by,next_check_at,status,message,checked_at FROM workout_music_agent WHERE id=true",
  );
  const [totals] = await tx.query(
    "SELECT count(*)::int AS requests,coalesce(sum(credit_limit),0) AS credits,coalesce(sum(CASE WHEN status='queued' OR submitted_at>=date_trunc('day',now(),'UTC') THEN credit_limit ELSE 0 END),0) AS daily_credits FROM workout_music_jobs WHERE NOT imported AND status<>'cancelled'",
  );
  const [models] = await tx.query(
    "SELECT count(*)::int AS calls,count(*) FILTER(WHERE created_at>=date_trunc('day',now(),'UTC'))::int AS daily_calls,coalesce(sum(greatest(reserved_usd,coalesce((usage->>'cost')::numeric,0))),0) AS usd FROM workout_music_plans",
  );
  const tracks = await tx.query(
    "SELECT playlist,count(*)::int AS n FROM workout_music_tracks WHERE status='approved' GROUP BY playlist",
  );
  const ready = MUSIC_PLAYLISTS.map((p) =>
    Number(tracks.find((t) => t.playlist === p.id)?.n ?? 0),
  );
  return {
    ...agent,
    usedRequests: Number(totals.requests) + Number(agent.external_requests),
    reservedCredits: Number(totals.credits) + Number(agent.external_credits),
    modelCalls: Number(models.calls),
    reservedModelUsd: Number(models.usd),
    dailyCreditsReserved: Number(totals.daily_credits),
    dailyCreditLimit: Number(runtimeConfig().MUSIC_DAILY_CREDIT_LIMIT) || 0,
    dailyModelCalls: Number(models.daily_calls),
    dailyModelCallLimit: MUSIC_DAILY_PLAN_LIMIT,
    readyPlaylists: ready.filter((n) => n >= MUSIC_TARGET).length,
    playlistCount: MUSIC_PLAYLISTS.length,
    readyTracks: ready.reduce(
      (n, count) => n + Math.min(count, MUSIC_TARGET),
      0,
    ),
    targetTracks: MUSIC_PLAYLISTS.length * MUSIC_TARGET,
  };
}
export async function saveMusicAgent(tx: Tx, actor: string, body: unknown) {
  const b = musicAgentSettings.parse(body);
  await musicBudgetLock(tx);
  const a = await musicAgentSummary(tx);
  if (b.enabled && !b.recoveryConfirmed)
    throw fail(
      "MUSIC_RECOVERY",
      "Import and reconcile earlier purchases before starting the agent.",
    );
  if (
    b.externalRequests < Number(a.external_requests) ||
    b.externalCredits < Number(a.external_credits)
  )
    throw fail(
      "MUSIC_ACCOUNTING",
      "Recorded external usage cannot be reduced. Keep earlier purchases reserved.",
    );
  await tx.query(
    "UPDATE workout_music_agent SET enabled=$1,auto_publish=$2,recovery_confirmed=$3,external_requests=$4,external_credits=$5,requested_by=$6,status=$7,message=NULL,next_check_at=NULL,updated_at=now() WHERE id=true",
    [
      b.enabled,
      b.autoPublish,
      b.recoveryConfirmed,
      b.externalRequests,
      b.externalCredits,
      actor,
      b.enabled ? "starting" : "paused",
    ],
  );
  await tx.query(
    "INSERT INTO workout_music_audit(id,actor_id,action,detail) VALUES($1,$2,'agent_settings',$3)",
    [randomUUID(), actor, JSON.stringify(b)],
  );
  return { ok: true };
}
/** Standard arrangements for a plan's reserved slots. No model call. */
const standardBriefs = (playlist: string, slots: number[]) =>
  JSON.stringify(
    slots.map((slot) => ({ slot, brief: musicBrief(playlist, slot) })),
  );
const FALLBACK = "Standard arrangements used automatically.";
/** Why a plan was not used, built by code. Provider error text is not stored. */
function planFailure(e: unknown) {
  if (e instanceof MusicPlanRejected) return e.message;
  const code = (e as any)?.code,
    label =
      typeof code === "string" && /^[A-Z][A-Z0-9_]{1,40}$/.test(code)
        ? code
        : (e as any)?.name === "TimeoutError" ||
            (e as any)?.name === "AbortError"
          ? "timeout"
          : "error";
  return `The AI request did not complete (${label}).`;
}
async function state(tx: Tx, status: string, message: string, delay = 60) {
  await tx.query(
    "UPDATE workout_music_agent SET status=$1,message=$2,checked_at=now(),next_check_at=now()+($3 * interval '1 second') WHERE id=true AND enabled",
    [status, message, delay],
  );
}
/** Idempotent finite library fill. At most one planned batch or queued request per tick. */
export async function processMusicAgent(db: Database) {
  const [initial] = await db.system((tx) =>
    tx.query(
      "SELECT * FROM workout_music_agent WHERE id=true AND enabled AND (status IN ('budget','model_budget') OR next_check_at IS NULL OR next_check_at<=now())",
    ),
  );
  if (!initial) return;
  const config = runtimeConfig();
  if (
    config.MUSIC_ENABLED !== "true" ||
    !config.MUSIC_API_KEY ||
    !(Number(config.MUSIC_CREDITS_PER_JOB) > 0) ||
    !(
      Number(config.MUSIC_DAILY_CREDIT_LIMIT) >=
      Number(config.MUSIC_CREDITS_PER_JOB)
    ) ||
    !Number.isFinite(Number(config.MUSIC_DAILY_CREDIT_LIMIT))
  ) {
    await db.system((tx) =>
      state(
        tx,
        "configuration",
        "Enable music and set its key, request cost and daily budget in Settings.",
        300,
      ),
    );
    return;
  }
  // Resolve the existing Seed connection independently of the coaching profile.
  const seed = await resolveSiteStarterConfig(db),
    credits = await musicCredits().catch(() => null);
  if (credits === null) {
    await db.system((tx) =>
      state(
        tx,
        "provider",
        "The music provider could not be reached. Existing intents are preserved.",
        300,
      ),
    );
    return;
  }
  const result = await db.system(async (tx) => {
    await musicBudgetLock(tx);
    const a = await musicAgentSummary(tx);
    if (
      !a.enabled ||
      (!["budget", "model_budget"].includes(a.status) &&
        a.next_check_at &&
        new Date(a.next_check_at).getTime() > Date.now())
    )
      return;
    if (!a.recovery_confirmed || !a.requested_by) {
      await state(
        tx,
        "recovery",
        "Reconcile and import earlier purchases before generation.",
        300,
      );
      return;
    }
    // A plan that failed or was interrupted never stops the agent: its slots
    // take standard arrangements (no model call) and every playlist continues.
    // Its cost reservation and recorded usage are kept.
    const stalled = await tx.query(
      "SELECT id,playlist,slots,status,error FROM workout_music_plans WHERE status IN ('failed','unknown') OR (status='planning' AND leased_until<now())",
    );
    for (const p of stalled)
      await tx.query(
        "UPDATE workout_music_plans SET status='ready',briefs=$2,error=$3,leased_until=NULL,updated_at=now() WHERE id=$1",
        [
          p.id,
          standardBriefs(p.playlist, p.slots),
          `${FALLBACK} ${p.status === "planning" ? "Planning was interrupted." : "No checked plan was saved."}`,
        ],
      );
    const holds = await tx.query(
      "SELECT id FROM workout_music_jobs WHERE status='unknown' OR (status='submitting' AND leased_until<now()) LIMIT 1",
    );
    if (holds.length) {
      await state(
        tx,
        "reconciliation",
        "A submitted request has an unknown outcome. Attach its provider task before further generation.",
        300,
      );
      return;
    }
    const plans = await tx.query(
      "SELECT * FROM workout_music_plans ORDER BY created_at,id",
    );
    if (plans.some((p) => p.status === "planning")) return;
    const jobs = await tx.query(
        "SELECT id,playlist,slot,status,credit_limit,submitted_at,imported FROM workout_music_jobs",
      ),
      tracks = await tx.query(
        "SELECT playlist,status,count(*)::int AS n FROM workout_music_tracks GROUP BY playlist,status",
      );
    const count = (p: string, status?: string) =>
      tracks
        .filter(
          (t) =>
            t.playlist === p &&
            (status ? t.status === status : t.status !== "rejected"),
        )
        .reduce((n, t) => n + Number(t.n), 0);
    if (MUSIC_PLAYLISTS.every((p) => count(p.id, "approved") >= MUSIC_TARGET)) {
      await state(
        tx,
        "ready",
        "All eight playlists are ready. No generation while the library is full.",
        3600,
      );
      return;
    }
    const active = jobs.filter((j) =>
      ["queued", "submitting", "pending"].includes(j.status),
    );
    if (active.length >= 4) {
      await state(
        tx,
        "generating",
        "Downloading and checking the current batch.",
        30,
      );
      return;
    }
    const candidates = MUSIC_PLAYLISTS.map((p) => ({
      ...p,
      have: count(p.id),
      pending: active.filter((j) => j.playlist === p.id).length,
    })).sort((x, y) => x.have + x.pending * 2 - y.have - y.pending * 2);
    const genre = candidates.find((p) => p.have + p.pending * 2 < MUSIC_TARGET);
    if (!genre) {
      await state(
        tx,
        active.length ? "generating" : "review",
        active.length
          ? "Waiting for generated files."
          : "Enough files are saved. Review tracks or enable automatic publishing.",
        60,
      );
      return;
    }
    const perJob = Number(config.MUSIC_CREDITS_PER_JOB),
      daily = Number(config.MUSIC_DAILY_CREDIT_LIMIT);
    const outstanding = jobs
      .filter(
        (j) =>
          !j.imported &&
          ["queued", "submitting", "pending", "unknown"].includes(j.status),
      )
      .reduce((n, j) => n + Number(j.credit_limit), 0);
    if (outstanding + perJob > credits) {
      await state(
        tx,
        "credits",
        "Available provider credits are reserved or insufficient. No automatic top-up.",
        300,
      );
      return;
    }
    if (a.dailyCreditsReserved + perJob > daily) {
      await state(
        tx,
        "daily_budget",
        "Daily credit limit reached. The agent resumes when budget is available.",
        300,
      );
      return;
    }
    const used = new Set(
        jobs.filter((j) => j.playlist === genre.id).map((j) => Number(j.slot)),
      ),
      available = Array.from({ length: 60 }, (_, i) => i).filter(
        (i) => !used.has(i),
      );
    if (!available.length) {
      await state(
        tx,
        "slots",
        "This genre has used all generation slots.",
        300,
      );
      return;
    }
    const cached = plans
      .filter((p) => p.status === "ready" && p.playlist === genre.id)
      .flatMap((p) =>
        (p.briefs ?? []).map((b: any) => ({ ...b, planId: p.id })),
      )
      .find((b: any) => available.includes(b.slot));
    if (cached) {
      await tx.query(
        "INSERT INTO workout_music_jobs(id,playlist,slot,status,credit_limit,requested_by,brief,plan_id,auto_publish) VALUES($1,$2,$3,'queued',$4,$5,$6,$7,$8)",
        [
          randomUUID(),
          genre.id,
          cached.slot,
          perJob,
          a.requested_by,
          JSON.stringify(cached.brief),
          cached.planId,
          a.auto_publish,
        ],
      );
      await state(
        tx,
        "generating",
        "Generating, downloading and checking instrumental music.",
        15,
      );
      return;
    }
    if (!seed) {
      await state(
        tx,
        "model",
        "Configure the music planner's frontier model connection in Settings.",
        300,
      );
      return;
    }
    const inputPrice = Number(seed.MODEL_INPUT_USD_PER_MILLION),
      outputPrice = Number(seed.MODEL_OUTPUT_USD_PER_MILLION);
    // Bounded prompt (<4,000 chars) and output, conservative input-token reservation.
    const reserved =
      (4000 * inputPrice + MUSIC_PLAN_TOKENS * outputPrice) / 1_000_000;
    if (
      !(inputPrice >= 0) ||
      !(outputPrice > 0) ||
      !Number.isFinite(reserved) ||
      reserved <= 0
    ) {
      await state(
        tx,
        "model_price",
        "Set the model's token prices before automatic planning.",
        300,
      );
      return;
    }
    if (a.dailyModelCalls >= MUSIC_DAILY_PLAN_LIMIT) {
      await state(
        tx,
        "daily_planning_limit",
        "Today's planning limit is reached. Saved arrangements keep generating; new planning resumes tomorrow (UTC).",
        300,
      );
      return;
    }
    const slots = available.slice(
        0,
        Math.min(
          MUSIC_PLAN_SIZE,
          Math.ceil((MUSIC_TARGET - genre.have - genre.pending * 2) / 2),
        ),
      ),
      id = randomUUID();
    await tx.query(
      "INSERT INTO workout_music_plans(id,playlist,slots,status,prompt_version,model,reserved_usd,leased_until) VALUES($1,$2,$3,'planning',$4,$5,$6,now()+interval '5 minutes')",
      [
        id,
        genre.id,
        JSON.stringify(slots),
        MUSIC_PLAN_VERSION,
        seed.MODEL_NAME,
        reserved,
      ],
    );
    await state(
      tx,
      "planning",
      "The frontier model is arranging a batch of varied tracks.",
      60,
    );
    return { id, playlist: genre.id, slots };
  });
  if (!result || !seed) return;
  try {
    const briefs = await withRuntimeConfig(seed, () =>
      planMusic(result.playlist, result.slots, {
        reserve: async () => null,
        record: async (usage) => {
          await db.system((tx) =>
            tx.query(
              "UPDATE workout_music_plans SET usage=$2,updated_at=now() WHERE id=$1 AND usage IS NULL",
              [result.id, JSON.stringify(usage)],
            ),
          );
        },
      }),
    );
    await db.system(async (tx) => {
      await tx.query(
        "UPDATE workout_music_plans SET status='ready',briefs=$2,leased_until=NULL,updated_at=now() WHERE id=$1 AND status='planning'",
        [result.id, JSON.stringify(briefs)],
      );
      await state(
        tx,
        "generating",
        "Music arrangements saved. The worker will fill each playlist.",
        0,
      );
    });
  } catch (e) {
    const reason = planFailure(e),
      name =
        MUSIC_PLAYLISTS.find((p) => p.id === result.playlist)?.name ??
        result.playlist;
    await db.system(async (tx) => {
      await tx.query(
        "UPDATE workout_music_plans SET status='ready',briefs=$2,error=$3,leased_until=NULL,updated_at=now() WHERE id=$1 AND status='planning'",
        [
          result.id,
          standardBriefs(result.playlist, result.slots),
          `${FALLBACK} ${reason}`,
        ],
      );
      await state(
        tx,
        "generating",
        `The AI plan for ${name} was not used, so standard arrangements fill its slots. No AI retry was sent. ${reason}`,
        0,
      );
    });
  }
}
export async function useStandardMusicPlan(tx: Tx, id: string, actor: string) {
  await musicBudgetLock(tx);
  const [p] = await tx.query(
    "SELECT * FROM workout_music_plans WHERE id=$1 FOR UPDATE",
    [id],
  );
  if (!p || !["failed", "unknown"].includes(p.status))
    throw fail(
      "MUSIC_PLAN_STATE",
      "Only a failed or interrupted plan can use standard briefs.",
    );
  await tx.query(
    "UPDATE workout_music_plans SET status='ready',briefs=$2,error=NULL,updated_at=now() WHERE id=$1",
    [id, standardBriefs(p.playlist, p.slots)],
  );
  await tx.query(
    "UPDATE workout_music_agent SET next_check_at=NULL WHERE id=true",
  );
  await tx.query(
    "INSERT INTO workout_music_audit(id,actor_id,subject_id,action) VALUES($1,$2,$3,'standard_briefs')",
    [randomUUID(), actor, id],
  );
  return { ok: true };
}
