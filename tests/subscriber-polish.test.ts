import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createDatabase,
  putRecord,
  type Database,
  type Actor,
} from "@trainer/db";
import { readyServices } from "./service-readiness-fixtures.ts";
import {
  quoteUpgrade,
  confirmUpgrade,
  reconcileUpgrade,
  upgradeOptions,
  upgradeReason,
} from "../apps/api/src/membership-upgrades.ts";
import {
  restoreWorkoutCheckpoint,
  workoutCheckpointKey,
} from "../apps/web/lib/workout-checkpoint.ts";

test("workout drafts preserve empty edits, expire, isolate members and reject a changed prescription", () => {
  const now = 1000000000,
    prescription = '{"loadKg":20}';
  const raw = JSON.stringify({
    version: 1,
    prescription,
    savedAt: now - 1000,
    drafts: { set1: { load: 23.5, reps: null, rir: 2, distance: -1 } },
    rest: { until: now + 30000, total: 60 },
  });
  const restored = restoreWorkoutCheckpoint(raw, prescription, now);
  assert.deepEqual(restored.drafts.set1, { load: 23.5, reps: null, rir: 2 });
  assert.equal(restored.rest?.until, now + 30000);
  assert.equal(
    restoreWorkoutCheckpoint(raw, prescription, now + 31000).rest,
    null,
  );
  assert.deepEqual(restoreWorkoutCheckpoint(raw, "changed", now).drafts, {});
  assert.deepEqual(
    restoreWorkoutCheckpoint(raw, prescription, now + 8 * 86400000).drafts,
    {},
  );
  assert.deepEqual(
    restoreWorkoutCheckpoint("invalid", prescription, now).drafts,
    {},
  );
  assert.notEqual(
    workoutCheckpointKey("coach-a", "member", "workout"),
    workoutCheckpointKey("coach-b", "member", "workout"),
  );
  assert.notEqual(
    workoutCheckpointKey("coach", "one", "workout"),
    workoutCheckpointKey("coach", "two", "workout"),
  );
});
let db: Database;
before(async () => {
  db = await createDatabase({ memory: true });
});
after(async () => {
  await db.close();
});
async function fixture() {
  const owner: Actor = {
    tenantId: randomUUID(),
    userId: randomUUID(),
    role: "owner",
  };
  const a: Actor = { ...owner, userId: randomUUID(), role: "subscriber" };
  const other: Actor = { ...a, userId: randomUUID() };
  await db.system(async (tx) => {
    await tx.query(
      "INSERT INTO tenants(id,slug,name) VALUES($1,$2,'Upgrade fixture')",
      [owner.tenantId, owner.tenantId],
    );
    for (const x of [owner, a, other]) {
      await tx.query(
        "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Synthetic','fixture-only')",
        [x.userId, x.userId + "@example.test"],
      );
      await tx.query(
        "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)",
        [x.tenantId, x.userId, x.role],
      );
    }
  });
  const restore = await readyServices(db, owner);
  const basePrice = "price_base_" + a.userId,
    targetPrice = "price_voice_" + a.userId;
  const { base, target, s } = await db.tenant(owner, async (tx) => {
    const base = await putRecord(
      tx,
      owner,
      "product",
      {
        name: "Training",
        priceMinor: 19900,
        modules: ["training"],
        stripePriceId: basePrice,
        stripeProductId: "prod_base",
      },
      { status: "published" },
    );
    const target = await putRecord(
      tx,
      owner,
      "product",
      {
        name: "Training + voice",
        priceMinor: 29900,
        modules: ["training"],
        premiumVoice: true,
        stripePriceId: targetPrice,
        stripeProductId: "prod_voice",
      },
      { status: "published" },
    );
    const [s] = await tx.query(
      "INSERT INTO subscriptions(id,tenant_id,user_id,provider_id,status,price_minor,period_end,data) VALUES($1,$2,$3,$4,'active',19900,now()+interval '20 days',$5) RETURNING *",
      [
        randomUUID(),
        a.tenantId,
        a.userId,
        "sub_" + a.userId,
        JSON.stringify({
          productId: base.id,
          priceId: basePrice,
          modules: ["training"],
          billing: "monthly",
          firstPaidAt: new Date().toISOString(),
        }),
      ],
    );
    return { base, target, s };
  });
  let updates = 0,
    amount = 6000,
    mode: "paid" | "pending" | "unknown" | "read-failure" | "refused" = "paid";
  let remote: any = {
    id: s.provider_id,
    object: "subscription",
    customer: "cus_" + a.userId,
    status: "active",
    collection_method: "charge_automatically",
    current_period_end: Math.floor(Date.parse(s.period_end) / 1000),
    metadata: { tenant_id: a.tenantId, user_id: a.userId },
    items: {
      data: [
        {
          id: "si_fixture",
          quantity: 1,
          price: {
            id: basePrice,
            currency: "aed",
            recurring: {
              interval: "month",
              interval_count: 1,
              usage_type: "licensed",
            },
          },
        },
      ],
    },
    latest_invoice: { id: "in_old", status: "paid" },
  };
  const stripe: any = {
    prices: {
      retrieve: async () => ({
        id: targetPrice,
        active: true,
        product: "prod_voice",
        unit_amount: 29900,
        currency: "aed",
        recurring: {
          interval: "month",
          interval_count: 1,
          usage_type: "licensed",
        },
      }),
    },
    invoices: {
      createPreview: async (input: any) => {
        assert.equal(
          input.subscription_details.proration_behavior,
          "always_invoice",
        );
        return { currency: "aed", amount_due: amount };
      },
      retrieve: async () => remote.latest_invoice,
    },
    subscriptions: {
      retrieve: async () => structuredClone(remote),
      update: async (_id: string, input: any, options: any) => {
        updates++;
        assert.equal(input.payment_behavior, "pending_if_incomplete");
        assert.equal(input.items[0].id, "si_fixture");
        assert.match(options.idempotencyKey, /^upgrade:/);
        if (mode === "refused")
          throw Object.assign(new Error("Synthetic refusal"), {
            type: "StripeInvalidRequestError",
            statusCode: 400,
          });
        remote.latest_invoice = {
          id: "in_upgrade_" + a.userId,
          status: mode === "pending" ? "open" : "paid",
          amount_due: amount,
          currency: "aed",
          customer: remote.customer,
          parent: { subscription_details: { subscription: remote.id } },
          billing_reason: "subscription_update",
          hosted_invoice_url: "https://invoice.stripe.com/i/synthetic",
        };
        if (mode === "pending")
          remote.pending_update = {
            subscription_items: [{ id: "si_fixture", price: targetPrice }],
          };
        else {
          remote.items.data[0].price.id = targetPrice;
          remote.pending_update = null;
        }
        if (mode === "unknown") throw new Error("Synthetic lost response");
        if (mode === "read-failure") {
          stripe.invoices.retrieve = async () => {
            throw Object.assign(new Error("Synthetic evidence read refusal"), {
              type: "StripeInvalidRequestError",
              statusCode: 404,
            });
          };
          return {
            ...structuredClone(remote),
            latest_invoice: remote.latest_invoice.id,
          };
        }
        return structuredClone(remote);
      },
    },
  };
  const current = async () =>
    (
      await db.tenant(a, (tx) =>
        tx.query("SELECT * FROM subscriptions WHERE user_id=$1", [a.userId]),
      )
    )[0];
  return {
    a,
    other,
    owner,
    base,
    target,
    s,
    stripe,
    restore,
    current,
    updates: () => updates,
    amount: (v: number) => {
      amount = v;
    },
    mode: (v: typeof mode) => {
      mode = v;
    },
    pay: () => {
      remote.pending_update = null;
      remote.items.data[0].price.id = targetPrice;
      remote.latest_invoice.status = "paid";
    },
  };
}

test("upgrade quotes isolate members, preserve paid access, and require a fresh unchanged amount", async () => {
  const f = await fixture();
  try {
    // PostgreSQL bigint values arrive as strings; PGlite returns numbers.
    assert.equal(
      upgradeReason({ ...f.s, price_minor: String(f.s.price_minor) }, f.target),
      null,
    );
    assert.match(
      upgradeReason({ ...f.s, price_minor: "9007199254740993" }, f.target)!,
      /higher package/,
    );
    const q = await quoteUpgrade(db, f.a, f.target.id, f.stripe);
    assert.equal(q.amountMinor, 6000);
    assert.equal(f.updates(), 0);
    assert.equal((await f.current()).data.premiumVoice, undefined);
    await assert.rejects(confirmUpgrade(db, f.other, q.id, f.stripe), {
      code: "QUOTE_NOT_FOUND",
    });
    await assert.rejects(quoteUpgrade(db, f.owner, f.target.id, f.stripe), {
      code: "SUBSCRIBER_REQUIRED",
    });
    f.amount(6500);
    await assert.rejects(confirmUpgrade(db, f.a, q.id, f.stripe), {
      code: "PRICE_CHANGED",
    });
    assert.equal(f.updates(), 0);
    f.amount(6000);
    await db.tenant(f.a, (tx) =>
      tx.query(
        "UPDATE records SET data=jsonb_set(data,'{expiresAt}',to_jsonb($2::text)) WHERE id=$1",
        [q.id, new Date(0).toISOString()],
      ),
    );
    await assert.rejects(confirmUpgrade(db, f.a, q.id, f.stripe), {
      code: "QUOTE_EXPIRED",
    });
    assert.equal(f.updates(), 0);
  } finally {
    f.restore();
  }
});

test("a provider refusal is terminal, but a read refusal after dispatch holds the upgrade for reconciliation", async () => {
  const f = await fixture();
  try {
    f.mode("refused");
    const refused = await quoteUpgrade(db, f.a, f.target.id, f.stripe);
    await assert.rejects(confirmUpgrade(db, f.a, refused.id, f.stripe), {
      code: "UPGRADE_REFUSED",
    });
    assert.equal((await upgradeOptions(db, f.a)).blocked, false);
    assert.equal((await f.current()).data.productId, f.base.id);
    f.mode("read-failure");
    const q = await quoteUpgrade(db, f.a, f.target.id, f.stripe);
    await assert.rejects(confirmUpgrade(db, f.a, q.id, f.stripe), {
      code: "UPGRADE_PENDING",
    });
    assert.equal((await upgradeOptions(db, f.a)).blocked, true);
    await assert.rejects(quoteUpgrade(db, f.a, f.target.id, f.stripe), {
      code: "UPGRADE_PENDING",
    });
    assert.equal(
      (await reconcileUpgrade(db, f.a, f.stripe)).status,
      "succeeded",
    );
    assert.equal(f.updates(), 2);
  } finally {
    f.restore();
  }
});

test("workspace closure and lost subscriber access invalidate an unsubmitted quote without a charge", async () => {
  const f = await fixture();
  try {
    const q = await quoteUpgrade(db, f.a, f.target.id, f.stripe);
    await db.system((tx) =>
      tx.query("UPDATE tenants SET lifecycle_state='closed' WHERE id=$1", [
        f.a.tenantId,
      ]),
    );
    await assert.rejects(confirmUpgrade(db, f.a, q.id, f.stripe), {
      code: "WORKSPACE_CLOSED",
    });
    await db.system(async (tx) => {
      await tx.query(
        "UPDATE tenants SET lifecycle_state='active' WHERE id=$1",
        [f.a.tenantId],
      );
      await tx.query(
        "DELETE FROM memberships WHERE tenant_id=$1 AND user_id=$2",
        [f.a.tenantId, f.a.userId],
      );
    });
    await assert.rejects(confirmUpgrade(db, f.a, q.id, f.stripe), {
      code: "SUBSCRIBER_REQUIRED",
    });
    assert.equal(f.updates(), 0);
  } finally {
    f.restore();
  }
});

test("paid upgrade changes the existing subscription once and repeated confirmation never charges again", async () => {
  const f = await fixture();
  try {
    const q = await quoteUpgrade(db, f.a, f.target.id, f.stripe);
    assert.equal(
      (await confirmUpgrade(db, f.a, q.id, f.stripe)).status,
      "succeeded",
    );
    assert.equal((await f.current()).data.productId, f.target.id);
    assert.equal((await f.current()).data.premiumVoice, true);
    assert.equal(
      (await confirmUpgrade(db, f.a, q.id, f.stripe)).status,
      "succeeded",
    );
    assert.equal(f.updates(), 1);
  } finally {
    f.restore();
  }
});

test("authentication or failed payment preserves the old package until provider evidence confirms payment", async () => {
  const f = await fixture();
  try {
    f.mode("pending");
    const q = await quoteUpgrade(db, f.a, f.target.id, f.stripe);
    const r = await confirmUpgrade(db, f.a, q.id, f.stripe);
    assert.equal(r.status, "pending");
    assert.equal(r.url, "https://invoice.stripe.com/i/synthetic");
    assert.equal((await f.current()).data.productId, f.base.id);
    assert.ok((await upgradeOptions(db, f.a)).blocked);
    await assert.rejects(confirmUpgrade(db, f.a, q.id, f.stripe), {
      code: "UPGRADE_PENDING",
    });
    await assert.rejects(quoteUpgrade(db, f.a, f.target.id, f.stripe), {
      code: "UPGRADE_PENDING",
    });
    f.pay();
    assert.equal(
      (await reconcileUpgrade(db, f.a, f.stripe)).status,
      "succeeded",
    );
    assert.equal((await f.current()).data.productId, f.target.id);
    assert.equal(f.updates(), 1);
  } finally {
    f.restore();
  }
});

test("lost paid response reconciles without dispatching another instruction; overlapping passes fail closed", async () => {
  const f = await fixture();
  try {
    const startsAt = new Date(Date.now() - 1000).toISOString(),
      endsAt = new Date(Date.now() + 86400000).toISOString();
    assert.match(
      upgradeReason(
        {
          ...f.s,
          data: {
            ...f.s.data,
            modulePasses: { voice: { verified: true, startsAt, endsAt } },
          },
        },
        f.target,
      )!,
      /active module pass/,
    );
    assert.match(
      upgradeReason(
        { ...f.s, data: { ...f.s.data, voiceAddOn: { status: "active" } } },
        f.target,
      )!,
      /separate voice subscription/,
    );
    f.mode("unknown");
    const q = await quoteUpgrade(db, f.a, f.target.id, f.stripe);
    await assert.rejects(confirmUpgrade(db, f.a, q.id, f.stripe), {
      code: "UPGRADE_PENDING",
    });
    assert.equal((await f.current()).data.productId, f.base.id);
    assert.equal(
      (await reconcileUpgrade(db, f.a, f.stripe)).status,
      "succeeded",
    );
    assert.equal((await f.current()).data.productId, f.target.id);
    assert.equal(f.updates(), 1);
  } finally {
    f.restore();
  }
});
