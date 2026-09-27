import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import {
  createDatabase,
  applyMigrations,
  assertRuntimeRoles,
  verifyMigrations,
  type Actor,
  type Database,
} from "@trainer/db";
import { payoutTransitions } from "@trainer/domain";
import { transitionPayout } from "../apps/api/src/finance.ts";

let db: Database;
const owner: Actor = {
  tenantId: randomUUID(),
  userId: randomUUID(),
  role: "owner",
};
const subscriber: Actor = {
  ...owner,
  userId: randomUUID(),
  role: "subscriber",
};
const foreign: Actor = {
  tenantId: randomUUID(),
  userId: randomUUID(),
  role: "owner",
};
const ownHost = "own-" + randomUUID().slice(0, 8) + ".fixture.test",
  foreignHost = "foreign-" + randomUUID().slice(0, 8) + ".fixture.test";
const embedded = !process.env.DATABASE_URL;

function local(pg: PGlite) {
  return {
    query: (sql: string, values?: any[]) => pg.query(sql, values),
    exec: (sql: string) => pg.exec(sql),
  };
}
const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const base =
  "CREATE TABLE schema_migrations(version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now(), checksum text);\nINSERT INTO schema_migrations(version) VALUES('001_base');\n";

before(async () => {
  db = await createDatabase({ memory: true });
  await db.system(async (tx) => {
    for (const a of [owner, subscriber, foreign])
      await tx.query(
        "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Integrity fixture','not-a-real-login')",
        [a.userId, a.userId + "@example.test"],
      );
    for (const a of [owner, foreign])
      await tx.query(
        "INSERT INTO tenants(id,slug,name,published) VALUES($1,$2,'Integrity fixture',true)",
        [a.tenantId, "integrity-" + a.tenantId],
      );
    for (const a of [owner, subscriber, foreign])
      await tx.query(
        "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)",
        [a.tenantId, a.userId, a.role],
      );
    await tx.query(
      "INSERT INTO domain_mappings(hostname,tenant_id,active,verified_at) VALUES($1,$2,true,now()),($3,$4,true,now())",
      [ownHost, owner.tenantId, foreignHost, foreign.tenantId],
    );
  });
  await db.tenant(owner, (tx) =>
    tx.query(
      "INSERT INTO subscriptions(id,tenant_id,user_id,status) VALUES($1,$2,$3,'active')",
      [randomUUID(), owner.tenantId, subscriber.userId],
    ),
  );
});
after(async () => db?.close());

test("tenant actors cannot read, reassign, create or delete another workspace's domain mappings", async () => {
  assert.deepEqual(
    await db.tenant(foreign, (tx) =>
      tx.query("SELECT hostname FROM domain_mappings ORDER BY hostname"),
    ),
    [{ hostname: foreignHost }],
  );
  await assert.rejects(
    db.tenant(foreign, (tx) =>
      tx.query(
        "UPDATE domain_mappings SET tenant_id=$1 WHERE hostname=$2 RETURNING hostname",
        [foreign.tenantId, ownHost],
      ),
    ),
    { code: "42501" },
  );
  assert.deepEqual(
    await db.tenant(foreign, (tx) =>
      tx.query(
        "UPDATE domain_mappings SET active=false WHERE hostname=$1 RETURNING hostname",
        [ownHost],
      ),
    ),
    [],
  );
  await assert.rejects(
    db.tenant(foreign, (tx) =>
      tx.query("DELETE FROM domain_mappings WHERE hostname=$1", [ownHost]),
    ),
    { code: "42501" },
  );
  await assert.rejects(
    db.tenant(foreign, (tx) =>
      tx.query(
        "INSERT INTO domain_mappings(hostname,tenant_id,active,verified_at) VALUES($1,$2,true,now())",
        ["claimed-" + ownHost, foreign.tenantId],
      ),
    ),
    { code: "42501" },
  );
  // Only an owner disconnects, and a tenant cannot re-activate without review.
  assert.deepEqual(
    await db.tenant(subscriber, (tx) =>
      tx.query(
        "UPDATE domain_mappings SET active=false WHERE hostname=$1 RETURNING hostname",
        [ownHost],
      ),
    ),
    [],
  );
  const [mapping] = await db.system((tx) =>
    tx.query("SELECT tenant_id,active FROM domain_mappings WHERE hostname=$1", [
      ownHost,
    ]),
  );
  assert.deepEqual(mapping, { tenant_id: owner.tenantId, active: true });
  assert.deepEqual(
    await db.tenant(foreign, (tx) =>
      tx.query(
        "UPDATE domain_mappings SET active=false WHERE hostname=$1 AND tenant_id=$2 RETURNING hostname",
        [foreignHost, foreign.tenantId],
      ),
    ),
    [{ hostname: foreignHost }],
  );
  await assert.rejects(
    db.tenant(foreign, (tx) =>
      tx.query("UPDATE domain_mappings SET active=true WHERE hostname=$1", [
        foreignHost,
      ]),
    ),
    { code: "42501" },
  );
  // Administrator activation still transfers an inactive hostname through a
  // non-bypassing service role under forced RLS.
  const role = embedded ? "domain_fixture_service" : "trainer_service";
  if (embedded)
    await db.system(async (tx) => {
      await tx.query(
        "CREATE ROLE domain_fixture_service NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT",
      );
      await tx.query("GRANT trainer_app TO domain_fixture_service");
      await tx.query(
        "GRANT SELECT,INSERT,UPDATE,DELETE ON domain_mappings TO domain_fixture_service",
      );
    });
  const hostname = "transfer-" + randomUUID().slice(0, 8) + ".fixture.test";
  await db.system(async (tx) => {
    await tx.query(`SET LOCAL ROLE ${role}`);
    await tx.query(
      "INSERT INTO domain_mappings(hostname,tenant_id,verified_at,active) VALUES($1,$2,now(),false)",
      [hostname, owner.tenantId],
    );
    await tx.query(
      "INSERT INTO domain_mappings(hostname,tenant_id,verified_at,active) VALUES($1,$2,now(),true) ON CONFLICT(hostname) DO UPDATE SET tenant_id=EXCLUDED.tenant_id,verified_at=now(),active=true",
      [hostname, foreign.tenantId],
    );
  });
  const [moved] = await db.system((tx) =>
    tx.query("SELECT tenant_id,active FROM domain_mappings WHERE hostname=$1", [
      hostname,
    ]),
  );
  assert.deepEqual(moved, { tenant_id: foreign.tenantId, active: true });
});

test("prepared payouts keep amount, destination and period and follow the transition graph", async () => {
  const id = randomUUID();
  await db.tenant(owner, (tx) =>
    tx.query(
      "INSERT INTO payouts(id,tenant_id,period,amount_minor,beneficiary_id) VALUES($1,$2,'2041-01',5000,'fixture-destination')",
      [id, owner.tenantId],
    ),
  );
  for (const sql of [
    "UPDATE payouts SET amount_minor=1 WHERE id=$1",
    "UPDATE payouts SET beneficiary_id='attacker-destination' WHERE id=$1",
    "UPDATE payouts SET period='2041-02' WHERE id=$1",
    "UPDATE payouts SET revision=2 WHERE id=$1",
    "UPDATE payouts SET status='paid' WHERE id=$1",
    "UPDATE payouts SET bank_reference='forged-reference' WHERE id=$1",
    "DELETE FROM payouts WHERE id=$1",
  ])
    await assert.rejects(
      db.tenant(owner, (tx) => tx.query(sql, [id])),
      sql,
    );
  await db.tenant(owner, async (tx) => {
    await transitionPayout(tx, owner, id, "submitted");
    await tx.query("UPDATE payouts SET provider_id='pay_fixture' WHERE id=$1", [
      id,
    ]);
    await transitionPayout(tx, owner, id, "processing");
  });
  await assert.rejects(
    db.tenant(owner, (tx) =>
      tx.query("UPDATE payouts SET provider_id='pay_other' WHERE id=$1", [id]),
    ),
    /provider reference/,
  );
  await db.tenant(owner, (tx) =>
    transitionPayout(tx, owner, id, "paid", "bank-reference-1"),
  );
  await assert.rejects(
    db.tenant(owner, (tx) =>
      tx.query("UPDATE payouts SET status='ready' WHERE id=$1", [id]),
    ),
    /invalid payout transition paid to ready/,
  );
  const returned = await db.tenant(owner, (tx) =>
    transitionPayout(tx, owner, id, "returned", "return-reference-1"),
  );
  assert.equal(returned.status, "returned");
  assert.equal(returned.bank_reference, "return-reference-1");
  assert.equal(Number(returned.amount_minor), 5000);
});

test("database payout transitions match the domain transition graph", async () => {
  const statuses = Object.keys(payoutTransitions);
  const outcomes = await db.tenant(owner, async (tx) => {
    const result: Record<string, string[]> = {};
    for (const from of statuses) {
      const id = randomUUID();
      await tx.query(
        "INSERT INTO payouts(id,tenant_id,period,amount_minor,beneficiary_id,status) VALUES($1,$2,$3,100,'fixture-destination',$4)",
        [id, owner.tenantId, "graph-" + from, from],
      );
      result[from] = [];
      for (const to of statuses) {
        if (to === from) continue;
        await tx.query("SAVEPOINT transition");
        try {
          await tx.query("UPDATE payouts SET status=$2 WHERE id=$1", [id, to]);
          result[from].push(to);
        } catch (error) {
          assert.match(String(error), /invalid payout transition/);
        }
        await tx.query("ROLLBACK TO SAVEPOINT transition");
      }
    }
    return result;
  });
  const sorted = (graph: Record<string, string[]>) =>
    Object.fromEntries(
      Object.entries(graph).map(([from, to]) => [from, [...to].sort()]),
    );
  assert.deepEqual(sorted(outcomes), sorted(payoutTransitions));
});

test("tenant actors cannot delete or re-key subscriptions", async () => {
  await assert.rejects(
    db.tenant(owner, (tx) =>
      tx.query("UPDATE subscriptions SET user_id=$1 WHERE user_id=$2", [
        owner.userId,
        subscriber.userId,
      ]),
    ),
    /subscription identity is immutable/,
  );
  await assert.rejects(
    db.tenant(owner, (tx) =>
      tx.query("DELETE FROM subscriptions WHERE user_id=$1", [
        subscriber.userId,
      ]),
    ),
    { code: "42501" },
  );
  const [mirrored] = await db.tenant(owner, (tx) =>
    tx.query(
      "UPDATE subscriptions SET status='past_due',cancel_at_period_end=true WHERE user_id=$1 RETURNING status",
      [subscriber.userId],
    ),
  );
  assert.equal(mirrored.status, "past_due");
});

test("migrations normalize trainer_app and runtime checks reject any role that bypasses RLS", async () => {
  const pg = new PGlite();
  try {
    await pg.exec("CREATE ROLE trainer_app NOLOGIN BYPASSRLS");
    await applyMigrations(local(pg));
    const { rows } = await pg.query<{ rolbypassrls: boolean }>(
      "SELECT rolbypassrls FROM pg_roles WHERE rolname='trainer_app'",
    );
    assert.equal(rows[0].rolbypassrls, false);
    await pg.exec(
      "CREATE ROLE runtime_fixture NOLOGIN NOINHERIT; GRANT trainer_app TO runtime_fixture; ALTER ROLE trainer_app BYPASSRLS;",
    );
    const asRuntime = async () => {
      await pg.exec("BEGIN; SET LOCAL ROLE runtime_fixture;");
      try {
        await assertRuntimeRoles(local(pg));
      } finally {
        await pg.exec("ROLLBACK;");
      }
    };
    await assert.rejects(asRuntime(), /must not bypass RLS: trainer_app/);
    await pg.exec("ALTER ROLE trainer_app NOBYPASSRLS;");
    await asRuntime();
  } finally {
    await pg.close();
  }
});

test("a failing pending migration rolls back every file of the same run", async () => {
  const directory = await mkdtemp(join(tmpdir(), "trainer-migrations-"));
  const pg = new PGlite();
  try {
    await writeFile(join(directory, "001_base.sql"), base);
    assert.deepEqual((await applyMigrations(local(pg), directory)).applied, [
      "001_base",
    ]);
    await writeFile(
      join(directory, "900_ok.sql"),
      "CREATE TABLE m3_probe(id int);\nINSERT INTO schema_migrations(version) VALUES('900_ok');\n",
    );
    await writeFile(join(directory, "901_bad.sql"), "SELECT 1/0;\n");
    await assert.rejects(
      applyMigrations(local(pg), directory),
      /division by zero/,
    );
    const { rows } = await pg.query<{
      probe: string | null;
      versions: string[];
    }>(
      "SELECT to_regclass('public.m3_probe')::text AS probe,(SELECT array_agg(version ORDER BY version) FROM schema_migrations) AS versions",
    );
    assert.deepEqual(rows[0], { probe: null, versions: ["001_base"] });
  } finally {
    await pg.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("migration checksums are recorded, backfilled for legacy rows and reject edited files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "trainer-migrations-"));
  const pg = new PGlite();
  const probe =
    "CREATE TABLE checksum_probe(id int);\nINSERT INTO schema_migrations(version) VALUES('002_probe');\n";
  try {
    await writeFile(join(directory, "001_base.sql"), base);
    await writeFile(join(directory, "002_probe.sql"), probe);
    // A file without its own version row is still recorded exactly once.
    await writeFile(join(directory, "003_unrecorded.sql"), "SELECT 1;\n");
    assert.deepEqual((await applyMigrations(local(pg), directory)).applied, [
      "001_base",
      "002_probe",
      "003_unrecorded",
    ]);
    const recorded = async () =>
      (
        await pg.query<{ version: string; checksum: string | null }>(
          "SELECT version,checksum FROM schema_migrations ORDER BY version",
        )
      ).rows;
    assert.deepEqual(await recorded(), [
      { version: "001_base", checksum: sha256(base) },
      { version: "002_probe", checksum: sha256(probe) },
      { version: "003_unrecorded", checksum: sha256("SELECT 1;\n") },
    ]);
    assert.deepEqual(await applyMigrations(local(pg), directory), {
      applied: [],
      recorded: [],
    });
    await pg.query(
      "UPDATE schema_migrations SET checksum=NULL WHERE version='002_probe'",
    );
    assert.deepEqual(await applyMigrations(local(pg), directory), {
      applied: [],
      recorded: ["002_probe"],
    });
    assert.equal((await recorded())[1].checksum, sha256(probe));
    await writeFile(
      join(directory, "002_probe.sql"),
      probe.replace("id int", "id bigint"),
    );
    await assert.rejects(
      applyMigrations(local(pg), directory),
      /002_probe changed after it was applied/,
    );
    await assert.rejects(
      verifyMigrations(local(pg), directory),
      /002_probe changed after it was applied/,
    );
  } finally {
    await pg.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test(
  "embedded startup records repository checksums and refuses an edited applied migration",
  { skip: !embedded && "embedded database only" },
  async () => {
    const parent = await mkdtemp(join(tmpdir(), "trainer-embedded-"));
    const directory = join(parent, "postgres");
    try {
      const first = await createDatabase({ directory });
      const [row] = await first.system((tx) =>
        tx.query(
          "SELECT count(*)::int AS total,count(checksum)::int AS hashed FROM schema_migrations",
        ),
      );
      assert.ok(row.total > 40);
      assert.equal(row.hashed, row.total);
      // Simulate a database migrated before checksums existed.
      await first.system((tx) =>
        tx.query("UPDATE schema_migrations SET checksum=NULL"),
      );
      await first.close();
      const legacy = await createDatabase({ directory });
      const [backfilled] = await legacy.system((tx) =>
        tx.query(
          "SELECT count(*)::int AS missing FROM schema_migrations WHERE checksum IS NULL",
        ),
      );
      assert.equal(backfilled.missing, 0);
      await legacy.system((tx) =>
        tx.query(
          "UPDATE schema_migrations SET checksum='tampered' WHERE version='001_initial'",
        ),
      );
      await legacy.close();
      await assert.rejects(
        createDatabase({ directory }),
        /001_initial changed after it was applied/,
      );
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  },
);
