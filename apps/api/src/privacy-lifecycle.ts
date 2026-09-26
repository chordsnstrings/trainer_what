import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { event, type Actor, type Database, type Tx } from "@trainer/db";
import { passwordMatches } from "./auth.ts";
import { requireRecentMfa } from "./security.ts";
import { exportMealCaptures } from "./meal-capture.ts";

const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
type PrivacyIdentity = Actor & {
  platformRole: string;
  mfaAt?: string | null;
  name?: string;
  email?: string;
};
export type PrivacyHooks = {
  providerInventory?: (tx: Tx, userId?: string) => Promise<string[]>;
  exportAdditional?: (
    tx: Tx,
    userId: string,
  ) => Promise<Record<string, unknown>>;
  eraseAdditional?: (tx: Tx, userId: string) => Promise<void>;
  closeAdditional?: (tx: Tx) => Promise<void>;
};
// These kinds document money movement or retention. Keep their structured
// references while removing optional personal prose from mutable refunds.
const retainedKinds = [
  "refund",
  "invoice",
  "statement",
  "close",
  "reconciliation",
  "beneficiary",
  "financial_intent",
  "finance_intent",
  "billing_intent",
  "subscription_intent",
  "subscription_transition",
  "billing_invoice",
  "payout_intent",
  "booking_payment",
  "booking_refund",
  "promotion",
  "finance_policy",
  "fee_policy",
  "cost_allocation",
  "finance_automation",
  "finance_run",
  "privacy_request",
];
const privateKinds = [
  "intake",
  "program",
  "workout",
  "message",
  "exception",
  "decision",
  "takeover",
  "preferences",
  "settings",
  "wearable",
  "twin_snapshot",
  "support",
  "checkout",
  "training_plan",
  "training_schedule",
  "training_session",
  "planned_session",
  "safety_hold",
  "workout_correction",
  "progress_measurement",
  "nutrition_profile",
  "nutrition_plan",
  "nutrition_log",
  "nutrition_checkin",
  "nutrition_twin",
  "nutrition_pantry",
  "nutrition_request",
  "nutrition_exception",
  "nutrition_target",
  "nutrition_favorite",
  "nutrition_leftover",
  "nutrition_plan_edit",
  "nutrition_recovery",
  "guided_session",
];

export async function workspaceLock(tx: Tx, tenantId: string) {
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    tenantId + ":workspace",
  ]);
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [tenantId]);
}
async function setTenant(tx: Tx, a: Actor) {
  await tx.query("SET LOCAL ROLE trainer_app");
  await tx.query(
    "SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true),set_config('app.role','owner',true)",
    [a.tenantId, a.userId],
  );
}
async function assertOwner(tx: Tx, a: Actor, password?: string) {
  const [row] = await tx.query(
    "SELECT t.lifecycle_state,m.role,u.password_hash FROM tenants t JOIN memberships m ON m.tenant_id=t.id JOIN users u ON u.id=m.user_id WHERE t.id=$1 AND m.user_id=$2 FOR UPDATE OF t,m",
    [a.tenantId, a.userId],
  );
  if (!row || row.role !== "owner")
    throw fail(
      403,
      "OWNER_REQUIRED",
      "The current workspace owner must do this",
    );
  if (row.lifecycle_state !== "active")
    throw fail(409, "WORKSPACE_CLOSED", "This workspace is closed");
  if (
    password !== undefined &&
    !(await passwordMatches(password, row.password_hash))
  )
    throw fail(401, "INVALID_PASSWORD", "Password is incorrect");
}
async function lockPersonal(tx: Tx, a: Actor, userId: string) {
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    a.tenantId + ":training:" + userId,
  ]);
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    a.tenantId + ":nutrition:" + userId,
  ]);
}

export async function settlementBlockers(tx: Tx, userId?: string) {
  const blockers: { kind: string; count: number }[] = [];
  const add = async (kind: string, sql: string, values: any[] = []) => {
    const [r] = await tx.query(sql, values);
    if (Number(r.n) > 0) blockers.push({ kind, count: Number(r.n) });
  };
  await add(
    "subscription",
    "SELECT count(*)::int n FROM subscriptions WHERE ($1::uuid IS NULL OR user_id=$1) AND status NOT IN ('canceled','incomplete_expired','unpaid')",
    [userId ?? null],
  );
  await add(
    "refund",
    "SELECT count(*)::int n FROM records WHERE kind IN ('refund','booking_refund') AND ($1::uuid IS NULL OR owner_user_id=$1 OR data->>'userId'=$1::text) AND status NOT IN ('declined','rejected','succeeded','canceled','failed','resolved')",
    [userId ?? null],
  );
  await add(
    "invoice",
    "SELECT count(*)::int n FROM records WHERE kind IN ('invoice','billing_invoice') AND ($1::uuid IS NULL OR owner_user_id=$1 OR data->>'userId'=$1::text) AND status NOT IN ('paid','void','canceled','refunded') AND (kind='invoice' OR coalesce((data->>'amountDue')::numeric,0)>coalesce((data->>'amountPaid')::numeric,0)) AND coalesce(data->>'writtenOff','false')<>'true'",
    [userId ?? null],
  );
  await add(
    "financial_intent",
    "SELECT count(*)::int n FROM records WHERE kind IN ('financial_intent','finance_intent','billing_intent','subscription_intent','subscription_transition','booking_payment','payout_intent') AND ($1::uuid IS NULL OR owner_user_id=$1 OR data->>'userId'=$1::text) AND status NOT IN ('completed','succeeded','failed','canceled','expired','paid','refunded','confirmed','resolved')",
    [userId ?? null],
  );
  await add(
    "checkout",
    "SELECT count(*)::int n FROM records r WHERE r.kind='checkout' AND ($1::uuid IS NULL OR r.owner_user_id=$1) AND r.status NOT IN ('expired','closed') AND NOT (r.status='completed' AND EXISTS (SELECT 1 FROM subscriptions s WHERE s.tenant_id=r.tenant_id AND s.user_id=r.owner_user_id AND s.provider_id=r.data->>'subscriptionId' AND s.status IN ('canceled','incomplete_expired')))",
    [userId ?? null],
  );
  await add(
    "usage",
    "SELECT count(*)::int n FROM cost_events WHERE ($1::uuid IS NULL OR user_id=$1) AND (cost_usd IS NULL OR status IN ('reserved','unknown'))",
    [userId ?? null],
  );
  await add(
    "booking",
    "SELECT count(*)::int n FROM bookings b JOIN booking_slots s ON s.tenant_id=b.tenant_id AND s.id=b.slot_id WHERE ($1::uuid IS NULL OR b.user_id=$1) AND b.status IN ('confirmed','payment_pending') AND s.ends_at>now()",
    [userId ?? null],
  );
  if (!userId) {
    await add(
      "promotion",
      "SELECT count(*)::int n FROM records WHERE kind='promotion' AND status IN ('creating','unknown')",
    );
    await add(
      "payout",
      "SELECT count(*)::int n FROM payouts WHERE status NOT IN ('paid','failed','returned','canceled')",
    );
    await add(
      "reconciliation",
      "SELECT count(*)::int n FROM records WHERE kind='reconciliation' AND status<>'resolved'",
    );
    await add(
      "unsettled_balance",
      "SELECT count(*)::int n FROM (SELECT account FROM journal_lines WHERE account IN ('trainer_payable','payout_reserved','refund_reserve') GROUP BY account HAVING sum(amount_minor)<>0) pending",
    );
  }
  return blockers;
}
export async function assertSettled(tx: Tx, userId?: string) {
  const blockers = await settlementBlockers(tx, userId);
  if (blockers.length)
    throw fail(
      409,
      blockers[0].kind === "subscription"
        ? "SUBSCRIPTION_OPEN"
        : "SETTLEMENT_REQUIRED",
      "Resolve open " +
        blockers
          .map((x) => `${x.kind.replaceAll("_", " ")} (${x.count})`)
          .join(", ") +
        " before erasure or closure",
    );
}

// An owner transaction is intentional: a subscriber's RLS view omits internal
// decisions derived from their data. Selection always stays on this user and
// workspace, and never exports authentication tokens or other clients' data.
export async function exportPersonalData(
  db: Database,
  a: Actor,
  hooks: PrivacyHooks = {},
) {
  const identity = await db.system(async (tx) => {
    const [u] = await tx.query(
      "SELECT id,name,email,email_verified,created_at FROM users WHERE id=$1",
      [a.userId],
    );
    const [m] = await tx.query(
      "SELECT role FROM memberships WHERE tenant_id=$1 AND user_id=$2",
      [a.tenantId, a.userId],
    );
    if (!m)
      throw fail(
        403,
        "MEMBERSHIP_REQUIRED",
        "Workspace membership is required",
      );
    return { profile: u, membership: m };
  });
  return db.tenant({ ...a, role: "owner" }, async (tx) => ({
    formatVersion: "personal-export-v2",
    generatedAt: new Date().toISOString(),
    tenantId: a.tenantId,
    ...identity,
    records: await tx.query(
      "SELECT id,kind,status,version,data,created_at,updated_at FROM records WHERE owner_user_id=$1 OR (kind=ANY($2::text[]) AND (data->>'userId'=$1::text OR data->>'subscriberId'=$1::text OR data->>'clientId'=$1::text)) ORDER BY created_at,id",
      [a.userId, privateKinds],
    ),
    workouts: await tx.query(
      "SELECT id,workout_id,event_key,data,created_at FROM workout_events WHERE user_id=$1 ORDER BY created_at",
      [a.userId],
    ),
    mealCaptures: await exportMealCaptures(tx, a.userId),
    consents: await tx.query(
      "SELECT document_type,document_version,granted,created_at FROM consent_records WHERE user_id=$1 ORDER BY created_at",
      [a.userId],
    ),
    subscriptions: await tx.query(
      "SELECT id,status,period_end,cancel_at_period_end,price_minor,data FROM subscriptions WHERE user_id=$1",
      [a.userId],
    ),
    bookings: await tx.query(
      "SELECT b.id,b.status,b.created_at,s.title,s.starts_at,s.ends_at,s.location FROM bookings b JOIN booking_slots s ON s.tenant_id=b.tenant_id AND s.id=b.slot_id WHERE b.user_id=$1 ORDER BY s.starts_at",
      [a.userId],
    ),
    usage: await tx.query(
      "SELECT id,task,provider,model,input_tokens,output_tokens,cost_usd,price_version,created_at FROM cost_events WHERE user_id=$1 ORDER BY created_at",
      [a.userId],
    ),
    audit: await tx.query(
      "SELECT id,name,subject_id,created_at FROM events WHERE actor_id=$1 ORDER BY created_at",
      [a.userId],
    ),
    privacyFollowups: await tx.query(
      "SELECT scope,subject,status,due_at,completed_at FROM privacy_followups WHERE user_id=$1",
      [a.userId],
    ),
    ...(hooks.exportAdditional
      ? await hooks.exportAdditional(tx, a.userId)
      : {}),
    retainedDataNotice:
      "Financial records, consent history and minimal audit references follow the applicable retention policy. Provider and backup handling is reported separately.",
  }));
}

async function optionalDelete(
  tx: Tx,
  table: string,
  where: string,
  values: any[],
) {
  const [found] = await tx.query("SELECT to_regclass($1) AS name", [
    "public." + table,
  ]);
  if (found.name) await tx.query(`DELETE FROM ${table} WHERE ${where}`, values);
}
export async function erasePersonalData(
  tx: Tx,
  a: Actor,
  userId: string,
  email: string,
  hooks: PrivacyHooks = {},
) {
  await lockPersonal(tx, a, userId);
  if (hooks.eraseAdditional) await hooks.eraseAdditional(tx, userId);
  await tx.query("SELECT set_config('app.privacy_erasure','true',true)");
  await tx.query("DELETE FROM meal_captures WHERE user_id=$1", [userId]);
  await tx.query("DELETE FROM workout_events WHERE user_id=$1", [userId]);
  await tx.query(
    "DELETE FROM records WHERE kind<>ALL($2::text[]) AND (owner_user_id=$1 OR (kind=ANY($3::text[]) AND (data->>'userId'=$1::text OR data->>'subscriberId'=$1::text OR data->>'clientId'=$1::text)))",
    [userId, retainedKinds, privateKinds],
  );
  await tx.query(
    "DELETE FROM jobs WHERE data->>'userId'=$1 OR (kind='email' AND lower(data->>'to')=lower($2))",
    [userId, email],
  );
  await tx.query("DELETE FROM bookings WHERE user_id=$1", [userId]);
  await tx.query(
    "UPDATE records SET data=(data-'reason'-'decisionReason'-'notes')||'{\"personalTextRemoved\":true}'::jsonb,updated_at=now() WHERE kind IN ('refund','invoice') AND owner_user_id=$1",
    [userId],
  );
}
export async function scrubUnusedAccount(tx: Tx, userId: string) {
  // Membership writes and both erase paths hold this user row; a remaining
  // membership retains the shared account and its authentication factors.
  const [remaining] = await tx.query(
    "SELECT count(*)::int n FROM memberships WHERE user_id=$1",
    [userId],
  );
  if (!remaining.n) {
    await tx.query(
      "UPDATE users SET name='Deleted member',email=$2,password_hash=$3,email_verified=false,platform_role='none' WHERE id=$1",
      [userId, userId + "@deleted.invalid", randomUUID()],
    );
    for (const table of ["sessions", "one_time_tokens", "user_security"])
      await tx.query(`DELETE FROM ${table} WHERE user_id=$1`, [userId]);
    for (const table of [
      "mfa_recovery_codes",
      "auth_passkeys",
      "auth_passkey_challenges",
    ])
      await optionalDelete(tx, table, "user_id=$1", [userId]);
  }
}
const evidenceSchema = z.object({
  providerReviewComplete: z.literal(true),
  thirdPartySourceReviewComplete: z.literal(true),
  evidenceReference: z.string().trim().min(10).max(500),
  retentionPolicyVersion: z.string().trim().min(3).max(100),
  backupPurgeBy: z.iso.datetime(),
  retentionReviewBy: z.iso.datetime().optional(),
  providers: z
    .array(
      z.object({
        name: z.string().trim().min(2).max(100),
        dueAt: z.iso.datetime(),
      }),
    )
    .max(30)
    .default([]),
});
export const erasureSchema = evidenceSchema
  .extend({ expectedRevision: z.number().int().positive() })
  .strict();
type Evidence = z.infer<typeof evidenceSchema>;
export async function createPrivacyFollowups(
  tx: Tx,
  a: Actor,
  requestId: string,
  userId: string | null,
  b: Evidence,
) {
  const tasks = [
    {
      scope: "backup",
      subject: "Backup purge and restore exclusion",
      dueAt: b.backupPurgeBy,
    },
    {
      scope: "retention",
      subject: "Lawfully retained financial, consent and audit references",
      dueAt: b.retentionReviewBy ?? b.backupPurgeBy,
    },
    ...b.providers.map((p) => ({
      scope: "provider",
      subject: p.name,
      dueAt: p.dueAt,
    })),
  ];
  for (const task of tasks) {
    if (new Date(task.dueAt).getTime() < Date.now())
      throw fail(
        400,
        "BACKUP_DEADLINE",
        "Record a current or future evidence review deadline",
      );
    await tx.query(
      "INSERT INTO privacy_followups(id,tenant_id,request_id,user_id,scope,subject,due_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING",
      [
        randomUUID(),
        a.tenantId,
        requestId,
        userId,
        task.scope,
        task.subject,
        task.dueAt,
      ],
    );
  }
}
async function purgeAcquisition(tx: Tx, a: Actor, userId?: string) {
  const [found] = await tx.query(
    "SELECT to_regclass('public.acquisition_events') name",
  );
  if (found.name) {
    await tx.query("SELECT set_config('app.privacy_erasure','true',true)");
    await tx.query(
      "DELETE FROM acquisition_events WHERE tenant_id=$1 AND ($2::uuid IS NULL OR user_id=$2)",
      [a.tenantId, userId ?? null],
    );
  }
}

export async function eraseMember(
  db: Database,
  a: Actor,
  requestId: string,
  b: z.infer<typeof erasureSchema>,
  hooks: PrivacyHooks = {},
) {
  return db.system(async (tx) => {
    await workspaceLock(tx, a.tenantId);
    await setTenant(tx, a);
    const [r] = await tx.query(
      "SELECT * FROM records WHERE id=$1 AND kind='privacy_request' FOR UPDATE",
      [requestId],
    );
    if (!r) throw fail(404, "NOT_FOUND", "Privacy request unavailable");
    if (r.status === "local_erasure_completed") return { status: r.status };
    if (r.version !== b.expectedRevision)
      throw fail(
        409,
        "STALE_REVISION",
        "The privacy request changed; reload it",
      );
    await tx.query("RESET ROLE");
    const [u] = await tx.query(
      "SELECT id,email FROM users WHERE id=$1 FOR UPDATE",
      [r.owner_user_id],
    );
    const [member] = await tx.query(
      "SELECT role FROM memberships WHERE tenant_id=$1 AND user_id=$2 FOR UPDATE",
      [a.tenantId, r.owner_user_id],
    );
    if (!member || member.role === "owner")
      throw fail(
        409,
        "WORKSPACE_CLOSURE_REQUIRED",
        "The current owner must complete ownership transfer or workspace closure before account erasure",
      );
    await setTenant(tx, a);
    await assertSettled(tx, r.owner_user_id);
    const knownProviders = hooks.providerInventory
      ? await hooks.providerInventory(tx, r.owner_user_id)
      : [];
    const evidence = {
      ...b,
      providers: [
        ...b.providers,
        ...knownProviders
          .filter(
            (name) =>
              !b.providers.some(
                (p) => p.name.toLowerCase() === name.toLowerCase(),
              ),
          )
          .map((name) => ({ name, dueAt: b.backupPurgeBy })),
      ],
    };
    await erasePersonalData(tx, a, r.owner_user_id, u.email, hooks);
    await createPrivacyFollowups(tx, a, r.id, r.owner_user_id, evidence);
    await tx.query(
      "UPDATE records SET status='local_erasure_completed',version=version+1,data=$2,updated_at=now() WHERE id=$1",
      [
        r.id,
        JSON.stringify({
          type: "deletion",
          requestedAt: r.data.requestedAt,
          completedAt: new Date().toISOString(),
          retentionPolicyVersion: b.retentionPolicyVersion,
          evidenceReference: b.evidenceReference,
          backupPurgeBy: b.backupPurgeBy,
          processedBy: a.userId,
          externalStatus: "followups_pending",
        }),
      ],
    );
    await event(tx, a, "privacy.local_erasure_completed", r.id, {
      retentionPolicyVersion: b.retentionPolicyVersion,
      evidenceReference: b.evidenceReference,
    });
    await tx.query("RESET ROLE");
    await purgeAcquisition(tx, a, r.owner_user_id);
    await tx.query(
      "INSERT INTO privacy_erasure_registry(id,tenant_id,user_id,request_id,scope,retention_policy_version,evidence_reference) VALUES($1,$2,$3,$4,'member',$5,$6)",
      [
        randomUUID(),
        a.tenantId,
        r.owner_user_id,
        r.id,
        b.retentionPolicyVersion,
        b.evidenceReference,
      ],
    );
    await tx.query(
      "DELETE FROM memberships WHERE tenant_id=$1 AND user_id=$2",
      [a.tenantId, r.owner_user_id],
    );
    await tx.query("DELETE FROM sessions WHERE tenant_id=$1 AND user_id=$2", [
      a.tenantId,
      r.owner_user_id,
    ]);
    await tx.query(
      "DELETE FROM one_time_tokens WHERE tenant_id=$1 AND user_id=$2",
      [a.tenantId, r.owner_user_id],
    );
    await scrubUnusedAccount(tx, r.owner_user_id);
    return {
      status: "local_erasure_completed",
      externalStatus: "followups_pending",
      backupPurgeBy: b.backupPurgeBy,
    };
  });
}

export function registerPrivacyLifecycle(
  app: FastifyInstance,
  db: Database,
  identity: (r: FastifyRequest) => PrivacyIdentity,
  hooks: PrivacyHooks = {},
) {
  const uuid = z.string().uuid();
  const operator = (req: FastifyRequest) => {
    const a = identity(req);
    if (a.platformRole !== "admin")
      throw fail(
        403,
        "PRIVACY_AUTHORITY",
        "A platform administrator must process privacy operations",
      );
    requireRecentMfa(a, true);
    return {
      ...a,
      tenantId: uuid.parse((req.params as any).tenantId),
      role: "owner",
    };
  };
  app.get("/api/v1/privacy/status", async (req) => {
    const a = identity(req);
    return db.tenant({ ...a, role: "owner" }, async (tx) => ({
      requests: await tx.query(
        "SELECT id,status,version,data,created_at FROM records WHERE kind='privacy_request' AND owner_user_id=$1 ORDER BY created_at DESC",
        [a.userId],
      ),
      followups: await tx.query(
        "SELECT id,scope,subject,status,due_at,completed_at FROM privacy_followups WHERE user_id=$1 ORDER BY created_at",
        [a.userId],
      ),
    }));
  });
  app.get("/api/v1/tenant/lifecycle", async (req) => {
    const a = identity(req);
    if (!["owner", "staff"].includes(a.role))
      throw fail(403, "OWNER_REQUIRED", "Workspace management access required");
    const rows = await db.system(async (tx) => ({
      requests: await tx.query(
        "SELECT id,kind,target_user_id,requested_by,status,revision,expires_at,created_at FROM workspace_lifecycle_requests WHERE tenant_id=$1 AND (requested_by=$2 OR target_user_id=$2) ORDER BY created_at DESC LIMIT 30",
        [a.tenantId, a.userId],
      ),
      members:
        a.role === "owner"
          ? await tx.query(
              "SELECT u.id,u.name,u.email,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=$1 AND m.role IN ('owner','staff') ORDER BY u.name",
              [a.tenantId],
            )
          : [],
    }));
    return {
      ...rows,
      blockers:
        a.role === "owner"
          ? await db.tenant(a, (tx) => settlementBlockers(tx))
          : [],
      currentUserId: a.userId,
    };
  });
  app.post("/api/v1/tenant/lifecycle/ownership-transfer", async (req) => {
    const a = identity(req);
    requireRecentMfa(a, true);
    const b = z
      .object({
        targetUserId: uuid,
        password: z.string().max(128),
        reason: z.string().trim().min(10).max(1000),
      })
      .strict()
      .parse(req.body);
    return db.system(async (tx) => {
      await workspaceLock(tx, a.tenantId);
      await assertOwner(tx, a, b.password);
      if (b.targetUserId === a.userId)
        throw fail(
          400,
          "TRANSFER_TARGET",
          "Choose another active staff member",
        );
      const [target] = await tx.query(
        "SELECT m.role,u.email_verified FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=$1 AND m.user_id=$2 FOR UPDATE OF m",
        [a.tenantId, b.targetUserId],
      );
      if (target?.role !== "staff" || !target.email_verified)
        throw fail(
          409,
          "TRANSFER_TARGET",
          "The new owner must be an active staff member with verified email",
        );
      await tx.query(
        "UPDATE workspace_lifecycle_requests SET status='canceled',revision=revision+1 WHERE tenant_id=$1 AND status='pending' AND expires_at<=now()",
        [a.tenantId],
      );
      const [request] = await tx.query(
        "INSERT INTO workspace_lifecycle_requests(id,tenant_id,kind,requested_by,target_user_id,data) VALUES($1,$2,'ownership_transfer',$3,$4,$5) RETURNING id,revision,status",
        [
          randomUUID(),
          a.tenantId,
          a.userId,
          b.targetUserId,
          JSON.stringify({ reason: b.reason }),
        ],
      );
      await setTenant(tx, a);
      await event(tx, a, "workspace.ownership_transfer_requested", request.id, {
        targetUserId: b.targetUserId,
      });
      return request;
    });
  });
  app.post("/api/v1/tenant/lifecycle/:id/accept", async (req, reply) => {
    const a = identity(req);
    requireRecentMfa(a, true);
    const b = z
      .object({
        expectedRevision: z.number().int().positive(),
        password: z.string().max(128),
        acceptResponsibilities: z.literal(true),
      })
      .strict()
      .parse(req.body);
    return db.system(async (tx) => {
      await workspaceLock(tx, a.tenantId);
      const [r] = await tx.query(
        "SELECT * FROM workspace_lifecycle_requests WHERE id=$1 AND tenant_id=$2 AND kind='ownership_transfer' FOR UPDATE",
        [uuid.parse((req.params as any).id), a.tenantId],
      );
      if (!r || r.target_user_id !== a.userId)
        throw fail(404, "NOT_FOUND", "Ownership transfer unavailable");
      if (
        r.status !== "pending" ||
        r.revision !== b.expectedRevision ||
        new Date(r.expires_at).getTime() <= Date.now()
      )
        throw fail(409, "STALE_REVISION", "The transfer changed or expired");
      await assertOwner(tx, { ...a, userId: r.requested_by });
      const [u] = await tx.query(
        "SELECT password_hash,email_verified FROM users WHERE id=$1 FOR UPDATE",
        [a.userId],
      );
      if (
        !u?.email_verified ||
        !(await passwordMatches(b.password, u.password_hash))
      )
        throw fail(
          401,
          "INVALID_PASSWORD",
          "Verify your email and current password",
        );
      const [m] = await tx.query(
        "SELECT role FROM memberships WHERE tenant_id=$1 AND user_id=$2 FOR UPDATE",
        [a.tenantId, a.userId],
      );
      if (m?.role !== "staff")
        throw fail(
          409,
          "TRANSFER_TARGET",
          "The recipient is no longer an active staff member",
        );
      const owners = await tx.query(
        "SELECT user_id FROM memberships WHERE tenant_id=$1 AND role='owner' FOR UPDATE",
        [a.tenantId],
      );
      if (owners.length !== 1 || owners[0].user_id !== r.requested_by)
        throw fail(
          409,
          "OWNERSHIP_CHANGED",
          "Workspace ownership changed; start a new transfer",
        );
      await tx.query(
        "UPDATE memberships SET role=CASE WHEN user_id=$2 THEN 'owner' ELSE 'staff' END WHERE tenant_id=$1 AND user_id=ANY($3::uuid[])",
        [a.tenantId, a.userId, [a.userId, r.requested_by]],
      );
      await tx.query(
        "UPDATE workspace_lifecycle_requests SET status='completed',revision=revision+1,completed_at=now() WHERE id=$1",
        [r.id],
      );
      await tx.query(
        "UPDATE one_time_tokens SET consumed_at=now() WHERE tenant_id=$1 AND purpose='invite' AND payload->>'role' IN ('staff','finance') AND consumed_at IS NULL",
        [a.tenantId],
      );
      await tx.query(
        "DELETE FROM sessions WHERE tenant_id=$1 AND user_id=ANY($2::uuid[])",
        [a.tenantId, [a.userId, r.requested_by]],
      );
      await setTenant(tx, { ...a, role: "owner" });
      await event(
        tx,
        { ...a, role: "owner" },
        "workspace.ownership_transferred",
        r.id,
        { previousOwner: r.requested_by, newOwner: a.userId },
      );
      reply.clearCookie("session", { path: "/" });
      return { status: "completed", signInRequired: true };
    });
  });
  app.post("/api/v1/tenant/lifecycle/:id/cancel", async (req) => {
    const a = identity(req);
    requireRecentMfa(a, true);
    const b = z
      .object({ expectedRevision: z.number().int().positive() })
      .strict()
      .parse(req.body);
    return db.system(async (tx) => {
      await workspaceLock(tx, a.tenantId);
      await assertOwner(tx, a);
      const [r] = await tx.query(
        "UPDATE workspace_lifecycle_requests SET status='canceled',revision=revision+1 WHERE id=$1 AND tenant_id=$2 AND requested_by=$3 AND revision=$4 AND status='pending' RETURNING id,status,revision",
        [
          uuid.parse((req.params as any).id),
          a.tenantId,
          a.userId,
          b.expectedRevision,
        ],
      );
      if (!r)
        throw fail(409, "STALE_REVISION", "This request changed; reload it");
      await setTenant(tx, a);
      await event(tx, a, "workspace.lifecycle_canceled", r.id);
      return r;
    });
  });
  app.post("/api/v1/tenant/lifecycle/closure", async (req) => {
    const a = identity(req);
    requireRecentMfa(a, true);
    const b = z
      .object({
        password: z.string().max(128),
        reason: z.string().trim().min(10).max(1000),
        confirmClosure: z.literal(true),
      })
      .strict()
      .parse(req.body);
    return db.system(async (tx) => {
      await workspaceLock(tx, a.tenantId);
      await assertOwner(tx, a, b.password);
      await setTenant(tx, a);
      await assertSettled(tx);
      await tx.query("RESET ROLE");
      await tx.query(
        "UPDATE workspace_lifecycle_requests SET status='canceled',revision=revision+1 WHERE tenant_id=$1 AND status='pending' AND expires_at<=now()",
        [a.tenantId],
      );
      const [r] = await tx.query(
        "INSERT INTO workspace_lifecycle_requests(id,tenant_id,kind,requested_by,data) VALUES($1,$2,'closure',$3,$4) RETURNING id,revision,status",
        [
          randomUUID(),
          a.tenantId,
          a.userId,
          JSON.stringify({ reason: b.reason }),
        ],
      );
      await setTenant(tx, a);
      await event(tx, a, "workspace.closure_requested", r.id);
      return r;
    });
  });
  app.get("/api/v1/admin/tenants/:tenantId/privacy/lifecycle", async (req) => {
    const a = operator(req);
    return db.system(async (tx) => ({
      requests: await tx.query(
        "SELECT id,kind,requested_by,target_user_id,status,revision,data,created_at,expires_at FROM workspace_lifecycle_requests WHERE tenant_id=$1 ORDER BY created_at DESC",
        [a.tenantId],
      ),
      registry: await tx.query(
        "SELECT id,scope,request_id,erased_at,retention_policy_version FROM privacy_erasure_registry WHERE tenant_id=$1 ORDER BY erased_at DESC",
        [a.tenantId],
      ),
    }));
  });
  app.get("/api/v1/admin/tenants/:tenantId/privacy/followups", async (req) => {
    const a = operator(req);
    return db.tenant(a, (tx) =>
      tx.query(
        "SELECT *,status='pending' AND due_at<now() AS overdue FROM privacy_followups ORDER BY due_at,id",
      ),
    );
  });
  app.post(
    "/api/v1/admin/tenants/:tenantId/privacy/followups/:id",
    async (req) => {
      const a = operator(req);
      const b = z
        .object({
          expectedRevision: z.number().int().positive(),
          outcome: z.enum(["completed", "retained"]),
          evidenceReference: z.string().trim().min(10).max(1000),
          nextReviewAt: z.iso.datetime().optional(),
        })
        .strict()
        .parse(req.body);
      if (
        b.outcome === "retained" &&
        (!b.nextReviewAt || new Date(b.nextReviewAt).getTime() <= Date.now())
      )
        throw fail(
          400,
          "RETENTION_REVIEW",
          "A retained item needs a future review date",
        );
      return db.tenant(a, async (tx) => {
        const [r] = await tx.query(
          "SELECT * FROM privacy_followups WHERE id=$1 FOR UPDATE",
          [uuid.parse((req.params as any).id)],
        );
        if (!r) throw fail(404, "NOT_FOUND", "Follow-up unavailable");
        if (r.revision !== b.expectedRevision || r.status === "completed")
          throw fail(
            409,
            "STALE_REVISION",
            "This follow-up changed or is completed",
          );
        if (b.outcome === "retained" && r.scope !== "retention")
          throw fail(
            400,
            "ERASURE_EVIDENCE",
            "Provider and backup tasks require actual purge or expiry evidence",
          );
        const [updated] = await tx.query(
          "UPDATE privacy_followups SET status=$2,evidence_reference=$3,completed_at=CASE WHEN $2='completed' THEN now() ELSE NULL END,completed_by=$4,revision=revision+1,due_at=coalesce($5::timestamptz,due_at) WHERE id=$1 RETURNING *",
          [
            r.id,
            b.outcome,
            b.evidenceReference,
            a.userId,
            b.nextReviewAt ?? null,
          ],
        );
        await event(tx, a, "privacy.followup_recorded", r.id, {
          outcome: b.outcome,
          evidenceReference: b.evidenceReference,
          nextReviewAt: b.nextReviewAt,
        });
        return updated;
      });
    },
  );
  app.post(
    "/api/v1/admin/tenants/:tenantId/privacy/lifecycle/:id/close",
    async (req) => {
      const a = operator(req);
      const b = erasureSchema.parse(req.body);
      return db.system(async (tx) => {
        await workspaceLock(tx, a.tenantId);
        const [r] = await tx.query(
          "SELECT * FROM workspace_lifecycle_requests WHERE id=$1 AND tenant_id=$2 AND kind='closure' FOR UPDATE",
          [uuid.parse((req.params as any).id), a.tenantId],
        );
        if (!r) throw fail(404, "NOT_FOUND", "Closure request unavailable");
        if (r.status === "completed") return { status: "completed" };
        if (
          r.status !== "pending" ||
          r.revision !== b.expectedRevision ||
          new Date(r.expires_at).getTime() <= Date.now()
        )
          throw fail(
            409,
            "STALE_REVISION",
            "The closure request changed or expired",
          );
        if (r.requested_by === a.userId)
          throw fail(
            403,
            "INDEPENDENT_REVIEW",
            "A different platform administrator must review the owner’s closure request",
          );
        await assertOwner(tx, { ...a, userId: r.requested_by });
        const users = await tx.query(
          "SELECT u.id,u.email FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=$1 ORDER BY u.id FOR UPDATE OF u,m",
          [a.tenantId],
        );
        await setTenant(tx, a);
        await assertSettled(tx);
        const knownProviders = hooks.providerInventory
          ? await hooks.providerInventory(tx)
          : [];
        const evidence = {
          ...b,
          providers: [
            ...b.providers,
            ...knownProviders
              .filter(
                (name) =>
                  !b.providers.some(
                    (p) => p.name.toLowerCase() === name.toLowerCase(),
                  ),
              )
              .map((name) => ({ name, dueAt: b.backupPurgeBy })),
          ],
        };
        for (const u of users)
          await erasePersonalData(tx, a, u.id, u.email, hooks);
        await tx.query("SELECT set_config('app.privacy_erasure','true',true)");
        await tx.query("DELETE FROM records WHERE kind<>ALL($1::text[])", [
          retainedKinds,
        ]);
        for (const table of [
          "nutrition_ingredients",
          "nutrition_recipe_options",
          "nutrition_recipes",
          "nutrition_foods",
          "bookings",
          "booking_slots",
          "meal_captures",
          "workout_events",
          "jobs",
        ])
          await tx.query(`DELETE FROM ${table}`);
        if (hooks.closeAdditional) await hooks.closeAdditional(tx);
        await createPrivacyFollowups(tx, a, r.id, null, evidence);
        await event(tx, a, "workspace.closed", r.id, {
          retentionPolicyVersion: b.retentionPolicyVersion,
          evidenceReference: b.evidenceReference,
          externalStatus: "followups_pending",
        });
        await tx.query("RESET ROLE");
        await purgeAcquisition(tx, a);
        await tx.query(
          "UPDATE tenants SET lifecycle_state='closed',closed_at=now(),published=false,name='Closed workspace',theme='{}'::jsonb WHERE id=$1",
          [a.tenantId],
        );
        await tx.query(
          "UPDATE domain_mappings SET active=false,verified_at=NULL WHERE tenant_id=$1",
          [a.tenantId],
        );
        await tx.query("DELETE FROM sessions WHERE tenant_id=$1", [a.tenantId]);
        await tx.query("DELETE FROM one_time_tokens WHERE tenant_id=$1", [
          a.tenantId,
        ]);
        await tx.query("DELETE FROM memberships WHERE tenant_id=$1", [
          a.tenantId,
        ]);
        for (const u of users) await scrubUnusedAccount(tx, u.id);
        await tx.query(
          "UPDATE workspace_lifecycle_requests SET status='completed',revision=revision+1,completed_at=now(),data=$2 WHERE id=$1",
          [
            r.id,
            JSON.stringify({
              retentionPolicyVersion: b.retentionPolicyVersion,
              evidenceReference: b.evidenceReference,
            }),
          ],
        );
        await tx.query(
          "INSERT INTO privacy_erasure_registry(id,tenant_id,request_id,scope,retention_policy_version,evidence_reference) VALUES($1,$2,$3,'workspace',$4,$5)",
          [
            randomUUID(),
            a.tenantId,
            r.id,
            b.retentionPolicyVersion,
            b.evidenceReference,
          ],
        );
        return { status: "completed", externalStatus: "followups_pending" };
      });
    },
  );
}
