import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import Fastify from "fastify";
import { createDatabase, type Database } from "@trainer/db";
import { withRuntimeConfig } from "../packages/providers/src/configuration.ts";
import { withIntegrationFixtureTransport } from "../packages/providers/src/integrations.ts";
import {
  MUSIC_PLAYLISTS,
  musicBrief,
} from "../packages/domain/src/workout-music.ts";
import { validateMusicPlan } from "../packages/providers/src/music-planner.ts";
import { prepareMusicAudio } from "../packages/providers/src/music-audio.ts";
import {
  processMusicAgent,
  saveMusicAgent,
  musicAgentSummary,
  useStandardMusicPlan,
} from "../apps/api/src/music-agent.ts";
import {
  processWorkoutMusic,
  processMusicReview,
  registerWorkoutMusic,
} from "../apps/api/src/workout-music.ts";
let db: Database, app: ReturnType<typeof Fastify>, actor: any, audio: Buffer;
let aiCalls = 0,
  submits = 0;
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
const requests = new Map<string, any>();
async function fixture<T>(
  fn: () => Promise<T>,
  overrides: Record<string, string> = {},
): Promise<T> {
  const prior = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    assert.ok(url.startsWith("https://music-planner.example.test/v1/"));
    const body = JSON.parse(String(init?.body));
    assert.equal(body.max_tokens, 2500);
    const prompt = JSON.parse(body.messages[1].content);
    assert.deepEqual(Object.keys(prompt).sort(), [
      "bpm",
      "genre",
      "slots",
      "style",
      "version",
    ]);
    aiCalls++;
    return Response.json({
      id: "fixture",
      choices: [
        {
          message: {
            content: JSON.stringify({
              tracks: prompt.slots.map((slot: number) => ({
                slot,
                bpm: prompt.bpm,
                arrangement: `Original layered percussion with warm keys and bass motif number ${slot + 1}; gradual build and spacious steady groove`,
              })),
            }),
          },
        },
      ],
      usage: { prompt_tokens: 300, completion_tokens: 400 },
    });
  };
  try {
    return await withRuntimeConfig({ ...config, ...overrides }, () =>
      withIntegrationFixtureTransport(async (url, init) => {
        if (url.endsWith("/credit"))
          return Response.json({ code: 200, data: 2000 });
        if (url.endsWith("/generate")) {
          submits++;
          const body = JSON.parse(String(init.body));
          assert.equal(body.instrumental, true);
          assert.match(body.style, /Original layered percussion/);
          requests.set("task-" + submits, body);
          return Response.json({
            code: 200,
            data: { taskId: "task-" + submits },
          });
        }
        if (url.includes("record-info")) {
          const id = new URL(url).searchParams.get("taskId")!,
            body = requests.get(id);
          return Response.json({
            code: 200,
            data: {
              taskId: id,
              param: JSON.stringify(body),
              status: "SUCCESS",
              response: {
                sunoData: [
                  {
                    id: "track-" + id,
                    duration: 180,
                    title: body.title,
                    audio_url: "https://audio.example.test/" + id + ".mp3",
                  },
                ],
              },
            },
          });
        }
        return new Response(new Uint8Array(audio), {
          headers: { "content-type": "audio/mpeg" },
        });
      }, fn),
    );
  } finally {
    globalThis.fetch = prior;
  }
}
const wake = () =>
  db.system((tx) =>
    tx.query("UPDATE workout_music_agent SET next_check_at=NULL"),
  );
const info = () => db.system(musicAgentSummary);
before(async () => {
  db = await createDatabase({ memory: true });
  actor = {
    tenantId: randomUUID(),
    userId: randomUUID(),
    role: "owner",
    platformRole: "admin",
    mfaAt: new Date().toISOString(),
  };
  await db.system(async (tx) => {
    await tx.query(
      "INSERT INTO users(id,email,name,password_hash) VALUES($1,'agent@example.test','Agent fixture','unused')",
      [actor.userId],
    );
    await tx.query(
      "INSERT INTO tenants(id,name,slug) VALUES($1,'Agent fixture',$2)",
      [actor.tenantId, "agent-" + actor.tenantId],
    );
    await tx.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')",
      [actor.tenantId, actor.userId],
    );
  });
  app = Fastify();
  registerWorkoutMusic(app, db, (r) => ({
    ...actor,
    platformRole: (r.headers["x-fixture-role"] as string) ?? "admin",
  }));
  app.setErrorHandler((e: any, _r: any, reply: any) =>
    reply.code(e.statusCode ?? 400).send({ message: e.message, code: e.code }),
  );
  await app.ready();
  audio = execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=220:duration=180",
      "-codec:a",
      "libmp3lame",
      "-b:a",
      "128k",
      "-f",
      "mp3",
      "pipe:1",
    ],
    { maxBuffer: 8 * 1024 * 1024 },
  );
});
after(async () => {
  await app?.close();
  await db?.close();
});
test("planner validates reserved slots, tempo and distinct bounded arrangements", () => {
  const track = {
    slot: 0,
    bpm: 110,
    arrangement: "Warm keys over steady percussion and a spacious bass groove",
  };
  assert.equal(
    validateMusicPlan({ tracks: [track] }, "flow", [0])[0].brief.title,
    musicBrief("flow", 0).title,
  );
  assert.throws(() =>
    validateMusicPlan({ tracks: [{ ...track, slot: 1 }] }, "flow", [0]),
  );
  assert.throws(() =>
    validateMusicPlan({ tracks: [{ ...track, bpm: 150 }] }, "flow", [0]),
  );
  assert.throws(() =>
    validateMusicPlan({ tracks: [track, track] }, "flow", [0, 1]),
  );
  assert.throws(() =>
    validateMusicPlan(
      {
        tracks: [
          {
            ...track,
            arrangement: "Listen to the example at https://example.test/track",
          },
        ],
      },
      "flow",
      [0],
    ),
  );
});
test("agent starts paused and requires an administrator to reconcile prior purchases", async () => {
  await fixture(() => processMusicAgent(db));
  assert.equal(aiCalls, 0);
  assert.equal(submits, 0);
  const denied = await app.inject({
    url: "/api/v1/admin/music/agent",
    method: "POST",
    payload: settings,
    headers: { "x-fixture-role": "subscriber" },
  });
  assert.equal(denied.statusCode, 403);
  await assert.rejects(
    db.system((tx) =>
      saveMusicAgent(tx, actor.userId, {
        ...settings,
        recoveryConfirmed: false,
      }),
    ),
    /reconcile/,
  );
  // Old open pages can still save, but their lifetime caps have no effect.
  await db.system((tx) =>
    saveMusicAgent(tx, actor.userId, {
      ...settings,
      requestLimit: 160,
      creditLimit: 5000,
      modelCallLimit: 100,
      modelUsdLimit: 20,
    }),
  );
  const saved = await info();
  for (const key of [
    "request_limit",
    "credit_limit",
    "model_call_limit",
    "model_usd_limit",
  ])
    assert.equal(key in saved, false);
  const [legacy] = await db.system((tx) =>
    tx.query("SELECT request_limit,credit_limit FROM workout_music_agent"),
  );
  assert.equal(legacy.request_limit, 120);
  assert.equal(Number(legacy.credit_limit), 1440);
  const [audit] = await db.system((tx) =>
    tx.query(
      "SELECT detail FROM workout_music_audit WHERE action='agent_settings' ORDER BY created_at DESC LIMIT 1",
    ),
  );
  assert.deepEqual(audit.detail, settings);
  await db.system((tx) => saveMusicAgent(tx, actor.userId, settings));
});
test("concurrent ticks plan once, reserve before purchase and keep paid downloads running when paused", async () => {
  await fixture(() =>
    Promise.all([processMusicAgent(db), processMusicAgent(db)]),
  );
  assert.equal(aiCalls, 1);
  assert.equal((await info()).modelCalls, 1);
  await wake();
  await fixture(() => processMusicAgent(db));
  const jobs = await db.system((tx) =>
    tx.query("SELECT * FROM workout_music_jobs"),
  );
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].status, "queued");
  assert.match(jobs[0].brief.style, /Original layered percussion/);
  assert.equal((await info()).reservedCredits, 12);
  assert.equal(submits, 0);
  await db.system((tx) =>
    saveMusicAgent(tx, actor.userId, { ...settings, enabled: false }),
  );
  await fixture(() => processWorkoutMusic(db));
  assert.equal(submits, 0);
  await db.system((tx) => saveMusicAgent(tx, actor.userId, settings));
  await fixture(() => processWorkoutMusic(db));
  assert.equal(submits, 1);
  await db.system((tx) =>
    saveMusicAgent(tx, actor.userId, { ...settings, enabled: false }),
  );
  await fixture(() => processWorkoutMusic(db));
  let tracks = await db.system((tx) =>
    tx.query("SELECT status FROM workout_music_tracks"),
  );
  assert.equal(tracks[0].status, "review");
  await processMusicReview(db);
  tracks = await db.system((tx) =>
    tx.query("SELECT status FROM workout_music_tracks"),
  );
  assert.equal(tracks[0].status, "review");
});
test("local MP3 checks publish playable normalized audio without inventing a listening review", async () => {
  await db.system((tx) => saveMusicAgent(tx, actor.userId, settings));
  await processMusicReview(db);
  const [track] = await db.system((tx) =>
    tx.query("SELECT * FROM workout_music_tracks"),
  );
  assert.equal(track.status, "approved");
  assert.equal(track.publication_source, "automatic");
  assert.equal(track.reviewed_by, null);
  assert.equal(track.audio_check.listeningReviewed, false);
  assert.equal(track.audio_check.loudnessTargetLufs, -16);
  assert.equal(aiCalls, 1);
  const streamed = await app.inject({
    url: `/api/v1/music/${track.id}/audio`,
    headers: { range: "bytes=0-99" },
  });
  assert.equal(streamed.statusCode, 206);
  assert.equal(streamed.rawPayload.length, 100);
  await assert.rejects(prepareMusicAudio(Buffer.alloc(2048), 180));
  await assert.rejects(prepareMusicAudio(audio, 300));
});
test("unknown purchases still pause work; saved lifetime caps no longer stop planning, queuing or dispatch", async () => {
  const id = randomUUID();
  await db.system((tx) =>
    tx.query(
      "INSERT INTO workout_music_jobs(id,playlist,slot,status,credit_limit,requested_by) VALUES($1,'rock',59,'unknown',12,$2)",
      [id, actor.userId],
    ),
  );
  await wake();
  await fixture(() => processMusicAgent(db));
  assert.equal((await info()).status, "reconciliation");
  assert.equal(aiCalls, 1);
  await db.system((tx) =>
    tx.query("UPDATE workout_music_jobs SET status='failed' WHERE id=$1", [id]),
  );
  await db.system((tx) =>
    saveMusicAgent(tx, actor.userId, {
      ...settings,
      externalRequests: 118,
      externalCredits: 1416,
    }),
  );
  // Reproduce the production stall, including the delayed next check. The
  // first tick after deployment must resume without changing saved settings.
  await db.system((tx) =>
    tx.query(
      "UPDATE workout_music_agent SET status='budget',next_check_at=now()+interval '5 minutes',model_call_limit=1,model_usd_limit=0.01",
    ),
  );
  await fixture(() => processMusicAgent(db));
  const a = await info();
  assert.equal(a.usedRequests, 120);
  assert.equal(a.reservedCredits, 1440);
  assert.equal(a.status, "generating");
  assert.equal(aiCalls, 2);
  await wake();
  await fixture(() => processMusicAgent(db));
  assert.equal((await info()).reservedCredits, 1452);
  await fixture(() => processWorkoutMusic(db));
  assert.equal(
    submits,
    2,
    "a request is dispatched beyond the old credit/request/planner limits",
  );
  await assert.rejects(
    db.system((tx) => saveMusicAgent(tx, actor.userId, settings)),
    /cannot be reduced/,
  );
  const r = await fixture(
    async () =>
      await app.inject({
        url: "/api/v1/admin/music/generate",
        method: "POST",
        payload: {
          requestId: randomUUID(),
          playlist: "afrolatin",
          requests: 1,
        },
      }),
  );
  assert.equal(
    r.statusCode,
    200,
    "manual generation also uses daily limits only",
  );
});
test("daily limits still protect both reservation and dispatch, and prior days do not block new work", async () => {
  const before = { aiCalls, submits };
  await wake();
  await fixture(() => processMusicAgent(db), {
    MUSIC_DAILY_CREDIT_LIMIT: "24",
  });
  assert.equal((await info()).status, "daily_budget");
  const denied = await fixture(
    async () =>
      await app.inject({
        method: "POST",
        url: "/api/v1/admin/music/generate",
        payload: { requestId: randomUUID(), playlist: "hiphop", requests: 1 },
      }),
    { MUSIC_DAILY_CREDIT_LIMIT: "24" },
  );
  assert.equal(denied.statusCode, 409);
  assert.equal(denied.json().code, "MUSIC_BUDGET");
  await fixture(() => processWorkoutMusic(db), {
    MUSIC_DAILY_CREDIT_LIMIT: "24",
  });
  // A paid task can still finish downloading; the queued purchase stays blocked.
  await fixture(() => processWorkoutMusic(db), {
    MUSIC_DAILY_CREDIT_LIMIT: "24",
  });
  assert.equal(aiCalls, before.aiCalls);
  assert.equal(submits, before.submits);
  await db.system((tx) =>
    tx.query(
      "UPDATE workout_music_jobs SET submitted_at=now()-interval '1 day' WHERE submitted_at IS NOT NULL",
    ),
  );
  const summary = await fixture(info, { MUSIC_DAILY_CREDIT_LIMIT: "24" });
  assert.equal(summary.dailyCreditLimit, 24);
  assert.equal(
    summary.dailyCreditsReserved,
    12,
    "unsent requests retain today's reservation",
  );
  assert.equal(
    summary.reservedCredits,
    1464,
    "historical and external usage remain recorded",
  );
});
test("an interrupted plan retains its cost and recovers with standard arrangements without another model call", async () => {
  const callsBefore = aiCalls;
  const id = randomUUID();
  await db.system((tx) =>
    tx.query(
      "INSERT INTO workout_music_plans(id,playlist,slots,status,prompt_version,model,reserved_usd,leased_until) VALUES($1,'rnb','[0,1]','planning','music-plan-v1','seed-2-0-pro-260328',0.01,now()-interval '1 minute')",
      [id],
    ),
  );
  await wake();
  await fixture(() => processMusicAgent(db));
  assert.equal((await info()).status, "planner_review");
  const before = (await info()).reservedModelUsd;
  await db.system((tx) => useStandardMusicPlan(tx, id, actor.userId));
  const [p] = await db.system((tx) =>
    tx.query("SELECT * FROM workout_music_plans WHERE id=$1", [id]),
  );
  assert.equal(p.status, "ready");
  assert.equal(p.briefs[0].brief.title, musicBrief("rnb", 0).title);
  assert.equal((await info()).reservedModelUsd, before);
  assert.equal(aiCalls, callsBefore);
});
test("a full shared library stops all purchases and publishes thirty tracks per genre", async () => {
  const before = { aiCalls, submits };
  await db.system(async (tx) => {
    const [job] = await tx.query("SELECT id FROM workout_music_jobs LIMIT 1");
    for (const p of MUSIC_PLAYLISTS)
      for (let i = 0; i < 30; i++)
        await tx.query(
          "INSERT INTO workout_music_tracks(id,job_id,provider_id,playlist,title,duration,sha256,audio,status) VALUES($1,$2,$3,$4,$5,180,$6,$7,'approved')",
          [
            randomUUID(),
            job.id,
            randomUUID(),
            p.id,
            "Ready fixture " + i,
            randomUUID(),
            Buffer.alloc(1024),
          ],
        );
  });
  await wake();
  await fixture(() => processMusicAgent(db));
  assert.equal((await info()).status, "ready");
  assert.equal(aiCalls, before.aiCalls);
  assert.equal(submits, before.submits);
  assert.equal((await info()).readyPlaylists, 8);
  assert.equal((await info()).readyTracks, 240);
  const r = await app.inject({ url: "/api/v1/music" });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().playlists.length, 8);
  assert.ok(r.json().playlists.every((p: any) => p.tracks.length >= 30));
});

test("a rejected track is replaced with a checked MP3, daily planning resumes and the completed library stops", async () => {
  const before = { aiCalls, submits };
  await db.system(async (tx) => {
    // Cancel the earlier synthetic manual request; no paid intent is removed.
    await tx.query(
      "UPDATE workout_music_jobs SET status='cancelled' WHERE status='queued'",
    );
    await tx.query(
      "UPDATE workout_music_tracks SET status='rejected' WHERE id=(SELECT id FROM workout_music_tracks WHERE playlist='recovery' AND status='approved' LIMIT 1)",
    );
    for (let i = 0; i < 8; i++)
      await tx.query(
        "INSERT INTO workout_music_plans(id,playlist,slots,status,prompt_version,model,reserved_usd,briefs) VALUES($1,'recovery','[59]','ready','music-plan-v1','seed-2-0-pro-260328',0.01,'[]')",
        [randomUUID()],
      );
  });
  assert.equal((await info()).readyTracks, 239);
  await wake();
  await fixture(() => processMusicAgent(db));
  assert.equal((await info()).status, "daily_planning_limit");
  assert.equal(aiCalls, before.aiCalls);
  assert.equal(submits, before.submits);
  // A new UTC day releases only the daily allowance. Historical costs remain.
  const historicalCost = (await info()).reservedModelUsd;
  await db.system((tx) =>
    tx.query(
      "UPDATE workout_music_plans SET created_at=now()-interval '1 day'",
    ),
  );
  await wake();
  await fixture(() => processMusicAgent(db));
  assert.equal(aiCalls, before.aiCalls + 1);
  assert.ok((await info()).reservedModelUsd > historicalCost);
  await wake();
  await fixture(() => processMusicAgent(db));
  audio = execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=330:duration=180",
      "-codec:a",
      "libmp3lame",
      "-b:a",
      "128k",
      "-f",
      "mp3",
      "pipe:1",
    ],
    { maxBuffer: 8 * 1024 * 1024 },
  );
  await fixture(() => processWorkoutMusic(db));
  await fixture(() => processWorkoutMusic(db));
  assert.equal(submits, before.submits + 1);
  assert.equal(
    (await info()).readyTracks,
    239,
    "downloaded audio is not yet approved",
  );
  // Review processes one stored file per tick, including earlier paid files.
  for (let i = 0; i < 4 && (await info()).readyTracks < 240; i++)
    await processMusicReview(db);
  await wake();
  await fixture(() => processMusicAgent(db));
  const completed = await info();
  assert.equal(completed.status, "ready");
  assert.equal(completed.readyTracks, 240);
  assert.equal(completed.readyPlaylists, 8);
  const [track] = await db.system((tx) =>
    tx.query(
      "SELECT id,audio_check FROM workout_music_tracks WHERE playlist='recovery' AND publication_source='automatic'",
    ),
  );
  assert.equal(track.audio_check.passed, true);
  const stream = await app.inject({
    url: `/api/v1/music/${track.id}/audio`,
    headers: { range: "bytes=0-99" },
  });
  assert.equal(stream.statusCode, 206);
  assert.equal(stream.rawPayload.length, 100);
  for (let i = 0; i < 2; i++) {
    await wake();
    await fixture(() => processMusicAgent(db));
    await fixture(() => processWorkoutMusic(db));
  }
  assert.equal(aiCalls, before.aiCalls + 1);
  assert.equal(submits, before.submits + 1);
});
