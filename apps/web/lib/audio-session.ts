// Audio helpers for the voice-led session's "My own music" mode
// (docs/features/voice-session.md, "Own music"). Pure where possible, and
// every browser API is optional: without it the session keeps today's
// behaviour (the member's music pauses while a cue plays).
//
// - iPhone (Safari 16.4+): navigator.audioSession.type = "ambient" lets cues
//   play over the member's music; "play-and-record" only while recording.
// - Android Chrome: an <audio> clip of 5 s or less with a known duration asks
//   for transient focus, so the music is lowered briefly and comes back. Each
//   cue is therefore one joined clip of at most about 4.5 s.

export type AudioSessionType =
  | "auto"
  | "playback"
  | "transient"
  | "transient-solo"
  | "ambient"
  | "play-and-record";
type Nav =
  | {
      audioSession?: { type: string } | null;
      wakeLock?: { request(type: "screen"): Promise<WakeLock> };
    }
  | undefined;
type WakeLock = { release(): Promise<void>; released?: boolean };
const browser = (): Nav =>
  typeof navigator === "undefined" ? undefined : (navigator as unknown as Nav);

/** Whether the browser lets a page choose how its audio mixes with other apps. */
export function audioSessionSupported(nav: Nav = browser()) {
  return !!nav && !!nav.audioSession && typeof nav.audioSession === "object";
}
/**
 * Sets the page's audio session type. Returns true when the type is in effect
 * (WebKit ignores it silently where the microphone is not allowed).
 */
export function setAudioSessionType(
  type: AudioSessionType,
  nav: Nav = browser(),
) {
  if (!audioSessionSupported(nav)) return false;
  try {
    if (nav!.audioSession!.type !== type) nav!.audioSession!.type = type;
    return nav!.audioSession!.type === type;
  } catch {
    return false;
  }
}
/** Keeps the screen on while the session runs, where supported; null otherwise. */
export async function requestWakeLock(
  nav: Nav = browser(),
): Promise<WakeLock | null> {
  try {
    if (!nav?.wakeLock?.request) return null;
    return await nav.wakeLock.request("screen");
  } catch {
    return null;
  }
}
/** A tenth of a second of silence (8 kHz, 8-bit mono WAV) for unlocking audio inside a tap. */
export function silentWav(): Uint8Array {
  const samples = 800,
    bytes = new Uint8Array(44 + samples);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, s: string) =>
    [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, 8000, true);
  view.setUint32(28, 8000, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  text(36, "data");
  view.setUint32(40, samples, true);
  bytes.fill(128, 44);
  return bytes;
}
/**
 * Plays a moment of silence on the session's audio element inside the start
 * tap, so later cues may play without another tap (iPhone). Never throws.
 */
export async function unlockAudio(
  audio: HTMLAudioElement | null,
): Promise<boolean> {
  if (!audio || typeof URL === "undefined" || typeof Blob === "undefined")
    return false;
  const url = URL.createObjectURL(
    new Blob([silentWav() as BlobPart], { type: "audio/wav" }),
  );
  try {
    audio.src = url;
    await audio.play();
    audio.pause();
    return true;
  } catch {
    return false;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------------------------------------------------------------------------
// MP3 clips: duration and joining.
// ---------------------------------------------------------------------------
const BITRATES_V1 = [
  0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320,
];
const BITRATES_V2 = [
  0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160,
];
const RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  0: [11025, 12000, 8000],
};
type Frame = { offset: number; length: number; samples: number; rate: number };
function frameAt(b: Uint8Array, i: number): Frame | null {
  if (i + 4 > b.length || b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0)
    return null;
  const version = (b[i + 1] >> 3) & 3,
    layer = (b[i + 1] >> 1) & 3;
  if (version === 1 || layer !== 1) return null; // Layer III only
  const bitrate = (version === 3 ? BITRATES_V1 : BITRATES_V2)[b[i + 2] >> 4],
    rate = RATES[version]?.[(b[i + 2] >> 2) & 3];
  if (!bitrate || !rate) return null;
  const padding = (b[i + 2] >> 1) & 1;
  const length =
    Math.floor(((version === 3 ? 144000 : 72000) * bitrate) / rate) + padding;
  if (length < 24) return null;
  return { offset: i, length, samples: version === 3 ? 1152 : 576, rate };
}
/** A Xing/Info/VBRI header frame carries no audio; it is left out of a join. */
function headerFrame(b: Uint8Array, f: Frame) {
  const tag = (o: number) =>
    String.fromCharCode(...b.subarray(f.offset + o, f.offset + o + 4));
  const mono = ((b[f.offset + 3] >> 6) & 3) === 3,
    v1 = ((b[f.offset + 1] >> 3) & 3) === 3;
  const side = v1 ? (mono ? 17 : 32) : mono ? 9 : 17;
  return ["Xing", "Info"].includes(tag(4 + side)) || tag(36) === "VBRI";
}
export type Mp3Info = { durationMs: number; frames: Array<[number, number]> };
/**
 * Reads an MP3 clip's audio frames: skips an ID3v2 tag and a Xing/Info
 * header frame, stops at an ID3v1 tag or trailing bytes. Null when the bytes
 * are not MPEG Layer III audio.
 */
export function mp3Info(bytes: Uint8Array): Mp3Info | null {
  let i = 0;
  if (
    bytes.length >= 10 &&
    bytes[0] === 0x49 &&
    bytes[1] === 0x44 &&
    bytes[2] === 0x33
  ) {
    const size =
      ((bytes[6] & 0x7f) << 21) |
      ((bytes[7] & 0x7f) << 14) |
      ((bytes[8] & 0x7f) << 7) |
      (bytes[9] & 0x7f);
    i = 10 + size + (bytes[5] & 0x10 ? 10 : 0);
  }
  // The first frame may follow a few bytes of padding.
  let first: Frame | null = null;
  for (const end = Math.min(bytes.length, i + 4096); i < end && !first;) {
    first = frameAt(bytes, i);
    if (!first) i++;
  }
  if (!first) return null;
  const frames: Array<[number, number]> = [];
  let samples = 0,
    rate = first.rate;
  for (
    let f: Frame | null = first, n = 0;
    f && f.offset + f.length <= bytes.length;
    n++
  ) {
    if (!(n === 0 && headerFrame(bytes, f))) {
      frames.push([f.offset, f.offset + f.length]);
      samples += f.samples;
      rate = f.rate;
    }
    f = frameAt(bytes, f.offset + f.length);
  }
  if (!frames.length) return null;
  return { durationMs: Math.round((samples / rate) * 1000), frames };
}
/**
 * Joins clips into one MP3 with a known duration: the audio frames of each,
 * in order, without tags or header frames. Null when a part is not MP3 (the
 * caller then plays the clips one by one, as before).
 */
export function joinMp3(
  parts: Uint8Array[],
): { bytes: Uint8Array; durationMs: number } | null {
  const infos = parts.map(mp3Info);
  if (!parts.length || infos.some((i) => !i)) return null;
  const size = infos.reduce(
    (n, info) => n + info!.frames.reduce((m, [a, b]) => m + b - a, 0),
    0,
  );
  const out = new Uint8Array(size);
  let at = 0;
  infos.forEach((info, k) => {
    for (const [a, b] of info!.frames) {
      out.set(parts[k].subarray(a, b), at);
      at += b - a;
    }
  });
  return {
    bytes: out,
    durationMs: infos.reduce((n, info) => n + info!.durationMs, 0),
  };
}

// ---------------------------------------------------------------------------
// Cue length budget.
// ---------------------------------------------------------------------------
/** One cue clip stays under Chrome's 5-second "transient" threshold. */
export const CUE_BUDGET_MS = 4500;
/**
 * Groups a cue's clips (in order) into joined clips of at most `budgetMs`.
 * A clip that is longer on its own, or whose length is unknown, is not played
 * in "My own music" mode: its words stay on screen (`textOnly`).
 */
export function planCue(
  durations: Array<number | null>,
  budgetMs = CUE_BUDGET_MS,
) {
  const groups: number[][] = [],
    textOnly: number[] = [];
  let current: number[] = [],
    total = 0;
  const close = () => {
    if (current.length) groups.push(current);
    current = [];
    total = 0;
  };
  durations.forEach((d, i) => {
    if (d === null || !(d > 0) || d > budgetMs) {
      close();
      textOnly.push(i);
      return;
    }
    if (total + d > budgetMs) close();
    current.push(i);
    total += d;
  });
  close();
  return { groups, textOnly };
}

// ---------------------------------------------------------------------------
// The member's music choice, remembered on this device.
// ---------------------------------------------------------------------------
export type MusicMode = "off" | "own" | "library";
export const MUSIC_MODE_KEY = "voice-music-mode";
export function savedMusicMode(
  storage: Pick<Storage, "getItem"> | null = typeof localStorage === "undefined"
    ? null
    : localStorage,
): MusicMode {
  try {
    const value = storage?.getItem(MUSIC_MODE_KEY);
    return value === "own" || value === "library" ? value : "off";
  } catch {
    return "off";
  }
}
