// The member screens' server side (docs/features/member-screens.md): the
// Today plan state comes from the assigned programme and its planned
// sessions (no "preparing your plan" beside an active plan), the session
// carries what the Today action needs, the intake flag, and the checkout
// status card only while a membership checkout is unfinished.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createDatabase, putRecord, type Database } from "@trainer/db";
import { processStripeEvent } from "../apps/api/src/stripe-events.ts";
import { dateIn } from "../packages/domain/src/programme.ts";
import { seedScope } from "./scope-fixtures.ts";
import {
  evt,
  follower,
  offer,
  request,
  tick,
  workspace,
  type Member,
} from "./programme-fixtures.ts";

let db: Database, owner: Member, app: any;
before(async () => {
  db = await createDatabase({ memory: true });
  owner = await workspace(db);
  const { buildApp } = await import("../apps/api/src/app.ts");
  app = await buildApp({ db, testing: true });
});
after(async () => {
  await app.close();
  await db.close();
});

/** A member whose monthly membership started today (block 1 of 28 days). */
async function subscribedMember() {
  const product = await offer(db, owner, { programmeDays: 28 });
  const member = await follower(db, owner);
  const start = Math.floor(Date.now() / 1000);
  await processStripeEvent(
    db,
    evt(
      "customer.subscription.created",
      {
        id: "sub_screens_" + member.userId.slice(0, 8),
        object: "subscription",
        status: "active",
        start_date: start,
        current_period_end: start + 30 * 86400,
        metadata: { tenant_id: member.tenantId, user_id: member.userId },
        items: { data: [{ price: { id: product.data.stripePriceId } }] },
      },
      tick(),
    ),
  );
  return member;
}
const put = (member: Member, kind: string, data: any, status: string) =>
  db.tenant(seedScope(owner), (tx) =>
    putRecord(tx, seedScope(owner), kind, data, {
      ownerId: member.userId,
      status,
    }),
  );
const today = async (member: Member) =>
  (
    await request(app, "GET", "/programme/today?timezone=UTC", member.token)
  ).json();

test("Today: no plan waits for the coach; an assigned programme without a calendar is self-paced with its sessions", async () => {
  const member = await subscribedMember();
  let t = await today(member);
  assert.equal(t.planState, "awaiting_coach");
  assert.equal(t.plan, null);
  assert.equal(t.intakeDone, false);

  const program = await put(
    member,
    "program",
    {
      title: "Strength foundations",
      weeks: 4,
      daysPerWeek: 3,
      sessions: [
        {
          label: "Upper body",
          exercises: [{ name: "Row" }, { name: "Press" }],
        },
        { label: "Lower body", exercises: [{ name: "Squat" }] },
      ],
    },
    "assigned",
  );
  t = await today(member);
  // An active plan shows its sessions, never "your coach is preparing it".
  assert.equal(t.planState, "self_paced");
  assert.equal(t.plan.programId, program.id);
  assert.equal(t.plan.title, "Strength foundations");
  assert.equal(t.plan.daysPerWeek, 3);
  assert.deepEqual(
    t.plan.sessions.map((s: any) => [s.label, s.exercises]),
    [
      ["Upper body", 2],
      ["Lower body", 1],
    ],
  );
  assert.equal(t.plan.completedThisWeek, 0);
  const timeline = (
    await request(app, "GET", "/programme/timeline?timezone=UTC", member.token)
  ).json();
  assert.equal(timeline.planState, "self_paced");
  assert.equal(timeline.plan.programId, program.id);
  // Days without a calendar are not rest days.
  assert.ok(timeline.days.every((d: any) => d.kind !== "rest"));

  await put(
    member,
    "intake",
    { age: 30, goal: "Get stronger", experience: "beginner", daysPerWeek: 3 },
    "submitted",
  );
  assert.equal((await today(member)).intakeDone, true);
});

test("Today: a calendar makes the plan ready and today's session carries its programme and started workout", async () => {
  const member = await subscribedMember();
  const program = await put(
    member,
    "program",
    { title: "Strength foundations", exercises: [{ name: "Squat" }] },
    "assigned",
  );
  const date = dateIn("UTC", new Date());
  const workoutId = "7c4c1f64-0d3e-4c55-9c3f-2f1e0e0a0b0c";
  await put(
    member,
    "planned_session",
    {
      date,
      timezone: "UTC",
      week: 1,
      label: "Strength A",
      programId: program.id,
      workoutId,
      program: { title: "Strength A", exercises: [{ name: "Squat" }] },
    },
    "started",
  );
  const t = await today(member);
  assert.equal(t.planState, "ready");
  assert.equal(t.plan, null);
  assert.equal(t.session.label, "Strength A");
  assert.equal(t.session.programId, program.id);
  assert.equal(t.session.workoutId, workoutId);
  assert.equal(t.session.exercises, 1);
});

test("Today: sessions planned only after this block still count as a plan, not as waiting for the coach", async () => {
  const member = await subscribedMember();
  const later = new Date(Date.now() + 40 * 86400000);
  await put(
    member,
    "planned_session",
    {
      date: dateIn("UTC", later),
      timezone: "UTC",
      week: 1,
      label: "Strength A",
      program: { title: "Strength A", exercises: [] },
    },
    "planned",
  );
  const t = await today(member);
  assert.equal(t.planState, "ready");
  assert.equal(t.restDay, true);
});

test("checkout status: shown only while a membership checkout is unfinished, and never to the coaching team", async () => {
  const member = await follower(db, owner);
  const pending = async (token: string) =>
    (await request(app, "GET", "/payments/checkout/pending", token)).json()
      .pending;
  assert.equal(await pending(member.token), false);
  const checkout = await put(
    member,
    "checkout",
    { purpose: "membership" },
    "open",
  );
  assert.equal(await pending(member.token), true);
  // A voice add-on checkout is not a membership checkout.
  await db.tenant(seedScope(owner), (tx) =>
    tx.query("UPDATE records SET status='completed' WHERE id=$1", [
      checkout.id,
    ]),
  );
  await put(member, "checkout", { purpose: "voice_addon" }, "open");
  assert.equal(await pending(member.token), false);
  assert.equal(await pending(owner.token), false);
});
