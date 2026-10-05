import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { createDatabase, type Database } from "@trainer/db";
import { downloadMusic } from "../packages/providers/src/suno-music.ts";
import {
  registerWorkoutMusic,
  processWorkoutMusic,
} from "../apps/api/src/workout-music.ts";
import { withRuntimeConfig } from "../packages/providers/src/configuration.ts";
import { withIntegrationFixtureTransport } from "../packages/providers/src/integrations.ts";
import {
  nextMusic,
  emptyMusicQueue,
  previousMusic,
  MUSIC_PLAYLISTS,
  musicBrief,
} from "../packages/domain/src/workout-music.ts";
let db: Database, app: ReturnType<typeof Fastify>, actor: any;
const settings = {
  MUSIC_API_KEY: "fixture-only",
  MUSIC_ENABLED: "true",
  MUSIC_CREDITS_PER_JOB: "12",
  MUSIC_DAILY_CREDIT_LIMIT: "100",
  PUBLIC_APP_URL: "https://coach.example.test",
  NODE_ENV: "test",
};
let submits = 0,
  ambiguous = false,
  balance = 500;
const requests = new Map<string, any>();
const fixture = <T>(fn: () => T) =>
  withRuntimeConfig(settings, () =>
    withIntegrationFixtureTransport(async (url, init) => {
      if (url.endsWith("/credit"))
        return Response.json({ code: 200, data: balance });
      if (url.endsWith("/generate")) {
        submits++;
        const b = JSON.parse(String(init.body));
        assert.equal(b.instrumental, true);
        assert.ok(b.callBackUrl);
        assert.equal(b.prompt, undefined);
        if (ambiguous) throw new Error("Connection lost after submission");
        requests.set("task-" + submits, b);
        return Response.json({
          code: 200,
          data: { taskId: "task-" + submits },
        });
      }
      if (url.includes("record-info")) {
        const id = new URL(url).searchParams.get("taskId");
        return Response.json({
          code: 200,
          data: {
            taskId: id,
            param: JSON.stringify(requests.get(id!)),
            status: "SUCCESS",
            response: {
              sunoData: [
                {
                  id: "track-" + id,
                  duration: 240,
                  title: "Flow fixture",
                  audio_url: "https://audio.example.test/" + id + ".mp3",
                },
              ],
            },
          },
        });
      }
      const bytes = Buffer.alloc(3 * 1024 * 1024);
      bytes.write("ID3" + url);
      return new Response(bytes, { headers: { "content-type": "audio/mpeg" } });
    }, fn),
  );
async function req(
  path: string,
  method: any = "GET",
  payload?: unknown,
  role = "admin",
  extra: any = {},
) {
  return fixture(
    async () =>
      await app.inject({
        url: "/api/v1" + path,
        method,
        payload,
        headers: { "x-fixture-role": role, ...extra },
      }),
  );
}
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
      "INSERT INTO users(id,email,name,password_hash) VALUES($1,'music@example.test','Music fixture','unused')",
      [actor.userId],
    );
    await tx.query(
      "INSERT INTO tenants(id,name,slug) VALUES($1,'Music fixture',$2)",
      [actor.tenantId, "music-" + actor.tenantId],
    );
    await tx.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')",
      [actor.tenantId, actor.userId],
    );
  });
  app = Fastify();
  registerWorkoutMusic(app, db, (r) => ({
    ...actor,
    platformRole: r.headers["x-fixture-role"] as string,
  }));
  app.setErrorHandler((error: any, _req: any, reply: any) =>
    reply
      .code(error.statusCode ?? 500)
      .send({ message: error.message, code: error.code }),
  );
  await app.ready();
});
after(async () => {
  await app?.close();
  await db?.close();
});
test("eight distinct genre briefs and a shuffle bag without repeats", () => {
  assert.equal(MUSIC_PLAYLISTS.length, 8);
  for (const p of MUSIC_PLAYLISTS)
    assert.equal(
      new Set(Array.from({ length: 30 }, (_, i) => musicBrief(p.id, i).style))
        .size,
      30,
    );
  const ids = Array.from({ length: 30 }, (_, i) => String(i));
  let q = emptyMusicQueue();
  const heard: string[] = [];
  for (let i = 0; i < 30; i++) {
    q = nextMusic(q, ids, true, "playlist");
    heard.push(q.current!);
  }
  assert.equal(new Set(heard).size, 30);
  const last = q.current;
  q = nextMusic(q, ids, true, "playlist");
  assert.notEqual(q.current, last);
  assert.equal(previousMusic(q, ids).current, last);
  assert.equal(nextMusic(q, ids, true, "track", true).current, q.current);
});
test("member cannot generate; batches reserve credits and retry the same intent only once", async () => {
  const id = randomUUID(),
    body = { requestId: id, playlist: "flow", requests: 1 };
  assert.equal(
    (await req("/admin/music/generate", "POST", body, "none")).statusCode,
    403,
  );
  assert.equal(
    (await req("/admin/music/generate", "POST", body)).statusCode,
    200,
  );
  assert.equal(
    (await req("/admin/music/generate", "POST", body)).statusCode,
    200,
  );
  assert.equal((await req("/admin/music")).json().jobs.length, 1);
  assert.equal(
    (
      await req("/admin/music/generate", "POST", {
        ...body,
        requestId: randomUUID(),
        requests: 15,
      })
    ).statusCode,
    409,
  );
  await fixture(() => processWorkoutMusic(db));
  await fixture(() => processWorkoutMusic(db));
  assert.equal(submits, 1);
  const data = (await req("/admin/music")).json();
  assert.equal(data.jobs[0].status, "complete");
  assert.equal(data.tracks.length, 1);
  const track = data.tracks[0];
  assert.equal((await req(`/music/${track.id}/audio`)).statusCode, 404);
  assert.equal(
    (
      await req(`/admin/music/${track.id}/review`, "POST", {
        status: "approved",
        note: "Reviewed fixture",
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await req(`/admin/music/${track.id}/review`, "POST", {
        status: "approved",
        note: "Reviewed instrumental fixture",
        instrumental: true,
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (await req("/music")).json().playlists[0].tracks.length,
    0,
    "A playlist is published only after 30 tracks are approved",
  );
  const audio = await req(
    `/music/${track.id}/audio`,
    "GET",
    undefined,
    "none",
    { range: "bytes=0-99" },
  );
  assert.equal(audio.statusCode, 206);
  assert.equal(audio.rawPayload.length, 100);
  assert.equal(audio.headers["content-range"], "bytes 0-99/3145728");
  assert.equal(
    (
      await req(`/music/${track.id}/audio`, "GET", undefined, "none", {
        range: "bytes=99999999-",
      })
    ).statusCode,
    416,
  );
  await req(`/admin/music/${track.id}/review`, "POST", {
    status: "rejected",
    note: "Removed fixture",
  });
  assert.equal((await req(`/music/${track.id}/audio`)).statusCode, 404);
});
test("unknown generation is held for reconciliation, never resubmitted", async () => {
  ambiguous = true;
  const r = await req("/admin/music/generate", "POST", {
    requestId: randomUUID(),
    playlist: "edm",
    requests: 1,
  });
  assert.equal(r.statusCode, 200, r.body);
  await fixture(() => processWorkoutMusic(db));
  const before = submits;
  await fixture(() => processWorkoutMusic(db));
  assert.equal(submits, before);
  assert.equal(
    (await req("/admin/music"))
      .json()
      .jobs.find((j: any) => j.playlist === "edm").status,
    "unknown",
  );
});

test("paid task imports are idempotent, read-only and verify the original instrumental brief", async () => {
  const body = {
    tasks: [{ playlist: "rock", slot: 0, taskId: "existing-rock" }],
  };
  requests.set("existing-rock", {
    ...musicBrief("rock", 0),
    instrumental: true,
  });
  assert.equal(
    (await req("/admin/music/import", "POST", body, "none")).statusCode,
    403,
  );
  assert.equal(
    (await req("/admin/music/import", "POST", body)).json().imported,
    1,
  );
  assert.equal(
    (await req("/admin/music/import", "POST", body)).json().existing,
    1,
  );
  const before = submits;
  await fixture(() => processWorkoutMusic(db));
  assert.equal(submits, before);
  assert.equal(
    (await req("/admin/music"))
      .json()
      .jobs.find((j: any) => j.playlist === "rock").status,
    "complete",
  );
  assert.equal(
    (
      await req("/admin/music/import", "POST", {
        tasks: [{ ...body.tasks[0], playlist: "rnb" }],
      })
    ).statusCode,
    409,
  );
  requests.set("wrong-rnb", { ...musicBrief("rnb", 0), instrumental: false });
  await req("/admin/music/import", "POST", {
    tasks: [{ playlist: "rnb", slot: 0, taskId: "wrong-rnb" }],
  });
  await fixture(() => processWorkoutMusic(db));
  assert.equal(
    (await req("/admin/music"))
      .json()
      .jobs.find((j: any) => j.playlist === "rnb").status,
    "failed",
  );
});
test("music download allows full songs and rejects files over its explicit bound", async () => {
  assert.equal(
    (await fixture(() => downloadMusic("https://audio.example.test/full.mp3")))
      .length,
    3 * 1024 * 1024,
  );
  await withIntegrationFixtureTransport(
    async () =>
      new Response(Buffer.alloc(1024), {
        headers: {
          "content-type": "audio/mpeg",
          "content-length": String(21 * 1024 * 1024),
        },
      }),
    async () => {
      await assert.rejects(
        downloadMusic("https://audio.example.test/large.mp3"),
        /storage limit/,
      );
    },
  );
});

test("unresolved prior-day charges remain reserved against account credits", async () => {
  await db.system((tx) =>
    tx.query(
      "UPDATE workout_music_jobs SET created_at=now()-interval '2 days',submitted_at=now()-interval '2 days' WHERE status='unknown'",
    ),
  );
  balance = 20;
  const r = await req("/admin/music/generate", "POST", {
    requestId: randomUUID(),
    playlist: "hiphop",
    requests: 1,
  });
  balance = 500;
  assert.equal(r.statusCode, 409, r.body);
});

test("the worker rechecks the daily spending limit before a queued submission", async () => {
  const queued = await req("/admin/music/generate", "POST", {
    requestId: randomUUID(),
    playlist: "recovery",
    requests: 1,
  });
  assert.equal(queued.statusCode, 200, queued.body);
  const before = submits;
  await fixture(() =>
    withRuntimeConfig({ ...settings, MUSIC_DAILY_CREDIT_LIMIT: "12" }, () =>
      processWorkoutMusic(db),
    ),
  );
  assert.equal(submits, before);
  assert.equal(
    (await req("/admin/music"))
      .json()
      .jobs.find((j: any) => j.playlist === "recovery").status,
    "queued",
  );
});
