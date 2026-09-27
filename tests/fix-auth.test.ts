import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createDatabase, type Database } from "@trainer/db";
import { integrationStatus } from "@trainer/providers";
import { buildApp } from "../apps/api/src/app.ts";
import { passwordHash, newToken, tokenHash } from "../apps/api/src/auth.ts";
import {
  totpAt,
  sealSecret,
  requireRecentMfa,
} from "../apps/api/src/security.ts";
import {
  assignPlatformRole,
  resetUserMfa,
} from "../apps/api/src/operator-actions.ts";
import { legalAcceptanceVersion } from "../apps/api/src/legal.ts";
import { signHostRequest, HOST_HEADERS } from "../apps/api/src/host-routing.ts";
import {
  strictSecurity,
  assertSecurityModeBinding,
} from "../packages/providers/src/configuration.ts";
import { assertLocalSyntheticTarget } from "../scripts/synthetic-guard.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const password = "SyntheticAuthOnly2026!",
  secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
  proofKey = "synthetic-auth-host-proof-key-with-32-bytes",
  customHost = "members.auth-fixture.test";
const keyA = randomBytes(32).toString("base64"),
  keyB = randomBytes(32).toString("base64");
const envKeys = [
  "NODE_ENV",
  "NODE_TEST_CONTEXT",
  "PUBLIC_APP_URL",
  "INTERNAL_PROXY_SECRET",
  "SECURITY_ENCRYPTION_KEY",
  "SECURITY_ENCRYPTION_KEY_PREVIOUS",
  "LEGAL_APPROVED",
  "FILE_IMPORTS_APPROVED",
  "APPLE_IMPORTS_ENABLED",
];
const saved = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
let db: Database, app: Awaited<ReturnType<typeof buildApp>>, encoded: string;

function setEnv(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values))
    if (value === undefined) Reflect.deleteProperty(process.env, key);
    else Object.assign(process.env, { [key]: value });
}
async function withEnv<T>(
  values: Record<string, string | undefined>,
  fn: () => Promise<T>,
) {
  const prior = Object.fromEntries(
    Object.keys(values).map((k) => [k, process.env[k]]),
  );
  setEnv(values);
  try {
    return await fn();
  } finally {
    setEnv(prior);
  }
}
// A deployment that forgot NODE_ENV: neither production nor an explicit
// development/test process, and not the Node test runner.
const unsetEnvironment = <T>(fn: () => Promise<T>) =>
  withEnv({ NODE_ENV: undefined, NODE_TEST_CONTEXT: undefined }, fn);

let address = 0;
function call(
  path: string,
  options: { body?: unknown; cookie?: string; custom?: boolean } = {},
) {
  const url = "/api/v1" + path,
    method = options.body === undefined ? "GET" : "POST",
    time = String(Date.now());
  address++;
  return app.inject({
    method,
    url,
    payload: options.body as any,
    // Distinct client addresses keep per-address auth rate budgets independent.
    remoteAddress: `10.43.${(address >> 8) & 255}.${address & 255}`,
    headers: {
      host: "localhost:3000",
      origin: options.custom
        ? "https://" + customHost
        : "http://localhost:3000",
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...(options.custom
        ? {
            [HOST_HEADERS.host]: customHost,
            [HOST_HEADERS.time]: time,
            [HOST_HEADERS.signature]: signHostRequest(
              customHost,
              method,
              url,
              time,
              proofKey,
            ),
          }
        : {}),
    },
  });
}
const sessionCookie = (r: any) =>
  ([] as string[])
    .concat(r.headers["set-cookie"] ?? [])
    .find((c) => c.startsWith("session="))
    ?.split(";")[0] ?? "";
const code = (offset = 0) =>
  totpAt(secret, Math.floor(Date.now() / 30000) + offset);
async function freshCode(userId: string) {
  await db.system((tx) =>
    tx.query("UPDATE user_security SET last_counter=-1 WHERE user_id=$1", [
      userId,
    ]),
  );
  return code();
}

type Person = {
  userId: string;
  tenantId: string;
  email: string;
  cookie: string;
};
async function person(
  options: {
    verified?: boolean;
    role?: string;
    tenantId?: string;
    name?: string;
    mfa?: boolean;
    platformRole?: string;
  } = {},
): Promise<Person> {
  const userId = randomUUID(),
    tenantId = options.tenantId ?? randomUUID(),
    token = newToken(),
    email = `auth-${userId}@example.test`;
  await db.system(async (tx) => {
    await tx.query(
      "INSERT INTO users(id,name,email,password_hash,email_verified) VALUES($1,'Synthetic Member',$2,$3,$4)",
      [userId, email, encoded, options.verified ?? true],
    );
    if (!options.tenantId)
      await tx.query(
        "INSERT INTO tenants(id,slug,name,published) VALUES($1,$2,$3,true)",
        [tenantId, "auth-" + tenantId, options.name ?? "Workspace " + userId],
      );
    await tx.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)",
      [tenantId, userId, options.role ?? "owner"],
    );
    await tx.query(
      "INSERT INTO sessions(token_hash,user_id,tenant_id,expires_at) VALUES($1,$2,$3,now()+interval '7 days')",
      [tokenHash(token), userId, tenantId],
    );
    if (options.mfa)
      await tx.query(
        "INSERT INTO user_security(user_id,totp_secret,enabled,last_counter) VALUES($1,$2,true,-1)",
        [userId, sealSecret(secret)],
      );
    if (options.platformRole)
      await tx.query("UPDATE users SET platform_role=$2 WHERE id=$1", [
        userId,
        options.platformRole,
      ]);
  });
  return { userId, tenantId, email, cookie: "session=" + token };
}
async function extraSession(p: Person) {
  const token = newToken();
  await db.system((tx) =>
    tx.query(
      "INSERT INTO sessions(token_hash,user_id,tenant_id,expires_at) VALUES($1,$2,$3,now()+interval '7 days')",
      [tokenHash(token), p.userId, p.tenantId],
    ),
  );
  return "session=" + token;
}
async function emailJobs(p: Person, prefix: string) {
  return db.tenant({ ...p, role: "owner" }, (tx) =>
    tx.query(
      "SELECT data FROM jobs WHERE intent_key LIKE $1 AND data->>'to'=$2 ORDER BY created_at DESC",
      [prefix + ":%", p.email],
    ),
  );
}
async function linkToken(p: Person, prefix: string) {
  const [job] = await emailJobs(p, prefix);
  return String(job.data.text).split("\n")[0].split("/").pop()!;
}

before(async () => {
  setEnv({
    NODE_ENV: undefined,
    PUBLIC_APP_URL: "http://localhost:3000",
    INTERNAL_PROXY_SECRET: proofKey,
    SECURITY_ENCRYPTION_KEY: keyA,
    SECURITY_ENCRYPTION_KEY_PREVIOUS: undefined,
    LEGAL_APPROVED: undefined,
    FILE_IMPORTS_APPROVED: undefined,
    APPLE_IMPORTS_ENABLED: undefined,
  });
  encoded = await passwordHash(password);
  db = await createDatabase({ memory: true });
  app = await buildApp({ db, testing: true });
  // Published legal documents, so gates rather than missing documents decide.
  const author = randomUUID();
  await db.system(async (tx) => {
    await tx.query(
      "INSERT INTO users(id,name,email,password_hash,email_verified) VALUES($1,'Legal author',$2,$3,true)",
      [author, `legal-${author}@example.test`, encoded],
    );
    for (const key of ["terms", "privacy", "ai-disclosure"])
      await tx.query(
        "INSERT INTO admin_documents(id,kind,key,version,title,content,status,effective_at,created_by,published_by,published_at) VALUES($1,'legal',$2,1,$3,'Synthetic fixture text.','published',now()-interval '1 day',$4,$4,now())",
        [randomUUID(), key, "Fixture " + key, author],
      );
  });
});
after(async () => {
  await app?.close();
  await db?.close();
  setEnv(saved);
});

test("platform login accepts a workspace choice, lists memberships and switches sessions", async () => {
  const member = await person({ name: "Alpha studio" }),
    other = await person({ name: "Beta studio" }),
    outsider = await person();
  await db.system((tx) =>
    tx.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'subscriber')",
      [other.tenantId, member.userId],
    ),
  );
  const chosen = await call("/auth/login", {
    body: { email: member.email, password, tenantId: other.tenantId },
  });
  assert.equal(chosen.statusCode, 200, chosen.body);
  const cookie = sessionCookie(chosen);
  assert.equal(
    (await call("/bootstrap", { cookie })).json().user.tenantId,
    other.tenantId,
  );
  const denied = await call("/auth/login", {
    body: { email: member.email, password, tenantId: outsider.tenantId },
  });
  assert.equal(denied.statusCode, 403, denied.body);
  assert.equal(denied.json().code, "NO_MEMBERSHIP");
  const listed = await call("/auth/workspaces", { cookie });
  assert.equal(listed.statusCode, 200, listed.body);
  assert.deepEqual(
    listed
      .json()
      .workspaces.map((w: any) => [w.tenantId, w.role, w.current])
      .sort(),
    [
      [member.tenantId, "owner", false],
      [other.tenantId, "subscriber", true],
    ].sort(),
  );
  assert.equal((await call("/auth/workspaces")).statusCode, 401);
  // A permitted switch replaces the session with one in the chosen workspace.
  const switched = await call("/auth/workspace", {
    body: { tenantId: member.tenantId },
    cookie,
  });
  assert.equal(switched.statusCode, 200, switched.body);
  const next = sessionCookie(switched);
  assert.equal(
    (await call("/bootstrap", { cookie: next })).json().user.tenantId,
    member.tenantId,
  );
  assert.equal((await call("/bootstrap", { cookie })).statusCode, 401);
  // Without a choice, login reopens the most recently used workspace rather
  // than the lowest workspace id.
  const [low, high] = [member.tenantId, other.tenantId].sort();
  await db.system((tx) =>
    tx.query(
      "UPDATE sessions SET last_seen_at=CASE WHEN tenant_id=$2 THEN now() ELSE now()-interval '2 days' END WHERE user_id=$1",
      [member.userId, high],
    ),
  );
  if (
    !(
      await db.system((tx) =>
        tx.query("SELECT 1 FROM sessions WHERE user_id=$1 AND tenant_id=$2", [
          member.userId,
          high,
        ]),
      )
    ).length
  )
    await call("/auth/login", {
      body: { email: member.email, password, tenantId: high },
    });
  const recent = await call("/auth/login", {
    body: { email: member.email, password },
  });
  assert.equal(recent.statusCode, 200, recent.body);
  assert.equal(
    (await call("/bootstrap", { cookie: sessionCookie(recent) })).json().user
      .tenantId,
    high,
  );
  assert.notEqual(high, low);
  // A custom host stays bound to its own workspace for choice and listing.
  await db.system((tx) =>
    tx.query(
      "INSERT INTO domain_mappings(hostname,tenant_id,active,verified_at) VALUES($1,$2,true,now())",
      [customHost, other.tenantId],
    ),
  );
  const foreignChoice = await call("/auth/login", {
    body: { email: member.email, password, tenantId: member.tenantId },
    custom: true,
  });
  assert.equal(foreignChoice.statusCode, 403, foreignChoice.body);
  const hosted = await call("/auth/login", {
    body: { email: member.email, password },
    custom: true,
  });
  assert.equal(hosted.statusCode, 200, hosted.body);
  const hostedList = await call("/auth/workspaces", {
    cookie: sessionCookie(hosted),
    custom: true,
  });
  assert.equal(hostedList.statusCode, 200, hostedList.body);
  assert.deepEqual(
    hostedList.json().workspaces.map((w: any) => w.tenantId),
    [other.tenantId],
  );
});

test("security controls stay enforced when NODE_ENV is unset outside the test runner", async () => {
  assert.equal(strictSecurity({}), true);
  assert.equal(strictSecurity({ NODE_ENV: "staging" }), true);
  assert.equal(
    strictSecurity({ NODE_ENV: "production", NODE_TEST_CONTEXT: "child-v8" }),
    true,
  );
  assert.equal(strictSecurity({ NODE_ENV: "development" }), false);
  assert.equal(strictSecurity({ NODE_TEST_CONTEXT: "child-v8" }), false);
  for (const env of [
    { NODE_ENV: "development", API_HOST: "0.0.0.0" },
    {
      NODE_ENV: "development",
      PUBLIC_APP_URL: "https://staging.example.test",
    },
  ])
    assert.throws(() => assertSecurityModeBinding(env), /loopback/);
  assertSecurityModeBinding({
    NODE_ENV: "development",
    API_HOST: "127.0.0.1",
    PUBLIC_APP_URL: "http://localhost:3000",
  });
  assertSecurityModeBinding({
    API_HOST: "0.0.0.0",
    PUBLIC_APP_URL: "https://staging.example.test",
  });
  const admin = await person({ platformRole: "admin" });
  await unsetEnvironment(async () => {
    assert.throws(() => requireRecentMfa({ mfaAt: null }), /authenticator/);
    const overview = await call("/admin/overview", { cookie: admin.cookie });
    assert.equal(overview.statusCode, 403, overview.body);
    assert.equal(overview.json().code, "MFA_STEP_UP");
    const login = await call("/auth/login", {
      body: { email: admin.email, password },
    });
    assert.equal(login.statusCode, 200, login.body);
    assert.match(String(login.headers["set-cookie"]), /;\s*Secure/i);
    const slug = "strict-" + randomBytes(4).toString("hex");
    const registered = await withEnv({ LEGAL_APPROVED: "true" }, () =>
      call("/auth/register", {
        body: {
          name: "Strict Coach",
          email: slug + "@example.test",
          password,
          slug,
          accepted: true,
        },
      }),
    );
    assert.equal(registered.statusCode, 201, registered.body);
    const [stored] = await db.system((tx) =>
      tx.query("SELECT email_verified FROM users WHERE email=$1", [
        slug + "@example.test",
      ]),
    );
    assert.equal(stored.email_verified, false);
  });
  // The isolated test runner keeps development controls.
  requireRecentMfa({ mfaAt: null });
});

test("confirming an authenticator issues recovery codes that restore access", async () => {
  const member = await person();
  const enrolled = await call("/auth/mfa/enroll", {
    body: { password },
    cookie: member.cookie,
  });
  assert.equal(enrolled.statusCode, 200, enrolled.body);
  const confirmed = await call("/auth/mfa/confirm", {
    body: {
      code: totpAt(enrolled.json().secret, Math.floor(Date.now() / 30000)),
    },
    cookie: member.cookie,
  });
  assert.equal(confirmed.statusCode, 200, confirmed.body);
  const codes: string[] = confirmed.json().recoveryCodes ?? [];
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  const [count] = await db.system((tx) =>
    tx.query(
      "SELECT count(*)::int AS n FROM mfa_recovery_codes WHERE user_id=$1",
      [member.userId],
    ),
  );
  assert.equal(count.n, 10);
  const recovered = await call("/auth/mfa/recover", {
    body: { email: member.email, password, recoveryCode: codes[4] },
  });
  assert.equal(recovered.statusCode, 200, recovered.body);
  const [security] = await db.system((tx) =>
    tx.query("SELECT enabled FROM user_security WHERE user_id=$1", [
      member.userId,
    ]),
  );
  assert.equal(security.enabled, false);
});

test("authenticator secrets survive a key rotation and re-seal under the current key", async () => {
  const member = await person({ mfa: true });
  const login = (value: string) =>
    call("/auth/login", {
      body: { email: member.email, password, code: value },
    });
  try {
    setEnv({ SECURITY_ENCRYPTION_KEY: keyB });
    const unreadable = await login(await freshCode(member.userId));
    assert.equal(unreadable.statusCode, 503, unreadable.body);
    assert.equal(unreadable.json().code, "PROVIDER_UNAVAILABLE");
    setEnv({ SECURITY_ENCRYPTION_KEY_PREVIOUS: keyA });
    const [before] = await db.system((tx) =>
      tx.query("SELECT totp_secret FROM user_security WHERE user_id=$1", [
        member.userId,
      ]),
    );
    const rotated = await login(await freshCode(member.userId));
    assert.equal(rotated.statusCode, 200, rotated.body);
    const [after] = await db.system((tx) =>
      tx.query("SELECT totp_secret FROM user_security WHERE user_id=$1", [
        member.userId,
      ]),
    );
    assert.notEqual(after.totp_secret, before.totp_secret);
    setEnv({ SECURITY_ENCRYPTION_KEY_PREVIOUS: undefined });
    const current = await login(await freshCode(member.userId));
    assert.equal(current.statusCode, 200, current.body);
  } finally {
    setEnv({
      SECURITY_ENCRYPTION_KEY: keyA,
      SECURITY_ENCRYPTION_KEY_PREVIOUS: undefined,
    });
  }
});

test("host operators reset a member's authenticator with an audited, attributed action", async () => {
  const admin = await person({ mfa: true, platformRole: "admin" }),
    member = await person({ mfa: true }),
    nonAdmin = await person({ mfa: true }),
    plainAdmin = await person({ platformRole: "admin" });
  const input = (overrides: Record<string, unknown> = {}) => ({
    actorEmail: admin.email,
    actorCode: code(),
    targetEmail: member.email,
    reason: "Member lost phone; identity verified by video call",
    ...overrides,
  });
  await assert.rejects(
    resetUserMfa(db, input({ actorEmail: nonAdmin.email })),
    /verified Superadmin/,
  );
  await assert.rejects(
    resetUserMfa(db, input({ actorEmail: plainAdmin.email })),
    /verified Superadmin/,
  );
  await assert.rejects(resetUserMfa(db, input({ reason: "lost" })));
  await assert.rejects(
    resetUserMfa(db, input({ targetEmail: admin.email })),
    /Another Superadmin/,
  );
  const done = await resetUserMfa(
    db,
    input({ actorCode: await freshCode(admin.userId) }),
  );
  assert.equal(done.notified, true);
  const audits = await db.system((tx) =>
    tx.query(
      "SELECT actor_id,data FROM admin_operations_audit WHERE action='security.mfa_reset' AND subject_id=$1",
      [member.userId],
    ),
  );
  assert.equal(audits.length, 1);
  assert.equal(audits[0].actor_id, admin.userId);
  assert.equal(audits[0].data.source, "host-cli");
  assert.match(audits[0].data.reason, /video call/);
  assert.equal(
    (await call("/auth/account", { cookie: member.cookie })).statusCode,
    401,
  );
  const login = await call("/auth/login", {
    body: { email: member.email, password },
  });
  assert.equal(login.statusCode, 200, login.body);
  assert.equal((await emailJobs(member, "auth-operator-reset")).length, 1);
  await assert.rejects(
    resetUserMfa(db, input({ actorCode: await freshCode(admin.userId) })),
    /no enabled authenticator/,
  );
});

test("platform role changes require verified authenticated targets and are audited", async () => {
  const admin = await person({ mfa: true, platformRole: "admin" }),
    unverified = await person({ verified: false, mfa: true }),
    noMfa = await person(),
    ready = await person({ mfa: true });
  const assign = async (targetEmail: string, role: string, reason?: string) =>
    assignPlatformRole(db, {
      actorEmail: admin.email,
      actorCode: await freshCode(admin.userId),
      targetEmail,
      role,
      reason: reason ?? "Quarterly finance rota approved by the owner",
    });
  const roleOf = async (userId: string) =>
    (
      await db.system((tx) =>
        tx.query("SELECT platform_role FROM users WHERE id=$1", [userId]),
      )
    )[0].platform_role;
  await assert.rejects(assign(unverified.email, "finance"), /Verify/);
  assert.equal(await roleOf(unverified.userId), "none");
  await assert.rejects(assign(noMfa.email, "finance"), /authenticator/);
  assert.equal(await roleOf(noMfa.userId), "none");
  await assert.rejects(assign(ready.email, "finance", "because"));
  await assert.rejects(
    assignPlatformRole(db, {
      actorEmail: noMfa.email,
      actorCode: code(),
      targetEmail: ready.email,
      role: "finance",
      reason: "Quarterly finance rota approved by the owner",
    }),
    /verified Superadmin/,
  );
  const changed = await assign(ready.email, "finance");
  assert.deepEqual(
    { changed: changed.changed, from: changed.from, to: changed.to },
    { changed: true, from: "none", to: "finance" },
  );
  assert.equal(await roleOf(ready.userId), "finance");
  const audits = await db.system((tx) =>
    tx.query(
      "SELECT actor_id,data FROM admin_operations_audit WHERE action='platform.role_changed' AND subject_id=$1",
      [ready.userId],
    ),
  );
  assert.equal(audits.length, 1);
  assert.equal(audits[0].actor_id, admin.userId);
  assert.deepEqual(
    [audits[0].data.from, audits[0].data.to, audits[0].data.source],
    ["none", "finance", "host-cli"],
  );
  const history = await db.system((tx) =>
    tx.query(
      "SELECT from_role,to_role,actor_id,reason,source FROM platform_role_changes WHERE user_id=$1 ORDER BY created_at",
      [ready.userId],
    ),
  );
  assert.deepEqual(history, [
    {
      from_role: "none",
      to_role: "finance",
      actor_id: admin.userId,
      reason: "Quarterly finance rota approved by the owner",
      source: "host-cli",
    },
  ]);
  // Every other path is recorded by the database, including raw updates.
  await db.system((tx) =>
    tx.query("UPDATE users SET platform_role='support' WHERE id=$1", [
      noMfa.userId,
    ]),
  );
  const raw = await db.system((tx) =>
    tx.query(
      "SELECT from_role,to_role,actor_id,source FROM platform_role_changes WHERE user_id=$1",
      [noMfa.userId],
    ),
  );
  assert.deepEqual(raw, [
    {
      from_role: "none",
      to_role: "support",
      actor_id: null,
      source: "database",
    },
  ]);
  await assert.rejects(
    db.system((tx) =>
      tx.query("DELETE FROM platform_role_changes WHERE user_id=$1", [
        noMfa.userId,
      ]),
    ),
  );
});

test("the last Superadmin stays and a lone verified account can recover the role", async () => {
  const isolated = await createDatabase({ memory: true });
  try {
    const make = async (role = "none") => {
      const id = randomUUID(),
        email = `solo-${id}@example.test`;
      await isolated.system(async (tx) => {
        await tx.query(
          "INSERT INTO users(id,name,email,password_hash,email_verified,platform_role) VALUES($1,'Solo',$2,$3,true,$4)",
          [id, email, encoded, role],
        );
        await tx.query(
          "INSERT INTO user_security(user_id,totp_secret,enabled,last_counter) VALUES($1,$2,true,-1)",
          [id, sealSecret(secret)],
        );
      });
      return { id, email };
    };
    const reset = (id: string) =>
      isolated.system((tx) =>
        tx.query("UPDATE user_security SET last_counter=-1 WHERE user_id=$1", [
          id,
        ]),
      );
    const only = await make("admin");
    await reset(only.id);
    await assert.rejects(
      assignPlatformRole(isolated, {
        actorEmail: only.email,
        actorCode: code(),
        targetEmail: only.email,
        role: "none",
        reason: "Stepping down from platform administration",
      }),
      /last one/,
    );
    await isolated.system((tx) =>
      tx.query("UPDATE users SET platform_role='none' WHERE id=$1", [only.id]),
    );
    await reset(only.id);
    const restored = await assignPlatformRole(isolated, {
      actorEmail: only.email,
      actorCode: code(),
      targetEmail: only.email,
      role: "admin",
      reason: "No Superadmin remained after an accidental revocation",
    });
    assert.equal(restored.changed, true);
  } finally {
    await isolated.close();
  }
});

test("unverified accounts cannot bind an authenticator and first mailbox proof clears pre-claimed factors", async () => {
  const claimed = await person({ verified: false });
  const enroll = await call("/auth/mfa/enroll", {
    body: { password },
    cookie: claimed.cookie,
  });
  assert.equal(enroll.statusCode, 403, enroll.body);
  assert.equal(enroll.json().code, "EMAIL_VERIFICATION");
  const preclaimed = await person({ verified: false, mfa: true }),
    owner = await person({ mfa: true });
  for (const p of [preclaimed, owner])
    await db.system(async (tx) => {
      await tx.query(
        "INSERT INTO mfa_recovery_codes(user_id,code_hash) VALUES($1,$2)",
        [p.userId, "fixture-" + p.userId],
      );
      await tx.query(
        "INSERT INTO auth_passkeys(id,user_id,rp_id,credential_id,public_key,counter,device_type,backed_up,label) VALUES($1,$2,'localhost',$3,'\\x00',0,'singleDevice',false,'Fixture')",
        [randomUUID(), p.userId, "cred-" + p.userId],
      );
    });
  const replacement = "ReplacementPassword2026!";
  for (const p of [preclaimed, owner]) {
    const forgot = await call("/auth/forgot-password", {
      body: { email: p.email },
    });
    assert.equal(forgot.statusCode, 200, forgot.body);
    const reset = await call("/auth/reset-password", {
      body: { token: await linkToken(p, "reset"), password: replacement },
    });
    assert.equal(reset.statusCode, 200, reset.body);
  }
  const reclaimed = await call("/auth/login", {
    body: { email: preclaimed.email, password: replacement },
  });
  assert.equal(reclaimed.statusCode, 200, reclaimed.body);
  const factors = async (p: Person) =>
    (
      await db.system((tx) =>
        tx.query(
          "SELECT (SELECT enabled FROM user_security WHERE user_id=$1) AS mfa,(SELECT count(*)::int FROM mfa_recovery_codes WHERE user_id=$1) AS codes,(SELECT count(*)::int FROM auth_passkeys WHERE user_id=$1) AS passkeys",
          [p.userId],
        ),
      )
    )[0];
  assert.deepEqual(await factors(preclaimed), {
    mfa: false,
    codes: 0,
    passkeys: 0,
  });
  const [cleared] = await db.tenant({ ...preclaimed, role: "owner" }, (tx) =>
    tx.query(
      "SELECT count(*)::int AS n FROM events WHERE name='security.unverified_factors_cleared' AND subject_id=$1",
      [preclaimed.userId],
    ),
  );
  assert.equal(cleared.n, 1);
  // A verified owner's reset keeps the authenticator and its other factors.
  const guarded = await call("/auth/login", {
    body: { email: owner.email, password: replacement },
  });
  assert.equal(guarded.statusCode, 401, guarded.body);
  assert.equal(guarded.json().code, "MFA_REQUIRED");
  assert.deepEqual(await factors(owner), { mfa: true, codes: 1, passkeys: 1 });
});

test("health imports require the platform import approval outside development", async () => {
  const member = await person();
  const body = {
    source: "apple_health",
    consent: true,
    observations: [
      {
        type: "steps",
        value: 4321,
        unit: "count",
        measuredAt: new Date().toISOString(),
      },
    ],
  };
  const stored = async () =>
    (
      await db.tenant({ ...member, role: "owner" }, (tx) =>
        tx.query(
          "SELECT (SELECT count(*)::int FROM consent_records WHERE user_id=$1 AND document_type LIKE 'wearable:%') AS consents,(SELECT count(*)::int FROM records WHERE kind='wearable' AND owner_user_id=$1) AS imports",
          [member.userId],
        ),
      )
    )[0];
  await withEnv({ NODE_ENV: "production" }, async () => {
    const blocked = await call("/wearables/import", {
      body,
      cookie: member.cookie,
    });
    assert.equal(blocked.statusCode, 503, blocked.body);
    assert.equal(blocked.json().code, "IMPORT_REVIEW_PENDING");
    assert.deepEqual(await stored(), { consents: 0, imports: 0 });
    assert.equal(
      integrationStatus().find((i) => i.id === "apple")?.approved,
      false,
    );
    await withEnv({ FILE_IMPORTS_APPROVED: "true" }, async () => {
      assert.equal(
        integrationStatus().find((i) => i.id === "apple")?.approved,
        true,
      );
      const allowed = await call("/wearables/import", {
        body,
        cookie: member.cookie,
      });
      assert.equal(allowed.statusCode, 200, allowed.body);
    });
  });
  assert.deepEqual(await stored(), { consents: 1, imports: 1 });
});

test("invitation acceptance records explicit registration consent behind the legal gate", async () => {
  const owner = await person(),
    email = `invitee-${randomUUID()}@example.test`;
  const invitation = await call("/invitations", {
    body: { email, role: "subscriber" },
    cookie: owner.cookie,
  });
  assert.equal(invitation.statusCode, 200, invitation.body);
  const token = invitation.json().url.split("/").pop();
  const body = { token, name: "Invited Member", email, password };
  const missing = await call("/invitations/accept", { body });
  assert.equal(missing.statusCode, 400, missing.body);
  await withEnv(
    { NODE_ENV: "production", LEGAL_APPROVED: undefined },
    async () => {
      const pending = await call("/invitations/accept", {
        body: { ...body, accepted: true },
      });
      assert.equal(pending.statusCode, 503, pending.body);
      assert.equal(pending.json().code, "LEGAL_PENDING");
    },
  );
  const [unused] = await db.system((tx) =>
    tx.query("SELECT consumed_at FROM one_time_tokens WHERE token_hash=$1", [
      tokenHash(token),
    ]),
  );
  assert.equal(unused.consumed_at, null);
  const accepted = await call("/invitations/accept", {
    body: { ...body, accepted: true },
  });
  assert.equal(accepted.statusCode, 200, accepted.body);
  const joined = (
    await call("/bootstrap", { cookie: sessionCookie(accepted) })
  ).json().user;
  const consents = await db.tenant({ ...joined, role: "owner" }, (tx) =>
    tx.query(
      "SELECT document_version,granted FROM consent_records WHERE user_id=$1 AND document_type='registration'",
      [joined.userId],
    ),
  );
  assert.deepEqual(consents, [
    {
      document_version: await legalAcceptanceVersion(db, "registration"),
      granted: true,
    },
  ]);
});

function runSeed(env: Record<string, string>) {
  const childEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env))
    if (
      value !== undefined &&
      ![
        "NODE_TEST_CONTEXT",
        "NODE_ENV",
        "DATABASE_URL",
        "DEMO_PASSWORD",
        "PUBLIC_APP_URL",
      ].includes(key)
    )
      childEnv[key] = value;
  return new Promise<{ status: number | null; output: string }>((resolve) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "scripts/seed-demo.ts"],
      {
        cwd: root,
        env: { ...childEnv, ...env } as NodeJS.ProcessEnv,
        timeout: 60000,
      },
    );
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    child.on("close", (status) => resolve({ status, output }));
  });
}
test("synthetic seeds refuse shared databases before connecting", async () => {
  assert.throws(
    () =>
      assertLocalSyntheticTarget("Seed", {
        DATABASE_URL: "postgres://x:y@db.example.com/trainer",
      }),
    /local database/,
  );
  assert.throws(
    () =>
      assertLocalSyntheticTarget("Seed", {
        PUBLIC_APP_URL: "https://staging.example.test",
      }),
    /local PUBLIC_APP_URL/,
  );
  assert.throws(
    () => assertLocalSyntheticTarget("Seed", { NODE_ENV: "staging" }),
    /development/,
  );
  assertLocalSyntheticTarget("Seed", {
    DATABASE_URL: "postgres://x:y@127.0.0.1:5432/trainer",
  });
  const remote = await runSeed({
    DATABASE_URL: "postgres://x:y@db.example.com:5432/trainer",
  });
  assert.notEqual(remote.status, 0);
  assert.match(remote.output, /requires a local database/);
  const loopback = await runSeed({
    DATABASE_URL: "postgres://x:y@127.0.0.1:9/trainer",
  });
  assert.notEqual(loopback.status, 0);
  assert.match(loopback.output, /Set DEMO_PASSWORD/);
});

test("email verification links verify once", async () => {
  const member = await person({ verified: false });
  const requested = await call("/auth/request-verification", {
    body: {},
    cookie: member.cookie,
  });
  assert.equal(requested.statusCode, 200, requested.body);
  assert.equal((await emailJobs(member, "verify")).length, 1);
  const token = await linkToken(member, "verify");
  const verified = await call("/auth/verify-email", { body: { token } });
  assert.equal(verified.statusCode, 200, verified.body);
  const status = await call("/auth/security", { cookie: member.cookie });
  assert.equal(status.json().emailVerified, true);
  const replay = await call("/auth/verify-email", { body: { token } });
  assert.equal(replay.statusCode, 400, replay.body);
  assert.equal(replay.json().code, "LINK_EXPIRED");
});

test("authenticator step-up stamps the session once per code", async () => {
  const member = await person({ mfa: true }),
    plain = await person();
  const wrong = await call("/auth/mfa/verify", {
    body: { password: "NotThePassword2026!", code: code() },
    cookie: member.cookie,
  });
  assert.equal(wrong.statusCode, 401, wrong.body);
  const disabled = await call("/auth/mfa/verify", {
    body: { password, code: "123456" },
    cookie: plain.cookie,
  });
  assert.equal(disabled.statusCode, 409, disabled.body);
  const value = await freshCode(member.userId);
  const verified = await call("/auth/mfa/verify", {
    body: { password, code: value },
    cookie: member.cookie,
  });
  assert.equal(verified.statusCode, 200, verified.body);
  const [session] = await db.system((tx) =>
    tx.query("SELECT mfa_at FROM sessions WHERE token_hash=$1", [
      tokenHash(member.cookie.slice("session=".length)),
    ]),
  );
  assert.ok(Date.now() - new Date(session.mfa_at).getTime() < 60_000);
  const replay = await call("/auth/mfa/verify", {
    body: { password, code: value },
    cookie: member.cookie,
  });
  assert.equal(replay.statusCode, 401, replay.body);
});

test("password change needs the current password and authenticator, then revokes sessions and links", async () => {
  const member = await person({ mfa: true }),
    other = await extraSession(member);
  const magic = await call("/auth/magic-link", {
    body: { email: member.email },
  });
  assert.equal(magic.statusCode, 200, magic.body);
  const magicToken = await linkToken(member, "magic");
  const replacement = "ChangedPassword2026!";
  const wrong = await call("/auth/password", {
    body: { current: "NotThePassword2026!", password: replacement },
    cookie: member.cookie,
  });
  assert.equal(wrong.statusCode, 401, wrong.body);
  const noCode = await call("/auth/password", {
    body: { current: password, password: replacement },
    cookie: member.cookie,
  });
  assert.equal(noCode.statusCode, 401, noCode.body);
  assert.equal(noCode.json().code, "MFA_REQUIRED");
  const [unchanged] = await db.system((tx) =>
    tx.query("SELECT password_hash FROM users WHERE id=$1", [member.userId]),
  );
  assert.equal(unchanged.password_hash, encoded);
  const changed = await call("/auth/password", {
    body: {
      current: password,
      password: replacement,
      code: await freshCode(member.userId),
    },
    cookie: member.cookie,
  });
  assert.equal(changed.statusCode, 200, changed.body);
  assert.match(String(changed.headers["set-cookie"]), /session=;/);
  const [sessions] = await db.system((tx) =>
    tx.query("SELECT count(*)::int AS n FROM sessions WHERE user_id=$1", [
      member.userId,
    ]),
  );
  assert.equal(sessions.n, 0);
  assert.equal(
    (await call("/auth/security", { cookie: other })).statusCode,
    401,
  );
  const consumed = await call("/auth/magic-link/consume", {
    body: { token: magicToken, code: await freshCode(member.userId) },
  });
  assert.equal(consumed.statusCode, 400, consumed.body);
});

test("signing out other sessions keeps only the current session", async () => {
  const member = await person(),
    other = await extraSession(member);
  const revoked = await call("/auth/sessions/revoke", {
    body: {},
    cookie: member.cookie,
  });
  assert.equal(revoked.statusCode, 200, revoked.body);
  assert.equal(
    (await call("/auth/security", { cookie: member.cookie })).statusCode,
    200,
  );
  assert.equal(
    (await call("/auth/security", { cookie: other })).statusCode,
    401,
  );
});
