import { readyServices } from "./service-readiness-fixtures.ts";
let restoreServices = () => {};
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, putRecord, type Database } from "@trainer/db";
import { ProviderUnavailable } from "@trainer/providers";
import { processStripeEvent } from "../apps/api/src/stripe-events.ts";
import { memberAccess } from "../apps/api/src/entitlements.ts";
import { sweepProgrammes } from "../apps/api/src/programme-today.ts";
import { endFollowerMembership } from "../apps/api/src/membership-exit.ts";
import { dateIn, addDays } from "../packages/domain/src/programme.ts";
import { seedScope } from "./scope-fixtures.ts";
import {
  evt,
  fakeStripe,
  follower,
  offer,
  request,
  tick,
  withEnv,
  workspace,
  type Member,
} from "./programme-fixtures.ts";

/**
 * Regression tests for the programme package review (docs/features/programme.md,
 * "Review fixes"): the voice add-on ends with the membership, the orphan sweep
 * is not starved by healthy add-ons, a monthly membership replaces an ended but
 * unswept upfront programme, add-on purchase and refund edges, the plan state
 * of the day-by-day view, and the paged block sweep. Synthetic data only.
 */
let db: Database, owner: Member, app: any, stripe: any;
const DAY = 86400000;
before(async () => {
  db = await createDatabase({ memory: true });
  owner = await workspace(db);
  restoreServices = await readyServices(db,owner);
  stripe = fakeStripe();
  const { buildApp } = await import("../apps/api/src/app.ts");
  app = await buildApp({ db, testing: true, providers: { stripe: () => stripe } });
});
after(async () => {
  restoreServices();
  await app.close();
  await db.close();
});

const subscription = async (userId: string, o: Member = owner) =>
  (
    await db.tenant(seedScope(o), (tx) =>
      tx.query("SELECT * FROM subscriptions WHERE user_id=$1", [userId]),
    )
  )[0];
/** An upfront membership row as a verified programme payment leaves it. */
async function upfrontRow(o: Member, member: Member, product: any, startedDaysAgo: number, days: number) {
  const startsAt = new Date(Date.now() - startedDaysAgo * DAY);
  const endsAt = new Date(startsAt.getTime() + days * DAY);
  await db.tenant(seedScope(o, "finance"), (tx) =>
    tx.query(
      "INSERT INTO subscriptions(id,tenant_id,user_id,provider_id,status,period_end,price_minor,data) VALUES($1,$2,$3,NULL,'active',$4,$5,$6)",
      [
        randomUUID(),
        o.tenantId,
        member.userId,
        endsAt,
        product.data.priceMinor,
        JSON.stringify({
          billing: "upfront",
          productId: product.id,
          tier: product.data.tier ?? "workout",
          modules: product.data.modules ?? ["training"],
          programmeDays: days,
          programmeStartsAt: startsAt.toISOString(),
          upfront: { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() },
        }),
      ],
    ),
  );
}
const voiceSubscription = (member: Member, price: string) => ({
  id: "sub_voice_" + member.userId.slice(0, 8),
  object: "subscription",
  status: "active",
  cancel_at_period_end: false,
  current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
  metadata: { tenant_id: member.tenantId, user_id: member.userId, purpose: "voice_addon" },
  items: { data: [{ price: { id: price, unit_amount: 4900 } }] },
});

test("leaving ends the voice add-on: renewal stops before the exit, and the worker cancels it once the member is gone", async () => {
  const product = await offer(db, owner, {
    billing: "upfront",
    programmeDays: 200,
    voiceAddOnMinor: 4900,
    voiceStripePriceId: "price_voice_exit",
    voicePriceIds: ["price_voice_exit"],
  });
  const member = await follower(db, owner);
  await upfrontRow(owner, member, product, 1, 200);
  const sub = voiceSubscription(member, "price_voice_exit");
  await processStripeEvent(db, evt("customer.subscription.created", sub, tick()));
  assert.equal((await db.tenant(member, (tx) => memberAccess(tx, member.userId))).premiumVoice, true);
  // Without payments the exit is refused and nothing changes.
  await assert.rejects(
    endFollowerMembership(db, {
      tenantId: owner.tenantId,
      followerId: member.userId,
      actorId: member.userId,
      kind: "left",
      stripe: () => {
        throw new ProviderUnavailable("stripe", "not configured");
      },
    }),
    /Payments are unavailable/,
  );
  const [still] = await db.system((tx) =>
    tx.query("SELECT role FROM memberships WHERE tenant_id=$1 AND user_id=$2", [owner.tenantId, member.userId]),
  );
  assert.equal(still?.role, "subscriber");
  const provider = fakeStripe();
  provider.subscriptionStore.set(sub.id, sub);
  const exit = await endFollowerMembership(db, {
    tenantId: owner.tenantId,
    followerId: member.userId,
    actorId: member.userId,
    kind: "left",
    stripe: () => provider,
  });
  assert.equal(exit.voiceAddOn, "ends");
  const stop = provider.calls.find((c: any) => c.call === "subscription.update" && c.id === sub.id);
  assert.deepEqual(stop.body, { cancel_at_period_end: true });
  assert.equal((await subscription(member.userId)).data.voiceAddOn.cancelAtPeriodEnd, true);
  // The upfront access window is still current, but the member is gone: the add-on ends now.
  const swept = await sweepProgrammes(db, owner.tenantId, { stripe: provider });
  assert.equal(swept.voice.ended, 1);
  const cancel = provider.calls.filter((c: any) => c.call === "subscription.cancel" && c.id === sub.id);
  assert.equal(cancel.length, 1);
  assert.equal(cancel[0].key, "voice-addon-end:" + sub.id);
  assert.equal((await subscription(member.userId)).data.voiceAddOn.status, "canceled");
  await sweepProgrammes(db, owner.tenantId, { stripe: provider });
  assert.equal(provider.calls.filter((c: any) => c.call === "subscription.cancel").length, 1);
});

test("the orphan sweep finds an ended add-on behind more than 100 healthy ones", async () => {
  const o = await workspace(db);
  const product = await offer(db, o, {
    voiceAddOnMinor: 4900,
    voiceStripePriceId: "price_voice_many",
    voicePriceIds: ["price_voice_many"],
  });
  const ids = Array.from({ length: 101 }, () => randomUUID()).sort();
  const orphan = ids.at(-1)!;
  await db.system(async (tx) => {
    for (const id of ids) {
      await tx.query(
        "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Member','fixture-only')",
        [id, id + "@example.test"],
      );
      await tx.query(
        "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'subscriber')",
        [o.tenantId, id],
      );
    }
  });
  await db.tenant(seedScope(o, "finance"), async (tx) => {
    for (const id of ids)
      await tx.query(
        "INSERT INTO subscriptions(id,tenant_id,user_id,provider_id,status,period_end,price_minor,data) VALUES($1,$2,$3,$4,$5,now()+interval '20 days',30000,$6)",
        [
          randomUUID(),
          o.tenantId,
          id,
          "sub_m_" + id.slice(0, 8),
          id === orphan ? "canceled" : "active",
          JSON.stringify({
            productId: product.id,
            voiceAddOn: {
              providerId: "sub_v_" + id.slice(0, 8),
              status: "active",
              verified: true,
              cancelAtPeriodEnd: false,
              periodEnd: new Date(Date.now() + 20 * DAY).toISOString(),
              lastStripeEventAt: 1,
            },
          }),
        ],
      );
  });
  const provider = fakeStripe();
  const swept = await sweepProgrammes(db, o.tenantId, { stripe: provider });
  assert.deepEqual(swept.voice, { ended: 1, pending: 0 });
  const cancels = provider.calls.filter((c: any) => c.call === "subscription.cancel");
  assert.deepEqual(cancels.map((c: any) => c.id), ["sub_v_" + orphan.slice(0, 8)]);
});

test("a monthly membership bought after upfront access ended replaces the row before the worker sweep", async () => {
  const product = await offer(db, owner, { billing: "upfront", programmeDays: 28 });
  const monthly = await offer(db, owner, { billing: "monthly", programmeDays: 28 });
  const member = await follower(db, owner);
  await upfrontRow(owner, member, product, 29, 28);
  const now = Math.floor(Date.now() / 1000);
  const id = "sub_after_end_" + member.userId.slice(0, 8);
  await processStripeEvent(
    db,
    evt(
      "customer.subscription.created",
      {
        id,
        object: "subscription",
        status: "active",
        start_date: now,
        current_period_end: now + 30 * 86400,
        metadata: { tenant_id: member.tenantId, user_id: member.userId },
        items: { data: [{ price: { id: monthly.data.stripePriceId } }] },
      },
      now,
    ),
  );
  const s = await subscription(member.userId);
  assert.equal(s.provider_id, id);
  assert.equal(s.data.billing, "monthly");
  assert.equal(s.data.productId, monthly.id);
  assert.equal(s.data.upfront, null);
  assert.equal(s.data.programmeHistory.length, 1, "the ended programme moves to the history");
  assert.equal((await db.tenant(member, (tx) => memberAccess(tx, member.userId))).active, true);
  // A late terminal event of an older membership is still only history.
  const late = await follower(db, owner);
  await upfrontRow(owner, late, product, 29, 28);
  await processStripeEvent(
    db,
    evt(
      "customer.subscription.deleted",
      {
        id: "sub_older_" + late.userId.slice(0, 8),
        object: "subscription",
        status: "canceled",
        metadata: { tenant_id: late.tenantId, user_id: late.userId },
        items: { data: [{ price: { id: monthly.data.stripePriceId } }] },
      },
      now,
    ),
  );
  assert.equal((await subscription(late.userId)).data.billing, "upfront");
});

test("a completed add-on checkout whose subscription is not mirrored yet is pending, never a second purchase; a full add-on refund ends voice", async () => {
  const product = await offer(db, owner, {
    voiceAddOnMinor: 4900,
    voiceStripePriceId: "price_voice_pending",
    voicePriceIds: ["price_voice_pending"],
  });
  const member = await follower(db, owner);
  const now = Math.floor(Date.now() / 1000);
  await processStripeEvent(
    db,
    evt(
      "customer.subscription.created",
      {
        id: "sub_member_" + member.userId.slice(0, 8),
        object: "subscription",
        status: "active",
        start_date: now,
        current_period_end: now + 30 * 86400,
        metadata: { tenant_id: member.tenantId, user_id: member.userId },
        items: { data: [{ price: { id: product.data.stripePriceId } }] },
      },
      tick(),
    ),
  );
  const added = await withEnv({ COMMERCE_APPROVED: "true" }, () =>
    request(app, "POST", "/membership/voice-addon", member.token, {}),
  );
  assert.equal(added.statusCode, 200, added.body);
  const session = [...stripe.sessions.values()].find(
    (x: any) => x.client_reference_id === added.json().intentId,
  );
  const sub = voiceSubscription(member, "price_voice_pending");
  const completed = { ...session, status: "complete", subscription: sub.id };
  stripe.sessions.set(session.id, completed);
  await processStripeEvent(db, evt("checkout.session.completed", completed));
  let status = (await request(app, "GET", "/membership/voice-addon", member.token)).json();
  assert.equal(status.pending?.status, "confirming");
  assert.equal(status.available, false);
  const twice = await withEnv({ COMMERCE_APPROVED: "true" }, () =>
    request(app, "POST", "/membership/voice-addon", member.token, {}),
  );
  assert.equal(twice.statusCode, 409, twice.body);
  assert.equal(twice.json().code, "VOICE_PENDING");
  assert.equal(stripe.calls.filter((c: any) => c.call === "checkout" && c.body.metadata?.user_id === member.userId).length, 1);
  // Checking the purchase mirrors the subscription from the provider.
  stripe.subscriptionStore.set(sub.id, sub);
  const checked = await request(app, "POST", "/membership/voice-addon/reconcile", member.token, {});
  assert.equal(checked.statusCode, 200, checked.body);
  status = (await request(app, "GET", "/membership/voice-addon", member.token)).json();
  assert.deepEqual([status.active, status.pending], [true, null]);
  // A full refund of an add-on charge ends voice now, and the worker cancels it.
  const invoiceId = "in_voice_refund_" + member.userId.slice(0, 8);
  await processStripeEvent(
    db,
    evt(
      "invoice.paid",
      {
        id: invoiceId,
        object: "invoice",
        status: "paid",
        amount_paid: 4900,
        amount_due: 4900,
        currency: "aed",
        created: Math.floor(Date.now() / 1000),
        charge: "ch_" + invoiceId,
        lines: { data: [{ period: { end: Math.floor(Date.now() / 1000) + 30 * 86400 } }] },
        parent: {
          subscription_details: {
            subscription: sub.id,
            metadata: { tenant_id: member.tenantId, user_id: member.userId, purpose: "voice_addon" },
          },
        },
      },
      tick(),
    ),
  );
  await processStripeEvent(
    db,
    evt("refund.updated", {
      id: "re_voice_full_" + member.userId.slice(0, 8),
      object: "refund",
      status: "succeeded",
      amount: 4900,
      currency: "aed",
      charge: "ch_" + invoiceId,
      metadata: {},
    }),
  );
  assert.equal((await db.tenant(member, (tx) => memberAccess(tx, member.userId))).premiumVoice, false);
  assert.match((await subscription(member.userId)).data.voiceAddOn.endRequested, /^refunded:/);
  const provider = fakeStripe();
  provider.subscriptionStore.set(sub.id, sub);
  await sweepProgrammes(db, owner.tenantId, { stripe: provider });
  assert.ok(provider.calls.some((c: any) => c.call === "subscription.cancel" && c.id === sub.id));
  const v = (await subscription(member.userId)).data.voiceAddOn;
  assert.equal(v.status, "canceled");
  assert.equal(v.endRequested, undefined);
});

test("Today tells a member waiting for a plan that the coach is preparing it, not to rest; an ended programme shows no day tiles", async () => {
  const product = await offer(db, owner, { billing: "upfront", programmeDays: 28 });
  const member = await follower(db, owner);
  await upfrontRow(owner, member, product, 2, 28);
  let today = (await request(app, "GET", "/programme/today", member.token)).json();
  assert.equal(today.planState, "awaiting_coach");
  assert.equal(today.restDay, false);
  const timeline = (await request(app, "GET", "/programme/timeline", member.token)).json();
  assert.equal(timeline.planState, "awaiting_coach");
  assert.ok(timeline.days.every((d: any) => d.kind === "unplanned"));
  // Once the block has a plan, a day without a session is a rest day.
  const date = dateIn("Asia/Dubai", new Date());
  await db.tenant(seedScope(owner), (tx) =>
    putRecord(
      tx,
      seedScope(owner),
      "planned_session",
      { date: addDays(date, 1), timezone: "Asia/Dubai", week: 1, label: "Strength", program: { exercises: [] } },
      { ownerId: member.userId, status: "planned" },
    ),
  );
  today = (await request(app, "GET", "/programme/today", member.token)).json();
  assert.deepEqual([today.planState, today.restDay], ["ready", true]);
  // Access ended (not yet swept): nothing to follow.
  await db.tenant(seedScope(owner, "finance"), (tx) =>
    tx.query("UPDATE subscriptions SET period_end=now()-interval '1 hour' WHERE user_id=$1", [member.userId]),
  );
  today = (await request(app, "GET", "/programme/today", member.token)).json();
  assert.deepEqual([today.planState, today.restDay], ["ended", false]);
});

test("the block sweep visits every monthly member, and a block missed during an outage is caught up once", async () => {
  const o = await workspace(db);
  const ids = Array.from({ length: 501 }, () => randomUUID()).sort();
  const due = ids.at(-1)!;
  const users = Array.from({ length: 501 }, () => randomUUID());
  await db.system(async (tx) => {
    for (const id of users)
      await tx.query(
        "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Member','fixture-only')",
        [id, id + "@example.test"],
      );
  });
  await db.tenant(seedScope(o, "finance"), async (tx) => {
    for (const [i, id] of ids.entries())
      await tx.query(
        "INSERT INTO subscriptions(id,tenant_id,user_id,provider_id,status,period_end,price_minor,data) VALUES($1,$2,$3,$4,'active',now()+interval '20 days',30000,$5)",
        [
          id,
          o.tenantId,
          users[i],
          "sub_block_" + id.slice(0, 8),
          JSON.stringify({
            billing: "monthly",
            programmeDays: 28,
            // Block 1 for everyone but the last row, which is 5 days into block 2.
            programmeStartsAt: new Date(Date.now() - (id === due ? 32 : 3) * DAY).toISOString(),
          }),
        ],
      );
  });
  const first = await sweepProgrammes(db, o.tenantId);
  assert.equal(first.blocks, 1, "day 5 of block 2 is within the catch-up window");
  const second = await sweepProgrammes(db, o.tenantId);
  assert.equal(second.blocks, 0);
  const [row] = await db.tenant(seedScope(o), (tx) =>
    tx.query("SELECT data->'blockNotice' AS notice FROM subscriptions WHERE id=$1", [due]),
  );
  assert.equal(row.notice.block, 2);
});

test("a workout + nutrition offer must share its pair's block length; a plan change to another length starts a new block", async () => {
  const o = await workspace(db);
  const provider = fakeStripe();
  const { buildApp } = await import("../apps/api/src/app.ts");
  const local = await buildApp({ db, testing: true, providers: { stripe: () => provider } });
  try {
    const base = await request(local, "POST", "/products", o.token, {
      name: "Monthly",
      description: "Strength",
      priceMinor: 30000,
      billing: "monthly",
      programmeDays: 28,
    });
    assert.equal(base.statusCode, 200, base.body);
    const unpaired = await request(local, "POST", "/products", o.token, {
      name: "Monthly + nutrition",
      description: "Strength and meals",
      priceMinor: 40000,
      tier: "workout_nutrition",
      baseProductId: base.json().id,
      billing: "monthly",
      programmeDays: 42,
    });
    assert.equal(unpaired.statusCode, 400, unpaired.body);
    assert.equal(unpaired.json().code, "OFFER_PAIR_BILLING");
  } finally {
    await local.close();
  }
  // An offer's length changed after the member joined: the next projection starts a new block.
  const short = await offer(db, o, { programmeDays: 28 });
  const member = await follower(db, o);
  const start = Math.floor((Date.now() - 40 * DAY) / 1000);
  const object = {
    id: "sub_len_" + member.userId.slice(0, 8),
    object: "subscription",
    status: "active",
    start_date: start,
    current_period_end: Math.floor(Date.now() / 1000) + 20 * 86400,
    metadata: { tenant_id: member.tenantId, user_id: member.userId },
    items: { data: [{ price: { id: short.data.stripePriceId } }] },
  };
  await processStripeEvent(db, evt("customer.subscription.created", object, tick()));
  assert.equal((await subscription(member.userId, o)).data.programmeStartsAt, new Date(start * 1000).toISOString());
  await db.tenant(seedScope(o), (tx) =>
    tx.query("UPDATE records SET data=data||'{\"programmeDays\":42}'::jsonb WHERE id=$1", [short.id]),
  );
  const at = tick();
  await processStripeEvent(db, evt("customer.subscription.updated", object, at));
  const s = await subscription(member.userId, o);
  assert.equal(s.data.programmeDays, 42);
  assert.equal(s.data.programmeStartsAt, new Date(at * 1000).toISOString());
});
