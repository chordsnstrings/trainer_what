/** Local turn segmentation; no recording or provider call on silence. */
export class ConversationAudio {
  private lead: Float32Array[] = [];
  private chunks: Float32Array[] = [];
  private samples = 0;
  private voiced = 0;
  private quiet = 0;
  private started = false;
  constructor(readonly sampleRate: number) {}
  get active() { return this.started; }
  reset() { this.lead = []; this.chunks = []; this.samples = this.voiced = this.quiet = 0; this.started = false; }
  push(samples: Float32Array, speech: boolean): Float32Array[] | null {
    const ms = samples.length / this.sampleRate * 1000;
    if (!this.started) {
      this.lead.push(samples);
      while (this.lead.reduce((n, c) => n + c.length, 0) > this.sampleRate * .35) this.lead.shift();
      if (!speech) return null;
      this.started = true; this.chunks = this.lead; this.lead = [];
      this.samples = this.chunks.reduce((n, c) => n + c.length, 0);
    } else { this.chunks.push(samples); this.samples += samples.length; }
    if (speech) { this.voiced += ms; this.quiet = 0; } else this.quiet += ms;
    if (this.samples / this.sampleRate >= 44 || this.quiet >= 1000) {
      const result = this.voiced >= 400 ? this.chunks : null;
      this.reset();
      return result;
    }
    return null;
  }
}
export function joinPcm(chunks: Float32Array[], maxSamples = Infinity) {
  const length = Math.min(maxSamples, chunks.reduce((sum, c) => sum + c.length, 0));
  const output = new Float32Array(length);
  let at = 0;
  for (const c of chunks) { if (at >= length) break; output.set(c.subarray(0, length - at), at); at += Math.min(c.length, length - at); }
  return output;
}
/** WAV avoids Safari's MP4/Cartesia clone format mismatch. */
export function pcmWav(chunks: Float32Array[], sampleRate: number, maxSeconds = 60) {
  const pcm = joinPcm(chunks, Math.floor(sampleRate * maxSeconds)), rate = 16000;
  const length = Math.floor(pcm.length * rate / sampleRate);
  const buffer = new ArrayBuffer(44 + length * 2), view = new DataView(buffer);
  const word = (at: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i)); };
  word(0, "RIFF"); view.setUint32(4, 36 + length * 2, true); word(8, "WAVE"); word(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); word(36, "data"); view.setUint32(40, length * 2, true);
  for (let i = 0; i < length; i++) {
    const from = Math.floor(i * sampleRate / rate), to = Math.max(from + 1, Math.floor((i + 1) * sampleRate / rate));
    let sum = 0; for (let j = from; j < Math.min(to, pcm.length); j++) sum += pcm[j];
    const value = Math.max(-1, Math.min(1, sum / Math.max(1, Math.min(to, pcm.length) - from)));
    view.setInt16(44 + i * 2, value < 0 ? value * 32768 : value * 32767, true);
  }
  return { blob: new Blob([buffer], { type: "audio/wav" }), durationMs: Math.round(length / rate * 1000) };
}
