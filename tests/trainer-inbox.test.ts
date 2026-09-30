import { before, after, test } from "node:test";
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

// The trainer's one inbox (docs/features/trainer-workspace.md): a read-only
// merge of the existing queues, and the "note only when rejecting" rule on
// resolving a review item. Seeding and reads use the workspace's own scope
// (never a system read of workspace tables), so the file also runs under the
// restricted database role.
let db: Database, app: Awaited<ReturnType<typeof buildApp>>;
const sessions = new Map<string, string>();
const originalFetch = globalThis.fetch;

async function person(
  tenantId: string,
  role: string,
  name: string,
): Promise<Actor> {
  const a = { tenantId, userId: randomUUID(), role };
  const token = randomUUID();
  await db.system(async (tx) => {
    await tx.query(
      "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,'fixture')",
      [a.userId, a.userId + "@example.test", name],
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
async function client(owner: Actor, name: string) {
  const c = await person(owner.tenantId, "subscriber", name);
  await db.tenant(owner, async (tx) => {
    await tx.query(
      "INSERT INTO subscriptions(id,tenant_id,user_id,status,period_end) VALUES($1,$2,$3,'active',now()+interval '60 days')",
      [randomUUID(), owner.tenantId, c.userId],
    );
    await tx.query(
      "INSERT INTO consent_records(id,tenant_id,user_id,document_type,document_version,granted) VALUES($1,$2,$3,'coaching','fixture',true)",
      [randomUUID(), owner.tenantId, c.userId],
    );
  });
  return c;
}
async function workspace() {
  const tenantId = randomUUID();
  await db.system((tx) =>
    tx.query(
      "INSERT INTO tenants(id,slug,name) VALUES($1,$2,'Synthetic inbox')",
      [tenantId, tenantId],
    ),
  );
  return person(tenantId, "owner", "Synthetic coach");
}
function call(a: Actor, url: string, method: any = "GET", payload?: unknown) {
  return app.inject({
    url: "/api/v1" + url,
    method,
    payload: payload as any,
    headers: {
      origin: "http://localhost:3000",
      cookie: "session=" + sessions.get(a.userId),
    },
  });
}
const message = (owner: Actor, to: Actor, author: string, text: string) =>
  db.tenant(owner, (tx) =>
    putRecord(
      tx,
      owner,
      "message",
      { text, author, subscriberId: to.userId },
      { ownerId: to.userId, status: "sent" },
    ),
  );

before(async () => {
  globalThis.fetch = async () => {
    throw new Error("The inbox never calls a provider");
  };
  db = await createDatabase({ memory: true });
  app = await buildApp({ db, testing: true });
  await app.ready();
});
after(async () => {
  globalThis.fetch = originalFetch;
  await app?.close();
  await db?.close();
});

/** One workspace with an item of every kind. */
async function seeded() {
  const owner = await workspace();
  const [held, drafted, asking, supportee, chatty, planned, followed, booked] =
    await Promise.all(
      [
        "Hana Held",
        "Dana Draft",
        "Qais Question",
        "Sara Support",
        "Omar Chat",
        "Pia Plan",
        "Farah Followup",
        "Bilal Booking",
      ].map((n) => client(owner, n)),
    );
  const ids = await db.tenant(owner, async (tx) => {
    const put = (kind: string, data: any, ownerId: string, status: string) =>
      putRecord(tx, owner, kind, data, { ownerId, status });
    const hold = await put(
      "training_hold",
      { reason: "Sharp knee pain on squats", openedAt: new Date().toISOString() },
      held.userId,
      "active",
    );
    const safety = await put(
      "exception",
      {
        category: "safety",
        description: "Sharp knee pain on squats",
        subscriberId: held.userId,
        holdId: hold.id,
      },
      held.userId,
      "open",
    );
    const brain = await putRecord(
      tx,
      owner,
      "brain_release",
      { rules: [], mode: "supervised" },
      { status: "published" },
    );
    const decision = await put(
      "decision",
      {
        type: "message",
        request: "Can I train twice tomorrow?",
        message: "Keep to one session tomorrow and rest well.",
        reason: "Synthetic draft",
        confidence: 0.6,
        brainVersionId: brain.id,
        requiresHumanReview: true,
      },
      drafted.userId,
      "pending_review",
    );
    const draft = await put(
      "exception",
      {
        category: "decision_review",
        decisionId: decision.id,
        subscriberId: drafted.userId,
        description: "Can I train twice tomorrow?",
      },
      drafted.userId,
      "open",
    );
    const question = await put(
      "exception",
      {
        category: "human_review",
        subscriberId: asking.userId,
        description: "Could we talk about my goals?",
      },
      asking.userId,
      "open",
    );
    const support = await put(
      "support",
      {
        subject: "Billing date",
        category: "billing",
        messages: [
          {
            text: "When am I charged?",
            authorId: supportee.userId,
            at: new Date().toISOString(),
          },
        ],
      },
      supportee.userId,
      "open",
    );
    const plan = await put(
      "plan_generation",
      { type: "initial", plan: { title: "Four-week start" } },
      planned.userId,
      "pending_review",
    );
    const followup = await put(
      "coaching_followup",
      { text: "How did the session feel?" },
      followed.userId,
      "review_required",
    );
    const slot = randomUUID(),
      booking = randomUUID();
    await tx.query(
      "INSERT INTO booking_slots(id,tenant_id,trainer_id,starts_at,ends_at,capacity,title,location) VALUES($1,$2,$3,now()-interval '3 hours',now()-interval '2 hours',1,'Strength check','Gym')",
      [slot, owner.tenantId, owner.userId],
    );
    await tx.query(
      "INSERT INTO bookings(id,tenant_id,slot_id,user_id) VALUES($1,$2,$3,$4)",
      [booking, owner.tenantId, slot, booked.userId],
    );
    return { hold, safety, decision, draft, question, support, plan, followup, booking };
  });
  // Chats: the questioner and the held client wrote last too, but their
  // items above already cover them; Omar waits; Sara's chat was answered.
  await message(owner, asking, "subscriber", "Are you there?");
  await message(owner, held, "subscriber", "My knee hurts");
  await message(owner, supportee, "subscriber", "Thanks");
  await message(owner, supportee, "trainer", "You are welcome");
  await message(owner, chatty, "subscriber", "New week, new goals!");
  return {
    owner,
    clients: { held, drafted, asking, supportee, chatty, planned, followed, booked },
    ...ids,
  };
}

test("the inbox merges every queue, most urgent first, without duplicates", async () => {
  const s = await seeded();
  const r = await call(s.owner, "/trainer/inbox");
  assert.equal(r.statusCode, 200, r.body);
  const { items, counts } = r.json();
  assert.deepEqual(
    items.map((i: any) => i.type),
    [
      "safety",
      "reply_draft",
      // Same urgency: oldest first.
      "question",
      "support",
      "chat",
      // A session that ended without attendance ranks with plans and
      // follow-ups, and it is the oldest of them (items written in one
      // transaction tie on time and then sort by id).
      "booking",
      "followup",
      "plan_draft",
    ],
  );
  assert.equal(counts.total, 8);
  const byType = Object.fromEntries(items.map((i: any) => [i.type, i]));
  // The hold stands for its safety report; the report is not listed twice.
  assert.equal(byType.safety.recordId, s.hold.id);
  assert.equal(byType.safety.clientName, "Hana Held");
  assert.deepEqual(byType.safety.actions, ["review", "open_chat"]);
  assert.equal(byType.reply_draft.draft, "Keep to one session tomorrow and rest well.");
  assert.deepEqual(byType.reply_draft.actions, [
    "approve",
    "edit_send",
    "reject",
    "open_chat",
  ]);
  assert.equal(byType.question.preview, "Could we talk about my goals?");
  assert.equal(byType.support.preview, "When am I charged?");
  // Only Omar's chat is a separate item.
  assert.equal(byType.chat.clientName, "Omar Chat");
  assert.equal(byType.chat.href, `/trainer/messages/${s.clients.chatty.userId}`);
  assert.deepEqual(byType.plan_draft.actions, ["approve", "review"]);
  assert.equal(byType.plan_draft.version, s.plan.version);
  assert.deepEqual(byType.booking.actions, ["attended", "no_show"]);
  // No item names the model or its vendor.
  assert.doesNotMatch(r.body, /seed|byteplus|anthropic|claude|openai|gpt/i);
});

test("chats list the latest message per client with a waiting flag", async () => {
  const s = await seeded();
  const r = await call(s.owner, "/trainer/chats");
  assert.equal(r.statusCode, 200, r.body);
  const chats = r.json().chats;
  assert.equal(chats.length, 4);
  assert.equal(chats[0].clientName, "Omar Chat");
  const sara = chats.find((c: any) => c.clientName === "Sara Support");
  assert.equal(sara.lastText, "You are welcome");
  assert.equal(sara.lastAuthor, "trainer");
  assert.equal(sara.awaitingReply, false);
  assert.equal(
    chats.filter((c: any) => c.awaitingReply).length,
    3,
    "Omar, Qais and Hana wrote last",
  );
});

test("only the coaching team reads the inbox, and only its own workspace", async () => {
  const s = await seeded();
  const finance = await person(s.owner.tenantId, "finance", "Finance helper");
  const staff = await person(s.owner.tenantId, "staff", "Staff coach");
  assert.equal((await call(finance, "/trainer/inbox")).statusCode, 403);
  assert.equal((await call(s.clients.chatty, "/trainer/inbox")).statusCode, 403);
  assert.equal((await call(s.clients.chatty, "/trainer/chats")).statusCode, 403);
  const team = (await call(staff, "/trainer/inbox")).json();
  // A staff coach sees the coaching queues but not another coach's sessions.
  assert.equal(team.items.some((i: any) => i.type === "booking"), false);
  assert.equal(team.items.some((i: any) => i.type === "reply_draft"), true);
  const other = await workspace();
  const empty = await call(other, "/trainer/inbox");
  assert.equal(empty.statusCode, 200);
  assert.deepEqual(empty.json().items, []);
  assert.deepEqual((await call(other, "/trainer/chats")).json().chats, []);
});

test("a note is needed only when closing an item without sending anything", async () => {
  const s = await seeded();
  const resolve = (id: string, body: unknown) =>
    call(s.owner, `/exceptions/${id}/resolve`, "POST", body);
  // Closing without a reply needs a short note.
  assert.equal((await resolve(s.question.id, {})).statusCode, 400);
  assert.equal((await resolve(s.question.id, { note: "ok" })).statusCode, 400);
  // Approving and sending your own words at once is refused.
  assert.equal(
    (
      await resolve(s.draft.id, {
        approveDecision: true,
        replyText: "Something else",
      })
    ).statusCode,
    400,
  );
  // A reply to a paused client goes through the hold review.
  const held = await resolve(s.safety.id, { replyText: "Please rest." });
  assert.equal(held.statusCode, 409, held.body);
  assert.equal(held.json().code, "EXPLICIT_HOLD_REVIEW");

  // Approve without a note: the Brain's draft is delivered as reviewed.
  const approved = await resolve(s.draft.id, { approveDecision: true });
  assert.equal(approved.statusCode, 200, approved.body);
  // Reply personally to a question: a trainer message, then closed.
  const replied = await resolve(s.question.id, {
    replyText: "Yes, let us talk on Thursday.",
  });
  assert.equal(replied.statusCode, 200, replied.body);
  const rows = await db.tenant(s.owner, async (tx) => ({
    draft: (
      await tx.query("SELECT status,data FROM records WHERE id=$1", [s.draft.id])
    )[0],
    question: (
      await tx.query("SELECT status,data FROM records WHERE id=$1", [
        s.question.id,
      ])
    )[0],
    delivered: await tx.query(
      "SELECT data FROM records WHERE kind='message' AND data->>'decisionId'=$1",
      [s.decision.id],
    ),
    reply: await tx.query(
      "SELECT data,owner_user_id FROM records WHERE kind='message' AND data->>'exceptionId'=$1",
      [s.question.id],
    ),
    notices: await tx.query(
      "SELECT id FROM notifications WHERE user_id=$1",
      [s.clients.asking.userId],
    ),
  }));
  assert.equal(rows.draft.status, "resolved");
  assert.equal(rows.draft.data.outcome, "approved");
  assert.equal(rows.draft.data.resolution, "Approved the drafted reply");
  assert.equal(rows.delivered.length, 1);
  assert.equal(rows.question.status, "resolved");
  assert.equal(rows.question.data.outcome, "replied");
  assert.equal(rows.reply.length, 1);
  assert.equal(rows.reply[0].data.author, "trainer");
  assert.equal(rows.reply[0].data.text, "Yes, let us talk on Thursday.");
  assert.equal(rows.reply[0].owner_user_id, s.clients.asking.userId);
  assert.ok(rows.notices.length >= 1, "the client is told about the reply");

  // Both items leave the inbox; closing a fresh question with a note works.
  const after = (await call(s.owner, "/trainer/inbox")).json().items;
  assert.equal(after.some((i: any) => i.type === "reply_draft"), false);
  assert.equal(after.some((i: any) => i.type === "question"), false);
  const again = await db.tenant(s.owner, (tx) =>
    putRecord(
      tx,
      s.owner,
      "exception",
      {
        category: "human_review",
        subscriberId: s.clients.asking.userId,
        description: "Another question",
      },
      { ownerId: s.clients.asking.userId, status: "open" },
    ),
  );
  const closed = await resolve(again.id, { note: "Answered on the phone" });
  assert.equal(closed.statusCode, 200, closed.body);
  const [row] = await db.tenant(s.owner, (tx) =>
    tx.query("SELECT data FROM records WHERE id=$1", [again.id]),
  );
  assert.equal(row.data.outcome, "closed");
  assert.equal(row.data.resolution, "Answered on the phone");
});
