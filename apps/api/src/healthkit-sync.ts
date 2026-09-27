import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  event,
  putRecord,
  type Actor,
  type Database,
  type Tx,
} from "@trainer/db";
import {
  runtimeConfig,
  strictSecurity,
} from "../../../packages/providers/src/configuration.ts";
import {
  HEALTHKIT_LIMITS,
  HEALTHKIT_TYPES,
  applyHealthKitBatch,
  bucketDay,
  bucketEmpty,
  daySummary,
  deriveObservations,
  emptyBucket,
  healthKitBatchSchema,
  type DayBucket,
} from "../../../packages/domain/src/healthkit.ts";
import { clientSource, newToken, tokenHash } from "./auth.ts";
import { legalAcceptanceVersion } from "./legal.ts";
import { notifyUser } from "./notifications.ts";

/**
 * Server side of automatic Apple HealthKit sync for the future native
 * companion app. The companion routes under COMPANION_PREFIX authenticate
 * with a device bearer token only and never read the browser session, which
 * is why the browser origin check does not apply to them (see app.ts).
 * Contract: docs/HEALTHKIT_SYNC_API.md.
 */
export const COMPANION_PREFIX = "/api/v1/healthkit/device/";
export const isCompanionDevicePath = (url: string) =>
  url.split("?")[0].startsWith(COMPANION_PREFIX);
export const SYNC_POLICY = "permitted_imports_and_sync";
export const HEALTHKIT_CONSENT = "wearable:apple_health";
const ORIGIN = "apple_healthkit";

type Identity = Actor & { platformRole?: string };
type Device = {
  id: string;
  tenant_id: string;
  user_id: string;
  name: string;
  platform: string;
  app_version: string | null;
  status: string;
  revoked_reason: string | null;
  consent_version: string;
  quota_day: string | Date | null;
  quota_batches: number;
  quota_samples: number;
  batches_received: number;
  samples_received: string | number;
  last_error_code: string | null;
  last_seen_at: string | null;
  last_sync_at: string | null;
  revoked_at: string | null;
  created_at: string;
};
const fail = (
  statusCode: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
) =>
  Object.assign(new Error(message), {
    statusCode,
    code,
    // Gate and quota explanations are safe to show to the member and app.
    expose: true,
    ...extra,
  });
const uuid = z.string().uuid();
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const workerActor = (tenantId: string): Actor => ({
  tenantId,
  userId: "00000000-0000-0000-0000-000000000000",
  role: "owner",
});
/**
 * Scoped owner access for one member's own sync work: reading the coach's
 * wearable policy and writing the member's own records, like wearable sync.
 */
const memberScope = (tenantId: string, userId: string): Actor => ({
  tenantId,
  userId,
  role: "owner",
});

export type Availability = {
  available: boolean;
  code: string | null;
  message: string;
  statusCode?: number;
};
/** Platform switches, mirroring the Apple export import plus the sync switch. */
export function healthKitAvailability(config = runtimeConfig()): Availability {
  if (config.APPLE_IMPORTS_ENABLED === "false")
    return {
      available: false,
      code: "APPLE_IMPORTS_DISABLED",
      statusCode: 503,
      message:
        "Apple Health imports are disabled by the platform administrator.",
    };
  if (strictSecurity() && config.FILE_IMPORTS_APPROVED !== "true")
    return {
      available: false,
      code: "IMPORT_REVIEW_PENDING",
      statusCode: 503,
      message: "Health imports are waiting for the platform import approval.",
    };
  if (config.HEALTHKIT_SYNC_ENABLED !== "true")
    return {
      available: false,
      code: "HEALTHKIT_SYNC_DISABLED",
      statusCode: 503,
      message:
        "Automatic Apple Health sync is not enabled on this platform yet. It needs the companion iPhone app. You can still import an Apple Health export file.",
    };
  return {
    available: true,
    code: null,
    message: "Automatic Apple Health sync is available.",
  };
}
function requireAvailable() {
  const state = healthKitAvailability();
  if (!state.available)
    throw fail(state.statusCode ?? 503, state.code!, state.message);
}

/** The coach's saved wearable policy; needs a transaction that may read it. */
export async function coachWearablePolicy(tx: Tx) {
  const [row] = await tx.query(
    "SELECT status,data->'values'->>'policy' AS policy FROM records WHERE kind='onboarding_step' AND data->>'step'='wearables'",
  );
  return row?.status === "saved" ? (row.policy as string | null) : null;
}
/** Reads the policy for a member of any role in a separate scoped read. */
export function readCoachWearablePolicy(db: Database, a: Actor) {
  return db.tenant(memberScope(a.tenantId, a.userId), coachWearablePolicy);
}
function requireSyncPolicy(policy: string | null) {
  if (policy !== SYNC_POLICY)
    throw fail(
      403,
      "HEALTHKIT_POLICY",
      "Your coach has not enabled automatic Apple Health sync.",
    );
}
async function consentState(tx: Tx, userId: string) {
  const rows = await tx.query(
    "SELECT DISTINCT ON(document_type) document_type,granted FROM consent_records WHERE user_id=$1 AND document_type IN ('wearable',$2) ORDER BY document_type,created_at DESC,id DESC",
    [userId, HEALTHKIT_CONSENT],
  );
  const of = (type: string) =>
    rows.find((r) => r.document_type === type)?.granted ?? null;
  return { general: of("wearable"), apple: of(HEALTHKIT_CONSENT) };
}
async function requireConsent(tx: Tx, userId: string) {
  const c = await consentState(tx, userId);
  if (c.general === false || c.apple !== true)
    throw fail(
      403,
      "CONSENT_REQUIRED",
      "Apple Health permission was withdrawn. Pair the app again after giving permission.",
    );
}
async function actorIsCurrent(tx: Tx, tenantId: string, userId: string) {
  const [row] = await tx.query(
    "SELECT integration_actor_is_current($1,$2) AS active",
    [tenantId, userId],
  );
  return row?.active === true;
}
// Uploads run in parallel across a workspace but never across a member
// erasure or workspace closure, which hold the exclusive workspace lock.
async function lockMember(tx: Tx, tenantId: string, userId: string) {
  await tx.query("SELECT pg_advisory_xact_lock_shared(hashtext($1))", [
    tenantId + ":workspace",
  ]);
  await tx.query("SELECT pg_advisory_xact_lock_shared(hashtext($1))", [
    tenantId,
  ]);
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    tenantId + ":integrations:" + userId,
  ]);
}
/** Stops every active device of a member; the caller holds a scoped tx. */
export async function revokeHealthKitDevices(
  tx: Tx,
  userId: string,
  reason:
    "member" | "device" | "consent" | "source_revoked" | "membership_ended",
) {
  return tx.query(
    "UPDATE healthkit_devices SET status='revoked',revoked_reason=$2,revoked_at=now(),version=version+1,updated_at=now() WHERE user_id=$1 AND status='active' RETURNING id",
    [userId, reason],
  );
}
function visibleDevice(d: Device) {
  return {
    id: d.id,
    name: d.name,
    platform: d.platform,
    appVersion: d.app_version,
    status: d.status,
    revokedReason: d.revoked_reason,
    pairedAt: d.created_at,
    lastSeenAt: d.last_seen_at,
    lastSyncAt: d.last_sync_at,
    revokedAt: d.revoked_at,
    batchesReceived: Number(d.batches_received),
    samplesReceived: Number(d.samples_received),
    lastErrorCode: d.last_error_code,
  };
}
export async function exportHealthKitData(tx: Tx, userId: string) {
  return {
    devices: await tx.query(
      "SELECT id,name,platform,app_version,status,revoked_reason,consent_version,batches_received,samples_received,last_sync_at,revoked_at,created_at FROM healthkit_devices WHERE user_id=$1 ORDER BY created_at",
      [userId],
    ),
    uploadReceipts: await tx.query(
      "SELECT device_id,batch_id,result,created_at FROM healthkit_sync_batches WHERE user_id=$1 ORDER BY created_at",
      [userId],
    ),
  };
}
/** Member erasure: device registrations and receipts; records erase separately. */
export async function eraseHealthKitData(tx: Tx, userId: string) {
  await tx.query("DELETE FROM healthkit_sync_batches WHERE user_id=$1", [
    userId,
  ]);
  await tx.query("DELETE FROM healthkit_devices WHERE user_id=$1", [userId]);
}
export async function closeHealthKitData(tx: Tx) {
  await tx.query("DELETE FROM healthkit_sync_batches");
  await tx.query("DELETE FROM healthkit_devices");
}
/**
 * Hourly worker maintenance: devices of former members or withdrawn consent
 * are revoked, old receipts and spent pairing codes are removed.
 */
export async function maintainHealthKitSync(db: Database) {
  const tenants = await db.system((tx) =>
    tx.query("SELECT id FROM tenants ORDER BY id"),
  );
  let revoked = 0;
  for (const tenant of tenants)
    revoked += await db.tenant(workerActor(tenant.id), async (tx) => {
      const ended = await tx.query(
        "UPDATE healthkit_devices d SET status='revoked',revoked_reason='membership_ended',revoked_at=now(),version=version+1,updated_at=now() WHERE d.status='active' AND NOT EXISTS(SELECT 1 FROM memberships m WHERE m.tenant_id=d.tenant_id AND m.user_id=d.user_id) RETURNING id",
      );
      const withdrawn = await tx.query(
        "UPDATE healthkit_devices d SET status='revoked',revoked_reason='consent',revoked_at=now(),version=version+1,updated_at=now() WHERE d.status='active' AND ((SELECT c.granted FROM consent_records c WHERE c.user_id=d.user_id AND c.document_type=$1 ORDER BY c.created_at DESC,c.id DESC LIMIT 1) IS DISTINCT FROM true OR (SELECT c.granted FROM consent_records c WHERE c.user_id=d.user_id AND c.document_type='wearable' ORDER BY c.created_at DESC,c.id DESC LIMIT 1)=false) RETURNING id",
        [HEALTHKIT_CONSENT],
      );
      await tx.query(
        "DELETE FROM healthkit_sync_batches WHERE created_at<now()-interval '30 days'",
      );
      return ended.length + withdrawn.length;
    });
  await db.system((tx) =>
    tx.query(
      "DELETE FROM one_time_tokens WHERE purpose='healthkit_pair' AND coalesce(consumed_at,expires_at)<now()-interval '1 day'",
    ),
  );
  return { revoked };
}

// Pairing codes: 12 Crockford base32 characters (60 bits), one use, 10 minutes.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function pairingCode() {
  return [...randomBytes(12)].map((b) => ALPHABET[b % 32]).join("");
}
export function normalizePairingCode(value: string) {
  const code = value
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  return /^[0-9A-HJKMNP-TV-Z]{12}$/.test(code) ? code : null;
}
const codeHash = (code: string) => tokenHash("healthkit-pair:" + code);
const formatCode = (code: string) => code.match(/.{4}/g)!.join("-");
const TOKEN =
  /^hk1\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.[A-Za-z0-9_-]{43}$/;
function bearer(req: FastifyRequest) {
  const header = req.headers.authorization;
  if (typeof header !== "string") return null;
  return /^Bearer ([^\s]+)$/.exec(header)?.[1] ?? null;
}
/** Route budgets for the companion app, with a stable error code. */
const deviceBudget = (max: number, timeWindow: string, perDevice = true) => ({
  max,
  timeWindow,
  ...(perDevice
    ? { keyGenerator: (req: FastifyRequest) => deviceRateKey(req) }
    : {}),
  errorResponseBuilder: (
    _req: unknown,
    context: { after: string; statusCode: number },
  ) =>
    fail(
      context.statusCode,
      "RATE_LIMITED",
      `Too many requests from this device. Retry in ${context.after}.`,
    ),
});
const deviceRateKey = (req: FastifyRequest) => {
  const token = bearer(req);
  return token && TOKEN.test(token)
    ? "healthkit-device:" + tokenHash(token)
    : "healthkit-ip:" + clientSource(req);
};
/** Failed device authentications per client address, in memory like the route limiter. */
function failureBudget(max = 20, windowMs = 10 * 60 * 1000) {
  const entries = new Map<string, { count: number; resetAt: number }>();
  return {
    check(source: string) {
      const now = Date.now(),
        entry = entries.get(source);
      if (entry && entry.resetAt > now && entry.count >= max)
        throw fail(
          429,
          "TOO_MANY_ATTEMPTS",
          "Too many invalid device credentials. Wait a few minutes, then try again.",
        );
    },
    record(source: string) {
      const now = Date.now();
      let entry = entries.get(source);
      if (!entry || entry.resetAt <= now) {
        entries.delete(source);
        if (entries.size >= 10000)
          for (const [key, old] of entries)
            if (old.resetAt <= now || entries.size >= 10000)
              entries.delete(key);
            else break;
        entry = { count: 0, resetAt: now + windowMs };
        entries.set(source, entry);
      }
      entry.count++;
    },
  };
}
function limitsView() {
  return {
    batchSamples: HEALTHKIT_LIMITS.batchSamples,
    deletedSampleIds: HEALTHKIT_LIMITS.deletedSampleIds,
    perType: HEALTHKIT_LIMITS.perType,
    perDay: HEALTHKIT_LIMITS.perDay,
    lookbackDays: HEALTHKIT_LIMITS.lookbackDays,
    futureToleranceMinutes: HEALTHKIT_LIMITS.futureToleranceMinutes,
    dailyBatches: HEALTHKIT_LIMITS.dailyBatches,
    dailySamples: HEALTHKIT_LIMITS.dailySamples,
    bodyBytes: HEALTHKIT_LIMITS.bodyBytes,
    devicesPerMember: HEALTHKIT_LIMITS.devicesPerMember,
  };
}
const endpoints = {
  status: COMPANION_PREFIX + "status",
  samples: COMPANION_PREFIX + "samples",
  unpair: COMPANION_PREFIX + "unpair",
};
function serverOrigin(req: FastifyRequest) {
  return (
    req.hostContext?.origin ??
    runtimeConfig().PUBLIC_APP_URL ??
    "http://localhost:3000"
  );
}
type DayRow = { id: string; version: number; data: Record<string, any> };
function bucketOf(row: DayRow): DayBucket {
  return {
    day: row.data.day,
    samples: row.data.samples ?? {},
    statistics: row.data.statistics ?? {},
    deviceIds: row.data.deviceIds ?? [],
  };
}
function dayData(bucket: DayBucket, consentVersion: string, now: Date) {
  const observations = deriveObservations(bucket, now);
  return {
    source: "apple_health",
    origin: ORIGIN,
    providerKey: "healthkit:day:" + bucket.day,
    day: bucket.day,
    samples: bucket.samples,
    statistics: bucket.statistics,
    deviceIds: bucket.deviceIds,
    observations,
    count: observations.length,
    consentVersion,
    allowedUses: ["render", "deterministic_feature"],
    restrictions: ["no_model_prompt", "no_marketing"],
    lastSyncedAt: now.toISOString(),
  };
}

export function registerHealthKitSync(app: FastifyInstance, db: Database) {
  const failures = failureBudget();
  const member = (req: FastifyRequest): Identity => {
    if (!req.identity) throw fail(401, "AUTH_REQUIRED", "Please sign in.");
    return req.identity;
  };
  async function devicesOf(tx: Tx, userId: string) {
    return (
      (await tx.query(
        "SELECT * FROM healthkit_devices WHERE user_id=$1 ORDER BY status,created_at DESC LIMIT 50",
        [userId],
      )) as Device[]
    ).map(visibleDevice);
  }
  async function pendingCode(a: Actor) {
    const [row] = await db.system((tx) =>
      tx.query(
        "SELECT expires_at FROM one_time_tokens WHERE purpose='healthkit_pair' AND tenant_id=$1 AND user_id=$2 AND consumed_at IS NULL AND expires_at>now() ORDER BY expires_at DESC LIMIT 1",
        [a.tenantId, a.userId],
      ),
    );
    return row?.expires_at ?? null;
  }

  // ---- Member (browser session) routes --------------------------------------
  app.get("/api/v1/healthkit/status", async (req) => {
    const a = member(req);
    const availability = healthKitAvailability();
    const policy = await readCoachWearablePolicy(db, a);
    const state = await db.tenant(a, async (tx) => {
      const consent = await consentState(tx, a.userId);
      const [synced] = await tx.query(
        "SELECT count(*)::int AS days,coalesce(sum(coalesce((data->>'count')::int,0)),0)::int AS observations,max(updated_at) AS last_sync_at FROM records WHERE kind='wearable' AND owner_user_id=$1 AND status='imported' AND data->>'origin'=$2",
        [a.userId, ORIGIN],
      );
      return { consent, devices: await devicesOf(tx, a.userId), synced };
    });
    return {
      available: availability.available,
      code: availability.code,
      message: availability.message,
      coachAllowsSync: policy === SYNC_POLICY,
      consent: state.consent.apple === true && state.consent.general !== false,
      wearablePermissionWithdrawn: state.consent.general === false,
      devices: state.devices,
      synced: state.synced,
      pendingCodeExpiresAt: await pendingCode(a),
      server: serverOrigin(req),
      limits: limitsView(),
      acceptedTypes: HEALTHKIT_TYPES,
    };
  });
  app.get("/api/v1/healthkit/devices", async (req) => {
    const a = member(req);
    return db.tenant(a, async (tx) => ({
      devices: await devicesOf(tx, a.userId),
    }));
  });
  app.post(
    "/api/v1/healthkit/pairing-codes",
    { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } },
    async (req) => {
      const a = member(req);
      z.object({ consent: z.literal(true) })
        .strict()
        .parse(req.body);
      requireAvailable();
      requireSyncPolicy(await readCoachWearablePolicy(db, a));
      const consentVersion =
        (await legalAcceptanceVersion(db, "wearable")) +
        "|integration-consent:v1|healthkit-sync:v1";
      await db.tenant(a, async (tx) => {
        await lockMember(tx, a.tenantId, a.userId);
        if (!(await actorIsCurrent(tx, a.tenantId, a.userId)))
          throw fail(
            403,
            "WORKSPACE_CLOSED",
            "This workspace or membership is no longer active.",
          );
        const consent = await consentState(tx, a.userId);
        if (consent.general === false)
          throw fail(
            409,
            "WEARABLE_PERMISSION_WITHDRAWN",
            "You withdrew wearable permission in Privacy settings. Grant it there again before connecting Apple Health.",
          );
        const [{ n }] = await tx.query(
          "SELECT count(*)::int AS n FROM healthkit_devices WHERE user_id=$1 AND status='active'",
          [a.userId],
        );
        if (n >= HEALTHKIT_LIMITS.devicesPerMember)
          throw fail(
            409,
            "DEVICE_LIMIT",
            `You can connect up to ${HEALTHKIT_LIMITS.devicesPerMember} devices. Disconnect one first.`,
          );
        await tx.query(
          "INSERT INTO consent_records(id,tenant_id,user_id,document_type,document_version,granted) VALUES($1,$2,$3,$4,$5,true)",
          [
            randomUUID(),
            a.tenantId,
            a.userId,
            HEALTHKIT_CONSENT,
            consentVersion,
          ],
        );
        await event(tx, a, "healthkit.pairing_code_created", undefined, {
          expiresInMinutes: HEALTHKIT_LIMITS.pairingCodeMinutes,
        });
      });
      const code = pairingCode();
      const [created] = await db.system(async (tx) => {
        await tx.query(
          "UPDATE one_time_tokens SET consumed_at=now() WHERE purpose='healthkit_pair' AND tenant_id=$1 AND user_id=$2 AND consumed_at IS NULL",
          [a.tenantId, a.userId],
        );
        return tx.query(
          "INSERT INTO one_time_tokens(token_hash,purpose,user_id,tenant_id,payload,expires_at) VALUES($1,'healthkit_pair',$2,$3,$4,now()+make_interval(mins=>$5)) RETURNING expires_at",
          [
            codeHash(code),
            a.userId,
            a.tenantId,
            JSON.stringify({ consentVersion }),
            HEALTHKIT_LIMITS.pairingCodeMinutes,
          ],
        );
      });
      return {
        code: formatCode(code),
        expiresAt: created.expires_at,
        server: serverOrigin(req),
      };
    },
  );
  app.post("/api/v1/healthkit/pairing-codes/cancel", async (req) => {
    const a = member(req);
    const cancelled = await db.system((tx) =>
      tx.query(
        "UPDATE one_time_tokens SET consumed_at=now() WHERE purpose='healthkit_pair' AND tenant_id=$1 AND user_id=$2 AND consumed_at IS NULL RETURNING token_hash",
        [a.tenantId, a.userId],
      ),
    );
    return { ok: true, cancelled: cancelled.length };
  });
  app.post("/api/v1/healthkit/devices/:id/revoke", async (req) => {
    const a = member(req),
      deviceId = uuid.parse((req.params as any).id);
    return db.tenant(a, async (tx) => {
      await lockMember(tx, a.tenantId, a.userId);
      const [device] = await tx.query(
        "SELECT id,status FROM healthkit_devices WHERE id=$1 AND user_id=$2 FOR UPDATE",
        [deviceId, a.userId],
      );
      if (!device) throw fail(404, "NOT_FOUND", "Device unavailable.");
      if (device.status === "revoked")
        return { ok: true, alreadyRevoked: true };
      await tx.query(
        "UPDATE healthkit_devices SET status='revoked',revoked_reason='member',revoked_at=now(),version=version+1,updated_at=now() WHERE id=$1",
        [deviceId],
      );
      await event(tx, a, "healthkit.device_revoked", deviceId, {
        reason: "member",
      });
      return {
        ok: true,
        message:
          "This device can no longer send Apple Health data. Data already synced stays until you revoke its use or delete it.",
      };
    });
  });
  app.post("/api/v1/healthkit/data/delete", async (req) => {
    const a = member(req);
    z.object({ confirm: z.literal(true) })
      .strict()
      .parse(req.body);
    return db.tenant(a, async (tx) => {
      await lockMember(tx, a.tenantId, a.userId);
      const removed = await tx.query(
        "DELETE FROM records WHERE kind='wearable' AND owner_user_id=$1 AND data->>'origin'=$2 RETURNING id",
        [a.userId, ORIGIN],
      );
      await event(tx, a, "healthkit.data_deleted", undefined, {
        days: removed.length,
      });
      return { ok: true, deletedDays: removed.length };
    });
  });
  app.get("/api/v1/healthkit/activity", async (req) => {
    const a = member(req);
    const q = z
      .object({
        userId: uuid.optional(),
        days: z.coerce.number().int().min(1).max(90).default(14),
      })
      .strict()
      .parse(req.query ?? {});
    const subject = q.userId ?? a.userId;
    if (
      a.role === "subscriber"
        ? subject !== a.userId
        : !["owner", "staff"].includes(a.role)
    )
      throw fail(403, "ACTIVITY_ACCESS", "Activity access denied.");
    return db.tenant(a, async (tx) => {
      if (subject !== a.userId) {
        const [membership] = await tx.query(
          "SELECT user_id FROM memberships WHERE tenant_id=$1 AND user_id=$2 AND role='subscriber'",
          [a.tenantId, subject],
        );
        if (!membership) throw fail(404, "NOT_FOUND", "Member unavailable.");
      }
      const consent = await consentState(tx, subject);
      if (consent.general === false)
        return { permission: "denied", days: [], lastSyncAt: null };
      const since = new Date(Date.now() - q.days * 86400000)
        .toISOString()
        .slice(0, 10);
      const rows = await tx.query(
        "SELECT data->>'day' AS day,data->'observations' AS observations,updated_at FROM records WHERE kind='wearable' AND owner_user_id=$1 AND status='imported' AND data->>'origin'=$2 AND data->>'day'>=$3 AND data->'allowedUses' ? 'deterministic_feature' ORDER BY data->>'day' DESC LIMIT 90",
        [subject, ORIGIN, since],
      );
      return {
        permission: "granted",
        days: rows.map((r) => daySummary(r.day, r.observations ?? [])),
        lastSyncAt: rows.reduce<string | null>(
          (latest, r) =>
            !latest || new Date(r.updated_at) > new Date(latest)
              ? new Date(r.updated_at).toISOString()
              : latest,
          null,
        ),
        notice:
          "Descriptive records from Apple Health, not medical advice. Totals appear once each day has ended.",
      };
    });
  });

  // ---- Companion app routes (device bearer token, no cookies) ---------------
  async function authenticate(req: FastifyRequest) {
    const source = clientSource(req);
    failures.check(source);
    const token = bearer(req);
    if (!token)
      throw fail(
        401,
        "DEVICE_TOKEN_REQUIRED",
        "Send the device token as an Authorization: Bearer credential.",
      );
    const tenantId = TOKEN.exec(token)?.[1];
    const invalid = () => {
      failures.record(source);
      return fail(401, "DEVICE_TOKEN_INVALID", "This device is not paired.");
    };
    if (!tenantId) throw invalid();
    const [tenant] = await db.system((tx) =>
      tx.query(
        "SELECT id,name,coalesce(to_jsonb(t)->>'lifecycle_state','active') AS lifecycle_state FROM tenants t WHERE id=$1",
        [tenantId],
      ),
    );
    if (!tenant) throw invalid();
    const digest = tokenHash(token);
    const [device] = (await db.tenant(workerActor(tenantId), (tx) =>
      tx.query("SELECT * FROM healthkit_devices WHERE token_hash=$1", [digest]),
    )) as Device[];
    if (!device) throw invalid();
    if (device.status !== "active")
      throw fail(
        401,
        "DEVICE_REVOKED",
        "This device was disconnected. Pair it again from the coaching app.",
      );
    if (req.hostContext?.custom && req.hostContext.tenantId !== tenantId)
      throw fail(
        403,
        "HOST_TENANT_MISMATCH",
        "This device belongs to a different coaching website.",
      );
    if (tenant.lifecycle_state !== "active")
      throw fail(
        403,
        "WORKSPACE_CLOSED",
        "This workspace is no longer active.",
      );
    return { device, tenant, digest };
  }
  /** Records why uploads stop, so support can see it; never throws. */
  async function noteError(device: Device, code: string) {
    await db
      .tenant(memberScope(device.tenant_id, device.user_id), (tx) =>
        tx.query(
          "UPDATE healthkit_devices SET last_error_code=$2,last_seen_at=now(),updated_at=now() WHERE id=$1 AND status='active'",
          [device.id, code],
        ),
      )
      .catch(() => {});
  }
  const noted = new Set([
    "MEMBERSHIP_ENDED",
    "HEALTHKIT_POLICY",
    "CONSENT_REQUIRED",
    "DAILY_QUOTA",
    "HEALTHKIT_SYNC_DISABLED",
    "IMPORT_REVIEW_PENDING",
    "APPLE_IMPORTS_DISABLED",
  ]);
  async function uploadGate(tx: Tx, device: Device) {
    if (!(await actorIsCurrent(tx, device.tenant_id, device.user_id)))
      throw fail(
        403,
        "MEMBERSHIP_ENDED",
        "This membership is no longer active.",
      );
    requireSyncPolicy(await coachWearablePolicy(tx));
    await requireConsent(tx, device.user_id);
  }

  app.post(
    COMPANION_PREFIX + "pair",
    { config: { rateLimit: deviceBudget(10, "10 minutes", false) } },
    async (req) => {
      const b = z
        .object({
          code: z.string().min(12).max(20),
          deviceName: z
            .string()
            .trim()
            .regex(
              /^[\p{L}\p{N} '’._()-]{1,60}$/u,
              "Use letters, numbers, spaces and simple punctuation",
            ),
          platform: z.enum(["ios", "ipados"]),
          appVersion: z
            .string()
            .regex(/^[0-9A-Za-z.+-]{1,32}$/)
            .optional(),
        })
        .strict()
        .parse(req.body);
      requireAvailable();
      const code = normalizePairingCode(b.code);
      const invalid = () =>
        fail(
          400,
          "PAIRING_CODE_INVALID",
          "This pairing code is invalid, expired or already used. Create a new code in the coaching app.",
        );
      if (!code) throw invalid();
      const claim = await db.system(async (tx) => {
        const [row] = await tx.query(
          "SELECT t.token_hash,t.user_id,t.tenant_id,t.payload,m.role FROM one_time_tokens t LEFT JOIN memberships m ON m.tenant_id=t.tenant_id AND m.user_id=t.user_id WHERE t.token_hash=$1 AND t.purpose='healthkit_pair' AND t.consumed_at IS NULL AND t.expires_at>now() FOR UPDATE OF t",
          [codeHash(code)],
        );
        if (!row) return null;
        if (
          req.hostContext?.custom &&
          req.hostContext.tenantId !== row.tenant_id
        )
          throw fail(
            403,
            "HOST_TENANT_MISMATCH",
            "Pair this device with the website where the code was created.",
          );
        await tx.query(
          "UPDATE one_time_tokens SET consumed_at=now() WHERE token_hash=$1",
          [row.token_hash],
        );
        return row;
      });
      if (!claim) throw invalid();
      const token = "hk1." + claim.tenant_id + "." + newToken();
      const actor = memberScope(claim.tenant_id, claim.user_id);
      const created = await db.tenant(actor, async (tx) => {
        await lockMember(tx, claim.tenant_id, claim.user_id);
        if (
          !claim.role ||
          !(await actorIsCurrent(tx, claim.tenant_id, claim.user_id))
        )
          throw fail(
            403,
            "MEMBERSHIP_ENDED",
            "This membership is no longer active.",
          );
        requireSyncPolicy(await coachWearablePolicy(tx));
        await requireConsent(tx, claim.user_id);
        const [{ n }] = await tx.query(
          "SELECT count(*)::int AS n FROM healthkit_devices WHERE user_id=$1 AND status='active'",
          [claim.user_id],
        );
        if (n >= HEALTHKIT_LIMITS.devicesPerMember)
          throw fail(
            409,
            "DEVICE_LIMIT",
            `Up to ${HEALTHKIT_LIMITS.devicesPerMember} devices can be connected. Disconnect one first.`,
          );
        const [device] = await tx.query(
          "INSERT INTO healthkit_devices(id,tenant_id,user_id,token_hash,name,platform,app_version,status,consent_version,last_seen_at) VALUES($1,$2,$3,$4,$5,$6,$7,'active',$8,now()) RETURNING *",
          [
            randomUUID(),
            claim.tenant_id,
            claim.user_id,
            tokenHash(token),
            b.deviceName,
            b.platform,
            b.appVersion ?? null,
            String(claim.payload?.consentVersion ?? "healthkit-sync:v1"),
          ],
        );
        await event(tx, actor, "healthkit.device_paired", device.id, {
          platform: b.platform,
        });
        await notifyUser(tx, actor, {
          userId: claim.user_id,
          category: "account",
          dedupeKey: "healthkit-paired:" + device.id,
          title: "Apple Health sync connected",
          body: `“${b.deviceName}” can now send Apple Health data to your coaching workspace. If you did not pair this device, disconnect it in Connections.`,
          href:
            claim.role === "subscriber"
              ? "/app/wearables"
              : "/trainer/integrations",
        });
        return device as Device;
      });
      const [workspace] = await db.system((tx) =>
        tx.query("SELECT name FROM tenants WHERE id=$1", [claim.tenant_id]),
      );
      return {
        deviceToken: token,
        device: visibleDevice(created),
        workspace: { name: workspace?.name ?? null },
        server: serverOrigin(req),
        endpoints,
        limits: limitsView(),
        acceptedTypes: HEALTHKIT_TYPES,
      };
    },
  );
  app.get(
    COMPANION_PREFIX + "status",
    {
      config: {
        rateLimit: deviceBudget(30, "1 minute"),
      },
    },
    async (req) => {
      const { device, tenant } = await authenticate(req);
      const availability = healthKitAvailability();
      let reason: { code: string; message: string } | null =
        availability.available
          ? null
          : { code: availability.code!, message: availability.message };
      const current = await db.tenant(
        memberScope(device.tenant_id, device.user_id),
        async (tx) => {
          if (!reason)
            try {
              await uploadGate(tx, device);
            } catch (error: any) {
              reason = { code: error.code, message: error.message };
            }
          const [row] = await tx.query(
            "UPDATE healthkit_devices SET last_seen_at=now(),updated_at=now() WHERE id=$1 AND status='active' RETURNING *",
            [device.id],
          );
          return row as Device | undefined;
        },
      );
      if (!current)
        throw fail(
          401,
          "DEVICE_REVOKED",
          "This device was disconnected. Pair it again from the coaching app.",
        );
      return {
        device: visibleDevice(current),
        workspace: { name: tenant.name },
        uploadsAllowed: !reason,
        reason,
        endpoints,
        limits: limitsView(),
        acceptedTypes: HEALTHKIT_TYPES,
        serverTime: new Date().toISOString(),
      };
    },
  );
  app.post(
    COMPANION_PREFIX + "unpair",
    {
      config: {
        rateLimit: deviceBudget(10, "1 minute"),
      },
    },
    async (req) => {
      const { device } = await authenticate(req);
      const actor = memberScope(device.tenant_id, device.user_id);
      await db.tenant(actor, async (tx) => {
        await lockMember(tx, device.tenant_id, device.user_id);
        const [row] = await tx.query(
          "UPDATE healthkit_devices SET status='revoked',revoked_reason='device',revoked_at=now(),version=version+1,updated_at=now() WHERE id=$1 AND status='active' RETURNING id",
          [device.id],
        );
        if (row)
          await event(tx, actor, "healthkit.device_revoked", device.id, {
            reason: "device",
          });
      });
      return { ok: true };
    },
  );
  app.post(
    COMPANION_PREFIX + "samples",
    {
      bodyLimit: HEALTHKIT_LIMITS.bodyBytes,
      config: {
        rateLimit: deviceBudget(30, "1 minute"),
      },
    },
    async (req) => {
      const { device, digest } = await authenticate(req);
      try {
        requireAvailable();
      } catch (error: any) {
        await noteError(device, error.code);
        throw error;
      }
      const batch = healthKitBatchSchema.parse(req.body);
      const requestHash = hash(JSON.stringify(req.body));
      const actor = memberScope(device.tenant_id, device.user_id);
      const now = new Date();
      try {
        return await db.tenant(actor, async (tx) => {
          await lockMember(tx, device.tenant_id, device.user_id);
          const [current] = (await tx.query(
            "SELECT * FROM healthkit_devices WHERE id=$1 AND token_hash=$2 FOR UPDATE",
            [device.id, digest],
          )) as Device[];
          if (!current || current.status !== "active")
            throw fail(
              401,
              "DEVICE_REVOKED",
              "This device was disconnected. Pair it again from the coaching app.",
            );
          const [receipt] = await tx.query(
            "SELECT request_hash,result FROM healthkit_sync_batches WHERE device_id=$1 AND batch_id=$2",
            [device.id, batch.batchId],
          );
          if (receipt) {
            if (receipt.request_hash !== requestHash)
              throw fail(
                409,
                "BATCH_ID_REUSED",
                "This batchId was already used for different content. Use a new batchId for new data.",
              );
            return { ...receipt.result, replayed: true };
          }
          await uploadGate(tx, current);
          const [quota] = await tx.query(
            "SELECT CASE WHEN quota_day=(now() AT TIME ZONE 'UTC')::date THEN quota_batches ELSE 0 END AS batches,CASE WHEN quota_day=(now() AT TIME ZONE 'UTC')::date THEN quota_samples ELSE 0 END AS samples FROM healthkit_devices WHERE id=$1",
            [device.id],
          );
          const entries = batch.samples.length + batch.deletedSampleIds.length;
          if (
            quota.batches + 1 > HEALTHKIT_LIMITS.dailyBatches ||
            quota.samples + entries > HEALTHKIT_LIMITS.dailySamples
          )
            throw fail(
              429,
              "DAILY_QUOTA",
              "This device reached today's upload allowance. Try again after midnight UTC.",
            );
          const rows = (await tx.query(
            "SELECT id,version,data FROM records WHERE kind='wearable' AND status='imported' AND owner_user_id=$1 AND data->>'origin'=$2 AND (data->>'providerKey'=ANY($3::text[]) OR ($4::text[]<>'{}' AND data->'samples' ?| $4::text[])) FOR UPDATE",
            [
              device.user_id,
              ORIGIN,
              [
                ...new Set(
                  batch.samples.map((s) => "healthkit:day:" + bucketDay(s)),
                ),
              ],
              batch.deletedSampleIds,
            ],
          )) as DayRow[];
          const byDay = new Map(rows.map((r) => [r.data.day as string, r]));
          const buckets = new Map<string, DayBucket>(
            rows.map((r) => [r.data.day as string, bucketOf(r)]),
          );
          const applied = applyHealthKitBatch(buckets, batch, device.id, now);
          for (const day of applied.changedDays) {
            const bucket = buckets.get(day) ?? emptyBucket(day);
            const row = byDay.get(day);
            if (bucketEmpty(bucket)) {
              if (row)
                await tx.query("DELETE FROM records WHERE id=$1", [row.id]);
              continue;
            }
            const data = dayData(bucket, current.consent_version, now);
            if (row)
              await tx.query(
                "UPDATE records SET data=$2,version=version+1,updated_at=now() WHERE id=$1",
                [row.id, JSON.stringify(data)],
              );
            else
              await putRecord(tx, actor, "wearable", data, {
                ownerId: device.user_id,
                status: "imported",
              });
          }
          const { changedDays, ...counts } = applied;
          const result = {
            batchId: batch.batchId,
            ...counts,
            days: changedDays.size,
            replayed: false,
            serverTime: now.toISOString(),
          };
          await tx.query(
            "INSERT INTO healthkit_sync_batches(tenant_id,device_id,user_id,batch_id,request_hash,result) VALUES($1,$2,$3,$4,$5,$6)",
            [
              device.tenant_id,
              device.id,
              device.user_id,
              batch.batchId,
              requestHash,
              JSON.stringify(result),
            ],
          );
          await tx.query(
            "UPDATE healthkit_devices SET quota_day=(now() AT TIME ZONE 'UTC')::date,quota_batches=$2,quota_samples=$3,batches_received=batches_received+1,samples_received=samples_received+$4,last_sync_at=now(),last_seen_at=now(),last_error_code=NULL,updated_at=now() WHERE id=$1",
            [
              device.id,
              quota.batches + 1,
              quota.samples + entries,
              counts.stored + counts.updated,
            ],
          );
          await event(tx, actor, "healthkit.batch_received", device.id, {
            batchId: batch.batchId,
            received: counts.received,
            stored: counts.stored,
            updated: counts.updated,
            duplicates: counts.duplicates,
            deleted: counts.deleted,
            skipped: counts.skipped,
          });
          return result;
        });
      } catch (error: any) {
        if (noted.has(error?.code)) await noteError(device, error.code);
        throw error;
      }
    },
  );
}
