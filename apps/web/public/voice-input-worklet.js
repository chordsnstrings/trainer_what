// Continuous, bounded 16 kHz mono frames. This node never outputs microphone audio.
class VoiceInputCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new Float32Array(512);
    this.offset = 0;
    this.sum = 0;
    this.weight = 0;
    this.ratio = sampleRate / 16000;
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (const sample of input) {
      let remaining = 1;
      while (remaining > 1e-8) {
        const part = Math.min(remaining, this.ratio - this.weight);
        this.sum += sample * part;
        this.weight += part;
        remaining -= part;
        if (this.weight >= this.ratio - 1e-8) {
          this.frame[this.offset++] = this.sum / this.ratio;
          this.sum = this.weight = 0;
          if (this.offset === 512) {
            this.port.postMessage({ frame: this.frame, time: currentTime }, [
              this.frame.buffer,
            ]);
            this.frame = new Float32Array(512);
            this.offset = 0;
          }
        }
      }
    }
    return true;
  }
}
registerProcessor("voice-input-capture", VoiceInputCapture);
