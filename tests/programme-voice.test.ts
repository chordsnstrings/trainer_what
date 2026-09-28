import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createDatabase, type Database } from "@trainer/db";
import { processStripeEvent } from "../apps/api/src/stripe-events.ts";
import { memberAccess } from "../apps/api/src/entitlements.ts";
import { financialStatement } from "../apps/api/src/finance-statements.ts";
import { sweepProgrammes } from "../apps/api/src/programme-today.ts";
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

let db: Database, owner: Member, app: any, stripe: any;
const DAY = 86400;
before(async () => {
  db = await createDatabase({ memory: true });
  owner = await workspace(db);
  stripe = fakeStripe();
  const { buildApp } = await import("../apps/api/src/app.ts");
  app = await buildApp({ db, testing: true, providers: { stripe: () => stripe } });
});
after(async () => {
  await app.close();
  await db.close();
});

const subscription = async (userId: string) =>
  (
    await db.tenant(seedScope(owner), (tx) =>
      tx.query("SELECT * FROM subscriptions WHERE user_id=$1", [userId]),
    )
  )[0];
const access = (m: Member) => db.tenant(m, (tx) => memberAccess(tx, m.userId));
/** A monthly membership projected from a signed provider subscription event. */
async function monthlyMember(product: any) {
  const member = await follower(db, owner);
  const now = tick();
  await processStripeEvent(
    db,
    evt(
      "customer.subscription.created",
      {
        id: "sub_member_" + member.userId.slice(0, 8),
        object: "subscription",
        status: "active",
        start_date: now,
        current_period_end: now + 30 * DAY,
        metadata: { tenant_id: member.tenantId, user_id: member.userId },
        items: { data: [{ price: { id: product.data.stripePriceId } }] },
      },
      now,
    ),
  );
  return member;
}
const voiceSubscription = (member: Member, price: string, extra: any = {}) => ({
  id: "sub_voice_" + member.userId.slice(0, 8),
  object: "subscription",
  status: "active",
  cancel_at_period_end: false,
  current_period_end: Math.floor(Date.now() / 1000) + 30 * DAY,
  metadata: {
    tenant_id: member.tenantId,
    user_id: member.userId,
    purpose: "voice_addon",
  },
  items: { data: [{ price: { id: price } }] },
  ...extra,
});
const voiceInvoice = (member: Member, amount: number) => {
  const id = "in_voice_" + member.userId.slice(0, 8) + "_" + tick();
  return {
    id,
    object: "invoice",
    status: "paid",
    amount_paid: amount,
    amount_due: amount,
    currency: "aed",
    created: Math.floor(Date.now() / 1000),
    charge: "ch_" + id,
    lines: { data: [{ period: { end: Math.floor(Date.now() / 1000) + 30 * DAY } }] },
    parent: {
      subscription_details: {
        subscription: "sub_voice_" + member.userId.slice(0, 8),
        metadata: { tenant_id: member.tenantId, user_id: member.userId, purpose: "voice_addon" },
      },
    },
  };
};

test("voice add-on: bought with a monthly membership through its own subscription checkout, entitles premium voice, and posts a commissionable add-on charge", async () => {
  const product = await offer(db, owner, {
    voiceAddOnMinor: 4900,
    voiceStripePriceId: "price_voice_monthly",
    voicePriceIds: ["price_voice_monthly"],
  });
  const member = await monthlyMember(product);
  const membership = await subscription(member.userId);
  assert.equal((await access(member)).premiumVoice, false);
  let status = await request(app, "GET", "/membership/voice-addon", member.token);
  assert.deepEqual(
    [status.json().available, status.json().active, status.json().priceMinor],
    [true, false, 4900],
  );
  const blocked = await withEnv({ COMMERCE_APPROVED: "false" }, () =>
    request(app, "POST", "/membership/voice-addon", member.token, {}),
  );
  assert.equal(blocked.statusCode, 503, blocked.body);
  const added = await withEnv({ COMMERCE_APPROVED: "true" }, () =>
    request(app, "POST", "/membership/voice-addon", member.token, {}),
  );
  assert.equal(added.statusCode, 200, added.body);
  assert.ok(added.json().url);
  const checkout = stripe.calls.filter((c: any) => c.call === "checkout").at(-1);
  assert.equal(checkout.body.mode, "subscription");
  assert.deepEqual(checkout.body.line_items, [{ price: "price_voice_monthly", quantity: 1 }]);
  assert.equal(checkout.body.subscription_data.metadata.purpose, "voice_addon");
  // A second request returns the same open checkout instead of a new one.
  const again = await withEnv({ COMMERCE_APPROVED: "true" }, () =>
    request(app, "POST", "/membership/voice-addon", member.token, {}),
  );
  assert.equal(again.json().intentId, added.json().intentId);
  assert.equal(stripe.calls.filter((c: any) => c.call === "checkout").length, 1);
  // The provider completes the checkout and creates the add-on subscription.
  const session = stripe.sessions.get(checkout.body.client_reference_id) ??
    [...stripe.sessions.values()].find((x: any) => x.client_reference_id === added.json().intentId);
  const sub = voiceSubscription(member, "price_voice_monthly");
  await processStripeEvent(
    db,
    evt("checkout.session.completed", { ...session, status: "complete", subscription: sub.id }),
  );
  await processStripeEvent(db, evt("customer.subscription.created", sub, tick()));
  const after = await subscription(member.userId);
  assert.equal(after.data.voiceAddOn.verified, true);
  assert.equal(after.data.voiceAddOn.providerId, sub.id);
  // The membership itself is untouched by the add-on's events.
  assert.equal(after.provider_id, membership.provider_id);
  assert.equal(after.price_minor, membership.price_minor);
  const granted = await access(member);
  assert.equal(granted.premiumVoice, true);
  assert.equal(granted.voiceSource, "add_on");
  // The add-on invoice posts its own charge with the member's commission rank.
  const invoice = voiceInvoice(member, 4900);
  await processStripeEvent(db, evt("invoice.paid", invoice, tick()));
  const [charge] = await db.tenant(seedScope(owner, "finance"), (tx) =>
    tx.query("SELECT * FROM journals WHERE source_key=$1", ["stripe-invoice:" + invoice.id]),
  );
  assert.equal(charge.description, "Voice add-on payment");
  assert.equal(charge.data.purpose, "voice_addon");
  assert.equal(charge.data.grossMinor, 4900);
  assert.equal(charge.data.commissionMinor, 1225);
  assert.equal(charge.data.rank, (await subscription(member.userId)).data.commissionRank);
  const [invoiceRecord] = await db.tenant(member, (tx) =>
    tx.query("SELECT status,data FROM records WHERE kind='billing_invoice' AND data->>'invoiceId'=$1", [invoice.id]),
  );
  assert.equal(invoiceRecord.data.purpose, "voice_addon");
  const period = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit" })
    .format(new Date())
    .slice(0, 7);
  const statement = await db.tenant(seedScope(owner, "finance"), (tx) => financialStatement(tx, period));
  assert.equal(statement.revenue.voiceAddOnMinor, 4900);
  // Buying it twice is refused.
  const twice = await withEnv({ COMMERCE_APPROVED: "true" }, () =>
    request(app, "POST", "/membership/voice-addon", member.token, {}),
  );
  assert.equal(twice.statusCode, 409, twice.body);
  assert.equal(twice.json().code, "VOICE_ACTIVE");
  // Removing it ends voice at the end of the paid period, not now.
  stripe.subscriptionStore.set(sub.id, sub);
  const removed = await request(app, "POST", "/membership/voice-addon/cancel", member.token, {});
  assert.equal(removed.statusCode, 200, removed.body);
  const cancelCall = stripe.calls.find((c: any) => c.call === "subscription.update" && c.id === sub.id);
  assert.deepEqual(cancelCall.body, { cancel_at_period_end: true });
  status = await request(app, "GET", "/membership/voice-addon", member.token);
  assert.deepEqual([status.json().active, status.json().cancelAtPeriodEnd], [true, true]);
  assert.equal((await access(member)).premiumVoice, true);
  // Keeping it resumes the same subscription.
  const resumed = await withEnv({ COMMERCE_APPROVED: "true" }, () =>
    request(app, "POST", "/membership/voice-addon", member.token, {}),
  );
  assert.equal(resumed.statusCode, 200, resumed.body);
  assert.equal(resumed.json().resumed, true);
  status = await request(app, "GET", "/membership/voice-addon", member.token);
  assert.equal(status.json().cancelAtPeriodEnd, false);
  // A refund of the add-on charge compensates it through the same ledger path.
  await processStripeEvent(
    db,
    evt("refund.updated", {
      id: "re_voice_" + member.userId.slice(0, 8),
      object: "refund",
      status: "succeeded",
      amount: 4900,
      currency: "aed",
      charge: invoice.charge,
      metadata: {},
    }),
  );
  const [refund] = await db.tenant(seedScope(owner, "finance"), (tx) =>
    tx.query("SELECT * FROM journals WHERE source_key=$1", ["stripe-refund:re_voice_" + member.userId.slice(0, 8)]),
  );
  assert.equal(refund.description, "Voice add-on refund");
  assert.equal(refund.data.commissionReversalMinor, 1225);
});

test("only a price that is one of the workspace's add-on prices verifies voice; metadata never grants it", async () => {
  const product = await offer(db, owner, {
    voiceAddOnMinor: 4900,
    voiceStripePriceId: "price_voice_current",
    voicePriceIds: ["price_voice_old", "price_voice_current"],
  });
  const member = await monthlyMember(product);
  await processStripeEvent(
    db,
    evt("customer.subscription.created", voiceSubscription(member, "price_not_voice"), tick()),
  );
  assert.equal((await subscription(member.userId)).data.voiceAddOn.verified, false);
  assert.equal((await access(member)).premiumVoice, false);
  // An earlier add-on price of the offer still verifies a member who bought it.
  await processStripeEvent(
    db,
    evt("customer.subscription.updated", voiceSubscription(member, "price_voice_old"), tick()),
  );
  assert.equal((await access(member)).premiumVoice, true);
  // An out-of-order older event never overwrites newer provider state.
  await processStripeEvent(
    db,
    evt("customer.subscription.updated", voiceSubscription(member, "price_not_voice"), tick() - 50),
  );
  assert.equal((await access(member)).premiumVoice, true);
});

test("an older offer that included premium voice keeps it, and its members are not sold the add-on", async () => {
  const legacy = await offer(db, owner, { premiumVoice: true, voiceIncluded: true });
  const member = await monthlyMember(legacy);
  const granted = await access(member);
  assert.equal(granted.premiumVoice, true);
  assert.equal(granted.voiceSource, "included");
  const status = await request(app, "GET", "/membership/voice-addon", member.token);
  assert.deepEqual([status.json().included, status.json().available], [true, false]);
  const refused = await withEnv({ COMMERCE_APPROVED: "true" }, () =>
    request(app, "POST", "/membership/voice-addon", member.token, {}),
  );
  assert.equal(refused.statusCode, 409, refused.body);
  assert.equal(refused.json().code, "VOICE_INCLUDED");
  // The trainer cannot sell an add-on on an offer that includes voice.
  const priced = await withEnv({ COMMERCE_APPROVED: "true" }, () =>
    request(app, "POST", `/products/${legacy.id}/voice-addon`, owner.token, { priceMinor: 4900 }),
  );
  assert.equal(priced.statusCode, 409, priced.body);
  // Without a membership there is nothing to add voice to.
  const stranger = await follower(db, owner);
  const none = await withEnv({ COMMERCE_APPROVED: "true" }, () =>
    request(app, "POST", "/membership/voice-addon", stranger.token, {}),
  );
  assert.equal(none.statusCode, 409, none.body);
  assert.equal(none.json().code, "MEMBERSHIP_REQUIRED");
});

test("voice ends with the membership: entitlement stops at once and the worker cancels the add-on subscription", async () => {
  const product = await offer(db, owner, {
    voiceAddOnMinor: 4900,
    voiceStripePriceId: "price_voice_end",
    voicePriceIds: ["price_voice_end"],
  });
  const member = await monthlyMember(product);
  const sub = voiceSubscription(member, "price_voice_end");
  await processStripeEvent(db, evt("customer.subscription.created", sub, tick()));
  assert.equal((await access(member)).premiumVoice, true);
  // The membership is canceled at the provider.
  await processStripeEvent(
    db,
    evt(
      "customer.subscription.deleted",
      {
        id: "sub_member_" + member.userId.slice(0, 8),
        object: "subscription",
        status: "canceled",
        metadata: { tenant_id: member.tenantId, user_id: member.userId },
        items: { data: [{ price: { id: product.data.stripePriceId } }] },
      },
      tick(),
    ),
  );
  assert.equal((await access(member)).premiumVoice, false, "voice needs paid access");
  const worker = fakeStripe();
  worker.subscriptionStore.set(sub.id, sub);
  const swept = await sweepProgrammes(db, owner.tenantId, { stripe: worker });
  assert.ok(swept.voice.ended >= 1);
  const cancel = worker.calls.find((c: any) => c.call === "subscription.cancel" && c.id === sub.id);
  assert.equal(cancel.key, "voice-addon-end:" + sub.id);
  assert.equal((await subscription(member.userId)).data.voiceAddOn.status, "canceled");
  // Nothing is sent again on the next sweep.
  await sweepProgrammes(db, owner.tenantId, { stripe: worker });
  assert.equal(worker.calls.filter((c: any) => c.call === "subscription.cancel" && c.id === sub.id).length, 1);
});

test("a member cannot write its own voice or access state; another follower sees none of it", async () => {
  const product = await offer(db, owner, {
    voiceAddOnMinor: 4900,
    voiceStripePriceId: "price_voice_iso",
    voicePriceIds: ["price_voice_iso"],
  });
  const member = await monthlyMember(product);
  await assert.rejects(
    db.tenant(member, (tx) =>
      tx.query(
        "UPDATE subscriptions SET data=data||$2::jsonb WHERE user_id=$1",
        [member.userId, JSON.stringify({ voiceAddOn: { verified: true, status: "active", providerId: "sub_x" } })],
      ),
    ),
    /renewal setting|42501|permission/i,
  );
  assert.equal((await access(member)).premiumVoice, false);
  const other = await follower(db, owner);
  const seen = await db.tenant(other, (tx) =>
    tx.query("SELECT user_id FROM subscriptions WHERE user_id=$1", [member.userId]),
  );
  assert.equal(seen.length, 0);
  const status = await request(app, "GET", "/membership/voice-addon", other.token);
  assert.deepEqual([status.json().available, status.json().active, status.json().status], [false, false, null]);
  const refused = await request(app, "POST", "/membership/voice-addon/cancel", other.token, {});
  assert.equal(refused.statusCode, 404, refused.body);
  const coach = await request(app, "GET", "/membership/voice-addon", owner.token);
  assert.equal(coach.statusCode, 403, coach.body);
});
