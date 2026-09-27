import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Actor, Database, Tx } from "@trainer/db";
import { requireRecentMfa } from "./security.ts";
type Identity = Actor & { platformRole?: string; mfaAt?: string | null };
const fail = (code: string, message: string, statusCode = 409) =>
  Object.assign(new Error(message), { code, statusCode });
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const reason = z.string().trim().min(10).max(500);
const desired = z
  .object({
    paused: z.boolean(),
    intervalMs: z.number().int().min(1000).max(60000),
  })
  .strict();
const proposal = z
  .object({
    requestId: z.string().uuid(),
    resourceId: z.literal("worker:primary"),
    action: z.literal("set_worker_dispatch"),
    policyRevision: z.number().int().positive(),
    expectedRevision: z.number().int().positive(),
    estimatedMonthlyCostMinor: z.literal(0),
    desired,
    reason,
  })
  .strict();
const lock = (tx: Tx) =>
  tx.query(
    "SELECT pg_advisory_xact_lock(hashtext('infrastructure-execution'))",
  );
export async function workerDispatchControl(db: Database) {
  return db.system(async (tx) => {
    const [row] = await tx.query(
      "SELECT revision,paused,interval_ms FROM infrastructure_worker_control WHERE resource_id='worker:primary'",
    );
    if (!row) throw new Error("Worker dispatch control unavailable");
    return {
      revision: Number(row.revision),
      paused: !!row.paused,
      intervalMs: Number(row.interval_ms),
    };
  });
}
async function audit(
  tx: Tx,
  a: Identity,
  action: string,
  id: string,
  data: unknown,
) {
  await tx.query(
    "INSERT INTO admin_operations_audit(id,actor_id,action,subject_id,data) VALUES($1,$2,$3,$4,$5)",
    [randomUUID(), a.userId, action, id, JSON.stringify(data)],
  );
}
export function registerInfrastructureActions(
  app: FastifyInstance,
  db: Database,
  identity: (req: FastifyRequest) => Identity,
) {
  async function run<T>(
    req: FastifyRequest,
    fn: (tx: Tx, a: Identity) => Promise<T>,
  ) {
    const a = identity(req);
    if (a.platformRole !== "admin")
      throw fail(
        "OPERATOR_SCOPE",
        "Platform administrator access required",
        403,
      );
    requireRecentMfa(a, true);
    return db.system(async (tx) => {
      await lock(tx);
      const [u] = await tx.query(
        "SELECT platform_role FROM users WHERE id=$1 FOR SHARE",
        [a.userId],
      );
      if (u?.platform_role !== "admin")
        throw fail(
          "OPERATOR_SCOPE",
          "Current administrator access required",
          403,
        );
      return fn(tx, a);
    });
  }
  const prefix = "/api/v1/admin/infrastructure/actions";
  app.get(prefix, async (req, reply) => {
    reply.header("Cache-Control", "private, no-store");
    return run(req, async (tx) => ({
      policy: (
        await tx.query(
          "SELECT * FROM infrastructure_execution_policies ORDER BY revision DESC LIMIT 1",
        )
      )[0],
      resource: (
        await tx.query(
          "SELECT * FROM infrastructure_worker_control WHERE resource_id='worker:primary'",
        )
      )[0],
      actions: await tx.query(
        "SELECT * FROM infrastructure_actions ORDER BY created_at DESC LIMIT 100",
      ),
      supportedActions: ["set_worker_dispatch"],
      estimatedMonthlyCloudCostMinor: 0,
      boundary:
        "Controls new worker cycles. In-flight jobs finish normally. Cloud provisioning, payments, DNS, databases and security changes are not allowed.",
    }));
  });
  app.post(prefix + "/policy", async (req) => {
    const b = z
      .object({
        revision: z.number().int().positive(),
        enabled: z.boolean(),
        actionsPerHour: z.number().int().min(1).max(20),
        monthlyCostCapMinor: z.number().int().min(0).max(1000000000),
        reason,
      })
      .strict()
      .parse(req.body);
    return run(req, async (tx, a) => {
      const [p] = await tx.query(
        "SELECT * FROM infrastructure_execution_policies ORDER BY revision DESC LIMIT 1",
      );
      if (p.revision !== b.revision)
        throw fail("STALE_POLICY", "Reload the current execution policy");
      const [row] = await tx.query(
        "INSERT INTO infrastructure_execution_policies(revision,enabled,actions_per_hour,monthly_cost_cap_minor,reason,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
        [
          p.revision + 1,
          b.enabled,
          b.actionsPerHour,
          b.monthlyCostCapMinor,
          b.reason,
          a.userId,
        ],
      );
      await audit(
        tx,
        a,
        "infrastructure.execution_policy",
        String(row.revision),
        b,
      );
      return row;
    });
  });
  app.post(prefix, async (req) => {
    const b = proposal.parse(req.body);
    return run(req, async (tx, a) => {
      const fingerprint = hash(b),
        [prior] = await tx.query(
          "SELECT * FROM infrastructure_actions WHERE request_id=$1",
          [b.requestId],
        );
      if (prior) {
        if (prior.fingerprint !== fingerprint || prior.proposed_by !== a.userId)
          throw fail(
            "INTENT_CONFLICT",
            "This operation identity has different intent",
          );
        return prior;
      }
      const [p] = await tx.query(
        "SELECT * FROM infrastructure_execution_policies ORDER BY revision DESC LIMIT 1",
      );
      const [r] = await tx.query(
        "SELECT * FROM infrastructure_worker_control WHERE resource_id=$1",
        [b.resourceId],
      );
      if (p.revision !== b.policyRevision || r.revision !== b.expectedRevision)
        throw fail("STALE_RESOURCE", "Reload current policy and worker state");
      if (!p.enabled)
        throw fail(
          "EXECUTION_DISABLED",
          "Enable a reviewed policy before proposing an operation",
        );
      if (b.estimatedMonthlyCostMinor > Number(p.monthly_cost_cap_minor))
        throw fail("COST_CAP", "This operation exceeds the approved cost cap");
      const [row] = await tx.query(
        "INSERT INTO infrastructure_actions(id,request_id,fingerprint,resource_id,action,policy_revision,expected_revision,estimated_monthly_cost_minor,before_state,desired_state,reason,proposed_by,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now()+interval '15 minutes') RETURNING *",
        [
          randomUUID(),
          b.requestId,
          fingerprint,
          b.resourceId,
          b.action,
          b.policyRevision,
          b.expectedRevision,
          b.estimatedMonthlyCostMinor,
          JSON.stringify({ paused: r.paused, intervalMs: r.interval_ms }),
          JSON.stringify(b.desired),
          b.reason,
          a.userId,
        ],
      );
      await audit(tx, a, "infrastructure.proposed", row.id, {
        resourceId: b.resourceId,
        policyRevision: b.policyRevision,
        reason: b.reason,
      });
      return row;
    });
  });
  for (const action of ["approve", "execute", "cancel", "rollback"] as const)
    app.post(prefix + "/:id/" + action, async (req) => {
      const id = z
        .string()
        .uuid()
        .parse((req.params as any).id);
      const b = z.object({ reason }).strict().parse(req.body);
      return run(req, async (tx, a) => {
        const [op] = await tx.query(
          "SELECT * FROM infrastructure_actions WHERE id=$1 FOR UPDATE",
          [id],
        );
        if (!op) throw fail("OPERATION_REQUIRED", "Operation unavailable", 404);
        if (
          (action === "execute" && op.status === "succeeded") ||
          (action === "rollback" && op.status === "rolled_back") ||
          (action === "cancel" && op.status === "canceled")
        )
          return op;
        if (action === "cancel") {
          if (!["proposed", "approved"].includes(op.status))
            throw fail(
              "OPERATION_STATE",
              "Only unexecuted operations can be canceled",
            );
          const [row] = await tx.query(
            "UPDATE infrastructure_actions SET status='canceled' WHERE id=$1 RETURNING *",
            [id],
          );
          await audit(tx, a, "infrastructure.canceled", id, b);
          return row;
        }
        if (action === "rollback") {
          if (op.status !== "succeeded")
            throw fail(
              "OPERATION_STATE",
              "Only a successful operation can be rolled back",
            );
          const [current] = await tx.query(
            "SELECT * FROM infrastructure_worker_control WHERE resource_id=$1 FOR UPDATE",
            [op.resource_id],
          );
          if (current.revision !== op.result_revision)
            throw fail(
              "ROLLBACK_STALE",
              "A later operation changed this resource; propose a new reviewed change",
            );
          await tx.query(
            "UPDATE infrastructure_worker_control SET paused=$1,interval_ms=$2,revision=revision+1,updated_at=now() WHERE resource_id=$3",
            [
              op.before_state.paused,
              op.before_state.intervalMs,
              op.resource_id,
            ],
          );
          const [row] = await tx.query(
            "UPDATE infrastructure_actions SET status='rolled_back',rolled_back_at=now() WHERE id=$1 RETURNING *",
            [id],
          );
          await audit(tx, a, "infrastructure.rolled_back", id, b);
          return row;
        }
        const [p] = await tx.query(
          "SELECT * FROM infrastructure_execution_policies ORDER BY revision DESC LIMIT 1",
        );
        if (!p.enabled || p.revision !== op.policy_revision)
          throw fail(
            "POLICY_CHANGED",
            "Execution policy changed; cancel and propose again",
          );
        if (new Date(op.expires_at).getTime() <= Date.now())
          throw fail(
            "OPERATION_EXPIRED",
            "This operation expired; propose again",
          );
        const [current] = await tx.query(
          "SELECT * FROM infrastructure_worker_control WHERE resource_id=$1 FOR UPDATE",
          [op.resource_id],
        );
        if (current.revision !== op.expected_revision)
          throw fail("STALE_RESOURCE", "Worker state changed; propose again");
        if (action === "approve") {
          if (op.status === "approved") return op;
          if (op.status !== "proposed")
            throw fail(
              "OPERATION_STATE",
              "Only a proposed operation can be approved",
            );
          const [row] = await tx.query(
            "UPDATE infrastructure_actions SET status='approved',approved_by=$2,approved_at=now() WHERE id=$1 RETURNING *",
            [id, a.userId],
          );
          await audit(tx, a, "infrastructure.approved", id, b);
          return row;
        }
        if (op.status !== "approved")
          throw fail(
            "APPROVAL_REQUIRED",
            "Review and approve this exact operation before execution",
          );
        const [approver] = await tx.query(
          "SELECT platform_role FROM users WHERE id=$1 FOR SHARE",
          [op.approved_by],
        );
        if (approver?.platform_role !== "admin")
          throw fail(
            "APPROVAL_REVOKED",
            "The approving operator no longer has authority",
          );
        const [rate] = await tx.query(
          "SELECT count(*)::int AS n FROM infrastructure_actions WHERE executed_at>now()-interval '1 hour'",
        );
        if (rate.n >= p.actions_per_hour)
          throw fail("RATE_LIMIT", "The hourly execution limit is reached");
        if (
          Number(op.estimated_monthly_cost_minor) >
          Number(p.monthly_cost_cap_minor)
        )
          throw fail("COST_CAP", "Approved cost cap is exceeded");
        const change = desired.parse(op.desired_state);
        const [updated] = await tx.query(
          "UPDATE infrastructure_worker_control SET paused=$1,interval_ms=$2,revision=revision+1,updated_at=now() WHERE resource_id=$3 RETURNING revision",
          [change.paused, change.intervalMs, op.resource_id],
        );
        const [row] = await tx.query(
          "UPDATE infrastructure_actions SET status='succeeded',executed_at=now(),result_revision=$2 WHERE id=$1 RETURNING *",
          [id, updated.revision],
        );
        await audit(tx, a, "infrastructure.executed", id, {
          ...b,
          resultRevision: updated.revision,
        });
        return row;
      });
    });
}
