/**
 * "Check my Brain": one check over the coach's held-out cases with a result
 * per area (Brain replies, routine replies, plans, nutrition), re-run in the
 * background after every edit. The last passing version stays live while a
 * re-check runs; a new version goes live only when every area that is live
 * today passes on it. docs/features/brain-check.md describes the API.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import {
  elevated,
  event,
  putRecord,
  type Actor,
  type Database,
  type Tx,
} from "@trainer/db";
import { ProviderUnavailable } from "@trainer/providers";
import { OWN_CASES_FOR_FULL_CHECK } from "../../../packages/domain/src/brain-teach.ts";
import { brainTrainingState, confirmedRulesDigest } from "./brain-training-state.ts";
import { evaluateBrainReplies } from "./brain-replies-check.ts";
import {
  activateCoachingRuntime,
  coachingRuntimeReadiness,
  evaluateCoachingRuntime,
  lockRuntime,
} from "./coaching-runtime.ts";
import {
  loadPlanSettings,
  planQualificationState,
  qualifyPlanGeneration,
} from "./brain-plans.ts";
import {
  evaluateNutritionKnowledge,
  nutritionMaterial,
} from "./nutrition.ts";

export const BRAIN_CHECK_JOB = "brain_check";
/** Background checks run model calls one after another; the claim covers them. */
export const BRAIN_CHECK_LEASE_SECONDS = 1800;
/** Edits within this window are checked together. */
const RECHECK_DELAY_SECONDS = 60;

const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });

export type CheckArea = "replies" | "actions" | "plans" | "nutrition";
export const AREA_LABELS: Record<CheckArea, string> = {
  replies: "Brain replies",
  actions: "Routine replies",
  plans: "Plans",
  nutrition: "Nutrition",
};
type AreaResult = {
  state:
    | "passed"
    | "failed"
    | "needs_cases"
    | "not_used"
    | "unchanged"
    | "unavailable";
  checkId?: string;
  passed?: number;
  total?: number;
  message?: string;
};

/**
 * Asks for a background check of the current material. Edits close together
 * are checked once: the one pending request per workspace is pushed back
 * (and re-armed if a run is under way, so that run's result does not hide
 * the newer edit). Runs in the caller's workspace scope.
 */
export async function requestBrainCheck(
  tx: Tx,
  a: Actor,
  trigger: string,
  delaySeconds = RECHECK_DELAY_SECONDS,
) {
  await tx.query(
    `INSERT INTO jobs(id,tenant_id,kind,intent_key,data,available_at) VALUES($1,$2,'${BRAIN_CHECK_JOB}',$3,$4,now()+make_interval(secs=>$5))
     ON CONFLICT(intent_key) DO UPDATE SET status='pending',attempts=0,last_error=NULL,data=EXCLUDED.data,available_at=EXCLUDED.available_at`,
    [
      randomUUID(),
      a.tenantId,
      `${BRAIN_CHECK_JOB}:${a.tenantId}`,
      JSON.stringify({ trigger, requestedBy: a.userId }),
      delaySeconds,
    ],
  );
}

// Writes that change what a check covers: rules, teaching cases, actions,
// held-out cases, plan settings and nutrition teaching. A successful one asks
// for a background re-check.
const EDIT_ROUTES = [
  /^\/api\/v1\/brain\/rules(\/[^/]+\/confirm|\/approve-all|\/[^/]+)?$/,
  /^\/api\/v1\/brain\/conflicts\/[^/]+\/resolve$/,
  /^\/api\/v1\/brain\/(scenarios|coaching-actions|teaching-cases|coaching-scenarios)(\/[^/]+\/archive)?$/,
  /^\/api\/v1\/brain\/releases(\/supervised|\/[^/]+\/rollback)?$/,
  /^\/api\/v1\/brain\/plans\/(settings|scenarios)(\/[^/]+\/archive)?$/,
  /^\/api\/v1\/coaching\/feedback\/[^/]+\/confirm-teaching$/,
  /^\/api\/v1\/nutrition\/(cases(\/[^/]+)?|sources\/[^/]+\/confirm|foods|recipes|policy(\/[^/]+\/confirm)?|scenarios(\/[^/]+\/archive)?)$/,
];
export function isBrainEdit(method: string, path: string) {
  return (
    ["POST", "PUT", "PATCH", "DELETE"].includes(method) &&
    EDIT_ROUTES.some((r) => r.test(path.split("?")[0]))
  );
}

async function workspaceOwner(tx: Tx, preferred?: string) {
  const rows = await tx.query(
    "SELECT user_id FROM memberships WHERE role='owner' ORDER BY (user_id::text=$1) DESC,user_id LIMIT 1",
    [preferred ?? ""],
  );
  return rows[0]?.user_id as string | undefined;
}
const setting = (error: unknown): AreaResult => {
  const e = error as { statusCode?: number; message?: string };
  if (e?.statusCode === 409 || e?.statusCode === 400)
    return { state: "needs_cases", message: String(e.message ?? "") };
  if (error instanceof ProviderUnavailable)
    return { state: "unavailable", message: "The model connection is not available; your live Brain is unchanged." };
  throw error;
};
const scenarioIds = (rows: any[]) =>
  JSON.stringify(rows.map((r) => r.id).sort());

/**
 * The background check. Runs every area whose material changed since its
 * last check, then promotes the new version when everything that is live
 * today passed on it. Nothing is sent to a member here.
 */
export async function runBrainCheck(
  db: Database,
  tenantId: string,
  trigger: string,
  requestedBy?: string,
) {
  const system = elevated("worker", { tenantId, role: "owner" });
  const ownerId = await db.tenant(system, (tx) => workspaceOwner(tx, requestedBy));
  if (!ownerId) return null;
  const a = elevated("worker", { tenantId, role: "owner", userId: ownerId });
  const start = await db.tenant(a, async (tx) => {
    const s = await brainTrainingState(tx);
    const [runtime] = await tx.query(
      "SELECT * FROM records WHERE kind='coaching_runtime_release' AND status='published' ORDER BY created_at DESC,id DESC LIMIT 1",
    );
    let readiness: Awaited<ReturnType<typeof coachingRuntimeReadiness>> | null = null;
    try {
      readiness = await coachingRuntimeReadiness(tx);
    } catch (error) {
      if ((error as any).statusCode !== 409) throw error;
    }
    const [actionCount] = await tx.query(
      "SELECT count(*)::int AS n FROM records WHERE kind='coaching_action' AND status='confirmed'",
    );
    const { settings } = await loadPlanSettings(tx);
    const plans = await planQualificationState(tx, settings);
    const nutrition = await nutritionState(tx);
    return { s, runtime: runtime ?? null, readiness, actions: actionCount.n as number, plans, nutrition };
  });
  const { s } = start;
  // Before the coach goes live, only a check they ask for runs (the setup
  // wizard has its own steps); nothing is live to keep or replace.
  if (!s.release && trigger !== "manual") return null;
  const areas: Record<CheckArea, AreaResult> = {
    replies: { state: "not_used" },
    actions: { state: "not_used" },
    plans: { state: "not_used" },
    nutrition: { state: "not_used" },
  };
  const promoted: Record<string, string> = {};

  // Brain replies: the approved rules against the coach's own held-out cases.
  let replies: any = null;
  if (s.confirmed.length) {
    const latest = s.latestEvaluation;
    const same =
      latest && scenarioIds(s.ownCases) === scenarioIds((latest.data.outcomes ?? []).map((o: any) => ({ id: o.scenarioId })));
    if (same) {
      replies = latest;
      areas.replies = { state: "unchanged", checkId: latest.id, passed: latest.data.passed, total: latest.data.total };
    } else {
      try {
        replies = await evaluateBrainReplies(db, a);
        areas.replies = {
          state: replies.status === "passed" ? "passed" : "failed",
          checkId: replies.id,
          passed: replies.data.passed,
          total: replies.data.total,
        };
      } catch (error) {
        areas.replies = setting(error);
      }
    }
  }
  const liveRelease = s.release;
  const rulesChanged =
    !!liveRelease && confirmedRulesDigest(liveRelease.data.rules ?? []) !== s.rulesDigest;

  if (rulesChanged && replies?.status === "passed" && !s.openConflicts) {
    // A candidate release: checked against every live area before it is published.
    const candidate = await db.tenant(a, (tx) =>
      putRecord(
        tx,
        a,
        "brain_release",
        {
          rules: s.confirmed.map((r) => ({ id: r.id, data: r.data, version: r.version })),
          evaluationId: replies.id,
          notes: "Re-checked automatically after your edits",
          mode: "supervised",
          qualification: Number(replies.data.total ?? 0) >= OWN_CASES_FOR_FULL_CHECK ? "full" : "quiz",
          replaces: liveRelease.id,
          checkedAutomatically: true,
        },
        { status: "candidate" },
      ),
    );
    let actionsEval: any = null,
      ok = true;
    if (start.runtime && start.actions) {
      try {
        actionsEval = await evaluateCoachingRuntime(db, a, { candidateBrain: candidate });
        areas.actions = {
          state: actionsEval.status === "passed" ? "passed" : "failed",
          checkId: actionsEval.id,
          passed: actionsEval.data.passed,
          total: actionsEval.data.total,
        };
      } catch (error) {
        areas.actions = setting(error);
      }
      ok &&= areas.actions.state === "passed";
    }
    if (start.plans.qualified) {
      try {
        const plan = await qualifyPlanGeneration(db, a, { candidateRelease: candidate });
        areas.plans = {
          state: plan.status === "passed" ? "passed" : "failed",
          checkId: plan.id,
          passed: plan.data.passed,
          total: plan.data.total,
        };
      } catch (error) {
        areas.plans = setting(error);
      }
      ok &&= areas.plans.state === "passed";
    }
    const outcome = await db.tenant(a, async (tx) => {
      await lockRuntime(tx, a);
      const now = await brainTrainingState(tx);
      const stale =
        now.rulesDigest !== s.rulesDigest ||
        now.release?.id !== liveRelease.id ||
        now.openConflicts > 0;
      if (!ok || stale) {
        await tx.query(
          "UPDATE records SET status='check_failed',version=version+1,updated_at=now(),data=data||$2::jsonb WHERE id=$1",
          [candidate.id, JSON.stringify({ reason: stale ? "changed_during_check" : "check_failed" })],
        );
        return { promoted: false, stale };
      }
      await tx.query(
        "UPDATE records SET status='archived',version=version+1,updated_at=now() WHERE kind='brain_release' AND status='published'",
      );
      await tx.query(
        "UPDATE records SET status='published',version=version+1,updated_at=now() WHERE id=$1",
        [candidate.id],
      );
      await event(tx, a, "brain.release_published", candidate.id, { automatic: true });
      if (start.runtime && actionsEval) {
        const runtime = await activateCoachingRuntime(tx, a, {
          evaluationId: actionsEval.id,
          mode: start.runtime.data.mode,
          expectedReleaseId: start.runtime.id,
        });
        return { promoted: true, runtimeId: runtime.id as string };
      }
      return { promoted: true };
    }).catch((error) => {
      // The level gate (Sends automatically) can refuse the new version; the
      // last passing version stays live.
      if ((error as any).statusCode !== 409) throw error;
      areas.actions = { ...areas.actions, state: "failed", message: (error as Error).message };
      return db.tenant(a, async (tx) => {
        await tx.query(
          "UPDATE records SET status='check_failed',version=version+1,updated_at=now() WHERE id=$1 AND status='candidate'",
          [candidate.id],
        );
        return { promoted: false, stale: false };
      });
    });
    if (outcome.promoted) {
      promoted.brainReleaseId = candidate.id;
      if ((outcome as any).runtimeId) promoted.runtimeReleaseId = (outcome as any).runtimeId;
    } else if ((outcome as any).stale) {
      // Newer edits arrived; they have their own pending check.
      areas.replies.message = "Your rules changed during the check; the newer version is checked next.";
    }
  } else if (start.runtime && start.actions && start.readiness && !start.readiness.current) {
    // Routine replies changed (actions, teaching cases, held-out cases or the
    // model): check the current material with the live Brain release.
    try {
      const evaluation = await evaluateCoachingRuntime(db, a);
      areas.actions = {
        state: evaluation.status === "passed" ? "passed" : "failed",
        checkId: evaluation.id,
        passed: evaluation.data.passed,
        total: evaluation.data.total,
      };
      if (evaluation.status === "passed") {
        const runtime = await db.tenant(a, async (tx) => {
          await lockRuntime(tx, a);
          return activateCoachingRuntime(tx, a, {
            evaluationId: evaluation.id,
            mode: start.runtime.data.mode,
            expectedReleaseId: start.runtime.id,
          });
        }).catch((error) => {
          if ((error as any).statusCode !== 409) throw error;
          areas.actions = { ...areas.actions, state: "failed", message: (error as Error).message };
          return null;
        });
        if (runtime) promoted.runtimeReleaseId = runtime.id;
      }
    } catch (error) {
      areas.actions = setting(error);
    }
  } else if (start.runtime && start.actions) {
    areas.actions = { state: "unchanged" };
  }

  // Plans: re-qualify when they were qualified before and are not now (a
  // setting, held-out case or model change), unless the promotion above
  // already checked them.
  if (areas.plans.state === "not_used" && start.plans.latest) {
    if (start.plans.qualified) areas.plans = { state: "unchanged" };
    else if (
      start.plans.latest.data.contractDigest !== start.plans.contractDigest ||
      start.plans.latest.data.scenariosDigest !== start.plans.scenariosDigest
    ) {
      try {
        const plan = await qualifyPlanGeneration(db, a);
        areas.plans = {
          state: plan.status === "passed" ? "passed" : "failed",
          checkId: plan.id,
          passed: plan.data.passed,
          total: plan.data.total,
        };
      } catch (error) {
        areas.plans = setting(error);
      }
    } else
      areas.plans = {
        state: "failed",
        checkId: start.plans.latest.id,
        passed: start.plans.latest.data.passed,
        total: start.plans.latest.data.total,
      };
  }

  // Nutrition: evaluated in the background; switching the updated nutrition
  // on still needs the coach's reviewed sample week (unchanged).
  if (start.nutrition.used) {
    if (start.nutrition.evaluation)
      areas.nutrition = {
        state: start.nutrition.evaluation.status === "passed" ? "unchanged" : "failed",
        checkId: start.nutrition.evaluation.id,
        passed: start.nutrition.evaluation.data.passed,
        total: start.nutrition.evaluation.data.total,
      };
    else
      try {
        const evaluation = await evaluateNutritionKnowledge(db, a, false);
        areas.nutrition = {
          state: evaluation.status === "passed" ? "passed" : "failed",
          checkId: evaluation.id,
          passed: evaluation.data.passed,
          total: evaluation.data.total,
          ...(evaluation.status === "passed" && !start.nutrition.live
            ? { message: "Review a sample week, then switch the updated nutrition on." }
            : {}),
        };
      } catch (error) {
        areas.nutrition = setting(error);
      }
  }

  return db.tenant(a, async (tx) => {
    const checked = Object.values(areas).filter((r) => r.state !== "not_used");
    const status = checked.some((r) => r.state === "failed")
      ? "failed"
      : checked.some((r) => r.state === "needs_cases" || r.state === "unavailable")
        ? "incomplete"
        : checked.length
          ? "passed"
          : "nothing_to_check";
    const row = await putRecord(
      tx,
      a,
      "brain_check",
      { trigger, areas, promoted, rulesDigest: s.rulesDigest },
      { status },
    );
    await event(tx, a, "brain.check_completed", row.id, { status, promoted: Object.keys(promoted).length > 0 });
    return row;
  });
}

async function nutritionState(tx: Tx) {
  const [release] = await tx.query(
    "SELECT * FROM records WHERE kind='nutrition_release' AND status IN ('published','needs_recheck','paused') ORDER BY created_at DESC,id DESC LIMIT 1",
  );
  if (!release) return { used: false, live: false, evaluation: null as any };
  const m = await nutritionMaterial(tx);
  const [evaluation] = await tx.query(
    "SELECT * FROM records WHERE kind='nutrition_evaluation' AND data->>'digest'=$1 ORDER BY created_at DESC,id DESC LIMIT 1",
    [m.digest],
  );
  return {
    used: true,
    live: release.status === "published" && release.data.digest === m.digest,
    evaluation: evaluation ?? null,
  };
}

/** Worker entry point for a `brain_check` job. */
export async function executeBrainCheckJob(db: Database, tenantId: string, job: any) {
  return runBrainCheck(db, tenantId, String(job.data?.trigger ?? "edit"), job.data?.requestedBy);
}

/** What "Check my Brain" shows: one held-out set, per-area results, what is live. */
async function checkOverview(tx: Tx, a: Actor) {
  const s = await brainTrainingState(tx);
  const counts = await tx.query(
    "SELECT kind,count(*)::int AS n FROM records WHERE status='held_out' AND kind IN ('scenario','coaching_scenario','plan_scenario','nutrition_scenario') GROUP BY kind",
  );
  const n = (kind: string) => counts.find((c) => c.kind === kind)?.n ?? 0;
  let runtime: Awaited<ReturnType<typeof coachingRuntimeReadiness>> | null = null;
  try {
    runtime = await coachingRuntimeReadiness(tx);
  } catch (error) {
    if ((error as any).statusCode !== 409) throw error;
  }
  const { settings } = await loadPlanSettings(tx);
  const plans = await planQualificationState(tx, settings);
  const nutrition = await nutritionState(tx);
  const [pending] = await tx.query(
    "SELECT status,available_at,leased_until FROM jobs WHERE intent_key=$1",
    [`${BRAIN_CHECK_JOB}:${a.tenantId}`],
  );
  const [last] = await tx.query(
    "SELECT id,status,data,created_at FROM records WHERE kind='brain_check' ORDER BY created_at DESC,id DESC LIMIT 1",
  );
  const releaseCurrent =
    !!s.release && confirmedRulesDigest(s.release.data.rules ?? []) === s.rulesDigest;
  const rechecking = pending?.status === "pending";
  const areas = {
    replies: {
      label: AREA_LABELS.replies,
      used: s.confirmed.length > 0,
      live: !!s.release,
      upToDate: releaseCurrent,
      cases: n("scenario"),
    },
    actions: {
      label: AREA_LABELS.actions,
      used: !!runtime?.releaseId,
      live: !!runtime?.live,
      upToDate: !!runtime?.current,
      mode: runtime?.mode ?? null,
      cases: n("coaching_scenario"),
    },
    plans: {
      label: AREA_LABELS.plans,
      used: !!plans.latest,
      live: plans.qualified,
      upToDate: plans.qualified,
      cases: n("plan_scenario"),
    },
    nutrition: {
      label: AREA_LABELS.nutrition,
      used: nutrition.used,
      live: nutrition.live,
      upToDate: nutrition.live,
      cases: n("nutrition_scenario"),
    },
  };
  const used = Object.values(areas).filter((x) => x.used);
  return {
    state: !s.release
      ? "not_live"
      : rechecking || used.some((x) => !x.upToDate)
        ? rechecking
          ? "rechecking"
          : "needs_attention"
        : "up_to_date",
    /** Plain words for the coach. */
    summary: !s.release
      ? "Your Brain is not live yet."
      : rechecking
        ? "Re-checking your changes. Your last checked version stays live meanwhile."
        : used.every((x) => x.upToDate)
          ? "Your Brain is checked and live."
          : "Some changes did not pass the check. Your last checked version stays live.",
    heldOut: {
      total: areas.replies.cases + areas.actions.cases + areas.plans.cases + areas.nutrition.cases,
      byArea: {
        replies: areas.replies.cases,
        actions: areas.actions.cases,
        plans: areas.plans.cases,
        nutrition: areas.nutrition.cases,
      },
    },
    areas,
    recheck: pending
      ? { status: pending.status, at: pending.available_at, running: !!pending.leased_until && new Date(pending.leased_until) > new Date() }
      : null,
    lastCheck: last
      ? {
          id: last.id,
          status: last.status,
          at: last.created_at,
          trigger: last.data.trigger,
          areas: Object.fromEntries(
            Object.entries(last.data.areas ?? {}).map(([k, v]: [string, any]) => [
              k,
              { ...v, label: AREA_LABELS[k as CheckArea] },
            ]),
          ),
          promoted: !!Object.keys(last.data.promoted ?? {}).length,
        }
      : null,
  };
}

/** The coach's held-out cases in one list (owner only: these are the check's answers). */
async function heldOutCases(tx: Tx) {
  const rows = await tx.query(
    "SELECT id,kind,version,data,created_at FROM records WHERE status='held_out' AND kind IN ('scenario','coaching_scenario','plan_scenario','nutrition_scenario') ORDER BY created_at,id LIMIT 400",
  );
  const area: Record<string, CheckArea> = {
    scenario: "replies",
    coaching_scenario: "actions",
    plan_scenario: "plans",
    nutrition_scenario: "nutrition",
  };
  return rows.map((r) => ({
    id: r.id,
    version: r.version,
    area: area[r.kind],
    label: AREA_LABELS[area[r.kind]],
    text: String(r.data.prompt ?? r.data.name ?? r.data.title ?? r.data.profile?.goal ?? ""),
    createdAt: r.created_at,
  }));
}

export function registerBrainCheck(
  app: FastifyInstance,
  db: Database,
  identity: (req: FastifyRequest) => Actor,
) {
  const trainer = (req: FastifyRequest) => {
    const a = identity(req);
    if (!["owner", "staff"].includes(a.role))
      throw fail(403, "ROLE_REQUIRED", "Trainer access required");
    return a;
  };
  const owner = (req: FastifyRequest) => {
    const a = identity(req);
    if (a.role !== "owner")
      throw fail(403, "OWNER_REQUIRED", "Only the trainer owner can do this");
    return a;
  };
  // Every successful edit asks for a background re-check.
  app.addHook("onSend", async (req, reply, payload) => {
    if (reply.statusCode >= 300 || !(req as any).identity) return payload;
    const a = (req as any).identity as Actor;
    if (!["owner", "staff"].includes(a.role)) return payload;
    if (!isBrainEdit(req.method, req.url)) return payload;
    try {
      await db.tenant(a, (tx) => requestBrainCheck(tx, a, "edit"));
    } catch (error) {
      req.log.warn({ err: error }, "Brain re-check could not be requested");
    }
    return payload;
  });
  app.get("/api/v1/brain/check", async (req) => {
    const a = trainer(req);
    return db.tenant(a, (tx) => checkOverview(tx, a));
  });
  app.post("/api/v1/brain/check", async (req) => {
    const a = owner(req);
    return db.tenant(a, async (tx) => {
      await requestBrainCheck(tx, a, "manual", 0);
      return checkOverview(tx, a);
    });
  });
  app.get("/api/v1/brain/check/cases", async (req) => {
    const a = owner(req);
    return db.tenant(a, async (tx) => ({ cases: await heldOutCases(tx) }));
  });
}
