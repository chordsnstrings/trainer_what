import { createHash } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  event,
  putRecord,
  type Actor,
  type Database,
  type Tx,
} from "@trainer/db";
import {
  SITE_BUILDER_MODULES,
  SITE_BUILDER_TEMPLATES,
  SITE_BUILDER_VERSION,
  type SiteBuilderDocument,
} from "../../../packages/contracts/src/site-builder.ts";
import {
  runtimeConfig,
  withRuntimeConfig,
  type RuntimeConfig,
} from "../../../packages/providers/src/configuration.ts";
import {
  isSiteStarterModel,
  SITE_STARTER_PROMPT_VERSION,
  siteStarterModel,
  starterTemplate,
  type SiteStarterInput,
} from "../../../packages/providers/src/site-builder-starter.ts";
import { MODEL_PROFILE_KEYS } from "../../../packages/providers/src/model-request.ts";
import { profileRuntimeKeys } from "../../../packages/providers/src/model-profiles.ts";
import {
  openKey,
  tested,
  type Row as ModelProfileRow,
} from "./model-profile-overrides.ts";
import { storedIntegrationValues } from "./platform-settings.ts";
import { modelAccounting } from "./model-accounting.ts";
import { privacyMatches } from "./ingestion.ts";

const KIND = "website_starter";
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const catalogueDigest = () =>
  hash({
    version: SITE_BUILDER_VERSION,
    modules: SITE_BUILDER_MODULES,
    templates: SITE_BUILDER_TEMPLATES,
  });
const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
const UNAVAILABLE =
  "The website assistant is unavailable. This is a ready-made starting design you can customise.";
const FAILED =
  "The assistant could not finish a checked draft. This is a ready-made starting design. No further AI request was sent.";

export const siteStarterRequestSchema = z
  .object({
    requestId: z.string().uuid(),
    brief: z.string().trim().min(3).max(1200),
    templateId: z.string().min(1).max(80).optional(),
    language: z.enum(["en", "ar"]).default("en"),
    version: z.number().int().min(0).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      v.templateId &&
      !SITE_BUILDER_TEMPLATES.some((t) => t.id === v.templateId)
    )
      ctx.addIssue({
        code: "custom",
        path: ["templateId"],
        message: "Choose an available starting design",
      });
  });

export type SiteStarterResponse = {
  builder: SiteBuilderDocument;
  source: "ai" | "template";
  cached: boolean;
  requestId: string;
  message?: string;
};
type Result = Omit<SiteStarterResponse, "cached" | "requestId">;
type StoredStarter = {
  requestId: string;
  inputHash: string;
  cacheKey: string;
  startedAt: string;
  result?: Result;
};

function owner(req: FastifyRequest): Actor {
  const actor = req.identity;
  if (!actor) throw fail(401, "AUTH_REQUIRED", "Please sign in");
  if (actor.role !== "owner")
    throw fail(
      403,
      "OWNER_REQUIRED",
      "Only the trainer owner can create a website draft",
    );
  return actor;
}
async function ownerTransaction<T>(
  db: Database,
  actor: Actor,
  fn: (tx: Tx, tenant: any) => Promise<T>,
) {
  return db.tenant(actor, async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      actor.tenantId + ":workspace",
    ]);
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      actor.tenantId + ":site-starter",
    ]);
    const [scope] = await tx.query("SELECT trainer_brand_tenant() AS tenant");
    if (!scope?.tenant)
      throw fail(
        403,
        "OWNER_REQUIRED",
        "Current owner access to an active workspace is required",
      );
    return fn(tx, scope.tenant);
  });
}

/**
 * Resolve Seed separately from the active coaching model. A model-profile
 * switch never sends this Seed-only drafting task to a different model.
 * The global integration's off/unchecked state is already represented by
 * empty effective model keys in the request's runtime scope.
 */
export async function resolveSiteStarterConfig(
  db: Database,
  current: RuntimeConfig = runtimeConfig(),
): Promise<RuntimeConfig | null> {
  if (!current.MODEL_BASE_URL || !current.MODEL_API_KEY || !current.MODEL_NAME)
    return null;
  const bounded = (
    chosen: RuntimeConfig,
    revision?: number,
  ): RuntimeConfig => ({
    ...current,
    // Reset active-profile controls before applying the dedicated connection.
    ...Object.fromEntries(
      Object.values(MODEL_PROFILE_KEYS).map((key) => [key, ""]),
    ),
    ...chosen,
    ...(revision ? { SITE_STARTER_PROFILE_REVISION: String(revision) } : {}),
    [MODEL_PROFILE_KEYS.fallback]: "",
    [MODEL_PROFILE_KEYS.adapter]: "",
    [MODEL_PROFILE_KEYS.budgets]: "",
    [MODEL_PROFILE_KEYS.defaultMaxTokens]: "3000",
    [MODEL_PROFILE_KEYS.jsonMode]: "",
    [MODEL_PROFILE_KEYS.sendTemperature]: "",
    MODEL_REQUEST_STYLE: "classic",
    MODEL_REASONING_EFFORT: "omit",
    // Workspace allowance is shared with all other AI requests.
    MODEL_MAX_DAILY_CALLS: current.MODEL_MAX_DAILY_CALLS,
  });
  if (isSiteStarterModel(current)) return bounded(current);
  // The inherited settings keep their own Seed connection when a coach's
  // active profile is changed. No credential is copied or saved here.
  const inherited = await storedIntegrationValues(db, "model", (values) =>
    /(?:^|\/)seed[-_.]2[-_.]0(?:[-_.]|$)/i.test(values.MODEL_NAME ?? ""),
  );
  if (inherited && isSiteStarterModel(inherited)) return bounded(inherited);
  const profiles = await db.system((tx) =>
    tx.query<ModelProfileRow>(
      "SELECT * FROM model_profiles WHERE inherit_settings=false ORDER BY created_at,id",
    ),
  );
  for (const profile of profiles) {
    if (profile.adapter !== "openai_compatible" || !tested(profile)) continue;
    if (
      !/(?:^|\/)seed[-_.]2[-_.]0(?:[-_.]|$)/i.test(profile.settings.model ?? "")
    )
      continue;
    const keys = profileRuntimeKeys(profile, { key: openKey(profile) });
    if (isSiteStarterModel(keys)) return bounded(keys, profile.revision);
  }
  return null;
}

function publicIdentity(tenant: any): SiteStarterInput["identity"] {
  // Only the trainer's existing public brand. No sources, messages, members,
  // medical history, schedules, payment data or uploaded files enter a prompt.
  const plain = (v: unknown, max: number) =>
    typeof v === "string" ? v.slice(0, max).trim() : "";
  return {
    name: plain(tenant.name, 120),
    headline: plain(tenant.theme?.headline, 160),
    bio: plain(tenant.theme?.bio, 1500),
    category: plain(tenant.theme?.category, 120),
  };
}
function response(
  record: StoredStarter,
  requestId: string,
  cached: boolean,
): SiteStarterResponse {
  return { ...record.result!, requestId, cached };
}

export function registerSiteBuilderStarter(app: FastifyInstance, db: Database) {
  app.get("/api/v1/tenant/site/starter/options", async (req) => {
    const actor = owner(req);
    await ownerTransaction(db, actor, async () => undefined);
    const config = await resolveSiteStarterConfig(db);
    return {
      available: Boolean(config),
      model: config ? "Website assistant" : null,
      ...(config ? {} : { reason: UNAVAILABLE }),
    };
  });

  app.post(
    "/api/v1/tenant/site/starter",
    {
      bodyLimit: 8192,
      config: { rateLimit: { max: 12, timeWindow: "1 hour" } },
    },
    async (req) => {
      const actor = owner(req);
      const submitted = siteStarterRequestSchema.parse(req.body);
      if (privacyMatches(submitted.brief).length)
        throw fail(
          400,
          "STARTER_PRIVATE_DETAILS",
          "Describe your brand and website without client details, contact numbers or financial information.",
        );
      const inputHash = hash({
        brief: submitted.brief,
        templateId: submitted.templateId ?? null,
        language: submitted.language,
      });
      const config = await resolveSiteStarterConfig(db);
      const claim = await ownerTransaction(db, actor, async (tx, tenant) => {
        const [existing] = await tx.query<{
          id: string;
          status: string;
          data: StoredStarter;
        }>(
          "SELECT id,status,data FROM records WHERE kind=$1 AND data->>'requestId'=$2 ORDER BY created_at LIMIT 1",
          [KIND, submitted.requestId],
        );
        if (existing) {
          if (existing.data.inputHash !== inputHash)
            throw fail(
              409,
              "STARTER_REQUEST_CHANGED",
              "This request already belongs to a different brief. Start a new request for your changes.",
            );
          if (existing.data.result)
            return {
              ready: response(existing.data, submitted.requestId, true),
            };
          // Never reclaim an old intent: after a process crash its external
          // outcome is unknown and repeating it could spend twice.
          throw fail(
            409,
            "STARTER_IN_PROGRESS",
            "This starter request has not completed. Keep its request ID when checking again, or deliberately start a new request later.",
          );
        }
        const [site] = await tx.query(
          "SELECT version FROM coach_sites WHERE tenant_id=$1",
          [actor.tenantId],
        );
        if (
          submitted.version !== undefined &&
          submitted.version !== (site?.version ?? 0)
        )
          throw fail(
            409,
            "SITE_CHANGED",
            "Your website changed in another session. Refresh before generating a starter.",
          );
        const input: SiteStarterInput = {
          brief: submitted.brief,
          templateId: submitted.templateId,
          language: submitted.language,
          identity: publicIdentity(tenant),
        };
        // A profile can contain contact details; remove them from the prompt
        // without touching the saved brand or requesting member data.
        for (const field of ["name", "headline", "bio", "category"] as const) {
          const value = input.identity[field];
          for (const match of privacyMatches(value).sort(
            (a, b) => b.start - a.start,
          ))
            input.identity[field] =
              input.identity[field].slice(0, match.start) +
              input.identity[field].slice(match.end);
        }
        const cacheKey = hash({
          inputHash,
          identity: input.identity,
          catalogue: catalogueDigest(),
          prompt: SITE_STARTER_PROMPT_VERSION,
          connection: config
            ? [
                config.MODEL_BASE_URL,
                config.MODEL_NAME,
                config[MODEL_PROFILE_KEYS.id],
                config.SITE_STARTER_PROFILE_REVISION,
              ]
            : null,
        });
        const [same] = await tx.query<{
          id: string;
          status: string;
          data: StoredStarter;
        }>(
          "SELECT id,status,data FROM records WHERE kind=$1 AND data->>'cacheKey'=$2 AND status IN ('completed','running') ORDER BY created_at DESC LIMIT 1",
          [KIND, cacheKey],
        );
        if (same?.status === "completed" && same.data.result) {
          // Bind the new request ID too; subsequent retries cannot mutate it.
          await putRecord(
            tx,
            actor,
            KIND,
            { ...same.data, requestId: submitted.requestId },
            { status: "completed" },
          );
          return { ready: response(same.data, submitted.requestId, true) };
        }
        if (
          same?.status === "running" &&
          Date.now() - Date.parse(same.data.startedAt) < 180000
        )
          throw fail(
            409,
            "STARTER_IN_PROGRESS",
            "A starter for this brief is already being prepared. Check the existing request again.",
          );
        const data: StoredStarter = {
          requestId: submitted.requestId,
          inputHash,
          cacheKey,
          startedAt: new Date().toISOString(),
        };
        const record = await putRecord(tx, actor, KIND, data, {
          status: "running",
        });
        return { recordId: record.id as string, data, input };
      });
      if ("ready" in claim) return claim.ready;

      let result: Result;
      let status = "completed";
      if (!config) {
        result = {
          builder: starterTemplate(claim.input),
          source: "template",
          message: UNAVAILABLE,
        };
      } else {
        try {
          result = {
            builder: await withRuntimeConfig(config, () =>
              siteStarterModel(
                claim.input,
                modelAccounting(db, actor, "site_builder_starter"),
              ),
            ),
            source: "ai",
          };
        } catch (error) {
          // Failure, invalid output and unknown external outcomes never cause
          // an automatic second generation. Accounting retains real usage.
          status = "failed";
          result = {
            builder: starterTemplate(claim.input),
            source: "template",
            message:
              (error as { code?: string })?.code === "MODEL_DAILY_LIMIT"
                ? "Your workspace has reached today's AI request limit. This is a ready-made starting design you can customise now."
                : FAILED,
          };
        }
      }
      await ownerTransaction(db, actor, async (tx) => {
        await tx.query(
          "UPDATE records SET status=$2,data=$3,version=version+1,updated_at=now() WHERE id=$1 AND kind=$4 AND status='running'",
          [
            claim.recordId,
            status,
            JSON.stringify({ ...claim.data, result }),
            KIND,
          ],
        );
        await event(tx, actor, "website.starter_prepared", claim.recordId, {
          source: result.source,
          pages: result.builder.pages.length,
          sections: result.builder.pages.reduce(
            (n, page) => n + page.sections.length,
            0,
          ),
        });
      });
      // A proposal only: coach_sites, its draft/version and published document
      // are never written by this endpoint.
      return {
        ...result,
        requestId: submitted.requestId,
        cached: false,
      } satisfies SiteStarterResponse;
    },
  );
}
