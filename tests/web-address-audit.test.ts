import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { governanceFixture, type Person } from "./governance-fixtures.ts";
import {
  processWebAddressOrder,
  processWebAddressOrders,
} from "../apps/api/src/web-address-orders.ts";
import {
  checkAddressHealth,
  readAddressHealth,
} from "../apps/api/src/web-address-health.ts";
import { settlementBlockers } from "../apps/api/src/privacy-lifecycle.ts";
import { tlsIssuancePermitted } from "../apps/api/src/host-operations.ts";

const settings = {
  PLATFORM_ROOT_DOMAIN: "coaching.example",
  DOMAIN_OPERATIONS_ENABLED: "true",
  AUTHENTICATOR_REQUIRED: "false",
};
const saved = Object.fromEntries(
  Object.keys(settings).map((k) => [k, process.env[k]]),
);
const subscriptions = new Map<string, any>(),
  tokens = new Map<string, string>();
const calls: any[] = [];
let waitForUpdate: (() => Promise<void>) | null = null,
  loseAnswer = false;
const stripe: any = {
  subscriptions: {
    retrieve: async (id: string) => structuredClone(subscriptions.get(id)),
    update: async (id: string, params: any, options: any) => {
      calls.push({ id, params, key: options.idempotencyKey });
      const row = subscriptions.get(id);
      row.cancel_at_period_end = params.cancel_at_period_end;
      if (params.items)
        row.items.data[0].price.unit_amount =
          params.items[0].price_data.unit_amount;
      if (waitForUpdate) await waitForUpdate();
      if (loseAnswer) {
        loseAnswer = false;
        throw new Error("Lost response");
      }
      return structuredClone(row);
    },
    cancel: async (id: string) => {
      subscriptions.get(id).status = "canceled";
      return subscriptions.get(id);
    },
  },
  billingPortal: {
    sessions: {
      create: async (params: any) => {
        calls.push({ portal: params });
        return { url: "https://billing.stripe.com/p/session/fixture" };
      },
    },
  },
  invoices: {
    retrieve: async (id: string) => ({
      id,
      status: "open",
      hosted_invoice_url: "https://invoice.stripe.com/i/fixture",
    }),
  },
};
const deps = {
  stripe,
  targetIpv4: async () => "203.0.113.7",
  resolve4: async () => ["203.0.113.7"],
  httpsCheck: async () => {},
};
let f: Awaited<ReturnType<typeof governanceFixture>>,
  owner: Person,
  other: Person;
before(async () => {
  Object.assign(process.env, settings);
  f = await governanceFixture({
    providers: {
      webAddresses: deps,
      domainConnections: {
        ...deps,
        cname: async () => [],
        txt: async (name) => [["trainer-verification=" + tokens.get(name)]],
      },
    },
  });
  owner = await f.person();
  other = await f.person();
});
after(async () => {
  await f?.close();
  for (const [key, value] of Object.entries(saved))
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
});
async function order(person = owner, status = "owned") {
  const id = randomUUID(),
    sub = "sub_" + id;
  subscriptions.set(sub, {
    id: sub,
    status: "active",
    cancel_at_period_end: false,
    items: {
      data: [
        {
          id: "si_" + id,
          quantity: 1,
          price: {
            unit_amount: 2499,
            currency: "usd",
            product: "prod_fixture",
            recurring: { interval: "year", interval_count: 1 },
          },
        },
      ],
    },
  });
  await f.db.tenant(person, (tx) =>
    tx.query(
      "INSERT INTO domain_orders(id,tenant_id,hostname,mode,status,token,registrar,quote,stripe_subscription_id,stripe_customer_id,billing_status,expires_at,evidence) VALUES($1,$2,$3,'automatic',$4,'fixture-token','namecheap',$5,$6,$7,'active',now()+interval '100 days',$8)",
      [
        id,
        person.tenantId,
        "domain-" + id + ".com",
        status,
        JSON.stringify({
          currency: "USD",
          firstYearPriceMinor: 1999,
          renewalPriceMinor: 2499,
        }),
        sub,
        "cus_" + id,
        JSON.stringify({ orderedBy: person.userId }),
      ],
    ),
  );
  return { id, sub };
}
const post = (id: string, action: string, body: unknown, person = owner) =>
  f.call(`/web-address/orders/${id}/${action}`, {
    body,
    cookie: person.cookie,
  });

test("opposite renewal intent is blocked until provider read-back confirms the first", async () => {
  const o = await order();
  let started!: () => void, finish!: () => void;
  const entered = new Promise<void>((r) => (started = r)),
    gate = new Promise<void>((r) => (finish = r));
  waitForUpdate = async () => {
    started();
    await gate;
  };
  const off = post(o.id, "renewal", { enabled: false });
  await entered;
  const on = await post(o.id, "renewal", { enabled: true });
  assert.equal(on.statusCode, 409);
  assert.equal(on.json().code, "RENEWAL_PENDING");
  finish();
  waitForUpdate = null;
  const confirmed = await off;
  assert.equal(confirmed.statusCode, 200, confirmed.body);
  assert.equal(confirmed.json().renewalEnabled, false);
  assert.equal(confirmed.json().renewalPending, false);
  assert.equal(subscriptions.get(o.sub).cancel_at_period_end, true);
  assert.equal(
    (await post(o.id, "renewal", { enabled: true })).json().renewalEnabled,
    true,
  );
});

test("lost Stripe response retains intent and retries its stable key", async () => {
  const o = await order();
  loseAnswer = true;
  const response = await post(o.id, "renewal", { enabled: false });
  assert.equal(
    response.json().renewalEnabled,
    true,
    "Last confirmed state remains visible",
  );
  assert.equal(response.json().renewalPending, true);
  assert.equal(
    (await post(o.id, "renewal", { enabled: true })).statusCode,
    409,
  );
  await processWebAddressOrder(f.db, owner.tenantId, o.id, deps, {
    force: true,
  });
  const retryCalls = calls.filter((c) => c.id === o.sub);
  assert.equal(retryCalls.length, 2);
  assert.equal(retryCalls[0].key, retryCalls[1].key);
  const final = await f.call(`/web-address/orders/${o.id}`, {
    cookie: owner.cookie,
  });
  assert.equal(final.json().renewalEnabled, false);
  assert.equal(final.json().renewalPending, false);
});

test("workspace closure blocks domain billing until cancellation is confirmed", async () => {
  const isolated = await f.person(),
    o = await order(isolated, "active");
  let blockers = await f.db.tenant(isolated, (tx) => settlementBlockers(tx));
  assert.ok(blockers.some((b) => b.kind === "domain_billing"));
  const ended = await post(o.id, "end-billing", { confirmed: true }, isolated);
  assert.equal(ended.statusCode, 200, ended.body);
  assert.equal(ended.json().billingStatus, "canceled");
  blockers = await f.db.tenant(isolated, (tx) => settlementBlockers(tx));
  assert.ok(!blockers.some((b) => b.kind === "domain_billing"));
  assert.equal(ended.json().status, "active", "Paid registration is retained");
});

test("unverified requests cannot block the real owner, verified ownership remains exclusive", async () => {
  const domain = "claim-" + randomUUID() + ".com";
  const first = await f.call("/domains", {
    cookie: owner.cookie,
    body: { hostname: domain, alreadyOwned: true },
  });
  const second = await f.call("/domains", {
    cookie: other.cookie,
    body: { hostname: domain, alreadyOwned: true },
  });
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(second.statusCode, 200, second.body);
  assert.ok(second.json().reservationExpiresAt);
  tokens.set("_trainer-verify." + domain, second.json().token);
  const verified = await f.call(`/domains/${second.json().id}/verify`, {
    cookie: other.cookie,
    body: { revision: second.json().version },
  });
  assert.equal(verified.statusCode, 200, verified.body);
  tokens.set("_trainer-verify." + domain, first.json().token);
  const takeover = await f.call(`/domains/${first.json().id}/verify`, {
    cookie: owner.cookie,
    body: { revision: first.json().version },
  });
  assert.equal(takeover.statusCode, 409);
  assert.equal(takeover.json().code, "DOMAIN_IN_USE");
});

test("owner connects apex and www with A records, then disconnects both", async () => {
  const hostname = "connect-" + randomUUID() + ".com";
  const created = (
    await f.call("/domains", {
      cookie: owner.cookie,
      body: { hostname, alreadyOwned: true, includeWww: true },
    })
  ).json();
  tokens.set("_trainer-verify." + hostname, created.token);
  const proof = await f.call(`/domains/${created.id}/verify`, {
    cookie: owner.cookie,
    body: { revision: created.version },
  });
  const active = await f.call(`/domains/${created.id}/connect`, {
    cookie: owner.cookie,
    body: { revision: proof.json().version },
  });
  assert.equal(active.statusCode, 200, active.body);
  assert.equal(active.json().status, "active");
  let mappings = await f.db.system((tx) =>
    tx.query(
      "SELECT hostname,active FROM domain_mappings WHERE hostname=ANY($1)",
      [[hostname, "www." + hostname]],
    ),
  );
  assert.equal(mappings.length, 2);
  assert.ok(mappings.every((m) => m.active));
  const cancel = await f.call(`/domains/${created.id}/cancel`, {
    cookie: owner.cookie,
    body: { revision: active.json().version },
  });
  assert.equal(cancel.statusCode, 200, cancel.body);
  mappings = await f.db.system((tx) =>
    tx.query("SELECT active FROM domain_mappings WHERE hostname=ANY($1)", [
      [hostname, "www." + hostname],
    ]),
  );
  assert.ok(mappings.every((m) => !m.active));
});

test("publication alone is not a live check; DNS drift and failed site probes remove healthy status", async () => {
  const a = await f.person(),
    [tenant] = await f.db.system((tx) =>
      tx.query("SELECT slug FROM tenants WHERE id=$1", [a.tenantId]),
    );
  const host = tenant.slug + ".coaching.example";
  assert.equal(
    (await f.call("/web-address", { cookie: a.cookie })).json().subdomain.live,
    false,
  );
  const healthy = await checkAddressHealth(f.db, a, host, tenant.slug, deps);
  assert.equal(healthy.state, "healthy");
  assert.equal(
    (await f.call("/web-address", { cookie: a.cookie })).json().subdomain.live,
    true,
  );
  const drift = await checkAddressHealth(f.db, a, host, tenant.slug, {
    ...deps,
    resolve6: async () => ["2606:4700::1111"],
  });
  assert.equal(drift.state, "attention");
  const failed = await checkAddressHealth(f.db, a, host, tenant.slug, {
    ...deps,
    siteCheck: async () => {
      throw new Error("502");
    },
  });
  assert.equal(failed.state, "attention");
  assert.equal(
    (await readAddressHealth(f.db, other, host)).state,
    "unchecked",
    "Health is tenant scoped",
  );
});

test("suspended published workspace retains certificate permission; closed workspace does not", async () => {
  const a = await f.person(),
    [tenant] = await f.db.system((tx) =>
      tx.query("SELECT slug FROM tenants WHERE id=$1", [a.tenantId]),
    );
  await f.db.system((tx) =>
    tx.query("UPDATE tenants SET lifecycle_state='suspended' WHERE id=$1", [
      a.tenantId,
    ]),
  );
  assert.equal(
    await tlsIssuancePermitted(
      f.db,
      tenant.slug + ".coaching.example",
      Date.now() + 60000,
    ),
    true,
  );
  await f.db.system((tx) =>
    tx.query("UPDATE tenants SET lifecycle_state='closed' WHERE id=$1", [
      a.tenantId,
    ]),
  );
  assert.equal(
    await tlsIssuancePermitted(
      f.db,
      tenant.slug + ".coaching.example",
      Date.now() + 120000,
    ),
    false,
  );
});

test("billing portal is bound to the owner's order and platform return URL", async () => {
  const o = await order();
  assert.equal((await post(o.id, "billing", {}, other)).statusCode, 409);
  const link = await post(o.id, "billing", {});
  assert.equal(link.statusCode, 200, link.body);
  assert.equal(calls.at(-1).portal.customer, "cus_" + o.id);
  assert.equal(
    calls.at(-1).portal.return_url,
    "http://localhost:3000/trainer/domains",
  );
});

test("payment recovery opens only the linked subscription's outstanding invoice", async () => {
  const o = await order();
  assert.equal(
    (await post(o.id, "billing", { action: "invoice" })).json().code,
    "NO_OPEN_INVOICE",
  );
  subscriptions.get(o.sub).latest_invoice = "in_fixture";
  const link = await post(o.id, "billing", { action: "invoice" });
  assert.equal(link.statusCode, 200, link.body);
  assert.equal(link.json().url, "https://invoice.stripe.com/i/fixture");
});

test("a changed renewal price requires exact approval and preserves its billing date without proration", async () => {
  const o = await order(owner, "active"),
    offer = {
      id: randomUUID(),
      amountMinor: 3499,
      currency: "USD",
      state: "offered",
      purchasable: true,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    };
  await f.db.tenant(owner, (tx) =>
    tx.query(
      "UPDATE domain_orders SET evidence=evidence||$2::jsonb WHERE id=$1",
      [o.id, JSON.stringify({ renewalOffer: offer })],
    ),
  );
  const body = {
    offerId: offer.id,
    amountMinor: 3498,
    currency: "USD",
    accepted: true,
  };
  assert.equal((await post(o.id, "renewal-price", body)).statusCode, 409);
  assert.equal(
    (await post(o.id, "renewal", { enabled: true })).json().code,
    "PRICE_APPROVAL_REQUIRED",
  );
  const accepted = await post(o.id, "renewal-price", {
    ...body,
    amountMinor: 3499,
  });
  assert.equal(accepted.statusCode, 200, accepted.body);
  assert.equal(accepted.json().renewalPriceMinor, 3499);
  assert.equal(accepted.json().firstYearPriceMinor, 1999);
  const request = calls.filter((c) => c.id === o.sub).at(-1).params;
  assert.equal(request.proration_behavior, "none");
  assert.equal(request.billing_cycle_anchor, undefined);
});

test("unapproved renewal price schedules renewal off before the invoice, without charging the new price", async () => {
  const o = await order(owner, "active");
  const offer = {
    id: randomUUID(),
    amountMinor: 4499,
    currency: "USD",
    state: "offered",
    purchasable: true,
    expiresAt: new Date(Date.now() - 1000).toISOString(),
  };
  await f.db.tenant(owner, (tx) =>
    tx.query(
      "UPDATE domain_orders SET evidence=evidence||$2::jsonb WHERE id=$1",
      [o.id, JSON.stringify({ renewalOffer: offer })],
    ),
  );
  await processWebAddressOrder(f.db, owner.tenantId, o.id, deps, {
    force: true,
  });
  await processWebAddressOrder(f.db, owner.tenantId, o.id, deps, {
    force: true,
  });
  const view = (
    await f.call(`/web-address/orders/${o.id}`, { cookie: owner.cookie })
  ).json();
  assert.equal(view.renewalEnabled, false);
  assert.equal(view.renewalOffer.state, "expired");
  assert.equal(view.renewalPriceMinor, 2499);
  assert.equal(subscriptions.get(o.sub).cancel_at_period_end, true);
});

test("provider cancellation during an unknown renewal outcome clears the pending intent", async () => {
  const o = await order();
  loseAnswer = true;
  await post(o.id, "renewal", { enabled: false });
  subscriptions.get(o.sub).status = "canceled";
  await processWebAddressOrder(f.db, owner.tenantId, o.id, deps, {
    force: true,
  });
  const view = (
    await f.call(`/web-address/orders/${o.id}`, { cookie: owner.cookie })
  ).json();
  assert.equal(view.renewalEnabled, false);
  assert.equal(view.renewalPending, false);
  assert.equal(view.billingStatus, "canceled");
});

test("deadline maintenance preserves a price approval committed while DNS was checked", async (t) => {
  const person = await f.person(),
    o = await order(person, "active"),
    offer = {
      id: randomUUID(),
      amountMinor: 3499,
      currency: "USD",
      state: "offered",
      purchasable: true,
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    };
  await f.db.tenant(person, (tx) =>
    tx.query(
      "UPDATE domain_orders SET evidence=evidence||$2::jsonb WHERE id=$1",
      [o.id, JSON.stringify({ renewalOffer: offer })],
    ),
  );
  let checked = false,
    clock = Date.now();
  t.mock.method(Date, "now", () => clock);
  await processWebAddressOrder(
    f.db,
    person.tenantId,
    o.id,
    {
      ...deps,
      httpsCheck: async () => {
        if (checked) return;
        checked = true;
        const response = await post(
          o.id,
          "renewal-price",
          {
            offerId: offer.id,
            amountMinor: offer.amountMinor,
            currency: "USD",
            accepted: true,
          },
          person,
        );
        assert.equal(response.statusCode, 200, response.body);
        assert.equal(response.json().renewalPending, true);
        clock += 120000;
      },
    },
    { force: true },
  );
  assert.equal(checked, true);
  await processWebAddressOrder(f.db, person.tenantId, o.id, deps, {
    force: true,
  });
  const view = (
    await f.call(`/web-address/orders/${o.id}`, { cookie: person.cookie })
  ).json();
  assert.equal(view.renewalEnabled, true);
  assert.equal(view.renewalPriceMinor, 3499);
  assert.equal(view.renewalOffer.state, "accepted");
  assert.equal(subscriptions.get(o.sub).cancel_at_period_end, false);
});

test("legacy closed workspaces get billing cleanup even when their next domain visit was months away", async () => {
  const person = await f.person(),
    o = await order(person, "active");
  await f.db.tenant(person, (tx) =>
    tx.query(
      "UPDATE domain_orders SET next_attempt_at=now()+interval '60 days' WHERE id=$1",
      [o.id],
    ),
  );
  await f.db.system((tx) =>
    tx.query("UPDATE tenants SET lifecycle_state='closed' WHERE id=$1", [
      person.tenantId,
    ]),
  );
  await processWebAddressOrders(f.db, deps);
  assert.equal(subscriptions.get(o.sub).status, "canceled");
});
