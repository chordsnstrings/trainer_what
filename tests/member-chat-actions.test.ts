import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { accountsContext, withEnv } from "./accounts-fixtures.ts";
import { seedPreviewBrain, previewIntake } from "./trainer-preview-fixtures.ts";
import { memberChatIntent } from "../apps/api/src/member-chat-actions.ts";

let ctx: Awaited<ReturnType<typeof accountsContext>>;
before(async () => { ctx = await accountsContext(); });
after(async () => { await ctx.close(); });
async function member() {
  const owner = await ctx.person({ role: "owner" }), person = await ctx.person({ role: "subscriber", tenantId: owner.tenantId });
  await seedPreviewBrain(ctx.db, { ...owner, role: "owner" });
  await ctx.db.tenant({ ...owner, role: "owner" }, tx => tx.query("INSERT INTO subscriptions(id,tenant_id,user_id,status,period_end,price_minor) VALUES($1,$2,$3,'active',now()+interval '30 days',10000)", [randomUUID(), owner.tenantId, person.userId]));
  assert.equal((await ctx.call("/intake", { cookie: person.cookie, body: previewIntake })).statusCode, 200);
  return person;
}
async function ask(person: any, message: string, requestId = randomUUID()) {
  const response = await ctx.call("/coaching/ask", { cookie: person.cookie, body: { message, requestId } });
  assert.equal(response.statusCode, 200, response.body); return response.json();
}
async function intake(person: any) {
  return ctx.db.tenant({ ...person, role: "subscriber" }, async tx => (await tx.query("SELECT * FROM records WHERE kind='intake' AND owner_user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1", [person.userId]))[0]);
}
async function model(run: (requests: any[]) => Promise<void>, answer?: (input: any) => any) {
  const original = globalThis.fetch, requests: any[] = [];
  await withEnv({ MODEL_BASE_URL: "https://chat-edit.invalid/v1", MODEL_API_KEY: "fixture", MODEL_NAME: "fixture", MODEL_MAX_DAILY_CALLS: "1000" }, async () => {
    globalThis.fetch = async (url, init) => {
      assert.ok(String(url).startsWith("https://chat-edit.invalid/"));
      const input = JSON.parse(JSON.parse(String(init?.body)).messages[1].content); requests.push(input);
      const latest = input.conversation?.at(-1)?.text ?? "";
      const result = answer ? answer(input) : {
        reply: "We can adjust your session length.", intent: "correction",
        patch: { maxSessionMinutes: latest.includes("30") ? 30 : 45 }, evidence: { maxSessionMinutes: latest.includes("30") ? "30 minutes" : "45 minutes" },
      };
      return Response.json({ usage: { prompt_tokens: 40, completion_tokens: 30 }, choices: [{ message: { content: JSON.stringify(result) } }] });
    };
    try { await run(requests); } finally { globalThis.fetch = original; }
  });
}

test("chat capability routing separates read, edit, advice and negated changes", () => {
  assert.equal(memberChatIntent("Show my profile"), "profile");
  assert.equal(memberChatIntent("Check my training plan"), "training");
  assert.equal(memberChatIntent("I only have 30 minutes each session now"), "edit_profile");
  assert.equal(memberChatIntent("Change my equipment to dumbbells"), "edit_profile");
  assert.equal(memberChatIntent("Should I change my training days?"), undefined);
  assert.equal(memberChatIntent("Don't change my training days"), undefined);
  assert.equal(memberChatIntent("If I change my training days, will that help?"), undefined);
});

test("ongoing chat reads saved state, proposes an edit, survives a detour and saves once without extra inference", async () => {
  const person = await member();
  await model(async requests => {
    const checked = await ask(person, "Show my profile");
    assert.match(checked.message, /Session length: 60 minutes/); assert.equal(requests.length, 0);
    const proposed = await ask(person, "I only have 30 minutes each session now");
    assert.match(proposed.message, /aren't saved yet/); assert.match(proposed.message, /30 minutes/);
    assert.equal((await intake(person)).data.maxSessionMinutes, 60);
    assert.equal(requests.length, 1);
    await ask(person, "Check my training plan");
    const requestId = randomUUID(), saved = await ask(person, "Save these changes", requestId);
    assert.match(saved.message, /profile is saved/); assert.equal((await intake(person)).data.maxSessionMinutes, 30);
    assert.deepEqual(await ask(person, "Save these changes", requestId), saved);
    assert.equal(requests.length, 1);
    const rows = await ctx.db.tenant({ ...person, role: "subscriber" }, tx => tx.query("SELECT id FROM records WHERE kind='intake' AND owner_user_id=$1", [person.userId]));
    assert.equal(rows.length, 2);
    const wrong = await ctx.call("/coaching/ask", { cookie: person.cookie, body: { message: "A different question", requestId } });
    assert.equal(wrong.statusCode, 409);
    const snapshot = (await ctx.call("/onboarding-chat", { cookie: person.cookie })).json();
    assert.equal(snapshot.profileDirty, false); assert.equal(snapshot.profileEditing, false);
  });
});

test("cancel restores the real profile; a form edit refreshes a clean conversation and blocks overwriting a dirty one", async () => {
  const person = await member();
  await model(async requests => {
    await ask(person, "I only have 30 minutes each session now");
    await ask(person, "Keep my saved profile");
    let snapshot = (await ctx.call("/onboarding-chat", { cookie: person.cookie })).json();
    assert.equal(snapshot.facts.maxSessionMinutes, 60); assert.equal(snapshot.profileDirty, false);
    await ctx.call("/intake", { cookie: person.cookie, body: { ...previewIntake, maxSessionMinutes: 50 } });
    snapshot = (await ctx.call("/onboarding-chat", { cookie: person.cookie })).json();
    assert.equal(snapshot.facts.maxSessionMinutes, 50);
    await ask(person, "I only have 30 minutes each session now");
    await ctx.call("/intake", { cookie: person.cookie, body: { ...previewIntake, maxSessionMinutes: 40 } });
    const saved = await ask(person, "Save these changes");
    assert.match(saved.message, /profile changed elsewhere/);
    assert.equal((await intake(person)).data.maxSessionMinutes, 40);
    assert.equal(requests.length, 2);
  });
});

test("intake expected version is checked atomically and never written as a personal fact", async () => {
  const person = await member(), before = await intake(person);
  const stale = await ctx.call("/intake", { cookie: person.cookie, body: { ...previewIntake, maxSessionMinutes: 30, expectedProfileId: null } });
  assert.equal(stale.statusCode, 409); assert.equal((await intake(person)).id, before.id);
  const saved = await ctx.call("/intake", { cookie: person.cookie, body: { ...previewIntake, maxSessionMinutes: 30, expectedProfileId: before.id } });
  assert.equal(saved.statusCode, 200, saved.body); assert.equal(saved.json().data.expectedProfileId, undefined);
});

test("a saved provider failure returns a receipt; resending cannot purchase another call", async () => {
  const person = await member();
  await model(async requests => {
    const requestId = randomUUID();
    const saved = await ask(person, "How can I stay consistent with strength training?", requestId);
    assert.equal(saved.messageSaved, true); assert.equal(saved.replyUnavailable, true);
    assert.deepEqual(await ask(person, "How can I stay consistent with strength training?", requestId), saved);
    assert.equal(requests.length, 1);
    const thread = (await ctx.call("/messages/thread", { cookie: person.cookie })).json();
    assert.equal(thread.messages.filter((m: any) => m.data.author === "subscriber").length, 1);
  }, () => { throw new Error("Synthetic transport interruption"); });
});
