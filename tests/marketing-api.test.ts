// Public platform facts for the marketing site, the optional Connect
// Instagram read, the "Share your link" setup step and the marketing
// settings. PGlite; Instagram HTTP calls go to a fixture transport.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";
import {
  instagramAuthorizeUrl,
  readInstagramSnapshot,
} from "../apps/api/src/marketing.ts";
import {
  testIntegration,
  validateIntegrationValues,
} from "../packages/providers/src/configuration.ts";
import { DEFAULT_FOLLOWER_MODEL } from "../packages/domain/src/marketing-calculators.ts";
import {
  PLATFORM,
  SECRET,
  call,
  coach,
  member,
  ok,
  type Harness,
} from "./discovery-fixtures.ts";

const TOKEN = "fixture-instagram-token-never-stored";
const calls: Array<{ url: string; init?: RequestInit }> = [];
const BUSINESS = {
  user_id: "1789",
  username: "layla.strength",
  account_type: "BUSINESS",
  followers_count: 5000,
  media_count: 240,
};
let profile: Record<string, unknown> = BUSINESS;
async function transport(url: string, init?: RequestInit) {
  calls.push({ url, init });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  if (url === "https://api.instagram.com/oauth/access_token") {
    const body = new URLSearchParams(String(init?.body));
    return body.get("code") === "good-code" &&
      body.get("client_secret") === "fixture-secret"
      ? json({ data: [{ access_token: TOKEN, user_id: "1789" }] })
      : json({ error: "invalid" }, 400);
  }
  const auth = new Headers(init?.headers).get("authorization");
  if (auth !== "Bearer " + TOKEN) return json({ error: "unauthorized" }, 401);
  if (url.startsWith("https://graph.instagram.com/me/media"))
    return json({
      data: [
        { like_count: 40, comments_count: 5 },
        { like_count: 30, comments_count: 5 },
      ],
    });
  if (url.startsWith("https://graph.instagram.com/me?")) return json(profile);
  return json({}, 404);
}

const env = {
  INSTAGRAM_APP_ID: "fixture-app",
  INSTAGRAM_APP_SECRET: "fixture-secret",
  INSTAGRAM_REDIRECT_URI: PLATFORM + "/api/v1/trainer/instagram/callback",
  INSTAGRAM_APP_REVIEW_APPROVED: "true",
  APP_NAME: "TrainsYou",
  PUBLIC_APP_URL: PLATFORM,
  INTERNAL_PROXY_SECRET: SECRET,
};
const saved: Record<string, string | undefined> = {};
let h: Harness;
before(async () => {
  for (const [key, value] of Object.entries(env)) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
  const db = await createDatabase({ memory: true });
  const app = await buildApp({
    db,
    testing: true,
    providers: { instagram: transport },
  });
  h = { db, app };
});
after(async () => {
  await h?.app.close();
  await h?.db.close();
  for (const [key, value] of Object.entries(saved))
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
});

test("the public platform endpoint gives the brand, availability and assumptions", async () => {
  const platform = await ok(h, "/public/platform");
  assert.equal(platform.name, "TrainsYou");
  assert.equal(platform.initials, "T");
  assert.equal(platform.registrationOpen, true);
  assert.equal(platform.coachAddressTemplate, PLATFORM + "/coach/{slug}");
  assert.equal(platform.availability.instagram, true);
  assert.equal(platform.availability.voice, false);
  assert.deepEqual(platform.followerModel, DEFAULT_FOLLOWER_MODEL);
  // Secrets never appear in the public answer.
  assert.doesNotMatch(JSON.stringify(platform), /fixture-secret|fixture-app/);
});

test("Connect Instagram: owner only, single-use state bound to the session, token never stored", async () => {
  const owner = await coach(h, "ig-owner", "Layla Strength");
  const staff = await member(h, owner.tenantId, "staff");
  assert.equal((await call(h, "/trainer/instagram", { cookie: staff.cookie })).statusCode, 403);
  assert.equal(
    (await call(h, "/trainer/instagram/authorize", { method: "POST", cookie: staff.cookie })).statusCode,
    403,
  );
  const empty = await ok(h, "/trainer/instagram", { cookie: owner.cookie });
  assert.equal(empty.available, true);
  assert.equal(empty.snapshot, null);

  const start = await ok(h, "/trainer/instagram/authorize", {
    method: "POST",
    cookie: owner.cookie,
  });
  const url = new URL(start.url);
  assert.equal(url.origin + url.pathname, "https://www.instagram.com/oauth/authorize");
  assert.equal(url.searchParams.get("scope"), "instagram_business_basic");
  assert.equal(url.searchParams.get("client_id"), "fixture-app");
  const state = url.searchParams.get("state")!;
  assert.ok(state.length >= 32);

  // Another browser (no session) cannot use the state.
  const stranger = await call(h, `/trainer/instagram/callback?state=${state}&code=good-code`);
  assert.equal(stranger.statusCode, 302);
  assert.equal(stranger.headers.location, "/trainer/growth?instagram=expired");

  const done = await call(h, `/trainer/instagram/callback?state=${state}&code=good-code`, {
    cookie: owner.cookie,
  });
  assert.equal(done.statusCode, 302);
  assert.equal(done.headers.location, "/trainer/growth?instagram=connected");
  const replay = await call(h, `/trainer/instagram/callback?state=${state}&code=good-code`, {
    cookie: owner.cookie,
  });
  assert.equal(replay.headers.location, "/trainer/growth?instagram=expired");

  const read = await ok(h, "/trainer/instagram", { cookie: owner.cookie });
  assert.equal(read.snapshot.username, "layla.strength");
  assert.equal(read.snapshot.followers, 5000);
  assert.equal(read.snapshot.engagementRatePct, 0.8);
  assert.equal(read.snapshot.postsSampled, 2);
  const stored = await h.db.system((tx) =>
    tx.query("SELECT data FROM records WHERE tenant_id=$1 AND kind LIKE 'instagram%'", [owner.tenantId]),
  );
  assert.equal(stored.length, 1);
  assert.doesNotMatch(JSON.stringify(stored), new RegExp(TOKEN));
  const events = await h.db.system((tx) =>
    tx.query("SELECT name,data FROM events WHERE tenant_id=$1 AND name LIKE 'instagram.%' ORDER BY created_at", [owner.tenantId]),
  );
  assert.deepEqual(events.map((e: any) => e.name), ["instagram.authorization_started", "instagram.snapshot_saved"]);
  assert.doesNotMatch(JSON.stringify(events), new RegExp(TOKEN));
  // The token was only ever sent to Instagram, as a header.
  assert.ok(calls.every((c) => !c.url.includes(TOKEN)));

  // A personal account shares no follower count.
  profile = { user_id: "1", username: "personal" };
  const second = new URL(
    (await ok(h, "/trainer/instagram/authorize", { method: "POST", cookie: owner.cookie })).url,
  ).searchParams.get("state");
  const personal = await call(h, `/trainer/instagram/callback?state=${second}&code=good-code`, {
    cookie: owner.cookie,
  });
  assert.equal(personal.headers.location, "/trainer/growth?instagram=professional_required");
  // A declined or failed authorization keeps the earlier numbers.
  assert.equal((await ok(h, "/trainer/instagram", { cookie: owner.cookie })).snapshot.followers, 5000);

  await ok(h, "/trainer/instagram", { method: "DELETE", cookie: owner.cookie });
  assert.equal((await ok(h, "/trainer/instagram", { cookie: owner.cookie })).snapshot, null);
});

test("Connect Instagram stays off until the Meta app is configured and approved", async () => {
  const owner = await coach(h, "ig-off");
  process.env.INSTAGRAM_APP_REVIEW_APPROVED = "false";
  try {
    assert.equal((await ok(h, "/public/platform")).availability.instagram, false);
    assert.equal((await ok(h, "/trainer/instagram", { cookie: owner.cookie })).available, false);
    const refused = await call(h, "/trainer/instagram/authorize", {
      method: "POST",
      cookie: owner.cookie,
    });
    assert.equal(refused.statusCode, 409);
    assert.equal(refused.json().code, "INSTAGRAM_UNAVAILABLE");
  } finally {
    process.env.INSTAGRAM_APP_REVIEW_APPROVED = "true";
  }
  const unapproved = await testIntegration("instagram", {
    INSTAGRAM_APP_ID: "a",
    INSTAGRAM_APP_SECRET: "b",
    INSTAGRAM_REDIRECT_URI: "https://app.example.test/api/v1/trainer/instagram/callback",
  });
  assert.equal(unapproved.status, "unavailable");
  const approved = await testIntegration("instagram", {
    INSTAGRAM_APP_ID: "a",
    INSTAGRAM_APP_SECRET: "b",
    INSTAGRAM_REDIRECT_URI: "https://app.example.test/api/v1/trainer/instagram/callback",
    INSTAGRAM_APP_REVIEW_APPROVED: "true",
  });
  assert.equal(approved.status, "validated");
});

test("the snapshot reader and authorize address need no stored token", async () => {
  profile = BUSINESS;
  const snap = await readInstagramSnapshot(
    { appId: "fixture-app", secret: "fixture-secret", redirect: "https://x.test/cb" },
    "good-code",
    transport,
    new Date("2026-09-28T08:00:00Z"),
  );
  assert.equal(snap.fetchedAt, "2026-09-28T08:00:00.000Z");
  assert.ok(!("token" in snap));
  await assert.rejects(
    readInstagramSnapshot(
      { appId: "fixture-app", secret: "fixture-secret", redirect: "https://x.test/cb" },
      "bad-code",
      transport,
    ),
    /refused/,
  );
  const url = new URL(instagramAuthorizeUrl({ appId: "1", redirect: "https://x.test/cb" }, "s"));
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("redirect_uri"), "https://x.test/cb");
});

test("marketing settings refuse percentages above 100 and an out-of-range scaling", () => {
  assert.deepEqual(
    validateIntegrationValues("marketing", { FOLLOWER_LINK_CLICK_HIGH: 4, FOLLOWER_MODEL_VERSION: "v2" }),
    { FOLLOWER_LINK_CLICK_HIGH: "4", FOLLOWER_MODEL_VERSION: "v2" },
  );
  assert.throws(() => validateIntegrationValues("marketing", { FOLLOWER_PURCHASE_HIGH: 101 }), /percentage/);
  assert.throws(() => validateIntegrationValues("marketing", { FOLLOWER_ENGAGEMENT_FACTOR_MAX: 20 }), /1 to 10/);
  assert.throws(() => validateIntegrationValues("marketing", { FOLLOWER_ENGAGEMENT_FACTOR_MAX: 0.5 }), /1 to 10/);
});

test("Share your link: an optional step after launch, saved by the owner", async () => {
  const owner = await coach(h, "share-step");
  const before = await ok(h, "/onboarding", { cookie: owner.cookie });
  const step = (s: any) => s.steps.find((x: any) => x.key === "share");
  assert.equal(before.steps.at(-1).key, "share");
  assert.equal(step(before).required, false);
  assert.equal(step(before).status, "blocked");
  assert.match(step(before).blocker, /Launch first/);
  assert.deepEqual(step(before).links, [{ label: "Followers and growth", href: "/trainer/growth" }]);
  // Optional: it never gates publishing.
  assert.ok(!before.gates.some((g: any) => g.key === "share"));
  const bad = await call(h, "/onboarding/share", {
    method: "PUT",
    cookie: owner.cookie,
    body: { version: 0, values: { channels: [] } },
  });
  assert.equal(bad.statusCode, 400);
  await ok(h, "/onboarding/share", {
    method: "PUT",
    cookie: owner.cookie,
    body: { version: 0, values: { channels: ["instagram_bio", "instagram_story"] } },
  });
  assert.notEqual(step(await ok(h, "/onboarding", { cookie: owner.cookie })).status, "complete");
  await h.db.system((tx) =>
    tx.query("UPDATE tenants SET published=true WHERE id=$1", [owner.tenantId]),
  );
  const after = await ok(h, "/onboarding", { cookie: owner.cookie });
  assert.equal(step(after).status, "complete");
  assert.deepEqual(step(after).values.channels, ["instagram_bio", "instagram_story"]);
});
