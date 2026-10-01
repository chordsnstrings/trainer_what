// The home page assistant's limits and code-owned words
// (docs/features/kamran-assistant.md), kept apart from the reply checks so the
// lazily loaded panel carries only these few strings. Browser-safe.

/** Per-visitor and per-reply limits (owner, 1 October 2026). */
export const MARKETING_ASSISTANT_LIMITS = {
  /** Spoken turns in one panel visit. */
  turnsPerVisit: 10,
  /** Longest recording sent, in seconds. */
  audioSeconds: 20,
  /** Transcript kept for one turn (a short spoken question). */
  transcriptCharacters: 300,
  /** Earlier turns sent back as context (held by the page, never stored). */
  historyTurns: 6,
  /** Turns from one network address in one UAE day. */
  turnsPerAddressPerDay: 40,
  /** Longest spoken reply, in characters (one or two sentences). */
  replyCharacters: 320,
  /** Sentences in a spoken reply. */
  replySentences: 3,
} as const;

export type AssistantLanguage = "en" | "ar";

/**
 * Code-owned words: the panel's labels and every line spoken when a model
 * reply is not used. Public text: it never names a model or its vendor.
 */
export const MARKETING_ASSISTANT_PUBLIC_TEXT = {
  en: {
    open: "Talk to Kamran",
    close: "Close",
    label: "AI voice",
    title: "Kamran, who built {APP_NAME}",
    micNotice: "Uses your microphone while you hold to talk. Audio and words are not stored.",
    hold: "Hold to talk",
    release: "Release to send",
    listening: "Listening…",
    thinking: "Thinking…",
    speaking: "Speaking…",
    greeting: "Hi, I'm Kamran. I built {APP_NAME} so personal trainers get more out of their effort. Ask me how it works, about pricing, or what you could earn.",
    handoff: "Taking you to {CTA}…",
    stay: "Stay here",
    noMic: "Your browser didn't allow the microphone. Allow it to talk to me.",
    tooLong: "Keep it under 20 seconds, then let go.",
    notHeard: "I didn't catch that. Hold the button and ask again.",
    error: "Something went wrong. Try again in a moment.",
    limit: "That's all the questions I can take this visit. The FAQ has more.",
    unavailable: "I'm not available right now. The FAQ and pricing pages have the answers.",
    fallback: "I can only speak to what's on this site. Ask me how it works, about pricing, or what you could earn.",
    fallbackNumbers: "I can work that out with the earnings calculator: tell me your subscribers and your monthly price.",
    language: "العربية",
  },
  ar: {
    notHeard: "لم أسمعك جيداً. اضغط مطولاً على الزر واسأل مرة أخرى.",
    fallback: "أستطيع الحديث فقط عمّا في هذا الموقع. اسألني كيف يعمل، أو عن الأسعار، أو كم يمكنك أن تكسب.",
    fallbackNumbers: "أستطيع حساب ذلك بحاسبة الأرباح: أخبرني بعدد المشتركين وسعرك الشهري.",
    language: "English",
  },
} as const;
