// Exercise the assembled API, including real cookie identity and CSRF, instead
// of the route-only synthetic identity hook used by the persistence unit tests.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, type Database } from "@trainer/db";
import { legacyToBuilder } from "../packages/contracts/src/site-builder.ts";
import { buildApp } from "../apps/api/src/app.ts";
import { tokenHash } from "../apps/api/src/auth.ts";

let db: Database, app: Awaited<ReturnType<typeof buildApp>>;
const origin = "http://localhost:3000";
const previousEnv = {
  NODE_ENV: process.env.NODE_ENV,
  PUBLIC_APP_URL: process.env.PUBLIC_APP_URL,
};
let address = 0;

before(async () => {
  Object.assign(process.env, { NODE_ENV: "test", PUBLIC_APP_URL: origin });
  db = await createDatabase({ memory: true });
  app = await buildApp({ db, testing: true });
});
after(async () => {
  await app.close();
  await db.close();
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) Reflect.deleteProperty(process.env, key);
    else process.env[key] = value;
  }
});

async function fixture(role = "owner") {
  const tenantId = randomUUID(),
    userId = randomUUID(),
    token = randomUUID();
  const slug = "builder-" + tenantId.slice(0, 8);
  await db.system(async (tx) => {
    await tx.query(
      "INSERT INTO users(id,email,name,password_hash,email_verified) VALUES($1,$2,'Builder integration coach','unused',true)",
      [userId, userId + "@example.test"],
    );
    await tx.query(
      "INSERT INTO tenants(id,slug,name,published) VALUES($1,$2,'Builder integration coach',true)",
      [tenantId, slug],
    );
    await tx.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)",
      [tenantId, userId, role],
    );
    await tx.query(
      "INSERT INTO sessions(token_hash,user_id,tenant_id,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
      [tokenHash(token), userId, tenantId],
    );
  });
  return { tenantId, userId, token, slug };
}
function request(
  actor: { token: string } | null,
  path: string,
  method: "GET" | "PUT" | "POST" = "GET",
  payload?: unknown,
  requestOrigin = origin,
) {
  return app.inject({
    method,
    url: "/api/v1" + path,
    payload: payload as any,
    remoteAddress: `10.196.0.${++address}`,
    headers: {
      host: "localhost:3000",
      origin: requestOrigin,
      ...(actor ? { cookie: "session=" + actor.token } : {}),
    },
  });
}
async function ok(
  actor: { token: string } | null,
  path: string,
  method: "GET" | "PUT" | "POST" = "GET",
  payload?: unknown,
) {
  const result = await request(actor, path, method, payload);
  assert.equal(result.statusCode, 200, result.body);
  return result.json();
}

test("assembled website builder requires cookie owner identity and allowed mutation origin", async () => {
  const owner = await fixture(),
    finance = await fixture("finance");
  for (const path of [
    "/tenant/site",
    "/tenant/site/history",
    "/tenant/site/preview",
  ]) {
    assert.equal((await request(null, path)).statusCode, 401, path);
    assert.equal((await request(finance, path)).statusCode, 403, path);
    assert.equal((await request(owner, path)).statusCode, 200, path);
  }
  const refused = await request(
    owner,
    "/tenant/site",
    "PUT",
    {
      version: 0,
      site: { headline: "Must not be saved" },
    },
    "https://foreign.example",
  );
  assert.equal(refused.statusCode, 403, refused.body);
  assert.equal(refused.json().code, "ORIGIN_REJECTED");
  assert.equal((await ok(owner, "/tenant/site")).version, 0);
});

test("legacy conversion, multipage publication and draft-only restoration survive the assembled API", async () => {
  const owner = await fixture();
  const legacy = {
    headline: "Existing coaching identity",
    introduction: "A previously published introduction.",
    about: "The existing trainer biography is preserved.",
    contactEmail: "coach@example.test",
    cta: "Explore coaching",
    seoTitle: "Existing coaching site",
    seoDescription: "A previously published search description.",
    pages: [
      {
        slug: "approach",
        title: "My approach",
        body: "Existing detailed approach.",
        visible: true,
      },
    ],
  };
  let state = await ok(owner, "/tenant/site", "PUT", {
    version: 0,
    site: legacy,
  });
  state = await ok(owner, "/tenant/site/publish", "POST", {
    version: state.version,
  });
  const first = await ok(null, "/public/sites/" + owner.slug);
  assert.equal(first.site.headline, legacy.headline);
  assert.equal(typeof first.publishedRevision, "string");
  assert.ok(first.publishedRevision.length > 0);

  const builder = legacyToBuilder(state.draft, {
    name: "Builder integration coach",
  });
  const home = builder.pages.find((page) => page.slug === "");
  assert.ok(home);
  const hero = home.sections.find((section) => section.moduleId === "hero");
  assert.ok(hero);
  hero.content.title = "A privately edited visual website";
  const migratedApproach = builder.pages.find(
    (page) => page.slug === "approach",
  );
  assert.ok(migratedApproach);
  assert.ok(JSON.stringify(migratedApproach).includes(legacy.pages[0].body));
  migratedApproach.seoTitle = "An independently designed approach page";
  migratedApproach.seoDescription =
    "Page-specific search content survives the entire publication lifecycle.";

  state = await ok(owner, "/tenant/site", "PUT", {
    version: state.version,
    site: { ...state.draft, builder },
  });
  assert.equal(state.draft.contactEmail, legacy.contactEmail);
  assert.equal(state.draft.about, legacy.about);
  const privatePreview = await ok(owner, "/tenant/site/preview");
  assert.equal(
    privatePreview.site.builder.pages[0].sections[0].content.title,
    hero.content.title,
  );
  const stillFirst = await ok(null, "/public/sites/" + owner.slug);
  assert.equal(stillFirst.publishedRevision, first.publishedRevision);
  assert.equal(
    stillFirst.site.builder,
    undefined,
    "saving a migrated document must not convert the live legacy website",
  );

  state = await ok(owner, "/tenant/site/publish", "POST", {
    version: state.version,
  });
  const published = await ok(null, "/public/sites/" + owner.slug);
  assert.notEqual(published.publishedRevision, first.publishedRevision);
  assert.equal(
    published.site.builder.pages[0].sections[0].content.title,
    hero.content.title,
  );
  assert.equal(
    published.site.builder.pages.find((page: any) => page.slug === "approach")
      .seoTitle,
    migratedApproach.seoTitle,
  );
  const history = await ok(owner, "/tenant/site/history");
  const original = history.items.find(
    (revision: any) => revision.version === 2,
  );
  assert.ok(original, "the original published legacy snapshot is recoverable");
  state = await ok(owner, "/tenant/site/restore", "POST", {
    version: state.version,
    revisionId: original.id,
  });
  assert.equal(state.draft.headline, legacy.headline);
  assert.equal(
    state.draft.builder,
    undefined,
    "restoring faithfully recovers a legacy document",
  );
  assert.equal(
    (await ok(null, "/public/sites/" + owner.slug)).publishedRevision,
    published.publishedRevision,
    "restoring a snapshot must only change the draft",
  );
  state = await ok(owner, "/tenant/site/publish", "POST", {
    version: state.version,
  });
  const restored = await ok(null, "/public/sites/" + owner.slug);
  assert.equal(restored.site.headline, legacy.headline);
  assert.equal(restored.site.builder, undefined);
  assert.equal(
    restored.publishedRevision,
    first.publishedRevision,
    "content digests follow published content, not unrelated draft revisions",
  );
});

test("hiding migrated pages removes their legacy prose from the whole public payload", async () => {
  const owner = await fixture();
  const privateAbout = "WITHDRAWN_LEGACY_BIOGRAPHY_91f8";
  const privatePage = "WITHDRAWN_LEGACY_PAGE_BODY_e237";
  let state = await ok(owner, "/tenant/site", "PUT", {
    version: 0,
    site: {
      headline: "Public coaching welcome",
      about: privateAbout,
      pages: [
        {
          slug: "old-work",
          title: "Old work",
          body: privatePage,
          visible: true,
        },
      ],
    },
  });
  const builder = legacyToBuilder(state.draft, {
    name: "Builder integration coach",
  });
  for (const page of builder.pages)
    if (["about", "old-work"].includes(page.slug)) {
      page.visible = false;
      page.inNavigation = false;
    }
  state = await ok(owner, "/tenant/site", "PUT", {
    version: state.version,
    site: { ...state.draft, builder },
  });
  state = await ok(owner, "/tenant/site/publish", "POST", {
    version: state.version,
  });
  const publicResponse = await request(null, "/public/sites/" + owner.slug);
  assert.equal(publicResponse.statusCode, 200, publicResponse.body);
  assert.ok(
    !publicResponse.body.includes(privateAbout),
    "hidden migrated biography leaked through stale legacy fields",
  );
  assert.ok(
    !publicResponse.body.includes(privatePage),
    "hidden migrated custom page leaked through stale legacy fields",
  );
  const preview = await ok(owner, "/tenant/site/preview");
  assert.ok(
    JSON.stringify(preview).includes(privateAbout),
    "the coach can recover unpublished content in the private preview",
  );
  assert.ok(JSON.stringify(preview).includes(privatePage));
});
