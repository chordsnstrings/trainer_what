import type { Tx } from "@trainer/db";
import {
  runtimeConfig,
  strictSecurity,
  type RuntimeConfig,
} from "../../../packages/providers/src/configuration.ts";
import { subscriptionHasAccess } from "./finance-billing.ts";

/**
 * The one shared answer to "may this member use coaching now?". Paid access
 * comes from the provider-mirrored subscription; complimentary access comes
 * from an open, unexpired trainer grant. Complimentary access never creates a
 * subscription, provider object or ledger entry. Commercial and billing logic
 * (renewal, refunds, commission, payment milestones) keeps reading
 * `currentPaidSubscription` directly.
 *
 * Call inside a tenant transaction; row-level security scopes both tables.
 */
export type ComplimentaryTier = "workout" | "workout_nutrition";
export type AccessSource = "paid" | "complimentary";
export type MemberAccess = {
  active: boolean;
  sources: AccessSource[];
  modules: string[];
  premiumVoice: boolean;
  subscription?: any;
  grant?: any;
};
export const tierModules = (tier: ComplimentaryTier) =>
  tier === "workout_nutrition" ? ["training", "nutrition"] : ["training"];
/** The nutrition tier stays behind the owner's nutrition approval flags. */
export function complimentaryNutritionApproved(
  config: RuntimeConfig = runtimeConfig(),
  strict = strictSecurity(),
) {
  return (
    !strict ||
    (config.NUTRITION_ENABLED === "true" &&
      config.NUTRITION_SCOPE_APPROVED === "true")
  );
}
export function grantIsActive(grant: any, now = Date.now()) {
  return (
    !!grant &&
    !grant.closed_at &&
    new Date(grant.starts_at).getTime() <= now &&
    (!grant.ends_at || new Date(grant.ends_at).getTime() > now)
  );
}
export async function activeComplimentaryGrant(tx: Tx, userId: string) {
  const [grant] = await tx.query(
    "SELECT * FROM complimentary_access WHERE user_id=$1 AND tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND closed_at IS NULL AND starts_at<=now() AND (ends_at IS NULL OR ends_at>now()) AND NOT EXISTS(SELECT 1 FROM membership_exits e WHERE e.user_id=complimentary_access.user_id AND e.created_at>=complimentary_access.created_at) ORDER BY created_at DESC LIMIT 1",
    [userId],
  );
  return grant;
}
/**
 * `grace: false` excludes a past-due subscription inside its payment grace
 * period (booking has always required an active or trialing membership).
 */
export async function memberAccess(
  tx: Tx,
  userId: string,
  options: { grace?: boolean } = {},
): Promise<MemberAccess> {
  const [s] = await tx.query("SELECT * FROM subscriptions WHERE user_id=$1", [
    userId,
  ]);
  const paid =
    subscriptionHasAccess(s) &&
    (options.grace !== false || s.status !== "past_due")
      ? s
      : undefined;
  const grant = await activeComplimentaryGrant(tx, userId);
  const modules = new Set<string>();
  if (paid) {
    modules.add("training");
    for (const m of Array.isArray(paid.data?.modules) ? paid.data.modules : [])
      modules.add(String(m));
  }
  if (grant)
    for (const m of tierModules(grant.tier))
      if (m !== "nutrition" || complimentaryNutritionApproved()) modules.add(m);
  return {
    active: !!paid || !!grant,
    sources: [
      ...(paid ? (["paid"] as const) : []),
      ...(grant ? (["complimentary"] as const) : []),
    ],
    modules: [...modules],
    premiumVoice:
      !!paid &&
      (paid.data?.modules?.includes("voice") === true ||
        paid.data?.premiumVoice === true),
    subscription: paid,
    grant,
  };
}
export async function hasMemberAccess(
  tx: Tx,
  userId: string,
  options: { grace?: boolean } = {},
) {
  return (await memberAccess(tx, userId, options)).active;
}
export async function hasNutritionAccess(tx: Tx, userId: string) {
  return (await memberAccess(tx, userId)).modules.includes("nutrition");
}
