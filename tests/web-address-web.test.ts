// Web address screens (apps/web/components/web-address.tsx): the trainer's
// address, domain search and order progress, and the operator view, rendered
// from API-shaped state. The routes and CSS checks follow the other web tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  OrderCard,
  WebAddressCenter,
  WebAddressOperations,
  type WebAddressState,
} from "../apps/web/components/web-address.tsx";

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
  purchases: { enabled: true, endings: ["com", "net"], testEnvironment: true },
  orders: [
    {
      id: "o1",
      hostname: "laylastrength.com",
      status: "dns",
      statusLabel: "Waiting for DNS and the security certificate",
      priceMinor: 8400,
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
  assert.match(html, /\.com \.net/);
  assert.match(
    html,
    /manual-flow/,
    "the manual flow for an owned domain stays available",
  );
  assert.match(html, /AED/);
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
    }),
  );
  assert.match(html, /\*\.trainsyou\.com/);
  assert.match(html, /test environment/);
  assert.match(html, /A registrar attempt awaits reconciliation/);
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
