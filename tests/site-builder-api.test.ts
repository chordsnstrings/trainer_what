import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import sharp from "sharp";
import { z } from "zod";
import { createDatabase, putRecord, type Database } from "@trainer/db";
import {
  createBuilderElement,
  createModule,
  siteBuilderSchema,
  type SiteBuilderDocument,
} from "@trainer/contracts";
import {
  eraseOwnedBrandMedia,
  registerCoachSite,
} from "../apps/api/src/coach-site.ts";

let db: Database, app: ReturnType<typeof Fastify>;
const actors = new Map<string, any>(),
  hosts = new Map<string, any>();
async function person(tenantId: string, role: string) {
  const userId = randomUUID(),
    a = { tenantId, userId, role };
  await db.system(async (tx) => {
    await tx.query(
      "INSERT INTO users(id,name,email,password_hash)VALUES($1,'Builder fixture',$2,'synthetic')",
      [userId, userId + "@example.test"],
    );
    await tx.query(
      "INSERT INTO memberships(tenant_id,user_id,role)VALUES($1,$2,$3)",
      [tenantId, userId, role],
    );
  });
  actors.set(userId, a);
  return a;
}
async function tenant(published = true) {
  const tenantId = randomUUID(),
    slug = "builder-" + tenantId.replaceAll("-", "");
  await db.system((tx) =>
    tx.query(
      "INSERT INTO tenants(id,slug,name,published)VALUES($1,$2,'Builder fixture',$3)",
      [tenantId, slug, published],
    ),
  );
  return { ...(await person(tenantId, "owner")), slug };
}
function request(
  a: any,
  path: string,
  method: any = "GET",
  payload?: unknown,
  host?: string,
) {
  return app.inject({
    url: "/api/v1" + path,
    method,
    payload,
    headers: {
      ...(a ? { "x-test-user": a.userId } : {}),
      ...(host ? { "x-test-host": host } : {}),
    },
  });
}
async function ok(
  a: any,
  path: string,
  method: any = "GET",
  payload?: unknown,
) {
  const response = await request(a, path, method, payload);
  assert.equal(response.statusCode, 200, response.body);
  return response.json();
}
function builder(
  title = "Coaching with a clear direction",
): SiteBuilderDocument {
  const hero = createModule("hero");
  hero.content.title = title;
  return siteBuilderSchema.parse({
    version: 1,
    theme: {},
    header: {},
    footer: {},
    pages: [{ id: "home", slug: "", title: "Home", sections: [hero] }],
  });
}
async function save(
  a: any,
  document: SiteBuilderDocument,
  version = 0,
  legacy: any = {},
) {
  return ok(a, "/tenant/site", "PUT", {
    version,
    site: { ...legacy, builder: document },
  });
}
async function publish(a: any, version: number) {
  return ok(a, "/tenant/site/publish", "POST", { version });
}
async function upload(a: any, color = "#ff0000") {
  const data = await sharp({
    create: { width: 16, height: 16, channels: 3, background: color },
  })
    .png()
    .toBuffer();
  return ok(a, "/tenant/media", "POST", {
    filename: "fixture.png",
    rightsConfirmed: true,
    data: data.toString("base64"),
  });
}

before(async () => {
  db = await createDatabase({ memory: true });
  app = Fastify();
  app.addHook("onRequest", async (req: any) => {
    req.identity = actors.get(req.headers["x-test-user"]);
    req.hostContext = hosts.get(req.headers["x-test-host"]);
  });
  app.setErrorHandler((error: any, req: any, reply: any) => {
    reply
      .code(error instanceof z.ZodError ? 400 : (error.statusCode ?? 500))
      .send({ code: error.code, message: error.message });
  });
  registerCoachSite(app, db);
  await app.ready();
});
after(async () => {
  await app.close();
  await db.close();
});

test("legacy sites remain unchanged until an explicit builder draft is published", async () => {
  const a = await tenant();
  const legacy = await ok(a, "/tenant/site", "PUT", {
    version: 0,
    site: {
      headline: "Existing live headline",
      about: "Existing biography",
      pages: [{ slug: "method", title: "My method", body: "Original detail" }],
    },
  });
  const first = await publish(a, legacy.version);
  const before = await ok(null, "/public/sites/" + a.slug);
  assert.equal(before.site.builder, undefined);
  assert.equal(before.site.pages[0].body, "Original detail");
  const draft = await save(a, builder(), first.version, first.draft);
  const during = await ok(null, "/public/sites/" + a.slug);
  assert.equal(during.site.builder, undefined);
  assert.equal(during.publishedRevision, before.publishedRevision);
  await publish(a, draft.version);
  const after = await ok(null, "/public/sites/" + a.slug);
  assert.ok(after.site.builder);
  assert.equal(after.site.about, "");
  assert.equal(after.site.pages.length, 0);
  const retained = await ok(a, "/tenant/site");
  assert.equal(retained.draft.about, "Existing biography");
  assert.equal(retained.draft.pages[0].body, "Original detail");
  assert.notEqual(after.publishedRevision, before.publishedRevision);
});

test("selected galleries beyond the first 24 resolve in public and owner previews without exposing hidden or private bindings", async () => {
  const a = await tenant(),
    document = builder(),
    media = await upload(a);
  let selected = await ok(a, "/tenant/galleries", "POST", {
    title: "Older selected gallery",
  });
  selected = await ok(a, "/tenant/galleries/" + selected.id, "PATCH", {
    version: selected.version,
    title: selected.title,
    description: "Selected from an older gallery page",
    audience: "site",
  });
  selected = await ok(
    a,
    "/tenant/galleries/" + selected.id + "/photos",
    "PUT",
    {
      version: selected.version,
      photos: [{ mediaId: media.id, alt: "Older selected photo" }],
    },
  );
  const privateGallery = await ok(a, "/tenant/galleries", "POST", {
    title: "PRIVATE HIDDEN GALLERY",
  });
  for (let i = 0; i < 24; i++) {
    const newer = await ok(a, "/tenant/galleries", "POST", {
      title: "Newer gallery " + i,
    });
    await ok(a, "/tenant/galleries/" + newer.id, "PATCH", {
      version: newer.version,
      title: newer.title,
      description: "",
      audience: "site",
    });
  }
  const visibleSection = createModule("gallery");
  visibleSection.content.galleryId = selected.id;
  document.pages[0].sections.push(visibleSection);
  const hiddenSection = createModule("gallery");
  hiddenSection.content.galleryId = privateGallery.id;
  document.pages.push({
    ...structuredClone(document.pages[0]),
    id: "private-gallery-page",
    slug: "private-gallery",
    title: "Private page",
    visible: false,
    inNavigation: false,
    sections: [hiddenSection],
  });
  const draft = await save(a, document);
  const preview = await ok(a, "/tenant/site/preview");
  assert.equal(preview.galleries.length, 24);
  assert.ok(
    !preview.galleries.some((gallery: any) => gallery.id === selected.id),
  );
  assert.deepEqual(
    preview.boundGalleries.map((gallery: any) => gallery.id).sort(),
    [selected.id, privateGallery.id].sort(),
  );
  await publish(a, draft.version);
  const published = await ok(null, "/public/sites/" + a.slug);
  assert.equal(
    published.galleries.length,
    24,
    "bound selections must not change pagination offsets",
  );
  assert.deepEqual(
    published.boundGalleries.map((gallery: any) => gallery.id),
    [selected.id],
  );
  assert.equal(published.boundGalleries[0].photos[0].url, media.url);
  assert.doesNotMatch(
    JSON.stringify(published),
    /PRIVATE HIDDEN GALLERY|private-gallery-page/,
  );
  await ok(a, "/tenant/galleries/" + selected.id, "PATCH", {
    version: selected.version,
    title: selected.title,
    description: "",
    audience: "app",
  });
  const revoked = await ok(null, "/public/sites/" + a.slug);
  assert.deepEqual(
    revoked.boundGalleries,
    [],
    "changing the selected gallery audience immediately revokes public access",
  );
  const b = await tenant(),
    other = await ok(b, "/tenant/galleries", "POST", {
      title: "Foreign gallery",
    });
  await ok(b, "/tenant/galleries/" + other.id, "PATCH", {
    version: other.version,
    title: other.title,
    description: "",
    audience: "site",
  });
  // A persisted reference is never sufficient to cross a tenant boundary,
  // even if data written outside the normal save route contains a foreign id.
  document.pages[0].sections[1].content.galleryId = other.id;
  await db.tenant(a, (tx) =>
    tx.query("UPDATE coach_sites SET published=$2 WHERE tenant_id=$1", [
      a.tenantId,
      JSON.stringify({ builder: document }),
    ]),
  );
  assert.deepEqual(
    (await ok(null, "/public/sites/" + a.slug)).boundGalleries,
    [],
  );
});

test("public builder projection excludes hidden pages, sections, elements and saved modules; only visible media becomes public", async () => {
  const a = await tenant(),
    document = builder(),
    visible = await upload(a),
    hidden = await upload(a, "#0000ff"),
    saved = await upload(a, "#00ff00"),
    nested = await upload(a, "#ffff00");
  const allHidden = {
    desktop: { hidden: true },
    tablet: { hidden: true },
    mobile: { hidden: true },
  };
  document.pages[0].sections[0].content.image = visible.url;
  const secretSection = createModule("text");
  secretSection.content.title = "PRIVATE SECTION COPY";
  secretSection.content.image = hidden.url;
  secretSection.responsive = allHidden;
  const columns = createModule("columns");
  columns.content.elements.push(
    createBuilderElement("image", {
      image: nested.url,
      imageAlt: "PRIVATE ELEMENT COPY",
      responsive: allHidden,
    }),
  );
  document.pages[0].sections.push(secretSection, columns);
  document.pages.push({
    ...structuredClone(document.pages[0]),
    id: "secret",
    slug: "private-notes",
    title: "PRIVATE PAGE COPY",
    visible: false,
    inNavigation: false,
    sections: [createModule("text")],
  });
  document.pages[1].sections[0].content.image = hidden.url;
  const savedSection = createModule("image");
  savedSection.content.image = saved.url;
  document.savedSections.push({
    id: "saved",
    name: "PRIVATE SAVED COPY",
    section: savedSection,
  });
  const draft = await save(a, document);
  for (const media of [visible, hidden, saved, nested])
    assert.equal((await request(null, "/media/" + media.id)).statusCode, 404);
  await publish(a, draft.version);
  const site = await ok(null, "/public/sites/" + a.slug);
  assert.doesNotMatch(JSON.stringify(site), /PRIVATE|private-notes/);
  assert.equal(site.site.builder.pages.length, 1);
  assert.equal(site.site.builder.savedSections.length, 0);
  assert.equal((await request(null, "/media/" + visible.id)).statusCode, 200);
  for (const media of [hidden, saved, nested])
    assert.equal((await request(null, "/media/" + media.id)).statusCode, 404);
  const subscriber = await person(a.tenantId, "subscriber");
  assert.equal(
    (await request(subscriber, "/media/" + hidden.id)).statusCode,
    404,
  );
  assert.equal(
    (await request(subscriber, "/media/" + visible.id)).statusCode,
    200,
  );
});

test("media ownership, custom-host isolation, reference deletion and public revocation stay tenant scoped", async () => {
  const a = await tenant(),
    b = await tenant(),
    media = await upload(a),
    foreign = await upload(b);
  const document = builder();
  document.pages[0].sections[0].content.image = foreign.url;
  assert.equal(
    (
      await request(a, "/tenant/site", "PUT", {
        version: 0,
        site: { builder: document },
      })
    ).statusCode,
    400,
  );
  document.pages[0].sections[0].content.image = media.url;
  const draft = await save(a, document);
  assert.equal(
    (await request(a, "/tenant/media/" + media.id, "DELETE")).statusCode,
    409,
  );
  const first = await publish(a, draft.version);
  hosts.set("foreign-host", {
    custom: true,
    tenantId: b.tenantId,
    tenantSlug: b.slug,
  });
  assert.equal(
    (
      await request(
        null,
        "/media/" + media.id,
        "GET",
        undefined,
        "foreign-host",
      )
    ).statusCode,
    404,
  );
  document.pages[0].sections[0].content.image = "";
  const changed = await save(a, document, first.version);
  assert.equal((await request(null, "/media/" + media.id)).statusCode, 200);
  await publish(a, changed.version);
  assert.equal((await request(null, "/media/" + media.id)).statusCode, 404);
  assert.equal(
    (await request(a, "/tenant/media/" + media.id, "DELETE")).statusCode,
    409,
    "publication history retains the bytes for restoration",
  );
  await db.system((tx) =>
    tx.query("UPDATE tenants SET published=false WHERE id=$1", [a.tenantId]),
  );
  assert.equal(
    (await request(null, "/public/sites/" + a.slug)).statusCode,
    404,
  );
});

test("concurrent saves, stale publishes and restores use one revision, and restore changes only the private draft", async () => {
  const a = await tenant(),
    b = await tenant();
  const saved = await save(a, builder("First publication"));
  const first = await publish(a, saved.version);
  const history = await ok(a, "/tenant/site/history"),
    revisionId = history.items[0].id;
  const updates = await Promise.all([
    request(a, "/tenant/site", "PUT", {
      version: first.version,
      site: { builder: builder("Second publication") },
    }),
    request(a, "/tenant/site", "PUT", {
      version: first.version,
      site: { builder: builder("Second publication") },
    }),
  ]);
  assert.deepEqual(
    updates.map((response) => response.statusCode).sort(),
    [200, 409],
  );
  const secondDraft = updates
    .find((response) => response.statusCode === 200)!
    .json();
  assert.equal(
    (
      await request(a, "/tenant/site/publish", "POST", {
        version: first.version,
      })
    ).statusCode,
    409,
  );
  const second = await publish(a, secondDraft.version);
  assert.equal(
    (
      await request(b, "/tenant/site/restore", "POST", {
        version: 0,
        revisionId,
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await request(a, "/tenant/site/restore", "POST", {
        version: first.version,
        revisionId,
      })
    ).statusCode,
    409,
  );
  const live = await ok(null, "/public/sites/" + a.slug);
  const restored = await ok(a, "/tenant/site/restore", "POST", {
    version: second.version,
    revisionId,
  });
  assert.equal(
    restored.draft.builder.pages[0].sections[0].content.title,
    "First publication",
  );
  assert.equal(
    restored.published.builder.pages[0].sections[0].content.title,
    "Second publication",
  );
  assert.equal(
    (await ok(null, "/public/sites/" + a.slug)).publishedRevision,
    live.publishedRevision,
  );
  await publish(a, restored.version);
  assert.equal(
    (await ok(null, "/public/sites/" + a.slug)).site.builder.pages[0]
      .sections[0].content.title,
    "First publication",
  );
});

test("history is bounded, immutable and inaccessible to staff, subscribers, finance or other tenants", async () => {
  const a = await tenant(),
    b = await tenant();
  let version = 0;
  for (let i = 0; i < 22; i++) {
    const draft = await save(a, builder("Publication " + i), version);
    version = (await publish(a, draft.version)).version;
  }
  const history = await ok(a, "/tenant/site/history");
  assert.equal(history.limit, 20);
  assert.equal(history.items.length, 20);
  assert.equal(history.items[0].headline, "Publication 21");
  assert.equal(history.items.at(-1).headline, "Publication 2");
  const revisionId = history.items[0].id;
  for (const role of ["staff", "subscriber", "finance"]) {
    const actor = await person(a.tenantId, role);
    assert.equal(
      (await request(actor, "/tenant/site/history")).statusCode,
      403,
    );
    assert.equal(
      (await request(actor, "/tenant/site/preview")).statusCode,
      403,
    );
    const rows = await db.tenant(actor, (tx) =>
      tx.query("SELECT id FROM records WHERE kind='site_revision'"),
    );
    assert.equal(rows.length, 0, role + " must not read snapshots directly");
  }
  assert.equal((await request(null, "/tenant/site/history")).statusCode, 401);
  assert.equal((await ok(b, "/tenant/site/history")).items.length, 0);
  assert.equal(
    (
      await db.tenant(b, (tx) =>
        tx.query("SELECT id FROM records WHERE id=$1", [revisionId]),
      )
    ).length,
    0,
  );
  await assert.rejects(
    db.tenant(a, (tx) =>
      tx.query("UPDATE records SET data='{}' WHERE id=$1", [revisionId]),
    ),
    /cannot be edited/,
  );
});

test("restoring a trusted snapshot recovers copy after a gallery is deleted, while republishing requires repair", async () => {
  const a = await tenant(),
    document = builder("Keep this coaching story");
  const gallery = await ok(a, "/tenant/galleries", "POST", {
    title: "Original gallery",
  });
  const visibleGallery = await ok(
    a,
    "/tenant/galleries/" + gallery.id,
    "PATCH",
    {
      version: gallery.version,
      title: gallery.title,
      description: "",
      audience: "site",
    },
  );
  const gallerySection = createModule("gallery");
  gallerySection.content.galleryId = gallery.id;
  document.pages[0].sections.push(gallerySection);
  const saved = await save(a, document),
    first = await publish(a, saved.version);
  const history = await ok(a, "/tenant/site/history");
  const replacement = await save(a, builder("New live copy"), first.version);
  const current = await publish(a, replacement.version);
  await ok(a, "/tenant/galleries/" + gallery.id, "DELETE", {
    version: visibleGallery.version,
  });
  const restored = await ok(a, "/tenant/site/restore", "POST", {
    version: current.version,
    revisionId: history.items[0].id,
  });
  assert.equal(
    restored.draft.builder.pages[0].sections[0].content.title,
    "Keep this coaching story",
  );
  assert.equal(
    restored.published.builder.pages[0].sections[0].content.title,
    "New live copy",
  );
  const blocked = await request(a, "/tenant/site/publish", "POST", {
    version: restored.version,
  });
  assert.equal(blocked.statusCode, 400);
  assert.equal(blocked.json().code, "SITE_GALLERY_UNAVAILABLE");
  delete restored.draft.builder.pages[0].sections[1].content.galleryId;
  const repaired = await save(a, restored.draft.builder, restored.version);
  await publish(a, repaired.version);
  assert.equal(
    (await ok(null, "/public/sites/" + a.slug)).site.builder.pages[0]
      .sections[0].content.title,
    "Keep this coaching story",
  );
});

test("publications reject draft offers, private galleries, invisible targets and unsafe content while preserving editable drafts", async () => {
  const a = await tenant(),
    b = await tenant(),
    document = builder();
  const product = await db.tenant(a, (tx) =>
    putRecord(tx, a, "product", { name: "Draft offer" }),
  );
  document.pages[0].sections[0].content.productIds = [product.id];
  let draft = await save(a, document);
  let response = await request(a, "/tenant/site/publish", "POST", {
    version: draft.version,
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().code, "SITE_PRODUCT_UNAVAILABLE");
  await db.tenant(a, (tx) =>
    tx.query("UPDATE records SET status='published' WHERE id=$1", [product.id]),
  );
  const ownGallery = await ok(a, "/tenant/galleries", "POST", {
    title: "Private gallery",
  });
  document.pages[0].sections[0].content.galleryId = ownGallery.id;
  draft = await save(a, document, draft.version);
  response = await request(a, "/tenant/site/publish", "POST", {
    version: draft.version,
  });
  assert.equal(response.json().code, "SITE_GALLERY_UNAVAILABLE");
  await ok(a, "/tenant/galleries/" + ownGallery.id, "PATCH", {
    version: ownGallery.version,
    title: "Visible gallery",
    description: "",
    audience: "site",
  });
  await publish(a, draft.version);
  const foreignProduct = await db.tenant(b, (tx) =>
    putRecord(tx, b, "product", { name: "Other offer" }),
  );
  document.pages[0].sections[0].content.productIds = [foreignProduct.id];
  assert.equal(
    (
      await request(a, "/tenant/site", "PUT", {
        version: draft.version + 1,
        site: { builder: document },
      })
    ).statusCode,
    400,
  );
  const unsafe = builder();
  unsafe.pages[0].sections[0].content.actions = [
    {
      kind: "url",
      label: "Unsafe",
      href: "javascript:alert(1)",
      newTab: false,
    },
  ];
  assert.equal(
    (
      await request(a, "/tenant/site", "PUT", {
        version: draft.version + 1,
        site: { builder: unsafe },
      })
    ).statusCode,
    400,
  );
  const badVideo = builder();
  badVideo.pages[0].sections[0].content.videoUrl =
    "https://malicious.example/iframe";
  assert.equal(
    (
      await request(a, "/tenant/site", "PUT", {
        version: draft.version + 1,
        site: { builder: badVideo },
      })
    ).statusCode,
    400,
  );
  const hidden = builder();
  hidden.pages.push({
    ...structuredClone(hidden.pages[0]),
    id: "hidden",
    slug: "hidden",
    visible: false,
    inNavigation: false,
    sections: [createModule("text")],
  });
  hidden.pages[0].sections[0].content.actions = [
    { label: "Hidden page", kind: "page", pageId: "hidden", newTab: false },
  ];
  const hiddenDraft = await save(a, hidden, draft.version + 1);
  assert.equal(
    (
      await request(a, "/tenant/site/publish", "POST", {
        version: hiddenDraft.version,
      })
    ).statusCode,
    400,
  );
  const claim = builder();
  claim.pages[0].sections.push(createModule("columns"));
  claim.pages[0].sections[1].content.elements[0].children[0].text =
    "I cure diabetes with guaranteed results";
  const claimDraft = await save(a, claim, hiddenDraft.version);
  const deniedClaim = await request(a, "/tenant/site/publish", "POST", {
    version: claimDraft.version,
  });
  assert.equal(deniedClaim.statusCode, 400);
  assert.equal(deniedClaim.json().code, "SITE_COPY_REVIEW");
});

test("reviewed media erasure clears current drafts and publications and removes snapshots that could restore erased photos", async () => {
  const a = await tenant(),
    replacementOwner = await person(a.tenantId, "owner"),
    media = await upload(a),
    document = builder();
  document.pages[0].sections[0].content.image = media.url;
  const first = await save(a, document);
  const published = await publish(a, first.version);
  assert.equal(
    (await ok(replacementOwner, "/tenant/site/history")).items.length,
    1,
  );
  await db.tenant(
    replacementOwner,
    (tx) => eraseOwnedBrandMedia(tx, a.userId),
    { privacyErasure: true },
  );
  const current = await ok(replacementOwner, "/tenant/site");
  assert.equal(current.version, published.version + 1);
  assert.equal(current.draft.builder.pages[0].sections[0].content.image, "");
  assert.equal(
    current.published.builder.pages[0].sections[0].content.image,
    "",
  );
  assert.equal(
    (await ok(replacementOwner, "/tenant/site/history")).items.length,
    0,
  );
  assert.equal((await request(null, "/media/" + media.id)).statusCode, 404);
});
