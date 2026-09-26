import { createHash } from "node:crypto";
import {
  event,
  putRecord,
  type Actor,
  type Database,
  type Tx,
} from "@trainer/db";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { notifyUser } from "./notifications.ts";
import { subscriptionHasAccess } from "./finance-billing.ts";
import { workspaceLock } from "./privacy-lifecycle.ts";

const DAY = 86_400_000;
const EVENT_LIMIT = 500;
const COHORT_LIMIT = 100;
const policyData = z
  .object({
    enabled: z.boolean(),
    windowDays: z.number().int().min(7).max(30),
    cancellationThreshold: z.number().int().min(1).max(COHORT_LIMIT),
  })
  .strict();
type Policy = {
  id?: string;
  version: number;
  data: z.infer<typeof policyData>;
};
type Context = {
  tx: Tx;
  actor: Actor;
  policy: Policy;
  raw: any[];
  now: Date;
  workspaceCreatedAt: string;
};
type Signal = {
  eventId: string;
  userId: string;
  providerId: string;
  kind: "scheduled" | "ended";
  source: "confirmed_instruction" | "signed_subscription_event";
  occurredAt: string;
  recordedAt: string;
  periodEnd: string | null;
  providerEventId: string | null;
  instructionId: string | null;
};
const fail = (statusCode: number, message: string) =>
  Object.assign(new Error(message), { statusCode });
const millis = (v: unknown) =>
  v instanceof Date ? v.getTime() : Date.parse(String(v));
const iso = (v: unknown) =>
  Number.isFinite(millis(v)) ? new Date(millis(v)).toISOString() : null;
const epoch = (v: unknown) =>
  typeof v === "number" &&
  Number.isSafeInteger(v) &&
  v > 0 &&
  v < 8_640_000_000_000
    ? new Date(v * 1000).toISOString()
    : null;

function bounds(policy: Policy, now: Date) {
  const span = policy.data.windowDays * DAY;
  const start = Math.floor(now.getTime() / span) * span;
  return {
    current: {
      start: new Date(start).toISOString(),
      end: now.toISOString(),
      windowEnd: new Date(start + span).toISOString(),
    },
    previous: {
      start: new Date(start - span).toISOString(),
      end: new Date(now.getTime() - span).toISOString(),
    },
  };
}
async function loadPolicy(tx: Tx, tenantId: string): Promise<Policy> {
  const [r] = await tx.query(
    "SELECT id,version,data FROM records WHERE tenant_id=$1 AND kind='retention_policy' ORDER BY created_at DESC,id DESC LIMIT 1",
    [tenantId],
  );
  return {
    id: r?.id,
    version: r?.version ?? 0,
    data: policyData.parse(
      r?.data ?? { enabled: false, windowDays: 14, cancellationThreshold: 3 },
    ),
  };
}

/** Receipts are privileged. Project only billing fields after an active-workspace
 * and current-owner check, bind every receipt to its tenant audit event and
 * provider ownership, then use the normal tenant role for all remaining work. */
async function scoped<T>(
  db: Database,
  tenantId: string,
  userId: string | undefined,
  evidence: boolean,
  now: Date,
  fn: (c: Context) => Promise<T>,
): Promise<T | undefined> {
  if (!Number.isFinite(now.getTime())) return;
  return db.system(async (tx) => {
    await workspaceLock(tx, tenantId);
    const [tenant] = await tx.query(
      "SELECT lifecycle_state,created_at FROM tenants WHERE id=$1 FOR SHARE",
      [tenantId],
    );
    if (tenant?.lifecycle_state !== "active") return;
    const [owner] = await tx.query(
      "SELECT user_id FROM memberships WHERE tenant_id=$1 AND role='owner' AND ($2::uuid IS NULL OR user_id=$2) ORDER BY user_id LIMIT 1 FOR SHARE",
      [tenantId, userId ?? null],
    );
    if (!owner) {
      if (userId) throw fail(403, "Current workspace owner access is required");
      return;
    }
    const actor = { tenantId, userId: owner.user_id, role: "owner" };
    const policy = await loadPolicy(tx, tenantId);
    const period = bounds(policy, now);
    const raw = evidence
      ? await tx.query(
          `
      SELECT e.id event_id,e.actor_id user_id,e.name,e.subject_id,e.created_at recorded_at,
        e.data->>'providerEventId' provider_event_id,e.data->>'status' audit_status,
        p.external_id receipt_id,p.payload->>'id' payload_id,p.payload->>'type' event_type,
        p.payload->'data'->'object'->>'id' provider_id,
        p.payload->'data'->'object'->>'status' provider_status,
        p.payload->'data'->'object'->'cancel_at_period_end' cancel,
        p.payload->'data'->'object'->'canceled_at' canceled_at,
        p.payload->'data'->'object'->'ended_at' ended_at,
        coalesce(p.payload->'data'->'object'->'current_period_end',p.payload->'data'->'object'->'items'->'data'->0->'current_period_end') period_end,
        p.payload->'created' provider_created,
        p.payload->'data'->'previous_attributes'->'cancel_at_period_end' prior_cancel,
        p.payload->'data'->'previous_attributes'->>'status' prior_status,
        o.user_id mapped_user_id,
        r.id instruction_id,r.status instruction_status,r.data instruction
      FROM events e
      LEFT JOIN provider_events p ON p.provider='stripe' AND p.external_id=e.data->>'providerEventId' AND p.status='processed'
      LEFT JOIN provider_objects o ON o.provider='stripe' AND o.external_id=e.subject_id AND o.tenant_id=e.tenant_id AND o.user_id=e.actor_id AND o.kind='subscription'
      LEFT JOIN records r ON r.tenant_id=e.tenant_id AND r.id::text=e.subject_id AND r.kind='subscription_transition' AND r.owner_user_id=e.actor_id
      WHERE e.tenant_id=$1 AND e.name IN ('subscription.updated','subscription.cancel_scheduled') AND e.created_at>=$2 AND e.created_at<=$3
      ORDER BY e.created_at DESC,e.id DESC LIMIT $4`,
          [tenantId, period.previous.start, now.toISOString(), EVENT_LIMIT + 1],
        )
      : [];
    // Membership changes require UPDATE privileges, which trainer_app deliberately
    // lacks. Take read locks on this bounded candidate set before dropping role.
    if (raw.length)
      await tx.query(
        "SELECT user_id FROM memberships WHERE tenant_id=$1 AND user_id=ANY($2::uuid[]) ORDER BY user_id FOR SHARE",
        [
          tenantId,
          raw
            .slice(0, EVENT_LIMIT)
            .map((r) => r.user_id)
            .filter(Boolean),
        ],
      );
    await tx.query("SET LOCAL ROLE trainer_app");
    await tx.query(
      "SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true),set_config('app.role','owner',true)",
      [tenantId, actor.userId],
    );
    return fn({
      tx,
      actor,
      policy,
      raw,
      now,
      workspaceCreatedAt: iso(tenant.created_at)!,
    });
  });
}

function signal(r: any): Signal | null | "incomplete" {
  const common = {
    eventId: r.event_id,
    userId: r.user_id,
    recordedAt: iso(r.recorded_at)!,
  };
  if (!common.recordedAt || !r.user_id) return "incomplete";
  if (r.name === "subscription.cancel_scheduled") {
    if (
      r.instruction_status !== "succeeded" ||
      r.instruction?.cancel !== true ||
      typeof r.instruction?.providerId !== "string" ||
      !r.instruction?.subscriptionId
    )
      return "incomplete";
    return {
      ...common,
      kind: "scheduled",
      source: "confirmed_instruction",
      occurredAt: common.recordedAt,
      providerId: r.instruction.providerId,
      periodEnd: iso(r.instruction.periodEnd),
      instructionId: r.instruction_id,
      providerEventId: null,
    };
  }
  if (
    !r.receipt_id ||
    r.receipt_id !== r.payload_id ||
    r.provider_id !== r.subject_id ||
    r.mapped_user_id !== r.user_id ||
    r.provider_status !== r.audit_status ||
    ![
      "customer.subscription.created",
      "customer.subscription.updated",
      "customer.subscription.deleted",
    ].includes(r.event_type)
  )
    return "incomplete";
  let occurredAt: string | null = null;
  let kind: Signal["kind"];
  if (r.provider_status === "canceled") {
    kind = "ended";
    occurredAt =
      epoch(r.ended_at) ??
      (r.event_type === "customer.subscription.deleted" ||
      (r.prior_status && r.prior_status !== "canceled")
        ? epoch(r.provider_created)
        : null);
  } else if (r.cancel === true) {
    kind = "scheduled";
    // canceled_at pins the request time across unrelated later updates. A known
    // false→true transition is an alternative when that timestamp is absent.
    occurredAt =
      epoch(r.canceled_at) ??
      (r.prior_cancel === false ||
      r.event_type === "customer.subscription.created"
        ? epoch(r.provider_created)
        : null);
  } else return null;
  if (
    !occurredAt ||
    millis(occurredAt) > millis(common.recordedAt) + 5 * 60_000
  )
    return "incomplete";
  return {
    ...common,
    kind,
    occurredAt,
    providerId: r.provider_id,
    periodEnd: epoch(r.period_end),
    instructionId: null,
    providerEventId: r.receipt_id,
    source: "signed_subscription_event",
  };
}

async function summary(c: Context) {
  const { tx, policy, now } = c;
  const period = bounds(policy, now);
  let complete = c.raw.length <= EVENT_LIMIT;
  let unverifiableSources = 0;
  const signals: Signal[] = [];
  for (const r of c.raw.slice(0, EVENT_LIMIT)) {
    const s = signal(r);
    if (s === "incomplete") {
      complete = false;
      unverifiableSources++;
    } else if (
      s &&
      millis(s.occurredAt) >= millis(period.previous.start) &&
      millis(s.occurredAt) <= now.getTime()
    )
      signals.push(s);
  }
  const pairs = [
    ...new Map(signals.map((s) => [`${s.userId}:${s.providerId}`, s])).values(),
  ];
  const invoices = pairs.length
    ? await tx.query(
        `
    SELECT p.user_id,p.provider_id,j.* FROM unnest($1::uuid[],$2::text[]) p(user_id,provider_id)
    JOIN LATERAL (
      SELECT j.id journal_id,j.data->>'invoiceId' invoice_id,j.data->>'chargedAt' charged_at,j.created_at,
        j.data->'grossMinor' gross_minor,r.id invoice_record_id
      FROM journals j JOIN records r ON r.tenant_id=j.tenant_id AND r.kind='billing_invoice'
        AND r.owner_user_id=p.user_id AND r.data->>'subscriptionId'=p.provider_id
        AND r.data->>'invoiceId'=j.data->>'invoiceId'
      WHERE j.data->>'userId'=p.user_id::text AND j.source_key='stripe-invoice:'||(j.data->>'invoiceId')
        AND jsonb_typeof(j.data->'grossMinor')='number' AND (j.data->>'grossMinor')::numeric>0
      ORDER BY j.created_at,j.id LIMIT 1
    ) j ON true`,
        [pairs.map((s) => s.userId), pairs.map((s) => s.providerId)],
      )
    : [];
  const members = pairs.length
    ? await tx.query(
        "SELECT m.user_id,u.name,s.id subscription_id,s.provider_id,s.status,s.cancel_at_period_end,s.period_end,s.data,EXISTS(SELECT 1 FROM records r WHERE r.owner_user_id=m.user_id AND r.kind='subscription_transition' AND r.status IN ('submitting','unknown') AND r.data->>'providerId'=s.provider_id) unresolved FROM memberships m JOIN users u ON u.id=m.user_id LEFT JOIN subscriptions s ON s.user_id=m.user_id AND s.tenant_id=m.tenant_id WHERE m.tenant_id=$1 AND m.role='subscriber' AND m.user_id=ANY($2::uuid[]) ORDER BY m.user_id",
        [c.actor.tenantId, pairs.map((s) => s.userId)],
      )
    : [];
  const invoiceByPair = new Map(
    invoices.map((i) => [`${i.user_id}:${i.provider_id}`, i]),
  );
  const memberById = new Map(members.map((m) => [m.user_id, m]));
  let excludedWithoutPayment = 0;
  const verified = signals.filter((s) => {
    if (!memberById.has(s.userId)) return false;
    const i = invoiceByPair.get(`${s.userId}:${s.providerId}`);
    if (
      !i ||
      !iso(i.charged_at ?? i.created_at) ||
      millis(i.charged_at ?? i.created_at) > millis(s.occurredAt)
    ) {
      excludedWithoutPayment++;
      return false;
    }
    return true;
  });
  const inRange = (s: Signal, from: string, to: string) =>
    millis(s.occurredAt) >= millis(from) && millis(s.occurredAt) <= millis(to);
  const currentSignals = verified.filter((s) =>
    inRange(s, period.current.start, period.current.end),
  );
  const previousSignals = verified.filter(
    (s) =>
      millis(s.occurredAt) < millis(period.current.start) &&
      inRange(s, period.previous.start, period.previous.end),
  );
  const latest = new Map<string, Signal>();
  for (const s of currentSignals.sort(
    (a, b) =>
      millis(a.occurredAt) - millis(b.occurredAt) ||
      Number(a.kind === "ended") - Number(b.kind === "ended") ||
      a.eventId.localeCompare(b.eventId),
  ))
    latest.set(s.userId, s);
  const rows = [...latest.values()]
    .map((s) => {
      const m = memberById.get(s.userId)!;
      const invoice = invoiceByPair.get(`${s.userId}:${s.providerId}`)!;
      let state: "scheduled" | "ended" | "recovered" | "unverified" =
        "unverified";
      if (m.unresolved) state = "unverified";
      else if (
        m.provider_id === s.providerId &&
        m.status === "canceled" &&
        s.kind === "ended"
      )
        state = "ended";
      else if (
        m.provider_id === s.providerId &&
        m.cancel_at_period_end === true &&
        ["active", "trialing", "past_due"].includes(m.status) &&
        millis(m.period_end) > now.getTime() &&
        s.kind === "scheduled"
      )
        state = "scheduled";
      else if (
        m.cancel_at_period_end === false &&
        subscriptionHasAccess(m, now.getTime())
      )
        state = "recovered";
      return {
        userId: s.userId,
        name: m.name,
        state,
        subscriptionStatus: m.status ?? null,
        accessUntil: iso(m.period_end),
        occurredAt: s.occurredAt,
        evidence: {
          ...s,
          journalId: invoice.journal_id,
          invoiceId: invoice.invoice_id,
          invoiceRecordId: invoice.invoice_record_id,
          paidAt: iso(invoice.charged_at ?? invoice.created_at),
          paidMinor: Number(invoice.gross_minor),
        },
      };
    })
    .sort(
      (a, b) =>
        millis(b.occurredAt) - millis(a.occurredAt) ||
        a.userId.localeCompare(b.userId),
    );
  if (rows.length > COHORT_LIMIT || rows.some((r) => r.state === "unverified"))
    complete = false;
  const affected = rows.filter(
    (r) => r.state === "scheduled" || r.state === "ended",
  );
  const digest = createHash("sha256")
    .update(
      JSON.stringify(
        affected
          .map((r) => [
            r.userId,
            r.state,
            r.evidence.eventId,
            r.evidence.journalId,
            r.accessUntil,
          ])
          .sort(),
      ),
    )
    .digest("hex");
  const scheduled = affected.filter((r) => r.state === "scheduled").length;
  return {
    policy: { version: policy.version, data: policy.data },
    observedAt: now.toISOString(),
    complete,
    period,
    counts: {
      recorded: rows.length,
      affected: affected.length,
      scheduled,
      ended: affected.length - scheduled,
      recovered: rows.filter((r) => r.state === "recovered").length,
      unverified: rows.filter((r) => r.state === "unverified").length,
    },
    previousRecorded:
      complete && millis(c.workspaceCreatedAt) <= millis(period.previous.start)
        ? new Set(previousSignals.map((s) => s.userId)).size
        : null,
    thresholdMet:
      complete && affected.length >= policy.data.cancellationThreshold,
    cohort: rows.slice(0, COHORT_LIMIT),
    coverage: {
      eventLimit: EVENT_LIMIT,
      cohortLimit: COHORT_LIMIT,
      scannedEvents: Math.min(c.raw.length, EVENT_LIMIT),
      unverifiableSources,
      excludedWithoutPayment,
    },
    basis:
      "Unique current workspace subscribers with a recorded cancellation and an earlier positive invoice for that subscription. Recorded counts compare equal elapsed UTC windows; current states are checked now. These are recorded counts, not a historical churn rate or revenue estimate.",
    digest,
  };
}

export function registerRetention(app: FastifyInstance, db: Database) {
  const withOwner = async <T>(
    req: FastifyRequest,
    evidence: boolean,
    fn: (c: Context) => Promise<T>,
  ) => {
    if (!req.identity) throw fail(401, "Please sign in");
    if (req.identity.role !== "owner")
      throw fail(403, "The workspace owner must review retention data");
    const result = await scoped(
      db,
      req.identity.tenantId,
      req.identity.userId,
      evidence,
      new Date(),
      fn,
    );
    if (result === undefined) throw fail(409, "This workspace is unavailable");
    return result;
  };
  app.get("/api/v1/retention/policy", (req) =>
    withOwner(req, false, async ({ policy }) => ({
      version: policy.version,
      data: policy.data,
    })),
  );
  app.put("/api/v1/retention/policy", (req) =>
    withOwner(req, false, async ({ tx, actor, policy }) => {
      const b = z
        .object({ version: z.number().int().min(0), data: policyData })
        .strict()
        .parse(req.body);
      if (b.version !== policy.version)
        throw fail(409, "The retention policy changed; reload before saving");
      const [saved] = policy.id
        ? await tx.query(
            "UPDATE records SET data=$2,version=version+1,updated_at=now() WHERE id=$1 AND kind='retention_policy' AND version=$3 RETURNING id,version,data",
            [policy.id, JSON.stringify(b.data), b.version],
          )
        : [
            await putRecord(tx, actor, "retention_policy", b.data, {
              status: "active",
            }),
          ];
      if (!saved)
        throw fail(409, "The retention policy changed; reload before saving");
      await event(tx, actor, "retention.policy_changed", saved.id, {
        version: saved.version,
      });
      return { version: saved.version, data: saved.data };
    }),
  );
  app.get("/api/v1/retention/summary", (req) =>
    withOwner(req, true, async (c) => {
      const { digest: _digest, ...value } = await summary(c);
      return value;
    }),
  );
  app.get("/api/v1/retention/evidence/:eventId", (req) =>
    withOwner(req, true, async (c) => {
      const id = z
        .object({ eventId: z.string().uuid() })
        .parse(req.params).eventId;
      const row = (await summary(c)).cohort.find(
        (r) => r.evidence.eventId === id,
      );
      if (!row)
        throw fail(404, "This evidence is outside the current recorded cohort");
      return row;
    }),
  );
}

const sourceSchema = z
  .object({
    type: z.literal("retention"),
    version: z.literal(1),
    policyId: z.string().uuid(),
    policyVersion: z.number().int().positive(),
    windowStart: z.string().datetime(),
    expiresAt: z.string().datetime(),
    digest: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

export async function retentionNotificationCurrent(
  db: Database,
  tenantId: string,
  userId: string,
  source: unknown,
  now = new Date(),
): Promise<boolean> {
  const parsed = sourceSchema.safeParse(source);
  if (!parsed.success || millis(parsed.data.expiresAt) <= now.getTime())
    return false;
  try {
    return (
      (await scoped(db, tenantId, userId, true, now, async (c) => {
        const s = parsed.data;
        if (
          !c.policy.data.enabled ||
          c.policy.id !== s.policyId ||
          c.policy.version !== s.policyVersion ||
          bounds(c.policy, now).current.start !== s.windowStart
        )
          return false;
        const value = await summary(c);
        return value.thresholdMet && value.digest === s.digest;
      })) ?? false
    );
  } catch (e) {
    if ((e as { statusCode?: number }).statusCode === 403) return false;
    throw e;
  }
}

/** One aggregate alert per policy/window and at least 24 hours apart across
 * policy edits. No individual targeting, campaign or duplicated billing store. */
export async function scheduleRetentionAlerts(
  db: Database,
  tenantId: string,
  now = new Date(),
): Promise<number> {
  return (
    (await scoped(db, tenantId, undefined, true, now, async (c) => {
      if (!c.policy.data.enabled || !c.policy.id) return 0;
      const value = await summary(c);
      if (!value.thresholdMet) return 0;
      const [recent] = await c.tx.query(
        "SELECT id FROM notifications WHERE data->'source'->>'type'='retention' AND created_at>$1 LIMIT 1",
        [new Date(now.getTime() - DAY).toISOString()],
      );
      if (recent) return 0;
      const source = {
        type: "retention",
        version: 1,
        policyId: c.policy.id,
        policyVersion: c.policy.version,
        windowStart: value.period.current.start,
        digest: value.digest,
        expiresAt: new Date(
          Math.min(
            millis(value.period.current.windowEnd),
            now.getTime() + 2 * DAY,
          ),
        ).toISOString(),
      };
      return (await notifyUser(c.tx, c.actor, {
        userId: c.actor.userId,
        category: "coaching",
        dedupeKey: `retention:v1:${c.policy.id}:${c.policy.version}:${source.windowStart}`,
        title: "Review your recorded membership cancellations",
        body: "Your saved cancellation threshold is met by current recorded billing evidence. Review the business summary and its source records.",
        href: "/trainer/analytics#retention",
        templateKey: "retention-review-v1",
        source,
      }))
        ? 1
        : 0;
    })) ?? 0
  );
}
