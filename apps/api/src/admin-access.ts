import { randomUUID } from "node:crypto";
import { z } from "zod";
import { type Database, type SystemTx, event } from "@trainer/db";
import { passwordHash } from "./auth.ts";
import {
  insertSuperadmin,
  lockSuperadmins,
  superadminInput,
} from "./bootstrap-admin.ts";

// Host-only Superadmin recovery. Root access to the server is the authority,
// the same trust the first-admin bootstrap and `operator:role reset-mfa` use.
// None of this is mounted as a route; platform actions still require the
// account's authenticator after sign-in.
export const HOST_RECOVERY = "host recovery";

async function recoveryAudit(
  tx: SystemTx,
  userId: string,
  action: string,
  data: Record<string, unknown> = {},
) {
  await tx.query(
    "INSERT INTO admin_operations_audit(id,actor_id,action,subject_id,data) VALUES($1,$2,$3,$4,$5)",
    [
      randomUUID(),
      userId,
      action,
      userId,
      JSON.stringify({ reason: HOST_RECOVERY, by: "host_operator", ...data }),
    ],
  );
}

export async function listSuperadmins(db: Database): Promise<string[]> {
  const rows = await db.system((tx) =>
    tx.query(
      "SELECT email FROM users WHERE platform_role='admin' ORDER BY email",
    ),
  );
  return rows.map((row) => row.email as string);
}

/** Creates another verified Superadmin even when one already exists. */
export async function createSuperadmin(db: Database, input: unknown) {
  const values = superadminInput.parse(input);
  const password = await passwordHash(values.password);
  return db.system(async (tx) => {
    await lockSuperadmins(tx);
    const made = await insertSuperadmin(
      tx,
      { email: values.email, name: values.name, passwordHash: password },
      "platform.admin_recovered",
      { reason: HOST_RECOVERY },
    );
    await recoveryAudit(tx, made.userId, "platform.admin_created_by_host");
    return made;
  });
}

const resetInput = z
  .object({
    email: z.email().transform((value) => value.toLowerCase()),
    password: z.string().min(16).max(128),
  })
  .strict();

/** Sets a new password for an existing account and revokes its sessions. */
export async function resetAccountPassword(db: Database, input: unknown) {
  const values = resetInput.parse(input);
  const password = await passwordHash(values.password);
  return db.system(async (tx) => {
    const [user] = await tx.query(
      "SELECT id FROM users WHERE email=$1 FOR UPDATE",
      [values.email],
    );
    if (!user) throw new Error("No account uses this email.");
    await tx.query("UPDATE users SET password_hash=$2 WHERE id=$1", [
      user.id,
      password,
    ]);
    const revoked = await tx.query(
      "DELETE FROM sessions WHERE user_id=$1 RETURNING user_id",
      [user.id],
    );
    await tx.query(
      "UPDATE one_time_tokens SET consumed_at=now() WHERE user_id=$1 AND purpose IN ('magic','reset') AND consumed_at IS NULL",
      [user.id],
    );
    await recoveryAudit(tx, user.id, "account.password_reset_by_host", {
      sessionsRevoked: revoked.length,
    });
    const [m] = await tx.query(
      "SELECT m.tenant_id,m.role FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id=$1 AND t.lifecycle_state='active' ORDER BY m.tenant_id LIMIT 1",
      [user.id],
    );
    if (m) {
      const actor = { tenantId: m.tenant_id, userId: user.id, role: m.role };
      await tx.tenant(actor, (scoped) =>
        event(scoped, actor, "security.password_recovered", user.id, {
          method: "host_operator",
          reason: HOST_RECOVERY,
        }),
      );
    }
    return { userId: user.id as string, sessionsRevoked: revoked.length };
  });
}

export const ADMIN_ACCESS_ACTIONS = ["list", "create", "reset-password"];

/**
 * Command body for `npm run admin:access`. Output names only email addresses
 * and outcomes; the password is read through `readPassword` and never logged.
 */
export async function runAdminAccess(
  db: Database,
  action: string | undefined,
  env: Record<string, string | undefined>,
  readPassword: () => Promise<string>,
  log: (line: string) => void,
) {
  if (!action || !ADMIN_ACCESS_ACTIONS.includes(action))
    throw new Error("Use one action: list, create or reset-password.");
  if (action === "list") {
    const emails = await listSuperadmins(db);
    for (const email of emails) log(email);
    if (!emails.length) log("No Superadmin accounts exist.");
    return;
  }
  const email = z.email().parse(env.ADMIN_ACCESS_EMAIL);
  const password = await readPassword();
  if (action === "create") {
    await createSuperadmin(db, {
      email,
      name: env.ADMIN_ACCESS_NAME ?? "Platform administrator",
      password,
    });
    log(
      `Superadmin ${email.toLowerCase()} created and audited. Sign in, enroll an authenticator in Account security, then open Superadmin settings.`,
    );
  } else {
    const result = await resetAccountPassword(db, { email, password });
    log(
      `Password reset for ${email.toLowerCase()} and audited; ${result.sessionsRevoked} session(s) revoked. Sign in with the new password; an enrolled authenticator is still required.`,
    );
  }
}
