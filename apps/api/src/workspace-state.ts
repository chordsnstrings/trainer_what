import type { Actor, Tx } from "@trainer/db";
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
 * Account-level and personal routes stay available to a member of a suspended
 * workspace, so the suspension notice, account security, sign-out, workspace
 * switching and data portability keep working. Billing continues during a
 * suspension, so a member can still see their billing, stop renewal, reconcile
 * a renewal change and ask for a refund, and can ask for erasure or withdraw a
 * consent (the consent handler refuses new grants while suspended). Everything
 * else is refused before any handler runs.
 *
 * `path` is the matched route pattern when the request was routed (so an
 * encoded spelling of a path gets the same decision as its plain spelling), and
 * the raw path otherwise. Anything not listed fails closed.
 */
const SUSPENDED_PREFIXES = [
  "/api/v1/auth/",
  "/api/v1/public/",
  "/api/v1/webhooks/",
] as const;
const SUSPENDED_READS = new Set([
  "/health",
  "/api/v1/health",
  "/api/v1/ready",
  "/api/v1/workspace/status",
  "/api/v1/notifications",
  "/api/v1/privacy/export",
  "/api/v1/privacy/status",
  "/api/v1/membership/billing",
]);
const SUSPENDED_WRITES = new Set([
  "/api/v1/invitations/accept",
  "/api/v1/notifications/:id/read",
  "/api/v1/membership/cancel",
  "/api/v1/membership/renewal/reconcile",
  "/api/v1/refund-requests",
  "/api/v1/privacy/delete-request",
  "/api/v1/privacy/consent",
]);
export function suspendedRequestAllowed(method: string, path: string) {
  if (SUSPENDED_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
  // A raw (unrouted) notification path is normalized to its route pattern.
  const route = path.replace(
    /^\/api\/v1\/notifications\/[0-9a-f-]{36}\/read$/,
    "/api/v1/notifications/:id/read",
  );
  if (method === "GET" || method === "HEAD") return SUSPENDED_READS.has(route);
  if (method === "POST") return SUSPENDED_WRITES.has(route);
  return false;
}

/**
 * Throws 423 for a suspended workspace session outside the allowed routes.
 * Platform operator routes are exempt for platform operators: they are scoped
 * by their own parameters, never by the operator's current workspace, and keep
 * their own role and fresh-authenticator checks.
 */
export function enforceWorkspaceGate(
  identity: { workspaceState?: string; platformRole?: string } | undefined,
  method: string,
  path: string,
  options: { routePattern?: string; operatorRoute?: boolean } = {},
) {
  if (identity?.workspaceState !== "suspended") return;
  if (
    options.operatorRoute &&
    identity.platformRole &&
    identity.platformRole !== "none"
  )
    return;
  if (!suspendedRequestAllowed(method, options.routePattern ?? path))
    throw fail(423, "WORKSPACE_SUSPENDED", workspaceSuspendedMessage());
}

/**
 * The one definition of a platform administration workspace, shared by
 * suspension, business metrics and alert delivery: its owner holds a platform
 * role. Operators who merely follow or staff a trainer do not make that
 * trainer's workspace a platform workspace. For service-role queries only.
 */
export const platformWorkspaceSql = (tenantColumn: string) =>
  `EXISTS(SELECT 1 FROM memberships pw_m JOIN users pw_u ON pw_u.id=pw_m.user_id WHERE pw_m.tenant_id=${tenantColumn} AND pw_m.role='owner' AND pw_u.platform_role<>'none')`;

/** Scoped transactions: the current workspace's lifecycle, via a narrow helper. */
export async function currentWorkspaceState(tx: Tx): Promise<WorkspaceState> {
  const [row] = await tx.query<{ state: WorkspaceState | null }>(
    "SELECT current_workspace_state() AS state",
  );
  return row?.state ?? "closed";
}

/**
 * The training lock for a member's own permission withdrawal while their
 * workspace is suspended. lockTraining's membership helper answers only for
 * active workspaces; this takes the same lock and confirms the member still
 * belongs to this workspace and that it is suspended (never closed).
 */
export async function lockSuspendedMember(tx: Tx, a: Actor) {
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    a.tenantId + ":training:" + a.userId,
  ]);
  const [member] = await tx.query(
    "SELECT 1 FROM memberships WHERE tenant_id=$1 AND user_id=$2 AND role=$3",
    [a.tenantId, a.userId, a.role],
  );
  if (!member || (await currentWorkspaceState(tx)) !== "suspended")
    throw fail(
      403,
      "WORKSPACE_CHANGED",
      "Your workspace membership changed; sign in again before continuing",
    );
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
