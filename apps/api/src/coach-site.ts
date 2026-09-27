import { legalAcceptanceVersion } from "./legal.ts";
import { randomUUID, createHash } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  event,
  putRecord,
  type Actor,
  type Database,
  type Tx,
} from "@trainer/db";
import { brandSchema, resolveBrandDesign } from "@trainer/contracts";

const id = z.string().uuid();
const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
const mediaUrl = (mediaId: string) => `/api/v1/media/${mediaId}`;
const socialUrl = z
  .string()
  .trim()
  .max(1000)
  .refine((v) => !v || /^https:\/\/[^\s]+$/.test(v), "Use an HTTPS link");
const page = z
  .object({
    slug: z
      .string()
      .regex(/^[a-z][a-z0-9-]{0,59}$/)
      .refine(
        (v) => !["about", "memberships", "galleries", "contact"].includes(v),
      ),
    title: z.string().trim().min(1).max(100),
    body: z.string().trim().max(20000),
    visible: z.boolean().default(true),
  })
  .strict();
export const siteSchema = z
  .object({
    headline: z.string().trim().max(160).default(""),
    introduction: z.string().trim().max(2000).default(""),
    about: z.string().trim().max(12000).default(""),
    contactEmail: z.union([z.literal(""), z.string().email()]).default(""),
    whatsapp: z
      .string()
      .regex(/^$|^\+[1-9][0-9]{6,14}$/)
      .default(""),
    instagram: socialUrl.default(""),
    youtube: socialUrl.default(""),
    cta: z.string().trim().min(1).max(60).default("Start coaching"),
    seoTitle: z.string().trim().max(100).default(""),
    seoDescription: z.string().trim().max(200).default(""),
    pages: z.array(page).max(100).default([]),
  })
  .strict()
  .superRefine((v, c) => {
    if (new Set(v.pages.map((p) => p.slug)).size !== v.pages.length)
      c.addIssue({
        code: "custom",
        message: "Page addresses must be unique",
        path: ["pages"],
      });
  });
function owner(req: FastifyRequest) {
  const a = req.identity;
  if (!a) throw fail(401, "AUTH_REQUIRED", "Please sign in");
  if (a.role !== "owner")
    throw fail(
      403,
      "OWNER_REQUIRED",
      "Only the trainer owner can edit their website or photos",
    );
  return a;
}
function member(req: FastifyRequest) {
  const a = req.identity;
  if (!a) throw fail(401, "AUTH_REQUIRED", "Please sign in");
  if (!["owner", "staff", "subscriber"].includes(a.role))
    throw fail(403, "ROLE_REQUIRED", "Coaching access required");
  return a;
}
async function ownerTransaction<T>(
  db: Database,
  a: Actor,
  fn: (tx: Tx, tenant: any) => Promise<T>,
) {
  return db.tenant(a, async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      a.tenantId + ":workspace",
    ]);
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      a.tenantId + ":brand",
    ]);
    const [row] = await tx.query("SELECT trainer_brand_tenant() AS tenant");
    if (!row?.tenant)
      throw fail(
        403,
        "OWNER_REQUIRED",
        "Current owner access to an active workspace is required",
      );
    return fn(tx, row.tenant);
  });
}
export async function saveCoachBrand(
  db: Database,
  a: Actor,
  submitted: z.infer<typeof brandSchema>,
) {
  return db.system(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      a.tenantId + ":workspace",
    ]);
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      a.tenantId + ":brand",
    ]);
    // Lock the tenant row as well: onboarding may change the identity independently
    // of design editing. The current theme and audit event belong to one commit.
    await tx.query("SELECT id FROM tenants WHERE id=$1 FOR UPDATE", [
      a.tenantId,
    ]);
    await tx.query("SET LOCAL ROLE trainer_app");
    await tx.query(
      "SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true),set_config('app.role',$3,true)",
      [a.tenantId, a.userId, a.role],
    );
    const [row] = await tx.query("SELECT trainer_brand_tenant() AS tenant");
    if (!row?.tenant)
      throw fail(
        403,
        "OWNER_REQUIRED",
        "Current owner access to an active workspace is required",
      );
    const current = row.tenant,
      version = Number(current.theme?.brandVersion ?? 0);
    if (
      submitted.expectedVersion !== undefined &&
      submitted.expectedVersion !== version
    )
      throw fail(
        409,
        "BRAND_VERSION_CONFLICT",
        "Your design changed in another session. Reload before saving.",
      );
    await assertBrandMedia(tx, a, submitted.design);
    const { expectedVersion, ...data } = submitted;
    const next = { ...current.theme, ...data, brandVersion: version + 1 };
    await event(tx, a, "tenant.brand_updated", a.tenantId, {
      version: version + 1,
    });
    await tx.query("RESET ROLE");
    await tx.query("UPDATE tenants SET name=$2,theme=$3 WHERE id=$1", [
      a.tenantId,
      submitted.name,
      JSON.stringify(next),
    ]);
    return next;
  });
}
function withoutOwnedPhotoReferences(value: any, urls: Set<string>) {
  if (!value?.design || typeof value.design !== "object") return null;
  const design = { ...value.design };
  let changed = false;
  for (const key of ["logoUrl", "photoUrl", "coverUrl"]) {
    if (urls.has(design[key])) {
      design[key] = "";
      changed = true;
    }
  }
  return changed ? { ...value, design } : null;
}

// This is called only inside the reviewed erasure transaction. Normal owner
// photo deletion still refuses references; erasure removes those references
// atomically and invalidates stale design/gallery editors before dropping bytes.
export async function eraseOwnedBrandMedia(tx: Tx, userId: string) {
  const [scope] = await tx.query(
    "SELECT current_user AS database_role,nullif(current_setting('app.tenant_id',true),'')::uuid AS tenant_id,current_setting('app.role',true) AS role",
  );
  if (
    scope.database_role !== "trainer_app" ||
    scope.role !== "owner" ||
    !scope.tenant_id
  )
    throw fail(
      403,
      "PRIVACY_SCOPE_REQUIRED",
      "A scoped privacy operator transaction is required",
    );
  const tenantId = scope.tenant_id;
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    tenantId + ":workspace",
  ]);
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    tenantId + ":brand",
  ]);
  const owned = await tx.query(
    "SELECT id FROM brand_media WHERE owner_user_id=$1 ORDER BY id FOR UPDATE",
    [userId],
  );
  const mediaIds = owned.map((row) => row.id);
  const urls = new Set<string>(mediaIds.map(mediaUrl));
  const affectedGalleries = await tx.query(
    "UPDATE coach_galleries SET version=version+1,updated_at=now() WHERE owner_user_id<>$1 AND id IN (SELECT gallery_id FROM coach_gallery_photos WHERE media_id=ANY($2::uuid[])) RETURNING id",
    [userId, mediaIds],
  );
  await tx.query(
    "DELETE FROM coach_gallery_photos WHERE media_id=ANY($1::uuid[])",
    [mediaIds],
  );
  await tx.query("DELETE FROM coach_galleries WHERE owner_user_id=$1", [
    userId,
  ]);
  if (affectedGalleries.length)
    await tx.query(
      "WITH ordered AS (SELECT gallery_id,media_id,(row_number() OVER(PARTITION BY gallery_id ORDER BY position,media_id)-1)::integer AS position FROM coach_gallery_photos WHERE gallery_id=ANY($1::uuid[])) UPDATE coach_gallery_photos p SET position=o.position FROM ordered o WHERE p.gallery_id=o.gallery_id AND p.media_id=o.media_id",
      [affectedGalleries.map((row) => row.id)],
    );
  if (!mediaIds.length) return;
  const [draft] = await tx.query(
    "SELECT data FROM coach_design_drafts WHERE tenant_id=$1 FOR UPDATE",
    [tenantId],
  );
  const nextDraft = withoutOwnedPhotoReferences(draft?.data, urls);
  if (nextDraft)
    await tx.query(
      "UPDATE coach_design_drafts SET data=$2,version=version+1,updated_at=now() WHERE tenant_id=$1",
      [tenantId, JSON.stringify(nextDraft)],
    );
  // tenants is deliberately inaccessible to trainer_app. The active transaction
  // has already established one workspace and the erasure route's authority.
  await tx.query("RESET ROLE");
  const [tenant] = await tx.query(
    "SELECT theme FROM tenants WHERE id=$1 FOR UPDATE",
    [tenantId],
  );
  const nextTheme = withoutOwnedPhotoReferences(tenant?.theme, urls);
  if (nextTheme)
    await tx.query("UPDATE tenants SET theme=$2 WHERE id=$1", [
      tenantId,
      JSON.stringify({
        ...nextTheme,
        brandVersion: Number(tenant.theme?.brandVersion ?? 0) + 1,
      }),
    ]);
  await tx.query("SET LOCAL ROLE trainer_app");
  await tx.query("DELETE FROM brand_media WHERE owner_user_id=$1", [userId]);
}
function publicHost(req: FastifyRequest, slug?: string) {
  const context = (req as any).hostContext;
  if (context?.custom && slug !== undefined && slug !== context.tenantSlug)
    throw fail(404, "NOT_FOUND", "This website is unavailable at this address");
  return context?.custom ? context.tenantId : null;
}
async function gallery(tx: Tx, galleryId: string, version?: number) {
  const [g] = await tx.query(
    "SELECT * FROM coach_galleries WHERE id=$1 FOR UPDATE",
    [id.parse(galleryId)],
  );
  if (!g) throw fail(404, "NOT_FOUND", "Gallery unavailable");
  if (version !== undefined && g.version !== version)
    throw fail(
      409,
      "GALLERY_CHANGED",
      "This gallery changed. Refresh before saving",
    );
  return g;
}
export async function assertBrandMedia(tx: Tx, a: Actor, design: any) {
  for (const key of ["logoUrl", "photoUrl", "coverUrl"]) {
    const value = design?.[key] ?? "";
    if (value.startsWith("/api/v1/media/")) {
      const [m] = await tx.query(
        "SELECT id FROM brand_media WHERE id=$1 AND tenant_id=$2",
        [id.parse(value.split("/").pop()), a.tenantId],
      );
      if (!m)
        throw fail(
          400,
          "MEDIA_UNAVAILABLE",
          "Use a photo from your own library",
        );
    }
  }
}
async function listGalleries(tx: Tx, where = "", values: any[] = []) {
  const galleries = await tx.query(
    `SELECT * FROM coach_galleries ${where} ORDER BY created_at DESC,id DESC LIMIT 24`,
    values,
  );
  for (const g of galleries)
    g.photos = (
      await tx.query(
        "SELECT p.*,m.width,m.height FROM coach_gallery_photos p JOIN brand_media m ON m.id=p.media_id AND m.tenant_id=p.tenant_id WHERE p.gallery_id=$1 ORDER BY p.position,p.media_id",
        [g.id],
      )
    ).map((p) => ({ ...p, url: mediaUrl(p.media_id) }));
  return galleries;
}
export async function publicCoachSite(db: Database, slug: string) {
  const data = await db.system(async (tx) => {
    const [tenant] = await tx.query(
      "SELECT id,slug,name,theme,published FROM tenants WHERE slug=$1 AND published=true AND lifecycle_state='active'",
      [slug],
    );
    if (!tenant)
      throw fail(404, "NOT_FOUND", "This coaching website is unavailable");
    const [site] = await tx.query(
      "SELECT published,published_at FROM coach_sites WHERE tenant_id=$1",
      [tenant.id],
    );
    const visibleSite = siteSchema.parse(site?.published ?? {});
    visibleSite.pages = visibleSite.pages.filter((page) => page.visible);
    return {
      tenant,
      site: visibleSite,
      publishedAt: site?.published_at ?? null,
      galleries: await listGalleries(
        tx,
        "WHERE tenant_id=$1 AND audience IN ('site','both')",
        [tenant.id],
      ),
    };
  });
  const products = await db.tenant(
    {
      tenantId: data.tenant.id,
      userId: "00000000-0000-0000-0000-000000000000",
      role: "subscriber",
    },
    (tx) =>
      tx.query(
        "SELECT id,data FROM records WHERE kind='product' AND status='published' ORDER BY created_at",
      ),
  );
  return { ...data, products };
}

export function registerCoachSite(app: FastifyInstance, db: Database) {
  app.post(
    "/api/v1/tenant/media",
    { bodyLimit: 12 * 1024 * 1024 },
    async (req) => {
      const a = owner(req),
        b = z
          .object({
            filename: z.string().trim().min(1).max(160),
            data: z.string().max(12 * 1024 * 1024),
            rightsConfirmed: z.literal(true),
            crop: z
              .object({
                left: z.number().int().min(0),
                top: z.number().int().min(0),
                width: z.number().int().positive(),
                height: z.number().int().positive(),
              })
              .optional(),
          })
          .strict()
          .parse(req.body);
      if (b.data.length > Math.ceil((8 * 1024 * 1024) / 3) * 4)
        throw fail(400, "IMAGE_SIZE", "Choose an image up to 8 MB");
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b.data))
        throw fail(400, "IMAGE_INVALID", "Choose a valid image file");
      const raw = Buffer.from(b.data, "base64");
      if (raw.toString("base64") !== b.data)
        throw fail(400, "IMAGE_INVALID", "Choose valid base64 image data");
      if (!raw.length || raw.length > 8 * 1024 * 1024)
        throw fail(400, "IMAGE_SIZE", "Choose an image up to 8 MB");
      let bytes: Buffer, width: number, height: number;
      try {
        let image = sharp(raw, {
          limitInputPixels: 40_000_000,
          animated: false,
        });
        const meta = await image.metadata();
        if (
          !["jpeg", "png", "webp", "heif"].includes(meta.format ?? "") ||
          (meta.pages ?? 1) > 1
        )
          throw Error();
        if (b.crop) {
          if (
            b.crop.left + b.crop.width > (meta.width ?? 0) ||
            b.crop.top + b.crop.height > (meta.height ?? 0)
          )
            throw Error();
          image = image.extract(b.crop);
        }
        const result = await image
          .rotate()
          .resize({
            width: 2400,
            height: 2400,
            fit: "inside",
            withoutEnlargement: true,
          })
          .jpeg({ quality: 88 })
          .toBuffer({ resolveWithObject: true });
        bytes = result.data;
        width = result.info.width;
        height = result.info.height;
      } catch {
        throw fail(
          400,
          "IMAGE_INVALID",
          "Choose a still JPEG, PNG or WebP image with a valid crop",
        );
      }
      const digest = createHash("sha256").update(bytes).digest("hex");
      return ownerTransaction(db, a, async (tx, tenant) => {
        const [m] = await tx.query(
          "INSERT INTO brand_media(id,tenant_id,owner_user_id,digest,media,width,height,filename) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(tenant_id,digest) DO UPDATE SET digest=excluded.digest RETURNING id,width,height,filename",
          [
            randomUUID(),
            a.tenantId,
            a.userId,
            digest,
            bytes,
            width,
            height,
            b.filename,
          ],
        );
        await event(tx, a, "brand.photo_uploaded", m.id, {
          rightsConfirmed: true,
        });
        return { ...m, url: mediaUrl(m.id) };
      });
    },
  );
  app.get("/api/v1/tenant/media", async (req) => {
    const a = owner(req),
      q = z
        .object({ offset: z.coerce.number().int().min(0).default(0) })
        .parse(req.query);
    return ownerTransaction(db, a, async (tx, tenant) => ({
      items: (
        await tx.query(
          "SELECT id,filename,width,height,created_at FROM brand_media ORDER BY created_at DESC,id DESC LIMIT 48 OFFSET $1",
          [q.offset],
        )
      ).map((m) => ({ ...m, url: mediaUrl(m.id) })),
    }));
  });
  app.delete("/api/v1/tenant/media/:id", async (req) => {
    const a = owner(req),
      mediaId = id.parse((req.params as any).id);
    return ownerTransaction(db, a, async (tx, tenant) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        a.tenantId + ":brand",
      ]);
      const [existing] = await tx.query(
        "SELECT id FROM brand_media WHERE id=$1 FOR UPDATE",
        [mediaId],
      );
      if (!existing) throw fail(404, "NOT_FOUND", "Photo unavailable");
      const [draft] = await tx.query(
        "SELECT data FROM coach_design_drafts WHERE tenant_id=$1",
        [a.tenantId],
      );
      const used = [tenant.theme?.design, draft?.data?.design].some((design) =>
        ["logoUrl", "photoUrl", "coverUrl"].some(
          (key) => design?.[key] === mediaUrl(mediaId),
        ),
      );
      const [photo] = await tx.query(
        "SELECT gallery_id FROM coach_gallery_photos WHERE media_id=$1",
        [mediaId],
      );
      if (used || photo)
        throw fail(
          409,
          "PHOTO_IN_USE",
          "Remove this photo from your design and galleries before deleting it",
        );
      await tx.query("DELETE FROM brand_media WHERE id=$1", [mediaId]);
      await event(tx, a, "brand.photo_deleted", mediaId);
      return { ok: true };
    });
  });
  app.get("/api/v1/media/:id", async (req, reply) => {
    const mediaId = id.parse((req.params as any).id);
    const hostTenant = publicHost(req);
    if (hostTenant && req.identity && req.identity.tenantId !== hostTenant)
      throw fail(404, "NOT_FOUND", "Image unavailable");
    let m: any;
    if (
      req.identity &&
      ["owner", "staff", "subscriber"].includes(req.identity.role)
    )
      m = await db.tenant(
        req.identity,
        async (tx) =>
          (
            await tx.query(
              "SELECT media,width,height FROM brand_media WHERE id=$1",
              [mediaId],
            )
          )[0],
      );
    if (!m)
      m = await db.system(
        async (tx) =>
          (
            await tx.query(
              "SELECT m.media,m.width,m.height FROM brand_media m JOIN tenants t ON t.id=m.tenant_id WHERE m.id=$1 AND t.published=true AND t.lifecycle_state='active' AND ($3::uuid IS NULL OR t.id=$3) AND ($2 IN (t.theme->'design'->>'logoUrl',t.theme->'design'->>'photoUrl',t.theme->'design'->>'coverUrl') OR EXISTS(SELECT 1 FROM coach_gallery_photos p JOIN coach_galleries g ON g.id=p.gallery_id AND g.tenant_id=p.tenant_id WHERE p.media_id=m.id AND p.tenant_id=m.tenant_id AND g.audience IN ('site','both')))",
              [mediaId, mediaUrl(mediaId), publicHost(req)],
            )
          )[0],
      );
    if (!m) throw fail(404, "NOT_FOUND", "Image unavailable");
    reply.header("Cache-Control", "private, no-store").type("image/jpeg");
    return Buffer.from(m.media);
  });
  app.get("/api/v1/tenant/galleries", async (req) => {
    const a = member(req),
      q = z
        .object({ offset: z.coerce.number().int().min(0).default(0) })
        .parse(req.query);
    return db.tenant(a, async (tx) => {
      const galleries = await tx.query(
        "SELECT * FROM coach_galleries ORDER BY created_at DESC,id DESC LIMIT 24 OFFSET $1",
        [q.offset],
      );
      for (const g of galleries)
        g.photos = (
          await tx.query(
            "SELECT p.*,m.width,m.height FROM coach_gallery_photos p JOIN brand_media m ON m.id=p.media_id WHERE gallery_id=$1 ORDER BY position,media_id",
            [g.id],
          )
        ).map((p) => ({ ...p, url: mediaUrl(p.media_id) }));
      return {
        galleries,
        nextOffset: galleries.length === 24 ? q.offset + 24 : null,
      };
    });
  });
  app.post("/api/v1/tenant/galleries", async (req) => {
    const a = owner(req),
      b = z
        .object({
          title: z.string().trim().min(1).max(100),
          description: z.string().trim().max(2000).default(""),
        })
        .strict()
        .parse(req.body);
    return ownerTransaction(
      db,
      a,
      async (tx, tenant) =>
        (
          await tx.query(
            "INSERT INTO coach_galleries(id,tenant_id,owner_user_id,title,description) VALUES($1,$2,$3,$4,$5) RETURNING *",
            [randomUUID(), a.tenantId, a.userId, b.title, b.description],
          )
        )[0],
    );
  });
  app.get("/api/v1/tenant/galleries/:id", async (req) => {
    const a = owner(req);
    return ownerTransaction(db, a, async (tx) => {
      const g = await gallery(tx, (req.params as any).id);
      g.photos = (
        await tx.query(
          "SELECT p.*,m.width,m.height FROM coach_gallery_photos p JOIN brand_media m ON m.id=p.media_id AND m.tenant_id=p.tenant_id WHERE p.gallery_id=$1 ORDER BY p.position,p.media_id",
          [g.id],
        )
      ).map((p) => ({ ...p, url: mediaUrl(p.media_id) }));
      return g;
    });
  });
  app.patch("/api/v1/tenant/galleries/:id", async (req) => {
    const a = owner(req),
      b = z
        .object({
          version: z.number().int().positive(),
          title: z.string().trim().min(1).max(100),
          description: z.string().trim().max(2000),
          audience: z.enum(["draft", "site", "app", "both"]),
        })
        .strict()
        .parse(req.body);
    return ownerTransaction(db, a, async (tx, tenant) => {
      const g = await gallery(tx, (req.params as any).id, b.version);
      return (
        await tx.query(
          "UPDATE coach_galleries SET title=$2,description=$3,audience=$4,version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
          [g.id, b.title, b.description, b.audience],
        )
      )[0];
    });
  });
  app.delete("/api/v1/tenant/galleries/:id", async (req) => {
    const a = owner(req),
      b = z
        .object({ version: z.number().int().positive() })
        .strict()
        .parse(req.body);
    return ownerTransaction(db, a, async (tx, tenant) => {
      const g = await gallery(tx, (req.params as any).id, b.version);
      await tx.query("DELETE FROM coach_galleries WHERE id=$1", [g.id]);
      return { ok: true };
    });
  });
  app.put("/api/v1/tenant/galleries/:id/photos", async (req) => {
    const a = owner(req),
      b = z
        .object({
          version: z.number().int().positive(),
          photos: z
            .array(
              z.object({
                mediaId: id,
                alt: z.string().trim().min(1).max(300),
                caption: z.string().trim().max(2000).default(""),
              }),
            )
            .max(300),
        })
        .strict()
        .parse(req.body);
    if (new Set(b.photos.map((p) => p.mediaId)).size !== b.photos.length)
      throw fail(
        400,
        "DUPLICATE_PHOTO",
        "Each photo can appear once in a gallery",
      );
    return ownerTransaction(db, a, async (tx, tenant) => {
      const g = await gallery(tx, (req.params as any).id, b.version);
      for (const p of b.photos) {
        const [m] = await tx.query("SELECT id FROM brand_media WHERE id=$1", [
          p.mediaId,
        ]);
        if (!m)
          throw fail(404, "NOT_FOUND", "One of these photos is unavailable");
      }
      await tx.query("DELETE FROM coach_gallery_photos WHERE gallery_id=$1", [
        g.id,
      ]);
      for (const [position, p] of b.photos.entries())
        await tx.query(
          "INSERT INTO coach_gallery_photos(tenant_id,gallery_id,media_id,caption,alt,position) VALUES($1,$2,$3,$4,$5,$6)",
          [a.tenantId, g.id, p.mediaId, p.caption, p.alt, position],
        );
      return (
        await tx.query(
          "UPDATE coach_galleries SET version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
          [g.id],
        )
      )[0];
    });
  });
  app.get("/api/v1/tenant/site/inquiries", async (req) => {
    const a = owner(req);
    return ownerTransaction(db, a, async (tx, tenant) => ({
      items: await tx.query(
        "SELECT * FROM records WHERE kind='website_inquiry' ORDER BY created_at DESC LIMIT 200",
      ),
    }));
  });
  app.post("/api/v1/tenant/site/inquiries/:id", async (req) => {
    const a = owner(req),
      b = z
        .object({ version: z.number().int().positive() })
        .strict()
        .parse(req.body);
    return ownerTransaction(db, a, async (tx, tenant) => {
      const [r] = await tx.query(
        "UPDATE records SET status='handled',version=version+1,updated_at=now() WHERE id=$1 AND kind='website_inquiry' AND version=$2 RETURNING id",
        [id.parse((req.params as any).id), b.version],
      );
      if (!r)
        throw fail(
          409,
          "INQUIRY_CHANGED",
          "This inquiry changed. Refresh the page",
        );
      return { ok: true };
    });
  });
  app.get("/api/v1/tenant/site", async (req) => {
    const a = owner(req);
    return ownerTransaction(db, a, async (tx, tenant) => {
      const [s] = await tx.query(
        "SELECT * FROM coach_sites WHERE tenant_id=$1",
        [a.tenantId],
      );
      return s ?? { draft: siteSchema.parse({}), published: null, version: 0 };
    });
  });
  app.put("/api/v1/tenant/site", async (req) => {
    const a = owner(req),
      b = z
        .object({ version: z.number().int().min(0), site: siteSchema })
        .strict()
        .parse(req.body);
    return ownerTransaction(db, a, async (tx, tenant) => {
      await tx.query(
        "INSERT INTO coach_sites(tenant_id) VALUES($1) ON CONFLICT DO NOTHING",
        [a.tenantId],
      );
      const [s] = await tx.query(
        "UPDATE coach_sites SET draft=$2,version=version+1,updated_at=now() WHERE tenant_id=$1 AND version=$3 RETURNING *",
        [a.tenantId, JSON.stringify(b.site), b.version],
      );
      if (!s)
        throw fail(
          409,
          "SITE_CHANGED",
          "Your website draft changed. Refresh before saving",
        );
      return s;
    });
  });
  app.post("/api/v1/tenant/site/publish", async (req) => {
    const a = owner(req),
      b = z
        .object({ version: z.number().int().positive() })
        .strict()
        .parse(req.body);
    return ownerTransaction(db, a, async (tx, tenant) => {
      if (!tenant.published)
        throw fail(
          409,
          "LAUNCH_REQUIRED",
          "Finish your coach launch review before publishing the website",
        );
      const [s] = await tx.query(
        "UPDATE coach_sites SET published=draft,published_at=now(),version=version+1 WHERE tenant_id=$1 AND version=$2 RETURNING *",
        [a.tenantId, b.version],
      );
      if (!s)
        throw fail(
          409,
          "SITE_CHANGED",
          "Refresh before publishing your current draft",
        );
      await event(tx, a, "website.published", a.tenantId, {
        version: s.version,
      });
      return s;
    });
  });
  app.get("/api/v1/tenant/site/preview", async (req) => {
    const a = owner(req);
    return ownerTransaction(db, a, async (tx, tenant) => {
      const [site] = await tx.query(
        "SELECT draft FROM coach_sites WHERE tenant_id=$1",
        [a.tenantId],
      );
      return {
        tenant,
        site: siteSchema.parse(site?.draft ?? {}),
        galleries: await listGalleries(tx),
        products: await tx.query(
          "SELECT id,data FROM records WHERE kind='product' ORDER BY created_at",
        ),
        preview: true,
      };
    });
  });
  app.get("/api/v1/public/sites/:slug", async (req) => {
    publicHost(req, (req.params as any).slug);
    return publicCoachSite(db, (req.params as any).slug);
  });
  app.get("/api/v1/public/sites/:slug/galleries", async (req) => {
    const q = z
        .object({ offset: z.coerce.number().int().min(0).default(0) })
        .parse(req.query),
      slug = (req.params as any).slug;
    publicHost(req, slug);
    return db.system(async (tx) => {
      const [t] = await tx.query(
        "SELECT id FROM tenants WHERE slug=$1 AND published=true AND lifecycle_state='active'",
        [slug],
      );
      if (!t) throw fail(404, "NOT_FOUND", "Website unavailable");
      const rows = await tx.query(
        "SELECT * FROM coach_galleries WHERE tenant_id=$1 AND audience IN ('site','both') ORDER BY created_at DESC,id DESC LIMIT 24 OFFSET $2",
        [t.id, q.offset],
      );
      for (const g of rows)
        g.photos = (
          await tx.query(
            "SELECT * FROM coach_gallery_photos WHERE tenant_id=$1 AND gallery_id=$2 ORDER BY position,media_id",
            [t.id, g.id],
          )
        ).map((p) => ({ ...p, url: mediaUrl(p.media_id) }));
      return {
        galleries: rows,
        nextOffset: rows.length === 24 ? q.offset + 24 : null,
      };
    });
  });
  app.post(
    "/api/v1/public/sites/:slug/contact",
    { config: { rateLimit: { max: 4, timeWindow: "1 hour" } } },
    async (req) => {
      const b = z
        .object({
          name: z.string().trim().min(1).max(100),
          email: z.string().email(),
          message: z.string().trim().min(10).max(4000),
          consent: z.literal(true),
          website: z.string().default(""),
        })
        .strict()
        .parse(req.body);
      if (b.website) return { ok: true };
      publicHost(req, (req.params as any).slug);
      const contactVersion = await legalAcceptanceVersion(
        db,
        "website_contact",
      );
      const { tenant } = await publicCoachSite(db, (req.params as any).slug);
      const a = await db.system(
        async (tx) =>
          (
            await tx.query(
              "SELECT user_id FROM memberships WHERE tenant_id=$1 AND role='owner'",
              [tenant.id],
            )
          )[0],
      );
      if (!a) throw fail(404, "NOT_FOUND", "Coach unavailable");
      await ownerTransaction(
        db,
        { tenantId: tenant.id, userId: a.user_id, role: "owner" },
        (tx) =>
          putRecord(
            tx,
            { tenantId: tenant.id, userId: a.user_id, role: "owner" },
            "website_inquiry",
            {
              name: b.name,
              email: b.email,
              message: b.message,
              consent: true,
              consentVersion: contactVersion,
              submittedAt: new Date().toISOString(),
            },
            { status: "open" },
          ),
      );
      return { ok: true };
    },
  );
  app.get("/api/v1/tenant/design-draft", async (req) => {
    const a = owner(req);
    return ownerTransaction(
      db,
      a,
      async (tx, tenant) =>
        (
          await tx.query(
            "SELECT * FROM coach_design_drafts WHERE tenant_id=$1",
            [a.tenantId],
          )
        )[0] ?? { version: 0, data: null },
    );
  });
  app.put("/api/v1/tenant/design-draft", async (req) => {
    const a = owner(req),
      b = z
        .object({ version: z.number().int().min(0), data: brandSchema })
        .strict()
        .parse(req.body);
    return ownerTransaction(db, a, async (tx, tenant) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        a.tenantId + ":brand",
      ]);
      await assertBrandMedia(tx, a, b.data.design);
      const [current] = await tx.query(
        "SELECT version FROM coach_design_drafts WHERE tenant_id=$1",
        [a.tenantId],
      );
      if ((current?.version ?? 0) !== b.version)
        throw fail(
          409,
          "DRAFT_CHANGED",
          "Your private draft changed. Reload it first",
        );
      return (
        await tx.query(
          "INSERT INTO coach_design_drafts(tenant_id,data) VALUES($1,$2) ON CONFLICT(tenant_id) DO UPDATE SET data=excluded.data,version=coach_design_drafts.version+1,updated_at=now() RETURNING *",
          [a.tenantId, JSON.stringify(b.data)],
        )
      )[0];
    });
  });
  app.get(
    "/api/v1/public/sites/:slug/manifest.webmanifest",
    async (req, reply) => {
      publicHost(req, (req.params as any).slug);
      const { tenant } = await publicCoachSite(db, (req.params as any).slug),
        design = resolveBrandDesign(tenant.theme);
      reply.type("application/manifest+json");
      return {
        id: `/coach/${tenant.slug}`,
        name: tenant.name,
        short_name: tenant.name.slice(0, 30),
        start_url: "/app",
        scope: "/",
        display: "standalone",
        background_color: design.surface,
        theme_color: design.primary,
        icons: [192, 512].map((size) => ({
          src: `/api/v1/public/sites/${tenant.slug}/icon/${size}`,
          sizes: `${size}x${size}`,
          type: "image/png",
          purpose: "any",
        })),
      };
    },
  );
  app.get("/api/v1/public/sites/:slug/icon/:size", async (req, reply) => {
    publicHost(req, (req.params as any).slug);
    const { tenant } = await publicCoachSite(db, (req.params as any).slug),
      size = z.coerce
        .number()
        .refine((v) => [192, 512].includes(v))
        .parse((req.params as any).size),
      design = resolveBrandDesign(tenant.theme);
    let source: Buffer | undefined;
    const mediaId = design.logoUrl.startsWith("/api/v1/media/")
      ? design.logoUrl.split("/").pop()
      : undefined;
    if (mediaId)
      source = await db.system(async (tx) => {
        const [m] = await tx.query(
          "SELECT media FROM brand_media WHERE id=$1 AND tenant_id=$2",
          [mediaId, tenant.id],
        );
        return m ? Buffer.from(m.media) : undefined;
      });
    const initials = tenant.name
      .split(/\s+/)
      .map((s: string) => s[0])
      .join("")
      .slice(0, 2)
      .replace(/[<>&"']/g, "");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" rx="80" fill="${design.primary}"/><text x="256" y="310" text-anchor="middle" font-family="sans-serif" font-size="190" fill="white">${initials}</text></svg>`;
    reply.type("image/png");
    return sharp(source ?? Buffer.from(svg))
      .resize(size, size, { fit: "contain", background: design.primary })
      .png()
      .toBuffer();
  });
}
