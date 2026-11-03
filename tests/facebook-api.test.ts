// Connect Facebook (apps/api/src/facebook.ts): a Facebook Page's numbers read
// once through Facebook Login for Business, every callback outcome, and the
// pre-approval test mode it shares with Connect Instagram (marketing.ts
// metaConnectAccess). PGlite; Graph calls go to a fixture transport.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { createDatabase } from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";
import {
  FACEBOOK_GRAPH_VERSION,
  FACEBOOK_RECORD_KINDS,
  facebookAuthorizeUrl,
  readFacebookSnapshot,
} from "../apps/api/src/facebook.ts";
import { platformAddressUpdates } from "../apps/api/src/host-operations.ts";
import { newToken, tokenHash } from "../apps/api/src/auth.ts";
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
  connectDomain,
  member,
  ok,
  type Coach,
  type Harness,
} from "./discovery-fixtures.ts";

const APP_ID = "1000000000000001",
  CONFIG_ID = "2000000000000002",
  APP_SECRET = "fixture-facebook-app-secret",
  REDIRECT = PLATFORM + "/api/v1/trainer/facebook/callback",
  USER_TOKEN = "fixture-facebook-user-token-never-stored";
const SETTINGS = {
  appId: APP_ID,
  secret: APP_SECRET,
  redirect: REDIRECT,
  configId: CONFIG_ID,
};

type Page = {
  id: string;
  name: string;
  tasks?: string[];
  access_token?: string;
  followers_count?: number;
  fan_count?: number;
};
const page = (
  id: string,
  name: string,
  followers: number,
  extra: Partial<Page> = {},
): Page => ({
  id,
  name,
  tasks: ["ANALYZE", "ADVERTISE", "MODERATE", "CREATE_CONTENT", "MANAGE"],
  access_token: `fixture-page-token-${id}`,
  followers_count: followers,
  fan_count: followers - 200,
  ...extra,
});
const LAYLA = page("1353269864728879", "Layla Strength Coaching", 12000);
const SIDE = page("2000000000000777", "Layla Recipes", 900);
// The most followers, but no MODERATE task: its numbers cannot be read.
const CLUB = page("3000000000000888", "Dubai Run Club", 50000, {
  tasks: ["ANALYZE"],
});
const POSTS = [
  {
    id: `${LAYLA.id}_1`,
    created_time: "2026-10-30T12:00:00+0000",
    shares: { count: 3 },
    reactions: { data: [], summary: { total_count: 41 } },
    comments: { data: [], summary: { order: "chronological", total_count: 7 } },
  },
  // Meta leaves shares out when a post has none.
  {
    id: `${LAYLA.id}_2`,
    created_time: "2026-10-28T12:00:00+0000",
    reactions: { data: [], summary: { total_count: 30 } },
    comments: { data: [], summary: { total_count: 5 } },
  },
];
// (41 + 7 + 3 + 30 + 5) / 2 posts / 12,000 followers × 100, to 3 decimals.
const LAYLA_RATE = 0.358;

type Scenario = {
  permissions: Array<{ permission: string; status: string }>;
  /** /me/accounts answers, one per paging request. */
  accounts: Page[][];
  /** GET /{page-id} answers by Page ID. */
  pages: Record<string, Record<string, unknown>>;
  /** published_posts data by Page ID. */
  posts: Record<string, unknown[]>;
  /** One call answers with this Graph error. */
  fail?: { path: RegExp; code: number; subcode?: number };
};
const defaults = (): Scenario => ({
  permissions: [
    { permission: "pages_show_list", status: "granted" },
    { permission: "pages_read_engagement", status: "granted" },
    { permission: "public_profile", status: "granted" },
  ],
  accounts: [[SIDE, CLUB], [LAYLA]],
  pages: {},
  posts: { [LAYLA.id]: POSTS, [SIDE.id]: [] },
});
let scenario = defaults();
/** The exchange must send exactly the redirect URI the dialog used. */
let redirectUri = REDIRECT;
const calls: Array<{ url: string; authorization: string | null }> = [];
const proof = (token: string) =>
  createHmac("sha256", APP_SECRET).update(token).digest("hex");
async function transport(input: string, init?: RequestInit) {
  const authorization = new Headers(init?.headers).get("authorization");
  calls.push({ url: input, authorization });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  const graphError = (code: number, subcode?: number) =>
    json(
      {
        error: {
          message: "Synthetic Meta message",
          type: "OAuthException",
          code,
          ...(subcode ? { error_subcode: subcode } : {}),
          fbtrace_id: "AFixtureTrace1",
        },
      },
      400,
    );
  const base = `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}`;
  if (!input.startsWith(base + "/")) return json({}, 404);
  const url = new URL(input);
  const path = url.pathname.slice(FACEBOOK_GRAPH_VERSION.length + 1);
  if (scenario.fail?.path.test(path))
    return graphError(scenario.fail.code, scenario.fail.subcode);
  if (path === "/oauth/access_token") {
    const q = url.searchParams;
    return q.get("code") === "good-code" &&
      q.get("client_id") === APP_ID &&
      q.get("client_secret") === APP_SECRET &&
      q.get("redirect_uri") === redirectUri &&
      !authorization
      ? json({
          access_token: USER_TOKEN,
          token_type: "bearer",
          expires_in: 5400,
        })
      : graphError(100, 36009);
  }
  // Every other call: the token only in the header, signed with its proof.
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";
  if (!token || url.searchParams.get("appsecret_proof") !== proof(token))
    return graphError(100);
  if (path === "/me/permissions" || path === "/me/accounts") {
    if (token !== USER_TOKEN) return graphError(190, 463);
    if (path === "/me/permissions") return json({ data: scenario.permissions });
    assert.equal(
      url.searchParams.get("fields"),
      "id,name,tasks,access_token,followers_count,fan_count",
    );
    const index = Number(url.searchParams.get("after")?.slice(7) ?? 0);
    const more = index + 1 < scenario.accounts.length;
    return json({
      data: scenario.accounts[index] ?? [],
      paging: {
        cursors: { before: "cursor-b", after: `cursor-${index + 1}` },
        // Meta's next link carries the token: the reader must not follow it.
        ...(more
          ? {
              next: `${base}/me/accounts?access_token=${USER_TOKEN}&limit=25&after=cursor-${index + 1}`,
            }
          : {}),
      },
    });
  }
  const [, id, edge] = path.match(/^\/(\d+)(\/published_posts)?$/) ?? [];
  if (!id || token !== `fixture-page-token-${id}`) return graphError(190);
  if (edge) return json({ data: scenario.posts[id] ?? [], paging: {} });
  return json({ id, ...scenario.pages[id] });
}

const FACEBOOK_ENV = {
  FACEBOOK_APP_ID: APP_ID,
  FACEBOOK_APP_SECRET: APP_SECRET,
  FACEBOOK_REDIRECT_URI: REDIRECT,
  FACEBOOK_LOGIN_CONFIG_ID: CONFIG_ID,
  FACEBOOK_APP_REVIEW_APPROVED: "true",
  FACEBOOK_TEST_WORKSPACES: undefined,
};
const env: Record<string, string | undefined> = {
  ...FACEBOOK_ENV,
  PUBLIC_APP_URL: PLATFORM,
  INTERNAL_PROXY_SECRET: SECRET,
  SECURITY_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
};
function setEnv(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values))
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
}
/** Runs with these variables, then puts the earlier values back. */
async function withEnv(
  values: Record<string, string | undefined>,
  fn: () => Promise<void>,
) {
  const earlier = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );
  setEnv(values);
  try {
    await fn();
  } finally {
    setEnv(earlier);
  }
}
const saved: Record<string, string | undefined> = {};
let h: Harness;
before(async () => {
  for (const key of Object.keys(env)) saved[key] = process.env[key];
  setEnv(env);
  const db = await createDatabase({ memory: true });
  const app = await buildApp({
    db,
    testing: true,
    providers: { facebook: transport },
  });
  h = { db, app };
});
after(async () => {
  await h?.app.close();
  await h?.db.close();
  setEnv(saved);
});

const actor = (c: Coach) =>
  ({ tenantId: c.tenantId, userId: c.userId, role: "owner" }) as any;
/** Starts a connection as this owner; the state from the dialog address. */
async function authorize(cookie: string) {
  const start = await ok(h, "/trainer/facebook/authorize", {
    method: "POST",
    cookie,
  });
  return new URL(start.url).searchParams.get("state")!;
}
const callback = (query: string, cookie?: string) =>
  call(h, "/trainer/facebook/callback?" + query, cookie ? { cookie } : {});
const growth = (outcome: string) => "/trainer/growth?facebook=" + outcome;
/** Another live session of the same owner (another browser). */
async function otherSession(c: Coach) {
  const token = newToken();
  await h.db.system((tx) =>
    tx.query(
      "INSERT INTO sessions(token_hash,user_id,tenant_id,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
      [tokenHash(token), c.userId, c.tenantId],
    ),
  );
  return "session=" + token;
}

test("Connect Facebook: owner only, platform address only, single-use state bound to the session, no token kept", async () => {
  const owner = await coach(h, "fb-owner", "Layla Strength");
  const staff = await member(h, owner.tenantId, "staff");
  for (const [path, method] of [
    ["/trainer/facebook", "GET"],
    ["/trainer/facebook/authorize", "POST"],
    ["/trainer/facebook", "DELETE"],
  ])
    assert.equal(
      (await call(h, path, { method, cookie: staff.cookie })).statusCode,
      403,
      `${method} ${path}`,
    );
  const empty = await ok(h, "/trainer/facebook", { cookie: owner.cookie });
  assert.deepEqual(
    {
      available: empty.available,
      testing: empty.testing,
      snapshot: empty.snapshot,
    },
    { available: true, testing: false, snapshot: null },
  );
  assert.deepEqual(empty.followerModel, DEFAULT_FOLLOWER_MODEL);

  // Never from the coach's own domain: one callback address on the platform.
  await h.db.system((tx) =>
    tx.query("UPDATE tenants SET published=true WHERE id=$1", [owner.tenantId]),
  );
  await connectDomain(h, owner, "layla-strength.example");
  const custom = await call(h, "/trainer/facebook/authorize", {
    method: "POST",
    cookie: owner.cookie,
    host: "layla-strength.example",
  });
  assert.equal(custom.statusCode, 403);
  assert.equal(custom.json().code, "PLATFORM_HOST_REQUIRED");

  // The dialog: Facebook Login for Business, the configuration and no scope.
  const start = await ok(h, "/trainer/facebook/authorize", {
    method: "POST",
    cookie: owner.cookie,
  });
  const dialog = new URL(start.url);
  assert.equal(
    dialog.origin + dialog.pathname,
    "https://www.facebook.com/v26.0/dialog/oauth",
  );
  const bound = dialog.searchParams.get("state")!;
  assert.ok(bound.length >= 32);
  assert.deepEqual(
    Object.fromEntries([...dialog.searchParams].filter(([k]) => k !== "state")),
    {
      client_id: APP_ID,
      redirect_uri: REDIRECT,
      response_type: "code",
      config_id: CONFIG_ID,
      override_default_response_type: "true",
    },
  );
  calls.length = 0;
  // Without a session (another browser) the state cannot be used.
  const stranger = await callback(`state=${bound}&code=good-code`);
  assert.equal(stranger.statusCode, 302);
  assert.equal(stranger.headers.location, growth("expired"));
  // Another session of the same owner cannot use it either, and that
  // attempt uses it up.
  const other = await otherSession(owner);
  assert.equal(
    (await callback(`state=${bound}&code=good-code`, other)).headers.location,
    growth("expired"),
  );
  assert.equal(
    (await callback(`state=${bound}&code=good-code`, owner.cookie)).headers
      .location,
    growth("expired"),
  );
  // A state older than ten minutes has expired.
  const late = await authorize(owner.cookie);
  await h.db.tenant(actor(owner), (tx) =>
    tx.query(
      "UPDATE records SET data=jsonb_set(data,'{expiresAt}',to_jsonb($1::text)) WHERE kind='facebook_oauth_state'",
      [new Date(Date.now() - 1000).toISOString()],
    ),
  );
  assert.equal(
    (await callback(`state=${late}&code=good-code`, owner.cookie)).headers
      .location,
    growth("expired"),
  );
  assert.equal(calls.length, 0, "Facebook was never called for a bad state");

  const state = await authorize(owner.cookie);
  const done = await callback(`state=${state}&code=good-code`, owner.cookie);
  assert.equal(done.statusCode, 302);
  assert.equal(done.headers.location, growth("connected"));
  assert.equal(done.headers["cache-control"], "no-store");
  assert.equal(done.headers["referrer-policy"], "no-referrer");
  const replay = await callback(`state=${state}&code=good-code`, owner.cookie);
  assert.equal(replay.headers.location, growth("expired"));

  // The usable Page with the most followers; the Run Club (no MODERATE task)
  // is passed over although it is bigger.
  const read = await ok(h, "/trainer/facebook", { cookie: owner.cookie });
  assert.deepEqual(
    { ...read.snapshot, fetchedAt: undefined },
    {
      pageName: "Layla Strength Coaching",
      followers: 12000,
      pageLikes: 11800,
      engagementRatePct: LAYLA_RATE,
      postsSampled: 2,
      pagesShared: 3,
      fetchedAt: undefined,
    },
  );
  assert.ok(Date.parse(read.snapshot.fetchedAt) > Date.now() - 60000);

  // Only the numbers are stored: no token, Page ID or user ID.
  const secrets = [
    USER_TOKEN,
    "fixture-page-token",
    LAYLA.id,
    SIDE.id,
    CLUB.id,
  ];
  const stored = await h.db.tenant(actor(owner), (tx) =>
    tx.query("SELECT kind,data FROM records WHERE kind=ANY($1::text[])", [
      [...FACEBOOK_RECORD_KINDS],
    ]),
  );
  assert.deepEqual(
    stored.map((r: any) => r.kind),
    ["facebook_snapshot"],
  );
  const events = await h.db.tenant(actor(owner), (tx) =>
    tx.query(
      "SELECT name,data FROM events WHERE tenant_id=$1 AND name LIKE 'facebook.%' ORDER BY created_at",
      [owner.tenantId],
    ),
  );
  assert.deepEqual(
    [...new Set(events.map((e: any) => e.name))],
    ["facebook.authorization_started", "facebook.snapshot_saved"],
  );
  // The event carries no numbers: they live in the record alone, so removing
  // it (or closing the workspace) deletes every copy, as the public deletion
  // instructions promise.
  assert.deepEqual(events.at(-1)!.data, {});
  for (const value of secrets) {
    assert.ok(!JSON.stringify(stored).includes(value), value);
    assert.ok(!JSON.stringify(events).includes(value), value);
  }
  // Tokens went to Facebook only as headers, never in an address; the next
  // link (which carries the token) was not followed.
  assert.ok(
    calls.every(
      (c) =>
        !c.url.includes(USER_TOKEN) && !c.url.includes("fixture-page-token"),
    ),
  );
  assert.ok(
    calls
      .filter((c) => !c.url.includes("/oauth/access_token"))
      .every((c) => /^Bearer fixture-/.test(c.authorization ?? "")),
  );

  await ok(h, "/trainer/facebook", { method: "DELETE", cookie: owner.cookie });
  assert.equal(
    (await ok(h, "/trainer/facebook", { cookie: owner.cookie })).snapshot,
    null,
  );
  const removed = await h.db.tenant(actor(owner), (tx) =>
    tx.query(
      "SELECT name,data FROM events WHERE tenant_id=$1 AND name='facebook.snapshot_removed'",
      [owner.tenantId],
    ),
  );
  assert.deepEqual(
    removed.map((e: any) => e.data),
    [{}],
  );
});

test("every unsuccessful outcome keeps the earlier numbers", async () => {
  const owner = await coach(h, "fb-outcomes");
  const state = await authorize(owner.cookie);
  assert.equal(
    (await callback(`state=${state}&code=good-code`, owner.cookie)).headers
      .location,
    growth("connected"),
  );
  const snapshot = async () =>
    (await ok(h, "/trainer/facebook", { cookie: owner.cookie })).snapshot;
  const first = await snapshot();
  const attempt = async (
    change: Partial<Scenario>,
    query = "code=good-code",
  ) => {
    scenario = { ...defaults(), ...change };
    try {
      const started = await authorize(owner.cookie);
      return (await callback(`state=${started}&${query}`, owner.cookie)).headers
        .location;
    } finally {
      scenario = defaults();
    }
  };
  // Cancelled in the dialog, with or without the state.
  assert.equal(
    await attempt(
      {},
      "error=access_denied&error_reason=user_denied&error_description=Permissions+error",
    ),
    growth("declined"),
  );
  assert.equal(
    (
      await callback(
        "error=access_denied&error_reason=user_denied",
        owner.cookie,
      )
    ).headers.location,
    growth("declined"),
  );
  assert.equal(
    await attempt({
      permissions: [
        { permission: "pages_show_list", status: "granted" },
        { permission: "pages_read_engagement", status: "declined" },
      ],
    }),
    growth("permissions_required"),
  );
  assert.equal(await attempt({ accounts: [[]] }), growth("no_page"));
  assert.equal(
    await attempt({
      accounts: [[CLUB, { ...SIDE, access_token: undefined }]],
    }),
    growth("page_access_required"),
  );
  assert.equal(
    await attempt({ fail: { path: /^\/me\/accounts$/, code: 4 } }),
    growth("busy"),
  );
  // The access ran out part-way: connect again.
  assert.equal(
    await attempt({
      fail: { path: /^\/me\/permissions$/, code: 190, subcode: 460 },
    }),
    growth("expired"),
  );
  assert.equal(await attempt({}, "code=used-code"), growth("failed"));
  assert.deepEqual(await snapshot(), first);
});

test("the snapshot reader: one dialog address, Bearer headers with appsecret_proof, at most two Page lists", async () => {
  const url = new URL(
    facebookAuthorizeUrl(
      { appId: "1", redirect: "https://x.test/cb", configId: "2" },
      "s",
    ),
  );
  assert.equal(
    url.origin + url.pathname,
    `https://www.facebook.com/${FACEBOOK_GRAPH_VERSION}/dialog/oauth`,
  );
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    client_id: "1",
    redirect_uri: "https://x.test/cb",
    state: "s",
    response_type: "code",
    config_id: "2",
    override_default_response_type: "true",
  });

  scenario = defaults();
  calls.length = 0;
  const snap = await readFacebookSnapshot(
    SETTINGS,
    "good-code",
    transport,
    new Date("2026-11-03T08:00:00Z"),
  );
  assert.deepEqual(snap, {
    pageName: "Layla Strength Coaching",
    followers: 12000,
    pageLikes: 11800,
    engagementRatePct: LAYLA_RATE,
    postsSampled: 2,
    pagesShared: 3,
    fetchedAt: "2026-11-03T08:00:00.000Z",
  });
  const v = `/${FACEBOOK_GRAPH_VERSION}`;
  assert.deepEqual(
    calls.map((c) => new URL(c.url).pathname),
    [
      `${v}/oauth/access_token`,
      `${v}/me/permissions`,
      `${v}/me/accounts`,
      `${v}/me/accounts`,
      `${v}/${LAYLA.id}/published_posts`,
    ],
  );
  const [exchange, , , second, posts] = calls.map((c) => new URL(c.url));
  assert.equal(calls[0].authorization, null);
  assert.equal(exchange.searchParams.get("appsecret_proof"), null);
  assert.equal(second.searchParams.get("after"), "cursor-1");
  assert.equal(
    posts.searchParams.get("fields"),
    "id,created_time,shares,reactions.limit(0).summary(total_count),comments.limit(0).summary(true)",
  );
  assert.equal(posts.searchParams.get("limit"), "12");
  // The Page's own token for its posts, signed with its own proof.
  assert.equal(calls[4].authorization, `Bearer fixture-page-token-${LAYLA.id}`);
  assert.equal(
    posts.searchParams.get("appsecret_proof"),
    proof(`fixture-page-token-${LAYLA.id}`),
  );
  assert.ok(!("token" in snap));

  // A third list page is never asked for: Layla's Page is not reached.
  scenario = { ...defaults(), accounts: [[SIDE], [CLUB], [LAYLA]] };
  calls.length = 0;
  const capped = await readFacebookSnapshot(SETTINGS, "good-code", transport);
  assert.equal(capped.pageName, "Layla Recipes");
  assert.equal(capped.pagesShared, 2);
  assert.equal(calls.filter((c) => c.url.includes("/me/accounts")).length, 2);
  scenario = defaults();
});

test("followers come from the list, then the Page itself, then Page likes; no posts leave engagement unknown", async () => {
  const read = async (change: Partial<Scenario>) => {
    scenario = { ...defaults(), ...change };
    try {
      return await readFacebookSnapshot(SETTINGS, "good-code", transport);
    } finally {
      scenario = defaults();
    }
  };
  const bare = { ...LAYLA, followers_count: undefined, fan_count: undefined };
  // The list left the count out: the Page is asked with its own token.
  let snap = await read({
    accounts: [[bare]],
    pages: { [LAYLA.id]: { followers_count: 12500, fan_count: 12400 } },
  });
  assert.deepEqual([snap.followers, snap.pageLikes], [12500, 12400]);
  // No follower count anywhere: Page likes stand in.
  snap = await read({
    accounts: [[{ ...LAYLA, followers_count: undefined }]],
    pages: { [LAYLA.id]: { fan_count: 11800 } },
  });
  assert.deepEqual([snap.followers, snap.pageLikes], [11800, 11800]);
  // Neither: the read fails (the callback says failed).
  await assert.rejects(read({ accounts: [[bare]] }), {
    code: "FACEBOOK_UNAVAILABLE",
  });
  // No recent posts: engagement unknown, not zero.
  snap = await read({ posts: { [LAYLA.id]: [] } });
  assert.deepEqual([snap.engagementRatePct, snap.postsSampled], [null, 0]);
  // A post without totals is left out of the sample.
  snap = await read({ posts: { [LAYLA.id]: [POSTS[0], { id: "x_3" }] } });
  assert.deepEqual([snap.engagementRatePct, snap.postsSampled], [0.425, 1]);
  // Zero followers is a valid count; the rate is then unknown.
  snap = await read({
    accounts: [[{ ...LAYLA, followers_count: 0, fan_count: 0 }]],
  });
  assert.deepEqual([snap.followers, snap.engagementRatePct], [0, null]);
  // A long Page name is cut to 60 characters, emoji intact.
  snap = await read({
    accounts: [[{ ...LAYLA, name: "💪".repeat(70) }]],
  });
  assert.equal(snap.pageName, "💪".repeat(60));
});

test("Graph errors map to the internal codes the callback turns into outcomes", async () => {
  const code = async (change: Partial<Scenario>, oneTimeCode = "good-code") => {
    scenario = { ...defaults(), ...change };
    try {
      await readFacebookSnapshot(SETTINGS, oneTimeCode, transport);
      return "read";
    } catch (error) {
      return (error as any).code;
    } finally {
      scenario = defaults();
    }
  };
  const fail = (path: RegExp, errorCode: number, subcode?: number) => ({
    fail: { path, code: errorCode, subcode },
  });
  assert.equal(await code({}, "used-code"), "FACEBOOK_UNAVAILABLE");
  assert.equal(await code(fail(/^\/oauth/, 4)), "FACEBOOK_BUSY");
  for (const limit of [17, 32, 341, 613])
    assert.equal(await code(fail(/^\/me\/accounts$/, limit)), "FACEBOOK_BUSY");
  assert.equal(await code(fail(/\/published_posts$/, 80001)), "FACEBOOK_BUSY");
  assert.equal(
    await code(fail(/^\/me\/accounts$/, 10)),
    "FACEBOOK_PERMISSIONS",
  );
  assert.equal(
    await code(fail(/^\/me\/permissions$/, 102)),
    "FACEBOOK_EXPIRED",
  );
  // A checkpointed account must be fixed on facebook.com first.
  assert.equal(
    await code(fail(/^\/me\/accounts$/, 190, 459)),
    "FACEBOOK_UNAVAILABLE",
  );
  assert.equal(
    await code(fail(/\/published_posts$/, 200)),
    "FACEBOOK_PAGE_ACCESS",
  );
  assert.equal(
    await code(fail(/\/published_posts$/, 100, 492)),
    "FACEBOOK_PAGE_ACCESS",
  );
  // No suitable Page role (492) usually arrives with 190 or 102; connecting
  // again cannot fix it, so it is never "expired".
  assert.equal(
    await code(fail(/\/published_posts$/, 190, 492)),
    "FACEBOOK_PAGE_ACCESS",
  );
  assert.equal(
    await code(fail(/\/published_posts$/, 102, 492)),
    "FACEBOOK_PAGE_ACCESS",
  );
  // On the person's own token it is a permissions problem.
  assert.equal(
    await code(fail(/^\/me\/accounts$/, 190, 492)),
    "FACEBOOK_PERMISSIONS",
  );
  assert.equal(
    await code(fail(/\/published_posts$/, 190, 460)),
    "FACEBOOK_EXPIRED",
  );
  assert.equal(
    await code(fail(/\/published_posts$/, 368)),
    "FACEBOOK_UNAVAILABLE",
  );
  assert.equal(
    await code({
      permissions: [{ permission: "pages_show_list", status: "granted" }],
    }),
    "FACEBOOK_PERMISSIONS",
  );
  assert.equal(await code({ accounts: [[]] }), "FACEBOOK_NO_PAGE");
  // An ID that is not a Graph number is never put into an address.
  assert.equal(
    await code({ accounts: [[{ ...LAYLA, id: "../me" }]] }),
    "FACEBOOK_PAGE_ACCESS",
  );
});

test("before app review only the listed coach addresses may connect; public pages still say soon", async () => {
  const listed = await coach(h, "fb-tester");
  const unlisted = await coach(h, "fb-unlisted");
  const access = async (c: Coach) => {
    const { available, testing } = await ok(h, "/trainer/facebook", {
      cookie: c.cookie,
    });
    return { available, testing };
  };
  const off = { available: false, testing: false };
  await withEnv(
    {
      FACEBOOK_APP_REVIEW_APPROVED: "false",
      FACEBOOK_TEST_WORKSPACES: "someone-else, FB-Tester",
    },
    async () => {
      assert.equal(
        (await ok(h, "/public/platform")).availability.facebook,
        false,
      );
      assert.deepEqual(await access(unlisted), off);
      const refused = await call(h, "/trainer/facebook/authorize", {
        method: "POST",
        cookie: unlisted.cookie,
      });
      assert.equal(refused.statusCode, 409);
      assert.equal(refused.json().code, "FACEBOOK_UNAVAILABLE");

      assert.deepEqual(await access(listed), {
        available: true,
        testing: true,
      });
      const state = await authorize(listed.cookie);
      assert.equal(
        (await callback(`state=${state}&code=good-code`, listed.cookie)).headers
          .location,
        growth("connected"),
      );
      // The callback asks again: taken off the list in between, refused.
      const second = await authorize(listed.cookie);
      process.env.FACEBOOK_TEST_WORKSPACES = "someone-else";
      assert.equal(
        (await callback(`state=${second}&code=good-code`, listed.cookie))
          .headers.location,
        growth("unavailable"),
      );
      assert.deepEqual(await access(listed), off);
      // Nothing listed and nothing approved: off for everyone.
      delete process.env.FACEBOOK_TEST_WORKSPACES;
      assert.deepEqual(await access(listed), off);
      // Not configured: a listed workspace cannot connect either.
      process.env.FACEBOOK_TEST_WORKSPACES = "fb-tester";
      delete process.env.FACEBOOK_LOGIN_CONFIG_ID;
      assert.deepEqual(await access(listed), off);
      process.env.FACEBOOK_LOGIN_CONFIG_ID = CONFIG_ID;
      assert.deepEqual(await access(listed), {
        available: true,
        testing: true,
      });

      // Approval opens it to every workspace, no longer as a test.
      process.env.FACEBOOK_APP_REVIEW_APPROVED = "true";
      assert.deepEqual(await access(unlisted), {
        available: true,
        testing: false,
      });
      assert.deepEqual(await access(listed), {
        available: true,
        testing: false,
      });
      assert.equal(
        (await ok(h, "/public/platform")).availability.facebook,
        true,
      );
    },
  );
  // The numbers from the test connection stay.
  assert.equal(
    (await ok(h, "/trainer/facebook", { cookie: listed.cookie })).snapshot
      .followers,
    12000,
  );
});

test("Facebook settings: the connection check, field rules and the platform address list", async () => {
  const base = {
    FACEBOOK_APP_ID: APP_ID,
    FACEBOOK_APP_SECRET: "b",
    FACEBOOK_REDIRECT_URI:
      "https://app.example.test/api/v1/trainer/facebook/callback",
    FACEBOOK_LOGIN_CONFIG_ID: CONFIG_ID,
  };
  const unapproved = await testIntegration("facebook", base);
  assert.equal(unapproved.status, "unavailable");
  const testing = await testIntegration("facebook", {
    ...base,
    FACEBOOK_TEST_WORKSPACES: "layla-strength",
  });
  assert.equal(testing.status, "validated");
  assert.match(testing.message, /only the listed coach addresses can connect/);
  // No public page mentions connecting Facebook before approval.
  assert.match(testing.message, /Public pages make no availability claim until approval\.$/);
  assert.doesNotMatch(testing.message, /available soon/i);
  const approved = await testIntegration("facebook", {
    ...base,
    FACEBOOK_APP_REVIEW_APPROVED: "true",
  });
  assert.equal(approved.status, "validated");
  assert.doesNotMatch(approved.message, /listed coach addresses/);
  const missing = await testIntegration("facebook", {
    ...base,
    FACEBOOK_LOGIN_CONFIG_ID: "",
    FACEBOOK_APP_REVIEW_APPROVED: "true",
  });
  assert.equal(missing.status, "failed");
  assert.match(missing.message, /Facebook Login for Business configuration ID/);
  const malformed = await testIntegration("facebook", {
    ...base,
    FACEBOOK_TEST_WORKSPACES: "layla strength!",
  });
  assert.equal(malformed.status, "failed");
  assert.match(malformed.message, /comma-separated coach addresses/);

  assert.deepEqual(
    validateIntegrationValues("facebook", {
      FACEBOOK_APP_ID: APP_ID,
      FACEBOOK_TEST_WORKSPACES: " layla-strength , fb-tester ",
    }),
    {
      FACEBOOK_APP_ID: APP_ID,
      FACEBOOK_TEST_WORKSPACES: "layla-strength , fb-tester",
    },
  );
  // A pasted secret or address is not a Meta App ID or configuration ID.
  for (const values of [
    { FACEBOOK_APP_ID: "fixture-secret" },
    { FACEBOOK_LOGIN_CONFIG_ID: "https://developers.facebook.com" },
  ])
    assert.throws(
      () => validateIntegrationValues("facebook", values),
      /number shown in the Meta App Dashboard/,
    );
  assert.throws(
    () =>
      validateIntegrationValues("instagram", {
        INSTAGRAM_TEST_WORKSPACES: Array.from(
          { length: 51 },
          (_, i) => `coach-${i}`,
        ).join(","),
      }),
    /up to 50/,
  );

  assert.deepEqual(
    [...FACEBOOK_RECORD_KINDS],
    ["facebook_oauth_state", "facebook_snapshot"],
  );
  const address = platformAddressUpdates(
    "https://trainsyou.com",
    "trainsyou.com",
  ).find((u) => u.name === "Facebook redirect URI");
  assert.equal(
    address?.value,
    "https://trainsyou.com/api/v1/trainer/facebook/callback",
  );
  assert.match(
    address!.where,
    /Facebook Login for Business → Settings → Valid OAuth Redirect URIs/,
  );
  assert.match(
    address!.where,
    /Facebook Pages \(follower estimates\) → Redirect URI/,
  );
});

/** A Super admin with a fresh authenticator check, in their own workspace. */
async function superAdmin() {
  const userId = randomUUID(),
    tenantId = randomUUID(),
    token = newToken();
  await h.db.system(async (tx) => {
    await tx.query(
      "INSERT INTO tenants(id,slug,name) VALUES($1,$2,'Platform ops')",
      [tenantId, "ops-" + tenantId.slice(0, 8)],
    );
    await tx.query(
      "INSERT INTO users(id,name,email,password_hash,email_verified,platform_role) VALUES($1,'Operator',$2,'synthetic',true,'admin')",
      [userId, userId + "@ops.test"],
    );
    await tx.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')",
      [tenantId, userId],
    );
    await tx.query(
      "INSERT INTO sessions(token_hash,user_id,tenant_id,expires_at,mfa_at) VALUES($1,$2,$3,now()+interval '7 days',now())",
      [tokenHash(token), userId, tenantId],
    );
  });
  return "session=" + token;
}

// Last: it saves Super admin settings, which apply over the environment.
test("saved Super admin settings activate for the listed workspaces before review, without a public claim", async () => {
  const cookie = await superAdmin();
  const owner = await coach(h, "fb-settings");
  // Saved settings take public HTTPS addresses only.
  redirectUri = "https://app.example.test/api/v1/trainer/facebook/callback";
  const values = {
    FACEBOOK_APP_ID: APP_ID,
    FACEBOOK_REDIRECT_URI: redirectUri,
    FACEBOOK_LOGIN_CONFIG_ID: CONFIG_ID,
    FACEBOOK_APP_REVIEW_APPROVED: "false",
  };
  const blank = Object.fromEntries(
    Object.keys(FACEBOOK_ENV).map((key) => [key, undefined]),
  );
  // Only the saved settings count: nothing comes from the environment.
  await withEnv(blank, async () => {
    try {
      const listing = await ok(h, "/admin/settings", { cookie });
      const facebook = listing.integrations.find(
        (i: any) => i.id === "facebook",
      );
      assert.equal(facebook.name, "Facebook Pages (follower estimates)");
      assert.equal(facebook.category, "marketing");
      let revision = facebook.revision;
      const save = async (extra: Record<string, string>) => {
        const r = await call(h, "/admin/settings/facebook", {
          method: "PUT",
          cookie,
          body: {
            revision,
            enabled: true,
            values: { ...values, ...extra },
            secrets: { FACEBOOK_APP_SECRET: APP_SECRET },
          },
        });
        if (r.statusCode === 200) revision = r.json().revision;
        return r;
      };
      const check = async () => {
        const r = await call(h, "/admin/settings/facebook/test", {
          method: "POST",
          cookie,
          body: { revision },
        });
        assert.equal(r.statusCode, 200, r.body);
        return r.json();
      };
      // Before review, with no coach address listed, the check stops.
      const first = await save({});
      assert.equal(first.statusCode, 200, first.body);
      let tested = await check();
      assert.deepEqual(
        [tested.lastTest.status, tested.active],
        ["unavailable", false],
      );
      assert.equal(
        (await ok(h, "/trainer/facebook", { cookie: owner.cookie })).available,
        false,
      );
      // Listing the coach address activates the saved values for it alone.
      assert.equal(
        (await save({ FACEBOOK_TEST_WORKSPACES: "fb-settings" })).statusCode,
        200,
      );
      tested = await check();
      assert.deepEqual(
        [tested.lastTest.status, tested.active],
        ["validated", true],
      );
      const access = await ok(h, "/trainer/facebook", { cookie: owner.cookie });
      assert.deepEqual([access.available, access.testing], [true, true]);
      assert.equal(
        (await ok(h, "/public/platform")).availability.facebook,
        false,
      );
      const state = await authorize(owner.cookie);
      assert.equal(
        (await callback(`state=${state}&code=good-code`, owner.cookie)).headers
          .location,
        growth("connected"),
      );
      // A malformed list is refused when saved.
      const bad = await save({ FACEBOOK_TEST_WORKSPACES: "not a slug!" });
      assert.equal(bad.statusCode, 400, bad.body);
    } finally {
      redirectUri = REDIRECT;
      await h.db.system((tx) =>
        tx.query(
          "DELETE FROM platform_settings WHERE integration_id='facebook'",
        ),
      );
    }
  });
});
