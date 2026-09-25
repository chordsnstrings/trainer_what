import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Actor, Database, Tx } from "@trainer/db";
import { integrationStatus } from "@trainer/providers";
import { z } from "zod";
import {
  INTEGRATION_CATALOG,
  testIntegration,
  validateIntegrationValues,
  type IntegrationDefinition,
} from "../../../packages/providers/src/configuration.ts";
import { requireRecentMfa } from "./security.ts";

type AdminIdentity = Actor & { platformRole: string; mfaAt?: string | null };
type TestResult = {
  status: "verified" | "validated" | "unavailable" | "failed";
  message: string;
  checkedAt: string;
  revision: number;
};
type SettingsRow = {
  integration_id: string;
  revision: number;
  enabled: boolean;
  settings_values: Record<string, string>;
  encrypted_secrets: Record<string, string>;
  last_test: TestResult | null;
  updated_at?: string;
};
const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
const conflict = () =>
  fail(
    409,
    "SETTINGS_CONFLICT",
    "These settings changed. Reload before continuing.",
  );
const missingKey = () =>
  fail(
    503,
    "ENCRYPTION_UNAVAILABLE",
    "The server encryption key is unavailable. Configure SECURITY_ENCRYPTION_KEY before storing or using credentials.",
  );

function encryptionKey() {
  const key = Buffer.from(process.env.SECURITY_ENCRYPTION_KEY ?? "", "base64");
  if (key.length !== 32) throw missingKey();
  return key;
}
function encryptionReady() {
  try {
    encryptionKey();
    return true;
  } catch {
    return false;
  }
}
function seal(integrationId: string, key: string, value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(`platform-settings:v1:${integrationId}:${key}`));
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    body.toString("base64url"),
  ].join(".");
}
function open(integrationId: string, key: string, value: string) {
  try {
    const parts = value.split(".");
    if (parts.length !== 4 || parts[0] !== "v1") throw missingKey();
    const [, iv, tag, body] = parts;
    const cipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      Buffer.from(iv, "base64url"),
    );
    cipher.setAAD(Buffer.from(`platform-settings:v1:${integrationId}:${key}`));
    cipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      cipher.update(Buffer.from(body, "base64url")),
      cipher.final(),
    ]).toString("utf8");
  } catch {
    throw missingKey();
  }
}
function definition(integrationId: string) {
  const def = INTEGRATION_CATALOG.find((item) => item.id === integrationId);
  if (!def)
    throw fail(
      404,
      "INTEGRATION_NOT_FOUND",
      "This integration is unavailable.",
    );
  return def;
}
function isActive(def: IntegrationDefinition, row?: SettingsRow) {
  if (def.id === "application") return true;
  if (!row) {
    const inherited = integrationStatus().find((item) => item.id === def.id);
    return Boolean(inherited?.configured && inherited.approved);
  }
  return Boolean(
    def.implemented &&
    row.enabled &&
    row.last_test?.revision === row.revision &&
    ["verified", "validated"].includes(row.last_test.status),
  );
}
function credentialStatus(def: IntegrationDefinition, row?: SettingsRow) {
  const secrets = def.fields.filter((field) => field.type === "secret");
  if (
    !secrets.some((field) =>
      row ? row.encrypted_secrets[field.key] : process.env[field.key],
    )
  )
    return "empty";
  if (!row) return "environment";
  if (!encryptionReady()) return "encryption_unavailable";
  try {
    for (const field of secrets)
      if (row.encrypted_secrets[field.key])
        open(def.id, field.key, row.encrypted_secrets[field.key]);
    return "ready";
  } catch {
    return "credentials_unreadable";
  }
}
function fieldValues(def: IntegrationDefinition, row?: SettingsRow) {
  return Object.fromEntries(
    def.fields
      .filter((field) => field.type !== "secret")
      .map((field) => [
        field.key,
        row
          ? (row.settings_values[field.key] ?? field.defaultValue ?? "")
          : (process.env[field.key] ?? field.defaultValue ?? ""),
      ]),
  );
}
function safeView(def: IntegrationDefinition, row?: SettingsRow) {
  const credentials = credentialStatus(def, row);
  return {
    ...def,
    values: fieldValues(def, row),
    secrets: Object.fromEntries(
      def.fields
        .filter((field) => field.type === "secret")
        .map((field) => [
          field.key,
          Boolean(
            row ? row.encrypted_secrets[field.key] : process.env[field.key],
          ),
        ]),
    ),
    revision: row?.revision ?? 0,
    enabled: def.id === "application" ? true : (row?.enabled ?? isActive(def)),
    active:
      isActive(def, row) &&
      !["encryption_unavailable", "credentials_unreadable"].includes(
        credentials,
      ),
    credentialStatus: credentials,
    source: row ? "superadmin" : "environment",
    lastTest: row?.last_test ?? null,
    updatedAt: row?.updated_at ?? null,
  };
}
function configuredValues(def: IntegrationDefinition, row: SettingsRow) {
  const out = fieldValues(def, row);
  for (const field of def.fields.filter((field) => field.type === "secret"))
    out[field.key] = row.encrypted_secrets[field.key]
      ? open(def.id, field.key, row.encrypted_secrets[field.key])
      : "";
  return out;
}

/** Request/job scoped overrides. Persisted rows are authoritative, including blanks. */
export async function loadRuntimeSettings(
  db: Database,
): Promise<Record<string, string>> {
  const rows = await db.system((tx) =>
    tx.query<SettingsRow>("SELECT * FROM platform_settings"),
  );
  const overrides: Record<string, string> = {};
  let stripeInactive = false;
  for (const row of rows) {
    const def = INTEGRATION_CATALOG.find(
      (item) => item.id === row.integration_id,
    );
    if (!def) continue;
    let active = isActive(def, row);
    // Collection switches do not invalidate authenticated lifecycle webhooks.
    let configured: Record<string, string> = {};
    try {
      if (active || def.id === "stripe")
        configured = configuredValues(def, row);
    } catch {
      // One unreadable integration must not block sign-in or credential recovery.
      active = false;
    }
    for (const field of def.fields) {
      const keepWebhookCredential =
        def.id === "stripe" &&
        ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"].includes(field.key);
      overrides[field.key] =
        active || keepWebhookCredential
          ? (configured[field.key] ?? "")
          : field.type === "boolean"
            ? "false"
            : "";
    }
    if (def.id === "stripe" && !active) stripeInactive = true;
  }
  // Apply after every group so application flags cannot re-enable an inactive rail.
  if (stripeInactive) {
    overrides.COMMERCE_APPROVED = "false";
    overrides.BUNDLE_CHANGES_APPROVED = "false";
  }
  return overrides;
}

async function audit(
  tx: Tx,
  actor: AdminIdentity,
  row: SettingsRow,
  action: "saved" | "tested" | "disconnected",
  changedFields: string[] = [],
  result?: TestResult["status"],
) {
  await tx.query(
    "INSERT INTO platform_settings_audit(id,integration_id,revision,action,actor_id,changed_fields,result) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [
      randomUUID(),
      row.integration_id,
      row.revision,
      action,
      actor.userId,
      JSON.stringify([...new Set(changedFields)].sort()),
      result ?? null,
    ],
  );
}
const revisionBody = z
  .object({ revision: z.number().int().min(0).max(2147483646) })
  .strict();
const saveBody = revisionBody
  .extend({
    enabled: z.boolean(),
    values: z.record(z.string().min(1).max(128), z.string().max(16384)),
    secrets: z
      .record(z.string().min(1).max(128), z.string().max(16384))
      .optional(),
    clearSecrets: z.array(z.string().min(1).max(128)).max(100).optional(),
  })
  .strict();
function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success)
    throw fail(
      400,
      "SETTINGS_INVALID",
      "Check the settings fields and revision before saving.",
    );
  return result.data;
}
function validatedFields(
  def: IntegrationDefinition,
  values: Record<string, string>,
  secrets: Record<string, string>,
  clear: string[],
) {
  const allowedValues = new Set(
    def.fields
      .filter((field) => field.type !== "secret")
      .map((field) => field.key),
  );
  const allowedSecrets = new Set(
    def.fields
      .filter((field) => field.type === "secret")
      .map((field) => field.key),
  );
  if (
    Object.keys(values).some((key) => !allowedValues.has(key)) ||
    Object.keys(secrets).some((key) => !allowedSecrets.has(key)) ||
    clear.some((key) => !allowedSecrets.has(key)) ||
    clear.some((key) => Object.hasOwn(secrets, key)) ||
    Object.values(secrets).some((value) => !value.trim())
  )
    throw fail(
      400,
      "SETTINGS_INVALID",
      "Use the declared setting fields and an explicit clear action for credentials.",
    );
  try {
    return validateIntegrationValues(def.id, { ...values, ...secrets });
  } catch {
    throw fail(
      400,
      "SETTINGS_INVALID",
      "One or more settings have an invalid value or URL. Review the field guidance.",
    );
  }
}
async function findRow(tx: Tx, integrationId: string, lock = false) {
  const [row] = await tx.query<SettingsRow>(
    `SELECT * FROM platform_settings WHERE integration_id=$1${lock ? " FOR UPDATE" : ""}`,
    [integrationId],
  );
  return row;
}
async function saveRow(
  tx: Tx,
  row: SettingsRow,
  actor: AdminIdentity,
  previous?: SettingsRow,
) {
  const values = [
    row.integration_id,
    row.revision,
    row.enabled,
    JSON.stringify(row.settings_values),
    JSON.stringify(row.encrypted_secrets),
    row.last_test ? JSON.stringify(row.last_test) : null,
    actor.userId,
  ];
  const [saved] = previous
    ? await tx.query<SettingsRow>(
        "UPDATE platform_settings SET revision=$2,enabled=$3,settings_values=$4,encrypted_secrets=$5,last_test=$6,test_run_id=NULL,updated_by=$7,updated_at=now() WHERE integration_id=$1 AND revision=$8 RETURNING *",
        [...values, previous.revision],
      )
    : await tx.query<SettingsRow>(
        "INSERT INTO platform_settings(integration_id,revision,enabled,settings_values,encrypted_secrets,last_test,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(integration_id) DO NOTHING RETURNING *",
        values,
      );
  if (!saved) throw conflict();
  return saved;
}

export function platformSettingsRoutes(
  app: FastifyInstance,
  db: Database,
  identity: (request: FastifyRequest) => AdminIdentity,
  dependencies: { testIntegration?: typeof testIntegration } = {},
) {
  const probe = dependencies.testIntegration ?? testIntegration;
  const rate = { config: { rateLimit: { max: 20, timeWindow: "10 minutes" } } };
  function admin(request: FastifyRequest, write = false) {
    const actor = identity(request);
    if (actor.platformRole !== "admin")
      throw fail(403, "ROLE_REQUIRED", "Superadmin access is required.");
    requireRecentMfa(actor, write);
    return actor;
  }
  app.get("/api/v1/admin/settings", async (request) => {
    admin(request);
    return db.system(async (tx) => {
      const rows = await tx.query<SettingsRow>(
        "SELECT * FROM platform_settings",
      );
      const events = await tx.query(
        "SELECT id,integration_id,revision,action,actor_id,changed_fields,result,created_at FROM platform_settings_audit ORDER BY created_at DESC,id DESC LIMIT 100",
      );
      return {
        encryptionReady: encryptionReady(),
        integrations: INTEGRATION_CATALOG.map((def) =>
          safeView(
            def,
            rows.find((row) => row.integration_id === def.id),
          ),
        ),
        audit: events.map((item) => ({
          id: item.id,
          integrationId: item.integration_id,
          revision: item.revision,
          action: item.action,
          actorId: item.actor_id,
          changedFields: item.changed_fields,
          result: item.result,
          createdAt: item.created_at,
        })),
      };
    });
  });
  app.put<{ Params: { id: string } }>(
    "/api/v1/admin/settings/:id",
    rate,
    async (request) => {
      const actor = admin(request, true);
      const def = definition(request.params.id);
      const body = parseBody(saveBody, request.body);
      if (def.id === "application" && !body.enabled)
        throw fail(
          400,
          "SETTINGS_INVALID",
          "Application settings remain enabled. Change the individual controls instead.",
        );
      const submitted = validatedFields(
        def,
        body.values,
        body.secrets ?? {},
        body.clearSecrets ?? [],
      );
      return db.system(async (tx) => {
        const previous = await findRow(tx, def.id, true);
        if ((previous?.revision ?? 0) !== body.revision) throw conflict();
        const next: SettingsRow = {
          integration_id: def.id,
          revision: body.revision + 1,
          enabled: body.enabled,
          settings_values: fieldValues(def, previous),
          encrypted_secrets: { ...previous?.encrypted_secrets },
          last_test: previous?.last_test ?? null,
        };
        // First save adopts any existing bootstrap configuration without exposing it.
        if (!previous)
          for (const field of def.fields.filter(
            (field) => field.type === "secret",
          )) {
            const value = process.env[field.key];
            if (
              value &&
              !Object.hasOwn(body.secrets ?? {}, field.key) &&
              !body.clearSecrets?.includes(field.key)
            )
              next.encrypted_secrets[field.key] = seal(
                def.id,
                field.key,
                value,
              );
          }
        const changed: string[] = [];
        for (const key of Object.keys(body.values)) {
          if (next.settings_values[key] !== submitted[key]) changed.push(key);
          next.settings_values[key] = submitted[key];
        }
        for (const key of Object.keys(body.secrets ?? {})) {
          next.encrypted_secrets[key] = seal(def.id, key, submitted[key]);
          changed.push(key);
        }
        for (const key of body.clearSecrets ?? []) {
          if (next.encrypted_secrets[key]) changed.push(key);
          delete next.encrypted_secrets[key];
        }
        if (changed.length) next.last_test = null;
        else if (next.last_test)
          next.last_test = { ...next.last_test, revision: next.revision };
        if (!previous || previous.enabled !== next.enabled)
          changed.push("enabled");
        const saved = await saveRow(tx, next, actor, previous);
        await audit(tx, actor, saved, "saved", changed);
        return safeView(def, saved);
      });
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/v1/admin/settings/:id/test",
    rate,
    async (request) => {
      const actor = admin(request, true);
      const def = definition(request.params.id);
      const body = parseBody(revisionBody, request.body);
      const runId = randomUUID();
      const snapshot = await db.system(async (tx) => {
        const [row] = await tx.query<SettingsRow>(
          "UPDATE platform_settings SET test_run_id=$3 WHERE integration_id=$1 AND revision=$2 RETURNING *",
          [def.id, body.revision, runId],
        );
        if (!row) throw conflict();
        return row;
      });
      let status: TestResult["status"] = "failed";
      // Network calls never hold a database transaction or receive unsaved fields.
      try {
        const result = await probe(def.id, configuredValues(def, snapshot));
        if (
          ["verified", "validated", "unavailable", "failed"].includes(
            result.status,
          )
        )
          status = result.status;
      } catch {
        /* Provider exception text and response bodies are never persisted. */
      }
      const result: TestResult = {
        status,
        message: {
          verified: "Credentials verified with a read-only provider request.",
          validated:
            "Configuration validated locally. Review the connection notes for live verification requirements.",
          unavailable:
            "This connection is unavailable or needs an adapter before activation.",
          failed:
            "Connection check failed. Review the configuration and try again.",
        }[status],
        checkedAt: new Date().toISOString(),
        revision: snapshot.revision,
      };
      return db.system(async (tx) => {
        const [saved] = await tx.query<SettingsRow>(
          "UPDATE platform_settings SET last_test=$3,test_run_id=NULL,updated_at=now(),updated_by=$4 WHERE integration_id=$1 AND revision=$2 AND test_run_id=$5 RETURNING *",
          [
            def.id,
            snapshot.revision,
            JSON.stringify(result),
            actor.userId,
            runId,
          ],
        );
        if (!saved) throw conflict();
        await audit(tx, actor, saved, "tested", [], result.status);
        return safeView(def, saved);
      });
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/v1/admin/settings/:id/disconnect",
    rate,
    async (request) => {
      const actor = admin(request, true);
      const def = definition(request.params.id);
      if (def.id === "application")
        throw fail(
          400,
          "SETTINGS_INVALID",
          "Application settings cannot be disconnected.",
        );
      const body = parseBody(revisionBody, request.body);
      return db.system(async (tx) => {
        const previous = await findRow(tx, def.id, true);
        if ((previous?.revision ?? 0) !== body.revision) throw conflict();
        const saved = await saveRow(
          tx,
          {
            integration_id: def.id,
            revision: body.revision + 1,
            enabled: false,
            settings_values: fieldValues(def, previous),
            encrypted_secrets: {},
            last_test: null,
          },
          actor,
          previous,
        );
        await audit(tx, actor, saved, "disconnected", [
          "enabled",
          ...def.fields
            .filter((field) => field.type === "secret")
            .map((field) => field.key),
        ]);
        return safeView(def, saved);
      });
    },
  );
}
