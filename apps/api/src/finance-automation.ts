import { randomUUID } from "node:crypto";
import {
  type Actor,
  type Database,
  type Tx,
  putRecord,
  event,
} from "@trainer/db";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { integrationStatus, stripeClient } from "@trainer/providers";
import { z } from "zod";
import { processStripeEvent } from "./stripe-events.ts";
import { reconcileRenewal, reconcileRefund } from "./finance-billing.ts";
import { reconcileBookingPayment } from "./finance-bookings.ts";
import {
  closeMonth,
  monthCutoff,
  postUsageStatement,
} from "./finance-operations.ts";
import { createPayout } from "./finance.ts";
import { executePayout } from "./payout-execution.ts";
import { requireRecentMfa } from "./security.ts";
const fail = (code: string, message: string) =>
  Object.assign(new Error(message), { statusCode: 409, code });
export const automationSchema = z
  .object({
    revision: z.number().int().min(0),
    enabled: z.boolean(),
    reconcileStripe: z.boolean(),
    closeMonthly: z.boolean(),
    preparePayouts: z.boolean(),
    executePayouts: z.boolean(),
    maxPayoutMinor: z.number().int().min(0).max(1000000000),
    fxAedPerUsd: z.number().positive().max(100),
    fxEvidence: z.string().trim().min(10).max(500),
    reason: z.string().trim().min(10).max(1000),
  })
  .strict();
export async function configureFinanceAutomation(
  tx: Tx,
  a: Actor,
  raw: unknown,
) {
  const input = automationSchema.parse(raw);
  if (
    input.executePayouts &&
    (!input.preparePayouts || !input.closeMonthly || input.maxPayoutMinor <= 0)
  )
    throw fail(
      "AUTOMATION_LIMIT_REQUIRED",
      "Automatic payment execution needs reviewed close, payout preparation and a positive cap",
    );
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [a.tenantId]);
  const [current] = await tx.query(
    "SELECT * FROM records WHERE kind='finance_automation' FOR UPDATE",
  );
  if ((current?.version ?? 0) !== input.revision)
    throw fail(
      "STALE_REVISION",
      "Automation settings changed; reload before saving",
    );
  let r;
  if (current) {
    [r] = await tx.query(
      "UPDATE records SET data=$2,version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
      [
        current.id,
        JSON.stringify({
          ...input,
          approvedBy: a.userId,
          approvedAt: new Date().toISOString(),
        }),
      ],
    );
  } else
    r = await putRecord(
      tx,
      a,
      "finance_automation",
      { ...input, approvedBy: a.userId, approvedAt: new Date().toISOString() },
      { status: "configured" },
    );
  await event(tx, a, "finance.automation_configured", r.id, {
    revision: r.version,
    enabled: input.enabled,
    executePayouts: input.executePayouts,
    maxPayoutMinor: input.maxPayoutMinor,
    reason: input.reason,
  });
  return r;
}
async function ownerActor(
  db: Database,
  tenantId: string,
): Promise<Actor | null> {
  const [r] = await db.system((tx) =>
    tx.query(
      "SELECT m.user_id FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.tenant_id=$1 AND m.role='owner' AND coalesce(to_jsonb(t)->>'lifecycle_state','active')='active' LIMIT 1",
      [tenantId],
    ),
  );
  return r ? { tenantId, userId: r.user_id, role: "finance" } : null;
}
export async function scheduleFinance(
  db: Database,
  tenantId: string,
  now = new Date(),
) {
  const a = await ownerActor(db, tenantId);
  if (!a) return;
  await db.tenant(a, async (tx) => {
    const [c] = await tx.query(
      "SELECT * FROM records WHERE kind='finance_automation'",
    );
    if (!c?.data.enabled) return;
    const day = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Dubai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    async function enqueue(kind: string, key: string, data: any) {
      await tx.query(
        "INSERT INTO jobs(id,tenant_id,kind,intent_key,data) VALUES($1,$2,$3,$4,$5) ON CONFLICT(intent_key) DO NOTHING",
        [
          randomUUID(),
          tenantId,
          kind,
          key,
          JSON.stringify({ ...data, configVersion: c.version }),
        ],
      );
    }
    await enqueue("finance_replay", `finance-replay:${tenantId}:${day}`, {});
    if (c.data.reconcileStripe) {
      const subscriptions = await tx.query(
        "SELECT id,user_id FROM subscriptions WHERE provider_id IS NOT NULL AND status NOT IN ('canceled','incomplete_expired') ORDER BY id",
      );
      for (const s of subscriptions)
        await enqueue(
          "finance_subscription",
          `finance-subscription:${tenantId}:${s.id}:${day}`,
          { userId: s.user_id },
        );
      await enqueue(
        "finance_obligations",
        `finance-obligations:${tenantId}:${day}`,
        {},
      );
    }
    if (c.data.closeMonthly) {
      const dubai = new Date(now.getTime() + 4 * 3600000),
        previous = new Date(
          Date.UTC(dubai.getUTCFullYear(), dubai.getUTCMonth() - 1, 1),
        );
      const period = previous.toISOString().slice(0, 7);
      if (now.getTime() >= monthCutoff(period).getTime() + 7 * 86400000)
        await enqueue(
          "finance_monthly",
          `finance-monthly:${tenantId}:${period}`,
          { period },
        );
    }
  });
}
async function replayReceipts(db: Database, a: Actor) {
  const rows = await db.system((tx) =>
    tx.query(
      "SELECT p.* FROM provider_events p WHERE p.provider='stripe' AND p.status IN ('received','failed') AND (p.payload->'data'->'object'->'metadata'->>'tenant_id'=$1 OR p.payload->'data'->'object'->'parent'->'subscription_details'->'metadata'->>'tenant_id'=$1 OR EXISTS(SELECT 1 FROM provider_objects o WHERE o.provider='stripe' AND o.tenant_id=$2 AND o.external_id IN (p.payload->'data'->'object'->>'id',p.payload->'data'->'object'->>'subscription',p.payload->'data'->'object'->>'charge'))) ORDER BY p.created_at LIMIT 50",
      [a.tenantId, a.tenantId],
    ),
  );
  let failures = 0;
  for (const row of rows) {
    try {
      await processStripeEvent(db, row.payload);
      await db.system((tx) =>
        tx.query(
          "UPDATE provider_events SET status='processed' WHERE provider=$1 AND external_id=$2",
          [row.provider, row.external_id],
        ),
      );
    } catch {
      failures++;
    }
  }
  return { processed: rows.length - failures, failures };
}
export async function syncStripeSubscription(
  db: Database,
  a: Actor,
  userId: string,
  stripe = stripeClient(),
) {
  const [s] = await db.tenant(a, (tx) =>
    tx.query("SELECT * FROM subscriptions WHERE user_id=$1", [userId]),
  );
  if (!s?.provider_id) return;
  const remote = await stripe.subscriptions.retrieve(s.provider_id);
  if (
    remote.id !== s.provider_id ||
    (remote.metadata?.tenant_id && remote.metadata.tenant_id !== a.tenantId) ||
    (remote.metadata?.user_id && remote.metadata.user_id !== userId)
  )
    throw fail(
      "PROVIDER_OWNER_MISMATCH",
      "Subscription identity does not match the workspace",
    );
  await processStripeEvent(db, {
    id: `reconcile-subscription:${remote.id}:${Date.now()}`,
    type: "customer.subscription.updated",
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        ...remote,
        metadata: {
          ...remote.metadata,
          tenant_id: a.tenantId,
          user_id: userId,
        },
      },
    },
  });
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const invoices = await stripe.invoices.list({
      subscription: s.provider_id,
      limit: 100,
      ...(cursor ? { starting_after: cursor } : {}),
    });
    for (const invoice of invoices.data) {
      if (invoice.currency !== "aed" || invoice.status !== "paid") continue;
      await processStripeEvent(db, {
        id: `reconcile-invoice:${invoice.id}:paid`,
        type: "invoice.paid",
        created: invoice.status_transitions.paid_at ?? invoice.created,
        data: {
          object: {
            ...invoice,
            metadata: {
              ...invoice.metadata,
              tenant_id: a.tenantId,
              user_id: userId,
            },
          },
        },
      });
    }
    if (!invoices.has_more) return;
    cursor = invoices.data.at(-1)?.id;
    if (!cursor) break;
  }
  throw fail(
    "INVOICE_HISTORY_INCOMPLETE",
    "Provider invoice history exceeds this job's bounded read; reconcile the remaining pages before closing",
  );
}
async function reconcileObligations(
  db: Database,
  a: Actor,
  stripe: ReturnType<typeof stripeClient>,
) {
  const rows = await db.tenant(a, (tx) =>
    tx.query(
      "SELECT * FROM records WHERE (kind='refund' AND status IN ('submitting','submitted','unknown')) OR (kind='subscription_transition' AND status IN ('submitting','unknown')) OR (kind='booking_payment' AND status IN ('pending','creating','open','unknown','refund_submitting','refund_pending','refund_unknown')) ORDER BY created_at LIMIT 50",
    ),
  );
  let unresolved = 0;
  for (const r of rows) {
    try {
      if (r.kind === "refund") await reconcileRefund(db, a, r.id, stripe);
      else if (r.kind === "subscription_transition")
        await reconcileRenewal(db, { ...a, userId: r.owner_user_id }, stripe);
      else await reconcileBookingPayment(db, a, r.data.bookingId, stripe);
    } catch {
      unresolved++;
    }
  }
  return { checked: rows.length, unresolved };
}
export async function executeFinanceJob(
  db: Database,
  tenantId: string,
  job: any,
  dependencies: { stripe?: ReturnType<typeof stripeClient> } = {},
) {
  const a = await ownerActor(db, tenantId);
  if (!a) return { status: "blocked", code: "WORKSPACE_CLOSED" };
  const [c] = await db.tenant(a, (tx) =>
    tx.query("SELECT * FROM records WHERE kind='finance_automation'"),
  );
  if (!c?.data.enabled)
    return { status: "blocked", code: "AUTOMATION_DISABLED" };
  if (job.kind === "finance_replay") {
    const result = await replayReceipts(db, a);
    return {
      status: result.failures ? "blocked" : "completed",
      code: result.failures ? "REPLAY_UNRESOLVED" : undefined,
      ...result,
    };
  }
  if (
    job.kind === "finance_subscription" ||
    job.kind === "finance_obligations"
  ) {
    if (!c.data.reconcileStripe)
      return { status: "blocked", code: "RECONCILIATION_DISABLED" };
    const stripe = dependencies.stripe ?? stripeClient();
    if (job.kind === "finance_subscription") {
      await syncStripeSubscription(
        db,
        a,
        z.string().uuid().parse(job.data.userId),
        stripe,
      );
      return { status: "completed" };
    }
    const result = await reconcileObligations(db, a, stripe);
    return {
      status: result.unresolved ? "blocked" : "completed",
      code: result.unresolved ? "OBLIGATIONS_UNRESOLVED" : undefined,
      ...result,
    };
  }
  if (job.kind !== "finance_monthly")
    throw fail("FINANCE_JOB_UNSUPPORTED", "Unsupported finance job");
  if (!c.data.closeMonthly || job.data.configVersion !== c.version)
    return { status: "blocked", code: "AUTOMATION_APPROVAL_CHANGED" };
  const period = z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .parse(job.data.period);
  const payout = await db.tenant(a, async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [tenantId]);
    const [usage] = await tx.query(
      "SELECT count(*)::int AS n,count(*) FILTER(WHERE cost_usd IS NULL)::int AS unknown,round(coalesce(sum(cost_usd),0)*$2::numeric*100)::text AS minor FROM cost_events WHERE to_char(created_at AT TIME ZONE 'Asia/Dubai','YYYY-MM')=$1",
      [period, c.data.fxAedPerUsd],
    );
    if (usage.unknown)
      throw fail(
        "USAGE_UNRECONCILED",
        "Unknown provider usage blocks automatic month close",
      );
    if (usage.n)
      await postUsageStatement(tx, a, {
        period,
        fxAedPerUsd: c.data.fxAedPerUsd,
        chargeMinor: Number(usage.minor),
        feeScheduleVersion: `automation:${c.id}:${c.version}`,
        evidenceReference: c.data.fxEvidence,
      });
    await closeMonth(
      tx,
      a,
      period,
      `Reviewed automation ${c.id} revision ${c.version}: ${c.data.reason}`,
    );
    if (!c.data.preparePayouts) return null;
    const [previous] = await tx.query(
      "SELECT * FROM payouts WHERE period=$1 ORDER BY revision DESC LIMIT 1",
      [period],
    );
    if (previous) {
      if (["failed", "returned", "canceled"].includes(previous.status))
        throw fail(
          "PAYOUT_REVIEW_REQUIRED",
          "A resolved previous instruction needs operator review before another payout revision",
        );
      return previous;
    }
    const [beneficiary] = await tx.query(
      "SELECT * FROM records WHERE kind='beneficiary' AND status='verified' AND (data->>'holdUntil')::timestamptz<now() ORDER BY created_at DESC LIMIT 1",
    );
    if (!beneficiary?.data.providerId)
      throw fail(
        "BENEFICIARY_REQUIRED",
        "A verified destination beyond its bank-change hold is required",
      );
    return createPayout(tx, a, period, beneficiary.data.providerId);
  });
  if (payout && c.data.executePayouts && payout.status === "ready") {
    if (Number(payout.amount_minor) > c.data.maxPayoutMinor)
      return { status: "blocked", code: "PAYOUT_CAP_EXCEEDED" };
    const lean = integrationStatus().find((x) => x.id === "lean");
    if (!lean?.configured || !lean.approved)
      return { status: "blocked", code: "BANK_CONTRACT_REQUIRED" };
    // Reload approval immediately before entering the irreversible dispatch boundary.
    const [latest] = await db.tenant(a, (tx) =>
      tx.query("SELECT version,data FROM records WHERE id=$1", [c.id]),
    );
    if (
      latest.version !== c.version ||
      !latest.data.enabled ||
      !latest.data.executePayouts
    )
      return { status: "blocked", code: "AUTOMATION_APPROVAL_CHANGED" };
    await executePayout(db, a, payout.id, {
      configurationId: c.id,
      revision: c.version,
      maxPayoutMinor: c.data.maxPayoutMinor,
    });
  }
  return { status: "completed", payoutId: payout?.id ?? null };
}
export function registerFinanceAutomation(app: FastifyInstance, db: Database) {
  const operator = (req: FastifyRequest) => {
    const a = req.identity;
    if (!a || !["admin", "finance"].includes(a.platformRole))
      throw Object.assign(new Error("Platform finance access required"), {
        statusCode: 403,
      });
    requireRecentMfa(a);
    return {
      ...a,
      tenantId: z
        .string()
        .uuid()
        .parse((req.params as any).tenantId),
      role: "finance",
    };
  };
  const prefix = "/api/v1/admin/tenants/:tenantId/finance/automation";
  app.get(prefix, (req) => {
    const a = operator(req);
    return db.tenant(a, async (tx) => ({
      configuration:
        (
          await tx.query(
            "SELECT * FROM records WHERE kind='finance_automation'",
          )
        )[0] ?? null,
      jobs: await tx.query(
        "SELECT id,kind,status,attempts,last_error,created_at,data FROM jobs WHERE kind LIKE 'finance_%' ORDER BY created_at DESC LIMIT 100",
      ),
    }));
  });
  app.post(prefix, (req) => {
    const a = operator(req);
    return db.tenant(a, (tx) => configureFinanceAutomation(tx, a, req.body));
  });
  app.post(prefix + "/schedule", async (req) => {
    const a = operator(req);
    await scheduleFinance(db, a.tenantId);
    return { ok: true };
  });
  app.post(prefix + "/jobs/:id/retry", (req) => {
    const a = operator(req),
      b = z
        .object({
          attempts: z.number().int().min(0),
          configurationRevision: z.number().int().positive(),
          reason: z.string().min(10).max(500),
        })
        .parse(req.body);
    return db.tenant(a, (tx) =>
      reauthorizeFinanceJob(
        tx,
        a,
        z
          .string()
          .uuid()
          .parse((req.params as any).id),
        b,
      ),
    );
  });
}

/** Explicit operator reauthorization retains the original job/payment business identity. */
export async function reauthorizeFinanceJob(
  tx: Tx,
  a: Actor & { platformRole?: string; mfaAt?: string | null },
  jobId: string,
  input: { attempts: number; configurationRevision: number; reason: string },
) {
  if (!["admin", "finance"].includes(a.platformRole ?? ""))
    throw Object.assign(new Error("Platform finance access required"), {
      statusCode: 403,
      code: "FINANCE_REQUIRED",
    });
  requireRecentMfa(a, true);
  const body = z
    .object({
      attempts: z.number().int().min(0),
      configurationRevision: z.number().int().positive(),
      reason: z.string().trim().min(10).max(500),
    })
    .strict()
    .parse(input);
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [a.tenantId]);
  const [job] = await tx.query(
    "SELECT *, (leased_until IS NULL OR leased_until<now()) AS lease_free FROM jobs WHERE id=$1 AND kind LIKE 'finance_%' FOR UPDATE",
    [z.string().uuid().parse(jobId)],
  );
  if (
    !job ||
    !["blocked", "failed"].includes(job.status) ||
    job.attempts !== body.attempts ||
    !job.lease_free
  )
    throw fail(
      "JOB_CHANGED",
      "The job changed or is still running; reload before retrying",
    );
  const [configuration] = await tx.query(
    "SELECT * FROM records WHERE kind='finance_automation' FOR UPDATE",
  );
  if (configuration && configuration.version !== body.configurationRevision)
    throw fail(
      "STALE_REVISION",
      "Finance configuration changed; reload its current limits before reauthorizing this job",
    );
  if (!configuration?.data.enabled)
    throw fail(
      "AUTOMATION_DISABLED",
      "Enable and review finance automation before reauthorizing its job",
    );
  if (job.kind === "finance_monthly" && !configuration.data.closeMonthly)
    throw fail(
      "AUTOMATION_DISABLED",
      "Monthly close is disabled in the current reviewed configuration",
    );
  const data = {
    ...job.data,
    configVersion: configuration.version,
    reauthorizedBy: a.userId,
    reauthorizedAt: new Date().toISOString(),
    reauthorizationReason: body.reason,
  };
  const [r] = await tx.query(
    "UPDATE jobs SET status='pending',data=$2,available_at=now(),leased_until=NULL,last_error=NULL WHERE id=$1 AND attempts=$3 AND status IN ('blocked','failed') RETURNING id,intent_key,data",
    [job.id, JSON.stringify(data), body.attempts],
  );
  if (!r)
    throw fail(
      "JOB_CHANGED",
      "The job changed before reauthorization completed",
    );
  await event(tx, a, "finance.job_reauthorized", job.id, {
    reason: body.reason,
    originalIntent: job.intent_key,
    previousConfigurationRevision: job.data.configVersion,
    configurationRevision: configuration.version,
  });
  return {
    ok: true,
    jobId: r.id,
    intentKey: r.intent_key,
    configurationRevision: configuration.version,
  };
}

function financeFailureCode(error: unknown) {
  if (error && typeof error === "object" && "provider" in error)
    return "PROVIDER_UNAVAILABLE";
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
  return /^[A-Z][A-Z_]{3,79}$/.test(code)
    ? code
    : "FINANCE_RECONCILIATION_REQUIRED";
}
export async function persistFinanceJobOutcome(
  db: Database,
  tenantId: string,
  job: any,
  result: { status: string; code?: string },
) {
  const a: Actor = {
    tenantId,
    userId: "00000000-0000-0000-0000-000000000000",
    role: "finance",
  };
  const status = result.status === "completed" ? "completed" : "blocked";
  const code =
    status === "blocked"
      ? result.code && /^[A-Z][A-Z_]{3,79}$/.test(result.code)
        ? result.code
        : "FINANCE_RECONCILIATION_REQUIRED"
      : null;
  const rows = await db.tenant(a, (tx) =>
    tx.query(
      "UPDATE jobs SET status=$2,leased_until=NULL,last_error=$3 WHERE id=$1 AND kind LIKE 'finance_%' AND status='pending' AND attempts=$4 AND leased_until=$5 RETURNING id",
      [job.id, status, code, job.attempts, job.leased_until],
    ),
  );
  return { updated: rows.length === 1, status, code };
}
/** The generic email retry path must never receive a finance failure. */
export async function runClaimedFinanceJob(
  db: Database,
  tenantId: string,
  job: any,
  dependencies: { stripe?: ReturnType<typeof stripeClient> } = {},
) {
  let result: { status: string; code?: string };
  try {
    result = await executeFinanceJob(db, tenantId, job, dependencies);
  } catch (error) {
    result = { status: "blocked", code: financeFailureCode(error) };
  }
  return persistFinanceJobOutcome(db, tenantId, job, result);
}
