// Domain suggestions and USD prices (owner decision, 28 September 2026;
// docs/features/web-addresses.md "Prices in USD and suggestions"): a
// trainer's name is checked on every suggested ending in one registrar
// request, priced from cached per-ending registrar prices with the owner's
// rule, without taken names and without anything over USD 100 for the first
// year or a renewal; premium names only within the cap, at their premium
// price. Also the ledger's currency guard: USD journals are for web
// addresses only and never touch the trainer's payable balance. PGlite with
// the Namecheap double through a test transport; nothing leaves the process.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, elevated, type Database } from "@trainer/db";
import { withRuntimeConfig } from "../packages/providers/src/configuration.ts";
import { NamecheapRegistrar } from "../packages/providers/src/registrar.ts";
import {
  resetRegistrarBudget,
  searchDomains,
  spendRegistrarBudget,
} from "../apps/api/src/web-addresses.ts";
import {
  NOT_OFFERED_TTL_MS,
  PRICE_TTL_MS,
  fetchPrice,
  readPrices,
  refreshSuggestedPrices,
} from "../apps/api/src/web-address-prices.ts";
import { journal } from "../apps/api/src/finance.ts";
import { NamecheapMock } from "./e2e/mocks/namecheap.ts";

const account = {
  apiUser: "trainsyou",
  apiKey: "nc-fixture-key-0123456789",
  username: "trainsyou",
  clientIp: "1.2.3.4",
};
const REGISTRAR_NAME = /namecheap|101domain/i;
let db: Database;
let mock: NamecheapMock;
let registrar: NamecheapRegistrar;
const settings = {
  PLATFORM_ROOT_DOMAIN: "trainsyou.com",
  WEB_ADDRESS_PURCHASES_ENABLED: "true",
  WEB_ADDRESS_REGISTRAR: "namecheap",
  NAMECHEAP_API_USER: account.apiUser,
  NAMECHEAP_API_KEY: account.apiKey,
  NAMECHEAP_USERNAME: account.username,
  NAMECHEAP_CLIENT_IP: account.clientIp,
  NAMECHEAP_SANDBOX: "true",
  // .ae is no longer suggested (owner decision, 28 September 2026); an
  // operator may still sell it when typed. The double does not sell it.
  WEB_ADDRESS_EXTRA_TLDS: "ae",
};
const run = <T>(fn: () => Promise<T>, extra: Record<string, string> = {}) =>
  withRuntimeConfig({ ...settings, ...extra }, fn);
const search = (q: string, extra: Record<string, string> = {}) =>
  run(() => searchDomains(q, { registrar, db }), extra);
const pricingCalls = () => mock.commands("users.getPricing").length;
const checkCalls = () => mock.commands("domains.check").length;

before(async () => {
  db = await createDatabase({ memory: true });
  mock = new NamecheapMock({ key: "unused", cert: "unused" }, account);
  registrar = new NamecheapRegistrar(
    { ...account, sandbox: true },
    { transport: mock.fetch },
  );
});
after(async () => {
  await db?.close();
});

test("a taken name: the other endings are offered in the configured order, one availability request, nothing over USD 100", async () => {
  resetRegistrarBudget();
  mock.taken.add("athena.com");
  // .coach renews at USD 105.18 here: over the cap, so hidden.
  mock.prices.coach = { register: "9.98", renew: "105.00" };
  // A premium name within the cap is offered at its premium price; one over
  // the cap is not.
  mock.premium.set("athena.club", { register: "40.00", renew: "40.00" });
  mock.premium.set("athena.app", "450.00");
  // Right after start-up no ending is priced yet: the search prices what the
  // call budget allows (keeping its availability request) and says the
  // answer is incomplete instead of failing.
  const cold = await search("athena");
  assert.equal(cold.incomplete, true);
  assert.equal(
    pricingCalls() + checkCalls(),
    8,
    "within the per-minute budget",
  );
  assert.equal(checkCalls(), 1);
  // The worker warms the suggested endings (four a run).
  for (let i = 0; i < 3; i++)
    await run(() => refreshSuggestedPrices(db, { registrar }));
  resetRegistrarBudget();
  const checks = checkCalls();
  const answer = await search("athena");
  assert.equal(checkCalls() - checks, 1, "one domains.check for every ending");
  assert.equal(
    mock.commands("domains.check").at(-1)!.params.DomainList,
    "athena.com,athena.fit,athena.fitness,athena.coach,athena.training,athena.club,athena.pro,athena.app,athena.me",
    "the name on every suggested ending (.ae is not suggested)",
  );
  assert.deepEqual(answer.requested, { domain: "athena.com", status: "taken" });
  assert.deepEqual(
    answer.results.map((r) => [
      r.domain,
      r.firstYearPriceMinor,
      r.renewalPriceMinor,
      r.premium,
      r.currency,
    ]),
    [
      ["athena.fit", 1499, 4499, false, "USD"],
      // Renewal cost 39.16: 44.99 would keep 3.34 after Stripe's fees, so
      // the minimum margin moves it to 49.99.
      ["athena.fitness", 1499, 4999, false, "USD"],
      ["athena.training", 1499, 4499, false, "USD"],
      // Premium USD 40.00 + 0.18 ICANN fee → 49.99 both years.
      ["athena.club", 4999, 4999, true, "USD"],
      ["athena.pro", 999, 2999, false, "USD"],
      ["athena.me", 1499, 2999, false, "USD"],
    ],
  );
  assert.equal(answer.incomplete, false);
  assert.equal(answer.priceCapMinor, 10000);
  for (const result of answer.results) {
    assert.ok(
      result.firstYearPriceMinor <= 10000 && result.renewalPriceMinor <= 10000,
    );
    assert.equal(
      result.firstYearPriceMinor % 100,
      99,
      "every price ends in .99",
    );
  }
  // No registrar name, cost or rule reaches the trainer.
  const text = JSON.stringify(answer);
  assert.doesNotMatch(text, REGISTRAR_NAME);
  assert.doesNotMatch(
    text,
    /registerUsd|renewUsd|cost|stepCents|endingCents|10\.46|16\.06/,
  );
});

test("a typed ending is bought only when an operator allows it; the brand and deeper names are never priced", async () => {
  resetRegistrarBudget();
  mock.prices.io = { register: "34.98", renew: "44.98" };
  // Not suggested and not allowed: not offered, and the registrar is never
  // asked about .io (no price call, no stored row).
  const pricesBefore = pricingCalls();
  const refused = await search("athena.io", { WEB_ADDRESS_TLDS: "com,fit" });
  assert.deepEqual(refused.requested, {
    domain: "athena.io",
    status: "not_offered",
  });
  assert.deepEqual(
    refused.results.map((r) => r.domain),
    ["athena.fit"],
  );
  assert.equal(pricingCalls(), pricesBefore, "no price asked for .io");
  assert.ok(
    !mock
      .commands("domains.check")
      .at(-1)!
      .params.DomainList.includes("athena.io"),
  );
  assert.equal((await readPrices(db, registrar, ["io", "zzqq"])).size, 0);
  const odd = await search("athena.zzqq");
  assert.equal(odd.requested.status, "not_offered");
  assert.equal((await readPrices(db, registrar, ["zzqq"])).size, 0);
  // A deeper name is refused as input (no suggestions for "shop"), with a
  // message that says what is allowed; nothing is priced.
  for (const deep of [
    "shop.athena.com",
    "coach.athena.com",
    "athena.com.evil",
  ]) {
    const error = await search(deep).catch((e) => e);
    assert.equal(error.code, "DOMAIN_SEARCH", deep);
    assert.match(error.message, /English letters, digits and hyphens/);
  }
  assert.equal(pricingCalls(), pricesBefore);
  // Allowed by the operator: checked first.
  const answer = await search("Athena.IO", {
    WEB_ADDRESS_TLDS: "com,fit",
    WEB_ADDRESS_EXTRA_TLDS: "io",
  });
  assert.deepEqual(answer.requested, {
    domain: "athena.io",
    status: "available",
  });
  assert.deepEqual(
    answer.results.map((r) => [
      r.domain,
      r.firstYearPriceMinor,
      r.renewalPriceMinor,
    ]),
    [
      // 34.98 + 0.18 → 44.99; 44.98 + 0.18 → 54.99.
      ["athena.io", 4499, 5499],
      ["athena.fit", 1499, 4499],
    ],
  );
  // A typed suggested ending is asked about first, without repeats.
  const fit = await search("athena.fit", { WEB_ADDRESS_TLDS: "com,fit" });
  assert.deepEqual(fit.requested, {
    domain: "athena.fit",
    status: "available",
  });
  assert.deepEqual(
    fit.results.map((r) => r.domain),
    ["athena.fit"],
  );
  // Over the cap, an unsold ending and the platform's own name.
  const coach = await search("athena.coach");
  assert.deepEqual(coach.requested, {
    domain: "athena.coach",
    status: "not_offered",
  });
  assert.ok(!coach.results.some((r) => r.domain === "athena.coach"));
  const ae = await search("athena.ae");
  assert.deepEqual(ae.requested, {
    domain: "athena.ae",
    status: "not_offered",
  });
  // The platform's brand is never offered on any ending (it would look
  // official), nor inside a longer name, nor a protected name an operator
  // adds; the registrar is not asked.
  const checksBefore = checkCalls();
  for (const [q, domain] of [
    ["trainsyou", "trainsyou.com"],
    ["trainsyou.fit", "trainsyou.fit"],
    ["trains-you.app", "trains-you.app"],
    ["trainsyou-login", "trainsyou-login.com"],
    ["gymmembership.me", "gymmembership.me"],
  ]) {
    const own = await search(q, {
      WEB_ADDRESS_PROTECTED_LABELS: "gymmembership",
    });
    assert.deepEqual(own.requested, { domain, status: "not_offered" }, q);
    assert.deepEqual(own.results, [], q);
  }
  assert.equal(checkCalls(), checksBefore, "no availability request");
  const under = await search("layla.trainsyou.com").catch((e) => e);
  assert.equal(
    under.code,
    "DOMAIN_NAME",
    "addresses under the platform domain are automatic",
  );
});

test("ending prices are cached for 24 hours in registrar_prices; a stale one is refreshed, a missing one fetched on demand", async () => {
  resetRegistrarBudget();
  const cached = await readPrices(db, registrar, ["com", "fit", "ae", "coach"]);
  assert.deepEqual([...cached.values()].map((p) => [p.tld, p.kind]).sort(), [
    ["ae", "not_offered"],
    ["coach", "price"],
    ["com", "price"],
    ["fit", "price"],
  ]);
  const com = cached.get("com")!;
  assert.deepEqual(
    com.kind === "price" && [com.registerUsd, com.renewUsd],
    ["10.4600", "16.0600"],
    "the registrar's cost, the ICANN fee included",
  );
  // A new search on another name costs one availability request, no price call.
  const prices = pricingCalls();
  const checks = checkCalls();
  await search("hercules");
  assert.equal(pricingCalls(), prices, "prices come from the cache");
  assert.equal(checkCalls(), checks + 1);
  // After 24 hours the price is asked again (the registrar changed it).
  mock.prices.com = { register: "11.30", renew: "18.50" };
  await db.system((tx) =>
    tx.query(
      "UPDATE registrar_prices SET fetched_at=now()-make_interval(secs=>$1) WHERE tld='com'",
      [PRICE_TTL_MS / 1000 + 60],
    ),
  );
  resetRegistrarBudget();
  const fresh = await search("hercules");
  assert.equal(
    pricingCalls(),
    prices + 1,
    "only the stale ending is asked again",
  );
  assert.deepEqual(
    fresh.results.find((r) => r.domain === "hercules.com"),
    {
      domain: "hercules.com",
      available: true,
      premium: false,
      // 11.48 → 19.99 and 18.68 → 24.99: Namecheap's .com on 28 September 2026.
      firstYearPriceMinor: 1999,
      renewalPriceMinor: 2499,
      currency: "USD",
      renewsYearly: true,
    },
  );
});

test("with the call budget used up, stale prices are still shown and missing ones make the answer incomplete", async () => {
  resetRegistrarBudget();
  await db.system(async (tx) => {
    await tx.query("UPDATE registrar_prices SET fetched_at=now()");
    await tx.query(
      "UPDATE registrar_prices SET fetched_at=now()-interval '2 days' WHERE tld='fit'",
    );
  });
  mock.prices.newend = { register: "5.00", renew: "5.00" };
  // One call left of the interactive budget (8 a minute): the availability
  // request keeps it, so nothing can be priced.
  spendRegistrarBudget(7);
  const prices = pricingCalls(),
    checks = checkCalls();
  const answer = await search("zeus", { WEB_ADDRESS_TLDS: "com,fit,newend" });
  assert.equal(pricingCalls(), prices, "no price call fits");
  assert.equal(checkCalls(), checks + 1, "the availability request is kept");
  assert.equal(answer.incomplete, true, "the new ending could not be priced");
  assert.deepEqual(
    answer.results.map((r) => [r.domain, r.firstYearPriceMinor]),
    [
      ["zeus.com", 1999],
      // Two days old, still shown (every checkout asks again).
      ["zeus.fit", 1499],
    ],
  );
  // With nothing left the search says it is busy instead of guessing.
  spendRegistrarBudget(1);
  const busy = await search("hera", { WEB_ADDRESS_TLDS: "com,fit" }).catch(
    (e) => e,
  );
  assert.equal(busy.code, "REGISTRAR_BUSY");
  assert.equal(busy.statusCode, 503);
  resetRegistrarBudget();
  delete mock.prices.newend;
});

test("a refused registrar request (client address, key, throttling) is never cached as not offered", async () => {
  resetRegistrarBudget();
  await run(async () => {
    for (let i = 0; i < 3; i++) await refreshSuggestedPrices(db, { registrar });
  });
  // Every price a day old: due for the worker and stale for searches.
  await db.system((tx) =>
    tx.query(
      "UPDATE registrar_prices SET fetched_at=now()-interval '21 hours' WHERE not_offered IS NULL",
    ),
  );
  const before = await readPrices(db, registrar, ["com", "fit", "me"]);
  // The same account from an address Namecheap has not whitelisted
  // (1011150), with a wrong key (1011102), and throttled (500000).
  const wrongIp = new NamecheapRegistrar(
    { ...account, clientIp: "9.9.9.9", sandbox: true },
    { transport: mock.fetch },
  );
  const wrongKey = new NamecheapRegistrar(
    { ...account, apiKey: "nc-wrong-key-0000000000", sandbox: true },
    { transport: mock.fetch },
  );
  for (const bad of [wrongIp, wrongKey])
    for (let i = 0; i < 3; i++)
      assert.equal(
        await run(() => refreshSuggestedPrices(db, { registrar: bad })),
        0,
      );
  mock.refuseNext("users.getPricing", "Too many requests", "500000", 4);
  assert.equal(await run(() => refreshSuggestedPrices(db, { registrar })), 0);
  const direct = await fetchPrice(db, wrongIp, "com").catch((e) => e);
  assert.equal(direct.code, "1011150", "thrown, not stored");
  // Nothing stored changed: still prices, still a day old.
  const after = await readPrices(db, registrar, ["com", "fit", "me"]);
  for (const tld of ["com", "fit", "me"]) {
    assert.equal(after.get(tld)?.kind, "price", tld);
    assert.equal(after.get(tld)?.fetchedAt, before.get(tld)?.fetchedAt, tld);
  }
  // The search during the outage (the same address problem) fails loudly
  // instead of answering that nothing can be bought ...
  const outage = await run(() =>
    searchDomains("athena", { registrar: wrongIp, db }),
  ).catch((e) => e);
  assert.equal(outage.code, "REGISTRAR_UNAVAILABLE");
  // ... and once the address is fixed every ending is offered again.
  resetRegistrarBudget();
  const fixed = await search("athena");
  assert.equal(fixed.requested.status, "taken");
  assert.ok(fixed.results.length >= 5, "the other endings are offered");
  resetRegistrarBudget();
});

test("an ending the registrar does not sell is trusted as not offered for an hour only", async () => {
  resetRegistrarBudget();
  const ae = await fetchPrice(db, registrar, "ae");
  assert.equal(ae.kind, "not_offered");
  // Refreshed by the worker after an hour, not a day.
  await db.system((tx) =>
    tx.query(
      "UPDATE registrar_prices SET fetched_at=now()-make_interval(secs=>$1) WHERE tld='ae'",
      [NOT_OFFERED_TTL_MS / 1000 + 60],
    ),
  );
  mock.prices.ae = { register: "30.00", renew: "30.00" };
  await run(async () => {
    for (let i = 0; i < 3; i++) await refreshSuggestedPrices(db, { registrar });
  });
  assert.equal(
    (await readPrices(db, registrar, ["ae"])).get("ae")?.kind,
    "price",
  );
  delete mock.prices.ae;
  await fetchPrice(db, registrar, "ae");
  resetRegistrarBudget();
});

test("a name the registrar could not check is shown as not checked, never as taken", async () => {
  resetRegistrarBudget();
  mock.checkErrors.add("athena.fit");
  mock.checkErrors.add("layla.com");
  const answer = await search("athena");
  assert.ok(!answer.results.some((r) => r.domain === "athena.fit"));
  assert.equal(answer.incomplete, true);
  const typed = await search("layla");
  assert.deepEqual(typed.requested, { domain: "layla.com", status: "unknown" });
  assert.equal(typed.incomplete, true);
  mock.checkErrors.clear();
  resetRegistrarBudget();
});

test("the worker keeps the suggested endings' prices warm, four a run", async () => {
  resetRegistrarBudget();
  // Every stored price a month old (the runtime role may not delete them).
  await db.system((tx) =>
    tx.query("UPDATE registrar_prices SET fetched_at=now()-interval '30 days'"),
  );
  const before = pricingCalls();
  const refreshed = await run(() => refreshSuggestedPrices(db, { registrar }));
  assert.equal(refreshed, 4);
  assert.equal(pricingCalls() - before, 4);
  // Purchases off: nothing is asked.
  assert.equal(
    await run(() => refreshSuggestedPrices(db, { registrar }), {
      WEB_ADDRESS_PURCHASES_ENABLED: "false",
    }),
    0,
  );
  for (let i = 0; i < 3; i++)
    await run(() => refreshSuggestedPrices(db, { registrar }));
  const warm = await readPrices(db, registrar, [
    "com",
    "fit",
    "fitness",
    "coach",
    "training",
    "ae",
    "club",
    "pro",
    "app",
    "me",
  ]);
  assert.equal(
    warm.size,
    10,
    "every ending that can be bought is cached, .ae (typed only) as not offered",
  );
  // Fresh prices are not asked again.
  const done = pricingCalls();
  assert.equal(await run(() => refreshSuggestedPrices(db, { registrar })), 0);
  assert.equal(pricingCalls(), done);
});

test("registrar prices are platform rows: no tenant actor reads or writes them", async () => {
  const tenantId = randomUUID();
  await db.system((tx) =>
    tx.query("INSERT INTO tenants(id,slug,name) VALUES($1,$2,$3)", [
      tenantId,
      "iso-" + tenantId.slice(0, 8),
      "Isolation fixture",
    ]),
  );
  const owner = elevated("worker", { tenantId, role: "owner" });
  await assert.rejects(
    db.tenant(owner, (tx) => tx.query("SELECT * FROM registrar_prices")),
    /permission denied/,
  );
  await assert.rejects(
    db.tenant(owner, (tx) =>
      tx.query(
        "INSERT INTO registrar_prices(registrar,sandbox,tld,register_usd,renew_usd) VALUES('namecheap',true,'xyz',1,1)",
      ),
    ),
    /permission denied/,
  );
});

test("USD journals are for web addresses only and never touch the trainer's payable balance", async () => {
  const tenantId = randomUUID();
  await db.system((tx) =>
    tx.query("INSERT INTO tenants(id,slug,name) VALUES($1,$2,$3)", [
      tenantId,
      "ledger-" + tenantId.slice(0, 8),
      "Ledger fixture",
    ]),
  );
  const actor = elevated("provider-callback", { tenantId, role: "owner" });
  // A web address payment in USD posts.
  await db.tenant(actor, (tx) =>
    journal(
      tx,
      actor,
      "web-address-invoice:in_usd_ok",
      "Fixture",
      [
        { account: "web_address_receivable", amount: 1999 },
        { account: "web_address_revenue", amount: -1999 },
      ],
      {},
      { currency: "USD" },
    ),
  );
  // USD into the trainer's payable balance is refused at commit.
  await assert.rejects(
    db.tenant(actor, (tx) =>
      journal(
        tx,
        actor,
        "web-address-invoice:in_usd_payable",
        "Fixture",
        [
          { account: "web_address_receivable", amount: 1999 },
          { account: "trainer_payable", amount: -1999 },
        ],
        {},
        { currency: "USD" },
      ),
    ),
    /cannot post to trainer_payable/,
  );
  // Member payments and every other journal stay AED.
  await assert.rejects(
    db.tenant(actor, (tx) =>
      journal(
        tx,
        actor,
        "stripe-invoice:in_usd_member",
        "Fixture",
        [
          { account: "stripe_receivable", amount: 1999 },
          { account: "trainer_payable", amount: -1999 },
        ],
        {},
        { currency: "USD" },
      ),
    ),
    /journals_currency_check/,
  );
  await assert.rejects(
    db.tenant(actor, (tx) =>
      journal(
        tx,
        actor,
        "web-address-invoice:bad",
        "Fixture",
        [
          { account: "a", amount: 1 },
          { account: "b", amount: -1 },
        ],
        {},
        { currency: "usd" },
      ),
    ),
    /Invalid journal currency/,
  );
  const [row] = await db.tenant(actor, (tx) =>
    tx.query(
      "SELECT currency,count(*)::int AS n FROM journals GROUP BY currency",
    ),
  );
  assert.deepEqual(row, { currency: "USD", n: 1 });
});
