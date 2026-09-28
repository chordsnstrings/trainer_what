import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import Fastify from "fastify";
import { createDatabase, type Database } from "@trainer/db";
import {
  checkPlatformAddress,
  hostActionCanonical,
  hostOperationsKey,
  platformAddressUpdates,
  readHostHealth,
  registerHostOperations,
  signHostAction,
  signHostResult,
  signHostStatus,
} from "../apps/api/src/host-operations.ts";

// Synthetic fixture values; never deployment values. The signature vector below
// is asserted by tests/test_platform_address_deployment.py as well.
const SECRET = "synthetic-host-operations-secret-with-more-than-32-bytes";
const SERVER = "203.0.113.10";
const saved = {
  secret: process.env.INTERNAL_PROXY_SECRET,
  url: process.env.PUBLIC_APP_URL,
  root: process.env.PLATFORM_ROOT_DOMAIN,
};
process.env.INTERNAL_PROXY_SECRET = SECRET;
process.env.PUBLIC_APP_URL = "https://gymmembership.203.0.113.10.sslip.io";
delete process.env.PLATFORM_ROOT_DOMAIN;
let db: Database;
const app = Fastify();
const admin = randomUUID();
const records: Record<string, { a: string[]; aaaa: string[] }> = {
  "gymmembership.203.0.113.10.sslip.io": { a: [SERVER], aaaa: [] },
  "trainsyou.test": { a: [SERVER], aaaa: [] },
  "app.trainsyou.test": { a: [SERVER], aaaa: [] },
  "janefit.trainsyou.test": { a: [SERVER], aaaa: [] },
  "shared.trainsyou.test": { a: [SERVER, "198.51.100.7"], aaaa: [] },
  "elsewhere.test": { a: ["198.51.100.7"], aaaa: [] },
  "v6.elsewhere.test": { a: [SERVER], aaaa: ["2001:db8::1"] },
  "other.test": { a: [SERVER], aaaa: [] },
};
const resolver = {
  resolve4: async (host: string) =>
    records[host]?.a ??
    (host.endsWith(".trainsyou.test") || host.endsWith(".v6root.test")
      ? [SERVER]
      : ([] as string[])),
  // A wildcard AAAA record under v6root.test answers every name below it.
  resolve6: async (host: string) =>
    records[host]?.aaaa ??
    (host.endsWith(".v6root.test") ? ["2001:db8::2"] : ([] as string[])),
};
before(async () => {
  db = await createDatabase({ memory: true });
  await db.system((tx) =>
    tx.query(
      "INSERT INTO users(id,email,name,password_hash,platform_role) VALUES($1,'address-admin@example.test','Operator','unused','admin')",
      [admin],
    ),
  );
  app.setErrorHandler((e: any, _req, reply) =>
    reply
      .code(e.statusCode ?? (e.name === "ZodError" ? 400 : 500))
      .send({ code: e.code, message: e.message }),
  );
  registerHostOperations(
    app,
    db,
    (req) => ({
      userId: admin,
      tenantId: randomUUID(),
      role: "owner",
      platformRole: String(req.headers["x-role"] ?? "admin"),
      mfaAt: String(req.headers["x-mfa"] ?? new Date().toISOString()),
    }),
    { resolver },
  );
});
after(async () => {
  await app.close();
  await db.close();
  for (const [name, value] of [
    ["INTERNAL_PROXY_SECRET", saved.secret],
    ["PUBLIC_APP_URL", saved.url],
    ["PLATFORM_ROOT_DOMAIN", saved.root],
  ] as const)
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
});
const post = (
  path: string,
  payload: unknown,
  headers: Record<string, string> = {},
) =>
  app.inject({
    url: "/api/v1/admin/infrastructure" + path,
    method: "POST",
    payload: payload as any,
    headers,
  });
async function publishAddress(address: unknown) {
  const text = JSON.stringify({
    version: 1,
    generatedAt: new Date().toISOString(),
    controllerRelease: "a".repeat(40),
    host: null,
    containers: null,
    deploy: null,
    backups: null,
    address,
  });
  await db.system((tx) =>
    tx.query(
      "INSERT INTO host_status(source,payload,signature) VALUES('controller',$1,$2) ON CONFLICT(source) DO UPDATE SET payload=EXCLUDED.payload,signature=EXCLUDED.signature,reported_at=now()",
      [text, signHostStatus(hostOperationsKey()!, "controller", text)],
    ),
  );
}
const address = {
  publicIpv4: SERVER,
  rootDomain: null,
  redirectFrom: [],
  changeInProgress: false,
  lastChange: null,
};

test("parameters are signed under a v2 canonical form that the controller recomputes", () => {
  const intent = {
    id: "11111111-2222-4333-8444-555555555555",
    requestId: "66666666-7777-4888-9999-000000000000",
    action: "change_platform_address" as const,
    target: null,
    requestedBy: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    issuedAtMs: 1790000000000,
    expiresAtMs: 1790001800000,
    reason: "Synthetic vector: move the platform address",
    parameters: '{"url":"https://trainsyou.com","rootDomain":"trainsyou.com"}',
  };
  const key = hostOperationsKey(SECRET)!;
  const lines = hostActionCanonical(intent).split("\n");
  assert.equal(lines[0], "gymmembership-host-action-v2");
  assert.equal(
    lines.at(-1),
    createHash("sha256").update(intent.parameters).digest("hex"),
  );
  assert.equal(
    signHostAction(intent, key),
    "39e604acbfc6ea5c0146318d933545361cd27a66644601626d5595f763ca9b3b",
  );
  // Without parameters the original v1 vector is unchanged.
  assert.equal(
    signHostAction(
      {
        ...intent,
        action: "restart_service",
        target: "api",
        reason: "Synthetic vector: restart the API",
        parameters: null,
      },
      key,
    ),
    "d815af0aebe1d7e55e898e76c703084f01886655f630d35668b3b99be9e59c0d",
  );
});

test("the DNS preview reports what the new name and a name under the root resolve to", async () => {
  await publishAddress(address);
  const r = await post("/platform-address/check", {
    url: "https://trainsyou.test",
    rootDomain: "TrainsYou.test.",
  });
  assert.equal(r.statusCode, 200, r.body);
  const body = r.json();
  assert.equal(body.valid, true, JSON.stringify(body.checks));
  assert.equal(body.origin, "https://trainsyou.test");
  assert.equal(body.rootDomain, "trainsyou.test");
  assert.equal(body.serverIpv4, SERVER);
  assert.equal(body.changed, true);
  assert.deepEqual(
    body.resolution.map((x: any) => [x.purpose, x.a, x.ok]),
    [
      ["New platform address", [SERVER], true],
      ["Wildcard *.trainsyou.test (random name)", [SERVER], true],
    ],
  );
  assert.match(
    body.resolution[1].name,
    /^gm-address-check-[0-9a-f]{8}\.trainsyou\.test$/,
  );
  assert.match(
    body.checks.find((c: any) => c.key === "dns").message,
    /resolves to A 203\.0\.113\.10: this server \(203\.0\.113\.10\)/,
  );
  // Every provider URL that names the platform address is listed with its new value.
  assert.deepEqual(
    body.providerUpdates.map((u: any) => u.value),
    platformAddressUpdates("https://trainsyou.test", "trainsyou.test").map(
      (u) => u.value,
    ),
  );
  assert.ok(
    body.providerUpdates.some(
      (u: any) =>
        u.value === "https://trainsyou.test/api/v1/webhooks/stripe" &&
        /Stripe/.test(u.where),
    ),
  );
  assert.ok(
    body.providerUpdates.some(
      (u: any) =>
        u.value === "https://trainsyou.test/api/v1/auth/oidc/google/callback",
    ),
  );
  assert.ok(
    body.procedure.some((step: string) =>
      /restores the previous runtime\.env, edge and services automatically/.test(
        step,
      ),
    ),
  );
  const audit = await db.system((tx) =>
    tx.query(
      "SELECT data FROM admin_operations_audit WHERE action='infrastructure.platform_address.checked' ORDER BY created_at DESC LIMIT 1",
    ),
  );
  assert.equal(audit[0].data.rootDomain, "trainsyou.test");
});

test("the preview refuses names that do not point only at this server", async () => {
  await publishAddress(address);
  const check = (url: string, rootDomain: string | null = null) =>
    checkPlatformAddress(db, url, resolver, { rootDomain, serverIpv4: SERVER });
  const elsewhere = await check("https://elsewhere.test");
  assert.equal(elsewhere.valid, false);
  assert.match(
    elsewhere.checks.find((c) => c.key === "dns")!.message,
    /A 198\.51\.100\.7, but it must point only to this server \(203\.0\.113\.10\)/,
  );
  // One A record elsewhere is enough to refuse: the certificate authority may use it.
  assert.equal((await check("https://shared.trainsyou.test")).valid, false);
  const missing = await check("https://missing.test");
  assert.match(
    missing.checks.find((c) => c.key === "dns")!.message,
    /no A or AAAA record/,
  );
  // This server has no IPv6 address: any AAAA record points elsewhere and blocks,
  // even when every A record is correct (certificate authorities try IPv6 first).
  const v6 = await check("https://v6.elsewhere.test");
  assert.equal(v6.valid, false, "an AAAA record elsewhere blocks the move");
  const ipv6 = v6.checks.find((c) => c.key === "dns_ipv6")!;
  assert.equal(ipv6.level, "error");
  assert.match(ipv6.message, /2001:db8::1/);
  assert.match(ipv6.message, /This server has no IPv6 address/);
  assert.match(
    ipv6.message,
    /Remove every AAAA record for v6\.elsewhere\.test/,
  );
  const wildcard6 = await check("https://v6root.test", "v6root.test");
  assert.equal(
    wildcard6.valid,
    false,
    "a wildcard AAAA record under the root blocks",
  );
  assert.match(
    wildcard6.checks.find((c) => c.key === "dns_ipv6")!.message,
    /2001:db8::2.*and \*\.v6root\.test/,
  );
  // The wildcard record under the root is required.
  const wildcard = await check("https://other.test", "elsewhere.test");
  assert.equal(wildcard.valid, false);
  assert.match(
    wildcard.checks.find((c) => c.key === "dns_wildcard")!.message,
    /Add a wildcard A record \*\.elsewhere\.test/,
  );
  // A workspace label under the root cannot be the platform name.
  const label = await check("https://janefit.trainsyou.test", "trainsyou.test");
  assert.equal(
    label.checks.find((c) => c.key === "workspace_label")!.ok,
    false,
  );
  assert.equal(
    (await check("https://app.trainsyou.test", "trainsyou.test")).valid,
    true,
  );
  for (const [url, root] of [
    ["https://trainsyou.test", "https://trainsyou.test"],
    ["https://trainsyou.test", "203.0.113.10"],
    ["https://10.0.0.1", null],
    ["https://trainsyou.test/", null],
  ] as const)
    assert.equal((await check(url, root)).valid, false, `${url} ${root}`);
  // Without a verified controller report there is no server address to compare
  // with: the check cannot pass (the controller would refuse the request anyway).
  const unreported = await checkPlatformAddress(
    db,
    "https://trainsyou.test",
    resolver,
  );
  assert.equal(unreported.serverIpv4, null);
  assert.equal(unreported.valid, false);
  const dns = unreported.checks.find((c) => c.key === "dns")!;
  assert.equal(dns.ok, false);
  assert.equal(dns.level, "error");
  assert.match(dns.message, /public IPv4 address is not reported yet/);
  assert.equal(unreported.resolution[0].ok, false);
});

test("an address change request is validated, signed with its parameters and audited", async () => {
  await publishAddress(address);
  const base = {
    action: "change_platform_address",
    reason: "Synthetic: move the platform to its own domain",
  };
  for (const [body, code] of [
    [{ ...base }, "HOST_ACTION_PARAMETERS"],
    [
      {
        ...base,
        action: "backup_now",
        parameters: { url: "https://trainsyou.test" },
      },
      "HOST_ACTION_PARAMETERS",
    ],
    [
      { ...base, parameters: { url: "https://elsewhere.test" } },
      "PLATFORM_ADDRESS_INVALID",
    ],
    [
      {
        ...base,
        parameters: { url: "https://trainsyou.test", rootDomain: "bad root" },
      },
      "PLATFORM_ADDRESS_INVALID",
    ],
    [
      { ...base, parameters: { url: process.env.PUBLIC_APP_URL } },
      "PLATFORM_ADDRESS_UNCHANGED",
    ],
  ] as const) {
    const r = await post("/host/actions", { requestId: randomUUID(), ...body });
    assert.equal(r.statusCode, 400, r.body);
    assert.equal(r.json().code, code, r.body);
  }
  assert.equal(
    (
      await post("/host/actions", {
        requestId: randomUUID(),
        ...base,
        parameters: { url: "https://trainsyou.test", command: "rm -rf /" },
      })
    ).statusCode,
    400,
  );
  const body = {
    requestId: randomUUID(),
    ...base,
    parameters: { url: "HTTPS://TrainsYou.test", rootDomain: "trainsyou.test" },
  };
  const r = await post("/host/actions", body);
  assert.equal(r.statusCode, 200, r.body);
  const created = r.json();
  assert.equal(created.status, "pending");
  assert.deepEqual(created.parameters, {
    url: "https://trainsyou.test",
    rootDomain: "trainsyou.test",
  });
  const [row] = await db.system((tx) =>
    tx.query("SELECT * FROM host_action_requests WHERE id=$1", [created.id]),
  );
  assert.equal(
    row.parameters,
    '{"url":"https://trainsyou.test","rootDomain":"trainsyou.test"}',
  );
  assert.equal(
    row.signature,
    signHostAction(
      {
        id: row.id,
        requestId: row.request_id,
        action: row.action,
        target: null,
        requestedBy: row.requested_by,
        issuedAtMs: Number(row.issued_at_ms),
        expiresAtMs: Number(row.expires_at_ms),
        reason: row.reason,
        parameters: row.parameters,
      },
      hostOperationsKey()!,
    ),
  );
  // Idempotent retry, conflicting reuse and one open change at a time.
  assert.equal((await post("/host/actions", body)).json().id, created.id);
  assert.equal(
    (
      await post("/host/actions", {
        ...body,
        parameters: { url: "https://app.trainsyou.test" },
      })
    ).json().code,
    "INTENT_CONFLICT",
  );
  assert.equal(
    (await post("/host/actions", { ...body, requestId: randomUUID() })).json()
      .code,
    "HOST_ACTION_OPEN",
  );
  const [audit] = await db.system((tx) =>
    tx.query(
      "SELECT data FROM admin_operations_audit WHERE action='infrastructure.host_action.requested' AND subject_id=$1",
      [created.id],
    ),
  );
  assert.deepEqual(audit.data.parameters, created.parameters);
  // Parameters are part of the immutable, signed intent.
  await assert.rejects(
    db.system((tx) =>
      tx.query(
        'UPDATE host_action_requests SET parameters=\'{"url":"https://evil.test"}\' WHERE id=$1',
        [created.id],
      ),
    ),
    /immutable/,
  );
  // The database refuses the action without parameters and parameters on other actions.
  for (const [action, parameters] of [
    ["change_platform_address", null],
    ["backup_now", '{"url":"https://trainsyou.test"}'],
  ])
    await assert.rejects(
      db.system((tx) =>
        tx.query(
          "INSERT INTO host_action_requests(id,request_id,action,reason,requested_by,issued_at_ms,expires_at_ms,signature,parameters) VALUES($1,$2,$3,'Synthetic constraint check',$4,1,2,$5,$6)",
          [
            randomUUID(),
            randomUUID(),
            action,
            admin,
            "0".repeat(64),
            parameters,
          ],
        ),
      ),
      /host_action_requests_parameters_action/,
    );
  // A signed progress message from the controller shows while it runs.
  const progress = JSON.stringify({
    message: "DNS points to this server.",
    details: { progress: true },
  });
  await db.system(async (tx) => {
    await tx.query(
      "UPDATE host_action_requests SET status='running',picked_up_at=now() WHERE id=$1",
      [created.id],
    );
    await tx.query(
      "UPDATE host_action_requests SET result=$2,result_signature=$3 WHERE id=$1 AND status='running'",
      [
        created.id,
        progress,
        signHostResult(hostOperationsKey()!, created.id, "running", progress),
      ],
    );
  });
  const view = await app.inject({ url: "/api/v1/admin/infrastructure/host" });
  assert.equal(view.statusCode, 200, view.body);
  const listed = view
    .json()
    .actions.recent.find((x: any) => x.id === created.id);
  assert.equal(listed.status, "running");
  assert.equal(listed.result.message, "DNS points to this server.");
  assert.equal(listed.resultVerified, true);
  assert.equal(listed.parameters.url, "https://trainsyou.test");
  const allowlist = view.json().actions.allowlist;
  assert.equal(
    allowlist.find((x: any) => x.action === "change_platform_address").form,
    "platform_address",
  );
  assert.ok(allowlist.some((x: any) => x.action === "clear_address_redirects"));
  assert.equal(view.json().address.publicIpv4, SERVER);
});

test("the redirect removal needs no parameters and the report carries the address state", async () => {
  const r = await post("/host/actions", {
    requestId: randomUUID(),
    action: "clear_address_redirects",
    reason: "Synthetic: nothing uses the old address any more",
  });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().parameters, null);
  await publishAddress({
    ...address,
    rootDomain: "trainsyou.test",
    redirectFrom: ["gymmembership.203.0.113.10.sslip.io"],
    lastChange: {
      from: "https://gymmembership.203.0.113.10.sslip.io",
      to: "https://trainsyou.test",
      at: "2026-09-28T10:00:00Z",
      status: "succeeded",
    },
  });
  const health = await readHostHealth(db);
  assert.equal(health.controller.state, "measured");
  assert.deepEqual(health.address?.redirectFrom, [
    "gymmembership.203.0.113.10.sslip.io",
  ]);
  assert.equal(health.address?.lastChange?.status, "succeeded");
  // Reports from controllers older than this change have no address block.
  const old = JSON.stringify({
    version: 1,
    generatedAt: new Date().toISOString(),
    host: null,
    containers: null,
    deploy: null,
    backups: null,
  });
  await db.system((tx) =>
    tx.query(
      "UPDATE host_status SET payload=$1,signature=$2 WHERE source='controller'",
      [old, signHostStatus(hostOperationsKey()!, "controller", old)],
    ),
  );
  const older = await readHostHealth(db);
  assert.equal(older.controller.state, "measured");
  assert.equal(older.address, null);
});
