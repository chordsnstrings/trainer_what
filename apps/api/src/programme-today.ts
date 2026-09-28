import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  type Actor,
  type Database,
  type Tx,
  elevated,
  event,
} from "@trainer/db";
import { stripeClient } from "@trainer/providers";
import {
  ENDING_NOTICE_DAYS,
  addDays,
  adherence,
  dateIn,
  effectiveProgrammeWindow,
  endOfProgramme,
  programmePosition,
  programmeTimeline,
  validTimeZone,
  type PlannedDay,
  type ProgrammeBilling,
  type ProgrammePosition,
} from "../../../packages/domain/src/programme.ts";
import {
  consumedNutrition,
  currentMealLogs,
} from "../../../packages/domain/src/nutrition-completion.ts";
import { memberAccess } from "./entitlements.ts";
import { subscriptionHasAccess } from "./finance-billing.ts";
import { notifyUser } from "./notifications.ts";
import { endOrphanedVoiceAddOns } from "./voice-addon.ts";
import { promoteQueuedProgramme } from "./programme-billing.ts";

/**
 * The subscriber's day-by-day view (docs/features/programme.md): where they
 * are in the programme, today's session or rest day, what is next, streak and
 * adherence, today's nutrition target and diary progress, the timeline of the
 * current programme or block, and what happens when it ends. All reads run in
 * the member's own subscriber scope.
 */
const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
/** Monthly rows read per page by the block sweep. */
const BLOCK_PAGE = 500;
/** A block notice is still sent this many days into a block after an outage. */
const BLOCK_CATCH_UP_DAYS = 7;

async function memberTimeZone(tx: Tx, userId: string, requested?: unknown) {
  if (validTimeZone(requested)) return requested;
  const [pref] = await tx.query(
    "SELECT data->>'timezone' AS timezone FROM notification_preferences WHERE user_id=$1",
    [userId],
  );
  if (validTimeZone(pref?.timezone)) return pref.timezone as string;
  const [session] = await tx.query(
    "SELECT data->>'timezone' AS timezone FROM records WHERE kind='planned_session' AND owner_user_id=$1 ORDER BY created_at DESC LIMIT 1",
    [userId],
  );
  return validTimeZone(session?.timezone)
    ? (session.timezone as string)
    : "Asia/Dubai";
}

type ProgrammeSource = {
  billing: ProgrammeBilling;
  programmeDays: unknown;
  startsAt: string;
  endsAt: string | null;
  accessActive: boolean;
  cancelAtPeriodEnd: boolean;
  productId: string | null;
  /** A renewed upfront programme that starts when the current one ends. */
  queued?: { startsAt: string; programmeDays: number } | null;
};
async function programmeSource(
  tx: Tx,
  userId: string,
  access: Awaited<ReturnType<typeof memberAccess>>,
): Promise<ProgrammeSource | null> {
  const [s] = await tx.query(
    "SELECT status,period_end,cancel_at_period_end,data FROM subscriptions WHERE user_id=$1",
    [userId],
  );
  const paid = !!s && subscriptionHasAccess(s);
  if (s && (paid || s.data?.billing === "upfront" || !access.grant)) {
    const upfront = s.data?.billing === "upfront";
    // A renewed upfront programme is queued after the current one.
    const window = effectiveProgrammeWindow(s.data);
    let startsAt: string | undefined =
      window.programmeStartsAt ??
      (upfront ? s.data?.upfront?.startsAt : undefined) ??
      s.data?.firstPaidAt;
    if (!startsAt) {
      // A membership stored before programme starts existed: its first plan.
      const [first] = await tx.query(
        "SELECT min(data->>'date') AS date FROM records WHERE kind='planned_session' AND owner_user_id=$1",
        [userId],
      );
      startsAt = first?.date ? first.date + "T12:00:00Z" : new Date().toISOString();
    }
    return {
      billing: upfront ? "upfront" : "monthly",
      programmeDays: window.programmeDays ?? null,
      startsAt,
      endsAt: window.endsAt
        ? new Date(window.endsAt).toISOString()
        : s.period_end
          ? new Date(s.period_end).toISOString()
          : null,
      accessActive: paid,
      cancelAtPeriodEnd: !!s.cancel_at_period_end,
      productId: window.productId,
      queued: window.queued
        ? {
            startsAt: String(window.queued.startsAt),
            programmeDays: Number(window.queued.programmeDays),
          }
        : null,
    };
  }
  if (access.grant)
    return {
      billing: "complimentary",
      programmeDays: null,
      startsAt: new Date(access.grant.starts_at).toISOString(),
      endsAt: access.grant.ends_at
        ? new Date(access.grant.ends_at).toISOString()
        : null,
      accessActive: true,
      cancelAtPeriodEnd: false,
      productId: null,
      queued: null,
    };
  return null;
}

async function plannedDays(
  tx: Tx,
  userId: string,
  from: string,
  to: string,
): Promise<PlannedDay[]> {
  const rows = await tx.query(
    "SELECT id,status,data->>'date' AS date,left(data->>'label',160) AS label,(data->>'week')::int AS week,jsonb_array_length(coalesce(data->'program'->'exercises','[]'::jsonb)) AS exercises FROM records WHERE kind='planned_session' AND owner_user_id=$1 AND data->>'date' BETWEEN $2 AND $3 ORDER BY data->>'date',created_at LIMIT 800",
    [userId, from, to],
  );
  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    label: r.label ?? undefined,
    status: r.status,
    week: r.week ?? undefined,
    exercises: Number(r.exercises ?? 0),
  }));
}

async function todayNutrition(tx: Tx, userId: string) {
  const [consent] = await tx.query(
    "SELECT granted FROM consent_records WHERE user_id=$1 AND document_type='nutrition' ORDER BY created_at DESC,id DESC LIMIT 1",
    [userId],
  );
  if (!consent?.granted) return { state: "permission" as const };
  const [profile] = await tx.query(
    "SELECT data FROM records WHERE kind='nutrition_profile' AND owner_user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1",
    [userId],
  );
  if (!profile) return { state: "setup" as const };
  const zone = validTimeZone(profile.data?.profile?.timezone)
    ? profile.data.profile.timezone
    : "Asia/Dubai";
  const date = dateIn(zone, new Date());
  const [target] = await tx.query(
    "SELECT data FROM records WHERE kind='nutrition_target' AND owner_user_id=$1 AND status='active' ORDER BY created_at DESC,id DESC LIMIT 1",
    [userId],
  );
  const logs = await tx.query(
    "SELECT id,data FROM records WHERE kind='nutrition_log' AND owner_user_id=$1 AND data->>'date'=$2 ORDER BY created_at LIMIT 300",
    [userId, date],
  );
  const plans = await tx.query(
    "SELECT id,status,data FROM records WHERE kind='nutrition_plan' AND owner_user_id=$1 AND status='delivered' ORDER BY created_at DESC LIMIT 3",
    [userId],
  );
  const day = consumedNutrition(
    currentMealLogs(logs as any) as any,
    plans as any,
    [],
    date,
  ).days.at(-1);
  const t = target?.data?.target;
  return {
    state: "ready" as const,
    date,
    target: t
      ? {
          kcal: t.kcal,
          protein: t.protein ?? null,
          carbohydrate: t.carbohydrate ?? null,
          fat: t.fat ?? null,
          hydrationMl: t.hydrationMl ?? null,
          reviewDue: typeof t.reviewOn === "string" && t.reviewOn < date,
        }
      : null,
    planned: day?.planned ?? null,
    meals: day?.meals ?? 0,
    consumed: day?.knownTotals ?? null,
    unknown: day?.unknown ?? null,
  };
}

export type PlanState = "none" | "awaiting_coach" | "ready" | "ended";
async function load(tx: Tx, userId: string, requestedZone?: unknown) {
  const access = await memberAccess(tx, userId);
  const timeZone = await memberTimeZone(tx, userId, requestedZone);
  const source = await programmeSource(tx, userId, access);
  const position: ProgrammePosition | null = source
    ? programmePosition({
        billing: source.billing,
        programmeDays: source.programmeDays,
        startsAt: source.startsAt,
        endsAt: source.billing === "upfront" ? source.endsAt : null,
        timeZone,
      })
    : null;
  // A day with no session is a rest day only when the block has a plan:
  // before one exists (the coach or the Brain is still preparing it, or it
  // waits for the coach's review) nothing is scheduled yet, and once access
  // has ended there is nothing to follow.
  let planState: PlanState = "none";
  if (source && position) {
    if (!source.accessActive || position.state === "complete")
      planState = "ended";
    else {
      const [planned] = await tx.query(
        "SELECT 1 FROM records WHERE kind='planned_session' AND owner_user_id=$1 AND data->>'date' BETWEEN $2 AND $3 LIMIT 1",
        [userId, position.blockStartDate, position.blockEndDate],
      );
      planState = planned ? "ready" : "awaiting_coach";
    }
  }
  return { access, timeZone, source, position, planState };
}

export async function programmeToday(
  db: Database,
  a: Actor,
  requestedZone?: unknown,
) {
  if (a.role !== "subscriber")
    throw fail(403, "SUBSCRIBER_REQUIRED", "Subscriber access required");
  return db.tenant(a, async (tx) => {
    const { access, timeZone, source, position, planState } = await load(
      tx,
      a.userId,
      requestedZone,
    );
    const today = dateIn(timeZone, new Date());
    const sessions = await plannedDays(
      tx,
      a.userId,
      addDays(today, -27),
      addDays(today, 60),
    );
    const todays = sessions.filter((s) => s.date === today);
    const session =
      todays.find((s) => s.status !== "canceled") ?? todays[0] ?? null;
    const next =
      sessions.find((s) => s.date > today && s.status === "planned") ?? null;
    const end = source?.queued
      ? // A renewed upfront programme follows the current one.
        {
          state: "next_block" as const,
          at: dateIn(timeZone, new Date(source.queued.startsAt)),
        }
      : endOfProgramme({
          billing: source?.billing ?? null,
          position,
          accessEndsAt: source?.endsAt ?? null,
          accessActive: source?.accessActive ?? false,
          cancelAtPeriodEnd: source?.cancelAtPeriodEnd,
        });
    const [offer] =
      source?.productId && "canRenew" in end && end.canRenew
        ? await tx.query(
            "SELECT id,status,data FROM records WHERE id=$1 AND kind='product'",
            [source.productId],
          )
        : [];
    return {
      timeZone,
      today,
      access: {
        active: access.active,
        sources: access.sources,
        modules: access.modules,
        premiumVoice: access.premiumVoice,
      },
      programme:
        source && position
          ? {
              ...position,
              startsAt: source.startsAt,
              endsAt: source.endsAt,
              lengthDays: position.of,
            }
          : null,
      session: session
        ? {
            id: session.id,
            label: session.label ?? null,
            status: session.status,
            week: session.week ?? null,
            exercises: session.exercises ?? 0,
          }
        : null,
      planState,
      restDay: planState === "ready" && !session,
      nextProgramme: source?.queued ?? null,
      next: next
        ? {
            id: next.id,
            date: next.date,
            label: next.label ?? null,
            inDays: Math.round(
              (Date.parse(next.date + "T12:00:00Z") -
                Date.parse(today + "T12:00:00Z")) /
                86400000,
            ),
          }
        : null,
      progress: adherence(sessions, today),
      nutrition: access.modules.includes("nutrition")
        ? await todayNutrition(tx, a.userId)
        : null,
      endOfProgramme: {
        ...end,
        renewProductId:
          offer?.status === "published" && offer.data?.stripePriceId
            ? offer.id
            : null,
      },
    };
  });
}

export async function programmeTimelineView(
  db: Database,
  a: Actor,
  requestedZone?: unknown,
) {
  if (a.role !== "subscriber")
    throw fail(403, "SUBSCRIBER_REQUIRED", "Subscriber access required");
  return db.tenant(a, async (tx) => {
    const { timeZone, source, position, planState } = await load(
      tx,
      a.userId,
      requestedZone,
    );
    if (!source || !position)
      return { timeZone, programme: null, planState, days: [] };
    const sessions = await plannedDays(
      tx,
      a.userId,
      position.blockStartDate,
      position.blockEndDate,
    );
    return {
      timeZone,
      programme: {
        ...position,
        startsAt: source.startsAt,
        endsAt: source.endsAt,
        lengthDays: position.of,
      },
      planState,
      // Without a plan for the block, its days are not rest days yet.
      days: programmeTimeline(position, sessions).map((d) =>
        planState !== "ready" && d.kind === "rest"
          ? { ...d, kind: "unplanned" as const, status: "unplanned" as const }
          : d,
      ),
    };
  });
}

/**
 * Worker sweep, once per workspace cycle: closes upfront programmes whose
 * paid access ended (once, with a notice), tells a member 3 days before an
 * upfront programme ends, marks the start of each new monthly block for the
 * member and the Brain (`programme.block_started`), and ends voice add-ons
 * whose membership no longer has paid access.
 */
export async function sweepProgrammes(
  db: Database,
  tenantId: string,
  deps: { stripe?: ReturnType<typeof stripeClient> } = {},
) {
  const a: Actor = elevated("worker", { tenantId, role: "owner" });
  const result = await db.tenant(a, async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      tenantId + ":programmes",
    ]);
    // Renewed upfront programmes queued after the current one start now.
    const due = await tx.query(
      "SELECT * FROM subscriptions WHERE data->>'billing'='upfront' AND data ? 'nextProgramme' AND (data->'nextProgramme'->>'startsAt')::timestamptz<=now() ORDER BY id LIMIT 100 FOR UPDATE",
    );
    for (const s of due) await promoteQueuedProgramme(tx, a, s);
    const ended = await tx.query(
      "UPDATE subscriptions SET status='canceled',data=data||jsonb_build_object('endedReason','programme_complete','endedAt',now()) WHERE id IN (SELECT id FROM subscriptions WHERE data->>'billing'='upfront' AND provider_id IS NULL AND status IN ('active','trialing','past_due') AND period_end<=now() ORDER BY period_end,id LIMIT 100) RETURNING id,user_id,period_end,data->>'productId' AS product_id",
    );
    for (const s of ended) {
      await event(tx, a, "programme.ended", s.id, {
        memberId: s.user_id,
        productId: s.product_id,
        endedAt: new Date(s.period_end).toISOString(),
      });
      await notifyUser(tx, a, {
        userId: s.user_id,
        category: "coaching",
        dedupeKey: `programme-ended:${s.id}:${new Date(s.period_end).toISOString()}`,
        title: "Your programme is complete",
        body: "You finished your programme. Open your membership to start the next one when you are ready.",
        href: "/app/membership",
        templateKey: "programme-ended",
        source: { type: "programme", id: s.id },
      });
    }
    const ending = await tx.query(
      "SELECT s.id,s.user_id,s.period_end FROM subscriptions s WHERE s.data->>'billing'='upfront' AND s.provider_id IS NULL AND s.status='active' AND s.period_end>now() AND s.period_end<=now()+make_interval(days=>$1) AND coalesce((s.data->>'programmeDays')::int,0)>$1 AND NOT EXISTS(SELECT 1 FROM notifications n WHERE n.user_id=s.user_id AND n.dedupe_key='programme-ending:'||s.id::text||':'||to_char(s.period_end AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS')) ORDER BY s.period_end,s.id LIMIT 100",
      [ENDING_NOTICE_DAYS],
    );
    for (const s of ending)
      await notifyUser(tx, a, {
        userId: s.user_id,
        category: "coaching",
        dedupeKey: `programme-ending:${s.id}:${new Date(s.period_end).toISOString().slice(0, 19)}`,
        title: "Your programme ends soon",
        body: "Your programme ends in a few days. Open your membership to continue with the next one.",
        href: "/app/membership",
        templateKey: "programme-ending",
        source: { type: "programme", id: s.id },
      });
    // Monthly blocks: every member is visited (pages by id), and the last
    // block notified is kept on the row, so a block missed while the worker
    // was down is caught up instead of dropped.
    let blocks = 0,
      cursor = "00000000-0000-0000-0000-000000000000";
    for (;;) {
      const monthly = await tx.query(
        "SELECT s.id,s.user_id,s.data->>'programmeStartsAt' AS starts_at,s.data->'programmeDays' AS days,s.data->'blockNotice' AS notice,p.data->>'timezone' AS timezone FROM subscriptions s LEFT JOIN notification_preferences p ON p.tenant_id=s.tenant_id AND p.user_id=s.user_id WHERE coalesce(s.data->>'billing','monthly')='monthly' AND s.status IN ('active','trialing') AND (s.period_end IS NULL OR s.period_end>now()) AND s.data ? 'programmeStartsAt' AND s.id>$1::uuid ORDER BY s.id LIMIT $2",
        [cursor, BLOCK_PAGE],
      );
      if (!monthly.length) break;
      cursor = monthly[monthly.length - 1].id;
      for (const s of monthly) {
        const position = programmePosition({
          billing: "monthly",
          programmeDays: s.days,
          startsAt: s.starts_at,
          timeZone: validTimeZone(s.timezone) ? s.timezone : "Asia/Dubai",
        });
        if (position.state !== "active" || position.block < 2) continue;
        const last =
          s.notice?.startsAt === s.starts_at ? Number(s.notice.block) || 0 : 0;
        if (position.block <= last) continue;
        const mark = () =>
          tx.query(
            "UPDATE subscriptions SET data=data||jsonb_build_object('blockNotice',$2::jsonb) WHERE id=$1",
            [
              s.id,
              JSON.stringify({ startsAt: s.starts_at, block: position.block }),
            ],
          );
        // A row with no notice history (stored before notices were kept)
        // well into its block is marked without a late notice.
        if (!last && position.day > BLOCK_CATCH_UP_DAYS) {
          await mark();
          continue;
        }
        const key = `programme-block:${s.id}:${position.blockStartDate}`;
        const [seen] = await tx.query(
          "SELECT 1 FROM notifications WHERE user_id=$1 AND dedupe_key=$2",
          [s.user_id, key],
        );
        if (!seen) {
          await event(tx, a, "programme.block_started", s.id, {
            memberId: s.user_id,
            block: position.block,
            blockStartDate: position.blockStartDate,
            lengthDays: position.of,
          });
          await notifyUser(tx, a, {
            userId: s.user_id,
            category: "coaching",
            dedupeKey: key,
            title: `Block ${position.block} of your programme has started`,
            body: `A new ${position.of}-day block started. Today shows where you are and what comes next.`,
            href: "/app",
            templateKey: "programme-next-block",
            source: { type: "programme", id: s.id },
          });
          blocks++;
        }
        await mark();
      }
      if (monthly.length < BLOCK_PAGE) break;
    }
    return {
      started: due.length,
      ended: ended.length,
      ending: ending.length,
      blocks,
    };
  });
  const voice = await endOrphanedVoiceAddOns(db, tenantId, a, deps.stripe);
  return { ...result, voice };
}

export function registerProgrammeToday(app: FastifyInstance, db: Database) {
  const identity = (req: FastifyRequest) => {
    if (!req.identity)
      throw fail(401, "AUTH_REQUIRED", "Please sign in");
    return req.identity;
  };
  app.get("/api/v1/programme/today", (req) =>
    programmeToday(db, identity(req), (req.query as any)?.timezone),
  );
  app.get("/api/v1/programme/timeline", (req) =>
    programmeTimelineView(db, identity(req), (req.query as any)?.timezone),
  );
}
