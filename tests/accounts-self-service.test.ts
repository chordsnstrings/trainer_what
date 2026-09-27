import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import {
  accountsContext,
  ok,
  password,
  sessionCookie,
  withEnv,
} from "./accounts-fixtures.ts";
import { newToken, tokenHash } from "../apps/api/src/auth.ts";

let ctx: Awaited<ReturnType<typeof accountsContext>>;
before(async () => {
  ctx = await accountsContext();
});
after(async () => ctx.close());

const linkFrom = (job: any) =>
  String(job.data.text).split("\n")[0].split("/").pop()!;

test("every account type changes its display name through an audited API that never records the value", async () => {
  const owner = await ctx.person();
  const members = [
    owner,
    await ctx.person({ role: "staff", tenantId: owner.tenantId }),
    await ctx.person({ role: "finance", tenantId: owner.tenantId }),
    await ctx.person({ role: "subscriber", tenantId: owner.tenantId }),
    await ctx.person({ platformRole: "admin" }),
  ];
  for (const [i, p] of members.entries()) {
    const name = `Renamed Person ${i}`;
    const r = await ctx.call("/account/profile", {
      method: "PATCH",
      body: { name },
      cookie: p.cookie,
    });
    assert.equal(ok(r).name, name);
    const account = ok(await ctx.call("/account", { cookie: p.cookie }));
    assert.equal(account.profile.name, name);
    const [audit] = await ctx.events(p.tenantId, "account.name_changed", p.userId);
    assert.deepEqual(audit.data, { fields: ["name"] });
    assert.doesNotMatch(JSON.stringify(audit), /Renamed Person/);
  }
  for (const name of ["x", "Tab\tName", "a".repeat(101)])
    assert.equal(
      (
        await ctx.call("/account/profile", {
          method: "PATCH",
          body: { name },
          cookie: owner.cookie,
        })
      ).statusCode,
      400,
    );
  assert.equal(
    (await ctx.call("/account/profile", { method: "PATCH", body: { name: "Anonymous" } }))
      .statusCode,
    401,
  );
});

test("an email change needs the current password and a fresh authenticator code and applies only after the new address verifies", async () => {
  const p = await ctx.person({ mfa: true }),
    next = `moved-${randomUUID()}@example.test`;
  const other = "session=" + newToken();
  await ctx.db.system((tx) =>
    tx.query(
      "INSERT INTO sessions(token_hash,user_id,tenant_id,expires_at) VALUES($1,$2,$3,now()+interval '7 days')",
      [tokenHash(other.slice(8)), p.userId, p.tenantId],
    ),
  );
  const noPassword = await ctx.call("/account/email", {
    body: { email: next },
    cookie: p.cookie,
  });
  assert.equal(noPassword.statusCode, 401);
  assert.equal(noPassword.json().code, "INVALID_PASSWORD");
  const noCode = await ctx.call("/account/email", {
    body: { email: next, password },
    cookie: p.cookie,
  });
  assert.equal(noCode.statusCode, 401);
  assert.equal(noCode.json().code, "MFA_REQUIRED");
  ok(
    await ctx.call("/account/email", {
      body: { email: next.toUpperCase(), password, code: await ctx.freshCode(p.userId) },
      cookie: p.cookie,
    }),
  );
  const [link] = await ctx.emailJobs(p.tenantId, next, "email-change");
  assert.match(link.data.text, /\/verify-email-change\//);
  assert.equal(link.data.sensitive, true, "the bearer link is scrubbed after sending");
  const [notice] = await ctx.emailJobs(p.tenantId, p.email, "email-change-notice");
  assert.match(notice.data.text, /applies only after the new address is confirmed/);
  assert.doesNotMatch(notice.data.text, /verify-email-change/);
  let account = ok(await ctx.call("/account", { cookie: p.cookie }));
  assert.equal(account.profile.email, p.email, "nothing changes before verification");
  assert.equal(account.pendingEmailChange.newEmail, next);
  // Old credentials still work until the new address is confirmed.
  assert.equal(
    (
      await ctx.call("/auth/login", {
        body: { email: p.email, password, code: await ctx.freshCode(p.userId) },
      })
    ).statusCode,
    200,
  );
  const confirmed = await ctx.call("/account/email/confirm", {
    body: { token: linkFrom(link) },
    cookie: p.cookie,
  });
  ok(confirmed);
  account = ok(await ctx.call("/account", { cookie: p.cookie }));
  assert.equal(account.profile.email, next);
  assert.equal(account.profile.emailVerified, true);
  assert.equal(account.pendingEmailChange, null);
  assert.ok(account.notices.some((n: any) => n.kind === "email_changed"));
  assert.equal(
    (await ctx.call("/account", { cookie: other })).statusCode,
    401,
    "other devices are signed out",
  );
  const [changed] = await ctx.emailJobs(p.tenantId, p.email, "email-changed");
  assert.match(changed.data.text, /was changed/);
  assert.equal((await ctx.events(p.tenantId, "account.email_changed", p.userId)).length, 1);
  const replay = await ctx.call("/account/email/confirm", {
    body: { token: linkFrom(link) },
  });
  assert.equal(replay.statusCode, 400);
  assert.equal(replay.json().code, "LINK_EXPIRED");
});

test("an email change never discloses or takes another account's address, including a concurrent claim before confirmation", async () => {
  const p = await ctx.person(),
    holder = await ctx.person();
  const taken = await ctx.call("/account/email", {
    body: { email: holder.email, password },
    cookie: p.cookie,
  });
  assert.equal(ok(taken).message.includes("Check the new address"), true);
  assert.equal((await ctx.emailJobs(p.tenantId, holder.email, "email-change")).length, 0);
  const [warning] = await ctx.emailJobs(p.tenantId, holder.email, "email-change-taken");
  assert.match(warning.data.text, /already belongs to an account/);
  const free = `race-${randomUUID()}@example.test`;
  ok(
    await ctx.call("/account/email", {
      body: { email: free, password },
      cookie: p.cookie,
    }),
  );
  const [open] = await ctx.db.system((tx) =>
    tx.query(
      "SELECT count(*)::int n FROM email_change_requests WHERE user_id=$1 AND completed_at IS NULL AND cancelled_at IS NULL",
      [p.userId],
    ),
  );
  assert.equal(open.n, 1, "a new request replaces the previous one");
  const [link] = await ctx.emailJobs(p.tenantId, free, "email-change");
  // Someone else registers the address before the owner opens the link.
  await ctx.db.system((tx) =>
    tx.query(
      "INSERT INTO users(id,name,email,password_hash) VALUES($1,'Concurrent claim',$2,'unusable:fixture')",
      [randomUUID(), free],
    ),
  );
  const refused = await ctx.call("/account/email/confirm", {
    body: { token: linkFrom(link) },
  });
  assert.equal(refused.statusCode, 409, refused.body);
  assert.equal(refused.json().code, "EMAIL_IN_USE");
  const [row] = await ctx.db.system((tx) =>
    tx.query(
      "SELECT u.email,r.cancelled_at IS NOT NULL AS cancelled FROM users u JOIN email_change_requests r ON r.user_id=u.id AND r.new_email=$2 WHERE u.id=$1",
      [p.userId, free],
    ),
  );
  assert.deepEqual(row, { email: p.email, cancelled: true });
  const same = await ctx.call("/account/email", {
    body: { email: p.email, password },
    cookie: p.cookie,
  });
  assert.equal(same.json().code, "EMAIL_UNCHANGED");
  // A pending change can be withdrawn.
  ok(
    await ctx.call("/account/email", {
      body: { email: `withdrawn-${randomUUID()}@example.test`, password },
      cookie: p.cookie,
    }),
  );
  ok(await ctx.call("/account/email/cancel", { body: {}, cookie: p.cookie }));
  assert.equal(ok(await ctx.call("/account", { cookie: p.cookie })).pendingEmailChange, null);
});

test("without production email delivery the change is refused and the account screen says so", async () => {
  const p = await ctx.person();
  await withEnv({ NODE_ENV: "production" }, async () => {
    const account = ok(await ctx.call("/account", { cookie: p.cookie }));
    assert.equal(account.emailDelivery.configured, false);
    const refused = await ctx.call("/account/email", {
      body: { email: `later-${randomUUID()}@example.test`, password },
      cookie: p.cookie,
    });
    assert.equal(refused.statusCode, 503, refused.body);
    assert.match(refused.json().message, /Email delivery must be configured/);
    await withEnv(
      { EMAIL_API_URL: "https://mail.example.test/send", EMAIL_API_KEY: "fixture" },
      async () => {
        assert.equal(
          ok(await ctx.call("/account", { cookie: p.cookie })).emailDelivery.configured,
          true,
        );
      },
    );
  });
  const [count] = await ctx.db.system((tx) =>
    tx.query("SELECT count(*)::int n FROM email_change_requests WHERE user_id=$1", [p.userId]),
  );
  assert.equal(count.n, 0);
});

test("password changes work for trainers and followers; passwordless accounts set one only after a fresh sign-in", async () => {
  for (const role of ["owner", "subscriber"]) {
    const owner = role === "owner" ? undefined : await ctx.person();
    const p = await ctx.person({ role, tenantId: owner?.tenantId });
    const wrong = await ctx.call("/auth/password", {
      body: { current: "incorrect-password", password: "ChangedPassword2026!" },
      cookie: p.cookie,
    });
    assert.equal(wrong.statusCode, 401);
    const changed = await ctx.call("/auth/password", {
      body: { current: password, password: "ChangedPassword2026!" },
      cookie: p.cookie,
    });
    ok(changed);
    assert.equal(await ctx.sessionCount(p.userId), 0, "every session ends");
    ok(
      await ctx.call("/auth/login", {
        body: { email: p.email, password: "ChangedPassword2026!" },
      }),
    );
  }
  const passwordless = await ctx.person({ passwordHash: "unusable:" + randomUUID() });
  const account = ok(await ctx.call("/account", { cookie: passwordless.cookie }));
  assert.equal(account.profile.hasPassword, false);
  assert.equal(account.recentSignIn, true);
  await ctx.db.system((tx) =>
    tx.query("UPDATE sessions SET created_at=now()-interval '1 hour' WHERE user_id=$1", [
      passwordless.userId,
    ]),
  );
  const stale = await ctx.call("/account/password/set", {
    body: { password: "FirstPassword2026!" },
    cookie: passwordless.cookie,
  });
  assert.equal(stale.statusCode, 403);
  assert.equal(stale.json().code, "REAUTH_REQUIRED");
  await ctx.db.system((tx) =>
    tx.query("UPDATE sessions SET created_at=now() WHERE user_id=$1", [passwordless.userId]),
  );
  ok(
    await ctx.call("/account/password/set", {
      body: { password: "FirstPassword2026!" },
      cookie: passwordless.cookie,
    }),
  );
  const login = await ctx.call("/auth/login", {
    body: { email: passwordless.email, password: "FirstPassword2026!" },
  });
  ok(login);
  assert.ok(sessionCookie(login));
  const again = await ctx.call("/account/password/set", {
    body: { password: "SecondPassword2026!" },
    cookie: passwordless.cookie,
  });
  assert.equal(again.json().code, "PASSWORD_EXISTS");
  const [audit] = await ctx.events(passwordless.tenantId, "security.password_set");
  assert.equal(audit.subject_id, passwordless.userId);
});

test("account notices are private to their owner and can be marked read", async () => {
  const p = await ctx.person(),
    q = await ctx.person();
  await ctx.db.system(async (tx) => {
    for (const user of [p, q])
      await tx.query(
        "INSERT INTO account_notices(id,user_id,kind,title,body) VALUES($1,$2,'fixture','Fixture notice','Synthetic body')",
        [randomUUID(), user.userId],
      );
  });
  const mine = ok(await ctx.call("/account", { cookie: p.cookie })).notices;
  assert.equal(mine.length, 1);
  ok(await ctx.call("/account/notices/read", { body: { ids: [mine[0].id] }, cookie: q.cookie }));
  assert.equal(ok(await ctx.call("/account", { cookie: p.cookie })).notices[0].readAt, null);
  ok(await ctx.call("/account/notices/read", { body: {}, cookie: p.cookie }));
  assert.ok(ok(await ctx.call("/account", { cookie: p.cookie })).notices[0].readAt);
});

test("sessions are created in exactly one place so an account-lock check covers every sign-in path", async () => {
  const dir = new URL("../apps/api/src/", import.meta.url);
  const writers: string[] = [];
  for (const name of await readdir(dir))
    if (name.endsWith(".ts") && /INSERT INTO sessions/.test(await readFile(new URL(name, dir), "utf8")))
      writers.push(name);
  assert.deepEqual(writers, ["sign-in.ts"]);
  for (const name of ["app.ts", "account-completion.ts", "oidc-sign-in.ts", "membership-exit.ts"])
    assert.match(await readFile(new URL(name, dir), "utf8"), /openSignInSession\(/, name);
});
