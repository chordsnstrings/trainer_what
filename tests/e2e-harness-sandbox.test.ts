import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { createDatabase } from "@trainer/db";
import {
  assertProviderSandboxBinding,
  providerSandbox,
  providerSandboxStatus,
  sandboxOverride,
  ProviderSandboxRefused,
  validateIntegrationValues,
  validatePublicEndpoint,
  stripeClient,
  withRuntimeConfig,
} from "@trainer/providers";
import { pushEndpoint } from "../packages/providers/src/push.ts";
import { buildApp } from "../apps/api/src/app.ts";
import { ProviderSandboxBanner } from "../apps/web/components/provider-sandbox-banner.tsx";

const keys = [
  "TRAINER_PROVIDER_SANDBOX",
  "PUBLIC_APP_URL",
  "API_HOST",
  "STRIPE_API_BASE_URL",
  "WHOOP_API_BASE_URL",
  "FOOD_LOOKUP_BASE_URL",
];
async function withEnv<T>(values: Record<string, string | undefined>, fn: () => T | Promise<T>) {
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  for (const [k, v] of Object.entries(values)) if (v !== undefined) process.env[k] = v;
  try {
    return await fn();
  } finally {
    for (const k of keys)
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
  }
}
const local = { TRAINER_PROVIDER_SANDBOX: "mock", PUBLIC_APP_URL: "https://localhost:8443", API_HOST: "127.0.0.1" };

test("the sandbox is honoured only for mock on a loopback URL and loopback API host", () => {
  assert.equal(providerSandbox(local), "mock");
  assert.equal(providerSandbox({ ...local, PUBLIC_APP_URL: "http://127.0.0.1:3000" }), "mock");
  assert.equal(providerSandbox({ ...local, API_HOST: undefined }), "mock", "API_HOST defaults to loopback");
  for (const env of [
    { ...local, TRAINER_PROVIDER_SANDBOX: "true" },
    { ...local, TRAINER_PROVIDER_SANDBOX: "MOCK" },
    { ...local, PUBLIC_APP_URL: "https://coach.example.com" },
    { ...local, PUBLIC_APP_URL: "https://coach.203.0.113.10.sslip.io" },
    { ...local, PUBLIC_APP_URL: "https://localhost.example.com" },
    { ...local, PUBLIC_APP_URL: undefined },
    { ...local, API_HOST: "0.0.0.0" },
    { ...local, API_HOST: "10.0.0.5" },
  ])
    assert.equal(providerSandbox(env), null, JSON.stringify(env));
});

test("startup refuses the sandbox variable and sandbox-only overrides outside a loopback process", () => {
  assert.equal(assertProviderSandboxBinding({}), null);
  assert.equal(assertProviderSandboxBinding({ PUBLIC_APP_URL: "https://coach.example.com" }), null);
  assert.equal(assertProviderSandboxBinding(local), "mock");
  assert.equal(
    assertProviderSandboxBinding({ ...local, STRIPE_API_BASE_URL: "https://127.0.0.1:9443" }),
    "mock",
  );
  for (const env of [
    { ...local, PUBLIC_APP_URL: "https://coach.example.com" },
    { ...local, API_HOST: "0.0.0.0" },
    { ...local, TRAINER_PROVIDER_SANDBOX: "" },
    { ...local, TRAINER_PROVIDER_SANDBOX: "off" },
    { PUBLIC_APP_URL: "https://coach.example.com", STRIPE_API_BASE_URL: "https://127.0.0.1:9443" },
    { PUBLIC_APP_URL: "http://localhost:3000", WHOOP_API_BASE_URL: "https://127.0.0.1:9443" },
    { ...local, FOOD_LOOKUP_BASE_URL: "http://127.0.0.1:9443" },
    { ...local, STRIPE_API_BASE_URL: "https://api.stripe.com" },
    { ...local, STRIPE_API_BASE_URL: "https://user:pw@127.0.0.1:9443" },
  ])
    assert.throws(() => assertProviderSandboxBinding(env), ProviderSandboxRefused, JSON.stringify(env));
});

test("overrides resolve only inside an honoured sandbox", () => {
  const env = { ...local, STRIPE_API_BASE_URL: "https://127.0.0.1:9443" };
  assert.equal(sandboxOverride("STRIPE_API_BASE_URL", env)?.port, "9443");
  assert.equal(sandboxOverride("STRIPE_API_BASE_URL", { ...env, TRAINER_PROVIDER_SANDBOX: undefined }), null);
  assert.equal(sandboxOverride("STRIPE_API_BASE_URL", { ...env, PUBLIC_APP_URL: "https://coach.example.com" }), null);
  assert.equal(sandboxOverride("WHOOP_API_BASE_URL", env), null);
  assert.deepEqual(providerSandboxStatus({}), { providerSandbox: null, providerSandboxNotice: null });
  assert.equal(providerSandboxStatus(env).providerSandbox, "mock");
  assert.match(providerSandboxStatus(env).providerSandboxNotice!, /MOCK PROVIDERS/);
});

test("loopback HTTPS provider URLs, push endpoints and the Stripe host are accepted only in the sandbox", async () => {
  const values = { MODEL_BASE_URL: "https://127.0.0.1:9443/v1" };
  await withEnv({}, () => {
    assert.throws(() => validateIntegrationValues("model", values));
    assert.throws(() => pushEndpoint("https://127.0.0.1:9443/push/device"));
    const client: any = withRuntimeConfig({ STRIPE_SECRET_KEY: "sk_test_fixture" }, () => stripeClient());
    assert.equal(client._api.host, "api.stripe.com");
  });
  await withEnv({ PUBLIC_APP_URL: "https://coach.example.com", STRIPE_API_BASE_URL: "https://127.0.0.1:9443" }, () => {
    const client: any = withRuntimeConfig({ STRIPE_SECRET_KEY: "sk_test_fixture" }, () => stripeClient());
    assert.equal(client._api.host, "api.stripe.com", "an override without the sandbox is ignored");
  });
  await withEnv({ ...local, STRIPE_API_BASE_URL: "https://127.0.0.1:9443" }, async () => {
    assert.deepEqual(validateIntegrationValues("model", values), values);
    assert.throws(() => validateIntegrationValues("model", { MODEL_BASE_URL: "http://127.0.0.1:9443/v1" }), "plain HTTP stays refused");
    assert.throws(() => validateIntegrationValues("model", { MODEL_BASE_URL: "https://10.0.0.5/v1" }), "private non-loopback stays refused");
    assert.equal((await validatePublicEndpoint("https://localhost:9443/send")).addresses[0].address, "127.0.0.1");
    assert.equal(pushEndpoint("https://127.0.0.1:9443/push/device").port, "9443");
    assert.throws(() => pushEndpoint("https://10.0.0.5/push/device"));
    const client: any = withRuntimeConfig({ STRIPE_SECRET_KEY: "sk_test_fixture" }, () => stripeClient());
    assert.equal(client._api.host, "127.0.0.1");
    assert.equal(client._api.port, 9443);
    assert.equal(client._api.protocol, "https");
  });
});

test("readiness, bootstrap and the Superadmin settings announce the sandbox", async () => {
  const db = await createDatabase({ memory: true });
  const app = await buildApp({ db, testing: true });
  try {
    await withEnv({}, async () => {
      const r = await app.inject({ url: "/api/v1/ready" });
      assert.deepEqual(r.json(), { status: "ready" });
    });
    await withEnv(local, async () => {
      const r = await app.inject({ url: "/api/v1/ready" });
      assert.equal(r.json().providerSandbox, "mock");
      assert.match(r.json().providerSandboxNotice, /MOCK PROVIDERS/);
    });
  } finally {
    await app.close();
    await db.close();
  }
});

test("the mock-provider banner renders only for the sandbox", () => {
  const html = renderToStaticMarkup(createElement(ProviderSandboxBanner, { mode: "mock" }));
  assert.match(html, /role="alert"/);
  assert.match(html, /Mock providers\./);
  assert.equal(renderToStaticMarkup(createElement(ProviderSandboxBanner, { mode: null })), "");
  assert.equal(renderToStaticMarkup(createElement(ProviderSandboxBanner, { mode: "live" })), "");
});
