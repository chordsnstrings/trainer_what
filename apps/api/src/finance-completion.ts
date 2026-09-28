import type { FastifyInstance, FastifyRequest } from "fastify";
import { elevated, type Database, event } from "@trainer/db";
import { z } from "zod";
import { requireRecentMfa } from "./security.ts";
import {
  bookingFeePolicy,
  effectiveFinancePolicy,
  publishFinancePolicy,
} from "./finance-policy.ts";
import { allocateCost, financialStatement } from "./finance-statements.ts";
import { monthRate, stripeFeeSettings } from "./cost-accounting.ts";
import { trainerRevenue } from "./admin-operations.ts";
import { tenantStripeFees } from "./stripe-fees.ts";
import { createPromotion, reconcilePromotion } from "./finance-promotions.ts";
const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
function identity(req: FastifyRequest) {
  if (!req.identity) throw fail(401, "AUTH_REQUIRED", "Please sign in");
  return req.identity;
}
function owner(req: FastifyRequest, write = true) {
  const a = identity(req);
  if (a.role !== "owner")
    throw fail(
      403,
      "OWNER_REQUIRED",
      "Only the trainer owner can manage offers",
    );
  if (write) requireRecentMfa(a);
  return a;
}
function operator(req: FastifyRequest, _write = true) {
  const a = identity(req);
  if (!["admin", "finance"].includes(a.platformRole))
    throw fail(403, "FINANCE_REQUIRED", "Platform finance access required");
  // Finance controls, statements included, need a fresh authenticator in
  // every environment, like the other platform finance routes.
  requireRecentMfa(a, true);
  return {
    ...a,
    ...elevated("platform-operator", {
      tenantId: z
        .string()
        .uuid()
        .parse((req.params as any).tenantId),
      userId: a.userId,
      role: "finance",
    }),
  };
}
export function registerFinanceCompletion(app: FastifyInstance, db: Database) {
  async function dashboard(a: ReturnType<typeof identity>) {
    return db.tenant(a, async (tx) => ({
      records: await tx.query(
        "SELECT * FROM records WHERE kind IN ('finance_policy','promotion','cost_allocation','finance_automation') ORDER BY created_at DESC LIMIT 200",
      ),
      products: await tx.query(
        "SELECT * FROM records WHERE kind='product' ORDER BY created_at DESC",
      ),
    }));
  }
  app.get("/api/v1/finance/completion", (req) => dashboard(owner(req, false)));
  // What a member payment leaves the trainer, for the estimate shown before
  // a price is set: Stripe's fee (paid by the trainer, owner decision of 28
  // September 2026) and the platform commission bands in effect.
  app.get("/api/v1/finance/fees", async (req) => {
    const a = identity(req);
    // Staff create paid sessions, so they see Stripe's fee and the booking
    // fee too; the commission bands are for the owner and finance.
    if (!["owner", "finance", "staff"].includes(a.role))
      throw fail(403, "FINANCE_REQUIRED", "Finance access required");
    const policy = await db.tenant(a, async (tx) => {
      if (a.role === "staff")
        return {
          commissionBps: null,
          bookingFeeBps: Number((await bookingFeePolicy(tx)).data.bookingFeeBps ?? 0),
        };
      const p = await effectiveFinancePolicy(tx);
      return {
        commissionBps: p.data.commissionBps as number[],
        bookingFeeBps: Number(p.data.bookingFeeBps ?? 0),
      };
    });
    return {
      stripe: stripeFeeSettings(),
      commissionBps: policy.commissionBps,
      /** The platform's fee on each paid 1:1 session (basis points). */
      bookingFeeBps: policy.bookingFeeBps,
      bands: ["Members 1–100", "Members 101–300", "Members 301–1,000", "Members 1,001+"],
      note: "An estimate for a card issued in the UAE. Stripe's fees are paid by you; the actual fee of each payment comes from Stripe and is shown on your monthly statement.",
    };
  });
  // Per Dubai month: Stripe's fees and other charges deducted from the
  // trainer's earnings (by when they were posted), and the AI Coach Service
  // Fee by the month it is for: a month's fee is posted after the month ends
  // and deducted from that month's payout, so each payout shows its own
  // month's fee (and any later adjustment of it), named by month.
  app.get("/api/v1/finance/deductions", async (req) => {
    const a = identity(req);
    if (!["owner", "finance"].includes(a.role))
      throw fail(403, "FINANCE_REQUIRED", "Finance access required");
    const { months, fees } = await db.tenant(a, async (tx) => ({
      months: await trainerRevenue(tx),
      fees: await tx.query(
        "SELECT j.data->>'period' AS period,coalesce(sum(l.amount_minor) FILTER(WHERE j.source_key LIKE 'usage:%'),0)::text AS fee,coalesce(sum(l.amount_minor) FILTER(WHERE j.source_key LIKE 'usage-adjustment:%'),0)::text AS adjustments FROM journals j JOIN journal_lines l ON l.tenant_id=j.tenant_id AND l.journal_id=j.id WHERE l.account='trainer_payable' AND (j.source_key LIKE 'usage:%' OR j.source_key LIKE 'usage-adjustment:%') AND j.data ? 'period' GROUP BY 1 ORDER BY 1 DESC",
      ),
    }));
    return {
      months: months.map((m) => ({
        month: m.month,
        stripeFeesMinor: m.stripe_fees_minor,
        /** The AI Coach Service Fee posted in the month (for earlier months). */
        aiCoachServiceFeeMinor: m.ai_coach_service_fee_minor,
        otherChargesMinor: m.other_charges_minor,
      })),
      aiCoachServiceFees: fees.map((f: any) => ({
        period: f.period as string,
        feeMinor: Number(f.fee),
        adjustmentsMinor: Number(f.adjustments),
      })),
    };
  });
  app.get("/api/v1/finance/statements/:period", (req) => {
    const a = identity(req);
    if (!["owner", "finance"].includes(a.role))
      throw fail(403, "FINANCE_REQUIRED", "Finance access required");
    const period = z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .parse((req.params as any).period);
    return monthRate(db, period).then(async (rate) => {
      // Stripe's own fee on this month's member payments, refunds and
      // disputes (the trainer pays them), read from Stripe per payment, and
      // for how many of them it has been read yet.
      const stripe = await tenantStripeFees(db, a, period);
      return {
        ...(await db.tenant(a, (tx) => financialStatement(tx, period, { rate }))),
        stripeFeesOnPayments: stripe.fees,
        stripeFeesRead: { sources: stripe.sources, read: stripe.read },
      };
    });
  });
  app.post("/api/v1/finance/promotions", (req) =>
    createPromotion(db, owner(req), req.body),
  );
  app.post("/api/v1/finance/promotions/:id/reconcile", (req) =>
    reconcilePromotion(db, owner(req), (req.params as any).id),
  );
  app.post("/api/v1/finance/promotions/:id/archive", async (req) => {
    const a = owner(req),
      b = z
        .object({
          revision: z.number().int().positive(),
          reason: z.string().min(5).max(500),
        })
        .parse(req.body);
    return db.tenant(a, async (tx) => {
      const [r] = await tx.query(
        "UPDATE records SET status='archived',version=version+1,updated_at=now() WHERE id=$1 AND kind='promotion' AND status='published' AND version=$2 RETURNING *",
        [
          z
            .string()
            .uuid()
            .parse((req.params as any).id),
          b.revision,
        ],
      );
      if (!r)
        throw fail(
          409,
          "STALE_REVISION",
          "Promotion changed; reload before archiving",
        );
      await event(tx, a, "finance.promotion_archived", r.id, {
        reason: b.reason,
      });
      return r;
    });
  });
  app.post("/api/v1/finance/products/:id/trial", async (req) => {
    const a = owner(req),
      b = z
        .object({
          revision: z.number().int().positive(),
          trialDays: z.number().int().min(0).max(30),
        })
        .strict()
        .parse(req.body);
    return db.tenant(a, async (tx) => {
      const [r] = await tx.query(
        "UPDATE records SET data=data||$3::jsonb,version=version+1,updated_at=now() WHERE id=$1 AND kind='product' AND version=$2 RETURNING *",
        [
          z
            .string()
            .uuid()
            .parse((req.params as any).id),
          b.revision,
          JSON.stringify({ trialDays: b.trialDays }),
        ],
      );
      if (!r)
        throw fail(
          409,
          "STALE_REVISION",
          "Offer changed; reload before saving trial settings",
        );
      await event(tx, a, "finance.trial_configured", r.id, {
        trialDays: b.trialDays,
      });
      return r;
    });
  });
  const prefix = "/api/v1/admin/tenants/:tenantId/finance";
  app.get(prefix + "/controls", (req) => dashboard(operator(req, false)));
  app.get(prefix + "/statements/:period", async (req) => {
    const a = operator(req, false);
    const period = z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .parse((req.params as any).period);
    const rate = await monthRate(db, period);
    return db.tenant(a, (tx) =>
      financialStatement(tx, period, { platformView: true, rate }),
    );
  });
  app.post(prefix + "/policies", (req) => {
    const a = operator(req);
    return db.tenant(a, (tx) => publishFinancePolicy(tx, a, req.body));
  });
  app.post(prefix + "/cost-allocations", (req) => {
    const a = operator(req);
    return db.tenant(a, (tx) => allocateCost(tx, a, req.body));
  });
}
