/**
 * Web push service double. Browsers hand the app an endpoint URL; in the
 * sandbox the scenario registers endpoints on this server, which captures
 * each delivery and verifies the VAPID JWT (ES256) the app signed. Test-only.
 */
import { createPublicKey, verify } from "node:crypto";
import { MockServer, randomId } from "./http.ts";

export type CapturedPush = {
  subscription: string;
  at: string;
  ttl: string | undefined;
  urgency: string | undefined;
  topic: string | undefined;
  vapidValid: boolean;
  audience: string | null;
  subject: string | null;
  bodyBytes: number;
};

export function verifyVapid(header: string | undefined, origin: string) {
  const match = /vapid\s+t=([^,\s]+),\s*k=([A-Za-z0-9_-]+)/i.exec(header ?? "");
  if (!match) return { valid: false, audience: null, subject: null };
  const [token, key] = [match[1], match[2]];
  const [head, body, signature] = token.split(".");
  try {
    const raw = Buffer.from(key, "base64url");
    const publicKey = createPublicKey({
      key: {
        kty: "EC",
        crv: "P-256",
        x: raw.subarray(1, 33).toString("base64url"),
        y: raw.subarray(33, 65).toString("base64url"),
      },
      format: "jwk",
    });
    const valid = verify(
      "sha256",
      Buffer.from(`${head}.${body}`),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(signature, "base64url"),
    );
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return {
      valid:
        valid &&
        claims.aud === origin &&
        typeof claims.exp === "number" &&
        claims.exp * 1000 > Date.now(),
      audience: claims.aud ?? null,
      subject: claims.sub ?? null,
    };
  } catch {
    return { valid: false, audience: null, subject: null };
  }
}

export class PushMock {
  readonly server: MockServer;
  readonly deliveries: CapturedPush[] = [];
  /** Status to answer (201 accepted, 404/410 gone, 429 rate limited). */
  responseStatus = 201;
  constructor(tlsMaterial: { key: string; cert: string }) {
    this.server = new MockServer("push", tlsMaterial, { logBodies: false });
    this.server.route("POST", "/push/:id", (r) => {
      const vapid = verifyVapid(
        String(r.headers.authorization ?? ""),
        this.server.url,
      );
      this.deliveries.push({
        subscription: r.params.id,
        at: new Date().toISOString(),
        ttl: r.headers.ttl as string | undefined,
        urgency: r.headers.urgency as string | undefined,
        topic: r.headers.topic as string | undefined,
        vapidValid: vapid.valid,
        audience: vapid.audience,
        subject: vapid.subject,
        bodyBytes: Buffer.byteLength(r.rawBody),
      });
      return {
        status: this.responseStatus,
        headers: (this.responseStatus === 429
          ? { "retry-after": "60" }
          : {}) as Record<string, string>,
      };
    });
  }
  get url() {
    return this.server.url;
  }
  /** A browser-like endpoint for one simulated device. */
  endpoint() {
    return `${this.server.url}/push/${randomId("dev")}`;
  }
  start(port = 0) {
    return this.server.start(port);
  }
  stop() {
    return this.server.stop();
  }
}
