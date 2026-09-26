import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Fastify, { type FastifyRequest, type FastifyReply } from "fastify";
import { z } from "zod";
import {
  createDatabase,
  putRecord,
  type Actor,
  type Database,
} from "@trainer/db";
import {
  registerRetention,
  retentionNotificationCurrent,
  scheduleRetentionAlerts,
} from "../apps/api/src/retention.ts";
import { recordCharge } from "../apps/api/src/finance.ts";
import { notificationDeliveryDecision } from "../apps/api/src/notifications.ts";
import { buildApp } from "../apps/api/src/app.ts";
import { tokenHash } from "../apps/api/src/auth.ts";

let db: Database, app: ReturnType<typeof Fastify>;
const actors = new Map<string, Actor>();
const DAY = 86_400_000,
  now = new Date(),
  span = 7 * DAY;
const start = Math.floor(now.getTime() / span) * span;
const currentAt = new Date(start + (now.getTime() - start) / 2);
const previousAt = new Date(currentAt.getTime() - span);
const paidAt = new Date(start - 30 * DAY);
before(async () => {
  db = await createDatabase({ memory: true });
  app = Fastify();
  app.decorateRequest("identity", null);
  app.addHook("onRequest", async (req: FastifyRequest) => {
    req.identity = actors.get(String(req.headers["x-fixture-user"])) as any;
  });
  app.setErrorHandler((error: any, _req: FastifyRequest, reply: FastifyReply) =>
    reply
      .code(error instanceof z.ZodError ? 400 : (error.statusCode ?? 500))
      .send({ message: error.message }),
  );
  registerRetention(app, db);
});
after(async () => {
  await app.close();
  await db.close();
});
async function workspace() {
  const a = { tenantId: randomUUID(), userId: randomUUID(), role: "owner" };
  await db.system(async (tx) => {
    await tx.query(
      "INSERT INTO tenants(id,slug,name,published,created_at) VALUES($1,$2,'Synthetic retention workspace',true,$3)",
      [a.tenantId, "retention-" + a.tenantId, new Date(start - 120 * DAY)],
    );
    await tx.query(
      "INSERT INTO users(id,email,name,password_hash,email_verified) VALUES($1,$2,'Synthetic owner','unused',true)",
      [a.userId, a.userId + "@example.test"],
    );
    await tx.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')",
      [a.tenantId, a.userId],
    );
    await tx.query(
      "INSERT INTO notification_preferences(tenant_id,user_id,data) VALUES($1,$2,$3)",
      [a.tenantId, a.userId, JSON.stringify({ quietStart: 0, quietEnd: 0 })],
    );
  });
  actors.set(a.userId, a);
  return a;
}
function request(a: Actor, path = "summary", body?: unknown) {
  return app.inject({
    url: `/api/v1/retention/${path}`,
    method: body ? "PUT" : "GET",
    headers: { "x-fixture-user": a.userId },
    ...(body ? { payload: body } : {}),
  });
}
async function enable(a: Actor, cancellationThreshold = 1) {
  const p = (await request(a, "policy")).json();
  const r = await request(a, "policy", {
    version: p.version,
    data: { enabled: true, windowDays: 7, cancellationThreshold },
  });
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}
type Member = Actor & { subscriptionId: string; providerId: string };
async function member(
  a: Actor,
  options: {
    paid?: boolean;
    status?: string;
    cancel?: boolean;
    linkInvoice?: boolean;
  } = {},
): Promise<Member> {
  const m = {
    tenantId: a.tenantId,
    userId: randomUUID(),
    role: "subscriber",
    subscriptionId: randomUUID(),
    providerId: "sub_" + randomUUID(),
  };
  await db.system(async (tx) => {
    await tx.query(
      "INSERT INTO users(id,email,name,password_hash,email_verified) VALUES($1,$2,'Synthetic member','unused',true)",
      [m.userId, m.userId + "@example.test"],
    );
    await tx.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'subscriber')",
      [a.tenantId, m.userId],
    );
  });
  await db.tenant(a, async (tx) => {
    await tx.query(
      "INSERT INTO subscriptions(id,tenant_id,user_id,provider_id,status,cancel_at_period_end,period_end) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        m.subscriptionId,
        a.tenantId,
        m.userId,
        m.providerId,
        options.status ?? "active",
        options.cancel ?? true,
        new Date(now.getTime() + 30 * DAY),
      ],
    );
    if (options.paid !== false) {
      const invoiceId = "in_" + randomUUID();
      await recordCharge(tx, a, "stripe-invoice:" + invoiceId, 10000, 1, {
        userId: m.userId,
        invoiceId,
        chargedAt: paidAt.toISOString(),
      });
      await putRecord(
        tx,
        a,
        "billing_invoice",
        {
          invoiceId,
          subscriptionId:
            options.linkInvoice === false ? "sub_unrelated" : m.providerId,
        },
        { ownerId: m.userId, status: "paid" },
      );
    }
  });
  actors.set(m.userId, m);
  return m;
}
async function signed(
  m: Member,
  options: {
    at?: Date;
    recordedAt?: Date;
    kind?: "scheduled" | "ended";
    receipt?: boolean;
    mapped?: boolean;
    previousChange?: boolean;
    endedAt?: boolean;
  } = {},
) {
  const at = options.at ?? currentAt,
    recorded = options.recordedAt ?? at,
    ended = options.kind === "ended";
  const providerEventId = "evt_" + randomUUID(),
    eventId = randomUUID();
  const payload = {
    id: providerEventId,
    created: Math.floor(recorded.getTime() / 1000),
    type: ended
      ? "customer.subscription.deleted"
      : "customer.subscription.updated",
    data: {
      object: {
        id: m.providerId,
        object: "subscription",
        status: ended ? "canceled" : "active",
        cancel_at_period_end: !ended,
        canceled_at: Math.floor(at.getTime() / 1000),
        ended_at:
          ended && options.endedAt !== false
            ? Math.floor(at.getTime() / 1000)
            : null,
        current_period_end: Math.floor((now.getTime() + 30 * DAY) / 1000),
      },
      previous_attributes:
        options.previousChange === false
          ? {}
          : ended
            ? { status: "active" }
            : { cancel_at_period_end: false },
    },
  };
  await db.system(async (tx) => {
    if (options.receipt !== false)
      await tx.query(
        "INSERT INTO provider_events(provider,external_id,payload,status) VALUES('stripe',$1,$2,'processed')",
        [providerEventId, JSON.stringify(payload)],
      );
    if (options.mapped !== false)
      await tx.query(
        "INSERT INTO provider_objects(provider,external_id,tenant_id,user_id,kind) VALUES('stripe',$1,$2,$3,'subscription') ON CONFLICT DO NOTHING",
        [m.providerId, m.tenantId, m.userId],
      );
    await tx.query(
      "INSERT INTO events(id,tenant_id,actor_id,name,subject_id,data,created_at) VALUES($1,$2,$3,'subscription.updated',$4,$5,$6)",
      [
        eventId,
        m.tenantId,
        m.userId,
        m.providerId,
        JSON.stringify({
          status: ended ? "canceled" : "active",
          providerEventId,
        }),
        recorded,
      ],
    );
  });
  return { eventId, providerEventId };
}
async function command(m: Member, at = currentAt, status = "succeeded") {
  const eventId = randomUUID();
  await db.tenant({ ...m, role: "owner" }, async (tx) => {
    const r = await putRecord(
      tx,
      m,
      "subscription_transition",
      {
        subscriptionId: m.subscriptionId,
        providerId: m.providerId,
        cancel: true,
        periodEnd: new Date(now.getTime() + 30 * DAY).toISOString(),
      },
      { ownerId: m.userId, status },
    );
    await tx.query(
      "INSERT INTO events(id,tenant_id,actor_id,name,subject_id,created_at) VALUES($1,$2,$3,'subscription.cancel_scheduled',$4,$5)",
      [eventId, m.tenantId, m.userId, r.id, at],
    );
  });
  return eventId;
}
async function notices(a: Actor) {
  return db.tenant(a, (tx) =>
    tx.query(
      "SELECT * FROM notifications WHERE data->'source'->>'type'='retention' ORDER BY created_at,id",
    ),
  );
}
async function queued(a: Actor, n: any) {
  return (
    await db.tenant(a, (tx) =>
      tx.query("SELECT * FROM jobs WHERE data->>'notificationId'=$1", [n.id]),
    )
  )[0];
}

test("policy is disabled by default, revision safe, bounded and current-owner only", async () => {
  const a = await workspace(),
    m = await member(a);
  assert.deepEqual((await request(a, "policy")).json(), {
    version: 0,
    data: { enabled: false, windowDays: 14, cancellationThreshold: 3 },
  });
  assert.equal((await request(m, "policy")).statusCode, 403);
  assert.equal(
    (await app.inject({ url: "/api/v1/retention/policy" })).statusCode,
    401,
  );
  assert.equal(
    (
      await request(a, "policy", {
        version: 0,
        data: { enabled: true, windowDays: 31, cancellationThreshold: 1 },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await request(a, "policy", {
        version: 0,
        data: { enabled: true, windowDays: 7, cancellationThreshold: 0 },
      })
    ).statusCode,
    400,
  );
  const body = {
    version: 0,
    data: { enabled: true, windowDays: 7, cancellationThreshold: 2 },
  };
  const saves = await Promise.all([
    request(a, "policy", body),
    request(a, "policy", body),
  ]);
  assert.deepEqual(saves.map((r) => r.statusCode).sort(), [200, 409]);
  assert.equal((await request(a, "policy")).json().version, 1);
  await db.system((tx) =>
    tx.query(
      "UPDATE memberships SET role='staff' WHERE tenant_id=$1 AND user_id=$2",
      [a.tenantId, a.userId],
    ),
  );
  assert.equal(
    (await request(a, "summary")).statusCode,
    403,
    "A stale owner session cannot read business records",
  );
  assert.equal(
    (await request(a, "policy", { ...body, version: 1 })).statusCode,
    403,
  );
});

test("recorded cohort distinguishes scheduled, ended and recovered; counts unique paid subscribers and comparable evidence", async () => {
  const a = await workspace();
  await enable(a, 2);
  const scheduled = await member(a),
    ended = await member(a, { status: "canceled", cancel: false }),
    recovered = await member(a, { cancel: false });
  const free = await member(a, { paid: false }),
    unrelated = await member(a, { linkInvoice: false }),
    prior = await member(a);
  const source = await signed(scheduled);
  await command(scheduled);
  await signed(ended, { kind: "ended" });
  await signed(recovered);
  await signed(free);
  await signed(unrelated);
  await signed(prior, { at: previousAt });
  const result = await request(a),
    v = result.json();
  assert.equal(result.statusCode, 200, result.body);
  assert.equal(v.complete, true);
  assert.deepEqual(v.counts, {
    recorded: 3,
    affected: 2,
    scheduled: 1,
    ended: 1,
    recovered: 1,
    unverified: 0,
  });
  assert.equal(v.previousRecorded, 1);
  assert.equal(v.thresholdMet, true);
  assert.equal(v.coverage.excludedWithoutPayment, 2);
  assert.equal(
    Date.parse(v.period.current.end) - Date.parse(v.period.current.start),
    Date.parse(v.period.previous.end) - Date.parse(v.period.previous.start),
  );
  const row = v.cohort.find((r: any) => r.userId === scheduled.userId);
  assert.ok(row.evidence.invoiceId);
  assert.ok(row.evidence.journalId);
  assert.equal(
    (await request(a, `evidence/${row.evidence.eventId}`)).statusCode,
    200,
  );
  const other = await workspace();
  assert.equal(
    (await request(other, `evidence/${source.eventId}`)).statusCode,
    404,
  );
  assert.equal(
    (await request(scheduled, `evidence/${source.eventId}`)).statusCode,
    403,
  );
  assert.equal((await request(other)).json().counts.recorded, 0);
  await db.system((tx) =>
    tx.query("UPDATE tenants SET created_at=$2 WHERE id=$1", [
      a.tenantId,
      currentAt,
    ]),
  );
  assert.equal(
    (await request(a)).json().previousRecorded,
    null,
    "A new workspace cannot claim a comparable historical observation period",
  );
});

test("unrelated later subscription updates do not turn an old scheduled cancellation into a new one", async () => {
  const a = await workspace();
  await enable(a);
  const m = await member(a);
  await signed(m, {
    at: new Date(start - span - DAY),
    recordedAt: currentAt,
    previousChange: false,
  });
  const v = (await request(a)).json();
  assert.equal(v.complete, true);
  assert.equal(v.counts.recorded, 0);
  assert.equal(await scheduleRetentionAlerts(db, a.tenantId, now), 0);
});

test("alerts dedupe concurrent polls and remain generic, including an owner policy-edit cooldown", async () => {
  const a = await workspace();
  await enable(a);
  const m = await member(a);
  await command(m);
  assert.deepEqual(
    (
      await Promise.all([
        scheduleRetentionAlerts(db, a.tenantId, now),
        scheduleRetentionAlerts(db, a.tenantId, now),
      ])
    ).sort(),
    [0, 1],
  );
  assert.equal(await scheduleRetentionAlerts(db, a.tenantId, now), 0);
  const [n] = await notices(a);
  assert.equal(n.user_id, a.userId);
  assert.equal(n.email_status, "pending");
  assert.equal(n.href, "/trainer/analytics#retention");
  assert.equal(JSON.stringify(n.data.source).includes(m.userId), false);
  assert.equal(n.body.includes("Synthetic member"), false);
  assert.equal(
    await retentionNotificationCurrent(
      db,
      a.tenantId,
      a.userId,
      n.data.source,
      now,
    ),
    true,
  );
  assert.equal(
    (
      await notificationDeliveryDecision(
        db,
        a.tenantId,
        await queued(a, n),
        now,
      )
    ).allowed,
    true,
  );
  await enable(a);
  assert.equal(
    await retentionNotificationCurrent(
      db,
      a.tenantId,
      a.userId,
      n.data.source,
      now,
    ),
    false,
  );
  assert.equal(
    await scheduleRetentionAlerts(db, a.tenantId, now),
    0,
    "Saving a new revision cannot bypass the 24-hour cooldown",
  );
  assert.equal((await notices(a)).length, 1);
});

test("current-source checks suppress recovery, expired windows, ownership loss, closure and removed subscribers", async () => {
  const a = await workspace();
  await enable(a);
  const m = await member(a);
  await signed(m);
  assert.equal(await scheduleRetentionAlerts(db, a.tenantId, now), 1);
  const [n] = await notices(a),
    source = n.data.source;
  assert.equal(
    await retentionNotificationCurrent(db, a.tenantId, a.userId, source, now),
    true,
  );
  const other = await workspace();
  assert.equal(
    await retentionNotificationCurrent(
      db,
      other.tenantId,
      other.userId,
      source,
      now,
    ),
    false,
  );
  assert.equal(
    await retentionNotificationCurrent(
      db,
      a.tenantId,
      a.userId,
      source,
      new Date(start + span),
    ),
    false,
  );
  await db.tenant(a, (tx) =>
    tx.query(
      "UPDATE subscriptions SET cancel_at_period_end=false WHERE id=$1",
      [m.subscriptionId],
    ),
  );
  assert.equal(
    await retentionNotificationCurrent(db, a.tenantId, a.userId, source, now),
    false,
  );
  const decision = await notificationDeliveryDecision(
    db,
    a.tenantId,
    await queued(a, n),
    now,
  );
  assert.equal(
    decision.allowed,
    false,
    "The real email delivery hook must reject recovered evidence",
  );
  await db.tenant(a, (tx) =>
    tx.query("UPDATE subscriptions SET cancel_at_period_end=true WHERE id=$1", [
      m.subscriptionId,
    ]),
  );
  await db.system((tx) =>
    tx.query(
      "UPDATE memberships SET role='staff' WHERE tenant_id=$1 AND user_id=$2",
      [a.tenantId, a.userId],
    ),
  );
  assert.equal(
    await retentionNotificationCurrent(db, a.tenantId, a.userId, source, now),
    false,
  );
  await db.system((tx) =>
    tx.query(
      "UPDATE memberships SET role='owner' WHERE tenant_id=$1 AND user_id=$2",
      [a.tenantId, a.userId],
    ),
  );
  await db.system((tx) =>
    tx.query("DELETE FROM memberships WHERE tenant_id=$1 AND user_id=$2", [
      a.tenantId,
      m.userId,
    ]),
  );
  assert.equal(
    await retentionNotificationCurrent(db, a.tenantId, a.userId, source, now),
    false,
  );
  await db.system((tx) =>
    tx.query("UPDATE tenants SET lifecycle_state='closed' WHERE id=$1", [
      a.tenantId,
    ]),
  );
  assert.equal(
    await retentionNotificationCurrent(db, a.tenantId, a.userId, source, now),
    false,
  );
  assert.equal(await scheduleRetentionAlerts(db, a.tenantId, now), 0);
  assert.equal((await request(a)).statusCode, 409);
});

test("owner email preference is honored and disabled policies never schedule alerts", async () => {
  const a = await workspace(),
    m = await member(a);
  await command(m);
  assert.equal(await scheduleRetentionAlerts(db, a.tenantId, now), 0);
  await enable(a);
  await db.tenant(a, (tx) =>
    tx.query(
      "UPDATE notification_preferences SET data=data||'{\"email\":false}'::jsonb WHERE user_id=$1",
      [a.userId],
    ),
  );
  assert.equal(await scheduleRetentionAlerts(db, a.tenantId, now), 1);
  const [n] = await notices(a);
  assert.equal(n.email_status, "suppressed");
  assert.equal(await queued(a, n), undefined);
  const policy = (await request(a, "policy")).json();
  await request(a, "policy", {
    ...policy,
    data: { ...policy.data, enabled: false },
  });
  assert.equal(
    await retentionNotificationCurrent(
      db,
      a.tenantId,
      a.userId,
      n.data.source,
      now,
    ),
    false,
  );
});

test("missing signed proof, unresolved commands and capped scans are explicit partial evidence and cannot alert", async () => {
  const a = await workspace();
  await enable(a);
  const good = await member(a);
  const proof = await signed(good);
  const missing = await member(a);
  await signed(missing, { receipt: false });
  let v = (await request(a)).json();
  assert.equal(v.complete, false);
  assert.equal(v.counts.affected, 1);
  assert.equal(v.previousRecorded, null);
  assert.equal(v.coverage.unverifiableSources, 1);
  assert.equal(await scheduleRetentionAlerts(db, a.tenantId, now), 0);
  const b = await workspace();
  await enable(b);
  const pending = await member(b);
  await signed(pending);
  await db.tenant(b, (tx) =>
    putRecord(
      tx,
      b,
      "subscription_transition",
      {
        subscriptionId: pending.subscriptionId,
        providerId: pending.providerId,
        cancel: false,
      },
      { ownerId: pending.userId, status: "unknown" },
    ),
  );
  v = (await request(b)).json();
  assert.equal(v.complete, false);
  assert.equal(v.counts.unverified, 1);
  assert.equal(await scheduleRetentionAlerts(db, b.tenantId, now), 0);
  const c = await workspace();
  await enable(c);
  const capped = await member(c);
  const capProof = await signed(capped);
  await db.system((tx) =>
    tx.query(
      "WITH copies AS (INSERT INTO provider_events(provider,external_id,payload,status) SELECT 'stripe',p.external_id||':'||g,p.payload||jsonb_build_object('id',p.external_id||':'||g),'processed' FROM provider_events p CROSS JOIN generate_series(1,501) g WHERE p.provider='stripe' AND p.external_id=$4 RETURNING external_id) INSERT INTO events(id,tenant_id,actor_id,name,subject_id,data,created_at) SELECT gen_random_uuid(),$1,$2,'subscription.updated',$3,jsonb_build_object('status','active','providerEventId',external_id),$5 FROM copies",
      [
        c.tenantId,
        capped.userId,
        capped.providerId,
        capProof.providerEventId,
        currentAt,
      ],
    ),
  );
  v = (await request(c)).json();
  assert.equal(v.complete, false);
  assert.equal(v.coverage.scannedEvents, 500);
  assert.equal(v.counts.affected, 1);
  assert.equal(await scheduleRetentionAlerts(db, c.tenantId, now), 0);
  assert.ok(proof.eventId);
});

test("assembled app exposes retention through owner routes and excludes policy from shared bootstrap", async () => {
  const a = await workspace();
  await enable(a);
  const tokens = { owner: randomUUID(), staff: randomUUID() },
    staffId = randomUUID();
  await db.system(async (tx) => {
    await tx.query(
      "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Retention staff','unused')",
      [staffId, staffId + "@example.test"],
    );
    await tx.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'staff')",
      [a.tenantId, staffId],
    );
    for (const [token, userId] of [
      [tokens.owner, a.userId],
      [tokens.staff, staffId],
    ])
      await tx.query(
        "INSERT INTO sessions(token_hash,user_id,tenant_id,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
        [tokenHash(token), userId, a.tenantId],
      );
  });
  const assembled = await buildApp({ db, testing: true });
  try {
    for (const token of Object.values(tokens)) {
      const response = await assembled.inject({
        url: "/api/v1/bootstrap",
        headers: { cookie: "session=" + token },
      });
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(
        response.json().records.some((r: any) => r.kind === "retention_policy"),
        false,
      );
    }
    const owner = await assembled.inject({
      url: "/api/v1/retention/policy",
      headers: { cookie: "session=" + tokens.owner },
    });
    assert.equal(owner.statusCode, 200, owner.body);
    assert.equal(owner.json().data.enabled, true);
    const denied = await assembled.inject({
      url: "/api/v1/retention/policy",
      headers: { cookie: "session=" + tokens.staff },
    });
    assert.equal(denied.statusCode, 403, denied.body);
  } finally {
    await assembled.close();
  }
});
