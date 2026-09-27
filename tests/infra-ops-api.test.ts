import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import Fastify from "fastify";
import { createDatabase, type Database } from "@trainer/db";
import {
  checkPlatformAddress,
  hostActionCanonical,
  hostOperationsKey,
  readBackupStatus,
  readHostHealth,
  recordApiHostSample,
  registerHostOperations,
  signHostAction,
  signHostResult,
  signHostStatus,
} from "../apps/api/src/host-operations.ts";

// Synthetic fixture secret; never a deployment value.
const SECRET = "synthetic-host-operations-secret-with-more-than-32-bytes";
const previousSecret = process.env.INTERNAL_PROXY_SECRET;
process.env.INTERNAL_PROXY_SECRET = SECRET;
let db: Database;
const app = Fastify();
const operator = {
  userId: randomUUID(),
  tenantId: randomUUID(),
  role: "owner",
};
const other = randomUUID();
const resolver = {
  resolve4: async (host: string) =>
    host === "app.fixture-platform.test" || host === "localhost"
      ? ["203.0.113.10"]
      : host === "elsewhere.fixture-platform.test"
        ? ["198.51.100.7"]
        : [],
  resolve6: async () => [] as string[],
};
before(async () => {
  db = await createDatabase({ memory: true });
  await db.system(async (tx) => {
    for (const [id, email, role] of [
      [operator.userId, "host-ops@example.test", "admin"],
      [other, "host-ops-support@example.test", "support"],
    ])
      await tx.query(
        "INSERT INTO users(id,email,name,password_hash,platform_role) VALUES($1,$2,'Operator','unused',$3)",
        [id, email, role],
      );
    await tx.query(
      "INSERT INTO tenants(id,slug,name) VALUES($1,$2,'Host fixture')",
      [operator.tenantId, "host-ops-" + operator.tenantId.slice(0, 8)],
    );
  });
  app.setErrorHandler((e: any, _req, reply) =>
    reply
      .code(e.statusCode ?? (e.name === "ZodError" ? 400 : 500))
      .send({ code: e.code, message: e.message }),
  );
  registerHostOperations(
    app,
    db,
    (req) => ({
      ...operator,
      userId: String(req.headers["x-user"] ?? operator.userId),
      platformRole: String(req.headers["x-role"] ?? "admin"),
      mfaAt: String(req.headers["x-mfa"] ?? new Date().toISOString()),
    }),
    { resolver },
  );
});
after(async () => {
  await app.close();
  await db.close();
  if (previousSecret === undefined) delete process.env.INTERNAL_PROXY_SECRET;
  else process.env.INTERNAL_PROXY_SECRET = previousSecret;
});
const call = (
  path = "",
  body?: unknown,
  headers: Record<string, string> = {},
) =>
  app.inject({
    url: "/api/v1/admin/infrastructure/host" + path,
    method: body ? "POST" : "GET",
    payload: body as any,
    headers,
  });
const view = async () => {
  const r = await call();
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
};

const SHA = "a".repeat(40),
  PREVIOUS = "b".repeat(40);
function report(changes: Record<string, unknown> = {}, backupAgeHours = 2) {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    controllerRelease: SHA,
    host: {
      cpuCount: 2,
      load: [0.5, 0.8, 0.7],
      uptimeSeconds: 86400,
      memory: {
        totalBytes: 4 * 1024 ** 3,
        availableBytes: 2 * 1024 ** 3,
        swapTotalBytes: 0,
        swapFreeBytes: 0,
      },
      disks: [
        {
          mount: "/",
          totalBytes: 80 * 1024 ** 3,
          usedBytes: 40 * 1024 ** 3,
          freeBytes: 40 * 1024 ** 3,
        },
      ],
    },
    containers: [
      ...["database", "api", "web", "worker", "edge"].map((service) => ({
        service,
        state: "running",
        health: ["database", "api"].includes(service) ? "healthy" : null,
        exitCode: null,
      })),
      { service: "migrate", state: "exited", health: null, exitCode: 0 },
    ],
    edge: { onDemandTls: true, endpoint: "https://app.fixture-platform.test" },
    deploy: {
      current: SHA,
      previous: PREVIOUS,
      serving: null,
      deployedAt: 1790000000,
      paused: false,
      pausedAt: null,
    },
    backups: {
      policy: { intervalHours: 24, keep: 7, offsite: "not_configured" },
      count: 3,
      totalBytes: 3000,
      latest:
        backupAgeHours < 0
          ? null
          : {
              name: "20260927T000000Z",
              createdAt: new Date(
                Date.now() - backupAgeHours * 3600000,
              ).toISOString(),
              sizeBytes: 1000,
              sha256: "c".repeat(64),
              keyId: "0123456789abcdef",
              kind: "scheduled",
              location: "local",
              offsite: { status: "not_configured" },
            },
      lastAttemptAt: new Date().toISOString(),
      lastFailure: null,
      lastVerification: null,
      nextDueAt: new Date(Date.now() + 3600000).toISOString(),
    },
    ...changes,
  };
}
async function publish(
  payload: unknown,
  options: { signature?: string | null; ageSeconds?: number } = {},
) {
  const text = JSON.stringify(payload);
  const signature =
    options.signature === undefined
      ? signHostStatus(hostOperationsKey()!, "controller", text)
      : options.signature;
  await db.system((tx) =>
    tx.query(
      "INSERT INTO host_status(source,payload,signature,reported_at) VALUES('controller',$1,$2,now()-make_interval(secs=>$3)) ON CONFLICT(source) DO UPDATE SET payload=EXCLUDED.payload,signature=EXCLUDED.signature,reported_at=EXCLUDED.reported_at",
      [text, signature, options.ageSeconds ?? 0],
    ),
  );
}

test("host operations require a current platform administrator with fresh MFA", async () => {
  for (const headers of [
    { "x-role": "support" } as Record<string, string>,
    { "x-mfa": "invalid" },
    { "x-mfa": new Date(Date.now() - 11 * 60000).toISOString() },
    { "x-mfa": new Date(Date.now() + 60000).toISOString() },
  ])
    assert.equal((await call("", undefined, headers)).statusCode, 403);
  // A session that still says admin, for a user whose role was removed.
  const r = await call(
    "/actions",
    {
      requestId: randomUUID(),
      action: "backup_now",
      reason: "Synthetic check of revoked authority",
    },
    { "x-user": other },
  );
  assert.equal(r.statusCode, 403, r.body);
  await assert.rejects(
    db.tenant(operator, (tx) => tx.query("SELECT * FROM host_action_requests")),
    /permission denied/,
  );
});

test("without a verified controller report, backups are unconfirmed and flagged", async () => {
  const status = await readBackupStatus(db);
  assert.equal(status.state, "unreported");
  assert.equal(status.stale, true);
  const v = await view();
  assert.equal(v.controller.state, "unreported");
  assert.equal(v.metricsSource, null);
  assert.equal(v.signingAvailable, true);
  assert.ok(v.outOfScope.some((x: any) => /API token/.test(x.reason)));
  // The API container's own sample fills host metrics until the controller reports.
  await recordApiHostSample(db, {
    version: 1,
    generatedAt: new Date().toISOString(),
    cpuCount: 2,
    load: [3.5, 7, 6],
    memory: { totalBytes: 1000, availableBytes: 50 },
    disk: { mount: "/", totalBytes: 100, usedBytes: 95, freeBytes: 5 },
  });
  const fallback = await view();
  assert.equal(fallback.metricsSource, "api");
  assert.deepEqual(
    Object.fromEntries(fallback.metrics.map((m: any) => [m.key, m.status])),
    {
      "disk:/": "critical",
      memory_available: "critical",
      load_per_cpu: "critical",
    },
  );
  assert.equal(fallback.containers, null);
  // A real sample from this machine is accepted by the same schema.
  await recordApiHostSample(db);
});

test("signed controller reports are evaluated against thresholds; forged ones are ignored", async () => {
  await publish(report());
  let v = await view();
  assert.equal(v.controller.state, "measured");
  assert.equal(v.metricsSource, "controller");
  assert.equal(v.overall, "ok");
  assert.ok(v.metrics.every((m: any) => m.status === "ok"));
  assert.ok(v.containers.every((c: any) => ["ok", "info"].includes(c.status)));
  assert.equal(v.backups.state, "healthy");
  assert.equal(v.backups.location, "local");
  assert.equal(v.deploy.current, SHA);

  const degraded = report({
    containers: [
      {
        service: "database",
        state: "running",
        health: "healthy",
        exitCode: null,
      },
      { service: "api", state: "running", health: "unhealthy", exitCode: null },
      { service: "web", state: "exited", health: null, exitCode: 1 },
      { service: "worker", state: "running", health: null, exitCode: null },
    ],
  }) as any;
  degraded.host.disks[0].usedBytes = 74 * 1024 ** 3;
  degraded.host.memory.availableBytes = 0.5 * 1024 ** 3;
  await publish(degraded);
  v = await view();
  const levels = Object.fromEntries(
    v.metrics.map((m: any) => [m.key, m.status]),
  );
  assert.deepEqual(levels, {
    "disk:/": "critical",
    memory_available: "warning",
    load_per_cpu: "ok",
  });
  const containers = Object.fromEntries(
    v.containers.map((c: any) => [c.service, c.status]),
  );
  assert.deepEqual(containers, {
    database: "ok",
    api: "critical",
    web: "critical",
    worker: "ok",
    edge: "critical",
  });
  assert.equal(v.overall, "critical");

  // A report written without the host key (e.g. through the runtime role) is not trusted.
  await publish(report(), { signature: "0".repeat(64) });
  v = await view();
  assert.equal(v.controller.state, "unverified");
  assert.equal(v.containers, null);
  assert.equal((await readBackupStatus(db)).state, "unreported");

  // Freshness is the signed generatedAt, not the writable reported_at column.
  const ago = (seconds: number) =>
    new Date(Date.now() - seconds * 1000).toISOString();
  await publish(report({ generatedAt: ago(1800) }));
  v = await view();
  assert.equal(v.controller.state, "stale");
  assert.ok(v.controller.ageSeconds >= 1799, String(v.controller.ageSeconds));
  assert.notEqual(v.metricsSource, "controller");
  assert.equal(v.containers, null);

  // Replay: an old, validly signed report written again with reported_at=now().
  const replayed = report({ generatedAt: ago(7 * 86400) }) as any;
  replayed.host.disks[0].usedBytes = 1;
  await publish(replayed, { ageSeconds: 0 });
  v = await view();
  assert.equal(v.controller.state, "stale");
  assert.notEqual(v.metricsSource, "controller");
  assert.equal(v.controller.reportedAt, replayed.generatedAt);
  const replayedBackups = await readBackupStatus(db);
  assert.equal(replayedBackups.state, "report_stale");
  assert.equal(replayedBackups.stale, true);

  // A signed report dated in the future is refused rather than trusted as current.
  await publish(
    report({ generatedAt: new Date(Date.now() + 3600000).toISOString() }),
  );
  v = await view();
  assert.equal(v.controller.state, "invalid");
  assert.equal((await readBackupStatus(db)).state, "unreported");
});

test("a report delayed by a long deployment does not raise a stale-backup alert", async () => {
  // The controller reports after each cycle; a 20-minute image build delays it.
  const delayed = report(
    { generatedAt: new Date(Date.now() - 20 * 60000).toISOString() },
    2,
  );
  await publish(delayed);
  const status = await readBackupStatus(db);
  assert.equal(status.state, "healthy");
  assert.equal(status.stale, false);
  assert.equal(status.reportStale, true);
  assert.match(status.message, /last reported 20 minutes ago/);
  // Backup age is still measured against now from that last verified report.
  await publish(
    report(
      { generatedAt: new Date(Date.now() - 3 * 3600000).toISOString() },
      30,
    ),
  );
  const aging = await readBackupStatus(db);
  assert.equal(aging.state, "warning");
  assert.equal(aging.stale, true);
  assert.equal(aging.reportStale, true);
  // Silent for longer than the backup warning age: backups cannot be judged.
  await publish(
    report(
      { generatedAt: new Date(Date.now() - 27 * 3600000).toISOString() },
      2,
    ),
  );
  assert.equal((await readBackupStatus(db)).state, "report_stale");
  await publish(report());
  const fresh = await readBackupStatus(db);
  assert.equal(fresh.reportStale, false);
  assert.equal(fresh.state, "healthy");
});

test("backup age drives the stale-backup signal used by alerts", async () => {
  const cases: Array<[number, string, boolean]> = [
    [1, "healthy", false],
    [30, "warning", true],
    [60, "stale", true],
    [-1, "missing", true],
  ];
  for (const [age, state, stale] of cases) {
    await publish(report({}, age));
    const status = await readBackupStatus(db);
    assert.equal(status.state, state, `age ${age}`);
    assert.equal(status.stale, stale, `age ${age}`);
  }
  const offsite = report() as any;
  offsite.backups.latest.location = "local+offsite";
  offsite.backups.latest.offsite = {
    status: "uploaded",
    at: new Date().toISOString(),
    objectKey: "gymmembership/20260927T000000Z.dump.enc",
  };
  await publish(offsite);
  const status = await readBackupStatus(db);
  assert.equal(status.location, "local+offsite");
  assert.equal(status.offsite, "uploaded");
  assert.match(status.message, /off-server/);
});

test("threshold changes are revisioned, validated and audited", async () => {
  const v = await view();
  const thresholds = { ...v.thresholds.values, diskWarnPercent: 70 };
  const body = {
    revision: v.thresholds.revision,
    thresholds,
    reason: "Synthetic capacity review of disk warnings",
  };
  assert.equal(
    (
      await call("/thresholds", {
        ...body,
        thresholds: { ...thresholds, diskWarnPercent: 95 },
      })
    ).statusCode,
    400,
  );
  let r = await call("/thresholds", body);
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().revision, v.thresholds.revision + 1);
  r = await call("/thresholds", body);
  assert.equal(r.json().code, "STALE_POLICY");
  assert.equal((await view()).thresholds.values.diskWarnPercent, 70);
  const [audit] = await db.system((tx) =>
    tx.query(
      "SELECT * FROM admin_operations_audit WHERE action='infrastructure.host.thresholds'",
    ),
  );
  assert.equal(audit.actor_id, operator.userId);
});

test("host action requests are allowlisted, signed, idempotent and bounded", async () => {
  const bad = [
    { action: "delete_database" },
    { action: "restart_service" },
    { action: "restart_service", target: "database" },
    { action: "backup_now", target: "api" },
    { action: "backup_now", reason: "short" },
    { action: "backup_now", command: "rm -rf /" },
  ];
  for (const patch of bad)
    assert.equal(
      (
        await call("/actions", {
          requestId: randomUUID(),
          reason: "Synthetic operator request",
          ...patch,
        })
      ).statusCode,
      400,
      JSON.stringify(patch),
    );
  const body = {
    requestId: randomUUID(),
    action: "restart_service",
    target: "worker",
    reason: "Synthetic worker restart after maintenance",
  };
  let r = await call("/actions", body);
  assert.equal(r.statusCode, 200, r.body);
  const created = r.json();
  assert.equal(created.status, "pending");
  assert.equal((await call("/actions", body)).json().id, created.id);
  assert.equal(
    (
      await call("/actions", {
        ...body,
        reason: "A different worker restart reason",
      })
    ).json().code,
    "INTENT_CONFLICT",
  );
  assert.equal(
    (await call("/actions", { ...body, requestId: randomUUID() })).json().code,
    "HOST_ACTION_OPEN",
  );
  const [row] = await db.system((tx) =>
    tx.query("SELECT * FROM host_action_requests WHERE id=$1", [created.id]),
  );
  const intent = {
    id: row.id,
    requestId: row.request_id,
    action: row.action,
    target: row.target,
    requestedBy: row.requested_by,
    issuedAtMs: Number(row.issued_at_ms),
    expiresAtMs: Number(row.expires_at_ms),
    reason: row.reason,
  };
  assert.equal(row.signature, signHostAction(intent, hostOperationsKey()!));
  assert.equal(intent.expiresAtMs - intent.issuedAtMs, 30 * 60000);
  // Intent is sealed; only the status lifecycle may change.
  await assert.rejects(
    db.system((tx) =>
      tx.query(
        "UPDATE host_action_requests SET action='backup_now' WHERE id=$1",
        [row.id],
      ),
    ),
    /immutable|permission denied/,
  );
  await assert.rejects(
    db.system((tx) =>
      tx.query(
        "UPDATE host_action_requests SET status='succeeded' WHERE id=$1",
        [row.id],
      ),
    ),
    /transition/,
  );
  await assert.rejects(
    db.system((tx) =>
      tx.query("DELETE FROM host_action_requests WHERE id=$1", [row.id]),
    ),
    /retained|permission denied/,
  );
  // Simulate the controller: pick up, then report a signed result.
  const key = hostOperationsKey()!;
  const result = JSON.stringify({ message: "worker recreated and running" });
  await db.system(async (tx) => {
    await tx.query(
      "UPDATE host_action_requests SET status='running',picked_up_at=now() WHERE id=$1",
      [row.id],
    );
    await tx.query(
      "UPDATE host_action_requests SET status='succeeded',finished_at=now(),result=$2,result_signature=$3 WHERE id=$1",
      [row.id, result, signHostResult(key, row.id, "succeeded", result)],
    );
  });
  let listed = (await view()).actions.recent.find((x: any) => x.id === row.id);
  assert.equal(listed.status, "succeeded");
  assert.equal(listed.resultVerified, true);
  assert.equal(listed.result.message, "worker recreated and running");
  await assert.rejects(
    db.system((tx) =>
      tx.query("UPDATE host_action_requests SET result='{}' WHERE id=$1", [
        row.id,
      ]),
    ),
    /sealed/,
  );
  assert.equal(
    (
      await call(`/actions/${row.id}/cancel`, {
        reason: "Too late to cancel this",
      })
    ).json().code,
    "HOST_ACTION_STATE",
  );

  // A result that the controller did not sign is shown as unverified.
  r = await call("/actions", {
    requestId: randomUUID(),
    action: "backup_now",
    reason: "Synthetic manual backup before maintenance",
  });
  const backup = r.json();
  await db.system(async (tx) => {
    await tx.query(
      "UPDATE host_action_requests SET status='running',picked_up_at=now() WHERE id=$1",
      [backup.id],
    );
    await tx.query(
      "UPDATE host_action_requests SET status='succeeded',finished_at=now(),result='{\"message\":\"forged\"}',result_signature=$2 WHERE id=$1",
      [backup.id, "f".repeat(64)],
    );
  });
  listed = (await view()).actions.recent.find((x: any) => x.id === backup.id);
  assert.equal(listed.resultVerified, false);

  // Cancel before pickup.
  r = await call("/actions", {
    requestId: randomUUID(),
    action: "pause_deploys",
    reason: "Synthetic pause during a maintenance window",
  });
  const pause = r.json();
  r = await call(`/actions/${pause.id}/cancel`, {
    reason: "Maintenance window was postponed",
  });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().status, "canceled");
  const audits = await db.system((tx) =>
    tx.query(
      "SELECT action FROM admin_operations_audit WHERE subject_id=$1 ORDER BY created_at",
      [pause.id],
    ),
  );
  assert.deepEqual(
    audits.map((a: any) => a.action),
    [
      "infrastructure.host_action.requested",
      "infrastructure.host_action.canceled",
    ],
  );
  // Hourly bound across all operators.
  let limited: any = null;
  for (let i = 0; i < 20 && !limited; i++) {
    const next = await call("/actions", {
      requestId: randomUUID(),
      action: "verify_backup",
      reason: "Synthetic repeated request number " + i,
    });
    if (next.statusCode === 429) limited = next.json();
    else {
      assert.equal(next.statusCode, 200, next.body);
      assert.equal(
        (
          await call(`/actions/${next.json().id}/cancel`, {
            reason: "Synthetic cleanup of open request",
          })
        ).statusCode,
        200,
      );
    }
  }
  assert.equal(limited?.code, "HOST_ACTION_RATE");
  const [count] = await db.system((tx) =>
    tx.query("SELECT count(*)::int AS n FROM host_action_requests"),
  );
  assert.equal(Number(count.n), 12);
});

test("action signatures match the controller's canonical form", () => {
  // The same fixed vector is asserted in tests/test_hostops_deployment.py.
  const intent = {
    id: "11111111-2222-4333-8444-555555555555",
    requestId: "66666666-7777-4888-9999-000000000000",
    action: "restart_service" as const,
    target: "api",
    requestedBy: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    issuedAtMs: 1790000000000,
    expiresAtMs: 1790001800000,
    reason: "Synthetic vector: restart the API",
  };
  const key = hostOperationsKey(SECRET)!;
  assert.equal(
    hostActionCanonical(intent).split("\n").at(-1),
    createHash("sha256").update(intent.reason).digest("hex"),
  );
  assert.equal(
    signHostAction(intent, key),
    "d815af0aebe1d7e55e898e76c703084f01886655f630d35668b3b99be9e59c0d",
  );
  assert.equal(
    signHostResult(key, intent.id, "succeeded", '{"message":"ok"}'),
    "83e1ce063a36c9207e44cce276fe75df5cff5b8c85e5df25fa9ea582e9ff74a8",
  );
  assert.equal(
    signHostStatus(key, "controller", '{"version":1}'),
    "99640fd10e7147d3e469127fc5b7d8b0e64e1c8bf93e923c04a6df1dc045fa17",
  );
});

test("without the signing secret, requests are refused and reports cannot be verified", async () => {
  const saved = process.env.INTERNAL_PROXY_SECRET;
  process.env.INTERNAL_PROXY_SECRET = "too-short";
  try {
    const r = await call("/actions", {
      requestId: randomUUID(),
      action: "backup_now",
      reason: "Synthetic request without a signing key",
    });
    assert.equal(r.statusCode, 503);
    assert.equal(r.json().code, "HOST_SIGNING_UNAVAILABLE");
    await publish(report(), {
      signature: signHostStatus(
        hostOperationsKey(SECRET)!,
        "controller",
        JSON.stringify(report()),
      ),
    });
    const health = await readHostHealth(db);
    assert.equal(health.controller.state, "signing_unavailable");
  } finally {
    process.env.INTERNAL_PROXY_SECRET = saved;
  }
});

test("platform address validation covers format, coach domains, DNS and passkeys", async () => {
  const saved = process.env.PUBLIC_APP_URL;
  process.env.PUBLIC_APP_URL = "https://app.fixture-platform.test";
  try {
    for (const url of [
      "http://new.fixture-platform.test",
      "https://new.fixture-platform.test/app",
      "https://new.fixture-platform.test:8443",
      "https://203.0.113.10",
      "https://new.fixture-platform.test/",
    ])
      assert.equal(
        (await checkPlatformAddress(db, url, resolver)).valid,
        false,
        url,
      );
    await db.system(async (tx) => {
      await tx.query(
        "INSERT INTO domain_mappings(hostname,tenant_id,verified_at,active) VALUES('coach.fixture-platform.test',$1,now(),true)",
        [operator.tenantId],
      );
      await tx.query(
        "INSERT INTO auth_passkeys(id,user_id,rp_id,credential_id,public_key,counter,device_type,backed_up,label) VALUES($1,$2,'app.fixture-platform.test',$3,'\\x00',0,'singleDevice',false,'Fixture')",
        [randomUUID(), operator.userId, randomUUID()],
      );
    });
    const coach = await checkPlatformAddress(
      db,
      "https://coach.fixture-platform.test",
      resolver,
    );
    assert.equal(coach.valid, false);
    assert.equal(coach.checks.find((c) => c.key === "coach_domain")!.ok, false);
    const elsewhere = await checkPlatformAddress(
      db,
      "https://elsewhere.fixture-platform.test",
      resolver,
    );
    assert.equal(elsewhere.checks.find((c) => c.key === "dns")!.ok, false);
    assert.equal(
      (
        await checkPlatformAddress(
          db,
          "https://missing.fixture-platform.test",
          resolver,
        )
      ).valid,
      false,
    );
    const ok = await app.inject({
      url: "/api/v1/admin/infrastructure/platform-address/check",
      method: "POST",
      payload: { url: "https://app.fixture-platform.test" },
    });
    assert.equal(ok.statusCode, 200, ok.body);
    const body = ok.json();
    assert.equal(body.valid, true);
    const passkeys = body.checks.find((c: any) => c.key === "passkeys");
    assert.equal(passkeys.ok, false);
    assert.match(passkeys.message, /1 passkey is bound/);
    const reapply = body.procedure.find((step: string) =>
      /Re-apply runtime settings/.test(step),
    );
    assert.ok(reapply);
    // The controller does not fall back; the step names the console recovery.
    assert.doesNotMatch(reapply, /restores the previous edge/);
    assert.match(reapply, /nothing is rolled back/);
    assert.match(reapply, /hostops\.py reapply/);
  } finally {
    if (saved === undefined) delete process.env.PUBLIC_APP_URL;
    else process.env.PUBLIC_APP_URL = saved;
  }
});
