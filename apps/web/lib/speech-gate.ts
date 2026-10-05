/** Local upload gate, not speaker identification. Rejects silence and brief impacts. */
export class SpeechGate {
  private since: number | null = null;
  sample(
    rms: number,
    speechBandRatio: number,
    activeBins: number,
    now: number,
  ) {
    const candidate =
      Number.isFinite(rms) &&
      rms > 0.018 &&
      speechBandRatio >= 0.5 &&
      activeBins >= 5;
    if (!candidate) {
      this.since = null;
      return false;
    }
    this.since ??= now;
    return now - this.since >= 160;
  }
}
export function speechBand(
  spectrum: Float32Array,
  sampleRate: number,
  fftSize: number,
) {
  let speech = 0,
    total = 0,
    peak = -Infinity,
    activeBins = 0;
  for (let i = 1; i < spectrum.length; i++) {
    const frequency = (i * sampleRate) / fftSize;
    if (frequency > 8000) break;
    const power = Number.isFinite(spectrum[i]) ? 10 ** (spectrum[i] / 10) : 0;
    total += power;
    if (frequency >= 200 && frequency <= 4000) {
      speech += power;
      peak = Math.max(peak, spectrum[i]);
    }
  }
  for (let i = 1; i < spectrum.length; i++) {
    const frequency = (i * sampleRate) / fftSize;
    if (frequency >= 200 && frequency <= 4000 && spectrum[i] > peak - 18)
      activeBins++;
  }
  return { ratio: total > 0 ? speech / total : 0, activeBins };
}
