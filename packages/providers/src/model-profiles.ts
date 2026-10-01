/**
 * Model profiles (docs/features/model-profiles.md): saved model connections
 * in Super admin, side by side, with one active and one fallback. A profile
 * holds everything a switch changes: the adapter, address, model ID, the key
 * (sealed by the API, never here), request settings, per-task budgets and
 * prices. The active profile is applied to every request's runtime
 * configuration as the AI model keys (apps/api platform-settings
 * loadRuntimeSettings); call sites and qualification pins read those keys as
 * before, so no call site changes.
 *
 * The migrated default profile "inherits" the AI model settings: its address,
 * key, model ID, style, effort, vision and prices are the settings' own, so the
 * request, the cost row and every qualification pin stay byte for byte what
 * they were before profiles existed.
 */
import { z } from "zod";
import {
  MODEL_ADAPTERS,
  MODEL_CALL_BUDGETS,
  MODEL_CALL_TIMEOUT_CAP_MS,
  MODEL_PROFILE_KEYS,
  MODEL_REASONING_EFFORT_SETTINGS,
  MODEL_REQUEST_STYLE_SETTINGS,
  validTimeoutMultiplier,
} from "./model-request.ts";

export const MODEL_PROFILE_TIERS = ["standard", "frontier"] as const;
export type ModelProfileTier = (typeof MODEL_PROFILE_TIERS)[number];

/**
 * Words a coach-facing label must never contain: the model, its vendor or a
 * hosting platform (public, member and coach text never names them).
 */
export const MODEL_NAME_WORDS =
  /\b(?:seed|bytedance|byteplus|modelark|ark|doubao|openai|chatgpt|gpt|o\d|anthropic|claude|opus|sonnet|haiku|fable|mythos|gemini|google|deepseek|glm|qwen|llama|mistral|grok)\b/i;
export function labelNamesModel(label: string) {
  return MODEL_NAME_WORDS.test(label.replace(/[-_]/g, " "));
}

const price = z.number().min(0).max(100000).nullable();
const budgetEntry = z
  .object({
    maxTokens: z.number().int().min(256).max(64000).nullable().optional(),
    timeoutMs: z.number().int().min(5000).max(MODEL_CALL_TIMEOUT_CAP_MS).optional(),
  })
  .strict();
export const modelProfileSettingsSchema = z
  .object({
    baseUrl: z.string().trim().url().max(500).optional(),
    model: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,119}$/)
      .optional(),
    provider: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9._-]{0,59}$/)
      .optional(),
    requestStyle: z.enum(MODEL_REQUEST_STYLE_SETTINGS).default("auto"),
    reasoningEffort: z.enum(MODEL_REASONING_EFFORT_SETTINGS).default("auto"),
    sendTemperature: z.boolean().default(true),
    jsonMode: z.boolean().default(true),
    vision: z.boolean().default(false),
    timeoutMultiplier: z
      .string()
      .trim()
      .refine(validTimeoutMultiplier)
      .optional(),
    reasoningTimeoutMultiplier: z
      .string()
      .trim()
      .refine(validTimeoutMultiplier)
      .optional(),
    /** Answer limit for calls that set none (voice wording); required by the native adapter. */
    defaultMaxTokens: z.number().int().min(256).max(64000).nullable().default(null),
    /** Per-task budgets by task name (MODEL_CALL_BUDGETS); a task left out keeps the automatic one. */
    budgets: z
      .record(z.string(), budgetEntry)
      .refine((b) => Object.keys(b).every((task) => task in MODEL_CALL_BUDGETS), {
        message: `Budget tasks are ${Object.keys(MODEL_CALL_BUDGETS).join(", ")}`,
      })
      .nullable()
      .default(null),
    inputUsdPerMillion: price.default(null),
    outputUsdPerMillion: price.default(null),
    cacheReadUsdPerMillion: price.default(null),
    cacheWriteUsdPerMillion: price.default(null),
    priceVersion: z.string().trim().max(100).nullable().default(null),
  })
  .strict();
export type ModelProfileSettings = z.infer<typeof modelProfileSettingsSchema>;

export const modelProfileInputSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    label: z
      .string()
      .trim()
      .min(2)
      .max(40)
      .refine((l) => !labelNamesModel(l), {
        message:
          "The label is shown to coaches: describe the tier (for example Frontier model), never the model or its vendor",
      }),
    tier: z.enum(MODEL_PROFILE_TIERS),
    adapter: z.enum(MODEL_ADAPTERS),
    settings: modelProfileSettingsSchema,
  })
  .strict();
export type ModelProfileInput = z.infer<typeof modelProfileInputSchema>;

export type ModelProfileRow = {
  id: string;
  slug: string;
  name: string;
  label: string;
  tier: ModelProfileTier;
  adapter: (typeof MODEL_ADAPTERS)[number];
  role: "active" | "fallback" | null;
  inherit_settings: boolean;
  settings: Partial<ModelProfileSettings>;
  revision: number;
};

const text = (value: unknown) =>
  value === null || value === undefined ? "" : String(value);

/**
 * The runtime keys one profile sets. `inherited` holds the AI model
 * settings' values (opened key included) for an inheriting profile; a
 * profile with its own connection uses `key` (opened by the API).
 * Profile-only keys are set only where they differ from the default request,
 * so the default profile adds nothing a request or pin reads.
 */
export function profileRuntimeKeys(
  profile: ModelProfileRow,
  options: { key?: string | null; inherited?: Record<string, string | undefined> },
): Record<string, string> {
  const s = modelProfileSettingsSchema.parse({ ...profile.settings });
  const out: Record<string, string> = {
    [MODEL_PROFILE_KEYS.id]: profile.id,
    [MODEL_PROFILE_KEYS.label]: profile.label,
    [MODEL_PROFILE_KEYS.tier]: profile.tier,
  };
  if (profile.inherit_settings) {
    for (const key of INHERITED_KEYS) {
      const value = options.inherited?.[key];
      if (value !== undefined) out[key] = value;
    }
  } else {
    Object.assign(out, {
      MODEL_BASE_URL: text(s.baseUrl),
      MODEL_API_KEY: text(options.key),
      MODEL_NAME: text(s.model),
      MODEL_PROVIDER: text(s.provider),
      MODEL_REQUEST_STYLE: s.requestStyle,
      MODEL_REASONING_EFFORT: s.reasoningEffort,
      MODEL_VISION_ENABLED: s.vision ? "true" : "false",
      MODEL_INPUT_USD_PER_MILLION: text(s.inputUsdPerMillion),
      MODEL_OUTPUT_USD_PER_MILLION: text(s.outputUsdPerMillion),
      MODEL_PRICE_VERSION: text(s.priceVersion),
      MODEL_TIMEOUT_MULTIPLIER: text(s.timeoutMultiplier),
      MODEL_REASONING_TIMEOUT_MULTIPLIER: text(s.reasoningTimeoutMultiplier),
    });
  }
  // An inheriting profile always uses the compatible adapter (the settings' endpoint).
  const adapter = profile.inherit_settings ? "openai_compatible" : profile.adapter;
  out[MODEL_PROFILE_KEYS.adapter] = adapter === "openai_compatible" ? "" : adapter;
  out[MODEL_PROFILE_KEYS.sendTemperature] = s.sendTemperature ? "" : "false";
  out[MODEL_PROFILE_KEYS.jsonMode] = s.jsonMode ? "" : "false";
  out[MODEL_PROFILE_KEYS.defaultMaxTokens] = text(s.defaultMaxTokens);
  out[MODEL_PROFILE_KEYS.budgets] =
    s.budgets && Object.keys(s.budgets).length ? JSON.stringify(sortedBudgets(s.budgets)) : "";
  out[MODEL_PROFILE_KEYS.cacheRead] = text(s.cacheReadUsdPerMillion);
  out[MODEL_PROFILE_KEYS.cacheWrite] = text(s.cacheWriteUsdPerMillion);
  return out;
}
/** The AI model settings keys an inheriting profile takes as they are. */
export const INHERITED_KEYS = [
  "MODEL_BASE_URL",
  "MODEL_API_KEY",
  "MODEL_NAME",
  "MODEL_PROVIDER",
  "MODEL_REQUEST_STYLE",
  "MODEL_REASONING_EFFORT",
  "MODEL_VISION_ENABLED",
  "MODEL_INPUT_USD_PER_MILLION",
  "MODEL_OUTPUT_USD_PER_MILLION",
  "MODEL_PRICE_VERSION",
  "MODEL_TIMEOUT_MULTIPLIER",
  "MODEL_REASONING_TIMEOUT_MULTIPLIER",
] as const;
function sortedBudgets(budgets: NonNullable<ModelProfileSettings["budgets"]>) {
  return Object.fromEntries(
    Object.entries(budgets)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([task, entry]) => [
        task,
        Object.fromEntries(Object.entries(entry ?? {}).sort(([a], [b]) => a.localeCompare(b))),
      ]),
  );
}

/**
 * What a switch must keep: the request settings a qualification pins. A
 * change to any of these needs new evaluations; a label, name, tier or price
 * change does not (pins never include them).
 */
export function profileRequestFingerprint(profile: Pick<ModelProfileRow, "adapter" | "inherit_settings" | "settings">) {
  const s = modelProfileSettingsSchema.parse({ ...profile.settings });
  return JSON.stringify({
    adapter: profile.inherit_settings ? "openai_compatible" : profile.adapter,
    inherit: profile.inherit_settings,
    baseUrl: profile.inherit_settings ? null : (s.baseUrl ?? null),
    model: profile.inherit_settings ? null : (s.model ?? null),
    requestStyle: profile.inherit_settings ? null : s.requestStyle,
    reasoningEffort: profile.inherit_settings ? null : s.reasoningEffort,
    sendTemperature: s.sendTemperature,
    jsonMode: s.jsonMode,
    defaultMaxTokens: s.defaultMaxTokens,
    maxTokens: Object.fromEntries(
      Object.entries(s.budgets ?? {})
        .filter(([, e]) => e && "maxTokens" in e)
        .map(([task, e]) => [task, e!.maxTokens ?? null])
        .sort(([a], [b]) => String(a).localeCompare(String(b))),
    ),
  });
}

/** The label coaches see for the configured model (never the model ID). */
export function coachModelLabel(config: Record<string, string | undefined>) {
  return config[MODEL_PROFILE_KEYS.label]?.trim() || "Standard model";
}
/**
 * A qualification pin as a coach may receive it: the address and model ID
 * replaced by the profile label (what a coach sees), everything else kept.
 */
export function coachFacingPin<T extends Record<string, unknown> | null | undefined>(
  pin: T,
  config: Record<string, string | undefined>,
): T {
  if (!pin || typeof pin !== "object") return pin;
  const out: Record<string, unknown> = { ...pin };
  for (const key of ["endpoint", "base"]) if (key in out) out[key] = out[key] ? "configured" : null;
  if ("model" in out) out.model = out.model ? coachModelLabel(config) : null;
  return out as T;
}
