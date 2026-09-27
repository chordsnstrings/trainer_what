import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database, Tx } from "@trainer/db";
import { consumeMfa } from "./security.ts";
import { queueAccountEmail } from "./account-completion.ts";

// Host-only operator commands. Never mounted as public routes. Each change is
// attributed to a verified Superadmin who proves a current authenticator code.
const refuse = (message: string) =>
  Object.assign(new Error(message), { code: "OPERATOR_REFUSED" });
const email = z.email().transform((value) => value.toLowerCase());
const operatorFields = {
  actorEmail: email,
  actorCode: z.string().regex(/^\d{6}$/, "Enter the actor's current code"),
  targetEmail: email,
  reason: z.string().trim().min(10).max(500),
};
const roleSchema = z
  .object({
    ...operatorFields,
    role: z.enum(["admin", "finance", "support", "safety", "none"]),
  })
  .strict();
const resetSchema = z.object(operatorFields).strict();
const platformLock = (tx: Tx) =>
  // Shared with first-admin bootstrap so Superadmin counts stay consistent.
  tx.query("SELECT pg_advisory_xact_lock(hashtext('platform-first-admin'))");

async function account(tx: Tx, address: string) {
  const [row] = await tx.query(
    "SELECT u.id,u.email,u.email_verified,u.platform_role,coalesce(s.enabled,false) AS mfa FROM users u LEFT JOIN user_security s ON s.user_id=u.id WHERE u.email=$1 FOR UPDATE OF u",
    [address],
  );
  return row;
}
async function verifiedOperator(tx: Tx, address: string, code: string) {
  const actor = await account(tx, address);
  if (
    !actor ||
    actor.platform_role !== "admin" ||
    !actor.email_verified ||
    !actor.mfa
  )
    throw refuse(
      "The acting operator must be a verified Superadmin with an enabled authenticator.",
    );
  if (!(await consumeMfa(tx, actor.id, code)))
    throw refuse("The acting operator's authenticator could not be verified.");
  return actor;
}
async function audit(
  tx: Tx,
  actorId: string,
  action: string,
  subjectId: string,
  data: Record<string, unknown>,
) {
  await tx.query(
    "INSERT INTO admin_operations_audit(id,actor_id,action,subject_id,data) VALUES($1,$2,$3,$4,$5)",
    [
      randomUUID(),
      actorId,
      action,
      subjectId,
      JSON.stringify({ ...data, source: "host-cli" }),
    ],
  );
}

export async function assignPlatformRole(db: Database, input: unknown) {
  const v = roleSchema.parse(input);
  return db.system(async (tx) => {
    await platformLock(tx);
    const target = await account(tx, v.targetEmail);
    if (!target)
      throw refuse(
        "Create and verify the account before assigning its platform role.",
      );
    if (v.role !== "none" && !target.email_verified)
      throw refuse(
        "Verify the account's email before granting platform authority.",
      );
    if (v.role !== "none" && !target.mfa)
      throw refuse(
        "The account must enable an authenticator before receiving platform authority.",
      );
    const [{ n: admins }] = await tx.query(
      "SELECT count(*)::int AS n FROM users WHERE platform_role='admin'",
    );
    let actorId: string;
    if (!admins && v.role === "admin" && v.actorEmail === v.targetEmail) {
      // Recovery when no Superadmin remains: the verified account proves its
      // own authenticator (checked above) instead of another administrator's.
      if (!(await consumeMfa(tx, target.id, v.actorCode)))
        throw refuse("The account's authenticator could not be verified.");
      actorId = target.id;
    } else actorId = (await verifiedOperator(tx, v.actorEmail, v.actorCode)).id;
    const from = target.platform_role as string;
    if (from === v.role)
      return { changed: false, userId: target.id, from, to: v.role };
    if (from === "admin" && admins <= 1)
      throw refuse("Grant another Superadmin before removing the last one.");
    await tx.query(
      "SELECT set_config('app.operator_id',$1,true),set_config('app.operator_reason',$2,true),set_config('app.operator_source','host-cli',true)",
      [actorId, v.reason],
    );
    await tx.query("UPDATE users SET platform_role=$2 WHERE id=$1", [
      target.id,
      v.role,
    ]);
    await audit(tx, actorId, "platform.role_changed", target.id, {
      from,
      to: v.role,
      reason: v.reason,
    });
    return { changed: true, userId: target.id, from, to: v.role };
  });
}

/** Support recovery for a member who lost their authenticator and codes. */
export async function resetUserMfa(db: Database, input: unknown) {
  const v = resetSchema.parse(input);
  if (v.actorEmail === v.targetEmail)
    throw refuse(
      "Another Superadmin must reset this authenticator; use a recovery code for your own account.",
    );
  return db.system(async (tx) => {
    await platformLock(tx);
    const target = await account(tx, v.targetEmail);
    if (!target) throw refuse("No account uses this email.");
    const actor = await verifiedOperator(tx, v.actorEmail, v.actorCode);
    const [security] = await tx.query(
      "SELECT enabled FROM user_security WHERE user_id=$1 FOR UPDATE",
      [target.id],
    );
    if (!security?.enabled)
      throw refuse("This account has no enabled authenticator.");
    await tx.query(
      "UPDATE user_security SET enabled=false,totp_secret=NULL,pending_secret=NULL,pending_until=NULL,last_counter=-1 WHERE user_id=$1",
      [target.id],
    );
    await tx.query("DELETE FROM mfa_recovery_codes WHERE user_id=$1", [
      target.id,
    ]);
    await tx.query("DELETE FROM sessions WHERE user_id=$1", [target.id]);
    await tx.query(
      "UPDATE one_time_tokens SET consumed_at=now() WHERE user_id=$1 AND purpose IN ('magic','reset') AND consumed_at IS NULL",
      [target.id],
    );
    await audit(tx, actor.id, "security.mfa_reset", target.id, {
      reason: v.reason,
    });
    const [membership] = await tx.query(
      "SELECT m.tenant_id,m.role FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id=$1 AND t.lifecycle_state='active' ORDER BY m.tenant_id LIMIT 1",
      [target.id],
    );
    if (membership)
      await queueAccountEmail(
        tx,
        {
          tenantId: membership.tenant_id,
          userId: target.id,
          role: membership.role,
        },
        target.email,
        "Your authenticator was reset",
        "A platform operator reset the authenticator on your account after a support request. All sessions and recovery codes were revoked. Sign in and set up a new authenticator. If you did not request this, reset your password and contact support.",
        "auth-operator-reset:" + randomUUID(),
      );
    return { userId: target.id, notified: !!membership };
  });
}
