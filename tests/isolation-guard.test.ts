// Unit checks of the db package's scope rules (docs/features/isolation.md):
// the tenant statement guard, the service statement guard and the actor
// decision. No database is needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ELEVATIONS,
  ScopeError,
  actingAs,
  assertScopedSql,
  assertServiceSql,
  elevated,
  scopeDecision,
} from "@trainer/db";

const rejected = (fn: () => unknown, code = "SCOPE_SQL_REJECTED") =>
  assert.throws(fn, (e: any) => e instanceof ScopeError && e.code === code);

test("a tenant scope refuses every role, setting and transaction change", () => {
  for (const sql of [
    "RESET ROLE",
    "reset role",
    "SET ROLE trainer_service",
    "SET LOCAL ROLE postgres",
    'SET ROLE "trainer_migrations"',
    "SET SESSION AUTHORIZATION postgres",
    "RESET SESSION AUTHORIZATION",
    "SET app.tenant_id = '00000000-0000-0000-0000-000000000001'",
    "SET LOCAL app.role TO 'owner'",
    "RESET ALL",
    "RESET app.user_id",
    "SET search_path = evil",
    "SELECT set_config('role','trainer_service',true)",
    "select pg_catalog.set_config('app.tenant_id','x',true)",
    "SELECT \"set_config\"('app.role','owner',true)",
    "SELECT * FROM records WHERE id IN (SELECT set_config('app.user_id',$1,true)::uuid)",
    "WITH x AS (SELECT set_config('app.elevation','worker',true)) SELECT * FROM x",
    "SELECT 1; RESET ROLE",
    "SELECT 1 /* comment */ ; SET ROLE trainer_service",
    "SELECT 'a';SELECT 'b'",
    "COMMIT",
    "ROLLBACK",
    "BEGIN",
    "END",
    "ABORT",
    "START TRANSACTION",
    "DISCARD ALL",
    "PREPARE TRANSACTION 'x'",
    "DO $$ BEGIN PERFORM set_config('role','postgres',true); END $$",
    "CALL anything()",
    "COPY records TO STDOUT",
    "LISTEN anything",
    "CREATE TABLE x(id int)",
    "GRANT ALL ON records TO PUBLIC",
    "SAVEPOINT s",
    "ROLLBACK TO SAVEPOINT s",
    "RELEASE SAVEPOINT s",
    // Unicode escapes spell names the lexer would otherwise not recognise.
    "SELECT U&\"\\0073et_config\"('app.role','owner',true)",
    "SELECT u&\"\\0073et_config\"('app.role','owner',true)",
    'SELECT * FROM U&"records"',
    "SELECT U&'\\0061pp.role' AS name",
    "UPDATE pg_settings SET setting='owner' WHERE name='app.role'",
    "SELECT name FROM pg_catalog.pg_settings",
  ])
    rejected(() => assertScopedSql(sql, false));
  // A db.tenant() transaction is scoped from BEGIN: its savepoints can never
  // predate the scope, so only there may they be used.
  for (const sql of [
    "SAVEPOINT s",
    "ROLLBACK TO SAVEPOINT s",
    "RELEASE SAVEPOINT s",
  ])
    assert.doesNotThrow(() => assertScopedSql(sql, true));
  for (const sql of ["RESET ROLE", "SELECT 1; SELECT 2", "COMMIT"])
    rejected(() => assertScopedSql(sql, true));
});

test("a tenant scope runs ordinary data statements, including text that only mentions the forbidden words", () => {
  for (const sql of [
    "SELECT * FROM records WHERE id=$1",
    "  (SELECT 1)",
    "WITH r AS (SELECT id FROM records) SELECT count(*) FROM r",
    "INSERT INTO records(id,tenant_id,kind,data) VALUES($1,$2,$3,$4) RETURNING *",
    "UPDATE records SET data=data||$2::jsonb WHERE id=$1",
    "DELETE FROM records WHERE id=$1",
    "SELECT 'RESET ROLE; SET ROLE postgres' AS text",
    "SELECT $$set_config('role','x',true)$$ AS text",
    'SELECT "reset role" FROM (SELECT 1 AS "reset role") x',
    "-- RESET ROLE\nSELECT 1",
    "SELECT pg_advisory_xact_lock(hashtext($1))",
    "SELECT current_setting('app.role',true) AS role",
    "SET LOCAL statement_timeout = 5000",
    "SET LOCAL lock_timeout TO 1000",
    "LOCK TABLE records IN SHARE MODE",
    "EXPLAIN SELECT 1",
    "SELECT 1;",
    "SELECT u&1 AS masked FROM (SELECT 3 AS u) x",
    "SELECT E'line\\n' AS text",
  ])
    assert.doesNotThrow(() => assertScopedSql(sql, false), sql);
});

test("a service transaction cannot build a tenant scope by hand or end the transaction", () => {
  for (const sql of [
    "SET LOCAL ROLE trainer_app",
    "SET ROLE TO trainer_app",
    'SET LOCAL ROLE "trainer_app"',
    "SET ROLE = trainer_app",
    "RESET ROLE",
    "SELECT set_config('app.tenant_id',$1,true)",
    "SELECT set_config('app.user_id',$1,true),set_config('app.role','owner',true)",
    "SELECT set_config('app.service_tenant_id',$1,true)",
    "SELECT set_config('role','trainer_app',true)",
    "SELECT set_config($1,$2,true)",
    "SET app.tenant_id = 'x'",
    "SET LOCAL app.elevation TO 'worker'",
    "SET SESSION AUTHORIZATION postgres",
    "RESET ALL",
    "BEGIN",
    "COMMIT",
    "ROLLBACK",
    "START TRANSACTION",
    "DISCARD ALL",
    "DO $$ BEGIN END $$",
    "SELECT 1; COMMIT",
    // A reserved name must not pass as something else.
    "SELECT set_config(U&'app.r\\006fle','owner',true)",
    "SELECT set_config(E'app.r\\x6fle','owner',true)",
    "SELECT set_config('app.'||'role','owner',true)",
    "SELECT set_config('app.role'::text,'owner',true)",
    "SELECT U&\"\\0073et_config\"('app.role','owner',true)",
    "UPDATE pg_settings SET setting='owner' WHERE name='app.role'",
  ])
    rejected(() => assertServiceSql(sql));
  for (const sql of [
    "SELECT * FROM sessions WHERE token_hash=$1",
    "SELECT set_config('app.privacy_erasure','true',true)",
    "ROLLBACK TO SAVEPOINT s",
    "SAVEPOINT s",
    "SET LOCAL ROLE isolation_fixture_service",
    "UPDATE tenants SET name=$2 WHERE id=$1",
  ])
    assert.doesNotThrow(() => assertServiceSql(sql), sql);
});

test("members act only within their membership; elevations are allowlisted service identities", () => {
  const matrix: Array<[string | null, string, boolean]> = [
    ["owner", "owner", true],
    ["owner", "staff", true],
    ["owner", "finance", true],
    ["owner", "subscriber", true],
    ["staff", "staff", true],
    ["staff", "owner", false],
    ["staff", "finance", false],
    ["finance", "finance", true],
    ["finance", "owner", false],
    ["finance", "staff", false],
    ["subscriber", "subscriber", true],
    ["subscriber", "owner", false],
    ["subscriber", "staff", false],
    ["subscriber", "finance", false],
    [null, "subscriber", true],
    [null, "owner", false],
    [null, "staff", false],
    [null, "finance", false],
  ];
  for (const [member, role, allowed] of matrix)
    if (allowed) assert.doesNotThrow(() => scopeDecision({ role }, member));
    else
      assert.throws(
        () => scopeDecision({ role }, member),
        (e: any) => e.code === "ACTOR_ROLE_MISMATCH" && e.statusCode === 403,
        `${member} as ${role}`,
      );
  // An elevated scope never carries a follower's identity.
  assert.throws(
    () => scopeDecision({ role: "owner", elevation: "worker" }, "subscriber"),
    (e: any) => e.code === "ELEVATION_SUBJECT",
  );
  assert.throws(
    () =>
      scopeDecision({ role: "staff", elevation: "provider-callback" }, null),
    (e: any) => e.code === "ELEVATION_NOT_ALLOWED",
  );
  assert.throws(
    () => scopeDecision({ role: "owner", elevation: "anything" }, null),
    (e: any) => e.code === "ELEVATION_NOT_ALLOWED",
  );
  assert.throws(
    () => scopeDecision({ role: "subscriber", elevation: "worker" }, null),
    (e: any) => e.code === "ELEVATION_NOT_ALLOWED",
  );
  for (const [reason, rule] of Object.entries(ELEVATIONS))
    for (const role of rule.roles)
      assert.doesNotThrow(() =>
        scopeDecision({ role, elevation: reason }, null),
      );
});

test("actingAs never elevates a follower and keeps the acting user", () => {
  const tenantId = "00000000-0000-4000-8000-000000000001",
    userId = "00000000-0000-4000-8000-000000000002";
  const follower = { tenantId, userId, role: "subscriber" };
  assert.deepEqual(
    actingAs(follower, "owner", "coach-workflow"),
    follower,
    "a follower keeps its own scope",
  );
  assert.deepEqual(
    actingAs({ ...follower, role: "owner" }, "owner", "coach-workflow"),
    {
      ...follower,
      role: "owner",
    },
  );
  assert.deepEqual(
    actingAs({ ...follower, role: "staff" }, "owner", "coach-workflow"),
    {
      ...follower,
      role: "owner",
      elevation: "coach-workflow",
    },
  );
  const worker = elevated("worker", { tenantId, role: "owner" });
  assert.equal(worker.userId, "00000000-0000-0000-0000-000000000000");
  assert.deepEqual(actingAs(worker, "finance", "coach-workflow"), {
    ...worker,
    role: "finance",
  });
});
