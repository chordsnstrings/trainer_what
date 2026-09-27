import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createDatabase, type Database } from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";
import { bootstrapAdmin } from "../apps/api/src/bootstrap-admin.ts";
import { totpAt } from "../apps/api/src/security.ts";

// Found by the end-to-end harness as the restricted runtime role: trainer
// analytics cohorts and the Superadmin subscriber list read users.created_at,
// which the tenant role could not select (migration 061 grants that column).
let db: Database, app: Awaited<ReturnType<typeof buildApp>>;
const origin = "http://localhost:3000";
const cookieOf = (r: any) => String(r.headers["set-cookie"]).split(";")[0];
const call = (url: string, method: any = "GET", payload?: any, cookie?: string) =>
  app.inject({ url, method, payload, headers: { origin, ...(cookie ? { cookie } : {}) } });
let owner = "", tenantId = "";
before(async () => {
  process.env.SECURITY_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
  db = await createDatabase({ memory: true });
  app = await buildApp({ db, testing: true });
  const r = await call("/api/v1/auth/register", "POST", { name: "Dates Coach", email: "dates.coach@example.test", password: "MemberDates2026!", slug: "dates-coach", accepted: true });
  assert.equal(r.statusCode, 201, r.body);
  owner = cookieOf(r);
  tenantId = (await call("/api/v1/bootstrap", "GET", undefined, owner)).json().tenant.id;
  const invite = (await call("/api/v1/invitations", "POST", { email: "dates.member@example.test", role: "subscriber" }, owner)).json();
  const joined = await call("/api/v1/invitations/accept", "POST", { token: invite.url.split("/").pop(), name: "Dates Member", email: "dates.member@example.test", password: "MemberDates2026!", accepted: true });
  assert.equal(joined.statusCode, 200, joined.body);
});
after(async () => {
  await app.close();
  await db.close();
});

test("trainer analytics cohorts read member join dates through the tenant role", async () => {
  const r = await call("/api/v1/analytics/business", "GET", undefined, owner);
  assert.equal(r.statusCode, 200, r.body);
  const cohorts = r.json().cohorts;
  assert.equal(cohorts.reduce((n: number, c: any) => n + c.joined, 0), 1);
});

test("the Superadmin subscriber list reads join dates through the tenant role", async () => {
  await bootstrapAdmin(db, { email: "dates.admin@example.test", name: "Dates Admin", password: "DatesAdminPassword2026!" });
  const login = await call("/api/v1/auth/login", "POST", { email: "dates.admin@example.test", password: "DatesAdminPassword2026!" });
  const admin = cookieOf(login);
  const enrolled = (await call("/api/v1/auth/mfa/enroll", "POST", { password: "DatesAdminPassword2026!" }, admin)).json();
  const confirm = await call("/api/v1/auth/mfa/confirm", "POST", { code: totpAt(enrolled.secret, Math.floor(Date.now() / 30000)) }, admin);
  assert.equal(confirm.statusCode, 200, confirm.body);
  const view = await call(`/api/v1/admin/operations/subscribers?tenantId=${tenantId}`, "GET", undefined, admin);
  assert.equal(view.statusCode, 200, view.body);
  assert.deepEqual(view.json().rows.map((r: any) => r.email), ["dates.member@example.test"]);
});
