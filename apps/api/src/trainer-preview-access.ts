import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Actor, Database } from "@trainer/db";
import { tokenHash } from "./auth.ts";

export const PREVIEW_API = "/api/v1/trainer-preview/run";
export const PREVIEW_COOKIE = "trainer_preview";
export const PREVIEW_COOKIE_PATH = "/api/v1/trainer-preview";
export const previewError = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
export type TrainerPreview = {
  profileId: string;
  userId: string;
  trainerUserId: string;
  trainerName: string;
};
declare module "fastify" {
  interface FastifyRequest { trainerPreview?: TrainerPreview }
}

/** Only existing member services are aliased; commercial and account actions stay outside a preview. */
export function previewRouteAllowed(method: string, path: string) {
  const p = path.split("?")[0].replace(/^\/api\/v1/, "");
  const read = method === "GET" || method === "HEAD";
  if (read && /^\/(bootstrap|programme\/(today|timeline)|brain\/plans\/mine|training\/(overview|holds|exercises)|messages\/thread|clients\/[^/]+\/(twin|context)|workspace\/pages\/[^/]+|notifications(?:\/preferences)?|account\/preferences)$/.test(p)) return true;
  if (method === "POST" && /^\/(intake|messages|coaching\/ask|privacy\/consent|settings)$/.test(p)) return true;
  if (/^\/onboarding-chat(?:\/(history|messages|actions|attachments(?:\/[^/]+)?|calls(?:\/options|\/[^/]+\/end|\/[^/]+\/turns(?:\/[^/]+)?)?))?$/.test(p)) return ["GET", "HEAD", "POST", "DELETE"].includes(method);
  if (/^\/coaching\/calls(?:\/options|\/[^/]+\/end|\/[^/]+\/turns(?:\/[^/]+)?)?$/.test(p)) return ["GET", "HEAD", "POST"].includes(method);
  if (/^\/chat\/attachments(?:\/[^/]+)?$/.test(p)) return ["GET", "HEAD", "POST", "DELETE"].includes(method);
  if (/^\/nutrition(?:\/(profile|generate|plans|logs|checkins|pantry|groceries|captures|tracker|favorites|purchase-specs|shopping|leftovers|methods)(?:\/[^/]+)*)?$/.test(p)) return ["GET", "HEAD", "POST", "PUT", "DELETE"].includes(method);
  if (method === "POST" && /^\/training\/sessions\/[^/]+\/(reschedule|cancel)$/.test(p)) return true;
  if (/^\/workouts(?:\/[^/]+)*$/.test(p)) return ["GET", "HEAD", "POST"].includes(method);
  if (/^\/voice-sessions(?:\/(?:consent|workout\/[^/]+|planned\/[^/]+|[0-9a-f-]{36}(?:\/(?:audio|utterance|transcribe|events))?))?$/.test(p)) return ["GET", "HEAD", "POST"].includes(method);
  if (method === "PUT" && /^\/clients\/[^/]+\/context$/.test(p)) return true;
  if (["PUT", "POST"].includes(method) && /^\/notifications\/preferences$/.test(p)) return true;
  return false;
}

/** Same handlers, schemas, body limits and permissions as the subscriber route. */
export function aliasPreviewRoutes(app: FastifyInstance) {
  app.addHook("onRoute", options => {
    if (!options.url.startsWith("/api/v1/") || options.url.startsWith("/api/v1/trainer-preview")) return;
    const methods = (Array.isArray(options.method) ? options.method : [options.method])
      .filter(method => previewRouteAllowed(method, options.url));
    if (!methods.length) return;
    app.route({ ...options, method: methods, url: PREVIEW_API + options.url.slice("/api/v1".length), exposeHeadRoute: false });
  });
}

/** Called after authenticating the unchanged trainer session and verifying its host. */
export async function resolveTrainerPreview(db: Database, req: FastifyRequest, reply: FastifyReply) {
  if (req.url.startsWith(PREVIEW_COOKIE_PATH)) reply.header("Cache-Control", "private, no-store");
  if (!req.url.startsWith(PREVIEW_API + "/")) return;
  const owner = req.identity;
  if (!owner || owner.role !== "owner") throw previewError(403, "PREVIEW_OWNER", "Open Try my AI from your trainer workspace.");
  const token = req.cookies[PREVIEW_COOKIE], parent = req.cookies.session;
  if (!token || !parent) throw previewError(409, "PREVIEW_ENDED", "Your test session ended. Return to My Brain and open Try my AI again.");
  const [profile] = await db.system(tx => tx.query(
    "SELECT p.id,p.user_id,u.name,u.email FROM trainer_preview_sessions s JOIN trainer_preview_profiles p ON p.id=s.profile_id JOIN users u ON u.id=p.user_id JOIN memberships m ON m.tenant_id=p.tenant_id AND m.user_id=p.user_id AND m.role='subscriber' WHERE s.token_hash=$1 AND s.parent_session_hash=$2 AND s.expires_at>now() AND p.archived_at IS NULL AND p.tenant_id=$3 AND p.trainer_user_id=$4 AND u.is_trainer_preview=true",
    [tokenHash(token), tokenHash(parent), owner.tenantId, owner.userId],
  ), { tenantId: owner.tenantId });
  if (!profile) {
    reply.clearCookie(PREVIEW_COOKIE, { path: PREVIEW_COOKIE_PATH });
    throw previewError(409, "PREVIEW_ENDED", "Your test session ended. Return to My Brain and open Try my AI again.");
  }
  req.trainerPreview = { profileId: profile.id, userId: profile.user_id, trainerUserId: owner.userId, trainerName: owner.name };
  req.identity = { ...owner, userId: profile.user_id, role: "subscriber", name: profile.name, email: profile.email, platformRole: "none", mfaAt: null };
}

export function previewOwner(req: FastifyRequest) {
  const a = req.identity;
  if (!a || a.role !== "owner" || req.trainerPreview) throw previewError(403, "PREVIEW_OWNER", "Only the trainer can manage their own test profile.");
  return a;
}
export async function currentPreview(db: Database, a: Actor) {
  const [p] = await db.system(tx => tx.query(
    "SELECT p.*,u.name FROM trainer_preview_profiles p JOIN users u ON u.id=p.user_id WHERE p.tenant_id=$1 AND p.trainer_user_id=$2 AND p.archived_at IS NULL",
    [a.tenantId, a.userId],
  ), { tenantId: a.tenantId });
  if (!p) throw previewError(404, "PREVIEW_MISSING", "Open Try my AI to create your private test profile.");
  return p;
}
export const previewReviewer = (a: Actor, memberId: string): Actor => ({ ...a, previewMemberId: memberId });
