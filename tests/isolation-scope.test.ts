// Tenant scope isolation against the database (docs/features/isolation.md):
// actor verification, role/setting changes refused inside a scope (by the db
// package and by the database itself), workspace-bound service transactions
// and the argument checks of the definer helpers that replaced elevation.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import {
  createDatabase,
  elevated,
  putRecord,
  type Actor,
  type Database,
} from "@trainer/db";
import { applyMigrations } from "../packages/db/src/migrations.ts";
import { privateKinds } from "../apps/api/src/privacy-lifecycle.ts";
import { cp, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let db: Database;
const A = randomUUID(),
  B = randomUUID();
const ids = {
  ownerA: randomUUID(),
  staffA: randomUUID(),
  financeA: randomUUID(),
  followerA: randomUUID(),
  followerB: randomUUID(),
  ownerB: randomUUID(),
};
const as = (tenantId: string, userId: string, role: string): Actor => ({
  tenantId,
  userId,
  role,
});
const followerA = as(A, ids.followerA, "subscriber"),
  followerB = as(A, ids.followerB, "subscriber"),
  ownerA = as(A, ids.ownerA, "owner");
// On the PostgreSQL run the service role is already the restricted runtime
// role; on PGlite the session is a superuser, so service-side row security is
// exercised through a non-bypassing fixture role.
const onPostgres = !!process.env.DATABASE_URL;
const fixtureRole = "isolation_fixture_service";
const scopeCode = (code: string) => (e: any) => e?.code === code;

before(async () => {
  db = await createDatabase({ memory: true });
  await db.system(async (tx) => {
    for (const t of [A, B])
      await tx.query(
        "INSERT INTO tenants(id,slug,name) VALUES($1::uuid,$1::text,'Isolation fixture')",
        [t],
      );
    for (const [key, id] of Object.entries(ids))
      await tx.query(
        "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,'fixture')",
        [id, `${id}@isolation.test`, key],
      );
    const members: Array<[string, string, string]> = [
      [A, ids.ownerA, "owner"],
      [A, ids.staffA, "staff"],
      [A, ids.financeA, "finance"],
      [A, ids.followerA, "subscriber"],
      [A, ids.followerB, "subscriber"],
      [B, ids.ownerB, "owner"],
    ];
    for (const [tenant, user, role] of members)
      await tx.query(
        "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)",
        [tenant, user, role],
      );
    for (const [tenant, user] of [
      [A, ids.followerA],
      [A, ids.followerB],
      [B, ids.ownerB],
    ])
      await tx.query(
        "INSERT INTO sessions(token_hash,user_id,tenant_id,expires_at) VALUES($1,$2,$3,now()+interval '1 day')",
        [randomUUID(), user, tenant],
      );
    if (!onPostgres) {
      await tx.query(`CREATE ROLE ${fixtureRole} NOLOGIN NOBYPASSRLS`);
      await tx.query(
        `GRANT SELECT,INSERT,UPDATE,DELETE ON sessions,one_time_tokens,tenants,memberships,users,account_locks TO ${fixtureRole}`,
      );
      await tx.query(`GRANT trainer_app TO ${fixtureRole}`);
      await tx.query(
        `GRANT EXECUTE ON FUNCTION pg_catalog.set_config(text,text,boolean) TO ${fixtureRole}`,
      );
    }
  });
  await db.tenant(elevated("worker", { tenantId: A, role: "owner" }), (tx) =>
    putRecord(
      tx,
      followerB,
      "takeover",
      { reason: "Fixture" },
      {
        ownerId: ids.followerB,
        status: "active",
      },
    ),
  );
});
after(async () => {
  await db?.close();
});

test("a scope is admitted only for the actor's own membership role or an allowlisted service elevation", async () => {
  const refused: Array<[Actor, string]> = [
    [as(A, ids.followerA, "owner"), "ACTOR_ROLE_MISMATCH"],
    [as(A, ids.followerA, "staff"), "ACTOR_ROLE_MISMATCH"],
    [as(A, ids.followerA, "finance"), "ACTOR_ROLE_MISMATCH"],
    [as(A, ids.staffA, "owner"), "ACTOR_ROLE_MISMATCH"],
    [as(A, ids.financeA, "staff"), "ACTOR_ROLE_MISMATCH"],
    [as(A, ids.ownerB, "owner"), "ACTOR_ROLE_MISMATCH"],
    [as(A, randomUUID(), "owner"), "ACTOR_ROLE_MISMATCH"],
    [
      elevated("worker", { tenantId: A, userId: ids.followerA, role: "owner" }),
      "ELEVATION_SUBJECT",
    ],
    [
      { ...as(A, ids.staffA, "owner"), elevation: "unknown" as any },
      "ELEVATION_NOT_ALLOWED",
    ],
    [
      elevated("provider-callback", { tenantId: A, role: "staff" }),
      "ELEVATION_NOT_ALLOWED",
    ],
    [as("not-a-uuid", ids.ownerA, "owner"), "INVALID_ACTOR"],
    [as(A, ids.ownerA, "admin"), "INVALID_ACTOR"],
  ];
  for (const [actor, code] of refused) {
    let ran = false;
    await assert.rejects(
      db.tenant(actor, async () => {
        ran = true;
      }),
      scopeCode(code),
      JSON.stringify(actor),
    );
    assert.equal(ran, false, "no statement runs for a refused actor");
  }
  const admitted: Array<[Actor, string]> = [
    [ownerA, "owner"],
    [as(A, ids.ownerA, "finance"), "finance"],
    [as(A, ids.staffA, "staff"), "staff"],
    [followerA, "subscriber"],
    [as(A, ids.ownerB, "subscriber"), "subscriber"],
    [elevated("worker", { tenantId: A, role: "finance" }), "finance"],
    [
      elevated("platform-operator", {
        tenantId: A,
        userId: ids.staffA,
        role: "owner",
      }),
      "owner",
    ],
  ];
  for (const [actor, role] of admitted) {
    const [row] = await db.tenant(actor, (tx) =>
      tx.query(
        "SELECT current_user AS db_role,current_setting('app.role') AS role,current_setting('app.user_id') AS user_id,current_setting('app.elevation') AS elevation",
      ),
    );
    assert.deepEqual(row, {
      db_role: "trainer_app",
      role,
      user_id: actor.userId,
      elevation: actor.elevation ?? "",
    });
  }
  // A service transaction bound to one workspace scopes only that workspace.
  await assert.rejects(
    db.system((tx) => tx.tenant(as(B, ids.ownerB, "owner"), async () => 1), {
      tenantId: A,
    }),
    scopeCode("SCOPE_TENANT_MISMATCH"),
  );
});

test("statements that would change role or scope settings are refused and leave the scope intact", async () => {
  const attempts = [
    "RESET ROLE",
    "SET ROLE trainer_service",
    "SET LOCAL ROLE postgres",
    "SET SESSION AUTHORIZATION DEFAULT",
    "SET app.tenant_id = '" + B + "'",
    "SELECT set_config('app.tenant_id','" + B + "',true)",
    "SELECT set_config('role','trainer_service',true)",
    "SELECT 1; RESET ROLE",
    "COMMIT",
  ];
  const check = async (tx: any, expected: Record<string, string>) => {
    for (const sql of attempts)
      await assert.rejects(tx.query(sql), scopeCode("SCOPE_SQL_REJECTED"), sql);
    const [row] = await tx.query(
      "SELECT current_user AS db_role,current_setting('app.tenant_id') AS tenant,current_setting('app.user_id') AS user_id,current_setting('app.role') AS role",
    );
    assert.deepEqual(row, expected);
  };
  const expected = {
    db_role: "trainer_app",
    tenant: A,
    user_id: ids.followerA,
    role: "subscriber",
  };
  await db.tenant(followerA, (tx) => check(tx, expected));
  // The same inside a scope entered from a service transaction; the service
  // side itself may not hand-roll a scope or touch it while it is active.
  await db.system(async (tx) => {
    for (const sql of [
      "SET LOCAL ROLE trainer_app",
      "SELECT set_config('app.tenant_id',$1,true)",
      "SELECT set_config('app.role','owner',true)",
      "SET app.user_id = 'x'",
      "RESET ROLE",
      "COMMIT",
    ])
      await assert.rejects(
        tx.query(sql, sql.includes("$1") ? [A] : []),
        scopeCode("SCOPE_SQL_REJECTED"),
        sql,
      );
    await tx.tenant(followerA, async (scoped) => {
      await check(scoped, expected);
      await assert.rejects(tx.query("SELECT 1"), scopeCode("SCOPE_ACTIVE"));
      await assert.rejects(
        tx.tenant(ownerA, async () => 1),
        scopeCode("SCOPE_ACTIVE"),
      );
      // Savepoints could outlive a nested scope: only db.tenant() may use them.
      await assert.rejects(
        scoped.query("SAVEPOINT inner_scope"),
        scopeCode("SCOPE_SQL_REJECTED"),
      );
    });
    const [left] = await tx.query(
      "SELECT current_user<>'trainer_app' AS service,coalesce(current_setting('app.tenant_id',true),'') AS tenant,coalesce(current_setting('app.role',true),'') AS role",
    );
    assert.deepEqual(left, { service: true, tenant: "", role: "" });
  });
});

test("the database itself refuses set_config and pg_settings changes to the tenant role", async () => {
  // A raw connection, without the db package's statement guard.
  const pg = new PGlite();
  try {
    await applyMigrations({
      query: (sql, values) => pg.query(sql, values),
      exec: (sql) => pg.exec(sql),
    });
    const tenant = randomUUID();
    await pg.query("BEGIN");
    await pg.query(
      "SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true),set_config('app.role','subscriber',true)",
      [tenant, randomUUID()],
    );
    await pg.query("SET LOCAL ROLE trainer_app");
    const denied = async (sql: string, values: any[] = []) => {
      await pg.query("SAVEPOINT attempt");
      await assert.rejects(
        pg.query(sql, values),
        (e: any) => e.code === "42501",
        sql,
      );
      await pg.query("ROLLBACK TO SAVEPOINT attempt");
    };
    for (const setting of [
      "app.tenant_id",
      "app.user_id",
      "app.role",
      "app.elevation",
      "app.privacy_erasure",
      "role",
      "session_authorization",
    ])
      await denied("SELECT set_config($1,$2,true)", [setting, "x"]);
    await denied("SELECT pg_catalog.set_config('app.role','owner',false)");
    await denied(
      "UPDATE pg_settings SET setting='owner' WHERE name='app.role'",
    );
    // Global tables stay closed to the tenant role.
    for (const table of [
      "sessions",
      "tenants",
      "one_time_tokens",
      "provider_events",
    ])
      await denied(`SELECT count(*) FROM ${table}`);
    const [scope] = (
      await pg.query<any>(
        "SELECT current_user AS db_role,current_setting('app.tenant_id') AS tenant,current_setting('app.role') AS role",
      )
    ).rows;
    assert.deepEqual(scope, {
      db_role: "trainer_app",
      tenant,
      role: "subscriber",
    });
    await pg.query("ROLLBACK");
    const [grants] = (
      await pg.query<any>(
        "SELECT has_function_privilege('trainer_app','pg_catalog.set_config(text,text,boolean)','EXECUTE') AS tenant_role,EXISTS(SELECT 1 FROM pg_proc p,aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl WHERE p.oid='pg_catalog.set_config(text,text,boolean)'::regprocedure AND acl.grantee=0) AS public_execute",
      )
    ).rows;
    assert.deepEqual(grants, { tenant_role: false, public_execute: false });
  } finally {
    await pg.close();
  }
});

test("an upgraded database keeps set_config for older releases until the tenant-scope step", async () => {
  // Migration 061 revokes set_config only when every migration is applied in
  // the same run (a fresh database). A database an older release has served
  // keeps PUBLIC execute, because that release sets its scope after SET ROLE,
  // until infra/tenant-scope.sql runs (host.py runtime_role).
  const migrations = new URL("../packages/db/migrations/", import.meta.url);
  const older = await mkdtemp(join(tmpdir(), "isolation-upgrade-"));
  const pg = new PGlite();
  const client = {
    query: (sql: string, values?: any[]) => pg.query(sql, values),
    exec: (sql: string) => pg.exec(sql),
  };
  const publicExecute = async () =>
    (
      await pg.query<any>(
        "SELECT EXISTS(SELECT 1 FROM pg_proc p,aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl WHERE p.oid='pg_catalog.set_config(text,text,boolean)'::regprocedure AND acl.grantee=0 AND acl.privilege_type='EXECUTE') AS e",
      )
    ).rows[0].e;
  try {
    for (const file of await readdir(migrations))
      if (file.endsWith(".sql") && file < "061")
        await cp(new URL(file, migrations), join(older, file));
    await applyMigrations(client, older);
    await pg.query(
      "INSERT INTO tenants(id,slug,name) VALUES($1::uuid,$1::text,'Upgrade fixture')",
      [randomUUID()],
    );
    const { applied } = await applyMigrations(client);
    assert.deepEqual(
      applied.filter((v) => v.startsWith("061")),
      ["061_tenant_scope_isolation"],
    );
    assert.equal(await publicExecute(), true, "older releases keep working");
    await pg.exec("CREATE ROLE trainer_service NOLOGIN");
    await pg.exec(
      await readFile(
        new URL("../infra/tenant-scope.sql", import.meta.url),
        "utf8",
      ),
    );
    assert.equal(await publicExecute(), false);
  } finally {
    await pg.close();
    await rm(older, { recursive: true, force: true });
  }
});

test("the personal export's fixed record kinds match the application's list", async () => {
  const [fn] = await db.system((tx) =>
    tx.query<{ src: string }>(
      "SELECT prosrc AS src FROM pg_proc WHERE oid='personal_export_records(uuid)'::regprocedure",
    ),
  );
  const list = /private_kinds text\[\] := ARRAY\[([^\]]*)\]/.exec(fn.src)?.[1];
  assert.ok(list, "the function holds its own list");
  const kinds = [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual([...kinds].sort(), [...privateKinds].sort());
});

test("a service transaction bound to a workspace reads and writes only that workspace's service rows", async () => {
  const service = async <T>(
    fn: (tx: any) => Promise<T>,
    tenantId?: string,
  ): Promise<T> =>
    db.system(
      async (tx) => {
        if (!onPostgres) await tx.query(`SET LOCAL ROLE ${fixtureRole}`);
        return fn(tx);
      },
      tenantId ? { tenantId } : undefined,
    );
  const count = (tx: any, sql: string, values: any[] = []) =>
    tx.query(sql, values).then((rows: any[]) => Number(rows[0].n));
  const unbound = await service(async (tx) => ({
    sessions: await count(
      tx,
      "SELECT count(*) AS n FROM sessions WHERE tenant_id=ANY($1::uuid[])",
      [[A, B]],
    ),
    tenants: await count(
      tx,
      "SELECT count(*) AS n FROM tenants WHERE id=ANY($1::uuid[])",
      [[A, B]],
    ),
  }));
  assert.deepEqual(unbound, { sessions: 3, tenants: 2 });
  const bound = await service(
    async (tx) => ({
      sessions: await count(
        tx,
        "SELECT count(*) AS n FROM sessions WHERE tenant_id=ANY($1::uuid[])",
        [[A, B]],
      ),
      foreignSessions: await count(
        tx,
        "SELECT count(*) AS n FROM sessions WHERE tenant_id=$1",
        [B],
      ),
      tenants: await count(
        tx,
        "SELECT count(*) AS n FROM tenants WHERE id=ANY($1::uuid[])",
        [[A, B]],
      ),
      memberships: await count(
        tx,
        "SELECT count(*) AS n FROM memberships WHERE tenant_id=$1",
        [B],
      ),
      // The tenant scope still works inside the bound transaction.
      scoped: await tx.tenant(ownerA, (scoped: any) =>
        scoped
          .query("SELECT current_setting('app.tenant_id') AS t")
          .then((r: any[]) => r[0].t),
      ),
    }),
    A,
  );
  assert.deepEqual(bound, {
    sessions: 2,
    foreignSessions: 0,
    tenants: 1,
    memberships: 0,
    scoped: A,
  });
  await assert.rejects(
    service(
      (tx) =>
        tx.query(
          "INSERT INTO sessions(token_hash,user_id,tenant_id,expires_at) VALUES($1,$2,$3,now()+interval '1 day')",
          [randomUUID(), ids.ownerB, B],
        ),
      A,
    ),
    /row-level security/,
  );
});

test("a bound service statement without a tenant predicate reaches only its workspace; acrossWorkspaces lifts the binding for one step", async () => {
  const service = <T>(fn: (tx: any) => Promise<T>, tenantId?: string) =>
    db.system(
      async (tx) => {
        if (!onPostgres) await tx.query(`SET LOCAL ROLE ${fixtureRole}`);
        return fn(tx);
      },
      tenantId ? { tenantId } : undefined,
    );
  const probe = { A: randomUUID(), B: randomUUID() };
  await service((tx) =>
    tx.query(
      "INSERT INTO one_time_tokens(token_hash,user_id,tenant_id,purpose,expires_at) VALUES($1,$2,$3,'magic',now()+interval '1 hour'),($4,$5,$6,'magic',now()+interval '1 hour')",
      [probe.A, ids.followerA, A, probe.B, ids.ownerB, B],
    ),
  );
  const seen = await service(async (tx) => {
    // A destructive step that forgot its tenant predicate.
    await tx.query("DELETE FROM one_time_tokens WHERE token_hash=ANY($1)", [
      [probe.A, probe.B],
    ]);
    const count = (t: any) =>
      t
        .query("SELECT count(*)::int AS n FROM memberships WHERE user_id=$1", [
          ids.ownerB,
        ])
        .then((r: any[]) => r[0].n);
    const bound = await count(tx);
    // An account-level check that must see every workspace.
    const across = await tx.acrossWorkspaces((t: any) => count(t));
    const rebound = await count(tx);
    return { bound, across, rebound };
  }, A);
  assert.deepEqual(seen, { bound: 0, across: 1, rebound: 0 });
  const left = await service((tx) =>
    tx.query("SELECT tenant_id FROM one_time_tokens WHERE token_hash=ANY($1)", [
      [probe.A, probe.B],
    ]),
  );
  assert.deepEqual(left, [{ tenant_id: B }]);
  // Scopes do not mix with a lifted binding.
  await assert.rejects(
    service(
      (tx) =>
        tx.tenant(ownerA, () => tx.acrossWorkspaces(async () => undefined)),
      A,
    ),
    scopeCode("SCOPE_ACTIVE"),
  );
});

test("definer helpers validate the caller: a follower reaches only itself and aggregate counts", async () => {
  const denied = (actor: Actor, sql: string, values: any[] = []) =>
    assert.rejects(
      db.tenant(actor, (tx) => tx.query(sql, values)),
      (e: any) => e.code === "42501",
      sql,
    );
  await denied(followerA, "SELECT * FROM membership_exit_blockers($1)", [
    ids.followerB,
  ]);
  await denied(followerA, "SELECT * FROM model_usage_today($1,$2)", [
    ["coaching"],
    ids.followerB,
  ]);
  await denied(followerA, "SELECT * FROM personal_export_records($1)", [
    ids.followerB,
  ]);
  for (const helper of [
    "personal_export_followups",
    "personal_export_usage",
    "personal_export_audit",
    "export_personal_chat_media",
  ])
    await denied(followerA, `SELECT * FROM ${helper}($1)`, [ids.followerB]);
  await denied(
    followerA,
    "SELECT withdraw_accepted_invitation_emails($1,'fixture')",
    [randomUUID()],
  );
  await denied(
    followerA,
    "SELECT enqueue_notification($1,$2,'coaching','fixture','Title','Body','/app','suppressed','{}'::jsonb)",
    [randomUUID(), ids.followerB],
  );
  await denied(ownerA, "SELECT erase_brand_theme_media($1)", [["x"]]);
  await denied(
    followerA,
    "SELECT member_policy_review_append('[]'::jsonb,'[]'::jsonb,5)",
  );
  await assert.rejects(
    db.tenant(followerA, (tx) =>
      tx.query("SELECT * FROM member_material('coaching_scenario')"),
    ),
    (e: any) => e.code === "22023",
  );
  const read = (actor: Actor, sql: string, values: any[] = []) =>
    db.tenant(actor, (tx) => tx.query(sql, values)).then((r) => r[0]);
  // Addressing: another follower is not a permitted recipient; the coaching
  // team is, for a coaching or safety notice.
  assert.equal(
    (
      await read(
        followerA,
        "SELECT permitted,email FROM notification_recipient($1,'coaching',NULL)",
        [ids.followerB],
      )
    ).email,
    null,
  );
  assert.equal(
    (
      await read(
        followerA,
        "SELECT permitted FROM notification_recipient($1,'coaching',NULL)",
        [ids.followerB],
      )
    ).permitted,
    false,
  );
  assert.equal(
    (
      await read(
        followerA,
        "SELECT permitted FROM notification_recipient($1,'coaching',NULL)",
        [ids.ownerA],
      )
    ).permitted,
    true,
  );
  assert.equal(
    (
      await read(followerA, "SELECT workspace_member_role($1) AS r", [
        ids.followerB,
      ])
    ).r,
    null,
  );
  assert.equal(
    (
      await read(followerA, "SELECT workspace_member_role($1) AS r", [
        ids.followerA,
      ])
    ).r,
    "subscriber",
  );
  assert.equal(
    (
      await read(ownerA, "SELECT workspace_member_role($1) AS r", [
        ids.followerB,
      ])
    ).r,
    "subscriber",
  );
  // Takeover state is answered for the caller only.
  assert.equal(
    (await read(followerA, "SELECT member_takeover_active() AS t")).t,
    false,
  );
  assert.equal(
    (await read(followerB, "SELECT member_takeover_active() AS t")).t,
    true,
  );
  // The erasure helper runs only in an erasure scope.
  assert.equal(
    (
      await db.tenant(
        ownerA,
        (tx) =>
          tx.query("SELECT erase_brand_theme_media($1) AS changed", [["x"]]),
        { privacyErasure: true },
      )
    )[0].changed,
    false,
  );
});
