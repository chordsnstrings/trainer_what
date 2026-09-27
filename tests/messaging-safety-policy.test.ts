import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { createDatabase, type Database } from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";
import { registerAdminOperations } from "../apps/api/src/admin-operations.ts";
import { registerMessaging } from "../apps/api/src/messaging-admin.ts";
import {
  activeSafetyPolicy,
  scheduleSafetyEscalations,
} from "../apps/api/src/safety-policy.ts";
import {
  REVIEW_CATEGORIES,
  SAFETY_FLOOR,
  effectiveSafetyPolicy,
  screenSafety,
  validateSafetyPolicy,
} from "../packages/domain/src/safety-policy.ts";

// Outcomes reviewed by hand on realistic member messages (English and Arabic),
// including everyday phrases that must not be routed ("medicine ball",
// "15 minutes late", "break my record", "كسر الروتين").
const reviewed: Array<
  [string, "hold" | "personal_review" | "automatic_allowed"]
> = [
  ["Can we add medicine ball slams to Friday?", "automatic_allowed"],
  [
    "I forgot to take my medicine this morning, can I still train?",
    "personal_review",
  ],
  ["Is creatine ok while cutting?", "personal_review"],
  ["I'm 15 minutes late for today's session", "automatic_allowed"],
  ["I'm 16 years old, is this program ok for me?", "personal_review"],
  ["عمري 16 سنة هل البرنامج مناسب؟", "personal_review"],
  ["I want to break my deadlift record", "automatic_allowed"],
  ["أريد كسر الروتين هذا الأسبوع", "automatic_allowed"],
  ["عندي كسر في العظم من السنة الماضية", "personal_review"],
  ["Had a concussion playing football last week", "hold"],
  ["My doctor says my blood pressure is fine now", "automatic_allowed"],
  [
    "I have high blood pressure, should I avoid heavy squats?",
    "personal_review",
  ],
  ["I binge-watched TV all weekend and skipped training", "automatic_allowed"],
  ["I've been purging after dinners", "personal_review"],
  ["Great session, no pain at all!", "automatic_allowed"],
  ["Should I stop the program? I feel dizzy after squats", "hold"],
  ["ما عندي أي ألم الحمدلله", "automatic_allowed"],
  ["هل آخذ دوائي قبل التمرين؟", "personal_review"],
];
test("reviewed screening outcomes for realistic member messages", () => {
  const policy = effectiveSafetyPolicy({
    key: "coaching-safety-policy",
    version: 1,
    effectiveAt: null,
    content: JSON.stringify({
      schema: 1,
      redFlagTerms: ["concussion"],
      personalReviewCategories: Object.keys(REVIEW_CATEGORIES),
    }),
  });
  for (const [text, expected] of reviewed) {
    const r = screenSafety(text, policy);
    assert.equal(
      r.hold ? "hold" : r.review ? "personal_review" : "automatic_allowed",
      expected,
      text,
    );
  }
});

const HOUR = 3600_000;
let db: Database, app: Awaited<ReturnType<typeof buildApp>>, coach: any;
const admin = Fastify();
async function request(
  url: string,
  method: any = "GET",
  body?: any,
  actor?: any,
) {
  return app.inject({
    url: "/api/v1" + url,
    method,
    headers: {
      origin: "http://localhost:3000",
      ...(actor ? { cookie: actor.cookie } : {}),
    },
    payload: body,
  });
}
const operator = (
  url: string,
  method: any = "GET",
  payload?: any,
  headers = {},
) => admin.inject({ url: "/api/v1" + url, method, payload, headers });
async function join(email: string, subscribed = false) {
  const invite = await request(
    "/invitations",
    "POST",
    { email, role: "subscriber" },
    coach,
  );
  assert.equal(invite.statusCode, 200, invite.body);
  const joined = await request("/invitations/accept", "POST", {
    token: invite.json().url.split("/").pop(),
    name: "Policy Client",
    email,
    password: "PolicyClient2026!",
    accepted: true,
  });
  assert.equal(joined.statusCode, 200, joined.body);
  const cookie = String(joined.headers["set-cookie"]).split(";")[0];
  const user = {
    ...(await request("/bootstrap", "GET", undefined, { cookie })).json().user,
    cookie,
  };
  if (subscribed)
    await db.tenant(coach, (tx) =>
      tx.query(
        "INSERT INTO subscriptions(id,tenant_id,user_id,status,period_end,price_minor) VALUES($1,$2,$3,'active',now()+interval '30 days',10000)",
        [randomUUID(), coach.tenantId, user.userId],
      ),
    );
  return user;
}
async function savePolicy(content: unknown) {
  return operator("/admin/documents", "POST", {
    kind: "safety",
    key: "coaching-safety-policy",
    title: "Coaching safety policy",
    content: typeof content === "string" ? content : JSON.stringify(content),
  });
}
async function publishPolicy(content: unknown) {
  const saved = await savePolicy(content);
  assert.equal(saved.statusCode, 200, saved.body);
  const published = await operator(
    `/admin/documents/${saved.json().id}/publish`,
    "POST",
    {
      revision: 1,
      effectiveAt: new Date(Date.now() - 1000).toISOString(),
      reason: "Reviewed by the safety lead",
    },
  );
  assert.equal(published.statusCode, 200, published.body);
  return published.json();
}
const rows = (userId: string) =>
  db.tenant(coach, (tx) =>
    tx.query(
      "SELECT * FROM records WHERE owner_user_id=$1 AND kind IN ('training_hold','exception') ORDER BY created_at",
      [userId],
    ),
  );
const exceptionOf = async (userId: string, category = "safety"): Promise<any> =>
  (await rows(userId)).find(
    (r) => r.kind === "exception" && r.data.category === category,
  );
const hoursUntilDue = (r: any) =>
  (Date.parse(r.data.reviewDueAt) - new Date(r.created_at).getTime()) / HOUR;

before(async () => {
  db = await createDatabase({ memory: true });
  app = await buildApp({ db, testing: true });
  const r = await request("/auth/register", "POST", {
    name: "Policy Coach",
    email: "policy-coach@example.test",
    password: "PolicyCoach2026!",
    slug: "policy-coach",
    accepted: true,
  });
  assert.equal(r.statusCode, 201, r.body);
  const cookie = String(r.headers["set-cookie"]).split(";")[0];
  coach = {
    ...(await request("/bootstrap", "GET", undefined, { cookie })).json().user,
    cookie,
  };
  admin.setErrorHandler((e: any, _req, reply) =>
    reply
      .code(e.statusCode ?? (e.name === "ZodError" ? 400 : 500))
      .send({ code: e.code, message: e.message }),
  );
  const identity = (req: any) => ({
    tenantId: coach.tenantId,
    userId: coach.userId,
    role: "owner",
    platformRole: String(req.headers["x-role"] ?? "admin"),
    mfaAt: new Date().toISOString(),
  });
  registerAdminOperations(admin, db, identity);
  registerMessaging(admin, db, identity);
});
after(async () => {
  await admin.close();
  await app.close();
  await db.close();
});

test("a document can add terms and shorten deadlines but can never weaken the code floor", () => {
  const weak = [
    { schema: 1, holdReviewHours: 48 },
    { schema: 1, personalReviewHours: 100 },
    { schema: 1, removeRedFlagTerms: ["chest pain"] },
    { schema: 1, exemptCategories: ["pregnancy"] },
    { schema: 1, disableFloor: true },
  ];
  for (const policy of weak) {
    const result = validateSafetyPolicy(JSON.stringify(policy));
    assert.equal(result.ok, false, JSON.stringify(policy));
    assert.equal((result as any).weakening, true, JSON.stringify(policy));
  }
  assert.equal(validateSafetyPolicy("not json").ok, false);
  assert.equal(
    validateSafetyPolicy(
      JSON.stringify({ schema: 1, redFlagTerms: ["<script>"] }),
    ).ok,
    false,
  );
  // A published document that bypassed the draft check is read field by field.
  const bypass = effectiveSafetyPolicy({
    key: "coaching-safety-policy",
    version: 9,
    effectiveAt: null,
    content: JSON.stringify({
      schema: 1,
      holdReviewHours: 500,
      personalReviewHours: 0.5,
      removeRedFlagTerms: ["pain"],
      redFlagTerms: ["dialysis", 7],
      personalReviewCategories: ["medication", "anything"],
    }),
  });
  assert.equal(bypass.holdReviewHours, SAFETY_FLOOR.holdReviewHours);
  assert.equal(bypass.personalReviewHours, SAFETY_FLOOR.minimumHours);
  assert.deepEqual(bypass.redFlagTerms, ["dialysis"]);
  assert.deepEqual(bypass.personalReviewCategories, ["medication"]);
  assert.ok(bypass.pin.ignored.includes("unknown field removeRedFlagTerms"));
  // The floor still screens everything the code floor screens.
  for (const text of [
    "My chest pain is back",
    "عندي ألم في الصدر",
    "I feel dizzy",
  ])
    assert.equal(screenSafety(text, bypass).hold, true, text);
  const arabic = screenSafety("بعد غسيل الكلى تعبت", {
    redFlagTerms: ["غسيل الكلى"],
    personalReviewCategories: [],
    personalReviewTerms: [],
  });
  assert.equal(arabic.hold, true);
  const review = screenSafety("Can I train with my diabetes?", bypass);
  assert.equal(review.hold, false);
  assert.equal(review.review, false, "chronic conditions were not selected");
  assert.equal(
    screenSafety("Do I take my medication first?", bypass).review,
    true,
  );
});

test("the published policy drives holds, pins its version and tightens escalation", async () => {
  const early = await join("policy-early@example.test");
  const floorOnly = await join("policy-floor@example.test");
  // No policy yet: a policy term is ordinary text, the code floor still holds.
  assert.equal(
    (
      await request(
        "/messages",
        "POST",
        { text: "I had dialysis yesterday" },
        early,
      )
    ).statusCode,
    200,
  );
  assert.equal(await exceptionOf(early.userId), undefined);
  assert.equal(
    (
      await request(
        "/messages",
        "POST",
        { text: "Chest pain after my run" },
        floorOnly,
      )
    ).statusCode,
    200,
  );
  const floorException = await exceptionOf(floorOnly.userId);
  assert.equal(floorException.data.safetyPolicy.source, "floor");
  assert.equal(floorException.data.safetyPolicy.version, null);
  assert.equal(floorException.data.trigger, "code_floor");
  assert.ok(Math.abs(hoursUntilDue(floorException) - 24) < 0.05);
  const now = Date.now();
  assert.equal(
    await scheduleSafetyEscalations(
      db,
      coach.tenantId,
      new Date(now + 7 * HOUR),
    ),
    0,
    "the 24-hour floor deadline has not passed",
  );

  // Weakening drafts are refused with a clear code.
  for (const [content, code] of [
    [{ schema: 1, holdReviewHours: 72 }, "SAFETY_POLICY_WEAKENS"],
    [{ schema: 1, disableFloor: true }, "SAFETY_POLICY_WEAKENS"],
    ["{not json", "SAFETY_POLICY_INVALID"],
  ] as const) {
    const refused = await savePolicy(content);
    assert.equal(refused.statusCode, 400, refused.body);
    assert.equal(refused.json().code, code);
  }
  const checked = await operator("/admin/safety-policy/check", "POST", {
    content: JSON.stringify({ schema: 1, holdReviewHours: 30 }),
  });
  assert.equal(checked.json().ok, false);
  assert.match(checked.json().errors[0], /24-hour safety floor/);
  const v1 = await publishPolicy({
    schema: 1,
    summary:
      "Kidney treatment pauses training; medication questions go to the coach.",
    redFlagTerms: ["dialysis"],
    personalReviewCategories: ["medication"],
    holdReviewHours: 6,
    personalReviewHours: 12,
  });
  assert.equal(v1.version, 1);

  // The same words now pause training, pinned to version 1 with a 6h deadline.
  const later = await join("policy-later@example.test");
  assert.equal(
    (
      await request(
        "/messages",
        "POST",
        { text: "I had dialysis yesterday" },
        later,
      )
    ).statusCode,
    200,
  );
  const [hold] = (await rows(later.userId)).filter(
    (r) => r.kind === "training_hold",
  );
  assert.equal(hold.status, "active");
  assert.equal(hold.data.safetyPolicy.version, 1);
  const policyException = await exceptionOf(later.userId);
  assert.equal(policyException.data.trigger, "policy_term");
  assert.deepEqual(policyException.data.screening.policyTerms, ["dialysis"]);
  assert.equal(policyException.data.safetyPolicy.version, 1);
  assert.ok(Math.abs(hoursUntilDue(policyException) - 6) < 0.05);
  const trainerView = await request("/safety/policy", "GET", undefined, coach);
  assert.equal(trainerView.statusCode, 200, trainerView.body);
  assert.equal(trainerView.json().version, 1);
  assert.equal(trainerView.json().holdReviewHours, 6);
  assert.equal(
    (await request("/safety/policy", "GET", undefined, later)).statusCode,
    403,
  );

  // Seven hours on, the stricter policy escalates both open holds once,
  // including the one opened under the 24-hour floor.
  assert.equal(
    await scheduleSafetyEscalations(
      db,
      coach.tenantId,
      new Date(now + 7 * HOUR),
    ),
    2,
  );
  assert.equal(
    await scheduleSafetyEscalations(
      db,
      coach.tenantId,
      new Date(now + 8 * HOUR),
    ),
    0,
  );
  const overdue = await exceptionOf(floorOnly.userId);
  assert.ok(overdue.data.overdueAt);
  assert.equal(overdue.data.escalation.safetyPolicy.version, 1);
  const alerts = await db.tenant(coach, (tx) =>
    tx.query(
      "SELECT * FROM notifications WHERE user_id=$1 AND dedupe_key LIKE 'safety-overdue:%'",
      [coach.userId],
    ),
  );
  assert.equal(alerts.length, 2);
  assert.equal(alerts[0].category, "safety");
  assert.equal(alerts[0].data.template.key, "safety-review-overdue");
  const events = await db.tenant(coach, (tx) =>
    tx.query(
      "SELECT subject_id,data FROM events WHERE name='safety.review_overdue'",
    ),
  );
  assert.equal(events.length, 2);
  const queue = await operator(
    `/admin/operations/safety?tenantId=${coach.tenantId}`,
  );
  assert.equal(queue.statusCode, 200, queue.body);
  const flagged = queue.json().rows.filter((r: any) => r.overdue_at);
  assert.equal(flagged.length, 2);
  assert.ok(queue.json().rows[0].overdue_at, "overdue reviews sort first");
});

test("policy personal-review topics bypass automatic coaching and the model", async () => {
  const member = await join("policy-review@example.test", true);
  const originalFetch = globalThis.fetch;
  let modelCalls = 0;
  globalThis.fetch = async (...args) => {
    modelCalls++;
    return originalFetch(...args);
  };
  try {
    const asked = await request(
      "/coaching/ask",
      "POST",
      { message: "Should I take my medication before training?" },
      member,
    );
    assert.equal(asked.statusCode, 200, asked.body);
    assert.match(asked.json().data.text, /answer this question personally/);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(modelCalls, 0);
  const review = await exceptionOf(member.userId, "policy_review");
  assert.equal(review.status, "open");
  assert.deepEqual(review.data.screening.reviewCategories, ["medication"]);
  assert.equal(review.data.safetyPolicy.version, 1);
  assert.ok(Math.abs(hoursUntilDue(review) - 12) < 0.05);
  assert.equal(
    (await rows(member.userId)).some((r) => r.kind === "training_hold"),
    false,
    "a personal review never pauses training",
  );
  const [notice] = await db.tenant(coach, (tx) =>
    tx.query("SELECT * FROM notifications WHERE user_id=$1 AND dedupe_key=$2", [
      coach.userId,
      `policy-review:${review.id}`,
    ]),
  );
  assert.equal(notice.data.template.key, "policy-review");
});

test("a published document that bypasses the draft check cannot weaken runtime handling", async () => {
  await db.system((tx) =>
    tx.query(
      "INSERT INTO admin_documents(id,kind,key,version,title,content,status,effective_at,created_by,published_by,published_at) VALUES($1,'safety','coaching-safety-policy',2,'Tampered policy',$2,'published',now()-interval '1 second',$3,$3,now())",
      [
        randomUUID(),
        JSON.stringify({
          schema: 1,
          holdReviewHours: 240,
          removeRedFlagTerms: ["chest pain"],
          personalReviewCategories: ["medication"],
        }),
        coach.userId,
      ],
    ),
  );
  const policy = await db.tenant(coach, activeSafetyPolicy);
  assert.equal(policy.pin.version, 2);
  assert.equal(policy.holdReviewHours, SAFETY_FLOOR.holdReviewHours);
  assert.ok(policy.pin.ignored.some((x) => /removeRedFlagTerms/.test(x)));
  const member = await join("policy-tampered@example.test");
  assert.equal(
    (
      await request(
        "/messages",
        "POST",
        { text: "My chest pain is back" },
        member,
      )
    ).statusCode,
    200,
  );
  const exception = await exceptionOf(member.userId);
  assert.equal(exception.data.safetyPolicy.version, 2);
  assert.ok(exception.data.safetyPolicy.ignored.length >= 2);
  assert.ok(Math.abs(hoursUntilDue(exception) - 24) < 0.05);
  const summary = await operator("/admin/safety-policy");
  assert.equal(summary.statusCode, 200, summary.body);
  assert.equal(summary.json().active.version, 2);
  assert.ok(summary.json().active.ignored.length >= 2);
  assert.equal(
    (
      await operator("/admin/safety-policy", "GET", undefined, {
        "x-role": "finance",
      })
    ).statusCode,
    403,
  );
});
