import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, putRecord, type Database } from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";
import {
  notifyUser,
  nextNotificationTime,
  notificationPreferencesSchema,
  notificationDeliveryDecision,
  scheduleNotifications,
} from "../apps/api/src/notifications.ts";
import { executeEmailDelivery } from "../apps/worker/src/email-delivery.ts";
import { withRuntimeConfig } from "../packages/providers/src/configuration.ts";
let db: Database,
  app: Awaited<ReturnType<typeof buildApp>>,
  a: any,
  b: any,
  client: any;
const request = (
  path: string,
  method: any = "GET",
  body?: any,
  cookie?: string,
) =>
  app.inject({
    url: "/api/v1" + path,
    method,
    headers: {
      origin: "http://localhost:3000",
      ...(cookie ? { cookie } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    payload: body,
  });
async function register(slug: string) {
  const r = await request("/auth/register", "POST", {
    name: "Coach " + slug,
    email: slug + "@example.test",
    password: "TestingOnly2026!",
    slug,
    accepted: true,
  });
  assert.equal(r.statusCode, 201, r.body);
  const cookie = String(r.headers["set-cookie"]).split(";")[0];
  return {
    ...(await request("/bootstrap", "GET", undefined, cookie)).json().user,
    cookie,
  };
}
before(async () => {
  db = await createDatabase({ memory: true });
  app = await buildApp({ db, testing: true });
  assert.ok(
    app.hasRoute({ method: "GET", url: "/api/v1/notifications" }),
    "The assembled application registers notifications",
  );
  a = await register("notify-one");
  b = await register("notify-two");
  const invitation = await request(
    "/invitations",
    "POST",
    { email: "notify-client@example.test", role: "subscriber" },
    a.cookie,
  );
  const token = invitation.json().url.split("/").pop();
  const joined = await request("/invitations/accept", "POST", {
    token,
    name: "Client",
    email: "notify-client@example.test",
    password: "TestingClient2026!",
  });
  assert.equal(joined.statusCode, 200, joined.body);
  const cookie = String(joined.headers["set-cookie"]).split(";")[0];
  client = {
    ...(await request("/bootstrap", "GET", undefined, cookie)).json().user,
    cookie,
  };
});
after(async () => {
  await app.close();
  await db.close();
});
test("preferences survive reload and stale writes or another member cannot change them", async () => {
  const p = (
    await request("/notifications/preferences", "GET", undefined, client.cookie)
  ).json();
  const body = {
    version: p.version,
    data: {
      ...p.data,
      email: false,
      marketing: true,
      quietStart: 60,
      quietEnd: 120,
    },
  };
  assert.equal(
    (await request("/notifications/preferences", "PUT", body, client.cookie))
      .statusCode,
    200,
  );
  const got = (
    await request("/notifications/preferences", "GET", undefined, client.cookie)
  ).json();
  assert.equal(got.data.email, false);
  assert.equal(got.data.marketing, true);
  assert.equal(
    (await request("/notifications/preferences", "PUT", body, client.cookie))
      .statusCode,
    409,
  );
  assert.equal(
    (
      await request("/notifications/preferences", "GET", undefined, b.cookie)
    ).json().data.email,
    true,
  );
});
test("quiet windows cross midnight and daylight transitions without suppressing forever", () => {
  const p = notificationPreferencesSchema.parse({
    timezone: "Asia/Dubai",
    quietStart: 1320,
    quietEnd: 480,
  });
  assert.equal(
    nextNotificationTime(p, new Date("2026-09-26T20:00:00Z")).toISOString(),
    "2026-09-27T04:00:00.000Z",
  );
  const q = {
    ...p,
    timezone: "America/New_York",
    quietStart: 0,
    quietEnd: 180,
  };
  assert.equal(
    nextNotificationTime(q, new Date("2026-11-01T04:30:00Z")).toISOString(),
    "2026-11-01T08:00:00.000Z",
  );
});
test("safety alerts are deduped, preserve critical text after long templates, and restore caller scope", async () => {
  await db.system((tx) =>
    tx.query(
      "INSERT INTO admin_documents(id,kind,key,version,title,content,status,effective_at,created_by,published_by,published_at) VALUES($1,'notification','safety-template',1,'Safety for {{name}}',$2,'published',now()-interval '1 second',$3,$3,now())",
      [randomUUID(), "Long reviewed context ".repeat(400), a.userId],
    ),
  );
  const key = "safety-" + randomUUID(),
    body =
      "Stop this session and open the trainer review. This instruction must remain intact.";
  const result = await db.tenant(client, async (tx) => {
    const first = await notifyUser(tx, client, {
      userId: a.userId,
      category: "safety",
      dedupeKey: key,
      title: "Review required",
      body,
      templateKey: "safety-template",
      href: "/trainer/exceptions",
    });
    assert.equal(
      await notifyUser(tx, client, {
        userId: a.userId,
        category: "safety",
        dedupeKey: key,
        title: "Again",
        body,
      }),
      null,
    );
    assert.equal(
      (await tx.query("SELECT current_setting('app.role') role"))[0].role,
      "subscriber",
    );
    return first;
  });
  const [notice] = await db.tenant(a, (tx) =>
    tx.query("SELECT * FROM notifications WHERE id=$1", [result!.id]),
  );
  assert.ok(notice.body.endsWith(body));
  assert.ok(notice.body.length <= 4000);
  assert.equal(notice.email_status, "pending");
  assert.equal(
    (await request("/notifications", "GET", undefined, b.cookie))
      .json()
      .some((r: any) => r.id === result!.id),
    false,
  );
});
test("reminders obey current choices and an uncertain email is never dispatched again automatically", async () => {
  let id: string;
  await db.tenant(a, async (tx) => {
    await notifyUser(tx, a, {
      userId: client.userId,
      category: "workout",
      dedupeKey: "disabled-reminder",
      title: "Train",
      body: "A session is ready",
    });
    const [n] = await tx.query(
      "SELECT * FROM notifications WHERE dedupe_key='disabled-reminder'",
    );
    assert.equal(n.email_status, "suppressed");
    const n2 = await notifyUser(tx, a, {
      userId: client.userId,
      category: "account",
      dedupeKey: "account-test",
      title: "Account alert",
      body: "Review this account change",
    });
    id = n2!.id;
  });
  const job = await db.tenant(
    a,
    async (tx) =>
      (
        await tx.query(
          "UPDATE jobs SET attempts=1,leased_until=now()+interval '2 minutes' WHERE data->>'notificationId'=$1 RETURNING *",
          [id!],
        )
      )[0],
  );
  let calls = 0;
  const send = async () => {
    calls++;
    const [j] = await db.tenant(a, (tx) =>
      tx.query("SELECT status,data FROM jobs WHERE id=$1", [job.id]),
    );
    assert.equal(j.status, "blocked");
    assert.equal(j.data.deliveryState, "unknown");
    throw new Error("Connection ended after dispatch");
  };
  await withRuntimeConfig(
    {
      EMAIL_API_URL: "https://email.example.test/send",
      EMAIL_API_KEY: "fixture",
      EMAIL_FROM: "coach@example.test",
    },
    async () => {
      await executeEmailDelivery(db, a.tenantId, job, send);
      await executeEmailDelivery(db, a.tenantId, job, send);
    },
  );
  assert.equal(calls, 1);
  const [j] = await db.tenant(a, (tx) =>
    tx.query("SELECT status,last_error FROM jobs WHERE id=$1", [job.id]),
  );
  assert.equal(j.status, "blocked");
  assert.match(j.last_error, /unknown/);
});
test("scheduled workouts dedupe and canceled or rescheduled source events suppress stale reminders", async () => {
  await db.tenant(a, async (tx) => {
    await tx.query(
      "INSERT INTO subscriptions(id,tenant_id,user_id,status,period_end,price_minor) VALUES($1,$2,$3,'active',now()+interval '20 days',10000) ON CONFLICT(tenant_id,user_id) DO UPDATE SET status='active',period_end=excluded.period_end",
      [randomUUID(), a.tenantId, client.userId],
    );
    await tx.query(
      'UPDATE notification_preferences SET data=data||\'{"email":true,"workouts":true,"quietStart":0,"quietEnd":0}\'::jsonb WHERE user_id=$1',
      [client.userId],
    );
  });
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dubai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const plan = await db.tenant(a, (tx) =>
    putRecord(
      tx,
      a,
      "planned_session",
      { date, timezone: "Asia/Dubai", label: "Session A" },
      { ownerId: client.userId, status: "planned" },
    ),
  );
  await scheduleNotifications(db, a.tenantId);
  await scheduleNotifications(db, a.tenantId);
  const jobs = await db.tenant(a, (tx) =>
    tx.query(
      "SELECT j.* FROM jobs j JOIN notifications n ON n.id=(j.data->>'notificationId')::uuid WHERE n.data->'source'->>'id'=$1",
      [plan.id],
    ),
  );
  assert.equal(jobs.length, 1);
  assert.equal(
    (await notificationDeliveryDecision(db, a.tenantId, jobs[0])).allowed,
    true,
  );
  await db.tenant(a, (tx) =>
    tx.query("UPDATE records SET status='canceled' WHERE id=$1", [plan.id]),
  );
  assert.equal(
    (await notificationDeliveryDecision(db, a.tenantId, jobs[0])).allowed,
    false,
  );
});
test("ordinary chat safety reports queue private deduped trainer alerts and a client stop instruction", async () => {
  const text = "I have sharp pain while lifting and need a review";
  const report = await request("/messages", "POST", { text }, client.cookie);
  assert.equal(report.statusCode, 200, report.body);
  const holds = (
    await request("/training/holds", "GET", undefined, a.cookie)
  ).json();
  const hold = holds.find(
    (row: any) =>
      row.status === "active" && row.owner_user_id === client.userId,
  );
  assert.ok(hold);
  await request("/messages", "POST", { text }, client.cookie);
  const notices = await db.tenant(a, (tx) =>
    tx.query("SELECT * FROM notifications WHERE dedupe_key=$1", [
      `training-hold:${hold.id}`,
    ]),
  );
  assert.equal(notices.length, 2);
  assert.ok(notices.every((n) => !n.body.includes(text)));
  const stopNotice = notices.find((n) => n.user_id === client.userId);
  assert.ok(stopNotice);
  assert.ok(stopNotice.body.includes("Stop this training session"));
  const emails = await db.tenant(a, (tx) =>
    tx.query(
      "SELECT * FROM jobs WHERE data->>'notificationId'=ANY($1::text[])",
      [notices.map((n) => n.id)],
    ),
  );
  assert.equal(emails.length, 2);
  assert.ok(emails.every((j) => j.status === "pending"));
  assert.equal(
    (await request("/notifications", "GET", undefined, b.cookie)).json().length,
    0,
  );
  const resolved = await request(
    `/training/holds/${hold.id}/resolve`,
    "POST",
    {
      version: hold.version,
      action: "abandon",
      note: "Reviewed with the client and ended the held session",
      reviewed: true,
    },
    a.cookie,
  );
  assert.equal(resolved.statusCode, 200, resolved.body);
  const inbox = (
    await request("/notifications", "GET", undefined, client.cookie)
  ).json();
  const resolution = inbox.find(
    (n: any) => n.dedupe_key === `training-hold-resolution:${hold.id}`,
  );
  assert.ok(resolution);
  assert.equal(
    (
      await request(
        `/notifications/${resolution.id}/read`,
        "POST",
        {},
        client.cookie,
      )
    ).statusCode,
    200,
  );
  assert.ok(
    (await request("/notifications", "GET", undefined, client.cookie))
      .json()
      .find((n: any) => n.id === resolution.id).read_at,
  );
});
test("a stale email lease cannot send or overwrite a newer delivery", async () => {
  const notice = await db.tenant(a, (tx) =>
    notifyUser(tx, a, {
      userId: client.userId,
      category: "account",
      dedupeKey: "lease-fixture",
      title: "Session changed",
      body: "Review your account sessions.",
    }),
  );
  const old = await db.tenant(
    a,
    async (tx) =>
      (
        await tx.query(
          "UPDATE jobs SET attempts=1,leased_until=now()+interval '2 minutes' WHERE data->>'notificationId'=$1 RETURNING *",
          [notice!.id],
        )
      )[0],
  );
  const newer = await db.tenant(
    a,
    async (tx) =>
      (
        await tx.query(
          "UPDATE jobs SET attempts=2,leased_until=now()+interval '3 minutes' WHERE id=$1 RETURNING *",
          [old.id],
        )
      )[0],
  );
  let calls = 0;
  await withRuntimeConfig(
    {
      EMAIL_API_URL: "https://email.example.test/send",
      EMAIL_API_KEY: "fixture",
      EMAIL_FROM: "coach@example.test",
    },
    async () => {
      await executeEmailDelivery(db, a.tenantId, old, async () => {
        calls++;
      });
      assert.equal(calls, 0);
      await executeEmailDelivery(db, a.tenantId, newer, async () => {
        calls++;
      });
      await executeEmailDelivery(db, a.tenantId, old, async () => {
        calls++;
      });
    },
  );
  assert.equal(calls, 1);
  const [job] = await db.tenant(a, (tx) =>
    tx.query("SELECT status,attempts FROM jobs WHERE id=$1", [old.id]),
  );
  assert.equal(job.status, "completed");
  assert.equal(job.attempts, 2);
});
test("assembled booking routes send confirmation and cancellation to the member inbox", async () => {
  const startsAt = new Date(Date.now() + 7 * 86400000).toISOString();
  const endsAt = new Date(Date.now() + 7 * 86400000 + 3600000).toISOString();
  const slot = await request(
    "/bookings/slots",
    "POST",
    {
      title: "Personal coaching",
      location: "Coach studio",
      startsAt,
      endsAt,
      capacity: 1,
    },
    a.cookie,
  );
  assert.equal(slot.statusCode, 200, slot.body);
  const booking = await request(
    `/bookings/slots/${slot.json().id}/reserve`,
    "POST",
    {},
    client.cookie,
  );
  assert.equal(booking.statusCode, 200, booking.body);
  const inbox = (
    await request("/notifications", "GET", undefined, client.cookie)
  ).json();
  assert.ok(
    inbox.some(
      (n: any) =>
        n.category === "booking" &&
        n.dedupe_key.startsWith(`booking:${booking.json().id}:`),
    ),
  );
  const canceled = await request(
    `/bookings/${booking.json().id}/cancel`,
    "POST",
    {},
    client.cookie,
  );
  assert.equal(canceled.statusCode, 200, canceled.body);
  const after = (
    await request("/notifications", "GET", undefined, client.cookie)
  ).json();
  assert.equal(
    after.filter(
      (n: any) =>
        n.category === "booking" &&
        n.dedupe_key.startsWith(`booking:${booking.json().id}:`),
    ).length,
    2,
  );
});
