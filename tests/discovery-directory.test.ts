import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  call,
  coach,
  connectDomain,
  launch,
  listing,
  member,
  ok,
  publishSite,
  start,
  stop,
  PLATFORM,
  type Harness,
} from "./discovery-fixtures.ts";
import { seedScope } from "./scope-fixtures.ts";

let h: Harness;
before(async () => {
  h = await start();
});
after(() => stop(h ?? {}));

const directory = (query = "") => ok(h, "/public/directory" + query);
const slugs = (result: any) => result.coaches.map((c: any) => c.slug);

test("the directory is opt-in: a published coach appears only after the owner lists them, with an audit event", async () => {
  const c = await coach(h, "dir-optin", "Layla Haddad Coaching");
  await publishSite(h, c, {
    headline: "Strength for busy parents",
    introduction: "Short, safe sessions that fit a family week.",
  });
  assert.deepEqual(slugs(await directory("?q=Layla")), []);
  const initial = await ok(h, "/tenant/directory", { cookie: c.cookie });
  assert.equal(initial.listed, false);
  assert.equal(initial.version, 0);
  assert.equal(initial.status, "not_listed");
  assert.equal(initial.published, true);
  assert.equal(initial.preview.headline, "Strength for busy parents");
  assert.ok(initial.options.specialties.length >= 10);

  const listed = await listing(h, c, {
    listed: true,
    specialties: ["strength", "mobility"],
    languages: ["en", "ar"],
  });
  assert.equal(listed.status, "listed");
  assert.equal(listed.visible, true);
  assert.equal(listed.version, 1);
  const found = await directory("?q=Layla");
  assert.equal(found.coaches.length, 1);
  const entry = found.coaches[0];
  // Exactly the promised public fields, nothing about members or revenue.
  assert.deepEqual(Object.keys(entry).sort(), [
    "headline",
    "languages",
    "name",
    "photoUrl",
    "slug",
    "specialties",
    "url",
  ]);
  assert.equal(entry.name, "Layla Haddad Coaching");
  assert.equal(entry.headline, "Strength for busy parents");
  assert.equal(entry.photoUrl, null);
  assert.equal(entry.url, `${PLATFORM}/coach/dir-optin`);
  assert.deepEqual(
    entry.specialties.map((s: any) => s.label),
    ["Strength training", "Mobility and flexibility"],
  );
  assert.deepEqual(
    entry.languages.map((l: any) => l.id),
    ["en", "ar"],
  );

  const events = await h.db.tenant(
    { tenantId: c.tenantId, userId: c.userId, role: "owner" },
    (tx) =>
      tx.query(
        "SELECT actor_id,data FROM events WHERE name='directory.listing_updated' ORDER BY created_at",
      ),
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].actor_id, c.userId);
  assert.equal(events[0].data.listed, true);

  const off = await listing(h, c, {
    listed: false,
    specialties: ["strength"],
    languages: ["en"],
  });
  assert.equal(off.status, "not_listed");
  assert.equal(off.listedAt, null);
  assert.deepEqual(slugs(await directory("?q=Layla")), []);
});

test("listing changes are owner-only, validated, origin-checked and revision-checked", async () => {
  const c = await coach(h, "dir-rules");
  const staff = await member(h, c.tenantId, "staff"),
    follower = await member(h, c.tenantId, "subscriber");
  assert.equal((await call(h, "/tenant/directory")).statusCode, 401);
  for (const other of [staff, follower]) {
    assert.equal(
      (await call(h, "/tenant/directory", { cookie: other.cookie })).statusCode,
      403,
    );
    assert.equal(
      (
        await call(h, "/tenant/directory", {
          method: "PUT",
          cookie: other.cookie,
          body: { version: 0, listed: false, specialties: [], languages: [] },
        })
      ).statusCode,
      403,
    );
  }
  const put = (body: unknown, origin?: string) =>
    call(h, "/tenant/directory", {
      method: "PUT",
      cookie: c.cookie,
      body,
      origin,
    });
  for (const body of [
    { version: 0, listed: true, specialties: [], languages: ["en"] },
    { version: 0, listed: true, specialties: ["strength"], languages: [] },
    { version: 0, listed: true, specialties: ["astrology"], languages: ["en"] },
    {
      version: 0,
      listed: true,
      specialties: ["yoga"],
      languages: ["en", "en"],
    },
    { version: 0, listed: true, specialties: ["yoga"], languages: ["xx"] },
    {
      version: 0,
      listed: true,
      specialties: [
        "strength",
        "weight_loss",
        "muscle_gain",
        "general_fitness",
        "endurance",
        "yoga",
        "pilates",
      ],
      languages: ["en"],
    },
    {
      version: 0,
      listed: false,
      specialties: [],
      languages: [],
      subscriberCount: 5,
    },
  ]) {
    const r = await put(body);
    assert.equal(r.statusCode, 400, JSON.stringify(body));
  }
  const good = { listed: true, specialties: ["yoga"], languages: ["en"] };
  assert.equal(
    (await put({ version: 0, ...good }, "https://attacker.example")).statusCode,
    403,
  );
  assert.equal((await put({ version: 0, ...good })).statusCode, 200);
  const stale = await put({ version: 0, ...good });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().code, "DIRECTORY_CHANGED");
  assert.equal((await put({ version: 7, ...good })).statusCode, 409);
  assert.equal((await put({ version: 1, ...good })).statusCode, 200);
});

test("unpublished coaches wait for launch and a workspace that is no longer active leaves the directory", async () => {
  const c = await coach(h, "dir-waiting", "Omar Waiting Coach");
  const saved = await listing(h, c, {
    listed: true,
    specialties: ["endurance"],
    languages: ["en"],
  });
  assert.equal(saved.status, "waiting_for_launch");
  assert.equal(saved.visible, false);
  assert.deepEqual(slugs(await directory("?q=Omar")), []);
  // The storefront launch alone lists them; a website is not required.
  await launch(h, c);
  assert.deepEqual(slugs(await directory("?q=Omar")), ["dir-waiting"]);
  // The single discovery predicate excludes any non-active lifecycle state,
  // which is how a suspended or closed workspace disappears.
  await h.db.system((tx) =>
    tx.query("UPDATE tenants SET lifecycle_state='closed' WHERE id=$1", [
      c.tenantId,
    ]),
  );
  assert.deepEqual(slugs(await directory("?q=Omar")), []);
  const [check] = await h.db.system((tx) =>
    tx.query("SELECT public_discovery_tenant($1) AS allowed", [c.tenantId]),
  );
  assert.equal(check.allowed, false);
});

test("search filters by specialty, language and text, treats wildcards literally and pages 24 at a time", async () => {
  // Synthetic workspaces; listing rows go through each owner's tenant scope.
  for (let i = 1; i <= 26; i++) {
    const tenantId = randomUUID(),
      slug = `pager-${String(i).padStart(2, "0")}`;
    await h.db.system((tx) =>
      tx.query(
        "INSERT INTO tenants(id,slug,name,published) VALUES($1,$2,$3,true)",
        [tenantId, slug, `Pager Coach ${String(i).padStart(2, "0")}`],
      ),
    );
    await h.db.tenant(seedScope({ tenantId: tenantId }), (tx) =>
      tx.query(
        "INSERT INTO coach_directory_profiles(tenant_id,listed,specialties,languages,listed_at) VALUES($1,true,$2::text[],$3::text[],now())",
        [
          tenantId,
          i % 2 ? ["yoga"] : ["strength"],
          i % 3 ? ["en"] : ["en", "ar"],
        ],
      ),
    );
  }
  const first = await directory("?q=Pager");
  assert.equal(first.coaches.length, 24);
  assert.equal(first.nextOffset, 24);
  assert.equal(first.coaches[0].slug, "pager-01");
  const second = await directory("?q=Pager&offset=24");
  assert.deepEqual(slugs(second), ["pager-25", "pager-26"]);
  assert.equal(second.nextOffset, null);
  const yoga = await directory("?q=pager&specialty=yoga");
  assert.equal(yoga.coaches.length, 13);
  assert.ok(
    yoga.coaches.every((c: any) =>
      c.specialties.some((s: any) => s.id === "yoga"),
    ),
  );
  const arabic = await directory("?q=Pager&language=ar&specialty=strength");
  assert.deepEqual(slugs(arabic), [
    "pager-06",
    "pager-12",
    "pager-18",
    "pager-24",
  ]);
  assert.equal(arabic.query.language, "ar");
  // % and _ are matched as characters, not as patterns that match everyone.
  assert.deepEqual(slugs(await directory("?q=%25")), []);
  assert.deepEqual(slugs(await directory("?q=_")), []);
  assert.deepEqual(slugs(await directory("?q=Coach%2012")), ["pager-12"]);
  for (const bad of [
    "?specialty=astrology",
    "?language=xx",
    "?offset=-1",
    "?sort=revenue",
    "?q=" + "x".repeat(81),
  ])
    assert.equal(
      (await call(h, "/public/directory" + bad)).statusCode,
      400,
      bad,
    );
});

test("listings carry no member data, link to a connected domain, and are unavailable on coach domains or when closed", async () => {
  const c = await coach(h, "dir-private", "Noura Private Coach");
  await member(h, c.tenantId, "subscriber");
  await launch(h, c);
  await listing(h, c, {
    listed: true,
    specialties: ["pilates"],
    languages: ["en"],
  });
  const body = (await call(h, "/public/directory?q=Noura")).body;
  assert.match(body, /Noura Private Coach/);
  assert.doesNotMatch(body, /Private Follower|member\.discovery\.test|@/);
  await connectDomain(h, c, "noura.directory-fixture.test");
  assert.equal(
    (await directory("?q=Noura")).coaches[0].url,
    "https://noura.directory-fixture.test/",
  );
  // The directory belongs to the platform address only.
  assert.equal(
    (
      await call(h, "/public/directory", {
        host: "noura.directory-fixture.test",
      })
    ).statusCode,
    404,
  );
  process.env.COACH_DIRECTORY_ENABLED = "false";
  try {
    const closed = await call(h, "/public/directory");
    assert.equal(closed.statusCode, 404);
    assert.equal(closed.json().code, "DIRECTORY_UNAVAILABLE");
    const settings = await ok(h, "/tenant/directory", { cookie: c.cookie });
    assert.equal(settings.status, "directory_closed");
    assert.equal(settings.listed, true);
  } finally {
    delete process.env.COACH_DIRECTORY_ENABLED;
  }
  assert.equal((await directory("?q=Noura")).coaches.length, 1);
});
