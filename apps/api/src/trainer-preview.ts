import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { putRecord, type Database } from "@trainer/db";
import { newToken, tokenHash } from "./auth.ts";
import { strictSecurity } from "../../../packages/providers/src/configuration.ts";
import { generateMemberPlan, reviewPlanGeneration } from "./brain-plans.ts";
import { deliverReviewedCoachingDecision } from "./coaching-completion.ts";
import { currentPreview, previewOwner, previewReviewer, previewError as fail, PREVIEW_COOKIE, PREVIEW_COOKIE_PATH } from "./trainer-preview-access.ts";

export function registerTrainerPreview(app: FastifyInstance, db: Database) {
  const path = "/api/v1/trainer-preview";
  app.get(path, async req => {
    const a = previewOwner(req);
    const profile = await currentPreview(db, a).catch(e => {
      if (e.code === "PREVIEW_MISSING") return null;
      throw e;
    });
    const reviewer = profile ? previewReviewer(a, profile.user_id) : a;
    return db.tenant(reviewer, async tx => {
      const [brain] = await tx.query("SELECT id,version,created_at FROM records WHERE kind='brain_release' AND status='published' ORDER BY created_at DESC,id DESC LIMIT 1");
      const rows = profile ? await tx.query("SELECT id,kind,status FROM records WHERE owner_user_id=$1 AND kind IN ('intake','program','nutrition_profile','nutrition_plan') ORDER BY created_at DESC,id DESC LIMIT 100", [profile.user_id]) : [];
      const decisions = profile ? await tx.query("SELECT id,version,data FROM records WHERE owner_user_id=$1 AND kind='decision' AND status='pending_review' ORDER BY created_at DESC,id DESC LIMIT 5", [profile.user_id]) : [];
      const [generation] = profile ? await tx.query("SELECT id,version,status,data FROM records WHERE owner_user_id=$1 AND kind='plan_generation' ORDER BY created_at DESC,id DESC LIMIT 1", [profile.user_id]) : [];
      return {
        profile: profile ? { id: profile.id, name: profile.name, userId: profile.user_id } : null,
        brain: brain ? { id: brain.id, version: brain.version, publishedAt: brain.created_at } : null,
        trainingProfile: rows.some(r => r.kind === "intake"),
        nutritionProfile: rows.some(r => r.kind === "nutrition_profile"),
        workout: rows.some(r => r.kind === "program" && r.status === "assigned"),
        nutritionPlan: rows.some(r => r.kind === "nutrition_plan" && r.status === "delivered"),
        decisions: decisions.map(d => ({ id: d.id, version: d.version, request: d.data.request, message: d.data.coachMessage ?? d.data.message, reason: d.data.reason })),
        generation: generation ? { id: generation.id, version: generation.version, status: generation.status, draft: generation.data.draft, errors: generation.data.validation?.errors ?? [], reasons: generation.data.routeReasons ?? [] } : null,
      };
    });
  });
  app.post(path + "/start", { config: { rateLimit: { max: 12, timeWindow: "10 minutes" } } }, async (req, reply) => {
    const a = previewOwner(req);
    const b = z.object({ reset: z.literal(true).optional() }).strict().parse(req.body ?? {});
    const parent = req.cookies.session;
    if (!parent) throw fail(401, "AUTH_REQUIRED", "Please sign in to your trainer workspace.");
    const token = newToken();
    const profile = await db.system(async tx => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [a.tenantId + ":trainer-preview:" + a.userId]);
      const [membership] = await tx.query("SELECT role FROM memberships WHERE tenant_id=$1 AND user_id=$2", [a.tenantId, a.userId]);
      if (membership?.role !== "owner") throw fail(403, "PREVIEW_OWNER", "Trainer access changed. Reload your workspace.");
      let p: any = (await tx.query("SELECT * FROM trainer_preview_profiles WHERE tenant_id=$1 AND trainer_user_id=$2 AND archived_at IS NULL", [a.tenantId, a.userId]))[0];
      if (p && b.reset) {
        await tx.query("UPDATE trainer_preview_profiles SET archived_at=now() WHERE id=$1", [p.id]);
        await tx.query("DELETE FROM trainer_preview_sessions WHERE profile_id=$1", [p.id]);
        p = undefined;
      }
      if (!p) {
        const userId = randomUUID(), profileId = randomUUID();
        await tx.query("INSERT INTO users(id,email,name,password_hash,email_verified,is_trainer_preview) VALUES($1,$2,$3,'!trainer-preview',false,true)", [userId, "preview-" + userId + "@trainer.invalid", a.name]);
        await tx.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'subscriber')", [a.tenantId, userId]);
        [p] = await tx.query("INSERT INTO trainer_preview_profiles(id,tenant_id,trainer_user_id,user_id) VALUES($1,$2,$3,$4) RETURNING *", [profileId, a.tenantId, a.userId, userId]);
      }
      await tx.query("DELETE FROM trainer_preview_sessions WHERE parent_session_hash=$1", [tokenHash(parent)]);
      const saved = await tx.query("INSERT INTO trainer_preview_sessions(token_hash,parent_session_hash,profile_id,tenant_id,expires_at) SELECT $1,token_hash,$3,$5,least(expires_at,now()+interval '8 hours') FROM sessions WHERE token_hash=$2 AND user_id=$4 AND tenant_id=$5 AND expires_at>now() RETURNING profile_id", [tokenHash(token), tokenHash(parent), p.id, a.userId, a.tenantId]);
      if (!saved.length) throw fail(401, "AUTH_REQUIRED", "Your trainer session ended. Please sign in again.");
      return p;
    }, { tenantId: a.tenantId });
    reply.setCookie(PREVIEW_COOKIE, token, { httpOnly: true, secure: strictSecurity(), sameSite: "lax", path: PREVIEW_COOKIE_PATH, maxAge: 8 * 3600 });
    const intake = await db.tenant({ tenantId: a.tenantId, userId: profile.user_id, role: "subscriber" }, tx => tx.query("SELECT id FROM records WHERE kind='intake' AND owner_user_id=$1 LIMIT 1", [profile.user_id]));
    return { profileId: profile.id, href: "/trainer/preview" + (intake.length ? "/app" : "/app/intake") };
  });
  app.post(path + "/end", async (req, reply) => {
    const a = previewOwner(req), parent = req.cookies.session;
    if (parent) await db.system(tx => tx.query("DELETE FROM trainer_preview_sessions WHERE parent_session_hash=$1", [tokenHash(parent)]), { tenantId: a.tenantId });
    const profile = await currentPreview(db, a).catch(e => { if (e.code === "PREVIEW_MISSING") return null; throw e; });
    if (profile) await db.tenant({ tenantId: a.tenantId, userId: profile.user_id, role: "subscriber" }, async tx => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [a.tenantId + ":onboarding-chat:" + profile.user_id]);
      await tx.query("UPDATE records SET status='ended',data=data-'cloneConsent',updated_at=now() WHERE kind='onboarding_call' AND owner_user_id=$1 AND status='active'", [profile.user_id]);
      await tx.query("UPDATE records SET data=data-'audio',updated_at=now() WHERE kind='onboarding_voice_request' AND owner_user_id=$1 AND data ? 'audio'", [profile.user_id]);
    });
    reply.clearCookie(PREVIEW_COOKIE, { path: PREVIEW_COOKIE_PATH });
    return { href: "/trainer/brain" };
  });
  app.post(path + "/workout", { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } }, async req => {
    const owner = previewOwner(req), profile = await currentPreview(db, owner);
    z.object({}).strict().parse(req.body ?? {});
    const a = previewReviewer(owner, profile.user_id);
    const [assigned] = await db.tenant(a, tx => tx.query("SELECT id FROM records WHERE kind='program' AND owner_user_id=$1 AND status='assigned' LIMIT 1", [profile.user_id]));
    if (assigned) return { status: "delivered", programId: assigned.id };
    const intent = await db.tenant(a, async tx => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [a.tenantId + ":preview-workout:" + profile.id]);
      const [old] = await tx.query("SELECT * FROM records WHERE kind='preview_workout_request' AND owner_user_id=$1 FOR UPDATE", [profile.user_id]);
      if (old && old.status !== "retryable") return { reused: true, id: old.id, result: old.data.result ?? { status: old.status, message: "Your workout request is already saved. Check the test controls for its progress." } };
      if (old) await tx.query("UPDATE records SET status='processing',updated_at=now() WHERE id=$1", [old.id]);
      const row = old ?? await putRecord(tx, a, "preview_workout_request", {}, { ownerId: profile.user_id, status: "processing" });
      return { reused: false, id: row.id };
    });
    if (intent.reused) return intent.result;
    try {
      const result = await generateMemberPlan(db, a, profile.user_id, { trigger: "manual", jobId: intent.id });
      await db.tenant(a, async tx => {
        const [gen] = result.generationId ? await tx.query("SELECT status,data FROM records WHERE id=$1 AND kind='plan_generation'", [result.generationId]) : [];
        const retryable = gen?.data.providerState === "not_sent" || ["not_sent", "prerequisite"].includes(gen?.status);
        await tx.query("UPDATE records SET status=$2,data=$3,updated_at=now() WHERE id=$1", [intent.id, retryable ? "retryable" : "complete", JSON.stringify({ result })]);
      });
      return result;
    } catch (e) {
      // A transport retry cannot purchase another request with an unknown outcome.
      await db.tenant(a, tx => tx.query("UPDATE records SET status='needs_review',updated_at=now() WHERE id=$1", [intent.id]));
      throw e;
    }
  });
  app.post(path + "/workout/:id/review", async req => {
    const owner = previewOwner(req), profile = await currentPreview(db, owner);
    const a = previewReviewer(owner, profile.user_id), id = z.uuid().parse((req.params as any).id);
    const b = z.object({ version: z.number().int().positive() }).strict().parse(req.body);
    const [row] = await db.tenant(a, tx => tx.query("SELECT id FROM records WHERE id=$1 AND kind='plan_generation' AND owner_user_id=$2", [id, profile.user_id]));
    if (!row) throw fail(404, "PREVIEW_REVIEW", "This workout is not in your test profile.");
    return reviewPlanGeneration(db, a, id, { action: "approve", version: b.version, note: "Approved for the trainer's private subscriber test only." });
  });
  app.post(path + "/replies/:id/review", async req => {
    const owner = previewOwner(req), profile = await currentPreview(db, owner);
    const a = previewReviewer(owner, profile.user_id), id = z.uuid().parse((req.params as any).id);
    const b = z.object({ version: z.number().int().positive() }).strict().parse(req.body);
    return db.tenant(a, async tx => {
      const [row] = await tx.query("SELECT * FROM records WHERE id=$1 AND kind='decision' AND owner_user_id=$2 FOR UPDATE", [id, profile.user_id]);
      if (!row) throw fail(404, "PREVIEW_REVIEW", "This reply is not in your test profile.");
      if (row.version !== b.version) throw fail(409, "PREVIEW_REVIEW_CHANGED", "This reply changed. Refresh before reviewing it.");
      const delivered = await deliverReviewedCoachingDecision(tx, a, row);
      await tx.query("UPDATE records SET status='resolved',version=version+1,updated_at=now() WHERE kind='exception' AND owner_user_id=$1 AND data->>'decisionId'=$2 AND status='open'", [profile.user_id, id]);
      return delivered;
    });
  });
}
