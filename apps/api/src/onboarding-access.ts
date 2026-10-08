import type { Actor, Tx } from "@trainer/db";
import type { FastifyRequest } from "fastify";
import { memberAccess } from "./entitlements.ts";
import { workspaceLock } from "./privacy-lifecycle.ts";
import { lockTraining } from "./coaching-completion.ts";

export const onboardingError = (statusCode: number, code: string, message: string) => Object.assign(new Error(message), { statusCode, code });
export function onboardingActor(req: FastifyRequest): Actor {
  const a = req.identity;
  if (!a) throw onboardingError(401, "AUTH_REQUIRED", "Please sign in.");
  if (!["owner", "subscriber"].includes(a.role)) throw onboardingError(403, "ROLE_REQUIRED", "This conversation belongs to the trainer or client signing in.");
  return a;
}
export async function lockOnboarding(tx: Tx, a: Actor) {
  await workspaceLock(tx, a.tenantId);
  if (a.role === "subscriber") await lockTraining(tx, a);
  const [current] = await tx.query("SELECT training_actor_is_current($1,$2,$3) AS current", [a.tenantId, a.userId, a.role]);
  if (!current?.current) throw onboardingError(403, "ACCESS_CHANGED", "Your access changed. Sign in again.");
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [a.tenantId + ":onboarding-chat:" + a.userId]);
}
export async function onboardingPermissions(tx: Tx, a: Actor) {
  if (a.role === "owner") return { coaching: true, nutrition: false, nutritionIncluded: false, active: true };
  const rows = await tx.query("SELECT DISTINCT ON(document_type) document_type,granted FROM consent_records WHERE user_id=$1 AND document_type IN ('coaching','nutrition','nutrition_model') ORDER BY document_type,created_at DESC,id DESC LIMIT 3", [a.userId]);
  const allowed = (key: string) => rows.some(r => r.document_type === key && r.granted);
  const access = await memberAccess(tx, a.userId);
  return { coaching: allowed("coaching"), nutrition: access.modules.includes("nutrition") && allowed("nutrition") && allowed("nutrition_model"), nutritionIncluded: access.modules.includes("nutrition"), active: access.active };
}
export async function permitOnboarding(tx: Tx, a: Actor) {
  await lockOnboarding(tx, a);
  const p = await onboardingPermissions(tx, a);
  if (!p.coaching) throw onboardingError(403, "CONSENT_REQUIRED", "Allow coaching before sharing files or starting a call.");
  return p;
}
/** A withdrawal followed by a fresh grant cannot revive an in-flight upload. */
export async function onboardingConsentEpoch(tx: Tx, a: Actor) {
  const rows = await tx.query("SELECT DISTINCT ON(document_type) id,document_type FROM consent_records WHERE user_id=$1 AND document_type IN ('coaching','nutrition','nutrition_model','voice') ORDER BY document_type,created_at DESC,id DESC", [a.userId]);
  return JSON.stringify(rows.map(r => [r.document_type, r.id]));
}
