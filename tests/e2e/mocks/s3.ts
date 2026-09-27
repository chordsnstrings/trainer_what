/**
 * S3-compatible object storage double for off-server backup copies. Checks
 * AWS Signature Version 4 exactly as the controller signs it (host,
 * x-amz-content-sha256 and x-amz-date), that the declared payload hash matches
 * the body, and answers HEAD with the stored size. Objects stay in memory.
 * Test tooling only.
 */
import { createHash, createHmac, randomBytes } from "node:crypto";
import { MockServer } from "./http.ts";

const hmac = (key: Buffer | string, text: string) => createHmac("sha256", key).update(text).digest();

export class S3Mock {
  readonly server: MockServer;
  readonly bucket = "sandbox-backups";
  readonly region = "me-central-1";
  readonly accessKey = "AKIAMOCK" + randomBytes(6).toString("hex").toUpperCase();
  readonly secretKey = randomBytes(24).toString("base64url");
  objects = new Map<string, { bytes: number; sha256: string; contentType: string }>();
  rejected = 0;
  constructor(tlsMaterial: { key: string; cert: string }) {
    this.server = new MockServer("s3", tlsMaterial, { logBodies: false });
    this.server.raw = async (req, res) => {
      const path = new URL(req.url ?? "/", "https://mock.invalid").pathname;
      if (!["PUT", "HEAD"].includes(req.method ?? "") || !path.startsWith("/" + this.bucket + "/")) return false;
      await this.object(req, res, path);
      return true;
    };
  }
  get url() {
    return this.server.url;
  }
  /** Values the operator puts in the host's runtime settings (never in the app database). */
  settings() {
    return {
      BACKUP_S3_ENDPOINT: this.url,
      BACKUP_S3_BUCKET: this.bucket,
      BACKUP_S3_REGION: this.region,
      BACKUP_S3_ACCESS_KEY_ID: this.accessKey,
      BACKUP_S3_SECRET_ACCESS_KEY: this.secretKey,
      BACKUP_S3_PREFIX: "e2e/backups/",
    };
  }
  start(port = 0) {
    return this.server.start(port);
  }
  stop() {
    return this.server.stop();
  }
  private verify(method: string, path: string, headers: Record<string, any>, payloadHash: string) {
    const auth = String(headers.authorization ?? "");
    const match = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request, SignedHeaders=([a-z0-9;-]+), Signature=([0-9a-f]{64})$/.exec(auth);
    if (!match || match[1] !== this.accessKey || match[3] !== this.region) return false;
    const names = match[4].split(";");
    const date = String(headers["x-amz-date"] ?? "");
    const canonical = [
      method,
      path,
      "",
      names.map((n) => n + ":" + String(headers[n] ?? "").trim().split(/\s+/).join(" ") + "\n").join(""),
      names.join(";"),
      payloadHash,
    ].join("\n");
    const scope = `${match[2]}/${this.region}/s3/aws4_request`;
    const toSign = ["AWS4-HMAC-SHA256", date, scope, createHash("sha256").update(canonical).digest("hex")].join("\n");
    let key: Buffer = hmac("AWS4" + this.secretKey, match[2]);
    for (const part of [this.region, "s3", "aws4_request"]) key = hmac(key, part);
    return hmac(key, toSign).toString("hex") === match[5];
  }
  private async object(req: any, res: any, path: string) {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);
    const declared = String(req.headers["x-amz-content-sha256"] ?? "");
    const ok = this.verify(req.method, path, req.headers, declared);
    const objectKey = decodeURIComponent(path.slice(this.bucket.length + 2));
    this.server.log.push({ at: new Date().toISOString(), method: req.method, path, query: "", status: ok ? 200 : 403, headers: {} });
    if (!ok) {
      this.rejected++;
      res.writeHead(403, { "content-type": "application/xml" });
      return res.end("<Error><Code>SignatureDoesNotMatch</Code></Error>");
    }
    if (req.method === "HEAD") {
      const stored = this.objects.get(objectKey);
      res.writeHead(stored ? 200 : 404, stored ? { "content-length": String(stored.bytes) } : {});
      return res.end();
    }
    if (createHash("sha256").update(body).digest("hex") !== declared) {
      res.writeHead(400, { "content-type": "application/xml" });
      return res.end("<Error><Code>XAmzContentSHA256Mismatch</Code></Error>");
    }
    this.objects.set(objectKey, { bytes: body.length, sha256: declared, contentType: String(req.headers["content-type"] ?? "") });
    res.writeHead(200, { etag: '"' + createHash("md5").update(body).digest("hex") + '"' });
    res.end();
  }
}
