// Round 4 safety and privacy review fixes (docs/features/r4-review.md):
// impersonating addresses and names, the sign-up email limit for existing
// accounts, sign-up code retention and erasure, and bounded website imports.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import { createDatabase, type Database } from "@trainer/db";
import { slugProblem } from "../packages/domain/src/web-address.ts";
import {
  pageIssues,
  realNameProblem,
  subdomainCandidates,
} from "../packages/domain/src/coach-setup.ts";
import { withRuntimeConfig } from "../packages/providers/src/configuration.ts";
import {
  registerCoachSignup,
  SIGNUP_CODES_PER_HOUR,
} from "../apps/api/src/coach-signup.ts";
import { registerCoachSetup } from "../apps/api/src/coach-setup.ts";
import { scrubUnusedAccount } from "../apps/api/src/privacy-lifecycle.ts";
import { readLimitedText } from "../apps/api/src/setup-assistant.ts";
import { suggestionIssues } from "../packages/domain/src/brain-learning.ts";

let db: Database, app: ReturnType<typeof Fastify>;
const actors = new Map<string, any>();
const sent: Array<{ to: string; subject: string; text: string }> = [];
const config = {
  LEGAL_APPROVED: "true",
  PLATFORM_ROOT_DOMAIN: "trainsyou.test",
  RESEND_API_KEY: "synthetic-resend-only",
  RESEND_FROM: "hello@trainsyou.test",
};
const call = (path: string, method: any = "GET", payload?: unknown, who?: any) =>
  withRuntimeConfig(config, () =>
    app.inject({
      url: path,
      method,
      payload,
      headers: who ? { "x-fixture-user": who.userId } : {},
    }),
  );

async function account(email: string, withWorkspace = true) {
  const a = {
    tenantId: randomUUID(),
    userId: randomUUID(),
    role: "owner",
    emailVerified: true,
    mfaAt: new Date().toISOString(),
    platformRole: "none",
  };
  await db.system(async (tx) => {
    await tx.query(
      "INSERT INTO users(id,email,name,password_hash,email_verified) VALUES($1,$2,'Layla Haddad','synthetic',true)",
      [a.userId, email],
    );
    if (!withWorkspace) return;
    await tx.query("INSERT INTO tenants(id,slug,name) VALUES($1,$2,'Layla Haddad')", [
      a.tenantId,
      "review-" + a.tenantId.slice(0, 8),
    ]);
    await tx.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')",
      [a.tenantId, a.userId],
    );
  });
  actors.set(a.userId, a);
  return a;
}

before(async () => {
  db = await createDatabase({ memory: true });
  app = Fastify();
  app.addHook(
    "onRequest",
    (req: FastifyRequest, _reply: FastifyReply, done: (e?: Error) => void) => {
      const a = actors.get(String(req.headers["x-fixture-user"]));
      if (a) (req as any).identity = a;
      withRuntimeConfig(config, done);
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
  registerCoachSignup(app, db, async () => {}, {
    sendEmail: async (to, subject, text) => {
      sent.push({ to, subject, text });
    },
  });
  registerCoachSetup(app, db, identity);
});
after(async () => {
  await app.close();
  await db.close();
});

test("new addresses cannot carry the platform's name or pose as its staff pages", async () => {
  for (const slug of [
    "trainsyou-support",
    "support-trainsyou",
    "mytrainsyou",
    "trains-you-coach",
    "official-billing",
    "login-help",
    "sara-support",
    "admin-team",
    "verify-account",
  ])
    assert.equal(slugProblem(slug), "reserved", slug);
  for (const slug of ["sara-mansour", "supportive-coach", "adminah-fit", "layla-strength"])
    assert.equal(slugProblem(slug), null, slug);
  // Suggestions from a name never offer an impersonating address.
  for (const s of subdomainCandidates("Trainsyou Support", "42"))
    assert.equal(slugProblem(s), null, s);

  const a = await account(`slug.${randomUUID().slice(0, 6)}@example.test`);
  const check = await call("/api/v1/setup/subdomain/check?name=trainsyou-help", "GET", undefined, a);
  assert.equal(check.statusCode, 200, check.body);
  assert.equal(check.json().available, false);
  assert.equal(check.json().reason, "reserved");
  const reserve = await call(
    "/api/v1/setup/subdomain",
    "PUT",
    { name: "official-support", currentSlug: "review-" + a.tenantId.slice(0, 8), version: 0 },
    a,
  );
  assert.equal(reserve.statusCode, 400, reserve.body);
  assert.equal(reserve.json().code, "RESERVED_SLUG");
});

test("a coach's name and page name cannot pass them off as the platform", () => {
  assert.equal(realNameProblem("Trainsyou Support"), "placeholder");
  assert.equal(realNameProblem("Trains You Team"), "placeholder");
  assert.equal(realNameProblem("Sara Mansour"), null);
  assert.deepEqual(pageIssues({ name: "trainsyou Official Coaching" }), [
    { field: "name", issue: "platform_name" },
  ]);
  // Mentioning the platform in the bio is fine.
  assert.deepEqual(
    pageIssues({ name: "Sara Mansour", bio: "Train with me on trainsyou every week." }),
    [],
  );
});

test("the 'you already have an account' email counts toward the hourly limit; old codes are pruned", async () => {
  const email = `existing.${randomUUID().slice(0, 6)}@example.test`;
  await account(email);
  const before = sent.length;
  for (let i = 0; i < SIGNUP_CODES_PER_HOUR; i++) {
    const r = await call("/api/v1/auth/signup/code", "POST", { email });
    assert.equal(r.statusCode, 200, r.body);
  }
  assert.equal(sent.length - before, SIGNUP_CODES_PER_HOUR);
  const limited = await call("/api/v1/auth/signup/code", "POST", { email });
  assert.equal(limited.statusCode, 429);
  assert.equal(sent.length - before, SIGNUP_CODES_PER_HOUR);
  // The limit rows hold no usable code.
  const rows = await db.system((tx) =>
    tx.query("SELECT consumed_at FROM coach_signup_codes WHERE email=$1", [email]),
  );
  assert.ok(rows.length === SIGNUP_CODES_PER_HOUR && rows.every((r) => r.consumed_at));

  // A code row older than a day is deleted by the next request.
  const stale = `stale.${randomUUID().slice(0, 6)}@example.test`;
  await db.system((tx) =>
    tx.query(
      "INSERT INTO coach_signup_codes(id,email,code_hash,expires_at,created_at) VALUES($1,$2,$3,now()-interval '47 hours',now()-interval '2 days')",
      [randomUUID(), stale, "a".repeat(64)],
    ),
  );
  const fresh = await call("/api/v1/auth/signup/code", "POST", {
    email: `fresh.${randomUUID().slice(0, 6)}@example.test`,
  });
  assert.equal(fresh.statusCode, 200, fresh.body);
  const [left] = await db.system((tx) =>
    tx.query("SELECT count(*)::int AS n FROM coach_signup_codes WHERE email=$1", [stale]),
  );
  assert.equal(left.n, 0);
});

test("erasing an account removes its sign-up codes and its address on coach reports", async () => {
  const email = `erase.${randomUUID().slice(0, 6)}@example.test`;
  const reported = await account(`coach.${randomUUID().slice(0, 6)}@example.test`);
  const person = await account(email, false);
  await db.system(async (tx) => {
    await tx.query(
      "INSERT INTO coach_signup_codes(id,email,code_hash,expires_at) VALUES($1,$2,$3,now()+interval '10 minutes')",
      [randomUUID(), email, "b".repeat(64)],
    );
    await tx.query(
      "INSERT INTO coach_reports(id,tenant_id,reason,details,reporter_email,reporter_user_id) VALUES($1,$2,'other','Synthetic report',$3,$4)",
      [randomUUID(), reported.tenantId, email, person.userId],
    );
  });
  await db.system((tx) => tx.acrossWorkspaces((tx) => scrubUnusedAccount(tx, person.userId)));
  const [codes] = await db.system((tx) =>
    tx.query("SELECT count(*)::int AS n FROM coach_signup_codes WHERE email=$1", [email]),
  );
  assert.equal(codes.n, 0);
  const [report] = await db.system(
    (tx) =>
      tx.query(
        "SELECT reporter_email,reporter_user_id,details FROM coach_reports WHERE tenant_id=$1",
        [reported.tenantId],
      ),
    { tenantId: reported.tenantId },
  );
  assert.equal(report.reporter_email, "");
  assert.equal(report.reporter_user_id, null);
  assert.equal(report.details, "Synthetic report");
});

test("website imports read at most the size limit and refuse larger pages", async () => {
  assert.equal(await readLimitedText(new Response("Short page text"), 1024), "Short page text");
  assert.equal(
    await readLimitedText(
      new Response("x", { headers: { "content-length": String(10 * 1024 * 1024) } }),
      1024,
    ),
    null,
  );
  // A body larger than declared (or with no length) stops while streaming.
  let pulled = 0;
  const endless = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulled++;
      controller.enqueue(new Uint8Array(512));
    },
  });
  assert.equal(await readLimitedText(new Response(endless), 4096), null);
  assert.ok(pulled < 20, `stopped after ${pulled} chunks`);
});

test("Arabic medical claims on the public page block go-live (live Seed draft A5)", () => {
  for (const bio of [
    "أعالج مرض السكري ونتائج مضمونة.",
    "نعالج آلام الظهر بدون أدوية",
    "نتائج مضمونة خلال شهر",
    "برنامج يشفي من السكري",
  ])
    assert.deepEqual(
      pageIssues({ bio }).map((i) => i.issue),
      ["medical_claim"],
      bio,
    );
  for (const bio of ["أدرب الأمهات الجدد على رفع الأثقال", "تمارين قصيرة في وقت الغداء"])
    assert.deepEqual(pageIssues({ bio }), [], bio);
});

test("suggested rules that share other clients' data or decide sending are withheld (live Seed C4, C5)", () => {
  const source = {
    kind: "edit" as const,
    category: "message",
    draft: "OK.",
    coachReply: "OK.",
    coachNote: null,
  };
  const rule = (condition: string, directive: string) => ({
    title: "Learned from a correction",
    category: "communication" as const,
    condition,
    directive,
  });
  assert.ok(
    suggestionIssues(
      rule("When acknowledging a client's weekly work", "Tell clients what other group clients weigh so they compete"),
      source,
    ).includes("other_clients"),
  );
  assert.ok(
    suggestionIssues(
      rule("When a client reply draft is correct", "Send the reply without asking the coach"),
      source,
    ).includes("sending_control"),
  );
  assert.ok(
    suggestionIssues(
      rule("When a client asks a routine question", "Reply automatically and skip the coach"),
      source,
    ).includes("sending_control"),
  );
  // Ordinary coaching rules are not caught.
  for (const [c, d] of [
    ["When a client reports a finished session", "Reply in two short sentences with no exclamation marks"],
    ["When a client misses a session", "Tell them not to double up and do the next planned session"],
    ["When the leg press is busy", "Swap to goblet squats without asking the client to wait"],
  ])
    assert.deepEqual(
      suggestionIssues(rule(c, d), { ...source, coachReply: c + " " + d }).filter(
        (i) => i === "other_clients" || i === "sending_control",
      ),
      [],
      d,
    );
});
