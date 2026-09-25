import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import pg from "pg";
import { createDatabase, type Database } from "@trainer/db";
import {
  platformSettingsRoutes,
  loadRuntimeSettings,
} from "../apps/api/src/platform-settings.ts";
import {
  withRuntimeConfig,
  runtimeConfig,
} from "../packages/providers/src/configuration.ts";

let db: Database;
let app: ReturnType<typeof Fastify>;
let disposableFixtureOwned = false;
const actor = {
  userId: randomUUID(),
  tenantId: randomUUID(),
  role: "owner",
  platformRole: "admin",
  mfaAt: new Date().toISOString(),
};
const keys = [
  "SECURITY_ENCRYPTION_KEY",
  "MODEL_API_KEY",
  "EMAIL_API_KEY",
  "COMMERCE_APPROVED",
  "BUNDLE_CHANGES_APPROVED",
];
const environment = Object.fromEntries(
  keys.map((key) => [key, process.env[key]]),
);
const masterKey = randomBytes(32).toString("base64");
const modelSecret = "model_fixture_secret_never_return_this_value";
const emailSecret = "email_fixture_secret_never_return_this_value";
type ProbeResult = {
  status: "verified" | "validated" | "failed" | "unavailable";
  message: string;
  checkedAt: string;
};
let probe: (
  id: string,
  config: Record<string, string | undefined>,
) => Promise<ProbeResult> = async () => ({
  status: "verified",
  message: "fixture verified",
  checkedAt: new Date().toISOString(),
});

async function req(
  path: string,
  method: any = "GET",
  body?: unknown,
  role = "admin",
  mfa = "fresh",
) {
  return app.inject({
    url: "/api/v1/admin/settings" + path,
    method,
    headers: { "x-role": role, "x-mfa": mfa },
    payload: body,
  });
}
async function current(id: string) {
  const response = await req("");
  assert.equal(response.statusCode, 200, response.body);
  return response.json().integrations.find((item: any) => item.id === id);
}
async function save(id: string, body: Record<string, unknown>) {
  const config = await current(id);
  const response = await req("/" + id, "PUT", {
    revision: config.revision,
    enabled: config.enabled,
    values: {},
    ...body,
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json();
}
async function check(id: string) {
  const config = await current(id);
  const response = await req(`/${id}/test`, "POST", {
    revision: config.revision,
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json();
}
before(async () => {
  if (process.env.DATABASE_URL) {
    const migration = new URL(
      process.env.MIGRATION_DATABASE_URL ?? "https://invalid",
    );
    const runtime = new URL(process.env.DATABASE_URL);
    assert.equal(
      process.env.CI,
      "true",
      "Global settings fixtures require an explicitly disposable CI database",
    );
    assert.equal(migration.hostname, "127.0.0.1");
    assert.equal(runtime.hostname, "127.0.0.1");
    assert.equal(migration.pathname, runtime.pathname);
  }
  process.env.SECURITY_ENCRYPTION_KEY = masterKey;
  process.env.MODEL_API_KEY = "environment_model_fixture";
  process.env.EMAIL_API_KEY = "environment_email_fixture";
  process.env.COMMERCE_APPROVED = "true";
  process.env.BUNDLE_CHANGES_APPROVED = "true";
  db = await createDatabase({ memory: true });
  assert.equal(
    (await db.system((tx) => tx.query("SELECT * FROM platform_settings")))
      .length,
    0,
    "Refuse to overwrite existing platform settings",
  );
  assert.equal(
    (await db.system((tx) => tx.query("SELECT * FROM platform_settings_audit")))
      .length,
    0,
    "Refuse to overwrite existing audit history",
  );
  disposableFixtureOwned = true;
  app = Fastify({ logger: false });
  app.setErrorHandler(
    (error: any, _request: FastifyRequest, reply: FastifyReply) =>
      reply.code(error.statusCode ?? 500).send({
        code: error.code ?? "INTERNAL_ERROR",
        message: error.statusCode ? error.message : "The request failed.",
      }),
  );
  platformSettingsRoutes(
    app,
    db,
    (request) => {
      const role = String(request.headers["x-role"]);
      if (role === "anonymous")
        throw Object.assign(new Error("Sign in"), {
          statusCode: 401,
          code: "AUTH_REQUIRED",
        });
      return {
        ...actor,
        platformRole: role,
        mfaAt:
          request.headers["x-mfa"] === "fresh"
            ? new Date().toISOString()
            : null,
      };
    },
    { testIntegration: (id, config) => probe(id, config) },
  );
});
after(async () => {
  await app?.close();
  await db?.close();
  // Only the disposable loopback CI fixture's migration role removes test rows.
  // All assertions, writes and privilege checks above use the non-owner runtime.
  if (
    disposableFixtureOwned &&
    process.env.DATABASE_URL &&
    process.env.CI === "true" &&
    process.env.MIGRATION_DATABASE_URL
  ) {
    const migration = new URL(process.env.MIGRATION_DATABASE_URL);
    if (migration.hostname === "127.0.0.1") {
      const cleanup = new pg.Client({
        connectionString: process.env.MIGRATION_DATABASE_URL,
      });
      await cleanup.connect();
      try {
        await cleanup.query(
          "TRUNCATE platform_settings,platform_settings_audit",
        );
      } finally {
        await cleanup.end();
      }
    }
  }
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("only superadmin can read settings and every mutation requires recent MFA", async () => {
  assert.equal((await req("", "GET", undefined, "anonymous")).statusCode, 401);
  for (const role of [
    "owner",
    "none",
    "finance",
    "support",
    "safety",
    "subscriber",
  ]) {
    assert.equal((await req("", "GET", undefined, role)).statusCode, 403);
    assert.equal(
      (
        await req(
          "/email",
          "PUT",
          { revision: 0, enabled: false, values: {} },
          role,
        )
      ).statusCode,
      403,
    );
  }
  for (const [path, method, body] of [
    ["/email", "PUT", { revision: 0, enabled: false, values: {} }],
    ["/email/test", "POST", { revision: 0 }],
    ["/email/disconnect", "POST", { revision: 0 }],
  ] as const) {
    const response = await req(path, method, body, "admin", "missing");
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().code, "MFA_STEP_UP");
  }
});

test("inherited configuration reflects actual runtime availability without claiming a connection test", async () => {
  const before = {
    base: process.env.MODEL_BASE_URL,
    name: process.env.MODEL_NAME,
  };
  process.env.MODEL_BASE_URL = "https://models.example.test/v1";
  process.env.MODEL_NAME = "inherited-fixture";
  try {
    const config = await current("model");
    assert.equal(config.revision, 0);
    assert.equal(config.source, "environment");
    assert.equal(config.enabled, true);
    assert.equal(config.active, true);
    assert.equal(config.lastTest, null);
    assert.equal(config.credentialStatus, "environment");
    assert.deepEqual(await loadRuntimeSettings(db), {});
  } finally {
    if (before.base === undefined) delete process.env.MODEL_BASE_URL;
    else process.env.MODEL_BASE_URL = before.base;
    if (before.name === undefined) delete process.env.MODEL_NAME;
    else process.env.MODEL_NAME = before.name;
  }
});

test("credentials are authenticated ciphertext, never returned or included in audit", async () => {
  const saved = await save("model", {
    enabled: true,
    values: {
      MODEL_BASE_URL: "https://models.example.test/v1",
      MODEL_NAME: "fixture-model",
      MODEL_INPUT_USD_PER_MILLION: "1",
      MODEL_OUTPUT_USD_PER_MILLION: "2",
      MODEL_PRICE_VERSION: "fixture",
      MODEL_MAX_DAILY_CALLS: "10",
    },
    secrets: { MODEL_API_KEY: modelSecret },
  });
  assert.equal(saved.secrets.MODEL_API_KEY, true);
  assert.equal(
    saved.active,
    false,
    "Saved credentials must not imply a verified connection",
  );
  const [row] = await db.system((tx) =>
    tx.query("SELECT * FROM platform_settings WHERE integration_id='model'"),
  );
  assert.match(row.encrypted_secrets.MODEL_API_KEY, /^v1\./);
  assert.ok(!JSON.stringify(row).includes(modelSecret));
  const response = await req("");
  assert.ok(!response.body.includes(modelSecret));
  assert.ok(!response.body.includes(row.encrypted_secrets.MODEL_API_KEY));
  assert.ok(!response.body.includes("environment_model_fixture"));
  const [audit] = await db.system((tx) =>
    tx.query(
      "SELECT * FROM platform_settings_audit WHERE integration_id='model'",
    ),
  );
  assert.ok(audit.changed_fields.includes("MODEL_API_KEY"));
  assert.ok(!JSON.stringify(audit).includes(modelSecret));
  assert.deepEqual(
    Object.keys(audit).sort(),
    [
      "action",
      "actor_id",
      "changed_fields",
      "created_at",
      "id",
      "integration_id",
      "result",
      "revision",
    ].sort(),
  );
});

test("tenant transactions cannot read platform credentials or audit and audit is immutable", async () => {
  for (const table of ["platform_settings", "platform_settings_audit"]) {
    await assert.rejects(
      db.tenant(actor, (tx) => tx.query(`SELECT * FROM ${table}`)),
      /permission denied/i,
    );
  }
  await assert.rejects(
    db.system((tx) =>
      tx.query("UPDATE platform_settings_audit SET action='tested'"),
    ),
    /immutable|permission denied/i,
  );
  await assert.rejects(
    db.system((tx) => tx.query("DELETE FROM platform_settings_audit")),
    /immutable|permission denied/i,
  );
});

test("connection tests use committed credentials, activate only that revision and keep sanitized results", async () => {
  probe = async (id, values) => {
    assert.equal(id, "model");
    assert.equal(values.MODEL_API_KEY, modelSecret);
    return {
      status: "verified",
      message: `unsafe provider body ${modelSecret}`,
      checkedAt: new Date().toISOString(),
    };
  };
  const tested = await check("model");
  assert.equal(tested.active, true);
  assert.equal(tested.lastTest.revision, tested.revision);
  assert.ok(!JSON.stringify(tested).includes(modelSecret));
  const override = await loadRuntimeSettings(db);
  assert.equal(override.MODEL_API_KEY, modelSecret);
  assert.equal(
    withRuntimeConfig(override, () => runtimeConfig().MODEL_API_KEY),
    modelSecret,
  );
  assert.equal(
    process.env.MODEL_API_KEY,
    "environment_model_fixture",
    "Runtime settings never mutate process.env",
  );
  const disabled = await save("model", { enabled: false });
  assert.equal(disabled.active, false);
  assert.equal(disabled.lastTest.revision, disabled.revision);
  assert.equal(
    (await loadRuntimeSettings(db)).MODEL_API_KEY,
    "",
    "Explicit disable masks environment fallback",
  );
  const enabled = await save("model", { enabled: true });
  assert.equal(
    enabled.active,
    true,
    "Toggling intent preserves a test of unchanged fields",
  );
});

test("optimistic revisions reject lost updates and changed fields invalidate a prior test", async () => {
  const before = await current("model");
  const updated = await save("model", {
    values: { MODEL_NAME: "fixture-model-v2" },
  });
  assert.equal(updated.active, false);
  assert.equal(updated.lastTest, null);
  const stale = await req("/model", "PUT", {
    revision: before.revision,
    enabled: true,
    values: { MODEL_NAME: "lost-edit" },
  });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().code, "SETTINGS_CONFLICT");
  const wrongField = await req("/model", "PUT", {
    revision: updated.revision,
    enabled: true,
    values: { SECURITY_ENCRYPTION_KEY: modelSecret },
  });
  assert.equal(wrongField.statusCode, 400);
  assert.ok(!wrongField.body.includes(modelSecret));
  const rawSecret = await req("/model", "PUT", {
    revision: updated.revision,
    enabled: true,
    values: { MODEL_API_KEY: modelSecret },
  });
  assert.equal(rawSecret.statusCode, 400);
});

test("a delayed test cannot activate credentials edited while the request was in flight", async () => {
  let entered!: () => void, finish!: () => void;
  const start = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  probe = async () => {
    entered();
    await gate;
    return {
      status: "verified",
      message: "old result",
      checkedAt: new Date().toISOString(),
    };
  };
  const old = await current("model");
  const pending = req("/model/test", "POST", { revision: old.revision });
  await start;
  const edited = await save("model", {
    values: { MODEL_NAME: "fixture-model-v3" },
  });
  finish();
  assert.equal((await pending).statusCode, 409);
  const latest = await current("model");
  assert.equal(latest.revision, edited.revision);
  assert.equal(latest.lastTest, null);
  assert.equal(latest.active, false);
});

test("an older concurrent success cannot overwrite a newer failed test of the same revision", async () => {
  let entered!: () => void,
    finish!: () => void,
    calls = 0;
  const start = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  probe = async () => {
    if (++calls === 1) {
      entered();
      await gate;
      return {
        status: "verified",
        message: "old success",
        checkedAt: new Date().toISOString(),
      };
    }
    throw new Error(`Do not leak ${modelSecret}`);
  };
  const before = await current("model");
  const pending = req("/model/test", "POST", { revision: before.revision });
  await start;
  const failed = await check("model");
  assert.equal(failed.lastTest.status, "failed");
  finish();
  assert.equal((await pending).statusCode, 409);
  assert.equal((await current("model")).lastTest.status, "failed");
  assert.equal((await loadRuntimeSettings(db)).MODEL_API_KEY, "");
  assert.ok(!(await req("")).body.includes(modelSecret));
});

test("omitted credentials are preserved, explicit clearing and disconnect suppress environment secrets", async () => {
  const first = await save("email", {
    enabled: true,
    values: {
      EMAIL_API_URL: "https://mail.example.test/send",
      EMAIL_FROM: "sender@example.test",
    },
    secrets: { EMAIL_API_KEY: emailSecret },
  });
  const [initial] = await db.system((tx) =>
    tx.query(
      "SELECT encrypted_secrets FROM platform_settings WHERE integration_id='email'",
    ),
  );
  const second = await save("email", {
    values: { EMAIL_FROM: "new-sender@example.test" },
  });
  assert.equal(second.secrets.EMAIL_API_KEY, true);
  const [preserved] = await db.system((tx) =>
    tx.query(
      "SELECT encrypted_secrets FROM platform_settings WHERE integration_id='email'",
    ),
  );
  assert.deepEqual(preserved.encrypted_secrets, initial.encrypted_secrets);
  assert.ok(second.revision > first.revision);
  const cleared = await save("email", { clearSecrets: ["EMAIL_API_KEY"] });
  assert.equal(cleared.secrets.EMAIL_API_KEY, false);
  assert.equal((await loadRuntimeSettings(db)).EMAIL_API_KEY, "");
  const restored = await save("email", {
    secrets: { EMAIL_API_KEY: emailSecret },
  });
  const disconnected = await req("/email/disconnect", "POST", {
    revision: restored.revision,
  });
  assert.equal(disconnected.statusCode, 200);
  assert.equal(disconnected.json().enabled, false);
  assert.equal(disconnected.json().secrets.EMAIL_API_KEY, false);
  assert.equal((await loadRuntimeSettings(db)).EMAIL_API_KEY, "");
});

test("an unreadable encryption key fails closed without blocking settings recovery", async () => {
  probe = async () => ({
    status: "verified",
    message: "fixture",
    checkedAt: new Date().toISOString(),
  });
  await check("model");
  process.env.SECURITY_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  try {
    const config = await current("model");
    assert.equal(config.active, false);
    assert.equal(config.credentialStatus, "credentials_unreadable");
    assert.equal((await loadRuntimeSettings(db)).MODEL_API_KEY, "");
    const cleared = await save("model", { clearSecrets: ["MODEL_API_KEY"] });
    assert.equal(cleared.secrets.MODEL_API_KEY, false);
  } finally {
    process.env.SECURITY_ENCRYPTION_KEY = masterKey;
  }
  delete process.env.SECURITY_ENCRYPTION_KEY;
  try {
    const response = await req("/model", "PUT", {
      revision: (await current("model")).revision,
      enabled: true,
      values: {},
      secrets: { MODEL_API_KEY: modelSecret },
    });
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().code, "ENCRYPTION_UNAVAILABLE");
    assert.equal((await req("")).json().encryptionReady, false);
  } finally {
    process.env.SECURITY_ENCRYPTION_KEY = masterKey;
  }
});

test("disabled Stripe retains webhook authentication but gates new commerce and disconnect clears it", async () => {
  const secret = "stripe_fixture_secret_only",
    webhook = "whsec_fixture_only";
  const config = await save("stripe", {
    enabled: false,
    values: { COMMERCE_APPROVED: "true", BUNDLE_CHANGES_APPROVED: "true" },
    secrets: { STRIPE_SECRET_KEY: secret, STRIPE_WEBHOOK_SECRET: webhook },
  });
  const override = await loadRuntimeSettings(db);
  assert.equal(override.STRIPE_SECRET_KEY, secret);
  assert.equal(override.STRIPE_WEBHOOK_SECRET, webhook);
  assert.equal(override.COMMERCE_APPROVED, "false");
  assert.equal(override.BUNDLE_CHANGES_APPROVED, "false");
  const disconnected = await req("/stripe/disconnect", "POST", {
    revision: config.revision,
  });
  assert.equal(disconnected.statusCode, 200);
  const clear = await loadRuntimeSettings(db);
  assert.equal(clear.STRIPE_SECRET_KEY, "");
  assert.equal(clear.STRIPE_WEBHOOK_SECRET, "");
});

test("application controls are persisted without probe gating and cannot be disconnected", async () => {
  const saved = await save("application", {
    enabled: true,
    values: {
      APP_NAME: "Fixture application",
      LEGAL_APPROVED: "false",
      NUTRITION_ENABLED: "true",
    },
  });
  assert.equal(saved.active, true);
  assert.equal((await loadRuntimeSettings(db)).NUTRITION_ENABLED, "true");
  assert.equal(
    (await req("/application/disconnect", "POST", { revision: saved.revision }))
      .statusCode,
    400,
  );
  assert.equal(
    (
      await req("/application", "PUT", {
        revision: saved.revision,
        enabled: false,
        values: {},
      })
    ).statusCode,
    400,
  );
});

test("unsupported adapters remain inactive even if a test dependency reports success", async () => {
  await save("whoop", {
    enabled: true,
    values: {
      WHOOP_CLIENT_ID: "fixture",
      WHOOP_REDIRECT_URI: "https://app.example.test/oauth/whoop",
    },
    secrets: { WHOOP_CLIENT_SECRET: "whoop_fixture" },
  });
  const tested = await check("whoop");
  assert.equal(tested.active, false);
  assert.equal((await loadRuntimeSettings(db)).WHOOP_CLIENT_SECRET, "");
});
