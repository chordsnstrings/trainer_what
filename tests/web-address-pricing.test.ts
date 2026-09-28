// Trainer domain prices and search plans (packages/domain/src/web-address.ts),
// owner decisions of 28 September 2026: the registrar's USD cost rounded up to
// the next multiple of USD 5, plus USD 4.99, separately for the first year and
// the renewal, then moved up one step at a time until at least USD 4 is left
// after Stripe's estimated fees (2.9% + 1% international + USD 0.28, plus 1%
// currency conversion unless the Stripe account holds USD); names over USD
// 100 for either are hidden; trainers pay in USD; .ae is not suggested.
// Pure functions: integer cents only.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PRICE_RULE,
  DEFAULT_SUGGESTED_TLDS,
  cleanDomainQuery,
  domainPrice,
  domainPriceDetails,
  domainSearchPlan,
  exactUsdCents,
  percentBasisPoints,
  renewalIncrease,
  renewalPriceNote,
  storedPriceRule,
  stripeFeeEstimate,
  isProtectedLabel,
  markupPriceCents,
  priceRuleFromSettings,
  protectedLabels,
  purchasableTlds,
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
  // 95.00 → 99.99 would leave less than nothing after Stripe's fees, so it
  // moves up to 104.99 and is hidden by the cap; 90.00 → 94.99 would keep
  // USD 0.05, so it moves to 99.99, which keeps the margin and is offered.
  assert.deepEqual(
    trainerDomainPrices({ registerUsd: "95.00", renewUsd: "12.00" }),
    {
      firstYearCents: 10499,
      renewalCents: 1999,
      offered: false,
    },
  );
  assert.deepEqual(
    trainerDomainPrices({ registerUsd: "90.00", renewUsd: "12.00" }),
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
    minMarginCents: 400,
    cardFeeBp: 290,
    internationalFeeBp: 100,
    fixedFeeCents: 28,
    conversionFeeBp: 100,
    usdBalance: false,
  });
  assert.deepEqual(
    priceRuleFromSettings({
      step: "10",
      ending: "9.99",
      cap: "150",
      minMargin: "5",
      cardPercent: "3.25",
      internationalPercent: "0",
      fixedFee: "0.30",
      conversionPercent: "2",
      usdBalance: "true",
    }),
    {
      stepCents: 1000,
      endingCents: 999,
      capCents: 15000,
      minMarginCents: 500,
      cardFeeBp: 325,
      internationalFeeBp: 0,
      fixedFeeCents: 30,
      conversionFeeBp: 200,
      usdBalance: true,
    },
  );
  assert.equal(
    priceRuleFromSettings({ usdBalance: "false" }).usdBalance,
    false,
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
    { minMargin: "-1" },
    { minMargin: "4.001" },
    { cardPercent: "15.01" },
    { cardPercent: "2.999" },
    { internationalPercent: "abc" },
    { conversionPercent: "16" },
    { fixedFee: "10.01" },
  ])
    assert.throws(
      () => priceRuleFromSettings(bad),
      RangeError,
      JSON.stringify(bad),
    );
});

test("search plans: the typed name first, then the suggested endings in order", () => {
  // Owner decision (28 September 2026): no .ae by default; an operator may
  // still list it (suggested or typed-only).
  assert.deepEqual(DEFAULT_SUGGESTED_TLDS, [
    "com",
    "fit",
    "fitness",
    "coach",
    "training",
    "club",
    "pro",
    "app",
    "me",
  ]);
  const tlds = suggestedTlds(undefined);
  assert.deepEqual(tlds, DEFAULT_SUGGESTED_TLDS);
  assert.ok(!tlds.includes("ae"));
  assert.ok(suggestedTlds("com,ae").includes("ae"), "operators can add .ae");
  assert.ok(purchasableTlds(tlds, "ae").includes("ae"));
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
  // A typed ending outside the endings that can be bought is asked about
  // (answered as not offered) but never checked; an operator-allowed one is
  // checked first.
  const io = domainSearchPlan("https://www.athena.io/about", tlds)!;
  assert.equal(io.requested, "athena.io");
  assert.deepEqual(
    io.names,
    tlds.map((t) => "athena." + t),
  );
  const allowed = purchasableTlds(tlds, "io, .CO");
  assert.deepEqual(allowed.slice(-2), ["io", "co"]);
  assert.deepEqual(domainSearchPlan("athena.io", tlds, allowed)!.names, [
    "athena.io",
    ...tlds.map((t) => "athena." + t),
  ]);
  // Spaces and underscores become hyphens with or without an ending; an
  // Instagram handle, a port and a double hyphen outside places 3-4 are fine.
  assert.equal(
    domainSearchPlan("layla strength", ["com", "fit"])!.requested,
    "layla-strength.com",
  );
  for (const [typed, requested] of [
    ["layla strength.com", "layla-strength.com"],
    ["athena_fit.com", "athena-fit.com"],
    ["@athena", "athena.com"],
    ["athena.com:443", "athena.com"],
    ["http://athena.com:8080/x", "athena.com"],
    ["layla--fit", "layla--fit.com"],
  ])
    assert.equal(domainSearchPlan(typed, tlds)?.requested, requested, typed);
  assert.equal(cleanDomainQuery(" @Athena.COM. "), "athena.com");
  // A deeper name is not a registrable name: no subdomain becomes a label
  // and nothing is priced for it; an allowed two-part ending still works.
  for (const deep of [
    "shop.athena.com",
    "coach.athena.com",
    "athena.fit.com",
    "athena.com.evil",
  ])
    assert.equal(domainSearchPlan(deep, tlds, allowed), null, deep);
  assert.equal(
    domainSearchPlan("layla.co.uk", ["com"], ["com", "co.uk"])!.requested,
    "layla.co.uk",
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
    "ab--cd",
    "athéna",
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

test("the platform's brand is protected on every ending", () => {
  const list = protectedLabels("gymmembership, Trains-You ,x", "trainsyou.com");
  assert.deepEqual(list, ["trainsyou", "gymmembership"]);
  assert.ok(protectedLabels("", "coachly.app").includes("coachly"));
  // A deeper root protects its registrable label, not its first one.
  const deeper = protectedLabels("", "app.coachly.com");
  assert.ok(deeper.includes("coachly") && !deeper.includes("app"));
  for (const label of [
    "trainsyou",
    "trains-you",
    "trainsyou-login",
    "mytrainsyou",
    "gymmembership",
  ])
    assert.ok(isProtectedLabel(label, list), label);
  for (const label of ["athena", "trains", "layla-strength", "you"])
    assert.ok(!isProtectedLabel(label, list), label);
  // A short protected name is matched only exactly.
  assert.ok(isProtectedLabel("ty", ["ty"]));
  assert.ok(!isProtectedLabel("tyson", ["ty"]));
});

test("orders quoted in AED keep their own rate for the registrar cost", () => {
  assert.equal(usdToAedMinor("10.4600", "3.6725"), 3842);
  assert.equal(usdToAedMinor("0.0001", "3.6725"), 1, "costs round up");
});

test("minimum margin of USD 4 after Stripe's estimated fees: the owner's cases", () => {
  const rule = DEFAULT_PRICE_RULE;
  // 14.90 → the rounding gives 19.99, which would keep 19.99 − 14.90 − 1.26
  // (0.78 card + 0.28 fixed + 0.20 conversion) = 3.83: one step up, 24.99.
  assert.deepEqual(domainPrice(1490, rule), {
    priceCents: 2499,
    costCents: 1490,
    cardFeeCents: 126,
    conversionFeeCents: 25,
    feesCents: 151,
    marginCents: 858,
    raisedSteps: 1,
  });
  assert.equal(19_99 - 14_90 - stripeFeeEstimate(1999, rule).totalCents, 383);
  // 11.48 → 19.99 keeps 7.25.
  assert.deepEqual(domainPrice(1148, rule), {
    priceCents: 1999,
    costCents: 1148,
    cardFeeCents: 106,
    conversionFeeCents: 20,
    feesCents: 126,
    marginCents: 725,
    raisedSteps: 0,
  });
  // Renewal 18.68 → 24.99 keeps 24.99 − 18.68 − 1.51 = 4.80: unchanged.
  assert.deepEqual(domainPrice(1868, rule), {
    priceCents: 2499,
    costCents: 1868,
    cardFeeCents: 126,
    conversionFeeCents: 25,
    feesCents: 151,
    marginCents: 480,
    raisedSteps: 0,
  });
  // .com at Namecheap (28 September 2026): 19.99 / 24.99 as before.
  assert.deepEqual(
    trainerDomainPrices({ registerUsd: "11.48", renewUsd: "18.68" }),
    { firstYearCents: 1999, renewalCents: 2499, offered: true },
  );
  // The boundary: 14.73 keeps exactly 4.00 at 19.99; one cent more does not.
  assert.equal(domainPrice(1473, rule).priceCents, 1999);
  assert.equal(domainPrice(1473, rule).marginCents, 400);
  assert.equal(domainPrice(1474, rule).priceCents, 2499);
  // With a USD balance there is no conversion fee: 14.74 stays at 19.99
  // (19.99 − 14.74 − 1.06 = 4.19), 14.90 too (4.03), 14.94 (3.99) does not.
  const usd = { ...rule, usdBalance: true };
  assert.equal(stripeFeeEstimate(1999, usd).conversionCents, 0);
  assert.equal(domainPrice(1474, usd).priceCents, 1999);
  assert.equal(domainPrice(1490, usd).priceCents, 1999);
  assert.equal(domainPrice(1490, usd).marginCents, 403);
  assert.equal(domainPrice(1494, usd).priceCents, 2499);
  // The price always keeps the minimum, always ends in .99, and is the
  // lowest step that does (checked against a plain step-by-step walk).
  for (const r of [rule, usd, { ...rule, minMarginCents: 1500 }])
    for (let cost = 1; cost <= 20000; cost += 13) {
      const got = domainPrice(cost, r);
      assert.ok(got.marginCents >= r.minMarginCents, `cost ${cost}`);
      assert.equal(got.priceCents % 100, 99);
      let walk = markupPriceCents(cost, r);
      while (
        walk - cost - stripeFeeEstimate(walk, r).totalCents <
        r.minMarginCents
      )
        walk += r.stepCents;
      assert.equal(got.priceCents, walk, `cost ${cost}`);
      assert.equal(
        got.raisedSteps,
        (walk - markupPriceCents(cost, r)) / r.stepCents,
      );
    }
  // No minimum and no fees: the owner's rounding alone.
  const plain = storedPriceRule({
    stepCents: 500,
    endingCents: 499,
    capCents: 10000,
  });
  assert.deepEqual(plain, {
    stepCents: 500,
    endingCents: 499,
    capCents: 10000,
    minMarginCents: 0,
    cardFeeBp: 0,
    internationalFeeBp: 0,
    fixedFeeCents: 0,
    conversionFeeBp: 0,
    usdBalance: false,
  });
  for (const cost of [1148, 1490, 1500, 9500])
    assert.equal(domainPrice(cost, plain).priceCents, markupPriceCents(cost));
  assert.deepEqual(storedPriceRule(DEFAULT_PRICE_RULE), DEFAULT_PRICE_RULE);
  assert.deepEqual(storedPriceRule(null).minMarginCents, 0);
});

test("Stripe fee estimate: each percentage rounded up to a whole cent", () => {
  assert.deepEqual(stripeFeeEstimate(1999, DEFAULT_PRICE_RULE), {
    cardCents: 106,
    conversionCents: 20,
    totalCents: 126,
  });
  assert.deepEqual(stripeFeeEstimate(10000, DEFAULT_PRICE_RULE), {
    cardCents: 418,
    conversionCents: 100,
    totalCents: 518,
  });
  assert.equal(percentBasisPoints("2.9"), 290);
  assert.equal(percentBasisPoints("1"), 100);
  assert.equal(percentBasisPoints("0.25"), 25);
  for (const bad of ["", "-1", "2.999", "1e2", "abc"])
    assert.throws(() => percentBasisPoints(bad), RangeError, bad);
});

test("operators see each year's fees and net margin", () => {
  const details = domainPriceDetails({
    registerUsd: "14.90",
    renewUsd: "18.68",
  });
  assert.equal(details.firstYear.priceCents, 2499);
  assert.equal(details.firstYear.raisedSteps, 1);
  assert.equal(details.renewal.priceCents, 2499);
  assert.equal(details.renewal.marginCents, 480);
  assert.equal(details.offered, true);
});

test("the renewal note: shown whenever the renewal costs more, stronger when much more", () => {
  assert.equal(renewalIncrease(2499, 2499), null);
  assert.equal(renewalIncrease(2999, 2499), null);
  assert.deepEqual(renewalIncrease(1999, 2499), {
    moreMinor: 500,
    much: false,
  });
  assert.deepEqual(renewalIncrease(999, 5499), { moreMinor: 4500, much: true });
  // USD 10 more, or half the first year more, is "much".
  assert.equal(renewalIncrease(4999, 5999)!.much, true);
  assert.equal(renewalIncrease(1000, 1500)!.much, true);
  assert.equal(renewalIncrease(4999, 5998)!.much, false);
  assert.equal(renewalPriceNote(2499, 2499), null);
  assert.equal(
    renewalPriceNote(1999, 2499),
    "Note: the yearly renewal (USD 24.99) is USD 5.00 more than the first year (USD 19.99).",
  );
  assert.equal(
    renewalPriceNote(999, 5499),
    "Note: the yearly renewal is much higher than the first year: USD 54.99 a year from the second year, USD 45.00 more than the first year's USD 9.99.",
  );
});
