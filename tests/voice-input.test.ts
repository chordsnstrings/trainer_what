import { test } from "node:test";
import assert from "node:assert/strict";
import { VoiceDecisionGate } from "../apps/web/lib/voice-decision.ts";
import { VoicePlayback } from "../apps/web/lib/voice-playback.ts";
import { ConversationAudio } from "../apps/web/lib/conversation-audio.ts";

test("loud non-speech cannot trigger an upload or interruption; invalid frames reset confidence", () => {
  const gate = new VoiceDecisionGate(),
    capture = new ConversationAudio(16000, 20, 224);
  for (let n = 0; n < 1000; n++) {
    const result = gate.sample(0.05, 0.4, 32, "interrupt");
    assert.equal(result.speech, false);
    assert.equal(result.tentative, false);
    assert.equal(result.interrupt, false);
    assert.equal(capture.push(new Float32Array(512), result.speech), null);
  }
  for (let n = 0; n < 11; n++) gate.sample(0.99, 0.1, 32, "interrupt");
  assert.equal(gate.sample(NaN, 0.1, 32, "interrupt").interrupt, false);
  assert.equal(gate.sample(0.99, 0.1, 32, "interrupt").tentative, false);
});

test("ordinary speech is retained before the stronger interruption threshold", () => {
  const gate = new VoiceDecisionGate();
  const decisions = Array.from({ length: 12 }, () =>
    gate.sample(0.95, 0.1, 32, "interrupt"),
  );
  assert.equal(decisions[1].speech, true);
  assert.equal(decisions[2].tentative, true);
  assert.equal(decisions[10].interrupt, false);
  assert.equal(decisions[11].interrupt, true);
  assert.equal(gate.sample(0.1, 0.01, 32, "blocked").speech, false);
  assert.equal(gate.sample(0.95, 0.1, 32, "interrupt").tentative, false);
});

test("a brief false start releases a provisional interruption without committing it", () => {
  const gate = new VoiceDecisionGate();
  for (let n = 0; n < 4; n++)
    assert.equal(gate.sample(0.98, 0.1, 32, "interrupt").interrupt, false);
  for (let n = 0; n < 5; n++)
    assert.equal(gate.sample(0.01, 0.01, 32, "interrupt").interrupt, false);
  assert.equal(gate.sample(0.01, 0.01, 32, "interrupt").tentative, false);
  assert.equal(gate.sample(0.98, 0.1, 32, "interrupt").tentative, false);
});

test("quiet confirmed words survive segmentation with their pre-speech audio", () => {
  const capture = new ConversationAudio(16000, 20, 224),
    gate = new VoiceDecisionGate();
  let samples: Float32Array[] | null = null;
  for (let n = 0; n < 9; n++) {
    const frame = new Float32Array(512).fill(0.003);
    const decision = gate.sample(0.97, 0.003, 32, "listen");
    capture.push(frame, decision.speech);
  }
  for (let n = 0; n < 32; n++)
    samples = capture.push(new Float32Array(512), false) ?? samples;
  assert.ok(samples);
  assert.equal(samples[0][0], new Float32Array([0.003])[0]);
});

test("a provisional pause resumes from its audio position and never suspends the microphone context", async () => {
  const starts: number[][] = [],
    sources: any[] = [];
  const context: any = {
    currentTime: 0,
    destination: {},
    createBufferSource() {
      const node: any = {
        onended: null,
        connect() {},
        disconnect() {},
        start(...args: number[]) {
          starts.push(args);
        },
        stop() {
          node.onended?.();
        },
      };
      sources.push(node);
      return node;
    },
  };
  const playback = new VoicePlayback(context, { duration: 10 } as AudioBuffer);
  playback.resume();
  context.currentTime = 2;
  playback.pause();
  assert.equal(playback.paused, true);
  context.currentTime = 3;
  playback.resume();
  assert.deepEqual(starts, [
    [0, 0, 10],
    [0, 2, 8],
  ]);
  sources[1].onended();
  await playback.done;
  playback.resume();
  assert.equal(starts.length, 2);
});

test("hangup resolves a never-started or paused reply and prevents any later playback", async () => {
  const context: any = {
    createBufferSource() {
      throw Error("must not restart");
    },
  };
  const playback = new VoicePlayback(context, { duration: 5 } as AudioBuffer);
  playback.stop();
  await playback.done;
  playback.resume();
  assert.equal(playback.paused, false);
});
