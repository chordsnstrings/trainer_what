// "My own music" mode in the voice-led session: the audio-session helper,
// joined cue clips within the length budget, and the tap-to-talk states
// (apps/web/lib/audio-session.ts, apps/web/lib/tap-to-talk.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  joinMp3,
  mp3Info,
  planCue,
  requestWakeLock,
  savedMusicMode,
  setAudioSessionType,
  audioSessionSupported,
  silentWav,
  CUE_BUDGET_MS,
} from "../apps/web/lib/audio-session.ts";
import { idleTalk, stepTalk, TALK_LIMITS, type TalkEffect, type TalkEvent, type TalkState } from "../apps/web/lib/tap-to-talk.ts";

// MPEG-1 Layer III, 128 kbps, 44.1 kHz, joint stereo: 417-byte frames of 1152 samples.
const FRAME = 417;
function frame(tag?: string) {
  const f = new Uint8Array(FRAME);
  f.set([0xff, 0xfb, 0x90, 0x44]);
  if (tag) f.set([...tag].map((c) => c.charCodeAt(0)), 4 + 32);
  return f;
}
function clip(frames: number, extras: { id3?: boolean; info?: boolean; id3v1?: boolean } = {}) {
  const parts: Uint8Array[] = [];
  if (extras.id3) parts.push(Uint8Array.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 20]), new Uint8Array(20));
  if (extras.info) parts.push(frame("Info"));
  for (let i = 0; i < frames; i++) parts.push(frame());
  if (extras.id3v1) parts.push(Uint8Array.from([0x54, 0x41, 0x47, ...new Array(125).fill(0)]));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
const ms = (frames: number) => Math.round(((frames * 1152) / 44100) * 1000);

test("an MP3 clip's length is read from its frames, without tags or the header frame", () => {
  const info = mp3Info(clip(10, { id3: true, info: true, id3v1: true }))!;
  assert.equal(info.frames.length, 10);
  assert.equal(info.durationMs, ms(10));
  assert.equal(info.frames[0][0], 30 + FRAME, "audio starts after the ID3 tag and the Info frame");
  assert.equal(mp3Info(silentWav()), null);
  assert.equal(mp3Info(new Uint8Array(0)), null);
});

test("a cue's clips are joined into one clip with a known duration", () => {
  const joined = joinMp3([clip(10, { id3: true, info: true }), clip(30, { info: true, id3v1: true })])!;
  assert.equal(joined.bytes.length, 40 * FRAME);
  assert.equal(joined.durationMs, ms(10) + ms(30));
  assert.equal(mp3Info(joined.bytes)!.durationMs, ms(40));
  // No tag or header frame is left inside the joined clip.
  const text = String.fromCharCode(...joined.bytes);
  assert.ok(!text.includes("Info") && !text.includes("ID3") && !text.includes("TAG"));
  // Something that is not MP3 is never joined: the clips play one by one.
  assert.equal(joinMp3([clip(2), silentWav()]), null);
  assert.equal(joinMp3([]), null);
});

test("each joined clip stays within the cue budget; longer or unknown clips stay on screen", () => {
  assert.equal(CUE_BUDGET_MS, 4500);
  assert.deepEqual(planCue([1000, 2000, 1000, 5000, null, 4000, 600]), {
    groups: [[0, 1, 2], [5], [6]],
    textOnly: [3, 4],
  });
  assert.deepEqual(planCue([4500]), { groups: [[0]], textOnly: [] });
  assert.deepEqual(planCue([4501]), { groups: [], textOnly: [0] });
  for (const durations of [[800, 800, 800, 800, 800, 800], [3000, 1600, 2900], [100, 4400, 100]]) {
    const plan = planCue(durations);
    for (const g of plan.groups) assert.ok(g.reduce((n, i) => n + durations[i], 0) <= CUE_BUDGET_MS);
    assert.deepEqual(plan.groups.flat(), durations.map((_, i) => i), "every clip plays, in order");
  }
});

test("the audio session type is set only where the browser supports it", () => {
  const nav = { audioSession: { type: "auto" } };
  assert.equal(audioSessionSupported(nav), true);
  assert.equal(setAudioSessionType("ambient", nav), true);
  assert.equal(nav.audioSession.type, "ambient");
  assert.equal(setAudioSessionType("play-and-record", nav), true);
  assert.equal(setAudioSessionType("ambient", nav), true);
  assert.equal(audioSessionSupported({}), false);
  assert.equal(setAudioSessionType("ambient", {}), false);
  assert.equal(setAudioSessionType("ambient", undefined), false);
  // A setter that throws or is ignored (no microphone permission) reports false.
  const throwing = { audioSession: { get type() { return "auto"; }, set type(_v: string) { throw new Error("denied"); } } };
  assert.equal(setAudioSessionType("ambient", throwing as any), false);
  const ignored = { audioSession: { get type() { return "auto"; }, set type(_v: string) {} } };
  assert.equal(setAudioSessionType("ambient", ignored as any), false);
});

test("the screen wake lock is requested where supported and never throws", async () => {
  let asked = "";
  const lock = await requestWakeLock({ wakeLock: { request: async (t: "screen") => ((asked = t), { release: async () => {} }) } });
  assert.ok(lock);
  assert.equal(asked, "screen");
  assert.equal(await requestWakeLock({ wakeLock: { request: async () => { throw new Error("NotAllowedError"); } } }), null);
  assert.equal(await requestWakeLock({}), null);
});

test("the unlock clip is a short silent WAV; the music choice is remembered per device", () => {
  const wav = silentWav();
  assert.equal(String.fromCharCode(...wav.subarray(0, 4)), "RIFF");
  assert.equal(String.fromCharCode(...wav.subarray(8, 12)), "WAVE");
  assert.equal(wav.length, 44 + 800);
  assert.ok(wav.subarray(44).every((v) => v === 128));
  assert.equal(savedMusicMode({ getItem: () => "own" }), "own");
  assert.equal(savedMusicMode({ getItem: () => "something" }), "off");
  assert.equal(savedMusicMode({ getItem: () => { throw new Error("blocked"); } }), "off");
  assert.equal(savedMusicMode(null), "off");
});

function run(events: TalkEvent[], from: TalkState = idleTalk()) {
  let s = from;
  const effects: TalkEffect[][] = [];
  for (const e of events) {
    const [next, fx] = stepTalk(s, e);
    s = next;
    effects.push(fx);
  }
  return { state: s, effects };
}

test("tap to talk: record one reply, then close the microphone and return to ambient", () => {
  const r = run([
    { type: "tap", now: 0 },
    { type: "mic_ready", now: 300 },
    { type: "level", loud: false, now: 500 },
    { type: "level", loud: true, now: 900 },
    { type: "level", loud: false, now: 1400 },
    { type: "level", loud: false, now: 2100 },
    { type: "level", loud: false, now: 2300 },
  ]);
  assert.deepEqual(r.effects[0], ["session_record", "open_mic"]);
  assert.deepEqual(r.effects[1], ["start_recording"]);
  assert.deepEqual(r.effects.slice(2, 6), [[], [], [], []]);
  assert.deepEqual(r.effects[6], ["stop_and_send", "close_mic", "session_ambient"]);
  assert.equal(r.state.phase, "sending");
  assert.deepEqual(stepTalk(r.state, { type: "done" }), [idleTalk(), []]);
  // A tap while sending changes nothing.
  assert.deepEqual(stepTalk(r.state, { type: "tap", now: 2400 })[0].phase, "sending");
});

test("tap to talk: silence, the 6-second limit, a second tap, a failed microphone and cancel", () => {
  const recording = run([{ type: "tap", now: 0 }, { type: "mic_ready", now: 200 }]).state;
  // Nothing said within the limit: discarded, nothing sent.
  assert.deepEqual(stepTalk(recording, { type: "level", loud: false, now: 200 + TALK_LIMITS.noSpeechMs })[1], ["discard", "close_mic", "session_ambient"]);
  // Speaking for 6 s: stopped and sent.
  const loud = run([{ type: "level", loud: true, now: 1000 }, { type: "level", loud: true, now: 200 + TALK_LIMITS.maxMs }], recording);
  assert.deepEqual(loud.effects[1], ["stop_and_send", "close_mic", "session_ambient"]);
  // A second tap stops early: sent after speech, discarded before it.
  assert.deepEqual(run([{ type: "level", loud: true, now: 500 }, { type: "tap", now: 700 }], recording).effects[1], ["stop_and_send", "close_mic", "session_ambient"]);
  assert.deepEqual(stepTalk(recording, { type: "tap", now: 700 })[1], ["discard", "close_mic", "session_ambient"]);
  // The microphone could not open, or the member tapped again while it opened.
  const opening = stepTalk(idleTalk(), { type: "tap", now: 0 })[0];
  assert.deepEqual(stepTalk(opening, { type: "mic_failed" }), [idleTalk(), ["close_mic", "session_ambient"]]);
  assert.deepEqual(stepTalk(opening, { type: "tap", now: 50 }), [idleTalk(), ["close_mic", "session_ambient"]]);
  // On-device recognition: its final words end the recording.
  assert.deepEqual(stepTalk(recording, { type: "result" }), [idleTalk(), ["close_mic", "session_ambient"]]);
  // Pain, the end of the session or a mode change cancels from any phase.
  assert.deepEqual(stepTalk(recording, { type: "cancel" })[1], ["discard", "close_mic", "session_ambient"]);
  assert.deepEqual(stepTalk(opening, { type: "cancel" })[1], ["close_mic", "session_ambient"]);
  assert.deepEqual(stepTalk(idleTalk(), { type: "cancel" })[1], []);
});

test("tap to talk never leaves the microphone open or the session in record mode", () => {
  // A seeded walk over every event: whenever a microphone was opened, the
  // walk back to idle or sending always closed it and restored ambient.
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let walk = 0; walk < 200; walk++) {
    let s = idleTalk(),
      now = 0,
      open = false,
      record = false;
    for (let step = 0; step < 40; step++) {
      now += Math.floor(rand() * 900);
      const kinds = ["tap", "mic_ready", "mic_failed", "level", "level", "level", "result", "done", "cancel"] as const;
      const kind = kinds[Math.floor(rand() * kinds.length)];
      const e: TalkEvent =
        kind === "level"
          ? { type: "level", loud: rand() < 0.5, now }
          : kind === "tap" || kind === "mic_ready"
            ? { type: kind, now }
            : ({ type: kind } as TalkEvent);
      const [next, fx] = stepTalk(s, e);
      if (fx.includes("open_mic")) open = true;
      if (fx.includes("session_record")) record = true;
      if (fx.includes("close_mic")) open = false;
      if (fx.includes("session_ambient")) record = false;
      if (next.phase === "idle" || next.phase === "sending") assert.deepEqual([open, record], [false, false], JSON.stringify({ s, e, fx }));
      s = next;
    }
  }
});
