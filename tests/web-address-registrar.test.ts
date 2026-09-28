// Registrar adapters (packages/providers/src/registrar.ts) against the
// Namecheap XML double and recorded response shapes, the generic JSON
// adapter against the registrar double, prices and the Super admin check.
// No network: every request goes through the fixture transport.
import { test } from "node:test";
import assert from "node:assert/strict";
import { withIntegrationFixtureTransport } from "../packages/providers/src/integrations.ts";
import {
  GenericRegistrar,
  NAMECHEAP_EXTENDED_ATTRIBUTE_TLDS,
  NamecheapRegistrar,
  OneOhOneRegistrar,
  RegistrarError,
  canBuyPremium,
  namecheapHostFields,
  parseXml,
  premiumCostUsd,
  registrarDate,
  registrarFromConfig,
  xmlChild,
} from "../packages/providers/src/registrar.ts";
import {
  testIntegration,
  validateIntegrationValues,
  integrationCapability,
  READ_ONLY_CHECK_BEFORE_APPROVAL,
} from "../packages/providers/src/configuration.ts";
import { trainerDomainPrices } from "../packages/domain/src/web-address.ts";
import { NamecheapMock } from "./e2e/mocks/namecheap.ts";
import { RegistrarMock } from "./e2e/mocks/registrar.ts";

const tls = { key: "unused", cert: "unused" };
const account = {
  apiUser: "trainsyou",
  apiKey: "nc-fixture-key-0123456789",
  username: "trainsyou",
  clientIp: "1.2.3.4",
};
const registrant = {
  firstName: "Platform",
  lastName: "Owner",
  organization: "TrainsYou FZ-LLC",
  address1: "1 Fixture Street",
  city: "Dubai",
  stateProvince: "Dubai",
  postalCode: "00000",
  country: "AE",
  phone: "+971.501234567",
  email: "domains@trainsyou.test",
};
const adapter = (overrides: Partial<typeof account> = {}) =>
  new NamecheapRegistrar({ ...account, ...overrides, sandbox: true });
function withMock<T>(mock: NamecheapMock, fn: () => Promise<T>) {
  return withIntegrationFixtureTransport(mock.fetch, fn);
}

test("the XML reader handles Namecheap envelopes, namespaces, entities and refuses document types", () => {
  const root = parseXml(
    `<?xml version="1.0" encoding="utf-8"?>\n<ApiResponse Status="OK" xmlns="http://api.namecheap.com/xml.response"><!-- c --><Errors /><CommandResponse Type="x"><nc:Item nc:Name="a&amp;b" Other='q&quot;'>Text &lt;1&gt; &#65;&#x42;<![CDATA[<raw>]]></nc:Item></CommandResponse></ApiResponse>`,
  );
  assert.equal(root.name, "ApiResponse");
  assert.equal(root.attributes.Status, "OK");
  const item = xmlChild(xmlChild(root, "CommandResponse"), "Item")!;
  assert.equal(item.attributes.Name, "a&b");
  assert.equal(item.attributes.Other, 'q"');
  assert.equal(item.text, "Text <1> AB<raw>");
  assert.throws(() => parseXml('<!DOCTYPE x [<!ENTITY e "boom">]><x>&e;</x>'));
  assert.throws(() => parseXml("<a><b></a>"));
  assert.throws(() => parseXml("<a></a><b></b>"));
  assert.throws(() => parseXml("<a"));
});

test("Namecheap dates and money are read exactly", () => {
  assert.equal(registrarDate("02/15/2027"), "2027-02-15T00:00:00.000Z");
  assert.equal(
    registrarDate("11/12/2027 07:12:13"),
    "2027-11-12T07:12:13.000Z",
  );
  assert.equal(registrarDate(""), undefined);
  // The double's .com (10.28 + 0.18 and 15.88 + 0.18 USD) at the owner's
  // rule: USD 19.99 the first year, USD 24.99 a renewal.
  assert.deepEqual(trainerDomainPrices({ registerUsd: "10.4600", renewUsd: "16.0600" }), {
    firstYearCents: 1999,
    renewalCents: 2499,
    offered: true,
  });
});

test("Namecheap: balance, availability, prices, purchase, info, list, renew", async () => {
  const mock = new NamecheapMock(tls, account);
  mock.taken.add("taken.com");
  mock.premium.set("gold.com", "2500.00");
  await withMock(mock, async () => {
    const nc = adapter();
    assert.equal(nc.endpoint, "https://api.sandbox.namecheap.com/xml.response");
    assert.deepEqual(await nc.balance(), {
      currency: "USD",
      available: "250.00",
    });
    const checks = await nc.check(["layla.com", "taken.com", "gold.com"]);
    assert.deepEqual(
      checks.map((c) => [c.domain, c.available, c.premium]),
      [
        ["layla.com", true, false],
        ["taken.com", false, false],
        ["gold.com", true, true],
      ],
    );
    assert.equal(checks[2].premiumRegisterUsd, "2500.00");
    assert.equal(checks[2].premiumRenewUsd, "2500.00");
    assert.deepEqual(premiumCostUsd(checks[2]), {
      registerUsd: "2500.1800",
      renewUsd: "2500.1800",
    });
    assert.equal(premiumCostUsd(checks[0]), null, "a regular name has no premium cost");
    // Price + ICANN fee (spelled "YourAdditonalCost" by Namecheap).
    assert.deepEqual(await nc.pricing("com"), {
      tld: "com",
      registerUsd: "10.4600",
      renewUsd: "16.0600",
    });
    const created = await nc.register({
      domain: "layla.com",
      years: 1,
      registrant,
    });
    assert.equal(created.registered, true);
    assert.equal(created.chargedUsd, "10.4600");
    const sent = mock.commands("domains.create")[0].params;
    assert.equal(sent.AddFreeWhoisguard, "yes", "free WHOIS privacy requested");
    assert.equal(sent.WGEnabled, "yes");
    for (const role of ["Registrant", "Tech", "Admin", "AuxBilling"])
      assert.equal(sent[role + "OrganizationName"], "TrainsYou FZ-LLC");
    assert.ok(!("ApiKey" in sent), "the mock log never keeps the key");
    const info = await nc.info("layla.com");
    assert.equal(info.whoisPrivacy, true);
    assert.equal(info.usingRegistrarDns, true);
    assert.ok(Date.parse(info.expiresAt!) > Date.now() + 360 * 86400000);
    assert.deepEqual(
      (await nc.list("layla.com")).map((d) => d.domain),
      ["layla.com"],
    );
    assert.deepEqual(await nc.list("other.com"), []);
    const renewed = await nc.renew("layla.com", 1);
    assert.equal(renewed.renewed, true);
    assert.ok(
      Date.parse(renewed.expiresAt!) >
        Date.parse(info.expiresAt!) + 360 * 86400000,
    );
    assert.equal(renewed.chargedUsd, "16.0600");
  });
});

test("Namecheap: setHosts sends the complete record set in one call and replaces parking records", async () => {
  const mock = new NamecheapMock(tls, account);
  const published: any[] = [];
  mock.onHosts = (domain, hosts) => published.push({ domain, hosts });
  await withMock(mock, async () => {
    const nc = adapter();
    await nc.register({ domain: "layla.com", years: 1, registrant });
    assert.deepEqual(
      (await nc.getHosts("layla.com")).map((h) => h.type),
      ["URL", "CNAME"],
      "a new domain starts with parking records",
    );
    const hosts = [
      { name: "@", type: "A" as const, address: "203.0.113.7", ttl: 1800 },
      { name: "www", type: "A" as const, address: "203.0.113.7", ttl: 1800 },
    ];
    assert.deepEqual(namecheapHostFields("layla.com", hosts), {
      SLD: "layla",
      TLD: "com",
      HostName1: "@",
      RecordType1: "A",
      Address1: "203.0.113.7",
      TTL1: "1800",
      HostName2: "www",
      RecordType2: "A",
      Address2: "203.0.113.7",
      TTL2: "1800",
    });
    await nc.setHosts("layla.com", hosts);
    assert.equal(mock.commands("domains.dns.setHosts").length, 1);
    assert.deepEqual(await nc.getHosts("layla.com"), hosts);
    assert.deepEqual(published, [{ domain: "layla.com", hosts }]);
  });
});

test("Namecheap: refusals are definitive, lost answers are unknown, credentials and IP are checked", async () => {
  const mock = new NamecheapMock(tls, account);
  mock.taken.add("taken.com");
  await withMock(mock, async () => {
    const refused = await adapter()
      .register({ domain: "taken.com", years: 1, registrant })
      .catch((e) => e);
    assert.ok(refused instanceof RegistrarError);
    assert.equal(refused.outcome, "definitive");
    assert.equal(refused.code, "3019166");
    mock.loseNextResponse("domains.create");
    const lost = await adapter()
      .register({ domain: "layla.com", years: 1, registrant })
      .catch((e) => e);
    assert.equal(lost.outcome, "unknown");
    assert.ok(
      mock.registrations.has("layla.com"),
      "the lost request was applied",
    );
    const ip = await adapter({ clientIp: "198.51.100.9" })
      .balance()
      .catch((e) => e);
    assert.equal(ip.outcome, "definitive");
    assert.match(ip.message, /Invalid request IP/);
    const key = await adapter({ apiKey: "wrong" })
      .balance()
      .catch((e) => e);
    assert.equal(key.code, "1011102");
    const missing = await adapter()
      .info("nothere.com")
      .catch((e) => e);
    assert.equal(missing.outcome, "definitive");
  });
  const unreachable = await withIntegrationFixtureTransport(
    async () => {
      throw new Error("ECONNRESET");
    },
    () =>
      adapter()
        .balance()
        .catch((e) => e),
  );
  assert.equal(unreachable.outcome, "unknown");
  const garbage = await withIntegrationFixtureTransport(
    async () => new Response("<html>proxy</html>", { status: 200 }),
    () =>
      adapter()
        .balance()
        .catch((e) => e),
  );
  assert.equal(garbage.outcome, "unknown");
});

test("the Super admin connection check reads the balance only and reports the environment", async () => {
  const mock = new NamecheapMock(tls, account);
  const fields = {
    WEB_ADDRESS_REGISTRAR: "namecheap",
    NAMECHEAP_API_USER: account.apiUser,
    NAMECHEAP_API_KEY: account.apiKey,
    NAMECHEAP_USERNAME: account.username,
    NAMECHEAP_CLIENT_IP: account.clientIp,
    NAMECHEAP_SANDBOX: "true",
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
  const result = await withMock(mock, () =>
    testIntegration("web_addresses", fields),
  );
  assert.equal(result.status, "verified", result.message);
  assert.deepEqual(result.details, {
    environment: "sandbox",
    currency: "USD",
    availableBalance: "250.00",
    // No Stripe key in this check: its mode cannot be compared.
    paymentMode: "unknown",
    modeMismatch: false,
  });
  assert.deepEqual(
    mock.calls.map((c) => c.command),
    ["users.getBalances"],
    "no purchase or lookup is sent by the check",
  );
  const denied = await withMock(mock, () =>
    testIntegration("web_addresses", {
      ...fields,
      NAMECHEAP_CLIENT_IP: "5.6.7.8",
    }),
  );
  assert.equal(denied.status, "failed");
  assert.match(denied.message, /whitelisted/);
  // Live Stripe keys with the Namecheap test environment: shown as refused.
  const mismatched = await withMock(mock, () =>
    testIntegration("web_addresses", {
      ...fields,
      STRIPE_SECRET_KEY: "sk_live_fixture_only",
    }),
  );
  assert.equal(mismatched.details?.modeMismatch, true);
  assert.equal(mismatched.details?.paymentMode, "live");
  assert.match(mismatched.message, /Purchases are refused/);
  // Before the registrant details are entered the read-only check still runs,
  // so the API access and the whitelist can be proven first.
  const noRegistrant = Object.fromEntries(
    Object.entries(fields).filter(([key]) => !key.startsWith("WEB_ADDRESS_REGISTRANT_")),
  );
  mock.calls.length = 0;
  const early = await withMock(mock, () => testIntegration("web_addresses", noRegistrant));
  assert.equal(early.status, "verified", early.message);
  assert.match(early.message, /Purchases also need the registrant details/);
  assert.deepEqual(mock.calls.map((c) => c.command), ["users.getBalances"]);
  assert.equal(READ_ONLY_CHECK_BEFORE_APPROVAL.has("web_addresses"), true);
  assert.equal(integrationCapability("web_addresses", noRegistrant)!.approved, false);
  // Approval: configured is not enough; purchases need the explicit switch.
  assert.deepEqual(integrationCapability("web_addresses", fields), {
    configured: true,
    approved: false,
  });
  assert.equal(
    integrationCapability("web_addresses", {
      ...fields,
      WEB_ADDRESS_PURCHASES_ENABLED: "true",
    })!.approved,
    true,
  );
  assert.throws(() =>
    validateIntegrationValues("web_addresses", {
      NAMECHEAP_CLIENT_IP: "10.0.0.5",
    }),
  );
  assert.throws(() =>
    validateIntegrationValues("web_addresses", {
      WEB_ADDRESS_REGISTRANT_PHONE: "0501234567",
    }),
  );
  // The price rule (owner decision, 28 September 2026): whole cents only.
  for (const bad of [
    { WEB_ADDRESS_PRICE_STEP_USD: "0" },
    { WEB_ADDRESS_PRICE_STEP_USD: "4.999" },
    { WEB_ADDRESS_PRICE_ENDING_USD: "abc" },
    { WEB_ADDRESS_PRICE_CAP_USD: "0" },
    { WEB_ADDRESS_PRICE_CAP_USD: "5000" },
    { WEB_ADDRESS_TLDS: Array.from({ length: 21 }, (_, i) => "e" + "x".repeat(i + 1)).join(",") },
  ])
    assert.throws(() => validateIntegrationValues("web_addresses", bad), JSON.stringify(bad));
  assert.doesNotThrow(() =>
    validateIntegrationValues("web_addresses", {
      WEB_ADDRESS_PRICE_STEP_USD: "5.00",
      WEB_ADDRESS_PRICE_ENDING_USD: "4.99",
      WEB_ADDRESS_PRICE_CAP_USD: "100",
      WEB_ADDRESS_TLDS: "com,fit,fitness,coach,training,ae,club,pro,app,me,co.uk",
    }),
  );
  // The AED margin and exchange rate settings are gone: prices are in USD.
  assert.throws(
    () => validateIntegrationValues("web_addresses", { WEB_ADDRESS_MARGIN_AED: "25" }),
    /unknown setting/,
  );
  assert.throws(
    () => validateIntegrationValues("web_addresses", { WEB_ADDRESS_USD_TO_AED: "3.6725" }),
    /unknown setting/,
  );
  // Anything but an explicit "false" uses the test environment.
  const production = registrarFromConfig({
    ...fields,
    NAMECHEAP_SANDBOX: "false",
  });
  assert.equal(
    (production as NamecheapRegistrar).endpoint,
    "https://api.namecheap.com/xml.response",
  );
  assert.throws(
    () => registrarFromConfig({ WEB_ADDRESS_REGISTRAR: "namecheap" }),
    /Namecheap needs/,
  );
});

test("the generic JSON adapter implements the same interface against the registrar double", async () => {
  const mock = new RegistrarMock(tls, "reg_fixture_key");
  const sent: string[] = [];
  const transport = async (url: string, init: RequestInit = {}) => {
    sent.push(`${init.method ?? "GET"} ${new URL(url).pathname}`);
    const result = await mock.server.inject({
      method: init.method ?? "GET",
      url,
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      body: typeof init.body === "string" ? init.body : undefined,
    });
    return new Response(result.body, {
      status: result.status,
      headers: result.headers,
    });
  };
  await withIntegrationFixtureTransport(transport, async () => {
    const generic = new GenericRegistrar(
      "https://registrar.example.test",
      "reg_fixture_key",
    );
    mock.premium.set("gold.com", { register: "60.00", renew: "60.00" });
    const checked = await generic.check(["layla.com", "gold.com", "layla.xyz"]);
    assert.deepEqual(
      checked.map((a) => [a.domain, a.available, a.premium]),
      [
        ["layla.com", true, false],
        ["gold.com", true, true],
        ["layla.xyz", false, false],
      ],
    );
    assert.deepEqual(premiumCostUsd(checked[1]), { registerUsd: "60.0000", renewUsd: "60.0000" });
    assert.deepEqual(sent, ["POST /v1/domains/check"], "one batched availability request");
    assert.deepEqual(await generic.pricing("com"), {
      tld: "com",
      registerUsd: "11.00",
      renewUsd: "15.00",
    });
    assert.equal(
      (await generic.register({ domain: "layla.com", years: 1, registrant }))
        .registered,
      true,
    );
    const refused = await generic
      .register({ domain: "layla.com", years: 1, registrant })
      .catch((e) => e);
    assert.equal(
      refused.outcome,
      "definitive",
      "a 409 is a definitive refusal",
    );
    assert.equal((await generic.list("layla.com")).length, 1);
    await generic.setHosts("layla.com", [
      { name: "@", type: "A", address: "203.0.113.7", ttl: 1800 },
    ]);
    assert.deepEqual(await generic.getHosts("layla.com"), [
      { name: "@", type: "A", address: "203.0.113.7", ttl: 1800 },
    ]);
    const before = (await generic.info("layla.com")).expiresAt!;
    const renewed = await generic.renew("layla.com", 1);
    assert.ok(Date.parse(renewed.expiresAt!) > Date.parse(before));
    assert.deepEqual(await generic.balance(), {
      currency: "USD",
      available: "200.00",
    });
    const wrong = await new GenericRegistrar(
      "https://registrar.example.test",
      "bad",
    )
      .balance()
      .catch((e) => e);
    assert.equal(wrong.outcome, "definitive");
  });
});

test("payment mode and registrar environment rules; early-access fees are read", async () => {
  const { paymentModeProblem, stripeKeyMode, registrarSandboxSetting } =
    await import("../packages/providers/src/registrar.ts");
  assert.equal(stripeKeyMode({ STRIPE_SECRET_KEY: "sk_live_x" }), "live");
  assert.equal(stripeKeyMode({ STRIPE_SECRET_KEY: "rk_test_x" }), "test");
  assert.equal(stripeKeyMode({ STRIPE_SECRET_KEY: "whatever" }), null);
  assert.equal(
    registrarSandboxSetting({}),
    true,
    "test environment by default",
  );
  assert.equal(registrarSandboxSetting({ NAMECHEAP_SANDBOX: "false" }), false);
  assert.equal(paymentModeProblem(false, true), null);
  assert.equal(paymentModeProblem(true, false), null);
  assert.match(String(paymentModeProblem(true, true)), /live Stripe payment/);
  assert.match(String(paymentModeProblem(false, false)), /real domain/);
  assert.match(String(paymentModeProblem(null, true)), /unknown/);
  const mock = new NamecheapMock(tls, account);
  mock.earlyAccess.set("launch.com", "95.00");
  const registrar = new NamecheapRegistrar(
    { ...account, sandbox: true },
    { transport: mock.fetch },
  );
  const [eap, plain] = await registrar.check(["launch.com", "plain-coach.com"]);
  assert.equal(eap.earlyAccessFeeUsd, "95.00");
  assert.equal(plain.earlyAccessFeeUsd, undefined);
});

test("Namecheap: batched checks, unsupported and document endings, premium purchase and renewal at the checked price", async () => {
  const mock = new NamecheapMock(tls, account);
  mock.premium.set("gold.com", { register: "55.00", renew: "60.00" });
  mock.taken.add("athena.com");
  const nc = new NamecheapRegistrar({ ...account, sandbox: true }, { transport: mock.fetch });
  // 60 names: two domains.check requests (Namecheap takes 50 at most).
  const names = Array.from({ length: 60 }, (_, i) => `athena${i}.com`);
  const many = await nc.check(names);
  assert.equal(many.length, 60);
  assert.deepEqual(
    mock.commands("domains.check").map((c) => c.params.DomainList.split(",").length),
    [50, 10],
  );
  // One request for the name on every suggested ending the registrar sells.
  // Live Namecheap (28 September 2026) refuses the whole request when one
  // name is under an ending it does not sell (.ae), so the search only
  // checks names whose ending has a price.
  const endings = ["com", "fit", "fitness", "coach", "training", "club", "pro", "app", "me"];
  const suggestions = await nc.check(endings.map((e) => "athena." + e));
  assert.deepEqual(
    suggestions.filter((a) => !a.available).map((a) => a.domain),
    ["athena.com"],
  );
  const whole = await nc.check(["athena.com", "athena.ae"]).catch((e) => e);
  assert.ok(whole instanceof RegistrarError);
  assert.deepEqual([whole.outcome, whole.code], ["definitive", "2030280"]);
  assert.match(whole.message, /athena\.ae/);
  // Endings needing registrant documents are refused before any request.
  const before = mock.calls.length;
  for (const tld of ["us", "co.uk", "eu"]) {
    assert.ok(NAMECHEAP_EXTENDED_ATTRIBUTE_TLDS.has(tld));
    const refused = await nc.pricing(tld).catch((e) => e);
    assert.ok(refused instanceof RegistrarError);
    assert.equal(refused.outcome, "definitive");
    assert.equal(refused.code, "REQUIREMENTS");
  }
  assert.equal(mock.calls.length, before, "no request for a document ending");
  // An ending the double does not sell is a definitive refusal (not offered).
  const unsupported = await nc.pricing("ae").catch((e) => e);
  assert.equal(unsupported.outcome, "definitive");
  assert.deepEqual(await nc.pricing("fit"), { tld: "fit", registerUsd: "5.1600", renewUsd: "35.1600" });
  // A premium name: its own registration and renewal prices from the check.
  const [gold] = await nc.check(["gold.com"]);
  assert.deepEqual(
    [gold.premium, gold.premiumRegisterUsd, gold.premiumRenewUsd, gold.icannFeeUsd],
    [true, "55.00", "60.00", "0.18"],
  );
  assert.deepEqual(premiumCostUsd(gold), { registerUsd: "55.1800", renewUsd: "60.1800" });
  // USD 55.18 → 64.99 first year, 60.18 → 69.99 renewal: within USD 100.
  assert.deepEqual(trainerDomainPrices(premiumCostUsd(gold)!), {
    firstYearCents: 6499,
    renewalCents: 6999,
    offered: true,
  });
  // Bought only as a premium name at the checked price.
  const regular = await nc.register({ domain: "gold.com", years: 1, registrant }).catch((e) => e);
  assert.equal(regular.outcome, "definitive", "a premium name is never bought at the regular price");
  const wrong = await nc
    .register({ domain: "gold.com", years: 1, registrant, premiumPriceUsd: "50.00" })
    .catch((e) => e);
  assert.equal(wrong.outcome, "definitive", "nor at another premium price");
  const bought = await nc.register({ domain: "gold.com", years: 1, registrant, premiumPriceUsd: "55.00" });
  assert.equal(bought.registered, true);
  assert.equal(bought.chargedUsd, "55.1800");
  const create = mock.commands("domains.create").at(-1)!.params;
  assert.deepEqual([create.IsPremiumDomain, create.PremiumPrice], ["true", "55.00"]);
  const renewedRegular = await nc.renew("gold.com", 1).catch((e) => e);
  assert.equal(renewedRegular.outcome, "definitive", "a premium renewal names its price");
  const renewed = await nc.renew("gold.com", 1, { premiumPriceUsd: "60.00" });
  assert.equal(renewed.renewed, true);
  assert.equal(renewed.chargedUsd, "60.1800");
  // A regular name never claims to be premium.
  await nc.register({ domain: "plain-coach.com", years: 1, registrant });
  assert.equal(mock.commands("domains.create").at(-1)!.params.IsPremiumDomain, undefined);
  // 101domain cannot pass a premium price on: its premium names are never offered.
  assert.equal(canBuyPremium(new OneOhOneRegistrar("k")), false);
  assert.equal(canBuyPremium(nc), true);
});
