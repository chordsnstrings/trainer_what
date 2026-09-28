// Early access while trainer registration is closed: a consented request from
// the public site (name, email, Instagram handle, specialty, emirate and the
// follower estimate the visitor saw), and the Super admin's list, CSV export,
// status and erasure. Platform-scoped; only the service role touches it.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Actor, Database, Tx } from "@trainer/db";
import { DIRECTORY_SPECIALTIES } from "@trainer/contracts";
import { requireRecentMfa } from "./security.ts";
import { getPublishedDocument } from "./admin-operations.ts";
import { consentedVisitor } from "./acquisition.ts";
import { publicPlatform } from "./marketing.ts";

type Identity = Actor & { platformRole: string; mfaAt?: string | null };
const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });

export const EARLY_ACCESS_EMIRATES = [
  "abu_dhabi",
  "dubai",
  "sharjah",
  "ajman",
  "umm_al_quwain",
  "ras_al_khaimah",
  "fujairah",
  "outside_uae",
] as const;
/** The consent the form shows; its version is stored with every request. */
export const EARLY_ACCESS_NOTICE_VERSION = "early-access-notice:v1";
/** A person needs at least this long to read and fill the form. */
const MIN_FILL_MS = 3000;
const specialties = DIRECTORY_SPECIALTIES.map((s) => s.id) as [
  string,
  ...string[],
];
const whole = (max: number) => z.number().int().min(0).max(max);
export const earlyAccessInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: z
      .string()
      .trim()
      .max(254)
      .regex(/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/),
    instagram: z
      .string()
      .trim()
      .max(31)
      .transform((v) => v.replace(/^@/, "").toLowerCase())
      .refine((v) => /^[a-z0-9._]{0,30}$/.test(v))
      .default(""),
    specialty: z.enum(specialties).or(z.literal("")).default(""),
    emirate: z.enum(EARLY_ACCESS_EMIRATES).or(z.literal("")).default(""),
    followers: whole(10_000_000).nullable().default(null),
    estimate: z
      .object({
        stories: whole(60),
        price: z.number().int().min(1).max(10_000),
        low: whole(1_000_000),
        high: whole(1_000_000),
      })
      .strict()
      .refine((e) => e.low <= e.high)
      .nullable()
      .default(null),
    slug: z
      .string()
      .regex(/^([a-z][a-z0-9-]{2,39})?$/)
      .default(""),
    consent: z.literal(true),
    /** Hidden field people never see; bots fill it. */
    website: z.string().max(200).default(""),
    /** When the form was shown (ms since epoch). */
    startedAt: z.number().int().positive(),
  })
  .strict();

async function consentVersion(db: Database) {
  const privacy = await getPublishedDocument(db, "legal", "privacy");
  return `${EARLY_ACCESS_NOTICE_VERSION}|privacy:${privacy ? privacy.version : "unpublished"}`;
}

/**
 * Stores or updates the request for one email address. Returns false for a
 * submission the bot checks drop; the caller answers the same either way, so
 * nothing reveals whether an address is already on the list.
 */
export async function saveEarlyAccess(
  db: Database,
  req: Pick<FastifyRequest, "cookies" | "hostContext" | "identity">,
  body: unknown,
  now = Date.now(),
): Promise<boolean> {
  const input = earlyAccessInput.parse(body);
  const age = now - input.startedAt;
  if (input.website.trim() || age < MIN_FILL_MS || age > 86_400_000)
    return false;
  const version = await consentVersion(db);
  await db.system(async (tx: Tx) => {
    // Channel and campaign codes only from a visitor who allowed analytics.
    const visitor = await consentedVisitor(tx, req);
    await tx.query(
      `INSERT INTO early_access_requests(id,name,email,email_key,instagram,specialty,emirate,followers,estimate,slug,visitor_id,source,campaign,medium,consent_version,consented_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,now())
       ON CONFLICT(email_key) DO UPDATE SET name=EXCLUDED.name,email=EXCLUDED.email,instagram=EXCLUDED.instagram,specialty=EXCLUDED.specialty,emirate=EXCLUDED.emirate,followers=EXCLUDED.followers,estimate=EXCLUDED.estimate,slug=EXCLUDED.slug,visitor_id=coalesce(EXCLUDED.visitor_id,early_access_requests.visitor_id),source=CASE WHEN EXCLUDED.visitor_id IS NULL THEN early_access_requests.source ELSE EXCLUDED.source END,campaign=CASE WHEN EXCLUDED.visitor_id IS NULL THEN early_access_requests.campaign ELSE EXCLUDED.campaign END,medium=CASE WHEN EXCLUDED.visitor_id IS NULL THEN early_access_requests.medium ELSE EXCLUDED.medium END,consent_version=EXCLUDED.consent_version,consented_at=EXCLUDED.consented_at,updated_at=now()`,
      [
        randomUUID(),
        input.name,
        input.email,
        input.email.toLowerCase(),
        input.instagram,
        input.specialty,
        input.emirate,
        input.followers,
        JSON.stringify(
          input.estimate
            ? { ...input.estimate, version: publicPlatform().followerModel.version }
            : {},
        ),
        input.slug,
        visitor?.visitorId ?? null,
        visitor?.touch.source ?? "",
        visitor?.touch.campaign ?? "",
        visitor?.touch.medium ?? "",
        version,
      ],
    );
  });
  return true;
}

const LIST_FIELDS =
  "id,name,email,instagram,specialty,emirate,followers,estimate,slug,source,campaign,medium,status,consent_version,consented_at,created_at,updated_at";
export async function listEarlyAccess(db: Database, limit = 500) {
  return db.system((tx) =>
    tx.query(
      `SELECT ${LIST_FIELDS} FROM early_access_requests ORDER BY created_at DESC,id DESC LIMIT $1`,
      [limit],
    ),
  );
}
const CSV_FIELDS = LIST_FIELDS.split(",");
function csvCell(value: unknown) {
  if (value === null || value === undefined) return "";
  const text =
    value instanceof Date
      ? value.toISOString()
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  // Visitor-typed text: neutralize spreadsheet formulas.
  const safe = /^[=+\-@\t\r]/.test(text) ? "'" + text : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}
export function earlyAccessCsv(rows: Array<Record<string, unknown>>) {
  return (
    [
      CSV_FIELDS.join(","),
      ...rows.map((row) => CSV_FIELDS.map((f) => csvCell(row[f])).join(",")),
    ].join("\n") + "\n"
  );
}

export function registerEarlyAccess(
  app: FastifyInstance,
  db: Database,
  identity: (req: FastifyRequest) => Identity,
) {
  app.post(
    "/api/v1/public/early-access",
    { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } },
    async (req, reply) => {
      const host = req.hostContext;
      // The platform's own address only, from its own pages.
      if (!host || host.custom || host.tenantId)
        throw fail(403, "PLATFORM_HOST_REQUIRED", "Use the platform address.");
      if (req.headers.origin !== host.origin)
        throw fail(403, "ORIGIN_REJECTED", "Request origin is not permitted.");
      if (publicPlatform().registrationOpen)
        throw fail(
          409,
          "REGISTRATION_OPEN",
          "Registration is open: claim your coaching address instead.",
        );
      const parsed = earlyAccessInput.safeParse(req.body);
      if (!parsed.success)
        throw fail(
          400,
          "EARLY_ACCESS_INVALID",
          "Check your name, email address and consent, then try again.",
        );
      await saveEarlyAccess(db, req, req.body);
      reply.header("Cache-Control", "no-store");
      return { received: true };
    },
  );

  const admin = (req: FastifyRequest) => {
    const a = identity(req);
    if (a.platformRole !== "admin")
      throw fail(403, "ROLE_REQUIRED", "Superadmin access is required.");
    requireRecentMfa(a, true);
    return a;
  };
  const audit = (a: Identity, action: string, data: unknown) =>
    db.system((tx) =>
      tx.query(
        "INSERT INTO admin_operations_audit(id,actor_id,action,data) VALUES($1,$2,$3,$4)",
        [randomUUID(), a.userId, action, JSON.stringify(data)],
      ),
    );
  app.get("/api/v1/admin/early-access.csv", async (req, reply) => {
    const a = admin(req);
    const rows = await listEarlyAccess(db, 100_000);
    await audit(a, "early_access.exported", { rows: rows.length });
    return reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header("Cache-Control", "no-store")
      .header(
        "Content-Disposition",
        `attachment; filename="early-access-${new Date().toISOString().slice(0, 10)}.csv"`,
      )
      .send(earlyAccessCsv(rows));
  });
  app.post("/api/v1/admin/early-access/:id/status", async (req) => {
    const a = admin(req);
    const id = z.string().uuid().parse((req.params as any).id);
    const { status } = z
      .object({ status: z.enum(["new", "contacted", "invited", "declined"]) })
      .strict()
      .parse(req.body);
    const [row] = await db.system((tx) =>
      tx.query(
        "UPDATE early_access_requests SET status=$2,updated_at=now() WHERE id=$1 RETURNING id,status",
        [id, status],
      ),
    );
    if (!row) throw fail(404, "NOT_FOUND", "That request no longer exists.");
    await audit(a, "early_access.status", { id, status });
    return row;
  });
  // Erasure on request: the row is deleted, and the audit keeps only its id.
  app.post("/api/v1/admin/early-access/:id/erase", async (req) => {
    const a = admin(req);
    const id = z.string().uuid().parse((req.params as any).id);
    const [row] = await db.system((tx) =>
      tx.query("DELETE FROM early_access_requests WHERE id=$1 RETURNING id", [
        id,
      ]),
    );
    if (!row) throw fail(404, "NOT_FOUND", "That request no longer exists.");
    await audit(a, "early_access.erased", { id });
    return { erased: true };
  });
}
