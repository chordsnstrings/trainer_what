import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createDatabase,
  type Database,
  type Actor,
  putRecord,
} from "@trainer/db";
import { buildApp, processStripeEvent } from "../apps/api/src/app.ts";
import {
  recordCharge,
  journal,
  createPayout,
  transitionPayout,
  financeSummary,
} from "../apps/api/src/finance.ts";
import {
  commission,
  projectedCommission,
  validUaeIban,
  allowedModelEvidence,
  safetySignal,
} from "@trainer/domain";
let db: Database,
  app: Awaited<ReturnType<typeof buildApp>>,
  a: any,
  b: any,
  subscriber: any;
const origin = "http://localhost:3000";
async function request(
  url: string,
  method: any = "GET",
  body?: any,
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
    payload: body,
  });
}
async function register(slug: string) {
  const r = await request("/auth/register", "POST", {
    name: `Coach ${slug}`,
    email: `${slug}@example.test`,
    password: "TestingOnly2026!",
    slug,
    accepted: true,
  });
  assert.equal(r.statusCode, 201, r.body);
  const cookie = String(r.headers["set-cookie"]).split(";")[0];
  const boot = await request("/bootstrap", "GET", undefined, cookie);
  assert.equal(boot.statusCode, 200, boot.body);
  return { ...boot.json().user, cookie };
}
before(async () => {
  db = await createDatabase({ memory: true });
  app = await buildApp({ db, testing: true });
  a = await register("coach-one");
  b = await register("coach-two");
  const invite = await request(
    "/invitations",
    "POST",
    { email: "client@example.test", role: "subscriber" },
    a.cookie,
  );
  assert.equal(invite.statusCode, 200, invite.body);
  const token = invite.json().url.split("/").pop();
  const joined = await request("/invitations/accept", "POST", {
    token,
    name: "Test Client",
    email: "client@example.test",
    password: "TestingClient2026!",
  });
  assert.equal(joined.statusCode, 200, joined.body);
  const cookie = String(joined.headers["set-cookie"]).split(";")[0];
  subscriber = {
    ...(await request("/bootstrap", "GET", undefined, cookie)).json().user,
    cookie,
  };
});
after(async () => {
  await app.close();
  await db.close();
});
test("commission boundaries use marginal bands and exact minor-unit arithmetic", () => {
  for (const [n, want] of [
    [99, 247500],
    [100, 250000],
    [101, 252000],
    [300, 650000],
    [301, 651500],
    [1000, 1700000],
    [1001, 1701000],
  ])
    assert.equal(projectedCommission(n, 10000), want);
  assert.equal(commission(20000, 101), 4000);
  assert.throws(() => commission(-1, 1));
});
test("UAE IBAN checksum and safety/data rights gates", () => {
  assert.equal(validUaeIban("AE070331234567890123456"), true);
  assert.equal(validUaeIban("AE070331234567890123457"), false);
  assert.equal(safetySignal("I have chest pain during this set"), true);
  assert.throws(() =>
    allowedModelEvidence([
      { id: randomUUID(), data: { origin: "whoop", allowedUses: ["render"] } },
    ]),
  );
});
test("unauthenticated and foreign-origin mutations are rejected", async () => {
  assert.equal((await request("/bootstrap")).statusCode, 401);
  const bad = await app.inject({
    url: "/api/v1/tenant/brand",
    method: "PUT",
    headers: { origin: "https://attacker.test", cookie: a.cookie },
    payload: { name: "Hijacked" },
  });
  assert.equal(bad.statusCode, 403);
});
test("tenant records cannot cross the API or database boundary", async () => {
  const r = await request(
    "/brain/rules",
    "POST",
    {
      title: "Technique first",
      category: "progression",
      condition: "Technique is inconsistent",
      directive: "Keep load unchanged",
      reason: "Build movement consistency",
      sourceIds: [],
    },
    a.cookie,
  );
  assert.equal(r.statusCode, 200, r.body);
  const rid = r.json().id;
  assert.equal(
    (await request(`/brain/rules/${rid}/confirm`, "POST", {}, b.cookie))
      .statusCode,
    404,
  );
  assert.equal(
    (
      await db.tenant(b, (tx) =>
        tx.query("SELECT * FROM records WHERE id=$1", [rid]),
      )
    ).length,
    0,
  );
  await assert.rejects(
    db.tenant(b, (tx) =>
      tx.query(
        "INSERT INTO records(id,tenant_id,kind,data) VALUES($1,$2,'rule','{}')",
        [randomUUID(), a.tenantId],
      ),
    ),
  );
  assert.equal(
    (await request(`/brain/rules/${rid}/confirm`, "POST", {}, a.cookie))
      .statusCode,
    200,
  );
});
test("subscriber cannot perform trainer actions and invitation is single-use", async () => {
  assert.equal(
    (
      await request(
        "/products",
        "POST",
        { name: "Unauthorized", description: "", priceMinor: 10000 },
        subscriber.cookie,
      )
    ).statusCode,
    403,
  );
  const boot = (
    await request("/bootstrap", "GET", undefined, subscriber.cookie)
  ).json();
  assert.equal(boot.records.filter((r: any) => r.kind === "rule").length, 0);
  assert.equal(boot.finance, undefined);
});
test("intake is persisted with consent and revocation removes model permission", async () => {
  const r = await request(
    "/intake",
    "POST",
    {
      age: 30,
      goal: "Build strength",
      experience: "beginner",
      daysPerWeek: 3,
      equipment: "Dumbbells",
      limitations: "None reported",
      consent: true,
    },
    subscriber.cookie,
  );
  assert.equal(r.statusCode, 200, r.body);
  const revoke = await request(
    "/privacy/consent",
    "POST",
    { type: "coaching", granted: false },
    subscriber.cookie,
  );
  assert.equal(revoke.statusCode, 200, revoke.body);
  const boot = (
    await request("/bootstrap", "GET", undefined, subscriber.cookie)
  ).json();
  assert.deepEqual(
    boot.records.find((r: any) => r.kind === "intake").data.allowedUses,
    ["render"],
  );
  assert.equal(boot.consents.length, 2);
});
test("paid workout logs replay once and pain blocks normal completion", async () => {
  await db.tenant(a, (tx) =>
    tx.query(
      "INSERT INTO subscriptions(id,tenant_id,user_id,status,period_end,price_minor) VALUES($1,$2,$3,'active',now()+interval '30 days',10000)",
      [randomUUID(), a.tenantId, subscriber.userId],
    ),
  );
  const p = await request(
    "/programs",
    "POST",
    {
      subscriberId: subscriber.userId,
      program: {
        title: "Foundation",
        goal: "Controlled movement",
        daysPerWeek: 3,
        exercises: [
          {
            name: "Goblet squat",
            sets: 3,
            reps: 10,
            restSeconds: 90,
            loadKg: 12,
            cue: "Controlled reps",
          },
        ],
      },
    },
    a.cookie,
  );
  assert.equal(p.statusCode, 200, p.body);
  const start = await request(
    "/workouts/start",
    "POST",
    { programId: p.json().id },
    subscriber.cookie,
  );
  assert.equal(start.statusCode, 200, start.body);
  const wid = start.json().id;
  const set = {
    eventKey: randomUUID(),
    exercise: "Goblet squat",
    set: 1,
    reps: 10,
    loadKg: 12,
  };
  assert.equal(
    (await request(`/workouts/${wid}/sets`, "POST", set, subscriber.cookie))
      .statusCode,
    200,
  );
  assert.equal(
    (
      await request(`/workouts/${wid}/sets`, "POST", set, subscriber.cookie)
    ).json().duplicate,
    true,
  );
  assert.equal(
    (await request("/bootstrap", "GET", undefined, subscriber.cookie)).json()
      .sets.length,
    1,
  );
  const pain = await request(
    `/workouts/${wid}/pain`,
    "POST",
    { description: "New sharp pain" },
    subscriber.cookie,
  );
  assert.equal(pain.statusCode, 200, pain.body);
  assert.equal(
    (await request(`/workouts/${wid}/finish`, "POST", {}, subscriber.cookie))
      .statusCode,
    409,
  );
});
test("ledger is balanced, immutable and idempotent at the source boundary", async () => {
  await db.tenant(a, async (tx) => {
    await recordCharge(tx, a, "test-charge-1", 10000, 1);
    assert.equal(await recordCharge(tx, a, "test-charge-1", 10000, 1), null);
  });
  const summary = await db.tenant(a, financeSummary);
  assert.equal(summary.earnedMinor, 7500);
  await assert.rejects(
    db.tenant(a, (tx) => tx.query("UPDATE journal_lines SET amount_minor=1")),
  );
  await assert.rejects(
    db.tenant(a, (tx) =>
      journal(tx, a, "invalid", "Invalid", [
        { account: "bank", amount: 100 },
        { account: "income", amount: -99 },
      ]),
    ),
  );
  await assert.rejects(
    db.tenant(a, (tx) =>
      tx.query(
        "INSERT INTO journals(id,tenant_id,source_key,description) VALUES($1,$2,$3,$4)",
        [randomUUID(), a.tenantId, "empty", "Unbalanced empty journal"],
      ),
    ),
  );
  assert.equal(
    (await db.tenant(b, (tx) => tx.query("SELECT * FROM journals"))).length,
    0,
  );
});
test("payout allocation survives replay, unknown outcome and return without double payment", async () => {
  await db.tenant(a, async (tx) => {
    await journal(tx, a, "settlement-fixture", "Synthetic funding", [
      { account: "bank_cash", amount: 10000 },
      { account: "stripe_receivable", amount: -10000 },
    ]);
    await putRecord(
      tx,
      a,
      "close",
      {
        period: "2026-09",
        cutoff: new Date().toISOString(),
        eligibleMinor: 7500,
      },
      { status: "closed" },
    );
  });
  const p = await db.tenant(a, (tx) =>
    createPayout(tx, a, "2026-09", "beneficiary-test"),
  );
  assert.equal(Number(p.amount_minor), 7500);
  assert.equal(
    (
      await db.tenant(a, (tx) =>
        createPayout(tx, a, "2026-09", "beneficiary-test"),
      )
    ).id,
    p.id,
  );
  await assert.rejects(
    db.tenant(a, (tx) => createPayout(tx, a, "2026-10", "beneficiary-test")),
  );
  await db.tenant(a, (tx) => transitionPayout(tx, a, p.id, "submitted"));
  await db.tenant(a, (tx) => transitionPayout(tx, a, p.id, "unknown"));
  await assert.rejects(
    db.tenant(a, (tx) => transitionPayout(tx, a, p.id, "submitted")),
  );
  await assert.rejects(
    db.tenant(a, (tx) => transitionPayout(tx, a, p.id, "paid")),
  );
  await db.tenant(a, (tx) =>
    transitionPayout(tx, a, p.id, "paid", "bank-confirmed-reference"),
  );
  assert.equal((await db.tenant(a, financeSummary)).earnedMinor, 0);
  await db.tenant(a, (tx) =>
    transitionPayout(tx, a, p.id, "paid", "bank-confirmed-reference"),
  );
  assert.equal((await db.tenant(a, financeSummary)).earnedMinor, 0);
  await db.tenant(a, (tx) =>
    transitionPayout(tx, a, p.id, "returned", "bank-return-reference"),
  );
  assert.equal((await db.tenant(a, financeSummary)).earnedMinor, 7500);
});
test("verified invoice replay creates a single financial effect", async () => {
  const e = {
    id: "evt_fixture",
    type: "invoice.paid",
    data: {
      object: {
        id: "in_fixture",
        amount_paid: 20000,
        currency: "aed",
        metadata: { tenant_id: a.tenantId, user_id: subscriber.userId },
        subscription: "sub_fixture",
        charge: "ch_fixture",
        period_end: Math.floor(Date.now() / 1000) + 86400,
      },
    },
  };
  await processStripeEvent(db, e);
  await processStripeEvent(db, e);
  const rows = await db.tenant(a, (tx) =>
    tx.query(
      "SELECT * FROM journals WHERE source_key='stripe-invoice:in_fixture'",
    ),
  );
  assert.equal(rows.length, 1);
});
test("committed journals cannot be amended by appending balanced lines", async () => {
  const [j] = await db.tenant(a, (tx) =>
    tx.query("SELECT id FROM journals WHERE source_key='test-charge-1'"),
  );
  await assert.rejects(
    db.tenant(a, async (tx) => {
      for (const amount of [100, -100])
        await tx.query(
          "INSERT INTO journal_lines(id,tenant_id,journal_id,account,amount_minor) VALUES($1,$2,$3,$4,$5)",
          [randomUUID(), a.tenantId, j.id, "bank_cash", amount],
        );
    }),
  );
});
test("full refund reverses original trainer earnings and commission once", async () => {
  const before = await db.tenant(a, financeSummary);
  const e = {
    id: "evt_refund",
    type: "refund.updated",
    data: {
      object: {
        id: "re_fixture",
        object: "refund",
        charge: "ch_fixture",
        amount: 20000,
        currency: "aed",
        status: "succeeded",
      },
    },
  };
  await processStripeEvent(db, e);
  await processStripeEvent(db, e);
  const after = await db.tenant(a, financeSummary);
  assert.equal(before.earnedMinor - after.earnedMinor, 15000);
  assert.equal(before.commissionMinor - after.commissionMinor, 5000);
});
test("dispute reserve is released on win and duplicate outcomes are inert", async () => {
  const invoice = {
    id: "evt_dispute_charge",
    type: "invoice.paid",
    data: {
      object: {
        id: "in_disputed",
        amount_paid: 10000,
        currency: "aed",
        metadata: { tenant_id: a.tenantId, user_id: subscriber.userId },
        subscription: "sub_fixture",
        charge: "ch_disputed",
        period_end: Math.floor(Date.now() / 1000) + 86400,
      },
    },
  };
  await processStripeEvent(db, invoice);
  const before = await db.tenant(a, financeSummary);
  const created = {
    id: "evt_dispute_open",
    type: "charge.dispute.created",
    data: {
      object: {
        id: "dp_fixture",
        charge: "ch_disputed",
        amount: 10000,
        currency: "aed",
        status: "needs_response",
      },
    },
  };
  await processStripeEvent(db, created);
  assert.equal(
    (await db.tenant(a, financeSummary)).earnedMinor,
    before.earnedMinor - 10000,
  );
  const closed = {
    ...created,
    id: "evt_dispute_closed",
    type: "charge.dispute.closed",
    data: { object: { ...created.data.object, status: "won" } },
  };
  await processStripeEvent(db, closed);
  await processStripeEvent(db, closed);
  assert.equal(
    (await db.tenant(a, financeSummary)).earnedMinor,
    before.earnedMinor,
  );
});
test("older subscription events do not reactivate a canceled membership", async () => {
  const event = {
    id: "evt_cancel",
    created: 200,
    type: "customer.subscription.deleted",
    data: {
      object: {
        id: "sub_fixture",
        object: "subscription",
        metadata: { tenant_id: a.tenantId, user_id: subscriber.userId },
        status: "canceled",
        current_period_end: Math.floor(Date.now() / 1000) + 86400,
      },
    },
  };
  await processStripeEvent(db, event);
  await processStripeEvent(db, {
    ...event,
    id: "evt_old",
    created: 100,
    type: "customer.subscription.updated",
    data: { object: { ...event.data.object, status: "active" } },
  });
  const [s] = await db.tenant(a, (tx) =>
    tx.query("SELECT status FROM subscriptions WHERE provider_id=$1", [
      "sub_fixture",
    ]),
  );
  assert.equal(s.status, "canceled");
});

test("subscribers cannot read internal decisions, teaching rules or another tenant directory", async () => {
  const draft = await db.tenant(a, (tx) =>
    putRecord(
      tx,
      a,
      "decision",
      { message: "Unapproved draft", requiresHumanReview: true },
      { ownerId: subscriber.userId, status: "pending_review" },
    ),
  );
  const internal = await db.tenant(subscriber, (tx) =>
    tx.query("SELECT id FROM records WHERE id=$1", [draft.id]),
  );
  assert.equal(internal.length, 0);
  const [foreign] = await db.tenant(a, (tx) =>
    tx.query("SELECT id FROM users WHERE id=$1", [b.userId]),
  );
  assert.equal(foreign, undefined);
  await assert.rejects(
    db.tenant(a, (tx) => tx.query("SELECT password_hash FROM users")),
  );
  await assert.rejects(
    db.tenant(a, (tx) => tx.query("SELECT token_hash FROM sessions")),
  );
});

test("authenticator verification is required for login and cannot be replayed through invitations", async () => {
  const { totpAt } = await import("../apps/api/src/security.ts");
  process.env.SECURITY_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  const secure = await register("secure-coach");
  const enrollment = await request(
    "/auth/mfa/enroll",
    "POST",
    { password: "TestingOnly2026!" },
    secure.cookie,
  );
  assert.equal(enrollment.statusCode, 200, enrollment.body);
  const secret = enrollment.json().secret;
  const [stored] = await db.system((tx) =>
    tx.query("SELECT pending_secret FROM user_security WHERE user_id=$1", [
      secure.userId,
    ]),
  );
  assert.notEqual(stored.pending_secret, secret);
  assert(!stored.pending_secret.includes(secret));
  const instant = Date.now(),
    code = totpAt(secret, Math.floor(instant / 30000));
  const confirmed = await request(
    "/auth/mfa/confirm",
    "POST",
    { code },
    secure.cookie,
  );
  assert.equal(confirmed.statusCode, 200, confirmed.body);
  const missing = await request("/auth/login", "POST", {
    email: secure.email,
    password: "TestingOnly2026!",
  });
  assert.equal(missing.statusCode, 401);
  const replay = await request("/auth/login", "POST", {
    email: secure.email,
    password: "TestingOnly2026!",
    code,
  });
  assert.equal(replay.statusCode, 401);
  const now = Date.now;
  try {
    Date.now = () => instant + 31000;
    const login = await request("/auth/login", "POST", {
      email: secure.email,
      password: "TestingOnly2026!",
      code: totpAt(secret, Math.floor(Date.now() / 30000)),
    });
    assert.equal(login.statusCode, 200, login.body);
  } finally {
    Date.now = now;
  }
  const invited = await request(
    "/invitations",
    "POST",
    { email: secure.email, role: "subscriber" },
    a.cookie,
  );
  const bypass = await request("/invitations/accept", "POST", {
    token: invited.json().url.split("/").pop(),
    name: "Secure Coach",
    email: secure.email,
    password: "TestingOnly2026!",
  });
  assert.equal(bypass.statusCode, 401, bypass.body);
});

test("password recovery is single-use and revokes existing sessions", async () => {
  const person = await register("reset-coach");
  const result = await request("/auth/forgot-password", "POST", {
    email: person.email,
  });
  assert.equal(result.statusCode, 200);
  const unknown = await request("/auth/forgot-password", "POST", {
    email: "nobody@example.test",
  });
  assert.deepEqual(unknown.json(), result.json());
  const [job] = await db.tenant(person, (tx) =>
    tx.query(
      "SELECT data FROM jobs WHERE kind='email' ORDER BY created_at DESC LIMIT 1",
    ),
  );
  const token = job.data.text.split("\n")[0].split("/").pop();
  const reset = await request("/auth/reset-password", "POST", {
    token,
    password: "ReplacementPassword2026!",
  });
  assert.equal(reset.statusCode, 200, reset.body);
  assert.equal(
    (await request("/bootstrap", "GET", undefined, person.cookie)).statusCode,
    401,
  );
  assert.equal(
    (
      await request("/auth/reset-password", "POST", {
        token,
        password: "AnotherPassword2026!",
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await request("/auth/login", "POST", {
        email: person.email,
        password: "TestingOnly2026!",
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await request("/auth/login", "POST", {
        email: person.email,
        password: "ReplacementPassword2026!",
      })
    ).statusCode,
    200,
  );
});

test("booking capacity is serialized and a canceled seat can be reserved again", async () => {
  const clients = [];
  for (const suffix of ["one", "two"]) {
    const invite = await request(
      "/invitations",
      "POST",
      { email: `booking-${suffix}@example.test`, role: "subscriber" },
      a.cookie,
    );
    const join = await request("/invitations/accept", "POST", {
      name: `Booking ${suffix}`,
      email: `booking-${suffix}@example.test`,
      password: "BookingOnly2026!",
      token: invite.json().url.split("/").pop(),
    });
    const cookie = String(join.headers["set-cookie"]).split(";")[0];
    const user = (await request("/bootstrap", "GET", undefined, cookie)).json()
      .user;
    clients.push({ ...user, cookie });
    await db.tenant(a, (tx) =>
      tx.query(
        "INSERT INTO subscriptions(id,tenant_id,user_id,status,period_end) VALUES($1,$2,$3,'active',now()+interval '30 days')",
        [randomUUID(), a.tenantId, user.userId],
      ),
    );
  }
  const start = Date.now() + 7 * 86400000;
  const slot = await request(
    "/bookings/slots",
    "POST",
    {
      title: "Coaching session",
      location: "Test studio",
      startsAt: new Date(start).toISOString(),
      endsAt: new Date(start + 3600000).toISOString(),
      capacity: 1,
    },
    a.cookie,
  );
  assert.equal(slot.statusCode, 200, slot.body);
  const url = "/bookings/slots/" + slot.json().id + "/reserve";
  const results = await Promise.all(
    clients.map((c) => request(url, "POST", {}, c.cookie)),
  );
  assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 409]);
  const win = results.findIndex((r) => r.statusCode === 200),
    lose = 1 - win;
  assert.equal(
    (await request(url, "POST", {}, clients[win].cookie)).json().id,
    results[win].json().id,
  );
  const list = await request(
    "/bookings",
    "GET",
    undefined,
    clients[lose].cookie,
  );
  assert.equal(list.json().bookings.length, 0);
  assert.equal(list.json().slots[0].booked, 1);
  assert.equal(
    (
      await request(
        "/bookings/" + results[win].json().id + "/cancel",
        "POST",
        {},
        clients[win].cookie,
      )
    ).statusCode,
    200,
  );
  assert.equal(
    (await request(url, "POST", {}, clients[lose].cookie)).statusCode,
    200,
  );
  const foreign = await request("/bookings", "GET", undefined, b.cookie);
  assert.equal(foreign.json().slots.length, 0);
});

test("a workout retry with changed payload is rejected even after the safety hold", async () => {
  const [set] = await db.tenant(a, (tx) =>
    tx.query("SELECT * FROM workout_events WHERE user_id=$1 LIMIT 1", [
      subscriber.userId,
    ]),
  );
  const replay = await request(
    "/workouts/" + set.workout_id + "/sets",
    "POST",
    set.data,
    subscriber.cookie,
  );
  assert.equal(replay.statusCode, 200, replay.body);
  const changed = await request(
    "/workouts/" + set.workout_id + "/sets",
    "POST",
    { ...set.data, reps: set.data.reps + 1 },
    subscriber.cookie,
  );
  assert.equal(changed.statusCode, 409);
  assert.equal(changed.json().code, "INTENT_CONFLICT");
});

test("monthly close respects Dubai cutoff and refuses open periods", async () => {
  const { monthCutoff, closeMonth } =
    await import("../apps/api/src/finance-operations.ts");
  assert.equal(
    monthCutoff("2026-09").toISOString(),
    "2026-09-30T20:00:00.000Z",
  );
  await assert.rejects(
    db.tenant(b, (tx) =>
      closeMonth(
        tx,
        b,
        "2026-10",
        "Synthetic evidence",
        new Date("2026-10-01"),
      ),
    ),
  );
  await assert.rejects(
    db.tenant(b, (tx) => createPayout(tx, b, "2026-08", "fixture-beneficiary")),
  );
});

test("unsupported providers do not create simulated model outputs or checkout payments", async () => {
  const source = await request(
    "/brain/sources",
    "POST",
    {
      title: "Fixture source",
      text: "I always progress volume conservatively and review new pain.",
      rights: true,
    },
    b.cookie,
  );
  assert.equal(source.statusCode, 200);
  const compile = await request(
    "/brain/compile",
    "POST",
    { sourceIds: [source.json().id] },
    b.cookie,
  );
  assert.equal(compile.statusCode, 503, compile.body);
  const rows = await db.tenant(b, (tx) =>
    tx.query("SELECT id FROM records WHERE kind='rule'"),
  );
  assert.equal(rows.length, 0);
  const checkout = await request(
    "/payments/checkout",
    "POST",
    { productId: randomUUID() },
    subscriber.cookie,
  );
  assert.equal(checkout.statusCode, 503);
});

test("support conversations remain scoped to their owner and trainer", async () => {
  const created = await request(
    "/support",
    "POST",
    {
      subject: "Account question",
      message: "Please help me update my training preferences.",
      category: "account",
    },
    subscriber.cookie,
  );
  assert.equal(created.statusCode, 200, created.body);
  const foreign = await request(
    "/support/" + created.json().id + "/reply",
    "POST",
    { message: "Unauthorized reply" },
    b.cookie,
  );
  assert.equal(foreign.statusCode, 404);
  const answer = await request(
    "/support/" + created.json().id + "/reply",
    "POST",
    { message: "Your preferences are in your profile.", resolve: true },
    a.cookie,
  );
  assert.equal(answer.statusCode, 200, answer.body);
  const [stored] = await db.tenant(subscriber, (tx) =>
    tx.query("SELECT status,data FROM records WHERE id=$1", [
      created.json().id,
    ]),
  );
  assert.equal(stored.status, "resolved");
  assert.equal(stored.data.messages.length, 2);
});

test("Stripe webhook signatures are verified before durable event processing", async () => {
  const { createHmac } = await import("node:crypto");
  process.env.STRIPE_SECRET_KEY = "sk_test_fixture_not_a_credential";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_fixture_not_a_credential";
  const payload = {
    id: "evt_signed_fixture",
    created: Math.floor(Date.now() / 1000),
    type: "invoice.paid",
    data: {
      object: {
        id: "in_signed_fixture",
        amount_paid: 1000,
        currency: "aed",
        metadata: { tenant_id: a.tenantId, user_id: subscriber.userId },
        subscription: "sub_fixture",
        charge: "ch_signed_fixture",
        period_end: Math.floor(Date.now() / 1000) + 86400,
      },
    },
  };
  const raw = JSON.stringify(payload),
    timestamp = Math.floor(Date.now() / 1000),
    signature = createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET)
      .update(timestamp + "." + raw)
      .digest("hex");
  try {
    const bad = await app.inject({
      url: "/api/v1/webhooks/stripe",
      method: "POST",
      headers: {
        "content-type": "application/json",
        "stripe-signature": `t=${timestamp},v1=invalid`,
      },
      payload: raw,
    });
    assert.equal(bad.statusCode, 400);
    for (let i = 0; i < 2; i++) {
      const good = await app.inject({
        url: "/api/v1/webhooks/stripe",
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": `t=${timestamp},v1=${signature}`,
        },
        payload: raw,
      });
      assert.equal(good.statusCode, 200, good.body);
    }
    const rows = await db.tenant(a, (tx) =>
      tx.query(
        "SELECT id FROM journals WHERE source_key='stripe-invoice:in_signed_fixture'",
      ),
    );
    assert.equal(rows.length, 1);
  } finally {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
  }
});

test("returned payouts require a new revision and retain their original evidence", async () => {
  const p = await db.tenant(a, (tx) =>
    createPayout(tx, a, "2026-09", "beneficiary-test"),
  );
  assert.equal(p.revision, 2);
  const prior = await db.tenant(a, (tx) =>
    tx.query(
      "SELECT status,bank_reference FROM payouts WHERE period='2026-09' AND revision=1",
    ),
  );
  assert.equal(prior[0].status, "returned");
  assert.equal(prior[0].bank_reference, "bank-return-reference");
  assert.equal(
    (
      await db.tenant(a, (tx) =>
        createPayout(tx, a, "2026-09", "beneficiary-test"),
      )
    ).id,
    p.id,
  );
  await assert.rejects(
    db.tenant(a, (tx) =>
      tx.query("UPDATE records SET data='{}' WHERE kind='close'"),
    ),
  );
});

test("revoked coaching consent and trainer takeover prevent model generation", async () => {
  await db.tenant(a, (tx) =>
    tx.query(
      "UPDATE subscriptions SET status='active',period_end=now()+interval '30 days' WHERE user_id=$1",
      [subscriber.userId],
    ),
  );
  const denied = await request(
    "/coaching/ask",
    "POST",
    { message: "How should I adjust my routine?" },
    subscriber.cookie,
  );
  assert.equal(denied.statusCode, 409, denied.body);
  assert.equal(denied.json().code, "COACHING_CONSENT_REQUIRED");
  const takeover = await request(
    "/takeover",
    "POST",
    { subscriberId: subscriber.userId, active: true },
    a.cookie,
  );
  assert.equal(takeover.statusCode, 200, takeover.body);
  const routed = await request(
    "/coaching/ask",
    "POST",
    { message: "Can you review my training routine?" },
    subscriber.cookie,
  );
  assert.equal(routed.statusCode, 200, routed.body);
  assert.equal(routed.json().data.author, "system");
  const pending = await db.tenant(a, (tx) =>
    tx.query(
      "SELECT id FROM records WHERE kind='exception' AND data->>'category'='human_review' AND owner_user_id=$1",
      [subscriber.userId],
    ),
  );
  assert(pending.length > 0);
});
