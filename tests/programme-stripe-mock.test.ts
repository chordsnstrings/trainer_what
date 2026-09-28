import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { stripeClient, withRuntimeConfig } from "@trainer/providers";
import { createMockTls, trustMockCa, type MockTls } from "./e2e/mocks/tls.ts";
import { StripeMock } from "./e2e/mocks/stripe.ts";

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
