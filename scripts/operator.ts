import { createDatabase } from "@trainer/db";
import { assignPlatformRole } from "../apps/api/src/operator-actions.ts";
// Host-only. The acting Superadmin proves a current authenticator code and
// states a reason; the change is written to admin_operations_audit and
// platform_role_changes. Recovery when no Superadmin remains: set the actor to
// the verified, authenticator-protected target and OPERATOR_ROLE=admin.
const db = await createDatabase();
try {
  const result = await assignPlatformRole(db, {
    actorEmail: process.env.OPERATOR_ACTOR_EMAIL,
    actorCode: process.env.OPERATOR_ACTOR_CODE,
    targetEmail: process.env.OPERATOR_EMAIL,
    role: process.env.OPERATOR_ROLE,
    reason: process.env.OPERATOR_REASON,
  });
  console.log(
    result.changed
      ? `Operator role changed from ${result.from} to ${result.to} and audited. Production platform actions require authenticator verification.`
      : "The account already has this platform role; nothing changed.",
  );
} finally {
  await db.close();
}
