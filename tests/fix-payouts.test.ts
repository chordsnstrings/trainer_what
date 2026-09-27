import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import {
  createDatabase,
  type Database,
  type Actor,
  putRecord,
} from "@trainer/db";
import { integrationStatus, withRuntimeConfig } from "@trainer/providers";
import { buildApp } from "../apps/api/src/app.ts";
import { newToken, tokenHash } from "../apps/api/src/auth.ts";
import {
  financeSummary,
  journal,
  recordCharge,
  transitionPayout,
} from "../apps/api/src/finance.ts";
import { executePayout } from "../apps/api/src/payout-execution.ts";
import { configureFinanceAutomation } from "../apps/api/src/finance-automation.ts";
import { settlementBlockers } from "../apps/api/src/privacy-lifecycle.ts";
import {
  loadRuntimeSettings,
  platformSettingsRoutes,
} from "../apps/api/src/platform-settings.ts";

// Every bank request is answered by this in-process fixture. The runtime
// provider transport only permits replaced fetch for reserved test domains.
const LEAN = "https://lean.fixture.test";
const leanEnvironment: Record<string, string> = {
  LEAN_BASE_URL: LEAN,
  LEAN_ACCESS_TOKEN: "synthetic-lean-fixture-token",
  LEAN_SOURCE_ACCOUNT_ID: "synthetic-company-account",
  LEAN_CONTRACT_VERIFIED: "true",
  PAYOUTS_APPROVED: "true",
};
const savedEnvironment = Object.fromEntries(
  [...Object.keys(leanEnvironment), "SECURITY_ENCRYPTION_KEY"].map((key) => [
    key,
    process.env[key],
  ]),
);
const originalFetch = globalThis.fetch;
type LeanCall = { url: string; method: string; key: string | null; body: any };
const leanCalls: LeanCall[] = [];
let leanPayments: "accept" | "timeout" = "accept";
let leanDestinations: "accept" | "timeout" = "accept";

const origin = "http://localhost:3000";
let db: Database, app: Awaited<ReturnType<typeof buildApp>>;
let op1: any, op2: any;

async function request(
  url: string,
  method: "GET" | "POST" = "GET",
  body?: unknown,
  cookie?: string,
) {
  return app.inject({
    url: "/api/v1" + url,
    method,
    headers: {
      origin,
      ...(cookie ? { cookie } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    payload: body as any,
  });
}
// Registration is rate limited; fixtures create the owner, workspace and session directly.
async function register(slug: string) {
  const tenantId = randomUUID(),
    userId = randomUUID(),
    token = newToken();
  await db.system(async (tx) => {
    await tx.query(
      "INSERT INTO users(id,name,email,password_hash,email_verified) VALUES($1,$2,$3,'fixture-only',true)",
      [userId, `Coach ${slug}`, `${slug}@example.test`],
    );
    await tx.query(
      "INSERT INTO tenants(id,slug,name,published) VALUES($1,$2,$3,true)",
      [tenantId, slug, `Coach ${slug}`],
    );
    await tx.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')",
      [tenantId, userId],
    );
    await tx.query(
      "INSERT INTO sessions(token_hash,user_id,tenant_id,expires_at) VALUES($1,$2,$3,now()+interval '1 day')",
      [tokenHash(token), userId, tenantId],
    );
  });
  const cookie = "session=" + token;
  const boot = await request("/bootstrap", "GET", undefined, cookie);
  assert.equal(boot.statusCode, 200, boot.body);
  return { ...boot.json().user, cookie };
}
async function platformRole(user: any, role: string) {
  await db.system((tx) =>
    tx.query("UPDATE users SET platform_role=$2 WHERE id=$1", [
      user.userId,
      role,
    ]),
  );
}
async function mfa(user: any, minutesAgo = 0) {
  await db.system((tx) =>
    tx.query(
      "UPDATE sessions SET mfa_at=now()-make_interval(mins=>$2) WHERE user_id=$1",
      [user.userId, minutesAgo],
    ),
  );
}
const actor = (user: any, role = "owner"): Actor => ({
  tenantId: user.tenantId,
  userId: user.userId,
  role,
});
const admin = (tenantId: string, path = "") =>
  `/admin/tenants/${tenantId}/finance${path}`;
async function fund(owner: any, period: string, amount: number) {
  const a = actor(owner);
  await db.tenant(a, async (tx) => {
    await journal(tx, a, "fixture-funding:" + period, "Synthetic funding", [
      { account: "bank_cash", amount },
      { account: "trainer_payable", amount: -amount },
    ]);
    await putRecord(
      tx,
      a,
      "close",
      { period, cutoff: new Date().toISOString(), eligibleMinor: amount },
      { status: "closed" },
    );
  });
}
async function verifiedDestination(owner: any, providerId: string) {
  const a = actor(owner);
  return db.tenant(a, (tx) =>
    putRecord(
      tx,
      a,
      "beneficiary",
      {
        name: "Synthetic payee",
        maskedIban: "AE•••• 0000",
        fingerprint: randomUUID(),
        providerId,
        holdUntil: "2020-01-01T00:00:00.000Z",
      },
      { status: "verified" },
    ),
  );
}
async function payout(owner: any, id: string) {
  const [p] = await db.tenant(actor(owner), (tx) =>
    tx.query("SELECT * FROM payouts WHERE id=$1", [id]),
  );
  return p;
}
const payments = () => leanCalls.filter((c) => c.url.endsWith("/payment"));

before(async () => {
  Object.assign(process.env, leanEnvironment);
  globalThis.fetch = async (input: any, init: any = {}) => {
    const url = String(input);
    if (!url.startsWith(LEAN + "/"))
      throw new Error("No external request is permitted in this fixture");
    const call = {
      url,
      method: String(init.method ?? "GET"),
      key: new Headers(init.headers).get("idempotency-key"),
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    };
    leanCalls.push(call);
    if (url === LEAN + "/payouts/v1/payment/destinations")
      return leanDestinations === "accept"
        ? Response.json({ id: "dest_" + call.key })
        : new Response("gateway timeout", { status: 504 });
    if (url === LEAN + "/payouts/v1/payment")
      return leanPayments === "accept"
        ? Response.json({ id: "pay_" + call.key, status: "pending" })
        : new Response("gateway timeout", { status: 504 });
    return new Response("not found", { status: 404 });
  };
  db = await createDatabase({ memory: true });
  app = await buildApp({ db, testing: true });
  op1 = await register("payout-finance-one");
  op2 = await register("payout-finance-two");
  for (const op of [op1, op2]) {
    await platformRole(op, "finance");
    await mfa(op);
  }
});
after(async () => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(savedEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await app?.close();
  await db?.close();
});

test("bank payout flow: owner destination, independent review, hold, prepare, one independent dispatch and reconciliation", async () => {
  const owner = await register("payout-owner-flow");
  let r = await request(
    "/payout-beneficiaries",
    "POST",
    {
      name: "Synthetic Trainer",
      iban: "AE07 0331 2345 6789 0123 456",
      address: "1 Fixture Street",
      city: "Dubai",
    },
    owner.cookie,
  );
  assert.equal(r.statusCode, 200, r.body);
  const destination = r.json();
  assert.equal(destination.status, "validating");
  assert.equal(leanCalls.length, 1);
  assert.equal(leanCalls[0].method, "POST");
  assert.equal(leanCalls[0].key, destination.id);
  const leanDestination = "dest_" + destination.id;
  r = await request(
    "/payout-beneficiaries",
    "POST",
    {
      name: "Synthetic Trainer",
      iban: "AE070331234567890123456",
      address: "1 Fixture Street",
      city: "Dubai",
    },
    owner.cookie,
  );
  assert.equal(r.statusCode, 409, r.body);
  assert.equal(leanCalls.length, 1);

  // A provider failure leaves an unresolved destination that cannot be verified.
  leanDestinations = "timeout";
  r = await request(
    "/payout-beneficiaries",
    "POST",
    {
      name: "Synthetic Trainer",
      iban: "AE770331234567890123457",
      address: "1 Fixture Street",
      city: "Dubai",
    },
    owner.cookie,
  );
  leanDestinations = "accept";
  assert.equal(r.statusCode, 503, r.body);
  const [unknown] = await db.tenant(actor(owner), (tx) =>
    tx.query(
      "SELECT * FROM records WHERE kind='beneficiary' AND status='unknown'",
    ),
  );
  assert.ok(unknown);
  const review = (id: string, body: any, cookie: string) =>
    request(
      admin(owner.tenantId, `/beneficiaries/${id}/review`),
      "POST",
      { evidenceReference: "Ownership letter FIXTURE-001", ...body },
      cookie,
    );
  r = await review(unknown.id, { verified: true }, op1.cookie);
  assert.equal(r.statusCode, 409, r.body);
  assert.equal(r.json().code, "BENEFICIARY_STATE");
  r = await review(unknown.id, { verified: false }, op1.cookie);
  assert.equal(r.statusCode, 200, r.body);

  // One operator cannot replace the provider-returned destination.
  r = await review(
    destination.id,
    { verified: true, providerId: "dest_attacker" },
    op1.cookie,
  );
  assert.equal(r.statusCode, 409, r.body);
  assert.equal(r.json().code, "DESTINATION_MISMATCH");
  let [record] = await db.tenant(actor(owner), (tx) =>
    tx.query("SELECT * FROM records WHERE id=$1", [destination.id]),
  );
  assert.equal(record.status, "validating");
  assert.equal(record.data.providerId, leanDestination);

  // The payee cannot verify their own destination, in any environment.
  await platformRole(owner, "finance");
  await mfa(owner);
  r = await review(destination.id, { verified: true }, owner.cookie);
  assert.equal(r.statusCode, 403, r.body);
  assert.equal(r.json().code, "SECOND_REVIEWER_REQUIRED");

  r = await review(
    destination.id,
    { verified: true, providerId: leanDestination },
    op1.cookie,
  );
  assert.equal(r.statusCode, 200, r.body);
  r = await review(destination.id, { verified: true }, op2.cookie);
  assert.equal(r.statusCode, 409, r.body);
  [record] = await db.tenant(actor(owner), (tx) =>
    tx.query("SELECT * FROM records WHERE id=$1", [destination.id]),
  );
  assert.equal(record.status, "verified");
  assert.equal(record.data.providerId, leanDestination);
  assert.equal(record.data.reviewedBy, op1.userId);
  assert.ok(Date.parse(record.data.holdUntil) > Date.now() + 71 * 3600000);

  await fund(owner, "2026-08", 7500);
  r = await request(
    "/payout-runs/prepare",
    "POST",
    { period: "2026-08" },
    owner.cookie,
  );
  assert.equal(r.statusCode, 409, r.body);
  assert.equal(r.json().code, "BANK_CHANGE_HOLD");
  // Tenant rows are changed through a tenant transaction, as the restricted
  // PostgreSQL runtime role requires.
  await db.tenant(actor(owner), (tx) =>
    tx.query(
      'UPDATE records SET data=data||\'{"holdUntil":"2020-01-01T00:00:00.000Z"}\'::jsonb WHERE id=$1',
      [destination.id],
    ),
  );
  r = await request(
    "/payout-runs/prepare",
    "POST",
    { period: "2026-08" },
    owner.cookie,
  );
  assert.equal(r.statusCode, 200, r.body);
  const prepared = r.json();
  assert.equal(prepared.status, "ready");
  assert.equal(prepared.beneficiary_id, leanDestination);
  assert.equal(prepared.prepared_by, owner.userId);

  // The preparer and payee cannot dispatch, through either route.
  r = await request(
    `/payout-runs/${prepared.id}/execute`,
    "POST",
    {},
    owner.cookie,
  );
  assert.equal(r.statusCode, 409, r.body);
  assert.equal(r.json().code, "SEPARATION_OF_DUTIES");
  r = await request(
    admin(owner.tenantId, `/payouts/${prepared.id}/execute`),
    "POST",
    {},
    owner.cookie,
  );
  assert.equal(r.statusCode, 409, r.body);
  assert.equal(r.json().code, "SEPARATION_OF_DUTIES");
  assert.equal(payments().length, 0);
  assert.equal((await payout(owner, prepared.id)).status, "ready");

  // Platform finance authority and a fresh second factor are both required.
  const coach = await register("payout-plain-coach");
  r = await request(
    admin(owner.tenantId, `/payouts/${prepared.id}/execute`),
    "POST",
    {},
    coach.cookie,
  );
  assert.equal(r.statusCode, 403, r.body);
  await mfa(op1, 20);
  r = await request(
    admin(owner.tenantId, `/payouts/${prepared.id}/execute`),
    "POST",
    {},
    op1.cookie,
  );
  assert.equal(r.statusCode, 403, r.body);
  assert.equal(r.json().code, "MFA_STEP_UP");
  await mfa(op1);
  assert.equal(payments().length, 0);

  r = await request(
    admin(owner.tenantId, `/payouts/${prepared.id}/execute`),
    "POST",
    {},
    op1.cookie,
  );
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().status, "processing");
  assert.equal(payments().length, 1);
  assert.equal(payments()[0].key, prepared.id);
  assert.equal(payments()[0].body.destination_id, leanDestination);
  assert.equal(payments()[0].body.amount, 75);
  assert.equal(
    payments()[0].body.source_account_id,
    "synthetic-company-account",
  );
  let current = await payout(owner, prepared.id);
  assert.equal(current.status, "processing");
  assert.equal(current.provider_id, "pay_" + prepared.id);
  r = await request(
    admin(owner.tenantId, `/payouts/${prepared.id}/execute`),
    "POST",
    {},
    op1.cookie,
  );
  assert.equal(r.statusCode, 409, r.body);
  assert.equal(r.json().code, "PAYOUT_STATE");
  assert.equal(payments().length, 1);

  // A provider acknowledgement never marks it paid; bank evidence does, once.
  const paid = {
    status: "paid",
    bankReference: "BANK-STATEMENT-0001",
    evidenceReference: "Company bank statement line 0001",
  };
  r = await request(
    admin(owner.tenantId, `/payouts/${prepared.id}/reconcile`),
    "POST",
    paid,
    owner.cookie,
  );
  assert.equal(r.statusCode, 409, r.body);
  assert.equal(r.json().code, "SEPARATION_OF_DUTIES");
  for (let i = 0; i < 2; i++) {
    r = await request(
      admin(owner.tenantId, `/payouts/${prepared.id}/reconcile`),
      "POST",
      paid,
      op2.cookie,
    );
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().status, "paid");
  }
  const journals = await db.tenant(actor(owner), (tx) =>
    tx.query("SELECT * FROM journals WHERE source_key=$1", [
      "payout:" + prepared.id,
    ]),
  );
  assert.equal(journals.length, 1);
  const summary = await db.tenant(actor(owner), financeSummary);
  assert.equal(summary.earnedMinor, 0);
  assert.equal(summary.reservedMinor, 0);
});

test("an ambiguous dispatch stays unknown until an independent operator records provider-confirmed failure", async () => {
  const owner = await register("payout-owner-unknown");
  await fund(owner, "2026-08", 5000);
  await verifiedDestination(owner, "dest_unknown_fixture");
  let r = await request(
    "/payout-runs/prepare",
    "POST",
    { period: "2026-08" },
    owner.cookie,
  );
  assert.equal(r.statusCode, 200, r.body);
  const first = r.json();
  const before = payments().length;
  leanPayments = "timeout";
  try {
    r = await request(
      admin(owner.tenantId, `/payouts/${first.id}/execute`),
      "POST",
      {},
      op1.cookie,
    );
  } finally {
    leanPayments = "accept";
  }
  assert.equal(r.statusCode, 503, r.body);
  assert.equal(payments().length, before + 1);
  assert.equal((await payout(owner, first.id)).status, "unknown");
  r = await request(
    admin(owner.tenantId, `/payouts/${first.id}/execute`),
    "POST",
    {},
    op1.cookie,
  );
  assert.equal(r.statusCode, 409, r.body);
  assert.equal(payments().length, before + 1);

  const failed = {
    status: "failed",
    bankReference: "NO-DEBIT-0001",
    evidenceReference: "Company bank statement shows no debit",
  };
  const reconcile = (body: any, cookie: string) =>
    request(
      admin(owner.tenantId, `/payouts/${first.id}/reconcile`),
      "POST",
      body,
      cookie,
    );
  r = await reconcile(failed, op2.cookie);
  assert.equal(r.statusCode, 400, r.body);
  assert.equal(r.json().code, "PROVIDER_CONFIRMATION_REQUIRED");
  r = await reconcile({ ...failed, providerStatus: "rejected" }, op1.cookie);
  assert.equal(r.statusCode, 409, r.body);
  assert.equal(r.json().code, "SEPARATION_OF_DUTIES");
  assert.equal((await payout(owner, first.id)).status, "unknown");
  // The unresolved instruction still holds the period.
  r = await request(
    "/payout-runs/prepare",
    "POST",
    { period: "2026-08" },
    owner.cookie,
  );
  assert.equal(r.json().id, first.id);

  r = await reconcile({ ...failed, providerStatus: "rejected" }, op2.cookie);
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().status, "failed");
  r = await request(
    "/payout-runs/prepare",
    "POST",
    { period: "2026-08" },
    owner.cookie,
  );
  assert.equal(r.statusCode, 200, r.body);
  const second = r.json();
  assert.equal(second.revision, 2);
  r = await request(
    admin(owner.tenantId, `/payouts/${second.id}/execute`),
    "POST",
    {},
    op1.cookie,
  );
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(payments().at(-1)!.key, second.id);
});

test("a failed instruction without independent provider confirmation blocks another provider identity", async () => {
  const owner = await register("payout-owner-legacy");
  const a = actor(owner);
  await fund(owner, "2026-08", 4000);
  await verifiedDestination(owner, "dest_legacy_fixture");
  let r = await request(
    "/payout-runs/prepare",
    "POST",
    { period: "2026-08" },
    owner.cookie,
  );
  const first = r.json();
  // Recorded before this control existed: failed on an operator's word only.
  await db.tenant(a, async (tx) => {
    await transitionPayout(tx, a, first.id, "submitted");
    await transitionPayout(tx, a, first.id, "unknown");
    await transitionPayout(tx, a, first.id, "failed", "operator-said-failed");
  });
  r = await request(
    "/payout-runs/prepare",
    "POST",
    { period: "2026-08" },
    owner.cookie,
  );
  assert.equal(r.statusCode, 409, r.body);
  assert.equal(r.json().code, "PAYOUT_RECONCILIATION_REQUIRED");
  assert.equal(
    (
      await db.tenant(a, (tx) =>
        tx.query("SELECT id FROM payouts WHERE period='2026-08'"),
      )
    ).length,
    1,
  );
  // Independent confirmation can be added to the existing failed record.
  r = await request(
    admin(owner.tenantId, `/payouts/${first.id}/reconcile`),
    "POST",
    {
      status: "failed",
      providerStatus: "not_found",
      bankReference: "NO-DEBIT-0002",
      evidenceReference: "Provider has no instruction under this key",
    },
    op2.cookie,
  );
  assert.equal(r.statusCode, 200, r.body);
  r = await request(
    "/payout-runs/prepare",
    "POST",
    { period: "2026-08" },
    owner.cookie,
  );
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().revision, 2);
});

test("a stuck ready instruction is canceled with an audited reason, releasing its reservation for a new revision", async () => {
  const owner = await register("payout-owner-stuck");
  const a = actor(owner);
  await fund(owner, "2026-08", 6000);
  const x = await verifiedDestination(owner, "dest_original_fixture");
  let r = await request(
    "/payout-runs/prepare",
    "POST",
    { period: "2026-08" },
    owner.cookie,
  );
  assert.equal(r.statusCode, 200, r.body);
  const stuck = r.json();
  r = await request(
    admin(owner.tenantId, `/beneficiaries/${x.id}/review`),
    "POST",
    { verified: false, evidenceReference: "Account closed per bank letter" },
    op1.cookie,
  );
  assert.equal(r.statusCode, 200, r.body);
  await verifiedDestination(owner, "dest_replacement_fixture");
  r = await request(
    admin(owner.tenantId, `/payouts/${stuck.id}/execute`),
    "POST",
    {},
    op1.cookie,
  );
  assert.equal(r.json().code, "BENEFICIARY_REQUIRED");
  r = await request(
    "/payout-runs/prepare",
    "POST",
    { period: "2026-08" },
    owner.cookie,
  );
  assert.equal(r.statusCode, 409, r.body);
  assert.equal(r.json().code, "PAYOUT_DESTINATION_CHANGED");

  const cancel = (id: string, body: any, cookie = op1.cookie) =>
    request(
      admin(owner.tenantId, `/payouts/${id}/cancel`),
      "POST",
      body,
      cookie,
    );
  assert.equal((await cancel(stuck.id, { reason: "short" })).statusCode, 400);
  assert.equal(
    (await cancel(stuck.id, { reason: "Destination replaced" }, owner.cookie))
      .statusCode,
    403,
  );
  r = await cancel(stuck.id, { reason: "Destination replaced" });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().status, "canceled");
  r = await cancel(
    stuck.id,
    { reason: "Replay of the same cancellation" },
    op2.cookie,
  );
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().status, "canceled");
  const history = await db.tenant(a, (tx) =>
    tx.query(
      "SELECT name,data FROM events WHERE subject_id=$1 AND name IN ('payout.canceled','payout.cancel_recorded') ORDER BY created_at",
      [stuck.id],
    ),
  );
  assert.deepEqual(
    history.map((e) => e.name),
    ["payout.canceled", "payout.cancel_recorded"],
  );
  assert.equal(history[1].data.reason, "Destination replaced");
  const summary = await db.tenant(a, financeSummary);
  assert.equal(summary.reservedMinor, 0);
  const blockers = await db.tenant(a, (tx) => settlementBlockers(tx));
  assert.equal(
    blockers.some((b) => b.kind === "payout"),
    false,
  );

  r = await request(
    "/payout-runs/prepare",
    "POST",
    { period: "2026-08" },
    owner.cookie,
  );
  assert.equal(r.statusCode, 200, r.body);
  const next = r.json();
  assert.equal(next.revision, 2);
  assert.equal(next.beneficiary_id, "dest_replacement_fixture");
  r = await request(
    admin(owner.tenantId, `/payouts/${next.id}/execute`),
    "POST",
    {},
    op1.cookie,
  );
  assert.equal(r.statusCode, 200, r.body);
  r = await cancel(next.id, { reason: "Too late to cancel a dispatched one" });
  assert.equal(r.statusCode, 409, r.body);
  assert.equal(r.json().code, "PAYOUT_STATE");
  assert.equal((await payout(owner, stuck.id)).status, "canceled");
});

test("unattended dispatch requires an automation approver independent of the payee workspace", async () => {
  const owner = await register("payout-owner-automation");
  await fund(owner, "2026-08", 3000);
  await verifiedDestination(owner, "dest_automation_fixture");
  const r = await request(
    "/payout-runs/prepare",
    "POST",
    { period: "2026-08" },
    owner.cookie,
  );
  const prepared = r.json();
  const settings = {
    enabled: true,
    reconcileStripe: false,
    closeMonthly: true,
    preparePayouts: true,
    executePayouts: true,
    maxPayoutMinor: 10000,
    fxAedPerUsd: 3.6725,
    fxEvidence: "Central bank reference rate fixture",
    reason: "Reviewed synthetic automation fixture",
  };
  const job = {
    tenantId: owner.tenantId,
    userId: owner.userId,
    role: "finance",
  };
  const self = await db.tenant(actor(owner, "finance"), (tx) =>
    configureFinanceAutomation(tx, actor(owner, "finance"), {
      ...settings,
      revision: 0,
    }),
  );
  const before = payments().length;
  await assert.rejects(
    executePayout(db, job, prepared.id, {
      configurationId: self.id,
      revision: self.version,
      maxPayoutMinor: settings.maxPayoutMinor,
    }),
    (error: any) => error.code === "SEPARATION_OF_DUTIES",
  );
  assert.equal(payments().length, before);
  assert.equal((await payout(owner, prepared.id)).status, "ready");
  const operator = { ...actor(op1, "finance"), tenantId: owner.tenantId };
  const independent = await db.tenant(operator, (tx) =>
    configureFinanceAutomation(tx, operator, {
      ...settings,
      revision: self.version,
    }),
  );
  const result = await executePayout(db, job, prepared.id, {
    configurationId: independent.id,
    revision: independent.version,
    maxPayoutMinor: settings.maxPayoutMinor,
  });
  assert.equal(result.status, "processing");
  assert.equal(payments().length, before + 1);
});

test("finance administration routes enforce role, forced MFA, tenant scope, validation and idempotency", async () => {
  const owner = await register("payout-owner-admin");
  const other = await register("payout-owner-foreign");
  const a = actor(owner);
  const routes: Array<[string, "GET" | "POST"]> = [
    ["", "GET"],
    ["/settlements", "POST"],
    ["/usage-statements", "POST"],
    ["/close", "POST"],
    [`/beneficiaries/${randomUUID()}/review`, "POST"],
    [`/payouts/${randomUUID()}/execute`, "POST"],
    [`/payouts/${randomUUID()}/cancel`, "POST"],
    [`/payouts/${randomUUID()}/reconcile`, "POST"],
    ["/exceptions", "POST"],
    [`/exceptions/${randomUUID()}/resolve`, "POST"],
  ];
  const coach = await register("payout-admin-coach");
  await mfa(coach);
  for (const [path, method] of routes) {
    const body = method === "POST" ? {} : undefined;
    let r = await request(
      admin(owner.tenantId, path),
      method,
      body,
      coach.cookie,
    );
    assert.equal(r.statusCode, 403, `${path}: ${r.body}`);
    await mfa(op1, 20);
    r = await request(admin(owner.tenantId, path), method, body, op1.cookie);
    assert.equal(r.statusCode, 403, `${path}: ${r.body}`);
    assert.equal(r.json().code, "MFA_STEP_UP");
    await mfa(op1);
  }

  // Workspace summary is scoped to the requested tenant and audited.
  await db.tenant(a, (tx) =>
    tx.query(
      "INSERT INTO payouts(id,tenant_id,period,amount_minor,beneficiary_id,status) VALUES($1,$2,'2026-05',100,'dest_admin','canceled')",
      [randomUUID(), owner.tenantId],
    ),
  );
  let r = await request(admin(other.tenantId), "GET", undefined, op1.cookie);
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().payouts.length, 0);
  r = await request(admin(owner.tenantId), "GET", undefined, op1.cookie);
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().payouts.length, 1);
  const inspected = await db.tenant(a, (tx) =>
    tx.query(
      "SELECT actor_id FROM events WHERE name='finance.workspace_inspected'",
    ),
  );
  assert.deepEqual(
    inspected.map((e) => e.actor_id),
    [op1.userId],
  );

  // Settlements: arithmetic validation, one journal per provider payout.
  await db.tenant(a, (tx) =>
    recordCharge(tx, a, "stripe-invoice:in_admin_fixture", 10000, 1),
  );
  const settlement = {
    stripePayoutId: "po_admin_fixture",
    bankReference: "BANK-SETTLE-01",
    grossMinor: 10000,
    feeMinor: 300,
    netMinor: 9700,
    evidenceReference: "Stripe payout report fixture",
  };
  r = await request(
    admin(owner.tenantId, "/settlements"),
    "POST",
    { ...settlement, netMinor: 9000 },
    op1.cookie,
  );
  assert.equal(r.statusCode, 400, r.body);
  const posted = await request(
    admin(owner.tenantId, "/settlements"),
    "POST",
    settlement,
    op1.cookie,
  );
  assert.equal(posted.statusCode, 200, posted.body);
  r = await request(
    admin(owner.tenantId, "/settlements"),
    "POST",
    settlement,
    op1.cookie,
  );
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().id, posted.json().id);
  r = await request(
    admin(owner.tenantId, "/settlements"),
    "POST",
    { ...settlement, bankReference: "BANK-SETTLE-02" },
    op1.cookie,
  );
  assert.equal(r.statusCode, 409, r.body);
  assert.equal(
    (
      await db.tenant(a, (tx) =>
        tx.query(
          "SELECT id FROM journals WHERE source_key='stripe-settlement:po_admin_fixture'",
        ),
      )
    ).length,
    1,
  );

  // Usage statements: exact conversion, and a replay returns the same statement.
  await db.tenant(a, (tx) =>
    tx.query(
      "INSERT INTO cost_events(id,tenant_id,task,provider,cost_usd,status,created_at) VALUES($1,$2,'coaching','fixture',1.5,'recorded','2026-06-15T10:00:00Z')",
      [randomUUID(), owner.tenantId],
    ),
  );
  const usage = {
    period: "2026-06",
    fxAedPerUsd: 3.6725,
    chargeMinor: 551,
    feeScheduleVersion: "fixture-v1",
    evidenceReference: "Provider invoice fixture",
  };
  r = await request(
    admin(owner.tenantId, "/usage-statements"),
    "POST",
    { ...usage, chargeMinor: 999 },
    op1.cookie,
  );
  assert.equal(r.statusCode, 400, r.body);
  const statement = await request(
    admin(owner.tenantId, "/usage-statements"),
    "POST",
    usage,
    op1.cookie,
  );
  assert.equal(statement.statusCode, 200, statement.body);
  r = await request(
    admin(owner.tenantId, "/usage-statements"),
    "POST",
    usage,
    op1.cookie,
  );
  assert.equal(r.json().id, statement.json().id);

  // Exceptions: an open exception blocks close; resolution is recorded once.
  const opened = await request(
    admin(owner.tenantId, "/exceptions"),
    "POST",
    {
      description: "Bank line without a matching settlement",
      externalReference: "BANK-LINE-77",
    },
    op1.cookie,
  );
  assert.equal(opened.statusCode, 200, opened.body);
  const close = { period: "2026-06", evidenceReference: "June close review" };
  r = await request(admin(owner.tenantId, "/close"), "POST", close, op1.cookie);
  assert.equal(r.statusCode, 409, r.body);
  const resolve = (id: string) =>
    request(
      admin(owner.tenantId, `/exceptions/${id}/resolve`),
      "POST",
      { evidenceReference: "Matched to settlement po_admin_fixture" },
      op2.cookie,
    );
  assert.equal((await resolve(opened.json().id)).statusCode, 200);
  r = await resolve(opened.json().id);
  assert.equal(r.statusCode, 409, r.body);
  assert.equal(r.json().code, "EXCEPTION_RESOLVED");
  const [exception] = await db.tenant(a, (tx) =>
    tx.query("SELECT data FROM records WHERE id=$1", [opened.json().id]),
  );
  assert.equal(exception.data.resolvedBy, op2.userId);
  assert.equal((await resolve(randomUUID())).statusCode, 404);
  assert.equal((await resolve("not-a-uuid")).statusCode, 400);

  const closed = await request(
    admin(owner.tenantId, "/close"),
    "POST",
    close,
    op1.cookie,
  );
  assert.equal(closed.statusCode, 200, closed.body);
  r = await request(admin(owner.tenantId, "/close"), "POST", close, op2.cookie);
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().id, closed.json().id);
  r = await request(
    admin(owner.tenantId, "/close"),
    "POST",
    { period: "2026-13", evidenceReference: "Invalid period fixture" },
    op1.cookie,
  );
  assert.equal(r.statusCode, 400, r.body);
});

// Runs last: it persists a Lean settings row that overrides the environment.
test("an endpoint-only Lean check never activates payouts without recorded contract verification", async () => {
  process.env.SECURITY_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  const probes: string[] = [];
  const settings = Fastify({ logger: false });
  settings.setErrorHandler(
    (error: any, _request: FastifyRequest, reply: FastifyReply) =>
      reply
        .code(error.statusCode ?? 500)
        .send({ code: error.code, message: error.message }),
  );
  platformSettingsRoutes(
    settings,
    db,
    () => ({
      userId: op1.userId,
      tenantId: op1.tenantId,
      role: "owner",
      platformRole: "admin",
      mfaAt: new Date().toISOString(),
    }),
    {
      testIntegration: async (id) => {
        probes.push(id);
        return {
          status: "validated",
          message: "Public endpoint validated only",
          checkedAt: new Date().toISOString(),
        };
      },
    },
  );
  const call = (path: string, method: "GET" | "PUT" | "POST", body?: any) =>
    settings.inject({
      url: "/api/v1/admin/settings" + path,
      method,
      payload: body,
    });
  const lean = async () =>
    (await call("", "GET"))
      .json()
      .integrations.find((x: any) => x.id === "lean");
  try {
    let r = await call("/lean", "PUT", {
      revision: (await lean()).revision,
      enabled: true,
      values: {
        LEAN_BASE_URL: LEAN,
        LEAN_CONTRACT_VERIFIED: "false",
        PAYOUTS_APPROVED: "true",
      },
      secrets: {
        LEAN_ACCESS_TOKEN: "synthetic-settings-token",
        LEAN_SOURCE_ACCOUNT_ID: "synthetic-settings-account",
      },
    });
    assert.equal(r.statusCode, 200, r.body);
    r = await call("/lean/test", "POST", { revision: (await lean()).revision });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().active, false);
    assert.notEqual(r.json().lastTest.status, "validated");
    assert.deepEqual(probes, []);
    let runtime = await loadRuntimeSettings(db);
    assert.equal(runtime.PAYOUTS_APPROVED, "false");
    assert.equal(runtime.LEAN_ACCESS_TOKEN, "");
    withRuntimeConfig(runtime, () =>
      assert.equal(
        integrationStatus().find((x) => x.id === "lean")?.approved,
        false,
      ),
    );

    r = await call("/lean", "PUT", {
      revision: (await lean()).revision,
      enabled: true,
      values: { LEAN_CONTRACT_VERIFIED: "true" },
    });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().active, false);
    r = await call("/lean/test", "POST", { revision: (await lean()).revision });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().active, true);
    assert.deepEqual(probes, ["lean"]);
    runtime = await loadRuntimeSettings(db);
    assert.equal(runtime.PAYOUTS_APPROVED, "true");
    withRuntimeConfig(runtime, () =>
      assert.equal(
        integrationStatus().find((x) => x.id === "lean")?.approved,
        true,
      ),
    );
  } finally {
    await settings.close();
  }
});
