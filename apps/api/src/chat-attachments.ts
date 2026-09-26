import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { event, type Actor, type Database, type Tx } from "@trainer/db";
import { lockTraining } from "./coaching-completion.ts";

const MAX_FILE = 5 * 1024 * 1024,
  MAX_IMAGE = 2 * 1024 * 1024,
  MAX_STORAGE = 64 * 1024 * 1024;
const execute = promisify(execFile),
  id = z.string().uuid();
let processingFiles = 0;
const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
function actor(req: FastifyRequest) {
  const a = req.identity;
  if (!a) throw fail(401, "AUTH_REQUIRED", "Please sign in");
  if (!["owner", "staff", "subscriber"].includes(a.role))
    throw fail(403, "COACHING_ACCESS", "Coaching access required");
  return a;
}
async function permission(tx: Tx, a: Actor, subject: string) {
  // Erasure holds the actor's training lock too. Lock both ends so a removed
  // staff member cannot leave new uploads in another client's conversation.
  for (const userId of [...new Set([a.userId, subject])].sort())
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      a.tenantId + ":training:" + userId,
    ]);
  await lockTraining(tx, a, subject);
  if (a.role === "subscriber" && subject !== a.userId)
    throw fail(
      403,
      "CONVERSATION_ACCESS",
      "Choose your own coaching conversation",
    );
  const [member] = await tx.query(
    "SELECT user_id FROM memberships WHERE tenant_id=$1 AND user_id=$2 AND role='subscriber'",
    [a.tenantId, subject],
  );
  if (!member)
    throw fail(
      404,
      "CONVERSATION_UNAVAILABLE",
      "This client conversation is unavailable",
    );
}
function visible(row: any) {
  return {
    id: row.id,
    fileName: row.file_name,
    mime: row.mime_type,
    bytes: row.byte_count,
    uploadedBy: row.uploaded_by,
    subjectId: row.subject_user_id,
    url: `/api/v1/chat/attachments/${row.id}`,
    ...row.details,
  };
}
function bytes(base64: string) {
  if (
    !base64 ||
    base64.length > Math.ceil(MAX_FILE / 3) * 4 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)
  )
    throw fail(400, "ATTACHMENT_DATA", "Choose a photo or PDF under 5 MB");
  const decoded = Buffer.from(base64, "base64");
  if (
    !decoded.length ||
    decoded.length > MAX_FILE ||
    decoded.toString("base64") !== base64
  )
    throw fail(400, "ATTACHMENT_DATA", "The file encoding or size is invalid");
  return decoded;
}
export async function sanitizeChatAttachment(raw: Buffer, mime: string) {
  if (processingFiles >= 2)
    throw fail(
      429,
      "ATTACHMENT_BUSY",
      "Other files are being prepared. Please retry shortly.",
    );
  processingFiles++;
  try {
    return await sanitizeFile(raw, mime);
  } finally {
    processingFiles--;
  }
}
async function sanitizeFile(raw: Buffer, mime: string) {
  if (raw.length > MAX_FILE || raw.length === 0)
    throw fail(400, "ATTACHMENT_SIZE", "Choose a file under 5 MB");
  if (["image/jpeg", "image/png", "image/webp"].includes(mime)) {
    try {
      const processor = sharp(raw, {
        limitInputPixels: 20000000,
        failOn: "warning",
        animated: false,
      });
      const meta = await processor.metadata(),
        expected = (
          {
            "image/jpeg": "jpeg",
            "image/png": "png",
            "image/webp": "webp",
          } as Record<string, string>
        )[mime];
      if (meta.format !== expected || (meta.pages ?? 1) !== 1)
        throw new Error("Invalid image type");
      const { data, info } = await processor
        .rotate()
        .resize(2000, 2000, { fit: "inside", withoutEnlargement: true })
        .flatten({ background: "#ffffff" })
        .jpeg({ quality: 82 })
        .toBuffer({ resolveWithObject: true });
      if (data.length > MAX_IMAGE)
        throw new Error("Image too large after conversion");
      return {
        media: data,
        mime: "image/jpeg",
        extension: "jpg",
        details: {
          width: info.width,
          height: info.height,
          metadataRemoved: true,
        },
      };
    } catch {
      throw fail(
        400,
        "ATTACHMENT_IMAGE",
        "Choose a valid, non-animated JPEG, PNG or WebP photo under 20 megapixels",
      );
    }
  }
  if (mime !== "application/pdf")
    throw fail(415, "ATTACHMENT_TYPE", "Use JPEG, PNG, WebP or PDF");
  if (!raw.subarray(0, 5).equals(Buffer.from("%PDF-")))
    throw fail(
      400,
      "ATTACHMENT_PDF",
      "This file does not have a valid PDF signature",
    );
  const directory = await mkdtemp(join(tmpdir(), "trainer-chat-"));
  try {
    const source = join(directory, "source.pdf"),
      destination = join(directory, "viewing-copy.pdf");
    await writeFile(source, raw, { mode: 0o600 });
    const { stdout } = await execute(
      "python3",
      [
        fileURLToPath(
          new URL("../../../scripts/sanitize-chat-pdf.py", import.meta.url),
        ),
        source,
        destination,
      ],
      {
        timeout: 20000,
        maxBuffer: 65536,
        encoding: "utf8",
        env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8", NODE_ENV: "production" },
      },
    );
    const media = await readFile(destination),
      details = JSON.parse(stdout);
    if (
      !media.length ||
      media.length > MAX_FILE ||
      !Number.isInteger(details.pages) ||
      details.pages < 1 ||
      details.pages > 20
    )
      throw new Error("Invalid PDF viewing copy");
    return {
      media,
      mime: "application/pdf",
      extension: "pdf",
      details: { pages: details.pages, passiveCopy: true },
    };
  } catch {
    throw fail(
      400,
      "ATTACHMENT_PDF",
      "Use an unencrypted PDF of at most 20 pages and 5 MB. This file could not be converted to a safe viewing copy.",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function validateChatAttachments(
  tx: Tx,
  a: Actor,
  subjectId: string,
  attachmentIds: string[],
) {
  const ids = z.array(id).max(5).parse(attachmentIds);
  if (new Set(ids).size !== ids.length)
    throw fail(400, "ATTACHMENT_DUPLICATE", "Attach each file once");
  if (!ids.length) return [];
  await permission(tx, a, subjectId);
  const rows = await tx.query(
    "SELECT * FROM chat_attachments WHERE id=ANY($1::uuid[]) FOR UPDATE",
    [ids],
  );
  if (
    rows.length !== ids.length ||
    rows.some(
      (r) => r.uploaded_by !== a.userId || r.subject_user_id !== subjectId,
    )
  )
    throw fail(
      404,
      "ATTACHMENT_UNAVAILABLE",
      "Use files you uploaded for this conversation",
    );
  if (
    rows.some(
      (r) => r.message_id || new Date(r.expires_at).getTime() <= Date.now(),
    )
  )
    throw fail(
      409,
      "ATTACHMENT_EXPIRED_OR_BOUND",
      "An attachment has expired or already belongs to another message",
    );
  return ids.map((key) => visible(rows.find((r) => r.id === key)));
}
/** Call in the same transaction as the new message, whose data includes authorUserId. */
export async function bindChatAttachments(
  tx: Tx,
  a: Actor,
  subjectId: string,
  messageId: string,
  attachmentIds: string[],
) {
  const attachments = await validateChatAttachments(
    tx,
    a,
    subjectId,
    attachmentIds,
  );
  if (!attachments.length) return [];
  const [message] = await tx.query(
    "SELECT * FROM records WHERE id=$1 AND kind='message' AND status='sent' AND owner_user_id=$2",
    [id.parse(messageId), subjectId],
  );
  if (!message || message.data.authorUserId !== a.userId)
    throw fail(
      403,
      "ATTACHMENT_AUTHOR",
      "Attachment binding must match the message author",
    );
  await tx.query(
    "UPDATE chat_attachments SET message_id=$1 WHERE id=ANY($2::uuid[])",
    [messageId, attachmentIds],
  );
  await tx.query(
    "UPDATE records SET data=data||$2::jsonb,version=version+1,updated_at=now() WHERE id=$1",
    [messageId, JSON.stringify({ attachments })],
  );
  return attachments;
}
export async function exportChatAttachments(tx: Tx, userId: string) {
  return tx.query("SELECT * FROM export_personal_chat_media($1)", [
    id.parse(userId),
  ]);
}
export async function eraseChatAttachments(tx: Tx, userId: string) {
  // Privacy erasure removes subject-owned messages separately; remove author-only
  // references too so their private uploads cannot survive in another thread.
  await tx.query("SELECT erase_personal_chat_media($1)", [id.parse(userId)]);
}
export async function closeChatAttachments(tx: Tx) {
  await tx.query("SELECT erase_workspace_chat_media()");
}
async function removeReference(
  tx: Tx,
  messageId: string,
  attachmentId: string,
) {
  await tx.query(
    "UPDATE records SET version=version+1,data=jsonb_set(data,'{attachments}',coalesce((SELECT jsonb_agg(item) FROM jsonb_array_elements(coalesce(data->'attachments','[]'::jsonb)) AS item WHERE item->>'id'<>$2),'[]'::jsonb)),updated_at=now() WHERE id=$1 AND kind='message'",
    [messageId, attachmentId],
  );
}
export async function expireChatAttachments(db: Database, tenantId: string) {
  return db.tenant(
    { tenantId, userId: "00000000-0000-0000-0000-000000000000", role: "owner" },
    async (tx) => {
      // DELETE visibility also needs SELECT access; worker expiry is a narrow
      // definer operation scoped to the current tenant, including private drafts.
      const [result] = await tx.query(
        "SELECT expire_unattached_chat_media() AS removed",
      );
      return result.removed;
    },
  );
}
export function registerChatAttachments(app: FastifyInstance, db: Database) {
  app.post(
    "/api/v1/chat/attachments",
    { bodyLimit: 8 * 1024 * 1024 },
    async (req) => {
      const a = actor(req),
        b = z
          .object({
            subjectId: id,
            requestKey: id,
            fileName: z.string().trim().min(1).max(120),
            mime: z.enum([
              "image/jpeg",
              "image/png",
              "image/webp",
              "application/pdf",
            ]),
            contentBase64: z.string().max(Math.ceil(MAX_FILE / 3) * 4),
            rightsConfirmed: z.literal(true),
          })
          .strict()
          .parse(req.body);
      const raw = bytes(b.contentBase64),
        fingerprint = createHash("sha256")
          .update(JSON.stringify([b.subjectId, b.fileName, b.mime]))
          .update(raw)
          .digest("hex");
      const prior = await db.tenant(a, async (tx) => {
        await permission(tx, a, b.subjectId);
        const [p] = await tx.query(
          "SELECT * FROM chat_attachments WHERE uploaded_by=$1 AND request_key=$2",
          [a.userId, b.requestKey],
        );
        return p;
      });
      if (prior) {
        if (prior.fingerprint !== fingerprint)
          throw fail(
            409,
            "ATTACHMENT_INTENT",
            "This upload request was already used for another file",
          );
        if (
          !prior.message_id &&
          new Date(prior.expires_at).getTime() <= Date.now()
        )
          throw fail(
            410,
            "ATTACHMENT_EXPIRED",
            "This draft attachment expired; upload it again with a new request",
          );
        return visible(prior);
      }
      const clean = await sanitizeChatAttachment(raw, b.mime),
        baseName =
          b.fileName
            .replace(/\.[^.]+$/, "")
            .replace(/[^a-zA-Z0-9._ -]/g, "_")
            .slice(0, 100) || "attachment";
      return db.tenant(a, async (tx) => {
        await permission(tx, a, b.subjectId);
        await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          a.tenantId + ":chat-upload:" + a.userId,
        ]);
        const [existing] = await tx.query(
          "SELECT * FROM chat_attachments WHERE uploaded_by=$1 AND request_key=$2",
          [a.userId, b.requestKey],
        );
        if (existing) {
          if (existing.fingerprint !== fingerprint)
            throw fail(
              409,
              "ATTACHMENT_INTENT",
              "This upload request was already used for another file",
            );
          if (
            !existing.message_id &&
            new Date(existing.expires_at).getTime() <= Date.now()
          )
            throw fail(
              410,
              "ATTACHMENT_EXPIRED",
              "This draft attachment expired; upload it again with a new request",
            );
          return visible(existing);
        }
        await tx.query(
          "DELETE FROM chat_attachments WHERE uploaded_by=$1 AND message_id IS NULL AND expires_at<=now()",
          [a.userId],
        );
        const [usage] = await tx.query(
          "SELECT coalesce(sum(byte_count),0)::bigint AS bytes FROM chat_attachments WHERE uploaded_by=$1",
          [a.userId],
        );
        if (Number(usage.bytes) + clean.media.length > MAX_STORAGE)
          throw fail(
            413,
            "ATTACHMENT_STORAGE",
            "Your chat files have reached 64 MB in this workspace; remove older files before uploading another",
          );
        const [row] = await tx.query(
          "INSERT INTO chat_attachments(id,tenant_id,uploaded_by,subject_user_id,request_key,fingerprint,file_name,mime_type,media,byte_count,details) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *",
          [
            randomUUID(),
            a.tenantId,
            a.userId,
            b.subjectId,
            b.requestKey,
            fingerprint,
            baseName + "." + clean.extension,
            clean.mime,
            clean.media,
            clean.media.length,
            JSON.stringify({
              ...clean.details,
              rightsConfirmedAt: new Date().toISOString(),
            }),
          ],
        );
        await event(tx, a, "message.attachment_uploaded", row.id, {
          bytes: clean.media.length,
          mime: clean.mime,
        });
        return visible(row);
      });
    },
  );
  app.get("/api/v1/chat/attachments/:id", async (req, reply) => {
    const a = actor(req),
      attachmentId = id.parse((req.params as any).id);
    const row = await db.tenant(a, async (tx) => {
      const [r] = await tx.query(
        "SELECT * FROM chat_attachments WHERE id=$1 AND (message_id IS NOT NULL OR expires_at>now())",
        [attachmentId],
      );
      if (!r)
        throw fail(
          404,
          "ATTACHMENT_UNAVAILABLE",
          "This attachment is unavailable",
        );
      await permission(tx, a, r.subject_user_id);
      return r;
    });
    return reply
      .header("Cache-Control", "private, no-store")
      .header("X-Content-Type-Options", "nosniff")
      .header("Content-Security-Policy", "sandbox; default-src 'none'")
      .header(
        "Content-Disposition",
        `${row.mime_type === "application/pdf" ? "attachment" : "inline"}; filename="${row.file_name}"`,
      )
      .type(row.mime_type)
      .send(Buffer.from(row.media));
  });
  app.delete("/api/v1/chat/attachments/:id", async (req) => {
    const a = actor(req),
      attachmentId = id.parse((req.params as any).id);
    return db.tenant(a, async (tx) => {
      const [r] = await tx.query("SELECT * FROM chat_attachments WHERE id=$1", [
        attachmentId,
      ]);
      if (!r)
        throw fail(
          404,
          "ATTACHMENT_UNAVAILABLE",
          "This attachment is unavailable",
        );
      await permission(tx, a, r.subject_user_id);
      if (
        r.uploaded_by !== a.userId &&
        r.subject_user_id !== a.userId &&
        a.role !== "owner"
      )
        throw fail(
          403,
          "ATTACHMENT_REMOVE",
          "Only the sender, client or workspace owner can remove this file",
        );
      if (r.message_id) await removeReference(tx, r.message_id, r.id);
      await tx.query("DELETE FROM chat_attachments WHERE id=$1", [r.id]);
      await event(tx, a, "message.attachment_removed", r.id);
      return { ok: true };
    });
  });
}
