import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createDatabase,
  type Database,
  type Actor,
  putRecord,
} from "@trainer/db";
import {
  createMembershipCheckout,
  processMembershipCheckoutEvent,
  reconcileMembershipCheckout,
} from "../apps/api/src/finance-checkout.ts";
import { processStripeEvent } from "../apps/api/src/stripe-events.ts";
let db: Database, product: any;
const owner: Actor = {
  tenantId: randomUUID(),
  userId: randomUUID(),
  role: "owner",
};
const options = {
  origin: "http://localhost:3000",
  nutritionReady: async () => {},
};
before(async () => {
  db = await createDatabase({ memory: true });
  await db.system(async (tx) => {
    await tx.query(
      "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Checkout owner','fixture-only')",
      [owner.userId, owner.userId + "@example.test"],
    );
    await tx.query(
      "INSERT INTO tenants(id,slug,name) VALUES($1,$2,'Checkout fixture')",
      [owner.tenantId, owner.tenantId],
    );
    await tx.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')",
      [owner.tenantId, owner.userId],
    );
  });
  product = await db.tenant(owner, (tx) =>
    putRecord(
      tx,
      owner,
      "product",
      {
        name: "Workout",
        description: "Fixture",
        priceMinor: 12000,
        stripePriceId: "price_" + owner.tenantId,
        tier: "workout",
        modules: ["training"],
        premiumVoice: true,
        trialDays: 7,
      },
      { status: "published" },
    ),
  );
});
after(async () => db.close());
async function subscriber() {
  const a = {
    ...owner,
    userId: randomUUID(),
    role: "subscriber",
    email: randomUUID() + "@example.test",
  };
  await db.system(async (tx) => {
    await tx.query(
      "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Checkout client','fixture-only')",
      [a.userId, a.email],
    );
    await tx.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'subscriber')",
      [a.tenantId, a.userId],
    );
  });
  return a;
}
function remoteCheckout(body: any) {
  return {
    ...body,
    id: "cs_" + randomUUID(),
    url: "https://checkout.stripe.com/c/fixture",
    status: "open",
    expires_at: body.expires_at,
  };
}
const input = () => ({ productId: product.id });
async function intents(a: Actor) {
  return db.tenant(owner, (tx) =>
    tx.query(
      "SELECT * FROM records WHERE kind='checkout' AND owner_user_id=$1 ORDER BY created_at,id",
      [a.userId],
    ),
  );
}
function subscriptionEvent(
  a: Actor,
  sid: string,
  status: string,
  created: number,
  intentId?: string,
) {
  return {
    id: "evt_" + randomUUID(),
    type:
      status === "canceled"
        ? "customer.subscription.deleted"
        : "customer.subscription.updated",
    created,
    data: {
      object: {
        id: sid,
        object: "subscription",
        status,
        current_period_end: created + 86400,
        metadata: {
          tenant_id: a.tenantId,
          user_id: a.userId,
          ...(intentId ? { intent_id: intentId } : {}),
        },
        items: { data: [{ price: { id: product.data.stripePriceId } }] },
      },
    },
  };
}

test("concurrent membership checkout dispatches once and returns the original open link on retry", async () => {
  const a = await subscriber();
  let release!: () => void,
    entered!: () => void,
    calls = 0;
  const pending = new Promise<void>((r) => {
      release = r;
    }),
    dispatch = new Promise<void>((r) => {
      entered = r;
    });
  const stripe = {
    checkout: {
      sessions: {
        create: async (body: any, opts: any) => {
          calls++;
          assert.equal(
            opts.idempotencyKey,
            "checkout:" + body.client_reference_id,
          );
          assert.equal(body.subscription_data.trial_period_days, 7);
          assert.equal(
            body.subscription_data.metadata.intent_id,
            body.client_reference_id,
          );
          entered();
          await pending;
          return remoteCheckout(body);
        },
      },
    },
  } as any;
  const first = createMembershipCheckout(db, a, input(), options, stripe);
  await dispatch;
  await assert.rejects(
    createMembershipCheckout(db, a, input(), options, stripe),
    /being prepared/,
  );
  release();
  const created = await first;
  const retry = await createMembershipCheckout(db, a, input(), options, stripe);
  assert.equal(retry.url, created.url);
  assert.equal(retry.intentId, created.intentId);
  assert.equal(calls, 1);
  await assert.rejects(
    createMembershipCheckout(
      db,
      a,
      { ...input(), promotionCode: "CHANGED" },
      options,
      stripe,
    ),
    /original checkout/,
  );
  assert.equal((await intents(a)).length, 1);
});

test("elapsed ambiguous dispatch is reconciled to its completed subscription before another purchase", async () => {
  const a = await subscriber();
  let calls = 0,
    remote: any;
  const sid = "sub_" + randomUUID();
  const stripe = {
    checkout: {
      sessions: {
        create: async (body: any) => {
          calls++;
          remote = remoteCheckout(body);
          if (calls === 1)
            throw new Error("Synthetic timeout after possible dispatch");
          return remote;
        },
        list: async () => ({
          data: [{ ...remote, status: "complete", subscription: sid }],
          has_more: false,
        }),
        retrieve: async () => ({
          ...remote,
          status: "complete",
          subscription: sid,
        }),
      },
    },
    subscriptions: {
      retrieve: async () =>
        subscriptionEvent(
          a,
          sid,
          "active",
          Math.floor(Date.now() / 1000),
          remote.client_reference_id,
        ).data.object,
    },
  } as any;
  await assert.rejects(
    createMembershipCheckout(db, a, input(), options, stripe),
    /Synthetic timeout/,
  );
  let history = await intents(a);
  const oldId = history[0].id;
  assert.equal(history[0].status, "unknown");
  await db.tenant(owner, (tx) =>
    tx.query("UPDATE records SET data=data||$2::jsonb WHERE id=$1", [
      oldId,
      JSON.stringify({
        expiresAt: new Date(Date.now() - 86400000).toISOString(),
      }),
    ]),
  );
  await assert.rejects(
    createMembershipCheckout(db, a, input(), options, stripe),
    /existing subscription/,
  );
  assert.equal(calls, 1);
  history = await intents(a);
  assert.equal(history.length, 1);
  assert.equal(history[0].status, "completed");
  let [s] = await db.tenant(owner, (tx) =>
    tx.query("SELECT * FROM subscriptions WHERE user_id=$1", [a.userId]),
  );
  assert.equal(s.provider_id, sid);
  assert.equal(s.status, "active");
  const time = Math.floor(Date.now() / 1000) + 10;
  await processStripeEvent(
    db,
    subscriptionEvent(a, sid, "canceled", time, oldId),
  );
  assert.equal((await intents(a))[0].status, "closed");
  const returned = await createMembershipCheckout(
    db,
    a,
    input(),
    options,
    stripe,
  );
  assert.notEqual(returned.intentId, oldId);
  assert.equal(calls, 2);
  const newSid = "sub_" + randomUUID();
  await processStripeEvent(
    db,
    subscriptionEvent(a, newSid, "active", time + 1, returned.intentId),
  );
  await processStripeEvent(db, {
    id: "evt_" + randomUUID(),
    type: "invoice.paid",
    created: time + 2,
    data: {
      object: {
        id: "in_" + randomUUID(),
        amount_paid: 900,
        currency: "aed",
        subscription: sid,
        charge: "ch_" + randomUUID(),
        period_end: time + 86400,
        metadata: { tenant_id: a.tenantId, user_id: a.userId },
      },
    },
  });
  [s] = await db.tenant(owner, (tx) =>
    tx.query("SELECT * FROM subscriptions WHERE user_id=$1", [a.userId]),
  );
  assert.equal(s.provider_id, newSid);
  assert.equal(s.status, "active");
  await processStripeEvent(
    db,
    subscriptionEvent(a, sid, "canceled", time + 3, oldId),
  );
  [s] = await db.tenant(owner, (tx) =>
    tx.query("SELECT * FROM subscriptions WHERE user_id=$1", [a.userId]),
  );
  assert.equal(s.provider_id, newSid);
  assert.equal(s.status, "active");
});

test("absence of provider evidence and foreign evidence never free an ambiguous checkout intent", async () => {
  const a = await subscriber();
  let calls = 0,
    remote: any,
    mode = "empty";
  const stripe = {
    checkout: {
      sessions: {
        create: async (body: any) => {
          calls++;
          remote = remoteCheckout(body);
          throw new Error("Synthetic dispatch uncertainty");
        },
        list: async () => ({
          data:
            mode === "empty"
              ? []
              : [
                  {
                    ...remote,
                    status: "expired",
                    metadata: { ...remote.metadata, tenant_id: randomUUID() },
                  },
                ],
          has_more: false,
        }),
      },
    },
  } as any;
  await assert.rejects(
    createMembershipCheckout(db, a, input(), options, stripe),
    /Synthetic dispatch/,
  );
  const [r] = await intents(a);
  await db.tenant(owner, (tx) =>
    tx.query("UPDATE records SET data=data||$2::jsonb WHERE id=$1", [
      r.id,
      JSON.stringify({ expiresAt: new Date(0).toISOString() }),
    ]),
  );
  await assert.rejects(
    createMembershipCheckout(db, a, input(), options, stripe),
    /No provider outcome/,
  );
  mode = "foreign";
  await assert.rejects(
    reconcileMembershipCheckout(db, a, stripe),
    /does not match/,
  );
  assert.equal(calls, 1);
  assert.equal((await intents(a))[0].status, "unknown");
  assert.equal((await intents(a)).length, 1);
  await assert.rejects(
    processMembershipCheckoutEvent(db, {
      id: "evt_" + randomUUID(),
      type: "checkout.session.expired",
      data: {
        object: {
          ...remote,
          status: "expired",
          metadata: { ...remote.metadata, user_id: randomUUID() },
        },
      },
    }),
    /identity does not match/,
  );
});

test("only provider-confirmed expiry allows a fresh checkout intent", async () => {
  const a = await subscriber();
  let calls = 0,
    remote: any;
  const stripe = {
    checkout: {
      sessions: {
        create: async (body: any) => {
          calls++;
          remote = remoteCheckout(body);
          return remote;
        },
        retrieve: async () => ({ ...remote, status: "expired" }),
      },
    },
  } as any;
  const first = await createMembershipCheckout(db, a, input(), options, stripe);
  await db.tenant(owner, (tx) =>
    tx.query("UPDATE records SET data=data||$2::jsonb WHERE id=$1", [
      first.intentId,
      JSON.stringify({ expiresAt: new Date(0).toISOString() }),
    ]),
  );
  const next = await createMembershipCheckout(db, a, input(), options, stripe);
  assert.equal(calls, 2);
  assert.notEqual(next.intentId, first.intentId);
  const old = (await intents(a)).find((r) => r.id === first.intentId);
  assert.equal(old.status, "expired");
  assert.ok(old.data.expiryEvidence);
});

test("delinquent and incomplete subscriptions retain servicing instead of creating parallel billing", async () => {
  let calls = 0;
  const stripe = {
    checkout: {
      sessions: {
        create: async (body: any) => {
          calls++;
          return remoteCheckout(body);
        },
      },
    },
  } as any;
  for (const status of [
    "active",
    "trialing",
    "past_due",
    "unpaid",
    "incomplete",
  ]) {
    const a = await subscriber();
    await db.tenant(owner, (tx) =>
      tx.query(
        "INSERT INTO subscriptions(id,tenant_id,user_id,provider_id,status,period_end) VALUES($1,$2,$3,$4,$5,now()-interval '30 days')",
        [randomUUID(), a.tenantId, a.userId, "sub_" + randomUUID(), status],
      ),
    );
    await assert.rejects(
      createMembershipCheckout(db, a, input(), options, stripe),
      /existing subscription/,
    );
    assert.equal((await intents(a)).length, 0);
  }
  assert.equal(calls, 0);
});
