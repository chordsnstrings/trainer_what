import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AddressChangeProgress,
  AddressCheckResult,
  PlatformAddressChange,
} from "../apps/web/components/host-operations.tsx";
import { platformAddressUpdates } from "../apps/api/src/host-operations.ts";

const check = {
  valid: true,
  origin: "https://trainsyou.com",
  current: "https://gymmembership.203.0.113.10.sslip.io",
  rootDomain: "trainsyou.com",
  currentRootDomain: null,
  changed: true,
  serverIpv4: "203.0.113.10",
  resolution: [
    {
      name: "trainsyou.com",
      a: ["203.0.113.10"],
      aaaa: [],
      ok: true,
      purpose: "New platform address",
    },
    {
      name: "gm-address-check-0a1b2c3d.trainsyou.com",
      a: [],
      aaaa: [],
      ok: false,
      purpose: "Wildcard *.trainsyou.com (random name)",
    },
  ],
  checks: [
    {
      key: "passkeys",
      ok: false,
      level: "warning",
      message: "2 passkeys are bound to gymmembership.203.0.113.10.sslip.io.",
    },
  ],
  providerUpdates: platformAddressUpdates(
    "https://trainsyou.com",
    "trainsyou.com",
  ),
  procedure: ["Create an A record for the new name."],
};

test("the DNS preview shows each name's answers against this server and the provider URLs", () => {
  const html = renderToStaticMarkup(
    createElement(AddressCheckResult, { result: check }),
  );
  assert.match(html, /Ready to switch/);
  assert.match(html, /\(this server: 203\.0\.113\.10\)/);
  assert.match(
    html,
    /trainsyou\.com<\/span><small class="muted"> · New platform address/,
  );
  assert.match(html, /<td>203\.0\.113\.10<\/td><td>none<\/td>.*Points here/);
  assert.match(
    html,
    /Wildcard \*\.trainsyou\.com \(random name\).*Not this server/,
  );
  assert.match(html, /1 warning above/);
  for (const url of [
    "https://trainsyou.com/api/v1/webhooks/stripe",
    "https://trainsyou.com/api/v1/auth/oidc/google/callback",
    "https://trainsyou.com/api/v1/auth/oidc/apple/callback",
    "https://trainsyou.com/api/v1/integrations/whoop/callback",
    "https://trainsyou.com/api/v1/integrations/zepp/callback",
    "https://trainsyou.com/api/v1/trainer/instagram/callback",
  ])
    assert.ok(html.includes(url), url);
  assert.match(html, /Coach-domain CNAME target/);
});

const request = {
  id: "0d3c9a4e-8a0f-4c55-9b7e-1f2a3b4c5d6e",
  action: "change_platform_address",
  label: "Change the platform address",
  target: null,
  parameters: { url: "https://trainsyou.com", rootDomain: "trainsyou.com" },
  reason: "Synthetic: move to the brand domain",
  status: "running",
  createdAt: "2026-09-28T10:00:00.000Z",
  expiresAt: "2026-09-28T10:30:00.000Z",
  finishedAt: null,
  result: {
    message: "DNS points to this server (203.0.113.10).",
    details: { progress: true },
  },
  resultVerified: true,
  notPickedUp: false,
  outcomeUnknown: false,
};

test("progress shows the running step, then the result with a link to the new address", () => {
  const running = renderToStaticMarkup(
    createElement(AddressChangeProgress, { request, unreachable: true }),
  );
  assert.match(
    running,
    /Move to https:\/\/trainsyou\.com · root domain trainsyou\.com/,
  );
  assert.match(running, /Switching now/);
  assert.match(running, /DNS points to this server/);
  assert.match(running, /cannot reach the platform right now/);
  assert.match(
    running,
    /href="https:\/\/trainsyou\.com\/admin\/infrastructure\/host"/,
  );
  const done = renderToStaticMarkup(
    createElement(AddressChangeProgress, {
      request: {
        ...request,
        status: "succeeded",
        finishedAt: "2026-09-28T10:06:00.000Z",
        result: { message: "The platform now serves https://trainsyou.com." },
      },
    }),
  );
  assert.match(done, /Open the host page at https:\/\/trainsyou\.com/);
  const failed = renderToStaticMarkup(
    createElement(AddressChangeProgress, {
      request: {
        ...request,
        status: "failed",
        result: {
          message: "DNS is not ready: trainsyou.com resolves to 198.51.100.7.",
          details: {
            restored: true,
            dns: [
              {
                name: "trainsyou.com",
                addresses: ["198.51.100.7"],
                source: "system resolver",
                ok: false,
              },
            ],
          },
        },
      },
    }),
  );
  assert.match(failed, /Not moved/);
  assert.match(failed, /previous address and settings were restored/);
  assert.match(failed, /trainsyou\.com: 198\.51\.100\.7 \(system resolver\)/);
});

test("the address section shows the server, root domain and redirects before any check", () => {
  const data = {
    edge: { onDemandTls: true, endpoint: "https://trainsyou.com" },
    address: {
      publicIpv4: "203.0.113.10",
      rootDomain: "trainsyou.com",
      redirectFrom: ["gymmembership.203.0.113.10.sslip.io"],
      changeInProgress: false,
      lastChange: null,
    },
    signingAvailable: true,
    actions: { recent: [request], allowlist: [] },
  } as any;
  const html = renderToStaticMarkup(
    createElement(PlatformAddressChange, {
      data,
      busy: false,
      run: async () => {},
      reload: async () => {},
    }),
  );
  assert.match(html, /This server \(public IPv4\)<\/dt><dd>203\.0\.113\.10/);
  assert.match(
    html,
    /Root domain for workspace addresses<\/dt><dd>trainsyou\.com/,
  );
  assert.match(html, /gymmembership\.203\.0\.113\.10\.sslip\.io/);
  assert.match(html, /Remove\s+old-address redirects/);
  assert.match(html, /aria-label="Platform address change progress"/);
  assert.match(html, />Check DNS</);
  // The request form appears only after a passing check of the same inputs.
  assert.doesNotMatch(html, /Request the switch/);
  // Older controllers report no address block.
  const older = renderToStaticMarkup(
    createElement(PlatformAddressChange, {
      data: {
        ...data,
        address: undefined,
        actions: { recent: [], allowlist: [] },
      },
      busy: false,
      run: async () => {},
      reload: async () => {},
    }),
  );
  assert.match(older, /Not reported yet/);
});
