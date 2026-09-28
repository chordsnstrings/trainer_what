// Trainer voice clones made in the app (docs/features/trainer-voice.md).
//
// The workspace owner records or uploads their own voice, confirms the four
// consent statements and chooses a Quick clone (one 10-60 second recording,
// made in seconds) or, when the operator has switched it on, a Pro clone (at
// least 30 minutes, trained by the provider for up to three hours and polled
// by the worker). Recordings are sealed with the server key and kept only
// until the provider holds them. A ready clone is previewed by the trainer and
// then activated: activation writes the workspace voice (trainer_voices), the
// only voice members hear, through guided_voice(). Deleting a clone, withdrawing
// voice consent, erasure, ownership transfer and workspace closure queue its
// deletion at the provider (voice_provider_deletions), which the worker
// confirms.
//
// Provider calls follow the voice-session pattern: the cost is reserved under
// the workspace voice budget first, marked unknown just before sending, and an
// answer that never arrived is reconciled by the clone's unique provider name
// before anything is sent again.
import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  elevated,
  event,
  type Actor,
  type Database,
  type Tx,
} from "@trainer/db";
import { runtimeConfig } from "../../../packages/providers/src/configuration.ts";
import {
  cartesiaVoiceClient,
  generateTrainerVoice,
  voiceContract,
  type VoiceContract,
} from "../../../packages/providers/src/integrations.ts";
import {
  CARTESIA_CLIP_TYPES,
  CARTESIA_CLONE_LANGUAGES,
  CartesiaError,
  proCloneModel,
  type CartesiaClient,
  type CartesiaClipType,
} from "../../../packages/providers/src/cartesia.ts";
import {
  CLONE_CONSENT,
  CLONE_CONSENT_VERSION,
  CLONE_LANGUAGE_NAMES,
  CLONE_LIMITS,
  PREVIEW_LINE,
  SAMPLE_TYPES,
  SampleError,
  assertTransition,
  checkSample,
  proRecordingFits,
  recordingsReady,
  type CloneKind,
  type CloneStatus,
  type SampleType,
} from "../../../packages/domain/src/voice-clone.ts";
import { legalAcceptanceVersion } from "./legal.ts";
import { requireRecentMfa } from "./security.ts";
import {
  encryptionReady,
  openSealedBytes,
  sealBytes,
  sealContexts,
} from "./sealing.ts";

type Identity = Actor & { platformRole?: string; mfaAt?: string | null };
const id = z.string().uuid();
const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
const conflict = () =>
  fail(409, "VOICE_CLONE_CHANGED", "This voice changed. Reload before continuing.");
function identity(req: FastifyRequest): Identity {
  if (!req.identity) throw fail(401, "AUTH_REQUIRED", "Please sign in.");
  return req.identity as Identity;
}
/** The trainer who owns the workspace; clones are theirs alone. */
function owner(req: FastifyRequest) {
  const a = identity(req);
  if (a.role !== "owner")
    throw fail(403, "OWNER_REQUIRED", "Workspace owner access is required.");
  return a;
}
function admin(req: FastifyRequest) {
  const a = identity(req);
  if (a.platformRole !== "admin")
    throw fail(403, "ADMIN_REQUIRED", "Platform administrator access is required.");
  requireRecentMfa(a, true);
  return a;
}
const workerActor = (tenantId: string): Actor =>
  elevated("worker", { tenantId, role: "owner" });
/** Same lock as the voice enrollment routes (integrations-completion.ts). */
async function lockVoice(tx: Tx, a: Actor) {
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    a.tenantId + ":voice:" + a.userId,
  ]);
}
function contractOrNull(): VoiceContract | null {
  try {
    return voiceContract();
  } catch {
    return null;
  }
}
/** The approved Cartesia contract, or a trainer-facing refusal. */
function cartesiaContract() {
  const contract = contractOrNull();
  if (!contract || contract.provider !== "cartesia")
    throw fail(
      409,
      "VOICE_CLONE_UNAVAILABLE",
      "Voice clones are not switched on for this platform yet.",
    );
  return contract;
}
async function latestVoiceConsent(tx: Tx, userId: string) {
  const [c] = await tx.query(
    "SELECT granted FROM consent_records WHERE user_id=$1 AND document_type='voice' ORDER BY created_at DESC,id DESC LIMIT 1",
    [userId],
  );
  return c?.granted === true;
}
/** Consent still granted and the recording trainer still owns the workspace. */
async function trainerCurrent(tx: Tx, userId: string) {
  const [r] = await tx.query("SELECT workspace_member_role($1) AS role", [userId]);
  return r?.role === "owner" && (await latestVoiceConsent(tx, userId));
}
const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const CLONE_COLUMNS =
  "id,tenant_id,user_id,provider,kind,status,step,version,language,provider_name,provider_voice_id,provider_job,model,consent_version,evidence,error,previewed_at,attempts,next_attempt_at,lease_token,lease_until,submitted_at,ready_at,activated_at,deleted_at,created_at,updated_at,preview_audio IS NOT NULL AS has_preview";

// ------------------------------------------------------------------ provider deletions

type DeletionKind = "voice" | "fine_tune" | "dataset" | "named";
async function queueDeletion(
  tx: Tx,
  tenantId: string,
  kind: DeletionKind,
  reference: unknown,
  reason: string,
) {
  if (typeof reference !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(reference))
    return;
  await tx.query(
    "INSERT INTO voice_provider_deletions(id,tenant_id,provider,kind,reference,reason) VALUES($1,$2,'cartesia',$3,$4,$5) ON CONFLICT(tenant_id,provider,kind,reference) DO UPDATE SET status='pending',completed_at=NULL,next_attempt_at=now(),updated_at=now() WHERE voice_provider_deletions.status<>'pending'",
    [randomUUID(), tenantId, kind, reference, reason],
  );
}
/** Everything a clone may have left at the provider. */
async function queueCloneDeletion(tx: Tx, clone: any, reason: string) {
  const job = clone.provider_job ?? {};
  await queueDeletion(tx, clone.tenant_id, "voice", clone.provider_voice_id, reason);
  await queueDeletion(tx, clone.tenant_id, "fine_tune", job.fineTuneId, reason);
  await queueDeletion(tx, clone.tenant_id, "dataset", job.datasetId, reason);
  // A request whose answer was lost may have created something under the name.
  if (clone.submitted_at)
    await queueDeletion(tx, clone.tenant_id, "named", clone.provider_name, reason);
}
/** The workspace voice stops: no generation and no stored playback. */
async function revokeWorkspaceVoice(tx: Tx, voiceId: string) {
  await tx.query(
    "UPDATE trainer_voices SET status='revoked',sample=NULL,provider_voice_id=NULL,clone_id=NULL,version=version+1,updated_at=now() WHERE id=$1",
    [voiceId],
  );
  await tx.query(
    "UPDATE guided_audio SET status='revoked',audio=NULL WHERE voice_id=$1",
    [voiceId],
  );
  await tx.query(
    "UPDATE voice_session_clips SET status='revoked',audio=NULL,updated_at=now() WHERE voice_id=$1 AND status<>'revoked'",
    [voiceId],
  );
  await tx.query(
    "UPDATE voice_sessions SET mode='text',audio_status='revoked',unavailable_reason='VOICE_UNAVAILABLE',version=version+1,updated_at=now() WHERE voice_id=$1 AND audio_status<>'revoked'",
    [voiceId],
  );
}
/**
 * Deletes one clone here (recordings, preview and provider ids) and queues it
 * for deletion at the provider. The workspace voice stops if it came from it.
 */
async function retireClone(tx: Tx, clone: any, reason: string) {
  await queueCloneDeletion(tx, clone, reason);
  await tx.query("DELETE FROM trainer_voice_samples WHERE clone_id=$1", [clone.id]);
  const voices = await tx.query<{ id: string }>(
    "SELECT id FROM trainer_voices WHERE clone_id=$1",
    [clone.id],
  );
  for (const v of voices) await revokeWorkspaceVoice(tx, v.id);
  await tx.query(
    "UPDATE trainer_voice_clones SET status='deleted',step=NULL,provider_voice_id=NULL,provider_job='{}',preview_audio=NULL,previewed_at=NULL,lease_token=NULL,lease_until=NULL,next_attempt_at=NULL,deleted_at=now(),evidence=evidence||$2::jsonb,version=version+1,updated_at=now() WHERE id=$1",
    [clone.id, JSON.stringify({ deletedFor: reason })],
  );
}
/**
 * Retires every clone a trainer made (voice consent withdrawn, erasure,
 * ownership transfer). Runs in an owner-role scope of the workspace.
 */
export async function retireTrainerVoiceClones(
  tx: Tx,
  userId: string,
  reason: string,
) {
  if (!(await cloneTablesExist(tx))) return 0;
  const clones = await tx.query(
    `SELECT ${CLONE_COLUMNS} FROM trainer_voice_clones WHERE user_id=$1 AND status<>'deleted' FOR UPDATE`,
    [userId],
  );
  for (const clone of clones) await retireClone(tx, clone, reason);
  return clones.length;
}
async function cloneTablesExist(tx: Tx) {
  const [r] = await tx.query(
    "SELECT to_regclass('public.trainer_voice_clones') AS name",
  );
  return !!r?.name;
}
/**
 * Workspace closure: every clone is queued for provider deletion, then the
 * clones and recordings are removed. The deletion queue stays.
 */
export async function closeWorkspaceVoiceClones(tx: Tx) {
  if (!(await cloneTablesExist(tx))) return;
  const clones = await tx.query(
    `SELECT ${CLONE_COLUMNS} FROM trainer_voice_clones WHERE status<>'deleted'`,
  );
  for (const clone of clones) await queueCloneDeletion(tx, clone, "workspace_closed");
  await tx.query("UPDATE trainer_voices SET clone_id=NULL WHERE clone_id IS NOT NULL");
  await tx.query("DELETE FROM trainer_voice_samples");
  await tx.query("DELETE FROM trainer_voice_clones");
}
/** Erasure: the trainer's clones are queued for provider deletion and removed. */
export async function eraseTrainerVoiceClones(tx: Tx, userId: string) {
  if (!(await cloneTablesExist(tx))) return;
  await retireTrainerVoiceClones(tx, userId, "erasure");
  await tx.query("UPDATE trainer_voices SET clone_id=NULL WHERE clone_id IN (SELECT id FROM trainer_voice_clones WHERE user_id=$1)", [userId]);
  await tx.query("DELETE FROM trainer_voice_samples WHERE user_id=$1", [userId]);
  await tx.query("DELETE FROM trainer_voice_clones WHERE user_id=$1", [userId]);
}
/** Personal export: what was recorded and made, never audio or provider ids. */
export async function exportTrainerVoiceClones(tx: Tx, userId: string) {
  if (!(await cloneTablesExist(tx))) return [];
  const clones = await tx.query(
    "SELECT id,kind,status,language,consent_version,evidence,created_at,submitted_at,ready_at,activated_at,deleted_at FROM trainer_voice_clones WHERE user_id=$1 ORDER BY created_at",
    [userId],
  );
  const samples = await tx.query(
    "SELECT clone_id,content_type,byte_count,seconds,sha256,status,created_at FROM trainer_voice_samples WHERE user_id=$1",
    [userId],
  );
  return clones.map((c) => ({
    ...c,
    recordings: samples
      .filter((s) => s.clone_id === c.id)
      .map(({ clone_id, ...s }) => s),
  }));
}
/** Whether this workspace has clones or pending provider deletions (privacy inventory). */
export async function voiceCloneProviderInUse(tx: Tx, userId?: string) {
  if (!(await cloneTablesExist(tx))) return false;
  const [r] = await tx.query(
    "SELECT EXISTS(SELECT 1 FROM trainer_voice_clones WHERE ($1::uuid IS NULL OR user_id=$1) AND (status<>'deleted' OR submitted_at IS NOT NULL)) OR ($1::uuid IS NULL AND EXISTS(SELECT 1 FROM voice_provider_deletions WHERE status<>'done')) AS used",
    [userId ?? null],
  );
  return r?.used === true;
}

/** One pass over due provider deletions of a workspace. */
export async function processVoiceProviderDeletions(
  db: Database,
  actor: Actor,
  limit = 10,
) {
  const contract = contractOrNull();
  if (!contract || contract.provider !== "cartesia") return 0;
  const client = cartesiaVoiceClient(contract);
  const due = await db.tenant(actor, (tx) =>
    tx.query(
      "UPDATE voice_provider_deletions SET next_attempt_at=now()+interval '10 minutes',attempts=attempts+1,updated_at=now() WHERE id IN (SELECT id FROM voice_provider_deletions WHERE status='pending' AND next_attempt_at<=now() ORDER BY next_attempt_at LIMIT $1 FOR UPDATE SKIP LOCKED) RETURNING *",
      [limit],
    ),
  );
  let done = 0;
  for (const d of due) {
    try {
      if (d.kind === "voice") await client.deleteVoice(d.reference);
      else if (d.kind === "fine_tune") await client.deleteFineTune(d.reference);
      else if (d.kind === "dataset") await client.deleteDataset(d.reference);
      else {
        for (const v of await client.voicesNamed(d.reference))
          await client.deleteVoice(v.id);
        for (const f of await client.fineTunesNamed(d.reference))
          await client.deleteFineTune(f.id);
        for (const s of await client.datasetsNamed(d.reference))
          await client.deleteDataset(s.id);
      }
      await db.tenant(actor, (tx) =>
        tx.query(
          "UPDATE voice_provider_deletions SET status='done',completed_at=now(),last_error=NULL,updated_at=now() WHERE id=$1",
          [d.id],
        ),
      );
      done++;
    } catch (error) {
      const message =
        error instanceof CartesiaError
          ? error.message.slice(0, 300)
          : "The provider could not be reached.";
      await db.tenant(actor, (tx) =>
        tx.query(
          "UPDATE voice_provider_deletions SET status=CASE WHEN attempts>=10 THEN 'attention' ELSE 'pending' END,last_error=$2,next_attempt_at=now()+least(interval '12 hours',interval '1 minute'*power(2,least(attempts,10))),updated_at=now() WHERE id=$1",
          [d.id, message],
        ),
      );
    }
  }
  return done;
}

// ------------------------------------------------------------------ provider steps

type StepResult = "continue" | "wait" | "done";
type Clone = Record<string, any>;
const DESCRIPTION = "Trainer voice for one trainsyou workspace (private).";
/**
 * Saves the outcome of a step and releases the lease; false when the clone
 * changed meanwhile (deleted or retried by the trainer).
 */
async function save(
  tx: Tx,
  cloneId: string,
  lease: string,
  fields: Record<string, unknown>,
) {
  const keys = Object.keys(fields);
  const [row] = await tx.query(
    `UPDATE trainer_voice_clones SET ${keys.map((k, i) => `${k}=$${i + 3}`).join(",")}${keys.length ? "," : ""}lease_token=NULL,lease_until=NULL,version=version+1,updated_at=now() WHERE id=$1 AND lease_token=$2 AND status='processing' RETURNING id`,
    [
      cloneId,
      lease,
      ...keys.map((k) =>
        fields[k] !== null && typeof fields[k] === "object" && !(fields[k] instanceof Date)
          ? JSON.stringify(fields[k])
          : fields[k],
      ),
    ],
  );
  return !!row;
}
const later = (seconds: number) => new Date(Date.now() + seconds * 1000);
function failure(code: string, message: string) {
  return {
    status: "failed",
    step: null,
    next_attempt_at: null,
    error: { code, message, at: new Date().toISOString() },
  };
}
async function reserveCost(
  tx: Tx,
  a: Actor,
  userId: string,
  task: "voice.clone" | "voice.preview",
  contract: VoiceContract,
  model: string,
  pricing: Record<string, unknown> & { reservedCostUsd: number },
  traceId: string,
) {
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    a.tenantId + ":voice-budget",
  ]);
  const [spent] = await tx.query("SELECT voice_guidance_spent_today() AS total");
  if (Number(spent.total) + pricing.reservedCostUsd > contract.cap) return null;
  const usageId = randomUUID();
  await tx.query(
    "INSERT INTO cost_events(id,tenant_id,user_id,task,provider,model,status,price_version,pricing,trace_id) VALUES($1,$2,$3,$4,$5,$6,'reserved',$7,$8,$9)",
    [
      usageId,
      a.tenantId,
      userId,
      task,
      contract.provider,
      model,
      contract.priceVersion,
      JSON.stringify({ ...pricing, estimated: true }),
      traceId,
    ],
  );
  return usageId;
}
async function costUnknown(tx: Tx, usageId: string | null) {
  if (usageId)
    await tx.query(
      "UPDATE cost_events SET status='unknown' WHERE id=$1 AND status='reserved'",
      [usageId],
    );
}
/** The last check before a provider request: still ours, consent still stands. */
function guard(
  db: Database,
  actor: Actor,
  clone: Clone,
  lease: string,
  change: (tx: Tx) => Promise<void>,
) {
  return () =>
    db.tenant(actor, async (tx) => {
      const [row] = await tx.query(
        "SELECT id FROM trainer_voice_clones WHERE id=$1 AND lease_token=$2 AND status='processing' FOR UPDATE",
        [clone.id, lease],
      );
      if (!row) throw fail(409, "VOICE_CLONE_CHANGED", "The clone changed.");
      if (!(await trainerCurrent(tx, clone.user_id)))
        throw fail(409, "VOICE_CONSENT", "Voice consent changed.");
      await change(tx);
    });
}
async function ready(
  db: Database,
  actor: Actor,
  clone: Clone,
  lease: string,
  voiceId: string,
  model: string | null,
  extra: Record<string, unknown> = {},
) {
  return db.tenant(actor, async (tx) => {
    const saved = await save(tx, clone.id, lease, {
      status: "ready",
      step: null,
      provider_voice_id: voiceId,
      model,
      ready_at: new Date(),
      error: null,
      next_attempt_at: null,
      ...extra,
    });
    if (!saved) {
      // Deleted meanwhile: what the provider just made is deleted too.
      await queueDeletion(tx, clone.tenant_id, "voice", voiceId, "trainer_deleted");
      return "done" as const;
    }
    // Recordings are no longer needed once the provider holds the voice.
    await tx.query(
      "UPDATE trainer_voice_samples SET status='uploaded',sealed=NULL,updated_at=now() WHERE clone_id=$1",
      [clone.id],
    );
    await event(tx, actor, "voice.clone_ready", clone.id, { kind: clone.kind });
    return "done" as const;
  });
}
async function outcome(
  db: Database,
  actor: Actor,
  clone: Clone,
  lease: string,
  error: unknown,
  onAmbiguous: Record<string, unknown>,
  onRetry: Record<string, unknown>,
): Promise<StepResult> {
  return db.tenant<StepResult>(actor, async (tx) => {
    if (!(error instanceof CartesiaError)) {
      const code = (error as any)?.code;
      if (code === "VOICE_CONSENT")
        await save(tx, clone.id, lease, failure("VOICE_CONSENT", "Voice consent was withdrawn."));
      else if (code !== "VOICE_CLONE_CHANGED")
        await save(tx, clone.id, lease, { next_attempt_at: later(300) });
      return "wait";
    }
    if (error.outcome === "rejected")
      await save(
        tx,
        clone.id,
        lease,
        failure(error.code ?? "PROVIDER_REFUSED", error.message),
      );
    else if (error.outcome === "retry")
      await save(tx, clone.id, lease, { next_attempt_at: later(120), ...onRetry });
    else await save(tx, clone.id, lease, { next_attempt_at: later(60), ...onAmbiguous });
    return "wait";
  });
}
async function openSample(tenantId: string, sample: any) {
  return openSealedBytes(
    sealContexts.voiceSample(tenantId, sample.id),
    Buffer.from(sample.sealed),
  );
}

async function stepInstantClone(
  db: Database,
  actor: Actor,
  client: CartesiaClient,
  contract: VoiceContract,
  clone: Clone,
  lease: string,
): Promise<StepResult> {
  const job = { ...(clone.provider_job ?? {}) };
  const [sample] = await db.tenant(actor, (tx) =>
    tx.query(
      "SELECT id,content_type,sealed FROM trainer_voice_samples WHERE clone_id=$1 AND status<>'uploaded' ORDER BY created_at LIMIT 1",
      [clone.id],
    ),
  );
  if (!sample)
    return db.tenant(actor, async (tx) => {
      await save(tx, clone.id, lease, failure("RECORDING_MISSING", "The recording is no longer stored. Record again."));
      return "done" as const;
    });
  let audio: Buffer;
  try {
    audio = await openSample(clone.tenant_id, sample);
  } catch {
    return db.tenant(actor, async (tx) => {
      await save(tx, clone.id, lease, failure("RECORDING_UNREADABLE", "The recording could not be opened. Record again."));
      return "done" as const;
    });
  }
  let usageId: string | null = null;
  try {
    usageId = await db.tenant(actor, (tx) =>
      reserveCost(tx, actor, clone.user_id, "voice.clone", contract, contract.model, {
        basis: "clone",
        kind: "instant",
        reservedCostUsd: contract.cloning.cloneUsd,
      }, clone.id),
    );
    if (!usageId)
      return await db.tenant(actor, async (tx) => {
        await save(tx, clone.id, lease, {
          next_attempt_at: later(1800),
          error: { code: "VOICE_BUDGET", message: "Today's voice limit for this workspace is reached; the clone continues later." },
        });
        return "wait" as const;
      });
    const reserved = usageId;
    const voice = await client.cloneVoice(
      {
        clip: audio,
        type: sample.content_type as CartesiaClipType,
        name: clone.provider_name,
        language: clone.language,
        description: DESCRIPTION,
      },
      guard(db, actor, clone, lease, async (tx) => {
        await tx.query(
          "UPDATE trainer_voice_clones SET step='clone_unknown',provider_job=provider_job||'{\"sent\":true}'::jsonb WHERE id=$1",
          [clone.id],
        );
        await costUnknown(tx, reserved);
      }),
    );
    // After a resend, an earlier request may have made a copy under the name.
    if (job.resends)
      await db.tenant(actor, async (tx) => {
        for (const extra of (await client.voicesNamed(clone.provider_name).catch(() => [])).filter((v) => v.id !== voice.id))
          await queueDeletion(tx, clone.tenant_id, "voice", extra.id, "duplicate");
      });
    return await ready(db, actor, clone, lease, voice.id, contract.model, { provider_job: { ...job, sent: true } });
  } catch (error) {
    // Sent or not, a reserved cost waits for invoice reconciliation.
    if (usageId) await db.tenant(actor, (tx) => costUnknown(tx, usageId));
    return outcome(
      db,
      actor,
      clone,
      lease,
      error,
      { step: "clone_unknown", provider_job: { ...job, sent: true } },
      { step: "clone" },
    );
  } finally {
    audio.fill(0);
  }
}
async function stepInstantReconcile(
  db: Database,
  actor: Actor,
  client: CartesiaClient,
  contract: VoiceContract,
  clone: Clone,
  lease: string,
): Promise<StepResult> {
  const job = { ...(clone.provider_job ?? {}) };
  let found: Awaited<ReturnType<CartesiaClient["voicesNamed"]>>;
  try {
    found = await client.voicesNamed(clone.provider_name);
  } catch (error) {
    return outcome(db, actor, clone, lease, error, {}, {});
  }
  if (found.length) {
    await db.tenant(actor, async (tx) => {
      for (const extra of found.slice(1))
        await queueDeletion(tx, clone.tenant_id, "voice", extra.id, "duplicate");
    });
    return ready(db, actor, clone, lease, found[0].id, contract.model);
  }
  const checks = Number(job.unknownChecks ?? 0),
    resends = Number(job.resends ?? 0);
  return db.tenant(actor, async (tx) => {
    // The voice list may lag the clone by a moment: look a few times first.
    if (checks < 3)
      await save(tx, clone.id, lease, {
        provider_job: { ...job, unknownChecks: checks + 1 },
        next_attempt_at: later(60),
      });
    else if (resends < 2)
      await save(tx, clone.id, lease, {
        step: "clone",
        provider_job: { ...job, unknownChecks: 0, resends: resends + 1 },
        next_attempt_at: null,
      });
    else
      await save(
        tx,
        clone.id,
        lease,
        failure("PROVIDER_UNCONFIRMED", "The voice provider did not confirm the clone. Try again."),
      );
    return "wait" as const;
  });
}

async function stepDataset(
  db: Database,
  actor: Actor,
  client: CartesiaClient,
  clone: Clone,
  lease: string,
): Promise<StepResult> {
  const job = { ...(clone.provider_job ?? {}) };
  try {
    let datasetId: string | undefined = job.datasetId;
    if (!datasetId && job.datasetSent) {
      const found = await client.datasetsNamed(clone.provider_name);
      datasetId = found[0]?.id;
      if (found.length > 1)
        await db.tenant(actor, async (tx) => {
          for (const extra of found.slice(1))
            await queueDeletion(tx, clone.tenant_id, "dataset", extra.id, "duplicate");
        });
    }
    if (!datasetId)
      datasetId = (
        await client.createDataset(
          { name: clone.provider_name, description: DESCRIPTION },
          guard(db, actor, clone, lease, async (tx) => {
            await tx.query(
              "UPDATE trainer_voice_clones SET provider_job=provider_job||'{\"datasetSent\":true}'::jsonb WHERE id=$1",
              [clone.id],
            );
          }),
        )
      ).id;
    const id = datasetId;
    return db.tenant(actor, async (tx) =>
      (await save(tx, clone.id, lease, {
        step: "upload",
        provider_job: { ...job, datasetSent: true, datasetId: id },
        next_attempt_at: null,
      }))
        ? "continue"
        : (await queueDeletion(tx, clone.tenant_id, "dataset", id, "trainer_deleted"), "done"),
    );
  } catch (error) {
    return outcome(db, actor, clone, lease, error, { provider_job: { ...job, datasetSent: true } }, {});
  }
}
async function stepUpload(
  db: Database,
  actor: Actor,
  client: CartesiaClient,
  clone: Clone,
  lease: string,
): Promise<StepResult> {
  const job = { ...(clone.provider_job ?? {}) };
  const [sample] = await db.tenant(actor, (tx) =>
    tx.query(
      "SELECT id,content_type,status,sealed FROM trainer_voice_samples WHERE clone_id=$1 AND status<>'uploaded' ORDER BY created_at LIMIT 1",
      [clone.id],
    ),
  );
  if (!sample)
    return db.tenant(actor, async (tx) =>
      (await save(tx, clone.id, lease, { step: "fine_tune", next_attempt_at: null })) ? "continue" : "done",
    );
  const filename = `${sample.id}.${CARTESIA_CLIP_TYPES[sample.content_type as CartesiaClipType]}`;
  const uploaded = () =>
    db.tenant(actor, async (tx) => {
      await tx.query(
        "UPDATE trainer_voice_samples SET status='uploaded',sealed=NULL,updated_at=now() WHERE id=$1",
        [sample.id],
      );
      return (await save(tx, clone.id, lease, {})) ? ("continue" as const) : ("done" as const);
    });
  let audio: Buffer | null = null;
  try {
    // An earlier upload whose answer was lost: the dataset lists its files.
    if (sample.status === "uploading" && (await client.datasetFiles(job.datasetId)).some((f: { filename: string }) => f.filename === filename))
      return await uploaded();
    try {
      audio = await openSample(clone.tenant_id, sample);
    } catch {
      return await db.tenant(actor, async (tx) => {
        await save(tx, clone.id, lease, failure("RECORDING_UNREADABLE", "A recording could not be opened. Remove it and add it again."));
        return "done" as const;
      });
    }
    await client.uploadDatasetFile(
      job.datasetId,
      { data: audio, type: sample.content_type as CartesiaClipType, filename },
      guard(db, actor, clone, lease, async (tx) => {
        await tx.query(
          "UPDATE trainer_voice_samples SET status='uploading',updated_at=now() WHERE id=$1",
          [sample.id],
        );
      }),
    );
    return await uploaded();
  } catch (error) {
    return outcome(db, actor, clone, lease, error, {}, {});
  } finally {
    audio?.fill(0);
  }
}
async function stepFineTune(
  db: Database,
  actor: Actor,
  client: CartesiaClient,
  contract: VoiceContract,
  clone: Clone,
  lease: string,
): Promise<StepResult> {
  const job = { ...(clone.provider_job ?? {}) };
  let usageId: string | null = null;
  try {
    let fineTune = null;
    if (job.fineTuneSent) fineTune = (await client.fineTunesNamed(clone.provider_name))[0] ?? null;
    if (!fineTune) {
      usageId = await db.tenant(actor, (tx) =>
        reserveCost(tx, actor, clone.user_id, "voice.clone", contract, contract.model, {
          basis: "clone",
          kind: "pro",
          reservedCostUsd: contract.cloning.cloneUsd,
        }, clone.id),
      );
      if (!usageId)
        return await db.tenant(actor, async (tx) => {
          await save(tx, clone.id, lease, {
            next_attempt_at: later(1800),
            error: { code: "VOICE_BUDGET", message: "Today's voice limit for this workspace is reached; training starts later." },
          });
          return "wait" as const;
        });
      const reserved = usageId;
      fineTune = await client.createFineTune(
        { name: clone.provider_name, description: DESCRIPTION, language: clone.language, dataset: job.datasetId },
        guard(db, actor, clone, lease, async (tx) => {
          await tx.query(
            "UPDATE trainer_voice_clones SET provider_job=provider_job||'{\"fineTuneSent\":true}'::jsonb WHERE id=$1",
            [clone.id],
          );
          await costUnknown(tx, reserved);
        }),
      );
    }
    const created = fineTune;
    return await db.tenant(actor, async (tx) =>
      (await save(tx, clone.id, lease, {
        step: "training",
        provider_job: { ...job, fineTuneSent: true, fineTuneId: created.id, supportedModelIds: created.supportedModelIds },
        next_attempt_at: later(120),
        error: null,
      }))
        ? "wait"
        : (await queueDeletion(tx, clone.tenant_id, "fine_tune", created.id, "trainer_deleted"), "done"),
    );
  } catch (error) {
    if (usageId) await db.tenant(actor, (tx) => costUnknown(tx, usageId));
    return outcome(db, actor, clone, lease, error, { provider_job: { ...job, fineTuneSent: true } }, {});
  }
}
async function stepTraining(
  db: Database,
  actor: Actor,
  client: CartesiaClient,
  clone: Clone,
  lease: string,
): Promise<StepResult> {
  const job = { ...(clone.provider_job ?? {}) };
  try {
    const fineTune = await client.getFineTune(job.fineTuneId);
    return await db.tenant(actor, async (tx) => {
      if (fineTune.status === "completed")
        return (await save(tx, clone.id, lease, {
          step: "voices",
          provider_job: { ...job, supportedModelIds: fineTune.supportedModelIds.length ? fineTune.supportedModelIds : job.supportedModelIds ?? [] },
          next_attempt_at: null,
        }))
          ? "continue"
          : "done";
      if (fineTune.status === "failed") {
        await save(tx, clone.id, lease, failure("TRAINING_FAILED", fineTune.errors.join(" ") || "The provider could not train this voice."));
        return "done";
      }
      // Cartesia documents up to 3 hours; a day without an answer needs the trainer.
      if (Date.now() - new Date(clone.submitted_at).getTime() > 24 * 3600 * 1000) {
        await save(tx, clone.id, lease, failure("TRAINING_TIMEOUT", "Training did not finish within a day. Delete this clone or try again."));
        return "done";
      }
      await save(tx, clone.id, lease, { next_attempt_at: later(120), error: null });
      return "wait";
    });
  } catch (error) {
    return outcome(db, actor, clone, lease, error, {}, {});
  }
}
async function stepVoices(
  db: Database,
  actor: Actor,
  client: CartesiaClient,
  contract: VoiceContract,
  clone: Clone,
  lease: string,
): Promise<StepResult> {
  const job = { ...(clone.provider_job ?? {}) };
  try {
    const voices = await client.fineTuneVoices(job.fineTuneId);
    if (!voices.length)
      return await db.tenant(actor, async (tx) => {
        await save(tx, clone.id, lease, { next_attempt_at: later(120) });
        return "wait" as const;
      });
    // A Pro clone speaks with a dated model it was trained for.
    const model = proCloneModel(contract.model, job.supportedModelIds ?? []) ?? contract.model;
    return await ready(db, actor, clone, lease, voices[0].id, model);
  } catch (error) {
    return outcome(db, actor, clone, lease, error, {}, {});
  }
}

/**
 * Takes a processing clone forward, step by step, until it waits on the
 * provider or finishes. `actor` is the trainer (a Quick clone made while they
 * wait) or the worker.
 */
export async function advanceVoiceClone(
  db: Database,
  actor: Actor,
  cloneId: string,
  options: { maxSteps?: number } = {},
) {
  const contract = contractOrNull();
  if (!contract || contract.provider !== "cartesia") return null;
  const client = cartesiaVoiceClient(contract);
  let last: StepResult = "wait";
  for (let n = 0; n < (options.maxSteps ?? 8); n++) {
    const lease = randomUUID();
    const [clone] = await db.tenant(actor, (tx) =>
      tx.query(
        `UPDATE trainer_voice_clones SET lease_token=$2,lease_until=now()+interval '10 minutes',attempts=attempts+1,updated_at=now() WHERE id=$1 AND status='processing' AND (lease_until IS NULL OR lease_until<now()) AND (next_attempt_at IS NULL OR next_attempt_at<=now()) RETURNING ${CLONE_COLUMNS}`,
        [cloneId, lease],
      ),
    );
    if (!clone) break;
    if (clone.kind === "pro" && !contract.cloning.pro && clone.step !== "training" && clone.step !== "voices") {
      await db.tenant(actor, (tx) => save(tx, clone.id, lease, { next_attempt_at: later(3600), error: { code: "VOICE_PRO_OFF", message: "Pro clones are switched off for now; this one continues when they are back on." } }));
      break;
    }
    try {
      last =
        clone.step === "clone"
          ? await stepInstantClone(db, actor, client, contract, clone, lease)
          : clone.step === "clone_unknown"
            ? await stepInstantReconcile(db, actor, client, contract, clone, lease)
            : clone.step === "dataset"
              ? await stepDataset(db, actor, client, clone, lease)
              : clone.step === "upload"
                ? await stepUpload(db, actor, client, clone, lease)
                : clone.step === "fine_tune"
                  ? await stepFineTune(db, actor, client, contract, clone, lease)
                  : clone.step === "training"
                    ? await stepTraining(db, actor, client, clone, lease)
                    : await stepVoices(db, actor, client, contract, clone, lease);
    } catch {
      await db.tenant(actor, (tx) =>
        tx.query(
          "UPDATE trainer_voice_clones SET lease_token=NULL,lease_until=NULL,next_attempt_at=now()+interval '5 minutes' WHERE id=$1 AND lease_token=$2",
          [clone.id, lease],
        ),
      );
      break;
    }
    if (last !== "continue") break;
  }
  return last;
}

/**
 * Worker pass: processing clones of active workspaces, provider deletions of
 * every workspace (closed ones too) and stale drafts or failed clones.
 */
export async function processVoiceClones(db: Database) {
  const contract = contractOrNull();
  if (!contract || contract.provider !== "cartesia") return;
  const tenants = await db.system((tx) =>
    tx.query<{ id: string; lifecycle_state: string }>(
      "SELECT id,lifecycle_state FROM tenants ORDER BY id",
    ),
  );
  for (const tenant of tenants) {
    const actor = workerActor(tenant.id);
    try {
      if (tenant.lifecycle_state === "active") {
        const due = await db.tenant(actor, (tx) =>
          tx.query<{ id: string }>(
            "SELECT id FROM trainer_voice_clones WHERE status='processing' AND (next_attempt_at IS NULL OR next_attempt_at<=now()) AND (lease_until IS NULL OR lease_until<now()) ORDER BY next_attempt_at NULLS FIRST LIMIT 5",
          ),
        );
        for (const clone of due) await advanceVoiceClone(db, actor, clone.id);
        await db.tenant(actor, async (tx) => {
          const stale = await tx.query(
            `SELECT ${CLONE_COLUMNS} FROM trainer_voice_clones WHERE status IN ('draft','failed') AND updated_at<now()-make_interval(days=>$1) FOR UPDATE SKIP LOCKED`,
            [CLONE_LIMITS.staleDays],
          );
          for (const clone of stale) {
            await retireClone(tx, clone, "abandoned");
            await event(tx, actor, "voice.clone_deleted", clone.id, { reason: "abandoned" });
          }
        });
      }
      await processVoiceProviderDeletions(db, actor);
    } catch {
      console.error("Trainer voice clone work needs review");
    }
  }
}

// ------------------------------------------------------------------ routes

function samplePublic(s: any) {
  return {
    id: s.id,
    type: s.content_type,
    seconds: Number(s.seconds),
    bytes: Number(s.byte_count),
    // stored: kept here, sealed; sent: the provider holds it and nothing is kept here.
    status: s.status === "uploaded" ? "sent" : "stored",
    createdAt: s.created_at,
  };
}
const PROGRESS: Record<string, string> = {
  clone: "Making your Quick clone.",
  clone_unknown: "Confirming your clone with the voice provider.",
  dataset: "Preparing your Pro clone.",
  upload: "Sending your recordings to the voice provider.",
  fine_tune: "Starting training.",
  training: "Training your Pro clone. This can take up to 3 hours; you can leave this page.",
  voices: "Collecting your trained voice.",
};
function clonePublic(c: any, samples: any[]) {
  const recordings = samples.filter((s) => s.clone_id === c.id).map(samplePublic);
  return {
    id: c.id,
    kind: c.kind as CloneKind,
    status: c.status as CloneStatus,
    version: Number(c.version),
    language: c.language,
    progress: c.status === "processing" ? PROGRESS[c.step] ?? null : null,
    error: c.error ? { code: String(c.error.code ?? ""), message: String(c.error.message ?? "") } : null,
    hasPreview: c.has_preview === true,
    recordings,
    totalSeconds: Math.round(recordings.reduce((sum, r) => sum + r.seconds, 0) * 10) / 10,
    readiness:
      c.status === "draft"
        ? recordingsReady(c.kind, recordings.map((r) => ({ seconds: r.seconds, bytes: r.bytes })))
        : null,
    createdAt: c.created_at,
    submittedAt: c.submitted_at,
    readyAt: c.ready_at,
    activatedAt: c.activated_at,
  };
}
async function ownClone(tx: Tx, a: Actor, cloneId: string, lock = true) {
  const [clone] = await tx.query(
    `SELECT ${CLONE_COLUMNS} FROM trainer_voice_clones WHERE id=$1 AND user_id=$2 AND status<>'deleted'${lock ? " FOR UPDATE" : ""}`,
    [id.parse(cloneId), a.userId],
  );
  if (!clone) throw fail(404, "VOICE_CLONE_NOT_FOUND", "This voice clone is not available.");
  return clone;
}
async function cloneView(tx: Tx, clone: any) {
  const samples = await tx.query(
    "SELECT id,clone_id,content_type,byte_count,seconds,status,created_at FROM trainer_voice_samples WHERE clone_id=$1 ORDER BY created_at",
    [clone.id],
  );
  return clonePublic(clone, samples);
}
function decodeBase64(value: string, maxBytes: number) {
  const tooLarge = `Use a recording under ${Math.round(maxBytes / 1048576)} MB.`;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length > Math.ceil(maxBytes / 3) * 4)
    throw fail(400, "VOICE_SAMPLE", tooLarge);
  const bytes = Buffer.from(value, "base64");
  if (!bytes.length || bytes.length > maxBytes)
    throw fail(400, "VOICE_SAMPLE", tooLarge);
  return bytes;
}
async function budgetAllows(tx: Tx, contract: VoiceContract, costUsd: number) {
  const [spent] = await tx.query("SELECT voice_guidance_spent_today() AS total");
  return Number(spent.total) + costUsd <= contract.cap;
}

export function registerVoiceClones(app: FastifyInstance, db: Database) {
  app.get("/api/v1/voice/clones", async (req) => {
    const a = owner(req);
    const contract = contractOrNull();
    const cartesia = contract?.provider === "cartesia";
    return db.tenant(a, async (tx) => {
      const clones = await tx.query(
        `SELECT ${CLONE_COLUMNS} FROM trainer_voice_clones WHERE user_id=$1 AND status<>'deleted' ORDER BY created_at DESC`,
        [a.userId],
      );
      const samples = clones.length
        ? await tx.query(
            "SELECT id,clone_id,content_type,byte_count,seconds,status,created_at FROM trainer_voice_samples WHERE clone_id=ANY($1::uuid[]) ORDER BY created_at",
            [clones.map((c) => c.id)],
          )
        : [];
      const [voice] = await tx.query(
        "SELECT id,status,provider,clone_id,version FROM trainer_voices",
      );
      const proUsed =
        cartesia && contract.cloning.pro
          ? Number((await tx.query("SELECT voice_pro_clones_in_use() AS n"))[0].n)
          : 0;
      return {
        provider: contract?.provider ?? null,
        available: {
          quick: !!(cartesia && contract.cloning.quick),
          pro: !!(cartesia && contract.cloning.pro),
          proSlotsLeft: cartesia && contract.cloning.pro ? Math.max(0, contract.cloning.proSlots - proUsed) : 0,
        },
        encryption: encryptionReady(),
        proPriceAed: cartesia ? contract.cloning.proPriceAed : null,
        reviewRequired: cartesia ? contract.cloning.reviewRequired : false,
        providerTrainingOptOut: cartesia ? contract.cloning.providerTrainingOptOut : false,
        consent: {
          version: CLONE_CONSENT_VERSION,
          statements: CLONE_CONSENT,
          granted: await latestVoiceConsent(tx, a.userId),
        },
        limits: CLONE_LIMITS,
        sampleTypes: SAMPLE_TYPES,
        languages: CARTESIA_CLONE_LANGUAGES.map((code) => ({
          code,
          name: CLONE_LANGUAGE_NAMES[code] ?? code,
        })),
        previewLine: PREVIEW_LINE,
        workspaceVoice: voice
          ? {
              status: voice.status,
              provider: voice.provider,
              cloneId: voice.clone_id,
              version: Number(voice.version),
            }
          : null,
        clones: clones.map((c) => clonePublic(c, samples)),
      };
    });
  });

  app.post("/api/v1/voice/clones", async (req) => {
    const a = owner(req),
      b = z
        .object({
          kind: z.enum(["instant", "pro"]),
          language: z.enum(CARTESIA_CLONE_LANGUAGES),
          consent: z
            .object({
              ownVoice: z.literal(true),
              cloning: z.literal(true),
              subscriberUse: z.literal(true),
              deletion: z.literal(true),
            })
            .strict(),
          proAcknowledged: z.boolean().default(false),
        })
        .strict()
        .parse(req.body);
    const contract = cartesiaContract();
    if (!(b.kind === "pro" ? contract.cloning.pro : contract.cloning.quick))
      throw fail(
        409,
        "VOICE_CLONE_KIND_OFF",
        b.kind === "pro"
          ? "Pro clones are not offered on this platform yet."
          : "Quick clones are switched off on this platform.",
      );
    if (b.kind === "pro" && !b.proAcknowledged)
      throw fail(
        400,
        "VOICE_PRO_ACKNOWLEDGEMENT",
        "Confirm that a Pro clone needs at least 30 minutes of recordings and takes up to 3 hours.",
      );
    if (!encryptionReady())
      throw fail(503, "ENCRYPTION_REQUIRED", "The server encryption key is not configured.");
    const consentVersion =
      (await legalAcceptanceVersion(db, "voice")) + "|" + CLONE_CONSENT_VERSION;
    return db.tenant(a, async (tx) => {
      await lockVoice(tx, a);
      const [count] = await tx.query(
        "SELECT count(*)::int AS n FROM trainer_voice_clones WHERE status NOT IN ('deleted','failed')",
      );
      if (count.n >= CLONE_LIMITS.maxClones)
        throw fail(409, "VOICE_CLONE_LIMIT", "Delete a voice you no longer use before making another.");
      const [open] = await tx.query(
        "SELECT id FROM trainer_voice_clones WHERE kind=$1 AND status IN ('draft','processing')",
        [b.kind],
      );
      if (open)
        throw fail(409, "VOICE_CLONE_IN_PROGRESS", "Finish or delete the clone you already started.");
      if (b.kind === "pro") {
        const [slots] = await tx.query("SELECT voice_pro_clones_in_use() AS n");
        if (Number(slots.n) >= contract.cloning.proSlots)
          throw fail(409, "VOICE_PRO_SLOTS", "No Pro clone places are free on this platform right now. A Quick clone is available.");
      }
      // A failed clone of this kind is replaced by the new one.
      for (const old of await tx.query(
        `SELECT ${CLONE_COLUMNS} FROM trainer_voice_clones WHERE user_id=$1 AND kind=$2 AND status='failed' FOR UPDATE`,
        [a.userId, b.kind],
      ))
        await retireClone(tx, old, "replaced");
      await tx.query(
        "INSERT INTO consent_records(id,tenant_id,user_id,document_type,document_version,granted) VALUES($1,$2,$3,'voice',$4,true)",
        [randomUUID(), a.tenantId, a.userId, consentVersion],
      );
      const cloneId = randomUUID();
      const [clone] = await tx.query(
        `INSERT INTO trainer_voice_clones(id,tenant_id,user_id,provider,kind,status,language,provider_name,consent_version,evidence) VALUES($1,$2,$3,'cartesia',$4,'draft',$5,$6,$7,$8) RETURNING ${CLONE_COLUMNS}`,
        [
          cloneId,
          a.tenantId,
          a.userId,
          b.kind,
          b.language,
          "trainsyou-" + cloneId,
          consentVersion,
          JSON.stringify({
            consent: CLONE_CONSENT,
            consentVersion: CLONE_CONSENT_VERSION,
            confirmedAt: new Date().toISOString(),
            providerTrainingOptOut: contract.cloning.providerTrainingOptOut,
            ...(b.kind === "pro"
              ? { proAcknowledged: true, proPriceAedShown: contract.cloning.proPriceAed }
              : {}),
          }),
        ],
      );
      await event(tx, a, "voice.clone_started", cloneId, { kind: b.kind, language: b.language });
      return cloneView(tx, clone);
    });
  });

  app.post(
    "/api/v1/voice/clones/:id/samples",
    // 7 MB of audio in base64, under the web proxy's 10 MB body buffer.
    { bodyLimit: 10_000_000, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req) => {
      const a = owner(req),
        b = z
          .object({
            audio: z.string().min(16).max(9_800_000),
            type: z.enum(SAMPLE_TYPES),
            durationSeconds: z.number().positive().max(3600),
          })
          .strict()
          .parse(req.body);
      if (!encryptionReady())
        throw fail(503, "ENCRYPTION_REQUIRED", "The server encryption key is not configured.");
      const audio = decodeBase64(b.audio, CLONE_LIMITS.pro.maxBytes);
      try {
        return await db.tenant(a, async (tx) => {
          await lockVoice(tx, a);
          const clone = await ownClone(tx, a, (req.params as any).id);
          if (clone.status !== "draft")
            throw fail(409, "VOICE_CLONE_SUBMITTED", "Recordings can be added only before the clone is made.");
          let seconds: number;
          try {
            seconds = checkSample(clone.kind, audio, b.type as SampleType, b.durationSeconds);
          } catch (error) {
            if (error instanceof SampleError) throw fail(400, "VOICE_SAMPLE", error.message);
            throw error;
          }
          if (clone.kind === "instant")
            await tx.query("DELETE FROM trainer_voice_samples WHERE clone_id=$1", [clone.id]);
          else {
            const existing = await tx.query(
              "SELECT seconds,byte_count FROM trainer_voice_samples WHERE clone_id=$1",
              [clone.id],
            );
            const problem = proRecordingFits(
              existing.map((s) => ({ seconds: Number(s.seconds), bytes: Number(s.byte_count) })),
              { seconds, bytes: audio.length },
            );
            if (problem) throw fail(400, "VOICE_SAMPLE", problem);
          }
          const digest = hash(audio);
          const [duplicate] = await tx.query(
            "SELECT id FROM trainer_voice_samples WHERE clone_id=$1 AND sha256=$2",
            [clone.id, digest],
          );
          if (duplicate) throw fail(409, "VOICE_SAMPLE_DUPLICATE", "This recording is already added.");
          const sampleId = randomUUID();
          await tx.query(
            "INSERT INTO trainer_voice_samples(id,tenant_id,clone_id,user_id,content_type,byte_count,seconds,sha256,sealed,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'stored')",
            [
              sampleId,
              a.tenantId,
              clone.id,
              a.userId,
              b.type,
              audio.length,
              seconds,
              digest,
              sealBytes(sealContexts.voiceSample(a.tenantId, sampleId), audio),
            ],
          );
          const [updated] = await tx.query(
            `UPDATE trainer_voice_clones SET version=version+1,updated_at=now() WHERE id=$1 RETURNING ${CLONE_COLUMNS}`,
            [clone.id],
          );
          return cloneView(tx, updated);
        });
      } finally {
        audio.fill(0);
      }
    },
  );

  app.delete("/api/v1/voice/clones/:id/samples/:sampleId", async (req) => {
    const a = owner(req);
    return db.tenant(a, async (tx) => {
      await lockVoice(tx, a);
      const clone = await ownClone(tx, a, (req.params as any).id);
      if (clone.status !== "draft")
        throw fail(409, "VOICE_CLONE_SUBMITTED", "Recordings can be removed only before the clone is made.");
      const [removed] = await tx.query(
        "DELETE FROM trainer_voice_samples WHERE id=$1 AND clone_id=$2 RETURNING id",
        [id.parse((req.params as any).sampleId), clone.id],
      );
      if (!removed) throw fail(404, "VOICE_SAMPLE_NOT_FOUND", "This recording is not available.");
      const [updated] = await tx.query(
        `UPDATE trainer_voice_clones SET version=version+1,updated_at=now() WHERE id=$1 RETURNING ${CLONE_COLUMNS}`,
        [clone.id],
      );
      return cloneView(tx, updated);
    });
  });

  /** Sends the recordings: draft (or failed, to try again) -> processing. */
  const submit = async (req: FastifyRequest, retry: boolean) => {
    const a = owner(req),
      b = z.object({ revision: z.number().int().positive() }).strict().parse(req.body);
    const contract = cartesiaContract();
    const cloneId = await db.tenant(a, async (tx) => {
      await lockVoice(tx, a);
      const clone = await ownClone(tx, a, (req.params as any).id);
      if (Number(clone.version) !== b.revision) throw conflict();
      if (clone.status !== (retry ? "failed" : "draft"))
        throw fail(409, "VOICE_CLONE_STATE", retry ? "Only a failed clone can be tried again." : "This clone was already sent.");
      assertTransition(clone.status, "processing");
      if (!(clone.kind === "pro" ? contract.cloning.pro : contract.cloning.quick))
        throw fail(409, "VOICE_CLONE_KIND_OFF", "This kind of clone is switched off on this platform.");
      if (!(await trainerCurrent(tx, a.userId)))
        throw fail(409, "VOICE_CONSENT", "Confirm your voice consent again before making a clone.");
      const samples = await tx.query(
        "SELECT seconds,byte_count,status FROM trainer_voice_samples WHERE clone_id=$1",
        [clone.id],
      );
      const job = { ...(clone.provider_job ?? {}) };
      let step: string;
      if (clone.kind === "instant") {
        const stored = samples.filter((s) => s.status !== "uploaded");
        const check = recordingsReady("instant", stored.map((s) => ({ seconds: Number(s.seconds), bytes: Number(s.byte_count) })));
        if (!check.ready) throw fail(409, "VOICE_RECORDINGS", retry ? "The recording is no longer stored. Record again." : check.message!);
        step = "clone";
      } else {
        const check = recordingsReady("pro", samples.map((s) => ({ seconds: Number(s.seconds), bytes: Number(s.byte_count) })));
        if (!check.ready) throw fail(409, "VOICE_RECORDINGS", check.message!);
        if (retry && job.fineTuneId) await queueDeletion(tx, a.tenantId, "fine_tune", job.fineTuneId, "retry");
        step = job.datasetId ? "upload" : "dataset";
        delete job.fineTuneId;
        delete job.fineTuneSent;
        if (!retry) {
          const [slots] = await tx.query("SELECT voice_pro_clones_in_use() AS n");
          if (Number(slots.n) >= contract.cloning.proSlots)
            throw fail(409, "VOICE_PRO_SLOTS", "No Pro clone places are free on this platform right now.");
        }
      }
      if (!(await budgetAllows(tx, contract, contract.cloning.cloneUsd)))
        throw fail(429, "VOICE_BUDGET", "Today's voice limit for this workspace is reached. Try again tomorrow.");
      await tx.query(
        "UPDATE trainer_voice_clones SET status='processing',step=$2,provider_job=$3,error=NULL,next_attempt_at=NULL,submitted_at=coalesce(submitted_at,now()),version=version+1,updated_at=now() WHERE id=$1",
        [clone.id, step, JSON.stringify(clone.kind === "instant" ? { ...(job.sent ? { sent: true } : {}) } : job)],
      );
      await event(tx, a, retry ? "voice.clone_retried" : "voice.clone_submitted", clone.id, { kind: clone.kind });
      return clone.id as string;
    });
    // A Quick clone is made while the trainer waits; a Pro clone continues in the worker.
    await advanceVoiceClone(db, a, cloneId, { maxSteps: 4 }).catch(() => null);
    return db.tenant(a, async (tx) => cloneView(tx, await ownClone(tx, a, cloneId, false)));
  };
  app.post("/api/v1/voice/clones/:id/submit", async (req) => submit(req, false));
  app.post("/api/v1/voice/clones/:id/retry", async (req) => submit(req, true));

  app.post(
    "/api/v1/voice/clones/:id/preview",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req) => {
      const a = owner(req);
      const contract = cartesiaContract();
      const reservation = await db.tenant(a, async (tx) => {
        await lockVoice(tx, a);
        const clone = await ownClone(tx, a, (req.params as any).id);
        if (!["ready", "active"].includes(clone.status))
          throw fail(409, "VOICE_CLONE_STATE", "This voice is not ready yet.");
        if (clone.has_preview) return { clone, usageId: null };
        if (!(await trainerCurrent(tx, a.userId)))
          throw fail(409, "VOICE_CONSENT", "Confirm your voice consent again before previewing.");
        const usageId = await reserveCost(tx, a, a.userId, "voice.preview", contract, clone.model ?? contract.model, {
          basis: "characters",
          characters: PREVIEW_LINE.length,
          usdPer1000Characters: contract.price,
          reservedCostUsd: (PREVIEW_LINE.length * contract.price) / 1000,
        }, clone.id);
        if (!usageId)
          throw fail(429, "VOICE_BUDGET", "Today's voice limit for this workspace is reached. Try again tomorrow.");
        return { clone, usageId };
      });
      const clone = reservation.clone;
      if (reservation.usageId) {
        const usageId = reservation.usageId;
        try {
          const audio = await generateTrainerVoice(
            clone.provider_voice_id,
            PREVIEW_LINE,
            () =>
              db.tenant(a, async (tx) => {
                const [still] = await tx.query(
                  "SELECT id FROM trainer_voice_clones WHERE id=$1 AND status IN ('ready','active') AND provider_voice_id=$2",
                  [clone.id, clone.provider_voice_id],
                );
                if (!still) throw fail(409, "VOICE_CLONE_CHANGED", "This voice changed.");
                await costUnknown(tx, usageId);
              }),
            { provider: clone.provider, model: clone.model, language: clone.language },
          );
          await db.tenant(a, async (tx) => {
            await tx.query(
              "UPDATE trainer_voice_clones SET preview_audio=$2,previewed_at=now(),updated_at=now() WHERE id=$1 AND status IN ('ready','active')",
              [clone.id, audio.audio],
            );
            await event(tx, a, "voice.clone_previewed", clone.id, {
              estimatedCostUsd: audio.estimatedCost,
              providerRequestId: audio.requestId,
            });
          });
        } catch (error) {
          await db.tenant(a, (tx) => costUnknown(tx, usageId));
          if ((error as any)?.code === "VOICE_CLONE_CHANGED") throw conflict();
          throw fail(502, "VOICE_PREVIEW", "The preview could not be made. Try again in a minute.");
        }
      }
      return db.tenant(a, async (tx) => ({
        ...(await cloneView(tx, await ownClone(tx, a, clone.id, false))),
        previewUrl: `/api/v1/voice/clones/${clone.id}/preview`,
        previewLine: PREVIEW_LINE,
      }));
    },
  );
  app.get("/api/v1/voice/clones/:id/preview", async (req, reply) => {
    const a = owner(req);
    const audio = await db.tenant(a, async (tx) => {
      const [r] = await tx.query(
        "SELECT preview_audio FROM trainer_voice_clones WHERE id=$1 AND user_id=$2 AND status IN ('ready','active')",
        [id.parse((req.params as any).id), a.userId],
      );
      if (!r?.preview_audio)
        throw fail(404, "VOICE_PREVIEW", "Make a preview first.");
      return Buffer.from(r.preview_audio);
    });
    reply.header("Cache-Control", "private,no-store").type("audio/mpeg");
    return audio;
  });

  app.post("/api/v1/voice/clones/:id/activate", async (req) => {
    const a = owner(req),
      b = z.object({ revision: z.number().int().positive() }).strict().parse(req.body);
    const contract = cartesiaContract();
    return db.tenant(a, async (tx) => {
      await lockVoice(tx, a);
      const clone = await ownClone(tx, a, (req.params as any).id);
      if (Number(clone.version) !== b.revision) throw conflict();
      if (clone.status !== "ready")
        throw fail(409, "VOICE_CLONE_STATE", clone.status === "active" ? "This voice is already in use." : "This voice is not ready yet.");
      assertTransition("ready", "active");
      if (!clone.has_preview)
        throw fail(409, "VOICE_PREVIEW_REQUIRED", "Listen to the preview before using this voice.");
      if (!(await trainerCurrent(tx, a.userId)))
        throw fail(409, "VOICE_CONSENT", "Confirm your voice consent again before using this voice.");
      if (clone.provider !== contract.provider) throw fail(409, "VOICE_CLONE_UNAVAILABLE", "This voice belongs to another voice provider.");
      await tx.query(
        "UPDATE trainer_voice_clones SET status='ready',version=version+1,updated_at=now() WHERE status='active' AND id<>$1",
        [clone.id],
      );
      await tx.query(
        "UPDATE trainer_voice_clones SET status='active',activated_at=now(),version=version+1,updated_at=now() WHERE id=$1",
        [clone.id],
      );
      const review = contract.cloning.reviewRequired;
      const [prior] = await tx.query("SELECT id FROM trainer_voices FOR UPDATE");
      const [voice] = await tx.query(
        "INSERT INTO trainer_voices(id,tenant_id,user_id,status,provider,provider_voice_id,clone_id,model,language,evidence,consent_version,verified_at) VALUES($1,$2,$3,$4,'cartesia',$5,$6,$7,$8,$9,$10,CASE WHEN $4='verified' THEN now() END) ON CONFLICT(tenant_id) DO UPDATE SET user_id=EXCLUDED.user_id,status=EXCLUDED.status,provider=EXCLUDED.provider,provider_voice_id=EXCLUDED.provider_voice_id,clone_id=EXCLUDED.clone_id,model=EXCLUDED.model,language=EXCLUDED.language,evidence=EXCLUDED.evidence,consent_version=EXCLUDED.consent_version,sample=NULL,sample_type=NULL,verified_by=NULL,verified_at=EXCLUDED.verified_at,version=trainer_voices.version+1,updated_at=now() RETURNING id,status,version",
        [
          prior?.id ?? randomUUID(),
          a.tenantId,
          a.userId,
          review ? "pending" : "verified",
          clone.provider_voice_id,
          clone.id,
          clone.model,
          clone.language,
          JSON.stringify({
            origin: clone.kind === "pro" ? "cartesia_pro_clone" : "cartesia_quick_clone",
            cloneId: clone.id,
            ownerConfirmed: true,
            voiceKind: clone.kind === "pro" ? "professional" : "instant",
            rightsStatement: CLONE_CONSENT.ownVoice,
            selfActivated: !review,
            activatedAt: new Date().toISOString(),
            purpose: "Assigned workout guidance for this workspace's premium members only.",
          }),
          clone.consent_version,
        ],
      );
      // Every clip made with the previous voice version stops.
      await tx.query("UPDATE guided_audio SET status='revoked',audio=NULL WHERE voice_id=$1", [voice.id]);
      await tx.query(
        "UPDATE voice_session_clips SET status='revoked',audio=NULL,updated_at=now() WHERE voice_id=$1 AND status<>'revoked'",
        [voice.id],
      );
      await tx.query(
        "UPDATE voice_sessions SET mode='text',audio_status='revoked',unavailable_reason='VOICE_UNAVAILABLE',version=version+1,updated_at=now() WHERE voice_id=$1 AND audio_status<>'revoked'",
        [voice.id],
      );
      // A newer clone of the same kind replaces an unused older one.
      for (const old of await tx.query(
        `SELECT ${CLONE_COLUMNS} FROM trainer_voice_clones WHERE user_id=$1 AND kind=$2 AND status='ready' AND id<>$3 FOR UPDATE`,
        [a.userId, clone.kind, clone.id],
      ))
        await retireClone(tx, old, "superseded");
      await event(tx, a, "voice.clone_activated", clone.id, { kind: clone.kind, review });
      return {
        ...(await cloneView(tx, await ownClone(tx, a, clone.id, false))),
        workspaceVoice: { status: voice.status, version: Number(voice.version) },
        message: review
          ? "Your voice is waiting for the platform's identity check. Members hear it once it is approved."
          : "Your subscribers with premium voice now hear this voice.",
      };
    });
  });

  app.post("/api/v1/voice/clones/:id/deactivate", async (req) => {
    const a = owner(req),
      b = z.object({ revision: z.number().int().positive() }).strict().parse(req.body);
    return db.tenant(a, async (tx) => {
      await lockVoice(tx, a);
      const clone = await ownClone(tx, a, (req.params as any).id);
      if (Number(clone.version) !== b.revision) throw conflict();
      if (clone.status !== "active") throw fail(409, "VOICE_CLONE_STATE", "This voice is not in use.");
      assertTransition("active", "ready");
      await tx.query(
        "UPDATE trainer_voice_clones SET status='ready',version=version+1,updated_at=now() WHERE id=$1",
        [clone.id],
      );
      for (const v of await tx.query<{ id: string }>("SELECT id FROM trainer_voices WHERE clone_id=$1", [clone.id]))
        await revokeWorkspaceVoice(tx, v.id);
      await event(tx, a, "voice.clone_deactivated", clone.id);
      return cloneView(tx, await ownClone(tx, a, clone.id, false));
    });
  });

  app.delete("/api/v1/voice/clones/:id", async (req) => {
    const a = owner(req);
    await db.tenant(a, async (tx) => {
      await lockVoice(tx, a);
      const clone = await ownClone(tx, a, (req.params as any).id);
      assertTransition(clone.status, "deleted");
      await retireClone(tx, clone, "trainer_deleted");
      await event(tx, a, "voice.clone_deleted", clone.id, { reason: "trainer_deleted" });
    });
    // Best effort now; the worker retries what the provider did not confirm.
    await processVoiceProviderDeletions(db, a).catch(() => 0);
    return {
      ok: true,
      message:
        "Your voice and recordings are deleted here, and the copy at the voice provider is being deleted.",
    };
  });

  // ------------------------------------------------------------------ operators
  app.get("/api/v1/admin/integrations/voice-clones", async (req) => {
    const operator = admin(req);
    const tenantId = z.string().uuid().optional().parse((req.query as any).tenantId);
    const tenants = await db.system((tx) =>
      tx.query(
        "SELECT id,name FROM tenants WHERE ($1::uuid IS NULL OR id=$1) ORDER BY created_at DESC LIMIT 100",
        [tenantId ?? null],
      ),
    );
    const clones: any[] = [],
      deletions: any[] = [];
    for (const tenant of tenants) {
      const scope = elevated("platform-operator", {
        tenantId: tenant.id,
        userId: operator.userId,
        role: "owner",
      });
      await db.tenant(scope, async (tx) => {
        for (const c of await tx.query(
          "SELECT c.id,c.kind,c.status,c.step,c.language,c.error,c.created_at,c.submitted_at,c.ready_at,c.activated_at,c.preview_audio IS NOT NULL AS has_preview,(SELECT count(*)::int FROM trainer_voice_samples s WHERE s.clone_id=c.id AND s.status<>'uploaded') AS stored_recordings,v.status AS workspace_voice_status,v.id AS workspace_voice_id,v.version AS workspace_voice_version FROM trainer_voice_clones c LEFT JOIN trainer_voices v ON v.clone_id=c.id WHERE c.status<>'deleted' ORDER BY c.updated_at DESC LIMIT 50",
        ))
          clones.push({ ...c, tenant_id: tenant.id, tenant_name: tenant.name });
        for (const d of await tx.query(
          "SELECT id,kind,reason,status,attempts,last_error,next_attempt_at,created_at FROM voice_provider_deletions WHERE status<>'done' ORDER BY created_at LIMIT 50",
        ))
          deletions.push({ ...d, tenant_id: tenant.id, tenant_name: tenant.name });
      });
    }
    return { clones, deletions };
  });
  app.get("/api/v1/admin/integrations/voice-clones/:id/preview", async (req, reply) => {
    const operator = admin(req);
    const tenantId = z.string().uuid().parse((req.query as any).tenantId);
    const audio = await db.tenant(
      elevated("platform-operator", { tenantId, userId: operator.userId, role: "owner" }),
      async (tx) => {
        const [r] = await tx.query(
          "SELECT preview_audio FROM trainer_voice_clones WHERE id=$1 AND status IN ('ready','active')",
          [id.parse((req.params as any).id)],
        );
        if (!r?.preview_audio) throw fail(404, "VOICE_PREVIEW", "No preview is stored for this voice.");
        await event(tx, { ...operator, tenantId }, "voice.clone_preview_reviewed", (req.params as any).id);
        return Buffer.from(r.preview_audio);
      },
    );
    reply.header("Cache-Control", "private,no-store").type("audio/mpeg");
    return audio;
  });
  app.post("/api/v1/admin/integrations/voice-deletions/:id/retry", async (req) => {
    const operator = admin(req);
    const tenantId = z.object({ tenantId: z.string().uuid() }).strict().parse(req.body).tenantId;
    return db.tenant(
      elevated("platform-operator", { tenantId, userId: operator.userId, role: "owner" }),
      async (tx) => {
        const [r] = await tx.query(
          "UPDATE voice_provider_deletions SET status='pending',attempts=0,next_attempt_at=now(),updated_at=now() WHERE id=$1 AND status='attention' RETURNING id,status",
          [id.parse((req.params as any).id)],
        );
        if (!r) throw fail(409, "VOICE_DELETION_STATE", "This deletion is not waiting for attention.");
        await event(tx, { ...operator, tenantId }, "voice.provider_deletion_retried", r.id);
        return r;
      },
    );
  });
}
/** Linking an existing provider voice ID is for ElevenLabs only. */
export function voiceLinkingAllowed() {
  return runtimeConfig().VOICE_PROVIDER !== "cartesia";
}
