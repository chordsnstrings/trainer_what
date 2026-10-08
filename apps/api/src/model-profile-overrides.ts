/**
 * The active and fallback model profiles as runtime keys for one request or
 * job (docs/features/model-profiles.md), read by loadRuntimeSettings
 * (platform-settings.ts). Kept apart from the Super admin routes
 * (model-profiles.ts) so the settings loader has no import cycle.
 */
import type { Tx } from "@trainer/db";
import { MODEL_PROFILE_KEYS } from "../../../packages/providers/src/model-request.ts";
import {
  INHERITED_KEYS,
  profileRequestFingerprint,
  profileRuntimeKeys,
  type ModelProfileRow,
} from "../../../packages/providers/src/model-profiles.ts";
import { openSealedValue, sealContexts } from "./sealing.ts";

export type Row = ModelProfileRow & {
  encrypted_secrets: Record<string, string>;
  last_test: { status: string; message: string; checkedAt: string; fingerprint: string } | null;
  updated_at?: string;
};
export const KEY_FIELD = "MODEL_API_KEY";

export function openKey(row: Pick<Row, "id" | "encrypted_secrets">): string | null {
  const sealed = row.encrypted_secrets?.[KEY_FIELD];
  if (!sealed) return null;
  try {
    return openSealedValue(sealContexts.modelProfile(row.id, KEY_FIELD), sealed).value;
  } catch {
    return null;
  }
}
export const fingerprint = (row: Row) => profileRequestFingerprint(row);
/** The connection test counts for the profile's current request settings only. */
export const tested = (row: Row) =>
  row.inherit_settings ||
  (row.last_test?.status === "verified" && row.last_test.fingerprint === fingerprint(row));

/**
 * The runtime keys of the active profile (and the fallback profile's, as
 * JSON) for one request or job. `base` holds the AI model settings' values
 * already in effect (the environment's when nothing is saved); an inheriting
 * profile adds no identity keys of its own, so its requests are unchanged.
 * When the AI model settings are switched off, no profile switches them on.
 */
export async function modelProfileOverrides(
  tx: Tx,
  base: Record<string, string | undefined>,
  modelEnabled: boolean,
): Promise<Record<string, string>> {
  if (!modelEnabled) return {};
  const rows = await tx.query<Row>("SELECT * FROM model_profiles WHERE role IS NOT NULL");
  const active = rows.find((r) => r.role === "active");
  if (!active) return {};
  const out = profileRuntimeKeys(active, { key: active.inherit_settings ? undefined : openKey(active), inheritedModel: base.MODEL_NAME });
  // The public "frontier" availability: a frontier profile whose latest
  // switch check passed for its current request settings.
  const checks = await latestChecks(tx, [active.id]);
  out[MODEL_PROFILE_FRONTIER] =
    out[MODEL_PROFILE_KEYS.tier] === "frontier" && checkPassedFor(checks.get(active.id), active) ? "true" : "";
  const fallback = rows.find((r) => r.role === "fallback");
  out[MODEL_PROFILE_KEYS.fallback] = "";
  if (fallback) {
    const inherited = fallback.inherit_settings
      ? Object.fromEntries(INHERITED_KEYS.map((k) => [k, base[k] ?? ""]))
      : undefined;
    const keys = profileRuntimeKeys(fallback, {
      key: fallback.inherit_settings ? undefined : openKey(fallback),
      inherited,
    });
    if (keys.MODEL_BASE_URL && keys.MODEL_API_KEY && keys.MODEL_NAME)
      out[MODEL_PROFILE_KEYS.fallback] = JSON.stringify(keys);
  }
  // Only what differs from the default reaches the runtime: a blank profile
  // key reads as its default, and the untouched default profile (inheriting,
  // standard, "Standard model") adds nothing, so its requests, cost rows and
  // runtime settings are exactly those from before profiles existed. A
  // profile with its own connection keeps its blank identity keys, which
  // must replace the AI model settings' values.
  const identity = new Set<string>(active.inherit_settings ? [] : INHERITED_KEYS);
  for (const [key, value] of Object.entries(out))
    if (value === "" && !identity.has(key)) delete out[key];
  if (active.inherit_settings && out[MODEL_PROFILE_KEYS.tier] === "standard" && out[MODEL_PROFILE_KEYS.label] === "Standard model")
    for (const key of [MODEL_PROFILE_KEYS.id, MODEL_PROFILE_KEYS.label, MODEL_PROFILE_KEYS.tier])
      delete out[key];
  return out;
}
/** Runtime key: the active profile is frontier tier and passed its switch check. */
export const MODEL_PROFILE_FRONTIER = "MODEL_PROFILE_FRONTIER";

export async function latestChecks(tx: Tx, ids: string[]) {
  const rows = await tx.query<{ profile_id: string; id: string; status: string; report: any; created_at: string; completed_at: string | null; profile_revision: number }>(
    "SELECT DISTINCT ON (profile_id) profile_id,id,status,report,created_at,completed_at,profile_revision FROM model_switch_checks WHERE profile_id=ANY($1::uuid[]) ORDER BY profile_id,created_at DESC,id DESC",
    [ids],
  );
  return new Map(rows.map((r) => [r.profile_id, r]));
}
export function checkPassedFor(check: { status: string; report: any } | undefined, row: Row) {
  return check?.status === "passed" && check.report?.fingerprint === fingerprint(row);
}

