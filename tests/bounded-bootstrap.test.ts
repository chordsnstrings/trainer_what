// Bounded workspace bootstrap and keyset paging, on a large synthetic
// workspace (tests/bootstrap-fixtures.ts). Every person and row is invented.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, type Database } from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";
import {
  PAGE_SIZES,
  PINNED_URGENT_EXCEPTIONS,
  RECORD_CATALOG,
  RECORD_COLUMN_NAMES,
  decodeCursor,
  encodeCursor,
  searchTerms,
} from "../apps/api/src/workspace-pages.ts";
import {
  appendPage,
  appendRelated,
  canLoadMore,
  mergePages,
  needsWorkoutSets,
  nextPagePath,
  pageInfo,
  urgentFirst,
} from "../apps/web/components/workspace-paging.ts";
import {
  LARGE,
  largeWorkspace,
  person,
  session,
  type Person,
  type Sized,
} from "./bootstrap-fixtures.ts";

let db: Database,
  app: Awaited<ReturnType<typeof buildApp>>,
  w: Awaited<ReturnType<typeof largeWorkspace>>;
const saved = process.env.PUBLIC_APP_URL;
before(async () => {
  process.env.PUBLIC_APP_URL = "http://localhost:3000";
  db = await createDatabase({ memory: true });
  app = await buildApp({ db, testing: true });
  w = await largeWorkspace(db);
  app.addHook("preHandler", async req => { if (req.url.includes("/workspace/pages/members") && req.url.includes("q=")) console.log("Synthetic member search query", req.url, JSON.stringify(req.query)); });
});
after(async () => {
  await app?.close();
  await db?.close();
  if (saved === undefined) delete process.env.PUBLIC_APP_URL;
  else process.env.PUBLIC_APP_URL = saved;
});
const call = (path: string, cookie?: string) =>
  app.inject({
    url: "/api/v1" + path,
    headers: {
      origin: "http://localhost:3000",
      host: "localhost:3000",
      ...(cookie ? { cookie } : {}),
    },
  });
async function ok(path: string, cookie: string) {
  const r = await call(path, cookie);
  assert.equal(r.statusCode, 200, path + " " + r.body.slice(0, 300));
  return r.json();
}
// Tenant rows go through the owner's transaction, as the restricted
// PostgreSQL runtime role requires.
const asOwner = (fn: (tx: any) => Promise<any>): Promise<any> =>
  db.tenant(w.scope, fn);
const page = (collection: string, params: Record<string, string> = {}) =>
  `/workspace/pages/${collection}?${new URLSearchParams(params)}`;
/** Follows cursors to the end, optionally changing data between pages. */
async function walk(
  cookie: string,
  collection: string,
  params: Record<string, string>,
  start: { cursor: string | null; hasMore: boolean } = {
    cursor: null,
    hasMore: true,
  },
  between?: (n: number) => Promise<void>,
) {
  const rows: any[] = [];
  let cursor = start.cursor,
    hasMore = start.hasMore,
    n = 0;
  while (hasMore) {
    if (between) await between(n);
    const r = await ok(
      page(collection, { ...params, ...(cursor ? { cursor } : {}) }),
      cookie,
    );
    rows.push(...r.items);
    if (r.hasMore) assert.ok(r.cursor, "a page with more rows has a cursor");
    cursor = r.cursor;
    hasMore = r.hasMore;
    assert.ok(++n < 2000, "walk did not end");
  }
  return rows;
}
const ids = (rows: any[]) => rows.map((r) => r.id);
const noDuplicates = (values: string[]) =>
  assert.equal(new Set(values).size, values.length, "duplicate rows");
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
async function timedBootstrap(p: Person) {
  const times: number[] = [];
  let body: any,
    size = 0;
  for (let i = 0; i < 3; i++) {
    const started = performance.now();
    const r = await call("/bootstrap", p.cookie);
    times.push(performance.now() - started);
    assert.equal(r.statusCode, 200, r.body.slice(0, 300));
    size = Buffer.byteLength(r.body);
    body = r.json();
  }
  times.sort((a, b) => a - b);
  return { body, size, ms: Math.round(times[1]) };
}
const measured: Record<string, { bytes: number; ms: number }> = {};

test("bootstrap is bounded per role under the large fixture", async (t) => {
  const limits: Record<string, number> = {
    owner: 600_000,
    staff: 520_000,
    finance: 220_000,
    subscriber: 40_000,
  };
  for (const p of [w.owner, w.staff, w.finance, w.follower]) {
    const { body, size, ms } = await timedBootstrap(p);
    measured[p.role] = { bytes: size, ms };
    t.diagnostic(`${p.role}: ${size} bytes, median ${ms} ms`);
    assert.ok(size < limits[p.role], `${p.role} payload ${size} bytes`);
    const byKind = new Map<string, number>();
    for (const r of body.records)
      byKind.set(r.kind, (byKind.get(r.kind) ?? 0) + 1);
    for (const [kind, n] of byKind) {
      assert.ok(RECORD_CATALOG[kind], `unexpected kind ${kind}`);
      // Each kind is its page plus the bounded pinned rows (confirmed rules,
      // the oldest open safety and personal-review exceptions).
      const cap =
        RECORD_CATALOG[kind].page +
        (kind === "rule" ? 100 : 0) +
        (kind === "exception" ? PINNED_URGENT_EXCEPTIONS : 0);
      assert.ok(n <= Math.max(cap, 50), `${kind}: ${n}`);
    }
    assert.ok(body.sets.length <= PAGE_SIZES.sets + 500);
    assert.ok(body.subscriptions.length <= PAGE_SIZES.subscriptions);
    assert.ok(body.complimentary.length <= PAGE_SIZES.complimentary);
    assert.ok(body.consents.length <= PAGE_SIZES.consents);
    for (const name of ["events", "costs", "journals"] as const)
      if (body[name]) assert.ok(body[name].length <= PAGE_SIZES[name]);
    if (body.members)
      assert.ok(
        body.members.length <=
          PAGE_SIZES.team +
            PAGE_SIZES.members +
            2 * (RECORD_CATALOG.exception.page + PINNED_URGENT_EXCEPTIONS),
      );
    // Kinds excluded before remain excluded.
    assert.ok(
      !body.records.some(
        (r: any) =>
          ["twin_snapshot", "retention_policy", "planned_session"].includes(
            r.kind,
          ) || r.kind.startsWith("nutrition_"),
      ),
    );
  }
  const owner = (await ok("/bootstrap", w.owner.cookie)) as any;
  assert.equal(owner.pages.records.message.hasMore, true);
  assert.equal(owner.pages.records.exception.hasMore, true);
  assert.equal(owner.pages.members.hasMore, true);
  assert.equal(owner.pages.sets.hasMore, true);
  assert.equal(owner.pages.events.hasMore, true);
  assert.equal(owner.pages.journals.hasMore, true);
  assert.equal(owner.pages.records.product.hasMore, false);
  assert.equal(owner.pages.records.product.cursor, null);
  // Sources carry their size, not their text.
  const source = owner.records.find((r: any) => r.kind === "source");
  assert.equal(source.data.text, undefined);
  assert.equal(source.data.chunks, undefined);
  assert.ok(source.data.textLength > 10_000);
  assert.equal(source.data.chunkCount, 11);
  assert.deepEqual(Object.keys(source).sort(), [...RECORD_COLUMN_NAMES].sort());
});

test("record rows keep every records column", async () => {
  const columns = await asOwner((tx) =>
    tx.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name='records' AND table_schema='public'",
    ),
  );
  assert.deepEqual(
    columns.map((c: any) => c.column_name).sort(),
    [...RECORD_COLUMN_NAMES].sort(),
  );
});

test("totals stay exact when lists are paged", async () => {
  const owner = (await ok("/bootstrap", w.owner.cookie)) as any;
  assert.equal(owner.totals.subscribers, LARGE.followers);
  assert.equal(owner.totals.members, LARGE.followers + 3);
  assert.equal(owner.totals.records.message, LARGE.messages);
  assert.equal(owner.totals.records.workout, LARGE.workouts);
  assert.equal(owner.totals.records.exception, LARGE.exceptions);
  assert.equal(owner.totals.openExceptions, LARGE.exceptions / 2);
  assert.equal(owner.totals.confirmedRules, 30);
  assert.equal(owner.totals.sets, LARGE.sets);
  assert.equal(owner.totals.subscriptions, LARGE.followers);
  assert.equal(owner.totals.activeSubscriptions, LARGE.followers * 0.9);
  const [expected] = await asOwner((tx) =>
    tx.query(
      "SELECT count(*) FILTER(WHERE status='completed')::int AS completed,(SELECT sum((data->>'reps')::numeric*(data->>'loadKg')::numeric) FROM workout_events)::float8 AS volume FROM records WHERE kind='workout'",
    ),
  );
  assert.equal(owner.totals.completedWorkouts, expected.completed);
  assert.equal(owner.totals.setVolumeKg, expected.volume);
  // The bootstrap now lists only open exceptions, all of them reachable.
  const open = owner.records.filter((r: any) => r.kind === "exception");
  assert.ok(open.every((r: any) => r.status === "open"));
  const rest = await walk(
    w.owner.cookie,
    "records",
    { kind: "exception" },
    owner.pages.records.exception,
  );
  assert.equal(open.length + rest.length, LARGE.exceptions / 2);
  // A follower's totals are their own.
  const follower = (await ok("/bootstrap", w.follower.cookie)) as any;
  const [own] = await asOwner((tx) =>
    tx.query(
      "SELECT (SELECT count(*)::int FROM records WHERE kind='message' AND owner_user_id=$1) AS messages,(SELECT count(*)::int FROM workout_events WHERE user_id=$1) AS sets",
      [w.follower.userId],
    ),
  );
  assert.equal(follower.totals.records.message, own.messages);
  assert.equal(follower.totals.sets, own.sets);
  assert.equal(follower.totals.subscribers, undefined);
  assert.equal(follower.members, undefined);
});

test("a follower pages only their own rows through every endpoint", async () => {
  const f = w.follower;
  const messages = await walk(f.cookie, "records", {
    kind: "message",
    limit: "3",
  });
  assert.ok(messages.length > 0);
  assert.ok(messages.every((m: any) => m.owner_user_id === f.userId));
  const [own] = await asOwner((tx) =>
    tx.query(
      "SELECT count(*)::int AS n FROM records WHERE kind='message' AND owner_user_id=$1",
      [f.userId],
    ),
  );
  assert.equal(messages.length, own.n);
  for (const kind of ["workout", "program", "intake", "support"]) {
    const rows = await walk(f.cookie, "records", { kind });
    assert.ok(
      rows.every((r: any) => r.owner_user_id === f.userId),
      kind,
    );
  }
  for (const kind of ["exception", "decision", "rule", "source", "scenario"])
    assert.deepEqual(
      (await ok(page("records", { kind }), f.cookie)).items,
      [],
      kind,
    );
  const sets = await walk(f.cookie, "sets", {});
  assert.ok(sets.length > 0 && sets.every((s: any) => s.user_id === f.userId));
  const subscriptions = await walk(f.cookie, "subscriptions", {});
  assert.deepEqual(
    subscriptions.map((s: any) => s.user_id),
    [f.userId],
  );
  const grants = await walk(f.cookie, "complimentary", {});
  assert.ok(grants.every((g: any) => g.user_id === f.userId));
  for (const name of [
    "members",
    "events",
    "costs",
    "journals",
    "payouts",
    "usageStatements",
  ]) {
    const r = await call(page(name), f.cookie);
    assert.equal(r.statusCode, 403, name + " " + r.body);
  }
  // An owner's cursor does not widen what a follower can read.
  const ownerFirst = await ok(
    page("records", { kind: "message" }),
    w.owner.cookie,
  );
  const replayed = await ok(
    page("records", { kind: "message", cursor: ownerFirst.cursor }),
    f.cookie,
  );
  assert.ok(replayed.items.every((m: any) => m.owner_user_id === f.userId));
  // Another member's record is unavailable by id; the follower's own is not.
  const [others] = await asOwner((tx) =>
    tx.query(
      "SELECT id FROM records WHERE kind='workout' AND owner_user_id=$1 LIMIT 1",
      [w.otherFollower.userId],
    ),
  );
  assert.equal(
    (await call(`/workspace/records/${others.id}`, f.cookie)).statusCode,
    404,
  );
  const [mine] = await asOwner((tx) =>
    tx.query(
      "SELECT id FROM records WHERE kind='workout' AND owner_user_id=$1 LIMIT 1",
      [f.userId],
    ),
  );
  assert.equal(
    (await ok(`/workspace/records/${mine.id}`, f.cookie)).id,
    mine.id,
  );
  // Set logs of another member's workout stay hidden even when named.
  assert.deepEqual(
    (await ok(page("sets", { workoutId: others.id }), f.cookie)).items,
    [],
  );
});

test("each paged collection keeps the bootstrap's role rules", async () => {
  const expectations: [Person, string, number][] = [
    [w.staff, "costs", 403],
    [w.staff, "journals", 403],
    [w.staff, "payouts", 403],
    [w.staff, "usageStatements", 403],
    [w.staff, "members", 200],
    [w.staff, "events", 200],
    [w.finance, "costs", 200],
    [w.finance, "journals", 200],
    [w.finance, "members", 200],
    [w.owner, "usageStatements", 200],
  ];
  for (const [p, name, status] of expectations) {
    const r = await call(page(name), p.cookie);
    assert.equal(
      r.statusCode,
      status,
      `${p.role} ${name}: ${r.body.slice(0, 200)}`,
    );
  }
  // Row-level security still applies inside an allowed collection.
  assert.deepEqual((await ok(page("sets"), w.finance.cookie)).items, []);
  assert.deepEqual(
    (await ok(page("records", { kind: "workout" }), w.finance.cookie)).items,
    [],
  );
  assert.equal((await call(page("records"), undefined)).statusCode, 401);
  assert.equal((await call(page("nothing"), w.owner.cookie)).statusCode, 404);
  // Inherited object keys are neither collections nor kinds.
  for (const name of ["constructor", "toString", "__proto__"])
    assert.equal(
      (await call(page(name), w.owner.cookie)).statusCode,
      404,
      name,
    );
  assert.equal(
    (await call(page("records", { kind: "constructor" }), w.owner.cookie))
      .statusCode,
    400,
  );
  assert.equal((await call(page("records"), w.owner.cookie)).statusCode, 400);
  for (const kind of [
    "retention_policy",
    "twin_snapshot",
    "nutrition_log",
    "planned_session",
  ])
    assert.equal(
      (await call(page("records", { kind }), w.owner.cookie)).statusCode,
      400,
      kind,
    );
  for (const cursor of [
    "not-a-cursor",
    encodeCursor(["x", "y"]),
    encodeCursor(["2026-01-01T00:00:00.000000Z"]),
  ])
    assert.equal(
      (
        await call(page("records", { kind: "message", cursor }), w.owner.cookie)
      ).json().code,
      "INVALID_CURSOR",
    );
  assert.equal(
    (await call(page("events", { limit: "101" }), w.owner.cookie)).statusCode,
    400,
  );
  // Another workspace sees none of this workspace's rows.
  const other = await largeWorkspace(
    db,
    {
      ...LARGE,
      followers: 3,
      messages: 5,
      workouts: 3,
      programs: 2,
      plannedSessions: 1,
      exceptions: 2,
      sets: 5,
      events: 2,
      costs: 1,
      journals: 1,
      notifications: 1,
    },
    "Other",
  );
  const [record] = await asOwner((tx) =>
    tx.query("SELECT id FROM records WHERE kind='message' LIMIT 1"),
  );
  assert.equal(
    (await call(`/workspace/records/${record.id}`, other.owner.cookie))
      .statusCode,
    404,
  );
  const theirs = await walk(other.owner.cookie, "records", { kind: "message" });
  assert.equal(theirs.length, 5);
  const members = await walk(other.owner.cookie, "members", {
    role: "subscriber",
  });
  assert.equal(members.length, 3);
  assert.ok(members.every((m: any) => other.followers.includes(m.id)));
  // A suspended workspace refuses the new routes like the bootstrap.
  await db.system((tx) =>
    tx.query("UPDATE tenants SET lifecycle_state='suspended' WHERE id=$1", [
      other.tenantId,
    ]),
  );
  for (const path of [
    page("records", { kind: "message" }),
    `/workspace/records/${record.id}`,
    "/bootstrap",
  ])
    assert.equal(
      (await call(path, other.owner.cookie)).json().code,
      "WORKSPACE_SUSPENDED",
      path,
    );
});

test("the subscribers list pages, searches and shows membership state", async () => {
  const first = await ok(
    page("members", { role: "subscriber" }),
    w.staff.cookie,
  );
  assert.equal(first.items.length, PAGE_SIZES.members);
  assert.equal(first.items[0].name, "Follower 0001");
  assert.equal(typeof first.items[0].programs, "number");
  assert.ok("subscription_status" in first.items[0]);
  const all = await walk(w.staff.cookie, "members", { role: "subscriber" });
  assert.equal(all.length, LARGE.followers);
  noDuplicates(ids(all));
  assert.deepEqual(
    all.map((m: any) => m.name),
    [...all.map((m: any) => m.name)].sort(),
  );
  const found = await ok(
    page("members", { role: "subscriber", q: "Follower 0421" }),
    w.staff.cookie,
  );
  assert.deepEqual(
    found.items.map((m: any) => m.name),
    ["Follower 0421"],
  );
  // The web client sends one value per word (a space in a proxied query
  // value fails the signed host proof); every word must match.
  const terms = await ok(
    "/workspace/pages/members?role=subscriber&q=follower&q=0421",
    w.staff.cookie,
  );
  assert.deepEqual(
    terms.items.map((m: any) => m.name),
    ["Follower 0421"],
  );
  assert.deepEqual(searchTerms([" Sam  Taylor ", "x"]), ["Sam", "Taylor", "x"]);
  assert.equal(searchTerms("a b c d e f g").length, 5);
  // Search text is matched literally, not as a pattern.
  assert.deepEqual(
    (await ok(page("members", { role: "subscriber", q: "%" }), w.staff.cookie))
      .items,
    [],
  );
  const one = await ok(
    page("members", { role: "subscriber", userId: w.followers[250] }),
    w.owner.cookie,
  );
  assert.deepEqual(ids(one.items), [w.followers[250]]);
  const team = await ok(page("members", { role: "team" }), w.owner.cookie);
  assert.deepEqual(team.items.map((m: any) => m.role).sort(), [
    "finance",
    "owner",
    "staff",
  ]);
  const [counts] = await asOwner((tx) =>
    tx.query(
      "SELECT count(*)::int AS programs FROM records WHERE kind='program' AND owner_user_id=$1",
      [first.items[0].id],
    ),
  );
  assert.equal(first.items[0].programs, counts.programs);
});

test("cursors neither repeat nor skip rows while new rows arrive", async () => {
  const boot = (await ok("/bootstrap", w.owner.cookie)) as any;
  const expected = ids(
    await asOwner((tx) =>
      tx.query(
        "SELECT id FROM records WHERE kind='message' ORDER BY created_at DESC,id DESC",
      ),
    ),
  );
  const inserted: string[] = [];
  const addMessages = () =>
    asOwner(async (tx) => {
      for (const row of await tx.query(
        "INSERT INTO records(id,tenant_id,kind,owner_user_id,status,data) SELECT gen_random_uuid(),$1,'message',$2::uuid,'sent',jsonb_build_object('text','Arrived while paging','author','trainer','subscriberId',$3::text) FROM generate_series(1,3) RETURNING id",
        [w.tenantId, w.followers[7], w.followers[7]],
      ))
        inserted.push(row.id);
    });
  const firstPage = boot.records
    .filter((r: any) => r.kind === "message")
    .sort((a: any, b: any) => expected.indexOf(a.id) - expected.indexOf(b.id));
  const rest = await walk(
    w.owner.cookie,
    "records",
    { kind: "message", limit: "97" },
    boot.pages.records.message,
    () => addMessages(),
  );
  const walked = [...ids(firstPage), ...ids(rest)];
  noDuplicates(walked);
  assert.deepEqual(walked, expected);
  assert.ok(
    inserted.length > 0 && inserted.every((id) => !walked.includes(id)),
  );
  // The refreshed first page starts with the new rows.
  const refreshed = await ok(
    page("records", { kind: "message", limit: "3" }),
    w.owner.cookie,
  );
  assert.ok(inserted.includes(refreshed.items[0].id));

  // Set logs, with more logs saved between pages.
  const sets = ids(
    await asOwner((tx) =>
      tx.query(
        "SELECT id FROM workout_events ORDER BY created_at DESC,id DESC",
      ),
    ),
  );
  let extra = 0;
  // The walk starts before the first new log arrives.
  const walkedSets = await walk(w.owner.cookie, "sets", {}, undefined, (n) =>
    n > 0 && n % 10 === 0
      ? asOwner((tx) =>
          tx.query(
            'INSERT INTO workout_events(id,tenant_id,user_id,workout_id,event_key,data) VALUES(gen_random_uuid(),$1,$2,gen_random_uuid(),$3,\'{"exercise":"Row","set":1,"reps":8,"loadKg":40}\')',
            [w.tenantId, w.followers[3], "late-" + ++extra],
          ),
        )
      : Promise.resolve(),
  );
  assert.deepEqual(ids(walkedSets), sets);
  assert.ok(extra > 0);

  // Notifications: the keyset form keeps its place; new notices are newer.
  const notices = ids(
    await asOwner((tx) =>
      tx.query(
        "SELECT id FROM notifications WHERE user_id=$1 ORDER BY created_at DESC,id DESC",
        [w.owner.userId],
      ),
    ),
  );
  const seen: string[] = [];
  let batch = await ok("/notifications", w.owner.cookie);
  while (batch.length) {
    seen.push(...ids(batch));
    await asOwner((tx) =>
      tx.query(
        "INSERT INTO notifications(id,tenant_id,user_id,category,dedupe_key,title,body) VALUES(gen_random_uuid(),$1,$2,'coaching',$3,'New','New notice')",
        [w.tenantId, w.owner.userId, "late:" + randomUUID()],
      ),
    );
    if (batch.length < 50) break;
    batch = await ok(
      `/notifications?before=${batch[batch.length - 1].id}`,
      w.owner.cookie,
    );
  }
  assert.deepEqual(seen, notices);
  assert.equal(
    (await call(`/notifications?before=${randomUUID()}`, w.owner.cookie)).json()
      .code,
    "INVALID_CURSOR",
  );
  // A follower cannot use another person's notification as a position.
  assert.equal(
    (await call(`/notifications?before=${notices[0]}`, w.follower.cookie))
      .statusCode,
    400,
  );

  // Members, with people added on both sides of the position.
  const before = new Set(
    ids(await walk(w.staff.cookie, "members", { role: "subscriber" })),
  );
  const added: string[] = [];
  const walkedMembers = await walk(
    w.staff.cookie,
    "members",
    { role: "subscriber", limit: "60" },
    undefined,
    (n) =>
      db.system(async (tx) => {
        for (const name of [`Follower 0000-${n}`, `Follower 9999-${n}`]) {
          const [u] = await tx.query(
            "INSERT INTO users(id,name,email,password_hash,email_verified) VALUES(gen_random_uuid(),$1,$2,'synthetic',true) RETURNING id",
            [name, `late-${randomUUID()}@example.test`],
          );
          await tx.query(
            "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'subscriber')",
            [w.tenantId, u.id],
          );
          added.push(u.id);
        }
      }),
  );
  noDuplicates(ids(walkedMembers));
  for (const id of before) assert.ok(ids(walkedMembers).includes(id));
  assert.ok(
    ids(walkedMembers).every((id) => before.has(id) || added.includes(id)),
  );
});

test("rows sharing one timestamp page in a stable order", async () => {
  // One statement: every row gets the same created_at.
  const created = ids(
    await asOwner((tx) =>
      tx.query(
        "INSERT INTO records(id,tenant_id,kind,owner_user_id,status,data) SELECT gen_random_uuid(),$1,'conflict',$2,'open',jsonb_build_object('description','Tied '||i) FROM generate_series(1,130) AS i RETURNING id",
        [w.tenantId, w.owner.userId],
      ),
    ),
  );
  const [stamps] = await asOwner((tx) =>
    tx.query(
      "SELECT count(DISTINCT created_at)::int AS n FROM records WHERE id=ANY($1::uuid[])",
      [created],
    ),
  );
  assert.equal(stamps.n, 1);
  const walked = await walk(w.owner.cookie, "records", {
    kind: "conflict",
    limit: "7",
  });
  noDuplicates(ids(walked));
  assert.deepEqual(ids(walked), [...created].sort().reverse());
});

test("admin overview and audit lists page by cursor", async () => {
  const admin = await person(
    db,
    w.tenantId,
    "staff",
    "Platform Admin",
    "admin",
  );
  await db.system((tx) =>
    tx.query(
      "INSERT INTO tenants(id,slug,name) SELECT gen_random_uuid(),'bb-old-'||i,'Older workspace '||i FROM generate_series(1,520) AS i",
    ),
  );
  // The oldest workspace, beyond the 500-row picker, is still selectable.
  await db.system((tx) =>
    tx.query(
      "UPDATE tenants SET created_at=now()-interval '10 years' WHERE slug='bb-old-1'",
    ),
  );
  const [oldest] = await db.system((tx) =>
    tx.query("SELECT id FROM tenants WHERE slug='bb-old-1'"),
  );
  const selected = await call(
    `/admin/operations/trainers?tenantId=${oldest.id}`,
    admin.cookie,
  );
  assert.equal(selected.statusCode, 200, selected.body.slice(0, 200));
  assert.deepEqual(ids(selected.json().rows), [oldest.id]);

  const all = ids(
    await db.system((tx) =>
      tx.query("SELECT id FROM tenants ORDER BY created_at DESC,id DESC"),
    ),
  );
  const pages: any[] = [];
  let overview = await ok("/admin/overview", admin.cookie);
  pages.push(overview);
  while (overview.hasMore) {
    overview = await ok(
      `/admin/overview?cursor=${encodeURIComponent(overview.cursor)}`,
      admin.cookie,
    );
    pages.push(overview);
  }
  const listed = pages.flatMap((p) => ids(p.tenants));
  noDuplicates(listed);
  assert.deepEqual(listed, all);
  assert.ok(pages.every((p) => p.tenants.length <= 50));
  assert.equal(pages[0].totals.workspaces, all.length);
  const large = pages
    .flatMap((p) => p.tenants)
    .find((t: any) => t.id === w.tenantId);
  assert.equal(large.openExceptions, LARGE.exceptions / 2);
  assert.ok(large.exceptions.length <= 20);

  // Operations workspace pages by cursor too.
  const opsPages: string[] = [];
  let ops = await ok("/admin/operations/trainers?cursor=", admin.cookie);
  opsPages.push(...ids(ops.rows));
  while (ops.hasMore) {
    ops = await ok(
      `/admin/operations/trainers?cursor=${encodeURIComponent(ops.nextCursor)}`,
      admin.cookie,
    );
    opsPages.push(...ids(ops.rows));
  }
  assert.deepEqual(opsPages, all);

  // Security audit list: every entry once, newest first.
  const audit = ids(
    await db.system((tx) =>
      tx.query(
        "SELECT o.id FROM admin_operations_audit o ORDER BY o.created_at DESC,o.id DESC",
      ),
    ),
  );
  let security = await ok("/admin/operations/security", admin.cookie);
  const entries = ids(security.rows);
  while (security.rowsHasMore) {
    security = await ok(
      `/admin/operations/security?rowsCursor=${encodeURIComponent(security.rowsCursor)}`,
      admin.cookie,
    );
    entries.push(...ids(security.rows));
  }
  noDuplicates(entries);
  // Each read adds its own audit entry, which is newer than the walk.
  assert.deepEqual(
    entries.filter((id) => audit.includes(id)),
    audit.filter((id) => entries.includes(id)),
  );
  assert.ok(audit.every((id) => entries.includes(id)) || audit.length === 0);
});

test("the bootstrap keeps its size while followers and messages grow", async (t) => {
  const beforeGrowth = { bytes: (await timedBootstrap(w.owner)).size };
  const more = { followers: 300, messages: 2000 };
  const followers = await db.system(async (tx) => {
    const rows = await tx.query(
      "INSERT INTO users(id,name,email,password_hash,email_verified) SELECT gen_random_uuid(),'Late follower '||i,'bb-late-'||i||'-'||$1||'@example.test','synthetic',true FROM generate_series(1,$2) AS i RETURNING id",
      [w.tenantId, more.followers],
    );
    await tx.query(
      "INSERT INTO memberships(tenant_id,user_id,role) SELECT $1,u,'subscriber' FROM unnest($2::uuid[]) AS u",
      [w.tenantId, rows.map((r: any) => r.id)],
    );
    return rows.map((r: any) => r.id);
  });
  await asOwner((tx) =>
    tx.query(
      "INSERT INTO records(id,tenant_id,kind,owner_user_id,status,data,created_at,updated_at) SELECT gen_random_uuid(),$1,'message',($2::uuid[])[1+(i % cardinality($2::uuid[]))],'sent',jsonb_build_object('text','Synthetic coaching message '||i||': how did the last session feel, and did anything limit your range of motion today?','author','trainer'),now()-interval '3 days'-(i*interval '1 minute'),now()-interval '3 days' FROM generate_series(1,$3) AS i",
      [w.tenantId, followers, more.messages],
    ),
  );
  const after = await timedBootstrap(w.owner);
  t.diagnostic(
    `owner before growth ${beforeGrowth.bytes} bytes, after ${after.size} bytes (${after.ms} ms)`,
  );
  assert.equal(
    after.body.totals.subscribers >= LARGE.followers + more.followers,
    true,
  );
  // Row counts are capped, so only the counts and names inside rows change.
  assert.ok(
    after.size <= beforeGrowth.bytes * 1.05,
    `${after.size} vs ${beforeGrowth.bytes}`,
  );
});

test("web paging helpers merge pages without duplicates", () => {
  const state = {
    records: [
      { id: "a", kind: "rule", status: "confirmed" },
      { id: "b", kind: "exception", status: "open" },
    ],
    journals: [{ id: "j1" }],
    usageStatements: [{ period: "2026-08" }],
    pages: {
      records: {
        exception: { hasMore: true, cursor: "c1" },
        rule: { hasMore: false, cursor: null },
      },
      journals: { hasMore: true, cursor: "j" },
    },
  };
  assert.equal(mergePages(state, {}), state);
  assert.equal(
    canLoadMore(pageInfo(state.pages, {}, "records", "exception")),
    true,
  );
  assert.equal(
    canLoadMore(pageInfo(state.pages, {}, "records", "rule")),
    false,
  );
  assert.equal(canLoadMore(pageInfo(state.pages, {}, "payouts")), false);
  assert.equal(
    nextPagePath("records", { hasMore: true, cursor: "c1" }, "exception"),
    "/workspace/pages/records?cursor=c1&kind=exception",
  );
  let extra = appendPage({}, "records:exception", {
    items: [
      { id: "b", kind: "exception" },
      { id: "c", kind: "exception" },
    ],
    hasMore: true,
    cursor: "c2",
  });
  extra = appendPage(extra, "records:exception", {
    items: [
      { id: "c", kind: "exception" },
      { id: "d", kind: "exception" },
    ],
    hasMore: false,
    cursor: null,
  });
  extra = appendPage(extra, "usageStatements", {
    items: [{ period: "2026-08" }, { period: "2026-07" }],
    hasMore: false,
    cursor: null,
  });
  const merged = mergePages(state, extra);
  assert.deepEqual(ids(merged.records), ["a", "b", "c", "d"]);
  assert.deepEqual(
    merged.usageStatements.map((s: any) => s.period),
    ["2026-08", "2026-07"],
  );
  assert.deepEqual(pageInfo(state.pages, extra, "records", "exception"), {
    hasMore: false,
    cursor: null,
  });
  assert.deepEqual(
    decodeCursor(
      encodeCursor([
        "2026-09-27T10:11:12.123456Z",
        "00000000-0000-4000-8000-000000000001",
      ]),
      ["ts", "uuid"],
    ),
    ["2026-09-27T10:11:12.123456Z", "00000000-0000-4000-8000-000000000001"],
  );
});

// ---- review regressions: screens that must not lose rows to paging ---------

/** A workspace with `followers` followers and only the fixture's fixed rows. */
const small = (followers: number, label: string) =>
  largeWorkspace(
    db,
    {
      followers,
      messages: 0,
      workouts: 0,
      programs: 0,
      plannedSessions: 0,
      exceptions: 0,
      sets: 0,
      events: 0,
      costs: 0,
      journals: 0,
      notifications: 0,
    } satisfies Sized,
    label,
  );
const post = (path: string, cookie: string, payload: unknown) =>
  app.inject({
    method: "POST",
    url: "/api/v1" + path,
    headers: {
      origin: "http://localhost:3000",
      host: "localhost:3000",
      cookie,
    },
    payload: payload as any,
  });
/** Records with explicit ids, owners and ages (minutes before now). */
const insertRecords = (
  tx: any,
  tenantId: string,
  rows: {
    id: string;
    kind: string;
    owner: string;
    status: string;
    data: unknown;
    age: number;
  }[],
) =>
  tx.query(
    `INSERT INTO records(id,tenant_id,kind,owner_user_id,status,data,created_at,updated_at)
     SELECT x.id,$1,x.kind,x.owner,x.status,x.data,now()-(x.age*interval '1 minute'),now()-(x.age*interval '1 minute')
     FROM jsonb_to_recordset($2::jsonb) AS x(id uuid,kind text,owner uuid,status text,data jsonb,age int)`,
    [tenantId, JSON.stringify(rows)],
  );

test("every listed workout shows all of its set logs", async () => {
  const s = await small(3, "Sets");
  const me = s.follower;
  const program = {
    title: "Synthetic block",
    exercises: Array.from({ length: 6 }, (_, e) => ({
      name: `Exercise ${e + 1}`,
      sets: 3,
      reps: 10,
      restSeconds: 90,
      loadKg: 20,
      rir: 2,
      cue: "Controlled tempo",
      alternatives: [],
    })),
  };
  // Ten completed sessions and the newest one active, 18 set logs each:
  // 198 logs, more than the bootstrap's 100 most recent.
  await db.tenant(s.scope, async (tx) => {
    await insertRecords(
      tx,
      s.tenantId,
      Array.from({ length: 11 }, (_, i) => ({
        id: randomUUID(),
        kind: "workout",
        owner: me.userId,
        status: i === 10 ? "active" : "completed",
        data: { program },
        age: (11 - i) * 1440,
      })),
    );
    await tx.query(
      `INSERT INTO workout_events(id,tenant_id,user_id,workout_id,event_key,data,created_at)
       SELECT gen_random_uuid(),$1,$2,w.id,'sets-'||w.id||'-'||e||'-'||n,jsonb_build_object('exercise','Exercise '||e,'set',n,'reps',10,'loadKg',20,'rir',2),w.created_at+(e*interval '1 minute')+(n*interval '1 second')
       FROM records w CROSS JOIN generate_series(1,6) AS e CROSS JOIN generate_series(1,3) AS n
       WHERE w.kind='workout' AND w.owner_user_id=$2`,
      [s.tenantId, me.userId],
    );
  });
  for (const viewer of [me, s.owner]) {
    const boot = await ok("/bootstrap", viewer.cookie);
    assert.equal(boot.pages.sets.hasMore, true);
    const listed = boot.records.filter((r: any) => r.kind === "workout");
    assert.equal(listed.length, 11);
    const fromBootstrap = (id: string) =>
      new Set(
        boot.sets.filter((x: any) => x.workout_id === id).map((x: any) => x.id),
      );
    // The bound is real: the bootstrap alone leaves older sessions without
    // their logs (the regression shown as "Log set" on logged sets).
    assert.ok(listed.some((w: any) => fromBootstrap(w.id).size < 18));
    for (const workout of listed) {
      // As the workout screen does: bootstrap logs, plus the workout's own
      // logs by id when the bootstrap's list is incomplete.
      const need = needsWorkoutSets(
        workout,
        viewer,
        !boot.pages.sets.hasMore,
      );
      const shown = fromBootstrap(workout.id);
      if (need)
        for (const x of await walk(viewer.cookie, "sets", {
          workoutId: workout.id,
        }))
          shown.add(x.id);
      assert.equal(shown.size, 18, `${viewer.role} ${workout.status}`);
      if (viewer.role === "subscriber" && workout.status === "active")
        assert.equal(need, false, "an active session works offline");
    }
  }
});

test("a support thread with a new reply comes first", async () => {
  const s = await small(3, "Support");
  // The fixture opens 60 threads a minute apart.
  const [oldest] = await db.tenant(s.scope, (tx) =>
    tx.query(
      "SELECT id,owner_user_id FROM records WHERE kind='support' ORDER BY created_at,id LIMIT 1",
    ),
  );
  const supportRows = (boot: any) =>
    boot.records.filter((r: any) => r.kind === "support");
  const before = await ok("/bootstrap", s.owner.cookie);
  assert.equal(supportRows(before).length, 50);
  assert.ok(!ids(supportRows(before)).includes(oldest.id));
  const reply = await post(
    `/support/${oldest.id}/reply`,
    await session(db, oldest.owner_user_id, s.tenantId),
    { message: "Thanks, that answered my question." },
  );
  assert.equal(reply.statusCode, 200, reply.body);
  const after = await ok("/bootstrap", s.owner.cookie);
  assert.equal(supportRows(after)[0].id, oldest.id);
  assert.equal(after.pages.records.support.hasMore, true);
  // The rest follows by latest change, each thread once.
  const rest = await walk(
    s.owner.cookie,
    "records",
    { kind: "support" },
    after.pages.records.support,
  );
  const all = [...ids(supportRows(after)), ...ids(rest)];
  noDuplicates(all);
  assert.equal(all.length, 60);
  const walked = await walk(s.owner.cookie, "records", {
    kind: "support",
    limit: "7",
  });
  assert.equal(walked[0].id, oldest.id);
  assert.equal(walked.length, 60);
  noDuplicates(ids(walked));
});

test("the attention list keeps old safety reviews, names and decisions", async () => {
  const s = await small(150, "Attention");
  // Followers sorted by name: those after the first 100 are not on the
  // bootstrap's first members page.
  const late = s.followers.slice(100);
  const decision = (i: number) => ({
    id: randomUUID(),
    kind: "decision",
    owner: late[i % late.length],
    status: "pending_review",
    data: {
      message: `Draft reply ${i}`,
      subscriberId: late[i % late.length],
    },
    age: 20000 + i,
  });
  const decisions = Array.from({ length: 62 }, (_, i) => decision(i));
  // The ten oldest human reviews (the second page) concern people no newer
  // item names; every other item names someone else.
  const who = (i: number) => late[i < 10 ? i : 10 + (i % 40)];
  const exception = (
    category: string,
    i: number,
    age: number,
    status = "open",
    extra: Record<string, unknown> = {},
  ) => ({
    id: randomUUID(),
    kind: "exception",
    owner: who(i),
    status,
    data: {
      category,
      description: `${category} item ${i}`,
      subscriberId: who(i),
      ...(i < decisions.length ? { decisionId: decisions[i].id } : {}),
      ...extra,
    },
    age,
  });
  // 60 newer open human reviews; one open safety review three days old, one
  // overdue personal review two days old; closed items that stay closed.
  const human = Array.from({ length: 60 }, (_, i) =>
    exception("human_review", i, 60 - i),
  );
  const safety = exception("safety", 60, 3 * 1440);
  const policy = exception("policy_review", 61, 2 * 1440, "open", {
    overdueAt: new Date(Date.now() - 3600_000).toISOString(),
  });
  const closedSafety = exception("safety", 99, 4 * 1440, "resolved");
  const closed = Array.from({ length: 60 }, (_, i) =>
    exception("human_review", 100 + i, 6000 + i, "resolved"),
  );
  await db.tenant(s.scope, (tx) =>
    insertRecords(tx, s.tenantId, [
      ...decisions,
      ...human,
      safety,
      policy,
      closedSafety,
      ...closed,
    ]),
  );
  const staffUser = await person(db, s.tenantId, "staff", "Attention Coach");
  for (const viewer of [s.owner, staffUser]) {
    const boot = await ok("/bootstrap", viewer.cookie);
    const open = boot.records.filter(
      (r: any) => r.kind === "exception" && r.status === "open",
    );
    assert.equal(boot.totals.openExceptions, 62);
    // The first page is the 50 newest; the old safety and personal reviews
    // are pinned, and closed ones are not.
    assert.equal(open.length, 52);
    assert.ok(ids(open).includes(safety.id), "old safety review listed");
    assert.ok(ids(open).includes(policy.id));
    assert.ok(!ids(boot.records).includes(closedSafety.id));
    const ordered = urgentFirst(open);
    assert.deepEqual(ids(ordered.slice(0, 2)), [safety.id, policy.id]);
    for (const e of open) {
      assert.ok(
        boot.records.some((d: any) => d.id === e.data.decisionId),
        "decision pinned",
      );
      assert.ok(
        boot.members.some((m: any) => m.id === e.data.subscriberId),
        "name pinned",
      );
    }
    // The older page carries its own decisions and names.
    const next = await ok(
      page("records", {
        kind: "exception",
        cursor: boot.pages.records.exception.cursor,
      }),
      viewer.cookie,
    );
    assert.equal(next.hasMore, false);
    assert.ok(
      next.items.some(
        (e: any) =>
          !boot.members.some((m: any) => m.id === e.data.subscriberId),
      ),
      "the older page names people outside the bootstrap",
    );
    const merged = mergePages(
      boot,
      appendRelated(
        appendPage({}, "records:exception", next),
        next.related,
      ),
    );
    const listed = merged.records.filter(
      (r: any) => r.kind === "exception" && r.status === "open",
    );
    assert.equal(listed.length, 62);
    noDuplicates(ids(listed));
    for (const e of listed) {
      assert.ok(
        merged.records.some(
          (d: any) => d.kind === "decision" && d.id === e.data.decisionId,
        ),
        "every card quotes its decision without a request of its own",
      );
      assert.ok(
        merged.members.some((m: any) => m.id === e.data.subscriberId),
        "every card names its member",
      );
    }
  }
  // A follower cannot list members, so their pages carry no names.
  const own = await ok(page("records", { kind: "exception" }), s.follower.cookie);
  assert.deepEqual(own.items, []);
  assert.equal(own.related.members, undefined);

  // Operators page every per-workspace list of one workspace.
  const admin = await person(db, s.tenantId, "staff", "Ops Admin", "admin");
  async function walkRows(view: string) {
    const rows: any[] = [];
    let cursor: string | null = null,
      n = 0;
    do {
      const q = new URLSearchParams({ tenantId: s.tenantId });
      if (cursor) q.set("rowsCursor", cursor);
      const r = await ok(`/admin/operations/${view}?${q}`, admin.cookie);
      assert.ok(r.rows.length <= 100);
      assert.deepEqual(r.truncated, []);
      rows.push(...r.rows);
      cursor = r.rowsHasMore ? r.rowsCursor : null;
      if (r.rowsHasMore) assert.ok(r.rowsCursor);
      assert.ok(++n < 50);
    } while (cursor);
    return rows;
  }
  const subscribers = await walkRows("subscribers");
  noDuplicates(ids(subscribers));
  assert.deepEqual(new Set(ids(subscribers)), new Set(s.followers));
  const safetyRows = await walkRows("safety");
  noDuplicates(ids(safetyRows));
  assert.equal(safetyRows.length, 62 + 1 + 60);
  assert.equal(safetyRows[0].id, policy.id, "overdue reviews first");
  const supportRows = await walkRows("support");
  assert.equal(supportRows.length, 60);
  for (const view of ["brains", "wearables", "infrastructure"])
    await walkRows(view);
  // Across workspaces each lists its first rows and names the truncated.
  const across = await ok("/admin/operations/safety", admin.cookie);
  assert.ok(
    across.truncated.some((t: any) => t.tenantId === s.tenantId),
    "a workspace with more rows is named",
  );
  assert.equal(
    across.rows.filter((r: any) => r.tenant_id === s.tenantId).length,
    100,
  );
  const unscoped = await call(
    "/admin/operations/safety?rowsCursor=" + encodeCursor(["x"]),
    admin.cookie,
  );
  assert.equal(unscoped.statusCode, 400);
  assert.equal(unscoped.json().code, "WORKSPACE_REQUIRED");
});

test("program pickers list the first followers and search the rest", async () => {
  const overview = await ok("/training/overview", w.owner.cookie);
  assert.equal(overview.members.length, 100);
  assert.equal(overview.membersHasMore, true);
  const names = overview.members.map((m: any) => m.name);
  assert.deepEqual(names, [...names].sort());
  // A selected follower outside the first names is always included.
  const last = w.followers[w.followers.length - 1];
  const selected = await ok(
    "/training/overview?subscriberId=" + last,
    w.staff.cookie,
  );
  assert.ok(selected.members.some((m: any) => m.id === last));
  assert.equal(
    (await ok("/training/overview", w.follower.cookie)).members,
    undefined,
  );
});

test("web helpers order urgent items and decide when to read set logs", () => {
  const at = (days: number) =>
    new Date(Date.now() - days * 86400_000).toISOString();
  const list = [
    { id: "h1", created_at: at(1), data: { category: "human_review" } },
    { id: "p", created_at: at(2), data: { category: "policy_review" } },
    { id: "s2", created_at: at(1), data: { category: "safety" } },
    { id: "h2", created_at: at(9), data: { category: "human_review" } },
    { id: "s1", created_at: at(5), data: { category: "safety" } },
  ];
  assert.deepEqual(ids(urgentFirst(list)), ["s1", "s2", "p", "h1", "h2"]);
  const follower = { role: "subscriber", userId: "me" };
  const trainer = { role: "owner", userId: "coach" };
  const active = { status: "active", owner_user_id: "me" };
  const done = { status: "completed", owner_user_id: "me" };
  assert.equal(needsWorkoutSets(active, follower, false), false);
  assert.equal(needsWorkoutSets(done, follower, false), true);
  assert.equal(needsWorkoutSets(done, follower, true), false);
  assert.equal(needsWorkoutSets(active, trainer, false), true);
  const extra = appendRelated({}, {
    records: [{ id: "d1" }],
    members: [{ id: "m1", name: "Named" }],
    journals: [{ id: "ignored" }],
  });
  assert.deepEqual(Object.keys(extra).sort(), [
    "related:members",
    "related:records",
  ]);
  const merged = mergePages(
    { records: [{ id: "d1" }], members: [], pages: {} },
    extra,
  );
  assert.deepEqual(ids(merged.records), ["d1"]);
  assert.deepEqual(ids(merged.members), ["m1"]);
  assert.equal(pageInfo({}, extra, "members"), undefined);
});
