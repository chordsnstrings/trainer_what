import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  elevated,
  type Actor,
  type Database,
  type Tx,
  event,
  putRecord,
} from "@trainer/db";
import { stripeClient, stripeRefused } from "@trainer/providers";
import { refundEligible } from "@trainer/domain";
import { z } from "zod";
import { requireRecentMfa } from "./security.ts";
import { processStripeEvent } from "./stripe-events.ts";
import { instructionSettled, refusalOf } from "./stripe-outcomes.ts";

const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
const uuid = z.string().uuid();
const lock = (tx: Tx, a: Actor) =>
  tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [a.tenantId]);
/**
 * A member's own billing self-service runs in its own scope (a follower sees
 * only its subscription and billing records; its charges come from the
 * member_charges()/member_charge() definer helpers, migration 061). The
 * workspace owner and platform finance operators act with the finance role.
 */
const financeScope = (a: Actor): Actor =>
  a.elevation || a.role === "owner" || a.role === "finance"
    ? { ...a, role: "finance" }
    : a;
/**
 * A renewing provider-billed membership keeps access this long after its
 * stored period end: Stripe renews at that moment, and the renewal reaches
 * the app only with its webhook. A failed renewal payment is mirrored as
 * past_due (then the grace rule applies) and a scheduled end as canceled.
 */
export const RENEWAL_WEBHOOK_TOLERANCE_MS = 24 * 3600000;
export function subscriptionHasAccess(s: any, now = Date.now()): boolean {
  if (!s) return false;
  if (["active", "trialing"].includes(s.status))
    return (
      !s.period_end ||
      new Date(s.period_end).getTime() +
        (s.provider_id && !s.cancel_at_period_end
          ? RENEWAL_WEBHOOK_TOLERANCE_MS
          : 0) >
        now
    );
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
/**
 * The provider subscription no longer renews: cancel_at_period_end, or an
 * end scheduled with cancel_at (flexible billing mode), or already ended.
 */
const endsAtStripe = (remote: any) =>
  !!remote.cancel_at_period_end ||
  Number(remote.cancel_at) > 0 ||
  ["canceled", "incomplete_expired"].includes(remote.status);
/** Whether the provider state shows a transition's requested outcome. */
function transitionDone(data: any, remote: any) {
  if (data.immediate) return remote.status === "canceled";
  // A subscription that already ended no longer renews: a cancel request
  // is satisfied by it (and a reactivation never can be).
  if (["canceled", "incomplete_expired"].includes(remote.status))
    return data.cancel === true;
  return data.cancel ? endsAtStripe(remote) : !endsAtStripe(remote);
}
/**
 * A distinct business transition gets a distinct intent. Uncertain dispatch
 * is never resubmitted; a Stripe refusal (4xx) is final and frees the member
 * to try again. `immediate` ends the subscription now instead of at period
 * end: a membership with no paid time left (past due, incomplete, unpaid),
 * whose open invoice Stripe would otherwise keep collecting.
 */
export async function changeRenewal(
  db: Database,
  a: Actor,
  cancel: boolean,
  stripe = stripeClient(),
  /** Someone acting for the member (an owner ending the membership). */
  initiatedBy?: Actor,
  options: { immediate?: boolean } = {},
) {
  const intent: any = await db.tenant(financeScope(a), async (tx) => {
    await lock(tx, a);
    const [s] = await tx.query(
      "SELECT * FROM subscriptions WHERE user_id=$1 FOR UPDATE",
      [a.userId],
    );
    // An unpaid membership (Stripe's "mark as unpaid" setting) has no paid
    // access left and is ended now; it is never switched back on.
    const immediate =
      cancel &&
      !!s?.provider_id &&
      (s.status === "unpaid" ||
        (options.immediate === true &&
          ["past_due", "incomplete"].includes(s.status)));
    if (
      !s?.provider_id ||
      ["canceled", "incomplete_expired"].includes(s.status) ||
      (s.status === "unpaid" && !immediate)
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
    if (!immediate && s.cancel_at_period_end === cancel)
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
        ...(immediate ? { immediate: true } : {}),
        // Switching renewal back on clears an end Stripe scheduled with
        // cancel_at (it would survive cancel_at_period_end=false).
        ...(!cancel && s.data?.scheduledCancelAt
          ? { clearCancelAt: true }
          : {}),
        ...(initiatedBy
          ? {
              initiatedBy: {
                userId: initiatedBy.userId,
                role: initiatedBy.role,
              },
            }
          : {}),
      },
      { ownerId: a.userId, status: "submitting" },
    );
    await event(
      tx,
      initiatedBy ?? a,
      "subscription.renewal_requested",
      r.id,
      initiatedBy
        ? { cancel, memberId: a.userId, ...(immediate ? { immediate } : {}) }
        : { cancel, ...(immediate ? { immediate } : {}) },
    );
    return { ...r, done: false };
  });
  if (intent.done) return { ok: true, accessUntil: intent.periodEnd };
  try {
    const remote: any = intent.data.immediate
      ? await stripe.subscriptions.cancel(intent.data.providerId, undefined, {
          idempotencyKey: `renewal:${intent.id}`,
        })
      : await stripe.subscriptions.update(
          intent.data.providerId,
          intent.data.clearCancelAt
            ? { cancel_at: "" }
            : { cancel_at_period_end: cancel },
          { idempotencyKey: `renewal:${intent.id}` },
        );
    if (
      remote.id !== intent.data.providerId ||
      !transitionDone(intent.data, remote)
    )
      throw new Error(
        "Renewal response did not confirm the requested transition",
      );
    await confirmRenewal(db, a, intent.id, remote);
    if (intent.data.immediate || intent.data.clearCancelAt)
      await mirrorProviderSubscription(db, a, remote, stripe);
  } catch (error) {
    // A Stripe refusal changed nothing: the instruction fails and the
    // member may try again. Anything else stays held for reconciliation.
    const refused = stripeRefused(error);
    await db.tenant(financeScope(a), (tx) =>
      tx.query(
        "UPDATE records SET status=$2,data=data||$3::jsonb,updated_at=now() WHERE id=$1 AND kind='subscription_transition' AND status='submitting'",
        [
          intent.id,
          refused ? "failed" : "unknown",
          JSON.stringify(refused ? { providerRefusal: refusalOf(error) } : {}),
        ],
      ),
    );
    throw error;
  }
  return {
    ok: true,
    accessUntil: intent.data.immediate ? null : intent.data.periodEnd,
  };
}
/**
 * A subscription ended now, or an end cleared from cancel_at, changes more
 * than the member's renewal flag: the provider's returned subscription is
 * mirrored through the provider projection (a service identity), as its
 * webhook would, so an exit sees the ended membership at once. The webhook
 * that follows is idempotent with it.
 */
async function mirrorProviderSubscription(
  db: Database,
  a: Actor,
  remote: any,
  stripe: ReturnType<typeof stripeClient>,
) {
  if (typeof remote?.status !== "string") return;
  try {
    await processStripeEvent(
      db,
      {
        id: `renewal-confirmed:${remote.id}:${remote.status}:${Date.now()}`,
        type:
          remote.status === "canceled"
            ? "customer.subscription.deleted"
            : "customer.subscription.updated",
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            ...remote,
            object: "subscription",
            metadata: {
              ...remote.metadata,
              tenant_id: a.tenantId,
              user_id: a.userId,
            },
          },
        },
      },
      { stripe },
    );
  } catch {
    console.warn("Provider subscription change is mirrored by its webhook");
  }
}
async function confirmRenewal(
  db: Database,
  a: Actor,
  intentId: string,
  remote: any,
  /** A reconciliation read long after dispatch: a missing effect is final. */
  settle = false,
) {
  return db.tenant(financeScope(a), async (tx) => {
    await lock(tx, a);
    const [r] = await tx.query(
      "SELECT * FROM records WHERE id=$1 AND kind='subscription_transition' AND owner_user_id=$2 FOR UPDATE",
      [intentId, a.userId],
    );
    if (!r || !["submitting", "unknown"].includes(r.status)) return;
    if (r.data.providerId !== remote.id || !transitionDone(r.data, remote)) {
      if (settle && r.data.providerId === remote.id) {
        await tx.query(
          "UPDATE records SET status='failed',data=data||$2::jsonb,updated_at=now() WHERE id=$1",
          [
            r.id,
            JSON.stringify({
              providerRefusal: {
                code: "NOT_APPLIED",
                message:
                  "The provider subscription does not show this change long after it was sent",
                at: new Date().toISOString(),
              },
            }),
          ],
        );
        await event(tx, a, "subscription.renewal_not_applied", r.id);
        return;
      }
      throw fail(
        409,
        "RENEWAL_UNRESOLVED",
        "Provider state does not yet confirm the requested change; the instruction remains held",
      );
    }
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
        ? r.data.immediate
          ? "subscription.ended_now"
          : "subscription.cancel_scheduled"
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
  const [r] = await db.tenant(financeScope(a), (tx) =>
    tx.query(
      "SELECT * FROM records WHERE kind='subscription_transition' AND owner_user_id=$1 AND status IN ('submitting','unknown') ORDER BY created_at DESC LIMIT 1",
      [a.userId],
    ),
  );
  if (!r) return { status: "resolved" };
  const remote = await stripe.subscriptions.retrieve(r.data.providerId);
  await confirmRenewal(
    db,
    a,
    r.id,
    remote,
    instructionSettled({ created_at: r.created_at }),
  );
  if (
    (r.data.immediate || r.data.clearCancelAt) &&
    r.data.providerId === remote.id &&
    transitionDone(r.data, remote)
  )
    await mirrorProviderSubscription(db, a, remote, stripe);
  return { status: "resolved" };
}
export async function billingHistory(db: Database, a: Actor) {
  return db.tenant(financeScope(a), async (tx) => {
    // The member's own charges only (journals stay finance-scoped).
    const charges = await tx.query(
      "SELECT id,data,created_at,refunded_minor::text AS refunded_minor FROM member_charges()",
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
    // The member's own renewal state, for screens without the workspace
    // bootstrap (such as the suspended-workspace screen).
    const [membership] = await tx.query(
      "SELECT status,cancel_at_period_end,period_end,price_minor,provider_id IS NOT NULL AS renewable FROM subscriptions WHERE user_id=$1",
      [a.userId],
    );
    return {
      membership: membership ?? null,
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
          // A failed or canceled refund moved no money: the charge may be
          // requested again.
          !requests.some(
            (r) => r.data.chargeId === c.data.chargeId && r.status !== "failed",
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
  return db.tenant(financeScope(a), async (tx) => {
    await lock(tx, a);
    const userId = override ? uuid.parse(input.userId) : a.userId;
    // Self-service reads only the member's own charge (member_charge(),
    // migration 061); an operator override reads the journal directly.
    const [charge] = override
      ? await tx.query(
          "SELECT j.*,coalesce((SELECT sum((r.data->>'refundAmountMinor')::bigint) FROM journals r WHERE r.data->>'originalJournalId'=j.id::text),0)::text AS refunded_minor FROM journals j WHERE j.data->>'userId'=$1 AND j.data->>'chargeId'=$2 AND (j.source_key LIKE 'stripe-invoice:%' OR j.source_key LIKE 'stripe-programme:%')",
          [userId, input.chargeId],
        )
      : await tx.query(
          "SELECT id,data,created_at,refunded_minor::text AS refunded_minor FROM member_charge($1)",
          [input.chargeId],
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
    // One refund request per charge. A failed (or canceled) refund moved
    // no money: the same request starts a new attempt, a new instruction
    // with its own idempotency key; the failed refund stays in its history.
    const [existing] = await tx.query(
      "SELECT * FROM records WHERE kind='refund' AND data->>'chargeId'=$1 FOR UPDATE",
      [input.chargeId],
    );
    if (existing && existing.status !== "failed")
      throw fail(
        409,
        "ALREADY_REQUESTED",
        "A refund instruction already exists; reconcile it before any new request",
      );
    const amountMinor = charge.data.grossMinor - Number(charge.refunded_minor);
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0)
      throw fail(
        409,
        "ALREADY_REFUNDED",
        "This charge has been fully refunded",
      );
    const request = {
      chargeId: input.chargeId,
      reason: input.reason,
      journalId: charge.id,
      amountMinor,
      requestedAt: new Date().toISOString(),
      override,
    };
    const r = existing
      ? (
          await tx.query(
            "UPDATE records SET status='requested',version=version+1,data=$2,updated_at=now() WHERE id=$1 RETURNING *",
            [
              existing.id,
              JSON.stringify({
                ...request,
                attempt: Number(existing.data.attempt ?? 0) + 1,
                failedRefundIds: [
                  ...(existing.data.failedRefundIds ?? []),
                  ...(existing.data.providerRefundId
                    ? [existing.data.providerRefundId]
                    : []),
                ],
                previousAttempts: [
                  ...(existing.data.previousAttempts ?? []),
                  {
                    reason: existing.data.reason,
                    amountMinor: existing.data.amountMinor,
                    providerRefundId: existing.data.providerRefundId ?? null,
                    providerStatus: existing.data.providerStatus ?? null,
                    providerRefusal: existing.data.providerRefusal ?? null,
                    requestedAt: existing.data.requestedAt,
                  },
                ].slice(-10),
              }),
            ],
          )
        )[0]
      : await putRecord(tx, a, "refund", request, {
          ownerId: userId,
          status: "requested",
        });
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
  const r = await db.tenant(financeScope(a), async (tx) => {
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
        {
          idempotencyKey:
            `refund:${r.id}` + (r.data.attempt ? `:${r.data.attempt}` : ""),
        },
      );
      if (!remote.id) throw new Error("Provider omitted refund identity");
      await db.tenant(financeScope(a), (tx) =>
        tx.query(
          "UPDATE records SET status='submitted',data=data||$2::jsonb,updated_at=now() WHERE id=$1 AND status IN ('submitting','unknown')",
          [r.id, JSON.stringify({ providerRefundId: remote.id })],
        ),
      );
    } catch (e) {
      // Stripe refused the refund (for example a charge that is disputed):
      // nothing moved, so the request fails and the charge may be requested
      // again. Anything else stays held for reconciliation.
      const refused = stripeRefused(e);
      await db.tenant(financeScope(a), (tx) =>
        tx.query(
          "UPDATE records SET status=$2,data=data||$3::jsonb,updated_at=now() WHERE id=$1 AND status='submitting'",
          [
            r.id,
            refused ? "failed" : "unknown",
            JSON.stringify(refused ? { providerRefusal: refusalOf(e) } : {}),
          ],
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
  const [r] = await db.tenant(financeScope(a), (tx) =>
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
      !(r.data.failedRefundIds ?? []).includes(item.id) &&
      (item.id === r.data.providerRefundId ||
        item.metadata?.refund_request_id === r.id),
  );
  // Long after an uncertain dispatch, a complete refund list without this
  // instruction proves Stripe never created it: it fails (nothing moved)
  // and the charge may be requested again.
  if (
    !remote &&
    !page.has_more &&
    !r.data.providerRefundId &&
    r.status !== "submitted" &&
    instructionSettled({ created_at: r.data.submittedAt ?? r.created_at })
  ) {
    await db.tenant(financeScope(a), async (tx) => {
      await tx.query(
        "UPDATE records SET status='failed',data=data||$2::jsonb,updated_at=now() WHERE id=$1 AND status IN ('submitting','unknown')",
        [
          r.id,
          JSON.stringify({
            providerRefusal: {
              code: "NOT_CREATED",
              message: "No provider refund exists for this instruction",
              at: new Date().toISOString(),
            },
          }),
        ],
      );
      await event(tx, a, "refund.not_created", r.id);
    });
    return { status: "failed" };
  }
  if (!remote)
    throw fail(
      409,
      "REFUND_UNRESOLVED",
      "No matching provider refund is confirmed; the existing instruction remains held",
    );
  await processStripeEvent(
    db,
    {
      id: `reconcile-refund:${remote.id}:${remote.status}`,
      created: Math.floor(Date.now() / 1000),
      type: "refund.updated",
      data: { object: remote },
    },
    { stripe },
  );
  await db.tenant(financeScope(a), (tx) =>
    event(tx, a, "refund.provider_reconciled", r.id, {
      providerRefundId: remote.id,
      status: remote.status,
    }),
  );
  return { status: remote.status };
}
export async function adminRefundReview(
  db: Database,
  a: Actor,
  chargeId?: string,
) {
  const result = await db.tenant(financeScope(a), async (tx) => ({
    requests: await tx.query(
      "SELECT id,owner_user_id,status,version,data,created_at FROM records WHERE kind='refund' AND ($1::text IS NULL OR data->>'chargeId'=$1) ORDER BY created_at DESC LIMIT 200",
      [chargeId ?? null],
    ),
    charges: await tx.query(
      "SELECT j.id,j.data,j.created_at,coalesce((SELECT sum((r.data->>'refundAmountMinor')::bigint) FROM journals r WHERE r.data->>'originalJournalId'=j.id::text),0)::text AS refunded_minor FROM journals j WHERE (j.source_key LIKE 'stripe-invoice:%' OR j.source_key LIKE 'stripe-programme:%') AND j.data->>'chargeId' IS NOT NULL AND ($1::text IS NULL OR j.data->>'chargeId'=$1) ORDER BY j.created_at DESC LIMIT 200",
      [chargeId ?? null],
    ),
  }));
  const ids = Array.from(
    new Set(
      [
        ...result.requests.map((r) => r.owner_user_id),
        ...result.charges.map((c) => c.data.userId),
      ].filter(Boolean),
    ),
  );
  const users = ids.length
    ? await db.system((tx) =>
        tx.query(
          "SELECT u.id,u.name FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.tenant_id=$1 AND u.id=ANY($2::uuid[])",
          [a.tenantId, ids],
        ),
      )
    : [];
  const names = new Map(users.map((u) => [u.id, u.name]));
  return {
    requests: result.requests.map((r) => ({
      ...r,
      clientName: names.get(r.owner_user_id) ?? "Retained billing record",
    })),
    charges: result.charges.map((c) => ({
      id: c.id,
      chargeId: c.data.chargeId,
      userId: c.data.userId,
      clientName: names.get(c.data.userId) ?? "Retained billing record",
      chargedAt: c.data.chargedAt ?? c.created_at,
      amountMinor: c.data.grossMinor,
      remainingMinor: Math.max(0, c.data.grossMinor - Number(c.refunded_minor)),
      requestId:
        result.requests.find((r) => r.data.chargeId === c.data.chargeId)?.id ??
        null,
    })),
  };
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
export function registerFinanceBilling(
  app: FastifyInstance,
  db: Database,
  providers: { stripe?: () => ReturnType<typeof stripeClient> } = {},
) {
  app.get("/api/v1/membership/billing", (req) =>
    billingHistory(db, identity(req)),
  );
  // An injected provider (tests) replaces the default client; otherwise the
  // default parameter builds it, and it stays unavailable until configured.
  app.post("/api/v1/membership/cancel", (req) =>
    changeRenewal(db, identity(req), true, providers.stripe?.()),
  );
  app.post("/api/v1/membership/reactivate", (req) =>
    changeRenewal(db, identity(req), false, providers.stripe?.()),
  );
  app.post("/api/v1/membership/renewal/reconcile", (req) =>
    reconcileRenewal(db, identity(req), providers.stripe?.()),
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
      false,
      providers.stripe?.(),
    ),
  );
  app.post("/api/v1/refund-requests/:id/reconcile", (req) =>
    reconcileRefund(
      db,
      owner(req),
      (req.params as any).id,
      providers.stripe?.(),
    ),
  );
  function finance(req: FastifyRequest) {
    const a = identity(req);
    if (!["admin", "finance"].includes(a.platformRole))
      throw fail(403, "FINANCE_REQUIRED", "Platform finance access required");
    requireRecentMfa(a, true);
    return {
      ...a,
      ...elevated("platform-operator", {
        tenantId: uuid.parse((req.params as any).tenantId),
        userId: a.userId,
        role: "finance",
      }),
    };
  }
  app.get("/api/v1/admin/tenants/:tenantId/finance/refunds", (req) => {
    const a = finance(req),
      query = z
        .object({ chargeId: z.string().trim().min(3).max(200).optional() })
        .parse(req.query);
    return adminRefundReview(db, a, query.chargeId);
  });
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
        providers.stripe?.(),
      ),
  );
  app.post(
    "/api/v1/admin/tenants/:tenantId/finance/refunds/:id/reconcile",
    (req) =>
      reconcileRefund(
        db,
        finance(req),
        (req.params as any).id,
        providers.stripe?.(),
      ),
  );
}
