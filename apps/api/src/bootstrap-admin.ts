import { randomUUID } from "node:crypto";
import { z } from "zod";
import { type Database, event } from "@trainer/db";
import { passwordHash } from "./auth.ts";

const inputSchema = z
  .object({
    email: z.email().transform((value) => value.toLowerCase()),
    name: z.string().trim().min(2).max(100),
    password: z.string().min(16).max(128),
  })
  .strict();

// Host-only initialization. This function is never mounted as a public route.
export async function bootstrapAdmin(db: Database, input: unknown) {
  const values = inputSchema.parse(input);
  const password = await passwordHash(values.password);
  return db.system(async (tx) => {
    await tx.query(
      "SELECT pg_advisory_xact_lock(hashtext('platform-first-admin'))",
    );
    const [existing] = await tx.query(
      "SELECT id FROM users WHERE platform_role='admin' LIMIT 1",
    );
    if (existing)
      throw new Error(
        "A Superadmin already exists. Use the existing account or the operator role recovery command.",
      );
    const [account] = await tx.query("SELECT id FROM users WHERE email=$1", [
      values.email,
    ]);
    if (account)
      throw new Error(
        "This email already belongs to an account. Verify that account before assigning its platform role.",
      );
    const userId = randomUUID(),
      tenantId = randomUUID();
    await tx.query(
      "INSERT INTO users(id,email,name,password_hash,email_verified,platform_role) VALUES($1,$2,$3,$4,true,'admin')",
      [userId, values.email, values.name, password],
    );
    await tx.query(
      "INSERT INTO tenants(id,slug,name) VALUES($1,$2,'Platform administration')",
      [tenantId, "platform-" + tenantId.slice(0, 8)],
    );
    await tx.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')",
      [tenantId, userId],
    );
    await tx.query("SET LOCAL ROLE trainer_app");
    await tx.query(
      "SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true),set_config('app.role','owner',true)",
      [tenantId, userId],
    );
    await event(
      tx,
      { tenantId, userId, role: "owner" },
      "platform.admin_bootstrapped",
      userId,
    );
    return { userId, tenantId };
  });
}
