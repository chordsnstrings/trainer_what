import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, type Database } from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";
import { HOST_HEADERS, signHostRequest } from "../apps/api/src/host-routing.ts";
import {
  askHostname,
  permitCertificateIssuance,
  TLS_ASK_PATH,
  tlsAskToken,
  tlsIssuancePermitted,
} from "../apps/api/src/host-operations.ts";
import { seedScope } from "./scope-fixtures.ts";

// Synthetic fixture values only.
const SECRET = "synthetic-edge-ask-secret-with-more-than-32-bytes";
const saved = {
  INTERNAL_PROXY_SECRET: process.env.INTERNAL_PROXY_SECRET,
  PUBLIC_APP_URL: process.env.PUBLIC_APP_URL,
};
process.env.INTERNAL_PROXY_SECRET = SECRET;
process.env.PUBLIC_APP_URL = "http://localhost:3000";
let db: Database, app: Awaited<ReturnType<typeof buildApp>>;
const operator = randomUUID(),
  active = randomUUID(),
  closed = randomUUID();
before(async () => {
  db = await createDatabase({ memory: true });
  await db.system(async (tx) => {
    await tx.query(
      "INSERT INTO users(id,email,name,password_hash,platform_role) VALUES($1,'tls-ops@example.test','Operator','unused','admin')",
      [operator],
    );
    for (const [id, state] of [
      [active, "active"],
      [closed, "closed"],
    ])
      await tx.query(
        "INSERT INTO tenants(id,slug,name,published,lifecycle_state) VALUES($1,$2,'TLS fixture',true,$3)",
        [id, "tls-" + id.slice(0, 8), state],
      );
    for (const [hostname, tenant, isActive, verified] of [
      ["coach.tls-fixture.test", active, true, true],
      ["inactive.tls-fixture.test", active, false, true],
      ["unverified.tls-fixture.test", active, true, false],
      ["closed.tls-fixture.test", closed, true, true],
    ] as const)
      await tx.query(
        "INSERT INTO domain_mappings(hostname,tenant_id,verified_at,active) VALUES($1,$2,CASE WHEN $4 THEN now() END,$3)",
        [hostname, tenant, isActive, verified],
      );
  });
  app = await buildApp({ db, testing: true });
  await app.ready();
});
after(async () => {
  await app.close();
  await db.close();
  for (const [key, value] of Object.entries(saved))
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
});
const ask = (
  domain: string,
  token: string | null = tlsAskToken(),
  headers: Record<string, string> = {},
) =>
  app.inject({
    method: "GET",
    url:
      TLS_ASK_PATH +
      "?" +
      new URLSearchParams({
        domain,
        ...(token === null ? {} : { token }),
      }).toString(),
    // The edge calls the API by its private service name.
    headers: { host: "api:4000", ...headers },
  });

test("the edge may obtain certificates only for active, verified coach domains", async () => {
  const cases: Array<[string, number]> = [
    ["coach.tls-fixture.test", 200],
    ["COACH.tls-fixture.test.", 200],
    ["inactive.tls-fixture.test", 404],
    ["unverified.tls-fixture.test", 404],
    ["closed.tls-fixture.test", 404],
    ["unknown.tls-fixture.test", 404],
    ["localhost", 400],
    ["203.0.113.5", 400],
    ["bad_name.tls-fixture.test", 400],
    ["coach.tls-fixture.test:443", 400],
  ];
  for (const [domain, status] of cases) {
    const r = await ask(domain);
    assert.equal(r.statusCode, status, domain + " " + r.body);
    assert.equal(r.headers["cache-control"], "no-store");
  }
});

test("the ask endpoint needs the derived token and is unreachable through the web proxy", async () => {
  assert.equal((await ask("coach.tls-fixture.test", null)).statusCode, 400);
  assert.equal(
    (await ask("coach.tls-fixture.test", "0".repeat(64))).statusCode,
    403,
  );
  assert.equal((await ask("coach.tls-fixture.test", SECRET)).statusCode, 403);
  // A public request relayed by the web proxy carries a signed host proof.
  const time = String(Date.now()),
    url =
      TLS_ASK_PATH +
      "?" +
      new URLSearchParams({
        domain: "coach.tls-fixture.test",
        token: tlsAskToken()!,
      }).toString();
  const relayed = await app.inject({
    method: "GET",
    url,
    headers: {
      host: "localhost:3000",
      [HOST_HEADERS.host]: "localhost:3000",
      [HOST_HEADERS.time]: time,
      [HOST_HEADERS.signature]: signHostRequest(
        "localhost:3000",
        "GET",
        url,
        time,
        SECRET,
      ),
    },
  });
  assert.equal(relayed.statusCode, 404, relayed.body);
  // Unsigned provenance headers are rejected before the handler.
  const forged = await ask("coach.tls-fixture.test", tlsAskToken(), {
    [HOST_HEADERS.host]: "coach.tls-fixture.test",
  });
  assert.notEqual(forged.statusCode, 200);
  // The platform's own name has its own managed certificate.
  process.env.PUBLIC_APP_URL = "https://platform.tls-fixture.test";
  try {
    await db.system((tx) =>
      tx.query(
        "INSERT INTO domain_mappings(hostname,tenant_id,verified_at,active) VALUES('platform.tls-fixture.test',$1,now(),true)",
        [active],
      ),
    );
    assert.equal((await ask("platform.tls-fixture.test")).statusCode, 404);
  } finally {
    process.env.PUBLIC_APP_URL = "http://localhost:3000";
  }
});

test("activation allowances permit one certificate briefly; decisions are cached", async () => {
  const host = "pending.tls-fixture.test";
  assert.equal(await tlsIssuancePermitted(db, host), false);
  await permitCertificateIssuance(db, {
    hostname: host,
    tenantId: active,
    orderId: randomUUID(),
    actorId: operator,
  });
  // The allowance clears the cached refusal immediately.
  assert.equal(await tlsIssuancePermitted(db, host), true);
  assert.equal((await ask(host)).statusCode, 200);
  const [row] = await db.system((tx) =>
    tx.query(
      "SELECT extract(epoch FROM expires_at-created_at)::int AS seconds FROM tls_issuance_allowances WHERE hostname=$1",
      [host],
    ),
  );
  assert.equal(Number(row.seconds), 900);
  // Expired allowances permit nothing (checked past the cache window).
  await db.system((tx) =>
    tx.query(
      "UPDATE tls_issuance_allowances SET created_at=now()-interval '20 minutes',expires_at=now()-interval '5 minutes' WHERE hostname=$1",
      [host],
    ),
  );
  assert.equal(
    await tlsIssuancePermitted(db, host, Date.now() + 120000),
    false,
  );
  // A positive answer is cached briefly even if the mapping changes.
  const cached = "coach.tls-fixture.test";
  assert.equal(await tlsIssuancePermitted(db, cached), true);
  await db.system((tx) =>
    tx.query("UPDATE domain_mappings SET active=false WHERE hostname=$1", [
      cached,
    ]),
  );
  assert.equal(await tlsIssuancePermitted(db, cached), true);
  assert.equal(
    await tlsIssuancePermitted(db, cached, Date.now() + 120000),
    false,
  );
  assert.throws(() => askHostname("-bad.example.test"), /Invalid domain/);
  await assert.rejects(
    db.tenant(seedScope({ tenantId: active }), (tx) =>
      tx.query("SELECT * FROM tls_issuance_allowances"),
    ),
    /permission denied/,
  );
});

test("a flood of random names costs no per-name queries and cannot starve real names", async () => {
  await db.system((tx) =>
    tx.query(
      "INSERT INTO domain_mappings(hostname,tenant_id,verified_at,active) VALUES('real.tls-fixture.test',$1,now(),true)",
      [active],
    ),
  );
  const system = db.system;
  let queries = 0;
  (db as any).system = (...args: unknown[]) => {
    queries++;
    return (system as any).apply(db, args);
  };
  try {
    // Later than any time used above, so the first call reloads the set.
    const t0 = Date.now() + 10 * 60000;
    assert.equal(
      await tlsIssuancePermitted(db, "real.tls-fixture.test", t0),
      true,
    );
    assert.equal(queries, 1);
    for (let i = 0; i < 300; i++)
      assert.equal(
        await tlsIssuancePermitted(
          db,
          `flood-${i}.tls-fixture.test`,
          t0 + i * 10,
        ),
        false,
      );
    assert.equal(
      queries,
      1,
      "unknown names within the reload interval are answered from memory",
    );
    assert.equal(
      await tlsIssuancePermitted(db, "flood-x.tls-fixture.test", t0 + 6000),
      false,
    );
    assert.equal(queries, 2, "one reload after the miss interval");
    assert.equal(
      await tlsIssuancePermitted(db, "real.tls-fixture.test", t0 + 6001),
      true,
    );
    assert.equal(queries, 2);
  } finally {
    (db as any).system = system;
  }
});

test("the ask route budget is per requested name, not per edge address", async () => {
  // Every ask arrives from the one edge container.
  for (let i = 0; i < 150; i++)
    assert.equal(
      (await ask("random-" + i + ".tls-fixture.test")).statusCode,
      404,
      "random name " + i,
    );
  assert.equal((await ask("real.tls-fixture.test")).statusCode, 200);
  let limited = 0;
  for (let i = 0; i < 125; i++)
    if ((await ask("repeat.tls-fixture.test")).statusCode === 429) limited++;
  assert.ok(limited >= 1, "expected the per-name budget to apply");
  assert.equal((await ask("REAL.tls-fixture.test.")).statusCode, 200);
});

test("assembled application registers host operation routes", async () => {
  for (const [method, url] of [
    ["GET", "/api/v1/admin/infrastructure/host"],
    ["POST", "/api/v1/admin/infrastructure/host/actions"],
    ["POST", "/api/v1/admin/infrastructure/host/actions/:id/cancel"],
    ["POST", "/api/v1/admin/infrastructure/host/thresholds"],
    ["POST", "/api/v1/admin/infrastructure/platform-address/check"],
    ["GET", TLS_ASK_PATH],
  ] as const)
    assert.equal(app.hasRoute({ method, url }), true, url);
  const anonymous = await app.inject({
    method: "GET",
    url: "/api/v1/admin/infrastructure/host",
    headers: { host: "localhost:3000" },
  });
  assert.equal(anonymous.statusCode, 401);
});
