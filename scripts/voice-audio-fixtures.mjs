// Local, deterministic fixtures. libflite synthesizes speech without a provider.
import { execFileSync } from "node:child_process";
export function spokenPcm(text, rate = 48000) {
  if (!/^[a-zA-Z0-9 .,?]+$/.test(text)) throw Error("Fixture text only");
  const bytes = execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      `flite=text='${text}':voice=slt`,
      "-ar",
      String(rate),
      "-ac",
      "1",
      "-f",
      "f32le",
      "pipe:1",
    ],
    { maxBuffer: 8 * 1024 * 1024 },
  );
  return new Float32Array(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
}
export function pcmFixture(seconds, segments, rate = 48000) {
  const pcm = new Float32Array(rate * seconds);
  for (const { at, text, gain = 1 } of segments) {
    const speech = spokenPcm(text, rate),
      start = Math.round(at * rate);
    for (let i = 0; i < speech.length && start + i < pcm.length; i++)
      pcm[start + i] += speech[i] * gain;
  }
  return pcm;
}
export function wavBytes(pcm, rate = 48000) {
  const wav = Buffer.alloc(44 + pcm.length * 2);
  wav.write("RIFF");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(pcm.length * 2, 40);
  for (let i = 0; i < pcm.length; i++)
    wav.writeInt16LE(
      Math.round(Math.max(-1, Math.min(1, pcm[i])) * 32767),
      44 + i * 2,
    );
  return wav;
}
