import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, type Database } from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";
import { recordPublishAcquisition } from "../apps/api/src/acquisition.ts";
import {
  preparePaidBooking,
  startBookingCheckout,
  processBookingStripeEvent,
} from "../apps/api/src/finance-bookings.ts";
import { tokenHash } from "../apps/api/src/auth.ts";

let db: Database, app: Awaited<ReturnType<typeof buildApp>>;
const base = new URL(process.env.PUBLIC_APP_URL ?? "http://localhost:3000");
async function call(
  path: string,
  method: any = "GET",
  payload?: any,
  cookie?: string,
) {
  return app.inject({
    url: "/api/v1" + path,
    method,
    payload,
    headers: {
      host: base.host,
      origin: base.origin,
      ...(cookie ? { cookie } : {}),
    },
  });
}
async function allowAnalytics(campaign: string) {
  const r = await call("/public/acquisition/consent", "POST", {
    granted: true,
    touch: { source: "google", campaign, medium: "cpc" },
  });
  assert.equal(r.statusCode, 200, r.body);
  const cookie = String(r.headers["set-cookie"]).split(";")[0];
  const [row] = await db.system((tx) =>
    tx.query(
      "SELECT visitor_id FROM acquisition_consents WHERE token_hash=$1",
      [tokenHash(cookie.split("=")[1])],
    ),
  );
  return { cookie, visitorId: row.visitor_id as string };
}
const milestones = (visitorId: string) =>
  db
    .system((tx) =>
      tx.query(
        "SELECT name,tenant_id,user_id,campaign FROM acquisition_events WHERE visitor_id=$1 AND name<>'landing' ORDER BY created_at,id",
        [visitorId],
      ),
    )
    .then((rows) => rows.map((r) => r.name));
async function invite(
  coach: any,
  email: string,
  role: string,
  cookie?: string,
) {
  const invitation = await call(
    "/invitations",
    "POST",
    { email, role },
    coach.cookie,
  );
  assert.equal(invitation.statusCode, 200, invitation.body);
  const accepted = await call(
    "/invitations/accept",
    "POST",
    {
      token: invitation.json().url.split("/").pop(),
      name: "Invited " + role,
      email,
      password: "InvitedPerson2026!",
      accepted: true,
    },
    cookie,
  );
  assert.equal(accepted.statusCode, 200, accepted.body);
  const session = String(accepted.headers["set-cookie"]).split(";")[0];
  return {
    ...(await call("/bootstrap", "GET", undefined, session)).json().user,
    cookie: session,
  };
}
async function paySession(coach: any, member: any, id: string) {
  const { slot, booking } = await db.tenant(coach, async (tx) => {
    const [slot] = await tx.query(
      "INSERT INTO booking_slots(id,tenant_id,trainer_id,starts_at,ends_at,capacity,title,location,price_minor) VALUES($1,$2,$3,now()+interval '2 days',now()+interval '2 days 1 hour',1,'Paid session','Studio',15000) RETURNING *",
      [randomUUID(), coach.tenantId, coach.userId],
    );
    const [booking] = await tx.query(
      "INSERT INTO bookings(id,tenant_id,slot_id,user_id) VALUES($1,$2,$3,$4) RETURNING *",
      [randomUUID(), coach.tenantId, slot.id, member.userId],
    );
    return { slot, booking };
  });
  // In the reserving follower's own scope, as the booking route runs it.
  await db.tenant(member, (tx) =>
    preparePaidBooking(tx, member, slot, booking),
  );
  let remote: any;
  const stripe = {
    checkout: {
      sessions: {
        create: async (body: any) =>
          (remote = {
            ...body,
            id: "cs_" + id,
            url: "https://checkout.stripe.com/c/" + id,
            currency: "aed",
            amount_total: 15000,
            payment_status: "paid",
            payment_intent: "pi_" + id,
          }),
      },
    },
  } as any;
  await startBookingCheckout(db, member, booking.id, stripe);
  const completed = {
    type: "checkout.session.completed",
    data: { object: remote },
  };
  await processBookingStripeEvent(db, completed, stripe);
  // A replayed provider event is not a second conversion.
  await processBookingStripeEvent(db, completed, stripe);
  const [row] = await db.tenant(coach, (tx) =>
    tx.query("SELECT status,payment_status FROM bookings WHERE id=$1", [
      booking.id,
    ]),
  );
  assert.equal(row.status, "confirmed");
  assert.equal(row.payment_status, "paid");
}

before(async () => {
  db = await createDatabase({ memory: true });
  app = await buildApp({ db, testing: true });
});
after(async () => {
  await app.close();
  await db.close();
});

test("sign-up, invitation join, publish and a first paid session are recorded once at the right points", async () => {
  const owner = await allowAnalytics("coach_launch");
  const registered = await call(
    "/auth/register",
    "POST",
    {
      name: "Milestone Coach",
      email: "milestone-coach@example.test",
      password: "MilestoneCoach2026!",
      slug: "milestone-coach",
      accepted: true,
    },
    owner.cookie,
  );
  assert.equal(registered.statusCode, 201, registered.body);
  const session = String(registered.headers["set-cookie"]).split(";")[0];
  const coach = {
    ...(await call("/bootstrap", "GET", undefined, session)).json().user,
    cookie: session,
  };
  assert.deepEqual(await milestones(owner.visitorId), ["signup"]);

  // Joining by invitation is a join milestone for the consenting member only.
  const joiner = await allowAnalytics("member_invite");
  const member = await invite(
    coach,
    "milestone-member@example.test",
    "subscriber",
    joiner.cookie,
  );
  assert.deepEqual(await milestones(joiner.visitorId), ["enroll"]);
  const [enroll] = await db.system((tx) =>
    tx.query(
      "SELECT tenant_id,user_id FROM acquisition_events WHERE visitor_id=$1 AND name='enroll'",
      [joiner.visitorId],
    ),
  );
  assert.equal(enroll.tenant_id, coach.tenantId);
  assert.equal(enroll.user_id, member.userId);

  // Publish counts only after the workspace is actually published.
  assert.equal(await recordPublishAcquisition(db, coach.tenantId), false);
  await db.system((tx) =>
    tx.query("UPDATE tenants SET published=true WHERE id=$1", [coach.tenantId]),
  );
  assert.equal(await recordPublishAcquisition(db, coach.tenantId), true);
  assert.equal(await recordPublishAcquisition(db, coach.tenantId), false);

  // A confirmed paid session is the workspace's first member payment.
  await paySession(coach, member, "milestone_one");
  assert.deepEqual(await milestones(owner.visitorId), [
    "signup",
    "publish",
    "first_paid",
  ]);
  // Later payments never add another first-payment milestone.
  await paySession(coach, member, "milestone_two");
  assert.deepEqual(await milestones(owner.visitorId), [
    "signup",
    "publish",
    "first_paid",
  ]);
  const [paid] = await db.system((tx) =>
    tx.query(
      "SELECT tenant_id,campaign,attribution FROM acquisition_events WHERE visitor_id=$1 AND name='first_paid'",
      [owner.visitorId],
    ),
  );
  assert.equal(paid.tenant_id, coach.tenantId);
  assert.equal(paid.campaign, "coach_launch");
});

test("a workspace whose owner never allowed analytics records no milestones for its payments", async () => {
  const registered = await call("/auth/register", "POST", {
    name: "Private Coach",
    email: "private-coach@example.test",
    password: "PrivateCoach2026!",
    slug: "private-coach",
    accepted: true,
  });
  assert.equal(registered.statusCode, 201, registered.body);
  const session = String(registered.headers["set-cookie"]).split(";")[0];
  const coach = {
    ...(await call("/bootstrap", "GET", undefined, session)).json().user,
    cookie: session,
  };
  const member = await invite(
    coach,
    "private-member@example.test",
    "subscriber",
  );
  await paySession(coach, member, "private_one");
  const events = await db.system((tx) =>
    tx.query("SELECT name FROM acquisition_events WHERE tenant_id=$1", [
      coach.tenantId,
    ]),
  );
  assert.deepEqual(events, []);
});
