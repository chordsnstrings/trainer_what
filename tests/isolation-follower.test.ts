// A follower's own scope never reaches another follower's rows, the coaching
// team's internal reviews or the coach's Brain material: not through a plain
// SELECT on any table the tenant role can read, not through the definer
// helpers that replaced the former owner/staff elevations, and not through the
// follower-facing API listings (docs/features/isolation.md).
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { elevated, putRecord, type Actor } from "@trainer/db";
import { accountsContext, ok, type Person } from "./accounts-fixtures.ts";

let ctx: Awaited<ReturnType<typeof accountsContext>>;
let trainer: Person, a: Person, b: Person;
let actorA: Actor, actorB: Actor;
let slotId = "";
const internalKinds = ["decision", "exception", "takeover"];
const brainKinds = [
  "brain_release",
  "coaching_runtime_release",
  "coaching_action",
  "coaching_teaching",
  "coaching_scenario",
];

before(async () => {
  ctx = await accountsContext();
  trainer = await ctx.person({ name: "Isolation Trainer" });
  a = await ctx.person({ role: "subscriber", tenantId: trainer.tenantId });
  b = await ctx.person({ role: "subscriber", tenantId: trainer.tenantId });
  actorA = { tenantId: trainer.tenantId, userId: a.userId, role: "subscriber" };
  actorB = { ...actorA, userId: b.userId };
  const tenantId = trainer.tenantId;
  // Seeded the way the worker writes: an allowlisted service scope.
  await ctx.db.tenant(
    elevated("worker", { tenantId, role: "owner" }),
    async (tx) => {
      const own = (kind: string, status: string, owner: Actor, data = {}) =>
        putRecord(
          tx,
          owner,
          kind,
          { fixture: true, ...data },
          {
            ownerId: owner.userId,
            status,
          },
        );
      for (const [kind, status] of [
        ["intake", "complete"],
        ["workout", "active"],
        ["message", "sent"],
        ["support", "open"],
        ["refund", "requested"],
        ["billing_invoice", "paid"],
        ["checkout", "open"],
        ["subscription_transition", "succeeded"],
        ["booking_payment", "open"],
        ["nutrition_plan", "delivered"],
        ["nutrition_exception", "open"],
        ["nutrition_request", "failed"],
        ["guided_session", "completed"],
        ["privacy_request", "pending_review"],
      ])
        await own(kind, status, actorB);
      // Internal coaching reviews about both followers.
      for (const owner of [actorA, actorB]) {
        await own("decision", "pending_review", owner, { message: "Draft" });
        await own("exception", "open", owner, { category: "decision_review" });
        await own("takeover", "active", owner);
      }
      // The coach's Brain material and a program template.
      const coach = { tenantId, userId: trainer.userId, role: "owner" };
      await own("brain_release", "published", coach, { rules: ["Rule"] });
      await own("coaching_runtime_release", "published", coach);
      await own("coaching_action", "confirmed", coach);
      await own("coaching_teaching", "confirmed", coach);
      await own("coaching_scenario", "held_out", coach);
      await own("program", "template", coach, { title: "Template" });
      await tx.query(
        "INSERT INTO notifications(id,tenant_id,user_id,category,dedupe_key,title,body,email_status) VALUES($1,$2,$3,'coaching','fixture','Private title','Private body','suppressed')",
        [randomUUID(), tenantId, b.userId],
      );
      await tx.query(
        "INSERT INTO cost_events(id,tenant_id,user_id,task,provider,model,cost_usd,created_at) VALUES($1,$2,$3,'coaching','fixture','fixture',0.01,now())",
        [randomUUID(), tenantId, b.userId],
      );
      await tx.query(
        "INSERT INTO consent_records(id,tenant_id,user_id,document_type,document_version,granted) VALUES($1,$2,$3,'coaching','fixture',true)",
        [randomUUID(), tenantId, b.userId],
      );
      await tx.query(
        "INSERT INTO subscriptions(id,tenant_id,user_id,provider_id,status,period_end,price_minor) VALUES($1,$2,$3,$4,'active',now()+interval '20 days',19900)",
        [randomUUID(), tenantId, b.userId, "sub_iso_" + b.userId],
      );
      slotId = randomUUID();
      await tx.query(
        "INSERT INTO booking_slots(id,tenant_id,trainer_id,starts_at,ends_at,capacity,title,location) VALUES($1,$2,$3,now()+interval '2 days',now()+interval '2 days 1 hour',4,'Fixture session','Studio')",
        [slotId, tenantId, trainer.userId],
      );
      await tx.query(
        "INSERT INTO bookings(id,tenant_id,slot_id,user_id,status) VALUES($1,$2,$3,$4,'confirmed')",
        [randomUUID(), tenantId, slotId, b.userId],
      );
      await tx.query(
        "INSERT INTO jobs(id,tenant_id,kind,intent_key,data) VALUES($1,$2,'nutrition_week',$3,$4)",
        [
          randomUUID(),
          tenantId,
          "iso-week:" + b.userId,
          JSON.stringify({ userId: b.userId }),
        ],
      );
    },
  );
  // A settled charge for B in the ledger.
  await ctx.db.tenant(
    elevated("provider-callback", { tenantId, role: "finance" }),
    async (tx) => {
      const id = randomUUID();
      await tx.query(
        "INSERT INTO journals(id,tenant_id,source_key,description,data) VALUES($1,$2,$3,'Fixture charge',$4)",
        [
          id,
          tenantId,
          "stripe-invoice:iso-" + b.userId,
          JSON.stringify({ userId: b.userId, grossMinor: 19900 }),
        ],
      );
      for (const [account, amount] of [
        ["stripe_clearing", 19900],
        ["trainer_payable", -19900],
      ] as const)
        await tx.query(
          "INSERT INTO journal_lines(id,tenant_id,journal_id,account,amount_minor) VALUES($1,$2,$3,$4,$5)",
          [randomUUID(), tenantId, id, account, amount],
        );
    },
  );
});
after(async () => ctx?.close());

test("no table the tenant role can read shows a follower another follower's rows", async () => {
  // Every column that names a person, on every table the tenant role may
  // SELECT (pg_catalog, so the listing does not depend on the caller).
  const columns = await ctx.db.system((tx) =>
    tx.query<{ t: string; col: string }>(
      "SELECT c.relname AS t,a.attname AS col FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relkind IN ('r','p','v') AND a.attnum>0 AND NOT a.attisdropped AND a.attname IN ('user_id','owner_user_id','subject_user_id','uploaded_by','actor_id','member_id','recipient_id') AND has_table_privilege('trainer_app',c.oid,'SELECT') ORDER BY 1,2",
    ),
  );
  assert.ok(columns.length > 20, "the sweep covers the tenant tables");
  const leaks = await ctx.db.tenant(actorA, async (tx) => {
    const found: string[] = [];
    for (const { t, col } of columns) {
      const [row] = await tx.query(
        `SELECT count(*)::int AS n FROM "${t}" WHERE "${col}"::text=$1`,
        [b.userId],
      );
      if (row.n) found.push(`${t}.${col}: ${row.n}`);
    }
    // Rows that carry the other follower only inside their data.
    const [data] = await tx.query(
      "SELECT count(*)::int AS n FROM records WHERE data::text LIKE $1",
      ["%" + b.userId + "%"],
    );
    if (data.n) found.push(`records.data: ${data.n}`);
    const [journal] = await tx.query(
      "SELECT count(*)::int AS n FROM journals WHERE data->>'userId'=$1",
      [b.userId],
    );
    if (journal.n) found.push(`journals.data: ${journal.n}`);
    const [job] = await tx.query(
      "SELECT count(*)::int AS n FROM jobs WHERE data->>'userId'=$1",
      [b.userId],
    );
    if (job.n) found.push(`jobs.data: ${job.n}`);
    return found;
  });
  assert.deepEqual(leaks, []);
  // The other follower does see its own rows: the sweep is not vacuous.
  const own = await ctx.db.tenant(actorB, (tx) =>
    tx.query("SELECT count(*)::int AS n FROM records WHERE owner_user_id=$1", [
      b.userId,
    ]),
  );
  assert.ok(own[0].n >= 10);
});

test("a follower's scope lists no internal review and none of the coach's Brain material, even about itself", async () => {
  const visible = await ctx.db.tenant(actorA, (tx) =>
    tx.query<{ kind: string }>(
      "SELECT kind FROM records WHERE kind=ANY($1::text[]) OR (kind='program' AND status='template')",
      [[...internalKinds, ...brainKinds]],
    ),
  );
  assert.deepEqual(visible, []);
  // The Brain material its own coaching request needs is read by name only.
  const [release] = await ctx.db.tenant(actorA, (tx) =>
    tx.query("SELECT kind,status FROM member_material('brain_release')"),
  );
  assert.deepEqual(release, { kind: "brain_release", status: "published" });
});

test("the helpers that replaced elevated follower paths answer for the follower or with counts only", async () => {
  const one = (sql: string, values: any[] = []) =>
    ctx.db.tenant(actorA, (tx) => tx.query(sql, values)).then((r) => r[0]);
  // Leaving: B's open checkout, privacy request and booking are not A's.
  assert.deepEqual(
    await one("SELECT * FROM membership_exit_blockers($1)", [a.userId]),
    { renewal: 0, checkout: 0, payment: 0, booking: 0, open_privacy: 0 },
  );
  // Reserving: the slot's taken seats as a number, never the bookings.
  assert.equal(
    (await one("SELECT booking_slot_taken($1) AS n", [slotId])).n,
    1,
  );
  // Billing: A's own charges only.
  assert.deepEqual(
    await ctx.db.tenant(actorA, (tx) =>
      tx.query("SELECT * FROM member_charges()"),
    ),
    [],
  );
  assert.equal(
    (
      await ctx.db.tenant(actorB, (tx) =>
        tx.query("SELECT * FROM member_charges()"),
      )
    ).length,
    1,
  );
  // Model budget: workspace totals and A's own count; B's spending is not A's.
  const usage = await one("SELECT * FROM model_usage_today($1,$2)", [
    ["coaching"],
    a.userId,
  ]);
  assert.deepEqual(
    { mine: usage.mine, subscribers: usage.subscribers },
    { mine: 0, subscribers: 1 },
  );
  // Personal export: the private kinds are A's own.
  const exported = await ctx.db.tenant(actorA, (tx) =>
    tx.query("SELECT kind FROM personal_export_records($1,$2)", [
      a.userId,
      ["decision", "exception", "takeover"],
    ]),
  );
  assert.deepEqual(exported.map((r: any) => r.kind).sort(), [
    "decision",
    "exception",
    "takeover",
  ]);
  // Coaching: B's takeover is not A's.
  assert.equal((await one("SELECT member_takeover_active() AS t")).t, true);
  await ctx.db.tenant(
    elevated("worker", { tenantId: trainer.tenantId, role: "owner" }),
    (tx) =>
      tx.query(
        "UPDATE records SET status='ended' WHERE kind='takeover' AND owner_user_id=$1",
        [a.userId],
      ),
  );
  assert.equal((await one("SELECT member_takeover_active() AS t")).t, false);
  // Catalog helpers exist for followers; the catalog tables stay closed.
  assert.deepEqual(
    await ctx.db.tenant(actorA, (tx) =>
      tx.query("SELECT count(*)::int AS n FROM nutrition_foods"),
    ),
    [{ n: 0 }],
  );
});

test("follower-facing listings carry no other follower's rows, internal reviews or Brain material", async () => {
  const boot = ok(await ctx.call("/bootstrap", { cookie: a.cookie }));
  const kinds = new Set(boot.records.map((r: any) => r.kind));
  for (const kind of [...internalKinds, ...brainKinds])
    assert.ok(!kinds.has(kind), `bootstrap lists ${kind}`);
  assert.ok(
    !boot.records.some(
      (r: any) =>
        r.owner_user_id === b.userId ||
        (r.kind === "program" && r.status === "template"),
    ),
  );
  assert.deepEqual(
    boot.subscriptions.filter((s: any) => s.user_id !== a.userId),
    [],
  );
  assert.ok(!JSON.stringify(boot).includes(b.userId));
  const training = ok(
    await ctx.call("/training/overview", { cookie: a.cookie }),
  );
  assert.ok(
    !training.records.some(
      (r: any) => r.owner_user_id === b.userId || r.status === "template",
    ),
  );
  const exit = ok(await ctx.call("/membership/leave", { cookie: a.cookie }));
  assert.deepEqual(exit.blockers, []);
});
