import { test } from "node:test";
import assert from "node:assert/strict";
import { VoiceWaitCues } from "../apps/web/lib/voice-wait-cues.ts";

function fixture() {
  let now = 0,
    sequence = 0,
    long = 0,
    stopped = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const played: string[] = [],
    clips: string[] = ["brief", "longer"];
  let play = async (clip: string, valid: () => boolean) => {
    if (valid()) played.push(clip);
  };
  const cues = new VoiceWaitCues({
    clips: () => clips,
    play: (clip, valid) => play(clip, valid),
    stop: () => {
      stopped++;
    },
    longWait: () => {
      long++;
    },
    now: () => now,
    later: ((fn: () => void, delay: number) => {
      const id = ++sequence;
      timers.set(id, { at: now + delay, fn });
      return id;
    }) as any,
    cancel: ((id: number) => timers.delete(id)) as any,
  });
  async function advance(ms: number) {
    const end = now + ms;
    for (;;) {
      const entry = [...timers]
        .filter(([, t]) => t.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!entry) break;
      now = entry[1].at;
      timers.delete(entry[0]);
      entry[1].fn();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    }
    now = end;
  }
  return {
    cues,
    advance,
    played,
    clips,
    timers,
    long: () => long,
    stopped: () => stopped,
    setPlay: (fn: typeof play) => {
      play = fn;
    },
  };
}
test("short waits stay quiet; longer waits get at most two cues and a truthful long-wait state", async () => {
  const f = fixture();
  f.cues.begin();
  await f.advance(1499);
  assert.deepEqual(f.played, []);
  await f.advance(1);
  assert.deepEqual(f.played, ["brief"]);
  await f.advance(6500);
  assert.deepEqual(f.played, ["brief", "longer"]);
  await f.advance(60000);
  assert.equal(f.long(), 1);
  assert.equal(f.played.length, 2);
  assert.equal(f.timers.size, 0);
});
test("a ready answer, interruption or end cancels timers and invalidates late decoded audio", async () => {
  const f = fixture();
  let release!: () => void;
  f.setPlay(async (clip, valid) => {
    await new Promise<void>((r) => (release = r));
    if (valid()) f.played.push(clip);
  });
  f.cues.begin();
  await f.advance(1500);
  f.cues.end();
  release();
  await f.advance(30000);
  assert.deepEqual(f.played, []);
  assert.equal(f.long(), 0);
  assert.equal(f.timers.size, 0);
  f.cues.begin();
  await f.advance(1000);
  f.cues.end();
  await f.advance(30000);
  assert.deepEqual(f.played, []);
});
test("late optional preparation can fill a current wait but never resurrect an ended turn", async () => {
  const f = fixture();
  f.clips.length = 0;
  f.cues.begin();
  await f.advance(2500);
  f.clips.push("brief", "longer");
  await f.advance(250);
  assert.deepEqual(f.played, ["brief"]);
  f.cues.end();
  await f.advance(10000);
  assert.equal(f.played.length, 1);
});
