import { createDatabase } from "@trainer/db";
import { z } from "zod";
import { resetAccountMfa } from "../apps/api/src/account-completion.ts";
import { assignPlatformRole } from "../apps/api/src/operator-actions.ts";
// Host-only.
// Role change: the acting Superadmin proves a current authenticator code and
// states a reason; the change is written to admin_operations_audit and
// platform_role_changes. Recovery when no Superadmin remains: set the actor to
// the verified, authenticator-protected target and OPERATOR_ROLE=admin.
//   OPERATOR_ACTOR_EMAIL=... OPERATOR_ACTOR_CODE=... OPERATOR_EMAIL=... OPERATOR_ROLE=admin OPERATOR_REASON=... npm run operator:role
// Emergency authenticator reset (for example after the encryption key was lost):
//   OPERATOR_EMAIL=... npm run operator:role -- reset-mfa
const action = process.argv[2] ?? "role";
if (!["role", "reset-mfa"].includes(action))
  throw new Error("Use no action to assign a role, or reset-mfa");
const db = await createDatabase();
try {
  if (action === "reset-mfa") {
    // Host access replaces the lost key: no stored secret is read or needed.
    await resetAccountMfa(db, z.email().parse(process.env.OPERATOR_EMAIL));
    console.log(
      "Authenticator reset for the specified account. Its sessions and recovery codes were revoked and a notice was queued. The account must sign in with its password and set up a new authenticator.",
    );
  } else {
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
  }
} finally {
  await db.close();
}
