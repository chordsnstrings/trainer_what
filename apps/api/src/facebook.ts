// The optional "Connect Facebook" read used by the trainer's Facebook Page
// estimate (packages/domain facebook-calculator.ts).
//
// Facebook Login for Business with a user access token configuration (the
// Pages asset; pages_show_list and pages_read_engagement). In the callback the
// person's token and the chosen Page's token are used once to read the Page's
// follower count and the reactions, comments and shares on its recent posts,
// then discarded. Only the resulting numbers are stored, as a workspace record
// the owner can delete: no token, Page ID or Facebook user ID is kept. Before
// Meta app review only the workspaces the operator lists may connect
// (metaConnectAccess in marketing.ts, shared with Connect Instagram).
import { createHmac } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { event, putRecord, type Actor, type Database } from "@trainer/db";
import {
  integrationCapability,
  providerRequest,
  runtimeConfig,
  type RuntimeConfig,
} from "../../../packages/providers/src/configuration.ts";
import { followerModelFromSettings } from "../../../packages/domain/src/marketing-calculators.ts";
import { facebookEngagementRate } from "../../../packages/domain/src/facebook-calculator.ts";
import { newToken, tokenHash } from "./auth.ts";
import { metaConnectAccess } from "./marketing.ts";

const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });

/**
 * The one Graph API version for the login dialog and every call: Meta's
 * latest on 3 November 2026 (each version runs for at least two years). An
 * unversioned call would follow the App Dashboard's default instead.
 */
export const FACEBOOK_GRAPH_VERSION = "v26.0";
const GRAPH = `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}`;

export type FacebookSnapshot = {
  /** The Page's name, at most 60 characters. */
  pageName: string;
  followers: number;
  /** Page likes (fan_count); null when Facebook did not share them. */
  pageLikes: number | null;
  /**
   * Mean (reactions + comments + shares) per sampled post ÷ followers × 100;
   * null when unknown (no followers or no sampled posts).
   */
  engagementRatePct: number | null;
  /** Recent posts that came with reaction or comment totals (at most 12). */
  postsSampled: number;
  /**
   * Pages shared in the sign-in (at most 50 are read). The numbers come from
   * the usable one with the most followers, named by pageName.
   */
  pagesShared: number;
  fetchedAt: string;
};
/** Replaceable only by nonproduction fixtures (buildApp providers). */
export type FacebookTransport = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;
export type FacebookSettings = {
  appId: string;
  secret: string;
  redirect: string;
  configId: string;
};

/**
 * The Facebook app settings, once configured and approved (or listed for
 * testing); whether this workspace may use them is metaConnectAccess's call.
 */
export function facebookConfig(
  config: RuntimeConfig = runtimeConfig(),
): FacebookSettings | null {
  const capability = integrationCapability("facebook", config);
  if (!capability?.configured || !(capability.approved || capability.testing))
    return null;
  return {
    appId: config.FACEBOOK_APP_ID!.trim(),
    secret: config.FACEBOOK_APP_SECRET!.trim(),
    redirect: config.FACEBOOK_REDIRECT_URI!.trim(),
    configId: config.FACEBOOK_LOGIN_CONFIG_ID!.trim(),
  };
}
/** The login dialog. The configuration names the permissions: no scope. */
export function facebookAuthorizeUrl(
  settings: Pick<FacebookSettings, "appId" | "redirect" | "configId">,
  state: string,
) {
  const url = new URL(
    `https://www.facebook.com/${FACEBOOK_GRAPH_VERSION}/dialog/oauth`,
  );
  url.searchParams.set("client_id", settings.appId);
  url.searchParams.set("redirect_uri", settings.redirect);
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("config_id", settings.configId);
  // User-token configurations may default to a token in the address; the
  // server-side exchange needs the code.
  url.searchParams.set("override_default_response_type", "true");
  return url.toString();
}

/** Graph rate limits: app, user, Pages, application, custom, Page account. */
const BUSY_CODES = new Set([4, 17, 32, 341, 613, 80001]);
type GraphDetail = {
  code: number | null;
  subcode: number | null;
  traceId: string | null;
};
/**
 * Internal codes the callback maps to outcomes. Meta's message is never shown
 * or logged; only its numbers and trace ID are kept, for the log line.
 */
function failure(code: string, message: string, graph?: GraphDetail) {
  return Object.assign(new Error(message), { statusCode: 502, code, graph });
}
/**
 * A Graph answer, or the matching internal code. `access` names the token
 * the call used: none yet (the code exchange), the person's, or a Page's.
 */
async function graphJson(response: Response, access: "app" | "user" | "page") {
  if (response.ok) return (await response.json()) as any;
  const error = ((await response.json().catch(() => null)) as any)?.error;
  const whole = (value: unknown) =>
    Number.isSafeInteger(value) ? (value as number) : null;
  const graph: GraphDetail = {
    code: whole(error?.code),
    subcode: whole(error?.error_subcode),
    traceId:
      typeof error?.fbtrace_id === "string" &&
      /^[\w-]{1,64}$/.test(error.fbtrace_id)
        ? error.fbtrace_id
        : null,
  };
  const code = graph.code ?? 0;
  if (BUSY_CODES.has(code))
    throw failure("FACEBOOK_BUSY", "Facebook is busy.", graph);
  if (access !== "app") {
    // The access expired or was withdrawn part-way: connect again. A
    // checkpointed or unconfirmed account (459, 464) must first be fixed on
    // facebook.com, so connecting again would not help: failed. No suitable
    // Page role (492) arrives with 190 or 102 too and is handled below, since
    // connecting again cannot fix it either.
    if (
      (code === 190 || code === 102) &&
      graph.subcode !== 459 &&
      graph.subcode !== 464 &&
      graph.subcode !== 492
    )
      throw failure("FACEBOOK_EXPIRED", "The Facebook sign-in expired.", graph);
    // A missing permission or no suitable role (subcode 492): the Page's
    // access for a Page token, the person's permissions for their own token.
    if (code === 10 || (code >= 200 && code <= 299) || graph.subcode === 492)
      throw access === "page"
        ? failure("FACEBOOK_PAGE_ACCESS", "The Page role is not enough.", graph)
        : failure("FACEBOOK_PERMISSIONS", "A permission is missing.", graph);
  }
  throw failure("FACEBOOK_UNAVAILABLE", "Facebook refused the request.", graph);
}
/**
 * A Graph read. The token goes in the Authorization header, never in the
 * address, with appsecret_proof (the token's HMAC keyed with the app secret)
 * so the app can require that every call is signed by it.
 */
function graphGet(
  transport: FacebookTransport,
  path: string,
  params: Record<string, string>,
  token: string,
  secret: string,
) {
  const url = new URL(GRAPH + path);
  for (const [key, value] of Object.entries(params))
    url.searchParams.set(key, value);
  url.searchParams.set(
    "appsecret_proof",
    createHmac("sha256", secret).update(token).digest("hex"),
  );
  return transport(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  });
}
/** A whole count of zero or more, or null. */
function count(value: unknown): number | null {
  const n =
    typeof value === "string" && /^\d{1,15}$/.test(value)
      ? Number(value)
      : value;
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/**
 * Exchanges the one-time code, checks both permissions, reads the shared
 * Pages and the recent posts of the usable Page with the most followers, and
 * returns only the numbers. The tokens never leave this function.
 */
export async function readFacebookSnapshot(
  settings: FacebookSettings,
  code: string,
  transport: FacebookTransport = providerRequest,
  now = new Date(),
): Promise<FacebookSnapshot> {
  // Meta documents the exchange as a GET. Its address holds the secret and
  // the code, so it is never logged (nor is any other request address).
  const exchange = new URL(GRAPH + "/oauth/access_token");
  exchange.searchParams.set("client_id", settings.appId);
  exchange.searchParams.set("redirect_uri", settings.redirect);
  exchange.searchParams.set("client_secret", settings.secret);
  exchange.searchParams.set("code", code);
  const exchanged = await graphJson(
    await transport(exchange.toString(), {
      signal: AbortSignal.timeout(15000),
    }),
    "app",
  );
  const token =
    typeof exchanged?.access_token === "string" ? exchanged.access_token : "";
  if (!token)
    throw failure("FACEBOOK_UNAVAILABLE", "Facebook returned no access.");
  const read = async (
    path: string,
    params: Record<string, string>,
    access: "user" | "page",
    bearer: string,
  ) =>
    graphJson(
      await graphGet(transport, path, params, bearer, settings.secret),
      access,
    );

  // Login for Business grants all or nothing, but a permission can be
  // removed afterwards in Facebook's settings.
  const permissions = await read("/me/permissions", {}, "user", token);
  const granted = new Set(
    (Array.isArray(permissions?.data) ? permissions.data : [])
      .filter((p: any) => p?.status === "granted")
      .map((p: any) => p?.permission),
  );
  if (!granted.has("pages_show_list") || !granted.has("pages_read_engagement"))
    throw failure("FACEBOOK_PERMISSIONS", "A permission is missing.");

  // At most two pages of 25 Pages. The next link carries the token in its
  // address, so only its cursor is reused.
  const pages: any[] = [];
  let after = "";
  for (let request = 0; request < 2; request++) {
    const listed = await read(
      "/me/accounts",
      {
        fields: "id,name,tasks,access_token,followers_count,fan_count",
        limit: "25",
        ...(after ? { after } : {}),
      },
      "user",
      token,
    );
    if (Array.isArray(listed?.data)) pages.push(...listed.data.slice(0, 25));
    const cursor = listed?.paging?.cursors?.after;
    if (!listed?.paging?.next || typeof cursor !== "string") break;
    if (!cursor || cursor.length > 1000) break;
    after = cursor;
  }
  if (!pages.length)
    throw failure("FACEBOOK_NO_PAGE", "No Facebook Page was shared.");
  // A Page token comes only with a role on the Page, and reading the Page
  // needs the MODERATE task.
  const usable = pages.filter(
    (p) =>
      typeof p?.access_token === "string" &&
      !!p.access_token &&
      Array.isArray(p?.tasks) &&
      p.tasks.includes("MODERATE") &&
      /^\d{1,32}$/.test(String(p?.id ?? "")),
  );
  if (!usable.length)
    throw failure("FACEBOOK_PAGE_ACCESS", "The Page role is not enough.");
  const size = (p: any) => count(p.followers_count) ?? count(p.fan_count) ?? -1;
  const page = usable.reduce((best, p) => (size(p) > size(best) ? p : best));
  const pageId = String(page.id),
    pageToken: string = page.access_token;

  let followers = count(page.followers_count),
    pageLikes = count(page.fan_count);
  if (followers === null) {
    // The list sometimes leaves the count out; ask the Page itself.
    const again = await read(
      `/${pageId}`,
      { fields: "followers_count,fan_count" },
      "page",
      pageToken,
    );
    followers = count(again?.followers_count);
    pageLikes ??= count(again?.fan_count);
  }
  // On New Pages Experience Pages fan_count is the follower count.
  followers ??= pageLikes;
  if (followers === null)
    throw failure("FACEBOOK_UNAVAILABLE", "Facebook shared no follower count.");

  // Counts only (limit(0)): nobody who reacted or commented is fetched.
  const published = await read(
    `/${pageId}/published_posts`,
    {
      fields:
        "id,created_time,shares,reactions.limit(0).summary(total_count),comments.limit(0).summary(true)",
      limit: "12",
    },
    "page",
    pageToken,
  );
  const posts = (Array.isArray(published?.data) ? published.data : [])
    .slice(0, 12)
    .map((p: any) => ({
      reactions: count(p?.reactions?.summary?.total_count),
      comments: count(p?.comments?.summary?.total_count),
      // Meta leaves shares out when a post has none.
      shares: count(p?.shares?.count),
    }))
    // A post that came without totals is not read as no engagement.
    .filter((p: any) => p.reactions !== null || p.comments !== null);
  return {
    pageName: Array.from(
      String(page.name ?? "").replace(/[\u0000-\u001f\u007f]/g, ""),
    )
      .slice(0, 60)
      .join(""),
    followers,
    pageLikes,
    engagementRatePct: facebookEngagementRate(followers, posts),
    postsSampled: posts.length,
    pagesShared: pages.length,
    fetchedAt: now.toISOString(),
  };
}

/** Where the callback sends the owner: /trainer/growth?facebook=<outcome>. */
export type FacebookOutcome =
  | "connected"
  | "declined"
  | "expired"
  | "failed"
  | "unavailable"
  | "permissions_required"
  | "no_page"
  | "page_access_required"
  | "busy";
const OUTCOMES = new Map<unknown, FacebookOutcome>([
  ["FACEBOOK_BUSY", "busy"],
  ["FACEBOOK_EXPIRED", "expired"],
  ["FACEBOOK_PERMISSIONS", "permissions_required"],
  ["FACEBOOK_NO_PAGE", "no_page"],
  ["FACEBOOK_PAGE_ACCESS", "page_access_required"],
]);

function owner(req: FastifyRequest): Actor {
  const a = req.identity;
  if (!a) throw fail(401, "AUTH_REQUIRED", "Please sign in");
  if (a.role !== "owner")
    throw fail(
      403,
      "OWNER_REQUIRED",
      "Only the workspace owner can connect Facebook",
    );
  return a as Actor;
}
const STATE_KIND = "facebook_oauth_state",
  SNAPSHOT_KIND = "facebook_snapshot";
async function snapshotFor(db: Database, a: Actor) {
  return db.tenant(a, async (tx) => {
    const [row] = await tx.query(
      "SELECT data FROM records WHERE kind=$1 ORDER BY updated_at DESC LIMIT 1",
      [SNAPSHOT_KIND],
    );
    return (row?.data as FacebookSnapshot | undefined) ?? null;
  });
}

export function registerFacebook(
  app: FastifyInstance,
  db: Database,
  options: { transport?: FacebookTransport } = {},
) {
  app.get("/api/v1/trainer/facebook", async (req) => {
    const a = owner(req);
    return {
      ...(await metaConnectAccess(db, a, "facebook")),
      snapshot: await snapshotFor(db, a),
      followerModel: followerModelFromSettings(runtimeConfig()),
    };
  });

  app.post(
    "/api/v1/trainer/facebook/authorize",
    { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } },
    async (req) => {
      const a = owner(req);
      if (req.hostContext?.custom)
        throw fail(
          403,
          "PLATFORM_HOST_REQUIRED",
          "Connect Facebook from the platform address.",
        );
      const access = await metaConnectAccess(db, a, "facebook");
      const settings = access.available ? facebookConfig() : null;
      if (!settings)
        throw fail(
          409,
          "FACEBOOK_UNAVAILABLE",
          "Connecting Facebook is not available yet. Enter your numbers by hand instead.",
        );
      const session = (req.cookies as any)?.session;
      if (!session)
        throw fail(
          401,
          "SESSION_REQUIRED",
          "Sign in again to connect Facebook.",
        );
      const state = newToken();
      await db.tenant(a, async (tx) => {
        await tx.query("DELETE FROM records WHERE kind=$1", [STATE_KIND]);
        await putRecord(
          tx,
          a,
          STATE_KIND,
          {
            stateHash: tokenHash(state),
            sessionHash: tokenHash(session),
            expiresAt: new Date(Date.now() + 10 * 60000).toISOString(),
          },
          { status: "pending" },
        );
        await event(tx, a, "facebook.authorization_started");
      });
      return { url: facebookAuthorizeUrl(settings, state) };
    },
  );

  app.get("/api/v1/trainer/facebook/callback", async (req, reply) => {
    reply
      .header("Cache-Control", "no-store")
      .header("Referrer-Policy", "no-referrer");
    const back = (outcome: FacebookOutcome) =>
      reply.redirect("/trainer/growth?facebook=" + outcome);
    const q = req.query as Record<string, unknown>;
    const state = typeof q.state === "string" ? q.state.slice(0, 200) : "",
      code = typeof q.code === "string" ? q.code.slice(0, 2000) : "";
    const a = req.identity?.role === "owner" ? (req.identity as Actor) : null;
    const session = (req.cookies as any)?.session;
    if (!a || !session) return back("expired");
    // Meta's documented cancel comes back without the state; nothing is saved.
    if (!state)
      return back(typeof q.error === "string" ? "declined" : "expired");
    const valid = await db.tenant(a, async (tx) => {
      const [row] = await tx.query(
        "SELECT id,data FROM records WHERE kind=$1 AND data->>'stateHash'=$2 FOR UPDATE",
        [STATE_KIND, tokenHash(state)],
      );
      // Single use: the state is removed whatever the outcome.
      if (row) await tx.query("DELETE FROM records WHERE id=$1", [row.id]);
      return (
        !!row &&
        row.data.sessionHash === tokenHash(session) &&
        new Date(row.data.expiresAt).getTime() > Date.now()
      );
    });
    if (!valid) return back("expired");
    if (!code || typeof q.error === "string") return back("declined");
    // The same per-workspace check as authorize: approval may be withdrawn or
    // the workspace taken off the test list in between.
    const access = await metaConnectAccess(db, a, "facebook");
    const settings = access.available ? facebookConfig() : null;
    if (!settings) return back("unavailable");
    let snapshot: FacebookSnapshot;
    try {
      snapshot = await readFacebookSnapshot(settings, code, options.transport);
    } catch (error) {
      const outcome = OUTCOMES.get((error as any)?.code) ?? "failed";
      // Meta's numbers and trace ID only: never an address, token or message.
      req.log.warn(
        { outcome, graph: (error as any)?.graph ?? null },
        "Facebook Page numbers were not read",
      );
      return back(outcome);
    }
    await db.tenant(a, async (tx) => {
      await tx.query("DELETE FROM records WHERE kind=$1", [SNAPSHOT_KIND]);
      await putRecord(tx, a, SNAPSHOT_KIND, snapshot, { status: "ready" });
      // The name only: the numbers live in the record alone, so "Remove
      // saved numbers" and workspace closure delete every copy of them.
      await event(tx, a, "facebook.snapshot_saved");
    });
    return back("connected");
  });

  app.delete("/api/v1/trainer/facebook", async (req) => {
    const a = owner(req);
    await db.tenant(a, async (tx) => {
      await tx.query("DELETE FROM records WHERE kind=ANY($1::text[])", [
        [SNAPSHOT_KIND, STATE_KIND],
      ]);
      await event(tx, a, "facebook.snapshot_removed");
    });
    return { snapshot: null };
  });
}
export const FACEBOOK_RECORD_KINDS = [STATE_KIND, SNAPSHOT_KIND] as const;
