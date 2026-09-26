import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { z } from "zod";
import {
  createDatabase,
  putRecord,
  type Database,
  type Actor,
} from "@trainer/db";
import { passwordHash } from "../apps/api/src/auth.ts";
import {
  exportPersonalData,
  registerPrivacyLifecycle,
} from "../apps/api/src/privacy-lifecycle.ts";
import { privacyOperations } from "../apps/api/src/privacy-operations.ts";
import { privacyHooks } from "../apps/api/src/privacy-hooks.ts";
import { journal } from "../apps/api/src/finance.ts";
let db: Database, app: ReturnType<typeof Fastify>;
const password = "FixturePrivacyOnly2026!",
  origin = "http://localhost:3000";
let hash: string;
const identities = new Map<string, any>();
async function person(
  tenantId: string,
  role = "subscriber",
  platformRole = "none",
) {
  const userId = randomUUID(),
    id = {
      tenantId,
      userId,
      role,
      platformRole,
      mfaAt: new Date().toISOString() as string | null,
    };
  await db.system(async (tx) => {
    await tx.query(
      "INSERT INTO users(id,name,email,password_hash,email_verified,platform_role) VALUES($1,$2,$3,$4,true,$5)",
      [
        userId,
        "Synthetic " + role,
        userId + "@example.test",
        hash,
        platformRole,
      ],
    );
    await tx.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)",
      [tenantId, userId, role],
    );
  });
  identities.set(userId, id);
  return id;
}
async function tenant() {
  const tenantId = randomUUID();
  await db.system((tx) =>
    tx.query("INSERT INTO tenants(id,slug,name) VALUES($1,$2,$3)", [
      tenantId,
      "test-" + tenantId,
      "Synthetic workspace",
    ]),
  );
  const owner = await person(tenantId, "owner");
  return owner;
}
function req(a: any, path: string, body?: unknown) {
  return app.inject({
    method: body ? "POST" : "GET",
    url: "/api/v1" + path,
    headers: { origin, "x-test-user": a.userId },
    payload: body,
  });
}
function proof(expectedRevision = 1) {
  return {
    expectedRevision,
    providerReviewComplete: true,
    thirdPartySourceReviewComplete: true,
    evidenceReference: "Synthetic provider inventory review 123",
    retentionPolicyVersion: "fixture-v1",
    backupPurgeBy: new Date(Date.now() + 86400000).toISOString(),
    providers: [
      {
        name: "Synthetic model provider",
        dueAt: new Date(Date.now() + 86400000).toISOString(),
      },
    ],
  };
}
async function deletion(a: Actor) {
  return db.tenant(a, (tx) =>
    putRecord(
      tx,
      a,
      "privacy_request",
      { type: "deletion", requestedAt: new Date().toISOString() },
      { status: "pending_review" },
    ),
  );
}
before(async () => {
  hash = await passwordHash(password);
  db = await createDatabase({ memory: true });
  app = Fastify();
  await app.register(cookie);
  app.setErrorHandler((error: Error, req: any, reply: any) => {
    const e = error as any;
    reply
      .code(
        error instanceof z.ZodError
          ? 400
          : e.code === "23505"
            ? 409
            : (e.statusCode ?? 500),
      )
      .send({ code: e.code, message: e.message });
  });
  const identity = (r: any) => {
    const a = identities.get(r.headers["x-test-user"]);
    if (!a) throw Object.assign(new Error("No identity"), { statusCode: 401 });
    return a;
  };
  registerPrivacyLifecycle(app, db, identity, privacyHooks);
  privacyOperations(app, db, identity, privacyHooks);
  await app.ready();
});
after(async () => {
  await app.close();
  await db.close();
});

test("export includes private derived decisions and bookings, excluding another user and workspace", async () => {
  const a = await tenant(),
    client = await person(a.tenantId),
    other = await person(a.tenantId),
    b = await tenant();
  const own = await db.tenant(a, (tx) =>
    putRecord(
      tx,
      a,
      "decision",
      { private: "own derived reasoning" },
      { ownerId: client.userId, status: "held" },
    ),
  );
  await db.tenant(a, (tx) =>
    putRecord(
      tx,
      a,
      "decision",
      { private: "other client secret" },
      { ownerId: other.userId },
    ),
  );
  await db.tenant(b, (tx) =>
    putRecord(
      tx,
      b,
      "decision",
      { private: "other workspace secret" },
      { ownerId: client.userId },
    ),
  );
  const visible = await db.tenant(client, (tx) =>
    tx.query("SELECT id FROM records WHERE id=$1", [own.id]),
  );
  assert.equal(visible.length, 0);
  for (const [owner, target, title] of [
    [a, client, "Your notification"],
    [a, other, "Another member notification"],
    [b, client, "Another workspace notification"],
  ] as const)
    await db.tenant(owner, async (tx) => {
      await tx.query(
        "INSERT INTO notifications(id,tenant_id,user_id,category,dedupe_key,title,body) VALUES($1,$2,$3,'account','export-fixture',$4,'Private account message')",
        [randomUUID(), owner.tenantId, target.userId, title],
      );
      await tx.query(
        "INSERT INTO notification_preferences(tenant_id,user_id,data) VALUES($1,$2,'{\"marketing\":false}')",
        [owner.tenantId, target.userId],
      );
    });
  const out = await exportPersonalData(db, client, privacyHooks);
  assert.equal(out.records.length, 1);
  assert.equal(out.records[0].id, own.id);
  assert.equal((out as any).notifications.length, 1);
  assert.equal((out as any).notifications[0].title, "Your notification");
  assert.equal((out as any).notificationPreferences.length, 1);
  assert.doesNotMatch(
    JSON.stringify(out),
    /other client secret|other workspace secret|Another member notification|Another workspace notification|password_hash|token_hash/,
  );
});

test("erasure requires fresh administrator MFA and a current request revision", async () => {
  const a = await tenant(),
    client = await person(a.tenantId),
    admin = await person(a.tenantId, "staff", "admin"),
    r = await deletion(client),
    path = `/admin/tenants/${a.tenantId}/privacy/${r.id}/erase`;
  assert.equal((await req(a, path, proof())).statusCode, 403);
  admin.mfaAt = null;
  assert.equal((await req(admin, path, proof())).statusCode, 403);
  admin.mfaAt = new Date().toISOString();
  const stale = await req(admin, path, proof(9));
  assert.equal(stale.statusCode, 409, stale.body);
  const foreign = await tenant();
  assert.equal(
    (
      await req(
        admin,
        `/admin/tenants/${foreign.tenantId}/privacy/${r.id}/erase`,
        proof(),
      )
    ).statusCode,
    404,
  );
});

test("local erasure removes all derived personal records and preserves finance and another membership", async () => {
  const a = await tenant(),
    b = await tenant(),
    client = await person(a.tenantId),
    admin = await person(a.tenantId, "staff", "admin");
  await db.system(async (tx) => {
    await tx.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'subscriber')",
      [b.tenantId, client.userId],
    );
    await tx.query(
      "INSERT INTO sessions(token_hash,user_id,tenant_id,expires_at) VALUES($1,$2,$3,now()+interval '1 day')",
      [randomUUID(), client.userId, b.tenantId],
    );
  });
  const r = await deletion(client);
  for (const [owner, target] of [
    [a, client],
    [a, admin],
    [b, client],
  ])
    await db.tenant(owner, async (tx) => {
      await tx.query(
        "INSERT INTO notifications(id,tenant_id,user_id,category,dedupe_key,title,body) VALUES($1,$2,$3,'account','erasure-fixture','Account notice','Private account message')",
        [randomUUID(), owner.tenantId, target.userId],
      );
      await tx.query(
        "INSERT INTO notification_preferences(tenant_id,user_id,data) VALUES($1,$2,'{\"marketing\":false}')",
        [owner.tenantId, target.userId],
      );
    });
  await db.tenant(a, async (tx) => {
    for (const kind of [
      "intake",
      "nutrition_target",
      "nutrition_favorite",
      "nutrition_request",
      "guided_session",
    ])
      await putRecord(
        tx,
        a,
        kind,
        { sensitive: "personal" },
        { ownerId: client.userId },
      );
    await putRecord(
      tx,
      a,
      "decision",
      { userId: client.userId, sensitive: "linked personal" },
      { ownerId: a.userId },
    );
    await putRecord(
      tx,
      a,
      "refund",
      { reason: "personal reason", chargeId: randomUUID() },
      { ownerId: client.userId, status: "succeeded" },
    );
    await journal(tx, a, "privacy-retained-charge", "Retained evidence", [
      { account: "cash", amount: 100 },
      { account: "platform_revenue", amount: -100 },
    ]);
  });
  const response = await req(
    admin,
    `/admin/tenants/${a.tenantId}/privacy/${r.id}/erase`,
    proof(),
  );
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().externalStatus, "followups_pending");
  await db.tenant(a, async (tx) => {
    const rows = await tx.query(
      "SELECT kind,data FROM records WHERE owner_user_id=$1 OR data->>'userId'=$1::text",
      [client.userId],
    );
    assert.deepEqual(rows.map((x) => x.kind).sort(), [
      "privacy_request",
      "refund",
    ]);
    assert.equal(rows.find((x) => x.kind === "refund")?.data.reason, undefined);
    assert.equal((await tx.query("SELECT * FROM journals")).length, 1);
    const tasks = await tx.query("SELECT status FROM privacy_followups");
    assert.equal(tasks.length, 3);
    assert.ok(tasks.every((x) => x.status === "pending"));
  });
  const [u] = await db.system((tx) =>
    tx.query("SELECT email FROM users WHERE id=$1", [client.userId]),
  );
  assert.equal(u.email, client.userId + "@example.test");
  const sessions = await db.system((tx) =>
    tx.query("SELECT tenant_id FROM sessions WHERE user_id=$1", [
      client.userId,
    ]),
  );
  assert.equal(sessions[0].tenant_id, b.tenantId);
  await db.tenant(a, async (tx) => {
    const notices = await tx.query("SELECT user_id FROM notifications");
    assert.deepEqual(
      notices.map((n) => n.user_id),
      [admin.userId],
    );
    const preferences = await tx.query(
      "SELECT user_id FROM notification_preferences",
    );
    assert.deepEqual(
      preferences.map((n) => n.user_id),
      [admin.userId],
    );
  });
  await db.tenant(b, async (tx) => {
    assert.equal(
      (
        await tx.query("SELECT * FROM notifications WHERE user_id=$1", [
          client.userId,
        ])
      ).length,
      1,
    );
    assert.equal(
      (
        await tx.query(
          "SELECT * FROM notification_preferences WHERE user_id=$1",
          [client.userId],
        )
      ).length,
      1,
    );
  });
});

test("erasure blocks subscriptions, unknown model charges and future booked sessions", async () => {
  const a = await tenant(),
    client = await person(a.tenantId),
    admin = await person(a.tenantId, "staff", "admin"),
    r = await deletion(client),
    path = `/admin/tenants/${a.tenantId}/privacy/${r.id}/erase`;
  await db.tenant(a, (tx) =>
    tx.query(
      "INSERT INTO subscriptions(id,tenant_id,user_id,status) VALUES($1,$2,$3,'active')",
      [randomUUID(), a.tenantId, client.userId],
    ),
  );
  const active = await req(admin, path, proof());
  assert.equal(active.json().code, "SUBSCRIPTION_OPEN");
  await db.tenant(a, async (tx) => {
    await tx.query(
      "UPDATE subscriptions SET status='canceled' WHERE user_id=$1",
      [client.userId],
    );
    await tx.query(
      "INSERT INTO cost_events(id,tenant_id,user_id,task,provider,status) VALUES($1,$2,$3,'coach','fixture','unknown')",
      [randomUUID(), a.tenantId, client.userId],
    );
  });
  const unknown = await req(admin, path, proof());
  assert.equal(unknown.json().code, "SETTLEMENT_REQUIRED", unknown.body);
  assert.match(unknown.json().message, /usage/);
  await db.tenant(a, async (tx) => {
    await tx.query(
      "UPDATE cost_events SET status='reconciled',cost_usd=0,reconciliation='{\"evidence\":\"synthetic provider no charge\"}' WHERE user_id=$1",
      [client.userId],
    );
    const slot = randomUUID();
    await tx.query(
      "INSERT INTO booking_slots(id,tenant_id,trainer_id,starts_at,ends_at,capacity,title,location) VALUES($1,$2,$3,now()+interval '1 day',now()+interval '25 hours',1,'Fixture','Online')",
      [slot, a.tenantId, a.userId],
    );
    await tx.query(
      "INSERT INTO bookings(id,tenant_id,slot_id,user_id) VALUES($1,$2,$3,$4)",
      [randomUUID(), a.tenantId, slot, client.userId],
    );
  });
  const booking = await req(admin, path, proof());
  assert.match(booking.json().message, /booking/, booking.body);
});

test("backup deadlines do not mark cleanup complete; evidence updates are CAS and tenant scoped", async () => {
  const a = await tenant(),
    client = await person(a.tenantId),
    admin = await person(a.tenantId, "staff", "admin"),
    r = await deletion(client);
  const erased = await req(
    admin,
    `/admin/tenants/${a.tenantId}/privacy/${r.id}/erase`,
    proof(),
  );
  assert.equal(erased.statusCode, 200, erased.body);
  const tasks = (
      await req(admin, `/admin/tenants/${a.tenantId}/privacy/followups`)
    ).json(),
    backup = tasks.find((t: any) => t.scope === "backup");
  await db.tenant(a, (tx) =>
    tx.query(
      "UPDATE privacy_followups SET due_at=now()-interval '1 day' WHERE id=$1",
      [backup.id],
    ),
  );
  const overdue = (
    await req(admin, `/admin/tenants/${a.tenantId}/privacy/followups`)
  )
    .json()
    .find((t: any) => t.id === backup.id);
  assert.equal(overdue.status, "pending");
  assert.equal(overdue.overdue, true);
  const path = `/admin/tenants/${a.tenantId}/privacy/followups/${backup.id}`,
    body = {
      expectedRevision: backup.revision,
      outcome: "completed",
      evidenceReference: "Synthetic actual purge log 123",
    };
  assert.equal((await req(admin, path, body)).statusCode, 200);
  assert.equal((await req(admin, path, body)).statusCode, 409);
  const registry = await db.system((tx) =>
    tx.query("SELECT * FROM privacy_erasure_registry WHERE request_id=$1", [
      r.id,
    ]),
  );
  assert.equal(registry.length, 1);
  await assert.rejects(
    db.system((tx) =>
      tx.query("DELETE FROM privacy_erasure_registry WHERE request_id=$1", [
        r.id,
      ]),
    ),
    /immutable/,
  );
});

test("ownership transfer requires two parties and exactly one current owner under concurrent acceptance", async () => {
  const a = await tenant(),
    staff = await person(a.tenantId, "staff"),
    foreign = await person(a.tenantId, "staff");
  const made = await req(a, "/tenant/lifecycle/ownership-transfer", {
    targetUserId: staff.userId,
    password,
    reason: "Transfer this synthetic workspace",
  });
  assert.equal(made.statusCode, 200, made.body);
  const r = made.json(),
    path = `/tenant/lifecycle/${r.id}/accept`,
    body = {
      password,
      expectedRevision: r.revision,
      acceptResponsibilities: true,
    };
  assert.equal((await req(foreign, path, body)).statusCode, 404);
  assert.equal(
    (await req(staff, path, { ...body, password: "wrong" })).statusCode,
    401,
  );
  staff.mfaAt = null;
  assert.equal((await req(staff, path, body)).statusCode, 403);
  staff.mfaAt = new Date().toISOString();
  const responses = await Promise.all([
    req(staff, path, body),
    req(staff, path, body),
  ]);
  assert.deepEqual(responses.map((r) => r.statusCode).sort(), [200, 409]);
  const owners = await db.system((tx) =>
    tx.query(
      "SELECT user_id FROM memberships WHERE tenant_id=$1 AND role='owner'",
      [a.tenantId],
    ),
  );
  assert.deepEqual(
    owners.map((r) => r.user_id),
    [staff.userId],
  );
  assert.equal(
    (
      await req(a, "/tenant/lifecycle/closure", {
        password,
        reason: "Stale owner must not close workspace",
        confirmClosure: true,
      })
    ).statusCode,
    403,
  );
});

test("workspace closure rechecks settlement and ownership, requires independent review and preserves financial evidence", async () => {
  const a = await tenant(),
    staff = await person(a.tenantId, "staff"),
    adminTenant = await tenant(),
    admin = await person(adminTenant.tenantId, "staff", "admin");
  a.platformRole = "admin";
  const created = await req(a, "/tenant/lifecycle/closure", {
    password,
    reason: "Close synthetic workspace after review",
    confirmClosure: true,
  });
  assert.equal(created.statusCode, 200, created.body);
  const r = created.json(),
    path = `/admin/tenants/${a.tenantId}/privacy/lifecycle/${r.id}/close`;
  assert.equal((await req(a, path, proof(r.revision))).statusCode, 403);
  await db.tenant(a, async (tx) => {
    await tx.query(
      "INSERT INTO subscriptions(id,tenant_id,user_id,status) VALUES($1,$2,$3,'active')",
      [randomUUID(), a.tenantId, staff.userId],
    );
    await putRecord(
      tx,
      a,
      "source",
      { text: "private trainer knowledge" },
      { status: "extracted" },
    );
    await journal(tx, a, "closure-finance", "Retained financial audit", [
      { account: "cash", amount: 300 },
      { account: "platform_revenue", amount: -300 },
    ]);
  });
  const blocked = await req(admin, path, proof(r.revision));
  assert.equal(blocked.json().code, "SUBSCRIPTION_OPEN", blocked.body);
  await db.tenant(a, (tx) =>
    tx.query("UPDATE subscriptions SET status='canceled'"),
  );
  const closed = await req(admin, path, proof(r.revision));
  assert.equal(closed.statusCode, 200, closed.body);
  const [t] = await db.system((tx) =>
    tx.query(
      "SELECT lifecycle_state,published,theme FROM tenants WHERE id=$1",
      [a.tenantId],
    ),
  );
  assert.equal(t.lifecycle_state, "closed");
  assert.equal(t.published, false);
  assert.equal(
    (
      await db.system((tx) =>
        tx.query("SELECT * FROM memberships WHERE tenant_id=$1", [a.tenantId]),
      )
    ).length,
    0,
  );
  await db.tenant(a, async (tx) => {
    assert.equal(
      (await tx.query("SELECT * FROM records WHERE kind='source'")).length,
      0,
    );
    assert.equal((await tx.query("SELECT * FROM journals")).length, 1);
  });
});

test("former owners and staff can erase their accounts without removing the workspace or its other members", async () => {
  const a = await tenant(),
    staff = await person(a.tenantId, "staff"),
    admin = await person(a.tenantId, "staff", "admin"),
    client = await person(a.tenantId);
  const request = await deletion(staff);
  await db.tenant(a, (tx) =>
    putRecord(
      tx,
      a,
      "planned_session",
      { date: "2026-12-01" },
      { ownerId: client.userId, status: "planned" },
    ),
  );
  const erased = await req(
    admin,
    `/admin/tenants/${a.tenantId}/privacy/${request.id}/erase`,
    proof(),
  );
  assert.equal(erased.statusCode, 200, erased.body);
  const members = await db.system((tx) =>
    tx.query("SELECT user_id,role FROM memberships WHERE tenant_id=$1", [
      a.tenantId,
    ]),
  );
  assert.ok(!members.some((m) => m.user_id === staff.userId));
  assert.ok(members.some((m) => m.user_id === a.userId && m.role === "owner"));
  assert.ok(members.some((m) => m.user_id === client.userId));
  const exported = await exportPersonalData(db, client);
  assert.ok(exported.records.some((r) => r.kind === "planned_session"));
});
