/**
 * WHOOP (v2 developer API) and Zepp partner gateway (canonical-observations-v1)
 * doubles: OAuth authorization with redirect, token exchange and refresh
 * (PKCE S256 for Zepp), paginated observation pages and revocation. Test-only.
 */
import { createHash } from "node:crypto";
import { MockServer, bearer, randomId, unauthorized, type MockRequest } from "./http.ts";

type Grant = { code: string; redirect: string; challenge?: string; scope: string };
type Token = { access: string; refresh: string; scope: string; revoked: boolean };

abstract class OAuthMock {
  readonly server: MockServer;
  protected grants = new Map<string, Grant>();
  tokens = new Map<string, Token>();
  revocations = 0;
  constructor(
    name: string,
    tlsMaterial: { key: string; cert: string },
    public clientId: string,
    public clientSecret: string,
  ) {
    this.server = new MockServer(name, tlsMaterial);
  }
  get url() {
    return this.server.url;
  }
  start(port = 0) {
    return this.server.start(port);
  }
  stop() {
    return this.server.stop();
  }
  protected authorize(r: MockRequest, pkce: boolean) {
    const q = r.query;
    if (q.get("client_id") !== this.clientId || q.get("response_type") !== "code")
      return { status: 400, body: { error: "invalid_request" } };
    if (pkce && q.get("code_challenge_method") !== "S256")
      return { status: 400, body: { error: "pkce_required" } };
    const code = randomId("code");
    this.grants.set(code, {
      code,
      redirect: q.get("redirect_uri") ?? "",
      challenge: q.get("code_challenge") ?? undefined,
      scope: q.get("scope") ?? "",
    });
    const target = new URL(q.get("redirect_uri") ?? "");
    target.searchParams.set("code", code);
    target.searchParams.set("state", q.get("state") ?? "");
    return { status: 302, headers: { location: target.toString() } };
  }
  protected token(r: MockRequest, pkce: boolean) {
    const f = r.form ?? {};
    if (f.client_id !== this.clientId || f.client_secret !== this.clientSecret)
      return { status: 401, body: { error: "invalid_client" } };
    let scope = "";
    if (f.grant_type === "authorization_code") {
      const grant = this.grants.get(f.code);
      if (!grant || grant.redirect !== f.redirect_uri)
        return { status: 400, body: { error: "invalid_grant" } };
      if (
        pkce &&
        createHash("sha256").update(String(f.code_verifier ?? "")).digest("base64url") !==
          grant.challenge
      )
        return { status: 400, body: { error: "invalid_grant", detail: "pkce" } };
      this.grants.delete(f.code);
      scope = grant.scope;
    } else if (f.grant_type === "refresh_token") {
      const previous = [...this.tokens.values()].find(
        (t) => t.refresh === f.refresh_token && !t.revoked,
      );
      if (!previous) return { status: 400, body: { error: "invalid_grant" } };
      previous.revoked = true;
      scope = previous.scope;
    } else return { status: 400, body: { error: "unsupported_grant_type" } };
    const token = {
      access: randomId("at"),
      refresh: randomId("rt"),
      scope,
      revoked: false,
    };
    this.tokens.set(token.access, token);
    return {
      body: {
        access_token: token.access,
        refresh_token: token.refresh,
        expires_in: 3600,
        scope,
        token_type: "bearer",
      },
    };
  }
  protected authorized(r: MockRequest) {
    const token = this.tokens.get(bearer(r));
    return token && !token.revoked ? token : null;
  }
}

const iso = (offsetHours: number) =>
  new Date(Date.now() - offsetHours * 3600000).toISOString();

export class WhoopMock extends OAuthMock {
  constructor(tlsMaterial: { key: string; cert: string }, clientId: string, clientSecret: string) {
    super("whoop", tlsMaterial, clientId, clientSecret);
    const s = this.server;
    s.route("GET", "/oauth/oauth2/auth", (r) => this.authorize(r, false));
    s.route("POST", "/oauth/oauth2/token", (r) => this.token(r, false));
    const page = (rows: any[]) => (r: MockRequest) => {
      if (!this.authorized(r)) return unauthorized();
      // Two pages exercise the adapter's nextToken handling.
      const second = r.query.get("nextToken") === "page-2";
      return {
        body: {
          records: second ? rows.slice(1) : rows.slice(0, 1),
          next_token: second || rows.length < 2 ? null : "page-2",
        },
      };
    };
    s.route(
      "GET",
      "/developer/v2/recovery",
      page([
        { cycle_id: 101, created_at: iso(30), updated_at: iso(30), score_state: "SCORED", score: { recovery_score: 71, resting_heart_rate: 52 } },
        { cycle_id: 102, created_at: iso(6), updated_at: iso(6), score_state: "SCORED", score: { recovery_score: 64, resting_heart_rate: 55 } },
      ]),
    );
    s.route(
      "GET",
      "/developer/v2/activity/sleep",
      page([
        { id: "sleep-1", start: iso(38), end: iso(30), score_state: "SCORED", score: { stage_summary: { total_light_sleep_time_milli: 12600000, total_slow_wave_sleep_time_milli: 5400000, total_rem_sleep_time_milli: 6300000 } } },
        { id: "sleep-2", start: iso(14), end: iso(6), score_state: "PENDING_SCORE", score: null },
      ]),
    );
    s.route(
      "GET",
      "/developer/v2/activity/workout",
      page([
        { id: "workout-1", start: iso(26), end: iso(25), score_state: "SCORED", score: { strain: 11.4, average_heart_rate: 128, max_heart_rate: 171, kilojoule: 1850 } },
      ]),
    );
    s.route("GET", "/developer/v2/cycle", page([]));
    s.route("DELETE", "/developer/v2/user/access", (r) => {
      const token = this.authorized(r);
      if (!token) return unauthorized();
      token.revoked = true;
      this.revocations++;
      return { status: 204 };
    });
  }
}

export class ZeppMock extends OAuthMock {
  constructor(tlsMaterial: { key: string; cert: string }, clientId: string, clientSecret: string) {
    super("zepp", tlsMaterial, clientId, clientSecret);
    const s = this.server;
    s.route("GET", "/oauth/authorize", (r) => this.authorize(r, true));
    s.route("POST", "/oauth/token", (r) => this.token(r, true));
    s.route("GET", "/v1/observations", (r) => {
      if (!this.authorized(r)) return unauthorized();
      return {
        body: {
          records: [
            { id: "zepp-steps-1", type: "steps", value: 8421, unit: "count", measuredAt: iso(20), sourceVersion: "zepp-gateway-v1" },
            { id: "zepp-hr-1", type: "average_heart_rate", value: 74, unit: "bpm", measuredAt: iso(20), sourceVersion: "zepp-gateway-v1" },
            { id: "zepp-sleep-1", type: "sleep_seconds", value: 25200, unit: "seconds", measuredAt: iso(12), sourceVersion: "zepp-gateway-v1" },
          ],
          next_token: null,
        },
      };
    });
    s.route("DELETE", "/v1/connection", (r) => {
      const token = this.authorized(r);
      if (!token) return unauthorized();
      token.revoked = true;
      this.revocations++;
      return { status: 204 };
    });
  }
}
