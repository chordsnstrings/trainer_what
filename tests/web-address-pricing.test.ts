// Trainer domain prices and search plans (packages/domain/src/web-address.ts),
// owner decision of 28 September 2026: the registrar's USD cost rounded up to
// the next multiple of USD 5, plus USD 4.99, separately for the first year and
// the renewal; names over USD 100 for either are hidden; trainers pay in USD.
// Pure functions: integer cents only.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PRICE_RULE,
  DEFAULT_SUGGESTED_TLDS,
  domainSearchPlan,
  exactUsdCents,
  markupPriceCents,
  priceRuleFromSettings,
  splitRegistrableDomain,
  suggestedTlds,
  trainerDomainPrices,
  usdCents,
  usdToAedMinor,
  withinPriceCap,
} from "../packages/domain/src/web-address.ts";

test("the owner's rule: ceil(cost / 5) × 5 + 4.99 in cents", () => {
  const cases: Array<[number, number]> = [
    [1, 499 + 500],
    [499, 999],
    [500, 999],
    [501, 1499],
    [1000, 1499],
    [1001, 1999],
    [1100, 1999],
    [1148, 1999],
    [1500, 1999],
    [1501, 2499],
    [1868, 2499],
    [2000, 2499],
    [2001, 2999],
    [2500, 2999],
    [9500, 9999],
    [9501, 10499],
  ];
  for (const [cost, price] of cases)
    assert.equal(markupPriceCents(cost), price, `cost ${cost}`);
  // Every cost from 11.00 to 15.00 is 19.99; 15.01 to 20.00 is 24.99.
  for (let cost = 1100; cost <= 1500; cost++)
    assert.equal(markupPriceCents(cost), 1999, `cost ${cost}`);
  for (let cost = 1501; cost <= 2000; cost++)
    assert.equal(markupPriceCents(cost), 2499, `cost ${cost}`);
  for (let cost = 2001; cost <= 2500; cost++)
    assert.equal(markupPriceCents(cost), 2999, `cost ${cost}`);
  // Always ends in .99, is never below the cost plus the ending and never
  // more than a step above it.
  for (let cost = 1; cost <= 20000; cost += 7) {
    const price = markupPriceCents(cost);
    assert.equal(price % 100, 99);
    assert.ok(price >= cost + 499 && price < cost + 500 + 499, `cost ${cost}`);
  }
});

test("costs that are not a positive whole number of cents are refused", () => {
  for (const bad of [0, -1, -1500, Number.NaN, Infinity, 12.5, 2 ** 60])
    assert.throws(() => markupPriceCents(bad), RangeError, String(bad));
  for (const rule of [
    { stepCents: 0, endingCents: 499 },
    { stepCents: -500, endingCents: 499 },
    { stepCents: 500, endingCents: -1 },
    { stepCents: 5.5, endingCents: 499 },
  ])
    assert.throws(() => markupPriceCents(1148, rule), RangeError);
  // Another step and ending chosen by an operator.
  assert.equal(
    markupPriceCents(1148, { stepCents: 1000, endingCents: 0 }),
    2000,
  );
  assert.equal(
    markupPriceCents(1148, { stepCents: 100, endingCents: 99 }),
    1299,
  );
});

test("registrar USD text becomes whole cents, rounded up, never through floats", () => {
  assert.equal(usdCents("11.48"), 1148);
  assert.equal(usdCents("11.4800"), 1148);
  assert.equal(usdCents("16.0600"), 1606);
  assert.equal(usdCents("15"), 1500);
  assert.equal(usdCents("15.0001"), 1501, "a fraction of a cent rounds up");
  assert.equal(usdCents("0.29"), 29);
  assert.equal(usdCents(18.68), 1868);
  assert.equal(usdCents("0.1") + usdCents("0.2"), 30, "no float drift");
  for (const bad of ["", "abc", "-1", "1e3", "1,000.00", "NaN", "12.", " "])
    assert.throws(() => usdCents(bad), RangeError, bad);
  assert.throws(() => usdCents(Number.NaN), RangeError);
  assert.equal(exactUsdCents("4.99"), 499);
  assert.equal(exactUsdCents("5"), 500);
  assert.equal(exactUsdCents("100.00"), 10000);
  assert.throws(() => exactUsdCents("4.999"), RangeError);
});

test("first-year and renewal prices, the USD 100 cap and premium names", () => {
  // Namecheap .com on 28 September 2026 (registration and renewal including
  // the ICANN fee): 11.48 → 19.99 and 18.68 → 24.99.
  assert.deepEqual(
    trainerDomainPrices({ registerUsd: "11.48", renewUsd: "18.68" }),
    {
      firstYearCents: 1999,
      renewalCents: 2499,
      offered: true,
    },
  );
  // Exactly USD 100.00 is not over the cap; one cent more is.
  assert.equal(withinPriceCap(10000), true);
  assert.equal(withinPriceCap(10001), false);
  assert.equal(withinPriceCap(Number.NaN), false);
  assert.deepEqual(
    trainerDomainPrices({ registerUsd: "95.00", renewUsd: "12.00" }),
    {
      firstYearCents: 9999,
      renewalCents: 1999,
      offered: true,
    },
  );
  // A cheap first year with an expensive renewal is hidden (either price).
  assert.equal(
    trainerDomainPrices({ registerUsd: "2.98", renewUsd: "95.01" }).offered,
    false,
  );
  assert.equal(
    trainerDomainPrices({ registerUsd: "95.01", renewUsd: "2.98" }).offered,
    false,
  );
  // A premium name at its premium cost.
  assert.deepEqual(
    trainerDomainPrices({ registerUsd: "60.20", renewUsd: "60.20" }),
    {
      firstYearCents: 6999,
      renewalCents: 6999,
      offered: true,
    },
  );
  assert.equal(
    trainerDomainPrices({ registerUsd: "2500.00", renewUsd: "12.00" }).offered,
    false,
  );
  assert.throws(
    () => trainerDomainPrices({ registerUsd: "0", renewUsd: "12" }),
    RangeError,
  );
});

test("operator settings for the rule, with the owner's defaults", () => {
  assert.deepEqual(priceRuleFromSettings({}), DEFAULT_PRICE_RULE);
  assert.deepEqual(DEFAULT_PRICE_RULE, {
    stepCents: 500,
    endingCents: 499,
    capCents: 10000,
  });
  assert.deepEqual(
    priceRuleFromSettings({ step: "10", ending: "9.99", cap: "150" }),
    {
      stepCents: 1000,
      endingCents: 999,
      capCents: 15000,
    },
  );
  assert.deepEqual(
    priceRuleFromSettings({ step: " ", ending: "", cap: null }),
    DEFAULT_PRICE_RULE,
  );
  for (const bad of [
    { step: "0" },
    { step: "abc" },
    { ending: "4.999" },
    { cap: "0" },
    { step: "-5" },
  ])
    assert.throws(
      () => priceRuleFromSettings(bad),
      RangeError,
      JSON.stringify(bad),
    );
});

test("search plans: the typed name first, then the suggested endings in order", () => {
  assert.deepEqual(DEFAULT_SUGGESTED_TLDS, [
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
  const tlds = suggestedTlds(undefined);
  assert.deepEqual(tlds, DEFAULT_SUGGESTED_TLDS);
  assert.deepEqual(domainSearchPlan("athena", tlds), {
    label: "athena",
    requested: "athena.com",
    names: tlds.map((t) => "athena." + t),
  });
  // A typed suggested ending is asked about first; nothing is repeated.
  const fit = domainSearchPlan("Athena.FIT", tlds)!;
  assert.equal(fit.requested, "athena.fit");
  assert.deepEqual(fit.names.slice(0, 3), [
    "athena.fit",
    "athena.com",
    "athena.fitness",
  ]);
  assert.equal(fit.names.length, tlds.length);
  // A typed ending outside the list is checked too, first.
  const io = domainSearchPlan("https://www.athena.io/about", tlds)!;
  assert.equal(io.requested, "athena.io");
  assert.deepEqual(io.names, ["athena.io", ...tlds.map((t) => "athena." + t)]);
  assert.equal(
    domainSearchPlan("layla strength", ["com", "fit"])!.requested,
    "layla-strength.com",
  );
  // No name variations (athenafit.com) are made up.
  assert.ok(
    !domainSearchPlan("athena", tlds)!.names.some(
      (n) => !n.startsWith("athena."),
    ),
  );
  for (const bad of [
    "",
    "   ",
    "-athena",
    "athena-",
    "xn--abc.com",
    "ath ena.com",
    "a".repeat(81),
    ".com",
  ])
    assert.equal(domainSearchPlan(bad, tlds), null, bad);
  assert.equal(domainSearchPlan("athena", []), null, "no ending to ask about");
  assert.deepEqual(splitRegistrableDomain("layla.co.uk"), ["layla", "co.uk"]);
  assert.deepEqual(splitRegistrableDomain("layla.co.uk", ["co.uk"]), [
    "layla",
    "co.uk",
  ]);
  assert.equal(splitRegistrableDomain("layla.co.uk", ["com"]), null);
  assert.equal(splitRegistrableDomain("xn--abc.com"), null);
  assert.deepEqual(suggestedTlds("com, .FIT,bad tld,fit,co.uk"), [
    "com",
    "fit",
    "co.uk",
  ]);
  assert.equal(
    suggestedTlds(
      Array.from({ length: 30 }, (_, i) => "t" + "x".repeat(i + 1)).join(","),
    ).length,
    20,
  );
});

test("orders quoted in AED keep their own rate for the registrar cost", () => {
  assert.equal(usdToAedMinor("10.4600", "3.6725"), 3842);
  assert.equal(usdToAedMinor("0.0001", "3.6725"), 1, "costs round up");
});
