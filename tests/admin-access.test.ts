import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createDatabase } from "@trainer/db";
import { bootstrapAdmin } from "../apps/api/src/bootstrap-admin.ts";
import { HOST_RECOVERY, runAdminAccess } from "../apps/api/src/admin-access.ts";
import { passwordMatches } from "../apps/api/src/auth.ts";

test("host admin access lists, creates and resets without printing the password", async () => {
  const db = await createDatabase({ memory: true });
  const lines: string[] = [];
  const log = (line: string) => lines.push(line);
  const run = (action: string, env: Record<string, string>, password = "") =>
    runAdminAccess(db, action, env, async () => password, log);
  try {
    const first = "first-" + Date.now() + "@example.test";
    const existing = await bootstrapAdmin(db, {
      email: first,
      name: "Initial operator",
      password: "SyntheticBootstrapOnly2026!",
    });
    // A member account that must never appear in the Superadmin list.
    const memberId = randomUUID(),
      member = "member-" + Date.now() + "@example.test";
    await db.system((tx) =>
      tx.query(
        "INSERT INTO users(id,email,name,password_hash,email_verified) VALUES($1,$2,'Member','x',true)",
        [memberId, member],
      ),
    );

    // create works although a Superadmin already exists.
    const second = "Recovered-" + Date.now() + "@Example.test";
    const createPassword = "HostRecovery-" + randomBytes(8).toString("hex");
    await run("create", { ADMIN_ACCESS_EMAIL: second }, createPassword);
    const [made] = await db.system((tx) =>
      tx.query(
        "SELECT u.*,m.role,m.tenant_id,t.name AS tenant_name FROM users u JOIN memberships m ON m.user_id=u.id JOIN tenants t ON t.id=m.tenant_id WHERE u.email=$1",
        [second.toLowerCase()],
      ),
    );
    assert.equal(made.platform_role, "admin");
    assert.equal(made.email_verified, true);
    assert.equal(made.role, "owner");
    assert.equal(made.tenant_name, "Platform administration");
    assert.equal(
      await passwordMatches(createPassword, made.password_hash),
      true,
    );

    // create refuses an email that already has an account (any case).
    await assert.rejects(
      run(
        "create",
        { ADMIN_ACCESS_EMAIL: member.toUpperCase() },
        createPassword,
      ),
      /already belongs to an account/,
    );
    await assert.rejects(
      run("create", { ADMIN_ACCESS_EMAIL: "short@example.test" }, "too-short"),
    );

    // list prints only Superadmin emails.
    lines.length = 0;
    await run("list", {});
    assert.deepEqual(lines, [first, second.toLowerCase()].sort());

    // reset-password changes the hash and revokes every session.
    await db.system(async (tx) => {
      for (const n of [1, 2])
        await tx.query(
          "INSERT INTO sessions(token_hash,user_id,tenant_id,expires_at) VALUES($1,$2,$3,now()+interval '1 day')",
          [
            "session-" + n + "-" + randomUUID(),
            existing.userId,
            existing.tenantId,
          ],
        );
    });
    const [before] = await db.system((tx) =>
      tx.query("SELECT password_hash FROM users WHERE id=$1", [
        existing.userId,
      ]),
    );
    const resetPassword = "HostReset-" + randomBytes(8).toString("hex");
    await run("reset-password", { ADMIN_ACCESS_EMAIL: first }, resetPassword);
    const [after] = await db.system((tx) =>
      tx.query("SELECT password_hash FROM users WHERE id=$1", [
        existing.userId,
      ]),
    );
    assert.notEqual(after.password_hash, before.password_hash);
    assert.equal(
      await passwordMatches(resetPassword, after.password_hash),
      true,
    );
    const [left] = await db.system((tx) =>
      tx.query("SELECT count(*)::int AS n FROM sessions WHERE user_id=$1", [
        existing.userId,
      ]),
    );
    assert.equal(left.n, 0);
    await assert.rejects(
      run(
        "reset-password",
        { ADMIN_ACCESS_EMAIL: "nobody@example.test" },
        resetPassword,
      ),
      /No account uses this email/,
    );
    await assert.rejects(run("promote", {}), /Use one action/);

    // Both recovery actions are audited with the host recovery reason.
    const audit = await db.system((tx) =>
      tx.query(
        "SELECT action,subject_id,data FROM admin_operations_audit WHERE data->>'reason'=$1 ORDER BY created_at",
        [HOST_RECOVERY],
      ),
    );
    assert.deepEqual(
      audit.map((row) => [row.action, row.subject_id]),
      [
        ["platform.admin_created_by_host", made.id],
        ["account.password_reset_by_host", existing.userId],
      ],
    );
    assert.equal(audit[1].data.sessionsRevoked, 2);
    // Events are workspace data: read each through its own workspace scope,
    // as the restricted runtime role requires.
    const eventsIn = (tenantId: string, userId: string) =>
      db.tenant({ tenantId, userId, role: "owner" }, (tx) =>
        tx.query(
          "SELECT name FROM events WHERE subject_id=$1 AND data->>'reason'=$2",
          [userId, HOST_RECOVERY],
        ),
      );
    const events = [
      ...(await eventsIn(made.tenant_id, made.id)),
      ...(await eventsIn(existing.tenantId, existing.userId)),
    ].sort((a, b) => String(a.name).localeCompare(String(b.name)));
    assert.deepEqual(
      events.map((row) => row.name),
      ["platform.admin_recovered", "security.password_recovered"],
    );

    // No output line ever contains a password.
    assert.ok(lines.length > 0);
    for (const line of lines) {
      assert.ok(!line.includes(createPassword));
      assert.ok(!line.includes(resetPassword));
    }
  } finally {
    await db.close();
  }
});
