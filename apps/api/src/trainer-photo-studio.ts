import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { event, type Actor, type Database, type Tx } from "@trainer/db";
import {
  runtimeConfig,
  type RuntimeConfig,
} from "../../../packages/providers/src/configuration.ts";
import {
  generateTrainerPhoto,
  photoConnection,
  photoEstimate,
  PhotoProviderError,
  PHOTO_PRICE_VERSION,
  PHOTO_STYLES,
  type PhotoConnection,
} from "../../../packages/providers/src/trainer-photo.ts";
import {
  loadRuntimeSettings,
  storedIntegrationValues,
} from "./platform-settings.ts";
import { ownerTransaction, sanitizeBrandPhoto } from "./coach-site.ts";
import { privacyMatches } from "./ingestion.ts";

const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const task = "trainer_photo";
const unavailable =
  "The photo studio needs an active image model connection. You can upload and use your own photos now.";
export const trainerPhotoSchema = z
  .object({
    requestId: z.string().uuid(),
    referenceIds: z
      .array(z.string().uuid())
      .min(1)
      .max(3)
      .refine((ids) => new Set(ids).size === ids.length),
    style: z.enum(["portrait", "training", "website"]),
    detail: z.string().trim().max(500).default(""),
    consent: z.literal(true),
  })
  .strict();
function owner(req: FastifyRequest): Actor {
  if (!req.identity) throw fail(401, "AUTH_REQUIRED", "Please sign in");
  if (req.identity.role !== "owner")
    throw fail(
      403,
      "OWNER_REQUIRED",
      "Only the trainer owner can create and review photos",
    );
  return req.identity;
}
export async function resolvePhotoConnection(
  db: Database,
  current: RuntimeConfig = runtimeConfig(),
): Promise<PhotoConnection | null> {
  const config = { ...current, ...(await loadRuntimeSettings(db)) };
  if (
    !config.MODEL_API_KEY ||
    !config.MODEL_BASE_URL ||
    config.MODEL_IMAGE_ENABLED === "false"
  )
    return null;
  const direct = photoConnection(config);
  if (direct) return direct;
  // The active coaching profile may differ, but the master connection switch still governs.
  const inherited = await storedIntegrationValues(
    db,
    "model",
    (values) => !!photoConnection({ ...values, MODEL_API_KEY: "present" }),
  );
  return inherited ? photoConnection({ ...config, ...inherited }) : null;
}
const columns =
  "id,owner_user_id,request_id,status,input,width,height,kept_media_id,created_at";
function view(row: any) {
  const status =
    row.status === "running" &&
    Date.now() - new Date(row.created_at).getTime() > 240000
      ? "unknown"
      : row.status;
  return {
    id: row.id,
    requestId: row.request_id,
    status,
    style: row.input.style,
    referenceIds: row.input.referenceIds ?? [],
    width: row.width,
    height: row.height,
    createdAt: row.created_at,
    ...(status === "ready"
      ? { url: `/api/v1/tenant/photo-studio/${row.id}/image` }
      : {}),
    ...(row.kept_media_id
      ? {
          photo: {
            id: row.kept_media_id,
            url: `/api/v1/media/${row.kept_media_id}`,
            filename: `Coaching ${row.input.style ?? "photo"}.jpg`,
            generated: true,
          },
        }
      : {}),
  };
}
async function references(tx: Tx, actor: Actor, ids: string[]) {
  const rows = await tx.query(
    "SELECT id,media,digest FROM brand_media WHERE id=ANY($1::uuid[]) AND owner_user_id=$2 AND generated=false",
    [ids, actor.userId],
  );
  if (rows.length !== ids.length)
    throw fail(
      400,
      "PHOTO_REFERENCE_UNAVAILABLE",
      "Choose one to three original photos you uploaded to this workspace",
    );
  return ids.map((id) => rows.find((row) => row.id === id)!);
}
export function registerTrainerPhotoStudio(app: FastifyInstance, db: Database) {
  app.get("/api/v1/tenant/photo-studio", async (req) => {
    const actor = owner(req),
      connection = await resolvePhotoConnection(db);
    const query = z
      .object({ offset: z.coerce.number().int().min(0).default(0) })
      .parse(req.query);
    return ownerTransaction(db, actor, async (tx) => ({
      available: !!connection,
      reason: connection ? undefined : unavailable,
      offset: query.offset,
      styles: Object.entries(PHOTO_STYLES).map(([id, value]) => ({
        id,
        label: value.label,
      })),
      items: (
        await tx.query(
          `SELECT ${columns} FROM trainer_photo_jobs WHERE owner_user_id=$1 AND status<>'deleted' ORDER BY created_at DESC,id DESC LIMIT 24 OFFSET $2`,
          [actor.userId, query.offset],
        )
      ).map(view),
    }));
  });
  app.get("/api/v1/tenant/photo-studio/:id/image", async (req, reply) => {
    const actor = owner(req),
      id = z
        .string()
        .uuid()
        .parse((req.params as any).id);
    const bytes = await ownerTransaction(db, actor, async (tx) => {
      const [job] = await tx.query(
        "SELECT media FROM trainer_photo_jobs WHERE id=$1 AND owner_user_id=$2 AND status='ready'",
        [id, actor.userId],
      );
      if (!job?.media)
        throw fail(404, "NOT_FOUND", "This draft is unavailable");
      return Buffer.from(job.media);
    });
    return reply
      .header("Cache-Control", "private, no-store")
      .header("X-Content-Type-Options", "nosniff")
      .type("image/jpeg")
      .send(bytes);
  });
  app.post(
    "/api/v1/tenant/photo-studio",
    {
      bodyLimit: 4096,
      config: { rateLimit: { max: 12, timeWindow: "1 hour" } },
    },
    async (req) => {
      const actor = owner(req),
        input = trainerPhotoSchema.parse(req.body);
      if (privacyMatches(input.detail).length)
        throw fail(
          400,
          "PHOTO_PRIVATE_DETAILS",
          "Describe the setting without client details or contact information",
        );
      const inputHash = hash({
        referenceIds: input.referenceIds,
        style: input.style,
        detail: input.detail,
      });
      const connection = await resolvePhotoConnection(db);
      const claim = await ownerTransaction(db, actor, async (tx) => {
        const [existing] = await tx.query(
          `SELECT ${columns},input_hash FROM trainer_photo_jobs WHERE request_id=$1`,
          [input.requestId],
        );
        if (existing) {
          if (
            existing.input_hash !== inputHash ||
            (existing.owner_user_id && existing.owner_user_id !== actor.userId)
          )
            throw fail(
              409,
              "PHOTO_REQUEST_CHANGED",
              "This request already belongs to another photo brief",
            );
          return { existing: view(existing) };
        }
        if (!connection) throw fail(503, "PHOTO_UNAVAILABLE", unavailable);
        const refs = await references(tx, actor, input.referenceIds);
        const [pending] = await tx.query(
          "SELECT id FROM trainer_photo_jobs WHERE input_hash=$1 AND status IN ('running','unknown') LIMIT 1",
          [inputHash],
        );
        if (pending)
          throw fail(
            409,
            "PHOTO_OUTCOME_PENDING",
            "A request for these photos is still being checked. Review its status before generating it again.",
          );
        const estimate = photoEstimate(connection, refs.length);
        const [used] = await tx.query(
          "SELECT count(*)::int AS calls,coalesce(sum(coalesce(cost_usd,estimated_cost_usd)),0)::float AS spend FROM cost_events WHERE task=$1 AND created_at >= (date_trunc('day',now() AT TIME ZONE 'Asia/Dubai') AT TIME ZONE 'Asia/Dubai')",
          [task],
        );
        if (
          used.calls >= connection.dailyCalls ||
          Number(used.spend) + estimate > connection.dailyUsd + 1e-8
        )
          throw fail(
            429,
            "PHOTO_DAILY_LIMIT",
            "You’ve reached today’s photo allowance. Your uploads and saved drafts are still available.",
          );
        const jobId = randomUUID(),
          costId = randomUUID();
        await tx.query(
          "INSERT INTO cost_events(id,tenant_id,user_id,task,provider,model,status,price_version,pricing,estimated_cost_usd,product) VALUES($1,$2,$3,$4,'modelark',$5,'reserved',$6,$7,$8,'trainer_setup')",
          [
            costId,
            actor.tenantId,
            actor.userId,
            task,
            connection.model,
            PHOTO_PRICE_VERSION,
            JSON.stringify({
              reservedCostUsd: estimate,
              referenceImages: refs.length,
              outputImages: 1,
              size: PHOTO_STYLES[input.style].size,
            }),
            estimate,
          ],
        );
        await tx.query(
          "INSERT INTO trainer_photo_jobs(id,tenant_id,owner_user_id,request_id,input_hash,input,status,cost_event_id) VALUES($1,$2,$3,$4,$5,$6,'running',$7)",
          [
            jobId,
            actor.tenantId,
            actor.userId,
            input.requestId,
            inputHash,
            JSON.stringify({
              referenceIds: input.referenceIds,
              style: input.style,
              detail: input.detail,
              consentAt: new Date().toISOString(),
            }),
            costId,
          ],
        );
        await event(tx, actor, "brand.photo_generation_requested", jobId, {
          style: input.style,
          references: refs.length,
        });
        return { jobId, costId, estimate, refs };
      });
      if ("existing" in claim) return claim.existing;
      let sent = false,
        generated = false,
        outcome: "ready" | "failed" | "unknown" = "unknown",
        trace: string | null = null;
      let result: Awaited<ReturnType<typeof sanitizeBrandPhoto>> | undefined;
      try {
        const photo = await generateTrainerPhoto(
          connection!,
          {
            references: claim.refs.map((ref) => Buffer.from(ref.media)),
            style: input.style,
            detail: input.detail,
          },
          async () => {
            const latest = await resolvePhotoConnection(db);
            if (hash(latest) !== hash(connection))
              throw fail(
                409,
                "PHOTO_CONNECTION_CHANGED",
                "The image model connection changed. Please refresh.",
              );
            await ownerTransaction(db, actor, async (tx) => {
              const [job] = await tx.query(
                "SELECT status FROM trainer_photo_jobs WHERE id=$1",
                [claim.jobId],
              );
              if (job?.status !== "running")
                throw fail(
                  409,
                  "PHOTO_CANCELLED",
                  "This photo request is no longer active",
                );
              const refs = await references(tx, actor, input.referenceIds);
              if (refs.some((ref, i) => ref.digest !== claim.refs[i].digest))
                throw fail(
                  409,
                  "PHOTO_CHANGED",
                  "Your reference photos changed",
                );
            });
            sent = true;
          },
        );
        generated = true;
        trace = photo.traceId;
        result = await sanitizeBrandPhoto(photo.bytes);
        outcome = "ready";
      } catch (error) {
        outcome =
          !sent ||
          (error instanceof PhotoProviderError && error.outcome === "rejected")
            ? "failed"
            : "unknown";
      }
      // Settle the reserved cost even if owner access was revoked during generation.
      // This service scope can finalize this exact immutable reservation only.
      await db.system(
        async (tx) => {
          await tx.query("SELECT finish_trainer_photo_cost($1,$2,$3)", [
            claim.jobId,
            generated
              ? "generated"
              : outcome === "failed"
                ? "rejected"
                : "unknown",
            trace,
          ]);
        },
        { tenantId: actor.tenantId },
      );
      try {
        return await ownerTransaction(db, actor, async (tx) => {
          if (result) await references(tx, actor, input.referenceIds);
          await tx.query(
            "UPDATE trainer_photo_jobs SET status=$2,media=$3,width=$4,height=$5,updated_at=now() WHERE id=$1 AND status='running'",
            [
              claim.jobId,
              outcome,
              result?.bytes ?? null,
              result?.width ?? null,
              result?.height ?? null,
            ],
          );
          const [job] = await tx.query(
            `SELECT ${columns} FROM trainer_photo_jobs WHERE id=$1`,
            [claim.jobId],
          );
          return view(job);
        });
      } catch {
        await db.system(
          (tx) =>
            tx.query(
              "UPDATE trainer_photo_jobs SET media=NULL,input='{}',status='deleted',updated_at=now() WHERE id=$1 AND tenant_id=$2 AND status='running'",
              [claim.jobId, actor.tenantId],
            ),
          { tenantId: actor.tenantId },
        );
        throw fail(
          409,
          "PHOTO_ACCESS_CHANGED",
          "Your photo access changed while preparing the draft. No photo was saved.",
        );
      }
    },
  );
  app.post("/api/v1/tenant/photo-studio/:id/keep", async (req) => {
    const actor = owner(req),
      id = z
        .string()
        .uuid()
        .parse((req.params as any).id);
    z.object({ likenessConfirmed: z.literal(true) })
      .strict()
      .parse(req.body);
    return ownerTransaction(db, actor, async (tx) => {
      const [job] = await tx.query(
        `SELECT ${columns},media FROM trainer_photo_jobs WHERE id=$1 AND owner_user_id=$2 FOR UPDATE`,
        [id, actor.userId],
      );
      if (!job || !["ready", "kept"].includes(job.status))
        throw fail(404, "NOT_FOUND", "This draft is unavailable");
      if (job.status === "kept") return view(job);
      await references(tx, actor, job.input.referenceIds);
      const bytes = Buffer.from(job.media),
        digest = createHash("sha256").update(bytes).digest("hex");
      const [photo] = await tx.query(
        "INSERT INTO brand_media(id,tenant_id,owner_user_id,digest,media,width,height,filename,generated) VALUES($1,$2,$3,$4,$5,$6,$7,$8,true) ON CONFLICT(tenant_id,digest) DO UPDATE SET digest=excluded.digest RETURNING id",
        [
          randomUUID(),
          actor.tenantId,
          actor.userId,
          digest,
          bytes,
          job.width,
          job.height,
          `Coaching ${job.input.style}.jpg`,
        ],
      );
      await tx.query(
        "UPDATE trainer_photo_jobs SET status='kept',media=NULL,kept_media_id=$2,updated_at=now() WHERE id=$1",
        [id, photo.id],
      );
      await event(tx, actor, "brand.photo_likeness_reviewed", photo.id, {
        jobId: id,
        likenessConfirmed: true,
      });
      return view({ ...job, status: "kept", kept_media_id: photo.id });
    });
  });
  app.delete("/api/v1/tenant/photo-studio/:id", async (req) => {
    const actor = owner(req),
      id = z
        .string()
        .uuid()
        .parse((req.params as any).id);
    return ownerTransaction(db, actor, async (tx) => {
      // Retain receipts for unknown paid outcomes. Dismissal cannot erase the retry fence.
      const rows = await tx.query(
        "UPDATE trainer_photo_jobs SET status='deleted',media=NULL,input='{}',updated_at=now() WHERE id=$1 AND owner_user_id=$2 AND status IN ('ready','failed','kept') RETURNING id",
        [id, actor.userId],
      );
      if (!rows.length)
        throw fail(
          409,
          "PHOTO_PENDING",
          "Keep this request until its generation outcome has been confirmed",
        );
      return { ok: true };
    });
  });
}
