import { z } from "zod";
import { MUSIC_PLAYLISTS, musicBrief } from "../../domain/src/workout-music.ts";
import { runtimeConfig } from "./configuration.ts";
import { modelCompletion, type ModelAccounting } from "./model-accounting.ts";
import { modelReplyJson } from "./model-request.ts";
import { isSiteStarterModel } from "./site-builder-starter.ts";
export const MUSIC_PLAN_VERSION = "music-plan-v2";
export const MUSIC_PLAN_SIZE = 6;
export const MUSIC_PLAN_TOKENS = 2500;
export const MUSIC_ARRANGEMENT_MAX = 420;
export type MusicBrief = ReturnType<typeof musicBrief>;
/** A model reply that was received but not used. The message says why. */
export class MusicPlanRejected extends Error {}
const ARRANGEMENT_CHARS = /^[a-zA-Z0-9 ,.;:()'&+\/-]+$/;
// Typographic dashes, quotes, ellipses and spaces become their plain forms.
const plain = (v: unknown) =>
  typeof v === "string"
    ? v
        .replace(/[\u2010-\u2015\u2212]/g, "-")
        .replace(
          /["\u2018\u2019\u201A\u201B\u2032\u201C\u201D\u201E\u201F\u2033]/g,
          "'",
        )
        .replace(/\u2026/g, "...")
        .replace(/[\u00A0\u2007\u202F]/g, " ")
    : v;
const arrangement = z.preprocess(
  plain,
  z
    .string()
    .trim()
    .min(30)
    .max(MUSIC_ARRANGEMENT_MAX)
    .regex(ARRANGEMENT_CHARS)
    .refine((v) => !/https?:|www\./i.test(v)),
);
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
/** Code-built reason for a schema failure; never echoes the model's text. */
function issueReason(error: z.ZodError, raw: unknown) {
  const issue = error.issues[0];
  if (!issue) return "The reply did not match the music plan format.";
  const [, index, field] = issue.path;
  const track = (raw as any)?.tracks?.[index as number],
    where =
      typeof index === "number"
        ? `The track for slot ${Number.isInteger(track?.slot) ? track.slot : `#${index + 1}`}`
        : "The reply";
  // Field names the model invented are counted, not repeated.
  if (issue.code === "unrecognized_keys") {
    const n = issue.keys.length;
    return `${where} had ${n} extra field${n === 1 ? "" : "s"}.`;
  }
  if (!issue.path.length)
    return "The reply did not match the music plan format.";
  if (field === "arrangement") {
    const text = plain(track?.arrangement);
    if (typeof text === "string") {
      // The same trimmed text the schema checks.
      const checked = text.trim(),
        length = checked.length;
      if (length > MUSIC_ARRANGEMENT_MAX)
        return `${where} had a description of ${length} characters (limit ${MUSIC_ARRANGEMENT_MAX}).`;
      if (length < 30)
        return `${where} had a description of ${length} characters (minimum 30).`;
      const bad = [
        ...new Set([...checked].filter((c) => !ARRANGEMENT_CHARS.test(c))),
      ].slice(0, 3);
      if (bad.length)
        return `${where} used characters that are not allowed: ${bad
          .map(
            (c) =>
              `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`,
          )
          .join(", ")}.`;
      return `${where} had a web address in its description.`;
    }
  }
  if (issue.code === "too_big" && issue.path.length === 1)
    return `The reply had more than ${MUSIC_PLAN_SIZE} tracks.`;
  if (issue.code === "too_small" && issue.path.length === 1)
    return "The reply had no tracks.";
  // Only schema-defined keys (tracks, slot, bpm) reach this point.
  return `${where} had a missing or invalid ${String(field ?? issue.path[0])} value.`;
}
export function validateMusicPlan(
  raw: unknown,
  playlist: string,
  slots: number[],
) {
  const p = MUSIC_PLAYLISTS.find((p) => p.id === playlist);
  if (!p || !slots.length || slots.length > MUSIC_PLAN_SIZE)
    throw Error("Invalid music plan");
  const parsed = schema.safeParse(raw);
  if (!parsed.success)
    throw new MusicPlanRejected(issueReason(parsed.error, raw));
  const { tracks } = parsed.data;
  const reject = (reason: string) => {
    throw new MusicPlanRejected(reason);
  };
  if (tracks.length !== slots.length)
    reject(
      `The reply had ${tracks.length} tracks for ${slots.length} reserved slots.`,
    );
  if (new Set(tracks.map((t) => t.slot)).size !== tracks.length)
    reject("The reply used the same slot twice.");
  for (const t of tracks) {
    if (!slots.includes(t.slot))
      reject(`The reply used slot ${t.slot}, which was not reserved.`);
    if (Math.abs(t.bpm - p.bpm) > 12)
      reject(
        `The track for slot ${t.slot} was ${t.bpm} BPM; allowed ${p.bpm - 12} to ${p.bpm + 12}.`,
      );
  }
  if (
    new Set(tracks.map((t) => t.arrangement.toLowerCase())).size !==
    tracks.length
  )
    reject("Two tracks had the same description.");
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
            "One entry per supplied slot. Use that exact slot, BPM within 12 of the genre's base, and an arrangement of 80 to 300 characters of plain English.",
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
    throw new MusicPlanRejected(
      "The reply was empty or longer than 10,000 characters.",
    );
  let raw: unknown;
  try {
    raw = modelReplyJson(payload);
  } catch {
    throw new MusicPlanRejected("The reply was not valid JSON.");
  }
  return validateMusicPlan(raw, playlist, slots);
}
