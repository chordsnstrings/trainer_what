import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Fastify, { type FastifyRequest, type FastifyReply } from "fastify";
import { z } from "zod";
import {
  createDatabase,
  event,
  putRecord,
  type Actor,
  type Database,
} from "@trainer/db";
import {
  scheduleLifecycleMessages,
  lifecycleMessageCurrent,
  registerLifecycleMessages,
} from "../apps/api/src/lifecycle-messages.ts";
import { notificationDeliveryDecision } from "../apps/api/src/notifications.ts";
import { recordCharge, journal } from "../apps/api/src/finance.ts";

let db: Database, app: ReturnType<typeof Fastify>;
const actors = new Map<string, Actor>();
const HOUR = 3_600_000;
const now = new Date();
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
      .send({ error: error.message }),
  );
  registerLifecycleMessages(app, db);
});
after(async () => {
  await app.close();
  await db.close();
});
async function workspace(published = true, age = 0) {
  const a = { tenantId: randomUUID(), userId: randomUUID(), role: "owner" };
  await db.system(async (tx) => {
    await tx.query(
      "INSERT INTO tenants(id,slug,name,published,created_at) VALUES($1,$2,'Synthetic lifecycle coach',$3,$4)",
      [
        a.tenantId,
        "lifecycle-" + a.tenantId,
        published,
        new Date(now.getTime() - age).toISOString(),
      ],
    );
    await tx.query(
      "INSERT INTO users(id,email,name,password_hash,email_verified) VALUES($1,$2,'Synthetic coach','unused',true)",
      [a.userId, a.userId + "@example.test"],
    );
    await tx.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')",
      [a.tenantId, a.userId],
    );
  });
  actors.set(a.userId, a);
  return a;
}
async function member(a: Actor, status = "active", charge = true) {
  const userId = randomUUID(),
    s = { userId, tenantId: a.tenantId, role: "subscriber" },
    subscriptionId = randomUUID(),
    providerId = "sub_" + randomUUID();
  await db.system(async (tx) => {
    await tx.query(
      "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Synthetic member','unused')",
      [userId, userId + "@example.test"],
    );
    await tx.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'subscriber')",
      [a.tenantId, userId],
    );
  });
  const paid = await db.tenant(a, async (tx) => {
    await tx.query(
      "INSERT INTO subscriptions(id,tenant_id,user_id,provider_id,status,period_end,price_minor) VALUES($1,$2,$3,$4,$5,$6,10000)",
      [
        subscriptionId,
        a.tenantId,
        userId,
        providerId,
        status,
        new Date(now.getTime() + 30 * 24 * HOUR).toISOString(),
      ],
    );
    return charge
      ? await recordCharge(tx, a, "stripe-invoice:" + randomUUID(), 10000, 1, {
          userId,
          chargeId: "ch_" + randomUUID(),
          chargedAt: now.toISOString(),
        })
      : null;
  });
  actors.set(s.userId, s);
  return { ...s, subscriptionId, providerId, charge: paid };
}
function policyRequest(a: Actor, body?: any) {
  return app.inject({
    url: "/api/v1/lifecycle/workout-policy",
    method: body ? "PUT" : "GET",
    headers: { "x-fixture-user": a.userId },
    ...(body ? { payload: body } : {}),
  });
}
async function notices(a: Actor, trigger?: string) {
  return db.tenant(a, (tx) =>
    tx.query(
      "SELECT * FROM notifications WHERE ($1::text IS NULL OR data->'source'->>'trigger'=$1) ORDER BY created_at,id",
      [trigger ?? null],
    ),
  );
}
async function emailJob(a: Actor, notification: any) {
  const [job] = await db.tenant(a, (tx) =>
    tx.query("SELECT * FROM jobs WHERE data->>'notificationId'=$1", [
      notification.id,
    ]),
  );
  assert.ok(job, "A permitted email has a durable queue intent");
  return job;
}

test("trainer timers are idempotent, honor opt-out and stop stale resume, interview and payout prompts", async () => {
  const a = await workspace(false, HOUR);
  await db.tenant(a, (tx) =>
    tx.query(
      "INSERT INTO notification_preferences(tenant_id,user_id,data) VALUES($1,$2,$3)",
      [a.tenantId, a.userId, JSON.stringify({ email: false })],
    ),
  );
  assert.equal(await scheduleLifecycleMessages(db, a.tenantId, now), 2);
  assert.equal(await scheduleLifecycleMessages(db, a.tenantId, now), 0);
  const resume = (await notices(a, "onboarding"))[0],
    payout = (await notices(a, "payout-setup"))[0];
  assert.equal(resume.href, "/trainer/onboarding/identity");
  assert.equal(resume.email_status, "suppressed");
  assert.equal((await notices(a, "publish-ready")).length, 0);
  assert.equal(
    (await db.tenant(a, (tx) => tx.query("SELECT id FROM jobs"))).length,
    0,
  );
  await db.tenant(a, async (tx) => {
    await putRecord(
      tx,
      a,
      "onboarding_step",
      {
        step: "identity",
        values: {
          businessName: "Synthetic coach",
          publicName: "Synthetic coach",
          city: "Dubai",
          country: "AE",
          category: "Strength",
          audience: "Adults",
        },
      },
      { status: "saved" },
    );
    await putRecord(
      tx,
      a,
      "beneficiary",
      { providerId: "synthetic", holdUntil: "2020-01-01T00:00:00Z" },
      { status: "verified" },
    );
  });
  assert.equal(
    await lifecycleMessageCurrent(
      db,
      a.tenantId,
      a.userId,
      resume.data.source,
      now,
    ),
    false,
  );
  assert.equal(
    await lifecycleMessageCurrent(
      db,
      a.tenantId,
      a.userId,
      payout.data.source,
      now,
    ),
    false,
  );
  await scheduleLifecycleMessages(
    db,
    a.tenantId,
    new Date(now.getTime() + 24 * HOUR),
  );
  const interviews = await notices(a, "interview");
  assert.equal(interviews.length, 1);
  await db.tenant(a, (tx) =>
    putRecord(
      tx,
      a,
      "coaching_teaching",
      { example: "Synthetic case" },
      { status: "confirmed" },
    ),
  );
  assert.equal(
    await lifecycleMessageCurrent(
      db,
      a.tenantId,
      a.userId,
      interviews[0].data.source,
      now,
    ),
    false,
  );
  await db.system((tx) =>
    tx.query("UPDATE tenants SET published=true WHERE id=$1", [a.tenantId]),
  );
  assert.equal(
    await scheduleLifecycleMessages(
      db,
      a.tenantId,
      new Date(now.getTime() + 49 * HOUR),
    ),
    0,
  );
});

test("paid intake nudges pin templates, deduplicate concurrent passes and recheck intake; milestones use paid current members", async () => {
  const a = await workspace(),
    client = await member(a);
  await db.system((tx) =>
    tx.query(
      "INSERT INTO admin_documents(id,kind,key,version,title,content,status,effective_at,created_by,published_at) VALUES($1,'notification','lifecycle-intake-v1',1,'Finish your intake','{{message}}','published',now()-interval '1 hour',$2,now())",
      [randomUUID(), a.userId],
    ),
  );
  await Promise.all([
    scheduleLifecycleMessages(db, a.tenantId, now),
    scheduleLifecycleMessages(db, a.tenantId, now),
  ]);
  let intake = (await notices(a, "intake"))[0];
  assert.equal((await notices(a, "intake")).length, 1);
  assert.equal(intake.data.template.version, 1);
  assert.equal(intake.data.source.version, 1);
  const queued = await emailJob(a, intake);
  assert.equal(
    (await notificationDeliveryDecision(db, a.tenantId, queued, now)).allowed,
    true,
  );
  await db.tenant(a, (tx) =>
    putRecord(
      tx,
      a,
      "intake",
      {},
      { ownerId: client.userId, status: "complete" },
    ),
  );
  assert.equal(
    (await notificationDeliveryDecision(db, a.tenantId, queued, now)).allowed,
    false,
  );
  await scheduleLifecycleMessages(
    db,
    a.tenantId,
    new Date(now.getTime() + 25 * HOUR),
  );
  assert.equal((await notices(a, "intake")).length, 1);
  for (let i = 0; i < 4; i++) await member(a);
  await member(a, "trialing", false);
  await member(a, "canceled", true);
  await scheduleLifecycleMessages(db, a.tenantId, now);
  assert.deepEqual(
    (await notices(a, "paid-milestone"))
      .map((r) => r.data.source.milestone)
      .sort((x, y) => x - y),
    [1, 5],
  );
  await db.tenant(a, (tx) =>
    tx.query("UPDATE subscriptions SET status='canceled'"),
  );
  assert.equal(
    await lifecycleMessageCurrent(
      db,
      a.tenantId,
      a.userId,
      (await notices(a, "paid-milestone")).find(
        (r) => r.data.source.milestone === 5,
      )!.data.source,
      now,
    ),
    false,
  );
  await scheduleLifecycleMessages(db, a.tenantId, now);
  assert.equal((await notices(a, "paid-milestone")).length, 2);
});

test("assigned programs and complete blocks require real schedule/link evidence; workout confirmations stay in-app", async () => {
  const a = await workspace(),
    client = await member(a, "active", false);
  const records = await db.tenant(a, async (tx) => {
    const program = await putRecord(
      tx,
      a,
      "program",
      { title: "Synthetic two-session block", weeks: 1, daysPerWeek: 2 },
      { ownerId: client.userId, status: "assigned" },
    );
    await event(tx, a, "program.scheduled", program.id, {
      subscriberId: client.userId,
      sessions: 2,
    });
    const plans = [];
    for (let i = 0; i < 2; i++)
      plans.push(
        await putRecord(
          tx,
          a,
          "planned_session",
          {
            date: now.toISOString().slice(0, 10),
            timezone: "UTC",
            programId: program.id,
            programVersion: 1,
          },
          { ownerId: client.userId, status: "planned" },
        ),
      );
    return { program, plans };
  });
  await scheduleLifecycleMessages(db, a.tenantId, now);
  const programNotice = (await notices(a, "program-ready"))[0];
  assert.ok(programNotice);
  assert.equal((await notices(a, "block-complete")).length, 0);
  const saved: any[] = [];
  for (const plan of records.plans) {
    saved.push(
      await db.tenant(a, async (tx) => {
        const workout = await putRecord(
          tx,
          a,
          "workout",
          {
            programId: records.program.id,
            plannedSessionId: plan.id,
            completedAt: now.toISOString(),
          },
          { ownerId: client.userId, status: "completed" },
        );
        await tx.query(
          "UPDATE records SET status='completed',data=data||$2::jsonb WHERE id=$1",
          [plan.id, JSON.stringify({ workoutId: workout.id })],
        );
        await event(tx, client, "workout.completed", workout.id);
        return workout;
      }),
    );
    await scheduleLifecycleMessages(db, a.tenantId, now);
    assert.equal(
      (await notices(a, "block-complete")).length,
      saved.length === 2 ? 1 : 0,
    );
  }
  const completed = await notices(a, "workout-complete");
  assert.equal(completed.length, 2);
  assert.ok(completed.every((r) => r.email_status === "suppressed"));
  assert.equal(
    (
      await db.tenant(a, (tx) =>
        tx.query(
          "SELECT id FROM jobs WHERE data->>'notificationId'=ANY($1::text[])",
          [completed.map((r) => r.id)],
        ),
      )
    ).length,
    0,
  );
  const block = (await notices(a, "block-complete"))[0];
  assert.match(block.body, /All 2 planned sessions/);
  assert.equal(
    await lifecycleMessageCurrent(
      db,
      a.tenantId,
      client.userId,
      block.data.source,
      now,
    ),
    true,
  );
  await db.tenant(a, (tx) =>
    tx.query("UPDATE records SET data=data-'workoutId' WHERE id=$1", [
      records.plans[0].id,
    ]),
  );
  assert.equal(
    await lifecycleMessageCurrent(
      db,
      a.tenantId,
      client.userId,
      block.data.source,
      now,
    ),
    false,
  );
  await db.tenant(a, (tx) =>
    putRecord(
      tx,
      a,
      "training_hold",
      {},
      { ownerId: client.userId, status: "active" },
    ),
  );
  assert.equal(
    await lifecycleMessageCurrent(
      db,
      a.tenantId,
      client.userId,
      programNotice.data.source,
      now,
    ),
    false,
  );
});

test("wearable recovery, queue resolution, closure and membership erasure suppress queued lifecycle mail", async () => {
  const a = await workspace(),
    other = await workspace(),
    client = await member(a, "active", false),
    connectionId = randomUUID();
  await db.tenant(a, async (tx) => {
    await tx.query(
      "INSERT INTO integration_connections(id,tenant_id,user_id,provider,status,updated_at) VALUES($1,$2,$3,'whoop','attention',$4)",
      [
        connectionId,
        a.tenantId,
        client.userId,
        new Date(now.getTime() - 25 * HOUR).toISOString(),
      ],
    );
    for (let i = 0; i < 8; i++)
      await putRecord(
        tx,
        a,
        "decision",
        { action: "change_exercise" },
        { ownerId: client.userId, status: "pending_review" },
      );
  });
  await scheduleLifecycleMessages(db, a.tenantId, now);
  assert.equal((await notices(other)).length, 0);
  const wearable = (await notices(a, "wearable-attention"))[0],
    queue = (await notices(a, "review-queue"))[0];
  assert.ok(wearable);
  assert.ok(queue);
  assert.equal(
    await lifecycleMessageCurrent(
      db,
      other.tenantId,
      client.userId,
      wearable.data.source,
      now,
    ),
    false,
  );
  const job = await emailJob(a, wearable);
  await db.tenant(a, async (tx) => {
    await tx.query(
      "UPDATE integration_connections SET status='active',version=version+1 WHERE id=$1",
      [connectionId],
    );
    await tx.query(
      "UPDATE records SET status='approved' WHERE kind='decision'",
    );
  });
  assert.equal(
    (await notificationDeliveryDecision(db, a.tenantId, job, now)).allowed,
    false,
  );
  assert.equal(
    await lifecycleMessageCurrent(
      db,
      a.tenantId,
      a.userId,
      queue.data.source,
      now,
    ),
    false,
  );
  await db.system((tx) =>
    tx.query("DELETE FROM memberships WHERE tenant_id=$1 AND user_id=$2", [
      a.tenantId,
      client.userId,
    ]),
  );
  assert.equal(
    (await notificationDeliveryDecision(db, a.tenantId, job, now)).allowed,
    false,
  );
  await db.system((tx) =>
    tx.query("UPDATE tenants SET lifecycle_state='closed' WHERE id=$1", [
      a.tenantId,
    ]),
  );
  assert.equal(await scheduleLifecycleMessages(db, a.tenantId, now), 0);
  assert.equal(
    await lifecycleMessageCurrent(
      db,
      a.tenantId,
      a.userId,
      queue.data.source,
      now,
    ),
    false,
  );
});

test("billing prompts require current signed invoice/transition evidence, stay private and stop on recovery", async () => {
  const a = await workspace(),
    client = await member(a, "active", false);
  const failureId = "evt_" + randomUUID(),
    invoiceId = "in_" + randomUUID(),
    pastDueSince = now.toISOString();
  await db.tenant(a, async (tx) => {
    await tx.query(
      "INSERT INTO notification_preferences(tenant_id,user_id,data) VALUES($1,$2,'{\"email\":false}')",
      [a.tenantId, client.userId],
    );
    await tx.query(
      "UPDATE subscriptions SET status='past_due',data=$2 WHERE id=$1",
      [
        client.subscriptionId,
        JSON.stringify({
          pastDueSince,
          graceUntil: new Date(now.getTime() + 3 * 24 * HOUR).toISOString(),
        }),
      ],
    );
    await putRecord(
      tx,
      a,
      "billing_invoice",
      {
        invoiceId,
        subscriptionId: client.providerId,
        providerEventId: failureId,
      },
      { ownerId: client.userId, status: "open" },
    );
    await event(tx, client, "payment.failed", invoiceId, {
      providerEventId: failureId,
    });
  });
  await scheduleLifecycleMessages(db, a.tenantId, now);
  const failed = (await notices(a, "payment-failed"))[0];
  assert.ok(failed);
  assert.equal(
    failed.email_status,
    "pending",
    "Necessary billing notice survives optional-email opt-out",
  );
  assert.doesNotMatch(failed.body, /\b3 days\b|AED|medical|calorie/);
  const job = await emailJob(a, failed);
  assert.equal(
    (await notificationDeliveryDecision(db, a.tenantId, job, now)).allowed,
    true,
  );
  await db.tenant(a, async (tx) => {
    await tx.query(
      "UPDATE subscriptions SET status='active',cancel_at_period_end=true WHERE id=$1",
      [client.subscriptionId],
    );
    const transition = await putRecord(
      tx,
      a,
      "subscription_transition",
      {
        subscriptionId: client.subscriptionId,
        providerId: client.providerId,
        cancel: true,
      },
      { ownerId: client.userId, status: "succeeded" },
    );
    await event(tx, client, "subscription.cancel_scheduled", transition.id);
  });
  assert.equal(
    (await notificationDeliveryDecision(db, a.tenantId, job, now)).allowed,
    false,
  );
  await scheduleLifecycleMessages(db, a.tenantId, now);
  const cancellation = (await notices(a, "cancel-scheduled"))[0];
  assert.ok(cancellation);
  assert.equal(cancellation.email_status, "suppressed");
  assert.equal(
    await lifecycleMessageCurrent(
      db,
      a.tenantId,
      client.userId,
      cancellation.data.source,
      now,
    ),
    true,
  );
  await db.tenant(a, (tx) =>
    tx.query(
      "UPDATE subscriptions SET cancel_at_period_end=false WHERE id=$1",
      [client.subscriptionId],
    ),
  );
  assert.equal(
    await lifecycleMessageCurrent(
      db,
      a.tenantId,
      client.userId,
      cancellation.data.source,
      now,
    ),
    false,
  );
});

test("refund outcomes and payout notices require confirmed records; stale earlier states are suppressed", async () => {
  const a = await workspace(),
    client = await member(a),
    payoutId = randomUUID();
  assert.ok(client.charge);
  const refund = await db.tenant(a, (tx) =>
    putRecord(
      tx,
      a,
      "refund",
      {
        journalId: client.charge!.id,
        chargeId: client.charge!.data.chargeId,
        requestedAt: now.toISOString(),
      },
      { ownerId: client.userId, status: "requested" },
    ),
  );
  await db.tenant(a, (tx) =>
    tx.query(
      "INSERT INTO payouts(id,tenant_id,period,amount_minor,beneficiary_id,status,bank_reference) VALUES($1,$2,'2099-01',1000,'fixture-beneficiary','paid','fixture-reference')",
      [payoutId, a.tenantId],
    ),
  );
  await scheduleLifecycleMessages(db, a.tenantId, now);
  const requested = (await notices(a, "refund"))[0];
  assert.ok(requested);
  assert.equal(
    (await notices(a, "payout-paid")).length,
    0,
    "A state label without a posted payout journal is insufficient",
  );
  await db.tenant(a, async (tx) => {
    await tx.query(
      'UPDATE records SET status=\'succeeded\',data=data||\'{"providerRefundId":"re_fixture","providerStatus":"succeeded"}\' WHERE id=$1',
      [refund.id],
    );
    await journal(
      tx,
      a,
      "payout:" + payoutId,
      "Synthetic confirmed payout",
      [
        { account: "trainer_payable", amount: 1000 },
        { account: "bank", amount: -1000 },
      ],
      { reference: "fixture-reference" },
    );
  });
  assert.equal(
    await lifecycleMessageCurrent(
      db,
      a.tenantId,
      client.userId,
      requested.data.source,
      now,
    ),
    false,
  );
  await scheduleLifecycleMessages(db, a.tenantId, now);
  assert.equal((await notices(a, "refund")).length, 2);
  const payout = (await notices(a, "payout-paid"))[0];
  assert.ok(payout);
  assert.doesNotMatch(payout.body, /1000|IBAN|fixture-reference/);
  await db.tenant(a, (tx) =>
    tx.query("UPDATE payouts SET status='returned' WHERE id=$1", [payoutId]),
  );
  assert.equal(
    await lifecycleMessageCurrent(
      db,
      a.tenantId,
      a.userId,
      payout.data.source,
      now,
    ),
    false,
  );
});

test("missed-session policy is disabled by default and owner writes are tenant-scoped revision checks", async () => {
  const a = await workspace(),
    other = await workspace(),
    client = await member(a, "active", false);
  assert.deepEqual((await policyRequest(a)).json(), {
    version: 0,
    data: { enabled: false, missedAfterDays: 1 },
  });
  assert.equal((await policyRequest(client)).statusCode, 403);
  assert.equal(
    (
      await policyRequest(a, {
        version: 0,
        data: { enabled: true, missedAfterDays: 8 },
      })
    ).statusCode,
    400,
  );
  const body = { version: 0, data: { enabled: true, missedAfterDays: 2 } };
  const saved = await Promise.all([
    policyRequest(a, body),
    policyRequest(a, body),
  ]);
  assert.deepEqual(saved.map((r) => r.statusCode).sort(), [200, 409]);
  assert.deepEqual((await policyRequest(a)).json(), {
    version: 1,
    data: body.data,
  });
  assert.deepEqual((await policyRequest(other)).json(), {
    version: 0,
    data: { enabled: false, missedAfterDays: 1 },
  });
  await db.system((tx) =>
    tx.query(
      "UPDATE memberships SET role='staff' WHERE tenant_id=$1 AND user_id=$2",
      [a.tenantId, a.userId],
    ),
  );
  assert.ok(
    [403, 409].includes(
      (await policyRequest(a, { ...body, version: 1 })).statusCode,
    ),
    "A stale owner session cannot write after ownership changes",
  );
});

test("missed-session notices require enabled policy, calendar threshold, consent, complete evidence and client preferences", async () => {
  const a = await workspace(),
    client = await member(a, "active", false);
  const clock = new Date(now);
  clock.setUTCHours(12, 0, 0, 0);
  const date = new Date(clock.getTime() - 2 * 24 * HOUR)
    .toISOString()
    .slice(0, 10);
  const data = await db.tenant(a, async (tx) => {
    const program = await putRecord(
      tx,
      a,
      "program",
      { title: "Synthetic scheduled block", weeks: 1, daysPerWeek: 1 },
      { ownerId: client.userId, status: "assigned" },
    );
    await event(tx, a, "program.scheduled", program.id, {
      subscriberId: client.userId,
      sessions: 1,
    });
    const plan = await putRecord(
      tx,
      a,
      "planned_session",
      { programId: program.id, programVersion: 1, date, timezone: "UTC" },
      { ownerId: client.userId, status: "planned" },
    );
    await tx.query(
      "INSERT INTO notification_preferences(tenant_id,user_id,data) VALUES($1,$2,$3)",
      [
        a.tenantId,
        client.userId,
        JSON.stringify({
          email: false,
          workouts: true,
          timezone: "UTC",
          quietStart: 0,
          quietEnd: 0,
        }),
      ],
    );
    return { program, plan };
  });
  await scheduleLifecycleMessages(db, a.tenantId, clock);
  assert.equal(
    (await notices(a, "workout-missed")).length,
    0,
    "No invented default active policy",
  );
  assert.equal(
    (
      await policyRequest(a, {
        version: 0,
        data: { enabled: true, missedAfterDays: 2 },
      })
    ).statusCode,
    200,
  );
  await scheduleLifecycleMessages(db, a.tenantId, clock);
  assert.equal(
    (await notices(a, "workout-missed")).length,
    0,
    "Coaching consent is required",
  );
  await db.tenant(a, (tx) =>
    tx.query(
      "INSERT INTO consent_records(id,tenant_id,user_id,document_type,document_version,granted) VALUES($1,$2,$3,'coaching','fixture',true)",
      [randomUUID(), a.tenantId, client.userId],
    ),
  );
  await scheduleLifecycleMessages(
    db,
    a.tenantId,
    new Date(clock.getTime() - 24 * HOUR),
  );
  assert.equal(
    (await notices(a, "workout-missed")).length,
    0,
    "A passed date alone does not bypass the owner threshold",
  );
  for (const status of ["canceled", "abandoned", "started"]) {
    await db.tenant(a, (tx) =>
      tx.query("UPDATE records SET status=$2 WHERE id=$1", [
        data.plan.id,
        status,
      ]),
    );
    await scheduleLifecycleMessages(db, a.tenantId, clock);
    assert.equal((await notices(a, "workout-missed")).length, 0, status);
  }
  await db.tenant(a, async (tx) => {
    await tx.query("UPDATE records SET status='planned' WHERE id=$1", [
      data.plan.id,
    ]);
    await tx.query(
      "UPDATE notification_preferences SET data=data||'{\"workouts\":false}' WHERE user_id=$1",
      [client.userId],
    );
  });
  await scheduleLifecycleMessages(db, a.tenantId, clock);
  assert.equal(
    (await notices(a, "workout-missed")).length,
    0,
    "Workout opt-out also applies to proactive inbox notices",
  );
  await db.tenant(a, (tx) =>
    tx.query(
      'UPDATE notification_preferences SET data=data||\'{"workouts":true,"quietStart":660,"quietEnd":780}\' WHERE user_id=$1',
      [client.userId],
    ),
  );
  await scheduleLifecycleMessages(db, a.tenantId, clock);
  assert.equal(
    (await notices(a, "workout-missed")).length,
    0,
    "Quiet hours defer without consuming the stable intent",
  );
  const afterQuiet = new Date(clock.getTime() + 2 * HOUR);
  const hold = await db.tenant(a, (tx) =>
    putRecord(
      tx,
      a,
      "training_hold",
      {},
      { ownerId: client.userId, status: "active" },
    ),
  );
  await scheduleLifecycleMessages(db, a.tenantId, afterQuiet);
  assert.equal(
    (await notices(a, "workout-missed")).length,
    0,
    "Safety holds prevent a missed-workout nudge",
  );
  await db.tenant(a, (tx) =>
    tx.query("UPDATE records SET status='resolved' WHERE id=$1", [hold.id]),
  );
  await scheduleLifecycleMessages(db, a.tenantId, afterQuiet);
  const [notice] = await notices(a, "workout-missed");
  assert.ok(notice);
  assert.equal(notice.email_status, "suppressed");
  assert.equal(notice.data.source.policyVersion, 1);
  assert.match(notice.body, /without a recorded completion/);
  await scheduleLifecycleMessages(db, a.tenantId, afterQuiet);
  assert.equal((await notices(a, "workout-missed")).length, 1);
  assert.equal(
    (
      await db.tenant(a, (tx) =>
        tx.query("SELECT id FROM jobs WHERE data->>'notificationId'=$1", [
          notice.id,
        ]),
      )
    ).length,
    0,
  );
  assert.equal(
    (
      await policyRequest(a, {
        version: 1,
        data: { enabled: false, missedAfterDays: 2 },
      })
    ).statusCode,
    200,
  );
  assert.equal(
    await lifecycleMessageCurrent(
      db,
      a.tenantId,
      client.userId,
      notice.data.source,
      afterQuiet,
    ),
    false,
  );
});
