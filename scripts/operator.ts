import { createDatabase } from "@trainer/db";
import { z } from "zod";
import { resetAccountMfa } from "../apps/api/src/account-completion.ts";
// Usage: OPERATOR_EMAIL=... OPERATOR_ROLE=admin npm run operator:role
//        OPERATOR_EMAIL=... npm run operator:role -- reset-mfa
const action = process.argv[2] ?? "role";
if (!["role", "reset-mfa"].includes(action))
  throw new Error("Use no action to assign a role, or reset-mfa");
const email = z.email().parse(process.env.OPERATOR_EMAIL);
const db = await createDatabase();
try {
  if (action === "reset-mfa") {
    // Host access replaces the lost key: no stored secret is read or needed.
    await resetAccountMfa(db, email);
    console.log(
      "Authenticator reset for the specified account. Its sessions and recovery codes were revoked and a notice was queued. The account must sign in with its password and set up a new authenticator.",
    );
  } else {
    const role = z
      .enum(["admin", "finance", "support", "safety", "none"])
      .parse(process.env.OPERATOR_ROLE);
    const [user] = await db.system((tx) =>
      tx.query(
        "UPDATE users SET platform_role=$2 WHERE email=$1 RETURNING id",
        [email.toLowerCase(), role],
      ),
    );
    if (!user)
      throw new Error(
        "Create and verify the operator account before assigning its platform role",
      );
    console.log(
      "Operator role updated for the specified account. Production platform actions require authenticator verification.",
    );
  }
} finally {
  await db.close();
}
