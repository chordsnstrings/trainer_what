import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createDatabase, putRecord, type Database } from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";
import {
  complimentaryNutritionApproved,
  hasMemberAccess,
  hasNutritionAccess,
  memberAccess,
} from "../apps/api/src/entitlements.ts";
import {
  closeWorkspaceComplimentaryAccess,
  eraseComplimentaryAccess,
  exportComplimentaryAccess,
} from "../apps/api/src/complimentary-access.ts";
import { scheduleNotifications } from "../apps/api/src/notifications.ts";
import { modelAccounting } from "../apps/api/src/model-accounting.ts";

let db: Database, app: Awaited<ReturnType<typeof buildApp>>;
let coach: any, other: any, operator: any, a: any, b: any, c: any;
let programA: any;
const password = "Complimentary2026!";
async function request(
  url: string,
  method: any = "GET",
  body?: any,
  who?: any,
) {
  return app.inject({
    url: "/api/v1" + url,
    method,
    headers: {
      origin: "http://localhost:3000",
      ...(who ? { cookie: who.cookie } : {}),
    },
    payload: body,
  });
}
const cookieOf = (r: any) => String(r.headers["set-cookie"]).split(";")[0];
async function whoami(cookie: string) {
  const boot = await request("/bootstrap", "GET", undefined, { cookie });
  assert.equal(boot.statusCode, 200, boot.body);
  return { ...boot.json().user, cookie };
}
async function register(slug: string) {
  const r = await request("/auth/register", "POST", {
    name: "Coach " + slug,
    email: slug + "@example.test",
    password,
    slug,
    accepted: true,
  });
  assert.equal(r.statusCode, 201, r.body);
  return whoami(cookieOf(r));
}
async function follower(owner: any, name: string) {
  const email = name.toLowerCase() + "@example.test";
  const invite = await request(
    "/invitations",
    "POST",
    { email, role: "subscriber" },
    owner,
  );
  const joined = await request("/invitations/accept", "POST", {
    token: invite.json().url.split("/").pop(),
    name,
    email,
    password,
    accepted: true,
  });
  assert.equal(joined.statusCode, 200, joined.body);
  return whoami(cookieOf(joined));
}
const freshMfa = (who: any) =>
  db.system((tx) =>
    tx.query("UPDATE sessions SET mfa_at=now() WHERE user_id=$1", [who.userId]),
  );
const grant = (body: any, who = coach) =>
  request("/complimentary-access", "POST", body, who);
const ownerTx = (fn: (tx: any) => Promise<any>, who = coach): Promise<any> =>
  db.tenant({ ...who, role: "owner" }, fn);
before(async () => {
  db = await createDatabase({ memory: true });
  app = await buildApp({ db, testing: true });
  coach = await register("comp-coach");
  other = await register("comp-other");
  operator = await register("comp-support");
  a = await follower(coach, "CompA");
  b = await follower(coach, "CompB");
  c = await follower(coach, "CompC");
  const r = await request(
    "/programs",
    "POST",
    {
      subscriberId: a.userId,
      program: {
        title: "Complimentary foundations",
        goal: "Controlled practice",
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
    coach,
  );
  assert.equal(r.statusCode, 200, r.body);
  programA = r.json();
});
after(async () => {
  await app.close();
  await db.close();
});

test("only the owner with a fresh authenticator grants access, and no payment records are created", async () => {
  const body = {
    userId: a.userId,
    tier: "workout",
    days: 30,
    reason: "Founding member pilot",
  };
  const byFollower = await grant(body, a);
  assert.equal(byFollower.statusCode, 403);
  const stale = await grant(body);
  assert.equal(stale.statusCode, 403);
  assert.equal(stale.json().code, "MFA_STEP_UP");
  await freshMfa(coach);
  const outsider = await grant({ ...body, userId: other.userId });
  assert.equal(outsider.statusCode, 404, "Only this workspace's followers");
  const ok = await grant(body);
  assert.equal(ok.statusCode, 200, ok.body);
  const g = ok.json();
  assert.equal(g.status, "active");
  assert.equal(g.tier, "workout");
  const days = (Date.parse(g.endsAt) - Date.parse(g.startsAt)) / 86400000;
  assert.ok(Math.abs(days - 30) < 0.01);
  const [notice] = await ownerTx((tx) =>
    tx.query(
      "SELECT title,href FROM notifications WHERE user_id=$1 AND dedupe_key=$2",
      [a.userId, `complimentary-granted:${g.id}`],
    ),
  );
  assert.equal(notice.href, "/app/membership");
  const [audit] = await ownerTx((tx) =>
    tx.query(
      "SELECT actor_id,data FROM events WHERE name='complimentary.granted' AND subject_id=$1",
      [g.id],
    ),
  );
  assert.equal(audit.actor_id, coach.userId);
  assert.equal(audit.data.tier, "workout");
  assert.equal(
    JSON.stringify(audit.data).includes("Founding"),
    false,
    "Free text stays on the grant",
  );
  const counts = await ownerTx((tx) =>
    tx.query(
      "SELECT (SELECT count(*)::int FROM subscriptions) AS subscriptions,(SELECT count(*)::int FROM journals) AS journals,(SELECT count(*)::int FROM records WHERE kind IN ('checkout','subscription_transition')) AS checkouts",
    ),
  );
  assert.deepEqual(counts[0], { subscriptions: 0, journals: 0, checkouts: 0 });
  const [providers] = await db.system((tx) =>
    tx.query("SELECT count(*)::int AS n FROM provider_objects"),
  );
  assert.equal(providers.n, 0);
});

test("complimentary access opens workouts, guided sessions, bookings and reminders through one entitlement", async () => {
  // b has no access yet.
  const blocked = await request(
    "/workouts/start",
    "POST",
    { programId: programA.id },
    b,
  );
  assert.equal(blocked.statusCode, 402);
  const started = await request(
    "/workouts/start",
    "POST",
    { programId: programA.id },
    a,
  );
  assert.equal(started.statusCode, 200, started.body);
  const guided = await request(
    `/guided/${started.json().id}`,
    "GET",
    undefined,
    a,
  );
  assert.equal(guided.statusCode, 200, guided.body);
  assert.equal(
    guided.json().premium,
    false,
    "Premium voice stays a paid capability",
  );
  const start = Date.now() + 5 * 86400000;
  const slot = await request(
    "/bookings/slots",
    "POST",
    {
      title: "Form check",
      location: "Studio",
      startsAt: new Date(start).toISOString(),
      endsAt: new Date(start + 3600000).toISOString(),
      capacity: 5,
    },
    coach,
  );
  assert.equal(slot.statusCode, 200, slot.body);
  const reserveA = await request(
    `/bookings/slots/${slot.json().id}/reserve`,
    "POST",
    {},
    a,
  );
  assert.equal(reserveA.statusCode, 200, reserveA.body);
  const reserveB = await request(
    `/bookings/slots/${slot.json().id}/reserve`,
    "POST",
    {},
    b,
  );
  assert.equal(reserveB.statusCode, 402);
  // Workout reminders use the same entitlement.
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dubai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  await ownerTx(async (tx) => {
    for (const who of [a, b])
      await putRecord(
        tx,
        coach,
        "planned_session",
        { date: today, timezone: "Asia/Dubai", label: "Session A" },
        { ownerId: who.userId, status: "planned" },
      );
  });
  await scheduleNotifications(db, coach.tenantId);
  const reminders = await ownerTx((tx) =>
    tx.query(
      "SELECT user_id FROM notifications WHERE dedupe_key LIKE 'workout-reminder:%'",
    ),
  );
  // The assigned program may already plan a session for today as well.
  assert.deepEqual(
    [...new Set(reminders.map((r: any) => r.user_id))],
    [a.userId],
  );
  const access = await ownerTx((tx) => memberAccess(tx, a.userId));
  assert.deepEqual(access.sources, ["complimentary"]);
  assert.deepEqual(access.modules, ["training"]);
  assert.equal(await ownerTx((tx) => hasNutritionAccess(tx, a.userId)), false);
  const own = await request("/membership/access", "GET", undefined, a);
  assert.equal(own.statusCode, 200, own.body);
  assert.equal(own.json().complimentary.tier, "workout");
  assert.equal(own.json().active, true);
  assert.equal(
    JSON.stringify(own.json()).includes("Founding"),
    false,
    "The member does not see the trainer's note",
  );
  assert.equal(
    (await request("/membership/access", "GET", undefined, coach)).statusCode,
    403,
  );
  const boot = await request("/bootstrap", "GET", undefined, coach);
  assert.deepEqual(
    boot.json().complimentary.map((g: any) => g.user_id),
    [a.userId],
  );
  assert.equal(boot.json().complimentary[0].reason, undefined);
});

test("the nutrition tier needs nutrition setup and, in production, the approval flags", async () => {
  await freshMfa(coach);
  const body = {
    userId: b.userId,
    tier: "workout_nutrition",
    days: null,
    reason: "Nutrition pilot participant",
  };
  const early = await grant(body);
  assert.equal(early.statusCode, 409);
  assert.equal(early.json().code, "NUTRITION_NOT_ENABLED");
  await ownerTx((tx) =>
    putRecord(
      tx,
      coach,
      "nutrition_setup",
      { enabled: true },
      { status: "active" },
    ),
  );
  const ok = await grant(body);
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(ok.json().endsAt, null, "Until revoked");
  assert.equal(await ownerTx((tx) => hasNutritionAccess(tx, b.userId)), true);
  const home = await request("/nutrition", "GET", undefined, b);
  assert.equal(home.statusCode, 200, home.body);
  assert.equal(home.json().entitled, true);
  assert.equal(complimentaryNutritionApproved({}, false), true);
  assert.equal(complimentaryNutritionApproved({}, true), false);
  assert.equal(
    complimentaryNutritionApproved({ NUTRITION_ENABLED: "true" }, true),
    false,
  );
  assert.equal(
    complimentaryNutritionApproved(
      { NUTRITION_ENABLED: "true", NUTRITION_SCOPE_APPROVED: "true" },
      true,
    ),
    true,
  );
});

test("one open grant per follower: replace, revoke with version, and expiry", async () => {
  await freshMfa(coach);
  const [current] = (
    await request("/complimentary-access", "GET", undefined, coach)
  )
    .json()
    .grants.filter((g: any) => g.userId === a.userId && g.status === "active");
  const duplicate = await grant({
    userId: a.userId,
    tier: "workout",
    days: 10,
    reason: "Second grant attempt",
  });
  assert.equal(duplicate.statusCode, 409);
  assert.equal(duplicate.json().code, "COMPLIMENTARY_EXISTS");
  const replaced = await grant({
    userId: a.userId,
    tier: "workout",
    days: 60,
    reason: "Extended pilot period",
    replaceId: current.id,
  });
  assert.equal(replaced.statusCode, 200, replaced.body);
  const list = (
    await request("/complimentary-access", "GET", undefined, coach)
  ).json();
  const old = list.grants.find((g: any) => g.id === current.id);
  assert.equal(old.closeReason, "superseded");
  assert.equal(old.status, "revoked");
  const stale = await request(
    `/complimentary-access/${replaced.json().id}/revoke`,
    "POST",
    { version: 99, reason: "Pilot ended early" },
    coach,
  );
  assert.equal(stale.statusCode, 409);
  const revoked = await request(
    `/complimentary-access/${replaced.json().id}/revoke`,
    "POST",
    { version: replaced.json().version, reason: "Pilot ended early" },
    coach,
  );
  assert.equal(revoked.statusCode, 200, revoked.body);
  assert.equal(revoked.json().status, "revoked");
  const setLog = await request(
    "/workouts/start",
    "POST",
    { programId: programA.id },
    a,
  );
  assert.equal(setLog.statusCode, 402, "Access ends with the grant");
  const [ended] = await ownerTx((tx) =>
    tx.query(
      "SELECT id FROM notifications WHERE user_id=$1 AND dedupe_key=$2",
      [a.userId, `complimentary-ended:${replaced.json().id}`],
    ),
  );
  assert.ok(ended);
  // A lapsed period is not access, and a new grant closes it as expired.
  await ownerTx((tx) =>
    tx.query(
      "INSERT INTO complimentary_access(id,tenant_id,user_id,tier,reason,starts_at,ends_at,granted_by) VALUES(gen_random_uuid(),$1,$2,'workout','Short trial',now()-interval '3 days',now()-interval '1 day',$3)",
      [coach.tenantId, a.userId, coach.userId],
    ),
  );
  assert.equal(await ownerTx((tx) => hasMemberAccess(tx, a.userId)), false);
  const lapsed = (
    await request("/complimentary-access", "GET", undefined, coach)
  )
    .json()
    .grants.find((g: any) => g.userId === a.userId && !g.closedAt);
  assert.equal(lapsed.status, "expired");
  const renewed = await grant({
    userId: a.userId,
    tier: "workout",
    days: 7,
    reason: "Second short trial",
  });
  assert.equal(renewed.statusCode, 200, renewed.body);
  const closed = (
    await request("/complimentary-access", "GET", undefined, coach)
  )
    .json()
    .grants.find((g: any) => g.id === lapsed.id);
  assert.equal(closed.closeReason, "expired");
});

test("limits are platform settings: period, open-ended and active count", async () => {
  await freshMfa(coach);
  const saved = { ...process.env };
  try {
    process.env.COMPLIMENTARY_ACCESS_MAX_DAYS = "10";
    const tooLong = await grant({
      userId: c.userId,
      tier: "workout",
      days: 11,
      reason: "Long pilot",
    });
    assert.equal(tooLong.statusCode, 400);
    assert.equal(tooLong.json().code, "COMPLIMENTARY_PERIOD_LIMIT");
    process.env.COMPLIMENTARY_ACCESS_OPEN_ENDED = "false";
    const open = await grant({
      userId: c.userId,
      tier: "workout",
      days: null,
      reason: "Open pilot",
    });
    assert.equal(open.statusCode, 400);
    assert.equal(open.json().code, "COMPLIMENTARY_PERIOD_REQUIRED");
    process.env.COMPLIMENTARY_ACCESS_MAX_ACTIVE = "2";
    const full = await grant({
      userId: c.userId,
      tier: "workout",
      days: 5,
      reason: "Third member",
    });
    assert.equal(full.statusCode, 409, full.body);
    assert.equal(full.json().code, "COMPLIMENTARY_LIMIT");
    process.env.COMPLIMENTARY_ACCESS_MAX_ACTIVE = "0";
    const off = await grant({
      userId: c.userId,
      tier: "workout",
      days: 5,
      reason: "Switched off",
    });
    assert.equal(off.json().code, "COMPLIMENTARY_DISABLED");
  } finally {
    for (const key of [
      "COMPLIMENTARY_ACCESS_MAX_DAYS",
      "COMPLIMENTARY_ACCESS_OPEN_ENDED",
      "COMPLIMENTARY_ACCESS_MAX_ACTIVE",
    ])
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
  }
});

test("row-level security and the guard keep grants private, owner-written and immutable", async () => {
  const mine = await db.tenant(a, (tx) =>
    tx.query("SELECT user_id FROM complimentary_access"),
  );
  assert.ok(mine.length > 0);
  assert.ok(mine.every((r: any) => r.user_id === a.userId));
  await assert.rejects(
    db.tenant(a, (tx) =>
      tx.query(
        "INSERT INTO complimentary_access(id,tenant_id,user_id,tier,reason,granted_by) VALUES(gen_random_uuid(),$1,$2,'workout','Self grant',$2)",
        [coach.tenantId, a.userId],
      ),
    ),
  );
  await assert.rejects(
    db.tenant({ ...coach, role: "staff" }, (tx) =>
      tx.query(
        "INSERT INTO complimentary_access(id,tenant_id,user_id,tier,reason,granted_by) VALUES(gen_random_uuid(),$1,$2,'workout','Staff grant',$3)",
        [coach.tenantId, c.userId, coach.userId],
      ),
    ),
  );
  await assert.rejects(
    ownerTx((tx) =>
      tx.query(
        "UPDATE complimentary_access SET tier='workout_nutrition' WHERE user_id=$1",
        [a.userId],
      ),
    ),
    /immutable/,
  );
  await assert.rejects(
    ownerTx((tx) =>
      tx.query("DELETE FROM complimentary_access WHERE user_id=$1", [a.userId]),
    ),
  );
  const foreign = await db.tenant({ ...other, role: "owner" }, (tx) =>
    tx.query("SELECT id FROM complimentary_access"),
  );
  assert.equal(foreign.length, 0);
});

test("platform operators see grants; only an administrator with a fresh authenticator revokes", async () => {
  await db.system(async (tx) => {
    await tx.query("UPDATE users SET platform_role='admin' WHERE id=$1", [
      other.userId,
    ]);
    await tx.query("UPDATE users SET platform_role='support' WHERE id=$1", [
      operator.userId,
    ]);
  });
  const staleAdmin = await request(
    `/admin/complimentary-access?tenantId=${coach.tenantId}`,
    "GET",
    undefined,
    other,
  );
  assert.equal(staleAdmin.statusCode, 403);
  await freshMfa(other);
  await freshMfa(operator);
  const listed = await request(
    `/admin/complimentary-access?tenantId=${coach.tenantId}`,
    "GET",
    undefined,
    other,
  );
  assert.equal(listed.statusCode, 200, listed.body);
  const target = listed.json().grants.find((g: any) => g.userId === b.userId);
  assert.equal(target.workspace, "Coach comp-coach");
  assert.equal(target.tier, "workout_nutrition");
  assert.equal(listed.json().canRevoke, true);
  const supportView = await request(
    `/admin/complimentary-access?tenantId=${coach.tenantId}&status=all`,
    "GET",
    undefined,
    operator,
  );
  assert.equal(supportView.statusCode, 200, supportView.body);
  assert.equal(supportView.json().canRevoke, false);
  const path = `/admin/tenants/${coach.tenantId}/complimentary-access/${target.id}/revoke`;
  const supportRevoke = await request(
    path,
    "POST",
    { version: target.version, reason: "Operator review" },
    operator,
  );
  assert.equal(supportRevoke.statusCode, 403);
  const revoked = await request(
    path,
    "POST",
    { version: target.version, reason: "Platform policy review" },
    other,
  );
  assert.equal(revoked.statusCode, 200, revoked.body);
  assert.equal(revoked.json().closeReason, "platform_revoked");
  assert.equal(await ownerTx((tx) => hasNutritionAccess(tx, b.userId)), false);
  const [auditRow] = await db.system((tx) =>
    tx.query(
      "SELECT actor_id,tenant_id FROM admin_operations_audit WHERE action='complimentary.revoked' AND subject_id=$1",
      [target.id],
    ),
  );
  assert.equal(auditRow.actor_id, other.userId);
  const [ownerNotice] = await ownerTx((tx) =>
    tx.query("SELECT user_id FROM notifications WHERE dedupe_key=$1", [
      `complimentary-platform-ended:${target.id}`,
    ]),
  );
  assert.equal(ownerNotice.user_id, coach.userId);
});

test("AI usage by a complimentary member stays attributed to the trainer's workspace", async () => {
  assert.equal(await ownerTx((tx) => hasMemberAccess(tx, a.userId)), true);
  await modelAccounting(db, a, "coaching").reserve("fixture-model");
  const [usage] = await ownerTx((tx) =>
    tx.query(
      "SELECT tenant_id,user_id,task FROM cost_events WHERE user_id=$1",
      [a.userId],
    ),
  );
  assert.deepEqual(usage, {
    tenant_id: coach.tenantId,
    user_id: a.userId,
    task: "coaching",
  });
});

test("export includes grants; erasure and workspace closure end them and remove free text", async () => {
  const exported = await ownerTx((tx) =>
    exportComplimentaryAccess(tx, a.userId),
  );
  assert.ok(exported.some((r: any) => r.reason === "Second short trial"));
  await ownerTx((tx) => eraseComplimentaryAccess(tx, a.userId));
  const erased = await ownerTx((tx) =>
    tx.query(
      "SELECT reason,close_note,closed_at,close_reason FROM complimentary_access WHERE user_id=$1",
      [a.userId],
    ),
  );
  assert.ok(
    erased.every(
      (r: any) => r.reason === "[removed at erasure]" && r.closed_at,
    ),
  );
  assert.ok(erased.some((r: any) => r.close_reason === "member_removed"));
  assert.ok(
    erased.every(
      (r: any) =>
        r.close_note === null || r.close_note === "[removed at erasure]",
    ),
  );
  // Outside an erasure the reason is still immutable.
  await assert.rejects(
    ownerTx((tx) =>
      tx.query(
        "UPDATE complimentary_access SET reason='[removed at erasure]' WHERE user_id=$1",
        [b.userId],
      ),
    ),
  );
  await ownerTx((tx) => closeWorkspaceComplimentaryAccess(tx));
  const all = await ownerTx((tx) =>
    tx.query("SELECT reason,closed_at FROM complimentary_access"),
  );
  assert.ok(
    all.every((r: any) => r.closed_at && r.reason === "[removed at erasure]"),
  );
  const [flag] = await ownerTx((tx) =>
    tx.query("SELECT current_setting('app.privacy_erasure',true) AS v"),
  );
  assert.notEqual(flag.v, "true");
});
