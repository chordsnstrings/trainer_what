import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createDatabase, type Database } from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";
import { notifyUser } from "../apps/api/src/notifications.ts";
import {
  allowedRequestOrigin,
  resolveRequestHost,
} from "../apps/api/src/host-routing.ts";
import {
  classifyQueueFailure,
  clearLocalData,
  discardRejected,
  drainNutritionQueue,
  drainQueue,
  drainWorkoutQueue,
  offlineQueueKeys,
  readList,
  retryRejected,
  unsyncedCount,
  type NutritionQueueItem,
  type QueueStore,
  type WorkoutQueueItem,
} from "../apps/web/components/offline-queue.ts";
import {
  adminRoute,
  coachAppLinks,
} from "../apps/web/components/app-routes.ts";

let db: Database, app: Awaited<ReturnType<typeof buildApp>>, member: any;
const env = { PUBLIC_APP_URL: process.env.PUBLIC_APP_URL };
const request = (
  path: string,
  method: any = "GET",
  body?: unknown,
  cookie?: string,
  headers: Record<string, string> = {},
) =>
  app.inject({
    url: "/api/v1" + path,
    method,
    headers: {
      origin: "http://localhost:3000",
      ...(cookie ? { cookie } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    payload: body as any,
  });
async function register(slug: string) {
  const r = await request("/auth/register", "POST", {
    name: "Coach " + slug,
    email: slug + "@fix-web.test",
    password: "FixtureOnly2026!",
    slug,
    accepted: true,
  });
  assert.equal(r.statusCode, 201, r.body);
  const cookie = String(r.headers["set-cookie"]).split(";")[0];
  return {
    ...(await request("/bootstrap", "GET", undefined, cookie)).json().user,
    cookie,
    slug,
  };
}
// Tenant rows go through the member's own tenant transaction, as the
// restricted PostgreSQL runtime role requires.
const asOwner = (user: any, fn: (tx: any) => Promise<any>): Promise<any> =>
  db.tenant(
    { tenantId: user.tenantId, userId: user.userId, role: "owner" },
    fn,
  );
const marketingRows = (user: any) =>
  asOwner(user, (tx) =>
    tx.query(
      "SELECT granted,document_version FROM consent_records WHERE tenant_id=$1 AND user_id=$2 AND document_type='marketing' ORDER BY created_at,id",
      [user.tenantId, user.userId],
    ),
  );
const preferences = async (user: any) =>
  (
    await request("/notifications/preferences", "GET", undefined, user.cookie)
  ).json();
before(async () => {
  process.env.PUBLIC_APP_URL = "http://localhost:3000";
  db = await createDatabase({ memory: true });
  app = await buildApp({ db, testing: true });
  member = await register("fix-web-member");
});
after(async () => {
  await app?.close();
  await db?.close();
  if (env.PUBLIC_APP_URL === undefined) delete process.env.PUBLIC_APP_URL;
  else process.env.PUBLIC_APP_URL = env.PUBLIC_APP_URL;
});

test("web:G2 the product-news toggle writes versioned marketing consent history", async () => {
  const initial = await preferences(member);
  assert.equal(initial.data.marketing, false);
  const on = await request(
    "/notifications/preferences",
    "PUT",
    { version: initial.version, data: { ...initial.data, marketing: true } },
    member.cookie,
  );
  assert.equal(on.statusCode, 200, on.body);
  let rows = await marketingRows(member);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].granted, true);
  assert.match(rows[0].document_version, /^privacy:/);
  // Saving another preference does not repeat the consent decision.
  const quiet = await request(
    "/notifications/preferences",
    "PUT",
    {
      version: on.json().version,
      data: { ...on.json().data, quietStart: 600 },
    },
    member.cookie,
  );
  assert.equal(quiet.statusCode, 200, quiet.body);
  assert.equal((await marketingRows(member)).length, 1);
  const off = await request(
    "/notifications/preferences",
    "PUT",
    {
      version: quiet.json().version,
      data: { ...quiet.json().data, marketing: false },
    },
    member.cookie,
  );
  assert.equal(off.statusCode, 200, off.body);
  rows = await marketingRows(member);
  assert.deepEqual(
    rows.map((r: any) => r.granted),
    [true, false],
  );
  assert.equal((await preferences(member)).data.marketing, false);
});

test("web:G2 privacy consent and the settings toggle are one source of truth", async () => {
  const user = await register("fix-web-consent");
  const granted = await request(
    "/privacy/consent",
    "POST",
    { type: "marketing", granted: true },
    user.cookie,
  );
  assert.equal(granted.statusCode, 200, granted.body);
  const afterGrant = await preferences(user);
  assert.equal(afterGrant.data.marketing, true);
  const revoked = await request(
    "/privacy/consent",
    "POST",
    { type: "marketing", granted: false },
    user.cookie,
  );
  assert.equal(revoked.statusCode, 200, revoked.body);
  const afterRevoke = await preferences(user);
  assert.equal(afterRevoke.data.marketing, false);
  assert.equal(afterRevoke.version, afterGrant.version + 1);
  // A stale settings screen cannot silently re-enable it.
  assert.equal(
    (
      await request(
        "/notifications/preferences",
        "PUT",
        { version: afterGrant.version, data: afterGrant.data },
        user.cookie,
      )
    ).statusCode,
    409,
  );
  // The legacy settings endpoint records its choice and no longer writes an
  // unread preferences record.
  const legacy = await request(
    "/settings",
    "POST",
    { emailNotifications: true, workoutReminders: true, marketing: true },
    user.cookie,
  );
  assert.equal(legacy.statusCode, 200, legacy.body);
  assert.equal(legacy.json().data.marketing, true);
  assert.deepEqual(
    (await marketingRows(user)).map((r: any) => r.granted),
    [true, false, true],
  );
  const [records] = await asOwner(user, (tx) =>
    tx.query(
      "SELECT count(*)::int n FROM records WHERE kind='preferences' AND owner_user_id=$1",
      [user.userId],
    ),
  );
  assert.equal(records.n, 0);
});

test("web:G2 a marketing notification needs a granted consent record, not the flag alone", async () => {
  const user = await register("fix-web-notify");
  // A mirror flag with no consent decision (e.g. written by an older client).
  await asOwner(user, (tx) =>
    tx.query(
      "INSERT INTO notification_preferences(tenant_id,user_id,data) VALUES($1,$2,'{\"marketing\":true}')",
      [user.tenantId, user.userId],
    ),
  );
  assert.equal((await preferences(user)).data.marketing, false);
  const send = (key: string) =>
    db.tenant(user, async (tx) => {
      const row = await notifyUser(tx, user, {
        userId: user.userId,
        category: "marketing",
        dedupeKey: key,
        title: "Product news",
        body: "A new feature is available.",
      });
      return (
        await tx.query("SELECT email_status FROM notifications WHERE id=$1", [
          row!.id,
        ])
      )[0].email_status;
    });
  assert.equal(await send("news-1"), "suppressed");
  await request(
    "/privacy/consent",
    "POST",
    { type: "marketing", granted: true },
    user.cookie,
  );
  assert.equal(await send("news-2"), "pending");
});

test(
  "web:G2 the consent-history migration keeps opt-outs and records legacy opt-ins",
  {
    // Replaying a migration needs the migration role, which the PostgreSQL test
    // harness never gives tests; CI applies 053 on PostgreSQL through db:migrate.
    skip: process.env.DATABASE_URL
      ? "embedded only: replays a migration with the owner connection"
      : false,
  },
  async () => {
    const optIn = await register("fix-web-mig-in"),
      optOut = await register("fix-web-mig-out"),
      laterGrant = await register("fix-web-mig-grant");
    await db.system(async (tx) => {
      const put = (u: any, marketing: boolean, at: string) =>
        tx.query(
          "INSERT INTO notification_preferences(tenant_id,user_id,data,updated_at) VALUES($1,$2,$3,$4)",
          [u.tenantId, u.userId, JSON.stringify({ marketing }), at],
        );
      const consent = (u: any, granted: boolean, at: string) =>
        tx.query(
          "INSERT INTO consent_records(id,tenant_id,user_id,document_type,document_version,granted,created_at) VALUES(gen_random_uuid(),$1,$2,'marketing','privacy:1',$3,$4)",
          [u.tenantId, u.userId, granted, at],
        );
      await put(optIn, true, "2026-01-02T00:00:00Z");
      // Granted, then opted out in settings: the opt-out must survive.
      await consent(optOut, true, "2026-01-01T00:00:00Z");
      await put(optOut, false, "2026-01-02T00:00:00Z");
      // A stale unticked flag older than a later explicit grant stays granted.
      await put(laterGrant, false, "2026-01-01T00:00:00Z");
      await consent(laterGrant, true, "2026-01-02T00:00:00Z");
    });
    const sql = await readFile(
      new URL(
        "../packages/db/migrations/053_marketing_consent_history.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const statements = sql
      .split(/;\s*\n/)
      .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
      .filter((s) => s && !s.startsWith("INSERT INTO schema_migrations"));
    assert.equal(statements.length, 2);
    await db.system(async (tx) => {
      for (const statement of statements) await tx.query(statement);
    });
    assert.deepEqual(
      (await marketingRows(optIn)).map((r: any) => [
        r.granted,
        r.document_version,
      ]),
      [[true, "legacy:notification-preferences"]],
    );
    assert.equal((await preferences(optIn)).data.marketing, true);
    assert.deepEqual(
      (await marketingRows(optOut)).map((r: any) => r.granted),
      [true, false],
    );
    assert.equal((await preferences(optOut)).data.marketing, false);
    assert.deepEqual(
      (await marketingRows(laterGrant)).map((r: any) => r.granted),
      [true],
    );
    const [mirror] = await asOwner(laterGrant, (tx) =>
      tx.query(
        "SELECT data FROM notification_preferences WHERE tenant_id=$1 AND user_id=$2",
        [laterGrant.tenantId, laterGrant.userId],
      ),
    );
    assert.equal(mirror.data.marketing, true);
  },
);

test("web:G7 development accepts the 127.0.0.1 alias origin; production does not", async () => {
  const login = (host: string, origin: string) =>
    request(
      "/auth/login",
      "POST",
      { email: "nobody@fix-web.test", password: "WrongPassword2026!" },
      undefined,
      { host, origin },
    );
  const alias = await login("127.0.0.1:3000", "http://127.0.0.1:3000");
  assert.notEqual(alias.json().code, "ORIGIN_REJECTED", alias.body);
  assert.equal(alias.statusCode, 401, alias.body);
  const otherPort = await login("127.0.0.1:3000", "http://127.0.0.1:3001");
  assert.equal(otherPort.statusCode, 403);
  assert.equal(otherPort.json().code, "ORIGIN_REJECTED");
  const dev = await resolveRequestHost(
    db,
    {
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { host: "127.0.0.1:3000" },
    },
    { publicUrl: "http://localhost:3000", production: false },
  );
  assert.equal(allowedRequestOrigin(dev, "http://127.0.0.1:3000"), true);
  assert.equal(allowedRequestOrigin(dev, "http://localhost:3000"), true);
  assert.equal(allowedRequestOrigin(dev, "http://127.0.0.1:4000"), false);
  const prod = await resolveRequestHost(
    db,
    {
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { host: "localhost:3000" },
    },
    { publicUrl: "http://localhost:3000", production: true },
  );
  assert.equal(allowedRequestOrigin(prod, "http://localhost:3000"), true);
  assert.equal(allowedRequestOrigin(prod, "http://127.0.0.1:3000"), false);
  await assert.rejects(
    resolveRequestHost(
      db,
      {
        method: "POST",
        url: "/api/v1/auth/login",
        headers: { host: "127.0.0.1:3000" },
      },
      { publicUrl: "http://localhost:3000", production: true },
    ),
    /not connected/,
  );
});

test("LIVE-2 a private workspace keeps the platform icon and never exposes site assets", async () => {
  const coach = await register("fix-web-private");
  assert.deepEqual(coachAppLinks({ slug: coach.slug, published: false }), []);
  assert.deepEqual(coachAppLinks({ slug: coach.slug }), []);
  assert.equal(
    (await request(`/public/sites/${coach.slug}/icon/192`)).statusCode,
    404,
  );
  const boot = (
    await request("/bootstrap", "GET", undefined, coach.cookie)
  ).json();
  assert.deepEqual(coachAppLinks(boot.tenant), []);
  await db.system((tx) =>
    tx.query("UPDATE tenants SET published=true WHERE id=$1", [coach.tenantId]),
  );
  const published = (
    await request("/bootstrap", "GET", undefined, coach.cookie)
  ).json().tenant;
  const links = coachAppLinks(published);
  assert.deepEqual(
    links.map(([rel]) => rel),
    ["manifest", "icon", "apple-touch-icon"],
  );
  for (const [, href] of links) {
    const response = await request(href.replace("/api/v1", ""));
    assert.equal(response.statusCode, 200, href);
  }
});

test("product-roadmap:G8 unknown admin addresses do not resolve to the overview", () => {
  assert.equal(adminRoute("/admin"), "overview");
  assert.equal(adminRoute("/admin/finance"), "finance");
  assert.equal(adminRoute("/admin/finance/controls"), "finance");
  assert.equal(adminRoute("/admin/security"), "operations");
  assert.equal(adminRoute("/admin/trainers/abc"), "operations");
  assert.equal(adminRoute("/admin/settings/billing"), "settings");
  assert.equal(
    adminRoute("/admin/infrastructure/observer"),
    "infrastructure_observer",
  );
  assert.equal(adminRoute("/admin/nonexistent"), "not_found");
  assert.equal(adminRoute("/admin/finance/unknown"), "not_found");
  assert.equal(adminRoute("/administrator"), "not_found");
});

function memoryStore(initial: Record<string, unknown> = {}): QueueStore & {
  data: Map<string, string>;
} {
  const data = new Map(
    Object.entries(initial).map(([k, v]) => [
      k,
      typeof v === "string" ? v : JSON.stringify(v),
    ]),
  );
  return {
    data,
    get length() {
      return data.size;
    },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}
const fail = (status: number | undefined, code = "X", message = code) =>
  Object.assign(new Error(message), { status, code });
const workoutItem = (n: number, loadKg = 50): WorkoutQueueItem => ({
  path: "/workouts/w1/sets",
  logicalKey: "w1:Squat:" + n,
  body: {
    eventKey: "00000000-0000-4000-8000-00000000000" + n,
    exercise: "Squat",
    set: n,
    reps: 5,
    loadKg,
  },
});
const T = "tenant-1",
  U = "user-1";

test("web:G4 a rejected set moves to needs-attention while later sets keep syncing", async () => {
  const keys = offlineQueueKeys("workout", T, U);
  const store = memoryStore({
    [keys.pending]: [workoutItem(1, 1000), workoutItem(2)],
  });
  const posted: number[] = [];
  const result = await drainWorkoutQueue(store, T, U, async (_path, body) => {
    const set = (body as any).set;
    posted.push(set);
    if (set === 1) throw fail(400, "VALIDATION", "loadKg: Too big");
    return { id: "event" };
  });
  assert.deepEqual(posted, [1, 2]);
  assert.equal(readList(store, keys.pending).length, 0);
  const rejected = readList(store, keys.rejected);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].item.body.set, 1);
  assert.equal(rejected[0].failure.code, "VALIDATION");
  assert.deepEqual(readList(store, keys.receipts), ["w1:Squat:2"]);
  assert.equal(result.stopped, undefined);
  // Retry keeps the same idempotent event key; discard removes it for good.
  retryRejected<WorkoutQueueItem>(
    store,
    keys,
    rejected[0].item.body.eventKey,
    (i) => i.body.eventKey,
  );
  assert.equal(
    readList(store, keys.pending)[0].body.eventKey,
    workoutItem(1).body.eventKey,
  );
  assert.equal(readList(store, keys.rejected).length, 0);
  await drainWorkoutQueue(store, T, U, async () => {
    throw fail(409, "SET_ALREADY_LOGGED");
  });
  assert.equal(unsyncedCount(store, T, U), 1);
  discardRejected<WorkoutQueueItem>(
    store,
    keys,
    workoutItem(1).body.eventKey,
    (i) => i.body.eventKey,
  );
  assert.equal(unsyncedCount(store, T, U), 0);
});

test("nutrition:G6 transient, session and access failures stop replay without losing entries", async () => {
  const keys = offlineQueueKeys("nutrition", T, U);
  const entry = (n: number): NutritionQueueItem => ({
    eventKey: "meal-" + n,
    date: "2026-09-26",
    timezone: "Asia/Dubai",
    name: "Meal " + n,
  });
  for (const [error, reason] of [
    [fail(503, "PROVIDER_UNAVAILABLE"), "retry"],
    [fail(429, "RATE_LIMITED"), "retry"],
    [new TypeError("Failed to fetch"), "retry"],
    [fail(401, "UNAUTHENTICATED"), "session"],
    [fail(402, "NUTRITION_REQUIRED"), "blocked"],
    [fail(403, "PERMISSION_REQUIRED"), "blocked"],
  ] as const) {
    const store = memoryStore({ [keys.pending]: [entry(1), entry(2)] });
    let calls = 0;
    const result = await drainNutritionQueue(store, T, U, async () => {
      calls++;
      throw error;
    });
    assert.equal(calls, 1, reason);
    assert.equal(result.stopped?.reason, reason);
    assert.equal(readList(store, keys.pending).length, 2);
    assert.equal(readList(store, keys.rejected).length, 0);
  }
  const store = memoryStore({ [keys.pending]: [entry(1), entry(2)] });
  const posted: string[] = [];
  const result = await drainNutritionQueue(store, T, U, async (path, body) => {
    assert.equal(path, "/nutrition/logs");
    posted.push((body as any).eventKey);
    if ((body as any).eventKey === "meal-1")
      throw fail(400, "LOG_DATE", "Use your profile timezone");
    return {};
  });
  assert.deepEqual(posted, ["meal-1", "meal-2"]);
  assert.deepEqual(readList(store, keys.pending), []);
  assert.deepEqual(
    result.rejected.map((r) => r.item.eventKey),
    ["meal-1"],
  );
  assert.equal(classifyQueueFailure({ message: "x", status: 409 }), "rejected");
  assert.equal(classifyQueueFailure({ message: "x", status: 500 }), "retry");
});

test("web:M1 a duplicate offline correction is set aside and the next meal still syncs", async () => {
  const keys = offlineQueueKeys("nutrition", T, U);
  const base = { date: "2026-09-26", timezone: "Asia/Dubai" };
  const store = memoryStore({
    [keys.pending]: [
      { ...base, eventKey: "a1", name: "Fix 1", correctsId: "x" },
      { ...base, eventKey: "a2", name: "Fix 2", correctsId: "x" },
      { ...base, eventKey: "m", name: "Lunch" },
    ],
  });
  const corrected = new Set<string>(),
    posted: string[] = [];
  await drainNutritionQueue(store, T, U, async (_path, body: any) => {
    posted.push(body.eventKey);
    if (body.correctsId && corrected.has(body.correctsId))
      throw fail(409, "LOG_CHANGED", "This entry already has a correction.");
    if (body.correctsId) corrected.add(body.correctsId);
    return {};
  });
  assert.deepEqual(posted, ["a1", "a2", "m"]);
  assert.deepEqual(readList(store, keys.pending), []);
  const rejected = readList(store, keys.rejected);
  assert.deepEqual(
    rejected.map((r: any) => [r.item.eventKey, r.failure.code]),
    [["a2", "LOG_CHANGED"]],
  );
});

test("web:M2 a set queued during an in-flight replay is sent without another trigger", async () => {
  const keys = offlineQueueKeys("workout", T, U);
  const store = memoryStore({ [keys.pending]: [workoutItem(1)] });
  let active = 0,
    maxActive = 0;
  const posted: number[] = [];
  const post = async (_path: string, body: any) => {
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 30));
    posted.push(body.set);
    active--;
    return {};
  };
  const first = drainWorkoutQueue(store, T, U, post);
  await new Promise((resolve) => setTimeout(resolve, 5));
  // The second tap happens while set 1 is still in flight.
  store.setItem(
    keys.pending,
    JSON.stringify([...readList(store, keys.pending), workoutItem(2)]),
  );
  const second = drainWorkoutQueue(store, T, U, post);
  await Promise.all([first, second]);
  assert.deepEqual(posted, [1, 2]);
  assert.equal(maxActive, 1);
  assert.deepEqual(readList(store, keys.pending), []);
  assert.deepEqual(readList(store, keys.receipts), [
    "w1:Squat:1",
    "w1:Squat:2",
  ]);
});

test("web:G3 session expiry and sign-out keep unsynced member queues; caches are cleared", async () => {
  const workout = offlineQueueKeys("workout", T, U),
    nutrition = offlineQueueKeys("nutrition", T, U);
  const store = memoryStore({
    "trainer:offline": { expires: 1 },
    [`trainer:nutrition:${T}:${U}`]: { data: {} },
    [workout.pending]: [workoutItem(1)],
    [workout.receipts]: ["w1:Squat:0"],
    [workout.rejected]: [{ item: workoutItem(3), failure: { message: "x" } }],
    [nutrition.pending]: [{ eventKey: "m" }],
    [nutrition.rejected]: [
      { item: { eventKey: "n" }, failure: { message: "x" } },
    ],
    "unrelated:key": "kept",
  });
  // A session that ended stops replay and keeps the queue.
  const stopped = await drainQueue<WorkoutQueueItem>(
    store,
    workout,
    async () => {
      throw fail(401, "UNAUTHENTICATED");
    },
    { id: (i) => i.body.eventKey },
  );
  assert.equal(stopped.stopped?.reason, "session");
  clearLocalData(store, { keepQueues: true });
  assert.deepEqual(
    [...store.data.keys()].sort(),
    [
      nutrition.pending,
      nutrition.rejected,
      workout.pending,
      workout.receipts,
      workout.rejected,
      "unrelated:key",
    ].sort(),
  );
  assert.equal(unsyncedCount(store, T, U), 4);
  assert.equal(unsyncedCount(store, T, "another-user"), 0);
  // After the same member signs in again the queue replays.
  const posted: string[] = [];
  await drainWorkoutQueue(store, T, U, async (_p, body: any) => {
    posted.push(body.eventKey);
  });
  assert.deepEqual(posted, [workoutItem(1).body.eventKey]);
  clearLocalData(store, { keepQueues: false });
  assert.deepEqual([...store.data.keys()], ["unrelated:key"]);
});
