import { randomUUID } from "node:crypto";
import { z } from "zod";
import { type Database, type SystemTx, event } from "@trainer/db";
import { passwordHash } from "./auth.ts";

export const superadminInput = z
  .object({
    email: z.email().transform((value) => value.toLowerCase()),
    name: z.string().trim().min(2).max(100),
    password: z.string().min(16).max(128),
  })
  .strict();

const ACCOUNT_EXISTS =
  "This email already belongs to an account. Verify that account before assigning its platform role.";

/**
 * Inserts a verified Superadmin with its own platform-administration workspace
 * and owner membership. Host-only: shared by the first-admin bootstrap and the
 * host recovery command; the caller holds the platform-first-admin lock.
 */
export async function insertSuperadmin(
  tx: SystemTx,
  values: { email: string; name: string; passwordHash: string },
  eventName: string,
  eventData: Record<string, unknown> = {},
) {
  const [account] = await tx.query("SELECT id FROM users WHERE email=$1", [
    values.email,
  ]);
  if (account) throw new Error(ACCOUNT_EXISTS);
  const userId = randomUUID(),
    tenantId = randomUUID();
  await tx.query(
    "INSERT INTO users(id,email,name,password_hash,email_verified,platform_role) VALUES($1,$2,$3,$4,true,'admin')",
    [userId, values.email, values.name, values.passwordHash],
  );
  await tx.query(
    "INSERT INTO tenants(id,slug,name) VALUES($1,$2,'Platform administration')",
    [tenantId, "platform-" + tenantId.slice(0, 8)],
  );
  await tx.query(
    "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')",
    [tenantId, userId],
  );
  // The owner membership inserted above verifies this scope.
  const owner = { tenantId, userId, role: "owner" };
  await tx.tenant(owner, (scoped) =>
    event(scoped, owner, eventName, userId, eventData),
  );
  return { userId, tenantId };
}

export const lockSuperadmins = (tx: SystemTx) =>
  tx.query("SELECT pg_advisory_xact_lock(hashtext('platform-first-admin'))");

// Host-only initialization. This function is never mounted as a public route.
export async function bootstrapAdmin(db: Database, input: unknown) {
  const values = superadminInput.parse(input);
  const password = await passwordHash(values.password);
  return db.system(async (tx) => {
    await lockSuperadmins(tx);
    const [existing] = await tx.query(
      "SELECT id FROM users WHERE platform_role='admin' LIMIT 1",
    );
    if (existing)
      throw new Error(
        "A Superadmin already exists. Use the existing account or the operator role recovery command.",
      );
    return insertSuperadmin(
      tx,
      { email: values.email, name: values.name, passwordHash: password },
      "platform.admin_bootstrapped",
    );
  });
}
