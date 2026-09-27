import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import sharp from "sharp";
import {
  COACH_HOST_PLATFORM_SEGMENTS,
  COACH_SITE_MAX_URLS,
  PRIVATE_ROUTE_SEGMENTS,
  PUBLIC_MARKETING_PATHS,
  SITEMAP_COACHES_PER_FILE,
  SITEMAP_URL_LIMIT,
  coachHostPagePath,
  isIndexablePlatformPath,
  isPrivatePath,
  platformManifest,
  robotsPolicy,
  sitemapIndexXml,
  sitemapUrlSetXml,
} from "../packages/contracts/src/discovery.ts";
import { customHostPath } from "../apps/web/host-proxy.ts";
import { coachSitePaths, sitemapEntries } from "../apps/api/src/discovery.ts";
import { siteSchema } from "../apps/api/src/coach-site.ts";
import type { NextConfig } from "next";
import nextConfig from "../apps/web/next.config.ts";
import {
  call,
  coach,
  connectDomain,
  launch,
  ok,
  publishSite,
  start,
  stop,
  PLATFORM,
  type Harness,
} from "./discovery-fixtures.ts";

let h: Harness;
before(async () => {
  h = await start();
});
after(() => stop(h ?? {}));

const privatePaths = [
  "/app",
  "/app/nutrition/log",
  "/trainer/website",
  "/admin/settings",
  "/login",
  "/signup",
  "/join/abc123",
  "/join-coach/some-coach",
  "/forgot-password",
  "/reset-password/token",
  "/verify-email/token",
  "/magic-link",
  "/recover-authenticator",
];
const publicPaths = [
  "/",
  "/pricing",
  "/terms",
  "/coaches",
  "/coach/x",
  "/about",
];

/**
 * RFC 9309 matching as Google and Bing apply it: a rule matches from the
 * start of the path (including the query), "*" matches any run of characters
 * and a trailing "$" anchors the end. The longest matching rule wins; allow
 * wins a tie.
 */
function robotsAllows(
  policy: ReturnType<typeof robotsPolicy>,
  path: string,
): boolean {
  const matchLength = (rule: string) => {
    const anchored = rule.endsWith("$");
    const body = (anchored ? rule.slice(0, -1) : rule)
      .split("*")
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*");
    return new RegExp("^" + body + (anchored ? "$" : "")).test(path)
      ? rule.length
      : -1;
  };
  const longest = (rules: string[]) => Math.max(-1, ...rules.map(matchLength));
  const allow = longest(policy.rules.allow),
    disallow = longest(policy.rules.disallow);
  return disallow < 0 || allow >= disallow;
}

test("robots rules close private routes on every host and point at that host's sitemap", () => {
  const platform = robotsPolicy(PLATFORM + "/any/path", false);
  assert.equal(platform.sitemap, PLATFORM + "/sitemap.xml");
  assert.deepEqual(platform.rules.allow, ["/"]);
  const coachHost = robotsPolicy("https://fit.example.test", true);
  assert.equal(coachHost.sitemap, "https://fit.example.test/sitemap.xml");
  for (const policy of [platform, coachHost]) {
    for (const path of [
      ...privatePaths,
      "/api/v1/bootstrap",
      "/app?tab=today",
      "/login?next=/app",
      "/trainer/",
    ])
      assert.equal(robotsAllows(policy, path), false, path);
    for (const path of publicPaths)
      assert.equal(robotsAllows(policy, path), true, path);
    // No bare prefix rule: every rule is "/api/", a subtree, exact or query.
    for (const rule of policy.rules.disallow)
      assert.match(rule, /^\/[a-z-]+(\/|\$|\?)$/, rule);
  }
  // The directory exists only on the platform, and "/coaches" on a coach
  // domain is the coach's own page, so neither host closes it.
  assert.equal(robotsAllows(platform, "/coaches"), true);
  assert.equal(robotsAllows(coachHost, "/coaches"), true);
});

test("robots rules never close a coach page that shares a private route's prefix", () => {
  const slugs = [
    "approach",
    "apply",
    "applications",
    "appointments",
    "trainers",
    "trainer-tips",
    "admissions",
    "login-help",
    "signups",
    "joining",
    "join-coach",
    "coach",
    "coaches",
    "coaches-corner",
    "magic-links",
    "apis",
    "api",
    "terms-of-sale",
    "privacy-at-home",
  ];
  for (const slug of slugs)
    assert.ok(
      siteSchema.safeParse({ pages: [{ slug, title: "T", body: "" }] }).success,
      slug,
    );
  const platform = robotsPolicy(PLATFORM, false),
    coachHost = robotsPolicy("https://fit.example.test", true);
  const row = {
    slug: "fit-coach",
    published: {
      pages: slugs.map((slug) => ({
        slug,
        title: slug,
        body: "",
        visible: true,
      })),
    },
    published_at: null,
    has_galleries: true,
  };
  // Every address a coach domain's sitemap lists reaches the coach website
  // through the proxy and is open to crawlers.
  for (const path of coachSitePaths(row, "custom")) {
    const routed = customHostPath(path, "fit-coach");
    assert.equal(
      routed,
      path.startsWith("/coach/fit-coach")
        ? path
        : "/coach/fit-coach" + (path === "/" ? "" : path),
      path,
    );
    assert.equal(robotsAllows(coachHost, path), true, path);
  }
  for (const path of coachSitePaths(row, "platform"))
    assert.equal(robotsAllows(platform, path), true, path);
  // The platform still closes its own private routes exactly.
  for (const path of [
    "/app",
    "/app/x",
    "/trainer",
    "/login",
    "/join",
    "/join-coach",
  ])
    assert.equal(robotsAllows(platform, path), false, path);
  // On a coach domain "/join-coach" alone is the coach's page; its subtree is
  // the private enrolment route.
  assert.equal(robotsAllows(coachHost, "/join-coach"), true);
  assert.equal(robotsAllows(coachHost, "/join-coach/fit-coach"), false);
  for (const path of ["/app", "/app/x", "/trainer", "/login"])
    assert.equal(robotsAllows(coachHost, path), false, path);
});

test("the coach-domain page list agrees with the web proxy's routing", () => {
  const slug = "fit-coach";
  // Each platform segment is not served by the coach website on its domain.
  for (const segment of COACH_HOST_PLATFORM_SEGMENTS) {
    assert.notEqual(
      customHostPath("/" + segment, slug),
      `/coach/${slug}/${segment}`,
      segment,
    );
    assert.equal(coachHostPagePath(slug, segment), `/coach/${slug}/${segment}`);
  }
  // Every other valid single-segment page address is the coach's own page.
  const others = [
    ...PRIVATE_ROUTE_SEGMENTS.flatMap((s) => [s + "s", s + "-x", "my-" + s]),
    "coach",
    "join-coach",
    "coaches",
    "api",
    "about-me",
    "results",
  ].filter(
    (page) =>
      !(COACH_HOST_PLATFORM_SEGMENTS as readonly string[]).includes(page),
  );
  for (const page of others) {
    assert.equal(
      customHostPath("/" + page, slug),
      `/coach/${slug}/${page}`,
      page,
    );
    assert.equal(coachHostPagePath(slug, page), "/" + page);
  }
});

test("sitemap files are well-formed and sized below the protocol limit", () => {
  const xml = sitemapUrlSetXml([
    {
      url: "https://fit.example.test/",
      lastModified: "2026-09-27T00:00:00.000Z",
    },
    { url: "https://fit.example.test/a?b=1&c=<2>" },
  ]);
  assert.ok(
    xml.startsWith(
      '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ),
  );
  assert.ok(
    xml.includes(
      "<loc>https://fit.example.test/</loc>\n<lastmod>2026-09-27T00:00:00.000Z</lastmod>",
    ),
  );
  assert.ok(
    xml.includes("<loc>https://fit.example.test/a?b=1&amp;c=&lt;2&gt;</loc>"),
  );
  assert.equal(xml.match(/<url>/g)?.length, 2);
  const index = sitemapIndexXml([
    PLATFORM + "/sitemaps/0.xml",
    PLATFORM + "/sitemaps/1.xml",
  ]);
  assert.ok(
    index.includes(
      '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ),
  );
  assert.equal(index.match(/<sitemap>/g)?.length, 2);
  // A website has at most the home page, four sections and 100 custom pages.
  const page = (n: number) => ({ slug: "p" + n, title: "P", body: "" });
  assert.ok(
    siteSchema.safeParse({
      pages: Array.from({ length: 100 }, (_, n) => page(n)),
    }).success,
  );
  assert.ok(
    !siteSchema.safeParse({
      pages: Array.from({ length: 101 }, (_, n) => page(n)),
    }).success,
  );
  assert.equal(COACH_SITE_MAX_URLS, 1 + 4 + 100);
  assert.ok(
    PUBLIC_MARKETING_PATHS.length +
      1 +
      SITEMAP_COACHES_PER_FILE * COACH_SITE_MAX_URLS <=
      SITEMAP_URL_LIMIT,
  );
  assert.ok(SITEMAP_URL_LIMIT < 50000);
});

test("only marketing pages and the directory are indexable on the platform address", () => {
  for (const path of privatePaths) {
    assert.equal(isPrivatePath(path), true, path);
    assert.equal(isIndexablePlatformPath(path), false, path);
  }
  for (const path of PUBLIC_MARKETING_PATHS)
    assert.equal(isIndexablePlatformPath(path), true, path);
  assert.equal(isIndexablePlatformPath("/coaches"), true);
  assert.equal(isIndexablePlatformPath("/pricing/"), true);
  assert.equal(isIndexablePlatformPath("/coaches?specialty=yoga"), true);
  assert.equal(isIndexablePlatformPath("/unknown-page"), false);
  assert.equal(isPrivatePath("/apple"), false);
  assert.equal(isPrivatePath("/coach/app"), false);
  assert.equal(isPrivatePath("/api/v1/bootstrap"), true);
});

test("the web server sends X-Robots-Tag on private routes and nowhere public", async () => {
  // Evaluate the real header rules with Next's own route matcher.
  const require = createRequire(import.meta.url);
  const {
    getPathMatch,
  } = require("next/dist/shared/lib/router/utils/path-match");
  // apps/web is CommonJS to tsx, so the config may arrive wrapped.
  const config = ((nextConfig as any).default ?? nextConfig) as NextConfig;
  const rules = await config.headers!();
  const noindex = rules.filter((rule: any) =>
    rule.headers.some((x: any) => x.key === "X-Robots-Tag"),
  );
  assert.equal(noindex.length, 1);
  const matches = getPathMatch(noindex[0].source, {
    strict: true,
    removeUnnamedParams: true,
  });
  for (const path of privatePaths) assert.ok(matches(path), path);
  for (const path of [...publicPaths, "/apple", "/coach/app", "/sitemap.xml"])
    assert.equal(matches(path), false, path);
});

test("a connected coach domain serves its own crawler files", () => {
  assert.equal(customHostPath("/robots.txt", "coach-one"), "/robots.txt");
  assert.equal(customHostPath("/sitemap.xml", "coach-one"), "/sitemap.xml");
  // Unchanged behaviour for everything else.
  assert.equal(customHostPath("/about", "coach-one"), "/coach/coach-one/about");
  assert.equal(
    customHostPath("/coaches", "coach-one"),
    "/coach/coach-one/coaches",
  );
  assert.equal(customHostPath("/trainer", "coach-one"), null);
  assert.equal(customHostPath("/robots.txt", "Bad Slug"), null);
});

test("the static platform manifest matches the shared definition and its PNG icons are real sizes", async () => {
  const publicDir = new URL("../apps/web/public/", import.meta.url);
  const manifest = JSON.parse(
    await readFile(new URL("manifest.webmanifest", publicDir), "utf8"),
  );
  assert.deepEqual(manifest, platformManifest());
  const pngs = manifest.icons.filter((i: any) => i.type === "image/png");
  assert.ok(pngs.some((i: any) => i.purpose === "maskable"));
  for (const icon of [
    ...pngs,
    { src: "/icons/apple-touch-icon.png", sizes: "180x180", purpose: "apple" },
  ]) {
    const [w, hgt] = icon.sizes.split("x").map(Number);
    const meta = await sharp(
      await readFile(new URL(icon.src.slice(1), publicDir)),
    ).metadata();
    assert.equal(meta.format, "png", icon.src);
    assert.equal(meta.width, w, icon.src);
    assert.equal(meta.height, hgt, icon.src);
    // Home-screen surfaces that crop or fill need an opaque image.
    if (icon.purpose !== "any") assert.equal(meta.hasAlpha, false, icon.src);
  }
  assert.equal(platformManifest("  ").name, "Trainer Brain");
  assert.equal(
    platformManifest("A Very Long Platform Name").short_name,
    "A Very Long",
  );
});

test("the platform sitemap lists marketing pages, the directory and published coach pages only", async () => {
  const shown = await coach(h, "seo-shown", "Shown Coach");
  await publishSite(h, shown, {
    headline: "Visible",
    pages: [
      { slug: "my-method", title: "Method", body: "Public", visible: true },
      { slug: "hidden-notes", title: "Hidden", body: "No", visible: false },
    ],
  });
  const gallery = await ok(h, "/tenant/galleries", {
    method: "POST",
    cookie: shown.cookie,
    body: { title: "Studio" },
  });
  await ok(h, `/tenant/galleries/${gallery.id}`, {
    method: "PATCH",
    cookie: shown.cookie,
    body: {
      version: gallery.version,
      title: "Studio",
      description: "Synthetic",
      audience: "site",
    },
  });
  const plain = await coach(h, "seo-plain");
  await publishSite(h, plain, { headline: "No galleries" });
  const draft = await coach(h, "seo-draft");
  await ok(h, "/tenant/site", {
    method: "PUT",
    cookie: draft.cookie,
    body: { version: 0, site: { headline: "Private draft" } },
  });
  const launchedOnly = await coach(h, "seo-launched-only");
  await launch(h, launchedOnly);
  const closed = await coach(h, "seo-closed");
  await publishSite(h, closed, { headline: "Closed later" });
  await h.db.system((tx) =>
    tx.query("UPDATE tenants SET lifecycle_state='closed' WHERE id=$1", [
      closed.tenantId,
    ]),
  );
  const domain = await coach(h, "seo-domain");
  await publishSite(h, domain, { headline: "On its own domain" });
  await connectDomain(h, domain, "seo-domain.sitemap-fixture.test");

  const first = await ok(h, "/public/discovery/sitemap");
  assert.equal(first.page, 0);
  assert.equal(first.pages, 1);
  const { entries } = first;
  const urls = entries.map((e: any) => e.url);
  for (const path of PUBLIC_MARKETING_PATHS)
    assert.ok(urls.includes(PLATFORM + path), path);
  assert.ok(urls.includes(PLATFORM + "/coaches"));
  const base = PLATFORM + "/coach/seo-shown";
  for (const path of [
    "",
    "/about",
    "/memberships",
    "/galleries",
    "/contact",
    "/my-method",
  ])
    assert.ok(urls.includes(base + path), base + path);
  assert.ok(!urls.includes(base + "/hidden-notes"));
  assert.ok(urls.includes(PLATFORM + "/coach/seo-plain"));
  assert.ok(!urls.includes(PLATFORM + "/coach/seo-plain/galleries"));
  // A launched coach who never published a website revision has the default
  // website, which /coach/<slug> serves and the directory links to; it is
  // listed the same way, without a last-modified time.
  const launchedBase = PLATFORM + "/coach/seo-launched-only";
  for (const path of ["", "/about", "/memberships", "/contact"])
    assert.ok(urls.includes(launchedBase + path), launchedBase + path);
  assert.equal(
    entries.find((e: any) => e.url === launchedBase).lastModified,
    undefined,
  );
  for (const hidden of ["seo-draft", "seo-closed", "seo-domain"])
    assert.ok(
      !urls.some((u: string) => u.includes("/coach/" + hidden)),
      hidden,
    );
  for (const privatePath of privatePaths)
    assert.ok(!urls.includes(PLATFORM + privatePath), privatePath);
  const shownEntry = entries.find((e: any) => e.url === base);
  assert.ok(!Number.isNaN(Date.parse(shownEntry.lastModified)));
  assert.equal(new Set(urls).size, urls.length);

  process.env.COACH_DIRECTORY_ENABLED = "false";
  try {
    const closedDirectory = await ok(h, "/public/discovery/sitemap");
    assert.ok(
      !closedDirectory.entries.some(
        (e: any) => e.url === PLATFORM + "/coaches",
      ),
    );
  } finally {
    delete process.env.COACH_DIRECTORY_ENABLED;
  }
});

test("a coach domain sitemap lists only that coach's pages at the addresses its domain serves", async () => {
  const c = await coach(h, "seo-host");
  await publishSite(h, c, {
    headline: "Domain coach",
    pages: [
      { slug: "results", title: "Results", body: "Yes", visible: true },
      { slug: "approach", title: "Approach", body: "Yes", visible: true },
      { slug: "privacy", title: "My privacy", body: "Yes", visible: true },
    ],
  });
  const host = "seo-host.sitemap-fixture.test";
  await connectDomain(h, c, host);
  const file = await ok(h, "/public/discovery/sitemap", { host });
  assert.equal(file.page, 0);
  assert.equal(file.pages, 1);
  const urls = file.entries.map((e: any) => e.url);
  assert.deepEqual(urls, [
    `https://${host}/`,
    `https://${host}/about`,
    `https://${host}/memberships`,
    `https://${host}/contact`,
    `https://${host}/results`,
    `https://${host}/approach`,
    // "/privacy" on a coach domain is the platform's page, so the coach's
    // page is listed where that domain serves it.
    `https://${host}/coach/seo-host/privacy`,
  ]);
  for (const url of urls) {
    const path = new URL(url).pathname;
    const routed = customHostPath(path, "seo-host");
    assert.ok(routed?.startsWith("/coach/seo-host"), `${path} -> ${routed}`);
    assert.ok(robotsAllows(robotsPolicy("https://" + host, true), path), path);
  }
  // A coach domain has exactly one sitemap file.
  assert.equal(
    (await call(h, "/public/discovery/sitemap?page=1", { host })).statusCode,
    404,
  );
  // A launched coach with a domain but no published website revision lists
  // the default website pages, as on the platform.
  const bareHost = "seo-host-bare.sitemap-fixture.test",
    bareId = randomUUID();
  await h.db.system((tx) =>
    tx.query(
      "INSERT INTO tenants(id,slug,name,published) VALUES($1,'seo-host-bare','Bare Coach',true)",
      [bareId],
    ),
  );
  await connectDomain(
    h,
    { tenantId: bareId, userId: "", slug: "seo-host-bare", cookie: "" },
    bareHost,
  );
  assert.deepEqual(
    (await ok(h, "/public/discovery/sitemap", { host: bareHost })).entries,
    ["/", "/about", "/memberships", "/contact"].map((path) => ({
      url: `https://${bareHost}${path}`,
    })),
  );
  // A connected domain whose coach is no longer discoverable is not routed.
  await h.db.system((tx) =>
    tx.query("UPDATE tenants SET published=false WHERE id=$1", [c.tenantId]),
  );
  assert.equal(
    (await call(h, "/public/discovery/sitemap", { host })).statusCode,
    421,
  );
});

test("the platform sitemap is split into files instead of dropping coaches", async () => {
  // Launched workspaces inserted directly: registration is rate limited.
  await h.db.system(async (tx) => {
    for (const n of [1, 2, 3, 4, 5])
      await tx.query(
        "INSERT INTO tenants(id,slug,name,published) VALUES($1,$2,$3,true)",
        [randomUUID(), `seo-page-${n}`, `Paged Coach ${n}`],
      );
  });
  const context = {
    host: new URL(PLATFORM).host,
    origin: PLATFORM,
    tenantId: null,
    tenantSlug: null,
    custom: false,
    verifiedProxy: true,
  };
  const homes = (entries: { url: string }[]) =>
    entries.map((e) => e.url).filter((url) => /\/coach\/[a-z0-9-]+$/.test(url));
  const whole = await sitemapEntries(h.db, context, 0, 100000);
  assert.equal(whole.pages, 1);
  const everyone = homes(whole.entries);
  assert.ok(everyone.length >= 5);
  const perFile = 2;
  const first = await sitemapEntries(h.db, context, 0, perFile);
  assert.equal(first.pages, Math.ceil(everyone.length / perFile));
  const seen: string[] = [];
  for (let page = 0; page < first.pages; page++) {
    const file = await sitemapEntries(h.db, context, page, perFile);
    assert.equal(file.page, page);
    const coaches = homes(file.entries);
    assert.ok(coaches.length >= 1 && coaches.length <= perFile, `${page}`);
    seen.push(...coaches);
    // Marketing pages and the directory are listed once, in the first file.
    assert.equal(
      file.entries.some((e) => e.url === PLATFORM + "/pricing"),
      page === 0,
    );
  }
  assert.deepEqual(seen, everyone);
  await assert.rejects(
    sitemapEntries(h.db, context, first.pages, perFile),
    (e: any) => e.statusCode === 404,
  );
  // The HTTP route validates the file number strictly.
  assert.equal(
    (await call(h, "/public/discovery/sitemap?page=5000")).statusCode,
    404,
  );
  assert.equal(
    (await call(h, "/public/discovery/sitemap?page=abc")).statusCode,
    400,
  );
  assert.equal(
    (await call(h, "/public/discovery/sitemap?page=-1")).statusCode,
    400,
  );
  assert.equal(
    (await call(h, "/public/discovery/sitemap?limit=5")).statusCode,
    400,
  );
  assert.equal((await ok(h, "/public/discovery/sitemap?page=0")).pages, 1);
});

test("every API response, including errors, is marked noindex", async () => {
  for (const path of [
    "/public/discovery/sitemap",
    "/public/directory",
    "/bootstrap",
    "/public/sites/does-not-exist",
  ]) {
    const r = await call(h, path);
    assert.equal(r.headers["x-robots-tag"], "noindex, nofollow", path);
  }
});
