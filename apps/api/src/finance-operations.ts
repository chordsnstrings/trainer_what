import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  type Actor,
  type Database,
  type Tx,
  event,
  putRecord,
} from "@trainer/db";
import { journal, financeSummary, transitionPayout } from "./finance.ts";
import { requireRecentMfa } from "./security.ts";

const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
const periodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export function monthCutoff(period: string) {
  periodSchema.parse(period);
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(year, month, 1) - 4 * 3600000);
}
export async function closeMonth(
  tx: Tx,
  a: Actor,
  period: string,
  evidenceReference: string,
  now = new Date(),
) {
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [a.tenantId]);
  const [existing] = await tx.query(
    "SELECT * FROM records WHERE kind='close' AND data->>'period'=$1",
    [period],
  );
  if (existing) return existing;
  const cutoff = monthCutoff(period);
  if (now.getTime() < cutoff.getTime() + 7 * 86400000)
    throw fail(
      409,
      "PERIOD_OPEN",
      "A month can close after its seven-day refund review buffer",
    );
  const [unpriced] = await tx.query(
    "SELECT count(*)::int AS n FROM cost_events WHERE created_at<$1 AND cost_usd IS NULL",
    [cutoff.toISOString()],
  );
  const [unresolved] = await tx.query(
    "SELECT count(*)::int AS n FROM records WHERE (kind='refund' AND status IN ('requested','submitting','submitted','unknown')) OR (kind='reconciliation' AND status<>'resolved')",
  );
  const [unknown] = await tx.query(
    "SELECT count(*)::int AS n FROM payouts WHERE status IN ('submitted','processing','unknown')",
  );
  if (unpriced.n || unresolved.n || unknown.n)
    throw fail(
      409,
      "RECONCILIATION_REQUIRED",
      "Resolve unpriced usage, refunds, reconciliation exceptions and uncertain payments before closing",
    );
  const lines = await tx.query(
    "SELECT l.account,sum(l.amount_minor)::text AS amount FROM journal_lines l JOIN journals j ON j.id=l.journal_id AND j.tenant_id=l.tenant_id WHERE j.created_at<$1 GROUP BY l.account",
    [cutoff.toISOString()],
  );
  const accounts = Object.fromEntries(
      lines.map((r) => [r.account, Number(r.amount)]),
    ),
    summary = await financeSummary(tx);
  const earnings = Math.max(0, -(accounts.trainer_payable ?? 0));
  if ((summary.accounts.stripe_receivable ?? 0) !== 0)
    throw fail(
      409,
      "SETTLEMENT_REQUIRED",
      "Reconcile outstanding Stripe receivables before closing",
    );
  const r = await putRecord(
    tx,
    a,
    "close",
    {
      period,
      cutoff: cutoff.toISOString(),
      accounts,
      eligibleMinor: earnings,
      evidenceReference,
      reviewedBy: a.userId,
      policy: "month-end-uae-seven-day-review-v1",
    },
    { status: "closed" },
  );
  await event(tx, a, "finance.month_closed", r.id, { period });
  return r;
}
export function financeOperations(
  app: FastifyInstance,
  db: Database,
  identity: (
    r: FastifyRequest,
  ) => Actor & { platformRole: string; mfaAt?: string | null },
) {
  function finance(req: FastifyRequest) {
    const a = identity(req);
    if (!["admin", "finance"].includes(a.platformRole))
      throw fail(
        403,
        "FINANCE_REQUIRED",
        "Platform finance access is required",
      );
    requireRecentMfa(a);
    const tenantId = z
      .string()
      .uuid()
      .parse((req.params as any).tenantId);
    return { ...a, tenantId, role: "finance" };
  }
  const prefix = "/api/v1/admin/tenants/:tenantId/finance";
  app.get(prefix, async (req) => {
    const a = finance(req);
    return db.tenant(a, async (tx) => {
      await event(tx, a, "finance.workspace_inspected", a.tenantId);
      return {
        summary: await financeSummary(tx),
        records: await tx.query(
          "SELECT * FROM records WHERE kind IN ('close','beneficiary','reconciliation','refund') ORDER BY created_at DESC",
        ),
        payouts: await tx.query(
          "SELECT * FROM payouts ORDER BY created_at DESC",
        ),
      };
    });
  });
  app.post(prefix + "/settlements", async (req) => {
    const a = finance(req);
    const b = z
      .object({
        stripePayoutId: z.string().min(4).max(120),
        bankReference: z.string().min(5).max(200),
        grossMinor: z.number().int().positive().max(1000000000),
        feeMinor: z.number().int().min(0),
        netMinor: z.number().int().positive(),
        evidenceReference: z.string().min(10).max(500),
      })
      .strict()
      .parse(req.body);
    if (b.grossMinor !== b.netMinor + b.feeMinor)
      throw fail(
        400,
        "SETTLEMENT_MISMATCH",
        "Gross must equal net received plus actual processing fees",
      );
    return db.tenant(a, async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        a.tenantId,
      ]);
      const [prior] = await tx.query(
        "SELECT * FROM journals WHERE source_key=$1",
        ["stripe-settlement:" + b.stripePayoutId],
      );
      if (prior) {
        if (Object.entries(b).some(([key, value]) => prior.data[key] !== value))
          throw fail(
            409,
            "INTENT_CONFLICT",
            "Settlement reference already has different evidence",
          );
        return prior;
      }
      const totals = await financeSummary(tx);
      if (b.grossMinor > (totals.accounts.stripe_receivable ?? 0))
        throw fail(
          409,
          "EXCESS_SETTLEMENT",
          "Settlement exceeds this workspace’s unreconciled receivable",
        );
      return journal(
        tx,
        a,
        "stripe-settlement:" + b.stripePayoutId,
        "Verified Stripe bank settlement",
        [
          { account: "bank_cash", amount: b.netMinor },
          { account: "trainer_payable", amount: b.feeMinor },
          { account: "stripe_receivable", amount: -b.grossMinor },
        ],
        b,
      );
    });
  });
  app.post(prefix + "/close", async (req) => {
    const a = finance(req);
    const b = z
      .object({
        period: periodSchema,
        evidenceReference: z.string().min(10).max(500),
      })
      .parse(req.body);
    return db.tenant(a, (tx) =>
      closeMonth(tx, a, b.period, b.evidenceReference),
    );
  });
  app.post(prefix + "/beneficiaries/:id/review", async (req) => {
    const a = finance(req);
    const b = z
      .object({
        verified: z.boolean(),
        providerId: z.string().min(3).max(200),
        evidenceReference: z.string().min(10).max(500),
      })
      .parse(req.body);
    return db.tenant(a, async (tx) => {
      const [r] = await tx.query(
        "SELECT * FROM records WHERE id=$1 AND kind='beneficiary' FOR UPDATE",
        [(req.params as any).id],
      );
      if (!r) throw fail(404, "NOT_FOUND", "Destination unavailable");
      if (process.env.NODE_ENV === "production" && r.owner_user_id === a.userId)
        throw fail(
          403,
          "SECOND_REVIEWER_REQUIRED",
          "A different finance operator must review destination ownership",
        );
      await tx.query(
        "UPDATE records SET status=$2,data=data||$3::jsonb,updated_at=now() WHERE id=$1",
        [
          r.id,
          b.verified ? "verified" : "rejected",
          JSON.stringify({
            ...b,
            reviewedBy: a.userId,
            holdUntil: new Date(Date.now() + 72 * 3600000).toISOString(),
          }),
        ],
      );
      await event(tx, a, "beneficiary.reviewed", r.id, {
        verified: b.verified,
      });
      return { ok: true };
    });
  });
  app.post(prefix + "/payouts/:id/reconcile", async (req) => {
    const a = finance(req);
    const b = z
      .object({
        status: z.enum(["processing", "paid", "failed", "returned"]),
        bankReference: z.string().min(5).max(200),
        evidenceReference: z.string().min(10).max(500),
      })
      .parse(req.body);
    return db.tenant(a, async (tx) => {
      const p = await transitionPayout(
        tx,
        a,
        z
          .string()
          .uuid()
          .parse((req.params as any).id),
        b.status,
        b.bankReference,
      );
      await event(tx, a, "payout.evidence_recorded", p.id, {
        evidenceReference: b.evidenceReference,
        status: b.status,
      });
      return p;
    });
  });
  app.post(prefix + "/exceptions", async (req) => {
    const a = finance(req);
    const b = z
      .object({
        description: z.string().min(10).max(2000),
        externalReference: z.string().max(200),
      })
      .parse(req.body);
    return db.tenant(a, (tx) =>
      putRecord(tx, a, "reconciliation", b, { status: "open" }),
    );
  });
  app.post(prefix + "/exceptions/:id/resolve", async (req) => {
    const a = finance(req);
    const b = z
      .object({ evidenceReference: z.string().min(10).max(500) })
      .parse(req.body);
    return db.tenant(a, async (tx) => {
      const [r] = await tx.query(
        "UPDATE records SET status='resolved',data=data||$2::jsonb,updated_at=now() WHERE id=$1 AND kind='reconciliation' RETURNING id",
        [
          (req.params as any).id,
          JSON.stringify({ ...b, resolvedBy: a.userId }),
        ],
      );
      if (!r) throw fail(404, "NOT_FOUND", "Exception unavailable");
      await event(tx, a, "reconciliation.resolved", r.id, b);
      return r;
    });
  });
}
