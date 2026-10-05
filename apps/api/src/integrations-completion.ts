import { createHash, randomUUID } from "node:crypto";
import { resolveTxt, resolveCname } from "node:dns/promises";
import { domainToASCII } from "node:url";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  actingAs,
  elevated,
  event,
  putRecord,
  type Actor,
  type Database,
  type Tx,
} from "@trainer/db";
import { runtimeConfig } from "../../../packages/providers/src/configuration.ts";
import { cueIssues } from "../../../packages/domain/src/voice-session.ts";
import {
  spokenDistance,
  spokenDuration,
  workMeasure,
} from "../../../packages/domain/src/prescription.ts";
import {
  speechLanguage,
  type SpeechLanguage,
} from "../../../packages/domain/src/speech-language.ts";
import { sandboxResolver } from "../../../packages/providers/src/sandbox.ts";
import {
  integrationRequest,
  exchangeWearableToken,
  fetchWearableObservations,
  revokeWearableToken,
  wearableAuthorization,
  wearableContract,
  voiceContract,
  generateTrainerVoice,
  type WearableProvider,
  type OAuthTokens,
} from "../../../packages/providers/src/integrations.ts";
import { tokenHash, newToken } from "./auth.ts";
import {
  checkAddressDns,
  checkTenantAddresses,
  httpsProbe,
  type AddressHealthDeps,
} from "./web-address-health.ts";
import { validatePublicEndpoint } from "../../../packages/providers/src/configuration.ts";
import { requireRecentMfa } from "./security.ts";
import type { HostContext } from "./host-routing.ts";
import { memberAccess } from "./entitlements.ts";
import {
  costEstimated,
  costNotSent,
  reserveVoiceCost,
} from "./cost-accounting.ts";
import {
  readCoachWearablePolicy,
  revokeHealthKitDevices,
} from "./healthkit-sync.ts";
import { permitCertificateIssuance } from "./host-operations.ts";
import { coachHostTenant, platformRoot } from "./host-routing.ts";
import { legalAcceptanceVersion } from "./legal.ts";
import {
  encryptionReady,
  openSealedValue,
  sealContexts,
  sealValue,
} from "./sealing.ts";
import { retireTrainerVoiceClones } from "./voice-clones.ts";

type Identity = Actor & { platformRole?: string; mfaAt?: string | null };
type Deps = AddressHealthDeps & {
  txt?: typeof resolveTxt;
  cname?: typeof resolveCname;
};
// The local mock-provider sandbox answers domain lookups from a loopback DNS
// double; everywhere else (sandboxResolver() is null) the system resolver runs.
const txtLookup = (dependencies: Deps): typeof resolveTxt =>
  dependencies.txt ??
  ((name: string) => (sandboxResolver() ?? { resolveTxt }).resolveTxt(name));
const cnameLookup = (dependencies: Deps): typeof resolveCname =>
  dependencies.cname ??
  ((name: string) =>
    (sandboxResolver() ?? { resolveCname }).resolveCname(name));
const id = z.string().uuid(),
  providerSchema = z.enum(["whoop", "zepp"]);
const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
const conflict = () =>
  fail(
    409,
    "INTEGRATION_CONFLICT",
    "This connection changed. Reload before continuing.",
  );
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
function identity(req: FastifyRequest): Identity {
  if (!req.identity) throw fail(401, "AUTH_REQUIRED", "Please sign in.");
  return req.identity;
}
function owner(req: FastifyRequest) {
  const a = identity(req);
  if (a.role !== "owner")
    throw fail(403, "OWNER_REQUIRED", "Workspace owner access is required.");
  return a;
}
function admin(req: FastifyRequest) {
  const a = identity(req);
  if (a.platformRole !== "admin")
    throw fail(
      403,
      "ADMIN_REQUIRED",
      "Platform administrator access is required.",
    );
  requireRecentMfa(a, true);
  return a;
}
// A follower's wearable and guided-session work runs in its own subscriber
// scope (its connections, records and audio; the trainer voice facts come
// from guided_voice(), migration 061); team members keep their own role.
const internal = (a: Actor) => actingAs(a, "owner", "coach-workflow");
async function lock(tx: Tx, a: Actor, area = "integrations") {
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    a.tenantId + ":" + area + ":" + a.userId,
  ]);
}
function origin(req: FastifyRequest) {
  return (
    ((req as any).hostContext as HostContext | undefined)?.origin ??
    runtimeConfig().PUBLIC_APP_URL ??
    "http://localhost:3000"
  );
}
function encryptionKey() {
  if (!encryptionReady())
    throw fail(
      503,
      "ENCRYPTION_REQUIRED",
      "Configure the server encryption key before connecting providers.",
    );
}
export function sealIntegrationSecret(scope: string, value: unknown) {
  encryptionKey();
  return sealValue(sealContexts.integration(scope), JSON.stringify(value));
}
export function openIntegrationSecret<T>(scope: string, value: string): T {
  try {
    return JSON.parse(
      openSealedValue(sealContexts.integration(scope), value).value,
    );
  } catch {
    throw fail(
      503,
      "INTEGRATION_CREDENTIALS",
      "Connection credentials could not be read; reconnect this provider.",
    );
  }
}
const scope = (a: Actor, provider: WearableProvider) =>
  [a.tenantId, a.userId, provider].join(":");
async function latestConsent(tx: Tx, userId: string, type: string) {
  const [c] = await tx.query(
    "SELECT granted FROM consent_records WHERE user_id=$1 AND document_type=$2 ORDER BY created_at DESC,id DESC LIMIT 1",
    [userId, type],
  );
  return c?.granted === true;
}
async function workspacePermission(tx: Tx, a: Actor) {
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    a.tenantId + ":workspace",
  ]);
  const [r] = await tx.query(
    "SELECT integration_actor_is_current($1,$2) AS active",
    [a.tenantId, a.userId],
  );
  return r?.active === true;
}
const workerActor = (tenantId: string): Actor =>
  elevated("worker", { tenantId, role: "owner" });
// System roles must not bypass tenant RLS. Admin listing and workers select the
// non-sensitive workspace directory, then enter an explicit scoped transaction.
async function scopedAdminRows(
  db: Database,
  operator: { userId: string },
  table: "trainer_voices" | "domain_orders",
  recordId?: string,
  tenantId?: string,
  includeSample = false,
) {
  const tenants = await db.system((tx) =>
    tx.query(
      "SELECT id,name FROM tenants WHERE ($1::uuid IS NULL OR id=$1) ORDER BY created_at DESC" +
        (recordId ? "" : " LIMIT 100"),
      [tenantId ?? null],
    ),
  );
  const result: any[] = [];
  for (const tenant of tenants) {
    // The Super admin's own listing, after the route's platform-role and
    // step-up checks: a platform-operator scope, never the worker's.
    const operatorScope = elevated("platform-operator", {
      tenantId: tenant.id,
      userId: operator.userId,
      role: "owner",
    });
    const rows = await db.tenant(operatorScope, (tx) =>
      tx.query(
        table === "trainer_voices"
          ? "SELECT id,tenant_id,user_id,status,version,provider,provider_voice_id,clone_id,model,language,evidence,consent_version,sample IS NOT NULL AS has_sample,sample_type,verified_at,created_at,updated_at" +
              (includeSample ? ",sample" : "") +
              " FROM trainer_voices WHERE ($1::uuid IS NULL OR id=$1) ORDER BY updated_at DESC LIMIT 100"
          : "SELECT * FROM domain_orders WHERE mode='manual' AND ($1::uuid IS NULL OR id=$1) ORDER BY updated_at DESC LIMIT 100",
        [recordId ?? null],
      ),
    );
    result.push(
      ...rows.map((row) => ({
        ...row,
        tenant_name: tenant.name,
        name: tenant.name,
      })),
    );
    if ((recordId && result.length) || result.length >= 100) break;
  }
  return result;
}
async function consent(
  tx: Tx,
  a: Actor,
  type: string,
  granted: boolean,
  version = "integration-consent-v1:withdrawal",
) {
  await tx.query(
    "INSERT INTO consent_records(id,tenant_id,user_id,document_type,document_version,granted) VALUES($1,$2,$3,$4,$5,$6)",
    [randomUUID(), a.tenantId, a.userId, type, version, granted],
  );
}
function visibleConnection(row: any) {
  return {
    id: row.id,
    provider: row.provider,
    status: row.status,
    version: row.version,
    scopes: row.scopes,
    summary: row.summary,
    lastSyncedAt: row.last_synced_at,
    nextSyncAt: row.next_sync_at,
    stale:
      !row.last_synced_at ||
      Date.now() - new Date(row.last_synced_at).getTime() > 86400000,
  };
}

export async function exportIntegrationData(tx: Tx, userId: string) {
  return {
    connections: await tx.query(
      "SELECT id,provider,status,scopes,summary,last_synced_at,created_at,updated_at FROM integration_connections WHERE user_id=$1",
      [userId],
    ),
    voice: await tx.query(
      "SELECT id,status,version,provider_voice_id,evidence,consent_version,sample_type,encode(sample,'base64') AS sample_base64,verified_at,created_at FROM trainer_voices WHERE user_id=$1",
      [userId],
    ),
    guidedAudio: await tx.query(
      "SELECT id,workout_id,status,text_content,data,created_at FROM guided_audio WHERE user_id=$1",
      [userId],
    ),
  };
}
export async function disableUserIntegrations(
  tx: Tx,
  userId: string,
  kind: "all" | "voice" | "wearable" = "all",
) {
  if (kind !== "voice") {
    await tx.query(
      "UPDATE integration_connections SET status=CASE WHEN credentials IS NULL THEN 'revoked' ELSE 'revocation_pending' END,version=version+1,summary='{\"message\":\"Local access revoked; provider revocation queued.\"}',lease_until=NULL,next_sync_at=now(),updated_at=now() WHERE user_id=$1 AND status<>'revoked'",
      [userId],
    );
    await tx.query(
      "UPDATE integration_oauth_states SET consumed_at=now(),verifier='' WHERE user_id=$1 AND consumed_at IS NULL",
      [userId],
    );
    await tx.query(
      "UPDATE records SET status='permission_revoked',data=jsonb_set(data,'{allowedUses}','[\"render\"]'),updated_at=now() WHERE owner_user_id=$1 AND kind='wearable'",
      [userId],
    );
    await revokeHealthKitDevices(tx, userId, "consent");
  }
  if (kind !== "wearable") {
    // Clones the trainer made in the app are deleted here and queued for
    // deletion at the provider (voice-clones.ts).
    await retireTrainerVoiceClones(tx, userId, "consent_withdrawn");
    await tx.query(
      "UPDATE trainer_voices SET status='revoked',sample=NULL,provider_voice_id=NULL,clone_id=NULL,version=version+1,updated_at=now() WHERE user_id=$1",
      [userId],
    );
    await tx.query(
      "UPDATE guided_audio SET status='revoked',audio=NULL WHERE user_id=$1 OR voice_id IN (SELECT id FROM trainer_voices WHERE user_id=$1)",
      [userId],
    );
    // Voice-led session audio (migration 065) stops with the voice.
    await tx.query(
      "UPDATE voice_session_clips SET status='revoked',audio=NULL,updated_at=now() WHERE (user_id=$1 OR voice_id IN (SELECT id FROM trainer_voices WHERE user_id=$1)) AND status<>'revoked'",
      [userId],
    );
    await tx.query(
      "UPDATE voice_sessions SET mode='text',audio_status='revoked',unavailable_reason='VOICE_UNAVAILABLE',version=version+1,updated_at=now() WHERE (user_id=$1 OR voice_id IN (SELECT id FROM trainer_voices WHERE user_id=$1)) AND audio_status<>'revoked'",
      [userId],
    );
  }
}

export async function syncWearableConnection(
  db: Database,
  a: Actor,
  provider: WearableProvider,
) {
  const contract = wearableContract(provider);
  const reserved: Record<string, any> & { version: number } = await db.tenant(
    internal(a),
    async (tx) => {
      if (!(await workspacePermission(tx, a)))
        throw fail(
          403,
          "WORKSPACE_CLOSED",
          "This workspace or membership is no longer active.",
        );
      await lock(tx, a);
      const [r] = await tx.query(
        "SELECT * FROM integration_connections WHERE user_id=$1 AND provider=$2 FOR UPDATE",
        [a.userId, provider],
      );
      if (!r || !r.credentials || r.status !== "active")
        throw fail(
          409,
          "CONNECTION_STATE",
          "This wearable is not ready to synchronize.",
        );
      if (!(await latestConsent(tx, a.userId, "wearable:" + provider)))
        throw fail(403, "WEARABLE_CONSENT", "Wearable permission is required.");
      await tx.query(
        "UPDATE integration_connections SET status='syncing',lease_until=now()+interval '5 minutes',version=version+1,updated_at=now() WHERE id=$1",
        [r.id],
      );
      return { ...r, version: Number(r.version) + 1 };
    },
  );
  let tokens: OAuthTokens;
  const beforeRead = async (refresh = false) =>
    db.tenant(internal(a), async (tx) => {
      if (!(await workspacePermission(tx, a)))
        throw fail(
          403,
          "WORKSPACE_CLOSED",
          "This workspace or membership is no longer active.",
        );
      await lock(tx, a);
      const [current] = await tx.query(
        "SELECT id FROM integration_connections WHERE id=$1 AND version=$2 AND status='syncing'",
        [reserved.id, reserved.version],
      );
      if (
        !current ||
        !(await latestConsent(tx, a.userId, "wearable:" + provider))
      )
        throw fail(
          403,
          "WEARABLE_CONSENT",
          "Wearable permission changed before the provider request.",
        );
      if (refresh)
        await tx.query(
          "UPDATE integration_connections SET summary=summary||'{\"refreshOutcomeUnknown\":true}'::jsonb WHERE id=$1",
          [reserved.id],
        );
    });
  try {
    tokens = openIntegrationSecret<OAuthTokens>(
      scope(a, provider),
      reserved.credentials,
    );
    if (tokens.obtainedAt + tokens.expires_in * 1000 - 120000 <= Date.now()) {
      if (!tokens.refresh_token)
        throw fail(
          409,
          "RECONNECT",
          "Authorization expired. Reconnect this wearable.",
        );
      const next = await exchangeWearableToken(
        provider,
        { refreshToken: tokens.refresh_token },
        () => beforeRead(true),
      );
      tokens = {
        ...next,
        refresh_token: next.refresh_token ?? tokens.refresh_token,
      };
      const saved = await db.tenant(internal(a), async (tx) => {
        const permitted = await workspacePermission(tx, a);
        await lock(tx, a);
        const [current] = await tx.query(
          "SELECT * FROM integration_connections WHERE id=$1 FOR UPDATE",
          [reserved.id],
        );
        const active =
          permitted &&
          current?.status === "syncing" &&
          Number(current.version) === reserved.version &&
          (await latestConsent(tx, a.userId, "wearable:" + provider));
        if (active) {
          await tx.query(
            "UPDATE integration_connections SET credentials=$2,summary=summary-'refreshOutcomeUnknown',updated_at=now() WHERE id=$1",
            [reserved.id, sealIntegrationSecret(scope(a, provider), tokens)],
          );
          return true;
        }
        // A refresh invalidates both old WHOOP tokens. Even if revocation/erasure
        // won the race, preserve only the new encrypted authorization for revoke.
        if (
          current &&
          ["revocation_pending", "revoked", "syncing"].includes(current.status)
        )
          await tx.query(
            "UPDATE integration_connections SET status='revocation_pending',credentials=$2,summary=summary-'refreshOutcomeUnknown',version=version+1,next_sync_at=now(),lease_until=NULL,updated_at=now() WHERE id=$1",
            [reserved.id, sealIntegrationSecret(scope(a, provider), tokens)],
          );
        return false;
      });
      if (!saved) return { revoked: true };
    }
    const since = new Date(
      Math.max(
        Date.now() - 30 * 86400000,
        new Date(reserved.last_synced_at ?? 0).getTime() - 2 * 86400000,
      ),
    ).toISOString();
    const observations = await fetchWearableObservations(
      provider,
      tokens.access_token,
      since,
      () => beforeRead(),
    );
    return await db.tenant(internal(a), async (tx) => {
      const permitted = await workspacePermission(tx, a);
      await lock(tx, a);
      const [current] = await tx.query(
        "SELECT status,version FROM integration_connections WHERE id=$1 FOR UPDATE",
        [reserved.id],
      );
      if (
        !permitted ||
        current?.status !== "syncing" ||
        Number(current.version) !== reserved.version ||
        !(await latestConsent(tx, a.userId, "wearable:" + provider))
      )
        return { revoked: true };
      let inserted = 0;
      for (const observation of observations) {
        const key = hash(provider + ":" + observation.id),
          [prior] = await tx.query(
            "SELECT id,data FROM records WHERE kind='wearable' AND owner_user_id=$1 AND data->>'providerKey'=$2",
            [a.userId, key],
          );
        const data = {
          source: provider,
          origin: provider,
          providerKey: key,
          observations: [observation],
          count: 1,
          importedAt: new Date().toISOString(),
          allowedUses: ["render", "deterministic_feature"],
          restrictions: ["no_model_prompt", "no_marketing"],
        };
        if (prior)
          await tx.query(
            "UPDATE records SET data=$2,version=version+1,status='imported',updated_at=now() WHERE id=$1",
            [prior.id, JSON.stringify(data)],
          );
        else {
          await putRecord(tx, a, "wearable", data, { status: "imported" });
          inserted++;
        }
      }
      const summary = {
        observations: observations.length,
        inserted,
        coverageFrom: since,
        categories: [...new Set(observations.map((x) => x.type))],
        allowedUses: ["render", "deterministic_feature"],
        contractScopes: contract.scopes,
      };
      await tx.query(
        "UPDATE integration_connections SET status='active',summary=$2,last_synced_at=now(),next_sync_at=now()+interval '1 hour',lease_until=NULL,updated_at=now() WHERE id=$1",
        [reserved.id, JSON.stringify(summary)],
      );
      await event(tx, a, "wearable.synchronized", reserved.id, {
        provider,
        count: observations.length,
      });
      return summary;
    });
  } catch {
    await db.tenant(internal(a), (tx) =>
      tx.query(
        "UPDATE integration_connections SET status='attention',summary=summary||'{\"message\":\"Synchronization could not be confirmed. Reconnect to resume.\"}'::jsonb,lease_until=NULL,updated_at=now() WHERE id=$1 AND version=$2 AND status='syncing'",
        [reserved.id, reserved.version],
      ),
    );
    throw fail(
      409,
      "WEARABLE_SYNC",
      "Synchronization could not complete. Reconnect this wearable; existing observations remain visible.",
    );
  }
}

export async function processIntegrationJobs(db: Database) {
  const tenants = await db.system((tx) =>
    tx.query("SELECT id,lifecycle_state FROM tenants ORDER BY id"),
  );
  for (const tenant of tenants) {
    const wa = workerActor(tenant.id);
    const pending = await db.tenant(wa, (tx) =>
      tx.query(
        "SELECT c.user_id,c.provider,c.status FROM integration_connections c WHERE c.next_sync_at<=now() AND (c.status='revocation_pending' OR (c.status='active' AND $1 AND EXISTS(SELECT 1 FROM memberships m WHERE m.tenant_id=c.tenant_id AND m.user_id=c.user_id))) ORDER BY c.next_sync_at LIMIT 30",
        [tenant.lifecycle_state === "active"],
      ),
    );
    for (const row of pending) {
      // Each connection is synchronized or revoked as its own member, in that
      // member's subscriber scope (a former member only reaches its own rows).
      const a = {
        tenantId: tenant.id,
        userId: row.user_id,
        role: "subscriber",
      };
      try {
        if (row.status === "active") {
          await syncWearableConnection(db, a, row.provider);
          continue;
        }
        const connection = await db.tenant(a, async (tx) => {
          await lock(tx, a);
          const [r] = await tx.query(
            "SELECT * FROM integration_connections WHERE user_id=$1 AND provider=$2 AND status='revocation_pending' AND next_sync_at<=now() FOR UPDATE",
            [a.userId, row.provider],
          );
          if (r)
            await tx.query(
              "UPDATE integration_connections SET next_sync_at=now()+interval '1 hour' WHERE id=$1",
              [r.id],
            );
          return r;
        });
        if (!connection) continue;
        if (connection.credentials)
          await revokeWearableToken(
            row.provider,
            openIntegrationSecret<OAuthTokens>(
              scope(a, row.provider),
              connection.credentials,
            ).access_token,
          );
        await db.tenant(a, (tx) =>
          tx.query(
            "UPDATE integration_connections SET status='revoked',credentials=NULL,summary='{\"message\":\"Provider revocation confirmed.\"}',updated_at=now() WHERE id=$1 AND version=$2 AND status='revocation_pending'",
            [connection.id, connection.version],
          ),
        );
      } catch {
        /* Local access stays denied; provider rejection/expired tokens require external account revocation evidence. */
      }
    }
    const expiredHosts = await db.tenant(wa, async (tx) => {
      await tx.query(
        "UPDATE integration_connections SET status='attention',summary='{\"message\":\"Synchronization lease expired; reconnect to reconcile authorization.\"}',lease_until=NULL,updated_at=now() WHERE status='syncing' AND lease_until<now()",
      );
      await tx.query(
        "DELETE FROM integration_oauth_states WHERE expires_at<now()-interval '1 day'",
      );
      return tx.query(
        // Automatic orders lapse through the web address worker, which also
        // notifies the trainer and ends the yearly subscription.
        "UPDATE domain_orders SET status='expired',version=version+1,updated_at=now() WHERE mode='manual' AND ((expires_at<=now() AND status='active') OR (reservation_expires_at<=now() AND status IN ('requested','quoted','owned','verified'))) RETURNING hostname,evidence",
      );
    });
    if (expiredHosts.length)
      await db.system((tx) =>
        tx.query(
          "UPDATE domain_mappings SET active=false WHERE tenant_id=$1 AND hostname=ANY($2::text[])",
          [
            tenant.id,
            expiredHosts.flatMap((r) =>
              r.evidence?.includeWww
                ? [r.hostname, "www." + r.hostname]
                : [r.hostname],
            ),
          ],
        ),
      );
  }
}

/** Export-file import sources (POST /wearables/import) and the history length shown. */
export const FILE_IMPORT_SOURCES = ["apple_health", "manual_import"];
export const IMPORT_HISTORY_LIMIT = 50;

/**
 * The language a guided segment is spoken in. A segment is one request: the
 * exercise name, the English template (sets, repetitions, rest) and the
 * trainer's cue. The name is a proper noun inside the template, so it does
 * not decide the language: without an Arabic cue the segment is English even
 * when the name is Arabic; with one it is the majority of template and cue.
 */
export function guidedSegmentLanguage(segment: {
  name: string;
  text: string;
}): SpeechLanguage {
  const text = segment.text.startsWith(segment.name)
    ? segment.text.slice(segment.name.length)
    : segment.text;
  return speechLanguage(text);
}
/**
 * What makes a member's guided audio reusable: workout, voice version, text,
 * provider, model and price, and for a segment spoken in Arabic its language
 * (`guidedSegmentLanguage`; 29 September 2026: segments were all sent as
 * English before, so that audio is never reused for them).
 */
export function guidedAudioFingerprint(
  workoutId: string,
  voice: { id: string; version: number; provider: string },
  text: string,
  model: string,
  priceVersion: string,
  language: SpeechLanguage,
) {
  return hash(
    [
      workoutId,
      voice.id,
      voice.version,
      text,
      voice.provider,
      model,
      priceVersion,
      ...(language !== "en" ? ["language:" + language] : []),
    ].join(":"),
  );
}
export function registerIntegrationCompletion(
  app: FastifyInstance,
  db: Database,
  dependencies: Deps = {},
) {
  app.get("/api/v1/integrations/connections", async (req) => {
    const a = identity(req);
    // The coach's policy "none" (No wearable imports) refuses the Apple
    // export import, so the import panel can explain that before a file is chosen.
    const policy = await readCoachWearablePolicy(db, a);
    return db.tenant(a, async (tx) => ({
      coachAllowsImports: policy !== "none",
      connections: (
        await tx.query(
          "SELECT id,provider,status,version,scopes,summary,last_synced_at,next_sync_at FROM integration_connections WHERE user_id=$1",
          [a.userId],
        )
      ).map(visibleConnection),
      imports: await tx.query(
        "SELECT data->>'source' AS source,count(*)::integer AS batches,sum(coalesce((data->>'count')::integer,0))::integer AS observations,min(created_at) AS first_import,max(updated_at) AS latest_import FROM records WHERE kind='wearable' AND owner_user_id=$1 AND status='imported' GROUP BY data->>'source'",
        [a.userId],
      ),
      // The member's own export-file import batches, newest first, so one
      // batch can be deleted (DELETE /wearables/:id). The bounded bootstrap
      // does not carry wearable records; this is the list that names them.
      // Provider sync and HealthKit days have their own revoke/delete controls.
      importHistory: await tx.query(
        "SELECT id,data->>'source' AS source,coalesce((data->>'count')::integer,0) AS observations,created_at AS imported_at FROM records WHERE kind='wearable' AND owner_user_id=$1 AND status='imported' AND data->>'source'=ANY($2::text[]) ORDER BY created_at DESC,id DESC LIMIT $3",
        [a.userId, FILE_IMPORT_SOURCES, IMPORT_HISTORY_LIMIT],
      ),
    }));
  });
  app.post("/api/v1/integrations/:provider/connect", async (req) => {
    const a = identity(req),
      provider = providerSchema.parse((req.params as any).provider),
      body = z.object({ consent: z.literal(true) }).parse(req.body);
    wearableContract(provider);
    encryptionKey();
    const consentVersion =
      (await legalAcceptanceVersion(db, "wearable")) +
      "|integration-consent:v1";
    const state = a.tenantId + "." + newToken(),
      verifier = newToken(),
      challenge = createHash("sha256").update(verifier).digest("base64url"),
      session = (req.cookies as any)?.session;
    if (!session)
      throw fail(
        401,
        "SESSION_REQUIRED",
        "Sign in again before connecting your wearable.",
      );
    const url = wearableAuthorization(provider, state, challenge);
    await db.tenant(a, async (tx) => {
      if (!(await workspacePermission(tx, a)))
        throw fail(
          403,
          "WORKSPACE_CLOSED",
          "This workspace or membership is no longer active.",
        );
      await lock(tx, a);
      const [current] = await tx.query(
        "SELECT status FROM integration_connections WHERE user_id=$1 AND provider=$2",
        [a.userId, provider],
      );
      if (["revocation_pending", "syncing"].includes(current?.status))
        throw fail(
          409,
          "REVOCATION_PENDING",
          "Provider revocation must finish before reconnecting.",
        );
      await consent(
        tx,
        a,
        "wearable:" + provider,
        body.consent,
        consentVersion,
      );
      await tx.query(
        "UPDATE integration_oauth_states SET consumed_at=now(),verifier='' WHERE user_id=$1 AND provider=$2 AND consumed_at IS NULL",
        [a.userId, provider],
      );
      await tx.query(
        "INSERT INTO integration_oauth_states(state_hash,tenant_id,user_id,provider,session_hash,verifier,origin,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval '10 minutes')",
        [
          tokenHash(state),
          a.tenantId,
          a.userId,
          provider,
          tokenHash(session),
          sealIntegrationSecret(scope(a, provider), verifier),
          origin(req),
        ],
      );
      await event(tx, a, "wearable.authorization_started", undefined, {
        provider,
      });
    });
    return { url };
  });
  app.get("/api/v1/integrations/:provider/callback", async (req, reply) => {
    const provider = providerSchema.parse((req.params as any).provider),
      q = z
        .object({
          state: z.string().min(20).max(200),
          code: z.string().min(1).max(2000).optional(),
          error: z.string().max(200).optional(),
        })
        .parse(req.query);
    const tenantId = id.parse(q.state.split(".")[0]);
    // The provider's redirect carries no session for this site yet: only the
    // initiating origin is read, by the integration_oauth_relay() definer
    // (migration 061) in a service transaction bound to the state's workspace.
    const [found] = await db.system(
      (tx) =>
        tx.query<{ origin: string | null }>(
          "SELECT integration_oauth_relay($1,$2) AS origin",
          [tokenHash(q.state), provider],
        ),
      { tenantId },
    );
    if (!found?.origin)
      throw fail(
        400,
        "OAUTH_STATE",
        "This authorization link is expired or already used.",
      );
    const relay = { origin: found.origin };
    reply
      .header("Cache-Control", "no-store")
      .header("Referrer-Policy", "no-referrer");
    if (relay.origin !== origin(req)) {
      // A provider has one registered callback. Relay its one-time code back to
      // the verified initiating site before checking that site's session cookie.
      const registered = new URL(wearableContract(provider).redirect);
      // A coach domain or a workspace subdomain of the platform root.
      const mappedTenant = await coachHostTenant(
        db,
        new URL(relay.origin).host,
      );
      if (
        origin(req) !== registered.origin ||
        mappedTenant !== tenantId ||
        new URL(relay.origin).protocol !== "https:"
      )
        throw fail(
          400,
          "OAUTH_STATE",
          "The authorization callback does not match the initiating website.",
        );
      const target = new URL(
        `/api/v1/integrations/${provider}/callback`,
        relay.origin,
      );
      target.searchParams.set("state", q.state);
      if (q.code) target.searchParams.set("code", q.code);
      if (q.error) target.searchParams.set("error", q.error);
      return reply.redirect(target.toString());
    }
    const a = identity(req),
      session = (req.cookies as any)?.session;
    const state = await db.tenant(a, async (tx) => {
      if (!(await workspacePermission(tx, a)))
        throw fail(
          403,
          "WORKSPACE_CLOSED",
          "This workspace or membership is no longer active.",
        );
      await lock(tx, a);
      const [s] = await tx.query(
        "SELECT * FROM integration_oauth_states WHERE state_hash=$1 AND user_id=$2 AND provider=$3 AND expires_at>now() AND consumed_at IS NULL FOR UPDATE",
        [tokenHash(q.state), a.userId, provider],
      );
      if (
        !s ||
        !session ||
        s.session_hash !== tokenHash(session) ||
        s.origin !== origin(req)
      )
        throw fail(
          400,
          "OAUTH_STATE",
          "This authorization link is expired, used, or belongs to another session or website.",
        );
      await tx.query(
        "UPDATE integration_oauth_states SET consumed_at=now(),verifier='' WHERE state_hash=$1",
        [s.state_hash],
      );
      return s;
    });
    if (q.error || !q.code)
      return reply.redirect(
        state.origin + "/app/wearables?connection=declined",
      );
    const tokens = await exchangeWearableToken(provider, {
      code: q.code,
      verifier: openIntegrationSecret<string>(
        scope(a, provider),
        state.verifier,
      ),
    });
    const scopes = tokens.scope.split(/\s+/).filter(Boolean),
      required = wearableContract(provider).scopes.filter(
        (x) => x !== "offline",
      );
    const scopeApproved =
      !scopes.length || required.every((x) => scopes.includes(x));
    const activated = await db.tenant(internal(a), async (tx) => {
      const permitted = await workspacePermission(tx, a);
      await lock(tx, a);
      const [latest] = await tx.query(
        "SELECT state_hash FROM integration_oauth_states WHERE user_id=$1 AND provider=$2 ORDER BY created_at DESC,state_hash DESC LIMIT 1",
        [a.userId, provider],
      );
      const active =
        permitted &&
        scopeApproved &&
        latest?.state_hash === state.state_hash &&
        (await latestConsent(tx, a.userId, "wearable:" + provider));
      await tx.query(
        "INSERT INTO integration_connections(id,tenant_id,user_id,provider,status,credentials,scopes) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(tenant_id,user_id,provider) DO UPDATE SET status=EXCLUDED.status,credentials=EXCLUDED.credentials,scopes=EXCLUDED.scopes,version=integration_connections.version+1,summary='{}',next_sync_at=now(),lease_until=NULL,updated_at=now()",
        [
          randomUUID(),
          a.tenantId,
          a.userId,
          provider,
          active ? "active" : "revocation_pending",
          sealIntegrationSecret(scope(a, provider), tokens),
          active ? scopes : [],
        ],
      );
      await event(
        tx,
        a,
        active ? "wearable.connected" : "wearable.revocation_queued",
        undefined,
        { provider },
      );
      return active;
    });
    return reply.redirect(
      state.origin +
        "/app/wearables?connection=" +
        (activated ? "connected" : "revocation_pending"),
    );
  });
  app.post("/api/v1/integrations/:provider/sync", async (req) =>
    syncWearableConnection(
      db,
      identity(req),
      providerSchema.parse((req.params as any).provider),
    ),
  );
  app.post("/api/v1/integrations/:provider/revoke", async (req) => {
    const a = identity(req),
      provider = z
        .enum(["whoop", "zepp", "apple_health", "manual_import"])
        .parse((req.params as any).provider);
    return db.tenant(a, async (tx) => {
      await lock(tx, a);
      await consent(tx, a, "wearable:" + provider, false);
      await tx.query(
        "UPDATE integration_oauth_states SET consumed_at=now(),verifier='' WHERE user_id=$1 AND provider=$2 AND consumed_at IS NULL",
        [a.userId, provider],
      );
      await tx.query(
        "UPDATE integration_connections SET status=CASE WHEN credentials IS NULL THEN 'revoked' ELSE 'revocation_pending' END,version=version+1,summary='{\"message\":\"Local access revoked; provider revocation queued.\"}',next_sync_at=now(),lease_until=NULL,updated_at=now() WHERE user_id=$1 AND provider=$2",
        [a.userId, provider],
      );
      await tx.query(
        "UPDATE records SET status='permission_revoked',data=jsonb_set(data,'{allowedUses}','[\"render\"]'),updated_at=now() WHERE kind='wearable' AND owner_user_id=$1 AND data->>'source'=$2",
        [a.userId, provider],
      );
      // Apple Health use covers both the export import and automatic sync.
      if (provider === "apple_health")
        await revokeHealthKitDevices(tx, a.userId, "source_revoked");
      await event(tx, a, "wearable.revoked", undefined, { provider });
      return {
        ok: true,
        message:
          "Local access stopped. A connected provider is revoked by the background worker; existing imported observations remain available for export or deletion.",
      };
    });
  });
  registerVoiceRoutes(app, db);
  registerDomainRoutes(app, db, dependencies);
}

async function guidedMaterial(tx: Tx, a: Actor, workoutId: string) {
  if (!(await workspacePermission(tx, a)))
    throw fail(
      403,
      "WORKSPACE_CLOSED",
      "This workspace or membership is no longer active.",
    );
  await lock(tx, a, "training");
  // Paid or complimentary access; premium voice is a paid product capability.
  const access = await memberAccess(tx, a.userId);
  if (!access.active)
    throw fail(
      402,
      "MEMBERSHIP_REQUIRED",
      "An active workout membership is required.",
    );
  const [workout] = await tx.query(
    "SELECT * FROM records WHERE id=$1 AND kind='workout' AND owner_user_id=$2",
    [workoutId, a.userId],
  );
  // The follower's own scope sees its held workouts; a takeover is asked for.
  const [hold] = await tx.query(
    "SELECT (EXISTS(SELECT 1 FROM records WHERE owner_user_id=$1 AND kind='workout' AND status='safety_hold') OR member_takeover_active()) AS held",
    [a.userId],
  );
  if (!workout || workout.status !== "active" || hold?.held)
    throw fail(
      409,
      "GUIDANCE_PAUSED",
      "Guided sessions are paused. Resolve the workout hold or coach takeover first.",
    );
  const exercises = workout.data.program?.exercises ?? [];
  // The trainer's cue is the exercise's `cue` field (trainingExerciseSchema);
  // programs never carried `notes`, so the cue was silently dropped before.
  // It is spoken in the trainer's voice, so it gets the voice session's cue
  // checks (red flags, medical, prescription changes, unsafe technique,
  // numbers outside tempo); a cue that fails is left out.
  const spokenCue = (cue: unknown) =>
    typeof cue === "string" && cue.trim() && !cueIssues(cue).length
      ? " " + cue.trim()
      : "";
  const segments = exercises.map((ex: any, index: number) => ({
    index,
    name: String(ex.name ?? "Exercise"),
    // Timed and distance work is spoken as rounds of a time or distance.
    text: `${ex.name}. ${
      workMeasure(ex) === "time"
        ? `${ex.sets > 1 ? `${ex.sets} rounds of ` : ""}${spokenDuration(ex.durationSeconds)}`
        : workMeasure(ex) === "distance"
          ? `${ex.sets > 1 ? `${ex.sets} rounds of ` : ""}${spokenDistance(ex.distanceMeters)}`
          : `${ex.sets} sets of ${ex.reps} repetitions`
    }.${spokenCue(ex.cue)}${
      Number(ex.restSeconds ?? ex.rest ?? 60) > 0
        ? ` Rest ${Number(ex.restSeconds ?? ex.rest ?? 60)} seconds between ${workMeasure(ex) === "reps" ? "sets" : "rounds"}.`
        : ""
    }`,
    restSeconds: Math.max(
      0,
      Math.min(900, Number(ex.restSeconds ?? ex.rest ?? 60) || 60),
    ),
    sets: ex.sets,
    reps: ex.reps,
  }));
  return {
    workout,
    segments,
    premium: access.premiumVoice,
  };
}
function voicePublic(r: any) {
  return r
    ? {
        id: r.id,
        status: r.status,
        version: r.version,
        provider: r.provider,
        cloneId: r.clone_id ?? null,
        providerVoiceId: r.provider_voice_id,
        consentVersion: r.consent_version,
        evidence: r.evidence,
        verifiedAt: r.verified_at,
        hasSample: r.has_sample,
      }
    : null;
}
function decodeAudio(base64: string, type: string) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length > 8388608)
    throw fail(400, "VOICE_SAMPLE", "Upload an MP3 or WAV sample under 6 MB.");
  const b = Buffer.from(base64, "base64");
  if (
    !b.length ||
    b.length > 6291456 ||
    b.toString("base64") !== base64 ||
    !(type === "audio/wav"
      ? b.toString("ascii", 0, 4) === "RIFF" &&
        b.toString("ascii", 8, 12) === "WAVE"
      : b.toString("ascii", 0, 3) === "ID3" ||
        (b[0] === 0xff && (b[1] & 0xe0) === 0xe0))
  )
    throw fail(
      400,
      "VOICE_SAMPLE",
      "The audio contents do not match the selected format.",
    );
  return b;
}
function registerVoiceRoutes(app: FastifyInstance, db: Database) {
  app.get("/api/v1/voice/profile", async (req) => {
    const a = owner(req);
    return db.tenant(a, async (tx) => {
      const [r] = await tx.query(
        "SELECT *,sample IS NOT NULL AS has_sample FROM trainer_voices",
      );
      return voicePublic(r);
    });
  });
  app.post("/api/v1/voice/profile", { bodyLimit: 9000000 }, async (req) => {
    const a = owner(req),
      b = z
        .object({
          revision: z.number().int().min(0),
          consent: z.literal(true),
          rights: z.literal(true),
          providerVoiceId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
          statement: z.string().min(20).max(2000),
          voiceKind: z.enum(["instant", "professional"]).default("instant"),
          creatorVerified: z.boolean().default(false),
          sample: z
            .object({
              base64: z.string(),
              type: z.enum(["audio/mpeg", "audio/wav"]),
            })
            .optional(),
        })
        .parse(req.body),
      sample = b.sample ? decodeAudio(b.sample.base64, b.sample.type) : null;
    // With Cartesia the trainer's voice is cloned in the app (voice-clones.ts);
    // a pasted provider ID could name another workspace's clone.
    if (runtimeConfig().VOICE_PROVIDER === "cartesia")
      throw fail(
        409,
        "VOICE_CLONE_REQUIRED",
        "Record your voice below to make your trainer voice.",
      );
    const consentVersion =
      (await legalAcceptanceVersion(db, "voice")) + "|trainer-voice:v1";
    if (b.voiceKind === "professional" && !b.creatorVerified)
      throw fail(
        400,
        "VOICE_CREATOR_REQUIRED",
        "A professional voice must be created and identity-verified by the trainer in their own provider account, then shared for this use.",
      );
    return db.tenant(a, async (tx) => {
      await lock(tx, a, "voice");
      const [prior] = await tx.query("SELECT * FROM trainer_voices FOR UPDATE");
      if (Number(prior?.version ?? 0) !== b.revision) throw conflict();
      await consent(tx, a, "voice", true, consentVersion);
      const evidence = {
        rightsStatement: b.statement,
        ownerConfirmed: true,
        voiceKind: b.voiceKind,
        creatorVerified: b.creatorVerified,
        submittedAt: new Date().toISOString(),
        purpose:
          "Assigned workout guidance only; no advertising use or automatic cloning.",
      };
      const [r] = await tx.query(
        "INSERT INTO trainer_voices(id,tenant_id,user_id,status,provider,provider_voice_id,evidence,consent_version,sample,sample_type) VALUES($1,$2,$3,'pending','elevenlabs',$4,$5,'trainer-voice-v1',$6,$7) ON CONFLICT(tenant_id) DO UPDATE SET user_id=EXCLUDED.user_id,status='pending',provider='elevenlabs',provider_voice_id=EXCLUDED.provider_voice_id,clone_id=NULL,model=NULL,language=NULL,evidence=EXCLUDED.evidence,consent_version=EXCLUDED.consent_version,sample=EXCLUDED.sample,sample_type=EXCLUDED.sample_type,verified_by=NULL,verified_at=NULL,version=trainer_voices.version+1,updated_at=now() RETURNING *",
        [
          prior?.id ?? randomUUID(),
          a.tenantId,
          a.userId,
          b.providerVoiceId,
          JSON.stringify(evidence),
          sample,
          b.sample?.type ?? null,
        ],
      );
      await tx.query(
        "UPDATE guided_audio SET status='revoked',audio=NULL WHERE voice_id=$1",
        [r.id],
      );
      // A new enrollment version replaces every clip made with the old one.
      await tx.query(
        "UPDATE voice_session_clips SET status='revoked',audio=NULL,updated_at=now() WHERE voice_id=$1 AND status<>'revoked'",
        [r.id],
      );
      await tx.query(
        "UPDATE voice_sessions SET mode='text',audio_status='revoked',unavailable_reason='VOICE_UNAVAILABLE',version=version+1,updated_at=now() WHERE voice_id=$1 AND audio_status<>'revoked'",
        [r.id],
      );
      // A clone in use steps back to ready: the linked voice replaces it.
      await tx.query(
        "UPDATE trainer_voice_clones SET status='ready',version=version+1,updated_at=now() WHERE status='active'",
      );
      await event(tx, a, "voice.enrollment_requested", r.id);
      return voicePublic(r);
    });
  });
  app.post("/api/v1/voice/revoke", async (req) => {
    const a = owner(req);
    return db.tenant(a, async (tx) => {
      await lock(tx, a, "voice");
      // A voice ID linked by hand lives in the trainer's own provider account;
      // clones made in the app are deleted at the provider by the app.
      const [linked] = await tx.query(
        "SELECT provider FROM trainer_voices WHERE user_id=$1 AND clone_id IS NULL AND provider_voice_id IS NOT NULL",
        [a.userId],
      );
      await consent(tx, a, "voice", false);
      await disableUserIntegrations(tx, a.userId, "voice");
      await event(tx, a, "voice.revoked");
      return {
        ok: true,
        message: linked
          ? "Voice generation and stored playback stopped. Remove the voice in the provider account to revoke the provider-side clone."
          : "Voice generation and stored playback stopped. Voice clones made here are deleted, and their copies at the voice provider are being deleted.",
      };
    });
  });
  app.get("/api/v1/admin/integrations/voices", async (req) => {
    const operator = admin(req);
    return scopedAdminRows(
      db,
      operator,
      "trainer_voices",
      undefined,
      z
        .string()
        .uuid()
        .optional()
        .parse((req.query as any).tenantId),
    );
  });
  app.get(
    "/api/v1/admin/integrations/voices/:id/sample",
    async (req, reply) => {
      const operator = admin(req);
      const [r] = await scopedAdminRows(
        db,
        operator,
        "trainer_voices",
        id.parse((req.params as any).id),
        undefined,
        true,
      );
      if (!r?.sample)
        throw fail(404, "VOICE_SAMPLE", "No verification sample is stored.");
      reply.header("Cache-Control", "no-store").type(r.sample_type);
      return Buffer.from(r.sample);
    },
  );
  app.post("/api/v1/admin/integrations/voices/:id/verify", async (req) => {
    const operator = admin(req),
      b = z
        .object({
          revision: z.number().int().positive(),
          ownerIdentityVerified: z.literal(true),
          providerRightsVerified: z.literal(true),
          evidence: z.string().min(20).max(2000),
        })
        .parse(req.body);
    voiceContract();
    const [row] = await scopedAdminRows(
      db,
      operator,
      "trainer_voices",
      id.parse((req.params as any).id),
    );
    if (!row)
      throw fail(404, "VOICE_NOT_FOUND", "Voice enrollment was not found.");
    return db.tenant(
      elevated("platform-operator", {
        tenantId: row.tenant_id,
        userId: operator.userId,
        role: "owner",
      }),
      async (tx) => {
        const [r] = await tx.query(
          "UPDATE trainer_voices SET status='verified',verified_by=$3,verified_at=now(),evidence=evidence||$4::jsonb,version=version+1,updated_at=now() WHERE id=$1 AND version=$2 AND status='pending' RETURNING *",
          [
            row.id,
            b.revision,
            operator.userId,
            JSON.stringify({
              verification: b.evidence,
              identityVerified: true,
              providerRightsVerified: true,
            }),
          ],
        );
        if (!r) throw conflict();
        await event(
          tx,
          { ...operator, tenantId: row.tenant_id },
          "voice.verified",
          row.id,
        );
        return voicePublic(r);
      },
    );
  });
  app.get("/api/v1/guided/:workoutId", async (req) => {
    const a = identity(req);
    return db.tenant(internal(a), async (tx) => {
      const m = await guidedMaterial(
        tx,
        a,
        id.parse((req.params as any).workoutId),
      );
      const [voice] = await tx.query(
        "SELECT id,version,provider FROM guided_voice()",
      );
      let available = false;
      try {
        // The voice must be held by the provider now configured.
        available = voiceContract().provider === voice?.provider;
      } catch {}
      return {
        workoutId: m.workout.id,
        // Programs are titled (trainingProgramSchema.title), not named.
        name: m.workout.data.program?.title ?? "Workout",
        segments: m.segments,
        premium: m.premium,
        audioAvailable: available && !!voice && m.premium,
        warning:
          "Stop if you experience pain or dizziness. Written guidance remains available without voice.",
      };
    });
  });
  app.post("/api/v1/guided/:workoutId/audio", async (req) => {
    const a = identity(req),
      workoutId = id.parse((req.params as any).workoutId),
      b = z
        .object({
          segment: z.number().int().min(0).max(100),
          consent: z.literal(true),
        })
        .parse(req.body),
      pricing = voiceContract();
    const consentVersion =
      (await legalAcceptanceVersion(db, "voice")) + "|voice-playback:v1";
    const reservation = await db.tenant(internal(a), async (tx) => {
      const m = await guidedMaterial(tx, a, workoutId);
      if (!m.premium)
        throw fail(
          402,
          "VOICE_MEMBERSHIP",
          "Your membership does not include premium trainer voice.",
        );
      const segment = m.segments[b.segment];
      if (!segment || segment.text.length > 3000)
        throw fail(
          400,
          "GUIDANCE_SEGMENT",
          "This guided segment is not available.",
        );
      // The verified voice's playback facts only (no sample), with the
      // trainer's current voice consent (guided_voice(), migration 061).
      const [voice] = await tx.query(
        "SELECT id,version,provider_voice_id,consented,provider,model,language FROM guided_voice()",
      );
      if (!voice || !voice.consented || voice.provider !== pricing.provider)
        throw fail(
          409,
          "VOICE_UNAVAILABLE",
          "Trainer voice is awaiting verification or permission.",
        );
      await consent(tx, a, "voice_playback", true, consentVersion);
      const language = guidedSegmentLanguage(segment);
      const fingerprint = guidedAudioFingerprint(
        workoutId,
        voice as { id: string; version: number; provider: string },
        segment.text,
        voice.model ?? pricing.model,
        pricing.priceVersion,
        language,
      );
      const [existing] = await tx.query(
        "SELECT id,status,data FROM guided_audio WHERE user_id=$1 AND fingerprint=$2",
        [a.userId, fingerprint],
      );
      if (existing) return { existing };
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        a.tenantId + ":voice-budget",
      ]);
      const [spent] = await tx.query(
        "SELECT voice_guidance_spent_today() AS total",
      );
      const estimatedCost = (segment.text.length * pricing.price) / 1000;
      if (Number(spent.total) + estimatedCost > pricing.cap)
        throw fail(
          429,
          "VOICE_BUDGET",
          "The workspace voice limit has been reached. Written guidance remains available.",
        );
      const usageId = randomUUID(),
        audioId = randomUUID();
      await reserveVoiceCost(tx, {
        id: usageId,
        tenantId: a.tenantId,
        userId: a.userId,
        memberId: a.userId,
        task: "voice.guidance",
        provider: pricing.provider,
        model: voice.model ?? pricing.model,
        priceVersion: pricing.priceVersion,
        pricing: {
          basis: "characters",
          characters: segment.text.length,
          usdPer1000Characters: pricing.price,
          reservedCostUsd: estimatedCost,
        },
        traceId: audioId,
      });
      await tx.query(
        "INSERT INTO guided_audio(id,tenant_id,user_id,workout_id,voice_id,voice_version,fingerprint,status,text_content,usage_id) VALUES($1,$2,$3,$4,$5,$6,$7,'reserved',$8,$9)",
        [
          audioId,
          a.tenantId,
          a.userId,
          workoutId,
          voice.id,
          voice.version,
          fingerprint,
          segment.text,
          usageId,
        ],
      );
      return { id: audioId, voice, text: segment.text, language, usageId };
    });
    if (reservation.existing)
      return {
        ...reservation.existing,
        audioUrl:
          reservation.existing.status === "ready"
            ? `/api/v1/guided/audio/${reservation.existing.id}`
            : null,
        message:
          reservation.existing.status === "unknown"
            ? "Provider outcome is awaiting reconciliation. Use written guidance."
            : undefined,
      };
    try {
      const audio = await generateTrainerVoice(
        reservation.voice.provider_voice_id,
        reservation.text!,
        async () => {
          await db.tenant(internal(a), async (tx) => {
            await guidedMaterial(tx, a, workoutId);
            const [voice] = await tx.query(
              "SELECT id FROM guided_voice() WHERE id=$1 AND version=$2 AND consented",
              [reservation.voice.id, reservation.voice.version],
            );
            if (!voice)
              throw fail(
                409,
                "VOICE_REVOKED",
                "Trainer voice permission changed.",
              );
            const [r] = await tx.query(
              "UPDATE guided_audio SET status='unknown' WHERE id=$1 AND status='reserved' RETURNING id",
              [reservation.id],
            );
            if (!r) throw conflict();
            await tx.query(
              "UPDATE cost_events SET status='unknown' WHERE id=$1 AND status='reserved'",
              [reservation.usageId],
            );
          });
        },
        {
          provider: reservation.voice.provider,
          model: reservation.voice.model,
          language: reservation.voice.language,
          // The fingerprint's language (`guidedSegmentLanguage`).
          textLanguage: reservation.language,
        },
      );
      return await db.tenant(internal(a), async (tx) => {
        const [voice] = await tx.query(
          "SELECT id FROM guided_voice() WHERE id=$1 AND version=$2",
          [reservation.voice.id, reservation.voice.version],
        );
        const [r] = await tx.query(
          "UPDATE guided_audio SET status=CASE WHEN $2 THEN 'ready' ELSE 'revoked' END,audio=CASE WHEN $2 THEN $3::bytea ELSE NULL END,data=$4 WHERE id=$1 AND status='unknown' RETURNING id,status",
          [
            reservation.id,
            !!voice,
            audio.audio,
            JSON.stringify({
              providerRequestId: audio.requestId,
              estimatedCostUsd: audio.estimatedCost,
              reconciliation:
                "Priced at its estimate when made; the provider invoice can correct it.",
            }),
          ],
        );
        // Delivered audio is priced now at the reserved estimate ('estimated'),
        // so it never blocks the usage charge, month close or payouts; the
        // provider invoice can still correct it (docs/features/platform-finance.md).
        await costEstimated(tx, reservation.usageId, {
          providerRequestId: audio.requestId,
        });
        await event(tx, a, "voice.guidance_generated", reservation.id, {
          workoutId,
          estimatedCostUsd: audio.estimatedCost,
        });
        return {
          id: reservation.id,
          status: r?.status ?? "revoked",
          audioUrl:
            r?.status === "ready"
              ? `/api/v1/guided/audio/${reservation.id}`
              : null,
        };
      });
    } catch {
      // A call still reserved was never sent (the send step marks it
      // 'unknown' first): it costs nothing.
      await db.tenant(internal(a), async (tx) => {
        await tx.query(
          "UPDATE guided_audio SET status='unknown' WHERE id=$1 AND status='reserved'",
          [reservation.id],
        );
        await costNotSent(tx, reservation.usageId);
      });
      return {
        id: reservation.id,
        status: "unknown",
        audioUrl: null,
        message:
          "Audio could not be confirmed. Written guidance remains available; this request will not be sent again automatically.",
      };
    }
  });
  app.get("/api/v1/guided/audio/:id", async (req, reply) => {
    const a = identity(req);
    const audio = await db.tenant(internal(a), async (tx) => {
      const [r] = await tx.query(
        "SELECT g.* FROM guided_audio g JOIN guided_voice() v ON v.id=g.voice_id AND v.version=g.voice_version WHERE g.id=$1 AND g.user_id=$2 AND g.status='ready'",
        [id.parse((req.params as any).id), a.userId],
      );
      if (!r?.audio)
        throw fail(
          404,
          "AUDIO_UNAVAILABLE",
          "This voice recording is no longer available.",
        );
      await guidedMaterial(tx, a, r.workout_id);
      return Buffer.from(r.audio);
    });
    reply.header("Cache-Control", "private,no-store").type("audio/mpeg");
    return audio;
  });
}

export function normalizeDomain(value: string) {
  const hostname = domainToASCII(value.trim().toLowerCase().replace(/\.$/, ""));
  if (
    hostname.length > 253 ||
    !/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(
      hostname,
    ) ||
    /\.(localhost|local|internal|invalid|test)$/.test(hostname)
  )
    throw fail(
      400,
      "DOMAIN_NAME",
      "Enter a public domain name without a protocol, path or port.",
    );
  const root = platformRoot();
  if (
    hostname ===
      new URL(runtimeConfig().PUBLIC_APP_URL ?? "http://localhost:3000")
        .hostname ||
    (root && (hostname === root || hostname.endsWith("." + root)))
  )
    throw fail(
      400,
      "DOMAIN_NAME",
      "The platform address cannot be assigned to a trainer.",
    );
  return hostname;
}
function domainEnabled() {
  if (runtimeConfig().DOMAIN_OPERATIONS_ENABLED !== "true")
    throw fail(
      409,
      "DOMAIN_DISABLED",
      "Custom-domain operations require platform administrator setup.",
    );
}
async function domainActor(db: Database, operator: Identity, orderId: string) {
  const [row] = await scopedAdminRows(db, operator, "domain_orders", orderId);
  if (!row)
    throw fail(404, "DOMAIN_NOT_FOUND", "Domain request was not found.");
  return {
    row,
    a: {
      ...operator,
      ...elevated("platform-operator", {
        tenantId: row.tenant_id,
        userId: operator.userId,
        role: "owner",
      }),
    },
  };
}
async function dnsProof(
  hostname: string,
  token: string,
  resolver: typeof resolveTxt,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const answers = await Promise.race([
      resolver("_trainer-verify." + hostname),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), 5000);
      }),
    ]);
    if (
      !answers.some(
        (parts) => parts.join("") === "trainer-verification=" + token,
      )
    )
      throw new Error("no proof");
  } catch {
    throw fail(
      409,
      "DOMAIN_DNS",
      "The expected ownership TXT record is not visible yet. Check DNS and retry.",
    );
  } finally {
    clearTimeout(timer);
  }
}
/**
 * A manual domain order as its trainer sees it: the status, the exact price
 * quote and the verification token. Operator evidence (registrar and payment
 * references, the quote's provider reference) never reaches a trainer.
 */
export function trainerDomainView(row: Record<string, any>) {
  const q = row.quote;
  return {
    id: row.id,
    hostname: row.hostname,
    status: row.status,
    token: row.token,
    version: row.version,
    alreadyOwned: row.evidence?.alreadyOwned === true,
    includeWww: row.evidence?.includeWww === true,
    health: row.evidence?.websiteHealth ?? null,
    quote: q
      ? {
          amountMinor: q.amountMinor,
          renewalMinor: q.renewalMinor,
          currency: q.currency,
          termMonths: q.termMonths,
          expiresAt: q.expiresAt,
        }
      : null,
    verified_at: row.verified_at ?? null,
    expires_at: row.expires_at ?? null,
    reservationExpiresAt: row.reservation_expires_at ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
async function activateManualDomain(
  db: Database,
  a: Actor,
  row: Record<string, any>,
  deps: Deps,
  evidence: Record<string, unknown> = {},
  expiresAt: string | null = null,
) {
  await dnsProof(row.hostname, row.token, txtLookup(deps));
  const names = row.evidence?.includeWww
    ? [row.hostname, "www." + row.hostname]
    : [row.hostname];
  for (const hostname of names) {
    const target = runtimeConfig()
      .DOMAIN_CNAME_TARGET?.toLowerCase()
      .replace(/\.$/, "");
    const cnames = await cnameLookup(deps)(hostname).catch(() => []);
    if (
      !target ||
      !cnames.some((n) => n.toLowerCase().replace(/\.$/, "") === target)
    )
      await checkAddressDns(db, hostname, deps).catch(() => {
        throw fail(
          409,
          "DOMAIN_TARGET",
          "Add the A or CNAME records shown in Web address, remove conflicting AAAA records, then retry.",
        );
      });
    await permitCertificateIssuance(db, {
      hostname,
      tenantId: a.tenantId,
      orderId: row.id,
      actorId: a.userId,
    });
    if (deps.httpsCheck) await deps.httpsCheck(hostname);
    else {
      const { addresses } = await validatePublicEndpoint(
        "https://" + hostname + "/",
      );
      await httpsProbe(hostname, addresses[0]);
    }
  }
  await db.system(async (tx) => {
    for (const hostname of [...names].sort()) {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        "domain:" + hostname,
      ]);
      const [other] = await tx.query(
        "SELECT tenant_id FROM domain_mappings WHERE hostname=$1 AND active=true AND tenant_id<>$2",
        [hostname, a.tenantId],
      );
      if (other)
        throw fail(
          409,
          "DOMAIN_IN_USE",
          "This domain is connected elsewhere. Contact support with ownership proof.",
        );
    }
    await tx.tenant(a, async (scoped) => {
      const [saved] = await scoped.query(
        "UPDATE domain_orders SET status='active',expires_at=$3,reservation_expires_at=NULL,evidence=evidence||$4::jsonb,version=version+1,updated_at=now() WHERE id=$1 AND version=$2 AND status='verified' AND (reservation_expires_at IS NULL OR reservation_expires_at>now()) RETURNING id",
        [row.id, row.version, expiresAt, JSON.stringify(evidence)],
      );
      if (!saved) throw conflict();
      await scoped.query(
        "DELETE FROM records WHERE kind='web_address_health' AND data->>'hostname'=ANY($1::text[])",
        [names],
      );
      await event(scoped, a, "domain.activated", row.id);
    });
    for (const hostname of names)
      await tx.query(
        "INSERT INTO domain_mappings(hostname,tenant_id,verified_at,active,redirect) VALUES($1,$2,now(),true,$3) ON CONFLICT(hostname) DO UPDATE SET tenant_id=EXCLUDED.tenant_id,verified_at=now(),active=true,redirect=EXCLUDED.redirect",
        [hostname, a.tenantId, hostname === row.hostname ? null : "apex"],
      );
  });
  await checkTenantAddresses(db, a.tenantId, deps);
  const [saved] = await db.tenant(a, (tx) =>
    tx.query("SELECT * FROM domain_orders WHERE id=$1", [row.id]),
  );
  return saved;
}
function registerDomainRoutes(
  app: FastifyInstance,
  db: Database,
  dependencies: Deps,
) {
  app.get("/api/v1/domains", async (req) => {
    const a = owner(req);
    const rows = await db.tenant(a, (tx) =>
      tx.query(
        "SELECT * FROM domain_orders WHERE mode='manual' ORDER BY created_at DESC",
      ),
    );
    return rows.map(trainerDomainView);
  });
  app.post(
    "/api/v1/domains",
    { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } },
    async (req) => {
      const a = owner(req);
      domainEnabled();
      const b = z
          .object({
            hostname: z.string().max(253),
            alreadyOwned: z.boolean(),
            includeWww: z.boolean().default(false),
          })
          .parse(req.body),
        hostname = normalizeDomain(b.hostname);
      return db.tenant(a, async (tx) => {
        await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          "domain:" + hostname,
        ]);
        const [row] = await tx.query(
          "INSERT INTO domain_orders(id,tenant_id,hostname,status,token,evidence,reservation_expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '7 days') ON CONFLICT DO NOTHING RETURNING *",
          [
            randomUUID(),
            a.tenantId,
            hostname,
            b.alreadyOwned ? "owned" : "requested",
            newToken(),
            JSON.stringify({
              alreadyOwned: b.alreadyOwned,
              includeWww: b.includeWww,
            }),
          ],
        );
        if (!row)
          throw fail(
            409,
            "DOMAIN_IN_USE",
            "This domain already has an active connection request.",
          );
        await event(tx, a, "domain.requested", row.id, { hostname });
        return trainerDomainView(row);
      });
    },
  );
  app.post("/api/v1/domains/:id/approve", async (req) => {
    const a = owner(req);
    requireRecentMfa(a);
    domainEnabled();
    const b = z
      .object({
        revision: z.number().int().positive(),
        amountMinor: z.number().int().nonnegative(),
        currency: z.enum(["AED", "USD"]),
        accepted: z.literal(true),
      })
      .parse(req.body);
    return db.tenant(a, async (tx) => {
      const [row] = await tx.query(
        "SELECT * FROM domain_orders WHERE id=$1 AND mode='manual' FOR UPDATE",
        [id.parse((req.params as any).id)],
      );
      if (
        !row ||
        row.status !== "quoted" ||
        Number(row.version) !== b.revision ||
        row.quote?.amountMinor !== b.amountMinor ||
        row.quote?.currency !== b.currency ||
        Date.parse(row.quote?.expiresAt ?? "") <= Date.now()
      )
        throw conflict();
      const [updated] = await tx.query(
        "UPDATE domain_orders SET status='approved',version=version+1,evidence=evidence||$2::jsonb,updated_at=now() WHERE id=$1 RETURNING *",
        [
          row.id,
          JSON.stringify({
            approvedBy: a.userId,
            approvedAt: new Date().toISOString(),
          }),
        ],
      );
      await event(tx, a, "domain.quote_approved", row.id, {
        amountMinor: b.amountMinor,
        currency: b.currency,
      });
      return trainerDomainView(updated);
    });
  });
  app.post("/api/v1/domains/:id/verify", async (req) => {
    const a = owner(req);
    const b = z
      .object({ revision: z.number().int().positive() })
      .parse(req.body);
    const [row] = await db.tenant(a, (tx) =>
      tx.query(
        "SELECT * FROM domain_orders WHERE id=$1 AND mode='manual' AND status IN ('owned','verified') AND version=$2 AND (reservation_expires_at IS NULL OR reservation_expires_at>now())",
        [id.parse((req.params as any).id), b.revision],
      ),
    );
    if (!row) throw conflict();
    await dnsProof(row.hostname, row.token, txtLookup(dependencies));
    return db
      .tenant(a, async (tx) => {
        const [r] = await tx.query(
          "UPDATE domain_orders SET status='verified',verified_at=now(),version=version+1,updated_at=now() WHERE id=$1 AND version=$2 RETURNING *",
          [row.id, b.revision],
        );
        if (!r) throw conflict();
        await event(tx, a, "domain.ownership_verified", row.id);
        return trainerDomainView(r);
      })
      .catch((error) => {
        if (error.code === "23505")
          throw fail(
            409,
            "DOMAIN_IN_USE",
            "This domain is already verified elsewhere. Contact support with ownership proof.",
          );
        throw error;
      });
  });
  app.post(
    "/api/v1/domains/:id/connect",
    { config: { rateLimit: { max: 6, timeWindow: "10 minutes" } } },
    async (req) => {
      const a = owner(req);
      requireRecentMfa(a);
      domainEnabled();
      const b = z
        .object({ revision: z.number().int().positive() })
        .parse(req.body);
      const [row] = await db.tenant(a, (tx) =>
        tx.query(
          "SELECT * FROM domain_orders WHERE id=$1 AND mode='manual' AND status='verified' AND version=$2",
          [id.parse((req.params as any).id), b.revision],
        ),
      );
      if (!row) throw conflict();
      return trainerDomainView(
        await activateManualDomain(
          db,
          a,
          row,
          dependencies,
          {},
          row.expires_at,
        ),
      );
    },
  );
  app.post("/api/v1/domains/:id/cancel", async (req) => {
    const a = owner(req),
      b = z.object({ revision: z.number().int().positive() }).parse(req.body);
    return db.tenant(a, async (tx) => {
      const [r] = await tx.query(
        "UPDATE domain_orders SET status='cancelled',version=version+1,updated_at=now() WHERE id=$1 AND version=$2 AND mode='manual' AND status NOT IN ('cancelled','expired') RETURNING *",
        [id.parse((req.params as any).id), b.revision],
      );
      if (!r) throw conflict();
      await tx.query(
        "UPDATE domain_mappings SET active=false WHERE hostname=ANY($1::text[]) AND tenant_id=$2",
        [
          r.evidence?.includeWww
            ? [r.hostname, "www." + r.hostname]
            : [r.hostname],
          a.tenantId,
        ],
      );
      await event(tx, a, "domain.disconnected", r.id);
      return trainerDomainView(r);
    });
  });
  app.get("/api/v1/admin/integrations/domains", async (req) => {
    const operator = admin(req);
    return scopedAdminRows(
      db,
      operator,
      "domain_orders",
      undefined,
      z
        .string()
        .uuid()
        .optional()
        .parse((req.query as any).tenantId),
    );
  });
  app.post("/api/v1/admin/integrations/domains/:id/quote", async (req) => {
    const operator = admin(req);
    domainEnabled();
    const b = z
      .object({
        revision: z.number().int().positive(),
        amountMinor: z.number().int().min(0).max(1000000),
        currency: z.enum(["AED", "USD"]),
        expiresAt: z.iso.datetime(),
        renewalMinor: z.number().int().nonnegative(),
        termMonths: z.number().int().min(1).max(120),
        providerReference: z.string().min(3).max(300),
      })
      .parse(req.body);
    if (
      Date.parse(b.expiresAt) <= Date.now() ||
      Date.parse(b.expiresAt) > Date.now() + 30 * 86400000
    )
      throw fail(400, "DOMAIN_QUOTE", "The quote must expire within 30 days.");
    const { row, a } = await domainActor(
      db,
      operator,
      id.parse((req.params as any).id),
    );
    return db.tenant(a, async (tx) => {
      const [r] = await tx.query(
        "UPDATE domain_orders SET status='quoted',quote=$3,version=version+1,updated_at=now() WHERE id=$1 AND version=$2 AND status IN ('requested','quoted') RETURNING *",
        [row.id, b.revision, JSON.stringify(b)],
      );
      if (!r) throw conflict();
      await event(tx, a, "domain.quoted", row.id, {
        amountMinor: b.amountMinor,
        currency: b.currency,
      });
      return r;
    });
  });
  app.post("/api/v1/admin/integrations/domains/:id/ownership", async (req) => {
    const operator = admin(req),
      b = z
        .object({
          revision: z.number().int().positive(),
          registrarReference: z.string().min(3).max(300),
          paymentEvidence: z.string().min(10).max(1000),
          expiresAt: z.iso.datetime(),
        })
        .parse(req.body);
    if (Date.parse(b.expiresAt) <= Date.now())
      throw fail(
        400,
        "DOMAIN_EXPIRY",
        "Domain ownership must remain valid in the future.",
      );
    const { row, a } = await domainActor(
      db,
      operator,
      id.parse((req.params as any).id),
    );
    return db.tenant(a, async (tx) => {
      const [r] = await tx.query(
        "UPDATE domain_orders SET status='owned',reservation_expires_at=NULL,evidence=evidence||$3::jsonb,expires_at=$4,version=version+1,updated_at=now() WHERE id=$1 AND version=$2 AND status='approved' RETURNING *",
        [
          row.id,
          b.revision,
          JSON.stringify({
            registrarReference: b.registrarReference,
            paymentEvidence: b.paymentEvidence,
            reconciledBy: operator.userId,
          }),
          b.expiresAt,
        ],
      );
      if (!r) throw conflict();
      await event(tx, a, "domain.registration_reconciled", row.id);
      return r;
    });
  });
  app.post("/api/v1/admin/integrations/domains/:id/activate", async (req) => {
    const operator = admin(req);
    domainEnabled();
    const b = z
      .object({
        revision: z.number().int().positive(),
        dnsTarget: z.string().min(3).max(253),
        registrarReference: z.string().min(3).max(300),
        expiresAt: z.iso.datetime(),
      })
      .parse(req.body);
    const { row, a } = await domainActor(
      db,
      operator,
      id.parse((req.params as any).id),
    );
    if (
      row.status !== "verified" ||
      Number(row.version) !== b.revision ||
      Date.parse(b.expiresAt) <= Date.now()
    )
      throw conflict();
    return activateManualDomain(
      db,
      a,
      row,
      dependencies,
      {
        dnsTarget: b.dnsTarget,
        registrarReference: b.registrarReference,
        reconciledBy: operator.userId,
      },
      b.expiresAt,
    );
  });

  app.post("/api/v1/admin/integrations/domains/:id/renew", async (req) => {
    const operator = admin(req),
      b = z
        .object({
          revision: z.number().int().positive(),
          expiresAt: z.iso.datetime(),
          evidence: z.string().min(20).max(1000),
        })
        .parse(req.body);
    const { row, a } = await domainActor(
      db,
      operator,
      id.parse((req.params as any).id),
    );
    if (
      Date.parse(b.expiresAt) <=
      Math.max(Date.now(), Date.parse(row.expires_at ?? 0))
    )
      throw fail(
        400,
        "DOMAIN_EXPIRY",
        "Renewal must extend the current expiration.",
      );
    return db.tenant(a, async (tx) => {
      const [r] = await tx.query(
        "UPDATE domain_orders SET expires_at=$3,status=CASE WHEN status='expired' THEN 'owned' ELSE status END,version=version+1,evidence=evidence||$4::jsonb,updated_at=now() WHERE id=$1 AND version=$2 AND status IN ('active','expired') RETURNING *",
        [
          row.id,
          b.revision,
          b.expiresAt,
          JSON.stringify({
            renewalEvidence: b.evidence,
            renewedBy: operator.userId,
          }),
        ],
      );
      if (!r) throw conflict();
      await event(tx, a, "domain.renewal_reconciled", row.id);
      return r;
    });
  });
}
