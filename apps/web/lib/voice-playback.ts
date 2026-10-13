/** Pause only the answer node; the microphone/context keep running. */
export class VoicePlayback {
  private source?: AudioBufferSourceNode;
  private offset = 0;
  private started = 0;
  private ended = false;
  private finish!: () => void;
  readonly done = new Promise<void>((resolve) => {
    this.finish = resolve;
  });
  constructor(
    private context: AudioContext,
    private buffer: AudioBuffer,
    private maxSeconds = 45,
  ) {}
  get paused() {
    return !this.source && !this.ended;
  }
  resume() {
    if (this.source || this.ended) return;
    const duration = Math.min(this.buffer.duration, this.maxSeconds);
    if (this.offset >= duration) {
      this.stop();
      return;
    }
    const source = this.context.createBufferSource();
    source.buffer = this.buffer;
    source.connect(this.context.destination);
    this.source = source;
    this.started = this.context.currentTime;
    source.onended = () => {
      if (this.source === source) this.stop();
    };
    source.start(0, this.offset, duration - this.offset);
  }
  pause() {
    if (!this.source || this.ended) return;
    this.offset += Math.max(0, this.context.currentTime - this.started);
    this.detach();
  }
  private detach() {
    const source = this.source;
    this.source = undefined;
    if (source) {
      source.onended = null;
      try {
        source.stop();
      } catch {}
      source.disconnect();
    }
  }
  stop() {
    if (this.ended) return;
    this.ended = true;
    this.detach();
    this.finish();
  }
}
