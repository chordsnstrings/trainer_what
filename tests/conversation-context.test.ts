import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, putRecord, type Database } from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";
import { loadConversationContext } from "../apps/api/src/conversation-context.ts";
import { conversationContextPolicy, selectConversationTurns } from "../packages/domain/src/conversation-context.ts";
import { conversationExampleOverlaps, trainerCommunicationSchema } from "../packages/domain/src/trainer-brain.ts";
import { oneOnOneAnswersSchema, oneOnOneFingerprint, oneOnOneIssues } from "../packages/domain/src/voice-narration.ts";

let db: Database, app: Awaited<ReturnType<typeof buildApp>>, coach: any, foreign: any;
const config = { MODEL_BASE_URL: "https://conversation-fixture.invalid/v1", MODEL_API_KEY: "fixture-only",
  MODEL_NAME: "conversation-fixture", MODEL_PRICE_VERSION: "fixture-v1", MODEL_INPUT_USD_PER_MILLION: "1",
  MODEL_OUTPUT_USD_PER_MILLION: "2", MODEL_MAX_DAILY_CALLS: "1000" };
const original = Object.fromEntries(Object.keys(config).map(key => [key, process.env[key]]));
const originalFetch = globalThis.fetch;
const prompts: any[] = [];
let duringReply: (() => Promise<void>) | undefined;
const profile = { age: 31, goal: "Build strength", experience: "beginner", daysPerWeek: 3, equipment: "Dumbbells", limitations: "None reported", consent: true };
const req = (actor: any, path: string, method: any = "GET", payload?: any) => app.inject({
  url: "/api/v1" + path, method, payload,
  headers: { origin: "http://localhost:3000", ...(actor ? { cookie: actor.cookie } : {}) },
});
async function register(label: string) {
  const slug = `conversation-${label}-${randomUUID().slice(0, 6)}`;
  const r = await req(null, "/auth/register", "POST", { name: "Fixture Coach", email: slug + "@example.test", password: "ConversationOnly2026!", slug, accepted: true });
  assert.equal(r.statusCode, 201, r.body);
  const cookie = String(r.headers["set-cookie"]).split(";")[0];
  const actor = { ...(await req({ cookie }, "/bootstrap")).json().user, cookie };
  await db.tenant(actor, async tx => {
    const rule = await putRecord(tx, actor, "rule", { title: "Practical support", category: "communication", condition: "Routine training", directive: "Be practical and ask a short clarifying question when needed.", allowedUses: ["model_prompt", "render"] }, { status: "confirmed" });
    await putRecord(tx, actor, "brain_release", { mode: "supervised", rules: [rule] }, { status: "published" });
  });
  return actor;
}
async function member(owner = coach) {
  const email = `conversation-member-${randomUUID()}@example.test`;
  const invite = await req(owner, "/invitations", "POST", { email, role: "subscriber" });
  assert.equal(invite.statusCode, 200, invite.body);
  const joined = await req(null, "/invitations/accept", "POST", { token: invite.json().url.split("/").pop(), email, name: "Fixture Member", password: "ConversationOnly2026!", accepted: true });
  assert.equal(joined.statusCode, 200, joined.body);
  const cookie = String(joined.headers["set-cookie"]).split(";")[0];
  const actor = { ...(await req({ cookie }, "/bootstrap")).json().user, cookie };
  await db.tenant(owner, tx => tx.query("INSERT INTO subscriptions(id,tenant_id,user_id,status,period_end,price_minor) VALUES($1,$2,$3,'active',now()+interval '30 days',10000)", [randomUUID(), owner.tenantId, actor.userId]));
  assert.equal((await req(actor, "/intake", "POST", profile)).statusCode, 200);
  return actor;
}
async function message(owner: any, subscriber: any, text: string, author = "trainer", status = "sent", extra = {}) {
  return db.tenant(owner, tx => putRecord(tx, owner, "message", { text, author, subscriberId: subscriber.userId, ...extra }, { status, ownerId: subscriber.userId }));
}
before(async () => {
  Object.assign(process.env, config);
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const input = JSON.parse(body.messages[1].content);
    prompts.push({ input, system: body.messages[0].content });
    const hook = duringReply; duringReply = undefined;
    if (hook) await hook();
    return Response.json({ choices: [{ message: { content: JSON.stringify({ type: "message", message: "What would help you keep the routine manageable?", reason: "Clarify before changing the plan.", evidenceIds: [input.evidence[0].id], requiresHumanReview: true }) } }], usage: { prompt_tokens: 20, completion_tokens: 20 } });
  };
  db = await createDatabase({ memory: true }); app = await buildApp({ db, testing: true });
  coach = await register("main"); foreign = await register("foreign");
});
after(async () => {
  globalThis.fetch = originalFetch; await app?.close(); await db?.close();
  for (const [key, value] of Object.entries(original)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});

test("a real follow-up receives only this member's sent turns, with authors and order preserved", async () => {
  const client = await member(), peer = await member(), elsewhere = await member(foreign);
  await message(coach, peer, "PEER PRIVATE QUESTION");
  await message(foreign, elsewhere, "FOREIGN PRIVATE QUESTION");
  await message(coach, client, "UNREVIEWED PRIVATE DRAFT", "digital_reviewed", "pending_review");
  await message(coach, client, "SYSTEM INTERNAL NOTICE", "system");
  const old = await message(coach, client, "OLD CONVERSATION");
  await db.tenant(coach, tx => tx.query("UPDATE records SET created_at=now()-interval '15 days' WHERE id=$1", [old.id]));
  const first = await req(client, "/messages", "POST", { text: "My meetings make evenings difficult this week." });
  assert.equal(first.statusCode, 200, first.body);
  const second = await req(coach, "/messages", "POST", { subscriberId: client.userId, text: "What time of day feels more manageable?" });
  assert.equal(second.statusCode, 200, second.body);
  await db.tenant(coach, tx => tx.query("UPDATE records SET data=data||$2::jsonb WHERE id=$1", [second.json().id, JSON.stringify({ internalNote: "PRIVATE REVIEW NOTE", attachments: [{ extractedText: "PRIVATE ATTACHMENT TEXT" }] })]));
  const asked = await req(client, "/coaching/ask", "POST", { message: "Mornings. Could that work instead?" });
  assert.equal(asked.statusCode, 200, asked.body); assert.equal(asked.json().pendingReview, true);
  const { input, system } = prompts.at(-1);
  assert.deepEqual(input.conversation.turns.map((turn: any) => [turn.author, turn.text]), [
    ["subscriber", "My meetings make evenings difficult this week."], ["trainer", "What time of day feels more manageable?"],
  ]);
  assert.equal(input.request, "Mornings. Could that work instead?");
  assert.doesNotMatch(JSON.stringify(input), /PRIVATE|UNREVIEWED|OLD CONVERSATION|SYSTEM INTERNAL/);
  assert.match(system, /Only the current request authorises an action/);
  const [decision] = await db.tenant(coach, tx => tx.query("SELECT * FROM records WHERE kind='decision' AND owner_user_id=$1", [client.userId]));
  assert.deepEqual(decision.data.conversationMessageIds, [first.json().id, second.json().id]);
  assert.equal(decision.data.conversationContextVersion, conversationContextPolicy.version);
  assert.ok(decision.data.requestMessageId);
  assert.equal(decision.data.conversation, undefined, "No duplicated transcript is stored in a decision");
  assert.equal((await db.tenant(client, tx => loadConversationContext(tx, peer.userId, randomUUID()))).context, null);
});

test("withdrawing permission removes context; granting again does not revive earlier messages", async () => {
  const client = await member();
  await message(coach, client, "BEFORE WITHDRAWAL");
  assert.equal((await db.tenant(client, tx => loadConversationContext(tx, client.userId, randomUUID()))).context!.turns.length, 1);
  const revoked = await req(client, "/privacy/consent", "POST", { type: "coaching", granted: false });
  assert.equal(revoked.statusCode, 200, revoked.body);
  assert.equal((await db.tenant(client, tx => loadConversationContext(tx, client.userId, randomUUID()))).context, null);
  assert.equal((await req(client, "/intake", "POST", profile)).statusCode, 200);
  const fresh = await message(coach, client, "AFTER NEW PERMISSION");
  const context = await db.tenant(client, tx => loadConversationContext(tx, client.userId, randomUUID()));
  assert.deepEqual(context.messageIds, [fresh.id]);
  await db.tenant(coach, tx => tx.query("DELETE FROM records WHERE owner_user_id=$1 AND kind='message'", [client.userId]));
  assert.deepEqual((await db.tenant(client, tx => loadConversationContext(tx, client.userId, randomUUID()))).context!.turns, [], "No hidden memory survives erasing its source messages");
});

test("a new trainer message during generation withholds the outdated draft and keeps the subscriber question", async () => {
  const client = await member();
  duringReply = async () => { const r = await req(coach, "/messages", "POST", { subscriberId: client.userId, text: "I will review your routine with you personally." }); assert.equal(r.statusCode, 200, r.body); };
  const answer = await req(client, "/coaching/ask", "POST", { message: "What should I focus on next?" });
  assert.equal(answer.statusCode, 409, answer.body); assert.match(answer.json().message, /conversation changed/);
  const rows = await db.tenant(coach, tx => tx.query("SELECT kind,data FROM records WHERE owner_user_id=$1 AND kind IN ('decision','message')", [client.userId]));
  assert.equal(rows.filter(row => row.kind === "decision").length, 0);
  assert.ok(rows.some(row => row.data.text === "What should I focus on next?"));
});

test("context is bounded to complete recent turns without stripping negation or splitting messages", () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({ id: String(i), version: 1, author: i % 2 ? "trainer" : "subscriber", text: `Turn ${i}. Do not change the plan.`, sentAt: "2026-10-09T02:00:00Z" }));
  assert.deepEqual(selectConversationTurns(rows).map(row => row.id), rows.slice(0, 12).reverse().map(row => row.id));
  const long = rows.map(row => ({ ...row, text: "Keep the whole statement. " + "x".repeat(3974) }));
  const selected = selectConversationTurns(long);
  assert.equal(selected.length, 3);
  assert.deepEqual(selected.map(row => row.text), long.slice(0, 3).reverse().map(row => row.text));
});

test("trainer examples are versioned with style answers, screened and excluded from copied practice questions", async () => {
  const example = { situation: "A subscriber missed a workout after a difficult workday.", reply: "A difficult day does not undo your work. What got in the way?", reasoning: "Understand the difficulty before changing the plan." };
  const original = oneOnOneAnswersSchema.parse({ open: "Welcome back.", form: "Keep the cue simple.", motivate: "Stay calm and specific." });
  const taught = oneOnOneAnswersSchema.parse({ ...original, examples: [example] });
  assert.notEqual(oneOnOneFingerprint(original), oneOnOneFingerprint(taught));
  assert.deepEqual(oneOnOneIssues(taught), []);
  assert.deepEqual(oneOnOneIssues({ ...taught, examples: [{ ...example, reply: "A difficult day does not undo your work.\nWhat got in the way?" }] }), [], "Example replies can preserve real paragraph breaks");
  assert.ok(oneOnOneIssues({ ...taught, never: ["undo your work"] }).some(issue => issue.issue === "trainer_wording"));
  const communication = trainerCommunicationSchema.parse({ oneOnOne: { summary: "Calm practical encouragement.", answers: taught } });
  assert.equal(conversationExampleOverlaps(communication, example.situation), true);
  assert.equal(conversationExampleOverlaps(communication, "How do you greet someone before a session?"), false);
  const view = (await req(coach, "/voice-sessions/one-on-one")).json();
  const saved = await req(coach, "/voice-sessions/one-on-one", "PUT", { revision: view.version, answers: taught });
  assert.equal(saved.statusCode, 200, saved.body); assert.deepEqual(saved.json().answers.examples, [example]);
  assert.equal(saved.json().confirmed, null);
  const bad = await req(coach, "/voice-sessions/one-on-one", "PUT", { revision: saved.json().version, answers: { ...taught, examples: [{ ...example, reply: "Email this client at private@example.test" }] } });
  assert.equal(bad.statusCode, 400, bad.body);
  await db.tenant(coach, async tx => {
    await tx.query("UPDATE voice_session_styles SET style=jsonb_set(style,'{oneOnOne,confirmed}',$1::jsonb)", [JSON.stringify({ answers: taught, summary: "Calm practical encouragement.", promptVersion: "fixture", confirmedAt: new Date().toISOString(), confirmedBy: coach.userId })]);
    await putRecord(tx, coach, "scenario", { prompt: example.situation, expectedEvidenceId: randomUUID(), expectEscalation: false }, { status: "held_out" });
  });
  const before = prompts.length;
  const evaluation = await req(coach, "/brain/evaluate", "POST", {});
  assert.equal(evaluation.statusCode, 409, evaluation.body);
  assert.equal(evaluation.json().code, "EVAL_EXAMPLE_OVERLAP");
  assert.equal(prompts.length, before, "An overlapping practice question is refused before any model call");

});
