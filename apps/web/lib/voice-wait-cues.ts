/** Optional cached speech. A ready answer or caller interruption always wins. */
export class VoiceWaitCues {
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(
    private readonly options: {
      clips: () => string[];
      play: (clip: string, valid: () => boolean) => Promise<void>;
      stop: () => void;
      longWait: () => void;
      now?: () => number;
      later?: typeof setTimeout;
      cancel?: typeof clearTimeout;
    },
  ) {}
  begin() {
    this.end();
    const token = this.generation,
      now = this.options.now ?? Date.now;
    const start = now(),
      used = new Set<number>();
    let playing = false;
    const valid = () => token === this.generation;
    const tick = () => {
      if (!valid()) return;
      const elapsed = now() - start;
      if (elapsed >= 18000) {
        this.options.longWait();
        return;
      }
      const index =
        elapsed >= 8000 ? 1 : elapsed >= 1500 && elapsed <= 6000 ? 0 : -1;
      const clip = this.options.clips()[index];
      if (
        index >= 0 &&
        elapsed <= 12000 &&
        clip &&
        !playing &&
        !used.has(index)
      ) {
        used.add(index);
        playing = true;
        void this.options
          .play(clip, valid)
          .catch(() => {})
          .finally(() => {
            playing = false;
          });
      }
      this.timer = (this.options.later ?? setTimeout)(tick, 250);
    };
    this.timer = (this.options.later ?? setTimeout)(tick, 250);
  }
  end() {
    this.generation++;
    if (this.timer !== undefined)
      (this.options.cancel ?? clearTimeout)(this.timer);
    this.timer = undefined;
    this.options.stop();
  }
}
