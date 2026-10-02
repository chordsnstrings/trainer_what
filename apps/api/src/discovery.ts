import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { event, type Actor, type Database, type Tx } from "@trainer/db";
import {
  APP_ICON_FILES,
  platformName,
  DIRECTORY_LANGUAGES,
  DIRECTORY_PAGE_SIZE,
  DIRECTORY_PATH,
  DIRECTORY_SPECIALTIES,
  INDEXABLE_MARKETING_PAGES,
  OFFERED_DIRECTORY_SPECIALTIES,
  isHiddenSpecialty,
  SITEMAP_COACHES_PER_FILE,
  coachHostPagePath,
  directoryListingSchema,
  directorySearchSchema,
  memberAppManifest,
  platformManifest,
  resolveBrandDesign,
  shortAppName,
  type AppIconFile,
  type BrandDesign,
  type SitemapEntry,
} from "@trainer/contracts";
import { runtimeConfig } from "../../../packages/providers/src/configuration.ts";
import { siteSchema } from "./coach-site.ts";
import { hasNutritionAccess } from "./entitlements.ts";
import { renderAppIcon } from "./app-icons.ts";
import type { HostContext } from "./host-routing.ts";

const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });

/**
 * The one public discovery predicate (migration 059). Every sitemap and
 * directory query filters workspaces through it, so a suspended or otherwise
 * excluded workspace disappears from discovery in one place.
 */
export const discoverable = (alias: string) =>
  `public_discovery_tenant(${alias}.id)`;

/** The Super admin can close the directory; it is open unless set "false". */
export function directoryOpen(config = runtimeConfig()): boolean {
  return config.COACH_DIRECTORY_ENABLED !== "false";
}

const STANDARD_SECTIONS = ["about", "memberships", "galleries", "contact"];
const mediaPath = /^\/api\/v1\/media\/([0-9a-f-]{36})$/i;
const iconKeyPattern = /^[A-Za-z0-9_-]{32,64}$/;

type SiteRow = {
  slug: string;
  published: unknown;
  published_at: Date | string | null;
  has_galleries: boolean;
};

function iso(value: Date | string | null | undefined) {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/**
 * Public pages of one launched coach website. On the platform they live under
 * /coach/<slug>; on the coach's connected domain at the root, except custom
 * pages whose address that domain gives to a platform page (for example
 * /privacy), which are listed at /coach/<slug>/<page> where they really are.
 * A launched coach who never published a website revision has the default
 * site, exactly as publicCoachSite() serves it.
 */
export function coachSitePaths(row: SiteRow, host: "platform" | "custom") {
  const parsed = siteSchema.safeParse(row.published ?? {});
  if (parsed.success && parsed.data.builder) {
    return parsed.data.builder.pages
      .filter((page) => page.visible && !page.noindex)
      .map((page) =>
        host === "custom"
          ? coachHostPagePath(row.slug, page.slug)
          : `/coach/${encodeURIComponent(row.slug)}${page.slug ? `/${page.slug}` : ""}`,
      );
  }
  const pages = parsed.success
    ? parsed.data.pages.filter((page) => page.visible).map((page) => page.slug)
    : [];
  const base =
    host === "custom" ? "" : `/coach/${encodeURIComponent(row.slug)}`;
  return [
    base || "/",
    ...STANDARD_SECTIONS.filter(
      (section) => section !== "galleries" || row.has_galleries,
    ).map((section) => `${base}/${section}`),
    ...pages.map((page) =>
      host === "custom" ? coachHostPagePath(row.slug, page) : `${base}/${page}`,
    ),
  ];
}

const siteColumns =
  "t.slug,s.published,s.published_at,EXISTS(SELECT 1 FROM coach_galleries g WHERE g.tenant_id=t.id AND g.audience IN ('site','both')) AS has_galleries";
const activeDomain =
  "SELECT 1 FROM domain_mappings m WHERE m.tenant_id=t.id AND m.active=true AND m.verified_at IS NOT NULL";
// Launched coaches whose website lives at /coach/<slug> on the platform. It is
// the same "launched" test the directory and publicCoachSite() use; a coach
// with a connected domain is listed by that domain's own sitemap instead.
const platformCoaches = `FROM tenants t LEFT JOIN coach_sites s ON s.tenant_id=t.id WHERE ${discoverable("t")} AND NOT EXISTS(${activeDomain})`;

export type SitemapPage = {
  entries: SitemapEntry[];
  /** Zero-based sitemap file number and the number of files. */
  page: number;
  pages: number;
};

const entry = (url: string, lastModified?: string): SitemapEntry =>
  lastModified ? { url, lastModified } : { url };

/**
 * One sitemap file for the host that asked. The platform lists marketing
 * pages, the directory and the websites of launched coaches without a
 * connected domain, SITEMAP_COACHES_PER_FILE coaches per file; when that needs
 * more than one file the web app serves a sitemap index. A coach domain has
 * one file listing only its own website.
 */
export async function sitemapEntries(
  db: Database,
  context: HostContext,
  page = 0,
  coachesPerFile = SITEMAP_COACHES_PER_FILE,
): Promise<SitemapPage> {
  const origin = new URL(context.origin).origin;
  const missing = () =>
    fail(404, "NOT_FOUND", "This sitemap file does not exist");
  if (context.custom) {
    if (page !== 0) throw missing();
    const [row] = await db.system((tx) =>
      tx.query<SiteRow>(
        `SELECT ${siteColumns} FROM tenants t LEFT JOIN coach_sites s ON s.tenant_id=t.id WHERE t.id=$1 AND ${discoverable("t")}`,
        [context.tenantId],
      ),
    );
    const lastModified = iso(row?.published_at);
    return {
      entries: row
        ? coachSitePaths(row, "custom").map((path) =>
            entry(origin + path, lastModified),
          )
        : [],
      page: 0,
      pages: 1,
    };
  }
  return db.system(async (tx) => {
    const [{ coaches }] = await tx.query<{ coaches: number }>(
      `SELECT count(*)::int AS coaches ${platformCoaches}`,
    );
    const pages = Math.max(1, Math.ceil(coaches / coachesPerFile));
    if (page >= pages) throw missing();
    const entries: SitemapEntry[] = [];
    if (page === 0) {
      for (const page of INDEXABLE_MARKETING_PAGES)
        entries.push(entry(origin + page.path, page.lastUpdated));
      if (directoryOpen()) entries.push(entry(origin + DIRECTORY_PATH));
    }
    const rows = await tx.query<SiteRow>(
      `SELECT ${siteColumns} ${platformCoaches} ORDER BY t.slug LIMIT $1 OFFSET $2`,
      [coachesPerFile, page * coachesPerFile],
    );
    for (const row of rows) {
      const lastModified = iso(row.published_at);
      for (const path of coachSitePaths(row, "platform"))
        entries.push(entry(origin + path, lastModified));
    }
    return { entries, page, pages };
  });
}

/** Only platform photos or already-validated public HTTPS images are shown. */
function directoryPhoto(design: BrandDesign): string | null {
  return design.photoUrl || design.logoUrl || null;
}
const headlineSql =
  "coalesce(nullif(s.published->>'headline',''),nullif(t.theme->>'headline',''),nullif(t.theme->'design'->>'tagline',''),'')";
const likePattern = (q: string) =>
  "%" + q.replace(/[\\%_]/g, (c) => "\\" + c) + "%";
const label = (list: readonly { id: string; label: string }[], id: string) =>
  list.find((item) => item.id === id)?.label ?? id;

/**
 * Directory search. Only name, headline, photo, specialties, languages and the
 * site address are returned: never member counts or any follower data.
 */
export async function searchDirectory(
  db: Database,
  context: HostContext,
  query: unknown,
) {
  const q = directorySearchSchema.parse(query);
  const origin = new URL(context.origin).origin;
  const rows = await db.system((tx) =>
    tx.query(
      `SELECT t.slug,t.name,t.theme,p.specialties,p.languages,${headlineSql} AS headline,(SELECT m.hostname FROM domain_mappings m WHERE m.tenant_id=t.id AND m.active=true AND m.verified_at IS NOT NULL ORDER BY m.hostname LIMIT 1) AS domain
       FROM coach_directory_profiles p JOIN tenants t ON t.id=p.tenant_id LEFT JOIN coach_sites s ON s.tenant_id=t.id
       WHERE p.listed=true AND ${discoverable("t")}
        AND ($1::text IS NULL OR $1=ANY(p.specialties))
        AND ($2::text IS NULL OR $2=ANY(p.languages))
        AND ($3::text IS NULL OR t.name ILIKE $3 ESCAPE '\\' OR ${headlineSql} ILIKE $3 ESCAPE '\\')
       ORDER BY lower(t.name),t.slug LIMIT $4 OFFSET $5`,
      [
        q.specialty ?? null,
        q.language ?? null,
        q.q ? likePattern(q.q) : null,
        DIRECTORY_PAGE_SIZE + 1,
        q.offset,
      ],
    ),
  );
  const more = rows.length > DIRECTORY_PAGE_SIZE;
  return {
    coaches: rows.slice(0, DIRECTORY_PAGE_SIZE).map((row) => {
      const design = resolveBrandDesign(row.theme);
      return {
        slug: row.slug,
        name: row.name,
        headline: String(row.headline ?? "").slice(0, 200),
        photoUrl: directoryPhoto(design),
        specialties: (row.specialties as string[])
          .filter((id) => !isHiddenSpecialty(id))
          .map((id) => ({
            id,
            label: label(DIRECTORY_SPECIALTIES, id),
          })),
        languages: (row.languages as string[]).map((id) => ({
          id,
          label: label(DIRECTORY_LANGUAGES, id),
        })),
        url: row.domain
          ? `https://${row.domain}/`
          : `${origin}/coach/${encodeURIComponent(row.slug)}`,
      };
    }),
    nextOffset: more ? q.offset + DIRECTORY_PAGE_SIZE : null,
    query: {
      q: q.q ?? "",
      specialty: q.specialty ?? "",
      language: q.language ?? "",
      offset: q.offset,
    },
    options: {
      specialties: OFFERED_DIRECTORY_SPECIALTIES,
      languages: DIRECTORY_LANGUAGES,
    },
    platformName: platformName(runtimeConfig().APP_NAME),
  };
}

function owner(req: FastifyRequest): Actor {
  const a = req.identity;
  if (!a) throw fail(401, "AUTH_REQUIRED", "Please sign in");
  if (a.role !== "owner")
    throw fail(
      403,
      "OWNER_REQUIRED",
      "Only the trainer owner can change the directory listing",
    );
  return a;
}
async function ownerTenant(tx: Tx) {
  const [row] = await tx.query("SELECT trainer_brand_tenant() AS tenant");
  if (!row?.tenant)
    throw fail(
      403,
      "OWNER_REQUIRED",
      "Current owner access to an active workspace is required",
    );
  return row.tenant as {
    id: string;
    slug: string;
    name: string;
    theme: unknown;
    published: boolean;
  };
}
async function listingView(tx: Tx, a: Actor) {
  const tenant = await ownerTenant(tx);
  const [row] = await tx.query(
    "SELECT listed,specialties,languages,version,listed_at FROM coach_directory_profiles WHERE tenant_id=$1",
    [a.tenantId],
  );
  const [site] = await tx.query(
    "SELECT published->>'headline' AS headline FROM coach_sites WHERE tenant_id=$1",
    [a.tenantId],
  );
  const theme = (tenant.theme ?? {}) as Record<string, any>;
  const design = resolveBrandDesign(tenant.theme);
  const listed = row?.listed === true,
    open = directoryOpen();
  return {
    listed,
    specialties: row?.specialties ?? [],
    languages: row?.languages ?? [],
    version: row?.version ?? 0,
    listedAt: row?.listed_at ?? null,
    directoryOpen: open,
    published: tenant.published === true,
    // Visible means a visitor would find it now; otherwise say why not.
    visible: listed && open && tenant.published === true,
    status: !listed
      ? "not_listed"
      : !open
        ? "directory_closed"
        : tenant.published !== true
          ? "waiting_for_launch"
          : "listed",
    preview: {
      name: tenant.name,
      headline: site?.headline || theme.headline || design.tagline || "",
      photoUrl: directoryPhoto(design),
      url: `/coach/${tenant.slug}`,
    },
    options: {
      specialties: OFFERED_DIRECTORY_SPECIALTIES,
      languages: DIRECTORY_LANGUAGES,
    },
  };
}

/**
 * The workspace's install icon capability. It is random, never derived from
 * the slug, and only returned to signed-in members of the workspace.
 */
export async function workspaceIconKey(
  db: Database,
  tenantId: string,
): Promise<string> {
  return db.system(async (tx) => {
    const [existing] = await tx.query(
      "SELECT icon_key FROM workspace_app_icons WHERE tenant_id=$1",
      [tenantId],
    );
    if (existing) return existing.icon_key;
    const [created] = await tx.query(
      "INSERT INTO workspace_app_icons(tenant_id,icon_key) VALUES($1,$2) ON CONFLICT(tenant_id) DO NOTHING RETURNING icon_key",
      [tenantId, randomBytes(24).toString("base64url")],
    );
    if (created) return created.icon_key;
    const [winner] = await tx.query(
      "SELECT icon_key FROM workspace_app_icons WHERE tenant_id=$1",
      [tenantId],
    );
    return winner.icon_key;
  });
}

const memberRoles = ["owner", "staff", "subscriber", "finance"];
/** The branded install description for a signed-in workspace member. */
export async function memberInstall(db: Database, a: Actor) {
  if (!memberRoles.includes(a.role))
    throw fail(403, "ROLE_REQUIRED", "Workspace membership required");
  const [tenant] = await db.system((tx) =>
    tx.query(
      "SELECT id,slug,name,theme,published FROM tenants WHERE id=$1 AND lifecycle_state='active'",
      [a.tenantId],
    ),
  );
  if (!tenant) throw fail(404, "NOT_FOUND", "This workspace is unavailable");
  const design = resolveBrandDesign(tenant.theme),
    key = await workspaceIconKey(db, tenant.id);
  // A new design produces new icon addresses, so installed apps refresh.
  const revision = createHash("sha256")
    .update(
      JSON.stringify([
        tenant.name,
        design.primary,
        design.surface,
        design.logoUrl,
      ]),
    )
    .digest("hex")
    .slice(0, 12);
  const icon = (file: AppIconFile) =>
    `/api/v1/app/icons/${key}/${file}?v=${revision}`;
  const name = String(tenant.name);
  const subscriber = a.role === "subscriber";
  // Shortcuts only for what this member can use; the manifest is per member
  // (cookie-scoped, Vary: Cookie), so nothing here reaches anyone else.
  const [features] = subscriber
    ? await db.tenant(a, async (tx) => {
        const [prefs] = await tx.query(
          "SELECT data->>'language' AS language FROM notification_preferences WHERE user_id=$1",
          [a.userId],
        );
        const [slots] = await tx.query(
          "SELECT EXISTS(SELECT 1 FROM booking_slots WHERE ends_at>now()-interval '30 days') AS bookings",
        );
        return [
          {
            language: prefs?.language ?? null,
            nutrition: await hasNutritionAccess(tx, a.userId),
            bookings: slots?.bookings === true,
          },
        ];
      })
    : [{ language: null, nutrition: false, bookings: false }];
  return {
    name,
    shortName: shortAppName(name),
    themeColor: design.primary,
    backgroundColor: design.surface,
    published: tenant.published === true,
    manifestUrl: "/api/v1/app/manifest.webmanifest",
    icons: { apple: icon("180.png"), icon: icon("192.png") },
    manifest: memberAppManifest({
      slug: tenant.slug,
      name,
      role: a.role,
      primary: design.primary,
      surface: design.surface,
      language: features.language,
      features: { nutrition: features.nutrition, bookings: features.bookings },
      icon,
    }),
  };
}

export { MASKABLE_LOGO_SCALE, renderAppIcon } from "./app-icons.ts";

const sitemapQuery = z
  .object({ page: z.coerce.number().int().min(0).max(100000).default(0) })
  .strict();

export function registerDiscovery(app: FastifyInstance, db: Database) {
  app.get("/api/v1/public/discovery/sitemap", async (req) => {
    const { page } = sitemapQuery.parse(req.query);
    return sitemapEntries(db, req.hostContext!, page);
  });
  app.get("/api/v1/public/directory", async (req) => {
    const context = req.hostContext!;
    // The directory belongs to the platform address, never a coach domain.
    if (context.custom || !directoryOpen())
      throw fail(
        404,
        "DIRECTORY_UNAVAILABLE",
        "The coach directory is not available",
      );
    return searchDirectory(db, context, req.query);
  });
  app.get("/api/v1/tenant/directory", async (req) => {
    const a = owner(req);
    return db.tenant(a, (tx) => listingView(tx, a));
  });
  app.put("/api/v1/tenant/directory", async (req) => {
    const a = owner(req),
      b = directoryListingSchema.parse(req.body);
    return db.tenant(a, async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        a.tenantId + ":directory",
      ]);
      await ownerTenant(tx);
      const values = [a.tenantId, b.listed, b.specialties, b.languages];
      const [saved] =
        b.version === 0
          ? await tx.query(
              "INSERT INTO coach_directory_profiles(tenant_id,listed,specialties,languages,listed_at) VALUES($1,$2,$3::text[],$4::text[],CASE WHEN $2 THEN now() END) ON CONFLICT(tenant_id) DO NOTHING RETURNING version",
              values,
            )
          : await tx.query(
              "UPDATE coach_directory_profiles SET listed=$2,specialties=$3::text[],languages=$4::text[],listed_at=CASE WHEN $2 THEN coalesce(listed_at,now()) END,version=version+1,updated_at=now() WHERE tenant_id=$1 AND version=$5 RETURNING version",
              [...values, b.version],
            );
      if (!saved)
        throw fail(
          409,
          "DIRECTORY_CHANGED",
          "Your directory listing changed in another session. Reload it first",
        );
      await event(tx, a, "directory.listing_updated", a.tenantId, {
        listed: b.listed,
        specialties: b.specialties,
        languages: b.languages,
        version: saved.version,
      });
      return listingView(tx, a);
    });
  });
  app.get("/api/v1/app/install", async (req) => {
    if (!req.identity) throw fail(401, "AUTH_REQUIRED", "Please sign in");
    const { manifest, ...install } = await memberInstall(db, req.identity);
    return install;
  });
  app.get("/api/v1/app/manifest.webmanifest", async (req, res) => {
    res
      .type("application/manifest+json")
      .header("Cache-Control", "private, no-cache")
      .header("Vary", "Cookie");
    // Anonymous visitors (or a browser that omits cookies) keep the platform
    // manifest instead of an error.
    if (!req.identity || !memberRoles.includes(req.identity.role))
      return platformManifest(platformName(runtimeConfig().APP_NAME));
    return (await memberInstall(db, req.identity)).manifest;
  });
  app.get("/api/v1/app/icons/:key/:file", async (req, res) => {
    const { key, file } = req.params as { key: string; file: string };
    if (!iconKeyPattern.test(key) || !Object.hasOwn(APP_ICON_FILES, file))
      throw fail(404, "NOT_FOUND", "Icon unavailable");
    const spec: (typeof APP_ICON_FILES)[AppIconFile] =
      APP_ICON_FILES[file as AppIconFile];
    const context = req.hostContext;
    const [tenant] = await db.system((tx) =>
      tx.query(
        "SELECT t.id,t.name,t.theme FROM workspace_app_icons k JOIN tenants t ON t.id=k.tenant_id WHERE k.icon_key=$1 AND t.lifecycle_state='active'",
        [key],
      ),
    );
    // A coach domain only serves its own workspace's icons.
    if (!tenant || (context?.custom && context.tenantId !== tenant.id))
      throw fail(404, "NOT_FOUND", "Icon unavailable");
    const design = resolveBrandDesign(tenant.theme);
    const mediaId = design.logoUrl.match(mediaPath)?.[1];
    const logo = mediaId
      ? await db.system(async (tx) => {
          const [m] = await tx.query(
            "SELECT media FROM brand_media WHERE id=$1 AND tenant_id=$2",
            [mediaId, tenant.id],
          );
          return m ? Buffer.from(m.media) : undefined;
        })
      : undefined;
    res.type("image/png").header("Cache-Control", "private, max-age=86400");
    return renderAppIcon({
      name: tenant.name,
      design,
      size: spec.size,
      variant: spec.variant,
      shortcut: "shortcut" in spec ? spec.shortcut : undefined,
      // Shortcut icons draw the feature's symbol, never the logo.
      logo: spec.variant === "shortcut" ? undefined : logo,
    });
  });
}
