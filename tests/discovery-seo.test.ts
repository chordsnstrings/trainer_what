import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import sharp from "sharp";
import {
  PRIVATE_ROUTE_PREFIXES,
  PUBLIC_MARKETING_PATHS,
  isIndexablePlatformPath,
  isPrivatePath,
  platformManifest,
  robotsPolicy,
} from "../packages/contracts/src/discovery.ts";
import { customHostPath } from "../apps/web/host-proxy.ts";
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

test("robots rules close private routes on every host and point at that host's sitemap", () => {
  const platform = robotsPolicy(PLATFORM + "/any/path", false);
  assert.equal(platform.sitemap, PLATFORM + "/sitemap.xml");
  assert.deepEqual(platform.rules.allow, ["/"]);
  for (const prefix of ["/api/", "/app", "/trainer", "/admin", "/login"])
    assert.ok(platform.rules.disallow.includes(prefix), prefix);
  assert.ok(!platform.rules.disallow.includes("/coaches"));
  const coachHost = robotsPolicy("https://fit.example.test", true);
  assert.equal(coachHost.sitemap, "https://fit.example.test/sitemap.xml");
  assert.ok(coachHost.rules.disallow.includes("/coaches"));
  // Every private page is covered by a disallow prefix; public pages are not.
  const blocked = (path: string) =>
    platform.rules.disallow.some((prefix) => path.startsWith(prefix));
  for (const path of privatePaths) assert.ok(blocked(path), path);
  for (const path of publicPaths) assert.ok(!blocked(path), path);
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
  assert.equal(PRIVATE_ROUTE_PREFIXES.includes("/api/"), true);
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

  const { entries } = await ok(h, "/public/discovery/sitemap");
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
  for (const hidden of [
    "seo-draft",
    "seo-launched-only",
    "seo-closed",
    "seo-domain",
  ])
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

test("a coach domain sitemap lists only that coach's published pages at its own origin", async () => {
  const c = await coach(h, "seo-host");
  await publishSite(h, c, {
    headline: "Domain coach",
    pages: [{ slug: "results", title: "Results", body: "Yes", visible: true }],
  });
  const host = "seo-host.sitemap-fixture.test";
  await connectDomain(h, c, host);
  const { entries } = await ok(h, "/public/discovery/sitemap", { host });
  assert.deepEqual(
    entries.map((e: any) => e.url),
    [
      `https://${host}/`,
      `https://${host}/about`,
      `https://${host}/memberships`,
      `https://${host}/contact`,
      `https://${host}/results`,
    ],
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
