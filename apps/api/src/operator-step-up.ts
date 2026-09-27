import type { FastifyInstance } from "fastify";
import { requireRecentMfa } from "./security.ts";

// Fresh-authenticator policy for platform operator routes. Every operator
// module already calls requireRecentMfa, but several only relaxed it outside
// production (finance automation, finance controls, the overview) and two
// finance-controls reads never checked it. This guard applies the production
// policy consistently, in every environment, before any handler or body
// validation runs: a platform operator needs an authenticator code verified
// within the last ten minutes for every /api/v1/admin/* request and for the
// operator-only payout dispatch route.

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

/** Enforced in the request hook after the session identity is resolved. */
export function enforceOperatorStepUp(
  identity: { platformRole?: string; mfaAt?: string | null } | undefined,
  path: string,
) {
  // Signed-out and non-operator requests reach the handlers' own 401/403.
  if (!identity?.platformRole || identity.platformRole === "none") return;
  if (isOperatorRoute(path)) requireRecentMfa(identity, true);
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
