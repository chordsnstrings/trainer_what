// Public platform facts for the marketing site, and the optional "Connect
// Instagram" read used by the trainer's follower calculator.
//
// Instagram: the Instagram API with Instagram Login (professional accounts,
// instagram_business_basic). The access token is used once in the callback to
// read the follower count and recent likes and comments, then discarded; only
// the resulting numbers are stored, as a workspace record the owner can delete.
import type { FastifyInstance, FastifyRequest } from "fastify";
import { event, putRecord, type Actor, type Database } from "@trainer/db";
import {
  APP_ICON_FILES,
  appInitials,
  platformName,
  PLATFORM_THEME,
  type AppIconFile,
  type BrandDesign,
} from "@trainer/contracts";
import { renderAppIcon } from "./discovery.ts";
import { integrationStatus } from "@trainer/providers";
import {
  integrationCapability,
  providerRequest,
  runtimeConfig,
  strictSecurity,
  type RuntimeConfig,
} from "../../../packages/providers/src/configuration.ts";
import {
  engagementRate,
  followerModelFromSettings,
} from "../../../packages/domain/src/marketing-calculators.ts";
import { platformRootDomain } from "../../../packages/domain/src/web-address.ts";
import { newToken, tokenHash } from "./auth.ts";

const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
/** The platform colours (theme and page background) for generated icons. */
const PLATFORM_ICON_DESIGN = {
  primary: PLATFORM_THEME.theme,
  surface: PLATFORM_THEME.background,
} as unknown as BrandDesign;

/** Provider availability that drives "Available soon" chips. */
export function publicAvailability(config: RuntimeConfig = runtimeConfig()) {
  const status = Object.fromEntries(
    integrationStatus().map((p) => [p.id, p.configured && p.approved]),
  );
  return {
    model: !!status.model,
    nutrition: !!status.model && config.NUTRITION_ENABLED === "true",
    voice: !!status.voice,
    customDomains: !!status.domains,
    payments: !!status.stripe,
    payouts: !!status.lean,
    whoop: !!status.whoop,
    zepp: !!status.zepp,
    instagram: !!integrationCapability("instagram", config)?.approved,
    // The active model profile is frontier tier and its latest switch check
    // passed (docs/features/model-profiles.md); public wording may then say
    // "frontier model", never the model or its vendor.
    frontier: !!status.model && config.MODEL_PROFILE_FRONTIER === "true",
  };
}

/** What the public marketing pages need from the platform settings. */
export function publicPlatform() {
  const config = runtimeConfig();
  const name = platformName(config.APP_NAME);
  const root = platformRootDomain(config.PLATFORM_ROOT_DOMAIN);
  return {
    name,
    initials: appInitials(name),
    supportEmail: config.SUPPORT_EMAIL?.trim() || null,
    companyDetails: config.COMPANY_DETAILS?.trim() || null,
    // Mirrors POST /auth/register: a strict deployment waits for approved
    // legal documents before trainers can register.
    registrationOpen: !strictSecurity() || config.LEGAL_APPROVED === "true",
    // Match setup’s configured address scheme without changing host routing.
    coachAddressTemplate: root
      ? `https://{slug}.${root}`
      : new URL(config.PUBLIC_APP_URL || "http://localhost:3000").origin + "/coach/{slug}",
    availability: publicAvailability(config),
    followerModel: followerModelFromSettings(config),
  };
}

// ---------------------------------------------------------------------------
// Instagram

export type InstagramSnapshot = {
  username: string;
  accountType: string | null;
  followers: number;
  mediaCount: number | null;
  engagementRatePct: number | null;
  postsSampled: number;
  fetchedAt: string;
};
/** Replaceable only by nonproduction fixtures (buildApp providers). */
export type InstagramTransport = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;

export function instagramConfig(config: RuntimeConfig = runtimeConfig()) {
  const capability = integrationCapability("instagram", config);
  if (!capability?.configured || !capability.approved) return null;
  return {
    appId: config.INSTAGRAM_APP_ID!.trim(),
    secret: config.INSTAGRAM_APP_SECRET!.trim(),
    redirect: config.INSTAGRAM_REDIRECT_URI!.trim(),
  };
}
export function instagramAuthorizeUrl(
  settings: { appId: string; redirect: string },
  state: string,
) {
  const url = new URL("https://www.instagram.com/oauth/authorize");
  url.searchParams.set("client_id", settings.appId);
  url.searchParams.set("redirect_uri", settings.redirect);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "instagram_business_basic");
  url.searchParams.set("state", state);
  return url.toString();
}

async function json(response: Response, what: string) {
  if (!response.ok)
    throw fail(502, "INSTAGRAM_UNAVAILABLE", `Instagram refused the ${what}.`);
  return (await response.json()) as any;
}
/**
 * Exchanges the one-time code, reads the profile and recent posts, and
 * returns only the numbers. The token never leaves this function.
 */
export async function readInstagramSnapshot(
  settings: { appId: string; secret: string; redirect: string },
  code: string,
  transport: InstagramTransport = providerRequest,
  now = new Date(),
): Promise<InstagramSnapshot> {
  const exchanged = await json(
    await transport("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: settings.appId,
        client_secret: settings.secret,
        grant_type: "authorization_code",
        redirect_uri: settings.redirect,
        code,
      }).toString(),
      signal: AbortSignal.timeout(15000),
    }),
    "sign-in code",
  );
  const token = String(
    exchanged?.access_token ?? exchanged?.data?.[0]?.access_token ?? "",
  );
  if (!token)
    throw fail(502, "INSTAGRAM_UNAVAILABLE", "Instagram returned no access.");
  const authorized = { Authorization: `Bearer ${token}` };
  const profile = await json(
    await transport(
      "https://graph.instagram.com/me?fields=user_id,username,account_type,followers_count,media_count",
      { headers: authorized, signal: AbortSignal.timeout(15000) },
    ),
    "profile request",
  );
  const followers = Number(profile?.followers_count);
  if (!Number.isSafeInteger(followers) || followers < 0)
    throw fail(
      422,
      "INSTAGRAM_PROFESSIONAL_REQUIRED",
      "Instagram did not share a follower count. Only professional (business or creator) accounts can connect.",
    );
  const media = await json(
    await transport(
      "https://graph.instagram.com/me/media?fields=like_count,comments_count,timestamp&limit=12",
      { headers: authorized, signal: AbortSignal.timeout(15000) },
    ),
    "recent posts request",
  );
  const posts = (Array.isArray(media?.data) ? media.data : [])
    .slice(0, 12)
    .map((p: any) => ({ likes: p?.like_count, comments: p?.comments_count }));
  return {
    username: String(profile?.username ?? "").slice(0, 60),
    accountType:
      typeof profile?.account_type === "string"
        ? profile.account_type.slice(0, 40)
        : null,
    followers,
    mediaCount: Number.isSafeInteger(Number(profile?.media_count))
      ? Number(profile.media_count)
      : null,
    engagementRatePct: engagementRate(followers, posts),
    postsSampled: posts.length,
    fetchedAt: now.toISOString(),
  };
}

function owner(req: FastifyRequest): Actor & { workspaceState?: string } {
  const a = req.identity;
  if (!a) throw fail(401, "AUTH_REQUIRED", "Please sign in");
  if (a.role !== "owner")
    throw fail(
      403,
      "OWNER_REQUIRED",
      "Only the workspace owner can connect Instagram",
    );
  return a as Actor & { workspaceState?: string };
}
const STATE_KIND = "instagram_oauth_state",
  SNAPSHOT_KIND = "instagram_snapshot";
async function snapshotFor(db: Database, a: Actor) {
  return db.tenant(a, async (tx) => {
    const [row] = await tx.query(
      "SELECT data FROM records WHERE kind=$1 ORDER BY updated_at DESC LIMIT 1",
      [SNAPSHOT_KIND],
    );
    return (row?.data as InstagramSnapshot | undefined) ?? null;
  });
}

export function registerMarketing(
  app: FastifyInstance,
  db: Database,
  options: {
    instagramTransport?: InstagramTransport;
    /** Whether the home page shows the voice assistant (marketing-assistant.ts). */
    assistantAvailable?: () => Promise<boolean>;
  } = {},
) {
  app.get("/api/v1/public/platform", async (_req, reply) => {
    reply.header("Cache-Control", "public, max-age=60");
    return {
      ...publicPlatform(),
      assistant: options.assistantAvailable ? await options.assistantAvailable() : false,
    };
  });
  // The platform's install and logo icons: the configured name's initials on
  // the platform colour, so they always match APP_NAME.
  app.get("/api/v1/public/platform/icon/:file", async (req, reply) => {
    const file = String((req.params as any).file);
    if (!Object.hasOwn(APP_ICON_FILES, file))
      throw fail(404, "NOT_FOUND", "Unknown icon");
    const spec = APP_ICON_FILES[file as AppIconFile];
    const png = await renderAppIcon({
      name: publicPlatform().name,
      design: PLATFORM_ICON_DESIGN,
      size: spec.size,
      variant: spec.variant,
    });
    return reply
      .header("Content-Type", "image/png")
      .header("Cache-Control", "public, max-age=3600")
      .send(png);
  });

  app.get("/api/v1/trainer/instagram", async (req) => {
    const a = owner(req);
    return {
      available: !!instagramConfig(),
      snapshot: await snapshotFor(db, a),
      followerModel: followerModelFromSettings(runtimeConfig()),
    };
  });

  app.post(
    "/api/v1/trainer/instagram/authorize",
    { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } },
    async (req) => {
      const a = owner(req);
      if (req.hostContext?.custom)
        throw fail(
          403,
          "PLATFORM_HOST_REQUIRED",
          "Connect Instagram from the platform address.",
        );
      const settings = instagramConfig();
      if (!settings)
        throw fail(
          409,
          "INSTAGRAM_UNAVAILABLE",
          "Connecting Instagram is not available yet. Enter your numbers by hand instead.",
        );
      const session = (req.cookies as any)?.session;
      if (!session)
        throw fail(401, "SESSION_REQUIRED", "Sign in again to connect Instagram.");
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
        await event(tx, a, "instagram.authorization_started");
      });
      return { url: instagramAuthorizeUrl(settings, state) };
    },
  );

  app.get("/api/v1/trainer/instagram/callback", async (req, reply) => {
    reply.header("Cache-Control", "no-store").header("Referrer-Policy", "no-referrer");
    const back = (outcome: string) =>
      reply.redirect("/trainer/growth?instagram=" + outcome);
    const q = req.query as Record<string, unknown>;
    const state = typeof q.state === "string" ? q.state.slice(0, 200) : "",
      code = typeof q.code === "string" ? q.code.slice(0, 2000) : "";
    const a = req.identity?.role === "owner" ? (req.identity as Actor) : null;
    const session = (req.cookies as any)?.session;
    if (!a || !session || !state) return back("expired");
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
    const settings = instagramConfig();
    if (!settings) return back("unavailable");
    let snapshot: InstagramSnapshot;
    try {
      snapshot = await readInstagramSnapshot(
        settings,
        code,
        options.instagramTransport,
      );
    } catch (error) {
      return back(
        (error as any)?.code === "INSTAGRAM_PROFESSIONAL_REQUIRED"
          ? "professional_required"
          : "failed",
      );
    }
    await db.tenant(a, async (tx) => {
      await tx.query("DELETE FROM records WHERE kind=$1", [SNAPSHOT_KIND]);
      await putRecord(tx, a, SNAPSHOT_KIND, snapshot, { status: "ready" });
      await event(tx, a, "instagram.snapshot_saved", undefined, {
        followers: snapshot.followers,
        postsSampled: snapshot.postsSampled,
      });
    });
    return back("connected");
  });

  app.delete("/api/v1/trainer/instagram", async (req) => {
    const a = owner(req);
    await db.tenant(a, async (tx) => {
      await tx.query("DELETE FROM records WHERE kind=ANY($1::text[])", [
        [SNAPSHOT_KIND, STATE_KIND],
      ]);
      await event(tx, a, "instagram.snapshot_removed");
    });
    return { snapshot: null };
  });
}
export const INSTAGRAM_RECORD_KINDS = [STATE_KIND, SNAPSHOT_KIND] as const;
