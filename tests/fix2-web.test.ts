import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createDatabase, type Database } from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";
// Namespace import: helpers added by this fix fail their own test, not the file.
import * as queue from "../apps/web/components/offline-queue.ts";
import {
  classifyQueueFailure,
  drainNutritionQueue,
  drainWorkoutQueue,
  offlineQueueKeys,
  readList,
  type NutritionQueueItem,
  type QueueStore,
  type WorkoutQueueItem,
} from "../apps/web/components/offline-queue.ts";

// The wire contract between the web queue and the API identity hook.
const OWNER_HEADER = "X-Queue-Owner",
  MISMATCH = "SESSION_OWNER_MISMATCH";
let db: Database,
  app: Awaited<ReturnType<typeof buildApp>>,
  coach: any,
  memberA: any,
  memberB: any,
  workoutId: string;
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
      ...headers,
    },
    payload: body as any,
  });
const cookieOf = (r: any) => String(r.headers["set-cookie"]).split(";")[0];
const user = async (cookie: string) => ({
  ...(await request("/bootstrap", "GET", undefined, cookie)).json().user,
  cookie,
});
async function invite(email: string) {
  const invitation = await request(
    "/invitations",
    "POST",
    { email, role: "subscriber" },
    coach.cookie,
  );
  assert.equal(invitation.statusCode, 200, invitation.body);
  const joined = await request("/invitations/accept", "POST", {
    token: invitation.json().url.split("/").pop(),
    name: email,
    email,
    password: "FixtureOnly2026!",
    accepted: true,
  });
  assert.equal(joined.statusCode, 200, joined.body);
  return user(cookieOf(joined));
}
// Tenant rows go through the coach's own tenant transaction, as the restricted
// PostgreSQL runtime role requires.
const asCoach = (fn: (tx: any) => Promise<any>): Promise<any> =>
  db.tenant(
    { tenantId: coach.tenantId, userId: coach.userId, role: "owner" },
    fn,
  );
const eventCount = async (eventKey: string) =>
  (
    await asCoach((tx) =>
      tx.query(
        "SELECT count(*)::int AS n FROM workout_events WHERE event_key=$1",
        [eventKey],
      ),
    )
  )[0].n as number;
const holdCount = async (userId: string) =>
  (
    await asCoach((tx) =>
      tx.query(
        "SELECT count(*)::int AS n FROM records WHERE kind='training_hold' AND owner_user_id=$1",
        [userId],
      ),
    )
  )[0].n as number;
/** The web api() contract: a non-2xx response throws with status and code. */
const postAs =
  (cookie: string) =>
  async (path: string, body: unknown, headers: Record<string, string>) => {
    const r = await request(path, "POST", body, cookie, headers);
    if (r.statusCode >= 400)
      throw Object.assign(new Error(r.json().message), {
        status: r.statusCode,
        code: r.json().code,
      });
    return r.json();
  };

const savedUrl = process.env.PUBLIC_APP_URL;
before(async () => {
  process.env.PUBLIC_APP_URL = "http://localhost:3000";
  db = await createDatabase({ memory: true });
  app = await buildApp({ db, testing: true });
  const registered = await request("/auth/register", "POST", {
    name: "Coach fix2",
    email: "fix2-web-coach@fix2-web.test",
    password: "FixtureOnly2026!",
    slug: "fix2-web-coach",
    accepted: true,
  });
  assert.equal(registered.statusCode, 201, registered.body);
  coach = await user(cookieOf(registered));
  memberA = await invite("fix2-web-a@fix2-web.test");
  memberB = await invite("fix2-web-b@fix2-web.test");
  // Member A has paid access; member B has none.
  await asCoach((tx) =>
    tx.query(
      "INSERT INTO subscriptions(id,tenant_id,user_id,status,period_end,price_minor) VALUES($1,$2,$3,'active',now()+interval '30 days',10000)",
      [randomUUID(), coach.tenantId, memberA.userId],
    ),
  );
  const program = await request(
    "/programs",
    "POST",
    {
      subscriberId: memberA.userId,
      program: {
        title: "Replay foundations",
        goal: "Controlled practice",
        daysPerWeek: 3,
        exercises: [
          {
            name: "Goblet squat",
            sets: 4,
            reps: 10,
            restSeconds: 90,
            loadKg: 12,
            cue: "Controlled reps",
          },
        ],
      },
    },
    coach.cookie,
  );
  assert.equal(program.statusCode, 200, program.body);
  const started = await request(
    "/workouts/start",
    "POST",
    { programId: program.json().id },
    memberA.cookie,
  );
  assert.equal(started.statusCode, 200, started.body);
  workoutId = started.json().id;
});
after(async () => {
  await app?.close();
  await db?.close();
  if (savedUrl === undefined) delete process.env.PUBLIC_APP_URL;
  else process.env.PUBLIC_APP_URL = savedUrl;
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
const fail = (status: number, code: string) =>
  Object.assign(new Error(code), { status, code });
const T = "tenant-1",
  U = "user-1";
const workoutItem = (n: number): WorkoutQueueItem => ({
  path: "/workouts/w1/sets",
  logicalKey: "w1:Squat:" + n,
  body: {
    eventKey: "00000000-0000-4000-8000-00000000000" + n,
    exercise: "Squat",
    set: n,
    reps: 5,
    loadKg: 50,
  },
});
const meal = (n: number): NutritionQueueItem => ({
  eventKey: "meal-" + n,
  date: "2026-09-26",
  timezone: "Asia/Dubai",
  name: "Meal " + n,
});

test("fix2-web:1 a workspace switch replays first and keeps unsynced and needs-attention entries", async () => {
  const workout = offlineQueueKeys("workout", T, U),
    nutrition = offlineQueueKeys("nutrition", T, U),
    otherMember = offlineQueueKeys("workout", T, "user-2").pending,
    otherWorkspace = offlineQueueKeys("nutrition", "tenant-2", U).pending;
  const store = memoryStore({
    "trainer:offline": { expires: 1 },
    [`trainer:nutrition:${T}:${U}`]: { data: {} },
    [workout.pending]: [workoutItem(1), workoutItem(2)],
    [nutrition.rejected]: [
      { item: meal(9), failure: { message: "x" }, rejectedAt: "2026-09-26" },
    ],
    [otherMember]: [workoutItem(3)],
    [otherWorkspace]: [meal(4)],
  });
  const events: string[] = [];
  const left = await queue.leaveSession(store, T, U, {
    online: true,
    post: async (_path, body: any, headers) => {
      events.push("post:" + body.set);
      assert.equal(headers[OWNER_HEADER], `${T}:${U}`);
      if (body.set === 2) throw fail(429, "RATE_LIMITED");
    },
    confirm: (unsynced) => {
      events.push("confirm:" + unsynced);
      return true;
    },
    leave: async () => {
      events.push("switch");
    },
  });
  assert.equal(left, true);
  // The replay runs while the current session is valid, before the switch.
  assert.deepEqual(events, ["post:1", "post:2", "confirm:2", "switch"]);
  assert.deepEqual(
    [...store.data.keys()].sort(),
    [
      workout.pending,
      workout.receipts,
      nutrition.rejected,
      otherMember,
      otherWorkspace,
    ].sort(),
  );
  assert.deepEqual(
    readList<WorkoutQueueItem>(store, workout.pending).map((i) => i.body.set),
    [2],
  );
  assert.equal(readList(store, nutrition.rejected).length, 1);

  // Choosing to stay leaves the session and every key in place.
  const stay = memoryStore({
    "trainer:offline": { expires: 1 },
    [workout.pending]: [workoutItem(1)],
  });
  let switched = false;
  assert.equal(
    await queue.leaveSession(stay, T, U, {
      online: false,
      post: async () => assert.fail("offline devices do not replay"),
      confirm: () => false,
      leave: async () => {
        switched = true;
      },
    }),
    false,
  );
  assert.equal(switched, false);
  assert.equal(stay.data.size, 2);

  // The switcher uses this sequence; no blanket wipe of device data remains.
  const source = await readFile(
    new URL("../apps/web/components/workspace.tsx", import.meta.url),
    "utf8",
  );
  const switcher = source.slice(
    source.indexOf("function WorkspaceSwitcher"),
    source.indexOf("function PlainShell"),
  );
  assert.match(switcher, /leaveSession\(/);
  assert.ok(
    switcher.indexOf("leaveSession(") < switcher.indexOf('"/auth/workspace"'),
  );
  assert.doesNotMatch(source, /startsWith\("trainer:"\)\)\s*localStorage/);
});

test("fix2-web:2 every replay names its queue owner; a mismatch stops with entries kept", async () => {
  const seen: unknown[] = [];
  const record = async (_path: string, _body: unknown, headers: unknown) => {
    seen.push(headers);
  };
  await drainWorkoutQueue(
    memoryStore({
      [offlineQueueKeys("workout", T, U).pending]: [workoutItem(1)],
    }),
    T,
    U,
    record,
  );
  await drainNutritionQueue(
    memoryStore({
      [offlineQueueKeys("nutrition", T, U).pending]: [meal(1)],
    }),
    T,
    U,
    record,
  );
  assert.deepEqual(seen, [
    { [OWNER_HEADER]: `${T}:${U}` },
    { [OWNER_HEADER]: `${T}:${U}` },
  ]);
  assert.equal(
    classifyQueueFailure({ status: 409, code: MISMATCH, message: "x" }),
    "session",
  );
  const keys = offlineQueueKeys("nutrition", T, U);
  const store = memoryStore({ [keys.pending]: [meal(1), meal(2)] });
  let calls = 0;
  const result = await drainNutritionQueue(store, T, U, async () => {
    calls++;
    throw fail(409, MISMATCH);
  });
  assert.equal(calls, 1);
  assert.equal(result.stopped?.reason, "session");
  assert.equal(readList(store, keys.pending).length, 2);
  assert.equal(readList(store, keys.rejected).length, 0);
});

test("fix2-web:2 the API refuses a replay under another member without side effects", async () => {
  const owner = { [OWNER_HEADER]: `${memberA.tenantId}:${memberA.userId}` };
  const set = (n: number, notes?: string) => ({
    eventKey: randomUUID(),
    exercise: "Goblet squat",
    set: n,
    reps: 10,
    loadKg: 12,
    ...(notes ? { notes } : {}),
  });
  // A stale tab of member A replays while member B is signed in. B has no paid
  // access, so without the owner check this note would open a hold on B.
  const pain = set(1, "Sharp pain during the first squat");
  const stale = await request(
    `/workouts/${workoutId}/sets`,
    "POST",
    pain,
    memberB.cookie,
    owner,
  );
  assert.equal(stale.statusCode, 409, stale.body);
  assert.equal(stale.json().code, MISMATCH);
  assert.equal(await holdCount(memberB.userId), 0);
  assert.equal(await eventCount(pain.eventKey), 0);
  // Another workspace of the same person is also a different queue owner.
  const otherWorkspace = await request(
    `/workouts/${workoutId}/sets`,
    "POST",
    set(1),
    memberA.cookie,
    { [OWNER_HEADER]: `${randomUUID()}:${memberA.userId}` },
  );
  assert.equal(otherWorkspace.statusCode, 409, otherWorkspace.body);
  assert.equal(otherWorkspace.json().code, MISMATCH);
  const signedOut = await request(
    `/workouts/${workoutId}/sets`,
    "POST",
    set(1),
    undefined,
    owner,
  );
  assert.equal(signedOut.statusCode, 401, signedOut.body);

  // Through the real queue: B's session keeps A's entries on the device, and
  // A's own session then replays them exactly once.
  const keys = offlineQueueKeys("workout", memberA.tenantId, memberA.userId);
  const item = (n: number): WorkoutQueueItem => ({
    path: `/workouts/${workoutId}/sets`,
    logicalKey: `${workoutId}:Goblet squat:${n}`,
    body: set(n),
  });
  const store = memoryStore({ [keys.pending]: [item(1), item(2)] });
  const blocked = await drainWorkoutQueue(
    store,
    memberA.tenantId,
    memberA.userId,
    postAs(memberB.cookie),
  );
  assert.equal(blocked.stopped?.reason, "session");
  assert.equal(blocked.stopped?.failure.code, MISMATCH);
  assert.equal(readList(store, keys.pending).length, 2);
  assert.equal(readList(store, keys.rejected).length, 0);
  const pending = readList<WorkoutQueueItem>(store, keys.pending);
  for (const entry of pending)
    assert.equal(await eventCount(entry.body.eventKey), 0);
  const synced = await drainWorkoutQueue(
    store,
    memberA.tenantId,
    memberA.userId,
    postAs(memberA.cookie),
  );
  assert.equal(synced.stopped, undefined);
  assert.equal(synced.synced.length, 2);
  assert.equal(readList(store, keys.pending).length, 0);
  // A repeated replay of an accepted entry is idempotent by event key.
  const again = await request(
    pending[0].path,
    "POST",
    pending[0].body,
    memberA.cookie,
    owner,
  );
  assert.equal(again.statusCode, 200, again.body);
  assert.equal(again.json().duplicate, true);
  for (const entry of pending)
    assert.equal(await eventCount(entry.body.eventKey), 1);
  // Requests that are not replays carry no owner and are unaffected.
  const direct = await request(
    `/workouts/${workoutId}/sets`,
    "POST",
    set(3),
    memberA.cookie,
  );
  assert.equal(direct.statusCode, 200, direct.body);
  assert.equal(
    (await request("/bootstrap", "GET", undefined, memberB.cookie)).statusCode,
    200,
  );
});

test("fix2-web:3 an entry removed after an access stop is never reported as recorded", async () => {
  const keys = offlineQueueKeys("nutrition", T, U);
  const id = (e: NutritionQueueItem) => e.eventKey;
  const outcome = async (error?: Error) => {
    const store = memoryStore({ [keys.pending]: [meal(1)] });
    const result = await drainNutritionQueue(store, T, U, async () => {
      if (error) throw error;
    });
    // The diary removes local nutrition data when access changed.
    if (result.stopped?.reason === "blocked") {
      store.removeItem(keys.pending);
      store.removeItem(keys.rejected);
    }
    return queue.entryOutcome<NutritionQueueItem>(
      store,
      keys,
      "meal-1",
      id,
      result,
    );
  };
  assert.equal(await outcome(fail(402, "NUTRITION_MEMBERSHIP")), "discarded");
  assert.equal(await outcome(fail(403, "NUTRITION_PERMISSION")), "discarded");
  assert.equal(await outcome(), "accepted");
  assert.equal(await outcome(fail(429, "RATE_LIMITED")), "pending");
  assert.equal(await outcome(fail(409, MISMATCH)), "pending");
  assert.equal(await outcome(fail(400, "LOG_DATE")), "rejected");
  // An entry accepted by an earlier pass is still reported as recorded.
  assert.equal(
    queue.entryOutcome<NutritionQueueItem>(memoryStore(), keys, "meal-1", id, {
      synced: [],
      rejected: [],
    }),
    "accepted",
  );
});
