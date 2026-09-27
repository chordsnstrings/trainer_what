import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import {
  createDatabase,
  putRecord,
  type Database,
  type Actor,
} from "@trainer/db";
import {
  registerAcquisition,
  safeAcquisitionTouch,
  recordSignupAcquisition,
  recordPublishAcquisition,
  recordFirstPaidAcquisition,
  exportAcquisitionData,
  eraseAcquisitionData,
  purgeExpiredAcquisition,
} from "../apps/api/src/acquisition.ts";
import { registerAdminOperations } from "../apps/api/src/admin-operations.ts";
import { recordCharge } from "../apps/api/src/finance.ts";
import { tokenHash } from "../apps/api/src/auth.ts";
import { processStripeEvent } from "../apps/api/src/stripe-events.ts";
import {
  exportPersonalData,
  eraseMember,
} from "../apps/api/src/privacy-lifecycle.ts";
import { buildApp } from "../apps/api/src/app.ts";

let db: Database;
const app = Fastify({ logger: false });
const owner = { tenantId: randomUUID(), userId: randomUUID(), role: "owner" };
const other = { tenantId: randomUUID(), userId: randomUUID(), role: "owner" };
const client = {
  tenantId: owner.tenantId,
  userId: randomUUID(),
  role: "subscriber",
};
const origin = "https://platform.acquisition.test";
function context(custom = false) {
  return {
    host: custom ? "coach.acquisition.test" : "platform.acquisition.test",
    origin: custom ? "https://coach.acquisition.test" : origin,
    tenantId: custom ? owner.tenantId : null,
    tenantSlug: custom ? "acquisition-coach" : null,
    custom,
    verifiedProxy: true,
  };
}
function fixtureRequest(value: string, custom = false, a?: Actor): any {
  return {
    cookies: { acquisition: value.split("=")[1] },
    hostContext: context(custom),
    ...(a ? { identity: { ...a, platformRole: "none" } } : {}),
  };
}
function request(
  path: string,
  method: any = "GET",
  payload?: any,
  value?: string,
  custom = false,
  extra: Record<string, string> = {},
) {
  return app.inject({
    url: "/api/v1/" + path,
    method,
    payload,
    headers: {
      origin: context(custom).origin,
      ...(value ? { cookie: value } : {}),
      ...(custom ? { "x-fixture-host": "custom" } : {}),
      ...extra,
    },
  });
}
async function permit(touch: any = {}, custom = false) {
  const response = await request(
    "public/acquisition/consent",
    "POST",
    { granted: true, touch },
    undefined,
    custom,
  );
  assert.equal(response.statusCode, 200, response.body);
  return {
    cookie: String(response.headers["set-cookie"]).split(";")[0],
    response,
  };
}
async function consent(value: string) {
  return (
    await db.system((tx) =>
      tx.query("SELECT * FROM acquisition_consents WHERE token_hash=$1", [
        tokenHash(value.split("=")[1]),
      ]),
    )
  )[0];
}
before(async () => {
  db = await createDatabase({ memory: true });
  await db.system(async (tx) => {
    for (const a of [owner, other, client])
      await tx.query(
        "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Acquisition fixture','unused')",
        [a.userId, a.userId + "@fixture.test"],
      );
    for (const a of [owner, other])
      await tx.query(
        "INSERT INTO tenants(id,slug,name) VALUES($1,$2,'Acquisition fixture')",
        [a.tenantId, a.tenantId],
      );
    for (const a of [owner, other, client])
      await tx.query(
        "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)",
        [a.tenantId, a.userId, a.role],
      );
  });
  await app.register(cookie);
  app.addHook("onRequest", async (req) => {
    req.hostContext = context(req.headers["x-fixture-host"] === "custom");
    if (req.headers["x-fixture-user"]) {
      const a = req.headers["x-fixture-user"] === "other" ? other : owner;
      req.identity = {
        ...a,
        platformRole:
          req.headers["x-fixture-role"] === "admin" ? "admin" : "none",
        name: "Fixture",
        email: "fixture@test.invalid",
        emailVerified: true,
        mfaAt: new Date().toISOString(),
      };
    }
  });
  app.setErrorHandler((error: any, _req, reply) =>
    reply
      .code(error.statusCode ?? (error.name === "ZodError" ? 400 : 500))
      .send({ code: error.code, message: error.message }),
  );
  registerAcquisition(app, db);
  registerAdminOperations(app, db, (req) => {
    if (!req.identity)
      throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
    return req.identity;
  });
});
after(async () => {
  await app.close();
  await db.close();
});

test("no analytics cookie or event exists before explicit consent and forged legacy consent is rejected", async () => {
  const status = await request("public/acquisition/consent");
  assert.deepEqual(status.json(), { granted: false });
  assert.equal(status.headers["set-cookie"], undefined);
  const forged =
    "acquisition=" +
    encodeURIComponent(
      JSON.stringify({
        consent: true,
        visitorId: randomUUID(),
        source: "site",
      }),
    );
  assert.deepEqual(
    (await request("public/acquisition/visit", "POST", {}, forged)).json(),
    { recorded: false },
  );
  assert.equal(
    (
      await request("public/acquisition/consent", "POST", {
        granted: false,
        touch: {},
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await request(
        "public/acquisition/consent",
        "POST",
        { granted: true, touch: {} },
        undefined,
        false,
        { origin: "https://foreign.invalid" },
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (await db.system((tx) => tx.query("SELECT * FROM acquisition_events")))
      .length,
    0,
  );
  assert.equal(
    (await db.system((tx) => tx.query("SELECT * FROM acquisition_consents")))
      .length,
    0,
  );
});

test("opt-in creates an opaque HttpOnly cookie and first/last attribution retains only permitted fields", async () => {
  const { cookie: value, response } = await permit({
    source: "instagram",
    campaign: "spring_2026",
    medium: "social",
    referral: "coach_12",
  });
  assert.match(String(response.headers["set-cookie"]), /HttpOnly/);
  assert.match(String(response.headers["set-cookie"]), /Secure/);
  assert.match(String(response.headers["set-cookie"]), /SameSite=Lax/);
  assert.match(value, /^acquisition=[A-Za-z0-9_-]{43}$/);
  assert.ok(!value.includes("instagram"));
  const row = await consent(value);
  assert.ok(!JSON.stringify(response.json()).includes(row.token_hash));
  assert.equal(response.json().visitorId, undefined);
  await request(
    "public/acquisition/visit",
    "POST",
    { source: "newsletter", campaign: "summer", medium: "email" },
    value,
  );
  await request(
    "public/acquisition/visit",
    "POST",
    { source: "newsletter", campaign: "summer", medium: "email" },
    value,
  );
  await request("public/acquisition/visit", "POST", {}, value);
  const read = (
    await request("public/acquisition/consent", "GET", undefined, value)
  ).json();
  assert.equal(read.firstTouch.source, "instagram");
  assert.equal(read.lastTouch.source, "newsletter");
  assert.equal(read.firstTouch.referral, "coach_12");
  assert.match(read.policyVersion, /optional-analytics:v1/);
  const events = await db.system((tx) =>
    tx.query("SELECT * FROM acquisition_events WHERE visitor_id=$1", [
      row.visitor_id,
    ]),
  );
  assert.equal(
    events.length,
    2,
    "identical visits are deduplicated per day and attribution",
  );
  assert.equal(events[1].source, "instagram");
  assert.equal(
    (
      await request(
        "public/acquisition/visit",
        "POST",
        { source: "site", health: "private" },
        value,
      )
    ).statusCode,
    400,
  );
  assert.deepEqual(
    safeAcquisitionTouch({
      source: "https://secret.invalid/path",
      campaign: "name@example.test",
      medium: "medical-condition",
      referral: "https://evil.invalid",
    }),
    { source: "other", campaign: "", medium: "", referral: "" },
  );
});

test("consent cannot cross a verified host or be reassigned to another workspace/user", async () => {
  const scoped = await permit({ source: "referral" }, true);
  assert.equal(
    (
      await request(
        "public/acquisition/consent",
        "GET",
        undefined,
        scoped.cookie,
      )
    ).json().granted,
    false,
  );
  assert.equal(
    await recordSignupAcquisition(
      db,
      fixtureRequest(scoped.cookie, true),
      other,
    ),
    false,
  );
  assert.equal(
    await recordSignupAcquisition(
      db,
      fixtureRequest(scoped.cookie, true),
      client,
      "enroll",
    ),
    true,
  );
  assert.equal(
    await recordSignupAcquisition(
      db,
      fixtureRequest(scoped.cookie, true),
      client,
      "enroll",
    ),
    false,
  );
  assert.equal(
    (
      await request(
        "public/acquisition/consent",
        "GET",
        undefined,
        scoped.cookie,
        true,
        { "x-fixture-user": "other" },
      )
    ).json().granted,
    false,
  );
  assert.equal(
    await recordSignupAcquisition(
      db,
      fixtureRequest(scoped.cookie, true),
      owner,
    ),
    false,
  );
  await assert.rejects(
    db.tenant(other, (tx) => tx.query("SELECT * FROM acquisition_consents")),
    /permission denied/,
  );
  await assert.rejects(
    db.tenant(other, (tx) => tx.query("SELECT * FROM acquisition_events")),
    /permission denied/,
  );
});

let signupCookie: string;
test("signup, actual publication and first verified paid journal produce one conversion each", async () => {
  const permitted = await permit({
    source: "google",
    campaign: "launch",
    medium: "organic",
  });
  signupCookie = permitted.cookie;
  const req = fixtureRequest(signupCookie);
  assert.equal(await recordSignupAcquisition(db, req, owner), true);
  assert.equal(await recordSignupAcquisition(db, req, owner), false);
  assert.equal(await recordSignupAcquisition(db, req, other), false);
  assert.equal(await recordPublishAcquisition(db, owner.tenantId), false);
  await db.system((tx) =>
    tx.query("UPDATE tenants SET published=true WHERE id=$1", [owner.tenantId]),
  );
  assert.equal(await recordPublishAcquisition(db, owner.tenantId), true);
  assert.equal(await recordPublishAcquisition(db, owner.tenantId), false);
  assert.equal(
    await recordFirstPaidAcquisition(db, owner.tenantId, client.userId),
    false,
  );
  await db.tenant({ ...owner, role: "finance" }, (tx) =>
    recordCharge(
      tx,
      { ...owner, role: "finance" },
      "stripe-invoice:acquisition-fixture",
      10000,
      1,
      { userId: client.userId },
    ),
  );
  assert.equal(
    await recordFirstPaidAcquisition(db, owner.tenantId, client.userId),
    true,
  );
  assert.equal(
    await recordFirstPaidAcquisition(db, owner.tenantId, client.userId),
    false,
  );
  assert.equal(
    await recordFirstPaidAcquisition(db, other.tenantId, client.userId),
    false,
  );
  const signup = await consent(signupCookie);
  const actual = await db.system((tx) =>
    tx.query(
      "SELECT name FROM acquisition_events WHERE visitor_id=$1 AND name<>'landing' ORDER BY created_at",
      [signup.visitor_id],
    ),
  );
  assert.deepEqual(
    actual.map((row) => row.name),
    ["signup", "publish", "first_paid"],
  );
});

test("public copy experiments require active consent, an allowed surface, and matched observed assignment", async () => {
  const experimentId = randomUUID();
  await db.system((tx) =>
    tx.query(
      "INSERT INTO admin_experiments(id,key,title,surface,status,revision,allocation,variant_a,variant_b,metric,guardrail,created_by) VALUES($1,'landing-welcome','Welcome wording','landing','running',2,25,'Build your coaching app','Share your coaching method','signup','Stop if consent regresses',$2)",
      [experimentId, owner.userId],
    ),
  );
  assert.equal(
    (await request("public/experiments/landing-welcome")).json().variant,
    "control",
  );
  const { cookie: value } = await permit({ source: "direct" });
  const assignment = (
    await request("public/experiments/landing-welcome", "GET", undefined, value)
  ).json();
  assert.ok(["a", "b"].includes(assignment.variant));
  assert.equal(assignment.experimentId, experimentId);
  assert.deepEqual(
    (
      await request(
        "public/experiments/landing-welcome",
        "GET",
        undefined,
        value,
      )
    ).json(),
    assignment,
  );
  const own = (await consent(value)).visitor_id;
  assert.equal(
    (
      await db.system((tx) =>
        tx.query(
          "SELECT * FROM acquisition_events WHERE visitor_id=$1 AND name='experiment_exposure'",
          [own],
        ),
      )
    ).length,
    0,
    "delivering text alone is not exposure",
  );
  const path = "public/experiments/landing-welcome/exposure";
  assert.equal(
    (
      await request(
        path,
        "POST",
        { revision: 2, variant: assignment.variant === "a" ? "b" : "a" },
        value,
      )
    ).json().recorded,
    false,
  );
  assert.equal(
    (
      await request(
        path,
        "POST",
        { revision: 1, variant: assignment.variant },
        value,
      )
    ).json().recorded,
    false,
  );
  assert.equal(
    (
      await request(
        path,
        "POST",
        { revision: 2, variant: assignment.variant },
        value,
      )
    ).json().recorded,
    true,
  );
  assert.equal(
    (
      await request(
        path,
        "POST",
        { revision: 2, variant: assignment.variant },
        value,
      )
    ).json().recorded,
    false,
  );
  assert.equal(
    (
      await request(
        "public/experiments/onboarding-welcome",
        "GET",
        undefined,
        value,
      )
    ).json().variant,
    "control",
  );
  const custom = await permit({}, true);
  assert.equal(
    (
      await request(
        "public/experiments/landing-welcome",
        "GET",
        undefined,
        custom.cookie,
        true,
      )
    ).json().variant,
    "control",
  );
  const adminHeaders = { "x-fixture-user": "owner", "x-fixture-role": "admin" };
  const competing = await request(
    "admin/experiments",
    "POST",
    {
      key: "next-landing-copy",
      title: "Next wording",
      surface: "landing",
      allocation: 25,
      variantA: "Welcome back",
      variantB: "Build your practice",
      metric: "signup",
      guardrail: "Stop on permission regression",
    },
    undefined,
    false,
    adminHeaders,
  );
  assert.equal(competing.statusCode, 200, competing.body);
  const start = await request(
    `admin/experiments/${competing.json().id}/transition`,
    "POST",
    { revision: 1, status: "running", result: "Approved wording only test" },
    undefined,
    false,
    adminHeaders,
  );
  assert.equal(start.statusCode, 409);
  assert.equal(start.json().code, "EXPERIMENT_SURFACE_BUSY");
  const report = await request(
    "admin/operations/experiments",
    "GET",
    undefined,
    undefined,
    false,
    adminHeaders,
  );
  assert.equal(report.statusCode, 200, report.body);
  const observed = report
    .json()
    .rows.find((row: any) => row.id === experimentId);
  assert.equal(observed.exposures_a + observed.exposures_b, 1);
  await db.system((tx) =>
    tx.query(
      "UPDATE admin_experiments SET status='stopped',revision=3 WHERE id=$1",
      [experimentId],
    ),
  );
  assert.equal(
    (
      await request(
        path,
        "POST",
        { revision: 2, variant: assignment.variant },
        value,
      )
    ).json().recorded,
    false,
  );
  assert.equal(
    (
      await request(
        "public/experiments/landing-welcome",
        "GET",
        undefined,
        value,
      )
    ).json().variant,
    "control",
  );
});

test("withdrawal deletes the linked analytics history and old cookies cannot restart tracking or conversion", async () => {
  const row = await consent(signupCookie);
  const beforeExport = await db.system((tx) =>
    exportAcquisitionData(tx, owner.tenantId, owner.userId),
  );
  assert.ok(beforeExport.events.some((event) => event.name === "landing"));
  assert.ok(!JSON.stringify(beforeExport).includes(row.token_hash));
  assert.deepEqual(
    await db.system((tx) =>
      exportAcquisitionData(tx, other.tenantId, owner.userId),
    ),
    { consent: [], events: [] },
  );
  const revoke = await request(
    "public/acquisition/consent",
    "DELETE",
    undefined,
    signupCookie,
  );
  assert.equal(revoke.statusCode, 200);
  assert.equal(revoke.json().granted, false);
  assert.match(String(revoke.headers["set-cookie"]), /Expires=/);
  assert.equal(await consent(signupCookie), undefined);
  assert.equal(
    (
      await db.system((tx) =>
        tx.query("SELECT * FROM acquisition_events WHERE visitor_id=$1", [
          row.visitor_id,
        ]),
      )
    ).length,
    0,
  );
  assert.equal(
    (await request("public/acquisition/visit", "POST", {}, signupCookie)).json()
      .recorded,
    false,
  );
  assert.equal(await recordPublishAcquisition(db, owner.tenantId), false);
  assert.equal(
    await recordFirstPaidAcquisition(db, owner.tenantId, client.userId),
    false,
  );
});

test("expired consent stops tracking and privacy erasure removes anonymous events linked before signup", async () => {
  const permitted = await permit({
    source: "partner",
    referral: "partner_one",
  });
  await recordSignupAcquisition(db, fixtureRequest(permitted.cookie), other);
  const row = await consent(permitted.cookie);
  await db.system((tx) =>
    tx.query(
      "UPDATE acquisition_consents SET expires_at=now()-interval '1 second' WHERE visitor_id=$1",
      [row.visitor_id],
    ),
  );
  assert.equal(
    (
      await request(
        "public/acquisition/consent",
        "GET",
        undefined,
        permitted.cookie,
      )
    ).json().granted,
    false,
  );
  assert.equal(
    (
      await request("public/acquisition/visit", "POST", {}, permitted.cookie)
    ).json().recorded,
    false,
  );
  await db.system((tx) =>
    eraseAcquisitionData(tx, other.tenantId, other.userId),
  );
  assert.equal(await consent(permitted.cookie), undefined);
  assert.equal(
    (
      await db.system((tx) =>
        tx.query("SELECT * FROM acquisition_events WHERE visitor_id=$1", [
          row.visitor_id,
        ]),
      )
    ).length,
    0,
  );
  const sharedCustom = await permit({}, true),
    customRow = await consent(sharedCustom.cookie);
  await db.system((tx) => eraseAcquisitionData(tx, owner.tenantId));
  assert.equal(
    (
      await db.system((tx) =>
        tx.query("SELECT * FROM acquisition_events WHERE visitor_id=$1", [
          customRow.visitor_id,
        ]),
      )
    ).length,
    0,
  );
});

test("new consent cannot retroactively attribute a prior payment and onboarding copy stays with its signed-in owner", async () => {
  const permitted = await permit({
    source: "partner",
    campaign: "later_consent",
  });
  await recordSignupAcquisition(db, fixtureRequest(permitted.cookie), owner);
  assert.equal(
    await recordFirstPaidAcquisition(db, owner.tenantId, client.userId),
    false,
    "a prior payment predates this permission",
  );
  await db.system((tx) =>
    tx.query(
      "INSERT INTO admin_experiments(id,key,title,surface,status,revision,allocation,variant_a,variant_b,metric,guardrail,created_by) VALUES($1,'new-onboarding-copy','Onboarding wording','onboarding','running',2,20,'Teach your method','Build your coaching knowledge','publish','Stop on any permission regression',$2)",
      [randomUUID(), owner.userId],
    ),
  );
  const path = "public/experiments/onboarding-welcome";
  assert.equal(
    (await request(path, "GET", undefined, permitted.cookie)).json().variant,
    "control",
  );
  const own = await request(path, "GET", undefined, permitted.cookie, false, {
    "x-fixture-user": "owner",
  });
  assert.ok(["a", "b"].includes(own.json().variant));
  assert.equal(
    (
      await request(path, "GET", undefined, permitted.cookie, false, {
        "x-fixture-user": "other",
      })
    ).json().variant,
    "control",
  );
  assert.equal(
    (
      await request(
        "public/experiments/nutrition-targeting",
        "GET",
        undefined,
        permitted.cookie,
      )
    ).json().variant,
    "control",
  );
});

test("bounded expiry cleanup erases expired anonymous permission and its immutable analytics history", async () => {
  const permitted = await permit({ source: "direct" }),
    row = await consent(permitted.cookie);
  await db.system((tx) =>
    tx.query(
      "UPDATE acquisition_consents SET expires_at=now()-interval '1 day' WHERE visitor_id=$1",
      [row.visitor_id],
    ),
  );
  const result = await purgeExpiredAcquisition(db);
  assert.ok(result.removed >= 1 && result.removed <= 100);
  assert.equal(await consent(permitted.cookie), undefined);
  assert.equal(
    (
      await db.system((tx) =>
        tx.query("SELECT * FROM acquisition_events WHERE visitor_id=$1", [
          row.visitor_id,
        ]),
      )
    ).length,
    0,
  );
});

test("delayed historical payment receipts cannot attribute a payment made before consent", async () => {
  const permitted = await permit({ source: "newsletter" });
  assert.equal(
    await recordSignupAcquisition(db, fixtureRequest(permitted.cookie), other),
    true,
  );
  await db.tenant({ ...other, role: "finance" }, (tx) =>
    recordCharge(
      tx,
      { ...other, role: "finance" },
      "stripe-invoice:historical-acquisition-fixture",
      10000,
      1,
      { userId: other.userId, chargedAt: "2020-01-01T00:00:00.000Z" },
    ),
  );
  assert.equal(
    await recordFirstPaidAcquisition(db, other.tenantId, other.userId),
    false,
  );
});

async function freshWorkspace() {
  const coach = { tenantId: randomUUID(), userId: randomUUID(), role: "owner" },
    member = { tenantId: "", userId: randomUUID(), role: "subscriber" };
  member.tenantId = coach.tenantId;
  await db.system(async (tx) => {
    await tx.query(
      "INSERT INTO tenants(id,slug,name) VALUES($1,$2,'Acquisition hook fixture')",
      [coach.tenantId, coach.tenantId],
    );
    for (const a of [coach, member]) {
      await tx.query(
        "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Acquisition hook fixture','unused')",
        [a.userId, a.userId + "@fixture.test"],
      );
      await tx.query(
        "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)",
        [a.tenantId, a.userId, a.role],
      );
    }
  });
  return { coach, member };
}

test("the actual Stripe processor records positive paid conversion after commit and analytics failure cannot fail a payment", async () => {
  const { coach, member } = await freshWorkspace(),
    permitted = await permit({ source: "partner" });
  await recordSignupAcquisition(db, fixtureRequest(permitted.cookie), coach);
  const row = await consent(permitted.cookie),
    when = Math.ceil(Date.now() / 1000);
  const invoice = (suffix: string, amount: number) => ({
    id: "evt_acq_" + suffix,
    type: "invoice.paid",
    created: when,
    data: {
      object: {
        id: "in_acq_" + suffix,
        amount_paid: amount,
        currency: "aed",
        metadata: { tenant_id: coach.tenantId, user_id: member.userId },
        subscription: "sub_acq_" + coach.tenantId,
        charge: "ch_acq_" + suffix,
        created: when,
        period_end: when + 86400,
      },
    },
  });
  assert.deepEqual(await processStripeEvent(db, invoice("zero", 0)), {
    processed: true,
  });
  assert.equal(
    (
      await db.system((tx) =>
        tx.query(
          "SELECT id FROM acquisition_events WHERE visitor_id=$1 AND name='first_paid'",
          [row.visitor_id],
        ),
      )
    ).length,
    0,
  );
  await processStripeEvent(db, invoice("positive", 10000));
  await processStripeEvent(db, invoice("positive", 10000));
  assert.equal(
    (
      await db.system((tx) =>
        tx.query(
          "SELECT id FROM acquisition_events WHERE visitor_id=$1 AND name='first_paid'",
          [row.visitor_id],
        ),
      )
    ).length,
    1,
  );
  const faulty: Database = {
    ...db,
    system: (fn) =>
      db.system((tx) =>
        fn({
          query: async (sql, values) => {
            if (sql.includes("acquisition_consents"))
              throw new Error("synthetic_private_analytics_exception");
            return tx.query(sql, values);
          },
        }),
      ),
  };
  const warning = console.warn,
    messages: unknown[][] = [];
  console.warn = (...args) => {
    messages.push(args);
  };
  try {
    assert.deepEqual(
      await processStripeEvent(faulty, invoice("analytics_down", 12000)),
      { processed: true },
    );
  } finally {
    console.warn = warning;
  }
  assert.deepEqual(messages, [
    ["Payment acquisition conversion could not be recorded"],
  ]);
  assert.equal(
    (
      await db.tenant({ ...coach, role: "finance" }, (tx) =>
        tx.query(
          "SELECT id FROM journals WHERE source_key='stripe-invoice:in_acq_analytics_down'",
        ),
      )
    ).length,
    1,
  );
});

test("personal export and member erasure include anonymous attribution history through the actual privacy functions", async () => {
  const { coach, member } = await freshWorkspace(),
    first = await permit({ source: "newsletter" }),
    second = await permit({ source: "google" });
  await db.system((tx) =>
    tx.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'subscriber')",
      [other.tenantId, member.userId],
    ),
  );
  await recordSignupAcquisition(
    db,
    fixtureRequest(first.cookie),
    member,
    "enroll",
  );
  await recordSignupAcquisition(
    db,
    fixtureRequest(second.cookie),
    { ...member, tenantId: other.tenantId },
    "enroll",
  );
  const row = await consent(first.cookie),
    preserved = await consent(second.cookie);
  const exported = await exportPersonalData(db, member);
  assert.deepEqual(
    exported.acquisition.events.map((e) => e.name),
    ["landing", "enroll"],
  );
  assert.ok(!JSON.stringify(exported.acquisition).includes(row.token_hash));
  const deletion = await db.tenant(member, (tx) =>
    putRecord(
      tx,
      member,
      "privacy_request",
      { type: "deletion", requestedAt: new Date().toISOString() },
      { status: "pending_review" },
    ),
  );
  const result = await eraseMember(db, coach, deletion.id, {
    expectedRevision: deletion.version,
    providerReviewComplete: true,
    thirdPartySourceReviewComplete: true,
    evidenceReference: "Fixture reviewed local erasure",
    retentionPolicyVersion: "fixture-retention-v1",
    backupPurgeBy: new Date(Date.now() + 86400000).toISOString(),
    providers: [],
  });
  assert.equal(result.status, "local_erasure_completed");
  assert.equal(await consent(first.cookie), undefined);
  assert.equal(
    (
      await db.system((tx) =>
        tx.query("SELECT id FROM acquisition_events WHERE visitor_id=$1", [
          row.visitor_id,
        ]),
      )
    ).length,
    0,
  );
  assert.equal((await consent(second.cookie)).visitor_id, preserved.visitor_id);
});

test("full application consent, registration and enrollment hooks count only new consenting memberships", async () => {
  const full = await buildApp({ db, testing: true }),
    base = new URL(process.env.PUBLIC_APP_URL ?? "http://localhost:3000");
  const call = async (
    path: string,
    method: any = "GET",
    payload?: any,
    cookieValue?: string,
  ) =>
    await full.inject({
      url: "/api/v1" + path,
      method,
      payload,
      headers: {
        host: base.host,
        origin: base.origin,
        ...(cookieValue ? { cookie: cookieValue } : {}),
      },
    });
  const grant = async () => {
    const response = await call("/public/acquisition/consent", "POST", {
      granted: true,
      touch: { source: "google", campaign: "actual_signup" },
    });
    assert.equal(response.statusCode, 200, response.body);
    return String(response.headers["set-cookie"]).split(";")[0];
  };
  try {
    const value = await grant(),
      visitor = await consent(value),
      slug = "acq-" + randomUUID().slice(0, 8);
    const body = {
      name: "Hook coach",
      email: slug + "@fixture.test",
      password: "FixturePassword2026!",
      slug,
      accepted: true,
    };
    const registered = await call("/auth/register", "POST", body, value);
    assert.equal(registered.statusCode, 201, registered.body);
    const row = (
      await db.system((tx) =>
        tx.query(
          "SELECT * FROM acquisition_events WHERE visitor_id=$1 AND name='signup'",
          [visitor.visitor_id],
        ),
      )
    )[0];
    assert.ok(row?.tenant_id);
    await db.system((tx) =>
      tx.query("UPDATE tenants SET published=true WHERE id=$1", [
        row.tenant_id,
      ]),
    );
    const enrolledCookie = await grant(),
      enrolled = await consent(enrolledCookie);
    const enrollment = {
      name: "Hook subscriber",
      email: slug + "-member@fixture.test",
      password: "FixturePassword2026!",
      coachSlug: slug,
      accepted: true,
    };
    const joined = await call(
      "/auth/enroll",
      "POST",
      enrollment,
      enrolledCookie,
    );
    assert.equal(joined.statusCode, 201, joined.body);
    assert.equal(
      (
        await db.system((tx) =>
          tx.query(
            "SELECT id FROM acquisition_events WHERE visitor_id=$1 AND name='enroll'",
            [enrolled.visitor_id],
          ),
        )
      ).length,
      1,
    );
    await call(
      "/public/acquisition/consent",
      "DELETE",
      undefined,
      enrolledCookie,
    );
    const repeatCookie = await grant(),
      repeat = await consent(repeatCookie);
    assert.equal(
      (await call("/auth/enroll", "POST", enrollment, repeatCookie)).statusCode,
      201,
    );
    assert.equal(
      (
        await db.system((tx) =>
          tx.query(
            "SELECT id FROM acquisition_events WHERE visitor_id=$1 AND name='enroll'",
            [repeat.visitor_id],
          ),
        )
      ).length,
      0,
      "revisiting an existing enrollment is not a new conversion",
    );
    const directSlug = "direct-" + randomUUID().slice(0, 8);
    assert.equal(
      (
        await call("/auth/register", "POST", {
          ...body,
          slug: directSlug,
          email: directSlug + "@fixture.test",
        })
      ).statusCode,
      201,
    );
    const [direct] = await db.system((tx) =>
      tx.query("SELECT id FROM tenants WHERE slug=$1", [directSlug]),
    );
    assert.equal(
      (
        await db.system((tx) =>
          tx.query("SELECT id FROM acquisition_events WHERE tenant_id=$1", [
            direct.id,
          ]),
        )
      ).length,
      0,
    );
  } finally {
    await full.close();
  }
});
