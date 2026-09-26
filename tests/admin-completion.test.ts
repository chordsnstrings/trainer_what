import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { createDatabase, event, putRecord, type Database } from "@trainer/db";
import {
  registerAdminOperations,
  getPublishedDocument,
  consentedAcquisition,
  recordAcquisition,
} from "../apps/api/src/admin-operations.ts";
let db: Database;
const app = Fastify();
const a = { tenantId: randomUUID(), userId: randomUUID(), role: "owner" };
const other = { tenantId: randomUUID(), userId: randomUUID(), role: "owner" };
before(async () => {
  db = await createDatabase({ memory: true });
  await db.system(async (tx) => {
    for (const owner of [a, other]) {
      await tx.query(
        "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Fixture','unused')",
        [owner.userId, owner.userId + "@example.test"],
      );
      await tx.query("INSERT INTO tenants(id,slug,name) VALUES($1,$2,$3)", [
        owner.tenantId,
        owner.tenantId,
        "Workspace " + owner.tenantId,
      ]);
      await tx.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')", [
        owner.tenantId,
        owner.userId,
      ]);
    }
  });
  app.setErrorHandler((e: any, _req, reply) =>
    reply
      .code(e.statusCode ?? (e.name === "ZodError" ? 400 : 500))
      .send({ code: e.code, message: e.message }),
  );
  registerAdminOperations(app, db, (req) => ({
    ...a,
    platformRole: String(req.headers["x-role"] ?? "admin"),
    mfaAt: req.headers["x-stale"] ? null : new Date().toISOString(),
  }));
});
after(async () => {
  await app.close();
  await db.close();
});
const req = (
  url: string,
  method: any = "GET",
  payload?: any,
  headers: any = {},
) => app.inject({ url: "/api/v1" + url, method, payload, headers });
test("operator scopes and recent MFA gate sensitive reads", async () => {
  assert.equal(
    (
      await req("/admin/operations/finops", "GET", undefined, {
        "x-role": "support",
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await req("/admin/operations/security", "GET", undefined, {
        "x-stale": "yes",
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await req("/admin/operations/support", "GET", undefined, {
        "x-role": "none",
      })
    ).statusCode,
    403,
  );
});
test("effective legal publication preserves old acceptance and immutable history", async () => {
  const key = "terms";
  const created = await req("/admin/documents", "POST", {
    kind: "legal",
    key,
    title: "Reviewed terms",
    content: "Reviewed terms first version fixture.",
  });
  assert.equal(created.statusCode, 200, created.body);
  const draft = created.json();
  assert.equal(await getPublishedDocument(db, "legal", key), null);
  const publish = await req(`/admin/documents/${draft.id}/publish`, "POST", {
    revision: 1,
    effectiveAt: new Date().toISOString(),
    reason: "Approved in fixture review",
  });
  assert.equal(publish.statusCode, 200, publish.body);
  assert.equal(
    (await getPublishedDocument(db, "legal", key))?.version,
    draft.version,
  );
  assert.equal(
    (
      await req(`/admin/documents/${draft.id}/publish`, "POST", {
        revision: 1,
        effectiveAt: new Date().toISOString(),
        reason: "Approved in fixture review",
      })
    ).statusCode,
    409,
  );
  const next = await req("/admin/documents", "POST", {
    kind: "legal",
    key,
    title: "Next terms",
    content: "Reviewed terms future version fixture.",
  });
  assert.equal(next.statusCode, 200, next.body);
  await req(`/admin/documents/${next.json().id}/publish`, "POST", {
    revision: 1,
    effectiveAt: new Date(Date.now() + 86400000).toISOString(),
    reason: "Approved future version fixture",
  });
  assert.equal(
    (await getPublishedDocument(db, "legal", key))?.version,
    draft.version,
  );
  const publicDoc = await req("/public/documents/terms");
  assert.equal(publicDoc.statusCode, 200, publicDoc.body);
  assert.equal(publicDoc.json().versions.length, 1);
  await assert.rejects(
    db.system((tx) =>
      tx.query("UPDATE admin_documents SET content='tampered' WHERE id=$1", [
        draft.id,
      ]),
    ),
    /immutable/,
  );
  await assert.rejects(
    db.tenant(a, (tx) => tx.query("SELECT * FROM admin_documents")),
    /permission denied/,
  );
});
test("support reads and CAS replies are isolated by selected tenant", async () => {
  const r = await db.tenant(a, (tx) =>
    putRecord(
      tx,
      a,
      "support",
      { subject: "Tenant A support", category: "account", messages: [] },
      { status: "open" },
    ),
  );
  const hidden = await db.tenant(other, (tx) =>
    putRecord(
      tx,
      other,
      "support",
      { subject: "Tenant B private", category: "billing", messages: [] },
      { status: "open" },
    ),
  );
  const list = await req(
    `/admin/operations/support?tenantId=${a.tenantId}`,
    "GET",
    undefined,
    { "x-role": "support" },
  );
  assert.equal(list.statusCode, 200, list.body);
  assert.deepEqual(
    list.json().rows.map((x: any) => x.id),
    [r.id],
  );
  const body = {
    revision: r.version,
    message: "Operator response fixture",
    resolve: true,
  };
  const reply = await req(
    `/admin/tenants/${a.tenantId}/support/${r.id}/reply`,
    "POST",
    body,
    { "x-role": "support" },
  );
  assert.equal(reply.statusCode, 200, reply.body);
  assert.equal(reply.json().version, r.version + 1);
  assert.equal(
    (
      await req(
        `/admin/tenants/${a.tenantId}/support/${r.id}/reply`,
        "POST",
        body,
      )
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await req(
        `/admin/tenants/${a.tenantId}/support/${hidden.id}/reply`,
        "POST",
        body,
      )
    ).statusCode,
    404,
  );
  const audits = await db.system((tx) =>
    tx.query(
      "SELECT action,data FROM admin_operations_audit WHERE action='support.reply' AND tenant_id=$1",
      [a.tenantId],
    ),
  );
  assert.equal(audits.length, 1);
  assert.equal(JSON.stringify(audits).includes(body.message), false);
});
test("safety review does not release a training hold", async () => {
  const r = await db.tenant(a, (tx) =>
    putRecord(
      tx,
      a,
      "exception",
      { category: "pain", reason: "Fixture hold" },
      { status: "open" },
    ),
  );
  const reviewed = await req(
    `/admin/tenants/${a.tenantId}/safety/${r.id}/review`,
    "POST",
    {
      revision: r.version,
      note: "Escalated to qualified coach fixture",
      priority: "urgent",
    },
    { "x-role": "safety" },
  );
  assert.equal(reviewed.statusCode, 200, reviewed.body);
  assert.equal(reviewed.json().status, "open");
});
test("email recovery excludes money jobs, active leases and stale attempts", async () => {
  const email = randomUUID(),
    money = randomUUID(),
    leased = randomUUID();
  await db.tenant(a, async (tx) => {
    for (const [id, kind, lease] of [
      [email, "email", null],
      [money, "payout", null],
      [leased, "email", new Date(Date.now() + 60000).toISOString()],
    ])
      await tx.query(
        "INSERT INTO jobs(id,tenant_id,kind,intent_key,data,status,attempts,leased_until) VALUES($1::uuid,$2,$3,$1::uuid::text,'{}','blocked',2,$4)",
        [id, a.tenantId, kind, lease],
      );
  });
  const body = {
    attempts: 2,
    outcome: "not_sent",
    evidenceReference: "Provider confirms no delivery fixture",
  };
  for (const id of [money, leased])
    assert.equal(
      (
        await req(
          `/admin/tenants/${a.tenantId}/email-jobs/${id}/reconcile`,
          "POST",
          body,
        )
      ).statusCode,
      409,
    );
  const ok = await req(
    `/admin/tenants/${a.tenantId}/email-jobs/${email}/reconcile`,
    "POST",
    body,
  );
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(ok.json().status, "pending");
  assert.equal(
    (
      await req(
        `/admin/tenants/${a.tenantId}/email-jobs/${email}/reconcile`,
        "POST",
        body,
      )
    ).statusCode,
    409,
  );
});
test("consented acquisition has no arbitrary traits and erasure requires explicit context", async () => {
  const visitorId = randomUUID();
  assert.equal(
    consentedAcquisition(
      JSON.stringify({ consent: false, visitorId, source: "site" }),
    ),
    null,
  );
  assert.equal(
    consentedAcquisition(
      JSON.stringify({
        consent: true,
        visitorId,
        source: "site",
        condition: "private",
      }),
    ),
    null,
  );
  assert.ok(
    consentedAcquisition(
      JSON.stringify({ consent: true, visitorId, source: "site" }),
    ),
  );
  const eventKey = randomUUID();
  await recordAcquisition(db, {
    eventKey,
    name: "signup",
    tenantId: a.tenantId,
    userId: a.userId,
    visitorId,
    source: "site",
  });
  await recordAcquisition(db, {
    eventKey,
    name: "signup",
    tenantId: a.tenantId,
    userId: a.userId,
    visitorId,
    source: "site",
  });
  assert.equal(
    (
      await db.system((tx) =>
        tx.query("SELECT id FROM acquisition_events WHERE event_key=$1", [
          eventKey,
        ]),
      )
    ).length,
    1,
  );
  await assert.rejects(
    db.system((tx) =>
      tx.query("DELETE FROM acquisition_events WHERE event_key=$1", [eventKey]),
    ),
    /erasure/,
  );
  await db.system(async (tx) => {
    await tx.query("SELECT set_config('app.privacy_erasure','true',true)");
    await tx.query("DELETE FROM acquisition_events WHERE event_key=$1", [
      eventKey,
    ]);
  });
});
test("experiments guardrail and CAS transitions prevent accidental restarts", async () => {
  const created = await req("/admin/experiments", "POST", {
    key: "test-" + randomUUID(),
    title: "Fixture copy",
    surface: "landing",
    allocation: 25,
    variantA: "Start teaching",
    variantB: "Build your coaching app",
    metric: "signup",
    guardrail: "Stop on any consent regression.",
  });
  assert.equal(created.statusCode, 200, created.body);
  const id = created.json().id;
  assert.equal(
    (
      await req(`/admin/experiments/${id}/transition`, "POST", {
        revision: 1,
        status: "completed",
        result: "Should not complete a draft",
      })
    ).statusCode,
    409,
  );
  const start = await req(`/admin/experiments/${id}/transition`, "POST", {
    revision: 1,
    status: "running",
    result: "Approved reviewed copy fixture",
  });
  assert.equal(start.statusCode, 200, start.body);
  assert.equal(
    (
      await req(`/admin/experiments/${id}/transition`, "POST", {
        revision: 1,
        status: "stopped",
        result: "Stale stop must not apply",
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await req(`/admin/experiments/${id}/transition`, "POST", {
        revision: 2,
        status: "stopped",
        result: "Guardrail triggered in fixture",
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await req(`/admin/experiments/${id}/transition`, "POST", {
        revision: 3,
        status: "running",
        result: "Must not silently restart",
      })
    ).statusCode,
    409,
  );
});
