import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createPublicKey, randomBytes, randomUUID, verify } from "node:crypto";
import webPush from "web-push";
import { createDatabase, type Database } from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";
import { notifyUser } from "../apps/api/src/notifications.ts";
import { executePushDelivery } from "../apps/worker/src/push-delivery.ts";
import {
  pushConfiguration,
  pushEndpoint,
  webPushRequest,
} from "../packages/providers/src/push.ts";
import {
  testIntegration,
  withRuntimeConfig,
} from "../packages/providers/src/configuration.ts";
import { privacyHooks } from "../apps/api/src/privacy-hooks.ts";

const keys = webPush.generateVAPIDKeys();
const env = {
  PUSH_VAPID_PUBLIC_KEY: keys.publicKey,
  PUSH_VAPID_PRIVATE_KEY: keys.privateKey,
  PUSH_VAPID_SUBJECT: "mailto:push@example.test",
  SECURITY_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
};
const previous = Object.fromEntries(
  Object.keys(env).map((key) => [key, process.env[key]]),
);
let db: Database,
  app: Awaited<ReturnType<typeof buildApp>>,
  owner: any,
  outsider: any;
const request = (
  path: string,
  method: any = "GET",
  body?: Record<string, unknown>,
  cookie = owner?.cookie,
) =>
  app.inject({
    url: "/api/v1" + path,
    method,
    headers: {
      origin: "http://localhost:3000",
      ...(cookie ? { cookie } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    payload: body,
  });
async function register(slug: string) {
  const r = await request(
    "/auth/register",
    "POST",
    {
      name: "Push Coach",
      email: slug + "@example.test",
      password: "TestingOnly2026!",
      slug,
      accepted: true,
    },
    "",
  );
  assert.equal(r.statusCode, 201, r.body);
  const cookie = String(r.headers["set-cookie"]).split(";")[0];
  return {
    ...(await request("/bootstrap", "GET", undefined, cookie)).json().user,
    cookie,
  };
}
before(async () => {
  Object.assign(process.env, env);
  db = await createDatabase({ memory: true });
  app = await buildApp({ db, testing: true });
  owner = await register("push-one");
  outsider = await register("push-two");
  await db.tenant(owner, (tx) =>
    tx.query(
      "INSERT INTO notification_preferences(tenant_id,user_id,data) VALUES($1,$2,$3)",
      [
        owner.tenantId,
        owner.userId,
        JSON.stringify({ email: false, quietStart: 0, quietEnd: 0 }),
      ],
    ),
  );
});
after(async () => {
  await app.close();
  await db.close();
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
async function enable() {
  const endpoint = "https://fcm.googleapis.com/fcm/send/" + randomUUID();
  const r = await request("/notifications/push", "POST", {
    endpoint,
    expirationTime: null,
    publicKey: keys.publicKey,
    label: "Test browser",
  });
  assert.equal(r.statusCode, 200, r.body);
  return { ...r.json(), endpoint };
}
async function enqueue(options: Record<string, unknown> = {}) {
  const n = await db.tenant(owner, (tx) =>
    notifyUser(tx, owner, {
      userId: owner.userId,
      category: "coaching",
      dedupeKey: randomUUID(),
      title: "Private detail",
      body: "Never send this on the lock screen",
      ...options,
    }),
  );
  const [job] = await db.tenant(owner, (tx) =>
    tx.query(
      "UPDATE jobs SET attempts=attempts+1,leased_until=now()+interval '2 minutes' WHERE kind='push' AND data->>'notificationId'=$1 RETURNING *",
      [n?.id],
    ),
  );
  return { n, job };
}
const jobState = (id: string) =>
  db.tenant(
    owner,
    async (tx) => (await tx.query("SELECT * FROM jobs WHERE id=$1", [id]))[0],
  );

test("payloadless VAPID request is signed for the allowed service and config checks send nothing", async () => {
  const details = webPushRequest("https://fcm.googleapis.com/fcm/send/example");
  assert.equal(details.body, null);
  assert.equal(details.headers.TTL, 300);
  const authorization = String(details.headers.Authorization),
    jwt = /t=([^,]+)/.exec(authorization)![1],
    [head, payload, signature] = jwt.split(".");
  assert.equal(
    JSON.parse(Buffer.from(payload, "base64url").toString()).aud,
    "https://fcm.googleapis.com",
  );
  const key = Buffer.from(keys.publicKey, "base64url"),
    publicKey = createPublicKey({
      key: {
        kty: "EC",
        crv: "P-256",
        x: key.subarray(1, 33).toString("base64url"),
        y: key.subarray(33).toString("base64url"),
      },
      format: "jwk",
    });
  assert.equal(
    verify(
      "sha256",
      Buffer.from(head + "." + payload),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(signature, "base64url"),
    ),
    true,
  );
  assert.equal((await testIntegration("push", env)).status, "validated");
  assert.throws(() =>
    pushConfiguration({
      ...env,
      PUSH_VAPID_PRIVATE_KEY: webPush.generateVAPIDKeys().privateKey,
    }),
  );
  for (const endpoint of [
    "https://127.0.0.1/x",
    "https://fcm.googleapis.com.attacker.test/x",
    "https://user:secret@fcm.googleapis.com/x",
    "https://fcm.googleapis.com:8443/x",
    "http://fcm.googleapis.com/x",
  ])
    assert.throws(() => pushEndpoint(endpoint));
});
test("assembled opt-in API encrypts endpoint, rejects unsafe subscriptions and isolates devices", async () => {
  const enabled = await enable();
  const repeated = await request("/notifications/push", "POST", {
    endpoint: enabled.endpoint,
    expirationTime: null,
    publicKey: keys.publicKey,
    label: "My phone",
  });
  assert.equal(repeated.json().id, enabled.id);
  const list = await request("/notifications/push");
  assert.equal(list.json().configured, true);
  assert.equal(list.json().devices.length, 1);
  assert.equal(list.json().devices[0].current, true);
  assert.ok(!list.body.includes(enabled.endpoint));
  assert.ok(!list.body.includes(keys.privateKey));
  const [stored] = await db.tenant(owner, (tx) =>
    tx.query("SELECT * FROM push_subscriptions WHERE id=$1", [enabled.id]),
  );
  assert.ok(!stored.encrypted_endpoint.includes(enabled.endpoint));
  assert.equal(
    (
      await request("/notifications/push", "GET", undefined, outsider.cookie)
    ).json().devices.length,
    0,
  );
  await request(
    "/notifications/push/" + enabled.id,
    "DELETE",
    undefined,
    outsider.cookie,
  );
  assert.equal((await request("/notifications/push")).json().devices.length, 1);
  assert.equal(
    (
      await request("/notifications/push", "POST", {
        endpoint: "https://127.0.0.1/",
        expirationTime: null,
        publicKey: keys.publicKey,
        label: "Bad",
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await request("/notifications/push", "POST", {
        endpoint: enabled.endpoint,
        expirationTime: null,
        publicKey: "changed",
        label: "Old",
      })
    ).statusCode,
    409,
  );
  const exported = await db.tenant(owner, (tx) =>
    privacyHooks.exportAdditional!(tx, owner.userId),
  );
  assert.ok(JSON.stringify(exported).includes("My phone"));
  assert.ok(!JSON.stringify(exported).includes(enabled.endpoint));
});
test("opt-in push is independent of email, inbox-only events stay private and duplicate input creates one job", async () => {
  await enable();
  const key = randomUUID();
  const first = await enqueue({ dedupeKey: key });
  assert.ok(first.job);
  assert.deepEqual(Object.keys(first.job.data).sort(), [
    "notificationId",
    "subscriptionId",
    "userId",
  ]);
  const duplicate = await enqueue({ dedupeKey: key });
  assert.equal(duplicate.n, null);
  const inbox = await enqueue({ email: false });
  assert.equal(inbox.job, undefined);
  const [n] = await db.tenant(owner, (tx) =>
    tx.query("SELECT email_status FROM notifications WHERE id=$1", [
      first.n!.id,
    ]),
  );
  assert.equal(n.email_status, "suppressed");
});
test("accepted push and ambiguous outcomes cannot be automatically sent a second time", async () => {
  await enable();
  const { job } = await enqueue();
  let calls = 0;
  const send = async (_endpoint: string, beforeSend: () => Promise<void>) => {
    await beforeSend();
    calls++;
    return { status: 201 };
  };
  await executePushDelivery(db, owner.tenantId, job, send);
  await executePushDelivery(db, owner.tenantId, job, send);
  assert.equal(calls, 1);
  assert.equal((await jobState(job.id)).data.deliveryState, "accepted");
  const uncertain = (await enqueue()).job;
  const crash = async (_endpoint: string, beforeSend: () => Promise<void>) => {
    await beforeSend();
    calls++;
    throw new Error("Provider outcome uncertain");
  };
  await executePushDelivery(db, owner.tenantId, uncertain, crash);
  await executePushDelivery(db, owner.tenantId, uncertain, send);
  assert.equal(calls, 2);
  assert.equal((await jobState(uncertain.id)).status, "blocked");
  assert.equal((await jobState(uncertain.id)).data.deliveryState, "unknown");
});
test("stale workers, read notices and changed preferences are suppressed before a network send", async () => {
  await enable();
  let calls = 0;
  const send = async (_endpoint: string, beforeSend: () => Promise<void>) => {
    await beforeSend();
    calls++;
    return { status: 201 };
  };
  const stale = (await enqueue()).job;
  await db.tenant(owner, (tx) =>
    tx.query("UPDATE jobs SET attempts=attempts+1 WHERE id=$1", [stale.id]),
  );
  await executePushDelivery(db, owner.tenantId, stale, send);
  const read = await enqueue();
  await request(`/notifications/${read.n!.id}/read`, "POST", {});
  await executePushDelivery(db, owner.tenantId, read.job, send);
  const changed = (await enqueue({ category: "workout" })).job;
  await db.tenant(owner, (tx) =>
    tx.query(
      "UPDATE notification_preferences SET data=data||'{\"workouts\":false}'::jsonb WHERE user_id=$1",
      [owner.userId],
    ),
  );
  await executePushDelivery(db, owner.tenantId, changed, send);
  assert.equal(calls, 0);
  assert.equal((await jobState(read.job.id)).status, "completed");
  const invalid = (
    await enqueue({
      category: "booking",
      source: {
        type: "booking",
        id: randomUUID(),
        startsAt: new Date(Date.now() + 3600000).toISOString(),
      },
    })
  ).job;
  await executePushDelivery(db, owner.tenantId, invalid, send);
  assert.equal(calls, 0);
});
test("429 uses bounded retry after rejection, 410 removes the device, and key rotation suppresses old subscriptions", async () => {
  await enable();
  const limited = (await enqueue()).job;
  await executePushDelivery(db, owner.tenantId, limited, async (_e, claim) => {
    await claim();
    return { status: 429, retryAfter: "600" };
  });
  const state = await jobState(limited.id);
  assert.equal(state.status, "pending");
  assert.ok(new Date(state.available_at).getTime() > Date.now() + 590000);
  const rotated = (await enqueue()).job;
  let calls = 0;
  const another = webPush.generateVAPIDKeys();
  await withRuntimeConfig(
    {
      PUSH_VAPID_PUBLIC_KEY: another.publicKey,
      PUSH_VAPID_PRIVATE_KEY: another.privateKey,
    },
    () =>
      executePushDelivery(db, owner.tenantId, rotated, async (_e, claim) => {
        await claim();
        calls++;
        return { status: 201 };
      }),
  );
  assert.equal(calls, 0);
  const expired = (await enqueue()).job;
  await executePushDelivery(db, owner.tenantId, expired, async (_e, claim) => {
    await claim();
    return { status: 410 };
  });
  assert.equal((await request("/notifications/push")).json().devices.length, 0);
});
test("disable, personal erasure and sign-out remove subscriptions and stop queued delivery", async () => {
  const device = await enable();
  const queued = (await enqueue()).job;
  await request("/notifications/push/" + device.id, "DELETE");
  let calls = 0;
  await executePushDelivery(db, owner.tenantId, queued, async (_e, claim) => {
    await claim();
    calls++;
    return { status: 201 };
  });
  assert.equal(calls, 0);
  await enable();
  await db.tenant(owner, (tx) =>
    privacyHooks.eraseAdditional!(tx, owner.userId),
  );
  assert.equal((await request("/notifications/push")).json().devices.length, 0);
  await enable();
  assert.equal(
    (await request("/notifications/push/open")).headers.location,
    "/trainer/notifications",
  );
  await request("/auth/logout", "POST", {});
  assert.equal(
    (
      await db.tenant(owner, (tx) =>
        tx.query("SELECT id FROM push_subscriptions"),
      )
    ).length,
    0,
  );
  assert.equal(
    (await request("/notifications/push/open", "GET", undefined, "")).headers
      .location,
    "/login",
  );
});
