import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { createDatabase, type Database } from "@trainer/db";
import {
  createInfrastructureObserver,
  persistInfrastructureObservation,
  registerInfrastructureObserver,
  type InfrastructureObservationInput,
} from "../apps/api/src/infrastructure-observer.ts";

let db: Database;
const app = Fastify();
const operator = {
  userId: randomUUID(),
  tenantId: randomUUID(),
  role: "owner",
};
const anotherTenant = randomUUID(),
  closedTenant = randomUUID();
let reporter: ReturnType<typeof registerInfrastructureObserver>;
before(async () => {
  db = await createDatabase({ memory: true });
  await db.system(async (tx) => {
    await tx.query(
      "INSERT INTO users(id,email,name,password_hash,platform_role) VALUES($1,'observer@example.test','Operator','unused','admin')",
      [operator.userId],
    );
    for (const id of [operator.tenantId, anotherTenant, closedTenant])
      await tx.query(
        "INSERT INTO tenants(id,slug,name,lifecycle_state) VALUES($1::uuid,$1::text,'Fixture',$2)",
        [id, id === closedTenant ? "closed" : "active"],
      );
    await tx.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')",
      [operator.tenantId, operator.userId],
    );
  });
  app.setErrorHandler((e: any, _req, reply) =>
    reply
      .code(e.statusCode ?? (e.name === "ZodError" ? 400 : 500))
      .send({ code: e.code, message: e.message }),
  );
  reporter = registerInfrastructureObserver(
    app,
    db,
    (req) => {
      if (req.headers["x-anonymous"])
        throw Object.assign(new Error("Please sign in"), { statusCode: 401 });
      return {
        ...operator,
        platformRole: String(req.headers["x-role"] ?? "admin"),
        mfaAt: String(req.headers["x-mfa"] ?? new Date().toISOString()),
      };
    },
    { startCollector: false, postgres: false },
  );
  app.get("/fixture/ok", async () => ({ ok: true }));
  app.get("/fixture/error", async (_req, reply) =>
    reply.code(503).send({ message: "Fixture failure" }),
  );
});
after(async () => {
  await app.close();
  await db.close();
});
const request = (
  path = "",
  body?: Record<string, unknown>,
  headers: Record<string, string> = {},
) =>
  app.inject({
    url: "/api/v1/admin/infrastructure" + path,
    method: body ? "POST" : "GET",
    payload: body,
    headers,
  });
const state = async () => {
  const response = await request();
  assert.equal(response.statusCode, 200, response.body);
  return response.json();
};
let clock = 0;
function sample(
  service: "api" | "worker",
  measurements: InfrastructureObservationInput["measurements"],
  end?: string,
): InfrastructureObservationInput {
  clock = Math.max(clock + 1, Date.now());
  const ended = end ?? new Date(clock).toISOString();
  return {
    service,
    collectorId: randomUUID(),
    sequence: 1,
    windowStartedAt: new Date(Date.parse(ended) - 60000).toISOString(),
    windowEndedAt: ended,
    measurements,
  };
}
const value = (n: number) => ({ state: "measured" as const, value: n });
const lifecycleBody = (row: any, requestId = randomUUID()) => ({
  requestId,
  revision: row.revision,
  evidenceId: row.latest_observation_id,
  policyRevision: row.policy_revision,
});
async function recommendation(rule: string, service = "api") {
  return (await state()).recommendations.find(
    (r: any) =>
      r.rule === rule && r.service === service && r.status !== "resolved",
  );
}

test("platform scope and recent valid MFA protect every observer route; no measurement ingestion exists", async () => {
  for (const role of ["none", "finance", "support", "safety"])
    assert.equal(
      (await request("", undefined, { "x-role": role })).statusCode,
      403,
    );
  assert.equal(
    (await request("", undefined, { "x-anonymous": "yes" })).statusCode,
    401,
  );
  for (const mfa of [
    "invalid",
    new Date(Date.now() - 700000).toISOString(),
    new Date(Date.now() + 60000).toISOString(),
  ])
    assert.equal(
      (await request("", undefined, { "x-mfa": mfa })).statusCode,
      403,
    );
  assert.equal(
    (
      await request("/observations", {
        service: "worker",
        measurements: { fake: "healthy" },
      })
    ).statusCode,
    404,
  );
  const result = await state();
  assert.equal(result.mode, "observe_only");
  assert.equal(result.executionEnabled, false);
  assert.ok(result.services.every((s: any) => s.state === "unavailable"));
  assert.ok(
    result.unavailableSources.some((s: any) => s.source.includes("spend")),
  );
  await assert.rejects(
    db.tenant(operator, (tx) =>
      tx.query("SELECT * FROM infrastructure_observations"),
    ),
    /permission denied/,
  );
  await assert.rejects(
    db.tenant(operator, (tx) =>
      tx.query("SELECT * FROM infrastructure_policies"),
    ),
    /permission denied/,
  );
  await assert.rejects(
    db.tenant(operator, (tx) =>
      tx.query("SELECT * FROM infrastructure_recommendations"),
    ),
    /permission denied/,
  );
});

test("actual API hooks persist bounded request metrics and scoped aggregate queue measurements without payloads", async () => {
  for (const [tenantId, status, available, lease] of [
    [operator.tenantId, "pending", "-10 minutes", null],
    [anotherTenant, "pending", "-5 minutes", "-1 minute"],
    [operator.tenantId, "pending", "+1 hour", null],
    [operator.tenantId, "pending", "-1 hour", "+5 minutes"],
    [anotherTenant, "failed", "-1 hour", null],
    [anotherTenant, "blocked", "-1 hour", null],
    [closedTenant, "pending", "-2 hours", null],
  ] as const)
    await db.tenant({ ...operator, tenantId }, (tx) =>
      tx.query(
          "INSERT INTO jobs(id,tenant_id,kind,intent_key,data,status,available_at,leased_until,last_error) VALUES($1::uuid,$2,'fixture',$1::text,$3,$4,now()+$5::interval,CASE WHEN $6::text IS NULL THEN NULL ELSE now()+$6::interval END,'private-error-text')",
        [
          randomUUID(),
          tenantId,
          JSON.stringify({
            medical: "PRIVATE-HEALTH-PAYLOAD",
            recipient: "private@example.test",
          }),
          status,
          available,
          lease,
        ],
      ),
    );
  await reporter.capture();
  await app.inject({ url: "/fixture/ok" });
  await app.inject({ url: "/fixture/error" });
  const row = await reporter.capture();
  assert.equal(row.measurements.api_requests?.value, 2);
  assert.equal(row.measurements.api_errors?.value, 1);
  assert.equal(row.measurements.api_error_percent?.value, 50);
  assert.ok((row.measurements.api_p95_ms?.value ?? -1) >= 0);
  assert.equal(row.measurements.queue_ready_count?.value, 2);
  assert.equal(row.measurements.queue_pending_count?.value, 4);
  assert.equal(row.measurements.queue_leased_count?.value, 1);
  assert.equal(row.measurements.queue_failed_count?.value, 2);
  assert.equal(row.measurements.queue_tenants_observed?.value, 2);
  assert.ok((row.measurements.queue_oldest_ready_seconds?.value ?? 0) >= 600);
  assert.equal(row.measurements.database_probe_ms?.state, "measured");
  assert.equal(row.measurements.database_connections?.state, "unavailable");
  assert.equal(
    row.measurements.database_connections?.reason,
    "embedded_database",
  );
  assert.doesNotMatch(
    JSON.stringify(row),
    /PRIVATE-HEALTH|private@example|private-error|recipient|medical/,
  );
  const evidence = await request(`/observations/${row.id}`);
  assert.equal(evidence.statusCode, 200);
  assert.equal(evidence.json().id, row.id);
});

test("observations are immutable, retry-safe, source-checked and reject arbitrary metrics", async () => {
  const input = sample("api", {
    api_requests: value(100),
    api_p95_ms: value(100),
  });
  const first = await persistInfrastructureObservation(db, input);
  const second = await persistInfrastructureObservation(db, input);
  assert.equal(first.id, second.id);
  await assert.rejects(
    persistInfrastructureObservation(db, {
      ...input,
      measurements: { api_requests: value(999) },
    }),
    /already identifies/,
  );
  await assert.rejects(
    persistInfrastructureObservation(db, {
      ...input,
      measurements: { secret: "do-not-store" },
    } as any),
    /Unrecognized key/,
  );
  await assert.rejects(
    persistInfrastructureObservation(
      db,
      sample("worker", { api_requests: value(1) }),
    ),
    /Measurement source/,
  );
  await assert.rejects(
    db.system((tx) =>
      tx.query(
        "UPDATE infrastructure_observations SET measurements='{}' WHERE id=$1",
        [first.id],
      ),
    ),
    /immutable/,
  );
  const rows = await db.system((tx) =>
    tx.query(
      "SELECT id FROM infrastructure_observations WHERE collector_id=$1",
      [input.collectorId],
    ),
  );
  assert.equal(rows.length, 1);
});

test("threshold changes use bounded strict schemas, immutable versions, CAS and durable idempotency", async () => {
  const prior = (await state()).policy;
  const body = {
    requestId: randomUUID(),
    revision: prior.revision,
    reasonCode: "baseline_tuning",
    thresholds: { ...prior.thresholds, apiP95Ms: 900 },
  };
  assert.equal(
    (
      await request("/policy", {
        ...body,
        thresholds: { ...body.thresholds, freshnessSeconds: 0 },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (await request("/policy", { ...body, executionEnabled: true })).statusCode,
    400,
  );
  assert.equal(
    (await request("/policy", body, { "x-role": "support" })).statusCode,
    403,
  );
  const changed = await request("/policy", body);
  assert.equal(changed.statusCode, 200, changed.body);
  assert.equal(changed.json().revision, prior.revision + 1);
  assert.deepEqual((await request("/policy", body)).json(), changed.json());
  assert.equal(
    (await request("/policy", { ...body, requestId: randomUUID() })).statusCode,
    409,
  );
  assert.equal(
    (await request("/policy", { ...body, reasonCode: "incident_review" }))
      .statusCode,
    409,
  );
  const history = (await request("/policies")).json();
  assert.equal(history.length, 2);
  assert.equal(history[1].thresholds.apiP95Ms, 1500);
  await assert.rejects(
    db.system((tx) =>
      tx.query(
        "UPDATE infrastructure_policies SET thresholds='{}' WHERE revision=1",
      ),
    ),
    /immutable/,
  );
});

test("recommendation lifecycle is deduplicated and cannot resolve a breach or mismatched evidence", async () => {
  const high = sample("api", {
    api_requests: value(100),
    api_p95_ms: value(5000),
  });
  await persistInfrastructureObservation(db, high);
  await persistInfrastructureObservation(db, high);
  let row = await recommendation("api_p95_ms");
  assert.ok(row);
  assert.equal(row.measured_value, 5000);
  const ackBody = lifecycleBody(row);
  const ack = await request(`/recommendations/${row.id}/acknowledge`, ackBody);
  assert.equal(ack.statusCode, 200, ack.body);
  assert.equal(ack.json().status, "acknowledged");
  assert.deepEqual(
    (await request(`/recommendations/${row.id}/acknowledge`, ackBody)).json(),
    ack.json(),
  );
  const audits = await db.system((tx) =>
    tx.query("SELECT id FROM admin_operations_audit WHERE id=$1", [
      ackBody.requestId,
    ]),
  );
  assert.equal(audits.length, 1);
  row = await recommendation("api_p95_ms");
  assert.equal(
    (
      await request(`/recommendations/${row.id}/resolve`, lifecycleBody(row))
    ).json().code,
    "FRESH_RECOVERY_REQUIRED",
  );
  assert.equal(
    (
      await request(`/recommendations/${row.id}/resolve`, {
        ...lifecycleBody(row),
        evidenceId: randomUUID(),
      })
    ).statusCode,
    409,
  );
  const oldBody = lifecycleBody(row);
  await persistInfrastructureObservation(
    db,
    sample("api", { api_requests: value(100), api_p95_ms: value(100) }),
  );
  row = await recommendation("api_p95_ms");
  assert.equal(row.canResolve, true);
  assert.equal(
    (await request(`/recommendations/${row.id}/resolve`, oldBody)).statusCode,
    409,
  );
  const resolveBody = lifecycleBody(row),
    resolved = await request(`/recommendations/${row.id}/resolve`, resolveBody);
  assert.equal(resolved.statusCode, 200, resolved.body);
  assert.equal(resolved.json().status, "resolved");
  assert.deepEqual(
    (await request(`/recommendations/${row.id}/resolve`, resolveBody)).json(),
    resolved.json(),
  );
  await persistInfrastructureObservation(
    db,
    sample("api", { api_requests: value(100), api_p95_ms: value(5000) }),
  );
  const nextIncident = await recommendation("api_p95_ms");
  assert.notEqual(nextIncident.id, row.id);
  const all = (await state()).recommendations.filter(
    (r: any) => r.rule === "api_p95_ms",
  );
  assert.equal(all.length, 2);
});

test("stale worker evidence cannot claim health; fresh recovery is required and linked", async () => {
  const stale = sample(
    "worker",
    { process_rss_mb: value(10), worker_cycles: value(1) },
    new Date(Date.now() - 600000).toISOString(),
  );
  const historical = await persistInfrastructureObservation(db, stale);
  let row = await recommendation("stale", "worker");
  assert.equal(row.latest_observation_id, historical.id);
  assert.equal(
    (await state()).services.find((s: any) => s.service === "worker").state,
    "stale",
  );
  const result = await request(
    `/recommendations/${row.id}/resolve`,
    lifecycleBody(row),
  );
  assert.equal(result.json().code, "FRESH_RECOVERY_REQUIRED");
  const worker = createInfrastructureObserver(db, "worker");
  worker.recordCycle(20, true);
  worker.recordCycle(30, false);
  const fresh = await worker.capture();
  assert.equal(fresh.measurements.worker_cycles?.value, 2);
  assert.equal(fresh.measurements.worker_failed_cycles?.value, 1);
  row = await recommendation("stale", "worker");
  assert.equal(row.canResolve, true);
  assert.equal(row.latest_observation_id, fresh.id);
  assert.equal(
    (await request(`/recommendations/${row.id}/resolve`, lifecycleBody(row)))
      .statusCode,
    200,
  );
  assert.ok(await recommendation("worker_failed_cycles", "worker"));
});

test("partial, unavailable and insufficient-sample observations never establish recovery", async () => {
  await persistInfrastructureObservation(
    db,
    sample("api", {
      queue_ready_count: value(500),
      api_requests: value(100),
      api_p95_ms: value(5000),
    }),
  );
  let row = await recommendation("queue_ready_count");
  assert.ok(row);
  await persistInfrastructureObservation(
    db,
    sample("api", {
      queue_ready_count: {
        state: "partial",
        value: 0,
        reason: "partial_coverage",
      },
      api_requests: value(2),
      api_p95_ms: value(1),
    }),
  );
  row = await recommendation("queue_ready_count");
  assert.equal(row.canResolve, false);
  assert.equal(
    (
      await request(`/recommendations/${row.id}/resolve`, lifecycleBody(row))
    ).json().code,
    "FRESH_RECOVERY_REQUIRED",
  );
  assert.equal((await recommendation("api_p95_ms")).canResolve, false);
  await persistInfrastructureObservation(
    db,
    sample("api", {
      queue_ready_count: {
        state: "unavailable",
        value: null,
        reason: "query_failed",
      },
    }),
  );
  assert.equal((await recommendation("queue_ready_count")).canResolve, false);
});

test("latency collection is bounded and exact process counters remain separate from the retained sample", async () => {
  const local = createInfrastructureObserver(db, "api", { postgres: false });
  for (let i = 0; i < 3000; i++)
    local.recordRequest(i, i % 10 === 0 ? 503 : 200);
  const snapshot = await local.capture();
  assert.equal(snapshot.measurements.api_requests?.value, 3000);
  assert.equal(snapshot.measurements.api_request_samples?.value, 2048);
  assert.equal(snapshot.measurements.api_errors?.value, 300);
  assert.equal(snapshot.measurements.api_error_percent?.value, 10);
  assert.ok((snapshot.measurements.api_p95_ms?.value ?? 0) > 2800);
  const empty = await local.capture();
  assert.equal(empty.measurements.api_error_percent?.state, "unavailable");
  assert.equal(empty.measurements.api_p95_ms?.state, "unavailable");
});

test("all attempted infrastructure execution is denied and audited without storing the requested payload", async () => {
  const beforeJobs = await db.tenant(operator, (tx) =>
    tx.query("SELECT id,status,attempts FROM jobs ORDER BY id"),
  );
  for (const action of [
    "scale_node_pool",
    "restart_deployment",
    "delete_database",
    "change_dns",
  ]) {
    const result = await request(`/actions/${action}`, {
      action,
      desired_min: 2,
      projected_monthly_delta_aed: 100,
      approved: true,
      providerSecret: "DO-NOT-RETAIN",
    });
    assert.equal(result.statusCode, 403);
    assert.equal(result.json().code, "INFRASTRUCTURE_OBSERVE_ONLY");
  }
  const afterJobs = await db.tenant(operator, (tx) =>
    tx.query("SELECT id,status,attempts FROM jobs ORDER BY id"),
  );
  assert.deepEqual(afterJobs, beforeJobs);
  const denials = await db.system((tx) =>
    tx.query(
      "SELECT data FROM admin_operations_audit WHERE action='infrastructure.execution.denied'",
    ),
  );
  assert.equal(denials.length, 4);
  assert.ok(denials.every((d) => d.data.code === "OBSERVE_ONLY"));
  assert.doesNotMatch(
    JSON.stringify(denials),
    /DO-NOT-RETAIN|providerSecret|desired_min/,
  );
});
