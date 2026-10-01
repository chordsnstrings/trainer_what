import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

/**
 * One envelope for every value sealed with the host encryption key.
 *
 * Current envelopes are `v2.<key id>.<iv>.<tag>.<body>` and are always written
 * with SECURITY_ENCRYPTION_KEY. SECURITY_ENCRYPTION_PREVIOUS_KEYS (comma or
 * whitespace separated, base64) are decrypt-only so a rotated key can be
 * retired after `npm run secrets:reseal`. Envelopes written before key ids
 * existed are still read with the active key, then each previous key.
 */
export type SealContext = {
  /** Purpose binding authenticated with current envelopes. */
  aad: string;
  /** Envelope written before key identifiers existed. */
  legacy: { format: "v1"; aad: string } | { format: "bare" };
};
export type SealedState = "active" | "legacy" | "previous" | "unreadable";
type Key = { id: string; secret: Buffer };

export class SealingUnavailable extends Error {
  constructor(readonly reason: "key_unavailable" | "unreadable") {
    super(
      reason === "key_unavailable"
        ? "The server encryption key is unavailable"
        : "A sealed value could not be opened with the configured keys",
    );
  }
}

export const sealContexts = {
  platformSetting: (integrationId: string, field: string): SealContext => ({
    aad: `platform-settings:${integrationId}:${field}`,
    legacy: {
      format: "v1",
      aad: `platform-settings:v1:${integrationId}:${field}`,
    },
  }),
  integration: (scope: string): SealContext => ({
    aad: "integration:" + scope,
    legacy: { format: "v1", aad: "integration-v1:" + scope },
  }),
  authenticator: (userId: string): SealContext => ({
    aad: "authenticator:" + userId,
    legacy: { format: "bare" },
  }),
  /** A model profile's API key (Super admin, model profiles). */
  modelProfile: (profileId: string, field: string): SealContext => ({
    aad: `model-profile:${profileId}:${field}`,
    legacy: { format: "bare" },
  }),
  /** A trainer's voice recording (binary envelope, sealBytes). */
  voiceSample: (tenantId: string, sampleId: string): SealContext => ({
    aad: `voice-sample:${tenantId}:${sampleId}`,
    legacy: { format: "bare" },
  }),
};

function decodeKey(value: string) {
  const key = Buffer.from(value.trim(), "base64");
  return key.length === 32 ? key : null;
}
/** Public, non-reversible identifier; never derived from anything but the key. */
export function encryptionKeyId(key: Buffer) {
  return createHash("sha256")
    .update("trainer-sealing-key-id:")
    .update(key)
    .digest("base64url")
    .slice(0, 12);
}
export function encryptionKeyring(env: NodeJS.ProcessEnv = process.env) {
  const decoded = decodeKey(env.SECURITY_ENCRYPTION_KEY ?? "");
  const active: Key | null = decoded
    ? { id: encryptionKeyId(decoded), secret: decoded }
    : null;
  const previous: Key[] = [];
  let invalidPrevious = 0;
  for (const entry of (env.SECURITY_ENCRYPTION_PREVIOUS_KEYS ?? "")
    .split(/[\s,]+/)
    .filter(Boolean)) {
    const key = decodeKey(entry);
    if (!key) {
      invalidPrevious++;
      continue;
    }
    const id = encryptionKeyId(key);
    if (id !== active?.id && !previous.some((item) => item.id === id))
      previous.push({ id, secret: key });
  }
  return { active, previous, invalidPrevious };
}
export function encryptionReady() {
  return Boolean(encryptionKeyring().active);
}

export function sealValue(context: SealContext, value: string) {
  const { active } = encryptionKeyring();
  if (!active) throw new SealingUnavailable("key_unavailable");
  const header = "v2." + active.id,
    iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", active.secret, iv);
  cipher.setAAD(Buffer.from(header + "|" + context.aad));
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    header,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    body.toString("base64url"),
  ].join(".");
}

function decrypt(key: Buffer, aad: string | null, [iv, tag, body]: string[]) {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(iv, "base64url"),
    { authTagLength: 16 },
  );
  if (aad !== null) decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(body, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/** Opens a value and reports whether it still depends on an older envelope or key. */
export function openSealedValue(
  context: SealContext,
  value: string,
): { value: string; state: Exclude<SealedState, "unreadable"> } {
  const ring = encryptionKeyring();
  if (!ring.active) throw new SealingUnavailable("key_unavailable");
  const keys = [ring.active, ...ring.previous],
    parts = value.split(".");
  if (parts[0] === "v2" && parts.length === 5) {
    const key = keys.find((item) => item.id === parts[1]);
    if (key)
      try {
        return {
          value: decrypt(
            key.secret,
            `v2.${key.id}|${context.aad}`,
            parts.slice(2),
          ),
          state: key === ring.active ? "active" : "previous",
        };
      } catch {
        // Fall through to the uniform failure below.
      }
  } else if (
    context.legacy.format === "v1"
      ? parts[0] === "v1" && parts.length === 4
      : parts.length === 3
  ) {
    const aad = context.legacy.format === "v1" ? context.legacy.aad : null;
    for (const key of keys)
      try {
        return {
          value: decrypt(key.secret, aad, parts.slice(-3)),
          state: key === ring.active ? "legacy" : "previous",
        };
      } catch {
        // Try the next configured key.
      }
  }
  throw new SealingUnavailable("unreadable");
}

/**
 * Binary envelope for private files kept only briefly (trainer voice
 * recordings, docs/features/trainer-voice.md): `v2.<key id>.` in ASCII, then
 * the 12-byte IV, the 16-byte tag and the AES-256-GCM body. The purpose (AAD)
 * binds it to its workspace and row, like sealValue.
 */
const BYTES_HEADER = 16;
export function sealBytes(context: SealContext, value: Buffer): Buffer {
  const { active } = encryptionKeyring();
  if (!active) throw new SealingUnavailable("key_unavailable");
  const header = "v2." + active.id,
    iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", active.secret, iv);
  cipher.setAAD(Buffer.from(header + "|" + context.aad));
  const body = Buffer.concat([cipher.update(value), cipher.final()]);
  return Buffer.concat([
    Buffer.from(header + ".", "ascii"),
    iv,
    cipher.getAuthTag(),
    body,
  ]);
}
export function openSealedBytes(context: SealContext, value: Buffer): Buffer {
  const ring = encryptionKeyring();
  if (!ring.active) throw new SealingUnavailable("key_unavailable");
  const header = value.subarray(0, BYTES_HEADER).toString("ascii");
  const key = [ring.active, ...ring.previous].find(
    (item) => header === "v2." + item.id + ".",
  );
  if (!key || value.length < BYTES_HEADER + 28)
    throw new SealingUnavailable("unreadable");
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key.secret,
      value.subarray(BYTES_HEADER, BYTES_HEADER + 12),
      { authTagLength: 16 },
    );
    decipher.setAAD(Buffer.from(`v2.${key.id}|${context.aad}`));
    decipher.setAuthTag(value.subarray(BYTES_HEADER + 12, BYTES_HEADER + 28));
    return Buffer.concat([
      decipher.update(value.subarray(BYTES_HEADER + 28)),
      decipher.final(),
    ]);
  } catch {
    throw new SealingUnavailable("unreadable");
  }
}
