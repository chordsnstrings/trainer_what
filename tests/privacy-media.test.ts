import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { z } from "zod";
import {
  createDatabase,
  putRecord,
  type Actor,
  type Database,
} from "@trainer/db";
import { brandSchema } from "@trainer/contracts";
import { passwordHash } from "../apps/api/src/auth.ts";
import { registerPrivacyLifecycle } from "../apps/api/src/privacy-lifecycle.ts";
import { privacyOperations } from "../apps/api/src/privacy-operations.ts";
import { privacyHooks } from "../apps/api/src/privacy-hooks.ts";
import {
  eraseOwnedBrandMedia,
  registerCoachSite,
  saveCoachBrand,
} from "../apps/api/src/coach-site.ts";

let db: Database, app: ReturnType<typeof Fastify>, hash: string;
const password = "SyntheticMediaPrivacy2026!";
const actors = new Map<string, any>();
const url = (id: string) => "/api/v1/media/" + id;
async function member(tenantId: string, role: string, platformRole = "none") {
  const userId = randomUUID(),
    a = {
      tenantId,
      userId,
      role,
      platformRole,
      mfaAt: new Date().toISOString(),
    };
  await db.system(async (tx) => {
    await tx.query(
      "INSERT INTO users(id,name,email,password_hash,email_verified,platform_role) VALUES($1,'Synthetic',$2,$3,true,$4)",
      [userId, userId + "@example.test", hash, platformRole],
    );
    await tx.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)",
      [tenantId, userId, role],
    );
  });
  actors.set(userId, a);
  return a;
}
async function tenant() {
  const tenantId = randomUUID();
  await db.system((tx) =>
    tx.query(
      "INSERT INTO tenants(id,slug,name,published) VALUES($1,$2,'Synthetic workspace',true)",
      [tenantId, "media-" + tenantId.replaceAll("-", "")],
    ),
  );
  return member(tenantId, "owner");
}
async function media(a: Actor, ownerId = a.userId) {
  const id = randomUUID();
  await db.tenant(a, (tx) =>
    tx.query(
      "INSERT INTO brand_media(id,tenant_id,owner_user_id,digest,media,width,height,filename) VALUES($1::uuid,$2,$3,$1::uuid::text,$4,1,1,'synthetic.jpg')",
      [id, a.tenantId, ownerId, Buffer.from("synthetic image bytes")],
    ),
  );
  return id;
}
async function gallery(
  a: Actor,
  ownerId: string,
  photos: string[],
  version = 1,
) {
  const id = randomUUID();
  await db.tenant(a, async (tx) => {
    await tx.query(
      "INSERT INTO coach_galleries(id,tenant_id,owner_user_id,title,audience,version) VALUES($1,$2,$3,'Synthetic gallery','both',$4)",
      [id, a.tenantId, ownerId, version],
    );
    for (const [position, mediaId] of photos.entries())
      await tx.query(
        "INSERT INTO coach_gallery_photos(tenant_id,gallery_id,media_id,alt,caption,position) VALUES($1,$2,$3,'Synthetic photo','Synthetic caption',$4)",
        [a.tenantId, id, mediaId, position],
      );
  });
  return id;
}
const proof = () => ({
  expectedRevision: 1,
  providerReviewComplete: true,
  thirdPartySourceReviewComplete: true,
  evidenceReference: "Synthetic reviewed provider inventory",
  retentionPolicyVersion: "fixture-v1",
  backupPurgeBy: new Date(Date.now() + 86400000).toISOString(),
  providers: [],
});
function request(a: any, path: string, body?: Record<string, unknown>) {
  return app.inject({
    method: body ? "POST" : "GET",
    url: "/api/v1" + path,
    headers: { "x-fixture-user": a.userId },
    payload: body,
  });
}
async function eraseRequest(a: Actor) {
  return db.tenant(a, (tx) =>
    putRecord(
      tx,
      a,
      "privacy_request",
      { type: "deletion" },
      { status: "pending_review" },
    ),
  );
}
async function erased(admin: any, a: Actor) {
  const r = await eraseRequest(a);
  return request(
    admin,
    `/admin/tenants/${a.tenantId}/privacy/${r.id}/erase`,
    proof(),
  );
}
async function transferred() {
  const former = await tenant(),
    owner = await member(former.tenantId, "staff");
  await db.system(async (tx) => {
    await tx.query(
      "UPDATE memberships SET role='staff' WHERE tenant_id=$1 AND user_id=$2",
      [former.tenantId, former.userId],
    );
    await tx.query(
      "UPDATE memberships SET role='owner' WHERE tenant_id=$1 AND user_id=$2",
      [owner.tenantId, owner.userId],
    );
  });
  former.role = "staff";
  owner.role = "owner";
  return { former, owner };
}
before(async () => {
  hash = await passwordHash(password);
  db = await createDatabase({ memory: true });
  app = Fastify();
  await app.register(cookie);
  const identity = (req: any) => {
    const a = actors.get(req.headers["x-fixture-user"]);
    if (!a) throw Object.assign(new Error("Sign in"), { statusCode: 401 });
    return a;
  };
  app.addHook("onRequest", async (req: any) => {
    req.identity = actors.get(req.headers["x-fixture-user"]);
  });
  app.setErrorHandler((e: any, req: any, reply: any) =>
    reply
      .code(e instanceof z.ZodError ? 400 : (e.statusCode ?? 500))
      .send({ code: e.code, message: e.message }),
  );
  registerCoachSite(app, db);
  registerPrivacyLifecycle(app, db, identity, privacyHooks);
  privacyOperations(app, db, identity, privacyHooks);
  await app.ready();
});
after(async () => {
  await app.close();
  await db.close();
});

test("former-owner erasure removes their photos and exact design references while preserving other media, drafts and workspaces", async () => {
  const { former, owner } = await transferred(),
    foreign = await tenant(),
    admin = await member(foreign.tenantId, "staff", "admin");
  await db.system((tx) =>
    tx.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'staff')",
      [foreign.tenantId, former.userId],
    ),
  );
  const removed1 = await media(owner, former.userId),
    removed2 = await media(owner, former.userId),
    keep1 = await media(owner),
    keep2 = await media(owner),
    foreignPhoto = await media(foreign, former.userId);
  const removedGallery = await gallery(owner, former.userId, [removed1, keep1]),
    changedGallery = await gallery(
      owner,
      owner.userId,
      [keep1, removed2, keep2],
      6,
    ),
    untouchedGallery = await gallery(owner, owner.userId, [keep2], 3),
    foreignGallery = await gallery(foreign, former.userId, [foreignPhoto]);
  const theme = {
      brandVersion: 7,
      category: "Strength",
      design: {
        logoUrl: url(removed1),
        photoUrl: url(removed2),
        coverUrl: url(keep1),
        coachBio: "Reference in ordinary copy: " + url(removed1),
      },
    },
    draft = {
      name: "Ongoing workspace",
      design: {
        logoUrl: url(keep2),
        photoUrl: url(removed1),
        coverUrl: "https://images.example.com/safe.jpg",
      },
    };
  await db.system((tx) =>
    tx.query("UPDATE tenants SET theme=$2 WHERE id=$1", [
      owner.tenantId,
      JSON.stringify(theme),
    ]),
  );
  await db.tenant(owner, async (tx) => {
    await tx.query(
      "INSERT INTO coach_design_drafts(tenant_id,data,version) VALUES($1,$2,4)",
      [owner.tenantId, JSON.stringify(draft)],
    );
    await tx.query(
      'INSERT INTO coach_sites(tenant_id,draft,published,version) VALUES($1,\'{"headline":"Private website draft"}\',\'{"headline":"Published website"}\',9)',
      [owner.tenantId],
    );
  });
  const response = await erased(admin, former);
  assert.equal(response.statusCode, 200, response.body);
  await db.tenant(owner, async (tx) => {
    assert.deepEqual(
      (await tx.query("SELECT id FROM brand_media ORDER BY id")).map(
        (r) => r.id,
      ),
      [keep1, keep2].sort(),
    );
    assert.equal(
      (
        await tx.query("SELECT id FROM coach_galleries WHERE id=$1", [
          removedGallery,
        ])
      ).length,
      0,
    );
    assert.equal(
      (
        await tx.query("SELECT version FROM coach_galleries WHERE id=$1", [
          changedGallery,
        ])
      )[0].version,
      7,
    );
    assert.equal(
      (
        await tx.query("SELECT version FROM coach_galleries WHERE id=$1", [
          untouchedGallery,
        ])
      )[0].version,
      3,
    );
    assert.deepEqual(
      (
        await tx.query(
          "SELECT media_id,position FROM coach_gallery_photos WHERE gallery_id=$1 ORDER BY position",
          [changedGallery],
        )
      ).map((r) => [r.media_id, r.position]),
      [
        [keep1, 0],
        [keep2, 1],
      ],
    );
    const [d] = await tx.query("SELECT data,version FROM coach_design_drafts");
    assert.equal(d.version, 5);
    assert.equal(d.data.design.photoUrl, "");
    assert.equal(d.data.design.logoUrl, url(keep2));
    assert.equal(d.data.design.coverUrl, draft.design.coverUrl);
    const [site] = await tx.query(
      "SELECT draft,published,version FROM coach_sites",
    );
    assert.equal(site.version, 9);
    assert.equal(site.draft.headline, "Private website draft");
    assert.equal(site.published.headline, "Published website");
  });
  const [current] = await db.system((tx) =>
    tx.query(
      "SELECT theme,lifecycle_state,published FROM tenants WHERE id=$1",
      [owner.tenantId],
    ),
  );
  assert.equal(current.theme.brandVersion, 8);
  assert.equal(current.theme.design.logoUrl, "");
  assert.equal(current.theme.design.photoUrl, "");
  assert.equal(current.theme.design.coverUrl, url(keep1));
  assert.equal(current.theme.design.coachBio, theme.design.coachBio);
  assert.equal(current.lifecycle_state, "active");
  assert.equal(current.published, true);
  await db.tenant(foreign, async (tx) => {
    assert.equal(
      (await tx.query("SELECT id FROM brand_media WHERE id=$1", [foreignPhoto]))
        .length,
      1,
    );
    assert.equal(
      (
        await tx.query("SELECT id FROM coach_galleries WHERE id=$1", [
          foreignGallery,
        ])
      ).length,
      1,
    );
  });
  const brand = brandSchema.parse({
    name: "Ongoing workspace",
    bio: "Synthetic biography",
    category: "Strength",
    accent: "#244c46",
    headline: "Synthetic",
    timezone: "Asia/Dubai",
    expectedVersion: 7,
    design: { logoUrl: url(keep1) },
  });
  await assert.rejects(
    () => saveCoachBrand(db, owner, brand),
    (e: any) => e.code === "BRAND_VERSION_CONFLICT",
  );
  await assert.rejects(
    () =>
      saveCoachBrand(db, owner, {
        ...brand,
        expectedVersion: 8,
        design: { ...brand.design!, photoUrl: url(removed1) },
      }),
    (e: any) => e.code === "MEDIA_UNAVAILABLE",
  );
  assert.equal((await request(owner, "/media/" + removed1)).statusCode, 404);
});

test("media cleanup is scoped to a privacy owner transaction and current owners remain protected", async () => {
  const owner = await tenant(),
    staff = await member(owner.tenantId, "staff"),
    sub = await member(owner.tenantId, "subscriber"),
    admin = await member(owner.tenantId, "staff", "admin"),
    image = await media(owner);
  for (const actor of [staff, sub])
    await assert.rejects(
      () => db.tenant(actor, (tx) => eraseOwnedBrandMedia(tx, owner.userId)),
      (e: any) => e.code === "PRIVACY_SCOPE_REQUIRED",
    );
  await assert.rejects(
    () => db.system((tx) => eraseOwnedBrandMedia(tx, owner.userId)),
    (e: any) => e.code === "PRIVACY_SCOPE_REQUIRED",
  );
  const response = await erased(admin, owner);
  assert.equal(response.statusCode, 409, response.body);
  assert.equal(response.json().code, "WORKSPACE_CLOSURE_REQUIRED");
  assert.equal(
    (
      await db.tenant(owner, (tx) =>
        tx.query("SELECT id FROM brand_media WHERE id=$1", [image]),
      )
    ).length,
    1,
  );
});

test("concurrent design save cannot restore an erased former-owner photo", async () => {
  const { former, owner } = await transferred(),
    admin = await member(owner.tenantId, "staff", "admin"),
    image = await media(owner, former.userId);
  await db.system((tx) =>
    tx.query("UPDATE tenants SET theme=$2 WHERE id=$1", [
      owner.tenantId,
      JSON.stringify({ brandVersion: 1, design: { photoUrl: url(image) } }),
    ]),
  );
  const r = await eraseRequest(former),
    update = brandSchema.parse({
      name: "Ongoing coach",
      bio: "Synthetic bio",
      category: "Strength",
      accent: "#244c46",
      headline: "Synthetic",
      timezone: "Asia/Dubai",
      expectedVersion: 1,
      design: { photoUrl: url(image) },
    });
  const [erasure, save] = await Promise.allSettled([
    request(
      admin,
      `/admin/tenants/${owner.tenantId}/privacy/${r.id}/erase`,
      proof(),
    ),
    saveCoachBrand(db, owner, update),
  ]);
  assert.equal(erasure.status, "fulfilled");
  if (erasure.status === "fulfilled")
    assert.equal(erasure.value.statusCode, 200, erasure.value.body);
  if (save.status === "rejected")
    assert.ok(
      ["BRAND_VERSION_CONFLICT", "MEDIA_UNAVAILABLE"].includes(
        save.reason.code,
      ),
    );
  assert.equal(
    (
      await db.tenant(owner, (tx) =>
        tx.query("SELECT id FROM brand_media WHERE id=$1", [image]),
      )
    ).length,
    0,
  );
  const [current] = await db.system((tx) =>
    tx.query("SELECT theme FROM tenants WHERE id=$1", [owner.tenantId]),
  );
  assert.equal(current.theme.design.photoUrl, "");
});

test("whole-workspace closure still removes every workspace gallery and media row without touching another workspace", async () => {
  const owner = await tenant(),
    staff = await member(owner.tenantId, "staff"),
    foreign = await tenant(),
    admin = await member(foreign.tenantId, "staff", "admin");
  const one = await media(owner),
    two = await media(owner, staff.userId),
    foreignPhoto = await media(foreign);
  await gallery(owner, owner.userId, [one, two]);
  await gallery(owner, staff.userId, [two]);
  await gallery(foreign, foreign.userId, [foreignPhoto]);
  await db.tenant(owner, async (tx) => {
    await tx.query(
      "INSERT INTO coach_design_drafts(tenant_id,data) VALUES($1,$2)",
      [owner.tenantId, JSON.stringify({ design: { photoUrl: url(one) } })],
    );
    await tx.query(
      "INSERT INTO coach_sites(tenant_id,draft,published) VALUES($1,'{}','{}')",
      [owner.tenantId],
    );
  });
  const opened = await request(owner, "/tenant/lifecycle/closure", {
    password,
    reason: "Close the synthetic workspace after review",
    confirmClosure: true,
  });
  assert.equal(opened.statusCode, 200, opened.body);
  const response = await request(
    admin,
    `/admin/tenants/${owner.tenantId}/privacy/lifecycle/${opened.json().id}/close`,
    { ...proof(), expectedRevision: opened.json().revision },
  );
  assert.equal(response.statusCode, 200, response.body);
  await db.tenant(owner, async (tx) => {
    for (const table of [
      "brand_media",
      "coach_galleries",
      "coach_gallery_photos",
      "coach_design_drafts",
      "coach_sites",
    ])
      assert.equal(
        (await tx.query(`SELECT count(*)::int n FROM ${table}`))[0].n,
        0,
        table,
      );
  });
  assert.equal(
    (
      await db.tenant(foreign, (tx) =>
        tx.query("SELECT id FROM brand_media WHERE id=$1", [foreignPhoto]),
      )
    ).length,
    1,
  );
});
