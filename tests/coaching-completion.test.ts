import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, putRecord, type Database } from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";

let db: Database, app: Awaited<ReturnType<typeof buildApp>>, coach: any, other: any, client: any;
async function request(url: string, method: any = "GET", body?: any, actor?: any) {
  return app.inject({ url: "/api/v1" + url, method, headers: { origin: "http://localhost:3000", ...(actor ? { cookie: actor.cookie } : {}) }, payload: body });
}
async function register(slug: string) {
  const r = await request("/auth/register", "POST", { name: "Coach " + slug, email: slug + "@example.test", password: "TrainingOnly2026!", slug, accepted: true });
  assert.equal(r.statusCode, 201, r.body);
  const cookie = String(r.headers["set-cookie"]).split(";")[0];
  const boot = await request("/bootstrap", "GET", undefined, { cookie });
  return { ...boot.json().user, cookie };
}
before(async () => {
  db = await createDatabase({ memory: true }); app = await buildApp({ db, testing: true });
  coach = await register("hold-coach"); other = await register("other-coach");
  const invite = await request("/invitations", "POST", { email: "hold-client@example.test", role: "subscriber" }, coach);
  const joined = await request("/invitations/accept", "POST", { token: invite.json().url.split("/").pop(), name: "Hold Client", email: "hold-client@example.test", password: "TrainingClient2026!" });
  assert.equal(joined.statusCode, 200, joined.body);
  const cookie = String(joined.headers["set-cookie"]).split(";")[0];
  client = { ...(await request("/bootstrap", "GET", undefined, { cookie })).json().user, cookie };
  await db.tenant(coach, async (tx) => {
    await tx.query("INSERT INTO subscriptions(id,tenant_id,user_id,status,period_end,price_minor) VALUES($1,$2,$3,'active',now()+interval '30 days',10000)", [randomUUID(), coach.tenantId, client.userId]);
  });
});
after(async () => { await app.close(); await db.close(); });
async function program() {
  const r = await request("/programs", "POST", { subscriberId: client.userId, program: { title: "Strength foundations", goal: "Controlled practice", daysPerWeek: 3, exercises: [{ name: "Goblet squat", sets: 3, reps: 10, restSeconds: 90, loadKg: 12, cue: "Controlled reps" }] } }, coach);
  assert.equal(r.statusCode, 200, r.body); return r.json();
}
test("a pain hold blocks new sessions, logging, finish, abandonment and generic exception resolution", async () => {
  const p = await program();
  const started = await request("/workouts/start", "POST", { programId: p.id }, client); assert.equal(started.statusCode, 200, started.body);
  const wid = started.json().id;
  assert.equal((await request("/workouts/start", "POST", { programId: p.id }, client)).json().id, wid, "Start retry resumes the existing session");
  const set = { eventKey: randomUUID(), exercise: "Goblet squat", set: 1, reps: 10, loadKg: 12 };
  assert.equal((await request(`/workouts/${wid}/sets`, "POST", set, client)).statusCode, 200);
  const pain = await request(`/workouts/${wid}/pain`, "POST", { description: "Sharp pain during the first squat" }, client);
  assert.equal(pain.statusCode, 200, pain.body);
  assert.equal((await request(`/workouts/${wid}/pain`, "POST", { description: "Repeated pain report" }, client)).json().holdId, pain.json().holdId);
  const boot = (await request("/bootstrap", "GET", undefined, client)).json();
  const hold = boot.records.find((r: any) => r.kind === "training_hold" && r.status === "active");
  const trainerBoot = (await request("/bootstrap", "GET", undefined, coach)).json();
  const exception = trainerBoot.records.find((r: any) => r.kind === "exception" && r.data.holdId === hold.id);
  for (const [url, body] of [["/workouts/start", { programId: p.id }], [`/workouts/${wid}/sets`, { ...set, eventKey: randomUUID(), set: 2 }], [`/workouts/${wid}/finish`, {}], [`/workouts/${wid}/abandon`, { note: "Will restart to bypass hold" }]] as const) {
    const r = await request(url, "POST", body, client); assert.equal(r.statusCode, 409, r.body);
  }
  assert.equal((await request(`/workouts/${wid}/sets`, "POST", set, client)).json().duplicate, true, "Already saved replay remains side-effect free");
  assert.equal((await request(`/exceptions/${exception.id}/resolve`, "POST", { note: "A generic note is insufficient" }, coach)).statusCode, 409);
  assert.equal((await request(`/training/holds/${hold.id}/resolve`, "POST", { version: hold.version, action: "resume", note: "I reviewed this with the client", reviewed: true }, client)).statusCode, 403);
  assert.equal((await request(`/training/holds/${hold.id}/resolve`, "POST", { version: hold.version, action: "resume", note: "I reviewed this with the client", reviewed: true }, other)).statusCode, 404);
  const resumed = await request(`/training/holds/${hold.id}/resolve`, "POST", { version: hold.version, action: "resume", note: "Reviewed with client; resume the approved session", reviewed: true }, coach);
  assert.equal(resumed.statusCode, 200, resumed.body);
  assert.equal((await request(`/training/holds/${hold.id}/resolve`, "POST", { version: hold.version, action: "abandon", note: "Stale concurrent review should fail", reviewed: true }, coach)).statusCode, 409);
  assert.equal((await request(`/workouts/${wid}/sets`, "POST", { ...set, eventKey: randomUUID(), set: 2 }, client)).statusCode, 200);
  assert.equal((await request(`/workouts/${wid}/finish`, "POST", {}, client)).statusCode, 200);
  assert.equal((await request(`/workouts/${wid}/pain`, "POST", { description: "Terminal session cannot reopen" }, client)).statusCode, 409);
});
test("safety messages create a subscriber-wide hold and abandonment closes the paused workout", async () => {
  const p = await program(), start = await request("/workouts/start", "POST", { programId: p.id }, client), wid = start.json().id;
  const answer = await request("/coaching/ask", "POST", { message: "I have chest pain when lifting" }, client);
  assert.equal(answer.statusCode, 200, answer.body);
  const holds = await request("/training/holds", "GET", undefined, coach), hold = holds.json().find((h: any) => h.status === "active");
  assert.equal((await request("/workouts/start", "POST", { programId: p.id }, client)).statusCode, 409);
  const resolved = await request(`/training/holds/${hold.id}/resolve`, "POST", { version: hold.version, action: "abandon", note: "Reviewed and ended the interrupted workout", reviewed: true }, coach);
  assert.equal(resolved.statusCode, 200, resolved.body);
  const boot = (await request("/bootstrap", "GET", undefined, client)).json();
  assert.equal(boot.records.find((r: any) => r.id === wid).status, "abandoned");
  assert.equal(boot.records.filter((r: any) => r.kind === "exception" && r.data.holdId === hold.id && r.status === "open").length, 0);
  assert.ok(boot.records.find((r: any) => r.kind === "message" && r.data.holdId === hold.id));
});
test("takeover validates tenant membership and routes ordinary questions to human review without a safety hold", async () => {
  assert.equal((await request("/takeover", "POST", { subscriberId: other.userId, active: true }, coach)).statusCode, 404);
  assert.equal((await request("/takeover", "POST", { subscriberId: client.userId, active: true }, coach)).statusCode, 200);
  const response = await request("/coaching/ask", "POST", { message: "Can we discuss my weekly routine?" }, client);
  assert.equal(response.statusCode, 200, response.body); assert.match(response.json().data.text, /personally/);
  const rows = await db.tenant(coach, (tx) => tx.query("SELECT * FROM records WHERE owner_user_id=$1 AND status IN ('open','active')", [client.userId]));
  assert.equal(rows.filter((r) => r.kind === "training_hold").length, 0);
  assert.ok(rows.find((r) => r.kind === "exception" && r.data.category === "human_review"));
  await request("/takeover", "POST", { subscriberId: client.userId, active: false }, coach);
});
test("decision approval cannot bypass a hold or revoked consent", async () => {
  const seeded = await db.tenant(coach, async (tx) => {
    const release = await putRecord(tx, coach, "brain_release", { rules: [], mode: "supervised" }, { status: "published" });
    const decision = await putRecord(tx, coach, "decision", { brainVersionId: release.id, message: "A reviewed coach reply", reason: "Test decision" }, { ownerId: client.userId, status: "pending_review" });
    return putRecord(tx, coach, "exception", { category: "decision_review", decisionId: decision.id, subscriberId: client.userId }, { ownerId: client.userId, status: "open" });
  });
  assert.equal((await request(`/exceptions/${seeded.id}/resolve`, "POST", { approveDecision: true, note: "Consent has not been granted" }, coach)).statusCode, 409);
  assert.equal((await request("/training/holds", "GET", undefined, client)).statusCode, 403);
});
test("generation rechecks profile changes and takeover after the provider returns", async () => {
  const config = { MODEL_BASE_URL: "https://coaching-fixture.invalid/v1", MODEL_API_KEY: "synthetic-coaching-key", MODEL_NAME: "fixture-coach", MODEL_PRICE_VERSION: "fixture-v1", MODEL_INPUT_USD_PER_MILLION: "1", MODEL_OUTPUT_USD_PER_MILLION: "2", MODEL_MAX_DAILY_CALLS: "100" };
  const old = Object.fromEntries(Object.keys(config).map((key) => [key, process.env[key]])), originalFetch = globalThis.fetch;
  Object.assign(process.env, config);
  const intake = { age: 30, goal: "Build strength", experience: "beginner", daysPerWeek: 3, equipment: "Dumbbells", limitations: "None reported", consent: true };
  try {
    assert.equal((await request("/intake", "POST", intake, client)).statusCode, 200);
    for (const change of ["profile", "takeover"]) {
      let entered!: () => void, finish!: () => void;
      const called = new Promise<void>((resolve) => { entered = resolve; }), resume = new Promise<void>((resolve) => { finish = resolve; });
      globalThis.fetch = async (_url, init) => {
        const payload = JSON.parse(String(init?.body)), input = JSON.parse(payload.messages[1].content);
        entered(); await resume;
        return Response.json({ id: "fixture-coach-response", usage: { prompt_tokens: 10, completion_tokens: 10 }, choices: [{ message: { content: JSON.stringify({ type: "message", message: "Keep your approved routine consistent.", reason: "Coach evidence", evidenceIds: [input.evidence[0].id], requiresHumanReview: true }) } }] });
      };
      const pending = request("/coaching/ask", "POST", { message: "How should I approach my weekly routine?" }, client);
      await called;
      const changed = change === "profile" ? await request("/intake", "POST", { ...intake, daysPerWeek: 2 }, client) : await request("/takeover", "POST", { subscriberId: client.userId, active: true }, coach);
      assert.equal(changed.statusCode, 200, changed.body); finish();
      const result = await pending;
      assert.equal(result.statusCode, change === "profile" ? 409 : 200, result.body);
      if (change === "takeover") {
        assert.equal(result.json().pendingReview, true);
        const latest = await db.tenant(coach, (tx) => tx.query("SELECT * FROM records WHERE kind='exception' AND data->>'category'='human_review' AND data ? 'decisionId' ORDER BY created_at DESC LIMIT 1"));
        assert.equal(latest.length, 1);
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(old)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    await request("/takeover", "POST", { subscriberId: client.userId, active: false }, coach);
  }
});
