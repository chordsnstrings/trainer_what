import { randomUUID } from "node:crypto";
import { elevated, type Actor, type Database } from "@trainer/db";

/**
 * A test fixture's own workspace scope for seeding and inspecting rows, the way
 * the worker does: an allowlisted elevation with the system user, never a
 * follower or a stranger claiming a team role (the db package rejects those).
 */
export function seedScope(
  a: { tenantId: string },
  role: "owner" | "staff" | "finance" = "owner",
): Actor {
  return elevated("worker", { tenantId: a.tenantId, role });
}

/**
 * A new platform admin acting in a workspace the way eraseMember does: the
 * platform-operator elevation with the operator's own user id. Use it with the
 * db option { privacyErasure: true } for erasure steps.
 */
export async function privacyOperator(
  db: Database,
  tenantId: string,
): Promise<Actor> {
  const userId = randomUUID();
  await db.system((tx) =>
    tx.query(
      "INSERT INTO users(id,email,name,password_hash,platform_role) VALUES($1,$2,'Privacy operator','fixture','admin')",
      [userId, userId + "@example.test"],
    ),
  );
  return elevated("platform-operator", { tenantId, userId, role: "owner" });
}
