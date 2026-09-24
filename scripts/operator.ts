import { createDatabase } from "@trainer/db";
import { z } from "zod";
const email = z.email().parse(process.env.OPERATOR_EMAIL),
  role = z
    .enum(["admin", "finance", "support", "safety", "none"])
    .parse(process.env.OPERATOR_ROLE);
const db = await createDatabase();
try {
  const [user] = await db.system((tx) =>
    tx.query("UPDATE users SET platform_role=$2 WHERE email=$1 RETURNING id", [
      email.toLowerCase(),
      role,
    ]),
  );
  if (!user)
    throw new Error(
      "Create and verify the operator account before assigning its platform role",
    );
  console.log(
    "Operator role updated for the specified account. Production platform actions require authenticator verification.",
  );
} finally {
  await db.close();
}
