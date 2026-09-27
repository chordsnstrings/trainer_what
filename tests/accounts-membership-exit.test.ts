import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  accountsContext,
  ok,
  password,
  sessionCookie,
  type Person,
} from "./accounts-fixtures.ts";
import { buildApp } from "../apps/api/src/app.ts";
import { processStripeEvent } from "../apps/api/src/stripe-events.ts";

const renewals: Array<{ id: string; body: any; key: string }> = [];
let stripeFails = false;
const fakeStripe = {
  subscriptions: {
    update: async (id: string, body: any, options: any) => {
      if (stripeFails) throw new Error("Synthetic timeout after possible dispatch");
      renewals.push({ id, body, key: options.idempotencyKey });
      return { id, ...body };
    },
    retrieve: async (id: string) => ({ id, cancel_at_period_end: false }),
  },
} as any;
let ctx: Awaited<ReturnType<typeof accountsContext>>;
before(async () => {
  ctx = await accountsContext({ providers: { stripe: () => fakeStripe } });
});
after(async () => ctx.close());

async function subscribe(
  f: Person,
  tenantId: string,
  options: { cancel?: boolean; providerId?: string } = {},
) {
  const providerId = options.providerId ?? "sub_exit_" + randomUUID();
  await ctx.db.tenant({ tenantId, userId: f.userId, role: "owner" }, (tx) =>
    tx.query(
      "INSERT INTO subscriptions(id,tenant_id,user_id,provider_id,status,cancel_at_period_end,period_end,price_minor) VALUES($1,$2,$3,$4,'active',$5,now()+interval '20 days',19900)",
      [randomUUID(), tenantId, f.userId, providerId, options.cancel ?? false],
    ),
  );
  return providerId;
}
async function membership(userId: string, tenantId: string) {
  const [m] = await ctx.db.system((tx) =>
    tx.query("SELECT role FROM memberships WHERE user_id=$1 AND tenant_id=$2", [
      userId,
      tenantId,
    ]),
  );
  return m?.role ?? null;
}

test("a follower leaves: renewal stops through the existing cancellation flow, access to that trainer ends and the other trainer is kept", async () => {
  const trainerA = await ctx.person({ name: "Trainer A" }),
    trainerB = await ctx.person({ name: "Trainer B" });
  const follower = await ctx.person({
    role: "subscriber",
    tenantId: trainerA.tenantId,
    name: "Leaving Follower",
  });
  await ctx.join(follower, trainerB.tenantId);
  const providerId = await subscribe(follower, trainerA.tenantId);
  const recordId = randomUUID();
  await ctx.db.tenant(
    { tenantId: trainerA.tenantId, userId: follower.userId, role: "subscriber" },
    (tx) =>
      tx.query(
        "INSERT INTO records(id,tenant_id,kind,owner_user_id,status,data) VALUES($1,$2,'workout',$3,'completed','{}')",
        [recordId, trainerA.tenantId, follower.userId],
      ),
  );
  await ctx.db.tenant(
    { tenantId: trainerA.tenantId, userId: follower.userId, role: "owner" },
    (tx) =>
      tx.query(
        "INSERT INTO integration_connections(id,tenant_id,user_id,provider,status) VALUES($1,$2,$3,'whoop','active')",
        [randomUUID(), trainerA.tenantId, follower.userId],
      ),
  );
  const preview = ok(await ctx.call("/membership/leave", { cookie: follower.cookie }));
  assert.equal(preview.action, "renewal_cancelled");
  assert.equal(preview.subscription.renewing, true);
  assert.deepEqual(preview.blockers, []);
  assert.equal(preview.otherWorkspaces, 1);
  assert.equal(
    (await ctx.call("/membership/leave", { body: { reason: "No confirm" }, cookie: follower.cookie }))
      .statusCode,
    400,
  );
  const left = await ctx.call("/membership/leave", {
    body: { confirm: true, reason: "Moving abroad" },
    cookie: follower.cookie,
  });
  const body = ok(left);
  assert.equal(body.subscriptionAction, "renewal_cancelled");
  assert.ok(body.accessUntil);
  assert.equal(body.nextWorkspace.tenantId, trainerB.tenantId);
  assert.equal(renewals.length, 1);
  assert.equal(renewals[0].id, providerId);
  assert.equal(renewals[0].body.cancel_at_period_end, true);
  assert.match(renewals[0].key, /^renewal:/);
  assert.equal(await membership(follower.userId, trainerA.tenantId), null);
  assert.equal(await membership(follower.userId, trainerB.tenantId), "subscriber");
  assert.equal(await ctx.sessionCount(follower.userId, trainerA.tenantId), 0);
  assert.equal((await ctx.call("/bootstrap", { cookie: follower.cookie })).statusCode, 401);
  const next = sessionCookie(left);
  assert.equal(ok(await ctx.call("/bootstrap", { cookie: next })).tenant.id, trainerB.tenantId);
  const trainer = { tenantId: trainerA.tenantId, userId: trainerA.userId, role: "owner" };
  const state = await ctx.db.tenant(trainer, async (tx) => ({
    subscription: (
      await tx.query("SELECT cancel_at_period_end FROM subscriptions WHERE user_id=$1", [
        follower.userId,
      ])
    )[0],
    record: (await tx.query("SELECT id FROM records WHERE id=$1", [recordId]))[0],
    exit: (await tx.query("SELECT * FROM membership_exits WHERE user_id=$1", [follower.userId]))[0],
    notice: (
      await tx.query(
        "SELECT title,body,email_status FROM notifications WHERE user_id=$1 AND dedupe_key LIKE 'membership-exit:%'",
        [trainerA.userId],
      )
    )[0],
    wearable: (
      await tx.query("SELECT status FROM integration_connections WHERE user_id=$1", [
        follower.userId,
      ])
    )[0],
  }));
  assert.equal(state.subscription.cancel_at_period_end, true, "billing is not orphaned");
  assert.ok(state.record, "coaching records stay under the retention rules");
  assert.equal(state.exit.kind, "left");
  assert.equal(state.exit.subscription_action, "renewal_cancelled");
  assert.equal(state.exit.reason, "Moving abroad");
  assert.equal(state.notice.title, "A subscriber left");
  assert.match(state.notice.body, /Leaving Follower ended their membership/);
  assert.equal(state.notice.email_status, "suppressed", "the trainer is told in-app");
  assert.equal(state.wearable.status, "revoked");
  const [audit] = await ctx.events(trainerA.tenantId, "membership.left", follower.userId);
  assert.equal(audit.actor_id, follower.userId);
  const account = ok(await ctx.call("/account", { cookie: next }));
  assert.ok(account.notices.some((n: any) => n.kind === "membership_left"));
  // The winding-down subscription's final provider event still reaches the ledger.
  await processStripeEvent(ctx.db, {
    id: "evt_exit_" + randomUUID(),
    type: "customer.subscription.deleted",
    created: Math.floor(Date.now() / 1000) + 5,
    data: {
      object: {
        id: providerId,
        object: "subscription",
        status: "canceled",
        cancel_at_period_end: false,
        current_period_end: Math.floor(Date.now() / 1000) + 86400,
        metadata: { tenant_id: trainerA.tenantId, user_id: follower.userId },
      },
    },
  });
  const [ended] = await ctx.db.tenant(trainer, (tx) =>
    tx.query("SELECT status FROM subscriptions WHERE user_id=$1", [follower.userId]),
  );
  assert.equal(ended.status, "canceled");
  const stranger = await ctx.person();
  await assert.rejects(
    processStripeEvent(ctx.db, {
      id: "evt_exit_" + randomUUID(),
      type: "customer.subscription.updated",
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: "sub_stranger_" + randomUUID(),
          object: "subscription",
          status: "active",
          metadata: { tenant_id: trainerA.tenantId, user_id: stranger.userId },
        },
      },
    }),
    /unknown subscriber relationship/,
  );
  // The global account remains and can join this trainer again.
  const rejoin = await ctx.call("/auth/enroll", {
    body: {
      name: "Leaving Follower",
      email: follower.email,
      password,
      coachSlug: (
        await ctx.db.system((tx) =>
          tx.query("SELECT slug FROM tenants WHERE id=$1", [trainerA.tenantId]),
        )
      )[0].slug,
      accepted: true,
    },
  });
  ok(rejoin, 201);
  assert.equal(await membership(follower.userId, trainerA.tenantId), "subscriber");
});

test("leaving waits for unresolved payments and upcoming bookings; uncertain or unavailable billing changes nothing", async () => {
  const trainer = await ctx.person();
  const owner = { tenantId: trainer.tenantId, userId: trainer.userId, role: "owner" };
  const booked = await ctx.person({ role: "subscriber", tenantId: trainer.tenantId });
  await ctx.db.tenant(owner, async (tx) => {
    const slot = randomUUID();
    await tx.query(
      "INSERT INTO booking_slots(id,tenant_id,trainer_id,starts_at,ends_at,capacity,title,location) VALUES($1,$2,$3,now()+interval '2 days',now()+interval '2 days 1 hour',1,'Session','Gym')",
      [slot, trainer.tenantId, trainer.userId],
    );
    await tx.query("INSERT INTO bookings(id,tenant_id,slot_id,user_id) VALUES($1,$2,$3,$4)", [
      randomUUID(),
      trainer.tenantId,
      slot,
      booked.userId,
    ]);
  });
  const blocked = await ctx.call("/membership/leave", {
    body: { confirm: true },
    cookie: booked.cookie,
  });
  assert.equal(blocked.statusCode, 409, blocked.body);
  assert.equal(blocked.json().code, "EXIT_BLOCKED");
  assert.match(blocked.json().message, /Upcoming bookings/);
  assert.equal(await membership(booked.userId, trainer.tenantId), "subscriber");
  // An uncertain provider outcome is held for reconciliation, never retried blindly.
  const uncertain = await ctx.person({ role: "subscriber", tenantId: trainer.tenantId });
  await subscribe(uncertain, trainer.tenantId);
  stripeFails = true;
  const failed = await ctx.call("/membership/leave", {
    body: { confirm: true },
    cookie: uncertain.cookie,
  });
  stripeFails = false;
  assert.equal(failed.statusCode, 500);
  assert.equal(await membership(uncertain.userId, trainer.tenantId), "subscriber");
  const held = await ctx.call("/membership/leave", {
    body: { confirm: true },
    cookie: uncertain.cookie,
  });
  assert.equal(held.statusCode, 409);
  assert.match(held.json().message, /renewal change is still being confirmed/);
  // Without a payment provider nothing is changed and the reason is explicit.
  const unconfigured = await buildApp({ db: ctx.db, testing: true });
  try {
    const renewing = await ctx.person({ role: "subscriber", tenantId: trainer.tenantId });
    await subscribe(renewing, trainer.tenantId);
    const r = await unconfigured.inject({
      method: "POST",
      url: "/api/v1/membership/leave",
      payload: { confirm: true },
      headers: { host: "localhost:3000", origin: "http://localhost:3000", cookie: renewing.cookie },
    });
    assert.equal(r.statusCode, 503, r.body);
    assert.match(r.json().message, /Nothing was changed/);
    assert.equal(await membership(renewing.userId, trainer.tenantId), "subscriber");
  } finally {
    await unconfigured.close();
  }
  for (const who of [trainer, await ctx.person({ role: "staff", tenantId: trainer.tenantId })]) {
    const r = await ctx.call("/membership/leave", { body: { confirm: true }, cookie: who.cookie });
    assert.equal(r.statusCode, 403);
    assert.equal(r.json().code, "FOLLOWERS_ONLY");
  }
});

test("a trainer owner removes a follower with a reason after a fresh authenticator check; the follower is told in-app and by email", async () => {
  const stale = await ctx.person({ mfa: true });
  const follower = await ctx.person({ role: "subscriber", tenantId: stale.tenantId });
  await subscribe(follower, stale.tenantId, { cancel: true });
  const path = `/trainer/followers/${follower.userId}/remove`;
  const step = await ctx.call(path, { body: { reason: "Repeated missed payments" }, cookie: stale.cookie });
  assert.equal(step.statusCode, 403);
  assert.equal(step.json().code, "MFA_STEP_UP");
  const owner = await ctx.person({ tenantId: stale.tenantId, role: "staff", mfa: true, mfaFresh: true });
  const staff = await ctx.call(path, { body: { reason: "Staff cannot remove" }, cookie: owner.cookie });
  assert.equal(staff.json().code, "OWNER_REQUIRED");
  await ctx.db.system((tx) =>
    tx.query("UPDATE sessions SET mfa_at=now() WHERE user_id=$1", [stale.userId]),
  );
  assert.equal((await ctx.call(path, { body: {}, cookie: stale.cookie })).statusCode, 400);
  const preview = ok(
    await ctx.call(`/trainer/followers/${follower.userId}/exit`, { cookie: stale.cookie }),
  );
  assert.equal(preview.action, "already_cancelled");
  const before = renewals.length;
  const removed = ok(
    await ctx.call(path, { body: { reason: "Repeated missed sessions" }, cookie: stale.cookie }),
  );
  assert.equal(removed.subscriptionAction, "already_cancelled");
  assert.equal(renewals.length, before, "no second provider instruction");
  assert.equal(await membership(follower.userId, stale.tenantId), null);
  assert.equal(await ctx.sessionCount(follower.userId), 0);
  const [account] = await ctx.db.system((tx) =>
    tx.query(
      "SELECT u.email,(SELECT body FROM account_notices WHERE user_id=u.id AND kind='membership_removed') AS notice FROM users u WHERE u.id=$1",
      [follower.userId],
    ),
  );
  assert.equal(account.email, follower.email, "the global account is kept");
  assert.match(account.notice, /Repeated missed sessions/);
  const [mail] = await ctx.emailJobs(stale.tenantId, follower.email, "membership-removed");
  assert.match(mail.data.text, /ended your coaching membership/);
  const [audit] = await ctx.events(stale.tenantId, "membership.removed", follower.userId);
  assert.equal(audit.actor_id, stale.userId);
  for (const who of [stale, owner]) {
    const exits = ok(await ctx.call("/trainer/follower-exits", { cookie: who.cookie })).exits;
    assert.equal(exits[0].reason, "Repeated missed sessions");
    assert.equal(exits[0].kind, "removed");
  }
  const again = await ctx.call(path, { body: { reason: "Already removed person" }, cookie: stale.cookie });
  assert.equal(again.json().code, "FOLLOWER_NOT_FOUND");
  const team = await ctx.call(`/trainer/followers/${owner.userId}/remove`, {
    body: { reason: "Team members are not followers" },
    cookie: stale.cookie,
  });
  assert.equal(team.json().code, "FOLLOWER_NOT_FOUND");
  const self = await ctx.call(`/trainer/followers/${stale.userId}/remove`, {
    body: { reason: "Owner cannot remove self" },
    cookie: stale.cookie,
  });
  assert.equal(self.json().code, "OWNER_PROTECTED");
  const other = await ctx.person({ role: "subscriber", tenantId: stale.tenantId });
  assert.equal(
    (await ctx.call("/trainer/follower-exits", { cookie: other.cookie })).statusCode,
    403,
  );
});
