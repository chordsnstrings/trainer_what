// The language a line of text is spoken in, for text to speech. Cartesia reads
// `language` as the language of the transcript (docs/features/trainer-voice.md):
// an Arabic line sent as English is read with English phonetics, or not at all.
// Session scripts mix code-owned English lines with the trainer's own phrases
// and plan cues, which may be Arabic, so the language is decided per line.
// Browser-safe: no Node APIs.

export type SpeechLanguage = "en" | "ar";

const ARABIC_LETTER = /[ء-يٮ-ۓۺ-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/gu;
const LATIN_LETTER = /[A-Za-zÀ-ɏ]/gu;

/**
 * "ar" when a line has more Arabic letters than Latin ones, else "en". Digits,
 * punctuation and markup do not count, so "٣ مجموعات" is Arabic and "Set 1."
 * is English. A line with no letters at all is English (the code default).
 */
export function speechLanguage(text: string): SpeechLanguage {
  const value = String(text ?? "");
  const arabic = value.match(ARABIC_LETTER)?.length ?? 0;
  if (!arabic) return "en";
  const latin = value.match(LATIN_LETTER)?.length ?? 0;
  return arabic > latin ? "ar" : "en";
}
