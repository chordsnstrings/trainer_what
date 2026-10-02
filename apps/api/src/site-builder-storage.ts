import { createHash } from "node:crypto";
import { putRecord, type Actor, type Tx } from "@trainer/db";
import {
  builderContentText,
  builderMediaReferences,
  getBuilderPublishIssues,
  projectPublishedBuilder,
  type SiteBuilderDocument,
} from "@trainer/contracts";
import { pageIssues } from "../../../packages/domain/src/coach-setup.ts";

/** Published snapshots only; private autosaves remain in coach_sites.draft. */
export const SITE_HISTORY_LIMIT = 20;
export const SITE_DOCUMENT_BYTES = 2 * 1024 * 1024;
const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });

export function siteDigest(site: unknown) {
  return createHash("sha256").update(JSON.stringify(site)).digest("hex");
}

/** Refs are read from typed fields, never substring matches in trainer copy. */
export function siteBuilderBindings(builder: SiteBuilderDocument) {
  const products = new Set<string>(),
    galleries = new Set<string>();
  const visit = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (key === "productId" && typeof child === "string") products.add(child);
      else if (key === "productIds" && Array.isArray(child)) {
        for (const item of child)
          if (typeof item === "string") products.add(item);
      } else if (key === "galleryId" && typeof child === "string")
        galleries.add(child);
      else if (typeof child === "object") visit(child);
    }
  };
  visit(builder);
  return { products: [...products], galleries: [...galleries] };
}

/** Must run within the same owner/workspace lock as save, publish or restore. */
export async function assertSiteBuilderReferences(
  tx: Tx,
  a: Actor,
  builder: SiteBuilderDocument | undefined,
  published = false,
) {
  if (!builder) return;
  if (published) {
    const issues = getBuilderPublishIssues(builder);
    if (issues.length)
      throw fail(
        400,
        "SITE_NOT_READY",
        issues
          .map((issue) => issue.message)
          .slice(0, 5)
          .join(" "),
      );
    const copyIssues = pageIssues({ builder: builderContentText(builder) });
    if (copyIssues.length)
      throw fail(
        400,
        "SITE_COPY_REVIEW",
        copyIssues.some((issue) => issue.issue === "medical_claim")
          ? "Review your website wording before publishing. Remove medical advice, treatment claims and guaranteed results."
          : "Use the website's contact fields and link controls for addresses and contact details, rather than placing them in page text.",
      );
  }
  // A hidden section may retain private resources in the draft, but can never
  // make those bytes public or block publishing the visible site.
  const document = published ? projectPublishedBuilder(builder) : builder;
  const ids = builderMediaReferences(document).map((url) =>
    url.split("/").pop()!,
  );
  if (ids.length) {
    const media = await tx.query(
      "SELECT id FROM brand_media WHERE tenant_id=$1 AND id=ANY($2::uuid[])",
      [a.tenantId, ids],
    );
    if (new Set(media.map((row) => row.id)).size !== new Set(ids).size)
      throw fail(
        400,
        "MEDIA_UNAVAILABLE",
        "Choose website photos from your own media library. A selected photo may have been removed.",
      );
  }
  const { products, galleries } = siteBuilderBindings(document);
  if (products.length) {
    const rows = await tx.query(
      "SELECT id,status FROM records WHERE tenant_id=$1 AND kind='product' AND id=ANY($2::uuid[])",
      [a.tenantId, products],
    );
    if (
      rows.length !== products.length ||
      (published && rows.some((row) => row.status !== "published"))
    )
      throw fail(
        400,
        "SITE_PRODUCT_UNAVAILABLE",
        published
          ? "Publish the selected coaching offers, or remove them from the visible website before publishing."
          : "Choose coaching offers from this workspace.",
      );
  }
  if (galleries.length) {
    const rows = await tx.query(
      "SELECT id,audience FROM coach_galleries WHERE tenant_id=$1 AND id=ANY($2::uuid[])",
      [a.tenantId, galleries],
    );
    if (
      rows.length !== galleries.length ||
      (published &&
        rows.some((row) => !["site", "both"].includes(row.audience)))
    )
      throw fail(
        400,
        "SITE_GALLERY_UNAVAILABLE",
        published
          ? "Make the selected gallery available on your website, or remove its section before publishing."
          : "Choose galleries from this workspace.",
      );
  }
}

export async function recordSitePublication(
  tx: Tx,
  a: Actor,
  site: unknown,
  version: number,
  publishedAt: unknown,
) {
  await putRecord(
    tx,
    a,
    "site_revision",
    {
      site,
      siteVersion: version,
      publishedAt,
      digest: siteDigest(site),
    },
    { status: "published" },
  );
  await tx.query(
    "DELETE FROM records WHERE kind='site_revision' AND tenant_id=$1 AND id IN (SELECT id FROM records WHERE kind='site_revision' AND tenant_id=$1 ORDER BY (data->>'siteVersion')::bigint DESC,created_at DESC,id DESC OFFSET $2)",
    [a.tenantId, SITE_HISTORY_LIMIT],
  );
}

/** Used only by reviewed privacy erasure; exact typed image references only. */
export function clearBuilderMedia(site: any, urls: Set<string>) {
  if (!site?.builder) return null;
  let changed = false;
  const imageKeys = new Set([
    "image",
    "beforeImage",
    "afterImage",
    "poster",
    "socialImage",
  ]);
  const scrub = (value: any): any => {
    if (Array.isArray(value)) return value.map(scrub);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => {
        if (
          imageKeys.has(key) &&
          typeof child === "string" &&
          urls.has(child)
        ) {
          changed = true;
          return [key, ""];
        }
        return [key, scrub(child)];
      }),
    );
  };
  const builder = scrub(site.builder);
  return changed ? { ...site, builder } : null;
}
