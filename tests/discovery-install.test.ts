import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  appInitials,
  platformManifest,
  resolveBrandDesign,
  shortAppName,
} from "../packages/contracts/src/index.ts";
import { renderAppIcon, workspaceIconKey } from "../apps/api/src/discovery.ts";
import {
  call,
  coach,
  connectDomain,
  launch,
  member,
  ok,
  start,
  stop,
  type Coach,
  type Harness,
} from "./discovery-fixtures.ts";

let h: Harness;
before(async () => {
  h = await start();
});
after(() => stop(h ?? {}));

const design = (extra: Record<string, unknown> = {}) => ({
  preset: "clay",
  primary: "#733f32",
  accent: "#edceb3",
  surface: "#fbf5ef",
  ...extra,
});
async function saveBrand(c: Coach, name: string, extra = {}) {
  return ok(h, "/tenant/brand", {
    method: "PUT",
    cookie: c.cookie,
    body: {
      name,
      bio: "Synthetic coach biography",
      category: "Strength",
      accent: "#733f32",
      headline: "Train with intent",
      timezone: "Asia/Dubai",
      design: design(extra),
    },
  });
}
const manifestOf = async (cookie?: string) => {
  const r = await call(h, "/app/manifest.webmanifest", { cookie });
  assert.equal(r.statusCode, 200, r.body);
  assert.match(
    String(r.headers["content-type"]),
    /application\/manifest\+json/,
  );
  return { body: r.json(), headers: r.headers };
};
const withoutApi = (src: string) => src.replace(/^\/api\/v1/, "");
async function png(src: string, cookie?: string) {
  const r = await h.app.inject({
    url: src,
    method: "GET",
    headers: cookie ? { cookie } : {},
  });
  assert.equal(r.statusCode, 200, `${src}: ${r.body}`);
  assert.equal(r.headers["content-type"], "image/png");
  return { buffer: r.rawPayload, headers: r.headers };
}

test("anonymous visitors keep the platform manifest and cannot read install details", async () => {
  const { body, headers } = await manifestOf();
  assert.deepEqual(body, platformManifest());
  assert.equal(headers["vary"], "Cookie");
  assert.match(String(headers["cache-control"]), /private/);
  assert.equal((await call(h, "/app/install")).statusCode, 401);
});

test("members of an unpublished workspace get the trainer-branded manifest with Design Studio colours", async () => {
  const c = await coach(h, "install-unpublished");
  await saveBrand(c, "Maryam Al Mansoori Coaching");
  const follower = await member(h, c.tenantId, "subscriber"),
    staff = await member(h, c.tenantId, "staff"),
    finance = await member(h, c.tenantId, "finance");
  const { body } = await manifestOf(follower.cookie);
  assert.equal(body.name, "Maryam Al Mansoori Coaching");
  assert.equal(body.short_name, "Maryam Al");
  assert.equal(body.theme_color, "#733f32");
  assert.equal(body.background_color, "#fbf5ef");
  assert.equal(body.start_url, "/app");
  assert.equal(body.scope, "/");
  assert.equal(body.display, "standalone");
  assert.equal(body.id, "/coach/install-unpublished");
  assert.deepEqual(
    body.icons.map((i: any) => [i.sizes, i.purpose, i.type]),
    [
      ["192x192", "any", "image/png"],
      ["512x512", "any", "image/png"],
      ["512x512", "maskable", "image/png"],
    ],
  );
  for (const who of [c, staff, finance])
    assert.equal((await manifestOf(who.cookie)).body.start_url, "/trainer");
  const install = await ok(h, "/app/install", { cookie: follower.cookie });
  assert.equal(install.published, false);
  assert.equal(install.themeColor, "#733f32");
  assert.equal(install.shortName, "Maryam Al");
  assert.equal(install.manifestUrl, "/api/v1/app/manifest.webmanifest");
  assert.match(install.icons.apple, /\/180\.png\?v=[0-9a-f]{12}$/);
  assert.equal(Object.hasOwn(install, "manifest"), false);
  // The public website assets stay private until the storefront launches.
  assert.equal(
    (await call(h, "/public/sites/install-unpublished/icon/192")).statusCode,
    404,
  );
  assert.equal(
    (await call(h, "/public/sites/install-unpublished/manifest.webmanifest"))
      .statusCode,
    404,
  );
});

test("member icons are exact-size opaque PNGs that load without cookies from an unguessable per-workspace key", async () => {
  const c = await coach(h, "install-icons");
  await saveBrand(c, "Icon Coach");
  const follower = await member(h, c.tenantId, "subscriber");
  const { body } = await manifestOf(follower.cookie);
  const install = await ok(h, "/app/install", { cookie: follower.cookie });
  const sources = [
    ...body.icons.map((i: any) => [i.src, Number(i.sizes.split("x")[0])]),
    [install.icons.apple, 180],
    [install.icons.icon, 192],
  ];
  for (const [src, size] of sources) {
    // No cookie: some browsers fetch manifest icons without credentials.
    const { buffer, headers } = await png(src);
    const meta = await sharp(buffer).metadata();
    assert.equal(meta.width, size, src);
    assert.equal(meta.height, size, src);
    assert.equal(meta.hasAlpha, false, src);
    assert.match(String(headers["cache-control"]), /private, max-age=86400/);
  }
  const key = body.icons[0].src.split("/")[5];
  assert.match(key, /^[A-Za-z0-9_-]{32}$/);
  assert.ok(!key.includes("install-icons"));
  assert.equal(await workspaceIconKey(h.db, c.tenantId), key);
  const other = await coach(h, "install-other");
  assert.notEqual(await workspaceIconKey(h.db, other.tenantId), key);
  for (const bad of [
    `/app/icons/${"A".repeat(32)}/192.png`,
    `/app/icons/${key}/64.png`,
    `/app/icons/${key}/..%2F192.png`,
    `/app/icons/short/192.png`,
  ])
    assert.equal((await call(h, bad)).statusCode, 404, bad);
  // A workspace that is no longer active stops serving its icon.
  await h.db.system((tx) =>
    tx.query("UPDATE tenants SET lifecycle_state='closed' WHERE id=$1", [
      c.tenantId,
    ]),
  );
  assert.equal((await call(h, withoutApi(body.icons[0].src))).statusCode, 404);
  // Its members lose their session, so they fall back to the platform app.
  assert.deepEqual(
    (await manifestOf(follower.cookie)).body,
    platformManifest(),
  );
});

test("a platform-hosted logo is drawn on the brand surface and a design change gives new icon addresses", async () => {
  const c = await coach(h, "install-logo");
  await saveBrand(c, "Logo Coach");
  const before = await ok(h, "/app/install", { cookie: c.cookie });
  const red = await sharp({
    create: { width: 120, height: 80, channels: 3, background: "#e02020" },
  })
    .jpeg()
    .toBuffer();
  const media = await ok(h, "/tenant/media", {
    method: "POST",
    cookie: c.cookie,
    body: {
      filename: "logo.jpg",
      rightsConfirmed: true,
      data: red.toString("base64"),
    },
  });
  await saveBrand(c, "Logo Coach", { logoUrl: media.url });
  const after = await ok(h, "/app/install", { cookie: c.cookie });
  assert.notEqual(after.icons.icon, before.icons.icon);
  const { buffer } = await png(after.icons.icon);
  const { data, info } = await sharp(buffer)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixel = (x: number, y: number) => {
    const i = (y * info.width + x) * info.channels;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const [r, g, b] = pixel(96, 96);
  assert.ok(r > 180 && g < 80 && b < 80, `centre ${r},${g},${b}`);
  // The logo is inset on the Design Studio surface colour (#fbf5ef).
  const corner = pixel(2, 2);
  assert.ok(
    Math.abs(corner[0] - 0xfb) < 4 &&
      Math.abs(corner[1] - 0xf5) < 4 &&
      Math.abs(corner[2] - 0xef) < 4,
    `corner ${corner}`,
  );
});

test("icons fall back to initials and a coach domain serves only its own workspace's icons", async () => {
  const fallback = await renderAppIcon({
    name: "Sara Coach",
    design: resolveBrandDesign({}),
    size: 512,
    variant: "maskable",
    logo: Buffer.from("not an image"),
  });
  const meta = await sharp(fallback).metadata();
  assert.equal(meta.width, 512);
  assert.equal(meta.hasAlpha, false);
  assert.equal(appInitials("  sara  al noor "), "SA");
  assert.equal(appInitials("<script>"), "S");
  assert.equal(appInitials("ليلى حداد"), "لح");
  assert.equal(shortAppName("Coach"), "Coach");
  assert.equal(shortAppName("Supercalifragilistic"), "Supercalifra");

  const mapped = await coach(h, "install-domain");
  await launch(h, mapped);
  const host = "install-domain.icon-fixture.test";
  await connectDomain(h, mapped, host);
  const stranger = await coach(h, "install-stranger");
  const own = await workspaceIconKey(h.db, mapped.tenantId),
    foreign = await workspaceIconKey(h.db, stranger.tenantId);
  assert.equal(
    (await call(h, `/app/icons/${own}/192.png`, { host })).statusCode,
    200,
  );
  assert.equal(
    (await call(h, `/app/icons/${foreign}/192.png`, { host })).statusCode,
    404,
  );
  // Concurrent first requests settle on one key.
  const fresh = await coach(h, "install-concurrent");
  const keys = await Promise.all(
    Array.from({ length: 5 }, () => workspaceIconKey(h.db, fresh.tenantId)),
  );
  assert.equal(new Set(keys).size, 1);
});
