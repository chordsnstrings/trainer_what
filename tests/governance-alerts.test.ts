import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { governanceFixture, type Person } from "./governance-fixtures.ts";
import {
  evaluatePlatformAlerts,
  registerPlatformAlertRule,
  raisePlatformAlert,
  clearPlatformAlert,
  type AlertCandidate,
  type PlatformAlertRule,
} from "../apps/api/src/platform-alerts.ts";

let f: Awaited<ReturnType<typeof governanceFixture>>;
let admin: Person, finance: Person, safety: Person, support: Person, lockedAdmin: Person;
let owner: Person;
before(async () => {
  f = await governanceFixture();
  admin = await f.operator("admin");
  finance = await f.operator("finance");
  safety = await f.operator("safety");
  support = await f.operator("support");
  lockedAdmin = await f.operator("admin");
  await f.db.system((tx) =>
    tx.query(
      "INSERT INTO account_locks(id,user_id,reason,locked_by) VALUES($1,$2,'Synthetic locked operator',$3)",
      [randomUUID(), lockedAdmin.userId, admin.userId],
    ),
  );
  owner = await f.person({ name: "Owner" });
  await f.db.system((tx) =>
    tx.query("UPDATE tenants SET name='Synthetic Studio' WHERE id=$1", [owner.tenantId]),
  );
});
after(async () => {
  await f?.close();
});
const scoped = () => f.scoped(owner.tenantId);
const alerts = () =>
  f.db.system((tx) => tx.query("SELECT * FROM platform_alerts ORDER BY rule,first_seen_at"));
const deliveries = (userId: string) =>
  f.db.system((tx) =>
    tx.query(
      "SELECT d.severity,a.rule FROM platform_alert_deliveries d JOIN platform_alerts a ON a.id=d.alert_id WHERE d.user_id=$1 AND d.status='delivered' ORDER BY a.rule,d.severity",
      [userId],
    ),
  );
async function failedJob() {
  const id = randomUUID();
  await f.db.tenant(scoped(), (tx) =>
    tx.query(
      "INSERT INTO jobs(id,tenant_id,kind,intent_key,data,status,attempts) VALUES($1,$2,'push',$3,'{}','failed',4)",
      [id, owner.tenantId, "fixture:" + id],
    ),
  );
  return id;
}
let safetyException = "";
let reconciliation = "";

test("rules open de-duplicated alerts and deliver them to operators by role scope", async () => {
  await f.db.tenant(scoped(), async (tx) => {
    safetyException = randomUUID();
    reconciliation = randomUUID();
    await tx.query(
      "INSERT INTO records(id,tenant_id,kind,owner_user_id,status,data,created_at) VALUES($1,$2,'exception',$3,'open',$4,now()-interval '5 hours')",
      [safetyException, owner.tenantId, owner.userId, JSON.stringify({ category: "safety", description: "Synthetic red flag" })],
    );
    await tx.query(
      "INSERT INTO records(id,tenant_id,kind,owner_user_id,status,data) VALUES($1,$2,'reconciliation',$3,'open',$4)",
      [reconciliation, owner.tenantId, owner.userId, JSON.stringify({ description: "Synthetic difference", externalReference: "fixture" })],
    );
    const email = randomUUID();
    await tx.query(
      "INSERT INTO jobs(id,tenant_id,kind,intent_key,data,status,attempts) VALUES($1,$2,'email',$3,$4,'blocked',1)",
      [email, owner.tenantId, "fixture:" + email, JSON.stringify({ deliveryState: "unknown", category: "workout" })],
    );
  });
  await f.db.tenant(f.scoped(owner.tenantId, "finance"), (tx) =>
    tx.query(
      "INSERT INTO payouts(id,tenant_id,period,amount_minor,beneficiary_id,status) VALUES($1,$2,'2026-08',45000,'fixture-destination','unknown')",
      [randomUUID(), owner.tenantId],
    ),
  );
  await failedJob();
  // A measured infrastructure threshold from the observer.
  await f.db.system(async (tx) => {
    const observation = randomUUID();
    await tx.query(
      "INSERT INTO infrastructure_observations(id,service,collector_id,sequence,window_started_at,window_ended_at,measurements,content_hash) VALUES($1,'api',$2,1,now()-interval '1 minute',now(),'{}','fixture')",
      [observation, randomUUID()],
    );
    await tx.query(
      "INSERT INTO infrastructure_recommendations(id,service,rule,first_observation_id,latest_observation_id,policy_revision,measured_value,threshold_value) VALUES($1,'api','api_p95_ms',$2,$2,1,2400,1500)",
      [randomUUID(), observation],
    );
  });

  const first = await evaluatePlatformAlerts(f.db);
  assert.equal(first.opened, 6, JSON.stringify(first));
  assert.deepEqual(first.failedRules, []);
  const rows = await alerts();
  assert.deepEqual(rows.map((a) => a.rule).sort(), [
    "email.delivery_uncertain",
    "finance.payout_failure",
    "finance.reconciliation_open",
    "infrastructure.threshold",
    "jobs.failed",
    "safety.escalation_waiting",
  ]);
  for (const a of rows) {
    assert.ok(a.scope.includes("admin"));
    assert.doesNotMatch(a.detail, /Synthetic red flag|Synthetic difference/, "no record content in alerts");
  }
  assert.equal(rows.find((a) => a.rule === "finance.payout_failure")!.severity, "critical");
  // Delivery by scope: Super admins get everything, others their own scope,
  // support nothing here, and a locked operator nothing at all.
  assert.equal((await deliveries(admin.userId)).length, 6);
  assert.deepEqual(
    (await deliveries(finance.userId)).map((d) => d.rule),
    ["finance.payout_failure", "finance.reconciliation_open"],
  );
  assert.deepEqual((await deliveries(safety.userId)).map((d) => d.rule), ["safety.escalation_waiting"]);
  assert.deepEqual(await deliveries(support.userId), []);
  assert.deepEqual(await deliveries(lockedAdmin.userId), []);
  const inbox = await f.call("/notifications", { cookie: admin.cookie });
  const alertNotices = inbox.json().filter((n: any) => n.href === "/admin/alerts");
  assert.equal(alertNotices.length, 6);
  assert.ok(alertNotices.every((n: any) => n.category === "account"));

  // Re-evaluation is idempotent: no duplicate alerts or deliveries.
  const second = await evaluatePlatformAlerts(f.db);
  assert.equal(second.opened, 0);
  assert.equal(second.delivered, 0);
  assert.equal((await alerts()).length, 6);
  // A changed condition updates the same alert without a new delivery.
  await failedJob();
  const third = await evaluatePlatformAlerts(f.db);
  assert.equal(third.updated, 1, JSON.stringify(third));
  assert.equal(third.delivered, 0);
  const jobs = (await alerts()).find((a) => a.rule === "jobs.failed")!;
  assert.equal(jobs.occurrences, 2);
  assert.match(jobs.detail, /^2 job/);
});

test("escalation re-delivers; acknowledge and resolve are scoped, revisioned and audited", async () => {
  await f.db.tenant(scoped(), (tx) =>
    tx.query(
      "INSERT INTO records(id,tenant_id,kind,owner_user_id,status,data,created_at) VALUES($1,$2,'exception',$3,'open',$4,now()-interval '30 hours')",
      [randomUUID(), owner.tenantId, owner.userId, JSON.stringify({ category: "safety" })],
    ),
  );
  const escalated = await evaluatePlatformAlerts(f.db);
  assert.equal(escalated.escalated, 1, JSON.stringify(escalated));
  assert.deepEqual(
    (await deliveries(safety.userId)).map((d) => d.severity),
    ["critical", "warning"],
  );
  // Visibility follows scope.
  const list = async (p: Person) =>
    (await f.call("/admin/alerts", { cookie: p.cookie })).json();
  assert.equal((await list(admin)).alerts.length, 6);
  assert.deepEqual(
    (await list(finance)).alerts.map((a: any) => a.rule).sort(),
    ["finance.payout_failure", "finance.reconciliation_open"],
  );
  assert.equal((await list(support)).alerts.length, 0);
  assert.equal((await list(admin)).alerts[0].severity, "critical");
  const payout = (await list(finance)).alerts.find((a: any) => a.rule === "finance.payout_failure");
  const hidden = await f.call(`/admin/alerts/${payout.id}/acknowledge`, {
    body: { revision: payout.revision },
    cookie: support.cookie,
  });
  assert.equal(hidden.statusCode, 404, hidden.body);
  const stale = await f.call(`/admin/alerts/${payout.id}/acknowledge`, {
    body: { revision: payout.revision + 3 },
    cookie: finance.cookie,
  });
  assert.equal(stale.statusCode, 409, stale.body);
  const ack = await f.call(`/admin/alerts/${payout.id}/acknowledge`, {
    body: { revision: payout.revision, note: "Checking with the bank" },
    cookie: finance.cookie,
  });
  assert.equal(ack.statusCode, 200, ack.body);
  assert.equal(ack.json().status, "acknowledged");
  // An acknowledged alert is not delivered to newly eligible operators.
  const lateFinance = await f.operator("finance");
  await evaluatePlatformAlerts(f.db);
  assert.deepEqual(
    (await deliveries(lateFinance.userId)).map((d) => d.rule),
    ["finance.reconciliation_open"],
  );

  // Operator resolution holds while the condition is unchanged.
  const jobs = (await list(admin)).alerts.find((a: any) => a.rule === "jobs.failed");
  const noNote = await f.call(`/admin/alerts/${jobs.id}/resolve`, {
    body: { revision: jobs.revision },
    cookie: admin.cookie,
  });
  assert.equal(noNote.statusCode, 400);
  const resolved = await f.call(`/admin/alerts/${jobs.id}/resolve`, {
    body: { revision: jobs.revision, note: "Reviewed; failures were a known push outage" },
    cookie: admin.cookie,
  });
  assert.equal(resolved.statusCode, 200, resolved.body);
  assert.equal(resolved.json().resolution, "operator");
  const suppressed = await evaluatePlatformAlerts(f.db);
  assert.equal(suppressed.suppressed, 1, JSON.stringify(suppressed));
  assert.equal(
    (await alerts()).filter((a) => a.rule === "jobs.failed" && a.status !== "resolved").length,
    0,
  );
  await failedJob();
  const reopened = await evaluatePlatformAlerts(f.db);
  assert.equal(reopened.opened, 1, JSON.stringify(reopened));

  // A condition that clears resolves its alert automatically.
  await f.db.tenant(scoped(), (tx) =>
    tx.query("UPDATE records SET status='resolved' WHERE id=$1", [reconciliation]),
  );
  const cleared = await evaluatePlatformAlerts(f.db);
  assert.equal(cleared.resolved, 1, JSON.stringify(cleared));
  const rec = (await alerts()).find((a) => a.rule === "finance.reconciliation_open")!;
  assert.equal(rec.status, "resolved");
  assert.equal(rec.resolution, "condition_cleared");
  const audit = await f.db.system((tx) =>
    tx.query(
      "SELECT action FROM admin_operations_audit WHERE action LIKE 'alert.%' ORDER BY created_at",
    ),
  );
  assert.deepEqual(audit.map((a) => a.action), ["alert.acknowledged", "alert.resolved"]);
});

test("pluggable rules and event-driven alerts use the same inbox", async () => {
  let stale = true,
    broken = false;
  const rule: PlatformAlertRule = {
    id: "backups.stale",
    description: "Synthetic backup freshness rule",
    async evaluate() {
      if (broken) throw new Error("backup inventory unavailable");
      return stale
        ? [
            {
              dedupeKey: "backups.stale:primary",
              fingerprint: "2026-09-26",
              severity: "critical",
              scope: ["admin"],
              title: "Database backup is stale",
              detail: "The newest verified backup is older than 26 hours.",
            } satisfies AlertCandidate,
          ]
        : [];
    },
  };
  registerPlatformAlertRule(rule);
  assert.throws(() =>
    registerPlatformAlertRule({ ...rule, id: "Bad Rule" }),
  );
  let r = await evaluatePlatformAlerts(f.db, { rules: [rule] });
  assert.equal(r.opened, 1);
  broken = true;
  r = await evaluatePlatformAlerts(f.db, { rules: [rule] });
  assert.deepEqual(r.failedRules, ["backups.stale"]);
  assert.equal(
    (await alerts()).find((a) => a.rule === "backups.stale")!.status,
    "open",
    "a failing rule never clears its alerts",
  );
  broken = false;
  stale = false;
  r = await evaluatePlatformAlerts(f.db, { rules: [rule] });
  assert.equal(r.resolved, 1);

  const outcome = await raisePlatformAlert(f.db, "backups.run_failed", {
    dedupeKey: "backups.run_failed:nightly",
    fingerprint: "run-1",
    severity: "warning",
    scope: ["admin"],
    title: "Nightly backup run failed",
    detail: "The synthetic nightly backup run did not finish.",
  });
  assert.equal(outcome, "opened");
  await assert.rejects(
    raisePlatformAlert(f.db, "backups.stale", {
      dedupeKey: "x:y",
      fingerprint: "z",
      severity: "info",
      scope: [],
      title: "Not allowed",
      detail: "Condition rules are evaluated, not raised.",
    }),
  );
  assert.equal(await clearPlatformAlert(f.db, "backups.run_failed:nightly"), 1);

  // Running checks on demand is a Super admin action.
  const denied = await f.call("/admin/alerts/evaluate", { body: {}, cookie: finance.cookie });
  assert.equal(denied.statusCode, 403);
  const ran = await f.call("/admin/alerts/evaluate", { body: {}, cookie: admin.cookie });
  assert.equal(ran.statusCode, 200, ran.body);
  assert.ok(ran.json().rules >= 7);
});
