import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { createDatabase, type Database } from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";
import { tokenHash } from "../apps/api/src/auth.ts";
import { totpAt } from "../apps/api/src/security.ts";
import { resetAccountMfa } from "../apps/api/src/account-completion.ts";
import { loadRuntimeSettings } from "../apps/api/src/platform-settings.ts";
import { executeEmailDelivery } from "../apps/worker/src/email-delivery.ts";
import {
  INTEGRATION_CATALOG,
  runtimeConfig,
  withRuntimeConfig,
} from "../packages/providers/src/configuration.ts";

const keys = [
  "SECURITY_ENCRYPTION_KEY",
  "APP_NAME",
  "FILE_IMPORTS_APPROVED",
] as const;
const environment = Object.fromEntries(
  keys.map((key) => [key, process.env[key]]),
);
let db: Database;
let app: Awaited<ReturnType<typeof buildApp>>;
let cookie = "";
let admin: { tenantId: string; userId: string; email: string };
const origin = process.env.PUBLIC_APP_URL ?? "http://localhost:3000";
const call = (url: string, method: any, payload: any, session: string) =>
  app.inject({
    url: "/api/v1" + url,
    method,
    headers: { origin, cookie: session },
    payload,
  });
const api = (url: string, method: any = "GET", payload?: any) =>
  call(url, method, payload, cookie);
async function integration(id: string) {
  const response = await api("/admin/settings");
  assert.equal(response.statusCode, 200, response.body);
  return response.json().integrations.find((item: any) => item.id === id);
}
const application = () => integration("application");
async function saveEmail(from: string) {
  const current = await integration("email");
  const saved = await api("/admin/settings/email", "PUT", {
    revision: current.revision,
    enabled: true,
    values: { EMAIL_API_URL: "https://1.1.1.1/send", EMAIL_FROM: from },
    ...(current.secrets.EMAIL_API_KEY
      ? {}
      : { secrets: { EMAIL_API_KEY: "fixture_email_key_only" } }),
  });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().active, false);
  return saved.json();
}
async function testEmail() {
  const tested = await api("/admin/settings/email/test", "POST", {
    revision: (await integration("email")).revision,
  });
  assert.equal(tested.statusCode, 200, tested.body);
  assert.equal(tested.json().active, true);
}
const owner = () => ({
  tenantId: admin.tenantId,
  userId: admin.userId,
  role: "owner",
});
async function job(id: string) {
  const [row] = await db.tenant(owner(), (tx) =>
    tx.query("SELECT * FROM jobs WHERE id=$1", [id]),
  );
  return row;
}
async function requestReset() {
  const response = await api("/auth/forgot-password", "POST", {
    email: admin.email,
  });
  assert.equal(response.statusCode, 200, response.body);
  const [row] = await db.tenant(owner(), (tx) =>
    tx.query(
      "SELECT * FROM jobs WHERE intent_key LIKE 'reset:%' AND status='pending' ORDER BY created_at DESC LIMIT 1",
    ),
  );
  assert.ok(row, "A reset email is queued");
  return row;
}
/** Claims a job exactly as the worker does, then runs one delivery. */
async function deliver(id: string, send: (...args: any[]) => Promise<void>) {
  const [claimed] = await db.tenant(owner(), (tx) =>
    tx.query(
      "UPDATE jobs SET leased_until=now()+interval '2 minutes',attempts=attempts+1 WHERE id=$1 RETURNING *",
      [id],
    ),
  );
  await withRuntimeConfig(await loadRuntimeSettings(db), () =>
    executeEmailDelivery(db, admin.tenantId, claimed, send),
  );
  return job(id);
}

before(async () => {
  process.env.SECURITY_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  process.env.APP_NAME = "Environment name";
  process.env.FILE_IMPORTS_APPROVED = "true";
  db = await createDatabase({ memory: true, url: "" });
  app = await buildApp({ db, testing: true });
  // Test-only probe route: reports what the request lifecycle sees after the body.
  app.post(
    "/__settings_probe",
    {
      onRequest: (request, _reply, done) => {
        (request as any).headersAt = Date.now();
        done();
      },
    },
    async (request) => ({
      name: runtimeConfig().APP_NAME,
      imports: runtimeConfig().FILE_IMPORTS_APPROVED,
      length: String((request.body as any)?.padding ?? "").length,
      waited: Date.now() - (request as any).headersAt,
    }),
  );
  const registered = await api("/auth/register", "POST", {
    name: "Settings operator",
    email: "fix-settings@example.test",
    password: "SyntheticFixSettings2026!",
    slug: "fix-settings",
    accepted: true,
  });
  assert.equal(registered.statusCode, 201, registered.body);
  cookie = String(registered.headers["set-cookie"]).split(";")[0];
  const actor = (await api("/bootstrap")).json().user;
  admin = {
    tenantId: actor.tenantId,
    userId: actor.userId,
    email: "fix-settings@example.test",
  };
  await db.system(async (tx) => {
    await tx.query("UPDATE users SET platform_role='admin' WHERE id=$1", [
      actor.userId,
    ]);
    await tx.query("UPDATE sessions SET mfa_at=now() WHERE token_hash=$1", [
      tokenHash(cookie.slice("session=".length)),
    ]);
  });
});
after(async () => {
  await app?.close();
  await db?.close();
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("saved settings reach the handler when the request body arrives in later socket writes", async () => {
  const saved = await api("/admin/settings/application", "PUT", {
    revision: (await application()).revision,
    enabled: true,
    values: { APP_NAME: "Saved name", FILE_IMPORTS_APPROVED: "false" },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const { port } = app.server.address() as AddressInfo;
  const send = (chunks: string[], delay: number) =>
    new Promise<{ status: number; body: any }>((resolve, reject) => {
      const body = chunks.join("");
      const request = httpRequest(
        {
          host: "127.0.0.1",
          port,
          path: "/__settings_probe",
          method: "POST",
          headers: {
            origin,
            "content-type": "application/json",
            "content-length": Buffer.byteLength(body),
          },
        },
        (response) => {
          let text = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => (text += chunk));
          response.on("end", () =>
            resolve({
              status: response.statusCode ?? 0,
              body: JSON.parse(text),
            }),
          );
        },
      );
      request.on("error", reject);
      // Headers first, then each body part in a separate delayed write.
      request.flushHeaders();
      let index = 0;
      const next = () => {
        if (index === chunks.length) return request.end();
        request.write(chunks[index++]);
        setTimeout(next, delay);
      };
      setTimeout(next, delay);
    });
  const padding = "x".repeat(256 * 1024);
  const whole = JSON.stringify({ padding });
  const split = [
    whole.slice(0, 1000),
    whole.slice(1000, 128 * 1024),
    whole.slice(128 * 1024),
  ];
  for (const [chunks, delay] of [
    [[whole], 0],
    [split, 50],
  ] as const) {
    const result = await send([...chunks], delay);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    // The split body was still arriving well after onRequest completed.
    if (delay) assert.ok(result.body.waited >= 2 * delay, result.body.waited);
    delete result.body.waited;
    assert.deepEqual(result.body, {
      name: "Saved name",
      imports: "false",
      length: padding.length,
    });
  }
});

test("application settings reject blanks, drop the unused legal version and read stored blanks as defaults", async () => {
  const definition = INTEGRATION_CATALOG.find(
    (item) => item.id === "application",
  )!;
  assert.equal(
    definition.fields.some((field) => field.key === "LEGAL_VERSION"),
    false,
    "Legal versions come from the published document registry",
  );
  let current = await application();
  assert.equal(Object.hasOwn(current.values, "LEGAL_VERSION"), false);
  for (const values of [
    { APP_NAME: "" },
    { APP_NAME: "   " },
    { LEGAL_APPROVED: "" },
    { NUTRITION_ENABLED: "yes" },
    { LEGAL_VERSION: "terms-v9" },
  ]) {
    const response = await api("/admin/settings/application", "PUT", {
      revision: current.revision,
      enabled: true,
      values,
    });
    assert.equal(response.statusCode, 400, JSON.stringify(values));
    assert.equal(response.json().code, "SETTINGS_INVALID");
  }
  assert.equal((await application()).revision, current.revision);
  // Rows saved before validation may hold blanks; they read as the defaults.
  await db.system((tx) =>
    tx.query(
      `UPDATE platform_settings SET settings_values=settings_values||'{"APP_NAME":"","LEGAL_VERSION":"","LEGAL_APPROVED":"","SUPPORT_EMAIL":""}'::jsonb WHERE integration_id='application'`,
    ),
  );
  current = await application();
  assert.equal(current.values.APP_NAME, "trainsyou");
  assert.equal(current.values.LEGAL_APPROVED, "false");
  assert.equal(current.values.SUPPORT_EMAIL, "");
  assert.equal(Object.hasOwn(current.values, "LEGAL_VERSION"), false);
  const runtime = await loadRuntimeSettings(db);
  assert.equal(runtime.APP_NAME, "trainsyou");
  assert.equal(runtime.LEGAL_APPROVED, "false");
  assert.equal(Object.hasOwn(runtime, "LEGAL_VERSION"), false);
  // The settings form resubmits every displayed value.
  const resaved = await api("/admin/settings/application", "PUT", {
    revision: current.revision,
    enabled: true,
    values: current.values,
  });
  assert.equal(resaved.statusCode, 200, resaved.body);
  assert.equal(resaved.json().values.APP_NAME, "trainsyou");
});

test("an edited email integration defers account email until retested, then delivers once without keeping the link", async () => {
  await saveEmail("noreply@example.test");
  await testEmail();
  const queued = await requestReset();
  assert.equal(queued.data.sensitive, true);
  assert.ok(Date.parse(queued.data.expiresAt) > Date.now());
  // Editing only the sender clears the test, so the integration is inactive.
  await saveEmail("accounts@example.test");
  const sent: string[] = [];
  const send = async (_to: string, _subject: string, text: string) => {
    sent.push(text);
  };
  let row = await deliver(queued.id, send);
  assert.equal(sent.length, 0);
  assert.equal(row.status, "pending");
  assert.equal(row.attempts, 0, "Waiting is not a delivery attempt");
  assert.equal(row.leased_until, null);
  assert.ok(new Date(row.available_at).getTime() > Date.now());
  assert.match(row.last_error, /configuration/i);
  await testEmail();
  await db.tenant(owner(), (tx) =>
    tx.query("UPDATE jobs SET available_at=now() WHERE id=$1", [queued.id]),
  );
  row = await deliver(queued.id, send);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /\/reset-password\/[A-Za-z0-9_-]{20,}/);
  assert.equal(row.status, "completed");
  assert.equal(row.data.deliveryState, "delivered");
  assert.equal(Object.hasOwn(row.data, "text"), false);
  // A link that expired while waiting is never sent and does not keep the link.
  const expired = await requestReset();
  await db.tenant(owner(), (tx) =>
    tx.query(
      `UPDATE jobs SET data=data||jsonb_build_object('expiresAt',now()-interval '1 minute') WHERE id=$1`,
      [expired.id],
    ),
  );
  row = await deliver(expired.id, send);
  assert.equal(sent.length, 1);
  assert.equal(row.status, "failed");
  assert.equal(Object.hasOwn(row.data, "text"), false);
  // Other email waits at most a day for configuration, then fails unsent.
  await saveEmail("support@example.test");
  const stale = randomUUID();
  await db.tenant(owner(), (tx) =>
    tx.query(
      "INSERT INTO jobs(id,tenant_id,kind,intent_key,data,created_at) VALUES($1,$2,'email',$3,$4,now()-interval '25 hours')",
      [
        stale,
        admin.tenantId,
        "fixture:" + stale,
        JSON.stringify({
          to: admin.email,
          subject: "Account notice",
          text: "Fixture notice",
          category: "account",
        }),
      ],
    ),
  );
  row = await deliver(stale, send);
  assert.equal(sent.length, 1);
  assert.equal(row.status, "failed");
  assert.match(row.last_error, /24 hours/);
  await testEmail();
});

test("email reconciliation never returns a bearer link and a confirmed delivery removes it", async () => {
  const leaked = (body: string) =>
    /reset-password\/[A-Za-z0-9_-]{20,}/.test(body);
  const blocked = async () => {
    const queued = await requestReset();
    const row = await deliver(queued.id, async () => {
      throw new Error("Connection ended after dispatch");
    });
    assert.equal(row.status, "blocked");
    assert.equal(row.data.deliveryState, "unknown");
    return row;
  };
  const reconcile = (row: any, outcome: string) =>
    api(
      `/admin/tenants/${admin.tenantId}/email-jobs/${row.id}/reconcile`,
      "POST",
      {
        attempts: row.attempts,
        outcome,
        evidenceReference: "Provider log fixture reference",
      },
    );
  const retry = await blocked();
  const notSent = await reconcile(retry, "not_sent");
  assert.equal(notSent.statusCode, 200, notSent.body);
  assert.equal(leaked(notSent.body), false, notSent.body);
  assert.deepEqual(notSent.json().data, { deliveryState: "not_sent" });
  const sent: string[] = [];
  const row = await deliver(retry.id, async (_to, _subject, text) => {
    sent.push(text);
  });
  assert.equal(sent.length, 1);
  assert.equal(row.status, "completed");
  assert.equal(Object.hasOwn(row.data, "text"), false);
  const confirmed = await blocked();
  const delivered = await reconcile(confirmed, "delivered");
  assert.equal(delivered.statusCode, 200, delivered.body);
  assert.equal(leaked(delivered.body), false, delivered.body);
  const after = await job(confirmed.id);
  assert.equal(after.status, "completed");
  assert.equal(Object.hasOwn(after.data, "text"), false);
});

test("a changed security key fails closed with a recovery path and a host reset needs no lost key", async () => {
  const password = "SyntheticMfaRecovery2026!";
  async function account(slug: string) {
    const registered = await call(
      "/auth/register",
      "POST",
      {
        name: "Recovery " + slug,
        email: slug + "@example.test",
        password,
        slug,
        accepted: true,
      },
      "",
    );
    assert.equal(registered.statusCode, 201, registered.body);
    return {
      email: slug + "@example.test",
      cookie: String(registered.headers["set-cookie"]).split(";")[0],
    };
  }
  async function enroll(session: string) {
    const started = await call(
      "/auth/mfa/enroll",
      "POST",
      { password },
      session,
    );
    assert.equal(started.statusCode, 200, started.body);
    const secret = started.json().secret;
    const confirmed = await call(
      "/auth/mfa/confirm",
      "POST",
      { code: totpAt(secret, Math.floor(Date.now() / 30000)) },
      session,
    );
    assert.equal(confirmed.statusCode, 200, confirmed.body);
    return secret;
  }
  // The window after the enrollment code is unused and still accepted.
  const nextCode = (secret: string) =>
    totpAt(secret, Math.floor(Date.now() / 30000) + 1);
  const login = (email: string, code?: string) =>
    call(
      "/auth/login",
      "POST",
      { email, password, ...(code ? { code } : {}) },
      "",
    );
  const withCode = await account("fix-mfa-codes");
  const oldSecret = await enroll(withCode.cookie);
  const codes = await call(
    "/auth/mfa/recovery-codes",
    "POST",
    { password },
    withCode.cookie,
  );
  assert.equal(codes.statusCode, 200, codes.body);
  const withoutCode = await account("fix-mfa-none");
  await enroll(withoutCode.cookie);
  const original = process.env.SECURITY_ENCRYPTION_KEY;
  process.env.SECURITY_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  try {
    const refused = await login(withCode.email, nextCode(oldSecret));
    assert.equal(refused.statusCode, 503, refused.body);
    assert.equal(refused.json().code, "MFA_KEY_UNAVAILABLE");
    assert.match(refused.json().message, /recovery code/);
    const recovered = await call(
      "/auth/mfa/recover",
      "POST",
      { email: withCode.email, password, recoveryCode: codes.json().codes[0] },
      "",
    );
    assert.equal(recovered.statusCode, 200, recovered.body);
    const session = String(recovered.headers["set-cookie"]).split(";")[0];
    const newSecret = await enroll(session);
    const signedIn = await login(withCode.email, nextCode(newSecret));
    assert.equal(signedIn.statusCode, 200, signedIn.body);
    // No passkey and no recovery code: only the host operator can help.
    const locked = await login(withoutCode.email, "123456");
    assert.equal(locked.statusCode, 503, locked.body);
    assert.equal(locked.json().code, "MFA_KEY_UNAVAILABLE");
    const result = await resetAccountMfa(db, withoutCode.email.toUpperCase());
    assert.equal(result.authenticatorWasSet, true);
    assert.equal(
      (await call("/bootstrap", "GET", undefined, withoutCode.cookie))
        .statusCode,
      401,
      "Existing sessions are revoked",
    );
    const reset = await login(withoutCode.email);
    assert.equal(reset.statusCode, 200, reset.body);
    const fresh = String(reset.headers["set-cookie"]).split(";")[0];
    const security = await call("/auth/security", "GET", undefined, fresh);
    assert.equal(security.statusCode, 200, security.body);
    assert.equal(security.json().mfaEnabled, false);
    const [audit] = await db.system((tx) =>
      tx.query(
        "SELECT count(*)::int AS n FROM events WHERE name='security.authenticator_reset' AND subject_id=$1",
        [result.userId],
      ),
    );
    assert.equal(audit.n, 1);
    const [notice] = await db.system((tx) =>
      tx.query(
        "SELECT data FROM jobs WHERE intent_key LIKE 'auth-reset:%' AND data->>'to'=$1",
        [withoutCode.email],
      ),
    );
    assert.match(notice.data.text, /reset your authenticator/);
    // Re-enrollment seals the new authenticator under the current key.
    await enroll(fresh);
    // A missing key is reported the same way and never disables MFA.
    delete process.env.SECURITY_ENCRYPTION_KEY;
    const missing = await login(withCode.email, "123456");
    assert.equal(missing.statusCode, 503, missing.body);
    assert.equal(missing.json().code, "MFA_KEY_UNAVAILABLE");
  } finally {
    process.env.SECURITY_ENCRYPTION_KEY = original;
  }
});
