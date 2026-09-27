import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { createDatabase, type Database, type Actor } from "@trainer/db";
import {
  registerAffiliates,
  pendingAffiliateClawbacks,
} from "../apps/api/src/affiliates.ts";
import { requireRecentMfa } from "../apps/api/src/security.ts";
import { financeSummary } from "../apps/api/src/finance.ts";
import { settlementBlockers } from "../apps/api/src/privacy-lifecycle.ts";
let db: Database, contract: any, receipt: any, statement: any;
const app = Fastify(),
  operator = randomUUID(),
  tenant = randomUUID(),
  foreign = randomUUID();
const owner: Actor = { tenantId: tenant, userId: randomUUID(), role: "owner" };
const finance: Actor = { tenantId: tenant, userId: operator, role: "finance" };
before(async () => {
  db = await createDatabase({ memory: true });
  await db.system(async (tx) => {
    for (const id of [tenant, foreign])
      await tx.query(
        "INSERT INTO tenants(id,slug,name) VALUES($1::uuid,$1::text,'Fixture')",
        [id],
      );
    for (const [id, role] of [
      [operator, "admin"],
      [owner.userId, "none"],
    ])
      await tx.query(
        "INSERT INTO users(id,email,name,password_hash,platform_role) VALUES($1,$2,'Fixture','unused',$3)",
        [id, id + "@example.test", role],
      );
    await tx.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')",
      [tenant, owner.userId],
    );
  });
  app.setErrorHandler((e: any, _req, reply) =>
    reply
      .code(e.statusCode ?? (e.name === "ZodError" ? 400 : 500))
      .send({ message: e.message, code: e.code }),
  );
  registerAffiliates(app, db, (req) =>
    req.headers["x-owner"]
      ? { ...owner, platformRole: "none" }
      : {
          ...finance,
          platformRole: String(req.headers["x-role"] ?? "admin"),
          mfaAt: String(req.headers["x-mfa"] ?? new Date().toISOString()),
        },
  );
});
after(async () => {
  await app.close();
  await db.close();
});
const request = (
  path = "",
  body?: any,
  headers: Record<string, string> = {},
  tenantId = tenant,
) =>
  app.inject({
    url: `/api/v1/admin/tenants/${tenantId}/affiliates` + path,
    method: body ? "POST" : "GET",
    payload: body,
    headers,
  });
const current = () => db.tenant(owner, financeSummary);
const terms = {
  provider: "Approved provider",
  revision: 0,
  enabled: true,
  termsReference: "Approved provider contract v1",
  disclosure: "We may receive commission on eligible purchases.",
  trainerShareBps: 8000,
  providerPermissionConfirmed: true,
  reason: "Owner approved affiliate launch terms",
};

test("finance controls require current platform role/MFA and contract revisions", async () => {
  assert.equal(
    (await request("", undefined, { "x-role": "support" })).statusCode,
    403,
  );
  assert.equal(
    (await request("", undefined, { "x-mfa": "invalid" })).statusCode,
    403,
  );
  assert.equal(
    (
      await request("/contracts", {
        ...terms,
        providerPermissionConfirmed: false,
      })
    ).statusCode,
    400,
  );
  let r = await request("/contracts", terms);
  assert.equal(r.statusCode, 200, r.body);
  contract = r.json();
  assert.equal((await request("/contracts", terms)).statusCode, 409);
  assert.equal(
    (await request("/contracts", { ...terms, revision: 1, enabled: false }))
      .statusCode,
    200,
  );
  r = await request("/contracts", { ...terms, revision: 2 });
  assert.equal(r.statusCode, 200, r.body);
  contract = r.json();
});
test("aggregate receipts are idempotent, policy-pinned and isolated with no spendable earnings before collection", async () => {
  const body = {
    requestId: randomUUID(),
    contractId: contract.id,
    revision: contract.revision,
    providerReference: "provider-2026-08",
    period: "2026-08",
    amountMinor: 10001,
    evidenceReference: "Verified aggregate August provider statement",
  };
  let r = await request("/receipts", body);
  assert.equal(r.statusCode, 200, r.body);
  receipt = r.json();
  assert.equal(Number(receipt.trainer_minor), 8001);
  assert.equal((await request("/receipts", body)).json().id, receipt.id);
  assert.equal(
    (await request("/receipts", { ...body, amountMinor: 10002 })).statusCode,
    409,
  );
  assert.equal(
    (await request("/receipts", { ...body, requestId: randomUUID() }))
      .statusCode,
    409,
  );
  assert.equal(
    (
      await request(
        "/receipts",
        {
          ...body,
          requestId: randomUUID(),
          providerReference: "another-provider-ref",
        },
        {},
        foreign,
      )
    ).statusCode,
    409,
  );
  assert.equal((await current()).earnedMinor, 0);
  assert.equal(
    (
      await db.tenant({ ...owner, tenantId: foreign }, (tx) =>
        tx.query("SELECT * FROM affiliate_receipts"),
      )
    ).length,
    0,
  );
  assert.equal(
    (
      await db.tenant({ ...owner, role: "staff" }, (tx) =>
        tx.query("SELECT * FROM affiliate_receipts"),
      )
    ).length,
    0,
  );
  await assert.rejects(
    db.tenant(finance, (tx) =>
      tx.query("UPDATE affiliate_receipts SET amount_minor=1 WHERE id=$1", [
        receipt.id,
      ]),
    ),
    /permission denied|immutable/,
  );
  assert.ok(
    (await db.tenant(owner, (tx) => settlementBlockers(tx))).some(
      (b) => b.kind === "affiliate",
    ),
  );
});
test("closed statements preserve receipts and exact bank evidence posts one balanced ledger movement", async () => {
  const close = { contractId: contract.id, period: "2026-08" };
  let r = await request("/statements", close);
  assert.equal(r.statusCode, 200, r.body);
  statement = r.json();
  assert.equal((await request("/statements", close)).json().id, statement.id);
  const settle = {
    amountMinor: 10001,
    bankReference: "bank-credit-2026-08",
    evidenceReference: "Verified company bank credit statement",
  };
  assert.equal(
    (
      await request(`/statements/${statement.id}/settle`, {
        ...settle,
        amountMinor: 10000,
      })
    ).statusCode,
    409,
  );
  r = await request(`/statements/${statement.id}/settle`, settle);
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(
    (await request(`/statements/${statement.id}/settle`, settle)).json().id,
    r.json().id,
  );
  assert.equal(
    (
      await request(`/statements/${statement.id}/settle`, {
        ...settle,
        bankReference: "different-bank-ref",
      })
    ).statusCode,
    409,
  );
  const summary = await current();
  assert.equal(summary.earnedMinor, 8001);
  assert.equal(summary.accounts.bank_cash, 10001);
  assert.equal(summary.commissionMinor, 2000);
  assert.equal(
    (await db.tenant(owner, (tx) => settlementBlockers(tx))).filter(
      (b) => b.kind === "affiliate",
    ).length,
    0,
  );
  const ledger = await db.tenant(owner, (tx) =>
    tx.query("SELECT sum(amount_minor)::text total FROM journal_lines"),
  );
  assert.equal(Number(ledger[0].total), 0);
});
test("post-settlement reversals hold payout eligibility until verified signed bank reconciliation", async () => {
  const reversal = {
    requestId: randomUUID(),
    period: "2026-09",
    providerReference: "returned-provider-august",
    evidenceReference: "Confirmed full provider clawback notice",
  };
  let r = await request(`/receipts/${receipt.id}/reverse`, reversal);
  assert.equal(r.statusCode, 200, r.body);
  const reverse = r.json();
  assert.equal(
    (await request(`/receipts/${receipt.id}/reverse`, reversal)).json().id,
    reverse.id,
  );
  assert.equal(
    (
      await request(`/receipts/${receipt.id}/reverse`, {
        ...reversal,
        requestId: randomUUID(),
      })
    ).statusCode,
    409,
  );
  assert.equal(await db.tenant(finance, pendingAffiliateClawbacks), true);
  r = await request("/statements", {
    contractId: contract.id,
    period: "2026-09",
  });
  assert.equal(r.statusCode, 200, r.body);
  const corrected = r.json();
  assert.equal(Number(corrected.amount_minor), -10001);
  r = await request(`/statements/${corrected.id}/settle`, {
    amountMinor: -10001,
    bankReference: "bank-debit-returned-august",
    evidenceReference: "Verified bank debit reversing provider payment",
  });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(await db.tenant(finance, pendingAffiliateClawbacks), false);
  const summary = await current();
  assert.equal(summary.earnedMinor, 0);
  assert.equal(summary.accounts.bank_cash, 0);
});
test("owner statements are readable; revoked operator role blocks new actions despite stale session claims", async () => {
  const r = await app.inject({
    url: "/api/v1/affiliates",
    headers: { "x-owner": "true" },
  });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().statements.length, 2);
  await db.system((tx) =>
    tx.query("UPDATE users SET platform_role='support' WHERE id=$1", [
      operator,
    ]),
  );
  assert.equal((await request()).statusCode, 403);
});

test("MFA rejects invalid, stale and future timestamps", () => {
  for (const mfaAt of [
    undefined,
    "invalid",
    new Date(Date.now() - 700000).toISOString(),
    new Date(Date.now() + 60000).toISOString(),
  ])
    assert.throws(() => requireRecentMfa({ mfaAt }, true), /authenticator/);
  assert.doesNotThrow(() =>
    requireRecentMfa({ mfaAt: new Date().toISOString() }, true),
  );
});
