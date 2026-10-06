import { execFile } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
const run = promisify(execFile);
export class MusicAudioRejected extends Error {}
const audioFailure = (error: unknown): never => {
  // Decoder failures reject audio. Infrastructure failures must not buy replacements.
  if (typeof (error as any)?.code === "number" && !(error as any)?.killed)
    throw new MusicAudioRejected("The MP3 could not be decoded");
  throw error;
};
/** Local decoding only. No remote inputs, speech recognition or AI calls. */
export async function prepareMusicAudio(
  audio: Buffer,
  expectedDuration: number,
) {
  if (audio.length < 1024 || audio.length > 20 * 1024 * 1024)
    throw new MusicAudioRejected("Invalid audio size");
  const dir = await mkdtemp(join(tmpdir(), "workout-music-"));
  try {
    const input = join(dir, "input.mp3"),
      output = join(dir, "output.mp3");
    await writeFile(input, audio, { mode: 0o600 });
    const { stdout } = await run(
      "ffprobe",
      [
        "-v",
        "error",
        "-protocol_whitelist",
        "file,pipe",
        "-f",
        "mp3",
        "-show_entries",
        "format=duration:stream=codec_name,channels,sample_rate",
        "-of",
        "json",
        input,
      ],
      { timeout: 15000, maxBuffer: 32768 },
    ).catch(audioFailure);
    const probe = JSON.parse(stdout),
      duration = Number(probe.format?.duration),
      stream = probe.streams?.[0];
    if (
      probe.streams?.length !== 1 ||
      stream?.codec_name !== "mp3" ||
      ![1, 2].includes(Number(stream.channels)) ||
      ![32000, 44100, 48000].includes(Number(stream.sample_rate)) ||
      !Number.isFinite(duration) ||
      duration < 150 ||
      duration > 360 ||
      Math.abs(duration - expectedDuration) >
        Math.max(5, expectedDuration * 0.02)
    )
      throw new MusicAudioRejected("Music failed duration or decoder checks");
    const { stderr } = await run(
      "ffmpeg",
      [
        "-hide_banner",
        "-nostats",
        "-nostdin",
        "-xerror",
        "-threads",
        "1",
        "-protocol_whitelist",
        "file,pipe",
        "-f",
        "mp3",
        "-i",
        input,
        "-vn",
        "-map_metadata",
        "-1",
        "-af",
        "silencedetect=noise=-50dB:d=8,loudnorm=I=-16:TP=-1.5:LRA=9:print_format=json,aresample=44100",
        "-ac",
        "2",
        "-codec:a",
        "libmp3lame",
        "-b:a",
        "128k",
        "-t",
        "360",
        "-y",
        output,
      ],
      { timeout: 90000, maxBuffer: 65536 },
    ).catch(audioFailure);
    const loudness = /"input_i"\s*:\s*"([^"]+)"/.exec(stderr)?.[1];
    if (
      !Number.isFinite(Number(loudness)) ||
      Number(loudness) < -40 ||
      /silence_start:/.test(stderr)
    )
      throw new MusicAudioRejected(
        "Music contains excessive silence or insufficient audio",
      );
    const normalized = await readFile(output);
    if (normalized.length < 1024 || normalized.length > 20 * 1024 * 1024)
      throw new MusicAudioRejected("Invalid normalized audio size");
    return {
      audio: normalized,
      check: {
        version: "mp3-v1",
        passed: true,
        duration,
        loudnessTargetLufs: -16,
        peakTargetDb: -1.5,
        instrumentalEvidence: "provider_request",
        listeningReviewed: false,
      },
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
