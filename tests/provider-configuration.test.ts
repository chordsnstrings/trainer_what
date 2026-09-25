import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INTEGRATION_CATALOG,
  ConfigurationError,
  runtimeConfig,
  withRuntimeConfig,
  validateIntegrationValues,
  validatePublicEndpoint,
  isPublicAddress,
  providerRequest,
  testIntegration,
  integrationStatus,
  sendEmail,
  LeanGateway,
  requireCommerce,
  stripeClient,
} from "@trainer/providers";
import { modelCompletion } from "../packages/providers/src/model-accounting.ts";
import { nutritionModelIdentity } from "../packages/providers/src/nutrition.ts";

test("runtime settings stay scoped across concurrent requests and nested overrides", async () => {
  const before = process.env.MODEL_NAME;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  await Promise.all([
    withRuntimeConfig(
      { MODEL_NAME: "first", MODEL_API_KEY: "fixture-first" },
      async () => {
        release();
        await new Promise((resolve) => setTimeout(resolve, 5));
        assert.equal(runtimeConfig().MODEL_NAME, "first");
        assert.equal(nutritionModelIdentity().model, "first");
        withRuntimeConfig({ MODEL_NAME: "nested" }, () => {
          assert.equal(runtimeConfig().MODEL_NAME, "nested");
          assert.equal(runtimeConfig().MODEL_API_KEY, "fixture-first");
        });
        assert.equal(runtimeConfig().MODEL_NAME, "first");
      },
    ),
    withRuntimeConfig(
      { MODEL_NAME: "second", MODEL_API_KEY: undefined },
      async () => {
        await ready;
        assert.equal(runtimeConfig().MODEL_NAME, "second");
        assert.equal(runtimeConfig().MODEL_API_KEY, undefined);
      },
    ),
  ]);
  assert.equal(process.env.MODEL_NAME, before);
  assert.equal(runtimeConfig().MODEL_NAME, before);
});

test("catalog fields have one owner and missing adapters cannot report a connection", async () => {
  const keys = INTEGRATION_CATALOG.flatMap((entry) =>
    entry.fields.map((field) => field.key),
  );
  assert.equal(new Set(keys).size, keys.length);
  for (const id of ["whoop", "zepp", "voice", "domains"]) {
    const result = await testIntegration(id, { API_KEY: "fixture-only" });
    assert.equal(result.status, "unavailable");
  }
  assert.equal((await testIntegration("apple", {})).status, "validated");
});

test("settings validation uses an allowlist, public HTTPS URLs and bounded prices", () => {
  assert.deepEqual(
    validateIntegrationValues("application", {
      APP_NAME: "Example coaching",
      NUTRITION_ENABLED: true,
    }),
    { APP_NAME: "Example coaching", NUTRITION_ENABLED: "true" },
  );
  for (const values of [
    { DATABASE_URL: "fixture" },
    { MODEL_BASE_URL: "http://api.example.test/v1" },
    { MODEL_BASE_URL: "https://localhost/v1" },
    { MODEL_BASE_URL: "https://127.0.0.1/v1" },
    { MODEL_BASE_URL: "https://169.254.169.254/latest/meta-data" },
    { MODEL_BASE_URL: "https://[::ffff:127.0.0.1]/v1" },
    { MODEL_BASE_URL: "https://fixture-password@provider.example.test/v1" },
    { MODEL_BASE_URL: "https://provider.example.test/v1#fragment" },
    { MODEL_BASE_URL: "https://provider.example.test/v1?token=fixture" },
    { MODEL_API_KEY: "fixture\nnewline" },
    { MODEL_MAX_DAILY_CALLS: 10001 },
    { MODEL_MAX_DAILY_CALLS: 1.5 },
    { MODEL_INPUT_USD_PER_MILLION: -1 },
    { MODEL_INPUT_USD_PER_MILLION: "Infinity" },
  ])
    assert.throws(
      () => validateIntegrationValues("model", values),
      ConfigurationError,
    );
  assert.throws(
    () =>
      validateIntegrationValues("application", {
        PUBLIC_APP_URL: "https://public.example.test/nested",
      }),
    ConfigurationError,
  );
  assert.deepEqual(
    validateIntegrationValues("model", {
      MODEL_INPUT_USD_PER_MILLION: 0,
      MODEL_MAX_DAILY_CALLS: 1,
    }),
    { MODEL_INPUT_USD_PER_MILLION: "0", MODEL_MAX_DAILY_CALLS: "1" },
  );
});

test("public endpoint resolution rejects mixed public/private answers and mapped addresses", async () => {
  for (const address of [
    "0.0.0.0",
    "10.1.1.1",
    "127.1.2.3",
    "172.31.1.1",
    "192.168.1.1",
    "100.64.1.1",
    "169.254.169.254",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
    "2002:7f00:1::1",
  ])
    assert.equal(isPublicAddress(address), false, address);
  assert.equal(isPublicAddress("1.1.1.1"), true);
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
  await assert.rejects(
    validatePublicEndpoint("https://provider.example.test/v1", async () => [
      { address: "1.1.1.1", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ]),
    /public network addresses/,
  );
  await assert.rejects(
    validatePublicEndpoint("https://provider.example.test/v1", async () => []),
    /public network addresses/,
  );
  const result = await validatePublicEndpoint(
    "https://provider.example.test/v1",
    async () => [{ address: "1.1.1.1", family: 4 }],
  );
  assert.equal(result.addresses[0].address, "1.1.1.1");
});

test("model connection test only lists models and does not generate, email or move money", async () => {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    return Response.json({ data: [{ id: "fixture-model" }] });
  };
  const config = {
    MODEL_BASE_URL: "https://provider.example.test/v1",
    MODEL_API_KEY: "fixture-not-a-real-key",
    MODEL_NAME: "fixture-model",
    MODEL_INPUT_USD_PER_MILLION: "1",
    MODEL_OUTPUT_USD_PER_MILLION: "2",
    MODEL_PRICE_VERSION: "fixture-v1",
    MODEL_MAX_DAILY_CALLS: "10",
  };
  try {
    assert.equal((await testIntegration("model", config)).status, "verified");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://provider.example.test/v1/models");
    assert.equal(calls[0].init.method ?? "GET", "GET");
    assert.equal(calls[0].init.body, undefined);
    assert.equal(calls[0].init.redirect, "error");
    assert.equal(
      (
        await testIntegration("model", {
          ...config,
          MODEL_NAME: "missing-model",
        })
      ).status,
      "failed",
    );
    const localOnly = await testIntegration("email", {
      EMAIL_API_URL: "https://1.1.1.1/send",
      EMAIL_API_KEY: "fixture-only",
      EMAIL_FROM: "sender@example.test",
    });
    assert.equal(localOnly.status, "validated");
    assert.match(localOnly.message, /No email was sent/);
    const bank = await testIntegration("lean", {
      LEAN_BASE_URL: "https://1.1.1.1",
      LEAN_ACCESS_TOKEN: "fixture-only",
      LEAN_SOURCE_ACCOUNT_ID: "fixture-source",
    });
    assert.equal(bank.status, "validated");
    assert.match(bank.message, /remain unverified/);
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = original;
  }
});

test("connection failure and redirect results never return provider response secrets", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response("fixture-secret-do-not-expose", { status: 401 });
  };
  const config = {
    MODEL_BASE_URL: "https://provider.example.test/v1",
    MODEL_API_KEY: "fixture-secret-do-not-expose",
    MODEL_NAME: "fixture-model",
    MODEL_INPUT_USD_PER_MILLION: "1",
    MODEL_OUTPUT_USD_PER_MILLION: "2",
    MODEL_PRICE_VERSION: "fixture-v1",
    MODEL_MAX_DAILY_CALLS: "10",
  };
  try {
    const rejected = await testIntegration("model", config);
    assert.equal(rejected.status, "failed");
    assert.equal(
      JSON.stringify(rejected).includes(config.MODEL_API_KEY),
      false,
    );
    globalThis.fetch = async () => {
      calls++;
      return new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/" },
      });
    };
    const redirected = await testIntegration("model", config);
    assert.equal(redirected.status, "failed");
    assert.match(redirected.message, /redirects/);
    assert.equal(calls, 2);
    await assert.rejects(
      providerRequest("https://127.0.0.1/", {
        headers: { Authorization: "Bearer fixture" },
      }),
      ConfigurationError,
    );
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = original;
  }
});

test("scoped settings reach email and bank adapters without global credential mutation", async () => {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    return Response.json({ id: "fixture-response" });
  };
  try {
    await withRuntimeConfig(
      {
        EMAIL_API_URL: "https://mail.fixture.invalid/send",
        EMAIL_API_KEY: "fixture-email-key",
        EMAIL_FROM: "robot@example.test",
        LEAN_BASE_URL: "https://bank.fixture.invalid",
        LEAN_ACCESS_TOKEN: "fixture-bank-key",
        LEAN_SOURCE_ACCOUNT_ID: "fixture-account",
        LEAN_CONTRACT_VERIFIED: "true",
        PAYOUTS_APPROVED: "true",
        COMMERCE_APPROVED: "false",
        STRIPE_SECRET_KEY: "sk_test_fixture_runtime",
      },
      async () => {
        assert.equal(
          integrationStatus().find((entry) => entry.id === "email")?.configured,
          true,
        );
        assert.equal(
          integrationStatus().find((entry) => entry.id === "lean")?.approved,
          true,
        );
        assert.throws(requireCommerce, /commerce awaits/);
        assert.ok(stripeClient()); // Constructing the client does not make a request.
        await sendEmail("recipient@example.test", "Fixture", "Fixture message");
        await new LeanGateway().sendPayout({
          id: "fixture-intent",
          beneficiaryId: "fixture-beneficiary",
          amountMinor: 250,
        });
      },
    );
    assert.equal(calls.length, 2);
    assert.equal(
      new Headers(calls[0].init.headers).get("authorization"),
      "Bearer fixture-email-key",
    );
    assert.equal(
      JSON.parse(String(calls[0].init.body)).from,
      "robot@example.test",
    );
    assert.equal(
      JSON.parse(String(calls[1].init.body)).source_account_id,
      "fixture-account",
    );
    assert.equal(
      new Headers(calls[1].init.headers).get("idempotency-key"),
      "fixture-intent",
    );
    assert.equal(
      runtimeConfig().LEAN_ACCESS_TOKEN,
      process.env.LEAN_ACCESS_TOKEN,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("model pricing comes from runtime configuration and blocked endpoints reserve no usage", async () => {
  const original = globalThis.fetch;
  const events: string[] = [],
    usage: any[] = [];
  const accounting = {
    reserve: async (model: string) => {
      events.push(`reserve:${model}`);
    },
    record: async (entry: any) => {
      events.push("record");
      usage.push(entry);
    },
  };
  globalThis.fetch = async () => {
    events.push("send");
    return Response.json({
      id: "fixture-response",
      usage: { prompt_tokens: 100, completion_tokens: 25 },
      choices: [],
    });
  };
  try {
    await withRuntimeConfig(
      {
        MODEL_INPUT_USD_PER_MILLION: "2",
        MODEL_OUTPUT_USD_PER_MILLION: "4",
        MODEL_PRICE_VERSION: "fixture-scoped-price",
      },
      () =>
        modelCompletion(
          "https://model.fixture.invalid/v1",
          "fixture-model-key",
          "fixture-model",
          {},
          accounting,
        ),
    );
    assert.deepEqual(events, ["reserve:fixture-model", "send", "record"]);
    assert.equal(usage[0].cost, 0.0003);
    assert.equal(usage[0].priceVersion, "fixture-scoped-price");
    await assert.rejects(
      modelCompletion(
        "https://169.254.169.254",
        "fixture-key",
        "fixture-model",
        {},
        accounting,
      ),
      ConfigurationError,
    );
    assert.equal(events.length, 3);
    const exhausted = Object.assign(new Error("Daily request limit reached"), {
      statusCode: 429,
    });
    await assert.rejects(
      modelCompletion(
        "https://model.fixture.invalid/v1",
        "fixture-key",
        "fixture-model",
        {},
        {
          ...accounting,
          reserve: async () => {
            throw exhausted;
          },
        },
      ),
      (error) => error === exhausted,
    );
    assert.equal(events.length, 3);
  } finally {
    globalThis.fetch = original;
  }
});
