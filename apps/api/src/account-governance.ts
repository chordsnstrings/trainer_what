import type { Tx } from "@trainer/db";
import { runtimeConfig } from "../../../packages/providers/src/configuration.ts";

// The one sign-in check shared by every path that creates a session: password,
// public join or invitation with an existing account, magic link, passkey,
// recovery code, workspace switch and any future provider (OIDC) sign-in.
// Callers verify credentials first, so a lock is never disclosed before the
// person has proven the account. The sessions insert trigger (migration 056)
// is the database backstop for any path that bypasses this function.

/** SQLSTATE raised by the sessions trigger for a locked account. */
export const ACCOUNT_LOCKED_SQLSTATE = "TBLCK";

export function accountLockedError() {
  const support = runtimeConfig().SUPPORT_EMAIL;
  return Object.assign(
    new Error(
      "This account is locked by the platform team. Signing in is unavailable until it is unlocked." +
        (support ? ` Contact ${support} for help.` : " Contact platform support for help."),
    ),
    { statusCode: 423, code: "ACCOUNT_LOCKED" },
  );
}

/** True while the account has an active platform lock. */
export async function accountLocked(tx: Tx, userId: string) {
  const [row] = await tx.query(
    "SELECT 1 FROM account_locks WHERE user_id=$1 AND status='active' LIMIT 1",
    [userId],
  );
  return !!row;
}

/**
 * Serializes with a concurrent lock (both take the user row) and refuses a
 * locked account. Run inside the transaction that inserts the session.
 */
export async function assertSignInAllowed(tx: Tx, userId: string) {
  await tx.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
  if (await accountLocked(tx, userId)) throw accountLockedError();
}
