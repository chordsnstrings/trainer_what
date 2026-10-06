import { z } from "zod";
import { MUSIC_PLAYLISTS, musicBrief } from "../../domain/src/workout-music.ts";
import { runtimeConfig } from "./configuration.ts";
import { modelCompletion, type ModelAccounting } from "./model-accounting.ts";
import { modelReplyJson } from "./model-request.ts";
import { isSiteStarterModel } from "./site-builder-starter.ts";
export const MUSIC_PLAN_VERSION = "music-plan-v1";
export const MUSIC_PLAN_SIZE = 6;
export const MUSIC_PLAN_TOKENS = 2500;
export type MusicBrief = ReturnType<typeof musicBrief>;
const arrangement = z
  .string()
  .trim()
  .min(30)
  .max(420)
  .regex(/^[a-zA-Z0-9 ,.;:()'&+\/-]+$/)
  .refine((v) => !/https?:|www\./i.test(v));
const schema = z
  .object({
    tracks: z
      .array(
        z
          .object({
            slot: z.number().int().min(0).max(59),
            bpm: z.number().int().min(60).max(170),
            arrangement,
          })
          .strict(),
      )
      .min(1)
      .max(MUSIC_PLAN_SIZE),
  })
  .strict();
export function validateMusicPlan(
  raw: unknown,
  playlist: string,
  slots: number[],
) {
  const p = MUSIC_PLAYLISTS.find((p) => p.id === playlist);
  if (!p || !slots.length || slots.length > MUSIC_PLAN_SIZE)
    throw Error("Invalid music plan");
  const { tracks } = schema.parse(raw);
  if (
    tracks.length !== slots.length ||
    new Set(tracks.map((t) => t.slot)).size !== slots.length ||
    tracks.some(
      (t) => !slots.includes(t.slot) || Math.abs(t.bpm - p.bpm) > 12,
    ) ||
    new Set(tracks.map((t) => t.arrangement.toLowerCase())).size !==
      tracks.length
  )
    throw Error("Music plan does not match its reserved slots");
  return tracks.map((t) => ({
    slot: t.slot,
    brief: {
      title: musicBrief(playlist, t.slot).title,
      style: `${p.style}; ${t.bpm} BPM; ${t.arrangement}; workout accompaniment; instrumental only, no vocals or speech; consistent energy; clean beginning and ending; avoid sudden volume jumps`,
      duration: 240,
    },
  }));
}
/** One small shared batch, no coach/member data and no alternate-model fallback. */
export async function planMusic(
  playlist: string,
  slots: number[],
  accounting: ModelAccounting,
) {
  const config = runtimeConfig(),
    genre = MUSIC_PLAYLISTS.find((p) => p.id === playlist);
  if (!isSiteStarterModel(config) || !genre)
    throw Error("Music planner unavailable");
  const { payload } = await modelCompletion(
    config.MODEL_BASE_URL!,
    config.MODEL_API_KEY!,
    config.MODEL_NAME!,
    {
      model: config.MODEL_NAME,
      max_tokens: MUSIC_PLAN_TOKENS,
      temperature: 0.7,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "Arrange original instrumental workout music. Return only JSON {tracks:[{slot,bpm,arrangement}]}.",
            "One entry per supplied slot. Use that exact slot, BPM within 12 of the genre's base, and 30-420 characters of plain English arrangement.",
            "Vary subgenre, instrumentation, rhythm, texture, harmony and progression across the slots. Each arrangement must differ.",
            "Keep a steady exercise-friendly pulse, space for coaching speech, gradual transitions and clean starts/ends. Recovery stays gentle.",
            "No lyrics, vocals, speech, chanting, sound effects, samples, named artists, existing songs, brands or URLs. No personal information.",
            "Use only letters, numbers, spaces and basic punctuation. Do not set prices, file locations, instructions for tools or extra fields.",
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify({
            version: MUSIC_PLAN_VERSION,
            genre: genre.name,
            style: genre.style,
            bpm: genre.bpm,
            slots,
          }),
        },
      ],
    },
    { reserve: accounting.reserve, record: accounting.record },
    { timeoutMs: 90000 },
  );
  const answer = (payload as any)?.choices?.[0]?.message?.content;
  if (typeof answer !== "string" || answer.length > 10000)
    throw Error("Invalid music plan size");
  return validateMusicPlan(modelReplyJson(payload), playlist, slots);
}
