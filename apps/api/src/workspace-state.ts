import type { Tx } from "@trainer/db";
import { runtimeConfig } from "../../../packages/providers/src/configuration.ts";

// Workspace suspension checks shared by the request gate, payouts and the
// worker. Kept free of route imports so finance modules can depend on it.
const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });

export type WorkspaceState = "active" | "suspended" | "closed";

export function workspaceSuspendedMessage() {
  const support = runtimeConfig().SUPPORT_EMAIL;
  return (
    "This coaching workspace is temporarily suspended by the platform team. Coaching, plans, bookings and the public website are paused." +
    (support ? ` Contact ${support} for help.` : " Contact platform support for help.")
  );
}

/**
 * Account-level and read-only personal routes stay available to a member of a
 * suspended workspace, so the suspension notice, account security, sign-out,
 * workspace switching and data portability keep working. Everything else is
 * refused before any handler runs.
 */
export function suspendedRequestAllowed(method: string, path: string) {
  if (
    path.startsWith("/api/v1/auth/") ||
    path.startsWith("/api/v1/public/") ||
    path.startsWith("/api/v1/webhooks/") ||
    ["/health", "/api/v1/health", "/api/v1/ready"].includes(path)
  )
    return true;
  if (method === "GET" || method === "HEAD")
    return [
      "/api/v1/workspace/status",
      "/api/v1/notifications",
      "/api/v1/privacy/export",
      "/api/v1/privacy/status",
    ].includes(path);
  if (method === "POST")
    return (
      path === "/api/v1/invitations/accept" ||
      /^\/api\/v1\/notifications\/[0-9a-f-]{36}\/read$/.test(path)
    );
  return false;
}

/** Throws 423 for a suspended workspace session outside the allowed routes. */
export function enforceWorkspaceGate(
  identity: { workspaceState?: string } | undefined,
  method: string,
  path: string,
) {
  if (
    identity?.workspaceState === "suspended" &&
    !suspendedRequestAllowed(method, path)
  )
    throw fail(423, "WORKSPACE_SUSPENDED", workspaceSuspendedMessage());
}

/** Scoped transactions: the current workspace's lifecycle, via a narrow helper. */
export async function currentWorkspaceState(tx: Tx): Promise<WorkspaceState> {
  const [row] = await tx.query<{ state: WorkspaceState | null }>(
    "SELECT current_workspace_state() AS state",
  );
  return row?.state ?? "closed";
}

/**
 * Payout preparation and dispatch are held while a workspace is not active.
 * Callers hold the workspace payout lock, which suspension also takes.
 */
export async function assertWorkspacePayoutsAllowed(tx: Tx) {
  const state = await currentWorkspaceState(tx);
  if (state !== "active")
    throw fail(
      409,
      "PAYOUT_HELD",
      state === "suspended"
        ? "Payouts are held while this workspace is suspended. Reinstate the workspace before preparing or sending a payout."
        : "Payouts are unavailable for a closed workspace.",
    );
}
