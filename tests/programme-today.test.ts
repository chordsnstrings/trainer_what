import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, putRecord, type Database } from "@trainer/db";
import { processStripeEvent } from "../apps/api/src/stripe-events.ts";
import { sweepProgrammes } from "../apps/api/src/programme-today.ts";
import { programmeLengthDays } from "../apps/api/src/programme-length.ts";
import { dateIn, addDays } from "../packages/domain/src/programme.ts";
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
const DAY = 86400000;
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

/** An upfront membership row as a verified programme payment leaves it. */
async function upfrontMember(product: any, startedDaysAgo: number, days: number) {
  const member = await follower(db, owner);
  const startsAt = new Date(Date.now() - startedDaysAgo * DAY);
  const endsAt = new Date(startsAt.getTime() + days * DAY);
  await db.tenant(seedScope(owner, "finance"), (tx) =>
    tx.query(
      "INSERT INTO subscriptions(id,tenant_id,user_id,provider_id,status,period_end,price_minor,data) VALUES($1,$2,$3,NULL,'active',$4,$5,$6)",
      [
        randomUUID(),
        owner.tenantId,
        member.userId,
        endsAt,
        product.data.priceMinor,
        JSON.stringify({
          billing: "upfront",
          productId: product.id,
          tier: product.data.tier,
          modules: product.data.modules,
          programmeDays: days,
          programmeStartsAt: startsAt.toISOString(),
          upfront: { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() },
        }),
      ],
    ),
  );
  return member;
}
async function plan(member: Member, date: string, status = "planned", label = "Strength A") {
  return db.tenant(seedScope(owner), (tx) =>
    putRecord(
      tx,
      seedScope(owner),
      "planned_session",
      {
        date,
        timezone: "Asia/Dubai",
        week: 1,
        label,
        program: { title: label, exercises: [{ name: "Squat" }, { name: "Row" }] },
      },
      { ownerId: member.userId, status },
    ),
  );
}

test("Today shows Day N of M, today's session, what's next, streak, nutrition targets and diary progress", async () => {
  const product = await offer(db, owner, {
    billing: "upfront",
    programmeDays: 28,
    tier: "workout_nutrition",
    modules: ["training", "nutrition"],
  });
  const member = await upfrontMember(product, 9, 28);
  const zone = "Asia/Dubai";
  const today = dateIn(zone, new Date());
  await plan(member, addDays(today, -3), "completed", "Lower");
  await plan(member, addDays(today, -2), "completed", "Upper");
  await plan(member, today, "planned", "Full body");
  await plan(member, addDays(today, 2), "planned", "Conditioning");
  // Nutrition: permission, preferences, the coach's target and today's diary.
  const nutritionDate = dateIn(zone, new Date());
  await db.tenant(member, (tx) =>
    tx.query(
      "INSERT INTO consent_records(id,tenant_id,user_id,document_type,document_version,granted) VALUES($1,$2,$3,'nutrition','v1',true)",
      [randomUUID(), owner.tenantId, member.userId],
    ),
  );
  await db.tenant(seedScope(owner), async (tx) => {
    const scope = seedScope(owner);
    await putRecord(tx, scope, "nutrition_profile", { profile: { timezone: zone } }, { ownerId: member.userId, status: "saved" });
    await putRecord(
      tx,
      scope,
      "nutrition_target",
      { target: { kcal: 2200, protein: 150, carbohydrate: 220, fat: 70, hydrationMl: 2500, reviewOn: addDays(today, 10) } },
      { ownerId: member.userId, status: "active" },
    );
    await putRecord(
      tx,
      scope,
      "nutrition_log",
      { date: nutritionDate, kcal: 650, nutrients: { kcal: 650, protein: 45, carbohydrate: 60, fat: 20 } },
      { ownerId: member.userId, status: "confirmed" },
    );
  });
  const r = await request(app, "GET", `/programme/today?timezone=${encodeURIComponent(zone)}`, member.token);
  assert.equal(r.statusCode, 200, r.body);
  const body = r.json();
  assert.equal(body.timeZone, zone);
  assert.deepEqual(
    [body.programme.billing, body.programme.day, body.programme.of, body.programme.state],
    ["upfront", 10, 28, "active"],
  );
  assert.equal(body.session.label, "Full body");
  assert.equal(body.session.exercises, 2);
  assert.equal(body.restDay, false);
  assert.deepEqual([body.next.label, body.next.inDays], ["Conditioning", 2]);
  assert.deepEqual([body.progress.streak, body.progress.completed, body.progress.scheduled], [2, 2, 2]);
  assert.equal(body.nutrition.state, "ready");
  assert.equal(body.nutrition.target.kcal, 2200);
  assert.equal(body.nutrition.consumed.kcal, 650);
  assert.equal(body.nutrition.consumed.protein, 45);
  assert.equal(body.nutrition.meals, 1);
  assert.equal(body.endOfProgramme.state, "ends");
  assert.equal(body.endOfProgramme.canRenew, false);
  // The timeline lists every day of the programme.
  const t = await request(app, "GET", `/programme/timeline?timezone=${encodeURIComponent(zone)}`, member.token);
  assert.equal(t.statusCode, 200, t.body);
  const days = t.json().days;
  assert.equal(days.length, 28);
  assert.equal(days.filter((d: any) => d.status === "done").length, 2);
  assert.equal(days.find((d: any) => d.date === today).status, "today");
  assert.equal(await db.tenant(member, (tx) => programmeLengthDays(tx, member.userId)), 28);
  // An unknown time zone falls back instead of failing.
  const bad = await request(app, "GET", "/programme/today?timezone=Mars%2FOlympus", member.token);
  assert.equal(bad.statusCode, 200, bad.body);
  assert.equal(bad.json().timeZone, "Asia/Dubai");
});

test("end of an upfront programme: an ending notice, then access closes once with a notice, and the member can renew", async () => {
  const product = await offer(db, owner, { billing: "upfront", programmeDays: 28 });
  const member = await upfrontMember(product, 26, 28);
  let r = await request(app, "GET", "/programme/today", member.token);
  assert.equal(r.json().endOfProgramme.state, "ends");
  assert.equal(r.json().endOfProgramme.canRenew, true, "renewable in the final week");
  assert.equal(r.json().endOfProgramme.renewProductId, product.id);
  await sweepProgrammes(db, owner.tenantId);
  const notices = async () =>
    db.tenant(seedScope(owner), (tx) =>
      tx.query("SELECT dedupe_key,title FROM notifications WHERE user_id=$1 ORDER BY created_at", [member.userId]),
    );
  assert.deepEqual((await notices()).map((n) => n.title), ["Your programme ends soon"]);
  await sweepProgrammes(db, owner.tenantId);
  assert.equal((await notices()).length, 1, "the ending notice is sent once");
  // The paid 28-day window passes.
  const endedAt = new Date(Date.now() - 3600000);
  await db.tenant(seedScope(owner), (tx) =>
    tx.query(
      "UPDATE subscriptions SET period_end=$2,data=data||jsonb_build_object('programmeStartsAt',$3::text) WHERE user_id=$1",
      [member.userId, endedAt, new Date(endedAt.getTime() - 28 * DAY).toISOString()],
    ),
  );
  const swept = await sweepProgrammes(db, owner.tenantId);
  assert.equal(swept.ended, 1);
  const [s] = await db.tenant(seedScope(owner), (tx) =>
    tx.query("SELECT status,data FROM subscriptions WHERE user_id=$1", [member.userId]),
  );
  assert.equal(s.status, "canceled");
  assert.equal(s.data.endedReason, "programme_complete");
  assert.deepEqual((await notices()).map((n) => n.title), ["Your programme ends soon", "Your programme is complete"]);
  assert.equal((await sweepProgrammes(db, owner.tenantId)).ended, 0);
  r = await request(app, "GET", "/programme/today", member.token);
  const body = r.json();
  assert.equal(body.access.active, false);
  assert.equal(body.programme.state, "complete");
  assert.equal(body.programme.day, 28);
  assert.deepEqual(
    [body.endOfProgramme.state, body.endOfProgramme.canRenew, body.endOfProgramme.renewProductId],
    ["ended", true, product.id],
  );
  assert.equal(await db.tenant(member, (tx) => programmeLengthDays(tx, member.userId)), 28, "no access: the Brain default");
});

test("monthly membership: blocks of the trainer-set length, the next block is marked once, rolling offers use the Brain default", async () => {
  const product = await offer(db, owner, { programmeDays: 14 });
  const member = await follower(db, owner);
  const start = Math.floor((Date.now() - 15 * DAY) / 1000);
  await processStripeEvent(
    db,
    evt(
      "customer.subscription.created",
      {
        id: "sub_block_" + member.userId.slice(0, 8),
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
  const [s] = await db.tenant(seedScope(owner), (tx) =>
    tx.query("SELECT data FROM subscriptions WHERE user_id=$1", [member.userId]),
  );
  assert.equal(s.data.programmeDays, 14);
  assert.equal(s.data.billing, "monthly");
  assert.equal(s.data.programmeStartsAt, new Date(start * 1000).toISOString());
  assert.equal(await db.tenant(member, (tx) => programmeLengthDays(tx, member.userId)), 14);
  const r = await request(app, "GET", "/programme/today?timezone=UTC", member.token);
  const p = r.json().programme;
  assert.deepEqual([p.block, p.day, p.of, p.rolling], [2, 2, 14, false]);
  assert.equal(r.json().endOfProgramme.state, "next_block");
  await sweepProgrammes(db, owner.tenantId);
  await sweepProgrammes(db, owner.tenantId);
  const notices = await db.tenant(seedScope(owner), (tx) =>
    tx.query("SELECT title FROM notifications WHERE user_id=$1", [member.userId]),
  );
  assert.deepEqual(notices.map((n) => n.title), ["Block 2 of your programme has started"]);
  const events = await db.tenant(seedScope(owner), (tx) =>
    tx.query("SELECT data FROM events WHERE name='programme.block_started' AND data->>'memberId'=$1", [member.userId]),
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].data.block, 2);
  // A rolling offer: the Brain default length.
  const rolling = await offer(db, owner, { programmeDays: null });
  const other = await follower(db, owner);
  await processStripeEvent(
    db,
    evt(
      "customer.subscription.created",
      {
        id: "sub_rolling_" + other.userId.slice(0, 8),
        object: "subscription",
        status: "active",
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
        metadata: { tenant_id: other.tenantId, user_id: other.userId },
        items: { data: [{ price: { id: rolling.data.stripePriceId } }] },
      },
      tick(),
    ),
  );
  assert.equal(await db.tenant(other, (tx) => programmeLengthDays(tx, other.userId)), 28);
  const o = (await request(app, "GET", "/programme/today", other.token)).json().programme;
  assert.deepEqual([o.rolling, o.of, o.block], [true, 28, 1]);
});

test("isolation: a follower's programme, sessions and nutrition stay its own; the coaching team and strangers get no member view", async () => {
  const product = await offer(db, owner, { billing: "upfront", programmeDays: 21 });
  const member = await upfrontMember(product, 3, 21);
  await plan(member, dateIn("Asia/Dubai", new Date()), "planned", "Private session");
  const other = await follower(db, owner);
  const r = await request(app, "GET", "/programme/today", other.token);
  assert.equal(r.statusCode, 200, r.body);
  const body = r.json();
  assert.equal(body.programme, null);
  assert.equal(body.session, null);
  assert.equal(body.access.active, false);
  const t = await request(app, "GET", "/programme/timeline", other.token);
  assert.deepEqual(t.json().days, []);
  const coach = await request(app, "GET", "/programme/today", owner.token);
  assert.equal(coach.statusCode, 403, coach.body);
  const anonymous = await request(app, "GET", "/programme/today");
  assert.equal(anonymous.statusCode, 401, anonymous.body);
  assert.equal(await db.tenant(other, (tx) => programmeLengthDays(tx, member.userId)), 28, "another follower cannot read the member's length");
  // A member of another workspace sees nothing of this one.
  const elsewhere = await workspace(db);
  const outsider = await follower(db, elsewhere);
  const out = await request(app, "GET", "/programme/today", outsider.token);
  assert.equal(out.json().programme, null);
});
