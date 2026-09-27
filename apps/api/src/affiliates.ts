import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  elevated,
  event,
  type Actor,
  type Database,
  type Tx,
} from "@trainer/db";
import { requireRecentMfa } from "./security.ts";
import { journal } from "./finance.ts";
import { workspaceLock } from "./privacy-lifecycle.ts";

const fail = (code: string, message: string, statusCode = 409) =>
  Object.assign(new Error(message), { code, message, statusCode });
const hash = (input: unknown) =>
  createHash("sha256").update(JSON.stringify(input)).digest("hex");
const ref = z.string().trim().min(5).max(200);
const evidence = z.string().trim().min(10).max(500);
const period = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/);
const contractSchema = z
  .object({
    provider: z.string().trim().min(2).max(100),
    revision: z.number().int().nonnegative(),
    enabled: z.boolean(),
    termsReference: evidence,
    disclosure: z.string().trim().min(10).max(1000),
    trainerShareBps: z.number().int().min(0).max(10000),
    providerPermissionConfirmed: z.literal(true),
    reason: evidence,
  })
  .strict();
const receiptSchema = z
  .object({
    requestId: z.string().uuid(),
    contractId: z.string().uuid(),
    revision: z.number().int().positive(),
    providerReference: ref,
    period,
    amountMinor: z.number().int().positive().max(1000000000),
    evidenceReference: evidence,
  })
  .strict();

async function state(tx: Tx) {
  return {
    currency: "AED",
    basis: "Aggregate provider statements; no consumer-level tracking",
    contracts: await tx.query(
      "SELECT * FROM affiliate_contracts ORDER BY provider",
    ),
    receipts: await tx.query(
      "SELECT r.*,sr.statement_id FROM affiliate_receipts r LEFT JOIN affiliate_statement_receipts sr ON sr.tenant_id=r.tenant_id AND sr.receipt_id=r.id ORDER BY r.created_at DESC LIMIT 250",
    ),
    statements: await tx.query(
      "SELECT s.*,x.bank_reference,x.evidence_reference,x.journal_id,x.created_at AS settled_at FROM affiliate_statements s LEFT JOIN affiliate_settlements x ON x.tenant_id=s.tenant_id AND x.statement_id=s.id ORDER BY s.created_at DESC LIMIT 120",
    ),
  };
}
export async function pendingAffiliateClawbacks(tx: Tx) {
  const [r] = await tx.query(
    "SELECT count(*)::int AS n FROM affiliate_receipts r LEFT JOIN affiliate_statement_receipts sr ON sr.tenant_id=r.tenant_id AND sr.receipt_id=r.id LEFT JOIN affiliate_settlements s ON s.tenant_id=sr.tenant_id AND s.statement_id=sr.statement_id WHERE r.amount_minor<0 AND s.id IS NULL",
  );
  return r.n > 0;
}
export function registerAffiliates(
  app: FastifyInstance,
  db: Database,
  identity: (
    req: FastifyRequest,
  ) => Actor & { platformRole?: string; mfaAt?: string | null },
) {
  async function admin(req: FastifyRequest) {
    const a = identity(req);
    if (!["admin", "finance"].includes(a.platformRole ?? ""))
      throw fail("AFFILIATE_ACCESS", "Platform finance access required", 403);
    requireRecentMfa(a, true);
    // Repeat the authoritative role check, including long-lived/stale sessions.
    const [user] = await db.system((tx) =>
      tx.query("SELECT platform_role FROM users WHERE id=$1", [a.userId]),
    );
    if (!user || !["admin", "finance"].includes(user.platform_role))
      throw fail(
        "AFFILIATE_ACCESS",
        "Current platform finance access required",
        403,
      );
    return a;
  }
  async function scoped<T>(
    req: FastifyRequest,
    fn: (tx: Tx, a: Actor) => Promise<T>,
  ) {
    const user = await admin(req),
      tenantId = z
        .string()
        .uuid()
        .parse((req.params as any).tenantId);
    // Validate workspace and operator in the same locked system transaction
    // before entering the tenant scope.
    return db.system(async (tx) => {
      await workspaceLock(tx, tenantId);
      const [row] = await tx.query(
        "SELECT t.lifecycle_state,u.platform_role FROM tenants t CROSS JOIN users u WHERE t.id=$1 AND u.id=$2 FOR SHARE OF t,u",
        [tenantId, user.userId],
      );
      if (
        !row ||
        row.lifecycle_state !== "active" ||
        !["admin", "finance"].includes(row.platform_role)
      )
        throw fail(
          "AFFILIATE_ACCESS",
          "Active workspace and finance access required",
          403,
        );
      // A platform finance operator acts in the workspace as an allowlisted
      // elevation; the db package verifies and fixes the scope.
      const a = elevated("platform-operator", {
        tenantId,
        userId: user.userId,
        role: "finance",
      });
      return tx.tenant(a, (scoped) => fn(scoped, a));
    });
  }
  app.get("/api/v1/admin/affiliates", async (req) => {
    await admin(req);
    return {
      tenants: await db.system((tx) =>
        tx.query(
          "SELECT id,name FROM tenants WHERE lifecycle_state='active' ORDER BY name",
        ),
      ),
    };
  });
  app.get("/api/v1/affiliates", async (req, reply) => {
    const a = identity(req);
    if (a.role !== "owner")
      throw fail("AFFILIATE_ACCESS", "Workspace owner access required", 403);
    reply.header("Cache-Control", "private, no-store");
    return db.tenant(a, async (tx) => {
      await workspaceLock(tx, a.tenantId);
      const [current] = await tx.query(
        "SELECT training_actor_is_current($1,$2,$3) AS ok",
        [a.tenantId, a.userId, a.role],
      );
      if (!current?.ok)
        throw fail("AFFILIATE_ACCESS", "Current owner access required", 403);
      return state(tx);
    });
  });
  const prefix = "/api/v1/admin/tenants/:tenantId/affiliates";
  app.get(prefix, async (req, reply) => {
    reply.header("Cache-Control", "private, no-store");
    return scoped(req, state);
  });
  app.post(prefix + "/contracts", async (req) => {
    const input = contractSchema.parse(req.body);
    return scoped(req, async (tx, a) => {
      const [current] = await tx.query(
        "SELECT * FROM affiliate_contracts WHERE provider=$1 FOR UPDATE",
        [input.provider],
      );
      if ((current?.revision ?? 0) !== input.revision)
        throw fail("STALE_REVISION", "Reload the current affiliate contract");
      const values = [
        input.enabled,
        input.termsReference,
        input.disclosure,
        input.trainerShareBps,
      ];
      const [row] = current
        ? await tx.query(
            "UPDATE affiliate_contracts SET enabled=$1,terms_reference=$2,disclosure=$3,trainer_share_bps=$4,revision=revision+1,updated_at=now() WHERE id=$5 RETURNING *",
            [...values, current.id],
          )
        : await tx.query(
            "INSERT INTO affiliate_contracts(id,tenant_id,provider,enabled,terms_reference,disclosure,trainer_share_bps) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
            [randomUUID(), a.tenantId, input.provider, ...values],
          );
      await event(tx, a, "finance.affiliate_contract", row.id, {
        revision: row.revision,
        reason: input.reason,
        termsReference: input.termsReference,
        trainerShareBps: input.trainerShareBps,
        enabled: input.enabled,
        providerPermissionConfirmed: true,
      });
      return row;
    });
  });
  app.post(prefix + "/receipts", async (req) => {
    const input = receiptSchema.parse(req.body);
    return scoped(req, async (tx, a) => {
      const fingerprint = hash(input),
        [prior] = await tx.query(
          "SELECT * FROM affiliate_receipts WHERE request_id=$1",
          [input.requestId],
        );
      if (prior) {
        if (prior.fingerprint !== fingerprint)
          throw fail(
            "INTENT_CONFLICT",
            "This receipt identity has different evidence",
          );
        return prior;
      }
      const [contract] = await tx.query(
        "SELECT * FROM affiliate_contracts WHERE id=$1",
        [input.contractId],
      );
      if (!contract?.enabled || contract.revision !== input.revision)
        throw fail(
          "CONTRACT_REQUIRED",
          "An enabled, current and approved contract is required",
        );
      if (input.period > new Date().toISOString().slice(0, 7))
        throw fail("FUTURE_RECEIPT", "Future earnings cannot be recorded");
      const [duplicate] = await tx.query(
        "SELECT id FROM affiliate_receipts WHERE contract_id=$1 AND provider_reference=$2",
        [contract.id, input.providerReference],
      );
      if (duplicate)
        throw fail(
          "DUPLICATE_RECEIPT",
          "This provider receipt is already recorded",
        );
      const [closed] = await tx.query(
        "SELECT id FROM affiliate_statements WHERE contract_id=$1 AND period=$2",
        [contract.id, input.period],
      );
      if (closed)
        throw fail(
          "PERIOD_CLOSED",
          "Use the next open reporting period for a late receipt or correction",
        );
      const share = Math.round(
        (input.amountMinor * contract.trainer_share_bps) / 10000,
      );
      const [row] = await tx.query(
        "INSERT INTO affiliate_receipts(id,tenant_id,contract_id,request_id,fingerprint,provider_reference,period,amount_minor,trainer_minor,contract_snapshot,evidence_reference) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *",
        [
          randomUUID(),
          a.tenantId,
          contract.id,
          input.requestId,
          fingerprint,
          input.providerReference,
          input.period,
          input.amountMinor,
          share,
          JSON.stringify(contract),
          input.evidenceReference,
        ],
      );
      await event(tx, a, "finance.affiliate_receipt", row.id, {
        amountMinor: input.amountMinor,
        trainerMinor: share,
        contractRevision: contract.revision,
      });
      return row;
    });
  });
  app.post(prefix + "/receipts/:id/reverse", async (req) => {
    const input = z
        .object({
          requestId: z.string().uuid(),
          period,
          providerReference: ref,
          evidenceReference: evidence,
        })
        .strict()
        .parse(req.body),
      id = z
        .string()
        .uuid()
        .parse((req.params as any).id);
    return scoped(req, async (tx, a) => {
      const fingerprint = hash({ id, ...input });
      const [prior] = await tx.query(
        "SELECT * FROM affiliate_receipts WHERE request_id=$1 OR reversal_of=$2",
        [input.requestId, id],
      );
      if (prior) {
        if (prior.fingerprint !== fingerprint)
          throw fail("INTENT_CONFLICT", "A different reversal already exists");
        return prior;
      }
      const [original] = await tx.query(
        "SELECT * FROM affiliate_receipts WHERE id=$1 AND reversal_of IS NULL",
        [id],
      );
      if (!original)
        throw fail("RECEIPT_REQUIRED", "Original receipt unavailable", 404);
      if (
        input.period < original.period ||
        input.period > new Date().toISOString().slice(0, 7)
      )
        throw fail(
          "INVALID_PERIOD",
          "Use an open reporting period on or after the original receipt",
        );
      if (
        (
          await tx.query(
            "SELECT id FROM affiliate_statements WHERE contract_id=$1 AND period=$2",
            [original.contract_id, input.period],
          )
        ).length
      )
        throw fail("PERIOD_CLOSED", "Use the next open reporting period");
      if (
        (
          await tx.query(
            "SELECT id FROM affiliate_receipts WHERE contract_id=$1 AND provider_reference=$2",
            [original.contract_id, input.providerReference],
          )
        ).length
      )
        throw fail(
          "DUPLICATE_RECEIPT",
          "Provider reference is already recorded",
        );
      const [row] = await tx.query(
        "INSERT INTO affiliate_receipts(id,tenant_id,contract_id,request_id,fingerprint,provider_reference,period,amount_minor,trainer_minor,contract_snapshot,evidence_reference,reversal_of) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *",
        [
          randomUUID(),
          a.tenantId,
          original.contract_id,
          input.requestId,
          fingerprint,
          input.providerReference,
          input.period,
          -Number(original.amount_minor),
          -Number(original.trainer_minor),
          JSON.stringify(original.contract_snapshot),
          input.evidenceReference,
          id,
        ],
      );
      await event(tx, a, "finance.affiliate_reversed", row.id, {
        original: id,
      });
      return row;
    });
  });
  app.post(prefix + "/statements", async (req) => {
    const input = z
      .object({ contractId: z.string().uuid(), period })
      .strict()
      .parse(req.body);
    return scoped(req, async (tx, a) => {
      const [prior] = await tx.query(
        "SELECT * FROM affiliate_statements WHERE contract_id=$1 AND period=$2",
        [input.contractId, input.period],
      );
      if (prior) return prior;
      const rows = await tx.query(
        "SELECT * FROM affiliate_receipts WHERE contract_id=$1 AND period=$2 ORDER BY id",
        [input.contractId, input.period],
      );
      if (!rows.length)
        throw fail(
          "NO_RECEIPTS",
          "Record verified provider receipts before closing a statement",
        );
      const amount = rows.reduce((n, r) => n + Number(r.amount_minor), 0),
        share = rows.reduce((n, r) => n + Number(r.trainer_minor), 0);
      if (!Number.isSafeInteger(amount) || !Number.isSafeInteger(share))
        throw fail("AMOUNT_LIMIT", "Statement exceeds supported amount");
      const [row] = await tx.query(
        "INSERT INTO affiliate_statements(id,tenant_id,contract_id,period,amount_minor,trainer_minor) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
        [
          randomUUID(),
          a.tenantId,
          input.contractId,
          input.period,
          amount,
          share,
        ],
      );
      for (const r of rows)
        await tx.query(
          "INSERT INTO affiliate_statement_receipts(tenant_id,statement_id,receipt_id) VALUES($1,$2,$3)",
          [a.tenantId, row.id, r.id],
        );
      await event(tx, a, "finance.affiliate_statement", row.id, {
        period: input.period,
        amountMinor: amount,
        trainerMinor: share,
      });
      return row;
    });
  });
  app.post(prefix + "/statements/:id/settle", async (req) => {
    const input = z
        .object({
          amountMinor: z.number().int().safe(),
          bankReference: ref,
          evidenceReference: evidence,
        })
        .strict()
        .parse(req.body),
      id = z
        .string()
        .uuid()
        .parse((req.params as any).id);
    return scoped(req, async (tx, a) => {
      const [s] = await tx.query(
        "SELECT * FROM affiliate_statements WHERE id=$1",
        [id],
      );
      if (!s) throw fail("STATEMENT_REQUIRED", "Statement unavailable", 404);
      if (Number(s.amount_minor) !== input.amountMinor)
        throw fail(
          "AMOUNT_MISMATCH",
          "Bank evidence must match the full signed statement amount",
        );
      const [prior] = await tx.query(
        "SELECT * FROM affiliate_settlements WHERE statement_id=$1 OR bank_reference=$2",
        [id, input.bankReference],
      );
      if (prior) {
        if (
          prior.statement_id !== id ||
          prior.bank_reference !== input.bankReference ||
          prior.evidence_reference !== input.evidenceReference
        )
          throw fail(
            "SETTLEMENT_CONFLICT",
            "This bank evidence or statement is already settled",
          );
        return prior;
      }
      const lines = [
        { account: "bank_cash", amount: input.amountMinor },
        { account: "trainer_payable", amount: -Number(s.trainer_minor) },
        {
          account: "platform_commission",
          amount: -(input.amountMinor - Number(s.trainer_minor)),
        },
      ];
      const entry = lines.some((l) => l.amount !== 0)
        ? await journal(
            tx,
            a,
            "affiliate:" + id,
            "Verified affiliate settlement",
            lines,
            {
              statementId: id,
              bankReference: input.bankReference,
              evidenceReference: input.evidenceReference,
            },
          )
        : null;
      const [row] = await tx.query(
        "INSERT INTO affiliate_settlements(id,tenant_id,statement_id,bank_reference,evidence_reference,journal_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
        [
          randomUUID(),
          a.tenantId,
          id,
          input.bankReference,
          input.evidenceReference,
          entry?.id ?? null,
        ],
      );
      await event(tx, a, "finance.affiliate_settled", row.id, {
        statementId: id,
        amountMinor: input.amountMinor,
      });
      return row;
    });
  });
}
