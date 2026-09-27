/**
 * Harness HTTP client: one instance per simulated person. Sends requests to
 * the public app URL (through the local TLS edge and the web proxy), keeps
 * that person's cookies, sends the same-origin Origin header on mutations and
 * gives each person their own client address via the harness edge.
 */
import { createHmac } from "node:crypto";

export class HttpError extends Error {
  constructor(
    public status: number,
    public body: any,
    public method: string,
    public path: string,
  ) {
    super(
      `${method} ${path} → ${status}: ${
        typeof body === "string" ? body.slice(0, 300) : JSON.stringify(body).slice(0, 600)
      }`,
    );
  }
  get code(): string | undefined {
    return this.body?.code;
  }
}
export type Response<T = any> = {
  status: number;
  body: T;
  text: string;
  headers: Headers;
};

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function decode32(value: string) {
  let bits = 0,
    n = 0;
  const out: number[] = [];
  for (const c of value.replace(/=+$/, "")) {
    const v = alphabet.indexOf(c);
    if (v < 0) throw new Error("Invalid base32");
    n = (n << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((n >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
export function totp(secret: string, counter: number) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decode32(secret)).update(b).digest();
  const offset = digest[19] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, "0");
}

let nextIp = 10;
export class Client {
  static rateLimitWaits: Array<{ who: string; path: string; seconds: number }> = [];
  cookies = new Map<string, string>();
  readonly ip: string;
  mfaSecret?: string;
  recoveryCodes: string[] = [];
  /** Last authenticator counter used; shared by every device of the same person. */
  mfaCounter = { last: -1 };
  userId?: string;
  tenantId?: string;
  constructor(
    public base: string,
    public label: string,
    public email = "",
    public password = "",
  ) {
    const n = nextIp++;
    this.ip = `10.77.${Math.floor(n / 250)}.${(n % 250) + 1}`;
  }
  get origin() {
    return new URL(this.base).origin;
  }
  async request<T = any>(
    method: string,
    path: string,
    body?: unknown,
    options: { headers?: Record<string, string>; raw?: boolean; noRetry?: boolean } = {},
  ): Promise<Response<T>> {
    const headers: Record<string, string> = {
      "x-e2e-client-ip": this.ip,
      ...(options.headers ?? {}),
    };
    if (this.cookies.size)
      headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    if (!["GET", "HEAD"].includes(method)) headers.origin ??= this.origin;
    let payload: string | Buffer | undefined;
    if (body !== undefined) {
      if (Buffer.isBuffer(body) || typeof body === "string") payload = body as any;
      else {
        payload = JSON.stringify(body);
        headers["content-type"] ??= "application/json";
      }
    }
    let response: globalThis.Response;
    for (let attempt = 0; ; attempt++) {
      response = await fetch(new URL(path, this.base), {
        method,
        headers,
        body: payload as any,
        redirect: "manual",
        signal: AbortSignal.timeout(120000),
      });
      // The production request budgets stay in force; a well-behaved client
      // waits for the advertised window instead of failing the scenario.
      if (response.status !== 429 || attempt >= 6 || options.noRetry) break;
      const text = await response.text();
      const seconds = Number(
        response.headers.get("retry-after") ?? /retry in (\d+) seconds/.exec(text)?.[1] ?? 10,
      );
      Client.rateLimitWaits.push({ who: this.label, path, seconds });
      await new Promise((r) => setTimeout(r, Math.min(Math.max(seconds, 1), 120) * 1000 + 250));
    }
    for (const cookie of response.headers.getSetCookie()) {
      const [pair, ...attributes] = cookie.split(";");
      const [name, ...rest] = pair.split("=");
      const value = rest.join("=");
      const expired = attributes.some(
        (a) =>
          /^\s*max-age=0\s*$/i.test(a) ||
          (/^\s*expires=/i.test(a) && Date.parse(a.split("=").slice(1).join("=")) < Date.now()),
      );
      if (expired || value === "") this.cookies.delete(name.trim());
      else this.cookies.set(name.trim(), value);
    }
    const text = options.raw ? "" : await response.text();
    let parsed: any = text;
    if (!options.raw)
      try {
        parsed = text ? JSON.parse(text) : undefined;
      } catch {}
    return { status: response.status, body: parsed, text, headers: response.headers };
  }
  /** Request that must succeed (2xx); returns the parsed body. */
  async ok<T = any>(method: string, path: string, body?: unknown, headers?: Record<string, string>) {
    const r = await this.request<T>(method, path, body, { headers });
    if (r.status >= 300) throw new HttpError(r.status, r.body, method, path);
    return r.body;
  }
  /** Request that must fail with the given status (and optional code). */
  async fails(status: number, method: string, path: string, body?: unknown, code?: string) {
    const r = await this.request(method, path, body);
    if (r.status !== status || (code && r.body?.code !== code))
      throw new Error(
        `Expected ${status}${code ? " " + code : ""} from ${method} ${path}, got ${r.status}: ${r.text.slice(0, 300)}`,
      );
    return r.body;
  }
  get = <T = any>(path: string) => this.ok<T>("GET", path);
  post = <T = any>(path: string, body: unknown = {}) => this.ok<T>("POST", path, body);
  put = <T = any>(path: string, body: unknown = {}) => this.ok<T>("PUT", path, body);
  patch = <T = any>(path: string, body: unknown = {}) => this.ok<T>("PATCH", path, body);
  del = <T = any>(path: string, body?: unknown) => this.ok<T>("DELETE", path, body);

  /** A never-before-used authenticator code; waits for the next 30-second window when needed. */
  async freshCode() {
    if (!this.mfaSecret) throw new Error(this.label + " has no authenticator");
    for (;;) {
      const counter = Math.floor(Date.now() / 30000);
      if (counter > this.mfaCounter.last) {
        this.mfaCounter.last = counter;
        return totp(this.mfaSecret, counter);
      }
      await new Promise((r) => setTimeout(r, 30000 - (Date.now() % 30000) + 200));
    }
  }
  /** When this session last proved a fresh authenticator code (the server honours ten minutes). */
  private mfaFreshAt = 0;
  /**
   * Sends a request that carries a one-time authenticator code. A rate-limited
   * attempt is retried with a new code after the advertised wait, because a
   * code computed before the wait would be stale.
   */
  private async withCode(path: string, body: (code?: string) => Record<string, unknown>) {
    for (let attempt = 0; ; attempt++) {
      const code = this.mfaSecret ? await this.freshCode() : undefined;
      const r = await this.request("POST", path, body(code), { noRetry: true });
      if (r.status === 429 && attempt < 4) {
        const seconds = Number(r.headers.get("retry-after") ?? /retry in (\d+) seconds/.exec(r.text)?.[1] ?? 30);
        Client.rateLimitWaits.push({ who: this.label, path, seconds });
        await new Promise((resolve) => setTimeout(resolve, Math.min(Math.max(seconds, 1), 300) * 1000 + 250));
        continue;
      }
      if (r.status >= 300) throw new HttpError(r.status, r.body, "POST", path);
      if (code) this.mfaFreshAt = Date.now();
      return r.body;
    }
  }
  async login(extra: Record<string, unknown> = {}) {
    await this.withCode("/api/v1/auth/login", (code) => ({
      email: this.email,
      password: this.password,
      ...(code ? { code } : {}),
      ...extra,
    }));
    const boot = await this.get("/api/v1/bootstrap");
    this.userId = boot.user.userId;
    this.tenantId = boot.user.tenantId;
    return boot;
  }
  /**
   * Fresh authenticator verification for step-up actions (valid ten minutes on
   * the server). A session verified in the last eight minutes is reused, as a
   * person would, instead of spending the per-account verification budget.
   */
  async stepUp(force = false) {
    if (!force && Date.now() - this.mfaFreshAt < 8 * 60000) return;
    await this.withCode("/api/v1/auth/mfa/verify", (code) => ({ password: this.password, code }));
  }
  /** Like ok(), but performs a fresh authenticator step-up when the server asks for one. */
  async okMfa<T = any>(method: string, path: string, body?: unknown) {
    const r = await this.request<T>(method, path, body);
    if (r.status === 403 && (r.body as any)?.code === "MFA_STEP_UP" && this.mfaSecret) {
      await this.stepUp(true);
      return this.ok<T>(method, path, body);
    }
    if (r.status >= 300) throw new HttpError(r.status, r.body, method, path);
    return r.body;
  }
  /** The same person on another device: own cookies and address, same credentials and authenticator. */
  device(label: string) {
    const other = new Client(this.base, label, this.email, this.password);
    other.mfaSecret = this.mfaSecret;
    other.mfaCounter = this.mfaCounter;
    other.recoveryCodes = this.recoveryCodes;
    other.userId = this.userId;
    other.tenantId = this.tenantId;
    return other;
  }
  /** Enrols an authenticator (requires a verified email) and returns recovery codes. */
  async enrollMfa() {
    const enrolled = await this.post("/api/v1/auth/mfa/enroll", { password: this.password });
    this.mfaSecret = enrolled.secret;
    const confirmed = await this.post("/api/v1/auth/mfa/confirm", { code: await this.freshCode() });
    this.recoveryCodes = confirmed.recoveryCodes as string[];
    this.mfaFreshAt = Date.now();
    return this.recoveryCodes;
  }
}
