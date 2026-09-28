// Owner decision (28 September 2026): the platform holds trainers' custom
// domains. The platform company is always the registrant (WHOIS privacy on),
// trainers get no self-service transfer out or authorisation code, and
// trainers and subscribers never see the registrar's name or cost: only the
// first-year and yearly renewal price in AED. This guard fails when any
// trainer, subscriber or public surface starts to name the registrar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { withRuntimeConfig } from "../packages/providers/src/configuration.ts";
import {
  registrantFromConfig,
  type Registrar,
} from "../packages/providers/src/registrar.ts";
import {
  clearWebAddressPriceCache,
  searchDomains,
  trainerOrderView,
  webAddressStripeText,
  WEB_ADDRESS_STRIPE_LABEL,
} from "../apps/api/src/web-addresses.ts";
import { trainerDomainView } from "../apps/api/src/integrations-completion.ts";
import { MESSAGE_KINDS } from "../apps/api/src/message-templates.ts";
import {
  OrderCard,
  WebAddressCenter,
  type WebAddressState,
} from "../apps/web/components/web-address.tsx";

const ROOT = new URL("..", import.meta.url).pathname;
/** Every registrar the platform can buy through. */
const REGISTRAR_NAME = /namecheap|101domain|one-?oh-?one/i;
/** Where a trainer's domain is hosted is not the trainer's business either. */
const DNS_HOST = /digitalocean|nameserver|dns[_ ]?provider|dns host/i;
/** Web files that may name the registrar: super admin operator screens only. */
const OPERATOR_ONLY_WEB_FILES = new Set([
  "apps/web/components/web-address-operations.tsx",
]);
/** Fields a trainer may receive about a domain's price or state. */
const COST_KEY = /cost|usd|margin|rate|registrar|register(ed)?Usd|wholesale/i;

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name.startsWith("."))
      continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...files(path));
    else if (/\.(tsx?|jsx?|mjs|css|html|json|md)$/.test(name)) out.push(path);
  }
  return out;
}
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
function keys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, inner]) => [
    prefix + key,
    ...keys(inner, prefix + key + "."),
  ]);
}

test("no web component or page names the registrar outside the operator-only allowlist", () => {
  const offenders = files(join(ROOT, "apps/web"))
    .map((path) => relative(ROOT, path))
    .filter((path) => !OPERATOR_ONLY_WEB_FILES.has(path))
    .filter((path) => REGISTRAR_NAME.test(read(path)));
  assert.deepEqual(offenders, [], "the registrar is named on these screens");
  for (const path of OPERATOR_ONLY_WEB_FILES) {
    // The allowlist stays honest: each file exists and is operator-only.
    assert.match(read(path), /Operator-only/);
    const importers = files(join(ROOT, "apps/web"))
      .map((p) => relative(ROOT, p))
      .filter((p) => p !== path)
      .filter((p) =>
        new RegExp(
          `from "\\./${path
            .split("/")
            .pop()!
            .replace(/\.tsx$/, "")}"`,
        ).test(read(p)),
      );
    assert.deepEqual(
      importers,
      ["apps/web/components/integration-center.tsx"],
      "only the super admin operations screen loads the operator view",
    );
    assert.match(
      read("apps/web/components/integration-center.tsx"),
      /export function IntegrationOperations\(\)[\s\S]*<WebAddressOperations \/>/,
    );
  }
});

test("trainer screens show only the first-year and renewal price, never the registrar", () => {
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
    slugChanges: { used: 0, limit: 3, redirectDays: 90 },
    redirects: [],
    purchases: { enabled: true, endings: ["com"], testEnvironment: true },
    orders: [
      {
        id: "o1",
        hostname: "laylastrength.com",
        status: "active",
        statusLabel: "Live",
        firstYearPriceMinor: 8400,
        renewalPriceMinor: 9100,
        expiresAt: "2027-09-28T00:00:00.000Z",
        liveAt: "2026-09-28T00:00:00.000Z",
        renewalEnabled: true,
        progress: [{ step: "paid", at: "2026-09-28T00:00:00.000Z" }],
        needsReview: false,
      },
    ],
  };
  const html =
    renderToStaticMarkup(createElement(WebAddressCenter, { initial: state })) +
    renderToStaticMarkup(
      createElement(OrderCard, {
        order: state.orders[0],
        busy: false,
        run: async () => {},
      }),
    );
  assert.doesNotMatch(html, REGISTRAR_NAME);
  assert.doesNotMatch(html, /registrar|USD|cost price|margin/i);
  assert.doesNotMatch(html, DNS_HOST);
  assert.match(html, /First year AED\s84\.00 · renews at AED\s91\.00 per year/);
  // The forwarding choice names only the trainer's own platform address.
  assert.match(html, /Show my site on this domain/);
  assert.match(html, /Forward to my <span[^>]*>layla\.trainsyou\.com<\/span> address/);
  // The trainer's web address component never names a DNS host.
  assert.doesNotMatch(read("apps/web/components/web-address.tsx"), DNS_HOST);
});

test("message templates never name the registrar", () => {
  assert.doesNotMatch(JSON.stringify(MESSAGE_KINDS), REGISTRAR_NAME);
  assert.doesNotMatch(
    read("apps/api/src/message-templates.ts"),
    REGISTRAR_NAME,
  );
  // The trainer's web address notices (title and body built by the worker).
  const copy = [
    ...read("apps/api/src/web-address-orders.ts").matchAll(
      /\b(?:title|body):\s*(`[^`]*`|"[^"]*")/g,
    ),
    ...read("apps/api/src/web-address-orders.ts").matchAll(
      /const body =([\s\S]*?);\n/g,
    ),
  ].map((m) => m[1]);
  assert.ok(copy.length >= 12, "the notice copy was found");
  for (const text of copy)
    assert.doesNotMatch(text, /namecheap|registrar|usd|cost/i, text);
  // A failed purchase names its reason to the trainer: fixed, neutral text.
  const reasons = [
    ...read("apps/api/src/web-address-orders.ts").matchAll(
      /failOrder\(\s*db,\s*[\w.]+,\s*\w+,\s*("[^"]*")/g,
    ),
    ...read("apps/api/src/web-addresses.ts").matchAll(
      /failOrder\(\s*db,\s*[\w.]+,\s*\w+,\s*("[^"]*")/g,
    ),
  ].map((m) => m[1]);
  assert.ok(reasons.length >= 2, "the failure reasons were found");
  for (const reason of reasons)
    assert.doesNotMatch(reason, /namecheap|registrar/i, reason);
});

test("Stripe product, description and statement wording is neutral", () => {
  const text = webAddressStripeText("laylastrength.com");
  assert.equal(WEB_ADDRESS_STRIPE_LABEL, "Custom web address — yearly");
  assert.deepEqual(text, {
    productName: "Custom web address — yearly",
    description: "Custom web address — yearly: laylastrength.com",
  });
  for (const path of [
    "apps/api/src/web-addresses.ts",
    "apps/api/src/web-address-orders.ts",
  ]) {
    const source = read(path);
    // Every Stripe-visible text field built by the web address code.
    const lines = source
      .split("\n")
      .filter((line) =>
        /statement_descriptor|product_data|description:|nickname:|custom_fields|footer:/.test(
          line,
        ),
      );
    for (const line of lines)
      assert.doesNotMatch(line, /namecheap|registrar/i, `${path}: ${line}`);
    assert.doesNotMatch(source, /statement_descriptor(_suffix)?:\s*["`]/);
  }
  assert.match(
    read("apps/api/src/web-addresses.ts"),
    /product_data: \{ name: text\.productName \}[\s\S]*description: text\.description/,
  );
});

test("search and order status answers carry no registrar name or cost field", async () => {
  const namecheapLike = {
    id: "namecheap",
    sandbox: true,
    check: async (names: string[]) =>
      names.map((domain) => ({
        domain,
        available: domain.endsWith(".com"),
        premium: false,
      })),
    pricing: async (tld: string) => ({
      tld,
      registerUsd: "10.28",
      renewUsd: "16.06",
    }),
  } as unknown as Registrar;
  clearWebAddressPriceCache();
  const results = await withRuntimeConfig(
    {
      WEB_ADDRESS_TLDS: "com,net",
      WEB_ADDRESS_USD_TO_AED: "3.6725",
      WEB_ADDRESS_MARGIN_AED: "25",
      PLATFORM_ROOT_DOMAIN: "trainsyou.com",
    },
    () => searchDomains("layla", { registrar: namecheapLike }),
  );
  clearWebAddressPriceCache();
  assert.deepEqual(
    results.map((r) => [r.domain, r.firstYearPriceMinor, r.renewalPriceMinor]),
    [
      ["layla.com", 8400, 8400],
      ["layla.net", null, null],
    ],
  );
  for (const result of results) {
    assert.deepEqual(Object.keys(result).sort(), [
      "available",
      "currency",
      "domain",
      "firstYearPriceMinor",
      "premium",
      "renewalPriceMinor",
      "renewsYearly",
    ]);
    assert.doesNotMatch(JSON.stringify(result), REGISTRAR_NAME);
  }

  // A stored order holds the registrar, its USD price, the rate and the
  // margin for operators; the trainer's order status shows none of them.
  const order = {
    id: "5f0c7d2e-3c1e-4b35-9d0e-6f9e4c1a2b3c",
    tenant_id: "t1",
    hostname: "laylastrength.com",
    status: "active",
    mode: "automatic",
    registrar: "namecheap",
    quote: {
      priceMinor: 8400,
      firstYearPriceMinor: 8400,
      renewalPriceMinor: 8400,
      currency: "AED",
      registerUsd: "10.28",
      renewUsd: "16.06",
      usdToAed: "3.6725",
      marginAed: "25",
      registrar: "namecheap",
      registrarSandbox: true,
    },
    evidence: {
      registrarOrderId: "namecheap-123",
      chargedUsd: "10.28",
      nextRenewalChargeAt: "2027-08-29T00:00:00.000Z",
    },
    attention: "Namecheap refused the renewal: insufficient funds",
    progress: [
      { step: "paid", at: "2026-09-28T00:00:00Z", note: "Namecheap order 1" },
    ],
    expires_at: "2027-09-28T00:00:00.000Z",
    renewal_enabled: true,
    version: 3,
  };
  const view = trainerOrderView({
    ...order,
    registrar: "101domain",
    dns_provider: "digitalocean",
    serve_mode: "forward",
    evidence: { ...order.evidence, zoneState: "created", dnsTarget: "203.0.113.7" },
  });
  assert.equal(view.firstYearPriceMinor, 8400);
  assert.equal(view.renewalPriceMinor, 8400);
  assert.equal(view.serveMode, "forward");
  assert.doesNotMatch(JSON.stringify(view), REGISTRAR_NAME);
  assert.doesNotMatch(JSON.stringify(view), DNS_HOST);
  assert.deepEqual(
    keys(view).filter((key) => COST_KEY.test(key)),
    [],
    "no registrar or cost field reaches the trainer",
  );

  // The older manual flow: operator evidence stays with operators.
  const manual = trainerDomainView({
    id: "m1",
    hostname: "coach.example.com",
    status: "quoted",
    token: "tok",
    version: 2,
    registrar: "namecheap",
    evidence: {
      alreadyOwned: false,
      registrarReference: "Namecheap order 99",
      paymentEvidence: "Paid at Namecheap with the platform card",
    },
    quote: {
      amountMinor: 9000,
      renewalMinor: 9000,
      currency: "AED",
      termMonths: 12,
      expiresAt: "2026-10-10T00:00:00.000Z",
      providerReference: "Namecheap quote 7",
    },
  });
  assert.doesNotMatch(JSON.stringify(manual), REGISTRAR_NAME);
  assert.deepEqual(
    keys(manual).filter((key) => /registrar|reference|evidence/i.test(key)),
    [],
  );
});

test("the platform company is always the registrant; trainers get no transfer out or auth code", () => {
  const contact = {
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
  assert.equal(registrantFromConfig(contact).organization, "TrainsYou FZ-LLC");
  assert.throws(
    () =>
      registrantFromConfig({
        ...contact,
        WEB_ADDRESS_REGISTRANT_ORGANIZATION: "",
      }),
    /platform company/,
  );
  // The registrant comes from Super admin settings only: no request body,
  // trainer or order field supplies it.
  const orders = read("apps/api/src/web-address-orders.ts");
  assert.match(orders, /registrantFromConfig\(/);
  assert.doesNotMatch(
    read("apps/api/src/web-addresses.ts"),
    /registrant/i,
    "no trainer route accepts or returns a registrant",
  );
  // No route anywhere offers a transfer out or an authorisation (EPP) code.
  const routes = files(join(ROOT, "apps/api/src"))
    .flatMap((path) => [
      ...readFileSync(path, "utf8").matchAll(
        /app\.(?:get|post|put|patch|delete)\(\s*"([^"]+)"/g,
      ),
    ])
    .map((m) => m[1]);
  assert.ok(routes.length > 50, "the routes were found");
  assert.deepEqual(
    routes.filter((path) =>
      /(domain|web-address)[^"]*(transfer|auth-?code|epp|unlock)|(transfer|auth-?code|epp)[^"]*(domain|web-address)/i.test(
        path,
      ),
    ),
    [],
  );
  const registrarInterface =
    /export interface Registrar \{[\s\S]*?\n\}/.exec(
      read("packages/providers/src/registrar.ts"),
    )?.[0] ?? "";
  assert.ok(registrarInterface.includes("register("));
  assert.doesNotMatch(registrarInterface, /transfer|epp|authCode|unlock/i);
});
