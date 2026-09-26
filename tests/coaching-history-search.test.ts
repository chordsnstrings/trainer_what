import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createDatabase,
  putRecord,
  type Actor,
  type Database,
} from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";
import { tokenHash } from "../apps/api/src/auth.ts";
import { erasePersonalData } from "../apps/api/src/privacy-lifecycle.ts";
import {
  eraseCoachingFeedbackDerivedData,
  revokeCoachingFeedbackLearning,
} from "../apps/api/src/coaching-feedback.ts";

let db: Database, app: Awaited<ReturnType<typeof buildApp>>;
const sessions = new Map<string, string>();
const originalFetch = globalThis.fetch;
let networkCalls = 0;
async function member(tenantId: string, role = "subscriber"): Promise<Actor> {
  const a = { tenantId, userId: randomUUID(), role },
    token = randomUUID();
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
  });
  sessions.set(a.userId, token);
  return a;
}
async function fixture() {
  const tenantId = randomUUID();
  await db.system((tx) =>
    tx.query(
      "INSERT INTO tenants(id,slug,name) VALUES($1,$2,'Synthetic history')",
      [tenantId, tenantId],
    ),
  );
  return {
    coach: await member(tenantId, "owner"),
    client: await member(tenantId),
  };
}
async function correction(
  f: Awaited<ReturnType<typeof fixture>>,
  data: Record<string, unknown> = {},
  at?: string,
) {
  return db.tenant(f.coach, async (tx) => {
    const id = randomUUID(),
      draftId = randomUUID();
    const row = await putRecord(
      tx,
      f.coach,
      "coaching_correction",
      {
        request: "Arrange a hypertrophy session",
        preferred: {
          type: "message",
          message: "Use an adaptable training day",
        },
        rejected: { type: "message", message: "Keep the inflexible timetable" },
        explanation: "The rotation supports consistency",
        category: "message",
        learningValue: "meaning",
        semanticDiff: [],
        teachingDraftId: draftId,
        allowedUses: ["render"],
        ...data,
      },
      { id, ownerId: f.client.userId, status: "delivered" },
    );
    await putRecord(
      tx,
      f.coach,
      "coaching_teaching_draft",
      {
        correctionId: id,
        category: "message",
        scenarioIds: [],
        allowedUses: ["render"],
      },
      { id: draftId, ownerId: f.client.userId },
    );
    if (at)
      await tx.query("UPDATE records SET created_at=$2 WHERE id=$1", [id, at]);
    return row;
  });
}
function req(
  a: Actor | null,
  suffix = "",
  method: "GET" | "POST" = "GET",
  payload?: Record<string, unknown>,
  target = app,
) {
  return target.inject({
    method,
    url: "/api/v1/coaching/feedback" + suffix,
    payload,
    headers: {
      origin: "http://localhost:3000",
      ...(a ? { cookie: "session=" + sessions.get(a.userId) } : {}),
    },
  });
}
async function search(a: Actor, query: Record<string, string> = {}) {
  const result = await req(a, "?" + new URLSearchParams(query));
  assert.equal(result.statusCode, 200, result.body);
  return result.json();
}
async function outcome(
  f: Awaited<ReturnType<typeof fixture>>,
  c: any,
  note: string,
) {
  const evidence = await db.tenant(f.coach, (tx) =>
    putRecord(
      tx,
      f.coach,
      "workout",
      {
        title: "Synthetic later workout",
      },
      { ownerId: f.client.userId, status: "completed" },
    ),
  );
  const linked = await req(f.coach, `/${c.id}/outcomes`, "POST", {
    recordIds: [evidence.id],
    note,
  });
  assert.equal(linked.statusCode, 200, linked.body);
  return linked.json();
}
before(async () => {
  globalThis.fetch = async () => {
    networkCalls++;
    throw new Error("History fixtures must not call providers");
  };
  db = await createDatabase({ memory: true });
  app = await buildApp({ db, testing: true });
  await app.ready();
  assert.equal(
    app.hasRoute({ method: "GET", url: "/api/v1/coaching/feedback" }),
    true,
  );
});
after(async () => {
  globalThis.fetch = originalFetch;
  await app?.close();
  await db?.close();
  assert.equal(networkCalls, 0);
});

test("registered history searches correction fields and route-linked outcome notes, then opens the existing detail", async () => {
  const f = await fixture(),
    c = await correction(f);
  for (const q of [
    "HYPERTROPHY",
    "adaptable",
    "inflexible",
    "rotation",
    "hypertrophy adaptable",
  ])
    assert.deepEqual(
      (await search(f.coach, { q })).items.map((row: any) => row.id),
      [c.id],
      q,
    );
  assert.equal(
    (await search(f.coach, { q: "hyper" })).items.length,
    0,
    "Whole-word search must not be substring search",
  );
  await outcome(f, c, "Weeklong adherence improved after the change.");
  await outcome(
    f,
    c,
    "Weeklong adherence stayed consistent at the next review.",
  );
  const found = await search(f.coach, { q: "weeklong adherence" });
  assert.equal(
    found.items.length,
    1,
    "Multiple matching outcomes must not duplicate a correction",
  );
  assert.equal(found.items[0].id, c.id);
  assert.equal(found.items[0].outcomeCount, 2);
  assert.match(found.items[0].matchedOutcome, /Weeklong adherence/);
  assert.equal(found.items[0].clientName, "Synthetic subscriber");
  const detail = await req(f.coach, `/${c.id}`);
  assert.equal(detail.statusCode, 200, detail.body);
  assert.equal(detail.json().draft.id, c.data.teachingDraftId);
  assert.equal(detail.json().outcomes.length, 2);
  assert.equal(detail.json().regression.state, "teaching_required");
});

test("learning value, category and client filters compose with full-text search", async () => {
  const f = await fixture(),
    second = await member(f.coach.tenantId);
  const meaningful = await correction(f, {
    learningValue: "decision",
    category: "schedule",
  });
  await correction(f, { learningValue: "cosmetic", category: "message" });
  const meaning = await correction({ ...f, client: second });
  assert.deepEqual(
    new Set(
      (await search(f.coach, { learningValue: "meaningful" })).items.map(
        (row: any) => row.id,
      ),
    ),
    new Set([meaningful.id, meaning.id]),
  );
  assert.equal(
    (await search(f.coach, { learningValue: "cosmetic" })).items.length,
    1,
  );
  assert.deepEqual(
    (
      await search(f.coach, {
        q: "rotation",
        learningValue: "meaningful",
        category: "schedule",
        subscriberId: f.client.userId,
      })
    ).items.map((row: any) => row.id),
    [meaningful.id],
  );
  assert.deepEqual(
    (
      await search(f.coach, {
        learningValue: "meaning",
        subscriberId: second.userId,
      })
    ).items.map((row: any) => row.id),
    [meaning.id],
  );
  assert.equal(
    (await search(f.coach, { category: "progression" })).items.length,
    0,
  );
});

test("bounded keyset pages preserve microseconds, ties and continuation after anchor deletion or newer inserts", async () => {
  const f = await fixture(),
    seeded = [];
  for (const fraction of [
    "000101",
    "000101",
    "000100",
    "000099",
    "000098",
    "000097",
  ])
    seeded.push(await correction(f, {}, `2026-01-01T10:00:00.${fraction}Z`));
  const expected = await db.tenant(f.coach, (tx) =>
    tx.query(
      "SELECT id FROM records WHERE kind='coaching_correction' ORDER BY created_at DESC,id DESC",
    ),
  );
  const first = await search(f.coach, { q: "rotation", limit: "2" });
  assert.equal(first.items.length, 2);
  assert.ok(first.next);
  assert.deepEqual(
    first.items.map((row: any) => row.id),
    expected.slice(0, 2).map((row) => row.id),
  );
  await db.tenant(f.coach, (tx) =>
    tx.query("DELETE FROM records WHERE id=$1", [first.items[1].id]),
  );
  const newer = await correction(f);
  const seen = first.items.map((row: any) => row.id);
  let cursor = first.next;
  while (cursor) {
    const page = await search(f.coach, {
      q: "rotation",
      limit: "2",
      before: cursor,
    });
    assert.ok(page.items.length <= 2);
    seen.push(...page.items.map((row: any) => row.id));
    cursor = page.next;
  }
  assert.deepEqual(
    seen,
    expected.map((row) => row.id),
  );
  assert.equal(new Set(seen).size, seen.length);
  assert.ok(!seen.includes(newer.id));
  assert.equal(
    (await req(f.coach, "?q=adaptable&before=" + first.next)).statusCode,
    400,
    "A cursor is tied to its search",
  );
  assert.equal(
    (await search(f.coach, { before: newer.id })).items.length,
    seeded.length - 1,
    "Existing UUID clients remain supported",
  );
  for (const query of [
    "limit=0",
    "limit=51",
    "limit=1.5",
    "before=bad",
    "category=private",
    "learningValue=anything",
    "subscriberId=bad",
    "q=" + "x".repeat(201),
  ])
    assert.equal((await req(f.coach, "?" + query)).statusCode, 400, query);
});

test("history and details enforce tenant, trainer membership and active workspace boundaries", async () => {
  const f = await fixture(),
    other = await fixture(),
    c = await correction(f);
  await correction(other, { request: "Distinct tenant quarantine" });
  const staff = await member(f.coach.tenantId, "staff"),
    finance = await member(f.coach.tenantId, "finance");
  for (const [a, status] of [
    [null, 401],
    [f.client, 403],
    [finance, 403],
  ] as const)
    assert.equal((await req(a, "?q=rotation")).statusCode, status);
  assert.equal((await search(staff, { q: "rotation" })).items.length, 1);
  assert.equal((await req(staff, `/${c.id}`)).json().regression, null);
  assert.equal(
    (
      await search(other.coach, {
        q: "rotation",
        subscriberId: f.client.userId,
      })
    ).items.length,
    0,
  );
  assert.equal((await search(f.coach, { q: "quarantine" })).items.length, 0);
  assert.equal((await req(other.coach, `/${c.id}`)).statusCode, 404);
  assert.equal((await req(other.coach, "?before=" + c.id)).statusCode, 400);
  await db.system((tx) =>
    tx.query("DELETE FROM memberships WHERE tenant_id=$1 AND user_id=$2", [
      staff.tenantId,
      staff.userId,
    ]),
  );
  assert.equal((await req(staff, "?q=rotation")).statusCode, 401);
  assert.equal((await req(staff, `/${c.id}`)).statusCode, 401);
  await db.system((tx) =>
    tx.query("UPDATE tenants SET lifecycle_state='closed' WHERE id=$1", [
      f.coach.tenantId,
    ]),
  );
  assert.equal((await req(f.coach, "?q=rotation")).statusCode, 401);
});

test("history rechecks current trainer membership inside the transaction after session lookup", async () => {
  for (const route of ["?q=rotation", "detail"]) {
    const f = await fixture(),
      c = await correction(f),
      staff = await member(f.coach.tenantId, "staff");
    let changed = false;
    const guarded: Database = {
      ...db,
      tenant: async (a, fn) => {
        if (!changed && a.userId === staff.userId) {
          changed = true;
          await db.system((tx) =>
            tx.query(
              "DELETE FROM memberships WHERE tenant_id=$1 AND user_id=$2",
              [staff.tenantId, staff.userId],
            ),
          );
        }
        return db.tenant(a, fn);
      },
    };
    const target = await buildApp({ db: guarded, testing: true });
    try {
      await target.ready();
      const response = await req(
        staff,
        route === "detail" ? `/${c.id}` : route,
        "GET",
        undefined,
        target,
      );
      assert.equal(response.statusCode, 403, response.body);
      assert.match(response.body, /WORKSPACE_CHANGED/);
    } finally {
      await target.close();
    }
  }
});

test("search excludes held-out scenarios, unrelated notes and client snapshots and never restores revoked learning", async () => {
  const f = await fixture(),
    c = await correction(f, { contextSnapshot: { secret: "snapshotneedle" } });
  const another = await member(f.coach.tenantId);
  const teaching = await db.tenant(f.coach, async (tx) => {
    await putRecord(
      tx,
      f.coach,
      "coaching_scenario",
      {
        prompt: "heldoutneedle independent assessment",
        normalizedPrompt: "heldoutneedle",
      },
      { status: "held_out" },
    );
    await putRecord(
      tx,
      f.coach,
      "coaching_feedback_outcome",
      { correctionId: c.id, note: "wrongownerneedle" },
      { ownerId: another.userId, status: "recorded" },
    );
    return putRecord(
      tx,
      f.coach,
      "coaching_teaching",
      { scenario: "A confirmed case", allowedUses: ["model_prompt", "render"] },
      { ownerId: f.client.userId, status: "confirmed" },
    );
  });
  await db.tenant(f.coach, async (tx) => {
    await revokeCoachingFeedbackLearning(tx, f.client.userId);
    await tx.query(
      "INSERT INTO consent_records(id,tenant_id,user_id,document_type,document_version,granted) VALUES($1,$2,$3,'coaching','withdrawn',false)",
      [randomUUID(), f.coach.tenantId, f.client.userId],
    );
  });
  for (const q of ["snapshotneedle", "heldoutneedle", "wrongownerneedle"])
    assert.equal((await search(f.coach, { q })).items.length, 0, q);
  const result = await search(f.coach, { q: "rotation" });
  assert.equal(
    result.items[0].id,
    c.id,
    "Existing private history stays available for authorized trainer review",
  );
  assert.deepEqual(result.items[0].data.allowedUses, ["render"]);
  assert.equal(result.items[0].outcomeCount, 0);
  assert.doesNotMatch(JSON.stringify(result), /heldoutneedle|wrongownerneedle/);
  const [afterSearch] = await db.tenant(f.coach, (tx) =>
    tx.query("SELECT * FROM records WHERE id=$1", [teaching.id]),
  );
  assert.equal(afterSearch.status, "permission_revoked");
  assert.deepEqual(afterSearch.data.allowedUses, []);
});

test("outcome deletion and existing personal erasure remove searchable entries without a derived-data cleanup job", async () => {
  const f = await fixture(),
    c = await correction(f);
  const linked = await outcome(f, c, "Temporary outcomeneedle improved");
  assert.equal(
    (await search(f.coach, { q: "outcomeneedle" })).items[0].id,
    c.id,
  );
  await db.tenant(f.coach, (tx) =>
    tx.query("DELETE FROM records WHERE id=$1", [linked.id]),
  );
  assert.equal((await search(f.coach, { q: "outcomeneedle" })).items.length, 0);
  await outcome(f, c, "Retained erasureoutcome until personal deletion");
  await db.tenant(f.coach, (tx) =>
    erasePersonalData(
      tx,
      f.coach,
      f.client.userId,
      f.client.userId + "@example.test",
      { eraseAdditional: eraseCoachingFeedbackDerivedData },
    ),
  );
  for (const q of ["rotation", "erasureoutcome"])
    assert.equal((await search(f.coach, { q })).items.length, 0);
  assert.equal((await req(f.coach, `/${c.id}`)).statusCode, 404);
});
