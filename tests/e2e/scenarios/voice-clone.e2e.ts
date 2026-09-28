/**
 * Trainer voice clones with Cartesia (docs/features/trainer-voice.md), end to
 * end against the Cartesia double: the Super admin switches the voice and
 * speech-to-text settings to Cartesia; the trainer consents, records, makes a
 * Quick clone, previews and activates it; a member's voice-led session is
 * spoken in that clone by the worker; the trainer deletes it and the double
 * no longer holds it. Afterwards the ElevenLabs settings and the trainer's
 * linked ElevenLabs voice are restored for the suites that follow.
 *
 * Runs in the core suite after the voice-led session (core-features.e2e.ts),
 * whose member has premium voice. Written 28 September 2026; not yet run.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { Client } from "../harness/client.ts";
import type { E2EContext, TrainerSeed } from "../harness/context.ts";

const T = "Trainers" as const;
const F = "followers" as const;
const A = "Super admin" as const;

/** A 12-second PCM WAV (8 kHz mono): the API reads its length from the header. */
function wav(seconds: number) {
  const data = randomBytes(seconds * 8000);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0, "ascii");
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVE", 8, "ascii");
  h.write("fmt ", 12, "ascii");
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(8000, 24);
  h.writeUInt32LE(8000, 28);
  h.writeUInt16LE(1, 32);
  h.writeUInt16LE(8, 34);
  h.write("data", 36, "ascii");
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]).toString("base64");
}

async function saveSettings(ctx: E2EContext, settings: Record<string, { values: Record<string, string>; secrets: Record<string, string> }>) {
  await ctx.admin.stepUp();
  const statuses: string[] = [];
  for (const [id, config] of Object.entries(settings)) {
    const current = await ctx.admin.get("/api/v1/admin/settings");
    const entry = current.integrations.find((i: any) => i.id === id);
    const saved = await ctx.admin.put(`/api/v1/admin/settings/${id}`, {
      revision: entry.revision,
      enabled: true,
      values: config.values,
      secrets: config.secrets,
    });
    const tested = await ctx.admin.post(`/api/v1/admin/settings/${id}/test`, { revision: saved.revision });
    assert.ok(["verified", "validated"].includes(tested.lastTest?.status), `${id}: ${tested.lastTest?.message}`);
    assert.equal(tested.active, true, `${id} active`);
    statuses.push(`${id} ${tested.lastTest.status}`);
  }
  return statuses.join(", ");
}

export async function trainerVoiceCloneScenarios(
  ctx: E2EContext,
  layla: TrainerSeed,
  member: { client: Client; programId: string },
) {
  const r = ctx.reporter;
  const t = layla.client;
  const c = member.client;
  const cartesia = ctx.mocks.cartesia;
  const switched = await r.step(A, "Trainer voice with Cartesia", "voice and speech-to-text settings switched to the Cartesia double; the checks read one voice and make no audio", async () => {
    const before = cartesia.server.log.length;
    const detail = await saveSettings(ctx, ctx.mocks.cartesiaSettings);
    const checks = cartesia.server.log.slice(before).map((x) => `${x.method} ${x.path}${x.query}`);
    assert.deepEqual(checks, ["GET /voices?limit=1", "GET /voices?limit=1"]);
    assert.equal(cartesia.syntheses.length, 0);
    return detail;
  });
  if (!switched) return;
  let clone: any;
  try {
    const recorded = await r.step(T, "Trainer voice clone", `${layla.slug}: explicit consent, a 12-second recording and a Quick clone made at the Cartesia double`, async () => {
      const view = await t.get("/api/v1/voice/clones");
      assert.equal(view.provider, "cartesia");
      assert.equal(view.available.quick, true);
      await t.fails(400, "POST", "/api/v1/voice/clones", { kind: "instant", language: "en" });
      const draft = await t.post("/api/v1/voice/clones", {
        kind: "instant",
        language: "en",
        consent: { ownVoice: true, cloning: true, subscriberUse: true, deletion: true },
      });
      const withSample = await t.post(`/api/v1/voice/clones/${draft.id}/samples`, { audio: wav(12), type: "audio/wav", durationSeconds: 12 });
      assert.equal(withSample.readiness.ready, true);
      const sent = await t.post(`/api/v1/voice/clones/${draft.id}/submit`, { revision: withSample.version });
      clone = sent.status === "ready" ? sent : await ctx.waitUntil("the Quick clone", async () => {
        const v = await t.get("/api/v1/voice/clones");
        return v.clones.find((x: any) => x.id === draft.id && x.status === "ready");
      }, 120000);
      const made = cartesia.clones.find((x) => x.name === "trainsyou-" + draft.id);
      assert.ok(made, "the double received the clone under its provider name");
      assert.equal(made.type, "audio/wav");
      assert.deepEqual(clone.recordings.map((x: any) => x.status), ["sent"], "the recording is not kept once the provider has it");
      return `clone ${clone.id} ready; ${made.bytes} bytes sent once`;
    });
    if (!recorded) return;
    const active = await r.step(T, "Preview and use the cloned voice", `${layla.slug}: the preview line in the clone, then the clone becomes the workspace voice`, async () => {
      await t.fails(409, "POST", `/api/v1/voice/clones/${clone.id}/activate`, { revision: clone.version }, "VOICE_PREVIEW_REQUIRED");
      const previewed = await t.post(`/api/v1/voice/clones/${clone.id}/preview`, {});
      const audio = await t.request("GET", previewed.previewUrl, undefined, { raw: true });
      assert.equal(audio.status, 200);
      assert.match(audio.headers.get("content-type") ?? "", /audio\/mpeg/);
      const voiceId = cartesia.clones.find((x) => x.name === "trainsyou-" + clone.id)!.id;
      assert.ok(cartesia.syntheses.some((s) => s.voiceId === voiceId && s.text === previewed.previewLine));
      const activated = await t.post(`/api/v1/voice/clones/${clone.id}/activate`, { revision: previewed.version });
      assert.equal(activated.status, "active");
      clone = activated;
      return activated.message;
    });
    if (!active) return;
    await r.step(F, "Voice-led session in the trainer's cloned voice", `${c.label}: after the trainer releases the training hold, a prepared session is spoken by the worker in the clone`, async () => {
      const holds = await t.get("/api/v1/training/holds");
      for (const hold of holds.filter((h: any) => h.owner_user_id === c.userId && h.status === "active"))
        await t.post(`/api/v1/training/holds/${hold.id}/resolve`, {
          version: hold.version,
          action: "resume",
          note: "Reviewed the pain report with the member; resuming lighter work (sandbox).",
          reviewed: true,
        });
      const mine = await c.get("/api/v1/brain/plans/mine");
      const planned = mine.upcoming.find((s: any) => s.status === "planned");
      assert.ok(planned, "a planned session to prepare");
      const session = await c.post("/api/v1/voice-sessions", { plannedSessionId: planned.id, playbackConsent: true });
      assert.equal(session.mode, "voice", JSON.stringify(session.unavailableReason));
      const voiceId = cartesia.clones.find((x) => x.name === "trainsyou-" + clone.id)!.id;
      const before = cartesia.syntheses.length;
      const ready = await ctx.waitUntil("the session audio in the clone", async () => {
        const v = await c.get(`/api/v1/voice-sessions/${session.id}`);
        return v.audioStatus === "ready" && v;
      }, 240000);
      const spoken = cartesia.syntheses.slice(before);
      assert.ok(spoken.length >= 1 && spoken.every((s) => s.voiceId === voiceId && s.model === "sonic-3.6"), JSON.stringify(spoken.slice(0, 3)));
      const page = await c.get(`/api/v1/voice-sessions/${session.id}/audio?keys=${encodeURIComponent(ready.audio.readyKeys.slice(0, 2).join(","))}`);
      assert.equal(page.type, "audio/mpeg");
      return `${spoken.length} clips spoken in the clone`;
    });
    await r.step(T, "Delete the voice clone", `${layla.slug}: deleted here and at the Cartesia double; members fall back to written guidance`, async () => {
      const voiceId = cartesia.clones.find((x) => x.name === "trainsyou-" + clone.id)!.id;
      const deleted = await t.request("DELETE", `/api/v1/voice/clones/${clone.id}`);
      assert.equal(deleted.status, 200, deleted.text);
      await ctx.waitUntil("the provider deletion", async () => !cartesia.voices.has(voiceId), 120000);
      const view = await t.get("/api/v1/voice/clones");
      assert.deepEqual(view.clones, []);
      assert.notEqual(view.workspaceVoice?.status, "verified");
      return `voice ${voiceId.slice(0, 8)}… deleted at the double`;
    });
  } finally {
    // Later suites expect the ElevenLabs double and Layla's linked voice.
    await r.prepare(A, "Trainer voice with Cartesia", "restore the ElevenLabs settings and the linked voice", async () => {
      await saveSettings(ctx, { voice: ctx.mocks.settings.voice, speech_to_text: ctx.mocks.settings.speech_to_text });
      const profile = await t.get("/api/v1/voice/profile");
      const voiceId = "mockVoice" + layla.slug.replace(/[^a-z]/g, "").slice(0, 8);
      ctx.mocks.voice.voices.add(voiceId);
      const linked = await t.post("/api/v1/voice/profile", {
        revision: Number(profile?.version ?? 0),
        consent: true,
        rights: true,
        providerVoiceId: voiceId,
        statement: "I own this voice and consent to assigned workout guidance only (sandbox).",
        voiceKind: "instant",
      });
      await ctx.admin.stepUp();
      await ctx.admin.post(`/api/v1/admin/integrations/voices/${linked.id}/verify`, {
        revision: Number(linked.version),
        ownerIdentityVerified: true,
        providerRightsVerified: true,
        evidence: "Sandbox identity and provider-sharing evidence reviewed again.",
      });
    });
  }
}
