import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Actor, Database, Tx } from "@trainer/db";
import { z } from "zod";
import {
  MUSIC_PLAYLISTS,
  MUSIC_TARGET,
  musicBrief,
} from "../../../packages/domain/src/workout-music.ts";
import {
  downloadMusic,
  generateMusic,
  musicCredits,
  musicResult,
  MusicProviderError,
} from "../../../packages/providers/src/suno-music.ts";
import { runtimeConfig } from "../../../packages/providers/src/configuration.ts";
import { requireRecentMfa } from "./security.ts";

type Identity = Actor & { platformRole?: string; mfaAt?: string | null };
const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
const uuid = z.string().uuid();
const playlist = z.enum(MUSIC_PLAYLISTS.map((p) => p.id));
async function audit(
  tx: Tx,
  action: string,
  actor: string | null,
  subject: string | null,
  detail: unknown = {},
) {
  await tx.query(
    "INSERT INTO workout_music_audit(id,actor_id,subject_id,action,detail) VALUES($1,$2,$3,$4,$5)",
    [randomUUID(), actor, subject, action, JSON.stringify(detail)],
  );
}
const metadata = "id,playlist,title,duration,status,review_note,created_at";
function limits() {
  const c = runtimeConfig(),
    perJob = Number(c.MUSIC_CREDITS_PER_JOB),
    daily = Number(c.MUSIC_DAILY_CREDIT_LIMIT);
  if (
    c.MUSIC_ENABLED !== "true" ||
    !c.MUSIC_API_KEY ||
    !(perJob > 0) ||
    !(daily >= perJob) ||
    !Number.isFinite(daily)
  )
    throw fail(
      409,
      "MUSIC_CONFIGURATION",
      "Save the key, provider credit cost and daily budget, then enable music generation.",
    );
  return { perJob, daily };
}
export function registerWorkoutMusic(
  app: FastifyInstance,
  db: Database,
  identity: (req: FastifyRequest) => Identity,
) {
  function admin(req: FastifyRequest, write = false) {
    const a = identity(req);
    if (a.platformRole !== "admin")
      throw fail(403, "ROLE_REQUIRED", "Superadmin access is required.");
    requireRecentMfa(a, write);
    return a;
  }
  async function member(req: FastifyRequest) {
    const a = identity(req);
    const [r] = await db.tenant(a, (tx) =>
      tx.query("SELECT integration_actor_is_current($1,$2) AS active", [
        a.tenantId,
        a.userId,
      ]),
    );
    if (!r?.active)
      throw fail(
        403,
        "MEMBERSHIP_REQUIRED",
        "An active workspace membership is required.",
      );
    return a;
  }
  // Callbacks are untrusted hints. Completion and files are read from the authenticated provider API.
  app.post(
    "/api/v1/public/music/callback",
    {
      bodyLimit: 65536,
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    },
    async () => ({ received: true }),
  );
  app.get("/api/v1/music", async (req) => {
    await member(req);
    const tracks = await db.system((tx) =>
      tx.query(
        `SELECT ${metadata} FROM workout_music_tracks WHERE status='approved' ORDER BY playlist,created_at,id`,
      ),
    );
    return {
      target: MUSIC_TARGET,
      playlists: MUSIC_PLAYLISTS.map((p) => ({
        id: p.id,
        name: p.name,
        ar: p.ar,
        tracks: tracks
          .filter(
            (t) =>
              t.playlist === p.id &&
              tracks.filter((c) => c.playlist === p.id).length >= MUSIC_TARGET,
          )
          .map((t) => ({
            id: t.id,
            playlist: t.playlist,
            title: t.title,
            duration: Number(t.duration),
            url: `/api/v1/music/${t.id}/audio`,
          })),
      })),
    };
  });
  async function audio(req: FastifyRequest, reply: any, preview: boolean) {
    if (preview) admin(req);
    else await member(req);
    const id = uuid.parse((req.params as any).id);
    const [track] = await db.system((tx) =>
      tx.query(
        "SELECT status,octet_length(audio) AS bytes FROM workout_music_tracks WHERE id=$1",
        [id],
      ),
    );
    if (!track || (!preview && track.status !== "approved"))
      throw fail(404, "MUSIC_NOT_FOUND", "This track is unavailable.");
    const bytes = Number(track.bytes);
    let start = 0,
      end = bytes - 1;
    const range = req.headers.range;
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!m || (!m[1] && !m[2]))
        return reply
          .code(416)
          .header("Content-Range", `bytes */${bytes}`)
          .send();
      if (!m[1]) start = Math.max(0, bytes - Number(m[2]));
      else {
        start = Number(m[1]);
        end = m[2] ? Math.min(bytes - 1, Number(m[2])) : bytes - 1;
      }
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start > end ||
        start >= bytes
      )
        return reply
          .code(416)
          .header("Content-Range", `bytes */${bytes}`)
          .send();
      reply.code(206).header("Content-Range", `bytes ${start}-${end}/${bytes}`);
    }
    const [row] = await db.system((tx) =>
      tx.query(
        "SELECT substring(audio FROM $2 FOR $3) AS audio FROM workout_music_tracks WHERE id=$1 AND ($4 OR status='approved')",
        [id, start + 1, end - start + 1, preview],
      ),
    );
    if (!row) throw fail(404, "MUSIC_NOT_FOUND", "This track is unavailable.");
    return reply
      .type("audio/mpeg")
      .header("Accept-Ranges", "bytes")
      .header("Cache-Control", "private,no-store")
      .header("Content-Length", end - start + 1)
      .send(Buffer.from(row.audio));
  }
  app.get("/api/v1/music/:id/audio", (req, reply) => audio(req, reply, false));
  app.get("/api/v1/admin/music/:id/audio", (req, reply) =>
    audio(req, reply, true),
  );
  app.get("/api/v1/admin/music", async (req) => {
    admin(req);
    return db.system(async (tx) => ({
      playlists: MUSIC_PLAYLISTS.map(({ id, name }) => ({ id, name })),
      target: MUSIC_TARGET,
      tracks: await tx.query(
        `SELECT ${metadata} FROM workout_music_tracks ORDER BY playlist,created_at,id`,
      ),
      jobs: await tx.query(
        "SELECT id,playlist,slot,status,task_id,credit_limit,credits_before,credits_after,error,created_at FROM workout_music_jobs ORDER BY created_at DESC LIMIT 500",
      ),
      enabled: runtimeConfig().MUSIC_ENABLED === "true",
    }));
  });
  app.get(
    "/api/v1/admin/music/credits",
    { config: { rateLimit: { max: 6, timeWindow: "1 minute" } } },
    async (req) => {
      admin(req);
      return { credits: await musicCredits() };
    },
  );
  app.post(
    "/api/v1/admin/music/generate",
    { config: { rateLimit: { max: 8, timeWindow: "1 minute" } } },
    async (req) => {
      const a = admin(req, true);
      const b = z
        .object({
          requestId: uuid,
          playlist,
          requests: z.number().int().min(1).max(15),
        })
        .strict()
        .parse(req.body);
      const { perJob, daily } = limits();
      const credits = await musicCredits();
      return db.system(async (tx) => {
        await tx.query(
          "SELECT pg_advisory_xact_lock(hashtext('workout-music-budget'))",
        );
        const prior = await tx.query(
          "SELECT id,requested_by,playlist FROM workout_music_jobs WHERE id=$1",
          [b.requestId],
        );
        if (prior.length) {
          if (
            prior[0].requested_by !== a.userId ||
            prior[0].playlist !== b.playlist
          )
            throw fail(
              409,
              "MUSIC_INTENT",
              "This request already belongs to another batch.",
            );
          return { queued: true, requestId: b.requestId };
        }
        const [reserved] = await tx.query(
          "SELECT coalesce(sum(CASE WHEN status='queued' OR submitted_at >= date_trunc('day',now()) THEN credit_limit ELSE 0 END),0) AS total,coalesce(sum(CASE WHEN status IN ('queued','submitting','pending','unknown') THEN credit_limit ELSE 0 END),0) AS outstanding FROM workout_music_jobs WHERE NOT imported AND status<>'cancelled'",
        );
        const cost = perJob * b.requests;
        if (
          Number(reserved.total) + cost > daily ||
          Number(reserved.outstanding) + cost > credits
        )
          throw fail(
            409,
            "MUSIC_BUDGET",
            "This batch exceeds the daily budget or available credits.",
          );
        const [slots] = await tx.query(
          "SELECT coalesce(max(slot),-1) AS last FROM workout_music_jobs WHERE playlist=$1",
          [b.playlist],
        );
        if (Number(slots.last) + b.requests >= 60)
          throw fail(
            409,
            "MUSIC_LIMIT",
            "This playlist has reached its generation limit.",
          );
        for (let i = 0; i < b.requests; i++)
          await tx.query(
            "INSERT INTO workout_music_jobs(id,playlist,slot,status,credit_limit,requested_by) VALUES($1,$2,$3,'queued',$4,$5)",
            [
              i ? randomUUID() : b.requestId,
              b.playlist,
              Number(slots.last) + 1 + i,
              perJob,
              a.userId,
            ],
          );
        await audit(tx, "batch_queued", a.userId, b.requestId, {
          playlist: b.playlist,
          requests: b.requests,
          reservedCredits: cost,
        });
        return { queued: true, requestId: b.requestId };
      });
    },
  );
  // Import already-paid tasks. The worker verifies each provider request before
  // downloading. This path never calls generation or spends provider credits.
  app.post(
    "/api/v1/admin/music/import",
    {
      bodyLimit: 65536,
      config: { rateLimit: { max: 4, timeWindow: "1 minute" } },
    },
    async (req) => {
      const a = admin(req, true);
      const entries = z
        .object({
          tasks: z
            .array(
              z
                .object({
                  playlist,
                  slot: z.number().int().min(0).max(59),
                  taskId: z.string().trim().min(1).max(200),
                })
                .strict(),
            )
            .min(1)
            .max(120),
        })
        .strict()
        .parse(req.body).tasks;
      return db.system(async (tx) => {
        await tx.query(
          "SELECT pg_advisory_xact_lock(hashtext('workout-music-budget'))",
        );
        let imported = 0;
        for (const entry of entries) {
          const [prior] = await tx.query(
            "SELECT * FROM workout_music_jobs WHERE task_id=$1 OR (playlist=$2 AND slot=$3)",
            [entry.taskId, entry.playlist, entry.slot],
          );
          if (prior) {
            if (
              prior.task_id !== entry.taskId ||
              prior.playlist !== entry.playlist ||
              Number(prior.slot) !== entry.slot
            )
              throw fail(
                409,
                "MUSIC_IMPORT_CONFLICT",
                "A task or playlist slot already belongs to another job.",
              );
            continue;
          }
          await tx.query(
            "INSERT INTO workout_music_jobs(id,playlist,slot,status,task_id,credit_limit,imported,requested_by) VALUES($1,$2,$3,'pending',$4,0,true,$5)",
            [randomUUID(), entry.playlist, entry.slot, entry.taskId, a.userId],
          );
          imported++;
        }
        await audit(tx, "tasks_imported", a.userId, null, {
          imported,
          existing: entries.length - imported,
        });
        return { imported, existing: entries.length - imported };
      });
    },
  );
  app.post("/api/v1/admin/music/jobs/:id/reconcile", async (req) => {
    const a = admin(req, true),
      id = uuid.parse((req.params as any).id);
    const b = z
      .object({
        taskId: z.string().trim().min(1).max(200).optional(),
        cancel: z.literal(true).optional(),
      })
      .strict()
      .refine((v) => Boolean(v.taskId) !== Boolean(v.cancel))
      .parse(req.body);
    const result = b.taskId ? await musicResult(b.taskId) : null;
    return db.system(async (tx) => {
      const [job] = await tx.query(
        "SELECT * FROM workout_music_jobs WHERE id=$1 FOR UPDATE",
        [id],
      );
      if (!job || !["unknown", "queued", "failed"].includes(job.status))
        throw fail(
          409,
          "MUSIC_JOB_STATE",
          "Only queued, failed or unknown jobs can be reconciled.",
        );
      if (
        result &&
        (!result.instrumental ||
          result.title !== musicBrief(job.playlist, Number(job.slot)).title)
      )
        throw fail(
          409,
          "MUSIC_TASK_MISMATCH",
          "The provider task is not the expected instrumental request.",
        );
      if (b.cancel && job.status !== "queued")
        throw fail(
          409,
          "MUSIC_UNKNOWN",
          "Attach the provider task ID to reconcile an unknown or failed result. Its credit reservation remains recorded.",
        );
      await tx.query(
        "UPDATE workout_music_jobs SET status=$2,task_id=$3,error=NULL,leased_until=NULL,poll_after=NULL,updated_at=now() WHERE id=$1",
        [id, b.cancel ? "cancelled" : "pending", b.taskId ?? null],
      );
      await audit(tx, "job_reconciled", a.userId, id, {
        cancelled: !!b.cancel,
        attachedTask: !!b.taskId,
      });
      return { ok: true };
    });
  });
  app.post("/api/v1/admin/music/:id/review", async (req) => {
    const a = admin(req, true),
      id = uuid.parse((req.params as any).id);
    const b = z
      .object({
        status: z.enum(["approved", "rejected"]),
        note: z.string().trim().min(3).max(600),
        instrumental: z.literal(true).optional(),
      })
      .strict()
      .parse(req.body);
    if (b.status === "approved" && !b.instrumental)
      throw fail(
        400,
        "MUSIC_REVIEW",
        "Confirm you checked that the track is instrumental and suitable for playback.",
      );
    return db.system(async (tx) => {
      const rows = await tx.query(
        "UPDATE workout_music_tracks SET status=$2,review_note=$3,reviewed_by=$4,reviewed_at=now() WHERE id=$1 RETURNING id",
        [id, b.status, b.note, a.userId],
      );
      if (!rows.length) throw fail(404, "MUSIC_NOT_FOUND", "Track not found.");
      await audit(tx, "track_" + b.status, a.userId, id, { note: b.note });
      return { ok: true };
    });
  });
}

/** One bounded job per tick. A submitted request is never automatically reissued. */
export async function processWorkoutMusic(db: Database) {
  if (!runtimeConfig().MUSIC_API_KEY) return;
  const generationEnabled = runtimeConfig().MUSIC_ENABLED === "true";
  const job = await db.system(async (tx) => {
    await tx.query(
      "SELECT pg_advisory_xact_lock(hashtext('workout-music-worker'))",
    );
    await tx.query(
      "SELECT pg_advisory_xact_lock(hashtext('workout-music-budget'))",
    );
    await tx.query(
      "UPDATE workout_music_jobs SET status='unknown',error='Worker interrupted during submission; reconcile provider task.',leased_until=NULL,updated_at=now() WHERE status='submitting' AND leased_until<now()",
    );
    const [active] = await tx.query(
      "SELECT id FROM workout_music_jobs WHERE leased_until>now() LIMIT 1",
    );
    if (active) return null;
    const [row] = await tx.query(
      "SELECT * FROM workout_music_jobs WHERE status IN ('pending','queued') AND ($1 OR status='pending') AND (leased_until IS NULL OR leased_until<now()) AND (poll_after IS NULL OR poll_after<=now()) ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END,created_at,id LIMIT 1 FOR UPDATE",
      [generationEnabled],
    );
    if (!row) return null;
    if (row.status === "queued") {
      const { perJob, daily } = limits();
      const [spent] = await tx.query(
        "SELECT coalesce(sum(credit_limit),0) AS total FROM workout_music_jobs WHERE submitted_at>=date_trunc('day',now()) AND NOT imported",
      );
      if (
        perJob !== Number(row.credit_limit) ||
        Number(spent.total) + perJob > daily
      ) {
        await tx.query(
          "UPDATE workout_music_jobs SET error='Waiting for matching credit cost and available daily budget.',poll_after=now()+interval '5 minutes' WHERE id=$1",
          [row.id],
        );
        return null;
      }
    }
    await tx.query(
      "UPDATE workout_music_jobs SET submitted_at=CASE WHEN status='queued' THEN now() ELSE submitted_at END,status=CASE WHEN status='queued' THEN 'submitting' ELSE status END,leased_until=now()+interval '5 minutes',updated_at=now() WHERE id=$1",
      [row.id],
    );
    return row;
  });
  if (!job) return;
  try {
    if (job.status === "queued") {
      const credits = await musicCredits();
      if (credits < Number(job.credit_limit))
        throw new MusicProviderError(
          "definitive",
          "Insufficient provider credits.",
        );
      await db.system((tx) =>
        tx.query(
          "UPDATE workout_music_jobs SET credits_before=$2 WHERE id=$1",
          [job.id, credits],
        ),
      );
      const taskId = await generateMusic(job.playlist, Number(job.slot));
      await db.system((tx) =>
        tx.query(
          "UPDATE workout_music_jobs SET status='pending',task_id=$2,leased_until=NULL,updated_at=now() WHERE id=$1",
          [job.id, taskId],
        ),
      );
      return;
    }
    const result = await musicResult(job.task_id);
    if (result.status === "pending") {
      await db.system((tx) =>
        tx.query(
          "UPDATE workout_music_jobs SET leased_until=NULL,poll_after=now()+interval '30 seconds',updated_at=now() WHERE id=$1",
          [job.id],
        ),
      );
      return;
    }
    if (result.status === "failed")
      throw new MusicProviderError(
        "definitive",
        "Provider generation failed; review the provider task before another request.",
      );
    if (
      !result.instrumental ||
      result.title !== musicBrief(job.playlist, Number(job.slot)).title
    )
      throw new MusicProviderError(
        "definitive",
        "The provider task is not the expected instrumental request.",
      );
    for (const track of result.tracks) {
      const [exists] = await db.system((tx) =>
        tx.query("SELECT id FROM workout_music_tracks WHERE provider_id=$1", [
          track.id,
        ]),
      );
      if (exists) continue;
      const audio = await downloadMusic(track.url);
      const sha = createHash("sha256").update(audio).digest("hex");
      await db.system((tx) =>
        tx.query(
          "INSERT INTO workout_music_tracks(id,job_id,provider_id,playlist,title,duration,sha256,audio) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING",
          [
            randomUUID(),
            job.id,
            track.id,
            job.playlist,
            track.title,
            track.duration,
            sha,
            audio,
          ],
        ),
      );
    }
    const credits = await musicCredits().catch(() => null);
    await db.system(async (tx) => {
      await tx.query(
        "UPDATE workout_music_jobs SET status='complete',credits_after=$2,leased_until=NULL,error=NULL,updated_at=now() WHERE id=$1",
        [job.id, credits],
      );
      await audit(tx, "generation_completed", null, job.id, {
        outputs: result.tracks.length,
      });
    });
  } catch (e) {
    const definitive =
      e instanceof MusicProviderError && e.outcome === "definitive";
    await db.system((tx) =>
      tx.query(
        "UPDATE workout_music_jobs SET status=$2,error=$3,leased_until=NULL,poll_after=now()+interval '2 minutes',updated_at=now() WHERE id=$1",
        [
          job.id,
          job.status === "pending" && !definitive
            ? "pending"
            : definitive
              ? "failed"
              : "unknown",
          e instanceof MusicProviderError
            ? e.message
            : "Music operation needs review.",
        ],
      ),
    );
  }
}
