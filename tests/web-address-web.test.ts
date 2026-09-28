// Web address screens (apps/web/components/web-address.tsx): the trainer's
// address, domain search and order progress, and the operator view, rendered
// from API-shaped state. The routes and CSS checks follow the other web tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DomainSearch,
  OrderCard,
  WebAddressCenter,
  agreementKey,
  type WebAddressState,
} from "../apps/web/components/web-address.tsx";
import { WebAddressOperations } from "../apps/web/components/web-address-operations.tsx";

const state: WebAddressState = {
  slug: "layla",
  published: true,
  path: "/coach/layla",
  subdomain: {
    enabled: true,
    eligible: true,
    host: "layla.trainsyou.com",
    url: "https://layla.trainsyou.com",
    live: true,
  },
  slugChanges: { used: 1, limit: 3, redirectDays: 90 },
  redirects: [{ slug: "layla-old", until: "2026-12-27T00:00:00.000Z" }],
  purchases: {
    enabled: true,
    endings: ["com", "fit", "fitness"],
    testEnvironment: true,
    priceCapMinor: 10000,
  },
  orders: [
    {
      id: "o1",
      hostname: "laylastrength.com",
      status: "dns",
      statusLabel: "Waiting for DNS and the security certificate",
      firstYearPriceMinor: 1999,
      renewalPriceMinor: 2499,
      currency: "USD",
      expiresAt: "2027-09-28T00:00:00.000Z",
      liveAt: null,
      renewalEnabled: true,
      renewalStatus: null,
      billingStatus: "active",
      nextRenewalChargeAt: "2027-08-29T00:00:00.000Z",
      progress: [
        { step: "paid", at: "2026-09-28T10:00:00Z" },
        { step: "registered", at: "2026-09-28T10:01:00Z" },
        { step: "dns", at: "2026-09-28T10:02:00Z" },
      ],
      needsReview: false,
    },
  ],
};

test("the trainer sees the automatic subdomain, redirects, slug limits and the search", () => {
  const html = renderToStaticMarkup(
    createElement(WebAddressCenter, {
      initial: state,
      manual: createElement("p", null, "manual-flow"),
    }),
  );
  assert.match(html, /layla\.trainsyou\.com/);
  assert.match(html, />Live</);
  assert.match(html, /layla-old \(until 2026-12-27\)/);
  assert.match(html, /1 of 3 changes used/);
  assert.match(html, /Test environment: no real domain is registered/);
  assert.match(html, /\.com \.fit \.fitness/);
  assert.match(html, /Only names up to USD\s100\.00 a year are shown/);
  assert.match(
    html,
    /manual-flow/,
    "the manual flow for an owned domain stays available",
  );
  // Trainers see domain prices in USD (owner decision, 28 September 2026).
  assert.match(html, /in US dollars/);
  assert.doesNotMatch(html, /AED/);
});

test("a taken name shows as taken; the available endings are listed with both USD prices", () => {
  const html = renderToStaticMarkup(
    createElement(DomainSearch, {
      busy: false,
      testEnvironment: false,
      endings: ["com", "fit", "fitness"],
      priceCapMinor: 10000,
      subdomainHost: "layla.trainsyou.com",
      onError: () => {},
      initialAnswer: {
        requested: { domain: "athena.com", status: "taken" },
        results: [
          {
            domain: "athena.fit",
            premium: false,
            firstYearPriceMinor: 1499,
            renewalPriceMinor: 4499,
          },
          {
            domain: "athena.fitness",
            premium: true,
            firstYearPriceMinor: 4999,
            renewalPriceMinor: 4999,
          },
        ],
        incomplete: true,
      },
    }),
  );
  assert.match(
    html,
    /athena\.com<\/span> <span class="badge red">Taken<\/span>/,
  );
  assert.match(html, /This name is taken\./);
  // The domain is written once, in its left-to-right span.
  assert.equal(
    (html.match(/athena\.com/g) ?? []).length,
    2,
    "badge row and summary",
  );
  // An announcement region that is always present, with a summary.
  assert.match(
    html,
    /role="status" aria-live="polite">athena\.com is taken\. 2 names available\.</,
  );
  assert.match(html, /aria-label="Choose athena\.fit"/);
  assert.match(html, /Available on other endings/);
  assert.match(
    html,
    /athena\.fit<\/span>.*First year USD\s14\.99 · renews at\s+USD\s44\.99 per year/s,
  );
  assert.match(html, /Premium name/);
  assert.match(html, /Some endings could not be checked right now/);
  assert.equal((html.match(/>Choose</g) ?? []).length, 2);
  // Nothing to offer: a clear message.
  const none = renderToStaticMarkup(
    createElement(DomainSearch, {
      busy: false,
      testEnvironment: false,
      endings: ["com"],
      priceCapMinor: 10000,
      subdomainHost: null,
      onError: () => {},
      initialAnswer: {
        requested: { domain: "zeus.com", status: "not_offered" },
        results: [],
        incomplete: false,
      },
    }),
  );
  assert.match(none, /This name cannot be bought here\./);
  assert.match(
    none,
    /No available name for this search up to USD\s100\.00 a year/,
  );
  // A name that could not be checked: "Not checked", and no "try another
  // name" while the answer is incomplete.
  const unchecked = renderToStaticMarkup(
    createElement(DomainSearch, {
      busy: false,
      testEnvironment: false,
      endings: ["com"],
      priceCapMinor: 10000,
      subdomainHost: null,
      onError: () => {},
      initialAnswer: {
        requested: { domain: "athena.com", status: "unknown" },
        results: [],
        incomplete: true,
      },
    }),
  );
  assert.match(unchecked, /<span class="badge amber">Not checked<\/span>/);
  assert.match(unchecked, /This name could not be checked right now\./);
  assert.doesNotMatch(
    unchecked,
    /No available name|Try another name|Not available/,
  );
  assert.equal(
    (unchecked.match(/search again in a minute/gi) ?? []).length,
    2,
    "the visible note and the announcement",
  );
});

test("the agreement tick belongs to one name at its two prices; nothing carries over", () => {
  const com = {
    domain: "athena.com",
    premium: false,
    firstYearPriceMinor: 1999,
    renewalPriceMinor: 2499,
  };
  const render = (chosen: typeof com, agreedTo: string | null) =>
    renderToStaticMarkup(
      createElement(DomainSearch, {
        busy: false,
        testEnvironment: false,
        endings: ["com", "fitness"],
        priceCapMinor: 10000,
        subdomainHost: null,
        onError: () => {},
        initialAnswer: {
          requested: { domain: "athena.com", status: "available" },
          results: [com],
          incomplete: false,
        },
        initialChosen: chosen,
        initialAgreedTo: agreedTo,
      }),
    );
  const box = (html: string) => html.match(/<input type="checkbox"[^>]*>/)![0];
  const ticked = render(com, agreementKey(com));
  assert.match(box(ticked), /checked=""/);
  assert.doesNotMatch(ticked, /<button disabled="">Pay with card/);
  // Another name, or the same name at new prices (PRICE_CHANGED), starts
  // unticked and cannot be paid until the trainer agrees again.
  for (const other of [
    {
      ...com,
      domain: "athena.fitness",
      firstYearPriceMinor: 999,
      renewalPriceMinor: 6499,
    },
    { ...com, renewalPriceMinor: 2999 },
  ]) {
    const html = render(other, agreementKey(com));
    assert.doesNotMatch(box(html), /checked/);
    assert.match(html, /<button disabled="">Pay with card/);
    assert.notEqual(agreementKey(other), agreementKey(com));
  }
  // The confirmation can take focus (Choose moves there on a phone).
  assert.match(ticked, /<form tabindex="-1" aria-label="Confirm athena\.com"/i);
});

test("an order placed before USD pricing keeps its AED price on its card", () => {
  const html = renderToStaticMarkup(
    createElement(OrderCard, {
      order: {
        ...state.orders[0],
        firstYearPriceMinor: 8400,
        renewalPriceMinor: 8400,
        currency: "AED",
      },
      busy: false,
      run: async () => {},
    }),
  );
  assert.match(
    html,
    /First year AED\s84\.00 · renews at\s+AED\s84\.00 per year/,
  );
});

test("order progress marks the reached steps and the next yearly charge", () => {
  const html = renderToStaticMarkup(
    createElement(OrderCard, {
      order: state.orders[0],
      busy: false,
      run: async () => {},
    }),
  );
  for (const step of ["Paid", "Registered", "DNS set up"])
    assert.match(html, new RegExp(`data-done="true">${step}<`));
  for (const step of ["Security certificate", "Live"])
    assert.match(html, new RegExp(`data-done="false">${step}<`));
  assert.match(html, /Next yearly charge on 2027-08-29/);
  assert.match(html, /Turn off yearly renewal/);
  const review = renderToStaticMarkup(
    createElement(OrderCard, {
      order: { ...state.orders[0], needsReview: true, status: "purchasing" },
      busy: false,
      run: async () => {},
    }),
  );
  assert.match(review, /The platform team is checking this step/);
  const checkout = renderToStaticMarkup(
    createElement(OrderCard, {
      order: { ...state.orders[0], status: "checkout", progress: [] },
      busy: false,
      run: async () => {},
    }),
  );
  assert.match(checkout, /Continue to payment/);
  assert.doesNotMatch(checkout, /Turn off yearly renewal/);
});

test("purchases switched off hide the search but keep the address and manual flow", () => {
  const html = renderToStaticMarkup(
    createElement(WebAddressCenter, {
      initial: {
        ...state,
        purchases: { ...state.purchases, enabled: false },
        orders: [],
      },
    }),
  );
  assert.match(html, /Buying a domain here is not available yet/);
  assert.doesNotMatch(html, /Domain name/);
});

test("the operator view shows attention, registrar calls and the manual fallbacks", () => {
  const html = renderToStaticMarkup(
    createElement(WebAddressOperations, {
      initial: {
        root: "trainsyou.com",
        registrar: "namecheap",
        testEnvironment: true,
        purchasesEnabled: true,
        attention: 1,
        orders: [
          {
            id: "o2",
            hostname: "omar-coach.com",
            tenant_name: "Coach Omar",
            status: "purchasing",
            attention: null,
            needsReconciliation: true,
            costAlert:
              "The registrar charged USD 46.18 for the renewal, more than the USD 24.99 the trainer pays.",
            operations: [
              {
                id: "op1",
                intent_key: "register:o2:1",
                status: "unknown",
                cost_usd: null,
                created_at: "2026-09-28T10:00:00Z",
              },
            ],
          },
        ],
      },
      prices: {
        registrar: "namecheap",
        testEnvironment: true,
        endings: [
          {
            tld: "com",
            suggested: true,
            state: "offered",
            fetchedAt: "2026-09-28T10:00:00Z",
            registerUsd: "11.4800",
            renewUsd: "18.6800",
            firstYearPriceMinor: 1999,
            renewalPriceMinor: 2499,
            firstYearMarginMinor: 851,
            renewalMarginMinor: 631,
          },
          {
            tld: "coach",
            suggested: true,
            state: "over_cap",
            fetchedAt: "2026-09-28T10:00:00Z",
            registerUsd: "12.1800",
            renewUsd: "96.1800",
            firstYearPriceMinor: 1999,
            renewalPriceMinor: 10499,
            firstYearMarginMinor: 781,
            renewalMarginMinor: 881,
          },
          {
            tld: "ae",
            suggested: true,
            state: "not_offered",
            fetchedAt: "2026-09-28T10:00:00Z",
            reason: "Namecheap has no one-year price for .ae",
          },
        ],
      },
    }),
  );
  // Operators see which suggested endings are hidden or not sold, and the
  // margin left before Stripe's fees; they can ask for prices again.
  assert.match(html, /Hidden: over the price cap/);
  assert.match(
    html,
    /Not sold by the registrar&#x27;s API: Namecheap has no one-year price for \.ae/,
  );
  assert.match(html, /USD\s8\.51 \/ USD\s6\.31/);
  assert.match(html, /Refresh prices now/);
  assert.match(html, /charged USD 46\.18 for the renewal/);
  assert.match(html, /\*\.trainsyou\.com/);
  assert.match(html, /test environment/);
  assert.match(html, /A registrar attempt awaits reconciliation/);
  assert.match(html, /Registrar: Namecheap/, "operators see the registrar");
  assert.match(html, /register:o2:1/);
  for (const action of ["Reconcile now", "Retry step", "Refund and close"])
    assert.match(html, new RegExp(action));
});

test("the trainer's domain page uses the web address panel; its stylesheet is loaded", () => {
  const center = readFileSync(
    new URL("../apps/web/components/integration-center.tsx", import.meta.url),
    "utf8",
  );
  assert.match(center, /<WebAddressCenter manual=\{<DomainCenter \/>\} \/>/);
  assert.match(center, /<WebAddressOperations \/>/);
  const layout = readFileSync(
    new URL("../apps/web/app/layout.tsx", import.meta.url),
    "utf8",
  );
  assert.match(layout, /import "\.\/web-address\.css";/);
});
