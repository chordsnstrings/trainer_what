import { randomUUID } from "node:crypto";
import { type Actor, type Database, putRecord } from "@trainer/db";
import { seedScope } from "./scope-fixtures.ts";

/**
 * Fixtures for the programme package tests (docs/features/programme.md): a
 * workspace, members with sessions, a recording Stripe double, and signed
 * provider event shapes. Synthetic only; nothing reaches a provider.
 */
export type Member = Actor & { email: string; token: string };

export async function workspace(db: Database) {
  const owner = {
    tenantId: randomUUID(),
    userId: randomUUID(),
    role: "owner",
    email: "",
    token: randomUUID(),
  } as Member;
  owner.email = owner.userId + "@example.test";
  const { tokenHash } = await import("../apps/api/src/auth.ts");
  await db.system(async (tx) => {
    await tx.query(
      "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Programme coach','fixture-only')",
      [owner.userId, owner.email],
    );
    await tx.query(
      "INSERT INTO tenants(id,slug,name) VALUES($1,$2,'Programme fixture')",
      [owner.tenantId, "p" + owner.tenantId.slice(0, 18)],
    );
    await tx.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')",
      [owner.tenantId, owner.userId],
    );
    await tx.query(
      "INSERT INTO sessions(token_hash,user_id,tenant_id,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
      [tokenHash(owner.token), owner.userId, owner.tenantId],
    );
  });
  return owner;
}
export async function follower(db: Database, owner: Actor, name = "Member") {
  const { tokenHash } = await import("../apps/api/src/auth.ts");
  const a = {
    tenantId: owner.tenantId,
    userId: randomUUID(),
    role: "subscriber",
    email: "",
    token: randomUUID(),
  } as Member;
  a.email = a.userId + "@example.test";
  await db.system(async (tx) => {
    await tx.query(
      "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,'fixture-only')",
      [a.userId, a.email, name],
    );
    await tx.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'subscriber')",
      [a.tenantId, a.userId],
    );
    await tx.query(
      "INSERT INTO sessions(token_hash,user_id,tenant_id,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
      [tokenHash(a.token), a.userId, a.tenantId],
    );
  });
  return a;
}
/** A published offer as activation leaves it. */
export async function offer(db: Database, owner: Actor, data: any) {
  const key = randomUUID().slice(0, 8);
  return db.tenant(seedScope(owner), (tx) =>
    putRecord(
      tx,
      seedScope(owner),
      "product",
      {
        name: "Offer " + key,
        description: "Fixture",
        priceMinor: 30000,
        tier: "workout",
        modules: ["training"],
        billing: "monthly",
        programmeDays: null,
        stripeProductId: "prod_" + key,
        stripePriceId: "price_" + key,
        ...data,
      },
      { status: "published", ownerId: owner.userId },
    ),
  );
}

export type Call = { call: string; body: any; key?: string; id?: string };
/** A recording Stripe double for the calls the programme package makes. */
export function fakeStripe(overrides: Record<string, any> = {}) {
  const calls: Call[] = [];
  const sessions = new Map<string, any>();
  const subscriptions = new Map<string, any>();
  let n = 0;
  const stripe: any = {
    calls,
    sessions,
    subscriptionStore: subscriptions,
    products: {
      create: async (body: any, options: any) => {
        calls.push({ call: "product", body, key: options?.idempotencyKey });
        return { id: "prod_" + ++n };
      },
    },
    prices: {
      create: async (body: any, options: any) => {
        calls.push({ call: "price", body, key: options?.idempotencyKey });
        return { id: "price_" + ++n };
      },
    },
    checkout: {
      sessions: {
        create: async (body: any, options: any) => {
          calls.push({ call: "checkout", body, key: options?.idempotencyKey });
          const session = {
            ...body,
            id: "cs_" + randomUUID(),
            url: "https://checkout.stripe.com/c/fixture",
            status: "open",
            created: Math.floor(Date.now() / 1000),
          };
          sessions.set(session.id, session);
          return session;
        },
        retrieve: async (id: string) => sessions.get(id),
        list: async () => ({ data: [...sessions.values()], has_more: false }),
      },
    },
    paymentIntents: {
      retrieve: async (id: string) => ({ id, latest_charge: "ch_" + id }),
    },
    refunds: {
      create: async (body: any, options: any) => {
        calls.push({ call: "refund", body, key: options?.idempotencyKey });
        return { id: "re_" + ++n, status: "pending" };
      },
      list: async () => ({ data: [], has_more: false }),
    },
    subscriptions: {
      retrieve: async (id: string) => subscriptions.get(id) ?? { id },
      update: async (id: string, body: any, options: any) => {
        calls.push({ call: "subscription.update", body, key: options?.idempotencyKey, id });
        const sub = { ...(subscriptions.get(id) ?? { id }), ...body };
        subscriptions.set(id, sub);
        return sub;
      },
      cancel: async (id: string, _body: any, options: any) => {
        calls.push({ call: "subscription.cancel", body: {}, key: options?.idempotencyKey, id });
        const sub = { ...(subscriptions.get(id) ?? { id }), status: "canceled" };
        subscriptions.set(id, sub);
        return sub;
      },
    },
    ...overrides,
  };
  return stripe;
}

let clock = Math.floor(Date.now() / 1000) - 900;
/**
 * Strictly increasing provider event times in the recent past, for events
 * whose order matters (Stripe has one-second resolution).
 */
export const tick = () => ++clock;
export const evt = (
  type: string,
  object: any,
  created = Math.floor(Date.now() / 1000),
) => ({
  id: "evt_" + randomUUID(),
  type,
  created,
  data: { object },
});
/** A completed upfront programme Checkout, as Stripe sends it. */
export function paidProgrammeSession(intent: any, overrides: any = {}) {
  return {
    id: intent.data.providerId ?? "cs_" + randomUUID(),
    object: "checkout.session",
    mode: "payment",
    status: "complete",
    payment_status: "paid",
    currency: "aed",
    amount_total: intent.data.amountMinor,
    client_reference_id: intent.id,
    payment_intent: "pi_" + intent.id.slice(0, 8),
    metadata: {
      tenant_id: intent.tenant_id,
      user_id: intent.owner_user_id,
      intent_id: intent.id,
      purpose: "programme",
    },
    ...overrides,
  };
}

export async function request(
  app: any,
  method: string,
  url: string,
  token?: string,
  payload?: any,
) {
  return app.inject({
    method,
    url: "/api/v1" + url,
    headers: {
      origin: "http://localhost:3000",
      ...(token ? { cookie: "session=" + token } : {}),
    },
    ...(payload === undefined ? {} : { payload }),
  });
}

export async function withEnv<T>(
  values: Record<string, string>,
  run: () => Promise<T>,
) {
  const previous = Object.keys(values).map(
    (key) => [key, process.env[key]] as const,
  );
  Object.assign(process.env, values);
  try {
    return await run();
  } finally {
    for (const [key, value] of previous)
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
}
