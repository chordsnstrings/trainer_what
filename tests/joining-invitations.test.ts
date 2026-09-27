import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, type Database } from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";
import { executeEmailDelivery } from "../apps/worker/src/email-delivery.ts";
import {
  invitationStatus,
  joiningLimits,
  messageDate,
} from "../apps/api/src/joining.ts";
import { validateIntegrationValues } from "../packages/providers/src/configuration.ts";

// Synthetic email settings only: nothing is sent. Delivery below uses an
// in-memory sender passed to the worker function.
process.env.EMAIL_API_URL = "https://email.invalid/send";
process.env.EMAIL_API_KEY = "fixture-only";
process.env.EMAIL_FROM = "coach@example.test";

let db: Database, app: Awaited<ReturnType<typeof buildApp>>;
let coach: any, second: any;
const password = "JoiningFixture2026!";
async function request(
  url: string,
  method: any = "GET",
  body?: any,
  who?: any,
) {
  return app.inject({
    url: "/api/v1" + url,
    method,
    headers: {
      origin: "http://localhost:3000",
      ...(who ? { cookie: who.cookie } : {}),
    },
    payload: body,
  });
}
const cookieOf = (r: any) => String(r.headers["set-cookie"]).split(";")[0];
async function whoami(cookie: string) {
  const boot = await request("/bootstrap", "GET", undefined, { cookie });
  assert.equal(boot.statusCode, 200, boot.body);
  return { ...boot.json().user, cookie };
}
async function register(slug: string) {
  const r = await request("/auth/register", "POST", {
    name: "Coach " + slug,
    email: slug + "@example.test",
    password,
    slug,
    accepted: true,
  });
  assert.equal(r.statusCode, 201, r.body);
  return whoami(cookieOf(r));
}
async function invite(who: any, email: string, sendEmail?: boolean) {
  const r = await request(
    "/invitations",
    "POST",
    {
      email,
      role: "subscriber",
      ...(sendEmail === undefined ? {} : { sendEmail }),
    },
    who,
  );
  return r;
}
const tokenOf = (url: string) => url.split("/").pop()!;
async function list(who: any) {
  const r = await request("/invitations/followers", "GET", undefined, who);
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}
async function jobsFor(who: any, invitationId: string) {
  return db.tenant({ ...who, role: "owner" }, (tx) =>
    tx.query(
      "SELECT * FROM jobs WHERE kind='email' AND data->>'invitationId'=$1 ORDER BY (data->>'send')::int",
      [invitationId],
    ),
  );
}
async function claim(who: any, jobId: string) {
  // Simulate the worker's lease on one specific job.
  const [job] = await db.tenant({ ...who, role: "staff" }, (tx) =>
    tx.query(
      "UPDATE jobs SET leased_until=now()+interval '2 minutes',attempts=attempts+1 WHERE id=$1 RETURNING *",
      [jobId],
    ),
  );
  return job;
}
async function accept(token: string, email: string, extra: any = {}) {
  return request("/invitations/accept", "POST", {
    token,
    name: "Joining Follower",
    email,
    password,
    accepted: true,
    ...extra,
  });
}
before(async () => {
  db = await createDatabase({ memory: true });
  app = await buildApp({ db, testing: true });
  coach = await register("join-coach");
  second = await register("join-second");
});
after(async () => {
  await app.close();
  await db.close();
});

test("a copy-link invitation works without email and is listed as pending", async () => {
  const r = await invite(coach, "Copy.Link@Example.test");
  assert.equal(r.statusCode, 200, r.body);
  const body = r.json();
  assert.match(body.url, /^http:\/\/localhost:3000\/join\/.{20,}$/);
  assert.equal(body.expiresInDays, 7);
  assert.equal(body.email.status, "not_requested");
  const listed = (await list(coach)).invitations.find(
    (i: any) => i.id === body.id,
  );
  assert.equal(listed.email, "copy.link@example.test");
  assert.equal(listed.status, "pending");
  assert.equal(listed.delivery.status, "not_requested");
  assert.equal((await jobsFor(coach, body.id)).length, 0);
});

test("email delivery is queued, de-duplicated by address and sent once by the worker", async () => {
  const first = await invite(coach, "emailed@example.test", true);
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(first.json().email.status, "queued");
  const [job] = await jobsFor(coach, first.json().id);
  assert.equal(job.status, "pending");
  assert.equal(job.data.sensitive, true);
  assert.equal(job.data.send, 1);
  assert.ok(Date.parse(job.data.expiresAt) > Date.now());
  assert.ok(job.data.text.includes(first.json().url));
  assert.equal((await list(coach)).invitations[0].delivery.status, "queued");

  // A second invitation to the same address replaces the first link and
  // withdraws its unsent email.
  const again = await invite(coach, "emailed@example.test", true);
  assert.equal(again.statusCode, 200, again.body);
  const [withdrawn] = await jobsFor(coach, first.json().id);
  assert.equal(withdrawn.status, "completed");
  assert.equal(withdrawn.data.text, undefined, "The old link text is removed");
  const views = (await list(coach)).invitations;
  const old = views.find((i: any) => i.id === first.json().id);
  assert.equal(old.status, "cancelled");
  assert.equal(old.replaced, true);
  const replaced = await accept(
    tokenOf(first.json().url),
    "emailed@example.test",
  );
  assert.equal(replaced.statusCode, 400);
  assert.equal(replaced.json().code, "INVALID_INVITE");

  // The worker sends the current link once and records delivery.
  const sent: string[] = [];
  const [current] = await jobsFor(coach, again.json().id);
  await executeEmailDelivery(
    db,
    coach.tenantId,
    await claim(coach, current.id),
    async (_to, _s, text) => {
      sent.push(text);
    },
  );
  assert.equal(sent.length, 1);
  assert.ok(sent[0].includes(again.json().url));
  const [delivered] = await jobsFor(coach, again.json().id);
  assert.equal(delivered.status, "completed");
  assert.equal(delivered.data.text, undefined, "Delivered links are scrubbed");
  const view = (await list(coach)).invitations.find(
    (i: any) => i.id === again.json().id,
  );
  assert.equal(view.delivery.status, "sent");
  assert.equal(view.sends, 1);
});

test("resend is cooled down, rotates the link and never sends a superseded link", async () => {
  const created = await invite(coach, "resend@example.test", true);
  const id = created.json().id;
  const early = await request(
    `/invitations/followers/${id}/resend`,
    "POST",
    {},
    coach,
  );
  assert.equal(early.statusCode, 429, early.body);
  assert.equal(early.json().code, "INVITE_RESEND_COOLDOWN");
  await db.system((tx) =>
    tx.query(
      "UPDATE one_time_tokens SET payload=payload||jsonb_build_object('lastSentAt',(now()-interval '1 hour')::text) WHERE id=$1",
      [id],
    ),
  );
  const resent = await request(
    `/invitations/followers/${id}/resend`,
    "POST",
    {},
    coach,
  );
  assert.equal(resent.statusCode, 200, resent.body);
  assert.notEqual(resent.json().url, created.json().url);
  const jobs = await jobsFor(coach, id);
  assert.deepEqual(
    jobs.map((j: any) => [j.data.send, j.status]),
    [
      [1, "completed"],
      [2, "pending"],
    ],
  );
  // Even a stale first job that was still pending is refused at delivery.
  const staleJob: any = {
    ...jobs[0],
    status: "pending",
    data: { ...jobs[0].data, text: "stale" },
  };
  await db.tenant({ ...coach, role: "owner" }, (tx) =>
    tx.query("UPDATE jobs SET status='pending',data=$2 WHERE id=$1", [
      staleJob.id,
      JSON.stringify(staleJob.data),
    ]),
  );
  const sent: string[] = [];
  await executeEmailDelivery(
    db,
    coach.tenantId,
    await claim(coach, staleJob.id),
    async (_t, _s, text) => {
      sent.push(text);
    },
  );
  assert.equal(sent.length, 0, "A superseded link is never emailed");
  const oldLink = await accept(
    tokenOf(created.json().url),
    "resend@example.test",
  );
  assert.equal(oldLink.statusCode, 400);
  const newLink = await accept(
    tokenOf(resent.json().url),
    "resend@example.test",
  );
  assert.equal(newLink.statusCode, 200, newLink.body);
});

test("invitation emails are capped per address and the copy link still works", async () => {
  const limits = joiningLimits();
  assert.equal(limits.invitationEmailsPerAddress, 3);
  let last: any;
  for (let i = 0; i < limits.invitationEmailsPerAddress + 1; i++)
    last = await invite(coach, "capped@example.test", true);
  assert.equal(last.statusCode, 200, last.body);
  assert.equal(last.json().email.status, "rate_limited");
  assert.match(last.json().url, /\/join\//);
  const view = (await list(coach)).invitations.find(
    (i: any) => i.id === last.json().id,
  );
  assert.equal(view.delivery.status, "rate_limited");
});

test("without email configuration the invitation is created with an explicit email status", async () => {
  const saved = process.env.EMAIL_API_KEY;
  delete process.env.EMAIL_API_KEY;
  try {
    const r = await invite(coach, "no-email@example.test", true);
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().email.status, "unavailable");
    assert.equal((await jobsFor(coach, r.json().id)).length, 0);
    assert.equal((await list(coach)).emailConfigured, false);
    const resend = await request(
      `/invitations/followers/${r.json().id}/resend`,
      "POST",
      {},
      coach,
    );
    assert.equal(resend.statusCode, 409);
    assert.equal(resend.json().code, "EMAIL_UNAVAILABLE");
  } finally {
    process.env.EMAIL_API_KEY = saved;
  }
});

test("cancelled and expired invitations cannot be accepted and their emails are withdrawn", async () => {
  const cancelled = await invite(coach, "cancel-me@example.test", true);
  const id = cancelled.json().id;
  const done = await request(
    `/invitations/followers/${id}/cancel`,
    "POST",
    {},
    coach,
  );
  assert.equal(done.statusCode, 200, done.body);
  assert.equal(done.json().status, "cancelled");
  const [job] = await jobsFor(coach, id);
  assert.equal(job.status, "completed");
  assert.equal(job.last_error, "Invitation cancelled before delivery");
  assert.equal(
    (await request(`/invitations/followers/${id}/cancel`, "POST", {}, coach))
      .statusCode,
    409,
  );
  const refused = await accept(
    tokenOf(cancelled.json().url),
    "cancel-me@example.test",
  );
  assert.equal(refused.statusCode, 400);
  const preview = await request("/invitations/preview", "POST", {
    token: tokenOf(cancelled.json().url),
  });
  assert.equal(preview.statusCode, 200, preview.body);
  assert.equal(preview.json().status, "cancelled");
  assert.equal(preview.json().invitedEmail, "c••••••@example.test");

  const expiring = await invite(coach, "expired@example.test", true);
  await db.system((tx) =>
    tx.query(
      "UPDATE one_time_tokens SET expires_at=now()-interval '1 minute' WHERE id=$1",
      [expiring.json().id],
    ),
  );
  const view = (await list(coach)).invitations.find(
    (i: any) => i.id === expiring.json().id,
  );
  assert.equal(view.status, "expired");
  assert.equal(
    (await accept(tokenOf(expiring.json().url), "expired@example.test"))
      .statusCode,
    400,
  );
  const [expiredJob] = await jobsFor(coach, expiring.json().id);
  const sent: string[] = [];
  await executeEmailDelivery(
    db,
    coach.tenantId,
    await claim(coach, expiredJob.id),
    async (_t, _s, text) => {
      sent.push(text);
    },
  );
  assert.equal(sent.length, 0);
  assert.equal(
    invitationStatus({
      consumed_at: null,
      expires_at: new Date(Date.now() + 1000),
    }),
    "pending",
  );
});

test("only the current owner manages follower invitations, and existing members are refused", async () => {
  const joined = await invite(coach, "member-one@example.test");
  const accepted = await accept(
    tokenOf(joined.json().url),
    "member-one@example.test",
  );
  assert.equal(accepted.statusCode, 200, accepted.body);
  const follower = await whoami(cookieOf(accepted));
  assert.equal(follower.role, "subscriber");
  for (const path of ["/invitations/followers"])
    assert.equal(
      (await request(path, "GET", undefined, follower)).statusCode,
      403,
    );
  const again = await invite(coach, "member-one@example.test");
  assert.equal(again.statusCode, 409);
  assert.equal(again.json().code, "ALREADY_MEMBER");
  const other = await invite(second, "outsider@example.test");
  assert.equal(
    (
      await request(
        `/invitations/followers/${other.json().id}/cancel`,
        "POST",
        {},
        coach,
      )
    ).statusCode,
    404,
    "An owner cannot cancel another workspace's invitation",
  );
  const view = (await list(coach)).invitations.find(
    (i: any) => i.id === joined.json().id,
  );
  assert.equal(view.status, "accepted");
  assert.ok(view.acceptedAt);
});

test("the owner and coaching staff are alerted when a follower joins, finance is not", async () => {
  const staffId = randomUUID(),
    financeId = randomUUID();
  await db.system(async (tx) => {
    for (const [id, role] of [
      [staffId, "staff"],
      [financeId, "finance"],
    ]) {
      await tx.query(
        "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,'unused')",
        [id, `${role}-${id}@example.test`, `Team ${role}`],
      );
      await tx.query(
        "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)",
        [coach.tenantId, id, role],
      );
    }
  });
  const invited = await invite(coach, "alerted@example.test");
  const joined = await accept(
    tokenOf(invited.json().url),
    "alerted@example.test",
    {
      name: "Alerted Follower",
    },
  );
  assert.equal(joined.statusCode, 200, joined.body);
  const follower = await whoami(cookieOf(joined));
  const alerts = await db.tenant({ ...coach, role: "owner" }, (tx) =>
    tx.query(
      "SELECT id,user_id,title,body,href,category,email_status FROM notifications WHERE dedupe_key LIKE $1",
      [`follower-joined:${follower.userId}:%`],
    ),
  );
  assert.deepEqual(
    alerts.map((a: any) => a.user_id).sort(),
    [coach.userId, staffId].sort(),
  );
  assert.ok(alerts.every((a: any) => a.category === "coaching"));
  assert.ok(alerts[0].body.includes("Alerted Follower"));
  assert.equal(alerts[0].href, `/trainer/subscribers/${follower.userId}`);
  // Email copies follow preferences through the ordinary queue.
  const queued = await db.tenant({ ...coach, role: "owner" }, (tx) =>
    tx.query(
      "SELECT count(*)::int n FROM jobs WHERE kind='email' AND intent_key=ANY($1::text[])",
      [alerts.map((a: any) => `notification:${a.id}`)],
    ),
  );
  assert.equal(queued[0].n, 2);
  const [joinedEvent] = await db.tenant({ ...coach, role: "owner" }, (tx) =>
    tx.query(
      "SELECT data FROM events WHERE name='follower.joined' AND subject_id=$1",
      [follower.userId],
    ),
  );
  assert.equal(joinedEvent.data.source, "invitation");

  // A public self-join from a published coach page alerts the team too.
  await db.system((tx) =>
    tx.query("UPDATE tenants SET published=true WHERE id=$1", [coach.tenantId]),
  );
  const enrolled = await request("/auth/enroll", "POST", {
    name: "Website Follower",
    email: "website-follower@example.test",
    password,
    coachSlug: "join-coach",
    accepted: true,
  });
  assert.equal(enrolled.statusCode, 201, enrolled.body);
  const web = await whoami(cookieOf(enrolled));
  const webAlerts = await db.tenant({ ...coach, role: "owner" }, (tx) =>
    tx.query(
      "SELECT user_id,body FROM notifications WHERE dedupe_key LIKE $1",
      [`follower-joined:${web.userId}:website:%`],
    ),
  );
  assert.equal(webAlerts.length, 2);
  assert.ok(webAlerts[0].body.includes("coaching website"));
  await db.system((tx) =>
    tx.query("UPDATE tenants SET published=false WHERE id=$1", [
      coach.tenantId,
    ]),
  );
});

test("a signed-in follower joins a second coach with one click and can switch back", async () => {
  const first = await invite(coach, "two-coaches@example.test");
  const joined = await accept(
    tokenOf(first.json().url),
    "two-coaches@example.test",
  );
  assert.equal(joined.statusCode, 200, joined.body);
  const follower = await whoami(cookieOf(joined));
  assert.equal(follower.tenantId, coach.tenantId);

  const offer = await invite(second, "Two-Coaches@example.test");
  const token = tokenOf(offer.json().url);
  const anonymous = await request("/invitations/preview", "POST", { token });
  assert.equal(anonymous.json().viewer.signedIn, false);
  assert.equal(anonymous.json().coach.name, "Coach join-second");
  const preview = await request(
    "/invitations/preview",
    "POST",
    { token },
    follower,
  );
  assert.equal(preview.statusCode, 200, preview.body);
  assert.equal(preview.json().viewer.emailMatches, true);
  assert.equal(preview.json().viewer.alreadyMember, false);
  assert.equal(preview.json().invitedEmail, "two-coaches@example.test");

  // Another signed-in account cannot use this invitation.
  const stranger = await whoami(
    cookieOf(
      await accept(
        tokenOf((await invite(coach, "stranger@example.test")).json().url),
        "stranger@example.test",
      ),
    ),
  );
  const mismatch = await request(
    "/invitations/accept-signed-in",
    "POST",
    { token, accepted: true },
    stranger,
  );
  assert.equal(mismatch.statusCode, 403);
  assert.equal(mismatch.json().code, "INVITE_EMAIL_MISMATCH");

  const signedIn = await request(
    "/invitations/accept-signed-in",
    "POST",
    { token, accepted: true },
    follower,
  );
  assert.equal(signedIn.statusCode, 200, signedIn.body);
  assert.equal(signedIn.json().joined, true);
  const moved = await whoami(cookieOf(signedIn));
  assert.equal(moved.tenantId, second.tenantId);
  assert.equal(
    moved.userId,
    follower.userId,
    "The same account, not a new one",
  );
  assert.equal(
    (await request("/bootstrap", "GET", undefined, follower)).statusCode,
    401,
    "The previous browser session is replaced",
  );
  const spaces = (
    await request("/auth/workspaces", "GET", undefined, moved)
  ).json();
  assert.deepEqual(
    spaces.workspaces.map((w: any) => [w.name, w.role, w.current]).sort(),
    [
      ["Coach join-coach", "subscriber", false],
      ["Coach join-second", "subscriber", true],
    ],
  );
  const back = await request(
    "/auth/workspace",
    "POST",
    { tenantId: coach.tenantId },
    moved,
  );
  assert.equal(back.statusCode, 200, back.body);
  const returned = await whoami(cookieOf(back));
  assert.equal(returned.tenantId, coach.tenantId);
  const reused = await request(
    "/invitations/accept-signed-in",
    "POST",
    { token, accepted: true },
    returned,
  );
  assert.equal(reused.statusCode, 400, "The link is single-use");
  const alerts = await db.tenant({ ...second, role: "owner" }, (tx) =>
    tx.query("SELECT user_id FROM notifications WHERE dedupe_key LIKE $1", [
      `follower-joined:${follower.userId}:%`,
    ]),
  );
  assert.deepEqual(
    alerts.map((a: any) => a.user_id),
    [second.userId],
  );

  // Team invitations keep the password path.
  await db.system((tx) =>
    tx.query("UPDATE sessions SET mfa_at=now() WHERE user_id=$1", [
      second.userId,
    ]),
  );
  const team = await request(
    "/invitations",
    "POST",
    { email: stranger.email, role: "staff" },
    second,
  );
  assert.equal(team.statusCode, 200, team.body);
  const staffTry = await request(
    "/invitations/accept-signed-in",
    "POST",
    { token: tokenOf(team.json().url), accepted: true },
    stranger,
  );
  assert.equal(staffTry.statusCode, 409);
  assert.equal(staffTry.json().code, "TEAM_INVITE_PASSWORD");
});

test("an existing account joins with its password and no name; a new account needs a name", async () => {
  const offer = await invite(second, "join-coach@example.test");
  const existing = await request("/invitations/accept", "POST", {
    token: tokenOf(offer.json().url),
    email: "join-coach@example.test",
    password,
    accepted: true,
  });
  assert.equal(existing.statusCode, 200, existing.body);
  const moved = await whoami(cookieOf(existing));
  assert.equal(moved.userId, coach.userId);
  assert.equal(moved.role, "subscriber");
  const fresh = await invite(second, "nameless@example.test");
  const missing = await request("/invitations/accept", "POST", {
    token: tokenOf(fresh.json().url),
    email: "nameless@example.test",
    password,
    accepted: true,
  });
  assert.equal(missing.statusCode, 400);
  assert.equal(missing.json().code, "NAME_REQUIRED");
});

async function withEnv<T>(values: Record<string, string>, run: () => Promise<T>) {
  const saved = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, values);
  try {
    return await run();
  } finally {
    for (const [key, value] of Object.entries(saved))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
}
const setVerified = (who: any, verified: boolean) =>
  db.system((tx) =>
    tx.query("UPDATE users SET email_verified=$2 WHERE id=$1", [
      who.userId,
      verified,
    ]),
  );

test("an owner with an unconfirmed email address cannot email invitations; the copy link still works", async () => {
  const fresh = await register("join-unverified");
  await setVerified(fresh, false);
  const r = await invite(fresh, "unverified-target@example.test", true);
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().email.status, "verify_email_first");
  assert.match(r.json().email.message, /Confirm your own email address/);
  assert.match(r.json().url, /\/join\//);
  assert.equal((await jobsFor(fresh, r.json().id)).length, 0, "No email job");
  const listed = await list(fresh);
  assert.equal(listed.ownerEmailVerified, false);
  const view = listed.invitations.find((i: any) => i.id === r.json().id);
  assert.equal(view.delivery.status, "verify_email_first");
  assert.equal(view.sends, 0);
  const resend = await request(
    `/invitations/followers/${r.json().id}/resend`,
    "POST",
    {},
    fresh,
  );
  assert.equal(resend.statusCode, 409, resend.body);
  assert.equal(resend.json().code, "EMAIL_VERIFICATION_REQUIRED");
  // The link itself is valid: the invitee can still join by copy link.
  const joined = await accept(
    tokenOf(r.json().url),
    "unverified-target@example.test",
  );
  assert.equal(joined.statusCode, 200, joined.body);
  await setVerified(fresh, true);
  const later = await invite(fresh, "verified-later@example.test", true);
  assert.equal(later.json().email.status, "queued");
  assert.equal((await list(fresh)).ownerEmailVerified, true);
});

test("the per-address cap counts invitation emails from every workspace", async () => {
  const third = await register("join-third");
  const address = "shared-address@example.test";
  // Two emails from the first coach (the second replaces the first link) and
  // one from the second coach reach the default cap of three.
  assert.equal((await invite(coach, address, true)).json().email.status, "queued");
  assert.equal((await invite(coach, address, true)).json().email.status, "queued");
  assert.equal((await invite(second, address, true)).json().email.status, "queued");
  const blocked = await invite(third, address, true);
  assert.equal(blocked.statusCode, 200, blocked.body);
  assert.equal(blocked.json().email.status, "rate_limited");
  assert.match(blocked.json().email.message, /already received 3 invitation emails/);
  assert.equal((await jobsFor(third, blocked.json().id)).length, 0);
  // Resending from another workspace is refused by the same cap.
  const pending = (await list(second)).invitations.find(
    (i: any) => i.email === address && i.status === "pending",
  );
  await db.system((tx) =>
    tx.query(
      "UPDATE one_time_tokens SET payload=payload||jsonb_build_object('lastSentAt',(now()-interval '1 hour')::text) WHERE id=$1",
      [pending.id],
    ),
  );
  const resend = await request(
    `/invitations/followers/${pending.id}/resend`,
    "POST",
    {},
    second,
  );
  assert.equal(resend.statusCode, 429, resend.body);
  assert.equal(resend.json().code, "INVITE_EMAIL_LIMIT");
  // Sends older than 24 hours no longer count.
  await db.system((tx) =>
    tx.query(
      "UPDATE one_time_tokens SET payload=payload||jsonb_build_object('sentAt',jsonb_build_array((now()-interval '25 hours')::text)) WHERE purpose='invite' AND lower(payload->>'email')=$1",
      [address],
    ),
  );
  assert.equal((await invite(third, address, true)).json().email.status, "queued");
});

test("the per-workspace and platform-wide daily caps stop invitation emails but not links", async () => {
  const small = await register("join-small");
  await withEnv({ FOLLOWER_INVITE_EMAILS_PER_DAY: "1" }, async () => {
    assert.equal(
      (await invite(small, "small-one@example.test", true)).json().email.status,
      "queued",
    );
    const second = await invite(small, "small-two@example.test", true);
    assert.equal(second.json().email.status, "rate_limited");
    assert.match(second.json().email.message, /This workspace reached its limit of 1/);
    assert.match(second.json().url, /\/join\//);
  });
  await withEnv({ FOLLOWER_INVITE_EMAILS_PLATFORM_PER_DAY: "0" }, async () => {
    assert.equal(joiningLimits().invitationEmailsPlatformPerDay, 0);
    const paused = await invite(small, "small-three@example.test", true);
    assert.equal(paused.json().email.status, "rate_limited");
    assert.match(paused.json().email.message, /paused for today across the platform/);
    assert.equal((await jobsFor(small, paused.json().id)).length, 0);
  });
  // Without the override the platform default (1000) applies again.
  assert.equal(joiningLimits().invitationEmailsPlatformPerDay, 1000);
});

test("re-inviting an address leaves an expired invitation listed as expired", async () => {
  const first = await invite(coach, "expired-then-again@example.test");
  await db.system((tx) =>
    tx.query(
      "UPDATE one_time_tokens SET expires_at=now()-interval '1 minute' WHERE id=$1",
      [first.json().id],
    ),
  );
  const again = await invite(coach, "expired-then-again@example.test");
  assert.equal(again.statusCode, 200, again.body);
  const views = (await list(coach)).invitations;
  const old = views.find((i: any) => i.id === first.json().id);
  assert.equal(old.status, "expired");
  assert.equal(old.replaced, false);
  assert.equal(
    views.find((i: any) => i.id === again.json().id).status,
    "pending",
  );
});

test("joining limits refuse out-of-range values when saved, so the saved value is the value in force", () => {
  for (const [key, value] of [
    ["FOLLOWER_INVITE_EMAILS_PER_ADDRESS", "0"],
    ["FOLLOWER_INVITE_EMAILS_PER_ADDRESS", "21"],
    ["FOLLOWER_INVITE_EMAILS_PER_DAY", "10001"],
    ["FOLLOWER_INVITE_EMAILS_PLATFORM_PER_DAY", "100001"],
    ["COMPLIMENTARY_ACCESS_MAX_DAYS", "0"],
    ["COMPLIMENTARY_ACCESS_MAX_DAYS", "3651"],
    ["COMPLIMENTARY_ACCESS_MAX_ACTIVE", "2.5"],
  ])
    assert.throws(
      () => validateIntegrationValues("application", { [key]: value }),
      /must be a whole number from/,
      `${key}=${value}`,
    );
  const saved = validateIntegrationValues("application", {
    FOLLOWER_INVITE_EMAILS_PER_ADDRESS: "1",
    FOLLOWER_INVITE_EMAILS_PER_DAY: "0",
    FOLLOWER_INVITE_EMAILS_PLATFORM_PER_DAY: "250",
    COMPLIMENTARY_ACCESS_MAX_DAYS: "3650",
    COMPLIMENTARY_ACCESS_MAX_ACTIVE: "0",
  });
  const limits = joiningLimits(saved);
  assert.equal(limits.invitationEmailsPerAddress, 1);
  assert.equal(limits.invitationEmailsPerDay, 0);
  assert.equal(limits.invitationEmailsPlatformPerDay, 250);
  assert.equal(limits.complimentaryMaxDays, 3650);
  assert.equal(limits.complimentaryMaxActive, 0);
  // Blank keeps the default.
  assert.equal(
    joiningLimits(
      validateIntegrationValues("application", {
        COMPLIMENTARY_ACCESS_MAX_DAYS: "",
      }),
    ).complimentaryMaxDays,
    365,
  );
});

test("invitation email dates use the UAE calendar day, not the UTC day", async () => {
  assert.equal(messageDate("2026-10-04T21:30:00Z"), "5 October 2026");
  assert.equal(messageDate("2026-10-04T21:30:00Z", "UTC"), "4 October 2026");
  assert.equal(
    messageDate("2026-10-04T21:30:00Z", "Not/AZone"),
    "5 October 2026",
    "An unknown zone falls back to the platform default",
  );
  const r = await invite(coach, "dated@example.test", true);
  const [job] = await jobsFor(coach, r.json().id);
  assert.ok(
    job.data.text.includes(
      `expires on ${messageDate(r.json().expiresAt, "Asia/Dubai")}.`,
    ),
    job.data.text,
  );
});
