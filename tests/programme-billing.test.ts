import { readyServices } from "./service-readiness-fixtures.ts";
let restoreServices = () => {};
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createDatabase, type Database } from "@trainer/db";
import {
  createMembershipCheckout,
  reconcileMembershipCheckout,
} from "../apps/api/src/finance-checkout.ts";
import { processStripeEvent } from "../apps/api/src/stripe-events.ts";
import { decideRefund, requestRefund } from "../apps/api/src/finance-billing.ts";
import { financialStatement } from "../apps/api/src/finance-statements.ts";
import { memberAccess } from "../apps/api/src/entitlements.ts";
import { programmeLengthDays } from "../apps/api/src/programme-length.ts";
import { seedScope } from "./scope-fixtures.ts";
import {
  evt,
  fakeStripe,
  follower,
  offer,
  paidProgrammeSession,
  request,
  withEnv,
  workspace,
  type Member,
} from "./programme-fixtures.ts";

let db: Database, owner: Member;
const options = { origin: "http://localhost:3000", nutritionReady: async () => {} };
const DAY = 86400000;
before(async () => {
  db = await createDatabase({ memory: true });
  owner = await workspace(db);
  restoreServices = await readyServices(db,owner);
});
after(async () => db.close());

const intents = (userId: string) =>
  db.tenant(seedScope(owner), (tx) =>
    tx.query(
      "SELECT * FROM records WHERE kind='checkout' AND owner_user_id=$1 ORDER BY created_at,id",
      [userId],
    ),
  );
const subscription = async (userId: string) =>
  (
    await db.tenant(seedScope(owner), (tx) =>
      tx.query("SELECT * FROM subscriptions WHERE user_id=$1", [userId]),
    )
  )[0];
const journals = (prefix: string, userId: string) =>
  db.tenant(seedScope(owner, "finance"), (tx) =>
    tx.query(
      "SELECT j.*,(SELECT json_object_agg(l.account,l.amount_minor) FROM journal_lines l WHERE l.journal_id=j.id) AS lines FROM journals j WHERE j.source_key LIKE $1 AND j.data->>'userId'=$2 ORDER BY j.created_at,j.id",
      [prefix + "%", userId],
    ),
  );
/** Buys an upfront programme end to end: admission, Checkout, signed completion. */
async function buyProgramme(member: Member, product: any, stripe = fakeStripe()) {
  const result = await createMembershipCheckout(
    db,
    member,
    { productId: product.id },
    options,
    stripe,
  );
  const [intent] = (await intents(member.userId)).filter(
    (r) => r.id === result.intentId,
  );
  const session = paidProgrammeSession(intent);
  Object.assign(stripe.sessions.get(intent.data.providerId) ?? {}, session);
  await processStripeEvent(db, evt("checkout.session.completed", session), {
    stripe,
  });
  return { intent, session, stripe };
}

test("offers: the trainer sets billing and programme length; activation creates a one-time price for upfront and a separate monthly voice add-on price", async () => {
  const { buildApp } = await import("../apps/api/src/app.ts");
  const stripe = fakeStripe();
  const app = await buildApp({ db, testing: true, providers: { stripe: () => stripe } });
  try {
    const base = { name: "Twelve weeks", description: "Strength block", priceMinor: 90000 };
    const missing = await request(app, "POST", "/products", owner.token, { ...base, billing: "upfront" });
    assert.equal(missing.statusCode, 400, missing.body);
    const created = await request(app, "POST", "/products", owner.token, {
      ...base,
      billing: "upfront",
      programmeDays: 84,
      voiceAddOnMinor: 4900,
    });
    assert.equal(created.statusCode, 200, created.body);
    const product = created.json();
    assert.deepEqual(
      [product.data.billing, product.data.programmeDays, product.data.voiceAddOnMinor, product.status],
      ["upfront", 84, 4900, "draft"],
    );
    // The combined tier must be comparable: same billing and length.
    const unpaired = await request(app, "POST", "/products", owner.token, {
      ...base,
      name: "Twelve weeks + nutrition",
      priceMinor: 120000,
      tier: "workout_nutrition",
      baseProductId: product.id,
      billing: "monthly",
    });
    assert.equal(unpaired.statusCode, 400, unpaired.body);
    assert.equal(unpaired.json().code, "OFFER_PAIR_BILLING");
    const blocked = await withEnv({ COMMERCE_APPROVED: "false" }, () =>
      request(app, "POST", `/products/${product.id}/activate`, owner.token, {}),
    );
    assert.equal(blocked.statusCode, 503, blocked.body);
    const activated = await withEnv({ COMMERCE_APPROVED: "true" }, () =>
      request(app, "POST", `/products/${product.id}/activate`, owner.token, {}),
    );
    assert.equal(activated.statusCode, 200, activated.body);
    const prices = stripe.calls.filter((c: any) => c.call === "price");
    assert.equal(prices.length, 2);
    assert.equal(prices[0].body.unit_amount, 90000);
    assert.equal(prices[0].body.recurring, undefined, "an upfront programme is a one-time price");
    assert.equal(prices[0].body.metadata.billing, "upfront");
    assert.equal(prices[1].body.unit_amount, 4900);
    assert.deepEqual(prices[1].body.recurring, { interval: "month" });
    assert.equal(prices[1].body.metadata.purpose, "voice_addon");
    const [published] = await db.tenant(seedScope(owner), (tx) =>
      tx.query("SELECT status,data FROM records WHERE id=$1", [product.id]),
    );
    assert.equal(published.status, "published");
    assert.ok(published.data.voiceStripePriceId);
    // A changed add-on price is a new provider price; the old one stays recognised.
    const repriced = await withEnv({ COMMERCE_APPROVED: "true" }, () =>
      request(app, "POST", `/products/${product.id}/voice-addon`, owner.token, { priceMinor: 5900 }),
    );
    assert.equal(repriced.statusCode, 200, repriced.body);
    const [after] = await db.tenant(seedScope(owner), (tx) =>
      tx.query("SELECT data FROM records WHERE id=$1", [product.id]),
    );
    assert.equal(after.data.voiceAddOnMinor, 5900);
    assert.equal(after.data.voicePriceIds.length, 2);
    assert.ok(after.data.voicePriceIds.includes(published.data.voiceStripePriceId));
    const member = await follower(db, owner);
    const refused = await request(app, "POST", `/products/${product.id}/voice-addon`, member.token, { priceMinor: 5900 });
    assert.equal(refused.statusCode, 403, refused.body);
    // A monthly offer still renews monthly; its length defines block length.
    const monthly = await request(app, "POST", "/products", owner.token, {
      ...base,
      name: "Monthly strength",
      priceMinor: 30000,
      programmeDays: 42,
    });
    assert.equal(monthly.statusCode, 200, monthly.body);
    await withEnv({ COMMERCE_APPROVED: "true" }, () =>
      request(app, "POST", `/products/${monthly.json().id}/activate`, owner.token, {}),
    );
    assert.deepEqual(stripe.calls.filter((c: any) => c.call === "price").at(-1).body.recurring, { interval: "month" });
  } finally {
    await app.close();
  }
});

test("upfront checkout: one Checkout payment, a programme journal with commission, and access for the trainer-set length", async () => {
  const product = await offer(db, owner, { billing: "upfront", programmeDays: 84, priceMinor: 60000 });
  const member = await follower(db, owner);
  const stripe = fakeStripe();
  const started = Date.now();
  const { intent, session } = await buyProgramme(member, product, stripe);
  const [checkout] = stripe.calls.filter((c: any) => c.call === "checkout");
  assert.equal(checkout.body.mode, "payment");
  assert.equal(checkout.body.subscription_data, undefined);
  assert.deepEqual(checkout.body.line_items, [{ price: product.data.stripePriceId, quantity: 1 }]);
  assert.equal(checkout.body.payment_intent_data.metadata.purpose, "programme");
  assert.equal(checkout.key, "checkout:" + intent.id);
  assert.equal(intent.data.billing, "upfront");
  assert.equal(intent.data.offerTerms.trialDays, 0);
  // Ledger: gross, commission at the member's stable rank, trainer payable.
  const [charge] = await journals("stripe-programme:", member.userId);
  assert.equal(charge.source_key, "stripe-programme:" + intent.id);
  assert.equal(charge.description, "Programme payment");
  assert.equal(charge.data.grossMinor, 60000);
  assert.equal(charge.data.commissionMinor, 15000);
  assert.equal(charge.data.chargeId, "ch_" + session.payment_intent);
  assert.deepEqual(charge.lines, {
    stripe_receivable: 60000,
    trainer_payable: -45000,
    platform_commission: -15000,
  });
  // Access window [paid, paid + 84 days), no provider subscription.
  const s = await subscription(member.userId);
  assert.equal(s.provider_id, null);
  assert.equal(s.status, "active");
  assert.equal(s.data.billing, "upfront");
  assert.equal(s.data.programmeDays, 84);
  assert.equal(s.data.commissionRank, 1);
  const window = new Date(s.period_end).getTime() - Date.parse(s.data.programmeStartsAt);
  assert.equal(window, 84 * DAY);
  assert.ok(Date.parse(s.data.programmeStartsAt) >= started - 5000);
  const access = await db.tenant(member, (tx) => memberAccess(tx, member.userId));
  assert.equal(access.active, true);
  assert.deepEqual(access.modules, ["training"]);
  assert.equal(access.premiumVoice, false);
  assert.equal(await db.tenant(member, (tx) => programmeLengthDays(tx, member.userId)), 84);
  const [completed] = await intents(member.userId);
  assert.equal(completed.status, "completed");
  // A replayed provider event posts nothing twice.
  await processStripeEvent(db, evt("checkout.session.completed", session), { stripe });
  assert.equal((await journals("stripe-programme:", member.userId)).length, 1);
  // More than a week of access left: another purchase is refused.
  await assert.rejects(
    createMembershipCheckout(db, member, { productId: product.id }, options, stripe),
    (e: any) => e.code === "ALREADY_SUBSCRIBED",
  );
  // The member's own charge list (member_charges(), migration 064) includes it.
  const { buildApp } = await import("../apps/api/src/app.ts");
  const app = await buildApp({ db, testing: true });
  try {
    const billing = await request(app, "GET", "/membership/billing", member.token);
    assert.equal(billing.statusCode, 200, billing.body);
    const [own] = billing.json().charges;
    assert.equal(own.chargeId, charge.data.chargeId);
    assert.equal(own.eligible, true);
  } finally {
    await app.close();
  }
  // Statements show programme revenue apart from memberships.
  const period = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit" })
    .format(new Date())
    .slice(0, 7);
  const statement = await db.tenant(seedScope(owner, "finance"), (tx) => financialStatement(tx, period));
  assert.ok(statement.revenue.programmeMinor >= 60000);
  assert.equal(statement.revenue.voiceAddOnMinor, 0);
});

test("upfront payments are verified: wrong amount, currency or unpaid status never grant access", async () => {
  const product = await offer(db, owner, { billing: "upfront", programmeDays: 28, priceMinor: 40000 });
  const member = await follower(db, owner);
  const stripe = fakeStripe();
  const result = await createMembershipCheckout(db, member, { productId: product.id }, options, stripe);
  const [intent] = await intents(member.userId);
  assert.equal(intent.id, result.intentId);
  for (const wrong of [{ amount_total: 100 }, { currency: "usd" }, { payment_status: "failed" }])
    await assert.rejects(
      processStripeEvent(db, evt("checkout.session.completed", paidProgrammeSession(intent, wrong)), { stripe }),
      (e: any) => e.code === "PROGRAMME_AMOUNT_MISMATCH",
      JSON.stringify(wrong),
    );
  // A delayed payment method waits for async_payment_succeeded.
  await processStripeEvent(
    db,
    evt("checkout.session.completed", paidProgrammeSession(intent, { payment_status: "unpaid" })),
    { stripe },
  );
  assert.equal(await subscription(member.userId), undefined);
  // Another member's identity in the metadata is refused.
  const other = await follower(db, owner);
  await assert.rejects(
    processStripeEvent(
      db,
      evt("checkout.session.completed", paidProgrammeSession(intent, {
        metadata: { ...paidProgrammeSession(intent).metadata, user_id: other.userId },
      })),
      { stripe },
    ),
    (e: any) => e.code === "CHECKOUT_IDENTITY_MISMATCH",
  );
  await processStripeEvent(
    db,
    evt("checkout.session.async_payment_succeeded", paidProgrammeSession(intent)),
    { stripe },
  );
  assert.equal((await subscription(member.userId)).status, "active");
});

test("refunds: a partial refund keeps the programme; refunding the rest ends access and reverses all commission", async () => {
  const product = await offer(db, owner, { billing: "upfront", programmeDays: 56, priceMinor: 60000 });
  const member = await follower(db, owner);
  const stripe = fakeStripe();
  const { session } = await buyProgramme(member, product, stripe);
  const chargeId = "ch_" + session.payment_intent;
  // An operator refunds part of the payment at the provider.
  await processStripeEvent(
    db,
    evt("refund.updated", {
      id: "re_partial_" + member.userId.slice(0, 6),
      object: "refund",
      status: "succeeded",
      amount: 20000,
      currency: "aed",
      charge: chargeId,
      payment_intent: session.payment_intent,
      metadata: {},
    }),
  );
  let [refund] = await journals("stripe-refund:", member.userId);
  assert.equal(refund.description, "Programme refund");
  assert.equal(refund.data.refundAmountMinor, 20000);
  assert.equal(refund.data.commissionReversalMinor, 5000);
  assert.equal((await subscription(member.userId)).status, "active");
  // The member asks for the rest through the normal request and decision path.
  const requested = await requestRefund(db, member, { chargeId, reason: "Moving abroad next week" });
  assert.equal(requested.data.amountMinor, 40000);
  await decideRefund(db, owner, requested.id, { approve: true, reason: "Approved relocation" }, false, stripe);
  const sent = stripe.calls.find((c: any) => c.call === "refund");
  assert.deepEqual([sent.body.charge, sent.body.amount], [chargeId, 40000]);
  await processStripeEvent(
    db,
    evt("refund.updated", {
      id: "re_rest_" + member.userId.slice(0, 6),
      object: "refund",
      status: "succeeded",
      amount: 40000,
      currency: "aed",
      charge: chargeId,
      payment_intent: session.payment_intent,
      metadata: { refund_request_id: requested.id },
    }),
  );
  const refunds = await journals("stripe-refund:", member.userId);
  assert.equal(refunds.length, 2);
  assert.equal(
    refunds.reduce((n: number, r: any) => n + r.data.commissionReversalMinor, 0),
    15000,
    "the final refund reverses the remaining commission exactly",
  );
  const s = await subscription(member.userId);
  assert.equal(s.status, "canceled");
  assert.equal(s.data.endedReason, "refunded");
  assert.ok(new Date(s.period_end).getTime() <= Date.now());
  const access = await db.tenant(member, (tx) => memberAccess(tx, member.userId));
  assert.equal(access.active, false);
  // A refund beyond the charge is refused by the ledger rules.
  await assert.rejects(
    processStripeEvent(
      db,
      evt("refund.updated", {
        id: "re_extra_" + member.userId.slice(0, 6),
        object: "refund",
        status: "succeeded",
        amount: 100,
        currency: "aed",
        charge: chargeId,
        metadata: {},
      }),
    ),
    /Refund exceeds original charge/,
  );
  // Ended by refund, the member may buy again.
  const again = await createMembershipCheckout(db, member, { productId: product.id }, options, stripe);
  assert.ok(again.url);
});

test("renewing in the final week queues the next programme after the current one; refunds remove it or start it now", async () => {
  const { sweepProgrammes, programmeToday } = await import("../apps/api/src/programme-today.ts");
  const product = await offer(db, owner, { billing: "upfront", programmeDays: 28, priceMinor: 30000 });
  const longer = await offer(db, owner, { billing: "upfront", programmeDays: 42, priceMinor: 42000 });
  const monthly = await offer(db, owner, { billing: "monthly" });
  /** A member three days before the end of a 28-day programme. */
  const nearlyDone = async () => {
    const member = await follower(db, owner);
    const stripe = fakeStripe();
    await buyProgramme(member, product, stripe);
    const first = await subscription(member.userId);
    const previousEnd = new Date(Date.now() + 3 * DAY);
    await db.tenant(seedScope(owner), (tx) =>
      tx.query(
        "UPDATE subscriptions SET period_end=$2,data=jsonb_set(data||jsonb_build_object('programmeStartsAt',$3::text),'{upfront,endsAt}',to_jsonb($4::text)) WHERE id=$1",
        [first.id, previousEnd, new Date(previousEnd.getTime() - 28 * DAY).toISOString(), previousEnd.toISOString()],
      ),
    );
    return { member, stripe, first: await subscription(member.userId), previousEnd };
  };
  const refund = (id: string, amount: number, session: any) =>
    processStripeEvent(
      db,
      evt("refund.updated", {
        id,
        object: "refund",
        status: "succeeded",
        amount,
        currency: "aed",
        charge: "ch_" + session.payment_intent,
        metadata: {},
      }),
    );

  const { member, stripe, first, previousEnd } = await nearlyDone();
  await assert.rejects(
    createMembershipCheckout(db, member, { productId: monthly.id }, options, stripe),
    (e: any) => e.code === "ALREADY_SUBSCRIBED",
    "a monthly membership starts after the programme ends",
  );
  const queued = await buyProgramme(member, longer, stripe);
  let s = await subscription(member.userId);
  // The current programme is untouched; the renewal starts when it ends.
  assert.equal(s.data.upfront.intentId, first.data.upfront.intentId);
  assert.equal(s.data.programmeStartsAt, first.data.programmeStartsAt);
  assert.equal(s.data.programmeDays, 28);
  assert.equal(s.data.nextProgramme.startsAt, previousEnd.toISOString());
  assert.equal(s.data.nextProgramme.programmeDays, 42);
  assert.equal(new Date(s.period_end).getTime(), previousEnd.getTime() + 42 * DAY);
  assert.equal(s.data.commissionRank, first.data.commissionRank);
  const [renewalJournal] = (await journals("stripe-programme:", member.userId)).slice(-1);
  assert.equal(renewalJournal.data.accessStartsAt, previousEnd.toISOString());
  assert.equal(await db.tenant(member, (tx) => programmeLengthDays(tx, member.userId)), 28);
  const today: any = await programmeToday(db, member);
  assert.deepEqual([today.programme.day, today.programme.of], [26, 28]);
  assert.equal(today.endOfProgramme.state, "next_block");
  assert.equal(today.nextProgramme.programmeDays, 42);
  // Only one programme is queued at a time.
  await assert.rejects(
    createMembershipCheckout(db, member, { productId: product.id }, options, stripe),
    (e: any) => e.code === "ALREADY_SUBSCRIBED",
  );
  // A full refund of the queued programme removes it; access returns to the current end.
  await refund("re_queued_" + member.userId.slice(0, 6), 42000, queued.session);
  s = await subscription(member.userId);
  assert.equal(s.status, "active");
  assert.equal(s.data.nextProgramme, undefined);
  assert.equal(new Date(s.period_end).getTime(), previousEnd.getTime());
  assert.equal(s.data.upfront.intentId, first.data.upfront.intentId);
  // Queued again, then its start passes: it applies at once and the worker promotes it.
  const again = await buyProgramme(member, longer, stripe);
  await db.tenant(seedScope(owner), (tx) =>
    tx.query(
      "UPDATE subscriptions SET period_end=now()+interval '41 days',data=jsonb_set(jsonb_set(data,'{nextProgramme,startsAt}',to_jsonb((now()-interval '1 day')::text)),'{upfront,endsAt}',to_jsonb((now()-interval '1 day')::text)) WHERE user_id=$1",
      [member.userId],
    ),
  );
  assert.equal(await db.tenant(member, (tx) => programmeLengthDays(tx, member.userId)), 42);
  const swept = await sweepProgrammes(db, owner.tenantId);
  assert.ok(swept.started >= 1);
  s = await subscription(member.userId);
  assert.equal(s.data.upfront.intentId, again.intent.id);
  assert.equal(s.data.programmeDays, 42);
  assert.equal(s.data.productId, longer.id);
  assert.equal(s.data.nextProgramme, undefined);
  assert.ok(s.data.programmeHistory.some((w: any) => w.intentId === first.data.upfront.intentId));
  assert.equal(((await programmeToday(db, member)) as any).programme.day, 2);

  // A full refund of the current programme starts a queued one now.
  const other = await nearlyDone();
  const otherQueued = await buyProgramme(other.member, longer, other.stripe);
  const firstSession = paidProgrammeSession(
    (await intents(other.member.userId)).find((r) => r.id === other.first.data.upfront.intentId),
  );
  await refund("re_current_" + other.member.userId.slice(0, 6), 30000, firstSession);
  s = await subscription(other.member.userId);
  assert.equal(s.status, "active");
  assert.equal(s.data.upfront.intentId, otherQueued.intent.id);
  assert.equal(s.data.nextProgramme, undefined);
  assert.ok(Math.abs(new Date(s.period_end).getTime() - (Date.now() + 42 * DAY)) < 60000);
  assert.ok(Math.abs(Date.parse(s.data.programmeStartsAt) - Date.now()) < 60000);
});

test("reconciliation completes a programme whose webhook was lost, and a late event of an older monthly membership never replaces it", async () => {
  const product = await offer(db, owner, { billing: "upfront", programmeDays: 42, priceMinor: 45000 });
  const member = await follower(db, owner);
  const stripe = fakeStripe();
  const result = await createMembershipCheckout(db, member, { productId: product.id }, options, stripe);
  const [intent] = (await intents(member.userId)).filter((r) => r.id === result.intentId);
  // The provider completed the payment, but the webhook never arrived.
  const remote = stripe.sessions.get(intent.data.providerId);
  Object.assign(remote, paidProgrammeSession(intent, { id: remote.id }));
  const outcome = await reconcileMembershipCheckout(db, member, stripe);
  assert.equal(outcome.status, "complete");
  const s = await subscription(member.userId);
  assert.equal(s.status, "active");
  assert.equal(s.data.programmeDays, 42);
  assert.equal((await journals("stripe-programme:", member.userId)).length, 1);
  // An older membership's late events: a terminal one is history, an active one needs review.
  await processStripeEvent(
    db,
    evt("customer.subscription.deleted", {
      id: "sub_old_" + member.userId.slice(0, 6),
      object: "subscription",
      status: "canceled",
      metadata: { tenant_id: member.tenantId, user_id: member.userId },
      items: { data: [{ price: { id: "price_unrelated" } }] },
    }),
  );
  await assert.rejects(
    processStripeEvent(
      db,
      evt("customer.subscription.updated", {
        id: "sub_old_" + member.userId.slice(0, 6),
        object: "subscription",
        status: "active",
        metadata: { tenant_id: member.tenantId, user_id: member.userId },
        items: { data: [{ price: { id: "price_unrelated" } }] },
      }),
    ),
    /requires reconciliation/,
  );
  const unchanged = await subscription(member.userId);
  assert.equal(unchanged.provider_id, null);
  assert.equal(unchanged.data.billing, "upfront");
  assert.equal(unchanged.status, "active");
});

test("after an upfront programme ends, a monthly membership replaces it cleanly and the paid programme intent is settled", async () => {
  const { settlementBlockers } = await import("../apps/api/src/privacy-lifecycle.ts");
  const { sweepProgrammes } = await import("../apps/api/src/programme-today.ts");
  const product = await offer(db, owner, { billing: "upfront", programmeDays: 28, priceMinor: 30000 });
  const monthly = await offer(db, owner, { billing: "monthly", programmeDays: 42 });
  const member = await follower(db, owner);
  await buyProgramme(member, product);
  const rank = (await subscription(member.userId)).data.commissionRank;
  const blockers = () =>
    db.tenant(seedScope(owner, "finance"), (tx) => settlementBlockers(tx, member.userId));
  assert.deepEqual((await blockers()).map((b: any) => b.kind), ["subscription"]);
  // The programme ends; the worker sweep closes it.
  await db.tenant(seedScope(owner), (tx) =>
    tx.query("UPDATE subscriptions SET period_end=now()-interval '1 minute' WHERE user_id=$1", [member.userId]),
  );
  await sweepProgrammes(db, owner.tenantId);
  assert.deepEqual(await blockers(), [], "a paid, ended programme leaves nothing to settle");
  const now = Math.floor(Date.now() / 1000);
  await processStripeEvent(
    db,
    evt(
      "customer.subscription.created",
      {
        id: "sub_after_" + member.userId.slice(0, 8),
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
  assert.equal(s.provider_id, "sub_after_" + member.userId.slice(0, 8));
  assert.equal(s.status, "active");
  assert.equal(s.data.billing, "monthly");
  assert.equal(s.data.programmeDays, 42);
  assert.equal(s.data.upfront, null);
  assert.equal(s.data.productId, monthly.id);
  assert.equal(s.data.programmeStartsAt, new Date(now * 1000).toISOString());
  assert.equal(s.data.commissionRank, rank, "the stable commission rank is kept");
  assert.equal(await db.tenant(member, (tx) => programmeLengthDays(tx, member.userId)), 42);
});
