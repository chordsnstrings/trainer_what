/**
 * Software passkey (WebAuthn platform authenticator) for the harness: ES256
 * key pair, "none" attestation, user presence and verification always
 * asserted. It produces the same JSON a browser hands to the server after
 * navigator.credentials.create()/get(), so the real registration and sign-in
 * routes are exercised without a browser.
 */
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";

const b64url = (value: Buffer | Uint8Array) => Buffer.from(value).toString("base64url");
const sha256 = (value: Buffer | string) => createHash("sha256").update(value).digest();

/** Minimal CBOR encoder: unsigned/negative integers, byte strings, text strings and maps. */
export function cbor(value: unknown): Buffer {
  const head = (major: number, length: number) => {
    if (length < 24) return Buffer.from([(major << 5) | length]);
    if (length < 256) return Buffer.from([(major << 5) | 24, length]);
    if (length < 65536) return Buffer.from([(major << 5) | 25, length >> 8, length & 255]);
    const b = Buffer.alloc(5);
    b[0] = (major << 5) | 26;
    b.writeUInt32BE(length, 1);
    return b;
  };
  if (typeof value === "number") return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return Buffer.concat([head(2, value.length), Buffer.from(value)]);
  if (typeof value === "string") {
    const bytes = Buffer.from(value, "utf8");
    return Buffer.concat([head(3, bytes.length), bytes]);
  }
  if (value instanceof Map)
    return Buffer.concat([head(5, value.size), ...[...value].flatMap(([k, v]) => [cbor(k), cbor(v)])]);
  if (value && typeof value === "object") return cbor(new Map(Object.entries(value)));
  throw new Error("Unsupported CBOR value");
}

export class SoftwarePasskey {
  readonly credentialId = randomBytes(32);
  private readonly privateKey: KeyObject;
  private readonly publicJwk: { x: string; y: string };
  private counter = 0;
  userHandle = "";
  constructor(readonly origin: string) {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    this.privateKey = privateKey;
    const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
    this.publicJwk = { x: jwk.x, y: jwk.y };
  }
  get id() {
    return b64url(this.credentialId);
  }
  private authData(rpId: string, attested: boolean) {
    const flags = 0x01 | 0x04 | (attested ? 0x40 : 0); // user present, user verified, attested data
    const count = Buffer.alloc(4);
    count.writeUInt32BE(this.counter);
    const parts: Buffer[] = [sha256(rpId), Buffer.from([flags]), count];
    if (attested) {
      const idLength = Buffer.alloc(2);
      idLength.writeUInt16BE(this.credentialId.length);
      const coseKey = new Map<number, unknown>([
        [1, 2], // kty: EC2
        [3, -7], // alg: ES256
        [-1, 1], // crv: P-256
        [-2, Buffer.from(this.publicJwk.x, "base64url")],
        [-3, Buffer.from(this.publicJwk.y, "base64url")],
      ]);
      parts.push(Buffer.alloc(16), idLength, this.credentialId, cbor(coseKey));
    }
    return Buffer.concat(parts);
  }
  private clientData(type: "webauthn.create" | "webauthn.get", challenge: string) {
    return Buffer.from(JSON.stringify({ type, challenge, origin: this.origin, crossOrigin: false }));
  }
  /** Response for navigator.credentials.create() given the server's registration options. */
  register(options: { challenge: string; rp: { id?: string }; user: { id: string } }) {
    const rpId = options.rp.id ?? new URL(this.origin).hostname;
    this.userHandle = options.user.id;
    const attestationObject = cbor(new Map<string, unknown>([["fmt", "none"], ["attStmt", new Map()], ["authData", this.authData(rpId, true)]]));
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      response: {
        clientDataJSON: b64url(this.clientData("webauthn.create", options.challenge)),
        attestationObject: b64url(attestationObject),
        transports: ["internal"],
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }
  /** Response for navigator.credentials.get() given the server's authentication options. */
  authenticate(options: { challenge: string; rpId?: string }) {
    const rpId = options.rpId ?? new URL(this.origin).hostname;
    this.counter++;
    const authenticatorData = this.authData(rpId, false);
    const clientDataJSON = this.clientData("webauthn.get", options.challenge);
    const signature = sign("sha256", Buffer.concat([authenticatorData, sha256(clientDataJSON)]), this.privateKey);
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      response: {
        clientDataJSON: b64url(clientDataJSON),
        authenticatorData: b64url(authenticatorData),
        signature: b64url(signature),
        userHandle: this.userHandle,
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }
}
