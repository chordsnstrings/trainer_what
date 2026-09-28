// The web address subscription with the real Stripe SDK against the Stripe
// double over TLS, and Stripe's signed webhooks through the application's own
// webhook route: yearly Checkout with an inline AED price, the first invoice,
// registration, the billing date moved to 30 days before expiry, a yearly
// renewal invoice and the cancellation at lapse. Registrar calls go to the
// Namecheap double through an explicit test transport; nothing leaves the host.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { createDatabase, elevated, type Database } from "@trainer/db";
import { stripeClient } from "@trainer/providers";
import { buildApp } from "../apps/api/src/app.ts";
import {
  processWebAddressOrder,
  type WebAddressDeps,
  type WebAddressStripe,
} from "../apps/api/src/web-address-orders.ts";
import { clearWebAddressPriceCache } from "../apps/api/src/web-addresses.ts";
import { NamecheapRegistrar } from "../packages/providers/src/registrar.ts";
import { createMockTls, trustMockCa, type MockTls } from "./e2e/mocks/tls.ts";
import { StripeMock } from "./e2e/mocks/stripe.ts";
import { NamecheapMock } from "./e2e/mocks/namecheap.ts";

const account = {
  apiUser: "trainsyou",
  apiKey: "nc-fixture-key-0123456789",
  username: "trainsyou",
  clientIp: "1.2.3.4",
};
const settings: Record<string, string> = {
  TRAINER_PROVIDER_SANDBOX: "mock",
  PUBLIC_APP_URL: "https://localhost:8443",
  API_HOST: "127.0.0.1",
  PLATFORM_ROOT_DOMAIN: "trainsyou.example",
  COMMERCE_APPROVED: "true",
  STRIPE_SECRET_KEY: "sk_test_mock_fixture",
  STRIPE_WEBHOOK_SECRET: "whsec_test_fixture",
  WEB_ADDRESS_PURCHASES_ENABLED: "true",
  WEB_ADDRESS_TLDS: "com",
  WEB_ADDRESS_MARGIN_AED: "25",
  WEB_ADDRESS_USD_TO_AED: "3.6725",
  WEB_ADDRESS_REGISTRANT_FIRST_NAME: "Platform",
  WEB_ADDRESS_REGISTRANT_LAST_NAME: "Owner",
  WEB_ADDRESS_REGISTRANT_ORGANIZATION: "TrainsYou FZ-LLC",
  WEB_ADDRESS_REGISTRANT_ADDRESS: "1 Fixture Street",
  WEB_ADDRESS_REGISTRANT_CITY: "Dubai",
  WEB_ADDRESS_REGISTRANT_STATE: "Dubai",
  WEB_ADDRESS_REGISTRANT_POSTAL_CODE: "00000",
  WEB_ADDRESS_REGISTRANT_COUNTRY: "AE",
  WEB_ADDRESS_REGISTRANT_PHONE: "+971.501234567",
  WEB_ADDRESS_REGISTRANT_EMAIL: "domains@trainsyou.example",
};
const saved = Object.fromEntries(
  [...Object.keys(settings), "STRIPE_API_BASE_URL"].map((k) => [
    k,
    process.env[k],
  ]),
);
let tls: MockTls, db: Database, app: Awaited<ReturnType<typeof buildApp>>;
let stripeMock: StripeMock, receiver: Server;
const namecheap = new NamecheapMock({ key: "unused", cert: "unused" }, account);
const dns = new Map<string, string[]>();
namecheap.onHosts = (domain, hosts) => {
  for (const host of hosts)
    dns.set(host.name === "@" ? domain : host.name + "." + domain, [
      host.address,
    ]);
};
let deps: WebAddressDeps;
const delivered: Array<{ type: string; status: number }> = [];

before(async () => {
  Object.assign(process.env, settings);
  clearWebAddressPriceCache();
  tls = createMockTls();
  trustMockCa(tls.ca);
  stripeMock = new StripeMock(
    { key: tls.key, cert: tls.cert },
    "sk_test_mock_fixture",
    "whsec_test_fixture",
  );
  await stripeMock.start();
  process.env.STRIPE_API_BASE_URL = stripeMock.url;
  deps = {
    registrar: new NamecheapRegistrar(
      { ...account, sandbox: true },
      { transport: namecheap.fetch },
    ),
    stripe: stripeClient() as unknown as WebAddressStripe,
    resolve4: async (name) => dns.get(name) ?? [],
    httpsCheck: async () => {},
    targetIpv4: async () => "203.0.113.7",
  };
  db = await createDatabase({ memory: true });
  app = await buildApp({
    db,
    testing: true,
    providers: { webAddresses: deps },
  });
  // Stripe's signed deliveries reach the application's webhook route.
  receiver = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      const result = await app.inject({
        method: "POST",
        url: "/api/v1/webhooks/stripe",
        headers: {
          host: "localhost:8443",
          "content-type": "application/json",
          "stripe-signature": String(req.headers["stripe-signature"]),
        },
        payload: body,
      });
      delivered.push({
        type: JSON.parse(body).type,
        status: result.statusCode,
      });
      res.writeHead(result.statusCode).end(result.body);
    });
  });
  await new Promise<void>((r) => receiver.listen(0, "127.0.0.1", () => r()));
  stripeMock.webhookUrl = `http://127.0.0.1:${(receiver.address() as any).port}/hook`;
});
after(async () => {
  await stripeMock?.stop();
  receiver?.close();
  await app?.close();
  await db?.close();
  tls?.cleanup();
  for (const [key, value] of Object.entries(saved))
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
});

test("yearly Checkout, signed payment events, registration, billing date alignment, renewal and cancellation", async () => {
  const origin = "https://localhost:8443";
  const register = await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    headers: { host: "localhost:8443", origin },
    payload: {
      name: "Fixture Layla",
      email: "layla@stripe-fixture.test",
      password: "FixturePassword2026!",
      slug: "layla",
      accepted: true,
    },
  });
  assert.equal(register.statusCode, 201, register.body);
  const cookie = String(register.headers["set-cookie"]).split(";")[0];
  const user = (
    await app.inject({
      url: "/api/v1/bootstrap",
      headers: { host: "localhost:8443", cookie },
    })
  ).json().user;
  await db.system((tx) =>
    tx.query("UPDATE tenants SET published=true WHERE id=$1", [user.tenantId]),
  );

  const created = await app.inject({
    method: "POST",
    url: "/api/v1/web-address/orders",
    headers: { host: "localhost:8443", origin, cookie },
    payload: {
      domain: "layla.com",
      firstYearPriceMinor: 8400,
      renewalPriceMinor: 8400,
      accepted: true,
    },
  });
  assert.equal(created.statusCode, 200, created.body);
  const { orderId, url } = created.json();
  const sessionId = url.split("/").at(-1);
  const session = stripeMock.sessions.get(sessionId)!;
  assert.equal(session.subscription_data.amount, 8400);
  assert.equal(
    stripeMock.prices.get(session.subscription_data.priceId)!.recurring
      .interval,
    "year",
  );

  const result = await stripeMock.completeCheckout(sessionId);
  assert.deepEqual(
    delivered.map((d) => [d.type, d.status]),
    [
      ["checkout.session.completed", 200],
      ["customer.subscription.created", 200],
      ["invoice.paid", 200],
    ],
  );
  const period = result.subscription.items.data[0];
  assert.ok(
    period.current_period_end - period.current_period_start >= 365 * 86400 - 1,
    "a yearly period",
  );
  const worker = elevated("worker", { tenantId: user.tenantId, role: "owner" });
  const read = async () =>
    (
      await db.tenant(worker, (tx) =>
        tx.query("SELECT * FROM domain_orders WHERE id=$1", [orderId]),
      )
    )[0];
  assert.equal((await read()).status, "paid");
  assert.equal((await read()).stripe_subscription_id, result.subscription.id);
  const step = async () => {
    await db.tenant(worker, (tx) =>
      tx.query(
        "UPDATE domain_orders SET next_attempt_at=now(),lease_until=NULL WHERE id=$1",
        [orderId],
      ),
    );
    await processWebAddressOrder(db, user.tenantId, orderId, deps);
    return read();
  };
  for (const expected of ["owned", "dns", "active"])
    assert.equal((await step()).status, expected);
  // Billing moves to 30 days before expiry through a trial end without proration.
  const aligned = await step();
  const sub = stripeMock.subscriptions.get(result.subscription.id)!;
  assert.equal(sub.status, "trialing");
  assert.equal(
    sub.trial_end,
    Math.floor((Date.parse(aligned.expires_at) - 30 * 86400000) / 1000),
  );
  assert.equal(sub.items.data[0].current_period_end, sub.trial_end);
  // The renewal invoice at that date renews the domain for a year.
  const expiry = Date.parse(aligned.expires_at);
  // (The alignment's own subscription.updated event is delivered 25 ms
  // later and may land after the renewal's invoice.paid.)
  const paidBefore = delivered.filter((d) => d.type === "invoice.paid").length;
  await stripeMock.renew(result.subscription.id);
  const paid = delivered.filter((d) => d.type === "invoice.paid");
  assert.equal(paid.length, paidBefore + 1);
  assert.equal(paid.at(-1)!.status, 200);
  assert.equal((await read()).renewal_status, "paid");
  const renewed = await step();
  assert.equal(renewed.renewal_status, "renewed");
  assert.ok(Date.parse(renewed.expires_at) > expiry + 360 * 86400000);
  // A failed renewal payment is a signed event too.
  const failed = await stripeMock.renew(result.subscription.id, { fail: true });
  assert.ok(failed.deliveries.every((d: any) => d.status === 200));
  assert.equal((await read()).billing_status, "past_due");
  // At expiry the domain lapses, but while Stripe still retries the renewal
  // invoice (past_due) the subscription is kept, so a late payment renews it.
  await db.tenant(worker, (tx) =>
    tx.query(
      "UPDATE domain_orders SET expires_at=now()-interval '1 minute' WHERE id=$1",
      [orderId],
    ),
  );
  const lapsed = await step();
  assert.equal(lapsed.status, "expired");
  assert.ok(lapsed.next_attempt_at, "looked at again during the hold");
  assert.equal(
    stripeMock.subscriptions.get(result.subscription.id)!.status,
    "past_due",
  );
  // After the hold the subscription is cancelled at Stripe.
  await db.tenant(worker, (tx) =>
    tx.query(
      "UPDATE domain_orders SET expires_at=now()-interval '21 days' WHERE id=$1",
      [orderId],
    ),
  );
  const ended = await step();
  assert.equal(ended.status, "expired");
  assert.equal(ended.billing_status, "canceled");
  assert.equal(
    stripeMock.subscriptions.get(result.subscription.id)!.status,
    "canceled",
  );
  // No member subscription was created from any of these events.
  const [members] = await db.tenant(worker, (tx) =>
    tx.query("SELECT count(*)::int AS n FROM subscriptions"),
  );
  assert.equal(members.n, 0);
  assert.equal(namecheap.commands("domains.create").length, 1);
  assert.equal(namecheap.commands("domains.renew").length, 1);
});
