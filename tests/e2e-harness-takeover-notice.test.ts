import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createDatabase, type Database } from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";

// Found by the end-to-end harness: the member's conversation reported
// personalReview from the member's own takeover record, but takeover records
// are not a subscriber-visible kind, so a follower never saw that the trainer
// was handling the conversation personally.
let db: Database, app: Awaited<ReturnType<typeof buildApp>>;
const origin = "http://localhost:3000";
const cookieOf = (r: any) => String(r.headers["set-cookie"]).split(";")[0];
const call = (url: string, method: any = "GET", payload?: any, cookie?: string) =>
  app.inject({ url, method, payload, headers: { origin, ...(cookie ? { cookie } : {}) } });
let owner = "", member = "", memberId = "";
before(async () => {
  process.env.SECURITY_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
  db = await createDatabase({ memory: true });
  app = await buildApp({ db, testing: true });
  const r = await call("/api/v1/auth/register", "POST", { name: "Takeover Coach", email: "takeover.coach@example.test", password: "TakeoverNotice2026!", slug: "takeover-coach", accepted: true });
  assert.equal(r.statusCode, 201, r.body);
  owner = cookieOf(r);
  const invite = (await call("/api/v1/invitations", "POST", { email: "takeover.member@example.test", role: "subscriber" }, owner)).json();
  const joined = await call("/api/v1/invitations/accept", "POST", { token: invite.url.split("/").pop(), name: "Takeover Member", email: "takeover.member@example.test", password: "TakeoverNotice2026!", accepted: true });
  assert.equal(joined.statusCode, 200, joined.body);
  member = cookieOf(joined);
  memberId = (await call("/api/v1/bootstrap", "GET", undefined, member)).json().user.userId;
});
after(async () => {
  await app.close();
  await db.close();
});

const personalReview = async (cookie: string, query = "") => {
  const r = await call("/api/v1/messages/thread" + query, "GET", undefined, cookie);
  assert.equal(r.statusCode, 200, r.body);
  return r.json().personalReview;
};

test("the member sees when the trainer takes over the conversation, and when it ends", async () => {
  assert.equal(await personalReview(member), false);
  assert.equal((await call("/api/v1/takeover", "POST", { subscriberId: memberId, active: true }, owner)).statusCode, 200);
  assert.equal(await personalReview(member), true, "member sees the personal takeover");
  assert.equal(await personalReview(owner, `?subscriberId=${memberId}`), true, "trainer view unchanged");
  assert.equal((await call("/api/v1/takeover", "POST", { subscriberId: memberId, active: false }, owner)).statusCode, 200);
  assert.equal(await personalReview(member), false);
});

test("the member still cannot read the takeover record itself", async () => {
  await call("/api/v1/takeover", "POST", { subscriberId: memberId, active: true }, owner);
  const records = (await call("/api/v1/bootstrap", "GET", undefined, member)).json().records;
  assert.equal(records.some((r: any) => r.kind === "takeover"), false);
});
