import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { createDatabase, type Database } from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";
import { registerAdminOperations } from "../apps/api/src/admin-operations.ts";
import { INQUIRY_ALERTS_PER_HOUR } from "../apps/api/src/coach-site.ts";
import { notificationDeliveryDecision } from "../apps/api/src/notifications.ts";

let db: Database, app: Awaited<ReturnType<typeof buildApp>>, coach: any;
const admin = Fastify();
const base = new URL(process.env.PUBLIC_APP_URL ?? "http://localhost:3000");
const slug = "inquiry-coach";
async function call(
  path: string,
  method: any = "GET",
  payload?: any,
  cookie?: string,
) {
  return app.inject({
    url: "/api/v1" + path,
    method,
    payload,
    headers: {
      host: base.host,
      origin: base.origin,
      ...(cookie ? { cookie } : {}),
    },
  });
}
const contact = (cookie?: string, name = "Visitor") =>
  call(
    `/public/sites/${slug}/contact`,
    "POST",
    {
      name,
      email: "visitor@example.test",
      message: "I would like coaching for a half marathon.",
      consent: true,
      website: "",
    },
    cookie,
  );
async function allowAnalytics(touch: Record<string, string>) {
  const r = await call("/public/acquisition/consent", "POST", {
    granted: true,
    touch,
  });
  assert.equal(r.statusCode, 200, r.body);
  return String(r.headers["set-cookie"]).split(";")[0];
}
const inbox = async () => {
  const r = await call(
    "/tenant/site/inquiries",
    "GET",
    undefined,
    coach.cookie,
  );
  assert.equal(r.statusCode, 200, r.body);
  return r.json().items as any[];
};
const analytics = async () => {
  const r = await call("/analytics/business", "GET", undefined, coach.cookie);
  assert.equal(r.statusCode, 200, r.body);
  return r.json().leads;
};
const inquiryNotices = () =>
  db.tenant(coach, (tx) =>
    tx.query(
      "SELECT * FROM notifications WHERE user_id=$1 AND dedupe_key LIKE 'website-inquiry:%' ORDER BY created_at,id",
      [coach.userId],
    ),
  );
const leadEvents = () =>
  db.system((tx) =>
    tx.query(
      "SELECT * FROM acquisition_events WHERE tenant_id=$1 AND name='lead'",
      [coach.tenantId],
    ),
  );

before(async () => {
  db = await createDatabase({ memory: true });
  app = await buildApp({ db, testing: true });
  const r = await call("/auth/register", "POST", {
    name: "Inquiry Coach",
    email: "inquiry-coach@example.test",
    password: "InquiryCoach2026!",
    slug,
    accepted: true,
  });
  assert.equal(r.statusCode, 201, r.body);
  const cookie = String(r.headers["set-cookie"]).split(";")[0];
  coach = {
    ...(await call("/bootstrap", "GET", undefined, cookie)).json().user,
    cookie,
  };
  await db.system((tx) =>
    tx.query("UPDATE tenants SET published=true WHERE id=$1", [coach.tenantId]),
  );
  admin.setErrorHandler((e: any, _req, reply) =>
    reply.code(e.statusCode ?? 500).send({ code: e.code, message: e.message }),
  );
  registerAdminOperations(admin, db, () => ({
    tenantId: coach.tenantId,
    userId: coach.userId,
    role: "owner",
    platformRole: "admin",
    mfaAt: new Date().toISOString(),
  }));
});
after(async () => {
  await admin.close();
  await app.close();
  await db.close();
});

test("each website inquiry notifies the owner, follows preferences and caps email floods", async () => {
  const visitor = await allowAnalytics({
    source: "instagram",
    campaign: "spring_launch",
    medium: "social",
    referral: "friend42",
  });
  assert.equal((await contact(visitor, "Consenting visitor")).statusCode, 200);
  let notices = await inquiryNotices();
  assert.equal(notices.length, 1);
  const first = notices[0];
  assert.equal(first.title, "New website inquiry");
  assert.equal(first.category, "coaching");
  assert.equal(first.href, "/trainer/website");
  assert.equal(first.email_status, "pending");
  assert.equal(first.data.topic, "inquiry");
  assert.equal(first.data.source.type, "website_inquiry");
  assert.equal(first.data.template.kind, "website-inquiry");
  assert.ok(
    !first.body.includes("half marathon"),
    "no inquiry content in alerts",
  );
  const [job] = await db.tenant(coach, (tx) =>
    tx.query(
      "SELECT * FROM jobs WHERE kind='email' AND data->>'notificationId'=$1",
      [first.id],
    ),
  );
  assert.match(job.data.html, /website inquiries/);

  // The owner turns inquiry email/device alerts off: the inbox still gets it.
  const prefs = (
    await call("/notifications/preferences", "GET", undefined, coach.cookie)
  ).json();
  assert.equal(prefs.options.inquiries, true);
  assert.equal(prefs.data.inquiries, true);
  assert.equal(prefs.data.language, "en");
  const saved = await call(
    "/notifications/preferences",
    "PUT",
    { version: prefs.version, data: { ...prefs.data, inquiries: false } },
    coach.cookie,
  );
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal((await contact(undefined, "Private visitor")).statusCode, 200);
  notices = await inquiryNotices();
  assert.equal(notices.length, 2);
  assert.equal(notices[1].email_status, "suppressed");

  // Alerts back on, but the hourly cap is reached: in-app only.
  const current = (
    await call("/notifications/preferences", "GET", undefined, coach.cookie)
  ).json();
  await call(
    "/notifications/preferences",
    "PUT",
    { version: current.version, data: { ...current.data, inquiries: true } },
    coach.cookie,
  );
  await db.tenant(coach, async (tx) => {
    for (let i = 0; i < INQUIRY_ALERTS_PER_HOUR - 2; i++)
      await tx.query(
        "INSERT INTO notifications(id,tenant_id,user_id,category,dedupe_key,title,body) VALUES(gen_random_uuid(),$1,$2,'coaching',$3,'Earlier inquiry','Earlier inquiry')",
        [coach.tenantId, coach.userId, "website-inquiry:earlier-" + i],
      );
  });
  assert.equal((await contact(undefined, "Flood visitor")).statusCode, 200);
  notices = await inquiryNotices();
  const capped = notices.at(-1)!;
  assert.equal(capped.title, "New website inquiry");
  assert.equal(capped.email_status, "suppressed");
  assert.equal(
    (
      await db.tenant(coach, (tx) =>
        tx.query("SELECT id FROM jobs WHERE data->>'notificationId'=$1", [
          capped.id,
        ]),
      )
    ).length,
    0,
  );
  // The route's own abuse limit (4 per hour per address) still applies.
  assert.equal((await contact(undefined, "Fourth")).statusCode, 200);
  assert.equal((await contact(undefined, "Fifth")).statusCode, 429);
  const events = await db.tenant(coach, (tx) =>
    tx.query("SELECT data FROM events WHERE name='website.inquiry_received'"),
  );
  assert.equal(events.length, 4);

  // Leads: only the consenting visitor has attribution.
  const leads = await leadEvents();
  assert.equal(leads.length, 1);
  assert.equal(leads[0].source, "instagram");
  assert.equal(leads[0].campaign, "spring_launch");
  assert.equal(leads[0].attribution.last.referral, "friend42");
  assert.equal(leads[0].user_id, null);
  const items = await inbox();
  assert.equal(items.length, 4);
  const attributed = items.find((r) => r.data.name === "Consenting visitor");
  assert.deepEqual(attributed.attribution, {
    source: "instagram",
    campaign: "spring_launch",
    medium: "social",
    lastSource: "instagram",
    lastCampaign: "spring_launch",
    referral: "friend42",
  });
  assert.equal(
    items.find((r) => r.data.name === "Private visitor").attribution,
    null,
  );
  let report = await analytics();
  assert.equal(report.monthly[0].inquiries, 4);
  assert.equal(report.monthly[0].attributed, 1);
  assert.deepEqual(report.sources, [
    {
      source: "instagram",
      campaign: "spring_launch",
      medium: "social",
      referral: "friend42",
      leads: 1,
      joined: 0,
    },
  ]);

  // The lead joins through the website: the funnel links lead to join.
  const joined = await call(
    "/auth/enroll",
    "POST",
    {
      name: "Converted visitor",
      email: "converted@example.test",
      password: "ConvertedVisitor2026!",
      coachSlug: slug,
      accepted: true,
    },
    visitor,
  );
  assert.equal(joined.statusCode, 201, joined.body);
  report = await analytics();
  assert.equal(report.sources[0].joined, 1);
  // The whole trainer analytics report loads under the restricted tenant role.
  const full = (
    await call("/analytics/business", "GET", undefined, coach.cookie)
  ).json();
  assert.equal(full.cohorts.length, 1);
  assert.equal(full.cohorts[0].joined, 1);
  const funnel = await admin.inject({
    url: "/api/v1/admin/operations/acquisition",
  });
  assert.equal(funnel.statusCode, 200, funnel.body);
  const row = funnel.json().rows.find((r: any) => r.source === "instagram");
  assert.equal(row.leads, 1);
  assert.equal(row.enrolled, 1);
  assert.match(funnel.json().summary.attribution, /website inquiries/);

  // Withdrawing analytics permission removes the attribution, never the inquiry.
  const withdrawn = await call(
    "/public/acquisition/consent",
    "DELETE",
    undefined,
    visitor,
  );
  assert.equal(withdrawn.statusCode, 200, withdrawn.body);
  assert.equal((await leadEvents()).length, 0);
  assert.equal(
    (await inbox()).find((r) => r.data.name === "Consenting visitor")
      .attribution,
    null,
  );
  report = await analytics();
  assert.equal(report.monthly[0].inquiries, 4);
  assert.equal(report.monthly[0].attributed, 0);
  assert.deepEqual(report.sources, []);

  // A delayed alert for an inquiry the owner already handled is not sent.
  const later = new Date(Date.now() + 12 * 3600_000);
  assert.equal(
    (await notificationDeliveryDecision(db, coach.tenantId, job, later))
      .allowed,
    true,
  );
  const handled = (await inbox()).find((r) => r.id === first.data.source.id);
  assert.equal(
    (
      await call(
        `/tenant/site/inquiries/${handled.id}`,
        "POST",
        { version: handled.version },
        coach.cookie,
      )
    ).statusCode,
    200,
  );
  assert.equal(
    (await notificationDeliveryDecision(db, coach.tenantId, job, later))
      .allowed,
    false,
  );
});
