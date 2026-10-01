/**
 * Model profiles in Super admin (docs/features/model-profiles.md): saved
 * model connections side by side, one active and one fallback, and the switch
 * procedure: add or edit a profile, enter its key, test the connection, run
 * the switch check (a worker job that stores its report), activate with one
 * click, switch back with one click. On activation every workspace's Brain is
 * re-checked on the new model in the background (brain-check.ts, trigger
 * model_switch): coaches whose check passes keep sending automatically,
 * the others wait for them and are told.
 *
 * The active profile reaches every request through loadRuntimeSettings
 * (platform-settings.ts, modelProfileOverrides below). Keys are sealed in the
 * profile's encrypted_secrets and never returned. Labels are what coaches see;
 * model IDs stay in Super admin.
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { elevated, SYSTEM_USER_ID, type Actor, type Database, type Tx } from "@trainer/db";
import { z } from "zod";
import {
  providerRequest,
  withRuntimeConfig,
} from "../../../packages/providers/src/configuration.ts";
import { MODEL_PROFILE_KEYS } from "../../../packages/providers/src/model-request.ts";
import {
  INHERITED_KEYS,
  modelProfileInputSchema,
  modelProfileSettingsSchema,
  profileRuntimeKeys,
} from "../../../packages/providers/src/model-profiles.ts";
import { ANTHROPIC_VERSION } from "../../../packages/providers/src/anthropic-messages.ts";
import { sealContexts, sealValue } from "./sealing.ts";
import {
  checkPassedFor,
  fingerprint,
  KEY_FIELD,
  latestChecks,
  openKey,
  tested,
  type Row,
} from "./model-profile-overrides.ts";
import { storedIntegrationValues } from "./platform-settings.ts";
import { requireRecentMfa } from "./security.ts";
import { MODEL_SWITCH_TRIGGER, requestBrainCheck } from "./brain-check.ts";
import {
  DEFAULT_TOLERANCE,
  runSwitchCheck,
  type SwitchCheckReport,
} from "../../../scripts/model-switch-check/check.ts";

type AdminIdentity = Actor & { platformRole: string; mfaAt?: string | null };
const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
/** A switch check left running this long is claimed again. */
const CHECK_LEASE_MINUTES = 20;

async function audit(tx: Tx, profileId: string, action: string, actorId: string, detail: Record<string, unknown> = {}) {
  await tx.query(
    "INSERT INTO model_profile_audit(id,profile_id,action,actor_id,detail) VALUES($1,$2,$3,$4,$5)",
    [randomUUID(), profileId, action, actorId, JSON.stringify(detail)],
  );
}

/**
 * Asks every active workspace for a background Brain re-check on the newly
 * active model (brain-check.ts; workspaces whose Brain is not live skip it).
 */
async function requestSwitchRechecks(db: Database, actor: AdminIdentity) {
  const tenants = await db.system((tx) =>
    tx.query<{ id: string }>("SELECT id FROM tenants WHERE lifecycle_state='active' ORDER BY id"),
  );
  for (const t of tenants) {
    const a = {
      ...actor,
      ...elevated("platform-operator", { tenantId: t.id, userId: actor.userId, role: "owner" }),
    };
    await db.tenant(a, (tx) => requestBrainCheck(tx, a, MODEL_SWITCH_TRIGGER, 30));
  }
  return tenants.length;
}

/** The connection test: a read-only model list request, never a generation. */
async function connectionTest(row: Row, key: string) {
  const s = modelProfileSettingsSchema.parse({ ...row.settings });
  const checkedAt = new Date().toISOString();
  if (!s.baseUrl || !s.model)
    return { status: "failed", message: "Add the API address and model ID first.", checkedAt };
  const native = row.adapter === "anthropic";
  let response: Response;
  try {
    response = await providerRequest(s.baseUrl.replace(/\/$/, "") + "/models", {
      headers: native
        ? { "x-api-key": key, "anthropic-version": ANTHROPIC_VERSION }
        : { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return { status: "failed", message: "The provider could not be reached.", checkedAt };
  }
  if (!response.ok)
    return {
      status: "failed",
      message: `Model-list access was rejected (HTTP ${response.status}). Check the address and key.`,
      checkedAt,
    };
  const payload = (await response.json().catch(() => null)) as any;
  const listed =
    Array.isArray(payload?.data) && payload.data.some((m: any) => m?.id === s.model);
  return listed
    ? {
        status: "verified",
        message: "Access and model verified without generating content. Run the switch check before activating.",
        checkedAt,
      }
    : { status: "failed", message: "The model ID was not in the provider's model list.", checkedAt };
}

/** A profile as Super admin sees it: real model IDs, never the key. */
function view(row: Row, check: any, base: Record<string, string | undefined>) {
  const s = modelProfileSettingsSchema.parse({ ...row.settings });
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    label: row.label,
    tier: row.tier,
    adapter: row.inherit_settings ? "openai_compatible" : row.adapter,
    role: row.role,
    inheritSettings: row.inherit_settings,
    revision: row.revision,
    settings: s,
    effective: row.inherit_settings
      ? { baseUrl: base.MODEL_BASE_URL || null, model: base.MODEL_NAME || null, source: "AI model settings" }
      : { baseUrl: s.baseUrl ?? null, model: s.model ?? null, source: "profile" },
    key: row.inherit_settings
      ? "settings"
      : row.encrypted_secrets?.[KEY_FIELD]
        ? openKey(row) === null
          ? "unreadable"
          : "stored"
        : "missing",
    lastTest: row.last_test
      ? { ...row.last_test, current: row.last_test.fingerprint === fingerprint(row) }
      : null,
    latestCheck: check
      ? {
          id: check.id,
          status: check.status,
          createdAt: check.created_at,
          completedAt: check.completed_at,
          current: check.report?.fingerprint === fingerprint(row),
          score: check.report?.totals?.score ?? null,
          passed: check.report?.totals?.passed ?? null,
          cases: check.report?.totals?.cases ?? null,
          safetyFailures: check.report?.totals?.safetyFailures ?? null,
          validJson: check.report?.totals?.validJson ?? null,
          p95Ms: check.report?.totals?.p95Ms ?? null,
          costUsd: check.report?.usage?.costUsd ?? null,
          reasons: check.report?.reasons ?? [],
        }
      : null,
    ready: {
      key: row.inherit_settings || !!openKey(row),
      tested: tested(row),
      checked: checkPassedFor(check, row),
    },
  };
}

const saveBody = z
  .object({ revision: z.number().int().positive() })
  .merge(modelProfileInputSchema)
  .strict();
const createBody = modelProfileInputSchema.extend({
  slug: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{1,59}$/),
});

export function registerModelProfiles(
  app: FastifyInstance,
  db: Database,
  identity: (request: FastifyRequest) => AdminIdentity,
) {
  const rate = { config: { rateLimit: { max: 30, timeWindow: "10 minutes" } } };
  function admin(request: FastifyRequest, write = false) {
    const actor = identity(request);
    if (actor.platformRole !== "admin")
      throw fail(403, "ROLE_REQUIRED", "Superadmin access is required.");
    requireRecentMfa(actor, write);
    return actor;
  }
  const parse = <T>(schema: z.ZodType<T>, body: unknown): T => {
    const parsed = schema.safeParse(body);
    if (!parsed.success)
      throw fail(400, "PROFILE_INVALID", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    return parsed.data;
  };
  const find = async (tx: Tx, id: string, lock = false) => {
    const [row] = await tx.query<Row>(`SELECT * FROM model_profiles WHERE id=$1${lock ? " FOR UPDATE" : ""}`, [id]);
    if (!row) throw fail(404, "PROFILE_NOT_FOUND", "This model profile does not exist.");
    return row;
  };
  // The AI model settings' own values (what an inheriting profile uses).
  const settingsBase = async () => (await storedIntegrationValues(db, "model")) ?? {};

  app.get("/api/v1/admin/model-profiles", async (request) => {
    admin(request);
    const base = await settingsBase();
    return db.system(async (tx) => {
      const rows = await tx.query<Row>("SELECT * FROM model_profiles ORDER BY (role='active') DESC NULLS LAST,(role='fallback') DESC NULLS LAST,created_at,id");
      const checks = await latestChecks(tx, rows.map((r) => r.id));
      const events = await tx.query(
        "SELECT id,profile_id,action,actor_id,detail,created_at FROM model_profile_audit ORDER BY created_at DESC,id DESC LIMIT 50",
      );
      const [last] = await tx.query(
        "SELECT detail->>'from' AS from_id FROM model_profile_audit WHERE action IN ('activated','switched_back') ORDER BY created_at DESC,id DESC LIMIT 1",
      );
      return {
        profiles: rows.map((r) => view(r, checks.get(r.id), base)),
        switchBackTo: last?.from_id ?? null,
        tolerance: DEFAULT_TOLERANCE,
        audit: events.map((e: any) => ({
          id: e.id,
          profileId: e.profile_id,
          action: e.action,
          actorId: e.actor_id,
          detail: e.detail,
          createdAt: e.created_at,
        })),
      };
    });
  });

  app.post("/api/v1/admin/model-profiles", rate, async (request) => {
    const actor = admin(request, true);
    const body = parse(createBody, request.body);
    return db.system(async (tx) => {
      const id = randomUUID();
      await tx
        .query(
          "INSERT INTO model_profiles(id,slug,name,label,tier,adapter,settings,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
          [id, body.slug, body.name, body.label, body.tier, body.adapter, JSON.stringify(body.settings), actor.userId],
        )
        .catch((error: any) => {
          if (String(error?.code) === "23505")
            throw fail(409, "PROFILE_EXISTS", "A profile with this short name exists.");
          throw error;
        });
      await audit(tx, id, "saved", actor.userId, { created: true });
      return { id };
    });
  });

  app.put<{ Params: { id: string } }>("/api/v1/admin/model-profiles/:id", rate, async (request) => {
    const actor = admin(request, true);
    const body = parse(saveBody, request.body);
    return db.system(async (tx) => {
      const row = await find(tx, request.params.id, true);
      if (row.revision !== body.revision)
        throw fail(409, "PROFILE_CONFLICT", "This profile changed. Reload before saving.");
      // An inheriting profile keeps the AI model settings' connection: only
      // its label, tier, name and request settings belong to the profile.
      const settings = row.inherit_settings
        ? { ...body.settings, baseUrl: undefined, model: undefined, provider: undefined }
        : body.settings;
      const adapter = row.inherit_settings ? "openai_compatible" : body.adapter;
      const before = fingerprint(row);
      const next = { ...row, adapter, settings } as Row;
      const changedRequest = fingerprint(next) !== before;
      if (row.role === "active" && changedRequest && !row.inherit_settings)
        throw fail(409, "PROFILE_ACTIVE", "Switch to another profile before changing the active profile's connection or request settings.");
      await tx.query(
        "UPDATE model_profiles SET name=$2,label=$3,tier=$4,adapter=$5,settings=$6,revision=revision+1,updated_by=$7,updated_at=now() WHERE id=$1",
        [row.id, body.name, body.label, body.tier, adapter, JSON.stringify(settings), actor.userId],
      );
      await audit(tx, row.id, "saved", actor.userId, { requestSettingsChanged: changedRequest });
      return { id: row.id, revision: row.revision + 1, requestSettingsChanged: changedRequest };
    });
  });

  app.put<{ Params: { id: string } }>("/api/v1/admin/model-profiles/:id/key", rate, async (request) => {
    const actor = admin(request, true);
    const { key } = parse(z.object({ key: z.string().trim().min(8).max(500) }).strict(), request.body);
    return db.system(async (tx) => {
      const row = await find(tx, request.params.id, true);
      if (row.inherit_settings)
        throw fail(400, "PROFILE_INHERITS", "This profile uses the AI model settings' key. Change it there.");
      if (row.role === "active")
        throw fail(409, "PROFILE_ACTIVE", "Switch to another profile before replacing the active profile's key.");
      let sealed: string;
      try {
        sealed = sealValue(sealContexts.modelProfile(row.id, KEY_FIELD), key);
      } catch {
        throw fail(503, "ENCRYPTION_UNAVAILABLE", "The server encryption key is unavailable. Configure SECURITY_ENCRYPTION_KEY before storing credentials.");
      }
      await tx.query(
        "UPDATE model_profiles SET encrypted_secrets=encrypted_secrets||$2::jsonb,last_test=NULL,revision=revision+1,updated_by=$3,updated_at=now() WHERE id=$1",
        [row.id, JSON.stringify({ [KEY_FIELD]: sealed }), actor.userId],
      );
      await audit(tx, row.id, "key_saved", actor.userId);
      return { id: row.id, key: "stored" };
    });
  });

  app.post<{ Params: { id: string } }>("/api/v1/admin/model-profiles/:id/test", rate, async (request) => {
    const actor = admin(request, true);
    const row = await db.system((tx) => find(tx, request.params.id));
    if (row.inherit_settings)
      throw fail(400, "PROFILE_INHERITS", "Test this connection in Settings, AI model.");
    const key = openKey(row);
    if (!key) throw fail(409, "PROFILE_KEY_MISSING", "Enter this profile's API key first.");
    const result = await connectionTest(row, key);
    const last_test = { ...result, fingerprint: fingerprint(row) };
    await db.system(async (tx) => {
      await tx.query("UPDATE model_profiles SET last_test=$2 WHERE id=$1 AND revision=$3", [row.id, JSON.stringify(last_test), row.revision]);
      await audit(tx, row.id, "tested", actor.userId, { status: result.status });
    });
    return last_test;
  });

  app.post<{ Params: { id: string } }>("/api/v1/admin/model-profiles/:id/check", rate, async (request) => {
    const actor = admin(request, true);
    return db.system(async (tx) => {
      const row = await find(tx, request.params.id);
      if (!row.inherit_settings && !openKey(row))
        throw fail(409, "PROFILE_KEY_MISSING", "Enter this profile's API key first.");
      if (!tested(row))
        throw fail(409, "PROFILE_UNTESTED", "Test the connection for the current settings first.");
      const [running] = await tx.query(
        "SELECT id FROM model_switch_checks WHERE profile_id=$1 AND status IN ('queued','running')",
        [row.id],
      );
      if (running) return { id: running.id, status: "queued" };
      const id = randomUUID();
      await tx.query(
        "INSERT INTO model_switch_checks(id,profile_id,profile_revision,status,requested_by) VALUES($1,$2,$3,'queued',$4)",
        [id, row.id, row.revision, actor.userId],
      );
      await audit(tx, row.id, "check_requested", actor.userId, { checkId: id });
      return { id, status: "queued" };
    });
  });

  app.get<{ Params: { id: string } }>("/api/v1/admin/model-profiles/checks/:id", async (request) => {
    admin(request);
    const [check] = await db.system((tx) =>
      tx.query("SELECT id,profile_id,profile_revision,status,report,created_at,completed_at FROM model_switch_checks WHERE id=$1", [request.params.id]),
    );
    if (!check) throw fail(404, "CHECK_NOT_FOUND", "This switch check does not exist.");
    return check;
  });

  /** Makes a profile active; the previously active one is remembered for switch-back. */
  async function activate(actor: AdminIdentity, id: string, action: "activated" | "switched_back") {
    const result = await db.system(async (tx) => {
      const row = await find(tx, id, true);
      if (row.role === "active") throw fail(409, "PROFILE_ACTIVE", "This profile is already active.");
      const [current] = await tx.query<Row>("SELECT * FROM model_profiles WHERE role='active' FOR UPDATE");
      if (!row.inherit_settings && !openKey(row))
        throw fail(409, "PROFILE_KEY_MISSING", "Enter this profile's API key first.");
      if (action === "activated") {
        if (!tested(row))
          throw fail(409, "PROFILE_UNTESTED", "Test the connection for the current settings first.");
        const check = (await latestChecks(tx, [row.id])).get(row.id);
        if (!checkPassedFor(check, row))
          throw fail(409, "PROFILE_UNCHECKED", "Run the switch check and pass it before activating this profile.");
      }
      await tx.query("UPDATE model_profiles SET role=NULL,updated_at=now() WHERE role='active'");
      if (row.role === "fallback")
        await tx.query("UPDATE model_profiles SET role=NULL WHERE id=$1", [row.id]);
      await tx.query("UPDATE model_profiles SET role='active',updated_by=$2,updated_at=now() WHERE id=$1", [row.id, actor.userId]);
      await audit(tx, row.id, action, actor.userId, { from: current?.id ?? null });
      return { id: row.id, from: current?.id ?? null };
    });
    const workspaces = await requestSwitchRechecks(db, actor);
    return { ...result, recheckedWorkspaces: workspaces };
  }
  app.post<{ Params: { id: string } }>("/api/v1/admin/model-profiles/:id/activate", rate, async (request) =>
    activate(admin(request, true), request.params.id, "activated"),
  );
  app.post("/api/v1/admin/model-profiles/switch-back", rate, async (request) => {
    const actor = admin(request, true);
    const [last] = await db.system((tx) =>
      tx.query(
        "SELECT detail->>'from' AS from_id FROM model_profile_audit WHERE action IN ('activated','switched_back') ORDER BY created_at DESC,id DESC LIMIT 1",
      ),
    );
    if (!last?.from_id) throw fail(409, "NOTHING_TO_SWITCH_BACK", "There is no earlier profile to switch back to.");
    // The earlier profile was active before: no new check is needed.
    return activate(actor, last.from_id, "switched_back");
  });

  app.put("/api/v1/admin/model-profiles/fallback", rate, async (request) => {
    const actor = admin(request, true);
    const { profileId } = parse(z.object({ profileId: z.string().uuid().nullable() }).strict(), request.body);
    return db.system(async (tx) => {
      const [current] = await tx.query("SELECT id FROM model_profiles WHERE role='fallback' FOR UPDATE");
      if (current) {
        await tx.query("UPDATE model_profiles SET role=NULL WHERE id=$1", [current.id]);
        await audit(tx, current.id, "fallback_cleared", actor.userId);
      }
      if (!profileId) return { fallback: null };
      const row = await find(tx, profileId, true);
      if (row.role === "active") throw fail(409, "PROFILE_ACTIVE", "The active profile cannot also be the fallback.");
      if (!row.inherit_settings && !openKey(row))
        throw fail(409, "PROFILE_KEY_MISSING", "Enter this profile's API key first.");
      if (!tested(row))
        throw fail(409, "PROFILE_UNTESTED", "Test the connection for the current settings first.");
      await tx.query("UPDATE model_profiles SET role='fallback',updated_by=$2,updated_at=now() WHERE id=$1", [row.id, actor.userId]);
      await audit(tx, row.id, "fallback_set", actor.userId);
      return { fallback: row.id };
    });
  });
}

/**
 * The worker's switch-check job: claims one queued check, runs the fixed
 * test set through the app's own request path with that profile's runtime
 * configuration (never its fallback), and stores the report. The baseline is
 * the active profile's last passing score.
 */
export async function processModelSwitchChecks(
  db: Database,
  options: {
    /** The AI model settings' values, for an inheriting profile. */
    base?: () => Promise<Record<string, string | undefined>>;
    run?: typeof runSwitchCheck;
  } = {},
) {
  const claimed = await db.system(async (tx) => {
    const [check] = await tx.query(
      `UPDATE model_switch_checks SET status='running',leased_until=now()+make_interval(mins=>${CHECK_LEASE_MINUTES})
       WHERE id=(SELECT id FROM model_switch_checks WHERE status='queued' OR (status='running' AND leased_until<now()) ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
       RETURNING *`,
    );
    if (!check) return null;
    const row = await tx.query<Row>("SELECT * FROM model_profiles WHERE id=$1", [check.profile_id]).then((r) => r[0]);
    const [baseline] = await tx.query(
      `SELECT (c.report->'totals'->>'score')::float AS score FROM model_switch_checks c JOIN model_profiles p ON p.id=c.profile_id
       WHERE p.role='active' AND c.status='passed' AND c.id<>$1 ORDER BY c.created_at DESC LIMIT 1`,
      [check.id],
    );
    return { check, row, baseline: baseline?.score ?? null };
  });
  if (!claimed) return null;
  const { check, row } = claimed;
  const finish = (status: string, report: Record<string, unknown>) =>
    db.system(async (tx) => {
      await tx.query(
        "UPDATE model_switch_checks SET status=$2,report=$3,leased_until=NULL,completed_at=now() WHERE id=$1 AND status='running'",
        [check.id, status, JSON.stringify(report)],
      );
      await audit(tx, check.profile_id, "check_completed", SYSTEM_USER_ID, { checkId: check.id, status });
    });
  if (!row) return finish("error", { error: "The profile no longer exists." });
  const base = row.inherit_settings
    ? await (options.base ?? (async () => (await storedIntegrationValues(db, "model")) ?? {}))()
    : {};
  const keys = profileRuntimeKeys(row, {
    key: row.inherit_settings ? undefined : openKey(row),
    inherited: row.inherit_settings
      ? Object.fromEntries(INHERITED_KEYS.map((k) => [k, base[k] ?? ""]))
      : undefined,
  });
  if (!keys.MODEL_BASE_URL || !keys.MODEL_API_KEY || !keys.MODEL_NAME)
    return finish("error", { error: "The profile has no complete connection (address, key and model ID)." });
  let report: SwitchCheckReport;
  try {
    report = await withRuntimeConfig(
      { ...keys, [MODEL_PROFILE_KEYS.fallback]: "", MODEL_MAX_DAILY_CALLS: "1000" },
      () => (options.run ?? runSwitchCheck)({ baselineScore: row.role === "active" ? null : claimed.baseline }),
    );
  } catch (error) {
    return finish("error", { error: String((error as Error)?.message ?? error).slice(0, 300) });
  }
  return finish(report.pass ? "passed" : "failed", {
    ...report,
    fingerprint: fingerprint(row),
    profileRevision: row.revision,
  });
}
