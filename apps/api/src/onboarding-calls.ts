import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { putRecord, event, type Actor, type Database, type Tx } from "@trainer/db";
import { runtimeConfig } from "../../../packages/providers/src/configuration.ts";
import { voiceContract, speechToTextContract, generateTrainerVoice, transcribeSpeech } from "../../../packages/providers/src/integrations.ts";
import { speechLanguage } from "../../../packages/domain/src/speech-language.ts";
import { CLONE_CONSENT, CLONE_CONSENT_VERSION } from "../../../packages/domain/src/voice-clone.ts";
import { assistantVoiceId } from "./marketing-assistant.ts";
import { billableSpeechMs, decodeSpeech } from "./voice-session.ts";
import { reserveVoiceCost, costEstimated, costNotSent } from "./cost-accounting.ts";
import { forwardWorkspaceRequest as forward } from "./internal-request.ts";
import { onboardingActor as actor, onboardingError as fail, permitOnboarding, lockOnboarding, onboardingConsentEpoch } from "./onboarding-access.ts";
import { encryptionReady } from "./sealing.ts";

const prefix = "/api/v1/onboarding-chat/calls";
const uuid = z.string().uuid();
const cloneConsent = z.object({ ownVoice: z.literal(true), cloning: z.literal(true), subscriberUse: z.literal(true), deletion: z.literal(true) }).strict();
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function contracts() {
  const voice = voiceContract(), speech = speechToTextContract(), c = runtimeConfig();
  if (voice.provider !== "cartesia" || !c.MODEL_BASE_URL || !c.MODEL_API_KEY || !c.MODEL_NAME)
    throw fail(503, "CALL_UNAVAILABLE", "Voice calls aren't ready just now. Your text conversation is still available.");
  return { voice, speech, signature: hash([voice.provider, voice.base, voice.key, voice.model, speech.provider, speech.base, speech.key, speech.model, c.MARKETING_ASSISTANT_VOICE_ID]) };
}
async function ownCall(tx: Tx, a: Actor, id: string, active = true) {
  await permitOnboarding(tx, a);
  const [row] = await tx.query("SELECT * FROM records WHERE id=$1 AND kind='onboarding_call' AND owner_user_id=$2 FOR UPDATE", [id, a.userId]);
  if (!row || (active && (row.status !== "active" || Date.parse(row.data.expiresAt) <= Date.now())))
    throw fail(409, "CALL_ENDED", "This call has ended. Your messages are saved; start another call whenever you're ready.");
  if (active && row.data.signature !== contracts().signature)
    throw fail(409, "CALL_SETTINGS_CHANGED", "The voice connection changed. Start a new call to continue.");
  return row;
}
const callView = (row: any) => ({ id: row.id, name: "Kamran", isAI: true, status: row.status, language: row.data.language, cloneId: row.data.cloneId ?? null, expiresAt: row.data.expiresAt });

export function onboardingCallRoutes(app: FastifyInstance, db: Database) {
  const snapshot = (req: FastifyRequest, mode: string) => forward(app, req, "GET", "/api/v1/onboarding-chat?mode=" + mode);
  async function reserve(a: Actor, callId: string, usageId: string, kind: "speech" | "transcription", estimate: number, pricing: Record<string, unknown>) {
    const c = contracts(), p = kind === "speech" ? c.voice : c.speech;
    await db.tenant(a, async tx => {
      await ownCall(tx, a, callId);
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [a.tenantId + ":voice-budget"]);
      const [spent] = await tx.query("SELECT voice_guidance_spent_today() AS total");
      if (Number(spent.total) + estimate > c.voice.cap) throw fail(429, "VOICE_BUDGET", "Today's voice allowance is used up. You can keep chatting by text.");
      await reserveVoiceCost(tx, { id: usageId, tenantId: a.tenantId, userId: a.userId, memberId: a.role === "subscriber" ? a.userId : null,
        task: "voice." + (a.role === "owner" ? "onboarding_setup." : "onboarding.") + kind,
        provider: p.provider, model: p.model, priceVersion: p.priceVersion, pricing: { ...pricing, reservedCostUsd: estimate }, traceId: callId });
    });
  }
  const beforeSend = (a: Actor, callId: string, usageId: string) => async () => db.tenant(a, async tx => {
    await ownCall(tx, a, callId);
    await tx.query("UPDATE cost_events SET status='unknown' WHERE id=$1 AND status='reserved'", [usageId]);
  });
  async function speak(a: Actor, call: any, text: string) {
    const c = contracts(), id = randomUUID();
    text = text.trim().slice(0, 900);
    if (!text) return null;
    await reserve(a, call.id, id, "speech", text.length / 1000 * c.voice.price, { basis: "characters", characters: text.length, usdPer1000Characters: c.voice.price });
    try {
      const result = await generateTrainerVoice(call.data.voiceId, text, beforeSend(a, call.id, id), { provider: "cartesia", model: call.data.model, textLanguage: speechLanguage(text) });
      await db.tenant(a, tx => costEstimated(tx, id, { providerRequestId: result.requestId }));
      return result.audio.toString("base64");
    } catch (e) { await db.tenant(a, tx => costNotSent(tx, id)); throw e; }
  }
  async function viewReceipt(req: FastifyRequest, a: Actor, callId: string, requestId: string) {
    const { call, row } = await db.tenant(a, async tx => {
      const call = await ownCall(tx, a, callId);
      const [row] = await tx.query("SELECT * FROM records WHERE id=$1 AND kind='onboarding_voice_request' AND owner_user_id=$2 AND data->>'callId'=$3", [requestId, a.userId, callId]);
      if (!row) throw fail(404, "CALL_TURN_MISSING", "This part of the call isn't available.");
      return { call, row };
    });
    const pending = row.status === "processing" && Date.now() - new Date(row.created_at).getTime() < 360000;
    return { pending, transcript: row.data.transcript ?? "", audio: row.data.audio ?? null, error: row.data.error ?? (row.status === "processing" && !pending ? "That reply was interrupted. Continue in the saved chat before trying again." : null), conversation: pending ? undefined : await snapshot(req, call.data.mode) };
  }
  app.get(prefix + "/options", async (req, reply) => {
    const a = actor(req);
    reply.header("Cache-Control", "private, no-store");
    await db.tenant(a, tx => permitOnboarding(tx, a));
    try {
      const c = contracts(), voiceId = await assistantVoiceId();
      return { available: !!voiceId, name: "Kamran", isAI: true, reason: voiceId ? null : "Kamran's AI voice hasn't been connected yet. You can continue by message.",
        speechProvider: c.speech.provider === "cartesia" ? "Cartesia" : "ElevenLabs", zeroRetention: c.speech.provider === "elevenlabs" && c.speech.zeroRetention,
        cloning: a.role === "owner" && c.voice.cloning.quick && encryptionReady(), cloneConsent: CLONE_CONSENT, cloneConsentVersion: CLONE_CONSENT_VERSION,
        providerTrainingOptOut: c.voice.cloning.providerTrainingOptOut };
    } catch { return { available: false, name: "Kamran", isAI: true, reason: "Voice calls aren't enabled yet. Keep going by message, or ask the platform to connect voice and speech recognition.", cloning: false }; }
  });
  app.post(prefix, { config: { rateLimit: { max: 8, timeWindow: "10 minutes" } } }, async (req, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const a = actor(req), b = z.object({ id: uuid, language: z.enum(["en", "ar"]), mode: z.enum(["setup", "teach"]).default("setup"), consent: z.literal(true), cloneConsent: cloneConsent.optional() }).strict().parse(req.body);
    if (b.cloneConsent && a.role !== "owner") throw fail(403, "OWNER_REQUIRED", "Only a trainer can create their own voice.");
    const consentEpoch = await db.tenant(a, async tx => { await permitOnboarding(tx, a); return onboardingConsentEpoch(tx, a); });
    const c = contracts(), voiceId = await assistantVoiceId();
    if (!voiceId) throw fail(503, "KAMRAN_VOICE_UNAVAILABLE", "Kamran's AI voice isn't connected yet. Continue by message for now.");
    if (b.cloneConsent && (!c.voice.cloning.quick || !encryptionReady())) throw fail(503, "CLONING_UNAVAILABLE", "Voice creation isn't ready. You can start a call without creating a voice.");
    return db.tenant(a, async tx => {
      await permitOnboarding(tx, a);
      if (await onboardingConsentEpoch(tx, a) !== consentEpoch) throw fail(409, "CONSENT_CHANGED", "Your permissions changed. Start the call again when you're ready.");
      const [old] = await tx.query("SELECT * FROM records WHERE id=$1 AND kind='onboarding_call' AND owner_user_id=$2", [b.id, a.userId]);
      if (old) { if (old.status !== "active") throw fail(409, "CALL_ENDED", "This call has ended."); if (old.data.fingerprint !== hash(b)) throw fail(409, "CALL_CHANGED", "Start a new call with these choices."); return callView(old); }
      await tx.query("UPDATE records SET status='ended',data=data-'cloneConsent',updated_at=now() WHERE kind='onboarding_call' AND owner_user_id=$1 AND status='active'", [a.userId]);
      await tx.query("UPDATE records SET data=data-'audio',updated_at=now() WHERE kind='onboarding_voice_request' AND owner_user_id=$1 AND data ? 'audio'", [a.userId]);
      const row = await putRecord(tx, a, "onboarding_call", { fingerprint: hash(b), language: b.language, mode: a.role === "owner" ? b.mode : "setup", voiceId, model: c.voice.model, signature: c.signature, consentAt: new Date().toISOString(), cloneConsent: b.cloneConsent ?? null, cloneConsentVersion: CLONE_CONSENT_VERSION, turns: 0, expiresAt: new Date(Date.now() + 30 * 60000).toISOString() }, { id: b.id, status: "active" });
      await event(tx, a, "onboarding_chat.call_started", row.id, { cloneOptIn: !!b.cloneConsent });
      return callView(row);
    });
  });
  app.post(prefix + "/:id/end", { config: { rateLimit: { max: 45, timeWindow: "10 minutes" } } }, async (req) => {
    const a = actor(req), id = uuid.parse((req.params as any).id);
    await db.tenant(a, async tx => {
      await lockOnboarding(tx, a);
      const rows = await tx.query("UPDATE records SET status='ended',data=data-'cloneConsent',updated_at=now() WHERE id=$1 AND kind='onboarding_call' AND owner_user_id=$2 RETURNING id", [id, a.userId]);
      // A hangup can overtake a slow start request. Its ID must stay ended.
      if (!rows.length) await tx.query("INSERT INTO records(id,tenant_id,owner_user_id,kind,status,data) VALUES($1,$2,$3,'onboarding_call','ended',$4) ON CONFLICT(id) DO NOTHING", [id, a.tenantId, a.userId, JSON.stringify({ cancelledAt: new Date().toISOString() })]);
      await tx.query("UPDATE records SET data=data-'audio',updated_at=now() WHERE kind='onboarding_voice_request' AND owner_user_id=$1 AND data->>'callId'=$2", [a.userId, id]);
    });
    return { ended: true };
  });
  app.get(prefix + "/:id/turns/:turnId", async (req, reply) => {
    reply.header("Cache-Control", "private, no-store");
    return viewReceipt(req, actor(req), uuid.parse((req.params as any).id), uuid.parse((req.params as any).turnId));
  });
  app.post(prefix + "/:id/turns", { bodyLimit: 3 * 1024 * 1024, config: { rateLimit: { max: 45, timeWindow: "10 minutes" } } }, async (req, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const a = actor(req), id = uuid.parse((req.params as any).id);
    const b = z.object({ id: uuid, greeting: z.boolean().optional(), audio: z.string().min(16).max(2900000).optional(), durationMs: z.number().int().min(200).max(45000).optional() }).strict().refine(b => b.greeting === true ? !b.audio && !b.durationMs : !!b.audio && !!b.durationMs).parse(req.body);
    const fingerprint = hash(b);
    const claimed = await db.tenant(a, async tx => {
      const call = await ownCall(tx, a, id);
      const [prior] = await tx.query("SELECT * FROM records WHERE id=$1 AND kind='onboarding_voice_request' AND owner_user_id=$2", [b.id, a.userId]);
      if (prior) { if (prior.data.fingerprint !== fingerprint || prior.data.callId !== id) throw fail(409, "CALL_TURN_CHANGED", "This part of the call changed. Start a new reply."); return null; }
      const [busy] = await tx.query("SELECT id FROM records WHERE kind='onboarding_voice_request' AND owner_user_id=$1 AND data->>'callId'=$2 AND status='processing' AND created_at>now()-interval '6 minutes'", [a.userId, id]);
      if (busy) throw fail(409, "CALL_BUSY", "I'm still finishing your previous reply.");
      if (call.data.turns >= 80) throw fail(429, "CALL_LIMIT", "Let's pause this call here. Your conversation is saved.");
      await putRecord(tx, a, "onboarding_voice_request", { callId: id, fingerprint, messageId: randomUUID() }, { id: b.id, status: "processing" });
      await tx.query("UPDATE records SET data=jsonb_set(data,'{turns}',to_jsonb(($2)::int)),updated_at=now() WHERE id=$1", [id, Number(call.data.turns) + 1]);
      return call;
    });
    if (!claimed) return viewReceipt(req, a, id, b.id);
    let transcript = "", audio: string | null = null, error: string | null = null;
    try {
      let conversation = await snapshot(req, claimed.data.mode);
      if (!b.greeting) {
        const bytes = decodeSpeech(b.audio!, "audio/wav", 2 * 1024 * 1024), c = contracts(), usageId = randomUUID();
        try {
          const billableMs = billableSpeechMs(bytes, "audio/wav", b.durationMs!);
          if (billableMs > 60000) throw fail(400, "CALL_AUDIO_SIZE", "Keep one spoken answer under 45 seconds.");
          await reserve(a, id, usageId, "transcription", billableMs / 3600000 * c.speech.pricePerHour, { basis: "audio_seconds", seconds: billableMs / 1000, usdPerHour: c.speech.pricePerHour });
          const heard = await transcribeSpeech(bytes, "audio/wav", beforeSend(a, id, usageId), { language: claimed.data.language, maxCharacters: 4000 });
          await db.tenant(a, tx => costEstimated(tx, usageId, { providerRequestId: heard.requestId }));
          transcript = heard.text.trim();
        } catch (e) { await db.tenant(a, tx => costNotSent(tx, usageId)); throw e; }
        finally { bytes.fill(0); }
        if (!transcript) throw fail(422, "CALL_NOT_HEARD", "I couldn't hear any words. Try again when you're ready.");
        const request = await db.tenant(a, async tx => {
          await ownCall(tx, a, id);
          const [r] = await tx.query("UPDATE records SET data=data||$3::jsonb,updated_at=now() WHERE id=$1 AND owner_user_id=$2 AND status='processing' RETURNING data", [b.id, a.userId, JSON.stringify({ transcript })]);
          if (!r) throw fail(409, "CALL_ENDED", "The call ended.");
          return r.data;
        });
        conversation = await forward(app, req, "POST", "/api/v1/onboarding-chat/messages", { id: request.messageId, version: conversation.version, mode: claimed.data.mode, text: transcript, source: "voice", callId: id });
        if (conversation.error || conversation.pending) throw fail(502, "CALL_REPLY_FAILED", conversation.error ?? "Your reply is still being prepared. Check the saved conversation.");
      }
      const messages = conversation.messages ?? [], lastPerson = messages.findLastIndex((m: any) => m.from === "person");
      const words = messages.slice(Math.max(lastPerson + 1, messages.length - 3)).filter((m: any) => m.from === "assistant").map((m: any) => m.text).join(" ");
      audio = await speak(a, claimed, words);
    } catch (e) {
      error = (e as any).statusCode && (e as any).statusCode < 500 ? (e as Error).message : "That reply couldn't be completed. Your saved conversation is below; you can continue by text.";
    }
    await db.tenant(a, async tx => {
      await ownCall(tx, a, id);
      await tx.query("UPDATE records SET status=$3,data=data||$4::jsonb,updated_at=now() WHERE id=$1 AND kind='onboarding_voice_request' AND owner_user_id=$2 AND status='processing'", [b.id, a.userId, error ? "failed" : "complete", JSON.stringify({ transcript, audio, error })]);
    });
    return viewReceipt(req, a, id, b.id);
  });
  // The same clone workflow used by Trainer voice. The call only supplies the
  // trainer's microphone sample; preview/rights checks still gate activation.
  app.post(prefix + "/:id/clone", async (req) => {
    const a = actor(req), id = uuid.parse((req.params as any).id);
    if (a.role !== "owner") throw fail(403, "OWNER_REQUIRED", "Trainer access is required.");
    const call = await db.tenant(a, tx => ownCall(tx, a, id));
    if (!call.data.cloneConsent) throw fail(403, "CLONE_CONSENT_REQUIRED", "Choose whether to create your own voice before recording a sample.");
    const result = await forward(app, req, "POST", "/api/v1/voice/clones", { kind: "instant", language: call.data.language, consent: call.data.cloneConsent, onboardingCallId: id });
    await db.tenant(a, async tx => {
      await ownCall(tx, a, id);
      await tx.query("UPDATE records SET data=data||$2::jsonb,updated_at=now() WHERE id=$1", [id, JSON.stringify({ cloneId: result.id })]);
    });
    return result;
  });
}
