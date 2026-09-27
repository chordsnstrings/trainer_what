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
import { settlementBlockers } from "../apps/api/src/privacy-lifecycle.ts";
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
  assert.ok(old);
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

test("purchase admission checks current membership and workspace before reserving any provider intent", async () => {
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
  for (const role of ["staff", "removed"]) {
    const a = await subscriber();
    await db.system((tx) =>
      role === "removed"
        ? tx.query(
            "DELETE FROM memberships WHERE tenant_id=$1 AND user_id=$2",
            [a.tenantId, a.userId],
          )
        : tx.query(
            "UPDATE memberships SET role=$3 WHERE tenant_id=$1 AND user_id=$2",
            [a.tenantId, a.userId, role],
          ),
    );
    await assert.rejects(
      createMembershipCheckout(db, a, input(), options, stripe),
      /Current subscriber access required/,
    );
    assert.equal((await intents(a)).length, 0);
  }
  const a = await subscriber();
  await db.system((tx) =>
    tx.query("UPDATE tenants SET lifecycle_state='closed' WHERE id=$1", [
      a.tenantId,
    ]),
  );
  try {
    await assert.rejects(
      createMembershipCheckout(db, a, input(), options, stripe),
      /no longer accepts purchases/,
    );
    assert.equal((await intents(a)).length, 0);
  } finally {
    await db.system((tx) =>
      tx.query("UPDATE tenants SET lifecycle_state='active' WHERE id=$1", [
        a.tenantId,
      ]),
    );
  }
  const foreign = { ...a, userId: owner.userId, tenantId: randomUUID() };
  await assert.rejects(
    createMembershipCheckout(db, foreign, input(), options, stripe),
    /no longer accepts purchases/,
  );
  assert.equal(calls, 0);
});

test("privacy settlement retains uncertain checkout until expiry or the original subscription is terminal", async () => {
  const a = await subscriber();
  const intent = await db.tenant(owner, (tx) =>
    putRecord(
      tx,
      owner,
      "checkout",
      { expiresAt: new Date(0).toISOString() },
      { ownerId: a.userId, status: "unknown" },
    ),
  );
  const blocked = async () =>
    (await db.tenant(owner, (tx) => settlementBlockers(tx, a.userId))).some(
      (b) => b.kind === "checkout",
    );
  for (const status of ["creating", "unknown", "open", "completed"]) {
    await db.tenant(owner, (tx) =>
      tx.query("UPDATE records SET status=$2 WHERE id=$1", [intent.id, status]),
    );
    assert.equal(await blocked(), true, status);
  }
  const sid = "sub_" + randomUUID();
  await db.tenant(owner, async (tx) => {
    await tx.query(
      "INSERT INTO subscriptions(id,tenant_id,user_id,provider_id,status) VALUES($1,$2,$3,$4,'canceled')",
      [randomUUID(), a.tenantId, a.userId, sid],
    );
    await tx.query("UPDATE records SET data=data||$2::jsonb WHERE id=$1", [
      intent.id,
      JSON.stringify({ subscriptionId: "sub_other" }),
    ]);
  });
  assert.equal(await blocked(), true);
  await db.tenant(owner, (tx) =>
    tx.query("UPDATE records SET data=data||$2::jsonb WHERE id=$1", [
      intent.id,
      JSON.stringify({ subscriptionId: sid }),
    ]),
  );
  assert.equal(await blocked(), false);
  for (const status of ["expired", "closed"]) {
    await db.tenant(owner, (tx) =>
      tx.query("UPDATE records SET status=$2 WHERE id=$1", [intent.id, status]),
    );
    assert.equal(await blocked(), false, status);
  }
});

test("app exposes checkout reconciliation and persists premium voice on the existing offer tiers", async () => {
  const { buildApp } = await import("../apps/api/src/app.ts");
  const { tokenHash } = await import("../apps/api/src/auth.ts");
  const a = await subscriber(),
    memberToken = randomUUID(),
    ownerToken = randomUUID();
  await db.system(async (tx) => {
    for (const [actor, token] of [
      [a, memberToken],
      [owner, ownerToken],
    ] as const)
      await tx.query(
        "INSERT INTO sessions(token_hash,user_id,tenant_id,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
        [tokenHash(token), actor.userId, actor.tenantId],
      );
  });
  const app = await buildApp({ db, testing: true });
  const post = (url: string, token?: string, payload: any = {}) =>
    app.inject({
      method: "POST",
      url: "/api/v1" + url,
      headers: {
        origin: options.origin,
        ...(token ? { cookie: "session=" + token } : {}),
      },
      payload,
    });
  try {
    const unauthenticated = await post(
      "/payments/checkout",
      undefined,
      input(),
    );
    assert.equal(unauthenticated.statusCode, 401, unauthenticated.body);
    const reconciled = await post("/payments/checkout/reconcile", memberToken);
    assert.equal(reconciled.statusCode, 200, reconciled.body);
    assert.equal(reconciled.json().status, "resolved");
    const ownerReconcile = await post(
      "/payments/checkout/reconcile",
      ownerToken,
    );
    assert.equal(ownerReconcile.statusCode, 403, ownerReconcile.body);
    const created = await post("/products", ownerToken, {
      name: "Guided workout",
      description: "Fixture voice offer",
      priceMinor: 18000,
      tier: "workout",
      premiumVoice: true,
    });
    assert.equal(created.statusCode, 200, created.body);
    assert.equal(created.json().data.premiumVoice, true);
    assert.deepEqual(created.json().data.modules, ["training"]);
    assert.equal(created.json().status, "draft");
  } finally {
    await app.close();
  }
});
