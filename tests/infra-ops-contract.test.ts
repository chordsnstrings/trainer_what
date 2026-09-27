import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createDatabase, type Database } from "@trainer/db";
import {
  hostOperationsKey,
  readBackupStatus,
  readHostHealth,
  signHostAction,
  signHostResult,
} from "../apps/api/src/host-operations.ts";

// Synthetic fixture secret shared by the Python controller code and the API.
const SECRET = "synthetic-contract-secret-with-more-than-32-bytes!";
const saved = process.env.INTERNAL_PROXY_SECRET;
process.env.INTERNAL_PROXY_SECRET = SECRET;
let db: Database;
before(async () => {
  db = await createDatabase({ memory: true });
});
after(async () => {
  await db.close();
  if (saved === undefined) delete process.env.INTERNAL_PROXY_SECRET;
  else process.env.INTERNAL_PROXY_SECRET = saved;
});

test("a report written by the Python controller is verified and understood by the API", async (t) => {
  const script = fileURLToPath(
    new URL("./hostops_report_contract.py", import.meta.url),
  );
  const run = spawnSync("python3", [script, SECRET], {
    encoding: "utf8",
    timeout: 60000,
  });
  if (run.error || (run.status !== 0 && /openssl/i.test(run.stderr))) {
    t.skip("python3 or openssl is unavailable");
    return;
  }
  assert.equal(run.status, 0, run.stderr);
  const { payload, signature } = JSON.parse(
    run.stdout.trim().split("\n").at(-1)!,
  );
  await db.system((tx) =>
    tx.query(
      "INSERT INTO host_status(source,payload,signature) VALUES('controller',$1,$2)",
      [payload, signature],
    ),
  );
  const health = await readHostHealth(db);
  assert.equal(health.controller.state, "measured");
  assert.equal(health.metricsSource, "controller");
  assert.ok(health.metrics.some((m) => m.key === "disk:/"));
  assert.deepEqual(
    health.containers!.map((c) => [c.service, c.status]),
    [
      ["database", "ok"],
      ["api", "ok"],
      ["web", "ok"],
      ["worker", "ok"],
      ["edge", "ok"],
    ],
  );
  assert.equal(health.deploy?.current, "a".repeat(40));
  assert.equal(health.edge?.onDemandTls, true);
  assert.equal(health.edge?.onDemandConfigured, true);
  assert.equal(health.edge?.pendingReapply, false);
  const backups = await readBackupStatus(db);
  assert.equal(backups.state, "healthy");
  assert.equal(backups.stale, false);
  assert.equal(backups.location, "local");
  assert.equal(backups.offsite, "not_configured");
  assert.equal(backups.count, 1);
  assert.ok((backups.sizeBytes ?? 0) > 0);
  // Any change to the signed text invalidates it.
  await db.system((tx) =>
    tx.query(
      "UPDATE host_status SET payload=replace(payload,'\"paused\":false','\"paused\":true') WHERE source='controller'",
    ),
  );
  assert.equal((await readHostHealth(db)).controller.state, "unverified");
});

test("controller SQL for actions and reports runs against the real schema", async (t) => {
  const script = fileURLToPath(
    new URL("./hostops_sql_contract.py", import.meta.url),
  );
  const python = (mode: string, input = "") =>
    spawnSync("python3", [script, SECRET, mode], {
      encoding: "utf8",
      input,
      timeout: 60000,
    });
  const queries = python("queries");
  if (queries.error) {
    t.skip("python3 is unavailable");
    return;
  }
  assert.equal(queries.status, 0, queries.stderr);
  const { pending, running } = JSON.parse(queries.stdout);
  const admin = randomUUID(),
    key = hostOperationsKey()!,
    issuedAtMs = Date.now();
  await db.system((tx) =>
    tx.query(
      "INSERT INTO users(id,email,name,password_hash,platform_role) VALUES($1,'contract-admin@example.test','Operator','unused','admin')",
      [admin],
    ),
  );
  const intents = (["pause_deploys", "backup_now"] as const).map((action) => ({
    id: randomUUID(),
    requestId: randomUUID(),
    action,
    target: null,
    requestedBy: admin,
    issuedAtMs,
    expiresAtMs: issuedAtMs + 1800000,
    reason: "Synthetic contract request for " + action,
  }));
  for (const [index, intent] of intents.entries())
    await db.system((tx) =>
      tx.query(
        "INSERT INTO host_action_requests(id,request_id,action,target,reason,requested_by,issued_at_ms,expires_at_ms,signature) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          intent.id,
          intent.requestId,
          intent.action,
          intent.target,
          intent.reason,
          intent.requestedBy,
          intent.issuedAtMs,
          intent.expiresAtMs,
          // The second request is forged: signed with a different key.
          index === 0
            ? signHostAction(intent, key)
            : signHostAction(intent, hostOperationsKey("x".repeat(40))!),
        ],
      ),
    );
  const first = (rows: any[]) => Object.values(rows[0])[0];
  const pendingRows = first(await db.system((tx) => tx.query(pending)));
  assert.equal((pendingRows as any[]).length, 2);
  assert.deepEqual(first(await db.system((tx) => tx.query(running))), []);
  const handled = python(
    "handle",
    JSON.stringify({ rows: pendingRows, nowMs: Date.now() }),
  );
  assert.equal(handled.status, 0, handled.stderr);
  const plan = JSON.parse(handled.stdout);
  assert.deepEqual(
    plan.map((p: any) => p.verdict),
    ["ok", "rejected", "report"],
  );
  for (const item of plan)
    for (const group of item.statements)
      await db.system(async (tx) => {
        for (const [index, statement] of group.entries()) {
          const rows = await tx.query(statement);
          if (index === 0 && item.id)
            assert.equal(rows[0]?.id, item.id, "UPDATE ... RETURNING id");
        }
      });
  const rows = await db.system((tx) =>
    tx.query(
      "SELECT id,status,result,result_signature,picked_up_at FROM host_action_requests ORDER BY created_at",
    ),
  );
  const byId = new Map(rows.map((r: any) => [r.id, r]));
  const done = byId.get(intents[0].id),
    forged = byId.get(intents[1].id);
  assert.equal(done.status, "succeeded");
  assert.ok(done.picked_up_at);
  assert.equal(
    done.result_signature,
    signHostResult(key, done.id, "succeeded", done.result),
  );
  assert.equal(JSON.parse(done.result).message, "Synthetic contract result");
  assert.equal(forged.status, "rejected");
  assert.match(JSON.parse(forged.result).message, /signature/);
  const audits = await db.system((tx) =>
    tx.query(
      "SELECT action,actor_id,subject_id,data FROM admin_operations_audit ORDER BY created_at,action",
    ),
  );
  assert.deepEqual(
    audits.map((a: any) => [a.action, a.subject_id, a.actor_id]).sort(),
    [
      ["infrastructure.host_action.rejected", intents[1].id, admin],
      ["infrastructure.host_action.running", intents[0].id, admin],
      ["infrastructure.host_action.succeeded", intents[0].id, admin],
    ].sort(),
  );
  assert.equal(audits[0].data.executor, "host-controller");
  const health = await readHostHealth(db);
  assert.equal(health.controller.state, "measured");
  assert.equal(health.backups.state, "unreported");
});
