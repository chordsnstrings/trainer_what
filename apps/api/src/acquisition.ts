import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Actor, Database, Tx } from "@trainer/db";
import { newToken, tokenHash } from "./auth.ts";
import { legalAcceptanceVersion } from "./legal.ts";
import { recordAcquisition } from "./admin-operations.ts";

const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
const cookieName = "acquisition";
const touchInput = z
  .object({
    source: z.string().max(200).optional(),
    campaign: z.string().max(200).optional(),
    medium: z.string().max(200).optional(),
    referral: z.string().max(200).optional(),
    /** The coach page's workspace address on the shared host, if any. */
    site: z.string().max(80).optional(),
  })
  .strict();
const channels = new Set([
  "direct",
  "google",
  "bing",
  "instagram",
  "facebook",
  "youtube",
  "linkedin",
  "tiktok",
  "newsletter",
  "referral",
  "partner",
  "other",
]);
const media = new Set([
  "organic",
  "email",
  "social",
  "cpc",
  "referral",
  "display",
  "video",
  "partner",
]);
type Touch = {
  source: string;
  campaign: string;
  medium: string;
  referral: string;
  /** Workspace whose page captured this touch; absent for platform pages. */
  site?: string;
};
type Consent = {
  visitor_id: string;
  token_hash: string;
  origin: string;
  host_tenant_id: string | null;
  tenant_id: string | null;
  user_id: string | null;
  first_touch: Touch;
  last_touch: Touch;
  policy_version: string;
  created_at: string;
  expires_at: string;
};
type RequestContext = Pick<
  FastifyRequest,
  "cookies" | "hostContext" | "identity"
>;

/** Only channel names and opaque campaign/referral codes; never URLs, referrers or traits. */
export function safeAcquisitionTouch(input: unknown): Touch {
  const b = touchInput.parse(input),
    source = b.source?.trim().toLowerCase() || "direct",
    medium = b.medium?.trim().toLowerCase() || "";
  const code = (value: string | undefined, max: number) =>
    value && new RegExp(`^[a-zA-Z0-9_-]{1,${max}}$`).test(value) ? value : "";
  return {
    source: channels.has(source) ? source : "other",
    medium: media.has(medium) ? medium : "",
    campaign: code(b.campaign, 80),
    referral: code(b.referral, 40),
  };
}
/**
 * The workspace whose page captured a touch. A workspace host serves only
 * that workspace; on the shared host only a published coach page counts.
 * The touch is attributed to that workspace and to no other.
 */
async function pageWorkspace(
  tx: Tx,
  req: RequestContext,
  touch: Touch,
  site: unknown,
): Promise<Touch> {
  const host = context(req);
  if (host.tenantId) return { ...touch, site: host.tenantId };
  if (typeof site !== "string" || !/^[a-z][a-z0-9-]{2,39}$/.test(site))
    return touch;
  const [tenant] = await tx.query(
    "SELECT id FROM tenants WHERE slug=$1 AND published=true AND lifecycle_state='active'",
    [site],
  );
  return tenant ? { ...touch, site: tenant.id } : touch;
}
function context(req: RequestContext) {
  if (!req.hostContext)
    throw fail(
      403,
      "VERIFIED_HOST_REQUIRED",
      "This request needs a verified website address.",
    );
  return req.hostContext;
}
function checkOrigin(req: FastifyRequest) {
  if (req.headers.origin !== context(req).origin)
    throw fail(403, "ORIGIN_REJECTED", "Request origin is not permitted.");
}
function cookieOptions(req: RequestContext) {
  return {
    path: "/",
    httpOnly: true,
    secure: context(req).origin.startsWith("https://"),
    sameSite: "lax" as const,
    maxAge: 180 * 86400,
  };
}
async function consentFor(
  tx: Tx,
  req: RequestContext,
  lock = false,
  forRemoval = false,
): Promise<Consent | undefined> {
  const token = req.cookies?.[cookieName],
    host = context(req);
  if (!token || !/^[a-zA-Z0-9_-]{43}$/.test(token)) return;
  const [row] = await tx.query<Consent>(
    `SELECT c.* FROM acquisition_consents c WHERE c.token_hash=$1 AND c.origin=$2 AND c.host_tenant_id IS NOT DISTINCT FROM $3::uuid AND ($4::uuid IS NULL OR c.user_id IS NULL OR c.user_id=$4) ${forRemoval ? "" : "AND c.expires_at>now() AND (c.tenant_id IS NULL OR EXISTS(SELECT 1 FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.tenant_id=c.tenant_id AND m.user_id=c.user_id AND t.lifecycle_state='active'))"} ${lock ? "FOR UPDATE OF c" : ""}`,
    [
      tokenHash(token),
      host.origin,
      host.tenantId,
      req.identity?.userId ?? null,
    ],
  );
  return row;
}
const snapshot = (row: Consent) => ({
  first: row.first_touch,
  last: row.last_touch,
});
async function writeEvent(
  db: Database,
  tx: Tx,
  row: Consent,
  name: Parameters<typeof recordAcquisition>[1]["name"],
  eventKey: string,
  extra: Partial<Parameters<typeof recordAcquisition>[1]> = {},
) {
  const inserted = await recordAcquisition(
    db,
    {
      eventKey,
      name,
      visitorId: row.visitor_id,
      source: row.first_touch.source,
      campaign: row.first_touch.campaign,
      medium: row.first_touch.medium,
      attribution: snapshot(row),
      ...(row.tenant_id
        ? { tenantId: row.tenant_id, userId: row.user_id! }
        : {}),
      ...extra,
    },
    tx,
  );
  return inserted.length > 0;
}
async function visit(db: Database, tx: Tx, row: Consent, touch: Touch) {
  // Ordinary internal navigation does not overwrite the last tagged source.
  if (
    touch.source !== "direct" ||
    touch.campaign ||
    touch.medium ||
    touch.referral
  ) {
    await tx.query(
      "UPDATE acquisition_consents SET last_touch=$2,updated_at=now() WHERE visitor_id=$1",
      [row.visitor_id, JSON.stringify(touch)],
    );
    row.last_touch = touch;
  }
  const day = new Date().toISOString().slice(0, 10),
    fingerprint = createHash("sha256")
      .update(
        JSON.stringify([
          row.last_touch.source,
          row.last_touch.medium,
          row.last_touch.campaign,
          row.last_touch.referral,
        ]),
      )
      .digest("hex")
      .slice(0, 24);
  await writeEvent(
    db,
    tx,
    row,
    "landing",
    `landing:${row.visitor_id}:${day}:${fingerprint}`,
  );
}
async function removeVisitor(tx: Tx, visitorId: string) {
  await tx.query("SELECT set_config('app.privacy_erasure','true',true)");
  await tx.query("DELETE FROM acquisition_events WHERE visitor_id=$1", [
    visitorId,
  ]);
  await tx.query("DELETE FROM acquisition_consents WHERE visitor_id=$1", [
    visitorId,
  ]);
}
// The page's workspace is an internal attribution scope, not visitor-facing.
const visible = ({ site: _site, ...touch }: Touch) => touch;
function readback(row?: Consent) {
  return row
    ? {
        granted: true,
        firstTouch: visible(row.first_touch),
        lastTouch: visible(row.last_touch),
        policyVersion: row.policy_version,
        expiresAt: row.expires_at,
      }
    : { granted: false };
}

const slots: Record<string, "landing" | "onboarding"> = {
  "landing-welcome": "landing",
  "onboarding-welcome": "onboarding",
};
async function experimentFor(
  tx: Tx,
  req: RequestContext,
  key: string,
  row: Consent,
) {
  const surface = slots[key];
  if (
    !surface ||
    context(req).custom ||
    (req.identity?.platformRole && req.identity.platformRole !== "none")
  )
    return;
  if (
    surface === "onboarding" &&
    (!req.identity ||
      req.identity.role !== "owner" ||
      row.tenant_id !== req.identity.tenantId ||
      row.user_id !== req.identity.userId)
  )
    return;
  const [experiment] = await tx.query(
    "SELECT id,key,revision,allocation,variant_a,variant_b FROM admin_experiments WHERE surface=$1 AND status='running' ORDER BY created_at,id LIMIT 1 FOR SHARE",
    [surface],
  );
  if (!experiment) return;
  const bucket =
    createHash("sha256")
      .update(experiment.id + ":" + row.visitor_id)
      .digest()
      .readUInt32BE(0) % 100;
  const variant =
    bucket < experiment.allocation ? ("b" as const) : ("a" as const);
  return {
    experimentId: experiment.id as string,
    revision: experiment.revision as number,
    variant,
    text: String(variant === "b" ? experiment.variant_b : experiment.variant_a),
  };
}

export function registerAcquisition(app: FastifyInstance, db: Database) {
  const rate = { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } };
  app.get("/api/v1/public/acquisition/consent", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    return db.system(async (tx) => readback(await consentFor(tx, req)));
  });
  app.post("/api/v1/public/acquisition/consent", rate, async (req, reply) => {
    checkOrigin(req);
    const body = z
        .object({ granted: z.literal(true), touch: touchInput })
        .strict()
        .parse(req.body),
      tagged = safeAcquisitionTouch(body.touch);
    const policyVersion =
        (await legalAcceptanceVersion(db, "analytics")) +
        "|optional-analytics:v1",
      host = context(req);
    let issued: string | undefined;
    const result = await db.system(async (tx) => {
      const touch = await pageWorkspace(tx, req, tagged, body.touch.site);
      let row = await consentFor(tx, req, true);
      if (!row) {
        issued = newToken();
        [row] = await tx.query<Consent>(
          "INSERT INTO acquisition_consents(visitor_id,token_hash,origin,host_tenant_id,policy_version,first_touch,last_touch) VALUES($1,$2,$3,$4,$5,$6,$6) RETURNING *",
          [
            randomUUID(),
            tokenHash(issued),
            host.origin,
            host.tenantId,
            policyVersion,
            JSON.stringify(touch),
          ],
        );
      } else
        await tx.query(
          "UPDATE acquisition_consents SET policy_version=$2,updated_at=now() WHERE visitor_id=$1",
          [row.visitor_id, policyVersion],
        );
      row.policy_version = policyVersion;
      await visit(db, tx, row, touch);
      return readback(row);
    });
    if (issued) reply.setCookie(cookieName, issued, cookieOptions(req));
    reply.header("Cache-Control", "no-store");
    return result;
  });
  app.delete("/api/v1/public/acquisition/consent", rate, async (req, reply) => {
    checkOrigin(req);
    await db.system(async (tx) => {
      const row = await consentFor(tx, req, true, true);
      if (row) await removeVisitor(tx, row.visitor_id);
    });
    reply.clearCookie(cookieName, {
      path: "/",
      httpOnly: true,
      secure: cookieOptions(req).secure,
      sameSite: "lax",
    });
    return { granted: false };
  });
  app.post("/api/v1/public/acquisition/visit", rate, async (req) => {
    checkOrigin(req);
    const tagged = safeAcquisitionTouch(req.body);
    return db.system(async (tx) => {
      const row = await consentFor(tx, req, true);
      if (!row) return { recorded: false };
      const touch = await pageWorkspace(
        tx,
        req,
        tagged,
        (req.body as any)?.site,
      );
      await visit(db, tx, row, touch);
      return { recorded: true };
    });
  });
  app.get("/api/v1/public/experiments/:key", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const key = z
      .string()
      .max(80)
      .parse((req.params as any).key);
    return db.system(async (tx) => {
      const row = await consentFor(tx, req);
      return row
        ? ((await experimentFor(tx, req, key, row)) ?? { variant: "control" })
        : { variant: "control" };
    });
  });
  app.post("/api/v1/public/experiments/:key/exposure", rate, async (req) => {
    checkOrigin(req);
    const key = z
        .string()
        .max(80)
        .parse((req.params as any).key),
      body = z
        .object({
          revision: z.number().int().positive(),
          variant: z.enum(["a", "b"]),
        })
        .strict()
        .parse(req.body);
    return db.system(async (tx) => {
      const row = await consentFor(tx, req, true);
      if (!row) return { recorded: false };
      const experiment = await experimentFor(tx, req, key, row);
      if (
        !experiment ||
        experiment.variant !== body.variant ||
        experiment.revision !== body.revision
      )
        return { recorded: false };
      const recorded = await writeEvent(
        db,
        tx,
        row,
        "experiment_exposure",
        `experiment:${experiment.experimentId}:${row.visitor_id}`,
        {
          experimentId: experiment.experimentId,
          experimentRevision: experiment.revision,
          variant: experiment.variant,
        },
      );
      return { recorded };
    });
  });
}

/** Call after the account/membership transaction commits, with server-created IDs. */
export async function recordSignupAcquisition(
  db: Database,
  req: RequestContext,
  a: Actor,
  name: "signup" | "enroll" = "signup",
) {
  if (context(req).tenantId && context(req).tenantId !== a.tenantId)
    return false;
  return db.system(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      a.tenantId + ":workspace",
    ]);
    const row = await consentFor(tx, req, true);
    if (
      !row ||
      (row.tenant_id &&
        (row.tenant_id !== a.tenantId || row.user_id !== a.userId))
    )
      return false;
    const [member] = await tx.query(
      "SELECT m.role FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.tenant_id=$1 AND m.user_id=$2 AND t.lifecycle_state='active'",
      [a.tenantId, a.userId],
    );
    if (member?.role !== (name === "signup" ? "owner" : "subscriber"))
      return false;
    await tx.query(
      "UPDATE acquisition_consents SET tenant_id=$2,user_id=$3,updated_at=now() WHERE visitor_id=$1",
      [row.visitor_id, a.tenantId, a.userId],
    );
    row.tenant_id = a.tenantId;
    row.user_id = a.userId;
    return writeEvent(db, tx, row, name, `${name}:${a.tenantId}:${a.userId}`);
  });
}
async function ownerConversion(
  db: Database,
  tenantId: string,
  name: "publish" | "first_paid",
  happenedAt?: string,
) {
  return db.system(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      tenantId + ":workspace",
    ]);
    const [tenant] = await tx.query(
      "SELECT published FROM tenants WHERE id=$1 AND lifecycle_state='active'",
      [tenantId],
    );
    if (!tenant || (name === "publish" && !tenant.published)) return false;
    const [row] = await tx.query<Consent>(
      "SELECT c.* FROM acquisition_consents c JOIN memberships m ON m.tenant_id=c.tenant_id AND m.user_id=c.user_id WHERE c.tenant_id=$1 AND m.role='owner' AND c.expires_at>now() AND ($2::timestamptz IS NULL OR c.created_at<=$2) AND EXISTS(SELECT 1 FROM acquisition_events e WHERE e.visitor_id=c.visitor_id AND e.tenant_id=c.tenant_id AND e.name='signup') ORDER BY c.created_at LIMIT 1 FOR UPDATE OF c",
      [tenantId, happenedAt ?? null],
    );
    return row ? writeEvent(db, tx, row, name, `${name}:${tenantId}`) : false;
  });
}
/** Must run after successful storefront publication, never from a client event endpoint. */
export const recordPublishAcquisition = (db: Database, tenantId: string) =>
  ownerConversion(db, tenantId, "publish");

// Member money reaches a workspace as a subscription invoice or a paid session.
const paidJournal =
  "(source_key LIKE 'stripe-invoice:%' OR source_key LIKE 'booking-charge:%') AND (data->>'grossMinor')::numeric>0";
/**
 * Run after a verified positive subscription invoice or a confirmed paid
 * session booking commits. Reads ledger evidence again.
 */
export async function recordFirstPaidAcquisition(
  db: Database,
  tenantId: string,
  userId: string,
) {
  const evidence = await db.tenant(
    { tenantId, userId, role: "finance" },
    async (tx) => {
      const [paid] = await tx.query(
        `SELECT id FROM journals WHERE ${paidJournal} AND data->>'userId'=$1 LIMIT 1`,
        [userId],
      );
      if (!paid) return null;
      const [first] = await tx.query(
        `SELECT coalesce(nullif(data->>'chargedAt','')::timestamptz,created_at) AS happened_at FROM journals WHERE ${paidJournal} ORDER BY happened_at,id LIMIT 1`,
      );
      return first?.happened_at;
    },
  );
  return evidence
    ? ownerConversion(db, tenantId, "first_paid", evidence)
    : false;
}

/**
 * A website inquiry from a visitor who allowed optional analytics becomes a
 * lead for the contacted workspace. The event keeps the visitor's
 * platform-wide first/last touch for the operator funnel; the workspace sees
 * only touches captured on its own pages (its own host, or its coach page on
 * the shared host), never another workspace's or the platform's campaigns.
 * No permission, no event: the inquiry itself is still saved and counted.
 * Call after the inquiry commits; withdrawal deletes the event like any other.
 */
export async function recordLeadAcquisition(
  db: Database,
  req: RequestContext & { headers?: FastifyRequest["headers"] },
  tenantId: string,
  inquiryId: string,
) {
  const host = req.hostContext;
  if (!host || (host.tenantId && host.tenantId !== tenantId)) return false;
  if (req.headers?.origin !== host.origin) return false;
  return db.system(async (tx) => {
    const row = await consentFor(tx, req, true);
    if (!row) return false;
    const own = (t: Touch) =>
      row.host_tenant_id === tenantId || t?.site === tenantId;
    const inserted = await recordAcquisition(
      db,
      {
        eventKey: `lead:${inquiryId}`,
        name: "lead",
        tenantId,
        visitorId: row.visitor_id,
        source: row.first_touch.source,
        campaign: row.first_touch.campaign,
        medium: row.first_touch.medium,
        attribution: {
          ...snapshot(row),
          workspace: {
            ...(own(row.first_touch) ? { first: row.first_touch } : {}),
            ...(own(row.last_touch) ? { last: row.last_touch } : {}),
          },
        },
      },
      tx,
    );
    return inserted.length > 0;
  });
}
/**
 * Attribution for the owner's inquiry inbox; only consented, unexpired
 * history exists, and only touches captured on this workspace's own pages
 * are shown. `outside` marks a consenting visitor with no such touch.
 */
export async function inquiryAttribution(
  db: Database,
  tenantId: string,
  inquiryIds: string[],
) {
  if (!inquiryIds.length) return new Map<string, Record<string, string>>();
  const rows = await db.system((tx) =>
    tx.query(
      "SELECT event_key,source,campaign,medium,attribution FROM acquisition_events WHERE tenant_id=$1 AND name='lead' AND event_key=ANY($2::text[])",
      [tenantId, inquiryIds.map((id) => "lead:" + id)],
    ),
  );
  return new Map(
    rows.map((r) => {
      const own = r.attribution?.workspace ?? {},
        first = own.first ?? own.last,
        last = own.last ?? own.first;
      return [
        String(r.event_key).slice("lead:".length),
        first
          ? {
              source: first.source,
              campaign: first.campaign,
              medium: first.medium,
              lastSource: last.source,
              lastCampaign: last.campaign,
              referral: own.last?.referral || own.first?.referral || "",
              outside: false,
            }
          : {
              source: "",
              campaign: "",
              medium: "",
              lastSource: "",
              lastCampaign: "",
              referral: "",
              outside: true,
            },
      ];
    }),
  );
}

/** These helpers require a system transaction; tenant SQL intentionally cannot read this store. */
export async function exportAcquisitionData(
  tx: Tx,
  tenantId: string,
  userId: string,
) {
  const consent = await tx.query(
    "SELECT origin,policy_version,first_touch,last_touch,created_at,expires_at FROM acquisition_consents WHERE tenant_id=$1 AND user_id=$2",
    [tenantId, userId],
  );
  const events = await tx.query(
    "SELECT name,source,campaign,medium,attribution,experiment_id,experiment_revision,variant,created_at FROM acquisition_events WHERE (tenant_id=$1 AND user_id=$2) OR visitor_id IN (SELECT visitor_id FROM acquisition_consents WHERE tenant_id=$1 AND user_id=$2) ORDER BY created_at",
    [tenantId, userId],
  );
  return { consent, events };
}
export async function eraseAcquisitionData(
  tx: Tx,
  tenantId: string,
  userId?: string,
) {
  const rows = await tx.query(
    "SELECT visitor_id FROM acquisition_consents WHERE (tenant_id=$1 AND ($2::uuid IS NULL OR user_id=$2)) OR ($2::uuid IS NULL AND host_tenant_id=$1) ORDER BY visitor_id FOR UPDATE",
    [tenantId, userId ?? null],
  );
  await tx.query("SELECT set_config('app.privacy_erasure','true',true)");
  for (const row of rows) await removeVisitor(tx, row.visitor_id);
  await tx.query(
    "DELETE FROM acquisition_events WHERE tenant_id=$1 AND ($2::uuid IS NULL OR user_id=$2)",
    [tenantId, userId ?? null],
  );
}

/** Bounded cleanup for the worker; expiry denies use even before this runs. */
export async function purgeExpiredAcquisition(db: Database) {
  return db.system(async (tx) => {
    const rows = await tx.query(
      "SELECT visitor_id FROM acquisition_consents WHERE expires_at<=now() ORDER BY visitor_id LIMIT 100 FOR UPDATE SKIP LOCKED",
    );
    for (const row of rows) await removeVisitor(tx, row.visitor_id);
    return { removed: rows.length };
  });
}
