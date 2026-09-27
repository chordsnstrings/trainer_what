import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  accountsContext,
  ok,
  password,
  sessionCookie,
  type Person,
} from "./accounts-fixtures.ts";

let ctx: Awaited<ReturnType<typeof accountsContext>>;
before(async () => {
  ctx = await accountsContext();
});
after(async () => ctx.close());

const reason = "Verified identity by video call, ticket 4411";
async function operator(role: "admin" | "support") {
  return ctx.person({ platformRole: role, mfa: true, mfaFresh: true });
}
async function issue(
  op: Person,
  target: string,
  extra: Record<string, unknown> = {},
) {
  return ctx.call("/admin/account-recovery", {
    body: {
      email: target,
      reason,
      code: await ctx.freshCode(op.userId),
      ...extra,
    },
    cookie: op.cookie,
  });
}
const tokenOf = (r: any) => String(r.json().url).split("/").pop()!;

test("only a Superadmin or support operator with a fresh authenticator can issue a recovery link; trainers cannot reset followers", async () => {
  const trainer = await ctx.person({ mfa: true, mfaFresh: true }),
    follower = await ctx.person({
      role: "subscriber",
      tenantId: trainer.tenantId,
    });
  const refused = await issue(trainer, follower.email);
  assert.equal(refused.statusCode, 403);
  assert.equal(refused.json().code, "OPERATOR_SCOPE");
  const admin = await operator("admin");
  const missing = await ctx.call("/admin/account-recovery", {
    body: { email: follower.email, reason },
    cookie: admin.cookie,
  });
  assert.equal(missing.statusCode, 400, "the authenticator code is required");
  const wrong = await ctx.call("/admin/account-recovery", {
    body: { email: follower.email, reason, code: "000000" },
    cookie: admin.cookie,
  });
  assert.equal(wrong.statusCode, 401);
  const short = await issue(admin, follower.email, { reason: "too short" });
  assert.equal(short.statusCode, 400, "a reason is recorded");
  const noMfaAdmin = await ctx.person({ platformRole: "admin" });
  const unenrolled = await ctx.call("/admin/account-recovery", {
    body: { email: follower.email, reason, code: "123456" },
    cookie: noMfaAdmin.cookie,
  });
  assert.equal(unenrolled.json().code, "OPERATOR_MFA_REQUIRED");
  assert.equal((await issue(admin, admin.email)).json().code, "SELF_RECOVERY");
  assert.equal((await issue(admin, "nobody@example.test")).statusCode, 404);
  const support = await operator("support");
  const platformTarget = await issue(support, admin.email);
  assert.equal(
    platformTarget.statusCode,
    403,
    "support cannot recover platform accounts",
  );
  const issued = await issue(support, follower.email);
  const body = ok(issued);
  assert.match(body.url, /^http:\/\/localhost:3000\/account-recovery\//);
  assert.ok(Date.parse(body.expiresAt) - Date.now() <= 30 * 60 * 1000 + 5000);
  const [audit] = await ctx.db.system((tx) =>
    tx.query(
      "SELECT actor_id,data FROM admin_operations_audit WHERE action='account.recovery_link_issued' AND subject_id=$1",
      [follower.userId],
    ),
  );
  assert.equal(audit.actor_id, support.userId);
  assert.equal(audit.data.reason, reason);
  assert.doesNotMatch(JSON.stringify(audit), new RegExp(tokenOf(issued)));
  const [stored] = await ctx.db.system((tx) =>
    tx.query(
      "SELECT token_hash FROM account_recovery_grants WHERE user_id=$1",
      [follower.userId],
    ),
  );
  assert.notEqual(
    stored.token_hash,
    tokenOf(issued),
    "only the hash is stored",
  );
  const [email] = await ctx.emailJobs(
    trainer.tenantId,
    follower.email,
    "recovery-issued",
  );
  assert.doesNotMatch(
    email.data.text,
    /account-recovery\//,
    "the link is never emailed",
  );
  const list = ok(
    await ctx.call("/admin/account-recovery", { cookie: support.cookie }),
  );
  assert.equal(list.grants[0].status, "active");
  assert.equal(list.grants[0].targetEmail, follower.email);
});

test("the link sets a new password once, signs out every session, and still requires the member's own authenticator", async () => {
  const admin = await operator("admin"),
    member = await ctx.person({ mfa: true });
  const issued = ok(await issue(admin, member.email));
  const token = String(issued.url).split("/").pop()!;
  const inspect = ok(
    await ctx.call("/auth/account-recovery/inspect", { body: { token } }),
  );
  assert.equal(inspect.mfaRequired, true);
  const withoutCode = await ctx.call("/auth/account-recovery", {
    body: { token, password: "RecoveredPassword2026!" },
  });
  assert.equal(withoutCode.statusCode, 401);
  assert.equal(withoutCode.json().code, "MFA_REQUIRED");
  assert.equal(
    await ctx.sessionCount(member.userId),
    1,
    "nothing changed without the code",
  );
  const recovered = await ctx.call("/auth/account-recovery", {
    body: {
      token,
      password: "RecoveredPassword2026!",
      code: await ctx.freshCode(member.userId),
    },
  });
  assert.match(ok(recovered).message, /authenticator/);
  assert.equal(await ctx.sessionCount(member.userId), 0);
  const [security] = await ctx.db.system((tx) =>
    tx.query("SELECT enabled FROM user_security WHERE user_id=$1", [
      member.userId,
    ]),
  );
  assert.equal(security.enabled, true, "the authenticator is kept");
  assert.equal(
    (await ctx.call("/auth/login", { body: { email: member.email, password } }))
      .statusCode,
    401,
  );
  const login = await ctx.call("/auth/login", {
    body: {
      email: member.email,
      password: "RecoveredPassword2026!",
      code: await ctx.freshCode(member.userId),
    },
  });
  ok(login);
  const reuse = await ctx.call("/auth/account-recovery", {
    body: { token, password: "AnotherPassword2026!" },
  });
  assert.equal(reuse.json().code, "LINK_EXPIRED");
  const [used] = await ctx.db.system((tx) =>
    tx.query(
      "SELECT actor_id,data FROM admin_operations_audit WHERE action='account.recovery_link_used' AND subject_id=$1",
      [member.userId],
    ),
  );
  assert.equal(used.data.issuedBy, admin.userId);
  assert.equal(used.data.authenticatorVerified, true);
  const [changed] = await ctx.emailJobs(
    member.tenantId,
    member.email,
    "recovery-used",
  );
  assert.match(changed.data.text, /password was changed/);
  const account = ok(
    await ctx.call("/account", { cookie: sessionCookie(login) }),
  );
  assert.ok(account.notices.some((n: any) => n.kind === "password_recovered"));
});

test("recovery links expire, are replaced by a newer link, can be revoked, and are limited per account", async () => {
  const admin = await operator("admin"),
    member = await ctx.person();
  const first = tokenOf(await issue(admin, member.email));
  const second = tokenOf(await issue(admin, member.email));
  assert.equal(
    (
      await ctx.call("/auth/account-recovery/inspect", {
        body: { token: first },
      })
    ).statusCode,
    400,
    "a newer link replaces the older one",
  );
  await ctx.db.system((tx) =>
    tx.query(
      "UPDATE account_recovery_grants SET expires_at=now()-interval '1 second' WHERE token_hash IS NOT NULL AND user_id=$1 AND revoked_at IS NULL",
      [member.userId],
    ),
  );
  const expired = await ctx.call("/auth/account-recovery", {
    body: { token: second, password: "ExpiredPassword2026!" },
  });
  assert.equal(expired.json().code, "LINK_EXPIRED");
  const third = ok(await issue(admin, member.email));
  ok(
    await ctx.call(`/admin/account-recovery/${third.id}/revoke`, {
      body: {},
      cookie: admin.cookie,
    }),
  );
  assert.equal(
    (
      await ctx.call("/auth/account-recovery", {
        body: {
          token: tokenOf({ json: () => third }),
          password: "RevokedPassword2026!",
        },
      })
    ).json().code,
    "LINK_EXPIRED",
  );
  const limited = await issue(admin, member.email);
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.json().code, "RECOVERY_LIMIT");
  // Wrong authenticator codes use up a link after five attempts.
  const guarded = await ctx.person({ mfa: true });
  const token = tokenOf(await issue(admin, guarded.email));
  for (let i = 0; i < 5; i++)
    assert.equal(
      (
        await ctx.call("/auth/account-recovery", {
          body: { token, password: "GuessedPassword2026!", code: "000000" },
        })
      ).statusCode,
      401,
    );
  assert.equal(
    (
      await ctx.call("/auth/account-recovery", {
        body: {
          token,
          password: "GuessedPassword2026!",
          code: await ctx.freshCode(guarded.userId),
        },
      })
    ).json().code,
    "LINK_EXPIRED",
  );
});

test("links issued by an operator who is later demoted stop working at once", async () => {
  const support = await operator("support"),
    member = await ctx.person();
  const token = tokenOf(await issue(support, member.email));
  ok(await ctx.call("/auth/account-recovery/inspect", { body: { token } }));
  await ctx.db.system((tx) =>
    tx.query("UPDATE users SET platform_role='none' WHERE id=$1", [
      support.userId,
    ]),
  );
  for (const path of [
    "/auth/account-recovery/inspect",
    "/auth/account-recovery",
  ]) {
    const r = await ctx.call(path, {
      body: path.endsWith("inspect")
        ? { token }
        : { token, password: "DemotedIssuer2026!" },
    });
    assert.equal(r.statusCode, 400, r.body);
    assert.equal(r.json().code, "LINK_EXPIRED");
  }
  const [u] = await ctx.db.system((tx) =>
    tx.query("SELECT password_hash FROM users WHERE id=$1", [member.userId]),
  );
  assert.equal(u.password_hash, ctx.encoded, "the password is unchanged");
});
