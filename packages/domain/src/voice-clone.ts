/**
 * Trainer voice clones (docs/features/trainer-voice.md): the rules the API and
 * the worker share, free of I/O. A clone moves
 *
 *   draft -> processing -> ready -> active
 *                      \-> failed      ready <-> active
 *   any state -> deleted
 *
 * draft: consent recorded, recordings being added. processing: the provider
 * is making it (a Quick clone in seconds; a Pro clone uploads its recordings,
 * trains for up to three hours and is polled by the worker). ready: the
 * provider voice exists; the trainer previews it. active: the voice members
 * hear (one per workspace). failed: the provider refused or never confirmed;
 * the trainer retries or records again. deleted: removed here and queued for
 * deletion at the provider.
 */

export const CLONE_STATUSES = [
  "draft",
  "processing",
  "ready",
  "active",
  "failed",
  "deleted",
] as const;
export type CloneStatus = (typeof CLONE_STATUSES)[number];
export type CloneKind = "instant" | "pro";

const TRANSITIONS: Record<CloneStatus, readonly CloneStatus[]> = {
  draft: ["processing", "deleted"],
  processing: ["ready", "failed", "deleted"],
  ready: ["active", "deleted"],
  active: ["ready", "deleted"],
  failed: ["processing", "deleted"],
  deleted: [],
};
export function canTransition(from: CloneStatus, to: CloneStatus) {
  return TRANSITIONS[from].includes(to);
}
export class CloneStateError extends Error {
  constructor(
    readonly from: CloneStatus,
    readonly to: CloneStatus,
  ) {
    super(`A ${from} voice clone cannot become ${to}.`);
    this.name = "CloneStateError";
  }
}
export function assertTransition(from: CloneStatus, to: CloneStatus) {
  if (!canTransition(from, to)) throw new CloneStateError(from, to);
}

/**
 * Recording limits. Quick: Cartesia learns from 10 seconds and uses up to 60
 * (Sonic 3.6); one clip (its upload limit is 16 MB). Pro: at least 30 minutes
 * of one speaker; files are sent one at a time. One recording is at most 7 MB
 * so its base64 request stays under the web proxy's 10 MB body buffer
 * (Next.js proxyClientMaxBodySize). Recordings are kept here only until the
 * provider has them, so the total is bounded too.
 */
export const CLONE_LIMITS = {
  instant: { minSeconds: 10, maxSeconds: 60, maxBytes: 7 * 1024 * 1024 },
  pro: {
    minFileSeconds: 5,
    minTotalSeconds: 30 * 60,
    maxTotalSeconds: 3 * 60 * 60,
    maxFiles: 60,
    maxBytes: 7 * 1024 * 1024,
    maxTotalBytes: 250 * 1024 * 1024,
  },
  /** Clones not deleted, per workspace (the active one, one in progress per kind, one spare). */
  maxClones: 4,
  /** Drafts and failed clones left untouched this long are removed with their recordings. */
  staleDays: 7,
} as const;

export const SAMPLE_TYPES = [
  "audio/mpeg",
  "audio/wav",
  "audio/flac",
  "audio/ogg",
  "audio/webm",
] as const;
export type SampleType = (typeof SAMPLE_TYPES)[number];
/** Highest plausible bit rate per format (bits per second), for duration checks. */
const MAX_BITS_PER_SECOND: Record<SampleType, number> = {
  "audio/mpeg": 320_000,
  "audio/wav": 48_000 * 32 * 2,
  "audio/flac": 48_000 * 24 * 2,
  "audio/ogg": 510_000,
  "audio/webm": 510_000,
};
/** Lowest plausible bit rate: speech-grade Opus. */
const MIN_BITS_PER_SECOND = 6_000;

export class SampleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SampleError";
  }
}

/** Whether the bytes start like the declared format. */
export function sampleMatchesType(audio: Buffer, type: SampleType) {
  if (audio.length < 16) return false;
  switch (type) {
    case "audio/wav":
      return (
        audio.toString("ascii", 0, 4) === "RIFF" &&
        audio.toString("ascii", 8, 12) === "WAVE"
      );
    case "audio/flac":
      return audio.toString("ascii", 0, 4) === "fLaC";
    case "audio/ogg":
      return audio.toString("ascii", 0, 4) === "OggS";
    case "audio/webm":
      return audio.readUInt32BE(0) === 0x1a45dfa3;
    case "audio/mpeg":
      return (
        audio.toString("ascii", 0, 3) === "ID3" ||
        (audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0)
      );
  }
}

/** Exact seconds of PCM audio from a WAV header, or null. */
export function wavSeconds(audio: Buffer): number | null {
  let offset = 12,
    byteRate = 0,
    dataBytes = -1;
  while (offset + 8 <= audio.length && dataBytes < 0) {
    const chunk = audio.toString("ascii", offset, offset + 4),
      size = audio.readUInt32LE(offset + 4);
    if (chunk === "fmt " && size >= 16 && offset + 24 <= audio.length) {
      const channels = audio.readUInt16LE(offset + 10),
        rate = audio.readUInt32LE(offset + 12),
        declaredRate = audio.readUInt32LE(offset + 16),
        align = audio.readUInt16LE(offset + 20),
        bits = audio.readUInt16LE(offset + 22);
      if (
        channels >= 1 &&
        channels <= 2 &&
        rate >= 8000 &&
        rate <= 48000 &&
        [8, 16, 24, 32].includes(bits) &&
        align === (channels * bits) / 8 &&
        declaredRate === rate * align
      )
        byteRate = declaredRate;
    }
    if (chunk === "data") dataBytes = Math.min(size, audio.length - offset - 8);
    offset += 8 + size + (size % 2);
  }
  return byteRate && dataBytes > 0 ? dataBytes / byteRate : null;
}

/**
 * The recording's length in seconds. A WAV header is read exactly; for
 * compressed formats the length the browser measured is accepted only when
 * the file size is plausible for it.
 */
export function sampleSeconds(
  audio: Buffer,
  type: SampleType,
  declaredSeconds: number,
): number {
  if (type === "audio/wav") {
    const exact = wavSeconds(audio);
    if (exact === null)
      throw new SampleError(
        "This WAV file has no readable audio. Export it again or use MP3.",
      );
    return Math.round(exact * 100) / 100;
  }
  if (!Number.isFinite(declaredSeconds) || declaredSeconds <= 0)
    throw new SampleError("The recording's length could not be measured.");
  const bits = audio.length * 8;
  const longest = bits / MIN_BITS_PER_SECOND,
    shortest = bits / MAX_BITS_PER_SECOND[type];
  if (declaredSeconds > longest * 1.05 || declaredSeconds < shortest * 0.95)
    throw new SampleError(
      "The recording's length does not match the file. Record or export it again.",
    );
  return Math.round(declaredSeconds * 100) / 100;
}

/** Checks one recording for a clone of this kind; returns its seconds. */
export function checkSample(
  kind: CloneKind,
  audio: Buffer,
  type: SampleType,
  declaredSeconds: number,
) {
  const limits = CLONE_LIMITS[kind];
  if (!audio.length || audio.length > limits.maxBytes)
    throw new SampleError(
      `Use a recording under ${Math.round(limits.maxBytes / 1048576)} MB.`,
    );
  if (!sampleMatchesType(audio, type))
    throw new SampleError(
      "The audio contents do not match the selected format. Use MP3, WAV, FLAC, OGG or WebM.",
    );
  const seconds = sampleSeconds(audio, type, declaredSeconds);
  if (kind === "instant") {
    const q = CLONE_LIMITS.instant;
    if (seconds < q.minSeconds || seconds > q.maxSeconds)
      throw new SampleError(
        `A Quick clone needs ${q.minSeconds} to ${q.maxSeconds} seconds of your voice; this recording is ${Math.round(seconds)} seconds.`,
      );
  } else if (seconds < CLONE_LIMITS.pro.minFileSeconds)
    throw new SampleError("Each Pro recording must be at least 5 seconds.");
  return seconds;
}

/** Whether a clone's recordings are enough to start it. */
export function recordingsReady(
  kind: CloneKind,
  samples: Array<{ seconds: number; bytes: number }>,
): { ready: boolean; message: string | null } {
  if (kind === "instant")
    return samples.length === 1
      ? { ready: true, message: null }
      : { ready: false, message: "Add one recording of 10 to 60 seconds." };
  const p = CLONE_LIMITS.pro,
    seconds = samples.reduce((sum, s) => sum + s.seconds, 0);
  if (seconds < p.minTotalSeconds)
    return {
      ready: false,
      message: `A Pro clone needs at least 30 minutes of recordings; you have ${Math.floor(seconds / 60)} minutes.`,
    };
  if (seconds > p.maxTotalSeconds)
    return { ready: false, message: "Use at most 3 hours of recordings." };
  return { ready: true, message: null };
}
/** Whether one more Pro recording fits the per-clone bounds. */
export function proRecordingFits(
  samples: Array<{ seconds: number; bytes: number }>,
  next: { seconds: number; bytes: number },
) {
  const p = CLONE_LIMITS.pro;
  if (samples.length + 1 > p.maxFiles)
    return `A Pro clone takes at most ${p.maxFiles} recordings.`;
  if (samples.reduce((sum, s) => sum + s.bytes, 0) + next.bytes > p.maxTotalBytes)
    return "These recordings are too large together. Use MP3, FLAC or OGG instead of WAV.";
  if (samples.reduce((sum, s) => sum + s.seconds, 0) + next.seconds > p.maxTotalSeconds)
    return "Use at most 3 hours of recordings.";
  return null;
}

/** The fixed line the trainer hears before activating a clone. */
export const PREVIEW_LINE =
  "Hi, it's your trainer. Let's warm up for five minutes, then start your first set when you're ready. I'll count you through it.";

export const CLONE_CONSENT_VERSION = "trainer-voice-clone:v1";
/** What the trainer confirms before a clone is made (each one required). */
export const CLONE_CONSENT = {
  ownVoice:
    "This is my own voice. Nobody else speaks in these recordings, and I am not imitating anyone.",
  cloning:
    "I agree that my recordings are sent to the voice provider to make a private copy of my voice for this workspace.",
  subscriberUse:
    "I agree that my subscribers with premium voice hear this voice read their assigned workouts, and for nothing else.",
  deletion:
    "I understand I can stop using or delete this voice at any time, and that deleting it removes it at the provider.",
} as const;
export type CloneConsent = Record<keyof typeof CLONE_CONSENT, true>;

/** English names of the languages a clone can be made in (Cartesia 2026-08-14). */
export const CLONE_LANGUAGE_NAMES: Record<string, string> = {
  en: "English", ar: "Arabic", fr: "French", de: "German", es: "Spanish",
  pt: "Portuguese", it: "Italian", nl: "Dutch", pl: "Polish", ru: "Russian",
  sv: "Swedish", tr: "Turkish", hi: "Hindi", ur: "Urdu", bn: "Bengali",
  ta: "Tamil", te: "Telugu", gu: "Gujarati", kn: "Kannada", ml: "Malayalam",
  mr: "Marathi", pa: "Punjabi", or: "Odia", zh: "Chinese", ja: "Japanese",
  ko: "Korean", tl: "Tagalog", bg: "Bulgarian", ro: "Romanian", cs: "Czech",
  el: "Greek", fi: "Finnish", hr: "Croatian", ms: "Malay", sk: "Slovak",
  da: "Danish", uk: "Ukrainian", hu: "Hungarian", no: "Norwegian",
  vi: "Vietnamese", th: "Thai", he: "Hebrew", ka: "Georgian", id: "Indonesian",
};
