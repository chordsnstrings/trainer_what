import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase } from "@trainer/db";
import { withRuntimeConfig } from "../packages/providers/src/configuration.ts";
import { withIntegrationFixtureTransport } from "../packages/providers/src/integrations.ts";
import { musicBrief } from "../packages/domain/src/workout-music.ts";
import {
  processMusicAgent,
  saveMusicAgent,
  musicAgentSummary,
} from "../apps/api/src/music-agent.ts";

// A failed or rejected AI music plan falls back to standard arrangements and
// never stalls the agent. Its own file: CI gives each test file a fresh
// PostgreSQL database, and this scenario needs an empty music library.
let aiCalls = 0;
// The model reply: a provider Response, raw text or an object, or a throw.
let planReply: ((slots: number[], bpm: number) => unknown) | null = null;
const config = {
  NODE_ENV: "test",
  MODEL_BASE_URL: "https://music-planner.example.test/v1",
  MODEL_API_KEY: "fixture",
  MODEL_NAME: "seed-2-0-pro-260328",
  MODEL_INPUT_USD_PER_MILLION: "0.5",
  MODEL_OUTPUT_USD_PER_MILLION: "3",
  MUSIC_ENABLED: "true",
  MUSIC_API_KEY: "fixture",
  MUSIC_CREDITS_PER_JOB: "12",
  MUSIC_DAILY_CREDIT_LIMIT: "1440",
  PUBLIC_APP_URL: "https://coach.example.test",
};
const settings = {
  enabled: true,
  autoPublish: true,
  recoveryConfirmed: true,
  externalRequests: 0,
  externalCredits: 0,
};
async function fixture<T>(fn: () => Promise<T>): Promise<T> {
  const prior = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    assert.ok(
      String(input).startsWith("https://music-planner.example.test/v1/"),
    );
    const prompt = JSON.parse(
      JSON.parse(String(init?.body)).messages[1].content,
    );
    aiCalls++;
    const reply = planReply?.(prompt.slots, prompt.bpm) ?? {
      tracks: prompt.slots.map((slot: number) => ({
        slot,
        bpm: prompt.bpm,
        arrangement: `Original layered percussion with warm keys and bass motif number ${slot + 1}; gradual build`,
      })),
    };
    if (reply instanceof Response) return reply;
    return Response.json({
      id: "fixture",
      choices: [
        {
          message: {
            content: typeof reply === "string" ? reply : JSON.stringify(reply),
          },
        },
      ],
      usage: { prompt_tokens: 300, completion_tokens: 400 },
    });
  };
  try {
    return await withRuntimeConfig(config, () =>
      withIntegrationFixtureTransport(async (url) => {
        // Only the credit balance is read; nothing is submitted here.
        assert.ok(url.endsWith("/credit"), url);
        return Response.json({ code: 200, data: 2000 });
      }, fn),
    );
  } finally {
    globalThis.fetch = prior;
  }
}

test("a rejected AI reply records why, uses standard arrangements for its slots and the agent keeps generating", async () => {
  const fresh = await createDatabase({ memory: true }),
    userId = randomUUID(),
    callsBefore = aiCalls;
  try {
    await fresh.system((tx) =>
      tx.query(
        "INSERT INTO users(id,email,name,password_hash) VALUES($1,'reject@example.test','Reject fixture','unused')",
        [userId],
      ),
    );
    await fresh.system((tx) => saveMusicAgent(tx, userId, settings));
    // One description over the limit: the shape of the 19 October Rock stall.
    planReply = (slots, bpm) => ({
      tracks: slots.map((slot, i) => ({
        slot,
        bpm,
        arrangement:
          i === 1
            ? "Driving guitars and layered drums ".repeat(14)
            : `Driving guitars with layered drums and bass motif ${slot + 1}; steady build`,
      })),
    });
    await fixture(() => processMusicAgent(fresh));
    assert.equal(aiCalls, callsBefore + 1);
    const [plan] = await fresh.system((tx) =>
      tx.query("SELECT * FROM workout_music_plans"),
    );
    assert.equal(plan.status, "ready");
    assert.equal(plan.usage.input, 300, "the call's usage is still recorded");
    assert.match(
      plan.error,
      /^Standard arrangements used automatically\. The track for slot \d+ had a description of 475 characters \(limit 420\)\.$/,
    );
    assert.equal(plan.briefs.length, plan.slots.length);
    assert.deepEqual(
      plan.briefs[0].brief,
      musicBrief(plan.playlist, plan.slots[0]),
    );
    const a = await fresh.system(musicAgentSummary);
    assert.equal(a.status, "generating");
    assert.match(
      a.message ?? "",
      /was not used.*No AI retry was sent.*475 characters/,
    );
    // The next tick queues a request from the standard arrangements; no new AI call.
    await fixture(() => processMusicAgent(fresh));
    const jobs = await fresh.system((tx) =>
      tx.query(
        "SELECT playlist,slot,status,brief,plan_id FROM workout_music_jobs",
      ),
    );
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].status, "queued");
    assert.equal(jobs[0].plan_id, plan.id);
    assert.deepEqual(jobs[0].brief, musicBrief(plan.playlist, jobs[0].slot));
    assert.equal(aiCalls, callsBefore + 1);
    // A reply that is not JSON is recorded with a code-built reason and the
    // next playlist is planned; the first playlist's request stays queued.
    planReply = () => "Here are your tracks: not json";
    await fresh.system((tx) =>
      tx.query("UPDATE workout_music_agent SET next_check_at=NULL"),
    );
    await fixture(() => processMusicAgent(fresh));
    assert.equal(aiCalls, callsBefore + 2);
    const [second] = await fresh.system((tx) =>
      tx.query("SELECT * FROM workout_music_plans WHERE id<>$1", [plan.id]),
    );
    assert.notEqual(second.playlist, plan.playlist);
    assert.equal(second.status, "ready");
    assert.equal(
      second.error,
      "Standard arrangements used automatically. The reply was not valid JSON.",
    );
    assert.equal((await fresh.system(musicAgentSummary)).status, "generating");
    // Provider failures are labelled from status fields, never provider text.
    const tick = () =>
      fresh
        .system((tx) =>
          tx.query("UPDATE workout_music_agent SET next_check_at=NULL"),
        )
        .then(() => fixture(() => processMusicAgent(fresh)));
    const plannedError = async () => {
      const [p] = await fresh.system((tx) =>
        tx.query(
          "SELECT status,error FROM workout_music_plans ORDER BY created_at DESC LIMIT 1",
        ),
      );
      assert.equal(p.status, "ready");
      return p.error;
    };
    planReply = null;
    await tick(); // queues the second playlist's standard arrangement
    planReply = () =>
      Response.json(
        { error: { message: "internal detail that must not be stored" } },
        { status: 500 },
      );
    await tick();
    assert.equal(aiCalls, callsBefore + 3);
    assert.equal(
      await plannedError(),
      "Standard arrangements used automatically. The AI provider returned HTTP 500.",
    );
    planReply = null;
    await tick();
    planReply = () => {
      throw new TypeError("socket hang up with internal detail");
    };
    await tick();
    assert.equal(aiCalls, callsBefore + 4);
    assert.equal(
      await plannedError(),
      "Standard arrangements used automatically. The AI request got no response (timeout or lost connection).",
    );
    const stored = await fresh.system((tx) =>
      tx.query("SELECT error FROM workout_music_plans"),
    );
    assert.ok(stored.every((p) => !/internal detail/.test(p.error ?? "")));
    assert.equal((await fresh.system(musicAgentSummary)).status, "generating");
  } finally {
    planReply = null;
    await fresh.close();
  }
});
