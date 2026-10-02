// Open coach sign-up (email codes through Resend), the six-step setup wizard,
// subdomain reservation, automatic go-live checks and "Report this coach".
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import { createDatabase, putRecord, type Database } from "@trainer/db";
import {
  brainCaseCoverage,
  SETUP_BRAIN_MINIMUM,
} from "../packages/contracts/src/coach-setup.ts";
import {
  pageIssues,
  realNameProblem,
  slugFromName,
  subdomainCandidates,
} from "../packages/domain/src/coach-setup.ts";
import { emailCodesEnabled, emailTransport } from "@trainer/providers";
import { withRuntimeConfig } from "../packages/providers/src/configuration.ts";
import { registerCoachSignup } from "../apps/api/src/coach-signup.ts";
import { registerCoachSetup } from "../apps/api/src/coach-setup.ts";
import { createModule, createTemplate } from "../packages/contracts/src/site-builder.ts";

let db: Database, app: ReturnType<typeof Fastify>;
const actors = new Map<string, any>();
const sent: Array<{ to: string; subject: string; text: string }> = [];
const sessions: Array<{ userId: string; tenantId: string; method: string }> =
  [];
const config = {
  LEGAL_APPROVED: "true",
  STRIPE_SECRET_KEY: "synthetic-setup-only",
  COMMERCE_APPROVED: "true",
  MODEL_BASE_URL: "https://model.setup.invalid",
  MODEL_API_KEY: "synthetic-setup-only",
  MODEL_NAME: "setup-fixture",
  PLATFORM_ROOT_DOMAIN: "trainsyou.test",
  RESEND_API_KEY: "synthetic-resend-only",
  RESEND_FROM: "hello@trainsyou.test",
};
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

function call(
  path: string,
  method: any = "GET",
  payload?: unknown,
  who?: any,
  overrides: Record<string, string | undefined> = {},
) {
  return withRuntimeConfig({ ...config, ...overrides }, () =>
    app.inject({
      url: path,
      method,
      payload,
      headers: {
        ...(who ? { "x-fixture-user": who.userId } : {}),
        "x-fixture-config": JSON.stringify(overrides),
      },
    }),
  );
}
async function coach(
  options: { name?: string; email?: string; slug?: string; theme?: any } = {},
) {
  const a = {
    tenantId: randomUUID(),
    userId: randomUUID(),
    role: "owner",
    emailVerified: true,
    mfaAt: new Date().toISOString(),
    platformRole: "none",
  };
  const slug = options.slug ?? "wizard-" + a.tenantId.slice(0, 8);
  await db.system(async (tx) => {
    await tx.query(
      "INSERT INTO tenants(id,slug,name,theme) VALUES($1,$2,'Layla Haddad',$3)",
      [
        a.tenantId,
        slug,
        JSON.stringify(
          options.theme ?? {
            headline: "Strength for busy parents",
            bio: "Coached in Dubai for eight years. Short, steady sessions that fit family life.",
            category: "Strength training",
          },
        ),
      ],
    );
    await tx.query(
      "INSERT INTO users(id,email,name,password_hash,email_verified) VALUES($1,$2,$3,'synthetic',true)",
      [
        a.userId,
        options.email ?? a.userId + "@example.test",
        options.name ?? "Layla Haddad",
      ],
    );
    await tx.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')",
      [a.tenantId, a.userId],
    );
  });
  actors.set(a.userId, a);
  return { ...a, slug };
}
async function legalDocuments(by: string) {
  const [existing] = await db.system((tx) =>
    tx.query(
      "SELECT count(*)::int AS n FROM admin_documents WHERE kind='legal' AND status='published'",
    ),
  );
  if (existing.n >= 3) return;
  for (const key of ["terms", "privacy", "ai-disclosure"])
    await db.system((tx) =>
      tx.query(
        "INSERT INTO admin_documents(id,kind,key,version,title,content,status,effective_at,created_by,published_at) VALUES($1,'legal',$2,1,$3,'Synthetic fixture text, not approved production copy','published',now()-interval '1 minute',$4,now())",
        [randomUUID(), key, "Synthetic " + key, by],
      ),
    );
}
/** A confirmed rule, `quiz` platform quiz answers and `own` coach cases, evaluated and released. */
async function teach(a: any, quiz: number, own: number, release = true) {
  return db.tenant(a, async (tx) => {
    const rule = await putRecord(
      tx,
      a,
      "rule",
      {
        title: "Consistency",
        directive: "Follow the planned routine",
        allowedUses: ["model_prompt"],
      },
      { status: "confirmed" },
    );
    for (let i = 0; i < quiz + own; i++)
      await putRecord(
        tx,
        a,
        "scenario",
        {
          prompt: `Synthetic case ${i}`,
          expectedEvidenceId: rule.id,
          expectEscalation: i < quiz,
          heldOut: true,
          ...(i < quiz ? { origin: "platform_quiz" } : {}),
        },
        { status: "held_out" },
      );
    if (!release) return;
    const rules = (
      await tx.query(
        "SELECT * FROM records WHERE kind='rule' AND status='confirmed' ORDER BY id",
      )
    ).map((r) => ({ id: r.id, data: r.data, version: r.version }));
    const scenarios = await tx.query(
      "SELECT id FROM records WHERE kind='scenario' ORDER BY id",
    );
    const evaluation = await putRecord(
      tx,
      a,
      "evaluation",
      {
        rulesDigest: hash(rules),
        total: scenarios.length,
        passed: scenarios.length,
        outcomes: scenarios.map((r) => ({ scenarioId: r.id, passed: true })),
      },
      { status: "passed" },
    );
    await putRecord(
      tx,
      a,
      "brain_release",
      { rules, evaluationId: evaluation.id, mode: "supervised" },
      { status: "published" },
    );
  });
}
async function pricedPlan(a: any) {
  await db.tenant(a, (tx) =>
    putRecord(
      tx,
      a,
      "product",
      {
        name: "Monthly coaching",
        description: "Weekly plan and check-ins",
        tier: "workout",
        billing: "monthly",
        stripePriceId: "fixture-price",
        priceMinor: 40000,
      },
      { status: "published" },
    ),
  );
}
async function wizard(a: any, overrides?: Record<string, string | undefined>) {
  const r = await call("/api/v1/setup", "GET", undefined, a, overrides);
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}
const stepOf = (s: any, key: string) =>
  s.steps.find((x: any) => x.key === key);
const checkOf = (s: any, key: string) =>
  s.goLive.checks.find((x: any) => x.key === key);

before(async () => {
  db = await createDatabase({ memory: true });
  app = Fastify();
  app.addHook(
    "onRequest",
    (req: FastifyRequest, _reply: FastifyReply, done: (e?: Error) => void) => {
      const a = actors.get(String(req.headers["x-fixture-user"]));
      if (a) (req as any).identity = a;
      withRuntimeConfig(
        {
          ...config,
          ...JSON.parse(String(req.headers["x-fixture-config"] ?? "{}")),
        },
        done,
      );
    },
  );
  app.setErrorHandler((e: any, _req: FastifyRequest, reply: FastifyReply) =>
    reply
      .code(e instanceof z.ZodError ? 400 : (e.statusCode ?? 500))
      .send({ message: e.message, code: e.code }),
  );
  const identity = (req: FastifyRequest) => {
    const a = (req as any).identity;
    if (!a)
      throw Object.assign(new Error("Please sign in"), {
        statusCode: 401,
        code: "AUTH_REQUIRED",
      });
    return a;
  };
  registerCoachSignup(
    app,
    db,
    async (_reply, userId, tenantId, _mfa, method) => {
      sessions.push({ userId, tenantId, method: String(method) });
    },
    {
      sendEmail: async (to, subject, text) => {
        sent.push({ to, subject, text });
      },
    },
  );
  registerCoachSetup(app, db, identity);
});
after(async () => {
  await app.close();
  await db.close();
});

test("go-live name and page checks: real names pass, placeholders, contact details and medical claims fail", () => {
  assert.equal(realNameProblem("Layla Haddad"), null);
  assert.equal(realNameProblem("محمد العلي"), null);
  assert.equal(realNameProblem("Jean-Luc O'Neill"), null);
  assert.equal(realNameProblem(""), "missing");
  assert.equal(realNameProblem("Layla"), "too_short");
  assert.equal(realNameProblem("Test User"), "placeholder");
  assert.equal(realNameProblem("Coach Trainer"), "placeholder");
  assert.equal(realNameProblem("Layla 2024"), "not_a_name");
  assert.equal(realNameProblem("layla@example.com x"), "not_a_name");
  assert.deepEqual(
    pageIssues({
      bio: "Strength coaching for busy parents in Dubai. I work alongside your physio after an injury.",
    }),
    [],
  );
  const issues = pageIssues({
    headline: "Call me on +971 50 123 4567",
    bio: "My plan cures type 2 diabetes. Visit www.example.com",
    plans: [{ name: "Lose 10 kg in 2 weeks, guaranteed" }],
    website: { sections: [{ text: "Take ibuprofen and train through the pain" }] },
    contactEmail: "coach@example.com",
    // The website's own contact fields are offered on purpose.
    whatsapp: "+971501234567",
    instagram: "https://instagram.com/layla.fit",
  });
  const got = issues.map((i) => `${i.field}:${i.issue}`).sort();
  assert.deepEqual(got, [
    "bio:link",
    "bio:medical_claim",
    "headline:contact",
    "plans[0].name:medical_claim",
    "website.sections[0].text:medical_claim",
  ]);
});

test("subdomain suggestions are valid, unreserved names and brain coverage needs the coach's own cases", () => {
  assert.equal(slugFromName("Layla Haddád"), "layla-haddad");
  assert.equal(slugFromName("محمد"), "coach");
  assert.equal(slugFromName("7 Day Fit"), "coach-7-day-fit");
  const names = subdomainCandidates("Admin", "12");
  assert.ok(!names.includes("admin"));
  assert.ok(names.every((n) => /^[a-z][a-z0-9-]{2,39}$/.test(n)));
  const cases = (quiz: number, own: number) => [
    ...Array.from({ length: quiz }, () => ({ data: { origin: "platform_quiz" } })),
    ...Array.from({ length: own }, () => ({ data: {} })),
  ];
  assert.equal(brainCaseCoverage(cases(8, 3)).enough, true);
  assert.equal(brainCaseCoverage(cases(7, 3)).enough, false);
  assert.equal(brainCaseCoverage(cases(8, 2)).enough, false);
  assert.equal(brainCaseCoverage(cases(0, 20)).enough, true);
  assert.equal(brainCaseCoverage(cases(20, 0)).enough, false);
  assert.equal(brainCaseCoverage(cases(18, 2)).enough, false);
});

test("Resend is used once its key is saved; email codes stay off until then", () => {
  assert.equal(emailTransport({}), null);
  assert.equal(emailCodesEnabled({}), false);
  const generic = {
    EMAIL_API_URL: "https://mail.invalid/send",
    EMAIL_API_KEY: "k",
    EMAIL_FROM: "a@b.test",
  };
  assert.equal(emailTransport(generic)?.provider, "generic");
  assert.equal(emailCodesEnabled(generic), false);
  const resend = { ...generic, RESEND_API_KEY: "r", RESEND_FROM: "hi@b.test" };
  assert.deepEqual(emailTransport(resend), {
    provider: "resend",
    url: "https://api.resend.com/emails",
    key: "r",
    from: "hi@b.test",
  });
  assert.equal(emailCodesEnabled(resend), true);
});

test("email-code sign-up: options, code limits, wrong guesses, a verified new coach and no account disclosure", async () => {
  const off = await call("/api/v1/public/signup-options", "GET", undefined, undefined, {
    RESEND_API_KEY: "",
  });
  assert.deepEqual(off.json().methods, {
    emailCode: false,
    password: true,
    google: false,
    apple: false,
  });
  assert.equal(off.json().earlyAccess, false);
  const noKey = await call(
    "/api/v1/auth/signup/code",
    "POST",
    { email: "new.coach@example.test" },
    undefined,
    { RESEND_API_KEY: "" },
  );
  assert.equal(noKey.statusCode, 503);
  assert.equal(noKey.json().code, "EMAIL_CODES_OFF");
  assert.equal(
    (await call("/api/v1/public/signup-options")).json().methods.emailCode,
    true,
  );

  const email = `sara.${randomUUID().slice(0, 6)}@example.test`;
  const requested = await call("/api/v1/auth/signup/code", "POST", {
    email: email.toUpperCase(),
  });
  assert.equal(requested.statusCode, 200, requested.body);
  const mail = sent.at(-1)!;
  assert.equal(mail.to, email);
  const code = mail.text.match(/\b(\d{6})\b/)![1];
  // Only a salted hash is stored.
  const [row] = await db.system((tx) =>
    tx.query("SELECT code_hash FROM coach_signup_codes WHERE email=$1", [email]),
  );
  assert.ok(!row.code_hash.includes(code));
  const wrong = code === "000000" ? "111111" : "000000";
  const body = (c: string) => ({
    email,
    code: c,
    name: "Sara Mansour",
    accepted: true,
  });
  const bad = await call("/api/v1/auth/signup/verify", "POST", body(wrong));
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.json().code, "INVALID_CODE");
  const [counted] = await db.system((tx) =>
    tx.query("SELECT attempts FROM coach_signup_codes WHERE email=$1", [email]),
  );
  assert.equal(counted.attempts, 1);
  const ok = await call("/api/v1/auth/signup/verify", "POST", body(code));
  assert.equal(ok.statusCode, 201, ok.body);
  const created = sessions.at(-1)!;
  assert.equal(created.method, "registration");
  const [user] = await db.system((tx) =>
    tx.query(
      "SELECT u.email_verified,u.password_hash,t.slug,t.name,m.role FROM users u JOIN memberships m ON m.user_id=u.id JOIN tenants t ON t.id=m.tenant_id WHERE u.id=$1",
      [created.userId],
    ),
  );
  assert.equal(user.email_verified, true);
  assert.equal(user.role, "owner");
  assert.match(user.password_hash, /^unusable:/);
  assert.match(user.slug, /^sara-mansour/);
  // A used code cannot be used again.
  const reused = await call("/api/v1/auth/signup/verify", "POST", body(code));
  assert.equal(reused.json().code, "CODE_EXPIRED");

  // An existing account gets an email saying so, and the same reply.
  const again = await call("/api/v1/auth/signup/code", "POST", { email });
  assert.equal(again.statusCode, 200);
  assert.deepEqual(again.json(), requested.json());
  assert.match(sent.at(-1)!.subject, /already have/);
  assert.doesNotMatch(sent.at(-1)!.text, /\b\d{6}\b/);

  // Five wrong guesses end a code.
  const other = `omar.${randomUUID().slice(0, 6)}@example.test`;
  await call("/api/v1/auth/signup/code", "POST", { email: other });
  const otherCode = sent.at(-1)!.text.match(/\b(\d{6})\b/)![1];
  const guess = otherCode === "000000" ? "111111" : "000000";
  for (let i = 0; i < 5; i++)
    await call("/api/v1/auth/signup/verify", "POST", {
      ...body(guess),
      email: other,
    });
  const locked = await call("/api/v1/auth/signup/verify", "POST", {
    ...body(otherCode),
    email: other,
  });
  assert.equal(locked.json().code, "CODE_EXPIRED");
  // Five codes an hour per address.
  for (let i = 0; i < 4; i++)
    assert.equal(
      (await call("/api/v1/auth/signup/code", "POST", { email: other }))
        .statusCode,
      200,
    );
  const limited = await call("/api/v1/auth/signup/code", "POST", {
    email: other,
  });
  assert.equal(limited.statusCode, 429);
});

test("sign-up stays behind the registration gate on a strict deployment", async () => {
  const previous = process.env.NODE_ENV;
  (process.env as Record<string, string | undefined>).NODE_ENV = "production";
  try {
    const closed = await call(
      "/api/v1/auth/signup/code",
      "POST",
      { email: "gate@example.test" },
      undefined,
      { LEGAL_APPROVED: "" },
    );
    assert.equal(closed.statusCode, 503);
    assert.equal(closed.json().code, "LEGAL_PENDING");
    const options = await call(
      "/api/v1/public/signup-options",
      "GET",
      undefined,
      undefined,
      { LEGAL_APPROVED: "" },
    );
    assert.equal(options.json().registrationOpen, false);
    assert.equal(options.json().earlyAccess, true);
    assert.equal(options.json().methods.emailCode, false);
  } finally {
    (process.env as Record<string, string | undefined>).NODE_ENV = previous;
  }
});

test("wizard: six steps, prefill from early access, skip for later, hidden specialties refused", async () => {
  const email = `early.${randomUUID().slice(0, 6)}@example.test`;
  const a = await coach({ email });
  await db.system((tx) =>
    tx.query(
      "INSERT INTO early_access_requests(id,name,email,email_key,instagram,specialty,emirate,consent_version,consented_at) VALUES($1,'Layla H',$2,$2,'layla.fit','weight_loss','dubai','early-access-notice:v1',now())",
      [randomUUID(), email],
    ),
  );
  let s = await wizard(a);
  assert.deepEqual(
    s.steps.map((x: any) => x.key),
    ["account", "about", "page", "brain", "plan", "live"],
  );
  assert.equal(stepOf(s, "account").status, "done");
  assert.equal(s.resumeStep, "about");
  assert.equal(s.about.fromEarlyAccess, true);
  assert.equal(s.about.values.specialty, "weight_loss");
  assert.equal(s.about.values.emirate, "dubai");
  assert.equal(s.about.values.instagram, "layla.fit");
  assert.ok(!s.about.specialties.some((x: any) => x.id === "yoga"));
  assert.ok(s.progress.minutesLeft <= 15);

  const hidden = await call("/api/v1/setup/about", "PUT", {
    version: 0,
    values: { name: "Layla Haddad", specialty: "yoga", audience: "Busy parents" },
  }, a);
  assert.equal(hidden.statusCode, 400);
  assert.equal(hidden.json().code, "SPECIALTY_UNAVAILABLE");
  // Half an answer saves and resumes later.
  const partial = await call("/api/v1/setup/about", "PUT", {
    version: 0,
    values: { name: "Layla Haddad", specialty: "strength" },
  }, a);
  assert.equal(partial.statusCode, 200, partial.body);
  s = await wizard(a);
  assert.equal(stepOf(s, "about").status, "in_progress");
  const stale = await call("/api/v1/setup/about", "PUT", {
    version: 0,
    values: { name: "Layla Haddad" },
  }, a);
  assert.equal(stale.json().code, "STALE_ONBOARDING");
  await call("/api/v1/setup/about", "PUT", {
    version: 1,
    values: {
      name: "Layla Haddad Coaching",
      specialty: "strength",
      audience: "Busy parents who train at home",
    },
  }, a);
  s = await wizard(a);
  assert.equal(stepOf(s, "about").status, "done");
  const [tenant] = await db.system((tx) =>
    tx.query("SELECT name FROM tenants WHERE id=$1", [a.tenantId]),
  );
  assert.equal(tenant.name, "Layla Haddad Coaching");

  const skipped = await call("/api/v1/setup/brain", "PUT", {
    version: 0,
    values: {},
    skip: true,
  }, a);
  assert.equal(skipped.statusCode, 200, skipped.body);
  s = await wizard(a);
  assert.equal(stepOf(s, "brain").status, "skipped");
  assert.equal(s.resumeStep, "page");
  // Skipping never passes a go-live check.
  assert.equal(checkOf(s, "brain_minimum").ok, false);
  assert.match(checkOf(s, "brain_minimum").reason, /practice quiz/);
});

test("subdomain: live availability, reserved and taken names, reserve before launch without a redirect", async () => {
  const taken = await coach();
  const a = await coach();
  const check = (name: string) =>
    call(`/api/v1/setup/subdomain/check?name=${encodeURIComponent(name)}`, "GET", undefined, a);
  const reserved = (await check("admin")).json();
  assert.equal(reserved.available, false);
  assert.equal(reserved.reason, "reserved");
  const format = (await check("a")).json();
  assert.equal(format.reason, "format");
  const busy = (await check(taken.slug)).json();
  assert.equal(busy.available, false);
  assert.equal(busy.reason, "taken");
  assert.ok(busy.suggestions.length > 0);
  assert.ok(busy.suggestions.every((n: string) => n !== taken.slug));
  const wanted = "layla-" + randomUUID().slice(0, 6);
  const free = (await check(wanted)).json();
  assert.equal(free.available, true);
  assert.equal(free.host, `${wanted}.trainsyou.test`);

  let s = await wizard(a);
  assert.equal(s.page.subdomain.confirmed, false);
  const conflict = await call("/api/v1/setup/subdomain", "PUT", {
    name: taken.slug,
    currentSlug: a.slug,
    version: 0,
  }, a);
  assert.equal(conflict.statusCode, 409);
  const staleSlug = await call("/api/v1/setup/subdomain", "PUT", {
    name: wanted,
    currentSlug: "not-mine",
    version: 0,
  }, a);
  assert.equal(staleSlug.json().code, "SLUG_CHANGED");
  const saved = await call("/api/v1/setup/subdomain", "PUT", {
    name: wanted,
    currentSlug: a.slug,
    version: 0,
  }, a);
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().host, `${wanted}.trainsyou.test`);
  s = await wizard(a);
  assert.equal(s.page.subdomain.name, wanted);
  assert.equal(s.page.subdomain.confirmed, true);
  assert.equal(s.page.subdomain.live, false);
  // Nothing was public yet, so the old name is simply free again.
  const redirects = await db.system((tx) =>
    tx.query("SELECT slug FROM tenant_slug_redirects WHERE tenant_id=$1", [
      a.tenantId,
    ]),
  );
  assert.deepEqual(redirects, []);
  assert.equal((await check(a.slug)).json().available, true);
  // Once live, renames go through the web-address screen (keeps a redirect).
  await db.system((tx) =>
    tx.query("UPDATE tenants SET published=true WHERE id=$1", [a.tenantId]),
  );
  const live = await call("/api/v1/setup/subdomain", "PUT", {
    name: wanted + "-x",
    currentSlug: wanted,
    version: saved.json().version,
  }, a);
  assert.equal(live.statusCode, 409);
  assert.equal(live.json().code, "USE_WEB_ADDRESS");
});

test("go live: automatic checks with the wizard's Brain minimum, no bank details, Waits for me mode", async () => {
  const a = await coach({
    theme: {
      headline: "Strength for busy parents",
      bio: "Call +971 50 123 4567. My programme cures back pain.",
      category: "Strength training",
    },
  });
  await legalDocuments(a.userId);
  let s = await wizard(a);
  assert.equal(checkOf(s, "real_name").ok, true);
  assert.equal(checkOf(s, "email_verified").ok, true);
  assert.equal(checkOf(s, "page_clean").ok, false);
  assert.match(checkOf(s, "page_clean").reason, /phone number/);
  assert.equal(checkOf(s, "priced_plan").ok, false);
  assert.equal(stepOf(s, "live").status, "not_started");
  // No bank-detail or payout check before launch.
  assert.ok(!s.goLive.checks.some((c: any) => /payout|bank/.test(c.key)));

  await db.system((tx) =>
    tx.query(
      "UPDATE tenants SET theme=theme||'{\"bio\":\"Coached in Dubai for eight years. Short, steady sessions.\"}'::jsonb WHERE id=$1",
      [a.tenantId],
    ),
  );
  await call("/api/v1/setup/about", "PUT", {
    version: 0,
    values: { name: "Layla Haddad", specialty: "strength", audience: "Busy parents" },
  }, a);
  await teach(a, SETUP_BRAIN_MINIMUM.quiz - 1, SETUP_BRAIN_MINIMUM.own, false);
  s = await wizard(a);
  assert.equal(s.brain.quizAnswered, SETUP_BRAIN_MINIMUM.quiz - 1);
  assert.equal(s.brain.enoughCases, false);
  assert.equal(stepOf(s, "brain").status, "in_progress");
  await db.tenant(a, (tx) =>
    tx.query("DELETE FROM records WHERE kind IN ('rule','scenario')"),
  );
  await teach(a, SETUP_BRAIN_MINIMUM.quiz, SETUP_BRAIN_MINIMUM.own);
  await pricedPlan(a);
  const reserved = await call("/api/v1/setup/subdomain", "PUT", {
    name: a.slug,
    currentSlug: a.slug,
    version: 0,
  }, a);
  assert.equal(reserved.statusCode, 200, reserved.body);
  s = await wizard(a);
  assert.equal(stepOf(s, "brain").status, "done");
  assert.equal(stepOf(s, "plan").status, "done");
  assert.equal(checkOf(s, "page_ready").ok, false);
  const approve = await call("/api/v1/setup/page", "PUT", {
    version: s.page.approvalVersion,
    values: { digest: s.page.digest },
  }, a);
  assert.equal(approve.statusCode, 200, approve.body);
  s = await wizard(a);
  assert.equal(stepOf(s, "page").status, "done");
  assert.deepEqual(
    s.goLive.checks.filter((c: any) => !c.ok).map((c: any) => c.key),
    [],
  );
  assert.equal(s.goLive.ready, true);

  // What waits on trainsyou is one line and blocks launch.
  const waiting = await wizard(a, { COMMERCE_APPROVED: "" });
  assert.deepEqual(waiting.goLive.waitingOnTrainsyou, ["Payments"]);
  assert.equal(stepOf(waiting, "live").status, "waiting");
  const blocked = await call("/api/v1/setup/go-live", "POST", {}, a, {
    COMMERCE_APPROVED: "",
  });
  assert.equal(blocked.statusCode, 409);

  const live = await call("/api/v1/setup/go-live", "POST", {}, a);
  assert.equal(live.statusCode, 200, live.body);
  assert.equal(live.json().mode, "waits_for_me");
  assert.equal(live.json().url, `https://${a.slug}.trainsyou.test`);
  s = await wizard(a);
  assert.equal(stepOf(s, "live").status, "done");
  assert.equal(s.page.subdomain.live, true);
  assert.equal(s.grow.find((g: any) => g.key === "bank").done, false);
});

test("the authenticator is asked on the go-live screen, and a placeholder name blocks launch", async () => {
  const a = await coach({ name: "Test User" });
  let s = await wizard(a);
  assert.equal(checkOf(s, "real_name").ok, false);
  assert.match(checkOf(s, "real_name").reason, /real first and last name/);
  const previous = process.env.NODE_ENV;
  (process.env as Record<string, string | undefined>).NODE_ENV = "production";
  try {
    actors.set(a.userId, { ...actors.get(a.userId), mfaAt: null });
    const r = await call("/api/v1/setup/go-live", "POST", {}, a);
    assert.equal(r.statusCode, 403);
    assert.equal(r.json().code, "MFA_STEP_UP");
    assert.match(r.json().message, /on this screen/);
    assert.doesNotMatch(r.json().message, /Account security/);
  } finally {
    (process.env as Record<string, string | undefined>).NODE_ENV = previous;
  }
  s = await wizard(a);
  assert.equal(s.security.authenticatorEnrolled, false);
});

test("Report this coach: stored for the Super admin, who reviews it; unknown and unpublished pages refused", async () => {
  const a = await coach();
  const unpublished = await call(`/api/v1/public/coaches/${a.slug}/report`, "POST", {
    reason: "medical_claims",
  });
  assert.equal(unpublished.statusCode, 404);
  await db.system((tx) =>
    tx.query("UPDATE tenants SET published=true WHERE id=$1", [a.tenantId]),
  );
  const bad = await call(`/api/v1/public/coaches/${a.slug}/report`, "POST", {
    reason: "because",
  });
  assert.equal(bad.statusCode, 400);
  const r = await call(`/api/v1/public/coaches/${a.slug}/report`, "POST", {
    reason: "medical_claims",
    details: "Says the plan cures diabetes.",
    email: "Visitor@Example.test",
  });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().received, true);

  const coachOnly = await call("/api/v1/admin/coach-reports", "GET", undefined, a);
  assert.equal(coachOnly.statusCode, 403);
  const staff = await coach();
  actors.set(staff.userId, { ...actors.get(staff.userId), platformRole: "admin" });
  const list = await call("/api/v1/admin/coach-reports", "GET", undefined, staff);
  assert.equal(list.statusCode, 200, list.body);
  const report = list
    .json()
    .reports.find((x: any) => x.tenant_id === a.tenantId);
  assert.equal(report.reason, "medical_claims");
  assert.equal(report.reporter_email, "visitor@example.test");
  assert.equal(
    report.suspendPath,
    `/api/v1/admin/governance/workspaces/${a.tenantId}/suspend`,
  );
  const reviewed = await call(
    `/api/v1/admin/coach-reports/${report.id}/review`,
    "POST",
    { status: "actioned", note: "Suspended pending edits" },
    staff,
  );
  assert.equal(reviewed.statusCode, 200, reviewed.body);
  const open = await call("/api/v1/admin/coach-reports", "GET", undefined, staff);
  assert.ok(!open.json().reports.some((x: any) => x.id === report.id));
  const [audit] = await db.system((tx) =>
    tx.query(
      "SELECT action,tenant_id FROM admin_operations_audit WHERE subject_id=$1",
      [report.id],
    ),
  );
  assert.equal(audit.action, "coach_report.reviewed");
  assert.equal(audit.tenant_id, a.tenantId);
});


test("go-live wording checks deep visible builder copy and ignores retired legacy text", async () => {
  const a = await coach();
  const builder = createTemplate("minimal", {name:"Layla Haddad"});
  const custom = createModule("columns");
  builder.pages[0].sections.push(custom);
  const site = {about:"My coaching cures diabetes.",builder};
  await db.tenant(a, (tx) => tx.query(
    "INSERT INTO coach_sites(tenant_id,draft,published) VALUES($1,$2,$2)",
    [a.tenantId,site],
  ));
  assert.equal(checkOf(await wizard(a), "page_clean").ok,true,
    "inactive legacy prose must not block a safe visual website");
  custom.content.elements[0].children[1].text = "My coaching cures diabetes.";
  await db.tenant(a, (tx) => tx.query(
    "UPDATE coach_sites SET published=$2 WHERE tenant_id=$1",[a.tenantId,site],
  ));
  const result = checkOf(await wizard(a), "page_clean");
  assert.equal(result.ok,false,"deeply nested visible medical claims must block launch");
  assert.match(result.reason,/medical|health|claim/i);
});
