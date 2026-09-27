import { createHash, randomBytes } from "node:crypto";
import sharp from "sharp";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { event, type Actor, type Database, type Tx } from "@trainer/db";
import {
  APP_ICON_FILES,
  DIRECTORY_LANGUAGES,
  DIRECTORY_PAGE_SIZE,
  DIRECTORY_PATH,
  DIRECTORY_SPECIALTIES,
  PUBLIC_MARKETING_PATHS,
  appInitials,
  brandContrast,
  directoryListingSchema,
  directorySearchSchema,
  platformManifest,
  resolveBrandDesign,
  shortAppName,
  type AppIconFile,
  type BrandDesign,
} from "@trainer/contracts";
import { runtimeConfig } from "../../../packages/providers/src/configuration.ts";
import { siteSchema } from "./coach-site.ts";
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

/** Sitemaps are capped well below the 50,000 URL protocol limit. */
export const SITEMAP_URL_LIMIT = 45000;
const STANDARD_SECTIONS = ["about", "memberships", "galleries", "contact"];
const mediaPath = /^\/api\/v1\/media\/([0-9a-f-]{36})$/i;
const iconKeyPattern = /^[A-Za-z0-9_-]{32,64}$/;

type SiteRow = {
  slug: string;
  published: unknown;
  published_at: Date | string | null;
  has_galleries: boolean;
};
type SitemapEntry = { url: string; lastModified?: string };

function iso(value: Date | string | null | undefined) {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** Published pages of one coach website, relative to `base` ("" or /coach/x). */
export function coachSitePaths(row: SiteRow, base: string): string[] {
  const parsed = siteSchema.safeParse(row.published ?? {});
  const pages = parsed.success
    ? parsed.data.pages.filter((page) => page.visible).map((page) => page.slug)
    : [];
  return [
    base || "/",
    ...STANDARD_SECTIONS.filter(
      (section) => section !== "galleries" || row.has_galleries,
    ).map((section) => `${base}/${section}`),
    ...pages.map((slug) => `${base}/${slug}`),
  ];
}

const siteColumns =
  "t.slug,s.published,s.published_at,EXISTS(SELECT 1 FROM coach_galleries g WHERE g.tenant_id=t.id AND g.audience IN ('site','both')) AS has_galleries";
const activeDomain =
  "SELECT 1 FROM domain_mappings m WHERE m.tenant_id=t.id AND m.active=true AND m.verified_at IS NOT NULL";

/**
 * Sitemap entries for the host that asked. The platform lists marketing pages,
 * the directory and the published sites of discoverable coaches that have no
 * connected domain; a coach domain lists only its own published site pages.
 */
export async function sitemapEntries(
  db: Database,
  context: HostContext,
): Promise<SitemapEntry[]> {
  const origin = new URL(context.origin).origin;
  if (context.custom) {
    const [row] = await db.system((tx) =>
      tx.query<SiteRow>(
        `SELECT ${siteColumns} FROM tenants t JOIN coach_sites s ON s.tenant_id=t.id WHERE t.id=$1 AND ${discoverable("t")} AND s.published IS NOT NULL`,
        [context.tenantId],
      ),
    );
    if (!row) return [];
    const lastModified = iso(row.published_at);
    return coachSitePaths(row, "").map((path) => ({
      url: origin + path,
      ...(lastModified ? { lastModified } : {}),
    }));
  }
  const entries: SitemapEntry[] = PUBLIC_MARKETING_PATHS.map((path) => ({
    url: origin + path,
  }));
  if (directoryOpen()) entries.push({ url: origin + DIRECTORY_PATH });
  const rows = await db.system((tx) =>
    tx.query<SiteRow>(
      `SELECT ${siteColumns} FROM tenants t JOIN coach_sites s ON s.tenant_id=t.id WHERE ${discoverable("t")} AND s.published IS NOT NULL AND NOT EXISTS(${activeDomain}) ORDER BY t.slug LIMIT 1000`,
    ),
  );
  for (const row of rows) {
    const lastModified = iso(row.published_at);
    for (const path of coachSitePaths(
      row,
      `/coach/${encodeURIComponent(row.slug)}`,
    )) {
      if (entries.length >= SITEMAP_URL_LIMIT) return entries;
      entries.push({
        url: origin + path,
        ...(lastModified ? { lastModified } : {}),
      });
    }
  }
  return entries;
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
        specialties: (row.specialties as string[]).map((id) => ({
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
      specialties: DIRECTORY_SPECIALTIES,
      languages: DIRECTORY_LANGUAGES,
    },
    platformName: runtimeConfig().APP_NAME || "Trainer Brain",
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
      specialties: DIRECTORY_SPECIALTIES,
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
  return {
    name,
    shortName: shortAppName(name),
    themeColor: design.primary,
    backgroundColor: design.surface,
    published: tenant.published === true,
    manifestUrl: "/api/v1/app/manifest.webmanifest",
    icons: { apple: icon("180.png"), icon: icon("192.png") },
    manifest: {
      id: `/coach/${tenant.slug}`,
      name,
      short_name: shortAppName(name),
      description: `${name} coaching`,
      start_url: a.role === "subscriber" ? "/app" : "/trainer",
      scope: "/",
      display: "standalone",
      background_color: design.surface,
      theme_color: design.primary,
      icons: [
        { file: "192.png", sizes: "192x192", purpose: "any" },
        { file: "512.png", sizes: "512x512", purpose: "any" },
        { file: "maskable-512.png", sizes: "512x512", purpose: "maskable" },
      ].map((entry) => ({
        src: icon(entry.file as AppIconFile),
        sizes: entry.sizes,
        type: "image/png",
        purpose: entry.purpose,
      })),
    },
  };
}

const escapeXml = (value: string) =>
  value.replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
/**
 * Render an exact-size PNG. A platform-hosted logo sits on the brand surface
 * colour (inside the maskable safe zone when needed); otherwise initials are
 * drawn on the brand primary colour. Output is always opaque.
 */
export async function renderAppIcon(options: {
  name: string;
  design: BrandDesign;
  size: number;
  variant: "any" | "apple" | "maskable";
  logo?: Buffer;
}): Promise<Buffer> {
  const { name, design, size, variant, logo } = options;
  if (logo) {
    try {
      const inner = Math.round(
        size *
          (variant === "maskable" ? 0.6 : variant === "apple" ? 0.8 : 0.84),
      );
      const fitted = await sharp(logo)
        .resize(inner, inner, {
          fit: "contain",
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png()
        .toBuffer();
      return await sharp({
        create: {
          width: size,
          height: size,
          channels: 3,
          background: design.surface,
        },
      })
        .composite([{ input: fitted, gravity: "centre" }])
        .png()
        .toBuffer();
    } catch {
      // A damaged stored image falls back to initials rather than failing.
    }
  }
  const ink =
    brandContrast("#ffffff", design.primary) >=
    brandContrast("#000000", design.primary)
      ? "#ffffff"
      : "#000000";
  const fontSize = variant === "maskable" ? 150 : 190;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512"><rect width="512" height="512" fill="${design.primary}"/><text x="256" y="256" dy="0.35em" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${fontSize}" fill="${ink}">${escapeXml(appInitials(name))}</text></svg>`;
  return sharp(Buffer.from(svg))
    .resize(size, size)
    .flatten({ background: design.primary })
    .png()
    .toBuffer();
}

export function registerDiscovery(app: FastifyInstance, db: Database) {
  app.get("/api/v1/public/discovery/sitemap", async (req) => {
    return { entries: await sitemapEntries(db, req.hostContext!) };
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
      return platformManifest(runtimeConfig().APP_NAME || undefined);
    return (await memberInstall(db, req.identity)).manifest;
  });
  app.get("/api/v1/app/icons/:key/:file", async (req, res) => {
    const { key, file } = req.params as { key: string; file: string };
    if (!iconKeyPattern.test(key) || !Object.hasOwn(APP_ICON_FILES, file))
      throw fail(404, "NOT_FOUND", "Icon unavailable");
    const spec = APP_ICON_FILES[file as AppIconFile];
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
      logo,
    });
  });
}
