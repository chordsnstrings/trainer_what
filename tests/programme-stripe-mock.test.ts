import { readyServices } from "./service-readiness-fixtures.ts";
const restoreServices: Array<() => void> = [];
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { stripeClient, withRuntimeConfig } from "@trainer/providers";
import { createMockTls, trustMockCa, type MockTls } from "./e2e/mocks/tls.ts";
import { StripeMock } from "./e2e/mocks/stripe.ts";
import { createDatabase } from "@trainer/db";
import { processStripeEvent } from "../apps/api/src/stripe-events.ts";
import { sweepProgrammes } from "../apps/api/src/programme-today.ts";
import { endFollowerMembership } from "../apps/api/src/membership-exit.ts";
import { seedScope } from "./scope-fixtures.ts";
import { evt, follower, request, withEnv, workspace } from "./programme-fixtures.ts";

// The e2e Stripe double serves what the programme package calls through the
// real SDK: a one-time programme price in a payment Checkout, the voice
// add-on as its own subscription Checkout, the end-of-period flag and cancel.
let tls: MockTls;
const env = ["TRAINER_PROVIDER_SANDBOX", "PUBLIC_APP_URL", "API_HOST", "STRIPE_API_BASE_URL"];
const saved = Object.fromEntries(env.map((k) => [k, process.env[k]]));
before(() => {
  tls = createMockTls();
  trustMockCa(tls.ca);
  Object.assign(process.env, {
    TRAINER_PROVIDER_SANDBOX: "mock",
    PUBLIC_APP_URL: "https://localhost:8443",
    API_HOST: "127.0.0.1",
  });
});
after(() => {
  for(const restore of restoreServices.reverse()) restore();
  tls.cleanup();
  for (const k of env)
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
});

test("the Stripe mock serves upfront programme payments and the voice add-on subscription through the real SDK", async () => {
  const mock = new StripeMock({ key: tls.key, cert: tls.cert }, "sk_test_mock_fixture", "whsec_test_fixture");
  mock.autoWebhooks = false;
  await mock.start();
  process.env.STRIPE_API_BASE_URL = mock.url;
  try {
    const stripe = withRuntimeConfig({ STRIPE_SECRET_KEY: "sk_test_mock_fixture" }, () => stripeClient());
    const product = await stripe.products.create({ name: "Twelve weeks" });
    const oneTime = await stripe.prices.create({ product: product.id, currency: "aed", unit_amount: 90000 });
    assert.equal(oneTime.type, "one_time");
    const metadata = { tenant_id: "t", user_id: "u", intent_id: "i", purpose: "programme" };
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      client_reference_id: "i",
      line_items: [{ price: oneTime.id, quantity: 1 }],
      metadata,
      payment_intent_data: { metadata },
      success_url: "https://localhost:8443/app/membership",
      cancel_url: "https://localhost:8443/app/membership",
    });
    assert.equal(session.mode, "payment");
    assert.equal(session.amount_total, 90000);
    const completed = await mock.completeCheckout(session.id);
    const paid = await stripe.checkout.sessions.retrieve(session.id);
    assert.deepEqual([paid.status, paid.payment_status, paid.currency], ["complete", "paid", "aed"]);
    const intent = await stripe.paymentIntents.retrieve(String(paid.payment_intent));
    assert.equal(intent.latest_charge, completed.charge.id);
    assert.equal(intent.metadata.purpose, "programme");
    // The voice add-on: a monthly price and its own subscription checkout.
    const voiceProduct = await stripe.products.create({ name: "Twelve weeks · premium voice" });
    const voice = await stripe.prices.create({
      product: voiceProduct.id,
      currency: "aed",
      unit_amount: 4900,
      recurring: { interval: "month" },
    });
    const voiceMeta = { tenant_id: "t", user_id: "u", intent_id: "v", purpose: "voice_addon" };
    const voiceSession = await stripe.checkout.sessions.create({
      mode: "subscription",
      client_reference_id: "v",
      line_items: [{ price: voice.id, quantity: 1 }],
      metadata: voiceMeta,
      subscription_data: { metadata: voiceMeta },
      success_url: "https://localhost:8443/app/membership",
      cancel_url: "https://localhost:8443/app/membership",
    });
    const added = await mock.completeCheckout(voiceSession.id);
    assert.equal(added.subscription.metadata.purpose, "voice_addon");
    assert.equal(added.invoice.parent.subscription_details.metadata.purpose, "voice_addon");
    assert.equal(added.invoice.amount_paid, 4900);
    const scheduled = await stripe.subscriptions.update(
      added.subscription.id,
      { cancel_at_period_end: true },
      { idempotencyKey: "voice-addon-cancel:fixture" },
    );
    assert.equal(scheduled.cancel_at_period_end, true);
    const ended = await stripe.subscriptions.cancel(added.subscription.id, undefined, {
      idempotencyKey: "voice-addon-end:" + added.subscription.id,
    });
    assert.equal(ended.status, "canceled");
    await assert.rejects(
      stripe.subscriptions.cancel(added.subscription.id),
      /already canceled/,
    );
  } finally {
    await mock.stop();
  }
});

test("through the e2e Stripe double and the real SDK: a trainer sells an upfront programme, a member buys it and the voice add-on, leaves, and the add-on stops", async () => {
  const mock = new StripeMock({ key: tls.key, cert: tls.cert }, "sk_test_mock_fixture", "whsec_test_fixture");
  mock.autoWebhooks = false;
  await mock.start();
  process.env.STRIPE_API_BASE_URL = mock.url;
  const db = await createDatabase({ memory: true });
  const stripe = withRuntimeConfig({ STRIPE_SECRET_KEY: "sk_test_mock_fixture" }, () => stripeClient());
  // The API under test is served at the fixtures' origin.
  process.env.PUBLIC_APP_URL = "http://localhost:3000";
  const { buildApp } = await import("../apps/api/src/app.ts");
  const app = await buildApp({ db, testing: true, providers: { stripe: () => stripe } });
  const sessionOf = (url: string) => new URL(url).pathname.split("/").pop()!;
  try {
    // The membership checkout route builds its own client from configuration.
    await withEnv({ COMMERCE_APPROVED: "true", STRIPE_SECRET_KEY: "sk_test_mock_fixture" }, async () => {
      const owner = await workspace(db);
      restoreServices.push(await readyServices(db,owner));
      const created = await request(app, "POST", "/products", owner.token, {
        name: "Twelve weeks",
        description: "Strength programme",
        priceMinor: 90000,
        billing: "upfront",
        programmeDays: 84,
        voiceAddOnMinor: 4900,
      });
      assert.equal(created.statusCode, 200, created.body);
      const activated = await request(app, "POST", `/products/${created.json().id}/activate`, owner.token, {});
      assert.equal(activated.statusCode, 200, activated.body);
      const member = await follower(db, owner);
      // The member buys the programme: one payment Checkout at the mock.
      const checkout = await request(app, "POST", "/payments/checkout", member.token, {
        productId: created.json().id,
      });
      assert.equal(checkout.statusCode, 200, checkout.body);
      const paidId = sessionOf(checkout.json().url);
      await mock.completeCheckout(paidId);
      const paid = await stripe.checkout.sessions.retrieve(paidId);
      assert.equal(paid.mode, "payment");
      await processStripeEvent(db, evt("checkout.session.completed", paid), { stripe });
      const [row] = await db.tenant(seedScope(owner), (tx) =>
        tx.query("SELECT * FROM subscriptions WHERE user_id=$1", [member.userId]),
      );
      assert.deepEqual([row.provider_id, row.status, row.data.billing, row.data.programmeDays], [null, "active", "upfront", 84]);
      const [journal] = await db.tenant(seedScope(owner, "finance"), (tx) =>
        tx.query("SELECT data FROM journals WHERE source_key LIKE 'stripe-programme:%' AND data->>'userId'=$1", [member.userId]),
      );
      assert.equal(journal.data.grossMinor, 90000);
      const today = (await request(app, "GET", "/programme/today", member.token)).json();
      assert.deepEqual([today.programme.day, today.programme.of, today.planState], [1, 84, "awaiting_coach"]);
      // The voice add-on: its own subscription Checkout at the mock.
      const voice = await request(app, "POST", "/membership/voice-addon", member.token, {});
      assert.equal(voice.statusCode, 200, voice.body);
      const voiceId = sessionOf(voice.json().url);
      const added = await mock.completeCheckout(voiceId);
      await processStripeEvent(db, evt("checkout.session.completed", await stripe.checkout.sessions.retrieve(voiceId)), { stripe });
      await processStripeEvent(db, evt("customer.subscription.created", added.subscription), { stripe });
      await processStripeEvent(db, evt("invoice.paid", added.invoice), { stripe });
      const status = (await request(app, "GET", "/membership/voice-addon", member.token)).json();
      assert.deepEqual([status.active, status.status], [true, "active"]);
      // The member leaves: the add-on stops renewing at the mock, then the worker ends it.
      const exit = await endFollowerMembership(db, {
        tenantId: owner.tenantId,
        followerId: member.userId,
        actorId: member.userId,
        kind: "left",
        stripe: () => stripe,
      });
      assert.equal(exit.voiceAddOn, "ends");
      assert.equal((await stripe.subscriptions.retrieve(added.subscription.id)).cancel_at_period_end, true);
      const swept = await sweepProgrammes(db, owner.tenantId, { stripe });
      assert.equal(swept.voice.ended, 1);
      assert.equal((await stripe.subscriptions.retrieve(added.subscription.id)).status, "canceled");
    });
  } finally {
    await app.close();
    await db.close();
    await mock.stop();
  }
});
