import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import sharp from "sharp";
import { z } from "zod";
import { createDatabase, type Database } from "@trainer/db";
import {
  registerCoachSite,
  publicCoachSite,
} from "../apps/api/src/coach-site.ts";
let db: Database, app: ReturnType<typeof Fastify>, red: Buffer, blue: Buffer;
const actors = new Map<string, any>(),
  hosts = new Map<string, any>();
async function person(tenantId: string, role: string) {
  const userId = randomUUID(),
    a = {
      tenantId,
      userId,
      role,
      name: "Synthetic coach",
      email: userId + "@example.test",
      platformRole: "none",
      emailVerified: true,
    };
  await db.system(async (tx) => {
    await tx.query(
      "INSERT INTO users(id,name,email,password_hash)VALUES($1,$2,$3,'synthetic')",
      [userId, a.name, a.email],
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
    slug = "coach-" + tenantId;
  await db.system((tx) =>
    tx.query(
      "INSERT INTO tenants(id,slug,name,published)VALUES($1,$2,'Synthetic Coach',$3)",
      [tenantId, slug, published],
    ),
  );
  return { ...(await person(tenantId, "owner")), slug };
}
function req(
  a: any,
  path: string,
  method: any = "GET",
  payload?: unknown,
  host?: string,
) {
  return app.inject({
    url: "/api/v1" + path,
    method,
    headers: {
      ...(a ? { "x-test-user": a.userId } : {}),
      ...(host ? { "x-test-host": host } : {}),
    },
    payload,
  });
}
async function ok(
  a: any,
  path: string,
  method: any = "GET",
  payload?: unknown,
) {
  const r = await req(a, path, method, payload);
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}
async function upload(a: any, buffer = red) {
  return ok(a, "/tenant/media", "POST", {
    filename: "synthetic.jpg",
    rightsConfirmed: true,
    data: buffer.toString("base64"),
  });
}
async function gallery(
  a: any,
  title = "Synthetic gallery",
  audience = "draft",
  media: any[] = [],
) {
  let g = await ok(a, "/tenant/galleries", "POST", { title });
  if (media.length)
    g = await ok(a, `/tenant/galleries/${g.id}/photos`, "PUT", {
      version: g.version,
      photos: media.map((m, i) => ({
        mediaId: m.id,
        alt: "Synthetic photograph " + i,
        caption: "Synthetic caption " + i,
      })),
    });
  return ok(a, `/tenant/galleries/${g.id}`, "PATCH", {
    version: g.version,
    title,
    description: "Synthetic gallery description",
    audience,
  });
}
const brand = (logoUrl = "") => ({
  name: "Synthetic Coach",
  bio: "Synthetic bio",
  category: "Strength",
  accent: "#244c46",
  headline: "Train thoughtfully",
  timezone: "Asia/Dubai",
  design: { logoUrl },
});
before(async () => {
  db = await createDatabase({ memory: true });
  red = await sharp({
    create: { width: 80, height: 60, channels: 3, background: "#f04e45" },
  })
    .withExif({
      IFD0: { Copyright: "PRIVATE TEST METADATA", Artist: "Synthetic" },
    })
    .jpeg()
    .toBuffer();
  blue = await sharp({
    create: { width: 120, height: 80, channels: 3, background: "#347abb" },
  })
    .png()
    .toBuffer();
  app = Fastify();
  app.addHook("onRequest", async (req: any) => {
    req.identity = actors.get(req.headers["x-test-user"]);
    req.hostContext = hosts.get(req.headers["x-test-host"]);
  });
  app.setErrorHandler((error: Error, r: any, reply: any) => {
    const e = error as any;
    reply
      .code(
        error instanceof z.ZodError
          ? 400
          : e.code === "23505"
            ? 409
            : (e.statusCode ?? 500),
      )
      .send({ code: e.code, message: e.message });
  });
  registerCoachSite(app, db);
  await app.ready();
});
after(async () => {
  await app.close();
  await db.close();
});

test("uploads decode real JPEGs, strip metadata, crop safely and deduplicate within one workspace", async () => {
  const a = await tenant(),
    b = await tenant(),
    m = await upload(a);
  assert.equal(m.width, 80);
  assert.equal(m.height, 60);
  const stored = await req(a, "/media/" + m.id);
  assert.equal(stored.statusCode, 200, stored.body);
  assert.match(stored.headers["content-type"] as string, /image\/jpeg/);
  const metadata = await sharp(stored.rawPayload).metadata();
  assert.equal(metadata.format, "jpeg");
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.icc, undefined);
  assert.doesNotMatch(
    stored.rawPayload.toString("latin1"),
    /PRIVATE TEST METADATA/,
  );
  assert.equal((await upload(a)).id, m.id);
  assert.notEqual((await upload(b)).id, m.id);
  const cropped = await ok(a, "/tenant/media", "POST", {
    filename: "crop.png",
    rightsConfirmed: true,
    data: blue.toString("base64"),
    crop: { left: 10, top: 5, width: 30, height: 20 },
  });
  assert.equal(cropped.width, 30);
  assert.equal(cropped.height, 20);
});

test("invalid vectors, noncanonical base64, over-limit files, false rights and impossible crops are rejected", async () => {
  const a = await tenant(),
    base = { filename: "image.jpg", rightsConfirmed: true };
  for (const data of [
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    ).toString("base64"),
    "invalid!?",
    "AAAA=",
  ])
    assert.equal(
      (await req(a, "/tenant/media", "POST", { ...base, data })).statusCode,
      400,
    );
  const tooLarge = Buffer.alloc(8 * 1024 * 1024 + 1).toString("base64");
  const size = await req(a, "/tenant/media", "POST", {
    ...base,
    data: tooLarge,
  });
  assert.equal(size.statusCode, 400, size.body);
  assert.equal(size.json().code, "IMAGE_SIZE");
  assert.equal(
    (
      await req(a, "/tenant/media", "POST", {
        ...base,
        data: red.toString("base64"),
        rightsConfirmed: false,
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await req(a, "/tenant/media", "POST", {
        ...base,
        data: red.toString("base64"),
        crop: { left: 70, top: 50, width: 30, height: 30 },
      })
    ).statusCode,
    400,
  );
});

test("private media and gallery edits stay tenant scoped; subscribers and finance cannot edit or read drafts", async () => {
  const a = await tenant(),
    b = await tenant(),
    sub = await person(a.tenantId, "subscriber"),
    finance = await person(a.tenantId, "finance"),
    m = await upload(a),
    g = await gallery(a, "Private", "draft", [m]);
  for (const actor of [b, sub, finance, null])
    assert.equal((await req(actor, "/media/" + m.id)).statusCode, 404);
  assert.equal((await req(a, "/media/" + m.id)).statusCode, 200);
  assert.equal(
    (
      await req(sub, "/tenant/media", "POST", {
        filename: "x.jpg",
        rightsConfirmed: true,
        data: red.toString("base64"),
      })
    ).statusCode,
    403,
  );
  assert.equal((await req(finance, "/tenant/galleries")).statusCode, 403);
  assert.equal(
    (
      await req(b, "/tenant/galleries/" + g.id, "PATCH", {
        version: g.version,
        title: "Cross tenant",
        description: "No",
        audience: "site",
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (await req(b, "/tenant/media/" + m.id, "DELETE")).statusCode,
    404,
  );
  const foreign = await upload(b, blue);
  assert.equal(
    (
      await req(a, "/tenant/galleries/" + g.id + "/photos", "PUT", {
        version: g.version,
        photos: [{ mediaId: foreign.id, alt: "foreign" }],
      })
    ).statusCode,
    404,
  );
  await assert.rejects(
    db.tenant(b, (tx) =>
      tx.query(
        "INSERT INTO coach_gallery_photos(tenant_id,gallery_id,media_id,alt)VALUES($1,$2,$3,'cross')",
        [b.tenantId, g.id, foreign.id],
      ),
    ),
  );
});

test("site/app/both audiences distinguish public visitors from subscribers", async () => {
  const a = await tenant(),
    sub = await person(a.tenantId, "subscriber"),
    media = [];
  for (const color of ["#101010", "#202020", "#303030", "#404040"])
    media.push(
      await upload(
        a,
        await sharp({
          create: { width: 20, height: 20, channels: 3, background: color },
        })
          .png()
          .toBuffer(),
      ),
    );
  const draft = await gallery(a, "Draft", "draft", [media[0]]),
    site = await gallery(a, "Website", "site", [media[1]]),
    client = await gallery(a, "Clients", "app", [media[2]]),
    both = await gallery(a, "Shared", "both", [media[3]]);
  const visible = (await ok(sub, "/tenant/galleries")).galleries;
  assert.deepEqual(
    visible.map((g: any) => g.id).sort(),
    [client.id, both.id].sort(),
  );
  const publicRows = (await ok(null, `/public/sites/${a.slug}/galleries`))
    .galleries;
  assert.deepEqual(
    publicRows.map((g: any) => g.id).sort(),
    [site.id, both.id].sort(),
  );
  assert.equal((await req(null, "/media/" + media[0].id)).statusCode, 404);
  assert.equal((await req(null, "/media/" + media[2].id)).statusCode, 404);
  assert.equal((await req(null, "/media/" + media[1].id)).statusCode, 200);
  assert.equal((await req(sub, "/media/" + media[2].id)).statusCode, 200);
  await db.system((tx) =>
    tx.query("UPDATE tenants SET published=false WHERE id=$1", [a.tenantId]),
  );
  assert.equal((await req(null, "/media/" + media[1].id)).statusCode, 404);
  assert.equal((await req(null, `/public/sites/${a.slug}`)).statusCode, 404);
});

test("gallery count has no plan cap and both owner and public views paginate beyond 24 galleries", async () => {
  const a = await tenant();
  const created = [];
  for (let i = 0; i < 29; i++)
    created.push(await gallery(a, "Gallery " + i, "site"));
  const first = await ok(a, "/tenant/galleries"),
    second = await ok(a, "/tenant/galleries?offset=" + first.nextOffset);
  assert.equal(first.galleries.length, 24);
  assert.equal(second.galleries.length, 5);
  assert.equal(second.nextOffset, null);
  assert.equal(
    new Set([...first.galleries, ...second.galleries].map((g: any) => g.id))
      .size,
    29,
  );
  const pub1 = await ok(null, `/public/sites/${a.slug}/galleries`),
    pub2 = await ok(
      null,
      `/public/sites/${a.slug}/galleries?offset=${pub1.nextOffset}`,
    );
  assert.equal(pub1.galleries.length + pub2.galleries.length, 29);
});

test("gallery reorder is atomic, revision checked and blocks deletion of referenced images", async () => {
  const a = await tenant(),
    one = await upload(a),
    two = await upload(a, blue),
    g = await gallery(a, "Ordered", "draft", [one, two]);
  assert.equal(
    (await req(a, "/tenant/media/" + one.id, "DELETE")).statusCode,
    409,
  );
  const body = {
    version: g.version,
    photos: [
      { mediaId: two.id, alt: "Second now first", caption: "Moved" },
      { mediaId: one.id, alt: "First now second" },
    ],
  };
  const responses = await Promise.all([
    req(a, "/tenant/galleries/" + g.id + "/photos", "PUT", body),
    req(a, "/tenant/galleries/" + g.id + "/photos", "PUT", body),
  ]);
  assert.deepEqual(responses.map((r) => r.statusCode).sort(), [200, 409]);
  const list = await ok(a, "/tenant/galleries");
  assert.deepEqual(
    list.galleries[0].photos.map((p: any) => p.media_id),
    [two.id, one.id],
  );
  assert.deepEqual(
    list.galleries[0].photos.map((p: any) => p.position),
    [0, 1],
  );
  const current = list.galleries[0];
  assert.equal(
    (
      await req(a, "/tenant/galleries/" + g.id + "/photos", "PUT", {
        version: current.version,
        photos: [
          { mediaId: one.id, alt: "One" },
          { mediaId: one.id, alt: "Duplicate" },
        ],
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await req(a, "/tenant/galleries/" + g.id, "DELETE", {
        version: current.version,
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (await req(a, "/tenant/media/" + one.id, "DELETE")).statusCode,
    200,
  );
});

test("design drafts are private and referenced assets cannot be deleted or published by incidental copy", async () => {
  const a = await tenant(),
    sub = await person(a.tenantId, "subscriber"),
    m = await upload(a),
    draft = await ok(a, "/tenant/design-draft", "PUT", {
      version: 0,
      data: brand(m.url),
    });
  assert.equal(draft.version, 1);
  assert.equal((await req(sub, "/tenant/design-draft")).statusCode, 403);
  assert.equal(
    (await req(a, "/tenant/media/" + m.id, "DELETE")).statusCode,
    409,
  );
  assert.equal((await req(null, "/media/" + m.id)).statusCode, 404);
  await db.system((tx) =>
    tx.query("UPDATE tenants SET theme=$2 WHERE id=$1", [
      a.tenantId,
      JSON.stringify({
        design: { story: "Private draft note referencing " + m.id },
      }),
    ]),
  );
  assert.equal((await req(null, "/media/" + m.id)).statusCode, 404);
  await db.system((tx) =>
    tx.query("UPDATE tenants SET theme=$2 WHERE id=$1", [
      a.tenantId,
      JSON.stringify({ design: { logoUrl: m.url } }),
    ]),
  );
  assert.equal((await req(null, "/media/" + m.id)).statusCode, 200);
  assert.equal((await req(sub, "/media/" + m.id)).statusCode, 200);
  assert.equal(
    (await req(a, "/tenant/design-draft", "PUT", { version: 0, data: brand() }))
      .statusCode,
    409,
  );
});

test("draft preview is owner only and published website pages stay separate until a current revision is published", async () => {
  const a = await tenant(false),
    sub = await person(a.tenantId, "subscriber"),
    first = await ok(a, "/tenant/site", "PUT", {
      version: 0,
      site: {
        headline: "Private draft headline",
        about: "Private draft about",
        pages: [
          {
            slug: "my-method",
            title: "Method",
            body: "Private teaching method",
            visible: true,
          },
        ],
      },
    });
  assert.equal(first.version, 1);
  assert.equal((await req(sub, "/tenant/site/preview")).statusCode, 403);
  assert.equal((await req(null, "/tenant/site/preview")).statusCode, 401);
  const preview = await ok(a, "/tenant/site/preview");
  assert.equal(preview.preview, true);
  assert.equal(preview.site.pages[0].slug, "my-method");
  assert.equal(
    (await req(a, "/tenant/site/publish", "POST", { version: first.version }))
      .statusCode,
    409,
  );
  await db.system((tx) =>
    tx.query("UPDATE tenants SET published=true WHERE id=$1", [a.tenantId]),
  );
  let pub = await ok(null, "/public/sites/" + a.slug);
  assert.equal(pub.site.headline, "");
  const published = await ok(a, "/tenant/site/publish", "POST", {
    version: first.version,
  });
  pub = await ok(null, "/public/sites/" + a.slug);
  assert.equal(pub.site.headline, "Private draft headline");
  const edit = await ok(a, "/tenant/site", "PUT", {
    version: published.version,
    site: {
      headline: "Second private draft",
      pages: [
        {
          slug: "my-method",
          title: "Method",
          body: "Second private version",
          visible: true,
        },
      ],
    },
  });
  pub = await ok(null, "/public/sites/" + a.slug);
  assert.equal(pub.site.headline, "Private draft headline");
  assert.equal(
    (
      await req(a, "/tenant/site/publish", "POST", {
        version: published.version,
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await req(a, "/tenant/site", "PUT", {
        version: edit.version,
        site: {
          pages: [
            { slug: "same", title: "First", body: "" },
            { slug: "same", title: "Second", body: "" },
          ],
        },
      })
    ).statusCode,
    400,
  );
});

test("public inquiries persist consent version, reject unapproved contact and ignore honeypots", async () => {
  const a = await tenant(),
    b = await tenant(),
    sub = await person(a.tenantId, "subscriber"),
    path = "/public/sites/" + a.slug + "/contact",
    body = {
      name: "Synthetic visitor",
      email: "visitor@example.test",
      message: "Please tell me about your coaching.",
      consent: true,
    };
  assert.equal(
    (await req(null, path, "POST", { ...body, consent: false })).statusCode,
    400,
  );
  await ok(null, path, "POST", {
    ...body,
    website: "https://bot.example.test",
  });
  assert.equal((await ok(a, "/tenant/site/inquiries")).items.length, 0);
  await ok(null, path, "POST", body);
  const rows = (await ok(a, "/tenant/site/inquiries")).items;
  assert.equal(rows.length, 1);
  assert.match(rows[0].data.consentVersion, /privacy:/);
  assert.ok(rows[0].data.submittedAt);
  assert.equal((await ok(b, "/tenant/site/inquiries")).items.length, 0);
  assert.equal((await req(sub, "/tenant/site/inquiries")).statusCode, 403);
  assert.equal(
    (
      await req(b, "/tenant/site/inquiries/" + rows[0].id, "POST", {
        version: rows[0].version,
      })
    ).statusCode,
    409,
  );
});

test("manifests expose trainer identity and real 192/512 PNG icons while custom hosts and closed workspaces stay scoped", async () => {
  const a = await tenant(),
    b = await tenant(),
    m = await upload(a);
  await db.system((tx) =>
    tx.query("UPDATE tenants SET theme=$2 WHERE id=$1", [
      a.tenantId,
      JSON.stringify({ design: { logoUrl: m.url, primary: "#123456" } }),
    ]),
  );
  const manifest = await req(
    null,
    "/public/sites/" + a.slug + "/manifest.webmanifest",
  );
  assert.equal(manifest.statusCode, 200, manifest.body);
  assert.match(
    manifest.headers["content-type"] as string,
    /application\/manifest\+json/,
  );
  assert.equal(manifest.json().name, "Synthetic Coach");
  for (const size of [192, 512]) {
    const icon = await req(null, `/public/sites/${a.slug}/icon/${size}`);
    assert.equal(icon.statusCode, 200, icon.body);
    assert.match(icon.headers["content-type"] as string, /image\/png/);
    const info = await sharp(icon.rawPayload).metadata();
    assert.equal(info.width, size);
    assert.equal(info.height, size);
  }
  assert.equal(
    (await req(null, `/public/sites/${a.slug}/icon/256`)).statusCode,
    400,
  );
  hosts.set("coach-a", {
    custom: true,
    tenantId: a.tenantId,
    tenantSlug: a.slug,
    origin: "https://coach.example.test",
  });
  assert.equal(
    (await req(null, "/public/sites/" + b.slug, "GET", undefined, "coach-a"))
      .statusCode,
    404,
  );
  const foreign = await upload(b);
  await gallery(b, "Public B", "site", [foreign]);
  assert.equal(
    (await req(null, "/media/" + foreign.id, "GET", undefined, "coach-a"))
      .statusCode,
    404,
  );
  await db.system((tx) =>
    tx.query("UPDATE tenants SET lifecycle_state='closed' WHERE id=$1", [
      a.tenantId,
    ]),
  );
  assert.equal((await req(null, "/public/sites/" + a.slug)).statusCode, 404);
  assert.equal((await req(null, "/media/" + m.id)).statusCode, 404);
  assert.equal(
    (await req(a, "/tenant/galleries", "POST", { title: "Stale owner" }))
      .statusCode,
    403,
  );
});

test("public galleries remain readable by the non-owner runtime database role on its first request", async () => {
  const a = await tenant(),
    m = await upload(a);
  await gallery(a, "Public only", "site", [m]);
  const role = process.env.DATABASE_URL
    ? "trainer_service"
    : "brand_fixture_service";
  if (!process.env.DATABASE_URL)
    await db.system(async (tx) => {
      await tx.query(
        "CREATE ROLE brand_fixture_service NOLOGIN NOBYPASSRLS NOSUPERUSER NOINHERIT",
      );
      await tx.query("GRANT USAGE ON SCHEMA public TO brand_fixture_service");
      await tx.query(
        "GRANT SELECT ON tenants,coach_sites,coach_galleries,coach_gallery_photos,brand_media TO brand_fixture_service",
      );
      await tx.query(
        "GRANT EXECUTE ON FUNCTION trainer_media_brand_reference(uuid,uuid) TO brand_fixture_service",
      );
    });
  const serviceDb: Database = {
    ...db,
    system: (fn) =>
      db.system(async (tx) => {
        await tx.query(`SET LOCAL ROLE ${role}`);
        const [permissions] = await tx.query(
          "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
        );
        assert.equal(permissions.rolsuper, false);
        assert.equal(permissions.rolbypassrls, false);
        return fn(tx);
      }),
  };
  const result = await publicCoachSite(serviceDb, a.slug);
  assert.equal(result.galleries.length, 1);
  assert.equal(result.galleries[0].photos.length, 1);
});
