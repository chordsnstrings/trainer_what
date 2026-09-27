import type { FastifyInstance } from "fastify";
import { requireRecentMfa } from "./security.ts";

// Fresh-authenticator policy for platform operator routes. Every operator
// module already calls requireRecentMfa, but several only relaxed it outside
// production (finance automation, finance controls, the overview) and two
// finance-controls reads never checked it. This guard applies the production
// policy consistently, in every environment, before any handler or body
// validation runs: a platform operator needs an authenticator code verified
// within the last ten minutes for every /api/v1/admin/* request and for the
// operator-only payout dispatch route, except the revocation-only routes in
// STEP_UP_EXEMPT_ROUTES.

/** Operator authority routes outside the /api/v1/admin/ prefix. */
export const OPERATOR_ROUTES_OUTSIDE_ADMIN = [
  "/api/v1/payout-runs/:id/execute",
] as const;
const outside = new Set<string>(OPERATOR_ROUTES_OUTSIDE_ADMIN);
const outsidePatterns = OPERATOR_ROUTES_OUTSIDE_ADMIN.map(
  (route) =>
    new RegExp(
      "^" + route.replace(/:[A-Za-z]+/g, "[^/]+").replace(/\//g, "\\/") + "$",
    ),
);

export function isOperatorRoute(path: string) {
  return (
    path.startsWith("/api/v1/admin/") ||
    outsidePatterns.some((pattern) => pattern.test(path))
  );
}

/**
 * Revocation-only operator routes that deliberately work without a fresh
 * authenticator, matched by method and routed pattern. Stopping a support
 * preview must always be possible: a preview grant lasts up to 15 minutes and
 * the step-up window is 10, so the operator can end their own access even
 * after the window closes (support-preview.ts ends it with reading=false).
 * Reading the preview still needs a fresh code.
 */
export const STEP_UP_EXEMPT_ROUTES = [
  "POST /api/v1/admin/support-previews/:id/end",
] as const;
const exempt = new Set<string>(STEP_UP_EXEMPT_ROUTES);
export const stepUpExempt = (method: string, routePattern?: string) =>
  routePattern !== undefined && exempt.has(method + " " + routePattern);

/**
 * The request targets an operator route. Decided from the raw path and from
 * the routed pattern: the router matches the percent-decoded path, so an
 * encoded spelling such as /api/v1/%61dmin/... reaches an admin handler
 * although its raw path does not start with /api/v1/admin/.
 */
export function operatorRouteRequested(rawPath: string, routePattern?: string) {
  return (
    isOperatorRoute(rawPath) ||
    (routePattern !== undefined && isOperatorRoute(routePattern))
  );
}
/** Platform administration routes (/api/v1/admin/*), raw or routed. */
export function adminRouteRequested(rawPath: string, routePattern?: string) {
  return (
    rawPath.startsWith("/api/v1/admin/") ||
    (routePattern?.startsWith("/api/v1/admin/") ?? false)
  );
}

/** Enforced in the request hook after the session identity is resolved. */
export function enforceOperatorStepUp(
  identity: { platformRole?: string; mfaAt?: string | null } | undefined,
  method: string,
  rawPath: string,
  routePattern?: string,
) {
  // Signed-out and non-operator requests reach the handlers' own 401/403.
  if (!identity?.platformRole || identity.platformRole === "none") return;
  if (!operatorRouteRequested(rawPath, routePattern)) return;
  if (stepUpExempt(method, routePattern)) return;
  requireRecentMfa(identity, true);
}

const inventories = new WeakMap<
  FastifyInstance,
  Array<{ method: string; url: string }>
>();
/**
 * Records every operator route as it is registered, so tests can prove each
 * one is covered. Register before any route module.
 */
export function trackOperatorRoutes(app: FastifyInstance) {
  const routes: Array<{ method: string; url: string }> = [];
  inventories.set(app, routes);
  app.addHook("onRoute", (route) => {
    if (!route.url.startsWith("/api/v1/admin/") && !outside.has(route.url))
      return;
    for (const method of ([] as string[]).concat(route.method))
      if (method !== "HEAD") routes.push({ method, url: route.url });
  });
}
export function operatorRouteInventory(app: FastifyInstance) {
  return [...(inventories.get(app) ?? [])];
}
