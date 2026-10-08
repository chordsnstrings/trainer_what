import { createHash } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { putRecord, event, type Actor, type Database, type Tx } from "@trainer/db";
import { runtimeConfig, strictSecurity } from "../../../packages/providers/src/configuration.ts";
import type { OnboardingAttachment } from "../../../packages/domain/src/onboarding-chat.ts";
import { extractDocumentDetailed } from "./ingestion.ts";
import { onboardingActor as actor, onboardingError as fail, permitOnboarding, onboardingConsentEpoch } from "./onboarding-access.ts";

const prefix = "/api/v1/onboarding-chat/attachments";
const MAX_FILE = 5 * 1024 * 1024;
let extracting = 0;
const fileSchema = z.object({
  id: z.string().uuid(), fileName: z.string().trim().min(1).max(180),
  contentBase64: z.string().min(4).max(Math.ceil(MAX_FILE / 3) * 4).regex(/^[A-Za-z0-9+/]+={0,2}$/), rights: z.literal(true),
}).strict();
export function attachmentView(row: any): OnboardingAttachment {
  const d = row.data;
  return { id: row.id, name: d.name, bytes: d.bytes, format: d.format, characters: d.text.length,
    warnings: d.warnings, image: !!d.image, preview: d.text.slice(0, 4000) };
}
/** Only the uploader can attach a ready file, once; retries refer to its original message. */
export async function onboardingFiles(tx: Tx, a: Actor, ids: string[], messageId: string, retryOf?: string) {
  if (new Set(ids).size !== ids.length) throw fail(400, "FILE_DUPLICATE", "Choose each file once.");
  if (!ids.length) return [];
  const rows = await tx.query("SELECT * FROM records WHERE kind='onboarding_attachment' AND owner_user_id=$1 AND id=ANY($2::uuid[]) FOR UPDATE", [a.userId, ids]);
  if (rows.length !== ids.length || rows.some(r => r.status !== "ready" || (r.data.messageId && r.data.messageId !== (retryOf ?? messageId))))
    throw fail(404, "FILE_UNAVAILABLE", "One of these files is no longer available for this message. Attach it again.");
  const ordered = ids.map(id => rows.find(r => r.id === id)!);
  for (const row of ordered) if (!row.data.messageId) {
    await tx.query("UPDATE records SET data=data||$2::jsonb,updated_at=now() WHERE id=$1", [row.id, JSON.stringify({ messageId })]);
  }
  return ordered;
}
export function onboardingAttachmentRoutes(app: FastifyInstance, db: Database) {
  app.post(prefix, { bodyLimit: 8 * 1024 * 1024, config: { rateLimit: { max: 12, timeWindow: "10 minutes" } } }, async (req, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const a = actor(req), b = fileSchema.parse(req.body);
    if (strictSecurity() && runtimeConfig().FILE_IMPORTS_APPROVED !== "true")
      throw fail(503, "IMPORT_REVIEW_PENDING", "File reading hasn't been enabled by the platform yet. You can paste your notes into the conversation.");
    const raw = Buffer.from(b.contentBase64, "base64");
    if (!raw.length || raw.length > MAX_FILE || raw.toString("base64") !== b.contentBase64) throw fail(400, "FILE_SIZE", "Choose a file under 5 MB.");
    const name = b.fileName.split(/[\\/]/).at(-1)!.replace(/[\u0000-\u001f\u007f]/g, "");
    const hash = createHash("sha256").update(raw).update(name).digest("hex");
    let consentEpoch = "";
    const prior = await db.tenant(a, async tx => {
      await permitOnboarding(tx, a);
      consentEpoch = await onboardingConsentEpoch(tx, a);
      await tx.query("DELETE FROM records WHERE kind='onboarding_attachment' AND owner_user_id=$1 AND data->>'messageId' IS NULL AND created_at<now()-interval '1 day'", [a.userId]);
      const [old] = await tx.query("SELECT * FROM records WHERE id=$1 AND kind='onboarding_attachment' AND owner_user_id=$2", [b.id, a.userId]);
      if (old) { if (old.data.hash !== hash) throw fail(409, "FILE_CHANGED", "This upload changed. Choose the file again."); return old; }
      const [quota] = await tx.query("SELECT count(*)::int AS total FROM records WHERE kind='onboarding_attachment' AND owner_user_id=$1", [a.userId]);
      if (quota.total >= 60) throw fail(429, "FILE_LIMIT", "Remove a file you no longer need before adding another.");
      return null;
    });
    if (prior) { raw.fill(0); return attachmentView(prior); }
    if (extracting >= 2) { raw.fill(0); throw fail(429, "IMPORT_BUSY", "I'm reading other files just now. Try this one again shortly."); }
    extracting++;
    try {
      const imageFile = /\.(jpe?g|png|webp)$/i.test(name);
      let image: string | undefined;
      if (imageFile) {
        const p = sharp(raw, { limitInputPixels: 24000000, failOn: "warning", animated: false });
        const meta = await p.metadata().catch(() => { throw fail(400, "IMAGE_INVALID", "This image couldn't be read. Choose a JPEG, PNG or WebP image."); });
        if (!["jpeg", "png", "webp"].includes(meta.format ?? "") || (meta.pages ?? 1) > 1) throw fail(400, "IMAGE_INVALID", "Choose a non-animated JPEG, PNG or WebP image.");
        image = (await p.rotate().resize(1400, 1400, { fit: "inside", withoutEnlargement: true }).flatten({ background: "white" }).jpeg({ quality: 75 }).toBuffer()).toString("base64");
        if (image.length > 700000) throw fail(400, "IMAGE_SIZE", "Choose a smaller photo.");
      }
      let result;
      try { result = await extractDocumentDetailed(name, raw); }
      catch (e) {
        if (!imageFile || (e as any).code !== "EXTRACTED_TEXT_SIZE") throw e;
        result = { text: "", extraction: "image-no-readable-text", warnings: ["No text was detected in this image. Describe anything important in your message."] };
      }
      return await db.tenant(a, async tx => {
        await permitOnboarding(tx, a);
        if (await onboardingConsentEpoch(tx, a) !== consentEpoch) throw fail(409, "CONSENT_CHANGED", "Your permissions changed while this file was being read. Choose it again if you want to share it.");
        const [old] = await tx.query("SELECT * FROM records WHERE id=$1 AND kind='onboarding_attachment' AND owner_user_id=$2", [b.id, a.userId]);
        if (old) { if (old.data.hash !== hash) throw fail(409, "FILE_CHANGED", "This upload changed. Choose the file again."); return attachmentView(old); }
        const [quota] = await tx.query("SELECT count(*)::int AS total FROM records WHERE kind='onboarding_attachment' AND owner_user_id=$1", [a.userId]);
        if (quota.total >= 60) throw fail(429, "FILE_LIMIT", "Remove a file you no longer need before adding another.");
        const row = await putRecord(tx, a, "onboarding_attachment", { ...result, image, hash, name, bytes: raw.length, format: name.split(".").at(-1)?.toUpperCase(), rightsAt: new Date().toISOString(), rawDiscarded: true }, { id: b.id, status: "ready" });
        await event(tx, a, "onboarding_chat.file_read", row.id, { format: row.data.format, characters: result.text.length });
        return attachmentView(row);
      });
    } finally { extracting--; raw.fill(0); }
  });
  app.get(prefix + "/:id", async (req, reply) => {
    const a = actor(req), id = z.string().uuid().parse((req.params as any).id);
    reply.header("Cache-Control", "private, no-store").header("X-Content-Type-Options", "nosniff");
    const row = await db.tenant(a, async tx => {
      await permitOnboarding(tx, a);
      const [row] = await tx.query("SELECT * FROM records WHERE id=$1 AND kind='onboarding_attachment' AND owner_user_id=$2 AND status='ready'", [id, a.userId]);
      if (!row) throw fail(404, "FILE_UNAVAILABLE", "This file is no longer available.");
      return row;
    });
    if ((req.query as any)?.image === "1" && row.data.image) return reply.type("image/jpeg").send(Buffer.from(row.data.image, "base64"));
    return { ...attachmentView(row), text: row.data.text, extraction: row.data.extraction };
  });
  app.delete(prefix + "/:id", async (req) => {
    const a = actor(req), id = z.string().uuid().parse((req.params as any).id);
    await db.tenant(a, async tx => {
      await permitOnboarding(tx, a);
      await tx.query("DELETE FROM records WHERE id=$1 AND kind='onboarding_attachment' AND owner_user_id=$2", [id, a.userId]);
    });
    return { removed: true };
  });
}
