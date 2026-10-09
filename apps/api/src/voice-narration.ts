// Narration in the coach's style (docs/features/voice-session.md, "Narration
// in the coach's style"). The coach answers "Your one-on-one sessions", the
// Brain drafts a style summary and a sample session, the coach confirms the
// style once. Every new voice session then gets a few extra Brain lines at
// prepare time (one model call, stored with the session's script), personal
// to the member; each line passes the code checks or is dropped.
//
// The style lives in the versioned voice-session style row
// (voice_session_styles.style.oneOnOne), saved only through these routes;
// members only ever get the confirmed snapshot, through the script.
import { randomUUID } from "node:crypto";
import { candidateCommunication, communicationDigest } from "./trainer-brain.ts";
import type { TrainerBrainContext } from "../../../packages/domain/src/trainer-brain.ts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { event, type Actor, type Database, type Tx } from "@trainer/db";
import { generateTrainerVoice, voiceContract } from "../../../packages/providers/src/integrations.ts";
import {
  draftOneOnOneStyle,
  generateNarration,
  narrationAvailable,
} from "../../../packages/providers/src/voice-narration.ts";
import {
  answeredTopics,
  emptyOneOnOne,
  lastTimeFacts,
  narrationFirstName,
  narrationFromScript,
  oneOnOneAnswersSchema,
  oneOnOneFingerprint,
  oneOnOneIssues,
  previewLines,
  ONE_ON_ONE_PROMPT_VERSION,
  ONE_ON_ONE_TOPICS,
  SAMPLE_FACTS,
  SAMPLE_PLAN,
  type NarrationFacts,
  type NarrationInput,
  type NarrationLines,
  type OneOnOne,
} from "../../../packages/domain/src/voice-narration.ts";
import {
  buildSessionScript,
  defaultVoiceStyle,
  voiceStyleSchema,
  type PlanExercise,
  type VoiceStyle,
} from "../../../packages/domain/src/voice-session.ts";
import { speechLanguage } from "../../../packages/domain/src/speech-language.ts";
import { modelAccounting } from "./model-accounting.ts";
import { privacyMatches } from "./ingestion.ts";
import { costEstimated, costNotSent, reserveVoiceCost } from "./cost-accounting.ts";

const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
function coach(req: FastifyRequest): Actor {
  const a = req.identity;
  if (!a) throw fail(401, "AUTH_REQUIRED", "Please sign in.");
  if (!["owner", "staff"].includes(a.role))
    throw fail(403, "TRAINER_REQUIRED", "Trainer access is required.");
  return a;
}
/** At least this many of the seven questions answered before a draft. */
export const ONE_ON_ONE_MINIMUM = 3;
/** The style row stays well inside its 40,000-byte check. */
const STYLE_MAX_BYTES = 38000;

/** The style row; `lockFor` (the tenant id) takes the same lock as the style form's save. */
async function readStyle(tx: Tx, lockFor?: string): Promise<{ version: number; style: VoiceStyle }> {
  if (lockFor) await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [lockFor + ":voice-style"]);
  const [row] = await tx.query("SELECT version,style FROM voice_session_styles");
  if (!row) return { version: 0, style: defaultVoiceStyle() };
  const parsed = voiceStyleSchema.safeParse(row.style);
  return { version: Number(row.version), style: parsed.success ? parsed.data : defaultVoiceStyle() };
}
async function saveOneOnOne(tx: Tx, a: Actor, style: VoiceStyle, oneOnOne: OneOnOne) {
  const next = { ...style, oneOnOne };
  const text = JSON.stringify(next);
  if (Buffer.byteLength(text) > STYLE_MAX_BYTES)
    throw fail(400, "VOICE_STYLE_TOO_LONG", "Your answers are too long to keep. Shorten a few and save again.");
  const [row] = await tx.query(
    "INSERT INTO voice_session_styles(tenant_id,version,style,suggestions,updated_by) VALUES($1,1,$2,'{}',$3) ON CONFLICT(tenant_id) DO UPDATE SET version=voice_session_styles.version+1,style=EXCLUDED.style,updated_by=EXCLUDED.updated_by,updated_at=now() RETURNING version,style",
    [a.tenantId, text, a.userId],
  );
  return { version: Number(row.version), style: voiceStyleSchema.parse(row.style) };
}
const GUIDED_VOICE =
  "SELECT id,version,provider_voice_id,consented,provider,model FROM guided_voice()";
const voicePricing = () => {
  try {
    return voiceContract();
  } catch {
    return null;
  }
};
async function sampleVoice(tx: Tx) {
  const pricing = voicePricing();
  const [voice] = await tx.query(GUIDED_VOICE);
  const ready = !!pricing && !!voice?.consented && !!voice.provider_voice_id && voice.provider === pricing.provider;
  return ready ? { voice, pricing: pricing! } : null;
}
function sampleScript(style: VoiceStyle, o: OneOnOne, lines: NarrationLines) {
  return buildSessionScript({
    title: "Sample session",
    exercises: SAMPLE_PLAN,
    style,
    narration: { lines, facts: SAMPLE_FACTS, never: o.answers.never },
  });
}
async function view(tx: Tx, current: { version: number; style: VoiceStyle }) {
  const [release] = await tx.query("SELECT * FROM member_material('brain_release')");
  const pending = !!release && communicationDigest(release.data.communication) !== communicationDigest(await candidateCommunication(tx));
  const o = current.style.oneOnOne ?? emptyOneOnOne();
  const fingerprint = oneOnOneFingerprint(o.answers);
  const draft = o.draft ? sampleScript(current.style, o, o.draft.sample) : null;
  return {
    version: current.version,
    topics: ONE_ON_ONE_TOPICS,
    answers: o.answers,
    answered: answeredTopics(o.answers),
    minimumAnswered: ONE_ON_ONE_MINIMUM,
    draft: o.draft
      ? {
          summary: o.draft.summary,
          draftedAt: o.draft.draftedAt,
          // A draft made from earlier answers can still be read, not confirmed.
          current: o.draft.answers === fingerprint,
          preview: previewLines(draft!.script),
        }
      : null,
    confirmed: o.confirmed
      ? {
          summary: o.confirmed.summary,
          confirmedAt: o.confirmed.confirmedAt,
          current: oneOnOneFingerprint(o.confirmed.answers) === fingerprint,
        }
      : null,
    /** Whether new voice sessions get Brain lines in this style. */
    active: !!o.confirmed,
    publication: { releaseId: release?.id ?? null, pending },
    modelAvailable: narrationAvailable(),
    voiceSample: !!(await sampleVoice(tx)),
  };
}

// ---------------------------------------------------------------------------
// Prepare time: whether a new session gets Brain lines, and the model call.
// ---------------------------------------------------------------------------
export type NarrationRequest = { input: NarrationInput; never: string[] };
export type PreparedNarration = { lines: NarrationLines; facts: NarrationFacts; never: string[]; trainerBrain?: TrainerBrainContext };
/**
 * Inside the member's prepare transaction: the request for this new
 * session's Brain lines, or null when there is no confirmed style, no model,
 * or the member's coaching consent does not allow model use (the intake's
 * allowedUses, as for chat). Reads only the member's own name and set logs.
 */
export async function narrationRequest(
  tx: Tx,
  a: Actor,
  o: { plan: PlanExercise[]; style: VoiceStyle; title: string; language: "en" | "ar"; workoutId: string | null; trainerBrain?: TrainerBrainContext },
): Promise<NarrationRequest | null> {
  const confirmed = o.style.oneOnOne?.confirmed;
  if (!confirmed || !narrationAvailable() || !o.plan.length) return null;
  const [intake] = await tx.query(
    "SELECT data FROM records WHERE kind='intake' AND owner_user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1",
    [a.userId],
  );
  if (!Array.isArray(intake?.data?.allowedUses) || !intake.data.allowedUses.includes("model_prompt")) return null;
  const [user] = await tx.query("SELECT name FROM users WHERE id=$1", [a.userId]);
  const logs = await tx.query(
    "SELECT workout_id,data,created_at FROM workout_events WHERE user_id=$1 AND created_at>=now()-interval '14 days' AND workout_id IS DISTINCT FROM $2::uuid ORDER BY created_at DESC LIMIT 300",
    [a.userId, o.workoutId],
  );
  const [week] = await tx.query(
    "SELECT count(DISTINCT workout_id)::int AS n FROM workout_events WHERE user_id=$1 AND created_at>=now()-interval '7 days' AND workout_id IS DISTINCT FROM $2::uuid",
    [a.userId, o.workoutId],
  );
  const facts: NarrationFacts = {
    ...(narrationFirstName(user?.name) ? { firstName: narrationFirstName(user?.name) } : {}),
    sessionsLast7Days: Math.min(50, Number(week?.n ?? 0)),
    lastTime: lastTimeFacts(
      o.plan,
      logs.map((l: any) => ({ workoutId: String(l.workout_id), createdAt: l.created_at, data: l.data })),
    ),
  };
  return {
    input: {
      trainerBrain: o.trainerBrain,
      style: { summary: confirmed.summary, answers: confirmed.answers },
      facts,
      plan: o.plan,
      title: o.title,
      language: o.language,
    },
    never: confirmed.answers.never,
  };
}
/**
 * Outside any transaction: one model call for the session's lines. Any
 * failure (no model, daily limit, timeout, unreadable answer) returns null and
 * the session is prepared on the code and trainer lines alone.
 */
export async function narrate(db: Database, a: Actor, request: NarrationRequest): Promise<PreparedNarration | null> {
  try {
    const lines = await generateNarration(request.input, modelAccounting(db, a, "voice_session_narration"));
    return { lines, facts: request.input.facts, never: request.never, trainerBrain: request.input.trainerBrain };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The coach's routes.
// ---------------------------------------------------------------------------
export function registerVoiceNarration(app: FastifyInstance, db: Database) {
  const revision = z.number().int().min(0);
  app.get("/api/v1/voice-sessions/one-on-one", async (req) => {
    const a = coach(req);
    return db.tenant(a, async (tx) => view(tx, await readStyle(tx)));
  });
  app.put("/api/v1/voice-sessions/one-on-one", async (req) => {
    const a = coach(req),
      b = z.object({ revision, answers: oneOnOneAnswersSchema }).strict().parse(req.body);
    const issues = oneOnOneIssues(b.answers);
    if (b.answers.examples.some(example => privacyMatches(Object.values(example).join("\n")).length))
      throw fail(400, "PERSONAL_DATA_REMAINS", "Remove client names, contact details and account details from your examples.");
    if (issues.length)
      throw fail(
        400,
        "ONE_ON_ONE_WORDING",
        "Remove links, contact details, unsupported characters, app or AI names, and replies using your never-say phrases from: " +
          [...new Set(issues.map((i) => i.field.split(".")[0]))].join(", "),
      );
    return db.tenant(a, async (tx) => {
      const current = await readStyle(tx, a.tenantId);
      if (current.version !== b.revision)
        throw fail(409, "VOICE_STYLE_CHANGED", "Your voice settings changed. Reload before saving.");
      const prior = current.style.oneOnOne ?? emptyOneOnOne();
      const saved = await saveOneOnOne(tx, a, current.style, { ...prior, answers: b.answers });
      await event(tx, a, "voice_session.one_on_one_saved", undefined, {
        version: saved.version,
        answered: answeredTopics(b.answers),
      });
      return view(tx, saved);
    });
  });
  // The Brain drafts the summary and the sample session; nothing reaches a
  // member until the coach confirms.
  app.post("/api/v1/voice-sessions/one-on-one/draft", async (req) => {
    const a = coach(req),
      b = z.object({ revision }).strict().parse(req.body ?? {});
    const answers = await db.tenant(a, async (tx) => {
      const current = await readStyle(tx);
      if (current.version !== b.revision)
        throw fail(409, "VOICE_STYLE_CHANGED", "Your voice settings changed. Reload first.");
      const o = current.style.oneOnOne ?? emptyOneOnOne();
      if (answeredTopics(o.answers) < ONE_ON_ONE_MINIMUM)
        throw fail(400, "ONE_ON_ONE_TOO_SHORT", `Answer at least ${ONE_ON_ONE_MINIMUM} of the questions first.`);
      return o.answers;
    });
    if (!narrationAvailable())
      throw fail(503, "MODEL_UNAVAILABLE", "The Brain is not switched on yet, so it cannot draft your style.");
    let draft: Awaited<ReturnType<typeof draftOneOnOneStyle>>;
    try {
      draft = await draftOneOnOneStyle(answers, modelAccounting(db, a, "voice_session_style"));
    } catch (e: any) {
      if (e?.statusCode && e.statusCode < 500) throw e;
      throw fail(502, "MODEL_UNCONFIRMED", "The Brain could not draft your style now. Try again in a minute.");
    }
    return db.tenant(a, async (tx) => {
      const current = await readStyle(tx, a.tenantId);
      const o = current.style.oneOnOne ?? emptyOneOnOne();
      if (current.version !== b.revision || oneOnOneFingerprint(o.answers) !== oneOnOneFingerprint(answers))
        throw fail(409, "VOICE_STYLE_CHANGED", "Your answers changed while the Brain was drafting. Draft again.");
      // Only lines that pass every check are kept.
      const built = sampleScript(current.style, o, draft.sample);
      const saved = await saveOneOnOne(tx, a, current.style, {
        ...o,
        draft: {
          summary: draft.summary,
          sample: narrationFromScript(built.script),
          answers: oneOnOneFingerprint(o.answers),
          promptVersion: ONE_ON_ONE_PROMPT_VERSION,
          draftedAt: new Date().toISOString(),
        },
      });
      await event(tx, a, "voice_session.one_on_one_drafted", undefined, {
        version: saved.version,
        lines: built.brain?.added ?? 0,
        dropped: (built.brain?.dropped ?? []).map((d) => ({ slot: d.slot, issues: d.issues })),
      });
      return { ...(await view(tx, saved)), droppedLines: built.brain?.dropped.length ?? 0 };
    });
  });
  // Confirm the style once (not each phrase), or stop using it.
  app.post("/api/v1/voice-sessions/one-on-one/confirm", async (req) => {
    const a = coach(req),
      b = z.object({ revision, confirmed: z.boolean() }).strict().parse(req.body);
    return db.tenant(a, async (tx) => {
      const current = await readStyle(tx, a.tenantId);
      if (current.version !== b.revision)
        throw fail(409, "VOICE_STYLE_CHANGED", "Your voice settings changed. Reload first.");
      const o = current.style.oneOnOne ?? emptyOneOnOne();
      if (b.confirmed && (!o.draft || o.draft.answers !== oneOnOneFingerprint(o.answers)))
        throw fail(409, "ONE_ON_ONE_DRAFT_STALE", "Draft your style from your current answers before confirming.");
      const saved = await saveOneOnOne(tx, a, current.style, {
        ...o,
        confirmed: b.confirmed
          ? {
              answers: o.answers,
              summary: o.draft!.summary,
              promptVersion: o.draft!.promptVersion,
              confirmedAt: new Date().toISOString(),
              confirmedBy: a.userId,
            }
          : null,
      });
      await event(
        tx,
        a,
        b.confirmed ? "voice_session.one_on_one_confirmed" : "voice_session.one_on_one_off",
        undefined,
        { version: saved.version },
      );
      return view(tx, saved);
    });
  });
  // The sample session's Brain lines in the coach's cloned voice (a voice
  // preview: counted in the workspace's daily voice limit).
  app.post(
    "/api/v1/voice-sessions/one-on-one/sample-audio",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (req) => {
      const a = coach(req);
      const reservation = await db.tenant(a, async (tx) => {
        const current = await readStyle(tx);
        const o = current.style.oneOnOne ?? emptyOneOnOne();
        if (!o.draft) throw fail(409, "ONE_ON_ONE_NO_DRAFT", "Draft your style first.");
        const lines = previewLines(sampleScript(current.style, o, o.draft.sample).script).filter((l) => l.owner === "brain");
        if (!lines.length) throw fail(409, "ONE_ON_ONE_NO_DRAFT", "The draft has no lines to play. Draft again.");
        const text = lines.map((l) => l.text).join(" ").slice(0, 900);
        const ready = await sampleVoice(tx);
        if (!ready)
          throw fail(409, "VOICE_NOT_READY", "Your cloned voice is not ready yet, so the sample is shown as text.");
        await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [a.tenantId + ":voice-budget"]);
        const [spent] = await tx.query("SELECT voice_guidance_spent_today() AS total");
        const estimate = (text.length * ready.pricing.price) / 1000;
        if (Number(spent.total) + estimate > ready.pricing.cap)
          throw fail(429, "VOICE_BUDGET", "Today's voice limit for this workspace is reached. Try again tomorrow.");
        const usageId = randomUUID();
        // The coach's own set-up work: no member is served.
        await reserveVoiceCost(tx, {
          id: usageId,
          tenantId: a.tenantId,
          userId: a.userId,
          memberId: null,
          task: "voice.preview",
          provider: ready.pricing.provider,
          model: ready.voice.model ?? ready.pricing.model,
          priceVersion: ready.pricing.priceVersion,
          pricing: {
            basis: "characters",
            characters: text.length,
            usdPer1000Characters: ready.pricing.price,
            reservedCostUsd: estimate,
          },
          traceId: "one-on-one-sample",
        });
        return { usageId, text, voice: ready.voice };
      });
      try {
        const audio = await generateTrainerVoice(
          reservation.voice.provider_voice_id,
          reservation.text,
          () =>
            db.tenant(a, async (tx) => {
              await tx.query("UPDATE cost_events SET status='unknown' WHERE id=$1 AND status='reserved'", [reservation.usageId]);
            }),
          { provider: reservation.voice.provider, model: reservation.voice.model, textLanguage: speechLanguage(reservation.text) },
        );
        await db.tenant(a, async (tx) => {
          await costEstimated(tx, reservation.usageId, { providerRequestId: audio.requestId });
          await event(tx, a, "voice_session.one_on_one_sample_voiced", undefined, {
            characters: reservation.text.length,
            providerRequestId: audio.requestId,
          });
        });
        return { type: "audio/mpeg", audio: Buffer.from(audio.audio).toString("base64"), text: reservation.text };
      } catch {
        await db.tenant(a, (tx) => costNotSent(tx, reservation.usageId));
        throw fail(502, "VOICE_PREVIEW", "The sample could not be voiced. Try again in a minute.");
      }
    },
  );
}
