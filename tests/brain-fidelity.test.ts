import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, putRecord, type Database } from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";
import { fidelityCaseSchema } from "../packages/domain/src/brain-fidelity.ts";
import { brainTrainingState } from "../apps/api/src/brain-training-state.ts";

let db: Database, app: Awaited<ReturnType<typeof buildApp>>;
before(async () => {
  db = await createDatabase({ memory: true });
  app = await buildApp({ db, testing: true });
});
after(async () => {
  await app?.close();
  await db?.close();
});
const call = (actor: any, path = "", body?: any) =>
  app.inject({
    url: "/api/v1/brain/fidelity" + path,
    method: body === undefined ? "GET" : "POST",
    headers: { origin: "http://localhost:3000", cookie: actor.cookie },
    payload: body,
  });
async function coach() {
  const slug = "fidelity-" + randomUUID().slice(0, 8);
  const r = await app.inject({
    url: "/api/v1/auth/register",
    method: "POST",
    headers: { origin: "http://localhost:3000" },
    payload: {
      name: "Review Coach",
      email: slug + "@example.test",
      password: "FidelityFixture2026!",
      slug,
      accepted: true,
    },
  });
  assert.equal(r.statusCode, 201, r.body);
  const cookie = String(r.headers["set-cookie"]).split(";")[0];
  const boot = await app.inject({
    url: "/api/v1/bootstrap",
    headers: { cookie },
  });
  return { ...boot.json().user, cookie };
}
const situation = () => ({
  title: "A disrupted week",
  turns: [
    {
      author: "subscriber",
      text: "My commute changed this week and I missed my usual workout.",
    },
    {
      author: "trainer",
      text: "Tell me what changed and we can work around your commute.",
    },
  ],
  request:
    "It is the same commute issue again today. How should I think about getting back on track?",
  referenceReply:
    "Keep it simple, mate. Tell me what time you have and we will find the next workable session.",
  referenceReason:
    "REFERENCE_ONLY: I acknowledge the earlier conversation and ask for availability before deciding.",
  expectHandover: false,
  fictional: true,
});
async function publish(a: any, title = "Stay practical") {
  return db.tenant(a, async (tx) => {
    await tx.query(
      "UPDATE records SET status='archived' WHERE kind='brain_release' AND status='published'",
    );
    const rule = await putRecord(
      tx,
      a,
      "rule",
      {
        title,
        category: "adherence",
        condition: "A client misses a session because life changes",
        directive:
          "Acknowledge the disruption and ask about current availability before recommending a change.",
        allowedUses: ["model_prompt", "trainer_specific_learning"],
      },
      { status: "confirmed" },
    );
    return putRecord(
      tx,
      a,
      "brain_release",
      {
        rules: [rule],
        communication: { tone: "calm", encouragement: ["Keep it simple"] },
      },
      { status: "published" },
    );
  });
}
const config = {
  MODEL_BASE_URL: "https://fidelity.invalid/v1",
  MODEL_API_KEY: "isolated-fixture",
  MODEL_NAME: "fixture-fidelity",
  MODEL_MAX_DAILY_CALLS: "1000",
};
async function model<T>(
  fn: (sent: any[]) => Promise<T>,
  respond?: (input: any) => any | Promise<any>,
) {
  const prior = Object.fromEntries(
      Object.keys(config).map((k) => [k, process.env[k]]),
    ),
    fetch = globalThis.fetch,
    sent: any[] = [];
  Object.assign(process.env, config);
  globalThis.fetch = async (_url, init) => {
    const payload = JSON.parse(String(init?.body)),
      input = JSON.parse(payload.messages[1].content);
    sent.push(input);
    const decision = respond
      ? await respond(input)
      : {
          type: "message",
          message:
            "That commute is still making things difficult. What time could work for your next session?",
          reason: "Acknowledge the disruption and clarify availability.",
          requiresHumanReview: true,
          evidenceIds: [input.evidence[0].id],
        };
    return Response.json({
      usage: { prompt_tokens: 20, completion_tokens: 30 },
      choices: [{ message: { content: JSON.stringify(decision) } }],
    });
  };
  try {
    return await fn(sent);
  } finally {
    globalThis.fetch = fetch;
    for (const [k, v] of Object.entries(prior))
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
  }
}
const ratings = {
  scores: [
    { label: "B", decision: 2, wording: 3, context: 4 },
    { label: "A", decision: 5, wording: 4, context: 3 },
  ],
  note: "The availability follow-up matters.",
};
async function saved(a: any, value = situation()) {
  const response = await call(a, "/cases", value);
  assert.equal(response.statusCode, 200, response.body);
  return response.json();
}

test("review cases require fictional complete exchanges and exclude private details and known material", async () => {
  assert.equal(
    fidelityCaseSchema.safeParse({
      ...situation(),
      turns: situation().turns.slice(0, 1),
    }).success,
    false,
  );
  assert.equal(
    fidelityCaseSchema.safeParse({
      ...situation(),
      turns: [...situation().turns].reverse(),
    }).success,
    false,
  );
  const a = await coach();
  assert.equal(
    (await call(a, "/cases", { ...situation(), fictional: false })).statusCode,
    400,
  );
  assert.equal(
    (
      await call(a, "/cases", {
        ...situation(),
        referenceReply: "Contact person@example.test for their availability.",
      })
    ).statusCode,
    400,
  );
  await db.tenant(a, (tx) =>
    putRecord(
      tx,
      a,
      "scenario",
      { prompt: situation().request },
      { status: "held_out" },
    ),
  );
  const overlapping = await call(a, "/cases", situation());
  assert.equal(overlapping.statusCode, 409);
  assert.equal(overlapping.json().code, "CASE_OVERLAP");
  const b = await coach(),
    c = await saved(b);
  assert.equal(
    (await saved(b)).id,
    c.id,
    "lost creation response is idempotent",
  );
  assert.equal(
    (await call(b, `/cases/${c.id}/runs`, {})).json().code,
    "BRAIN_NOT_READY",
  );
});

test("only the trainer can access reviews; another tenant and generic records cannot expose a saved reference", async () => {
  const a = await coach(),
    b = await coach(),
    c = await saved(a);
  assert.equal((await call(b, `/cases/${c.id}/runs`, {})).statusCode, 404);
  const boot = await app.inject({
    url: "/api/v1/bootstrap",
    headers: { cookie: a.cookie },
  });
  assert.ok(!boot.body.includes("REFERENCE_ONLY"));
  const raw = await app.inject({
    url: "/api/v1/workspace/records/" + c.id,
    headers: { cookie: a.cookie },
  });
  assert.equal(raw.statusCode, 404);
  for (const role of ["staff", "finance", "subscriber"]) {
    await db.system((tx) =>
      tx.query(
        "UPDATE memberships SET role=$3 WHERE tenant_id=$1 AND user_id=$2",
        [b.tenantId, b.userId, role],
      ),
    );
    assert.equal((await call(b)).statusCode, 403, role);
    assert.equal((await call(b, "/cases", situation())).statusCode, 403, role);
    assert.equal(
      (await call(b, `/cases/${c.id}/runs`, {})).statusCode,
      403,
      role,
    );
    assert.equal(
      (await call(b, `/runs/${randomUUID()}/ratings`, ratings)).statusCode,
      403,
      role,
    );
  }
});

test("one pinned Brain reply excludes reference answers, survives duplicate requests, and reveals sources only after immutable ratings", async () => {
  const a = await coach(),
    release = await publish(a),
    c = await saved(a);
  await model(async (sent) => {
    const response = await call(a, `/cases/${c.id}/runs`, {});
    assert.equal(response.statusCode, 200, response.body);
    const run = response.json();
    assert.equal(run.status, "ready", response.body);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].task, "coaching");
    assert.equal(sent[0].conversation.turns.length, 2);
    assert.equal(sent[0].trainerBrain.communication.tone, "calm");
    assert.ok(!JSON.stringify(sent).includes("REFERENCE_ONLY"));
    assert.ok(!JSON.stringify(sent).includes(situation().referenceReply));
    assert.deepEqual(Object.keys(run.candidates[0]).sort(), ["label", "reply"]);
    assert.ok(!("receipt" in run));
    assert.ok(!("usage" in run));
    assert.equal((await call(a, `/cases/${c.id}/runs`, {})).json().id, run.id);
    assert.equal(sent.length, 1);
    const summaryBefore = (await call(a)).json();
    assert.equal(summaryBefore.summary.count, 0);
    assert.ok(!JSON.stringify(summaryBefore).includes("REFERENCE_ONLY"));
    const result = await call(a, `/runs/${run.id}/ratings`, ratings);
    assert.equal(result.statusCode, 200, result.body);
    const graded = result.json();
    assert.equal(graded.receipt.releaseId, release.id);
    assert.equal(graded.receipt.model, config.MODEL_NAME);
    assert.equal(graded.usage.inputTokens, 20);
    assert.equal(graded.usage.outputTokens, 30);
    assert.equal(
      graded.candidates.filter((x: any) => x.source === "brain").length,
      1,
    );
    assert.equal(
      (await call(a, `/runs/${run.id}/ratings`, ratings)).statusCode,
      200,
    );
    assert.equal(
      (
        await call(a, `/runs/${run.id}/ratings`, {
          ...ratings,
          note: "Changed after reveal",
        })
      ).statusCode,
      409,
    );
    const label = graded.candidates.find(
      (x: any) => x.source === "brain",
    ).label;
    const summary = (await call(a)).json().summary;
    assert.equal(summary.count, 1);
    assert.equal(
      summary.decision,
      ratings.scores.find((s) => s.label === label)!.decision,
    );
    const costs = await db.tenant(a, (tx) =>
      tx.query(
        "SELECT task,product,status FROM cost_events WHERE task='evaluation'",
      ),
    );
    assert.equal(costs.length, 1);
    assert.equal(costs[0].product, "trainer_setup");
    const teaching = await db.tenant(a, (tx) =>
      tx.query("SELECT id FROM records WHERE kind='interview'"),
    );
    assert.equal(teaching.length, 0);
    await publish(a, "A revised practical method");
    assert.equal(
      (await call(a)).json().summary.count,
      0,
      "do not mix release scores",
    );
    const next = (await call(a, `/cases/${c.id}/runs`, {})).json();
    assert.notEqual(next.id, run.id);
    assert.equal(sent.length, 2);
  });
});

test("an in-flight duplicate does not trigger another paid request", async () => {
  const a = await coach();
  await publish(a);
  const c = await saved(a);
  let started!: () => void, finish!: () => void;
  const began = new Promise<void>((r) => {
      started = r;
    }),
    gate = new Promise<void>((r) => {
      finish = r;
    });
  await model(
    async (sent) => {
      const first = call(a, `/cases/${c.id}/runs`, {});
      await began;
      try {
        const second = await call(a, `/cases/${c.id}/runs`, {});
        assert.equal(second.json().status, "generating");
        assert.equal(sent.length, 1);
      } finally {
        finish();
      }
      assert.equal((await first).json().status, "ready");
      assert.equal(sent.length, 1);
    },
    async (input) => {
      started();
      await gate;
      return {
        type: "message",
        message: "What time is available around that commute?",
        reason: "Ask before adapting.",
        evidenceIds: [input.evidence[0].id],
        requiresHumanReview: true,
      };
    },
  );
});

test("corrections require explicit teaching, preserve earlier scores, retire every run and enter the existing review loop", async () => {
  const a = await coach();
  await publish(a);
  const c = await saved(a);
  await model(async () => {
    const run = (await call(a, `/cases/${c.id}/runs`, {})).json();
    const correction = {
      reply: "Keep it simple. Tell me when you can train around that commute.",
      reason: "Ask about availability before changing the schedule.",
      confirmed: true,
    };
    assert.equal(
      (await call(a, `/runs/${run.id}/teach`, correction)).statusCode,
      409,
    );
    await call(a, `/runs/${run.id}/ratings`, ratings);
    assert.equal(
      (
        await call(a, `/runs/${run.id}/teach`, {
          ...correction,
          confirmed: false,
        })
      ).statusCode,
      400,
    );
    const taught = await call(a, `/runs/${run.id}/teach`, correction);
    assert.equal(taught.statusCode, 200, taught.body);
    assert.ok(taught.json().teachingId);
    assert.equal(taught.json().status, "graded");
    assert.equal(
      (await call(a, `/runs/${run.id}/teach`, correction)).json().teachingId,
      taught.json().teachingId,
    );
    const state = await db.tenant(a, (tx) => brainTrainingState(tx));
    assert.ok(
      state.uncompiledTeaching.some(
        (r: any) => r.id === taught.json().teachingId,
      ),
    );
    const savedState = (await call(a)).json();
    assert.equal(savedState.summary.count, 0);
    assert.equal(savedState.cases[0].status, "teaching");
    assert.equal(savedState.runs[0].status, "graded");
    await publish(a, "Next release");
    assert.equal((await call(a, `/cases/${c.id}/runs`, {})).statusCode, 409);
  });
});

test("newly added teaching removes a scored case from the untouched summary", async () => {
  const a = await coach();
  await publish(a);
  const c = await saved(a);
  await model(async () => {
    const r = (await call(a, `/cases/${c.id}/runs`, {})).json();
    await call(a, `/runs/${r.id}/ratings`, ratings);
    assert.equal((await call(a)).json().summary.count, 1);
    await db.tenant(a, (tx) =>
      putRecord(
        tx,
        a,
        "interview",
        { question: situation().request, answer: "A new teaching answer" },
        { status: "answered" },
      ),
    );
    const state = (await call(a)).json();
    assert.equal(state.summary.count, 0);
    assert.equal(state.cases[0].eligible, false);
  });
});

test("invalid paid answers are withheld and never retried; fictional pain still requires handover", async () => {
  const a = await coach();
  await publish(a);
  const c = await saved(a);
  await model(
    async (sent) => {
      const r = await call(a, `/cases/${c.id}/runs`, {});
      assert.equal(r.json().status, "failed", r.body);
      const summary = (await call(a)).json().summary;
      assert.equal(summary.failed, 1);
      assert.equal(summary.attempts, 1);
      assert.equal(summary.count, 0);
      assert.deepEqual(r.json().candidates, []);
      assert.equal(
        (await call(a, `/cases/${c.id}/runs`, {})).json().id,
        r.json().id,
      );
      assert.equal(sent.length, 1);
      assert.equal(
        (await call(a, `/runs/${r.json().id}/ratings`, ratings)).statusCode,
        409,
      );
      const [cost] = await db.tenant(a, (tx) =>
        tx.query(
          "SELECT input_tokens,output_tokens FROM cost_events WHERE task='evaluation'",
        ),
      );
      assert.equal(cost.input_tokens, 20);
      assert.equal(cost.output_tokens, 30);
    },
    () => ({ wrong: "unusable answer" }),
  );
  const b = await coach();
  await publish(b);
  const pain = await saved(b, {
    ...situation(),
    request: "I now have chest pain during exercise; should I continue?",
    expectHandover: true,
  });
  await model(async () => {
    const r = await call(b, `/cases/${pain.id}/runs`, {});
    assert.equal(r.json().status, "failed", r.body);
  });
});
