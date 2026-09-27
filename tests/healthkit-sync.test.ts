import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  createDatabase,
  elevated,
  putRecord,
  type Actor,
  type Database,
} from "@trainer/db";
import { integrationStatus } from "@trainer/providers";
import { buildApp } from "../apps/api/src/app.ts";
import { newToken, tokenHash } from "../apps/api/src/auth.ts";
import { signHostRequest, HOST_HEADERS } from "../apps/api/src/host-routing.ts";
import {
  failureBudget,
  maintainHealthKitSync,
} from "../apps/api/src/healthkit-sync.ts";
import { privacyHooks } from "../apps/api/src/privacy-hooks.ts";
import { seedScope } from "./scope-fixtures.ts";

// Synthetic fixtures only: no companion app, Apple service or provider is contacted.
const proofKey = "synthetic-healthkit-host-proof-key-32-bytes";
const envKeys = [
  "NODE_ENV",
  "PUBLIC_APP_URL",
  "INTERNAL_PROXY_SECRET",
  "FILE_IMPORTS_APPROVED",
  "APPLE_IMPORTS_ENABLED",
  "HEALTHKIT_SYNC_ENABLED",
];
const saved = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
let db: Database, app: Awaited<ReturnType<typeof buildApp>>;
function setEnv(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values))
    if (value === undefined) Reflect.deleteProperty(process.env, key);
    else Object.assign(process.env, { [key]: value });
}
async function withEnv<T>(
  values: Record<string, string | undefined>,
  fn: () => Promise<T>,
) {
  const prior = Object.fromEntries(
    Object.keys(values).map((k) => [k, process.env[k]]),
  );
  setEnv(values);
  try {
    return await fn();
  } finally {
    setEnv(prior);
  }
}
let address = 0;
type CallOptions = {
  method?: string;
  body?: unknown;
  cookie?: string;
  token?: string;
  customHost?: string;
  origin?: string | null;
  remote?: string;
};
function call(path: string, o: CallOptions = {}) {
  const url = "/api/v1" + path,
    method = o.method ?? (o.body === undefined ? "GET" : "POST"),
    time = String(Date.now());
  address++;
  return app.inject({
    method: method as any,
    url,
    payload: o.body as any,
    remoteAddress: o.remote ?? `10.61.${(address >> 8) & 255}.${address & 255}`,
    headers: {
      host: "localhost:3000",
      ...(o.origin === null
        ? {}
        : {
            origin:
              o.origin ??
              (o.customHost
                ? "https://" + o.customHost
                : "http://localhost:3000"),
          }),
      ...(o.cookie ? { cookie: o.cookie } : {}),
      ...(o.token ? { authorization: "Bearer " + o.token } : {}),
      ...(o.customHost
        ? {
            [HOST_HEADERS.host]: o.customHost,
            [HOST_HEADERS.time]: time,
            [HOST_HEADERS.signature]: signHostRequest(
              o.customHost,
              method,
              url,
              time,
              proofKey,
            ),
          }
        : {}),
    },
  });
}
async function ok(path: string, o: CallOptions = {}) {
  const r = await call(path, o);
  assert.ok(r.statusCode < 400, `${path}: ${r.statusCode} ${r.body}`);
  return r.json();
}
async function expectCode(
  path: string,
  o: CallOptions,
  status: number,
  code: string,
) {
  const r = await call(path, o);
  assert.equal(r.statusCode, status, `${path}: ${r.body}`);
  assert.equal(r.json().code, code, r.body);
  return r;
}
type Person = Actor & { cookie: string };
async function workspace(name: string) {
  const tenantId = randomUUID();
  await db.system((tx) =>
    tx.query(
      "INSERT INTO tenants(id,slug,name,published) VALUES($1,$2,$3,true)",
      [tenantId, "hk-" + tenantId.slice(0, 8), name],
    ),
  );
  return tenantId;
}
async function person(
  tenantId: string,
  role = "subscriber",
  options: { platformRole?: string; mfa?: boolean } = {},
): Promise<Person> {
  const userId = randomUUID(),
    token = newToken();
  await db.system(async (tx) => {
    await tx.query(
      "INSERT INTO users(id,name,email,password_hash,email_verified,platform_role) VALUES($1,'Synthetic member',$2,'fixture-unused',true,$3)",
      [userId, `hk-${userId}@example.test`, options.platformRole ?? "none"],
    );
    await tx.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)",
      [tenantId, userId, role],
    );
    await tx.query(
      "INSERT INTO sessions(token_hash,user_id,tenant_id,expires_at,mfa_at) VALUES($1,$2,$3,now()+interval '7 days',CASE WHEN $4 THEN now() ELSE NULL END)",
      [tokenHash(token), userId, tenantId, options.mfa ?? false],
    );
  });
  return { tenantId, userId, role, cookie: "session=" + token };
}
async function setPolicy(owner: Person, policy: string | null) {
  await db.tenant(seedScope(owner), async (tx) => {
    await tx.query(
      "DELETE FROM records WHERE kind='onboarding_step' AND data->>'step'='wearables'",
    );
    if (policy)
      await putRecord(
        tx,
        owner,
        "onboarding_step",
        { step: "wearables", values: { policy } },
        { status: "saved" },
      );
  });
}
async function pairDevice(p: Person, name = "Synthetic iPhone") {
  const code = await ok("/healthkit/pairing-codes", {
    body: { consent: true },
    cookie: p.cookie,
  });
  const paired = await ok("/healthkit/device/pair", {
    body: {
      code: code.code,
      deviceName: name,
      platform: "ios",
      appVersion: "1.0.0",
    },
    origin: null,
  });
  return paired as { deviceToken: string; device: { id: string } };
}
const DAY = 86400000;
// Local UAE time with its offset, as the companion app reports it.
const local = (ms: number) =>
  new Date(ms + 4 * 3600000).toISOString().replace("Z", "+04:00");
const dubaiDate = (daysAgo: number) =>
  new Date(Date.now() + 4 * 3600000 - daysAgo * DAY).toISOString().slice(0, 10);
const midnight = (date: string) => Date.parse(date + "T00:00:00+04:00");
let serial = 0;
const sampleId = () =>
  `0A1B2C3D-4E5F-4A6B-8C7D-${String(++serial).padStart(12, "0")}`;
function fullDay(daysAgo: number) {
  const date = dubaiDate(daysAgo),
    m = midnight(date),
    wake = sampleId();
  return {
    date,
    ids: { wake },
    samples: [
      {
        type: "resting_heart_rate",
        id: sampleId(),
        start: local(m + 7 * 3600000),
        end: local(m + 7 * 3600000),
        value: 54,
        unit: "count/min",
      },
      {
        type: "heart_rate_variability",
        id: sampleId(),
        start: local(m + 7 * 3600000),
        end: local(m + 7 * 3600000 + 60000),
        value: 58,
        unit: "ms",
      },
      {
        type: "body_mass",
        id: wake,
        start: local(m + 7.5 * 3600000),
        end: local(m + 7.5 * 3600000),
        value: 80.5,
        unit: "kg",
      },
      {
        type: "sleep_analysis",
        id: sampleId(),
        start: local(m - 1.5 * 3600000),
        end: local(m + 6 * 3600000),
        stage: "asleep_core",
      },
      {
        type: "workout",
        id: sampleId(),
        start: local(m + 18 * 3600000),
        end: local(m + 19 * 3600000),
        activity: "running",
        durationSeconds: 3000,
        activeEnergyKcal: 450,
        distanceMeters: 8000,
      },
      {
        type: "heart_rate",
        start: local(m + 18 * 3600000),
        end: local(m + 19 * 3600000),
        unit: "count/min",
        average: 131,
        minimum: 72,
        maximum: 168,
      },
      {
        type: "step_count",
        start: local(m),
        end: local(m + DAY),
        value: 11000,
        unit: "count",
      },
      {
        type: "active_energy",
        start: local(m),
        end: local(m + DAY),
        value: 640,
        unit: "kcal",
      },
    ],
  };
}
/**
 * A daily total whose local day ends `ms` from now. A whole-hour UTC offset is
 * chosen so that local midnight lies 23-25 hours before the end, as a device
 * in that time zone would report its current day.
 */
function totalEndingSoon(
  type: "step_count" | "active_energy",
  value: number,
  ms = 2500,
) {
  const end = Date.now() + ms,
    HOUR = 3600000;
  for (let offset = -12; offset <= 14; offset++) {
    const midnight =
      Math.round((end - DAY + offset * HOUR) / DAY) * DAY - offset * HOUR;
    const span = end - midnight;
    if (span < 23 * HOUR + 60000 || span > 25 * HOUR - 60000) continue;
    const zone =
      (offset < 0 ? "-" : "+") +
      String(Math.abs(offset)).padStart(2, "0") +
      ":00";
    const wall = (instant: number) =>
      new Date(instant + offset * HOUR).toISOString().slice(0, 23) + zone;
    return {
      end,
      sample: {
        type,
        start: wall(midnight),
        end: wall(end),
        value,
        unit: type === "step_count" ? "count" : "kcal",
      },
    };
  }
  throw new Error("no offset gives a day ending now");
}
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function records(p: Actor) {
  return db.tenant(seedScope(p), (tx) =>
    tx.query(
      "SELECT id,status,version,data FROM records WHERE kind='wearable' AND owner_user_id=$1 AND data->>'origin'='apple_healthkit' ORDER BY data->>'day'",
      [p.userId],
    ),
  );
}
async function device(p: Actor, id: string) {
  return (
    await db.tenant(seedScope(p), (tx) =>
      tx.query("SELECT * FROM healthkit_devices WHERE id=$1", [id]),
    )
  )[0];
}

before(async () => {
  setEnv({
    NODE_ENV: undefined,
    PUBLIC_APP_URL: "http://localhost:3000",
    INTERNAL_PROXY_SECRET: proofKey,
    FILE_IMPORTS_APPROVED: undefined,
    APPLE_IMPORTS_ENABLED: undefined,
    HEALTHKIT_SYNC_ENABLED: "true",
  });
  db = await createDatabase({ memory: true });
  app = await buildApp({ db, testing: true });
});
after(async () => {
  await app?.close();
  await db?.close();
  setEnv(saved);
});

test("platform switches, import approval and the coach policy gate pairing", async () => {
  const tenantId = await workspace("Gate studio");
  const owner = await person(tenantId, "owner"),
    member = await person(tenantId);
  await withEnv({ HEALTHKIT_SYNC_ENABLED: undefined }, async () => {
    const status = await ok("/healthkit/status", { cookie: member.cookie });
    assert.equal(status.available, false);
    assert.equal(status.code, "HEALTHKIT_SYNC_DISABLED");
    assert.match(status.message, /companion iPhone app/);
    await expectCode(
      "/healthkit/pairing-codes",
      { body: { consent: true }, cookie: member.cookie },
      503,
      "HEALTHKIT_SYNC_DISABLED",
    );
    await expectCode(
      "/healthkit/device/pair",
      {
        body: { code: "ABCD-EFGH-JKMN", deviceName: "Phone", platform: "ios" },
        origin: null,
      },
      503,
      "HEALTHKIT_SYNC_DISABLED",
    );
  });
  await withEnv(
    { NODE_ENV: "production", FILE_IMPORTS_APPROVED: undefined },
    () =>
      expectCode(
        "/healthkit/pairing-codes",
        { body: { consent: true }, cookie: member.cookie },
        503,
        "IMPORT_REVIEW_PENDING",
      ),
  );
  await withEnv({ APPLE_IMPORTS_ENABLED: "false" }, () =>
    expectCode(
      "/healthkit/pairing-codes",
      { body: { consent: true }, cookie: member.cookie },
      503,
      "APPLE_IMPORTS_DISABLED",
    ),
  );
  // Available on the platform, but the coach has not chosen automatic sync.
  assert.equal(
    (await ok("/healthkit/status", { cookie: member.cookie })).coachAllowsSync,
    false,
  );
  await expectCode(
    "/healthkit/pairing-codes",
    { body: { consent: true }, cookie: member.cookie },
    403,
    "HEALTHKIT_POLICY",
  );
  // The trainer opts in through the onboarding wearable policy.
  const saveResponse = await call("/onboarding/wearables", {
    method: "PUT",
    body: { version: 0, values: { policy: "permitted_imports_and_sync" } },
    cookie: owner.cookie,
  });
  assert.equal(saveResponse.statusCode, 200, saveResponse.body);
  const status = await ok("/healthkit/status", { cookie: member.cookie });
  assert.equal(status.available, true);
  assert.equal(status.coachAllowsSync, true);
  assert.equal(status.consent, false);
  await expectCode(
    "/healthkit/pairing-codes",
    { body: {}, cookie: member.cookie },
    400,
    "VALIDATION",
  );
  await expectCode(
    "/healthkit/pairing-codes",
    { body: { consent: true } },
    401,
    "AUTH_REQUIRED",
  );
  // Browser routes keep the origin check; only the device routes are exempt.
  await expectCode(
    "/healthkit/pairing-codes",
    {
      body: { consent: true },
      cookie: member.cookie,
      origin: "https://evil.example",
    },
    403,
    "ORIGIN_REJECTED",
  );
  // A coach who refuses wearable imports also blocks the export file import;
  // members learn this before choosing a file.
  assert.equal(
    (await ok("/integrations/connections", { cookie: member.cookie }))
      .coachAllowsImports,
    true,
  );
  await setPolicy(owner, "none");
  assert.equal(
    (await ok("/integrations/connections", { cookie: member.cookie }))
      .coachAllowsImports,
    false,
  );
  const refused = await ok("/healthkit/status", { cookie: member.cookie });
  assert.equal(refused.coachAllowsImports, false);
  assert.equal(refused.coachAllowsSync, false);
  await expectCode(
    "/wearables/import",
    {
      body: {
        source: "apple_health",
        consent: true,
        observations: [
          {
            type: "steps",
            value: 10,
            unit: "count",
            measuredAt: new Date().toISOString(),
          },
        ],
      },
      cookie: member.cookie,
    },
    403,
    "WEARABLE_POLICY",
  );
  await setPolicy(owner, null);
  await ok("/wearables/import", {
    body: {
      source: "apple_health",
      consent: true,
      observations: [
        {
          type: "steps",
          value: 10,
          unit: "count",
          measuredAt: new Date().toISOString(),
        },
      ],
    },
    cookie: member.cookie,
  });
  // The operator status report exposes the switch without implying approval.
  const entry = () =>
    integrationStatus().find((i) => i.id === "apple_healthkit");
  assert.deepEqual(
    { configured: entry()?.configured, approved: entry()?.approved },
    { configured: true, approved: true },
  );
  await withEnv(
    { NODE_ENV: "production", FILE_IMPORTS_APPROVED: undefined },
    async () =>
      assert.deepEqual(
        { configured: entry()?.configured, approved: entry()?.approved },
        { configured: true, approved: false },
      ),
  );
  await withEnv({ HEALTHKIT_SYNC_ENABLED: undefined }, async () =>
    assert.equal(entry()?.configured, false),
  );
});

test("a one-time pairing code becomes a hashed device token scoped to the member", async () => {
  const tenantId = await workspace("Pairing studio");
  const owner = await person(tenantId, "owner"),
    member = await person(tenantId);
  await setPolicy(owner, "permitted_imports_and_sync");
  const first = await ok("/healthkit/pairing-codes", {
    body: { consent: true },
    cookie: member.cookie,
  });
  assert.match(
    first.code,
    /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/,
  );
  assert.ok(Date.parse(first.expiresAt) - Date.now() <= 10 * 60000 + 5000);
  assert.equal(first.server, "http://localhost:3000");
  const second = await ok("/healthkit/pairing-codes", {
    body: { consent: true },
    cookie: member.cookie,
  });
  // Only a hash is stored, and a newer code cancels the older one.
  const stored = await db.system((tx) =>
    tx.query(
      "SELECT token_hash,consumed_at,payload FROM one_time_tokens WHERE purpose='healthkit_pair' AND user_id=$1 ORDER BY expires_at",
      [member.userId],
    ),
  );
  assert.equal(stored.length, 2);
  assert.ok(
    stored.every(
      (r) => !JSON.stringify(r).includes(first.code.replaceAll("-", "")),
    ),
  );
  assert.ok(stored[0].consumed_at);
  const consents = await db.tenant(seedScope(member), (tx) =>
    tx.query(
      "SELECT granted,document_version FROM consent_records WHERE user_id=$1 AND document_type='wearable:apple_health'",
      [member.userId],
    ),
  );
  assert.equal(consents.length, 2);
  assert.match(consents[0].document_version, /healthkit-sync:v1$/);
  await expectCode(
    "/healthkit/device/pair",
    {
      body: { code: first.code, deviceName: "Old code", platform: "ios" },
      origin: null,
    },
    400,
    "PAIRING_CODE_INVALID",
  );
  // Codes are accepted without separators, in lower case and with O/I look-alikes.
  const typed = second.code.replaceAll("-", "").toLowerCase();
  const paired = await ok("/healthkit/device/pair", {
    body: {
      code: typed,
      deviceName: "Sara’s iPhone",
      platform: "ios",
      appVersion: "1.2.0",
    },
    origin: null,
  });
  assert.match(
    paired.deviceToken,
    new RegExp(`^hk1\\.${tenantId}\\.[A-Za-z0-9_-]{43}$`),
  );
  assert.deepEqual(paired.endpoints, {
    status: "/api/v1/healthkit/device/status",
    samples: "/api/v1/healthkit/device/samples",
    unpair: "/api/v1/healthkit/device/unpair",
  });
  assert.equal(paired.workspace.name, "Pairing studio");
  const row = await device(member, paired.device.id);
  assert.equal(
    row.token_hash,
    createHash("sha256").update(paired.deviceToken).digest("hex"),
  );
  assert.equal(JSON.stringify(row).includes(paired.deviceToken), false);
  assert.equal(row.user_id, member.userId);
  assert.equal(row.tenant_id, tenantId);
  await expectCode(
    "/healthkit/device/pair",
    {
      body: { code: second.code, deviceName: "Replay", platform: "ios" },
      origin: null,
    },
    400,
    "PAIRING_CODE_INVALID",
  );
  // An expired code cannot be exchanged.
  const third = await ok("/healthkit/pairing-codes", {
    body: { consent: true },
    cookie: member.cookie,
  });
  await db.system((tx) =>
    tx.query(
      "UPDATE one_time_tokens SET expires_at=now()-interval '1 second' WHERE purpose='healthkit_pair' AND user_id=$1 AND consumed_at IS NULL",
      [member.userId],
    ),
  );
  await expectCode(
    "/healthkit/device/pair",
    {
      body: { code: third.code, deviceName: "Late", platform: "ios" },
      origin: null,
    },
    400,
    "PAIRING_CODE_INVALID",
  );
  await expectCode(
    "/healthkit/device/pair",
    {
      body: { code: "not-a-valid-code", deviceName: "Phone", platform: "ios" },
      origin: null,
    },
    400,
    "PAIRING_CODE_INVALID",
  );
  await expectCode(
    "/healthkit/device/pair",
    {
      body: { code: second.code, deviceName: "<script>", platform: "ios" },
      origin: null,
    },
    400,
    "VALIDATION",
  );
  // The member is told about the new device, and the list omits credentials.
  const notices = await db.tenant(seedScope(member), (tx) =>
    tx.query(
      "SELECT category,title,body,href FROM notifications WHERE user_id=$1",
      [member.userId],
    ),
  );
  assert.equal(notices.length, 1);
  assert.equal(notices[0].category, "account");
  assert.equal(notices[0].href, "/app/wearables");
  assert.match(notices[0].body, /Sara’s iPhone/);
  const listed = await ok("/healthkit/devices", { cookie: member.cookie });
  assert.equal(listed.devices.length, 1);
  assert.equal(listed.devices[0].name, "Sara’s iPhone");
  assert.equal(JSON.stringify(listed).includes("token"), false);
  const status = await ok("/healthkit/status", { cookie: member.cookie });
  assert.equal(status.consent, true);
  assert.equal(status.pendingCodeExpiresAt, null);
  // Cancelling an outstanding code works; the device limit is enforced.
  await ok("/healthkit/pairing-codes", {
    body: { consent: true },
    cookie: member.cookie,
  });
  assert.equal(
    (
      await ok("/healthkit/pairing-codes/cancel", {
        body: {},
        cookie: member.cookie,
      })
    ).cancelled,
    1,
  );
  for (let i = 0; i < 4; i++) await pairDevice(member, "Device " + i);
  await expectCode(
    "/healthkit/pairing-codes",
    { body: { consent: true }, cookie: member.cookie },
    409,
    "DEVICE_LIMIT",
  );
  // Trainers do not pair their own devices; see the roles test.
  await expectCode(
    "/healthkit/pairing-codes",
    { body: { consent: true }, cookie: owner.cookie },
    403,
    "HEALTHKIT_CLIENTS_ONLY",
  );
});

test("batch uploads are validated, idempotent and mapped into the Client Twin and progress", async () => {
  const tenantId = await workspace("Upload studio");
  const owner = await person(tenantId, "owner"),
    member = await person(tenantId),
    other = await person(tenantId);
  await setPolicy(owner, "permitted_imports_and_sync");
  const { deviceToken, device: paired } = await pairDevice(member);
  const days = [fullDay(1), fullDay(2)];
  const body = {
    batchId: "sync-" + randomUUID(),
    samples: days.flatMap((d) => d.samples),
  };
  const first = await ok("/healthkit/device/samples", {
    body,
    token: deviceToken,
    origin: null,
  });
  assert.deepEqual(
    {
      received: first.received,
      stored: first.stored,
      duplicates: first.duplicates,
      replayed: first.replayed,
      skipped: first.skipped,
    },
    {
      received: 16,
      stored: 16,
      duplicates: 0,
      replayed: false,
      skipped: { outsideWindow: 0, dayLimit: 0 },
    },
  );
  // Same batch id and body: the stored receipt is replayed without new writes.
  const replay = await ok("/healthkit/device/samples", {
    body,
    token: deviceToken,
    origin: null,
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.stored, 16);
  await expectCode(
    "/healthkit/device/samples",
    {
      body: { ...body, samples: body.samples.slice(1) },
      token: deviceToken,
      origin: null,
    },
    409,
    "BATCH_ID_REUSED",
  );
  // A new batch that resends samples reports them as duplicates.
  const resend = await ok("/healthkit/device/samples", {
    body: { batchId: "sync-" + randomUUID(), samples: days[0].samples },
    token: deviceToken,
    origin: null,
  });
  assert.equal(resend.duplicates, 8);
  assert.equal(resend.stored, 0);
  const rows = await records(member);
  assert.deepEqual(
    rows.map((r) => r.data.day),
    [days[1].date, days[0].date],
  );
  for (const r of rows) {
    assert.equal(r.status, "imported");
    assert.equal(r.data.source, "apple_health");
    assert.deepEqual(r.data.allowedUses, ["render", "deterministic_feature"]);
    assert.deepEqual(r.data.restrictions, ["no_model_prompt", "no_marketing"]);
  }
  const types = rows[1].data.observations.map((o: any) => o.type).sort();
  assert.deepEqual(types, [
    "HKQuantityTypeIdentifierBodyMass",
    "HKQuantityTypeIdentifierHeartRate",
    "HKQuantityTypeIdentifierHeartRateVariabilitySDNN",
    "HKQuantityTypeIdentifierRestingHeartRate",
    "HKWorkout",
    "daily_active_energy",
    "daily_steps",
    "sleep_minutes",
    "workout_minutes",
  ]);
  // Audit events carry counts only, never health values.
  const events = await db.tenant(seedScope(owner), (tx) =>
    tx.query(
      "SELECT data FROM events WHERE name='healthkit.batch_received' AND subject_id=$1",
      [paired.id],
    ),
  );
  assert.equal(events.length, 2);
  assert.deepEqual(Object.keys(events[0].data).sort(), [
    "batchId",
    "deleted",
    "duplicates",
    "received",
    "skipped",
    "stored",
    "updated",
  ]);
  // The Client Twin (follower "Coaching context" and trainer client view).
  const twin = await ok(`/clients/${member.userId}/twin`, {
    cookie: member.cookie,
  });
  const metric = (key: string) =>
    twin.data.wearables.metrics.find((m: any) => m.key === key);
  assert.equal(metric("resting_heart_rate").latest, 54);
  assert.equal(metric("hrv").latest, 58);
  assert.equal(metric("body_mass").latest, 80.5);
  assert.equal(metric("sleep_minutes").latest, 450);
  assert.equal(metric("daily_steps").latest, 11000);
  assert.equal(metric("daily_active_energy").latest, 640);
  assert.equal(metric("workout_minutes").latest, 50);
  assert.equal(metric("daily_steps").state, "current");
  // Synced health data never enters the model-facing coaching object.
  const modelFacing = JSON.stringify(twin.data.coaching);
  for (const marker of [
    "daily_steps",
    "HKWorkout",
    "sleep_minutes",
    "11000",
    "apple_health",
  ])
    assert.equal(modelFacing.includes(marker), false, marker);
  assert.deepEqual(twin.data.wearables.allowedUses, [
    "render",
    "deterministic_feature",
  ]);
  // Progress activity for the follower and the trainer; other members are refused.
  const mine = await ok("/healthkit/activity?days=7", {
    cookie: member.cookie,
  });
  assert.equal(mine.days.length, 2);
  assert.deepEqual(
    {
      day: mine.days[0].day,
      steps: mine.days[0].steps,
      sleep: mine.days[0].sleepMinutes,
      workouts: mine.days[0].workouts,
    },
    {
      day: days[0].date,
      steps: 11000,
      sleep: 450,
      workouts: [{ activity: "running", minutes: 50 }],
    },
  );
  const coachView = await ok(`/healthkit/activity?userId=${member.userId}`, {
    cookie: owner.cookie,
  });
  assert.equal(coachView.days.length, 2);
  await expectCode(
    `/healthkit/activity?userId=${member.userId}`,
    { cookie: other.cookie },
    403,
    "ACTIVITY_ACCESS",
  );
  // Deletions made in the Health app propagate.
  const removal = await ok("/healthkit/device/samples", {
    body: {
      batchId: "sync-" + randomUUID(),
      deletedSampleIds: [days[0].ids.wake.toLowerCase()],
    },
    token: deviceToken,
    origin: null,
  });
  assert.equal(removal.deleted, 1);
  const after = await records(member);
  assert.equal(
    after[1].data.observations.some(
      (o: any) => o.type === "HKQuantityTypeIdentifierBodyMass",
    ),
    false,
  );
  // Strict validation and window handling.
  await expectCode(
    "/healthkit/device/samples",
    {
      body: { batchId: "sync-bad-type", samples: [{ type: "blood_glucose" }] },
      token: deviceToken,
      origin: null,
    },
    400,
    "VALIDATION",
  );
  await expectCode(
    "/healthkit/device/samples",
    {
      body: {
        batchId: "sync-extra-key",
        samples: days[0].samples.slice(0, 1),
        anchor: "x",
      },
      token: deviceToken,
      origin: null,
    },
    400,
    "VALIDATION",
  );
  const tooMany = Array.from({ length: 1001 }, () => ({
    type: "heart_rate_variability",
    id: sampleId(),
    start: local(Date.now() - DAY),
    end: local(Date.now() - DAY),
    value: 50,
    unit: "ms",
  }));
  await expectCode(
    "/healthkit/device/samples",
    {
      body: { batchId: "sync-too-many", samples: tooMany },
      token: deviceToken,
      origin: null,
    },
    400,
    "VALIDATION",
  );
  const old = Date.now() - 95 * DAY;
  const window = await ok("/healthkit/device/samples", {
    body: {
      batchId: "sync-window-1",
      samples: [
        {
          type: "resting_heart_rate",
          id: sampleId(),
          start: local(old),
          end: local(old),
          value: 50,
          unit: "count/min",
        },
      ],
    },
    token: deviceToken,
    origin: null,
  });
  assert.deepEqual(window.skipped, { outsideWindow: 1, dayLimit: 0 });
  const huge = await call("/healthkit/device/samples", {
    body: {
      batchId: "sync-huge-body",
      samples: [],
      padding: "x".repeat(1100000),
    },
    token: deviceToken,
    origin: null,
  });
  assert.equal(huge.statusCode, 413, huge.body);
  // Device list shows the last sync for the member.
  const listed = (await ok("/healthkit/devices", { cookie: member.cookie }))
    .devices[0];
  assert.ok(listed.lastSyncAt);
  assert.ok(listed.samplesReceived >= 16);
  // Deleting synced data removes every HealthKit-origin row and nothing else.
  const deletion = await ok("/healthkit/data/delete", {
    body: { confirm: true },
    cookie: member.cookie,
  });
  assert.equal(deletion.deletedDays, 2);
  assert.equal((await records(member)).length, 0);
  await expectCode(
    "/healthkit/data/delete",
    { body: {}, cookie: member.cookie },
    400,
    "VALIDATION",
  );
});

test("a daily total sent before its day ends completes after an unchanged re-send or by the worker", async () => {
  const tenantId = await workspace("Late totals studio");
  const owner = await person(tenantId, "owner"),
    resender = await person(tenantId),
    quiet = await person(tenantId);
  await setPolicy(owner, "permitted_imports_and_sync");
  const a = await pairDevice(resender, "Resending phone"),
    b = await pairDevice(quiet, "Quiet phone");
  const steps = totalEndingSoon("step_count", 4321),
    energy = totalEndingSoon("active_energy", 275),
    quietSteps = totalEndingSoon("step_count", 6789);
  const upload = (token: string, samples: unknown[]) =>
    ok("/healthkit/device/samples", {
      body: { batchId: "sync-" + randomUUID(), samples },
      token,
      origin: null,
    });
  // The last upload before local midnight: the day's totals are still running.
  const early = await upload(a.deviceToken, [steps.sample, energy.sample]);
  assert.equal(early.stored, 2);
  assert.equal(early.days, 1);
  await upload(b.deviceToken, [quietSteps.sample]);
  const [pending] = await records(resender);
  assert.deepEqual(pending.data.observations, []);
  assert.equal(pending.data.totalsDueAt, new Date(steps.end).toISOString());
  const before = await ok("/healthkit/activity", { cookie: resender.cookie });
  assert.equal(before.days[0].steps, null);
  await pause(
    Math.max(steps.end, energy.end, quietSteps.end) - Date.now() + 300,
  );
  // The app re-sends the ended day unchanged: duplicates, yet the day completes.
  const final = await upload(a.deviceToken, [steps.sample, energy.sample]);
  assert.equal(final.duplicates, 2);
  assert.equal(final.stored + final.updated, 0);
  assert.equal(final.days, 1);
  const [completed] = await records(resender);
  const types = completed.data.observations.map((o: any) => o.type).sort();
  assert.deepEqual(types, ["daily_active_energy", "daily_steps"]);
  assert.equal(completed.data.count, 2);
  assert.equal(completed.data.totalsDueAt, null);
  // A later unchanged re-send writes nothing.
  const again = await upload(a.deviceToken, [steps.sample, energy.sample]);
  assert.equal(again.days, 0);
  assert.equal((await records(resender))[0].version, completed.version);
  const twin = await ok(`/clients/${resender.userId}/twin`, {
    cookie: resender.cookie,
  });
  const metric = (t: any, key: string) =>
    t.data.wearables.metrics.find((m: any) => m.key === key);
  assert.equal(metric(twin, "daily_steps").latest, 4321);
  assert.equal(metric(twin, "daily_active_energy").latest, 275);
  const activity = await ok("/healthkit/activity", {
    cookie: resender.cookie,
  });
  assert.equal(activity.days[0].steps, 4321);
  assert.equal(activity.days[0].activeEnergyKcal, 275);
  // The quiet phone never syncs again. Read paths derive the ended total at
  // once; the hourly worker then completes the stored day as well.
  const [quietBefore] = await records(quiet);
  assert.deepEqual(quietBefore.data.observations, []);
  const quietTwin = await ok(`/clients/${quiet.userId}/twin`, {
    cookie: owner.cookie,
  });
  assert.equal(metric(quietTwin, "daily_steps").latest, 6789);
  const coachView = await ok(`/healthkit/activity?userId=${quiet.userId}`, {
    cookie: owner.cookie,
  });
  assert.equal(coachView.days[0].steps, 6789);
  const maintained = await maintainHealthKitSync(db);
  assert.ok(maintained.finalized >= 1, JSON.stringify(maintained));
  const [quietAfter] = await records(quiet);
  assert.deepEqual(
    quietAfter.data.observations.map((o: any) => [o.type, o.value]),
    [["daily_steps", 6789]],
  );
  assert.equal(quietAfter.data.totalsDueAt, null);
  // The worker keeps the time of the last device sync.
  assert.equal(quietAfter.data.lastSyncedAt, quietBefore.data.lastSyncedAt);
  const status = await ok("/healthkit/status", { cookie: quiet.cookie });
  assert.equal(status.synced.observations, 1);
});

test("revocation, withdrawn consent, coach policy and ended membership stop uploads", async () => {
  const tenantId = await workspace("Revocation studio");
  const owner = await person(tenantId, "owner"),
    member = await person(tenantId);
  await setPolicy(owner, "permitted_imports_and_sync");
  const upload = (token: string, samples = fullDay(1).samples) =>
    call("/healthkit/device/samples", {
      body: { batchId: "sync-" + randomUUID(), samples },
      token,
      origin: null,
    });
  // Member disconnects a device from the app.
  const a = await pairDevice(member, "Phone A");
  assert.equal((await upload(a.deviceToken)).statusCode, 200);
  const revoked = await ok(`/healthkit/devices/${a.device.id}/revoke`, {
    body: {},
    cookie: member.cookie,
  });
  assert.match(revoked.message, /can no longer send/);
  assert.equal((await upload(a.deviceToken)).json().code, "DEVICE_REVOKED");
  await expectCode(
    "/healthkit/device/status",
    { token: a.deviceToken },
    401,
    "DEVICE_REVOKED",
  );
  // Synced data remains until the member revokes its use or deletes it.
  assert.equal((await records(member)).length, 1);
  // The companion app can unpair itself.
  const b = await pairDevice(member, "Phone B");
  await ok("/healthkit/device/unpair", {
    body: {},
    token: b.deviceToken,
    origin: null,
  });
  assert.equal((await device(member, b.device.id)).revoked_reason, "device");
  await expectCode(
    "/healthkit/device/status",
    { token: b.deviceToken },
    401,
    "DEVICE_REVOKED",
  );
  // The coach turning sync off pauses the device without revoking it.
  const c = await pairDevice(member, "Phone C");
  await setPolicy(owner, "permitted_imports");
  const paused = await upload(c.deviceToken);
  assert.equal(paused.statusCode, 403);
  assert.equal(paused.json().code, "HEALTHKIT_POLICY");
  const status = await ok("/healthkit/device/status", { token: c.deviceToken });
  assert.equal(status.uploadsAllowed, false);
  assert.equal(status.reason.code, "HEALTHKIT_POLICY");
  const pausedRow = await device(member, c.device.id);
  assert.equal(pausedRow.status, "active");
  assert.equal(pausedRow.last_error_code, "HEALTHKIT_POLICY");
  await setPolicy(owner, "permitted_imports_and_sync");
  assert.equal(
    (await ok("/healthkit/device/status", { token: c.deviceToken }))
      .uploadsAllowed,
    true,
  );
  // Revoking Apple Health use revokes every device and restricts synced data.
  await ok("/integrations/apple_health/revoke", {
    body: {},
    cookie: member.cookie,
  });
  assert.equal(
    (await device(member, c.device.id)).revoked_reason,
    "source_revoked",
  );
  assert.deepEqual(
    (await records(member)).map((r) => [r.status, r.data.allowedUses]),
    [["permission_revoked", ["render"]]],
  );
  // The revoked days stay stored, so the member can still find and delete them.
  const afterRevoke = await ok("/healthkit/status", { cookie: member.cookie });
  assert.equal(afterRevoke.synced.days, 1);
  assert.equal(afterRevoke.synced.restrictedDays, 1);
  assert.ok(afterRevoke.synced.observations > 0);
  // The Progress card uses permitted days only.
  assert.deepEqual(
    (await ok("/healthkit/activity", { cookie: member.cookie })).days,
    [],
  );
  // Re-pairing records consent again; a new day row starts beside the revoked one.
  const d = await pairDevice(member, "Phone D");
  assert.equal((await upload(d.deviceToken)).statusCode, 200);
  assert.deepEqual((await records(member)).map((r) => r.status).sort(), [
    "imported",
    "permission_revoked",
  ]);
  // Withdrawing general wearable permission revokes devices too.
  await ok("/privacy/consent", {
    body: { type: "wearable", granted: false },
    cookie: member.cookie,
  });
  assert.equal((await device(member, d.device.id)).revoked_reason, "consent");
  const withdrawnStatus = await ok("/healthkit/status", {
    cookie: member.cookie,
  });
  assert.equal(withdrawnStatus.wearablePermissionWithdrawn, true);
  assert.equal(withdrawnStatus.synced.days, 2);
  assert.equal(withdrawnStatus.synced.restrictedDays, 2);
  await expectCode(
    "/healthkit/pairing-codes",
    { body: { consent: true }, cookie: member.cookie },
    409,
    "WEARABLE_PERMISSION_WITHDRAWN",
  );
  await ok("/privacy/consent", {
    body: { type: "wearable", granted: true },
    cookie: member.cookie,
  });
  // An ended membership blocks uploads at once; the worker then revokes the device.
  const e = await pairDevice(member, "Phone E");
  await db.system((tx) =>
    tx.query("DELETE FROM memberships WHERE tenant_id=$1 AND user_id=$2", [
      tenantId,
      member.userId,
    ]),
  );
  const ended = await upload(e.deviceToken);
  assert.equal(ended.statusCode, 403, ended.body);
  assert.equal(ended.json().code, "MEMBERSHIP_ENDED");
  const maintained = await maintainHealthKitSync(db);
  assert.ok(maintained.revoked >= 1);
  assert.equal(
    (await device(member, e.device.id)).revoked_reason,
    "membership_ended",
  );
});

test("only the workspace's clients pair devices and sync", async () => {
  const tenantId = await workspace("Roles studio");
  const owner = await person(tenantId, "owner"),
    staff = await person(tenantId, "staff"),
    finance = await person(tenantId, "finance"),
    member = await person(tenantId),
    changing = await person(tenantId);
  await setPolicy(owner, "permitted_imports_and_sync");
  for (const p of [owner, staff, finance]) {
    await expectCode(
      "/healthkit/pairing-codes",
      { body: { consent: true }, cookie: p.cookie },
      403,
      "HEALTHKIT_CLIENTS_ONLY",
    );
    const status = await ok("/healthkit/status", { cookie: p.cookie });
    assert.equal(status.canPair, false);
    assert.equal(status.coachAllowsSync, true);
  }
  assert.equal(
    (await ok("/healthkit/status", { cookie: member.cookie })).canPair,
    true,
  );
  // No consent or code was recorded for the refused team accounts.
  const consents = await db.tenant(seedScope(owner), (tx) =>
    tx.query(
      "SELECT user_id FROM consent_records WHERE document_type='wearable:apple_health' AND user_id=ANY($1::uuid[])",
      [[owner.userId, staff.userId, finance.userId]],
    ),
  );
  assert.equal(consents.length, 0);
  // A code created as a client cannot be redeemed after the role changed.
  const code = await ok("/healthkit/pairing-codes", {
    body: { consent: true },
    cookie: changing.cookie,
  });
  const setRole = (p: Person, role: string) =>
    db.system((tx) =>
      tx.query(
        "UPDATE memberships SET role=$3 WHERE tenant_id=$1 AND user_id=$2",
        [tenantId, p.userId, role],
      ),
    );
  await setRole(changing, "staff");
  await expectCode(
    "/healthkit/device/pair",
    {
      body: { code: code.code, deviceName: "Team phone", platform: "ios" },
      origin: null,
    },
    403,
    "HEALTHKIT_CLIENTS_ONLY",
  );
  // A paired client who becomes a team member can no longer upload, and the
  // worker revokes the device because the client membership ended.
  const paired = await pairDevice(member);
  await setRole(member, "finance");
  await expectCode(
    "/healthkit/device/samples",
    {
      body: { batchId: "sync-" + randomUUID(), samples: fullDay(1).samples },
      token: paired.deviceToken,
      origin: null,
    },
    403,
    "HEALTHKIT_CLIENTS_ONLY",
  );
  assert.equal((await records(member)).length, 0);
  assert.equal(
    (await device(member, paired.device.id)).last_error_code,
    "HEALTHKIT_CLIENTS_ONLY",
  );
  await maintainHealthKitSync(db);
  assert.equal(
    (await device(member, paired.device.id)).revoked_reason,
    "membership_ended",
  );
});

test("device credentials are checked, rate limited and bound to their workspace and host", async () => {
  const tenantA = await workspace("Host studio A"),
    tenantB = await workspace("Host studio B");
  const ownerA = await person(tenantA, "owner"),
    ownerB = await person(tenantB, "owner"),
    member = await person(tenantA),
    foreign = await person(tenantB);
  await setPolicy(ownerA, "permitted_imports_and_sync");
  await setPolicy(ownerB, "permitted_imports_and_sync");
  const hostA = `members.${tenantA.slice(0, 8)}.test`,
    hostB = `members.${tenantB.slice(0, 8)}.test`;
  await db.system((tx) =>
    tx.query(
      "INSERT INTO domain_mappings(hostname,tenant_id,active,verified_at) VALUES($1,$2,true,now()),($3,$4,true,now())",
      [hostA, tenantA, hostB, tenantB],
    ),
  );
  // A code from workspace A cannot be redeemed on workspace B's website and
  // stays usable where it was created.
  const code = await ok("/healthkit/pairing-codes", {
    body: { consent: true },
    cookie: member.cookie,
  });
  await expectCode(
    "/healthkit/device/pair",
    {
      body: { code: code.code, deviceName: "Phone", platform: "ios" },
      customHost: hostB,
      origin: null,
    },
    403,
    "HOST_TENANT_MISMATCH",
  );
  const paired = await ok("/healthkit/device/pair", {
    body: { code: code.code, deviceName: "Phone", platform: "ios" },
    customHost: hostA,
    origin: null,
  });
  assert.equal(paired.server, "https://" + hostA);
  const token = paired.deviceToken;
  await ok("/healthkit/device/status", { token, customHost: hostA });
  await expectCode(
    "/healthkit/device/status",
    { token, customHost: hostB },
    403,
    "HOST_TENANT_MISMATCH",
  );
  // A token rewritten to another workspace is unknown there.
  const swapped = token.replace(tenantA, tenantB);
  await expectCode(
    "/healthkit/device/status",
    { token: swapped },
    401,
    "DEVICE_TOKEN_INVALID",
  );
  await expectCode(
    "/healthkit/device/status",
    {},
    401,
    "DEVICE_TOKEN_REQUIRED",
  );
  await expectCode(
    "/healthkit/device/samples",
    { body: { batchId: "sync-00001", samples: [] }, origin: null },
    401,
    "DEVICE_TOKEN_REQUIRED",
  );
  // A session cookie never authenticates a device route.
  await expectCode(
    "/healthkit/device/status",
    { cookie: member.cookie },
    401,
    "DEVICE_TOKEN_REQUIRED",
  );
  // Row-level security keeps devices private to their member and workspace.
  const visible = await db.tenant(foreign, (tx) =>
    tx.query("SELECT id FROM healthkit_devices"),
  );
  assert.equal(visible.length, 0);
  const peer = await person(tenantA);
  assert.equal(
    (
      await db.tenant(peer, (tx) =>
        tx.query("SELECT id FROM healthkit_devices"),
      )
    ).length,
    0,
  );
  assert.equal(
    (
      await db.tenant(member, (tx) =>
        tx.query("SELECT id FROM healthkit_devices"),
      )
    ).length,
    1,
  );
  await expectCode(
    `/healthkit/devices/${paired.device.id}/revoke`,
    { body: {}, cookie: peer.cookie },
    404,
    "NOT_FOUND",
  );
  // Repeated invalid credentials from one address are refused, but a paired
  // device behind the same address (a carrier NAT) keeps working.
  const remote = "10.99.0.7";
  for (let i = 0; i < 20; i++)
    await expectCode(
      "/healthkit/device/status",
      { token: `hk1.${tenantA}.${newToken()}`, remote },
      401,
      "DEVICE_TOKEN_INVALID",
    );
  await expectCode(
    "/healthkit/device/status",
    { token: `hk1.${tenantA}.${newToken()}`, remote },
    429,
    "TOO_MANY_ATTEMPTS",
  );
  await expectCode(
    "/healthkit/device/status",
    { token: "not-a-device-token", remote },
    429,
    "TOO_MANY_ATTEMPTS",
  );
  await ok("/healthkit/device/status", { token, remote });
  await ok("/healthkit/device/samples", {
    body: { batchId: "sync-" + randomUUID(), samples: fullDay(1).samples },
    token,
    remote,
    origin: null,
  });
  // Per-device route budget.
  const limited: any[] = [];
  for (let i = 0; i < 31; i++) {
    const r = await call("/healthkit/device/status", { token });
    if (r.statusCode === 429) limited.push(r);
  }
  assert.ok(limited.length >= 1, "the device status budget applies");
  assert.equal(limited[0].json().code, "RATE_LIMITED");
  assert.ok(Number(limited[0].headers["retry-after"]) > 0);
  // Per-device daily quota stored with the device.
  const second = await pairDevice(member, "Quota phone");
  await db.tenant(seedScope(member), (tx) =>
    tx.query(
      "UPDATE healthkit_devices SET quota_day=(now() AT TIME ZONE 'UTC')::date,quota_batches=1000 WHERE id=$1",
      [second.device.id],
    ),
  );
  await expectCode(
    "/healthkit/device/samples",
    {
      body: { batchId: "sync-quota-1", samples: fullDay(1).samples },
      token: second.deviceToken,
      origin: null,
    },
    429,
    "DAILY_QUOTA",
  );
  assert.equal(
    (await device(member, second.device.id)).last_error_code,
    "DAILY_QUOTA",
  );
});

test("the invalid-token budget never refuses a known device, even under a flood", () => {
  const budget = failureBudget(2, 4, 60000);
  const nat = "100.64.0.9",
    elsewhere = "192.0.2.1";
  const code = (error: any) => [error.statusCode, error.code];
  assert.deepEqual(code(budget.failed(nat)), [401, "DEVICE_TOKEN_INVALID"]);
  assert.deepEqual(code(budget.failed(nat)), [401, "DEVICE_TOKEN_INVALID"]);
  // Past the soft limit an unknown token gets 429, but tokens are still looked up.
  assert.deepEqual(code(budget.failed(nat)), [429, "TOO_MANY_ATTEMPTS"]);
  budget.admit(nat, "unknown-digest");
  budget.failed(nat);
  // Past the flood limit unknown tokens are refused before any lookup...
  assert.throws(
    () => budget.admit(nat, "unknown-digest"),
    (e: any) => e.statusCode === 429 && e.code === "TOO_MANY_ATTEMPTS",
  );
  // ...while tokens this server issued or authenticated are still admitted.
  budget.trust("paired-digest");
  budget.admit(nat, "paired-digest");
  // Other addresses are unaffected.
  budget.admit(elsewhere, "unknown-digest");
  assert.deepEqual(code(budget.failed(elsewhere)), [
    401,
    "DEVICE_TOKEN_INVALID",
  ]);
});

test("export, erasure, workspace closure and the support view follow privacy rules", async () => {
  const tenantId = await workspace("Privacy studio");
  const owner = await person(tenantId, "owner"),
    member = await person(tenantId),
    operator = await person(tenantId, "staff", {
      platformRole: "admin",
      mfa: true,
    });
  await setPolicy(owner, "permitted_imports_and_sync");
  const { deviceToken, device: paired } = await pairDevice(member);
  await ok("/healthkit/device/samples", {
    body: { batchId: "sync-privacy-1", samples: fullDay(1).samples },
    token: deviceToken,
    origin: null,
  });
  const exported = await ok("/privacy/export", { cookie: member.cookie });
  assert.equal(exported.healthKitSync.devices.length, 1);
  assert.equal(exported.healthKitSync.uploadReceipts.length, 1);
  assert.equal(
    JSON.stringify(exported.healthKitSync).includes("token_hash"),
    false,
  );
  // Support sees connection health only.
  const support = await ok(`/admin/operations/wearables?tenantId=${tenantId}`, {
    cookie: operator.cookie,
  });
  const row = support.rows.find((r: any) => r.source === "healthkit_device");
  assert.equal(row.id, paired.id);
  assert.equal(row.status, "active");
  assert.ok(row.last_sync_at);
  assert.equal(
    JSON.stringify(
      support.rows.filter((r: any) => r.source === "healthkit_device"),
    ).includes("token"),
    false,
  );
  // Member erasure removes devices and receipts (records are erased by the lifecycle).
  // Erasure runs in the privacy operator's erasure scope, as eraseMember does.
  const privacyScope = elevated("platform-operator", {
    tenantId,
    userId: operator.userId,
    role: "owner",
  });
  await db.tenant(
    privacyScope,
    (tx) => privacyHooks.eraseAdditional!(tx, member.userId),
    { privacyErasure: true },
  );
  assert.equal(
    (
      await db.tenant(seedScope(owner), (tx) =>
        tx.query("SELECT id FROM healthkit_devices WHERE user_id=$1", [
          member.userId,
        ]),
      )
    ).length,
    0,
  );
  assert.equal(
    (
      await db.tenant(seedScope(owner), (tx) =>
        tx.query(
          "SELECT batch_id FROM healthkit_sync_batches WHERE user_id=$1",
          [member.userId],
        ),
      )
    ).length,
    0,
  );
  await expectCode(
    "/healthkit/device/status",
    { token: deviceToken },
    401,
    "DEVICE_TOKEN_INVALID",
  );
  // Workspace closure removes every device in the workspace.
  const again = await person(tenantId);
  await pairDevice(again);
  // Closure runs under a privacy operator, as in the workspace lifecycle.
  await db.tenant(privacyScope, (tx) => privacyHooks.closeAdditional!(tx), {
    privacyErasure: true,
  });
  assert.equal(
    (
      await db.tenant(seedScope(owner), (tx) =>
        tx.query("SELECT id FROM healthkit_devices"),
      )
    ).length,
    0,
  );
});
