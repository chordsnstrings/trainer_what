import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, randomBytes, randomUUID } from "node:crypto";
import { createDatabase, type Database } from "@trainer/db";
import { ProviderUnavailable } from "@trainer/providers";
import { buildApp } from "../apps/api/src/app.ts";
import { tokenHash } from "../apps/api/src/auth.ts";
import { loadRuntimeSettings } from "../apps/api/src/platform-settings.ts";
import { consumeMfa, totpAt } from "../apps/api/src/security.ts";
import {
  openIntegrationSecret,
  sealIntegrationSecret,
} from "../apps/api/src/integrations-completion.ts";
import {
  encryptionKeyId,
  encryptionKeyring,
  encryptionReady,
  openSealedValue,
  sealContexts,
  SealingUnavailable,
} from "../apps/api/src/sealing.ts";
import { resealSecrets, sealedTotals } from "../apps/api/src/key-rotation.ts";

const names = [
  "SECURITY_ENCRYPTION_KEY",
  "SECURITY_ENCRYPTION_PREVIOUS_KEYS",
] as const;
const environment = Object.fromEntries(
  names.map((name) => [name, process.env[name]]),
);
const keyA = randomBytes(32),
  keyB = randomBytes(32),
  keyC = randomBytes(32);
const b64 = (key: Buffer) => key.toString("base64");
function useKeys(active: Buffer | null, previous?: string) {
  if (active) process.env.SECURITY_ENCRYPTION_KEY = b64(active);
  else delete process.env.SECURITY_ENCRYPTION_KEY;
  if (previous === undefined)
    delete process.env.SECURITY_ENCRYPTION_PREVIOUS_KEYS;
  else process.env.SECURITY_ENCRYPTION_PREVIOUS_KEYS = previous;
}
/** Exactly the envelopes written before key identifiers existed. */
function legacySeal(key: Buffer, value: string, aad: string | null) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv);
  if (aad !== null) cipher.setAAD(Buffer.from(aad));
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const parts = [iv, cipher.getAuthTag(), body].map((x) =>
    x.toString("base64url"),
  );
  return (aad === null ? parts : ["v1", ...parts]).join(".");
}

const stripeKey = "stripe_rotation_fixture_key",
  webhookSecret = "whsec_rotation_fixture_only",
  totpSecret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
  tokens = { access_token: "rotation_access_fixture", expires_in: 3600 },
  endpoint = "https://push.example.test/rotation/" + randomUUID();
const oauthStates = 105; // More than one re-seal page.
let db: Database,
  app: Awaited<ReturnType<typeof buildApp>>,
  owner: any,
  second: any,
  cookie = "",
  pushId = "";
const scope = (a: any) => `${a.tenantId}:${a.userId}:whoop`;
const request = (url: string, method: any = "GET", payload?: unknown) =>
  app.inject({
    url: "/api/v1" + url,
    method,
    headers: { origin: "http://localhost:3000", cookie },
    payload: payload as any,
  });
async function register(slug: string) {
  const r = await app.inject({
    url: "/api/v1/auth/register",
    method: "POST",
    headers: { origin: "http://localhost:3000" },
    payload: {
      name: "Rotation operator",
      email: slug + "@example.test",
      password: "SyntheticRotation2026!",
      slug,
      accepted: true,
    },
  });
  assert.equal(r.statusCode, 201, r.body);
  const session = String(r.headers["set-cookie"]).split(";")[0];
  const me = await app.inject({
    url: "/api/v1/bootstrap",
    headers: { origin: "http://localhost:3000", cookie: session },
  });
  return { ...me.json().user, cookie: session };
}
async function mfaAccepted(a = owner) {
  return db.system(async (tx) => {
    await tx.query(
      "UPDATE user_security SET last_counter=-1 WHERE user_id=$1",
      [a.userId],
    );
    return consumeMfa(
      tx,
      a.userId,
      totpAt(totpSecret, Math.floor(Date.now() / 30000)),
    );
  });
}
async function storedEnvelopes() {
  return db.system(async (tx) => {
    const settings = await tx.query(
      "SELECT encrypted_secrets FROM platform_settings ORDER BY integration_id",
    );
    const rows = await tx.query(
      "SELECT totp_secret AS v FROM user_security WHERE totp_secret IS NOT NULL UNION ALL SELECT credentials FROM integration_connections WHERE credentials IS NOT NULL UNION ALL SELECT verifier FROM integration_oauth_states WHERE verifier<>'' UNION ALL SELECT encrypted_endpoint FROM push_subscriptions",
    );
    return [
      ...settings.flatMap((row) =>
        Object.values(row.encrypted_secrets as Record<string, string>),
      ),
      ...rows.map((row) => row.v as string),
    ].sort();
  });
}
async function versions() {
  return db.system((tx) =>
    tx.query(
      "SELECT (SELECT json_agg(json_build_object('id',integration_id,'revision',revision,'test',last_test,'at',updated_at) ORDER BY integration_id) FROM platform_settings) AS settings,(SELECT json_agg(version ORDER BY id) FROM integration_connections) AS connections",
    ),
  );
}
async function everythingReadable() {
  const runtime = await loadRuntimeSettings(db);
  assert.equal(runtime.STRIPE_SECRET_KEY, stripeKey);
  assert.equal(runtime.STRIPE_WEBHOOK_SECRET, webhookSecret);
  assert.equal(await mfaAccepted(), true);
  for (const a of [owner, second]) {
    const [row] = await db.system((tx) =>
      tx.query(
        "SELECT credentials FROM integration_connections WHERE user_id=$1",
        [a.userId],
      ),
    );
    assert.deepEqual(openIntegrationSecret(scope(a), row.credentials), tokens);
  }
  const [push] = await db.system((tx) =>
    tx.query("SELECT encrypted_endpoint FROM push_subscriptions WHERE id=$1", [
      pushId,
    ]),
  );
  assert.equal(
    openIntegrationSecret(
      `push:${owner.tenantId}:${owner.userId}:${pushId}`,
      push.encrypted_endpoint,
    ),
    endpoint,
  );
  const states = await db.system((tx) =>
    tx.query(
      "SELECT tenant_id,user_id,verifier FROM integration_oauth_states WHERE verifier<>''",
    ),
  );
  assert.equal(states.length, oauthStates);
  for (const state of states)
    assert.equal(
      openIntegrationSecret(
        `${state.tenant_id}:${state.user_id}:whoop`,
        state.verifier,
      ),
      "verifier-fixture",
    );
}

before(async () => {
  useKeys(keyA);
  db = await createDatabase({ memory: true, url: "" });
  app = await buildApp({ db, testing: true });
  owner = await register("key-rotation-one");
  second = await register("key-rotation-two");
  cookie = owner.cookie;
  await db.system(async (tx) => {
    await tx.query("UPDATE users SET platform_role='admin' WHERE id=$1", [
      owner.userId,
    ]);
    await tx.query("UPDATE sessions SET mfa_at=now() WHERE token_hash=$1", [
      tokenHash(cookie.slice("session=".length)),
    ]);
  });
  const saved = await request("/admin/settings/stripe", "PUT", {
    revision: 0,
    enabled: false,
    values: {},
    secrets: {
      STRIPE_SECRET_KEY: stripeKey,
      STRIPE_WEBHOOK_SECRET: webhookSecret,
    },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  // Values written by the previous release: versioned without key id, and TOTP unversioned.
  const [{ session_id }] = await db.system((tx) =>
    tx.query("SELECT session_id FROM sessions WHERE user_id=$1 LIMIT 1", [
      owner.userId,
    ]),
  );
  pushId = randomUUID();
  await db.system(async (tx) => {
    await tx.query(
      "UPDATE platform_settings SET encrypted_secrets=jsonb_set(encrypted_secrets,'{STRIPE_WEBHOOK_SECRET}',to_jsonb($1::text)) WHERE integration_id='stripe'",
      [
        legacySeal(
          keyA,
          webhookSecret,
          "platform-settings:v1:stripe:STRIPE_WEBHOOK_SECRET",
        ),
      ],
    );
    await tx.query(
      "INSERT INTO user_security(user_id,totp_secret,enabled) VALUES($1,$2,true)",
      [owner.userId, legacySeal(keyA, totpSecret, null)],
    );
    for (const a of [owner, second])
      await tx.query(
        "INSERT INTO integration_connections(id,tenant_id,user_id,provider,status,credentials) VALUES($1,$2,$3,'whoop','active',$4)",
        [
          randomUUID(),
          a.tenantId,
          a.userId,
          a === owner
            ? legacySeal(
                keyA,
                JSON.stringify(tokens),
                "integration-v1:" + scope(a),
              )
            : sealIntegrationSecret(scope(a), tokens),
        ],
      );
    for (let i = 0; i <= oauthStates; i++)
      await tx.query(
        "INSERT INTO integration_oauth_states(state_hash,tenant_id,user_id,provider,session_hash,verifier,origin,expires_at,consumed_at) VALUES($1,$2,$3,'whoop','fixture',$4,'http://localhost:3000',now()+interval '10 minutes',$5)",
        [
          `state-${String(i).padStart(4, "0")}`,
          owner.tenantId,
          owner.userId,
          // The last state is consumed: its cleared verifier is not a sealed value.
          i === oauthStates
            ? ""
            : sealIntegrationSecret(scope(owner), "verifier-fixture"),
          i === oauthStates ? new Date().toISOString() : null,
        ],
      );
    await tx.query(
      "INSERT INTO push_subscriptions(id,tenant_id,user_id,session_id,endpoint_hash,encrypted_endpoint,vapid_key_id,label,expires_at) VALUES($1,$2,$3,$4,'hash-fixture',$5,'vapid-fixture','Rotation browser',now()+interval '1 day')",
      [
        pushId,
        owner.tenantId,
        owner.userId,
        session_id,
        legacySeal(
          keyA,
          JSON.stringify(endpoint),
          `integration-v1:push:${owner.tenantId}:${owner.userId}:${pushId}`,
        ),
      ],
    );
  });
});
after(async () => {
  await app.close();
  await db.close();
  for (const name of names)
    if (environment[name] === undefined) delete process.env[name];
    else process.env[name] = environment[name];
});

test("envelopes written before key identifiers still open with the unchanged key", async () => {
  useKeys(keyA);
  await everythingReadable();
  const totals = sealedTotals(await resealSecrets(db, { apply: false }));
  // Stripe webhook, one wearable connection and the push endpoint are legacy.
  // The authenticator was legacy too, but verifying a code upgrades it to the
  // active envelope on use.
  assert.deepEqual(totals, {
    active: oauthStates + 3,
    legacy: 3,
    previous: 0,
    unreadable: 0,
    resealed: 0,
  });
});

test("new seals record the active key id; previous keys decrypt but never encrypt", async () => {
  useKeys(keyA);
  const kidA = encryptionKeyId(keyA),
    kidB = encryptionKeyId(keyB);
  assert.notEqual(kidA, kidB);
  assert.ok(sealIntegrationSecret("x", 1).startsWith(`v2.${kidA}.`));
  const sealedWithA = sealIntegrationSecret("tenant:user:whoop", tokens);
  // Whitespace, duplicates and a copy of the active key are tolerated.
  useKeys(keyB, ` ${b64(keyA)},${b64(keyB)}\n${b64(keyA)} `);
  assert.deepEqual(
    encryptionKeyring().previous.map((key) => key.id),
    [kidA],
  );
  assert.deepEqual(
    openIntegrationSecret("tenant:user:whoop", sealedWithA),
    tokens,
  );
  assert.equal(
    openSealedValue(sealContexts.integration("tenant:user:whoop"), sealedWithA)
      .state,
    "previous",
  );
  const sealedWithB = sealIntegrationSecret("tenant:user:whoop", tokens);
  assert.ok(sealedWithB.startsWith(`v2.${kidB}.`));
  assert.equal(
    openSealedValue(sealContexts.integration("tenant:user:whoop"), sealedWithB)
      .state,
    "active",
  );
  // Purpose binding still holds for current envelopes.
  assert.throws(
    () => openIntegrationSecret("other:user:whoop", sealedWithB),
    (error: any) => error.code === "INTEGRATION_CREDENTIALS",
  );
  await everythingReadable();
  const inspected = sealedTotals(await resealSecrets(db, { apply: false }));
  // Verifying the authenticator re-sealed it under the active key on use.
  assert.equal(inspected.previous, oauthStates + 5);
  assert.equal(inspected.active, 1);
  assert.equal(inspected.legacy + inspected.unreadable, 0);
  // A previous key alone is never enough to open or seal.
  useKeys(null, b64(keyA));
  assert.equal(encryptionReady(), false);
  assert.throws(
    () => openIntegrationSecret("tenant:user:whoop", sealedWithA),
    (error: any) => error.code === "INTEGRATION_CREDENTIALS",
  );
  assert.throws(
    () => sealIntegrationSecret("tenant:user:whoop", tokens),
    (error: any) => error.code === "ENCRYPTION_REQUIRED",
  );
});

test("re-seal rewrites every sealed value under the active key once and reports counts only", async () => {
  useKeys(keyB, b64(keyA));
  const kidB = encryptionKeyId(keyB);
  const before = await storedEnvelopes(),
    unchanged = await versions();
  assert.equal(before.length, oauthStates + 6);
  const inspected = await resealSecrets(db, { apply: false });
  assert.deepEqual(await storedEnvelopes(), before, "inspection never writes");
  const first = await resealSecrets(db, { apply: true });
  const totals = sealedTotals(first);
  // The authenticator was already upgraded on use in the previous test.
  assert.equal(totals.resealed, before.length - 1);
  assert.equal(totals.previous, before.length - 1);
  assert.equal(totals.unreadable, 0);
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(first).map(([k, v]) => [k, { ...v, resealed: 0 }]),
    ),
    inspected,
  );
  assert.deepEqual(first.platformSettings.resealed, 2);
  assert.deepEqual(first.authenticators.resealed, 0);
  assert.deepEqual(first.wearableConnections.resealed, 2);
  assert.deepEqual(first.wearableAuthorizations.resealed, oauthStates);
  assert.deepEqual(first.pushSubscriptions.resealed, 1);
  const serialized = JSON.stringify(first);
  for (const value of [
    stripeKey,
    webhookSecret,
    totpSecret,
    endpoint,
    ...before,
  ])
    assert.ok(!serialized.includes(value));
  for (const counts of Object.values(first))
    for (const value of Object.values(counts))
      assert.equal(typeof value, "number");
  const after = await storedEnvelopes();
  assert.equal(after.length, before.length);
  for (const envelope of after) assert.ok(envelope.startsWith(`v2.${kidB}.`));
  assert.deepEqual(
    await versions(),
    unchanged,
    "re-wrapping changes no revision, test result or connection version",
  );
  const [consumed] = await db.system((tx) =>
    tx.query(
      "SELECT verifier FROM integration_oauth_states WHERE consumed_at IS NOT NULL",
    ),
  );
  assert.equal(consumed.verifier, "");
  const repeat = sealedTotals(await resealSecrets(db, { apply: true }));
  assert.deepEqual(repeat, {
    active: before.length,
    legacy: 0,
    previous: 0,
    unreadable: 0,
    resealed: 0,
  });
  assert.deepEqual(await storedEnvelopes(), after);
  // The retired key can now be removed.
  useKeys(keyB);
  await everythingReadable();
  assert.equal(
    sealedTotals(await resealSecrets(db, { apply: false })).active,
    before.length,
  );
});

test("a wrong or missing key still fails closed and re-seal leaves unreadable values untouched", async () => {
  useKeys(keyC);
  const before = await storedEnvelopes();
  const runtime = await loadRuntimeSettings(db);
  assert.equal(runtime.STRIPE_SECRET_KEY, "");
  assert.equal(runtime.STRIPE_WEBHOOK_SECRET, "");
  assert.equal(runtime.COMMERCE_APPROVED, "false");
  const stripe = (await request("/admin/settings"))
    .json()
    .integrations.find((item: any) => item.id === "stripe");
  assert.equal(stripe.active, false);
  assert.equal(stripe.credentialStatus, "credentials_unreadable");
  await assert.rejects(mfaAccepted());
  const [row] = await db.system((tx) =>
    tx.query(
      "SELECT credentials FROM integration_connections WHERE user_id=$1",
      [owner.userId],
    ),
  );
  assert.throws(
    () => openIntegrationSecret(scope(owner), row.credentials),
    (error: any) =>
      error.statusCode === 503 && error.code === "INTEGRATION_CREDENTIALS",
  );
  const wrong = sealedTotals(await resealSecrets(db, { apply: true }));
  assert.equal(wrong.unreadable, before.length);
  assert.equal(wrong.resealed + wrong.active + wrong.previous, 0);
  assert.deepEqual(await storedEnvelopes(), before);

  useKeys(keyB, "not-a-32-byte-key");
  assert.equal(encryptionKeyring().invalidPrevious, 1);
  await assert.rejects(
    resealSecrets(db, { apply: true }),
    /must decode to 32 bytes/,
  );
  assert.equal(
    sealedTotals(await resealSecrets(db, { apply: false })).active,
    before.length,
  );

  useKeys(null);
  await assert.rejects(
    resealSecrets(db, { apply: false }),
    (error: any) =>
      error instanceof SealingUnavailable && error.reason === "key_unavailable",
  );
  await assert.rejects(
    mfaAccepted(),
    (error: any) => error instanceof ProviderUnavailable,
  );
  const refused = await request("/admin/settings/stripe", "PUT", {
    revision: stripe.revision,
    enabled: false,
    values: {},
    secrets: { STRIPE_WEBHOOK_SECRET: "whsec_rotation_replacement" },
  });
  assert.equal(refused.statusCode, 503);
  assert.equal(refused.json().code, "ENCRYPTION_UNAVAILABLE");
  assert.throws(
    () => sealIntegrationSecret(scope(owner), tokens),
    (error: any) => error.code === "ENCRYPTION_REQUIRED",
  );
  assert.deepEqual(await storedEnvelopes(), before);
});
