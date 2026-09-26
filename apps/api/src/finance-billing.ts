import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  type Actor,
  type Database,
  type Tx,
  event,
  putRecord,
} from "@trainer/db";
import { stripeClient } from "@trainer/providers";
import { refundEligible } from "@trainer/domain";
import { z } from "zod";
import { requireRecentMfa } from "./security.ts";
import { processStripeEvent } from "./stripe-events.ts";

const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
const uuid = z.string().uuid();
const lock = (tx: Tx, a: Actor) =>
  tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [a.tenantId]);
export function subscriptionHasAccess(s: any, now = Date.now()): boolean {
  if (!s) return false;
  if (["active", "trialing"].includes(s.status))
    return !s.period_end || new Date(s.period_end).getTime() > now;
  return (
    s.status === "past_due" &&
    Number.isFinite(Date.parse(s.data?.graceUntil)) &&
    Date.parse(s.data.graceUntil) > now
  );
}
export async function currentPaidSubscription(tx: Tx, userId: string) {
  const [s] = await tx.query("SELECT * FROM subscriptions WHERE user_id=$1", [
    userId,
  ]);
  return subscriptionHasAccess(s) ? s : undefined;
}
/** A distinct business transition gets a distinct intent. Uncertain dispatch is never resubmitted. */
export async function changeRenewal(
  db: Database,
  a: Actor,
  cancel: boolean,
  stripe = stripeClient(),
) {
  const intent: any = await db.tenant({ ...a, role: "finance" }, async (tx) => {
    await lock(tx, a);
    const [s] = await tx.query(
      "SELECT * FROM subscriptions WHERE user_id=$1 FOR UPDATE",
      [a.userId],
    );
    if (
      !s?.provider_id ||
      ["canceled", "unpaid", "incomplete_expired"].includes(s.status)
    )
      throw fail(
        404,
        "NO_SUBSCRIPTION",
        "No renewable provider membership exists",
      );
    const [pending] = await tx.query(
      "SELECT * FROM records WHERE kind='subscription_transition' AND owner_user_id=$1 AND status IN ('submitting','unknown') ORDER BY created_at DESC LIMIT 1",
      [a.userId],
    );
    if (pending)
      throw fail(
        409,
        "RENEWAL_UNRESOLVED",
        "Reconcile the existing renewal instruction before making another change",
      );
    if (s.cancel_at_period_end === cancel)
      return { done: true, periodEnd: s.period_end };
    if (
      !cancel &&
      s.period_end &&
      new Date(s.period_end).getTime() <= Date.now()
    )
      throw fail(409, "MEMBERSHIP_ENDED", "This membership has ended");
    const r = await putRecord(
      tx,
      a,
      "subscription_transition",
      {
        subscriptionId: s.id,
        providerId: s.provider_id,
        cancel,
        periodEnd: s.period_end,
      },
      { ownerId: a.userId, status: "submitting" },
    );
    await event(tx, a, "subscription.renewal_requested", r.id, { cancel });
    return { ...r, done: false };
  });
  if (intent.done) return { ok: true, accessUntil: intent.periodEnd };
  try {
    const remote = await stripe.subscriptions.update(
      intent.data.providerId,
      { cancel_at_period_end: cancel },
      { idempotencyKey: `renewal:${intent.id}` },
    );
    if (
      remote.id !== intent.data.providerId ||
      remote.cancel_at_period_end !== cancel
    )
      throw new Error(
        "Renewal response did not confirm the requested transition",
      );
    await confirmRenewal(db, a, intent.id, remote);
  } catch (error) {
    await db.tenant({ ...a, role: "finance" }, (tx) =>
      tx.query(
        "UPDATE records SET status='unknown',updated_at=now() WHERE id=$1 AND kind='subscription_transition' AND status='submitting'",
        [intent.id],
      ),
    );
    throw error;
  }
  return { ok: true, accessUntil: intent.data.periodEnd };
}
async function confirmRenewal(
  db: Database,
  a: Actor,
  intentId: string,
  remote: any,
) {
  return db.tenant({ ...a, role: "finance" }, async (tx) => {
    await lock(tx, a);
    const [r] = await tx.query(
      "SELECT * FROM records WHERE id=$1 AND kind='subscription_transition' AND owner_user_id=$2 FOR UPDATE",
      [intentId, a.userId],
    );
    if (!r || !["submitting", "unknown"].includes(r.status)) return;
    if (
      r.data.providerId !== remote.id ||
      remote.cancel_at_period_end !== r.data.cancel
    )
      throw fail(
        409,
        "RENEWAL_UNRESOLVED",
        "Provider state does not yet confirm the requested change; the instruction remains held",
      );
    await tx.query(
      "UPDATE subscriptions SET cancel_at_period_end=$2 WHERE id=$1 AND user_id=$3 AND provider_id=$4",
      [r.data.subscriptionId, r.data.cancel, a.userId, remote.id],
    );
    await tx.query(
      "UPDATE records SET status='succeeded',updated_at=now() WHERE id=$1",
      [r.id],
    );
    await event(
      tx,
      a,
      r.data.cancel
        ? "subscription.cancel_scheduled"
        : "subscription.reactivated",
      r.id,
    );
  });
}
export async function reconcileRenewal(
  db: Database,
  a: Actor,
  stripe = stripeClient(),
) {
  const [r] = await db.tenant({ ...a, role: "finance" }, (tx) =>
    tx.query(
      "SELECT * FROM records WHERE kind='subscription_transition' AND owner_user_id=$1 AND status IN ('submitting','unknown') ORDER BY created_at DESC LIMIT 1",
      [a.userId],
    ),
  );
  if (!r) return { status: "resolved" };
  const remote = await stripe.subscriptions.retrieve(r.data.providerId);
  await confirmRenewal(db, a, r.id, remote);
  return { status: "resolved" };
}
export async function billingHistory(db: Database, a: Actor) {
  return db.tenant({ ...a, role: "finance" }, async (tx) => {
    const charges = await tx.query(
      "SELECT j.*,coalesce((SELECT sum((r.data->>'refundAmountMinor')::bigint) FROM journals r WHERE r.data->>'originalJournalId'=j.id::text),0)::text AS refunded_minor FROM journals j WHERE j.data->>'userId'=$1 AND j.source_key LIKE 'stripe-invoice:%' ORDER BY j.created_at DESC LIMIT 100",
      [a.userId],
    );
    const invoices = await tx.query(
      "SELECT id,status,data,created_at FROM records WHERE kind='billing_invoice' AND owner_user_id=$1 ORDER BY created_at DESC LIMIT 100",
      [a.userId],
    );
    const requests = await tx.query(
      "SELECT id,status,data,created_at FROM records WHERE kind='refund' AND owner_user_id=$1 ORDER BY created_at DESC LIMIT 100",
      [a.userId],
    );
    const transitions = await tx.query(
      "SELECT id,status,data,created_at FROM records WHERE kind='subscription_transition' AND owner_user_id=$1 AND status IN ('submitting','unknown')",
      [a.userId],
    );
    return {
      invoices,
      requests,
      transitions,
      charges: charges.map((c) => ({
        id: c.id,
        chargeId: c.data.chargeId,
        invoiceId: c.data.invoiceId,
        chargedAt: c.data.chargedAt ?? c.created_at,
        amountMinor: c.data.grossMinor,
        refundedMinor: Number(c.refunded_minor),
        remainingMinor: Math.max(
          0,
          c.data.grossMinor - Number(c.refunded_minor),
        ),
        eligible:
          !!c.data.chargeId &&
          refundEligible(c.data.chargedAt ?? c.created_at) &&
          Number(c.refunded_minor) < c.data.grossMinor &&
          !requests.some(
            (r) =>
              r.data.chargeId === c.data.chargeId,
          ),
      })),
    };
  });
}
export async function requestRefund(
  db: Database,
  a: Actor,
  input: { chargeId: string; reason: string; userId?: string },
  override = false,
) {
  return db.tenant({ ...a, role: "finance" }, async (tx) => {
    await lock(tx, a);
    const userId = override ? uuid.parse(input.userId) : a.userId;
    const [charge] = await tx.query(
      "SELECT * FROM journals WHERE data->>'userId'=$1 AND data->>'chargeId'=$2 AND source_key LIKE 'stripe-invoice:%'",
      [userId, input.chargeId],
    );
    if (
      !charge ||
      (!override && !refundEligible(charge.data.chargedAt ?? charge.created_at))
    )
      throw fail(
        400,
        "REFUND_WINDOW",
        "This charge is unavailable or outside the seven-day request window",
      );
    const [existing] = await tx.query(
      "SELECT id FROM records WHERE kind='refund' AND data->>'chargeId'=$1",
      [input.chargeId],
    );
    if (existing)
      throw fail(
        409,
        "ALREADY_REQUESTED",
        "A refund instruction already exists; reconcile it before any new request",
      );
    const [prior] = await tx.query(
      "SELECT coalesce(sum((data->>'refundAmountMinor')::bigint),0)::text AS amount FROM journals WHERE data->>'originalJournalId'=$1",
      [charge.id],
    );
    const amountMinor = charge.data.grossMinor - Number(prior.amount);
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0)
      throw fail(
        409,
        "ALREADY_REFUNDED",
        "This charge has been fully refunded",
      );
    const r = await putRecord(
      tx,
      a,
      "refund",
      {
        chargeId: input.chargeId,
        reason: input.reason,
        journalId: charge.id,
        amountMinor,
        requestedAt: new Date().toISOString(),
        override,
      },
      { ownerId: userId, status: "requested" },
    );
    await event(
      tx,
      a,
      override ? "refund.override_requested" : "refund.requested",
      r.id,
      { reason: input.reason },
    );
    return r;
  });
}
export async function decideRefund(
  db: Database,
  a: Actor,
  refundId: string,
  input: { approve: boolean; reason: string; revision?: number },
  override = false,
  stripe?: ReturnType<typeof stripeClient>,
) {
  // Stripe credentials remain usable for obligations when new sales are paused.
  const client = input.approve ? (stripe ?? stripeClient()) : null;
  const r = await db.tenant({ ...a, role: "finance" }, async (tx) => {
    await lock(tx, a);
    const [r] = await tx.query(
      "SELECT * FROM records WHERE id=$1 AND kind='refund' FOR UPDATE",
      [uuid.parse(refundId)],
    );
    if (!r) throw fail(404, "NOT_FOUND", "Refund request unavailable");
    if (input.revision !== undefined && r.version !== input.revision)
      throw fail(
        409,
        "STALE_REVISION",
        "Refund changed; reload before deciding",
      );
    if (r.status !== "requested" && !(override && r.status === "declined"))
      throw fail(
        409,
        "REFUND_STATE",
        "This request already has an instruction; reconcile its outcome",
      );
    const [charge] = await tx.query(
      "SELECT * FROM journals WHERE id=$1 AND data->>'chargeId'=$2 AND data->>'userId'=$3",
      [r.data.journalId, r.data.chargeId, r.owner_user_id],
    );
    if (!charge)
      throw fail(
        409,
        "CHARGE_REQUIRED",
        "Reconcile the original charge before approving a refund",
      );
    const [prior] = await tx.query(
      "SELECT coalesce(sum((data->>'refundAmountMinor')::bigint),0)::text AS amount FROM journals WHERE data->>'originalJournalId'=$1",
      [charge.id],
    );
    const remaining = charge.data.grossMinor - Number(prior.amount);
    if (
      input.approve &&
      (!Number.isSafeInteger(r.data.amountMinor) ||
        r.data.amountMinor <= 0 ||
        r.data.amountMinor > remaining)
    )
      throw fail(
        409,
        "REFUND_AMOUNT_CHANGED",
        "The remaining charge amount changed; reconcile this request",
      );
    await tx.query(
      "UPDATE records SET status=$2,version=version+1,data=data||$3::jsonb,updated_at=now() WHERE id=$1",
      [
        r.id,
        input.approve ? "submitting" : "declined",
        JSON.stringify({
          decisionReason: input.reason,
          reviewedBy: a.userId,
          override,
          submittedAt: new Date().toISOString(),
        }),
      ],
    );
    await event(
      tx,
      a,
      override
        ? "refund.admin_override"
        : input.approve
          ? "refund.approved"
          : "refund.declined",
      r.id,
      { reason: input.reason },
    );
    return r;
  });
  if (client) {
    try {
      const remote = await client.refunds.create(
        {
          charge: r.data.chargeId,
          amount: r.data.amountMinor,
          metadata: {
            refund_request_id: r.id,
            tenant_id: a.tenantId,
            user_id: r.owner_user_id,
          },
        },
        { idempotencyKey: `refund:${r.id}` },
      );
      if (!remote.id) throw new Error("Provider omitted refund identity");
      await db.tenant({ ...a, role: "finance" }, (tx) =>
        tx.query(
          "UPDATE records SET status='submitted',data=data||$2::jsonb,updated_at=now() WHERE id=$1 AND status IN ('submitting','unknown')",
          [r.id, JSON.stringify({ providerRefundId: remote.id })],
        ),
      );
    } catch (e) {
      await db.tenant({ ...a, role: "finance" }, (tx) =>
        tx.query(
          "UPDATE records SET status='unknown',updated_at=now() WHERE id=$1 AND status='submitting'",
          [r.id],
        ),
      );
      throw e;
    }
  }
  return { ok: true };
}
export async function reconcileRefund(
  db: Database,
  a: Actor,
  refundId: string,
  stripe = stripeClient(),
) {
  const [r] = await db.tenant({ ...a, role: "finance" }, (tx) =>
    tx.query("SELECT * FROM records WHERE id=$1 AND kind='refund'", [
      uuid.parse(refundId),
    ]),
  );
  if (!r) throw fail(404, "NOT_FOUND", "Refund request unavailable");
  if (!["submitting", "submitted", "unknown"].includes(r.status))
    return { status: r.status };
  const page = await stripe.refunds.list({
    charge: r.data.chargeId,
    limit: 100,
  });
  const remote = page.data.find(
    (item) =>
      item.id === r.data.providerRefundId ||
      item.metadata?.refund_request_id === r.id,
  );
  if (!remote)
    throw fail(
      409,
      "REFUND_UNRESOLVED",
      "No matching provider refund is confirmed; the existing instruction remains held",
    );
  await processStripeEvent(db, {
    id: `reconcile-refund:${remote.id}:${remote.status}`,
    created: Math.floor(Date.now() / 1000),
    type: "refund.updated",
    data: { object: remote },
  });
  await db.tenant({ ...a, role: "finance" }, (tx) =>
    event(tx, a, "refund.provider_reconciled", r.id, {
      providerRefundId: remote.id,
      status: remote.status,
    }),
  );
  return { status: remote.status };
}
function identity(req: FastifyRequest) {
  if (!req.identity) throw fail(401, "AUTH_REQUIRED", "Please sign in");
  return req.identity;
}
function owner(req: FastifyRequest) {
  const a = identity(req);
  if (a.role !== "owner")
    throw fail(403, "OWNER_REQUIRED", "Trainer owner access required");
  requireRecentMfa(a);
  return a;
}
export function registerFinanceBilling(app: FastifyInstance, db: Database) {
  app.get("/api/v1/membership/billing", (req) =>
    billingHistory(db, identity(req)),
  );
  app.post("/api/v1/membership/cancel", (req) =>
    changeRenewal(db, identity(req), true),
  );
  app.post("/api/v1/membership/reactivate", (req) =>
    changeRenewal(db, identity(req), false),
  );
  app.post("/api/v1/membership/renewal/reconcile", (req) =>
    reconcileRenewal(db, identity(req)),
  );
  const requestSchema = z.object({
    chargeId: z.string().min(3).max(200),
    reason: z.string().trim().min(5).max(2000),
  });
  const decisionSchema = z.object({
    approve: z.boolean(),
    reason: z.string().trim().min(3).max(2000),
    revision: z.number().int().positive().optional(),
  });
  app.post("/api/v1/refund-requests", (req) =>
    requestRefund(db, identity(req), requestSchema.parse(req.body)),
  );
  app.post("/api/v1/refund-requests/:id/decision", (req) =>
    decideRefund(
      db,
      owner(req),
      (req.params as any).id,
      decisionSchema.parse(req.body),
    ),
  );
  app.post("/api/v1/refund-requests/:id/reconcile", (req) =>
    reconcileRefund(db, owner(req), (req.params as any).id),
  );
  function finance(req: FastifyRequest) {
    const a = identity(req);
    if (!["admin", "finance"].includes(a.platformRole))
      throw fail(403, "FINANCE_REQUIRED", "Platform finance access required");
    requireRecentMfa(a);
    return {
      ...a,
      tenantId: uuid.parse((req.params as any).tenantId),
      role: "finance",
    };
  }
  app.post("/api/v1/admin/tenants/:tenantId/finance/refunds", (req) =>
    requestRefund(
      db,
      finance(req),
      requestSchema.extend({ userId: uuid }).parse(req.body),
      true,
    ),
  );
  app.post(
    "/api/v1/admin/tenants/:tenantId/finance/refunds/:id/decision",
    (req) =>
      decideRefund(
        db,
        finance(req),
        (req.params as any).id,
        decisionSchema
          .extend({ revision: z.number().int().positive() })
          .parse(req.body),
        true,
      ),
  );
  app.post(
    "/api/v1/admin/tenants/:tenantId/finance/refunds/:id/reconcile",
    (req) => reconcileRefund(db, finance(req), (req.params as any).id),
  );
}
