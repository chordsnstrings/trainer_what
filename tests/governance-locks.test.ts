import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { governanceFixture, password } from "./governance-fixtures.ts";
import { newToken, tokenHash } from "../apps/api/src/auth.ts";
import { sealContexts, sealValue } from "../apps/api/src/sealing.ts";
import { totpAt } from "../apps/api/src/security.ts";
import {
  insertAccountSession,
  replaceRecoveryCodes,
} from "../apps/api/src/account-completion.ts";
import { assertSignInAllowed } from "../apps/api/src/account-governance.ts";
import {
  assignPlatformRole,
  resetUserMfa,
} from "../apps/api/src/operator-actions.ts";

let f: Awaited<ReturnType<typeof governanceFixture>>;
const savedKey = process.env.SECURITY_ENCRYPTION_KEY;
before(async () => {
  process.env.SECURITY_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  f = await governanceFixture();
});
after(async () => {
  await f?.close();
  if (savedKey === undefined)
    Reflect.deleteProperty(process.env, "SECURITY_ENCRYPTION_KEY");
  else process.env.SECURITY_ENCRYPTION_KEY = savedKey;
});
const lock = (admin: { cookie: string }, userId: string, reason = "Synthetic account takeover review") =>
  f.call(`/admin/governance/accounts/${userId}/lock`, {
    body: { reason },
    cookie: admin.cookie,
  });

test("locking needs a fresh Super admin, refuses self-lock and revokes every session", async () => {
  const admin = await f.operator("admin"),
    stale = await f.operator("admin", false),
    support = await f.operator("support");
  const target = await f.person();
  const second = await f.session(target.userId, target.tenantId, false);
  assert.equal((await lock(stale, target.userId)).json().code, "MFA_STEP_UP");
  assert.equal((await lock(support, target.userId)).json().code, "OPERATOR_SCOPE");
  const self = await lock(admin, admin.userId);
  assert.equal(self.statusCode, 409, self.body);
  assert.equal(self.json().code, "SELF_LOCK");
  const locked = await lock(admin, target.userId);
  assert.equal(locked.statusCode, 200, locked.body);
  assert.equal(locked.json().sessionsRevoked, 2);
  for (const cookie of [target.cookie, second]) {
    const r = await f.call("/bootstrap", { cookie });
    assert.equal(r.statusCode, 401, r.body);
  }
  const again = await lock(admin, target.userId);
  assert.equal(again.json().code, "ACCOUNT_ALREADY_LOCKED");
  const audit = await f.db.system((tx) =>
    tx.query(
      "SELECT data FROM admin_operations_audit WHERE action='account.locked' AND subject_id=$1",
      [target.userId],
    ),
  );
  assert.equal(audit.length, 1);
  assert.equal(audit[0].data.sessionsRevoked, 2);
  const view = await f.call(
    `/admin/governance/accounts?email=${encodeURIComponent(target.email)}`,
    { cookie: admin.cookie },
  );
  assert.equal(view.statusCode, 200, view.body);
  assert.equal(view.json().account.locks[0].status, "active");
  assert.ok(view.json().locked.some((l: any) => l.user_id === target.userId));
});

test("a Super admin can lock another Super admin but one active Super admin always remains", async () => {
  const first = await f.operator("admin"),
    second = await f.operator("admin");
  const r = await lock(first, second.userId);
  assert.equal(r.statusCode, 200, r.body);
  // The locked Super admin can no longer act: the old session is gone and no
  // new session can be created, even with a fresh authenticator code.
  const back = await f.call(`/admin/governance/accounts/${first.userId}/lock`, {
    body: { reason: "Synthetic retaliation attempt" },
    cookie: second.cookie,
  });
  assert.equal(back.statusCode, 401, back.body);
  const fresh = await f.session(second.userId, second.tenantId).catch((e) => e);
  assert.equal(fresh.code, "TBLCK");
  const self = await lock(first, first.userId);
  assert.equal(self.json().code, "SELF_LOCK");
  const [{ n }] = await f.db.system((tx) =>
    tx.query(
      "SELECT count(*)::int AS n FROM users u WHERE u.id=ANY($1::uuid[]) AND NOT EXISTS(SELECT 1 FROM account_locks l WHERE l.user_id=u.id AND l.status='active')",
      [[first.userId, second.userId]],
    ),
  );
  assert.equal(n, 1);
});

test("every sign-in path is refused for a locked account with a clear message", async () => {
  const admin = await f.operator("admin");
  const target = await f.person();
  const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
  await f.db.system((tx) =>
    tx.query(
      "INSERT INTO user_security(user_id,totp_secret,enabled,last_counter) VALUES($1,$2,true,-1)",
      [target.userId, sealValue(sealContexts.authenticator(target.userId), secret)],
    ),
  );
  const codes = await f.db.system((tx) => replaceRecoveryCodes(tx, target.userId));
  // A current authenticator code (the counter is reset so each use is fresh).
  const code = async () => {
    await f.db.system((tx) =>
      tx.query("UPDATE user_security SET last_counter=-1 WHERE user_id=$1", [target.userId]),
    );
    return totpAt(secret, Math.floor(Date.now() / 30000));
  };
  assert.equal((await lock(admin, target.userId)).statusCode, 200);

  // Password: the lock is disclosed only after the password is proven.
  const wrong = await f.call("/auth/login", {
    body: { email: target.email, password: "Wrong-password-2026!" },
  });
  assert.equal(wrong.statusCode, 401);
  assert.equal(wrong.json().code, "INVALID_LOGIN");
  const login = await f.call("/auth/login", {
    body: { email: target.email, password, code: await code() },
  });
  assert.equal(login.statusCode, 423, login.body);
  assert.equal(login.json().code, "ACCOUNT_LOCKED");
  assert.match(login.json().message, /locked/);
  assert.equal(f.cookieOf(login), "");

  // Magic link: no link is issued, and a link issued earlier cannot be used.
  const before = await f.db.tenant(f.scoped(target.tenantId), (tx) =>
    tx.query("SELECT count(*)::int AS n FROM jobs WHERE intent_key LIKE 'magic:%'"),
  );
  const request = await f.call("/auth/magic-link", { body: { email: target.email } });
  assert.equal(request.statusCode, 200, request.body);
  const after = await f.db.tenant(f.scoped(target.tenantId), (tx) =>
    tx.query("SELECT count(*)::int AS n FROM jobs WHERE intent_key LIKE 'magic:%'"),
  );
  assert.equal(after[0].n, before[0].n);
  const token = newToken();
  await f.db.system((tx) =>
    tx.query(
      "INSERT INTO one_time_tokens(token_hash,purpose,user_id,tenant_id,payload,expires_at) VALUES($1,'magic',$2,$3,$4,now()+interval '15 minutes')",
      [tokenHash(token), target.userId, target.tenantId, JSON.stringify({ origin: "http://localhost:3000" })],
    ),
  );
  const magic = await f.call("/auth/magic-link/consume", {
    body: { token, code: await code() },
  });
  assert.equal(magic.statusCode, 423, magic.body);
  assert.equal(magic.json().code, "ACCOUNT_LOCKED");

  // Recovery code: refused, and the code and authenticator are not consumed.
  const recover = await f.call("/auth/mfa/recover", {
    body: { email: target.email, password, recoveryCode: codes[0] },
  });
  assert.equal(recover.statusCode, 423, recover.body);
  const [kept] = await f.db.system((tx) =>
    tx.query(
      "SELECT (SELECT count(*)::int FROM mfa_recovery_codes WHERE user_id=$1) AS codes,(SELECT enabled FROM user_security WHERE user_id=$1) AS enabled",
      [target.userId],
    ),
  );
  assert.equal(kept.codes, 10);
  assert.equal(kept.enabled, true);

  // Passkey sign-in and any future provider path create sessions through the
  // same shared check.
  await assert.rejects(
    f.db.system((tx) => insertAccountSession(tx, target.userId, target.tenantId, true)),
    (e: any) => e.statusCode === 423 && e.code === "ACCOUNT_LOCKED",
  );
  await assert.rejects(
    f.db.system((tx) => assertSignInAllowed(tx, target.userId)),
    (e: any) => e.code === "ACCOUNT_LOCKED",
  );
  // Database backstop: a raw session insert is refused too.
  await assert.rejects(
    f.db.system((tx) =>
      tx.query(
        "INSERT INTO sessions(token_hash,user_id,tenant_id,expires_at) VALUES($1,$2,$3,now()+interval '1 day')",
        [tokenHash(newToken()), target.userId, target.tenantId],
      ),
    ),
    (e: any) => e.code === "TBLCK",
  );

  // Joining another coach or accepting an invitation with the existing account.
  const coach = await f.person();
  const slug = (
    await f.db.system((tx) => tx.query("SELECT slug FROM tenants WHERE id=$1", [coach.tenantId]))
  )[0].slug;
  const enroll = await f.call("/auth/enroll", {
    body: { name: "Synthetic Locked", email: target.email, password, coachSlug: slug, accepted: true, code: await code() },
  });
  assert.equal(enroll.statusCode, 423, enroll.body);
  const invite = await f.call("/invitations", {
    body: { email: target.email, role: "subscriber" },
    cookie: coach.cookie,
  });
  assert.equal(invite.statusCode, 200, invite.body);
  const accept = await f.call("/invitations/accept", {
    body: {
      token: invite.json().url.split("/").pop(),
      name: "Synthetic Locked",
      email: target.email,
      password,
      accepted: true,
      code: await code(),
    },
  });
  assert.equal(accept.statusCode, 423, accept.body);
  const memberships = await f.db.system((tx) =>
    tx.query("SELECT tenant_id FROM memberships WHERE user_id=$1", [target.userId]),
  );
  assert.deepEqual(memberships.map((m) => m.tenant_id), [target.tenantId]);
});

test("a session row that survives a lock is rejected, and unlocking restores sign-in", async () => {
  const admin = await f.operator("admin");
  const target = await f.person();
  // Simulate a lock recorded while a session still exists (for example by a
  // replica or a manual repair): session resolution itself rejects it.
  const lockId = randomUUID();
  await f.db.system((tx) =>
    tx.query(
      "INSERT INTO account_locks(id,user_id,reason,locked_by) VALUES($1,$2,'Synthetic direct lock record',$3)",
      [lockId, target.userId, admin.userId],
    ),
  );
  assert.equal((await f.call("/bootstrap", { cookie: target.cookie })).statusCode, 401);
  const wrong = await f.call(`/admin/governance/accounts/${target.userId}/unlock`, {
    body: { lockId, revision: 2, reason: "Synthetic review complete" },
    cookie: admin.cookie,
  });
  assert.equal(wrong.statusCode, 409, wrong.body);
  const unlocked = await f.call(`/admin/governance/accounts/${target.userId}/unlock`, {
    body: { lockId, revision: 1, reason: "Synthetic review complete" },
    cookie: admin.cookie,
  });
  assert.equal(unlocked.statusCode, 200, unlocked.body);
  assert.equal(unlocked.json().lock.status, "lifted");
  const login = await f.call("/auth/login", { body: { email: target.email, password } });
  assert.equal(login.statusCode, 200, login.body);
  assert.equal(
    (await f.call("/bootstrap", { cookie: f.cookieOf(login) })).statusCode,
    200,
  );
  // History is retained: a lifted lock cannot be edited or deleted.
  await assert.rejects(
    f.db.system((tx) => tx.query("DELETE FROM account_locks WHERE id=$1", [lockId])),
  );
});

// Runs last in this file: it demotes the file's earlier Super admins so the
// "last active Super admin" count is exact. Each test file has its own database.
test("host operator commands honour account locks and keep one active Super admin", async () => {
  const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
  await f.db.system((tx) =>
    tx.query("UPDATE users SET platform_role='none' WHERE platform_role='admin'"),
  );
  const withAuthenticator = async (userId: string) =>
    f.db.system((tx) =>
      tx.query(
        "INSERT INTO user_security(user_id,totp_secret,enabled,last_counter) VALUES($1,$2,true,-1)",
        [userId, sealValue(sealContexts.authenticator(userId), secret)],
      ),
    );
  const code = async (userId: string) => {
    await f.db.system((tx) =>
      tx.query("UPDATE user_security SET last_counter=-1 WHERE user_id=$1", [userId]),
    );
    return totpAt(secret, Math.floor(Date.now() / 30000));
  };
  const emailOf = async (userId: string) =>
    (
      await f.db.system((tx) => tx.query("SELECT email FROM users WHERE id=$1", [userId]))
    )[0].email as string;
  const active = await f.operator("admin"),
    locked = await f.operator("admin"),
    member = await f.person();
  for (const p of [active, locked, member]) await withAuthenticator(p.userId);
  const lockRow = (userId: string, by: string) =>
    f.db.system((tx) =>
      tx.query(
        "INSERT INTO account_locks(id,user_id,reason,locked_by) VALUES($1,$2,'Synthetic host command lock',$3)",
        [randomUUID(), userId, by],
      ),
    );
  await lockRow(locked.userId, active.userId);
  const reason = "Synthetic host command review fixture";
  const role = async (actor: string, target: string, to: string) =>
    assignPlatformRole(f.db, {
      actorEmail: await emailOf(actor),
      actorCode: await code(actor),
      targetEmail: await emailOf(target),
      role: to,
      reason,
    });
  // A locked Super admin has no host authority either.
  await assert.rejects(role(locked.userId, member.userId, "support"), /locked/);
  await assert.rejects(
    resetUserMfa(f.db, {
      actorEmail: await emailOf(locked.userId),
      actorCode: await code(locked.userId),
      targetEmail: await emailOf(member.userId),
      reason,
    }),
    /locked/,
  );
  // With one active and one locked Super admin, the active one is the last.
  await assert.rejects(
    role(active.userId, active.userId, "none"),
    /last one \(locked Superadmins do not count\)/,
  );
  // Demoting the locked one leaves the active one in place.
  const demoted = await role(active.userId, locked.userId, "none");
  assert.deepEqual([demoted.changed, demoted.from, demoted.to], [true, "admin", "none"]);
  // With every Super admin locked, recovery by a verified account is open,
  // but a locked account cannot recover itself.
  await assert.rejects(role(member.userId, member.userId, "admin"), /verified Superadmin/);
  await lockRow(active.userId, member.userId);
  await assert.rejects(role(active.userId, active.userId, "admin"));
  const recovered = await role(member.userId, member.userId, "admin");
  assert.deepEqual([recovered.changed, recovered.to], [true, "admin"]);
  const lockedRecovery = await f.person();
  await withAuthenticator(lockedRecovery.userId);
  await lockRow(lockedRecovery.userId, member.userId);
  await f.db.system((tx) =>
    tx.query("UPDATE users SET platform_role='none' WHERE id=$1", [member.userId]),
  );
  await assert.rejects(
    role(lockedRecovery.userId, lockedRecovery.userId, "admin"),
    /locked account cannot receive/,
  );
});

test("a Super admin can confirm another account's email address once, with an audited reason", async () => {
  const admin = await f.operator("admin"),
    stale = await f.operator("admin", false),
    support = await f.operator("support");
  const target = await f.person();
  await f.db.system((tx) =>
    tx.query("UPDATE users SET email_verified=false WHERE id=$1", [target.userId]),
  );
  const verify = (op: { cookie: string }, userId = target.userId) =>
    f.call(`/admin/governance/accounts/${userId}/verify-email`, {
      body: { reason: "Owner test account while email delivery is off" },
      cookie: op.cookie,
    });
  assert.equal((await verify(stale)).json().code, "MFA_STEP_UP");
  assert.equal((await verify(support)).json().code, "OPERATOR_SCOPE");
  const done = await verify(admin);
  assert.equal(done.statusCode, 200, done.body);
  const [u] = await f.db.system((tx) =>
    tx.query("SELECT email_verified FROM users WHERE id=$1", [target.userId]),
  );
  assert.equal(u.email_verified, true);
  assert.equal((await verify(admin)).json().code, "EMAIL_ALREADY_VERIFIED");
  const audit = await f.db.system((tx) =>
    tx.query(
      "SELECT data FROM admin_operations_audit WHERE action='account.email_verified_by_operator' AND subject_id=$1",
      [target.userId],
    ),
  );
  assert.equal(audit.length, 1);
  assert.match(audit[0].data.reason, /email delivery is off/);
  const notices = await f.db.system((tx) =>
    tx.query("SELECT kind FROM account_notices WHERE user_id=$1", [target.userId]),
  );
  assert.ok(notices.some((n: any) => n.kind === "email_verified_by_support"));
});
