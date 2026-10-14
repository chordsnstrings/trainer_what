import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, putRecord, type Database } from "@trainer/db";
import {
  productSchema,
  MEMBERSHIP_PRICING_VERSION as version,
  MODULE_PASS_PRICES,
  addMembershipMonths,
  prepayQuote,
  prepaidRefundQuote,
  hasPaidTraining,
} from "@trainer/contracts";
import { createMembershipCheckout } from "../apps/api/src/finance-checkout.ts";
import {
  createModulePassCheckout,
  modulePassStatus,
} from "../apps/api/src/module-passes.ts";
import { processStripeEvent } from "../apps/api/src/stripe-events.ts";
import { memberAccess } from "../apps/api/src/entitlements.ts";
import {
  requestRefund,
  decideRefund,
  billingHistory,
} from "../apps/api/src/finance-billing.ts";
import {
  recordCharge,
  journal,
  financeSummary,
  createPayout,
} from "../apps/api/src/finance.ts";
import { nutritionMaterial } from "../apps/api/src/nutrition.ts";
import { readyServices } from "./service-readiness-fixtures.ts";
import {
  fixtureCases,
  fixtureCatalog,
  fixturePolicy,
} from "./nutrition-fixtures.ts";
import {
  workspace,
  follower,
  offer,
  fakeStripe,
  evt,
  paidProgrammeSession,
  request,
  type Member,
} from "./programme-fixtures.ts";
import { seedScope } from "./scope-fixtures.ts";
import { withRuntimeConfig } from "@trainer/providers";
import { executePayout } from "../apps/api/src/payout-execution.ts";
import { reconcileProgrammeCheckout } from "../apps/api/src/programme-billing.ts";

let db: Database,
  owner: Member,
  app: any,
  restore = () => {};
const options = {
  origin: "http://localhost:3000",
  nutritionReady: async () => {},
};
before(async () => {
  db = await createDatabase({ memory: true });
  owner = await workspace(db);
  restore = await readyServices(db, owner);
  const { buildApp } = await import("../apps/api/src/app.ts");
  app = await buildApp({ db, testing: true });
  const cases = fixtureCases();
  await db.tenant(owner, async (tx) => {
    await putRecord(
      tx,
      owner,
      "nutrition_setup",
      { enabled: true },
      { status: "active" },
    );
    for (const c of cases)
      await putRecord(tx, owner, "nutrition_case", c, {
        id: c.id,
        status: "confirmed",
      });
    await putRecord(
      tx,
      owner,
      "nutrition_policy",
      { policy: fixturePolicy(cases.map((c) => c.id)) },
      { status: "confirmed" },
    );
  });
  const catalog = fixtureCatalog();
  for (let i = 0; i < catalog.foods.length; i++) {
    const { id, ...food } = catalog.foods[i];
    const f = await request(app, "POST", "/nutrition/foods", owner.token, {
      food,
    });
    assert.equal(f.statusCode, 200, f.body);
    const { id: rid, ...recipe } = catalog.recipes[i];
    recipe.variants = recipe.variants.map((v) => ({
      ...v,
      ingredients: [{ foodId: f.json().id, grams: 500 }],
    }));
    const r = await request(app, "POST", "/nutrition/recipes", owner.token, {
      recipe,
    });
    assert.equal(r.statusCode, 200, r.body);
  }
  await db.tenant(owner, async (tx) => {
    const m = await nutritionMaterial(tx);
    await putRecord(
      tx,
      owner,
      "nutrition_release",
      { qualificationVersion: 2, digest: m.digest },
      { status: "published" },
    );
  });
});
after(async () => {
  restore();
  await app?.close();
  await db?.close();
});
const row = async (member: Member) =>
  (
    await db.tenant(seedScope(member), (tx) =>
      tx.query("SELECT * FROM subscriptions WHERE user_id=$1", [member.userId]),
    )
  )[0];
const intent = async (member: Member, id: string) =>
  (
    await db.tenant(seedScope(member), (tx) =>
      tx.query("SELECT * FROM records WHERE id=$1", [id]),
    )
  )[0];
async function buyPack(extra: any = {}, months: 6 | 12 = 6) {
  const member = await follower(db, owner),
    product = await offer(db, owner, { priceMinor: 19900, ...extra }),
    stripe = fakeStripe();
  const input = {
    productId: product.id,
    prepayMonths: months,
    acceptedPolicyVersion: version,
  };
  const checkout = await createMembershipCheckout(
    db,
    member,
    input,
    options,
    stripe,
  );
  const purchase = await intent(member, checkout.intentId),
    session = paidProgrammeSession(purchase);
  await processStripeEvent(db, evt("checkout.session.completed", session), {
    stripe,
  });
  return { member, product, stripe, purchase, session, input };
}

test("minimums and exact minor-unit prepaid totals cover all bundles", () => {
  for (const [tier, premiumVoice, minimum] of [
    ["workout", false, 19900],
    ["workout_nutrition", false, 29900],
    ["workout_nutrition", true, 39900],
    ["workout", true, 29900],
  ] as const) {
    const p = {
      name: "Plan",
      description: "",
      tier,
      premiumVoice,
      priceMinor: minimum,
    };
    assert.equal(productSchema.safeParse(p).success, true);
    assert.equal(
      productSchema.safeParse({ ...p, priceMinor: minimum - 1 }).success,
      false,
    );
  }
  assert.equal(prepayQuote(19900, 6).amountMinor, 107460);
  assert.equal(prepayQuote(19900, 12).amountMinor, 167160);
  assert.equal(prepayQuote(39900, 12).amountMinor, 335160);
  assert.equal(
    productSchema.safeParse({
      name: "Plan",
      description: "",
      priceMinor: 19900,
      voiceAddOnMinor: 9999,
    }).success,
    false,
  );
  assert.deepEqual(MODULE_PASS_PRICES, { nutrition: 15000, voice: 10000 });
});

test("Dubai calendar months, leap years and the exact 15-day boundary", () => {
  assert.equal(
    addMembershipMonths("2027-01-31T10:00:00Z", 1).toISOString(),
    "2027-02-28T10:00:00.000Z",
  );
  assert.equal(
    addMembershipMonths("2027-01-31T22:00:00Z", 1).toISOString(),
    "2027-02-28T22:00:00.000Z",
  );
  assert.equal(
    addMembershipMonths("2027-02-28T22:00:00Z", 12).toISOString(),
    "2028-02-29T22:00:00.000Z",
  );
  const data = {
    prepay: prepayQuote(19900, 6),
    grossMinor: 107460,
    chargedAt: "2026-10-01T00:00:00Z",
    accessStartsAt: "2026-10-01T00:00:00Z",
  };
  const q = prepaidRefundQuote(data, 0, new Date("2026-10-15T23:59:59.999Z"))!;
  assert.equal(q.eligible, true);
  assert.equal(q.amountMinor, 87560);
  assert.equal(q.usedMonths, 1);
  assert.equal(q.accessUntil, "2026-11-01T00:00:00.000Z");
  assert.equal(
    prepaidRefundQuote(data, 0, new Date("2026-10-16T00:00:00Z"))!.eligible,
    false,
  );
  assert.equal(
    prepaidRefundQuote(
      { ...data, accessStartsAt: "2026-10-20T00:00:00Z" },
      0,
      new Date("2026-10-10T00:00:00Z"),
    )!.amountMinor,
    107460,
  );
});

test("new checkout rejects underpricing and requires explicit prepaid terms", async () => {
  const member = await follower(db, owner),
    stripe = fakeStripe();
  const low = await offer(db, owner, { priceMinor: 19899 });
  await assert.rejects(
    createMembershipCheckout(
      db,
      member,
      { productId: low.id },
      options,
      stripe,
    ),
    { code: "PRICE_BELOW_MINIMUM" },
  );
  await assert.rejects(
    createMembershipCheckout(
      db,
      member,
      { productId: low.id, prepayMonths: 6 },
      options,
      stripe,
    ),
    { code: "PURCHASE_TERMS_REQUIRED" },
  );
  await assert.rejects(
    createMembershipCheckout(
      db,
      member,
      {
        productId: low.id,
        prepayMonths: 6,
        acceptedPolicyVersion: version,
        promotionCode: "DOUBLE",
      },
      options,
      stripe,
    ),
    { code: "PREPAY_PROMOTION" },
  );
  assert.equal(stripe.calls.length, 0);
});

test("prepaid checkout freezes purchased modules, confirms payment once, and keeps the same commission", async () => {
  const member = await follower(db, owner),
    stripe = fakeStripe();
  const product = await offer(db, owner, {
    tier: "workout_nutrition",
    modules: ["training", "nutrition", "voice"],
    premiumVoice: true,
    priceMinor: 39900,
  });
  const input = {
    productId: product.id,
    prepayMonths: 12,
    acceptedPolicyVersion: version,
  };
  const first = await createMembershipCheckout(
    db,
    member,
    input,
    options,
    stripe,
  );
  const repeat = await createMembershipCheckout(
    db,
    member,
    input,
    options,
    stripe,
  );
  assert.equal(first.intentId, repeat.intentId);
  const r = await intent(member, first.intentId),
    call = stripe.calls.find((c: any) => c.call === "checkout");
  assert.equal(call.body.line_items[0].price_data.unit_amount, 335160);
  assert.match(call.body.custom_text.submit.message, /15-day/);
  await db.tenant(owner, (tx) =>
    tx.query(
      'UPDATE records SET data=data||\'{"modules":["training"],"premiumVoice":false}\'::jsonb WHERE id=$1',
      [product.id],
    ),
  );
  const session = paidProgrammeSession(r);
  await processStripeEvent(
    db,
    evt("checkout.session.completed", { ...session, payment_status: "unpaid" }),
    { stripe },
  );
  assert.equal(await row(member), undefined);
  await assert.rejects(
    processStripeEvent(
      db,
      evt("checkout.session.completed", { ...session, amount_total: 1 }),
      { stripe },
    ),
    { code: "PROGRAMME_AMOUNT_MISMATCH" },
  );
  await processStripeEvent(
    db,
    evt("checkout.session.async_payment_succeeded", session),
    { stripe },
  );
  await processStripeEvent(db, evt("checkout.session.completed", session), {
    stripe,
  });
  const s = await row(member);
  assert.deepEqual(s.data.modules, ["training", "nutrition", "voice"]);
  assert.equal(
    new Date(s.period_end).toISOString(),
    addMembershipMonths(s.data.upfront.startsAt, 12).toISOString(),
  );
  const [j] = await db.tenant(seedScope(owner, "finance"), (tx) =>
    tx.query("SELECT data FROM journals WHERE source_key=$1", [
      `stripe-programme:${r.id}`,
    ]),
  );
  assert.equal(j.data.grossMinor, 335160);
  assert.equal(j.data.commissionMinor, 83790);
  assert.equal(j.data.prepay.monthlyPriceMinor, 39900);
});

test("prepaid refund retains full-price first month, compensates the same split and shortens access", async () => {
  const p = await buyPack();
  const history = await billingHistory(db, p.member);
  assert.equal(history.charges[0].refundableMinor, 87560);
  const request = await requestRefund(db, p.member, {
    chargeId: "ch_" + p.session.payment_intent,
    reason: "Changed plans within refund window",
  });
  assert.equal(request.data.amountMinor, 87560);
  assert.equal(request.data.refundCalculation.usedMonths, 1);
  const before = await db.tenant(seedScope(owner, "finance"), financeSummary);
  assert.ok(before.refundReserveMinor >= 80595);
  await decideRefund(
    db,
    owner,
    request.id,
    { approve: true, reason: "Within agreed prepaid terms" },
    false,
    p.stripe,
  );
  const payment = p.stripe.calls.find((c: any) => c.call === "refund");
  assert.equal(payment.body.amount, 87560);
  const approved = await intent(p.member, request.id);
  // A renewal can have started before a worker promotes its queued projection.
  // Refund processing must first identify that now-current paid window.
  await db.tenant(seedScope(owner), (tx) =>
    tx.query(
      "UPDATE subscriptions SET data=jsonb_set(jsonb_set(data,'{nextProgramme}',data->'upfront'),'{upfront}',$2::jsonb) WHERE user_id=$1",
      [
        p.member.userId,
        JSON.stringify({
          intentId: randomUUID(),
          startsAt: new Date(Date.now() - 31 * 86400000).toISOString(),
          endsAt: new Date(Date.now() - 1000).toISOString(),
          programmeDays: 30,
        }),
      ],
    ),
  );
  await processStripeEvent(
    db,
    evt("refund.updated", {
      id: approved.data.providerRefundId,
      object: "refund",
      charge: request.data.chargeId,
      amount: 87560,
      currency: "aed",
      status: "succeeded",
      metadata: {
        tenant_id: p.member.tenantId,
        user_id: p.member.userId,
        refund_request_id: request.id,
      },
    }),
  );
  const s = await row(p.member);
  assert.equal(
    new Date(s.period_end).toISOString(),
    request.data.refundCalculation.accessUntil,
  );
  assert.equal(s.status, "active");
  const [reversal] = await db.tenant(seedScope(owner, "finance"), (tx) =>
    tx.query("SELECT data FROM journals WHERE source_key=$1", [
      `stripe-refund:${approved.data.providerRefundId}`,
    ]),
  );
  assert.equal(reversal.data.commissionReversalMinor, 21890);
  assert.equal(
    26865 - reversal.data.commissionReversalMinor,
    4975,
    "25% of the full-price month remains",
  );
});

test("passes require paid training; verified nutrition and voice passes expire and cannot double-purchase", async () => {
  const unpaid = await follower(db, owner),
    stripe = fakeStripe();
  await assert.rejects(
    createModulePassCheckout(
      db,
      unpaid,
      { module: "nutrition", acceptedPolicyVersion: version },
      options.origin,
      stripe,
    ),
    { code: "PAID_TRAINING_REQUIRED" },
  );
  const p = await buyPack();
  for (const module of ["nutrition", "voice"] as const) {
    const input = { module, acceptedPolicyVersion: version };
    const bought = await createModulePassCheckout(
      db,
      p.member,
      input,
      options.origin,
      stripe,
    );
    const duplicate = await createModulePassCheckout(
      db,
      p.member,
      input,
      options.origin,
      stripe,
    );
    assert.equal(bought.intentId, duplicate.intentId);
    const r = await intent(p.member, bought.intentId);
    const session = paidProgrammeSession(r, {
      metadata: {
        tenant_id: p.member.tenantId,
        user_id: p.member.userId,
        intent_id: r.id,
        purpose: "module_pass",
        module,
      },
    });
    await processStripeEvent(
      db,
      evt("checkout.session.completed", {
        ...session,
        payment_status: "unpaid",
      }),
      { stripe },
    );
    assert.equal(
      (await modulePassStatus(db, p.member)).passes[module].active,
      false,
    );
    await processStripeEvent(db, evt("checkout.session.completed", session), {
      stripe,
    });
    await processStripeEvent(db, evt("checkout.session.completed", session), {
      stripe,
    });
    assert.equal(
      (await modulePassStatus(db, p.member)).passes[module].active,
      true,
    );
    await assert.rejects(
      createModulePassCheckout(db, p.member, input, options.origin, stripe),
      { code: "MODULE_ALREADY_INCLUDED" },
    );
  }
  let access = await db.tenant(p.member, (tx) =>
    memberAccess(tx, p.member.userId),
  );
  assert.ok(access.modules.includes("nutrition"));
  assert.equal(access.voiceSource, "pass");
  await db.tenant(seedScope(owner), (tx) =>
    tx.query("UPDATE subscriptions SET status='trialing' WHERE user_id=$1", [
      p.member.userId,
    ]),
  );
  access = await db.tenant(p.member, (tx) => memberAccess(tx, p.member.userId));
  assert.equal(access.modules.includes("nutrition"), false);
  assert.equal(access.premiumVoice, false);
  assert.equal(
    hasPaidTraining({
      ...(await row(p.member)),
      status: "active",
      period_end: new Date(Date.now() - 1).toISOString(),
    }),
    false,
  );
});

test("refundable prepaid earnings cannot fund a payout even after a close; pending refund remains held after the window", async () => {
  const separate = await workspace(db),
    a = seedScope(separate, "finance");
  await db.tenant(a, async (tx) => {
    const c = await recordCharge(
      tx,
      a,
      "stripe-programme:reserve-fixture",
      100000,
      1,
      {
        userId: separate.userId,
        chargeId: "ch_reserve",
        refundHoldUntil: new Date(Date.now() + 86400000).toISOString(),
      },
    );
    await journal(tx, a, "settlement:reserve-fixture", "Synthetic settlement", [
      { account: "stripe_receivable", amount: -100000 },
      { account: "bank_cash", amount: 100000 },
    ]);
    await putRecord(
      tx,
      a,
      "close",
      {
        period: "2026-09",
        cutoff: new Date(Date.now() + 3600000).toISOString(),
        eligibleMinor: 75000,
      },
      { ownerId: separate.userId, status: "closed" },
    );
    const summary = await financeSummary(tx);
    assert.equal(summary.availableMinor, 0);
    assert.equal(summary.refundReserveMinor, 75000);
    await putRecord(
      tx,
      a,
      "refund",
      {
        journalId: c!.id,
        chargeId: "ch_reserve",
        amountMinor: 80000,
        refundCalculation: { eligible: true },
      },
      { ownerId: separate.userId, status: "failed" },
    );
  });
  await assert.rejects(
    db.tenant(a, (tx) => createPayout(tx, a, "2026-09", "beneficiary-fixture")),
    { code: "PAYOUT_NOTHING_AVAILABLE" },
  );
});

test("payout dispatch rechecks a refund requested after preparation and holds failed pack refunds beyond day 15", async () => {
  const separate = await workspace(db),
    a = seedScope(separate, "finance");
  const payoutId = randomUUID();
  await db.tenant(a, async (tx) => {
    const charge = await recordCharge(
      tx,
      a,
      "stripe-programme:dispatch-reserve",
      100000,
      1,
      {
        userId: separate.userId,
        chargeId: "ch_dispatch_reserve",
        refundHoldUntil: new Date(Date.now() - 86400000).toISOString(),
      },
    );
    await journal(
      tx,
      a,
      "settlement:dispatch-reserve",
      "Synthetic settlement",
      [
        { account: "stripe_receivable", amount: -100000 },
        { account: "bank_cash", amount: 100000 },
      ],
    );
    assert.equal(
      (await financeSummary(tx)).availableMinor,
      75000,
      "the elapsed window releases unclaimed earnings",
    );
    await putRecord(
      tx,
      a,
      "beneficiary",
      {
        providerId: "fixture-destination",
        holdUntil: new Date(Date.now() - 86400000).toISOString(),
      },
      { ownerId: separate.userId, status: "verified" },
    );
    await tx.query(
      "INSERT INTO payouts(id,tenant_id,period,amount_minor,beneficiary_id,status) VALUES($1,$2,'2026-09',75000,'fixture-destination','ready')",
      [payoutId, a.tenantId],
    );
    await putRecord(
      tx,
      a,
      "refund",
      {
        journalId: charge!.id,
        chargeId: "ch_dispatch_reserve",
        amountMinor: 80000,
        refundCalculation: { eligible: true },
      },
      { ownerId: separate.userId, status: "failed" },
    );
    const summary = await financeSummary(tx);
    assert.equal(summary.earnedMinor, 75000);
    assert.equal(summary.refundReserveMinor, 75000);
    assert.equal(summary.availableMinor, 0);
  });
  await withRuntimeConfig(
    {
      LEAN_BASE_URL: "https://finance-fixture.invalid",
      LEAN_ACCESS_TOKEN: "synthetic_fixture_token",
      LEAN_SOURCE_ACCOUNT_ID: "fixture-source",
      LEAN_CONTRACT_VERIFIED: "true",
      PAYOUTS_APPROVED: "true",
    },
    async () => {
      await assert.rejects(executePayout(db, a, payoutId), {
        code: "FUNDING_CHANGED",
      });
    },
  );
  const [payout] = await db.tenant(a, (tx) =>
    tx.query("SELECT status FROM payouts WHERE id=$1", [payoutId]),
  );
  assert.equal(payout.status, "ready", "no provider dispatch happened");
});

test("pass receipt rejects another member and a full pass refund preserves the paid training membership", async () => {
  const p = await buyPack(),
    stripe = fakeStripe(),
    other = await follower(db, owner);
  const checkout = await createModulePassCheckout(
    db,
    p.member,
    { module: "voice", acceptedPolicyVersion: version },
    options.origin,
    stripe,
  );
  const purchase = await intent(p.member, checkout.intentId);
  const session = paidProgrammeSession(purchase, {
    metadata: {
      tenant_id: p.member.tenantId,
      user_id: p.member.userId,
      intent_id: purchase.id,
      purpose: "module_pass",
      module: "voice",
    },
  });
  await assert.rejects(
    processStripeEvent(
      db,
      evt("checkout.session.completed", {
        ...session,
        metadata: { ...session.metadata, user_id: other.userId },
      }),
      { stripe },
    ),
    { code: "CHECKOUT_IDENTITY_MISMATCH" },
  );
  await processStripeEvent(db, evt("checkout.session.completed", session), {
    stripe,
  });
  assert.equal(
    (await db.tenant(p.member, (tx) => memberAccess(tx, p.member.userId)))
      .premiumVoice,
    true,
  );
  await processStripeEvent(
    db,
    evt("refund.updated", {
      id: "re_pass_" + purchase.id,
      object: "refund",
      status: "succeeded",
      charge: "ch_" + session.payment_intent,
      payment_intent: session.payment_intent,
      amount: 10000,
      currency: "aed",
      metadata: {},
    }),
  );
  assert.equal(hasPaidTraining(await row(p.member)), true);
  const access = await db.tenant(p.member, (tx) =>
    memberAccess(tx, p.member.userId),
  );
  assert.equal(access.active, true);
  assert.equal(access.premiumVoice, false);
  assert.equal((await row(p.member)).data.upfront.intentId, p.purchase.id);
});

test("reconciliation verifies ownership and recovers the original payment time without restarting the refund window", async () => {
  const member = await follower(db, owner),
    product = await offer(db, owner, { priceMinor: 19900 });
  const paidSeconds = Math.floor(Date.now() / 1000) - 10 * 86400;
  const stripe = fakeStripe({
    charges: {
      retrieve: async (id: string) => ({
        id,
        payment_intent: id.slice(3),
        paid: true,
        captured: true,
        payment_method_details: { type: "card" },
        created: paidSeconds,
      }),
    },
  });
  const checkout = await createMembershipCheckout(
    db,
    member,
    { productId: product.id, prepayMonths: 6, acceptedPolicyVersion: version },
    options,
    stripe,
  );
  const purchase = await intent(member, checkout.intentId),
    session = paidProgrammeSession(purchase);
  stripe.sessions.set(session.id, {
    ...session,
    metadata: { ...session.metadata, user_id: owner.userId },
  });
  await assert.rejects(reconcileProgrammeCheckout(db, purchase, stripe), {
    code: "CHECKOUT_IDENTITY_MISMATCH",
  });
  assert.equal(await row(member), undefined);
  stripe.sessions.set(session.id, session);
  await reconcileProgrammeCheckout(db, purchase, stripe);
  const current = await row(member);
  assert.equal(
    current.data.upfront.paidAt,
    new Date(paidSeconds * 1000).toISOString(),
  );
  assert.equal(
    new Date(current.period_end).toISOString(),
    addMembershipMonths(new Date(paidSeconds * 1000), 6).toISOString(),
  );
  const history = await billingHistory(db, member);
  assert.equal(
    history.charges[0].refundCalculation.deadline,
    new Date((paidSeconds + 15 * 86400) * 1000).toISOString(),
  );
});

test("an unknown pass checkout outcome cannot dispatch a second purchase", async () => {
  const p = await buyPack();
  let calls = 0;
  const stripe = fakeStripe({
    checkout: {
      sessions: {
        create: async () => {
          calls++;
          throw new Error("Synthetic response lost after dispatch");
        },
      },
    },
  });
  const input = { module: "voice", acceptedPolicyVersion: version };
  await assert.rejects(
    createModulePassCheckout(db, p.member, input, options.origin, stripe),
    /response lost/,
  );
  await assert.rejects(
    createModulePassCheckout(db, p.member, input, options.origin, stripe),
    { code: "PASS_CHECKOUT_PENDING" },
  );
  assert.equal(calls, 1);
});
