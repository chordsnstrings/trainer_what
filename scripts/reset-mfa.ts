import { createDatabase } from "@trainer/db";
import { resetUserMfa } from "../apps/api/src/operator-actions.ts";
// Host-only support recovery for a member who lost both the authenticator and
// the recovery codes. Run after verifying the member's identity out of band:
// node --import tsx --env-file-if-exists=.env scripts/reset-mfa.ts
// with OPERATOR_ACTOR_EMAIL, OPERATOR_ACTOR_CODE (the acting Superadmin's
// current authenticator code), OPERATOR_EMAIL (the member) and OPERATOR_REASON.
const db = await createDatabase();
try {
  const result = await resetUserMfa(db, {
    actorEmail: process.env.OPERATOR_ACTOR_EMAIL,
    actorCode: process.env.OPERATOR_ACTOR_CODE,
    targetEmail: process.env.OPERATOR_EMAIL,
    reason: process.env.OPERATOR_REASON,
  });
  console.log(
    "Authenticator reset and audited. Sessions, recovery codes and outstanding sign-in links were revoked." +
      (result.notified
        ? " The member was notified by email."
        : " No active workspace was available for an email notice."),
  );
} finally {
  await db.close();
}
