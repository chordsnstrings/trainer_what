import type { FastifyInstance, FastifyRequest } from "fastify";
import { type Database, event } from "@trainer/db";
import { z } from "zod";
import { requireRecentMfa } from "./security.ts";
import { publishFinancePolicy } from "./finance-policy.ts";
import { allocateCost, financialStatement } from "./finance-statements.ts";
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
function operator(req: FastifyRequest, write = true) {
  const a = identity(req);
  if (!["admin", "finance"].includes(a.platformRole))
    throw fail(403, "FINANCE_REQUIRED", "Platform finance access required");
  if (write) requireRecentMfa(a);
  return {
    ...a,
    tenantId: z
      .string()
      .uuid()
      .parse((req.params as any).tenantId),
    role: "finance",
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
  app.get("/api/v1/finance/statements/:period", (req) => {
    const a = identity(req);
    if (!["owner", "finance"].includes(a.role))
      throw fail(403, "FINANCE_REQUIRED", "Finance access required");
    return db.tenant(a, (tx) =>
      financialStatement(tx, (req.params as any).period),
    );
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
  app.get(prefix + "/statements/:period", (req) =>
    db.tenant(operator(req, false), (tx) =>
      financialStatement(tx, (req.params as any).period),
    ),
  );
  app.post(prefix + "/policies", (req) => {
    const a = operator(req);
    return db.tenant(a, (tx) => publishFinancePolicy(tx, a, req.body));
  });
  app.post(prefix + "/cost-allocations", (req) => {
    const a = operator(req);
    return db.tenant(a, (tx) => allocateCost(tx, a, req.body));
  });
}
