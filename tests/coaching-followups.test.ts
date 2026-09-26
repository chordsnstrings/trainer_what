import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createDatabase,
  putRecord,
  type Actor,
  type Database,
  type Tx,
} from "@trainer/db";
import {
  deliverCoachingFollowup,
  processCoachingFollowups,
  exportCoachingFollowups,
  eraseCoachingFollowups,
} from "../apps/api/src/coaching-followups.ts";
import { workspaceLock } from "../apps/api/src/privacy-lifecycle.ts";
import { buildApp } from "../apps/api/src/app.ts";
import { tokenHash } from "../apps/api/src/auth.ts";
import { privacyHooks } from "../apps/api/src/privacy-hooks.ts";

let db: Database,
  app: Awaited<ReturnType<typeof buildApp>>,
  owner: Actor,
  staff: Actor,
  finance: Actor,
  foreign: Actor;
const sessions = new Map<string, string>();
const originalFetch = globalThis.fetch;
let networkCalls = 0;
async function member(tenantId: string, role = "subscriber"): Promise<Actor> {
  const a = { tenantId, userId: randomUUID(), role };
  const token = randomUUID();
  await db.system(async (tx) => {
    await tx.query(
      "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,'fixture')",
      [a.userId, a.userId + "@example.test", "Synthetic " + role],
    );
    await tx.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)",
      [tenantId, a.userId, role],
    );
    await tx.query(
      "INSERT INTO sessions(token_hash,user_id,tenant_id,expires_at) VALUES($1,$2,$3,now()+interval '1 day')",
      [tokenHash(token), a.userId, tenantId],
    );
    if (role === "subscriber") {
      await tx.query(
        "INSERT INTO subscriptions(id,tenant_id,user_id,status,period_end) VALUES($1,$2,$3,'active',now()+interval '120 days')",
        [randomUUID(), tenantId, a.userId],
      );
      await tx.query(
        "INSERT INTO consent_records(id,tenant_id,user_id,document_type,document_version,granted) VALUES($1,$2,$3,'coaching','fixture',true)",
        [randomUUID(), tenantId, a.userId],
      );
      await putRecord(
        tx,
        a,
        "intake",
        { experience: "beginner", limitations: "None reported" },
        { status: "complete" },
      );
    }
  });
  sessions.set(a.userId, token);
  return a;
}
async function workspace() {
  const tenantId = randomUUID();
  await db.system((tx) =>
    tx.query(
      "INSERT INTO tenants(id,slug,name) VALUES($1,$2,'Synthetic follow-ups')",
      [tenantId, tenantId],
    ),
  );
  return member(tenantId, "owner");
}
const due = () => new Date(Date.now() + 3600_000).toISOString();
function body(client: Actor, extra: Record<string, unknown> = {}) {
  return {
    subscriberId: client.userId,
    requestKey: randomUUID(),
    text: "How did your planned session feel? Reply when convenient.",
    dueAt: due(),
    timezone: "Asia/Dubai",
    reviewed: true,
    ...extra,
  };
}
function req(
  a: Actor | null,
  path = "",
  method: any = "GET",
  payload?: unknown,
) {
  return app.inject({
    url: "/api/v1/coaching/followups" + path,
    method,
    payload: payload as any,
    headers: {
      origin: "http://localhost:3000",
      ...(a ? { cookie: "session=" + sessions.get(a.userId) } : {}),
    },
  });
}
async function schedule(
  client: Actor,
  a = owner,
  extra: Record<string, unknown> = {},
) {
  const r = await req(a, "", "POST", body(client, extra));
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}
async function stored(id: string) {
  return (
    await db.tenant(owner, (tx) =>
      tx.query("SELECT * FROM records WHERE id=$1", [id]),
    )
  )[0];
}
const at = (r: any) => new Date(Date.parse(r.data.dueAt) + 1000);
async function output(id: string) {
  return db.system(async (tx) => ({
    messages: await tx.query(
      "SELECT * FROM records WHERE kind='message' AND data->>'followupId'=$1",
      [id],
    ),
    notices: await tx.query(
      "SELECT * FROM notifications WHERE data->'source'->>'id'=$1",
      [id],
    ),
    jobs: await tx.query(
      "SELECT * FROM jobs WHERE data->>'notificationId' IN (SELECT id::text FROM notifications WHERE data->'source'->>'id'=$1)",
      [id],
    ),
  }));
}
before(async () => {
  globalThis.fetch = async () => {
    networkCalls++;
    throw new Error("Follow-up checks must never call a provider");
  };
  db = await createDatabase({ memory: true });
  owner = await workspace();
  foreign = await workspace();
  staff = await member(owner.tenantId, "staff");
  finance = await member(owner.tenantId, "finance");
  app = await buildApp({ db, testing: true });
  await app.ready();
});
after(async () => {
  globalThis.fetch = originalFetch;
  await app?.close();
  await db?.close();
  assert.equal(networkCalls, 0);
});

test("scheduling validates timezone, review and horizon; original intent is idempotent and drafts stay private under RLS", async () => {
  const client = await member(owner.tenantId),
    b = body(client),
    r = await req(owner, "", "POST", b);
  assert.equal(r.statusCode, 200, r.body);
  const saved = r.json();
  assert.equal(saved.data.timezone, "Asia/Dubai");
  assert.equal(saved.data.authorUserId, owner.userId);
  assert.equal((await req(owner, "", "POST", b)).json().id, saved.id);
  assert.equal(
    (await req(owner, "", "POST", { ...b, text: "Different intent" }))
      .statusCode,
    409,
  );
  for (const change of [
    { reviewed: false },
    { dueAt: new Date().toISOString() },
    { dueAt: new Date(Date.now() + 91 * 86400_000).toISOString() },
    { timezone: "Not/AZone" },
  ])
    assert.equal(
      (await req(owner, "", "POST", body(client, change))).statusCode,
      400,
    );
  assert.equal(
    (await req(null, "?subscriberId=" + client.userId)).statusCode,
    401,
  );
  for (const a of [client, finance])
    assert.equal(
      (await req(a, "?subscriberId=" + client.userId)).statusCode,
      403,
    );
  assert.equal(
    (await req(foreign, "?subscriberId=" + client.userId)).statusCode,
    404,
  );
  assert.equal(
    (await req(owner, "", "POST", body(await member(foreign.tenantId))))
      .statusCode,
    409,
  );
  for (const a of [client, finance, foreign]) {
    assert.equal(
      (
        await db.tenant(a, (tx) =>
          tx.query("SELECT id FROM records WHERE id=$1", [saved.id]),
        )
      ).length,
      0,
    );
    assert.equal(
      (
        await db.tenant(a, (tx) =>
          tx.query(
            "UPDATE records SET status='delivered' WHERE id=$1 RETURNING id",
            [saved.id],
          ),
        )
      ).length,
      0,
    );
    await assert.rejects(
      db.tenant(a, (tx) =>
        putRecord(
          tx,
          a === foreign ? owner : a,
          "coaching_followup",
          {},
          { ownerId: a.userId },
        ),
      ),
      /row-level security/,
    );
  }
  assert.equal(
    (await req(staff, "?subscriberId=" + client.userId)).json().records[0].id,
    saved.id,
  );
});

test("rescheduling is author/owner controlled with revision checks; canceled and previously used intents never reactivate", async () => {
  const client = await member(owner.tenantId),
    secondStaff = await member(owner.tenantId, "staff"),
    b = body(client);
  const initial = (await req(staff, "", "POST", b)).json();
  const update = {
    version: initial.version,
    text: "How was your recovery day?",
    dueAt: due(),
    timezone: "Europe/London",
    reviewed: true,
  };
  assert.equal(
    (await req(secondStaff, "/" + initial.id, "PATCH", update)).statusCode,
    403,
  );
  const edited = await req(owner, "/" + initial.id, "PATCH", update);
  assert.equal(edited.statusCode, 200, edited.body);
  assert.equal(edited.json().data.authorUserId, owner.userId);
  assert.deepEqual(
    new Set(edited.json().data.authorUserIds),
    new Set([staff.userId, owner.userId]),
  );
  assert.equal(
    (await req(owner, "/" + initial.id, "PATCH", update)).statusCode,
    409,
  );
  assert.equal(
    (await req(staff, "/" + initial.id + "/cancel", "POST", { version: 2 }))
      .statusCode,
    403,
  );
  assert.equal(
    (await req(owner, "/" + initial.id + "/cancel", "POST", { version: 2 }))
      .statusCode,
    200,
  );
  assert.equal(
    await deliverCoachingFollowup(db, owner.tenantId, initial.id, at(initial)),
    "skipped",
  );
  assert.equal((await req(staff, "", "POST", b)).json().status, "canceled");
  assert.equal(
    (await req(owner, "?subscriberId=" + client.userId)).json().records.length,
    0,
  );
  const history = (
    await req(owner, "?subscriberId=" + client.userId + "&view=history")
  ).json();
  assert.equal(history.records[0].status, "canceled");
  assert.equal((await output(initial.id)).messages.length, 0);
});

test("due delivery commits one human message, inbox notice and queued email across concurrent workers and retries", async () => {
  const client = await member(owner.tenantId),
    r = await schedule(client, staff);
  assert.equal(
    await deliverCoachingFollowup(db, owner.tenantId, r.id, new Date()),
    "skipped",
  );
  const outcomes = await Promise.all([
    deliverCoachingFollowup(db, owner.tenantId, r.id, at(r)),
    deliverCoachingFollowup(db, owner.tenantId, r.id, at(r)),
  ]);
  assert.deepEqual(outcomes.sort(), ["delivered", "skipped"]);
  const result = await output(r.id);
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].data.author, "trainer");
  assert.equal(result.messages[0].data.authorUserId, staff.userId);
  assert.equal(result.messages[0].data.followupRevision, 1);
  assert.equal(result.notices.length, 1);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].status, "pending");
  assert.equal((await stored(r.id)).status, "delivered");
  assert.equal(
    (
      await db.tenant(client, (tx) =>
        tx.query("SELECT id FROM records WHERE id=$1", [result.messages[0].id]),
      )
    ).length,
    1,
  );
  assert.equal(
    (
      await db.tenant(client, (tx) =>
        tx.query("SELECT id FROM records WHERE id=$1", [r.id]),
      )
    ).length,
    0,
  );
  await assert.rejects(
    db.tenant(owner, (tx) =>
      putRecord(
        tx,
        owner,
        "message",
        { followupId: r.id },
        { ownerId: client.userId, status: "sent" },
      ),
    ),
    /unique constraint/,
  );
});

test("delivery notification failure rolls back the message and status; one later retry completes the transaction", async () => {
  const client = await member(owner.tenantId),
    r = await schedule(client);
  const failing: Database = {
    ...db,
    tenant: (actor, fn) =>
      db.tenant(actor, (tx) =>
        fn({
          query: async <T>(sql: string, values?: any[]) => {
            if (sql.startsWith("INSERT INTO notifications"))
              throw new Error("Synthetic notification transaction failure");
            return tx.query<T>(sql, values);
          },
        }),
      ),
  };
  await assert.rejects(
    deliverCoachingFollowup(failing, owner.tenantId, r.id, at(r)),
    /Synthetic notification/,
  );
  assert.equal((await stored(r.id)).status, "scheduled");
  assert.equal((await output(r.id)).messages.length, 0);
  assert.equal(
    await deliverCoachingFollowup(db, owner.tenantId, r.id, at(r)),
    "delivered",
  );
  assert.equal((await output(r.id)).messages.length, 1);
});

test("changed permissions, entitlement, consent, profiles, instructions, holds and takeover return stale text to review", async () => {
  const conditions: Array<
    [string, (tx: Tx, client: Actor, author: Actor) => Promise<unknown>]
  > = [
    [
      "consent",
      (tx, c) =>
        tx.query(
          "INSERT INTO consent_records(id,tenant_id,user_id,document_type,document_version,granted,created_at) VALUES($1,$2,$3,'coaching','withdrawn',false,now()+interval '1 second')",
          [randomUUID(), c.tenantId, c.userId],
        ),
    ],
    [
      "entitlement",
      (tx, c) =>
        tx.query("UPDATE subscriptions SET status='unpaid' WHERE user_id=$1", [
          c.userId,
        ]),
    ],
    [
      "profile",
      (tx, c) =>
        tx.query(
          "UPDATE records SET version=version+1 WHERE kind='intake' AND owner_user_id=$1",
          [c.userId],
        ),
    ],
    [
      "program",
      (tx, c) =>
        putRecord(
          tx,
          owner,
          "program",
          { title: "Changed plan" },
          { ownerId: c.userId, status: "assigned" },
        ),
    ],
    [
      "hold",
      (tx, c) =>
        putRecord(
          tx,
          owner,
          "training_hold",
          {},
          { ownerId: c.userId, status: "active" },
        ),
    ],
    [
      "takeover",
      (tx, c) =>
        putRecord(
          tx,
          owner,
          "takeover",
          {},
          { ownerId: c.userId, status: "active" },
        ),
    ],
    [
      "author",
      (tx, _c, a) =>
        tx.query("DELETE FROM memberships WHERE tenant_id=$1 AND user_id=$2", [
          a.tenantId,
          a.userId,
        ]),
    ],
    [
      "client",
      (tx, c) =>
        tx.query("DELETE FROM memberships WHERE tenant_id=$1 AND user_id=$2", [
          c.tenantId,
          c.userId,
        ]),
    ],
  ];
  for (const [name, mutate] of conditions) {
    const client = await member(owner.tenantId),
      author = await member(owner.tenantId, "staff"),
      r = await schedule(client, author);
    await db.system((tx) => mutate(tx, client, author));
    assert.equal(
      await deliverCoachingFollowup(db, owner.tenantId, r.id, at(r)),
      "review_required",
      name,
    );
    assert.equal((await stored(r.id)).status, "review_required", name);
    assert.equal((await output(r.id)).messages.length, 0, name);
    assert.equal(
      (await output(r.id)).notices.some((n) => n.user_id === client.userId),
      false,
      name,
    );
    assert.equal(
      await deliverCoachingFollowup(db, owner.tenantId, r.id, at(r)),
      "skipped",
      name,
    );
  }
  const client = await member(owner.tenantId),
    r = await schedule(client);
  await db.tenant(owner, (tx) =>
    putRecord(
      tx,
      owner,
      "workout",
      { title: "Ordinary completed workout" },
      { ownerId: client.userId, status: "completed" },
    ),
  );
  assert.equal(
    await deliverCoachingFollowup(db, owner.tenantId, r.id, at(r)),
    "delivered",
    "Routine logs do not invalidate the reviewed instructions",
  );
  const stale = await schedule(client);
  assert.equal(
    await deliverCoachingFollowup(
      db,
      owner.tenantId,
      stale.id,
      new Date(Date.parse(stale.data.dueAt) + 2 * 86400_000),
    ),
    "review_required",
  );
  const reviewed = await req(owner, "/" + stale.id, "PATCH", {
    text: stale.data.text,
    version: 2,
    dueAt: due(),
    timezone: "Asia/Dubai",
    reviewed: true,
  });
  assert.equal(reviewed.statusCode, 200, reviewed.body);
  assert.equal(
    await deliverCoachingFollowup(
      db,
      owner.tenantId,
      stale.id,
      at(reviewed.json()),
    ),
    "delivered",
  );
});

test("privacy export includes authorship; author and target erasure remove drafts, delivered text and pending notifications", async () => {
  const client = await member(owner.tenantId),
    author = await member(owner.tenantId, "staff"),
    draft = await schedule(client, author),
    sent = await schedule(client, author);
  await deliverCoachingFollowup(db, owner.tenantId, sent.id, at(sent));
  const exported = await db.tenant(owner, (tx) =>
    exportCoachingFollowups(tx, author.userId),
  );
  assert.deepEqual(
    new Set(exported.map((r) => r.id)),
    new Set([draft.id, sent.id]),
  );
  const hookExport = await db.tenant({ ...author, role: "owner" }, (tx) =>
    privacyHooks.exportAdditional!(tx, author.userId),
  );
  assert.deepEqual(
    (hookExport.coachingFollowups as any[]).map((r) => r.id),
    exported.map((r) => r.id),
  );
  await db.tenant({ ...author, role: "owner" }, async (tx) => {
    await workspaceLock(tx, owner.tenantId);
    await privacyHooks.eraseAdditional!(tx, author.userId);
  });
  assert.equal(await stored(draft.id), undefined);
  assert.equal(await stored(sent.id), undefined);
  assert.deepEqual(await output(sent.id), {
    messages: [],
    notices: [],
    jobs: [],
  });
  assert.equal(
    await deliverCoachingFollowup(db, owner.tenantId, draft.id, at(draft)),
    "skipped",
  );
  const personal = await schedule(client),
    other = await schedule(await member(owner.tenantId));
  await db.tenant(owner, async (tx) => {
    await workspaceLock(tx, owner.tenantId);
    await eraseCoachingFollowups(tx, client.userId);
  });
  assert.equal(await stored(personal.id), undefined);
  assert.ok(await stored(other.id));
  assert.equal(
    await deliverCoachingFollowup(
      db,
      owner.tenantId,
      personal.id,
      at(personal),
    ),
    "skipped",
  );
});

test("worker checks persisted due times and workspace closure; closure cleanup prevents recreation after enumeration", async () => {
  const isolated = await workspace(),
    client = await member(isolated.tenantId),
    r = await schedule(client, isolated);
  const before = await processCoachingFollowups(
    db,
    isolated.tenantId,
    new Date(),
  );
  assert.equal(before.delivered, 0);
  await db.system((tx) =>
    tx.query("UPDATE tenants SET lifecycle_state='closed' WHERE id=$1", [
      isolated.tenantId,
    ]),
  );
  const counts = await processCoachingFollowups(db, isolated.tenantId, at(r));
  assert.equal(counts.review_required, 1);
  assert.deepEqual(await output(r.id), { messages: [], notices: [], jobs: [] });
  await db.tenant(isolated, async (tx) => {
    await workspaceLock(tx, isolated.tenantId);
    await eraseCoachingFollowups(tx);
  });
  assert.equal(
    await deliverCoachingFollowup(db, isolated.tenantId, r.id, at(r)),
    "skipped",
  );
  assert.deepEqual(
    await processCoachingFollowups(db, isolated.tenantId, at(r)),
    { delivered: 0, review_required: 0, skipped: 0 },
  );
});
